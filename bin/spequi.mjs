#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { reportSession } from '../src/agent-session.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { initProject, installSkill, viewerVersion } from '../src/project.mjs';
import { startServer } from '../src/server.mjs';
import { claimNext, updateJob, listJobs, heartbeat, stopPolling, queueStatus } from '../src/jobs.mjs';
import { askJob, jobInput } from '../src/job-dialogue.mjs';
import { agentRequest } from '../src/agent-client.mjs';

const argv = process.argv.slice(2);
function option(name, fallback) { const position = argv.indexOf(`--${name}`); return position >= 0 ? argv[position + 1] : fallback; }
function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
const root = path.resolve(option('root', process.cwd()));
const agentName = () => option('name', 'Skill agent');
function waitSeconds(fallback = 0) {
  const value = Number(option('wait', fallback));
  if (!Number.isFinite(value) || value < 0 || value > 300) throw new Error('Wait must be between 0 and 300 seconds');
  return value;
}
async function agentCall(operation, payload, fallback) {
  const connection = await agentRequest(root, operation, { name: agentName(), sessionId: option('session-id'), ...payload });
  if (connection.available) return operation === 'list' ? connection.result.jobs : connection.result;
  return fallback();
}
try {
  const [command, subcommand, id] = argv;
  if (command === 'init') {
    print(await initProject(root));
    if (argv.includes('--start')) await startServer({ root, port: option('port') === undefined ? undefined : Number(option('port')) });
    else process.stdout.write('\nReady. Run node .spequi/server.mjs, or invoke /spequi in your agent.\n');
  } else if (command === 'start' || command === 'serve') await startServer({ root, port: option('port') === undefined ? undefined : Number(option('port')) });
  else if (command === 'skill' && subcommand === 'install') print(await installSkill(root, argv.includes('--global')));
  else if (command === 'agent') {
    if (subcommand === 'report') {
      const reportFile = option('file');
      if (!reportFile || (await fs.stat(reportFile)).size > 32768) throw new Error('Use --file with a session report under 32 KiB');
      const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
      if (!report || Object.keys(report).some(key => !['sessionId', 'mcps'].includes(key))) throw new Error('Session reports accept sessionId and mcps only');
      print(await agentCall('report', { report }, () => reportSession(root, { ...report, agent: agentName() })));
    } else if (['next', 'wait'].includes(subcommand)) {
      const wait = waitSeconds(subcommand === 'wait' ? 300 : 0);
      print(await agentCall(subcommand, { wait }, async () => {
        const deadline = Date.now() + wait * 1000;
        const pollId = String(process.pid);
        try {
        do {
          await heartbeat(root, agentName(), option('session-id'), { polling: true, pollId });
          const queue = await queueStatus(root);
          if (subcommand === 'wait' && queue.queued && !queue.active) return { available: true, queue };
          if (subcommand === 'next') {
            const job = await claimNext(root, agentName(), option('session-id'));
            if (job) return { job };
          }
          if (queue.status === 'blocked') throw new Error(queue.message);
          if (Date.now() >= deadline) return subcommand === 'wait' ? { available: false, queue } : { job: null, queue };
          await delay(250);
        } while (true);
        } finally { await stopPolling(root, agentName(), option('session-id'), pollId); }
      }));
    } else if (subcommand === 'ask') {
      const payload = { id, token: option('token'), message: option('message', ''), options: JSON.parse(option('options', '[]')) };
      print(await agentCall('ask', payload, () => askJob(root, id, payload.token, payload)));
    } else if (subcommand === 'input') {
      const wait = waitSeconds();
      print(await agentCall('input', { id, token: option('token'), wait }, async () => {
        const deadline = Date.now() + wait * 1000;
        let result;
        do { result = await jobInput(root, id, option('token')); if (result.status !== 'awaiting-input' || Date.now() >= deadline) break; await delay(250); } while (true);
        return result;
      }));
    } else if (['log', 'finish', 'fail'].includes(subcommand)) {
      const payload = { id, token: option('token'), message: option('message', '') };
      print(await agentCall(subcommand, payload, () => updateJob(root, id, payload.token, subcommand, payload.message)));
    } else if (subcommand === 'list') print(await agentCall('list', {}, async () => (await listJobs(root)).map(({ claimToken, instructions, ...job }) => job)));
    else throw new Error('Use agent report, wait, next, ask, input, log, finish, fail, or list');
  } else if (command === '--version' || command === '-v') process.stdout.write(viewerVersion + '\n');
  else process.stdout.write(`spequi\n\n  spequi init [--start]       Scaffold .spequi and install project skills\n  spequi start [--port 4310]  Open the local project workspace\n  spequi skill install --global  Install the skill for future projects\n  spequi agent wait --wait 300   Wait for work without claiming it\n  spequi agent next              Claim when the current agent is ready\n  spequi agent log|finish|fail <id> --token <token> --message "result"\n  spequi agent ask <id> --token <token> --message "question" [--options '["Yes","No"]']\n  spequi agent input <id> --token <token> --wait 300\n  spequi agent report --file <session.json> [--name "Skill agent"]\n  spequi agent list\n\nEvery command accepts --root <project>. No build step or agent API key required.\n`);
} catch (error) { process.stderr.write(`spequi: ${error.message}\n`); process.exitCode = 1; }
