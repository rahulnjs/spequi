import { readyDocument } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseHTML } from 'linkedom';
import { initProject } from '../src/project.mjs';
import { inventory } from '../src/specs.mjs';
import { enqueue, claimNext, updateJob, getJob } from '../src/jobs.mjs';
import { askJob, answerJob, jobInput } from '../src/job-dialogue.mjs';
import { lifecycleActions, lifecycleState, requestLifecycle } from '../src/lifecycle.mjs';
import { localReadiness, openspecJSON } from '../src/openspec-cli.mjs';
import { startServer } from '../src/server.mjs';

const exec = promisify(execFile);
async function put(root, file, text) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-lifecycle-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/config.yaml', 'schema: spec-driven\n');
  await put(root, 'openspec/changes/flow/.openspec.yaml', 'schema: spec-driven\ncreated: 2026-11-10\n');
  return root;
}
const ready = (root, complete = false) => ({ schema: 'custom', artifacts: [{ id: 'brief', status: complete ? 'done' : 'ready' }], artifactPaths: {}, planningComplete: complete, nextArtifact: complete ? null : 'brief', tasks: { total: 2, done: 0 }, applyState: complete ? 'ready' : 'blocked' });

test('owned questions persist, reject stale replies and unanswered completion, then resume the same job', async t => {
  const root = await fixture(t);
  await enqueue(root, { action: 'explore', change: 'flow', message: 'Investigate' });
  const job = await claimNext(root, 'Session');
  await assert.rejects(askJob(root, job.id, 'wrong', { message: 'Approve?' }), /token/);
  const first = await askJob(root, job.id, job.claimToken, { message: '<script>Approve?</script>', options: ['Yes', 'No'] });
  assert.equal((await jobInput(root, job.id, job.claimToken)).status, 'awaiting-input');
  await assert.rejects(updateJob(root, job.id, job.claimToken, 'finish', 'no'), /not running/);
  await assert.rejects(answerJob(root, job.id, { questionId: 'old', answer: 'Yes' }), /no longer/);
  const resumed = await answerJob(root, job.id, { questionId: first.question.id, answer: 'Yes, with checks' });
  assert.equal(resumed.status, 'running');
  assert.equal((await getJob(root, job.id)).claimToken, job.claimToken);
  await assert.rejects(answerJob(root, job.id, { questionId: first.question.id, answer: 'overwrite' }), /no longer/);
  await askJob(root, job.id, job.claimToken, { message: 'Another question' });
  await updateJob(root, job.id, null, 'cancel', 'Stop');
  assert.equal((await jobInput(root, job.id, job.claimToken)).status, 'cancelled');
  assert.equal((await getJob(root, job.id)).questions[0].answer, 'Yes, with checks');
});

test('CLI transports questions and owned answers without a second claim or session', async t => {
  const root = await fixture(t);
  await enqueue(root, { action: 'plan-next', change: 'flow' });
  const job = await claimNext(root, 'Session');
  const cli = path.resolve('bin/spequi.mjs');
  const run = (...args) => exec(process.execPath, [cli, 'agent', ...args, '--root', root]);
  const asked = JSON.parse((await run('ask', job.id, '--token', job.claimToken, '--message', 'Which approach?', '--options', '["A","B"]')).stdout);
  await answerJob(root, job.id, { questionId: asked.question.id, answer: 'B' });
  const response = JSON.parse((await run('input', job.id, '--token', job.claimToken, '--wait', '0')).stdout);
  assert.equal(response.question.answer, 'B'); assert.equal(response.status, 'running');
  assert.match(job.instructions, /first schema-ready|Create only this artifact/i);
  assert.match(job.instructions, /agent ask/); assert.equal(job.workflow.mode, 'same-session');
  await askJob(root, job.id, job.claimToken, { message: 'Wait' });
  assert.equal((await updateJob(root, job.id, job.claimToken, 'fail', 'Cannot continue')).status, 'failed');
});

test('schema readiness gates actions and current-state rechecks serialize requests', async t => {
  const root = await fixture(t);
  assert.equal((await inventory(root)).changes[0].id, 'flow');
  let complete = false;
  const getReadiness = async () => ready(root, complete);
  const state = await lifecycleState(root, 'flow', { getReadiness });
  assert.equal(state.actions['plan-next'].enabled, true);
  assert.match(state.actions.preview.reason, /planning/);
  await assert.rejects(requestLifecycle(root, { action: 'preview', change: 'flow' }, { getReadiness }), /planning/);
  complete = true;
  const response = await requestLifecycle(root, { action: 'preview', change: 'flow' }, { getReadiness });
  assert.equal(response.job.status, 'queued');
  await assert.rejects(requestLifecycle(root, { action: 'verify', change: 'flow' }, { getReadiness }), /current workflow/);
  await updateJob(root, response.job.id, null, 'cancel');
  const missing = await lifecycleState(root, 'flow', { getReadiness: async () => { throw new Error('CLI unavailable'); } });
  assert.match(missing.actions['plan-next'].reason, /CLI unavailable/);
  assert.equal(missing.actions.validate.enabled, false);
  const permissions = lifecycleActions({ selected: state.selected, readiness: { ...ready(root, true), tasks: { total: 2, done: 1 } } });
  assert.equal(permissions.archive.enabled, false); assert.equal(permissions['archive-override'].enabled, true);
});

test('local validation stores structured findings and identifies changed inputs', async t => {
  const root = await fixture(t);
  await put(root, 'openspec/changes/flow/proposal.md', '# Proposal\n');
  const options = { getReadiness: async () => ready(root), runCLI: async () => ({ items: [{ id: 'flow', type: 'change', valid: false, issues: [{ level: 'ERROR', path: 'spec.md', message: '<unsafe> Missing scenario' }] }] }) };
  const result = await requestLifecycle(root, { action: 'validate', change: 'flow' }, options);
  assert.equal(result.validation.valid, false);
  assert.equal((await lifecycleState(root, 'flow', options)).validation.stale, false);
  await put(root, 'openspec/changes/flow/proposal.md', '# Changed\n');
  assert.equal((await lifecycleState(root, 'flow', options)).validation.stale, true);
  await assert.rejects(requestLifecycle(root, { action: 'validate', change: 'flow' }, { ...options, runCLI: async () => ({ items: [] }) }), /valid validation report/);
});

test('new-change requests are scoped scaffolds and do not write planning or source', async t => {
  const root = await fixture(t);
  const options = { runCLI: async () => ({ root: { path: root } }) };
  const { job } = await requestLifecycle(root, { action: 'create-change', change: 'new-flow', message: 'A new feature' }, options);
  assert.equal((await inventory(root)).changes.length, 1);
  await assert.rejects(requestLifecycle(root, { action: 'create-change', change: 'new-flow', message: 'Again' }, options), /already pending/);
  const claimed = await claimNext(root, 'Session'); assert.equal(claimed.id, job.id);
  assert.match(claimed.instructions, /scaffold only/);
  await updateJob(root, job.id, claimed.claimToken, 'fail', 'Test stop');
  await assert.rejects(requestLifecycle(root, { action: 'create-change', change: '../bad', message: 'No' }, options), /kebab/);
  await assert.rejects(requestLifecycle(root, { action: 'create-change', change: 'another', message: 'No' }, { runCLI: async () => ({ root: null }) }), /resolve to this project/);
});

test('installed CLI returns bounded local readiness and validation without an agent', async t => {
  const root = await fixture(t);
  const result = await localReadiness(root, 'flow');
  assert.equal(result.schema, 'spec-driven'); assert.equal(result.nextArtifact, 'proposal');
  assert.equal(result.planningComplete, false); assert.equal(result.applyState, 'blocked');
  const report = await openspecJSON(root, 'validate', 'flow');
  assert.equal(report.items[0].valid, false);
  await assert.rejects(openspecJSON(root, 'archive', 'flow'), /Unsupported/);
  await assert.rejects(openspecJSON(root, 'status', '../escape'), /Invalid/);
});

test('shared workspace protects replies, escapes questions, and retains review navigation', async t => {
  const root = await fixture(t);
  for (const file of ['proposal','design','tasks']) await put(root, `openspec/changes/flow/${file}.md`, `# ${file}\n`);
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const get = async () => readyDocument(viewer.origin + '/?change=flow&view=studio');
  let document = await get();
  assert.equal(document.querySelectorAll('[data-studio-stage]').length, 3);
  const review = await readyDocument(viewer.origin + '/?change=flow&view=rendered');
  const build = [...review.querySelectorAll('.document-tab')].find(tab => tab.textContent === 'Build');
  assert.equal(new URL(build.getAttribute('href'), viewer.origin).searchParams.get('view'), 'studio');
  assert.equal(document.querySelector('#workspace').classList.contains('review-details-open'), false);
  assert.equal(document.querySelector('#review-details'), null);
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const post = (url, payload, token = csrf) => fetch(viewer.origin + url, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await post('/api/lifecycle/actions', { action: 'preview', change: 'flow' })).status, 400);
  const validation = await post('/api/lifecycle/actions', { action: 'validate', change: 'flow' }); assert.equal(validation.status, 200);
  assert.equal((await validation.json()).validation.valid, false);
  await enqueue(root, { action: 'explore', change: 'flow', message: 'Question test' });
  const job = await claimNext(root, 'Same session');
  const { question } = await askJob(root, job.id, job.claimToken, { message: '<script>Question</script>', options: ['One', 'Two'] });
  document = await get();
  assert.equal(document.querySelector('.studio-question-text').textContent, '<script>Question</script>');
  assert.equal(document.querySelector('.studio-question script'), null);
  assert.equal(document.querySelectorAll('.studio-choice').length, 2);
  const endpoint = `/api/lifecycle/jobs/${job.id}/reply`;
  assert.equal((await post(endpoint, { questionId: question.id, answer: 'One' }, '')).status, 403);
  assert.equal((await post(endpoint, { questionId: question.id, answer: 'One' })).status, 200);
  assert.equal((await post(endpoint, { questionId: question.id, answer: 'Two' })).status, 400);
  assert.equal((await getJob(root, job.id)).questions[0].answer, 'One');
  const state = JSON.stringify(await (await fetch(viewer.origin + '/api/state')).json());
  assert.equal(state.includes(job.claimToken), false);
  assert.equal((await fetch(viewer.origin + '/assets/workflow.js')).status, 200);
  for (const asset of ['lifecycle.css', 'lifecycle.js']) assert.equal((await fetch(viewer.origin + '/assets/' + asset)).status, 404);
});

test('workflow forms submit once, combine choices, retain drafts/errors and restore after swaps', async () => {
  const { document, window } = parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change="flow"><form id="reply" data-lifecycle-form action="/reply"><input type="hidden" name="questionId" value="q"><input name="choice" type="radio" value="Yes"><textarea name="answer"></textarea><button type="submit">Reply</button><div data-lifecycle-feedback></div></form></div>');
  let calls = 0, resolve;
  const form = document.querySelector('form'), answer = form.querySelector('textarea');
  vm.runInNewContext(await fs.readFile(new URL('../public/workflow.js', import.meta.url), 'utf8'), { document, window, location: { assign() {} }, fetch: (_url, args) => { calls++; assert.equal(JSON.parse(args.body).answer, 'Yes\n\nWith checks'); return new Promise(done => { resolve = () => done({ ok: false, status: 400, json: async () => ({ error: 'Stale question' }) }); }); } });
  answer.value = 'With checks'; form.querySelector('[type=radio]').checked = true;
  answer.dispatchEvent(new window.Event('input', { bubbles: true }));
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls, 1); resolve(); await new Promise(done => setTimeout(done, 0));
  assert.match(form.querySelector('[data-lifecycle-feedback]').textContent, /Stale/);
  const replacement = form.cloneNode(true); replacement.querySelector('textarea').value = ''; form.replaceWith(replacement);
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(replacement.querySelector('textarea').value, 'With checks');
  assert.equal(replacement.querySelector('[type=radio]').checked, true);
  assert.match(replacement.querySelector('[data-lifecycle-feedback]').textContent, /Stale/);
  assert.equal(replacement.querySelector('button').disabled, false);
});

test('archiving retains the change conversation and saved review while preventing apply', async t => {
  const root = await fixture(t);
  await enqueue(root, { action: 'preview', change: 'flow' });
  const preview = await claimNext(root, 'Session');
  await put(preview.workingDirectory, 'app.mjs', 'export const enabled = true;\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Preview ready');
  await enqueue(root, { action: 'archive', change: 'flow' });
  const archive = await claimNext(root, 'Session');
  await fs.mkdir(path.join(root, 'openspec/changes/archive'), { recursive: true });
  await fs.rename(path.join(root, 'openspec/changes/flow'), path.join(root, 'openspec/changes/archive/2026-11-10-flow'));
  await updateJob(root, archive.id, archive.claimToken, 'finish', 'Archived flow');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const html = await (await fetch(viewer.origin + '/?change=flow&view=studio&stage=implement')).text();
  const document = parseHTML(html).document;
  assert.equal(document.querySelector('#workspace').dataset.change, '2026-11-10-flow');
  assert.match(document.querySelector('#studio-thread').textContent, /Archived flow/);
  assert.equal(document.querySelector('[data-apply-form] button').disabled, true);
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const response = await fetch(viewer.origin + `/api/previews/${preview.id}/apply`, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': csrf, Accept: 'application/json' } });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /Only active/);
  const files = parseHTML(await (await fetch(viewer.origin + `/?change=2026-11-10-flow&view=preview&job=${preview.id}`)).text()).document;
  assert.ok(files.querySelector('.diff-file-identity'));
});

test('guided flow keeps update and review together and applies from the diff', async t => {
  const root = await fixture(t);
  for (const file of ['proposal','design']) await put(root, `openspec/changes/flow/${file}.md`, `# ${file}\n`);
  await put(root, 'openspec/changes/flow/tasks.md', '- [ ] Update the app\n');
  await put(root, 'openspec/changes/flow/specs/app/spec.md', '## ADDED Requirements\n\n### Requirement: App\nThe app SHALL show a message.\n\n#### Scenario: Open\n- **WHEN** the app opens\n- **THEN** a message appears\n');
  await put(root, 'app.mjs', 'export const message = "old";\n');
  await enqueue(root, { action: 'revise-plan', change: 'flow', message: 'Show the welcome message' });
  const revision = await claimNext(root, 'Current agent');
  await put(root, 'openspec/changes/flow/specs/app/spec.md', '## ADDED Requirements\n\n### Requirement: App\nThe app SHALL show a welcome message.\n\n#### Scenario: Open\n- **WHEN** the app opens\n- **THEN** a welcome message appears\n');
  await updateJob(root, revision.id, revision.claimToken, 'finish', 'Updated the welcome requirement.');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const get = async view => readyDocument(viewer.origin + '/?change=flow&view=' + view);
  let document = await get('studio');
  assert.equal(document.querySelector('.studio-footer .primary').textContent.trim(), 'Preview implementation');
  assert.equal(document.querySelector('#studio-planning-tools').hasAttribute('open'), false);
  assert.match(document.querySelector('.studio-document').textContent, /welcome message/);
  assert.ok(document.querySelector('#studio-composer'));
  assert.ok(document.querySelector('#studio-planning-tools #studio-action-plan-next'));
  await enqueue(root, { action: 'preview', change: 'flow' });
  const preview = await claimNext(root, 'Current agent');
  await put(preview.workingDirectory, 'app.mjs', 'export const message = "welcome";\n');
  await put(preview.workingDirectory, 'openspec/changes/flow/tasks.md', '- [x] Update the app\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Preview ready');
  document = await get('studio');
  assert.equal(document.querySelector('.studio-footer .primary').textContent.trim(), 'Review implementation preview');
  const files = await get('preview');
  assert.equal(files.querySelector('.guided-file-actions [data-apply-form] button').disabled, false);
  assert.match(files.querySelector('.guided-file-actions').textContent, /Your project has not changed/);
  const csrf = files.querySelector('meta[name=csrf-token]').content;
  const response = await fetch(viewer.origin + `/api/previews/${preview.id}/apply`, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': csrf } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Continue in Build/);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const message = "welcome";\n');
  assert.match((await get('studio&stage=implement')).querySelector('.studio-footer').textContent, /Continue to validation/);
  assert.equal((await lifecycleState(root, 'flow')).previewStale, false, 'applied task updates match the proposed planning version');
  await put(root, 'openspec/changes/flow/proposal.md', '# Another requested change\n');
  assert.equal((await lifecycleState(root, 'flow')).previewStale, true, 'a later spec revision starts a fresh preview cycle');
});

test('spec revisions invalidate a saved preview in the UI and apply endpoint', async t => {
  const root = await fixture(t);
  await put(root, 'openspec/changes/flow/proposal.md', '# Initial intent\n');
  await put(root, 'app.mjs', 'old\n');
  await enqueue(root, { action: 'preview', change: 'flow' });
  const preview = await claimNext(root, 'Current agent');
  await put(preview.workingDirectory, 'app.mjs', 'proposed\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Preview ready');
  const options = { getReadiness: async () => ready(root, true) };
  assert.equal((await lifecycleState(root, 'flow', options)).previewStale, false);
  await put(root, 'openspec/changes/flow/proposal.md', '# Revised intent\n');
  const state = await lifecycleState(root, 'flow', options);
  assert.equal(state.previewStale, true); assert.equal(state.actions.apply.enabled, false);
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const document = parseHTML(await (await fetch(viewer.origin + '/?change=flow&view=preview')).text()).document;
  assert.equal(document.querySelector('.guided-file-actions [data-apply-form] button').disabled, true);
  assert.match(document.querySelector('.guided-file-actions .preview-blocker').textContent, /spec changed/);
  const response = await fetch(viewer.origin + `/api/previews/${preview.id}/apply`, { method: 'POST', headers: { Origin: viewer.origin, Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content } });
  assert.equal(response.status, 400); assert.match((await response.json()).error, /spec changed/);
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'old\n');
  await put(root, 'openspec/changes/flow/proposal.md', '# Initial intent\n');
  await put(root, 'openspec/changes/flow/design.md', '# New planning document\n');
  assert.equal((await lifecycleState(root, 'flow', options)).previewStale, true);
});

test('an Update spec request stays on the page and opens current activity', async () => {
  const { document, window } = parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change="flow"><form id="studio-composer" data-lifecycle-form action="/api/lifecycle/actions"><input name="action" type="hidden" value="revise-plan"><input name="change" type="hidden" value="flow"><textarea name="message">Requested update</textarea><button type="submit">Update spec</button><div data-lifecycle-feedback></div></form></div>');
  let redirected = false, refreshed = 0;
  document.addEventListener('workspace-updated', () => refreshed++);
  vm.runInNewContext(await fs.readFile(new URL('../public/workflow.js', import.meta.url), 'utf8'), { document, window, location: { assign() { redirected = true; } }, fetch: async () => ({ ok: true, json: async () => ({ job: { change: 'flow', status: 'queued' }, url: '/?change=flow&view=studio' }) }) });
  document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(done => setTimeout(done, 0));
  assert.equal(redirected, false); assert.equal(refreshed, 1);
  assert.equal(document.querySelector('textarea').value, '');
});
