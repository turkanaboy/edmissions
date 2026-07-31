import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_MODEL, AI_REASONING_EFFORT, createAi } from '../server/openai.js';

test('OpenAI requests use GPT-5.6 Luna at high effort without response storage', async () => {
  const calls = [];
  const client = {
    responses: {
      create: async (request) => {
        calls.push(request);
        return { output_text: '  A useful answer.  ' };
      },
    },
  };
  const ai = createAi({ openAiKey: 'test-key' }, client);

  const answer = await ai.researchAnswer(
    'How should we recruit adult learners?',
    [{ question: 'What is our focus?', answer: 'Flexible pathways.' }],
    'Name: SUNY Delhi\nApproved facts: 60+ programs.'
  );

  assert.equal(answer, 'A useful answer.');
  assert.equal(AI_MODEL, 'gpt-5.6-luna');
  assert.equal(AI_REASONING_EFFORT, 'high');
  assert.equal(calls[0].model, 'gpt-5.6-luna');
  assert.deepEqual(calls[0].reasoning, { effort: 'high' });
  assert.equal(calls[0].store, false);
  assert.equal(calls[0].max_output_tokens, 4000);
  assert.match(calls[0].input, /SUNY Delhi/);
  assert.match(calls[0].input, /Previous conversation/);
});
