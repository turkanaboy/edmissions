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

test('AVP Brief assembles selected sources, open tasks, upcoming moments, and campaign work', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const article = app.locals.db.prepare(
      'INSERT INTO articles (source, title, link, excerpt, published_at, lane) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(
      'SUNY Delhi',
      'Applied learning partnership',
      'https://www.delhi.edu/news/partnership/',
      'A regional employer joins the program.',
      new Date().toISOString(),
      'campus'
    );
    const selection = await (await s.post('/api/brief-selections', {
      body: 'A regional employer joins the program.',
      source_context: SOURCE,
    })).json();
    const task = await (await s.post('/api/tasks', {
      text: 'Decide whether to feature the partnership',
      source_context: SOURCE,
    })).json();
    const futureDate = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    app.locals.db.prepare(
      `INSERT INTO enrollment_moments
       (name, moment_date, audience, lead_days, channels, notes, source_url, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'Future deposit checkpoint',
      futureDate,
      'Accepted students',
      21,
      '["email"]',
      'Prepare a deposit reminder.',
      'https://www.delhi.edu/admission/accepted/',
      '2026-07-30'
    );
    await s.post('/api/campaigns/brief', {
      purpose: 'Partnership awareness',
      cta: 'Explore programs',
      cta_link: 'https://www.delhi.edu/academics/majors-programs/',
      message_count: 2,
      source_context: SOURCE,
    });

    const assembled = await (await s.get('/api/brief')).json();
    assert.match(assembled.markdown, /applied learning partnership/i);
    assert.match(assembled.markdown, /https:\/\/www\.delhi\.edu\/news\/partnership\//);
    assert.match(assembled.markdown, /Decide whether to feature the partnership/);
    assert.match(assembled.markdown, /Future deposit checkpoint/);
    assert.match(assembled.markdown, /Partnership awareness/);
    assert.match(assembled.assembled_at, /^\d{4}-\d{2}-\d{2}T/);

    await s.del(`/api/brief-selections/${selection.id}`);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM articles WHERE id = ?').get(article.lastInsertRowid).n, 1);

    await s.put(`/api/tasks/${task.id}`, { done: true });
    const refreshed = await (await s.get('/api/brief')).json();
    assert.doesNotMatch(refreshed.markdown, /Decide whether to feature the partnership/);
  } finally {
    server.close();
  }
});

test('AVP Brief renders URL-less selections as plain text and stays authenticated', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    await s.post('/api/brief-selections', {
      body: 'Lead with flexible planning.',
      source_context: { title: 'Adult learner research response', excerpt: 'No external source was supplied.' },
    });
    const assembled = await (await s.get('/api/brief')).json();
    assert.match(assembled.markdown, /Adult learner research response/);
    assert.doesNotMatch(assembled.markdown, /\[\]\(\)|javascript:/);
    assert.equal((await fetch(base + '/api/brief')).status, 401);
  } finally {
    server.close();
  }
});
