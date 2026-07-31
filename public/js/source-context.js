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

export const normalizeMomentSource = (moment) => clean({
  title: moment.name,
  moment_date: moment.moment_date,
  audience: moment.audience,
  excerpt: moment.notes,
  url: moment.source_url,
  published_at: moment.verified_at,
  lane: 'campus',
});

export const sourceBody = (source) =>
  [
    source.title,
    source.moment_date ? `Date: ${source.moment_date}` : '',
    source.audience ? `Audience: ${source.audience}` : '',
    source.publisher,
    source.published_at,
    source.url,
    source.excerpt,
  ].filter(Boolean).join('\n');
