import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readJSON, writeJSON, runtime, withLock } from './files.mjs';

const run = promisify(execFile);
export async function validateBranch(root, branch) {
  if (typeof branch !== 'string' || branch.length > 200) throw new Error('Use a Git branch name under 200 characters.');
  branch = branch.trim();
  if (branch && (branch.startsWith('-') || branch.includes('@{') || /\s/.test(branch))) throw new Error('Enter a valid Git branch name.');
  if (branch) await run('git', ['check-ref-format', '--branch', branch], { cwd: root, timeout: 5000 }).catch(() => { throw new Error('Enter a valid Git branch name.'); });
  return branch;
}
export async function changeBranch(root, change) {
  const branches = await readJSON(runtime(root, 'change-branches.json'));
  const saved = branches && Object.hasOwn(branches, change) ? branches[change] : null;
  return typeof saved === 'string' ? saved : saved?.name || '';
}
async function branchState(root, branch) {
  const current = await run('git', ['branch', '--show-current'], { cwd: root, timeout: 5000 });
  const exists = await run('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root, timeout: 5000 }).then(() => true, error => { if (error.code === 1) return false; throw error; });
  return { current: current.stdout.trim() === branch, exists };
}
export async function confirmChangeBranch(root, change, branch, confirmed = false) {
  if (!branch) return false;
  const saved = (await readJSON(runtime(root, 'change-branches.json')))?.[change];
  if (confirmed === true || saved?.name === branch && saved.reuseConfirmed === true) return true;
  const state = await branchState(root, branch);
  if (state.exists && !state.current) throw Object.assign(new Error(`Branch “${branch}” already exists. Switch to and reuse it for this change?`), { code: 'branch_confirmation_required' });
  return state.current;
}
export async function saveChangeBranch(root, change, branch, reuseConfirmed = false) {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(change || '')) throw new Error('Select an active change.');
  branch = await validateBranch(root, branch);
  await withLock(runtime(root, 'branches.lock'), async () => {
    const branches = await readJSON(runtime(root, 'change-branches.json')) || {};
    if (branch) branches[change] = { name: branch, reuseConfirmed }; else delete branches[change];
    await writeJSON(runtime(root, 'change-branches.json'), branches);
  });
  return branch;
}
export async function checkoutChangeBranch(root, branch, reuseConfirmed = false) {
  if (!branch) return;
  await validateBranch(root, branch);
  try {
    const { current, exists } = await branchState(root, branch);
    if (current) return;
    if (exists && !reuseConfirmed) throw new Error('This branch now exists. Confirm reuse in Workflow before retrying.');
    await run('git', exists ? ['switch', branch] : ['switch', '-c', branch], { cwd: root, timeout: 10000 });
  } catch (error) {
    throw new Error(`Could not switch to branch ${branch}. Resolve local changes or Git state in your CLI and retry. ${String(error.stderr || error.message).trim().slice(0, 1000)}`);
  }
}
