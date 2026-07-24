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
  generateCampaign: async (brief, count, format) => `Generated ${count} ${format} messages.\n\n${brief}`,
  researchAnswer: async (question) => `Try an employer open house for: ${question}`,
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
    assert.match(campaign.output, /Generated 3 text messages/);

    const { campaigns } = await (await s.get('/api/campaigns')).json();
    assert.equal(campaigns[0].id, campaign.id);

    assert.equal((await s.post('/api/campaigns/generate', { ...FORM, message_count: 0 })).status, 400);
  } finally {
    server.close();
  }
});

test('HTML campaigns use the saved scaffold and research answers can be saved as notes', async () => {
  const { server, base, app } = bootApp({ EDMISSIONS_ANTHROPIC_KEY: 'test-key' });
  let receivedHistory;
  app.locals.ai = {
    ...stubAi,
    researchAnswer: async (question, history) => {
      receivedHistory = history;
      return `Try an employer open house for: ${question}`;
    },
  };
  try {
    const s = await login(base);
    const { templates } = await (await s.get('/api/campaigns/templates')).json();
    await s.put(`/api/campaigns/templates/${templates[0].id}`, {
      html_body: '<html><h1>{{subject}}</h1><p>{{body}}</p><a href="{{cta_link}}">{{cta}}</a></html>',
    });
    const campaign = await (await s.post('/api/campaigns/generate', { ...FORM, output_format: 'html' })).json();
    assert.equal(campaign.format, 'html');
    assert.match(campaign.output, /Generated 3 html messages/);
    assert.match(campaign.output, /<html>/);

    const history = [{ question: 'What should we try?', answer: 'Try an open house.' }];
    const research = await (await s.post('/api/research/chat', {
      question: 'How can technical colleges recruit adult learners?',
      history,
    })).json();
    assert.match(research.answer, /employer open house/);
    assert.deepEqual(receivedHistory, history);
    assert.equal((await s.post('/api/research/chat', {
      question: 'Too much history',
      history: Array(6).fill(history[0]),
    })).status, 400);
    const note = await (await s.post('/api/notes', { body: research.answer, tags: ['admissions'] })).json();
    assert.equal(note.body, research.answer);
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
    researchAnswer: async () => {
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
