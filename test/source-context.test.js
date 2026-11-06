import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleSource, normalizeMomentSource, normalizeResearchSource, questionContext, researchSourcesText } from '../public/js/source-context.js';

test('article source normalization keeps its full source trail', () => {
  assert.deepEqual(
    normalizeArticleSource({
      title: 'Enrollment grows',
      source: 'SUNY Delhi',
      published_at: '2026-07-29T12:00:00Z',
      link: 'https://www.delhi.edu/news/enrollment/',
      excerpt: 'New students arrive.',
      lane: 'campus',
    }),
    {
      title: 'Enrollment grows',
      publisher: 'SUNY Delhi',
      published_at: '2026-07-29T12:00:00Z',
      url: 'https://www.delhi.edu/news/enrollment/',
      excerpt: 'New students arrive.',
      lane: 'campus',
    }
  );
});

test('research normalization keeps question and answer without inventing provenance', () => {
  assert.deepEqual(
    normalizeResearchSource({ question: 'How should technical colleges recruit?', answer: 'Lead with outcomes.' }),
    { title: 'How should technical colleges recruit?', excerpt: 'Lead with outcomes.' }
  );
});

test('moment normalization keeps its date, audience, and official source', () => {
  assert.deepEqual(
    normalizeMomentSource({
      name: 'Fall billing deadline',
      moment_date: '2026-08-21',
      audience: 'Deposited and current students',
      notes: 'Pay or arrange a plan.',
      source_url: 'https://www.delhi.edu/mydelhi-students/student-accounts/billing/',
      verified_at: '2026-07-30',
    }),
    {
      title: 'Fall billing deadline',
      moment_date: '2026-08-21',
      audience: 'Deposited and current students',
      excerpt: 'Pay or arrange a plan.',
      url: 'https://www.delhi.edu/mydelhi-students/student-accounts/billing/',
      published_at: '2026-07-30',
      lane: 'campus',
    }
  );
});

const advisorEvidence = (count = 1) => Array.from({ length: count }, (_, index) => ({
  label: `Registered Nurses figure ${index}`,
  value: '197,740',
  geography: 'New York-Newark-Jersey City, NY-NJ metro',
  period: '2025',
  publisher: 'U.S. Bureau of Labor Statistics, OEWS',
  url: 'https://www.bls.gov/oes/',
  retrieved_at: '2026-11-05T12:00:00.000Z',
  stale: index === 0,
}));

test('research sources travel in the excerpt with publisher, period, and URL', () => {
  const { excerpt } = normalizeResearchSource({ question: 'Subway?', answer: 'Test first.', evidence: advisorEvidence() });
  assert.match(excerpt, /^Test first\.\n\nSources\n/);
  assert.match(excerpt, /197,740/);
  assert.match(excerpt, /2025/);
  assert.match(excerpt, /Bureau of Labor Statistics/);
  assert.match(excerpt, /https:\/\/www\.bls\.gov\/oes\//);
  assert.match(excerpt, /stale/);
});

test('long research answers fit server source limits and keep the verdict and sources', () => {
  const answer = `Verdict: Test first. ${'Detail. '.repeat(1200)}`;
  const { title, excerpt } = normalizeResearchSource({
    question: 'Q'.repeat(2000),
    answer,
    evidence: advisorEvidence(),
  });
  assert.ok(answer.length > 9000);
  assert.equal(title.length, 500);
  assert.ok(excerpt.length <= 4000, `excerpt was ${excerpt.length}`);
  assert.match(excerpt, /^Verdict: Test first\./);
  assert.match(excerpt, /…\n\nSources\n/);
  assert.match(excerpt, /https:\/\/www\.bls\.gov\/oes\/$/);
});

test('a very long source list stays within limits and says what was left out', () => {
  const { excerpt } = normalizeResearchSource({ question: 'Q', answer: 'Verdict.', evidence: advisorEvidence(60) });
  assert.ok(excerpt.length <= 4000);
  assert.match(excerpt, /and \d+ more in the saved note\n\nLinks\n/);
  assert.equal(excerpt.match(/https:\/\/www\.bls\.gov\/oes\//g).length, 1);
});

test('saved sources include the retrieval date for fresh and stale figures', () => {
  const text = researchSourcesText(advisorEvidence(2));
  assert.equal(text.match(/retrieved 2026-11-05/g).length, 2);
  assert.match(text, /retrieved 2026-11-05, stale/);
});

test('question context keeps links and stays within the limit', () => {
  const { excerpt } = normalizeResearchSource({ question: 'Q', answer: `Verdict. ${'Detail. '.repeat(800)}`, evidence: advisorEvidence(3) });
  const context = questionContext(excerpt, 1200);
  assert.ok(context.length <= 1200, `context was ${context.length}`);
  assert.match(context, /^Verdict\./);
  assert.match(context, /https:\/\/www\.bls\.gov\/oes\/$/);
  assert.equal(questionContext('Plain article excerpt', 1200), 'Plain article excerpt');
});
