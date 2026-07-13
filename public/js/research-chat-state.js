export const addResponse = (chat, question, answer) => [
  ...chat,
  { question, answer, saved: false, saving: false },
];

export const markResponseSaved = (chat, target) =>
  chat.map((item) => (item === target ? { ...item, saved: true, saving: false } : item));

export const clearResponse = (chat, target) => chat.filter((item) => item !== target);
