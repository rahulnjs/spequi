import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';

const exec = promisify(execFile);
const isWin = process.platform === 'win32';
// This adapter exposes only read-only OpenSpec operations, never arbitrary commands.
export async function openspecJSON(root, operation, change = '') {
  if (change && (typeof change !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/.test(change))) throw new Error('Invalid change name');
  const args = {
    context: ['context', '--json'], list: ['list', '--json'],
    status: ['status', '--change', change, '--json'],
    apply: ['instructions', 'apply', '--change', change, '--json'],
    validate: ['validate', change, '--type', 'change', '--strict', '--json', '--no-interactive']
  }[operation];
  if (!args || (['status', 'apply', 'validate'].includes(operation) && !change)) throw new Error('Unsupported local OpenSpec operation');
  let stdout;
  try { ({ stdout } = await exec('openspec', args, { cwd: root, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: !isWin, shell: isWin, env: { ...process.env, NO_COLOR: '1', DO_NOT_TRACK: '1', OPENSPEC_TELEMETRY_DISABLED: '1' } })); }
  catch (error) {
    if (error.killed) throw new Error('OpenSpec timed out. Retry the local check.');
    if (!error.stdout) throw new Error('OpenSpec CLI is unavailable or could not run. Install it in this environment and retry.');
    stdout = error.stdout;
  }
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('The installed OpenSpec CLI returned an incompatible response.'); }
  if (result.error) throw new Error(result.error.message || 'OpenSpec could not resolve this workflow');
  return result;
}

export async function localReadiness(root, change) {
  const context = await openspecJSON(root, 'context');
  if (!context.root?.path || await fs.realpath(context.root.path) !== await fs.realpath(root)) throw new Error('OpenSpec resolves to a different project or external store. Open that root explicitly before operating.');
  const [status, listing, apply] = await Promise.all([openspecJSON(root, 'status', change), openspecJSON(root, 'list'), openspecJSON(root, 'apply', change)]);
  const entry = listing.changes?.find(item => item.name === change);
  if (typeof status.schemaName !== 'string' || !Array.isArray(status.artifacts) || status.artifacts.some(item => !item || typeof item.id !== 'string' || !['done', 'skipped', 'ready', 'blocked'].includes(item.status)) || !['ready', 'blocked', 'all_done'].includes(apply.state) || !entry || !Number.isInteger(entry.totalTasks) || !Number.isInteger(entry.completedTasks) || entry.completedTasks < 0 || entry.completedTasks > entry.totalTasks) throw new Error('OpenSpec did not return valid artifact and task readiness.');
  return { schema: status.schemaName, artifacts: status.artifacts, artifactPaths: status.artifactPaths || {},
    planningComplete: status.artifacts.every(item => ['done', 'skipped'].includes(item.status)),
    nextArtifact: status.artifacts.find(item => item.status === 'ready')?.id || null,
    tasks: { total: entry.totalTasks, done: entry.completedTasks }, applyState: apply.state, checkedAt: new Date().toISOString() };
}
