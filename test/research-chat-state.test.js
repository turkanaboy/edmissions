import test from 'node:test';
import assert from 'node:assert/strict';
import { addResponse, clearResponse, markResponseSaved } from '../public/js/research-chat-state.js';

test('a saved response does not mark a follow-up response as saved', () => {
  let chat = addResponse([], 'First question', 'First answer');
  chat = markResponseSaved(chat, chat[0]);
  chat = addResponse(chat, 'Follow-up question', 'Follow-up answer');

  assert.equal(chat[0].saved, true);
  assert.equal(chat[1].saved, false);
  assert.deepEqual(clearResponse(chat, chat[1]), [chat[0]]);
});
