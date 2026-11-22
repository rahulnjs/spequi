import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requestPage, dismissRequest, inboxState } from '../src/requests.mjs';
import { writeJob, listJobs } from '../src/jobs.mjs';
import { initProject } from '../src/project.mjs';
import { startServer } from '../src/server.mjs';

const record = (id, change, status, minute = 0) => ({ id, change, status, action: 'preview', createdAt: new Date(Date.UTC(2026, 10, 14, 0, minute)).toISOString(), updatedAt: new Date(Date.UTC(2026, 10, 14, 0, minute)).toISOString(), message: `Request ${id}`, logs: [] });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spequi-inbox-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root); return root;
}

test('inbox groups by spec, prioritizes attention, bounds recent results and leaves history complete', () => {
  const jobs = [record('queued', 'queued-spec', 'queued', 20), record('working', 'working-spec', 'running', 19), record('error', 'broken-spec', 'failed', 1), record('question', 'question-spec', 'awaiting-input', 2), record('stalled', 'stalled-spec', 'running', 3), record('old-plan', 'question-spec', 'completed', 0), record('cancelled', 'abandoned', 'cancelled', 21), { ...record('hidden', 'hidden-spec', 'failed'), hiddenAt: 'hidden' }, record('archived-old', 'archived', 'completed', 6), record('archived-new', '2026-11-14-archived', 'completed', 7), record('project-one', '', 'queued'), record('project-two', '', 'queued')];
  for (let i = 0; i < 8; i++) jobs.push(record(`done-${i}`, `done-spec-${i}`, 'completed', 8 + i));
  const result = requestPage(jobs, {}, { agent: { queue: { active: { id: 'stalled', ownerConnected: false } } } });
  assert.equal(result.total, 7);
  assert.equal(result.attention, 3, 'normal queued/running work does not inflate the attention badge');
  assert.equal(result.items[0].id, 'question');
  assert.ok(result.items.slice(0, 3).every(item => item.needsAttention));
  assert.equal(result.items.find(item => item.id === 'stalled').stalled, true);
  assert.equal(result.items.find(item => item.id === 'question').groupCount, 2);
  assert.equal(result.items.filter(item => item.change === 'question-spec').length, 1);
  assert.equal(result.recent.length, 5);
  assert.equal(result.recent[0].id, 'done-7');
  assert.ok(!result.recent.some(item => item.change === 'question-spec'));
  assert.ok(!result.items.some(item => ['cancelled', 'hidden'].includes(item.id)));
  assert.equal(requestPage(jobs, { status: 'all' }).total, jobs.length - 1);
  const older = requestPage(jobs.filter(item => item.id.startsWith('archived')));
  assert.equal(older.recent.length, 1); assert.equal(older.recent[0].groupCount, 2);
  const many = Array.from({ length: 45 }, (_, i) => record(`request-${i}`, `spec-${i}`, 'queued', i));
  assert.equal(requestPage(many, { page: 3 }).items.length, 5);
});

test('retrying a failed action replaces its attention item with the new attempt', () => {
  const failed = record('failed', 'feature', 'failed');
  const retry = { ...record('retry', 'feature', 'queued', 1), requestKey: 'retry-failed' };
  const result = requestPage([failed, retry]);
  assert.equal(result.items[0].id, 'retry'); assert.equal(result.attention, 0);
});

test('dismissal persists independently, protects active/newer work and preserves jobs and preview data', async t => {
  const root = await fixture(t);
  const failed = record('failed', 'feature', 'failed', 1), completed = record('done', 'feature', 'completed', 2);
  await writeJob(root, failed); await writeJob(root, completed);
  for (const folder of ['previews', 'reviews']) {
    await fs.mkdir(path.join(root, '.spequi', folder, 'done'), { recursive: true });
    await fs.writeFile(path.join(root, '.spequi', folder, 'done', 'evidence.json'), 'Retained evidence');
  }
  const before = await listJobs(root), shown = requestPage(before).items[0];
  await writeJob(root, record('newer', 'feature', 'completed', 3));
  await dismissRequest(root, shown.id, { through: shown.dismissThrough });
  let dismissed = await inboxState(root), inbox = requestPage(await listJobs(root), {}, { dismissed });
  assert.equal(inbox.items.length, 0); assert.equal(inbox.recent[0].id, 'newer', 'a result arriving after rendering cannot be dismissed by an older click');
  assert.deepEqual((await listJobs(root)).filter(item => item.id !== 'newer'), before);
  for (const folder of ['previews', 'reviews']) assert.equal(await fs.readFile(path.join(root, '.spequi', folder, 'done', 'evidence.json'), 'utf8'), 'Retained evidence');
  assert.equal(requestPage(await listJobs(root), { status: 'all' }).total, 3);
  await writeJob(root, record('active', 'feature', 'queued', 0));
  assert.equal(requestPage(await listJobs(root), {}, { dismissed }).items[0].id, 'active', 'active work remains visible regardless of a dismissal cutoff');
  await assert.rejects(dismissRequest(root, 'active'), /settled/);
  await assert.rejects(dismissRequest(root, 'done', { through: '2099-01-01T00:00:00.000Z' }), /inbox changed/);
  await Promise.all([dismissRequest(root, 'newer'), dismissRequest(root, 'failed')]);
  dismissed = await inboxState(root); assert.equal(dismissed['change:feature'], record('newer', 'feature', 'completed', 3).updatedAt);
});

test('HTTP inbox defaults, history, badge and protected dismissal share the same projection without exposing ownership', async t => {
  const root = await fixture(t);
  await writeJob(root, { ...record('failed', 'feature', 'failed', 1), claimToken: 'private-ownership', instructions: 'private-instructions' });
  await writeJob(root, { ...record('done', 'other', 'completed', 2), claimToken: 'private-recent-token', workflow: { directory: 'private-path' } });
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const get = async route => (await fetch(viewer.origin + route)).json();
  const inbox = await get('/api/requests');
  assert.equal(inbox.total, 1); assert.equal(inbox.recent.length, 1);
  assert.doesNotMatch(JSON.stringify(inbox), /private-/);
  assert.equal((await get('/api/activity')).attention, 1);
  const html = await (await fetch(viewer.origin + '/?view=studio&new=1')).text();
  assert.match(html, /value="inbox" selected/);
  const csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
  const post = token => fetch(viewer.origin + '/api/jobs/failed/dismiss', { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ through: inbox.items[0].dismissThrough }) });
  assert.equal((await post('wrong')).status, 403);
  assert.equal((await post(csrf)).status, 200);
  assert.equal((await get('/api/activity')).attention, 0);
  assert.equal((await get('/api/requests')).total, 0);
  assert.equal((await get('/api/requests?status=all')).total, 2);
  assert.equal((await listJobs(root)).length, 2);
});


test('the active queue blocker stays visible over earlier failures immediately', () => {
  const failed = record('failed', 'feature', 'failed');
  const running = { ...record('running', 'feature', 'running'), updatedAt: new Date().toISOString() };
  const agent = { queue: { active: { id: running.id, ownerConnected: false } } };
  const inbox = requestPage([running, failed], {}, { agent });
  assert.equal(inbox.items[0].id, running.id);
  assert.equal(inbox.items[0].stalled, true);
  agent.queue.active.ownerConnected = true;
  assert.equal(requestPage([running], {}, { agent }).attention, 0, 'a healthy running request needs no attention marker');
});
