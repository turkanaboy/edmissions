import { Router } from 'express';
import { normalizeSourceContext, parseSourceContext } from './campaigns.js';

const taskRecord = (row) => row ? { ...row, source_context: parseSourceContext(row.source_context) } : null;

export function taskRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    res.json({
      tasks: req.app.locals.db.prepare('SELECT * FROM tasks ORDER BY done ASC, id DESC').all().map(taskRecord),
    });
  });

  router.post('/', (req, res) => {
    const { text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'Task text is required' });
    let source;
    try {
      source = normalizeSourceContext(req.body?.source_context);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const db = req.app.locals.db;
    const info = db.prepare('INSERT INTO tasks (text, source_context) VALUES (?, ?)').run(String(text).trim(), JSON.stringify(source));
    res.status(201).json(taskRecord(db.prepare('SELECT * FROM tasks WHERE id = ?').get(info.lastInsertRowid)));
  });

  router.put('/:id', (req, res) => {
    const db = req.app.locals.db;
    const existing = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'No such task' });
    const { text = existing.text, done = existing.done } = req.body || {};
    let source;
    try {
      source = req.body?.source_context === undefined
        ? parseSourceContext(existing.source_context)
        : normalizeSourceContext(req.body.source_context);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    db.prepare('UPDATE tasks SET text = ?, done = ?, source_context = ? WHERE id = ?')
      .run(String(text), done ? 1 : 0, JSON.stringify(source), req.params.id);
    res.json(taskRecord(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const info = req.app.locals.db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such task' });
    res.json({ ok: true });
  });

  return router;
}
