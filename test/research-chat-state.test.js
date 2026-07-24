import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addResponse,
  buildResearchHandoff,
  clearResponse,
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
