const clean = (source) =>
  Object.fromEntries(Object.entries(source).filter(([, value]) => String(value || '').trim()));

export const normalizeArticleSource = (article) => clean({
  title: article.title,
  publisher: article.source,
  published_at: article.published_at,
  url: article.link,
  excerpt: article.excerpt,
  lane: article.lane,
});

export const normalizeResearchSource = (response) => clean({
  title: response.question,
  excerpt: response.answer,
});

export const sourceBody = (source) =>
  [source.title, source.publisher, source.published_at, source.url, source.excerpt].filter(Boolean).join('\n');
