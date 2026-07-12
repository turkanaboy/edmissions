import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { pollOnce } from '../server/poller.js';
import { bootApp, login, stubFetch } from './helpers.js';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title>
<item><title>FAFSA delays reshape yield models</title><link>https://ex.com/fafsa</link><description>Financial aid timelines slip.</description><pubDate>Wed, 08 Jul 2026 10:00:00 GMT</pubDate></item>
<item><title>New dining hall opens downtown</title><link>https://ex.com/dining</link><description>Tasty.</description></item>
</channel></rss>`;

const testConfig = (feeds) => ({
  pollMinutes: 20,
  content: {
    feeds,
    keywords: ['enrollment', 'fafsa', 'yield', 'financial aid'],
  },
});

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'edm-poll-')));

test('one failing source never blocks the others', async () => {
  const db = freshDb();
  const config = testConfig([
    { name: 'Dead Feed', url: 'https://dead.example.com/rss' },
    { name: 'Live Feed', url: 'https://live.example.com/rss' },
  ]);
  const restore = stubFetch(
    (url) => url.includes('example.com'),
    (url) => {
      if (url.includes('dead')) throw new Error('connection refused');
      return new Response(RSS, { headers: { 'Content-Type': 'application/rss+xml' } });
    }
  );
  try {
    const r = await pollOnce(db, config);
    assert.equal(r.added, 2);
    assert.equal(r.failed.length, 1);
    assert.equal(r.failed[0].feed, 'Dead Feed');
    const rows = db.prepare('SELECT * FROM articles ORDER BY score DESC').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].title, 'FAFSA delays reshape yield models');
    assert.ok(rows[0].score > rows[1].score);
  } finally {
    restore();
    db.close();
  }
});

test('duplicate links across polls store once', async () => {
  const db = freshDb();
  const config = testConfig([{ name: 'Live', url: 'https://live.example.com/rss' }]);
  const restore = stubFetch(
    (url) => url.includes('example.com'),
    () => new Response(RSS)
  );
  try {
    assert.equal((await pollOnce(db, config)).added, 2);
    assert.equal((await pollOnce(db, config)).added, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 2);
  } finally {
    restore();
    db.close();
  }
});

test('star toggle persists and starred filter works via the API', async () => {
  const { server, base, config } = bootApp();
  const restore = stubFetch(
    (url) => url.includes('example.com'),
    () => new Response(RSS)
  );
  try {
    const s = await login(base);
    config.content.feeds = [{ name: 'Live', url: 'https://live.example.com/rss' }];
    await s.post('/api/articles/poll', {});
    const { articles } = await (await s.get('/api/articles')).json();
    assert.equal(articles.length, 2);

    const starred = await (await s.post(`/api/articles/${articles[0].id}/star`, {})).json();
    assert.equal(starred.starred, 1);
    let list = await (await s.get('/api/articles?starred=1')).json();
    assert.equal(list.articles.length, 1);
    assert.equal(list.articles[0].id, articles[0].id);

    const unstarred = await (await s.post(`/api/articles/${articles[0].id}/star`, {})).json();
    assert.equal(unstarred.starred, 0);
    list = await (await s.get('/api/articles?starred=1')).json();
    assert.equal(list.articles.length, 0);

    assert.equal((await s.post('/api/articles/999/star', {})).status, 404);
  } finally {
    restore();
    server.close();
  }
});

test('stored articles carry excerpt only, never full text', async () => {
  const db = freshDb();
  const big = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
<item><title>Enrollment story</title><link>https://ex.com/big</link><description>${'word '.repeat(500)}</description></item>
</channel></rss>`;
  const config = testConfig([{ name: 'Big', url: 'https://big.example.com/rss' }]);
  const restore = stubFetch(
    (url) => url.includes('example.com'),
    () => new Response(big)
  );
  try {
    await pollOnce(db, config);
    const row = db.prepare('SELECT excerpt FROM articles').get();
    assert.ok(row.excerpt.length <= 400);
  } finally {
    restore();
    db.close();
  }
});
