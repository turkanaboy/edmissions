import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

test('note CRUD round-trips with tags', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const created = await (await s.post('/api/notes', { body: 'Orientation ideas', tags: ['orientation'] })).json();
    assert.equal(created.body, 'Orientation ideas');
    assert.deepEqual(created.tags, ['orientation']);

    const updated = await (await s.put(`/api/notes/${created.id}`, { body: 'Orientation ideas v2', tags: ['orientation', 'housing'] })).json();
    assert.equal(updated.body, 'Orientation ideas v2');
    assert.deepEqual(updated.tags, ['orientation', 'housing']);

    assert.equal((await s.del(`/api/notes/${created.id}`)).status, 200);
    const { notes } = await (await s.get('/api/notes')).json();
    assert.equal(notes.length, 0);
    assert.equal((await s.put('/api/notes/999', { body: 'x' })).status, 404);
  } finally {
    server.close();
  }
});

test('tag filter returns only matching notes; untagged notes list under all', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    await s.post('/api/notes', { body: 'Aid deadlines', tags: ['financial aid'] });
    await s.post('/api/notes', { body: 'Housing lottery', tags: ['housing'] });
    await s.post('/api/notes', { body: 'Loose thought', tags: [] });

    const aid = await (await s.get('/api/notes?tag=' + encodeURIComponent('financial aid'))).json();
    assert.equal(aid.notes.length, 1);
    assert.equal(aid.notes[0].body, 'Aid deadlines');

    const all = await (await s.get('/api/notes')).json();
    assert.equal(all.notes.length, 3);
  } finally {
    server.close();
  }
});

test('add-to-notes contract: note carries article title, link, excerpt, and reference', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const db = app.locals.db;
    const info = db
      .prepare('INSERT INTO articles (source, title, link, excerpt, score) VALUES (?, ?, ?, ?, ?)')
      .run('Inside Higher Ed', 'Yield melts in June', 'https://ex.com/melt', 'Summer melt hits records.', 6);
    const articleId = Number(info.lastInsertRowid);

    // the client composes exactly this shape when the user hits "+" on an article
    const prefill = `Yield melts in June\nhttps://ex.com/melt\n\n> Summer melt hits records.\n\nMy notes:\n`;
    const note = await (await s.post('/api/notes', { body: prefill, tags: [], article_id: articleId })).json();

    assert.ok(note.body.includes('Yield melts in June'));
    assert.ok(note.body.includes('https://ex.com/melt'));
    assert.ok(note.body.includes('Summer melt hits records.'));
    assert.equal(note.article_id, articleId);
    assert.equal(note.article_title, 'Yield melts in June');
    assert.equal(note.article_link, 'https://ex.com/melt');
  } finally {
    server.close();
  }
});

test('empty body is rejected', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    assert.equal((await s.post('/api/notes', { tags: ['admissions'] })).status, 400);
  } finally {
    server.close();
  }
});
