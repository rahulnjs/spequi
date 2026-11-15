import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJSON, writeJSON, runtime, withLock } from './files.mjs';

const endpoints = ['https://data.rahulnjs.com/api/spequi/sub/events', 'https://sber.eval.best/spequi/event'];
const projects = new Map();
const diffFailures = new Set();
const run = promisify(execFile);

async function deliverEvent(body) {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(5000) });
      void response.body?.cancel().catch(() => {});
      if (response.ok) return;
    } catch {}
  }
}

export async function trackDiffFailure(root, previewId, reason) {
  const key = `${root}:${previewId}:${reason}`;
  if (diffFailures.has(key)) return;
  diffFailures.add(key);
  await trackEvent(root, 'file_diff_failed', { preview_id: previewId, reason });
}

export function initializeAnalytics(root) {
  if (process.env.SPEQUI_ANALYTICS_DISABLED === '1') return Promise.resolve(null);
  if (!projects.has(root)) projects.set(root, (async () => {
    const identityFile = path.join(os.homedir(), '.spequi', 'identity.json');
    const identity = await withLock(`${identityFile}.lock`, async () => {
      const saved = await readJSON(identityFile);
      if (saved?.user_id) return saved;
      const created = { user_id: randomUUID() };
      await writeJSON(identityFile, created);
      return created;
    });
    return withLock(runtime(root, 'analytics.lock'), async () => {
      const file = runtime(root, 'analytics.json');
      const saved = await readJSON(file);
      if (saved?.user_id === identity.user_id) return saved;
      const git = await run('git', ['config', 'user.name'], { cwd: root, timeout: 1000 }).catch(() => null);
      const metadata = { user_id: identity.user_id, git_user_name: git?.stdout.trim() || null };
      await writeJSON(file, metadata);
      return metadata;
    });
  })().catch(() => null));
  return projects.get(root);
}

export async function trackEvent(root, event, properties = {}) {
  if (process.env.SPEQUI_ANALYTICS_DISABLED === '1') return;
  if (!['project_used', 'spec_created', 'file_diff_viewed', 'request_failed', 'file_diff_failed'].includes(event)) return;
  try {
    const metadata = await initializeAnalytics(root);
    if (!metadata) return;
    const occurred_at = new Date().toISOString();
    if (event === 'project_used') {
      const firstUse = await withLock(runtime(root, 'analytics.lock'), async () => {
        const file = runtime(root, 'analytics.json'), saved = await readJSON(file);
        const day = occurred_at.slice(0, 10);
        if (saved?.last_used_day === day) return false;
        await writeJSON(file, { ...saved, last_used_day: day });
        return true;
      });
      if (!firstUse) return;
    }
    const agent = await readJSON(runtime(root, 'agent.json')).catch(() => null);
    const cli_name = agent?.agent && agent.agent !== 'Spequi Agent' ? agent.agent : null;
    const payload = { event, user_id: metadata.user_id, project_name: path.basename(root), git_user_name: metadata.git_user_name, cli_name, occurred_at, ...properties };
    // Finish local bookkeeping before returning; delivery tries the fallback only if the primary fails.
    void deliverEvent(JSON.stringify(payload));
  } catch {}
}
