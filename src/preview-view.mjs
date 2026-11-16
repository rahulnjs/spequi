import { escape as e, markdown, changeState, jobMatchesChange } from './specs.mjs';
import { previewResult } from './previews.mjs';
import { renderFileDiff } from './diff-view.mjs';
import { listComments } from './review-store.mjs';
import { previewPlanChanged } from './lifecycle.mjs';
import { jobQuestions } from './studio-view.mjs';
import { trackDiffFailure } from './analytics.mjs';
import { renderSourcePreviewTools } from './source-preview-view.mjs';

export async function getPreviewContext(root, params, jobs, selected) {
  const matching = jobs.filter(job => job.action === 'preview' && (!selected || jobMatchesChange(job, selected)));
  const previews = matching.filter(job => job.status === 'completed');
  const followed = matching.find(job => job.id === params.follow && ['completed', 'failed', 'cancelled'].includes(job.status));
  const job = previews.find(job => job.id === followed?.id) || previews.find(job => job.id === params.job) || previews[0];
  const diffRequested = params.view === 'preview' || params.view === 'studio' && params.stage === 'implement';
  let result = null;
  try { result = job ? await previewResult(root, job.id) : null; }
  catch (error) {
    if (job && diffRequested) await trackDiffFailure(root, job.id, 'unreadable_result');
    throw error;
  }
  if (job && diffRequested) {
    const reason = !result ? 'missing_result' : !Array.isArray(result.changes) ? 'invalid_result' : !result.changes.length && result.unsupported?.length ? 'unsupported_files' : !result.changes.length && !changeState(selected).complete ? 'empty_result' : null;
    if (reason) await trackDiffFailure(root, job.id, reason);
  }
  return {
    previews, job, result, followComplete: Boolean(followed), comments: job && result ? await listComments(root, job.id) : [],
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
  return `<form id="generate-diff-form" class="generate-diff-form" data-lifecycle-form action="/api/jobs" method="post"><input type="hidden" name="action" value="preview"><input type="hidden" name="change" value="${e(selected.id)}"><button type="submit" class="button primary" id="generate-file-diff" ${pending ? 'disabled' : ''}>${icon('spark')}${pending ? 'Generating diff…' : label}</button><div data-lifecycle-feedback role="status" aria-live="polite"></div></form>`;
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
  const pendingQuestion = pending?.status === 'awaiting-input' ? `<section class="diff-agent-question" id="diff-agent-question" tabindex="-1"><h3>Your agent needs an answer</h3>${jobQuestions(pending)}</section>` : '';
  const tools = selected && !selected.archived ? await renderSourcePreviewTools(root, selected, Boolean(result), context.workflowPending, icon) : '';
  if (!job) {
    if (!pending && changeState(selected).complete) return completedEmpty(selected, { icon, link, empty }, false, failure) + tools + '<div id="preview-feedback" role="status" aria-live="polite"></div>';
    const title = pending?.status === 'awaiting-input' ? 'Your agent needs your input.' : pending ? pending.origin ? 'Preparing proposed file changes.' : pending.status === 'running' ? 'Your agent is generating the file diff.' : 'File diff queued.' : 'No implementation diff yet.';
    const description = pending?.status === 'awaiting-input' ? 'Answer below to continue generating your file diff.' : pending ? pending.origin ? 'Proposed changes are being prepared in a separate project copy.' : pending.status === 'running' ? 'This can take a few minutes. Your file diff will appear here when ready.' : 'Your agent will pick up this request when available.' : selected?.archived ? 'No file preview was saved for this archived change.' : 'Generate an implementation preview, then review its proposed file changes here.';
    const progress = pending ? `<div class="diff-generation-status" role="status"><span class="badge ${pending.status === 'running' ? 'blue' : ''}">${e({ queued: 'Queued', running: 'Working', 'awaiting-input': 'Answer needed' }[pending.status] || pending.status)}</span>${pending.logs.slice(-1).map(log => `<p>${e(log.message)}</p>`).join('')}</div>` : '';
    const attach = !pending && !agent.connected && selected && !selected.archived ? '<p class="diff-agent-note">No agent connected. Preview requests will wait in the queue.</p>' : '';
    const error = failure ? `<p class="error-message">Previous attempt failed: ${e(failure.result || 'Retry with your agent attached.')}</p>` : '';
    const request = pending?.status === 'awaiting-input' ? '<a href="#diff-agent-question" class="button primary">Answer agent</a>' : pending ? '<button type="button" class="button" data-requests-toggle>Request details</button>' : '';
    const actions = `<div class="diff-empty-actions">${pending ? '' : generateForm(selected, null, icon)}${request}</div>`;
    return `<div class="diff-empty-state">${empty(title, description, 'git', `${actions}${attach}${progress}${pendingQuestion}${pending ? '<p class="diff-cli-note">Your CLI may be waiting for a permission or another action. Check your coding session if progress pauses.</p>' : '<p class="diff-scope-note">Makes the spec’s file changes in an isolated copy. Validation and testing are separate steps.</p>'}${error}<div id="preview-feedback" role="status" aria-live="polite"></div>`)}</div>${pending ? '' : tools}`;
  }
  if (!result) return `<div class="diff-empty-state">${empty('Preview files unavailable', 'Generate a fresh file diff to continue reviewing.', 'git', `<div class="diff-empty-actions">${generateForm(selected, pending, icon)}</div>`)}</div>`;
  const fileDiff = file ? await renderFileDiff({ root, job, file, result, selected, params, compact, comments: context.comments }, { icon, link, badge }) : '';
  const additions = result.changes.reduce((total, change) => total + change.additions, 0);
  const deletions = result.changes.reduce((total, change) => total + change.deletions, 0);
  const versions = versionForm({ params, selected, context });
  const noChanges = changeState(selected).complete ? completedEmpty(selected, { icon, link, empty }, true, null, pending) : empty('No file changes were produced', job.origin ? 'The proposed content matches the saved baseline. Review the result or generate another preview.' : 'The agent completed without modifying eligible text files. Review its result or generate another preview.');
  const stale = selected ? await previewPlanChanged(root, selected, job, result) : false;
  const blocked = selected?.archived || stale || context.workflowPending;
  const reason = selected?.archived ? 'This change is archived.' : stale ? 'The spec changed. Generate a fresh file diff before applying.' : context.workflowPending ? 'Wait for the current request to finish before applying.' : '';
  const lastFailure = failure && failure.createdAt > job.createdAt ? `<p class="error-message">The latest diff request failed: ${e(failure.result || 'Check your coding session and retry.')}</p>` : '';
  const provenance = `<div class="source-preview-status guided-file-actions"><span><strong>${job.origin === 'model' ? `Model proposal · ${e(job.model)}` : job.origin ? 'Imported patch' : result.applied ? 'Code changes applied' : 'Review your code changes'}</strong><small>${e(job.validation?.message || `${result.changes.length} changed files · ${result.applied ? 'Saved in your project' : 'Your project has not changed'}${result.taskUpdates?.length ? ' · Includes task completion updates' : ''}`)}</small></span><div class="preview-followup">${result.applied ? link('Continue', { change: selected?.id, view: 'workflow' }, 'button') : ''}${job.origin ? `<a class="button" href="/api/previews/${job.id}/patch" download="${e(job.change)}.patch">${icon('download')}Export patch</a>` : ''}${stale ? generateForm(selected, pending, icon, 'Regenerate diff') : ''}${applyForm(job, result, icon, blocked)}</div>${reason ? `<p class="preview-blocker">${e(reason)}</p>` : ''}</div>`;
  const summary = !job.origin && job.result && job.result !== 'Completed' ? `<details class="diff-summary" id="diff-summary-${e(job.id)}"><summary>${icon('spark')}<strong>Change summary</strong><span>From your agent</span>${icon('chevron')}</summary><div class="prose">${markdown(job.result)}</div></details>` : '';
  if (compact) return `${provenance}${summary}<div class="compact-review-feedback">${lastFailure}${pendingQuestion}<div id="preview-feedback" role="status" aria-live="polite"></div><div id="apply-feedback" role="status"></div>${pending ? '<p class="muted diff-pending-note">A new diff is being generated. This completed preview stays available while you wait.</p>' : ''}${result.unsupported.length ? `<p class="error-message">Unsupported binary or oversized changes: ${e(result.unsupported.join(', '))}. Apply is disabled.</p>` : ''}</div><section class="diff-panel">${fileDiff || noChanges}</section>${tools}`;
  return `<div class="review-intro file-review-intro"><div class="file-review-title"><h2>File review ${badge(result.applied ? 'Applied' : 'Ready for review', 'success')}</h2>${versions}</div><div class="preview-actions"><span><strong>${result.changes.length}</strong> changed files <span class="diff-add">+${additions}</span> <span class="diff-remove">−${deletions}</span></span><a class="button" href="/api/previews/${job.id}/patch" download="${e(job.change || 'preview')}.patch">${icon('download')} Export patch</a>${generateForm(selected, pending, icon, 'Regenerate diff')}${applyForm(job, result, icon, selected?.archived)}</div><div id="preview-feedback" role="status" aria-live="polite"></div><div id="apply-feedback" role="status"></div>${pending ? '<p class="muted diff-pending-note">A new diff is being generated. This completed preview stays available while you wait.</p>' : ''}${result.unsupported.length ? `<p class="error-message">Unsupported binary or oversized changes: ${e(result.unsupported.join(', '))}. Apply is disabled.</p>` : ''}</div>${lastFailure}${pendingQuestion}${summary}<section class="diff-panel">${fileDiff || noChanges}</section>${tools}`;
}
