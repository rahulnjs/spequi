import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyPatch } from 'diff';
import { parseHTML } from 'linkedom';
import { buildDiffRows, compareLines, lineEndingStyle } from '../src/diffs.mjs';
import { isPreviewSnapshotPath } from '../src/files.mjs';
import { initProject } from '../src/project.mjs';
import { enqueue, claimNext, updateJob } from '../src/jobs.mjs';
import { previewResult, applyPreview } from '../src/previews.mjs';
import { addComment } from '../src/review-store.mjs';
import { startServer } from '../src/server.mjs';

test('CRLF, LF, and mixed line endings compare content without changing line numbers', () => {
  for (const [before, after] of [
    ['first\r\nold\r\nlast\r\n', 'first\r\nnew\r\nlast\r\n'],
    ['first\r\nold\r\nlast\r\n', 'first\nnew\nlast\n'],
    ['first\nold\nlast\n', 'first\r\nnew\r\nlast\r\n'],
    ['first\r\nold\nlast\r\n', 'first\nnew\r\nlast\n'],
    ['first\r\nold\r\nlast', 'first\nnew\nlast']
  ]) {
    const rows = buildDiffRows(before, after);
    assert.deepEqual(rows.split.map(row => [row.before?.number, row.after?.number]), [[1, 1], [2, 2], [3, 3]]);
    assert.equal(rows.unified.filter(row => row.type === 'deletion').length, 1);
    assert.equal(rows.unified.filter(row => row.type === 'addition').length, 1);
    assert.equal(rows.unified.filter(row => row.type === 'context').length, 2);
    assert.ok(rows.unified.every(row => !row.line.includes('\r')));
  }
  assert.ok(buildDiffRows('one\r\n\r\nthree\r\n', 'one\n\nthree\n').unified.every(row => row.type === 'context'));
  assert.equal(compareLines('line\r\n', 'line\n').filter(part => part.added || part.removed).length, 0);
  assert.ok(compareLines('line\r\n', 'line').some(part => part.added || part.removed), 'missing final newline remains a real change');
  assert.equal(lineEndingStyle('a\r\nb\r\n'), 'CRLF');
  assert.equal(lineEndingStyle('a\nb\n'), 'LF');
  assert.equal(lineEndingStyle('a\r\nb\n'), 'Mixed (CRLF/LF)');
  assert.equal(lineEndingStyle('a'), 'None');
});

test('preview watcher exclusions support Windows and POSIX paths without hiding spec folders', () => {
  for (const tree of ['baseline', 'work', 'proposed']) {
    assert.equal(isPreviewSnapshotPath(path.win32.join('C:\\Projects\\With Spaces', '.spequi', 'previews', 'job-1', tree, 'src', 'app.js')), true);
    assert.equal(isPreviewSnapshotPath(`/Projects/With Spaces/.spequi/previews/job-1/${tree}`), true);
    assert.equal(isPreviewSnapshotPath(`/Projects/.spequi/previews/job-1/${tree}/src/app.js`), true);
    assert.equal(isPreviewSnapshotPath(`/Projects/openspec/changes/example/specs/${tree}/spec.md`), false);
  }
  assert.equal(isPreviewSnapshotPath('C:\\Projects\\.spequi\\previews\\job-1\\result.json'), false);
});

async function put(root, file, value) { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), value); }
async function fixture(t, from = '\r\n', to = '\n') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx windows review '));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/changes/windows/proposal.md', '# Windows line endings\n');
  const before = ['// first', 'export const count = 1;', '// last', ''].join(from);
  const after = ['// first', 'export const count = 2;', '// last', ''].join(to);
  await put(root, 'src/changed.mjs', before);
  await put(root, 'src/format-only.mjs', 'alpha\r\nbeta\r\n');
  await put(root, 'src/deleted.mjs', 'old\r\nfile\r\n');
  await enqueue(root, { action: 'preview', change: 'windows' });
  const job = await claimNext(root, 'Cross-platform data test');
  await put(job.workingDirectory, 'src/changed.mjs', after);
  await put(job.workingDirectory, 'src/format-only.mjs', 'alpha\nbeta\n');
  await put(job.workingDirectory, 'src/added.mjs', 'new\r\nfile\r\n');
  await fs.unlink(path.join(job.workingDirectory, 'src/deleted.mjs'));
  await updateJob(root, job.id, job.claimToken, 'finish', 'Windows text fixture');
  return { root, job, before, after };
}

test('preview counts, split/unified HTML, comments, raw patches, and apply preserve Windows text bytes', async t => {
  for (const [from, to] of [['\r\n', '\r\n'], ['\r\n', '\n'], ['\n', '\r\n']]) {
    const { root, job, before, after } = await fixture(t, from, to);
    const result = await previewResult(root, job.id);
    const changed = result.changes.find(item => item.file === 'src/changed.mjs');
    assert.equal(changed.additions, 1); assert.equal(changed.deletions, 1);
    assert.equal(applyPatch(before, changed.patch, { autoConvertLineEndings: false }), after);
    assert.ok(result.changes.every(item => !item.file.includes('\\')));
    assert.match(changed.patch, /--- a\/src\/changed.mjs/);
    const format = result.changes.find(item => item.file === 'src/format-only.mjs');
    assert.deepEqual(format.lineEndings, { before: 'CRLF', after: 'LF' });
    assert.equal(format.additions, 0); assert.equal(format.deletions, 0);
    assert.equal(applyPatch('alpha\r\nbeta\r\n', format.patch, { autoConvertLineEndings: false }), 'alpha\nbeta\n');
    const comment = await addComment(root, job.id, { file: 'src/changed.mjs', side: 'proposed', start: 2, body: 'Review this Windows source line.' });
    assert.equal(comment.snippet, 'export const count = 2;');
    const viewer = await startServer({ root, port: 0, quiet: true });
    try {
      for (const mode of ['split', 'unified']) {
        const { document } = parseHTML(await (await fetch(viewer.origin + `/?change=windows&view=preview&job=${job.id}&file=src/changed.mjs&context=all&mode=${mode}`)).text());
        assert.equal(Boolean(document.querySelector('.line-ending-note')), from !== to);
        assert.ok(document.querySelector('[data-review-line="2"][data-review-side="proposed"].has-comments'));
        assert.doesNotMatch(document.querySelector('.review-diff-table tbody').textContent, /\r/);
      }
      const { document } = parseHTML(await (await fetch(viewer.origin + `/?change=windows&view=preview&job=${job.id}&file=src/format-only.mjs`)).text());
      assert.match(document.querySelector('.line-ending-note').textContent, /CRLF to LF/);
      assert.equal(document.querySelectorAll('[data-diff-hunk]').length, 0);
    } finally { await viewer.close(); }
    await applyPreview(root, job.id);
    assert.deepEqual(await fs.readFile(path.join(root, 'src/changed.mjs')), Buffer.from(after));
    assert.deepEqual(await fs.readFile(path.join(root, 'src/added.mjs')), Buffer.from('new\r\nfile\r\n'));
    assert.deepEqual(await fs.readFile(path.join(root, 'src/format-only.mjs')), Buffer.from('alpha\nbeta\n'));
    await assert.rejects(fs.access(path.join(root, 'src/deleted.mjs')));
  }
});

test('line-ending normalization never weakens baseline conflict checks', async t => {
  const { root, job, before } = await fixture(t);
  await put(root, 'src/changed.mjs', before.replace(/\r\n/g, '\n'));
  await assert.rejects(applyPreview(root, job.id), /Conflicts: src\/changed.mjs/);
  await assert.rejects(fs.access(path.join(root, 'src/added.mjs')));
  assert.equal(await fs.readFile(path.join(root, 'src/deleted.mjs'), 'utf8'), 'old\r\nfile\r\n');
});
