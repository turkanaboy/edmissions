import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/index.js';

export function bootApp(envOverrides = {}) {
  const config = loadConfig({
    EDMISSIONS_USERS: 'tyler:goodpass',
    EDMISSIONS_SESSION_SECRET: 'test-secret',
    EDMISSIONS_DATA_DIR: mkdtempSync(join(tmpdir(), 'edm-')),
    ...envOverrides,
  });
  const app = createApp(config);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, config, app };
}

export async function login(base) {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tyler', password: 'goodpass' }),
  });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return {
    cookie,
    get: (path) => fetch(base + path, { headers: { cookie } }),
    getRaw: (path, extra = {}) => fetch(base + path, { ...extra, headers: { cookie, ...(extra.headers || {}) } }),
    post: (path, body) =>
      fetch(base + path, {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    put: (path, body) =>
      fetch(base + path, {
        method: 'PUT',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    del: (path) => fetch(base + path, { method: 'DELETE', headers: { cookie } }),
  };
}

export function makeMusicDir(files = ['sunset drive.mp3', 'neon rain.mp3']) {
  const dir = mkdtempSync(join(tmpdir(), 'edm-music-'));
  for (const f of files) {
    writeFileSync(join(dir, f), Buffer.from('ID3 fake audio bytes for testing '.repeat(4)));
  }
  return dir;
}

// Intercept matching outbound calls while passing everything else (e.g. localhost app
// traffic) through to the real fetch.
export function stubFetch(match, impl) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, opts) => {
    const url = String(input);
    if (match(url)) {
      try {
        return Promise.resolve(impl(url, opts));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return real(input, opts);
  };
  return () => {
    globalThis.fetch = real;
  };
}

// Intercept outbound Jamendo calls while passing localhost app traffic through untouched.
export function stubJamendo(impl) {
  const real = globalThis.fetch;
  globalThis.fetch = (input, opts) => {
    const url = String(input);
    if (url.includes('jamendo.com')) {
      try {
        return Promise.resolve(impl(url, opts));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return real(input, opts);
  };
  return () => {
    globalThis.fetch = real;
  };
}

export const jamendoEnvelope = (tracks) =>
  new Response(JSON.stringify({ headers: { status: 'success' }, results: tracks }), {
    headers: { 'Content-Type': 'application/json' },
  });

export const jamendoTrack = (id, extra = {}) => ({
  id,
  name: `Track ${id}`,
  artist_name: 'Test Artist',
  duration: 180,
  audio: `https://prod-1.jamendo.com/stream/${id}.mp3`,
  ...extra,
});
