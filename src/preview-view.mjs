import { escape as e, changeState, jobMatchesChange } from './specs.mjs';
import { previewResult } from './previews.mjs';
import { renderFileDiff } from './diff-view.mjs';
import { listComments } from './review-store.mjs';
import { previewPlanChanged } from './lifecycle.mjs';
import { trackDiffFailure } from './analytics.mjs';

export async function getPreviewContext(root, params, jobs, selected) {
  const matching = jobs.filter(job => job.action === 'preview' && (!selected || jobMatchesChange(job, selected)));
  const previews = matching.filter(job => job.status === 'completed');
  const job = previews.find(job => job.id === params.job) || previews[0];
  const diffRequested = params.view === 'preview' || params.view === 'studio' && params.stage === 'implement';
  let result = null;
  try { result = job ? await previewResult(root, job.id) : null; }
  catch (error) {
    if (job && diffRequested) trackDiffFailure(root, job.id, 'unreadable_result');
    throw error;
  }
  if (job && diffRequested) {
    const reason = !result ? 'missing_result' : !Array.isArray(result.changes) ? 'invalid_result' : !result.changes.length && result.unsupported?.length ? 'unsupported_files' : !result.changes.length && !changeState(selected).complete ? 'empty_result' : null;
    if (reason) trackDiffFailure(root, job.id, reason);
  }
  return {
    previews, job, result, comments: job && result ? await listComments(root, job.id) : [],
    file: result?.changes.find(change => change.file === params.file) || result?.changes[0],
    pending: matching.find(job => ['queued', 'running', 'awaiting-input'].includes(job.status)),
    failure: matching[0]?.status === 'failed' ? matching[0] : null,
    workflowPending: jobs.find(item => selected && jobMatchesChange(item, selected) && ['queued', 'running', 'awaiting-input'].includes(item.status))
  };
}

export function changedFilesNavigation(context, params, selected, { link }) {
  const { job, result, file } = context;
  const build = params.view === 'studio';
  const destination = build ? { view: 'studio', stage: 'implement', pane: 'document', q: params.q } : { view: 'preview' };
  const label = change => {
    if (!build) return e(change.file);
    const segments = change.file.split('/'), name = segments.pop(), folder = segments.join('/');
    return `<span class="changed-file-basename">${e(name)}</span>${folder ? `<small class="changed-file-folder">${e(folder)}</small>` : ''}`;
  };
  const noFiles = changeState(selected).complete ? 'No saved file changes for this change.' : 'Generate a file diff to see the implementation changes.';
  return `<div class="nav-heading separated"><span>Files changed</span><span>${result?.changes.length || 0}</span></div>${build ? '' : '<div class="file-filter"><input id="file-filter" type="search" aria-label="Filter changed files" placeholder="Filter files…"></div>'}<nav class="changed-files-nav ${build ? 'studio-changed-files' : ''}" aria-label="Changed files" ${build ? 'tabindex="-1"' : ''} data-preview-job="${e(job?.id || '')}">${result?.changes.length ? result.changes.map(change => link(`<span class="file-state ${change.type}">${change.type[0].toUpperCase()}</span><span class="changed-file-name">${label(change)}</span><span class="file-line-count"><span class="diff-add">+${change.additions}</span><span class="diff-remove">−${change.deletions}</span></span>`, { change: selected?.id, ...destination, job: job.id, file: change.file, mode: params.mode, wrap: params.wrap }, `changed-file-link ${change.file === file?.file ? 'selected' : ''}`, `data-file-path="${e(change.file)}" title="${e(change.file)}" hx-sync="#workspace:replace"${change.file === file?.file ? ' aria-current="page"' : ''}`)).join('') : `<p class="nav-empty">${noFiles}</p>`}</nav>${build ? '' : '<p class="nav-empty" id="file-filter-empty" hidden>No files match this filter.</p>'}`;
}

function generateForm(selected, pending, icon, label = 'Generate file diff') {
  if (!selected || selected.archived) return '';
  return `<form class="generate-diff-form" action="/api/jobs" method="post" hx-post="/api/jobs" hx-target="#preview-feedback" hx-swap="innerHTML"><input type="hidden" name="action" value="preview"><input type="hidden" name="change" value="${e(selected.id)}"><button type="submit" class="button primary" id="generate-file-diff" ${pending ? 'disabled' : ''}>${icon('spark')}${pending ? 'Generating diff…' : label}</button></form>`;
}

function versionForm({ params, selected, context }, compact = false) {
  const { previews, job, file } = context;
  return `<form class="diff-version-form" action="/" hx-get="/" hx-target="#workspace" hx-swap="outerHTML" hx-push-url="true" hx-trigger="change"><input type="hidden" name="change" value="${e(selected?.id || '')}"><input type="hidden" name="view" value="preview"><input type="hidden" name="mode" value="${params.mode === 'split' ? 'split' : 'unified'}"><input type="hidden" name="file" value="${e(file?.file || '')}"><input type="hidden" name="wrap" value="${e(params.wrap || '1')}"><label for="diff-version">Preview</label><select name="job" id="diff-version" aria-label="Implementation preview version">${previews.map((preview, index) => `<option value="${e(preview.id)}" ${preview.id === job.id ? 'selected' : ''} title="${e(new Date(preview.updatedAt).toLocaleString())}">${compact ? index === 0 ? 'Latest preview' : `Preview ${previews.length - index}` : `${index === 0 ? 'Latest · ' : ''}${e(new Date(preview.updatedAt).toLocaleString())}`}</option>`).join('')}</select></form>`;
}

function applyForm(job, result, icon, blocked = false) {
  return `<form data-apply-form hx-post="/api/previews/${job.id}/apply" hx-target="#apply-feedback"><button class="button primary" id="apply-${job.id}" ${blocked || result.applied || result.unsupported.length || !result.changes.length ? 'disabled' : ''}>${icon('check')} ${result.applied ? 'Changes applied' : 'Apply changes'}</button></form>`;
}

function completedEmpty(selected, { icon, link, empty }, saved = false, failure = null, pending = null) {
  const artifactLink = (name, label, className) => {
    const doc = selected.files.find(file => !file.includes('/specs/') && file.endsWith(`/${name}.md`));
    return doc ? link(label, { change: selected.id, doc, view: 'rendered' }, className) : '';
  };
  const copy = `${selected.progress.done} of ${selected.progress.total} tasks are checked off. ${saved ? 'This preview contains no file changes.' : 'No file preview has been saved for this change.'} Review the plan and completed tasks before archiving.`;
  const actions = `<div class="completed-change-actions">${artifactLink('proposal', 'Review proposal', 'button primary')}${artifactLink('tasks', 'Review tasks', 'button')}</div>`;
  const generate = !selected.archived ? `<details class="completed-diff-option" id="completed-diff-option"><summary>Need a file diff?</summary><p>Generate a preview from the current project. Completed tasks may produce no new file changes.</p>${generateForm(selected, pending, icon, 'Generate review diff')}</details>` : '';
  const error = failure ? `<p class="error-message">Previous attempt failed: ${e(failure.result || 'Retry with your agent attached.')}</p>` : '';
  return `<div class="diff-empty-state completed-change-state">${empty('All tasks are complete', copy, 'check', `${actions}${generate}${error}`)}</div>`;
}

export async function renderPreview({ root, params, selected, agent, context, compact = false }, { icon, link, badge, empty }) {
  const { job, result, file, pending, failure } = context;
  if (!job) {
    if (!pending && changeState(selected).complete) return completedEmpty(selected, { icon, link, empty }, false, failure) + '<div id="preview-feedback" role="status" aria-live="polite"></div>';
    const title = pending?.status === 'awaiting-input' ? 'Your agent needs your input.' : pending ? pending.origin ? 'Preparing proposed file changes.' : pending.status === 'running' ? 'Your agent is generating the file diff.' : 'File diff queued.' : 'No implementation diff yet.';
    const description = pending?.status === 'awaiting-input' ? 'Answer the question in Build to continue this preview.' : pending ? pending.origin ? 'Proposed changes are being prepared in a separate project copy.' : pending.status === 'running' ? 'The file comparison will appear here when the preview is ready.' : 'Your agent will pick up this request when available.' : selected?.archived ? 'No file preview was saved for this archived change.' : 'Generate an implementation preview, then review its proposed file changes here.';
    const progress = pending ? `<div class="diff-generation-status" role="status"><span class="badge ${pending.status === 'running' ? 'blue' : ''}">${e({ queued: 'Queued', running: 'Working', 'awaiting-input': 'Answer needed' }[pending.status] || pending.status)}</span>${pending.logs.slice(-1).map(log => `<p>${e(log.message)}</p>`).join('')}</div>` : '';
    const attach = !pending && !agent.connected && selected && !selected.archived ? '<p class="diff-agent-note">No agent connected. Preview requests will wait in the queue.</p>' : '';
    const error = failure ? `<p class="error-message">Previous attempt failed: ${e(failure.result || 'Retry with your agent attached.')}</p>` : '';
    const build = selected ? link(pending?.status === 'awaiting-input' ? 'Reply in Build' : pending ? 'View progress in Build' : 'Open Build', { change: selected.id, view: 'studio', stage: 'implement', ...(pending ? { pane: 'conversation' } : {}) }, `button ${pending || selected.archived ? 'primary' : ''}`) : '';
    const actions = `<div class="diff-empty-actions">${pending ? '' : generateForm(selected, null, icon)}${build}</div>`;
    return `<div class="diff-empty-state">${empty(title, description, 'git', `${actions}${attach}${progress}${error}<div id="preview-feedback" role="status" aria-live="polite"></div>`)}</div>`;
  }
  if (!result) return `<div class="diff-empty-state">${empty('Preview files unavailable', 'Open Build to generate a fresh implementation preview.', 'git', `<div class="diff-empty-actions">${selected ? link('Open Build', { change: selected.id, view: 'studio', stage: 'implement' }, 'button primary') : ''}</div>`)}</div>`;
  const fileDiff = file ? await renderFileDiff({ root, job, file, result, selected, params, compact, comments: context.comments }, { icon, link, badge }) : '';
  const additions = result.changes.reduce((total, change) => total + change.additions, 0);
  const deletions = result.changes.reduce((total, change) => total + change.deletions, 0);
  const versions = versionForm({ params, selected, context });
  const noChanges = changeState(selected).complete ? completedEmpty(selected, { icon, link, empty }, true, null, pending) : empty('No file changes were produced', job.origin ? 'The proposed content matches the saved baseline. Review the result or generate another preview.' : 'The agent completed without modifying eligible text files. Review its result or generate another preview.');
  const stale = selected ? await previewPlanChanged(root, selected, job, result) : false;
  const blocked = selected?.archived || stale || context.workflowPending;
  const reason = selected?.archived ? 'This change is archived.' : stale ? 'The spec changed. Return to Build to generate a fresh code preview.' : context.workflowPending ? 'Wait for the current request to finish before applying.' : '';
  const provenance = `<div class="source-preview-status guided-file-actions"><span><strong>${job.origin === 'model' ? `Model proposal · ${e(job.model)}` : job.origin ? 'Imported patch' : result.applied ? 'Code changes applied' : 'Review your code changes'}</strong><small>${e(job.validation?.message || `${result.changes.length} changed files · ${result.applied ? 'Saved in your project' : 'Your project has not changed'}`)}</small></span><div class="preview-followup">${link(result.applied ? 'Continue' : 'Update spec', { change: selected?.id, view: 'studio', stage: result.applied ? 'finish' : 'shape' }, 'button')}${job.origin ? `<a class="button" href="/api/previews/${job.id}/patch" download="${e(job.change)}.patch">${icon('download')}Export patch</a>` : ''}${applyForm(job, result, icon, blocked)}</div>${reason ? `<p class="preview-blocker">${e(reason)}</p>` : ''}</div>`;
  if (compact) return `${provenance}<div class="compact-review-feedback"><div id="preview-feedback" role="status" aria-live="polite"></div><div id="apply-feedback" role="status"></div>${pending ? '<p class="muted diff-pending-note">A new diff is being generated. This completed preview stays available while you wait.</p>' : ''}${result.unsupported.length ? `<p class="error-message">Unsupported binary or oversized changes: ${e(result.unsupported.join(', '))}. Apply is disabled.</p>` : ''}</div><section class="diff-panel">${fileDiff || noChanges}</section>`;
  return `<div class="review-intro file-review-intro"><div class="file-review-title"><h2>File review ${badge(result.applied ? 'Applied' : 'Ready for review', 'success')}</h2>${versions}</div><div class="preview-actions"><span><strong>${result.changes.length}</strong> changed files <span class="diff-add">+${additions}</span> <span class="diff-remove">−${deletions}</span></span><a class="button" href="/api/previews/${job.id}/patch" download="${e(job.change || 'preview')}.patch">${icon('download')} Export patch</a>${generateForm(selected, pending, icon, 'Regenerate diff')}${applyForm(job, result, icon, selected?.archived)}</div><div id="preview-feedback" role="status" aria-live="polite"></div><div id="apply-feedback" role="status"></div>${pending ? '<p class="muted diff-pending-note">A new diff is being generated. This completed preview stays available while you wait.</p>' : ''}${result.unsupported.length ? `<p class="error-message">Unsupported binary or oversized changes: ${e(result.unsupported.join(', '))}. Apply is disabled.</p>` : ''}</div><section class="diff-panel">${fileDiff || noChanges}</section>`;
}
