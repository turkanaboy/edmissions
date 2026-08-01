import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login } from './helpers.js';

const FORM = {
  purpose: 'FAFSA completion push for admitted students',
  cta: 'Complete your FAFSA',
  cta_link: 'https://college.example.edu/fafsa',
  message_count: 4,
};

const COMPLETE_FORM = {
  ...FORM,
  audience: 'Admitted students and families',
  sender: 'SUNY Delhi Admissions',
  channel: 'email',
  deadline: '2026-08-21',
  source_context: {
    title: 'Financial aid dates',
    publisher: 'SUNY Delhi',
    published_at: '2026-07-30',
    url: 'https://www.delhi.edu/admission/financial-aid/deadlines/',
    excerpt: 'UNIQUE_SOURCE_FACT_9b17: priority FAFSA review begins August 1.',
    lane: 'campus',
  },
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
    assert.equal((await s.post('/api/campaigns/brief', { ...FORM, cta_link: 'javascript:alert(1)' })).status, 400);
    assert.equal(
      (await s.post('/api/campaigns/brief', {
        ...FORM,
        source_context: { title: 'Unsafe source', url: 'javascript:alert(1)' },
      })).status,
      400
    );
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

test('SUNY Delhi campus memory is seeded, editable, and included in handoff briefs', async () => {
  const { server, base, app, config } = bootApp();
  try {
    const s = await login(base);
    const seeded = await (await s.get('/api/campaigns/campus')).json();
    assert.equal(seeded.campus.name, 'SUNY Delhi');
    assert.match(seeded.campus.facts, /Verified from official SUNY Delhi pages on 2026-07-30/);
    assert.match(seeded.campus.facts, /https:\/\/www\.delhi\.edu\/academics\/majors-programs\//);

    app.locals.db
      .prepare('UPDATE campus_profile SET name = ?, facts = ? WHERE id = 1')
      .run('Example Technical College', 'Replace this seed with approved facts.');
    const { seedTemplates } = await import('../server/routes/campaigns.js');
    seedTemplates(app.locals.db, config);
    assert.equal((await (await s.get('/api/campaigns/campus')).json()).campus.name, 'SUNY Delhi');

    app.locals.db
      .prepare('UPDATE campus_profile SET name = ?, audience = ?, facts = ? WHERE id = 1')
      .run('SUNY Delhi', 'Locally edited audience', 'Replace this seed with approved facts.');
    seedTemplates(app.locals.db, config);
    const repaired = (await (await s.get('/api/campaigns/campus')).json()).campus;
    assert.match(repaired.facts, /SUNY DELHI KNOWLEDGE PACK/);
    assert.equal(repaired.audience, 'Locally edited audience');

    const campus = {
      name: 'North Country Technical College',
      type: 'Public technical college',
      location: 'New York State',
      audience: 'Adult learners and recent graduates',
      voice: 'Direct and practical',
      facts: 'Offers evening programs and career coaching.',
    };
    assert.equal((await (await s.put('/api/campaigns/campus', campus)).json()).name, campus.name);
    seedTemplates(app.locals.db, config);
    assert.equal((await (await s.get('/api/campaigns/campus')).json()).campus.name, campus.name);
    const brief = await (await s.post('/api/campaigns/brief', FORM)).json();
    assert.match(brief.output, /North Country Technical College/);
    assert.match(brief.output, /Offers evening programs/);
  } finally {
    server.close();
  }
});

test('campaign context persists and preflight stays advisory', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const complete = await (await s.post('/api/campaigns/brief', COMPLETE_FORM)).json();
    assert.equal(complete.audience, COMPLETE_FORM.audience);
    assert.equal(complete.sender, COMPLETE_FORM.sender);
    assert.equal(complete.channel, COMPLETE_FORM.channel);
    assert.equal(complete.deadline, COMPLETE_FORM.deadline);
    assert.deepEqual(complete.source_context, COMPLETE_FORM.source_context);
    for (const value of Object.values(COMPLETE_FORM.source_context)) {
      assert.ok(complete.output.includes(value), `campaign output should retain source value: ${value}`);
    }

    const completeCheck = await (await s.get(`/api/campaigns/${complete.id}/preflight`)).json();
    const completeCodes = completeCheck.findings.map((finding) => finding.code);
    for (const code of ['missing_audience', 'missing_sender', 'missing_channel', 'missing_deadline', 'missing_source']) {
      assert.ok(!completeCodes.includes(code), `${code} should not be present`);
    }

    const incomplete = await (await s.post('/api/campaigns/brief', FORM)).json();
    const incompleteCheck = await (await s.get(`/api/campaigns/${incomplete.id}/preflight`)).json();
    const incompleteCodes = incompleteCheck.findings.map((finding) => finding.code);
    for (const code of ['missing_audience', 'missing_sender', 'missing_channel', 'missing_deadline', 'missing_source']) {
      assert.ok(incompleteCodes.includes(code), `${code} should be advisory`);
    }
    assert.equal((await s.get(`/api/campaigns/${incomplete.id}/preflight`)).status, 200);
    assert.equal((await fetch(`${base}/api/campaigns/${incomplete.id}/preflight`)).status, 401);
  } finally {
    server.close();
  }
});

test('preflight detects placeholders, deadline drift, repetition, links, and HTML accessibility', async () => {
  const { server, base, app } = bootApp();
  try {
    const s = await login(base);
    const output = [
      '<html><body>',
      '<img src="hero.jpg">',
      '<a href="">Apply now</a>',
      '<p>Hello {{first_name}}</p>',
      '<p>This exact sentence is intentionally repeated so the preflight can catch it.</p>',
      '<p>This exact sentence is intentionally repeated so the preflight can catch it.</p>',
      '</body></html>',
    ].join('');
    const info = app.locals.db.prepare(
      `INSERT INTO campaigns
       (kind, purpose, cta, cta_link, message_count, format, output, audience, sender, channel, deadline, source_context)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'generated',
      'Deadline reminder',
      'Apply now',
      'https://college.example.edu/apply',
      2,
      'html',
      output,
      'Prospective students',
      'Admissions',
      'email',
      '2026-08-21',
      JSON.stringify({ title: 'Official deadline', url: 'https://college.example.edu/deadlines' })
    );

    const check = await (await s.get(`/api/campaigns/${info.lastInsertRowid}/preflight`)).json();
    const codes = check.findings.map((finding) => finding.code);
    for (const code of ['placeholder', 'deadline_mismatch', 'repetition', 'cta_link_missing', 'image_alt', 'link_href']) {
      assert.ok(codes.includes(code), `${code} should be detected`);
    }
    assert.equal(app.locals.db.prepare('SELECT output FROM campaigns WHERE id = ?').get(info.lastInsertRowid).output, output);
  } finally {
    server.close();
  }
});

test('Audience Lane guidance persists once and unknown lanes are rejected', async () => {
  const { server, base } = bootApp();
  try {
    const s = await login(base);
    const capabilities = await (await s.get('/api/capabilities')).json();
    assert.ok(capabilities.audienceLanes.some((lane) => lane.id === 'adult-learners'));

    const response = await s.post('/api/campaigns/brief', {
      ...COMPLETE_FORM,
      audience_lane: 'adult-learners',
      audience_notes: 'Emphasize evening-friendly planning and prior experience.',
    });
    assert.equal(response.status, 201);
    const campaign = await response.json();
    assert.equal(campaign.audience_lane, 'adult-learners');
    assert.equal(campaign.audience_notes, 'Emphasize evening-friendly planning and prior experience.');
    assert.equal((campaign.output.match(/Audience lane: Adult learners/g) || []).length, 1);
    assert.match(campaign.output, /evening-friendly planning/);

    assert.equal((await s.post('/api/campaigns/brief', {
      ...COMPLETE_FORM,
      audience_lane: 'invented-lane',
    })).status, 400);
  } finally {
    server.close();
  }
});
