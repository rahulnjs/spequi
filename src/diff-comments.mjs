import { renderSavedComment } from './comment-controls.mjs';
import { escape as e } from './specs.mjs';

export function renderDiffComment(comment, icon) {
  const side = comment.side === 'current' ? 'Current' : 'Proposed';
  const range = `${comment.start}${comment.end !== comment.start ? `–${comment.end}` : ''}`;
  return renderSavedComment(comment, { icon, id: `inline-diff-comment-${e(comment.id)}`, className: 'document-comment diff-comment', label: `${side} ${comment.start === comment.end ? 'line' : 'lines'} ${range}` });
}
