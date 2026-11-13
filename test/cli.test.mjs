import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('init --start preserves the configured port when no port override is supplied', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx cli '));
  await fs.mkdir(path.join(root, '.spequi'));
  await fs.writeFile(path.join(root, '.spequi/config.json'), '{"version":1,"port":0}');
  const child = spawn(process.execPath, [fileURLToPath(new URL('../bin/spequi.mjs', import.meta.url)), 'init', '--start'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const origin = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${output}`)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`CLI exited ${code}: ${output}`)); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  });
  assert.notEqual(new URL(origin).port, '4310');
  assert.equal((await fetch(origin)).status, 200);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.spequi/config.json'))).port, 0);
});
