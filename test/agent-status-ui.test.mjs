import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
const script = await fs.readFile(new URL('../public/session.js', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
const offline = { status: 'unresponsive', connected: false, ready: false, agent: 'Codex' };
async function setup() {
  const { document, window } = parseHTML('<button id="agent-indicator" data-session-toggle aria-controls="agent-connections"><span data-session-label></span></button><aside id="agent-connections"><span id="session-agent-name"></span><span id="session-state"></span><p id="session-agent-caption"></p><dl><dt>Last seen</dt><dd><time id="session-last-seen"></time></dd><dt>Queue</dt><dd id="session-queue-state"></dd></dl><section data-session-current hidden><strong id="session-current-change"></strong><span id="session-current-state"></span><p id="session-current-hint"></p></section><section id="session-recovery"><p id="session-recovery-message"></p><p id="session-recovery-detail" hidden></p></section><button data-session-refresh>Refresh status</button><p data-session-check-result role="status"></p></aside>');
  delete window.spequiRefreshAgent;
  const network = { reply: async () => ({ ok: true, json: async () => offline }) };
  vm.runInNewContext(script, { document, window, fetch: (...args) => network.reply(...args), setInterval() {} });
  await flush();
  return { document, window, network, button: document.querySelector('[data-session-refresh]'), result: document.querySelector('[data-session-check-result]') };
}
test('manual status checks show progress, prevent duplicates, and report an unchanged disconnection', async () => {
  const { document, window, button, result } = await setup();
  let release, calls = 0;
  const pending = new Promise(resolve => { release = resolve; });
  window.spequiRefreshAgent = () => { calls++; return pending; };
  button.click(); button.click();
  assert.equal(calls, 1); assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Checking…'); assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.match(result.textContent, /Checking agent status/);
  release(offline); await flush();
  assert.match(result.textContent, /Still disconnected/);
  assert.equal(button.disabled, false); assert.equal(button.textContent, 'Refresh status');
  assert.equal(button.hasAttribute('aria-busy'), false);
  assert.match(document.querySelector('#agent-indicator').textContent, /Agent offline/);
});
test('status-check failures are visible and a retry can recover without losing the result or button', async () => {
  const { document, window, button, result } = await setup();
  window.spequiRefreshAgent = async () => null;
  button.click(); await flush();
  assert.match(result.textContent, /Could not refresh status/); assert.equal(result.dataset.state, 'error');
  assert.equal(button.disabled, false);
  window.spequiRefreshAgent = async () => ({ ...offline, status: 'live', connected: true, ready: true });
  button.click(); await flush();
  assert.equal(result.textContent, 'Codex is connected and ready.');
  assert.equal(document.querySelector('#session-recovery').hidden, true);
  assert.equal(button.closest('#session-recovery'), null); assert.equal(button.disabled, false);
  assert.equal(document.querySelector('#agent-indicator').textContent, 'Codex · Ready');
  document.dispatchEvent(new window.CustomEvent('agent-status', { detail: offline }));
  assert.equal(result.textContent, '', 'A later state change must clear an outdated check result');
});
test('standalone HTTP and network failures produce a retryable result rather than a silent check', async () => {
  const { network, button, result } = await setup();
  for (const reply of [async () => ({ ok: false }), async () => { throw new Error('Network unavailable'); }]) {
    network.reply = reply; button.click(); await flush();
    assert.match(result.textContent, /Could not refresh status/); assert.equal(button.disabled, false);
  }
});

test('agent details distinguish listening, paused, active, stalled and unknown states using useful facts', async () => {
 const {document,window}=await setup();
 const render=agent=>document.dispatchEvent(new window.CustomEvent('agent-status',{detail:agent}));
 const value=id=>document.getElementById(id).textContent;
 render({...offline,status:'live',connected:true,ready:true,at:Date.now(),queue:{queued:0,active:null}});
 assert.equal(value('session-state'),'Ready');assert.equal(value('session-last-seen'),'Just now');assert.equal(value('session-queue-state'),'Empty');
 assert.equal(document.getElementById('session-recovery').hidden,true);
 render({...offline,status:'connected',connected:true,at:Date.now()-120000,queue:{queued:2,active:null}});
 assert.equal(value('session-state'),'Connected');assert.equal(value('session-last-seen'),'2 minutes ago');assert.ok(document.getElementById('session-last-seen').title);
 assert.equal(value('session-queue-state'),'2 waiting');assert.match(value('session-agent-caption'),/Not listening/);assert.match(value('session-recovery-message'),/receive requests/);
 const active={id:'job',change:'draft-icon',status:'running',preparing:true,ownerConnected:true};
 render({...offline,status:'working',connected:true,queue:{queued:1,active}});
 assert.equal(value('session-current-change'),'draft-icon');assert.equal(value('session-current-state'),'Preparing');assert.equal(document.querySelector('[data-session-current]').hidden,false);
 render({...offline,status:'blocked',connected:true,queue:{queued:1,active:{...active,ownerConnected:false}}});
 assert.equal(value('session-current-state'),'Waiting for agent');assert.equal(document.getElementById('session-recovery-detail').hidden,false);assert.match(value('session-recovery-detail'),/stop it before ending/);
 render({...offline,queue:{queued:0,active:{...active,ownerConnected:false,origin:'local-edits'}}});
 assert.equal(value('session-current-state'),'Preparing');assert.match(value('session-current-hint'),/local preview/);assert.equal(document.getElementById('session-recovery-detail').hidden,true);
 render({...offline,status:'waiting',connected:true,queue:{queued:0,active:{...active,status:'awaiting-input'}}});
 assert.equal(value('session-current-state'),'Answer needed');assert.match(value('session-current-hint'),/answer the question/);
 render({...offline,status:'unavailable',queue:{queued:1,active}});
 assert.equal(value('session-state'),'Unknown');assert.equal(value('session-queue-state'),'Unknown');assert.equal(document.querySelector('[data-session-current]').hidden,true);
 assert.doesNotMatch(document.querySelector('#agent-connections').textContent,/consumer|poll|Reconnect your agent/);
});
