import { readyDocument, planningFixture } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseHTML } from 'linkedom';
import { initProject } from '../src/project.mjs';
import { inventory } from '../src/specs.mjs';
import { enqueue, claimNext, updateJob, listJobs } from '../src/jobs.mjs';
import { capturePlan, planVersions, planChanges } from '../src/studio-plans.mjs';
import { renderPlanMarkdown } from '../src/studio-documents.mjs';
import { startServer } from '../src/server.mjs';
import vm from 'node:vm';

async function put(root, file, text) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), text); }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openspec-studio-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/config.yaml', 'schema: spec-driven\n');
  await put(root, 'openspec/changes/flow/.openspec.yaml', 'schema: spec-driven\ncreated: 2026-11-11\n');
  await put(root, 'openspec/changes/flow/proposal.md', '# Original plan\n\nThe current behavior.\n');
  return root;
}

test('planning history keeps immutable before/after evidence and excludes pending writes', async t => {
  const root = await fixture(t);
  const job = await enqueue(root, { action: 'revise-plan', change: 'flow', message: 'Change the behavior' });
  assert.equal(job.planBefore.version, 1);
  const claimed = await claimNext(root, 'Same session');
  await put(root, 'openspec/changes/flow/proposal.md', '# Intermediate plan\n');
  let selected = (await inventory(root)).changes[0];
  let versions = await planVersions(root, selected, await listJobs(root));
  assert.match(versions.current.documents['proposal.md'], /Original plan/);
  await put(root, 'openspec/changes/flow/proposal.md', '# Revised plan\n');
  const completed = await updateJob(root, claimed.id, claimed.claimToken, 'finish', 'Updated');
  assert.equal(completed.planAfter.version, 2);
  versions = await planVersions(root, selected, await listJobs(root));
  assert.match(versions.previous.documents['proposal.md'], /Original plan/);
  assert.match(versions.current.documents['proposal.md'], /Revised plan/);
  assert.deepEqual(planChanges(versions.previous.documents, versions.current.documents).map(item => item.file), ['proposal.md']);
  assert.equal((await capturePlan(root, 'flow')).version, 2, 'unchanged reads do not create versions');
});

test('history survives archive paths, exposes failed work honestly, and serializes capture', async t => {
  const root = await fixture(t);
  const refs = await Promise.all(Array.from({ length: 5 }, () => capturePlan(root, 'flow')));
  assert.ok(refs.every(ref => ref.version === 1));
  const job = await enqueue(root, { action: 'revise-plan', change: 'flow', message: 'Try a revision' });
  const claimed = await claimNext(root, 'Same session');
  await put(root, 'openspec/changes/flow/proposal.md', '# Partial work\n');
  await updateJob(root, claimed.id, claimed.claimToken, 'fail', 'Stopped before completion');
  let versions = await planVersions(root, (await inventory(root)).changes[0], await listJobs(root));
  assert.equal(versions.failed, true);assert.match(versions.current.reason, /failed/);
  assert.equal((await listJobs(root)).find(item => item.id === job.id).planAfter, undefined);
  await fs.mkdir(path.join(root, 'openspec/changes/archive'), { recursive: true });
  await fs.rename(path.join(root, 'openspec/changes/flow'), path.join(root, 'openspec/changes/archive/2026-11-11-flow'));
  versions = await planVersions(root, (await inventory(root)).changes[0], await listJobs(root));
  assert.equal(versions.current.version, 2);assert.match(versions.previous.documents['proposal.md'], /Original/);
  assert.equal(planChanges({ 'old.md': 'old' }, { 'new.md': 'new' }).length, 2);
});

test('retained plan history bounds disk snapshots without resetting version numbers', async t => {
  const root = await fixture(t);
  for (let index = 0; index < 42; index++) {
    await put(root, 'openspec/changes/flow/proposal.md', `# Revision ${index}\n`);
    await capturePlan(root, 'flow');
  }
  const versions = await planVersions(root, (await inventory(root)).changes[0]);
  assert.equal(versions.entries.length, 40);assert.equal(versions.current.version, 42);
  assert.equal(versions.previous.documents['proposal.md'], '# Revision 40\n');
  const folders = await fs.readdir(path.join(root, '.spequi/studio'));
  const files = await fs.readdir(path.join(root, '.spequi/studio', folders[0]));
  assert.equal(files.filter(file => /^[a-f0-9]{64}\.json$/.test(file)).length, 40);
});

test('Studio serves header stages, plan comparisons and local assets without a Lifecycle tab', async t => {
  const root = await fixture(t);
  await planningFixture(root, 'flow');
  await capturePlan(root, 'flow');
  await put(root, 'openspec/changes/flow/proposal.md', '# Revised plan\n\nNow do something different.\n');
  await put(root, 'openspec/changes/flow/design.md', '# New design\n');
  const viewer = await startServer({ root, port: 0, quiet: true });t.after(() => viewer.close());
  const get = async query => readyDocument(viewer.origin + '/?' + query);
  let document = await get('change=flow&view=studio&plan=proposal.md');
  assert.equal(document.querySelector('#workspace').dataset.workspaceMode, 'build');
  assert.equal(document.querySelector('.workspace-modes'), null);
  assert.ok(document.querySelector('[data-requests-toggle]'));
  assert.equal(document.querySelector('#review-details'), null);
  assert.deepEqual([...document.querySelectorAll('.compact-change-header [data-studio-stage]')].map(node => node.textContent.trim().replace(/^\d/, '')), []);
  assert.match(document.querySelector('.studio-document').textContent, /Revised plan/);
  assert.ok(document.querySelector('.studio-revision-mark'));
  assert.match(document.querySelector('.studio-change-summary').textContent, /design.md/);
  document = await get('change=flow&view=studio&plan=proposal.md&compare=1');
  assert.match(document.querySelector('.studio-comparison section:first-child').textContent, /Original plan/);
  assert.match(document.querySelector('.studio-comparison section:last-child').textContent, /Revised plan/);
  await fs.unlink(path.join(root, 'openspec/changes/flow/design.md'));
  document = await get('change=flow&view=studio&plan=design.md&compare=1');
  assert.match(document.querySelector('.studio-comparison section:first-child').textContent, /New design/);
  assert.match(document.querySelector('.studio-comparison section:last-child').textContent, /removed/);
  const review = await get('change=flow&view=rendered');
  assert.equal([...review.querySelectorAll('.document-tab')].some(node => node.textContent.includes('Lifecycle')), false);
  assert.equal(review.querySelectorAll('.workspace-modes a').length, 0);
  const legacy = await fetch(viewer.origin + '/?change=flow&view=lifecycle&stage=implement&job=retained-preview', { redirect: 'manual' });
  assert.equal(legacy.status, 302);
  const destination = new URL(legacy.headers.get('location'), viewer.origin);
  assert.equal(destination.searchParams.get('view'), 'studio');
  assert.equal(destination.searchParams.get('change'), 'flow');
  assert.equal(destination.searchParams.get('stage'), 'implement');
  assert.equal(destination.searchParams.get('job'), 'retained-preview');
  assert.equal((await get('change=flow&view=lifecycle')).querySelector('#workspace').dataset.view, 'studio');
  for (const file of ['studio.css','studio.js']) assert.equal((await fetch(viewer.origin + '/assets/' + file)).status, 200);
});

test('changed-section Markdown retains references, escapes unsafe content and leaves stable blocks alone', () => {
  const before = '# Title\n\nKeep this paragraph.\n\nOld behavior.\n';
  const after = '# Title\n\nKeep this paragraph.\n\nSee [the plan][ref].\n\n[ref]: https://example.com\n\n<script>alert(1)</script>\n';
  const document = parseHTML(renderPlanMarkdown(after, before)).document;
  assert.equal(document.querySelector('script'), null);
  assert.equal(document.querySelector('a').getAttribute('href'), 'https://example.com');
  assert.equal(document.querySelector('h1').closest('.studio-revision-mark'), null);
  assert.match(document.querySelector('.studio-revision-mark').textContent, /the plan/);
});

test('Studio mode swaps request native sidebar preservation and remember the previous mode location', async () => {
  const { document, window } = parseHTML('<nav class="workspace-modes"><a data-workspace-mode="review"></a><a data-workspace-mode="build"></a></nav><div id="workspace" data-change="flow" data-view="preview" data-workspace-mode="review" data-refresh-url="/?change=flow&view=preview&file=app.mjs"><aside id="navigation"><form class="search"><input name="view" value="preview"></form><div data-preview-navigation>Files</div></aside></div>');
  vm.runInNewContext(await fs.readFile(new URL('../public/studio.js', import.meta.url), 'utf8'), { document, window, URL, URLSearchParams, location: { href: 'http://localhost/?change=flow&view=preview&file=app.mjs' } });
  document.querySelector('#navigation').scrollTop = 177;
  document.dispatchEvent(new window.Event('htmx:beforeRequest'));
  const event = new window.Event('htmx:beforeSwap');
  event.detail = { xhr: { status: 200 }, serverResponse: '<div id="workspace" data-change="flow" data-view="studio" data-workspace-mode="build" data-refresh-url="/?change=flow&view=studio"><aside id="navigation"><div data-preview-navigation></div></aside><section id="studio" data-stage="shape" data-pane="document"><button data-studio-pane="document"></button><button data-studio-pane="conversation"></button><div id="studio-thread"></div></section></div>' };
  document.dispatchEvent(event);
  assert.equal(parseHTML(event.detail.serverResponse).document.querySelector('#navigation').getAttribute('hx-preserve'), 'true');
  document.querySelector('#workspace').outerHTML = event.detail.serverResponse;
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(document.querySelector('#navigation').scrollTop, 177);
  assert.match(document.querySelector('[data-workspace-mode=review]').getAttribute('href'), /file=app.mjs/);
  document.querySelector('[data-studio-pane=conversation]').click();
  assert.equal(document.querySelector('#studio').dataset.pane, 'conversation');
  assert.match(document.querySelector('#workspace').dataset.refreshUrl, /pane=conversation/);
});

test('Studio runs the real same-session conversation, revision, preview, apply and finish flow', async t => {
  const root = await fixture(t);
  await planningFixture(root, 'flow');
  await put(root, 'openspec/changes/flow/design.md', '# Design\n');
  await put(root, 'openspec/changes/flow/tasks.md', '- [ ] Update the app\n');
  const spec = '## ADDED Requirements\n\n### Requirement: Greeting\nThe app SHALL show a greeting.\n\n#### Scenario: Open\n- **WHEN** the app opens\n- **THEN** a greeting appears\n';
  await put(root, 'openspec/changes/flow/specs/app/spec.md', spec);
  await put(root, 'app.mjs', 'export const message = "old";\n');
  const proposal = await fs.readFile(path.join(root, 'openspec/changes/flow/proposal.md'), 'utf8');
  const viewer = await startServer({ root, port: 0, quiet: true });t.after(() => viewer.close());
  const get = async stage => readyDocument(viewer.origin + '/?change=flow&view=' + (stage === 'implement' ? 'preview' : stage === 'finish' ? 'workflow' : 'studio&plan=specs/app/spec.md'));
  let document = await get('shape');
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const post = async (url, payload = {}, token = csrf) => fetch(viewer.origin + url, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const request = async (action, message = '') => { const response = await post('/api/lifecycle/actions', { action, change: 'flow', message });assert.equal(response.status, 201, await response.clone().text());return (await response.json()).job; };
  assert.equal(document.querySelector('.studio-agent-note'), null);
  const explored = await request('explore', 'Why this requirement?');
  let owned = await claimNext(root, 'Current session');assert.equal(owned.id, explored.id);
  const { askJob, jobInput } = await import('../src/job-dialogue.mjs');
  const asked = await askJob(root, owned.id, owned.claimToken, { message: '<script>Which greeting?</script>', options: ['Welcome','Hello'] });
  document = await get('shape');
  assert.equal(document.querySelector('.studio-question-text').textContent, '<script>Which greeting?</script>');
  assert.equal(document.querySelector('.studio-question script'), null);
  assert.equal(document.querySelector('#studio-composer').hasAttribute('hidden'), true);
  assert.equal(document.querySelector('.studio-agent-note'), null);
  assert.equal(document.querySelector('[data-studio-question]').dataset.studioQuestion, asked.question.id);
  assert.equal(document.querySelector('[data-studio-question]').tabIndex, -1);
  assert.equal(document.querySelector('[data-studio-expand]').getAttribute('aria-controls'), 'studio-body');
  assert.ok(document.querySelector('[data-studio-question] [type=submit]'));
  assert.equal((await post('/api/lifecycle/actions', { action: 'preview', change: 'flow' })).status, 400);
  const reply = `/api/lifecycle/jobs/${owned.id}/reply`;
  assert.equal((await post(reply, { questionId: asked.question.id, answer: 'Welcome' }, '')).status, 403);
  assert.equal((await post(reply, { questionId: asked.question.id, answer: 'Welcome' })).status, 200);
  assert.equal((await post(reply, { questionId: asked.question.id, answer: 'Overwrite' })).status, 400);
  assert.equal((await jobInput(root, owned.id, owned.claimToken)).status, 'running');
  assert.equal((await get('shape')).querySelector('#studio-composer').hasAttribute('hidden'), true);
  await updateJob(root, owned.id, owned.claimToken, 'finish', 'The greeting is the first message users see.');
  assert.equal((await get('shape')).querySelector('#studio-composer').hasAttribute('hidden'), false);
  await request('revise-plan', 'Use a welcome message');owned = await claimNext(root, 'Current session');
  await put(root, 'openspec/changes/flow/specs/app/spec.md', spec.replaceAll('a greeting','a welcome message'));
  await updateJob(root, owned.id, owned.claimToken, 'finish', 'Updated the welcome requirement.');
  document = await get('shape');
  assert.match(document.querySelector('.studio-document').textContent, /welcome message/);
  assert.ok(document.querySelector('.studio-revision-mark'));
  assert.match(document.querySelector('.studio-thread').textContent, /Why this requirement/);
  assert.match(document.querySelector('.studio-thread').textContent, /Welcome/);
  assert.equal((await post('/api/lifecycle/actions', { action: 'finish-planning', change: 'flow' })).status, 200);
  await request('preview');const preview = await claimNext(root, 'Current session');
  assert.notEqual(preview.workingDirectory, root);
  await put(preview.workingDirectory, 'app.mjs', 'export const message = "welcome";\n');
  await put(preview.workingDirectory, 'openspec/changes/flow/tasks.md', '- [x] Update the app\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Preview ready; checks passed.');
  document = await get('implement');
  assert.ok(document.querySelector('.file-diff'));
  assert.match(document.querySelector('.file-diff').textContent, /welcome/);
  assert.equal(document.querySelector('[data-apply-form] button').disabled, false);
  assert.match(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), /"old"/);
  await put(root, 'openspec/changes/flow/proposal.md', '# Changed plan after preview\n');
  assert.equal((await get('implement')).querySelector('[data-apply-form] button').disabled, true);
  assert.equal((await post(`/api/previews/${preview.id}/apply`)).status, 400);
  await put(root, 'openspec/changes/flow/proposal.md', proposal);
  assert.equal((await post(`/api/previews/${preview.id}/apply`)).status, 200);
  assert.match(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), /"welcome"/);
  assert.equal((await post('/api/lifecycle/actions', { action: 'validate', change: 'flow' })).status, 200);
  await request('verify');owned = await claimNext(root, 'Current session');
  await updateJob(root, owned.id, owned.claimToken, 'finish', '# Verification report\n\nWelcome message matches the spec. Inspected app.mjs and the saved requirements; no gaps were found. Automated tests were not run.\n');
  document = await get('finish');
  assert.match(document.querySelector('.studio-finish').textContent, /Specification valid/);
  assert.match(document.querySelector('.studio-finish').textContent, /Welcome message matches/);
  await request('archive');owned = await claimNext(root, 'Current session');
  const confirmation = await askJob(root, owned.id, owned.claimToken, { message: 'Archive the selected change?', options: ['Archive','Keep active'] });
  assert.ok((await get('finish')).querySelector('[data-studio-question]'));
  await assert.rejects(updateJob(root, owned.id, owned.claimToken, 'finish', 'Not answered'), /not running/);
  await post(`/api/lifecycle/jobs/${owned.id}/reply`, { questionId: confirmation.question.id, answer: 'Archive' });
  await fs.mkdir(path.join(root, 'openspec/changes/archive'), { recursive: true });
  await fs.rename(path.join(root, 'openspec/changes/flow'), path.join(root, 'openspec/changes/archive/2026-11-11-flow'));
  await updateJob(root, owned.id, owned.claimToken, 'finish', 'Archived flow.');
  document = await get('finish');
  assert.equal(document.querySelector('#workspace').dataset.change, '2026-11-11-flow');
  assert.equal(document.querySelector('#studio-message').disabled, true);
  assert.match(document.querySelector('.studio-thread').textContent, /Archived flow/);
  assert.equal((await post(`/api/previews/${preview.id}/apply`)).status, 400);
});

test('Studio reveals new questions from the beginning and preserves reading position across refreshes', async () => {
  const content = () => `<div id="workspace" data-change="flow" data-view="studio" data-workspace-mode="build" data-refresh-url="/?change=flow&view=studio&pane=document"><aside id="navigation"></aside><section id="studio" data-stage="shape" data-pane="document"><div class="studio-body" id="studio-body"><section class="studio-canvas"></section><aside class="studio-conversation"><button data-studio-expand aria-expanded="false">Expand conversation</button><div id="studio-thread"><section data-studio-question="first" tabindex="-1"><input name="choice"></section></div></aside></div><button data-studio-question-jump>Answer question</button></section></div>`;
  const { document, window } = parseHTML(content());
  let active;
  const geometry = () => {
    const thread = document.getElementById('studio-thread'), question = document.querySelector('[data-studio-question]');
    thread.getBoundingClientRect = () => ({ top: 100 });
    question.getBoundingClientRect = () => ({ top: 300 - (thread.scrollTop || 0) });
    question.focus = () => { active = question; };
    return thread;
  };
  const thread = geometry();
  vm.runInNewContext(await fs.readFile(new URL('../public/studio.js', import.meta.url), 'utf8'), { document, window, URL, URLSearchParams, location: { href: 'http://localhost/?change=flow&view=studio' } });
  assert.equal(thread.scrollTop, 182);
  assert.equal(active, undefined); // Receiving a question must not steal typing focus.
  document.querySelector('[data-studio-expand]').click();
  assert.equal(document.querySelector('#studio').dataset.conversationExpanded, 'true');
  assert.equal(document.querySelector('[data-studio-expand]').getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('[data-studio-expand]').textContent, 'Show document');
  thread.scrollTop = 360;
  document.dispatchEvent(new window.Event('htmx:beforeRequest'));
  document.getElementById('workspace').outerHTML = content();
  const nextThread = geometry();
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(nextThread.scrollTop, 360);
  assert.equal(document.querySelector('#studio').dataset.conversationExpanded, 'true');
  assert.ok(document.getElementById('navigation'));
  document.querySelector('[data-studio-question-jump]').click();
  assert.equal(nextThread.scrollTop, 182);
  assert.equal(active, document.querySelector('[data-studio-question]'));
  assert.equal(document.querySelector('#studio').dataset.pane, 'conversation');
  document.querySelector('[data-studio-expand]').click();
  assert.equal(document.querySelector('#studio').dataset.conversationExpanded, 'false');
  nextThread.scrollTop = 360;
  document.dispatchEvent(new window.Event('htmx:beforeRequest'));
  document.querySelector('[data-studio-question]').dataset.studioQuestion = 'second';
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(nextThread.scrollTop, 182);
});

test('the Studio composer sends explicit read-only intent and retains a failed draft', async () => {
  const { document, window } = parseHTML('<meta name="csrf-token" content="csrf"><div id="workspace" data-change="flow"><section data-studio><form id="studio-composer" data-lifecycle-form data-studio-composer action="/api/lifecycle/actions"><input name="action" type="hidden" value="revise-plan"><input name="change" type="hidden" value="flow"><input name="intent" type="radio" value="revise-plan"><input name="intent" type="radio" value="explore"><textarea name="message"></textarea><button type="submit">Send</button><div data-lifecycle-feedback></div></form></section></div>');
  const form = document.querySelector('form');let payload;
  form.querySelector('[value=explore]').checked = true;form.querySelector('[value=revise-plan][type=radio]').checked = false;
  vm.runInNewContext(await fs.readFile(new URL('../public/workflow.js', import.meta.url), 'utf8'), { document, window, location: { assign() {} }, fetch: async (_url, args) => { payload = JSON.parse(args.body);return { ok: false, status: 400, json: async () => ({ error: 'Try again' }) }; } });
  form.querySelector('textarea').value = 'Why does this behave this way?';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(payload.action, 'explore');assert.equal(payload.intent, undefined);
  const replacement = form.cloneNode(true);replacement.querySelector('textarea').value = '';form.replaceWith(replacement);
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(replacement.querySelector('textarea').value, 'Why does this behave this way?');
  assert.match(replacement.querySelector('[data-lifecycle-feedback]').textContent, /Try again/);
});

test('old Build implementation links open the retained diff in Review', async t => {
  const root = await fixture(t);
  await put(root, 'src/a.mjs', 'export const value = 1;\n');
  await enqueue(root, { action: 'preview', change: 'flow' });
  const preview = await claimNext(root, 'Session');
  await put(preview.workingDirectory, 'src/a.mjs', 'export const value = 2;\n');
  await put(preview.workingDirectory, 'src/b.mjs', 'export const added = true;\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Two files.');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const document = parseHTML(await (await fetch(viewer.origin + '/?' + new URLSearchParams({ change: 'flow', view: 'studio', stage: 'implement', job: preview.id, file: 'src/a.mjs', mode: 'split', wrap: '0' }))).text()).document;
  assert.equal(document.querySelector('#workspace').dataset.workspaceMode, 'review');
  assert.equal(document.querySelector('#workspace').dataset.view, 'preview');
  assert.equal(document.querySelector('#studio'), null);
  assert.equal(document.querySelectorAll('.changed-file-link').length, 2);
  assert.equal(document.querySelector('.file-diff').dataset.diffFile, 'src/a.mjs');
  assert.equal(document.querySelector('.file-diff').dataset.diffLayout, 'split');
  assert.ok(document.querySelector('#file-filter'));
  for (const link of document.querySelectorAll('.changed-file-link, .diff-file-paging a')) {
    const url = new URL(link.getAttribute('href'), viewer.origin);
    assert.equal(url.searchParams.get('view'), 'preview');
    assert.equal(url.searchParams.get('job'), preview.id);
    assert.equal(url.searchParams.get('mode'), 'split');
    assert.equal(url.searchParams.get('wrap'), '0');
  }
});

test('Build Files trigger focuses the selected file without a filter and preserves drawer and paging focus', async () => {
  const content = (file = 'src/a.mjs', pane = 'conversation') => `<div id="workspace" data-change="flow" data-view="studio" data-workspace-mode="build" data-refresh-url="/?change=flow&view=studio&stage=implement&job=preview&file=${file}&pane=${pane}"><button class="mobile-menu" id="navigation-toggle"></button><aside id="navigation"><button class="navigation-close"></button><div class="project-select">Workspace</div><form class="search"><input id="search" name="q"><input type="hidden" name="stage" value="implement"><input type="hidden" name="job" value="preview"><input type="hidden" name="file" value="${file}"></form><nav><div data-project-changes><a class="change-link selected" href="/?change=flow&view=studio">flow <span data-task-count>1/2</span></a><div data-preview-navigation data-preview-placement="change"><nav class="changed-files-nav studio-changed-files" data-preview-job="preview"><a class="changed-file-link" data-file-path="src/a.mjs" ${file === 'src/a.mjs' ? 'aria-current="page"' : ''} href="/?change=flow&view=studio&stage=implement&job=preview&file=src/a.mjs&pane=document">a</a><a class="changed-file-link" data-file-path="src/b.mjs" ${file === 'src/b.mjs' ? 'aria-current="page"' : ''} href="/?change=flow&view=studio&stage=implement&job=preview&file=src/b.mjs&pane=document">b</a></nav></div></div></nav></aside><main id="document"><div class="reader"><section id="studio" data-stage="implement" data-pane="${pane}"><button id="studio-browse-files" data-studio-files>Files</button><button data-studio-pane="document"></button><button data-studio-pane="conversation"></button><div id="studio-thread"></div><section class="studio-diff-panel diff-panel"><div data-diff-file="${file}"><header><strong data-file-heading tabindex="-1">${file}</strong><button data-diff-jump="next">Next block</button><span class="hunk-position"></span></header><div class="diff-code-scroll"><div id="hunk-one" data-diff-hunk="1"></div><div id="hunk-two" data-diff-hunk="2"></div></div></div></section></section></div></main></div>`;
  const { document, window } = parseHTML(`<html><head></head><body><button id="theme-toggle"></button><span id="connection"></span>${content()}<dialog id="apply-dialog"></dialog><div id="toast"></div></body></html>`);
  let active = null, scrolled;
  Object.defineProperty(document, 'activeElement', { get: () => active });
  window.HTMLElement.prototype.focus = function() { active = this; };
  window.HTMLElement.prototype.scrollIntoView = function() { scrolled = this.id; };
  window.matchMedia = () => ({ matches: true });
  class Socket { addEventListener() {} }
  const context = { document, window, URL, URLSearchParams, location: { href: 'http://localhost/', pathname: '/', search: '', protocol: 'http:', host: 'localhost' }, localStorage: { getItem() {}, setItem() {} }, WebSocket: Socket, fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(await fs.readFile(new URL('../public/studio.js', import.meta.url), 'utf8'), context);
  const refresh = new window.Event('htmx:beforeSwap');refresh.detail = { xhr: { status: 200 }, serverResponse: content() };document.dispatchEvent(refresh);
  assert.equal(parseHTML(refresh.detail.serverResponse).document.querySelector('#navigation').hasAttribute('hx-preserve'), false, 'ordinary refreshes update the entire sidebar');
  document.querySelector('[data-studio-files]').click();
  assert.equal(document.querySelector('#workspace').classList.contains('navigation-open'), true);
  assert.equal(active.dataset.filePath, 'src/a.mjs');
  assert.equal(document.getElementById('file-filter'), null);
  document.querySelector('.studio-changed-files').scrollTop = 95;
  const escape = new window.Event('keydown', { bubbles: true });Object.defineProperty(escape, 'key', { value: 'Escape' });document.dispatchEvent(escape);
  assert.equal(active.id, 'studio-browse-files');assert.equal(document.querySelector('#workspace').classList.contains('navigation-open'), false);
  document.querySelector('[data-studio-files]').click();
  const file = document.querySelector('[data-file-path="src/b.mjs"]');
  const before = new window.Event('htmx:beforeRequest');before.detail = { elt: file };document.dispatchEvent(before);file.click();
  assert.equal(document.querySelector('#workspace').classList.contains('navigation-open'), false);
  const swap = new window.Event('htmx:beforeSwap');swap.detail = { xhr: { status: 200 }, serverResponse: content('src/b.mjs', 'document').replace('<span data-task-count>1/2</span>', '<span data-task-count>2/2</span>') };document.dispatchEvent(swap);
  assert.equal(parseHTML(swap.detail.serverResponse).document.querySelector('#navigation').getAttribute('hx-preserve'), 'true');
  assert.equal(document.querySelector('#navigation [data-task-count]').textContent, '2/2');
  const previous = document.getElementById('workspace'), sidebar = document.getElementById('navigation'), search = document.getElementById('search');
  const transport = document.createElement('template');transport.innerHTML = swap.detail.serverResponse;
  const incoming = transport.content.firstElementChild;incoming.querySelector('#navigation').replaceWith(sidebar);previous.replaceWith(incoming);
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(document.getElementById('navigation'), sidebar);assert.equal(document.getElementById('search'), search);
  assert.equal(sidebar.querySelector('.search [name=file]').value, 'src/b.mjs');
  assert.equal(sidebar.querySelector('.search [name=job]').value, 'preview');
  assert.equal(sidebar.querySelector('.search [name=stage]').value, 'implement');
  assert.equal(document.getElementById('studio').dataset.pane, 'document');
  assert.equal(active.hasAttribute('data-file-heading'), true);assert.equal(active.textContent, 'src/b.mjs');
  assert.equal(document.getElementById('file-filter'), null);
  assert.equal(document.querySelector('.studio-changed-files').scrollTop, 95);
  assert.equal(sidebar.querySelector('.change-link.selected').nextElementSibling.hasAttribute('data-preview-navigation'), true);
  document.querySelector('[data-diff-jump=next]').click();
  assert.equal(scrolled, 'hunk-one');assert.equal(document.querySelector('.hunk-position').textContent, 'Change 1 of 2');
});

test('new planning documents keep normal prose instead of marking every block as revised', () => {
  const source = '# New spec\n\n## Purpose\n\nReadable requirements.\n';
  const document = parseHTML(renderPlanMarkdown(source, '')).document;
  assert.equal(document.querySelector('.studio-revision-mark'), null);
  assert.equal(document.querySelector('h1').textContent, 'New spec');
});

test('running progress stays visible and only an expired owner can release a stalled request', async t => {
  const root = await fixture(t);
  await planningFixture(root, 'flow');
  const queued = await enqueue(root, { action: 'explore', change: 'flow', message: 'Clarify the scope' });
  const owned = await claimNext(root, 'Current session', 'owner');
  const viewer = await startServer({ root, port: 0, quiet: true });t.after(() => viewer.close());
  const get = async () => parseHTML(await (await fetch(viewer.origin + '/?change=flow&view=studio')).text()).document;
  let document = await get();
  assert.match(document.querySelector('.studio-progress').textContent, /Agent is working/);
  assert.equal(document.querySelector('.studio-progress').closest('details'), null);
  assert.equal(document.querySelector('#studio-composer').hidden, true);
  assert.equal(document.querySelector('[data-studio-stalled-action]').hidden, true);
  assert.ok(document.querySelector('.studio-footer [data-studio-conversation-jump]'));
  assert.equal(document.querySelector('.studio-footer [data-lifecycle-form]'), null, 'No disabled action with accumulated success messages');
  const csrf = document.querySelector('meta[name=csrf-token]').content;
  const cancel = token => fetch(viewer.origin + `/api/jobs/${queued.id}/cancel`, { method: 'POST', headers: { Origin: viewer.origin, 'X-CSRF-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await cancel('invalid')).status, 403);
  const live = await cancel(csrf);assert.equal(live.status, 400);assert.match((await live.json()).error, /still responding/);
  await put(root, '.spequi/agent.json', JSON.stringify({ agent: 'Current session', sessionId: 'owner', at: Date.now() - 46000 }));
  document = await get();
  assert.match(document.querySelector('.studio-progress').textContent, /CLI|in progress/i);
  assert.equal(document.querySelector('[data-studio-stalled-action]').hidden, false);
  assert.match(document.querySelector('[data-studio-stalled-action]').textContent, /does not stop that process/);
  assert.equal((await cancel(csrf)).status, 200);
  await assert.rejects(updateJob(root, owned.id, owned.claimToken, 'finish', 'Late completion'), /not running/);
  assert.equal((await listJobs(root)).find(job => job.id === owned.id).status, 'cancelled');
  await enqueue(root, { action: 'explore', change: 'flow', message: 'Retry after reconnecting' });
  document = await get();assert.equal(document.querySelectorAll('.studio-history').length, 1);
});

test('Build planning omits the duplicate document row for both existing and newly created specs', async t => {
  const root = await fixture(t);
  await planningFixture(root, 'flow');
  await put(root, 'openspec/changes/flow/specs/first/spec.md', '# First capability\n');
  await put(root, 'openspec/changes/flow/specs/second/spec.md', '# Second capability\n');
  const viewer = await startServer({ root, port: 0, quiet: true });t.after(() => viewer.close());
  for (const created of ['', '1']) {
    const query = `/?change=flow&view=studio&created=${created}&plan=specs/second/spec.md`;
    const document = await readyDocument(viewer.origin + query);
    assert.equal(document.querySelector('#studio-document-picker,.studio-version,.studio-compare,.studio-picker'), null);
    assert.equal(document.querySelector('[data-studio-stage]'), null);
    const files = [...document.querySelectorAll('#studio-plan-files[aria-label="Planning documents"] a')];
    assert.equal(files.length, 2);
    assert.ok(files.every(link => (new URL(link.getAttribute('href'), viewer.origin).searchParams.get('created') || '') === created));
    assert.match(document.querySelector('.studio-document').textContent, /Second capability/);
    assert.equal(files.find(link => link.textContent.includes('second')).getAttribute('aria-current'), 'page');
    const first = parseHTML(await (await fetch(new URL(files.find(link => link.textContent.includes('first')).getAttribute('href'), viewer.origin))).text()).document;
    assert.match(first.querySelector('.studio-document').textContent, /First capability/);
  }
});

test('sidebar draft and existing-change links retain separate destinations without a mode switch', async () => {
  const { document, window } = parseHTML('<div id="workspace" data-change="draft-change" data-view="studio" data-workspace-mode="build" data-refresh-url="/?change=draft-change&view=studio"><aside id="navigation"><a class="change-link draft-link" href="/?view=studio&new=1&draft=saved">Draft</a><a class="change-link" href="/?change=existing&view=rendered">Existing</a></aside><section id="studio" data-stage="shape" data-pane="document"><div id="studio-thread"></div></section></div>');
  vm.runInNewContext(await fs.readFile(new URL('../public/studio.js', import.meta.url), 'utf8'), { document, window, URL, URLSearchParams, location: { href: 'http://localhost/?change=draft-change&view=studio' } });
  const links = [...document.querySelectorAll('#navigation a')].map(link => new URL(link.getAttribute('href'), 'http://localhost'));
  assert.equal(links[0].searchParams.get('draft'), 'saved'); assert.equal(links[0].searchParams.get('new'), '1');
  assert.equal(links[1].searchParams.get('view'), 'rendered');
});
