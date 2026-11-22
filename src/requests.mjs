import fs from 'node:fs/promises';
import { runtime, safeID, withLock, readJSON, writeJSON } from './files.mjs';
import { listJobs, getJob, writeJob, enqueue, pendingStatuses } from './jobs.mjs';
import { retainDraftOrigin } from './drafts.mjs';

const groupKey = job => job.change ? `change:${job.change.replace(/^\d{4}-\d{2}-\d{2}-/, '')}` : `request:${job.id}`;
const updated = job => job.updatedAt || job.createdAt || '';
const newest = (a, b) => updated(b).localeCompare(updated(a)) || b.id.localeCompare(a.id);
export async function inboxState(root) { return (await readJSON(runtime(root, 'request-inbox.json')))?.dismissed || {}; }

export function requestPage(jobs, { status = 'inbox', page = 1 } = {}, { agent, dismissed = {} } = {}) {
  if (status === 'inbox') {
    const groups = new Map();
    for (const job of jobs.filter(job => !job.hiddenAt)) {
      const key = groupKey(job);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(job);
    }
    const items = [], recent = [];
    for (const [key, history] of groups) {
      const retries = new Set(history.map(item => item.requestKey).filter(Boolean));
      const eligible = history.filter(job => (pendingStatuses.includes(job.status) || updated(job) > (dismissed[key] || '')) && !(job.status === 'failed' && retries.has(`retry-${job.id}`)));
      const stalled = job => job.status === 'running' && agent?.queue?.active?.id === job.id && !agent.queue.active.ownerConnected;
      const priority = job => job.id === agent?.queue?.active?.id ? -1 : job.status === 'awaiting-input' ? 0 : stalled(job) ? 1 : job.status === 'failed' ? 2 : job.status === 'running' ? 3 : 4;
      const ongoing = eligible.filter(job => pendingStatuses.includes(job.status) || job.status === 'failed').sort((a, b) => priority(a) - priority(b) || newest(a, b));
      const completed = eligible.filter(job => job.status === 'completed').sort(newest);
      const job = ongoing[0] || completed[0];
      if (!job) continue;
      const entry = { ...job, groupKey: key, groupCount: history.length, dismissThrough: history.reduce((latest, item) => updated(item) > latest ? updated(item) : latest, ''), stalled: Boolean(stalled(job)), needsAttention: ongoing.some(item => ['awaiting-input', 'failed'].includes(item.status) || stalled(item)) };
      if (ongoing.length) items.push(entry); else recent.push(entry);
    }
    items.sort((a, b) => (a.status === 'awaiting-input' ? 0 : a.needsAttention ? 1 : a.status === 'running' ? 2 : 3) - (b.status === 'awaiting-input' ? 0 : b.needsAttention ? 1 : b.status === 'running' ? 2 : 3) || newest(a, b));
    recent.sort(newest);
    page = Math.min(Math.max(1, Math.ceil(items.length / 20)), Math.max(1, Math.floor(Number(page)) || 1));
    return { items: items.slice((page - 1) * 20, page * 20), recent: page === 1 ? recent.slice(0, 5) : [], total: items.length, attention: items.filter(item => item.needsAttention).length, historyTotal: jobs.filter(job => !job.hiddenAt).length, page, pages: Math.max(1, Math.ceil(items.length / 20)) };
  }
  const visible = jobs.filter(job => !job.hiddenAt && (status === 'all' || (status === 'active' ? pendingStatuses.includes(job.status) : job.status === status)));
  page = Math.min(Math.max(1, Math.ceil(visible.length / 20)), Math.max(1, Math.floor(Number(page)) || 1));
  return { items: visible.slice((page - 1) * 20, page * 20), total: visible.length, page, pages: Math.max(1, Math.ceil(visible.length / 20)), active: jobs.filter(job => pendingStatuses.includes(job.status)).length };
}
export async function dismissRequest(root, id, { through } = {}) {
  safeID(id);
  return withLock(runtime(root, 'request-inbox.lock'), async () => {
    const job = await getJob(root, id);
    if (!['completed', 'failed', 'cancelled'].includes(job.status) || job.hiddenAt) throw new Error('Only a settled request can be dismissed. Finish or cancel active work first.');
    const key = groupKey(job), history = (await listJobs(root)).filter(item => !item.hiddenAt && groupKey(item) === key);
    through ||= updated(job);
    if (typeof through !== 'string' || !Number.isFinite(Date.parse(through)) || !history.some(item => updated(item) === through)) throw new Error('The inbox changed. Refresh it before dismissing this entry.');
    const dismissed = await inboxState(root);
    dismissed[key] = [dismissed[key] || '', through].sort().at(-1);
    await writeJSON(runtime(root, 'request-inbox.json'), { version: 1, dismissed });
    return { dismissed: true };
  });
}
export async function deleteRequest(root, id, { reviewData = true } = {}) {
  safeID(id);
  if (typeof reviewData !== 'boolean') throw new Error('Choose whether to delete the associated review data');
  return withLock(runtime(root, 'review-requests.lock'), () => withLock(runtime(root, `job-${id}.lock`), async () => {
    const job = await getJob(root, id);
    if (pendingStatuses.includes(job.status)) throw new Error('Finish or cancel this request before deleting it.');
    if (reviewData) {
      const dependent = (await listJobs(root)).find(item => item.id !== id && !item.hiddenAt && item.reviewPreview === id);
      if (dependent) throw new Error('Another retained request uses this preview. Remove that request first, or keep the review data.');
      // Applying has its own lock. Never remove a snapshot while it is being applied.
      await withLock(runtime(root, 'apply.lock'), async () => {
        await retainDraftOrigin(root, job);
        for (const folder of ['previews', 'reviews', 'analyses']) await fs.rm(runtime(root, folder, id), { recursive: true, force: true });
        await fs.rm(runtime(root, 'impact', `${id}.md`), { force: true });
        await fs.rm(runtime(root, 'jobs', `${id}.json`), { force: true });
      });
    } else await writeJob(root, { ...job, hiddenAt: new Date().toISOString() });
    return { deleted: true };
  }));
}
export async function retryRequest(root, id) {
  const job = await getJob(root, id);
  if (!['failed', 'cancelled'].includes(job.status)) throw new Error('Only failed or cancelled requests can be retried');
  if (!['explore', 'preview', 'verify', 'impact'].includes(job.action)) throw new Error('Open the change and review its partial planning work before continuing.');
  return enqueue(root, { action: job.action, change: job.change, message: job.message, reviewPreview: job.reviewPreview, reviewFile: job.reviewFile, requestKey: `retry-${job.id}` });
}
