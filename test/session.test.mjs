import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const script = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function session(storage = new Map(), { startInStudio = false } = {}) {
  const { document, window } = parseHTML('<html><head></head><body><button id="theme-toggle"></button><span id="connection"></span><div id="workspace" data-refresh-url="/?change=review"><button id="toggle-review-details" aria-expanded="true"></button><main id="document"><div class="reader"><details id="old-note"><summary>Saved feedback</summary>Note</details><textarea id="draft"></textarea></div></main><aside id="review-details"></aside></div><dialog id="apply-dialog"></dialog><div id="toast"></div></body></html>');
  if (startInStudio) {
    document.getElementById('workspace').className = 'workspace compact-workspace studio-workspace';
    document.getElementById('toggle-review-details').remove();
    document.getElementById('review-details').remove();
  }
  const timers = [], sockets = [];
  let currentAgent = { connected: false };
  let active = null;
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => active });
  window.HTMLElement.prototype.focus = function () { active = this; };
  class Socket {
    listeners = new Map();
    constructor() { sockets.push(this); }
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    emit(name, data) { this.listeners.get(name)?.({ data }); }
    close() { this.emit('close'); }
  }
  const context = { document, window, location: { protocol: 'http:', host: '127.0.0.1:4310', pathname: '/', search: '' }, localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }, WebSocket: Socket, fetch: async () => ({ ok: true, json: async () => currentAgent }), setTimeout: callback => { timers.push(callback); return callback; }, clearTimeout: callback => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); } };
  vm.runInNewContext(script, context);
  return { document, window, sockets, timers, setAgent: value => { currentAgent = value; }, blur: () => { active = null; } };
}

test('Studio transitions keep inspector visibility and grid columns synchronized after HTMX settling', () => {
  const { document, window } = session(new Map(), { startInStudio: true });
  const enter = view => {
    const studio = view === 'studio';
    const incomingClass = `workspace compact-workspace ${studio ? 'studio-workspace' : `${view === 'files' ? 'diff-workspace ' : ''}review-details-open`}`;
    const next = document.createElement('div');
    next.id = 'workspace';
    // HTMX temporarily keeps the outgoing classes, then restores incoming ones.
    next.className = document.getElementById('workspace').className;
    next.innerHTML = `<main class="main"><div class="reader">${view}</div>${studio ? '' : '<button id="toggle-review-details" class="details-icon-toggle" data-review-details aria-expanded="true"></button>'}</main>${studio ? '' : '<aside id="review-details" class="inspector">Review context</aside>'}`;
    document.getElementById('workspace').replaceWith(next);
    document.dispatchEvent(new window.Event('htmx:afterSwap'));
    next.className = incomingClass;
    document.dispatchEvent(new window.Event('htmx:afterSettle'));
    return next;
  };
  const check = (workspace, open) => {
    assert.equal(workspace.classList.contains('review-details-open'), open);
    assert.equal(document.getElementById('review-details').hidden, !open);
    const toggle = document.getElementById('toggle-review-details');
    assert.equal(toggle.getAttribute('aria-expanded'), String(open));
    assert.equal(toggle.getAttribute('aria-label'), `${open ? 'Hide' : 'Show'} review details`);
  };
  for (const view of ['proposal','design','tasks','files']) {
    check(enter(view), true, 'first review view defaults to an open inspector');
    document.getElementById('toggle-review-details').click();
    check(document.getElementById('workspace'), false);
    assert.equal(enter('studio').classList.contains('review-details-open'), false);
    check(enter(view), false, 'an explicit closed preference survives Studio and settling');
    document.getElementById('toggle-review-details').click();
    check(document.getElementById('workspace'), true);
    enter('studio');
  }
});

test('agent captions track status without inline banners', async () => {
  const { document, window, sockets, setAgent } = session();
  document.querySelector('.reader').insertAdjacentHTML('beforeend', '<span data-lifecycle-agent-caption></span>');
  setAgent({ connected: true, agent: 'Current session' });
  sockets[0].emit('message', JSON.stringify({ type: 'agent' })); await flush();
  assert.equal(document.querySelector('[data-lifecycle-agent-note]'), null);
  assert.equal(document.querySelector('[data-lifecycle-agent-caption]').textContent, 'Same agent session');
  setAgent({ connected: false }); sockets[0].emit('message', JSON.stringify({ type: 'heartbeat' })); await flush();
  assert.equal(document.querySelector('[data-lifecycle-agent-caption]').textContent, 'Requests wait until your agent is attached');

});

test('reconnect refreshes missed changes, coalesces in-flight events and preserves disclosure, panel and viewport state', async () => {
  const { document, window, sockets, timers } = session();
  const requests = []; let release;
  const gate = new Promise(resolve => { release = resolve; });
  window.htmx = { ajax: async (_method, url) => {
    requests.push(url); if (requests.length === 1) await gate;
    const workspace = document.getElementById('workspace');
    workspace.replaceWith(workspace.cloneNode(true));
    document.getElementById('old-note').removeAttribute('open');
    document.querySelector('.reader').scrollTop = 0;
    document.dispatchEvent(new window.Event('htmx:afterSwap'));
  } };
  document.querySelector('.reader').scrollTop = 180;
  document.querySelector('.reader').scrollLeft = 24;
  document.getElementById('old-note').setAttribute('open', '');
  sockets[0].emit('open');
  assert.equal(requests.length, 0);
  sockets[0].emit('message', JSON.stringify({ type: 'changed' })); timers.shift()();
  sockets[0].emit('message', JSON.stringify({ type: 'changed' })); timers.shift()();
  assert.equal(requests.length, 1);
  release(); await flush();
  assert.ok(document.getElementById('old-note').hasAttribute('open'));
  assert.equal(document.querySelector('.reader').scrollTop, 180);
  assert.equal(document.querySelector('.reader').scrollLeft, 24);
  assert.equal(document.getElementById('toggle-review-details').getAttribute('aria-expanded'), 'true');
  timers.shift()(); timers.shift()(); await flush();
  assert.equal(requests.length, 2, 'an event during refresh is not lost');
  sockets[0].emit('close'); timers.shift()(); sockets[1].emit('open'); timers.shift()(); await flush();
  assert.equal(requests.length, 3, 'reconnect alone refreshes the canonical selected review');
  assert.ok(requests.every(url => url === '/?change=review'));
});

test('reconnect defers while typing and resumes after blur without discarding a draft', async () => {
  const { document, window, sockets, timers, blur } = session();
  const requests = [];
  window.htmx = { ajax: async (_method, url) => { requests.push(url); } };
  sockets[0].emit('open');
  const draft = document.getElementById('draft'); draft.value = 'Keep this unfinished feedback.'; draft.focus();
  sockets[0].emit('close'); timers.shift()(); sockets[1].emit('open');
  assert.equal(requests.length, 0);
  assert.equal(draft.value, 'Keep this unfinished feedback.');
  blur(); document.dispatchEvent(new window.Event('focusout')); timers.shift()(); await flush();
  assert.equal(requests.length, 1);
});

test('theme toggle persists its accessible label and tolerates unavailable browser storage', () => {
  const storage = new Map([['spequi-theme', 'dark']]);
  const { document } = session(storage);
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to light mode');
  document.getElementById('theme-toggle').click();
  assert.equal(storage.get('spequi-theme'), 'enterprise');
  assert.equal(document.getElementById('theme-toggle').getAttribute('aria-label'), 'Switch to dark mode');
  const blocked = { get() { throw new Error('Storage denied'); }, set() { throw new Error('Storage denied'); } };
  const next = session(blocked).document;
  next.getElementById('theme-toggle').click();
  assert.equal(next.documentElement.dataset.theme, 'dark');
});

test('progress notifications update request activity without fetching the whole workspace', async () => {
  const { document, window, sockets } = session(); let swaps = 0, updates = 0;
  window.htmx = { ajax: async () => { swaps++; } };
  document.addEventListener('requests-updated', () => { updates++; });
  sockets[0].emit('message', JSON.stringify({ type: 'requests' })); await flush();
  assert.equal(updates, 1); assert.equal(swaps, 0);
});

test('navigation aborts an older background refresh and prevents its state from being restored', async () => {
  const { document, window, sockets } = session(); let release, aborted = false;
  const gate = new Promise(resolve => { release = resolve; });
  window.htmx = { ajax: async () => gate };
  sockets[0].emit('message', JSON.stringify({ type: 'changed' }));
  const oldXHR = { abort() { aborted = true; } };
  const background = new window.Event('htmx:beforeRequest');
  background.detail = { xhr: oldXHR, requestConfig: { headers: { 'X-Spequi-Refresh': '1' } } }; document.dispatchEvent(background);
  const link = document.createElement('a'); link.href = '/?change=another'; document.getElementById('workspace').append(link);
  const navigation = new window.Event('htmx:beforeRequest'), newXHR = {};
  navigation.detail = { xhr: newXHR, target: document.getElementById('workspace'), elt: link }; document.dispatchEvent(navigation);
  assert.equal(aborted, true);
  const swap = new window.Event('htmx:beforeSwap'); swap.detail = { xhr: { ...oldXHR, status: 200 }, shouldSwap: true }; document.dispatchEvent(swap);
  assert.equal(swap.detail.shouldSwap, false);
  document.querySelector('.reader').scrollTop = 75; release(); await flush();
  assert.equal(document.querySelector('.reader').scrollTop, 75, 'old refresh cannot restore a scroll position over newer navigation');
  const complete = new window.Event('htmx:afterRequest'); complete.detail = { xhr: newXHR }; document.dispatchEvent(complete);
});

test('Files preserves the reader while loading, reports failures and rejects superseded responses', () => {
  const { document, window, timers } = session();
  const workspace = document.getElementById('workspace');
  workspace.classList.add('compact-workspace', 'review-details-open');
  const tabs = document.createElement('nav');
  tabs.innerHTML = '<a class="document-tab active" href="/?view=rendered">Proposal</a><a class="document-tab" data-files-tab href="/?view=preview" hx-get="/?view=preview" hx-target="#workspace"><span>Files</span></a>';
  workspace.querySelector('main').prepend(tabs);
  const files = tabs.querySelector('[data-files-tab]'), proposal = tabs.firstElementChild;
  const original = document.getElementById('draft'); original.value = 'Keep this draft';
  const event = (name, detail) => { const value = new window.Event(name); value.detail = detail; document.dispatchEvent(value); return value; };
  const xhr = { status: 0 };
  event('htmx:beforeRequest', { elt: files, target: workspace, xhr });
  assert.ok(proposal.classList.contains('active'));
  timers.shift()();
  assert.equal(files.getAttribute('aria-busy'), 'true');
  assert.equal(document.querySelector('.reader [role=status]'), null);
  assert.equal(document.getElementById('review-details').hidden, false);
  xhr.status = 500;
  assert.equal(event('htmx:beforeSwap', { xhr, shouldSwap: true }).detail.shouldSwap, false);
  event('htmx:afterRequest', { xhr, failed: true });
  assert.match(document.getElementById('toast').textContent, /Could not load file changes/);
  assert.equal(files.hasAttribute('aria-busy'), false);
  assert.equal(document.getElementById('draft'), original);
  assert.equal(original.value, 'Keep this draft');
  assert.ok(proposal.classList.contains('active'));
  const older = { status: 200 }, newer = { status: 200 };
  event('htmx:beforeRequest', { elt: files, target: workspace, xhr: older });
  event('htmx:beforeRequest', { elt: proposal, target: workspace, xhr: newer });
  assert.equal(event('htmx:beforeSwap', { xhr: older, shouldSwap: true }).detail.shouldSwap, false);
  assert.equal(event('htmx:beforeSwap', { xhr: newer, shouldSwap: true }).detail.shouldSwap, true);
  assert.equal(document.querySelector('.files-loading'), null);
});

test('applying shows pending feedback, prevents duplicate requests and recovers after failure', () => {
  const { document, window } = session();
  document.querySelector('.reader').insertAdjacentHTML('beforeend', '<form data-apply-form hx-post="/api/previews/one/apply"><button>Apply changes</button></form><div id="apply-feedback"></div>');
  const form = document.querySelector('[data-apply-form]'), button = form.querySelector('button'), xhr = { status: 0 };
  const event = (name, detail) => { const value = new window.Event(name, { cancelable: true }); value.detail = detail; document.dispatchEvent(value); return value; };
  event('htmx:beforeRequest', { elt: form, xhr });
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert.equal(button.disabled, true); assert.match(button.textContent, /Applying changes/);
  assert.match(document.querySelector('#apply-feedback [role=status]').textContent, /Saving the approved files/);
  assert.equal(event('htmx:beforeRequest', { elt: form, xhr: {} }).defaultPrevented, true);
  document.getElementById('apply-feedback').innerHTML = '<p class="error-message">Project changed since preview. No files applied.</p>';
  xhr.status = 409; event('htmx:afterRequest', { xhr, failed: true });
  assert.equal(button.disabled, false); assert.equal(button.textContent, 'Apply changes');
  assert.equal(form.hasAttribute('aria-busy'), false);
  assert.match(document.getElementById('apply-feedback').textContent, /Project changed/);
  const retry = { status: 0 }; event('htmx:beforeRequest', { elt: form, xhr: retry });
  event('htmx:afterRequest', { xhr: retry, failed: true });
  assert.match(document.querySelector('#apply-feedback [role=alert]').textContent, /Refresh this review/);
  assert.equal(button.disabled, false);
});

test('Apply confirmation uses the same preview form retained by a background refresh', () => {
  const { document, window } = session();
  document.querySelector('.reader').insertAdjacentHTML('beforeend', '<form data-apply-form hx-post="/api/previews/one/apply"><button>Apply changes</button></form>');
  const original = document.querySelector('[data-apply-form]'), dialog = document.getElementById('apply-dialog');
  dialog.showModal = () => {};
  original.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const current = original.cloneNode(true); let submitted = false;
  current.requestSubmit = () => { submitted = true; };
  original.replaceWith(current); dialog.returnValue = 'confirm';
  dialog.dispatchEvent(new window.Event('close'));
  assert.equal(submitted, true); assert.equal(current.dataset.confirmed, 'true');
});
