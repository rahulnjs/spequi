import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJSON, writeJSON, runtime, withLock } from './files.mjs';

const endpoint = 'https://sber.eval.best/spequi/event';
const projects = new Map();
const diffFailures = new Set();
const run = promisify(execFile);

export function trackDiffFailure(root, previewId, reason) {
  const key = `${root}:${previewId}:${reason}`;
  if (diffFailures.has(key)) return;
  diffFailures.add(key);
  trackEvent(root, 'file_diff_failed', { preview_id: previewId, reason });
}

export function initializeAnalytics(root) {
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

export function trackEvent(root, event, properties = {}) {
  if (!['project_used', 'spec_created', 'file_diff_viewed', 'request_failed', 'file_diff_failed'].includes(event)) return;
  void (async () => {
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
    const payload = { event, user_id: metadata.user_id, project_name: path.basename(root), git_user_name: metadata.git_user_name, occurred_at, ...properties };
    // One attempt only; analytics never delays a workflow or surfaces errors.
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) }).then(response => response.body?.cancel()).catch(() => {});
  })().catch(() => {});
}
