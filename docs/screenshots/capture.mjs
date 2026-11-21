// Regenerate documentation images with real headless Chrome and a disposable example project.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { initProject } from '../../src/project.mjs';
import { startServer } from '../../src/server.mjs';
import { writeJSON, runtime } from '../../src/files.mjs';
import { createPreview, freezePreview } from '../../src/previews.mjs';
import { artifactReviewID, addComment, documentHash } from '../../src/review-store.mjs';

const run = promisify(execFile);
const directory = fileURLToPath(new URL('./', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'spequi-screenshots-'));
const root = path.join(temp, 'example-project'), change = 'email-preferences';
const chromePath = process.argv[2] || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : process.platform === 'win32' ? path.join(process.env.PROGRAMFILES || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe') : 'google-chrome');
let server, chrome, socket;
const oldImages = new Map();
for (const name of ['build-light', 'build-dark', 'file-review-light', 'file-review-dark']) oldImages.set(name, await fs.readFile(path.join(directory, name + '.png')));
try {
  await fs.mkdir(root, { recursive: true });
  await initProject(root);
  await writeJSON(runtime(root, 'config.json'), { version: 1, port: 0, analytics: { enabled: false, shareIdentity: false } });
  const files = {
    '.npmrc': 'registry=http://127.0.0.1:9\n',
    'README.md': '# Example project\n\nDocumentation screenshot fixture.\n',
    'openspec/config.yaml': 'schema: spec-driven\n',
    [`openspec/changes/${change}/.openspec.yaml`]: 'schema: spec-driven\n',
    [`openspec/changes/${change}/proposal.md`]: '# Proposal\n\n## Why\n\nPeople should choose whether they receive product emails. New accounts currently receive them before making that choice.\n\n## What changes\n\n- Turn product emails off for new accounts.\n- Keep security notifications enabled.\n- Let people opt in from account settings.\n\n## Impact\n\nAccount preferences and notification scheduling.\n',
    [`openspec/changes/${change}/specs/email-preferences/spec.md`]: '## MODIFIED Requirements\n\n### Requirement: Product email opt-in\nProduct emails SHALL remain disabled until an account opts in.\n\n#### Scenario: New account\n- **WHEN** a new account opens settings\n- **THEN** optional product emails are disabled\n',
    [`openspec/changes/${change}/design.md`]: '# Design\n\nDefault product emails to false. Preserve explicit opt-ins and security notifications.\n',
    [`openspec/changes/${change}/tasks.md`]: '## Implementation\n\n- [ ] Default product emails to false\n- [ ] Preserve security notifications\n- [ ] Review the proposed changes\n',
    'src/preferences.mjs': 'export const productEmails = true;\nexport const securityEmails = true;\n'
  };
  for (const [file, content] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), content); }
  await run('git', ['init', '-b', 'feature/email-preferences'], { cwd: root });
  await run('git', ['remote', 'add', 'origin', 'https://example.invalid/team/example-project.git'], { cwd: root });
  const draft = randomUUID(), creation = randomUUID(), preview = randomUUID(), at = new Date().toISOString();
  await writeJSON(runtime(root, 'drafts', `${draft}.json`), { id: draft, change, creationId: creation, message: 'Make product emails opt-in for new accounts.', planMode: 'full', createdAt: at, updatedAt: at });
  await writeJSON(runtime(root, 'jobs', `${creation}.json`), { id: creation, action: 'start-plan', change, planMode: 'full', status: 'completed', createdAt: at, updatedAt: at, logs: [], result: 'Proposal, specs, design and tasks are ready for review.' });
  await writeJSON(runtime(root, 'jobs', `${preview}.json`), { id: preview, action: 'preview', change, status: 'completed', createdAt: at, updatedAt: at, logs: [], result: 'Ready for review.' });
  const work = await createPreview(root, preview);
  await fs.writeFile(path.join(work, 'src/preferences.mjs'), 'export const productEmails = false;\nexport const securityEmails = true;\n');
  await writeJSON(path.join(work, '.spequi/spec-links.json'), { version: 1, links: [{ file: 'src/preferences.mjs', side: 'proposed', start: 1, end: 1, spec: `openspec/changes/${change}/specs/email-preferences/spec.md`, specStart: 3, specEnd: 8 }] });
  await freezePreview(root, preview, { change });
  await addComment(root, preview, { file: 'src/preferences.mjs', body: 'The opt-in default matches the requirement. Keep security emails enabled.', side: 'proposed', start: 1, end: 1 });
  const proposal = `openspec/changes/${change}/proposal.md`;
  await addComment(root, artifactReviewID(change), { file: proposal, body: 'Keep existing opt-ins when changing the default for new accounts.', sourceHash: documentHash(files[proposal]) });
  server = await startServer({ root, port: 0, quiet: true, readinessCheck: async () => ({ schema: 'spec-driven', planningComplete: true, nextArtifact: null, applyState: 'ready', tasks: { total: 3, done: 0 }, checkedAt: at, artifacts: ['proposal', 'specs', 'design', 'tasks'].map(id => ({ id, status: 'done' })), artifactPaths: { specs: { existingOutputPaths: [path.join(root, `openspec/changes/${change}/specs/email-preferences/spec.md`)] } } }) });
  await fetch(server.origin + `/?view=studio&change=${change}&draft=${draft}`);
  const profile = path.join(temp, 'chrome');
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let chromeError;
  chrome.on('error', error => { chromeError = error; });
  let port;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (chromeError) throw chromeError;
    const active = await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    if (active) { port = Number(active.split('\n')[0]); break; }
    await delay(100);
  }
  if (!port) throw new Error('Headless Chrome did not start');
  const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  let sequence = 0;
  const pending = new Map(), pageErrors = [];
  socket.on('message', data => { const message = JSON.parse(data); if (message.method === 'Runtime.exceptionThrown') pageErrors.push(message.params.exceptionDetails.text); if (message.id) { const task = pending.get(message.id); pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); } });
  const command = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  await command('Page.enable'); await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });
  async function capture(name, url, theme, prepare = '') {
    await command('Page.navigate', { url: server.origin + url });
    for (let i = 0; i < 80; i++) { if (await evaluate(`location.href === ${JSON.stringify(server.origin + url)} && document.readyState === 'complete' && Boolean(document.getElementById('workspace'))`)) break; await delay(100); }
    await evaluate('document.fonts.ready.then(() => true)');
    await delay(500);
    await evaluate(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.getElementById('theme-toggle').click()`);
    if (prepare) await evaluate(prepare);
    await delay(200);
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(directory, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log(name + '.png');
  }
  for (const theme of ['enterprise', 'dark']) {
    const suffix = theme === 'dark' ? 'dark' : 'light';
    await capture(`build-${suffix}`, `/?view=studio&change=${change}&draft=${draft}&plan=proposal.md`, theme);
    await capture(`file-review-${suffix}`, `/?change=${change}&view=preview&job=${preview}&file=src/preferences.mjs`, theme);
    await capture(`workflow-${suffix}`, `/?change=${change}&view=workflow`, theme, `document.getElementById('plan-publish').open = true`);
    await capture(`settings-${suffix}`, `/?change=${change}&doc=${proposal}&view=rendered`, theme, `document.querySelector('[data-privacy-toggle]').click()`);
  }
  if (pageErrors.length) throw new Error(`Browser reported: ${[...new Set(pageErrors)].join(', ')}`);
  const publicFile = new URL('../../public/index.html', import.meta.url);
  let html = await fs.readFile(publicFile, 'utf8');
  for (const [name, old] of oldImages) html = html.replaceAll(old.toString('base64'), (await fs.readFile(path.join(directory, name + '.png'))).toString('base64'));
  await fs.writeFile(publicFile, html);
} finally {
  socket?.close();
  chrome?.kill('SIGTERM');
  if (server) await server.close();
  await delay(200);
  await fs.rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
