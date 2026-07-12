import Parser from 'rss-parser';

const UA = 'Mozilla/5.0 (compatible; EDMissions/0.1; personal dashboard)';
const parser = new Parser();

export const stripHtml = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function scoreText(title, excerpt, keywords) {
  const t = String(title).toLowerCase();
  const e = String(excerpt || '').toLowerCase();
  let score = 0;
  for (const kw of keywords) {
    const k = kw.toLowerCase();
    if (t.includes(k)) score += 3; // title hits outweigh excerpt hits
    if (e.includes(k)) score += 1;
  }
  return score;
}

export function normalizeItem(item, feed) {
  const isGoogleNews = feed.url.includes('news.google.com');
  let title = stripHtml(item.title || '');
  let excerpt = stripHtml(item.contentSnippet || item.content || item.summary || '');
  if (isGoogleNews) {
    // Google News item shape: title carries a " - Publisher" suffix and the
    // description is an HTML link cluster, not an excerpt.
    title = title.replace(/\s+-\s+[^-]+$/, '');
    excerpt = '';
  }
  return {
    source: feed.name,
    title,
    link: item.link || item.guid || '',
    excerpt: excerpt.slice(0, 400), // excerpt only — full article text is never stored (R9)
    published_at: item.isoDate || item.pubDate || null,
  };
}

export async function pollOnce(db, config) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO articles (source, title, link, excerpt, published_at, score) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const results = { added: 0, failed: [] };
  for (const feed of config.content.feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await parser.parseString(await res.text());
      for (const item of parsed.items || []) {
        const a = normalizeItem(item, feed);
        if (!a.title || !a.link) continue;
        const score = scoreText(a.title, a.excerpt, config.content.keywords);
        const info = insert.run(a.source, a.title, a.link, a.excerpt, a.published_at, score);
        results.added += Number(info.changes);
      }
    } catch (err) {
      // one dead or stalled feed never blocks the others
      results.failed.push({ feed: feed.name, error: String(err.message || err) });
      console.error(`[poller] ${feed.name}: ${err.message || err}`);
    }
  }
  return results;
}

export function startPolling(db, config) {
  let inFlight = false;
  const tick = async () => {
    if (inFlight) return; // a slow cycle never overlaps the next one
    inFlight = true;
    try {
      await pollOnce(db, config);
    } finally {
      inFlight = false;
    }
  };
  tick();
  const timer = setInterval(tick, config.pollMinutes * 60 * 1000);
  timer.unref?.();
  return timer;
}
