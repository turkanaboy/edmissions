import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addResponse,
  buildResearchHandoff,
  clearResponse,
  hasSlateData,
  markResponseSaved,
  recentResearchHistory,
} from '../public/js/research-chat-state.js';

test('a saved response does not mark a follow-up response as saved', () => {
  let chat = addResponse([], 'First question', 'First answer');
  chat = markResponseSaved(chat, chat[0]);
  chat = addResponse(chat, 'Follow-up question', 'Follow-up answer');

  assert.equal(chat[0].saved, true);
  assert.equal(chat[1].saved, false);
  assert.deepEqual(clearResponse(chat, chat[1]), [chat[0]]);
});

test('follow-ups use five exchanges and can be bundled for ChatGPT', () => {
  const chat = Array.from({ length: 6 }, (_, index) => ({
    question: `Question ${index + 1}`,
    answer: `Answer ${index + 1}`,
    saved: false,
  }));

  assert.deepEqual(recentResearchHistory(chat).map((item) => item.question), [
    'Question 2',
    'Question 3',
    'Question 4',
    'Question 5',
    'Question 6',
  ]);
  assert.match(buildResearchHandoff(chat, 'Go deeper'), /Exchange 1[\s\S]*Exchange 6[\s\S]*Next request\nUser: Go deeper/);
});

test('responses keep evidence and flags, and follow-ups send only the conversation', () => {
  const evidence = [{ label: 'RN employment', value: '197,740' }];
  const chat = addResponse([], 'Subway ad?', 'Test first.', { evidence, unsourced_figures: ['$9,999'] });
  assert.deepEqual(chat[0].evidence, evidence);
  assert.deepEqual(chat[0].unsourced, ['$9,999']);
  assert.deepEqual(recentResearchHistory(chat), [{ question: 'Subway ad?', answer: 'Test first.' }]);
  assert.deepEqual(addResponse([], 'Plain', 'Answer')[0].evidence, []);
});

test('a flagged figure stays flagged when a follow-up repeats it', () => {
  let chat = addResponse([], 'First', 'It costs $9,999.', { unsourced_figures: ['$9,999'] });
  chat = addResponse(chat, 'Again?', 'Yes, $9,999 as noted.', { unsourced_figures: [] });
  chat = addResponse(chat, 'Other?', 'Something else.', { unsourced_figures: [] });
  assert.deepEqual(chat[1].unsourced, ['$9,999']);
  assert.deepEqual(chat[2].unsourced, []);
});

test('Slate use blocks handoff for the response and its follow-ups until cleared', () => {
  let chat = addResponse([], 'Public', 'Answer');
  assert.equal(hasSlateData(chat), false);
  chat = addResponse(chat, 'Pipeline', 'Kings has 40.', { usedSlate: true });
  chat = addResponse(chat, 'Follow-up', 'Still 40.');
  assert.equal(chat[2].usedSlate, true);
  assert.equal(hasSlateData(chat), true);
  assert.equal(hasSlateData(clearResponse(clearResponse(chat, chat[2]), chat[1])), false);
});
