import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const checkout = fileURLToPath(new URL('../', import.meta.url));
const npmCLI = process.env.npm_execpath;
if (!npmCLI) throw new Error('Run npm run smoke:npx.');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx npx smoke '));
const root = path.join(temporary, 'project with spaces'), cache = path.join(temporary, 'isolated npm cache');
const run = async (entry, args, env = {}) => (await promisify(execFile)(process.execPath, [entry, ...args], { cwd: root, env: { ...process.env, ...env }, timeout: 120000, maxBuffer: 4 * 1024 * 1024 })).stdout;
const registry = http.createServer();
try {
  await fs.mkdir(root);
  const hostPackage = '{"name":"viewer-smoke-host","version":"1.0.0","private":true}\n';
  await fs.writeFile(path.join(root, 'package.json'), hostPackage);
  const { stdout } = await promisify(execFile)(process.execPath, [npmCLI, 'pack', '--json', '--pack-destination', temporary], { cwd: checkout });
  const packed = JSON.parse(stdout)[0], archive = path.join(temporary, packed.filename);
  await run(npmCLI, ['exec', '--yes', '--cache', cache, '--package', archive, '--', 'spequi', 'init']);
  const config = JSON.parse(await fs.readFile(path.join(root, '.spequi/config.json')));
  assert.equal(config.viewerVersion, packed.version);
  for (const file of ['cli.mjs', 'server.mjs']) await fs.access(path.join(root, '.spequi', file));
  await fs.access(path.join(root, '.claude/commands/spequi.md'));
  assert.equal((await run(path.join(root, '.spequi/cli.mjs'), ['--version'])).trim(), packed.version);
  assert.equal(await fs.access(path.join(root, 'node_modules')).then(() => true, () => false), false);

  // Serve only this unpublished package; npm's real registry serves dependencies.
  const metadata = JSON.parse(await fs.readFile(path.join(checkout, 'package.json')));
  const tarball = await fs.readFile(archive);
  let origin, fetchedMetadata = 0, fetchedTarball = 0;
  registry.on('request', (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/spequi') {
      fetchedMetadata++;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ name: packed.name, 'dist-tags': { latest: packed.version }, versions: { [packed.version]: { ...metadata, dist: { tarball: origin + '/package.tgz', integrity: packed.integrity, shasum: packed.shasum } } } }));
    } else if (url.pathname === '/package.tgz') {
      fetchedTarball++; response.writeHead(200, { 'Content-Type': 'application/octet-stream' }); response.end(tarball);
    } else {
      response.writeHead(302, { Location: 'https://registry.npmjs.org' + url.pathname + url.search }); response.end();
    }
  });
  await new Promise((resolve, reject) => { registry.once('error', reject); registry.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${registry.address().port}`;
  // Remove the entire isolated cache, including the installation used by init.
  await fs.rm(cache, { recursive: true, force: true, maxRetries: 5 });
  const env = { npm_config_cache: cache, npm_config_registry: origin, npm_config_audit: 'false', npm_config_fund: 'false' };
  assert.equal((await run(path.join(root, '.spequi/cli.mjs'), ['--version'], env)).trim(), packed.version);
  assert.ok(fetchedMetadata > 0 && fetchedTarball > 0, 'missing runtime is reacquired through the pinned npm package');
  assert.deepEqual(JSON.parse(await run(path.join(root, '.spequi/cli.mjs'), ['agent', 'list'], env)), []);
  const agent = 'Agent & $(touch SHOULD_NOT_EXIST) `echo unsafe` 日本語';
  assert.equal(JSON.parse(await run(path.join(root, '.spequi/cli.mjs'), ['agent', 'next', '--name', agent], env)).job, null);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.spequi/agent.json'))).agent, agent);
  await assert.rejects(fs.access(path.join(root, 'SHOULD_NOT_EXIST')));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, '.spequi/config.json'))).viewerVersion, packed.version);
  assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), hostPackage);
  await assert.rejects(fs.access(path.join(root, 'package-lock.json')));
  console.log(`npx smoke passed: local tarball init; Spequi registration; no project dependencies; pinned ${packed.version} recovered after deleting the complete isolated cache; project agent command works without global installation.`);
} finally {
  await new Promise(resolve => registry.close(resolve));
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
