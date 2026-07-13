import { api, el, mount, restoreFocus } from './app.js';

export const audio = new Audio();
audio.preload = 'none';
audio.volume = 0.8;

const state = { mode: 'off', queue: [], index: -1, fallback: null, loading: false };
const root = document.getElementById('player-root');
const listeners = new Set();
let errorStreak = 0;
let opId = 0; // bumps on each mode switch / search so a stale fetch can't overwrite the queue

export function onPlayerEvent(fn) {
  listeners.add(fn);
}
const emit = (type) => listeners.forEach((fn) => fn(type, state));

const current = () => state.queue[state.index] || null;

async function play(i, focusKey) {
  if (!state.queue.length) return;
  state.index = ((i % state.queue.length) + state.queue.length) % state.queue.length;
  audio.src = current().audio;
  try {
    await audio.play();
  } catch {
    /* autoplay guard or dead stream; the error handler advances */
  }
  render(focusKey);
  emit('track');
}

audio.addEventListener('playing', () => {
  errorStreak = 0;
  render();
});
audio.addEventListener('pause', () => render());
audio.addEventListener('ended', () => play(state.index + 1));
audio.addEventListener('error', () => {
  errorStreak += 1;
  if (state.queue.length > 1 && errorStreak < state.queue.length) play(state.index + 1);
});

export async function setMode(mode) {
  const myOp = ++opId;
  errorStreak = 0;
  state.mode = mode;
  document.querySelectorAll('#mode-bar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  });
  emit('mode');
  if (mode === 'off') {
    audio.pause();
    render();
    return;
  }
  state.loading = true;
  render();
  try {
    const result = await api(`/api/music/browse?mode=${encodeURIComponent(mode)}`);
    if (myOp !== opId) return; // a newer mode/search superseded this one
    state.queue = result.tracks;
    state.fallback = result.source === 'local' ? result.fallback || 'local library' : null;
    state.loading = false;
    if (!state.queue.length) {
      state.index = -1;
      render();
      return;
    }
    await play(0);
  } catch (err) {
    if (myOp !== opId) return;
    state.loading = false;
    state.queue = [];
    state.fallback = err.message;
    render();
  }
}

async function runSearch(q) {
  const myOp = ++opId;
  errorStreak = 0;
  state.loading = true;
  render('music-search');
  try {
    const result = await api(`/api/music/search?q=${encodeURIComponent(q)}`);
    if (myOp !== opId) return;
    state.queue = result.tracks;
    state.fallback = result.source === 'local' ? 'local library' : null;
    state.loading = false;
    if (state.queue.length) await play(0, 'music-search');
    else render('music-search');
  } catch (err) {
    if (myOp !== opId) return;
    state.loading = false;
    state.fallback = err.message;
    render('music-search');
  }
}

function render(focusKey) {
  const activeKey = focusKey || (root.contains(document.activeElement) ? document.activeElement.dataset.focus : null);
  const track = current();
  const upNext = state.queue.slice(state.index + 1, state.index + 4);
  mount(
    root,
    state.loading ? el('p', { class: 'muted', text: 'Tuning in…' }) : null,
    !state.loading && state.mode === 'off' && !track
      ? el('p', { class: 'muted', text: 'Pick a mode to start the music.' })
      : null,
    !state.loading && state.mode !== 'off' && !track
      ? el('p', {
          class: 'muted',
          text: state.fallback
            ? `No tracks available — ${state.fallback}. Drop audio files in data/music or add a Jamendo client id.`
            : 'No tracks found for this mode.',
        })
      : null,
    track
      ? el(
          'div',
          { class: 'stack' },
          el('div', {}, el('strong', { text: track.name }), el('div', { class: 'meta muted', text: track.artist })),
          state.fallback ? el('span', { class: 'pill badge', text: `⟂ ${state.fallback}` }) : null
        )
      : null,
    el(
      'div',
      { class: 'row', style: 'margin-top:.6rem' },
      el('button', { class: 'btn', title: 'Previous', 'aria-label': 'Previous track', 'data-focus': 'player-previous', onclick: () => play(state.index - 1, 'player-previous'), text: '⏮' }),
      el('button', {
        class: 'btn btn-neon',
        title: 'Play / pause',
        'aria-label': audio.paused ? 'Play' : 'Pause',
        'data-focus': 'player-toggle',
        text: audio.paused ? '▶' : '⏸',
        onclick: () => {
          if (audio.paused) {
            if (track) audio.play().catch(() => {});
            else if (state.mode !== 'off') setMode(state.mode);
          } else audio.pause();
        },
      }),
      el('button', { class: 'btn', title: 'Skip', 'aria-label': 'Next track', 'data-focus': 'player-next', onclick: () => play(state.index + 1, 'player-next'), text: '⏭' }),
      el('input', {
        type: 'range',
        'aria-label': 'Volume',
        min: '0',
        max: '1',
        step: '0.05',
        value: String(audio.volume),
        style: 'width:90px',
        oninput: (e) => {
          audio.volume = Number(e.target.value);
        },
      })
    ),
    el(
      'form',
      {
        class: 'row',
        style: 'margin-top:.6rem',
        onsubmit: (e) => {
          e.preventDefault();
          const q = e.target.q.value.trim();
          if (q) runSearch(q);
        },
      },
      el('input', { name: 'q', 'aria-label': 'Search music', 'data-focus': 'music-search', placeholder: 'search open-source EDM…' }),
      el('button', { class: 'btn', text: 'Go' })
    ),
    upNext.length
      ? el(
          'div',
          { style: 'margin-top:.6rem' },
          el('div', { class: 'meta muted', text: 'Up next' }),
          ...upNext.map((t, i) =>
            el('div', { class: 'list-item' }, el('a', {
              href: '#',
              text: `${t.name} — ${t.artist}`,
              onclick: (e) => {
                e.preventDefault();
                play(state.index + 1 + i);
              },
            }))
          )
        )
      : null
  );
  restoreFocus(root, activeKey);
}

export function init() {
  document.getElementById('mode-bar').addEventListener('click', (e) => {
    const mode = e.target.dataset?.mode;
    if (mode) setMode(mode); // the click is the user gesture that unlocks audio playback
  });
  render();
}
