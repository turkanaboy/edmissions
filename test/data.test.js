import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login, stubFetch } from './helpers.js';

const headers = 'term,stage,program,residency,geography,source,count,prior_year_count,goal';
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

test('Slate import stores normalized aggregate rows and quoted commas without raw CSV', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const csv = [
      headers,
      'Fall 2026,Applicant,"Hospitality, Management",In-state,New York,Web,120,108,140',
      'Fall 2026,Admit,Nursing,In-state,New York,School visit,80,75,95',
      'Fall 2026,Applicant,Nursing,Out-of-state,Pennsylvania,Search,20,,25',
    ].join('\n');
    const response = await s.post('/api/data/slate', {
      csv,
      label: 'Fall funnel',
      as_of: '2026-07-30',
      source_label: 'Slate aggregate export',
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.snapshot.label, 'Fall funnel');
    const applicant = data.cards.find((card) => card.title.startsWith('Applicant'));
    assert.equal(applicant.count, 140);
    for (const key of ['dataset', 'measure', 'term', 'dimensions', 'as_of', 'source_label']) {
      assert.ok(applicant.source_context[key], `${key} should be present in Slate source context`);
    }
    assert.equal(
      app.locals.db.prepare('SELECT program FROM data_points WHERE program LIKE ?').get('Hospitality%').program,
      'Hospitality, Management'
    );

    const columns = app.locals.db.prepare('PRAGMA table_info(data_snapshots)').all()
      .concat(app.locals.db.prepare('PRAGMA table_info(data_points)').all())
      .map((column) => column.name);
    assert.ok(!columns.includes('csv'));
    assert.ok(!columns.includes('raw_csv'));
    const payload = JSON.stringify(await (await s.get('/api/data')).json());
    assert.doesNotMatch(payload, /"csv"|"raw_csv"/);
  } finally {
    server.close();
  }
});

test('Slate import rejects PII, malformed rows, invalid numbers, dates, and oversize input without partial snapshots', async () => {
  const invalid = [
    `${headers},email\nFall 2026,Applicant,Nursing,In-state,New York,Web,1,1,2,a@example.edu`,
    `${headers},unexpected\nFall 2026,Applicant,Nursing,In-state,New York,Web,1,1,2,no`,
    `${headers}\nFall 2026,Applicant,"Nursing,In-state,New York,Web,1,1,2`,
    `${headers}\nFall 2026,Applicant,Nursing,In-state,New York,Web,-1,1,2`,
    `${headers}\nFall 2026,Applicant,Nursing,In-state,New York,Web,many,1,2`,
  ];
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    for (const csv of invalid) {
      const response = await s.post('/api/data/slate', {
        csv,
        as_of: '2026-07-30',
        label: 'Rejected',
        source_label: 'Slate',
      });
      assert.equal(response.status, 400);
      assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM data_snapshots').get().n, 0);
    }
    assert.equal((await s.post('/api/data/slate', {
      csv: `${headers}\nFall 2026,Applicant,Nursing,In-state,New York,Web,1,1,2`,
      as_of: '2026-02-30',
      label: 'Rejected',
      source_label: 'Slate',
    })).status, 400);
    assert.equal((await s.post('/api/data/slate', {
      csv: 'x'.repeat(200_001),
      as_of: '2026-07-30',
      label: 'Rejected',
      source_label: 'Slate',
    })).status, 400);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM data_snapshots').get().n, 0);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM data_points').get().n, 0);
  } finally {
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
