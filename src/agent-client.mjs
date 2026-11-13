import fs from 'node:fs/promises';
import { runtime, readJSON } from './files.mjs';

export async function agentRequest(root, operation, payload) {
  const connection = await readJSON(runtime(root, 'server.json'));
  if (!connection) return { available: false };
  const url = new URL(connection.origin);
  if (connection.protocol !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || await fs.realpath(root) !== connection.root || !/^[a-f0-9]{64}$/.test(connection.token)) throw new Error('Invalid project server connection. Restart Spequi in this project.');
  let response;
  try {
    response = await fetch(`${url.origin}/api/agent/${operation}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${connection.token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(370000) });
  } catch { throw new Error('The project server is unavailable. Restart node .spequi/server.mjs; queued requests are saved.'); }
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Agent request failed'), { code: result.code });
  if (result.protocol !== 1 || result.root !== connection.root) throw new Error('Agent response belongs to another project or protocol. Restart this project server.');
  return { available: true, result };
}
