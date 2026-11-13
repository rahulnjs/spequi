import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inventory, readArtifact, jobMatchesChange } from './specs.mjs';
import { localReadiness, openspecJSON } from './openspec-cli.mjs';
import { listJobs, enqueue, pendingStatuses } from './jobs.mjs';
import { previewResult } from './previews.mjs';
import { runtime, readJSON, writeJSON, within, withLock } from './files.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const validationPath = (root, change) => runtime(root, 'validation', `${hash(change)}.json`);
export async function previewPlanChanged(root, selected, preview, result) {
  if (!preview || !result || selected.archived) return false;
  const manifest = await readJSON(runtime(root, 'previews', preview.id, 'manifest.json'));
  if (!manifest) return true;
  const prefix = `openspec/changes/${selected.id}/`;
  const expected = new Map(Object.entries(manifest).filter(([file]) => file.startsWith(prefix) && file.endsWith('.md')).map(([file, entry]) => [file, entry.hash]));
  if (result.applied) for (const change of result.changes) if (change.file.startsWith(prefix) && change.file.endsWith('.md')) {
    if (change.afterHash) expected.set(change.file, change.afterHash); else expected.delete(change.file);
  }
  if (expected.size !== selected.files.length) return true;
  for (const file of selected.files) if (expected.get(file) !== hash(await readArtifact(root, file))) return true;
  return false;
}

// The journey chooses a useful next step; existing action gates still decide availability.
export function lifecycleJourney(state) {
  const { selected, pending, readiness, preview, result, previewStale, jobs, error } = state;
  if (selected.archived) return { stage: 3, title: 'This change is archived', description: 'The spec, conversation, and saved code review remain available.' };
  if (pending) return { stage: ['start-plan', 'plan-next', 'propose', 'revise-plan', 'update-specs', 'explore'].includes(pending.action) ? 0 : pending.action === 'preview' ? 1 : 3, title: pending.status === 'awaiting-input' ? 'Your agent has a question' : pending.status === 'queued' ? 'Waiting for your agent' : 'Your agent is working', description: pending.status === 'awaiting-input' ? 'Reply below to continue this change.' : 'The current request and its progress appear below.' };
  if (error) return { stage: 0, title: 'Readiness could not be checked', description: error, action: 'refresh', label: 'Retry readiness check' };
  if (!readiness.planningComplete) return { stage: 0, title: 'Finish the spec', description: 'Create the next planning document, review it below, and continue when the spec is ready.', action: 'plan-next', label: readiness.nextArtifact ? `Create ${readiness.nextArtifact.replace(/-/g, ' ')}` : 'Continue planning' };
  if (previewStale) return { stage: 1, title: 'Preview the updated spec', description: 'The spec changed after the saved preview. Generate fresh code changes before applying.', action: 'preview', label: 'Preview code changes' };
  if (preview && result && !result.applied && result.changes.length) return { stage: 2, title: 'Your code changes are ready', description: `${result.changes.length} changed ${result.changes.length === 1 ? 'file' : 'files'}. Review the diff, then apply it from the Files view. Your project has not changed.`, action: 'review', label: 'Review & apply code' };
  if (!result?.applied && state.actions.preview.enabled) return { stage: 1, title: 'Review the spec, then preview the code', description: 'Read the spec below or describe an update. When it looks right, generate code changes in a separate copy.', action: 'preview', label: 'Preview code changes' };
  const verification = jobs.find(job => job.action === 'verify' && job.status === 'completed');
  if (verification && (!result?.appliedAt || verification.updatedAt >= result.appliedAt)) return { stage: 3, title: 'Review the implementation check', description: 'Read the report below. Archive when you are satisfied; the archive workflow still checks outstanding work.', action: 'archive', label: 'Archive change' };
  return { stage: 3, title: result?.applied ? 'Code changes applied' : 'Tracked tasks are complete', description: 'Check the implementation against the spec before finishing this change.', action: 'verify', label: 'Check implementation' };
}
async function fingerprint(root, selected) {
  const files = [];
  for (const file of selected.files) files.push([file, hash(await readArtifact(root, file))]);
  return hash(JSON.stringify(files));
}

export function lifecycleActions({ selected, readiness, error, pending, preview, result, previewStale }) {
  const actions = {};
  const add = (action, label, reason = '') => { actions[action] = { action, label, enabled: !reason, reason }; };
  const common = selected?.archived ? 'This change is archived.' : pending ? 'Finish or cancel the current workflow first.' : error || '';
  const planning = !readiness?.planningComplete ? 'Complete the required planning artifacts first.' : '';
  const complete = readiness && readiness.tasks.done === readiness.tasks.total;
  add('explore', 'Explore this change', common);
  add('plan-next', 'Create next artifact', common || (!readiness?.nextArtifact ? 'No planning artifact is ready. Existing artifacts can be revised below.' : ''));
  add('propose', 'Generate full plan', common || (readiness?.planningComplete ? 'The plan already exists. Request a revision instead.' : ''));
  add('revise-plan', 'Request a plan revision', common || (!selected?.files.length ? 'Create the first planning artifact before revising it.' : ''));
  add('preview', 'Generate implementation', common || planning || (readiness?.applyState !== 'ready' ? complete ? 'All tracked tasks are checked. Review existing work or revise the plan.' : 'The schema is not ready for implementation.' : ''));
  add('review', 'Review files', !preview || !result ? 'Create an implementation preview first.' : '');
  add('apply', result?.applied ? 'Changes applied' : 'Apply changes', selected?.archived ? 'This change is archived.' : !result?.changes.length ? 'No proposed file changes to apply.' : result.applied ? 'This preview was already applied.' : previewStale ? 'The spec changed. Generate a fresh code preview before applying.' : result.unsupported.length ? 'The preview contains unsupported files.' : pending ? 'Finish the current workflow first.' : '');
  add('verify', 'Verify implementation', common || planning || (!result?.applied && !complete ? 'Apply a reviewed preview or finish the tracked implementation first.' : ''));
  add('validate', 'Validate specification', selected?.archived ? 'This change is archived.' : error || '');
  const deltas = readiness?.artifactPaths?.specs?.existingOutputPaths?.length || 0;
  add('sync-specs', 'Sync specifications', common || (!deltas ? 'No delta specifications are available to sync.' : ''));
  add('archive', 'Archive change', common || planning || (!complete ? 'Tracked tasks are incomplete. An archive exception requires workflow confirmation.' : ''));
  add('archive-override', 'Request archive exception', common || (!planning && complete ? 'Use the normal archive action for completed work.' : ''));
  return actions;
}

export async function lifecycleState(root, change = '', { jobs, getReadiness = localReadiness } = {}) {
  jobs ||= await listJobs(root);
  if (!change) return { selected: null, jobs: jobs.filter(job => !job.change || ['create-change', 'start-plan'].includes(job.action)), actions: {}, readiness: null, error: '' };
  const selected = (await inventory(root)).changes.find(item => item.id === change);
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
  const { action, change = '', message = '', planMode = 'next' } = payload;
  if (typeof change !== 'string' || change.length > 160) throw new Error('Invalid change name');
  const allowed = ['start-plan', 'create-change', 'explore', 'plan-next', 'propose', 'revise-plan', 'preview', 'verify', 'validate', 'refresh', 'sync-specs', 'archive', 'archive-override'];
  if (!allowed.includes(action)) throw new Error('Unknown lifecycle action');
  const lock = await within(root, `.spequi/lifecycle-${hash(change || 'project')}.lock`);
  return withLock(lock, async () => {
    if (['start-plan', 'create-change'].includes(action) || (!change && action === 'explore')) {
      const context = await runCLI(root, 'context');
      if (!context.root?.path || await fs.realpath(context.root.path) !== await fs.realpath(root)) throw new Error('OpenSpec must resolve to this project before starting a change.');
      const pending = (await listJobs(root)).find(job => job.change === change && pendingStatuses.includes(job.status));
      if (pending) throw new Error('A workflow for this change is already pending.');
      const job = await enqueue(root, { action, change, message, planMode });
      return { job, url: action === 'start-plan' ? `/?view=studio&new=1&creation=${job.id}` : '/?view=lifecycle&new=1' };
    }
    const state = await lifecycleState(root, change, { getReadiness });
    if (action === 'refresh') return { refreshed: true, readiness: state.readiness, error: state.error };
    const option = state.actions[action];
    if (!option?.enabled) throw new Error(option?.reason || 'This lifecycle action is unavailable');
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
    const job = await enqueue(root, { action: action === 'archive-override' ? 'archive' : action, change, message: goal, archiveOverride: action === 'archive-override' });
    return { job, url: `/?${new URLSearchParams({ change, view: 'lifecycle' })}` };
  });
}
