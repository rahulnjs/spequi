import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { compareLines, lineEndingStyle } from './diffs.mjs';
import { captureSpecLinks } from './spec-context.mjs';
import { walk, within, runtime, safeID, exists, writeJSON, readJSON, withLock } from './files.mjs';

const ignoredDirs = new Set(['.git', '.spequi', '.openspec-ui', '.change-viewer', 'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.turbo', 'coverage', '.venv', 'venv', '__pycache__', '.impeccable']);
export function eligible(relative) {
  const parts = relative.split('/');
  return !parts.some(part => ignoredDirs.has(part) || /^\.env(?:\.|$)/.test(part) || /\.(pem|key|p12|pfx|tgz)$/i.test(part) || /^(id_rsa|id_ed25519|credentials(?:\.json)?|\.npmrc|\.netrc|\.DS_Store)$/.test(part));
}
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const basePath = (root, id) => runtime(root, 'previews', safeID(id));
export async function createPreview(root, id) {
  const dir = basePath(root, id), baseline = path.join(dir, 'baseline'), work = path.join(dir, 'work');
  await fs.mkdir(baseline, { recursive: true });
  await fs.mkdir(work, { recursive: true });
  const files = await walk(root, { filter: eligible });
  let total = 0;
  const manifest = {};
  for (const relative of files) {
    const source = await within(root, relative);
    const stat = await fs.stat(source);
    total += stat.size;
    if (stat.size > 10 * 1024 * 1024 || total > 150 * 1024 * 1024) throw new Error('Snapshot exceeds 10 MB per file or 150 MB total; use a smaller project');
    const content = await fs.readFile(source);
    manifest[relative] = { hash: hash(content), mode: stat.mode & 0o777 };
    for (const dest of [baseline, work]) { const file = await within(dest, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content, { mode: stat.mode & 0o777 }); }
  }
  await writeJSON(path.join(dir, 'manifest.json'), manifest);
  return work;
}
async function getBuffer(root, file) { const absolute = await within(root, file); return await exists(absolute) ? fs.readFile(absolute) : null; }
export async function freezePreview(root, id) {
  const dir = basePath(root, id), baseline = path.join(dir, 'baseline'), work = path.join(dir, 'work'), proposed = path.join(dir, 'proposed');
  if (await exists(path.join(dir, 'result.json'))) throw new Error('This preview is already frozen');
  const manifest = await readJSON(path.join(dir, 'manifest.json'));
  if (!manifest) throw new Error('Preview baseline is missing');
  const files = new Set([...Object.keys(manifest), ...await walk(work, { filter: eligible })]);
  const changes = [], unsupported = [];
  await fs.mkdir(proposed, { recursive: true });
  for (const file of [...files].sort()) {
    const before = await getBuffer(baseline, file), after = await getBuffer(work, file);
    if ((before && after && before.equals(after)) || (!before && !after)) continue;
    if (after?.length > 2 * 1024 * 1024 || before?.length > 2 * 1024 * 1024 || before?.includes(0) || after?.includes(0)) { unsupported.push(file); continue; }
    if (after) { const target = await within(proposed, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, after, { mode: (await fs.stat(await within(work, file))).mode & 0o777 }); }
    const oldText = before?.toString('utf8') || '', newText = after?.toString('utf8') || '';
    const lines = compareLines(oldText, newText);
    changes.push({ file, type: !before ? 'added' : !after ? 'deleted' : 'modified', beforeHash: before ? hash(before) : null, afterHash: after ? hash(after) : null, lineEndings: { before: lineEndingStyle(oldText), after: lineEndingStyle(newText) }, additions: lines.filter(part => part.added).reduce((sum, part) => sum + part.count, 0), deletions: lines.filter(part => part.removed).reduce((sum, part) => sum + part.count, 0), patch: createTwoFilesPatch(before ? `a/${file}` : '/dev/null', after ? `b/${file}` : '/dev/null', oldText, newText) });
  }
  const result = { changes, unsupported, completedAt: new Date().toISOString(), applied: false };
  result.specContext = await captureSpecLinks(root, id, changes);
  await writeJSON(path.join(dir, 'result.json'), result);
  return result;
}
export async function previewResult(root, id) { return readJSON(path.join(basePath(root, id), 'result.json')); }
export async function previewContents(root, id, file) {
  const result = await previewResult(root, id);
  if (!result?.changes.some(change => change.file === file)) throw new Error('File is not part of this preview');
  const dir = basePath(root, id);
  return { before: (await getBuffer(path.join(dir, 'baseline'), file))?.toString('utf8') || '', after: (await getBuffer(path.join(dir, 'proposed'), file))?.toString('utf8') || '' };
}
export async function applyPreview(root, id) {
  return withLock(runtime(root, 'apply.lock'), async () => {
    const dir = basePath(root, id), result = await previewResult(root, id);
    if (!result || result.applied) throw new Error('Preview is unavailable or already applied');
    if (result.unsupported.length) throw new Error('Preview contains unsupported binary or oversized changes; apply is disabled');
    if (!result.changes.length) throw new Error('Preview contains no file changes');
    const conflicts = [], writes = [];
    const manifest = await readJSON(path.join(dir, 'manifest.json'));
    for (const change of result.changes) {
      if (!eligible(change.file)) throw new Error('Preview contains an excluded path');
      const target = await within(root, change.file);
      const current = await getBuffer(root, change.file);
      if ((current ? hash(current) : null) !== change.beforeHash) conflicts.push(change.file);
      const proposed = await getBuffer(path.join(dir, 'proposed'), change.file);
      if ((proposed ? hash(proposed) : null) !== change.afterHash) throw new Error(`Proposed file changed after review: ${change.file}`);
      const original = await getBuffer(path.join(dir, 'baseline'), change.file);
      if ((original ? hash(original) : null) !== change.beforeHash) throw new Error('Preview baseline was modified');
      writes.push({ ...change, target, current, proposed, mode: manifest[change.file]?.mode ?? (proposed ? (await fs.stat(await within(path.join(dir, 'proposed'), change.file))).mode & 0o777 : 0o644) });
    }
    if (conflicts.length) throw new Error(`Project changed since preview. No files applied. Conflicts: ${conflicts.join(', ')}`);
    const backupRoot = runtime(root, 'backups', safeID(id));
    await fs.mkdir(backupRoot, { recursive: true });
    for (const write of writes) if (write.current) { const backup = await within(backupRoot, write.file); await fs.mkdir(path.dirname(backup), { recursive: true }); await fs.writeFile(backup, write.current, { mode: write.mode }); }
    await writeJSON(path.join(backupRoot, 'changes.json'), writes.map(({ file, type, beforeHash, afterHash }) => ({ file, type, beforeHash, afterHash })));
    const completed = [];
    try {
      for (const write of writes) {
        await within(root, write.file);
        completed.push(write);
        if (write.proposed) {
          await fs.mkdir(path.dirname(write.target), { recursive: true });
          const temp = `${write.target}.spequi-${id}.tmp`;
          await fs.writeFile(temp, write.proposed, { mode: write.mode });
          await fs.rename(temp, write.target);
        } else await fs.unlink(write.target);
      }
      result.applied = true; result.appliedAt = new Date().toISOString();
      await writeJSON(path.join(dir, 'result.json'), result);
      return result;
    } catch (error) {
      for (const write of completed.reverse()) {
        if (write.current) await fs.writeFile(write.target, write.current, { mode: write.mode });
        else await fs.unlink(write.target).catch(() => {});
      }
      throw error;
    }
  });
}
