import { createHash } from 'node:crypto';
import { escape as e, markdown } from './specs.mjs';

export function specContextRows(context, rows, scope, mode, icon) {
  const blocks = new Map(), emitted = new Set(), rendered = new Set();
  const prefix = createHash('sha256').update(scope).digest('hex').slice(0, 12);
  let first = null;
  for (let index = 0; index < rows.length;) {
    if (rows[index].before?.type !== 'deletion' && rows[index].after?.type !== 'addition') { index++; continue; }
    const start = index, group = [];
    while (index < rows.length && (rows[index].before?.type === 'deletion' || rows[index].after?.type === 'addition')) group.push(rows[index++]);
    first ||= rows[start];
    const references = context.links.filter(reference => group.some(row => {
      const cell = reference.side === 'current' ? row.before : row.after;
      return cell && cell.type !== 'context' && cell.number >= reference.start && cell.number <= reference.end;
    }));
    if (references.length) blocks.set(rows[start], references);
  }
  const suggested = !context.links.length && context.suggestions.length;
  if (suggested && (first || rows[0])) blocks.set(first || rows[0], context.suggestions);
  const render = row => {
    const references = blocks.get(row);
    if (!references || rendered.has(row)) return '';
    rendered.add(row);
    const entries = [...new Map(references.map(reference => [reference.key, reference])).values()].map(reference => {
      const id = `spec-context-${prefix}-${reference.key}`;
      if (emitted.has(reference.key)) return `<a class="spec-context-repeat" href="#${id}">${icon('file')}Same requirement: ${e(reference.title)}</a>`;
      emitted.add(reference.key);
      const text = reference.quote.replace(/^#{1,6}\s+[^\n]+\n+/, '');
      return `<details class="spec-context-quote" id="${id}"><summary>${icon('book')}<span class="spec-context-label">Spec context</span><strong>${e(reference.title)}</strong><span class="spec-context-provenance ${suggested ? 'suggested' : ''}">${suggested ? 'Suggested' : 'Recorded'}</span>${icon('chevron')}</summary>${suggested ? '<p class="spec-context-caveat">Suggested from the saved plan; confirm relevance to this edit.</p>' : ''}<blockquote>${markdown(text)}</blockquote><p class="spec-context-source">${icon('file')}<span>${e(reference.spec)}<br>Lines ${reference.specStart}–${reference.specEnd} · Preview snapshot${reference.reason ? ` · ${e(reference.reason)}` : ''}</span></p></details>`;
    }).join('');
    return `<tr class="spec-context-row"><td colspan="${mode === 'split' ? 6 : 4}"><section class="spec-context-inline" aria-label="${suggested ? 'Suggested spec context for this file' : 'Spec context for this change block'}">${entries}</section></td></tr>`;
  };
  const empty = !context.links.length && !context.suggestions.length;
  const notice = context.notice || (empty ? 'No spec links recorded for this file.' : '');
  return { render, leadingRows: first ? '' : render(rows[0]), overview: '', notice: '' };
}
