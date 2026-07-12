import { api, el, mount } from './app.js';

const root = document.getElementById('tasks-root');
let tasks = [];

async function load() {
  const data = await api('/api/tasks').catch(() => ({ tasks: [] }));
  tasks = data.tasks;
  render();
}

async function add(text) {
  await api('/api/tasks', { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
  load();
}

async function toggle(t) {
  await api(`/api/tasks/${t.id}`, { method: 'PUT', body: JSON.stringify({ done: !t.done }) }).catch(() => {});
  load();
}

async function remove(t) {
  await api(`/api/tasks/${t.id}`, { method: 'DELETE' }).catch(() => {});
  load();
}

function render() {
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
      el('input', { name: 't', placeholder: 'add a task…' }),
      el('button', { class: 'btn', text: '+' })
    ),
    !tasks.length ? el('p', { class: 'muted', text: 'No tasks yet.' }) : null,
    ...tasks.map((t) =>
      el(
        'div',
        { class: 'list-item row' },
        el('input', { type: 'checkbox', style: 'width:auto', ...(t.done ? { checked: '' } : {}), onchange: () => toggle(t) }),
        el('span', { text: t.text, style: t.done ? 'text-decoration:line-through; color:var(--dim); flex:1' : 'flex:1' }),
        el('button', { class: 'btn-icon', text: '×', title: 'Delete', onclick: () => remove(t) })
      )
    )
  );
}

export function init() {
  load();
}
