import http from 'node:http';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { WebSocketServer, WebSocket } from 'ws';
import chokidar from 'chokidar';
import { exists, readJSON, runtime, isPreviewSnapshotPath } from './files.mjs';
import { inventory, readArtifact, escape } from './specs.mjs';
import { listJobs, enqueue, updateJob, agentStatus, getJob, pendingStatuses } from './jobs.mjs';
import { applyPreview, previewResult } from './previews.mjs';
import { workspace, shell } from './views.mjs';
import { addComment, deleteComment, exportFeedback, feedbackExport } from './review-store.mjs';
import { analyzeChange } from './spec-impact.mjs';
import { directPreview } from './direct-preview.mjs';
import { requestLifecycle, previewPlanChanged } from './lifecycle.mjs';
import { requestCommand } from './commands.mjs';
import { answerJob } from './job-dialogue.mjs';

const require = createRequire(import.meta.url);
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
function tokenMatches(actual, expected) { return typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected)); }
async function body(request, limit = 100000) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error('Request body is too large'); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8');
  return request.headers['content-type']?.includes('application/json') ? JSON.parse(text) : Object.fromEntries(new URLSearchParams(text));
}
export async function startServer({ root = process.cwd(), port, quiet = false } = {}) {
  root = await fs.realpath(root);
  if (!await exists(runtime(root, 'config.json'))) throw new Error('Run spequi init in this project first');
  const config = await readJSON(runtime(root, 'config.json'));
  const selectedPort = port ?? config.port ?? 4310;
  if (!Number.isInteger(selectedPort) || selectedPort < 0 || selectedPort > 65535) throw new Error('Port must be an integer from 0 to 65535');
  const csrf = randomBytes(32).toString('hex');
  let origin;
  const send = (response, status, content, type = 'text/html; charset=utf-8', headers = {}) => {
    response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers }); response.end(content);
  };
  const server = http.createServer(async (request, response) => {
    try {
      const allowedHosts = [new URL(origin).host, `localhost:${server.address().port}`];
      if (!allowedHosts.includes(request.headers.host)) return send(response, 403, 'Invalid local host');
      const url = new URL(request.url, origin);
      if (request.method === 'GET') {
        if (['/assets/fonts.css', '/assets/app.css', '/assets/diff.css', '/assets/app.js', '/assets/review.css', '/assets/review.js', '/assets/lifecycle.css', '/assets/lifecycle.js', '/assets/studio.css', '/assets/studio.js', '/assets/session.js'].includes(url.pathname)) {
          const file = path.join(publicDir, path.basename(url.pathname));
          return send(response, 200, await fs.readFile(file), url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
        }
        const fontMatch = url.pathname.match(/^\/assets\/fonts\/([a-z0-9-]+\.woff2)$/);
        if (fontMatch) {
          const content = await fs.readFile(path.join(publicDir, 'fonts', fontMatch[1])).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          return content ? send(response, 200, content, 'font/woff2') : send(response, 404, 'Font not found');
        }
        if (url.pathname === '/vendor/htmx.js') return send(response, 200, await fs.readFile(require.resolve('htmx.org/dist/htmx.min.js')), 'text/javascript');
        if (url.pathname === '/favicon.svg') return send(response, 200, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3f62b5"/><path d="m6 11 10-6 10 6-10 6-10-6Zm0 6 10 6 10-6m-20 6 10 6 10-6" fill="none" stroke="#f3f5fb" stroke-width="2"/></svg>', 'image/svg+xml');
        if (url.pathname === '/api/raw') return send(response, 200, await readArtifact(root, url.searchParams.get('file') || ''), 'text/plain; charset=utf-8');
        if (url.pathname === '/api/state') {
          const data = await inventory(root);
          return send(response, 200, JSON.stringify({ data, jobs: (await listJobs(root)).map(({ claimToken, instructions, ...job }) => job), agent: await agentStatus(root) }), 'application/json');
        }
        if (url.pathname === '/api/agent-status') return send(response, 200, JSON.stringify(await agentStatus(root)), 'application/json');
        const feedbackMatch = url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)\/feedback\/([a-zA-Z0-9_-]+)$/);
        if (feedbackMatch) {
          const exported = await feedbackExport(root, feedbackMatch[1], feedbackMatch[2]);
          return send(response, 200, exported.document, 'text/markdown; charset=utf-8', { 'Content-Disposition': 'attachment; filename="openspec-review-feedback.md"' });
        }
        const patchMatch = url.pathname.match(/^\/api\/previews\/([a-zA-Z0-9_-]+)\/patch$/);
        if (patchMatch) {
          const result = await previewResult(root, patchMatch[1]);
          if (!result) return send(response, 404, 'Preview not found');
          return send(response, 200, result.changes.map(change => change.patch).join('\n'), 'text/plain; charset=utf-8', { 'Content-Disposition': 'attachment; filename="preview.patch"' });
        }
        if (url.pathname !== '/') return send(response, 404, 'Page not found');
        const [data, jobs, agent] = await Promise.all([inventory(root), listJobs(root), agentStatus(root)]);
        const content = await workspace({ root, data, params: Object.fromEntries(url.searchParams), jobs, agent });
        return send(response, 200, request.headers['hx-request'] ? content : shell(content, data, csrf, Object.fromEntries(url.searchParams)), 'text/html; charset=utf-8', {
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        });
      }
      if (request.method !== 'POST') return send(response, 405, 'Method not allowed');
      if (![origin, `http://localhost:${server.address().port}`].includes(request.headers.origin) || !tokenMatches(request.headers['x-csrf-token'], csrf)) return send(response, 403, '<p class="error-message">Local session verification failed. Reload the viewer and retry.</p>');
      const payload = await body(request, url.pathname.startsWith('/api/source-preview/') ? 2 * 1024 * 1024 : 100000);
      if (['/api/lifecycle/actions', '/api/lifecycle/command'].includes(url.pathname)) {
        const { job, ...result } = await (url.pathname.endsWith('/command') ? requestCommand(root,payload) : requestLifecycle(root, payload));
        return send(response, job ? 201 : 200, JSON.stringify({ ...result, ...(job ? { job: { id: job.id, action: job.action, change: job.change, status: job.status } } : {}) }), 'application/json', { 'HX-Trigger': 'workspace-updated' });
      }
      const replyMatch = url.pathname.match(/^\/api\/lifecycle\/jobs\/([a-zA-Z0-9_-]+)\/reply$/);
      if (replyMatch) return send(response, 200, JSON.stringify(await answerJob(root, replyMatch[1], payload)), 'application/json', { 'HX-Trigger': 'workspace-updated' });
      const sourceAction = url.pathname.match(/^\/api\/source-preview\/(analyze|patch|model)$/)?.[1];
      if (sourceAction) {
        if (sourceAction === 'analyze') {
          const analysis = await analyzeChange(root, payload.change);
          return send(response, 201, JSON.stringify({ analysis }), 'application/json', { 'HX-Trigger': 'workspace-updated' });
        }
        const { job } = await directPreview(root, { ...payload, kind: sourceAction });
        const query = new URLSearchParams({ change: job.change, view: 'preview', job: job.id });
        return send(response, 201, JSON.stringify({ job: { id: job.id, change: job.change, origin: job.origin, status: job.status }, url: `/?${query}` }), 'application/json', { 'HX-Trigger': 'workspace-updated' });
      }
      const reviewMatch = url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)\/(comments|export|update-specs|impact)$/);
      if (reviewMatch) {
        const [, preview, action] = reviewMatch;
        if (action === 'comments') {
          const comment = await addComment(root, preview, payload);
          if (request.headers.accept?.includes('application/json')) return send(response, 201, JSON.stringify({ comment }), 'application/json');
          return send(response, 201, '<p class="success-message">Comment saved.</p>', undefined, { 'HX-Trigger': JSON.stringify({ 'review-saved': { preview, file: payload.file }, 'workspace-updated': true }) });
        }
        if (action === 'impact') {
          await enqueue(root, { action: 'impact', reviewPreview: preview, reviewFile: payload.file });
          return send(response, 201, '<p class="success-message">Impact analysis queued for your attached agent.</p>', undefined, { 'HX-Trigger': 'workspace-updated' });
        }
        const exported = await exportFeedback(root, preview);
        const update = action === 'update-specs' ? await enqueue(root, { action: 'update-specs', reviewPreview: preview, feedbackId: exported.id }) : null;
        const downloadUrl = `/api/reviews/${preview}/feedback/${exported.id}`;
        if (request.headers.accept?.includes('application/json')) return send(response, 201, JSON.stringify({ exported: { ...exported, downloadUrl }, ...(update ? { update: { id: update.id, change: update.change, status: update.status, reviewPreview: update.reviewPreview, feedbackId: update.feedbackId } } : {}) }), 'application/json');
        return send(response, 201, `<p class="success-message">${action === 'update-specs' ? 'OpenSpec planning update queued using this feedback document.' : 'Feedback document saved.'} <a href="${downloadUrl}" download="openspec-review-feedback.md">Download Markdown</a></p>`, undefined, { 'HX-Trigger': 'workspace-updated' });
      }
      const deleteMatch = url.pathname.match(/^\/api\/reviews\/([a-zA-Z0-9_-]+)\/comments\/([a-zA-Z0-9_-]+)\/delete$/);
      if (deleteMatch) {
        const deleted = await deleteComment(root, deleteMatch[1], deleteMatch[2]);
        if (request.headers.accept?.includes('application/json')) return send(response, 200, JSON.stringify({ deleted }), 'application/json');
        return send(response, 200, '<p class="success-message">Comment removed.</p>', undefined, { 'HX-Trigger': 'workspace-updated' });
      }
      if (url.pathname === '/api/jobs') {
        const job = await enqueue(root, payload);
        return send(response, 201, `<p class="success-message">${escape(job.action === 'preview' ? 'Preview' : 'Workflow')} queued. Your agent will pick it up.</p>`, undefined, { 'HX-Trigger': 'workspace-updated' });
      }
      const cancelMatch = url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)\/cancel$/);
      if (cancelMatch) {
        await updateJob(root, cancelMatch[1], null, 'cancel', 'Cancelled in viewer');
        return send(response, 200, request.headers.accept?.includes('application/json') ? JSON.stringify({ cancelled: true }) : '<p>Request cancelled.</p>', request.headers.accept?.includes('application/json') ? 'application/json' : undefined, { 'HX-Trigger': 'workspace-updated' });
      }
      const applyMatch = url.pathname.match(/^\/api\/previews\/([a-zA-Z0-9_-]+)\/apply$/);
      if (applyMatch) {
        const job = await getJob(root, applyMatch[1]);
        const selected = (await inventory(root)).changes.find(change => change.id === job.change && !change.archived);
        if (!selected) throw new Error('Only active changes can apply implementation previews.');
        if ((await listJobs(root)).some(item => item.change === job.change && pendingStatuses.includes(item.status))) throw new Error('Wait for the current request to finish before applying.');
        if (await previewPlanChanged(root, selected, job, await previewResult(root, job.id))) throw new Error('The spec changed. Generate a fresh code preview before applying.');
        await applyPreview(root, applyMatch[1]);
        return send(response, 200, '<p class="success-message">Code changes applied to your project. <a href="/?change=' + encodeURIComponent(job.change) + '&amp;view=studio&amp;stage=finish">Continue in Build</a></p>', undefined, { 'HX-Trigger': 'workspace-updated' });
      }
      return send(response, 404, 'Action not found');
    } catch (error) {
      if (!response.headersSent) {
        if (request.headers.accept?.includes('application/json')) send(response, 400, JSON.stringify({ error: error.message }), 'application/json');
        else send(response, 400, `<p class="error-message">${escape(error.message)}</p>`);
      }
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(selectedPort, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (request, socket, head) => {
    const allowedOrigins = [origin, `http://localhost:${server.address().port}`];
    if (request.url !== '/live' || !allowedOrigins.includes(request.headers.origin) || ![new URL(origin).host, `localhost:${server.address().port}`].includes(request.headers.host)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, connection => { connection.on('error', () => {}); connection.send(JSON.stringify({ type: 'connected' })); });
  });
  const broadcast = type => { for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type })); };
  let timer;
  const watcher = chokidar.watch([path.join(root, 'openspec'), runtime(root, 'jobs'), runtime(root, 'agent.json'), runtime(root, 'agent-session.json'), runtime(root, 'previews'), runtime(root, 'reviews'), runtime(root, 'analyses'), runtime(root, 'validation'), runtime(root, 'studio')], { ignoreInitial: true, ignored: file => isPreviewSnapshotPath(file) || file.startsWith(runtime(root, 'studio') + path.sep) && (file.endsWith('capture.lock') || file.endsWith('.tmp')), depth: 12, awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 } });
  watcher.on('all', (_event, watched) => {
    if ([runtime(root, 'agent.json'), runtime(root, 'agent-session.json')].includes(watched)) { broadcast('agent'); return; }
    clearTimeout(timer); timer = setTimeout(() => broadcast('changed'), 200);
  });
  watcher.on('error', error => { if (!quiet) process.stderr.write(`File watching: ${error.message}\n`); });
  const interval = setInterval(() => broadcast('heartbeat'), 15000);
  interval.unref();
  if (!quiet) process.stdout.write(`\n  spequi\n  ${origin}\n  Project: ${root}\n\n  Attach the spequi skill in your agent to handle workflows.\n  Press Ctrl+C to stop.\n\n`);
  const close = async () => { clearInterval(interval); clearTimeout(timer); await watcher.close(); for (const client of wss.clients) client.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); };
  return { server, origin, close };
}
