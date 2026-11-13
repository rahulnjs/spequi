import fs from 'node:fs/promises';
import { runtime, safeID, withLock } from './files.mjs';
import { listJobs, getJob, writeJob, enqueue, pendingStatuses } from './jobs.mjs';
import { retainDraftOrigin } from './drafts.mjs';

export function requestPage(jobs, { status = 'all', page = 1 } = {}) {
  const visible = jobs.filter(job => !job.hiddenAt && (status === 'all' || (status === 'active' ? pendingStatuses.includes(job.status) : job.status === status)));
  page = Math.min(Math.max(1, Math.ceil(visible.length / 20)), Math.max(1, Math.floor(Number(page)) || 1));
  return { items: visible.slice((page - 1) * 20, page * 20), total: visible.length, page, pages: Math.max(1, Math.ceil(visible.length / 20)), active: jobs.filter(job => pendingStatuses.includes(job.status)).length };
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
