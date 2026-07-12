import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreText, stripHtml, normalizeItem } from '../server/poller.js';

const KEYWORDS = ['enrollment', 'admissions', 'yield', 'fafsa', 'financial aid'];

test('AE3: FAFSA article outscores general campus news', () => {
  const fafsa = scoreText('FAFSA delays reshape yield models', 'Financial aid timelines slip.', KEYWORDS);
  const dining = scoreText('New dining hall opens downtown', 'Tasty options for students.', KEYWORDS);
  assert.ok(fafsa > dining, `expected ${fafsa} > ${dining}`);
  assert.equal(dining, 0);
});

test('keyword in title scores higher than the same keyword in excerpt only', () => {
  const inTitle = scoreText('Enrollment strategies for 2027', '', KEYWORDS);
  const inExcerpt = scoreText('Campus update', 'A note on enrollment strategies.', KEYWORDS);
  assert.ok(inTitle > inExcerpt);
  assert.equal(inTitle, 3);
  assert.equal(inExcerpt, 1);
});

test('stripHtml removes markup and collapses whitespace', () => {
  assert.equal(stripHtml('<p>Hello <a href="x">world</a></p>'), 'Hello world');
  assert.equal(stripHtml('<div>a</div>\n\n<div>b</div>'), 'a b');
});

test('Google News items are normalized: title suffix stripped, excerpt blanked, source from config', () => {
  const feed = { name: 'The Chronicle', url: 'https://news.google.com/rss/search?q=site:chronicle.com' };
  const item = {
    title: 'Enrollment cliff arrives early - The Chronicle of Higher Education',
    link: 'https://news.google.com/rss/articles/abc123',
    contentSnippet: 'Enrollment cliff arrives early  The Chronicle of Higher Education',
  };
  const a = normalizeItem(item, feed);
  assert.equal(a.title, 'Enrollment cliff arrives early');
  assert.equal(a.excerpt, '');
  assert.equal(a.source, 'The Chronicle');
  assert.equal(a.link, 'https://news.google.com/rss/articles/abc123');
});

test('native feed items keep a truncated, HTML-stripped excerpt', () => {
  const feed = { name: 'Inside Higher Ed', url: 'https://www.insidehighered.com/rss.xml' };
  const item = {
    title: 'Yield modeling gets harder',
    link: 'https://ex.com/a',
    content: `<p>${'long text '.repeat(100)}</p>`,
  };
  const a = normalizeItem(item, feed);
  assert.ok(a.excerpt.length <= 400);
  assert.ok(!a.excerpt.includes('<'));
  assert.equal(a.source, 'Inside Higher Ed');
});

test('items fall back to guid when link is missing and drop when both absent', () => {
  const feed = { name: 'X', url: 'https://x.com/rss' };
  assert.equal(normalizeItem({ title: 'T', guid: 'https://x.com/g' }, feed).link, 'https://x.com/g');
  assert.equal(normalizeItem({ title: 'T' }, feed).link, '');
});

test('non-http(s) links are dropped at ingest (javascript:/data: XSS guard)', () => {
  const feed = { name: 'X', url: 'https://x.com/rss' };
  assert.equal(normalizeItem({ title: 'T', link: 'javascript:alert(1)' }, feed).link, '');
  assert.equal(normalizeItem({ title: 'T', link: 'data:text/html,<script>' }, feed).link, '');
  assert.equal(normalizeItem({ title: 'T', link: 'http://ok.example/a' }, feed).link, 'http://ok.example/a');
});
