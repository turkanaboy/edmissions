import { Router } from 'express';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const JAMENDO = 'https://api.jamendo.com/v3.0';
const AUDIO_EXT = /\.(mp3|ogg|m4a|flac|wav|webm)$/i;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

export function musicRoutes(config) {
  const router = Router();
  const trackCache = new Map(); // jamendo track id -> upstream audio url (server-side only)

  const scanNames = () => {
    try {
      return readdirSync(config.musicDir).filter((n) => AUDIO_EXT.test(n)).sort();
    } catch {
      return []; // no music folder yet — that's fine
    }
  };

  const localTracks = () =>
    scanNames().map((name, i) => ({
      id: `local-${i}`,
      name: name.replace(AUDIO_EXT, '').replace(/[-_]+/g, ' '),
      artist: 'Local library',
      duration: null,
      audio: `/api/music/local/${i}`,
      source: 'local',
    }));

  const jamendoTracks = async (params) => {
    const url = new URL(`${JAMENDO}/tracks`);
    url.search = new URLSearchParams({
      client_id: config.jamendoClientId,
      format: 'json',
      audioformat: 'mp32',
      limit: '50',
      ...params,
    }).toString();
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Jamendo HTTP ${res.status}`);
    const data = await res.json();
    if (data.headers?.status !== 'success') {
      throw new Error(`Jamendo error: ${data.headers?.error_message || 'unknown'}`);
    }
    return (data.results || []).map((t) => {
      if (t.audio) trackCache.set(String(t.id), t.audio);
      return {
        id: String(t.id),
        name: t.name,
        artist: t.artist_name,
        duration: t.duration,
        audio: `/api/music/audio/${t.id}`,
        source: 'jamendo',
      };
    });
  };

  // Fallback fires on ANY non-success: missing client id, rejection, HTTP error,
  // error envelope, or zero usable tracks — not just network failure.
  const withFallback = async (fn) => {
    if (!config.jamendoClientId) {
      return { source: 'local', fallback: 'no Jamendo client id configured', tracks: localTracks() };
    }
    try {
      const tracks = await fn();
      if (tracks.length > 0) return { source: 'jamendo', tracks };
      return { source: 'local', fallback: 'Jamendo returned no tracks', tracks: localTracks() };
    } catch (err) {
      return { source: 'local', fallback: String(err.message || err), tracks: localTracks() };
    }
  };

  router.get('/browse', async (req, res) => {
    const mode = config.content.modes[req.query.mode];
    if (!mode) return res.status(400).json({ error: 'Unknown mode' });
    const result = await withFallback(async () => {
      const fuzzytags = mode.tags.join('+');
      // ponytail: random offset rotates the pool between sessions; retry at 0 covers thin tags
      const offset = Math.floor(Math.random() * 200);
      let tracks = await jamendoTracks({ fuzzytags, offset: String(offset) });
      if (tracks.length === 0 && offset > 0) tracks = await jamendoTracks({ fuzzytags, offset: '0' });
      return tracks.sort(() => Math.random() - 0.5);
    });
    res.json(result);
  });

  router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'Missing q' });
    const result = await withFallback(() => jamendoTracks({ search: q }));
    if (result.source === 'local') {
      result.tracks = result.tracks.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
    }
    res.json(result);
  });

  router.get('/local', (req, res) => res.json({ source: 'local', tracks: localTracks() }));

  // Index-based lookup of server-scanned filenames: client input never reaches the filesystem
  // as a path, and res.sendFile handles Range requests natively.
  router.get('/local/:idx', (req, res) => {
    const names = scanNames();
    const idx = Number(req.params.idx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= names.length) {
      return res.status(404).json({ error: 'No such track' });
    }
    res.sendFile(path.resolve(config.musicDir, names[idx]));
  });

  router.get('/audio/:trackId', async (req, res) => {
    const id = String(req.params.trackId);
    let audioUrl = trackCache.get(id);
    if (!audioUrl) {
      await jamendoTracks({ id }).catch(() => {});
      audioUrl = trackCache.get(id);
    }
    if (!audioUrl) return res.status(404).json({ error: 'Unknown track' });

    // The URL came from Jamendo's API, but verify the host anyway — this route must
    // never become a generic fetch proxy.
    let host;
    try {
      host = new URL(audioUrl).hostname;
    } catch {
      return res.status(502).json({ error: 'Bad upstream URL' });
    }
    if (host !== 'jamendo.com' && !host.endsWith('.jamendo.com')) {
      return res.status(502).json({ error: 'Refusing non-Jamendo audio host' });
    }

    const headers = {};
    if (req.headers.range) headers.range = req.headers.range;
    const upstream = await fetch(audioUrl, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!upstream || !upstream.ok) return res.status(502).json({ error: 'Upstream audio failed' });
    if (Number(upstream.headers.get('content-length') || 0) > MAX_AUDIO_BYTES) {
      return res.status(502).json({ error: 'Upstream response too large' });
    }

    res.status(upstream.status); // relay 206 vs 200 so seeking works
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!upstream.headers.get('accept-ranges')) res.setHeader('accept-ranges', 'bytes');
    // pipeline (not bare .pipe) forwards stream errors and destroys both sides, so an
    // upstream reset or a client disconnect mid-stream can't throw an uncaught exception.
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      if (!res.headersSent) res.status(502).json({ error: 'Audio stream failed' });
      else res.destroy();
    }
  });

  return router;
}
