import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { musicRoutes } from './routes/music.js';
import { feedRoutes } from './routes/feed.js';
import { notesRoutes } from './routes/notes.js';
import { campaignRoutes, seedTemplates } from './routes/campaigns.js';
import { taskRoutes } from './routes/tasks.js';
import { aiRoutes } from './routes/ai.js';
import { createAi } from './openai.js';
import { startPolling } from './poller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config = loadConfig()) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  const db = openDb(config.dataDir);
  seedTemplates(db, config);
  const auth = createAuth(config);
  app.locals.db = db;
  app.locals.config = config;
  app.locals.ai = createAi(config);

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get(); // fail the Docker health check if the DB is unreadable
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });
  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);

  const PUBLIC = new Set(['/login.html', '/favicon.svg']);
  app.use((req, res, next) => {
    if (PUBLIC.has(req.path) || req.path.startsWith('/css/') || req.path.startsWith('/media/')) return next();
    return auth.requireAuth(req, res, next);
  });

  app.get('/api/capabilities', (req, res) =>
    res.json({
      ai: Boolean(config.openAiKey),
      subjects: config.content.subjects,
      welcome: req.user.toLowerCase() === 'nazely' ? 'Welcome AVP Nazely' : '',
    })
  );

  app.use('/api/music', musicRoutes(config));
  app.use('/api/articles', feedRoutes());
  app.use('/api/notes', notesRoutes());
  app.use('/api/campaigns', campaignRoutes());
  app.use('/api/tasks', taskRoutes());
  app.use('/api', aiRoutes());

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Central handler: any thrown/rejected route error becomes a clean 502 instead of
  // Express 5's default, which leaks a stack trace whenever NODE_ENV isn't 'production'.
  app.use((err, req, res, next) => {
    console.error(`[server] ${req.method} ${req.path}: ${err.message || err}`);
    if (res.headersSent) return next(err);
    res.status(502).json({ error: 'Something went wrong' });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`EDMissions console on http://localhost:${config.port}`);
  });
  startPolling(app.locals.db, config); // polling belongs to the real process, not tests
}
