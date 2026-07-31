import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const index = read('public/index.html');
const login = read('public/login.html');
const app = read('public/js/app.js');
const notes = read('public/js/notes.js');
const feed = read('public/js/feed.js');
const player = read('public/js/player.js');
const tasks = read('public/js/tasks.js');
const campaigns = read('public/js/campaigns.js');
const workbench = read('public/js/workbench.js');
const moments = read('public/js/moments.js');
const brief = read('public/js/brief.js');
const data = read('public/js/data.js');
const poller = read('server/poller.js');
const visualizer = read('public/js/visualizer.js');
const css = read('public/css/app.css');

test('filters and modes expose native pressed controls with focus keys', () => {
  assert.equal((index.match(/aria-pressed="(?:true|false)"/g) || []).length, 4);
  assert.match(player, /setAttribute\('aria-pressed', String\(/);
  for (const source of [notes, feed]) {
    assert.match(source, /el\('button',[\s\S]{0,180}'aria-pressed': String\(/);
    assert.match(source, /'data-focus':/);
  }
  assert.doesNotMatch(notes, /el\('span',[\s\S]{0,180}onclick:/);
  assert.doesNotMatch(feed, /el\('span',[\s\S]{0,180}onclick:/);
});

test('all primary tools share one accessible branded workspace', () => {
  assert.match(index, /class="player-bar" id="panel-player"/);
  assert.match(index, /class="workspace-tabs" role="tablist"/);
  assert.equal((index.match(/role="tab"/g) || []).length, 5);
  assert.equal((index.match(/role="tabpanel"/g) || []).length, 5);
  assert.equal((index.match(/class="workspace-wordmark"/g) || []).length, 5);
  for (const [tab, panel] of [
    ['research', 'notes'],
    ['campaigns', 'campaigns'],
    ['moments', 'moments'],
    ['data', 'data'],
    ['brief', 'brief'],
  ]) {
    assert.match(index, new RegExp(`id="tab-${tab}"[\\s\\S]*?aria-controls="panel-${panel}"`));
    assert.match(index, new RegExp(`id="panel-${panel}"[\\s\\S]*?aria-labelledby="tab-${tab}"`));
  }
  assert.doesNotMatch(index, /class="secondary-tools"/);
  assert.match(app, /tab\.setAttribute\('aria-selected', String\(active\)\)/);
  assert.match(app, /ArrowLeft:/);
  assert.match(app, /ArrowRight:/);
  assert.match(css, /\.workspace-wordmark::after/);
  assert.match(css, /\.workspace-tabs\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.grid\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*minmax\(280px,\s*0\.31fr\)/);
});

test('symbol controls and affected form controls have explicit names', () => {
  assert.match(player, /'aria-label': audio\.paused \? 'Play' : 'Pause'/);
  assert.match(player, /'aria-label': 'Previous track'/);
  assert.match(player, /'aria-label': 'Next track'/);
  assert.match(player, /'aria-label': 'Volume'/);
  assert.match(player, /'aria-label': 'Search music'/);
  assert.match(feed, /'aria-label': a\.starred \? 'Unstar article' : 'Star article'/);
  assert.match(feed, /'aria-label': 'Add article to notes'/);
  assert.match(feed, /'aria-label': 'Refresh headlines'/);
  assert.match(notes, /'aria-label': 'Research question'/);
  assert.match(tasks, /'aria-label': 'New task'/);
  assert.match(tasks, /'aria-label': `Mark \$\{t\.text\} as \$\{t\.done \? 'not done' : 'done'\}`/);
  assert.match(tasks, /'aria-label': `Delete \$\{t\.text\}`/);
});

test('dashboard feedback uses one polite announcer and visible status semantics', () => {
  assert.equal((index.match(/id="app-status"/g) || []).length, 1);
  assert.match(index, /id="app-status"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.match(app, /export function announce\(message\)/);
  assert.match(app, /status\.textContent = message/);
  assert.match(login, /id="login-error"[^>]*role="alert"/);
  for (const source of [notes, feed, campaigns]) assert.match(source, /role: 'alert'/);
  for (const source of [notes, feed]) assert.match(source, /role: 'status'/);
  for (const source of [notes, feed, campaigns]) assert.match(source, /announce\('/);
});

test('campaign preflight is labeled, non-blocking, and keeps HTML inert', () => {
  for (const label of ['Audience', 'Sender', 'Channel', 'Deadline', 'Source title', 'Source URL']) {
    assert.match(campaigns, new RegExp(`field\\('${label}'`));
  }
  assert.match(campaigns, /aria-labelledby.*preflight-heading/);
  assert.match(campaigns, /Campaign preflight/);
  assert.match(campaigns, /Advisory/);
  assert.match(campaigns, /Copy output/);
  assert.match(campaigns, /class: 'output-area'/);
  assert.doesNotMatch(campaigns, /innerHTML|srcdoc/);
});

test('Use This workbench is a native dialog with five explicit destinations', () => {
  assert.match(index, /<dialog[^>]+id="use-this-dialog"/);
  assert.match(workbench, /aria-labelledby/);
  for (const label of ['Start campaign', 'Ask research', 'Save to notes', 'Create task', 'Add to AVP Brief']) {
    assert.match(workbench, new RegExp(label));
  }
  assert.match(workbench, /addEventListener\('close'/);
  assert.match(workbench, /invoker\?\.focus/);
});

test('feed exposes lane filters, source status, and Use This actions', () => {
  assert.match(feed, /campus.*local.*suny.*national/s);
  assert.match(feed, /Use this/);
  assert.match(feed, /Source refresh issues/);
});

test('Campaign Studio exposes editable Audience Lane guidance without resetting core fields', () => {
  assert.match(campaigns, /Audience Lane/);
  assert.match(campaigns, /Audience notes/);
  assert.match(campaigns, /f\.audience_lane = e\.target\.value/);
  assert.doesNotMatch(campaigns, /f\.purpose\s*=.*audience_lane/);
  assert.doesNotMatch(campaigns, /f\.cta\s*=.*audience_lane/);
});

test('Enrollment Moments has labeled native editing and separate past visibility', () => {
  assert.match(index, /id="moments-root"/);
  for (const label of ['Moment name', 'Date', 'Audience', 'Lead days', 'Channels', 'Source URL', 'Verified on', 'Notes']) {
    assert.match(moments, new RegExp(`field\\('${label}'`));
  }
  assert.match(moments, /type: 'date'/);
  assert.match(moments, /type: 'number'/);
  assert.match(moments, /Show past moments/);
  assert.match(moments, /normalizeMomentSource/);
});

test('moment handoffs only fill empty campaign audience and deadline fields', () => {
  assert.match(campaigns, /if \(!state\.form\.audience && source\.audience\)/);
  assert.match(campaigns, /if \(!state\.form\.deadline && source\.moment_date\)/);
  assert.match(workbench, /source\.moment_date.*Prepare/s);
});

test('AVP Brief is manual, removable, copyable, and printable without external sending', () => {
  assert.match(index, /id="brief-root"/);
  assert.match(brief, /Build AVP Brief/);
  assert.match(brief, /navigator\.clipboard\.writeText/);
  assert.match(brief, /window\.print/);
  assert.match(brief, /brief-selections\/\$\{selection\.id\}/);
  assert.doesNotMatch(brief, /send|email|publish/i);
  assert.doesNotMatch(poller, /brief/i);
});

test('Data Command Center fetches transient Slate tables and routes public metrics through Use This', () => {
  assert.match(index, /id="data-root"/);
  assert.match(data, /field\('Slate web service URL'/);
  assert.match(data, /type: 'url'/);
  assert.match(data, /Fetch from Slate/);
  assert.match(data, /Fetching from Slate/);
  assert.match(data, /el\('table'/);
  assert.match(data, /scope: 'col'/);
  assert.match(data, /not stored/i);
  assert.doesNotMatch(data, /type: 'file'|Import snapshot/);
  assert.match(data, /openWorkbench\(card\.source_context/);
  assert.match(data, /Refresh official data/);
});

test('print CSS isolates the AVP Brief from dashboard controls', () => {
  assert.match(css, /@media print/);
  for (const selector of ['.topbar', '.player-bar', '.side-rail', '.workspace-tabs', '.workspace-pane:not(#panel-brief)', '.workbench-dialog', '.brief-controls']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(css, /#panel-brief\[hidden\]\s*\{[^}]*display:\s*block\s*!important/s);
});

test('mobile targets, theme colors, and reduced motion remain centralized', () => {
  assert.match(css, /--star:/);
  assert.match(css, /--viz-trail-full:/);
  assert.match(css, /--viz-trail-medium:/);
  assert.match(css, /--viz-trail-ambient:/);
  assert.match(css, /\.starred\s*\{[^}]*var\(--star\)/s);
  assert.doesNotMatch(feed, /#ffd84d/i);
  assert.doesNotMatch(visualizer, /rgba\(7, 7, 13/);
  for (const token of ['--viz-trail-full', '--viz-trail-medium', '--viz-trail-ambient']) {
    assert.match(visualizer, new RegExp(`getPropertyValue\\('${token}'\\)`));
  }
  assert.match(css, /\.sr-only\s*\{/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*min-width:\s*44px/);
  assert.match(app, /meta\[name="theme-color"\]/);
  assert.match(login, /meta\[name="theme-color"\]/);
  assert.match(login, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.login-video\s*\{\s*display:\s*none/);
  assert.doesNotMatch(css, /\.login-video\s*\{[^}]*\b(?:filter|backdrop-filter)\s*:/s);
});
