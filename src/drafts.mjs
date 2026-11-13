import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runtime, readJSON, writeJSON, withLock, safeID, within } from './files.mjs';
import { listJobs, pendingStatuses } from './jobs.mjs';

const file = (root, id) => runtime(root, 'drafts', `${safeID(id)}.json`);
export async function listDrafts(root) {
  const names = await fs.readdir(runtime(root, 'drafts')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const drafts = await Promise.all(names.filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name)).map(name => readJSON(runtime(root, 'drafts', name))));
  return drafts.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function saveDraft(root, { id = randomUUID(), change = '', message = '', planMode = 'next' }) {
  safeID(id);
  if (typeof change !== 'string' || change.length > 80 || typeof message !== 'string' || message.length > 12000 || !['next', 'full'].includes(planMode)) throw new Error('Invalid planning draft');
  return withLock(runtime(root, `draft-${id}.lock`), async () => {
    const previous = await readJSON(file(root, id));
    if (previous?.creationId) throw new Error('This idea was submitted. Continue from its planning workspace.');
    const draft = { id, createdAt: previous?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), change, message, planMode };
    await writeJSON(file(root, id), draft);
    return draft;
  });
}
export async function submitDraft(root, id, create) {
  return withLock(runtime(root, `draft-${safeID(id)}.lock`), async () => {
    const draft = await readJSON(file(root, id));
    if (!draft) throw new Error('The draft was deleted. Start a new idea.');
    if (draft.creationId) {
      const job = (await listJobs(root)).find(job => job.id === draft.creationId);
      if (job) return job;
    }
    const job = await create();
    await writeJSON(file(root, id), { ...draft, creationId: job.id, change: job.change, message: job.message, planMode: job.planMode, updatedAt: new Date().toISOString() });
    return job;
  });
}
export async function resumeDraft(root, id) {
  return withLock(runtime(root, `draft-${safeID(id)}.lock`), async () => {
    const draft = await readJSON(file(root, id));
    if (!draft) throw new Error('Draft not found');
    if ((await listJobs(root)).some(job => job.change === draft.change && pendingStatuses.includes(job.status))) throw new Error('Finish or cancel the active request before resuming this draft.');
    const hasPlan = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(draft.change) && await fs.stat(await within(root, `openspec/changes/${draft.change}`)).then(stat => stat.isDirectory(), error => { if (error.code === 'ENOENT') return false; throw error; });
    if (hasPlan) return { url: `/?${new URLSearchParams({ change: draft.change, view: 'studio', draft: id })}` };
    const { creationId, planningClaimed, ...idea } = draft;
    await writeJSON(file(root, id), { ...idea, updatedAt: new Date().toISOString() });
    return { url: `/?${new URLSearchParams({ view: 'studio', new: '1', draft: id })}` };
  });
}
export async function finishDrafts(root, change) {
  for (const draft of await listDrafts(root)) if (draft.change === change && draft.creationId) {
    await withLock(runtime(root, `draft-${draft.id}.lock`), () => fs.rm(file(root, draft.id), { force: true }));
  }
}
export async function retainDraftOrigin(root, job) {
  if (job.action !== 'start-plan') return;
  for (const draft of await listDrafts(root)) if (draft.creationId === job.id) {
    await withLock(runtime(root, `draft-${draft.id}.lock`), async () => {
      const current = await readJSON(file(root, draft.id));
      if (current?.creationId !== job.id) return;
      const hasPlan = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(current.change) && await fs.stat(await within(root, `openspec/changes/${current.change}`)).then(stat => stat.isDirectory(), error => { if (error.code === 'ENOENT') return false; throw error; });
      if (!hasPlan) {
        const { creationId, planningClaimed, ...idea } = current;
        await writeJSON(file(root, draft.id), idea);
      } else if (job.workflow) await writeJSON(file(root, draft.id), { ...current, planningClaimed: true });
    });
  }
}
export async function deleteDraft(root, id, { deletePlan = false } = {}) {
  if (typeof deletePlan !== 'boolean') throw new Error('Choose whether to delete generated planning files');
  return withLock(runtime(root, `draft-${safeID(id)}.lock`), async () => {
    const draft = await readJSON(file(root, id));
    if (!draft) throw new Error('Draft not found');
    const jobs = await listJobs(root);
    if (jobs.some(job => job.change === draft.change && pendingStatuses.includes(job.status))) throw new Error('Finish or cancel the active request before deleting this draft.');
    if (deletePlan) {
      const creation = jobs.find(job => job.id === draft.creationId && job.action === 'start-plan' && job.change === draft.change);
      if ((!creation?.workflow && !draft.planningClaimed) || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(draft.change)) throw new Error('Only planning files created from this draft can be deleted.');
      if (jobs.some(job => job.change === draft.change && job.action === 'preview' && job.status === 'completed')) throw new Error('This change has an implementation preview. Keep its planning files and remove only the draft entry.');
      await fs.rm(await within(root, `openspec/changes/${draft.change}`), { recursive: true, force: true });
    }
    await fs.rm(file(root, id), { force: true });
    return { deleted: true };
  });
}
