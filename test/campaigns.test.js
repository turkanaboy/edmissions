import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

const FORM = {
  purpose: 'FAFSA completion push for admitted students',
  cta: 'Complete your FAFSA',
  cta_link: 'https://college.example.edu/fafsa',
  message_count: 4,
};

test('a default template is seeded on first boot', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const { templates } = await (await s.get('/api/campaigns/templates')).json();
    assert.ok(templates.length >= 1);
    assert.equal(templates[0].name, 'Default handoff');
    assert.match(templates[0].body, /\{\{purpose\}\}/);
  } finally {
    server.close();
  }
});

test('handoff brief contains all four inputs verbatim with N message slots', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const res = await s.post('/api/campaigns/brief', FORM);
    assert.equal(res.status, 201);
    const brief = await res.json();
    assert.equal(brief.kind, 'brief');
    assert.ok(brief.output.includes(FORM.purpose));
    assert.ok(brief.output.includes(FORM.cta));
    assert.ok(brief.output.includes(FORM.cta_link));
    assert.ok(brief.output.includes('Draft 4 messages'));
    assert.ok(!brief.output.includes('{{'), 'all placeholders substituted');

    const { campaigns } = await (await s.get('/api/campaigns')).json();
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].id, brief.id);
  } finally {
    server.close();
  }
});

test('validation: missing fields, bad URL, and out-of-range count are 400s', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    assert.equal((await s.post('/api/campaigns/brief', { ...FORM, cta_link: '' })).status, 400);
    assert.equal((await s.post('/api/campaigns/brief', { ...FORM, cta_link: 'not a url' })).status, 400);
    assert.equal((await s.post('/api/campaigns/brief', { ...FORM, message_count: 0 })).status, 400);
    assert.equal((await s.post('/api/campaigns/brief', { ...FORM, message_count: 99 })).status, 400);
  } finally {
    server.close();
  }
});

test('template round-trip: create, list, update', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const created = await (await s.post('/api/campaigns/templates', { name: 'Short + punchy', body: 'Write {{message_count}} texts about {{purpose}}. CTA: {{cta}} {{cta_link}}' })).json();
    const { templates } = await (await s.get('/api/campaigns/templates')).json();
    assert.equal(templates.length, 2);

    await s.put(`/api/campaigns/templates/${created.id}`, { name: 'Short & punchy' });
    const after = await (await s.get('/api/campaigns/templates')).json();
    assert.ok(after.templates.some((t) => t.name === 'Short & punchy'));

    const brief = await (await s.post('/api/campaigns/brief', { ...FORM, template_id: created.id })).json();
    assert.match(brief.output, /Write 4 texts/);
  } finally {
    server.close();
  }
});
