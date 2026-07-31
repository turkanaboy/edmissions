import { announce, api, el, mount, selectWorkspace } from './app.js';
import { sourceBody } from './source-context.js';

const dialog = document.getElementById('use-this-dialog');
const root = document.getElementById('workbench-root');
const state = { source: null, selections: [], invoker: null, busy: null, error: null };

async function loadSelections() {
  try {
    const data = await api('/api/brief-selections');
    state.selections = data.selections;
  } catch (err) {
    state.error = `Could not load the AVP Brief queue: ${err.message}`;
  }
}

const close = () => dialog.close();

async function save(destination, path, payload) {
  state.busy = destination;
  state.error = null;
  render();
  try {
    const saved = await api(path, { method: 'POST', body: JSON.stringify(payload) });
    state.busy = null;
    if (destination === 'brief') {
      state.selections.push(saved);
      render();
      announce('Added to the AVP Brief queue.');
      return;
    }
    close();
    announce(destination === 'note' ? 'Saved to notes.' : 'Task created.');
  } catch (err) {
    state.busy = null;
    state.error = err.message;
    render();
  }
}

function handoff(destination) {
  document.dispatchEvent(new CustomEvent(`edm:prefill-${destination}`, { detail: state.source }));
  selectWorkspace(destination === 'campaign' ? 'campaigns' : 'research');
  state.invoker = null;
  close();
  queueMicrotask(() => document.querySelector(
    destination === 'campaign' ? '[data-focus="campaign-purpose"]' : '[data-focus="research-question"]'
  )?.focus());
}

async function removeSelection(selection) {
  state.busy = `remove-${selection.id}`;
  render();
  try {
    await api(`/api/brief-selections/${selection.id}`, { method: 'DELETE' });
    state.selections = state.selections.filter((item) => item.id !== selection.id);
    state.busy = null;
    state.error = null;
    render();
    announce('Removed from the AVP Brief queue.');
  } catch (err) {
    state.busy = null;
    state.error = err.message;
    render();
  }
}

function render() {
  if (!state.source) return;
  const source = state.source;
  const body = sourceBody(source);
  const disabled = state.busy ? '' : undefined;
  mount(
    root,
    el('div', { class: 'workbench-heading' },
      el('div', {},
        el('span', { class: 'eyebrow', text: 'Source workbench' }),
        el('h2', { id: 'use-this-title', text: 'Use this signal' })
      ),
      el('button', { class: 'btn-icon', text: '×', 'aria-label': 'Close Use This workbench', onclick: close })
    ),
    el('div', { class: 'workbench-source' },
      el('strong', { text: source.title || 'Untitled source' }),
      el('span', { class: 'meta', text: [source.publisher, source.lane, source.published_at].filter(Boolean).join(' · ') }),
      source.excerpt ? el('p', { text: source.excerpt }) : null,
      source.url ? el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open source ↗' }) : null
    ),
    el('div', { class: 'workbench-actions' },
      el('button', { class: 'btn btn-neon', disabled, text: 'Start campaign', onclick: () => handoff('campaign') }),
      el('button', { class: 'btn', disabled, text: 'Ask research', onclick: () => handoff('research') }),
      el('button', {
        class: 'btn',
        disabled,
        text: state.busy === 'note' ? 'Saving…' : 'Save to notes',
        onclick: () => save('note', '/api/notes', { body, tags: [], source_context: source }),
      }),
      el('button', {
        class: 'btn',
        disabled,
        text: state.busy === 'task' ? 'Creating…' : 'Create task',
        onclick: () => save('task', '/api/tasks', {
          text: source.moment_date
            ? `Prepare ${source.title || 'enrollment moment'} for ${source.moment_date}`
            : `Review: ${source.title || source.excerpt}`,
          source_context: source,
        }),
      }),
      el('button', {
        class: 'btn',
        disabled,
        text: state.busy === 'brief' ? 'Adding…' : 'Add to AVP Brief',
        onclick: () => save('brief', '/api/brief-selections', { body, source_context: source }),
      })
    ),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el('section', { class: 'brief-queue', 'aria-labelledby': 'brief-queue-title' },
      el('h3', { id: 'brief-queue-title', text: `AVP Brief queue · ${state.selections.length}` }),
      !state.selections.length ? el('p', { class: 'muted', text: 'Nothing queued yet.' }) : null,
      ...state.selections.map((selection) =>
        el('div', { class: 'brief-queue-row' },
          el('span', { text: selection.source_context.title || selection.body.slice(0, 80) }),
          el('button', {
            class: 'btn-icon',
            disabled: state.busy ? '' : undefined,
            text: '×',
            'aria-label': `Remove ${selection.source_context.title || 'selection'} from AVP Brief`,
            onclick: () => removeSelection(selection),
          })
        )
      )
    )
  );
}

export async function openWorkbench(source, invoker = document.activeElement) {
  state.source = source;
  state.invoker = invoker;
  state.busy = null;
  state.error = null;
  await loadSelections();
  render();
  if (!dialog.open) dialog.showModal();
  root.querySelector('.workbench-actions button')?.focus();
}

export function init() {
  dialog.setAttribute('aria-labelledby', 'use-this-title');
  dialog.addEventListener('close', () => state.invoker?.focus());
}
