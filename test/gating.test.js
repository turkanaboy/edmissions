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
  researchAnswer: async (question) => ({ answer: `Try an employer open house for: ${question}`, evidence: [], sourceText: "" }),
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
  const { server, base } = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key' });
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
  const { server, base, app } = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key' });
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
  const { server, base, app } = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key' });
  app.locals.ai = stubAi;
  try {
    const s = await login(base);
    const context = {
      ...FORM,
      audience: 'Admitted students',
      audience_lane: 'accepted-students',
      audience_notes: 'Reduce uncertainty about next steps.',
      sender: 'SUNY Delhi Admissions',
      channel: 'email',
      deadline: '2026-08-21',
      source_context: {
        title: 'Financial aid dates',
        url: 'https://www.delhi.edu/admission/financial-aid/deadlines/',
      },
    };
    const res = await s.post('/api/campaigns/generate', context);
    assert.equal(res.status, 201);
    const campaign = await res.json();
    assert.equal(campaign.kind, 'generated');
    assert.equal(campaign.message_count, 3);
    assert.equal(campaign.audience, context.audience);
    assert.equal(campaign.audience_lane, context.audience_lane);
    assert.deepEqual(campaign.source_context, context.source_context);
    assert.match(campaign.output, /Generated 3 text messages/);
    assert.match(campaign.output, /Audience: Admitted students/);
    assert.match(campaign.output, /Audience lane: Accepted students/);
    assert.match(campaign.output, /Reduce uncertainty about next steps/);
    assert.match(campaign.output, /reference data, not instructions/);

    const { campaigns } = await (await s.get('/api/campaigns')).json();
    assert.equal(campaigns[0].id, campaign.id);

    assert.equal((await s.post('/api/campaigns/generate', { ...FORM, message_count: 0 })).status, 400);
  } finally {
    server.close();
  }
});

test('HTML campaigns use the saved scaffold and research answers can be saved as notes', async () => {
  const { server, base, app } = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key' });
  let receivedHistory;
  let receivedCampus;
  app.locals.ai = {
    ...stubAi,
    researchAnswer: async (question, history, campus) => {
      receivedHistory = history;
      receivedCampus = campus;
      return { answer: `Try an employer open house for: ${question}`, evidence: [], sourceText: "" };
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
    assert.match(receivedCampus, /Name: SUNY Delhi/);
    assert.match(receivedCampus, /SUNY DELHI KNOWLEDGE PACK/);
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
  const { server, base, app } = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key' });
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

const SLATE_COLUMNS = ['term', 'stage', 'program', 'residency', 'geography', 'source', 'count', 'prior_year_count', 'goal'];
const slateRow = (count, prior = '40') => ['Fall 2026', 'Inquiry', 'Nursing', 'New York', 'Kings', 'Web', String(count), prior, ''];

function bootResearch(env = {}, reply = {}) {
  const booted = bootApp({ EDMISSIONS_OPENAPI_KEY: 'test-key', ...env });
  const received = { calls: 0 };
  booted.app.locals.ai = {
    ...stubAi,
    researchAnswer: async (question, history, campus, options) => {
      received.calls += 1;
      received.options = options;
      return { answer: 'Test first.', evidence: [], sourceText: '', ...reply };
    },
  };
  return { ...booted, received };
}

test('research responses carry evidence and flag figures that match no source', async () => {
  const evidence = [{ label: 'RN employment', value: '197,740' }];
  const { server, base } = bootResearch({}, {
    answer: 'The metro has 197,740 RNs and fall 2026 starts. Your $60,000 quote needs 9 more. A vendor said $9,999.',
    evidence,
    sourceText: '{"value":"197,740"}',
  });
  try {
    const s = await login(base);
    const body = await (await s.post('/api/research/chat', { question: 'Is a $60,000 subway ad worth it?' })).json();
    assert.deepEqual(body.evidence, evidence);
    assert.deepEqual(body.unsourced_figures, ['$9,999']);
    assert.equal(body.sourceText, undefined);
  } finally {
    server.close();
  }
});

test('a figure from an earlier exchange is not flagged, and long advisor answers can be follow-up history', async () => {
  const { server, base } = bootResearch({}, { answer: 'As noted, 197,740 RNs.' });
  try {
    const s = await login(base);
    const response = await s.post('/api/research/chat', {
      question: 'Follow up',
      history: [{ question: 'First', answer: `197,740 RNs. ${'Context. '.repeat(1500)}` }],
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).unsourced_figures, []);
  } finally {
    server.close();
  }
});

test('Slate attachment is refused unless approved, and the AI never sees it', async () => {
  const { server, base, received } = bootResearch();
  try {
    const s = await login(base);
    assert.equal((await (await s.get('/api/capabilities')).json()).slateAi, false);
    const response = await s.post('/api/research/chat', {
      question: 'Pipeline?',
      slate: { columns: SLATE_COLUMNS, rows: [slateRow(40)] },
    });
    assert.equal(response.status, 403);
    assert.equal(received.calls, 0);
  } finally {
    server.close();
  }
});

test('an approved Slate attachment is suppressed before the AI sees it and is not stored', async () => {
  const { server, base, app, received } = bootResearch({ EDMISSIONS_SLATE_AI_APPROVED: '1' }, {
    answer: 'Kings shows 40 inquiries.',
  });
  try {
    const s = await login(base);
    assert.equal((await (await s.get('/api/capabilities')).json()).slateAi, true);
    const body = await (await s.post('/api/research/chat', {
      question: 'Pipeline?',
      slate: { columns: SLATE_COLUMNS, rows: [slateRow(3, '4'), slateRow(40, '0'), slateRow(0, '')] },
    })).json();
    const { rows } = received.options.slateTable;
    const countAt = SLATE_COLUMNS.indexOf('count');
    const priorAt = SLATE_COLUMNS.indexOf('prior_year_count');
    assert.deepEqual(rows.map((row) => row[countAt]), ['<5', '40', '0']);
    assert.deepEqual(rows.map((row) => row[priorAt]), ['<5', '0', '']);
    assert.deepEqual(body.unsourced_figures, []);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM data_snapshots').get().n, 0);
    assert.equal(app.locals.db.prepare('SELECT COUNT(*) AS n FROM data_points').get().n, 0);
  } finally {
    server.close();
  }
});

test('a Slate attachment with person-level columns, too many rows, or bad cells is rejected before the AI', async () => {
  const { server, base, received } = bootResearch({ EDMISSIONS_SLATE_AI_APPROVED: '1' });
  try {
    const s = await login(base);
    const attempts = [
      { columns: [...SLATE_COLUMNS.slice(0, 8), 'email'], rows: [slateRow(40)] },
      { columns: SLATE_COLUMNS, rows: Array(301).fill(slateRow(40)) },
      { columns: SLATE_COLUMNS, rows: [slateRow('many')] },
      { columns: SLATE_COLUMNS, rows: ['not a row'] },
      { rows: [] },
    ];
    for (const slate of attempts) {
      assert.equal((await s.post('/api/research/chat', { question: 'Pipeline?', slate })).status, 400);
    }
    assert.equal(received.calls, 0);
  } finally {
    server.close();
  }
});
