import { marked } from 'marked';
import { diffLines } from 'diff';
import { markdown, sanitizeMarkdownHTML } from './specs.mjs';

// Highlight rendered blocks intersecting inserted/replaced lines, retaining safe Markdown.
export function renderPlanMarkdown(source, previous) {
  if (previous === undefined || previous === source || !previous.trim()) return markdown(source);
  let cursor = 0;
  const ranges = [];
  for (const part of diffLines(previous, source)) {
    if (part.removed) continue;
    if (part.added) ranges.push([cursor, cursor + part.value.length]);
    cursor += part.value.length;
  }
  let offset = 0, change = 0;
  const tokens = marked.lexer(source);
  return tokens.map(token => {
    const start = source.indexOf(token.raw, offset), end = start + token.raw.length;
    offset = end;
    const block = [token]; block.links = tokens.links;
    const content = sanitizeMarkdownHTML(marked.parser(block));
    return token.type !== 'space' && ranges.some(([a, b]) => a < end && b > start)
      ? `<div class="studio-revision-mark" id="studio-change-${++change}" tabindex="-1" aria-label="Changed section">${content}</div>` : content;
  }).join('');
}
