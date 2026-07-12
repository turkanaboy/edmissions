import { api, el, capabilities } from './app.js';

const root = document.getElementById('notes-root');
const state = { notes: [], filterTag: null, editing: null, busy: false, error: null };
const subjects = capabilities.subjects || [];

async function load() {
  const qs = state.filterTag ? `?tag=${encodeURIComponent(state.filterTag)}` : '';
  const data = await api('/api/notes' + qs).catch(() => ({ notes: [] }));
  state.notes = data.notes;
  render();
}

async function saveEditing() {
  const n = state.editing;
  if (!n || !n.body.trim()) return;
  state.busy = true;
  render();
  try {
    const payload = { body: n.body, tags: n.tags, article_id: n.article_id || null };
    const saved = n.id ? await api(`/api/notes/${n.id}`, { method: 'PUT', body: JSON.stringify(payload) }) : await api('/api/notes', { method: 'POST', body: JSON.stringify(payload) });
    state.editing = null;
    state.busy = false;
    await load();
    return saved;
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    render();
  }
}

async function removeNote(id) {
  await api(`/api/notes/${id}`, { method: 'DELETE' }).catch(() => {});
  if (state.editing?.id === id) state.editing = null;
  load();
}

async function summarize(note) {
  state.busy = true;
  state.error = null;
  render();
  try {
    const updated = await api(`/api/notes/${note.id}/summarize`, { method: 'POST' });
    state.editing = { ...updated };
    state.busy = false;
    load();
  } catch (err) {
    state.busy = false;
    state.error = `Summary failed: ${err.message}`;
    render();
  }
}

// Feed panel dispatches this when the user hits "+" on an article
document.addEventListener('edm:add-to-note', async (e) => {
  const a = e.detail;
  const prefill = `${a.title}\n${a.link}\n\n> ${a.excerpt || '(no excerpt)'}\n\nMy notes:\n`;
  const saved = await api('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ body: prefill, tags: [], article_id: a.id }),
  }).catch(() => null);
  if (saved) {
    state.editing = { ...saved };
    render();
    load();
  }
});

function editorView() {
  const n = state.editing;
  return el(
    'div',
    { class: 'stack' },
    n.article_title
      ? el('a', { class: 'meta', href: n.article_link, target: '_blank', rel: 'noopener noreferrer', text: `↗ ${n.article_title}` })
      : null,
    n.summary
      ? el(
          'div',
          { class: 'list-item', style: 'border:1px solid var(--line); border-radius:8px; padding:.5rem .6rem' },
          el('div', { class: 'meta', text: 'AI summary' }),
          el('div', { text: n.summary })
        )
      : null,
    el('textarea', {
      rows: '9',
      text: n.body,
      oninput: (e) => {
        n.body = e.target.value;
      },
    }),
    el(
      'div',
      { class: 'row', style: 'flex-wrap:wrap' },
      ...subjects.map((s) =>
        el('span', {
          class: `pill${n.tags.includes(s) ? ' active' : ''}`,
          text: s,
          onclick: () => {
            n.tags = n.tags.includes(s) ? n.tags.filter((t) => t !== s) : [...n.tags, s];
            render();
          },
        })
      )
    ),
    state.error ? el('p', { class: 'error', text: state.error }) : null,
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn btn-neon', text: state.busy ? 'Saving…' : 'Save', disabled: state.busy ? '' : undefined, onclick: saveEditing }),
      capabilities.ai && n.id
        ? el('button', {
            class: 'btn',
            text: state.busy ? 'Summarizing…' : 'Summarize',
            disabled: state.busy ? '' : undefined,
            onclick: () => summarize(n),
          })
        : null,
      n.id ? el('button', { class: 'btn btn-ghost', text: 'Delete', onclick: () => removeNote(n.id) }) : null,
      el('button', {
        class: 'btn btn-ghost',
        style: 'margin-left:auto',
        text: 'Close',
        onclick: () => {
          state.editing = null;
          state.error = null;
          render();
        },
      })
    )
  );
}

function listView() {
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'row', style: 'flex-wrap:wrap; margin-bottom:.45rem' },
      el('span', { class: `pill${state.filterTag ? '' : ' active'}`, text: 'all', onclick: () => { state.filterTag = null; load(); } }),
      ...subjects.map((s) =>
        el('span', { class: `pill${state.filterTag === s ? ' active' : ''}`, text: s, onclick: () => { state.filterTag = s; load(); } })
      ),
      el('button', {
        class: 'btn',
        style: 'margin-left:auto',
        text: '+ note',
        onclick: () => {
          state.editing = { body: '', tags: state.filterTag ? [state.filterTag] : [], article_id: null };
          render();
        },
      })
    ),
    !state.notes.length ? el('p', { class: 'muted', text: 'Nothing captured yet — paste research or add an article from the feed.' }) : null,
    ...state.notes.map((n) =>
      el(
        'div',
        { class: 'list-item' },
        el('a', {
          href: '#',
          text: n.body.split('\n')[0].slice(0, 80) || '(empty note)',
          onclick: (e) => {
            e.preventDefault();
            state.editing = { ...n };
            render();
          },
        }),
        el(
          'div',
          { class: 'meta' },
          el('span', { text: new Date(n.updated_at + 'Z').toLocaleDateString() }),
          n.summary ? el('span', { class: 'pill badge', style: 'margin-left:.4rem', text: 'summarized' }) : null,
          ...n.tags.map((t) => el('span', { class: 'pill', style: 'margin-left:.4rem', text: t }))
        )
      )
    )
  );
}

function render() {
  root.replaceChildren(state.editing ? editorView() : listView());
}

load();
