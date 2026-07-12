import { Router } from 'express';

export function taskRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      tasks: req.app.locals.db.prepare('SELECT * FROM tasks ORDER BY done ASC, id DESC').all(),
    });
  });

  router.post('/', (req, res) => {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Task text is required' });
    const db = req.app.locals.db;
    const info = db.prepare('INSERT INTO tasks (text) VALUES (?)').run(String(text).trim());
    res.status(201).json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such task' });
    const { text = existing.text, done = existing.done } = req.body || {};
    db.prepare('UPDATE tasks SET text = ?, done = ? WHERE id = ?').run(String(text), done ? 1 : 0, req.params.id);
    res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such task' });
    res.json({ ok: true });
  });

  return router;
}
