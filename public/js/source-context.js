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

// Server limits from SOURCE_FIELDS in server/routes/campaigns.js.
const MAX_TITLE = 500;
const MAX_EXCERPT = 4000;
const MAX_SOURCES_BLOCK = 2400;

const sourceLine = (item) =>
  `- ${item.label}: ${item.value} (${[item.geography, item.period].filter(Boolean).join(', ')}) ${item.publisher}, retrieved ${String(item.retrieved_at || '').slice(0, 10)}${item.stale ? ', stale' : ''}`;

// Many figures share a publisher, so each link is listed once.
const sourceLinks = (evidence) =>
  [...new Map(evidence.map((item) => [item.url, `${item.publisher}: ${item.url}`])).values()].join('\n');

export const researchSourcesText = (evidence = []) =>
  evidence.length ? `Sources\n${evidence.map(sourceLine).join('\n')}\n\nLinks\n${sourceLinks(evidence)}` : '';

function fitSourcesBlock(evidence = []) {
  const block = researchSourcesText(evidence);
  if (block.length <= MAX_SOURCES_BLOCK) return block;
  const links = sourceLinks(evidence);
  const lines = [];
  let length = 'Sources\n\n\nLinks\n'.length + links.length;
  for (const item of evidence) {
    const line = sourceLine(item);
    if (length + line.length + 40 > MAX_SOURCES_BLOCK) break;
    lines.push(line);
    length += line.length + 1;
  }
  return `Sources\n${lines.join('\n')}\n…and ${evidence.length - lines.length} more in the saved note\n\nLinks\n${links}`;
}

// Research questions have their own length limit, so keep the links when trimming an answer.
export function questionContext(excerpt, maxLength) {
  const [body, links] = String(excerpt).split('\n\nLinks\n');
  if (!links) return String(excerpt).slice(0, maxLength);
  const room = Math.max(0, maxLength - links.length - 9);
  return `${body.split('\n\nSources\n')[0].slice(0, room)}\n\nLinks\n${links}`;
}

// The verdict leads each advisor answer, so trimming the tail keeps what matters.
export const normalizeResearchSource = (response) => {
  const sources = fitSourcesBlock(response.evidence);
  const room = MAX_EXCERPT - (sources ? sources.length + 2 : 0);
  const answer = response.answer || '';
  const body = answer.length > room ? `${answer.slice(0, room - 1).trimEnd()}…` : answer;
  return clean({
    title: String(response.question || '').slice(0, MAX_TITLE),
    excerpt: sources ? `${body}\n\n${sources}` : body,
  });
};

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
    source.dataset ? `Dataset: ${source.dataset}` : '',
    source.measure ? `Measure: ${source.measure}` : '',
    source.institution ? `Institution: ${source.institution}` : '',
    source.term ? `Term: ${source.term}` : '',
    source.year ? `Year: ${source.year}` : '',
    source.dimensions ? `Dimensions: ${source.dimensions}` : '',
    source.as_of ? `As of: ${source.as_of}` : '',
    source.publisher,
    source.published_at,
    source.url,
    source.excerpt,
  ].filter(Boolean).join('\n');
