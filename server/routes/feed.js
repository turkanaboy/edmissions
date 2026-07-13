import { Router } from 'express';
import { keepArticleTitle, pollOnce } from '../poller.js';

export function feedRoutes() {
  const router = Router();

  router.get('/', (req, res) => {
    const db = req.app.locals.db;
    const starredOnly = req.query.starred === '1';
    // ponytail: one query plus a tiny in-process title filter avoids a second job-classification system.
    const rows = (starredOnly
      ? db.prepare('SELECT * FROM articles WHERE starred = 1 ORDER BY score DESC, COALESCE(published_at, created_at) DESC LIMIT 200').all()
      : db
          .prepare(
            `SELECT * FROM articles
             WHERE datetime(published_at) >= datetime('now', '-30 days')
                OR (published_at IS NULL AND created_at >= datetime('now', '-7 days'))
             ORDER BY
               CASE WHEN score > 0 AND datetime(published_at) >= datetime('now', '-7 days') THEN 0 ELSE 1 END,
               published_at IS NULL,
               datetime(COALESCE(published_at, created_at)) DESC
             LIMIT 300`
          )
          .all())
      .filter((article) => keepArticleTitle(article.title))
      .slice(0, starredOnly ? 200 : 100);
    res.json({ articles: rows });
  });

  router.post('/:id/star', (req, res) => {
    const db = req.app.locals.db;
    const info = db.prepare('UPDATE articles SET starred = 1 - starred WHERE id = ?').run(req.params.id);
    if (!Number(info.changes)) return res.status(404).json({ error: 'No such article' });
    res.json(db.prepare('SELECT id, starred FROM articles WHERE id = ?').get(req.params.id));
  });

  router.post('/poll', async (req, res) => {
    try {
      res.json(await pollOnce(req.app.locals.db, req.app.locals.config));
    } catch (err) {
      console.error(`[feed] manual poll failed: ${err.message || err}`);
      res.status(502).json({ error: 'Feed poll failed' });
    }
  });

  return router;
}
