import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

const SOURCE = {
  title: 'SUNY Delhi adds an applied learning partnership',
  publisher: 'SUNY Delhi',
  published_at: '2026-07-29T14:00:00.000Z',
  url: 'https://www.delhi.edu/news/partnership/',
  excerpt: 'A new regional partnership expands hands-on learning.',
  lane: 'campus',
};

test('source context survives Notes, Tasks, and AVP Brief handoffs', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const note = await (await s.post('/api/notes', {
      body: `${SOURCE.title}\n${SOURCE.url}`,
      tags: ['admissions'],
      source_context: SOURCE,
    })).json();
    const task = await (await s.post('/api/tasks', {
      text: `Review: ${SOURCE.title}`,
      source_context: SOURCE,
    })).json();
    const brief = await (await s.post('/api/brief-selections', {
      body: SOURCE.excerpt,
      source_context: SOURCE,
    })).json();

    assert.deepEqual(note.source_context, SOURCE);
    assert.deepEqual(task.source_context, SOURCE);
    assert.deepEqual(brief.source_context, SOURCE);

    const queued = await (await s.get('/api/brief-selections')).json();
    assert.equal(queued.selections.length, 1);
    assert.equal(queued.selections[0].source_context.url, SOURCE.url);

    assert.equal((await s.del(`/api/brief-selections/${brief.id}`)).status, 200);
    assert.equal((await s.del(`/api/brief-selections/${brief.id}`)).status, 404);
  } finally {
    server.close();
  }
});

test('workbench APIs stay authenticated and reject unsafe source URLs', async () => {
  const { server, base } = bootApp();
  try {
    for (const path of ['/api/notes', '/api/tasks', '/api/brief-selections']) {
      assert.equal((await fetch(base + path)).status, 401);
    }
    const s = await login(base);
    const unsafe = { source_context: { title: 'Bad', url: 'javascript:alert(1)' } };
    assert.equal((await s.post('/api/notes', { body: 'Bad', ...unsafe })).status, 400);
    assert.equal((await s.post('/api/tasks', { text: 'Bad', ...unsafe })).status, 400);
    assert.equal((await s.post('/api/brief-selections', { body: 'Bad', ...unsafe })).status, 400);
  } finally {
    server.close();
  }
});
