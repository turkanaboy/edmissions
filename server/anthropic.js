import Anthropic from '@anthropic-ai/sdk';

// The single AI module (origin KD: one swappable function set, no provider abstraction).
// Haiku keeps per-call cost negligible; caps bound the worst case.
const MODEL = 'claude-haiku-4-5';
const SUMMARY_MAX_TOKENS = 500;
const CAMPAIGN_TOKENS_PER_MESSAGE = 350;
const CAMPAIGN_MAX_TOKENS_CEILING = 8000;

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

    async generateCampaign(briefText, messageCount) {
      const maxTokens = Math.min(
        SUMMARY_MAX_TOKENS + CAMPAIGN_TOKENS_PER_MESSAGE * messageCount,
        CAMPAIGN_MAX_TOKENS_CEILING
      );
      const prompt = `${briefText}\n\nProduce the complete campaign now, plain text, no preamble.`;
      return complete(prompt, maxTokens);
    },
  };
}
