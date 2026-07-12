import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createAuth } from './auth.js';
import { musicRoutes } from './routes/music.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(config = loadConfig()) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);

  const db = openDb(config.dataDir);
  const auth = createAuth(config);
  app.locals.db = db;
  app.locals.config = config;

  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.post('/api/login', auth.login);
  app.post('/api/logout', auth.logout);

  const PUBLIC = new Set(['/login.html']);
  app.use((req, res, next) => {
    if (PUBLIC.has(req.path) || req.path.startsWith('/css/')) return next();
    return auth.requireAuth(req, res, next);
  });

  app.get('/api/capabilities', (req, res) => res.json({ ai: Boolean(config.anthropicKey) }));

  app.use('/api/music', musicRoutes(config));
  // remaining panel routes are mounted here as they land (feed, notes, campaigns, tasks, ai)

  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  createApp(config).listen(config.port, () => {
    console.log(`EDMissions console on http://localhost:${config.port}`);
  });
}
