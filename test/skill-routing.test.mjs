import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initProject, installSkill } from '../src/project.mjs';
import { enqueue, claimNext, updateJob, listJobs } from '../src/jobs.mjs';
import { previewContents } from '../src/previews.mjs';
import { addComment, exportFeedback } from '../src/review-store.mjs';

async function put(root, file, content) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); }
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-skill-routing-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  await put(root, 'openspec/changes/feature/proposal.md', '# Feature\n');
  await put(root, 'openspec/changes/feature/tasks.md', '- [ ] Enable the feature\n');
  await put(root, 'app.mjs', 'export const enabled = false;\n');
  return root;
}

test('one consumer claims consecutive workflows with trusted routes and preserves ownership and preview boundaries', async t => {
  const root = await fixture(t);
  const expected = [
    ['explore', 'openspec-explore', false], ['propose', 'openspec-propose', true],
    ['preview', 'openspec-apply-change', true], ['verify', 'openspec-verify-change', false],
    ['archive', 'openspec-archive-change', true]
  ];
  for (const [action, skill, required] of expected) {
    const queued = await enqueue(root, { action, change: 'feature', message: 'Inspect this requested workflow.', workflow: { skill: 'untrusted-skill', directory: '/outside' } });
    const job = await claimNext(root, 'Existing agent session');
    assert.equal(job.id, queued.id);
    assert.deepEqual(job.workflow, { mode: 'same-session', skill, required, directory: job.workingDirectory, protocolDirectory: root, change: 'feature' });
    assert.equal(job.agent, 'Existing agent session');
    await assert.rejects(updateJob(root, job.id, 'wrong-owner', 'finish', 'invalid'), /token/);
    if (action === 'preview') {
      assert.notEqual(job.workflow.directory, root);
      await put(job.workflow.directory, 'app.mjs', 'export const enabled = true;\n');
      await put(job.workflow.directory, 'openspec/changes/feature/tasks.md', '- [x] Enable the feature\n');
      assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'export const enabled = false;\n');
      assert.equal(await fs.readFile(path.join(root, 'openspec/changes/feature/tasks.md'), 'utf8'), '- [ ] Enable the feature\n');
    } else assert.equal(job.workflow.directory, root);
    await updateJob(root, job.id, job.claimToken, 'finish', 'Scoped workflow completed by the existing consumer');
    if (action === 'preview') assert.equal((await previewContents(root, job.id, 'app.mjs')).after, 'export const enabled = true;\n');
  }
  assert.equal(await claimNext(root, 'Existing agent session'), null);
  assert.ok((await listJobs(root)).every(job => job.status === 'completed' && job.agent === 'Existing agent session'));
});

test('feedback routes retain exact immutable inputs while impact needs no additional skill', async t => {
  const root = await fixture(t);
  await enqueue(root, { action: 'preview', change: 'feature' });
  const preview = await claimNext(root, 'Existing agent session');
  await put(preview.workingDirectory, 'app.mjs', 'export const enabled = true;\n');
  await updateJob(root, preview.id, preview.claimToken, 'finish', 'Fixture preview');
  await addComment(root, preview.id, { file: 'app.mjs', body: 'Describe the enabled default.' });
  const feedback = await exportFeedback(root, preview.id);
  await enqueue(root, { action: 'update-specs', reviewPreview: preview.id, feedbackId: feedback.id });
  const update = await claimNext(root, 'Existing agent session');
  assert.equal(update.workflow.skill, 'openspec-update-change'); assert.equal(update.workflow.required, true);
  assert.equal(update.workflow.directory, root); assert.equal(update.feedbackPath, feedback.file); assert.equal(update.feedbackHash, feedback.hash);
  await updateJob(root, update.id, update.claimToken, 'fail', 'Required openspec-update-change workflow is not installed in this fixture');
  await enqueue(root, { action: 'impact', reviewPreview: preview.id, reviewFile: 'app.mjs' });
  const impact = await claimNext(root, 'Existing agent session');
  assert.equal(impact.workflow.skill, null); assert.equal(impact.workflow.required, false);
  assert.equal(impact.workflow.mode, 'same-session'); assert.equal(impact.reviewFile, 'app.mjs');
  await put(root, impact.reportPath, '# Impact\n\nThe enabled export changes its default.\n');
  assert.equal((await updateJob(root, impact.id, impact.claimToken, 'finish', 'Report ready')).status, 'completed');
});

test('skill refresh installs the packaged routing instructions without modifying other workflows or runtime state', async t => {
  const root = await fixture(t);
  await put(root, '.agents/skills/openspec-apply-change/SKILL.md', 'Preserve this installed implementation workflow.');
  await put(root, '.spequi/jobs/preserved.json', '{"id":"preserved","status":"queued"}');
  const config = await fs.readFile(path.join(root, '.spequi/config.json'));
  await put(root, '.agents/skills/spequi/SKILL.md', 'An older viewer skill');
  const installed = await installSkill(root);
  assert.equal(await fs.readFile(installed.skill, 'utf8'), await fs.readFile(new URL('../skills/spequi/SKILL.md', import.meta.url), 'utf8'));
  assert.equal(await fs.readFile(path.join(root, '.agents/skills/openspec-apply-change/SKILL.md'), 'utf8'), 'Preserve this installed implementation workflow.');
  assert.deepEqual(await fs.readFile(path.join(root, '.spequi/config.json')), config);
  assert.equal(await fs.readFile(path.join(root, '.spequi/jobs/preserved.json'), 'utf8'), '{"id":"preserved","status":"queued"}');
});
