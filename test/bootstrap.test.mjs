import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initProject, installSkill, viewerVersion } from '../src/project.mjs';

const exec = promisify(execFile);
const template = await fs.readFile(new URL('../templates/cli.mjs', import.meta.url), 'utf8');
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'opsx bootstrap ')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  await fs.mkdir(path.join(root, '.spequi'));
  return root;
}

test('init creates the new workspace and Git ignores every generated integration without duplicate rules', async t => {
  const root = await fixture(t);
  await fs.rmdir(path.join(root, '.spequi'));
  await exec('git', ['init'], { cwd: root });
  const original = 'node_modules/\r\n/.agents/\r\n!/.agents/\r\ncustom-output/';
  await fs.writeFile(path.join(root, '.gitignore'), original);
  await fs.writeFile(path.join(root, 'app.mjs'), 'export const app = true;\n');
  const initialized = await initProject(root);
  assert.equal(initialized.workspace, path.join(root, '.spequi'));
  await assert.rejects(fs.access(path.join(root, '.change-viewer')), { code: 'ENOENT' });
  const ignored = ['.spequi/config.json', '.spequi/cli.mjs', '.spequi/server.mjs', '.agents/skills/spequi/SKILL.md', '.claude/commands/spequi.md', '.gigacode/skills/spequi/SKILL.md', '.gigacode/commands/spequi.md'];
  const result = await exec('git', ['check-ignore', '--no-index', ...ignored], { cwd: root });
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ignored);
  const untracked = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root });
  assert.deepEqual(untracked.stdout.trim().split(/\r?\n/).sort(), ['.gitignore', 'app.mjs']);
  const updated = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
  assert.ok(updated.startsWith(original + '\r\n'));
  assert.doesNotMatch(updated, /(?<!\r)\n/);
  await initProject(root);
  assert.equal(await fs.readFile(path.join(root, '.gitignore'), 'utf8'), updated);
  assert.equal((await exec(process.execPath, [path.join(root, '.spequi/cli.mjs'), '--version'], { cwd: root })).stdout.trim(), viewerVersion);
});

test('new initialization uses its own workspace and leaves the old runtime data untouched', async t => {
  const root = await fixture(t);
  const legacy = path.join(root, '.change-viewer');
  await fs.mkdir(legacy);
  const config = '{"version":1,"port":4999,"custom":"keep this data"}';
  await fs.writeFile(path.join(legacy, 'config.json'), config);
  await initProject(root);
  assert.equal(await fs.readFile(path.join(legacy, 'config.json'), 'utf8'), config);
  assert.deepEqual(await fs.readdir(legacy), ['config.json']);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.spequi/config.json'))).port, 4310);
});

test('project launchers retain their version, pass protocol arguments intact and recover through npm when the runtime is missing or mismatched', async t => {
  const root = await fixture(t), npmCLI = path.join(root, 'fake npm cli.mjs');
  await fs.writeFile(npmCLI, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  const cached = path.join(root, 'retained package');
  await fs.mkdir(path.join(cached, 'bin'), { recursive: true });
  const cli = path.join(cached, 'bin/spequi.mjs');
  await fs.writeFile(cli, 'console.log("retained-runtime");');
  await fs.writeFile(path.join(cached, 'package.json'), '{"name":"spequi","version":"0.1.0"}');
  const launcher = path.join(root, '.spequi/cli.mjs');
  await fs.writeFile(launcher, template.replace('__SPEQUI_RUNTIME__', JSON.stringify({ name: 'spequi', version: '0.1.0', spec: 'spequi@0.1.0', cli, npmCLI })));
  const env = { ...process.env, npm_execpath: npmCLI };
  assert.equal((await exec(process.execPath, [launcher, '--version'], { cwd: root, env })).stdout.trim(), 'retained-runtime');
  const literal = 'Quoted "feedback" & $(touch SHOULD_NOT_EXIST) `echo unsafe` <note> 日本語';
  const args = ['agent', 'log', 'job', '--message', literal];
  await fs.rm(cached, { recursive: true });
  const fallback = JSON.parse((await exec(process.execPath, [launcher, ...args], { cwd: root, env })).stdout);
  assert.deepEqual(fallback, ['exec', '--yes', '--package=spequi@0.1.0', '--', 'spequi', ...args, '--root', root + path.sep]);
  await assert.rejects(fs.access(path.join(root, 'SHOULD_NOT_EXIST')));
  await fs.mkdir(path.join(cached, 'bin'), { recursive: true });
  await fs.writeFile(cli, 'throw new Error("Wrong version must not run");');
  await fs.writeFile(path.join(cached, 'package.json'), '{"name":"spequi","version":"0.2.0"}');
  assert.deepEqual(JSON.parse((await exec(process.execPath, [launcher, ...args], { cwd: root, env })).stdout), fallback);
});

test('repeat init refreshes managed registration while preserving custom launchers, port, review data and application files', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, '.spequi/config.json'), '{"version":1,"port":4999,"custom":true,"viewerVersion":"older"}');
  await fs.writeFile(path.join(root, '.spequi/server.mjs'), '// Generated by spequi. Previous launcher\n');
  await fs.writeFile(path.join(root, '.spequi/cli.mjs'), '// Generated by spequi. Previous CLI\n');
  await fs.writeFile(path.join(root, 'app.mjs'), 'Keep this application file.');
  await fs.mkdir(path.join(root, '.spequi/reviews'));
  await fs.writeFile(path.join(root, '.spequi/reviews/retained.json'), '{"body":"Keep this feedback"}');
  await initProject(root);
  const config = JSON.parse(await fs.readFile(path.join(root, '.spequi/config.json')));
  assert.equal(config.port, 4999); assert.equal(config.custom, true); assert.equal(config.viewerVersion, viewerVersion);
  assert.match(await fs.readFile(path.join(root, '.spequi/server.mjs'), 'utf8'), /import\('\.\/cli\.mjs'\)/);
  assert.match(await fs.readFile(path.join(root, '.claude/commands/spequi.md'), 'utf8'), /\.agents\/skills\/spequi\/SKILL\.md/);
  assert.ok(await fs.stat(path.join(root, '.claude/commands/spequi.md')));
  assert.match(await fs.readFile(path.join(root, '.agents/skills/spequi/SKILL.md'), 'utf8'), /node \.spequi\/cli\.mjs agent next/);
  assert.equal((await exec(process.execPath, [path.join(root, '.spequi/cli.mjs'), '--version'], { cwd: root })).stdout.trim(), viewerVersion);
  for (const command of ['spequi.md']) {
    assert.match(await fs.readFile(path.join(root, '.claude/commands', command), 'utf8'), /\.agents\/skills\/spequi\/SKILL\.md/);
  }
  const gigacodeSkill = path.join(root, '.gigacode/skills/spequi/SKILL.md');
  const gigacodeCommand = path.join(root, '.gigacode/commands/spequi.md');
  assert.equal(await fs.readFile(gigacodeSkill, 'utf8'), await fs.readFile(new URL('../skills/spequi/SKILL.md', import.meta.url), 'utf8'));
  await fs.writeFile(gigacodeSkill, 'Older GigaCode skill');
  await fs.writeFile(gigacodeCommand, 'Older GigaCode command');
  await fs.writeFile(path.join(root, '.gigacode/commands/custom.md'), 'Keep my unrelated command.');
  await fs.writeFile(path.join(root, '.gigacode/settings.json'), '{"custom":true}');
  await fs.writeFile(path.join(root, '.spequi/server.mjs'), '// My custom server\n');
  await fs.writeFile(path.join(root, '.spequi/cli.mjs'), '// My custom launcher\n');
  await initProject(root);
  assert.equal(await fs.readFile(path.join(root, '.spequi/server.mjs'), 'utf8'), '// My custom server\n');
  assert.equal(await fs.readFile(path.join(root, '.spequi/cli.mjs'), 'utf8'), '// My custom launcher\n');
  assert.equal(await fs.readFile(path.join(root, '.spequi/reviews/retained.json'), 'utf8'), '{"body":"Keep this feedback"}');
  assert.equal(await fs.readFile(path.join(root, 'app.mjs'), 'utf8'), 'Keep this application file.');
  assert.match(await fs.readFile(gigacodeSkill, 'utf8'), /name: spequi/);
  assert.match(await fs.readFile(gigacodeCommand, 'utf8'), /User arguments: \{\{args\}\}/);
  assert.equal(await fs.readFile(path.join(root, '.gigacode/commands/custom.md'), 'utf8'), 'Keep my unrelated command.');
  assert.equal(await fs.readFile(path.join(root, '.gigacode/settings.json'), 'utf8'), '{"custom":true}');
});

test('skill install registers GigaCode native discovery and command wrappers without changing other skills', async t => {
  const root = await fixture(t);
  const workflow = path.join(root, '.gigacode/skills/openspec-apply-change/SKILL.md');
  await fs.mkdir(path.dirname(workflow), { recursive: true });
  await fs.writeFile(workflow, 'Keep this existing workflow.');
  const cli = new URL('../bin/spequi.mjs', import.meta.url);
  const installed = JSON.parse((await exec(process.execPath, [cli.pathname, 'skill', 'install', '--root', root])).stdout);
  assert.equal(installed.gigacode.skill, path.join(root, '.gigacode/skills/spequi/SKILL.md'));
  assert.equal(installed.gigacode.command, path.join(root, '.gigacode/commands/spequi.md'));
  const canonical = await fs.readFile(new URL('../skills/spequi/SKILL.md', import.meta.url), 'utf8');
  assert.equal(await fs.readFile(installed.gigacode.skill, 'utf8'), canonical);
  for (const command of [installed.gigacode.command]) {
    const content = await fs.readFile(command, 'utf8');
    assert.match(content, /^---\ndescription:/);
    assert.match(content, /Read and follow \.gigacode\/skills\/spequi\/SKILL\.md/);
    assert.match(content, /User arguments: \{\{args\}\}/);
    assert.doesNotMatch(content, /\$ARGUMENTS|~\/\.gigacode/);
  }
  assert.equal(await fs.readFile(workflow, 'utf8'), 'Keep this existing workflow.');
});

test('global skill registration writes GigaCode under the home scope without touching the project', async t => {
  const root = await fixture(t), homeScope = path.join(root, 'fake home scope');
  await fs.mkdir(homeScope);
  t.mock.method(os, 'homedir', () => homeScope);
  const installed = await installSkill(root, true);
  assert.equal(installed.gigacode.skill, path.join(homeScope, '.gigacode/skills/spequi/SKILL.md'));
  assert.equal(await fs.readFile(installed.gigacode.skill, 'utf8'), await fs.readFile(installed.skill, 'utf8'));
  for (const command of [installed.gigacode.command]) {
    assert.ok(command.startsWith(homeScope + path.sep));
    const content = await fs.readFile(command, 'utf8');
    assert.match(content, /Read and follow ~\/\.gigacode\/skills\/spequi\/SKILL\.md/);
    assert.match(content, /User arguments: \{\{args\}\}/);
    assert.doesNotMatch(content, /\$ARGUMENTS/);
  }
  await assert.rejects(fs.access(path.join(root, '.gigacode')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, '.agents')), { code: 'ENOENT' });
});

test('the CLI preserves the existing queue and installs only the UI skill and command wrappers', async t => {
  const root = await fixture(t);
  await initProject(root);
  const job = { id: 'retained', change: 'flow', action: 'explore', status: 'queued', createdAt: '2026-11-10T00:00:00Z', logs: [] };
  await fs.writeFile(path.join(root, '.spequi/jobs/retained.json'), JSON.stringify(job));
  const cli = new URL('../bin/spequi.mjs', import.meta.url);
  const result = await exec(process.execPath, [cli.pathname, 'agent', 'list', '--root', root]);
  assert.deepEqual(JSON.parse(result.stdout), [job]);
  assert.match((await exec(process.execPath, [cli.pathname, '--help'])).stdout, /^spequi\n/);
  assert.deepEqual(await fs.readdir(path.join(root, '.agents/skills')), ['spequi']);
  for (const host of ['.claude', '.gigacode']) {
    assert.deepEqual((await fs.readdir(path.join(root, host, 'commands'))).sort(), ['spequi.md']);
  }
  assert.match(await fs.readFile(path.join(root, '.agents/skills/spequi/SKILL.md'), 'utf8'), /^---\nname: spequi\n/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, '.spequi/jobs/retained.json'))), job);
});
