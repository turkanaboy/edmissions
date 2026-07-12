import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

const FORM = {
  purpose: 'FAFSA completion push',
  cta: 'Complete your FAFSA',
  cta_link: 'https://college.example.edu/fafsa',
  message_count: 3,
};

// Stub AI module — no live API calls anywhere in the suite
const stubAi = {
  enabled: true,
  summarizeNote: async () => 'A tidy three-sentence summary.',
  generateCampaign: async (brief, count) => `Generated ${count} messages.\n\n${brief.slice(0, 40)}`,
};

test('AE1: without a key, capabilities is ai:false and AI endpoints 503', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    assert.equal((await (await s.get('/api/capabilities')).json()).ai, false);

    const note = await (await s.post('/api/notes', { body: 'raw text', tags: [] })).json();
    assert.equal((await s.post(`/api/notes/${note.id}/summarize`, {})).status, 503);
    assert.equal((await s.post('/api/campaigns/generate', FORM)).status, 503);
  } finally {
    server.close();
  }
});

test('AE2: with a key, capabilities is ai:true (both campaign paths available)', async () => {
  const { server, base } = bootApp({ EDMISSIONS_ANTHROPIC_KEY: 'test-key' });
  try {
    const s = await login(base);
    assert.equal((await (await s.get('/api/capabilities')).json()).ai, true);
    // the handoff path works regardless of the key
    assert.equal((await s.post('/api/campaigns/brief', FORM)).status, 201);
  } finally {
    server.close();
  }
});

test('summarize stores the summary while raw body stays unchanged (R14)', async () => {
  const { server, base, app } = bootApp({ EDMISSIONS_ANTHROPIC_KEY: 'test-key' });
  app.locals.ai = stubAi;
  try {
    const s = await login(base);
    const note = await (await s.post('/api/notes', { body: 'Original raw research text', tags: ['admissions'] })).json();
    const summarized = await (await s.post(`/api/notes/${note.id}/summarize`, {})).json();
    assert.equal(summarized.summary, 'A tidy three-sentence summary.');
    assert.equal(summarized.body, 'Original raw research text');
    assert.deepEqual(summarized.tags, ['admissions']);
    assert.equal((await s.post('/api/notes/999/summarize', {})).status, 404);
  } finally {
    server.close();
  }
});

test('generate persists a campaign with the requested message count', async () => {
  const { server, base, app } = bootApp({ EDMISSIONS_ANTHROPIC_KEY: 'test-key' });
  app.locals.ai = stubAi;
  try {
    const s = await login(base);
    const res = await s.post('/api/campaigns/generate', FORM);
    assert.equal(res.status, 201);
    const campaign = await res.json();
    assert.equal(campaign.kind, 'generated');
    assert.equal(campaign.message_count, 3);
    assert.match(campaign.output, /Generated 3 messages/);

    const { campaigns } = await (await s.get('/api/campaigns')).json();
    assert.equal(campaigns[0].id, campaign.id);

    assert.equal((await s.post('/api/campaigns/generate', { ...FORM, message_count: 0 })).status, 400);
  } finally {
    server.close();
  }
});

test('AI failures return 502 without leaking detail', async () => {
  const { server, base, app } = bootApp({ EDMISSIONS_ANTHROPIC_KEY: 'test-key' });
  app.locals.ai = {
    enabled: true,
    summarizeNote: async () => {
      throw Object.assign(new Error('upstream'), { status: 529 });
    },
    generateCampaign: async () => {
      throw new Error('upstream');
    },
  };
  try {
    const s = await login(base);
    const note = await (await s.post('/api/notes', { body: 'text', tags: [] })).json();
    const res = await s.post(`/api/notes/${note.id}/summarize`, {});
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /AI request failed/);
    assert.equal((await s.post('/api/campaigns/generate', FORM)).status, 502);
  } finally {
    server.close();
  }
});
