import { announce, api, el, mount } from './app.js';
import { openWorkbench } from './workbench.js';

const root = document.getElementById('data-root');
const state = {
  slate: null,
  slateUrl: '',
  suny: { snapshot: null, cards: [] },
  sources: [],
  busy: '',
  error: '',
};

const field = (label, control, hint) =>
  el('label', { class: 'field' }, el('span', { text: label }), control, hint ? el('small', { text: hint }) : null);

const comparison = (card) => {
  if (card.prior_year_count === null || card.prior_year_count === undefined) return '';
  const change = card.count - card.prior_year_count;
  return `${change >= 0 ? '+' : ''}${change.toLocaleString()} vs. prior year`;
};

function metricCard(card) {
  return el('article', { class: 'data-card' },
    el('span', { class: 'eyebrow', text: card.source_context.dataset }),
    el('strong', { class: 'data-value', text: card.count.toLocaleString() }),
    el('h3', { text: card.title }),
    comparison(card) ? el('p', { class: 'meta', text: comparison(card) }) : null,
    card.goal !== null && card.goal !== undefined
      ? el('p', { class: 'meta', text: `${card.goal.toLocaleString()} goal` })
      : null,
    el('button', {
      class: 'text-button',
      text: 'Use this →',
      onclick: (event) => openWorkbench(card.source_context, event.currentTarget),
    })
  );
}

async function load() {
  try {
    const data = await api('/api/data');
    Object.assign(state, data, { error: '' });
  } catch (error) {
    state.error = error.message;
  }
  render();
}

async function fetchSlate(event) {
  event.preventDefault();
  state.busy = 'slate';
  state.error = '';
  render();
  try {
    state.slate = await api('/api/data/slate/fetch', {
      method: 'POST',
      body: JSON.stringify({ url: state.slateUrl }),
    });
    state.busy = '';
    render();
    announce(`Fetched ${state.slate.row_count} aggregate Slate rows.`);
  } catch (error) {
    state.busy = '';
    state.error = error.message;
    render();
  }
}

function slateTable() {
  if (!state.slate) {
    return el('p', { class: 'muted', role: 'status', text: 'Enter a Slate web service URL to load its table.' });
  }
  const retrieved = new Date(state.slate.retrieved_at).toLocaleString();
  return el('div', { class: 'slate-results' },
    el('p', {
      class: 'meta',
      role: 'status',
      text: `${state.slate.row_count} rows · fetched ${retrieved} · not stored`,
    }),
    state.slate.columns.length
      ? el('div', { class: 'data-table-wrap', tabindex: '0', 'aria-label': 'Slate results table' },
        el('table', { class: 'data-table' },
          el('thead', {},
            el('tr', {}, ...state.slate.columns.map((column) => el('th', { scope: 'col', text: column })))
          ),
          el('tbody', {}, ...state.slate.rows.map((row) =>
            el('tr', {}, ...row.map((value) => el('td', { text: value })))
          ))
        )
      )
      : el('p', { class: 'muted', text: 'Slate returned no rows.' })
  );
}

async function refreshSuny() {
  state.busy = 'suny';
  state.error = '';
  render();
  try {
    const data = await api('/api/data/suny/refresh', { method: 'POST', body: '{}' });
    state.suny = data;
    state.busy = '';
    render();
    announce(data.skipped ? 'SUNY data is already current.' : data.stale ? data.warning : 'SUNY data refreshed.');
  } catch (error) {
    state.busy = '';
    state.error = error.message;
    render();
  }
}

function slateSection() {
  return el('section', {
    class: 'data-section',
    'aria-labelledby': 'slate-data-heading',
    'aria-busy': String(state.busy === 'slate'),
  },
    el('div', { class: 'data-heading' },
      el('div', {},
        el('h3', { id: 'slate-data-heading', text: 'Live Slate table' }),
        el('p', { class: 'muted', text: 'Fetch an aggregate query directly. The URL and results are not stored.' })
      )
    ),
    el('form', { class: 'slate-connect', onsubmit: fetchSlate },
      field('Slate web service URL', el('input', {
        name: 'url',
        type: 'url',
        required: '',
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'https://apply.delhi.edu/…',
        value: state.slateUrl,
        disabled: state.busy ? '' : undefined,
        oninput: (event) => (state.slateUrl = event.target.value),
      }), 'Use a JSON or CSV aggregate query from delhi.edu or technolutions.net.'),
      el('button', {
        class: 'btn btn-neon',
        type: 'submit',
        disabled: state.busy ? '' : undefined,
        text: state.busy === 'slate' ? 'Fetching from Slate…' : 'Fetch from Slate',
      })
    ),
    state.busy === 'slate'
      ? el('p', { class: 'operation-status', role: 'status', text: 'Fetching from Slate…' })
      : slateTable()
  );
}

function sunySection() {
  const snapshot = state.suny.snapshot;
  return el('section', { class: 'data-section', 'aria-labelledby': 'suny-data-heading' },
    el('div', { class: 'data-heading' },
      el('div', {},
        el('h3', { id: 'suny-data-heading', text: 'SUNY Delhi enrollment trend' }),
        el('p', { class: 'muted', text: 'Official fall headcount by institution, student level, and load.' })
      ),
      el('button', {
        class: 'btn',
        disabled: state.busy ? '' : undefined,
        text: state.busy === 'suny' ? 'Refreshing…' : 'Refresh official data',
        onclick: refreshSuny,
      })
    ),
    snapshot
      ? el('div', { class: 'row data-source-status' },
        el('p', {
          class: snapshot.status === 'stale' ? 'feed-status' : 'meta',
          role: 'status',
          text: `${snapshot.status === 'stale' ? 'Showing last saved snapshot · ' : ''}${snapshot.as_of} · refreshed ${new Date(snapshot.refreshed_at).toLocaleDateString()}`,
        }),
        el('a', {
          href: snapshot.source_url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: 'Open dataset ↗',
        })
      )
      : null,
    state.suny.cards.length
      ? el('div', { class: 'data-card-grid' }, ...state.suny.cards.map(metricCard))
      : el('p', { class: 'muted', role: 'status', text: 'Refresh to load the official SUNY Delhi trend.' })
  );
}

function sourceSection() {
  return el('section', { class: 'data-section', 'aria-labelledby': 'official-sources-heading' },
    el('div', { class: 'data-heading' },
      el('div', {},
        el('h3', { id: 'official-sources-heading', text: 'Official data sources' }),
        el('p', { class: 'muted', text: 'Open a source when the question needs a deeper cut.' })
      )
    ),
    el('div', { class: 'source-grid' }, ...state.sources.map((source) =>
      el('a', {
        class: 'source-card',
        href: source.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
      el('strong', { text: source.title }),
      el('span', { text: source.description }),
      el('small', { text: 'Open official source ↗' }))
    ))
  );
}

function render() {
  mount(
    root,
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    slateSection(),
    sunySection(),
    sourceSection()
  );
}

export function init() {
  load();
}
