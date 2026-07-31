import { announce, api, el, mount, capabilities } from './app.js';

const root = document.getElementById('campaigns-root');
const state = {
  templates: [],
  campaigns: [],
  campus: null,
  viewing: null,
  settings: null,
  busy: false,
  error: null,
  copied: false,
  form: { purpose: '', cta: '', cta_link: '', message_count: 3, template_id: null },
};

const field = (label, control, hint) =>
  el('label', { class: 'field' }, el('span', { text: label }), control, hint ? el('small', { text: hint }) : null);

async function load() {
  const [templates, campaigns, campus] = await Promise.all([
    api('/api/campaigns/templates').catch(() => ({ templates: [] })),
    api('/api/campaigns').catch(() => ({ campaigns: [] })),
    api('/api/campaigns/campus').catch(() => ({ campus: null })),
  ]);
  state.templates = templates.templates;
  state.campaigns = campaigns.campaigns;
  state.campus = campus.campus;
  if (!state.form.template_id && state.templates[0]) state.form.template_id = state.templates[0].id;
  render();
}

async function submit(kind) {
  state.busy = kind;
  state.error = null;
  render();
  try {
    const body = { ...state.form, output_format: kind === 'html' ? 'html' : 'text' };
    const path = kind === 'brief' ? '/api/campaigns/brief' : '/api/campaigns/generate';
    const created = await api(path, { method: 'POST', body: JSON.stringify(body) });
    state.busy = false;
    state.viewing = created;
    state.copied = false;
    await load();
    announce(kind === 'brief' ? 'Handoff brief ready.' : kind === 'html' ? 'HTML campaign ready.' : 'Text campaign ready.');
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    render();
  }
}

let copyTimer = null;
async function copyOutput() {
  try {
    await navigator.clipboard.writeText(state.viewing.output);
    state.copied = true;
    render();
    announce('Campaign output copied.');
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
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
  const format = c.kind === 'brief' ? 'handoff brief' : c.format === 'html' ? 'HTML campaign' : 'text campaign';
  return el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'row' },
      el('span', { class: 'pill badge', text: format }),
      el('span', { class: 'meta muted', text: c.purpose.slice(0, 60) }),
      el('button', { class: 'btn btn-ghost push-right', text: '← Back', onclick: () => { state.viewing = null; render(); } })
    ),
    el('textarea', { class: 'output-area', rows: '14', readonly: '', text: c.output }),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn btn-neon', text: state.copied ? 'Copied' : 'Copy output', onclick: copyOutput }),
      el('button', {
        class: 'btn btn-ghost',
        text: 'Delete',
        onclick: async () => {
          await api(`/api/campaigns/${c.id}`, { method: 'DELETE' }).catch(() => {});
          state.viewing = null;
          load();
        },
      })
    )
  );
}

async function saveCampus(campus) {
  state.busy = 'campus';
  state.error = null;
  render();
  try {
    state.campus = await api('/api/campaigns/campus', { method: 'PUT', body: JSON.stringify(campus) });
    state.settings = null;
    state.busy = false;
    render();
    announce('Campus memory saved.');
  } catch (err) {
    state.busy = false;
    state.error = err.message;
    render();
  }
}

function campusView() {
  const campus = { ...state.campus };
  const input = (key, label, options = {}) => field(
    label,
    options.area
      ? el('textarea', { rows: options.rows || '3', text: campus[key], oninput: (e) => (campus[key] = e.target.value) })
      : el('input', { value: campus[key], oninput: (e) => (campus[key] = e.target.value) }),
    options.hint
  );
  return el(
    'div',
    { class: 'stack settings-pane' },
    el('p', { class: 'muted settings-intro', text: 'Saved once and reused in every campaign. Replace the seed with approved campus information.' }),
    input('name', 'Campus name'),
    el('div', { class: 'form-grid' }, input('type', 'Institution type'), input('location', 'Location')),
    input('audience', 'Priority audiences', { area: true }),
    input('voice', 'Brand voice', { area: true }),
    input('facts', 'Approved facts and proof points', { area: true, rows: '12', hint: 'Programs, costs, outcomes, deadlines, support services, source links, and other facts the writer may safely use.' }),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-neon', text: state.busy === 'campus' ? 'Saving…' : 'Save campus memory', disabled: state.busy ? '' : undefined, onclick: () => saveCampus(campus) }),
      el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => { state.settings = null; state.error = null; render(); } })
    )
  );
}

function templateView() {
  const template = currentTemplate();
  if (!template) return el('p', { class: 'muted', text: 'No campaign template is available.' });
  const draft = { ...template };
  return el(
    'div',
    { class: 'stack settings-pane' },
    field('Writing instructions', el('textarea', { rows: '9', text: draft.body, oninput: (e) => (draft.body = e.target.value) }), 'Available: {{campus}}, {{purpose}}, {{cta}}, {{cta_link}}, {{message_count}}'),
    field('Optional HTML message template', el('textarea', {
      class: 'code-input',
      rows: '9',
      placeholder: '<html><body><h1>{{subject}}</h1><p>{{body}}</p><a href="{{cta_link}}">{{cta}}</a></body></html>',
      text: draft.html_body,
      oninput: (e) => (draft.html_body = e.target.value),
    }), 'Use {{subject}}, {{preview}}, and {{body}} for generated content. Campaign and campus placeholders also work.'),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el('div', { class: 'row' },
      el('button', {
        class: 'btn btn-neon',
        text: state.busy === 'template' ? 'Saving…' : 'Save templates',
        disabled: state.busy ? '' : undefined,
        onclick: async () => {
          state.busy = 'template';
          render();
          try {
            await api(`/api/campaigns/templates/${draft.id}`, { method: 'PUT', body: JSON.stringify({ body: draft.body, html_body: draft.html_body }) });
            state.settings = null;
            state.busy = false;
            await load();
            announce('Campaign templates saved.');
          } catch (err) {
            state.busy = false;
            state.error = err.message;
            render();
          }
        },
      }),
      el('button', { class: 'btn btn-ghost', text: 'Cancel', onclick: () => { state.settings = null; state.error = null; render(); } })
    )
  );
}

function formView() {
  if (state.settings === 'campus') return campusView();
  if (state.settings === 'template') return templateView();
  const f = state.form;
  const template = currentTemplate();
  return el(
    'div',
    { class: 'stack' },
    el('div', { class: 'campaign-memory' },
      el('div', {}, el('strong', { text: state.campus?.name || 'Campus memory' }), el('span', { text: state.campus?.location || 'Add campus context' })),
      el('button', { class: 'btn btn-ghost', text: 'Edit campus', onclick: () => { state.settings = 'campus'; render(); } })
    ),
    field('Campaign purpose', el('input', { placeholder: 'FAFSA completion push for admitted students', value: f.purpose, oninput: (e) => (f.purpose = e.target.value) })),
    el('div', { class: 'form-grid' },
      field('Call to action', el('input', { placeholder: 'Complete your FAFSA', value: f.cta, oninput: (e) => (f.cta = e.target.value) })),
      field('CTA link', el('input', { type: 'url', placeholder: 'https://…', value: f.cta_link, oninput: (e) => (f.cta_link = e.target.value) }))
    ),
    el('div', { class: 'form-grid form-grid-compact' },
      field('Messages', el('input', { type: 'number', min: '1', max: '20', value: String(f.message_count), oninput: (e) => (f.message_count = Number(e.target.value)) })),
      field('Writing template', el('select', { onchange: (e) => { f.template_id = Number(e.target.value); render(); } },
        ...state.templates.map((t) => {
          const option = el('option', { value: String(t.id), text: t.name });
          if (t.id === Number(f.template_id)) option.selected = true;
          return option;
        })
      ))
    ),
    el('button', { class: 'text-button', text: 'Edit writing and HTML templates', onclick: () => { state.settings = 'template'; render(); } }),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    el('div', { class: 'campaign-actions' },
      el('button', { class: 'btn', text: state.busy === 'brief' ? 'Building…' : 'Create handoff brief', disabled: state.busy ? '' : undefined, onclick: () => submit('brief') }),
      capabilities.ai ? el('button', { class: 'btn btn-neon', text: state.busy === 'text' ? 'Writing…' : 'Write text campaign', disabled: state.busy ? '' : undefined, onclick: () => submit('text') }) : null,
      capabilities.ai ? el('button', { class: 'btn', text: state.busy === 'html' ? 'Writing HTML…' : 'Write HTML campaign', disabled: state.busy || !template?.html_body?.trim() ? '' : undefined, title: template?.html_body?.trim() ? '' : 'Add an HTML template first', onclick: () => submit('html') }) : null
    ),
    state.campaigns.length ? el('div', { class: 'campaign-history' },
      el('h3', { text: 'Recent work' }),
      ...state.campaigns.slice(0, 6).map((campaign) => el('button', {
        class: 'history-row',
        onclick: () => { state.viewing = campaign; state.copied = false; render(); },
      },
      el('span', { text: campaign.purpose.slice(0, 60) }),
      el('small', { text: `${campaign.kind === 'brief' ? 'Brief' : campaign.format === 'html' ? 'HTML' : 'Text'} · ${new Date(campaign.created_at + 'Z').toLocaleDateString()}` })
      ))
    ) : null
  );
}

function render() {
  const busyMessage = {
    brief: 'Building handoff brief…',
    text: 'Writing text campaign…',
    html: 'Writing HTML campaign…',
    campus: 'Saving campus memory…',
    template: 'Saving campaign templates…',
  }[state.busy];
  mount(
    root,
    busyMessage ? el('p', { class: 'muted operation-status', role: 'status', text: busyMessage }) : null,
    state.viewing ? viewingView() : formView()
  );
}

export function init() {
  load();
}
