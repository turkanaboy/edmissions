import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../server/config.js';

const baseEnv = {
  EDMISSIONS_USERS: 'tyler:pw1,friend:pw2',
  EDMISSIONS_SESSION_SECRET: 's3cret',
};

const readRepoFile = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Docker uses the bundled content config instead of masking it with a host mount', () => {
  assert.match(readRepoFile('Dockerfile'), /COPY config \.\/config/);
  assert.doesNotMatch(readRepoFile('docker-compose.yml'), /\.\/config:\/app\/config/);
});

test('parses two user pairs from EDMISSIONS_USERS', () => {
  const c = loadConfig({ ...baseEnv });
  assert.equal(c.users.length, 2);
  assert.deepEqual(c.users[0], { username: 'tyler', password: 'pw1' });
  assert.deepEqual(c.users[1], { username: 'friend', password: 'pw2' });
});

test('missing EDMISSIONS_USERS throws a clear error', () => {
  assert.throws(() => loadConfig({ EDMISSIONS_SESSION_SECRET: 'x' }), /EDMISSIONS_USERS/);
});

test('malformed EDMISSIONS_USERS throws', () => {
  assert.throws(() => loadConfig({ ...baseEnv, EDMISSIONS_USERS: 'nopair' }), /user:pass/);
});

test('advisor seed separates nursing offerings and gives every market its data keys', () => {
  const { programs, markets, projectionsSource } = loadConfig({ ...baseEnv }).content.advisor;
  const { offerings, soc, cip } = programs.nursing;
  assert.ok(soc && cip);
  assert.ok(offerings.some((offering) => /campus/i.test(offering.modality)));
  assert.ok(offerings.some((offering) => /^online/i.test(offering.modality)));
  for (const offering of offerings) {
    assert.match(offering.url, /^https:\/\/www\.delhi\.edu\//);
    assert.match(offering.verified_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(offering.audience && offering.license_needed && offering.starts);
  }
  assert.ok(projectionsSource.regional_url && projectionsSource.statewide_url);
  assert.ok(markets.nyc && markets.southern_tier && markets.statewide);
  assert.ok(markets.southern_tier.counties.some((county) => county.name === 'Delaware'));
  for (const [id, market] of Object.entries(markets)) {
    assert.match(market.oews_area, /^[MS]\d{7}$/, id);
    assert.ok(market.note, id);
    assert.ok(market.projections.annual_openings > 0, id);
    if (id !== 'statewide') assert.ok(market.counties.length > 0, id);
    for (const county of market.counties) assert.match(county.fips, /^\d{3}$/, id);
  }
});

test('content config loads modes, feeds, keywords, subjects', () => {
  const c = loadConfig({ ...baseEnv });
  assert.ok(c.content.modes.intense.tags.length > 0);
  assert.ok(c.content.modes.chill.tags.includes('bluegrass'));
  assert.ok(c.content.feeds.length >= 4);
  assert.deepEqual(new Set(c.content.feeds.map((feed) => feed.lane)), new Set(['campus', 'local', 'suny', 'national']));
  assert.ok(c.content.keywords.includes('fafsa'));
  assert.ok(c.content.subjects.includes('admissions'));
  assert.deepEqual(c.content.audienceLanes.map((lane) => lane.id), [
    'prospective-students',
    'families',
    'counselors',
    'adult-learners',
    'accepted-students',
    'deposited-students',
    'current-students',
    'campus-partners',
  ]);
  assert.ok(c.content.enrollmentMoments.every((moment) => /^\d{4}-\d{2}-\d{2}$/.test(moment.moment_date)));
  assert.ok(c.content.enrollmentMoments.every((moment) => moment.source_url.startsWith('https://www.delhi.edu/')));
});

test('env vars all carry the EDMISSIONS_ prefix (defaults applied)', () => {
  const c = loadConfig({ ...baseEnv });
  assert.equal(c.port, 3000);
  assert.equal(c.pollMinutes, 20);
  assert.equal(c.trustProxy, false);
  assert.equal(c.openAiKey, '');
});
