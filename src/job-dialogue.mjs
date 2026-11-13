import { randomUUID } from 'node:crypto';
import { getJob, heartbeat, writeJob } from './jobs.mjs';
import { within, withLock, writeJSON, safeID } from './files.mjs';

async function update(root, id, callback) {
  id = safeID(id);
  return withLock(await within(root, `.spequi/job-${id}.lock`), async () => {
    const job = await getJob(root, id), result = await callback(job);
    job.updatedAt = new Date().toISOString();
    await writeJob(root, job);
    return result;
  });
}
const owned = (job, token) => { if (!token || token !== job.claimToken) throw new Error('Claim token does not match this job'); };
export async function askJob(root, id, token, { message, options = [] }) {
  if (typeof message !== 'string' || !message.trim() || message.length > 4000 || !Array.isArray(options) || options.length > 6 || options.some(value => typeof value !== 'string' || !value.trim() || value.length > 300)) throw new Error('Ask a question of 1–4,000 characters with at most six short choices');
  return update(root, id, async job => {
    owned(job, token);
    if (job.status !== 'running') throw new Error('Only a running owned job can request input');
    if ((job.questions?.length || 0) >= 100) throw new Error('This workflow has reached its question limit');
    const question = { id: randomUUID(), message: message.trim(), options, askedAt: new Date().toISOString() };
    (job.questions ||= []).push(question); job.status = 'awaiting-input';
    job.logs.push({ at: question.askedAt, message: 'Waiting for your answer in the app.' });
    await heartbeat(root, job.agent, job.agentSessionId);
    return { job: job.id, status: job.status, question };
  });
}
export async function answerJob(root, id, { questionId, answer }) {
  if (typeof answer !== 'string' || !answer.trim() || answer.length > 6000) throw new Error('Write an answer of 1–6,000 characters');
  return update(root, id, job => {
    const question = job.questions?.at(-1);
    if (job.status !== 'awaiting-input' || !question || question.id !== questionId || question.answeredAt) throw new Error('This question is no longer waiting for an answer. Refresh the viewer.');
    question.answer = answer.trim(); question.answeredAt = new Date().toISOString(); job.status = 'running';
    job.logs.push({ at: question.answeredAt, message: 'Answer received. The same agent session can resume.' });
    return { job: job.id, status: job.status, question };
  });
}
export async function jobInput(root, id, token) {
  const job = await getJob(root, id); owned(job, token); await heartbeat(root, job.agent, job.agentSessionId);
  return { job: job.id, status: job.status, question: job.questions?.at(-1) || null };
}
