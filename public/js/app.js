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
// Only http(s), root/relative, and fragment hrefs — blanks javascript:/data:/vbscript:
// so an untrusted feed or note link can't become a script-executing click target.
const safeHref = (v) => (/^(https?:\/\/|\/|#|\.\/|\.\.\/)/i.test(String(v)) ? v : '#');

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue; // undefined would setAttribute("undefined")
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'text') node.textContent = v;
    else if (k === 'href') node.setAttribute('href', safeHref(v));
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.filter(Boolean));
  return node;
}

// replaceChildren stringifies null into a literal "null" text node — always mount through this
export function mount(root, ...children) {
  root.replaceChildren(...children.filter(Boolean));
}

export function restoreFocus(root, key, fallback) {
  if (!key) return;
  const controls = [...root.querySelectorAll('[data-focus]')];
  const target = controls.find((node) => node.dataset.focus === String(key))
    || controls.find((node) => node.dataset.focus === String(fallback));
  target?.focus();
}

export function announce(message) {
  const status = document.getElementById('app-status');
  if (!status) return;
  status.textContent = '';
  queueMicrotask(() => {
    status.textContent = message;
  });
}

const themeColor = document.querySelector('meta[name="theme-color"]');
const backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
if (themeColor && backgroundColor) themeColor.content = backgroundColor;

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
const welcome = document.getElementById('welcome');
if (welcome && capabilities.welcome) {
  welcome.textContent = capabilities.welcome;
  welcome.hidden = false;
}

const workspaceTabs = [...document.querySelectorAll('.workspace-tab')];
const selectWorkspace = (selected) => {
  workspaceTabs.forEach((tab) => {
    const active = tab === selected;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  });
};
workspaceTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectWorkspace(tab));
  tab.addEventListener('keydown', (event) => {
    const nextIndex = {
      ArrowLeft: (index - 1 + workspaceTabs.length) % workspaceTabs.length,
      ArrowRight: (index + 1) % workspaceTabs.length,
      Home: 0,
      End: workspaceTabs.length - 1,
    }[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    selectWorkspace(workspaceTabs[nextIndex]);
    workspaceTabs[nextIndex].focus();
  });
});

initPlayer();
initFeed();
initNotes();
initCampaigns();
initTasks();
