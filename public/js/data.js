import { announce, api, el, mount } from './app.js';
import { openWorkbench } from './workbench.js';

const root = document.getElementById('data-root');
const state = {
  slate: { snapshot: null, cards: [] },
  suny: { snapshot: null, cards: [] },
  sources: [],
  busy: '',
  error: '',
  asOf: new Date().toISOString().slice(0, 10),
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

async function importSlate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = form.elements.csv.files[0];
  if (!file) {
    state.error = 'Choose an aggregate CSV file.';
    render();
    return;
  }
  if (file.size > 200_000) {
    state.error = 'CSV must be 200 KB or smaller.';
    render();
    return;
  }
  state.busy = 'slate';
  state.error = '';
  render();
  try {
    await api('/api/data/slate', {
      method: 'POST',
      body: JSON.stringify({
        csv: await file.text(),
        label: form.elements.label.value,
        as_of: form.elements.as_of.value,
        source_label: form.elements.source_label.value,
      }),
    });
    state.busy = '';
    await load();
    announce('Aggregate Slate snapshot imported.');
  } catch (error) {
    state.busy = '';
    state.error = error.message;
    render();
  }
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
  return el('section', { class: 'data-section', 'aria-labelledby': 'slate-data-heading' },
    el('div', { class: 'data-heading' },
      el('div', {},
        el('h3', { id: 'slate-data-heading', text: 'Slate aggregate snapshot' }),
        el('p', { class: 'muted', text: 'Counts only. Never upload names, IDs, emails, birth dates, or addresses.' })
      ),
      state.slate.snapshot
        ? el('span', { class: 'pill', text: `As of ${state.slate.snapshot.as_of}` })
        : null
    ),
    el('details', { class: 'data-import' },
      el('summary', { text: 'Import aggregate CSV' }),
      el('form', { class: 'stack', onsubmit: importSlate },
        field('Snapshot label', el('input', {
          name: 'label',
          required: '',
          value: 'Slate aggregate snapshot',
        })),
        el('div', { class: 'form-grid' },
          field('As-of date', el('input', {
            name: 'as_of',
            type: 'date',
            required: '',
            value: state.asOf,
            oninput: (event) => (state.asOf = event.target.value),
          })),
          field('Source label', el('input', {
            name: 'source_label',
            required: '',
            value: 'Slate aggregate export',
          }))
        ),
        field('Aggregate CSV file', el('input', {
          name: 'csv',
          type: 'file',
          accept: '.csv,text/csv',
          required: '',
        }), 'Required columns are documented in the README. Maximum 200 KB.'),
        el('button', {
          class: 'btn btn-neon',
          type: 'submit',
          disabled: state.busy ? '' : undefined,
          text: state.busy === 'slate' ? 'Importing…' : 'Import snapshot',
        })
      )
    ),
    state.slate.cards.length
      ? el('div', { class: 'data-card-grid' }, ...state.slate.cards.map(metricCard))
      : el('p', { class: 'muted', role: 'status', text: 'No Slate aggregate snapshot imported yet.' })
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
