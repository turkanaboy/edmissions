import { announce, api, el, mount, restoreFocus } from './app.js';
import { openWorkbench } from './workbench.js';
import { normalizeMomentSource } from './source-context.js';

const root = document.getElementById('moments-root');
const state = { upcoming: [], past: [], showPast: false, editing: null, busy: false, error: null };

const field = (label, control, hint) =>
  el('label', { class: 'field' }, el('span', { text: label }), control, hint ? el('small', { text: hint }) : null);

async function load(focusKey) {
  try {
    const data = await api('/api/moments');
    state.upcoming = data.upcoming;
    state.past = data.past;
    state.error = null;
  } catch (err) {
    state.error = err.message;
  }
  render(focusKey);
}

async function save() {
  const moment = state.editing;
  state.busy = true;
  state.error = null;
  render('moment-save');
  try {
    await api(moment.id ? `/api/moments/${moment.id}` : '/api/moments', {
      method: moment.id ? 'PUT' : 'POST',
      body: JSON.stringify(moment),
    });
    state.editing = null;
    state.busy = false;
    await load('moment-new');
    announce('Enrollment moment saved.');
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    render('moment-save');
  }
}

async function remove(moment) {
  try {
    await api(`/api/moments/${moment.id}`, { method: 'DELETE' });
    state.editing = null;
    await load('moment-new');
    announce('Enrollment moment deleted.');
  } catch (err) {
    state.error = `Could not delete enrollment moment: ${err.message}`;
    render('moment-save');
  }
}

function editorView() {
  const moment = state.editing;
  return el('div', { class: 'moment-editor' },
    field('Moment name', el('input', {
      'data-focus': 'moment-name',
      value: moment.name,
      oninput: (event) => (moment.name = event.target.value),
    })),
    el('div', { class: 'form-grid' },
      field('Date', el('input', {
        type: 'date',
        value: moment.moment_date,
        oninput: (event) => (moment.moment_date = event.target.value),
      })),
      field('Lead days', el('input', {
        type: 'number',
        min: '0',
        max: '365',
        value: String(moment.lead_days),
        oninput: (event) => (moment.lead_days = Number(event.target.value)),
      }))
    ),
    field('Audience', el('input', {
      value: moment.audience,
      oninput: (event) => (moment.audience = event.target.value),
    })),
    field('Channels', el('input', {
      value: moment.channels.join(', '),
      oninput: (event) => {
        moment.channels = event.target.value.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
      },
    }), 'email, sms, social, web, call, direct-mail, or campus'),
    el('div', { class: 'form-grid' },
      field('Source URL', el('input', {
        type: 'url',
        value: moment.source_url,
        oninput: (event) => (moment.source_url = event.target.value),
      })),
      field('Verified on', el('input', {
        type: 'date',
        value: moment.verified_at,
        oninput: (event) => (moment.verified_at = event.target.value),
      }))
    ),
    field('Notes', el('textarea', {
      rows: '3',
      text: moment.notes,
      oninput: (event) => (moment.notes = event.target.value),
    })),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn-neon',
        'data-focus': 'moment-save',
        disabled: state.busy ? '' : undefined,
        text: state.busy ? 'Saving…' : 'Save moment',
        onclick: save,
      }),
      moment.id ? el('button', { class: 'btn btn-ghost', text: 'Delete', onclick: () => remove(moment) }) : null,
      el('button', {
        class: 'btn btn-ghost push-right',
        text: 'Cancel',
        onclick: () => {
          state.editing = null;
          state.error = null;
          render('moment-new');
        },
      })
    )
  );
}

function momentRow(moment) {
  return el('article', { class: 'moment-card' },
    el('div', { class: 'moment-date' },
      el('strong', { text: new Date(`${moment.moment_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }),
      el('span', { text: String(new Date(`${moment.moment_date}T00:00:00`).getFullYear()) })
    ),
    el('div', { class: 'moment-body' },
      el('div', { class: 'row moment-title' },
        el('strong', { text: moment.name }),
        moment.verification_stale ? el('span', { class: 'pill warning', text: 'verify source' }) : null
      ),
      el('p', { class: 'meta', text: `${moment.audience || 'Audience not set'} · ${moment.lead_days} lead days · ${moment.channels.join(', ') || 'no channels'}` }),
      moment.notes ? el('p', { class: 'muted', text: moment.notes }) : null,
      el('div', { class: 'row moment-actions' },
        moment.source_url ? el('a', { href: moment.source_url, target: '_blank', rel: 'noopener noreferrer', text: 'Official source ↗' }) : null,
        el('button', {
          class: 'text-button',
          'data-focus': `moment-use-${moment.id}`,
          text: 'Use this →',
          onclick: (event) => openWorkbench(normalizeMomentSource(moment), event.currentTarget),
        }),
        el('button', {
          class: 'text-button',
          text: 'Edit',
          onclick: () => {
            state.editing = { ...moment, channels: [...moment.channels] };
            render('moment-name');
          },
        })
      )
    )
  );
}

function listView() {
  const visible = state.showPast ? [...state.upcoming, ...state.past] : state.upcoming;
  return el('div', { class: 'stack' },
    el('div', { class: 'row moment-toolbar' },
      el('button', {
        class: 'btn',
        'data-focus': 'moment-new',
        text: '+ moment',
        onclick: () => {
          state.editing = {
            name: '',
            moment_date: '',
            audience: '',
            lead_days: 14,
            channels: ['email'],
            notes: '',
            source_url: '',
            verified_at: '',
          };
          render('moment-name');
        },
      }),
      el('button', {
        class: 'pill',
        'aria-pressed': String(state.showPast),
        'data-focus': 'moment-past',
        text: state.showPast ? 'Hide past moments' : `Show past moments (${state.past.length})`,
        onclick: () => {
          state.showPast = !state.showPast;
          render('moment-past');
        },
      })
    ),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    !visible.length ? el('p', { class: 'muted', role: 'status', text: 'No upcoming enrollment moments.' }) : null,
    el('div', { class: 'moment-list' }, ...visible.map(momentRow))
  );
}

function render(focusKey) {
  mount(root, state.editing ? editorView() : listView());
  restoreFocus(root, focusKey, 'moment-new');
}

export function init() {
  load();
}
