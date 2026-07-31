import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';
import { seedMoments } from '../server/routes/moments.js';
import { normalizeMomentSource } from '../public/js/source-context.js';

test('fresh databases seed only exact sourced SUNY Delhi moments', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const data = await (await s.get('/api/moments')).json();
    const moments = [...data.upcoming, ...data.past];
    assert.deepEqual(moments.map((moment) => moment.moment_date).sort(), [
      '2026-05-01',
      '2026-07-06',
      '2026-08-21',
      '2026-08-25',
      '2026-08-31',
      '2026-08-31',
      '2026-10-01',
    ]);
    assert.ok(moments.every((moment) => moment.source_url.startsWith('https://www.delhi.edu/')));
    assert.ok(moments.every((moment) => moment.verified_at === '2026-07-30'));
    assert.ok(moments.every((moment) => Array.isArray(moment.channels)));
  } finally {
    server.close();
  }
});

test('seeding is one-time so edits and complete deletion survive initialization', async () => {
  const { server, base, app, config } = bootApp();
  try {
    const s = await login(base);
    const data = await (await s.get('/api/moments')).json();
    const moments = [...data.upcoming, ...data.past];
    const billing = moments.find((moment) => moment.seed_key === 'fall-2026-billing-deadline');
    const updated = await (await s.put(`/api/moments/${billing.id}`, { lead_days: 9 })).json();
    assert.equal(updated.lead_days, 9);
    seedMoments(app.locals.db, config);
    assert.equal(app.locals.db.prepare('SELECT lead_days FROM enrollment_moments WHERE id = ?').get(billing.id).lead_days, 9);

    for (const moment of moments) await s.del(`/api/moments/${moment.id}`);
    seedMoments(app.locals.db, config);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM enrollment_moments').get().n, 0);
  } finally {
    server.close();
  }
});

test('moment CRUD validates dates, lead time, channels, and URLs', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const valid = {
      name: 'Spring outreach checkpoint',
      moment_date: '2027-01-15',
      audience: 'Accepted students',
      lead_days: 14,
      channels: ['email', 'sms'],
      notes: 'Confirm the date before launch.',
      source_url: 'https://www.delhi.edu/admission/accepted/',
      verified_at: '2026-07-30',
    };
    const created = await (await s.post('/api/moments', valid)).json();
    assert.equal(created.name, valid.name);
    assert.deepEqual(created.channels, valid.channels);

    assert.equal((await s.post('/api/moments', { ...valid, moment_date: '2027-02-30' })).status, 400);
    assert.equal((await s.post('/api/moments', { ...valid, lead_days: -1 })).status, 400);
    assert.equal((await s.post('/api/moments', { ...valid, channels: ['carrier-pigeon'] })).status, 400);
    assert.equal((await s.post('/api/moments', { ...valid, source_url: 'javascript:alert(1)' })).status, 400);
    assert.equal((await fetch(base + '/api/moments')).status, 401);
  } finally {
    server.close();
  }
});

test('upcoming moments sort ascending while past moments stay separate', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    app.locals.db.prepare(
      `INSERT INTO enrollment_moments
       (name, moment_date, audience, lead_days, channels, notes, source_url, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('Far future', '2035-10-01', 'Prospective students', 10, '["email"]', '', '', '');
    app.locals.db.prepare(
      `INSERT INTO enrollment_moments
       (name, moment_date, audience, lead_days, channels, notes, source_url, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('Near future', '2035-01-01', 'Prospective students', 10, '["email"]', '', '', '');
    const data = await (await s.get('/api/moments')).json();
    const future = data.upcoming.filter((moment) => moment.moment_date.startsWith('2035'));
    assert.deepEqual(future.map((moment) => moment.name), ['Near future', 'Far future']);
    assert.ok(data.past.length >= 1);
  } finally {
    server.close();
  }
});

test('moment context reaches a campaign and task without retyping its source', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const { upcoming } = await (await s.get('/api/moments')).json();
    const billing = upcoming.find((moment) => moment.seed_key === 'fall-2026-billing-deadline');
    const source = normalizeMomentSource(billing);

    const campaign = await (await s.post('/api/campaigns/brief', {
      purpose: 'Keep the existing draft purpose',
      cta: 'Review your bill',
      cta_link: billing.source_url,
      message_count: 2,
      audience: billing.audience,
      deadline: billing.moment_date,
      source_context: source,
    })).json();
    assert.equal(campaign.purpose, 'Keep the existing draft purpose');
    assert.equal(campaign.deadline, '2026-08-21');
    assert.equal(campaign.source_context.moment_date, '2026-08-21');

    const task = await (await s.post('/api/tasks', {
      text: `Prepare ${billing.name} for ${billing.moment_date}`,
      source_context: source,
    })).json();
    assert.match(task.text, /2026-08-21/);
    assert.equal(task.source_context.audience, billing.audience);
  } finally {
    server.close();
  }
});
