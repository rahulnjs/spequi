import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { parseHTML } from 'linkedom';
import { initProject } from '../src/project.mjs';
import { inventory, markdown, readArtifact, requirementDiffs, taskProgress } from '../src/specs.mjs';
import { enqueue, claimNext, updateJob, agentStatus } from '../src/jobs.mjs';
import { previewResult, previewContents, applyPreview, createPreview } from '../src/previews.mjs';
import { runtime, exists } from '../src/files.mjs';
import { startServer } from '../src/server.mjs';
import { buildDiffRows } from '../src/diffs.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/changes/add-feature/proposal.md', '# Add a feature\n\n## Why\n\nA real fixture.\n');
  await put(root, 'openspec/changes/add-feature/tasks.md', '# Tasks\n- [x] Done\n- [ ] Pending\n');
  await put(root, 'openspec/changes/add-feature/specs/api/auth/spec.md', '# Spec Delta\n\n## ADDED Requirements\n\n### Requirement: Login\nThe app SHALL log in.\n\n#### Scenario: Valid input\n- **WHEN** user logs in\n- **THEN** session starts\n');
  return root;
}
async function put(root, file, text) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
async function preview(t) {
  const root = await fixture(t);
  await put(root, 'app.mjs', 'export const enabled = false;\n');
  await put(root, 'old.mjs', 'obsolete\n');
  await put(root, '.env.local', 'SECRET=private');
  const request = await enqueue(root, { action: 'preview', change: 'add-feature' });
  const job = await claimNext(root, 'Test agent');
  assert.equal(job.id, request.id);
  await put(job.workingDirectory, 'app.mjs', 'export const enabled = true;\n');
  await put(job.workingDirectory, 'new.mjs', 'new behavior\n');
  await fs.unlink(path.join(job.workingDirectory, 'old.mjs'));
  await updateJob(root, job.id, job.claimToken, 'finish', 'Implemented and checked');
  return { root, job };
}
test('init preserves configuration and scaffolds runnable server and both skill forms', async t => {
  const root = await fixture(t);
  await put(root, '.spequi/config.json', '{"version":1,"port":4999}');
  await initProject(root);
  assert.equal(JSON.parse(await fs.readFile(runtime(root, 'config.json'))).port, 4999);
  assert.ok(await exists(runtime(root, 'server.mjs')));
  assert.ok(await exists(path.join(root, '.agents/skills/spequi/SKILL.md')));
  assert.ok(await exists(path.join(root, '.claude/commands/spequi.md')));
  assert.equal((await fs.readFile(path.join(root, '.gitignore'), 'utf8')).match(/\.spequi\//g).length, 1);
});
test('inventory handles nested capabilities, archived changes, task markers, and empty roots', async t => {
  const root = await fixture(t);
  await put(root, 'openspec/specs/api/auth/spec.md', '# Authentication\nCurrent behavior\n');
  await put(root, 'openspec/changes/archive/2026-11-09-finished/proposal.md', '# Finished\n');
  const data = await inventory(root);
  assert.equal(data.changes.length, 2);
  assert.equal(data.changes[0].progress.done, 1);
  assert.equal(data.specs[0].id, 'api/auth');
  const diffs = await requirementDiffs(root, data.changes[0]);
  assert.equal(diffs[0].capability, 'api/auth');
  assert.match(diffs[0].current, /Current behavior/);
  assert.deepEqual(diffs[0].operations, [{ operation: 'ADDED', count: 1 }]);
  assert.equal(taskProgress('- [ X ] yes\n- [~] no\n- [] no').done, 1);
  await fs.rm(path.join(root, 'openspec'), { recursive: true });
  assert.equal((await inventory(root)).changes.length, 0);
});
test('untrusted Markdown cannot execute and file reads reject traversal and symlinks', async t => {
  const root = await fixture(t);
  const html = markdown('<script>alert(1)</script><img src=x onerror=alert(2)>\n[link](javascript:alert)\n<input type=text autofocus onfocus=alert(1)>');
  assert.doesNotMatch(html, /<script|onerror|javascript:|autofocus|onfocus/);
  await assert.rejects(readArtifact(root, 'openspec/../../outside.md'));
  await put(root, 'outside.md', 'private');
  await fs.symlink(path.join(root, 'outside.md'), path.join(root, 'openspec/leak.md'));
  await assert.rejects(readArtifact(root, 'openspec/leak.md'), /Symbolic/);
  assert.ok(!(await inventory(root)).files.includes('openspec/leak.md'));
});
test('request ownership is exclusive and tokens protect completion', async t => {
  const root = await fixture(t);
  assert.equal((await agentStatus(root)).connected, false);
  await enqueue(root, { action: 'explore', change: 'add-feature' });
  const jobs = await Promise.all([claimNext(root, 'One'), claimNext(root, 'Two')]);
  assert.equal(jobs.filter(Boolean).length, 1);
  const job = jobs.find(Boolean);
  assert.equal((await agentStatus(root)).connected, true);
  await assert.rejects(updateJob(root, job.id, 'wrong', 'finish', 'bad'), /token/);
  assert.equal((await updateJob(root, job.id, job.claimToken, 'finish', 'Explored')).status, 'completed');
  await assert.rejects(enqueue(root, { action: 'shell', message: 'arbitrary command' }));
  await assert.rejects(enqueue(root, { action: 'preview', change: '../bad' }));
});
test('preview isolates files, skips secrets, freezes edits, and records additions/modifications/deletions', async t => {
  const { root, job } = await preview(t);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const enabled = false;\n');
  assert.ok(!await exists(path.join(job.workingDirectory, '.env.local')));
  const result = await previewResult(root, job.id);
  assert.deepEqual(result.changes.map(change => [change.file, change.type]), [['app.mjs', 'modified'], ['new.mjs', 'added'], ['old.mjs', 'deleted']]);
  await put(job.workingDirectory, 'app.mjs', 'edited after completion');
  assert.equal((await previewContents(root, job.id, 'app.mjs')).after, 'export const enabled = true;\n');
  assert.match(result.changes[0].patch, /-export const enabled = false/);
});
test('apply rejects the whole preview when a current file changes', async t => {
  const { root, job } = await preview(t);
  await put(root, 'app.mjs', 'concurrent edit\n');
  await assert.rejects(applyPreview(root, job.id), /Conflicts: app.mjs/);
  assert.equal(await fs.readFile(path.join(root, 'old.mjs'), 'utf8'), 'obsolete\n');
  assert.ok(!await exists(path.join(root, 'new.mjs')));
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'concurrent edit\n');
});
test('apply writes reviewed files, retains backups, and prevents duplicate application', async t => {
  const { root, job } = await preview(t);
  await applyPreview(root, job.id);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const enabled = true;\n');
  assert.equal(await fs.readFile(path.join(root, 'new.mjs'), 'utf8'), 'new behavior\n');
  assert.ok(!await exists(path.join(root, 'old.mjs')));
  assert.equal(await fs.readFile(runtime(root, 'backups', job.id, 'old.mjs'), 'utf8'), 'obsolete\n');
  await assert.rejects(applyPreview(root, job.id), /already applied/);
});
test('apply rolls back earlier writes if a later replacement fails', { skip: process.platform === 'win32' && 'Windows does not enforce POSIX directory write bits; rename failures are covered by the atomic-write test' }, async t => {
  const root = await fixture(t);
  await put(root, 'a.mjs', 'original a\n');
  await put(root, 'zlocked/b.mjs', 'original b\n');
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const job = await claimNext(root, 'Rollback check');
  await put(job.workingDirectory, 'a.mjs', 'proposed a\n');
  await put(job.workingDirectory, 'zlocked/b.mjs', 'proposed b\n');
  await updateJob(root, job.id, job.claimToken, 'finish', 'Ready');
  await fs.chmod(path.join(root, 'zlocked'), 0o500);
  try {
    await assert.rejects(applyPreview(root, job.id), /EACCES/);
    assert.equal(await fs.readFile(path.join(root, 'a.mjs'), 'utf8'), 'original a\n');
    assert.equal(await fs.readFile(path.join(root, 'zlocked/b.mjs'), 'utf8'), 'original b\n');
    assert.equal((await previewResult(root, job.id)).applied, false);
  } finally { await fs.chmod(path.join(root, 'zlocked'), 0o700); }
});
test('modified proposed files and symbolic destination parents reject application', async t => {
  const { root, job } = await preview(t);
  await put(root, `.spequi/previews/${job.id}/proposed/app.mjs`, 'tampered');
  await assert.rejects(applyPreview(root, job.id), /changed after review/);
  assert.ok(await exists(path.join(root, 'old.mjs')));
});
test('apply rejects a new destination under a symlink without changing any source', async t => {
  const { root, job } = await preview(t);
  await fs.symlink(os.tmpdir(), path.join(root, 'new.mjs'), 'dir');
  await assert.rejects(applyPreview(root, job.id), /Symbolic/);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const enabled = false;\n');
  assert.ok(await exists(path.join(root, 'old.mjs')));
});
test('snapshot rejects symlinks and binary proposals cannot be applied', async t => {
  const root = await fixture(t);
  await fs.symlink(os.tmpdir(), path.join(root, 'external'), 'dir');
  const work = await createPreview(root, 'snapshot-test');
  assert.ok(!await exists(path.join(work, 'external')));
  const request = await enqueue(root, { action: 'preview', change: 'add-feature' });
  const job = await claimNext(root, 'Test');
  await put(job.workingDirectory, 'image.bin', Buffer.from([0, 1, 2]));
  await updateJob(root, request.id, job.claimToken, 'finish', 'Binary change');
  assert.deepEqual((await previewResult(root, job.id)).unsupported, ['image.bin']);
  await assert.rejects(applyPreview(root, job.id), /unsupported binary/);
});
test('HTTP serves real data and HTMX fragments, protects mutations, and broadcasts queue updates', async t => {
  const root = await fixture(t), viewer = await startServer({ root, port: 0, quiet: true });
  t.after(() => viewer.close());
  const response = await fetch(viewer.origin);
  assert.equal(response.status, 200);
  const html = await response.text(), csrf = html.match(/name="csrf-token" content="([^"]+)"/)[1];
  assert.match(html, /Add a feature/);
  assert.match(html, /class="document-tab active"[^>]*>[\s\S]*?<span>proposal<\/span>/);
  assert.doesNotMatch(html, /No implementation diff yet/);
  assert.match(html, /id="theme-toggle"[^>]*aria-label="Switch to dark mode"[^>]*title="Switch to dark mode"/);
  assert.match(html, /hx-get=/);
  assert.match(html, /aria-label="Close project navigation"/);
  assert.equal((await fetch(`${viewer.origin}/vendor/htmx.js`)).status, 200);
  const fragment = await (await fetch(viewer.origin, { headers: { 'HX-Request': 'true' } })).text();
  assert.match(fragment, /^<div id="workspace"/);
  assert.doesNotMatch(fragment, /<!doctype/);
  for (const view of ['source', 'specs', 'preview']) {
    const page = await (await fetch(`${viewer.origin}/?change=add-feature&view=${view}`)).text();
    assert.match(page, /<main class="main" id="document" tabindex="-1">/);
  }
  for (const headers of [{}, { Origin: 'https://evil.example', 'X-CSRF-Token': csrf }]) assert.equal((await fetch(`${viewer.origin}/api/jobs`, { method: 'POST', headers, body: 'action=explore' })).status, 403);
  const ws = new WebSocket(viewer.origin.replace('http', 'ws') + '/live', { origin: viewer.origin });
  await once(ws, 'open');
  const event = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Missing WebSocket update')), 5000); ws.on('message', data => { if (JSON.parse(data).type === 'requests') { clearTimeout(timer); resolve(); } }); });
  const created = await fetch(`${viewer.origin}/api/jobs`, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'action=explore&change=add-feature' });
  assert.equal(created.status, 201);
  await event;
  const state = await (await fetch(`${viewer.origin}/api/state`)).json();
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].claimToken, undefined);
  ws.close(); await once(ws, 'close');
});
test('completed previews expose both diff modes, patch downloads, and protected application', async t => {
  const { root, job } = await preview(t);
  const viewer = await startServer({ root, port: 0, quiet: true });
  t.after(() => viewer.close());
  const base = `${viewer.origin}/?change=add-feature&view=preview&job=${job.id}`;
  const unified = parseHTML(await (await fetch(base)).text()).document;
  assert.ok(unified.querySelector('.unified-diff-table'));
  assert.equal(unified.querySelector('[aria-label="Diff layout"] .active').textContent, 'Unified');
  const split = await (await fetch(base + '&mode=split')).text();
  assert.match(split, /split-diff/);
  const defaultView = await (await fetch(viewer.origin + '/?change=add-feature')).text();
  assert.equal(parseHTML(defaultView).document.querySelector('.document-tab.active span').textContent, 'proposal');
  assert.doesNotMatch(defaultView, /Current and proposed file comparison/);
  assert.match(split.replace(/<[^>]+>/g, ''), /export const enabled = true/);
  assert.equal(parseHTML(split).document.querySelector('.guided-file-actions [data-apply-form] button').textContent.trim(), 'Apply changes');
  assert.match(await (await fetch(base + '&mode=unified')).text(), /code-diff unified/);
  const patch = await (await fetch(`${viewer.origin}/api/previews/${job.id}/patch`)).text();
  assert.match(patch, /--- a\/app.mjs/);
  const csrf = split.match(/name="csrf-token" content="([^"]+)"/)[1];
  const applied = await fetch(`${viewer.origin}/api/previews/${job.id}/apply`, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': csrf }, body: '' });
  assert.equal(applied.status, 200);
  assert.match(await applied.text(), /Code changes applied/);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const enabled = true;\n');
});

test('split comparisons keep unchanged lines aligned after uneven edits', () => {
  const result = buildDiffRows('start\nold\nend\n', 'start\nnew one\nnew two\nend\n');
  assert.equal(result.split.length, 4);
  assert.deepEqual(result.split[2], { before: null, after: { line: 'new two', number: 3, type: 'addition' } });
  assert.equal(result.split[3].before.line, 'end');
  assert.equal(result.split[3].after.line, 'end');
  assert.equal(result.split[3].before.number, 3);
  assert.equal(result.split[3].after.number, 4);
  const deletion = buildDiffRows('start\none\ntwo\nend\n', 'start\nend\n');
  assert.equal(deletion.split[1].after, null);
  assert.equal(deletion.split[2].after, null);
  assert.equal(deletion.split[3].before.line, deletion.split[3].after.line);
  assert.deepEqual(buildDiffRows('', ''), { unified: [], split: [] });
});

test('file diff generation displays progress and routes questions directly to implementation', async t => {
  const root = await fixture(t), viewer = await startServer({ root, port: 0, quiet: true });
  t.after(() => viewer.close());
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const queued = await (await fetch(viewer.origin + '/?view=preview')).text();
  assert.match(queued, /File diff queued/);
  assert.doesNotMatch(queued, /id="generate-file-diff"/);
  const progress = parseHTML(queued).document.querySelector('.diff-empty-actions a');
  assert.equal(new URL(progress.getAttribute('href'), viewer.origin).searchParams.get('view'), 'workflow');
  const job = await claimNext(root, 'Fixture agent');
  const running = await (await fetch(viewer.origin + '/?view=preview')).text();
  assert.match(running, /Your agent is generating the file diff/);
  const { askJob } = await import('../src/job-dialogue.mjs');
  await askJob(root, job.id, job.claimToken, { message: 'Which behavior should change?' });
  const waiting = parseHTML(await (await fetch(viewer.origin + '/?view=preview')).text()).document;
  const reply = waiting.querySelector('.diff-empty-actions a');
  assert.equal(reply.textContent, 'Reply to agent');
  assert.equal(new URL(reply.getAttribute('href'), viewer.origin).searchParams.get('pane'), 'conversation');
  assert.equal(waiting.querySelector('#generate-file-diff'), null);
  await updateJob(root, job.id, job.claimToken, 'fail', 'A useful failure');
  const failed = await (await fetch(viewer.origin + '/?view=preview')).text();
  assert.match(failed, /A useful failure/);
  assert.match(failed, /Generate file diff/);
});

test('Files empty state offers generation and offline tools within Review', async t => {
  const root = await fixture(t), viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const document = parseHTML(await (await fetch(viewer.origin + '/?change=add-feature&view=preview')).text()).document;
  const state = document.querySelector('.diff-empty-state');
  assert.doesNotMatch(state.textContent, /Codex|Claude|\$spequi|\/spequi/);
  assert.match(state.querySelector('.diff-agent-note').textContent, /requests will wait in the queue/);
  assert.equal(state.querySelector('.diff-empty-actions form [name=change]').value, 'add-feature');
  assert.equal(state.querySelector('.diff-empty-actions form [name=action]').value, 'preview');
  assert.equal(state.querySelector('.diff-empty-actions a'), null);
  assert.ok(state.querySelector('#source-preview-tools'));
});

test('review selects retained preview versions and changed files without mixing snapshots', async t => {
  const { root, job: first } = await preview(t);
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const second = await claimNext(root, 'Second preview');
  await put(second.workingDirectory, 'app.mjs', 'export const enabled = "new version";\n');
  await updateJob(root, second.id, second.claimToken, 'finish', 'Second implementation');
  const viewer = await startServer({ root, port: 0, quiet: true });
  t.after(() => viewer.close());
  const latest = await (await fetch(viewer.origin + '/?view=preview')).text();
  assert.match(latest, /&quot;new version&quot;/);
  assert.equal(new URL(parseHTML(latest).document.getElementById('workspace').dataset.refreshUrl, viewer.origin).searchParams.get('job'), second.id);
  const previous = await (await fetch(`${viewer.origin}/?change=add-feature&view=preview&job=${first.id}`)).text();
  assert.match(previous.replace(/<[^>]+>/g, ''), /export const enabled = true/);
  assert.doesNotMatch(previous, /&quot;new version&quot;/);
  const deleted = await (await fetch(`${viewer.origin}/?change=add-feature&view=preview&job=${first.id}&file=old.mjs&mode=unified`)).text();
  assert.match(deleted, /code-diff unified/);
  assert.match(deleted, /obsolete/);
});

test('switching changes opens Proposal and completed changes offer review without implying pending implementation', async t => {
  const { root, job } = await preview(t);
  const prefix = 'openspec/changes/all-done';
  await put(root, `${prefix}/proposal.md`, '# Completed proposal\n');
  await put(root, `${prefix}/tasks.md`, '# Tasks\n- [x] First\n- [x] Second\n');
  await put(root, 'openspec/changes/planning/proposal.md', '# Planning proposal\n');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const get = async url => parseHTML(await (await fetch(viewer.origin + url)).text()).document;
  const reviewing = await get(`/?change=add-feature&view=preview&job=${job.id}&file=app.mjs&mode=unified&wrap=0`);
  const navigation = [...reviewing.querySelectorAll('.change-link')].find(link => new URL(link.getAttribute('href'), viewer.origin).searchParams.get('change') === 'all-done');
  assert.match(navigation.textContent, /2\/2 tasks · complete/);
  assert.ok(navigation.classList.contains('tasks-complete'));
  const destination = new URL(navigation.getAttribute('href'), viewer.origin);
  assert.equal(destination.searchParams.get('doc'), `${prefix}/proposal.md`);
  assert.equal(destination.searchParams.get('view'), 'rendered');
  for (const name of ['job','file','mode','wrap','context']) assert.equal(destination.searchParams.has(name), false);
  const proposal = await get(destination.pathname + destination.search);
  assert.equal(proposal.querySelector('.document-tab.active span').textContent, 'proposal');
  assert.equal(proposal.querySelector('.prose h1').textContent, 'Completed proposal');
  assert.match(proposal.querySelector('#review-details').textContent, /Tasks complete/);
  assert.equal((await get('/?change=all-done')).querySelector('.document-tab.active span').textContent, 'proposal');
  const files = await get('/?change=all-done&view=preview');
  assert.equal(files.querySelector('.completed-change-state h2').textContent, 'All tasks are complete');
  assert.match(files.querySelector('.completed-change-state').textContent, /2 of 2 tasks are checked off/);
  assert.equal(files.querySelector('.completed-change-actions .primary').textContent, 'Review proposal');
  assert.match(files.querySelector('.completed-change-actions a:last-child').getAttribute('href'), /tasks.md/);
  assert.ok(files.querySelector('#completed-diff-option #generate-file-diff'));
  assert.equal(files.querySelector('#completed-diff-option').hasAttribute('open'), false);
  assert.doesNotMatch(files.querySelector('.changed-files-nav').textContent, /Generate a file diff/);
  const planning = await get('/?change=planning&view=preview');
  assert.equal(planning.querySelector('.completed-change-state'), null);
  assert.match(planning.querySelector('#review-details').textContent, /Planning/);
  assert.ok(planning.getElementById('generate-file-diff'));
  await put(root, `${prefix}/tasks.md`, '# Tasks\n- [x] First\n- [ ] Reopened\n');
  const reopened = await get('/?change=all-done&view=preview');
  assert.equal(reopened.querySelector('.completed-change-state'), null);
  assert.match(reopened.querySelector('#review-details').textContent, /In progress/);
  assert.ok(reopened.getElementById('generate-file-diff'));
});

test('completed task state retains saved diffs and empty previews while exposing pending generation', async t => {
  const { root, job } = await preview(t);
  await put(root, 'openspec/changes/add-feature/tasks.md', '# Tasks\n- [x] Done\n');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const get = async () => parseHTML(await (await fetch(viewer.origin + '/?change=add-feature&view=preview')).text()).document;
  const saved = await get();
  assert.match(saved.querySelector('#review-details').textContent, /Tasks complete/);
  assert.ok(saved.querySelector('.file-diff'));
  assert.equal(new URL(saved.getElementById('workspace').dataset.refreshUrl, viewer.origin).searchParams.get('job'), job.id);
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const empty = await claimNext(root, 'Completed change review');
  await updateJob(root, empty.id, empty.claimToken, 'finish', 'No pending work; no new edits.');
  const unchanged = await get();
  assert.match(unchanged.querySelector('.completed-change-state').textContent, /This preview contains no file changes/);
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const pending = await get();
  assert.match(pending.querySelector('.diff-pending-note').textContent, /new diff is being generated/);
  assert.equal(pending.getElementById('generate-file-diff').disabled, true);
});

test('implementation diffs exclude planning and instruction files while applying checkbox updates with conflict checks', async t => {
  const root = await fixture(t), tasks = 'openspec/changes/add-feature/tasks.md';
  const proposal = await fs.readFile(path.join(root, 'openspec/changes/add-feature/proposal.md'), 'utf8');
  await put(root, 'app.mjs', 'before\n');
  await enqueue(root, { action: 'preview', change: 'add-feature' });
  const job = await claimNext(root, 'Session');
  await put(job.workingDirectory, 'app.mjs', 'after\n');
  await put(job.workingDirectory, tasks, '# Tasks\n- [x] Done\n- [x] Pending\n');
  await put(job.workingDirectory, 'openspec/changes/add-feature/proposal.md', '# Unrequested revision\n');
  await put(job.workingDirectory, 'openspec/changes/other/tasks.md', '- [x] Unrelated\n');
  await put(job.workingDirectory, 'apply-instr.json', '{"state":"ready"}');
  await updateJob(root, job.id, job.claimToken, 'finish', 'Ready');
  const result = await previewResult(root, job.id);
  assert.deepEqual(result.changes.map(item => item.file), ['app.mjs']);
  assert.deepEqual(result.taskUpdates.map(item => item.file), [tasks]);
  // Previously saved previews put these files in the source change list.
  const legacy = { ...result, changes: [...result.changes, ...result.taskUpdates, { file: 'apply-instr.json' }] };
  delete legacy.taskUpdates;
  await put(root, `.spequi/previews/${job.id}/result.json`, JSON.stringify(legacy));
  const retained = await previewResult(root, job.id);
  assert.deepEqual(retained.changes.map(item => item.file), ['app.mjs']);
  assert.deepEqual(retained.taskUpdates.map(item => item.file), [tasks]);
  await put(root, tasks, '# Tasks\n- [x] Done\n- [ ] Reworded task\n');
  await assert.rejects(applyPreview(root, job.id), /Conflicts/);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'before\n');
  await put(root, tasks, '# Tasks\n- [x] Done\n- [ ] Pending\n');
  await applyPreview(root, job.id);
  assert.equal(await fs.readFile(path.join(root, tasks), 'utf8'), '# Tasks\n- [x] Done\n- [x] Pending\n');
  assert.equal(await fs.readFile(path.join(root, 'openspec/changes/add-feature/proposal.md'), 'utf8'), proposal);
  assert.equal(await exists(path.join(root, 'apply-instr.json')), false);
});
