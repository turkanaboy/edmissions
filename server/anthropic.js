import Anthropic from '@anthropic-ai/sdk';

// The single AI module (origin KD: one swappable function set, no provider abstraction).
// Haiku keeps per-call cost negligible; caps bound the worst case.
const MODEL = 'claude-haiku-4-5';
const SUMMARY_MAX_TOKENS = 500;
const CAMPAIGN_TOKENS_PER_MESSAGE = 350;
const CAMPAIGN_MAX_TOKENS_CEILING = 8000;
const RESEARCH_MAX_TOKENS = 1200;

export function createAi(config) {
  const enabled = Boolean(config.anthropicKey);
  let client = null;
  const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropicKey }));

  const textOf = (response) =>
    response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

  const complete = async (prompt, maxTokens) => {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return textOf(response);
  };

  return {
    enabled,

    async summarizeNote(body) {
      const prompt =
        'Summarize the following research note in 3-5 sentences for a higher-ed enrollment professional. ' +
        'Keep concrete numbers, dates, institutions, and action items. Plain text only, no preamble.\n\n' +
        `Note:\n${body}`;
      return complete(prompt, SUMMARY_MAX_TOKENS);
    },

    async generateCampaign(briefText, messageCount, format = 'text') {
      const maxTokens = Math.min(
        SUMMARY_MAX_TOKENS + CAMPAIGN_TOKENS_PER_MESSAGE * messageCount,
        CAMPAIGN_MAX_TOKENS_CEILING
      );
      const prompt = `${briefText}\n\nProduce the complete campaign now, ${format === 'html' ? 'valid HTML' : 'plain text'}, no preamble.`;
      return complete(prompt, maxTokens);
    },

    async researchAnswer(question, history = []) {
      const context = history.length
        ? `Previous conversation, oldest first:\n\n${history
            .map(({ question: previousQuestion, answer }, index) => `Exchange ${index + 1}\nQuestion: ${previousQuestion}\nAnswer: ${answer}`)
            .join('\n\n')}\n\n`
        : '';
      const prompt =
        'Answer this question for a higher-education enrollment professional. Use the previous conversation to understand follow-up references and avoid needless repetition. Give practical, specific suggestions, note assumptions, and finish with 2 useful next questions. Do not invent statistics or institutional facts. Plain text only, no preamble.\n\n' +
        context +
        `Current question: ${question}`;
      return complete(prompt, RESEARCH_MAX_TOKENS);
    },
  };
}
