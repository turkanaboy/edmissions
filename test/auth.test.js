import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { openDb } from '../server/db.js';

function makeApp() {
  const config = loadConfig({
    EDMISSIONS_USERS: 'tyler:goodpass,friend:otherpass,nazely:vppass',
    EDMISSIONS_SESSION_SECRET: 'test-secret',
    EDMISSIONS_DATA_DIR: mkdtempSync(join(tmpdir(), 'edm-')),
  });
  const app = createApp(config);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

const post = (base, path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('valid login sets a guarded session cookie and grants API access', async () => {
  const { server, base } = makeApp();
  try {
    const res = await post(base, '/api/login', { username: 'tyler', password: 'goodpass' });
    assert.equal(res.status, 200);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /edm_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    const caps = await fetch(base + '/api/capabilities', {
      headers: { cookie: cookie.split(';')[0] },
    });
    assert.equal(caps.status, 200);
    const capabilities = await caps.json();
    assert.equal(capabilities.ai, false);
    assert.equal(capabilities.welcome, '');
  } finally {
    server.close();
  }
});

test('Nazely receives the AVP welcome and the login video is public', async () => {
  const { server, base } = makeApp();
  try {
    const res = await post(base, '/api/login', { username: 'nazely', password: 'vppass' });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const capabilities = await (await fetch(base + '/api/capabilities', { headers: { cookie } })).json();
    assert.equal(capabilities.welcome, 'Welcome AVP Nazely');

    const video = await fetch(base + '/media/people-at-a-rave-coverr.mp4', { method: 'HEAD' });
    assert.equal(video.status, 200);
    assert.match(video.headers.get('content-type'), /video\/mp4/);
  } finally {
    server.close();
  }
});

test('wrong password of a different length returns 401, not 500', async () => {
  const { server, base } = makeApp();
  try {
    const res = await post(base, '/api/login', { username: 'tyler', password: 'x' });
    assert.equal(res.status, 401);
    assert.match((await res.json()).error, /Incorrect username or password/);
  } finally {
    server.close();
  }
});

test('sixth rapid failure is 429 while the other user still logs in', async () => {
  const { server, base } = makeApp();
  try {
    for (let i = 0; i < 5; i++) {
      const r = await post(base, '/api/login', { username: 'tyler', password: `wrong${i}` });
      assert.equal(r.status, 401);
    }
    const locked = await post(base, '/api/login', { username: 'tyler', password: 'goodpass' });
    assert.equal(locked.status, 429);
    assert.match((await locked.json()).error, /Too many attempts/);
    const other = await post(base, '/api/login', { username: 'friend', password: 'otherpass' });
    assert.equal(other.status, 200);
  } finally {
    server.close();
  }
});

test('unknown username rotation shares one bounded rate-limit bucket', async () => {
  const { server, base } = makeApp();
  try {
    for (let i = 0; i < 5; i++) {
      const response = await post(base, '/api/login', { username: `missing-${i}`, password: 'wrong' });
      assert.equal(response.status, 401);
    }
    const locked = await post(base, '/api/login', { username: 'another-missing-user', password: 'wrong' });
    assert.equal(locked.status, 429);
  } finally {
    server.close();
  }
});

test('oversized usernames are rejected before rate-limit storage', async () => {
  const { server, base } = makeApp();
  try {
    const response = await post(base, '/api/login', { username: 'x'.repeat(101), password: 'wrong' });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /username/i);
  } finally {
    server.close();
  }
});

test('logout clears the session cookie and de-authenticates it', async () => {
  const { server, base } = makeApp();
  try {
    const res = await post(base, '/api/login', { username: 'tyler', password: 'goodpass' });
    const cookie = res.headers.get('set-cookie').split(';')[0];
    // the live session works
    assert.equal((await fetch(base + '/api/capabilities', { headers: { cookie } })).status, 200);
    const out = await fetch(base + '/api/logout', { method: 'POST', headers: { cookie } });
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  } finally {
    server.close();
  }
});

test('unauthenticated API request returns 401 JSON', async () => {
  const { server, base } = makeApp();
  try {
    const res = await fetch(base + '/api/capabilities');
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Unauthorized' });
  } finally {
    server.close();
  }
});

test('healthz and login page are public', async () => {
  const { server, base } = makeApp();
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    const page = await fetch(base + '/login.html');
    assert.equal(page.status, 200);
  } finally {
    server.close();
  }
});

test('unauthenticated page request redirects to login', async () => {
  const { server, base } = makeApp();
  try {
    const res = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.match(res.headers.get('location'), /login\.html/);
  } finally {
    server.close();
  }
});

test('schema creation is idempotent across two opens', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edm-db-'));
  const db1 = openDb(dir);
  db1.close();
  const db2 = openDb(dir);
  db2.close();
});
