import { api, el, capabilities } from './app.js';

const root = document.getElementById('campaigns-root');
const state = {
  templates: [],
  campaigns: [],
  viewing: null,
  editTemplate: false,
  busy: false,
  error: null,
  copied: false,
  form: { purpose: '', cta: '', cta_link: '', message_count: 3, template_id: null },
};

async function load() {
  const [t, c] = await Promise.all([
    api('/api/campaigns/templates').catch(() => ({ templates: [] })),
    api('/api/campaigns').catch(() => ({ campaigns: [] })),
  ]);
  state.templates = t.templates;
  state.campaigns = c.campaigns;
  if (!state.form.template_id && state.templates[0]) state.form.template_id = state.templates[0].id;
  render();
}

async function submit(kind) {
  state.busy = kind;
  state.error = null;
  render();
  try {
    const path = kind === 'brief' ? '/api/campaigns/brief' : '/api/campaigns/generate';
    const created = await api(path, { method: 'POST', body: JSON.stringify(state.form) });
    state.busy = false;
    state.viewing = created;
    state.copied = false;
    load();
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    render();
  }
}

async function copyOutput() {
  try {
    await navigator.clipboard.writeText(state.viewing.output);
    state.copied = true;
    render();
    setTimeout(() => {
      state.copied = false;
      render();
    }, 1800);
  } catch {
    state.error = 'Clipboard blocked — select and copy manually.';
    render();
  }
}

const currentTemplate = () => state.templates.find((t) => t.id === Number(state.form.template_id));

function viewingView() {
  const c = state.viewing;
  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'pill badge', text: c.kind === 'brief' ? 'handoff brief' : 'generated' }),
      el('span', { class: 'meta muted', text: c.purpose.slice(0, 60) }),
      el('button', { class: 'btn btn-ghost', style: 'margin-left:auto', text: '← back', onclick: () => { state.viewing = null; render(); } })
    ),
    el('textarea', { rows: '10', readonly: '', text: c.output }),
    state.error ? el('p', { class: 'error', text: state.error }) : null,
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn btn-neon', text: state.copied ? '✓ Copied' : 'Copy', onclick: copyOutput }),
      el('button', { class: 'btn btn-ghost', text: 'Delete', onclick: async () => { await api(`/api/campaigns/${c.id}`, { method: 'DELETE' }).catch(() => {}); state.viewing = null; load(); } })
    )
  );
}

function formView() {
  const f = state.form;
  return el(
    'div',
    { class: 'stack' },
    el('input', { placeholder: 'Purpose (e.g. FAFSA completion push for admits)', value: f.purpose, oninput: (e) => (f.purpose = e.target.value) }),
    el(
      'div',
      { class: 'row' },
      el('input', { placeholder: 'Call to action', value: f.cta, oninput: (e) => (f.cta = e.target.value) }),
      el('input', { placeholder: 'https://cta-link…', value: f.cta_link, oninput: (e) => (f.cta_link = e.target.value) })
    ),
    el(
      'div',
      { class: 'row' },
      el('label', { class: 'meta muted', text: 'messages' }),
      el('input', { type: 'number', min: '1', max: '20', style: 'width:70px', value: String(f.message_count), oninput: (e) => (f.message_count = Number(e.target.value)) }),
      el(
        'select',
        {
          style: 'flex:1',
          onchange: (e) => {
            f.template_id = Number(e.target.value);
            render();
          },
        },
        ...state.templates.map((t) => {
          const o = el('option', { value: String(t.id), text: t.name });
          if (t.id === Number(f.template_id)) o.selected = true;
          return o;
        })
      ),
      el('button', { class: 'btn btn-ghost', title: 'Edit template', text: '✎', onclick: () => { state.editTemplate = !state.editTemplate; render(); } })
    ),
    state.editTemplate && currentTemplate()
      ? el(
          'div',
          { class: 'stack' },
          el('textarea', { rows: '6', text: currentTemplate().body, oninput: (e) => (currentTemplate().body = e.target.value) }),
          el('button', {
            class: 'btn',
            text: 'Save template',
            onclick: async () => {
              const t = currentTemplate();
              await api(`/api/campaigns/templates/${t.id}`, { method: 'PUT', body: JSON.stringify({ body: t.body }) }).catch(() => {});
              state.editTemplate = false;
              load();
            },
          })
        )
      : null,
    state.error ? el('p', { class: 'error', text: state.error }) : null,
    el(
      'div',
      { class: 'row' },
      el('button', {
        class: 'btn btn-neon',
        text: state.busy === 'brief' ? 'Building…' : 'Generate handoff document',
        disabled: state.busy ? '' : undefined,
        onclick: () => submit('brief'),
      }),
      capabilities.ai
        ? el('button', {
            class: 'btn',
            text: state.busy === 'generate' ? 'Generating…' : 'Generate campaign',
            disabled: state.busy ? '' : undefined,
            onclick: () => submit('generate'),
          })
        : null
    ),
    state.campaigns.length
      ? el(
          'div',
          {},
          el('div', { class: 'meta muted', style: 'margin-top:.4rem', text: 'Past campaigns' }),
          ...state.campaigns.slice(0, 8).map((c) =>
            el(
              'div',
              { class: 'list-item' },
              el('a', {
                href: '#',
                text: `${c.kind === 'brief' ? '📋' : '⚡'} ${c.purpose.slice(0, 60)}`,
                onclick: (e) => {
                  e.preventDefault();
                  state.viewing = c;
                  state.copied = false;
                  render();
                },
              }),
              el('div', { class: 'meta muted', text: new Date(c.created_at + 'Z').toLocaleDateString() })
            )
          )
        )
      : null
  );
}

function render() {
  root.replaceChildren(state.viewing ? viewingView() : formView());
}

load();
