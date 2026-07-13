import { api, el, mount, capabilities } from './app.js';
import { addResponse, clearResponse, markResponseSaved } from './research-chat-state.js';

const root = document.getElementById('notes-root');
const state = { notes: [], filterTag: null, editing: null, busy: false, error: null, question: '', chat: [] };
// read at render time, not module-eval time — capabilities is filled during app init
const subjects = () => capabilities.subjects || [];

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

async function askResearch() {
  const question = state.question.trim();
  if (!question || state.busy) return;
  state.busy = 'chat';
  state.error = null;
  render();
  let added = false;
  try {
    const { answer } = await api('/api/research/chat', { method: 'POST', body: JSON.stringify({ question }) });
    state.chat = addResponse(state.chat, question, answer);
    state.question = '';
    added = true;
  } catch (err) {
    state.error = `Research failed: ${err.message}`;
  }
  state.busy = false;
  render();
  if (added) root.querySelector('.chat-response:last-of-type')?.scrollIntoView({ block: 'nearest' });
}

async function saveAnswer(item) {
  if (item.saved || item.saving) return;
  item.saving = true;
  state.error = null;
  render();
  const saved = await api('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ body: `${item.question}\n\n${item.answer}`, tags: ['admissions'] }),
  }).catch(() => null);
  if (!saved) {
    item.saving = false;
    state.error = 'Could not save this response — try again.';
    render();
    return;
  }
  state.chat = markResponseSaved(state.chat, item);
  await load();
}

// Feed panel dispatches this when the user hits "+" on an article
document.addEventListener('edm:add-to-note', async (e) => {
  const a = e.detail;
  const prefill = `${a.title}\n${a.link}\n\n> ${a.excerpt || '(no excerpt)'}\n\nMy notes:\n`;
  const saved = await api('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ body: prefill, tags: [], article_id: a.id }),
  }).catch(() => null);
  if (!saved) return;
  // don't stomp an open unsaved draft — the note is saved regardless; only
  // steal the editor when it's free
  if (!state.editing) state.editing = { ...saved };
  load();
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
      ...subjects().map((s) =>
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
    capabilities.ai
      ? el(
          'section',
          { class: 'research-chat', 'aria-label': 'Research assistant' },
          el('div', { class: 'chat-heading' },
            el('div', {}, el('h3', { text: 'Ask the research desk' }), el('p', { text: 'Get practical enrollment ideas, then keep the useful responses as notes.' })),
            el('span', { class: 'pulse-dot', 'aria-hidden': 'true' })
          ),
          el('div', { class: 'chat-composer' },
            el('textarea', {
              rows: '2',
              placeholder: 'What are good ways a technical college can recruit in New York State?',
              text: state.question,
              oninput: (e) => (state.question = e.target.value),
              onkeydown: (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  askResearch();
                }
              },
            }),
            el('button', { class: 'btn btn-neon', text: state.busy === 'chat' ? 'Thinking…' : 'Ask', disabled: state.busy ? '' : undefined, onclick: askResearch })
          ),
          ...state.chat.map((item) => el('article', { class: 'chat-response' },
            el('strong', { text: item.question }),
            el('p', { text: item.answer }),
            el('div', { class: 'row' },
              el('button', {
                class: 'btn btn-ghost',
                text: item.saving ? 'Saving…' : item.saved ? 'Saved to notes' : 'Save response to notes',
                disabled: item.saved || item.saving ? '' : undefined,
                onclick: () => saveAnswer(item),
              }),
              el('button', {
                class: 'btn btn-ghost',
                text: 'Clear response',
                title: item.saved ? 'Remove from chat; the saved note is kept' : 'Remove from chat',
                disabled: item.saving ? '' : undefined,
                onclick: () => {
                  state.chat = clearResponse(state.chat, item);
                  render();
                },
              })
            )
          ))
        )
      : null,
    capabilities.ai ? el('div', { class: 'notes-divider' }, el('span', { text: 'Saved notes' })) : null,
    el(
      'div',
      { class: 'row', style: 'flex-wrap:wrap; margin-bottom:.45rem' },
      el('span', { class: `pill${state.filterTag ? '' : ' active'}`, text: 'all', onclick: () => { state.filterTag = null; load(); } }),
      ...subjects().map((s) =>
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
  mount(root, state.editing ? editorView() : listView());
}

export function init() {
  load();
}
