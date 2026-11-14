import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.npm_execpath) throw new Error('Run npm run check:package.');
const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json')));
const folders = ['bin', 'src', 'public', 'skills', 'templates'];
const documents = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'docs/agent-workflow.md'];
const { stdout } = await promisify(execFile)(process.execPath, [process.env.npm_execpath, 'pack', '--dry-run', '--json'], { cwd: root, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
const packed = JSON.parse(stdout)[0], files = new Set(packed.files.map(file => file.path));
assert.equal(metadata.bin['spequi'], 'bin/spequi.mjs');
assert.ok((await fs.readFile(path.join(root, metadata.bin['spequi']), 'utf8')).startsWith('#!/usr/bin/env node\n'));
assert.equal(metadata.type, 'module');
assert.equal(metadata.engines.node, '>=20');
if (process.platform !== 'win32') assert.ok((await fs.stat(path.join(root, metadata.bin['spequi']))).mode & 0o111, 'CLI must be executable');
async function checkDirectory(relative) {
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await checkDirectory(file);
    else if (entry.isFile()) assert.ok(files.has(file), `Required runtime file missing from npm package: ${file}`);
    else assert.fail(`Unexpected runtime symlink: ${file}`);
  }
}
// Audit the declared runtime files; local design prototypes are intentionally excluded.
for (const entry of metadata.files) {
  const relative = entry.replace(/\/$/, '');
  if ((await fs.stat(path.join(root, relative))).isDirectory()) await checkDirectory(relative);
  else assert.ok(files.has(relative), `Required runtime file missing from npm package: ${relative}`);
}
assert.ok(!files.has('public/header-options.html'), 'Superseded design prototypes must stay local');
for (const file of documents) assert.ok(files.has(file), `Required document missing: ${file}`);
for (const file of files) {
  assert.ok(documents.includes(file) || folders.some(folder => file.startsWith(folder + '/')), `Unexpected published file: ${file}`);
  assert.ok(!/(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.git|\.spequi|\.agents|\.claude|node_modules)(?:\/|$)/.test(file), `Private/generated file in package: ${file}`);
}
console.log(`Package manifest verified: ${packed.name}@${packed.version}; ${files.size} files, ${packed.size} bytes compressed.`);
for (const file of [...files].sort()) console.log(file);
