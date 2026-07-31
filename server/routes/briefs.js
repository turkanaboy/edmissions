import { Router } from 'express';
import { campaignRecord, isWebUrl, normalizeSourceContext, parseSourceContext } from './campaigns.js';
import { momentRecord } from './moments.js';

const selectionRecord = (row) => row ? { ...row, source_context: parseSourceContext(row.source_context) } : null;

export function briefRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const selections = req.app.locals.db
      .prepare('SELECT * FROM brief_selections ORDER BY id DESC LIMIT 200')
      .all()
      .map(selectionRecord);
    res.json({ selections });
  });

  router.post('/', (req, res) => {
    const body = String(req.body?.body || '').trim();
    let source;
    try {
      source = normalizeSourceContext(req.body?.source_context);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!body && !source.title) return res.status(400).json({ error: 'Brief selection needs a title or body' });
    const db = req.app.locals.db;
    const info = db.prepare('INSERT INTO brief_selections (body, source_context) VALUES (?, ?)')
      .run(body, JSON.stringify(source));
    res.status(201).json(selectionRecord(db.prepare('SELECT * FROM brief_selections WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM brief_selections WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such brief selection' });
    res.json({ ok: true });
  });

  return router;
}

const cleanLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ').trim();
const markdownLink = (label, url) => isWebUrl(url) ? `[${cleanLine(label).replace(/[\[\]]/g, '')}](${url})` : cleanLine(label);

export function assembleBrief(db) {
  const selections = db.prepare('SELECT * FROM brief_selections ORDER BY id DESC LIMIT 100').all().map(selectionRecord);
  const tasks = db.prepare('SELECT * FROM tasks WHERE done = 0 ORDER BY id DESC LIMIT 100').all()
    .map((task) => ({ ...task, source_context: parseSourceContext(task.source_context) }));
  const moments = db.prepare(
    `SELECT * FROM enrollment_moments
     WHERE date(moment_date) >= date('now') AND date(moment_date) <= date('now', '+90 days')
     ORDER BY date(moment_date), id LIMIT 100`
  ).all().map(momentRecord);
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 10').all().map(campaignRecord);
  const assembled_at = new Date().toISOString();
  const sections = [
    '# AVP Enrollment Brief',
    `Assembled ${assembled_at}`,
    '',
    '## Selected signals and research',
    ...(selections.length ? selections.map((selection) => {
      const source = selection.source_context;
      const label = source.title || selection.body || 'Selected item';
      const detail = source.excerpt || selection.body;
      return `- ${markdownLink(label, source.url)}${detail && detail !== label ? ` — ${cleanLine(detail)}` : ''}`;
    }) : ['- Nothing selected.']),
    '',
    '## Open tasks',
    ...(tasks.length ? tasks.map((task) =>
      `- [ ] ${cleanLine(task.text)}${task.source_context.url ? ` — ${markdownLink('source', task.source_context.url)}` : ''}`
    ) : ['- No open tasks.']),
    '',
    '## Upcoming enrollment moments',
    ...(moments.length ? moments.map((moment) =>
      `- ${moment.moment_date}: ${markdownLink(moment.name, moment.source_url)}${moment.audience ? ` — ${cleanLine(moment.audience)}` : ''}`
    ) : ['- No moments in the next 90 days.']),
    '',
    '## Recent campaign work',
    ...(campaigns.length ? campaigns.map((campaign) =>
      `- ${campaign.created_at}: ${markdownLink(campaign.purpose, campaign.source_context.url)} — ${campaign.kind === 'brief' ? 'handoff brief' : campaign.format}`
    ) : ['- No campaign work yet.']),
  ];
  return { assembled_at, selections, tasks, moments, campaigns, markdown: sections.join('\n') };
}

export function briefAssemblyRoutes() {
  const router = Router();
  router.get('/', (req, res) => res.json(assembleBrief(req.app.locals.db)));
  return router;
}
