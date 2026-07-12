// Shared fetch wrapper: any 401 mid-session bounces to login
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

// Tiny DOM helper: build an element with textContent only (never innerHTML for remote data)
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue; // undefined would setAttribute("undefined")
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

// replaceChildren stringifies null into a literal "null" text node — always mount through this
export function mount(root, ...children) {
  root.replaceChildren(...children.filter(Boolean));
}

// Mutable so panel modules can import the binding safely during the import cycle;
// populated below before any panel init runs.
export const capabilities = { ai: false, subjects: [] };

import { init as initPlayer } from './player.js';
import './visualizer.js'; // event-driven; no init needed
import { init as initFeed } from './feed.js';
import { init as initNotes } from './notes.js';
import { init as initCampaigns } from './campaigns.js';
import { init as initTasks } from './tasks.js';

document.getElementById('logout')?.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login.html';
});

Object.assign(capabilities, await api('/api/capabilities').catch(() => ({})));
initPlayer();
initFeed();
initNotes();
initCampaigns();
initTasks();
