import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const script = await fs.readFile(new URL('../public/requests.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
async function drawer({ empty = false, requests } = {}) {
  const { document, window } = parseHTML('<html><head><meta name="csrf-token" content="csrf"></head><body><button data-requests-toggle aria-expanded="false">Requests</button><button id="outside">Outside</button><aside id="requests-panel" hidden><button data-requests-close>Close</button><select data-request-filter><option value="all" selected>All</option><option value="active">Active</option></select><div data-requests-feedback></div><div data-request-list></div><footer><span data-request-pagination></span><button data-request-page="previous">Previous</button><button data-request-page="next">Next</button></footer></aside><div id="workspace" data-change="feature" data-refresh-url="/?change=feature" data-request-state="[]"></div></body></html>');
  let active, filterValue = 'all';
  Object.defineProperty(document.querySelector('[data-request-filter]'), 'value', { get: () => filterValue, set: value => { filterValue = value; } });
  Object.defineProperty(document, 'activeElement', { get: () => active });
  window.HTMLElement.prototype.focus = function () { active = this; };
  const job = { id: 'request-one', action: 'explore', change: 'feature', status: 'completed', message: 'Inspect the requirement', updatedAt: new Date().toISOString(), logs: [{ message: 'Checked' }] };
  vm.runInNewContext(script, { document, window, URL, URLSearchParams, location: { href: 'http://localhost/?change=feature' }, setTimeout, clearTimeout,
    fetch: async url => ({ ok: true, json: async () => url.startsWith('/api/requests') ? { items: empty || new URL(url, 'http://localhost').searchParams.get('status') === 'active' ? [] : requests || [job], total: empty || new URL(url, 'http://localhost').searchParams.get('status') === 'active' ? 0 : (requests || [job]).length, page: 1, pages: 1 } : { agent: {}, revision: '[]', thread: '', drafts: [], active: [] } }) });
  await flush(); document.querySelector('[data-requests-toggle]').click(); await flush();
  return { document, window };
}
test('live Requests updates retain keyboard focus on the same summary and action', async () => {
  const { document, window } = await drawer();
  const previous = document.querySelector('.request-row summary'); previous.focus();
  document.dispatchEvent(new window.Event('requests-updated')); await flush();
  assert.equal(previous.isConnected, false); assert.equal(document.activeElement, document.querySelector('.request-row summary'));
  document.querySelector('[data-request-action=delete]').focus();
  document.dispatchEvent(new window.Event('requests-updated')); await flush();
  assert.equal(document.activeElement, document.querySelector('[data-request-action=delete]'));
});

test('Open request uses the shared spec workspace at the relevant stage and retains preview context', async () => {
  const cases = [
    ['start-plan', 'queued', null], ['start-plan', 'completed', null],
    ['plan-next', 'completed', 'shape'], ['revise-plan', 'failed', 'shape'],
    ['update-specs', 'queued', 'shape'], ['explore', 'awaiting-input', 'shape'],
    ['preview', 'queued', 'implement'], ['preview', 'completed', 'implement'],
    ['impact', 'completed', 'implement'], ['verify', 'completed', 'finish'],
    ['sync-specs', 'queued', 'finish'], ['archive', 'completed', 'finish']
  ];
  const requests = cases.map(([action, status], index) => ({ id: `request-${index}`, action, status, change: 'feature', updatedAt: new Date().toISOString(), logs: [], ...(action === 'impact' ? { reviewPreview: 'reviewed-preview', reviewFile: 'src/feature.mjs' } : {}) }));
  const { document } = await drawer({ requests });
  for (const [index, [action, status, stage]] of cases.entries()) {
    const link = document.querySelectorAll('.request-controls a')[index];
    const query = new URL(link.getAttribute('href'), 'http://localhost').searchParams;
    assert.equal(query.get('view'), 'studio', `${action} ${status} reuses the spec workspace`);
    if (action === 'start-plan') {
      assert.equal(query.get('creation'), requests[index].id);
      assert.equal(query.get('new'), '1');
    } else {
      assert.equal(query.get('change'), 'feature');
      assert.equal(query.get('stage'), stage);
      if (status === 'awaiting-input') assert.equal(query.get('pane'), 'conversation');
    }
    if (action === 'preview') assert.equal(query.get('job'), requests[index].id);
    if (action === 'impact') {
      assert.equal(query.get('job'), 'reviewed-preview');
      assert.equal(query.get('file'), 'src/feature.mjs');
    }
  }
});
test('Escape restores the Requests opener only while its drawer is open', async () => {
  const { document, window } = await drawer();
  const escape = () => { const event = new window.Event('keydown'); event.key = 'Escape'; document.dispatchEvent(event); };
  escape(); assert.equal(document.getElementById('requests-panel').hidden, true); assert.equal(document.activeElement, document.querySelector('[data-requests-toggle]'));
  document.getElementById('outside').focus(); escape(); assert.equal(document.activeElement, document.getElementById('outside'));
});

test('empty history offers a new spec and hides pagination', async () => {
  const { document, window } = await drawer({ empty: true });
  assert.equal(document.querySelector('.requests-empty h3').textContent, 'No requests yet');
  const action = document.querySelector('[data-request-empty-action]');
  assert.equal(action.getAttribute('href'), '/?view=studio&new=1');
  assert.equal(document.querySelector('#requests-panel footer').hidden, true);
  action.focus(); document.dispatchEvent(new window.Event('requests-updated')); await flush();
  assert.equal(document.activeElement, document.querySelector('[data-request-empty-action]'));
  document.querySelector('[data-request-empty-action]').click();
  assert.equal(document.getElementById('requests-panel').hidden, true);
  assert.equal(document.querySelector('[data-requests-toggle]').getAttribute('aria-expanded'), 'false');
});
test('an empty active filter can return to history without closing the drawer', async () => {
  const { document, window } = await drawer();
  const filter = document.querySelector('[data-request-filter]');
  filter.value = 'active'; filter.dispatchEvent(new window.Event('change', { bubbles: true })); await flush();
  assert.equal(document.querySelector('.requests-empty h3').textContent, 'No active requests');
  assert.equal(document.querySelector('#requests-panel footer').hidden, true);
  document.querySelector('[data-request-show-all]').click(); await flush();
  assert.equal(filter.value, 'all');
  assert.equal(document.activeElement, filter);
  assert.equal(document.querySelector('.requests-empty'), null);
  assert.ok(document.querySelector('.request-row'));
  assert.equal(document.querySelector('#requests-panel footer').hidden, false);
});
