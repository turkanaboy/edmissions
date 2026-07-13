import { api, el, mount, restoreFocus } from './app.js';

const root = document.getElementById('tasks-root');
let tasks = [];

async function load(focusKey) {
  const data = await api('/api/tasks').catch(() => ({ tasks: [] }));
  tasks = data.tasks;
  render(focusKey);
}

async function add(text) {
  await api('/api/tasks', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
  load('task-entry');
}

async function toggle(t) {
  await api(`/api/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ done: !t.done }) }).catch(() => {});
  load(`task-${t.id}`);
}

async function remove(t) {
  const index = tasks.indexOf(t);
  const neighbor = tasks[index + 1] || tasks[index - 1];
  await api(`/api/tasks/${t.id}`, { method: 'DELETE' }).catch(() => {});
  load(neighbor ? `task-${neighbor.id}` : 'task-entry');
}

function render(focusKey) {
  mount(
    root,
    el(
      'form',
      {
        class: 'row',
        onsubmit: (e) => {
          e.preventDefault();
          const text = e.target.t.value.trim();
          if (text) {
            add(text);
            e.target.t.value = '';
          }
        },
      },
      el('input', { name: 't', 'aria-label': 'New task', 'data-focus': 'task-entry', placeholder: 'add a task…' }),
      el('button', { class: 'btn', text: '+', 'aria-label': 'Add task' })
    ),
    !tasks.length ? el('p', { class: 'muted', role: 'status', text: 'No tasks yet.' }) : null,
    ...tasks.map((t) =>
      el(
        'div',
        { class: 'list-item row' },
        el('label', { class: 'task-check' }, el('input', {
          type: 'checkbox',
          'aria-label': `Mark ${t.text} as ${t.done ? 'not done' : 'done'}`,
          'data-focus': `task-${t.id}`,
          ...(t.done ? { checked: '' } : {}),
          onchange: () => toggle(t),
        })),
        el('span', { text: t.text, style: t.done ? 'text-decoration:line-through; color:var(--dim); flex:1' : 'flex:1' }),
        el('button', { class: 'btn-icon', text: '×', title: 'Delete', 'aria-label': `Delete ${t.text}`, onclick: () => remove(t) })
      )
    )
  );
  restoreFocus(root, focusKey, 'task-entry');
}

export function init() {
  load();
}
