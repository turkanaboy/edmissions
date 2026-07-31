import Parser from 'rss-parser';

const UA = 'Mozilla/5.0 (compatible; EDMissions/0.1; personal dashboard)';
const parser = new Parser();
const LANE_RANK = { campus: 0, local: 1, suny: 2, national: 3 };
const laneFor = (feed) => Object.hasOwn(LANE_RANK, feed.lane) ? feed.lane : 'national';

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

export function keepArticleTitle(title) {
  const text = String(title || '');
  const looksLikeJob = /\b(job|jobs|hiring|career|position|vacancy|opening|opportunity|seeks?|searching for)\b/i.test(text);
  if (!looksLikeJob) return true;
  return /\benrollment\b/i.test(text) && /\b(vp|v\.p\.|vice[- ]president)\b/i.test(text);
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
  const link = item.link || item.guid || '';
  return {
    source: feed.name,
    lane: laneFor(feed),
    title,
    // drop non-http(s) links at ingest so a hostile feed can't store a javascript: URL
    link: /^https?:\/\//i.test(link) ? link : '',
    excerpt: excerpt.slice(0, 400), // excerpt only — full article text is never stored (R9)
    published_at: item.isoDate || item.pubDate || null,
  };
}

export async function pollOnce(db, config) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO articles (source, lane, title, link, excerpt, published_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const status = db.prepare(
    `INSERT INTO feed_status (source, lane, ok, error, checked_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(source) DO UPDATE SET lane = excluded.lane, ok = excluded.ok,
       error = excluded.error, checked_at = excluded.checked_at`
  );
  const results = { added: 0, failed: [] };
  for (const feed of config.content.feeds) {
    const lane = laneFor(feed);
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = await parser.parseString(await res.text());
      for (const item of parsed.items || []) {
        const a = normalizeItem(item, feed);
        if (!a.title || !a.link || !keepArticleTitle(a.title)) continue;
        const score = scoreText(a.title, a.excerpt, config.content.keywords);
        const info = insert.run(a.source, a.lane, a.title, a.link, a.excerpt, a.published_at, score);
        results.added += Number(info.changes);
        if (!Number(info.changes)) {
          const existing = db.prepare('SELECT lane FROM articles WHERE link = ?').get(a.link);
          if (LANE_RANK[a.lane] < LANE_RANK[existing?.lane || 'national']) {
            db.prepare('UPDATE articles SET source = ?, lane = ? WHERE link = ?').run(a.source, a.lane, a.link);
          }
        }
      }
      status.run(feed.name, lane, 1, '');
    } catch (err) {
      // one dead or stalled feed never blocks the others
      const message = String(err.message || err).slice(0, 300);
      status.run(feed.name, lane, 0, message);
      results.failed.push({ feed: feed.name, error: message });
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
    } catch (err) {
      // pollOnce isolates per-feed failures; this catches anything above that loop
      // (e.g. a prepared-statement error) so a background tick can never crash the process
      console.error(`[poller] tick failed: ${err.message || err}`);
    } finally {
      inFlight = false;
    }
  };
  tick();
  const timer = setInterval(tick, config.pollMinutes * 60 * 1000);
  timer.unref?.();
  return timer;
}
