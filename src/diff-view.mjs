import { escape as e } from './specs.mjs';
import { previewContents } from './previews.mjs';
import { buildDiffRows, foldDiffRows, lineEndingStyle } from './diffs.mjs';
import { highlightSource, changedWordRanges, renderTokens } from './highlighting.mjs';
import { renderDiffComment } from './diff-comments.mjs';
import { specContextForFile } from './spec-context.mjs';
import { specContextRows } from './spec-context-view.mjs';

export async function renderFileDiff({ root, job, file, result, selected, params, compact = false, comments = [], pathLabel = false }, { icon, link, badge }) {
  const mode = params.mode === 'split' ? 'split' : 'unified';
  const wrap = params.wrap !== '0';
  const base = { change: selected?.id, view: 'preview', job: job.id, file: file.file, mode, wrap: wrap ? '1' : '0', context: params.context || '' };
  const { before, after } = await previewContents(root, job.id, file.file);
  const oldEndings = lineEndingStyle(before), newEndings = lineEndingStyle(after);
  const endingNote = file.type === 'modified' && oldEndings !== newEndings && oldEndings !== 'None' && newEndings !== 'None' ? `<p class="highlight-note line-ending-note">Line endings change from ${oldEndings} to ${newEndings}. Counts highlight content edits; patch export and apply retain the exact line-ending change.</p>` : '';
  const rows = buildDiffRows(before, after);
  const specContext = specContextRows(await specContextForFile(root, job, file, result, before, after), rows.split, `${job.id}:${file.file}`, mode, icon);
  const [oldCode, newCode] = await Promise.all([highlightSource(before, file.file), highlightSource(after, file.file)]);
  const notes = comments.filter(comment => comment.file === file.file && comment.preview === job.id && ['current', 'proposed'].includes(comment.side));
  const anchors = new Set(notes.map(comment => `${comment.side}-${comment.end}`));
  const pinned = [];
  rows.split.forEach((row, index) => { if (anchors.has(`current-${row.before?.number}`) || anchors.has(`proposed-${row.after?.number}`)) pinned.push(index); });
  const folded = foldDiffRows(rows.split, params.context || '', 3, pinned);
  const hunks = folded.filter(entry => entry.hunk).length;
  const renderCell = (cell, highlighted, ranges = []) => cell ? renderTokens(highlighted.lines[cell.number - 1] || [{ content: cell.line }], ranges, cell.type) : '';
  const rowHTML = new Map();
  for (const row of rows.split) {
    const ranges = row.before?.type === 'deletion' && row.after?.type === 'addition' ? changedWordRanges(row.before.line, row.after.line) : { before: [], after: [] };
    rowHTML.set(row, { before: renderCell(row.before, oldCode, ranges.before), after: renderCell(row.after, newCode, ranges.after) });
  }
  const hunkAttr = hunk => hunk ? ` id="diff-hunk-${hunk}" data-diff-hunk="${hunk}"` : '';
  const commented = new Set();
  for (const comment of notes) for (let number = comment.start; number <= comment.end; number++) commented.add(`${comment.side}-${number}`);
  const lineNumber = (number, side) => !number ? '' : !compact ? number : `<button type="button" class="line-comment-button diff-comment-gutter ${commented.has(`${side}-${number}`) ? 'has-comments' : ''}" id="review-${side}-${number}" data-review-line="${number}" data-review-side="${side}" aria-label="Comment on ${side} line ${number}" title="Add a comment · ${side} line ${number}" aria-expanded="false">${icon(commented.has(`${side}-${number}`) ? 'comment' : 'plus')}<span>${number}</span></button>`;
  const thread = (number, side) => !number ? '' : `<div class="diff-inline-thread" data-diff-thread data-diff-side="${side}" data-diff-line="${number}">${notes.filter(comment => comment.side === side && comment.end === number).map(comment => renderDiffComment(comment, icon)).join('')}</div>`;
  const threadRow = (current, proposed) => !compact ? '' : mode === 'split' ? `<tr class="diff-inline-row"><td colspan="3" class="diff-inline-cell current">${thread(current, 'current')}</td><td colspan="3" class="diff-inline-cell proposed">${thread(proposed, 'proposed')}</td></tr>` : `<tr class="diff-inline-row"><td colspan="4" class="diff-inline-cell">${thread(current, 'current')}${thread(proposed, 'proposed')}</td></tr>`;
  const gap = (entry, colspan) => `<tr class="diff-context-gap"><td colspan="${colspan}">${link(`${icon('plus')}<span>Show ${entry.count} unchanged lines</span>`, { ...base, context: [...new Set([...(params.context || '').split(',').filter(Boolean), entry.id])].join(',') }, 'expand-context', 'data-preserve-reader="true"')}<span class="gap-location">${mode === 'split' ? 'Lines ' : ''}${entry.oldLine} / ${entry.newLine}</span></td></tr>`;
  const splitCell = (cell, html, side) => cell ? `<td class="diff-number ${compact ? 'review-line-number' : ''} ${cell.type}">${lineNumber(cell.number, side)}</td><td class="diff-sign ${cell.type}" aria-hidden="true">${cell.type === 'addition' ? '+' : cell.type === 'deletion' ? '−' : ''}</td><td class="diff-code ${cell.type}"><code>${html}</code></td>` : '<td class="diff-number diff-gap"></td><td class="diff-sign diff-gap"></td><td class="diff-code diff-gap"></td>';
  let body = '';
  if (mode === 'split') {
    body = folded.map(entry => entry.kind === 'gap' ? gap(entry, 6) : `${specContext.render(entry.row)}<tr${hunkAttr(entry.hunk)}>${splitCell(entry.row.before, rowHTML.get(entry.row).before, 'current')}${splitCell(entry.row.after, rowHTML.get(entry.row).after, 'proposed')}</tr>${threadRow(entry.row.before?.number, entry.row.after?.number)}`).join('');
  } else {
    const line = (cell, html, oldNumber, newNumber, hunk) => `<tr class="${cell.type}"${hunkAttr(hunk)}><td class="diff-number ${compact ? 'review-line-number' : ''}">${lineNumber(oldNumber, 'current')}</td><td class="diff-number ${compact ? 'review-line-number' : ''}">${lineNumber(newNumber, 'proposed')}</td><td class="diff-sign" aria-hidden="true">${cell.type === 'addition' ? '+' : cell.type === 'deletion' ? '−' : ''}</td><td class="diff-code"><code>${html}</code></td></tr>${threadRow(oldNumber, newNumber)}`;
    for (let index = 0; index < folded.length;) {
      const entry = folded[index];
      if (entry.kind === 'gap') { body += gap(entry, 4); index++; continue; }
      if (entry.row.before?.type === 'context') { body += specContext.render(entry.row) + line(entry.row.before, rowHTML.get(entry.row).before, entry.row.before.number, entry.row.after.number); index++; continue; }
      const changed = [];
      while (index < folded.length && folded[index].kind === 'row' && folded[index].row.before?.type !== 'context') changed.push(folded[index++]);
      let hunk = changed.find(item => item.hunk)?.hunk;
      body += changed.map(item => specContext.render(item.row)).join('');
      for (const side of ['before', 'after']) for (const item of changed) if (item.row[side]) {
        body += line(item.row[side], rowHTML.get(item.row)[side], side === 'before' ? item.row.before.number : '', side === 'after' ? item.row.after.number : '', hunk);
        hunk = null;
      }
    }
  }
  const fileIndex = result.changes.findIndex(change => change.file === file.file);
  body = specContext.leadingRows + body;
  const pathParts = file.file.split('/'), filename = pathParts.pop(), folder = pathParts.join('/');
  const neighbor = (offset, label) => {
    const other = result.changes[fileIndex + offset];
    return other ? link(icon(offset < 0 ? 'up' : 'down'), { ...base, file: other.file, context: '' }, 'diff-icon-button', `aria-label="${label}" title="${label}"`) : `<button class="diff-icon-button" disabled aria-label="${label}">${icon(offset < 0 ? 'up' : 'down')}</button>`;
  };
  const newlineNote = [before && !before.endsWith('\n') ? 'current' : '', after && !after.endsWith('\n') ? 'proposed' : ''].filter(Boolean);
  const heads = mode === 'split' ? '<colgroup><col class="number-col"><col class="sign-col"><col><col class="number-col"><col class="sign-col"><col></colgroup><thead><tr><th colspan="3">Current file <span>Snapshot before this change</span></th><th colspan="3">Proposed file <span>After this change</span></th></tr></thead>' : '<colgroup><col class="number-col"><col class="number-col"><col class="sign-col"><col></colgroup><thead><tr><th colspan="4">Unified diff <span>Current → proposed</span></th></tr></thead>';
  const language = newCode.language === 'text' ? 'Plain text' : newCode.language;
  const hunkTools = `<div class="diff-hunk-tools"><button class="diff-icon-button" type="button" data-diff-jump="previous" aria-label="Previous change" title="Previous change">${icon('up')}</button><button class="diff-icon-button" type="button" data-diff-jump="next" aria-label="Next change" title="Next change">${icon('down')}</button><span class="hunk-position">${hunks} ${hunks === 1 ? 'change block' : 'change blocks'}</span></div>`;
  return `<section class="file-diff" data-diff-file="${e(file.file)}"><header class="diff-file-toolbar"><div class="diff-file-identity">${icon('file')}<div><strong title="${e(file.file)}" ${pathLabel ? 'data-file-heading role="heading" aria-level="2" tabindex="-1"' : ''}>${e(pathLabel ? filename : file.file)}</strong>${pathLabel && folder ? `<small class="diff-file-path" title="${e(folder)}">${e(folder)}</small>` : ''}</div>${badge(file.type, file.type === 'added' ? 'success' : '')}<span class="file-diff-count"><span class="diff-add">+${file.additions}</span><span class="diff-remove">−${file.deletions}</span></span></div><div class="diff-file-tools">${compact ? `<button type="button" class="diff-icon-button file-comment-button" data-comment-file aria-label="Comment on entire file" title="Comment on entire file">${icon('comment')}</button>` : ''}${compact ? hunkTools : ''}<span class="syntax-language">${e(language)}</span><div class="segmented" aria-label="Diff layout">${link('Split', { ...base, mode: 'split' }, mode === 'split' ? 'active' : '', 'data-preserve-reader="true"')}${link('Unified', { ...base, mode: 'unified' }, mode === 'unified' ? 'active' : '', 'data-preserve-reader="true"')}</div>${link(wrap ? 'Wrap lines' : 'No wrap', { ...base, wrap: wrap ? '0' : '1' }, `button diff-wrap ${wrap ? 'is-on' : ''}`, `aria-label="${wrap ? 'Disable' : 'Enable'} line wrapping" aria-pressed="${wrap}" role="button" data-preserve-reader="true"`)}<div class="diff-file-paging">${neighbor(-1, 'Previous file')}<span>${fileIndex + 1} / ${result.changes.length}</span>${neighbor(1, 'Next file')}</div></div></header>${compact ? '' : `<div class="diff-context-toolbar">${hunkTools}${link(params.context === 'all' ? 'Show changes only' : 'Show entire file', { ...base, context: params.context === 'all' ? '' : 'all' }, 'text-link', 'data-preserve-reader="true"')}</div>`}${specContext.notice}${endingNote}${newCode.limited || oldCode.limited ? '<p class="highlight-note">Very large or minified lines use plain text. All file content remains available.</p>' : ''}<div class="diff-code-scroll ${mode === 'unified' ? 'code-diff unified' : 'split-diff-view'} ${wrap ? 'wrap-lines' : 'no-wrap'}"><table class="review-diff-table ${mode === 'split' ? 'split-diff-table' : 'unified-diff-table'}" aria-label="${mode === 'split' ? 'Current and proposed file comparison' : 'Unified file comparison'}">${heads}<tbody>${body}</tbody>${newlineNote.length ? `<tfoot><tr><td colspan="${mode === 'split' ? 6 : 4}">No newline at end of ${newlineNote.join(' and ')} file.</td></tr></tfoot>` : ''}</table></div></section>`;
}
