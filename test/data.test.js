import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login, stubFetch } from './helpers.js';
import { openDb } from '../server/db.js';

const goodSunyRows = [
  {
    year: '2024',
    term: 'Fall',
    college_or_institution_type: 'Technology Colleges',
    college_or_institution_name: 'Delhi',
    undergraduate_full_time: '1900',
    undergraduate_part_time: '300',
    graduate_full_time: '40',
    graduate_part_time: '10',
  },
  {
    year: '2025',
    term: 'Fall',
    college_or_institution_type: 'Technology Colleges',
    college_or_institution_name: 'Delhi',
    undergraduate_full_time: '2000',
    undergraduate_part_time: '325',
    graduate_full_time: '50',
    graduate_part_time: '15',
  },
  {
    year: '2025',
    term: 'Fall',
    college_or_institution_type: 'University Centers',
    college_or_institution_name: 'Albany',
    undergraduate_full_time: '10000',
    undergraduate_part_time: '1000',
    graduate_full_time: '4000',
    graduate_part_time: '500',
  },
];

test('database startup purges legacy Slate snapshots', () => {
  const { server, app, config } = bootApp();
  try {
    app.locals.db.prepare(
      `INSERT INTO data_snapshots (kind, label, as_of, source_label, refreshed_at)
       VALUES ('slate', 'Legacy import', '2026-07-30', 'Slate CSV', '2026-07-30T00:00:00.000Z')`
    ).run();
    const reopened = openDb(config.dataDir);
    assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM data_snapshots WHERE kind = 'slate'").get().n, 0);
    reopened.close();
  } finally {
    server.close();
  }
});

test('Slate web service returns a transient JSON table without storing or echoing its URL', async () => {
  const endpoint = 'https://apply.delhi.edu/manage/query/run?id=funnel&key=secret';
  const restore = stubFetch(
    (url) => url.startsWith('https://apply.delhi.edu/'),
    () => new Response(JSON.stringify([
      { term: 'Fall 2026', stage: 'Applicant', count: 120 },
      { term: 'Fall 2026', stage: 'Admit', count: 80 },
    ]), { headers: { 'Content-Type': 'application/json' } })
  );
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const response = await s.post('/api/data/slate/fetch', { url: endpoint });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.columns, ['term', 'stage', 'count']);
    assert.deepEqual(data.rows[1], ['Fall 2026', 'Admit', '80']);
    assert.equal(data.row_count, 2);
    assert.match(data.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.doesNotMatch(JSON.stringify(data), /key=secret|apply\.delhi\.edu/);
    assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS n FROM data_snapshots WHERE kind = 'slate'").get().n, 0);
  } finally {
    restore();
    server.close();
  }
});

test('Slate web service follows safe redirects, parses CSV, and rejects unsafe endpoints or person-level columns', async () => {
  let mode = 'redirect';
  let calls = 0;
  const restore = stubFetch(
    (url) => url.includes('technolutions.net'),
    (url) => {
      calls += 1;
      if (mode === 'pii') {
        return new Response('stage,primary_email,count\nApplicant,a@example.edu,1', {
          headers: { 'Content-Type': 'text/csv' },
        });
      }
      if (mode === 'unsafe-redirect') {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://evil.example/export' },
        });
      }
      if (url.endsWith('/service')) {
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://suny-delhi.slate.technolutions.net/export' },
        });
      }
      return new Response('stage,program,count\nApplicant,"Hospitality, Management",120', {
        headers: { 'Content-Type': 'text/csv' },
      });
    }
  );
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const response = await s.post('/api/data/slate/fetch', {
      url: 'https://suny-delhi.slate.technolutions.net/service',
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.deepEqual(data.columns, ['stage', 'program', 'count']);
    assert.deepEqual(data.rows[0], ['Applicant', 'Hospitality, Management', '120']);
    assert.equal(calls, 2);

    mode = 'unsafe-redirect';
    const unsafeRedirect = await s.post('/api/data/slate/fetch', {
      url: 'https://suny-delhi.slate.technolutions.net/service',
    });
    assert.equal(unsafeRedirect.status, 502);
    assert.match((await unsafeRedirect.json()).error, /SUNY Delhi or Technolutions host/);

    for (const url of [
      'http://apply.delhi.edu/service',
      'https://evil.example/service',
      'https://user:pass@apply.delhi.edu/service',
      'https://127.0.0.1/service',
    ]) {
      assert.equal((await s.post('/api/data/slate/fetch', { url })).status, 400);
    }

    mode = 'pii';
    const pii = await s.post('/api/data/slate/fetch', {
      url: 'https://suny-delhi.slate.technolutions.net/export',
    });
    assert.equal(pii.status, 502);
    assert.match((await pii.json()).error, /aggregate/i);
    assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS n FROM data_snapshots WHERE kind = 'slate'").get().n, 0);
  } finally {
    restore();
    server.close();
  }
});

test('SUNY refresh keeps Delhi only, caches for a day, and preserves context into the AVP Brief', async () => {
  let calls = 0;
  const restore = stubFetch(
    (url) => url.includes('data.ny.gov/resource/4fyc-bf8i'),
    () => {
      calls += 1;
      return new Response(JSON.stringify(goodSunyRows), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  );
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const refreshed = await (await s.post('/api/data/suny/refresh', {})).json();
    assert.equal(refreshed.stale, false);
    assert.equal(refreshed.cards.find((card) => card.title === 'Total enrollment').count, 2390);
    assert.equal(
      app.locals.db.prepare('SELECT COUNT(DISTINCT institution) AS n FROM data_points WHERE institution != ?').get('Delhi').n,
      0
    );

    const skipped = await (await s.post('/api/data/suny/refresh', {})).json();
    assert.equal(skipped.skipped, true);
    assert.equal(calls, 1);

    const source = refreshed.cards.find((card) => card.title === 'Total enrollment').source_context;
    await s.post('/api/brief-selections', { body: source.excerpt, source_context: source });
    const brief = await (await s.get('/api/brief')).json();
    const retained = brief.selections[0].source_context;
    for (const key of ['dataset', 'measure', 'year', 'institution', 'term', 'dimensions', 'as_of', 'source_label', 'url']) {
      assert.ok(retained[key], `${key} should remain in brief context`);
    }
  } finally {
    restore();
    server.close();
  }
});

test('SUNY schema errors and timeouts leave the last good snapshot available as stale', async () => {
  let mode = 'good';
  const restore = stubFetch(
    (url) => url.includes('data.ny.gov/resource/4fyc-bf8i'),
    () => {
      if (mode === 'timeout') throw new Error('timed out');
      const rows = mode === 'missing'
        ? goodSunyRows.map(({ graduate_part_time, ...row }) => row)
        : goodSunyRows;
      return new Response(JSON.stringify(rows), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
  );
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    await s.post('/api/data/suny/refresh', {});
    const count = app.locals.db.prepare("SELECT COUNT(*) AS n FROM data_snapshots WHERE kind = 'suny_enrollment'").get().n;
    app.locals.db.prepare("UPDATE data_snapshots SET refreshed_at = '2020-01-01T00:00:00.000Z'").run();

    mode = 'missing';
    const missing = await (await s.post('/api/data/suny/refresh', {})).json();
    assert.equal(missing.stale, true);
    assert.equal(missing.snapshot.status, 'stale');
    assert.equal(app.locals.db.prepare("SELECT COUNT(*) AS n FROM data_snapshots WHERE kind = 'suny_enrollment'").get().n, count);

    mode = 'timeout';
    const timedOut = await (await s.post('/api/data/suny/refresh', {})).json();
    assert.equal(timedOut.stale, true);
    assert.equal(timedOut.cards.find((card) => card.title === 'Total enrollment').count, 2390);
  } finally {
    restore();
    server.close();
  }
});

test('data routes are authenticated and publish only HTTPS official source links', async () => {
  const { server, base } = bootApp();
  try {
    assert.equal((await fetch(base + '/api/data')).status, 401);
    const s = await login(base);
    const data = await (await s.get('/api/data')).json();
    assert.ok(data.sources.length >= 6);
    assert.ok(data.sources.every((source) => source.url.startsWith('https://')));
  } finally {
    server.close();
  }
});
