import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

for (const platform of ['win32', 'linux', 'darwin']) {
  test(`OpenSpec runs with the correct process options on ${platform}`, async t => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const originalExecFile = childProcess.execFile;
    const calls = [];
    t.after(() => {
      Object.defineProperty(process, 'platform', descriptor);
      childProcess.execFile = originalExecFile;
      syncBuiltinESMExports();
    });
    Object.defineProperty(process, 'platform', { ...descriptor, value: platform });
    childProcess.execFile = (file, args, options, callback) => {
      calls.push({ file, args, options });
      callback(null, { stdout: '{"changes":[]}' });
    };
    syncBuiltinESMExports();
    const { openspecJSON } = await import(`../src/openspec-cli.mjs?platform=${platform}`);
    assert.deepEqual(await openspecJSON('/project with spaces', 'list'), { changes: [] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].file, 'openspec');
    assert.deepEqual(calls[0].args, ['list', '--json']);
    assert.equal(calls[0].options.cwd, '/project with spaces');
    assert.equal(calls[0].options.shell, platform === 'win32');
    assert.equal(calls[0].options.windowsHide, platform !== 'win32');
    await assert.rejects(openspecJSON('/project', 'status', 'flow & echo injected'), /Invalid change/);
    await assert.rejects(openspecJSON('/project', 'archive', 'flow'), /Unsupported/);
    assert.equal(calls.length, 1);
  });
}
