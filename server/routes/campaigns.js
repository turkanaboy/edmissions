import { Router } from 'express';

export function seedTemplates(db, config) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM campaign_templates').get();
  if (n === 0 && config.content.defaultCampaignTemplate) {
    db.prepare('INSERT INTO campaign_templates (name, body) VALUES (?, ?)').run(
      'Default handoff',
      config.content.defaultCampaignTemplate
    );
  }
  const campus = config.content.defaultCampus;
  if (campus) {
    const existing = db.prepare('SELECT name, facts FROM campus_profile WHERE id = 1').get();
    const values = [campus.name, campus.type, campus.location, campus.audience, campus.voice, campus.facts];
    if (!existing) {
      db.prepare(
        'INSERT INTO campus_profile (id, name, type, location, audience, voice, facts) VALUES (1, ?, ?, ?, ?, ?, ?)'
      ).run(...values);
    } else if (
      existing.name === 'Example Technical College' &&
      existing.facts.startsWith('Replace this seed')
    ) {
      // Upgrade only the original placeholder; preserve any campus memory the user edited.
      db.prepare(
        'UPDATE campus_profile SET name = ?, type = ?, location = ?, audience = ?, voice = ?, facts = ? WHERE id = 1'
      ).run(...values);
    }
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

export function pickTemplate(db, templateId) {
  return templateId
    ? db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(templateId)
    : db.prepare('SELECT * FROM campaign_templates ORDER BY id LIMIT 1').get();
}

export function campusContext(db) {
  const campus = db.prepare('SELECT * FROM campus_profile WHERE id = 1').get();
  return campus
    ? `Name: ${campus.name}\nType: ${campus.type}\nLocation: ${campus.location}\nAudience: ${campus.audience}\nVoice: ${campus.voice}\nApproved facts: ${campus.facts}`
    : 'No campus profile supplied.';
}

export function campaignFields(db, fields) {
  return { ...fields, campus: campusContext(db) };
}

export function campaignRoutes() {
  const router = Router();

  router.get('/campus', (req, res) => {
    res.json({ campus: req.app.locals.db.prepare('SELECT * FROM campus_profile WHERE id = 1').get() || null });
  });

  router.put('/campus', (req, res) => {
    const fields = ['name', 'type', 'location', 'audience', 'voice', 'facts'];
    const values = fields.map((field) => String(req.body?.[field] || '').trim());
    if (!values[0]) return res.status(400).json({ error: 'Campus name is required' });
    const db = req.app.locals.db;
    db.prepare(
      `INSERT INTO campus_profile (id, name, type, location, audience, voice, facts)
       VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, location=excluded.location,
       audience=excluded.audience, voice=excluded.voice, facts=excluded.facts`
    ).run(...values);
    res.json(db.prepare('SELECT * FROM campus_profile WHERE id = 1').get());
  });

  // template routes registered before /:id so "templates" never matches as an id
  router.get('/templates', (req, res) => {
    res.json({ templates: req.app.locals.db.prepare('SELECT * FROM campaign_templates ORDER BY id').all() });
  });

  router.post('/templates', (req, res) => {
    const { name, body, html_body = '' } = req.body || {};
    if (!name || !body) return res.status(400).json({ error: 'Template name and body are required' });
    const db = req.app.locals.db;
    const info = db.prepare('INSERT INTO campaign_templates (name, body, html_body) VALUES (?, ?, ?)').run(name, body, html_body);
    res.status(201).json(db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/templates/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such template' });
    const { name = existing.name, body = existing.body, html_body = existing.html_body } = req.body || {};
    db.prepare('UPDATE campaign_templates SET name = ?, body = ?, html_body = ? WHERE id = ?').run(name, body, html_body, req.params.id);
    res.json(db.prepare('SELECT * FROM campaign_templates WHERE id = ?').get(req.params.id));
  });

  router.get('/', (req, res) => {
    res.json({ campaigns: req.app.locals.db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 200').all() });
  });

  router.post('/brief', (req, res) => {
    const fields = validateCampaignInput(req, res);
    if (!fields) return;
    const db = req.app.locals.db;
    const tpl = pickTemplate(db, req.body.template_id);
    if (!tpl) return res.status(400).json({ error: 'No template available' });
    const output = renderTemplate(tpl.body, campaignFields(db, fields));
    const info = db
      .prepare('INSERT INTO campaigns (kind, purpose, cta, cta_link, message_count, format, output) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('brief', fields.purpose, fields.cta, fields.cta_link, fields.message_count, 'brief', output);
    res.status(201).json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(info.lastInsertRowid));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such campaign' });
    res.json({ ok: true });
  });

  return router;
}
