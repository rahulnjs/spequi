import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { diffLines } from 'diff';
import { inventory, readArtifact, jobMatchesChange } from './specs.mjs';
import { readJSON, writeJSON, within, withLock } from './files.mjs';

export const planningActions = new Set(['start-plan', 'propose', 'plan-next', 'revise-plan', 'update-specs']);
const digest = value => createHash('sha256').update(value).digest('hex');
const canonical = selected => selected.archived && /^\d{4}-\d{2}-\d{2}-/.test(selected.id) ? selected.id.slice(11) : selected.id;
async function directory(root, selected) { return within(root, `.spequi/studio/${digest(canonical(selected))}`); }
async function locked(file, action) {
  for (let attempt = 0; ; attempt++) {
    try { return await withLock(file, action); }
    catch (error) { if (attempt >= 30 || !error.message.startsWith('Another operation')) throw error; await delay(25); }
  }
}

export async function capturePlan(root, change, reason = 'Working plan') {
  const selected = typeof change === 'string' ? (await inventory(root)).changes.find(item => item.id === change) : change;
  if (!selected) return null;
  const folder = await directory(root, selected);
  await fs.mkdir(folder, { recursive: true });
  return locked(`${folder}/capture.lock`, async () => {
    const prefix = `openspec/changes/${selected.archived ? 'archive/' : ''}${selected.id}/`;
    const documents = {};
    let bytes = 0;
    for (const file of [...selected.files].sort()) {
      if (!file.startsWith(prefix)) throw new Error('Planning document is outside this change');
      const text = await readArtifact(root, file);
      bytes += Buffer.byteLength(text);
      if (bytes > 8 * 1024 * 1024) throw new Error('Plan history supports up to 8 MiB of planning documents per revision.');
      documents[file.slice(prefix.length)] = text;
    }
    const hash = digest(JSON.stringify(documents));
    const indexFile = await within(root, `.spequi/studio/${digest(canonical(selected))}/history.json`);
    const index = await readJSON(indexFile, { entries: [] });
    if (index.entries.at(-1)?.hash === hash) return index.entries.at(-1);
    const entry = { version: (index.entries.at(-1)?.version || 0) + 1, hash, at: new Date().toISOString(), reason };
    const snapshot = await within(root, `.spequi/studio/${digest(canonical(selected))}/${hash}.json`);
    await writeJSON(snapshot, { documents });
    index.entries.push(entry); index.entries = index.entries.slice(-40);
    await writeJSON(indexFile, index);
    const retained = new Set(index.entries.map(item => `${item.hash}.json`));
    for (const file of await fs.readdir(folder)) if (/^[a-f0-9]{64}\.json$/.test(file) && !retained.has(file)) await fs.unlink(`${folder}/${file}`);
    return entry;
  });
}

export async function planVersions(root, selected, jobs = []) {
  const relevant = jobs.filter(job => jobMatchesChange(job, selected) && planningActions.has(job.action));
  const pending = relevant.find(job => ['queued', 'running', 'awaiting-input'].includes(job.status));
  const failed = relevant[0]?.status === 'failed';
  const folder = await directory(root, selected);
  let index = await readJSON(`${folder}/history.json`, { entries: [] });
  // Do not turn intermediate agent writes into completed document revisions.
  if (!pending || !index.entries.length) {
    await capturePlan(root, selected, failed ? 'Working plan after a failed request' : 'Working plan');
    index = await readJSON(`${folder}/history.json`, { entries: [] });
  }
  const load = async entry => entry ? { ...entry, ...(await readJSON(await within(root, `.spequi/studio/${digest(canonical(selected))}/${entry.hash}.json`))) } : null;
  return { current: await load(index.entries.at(-1)), previous: await load(index.entries.at(-2)), entries: index.entries, pending, failed };
}

export function planChanges(previous = {}, current = {}) {
  return [...new Set([...Object.keys(previous), ...Object.keys(current)])].sort().flatMap(file => {
    if (previous[file] === current[file]) return [];
    const parts = diffLines(previous[file] || '', current[file] || '');
    return [{ file, type: !(file in previous) ? 'added' : !(file in current) ? 'removed' : 'modified', additions: parts.filter(part => part.added).reduce((n, part) => n + part.count, 0), deletions: parts.filter(part => part.removed).reduce((n, part) => n + part.count, 0) }];
  });
}
