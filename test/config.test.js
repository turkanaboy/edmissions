import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';

const baseEnv = {
  EDMISSIONS_USERS: 'tyler:pw1,friend:pw2',
  EDMISSIONS_SESSION_SECRET: 's3cret',
};

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

test('content config loads modes, feeds, keywords, subjects', () => {
  const c = loadConfig({ ...baseEnv });
  assert.ok(c.content.modes.intense.tags.length > 0);
  assert.ok(c.content.modes.chill.tags.includes('bluegrass'));
  assert.ok(c.content.feeds.length >= 4);
  assert.ok(c.content.keywords.includes('fafsa'));
  assert.ok(c.content.subjects.includes('admissions'));
});

test('env vars all carry the EDMISSIONS_ prefix (defaults applied)', () => {
  const c = loadConfig({ ...baseEnv });
  assert.equal(c.port, 3000);
  assert.equal(c.pollMinutes, 20);
  assert.equal(c.trustProxy, false);
  assert.equal(c.openAiKey, '');
});
