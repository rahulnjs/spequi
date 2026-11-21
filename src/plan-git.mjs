import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { inventory, escape as e } from './specs.mjs';
import { within, runtime, withLock, readJSON, writeJSON } from './files.mjs';
import { localReadiness } from './openspec-cli.mjs';
import { listJobs, pendingStatuses, enqueue } from './jobs.mjs';

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
    const ignored = lines(await git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--', ...paths]));
    const remotes = (await git(root, ['remote'])).trim().split('\n').filter(Boolean);
    const configured = await Promise.all([`branch.${branch}.pushRemote`, 'remote.pushDefault', `branch.${branch}.remote`].map(key => git(root, ['config', '--get', key]).then(value => value.trim(), () => '')));
    const destination = configured.find(Boolean) || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : '');
    const destinations = await Promise.all(remotes.map(async remote => [remote, hash(await git(root, ['remote', 'get-url', '--push', '--all', remote]))]));
    const index = await git(root, ['ls-files', '--stage', '-z', '--', ...paths]);
    return { branch, head, files: paths, changed: [...new Set([...changed, ...untracked])].filter(file => !ignored.includes(file)), ignored, remotes, destination, snapshot: hash(JSON.stringify({ branch, head, content, index, ignored, destinations, destination })) };
  } catch { return { unavailable: 'Git is unavailable or no named branch is checked out. Resolve it in your CLI.' }; }
}

export async function publishPlan(root, { change, snapshot, message, confirmed }) {
  if (confirmed !== 'yes') throw new Error('Confirm the branch, planning files and push before publishing.');
  return withLock(runtime(root, 'enqueue.lock'), async () => {
    if ((await listJobs(root)).some(job => pendingStatuses.includes(job.status))) throw new Error('Finish the active agent request before publishing the plan.');
    const selected = (await inventory(root)).changes.find(item => item.id === change && !item.archived);
    if (!selected || !(await localReadiness(root, change)).planningComplete) throw new Error('Complete the planning artifacts before publishing.');
    const state = await planGitInfo(root, selected);
    if (state.unavailable) throw new Error(state.unavailable);
    if (state.snapshot !== snapshot) throw new Error('The branch, planning files or remote changed. Refresh and review them again.');
    if (state.ignored.length) throw new Error('Some spec files are ignored by Git. Update the ignore rules in your CLI, then refresh.');
    const remote = state.destination;
    if (!state.remotes.includes(remote)) throw new Error('Set up a default push destination in your CLI, then refresh.');
    if (state.changed.length && (typeof message !== 'string' || !message.trim() || message.length > 500)) throw new Error('Enter a commit message under 500 characters.');
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
      // A local display record must not turn a successful push into a reported failure.
      try {
        const after = await planGitInfo(root, selected);
        if (after.snapshot) await writeJSON(runtime(root, 'published-plans', `${hash(change)}.json`), { snapshot: after.snapshot, commit, pushedAt: new Date().toISOString() });
      } catch {}
      return { summary: `${committed ? 'Committed planning files and pushed' : 'Pushed'} ${commit.slice(0, 8)} to ${remote}/${state.branch}.` };
    } catch (error) {
      return { pushError: true, summary: `Commit ${commit.slice(0, 8)} is kept locally; push failed. Resolve the remote/authentication issue in your CLI, refresh, and retry. ${failure(error)}` };
    }
  }, { waitMs: 0 });
}

export async function requestCommitMessage(root, { change, snapshot, requestKey }) {
  const selected = (await inventory(root)).changes.find(item => item.id === change && !item.archived);
  if (!selected || !(await localReadiness(root, change)).planningComplete) throw new Error('Complete the plan before generating a commit message.');
  const state = await planGitInfo(root, selected);
  if (state.ignored?.length) throw new Error('Some spec files are ignored by Git. Update the ignore rules before generating a message.');
  if (state.unavailable || !state.changed?.length) throw new Error(state.unavailable || 'There are no planning changes to describe.');
  if (state.snapshot !== snapshot) throw new Error('The plan changed. Refresh before generating a message.');
  const job = await enqueue(root, { action: 'commit-message', change, planSnapshot: snapshot, requestKey });
  return { job: { id: job.id, action: job.action, change, status: job.status } };
}

export async function renderPlanGit(root, selected, disabled = false, icon = () => '', expanded = false) {
  if (selected.archived) return '';
  const state = await planGitInfo(root, selected);
  if (state.unavailable) return `<section class="plan-git-unavailable" role="status"><h2>Git needs attention</h2><p>${e(state.unavailable)}</p></section>`;
  const publication = await readJSON(runtime(root, 'published-plans', `${hash(selected.id)}.json`));
  const published = Boolean(publication?.snapshot === state.snapshot && !state.changed.length && !state.ignored.length);
  const jobs = await listJobs(root);
  const generation = jobs.find(job => !job.hiddenAt && job.action === 'commit-message' && job.change === selected.id && job.planSnapshot === state.snapshot);
  const generating = generation && pendingStatuses.includes(generation.status);
  const generated = generation?.status === 'completed' ? generation.result : '';
  const blocked = disabled || jobs.some(job => pendingStatuses.includes(job.status));
  const destinationReady = state.remotes.includes(state.destination), hasChanges = state.changed.length > 0;
  const fields = `<input type="hidden" name="change" value="${e(selected.id)}"><input type="hidden" name="snapshot" value="${state.snapshot}">`;
  const files = [...new Set([...state.changed, ...state.ignored])];
  const order = file => file.endsWith('/proposal.md') ? 0 : file.includes('/specs/') ? 1 : file.endsWith('/design.md') ? 2 : file.endsWith('/tasks.md') ? 3 : 4;
  files.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const prefix = `openspec/changes/${selected.id}/`;
  const fileTitle = file => {
    const relative = file.slice(prefix.length);
    return ({ 'proposal.md': 'Proposal', 'design.md': 'Design', 'tasks.md': 'Tasks', '.openspec.yaml': 'Change metadata' })[relative] || (relative.startsWith('specs/') ? `Specs · ${relative.slice(6).replace(/\/spec\.md$/, '').replaceAll('-', ' ')}` : relative);
  };
  const fileRows = files.map(file => {
    const relative = file.slice(prefix.length), ignored = state.ignored.includes(file);
    const url = '/?' + new URLSearchParams({ change: selected.id, view: 'studio', stage: 'shape', plan: relative });
    const content = `${icon('file')}<span class="plan-file-copy"><strong>${e(fileTitle(file))}</strong><small>${e(relative)}</small></span>${selected.files.includes(file) ? icon('chevron') : ''}`;
    return `<li>${selected.files.includes(file) ? `<a href="${e(url)}" hx-get="${e(url)}" hx-target="#workspace" hx-swap="outerHTML" hx-push-url="true" title="Review ${e(relative)}">${content}</a>` : `<div>${content}</div>`}${ignored ? '<span class="plan-file-ignored">Ignored by Git</span>' : ''}</li>`;
  }).join('');
  const warning = state.ignored.length ? `<div class="plan-git-warning" role="status"><strong>${state.ignored.length === 1 ? 'A spec file is' : 'Some spec files are'} ignored by Git</strong><p>Update this project’s ignore rules to include these documents, then refresh. Nothing will be committed or pushed while they are excluded.</p></div>` : !destinationReady ? '<div class="plan-git-warning" role="status"><strong>No push destination is configured</strong><p>Connect this project to your Git repository in the CLI, then refresh.</p></div>' : '';
  const status = published ? 'Pushed to Git' : state.ignored.length ? 'Git needs attention' : hasChanges ? `${state.changed.length} files ready` : 'No new changes';
  const message = `<div class="plan-message-heading"><label id="plan-message-label" for="plan-commit-message">Commit message</label><form id="plan-message-form" data-lifecycle-form data-plan-message action="/api/plan-git/message" method="post">${fields}<button type="submit" class="button plan-generate-message" ${blocked || !hasChanges || state.ignored.length ? 'disabled' : ''}>${icon('spark')}${generating ? generation.status === 'queued' ? 'Waiting for agent…' : 'Writing message…' : 'Generate with agent'}</button><div data-lifecycle-feedback role="status" aria-live="polite"></div></form></div>`;
  const progress = generating ? '<p class="plan-generation-note" role="status">Your agent is reviewing these documents to suggest a message. You can edit it before pushing.</p>' : generation?.status === 'failed' ? `<p class="plan-generation-note error-message" role="status">${e(generation.result)}</p>` : '';
  const defaultMessage = `docs: document ${selected.id.replaceAll('-', ' ')}`;
  return `<${expanded ? 'section' : 'details'} class="plan-publish" id="plan-publish">${expanded ? '' : `<summary>${icon('git')}<strong>Push spec files</strong><span>${status}</span>${icon('chevron')}</summary>`}<div class="plan-publish-body">${published ? `<div class="plan-published" role="status">${icon('check')}<div><strong>Spec files pushed</strong><p>Your documents are saved in Git. Finish planning to continue.</p></div></div>` : ''}${warning}<section class="plan-files-section" aria-labelledby="plan-files-title"><div class="plan-files-heading"><h2 id="plan-files-title">Spec files to save</h2><span>${files.length} ${files.length === 1 ? 'file' : 'files'}</span></div>${files.length ? `<ul class="plan-file-list">${fileRows}</ul>` : '<p class="plan-files-empty">Git found no uncommitted spec file changes. You can push the commits already saved on this branch.</p>'}</section>${message}${progress}<form id="plan-publish-form" data-lifecycle-form data-plan-publish data-plan-has-changes="${hasChanges}" data-plan-files="${e(JSON.stringify(state.changed))}" data-branch="${e(state.branch)}" data-message-job="${generated ? e(generation.id) : ''}" data-generated-message="${e(generated)}" action="/api/plan-git" method="post">${fields}<input type="hidden" name="confirmed" value="yes"><textarea id="plan-commit-message" name="message" aria-labelledby="plan-message-label" aria-describedby="plan-message-help" ${hasChanges ? 'required' : ''} maxlength="500" rows="2" placeholder="${hasChanges ? 'Describe what these spec files define…' : 'No new spec file changes to describe'}" ${blocked || !hasChanges || state.ignored.length ? 'readonly' : ''}>${e(hasChanges ? generated || defaultMessage : '')}</textarea><p id="plan-message-help" class="plan-message-help">${state.ignored.length ? 'Resolve the Git issue above to generate a message.' : hasChanges ? 'Write your own message or let your agent draft one.' : 'Message generation is available when there are spec file changes.'}</p><div class="plan-publish-actions"><p>${hasChanges ? 'Creates a commit for these files, then pushes your branch.' : 'Pushes existing commits; no new commit is created.'}</p><button type="submit" class="button primary" ${published || blocked || !destinationReady || state.ignored.length || !hasChanges && !state.head ? 'disabled' : ''}>${published ? 'Pushed to Git' : 'Push spec files'} ${icon(published ? 'check' : 'arrow')}</button></div><div data-lifecycle-feedback role="status" aria-live="polite"></div></form><details class="plan-git-details"><summary>Branch &amp; push details</summary><p>Current branch: <strong>${e(state.branch)}</strong></p><p>Unrelated staged files stay staged. Earlier commits on this branch will also be pushed.</p></details></div></${expanded ? 'section' : 'details'}>`;
}
