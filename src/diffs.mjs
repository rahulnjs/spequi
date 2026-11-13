import { diffLines } from 'diff';

const lines = value => value ? value.replace(/\r?\n$/, '').split(/\r?\n/) : [];

// Normalize CRLF for comparison only; retained files and exported patches stay exact.
export function compareLines(before, after) { return diffLines(before, after, { stripTrailingCr: true }); }

export function lineEndingStyle(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  return crlf && lf ? 'Mixed (CRLF/LF)' : crlf ? 'CRLF' : lf ? 'LF' : 'None';
}

// Keep unchanged lines opposite each other, including after uneven edits.
export function buildDiffRows(before, after) {
  const parts = compareLines(before, after);
  const unified = [], split = [];
  let oldNumber = 0, newNumber = 0, index = 0;
  while (index < parts.length) {
    const part = parts[index];
    if (!part.added && !part.removed) {
      for (const line of lines(part.value)) {
        const old = { line, number: ++oldNumber, type: 'context' };
        const proposed = { line, number: ++newNumber, type: 'context' };
        split.push({ before: old, after: proposed });
        unified.push({ line, oldNumber, newNumber, type: 'context' });
      }
      index++;
      continue;
    }
    const removed = [], added = [];
    while (index < parts.length && (parts[index].added || parts[index].removed)) {
      const changed = parts[index++];
      for (const line of lines(changed.value)) {
        if (changed.removed) {
          removed.push({ line, number: ++oldNumber, type: 'deletion' });
          unified.push({ line, oldNumber, newNumber: '', type: 'deletion' });
        } else {
          added.push({ line, number: ++newNumber, type: 'addition' });
          unified.push({ line, oldNumber: '', newNumber, type: 'addition' });
        }
      }
    }
    for (let line = 0; line < Math.max(removed.length, added.length); line++) {
      split.push({ before: removed[line] || null, after: added[line] || null });
    }
  }
  return { unified, split };
}

export function foldDiffRows(rows, expanded = '', context = 3, pinned = []) {
  const open = new Set(expanded.split(',').filter(value => /^gap-\d+-\d+$/.test(value)));
  const openRanges = [...open].map(id => id.slice(4).split('-').map(Number));
  const keep = new Set();
  for (const at of pinned) for (let offset = -context; offset <= context; offset++) keep.add(at + offset);
  const output = [];
  const unchanged = row => row.before?.type === 'context' && row.after?.type === 'context';
  let index = 0, hunk = 0, wasChanged = false;
  const emit = (row, at) => {
    const changed = !unchanged(row);
    const startsHunk = changed && !wasChanged;
    if (startsHunk) hunk++;
    output.push({ kind: 'row', row, index: at, hunk: startsHunk ? hunk : null });
    wasChanged = changed;
  };
  while (index < rows.length) {
    if (!unchanged(rows[index])) { emit(rows[index], index); index++; continue; }
    const start = index;
    while (index < rows.length && unchanged(rows[index])) index++;
    const end = index, leading = start === 0 ? 0 : context, trailing = end === rows.length ? 0 : context;
    if (end - start <= leading + trailing + 2 || expanded === 'all') {
      for (let at = start; at < end; at++) emit(rows[at], at);
      continue;
    }
    const hiddenStart = start + leading, hiddenEnd = end - trailing;
    for (let at = start; at < hiddenStart; at++) emit(rows[at], at);
    for (let at = hiddenStart; at < hiddenEnd;) {
      if (keep.has(at)) { emit(rows[at], at); at++; continue; }
      const from = at;
      while (at < hiddenEnd && !keep.has(at)) at++;
      const gapID = `gap-${from}-${at}`;
      if (at - from <= 2 || open.has(gapID) || openRanges.some(([start, end]) => start <= from && end >= at)) for (let line = from; line < at; line++) emit(rows[line], line);
      else { output.push({ kind: 'gap', id: gapID, count: at - from, oldLine: rows[from].before.number, newLine: rows[from].after.number }); wasChanged = false; }
    }
    for (let at = hiddenEnd; at < end; at++) emit(rows[at], at);
  }
  return output;
}
