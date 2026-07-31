import { announce, api, el, mount } from './app.js';

const root = document.getElementById('brief-root');
const state = { brief: null, loading: false, error: null, copied: false };

const sourceLink = (label, source) =>
  source?.url
    ? el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: label })
    : el('span', { text: label });

async function build(announceResult = true) {
  state.loading = true;
  state.error = null;
  state.copied = false;
  render();
  try {
    state.brief = await api('/api/brief');
  } catch (err) {
    state.error = err.message;
  }
  state.loading = false;
  render();
  if (state.brief && announceResult) announce('AVP Brief assembled.');
}

async function removeSelection(selection) {
  try {
    await api(`/api/brief-selections/${selection.id}`, { method: 'DELETE' });
    await build(false);
    announce('Selection removed from the AVP Brief.');
  } catch (err) {
    state.error = err.message;
    render();
  }
}

async function copy() {
  try {
    await navigator.clipboard.writeText(state.brief.markdown);
    state.copied = true;
    render();
    announce('AVP Brief copied.');
  } catch {
    state.error = 'Clipboard blocked — select the preview text and copy manually.';
    render();
  }
}

const empty = (text) => el('p', { class: 'muted', text });

function preview() {
  const brief = state.brief;
  return el('article', { class: 'brief-preview' },
    el('header', {},
      el('span', { class: 'eyebrow', text: 'On-demand briefing' }),
      el('h3', { text: 'AVP Enrollment Brief' }),
      el('p', { class: 'meta', text: `Assembled ${new Date(brief.assembled_at).toLocaleString()}` })
    ),
    el('section', {},
      el('h4', { text: 'Selected signals and research' }),
      !brief.selections.length ? empty('Nothing selected.') : null,
      ...brief.selections.map((selection) =>
        el('div', { class: 'brief-row' },
          el('div', {},
            sourceLink(selection.source_context.title || selection.body, selection.source_context),
            selection.source_context.excerpt || selection.body
              ? el('p', { text: selection.source_context.excerpt || selection.body })
              : null
          ),
          el('button', {
            class: 'btn-icon brief-selection-remove',
            text: '×',
            'aria-label': `Remove ${selection.source_context.title || 'selection'} from brief`,
            onclick: () => removeSelection(selection),
          })
        )
      )
    ),
    el('section', {},
      el('h4', { text: 'Open tasks' }),
      !brief.tasks.length ? empty('No open tasks.') : null,
      ...brief.tasks.map((task) =>
        el('div', { class: 'brief-row' },
          el('div', {},
            el('span', { text: task.text }),
            task.source_context?.url
              ? el('p', {}, sourceLink('Source ↗', task.source_context))
              : null
          )
        )
      )
    ),
    el('section', {},
      el('h4', { text: 'Upcoming enrollment moments' }),
      !brief.moments.length ? empty('No moments in the next 90 days.') : null,
      ...brief.moments.map((moment) =>
        el('div', { class: 'brief-row' },
          el('div', {},
            sourceLink(`${moment.moment_date} · ${moment.name}`, { url: moment.source_url }),
            moment.audience ? el('p', { text: moment.audience }) : null
          )
        )
      )
    ),
    el('section', {},
      el('h4', { text: 'Recent campaign work' }),
      !brief.campaigns.length ? empty('No campaign work yet.') : null,
      ...brief.campaigns.map((campaign) =>
        el('div', { class: 'brief-row' },
          el('div', {},
            sourceLink(campaign.purpose, campaign.source_context),
            el('p', { text: `${campaign.kind === 'brief' ? 'Handoff brief' : campaign.format} · ${new Date(campaign.created_at + 'Z').toLocaleDateString()}` })
          )
        )
      )
    ),
    el('details', { class: 'brief-markdown' },
      el('summary', { text: 'Markdown copy' }),
      el('textarea', { rows: '14', readonly: '', text: brief.markdown })
    )
  );
}

function render() {
  mount(root,
    el('div', { class: 'row brief-controls' },
      el('button', {
        class: 'btn btn-neon',
        disabled: state.loading ? '' : undefined,
        text: state.loading ? 'Building…' : state.brief ? 'Refresh AVP Brief' : 'Build AVP Brief',
        onclick: () => build(),
      }),
      state.brief ? el('button', { class: 'btn', text: state.copied ? 'Copied' : 'Copy brief', onclick: copy }) : null,
      state.brief ? el('button', { class: 'btn btn-ghost', text: 'Print brief', onclick: () => window.print() }) : null
    ),
    state.error ? el('p', { class: 'error', role: 'alert', text: state.error }) : null,
    !state.brief && !state.loading ? el('p', { class: 'muted', text: 'Build a current brief when you need it. Nothing is scheduled or distributed.' }) : null,
    state.brief ? preview() : null
  );
}

export function init() {
  render();
}
