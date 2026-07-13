import { announce, api, el, mount, restoreFocus } from './app.js';

const root = document.getElementById('feed-root');
const state = { starredOnly: false, articles: [], loading: true, error: null, polledOnEmpty: false };
let loadId = 0; // a fast All/Starred toggle or double-click can't let a stale response win

async function load({ focusKey, announceResult = false } = {}) {
  const myLoad = ++loadId;
  state.loading = true;
  state.error = null;
  render(focusKey);
  try {
    const qs = state.starredOnly ? '?starred=1' : '';
    const data = await api('/api/articles' + qs);
    if (myLoad !== loadId) return;
    state.articles = data.articles;
    state.loading = false;
    // fresh instance: trigger the first poll ourselves instead of showing a blank panel
    if (!state.articles.length && !state.starredOnly && !state.polledOnEmpty) {
      state.polledOnEmpty = true;
      render(focusKey);
      await api('/api/articles/poll', { method: 'POST' }).catch(() => {});
      return load({ focusKey, announceResult });
    }
  } catch (err) {
    if (myLoad !== loadId) return;
    state.loading = false;
    state.error = `Could not load headlines: ${err.message}`;
  }
  render(focusKey);
  if (announceResult && !state.error) announce('Headlines refreshed.');
}

async function toggleStar(article) {
  const updated = await api(`/api/articles/${article.id}/star`, { method: 'POST' }).catch(() => null);
  if (updated) {
    article.starred = updated.starred;
    if (state.starredOnly && !article.starred) state.articles = state.articles.filter((a) => a.id !== article.id);
    render(state.articles.includes(article) ? `star-${article.id}` : 'feed-starred');
  } else {
    state.error = 'Could not update this article — try again.';
    render(`star-${article.id}`);
  }
}

const fmtDate = (iso) => {
  const d = new Date(iso || '');
  return Number.isNaN(d.valueOf()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function articleRow(a) {
  return el(
    'div',
    { class: 'list-item' },
    el(
      'div',
      { class: 'row', style: 'justify-content:space-between; align-items:flex-start; gap:.4rem' },
      // remote text goes through textContent only — never innerHTML
      el('a', { href: a.link, target: '_blank', rel: 'noopener noreferrer', text: a.title }),
      el(
        'div',
        { class: 'row', style: 'flex:none' },
        el('button', {
          class: `btn-icon${a.starred ? ' starred' : ''}`,
          title: a.starred ? 'Unstar' : 'Star',
          'aria-label': a.starred ? 'Unstar article' : 'Star article',
          'data-focus': `star-${a.id}`,
          text: a.starred ? '★' : '☆',
          onclick: () => toggleStar(a),
        }),
        el('button', {
          class: 'btn-icon',
          title: 'Add to notes',
          'aria-label': 'Add article to notes',
          text: '+',
          onclick: () => document.dispatchEvent(new CustomEvent('edm:add-to-note', { detail: a })),
        })
      )
    ),
    el(
      'div',
      { class: 'meta' },
      el('span', { text: `${a.source}${fmtDate(a.published_at) ? ' · ' + fmtDate(a.published_at) : ''}` }),
      a.score > 0 ? el('span', { class: 'pill badge', style: 'margin-left:.45rem', text: 'enrollment' }) : null
    ),
    a.excerpt ? el('div', { class: 'meta muted', text: a.excerpt }) : null
  );
}

function render(focusKey) {
  mount(
    root,
    el(
      'div',
      { class: 'row', style: 'margin-bottom:.45rem' },
      el('button', {
        type: 'button',
        class: `pill${state.starredOnly ? '' : ' active'}`,
        'aria-pressed': String(!state.starredOnly),
        'data-focus': 'feed-all',
        text: 'All',
        onclick: () => {
          state.starredOnly = false;
          load({ focusKey: 'feed-all' });
        },
      }),
      el('button', {
        type: 'button',
        class: `pill${state.starredOnly ? ' active' : ''}`,
        'aria-pressed': String(state.starredOnly),
        'data-focus': 'feed-starred',
        text: '★ Starred',
        onclick: () => {
          state.starredOnly = true;
          load({ focusKey: 'feed-starred' });
        },
      }),
      el('button', { class: 'btn btn-ghost', style: 'margin-left:auto', text: '↻', title: 'Refresh', 'aria-label': 'Refresh headlines', 'data-focus': 'feed-refresh', onclick: () => load({ focusKey: 'feed-refresh', announceResult: true }) })
    ),
    state.loading ? el('p', { class: 'muted', role: 'status', text: 'Fetching the latest headlines…' }) : null,
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    !state.loading && !state.error && !state.articles.length
      ? el('p', { class: 'muted', role: 'status', text: state.starredOnly ? 'Nothing starred yet.' : 'No recent headlines found.' })
      : null,
    ...state.articles.map(articleRow)
  );
  restoreFocus(root, focusKey, state.starredOnly ? 'feed-starred' : 'feed-all');
}

export function init() {
  load();
}
