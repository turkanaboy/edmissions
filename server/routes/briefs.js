import { Router } from 'express';
import { normalizeSourceContext, parseSourceContext } from './campaigns.js';

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
