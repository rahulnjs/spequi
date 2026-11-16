import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inventory, readArtifact, jobMatchesChange } from './specs.mjs';
import { localReadiness, openspecJSON } from './openspec-cli.mjs';
import { listJobs, enqueue, pendingStatuses } from './jobs.mjs';
import { previewResult } from './previews.mjs';
import { runtime, readJSON, writeJSON, within, withLock } from './files.mjs';
import { submitDraft, finishDrafts } from './drafts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const validationPath = (root, change) => runtime(root, 'validation', `${hash(change)}.json`);
export async function previewPlanChanged(root, selected, preview, result) {
  if (!preview || !result || selected.archived) return false;
  const manifest = await readJSON(runtime(root, 'previews', preview.id, 'manifest.json'));
  if (!manifest) return true;
  const prefix = `openspec/changes/${selected.id}/`;
  const expected = new Map(Object.entries(manifest).filter(([file]) => file.startsWith(prefix) && file.endsWith('.md')).map(([file, entry]) => [file, entry.hash]));
  if (result.applied) for (const change of [...result.changes, ...(result.taskUpdates || [])]) if (change.file.startsWith(prefix) && change.file.endsWith('.md')) {
    if (change.afterHash) expected.set(change.file, change.afterHash); else expected.delete(change.file);
  }
  if (expected.size !== selected.files.length) return true;
  for (const file of selected.files) if (expected.get(file) !== hash(await readArtifact(root, file))) return true;
  return false;
}

async function fingerprint(root, selected) {
  const files = [];
  for (const file of selected.files) files.push([file, hash(await readArtifact(root, file))]);
  return hash(JSON.stringify(files));
}

export function lifecycleActions({ selected, readiness, error, pending, preview, result, previewStale }) {
  const actions = {};
  const add = (action, label, reason = '') => { actions[action] = { action, label, enabled: !reason, reason }; };
  const common = selected?.archived ? 'This change is archived.' : pending ? 'Finish or cancel the current workflow first.' : error || (!readiness ? 'Checking OpenSpec readiness…' : '');
  const planning = !readiness?.planningComplete ? 'Complete the required planning artifacts first.' : '';
  const complete = readiness && readiness.tasks.done === readiness.tasks.total;
  add('refresh', 'Refresh readiness', selected?.archived ? 'This change is archived.' : '');
  add('explore', 'Explore this change', common);
  add('plan-next', 'Create next artifact', common || (!readiness?.nextArtifact ? 'No planning artifact is ready. Existing artifacts can be revised below.' : ''));
  add('propose', 'Generate full plan', common || (readiness?.planningComplete ? 'The plan already exists. Request a revision instead.' : ''));
  add('revise-plan', 'Request a plan revision', common || (!selected?.files.length ? 'Create the first planning artifact before revising it.' : ''));
  add('finish-planning', 'Finish planning', common || planning);
  add('preview', 'Generate implementation', common || planning || (readiness?.applyState !== 'ready' ? complete ? 'All tracked tasks are checked. Review existing work or revise the plan.' : 'The schema is not ready for implementation.' : ''));
  add('apply', result?.applied ? 'Changes applied' : 'Apply changes', selected?.archived ? 'This change is archived.' : !result?.changes.length ? 'No proposed file changes to apply.' : result.applied ? 'This preview was already applied.' : previewStale ? 'The spec changed. Generate a fresh code preview before applying.' : result.unsupported.length ? 'The preview contains unsupported files.' : pending ? 'Finish the current workflow first.' : '');
  add('verify', 'Verify implementation', common || planning || (!result?.applied && !complete ? 'Apply a reviewed preview or finish the tracked implementation first.' : ''));
  add('validate', 'Validate specification', selected?.archived ? 'This change is archived.' : error || '');
  const deltas = readiness?.artifactPaths?.specs?.existingOutputPaths?.length || 0;
  add('sync-specs', 'Sync specifications', common || (!deltas ? 'No delta specifications are available to sync.' : ''));
  add('archive', 'Archive change', common || planning || (!complete ? 'Tracked tasks are incomplete. An archive exception requires workflow confirmation.' : ''));
  add('archive-override', 'Request archive exception', common || (!planning && complete ? 'Use the normal archive action for completed work.' : ''));
  return actions;
}

export async function lifecycleState(root, change = '', { jobs, selected, getReadiness = localReadiness } = {}) {
  jobs ||= await listJobs(root);
  if (!change) return { selected: null, jobs: jobs.filter(job => !job.change || ['create-change', 'start-plan'].includes(job.action)), actions: {}, readiness: null, error: '' };
  selected ||= (await inventory(root)).changes.find(item => item.id === change);
  if (!selected) throw new Error('Select an existing change');
  const relevant = jobs.filter(job => jobMatchesChange(job, selected));
  const pending = relevant.find(job => pendingStatuses.includes(job.status));
  const preview = relevant.find(job => job.action === 'preview' && job.status === 'completed');
  const result = preview ? await previewResult(root, preview.id) : null;
  let readiness = null, error = '';
  if (!selected.archived) {
    try { readiness = await getReadiness(root, change); } catch (failure) { error = failure.message; }
  }
  const validation = await readJSON(validationPath(root, change));
  if (validation) { try { validation.stale = validation.fingerprint !== await fingerprint(root, selected); } catch { validation.stale = true; } }
  const previewStale = await previewPlanChanged(root, selected, preview, result);
  const state = { selected, readiness, error, jobs: relevant, pending, preview, result, validation, previewStale };
  return { ...state, actions: lifecycleActions(state) };
}

export async function requestLifecycle(root, payload, { getReadiness = localReadiness, runCLI = openspecJSON } = {}) {
  const { action, change = '', message = '', branch, confirmBranch, planMode = 'next', requestKey, draftId } = payload;
  if (typeof change !== 'string' || change.length > 160) throw new Error('Invalid change name');
  const allowed = ['start-plan', 'create-change', 'explore', 'plan-next', 'propose', 'revise-plan', 'finish-planning', 'preview', 'verify', 'validate', 'refresh', 'sync-specs', 'archive', 'archive-override'];
  if (!allowed.includes(action)) throw new Error('Unknown lifecycle action');
  const lock = await within(root, `.spequi/lifecycle-${hash(change || 'project')}.lock`);
  return withLock(lock, async () => {
    if (requestKey) {
      const previous = (await listJobs(root)).find(job => job.requestKey === requestKey);
      if (previous) {
        if (previous.change !== change || previous.action !== (action === 'archive-override' ? 'archive' : action) || message && previous.message !== message.trim()) throw new Error('Request identity was already used for different instructions');
        return { job: previous, url: previous.action === 'start-plan' ? `/?view=studio&new=1&creation=${previous.id}` : `/?${new URLSearchParams({ change, view: 'studio' })}` };
      }
    }
    if (['start-plan', 'create-change'].includes(action) || (!change && action === 'explore')) {
      const context = await runCLI(root, 'context');
      if (!context.root?.path || await fs.realpath(context.root.path) !== await fs.realpath(root)) throw new Error('OpenSpec must resolve to this project before starting a change.');
      const pending = (await listJobs(root)).find(job => job.change === change && pendingStatuses.includes(job.status));
      if (pending) throw new Error('A workflow for this change is already pending.');
      const create = () => enqueue(root, { action, change, message, branch, confirmBranch, planMode, requestKey });
      const job = draftId && action === 'start-plan' ? await submitDraft(root, draftId, create) : await create();
      return { job, url: action === 'start-plan' ? `/?view=studio&new=1&creation=${job.id}` : '/?view=studio&new=1' };
    }
    const state = await lifecycleState(root, change, { getReadiness });
    if (action === 'refresh') return { refreshed: true, readiness: state.readiness, error: state.error };
    const option = state.actions[action];
    if (!option?.enabled) throw new Error(option?.reason || 'This lifecycle action is unavailable');
    if (action === 'finish-planning') {
      await finishDrafts(root, change);
      const doc = state.selected.files.find(file => file.endsWith('/proposal.md')) || state.selected.files[0];
      return { finishedPlanning: true, url: `/?${new URLSearchParams({ change, view: 'rendered', ...(doc ? { doc } : {}) })}` };
    }
    if (action === 'validate') {
      const before = await fingerprint(root, state.selected);
      const response = await runCLI(root, 'validate', change);
      const item = response.items?.find(item => item.id === change && item.type === 'change');
      if (!item || typeof item.valid !== 'boolean' || !Array.isArray(item.issues)) throw new Error('OpenSpec did not return a valid validation report.');
      const validation = { change, checkedAt: new Date().toISOString(), fingerprint: before, valid: item.valid, issues: item.issues.slice(0, 100) };
      await writeJSON(validationPath(root, change), validation);
      return { validation };
    }
    const goal = message || state.jobs.find(job => ['create-change', 'start-plan'].includes(job.action))?.message || 'Continue the selected workflow for this exact change.';
    const job = await enqueue(root, { action: action === 'archive-override' ? 'archive' : action, change, message: goal, branch, confirmBranch, archiveOverride: action === 'archive-override', requestKey });
    return { job, url: `/?${new URLSearchParams({ change, view: 'studio' })}` };
  });
}
