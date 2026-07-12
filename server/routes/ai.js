import { Router } from 'express';
import { renderTemplate, validateCampaignInput } from './campaigns.js';

// Errors are logged as metadata only — never the note or campaign text (it can carry
// financial-aid / student-record content).
const logAiError = (op, id, err) => {
  console.error(`[ai] ${op} ${id ?? ''} failed: ${err.status || ''} ${err.name || 'Error'}`);
};

export function aiRoutes() {
  const router = Router();

  const guard = (req, res) => {
    if (!req.app.locals.ai?.enabled) {
      res.status(503).json({ error: 'AI is not configured on this instance' });
      return false;
    }
    return true;
  };

  router.post('/notes/:id/summarize', async (req, res) => {
    if (!guard(req, res)) return;
    const db = req.app.locals.db;
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!note) return res.status(404).json({ error: 'No such note' });
    try {
      const summary = await req.app.locals.ai.summarizeNote(note.body);
      db.prepare("UPDATE notes SET summary = ?, updated_at = datetime('now') WHERE id = ?").run(
        summary,
        req.params.id
      );
      const row = db
        .prepare(
          'SELECT n.*, a.title AS article_title, a.link AS article_link FROM notes n LEFT JOIN articles a ON a.id = n.article_id WHERE n.id = ?'
        )
        .get(req.params.id);
      res.json({ ...row, tags: JSON.parse(row.tags || '[]') });
    } catch (err) {
      logAiError('summarize note', req.params.id, err);
      res.status(502).json({ error: 'AI request failed — try again' });
    }
  });

  router.post('/campaigns/generate', async (req, res) => {
    if (!guard(req, res)) return;
    const fields = validateCampaignInput(req, res);
    if (!fields) return;
    const db = req.app.locals.db;
    const tpl = req.body.template_id
      ? db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.body.template_id)
      : db.prepare('SELECT * FROM campaign_templates ORDER BY id LIMIT 1').get();
    if (!tpl) return res.status(400).json({ error: 'No template available' });
    const brief = renderTemplate(tpl.body, fields);
    try {
      const output = await req.app.locals.ai.generateCampaign(brief, fields.message_count);
      const info = db
        .prepare('INSERT INTO campaigns (kind, purpose, cta, cta_link, message_count, output) VALUES (?, ?, ?, ?, ?, ?)')
        .run('generated', fields.purpose, fields.cta, fields.cta_link, fields.message_count, output);
      res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      logAiError('generate campaign', null, err);
      res.status(502).json({ error: 'AI request failed — try again' });
    }
  });

  return router;
}
