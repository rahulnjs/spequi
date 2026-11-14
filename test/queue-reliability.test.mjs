import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { initProject } from '../src/project.mjs';
import { readJSON, writeJSON, runtime, acquireLock, withLock, exists, cleanupTemporaryFiles } from '../src/files.mjs';
import { enqueue, claimNext, updateJob, getJob, listJobs, agentStatus, heartbeat, createJobReader } from '../src/jobs.mjs';
import { startServer } from '../src/server.mjs';
import { createWorkspaceState } from '../src/workspace-state.mjs';
import { capturePlan } from '../src/studio-plans.mjs';
import { applyPreview } from '../src/previews.mjs';
import { deleteRequest, requestPage } from '../src/requests.mjs';
import { saveDraft, listDrafts, deleteDraft } from '../src/drafts.mjs';
import { requestLifecycle } from '../src/lifecycle.mjs';
import { reportSession } from '../src/agent-session.mjs';
const exec = promisify(execFile);
const put = async (root, file, text) => { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); };
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'spequi queue ')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await initProject(root);
  await put(root, 'openspec/changes/feature/proposal.md', '# A feature\n');
  return root;
}
async function until(check) { for (let i = 0; i < 150; i++) { if (await check()) return; await delay(20); } throw new Error('Condition did not settle'); }

test('legacy empty and dead-owner locks recover without losing or duplicating queued work', async t => {
  for (const legacy of [true, false]) {
    const root = await fixture(t), queued = await enqueue(root, { action: 'explore', change: 'feature' });
    await put(root, '.spequi/queue.lock', legacy ? '' : JSON.stringify({ pid: 2147483647, token: 'abandoned' }));
    const old = new Date(Date.now() - 7200000); await fs.utimes(runtime(root, 'queue.lock'), old, old);
    const claims = await Promise.all(Array.from({ length: 6 }, () => claimNext(root, 'Same agent', 'one-session')));
    assert.equal(claims.filter(Boolean).length, 1); assert.equal(claims.find(Boolean).id, queued.id);
    assert.equal(await exists(runtime(root, 'queue.lock')), false);
    assert.equal((await getJob(root, queued.id)).status, 'running');
  }
});
test('live locks are explicit contention rather than an empty queue or a stolen lock', async t => {
  const root = await fixture(t), release = await acquireLock(runtime(root, 'queue.lock'));
  try {
    await enqueue(root, { action: 'explore', change: 'feature' });
    await assert.rejects(claimNext(root, 'Agent'), error => error.code === 'LOCK_BUSY' && /not empty/.test(error.message));
    assert.equal((await listJobs(root))[0].status, 'queued');
    await assert.rejects(withLock(runtime(root, 'queue.lock'), () => {}, { waitMs: 0 }), { code: 'LOCK_BUSY' });
  } finally { await release(); }
});
test('parallel polls cannot claim a second job, and preparation holds no queue lock', async t => {
  const root = await fixture(t);
  await capturePlan(root, 'feature');
  const queued = await enqueue(root, { action: 'revise-plan', change: 'feature', message: 'Revise the plan' });
  await enqueue(root, { action: 'explore', change: 'feature', message: 'Then inspect' });
  const folder = createHash('sha256').update('feature').digest('hex');
  const release = await acquireLock(runtime(root, 'studio', folder, 'capture.lock'));
  let preparation;
  try {
    preparation = claimNext(root, 'Agent', 'one-session');
    await until(async () => (await getJob(root, queued.id)).preparing);
    assert.equal(await exists(runtime(root, 'queue.lock')), false);
    assert.equal(await claimNext(root, 'Agent', 'one-session'), null);
    assert.equal((await listJobs(root)).filter(job => job.status === 'queued').length, 1);
  } finally { await release(); }
  const claimed = await preparation;
  assert.equal(claimed.id, queued.id); assert.equal(claimed.preparing, false);
  await updateJob(root, claimed.id, claimed.claimToken, 'finish', 'Done');
  assert.equal((await updateJob(root, claimed.id, claimed.claimToken, 'finish', 'Done')).status, 'completed');
  assert.ok(await claimNext(root, 'Agent', 'one-session'));
});
test('a JSON rename failure preserves the previous record and cleans staging files; transient Windows errors retry', async t => {
  const root = await fixture(t), target = runtime(root, 'atomic.json');
  await writeJSON(target, { revision: 1 });
  await assert.rejects(writeJSON(target, { revision: 2 }, { rename: async () => { throw Object.assign(new Error('Denied'), { code: 'EIO' }); } }), /Denied/);
  assert.deepEqual(await readJSON(target), { revision: 1 });
  assert.equal((await fs.readdir(runtime(root))).some(name => name.startsWith('atomic.json.') && name.endsWith('.tmp')), false);
  let attempts = 0;
  await writeJSON(target, { revision: 2 }, { rename: async (from, to) => { if (++attempts < 3) throw Object.assign(new Error('Busy'), { code: 'EPERM' }); await fs.rename(from, to); } });
  assert.equal(attempts, 3); assert.equal((await readJSON(target)).revision, 2);
  await put(root, '.spequi/agent.json.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp', 'old');
  await put(root, '.spequi/agent.json.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.tmp', 'active');
  const old = new Date(Date.now() - 7200000); await fs.utimes(runtime(root, 'agent.json.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp'), old, old);
  assert.equal(await cleanupTemporaryFiles(root), 1);
  assert.equal(await exists(runtime(root, 'agent.json.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.tmp')), true);
});
test('reports alone do not claim readiness and another attachment does not hide stalled ownership', async t => {
  const root = await fixture(t);
  await reportSession(root, { agent: 'Agent', sessionId: 'one', mcps: { supported: false, connections: [] } });
  assert.equal((await agentStatus(root)).ready, false);
  await heartbeat(root, 'Agent', 'one', { polling: true }); assert.equal((await agentStatus(root)).ready, true);
  await enqueue(root, { action: 'explore', change: 'feature' }); const owned = await claimNext(root, 'Agent', 'one');
  await reportSession(root, { agent: 'Agent', sessionId: 'two', mcps: { supported: false, connections: [] } });
  const status = await agentStatus(root);
  assert.equal(status.connected, true); assert.equal(status.ready, false); assert.equal(status.status, 'blocked');
  assert.equal(status.queue.active.ownerConnected, false);
  await updateJob(root, owned.id, null, 'cancel', 'Stopped the previous session');
});
test('request identity survives browser retries and rejects different instructions', async t => {
  const root = await fixture(t), payload = { action: 'explore', change: 'feature', message: 'Inspect', requestKey: 'request-one' };
  const queued = await Promise.all([enqueue(root, payload), enqueue(root, payload)]);
  assert.equal(queued[0].id, queued[1].id); assert.equal((await listJobs(root)).length, 1);
  await assert.rejects(enqueue(root, { ...payload, message: 'Different' }), /different instructions/);
});
test('a bound background wait leaves work queued until a foreground claim and uses the same project server', async t => {
  const root = await fixture(t), viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const args = [path.resolve('bin/spequi.mjs'), 'agent'];
  const waiting = exec(process.execPath, [...args, 'wait', '--wait', '300', '--name', 'Agent', '--session-id', 'session', '--root', root], { timeout: 10000 });
  await until(async () => (await agentStatus(root)).ready);
  const queued = await enqueue(root, { action: 'explore', change: 'feature', message: 'From the browser' });
  const result = JSON.parse((await waiting).stdout);
  assert.equal(result.available, true); assert.equal(result.protocol, 1); assert.equal(result.root, root);
  assert.equal((await getJob(root, queued.id)).status, 'queued');
  assert.equal((await agentStatus(root)).ready, false, 'a completed background wait is not a live consumer');
  const claimed = JSON.parse((await exec(process.execPath, [...args, 'next', '--name', 'Agent', '--session-id', 'session', '--root', root])).stdout);
  assert.equal(claimed.job.id, queued.id);
  const second = JSON.parse((await exec(process.execPath, [...args, 'next', '--root', root])).stdout);
  assert.equal(second.job, null); assert.equal(second.queue.status, 'working');
  const bad = await fetch(viewer.origin + '/api/agent/next', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' }); assert.equal(bad.status, 403);
  await assert.rejects(startServer({ root, port: 0, quiet: true }), { code: 'LOCK_BUSY' });
  const records = JSON.stringify(await (await fetch(viewer.origin + '/api/requests')).json());
  assert.equal(records.includes(claimed.job.claimToken), false); assert.equal(records.includes('instructions'), false);
});
test('job progress invalidates only that cached record and emits a targeted notification', async t => {
  const root = await fixture(t), queued = await enqueue(root, { action: 'explore', change: 'feature' });
  const reader = createJobReader(root); t.after(() => reader.close()); await reader.read();
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const ws = new WebSocket(viewer.origin.replace('http', 'ws') + '/live', { origin: viewer.origin }); await once(ws, 'open'); t.after(() => ws.terminate());
  const messages = []; ws.on('message', data => messages.push(JSON.parse(data).type));
  const job = await claimNext(root, 'Agent'); await delay(450); messages.length = 0;
  await updateJob(root, job.id, job.claimToken, 'log', 'Still working');
  await until(() => messages.includes('requests'));
  assert.equal(messages.includes('changed'), false);
  assert.equal((await reader.read()).find(job => job.id === queued.id).logs.at(-1).message, 'Still working');
  const html = await (await fetch(viewer.origin)).text(); assert.equal(html.includes('workspace-modes'), false); assert.ok(html.includes('data-requests-toggle'));
});
test('readiness is asynchronous, coalesced, invalidated and never blocks opening the document', async t => {
  const root = await fixture(t); let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const state = createWorkspaceState(root, { check: async () => { calls++; await gate; return { planningComplete: true }; } }); t.after(() => state.close());
  assert.equal(state.readiness('feature'), null); assert.equal(state.readiness('feature'), null); assert.equal(calls, 1);
  assert.ok((await state.data()).changes.some(change => change.id === 'feature'));
  release(); await until(() => state.readiness('feature')?.planningComplete); assert.equal(calls, 1);
  state.invalidate('feature'); assert.equal(state.readiness('feature'), null); await until(() => state.readiness('feature')?.planningComplete); assert.equal(calls, 2);
});
test('deleting request and review data keeps applied source and backups, and pending/dependent work is protected', async t => {
  const root = await fixture(t); await put(root, 'app.js', 'original\n');
  const queued = await enqueue(root, { action: 'preview', change: 'feature' });
  await assert.rejects(deleteRequest(root, queued.id), /Finish or cancel/);
  const job = await claimNext(root, 'Agent'); await put(job.workingDirectory, 'app.js', 'reviewed\n'); await updateJob(root, job.id, job.claimToken, 'finish', 'Ready');
  await applyPreview(root, job.id); await put(root, `.spequi/reviews/${job.id}/comments.json`, '[]');
  await deleteRequest(root, job.id, { reviewData: true });
  assert.equal(await fs.readFile(path.join(root, 'app.js'), 'utf8'), 'reviewed\n');
  assert.equal(await fs.readFile(runtime(root, 'backups', job.id, 'app.js'), 'utf8'), 'original\n');
  assert.equal(await exists(runtime(root, 'jobs', `${job.id}.json`)), false); assert.equal(await exists(runtime(root, 'previews', job.id)), false); assert.equal(await exists(runtime(root, 'reviews', job.id)), false);
});
test('request filters paginate history and preserving review data hides only the request', async t => {
  const root = await fixture(t), job = await enqueue(root, { action: 'explore', change: 'feature' }); await updateJob(root, job.id, null, 'cancel');
  await deleteRequest(root, job.id, { reviewData: false }); assert.ok((await getJob(root, job.id)).hiddenAt); assert.equal(requestPage(await listJobs(root)).total, 0);
  const jobs = Array.from({ length: 45 }, (_, index) => ({ id: String(index), status: index % 2 ? 'completed' : 'queued' }));
  assert.equal(requestPage(jobs, { status: 'active' }).total, 23); assert.equal(requestPage(jobs, { status: 'all', page: 3 }).items.length, 5);
});
test('drafts resume saved ideas, bind one planning request, and never delete unrelated planning files', async t => {
  const { parseHTML } = await import('linkedom');
  const root = await fixture(t), draft = await saveDraft(root, { change: 'new-feature', message: 'A saved idea', planMode: 'next' });
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  let html = await (await fetch(viewer.origin + `/?view=studio&new=1&draft=${draft.id}`)).text();
  assert.match(html, /A saved idea/); assert.match(html, /data-drafts-navigation/); assert.match(html, /value="new-feature"/);
  const payload = { action: 'start-plan', change: 'new-feature', message: 'A saved idea', draftId: draft.id, requestKey: 'creation-one' };
  const options = { runCLI: async () => ({ root: { path: root } }) };
  const first = await requestLifecycle(root, payload, options), again = await requestLifecycle(root, payload, options);
  assert.equal(first.job.id, again.job.id); assert.equal((await listDrafts(root))[0].creationId, first.job.id);
  const reopened = parseHTML(await (await fetch(viewer.origin + `/?view=studio&new=1&draft=${draft.id}`)).text()).document;
  assert.equal(reopened.querySelector('[data-create-spec]'), null, 'A submitted draft must reopen its request, not its editable idea form');
  assert.ok(reopened.getElementById(`studio-job-${first.job.id}`));
  await assert.rejects(deleteDraft(root, draft.id), /active request/);
  const claimed = await claimNext(root, 'Agent'); await put(root, 'openspec/changes/new-feature/proposal.md', '# Partial plan\n'); await updateJob(root, claimed.id, claimed.claimToken, 'fail', 'Stopped part way through planning');
  html = await (await fetch(viewer.origin + `/?change=new-feature&view=studio&draft=${draft.id}`)).text(); assert.match(html, /Partial plan/);
  await deleteDraft(root, draft.id, { deletePlan: true }); assert.equal(await exists(path.join(root, 'openspec/changes/new-feature')), false); assert.equal(await exists(path.join(root, 'openspec/changes/feature/proposal.md')), true);
  const unrelated = await saveDraft(root, { change: 'feature', message: 'Another idea' }); await assert.rejects(deleteDraft(root, unrelated.id, { deletePlan: true }), /Only planning files/);
});

test('HTTP opens another spec while readiness is deliberately held, without waiting for the check', async t => {
  const root = await fixture(t); await put(root, 'openspec/changes/another/proposal.md', '# Another spec\n');
  let release, called = false;
  const gate = new Promise(resolve => { release = resolve; });
  const viewer = await startServer({ root, port: 0, quiet: true, readinessCheck: async (actualRoot, change) => {
    assert.equal(actualRoot, root); assert.equal(change, 'feature'); called = true;
    await gate;
    return { planningComplete: false, artifacts: [{ id: 'proposal', status: 'done' }, { id: 'specs', status: 'ready' }], artifactPaths: {}, nextArtifact: 'specs', tasks: { total: 0, done: 0 }, applyState: 'blocked' };
  } });
  t.after(() => { release(); return viewer.close(); });
  const response = await fetch(viewer.origin + '/?change=feature&view=studio', { signal: AbortSignal.timeout(2000) });
  const html = await response.text(); assert.equal(response.status, 200); assert.match(html, /A feature/); assert.match(html, /data-readiness-pending="true"/); assert.equal(called, true);
  const other = await fetch(viewer.origin + '/?change=another', { signal: AbortSignal.timeout(2000) }); assert.equal(other.status, 200); assert.match(await other.text(), /Another spec/);
  release();
});

test('removing a preview is blocked while another retained request depends on its review data', async t => {
  const root = await fixture(t); await put(root, 'app.js', 'before\n');
  await enqueue(root, { action: 'preview', change: 'feature' }); const preview = await claimNext(root, 'Agent');
  await put(preview.workingDirectory, 'app.js', 'after\n'); await updateJob(root, preview.id, preview.claimToken, 'finish', 'Ready');
  await enqueue(root, { action: 'impact', reviewPreview: preview.id, reviewFile: 'app.js' });
  await assert.rejects(deleteRequest(root, preview.id), /Another retained request/);
  assert.equal(await exists(runtime(root, 'previews', preview.id, 'result.json')), true);
});

test('init ships the monitored GigaCode background wait to both installed skill locations', async t => {
  const root = await fixture(t);
  const shared = await fs.readFile(path.join(root, '.agents/skills/spequi/SKILL.md'), 'utf8');
  const gigacode = await fs.readFile(path.join(root, '.gigacode/skills/spequi/SKILL.md'), 'utf8');
  assert.equal(shared, gigacode); assert.match(gigacode, /is_background: true/); assert.match(gigacode, /agent wait --wait 300/); assert.match(gigacode, /does \*\*not\*\* claim/); assert.match(gigacode, /completion notification/);
});

test('cancelled unclaimed drafts cannot delete planning files created by someone else', async t => {
  const root = await fixture(t), draft = await saveDraft(root, { change: 'other-feature', message: 'An idea' });
  const { job } = await requestLifecycle(root, { action: 'start-plan', change: 'other-feature', message: 'An idea', draftId: draft.id }, { runCLI: async () => ({ root: { path: root } }) });
  await updateJob(root, job.id, null, 'cancel');
  await put(root, 'openspec/changes/other-feature/proposal.md', '# Unrelated work\n');
  await assert.rejects(deleteDraft(root, draft.id, { deletePlan: true }), /Only planning files/);
  assert.equal(await fs.readFile(path.join(root, 'openspec/changes/other-feature/proposal.md'), 'utf8'), '# Unrelated work\n');
});

test('archived activity has the same revision as its workspace and new drafts keep one identity through search', async t => {
  const { parseHTML } = await import('linkedom');
  const root = await fixture(t);
  const request = await enqueue(root, { action: 'explore', change: 'feature' }); await updateJob(root, request.id, null, 'cancel');
  await fs.mkdir(path.join(root, 'openspec/changes/archive'), { recursive: true }); await fs.rename(path.join(root, 'openspec/changes/feature'), path.join(root, 'openspec/changes/archive/2026-11-13-feature'));
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const document = parseHTML(await (await fetch(viewer.origin + '/?change=2026-11-13-feature')).text()).document;
  const activity = await (await fetch(viewer.origin + '/api/activity?change=2026-11-13-feature')).json();
  assert.equal(document.getElementById('workspace').dataset.requestState, activity.revision);
  assert.equal(JSON.parse(activity.revision)[0][0], request.id);
  const idea = parseHTML(await (await fetch(viewer.origin + '/?view=studio&new=1')).text()).document;
  const id = idea.querySelector('[name=draftId]').value;
  assert.equal(idea.querySelector('#navigation [name=draft]').value, id);
  assert.equal(new URL(idea.getElementById('workspace').dataset.refreshUrl, viewer.origin).searchParams.get('draft'), id);
  for (const name of ['request', 'draft']) {
    const dialog = idea.getElementById(`${name}-delete-dialog`);
    assert.ok(idea.getElementById(dialog.getAttribute('aria-labelledby')).textContent);
    assert.ok(dialog.getAttribute('aria-describedby').split(' ').every(id => idea.getElementById(id)));
  }
});

test('cancelled empty drafts can resume or be deleted, including after their request history is removed', async t => {
  const { resumeDraft } = await import('../src/drafts.mjs');
  const root = await fixture(t), draft = await saveDraft(root, { change: 'cancelled-idea', message: 'Keep this idea' });
  const payload = { action: 'start-plan', change: 'cancelled-idea', message: 'Keep this idea', draftId: draft.id };
  const options = { runCLI: async () => ({ root: { path: root } }) };
  const { job } = await requestLifecycle(root, payload, options); await updateJob(root, job.id, null, 'cancel');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const html = await (await fetch(viewer.origin + `/?view=studio&new=1&creation=${job.id}`)).text();
  assert.match(html, /Resume draft/); assert.match(html, new RegExp(`data-draft-delete="${draft.id}"`));
  const result = await resumeDraft(root, draft.id); assert.match(result.url, /new=1/);
  assert.equal((await listDrafts(root))[0].creationId, undefined); assert.equal((await listDrafts(root))[0].message, 'Keep this idea');
  const again = await requestLifecycle(root, payload, options); assert.notEqual(again.job.id, job.id);
  await updateJob(root, again.job.id, null, 'cancel'); await deleteRequest(root, again.job.id);
  assert.equal((await listDrafts(root))[0].creationId, undefined);
  await saveDraft(root, { id: draft.id, change: 'cancelled-idea', message: 'The idea can still be edited' });
  await deleteDraft(root, draft.id); assert.equal((await listDrafts(root)).length, 0);
});
