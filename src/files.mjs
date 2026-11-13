import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export const exists = async file => fs.access(file).then(() => true, () => false);
export const readJSON = async (file, fallback = null) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
export async function writeJSON(file, value, { rename = fs.rename } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, file); break; }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
        await delay(20 * (attempt + 1));
      }
    }
  } finally { await fs.rm(temp, { force: true }).catch(() => {}); }
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
export async function lockStatus(file) {
  try {
    const stat = await fs.stat(file);
    let owner;
    try { owner = JSON.parse(await fs.readFile(file, 'utf8')); } catch {}
    let alive = false;
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); alive = true; } catch (error) { alive = error.code !== 'ESRCH'; }
    }
    const age = Date.now() - stat.mtimeMs;
    return { exists: true, owner, age, stale: owner?.pid ? !alive : age > 30000, signature: `${stat.dev}:${stat.ino}:${stat.mtimeMs}:${stat.size}` };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
}
export async function acquireLock(file, { waitMs = 2000 } = {}) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs, token = randomUUID();
  for (;;) {
    let handle;
    try { handle = await fs.open(file, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const state = await lockStatus(file);
      if (!state.exists) continue;
      if (state.stale) {
        // Serialize recovery too: two consumers must never unlink each other's new lock.
        const endRecovery = await acquireLock(`${file}.recovery`, { waitMs });
        try {
          const current = await lockStatus(file);
          if (current.exists && current.stale && current.signature === state.signature) await fs.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
        } finally { await endRecovery(); }
        continue;
      }
      if (Date.now() >= deadline) throw Object.assign(new Error(`Another operation is in progress (${path.basename(file)}); the queue is busy, not empty. Retry shortly.`), { code: 'LOCK_BUSY' });
      await delay(25); continue;
    }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() })); }
    catch (error) { await handle.close(); await fs.unlink(file).catch(() => {}); throw error; }
    await handle.close();
    return async () => {
      const state = await lockStatus(file);
      if (state.owner?.token === token) {
        for (let attempt = 0; ; attempt++) {
          try { await fs.unlink(file); break; }
          catch (error) {
            if (error.code === 'ENOENT') break;
            if (attempt >= 5 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
            await delay(20 * (attempt + 1));
          }
        }
      }
    };
  }
}
export async function withLock(file, action, options) {
  const release = await acquireLock(file, options);
  try { return await action(); } finally { await release(); }
}
export async function cleanupTemporaryFiles(root, { olderThan = 300000 } = {}) {
  // Only Spequi's unique JSON staging files; never source, snapshots or active writes.
  let removed = 0;
  const files = await walk(runtime(root), { filter: relative => !/^(?:previews|backups)(?:\/|$)/.test(relative) });
  for (const file of files) if (/\.json\.[a-f0-9-]{36}\.tmp$/.test(file)) {
    const absolute = path.join(runtime(root), file);
    const stat = await fs.stat(absolute).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > olderThan) { await fs.rm(absolute, { force: true }); removed++; }
  }
  return removed;
}
export function runtime(root, ...segments) { return path.join(root, '.spequi', ...segments); }
export function isPreviewSnapshotPath(file) { return /(?:^|[\\/])\.spequi[\\/]previews[\\/][^\\/]+[\\/](?:baseline|work|proposed)(?:[\\/]|$)/.test(file); }
export function safeID(value) { if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(value || '')) throw new Error('Invalid request ID'); return value; }
