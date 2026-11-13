import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const exists = async file => fs.access(file).then(() => true, () => false);
export const readJSON = async (file, fallback = null) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await fs.rename(temp, file);
}
export async function within(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || path.isAbsolute(relative)) throw new Error('Invalid relative path');
  const base = await fs.realpath(root);
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error('Path is outside the project');
  let cursor = base;
  for (const part of path.relative(base, target).split(path.sep)) {
    cursor = path.join(cursor, part);
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links are not supported'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
export async function walk(root, { filter = () => true, maxFiles = 15000 } = {}) {
  const files = [];
  async function visit(dir, prefix = '') {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink() || !filter(relative, entry)) continue;
      if (entry.isDirectory()) await visit(path.join(dir, entry.name), relative);
      else if (entry.isFile()) { files.push(relative); if (files.length > maxFiles) throw new Error(`Project exceeds ${maxFiles} files; narrow the project root`); }
    }
  }
  await visit(root);
  return files;
}
export async function withLock(file, action) {
  const handle = await fs.open(file, 'wx').catch(error => { if (error.code === 'EEXIST') throw new Error('Another operation is in progress; retry shortly'); throw error; });
  try { return await action(); } finally { await handle.close(); await fs.unlink(file).catch(() => {}); }
}
export function runtime(root, ...segments) { return path.join(root, '.spequi', ...segments); }
export function isPreviewSnapshotPath(file) { return /(?:^|[\\/])\.spequi[\\/]previews[\\/][^\\/]+[\\/](?:baseline|work|proposed)(?:[\\/]|$)/.test(file); }
export function safeID(value) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(value || '')) throw new Error('Invalid request ID'); return value; }
