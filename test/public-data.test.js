import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { createPublicData, findUnsourcedFigures } from '../server/public-data.js';

const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const blsBody = {
  status: 'REQUEST_SUCCEEDED',
  message: ['No Data Available for Series OEUM003562000000029114101 Year: 2024'],
  Results: {
    series: [
      { seriesID: 'OEUM003562000000029114101', data: [{ year: '2025', value: '197740' }] },
      { seriesID: 'OEUM003562000000029114113', data: [{ year: '2025', value: '119720' }] },
    ],
  },
};

function setup({ env = {}, fetchImpl, start = '2026-11-05T12:00:00Z' } = {}) {
  const config = loadConfig({
    EDMISSIONS_USERS: 'tyler:pw',
    EDMISSIONS_SESSION_SECRET: 's',
    ...env,
  });
  const db = openDb(mkdtempSync(join(tmpdir(), 'edm-public-')));
  const clock = { now: new Date(start) };
  const calls = [];
  const data = createPublicData({
    db,
    config,
    now: () => clock.now,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return fetchImpl(String(url), options);
    },
  });
  return { data, db, calls, clock };
}

const byLabel = (evidence, pattern, publisher = '') =>
  evidence.find((item) => pattern.test(item.label) && item.publisher.includes(publisher));

test('labor market joins BLS and NY DOL figures with provenance, and older-year BLS messages do not hide data', async () => {
  const { data } = setup({ fetchImpl: () => json(blsBody) });
  const { output, evidence } = await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });

  const employed = byLabel(evidence, /employment$/, 'Bureau');
  assert.equal(employed.value, '197,740');
  assert.equal(employed.period, '2025');
  assert.match(employed.geography, /New York-Newark-Jersey City/);
  assert.equal(employed.stale, false);
  assert.equal(byLabel(evidence, /median/, 'Bureau').value, '$119,720');
  assert.equal(byLabel(evidence, /annual average openings/).value, '7,410');
  assert.match(output.geography_note, /five boroughs/);
  assert.deepEqual(output.unavailable, []);
});

test('a second call inside the cache window makes no network request', async () => {
  const { data, calls } = setup({ fetchImpl: () => json(blsBody) });
  await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  assert.equal(calls.length, 1);
});

test('a failed refresh serves the old value marked stale with its original date', async () => {
  let fail = false;
  const { data, clock } = setup({
    fetchImpl: () => {
      if (fail) throw new Error('down');
      return json(blsBody);
    },
  });
  await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  clock.now = new Date('2026-12-05T12:00:00Z');
  fail = true;

  const { evidence } = await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  const employed = byLabel(evidence, /employment$/, 'Bureau');
  assert.equal(employed.value, '197,740');
  assert.equal(employed.stale, true);
  assert.equal(employed.retrieved_at, '2026-11-05T12:00:00.000Z');
});

test('a failed fetch with no cache reports the source unavailable and shows no number from it', async () => {
  const { data } = setup({ fetchImpl: () => new Response('nope', { status: 500 }) });
  const { output, evidence } = await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  assert.deepEqual(output.unavailable, ['U.S. Bureau of Labor Statistics, OEWS']);
  assert.equal(byLabel(evidence, /employment$/, 'Bureau'), undefined);
  assert.equal(byLabel(evidence, /annual average openings/).value, '7,410');
});

test('BLS rate-limit responses count as failures', async () => {
  const { data } = setup({ fetchImpl: () => json({ status: 'REQUEST_NOT_PROCESSED', Results: {} }) });
  const { output } = await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  assert.deepEqual(output.unavailable, ['U.S. Bureau of Labor Statistics, OEWS']);
});

test('unmapped programs, markets, and tools make no network call', async () => {
  const { data, calls } = setup({ fetchImpl: () => json(blsBody) });
  const welding = await data.run('get_labor_market', { program: 'welding', market: 'nyc' });
  assert.match(welding.output.unmapped, /welding/);
  const buffalo = await data.run('get_market_profile', { market: 'buffalo' });
  assert.match(buffalo.output.unmapped, /buffalo/);
  assert.match((await data.run('fetch_url', {})).output.error, /Unknown tool/);
  assert.equal(calls.length, 0);
});

test('tool definitions limit the model to seeded programs and markets', () => {
  const { data } = setup({ fetchImpl: () => json(blsBody) });
  const labor = data.definitions.find((tool) => tool.name === 'get_labor_market');
  assert.deepEqual(labor.parameters.properties.program.enum, ['nursing']);
  assert.ok(labor.parameters.properties.market.enum.includes('nyc'));
  assert.equal(labor.parameters.additionalProperties, false);
});

test('market profile without a Census key reports it unavailable and still returns SUNY origins', async () => {
  const { data, calls } = setup({
    fetchImpl: () => json([
      { term: 'Fall 2025', county: 'Kings', attending_suny_technology_colleges: '257', total_attending_suny_institutions: '2295' },
      { term: 'Fall 2025', county: 'Queens', attending_suny_technology_colleges: '253', total_attending_suny_institutions: '2284' },
    ]),
  });
  const { output, evidence } = await data.run('get_market_profile', { market: 'nyc' });
  assert.deepEqual(output.unavailable, ['U.S. Census Bureau, ACS 5-year']);
  assert.equal(byLabel(evidence, /technology colleges/).value, '510');
  assert.equal(byLabel(evidence, /technology colleges/).period, 'Fall 2025');
  assert.ok(calls.every((call) => !call.url.includes('census.gov')));
});

test('market profile sums Census counties, and a failed call keeps the key out of output and cache', async () => {
  const header = ['B01003_001E', 'B15003_001E', 'B01001_007E', 'B01001_008E', 'B01001_009E', 'B01001_010E', 'B01001_031E', 'B01001_032E', 'B01001_033E', 'B01001_034E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E', 'state', 'county'];
  const row = ['1000', '600', '10', '10', '10', '10', '10', '10', '10', '10', '100', '50', '25', '25', '36', '061'];
  const ok = setup({
    env: { EDMISSIONS_CENSUS_KEY: 'census-secret' },
    fetchImpl: (url) => (url.includes('census.gov') ? json([header, row, row]) : json([])),
  });
  const { evidence } = await ok.data.run('get_market_profile', { market: 'nyc' });
  assert.equal(byLabel(evidence, /^Population$/).value, '2,000');
  assert.equal(byLabel(evidence, /18 to 24/).value, '160');
  assert.equal(byLabel(evidence, /without a bachelor/).value, '800');
  const stored = JSON.stringify(ok.db.prepare('SELECT * FROM external_data').all());
  assert.doesNotMatch(stored, /census-secret/);

  const failed = setup({
    env: { EDMISSIONS_CENSUS_KEY: 'census-secret' },
    fetchImpl: () => {
      throw new Error('failed https://api.census.gov?key=census-secret');
    },
  });
  const result = await failed.data.run('get_market_profile', { market: 'nyc' });
  assert.doesNotMatch(JSON.stringify(result), /census-secret/);
});

test('BLS registered requests send the key only in the request body', async () => {
  const { data, calls } = setup({ env: { EDMISSIONS_BLS_KEY: 'bls-secret' }, fetchImpl: () => json(blsBody) });
  await data.run('get_labor_market', { program: 'nursing', market: 'nyc' });
  assert.match(calls[0].url, /\/v2\//);
  assert.doesNotMatch(calls[0].url, /bls-secret/);
  assert.equal(JSON.parse(calls[0].options.body).registrationkey, 'bls-secret');
});

test('competitors counts only institutions located in the market', async () => {
  const { data, calls } = setup({
    fetchImpl: (url) => {
      if (url.includes('completions-cip-6')) {
        return json({
          results: [
            { unitid: 1, award_level: 7, awards_6digit: 430 },
            { unitid: 1, award_level: 9, awards_6digit: 20 },
            { unitid: 2, award_level: 4, awards_6digit: 87 },
            { unitid: 3, award_level: 7, awards_6digit: 999 },
            { unitid: 4, award_level: 7, awards_6digit: 0 },
            { unitid: 196024, award_level: 4, awards_6digit: 54 },
            { unitid: 196024, award_level: 7, awards_6digit: 131 },
          ],
        });
      }
      return json({
        results: url.includes('county_fips=36061')
          ? [{ unitid: 1, inst_name: 'Manhattan College of Nursing' }, { unitid: 4, inst_name: 'No Awards College' }]
          : url.includes('county_fips=36047')
            ? [{ unitid: 2, inst_name: 'Brooklyn Community College' }]
            : [],
      });
    },
  });
  const { output, evidence } = await data.run('get_competitors', { program: 'nursing', market: 'nyc' });
  assert.equal(byLabel(evidence, /^Institutions/).value, '2');
  assert.equal(byLabel(evidence, /all levels/).value, '537');
  assert.equal(byLabel(evidence, /^Registered Nursing associate/).value, '87');
  assert.equal(byLabel(evidence, /^Registered Nursing bachelor/).value, '430');
  assert.equal(byLabel(evidence, /^SUNY Delhi .* associate/).value, '54');
  assert.equal(byLabel(evidence, /^SUNY Delhi .* bachelor/).value, '131');
  assert.equal(calls.every((item) => item.options.headers['User-Agent'] === 'EDMissions/1.0'), true);
  assert.equal(output.top_institutions[0].name, 'Manhattan College of Nursing');
  assert.equal(output.top_institutions.length, 2);
});

test('program profile separates offerings and needs no network', async () => {
  const { data, calls } = setup({ fetchImpl: () => json({}) });
  const { output, evidence } = await data.run('get_program_profile', { program: 'nursing' });
  assert.ok(output.offerings.length >= 3);
  assert.match(byLabel(evidence, /BSN in 10/).value, /June 18, 2020/);
  assert.match(byLabel(evidence, /tuition/).value, /\$295/);
  assert.equal(calls.length, 0);
});

test('figure check flags only numbers that match no source', () => {
  const sources = ['Registered Nurses employment 197,740', 'median $119,720.40'];
  assert.deepEqual(findUnsourcedFigures('About 197,740 RNs earn $119,720.', sources), []);
  assert.deepEqual(findUnsourcedFigures('It costs $9,999 and reaches 45% of nurses.', sources), ['$9,999', '45%']);
  assert.deepEqual(findUnsourcedFigures('197740 is the count.', sources), []);
  assert.deepEqual(findUnsourcedFigures('Fall 2025 and 2030 deadlines, 2 questions, 7 sections.', sources), []);
  assert.deepEqual(findUnsourcedFigures('See https://example.com/12345 for more.', sources), []);
  assert.deepEqual(findUnsourcedFigures('Cap it at $6,000, then $6,000 again and 8.486 credits.', sources), ['$6,000']);
  assert.deepEqual(findUnsourcedFigures('A cost of 1,500, or 192.03 credits.', sources), ['1,500', '192.03']);
});

test('figure check requires matching units', () => {
  const sources = ['annual openings 7,410', 'median $119,720', 'response rate 12%'];
  assert.deepEqual(findUnsourcedFigures('A budget of $7,410.', sources), ['$7,410']);
  assert.deepEqual(findUnsourcedFigures('It reached 7,410% of them.', sources), ['7,410%']);
  assert.deepEqual(findUnsourcedFigures('Wages near 119,720 and a 12% rate.', sources), []);
});

test('Census sentinels and nulls count as unavailable rather than joining a total', async () => {
  const header = ['B01003_001E', 'B15003_001E', 'B01001_007E', 'B01001_008E', 'B01001_009E', 'B01001_010E', 'B01001_031E', 'B01001_032E', 'B01001_033E', 'B01001_034E', 'B15003_022E', 'B15003_023E', 'B15003_024E', 'B15003_025E', 'state', 'county'];
  for (const bad of ['-666666666', null]) {
    const row = ['1000', '600', bad, '10', '10', '10', '10', '10', '10', '10', '100', '50', '25', '25', '36', '061'];
    const { data } = setup({
      env: { EDMISSIONS_CENSUS_KEY: 'key' },
      fetchImpl: (url) => (url.includes('census.gov') ? json([header, row]) : json([])),
    });
    const { output } = await data.run('get_market_profile', { market: 'nyc' });
    assert.ok(output.unavailable.includes('U.S. Census Bureau, ACS 5-year'));
  }
});

test('responses over 1 MB are accepted for large public files', async () => {
  const results = Array.from({ length: 600 }, (_, unitid) => ({ unitid, inst_name: 'x'.repeat(2000) }));
  const { data } = setup({
    fetchImpl: (url) => (url.includes('completions-cip-6') ? json({ results: [] }) : json({ results })),
  });
  const { output } = await data.run('get_competitors', { program: 'nursing', market: 'statewide' });
  assert.equal(output.unavailable, undefined);
});

test('inherited object keys are not treated as tools', async () => {
  const { data } = setup({ fetchImpl: () => json({}) });
  for (const name of ['constructor', 'toString', '__proto__']) {
    assert.match((await data.run(name, {})).output.error, /Unknown tool/);
  }
});
