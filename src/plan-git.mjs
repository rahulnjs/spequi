import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { inventory, escape as e } from './specs.mjs';
import { within, runtime, withLock } from './files.mjs';
import { localReadiness } from './openspec-cli.mjs';
import { listJobs, pendingStatuses } from './jobs.mjs';

const exec = promisify(execFile);
const hash = value => createHash('sha256').update(value).digest('hex');
const git = async (root, args, timeout = 10000) => (await exec('git', ['--literal-pathspecs', ...args], { cwd: root, timeout, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' }, windowsHide: true })).stdout;
const lines = value => value.split('\0').filter(Boolean);
const failure = error => String(error.stderr || error.message).replace(/(?:https?|ssh):\/\/\S+/g, '[remote]').trim().slice(0, 1000);

export async function planGitInfo(root, selected) {
  try {
    if (!selected || selected.archived) return { unavailable: 'Select an active change.' };
    const branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
    const head = await git(root, ['rev-parse', '--verify', 'HEAD']).then(value => value.trim(), () => '');
    const prefix = `openspec/changes/${selected.id}/`;
    const tracked = lines(await git(root, ['ls-files', '-z', '--', prefix]));
    const files = [...new Set([...selected.files, prefix + '.openspec.yaml', ...tracked])].filter(file => file.startsWith(prefix) && (file.endsWith('.md') || file === prefix + '.openspec.yaml')).sort();
    const content = [];
    for (const file of files) {
      const absolute = await within(root, file);
      const value = await fs.readFile(absolute).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (value || tracked.includes(file)) content.push([file, value ? hash(value) : null]);
    }
    const paths = content.map(([file]) => file);
    if (!paths.length) return { unavailable: 'No planning files to publish.' };
    const changed = head ? lines(await git(root, ['diff', '--name-only', '-z', 'HEAD', '--', ...paths])) : paths;
    const untracked = lines(await git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths]));
    const remotes = (await git(root, ['remote'])).trim().split('\n').filter(Boolean);
    const destinations = await Promise.all(remotes.map(async remote => [remote, hash(await git(root, ['remote', 'get-url', '--push', '--all', remote]))]));
    const index = await git(root, ['ls-files', '--stage', '-z', '--', ...paths]);
    return { branch, head, files: paths, changed: [...new Set([...changed, ...untracked])], remotes, snapshot: hash(JSON.stringify({ branch, head, content, index, destinations })) };
  } catch { return { unavailable: 'Git is unavailable or no named branch is checked out. Resolve it in your CLI.' }; }
}

export async function publishPlan(root, { change, snapshot, remote, message, confirmed }) {
  if (confirmed !== 'yes') throw new Error('Confirm the branch, planning files and push before publishing.');
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw new Error('Enter a commit message under 500 characters.');
  return withLock(runtime(root, 'enqueue.lock'), async () => {
    if ((await listJobs(root)).some(job => pendingStatuses.includes(job.status))) throw new Error('Finish the active agent request before publishing the plan.');
    const selected = (await inventory(root)).changes.find(item => item.id === change && !item.archived);
    if (!selected || !(await localReadiness(root, change)).planningComplete) throw new Error('Complete the planning artifacts before publishing.');
    const state = await planGitInfo(root, selected);
    if (state.unavailable) throw new Error(state.unavailable);
    if (state.snapshot !== snapshot) throw new Error('The branch, planning files or remote changed. Refresh and review them again.');
    if (!state.remotes.includes(remote)) throw new Error('Choose an existing Git remote.');
    let commit = state.head, committed = false;
    try {
      if (state.changed.length) {
        await git(root, ['add', '--all', '--', ...state.changed]);
        await git(root, ['commit', '--only', '-m', message.trim(), '--', ...state.changed], 60000);
        commit = (await git(root, ['rev-parse', 'HEAD'])).trim(); committed = true;
      }
    } catch (error) {
      const after = await git(root, ['rev-parse', 'HEAD']).then(value => value.trim(), () => '');
      if (after && after !== state.head) return { pushError: true, summary: `Commit ${after.slice(0, 8)} was created, but Git reported an error. Nothing was pushed. Resolve it in your CLI and retry. ${failure(error)}` };
      throw new Error(`Could not commit planning files. Unrelated staged edits were kept. ${failure(error)}`);
    }
    if (!commit) throw new Error('There is no commit to push.');
    try {
      if ((await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() !== state.branch) throw new Error('The checked-out branch changed.');
      await git(root, ['push', '--', remote, `${commit}:refs/heads/${state.branch}`], 60000);
      return { summary: `${committed ? 'Committed planning files and pushed' : 'Pushed'} ${commit.slice(0, 8)} to ${remote}/${state.branch}.` };
    } catch (error) {
      return { pushError: true, summary: `Commit ${commit.slice(0, 8)} is kept locally; push failed. Resolve the remote/authentication issue in your CLI, refresh, and retry. ${failure(error)}` };
    }
  }, { waitMs: 0 });
}

export async function renderPlanGit(root, selected, disabled = false) {
  if (selected.archived) return '';
  const state = await planGitInfo(root, selected);
  if (state.unavailable) return `<details class="plan-publish"><summary>Save plan to Git</summary><p>${e(state.unavailable)}</p></details>`;
  return `<details class="plan-publish" id="plan-publish"><summary>Save plan to Git <span>Optional</span></summary><form id="plan-publish-form" data-lifecycle-form data-plan-publish data-branch="${e(state.branch)}" action="/api/plan-git" method="post"><input type="hidden" name="change" value="${e(selected.id)}"><input type="hidden" name="snapshot" value="${state.snapshot}"><input type="hidden" name="confirmed" value="yes"><p>Branch: <strong>${e(state.branch)}</strong>. Only this change’s planning files enter the commit. Push also publishes earlier commits on this branch.</p><details><summary>${state.changed.length} planning files to commit</summary><ul>${state.changed.map(file => `<li><code>${e(file)}</code></li>`).join('') || '<li>No new planning changes; push the existing commit.</li>'}</ul></details><label>Commit message<input name="message" required maxlength="500" value="${e(`docs: plan ${selected.id}`)}" ${disabled ? 'disabled' : ''}></label><label>Remote<select name="remote" required ${disabled ? 'disabled' : ''}>${state.remotes.map(remote => `<option value="${e(remote)}" ${remote === 'origin' ? 'selected' : ''}>${e(remote)}</option>`).join('')}</select></label>${!state.remotes.length ? '<p>Add a Git remote in your CLI first.</p>' : ''}<button type="submit" class="button" ${disabled || !state.remotes.length ? 'disabled' : ''}>${state.changed.length ? 'Commit & push plan' : 'Push branch'}</button><div data-lifecycle-feedback role="status" aria-live="polite"></div></form></details>`;
}
