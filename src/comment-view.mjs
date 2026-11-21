import { renderSavedComment } from './comment-controls.mjs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { escape as e } from './specs.mjs';
import { artifactReviewID } from './review-store.mjs';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const locationLabel = comment => comment.side === 'file' ? comment.kind === 'artifact' ? 'Document note' : 'File note' : `${comment.side === 'document' ? 'Document' : comment.side === 'current' ? 'Current' : 'Proposed'} L${comment.start}${comment.end !== comment.start ? `–${comment.end}` : ''}`;

export function renderCommentComposer({ file, scope, artifact = false, document = false }, { icon }) {
  if (!file) return '';
  const endpoint = `/api/reviews/${scope}/comments`;
  return `<details class="review-compose" id="review-comment-composer" ${document ? 'open data-default-open="true"' : ''}>
    <summary>${icon('comment')}<span data-composer-label>Add a comment</span><span class="comment-draft-label" data-comment-draft hidden>Draft</span>${icon('chevron')}</summary>
    <form id="review-comment-form" class="review-comment-form" method="post" action="${endpoint}" data-attachment-scope="${scope}" data-preview="${scope}" data-file="${e(file.file)}" ${artifact ? `data-source-hash="${e(file.sourceHash)}"` : ''}>
      <input type="hidden" name="file" value="${e(file.file)}">
      <input type="hidden" id="review-comment-side" name="side" value="file">
      <div data-line-fields hidden><input type="hidden" id="review-line-start" name="start"><input type="hidden" id="review-line-end" name="end"></div>
      <div class="comment-compose-file">${icon('file')}<span title="${e(file.file)}">${e(file.file)}</span></div>
      <div class="comment-context-row"><p id="review-comment-context" data-inline-comment-anchor>${artifact ? 'Entire document' : 'Entire file'}</p><button type="button" class="comment-context-reset" data-comment-file data-reset-comment-context hidden>${artifact ? 'Document comment' : 'File comment'}</button></div>
      <label for="review-comment-body" class="review-body-label">Comment</label>
      <textarea id="review-comment-body" name="body" rows="3" maxlength="6000" aria-describedby="review-comment-context review-composer-feedback comment-paste-hint" required placeholder="What should change, and why?"></textarea>
      <div class="comment-image-drafts" data-comment-images></div>
      <div id="review-composer-feedback" data-composer-feedback></div>
      <div class="comment-composer-actions"><div class="comment-attachment-actions"><button type="button" class="comment-image-add" data-comment-image-choose title="Attach files or paste text and images">${icon('attachment')}Attach files</button><span class="attachment-paste-hint" id="comment-paste-hint">or paste images here</span><input type="file" data-comment-image-input multiple hidden></div><button type="button" class="comment-compose-close" data-close-composer title="Close editor and keep your draft">Cancel</button><button type="submit" class="button primary">Save comment</button></div>
    </form>
  </details>`;
}

export function renderComments({ comments, job, file, selected, jobs, base, fileHashes = {} }, { icon, link }) {
  const endpoint = `/api/reviews/${job.id}`;
  const artifact = file?.kind === 'artifact';
  const commentScope = artifact ? artifactReviewID(selected.id) : job.id;
  const commentEndpoint = `/api/reviews/${commentScope}`;
  const sourceLink = comment => {
    const stale = comment.kind === 'artifact' && fileHashes[comment.file] !== comment.sourceHash;
    const params = comment.kind === 'artifact' ? { change: selected.id, ...(base.view === 'studio' ? { view: 'studio', stage: 'shape', plan: comment.file.split('/').slice(3).join('/') } : { doc: comment.file, view: 'rendered' }), comment: comment.id, line: !stale ? comment.start : undefined, side: !stale ? comment.side : undefined } : { ...base, file: comment.file, comment: comment.id, context: comment.side === 'file' ? '' : 'all', line: comment.start, side: comment.side };
    const openLabel = comment.side === 'file' ? comment.kind === 'artifact' ? 'Open document' : 'Open file' : locationLabel(comment);
    return link(`${e(openLabel)} ${icon('arrow')}`, params, `comment-source-link ${comment.side}`, `title="Open ${e(comment.file)} · ${e(locationLabel(comment))}"`) + (stale ? '<span class="comment-stale" title="The document changed since this comment. Source context and exported feedback retain the reviewed version.">Earlier version</span>' : '');
  };
  const paths = [...new Set(comments.map(comment => comment.file))].sort((a, b) => a.localeCompare(b));
  const currentCount = comments.filter(comment => comment.file === file?.file).length;
  const pendingUpdate = jobs.find(item => item.action === 'update-specs' && item.change === selected.id && ['queued', 'running', 'awaiting-input'].includes(item.status));
  const lastUpdate = jobs.find(item => item.action === 'update-specs' && item.change === selected.id);
  const groups = paths.map(target => {
    const notes = comments.filter(comment => comment.file === target);
    const current = target === file?.file;
    const groupID = createHash('sha256').update(target).digest('hex').slice(0, 12);
    return `<details class="comment-file-group" data-comment-file-group="${e(target)}" id="comment-group-${groupID}"><summary>${icon('chevron')}${icon('file')}<span class="comment-group-path"><strong>${e(path.posix.basename(target))}</strong>${path.posix.dirname(target) !== '.' ? `<small title="${e(target)}">${e(path.posix.dirname(target) + '/')}</small>` : ''}</span>${current ? '<span class="comment-current-label">Viewing</span>' : ''}<span class="comment-group-count">${notes.length}</span></summary><div class="comment-file-notes">${notes.map(comment => renderSavedComment(comment, { icon, id: `comment-${e(comment.id)}`, className: 'review-comment', label: locationLabel(comment), snippet: true, sourceLink: sourceLink(comment) })).join('')}</div></details>`;
  }).join('');
  const composer = file && !artifact ? `<div data-diff-composer-home>${renderCommentComposer({ file, scope: commentScope }, { icon })}</div>` : '';
  return `<section class="inspector-section review-comments-section" id="review-comments" data-preview="${job.id}" data-current-file="${e(file?.file || '')}"><div class="section-title"><h2>Review comments</h2><span class="tab-count">${comments.length}</span></div><p class="review-comment-overview">${paths.length ? `${plural(paths.length, 'file')} with comments` : 'Notes for this review'}</p><div class="review-feedback-actions"><form method="post" action="${endpoint}/update-specs" data-spec-update data-preview="${job.id}" data-change="${e(selected.id)}" data-pending-status="${pendingUpdate?.status || ''}" data-blocked="${Boolean(!comments.length || selected?.archived || pendingUpdate)}"><button type="submit" class="button primary" title="Send all review comments to your agent to update OpenSpec" ${!comments.length || selected?.archived || pendingUpdate ? 'disabled' : ''}>${icon('spark')}<span data-update-label>${pendingUpdate ? pendingUpdate.status === 'running' ? 'Updating…' : 'Queued' : 'Update spec'}</span></button></form></div><p class="review-update-hint">Updates the spec using all review comments.</p><div class="comment-view-filter" role="group" aria-label="Filter review comments"><button type="button" id="comment-filter-all" data-comment-filter="all" aria-pressed="true">All ${artifact ? 'documents' : 'files'}<span>${comments.length}</span></button><button type="button" id="comment-filter-current" data-comment-filter="current" aria-pressed="false" ${!file ? 'disabled' : ''} title="Comments on ${e(file?.file || 'this file')}">This ${artifact ? 'document' : 'file'}<span>${currentCount}</span></button></div>${composer}<div id="review-feedback" role="status" aria-live="polite"></div><div class="review-comment-list">${groups}</div><div class="review-comments-empty" id="review-comments-empty" ${comments.length ? 'hidden' : ''}>${icon('comment')}<strong data-comment-empty-title>No comments yet</strong><p data-comment-empty-copy>Add a file or document note, or select a source line to start your review.</p></div>${lastUpdate ? `<details class="comment-update-status ${e(lastUpdate.status)}" id="comment-update-status-${e(lastUpdate.id)}-${e(lastUpdate.status)}" ${lastUpdate.status === 'failed' ? 'open' : ''}><summary>OpenSpec update<span>${e(lastUpdate.status)}</span>${icon('chevron')}</summary><p>${e(lastUpdate.result || 'Waiting for your attached agent to process this feedback snapshot.')}</p></details>` : ''}</section>`;
}
