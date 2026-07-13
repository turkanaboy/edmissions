import { Router } from 'express';
import { campaignFields, pickTemplate, renderTemplate, validateCampaignInput } from './campaigns.js';
import { NOTE_JOIN, parseNote } from './notes.js';

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
      const row = db.prepare(`${NOTE_JOIN} WHERE n.id = ?`).get(req.params.id);
      res.json(parseNote(row));
    } catch (err) {
      logAiError('summarize note', req.params.id, err);
      res.status(502).json({ error: 'AI request failed — try again' });
    }
  });

  router.post('/research/chat', async (req, res) => {
    if (!guard(req, res)) return;
    const question = String(req.body?.question || '').trim();
    if (!question) return res.status(400).json({ error: 'Question is required' });
    if (question.length > 2000) return res.status(400).json({ error: 'Question is too long' });
    try {
      res.json({ answer: await req.app.locals.ai.researchAnswer(question) });
    } catch (err) {
      logAiError('research chat', null, err);
      res.status(502).json({ error: 'AI request failed — try again' });
    }
  });

  router.post('/campaigns/generate', async (req, res) => {
    if (!guard(req, res)) return;
    const fields = validateCampaignInput(req, res);
    if (!fields) return;
    const db = req.app.locals.db;
    const tpl = pickTemplate(db, req.body.template_id);
    if (!tpl) return res.status(400).json({ error: 'No template available' });
    const fullFields = campaignFields(db, fields);
    let brief = renderTemplate(tpl.body, fullFields);
    const format = req.body.output_format === 'html' ? 'html' : 'text';
    if (format === 'html') {
      if (!tpl.html_body?.trim()) return res.status(400).json({ error: 'Add an HTML template before generating HTML' });
      brief += `\n\n## HTML output\nReturn each message as complete HTML using this template. Replace {{subject}}, {{preview}}, and {{body}}; preserve the provided structure and inline styles. Return HTML only, with messages separated by <!-- MESSAGE -->.\n\n${renderTemplate(tpl.html_body, fullFields)}`;
    }
    try {
      const output = await req.app.locals.ai.generateCampaign(brief, fields.message_count, format);
      const info = db
        .prepare('INSERT INTO campaigns (kind, purpose, cta, cta_link, message_count, format, output) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('generated', fields.purpose, fields.cta, fields.cta_link, fields.message_count, format, output);
      res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      logAiError('generate campaign', null, err);
      res.status(502).json({ error: 'AI request failed — try again' });
    }
  });

  return router;
}
