export const addResponse = (chat, question, answer) => [
  ...chat,
  { question, answer, saved: false, saving: false },
];

export const markResponseSaved = (chat, target) =>
  chat.map((item) => (item === target ? { ...item, saved: true, saving: false } : item));

export const clearResponse = (chat, target) => chat.filter((item) => item !== target);

export const recentResearchHistory = (chat) =>
  chat.slice(-5).map(({ question, answer }) => ({ question, answer }));

export const buildResearchHandoff = (chat, draft = '') =>
  [
    'Continue this higher-education enrollment research conversation. Use the transcript as context, then respond to the next request.',
    ...chat.map(
      ({ question, answer }, index) =>
        `Exchange ${index + 1}\nUser: ${question}\nAssistant: ${answer}`
    ),
    draft.trim() ? `Next request\nUser: ${draft.trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
