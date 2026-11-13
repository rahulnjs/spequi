import { renderSavedComment } from './comment-controls.mjs';
import { marked } from 'marked';
import { escape as e, sanitizeMarkdownHTML } from './specs.mjs';
import { artifactReviewID } from './review-store.mjs';
import { renderCommentComposer } from './comment-view.mjs';

function commentCard(comment, sourceHash, icon, inline = false) {
  const stale = comment.sourceHash !== sourceHash;
  const label = comment.side === 'file' ? 'Document note' : `Lines ${comment.start}${comment.end !== comment.start ? `–${comment.end}` : ''}`;
  return renderSavedComment(comment, { icon, id: `${inline ? 'inline-' : ''}document-comment-${e(comment.id)}`, label, stale, snippet: !inline });
}

export function renderDocumentDiscussion({ artifact, change, comments }, { icon }) {
  return `<section class="document-discussion" id="document-discussion" aria-labelledby="document-discussion-title"><header><h2 id="document-discussion-title">Comments${comments.length ? ` <span>${comments.length}</span>` : ''}</h2><button type="button" class="button" data-comment-file data-general-document-comment hidden>${icon('comment')}Add a document comment</button></header><div class="document-discussion-list">${comments.map(comment => commentCard(comment, artifact.sourceHash, icon)).join('')}</div><div data-document-composer-home>${renderCommentComposer({ file: artifact, scope: artifactReviewID(change.id), artifact: true, document: true }, { icon })}</div><div id="document-comment-feedback" role="status" aria-live="polite"></div></section>`;
}

// Positions come from raw lexer spans, never from rendered line wrapping.
// Reference definitions remain shared when parsing individual blocks.
export function renderReviewMarkdown(source, { sourceHash, comments = [], icon }) {
  const normalized = source.replace(/\r\n/g, '\n');
  const tokens = marked.lexer(normalized);
  const starts = [0];
  for (let i = 0; i < normalized.length; i++) if (normalized[i] === '\n') starts.push(i + 1);
  const lineAt = offset => {
    let low = 0, high = starts.length;
    while (low < high) { const mid = (low + high) >>> 1; if (starts[mid] <= offset) low = mid + 1; else high = mid; }
    return low;
  };
  const parse = token => { const list = [token]; list.links = tokens.links; return sanitizeMarkdownHTML(marked.parser(list)); };
  const assigned = new Set();
  const thread = (start, end) => {
    const notes = comments.filter(comment => comment.side === 'document' && comment.sourceHash === sourceHash && comment.end >= start && comment.end <= end && !assigned.has(comment.id));
    for (const comment of notes) assigned.add(comment.id);
    return `<div class="document-inline-thread" data-document-thread="${start}">${notes.map(comment => commentCard(comment, sourceHash, icon, true)).join('')}</div>`;
  };
  const button = (start, end) => `<button type="button" class="markdown-comment-gutter ${comments.some(comment => comment.side === 'document' && comment.sourceHash === sourceHash && comment.start <= end && comment.end >= start) ? 'has-comments' : ''}" data-review-line="${start}" data-review-end="${end}" data-review-side="document" aria-label="Comment on Markdown ${start === end ? `line ${start}` : `lines ${start}–${end}`}" title="Add a comment · ${start === end ? `line ${start}` : `lines ${start}–${end}`}" aria-expanded="false">${icon('plus')}</button>`;
  const block = (html, start, end) => `<div class="markdown-review-block" id="document-lines-${start}-${end}" data-document-block data-source-start="${start}" data-source-end="${end}">${button(start, end)}<div class="markdown-block-content">${html}</div>${thread(start, end)}</div>`;
  let cursor = 0;
  return tokens.map(token => {
    const offset = normalized.indexOf(token.raw, cursor);
    if (offset < 0) return parse(token); // Unmapped content stays readable, without guessed anchors.
    cursor = offset + token.raw.length;
    if (token.type === 'space' || token.type === 'def') return parse(token);
    const start = lineAt(offset), end = lineAt(offset + Math.max(0, token.raw.replace(/\n+$/, '').length - 1));
    if (token.type === 'list') {
      let itemCursor = 0;
      const items = token.items.map(item => {
        const at = token.raw.indexOf(item.raw, itemCursor);
        const html = parse({ ...token, items: [item] });
        if (at < 0) return html; // Preserve content if an extension changes raw spans.
        itemCursor = at + item.raw.length;
        const inner = html.replace(/^<(?:ul|ol)(?:\s[^>]*)?>\s*<li(?:\s[^>]*)?>/, '').replace(/<\/li>\s*<\/(?:ul|ol)>\s*$/, '');
        return `<li>${block(inner, lineAt(offset + at), lineAt(offset + at + Math.max(0, item.raw.replace(/\n+$/, '').length - 1)))}</li>`;
      }).join('');
      return token.ordered ? `<ol start="${Number(token.start) || 1}" class="markdown-review-list">${items}</ol>` : `<ul class="markdown-review-list">${items}</ul>`;
    }
    if (token.type === 'code') {
      if (!token.text) return block(parse(token), start, end);
      const first = start + (/^ {0,3}(?:`{3,}|~{3,})/.test(token.raw) ? 1 : 0);
      const lines = token.text.split('\n').map((text, index) => {
        const line = first + index;
        return `<div class="markdown-code-review-line" data-document-block data-source-start="${line}" data-source-end="${line}">${button(line, line)}<code>${e(text) || ' '}</code>${thread(line, line)}</div>`;
      }).join('');
      return `<div class="markdown-review-code" role="region" aria-label="Code block">${lines}</div>`;
    }
    return block(parse(token), start, end);
  }).join('');
}

export function renderReviewSource(source, { sourceHash, comments = [], icon }) {
  return `<div class="source-view document-source" aria-label="Document source">${(source ? source.replace(/\r?\n$/, '').split(/\r?\n/) : []).map((text, index) => {
    const line = index + 1;
    return `<div class="document-source-block" data-document-block data-source-start="${line}" data-source-end="${line}"><div class="document-source-line"><button type="button" class="document-line-number" data-review-line="${line}" data-review-side="document" aria-label="Comment on document line ${line}">${line}</button><code>${e(text) || ' '}</code></div><div class="document-inline-thread" data-document-thread="${line}">${comments.filter(comment => comment.side === 'document' && comment.end === line && comment.sourceHash === sourceHash).map(comment => commentCard(comment, sourceHash, icon, true)).join('')}</div></div>`;
  }).join('')}</div>`;
}
