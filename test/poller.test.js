import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { keepArticleTitle, pollOnce } from '../server/poller.js';
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
    { name: 'Dead Feed', lane: 'local', url: 'https://dead.example.com/rss' },
    { name: 'Live Feed', lane: 'campus', url: 'https://live.example.com/rss' },
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
    assert.ok(rows.every((row) => row.lane === 'campus'));
    assert.equal(rows[0].title, 'FAFSA delays reshape yield models');
    assert.ok(rows[0].score > rows[1].score);
    const status = db.prepare('SELECT * FROM feed_status ORDER BY source').all();
    assert.deepEqual(status.map((item) => [item.source, item.ok]), [['Dead Feed', 0], ['Live Feed', 1]]);
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

test('a higher-priority duplicate upgrades its lane without losing its star', async () => {
  const db = freshDb();
  const national = testConfig([{ name: 'National', lane: 'national', url: 'https://national.example.com/rss' }]);
  const campus = testConfig([{ name: 'SUNY Delhi', lane: 'campus', url: 'https://campus.example.com/rss' }]);
  const restore = stubFetch((url) => url.includes('example.com'), () => new Response(RSS));
  try {
    await pollOnce(db, national);
    db.prepare('UPDATE articles SET starred = 1 WHERE link = ?').run('https://ex.com/fafsa');
    await pollOnce(db, campus);
    const row = db.prepare('SELECT source, lane, starred FROM articles WHERE link = ?').get('https://ex.com/fafsa');
    assert.deepEqual({ ...row }, { source: 'SUNY Delhi', lane: 'campus', starred: 1 });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 2);
  } finally {
    restore();
    db.close();
  }
});

test('feed polling rejects oversized bodies before parsing', async () => {
  const db = freshDb();
  const config = testConfig([{ name: 'Oversized', url: 'https://oversized.example.com/rss' }]);
  const restore = stubFetch(
    (url) => url.includes('example.com'),
    () => new Response('x'.repeat(1_000_001), { headers: { 'Content-Type': 'application/rss+xml' } })
  );
  try {
    const result = await pollOnce(db, config);
    assert.equal(result.added, 0);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error, /1 MB|too large/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 0);
  } finally {
    restore();
    db.close();
  }
});

test('feed polling caps work to the first 200 parsed items', async () => {
  const db = freshDb();
  const items = Array.from({ length: 205 }, (_, index) =>
    `<item><title>Enrollment story ${index}</title><link>https://ex.com/item-${index}</link></item>`
  ).join('');
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Many</title>${items}</channel></rss>`;
  const config = testConfig([{ name: 'Many', url: 'https://many.example.com/rss' }]);
  const restore = stubFetch((url) => url.includes('example.com'), () => new Response(rss));
  try {
    const result = await pollOnce(db, config);
    assert.equal(result.added, 200);
    assert.equal(result.failed.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM articles').get().n, 200);
  } finally {
    restore();
    db.close();
  }
});

test('job headlines require both a VP variation and enrollment', () => {
  assert.equal(keepArticleTitle('Director of Admissions job opening'), false);
  assert.equal(keepArticleTitle('Hiring a VP for Enrollment Strategy'), true);
  assert.equal(keepArticleTitle('Vice-President enrollment opportunity'), true);
  assert.equal(keepArticleTitle('Enrollment rebounds at technical colleges'), true);
});

test('local headlines exclude public notices and crime incidents', () => {
  for (const title of [
    'Public Notices | July 30, 2026',
    'Two arrests follow downtown investigation',
    'Police investigate a shooting in Delaware County',
    'Police respond to two shootings',
    'Man charged after stabbing',
    'Weekend robberies under investigation',
    'Driver arrested for DWI',
    'Burglary reported on Main Street',
  ]) {
    assert.equal(keepArticleTitle(title, 'local'), false, title);
  }
  assert.equal(keepArticleTitle('Delhi launches a new summer concert series', 'local'), true);
  assert.equal(keepArticleTitle('Arresting new art exhibit opens downtown', 'local'), true);
  assert.equal(keepArticleTitle('Campus public-notice policy updated', 'campus'), true);
});

test('local exclusions are dropped before articles are stored', async () => {
  const db = freshDb();
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Local</title>
<item><title>Public Notices | July 30</title><link>https://ex.com/notices</link></item>
<item><title>Driver arrested for DWI</title><link>https://ex.com/dwi</link></item>
<item><title>Delhi launches a summer concert series</title><link>https://ex.com/concert</link></item>
</channel></rss>`;
  const config = testConfig([{ name: 'Local', lane: 'local', url: 'https://local.example.com/rss' }]);
  const restore = stubFetch((url) => url.includes('example.com'), () => new Response(rss));
  try {
    assert.equal((await pollOnce(db, config)).added, 1);
    assert.deepEqual(
      db.prepare('SELECT title FROM articles').all().map((row) => row.title),
      ['Delhi launches a summer concert series']
    );
  } finally {
    restore();
    db.close();
  }
});

test('feed ranks recent enrollment first and excludes stale publication dates', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const db = app.locals.db;
    db.prepare('INSERT INTO articles (source, title, link, published_at, score) VALUES (?, ?, ?, ?, ?)').run('Test', 'Fresh campus news', 'https://ex.com/fresh', new Date().toISOString(), 0);
    db.prepare('INSERT INTO articles (source, title, link, published_at, score) VALUES (?, ?, ?, ?, ?)').run('Test', 'Enrollment update', 'https://ex.com/enrollment', new Date(Date.now() - 2 * 864e5).toISOString(), 3);
    db.prepare('INSERT INTO articles (source, title, link, published_at, score) VALUES (?, ?, ?, ?, ?)').run('Test', 'Old enrollment story', 'https://ex.com/old', '2020-01-01T00:00:00.000Z', 20);
    const { articles } = await (await s.get('/api/articles')).json();
    assert.equal(articles[0].title, 'Enrollment update');
    assert.ok(!articles.some((a) => a.title === 'Old enrollment story'));
  } finally {
    server.close();
  }
});

test('after the seven-day enrollment gate, source lane and date determine rank', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const db = app.locals.db;
    const now = new Date().toISOString();
    const eightDaysAgo = new Date(Date.now() - 8 * 864e5).toISOString();
    const insert = db.prepare(
      'INSERT INTO articles (source, title, link, published_at, score, lane) VALUES (?, ?, ?, ?, ?, ?)'
    );
    insert.run('National', 'Enrollment outlook', 'https://ex.com/old-enrollment', eightDaysAgo, 20, 'national');
    insert.run('National', 'Fresh national item', 'https://ex.com/national', now, 0, 'national');
    insert.run('Local', 'Fresh local item', 'https://ex.com/local', now, 0, 'local');
    insert.run('Local', 'Public Notices | July 30', 'https://ex.com/notices', now, 0, 'local');
    insert.run('Local', 'Police investigate a shooting', 'https://ex.com/shooting', now, 0, 'local');
    const { articles } = await (await s.get('/api/articles')).json();
    assert.deepEqual(articles.slice(0, 3).map((article) => article.title), [
      'Fresh local item',
      'Fresh national item',
      'Enrollment outlook',
    ]);
    const local = await (await s.get('/api/articles?lane=local')).json();
    assert.deepEqual(local.articles.map((article) => article.title), ['Fresh local item']);
  } finally {
    server.close();
  }
});
