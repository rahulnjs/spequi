// Run under Node 24 in CI before selecting the app's Node version.
// OpenSpec's independent Node requirement must not raise Spequi's Node 20 minimum.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
if (!process.env.npm_execpath || !process.env.GITHUB_PATH) throw new Error('Run npm run prepare:test-cli in the CI runner.');
const globalRoot = (await promisify(execFile)(process.execPath, [process.env.npm_execpath, 'root', '--global'])).stdout.trim();
const packageRoot = path.join(globalRoot, '@fission-ai', 'openspec');
const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json')));
const entry = path.resolve(packageRoot, typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.openspec);
const folder = path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'spequi-openspec-cli');
await fs.mkdir(folder, { recursive: true });
if (process.platform === 'win32') {
  await fs.writeFile(path.join(folder, 'openspec.cmd'), `@"${process.execPath}" "${entry}" %*\r\n`);
} else {
  const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
  const shim = path.join(folder, 'openspec');
  await fs.writeFile(shim, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: 0o755 });
}
await fs.appendFile(process.env.GITHUB_PATH, folder + '\n');
console.log('OpenSpec CLI uses its Node 24 runtime; Spequi tests use the matrix runtime.');
