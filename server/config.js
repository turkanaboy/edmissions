import { readFileSync } from 'node:fs';

export function loadConfig(env = process.env) {
  const required = (name) => {
    const v = env[name];
    if (!v) throw new Error(`Missing required env var ${name}`);
    return v;
  };

  const users = required('EDMISSIONS_USERS').split(',').map((pair) => {
    const i = pair.indexOf(':');
    if (i < 1) throw new Error('EDMISSIONS_USERS must be "user:pass,user2:pass2"');
    return { username: pair.slice(0, i).trim(), password: pair.slice(i + 1) };
  });

  const contentPath = env.EDMISSIONS_CONTENT_CONFIG || 'config/content.json';
  // ponytail: content config is read once at boot; restart the app to apply edits
  const content = JSON.parse(readFileSync(contentPath, 'utf8'));

  return {
    users,
    sessionSecret: required('EDMISSIONS_SESSION_SECRET'),
    port: Number(env.EDMISSIONS_PORT || 3000),
    dataDir: env.EDMISSIONS_DATA_DIR || 'data',
    musicDir: env.EDMISSIONS_MUSIC_DIR || 'data/music',
    jamendoClientId: env.EDMISSIONS_JAMENDO_CLIENT_ID || '',
    anthropicKey: env.EDMISSIONS_ANTHROPIC_KEY || '',
    pollMinutes: Number(env.EDMISSIONS_FEED_POLL_MINUTES || 20),
    trustProxy: env.EDMISSIONS_TRUST_PROXY === '1' || env.EDMISSIONS_TRUST_PROXY === 'true',
    content,
  };
}
