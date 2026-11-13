#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs/promises';
import { reportSession } from '../src/agent-session.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { initProject, installSkill, viewerVersion } from '../src/project.mjs';
import { startServer } from '../src/server.mjs';
import { claimNext, updateJob, listJobs } from '../src/jobs.mjs';
import { askJob, jobInput } from '../src/job-dialogue.mjs';

const argv = process.argv.slice(2);
function option(name, fallback) { const position = argv.indexOf(`--${name}`); return position >= 0 ? argv[position + 1] : fallback; }
function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }
const root = path.resolve(option('root', process.cwd()));
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
      print(await reportSession(root, {...report, agent: option('name', 'Skill agent')}));
    } else if (subcommand === 'next') {
      const wait = Math.min(60, Math.max(0, Number(option('wait', 0)) || 0));
      const deadline = Date.now() + wait * 1000;
      let job;
      do { job = await claimNext(root, option('name', 'Skill agent'), option('session-id')); if (job || Date.now() >= deadline) break; await delay(1000); } while (true);
      print({ job });
    } else if (subcommand === 'ask') print(await askJob(root, id, option('token'), { message: option('message', ''), options: JSON.parse(option('options', '[]')) }));
    else if (subcommand === 'input') {
      const deadline = Date.now() + Math.min(60, Math.max(0, Number(option('wait', 0)) || 0)) * 1000;
      let result;
      do { result = await jobInput(root, id, option('token')); if (result.status !== 'awaiting-input' || Date.now() >= deadline) break; await delay(1000); } while (true);
      print(result);
    } else if (['log', 'finish', 'fail'].includes(subcommand)) print(await updateJob(root, id, option('token'), subcommand, option('message', '')));
    else if (subcommand === 'list') print((await listJobs(root)).map(({ claimToken, instructions, ...job }) => job));
    else throw new Error('Use agent report, next, ask, input, log, finish, fail, or list');
  } else if (command === '--version' || command === '-v') process.stdout.write(viewerVersion + '\n');
  else process.stdout.write(`spequi\n\n  spequi init [--start]       Scaffold .spequi and install project skills\n  spequi start [--port 4310]  Open the local project workspace\n  spequi skill install --global  Install the skill for future projects\n  spequi agent next --wait 20    Claim a browser request as the current agent\n  spequi agent log|finish|fail <id> --token <token> --message "result"\n  spequi agent ask <id> --token <token> --message "question" [--options '["Yes","No"]']\n  spequi agent input <id> --token <token> --wait 20\n  spequi agent report --file <session.json> [--name "Skill agent"]\n  spequi agent list\n\nEvery command accepts --root <project>. No build step or agent API key required.\n`);
} catch (error) { process.stderr.write(`spequi: ${error.message}\n`); process.exitCode = 1; }
