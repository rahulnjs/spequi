import { escape as e } from './specs.mjs';

export function renderSavedComment(comment, { icon, id, label, className = 'document-comment', stale = false, snippet = false, sourceLink = '' }) {
  return `<article class="${className} saved-comment" tabindex="-1" id="${id}"><details class="saved-comment-thread" id="thread-${id}" data-comment-disclosure data-comment-id="${e(comment.id)}"><summary>${icon('chevron')}<span class="saved-comment-label">${icon('comment')}${e(label)}</span>${stale ? '<span class="comment-stale">Earlier version</span>' : ''}<time class="comment-created-at" data-document-comment-time datetime="${e(comment.createdAt)}">Saved</time></summary><p class="review-comment-body">${e(comment.body)}</p>${(comment.images || []).map(image => `<a class="comment-image" href="${e(image.url)}" target="_blank" rel="noopener noreferrer"><img src="${e(image.url)}" alt="${e(image.name)}" loading="lazy"><span>${e(image.name)}</span></a>`).join('')}${sourceLink ? `<div class="saved-comment-source">${sourceLink}</div>` : ''}${snippet && comment.snippet ? `<details class="comment-source-context" id="context-${id}"><summary>Source context</summary><pre><code>${e(comment.snippet)}</code></pre></details>` : ''}</details><div class="saved-comment-tools">${renderDeleteComment(comment, icon)}</div></article>`;
}

export function renderDeleteComment(comment, icon) {
  const endpoint = `/api/reviews/${comment.preview}/comments/${comment.id}/delete`;
  return `<form class="comment-delete-form" method="post" action="${e(endpoint)}" data-delete-comment data-review-scope="${e(comment.preview)}" data-comment-id="${e(comment.id)}" data-comment-file="${e(comment.file)}" data-comment-change="${e(comment.change)}"><button type="submit" class="comment-delete" aria-label="Delete comment on ${e(comment.file || 'this source')}" title="Delete comment">${icon('close')}</button><span class="comment-delete-error" data-delete-feedback role="alert" hidden></span></form>`;
}
