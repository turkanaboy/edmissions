import test from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, login, makeMusicDir, stubJamendo, jamendoEnvelope, jamendoTrack } from './helpers.js';

const CID = { EDMISSIONS_JAMENDO_CLIENT_ID: 'test-cid' };

test('chill browse queries Jamendo with the chill fuzzytags pool', async () => {
  const { server, base } = bootApp(CID);
  const calls = [];
  const restore = stubJamendo((url) => {
    calls.push(url);
    return jamendoEnvelope([jamendoTrack(7)]);
  });
  try {
    const s = await login(base);
    const res = await s.get('/api/music/browse?mode=chill');
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.source, 'jamendo');
    assert.equal(data.tracks[0].audio, '/api/music/audio/7');
    assert.equal(data.tracks[0].artist, 'Test Artist');
    const q = decodeURIComponent(calls[0]);
    assert.match(q, /fuzzytags=.*lofi/);
    assert.match(q, /bluegrass/);
    assert.match(q, /client_id=test-cid/);
  } finally {
    restore();
    server.close();
  }
});

test('AE4: network rejection falls back to the local library', async () => {
  const musicDir = makeMusicDir();
  const { server, base } = bootApp({ ...CID, EDMISSIONS_MUSIC_DIR: musicDir });
  const restore = stubJamendo(() => {
    throw new Error('network down');
  });
  try {
    const s = await login(base);
    const data = await (await s.get('/api/music/browse?mode=intense')).json();
    assert.equal(data.source, 'local');
    assert.equal(data.tracks.length, 2);
    assert.match(data.fallback, /network down/);
    assert.equal(data.tracks[0].audio, '/api/music/local/0');
  } finally {
    restore();
    server.close();
  }
});

test('resolved HTTP 401 and error envelopes also trigger the fallback', async () => {
  const musicDir = makeMusicDir(['one.mp3']);
  const { server, base } = bootApp({ ...CID, EDMISSIONS_MUSIC_DIR: musicDir });
  let restore = stubJamendo(() => new Response('', { status: 401 }));
  try {
    const s = await login(base);
    let data = await (await s.get('/api/music/browse?mode=vibing')).json();
    assert.equal(data.source, 'local');
    assert.match(data.fallback, /HTTP 401/);

    restore();
    restore = stubJamendo(
      () =>
        new Response(JSON.stringify({ headers: { status: 'failed', error_message: 'invalid client' }, results: [] }), {
          headers: { 'Content-Type': 'application/json' },
        })
    );
    data = await (await s.get('/api/music/browse?mode=vibing')).json();
    assert.equal(data.source, 'local');
    assert.match(data.fallback, /invalid client/);
  } finally {
    restore();
    server.close();
  }
});

test('missing client id short-circuits to local without calling Jamendo', async () => {
  const musicDir = makeMusicDir(['solo.mp3']);
  const { server, base } = bootApp({ EDMISSIONS_MUSIC_DIR: musicDir });
  let called = false;
  const restore = stubJamendo(() => {
    called = true;
    return jamendoEnvelope([]);
  });
  try {
    const s = await login(base);
    const data = await (await s.get('/api/music/browse?mode=chill')).json();
    assert.equal(data.source, 'local');
    assert.equal(called, false);
    assert.equal(data.tracks.length, 1);
  } finally {
    restore();
    server.close();
  }
});

test('unknown mode is a 400', async () => {
  const { server, base } = bootApp(CID);
  try {
    const s = await login(base);
    assert.equal((await s.get('/api/music/browse?mode=rager')).status, 400);
  } finally {
    server.close();
  }
});

test('audio proxy forwards Range and relays 206 with headers', async () => {
  const { server, base } = bootApp(CID);
  let upstreamRange = null;
  const restore = stubJamendo((url, opts) => {
    if (url.includes('api.jamendo.com')) return jamendoEnvelope([jamendoTrack(42)]);
    upstreamRange = opts?.headers?.range || null;
    return new Response(Buffer.from('ab'), {
      status: 206,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Range': 'bytes 0-1/1000',
        'Accept-Ranges': 'bytes',
        'Content-Length': '2',
      },
    });
  });
  try {
    const s = await login(base);
    await s.get('/api/music/browse?mode=chill'); // primes the id -> audio-url cache
    const res = await s.getRaw('/api/music/audio/42', { headers: { Range: 'bytes=0-1' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-1/1000');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(upstreamRange, 'bytes=0-1');
  } finally {
    restore();
    server.close();
  }
});

test('audio proxy refuses non-Jamendo hosts', async () => {
  const { server, base } = bootApp(CID);
  const restore = stubJamendo((url) => {
    if (url.includes('api.jamendo.com')) {
      return jamendoEnvelope([jamendoTrack(66, { audio: 'https://evil.example.com/x.mp3' })]);
    }
    throw new Error('should never fetch evil host');
  });
  try {
    const s = await login(base);
    await s.get('/api/music/browse?mode=chill');
    const res = await s.get('/api/music/audio/66');
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /non-Jamendo/);
  } finally {
    restore();
    server.close();
  }
});

test('local files serve with native Range support', async () => {
  const musicDir = makeMusicDir(['alpha.mp3']);
  const { server, base } = bootApp({ EDMISSIONS_MUSIC_DIR: musicDir });
  try {
    const s = await login(base);
    const full = await s.get('/api/music/local/0');
    assert.equal(full.status, 200);
    const partial = await s.getRaw('/api/music/local/0', { headers: { Range: 'bytes=0-3' } });
    assert.equal(partial.status, 206);
    assert.ok(partial.headers.get('content-range'));
    assert.equal((await s.get('/api/music/local/99')).status, 404);
  } finally {
    server.close();
  }
});

test('search proxies the query and normalizes results', async () => {
  const { server, base } = bootApp(CID);
  const calls = [];
  const restore = stubJamendo((url) => {
    calls.push(url);
    return jamendoEnvelope([jamendoTrack(5, { name: 'Neon Cathedral' })]);
  });
  try {
    const s = await login(base);
    const data = await (await s.get('/api/music/search?q=neon')).json();
    assert.match(decodeURIComponent(calls[0]), /search=neon/);
    assert.equal(data.tracks[0].name, 'Neon Cathedral');
    assert.equal((await s.get('/api/music/search?q=')).status, 400);
  } finally {
    restore();
    server.close();
  }
});
