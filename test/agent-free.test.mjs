import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { createTwoFilesPatch } from 'diff';
import { initProject } from '../src/project.mjs';
import { analyzeChange, savedAnalysis } from '../src/spec-impact.mjs';
import { directPreview, modelInfo } from '../src/direct-preview.mjs';
import { previewContents, applyPreview } from '../src/previews.mjs';
import { claimNext, agentStatus, listJobs } from '../src/jobs.mjs';
import { addComment, exportFeedback } from '../src/review-store.mjs';
import { startServer } from '../src/server.mjs';

async function put(root, file, content) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-agent-free-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/changes/reset/proposal.md', '# Reset passwords\n\nUpdate `src/auth.mjs` and `resetPassword`.\n');
  await put(root, 'openspec/changes/reset/tasks.md', '- [ ] Implement reset\n');
  await put(root, 'src/auth.mjs', "import { db } from './db.mjs';\nexport function resetPassword() { return db; }\n");
  await put(root, 'src/db.mjs', 'export const db = null;\n');
  await put(root, 'src/app.mjs', "import { resetPassword } from './auth.mjs';\nresetPassword();\n");
  return root;
}

test('offline impact explains direct paths, named symbols and dependency relationships without writing source or queuing work', async t => {
  const root = await fixture(t), original = await fs.readFile(path.join(root, 'src/auth.mjs'));
  await put(root, '.env.local', 'DO_NOT_LEAK=secret');
  await put(root, 'src/oversized.mjs', 'x'.repeat(512001));
  await put(root, 'src/binary.js', Buffer.from([0, 1, 2]));
  await put(root, 'src/unknown.bin', 'unsupported');
  await fs.symlink(path.join(root, '.env.local'), path.join(root, 'src/link.mjs'));
  const result = await analyzeChange(root, 'reset');
  const direct = result.candidates.find(item => item.file === 'src/auth.mjs');
  assert.equal(direct.strength, 'Direct reference');
  assert.ok(direct.evidence.some(item => item.kind === 'Named symbol'));
  assert.equal(direct.evidence[0].artifact, 'openspec/changes/reset/proposal.md');
  assert.ok(result.candidates.some(item => item.file === 'src/app.mjs'));
  assert.ok(result.candidates.some(item => item.file === 'src/db.mjs'));
  assert.ok(result.coverage.skipped.some(item => item.file === 'src/oversized.mjs'));
  assert.ok(result.coverage.skipped.some(item => item.file === 'src/binary.js'));
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_LEAK|secret|link\.mjs/);
  assert.equal((await fs.readdir(path.join(root, '.spequi/jobs'))).length, 0);
  assert.deepEqual(await fs.readFile(path.join(root, 'src/auth.mjs')), original);
  assert.equal((await savedAnalysis(root, 'reset')).stale, false);
});

test('analysis detects modified, added, deleted, replaced-by-symlink and changed specification inputs', async t => {
  const root = await fixture(t);
  const check = async mutation => { await analyzeChange(root, 'reset'); await mutation(); assert.equal((await savedAnalysis(root, 'reset')).stale, true); };
  await check(() => put(root, 'src/auth.mjs', 'export const resetPassword = true;\n'));
  await check(() => put(root, 'src/new.mjs', 'export const extra = true;\n'));
  await check(() => fs.unlink(path.join(root, 'src/new.mjs')));
  await check(() => put(root, 'openspec/changes/reset/proposal.md', '# Changed requirements\n'));
  await check(async () => { await fs.unlink(path.join(root, 'src/auth.mjs')); await fs.symlink(path.join(root, 'src/db.mjs'), path.join(root, 'src/auth.mjs')); });
});

test('empty or invalid scope never invents a diff or silently selects a change', async t => {
  const root = await fixture(t);
  await put(root, 'openspec/changes/empty/proposal.md', '# Xylophone\n');
  const result = await analyzeChange(root, 'empty');
  assert.deepEqual(result.candidates, []);
  await assert.rejects(analyzeChange(root, 'missing'), /existing active/);
  await put(root, 'openspec/changes/archive/2026-11-10-old/proposal.md', '# Old\n');
  await assert.rejects(analyzeChange(root, '2026-11-10-old'), /existing active/);
  assert.equal(await savedAnalysis(root, 'never'), null);
});

test('patch previews retain exact CRLF/LF content, additions/deletions, reviews and conflict-checked apply', async t => {
  const root = await fixture(t);
  const before = 'const enabled = false;\r\n', after = 'const enabled = true;\n';
  await put(root, 'flag.mjs', before);
  await put(root, 'obsolete.mjs', 'old\n');
  const patch = createTwoFilesPatch('a/flag.mjs', 'b/flag.mjs', before, after) + '\n' +
    createTwoFilesPatch('/dev/null', 'b/new.mjs', '', 'new\r\n') + '\n' +
    createTwoFilesPatch('a/obsolete.mjs', '/dev/null', 'old\n', '');
  const { job, result } = await directPreview(root, { change: 'reset', kind: 'patch', patch });
  assert.equal(job.origin, 'patch'); assert.equal(job.status, 'completed');
  assert.equal(job.validation.status, 'not-run');
  assert.equal(result.changes.length, 3);
  assert.equal((await previewContents(root, job.id, 'flag.mjs')).after, after);
  assert.equal(await fs.readFile(path.join(root, 'flag.mjs'), 'utf8'), before);
  await addComment(root, job.id, { file: 'flag.mjs', side: 'proposed', start: 1, end: 1, body: 'Review this proposed edit.' });
  assert.ok((await exportFeedback(root, job.id)).id);
  assert.equal((await agentStatus(root)).connected, false);
  assert.equal(await claimNext(root, 'Test consumer'), null);
  await put(root, 'flag.mjs', 'a concurrent edit\n');
  await assert.rejects(applyPreview(root, job.id), /Project changed/);
  await put(root, 'flag.mjs', before);
  await applyPreview(root, job.id);
  assert.equal(await fs.readFile(path.join(root, 'flag.mjs'), 'utf8'), after);
  assert.equal(await fs.readFile(path.join(root, 'new.mjs'), 'utf8'), 'new\r\n');
  await assert.rejects(fs.access(path.join(root, 'obsolete.mjs')));
});

test('invalid, conflicting, duplicate and unsafe patches never publish partial completed proposals', async t => {
  const root = await fixture(t), original = await fs.readFile(path.join(root, 'src/auth.mjs'), 'utf8');
  const valid = createTwoFilesPatch('a/src/auth.mjs', 'b/src/auth.mjs', original, 'export const resetPassword = true;\n');
  const invalid = [
    valid + '\n' + createTwoFilesPatch('/dev/null', 'b/../escape.mjs', '', 'bad\n'),
    valid + '\n' + valid,
    createTwoFilesPatch('/dev/null', 'b/.env', '', 'secret\n'),
    createTwoFilesPatch('a/src/auth.mjs', 'b/src/auth.mjs', 'wrong baseline\n', 'new\n'),
    'not a patch',
    createTwoFilesPatch('a/src/auth.mjs', 'b/renamed.mjs', original, 'new\n')
  ];
  for (const patch of invalid) await assert.rejects(directPreview(root, { change: 'reset', kind: 'patch', patch }));
  assert.equal(await fs.readFile(path.join(root, 'src/auth.mjs'), 'utf8'), original);
  assert.ok((await listJobs(root)).every(job => job.status === 'failed'));
});

async function modelFixture(t, root, handler, extras = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ headers: req.headers, data: JSON.parse(body) });
    await handler(req, res, requests.at(-1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await put(root, '.spequi/config.json', JSON.stringify({ version: 1, previewModel: { endpoint: `http://127.0.0.1:${server.address().port}/v1/chat/completions`, model: 'fixture-model', ...extras } }));
  return requests;
}
const answer = (res, edits) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ edits }) } }] })); };

test('one model request uses selected frozen context, retains provenance and creates no agent connection', async t => {
  const root = await fixture(t);
  await put(root, '.env.local', 'NEVER_SEND_THIS=secret');
  process.env.OPSX_PREVIEW_TEST_KEY = 'fixture-private-key';
  t.after(() => { delete process.env.OPSX_PREVIEW_TEST_KEY; });
  const requests = await modelFixture(t, root, (_req, res) => answer(res, [{ file: 'src/auth.mjs', content: 'export function resetPassword() { return true; }\n' }, { file: 'src/reset.mjs', content: 'export const implemented = true;\n' }]), { apiKeyEnv: 'OPSX_PREVIEW_TEST_KEY' });
  const analysis = await analyzeChange(root, 'reset');
  const original = await fs.readFile(path.join(root, 'src/auth.mjs'), 'utf8');
  const { job, result } = await directPreview(root, { change: 'reset', kind: 'model', analysisId: analysis.id, files: ['src/auth.mjs'] });
  assert.equal(job.origin, 'model'); assert.equal(job.analysisId, analysis.id);
  assert.equal(job.status, 'completed'); assert.equal(result.changes.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, 'Bearer fixture-private-key');
  const prompt = JSON.parse(requests[0].data.messages[1].content);
  assert.deepEqual(prompt.files.map(item => item.file), ['src/auth.mjs']);
  assert.equal(prompt.files[0].content, original);
  assert.doesNotMatch(JSON.stringify(prompt), /NEVER_SEND_THIS|fixture-private-key/);
  assert.doesNotMatch(JSON.stringify(job), /fixture-private-key/);
  assert.equal((await agentStatus(root)).connected, false);
  assert.equal((await modelInfo(root)).configured, true);
  assert.equal(await fs.readFile(path.join(root, 'src/auth.mjs'), 'utf8'), original);
});

test('model generation rejects stale analysis, unselected edits, malformed replies, HTTP errors and timeouts', async t => {
  const root = await fixture(t);
  await assert.rejects(directPreview(root, { change: 'reset', kind: 'model' }), /Configure a model/);
  let mode = 'unselected';
  const requests = await modelFixture(t, root, async (_req, res) => {
    if (mode === 'unselected') answer(res, [{ file: 'src/db.mjs', content: 'out of scope\n' }]);
    if (mode === 'malformed') res.end('{"choices":[]}');
    if (mode === 'error') { res.statusCode = 500; res.end('private provider error'); }
    if (mode === 'timeout') { await new Promise(resolve => setTimeout(resolve, 1100)); res.end('{}'); }
  }, { timeoutMs: 1000 });
  let analysis = await analyzeChange(root, 'reset');
  const generate = () => directPreview(root, { change: 'reset', kind: 'model', analysisId: analysis.id, files: ['src/auth.mjs'] });
  await put(root, 'src/extra.mjs', 'new\n');
  await assert.rejects(generate(), /stale/); assert.equal(requests.length, 0);
  analysis = await analyzeChange(root, 'reset');
  await assert.rejects(generate(), /outside the selected/);
  mode = 'malformed'; await assert.rejects(generate(), /JSON object/);
  mode = 'error'; await assert.rejects(generate(), error => /HTTP 500/.test(error.message) && !/private provider/.test(error.message));
  mode = 'timeout'; await assert.rejects(generate(), /timed out/);
  assert.equal(await fs.readFile(path.join(root, 'src/db.mjs'), 'utf8'), 'export const db = null;\n');
  assert.ok((await listJobs(root)).every(job => job.status === 'failed'));
});

test('HTTP tools enforce session boundaries and complete analysis/model/review/apply without an agent', async t => {
  const root = await fixture(t);
  const requests = await modelFixture(t, root, (_req, res) => answer(res, [{ file: 'src/auth.mjs', content: 'export function resetPassword() { return true; }\n' }]));
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const page = await (await fetch(viewer.origin + '/?change=reset&view=studio&stage=implement')).text();
  const csrf = page.match(/name="csrf-token" content="([^"]+)"/)[1];
  const post = (route, value, protectedSession = true) => fetch(viewer.origin + route, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(protectedSession ? { Origin: viewer.origin, 'X-CSRF-Token': csrf } : {}) }, body: JSON.stringify(value) });
  assert.match(page, /Analyze affected files/); assert.match(page, /Import patch/);
  assert.equal((await post('/api/source-preview/analyze', { change: 'reset' }, false)).status, 403);
  assert.equal((await post('/api/source-preview/analyze', { change: 'missing' })).status, 400);
  const analyzed = await post('/api/source-preview/analyze', { change: 'reset' }); assert.equal(analyzed.status, 201);
  const { analysis } = await analyzed.json();
  assert.equal(requests.length, 0);
  const analyzedPage = await (await fetch(viewer.origin + '/?change=reset&view=studio&stage=implement')).text();
  const analyzedDoc = parseHTML(analyzedPage).document;
  assert.ok(analyzedDoc.querySelector('[name="files"][value="src/auth.mjs"]'));
  assert.equal(analyzedDoc.querySelectorAll('.changed-files-nav [data-file-path]').length, 0);
  const response = await post('/api/source-preview/model', { change: 'reset', analysisId: analysis.id, files: ['src/auth.mjs'] });
  assert.equal(response.status, 201); const generated = await response.json();
  const diff = await (await fetch(viewer.origin + generated.url)).text(), document = parseHTML(diff).document;
  assert.match(diff, /Model proposal/); assert.match(diff, /No implementation checks were run/);
  assert.match(diff, /unified-diff-table/); assert.ok(document.querySelector('[data-apply-form]'));
  assert.deepEqual([...document.querySelectorAll('.changed-files-nav [data-file-path]')].map(node => node.dataset.filePath), ['src/auth.mjs']);
  assert.equal((await fetch(`${viewer.origin}/api/previews/${generated.job.id}/patch`)).status, 200);
  const comment = await post(`/api/reviews/${generated.job.id}/comments`, { file: 'src/auth.mjs', body: 'Review this model proposal.' }); assert.equal(comment.status, 201);
  const applied = await post(`/api/previews/${generated.job.id}/apply`, {}); assert.equal(applied.status, 200);
  assert.equal(await fs.readFile(path.join(root, 'src/auth.mjs'), 'utf8'), 'export function resetPassword() { return true; }\n');
  assert.equal((await (await fetch(viewer.origin + '/api/agent-status')).json()).connected, false);
  const state = JSON.stringify(await (await fetch(viewer.origin + '/api/state')).json());
  assert.doesNotMatch(state, /Authorization|apiKeyEnv|endpoint/);
});

test('Files forms submit once, retain patch/error state through refresh and validate explicit context selection', async t => {
  const root = await fixture(t);
  await modelFixture(t, root, (_req, res) => answer(res, []));
  await analyzeChange(root, 'reset');
  const viewer = await startServer({ root, port: 0, quiet: true }); t.after(() => viewer.close());
  const { document, window } = parseHTML(await (await fetch(viewer.origin + '/?change=reset&view=studio&stage=implement')).text());
  const requests = [], navigation = [];
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  vm.runInNewContext(await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document, window, location: { protocol: 'http:', host: new URL(viewer.origin).host, assign: url => navigation.push(url), reload() {} },
    localStorage: { getItem() {}, setItem() {} }, WebSocket: class { addEventListener() {} }, setTimeout, clearTimeout,
    fetch: async (url, options) => { requests.push({ url, payload: JSON.parse(options.body), headers: options.headers }); await gate; return { ok: false, json: async () => ({ error: 'Patch conflicts. Keep the draft and retry.' }) }; }
  });
  const submit = node => node.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  submit(document.getElementById('model-preview-form'));
  assert.equal(requests.length, 0);
  assert.match(document.getElementById('source-preview-feedback').textContent, /Select between 1 and 12/);
  const patch = document.getElementById('source-preview-patch'); patch.value = 'retain this patch draft';
  patch.dispatchEvent(new window.Event('input', { bubbles: true }));
  const form = document.querySelector('[data-source-action="patch"]');
  submit(form); submit(form);
  assert.equal(requests.length, 1); assert.ok(requests[0].headers['X-CSRF-Token']);
  assert.equal(requests[0].payload.patch, 'retain this patch draft');
  assert.ok(form.querySelector('button').disabled);
  finish(); for (let i = 0; i < 15; i++) await Promise.resolve();
  assert.equal(form.querySelector('button').disabled, false);
  assert.match(document.getElementById('source-preview-feedback').textContent, /Patch conflicts/);
  patch.value = ''; document.getElementById('source-preview-feedback').textContent = '';
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(patch.value, 'retain this patch draft');
  assert.match(document.getElementById('source-preview-feedback').textContent, /Patch conflicts/);
  assert.deepEqual(navigation, []);
});
