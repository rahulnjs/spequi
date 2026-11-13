import { reviewComments, artifactReviewID, isCommentableArtifact, documentHash } from './review-store.mjs';
import { readArtifact } from './specs.mjs';
import { dependencyImpact } from './impact.mjs';
import { renderImpactPanel } from './impact-view.mjs';
import { renderComments } from './comment-view.mjs';

export async function renderReviewContext({ root, params, selected, context, jobs, agent, artifact = null, showImpact = true }, { icon, link, badge }) {
  const { result } = context;
  const job = context.job && result ? context.job : { id: artifactReviewID(selected.id), change: selected.id };
  const file = artifact || (showImpact ? context.file : null);
  const comments = await reviewComments(root, job.id);
  const fileHashes = {};
  for (const doc of selected.files.filter(file => isCommentableArtifact(selected, file))) {
    try { fileHashes[doc] = documentHash(await readArtifact(root, doc)); } catch {}
  }
  const base = { change: selected?.id, view: 'preview', job: job.id, mode: params.mode, wrap: params.wrap };
  const feedback = renderComments({ comments, job, file, selected, jobs, base, fileHashes }, { icon, link });
  if (!showImpact || !file || !result) return feedback;
  let evidence;
  try { evidence = await dependencyImpact(root, job.id, file.file); }
  catch (error) { evidence = { error: error.message }; }
  return renderImpactPanel({ file, evidence, result, jobs, preview: job.id, base }, { icon, link }) + feedback;
}
