import { Router } from 'express';
import { pollOnce } from '../poller.js';

export function feedRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const starredOnly = req.query.starred === '1';
    // ponytail: 14-day window keeps score-first ranking from pinning stale wins forever;
    // starred items are exempt so the star list is permanent
    const rows = starredOnly
      ? db.prepare('SELECT * FROM articles WHERE starred = 1 ORDER BY score DESC, COALESCE(published_at, created_at) DESC LIMIT 200').all()
      : db
          .prepare(
            "SELECT * FROM articles WHERE created_at > datetime('now', '-14 days') ORDER BY score DESC, COALESCE(published_at, created_at) DESC LIMIT 100"
          )
          .all();
    res.json({ articles: rows });
  });

  router.post('/:id/star', (req, res) => {
    const db = req.app.locals.db;
    const info = db.prepare('UPDATE articles SET starred = 1 - starred WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such article' });
    res.json(db.prepare('SELECT id, starred FROM articles WHERE id = ?').get(req.params.id));
  });

  router.post('/poll', async (req, res) => {
    res.json(await pollOnce(req.app.locals.db, req.app.locals.config));
  });

  return router;
}
