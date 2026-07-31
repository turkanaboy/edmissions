import { Router } from 'express';
import { normalizeSourceContext, parseSourceContext } from './campaigns.js';

export const NOTE_JOIN = `
  SELECT n.*, a.title AS article_title, a.link AS article_link
  FROM notes n LEFT JOIN articles a ON a.id = n.article_id
`;
export const parseNote = (row) => ({
  ...row,
  tags: JSON.parse(row.tags || '[]'),
  source_context: parseSourceContext(row.source_context),
});

export function notesRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    let notes = db
      .prepare(`${NOTE_JOIN} ORDER BY n.updated_at DESC, n.id DESC LIMIT 500`)
      .all()
      .map(parseNote);
    if (req.query.tag) notes = notes.filter((n) => n.tags.includes(req.query.tag));
    res.json({ notes });
  });

  router.post('/', (req, res) => {
    const db = req.app.locals.db;
    const { body, tags = [], article_id = null } = req.body || {};
    if (!body || typeof body !== 'string') return res.status(400).json({ error: 'Note body is required' });
    let source;
    try {
      source = normalizeSourceContext(req.body?.source_context);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const info = db
      .prepare('INSERT INTO notes (body, tags, article_id, source_context) VALUES (?, ?, ?, ?)')
      .run(body, JSON.stringify(tags), article_id, JSON.stringify(source));
    const row = db.prepare(`${NOTE_JOIN} WHERE n.id = ?`).get(info.lastInsertRowid);
    res.status(201).json(parseNote(row));
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such note' });
    const { body = existing.body, tags } = req.body || {};
    const tagsJson = tags === undefined ? existing.tags : JSON.stringify(tags);
    let source;
    try {
      source = req.body?.source_context === undefined
        ? parseSourceContext(existing.source_context)
        : normalizeSourceContext(req.body.source_context);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    db.prepare("UPDATE notes SET body = ?, tags = ?, source_context = ?, updated_at = datetime('now') WHERE id = ?").run(
      body,
      tagsJson,
      JSON.stringify(source),
      req.params.id
    );
    res.json(parseNote(db.prepare(`${NOTE_JOIN} WHERE n.id = ?`).get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such note' });
    res.json({ ok: true });
  });

  return router;
}
