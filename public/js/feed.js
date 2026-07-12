import { api, el } from './app.js';

const root = document.getElementById('feed-root');
const state = { starredOnly: false, articles: [], loading: true, polledOnEmpty: false };

async function load() {
  state.loading = true;
  render();
  try {
    const qs = state.starredOnly ? '?starred=1' : '';
    const data = await api('/api/articles' + qs);
    state.articles = data.articles;
    state.loading = false;
    // fresh instance: trigger the first poll ourselves instead of showing a blank panel
    if (!state.articles.length && !state.starredOnly && !state.polledOnEmpty) {
      state.polledOnEmpty = true;
      render();
      await api('/api/articles/poll', { method: 'POST' }).catch(() => {});
      return load();
    }
  } catch {
    state.loading = false;
  }
  render();
}

async function toggleStar(article) {
  const updated = await api(`/api/articles/${article.id}/star`, { method: 'POST' }).catch(() => null);
  if (updated) {
    article.starred = updated.starred;
    if (state.starredOnly && !article.starred) state.articles = state.articles.filter((a) => a.id !== article.id);
    render();
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
          class: 'btn-icon',
          title: a.starred ? 'Unstar' : 'Star',
          text: a.starred ? '★' : '☆',
          style: a.starred ? 'color:#ffd84d' : 'color:var(--dim)',
          onclick: () => toggleStar(a),
        }),
        el('button', {
          class: 'btn-icon',
          title: 'Add to notes',
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

function render() {
  root.replaceChildren(
    el(
      'div',
      { class: 'row', style: 'margin-bottom:.45rem' },
      el('span', {
        class: `pill${state.starredOnly ? '' : ' active'}`,
        text: 'All',
        onclick: () => {
          state.starredOnly = false;
          load();
        },
      }),
      el('span', {
        class: `pill${state.starredOnly ? ' active' : ''}`,
        text: '★ Starred',
        onclick: () => {
          state.starredOnly = true;
          load();
        },
      }),
      el('button', { class: 'btn btn-ghost', style: 'margin-left:auto', text: '↻', title: 'Refresh', onclick: () => load() })
    ),
    state.loading ? el('p', { class: 'muted', text: 'Fetching the latest headlines…' }) : null,
    !state.loading && !state.articles.length
      ? el('p', { class: 'muted', text: state.starredOnly ? 'Nothing starred yet.' : 'Fetching the latest headlines…' })
      : null,
    ...state.articles.map(articleRow)
  );
}

load();
