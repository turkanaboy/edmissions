import { Router } from 'express';

export function seedTemplates(db, config) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM campaign_templates').get();
  if (n === 0 && config.content.defaultCampaignTemplate) {
    db.prepare('INSERT INTO campaign_templates (name, body) VALUES (?, ?)').run(
      'Default handoff',
      config.content.defaultCampaignTemplate
    );
  }
}

export function renderTemplate(body, fields) {
  let out = String(body);
  for (const [k, v] of Object.entries(fields)) out = out.replaceAll(`{{${k}}}`, String(v));
  return out;
}

export function validateCampaignInput(req, res) {
  const { purpose, cta, cta_link, message_count } = req.body || {};
  const count = Number(message_count);
  if (!purpose || !cta || !cta_link) {
    res.status(400).json({ error: 'Purpose, call to action, and CTA link are all required' });
    return null;
  }
  try {
    new URL(cta_link);
  } catch {
    res.status(400).json({ error: 'CTA link must be a valid URL' });
    return null;
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    res.status(400).json({ error: 'Message count must be between 1 and 20' });
    return null;
  }
  return { purpose, cta, cta_link, message_count: count };
}

export function campaignRoutes() {
  const router = Router();

  // template routes registered before /:id so "templates" never matches as an id
  router.get('/templates', (req, res) => {
    res.json({ templates: req.app.locals.db.prepare('SELECT * FROM campaign_templates ORDER BY id').all() });
  });

  router.post('/templates', (req, res) => {
    const { name, body } = req.body || {};
    if (!name || !body) return res.status(400).json({ error: 'Template name and body are required' });
    const db = req.app.locals.db;
    const info = db.prepare('INSERT INTO campaign_templates (name, body) VALUES (?, ?)').run(name, body);
    res.status(201).json(db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/templates/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such template' });
    const { name = existing.name, body = existing.body } = req.body || {};
    db.prepare('UPDATE campaign_templates SET name = ?, body = ? WHERE id = ?').run(name, body, req.params.id);
    res.json(db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.params.id));
  });

  router.get('/', (req, res) => {
    res.json({ campaigns: req.app.locals.db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 200').all() });
  });

  router.post('/brief', (req, res) => {
    const fields = validateCampaignInput(req, res);
    if (!fields) return;
    const db = req.app.locals.db;
    const tpl = req.body.template_id
      ? db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.body.template_id)
      : db.prepare('SELECT * FROM campaign_templates ORDER BY id LIMIT 1').get();
    if (!tpl) return res.status(400).json({ error: 'No template available' });
    const output = renderTemplate(tpl.body, fields);
    const info = db
      .prepare('INSERT INTO campaigns (kind, purpose, cta, cta_link, message_count, output) VALUES (?, ?, ?, ?, ?, ?)')
      .run('brief', fields.purpose, fields.cta, fields.cta_link, fields.message_count, output);
    res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such campaign' });
    res.json({ ok: true });
  });

  return router;
}
