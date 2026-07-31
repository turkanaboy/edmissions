import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleSource, normalizeResearchSource } from '../public/js/source-context.js';

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
