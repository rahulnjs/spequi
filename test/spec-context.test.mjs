import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseHTML } from 'linkedom';
import { initProject } from '../src/project.mjs';
import { enqueue, claimNext, updateJob } from '../src/jobs.mjs';
import { previewResult, applyPreview } from '../src/previews.mjs';
import { captureSpecLinks, specContextForFile } from '../src/spec-context.mjs';
import { startServer } from '../src/server.mjs';
import { addComment } from '../src/review-store.mjs';

const spec = 'openspec/changes/preferences/specs/emails/spec.md';
const source = [
  '## ADDED Requirements', '',
  '### Requirement: Product emails',
  'The system SHALL disable optional product emails until an account opts in.', '',
  '#### Scenario: New account',
  '- **WHEN** no preference exists',
  '- **THEN** product emails are disabled', '',
  '### Requirement: Security notifications',
  'The system SHALL keep security notifications enabled when saving preferences.', '',
  '#### Scenario: Save preferences',
  '- **WHEN** optional emails are disabled',
  '- **THEN** security notifications remain enabled', ''
].join('\r\n');
const before = ['export const productUpdates = true;', ...Array.from({ length: 12 }, (_, i) => `// unchanged ${i}`), 'export const securityAlerts = false;', ''].join('\r\n');
const after = before.replace('productUpdates = true', 'productUpdates = false').replace('securityAlerts = false', 'securityAlerts = true');
const ref = (extra = {}) => ({ file: 'src/preferences.js', side: 'proposed', start: 1, end: 1, spec, specStart: 3, specEnd: 8, ...extra });
async function put(root, file, text) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, text); }
async function fixture(t, links = [], design = '# Design\n', specText = source) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-spec-context-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/config.yaml', 'schema: spec-driven\n');
  await put(root, 'openspec/changes/preferences/proposal.md', '# Email preferences\n');
  await put(root, 'openspec/changes/preferences/design.md', design);
  await put(root, 'openspec/changes/preferences/tasks.md', '- [x] Implement preferences\n');
  await put(root, spec, specText);
  await put(root, 'openspec/changes/unrelated/specs/emails/spec.md', '### Requirement: Other change\nChange `src/preferences.js`.\n');
  await put(root, 'openspec/specs/accounts/spec.md', '### Requirement: Account contract\nAccounts SHALL preserve security alerts.\n');
  await put(root, 'src/preferences.js', before);
  await put(root, 'src/deleted.js', 'export const obsolete = true;\n');
  await put(root, 'src/format.js', 'alpha\r\nbeta\r\n');
  await enqueue(root, { action: 'preview', change: 'preferences' });
  const job = await claimNext(root, 'Spec context test');
  await put(job.workingDirectory, 'src/preferences.js', after);
  await put(job.workingDirectory, 'src/added.js', 'export const added = true;\n');
  await put(job.workingDirectory, 'src/format.js', 'alpha\nbeta\n');
  await fs.unlink(path.join(job.workingDirectory, 'src/deleted.js'));
  if (links !== null) await put(job.workingDirectory, '.spequi/spec-links.json', JSON.stringify({ version: 1, links }));
  await updateJob(root, job.id, job.claimToken, 'finish', 'Spec context fixture');
  const result = await previewResult(root, job.id);
  const file = result.changes.find(item => item.file === 'src/preferences.js');
  return { root, job, result, file, context: () => specContextForFile(root, job, file, result, before, after) };
}

test('agent links retain exact baseline spec quotes and stay out of applied source', async t => {
  const f = await fixture(t, [ref(), ref({ start: 14, end: 14, specStart: 10, specEnd: 15 }), ref({ file: 'src/deleted.js', side: 'current' }), ref({ file: 'src/added.js' })]);
  assert.equal(f.result.specContext.links.length, 4);
  assert.equal(f.result.specContext.invalidReport, false);
  assert.ok(!f.result.changes.some(item => item.file.includes('spec-links')));
  assert.match(f.job.instructions, /spec-links.json/);
  const context = await f.context();
  assert.equal(context.links[0].quote, source.replace(/\r\n/g, '\n').split('\n').slice(2, 8).join('\n'));
  assert.equal(context.links[0].title, 'Product emails');
  assert.equal(context.links[0].provenance, 'agent');
  assert.equal(context.suggestions.length, 0);
  await put(f.root, spec, 'This plan was rewritten.');
  await put(f.job.workingDirectory, spec, 'The isolated plan was rewritten too.');
  assert.deepEqual(await f.context(), context);
  await fs.rename(path.join(f.root, 'openspec/changes/preferences'), path.join(f.root, 'openspec/changes/archive-copy'));
  assert.deepEqual(await f.context(), context);
  await applyPreview(f.root, f.job.id);
  assert.equal(await fs.readFile(path.join(f.root, 'src/preferences.js'), 'utf8'), after);
  await assert.rejects(fs.access(path.join(f.root, '.spequi/spec-links.json')));
});

test('invalid locations cannot become agent evidence and malformed reports do not break previews', async t => {
  const invalid = [
    ref({ start: 2, end: 2 }), ref({ start: 0 }), ref({ end: 999 }), ref({ side: 'wrong' }),
    ref({ specStart: 0 }), ref({ specEnd: 99 }), ref({ spec: '../outside.md' }),
    ref({ spec: 'openspec/changes/unrelated/specs/emails/spec.md' }),
    ref({ spec: spec.replaceAll('/', '\\') }), ref({ spec: '/etc/passwd' }), ref({ file: 'src/unknown.js' })
  ];
  const f = await fixture(t, [ref(), ...invalid]);
  assert.equal(f.result.specContext.links.length, 1);
  assert.deepEqual(f.result.specContext.invalidFiles, ['src/preferences.js']);
  assert.equal(f.result.specContext.invalidReport, true);
  assert.match((await f.context()).notice, /invalid/);
  const report = '.spequi/spec-links.json';
  for (const text of ['{broken', JSON.stringify({ version: 2, links: [] }), 'x'.repeat(65537), JSON.stringify({ version: 1, links: Array(101).fill(ref()) })]) {
    await put(f.job.workingDirectory, report, text);
    const captured = await captureSpecLinks(f.root, f.job.id, f.result.changes);
    assert.equal(captured.invalidReport, true); assert.equal(captured.links.length, 0);
  }
  await fs.unlink(path.join(f.job.workingDirectory, report));
  await fs.symlink(path.join(f.root, spec), path.join(f.job.workingDirectory, report));
  assert.equal((await captureSpecLinks(f.root, f.job.id, f.result.changes)).invalidReport, true);
});

test('deduplicates links, caps file references, and accepts explicit main spec citations', async t => {
  const f = await fixture(t, [ref(), ref(), ref({ spec: 'openspec/specs/accounts/spec.md', specStart: 1, specEnd: 2 })]);
  assert.equal(f.result.specContext.links.length, 2);
  assert.equal((await f.context()).links[1].title, 'Account contract');
  await put(f.job.workingDirectory, '.spequi/spec-links.json', JSON.stringify({ version: 1, links: [1, 3, 4, 6, 7, 8, 10, 11, 13].map(line => ref({ specStart: line, specEnd: line })) }));
  const captured = await captureSpecLinks(f.root, f.job.id, f.result.changes);
  assert.equal(captured.links.length, 8); assert.deepEqual(captured.invalidFiles, ['src/preferences.js']);
});

test('snapshot tampering and changed code suppress unverifiable references', async t => {
  const f = await fixture(t, [ref()]);
  await put(f.root, `.spequi/previews/${f.job.id}/baseline/${spec}`, 'Tampered baseline');
  assert.equal((await f.context()).links.length, 0);
  assert.match((await f.context()).notice, /verified/);
  const changed = await specContextForFile(f.root, f.job, f.file, f.result, before, after + 'tampered');
  assert.equal(changed.links.length, 0); assert.match(changed.notice, /saved code changed/);
  const added = f.result.changes.find(item => item.file === 'src/added.js');
  const injected = await specContextForFile(f.root, f.job, added, f.result, 'injected before', 'export const added = true;\n');
  assert.match(injected.notice, /saved code changed/);
});

test('older previews receive conservative file-level suggestions from their own frozen plan', async t => {
  const f = await fixture(t, null, '# Design\n\n## Implementation\nUpdate `src/preferences.js` to preserve security notifications.\n');
  delete f.result.specContext;
  const context = await f.context();
  assert.equal(context.links.length, 0); assert.equal(context.suggestions.length, 1);
  assert.equal(context.suggestions[0].reason, 'File path mentioned');
  assert.equal(context.suggestions[0].provenance, 'suggested');
  assert.ok(context.suggestions[0].spec.includes('/preferences/'));
  const unrelated = await fixture(t, null);
  assert.equal((await unrelated.context()).suggestions.length, 0);
  const symbols = await fixture(t, null, '# Design\nKeep `securityAlerts` enabled.\n');
  assert.equal((await symbols.context()).suggestions[0].reason, 'Changed symbol: securityAlerts');
});

test('fenced pseudo headings cannot become source titles or split suggested sections', async t => {
  const f = await fixture(t, [ref({ specStart: 6, specEnd: 7 })], '# Design\n', '### Requirement: Actual heading\n\n```md\n### Requirement: Fake heading\n```\nThe system SHALL preserve security notifications.\nSee `src/preferences.js`.\n');
  assert.equal((await f.context()).links[0].title, 'Actual heading');
});

test('Review and Build preserve inline quote placement, line anchors, comments and split columns', async t => {
  const f = await fixture(t, [ref(), ref({ start: 14, end: 14 }), ref({ file: 'src/deleted.js', side: 'current' })]);
  await addComment(f.root, f.job.id, { file: f.file.file, side: 'proposed', start: 14, body: 'Security must stay enabled.' });
  const server = await startServer({ root: f.root, port: 0, quiet: true });
  t.after(() => server.close());
  let stableID;
  for (const view of ['preview', 'studio']) for (const mode of ['unified', 'split']) for (const context of ['', 'all']) {
    const query = new URLSearchParams({ change: 'preferences', view, stage: 'implement', job: f.job.id, file: f.file.file, mode, context });
    const { document } = parseHTML(await (await fetch(`${server.origin}/?${query}`)).text());
    const quotes = document.querySelectorAll('.spec-context-row');
    assert.equal(quotes.length, 2, `${view}/${mode}/${context}`);
    assert.ok([...quotes].every(row => row.firstElementChild.getAttribute('colspan') === (mode === 'split' ? '6' : '4')));
    assert.equal(document.querySelectorAll('.spec-context-quote').length, 1);
    assert.equal(document.querySelectorAll('.spec-context-repeat').length, 1);
    assert.match(quotes[0].nextElementSibling.textContent, /productUpdates/);
    assert.match(quotes[1].nextElementSibling.textContent, /securityAlerts/);
    const id = document.querySelector('.spec-context-quote').id;
    stableID ||= id; assert.equal(id, stableID);
    assert.equal(document.querySelector('.spec-context-repeat').getAttribute('href'), `#${id}`);
    if (view === 'preview') {
      assert.ok(document.querySelector('[data-review-line="14"][data-review-side="proposed"].has-comments'));
      assert.match(document.querySelector('.diff-inline-thread[data-diff-line="14"][data-diff-side="proposed"]').textContent, /Security must stay enabled/);
    }
  }
});

test('suggestions, no-link and unavailable-snapshot states stay honest and markdown stays inert', async t => {
  const f = await fixture(t, null, '# Design\nChange `src/preferences.js`.\n<script>alert(1)</script>\n<button hx-get="/bad">fake control</button>\n[Bad](javascript:alert(1))\n');
  const server = await startServer({ root: f.root, port: 0, quiet: true }); t.after(() => server.close());
  const read = async file => parseHTML(await (await fetch(`${server.origin}/?change=preferences&view=preview&job=${f.job.id}&file=${file}&context=all`)).text()).document;
  let document = await read('src/preferences.js');
  assert.match(document.querySelector('.spec-context-row').textContent, /Suggested · file-level/);
  assert.match(document.querySelector('.spec-context-caveat').textContent, /not a recorded explanation/);
  assert.equal(document.querySelector('.spec-context-row script, .spec-context-row button, .spec-context-row [hx-get], .spec-context-row a[href^="javascript:"]'), null);
  document = await read('src/added.js'); assert.match(document.querySelector('.spec-context-notice').textContent, /No spec links/);
  await fs.rm(path.join(f.root, `.spequi/previews/${f.job.id}/manifest.json`));
  document = await read('src/preferences.js'); assert.match(document.querySelector('.spec-context-notice').textContent, /snapshot is unavailable/);
  assert.ok(document.querySelector('.review-diff-table'));
});

test('line-ending-only changes show file suggestions once with folded and expanded context', async t => {
  const f = await fixture(t, null, '# Design\nNormalize `src/format.js` line endings.\n');
  const server = await startServer({ root: f.root, port: 0, quiet: true }); t.after(() => server.close());
  for (const mode of ['split', 'unified']) for (const context of ['', 'all']) {
    const { document } = parseHTML(await (await fetch(`${server.origin}/?change=preferences&view=preview&job=${f.job.id}&file=src/format.js&mode=${mode}&context=${context}`)).text());
    assert.equal(document.querySelectorAll('.spec-context-row').length, 1);
    assert.match(document.querySelector('.spec-context-row').textContent, /Suggested · file-level/);
    assert.equal(document.querySelectorAll('[data-diff-hunk]').length, 0);
  }
});
