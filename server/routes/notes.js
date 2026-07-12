import { Router } from 'express';

const JOIN = `
  SELECT n.*, a.title AS article_title, a.link AS article_link
  FROM notes n LEFT JOIN articles a ON a.id = n.article_id
`;
const parseNote = (row) => ({ ...row, tags: JSON.parse(row.tags || '[]') });

export function notesRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    let notes = db
      .prepare(`${JOIN} ORDER BY n.updated_at DESC, n.id DESC LIMIT 500`)
      .all()
      .map(parseNote);
    if (req.query.tag) notes = notes.filter((n) => n.tags.includes(req.query.tag));
    res.json({ notes });
  });

  router.post('/', (req, res) => {
    const db = req.app.locals.db;
    const { body, tags = [], article_id = null } = req.body || {};
    if (!body || typeof body !== 'string') return res.status(400).json({ error: 'Note body is required' });
    const info = db
      .prepare('INSERT INTO notes (body, tags, article_id) VALUES (?, ?, ?)')
      .run(body, JSON.stringify(tags), article_id);
    const row = db.prepare(`${JOIN} WHERE n.id = ?`).get(info.lastInsertRowid);
    res.status(201).json(parseNote(row));
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such note' });
    const { body = existing.body, tags } = req.body || {};
    const tagsJson = tags === undefined ? existing.tags : JSON.stringify(tags);
    db.prepare("UPDATE notes SET body = ?, tags = ?, updated_at = datetime('now') WHERE id = ?").run(
      body,
      tagsJson,
      req.params.id
    );
    res.json(parseNote(db.prepare(`${JOIN} WHERE n.id = ?`).get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such note' });
    res.json({ ok: true });
  });

  return router;
}
