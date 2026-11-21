import { commentImages, readReviewImage } from './review-images.mjs';
import * as fs from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { readJSON, writeJSON, within, safeID, withLock } from './files.mjs';
import { previewContents } from './previews.mjs';
import { inventory, readArtifact } from './specs.mjs';
import { feedbackMarkdown, planningEvidence } from './feedback.mjs';
export { feedbackMarkdown } from './feedback.mjs';
export const artifactReviewID = change => `change-${createHash('sha256').update(change).digest('hex')}`;
export const documentHash = source => createHash('sha256').update(source).digest('hex');
export const isCommentableArtifact = (change, file) => Boolean(change && !change.archived && change.files.includes(file) && file.endsWith('.md'));

export async function reviewScope(root, preview) {
  safeID(preview);
  if (/^change-[a-f0-9]{64}$/.test(preview)) {
    const stored = await readJSON(await within(root, `.spequi/reviews/${preview}/scope.json`));
    const change = stored?.change || (await inventory(root)).changes.find(change => artifactReviewID(change.id) === preview)?.id;
    if (!change || artifactReviewID(change) !== preview) throw new Error('Planning review not found');
    return { kind: 'artifacts', job: { id: preview, change, action: 'artifact-review' }, result: null };
  }
  const job = await readJSON(await within(root, `.spequi/jobs/${preview}.json`));
  const result = await readJSON(await within(root, `.spequi/previews/${preview}/result.json`));
  for (const tree of ['baseline', 'proposed']) await within(root, `.spequi/previews/${preview}/${tree}`);
  if (!job || job.action !== 'preview' || job.status !== 'completed' || !result) throw new Error('Select a completed implementation preview');
  return { kind: 'preview', job, result };
}

async function location(root, preview, file = 'comments.json') {
  safeID(preview);
  const directory = await within(root, `.spequi/reviews/${preview}`);
  await fs.mkdir(directory, { recursive: true });
  return within(root, `.spequi/reviews/${preview}/${file}`);
}

export async function listComments(root, preview) {
  const file = await within(root, `.spequi/reviews/${safeID(preview)}/comments.json`);
  return readJSON(file, []);
}

export async function reviewComments(root, preview) {
  const scope = await reviewScope(root, preview);
  const comments = await listComments(root, preview);
  if (scope.kind === 'artifacts') return comments;
  return [...comments, ...await listComments(root, artifactReviewID(scope.job.change))];
}

async function addArtifactComment(root, preview, { file, body, side = 'file', start = '', end = '', sourceHash, attachments }, scope) {
  const change = (await inventory(root)).changes.find(change => change.id === scope.job.change);
  if (!isCommentableArtifact(change, file)) throw new Error('Select a planning document in this active change');
  const images = await commentImages(root, preview, attachments);
  if (typeof body !== 'string' || body.length > 6000 || !body.trim() && !images.length) throw new Error('Write a comment or attach an image (up to 6,000 characters)');
  if (!['file', 'document'].includes(side)) throw new Error('Invalid document comment side');
  const source = await readArtifact(root, file), hash = documentHash(source);
  if (sourceHash !== hash) throw new Error('This document changed. Reload it before commenting; your draft is still available.');
  let first = null, last = null, snippet = '';
  if (side === 'document') {
    const lines = source ? source.replace(/\r?\n$/, '').split(/\r?\n/) : [];
    first = Number(start); last = end === '' ? first : Number(end);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > lines.length || last - first >= 200) throw new Error('Choose an existing line range of at most 200 lines');
    snippet = lines.slice(first - 1, last).join('\n');
    if (snippet.length > 20000) throw new Error('Selected source is too large; comment on the entire document instead');
  }
  const sourcePath = `.spequi/reviews/${preview}/documents/${hash}.md`;
  const record = { id: randomUUID(), kind: 'artifact', preview, change: change.id, file, side, start: first, end: last, snippet, sourceHash: hash, sourcePath, images, body: body.trim(), createdAt: new Date().toISOString() };
  await location(root, preview);
  return withLock(await location(root, preview, 'review.lock'), async () => {
    const comments = await listComments(root, preview);
    if (comments.length >= 500) throw new Error('This planning review already has 500 comments');
    await fs.mkdir(await within(root, `.spequi/reviews/${preview}/documents`), { recursive: true });
    const snapshot = await within(root, sourcePath);
    try { await fs.writeFile(snapshot, source, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (documentHash(await fs.readFile(snapshot, 'utf8')) !== hash) throw new Error('Retained document changed; restore it before commenting'); }
    await writeJSON(await location(root, preview, 'scope.json'), { kind: 'artifacts', change: change.id });
    comments.push(record); await writeJSON(await location(root, preview), comments); return record;
  });
}

export async function addComment(root, preview, payload) {
  const scope = await reviewScope(root, preview);
  if (scope.kind === 'artifacts') return addArtifactComment(root, preview, payload, scope);
  const { file, body, side = 'file', start = '', end = '', attachments } = payload;
  const { job, result } = scope;
  const change = result.changes.find(change => change.file === file);
  if (!change) throw new Error('Comment file is not part of this preview');
  const images = await commentImages(root, preview, attachments);
  if (typeof body !== 'string' || body.length > 6000 || !body.trim() && !images.length) throw new Error('Write a comment or attach an image (up to 6,000 characters)');
  if (!['file', 'current', 'proposed'].includes(side)) throw new Error('Invalid comment side');
  let first = null, last = null, snippet = '';
  if (side !== 'file') {
    const source = await previewContents(root, preview, file);
    const value = side === 'current' ? source.before : source.after;
    const lines = value ? value.replace(/\r?\n$/, '').split(/\r?\n/) : [];
    first = Number(start); last = end === '' ? first : Number(end);
    if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > lines.length || last - first >= 200) throw new Error('Choose an existing line range of at most 200 lines');
    snippet = lines.slice(first - 1, last).join('\n');
    if (snippet.length > 20000) throw new Error('Selected source is too large; comment on the entire file instead');
  }
  const record = { id: randomUUID(), preview, change: job.change, file, side, start: first, end: last, snippet, beforeHash: change.beforeHash, afterHash: change.afterHash, images, body: body.trim(), createdAt: new Date().toISOString() };
  const store = await location(root, preview);
  return withLock(await location(root, preview, 'review.lock'), async () => {
    const comments = await readJSON(store, []);
    if (comments.length >= 500) throw new Error('This preview already has 500 comments');
    comments.push(record); await writeJSON(store, comments); return record;
  });
}

export async function deleteComment(root, preview, id) {
  const scope = await reviewScope(root, preview); safeID(id);
  return withLock(await location(root, preview, 'review.lock'), async () => {
    const comments = await listComments(root, preview);
    const removed = comments.find(comment => comment.id === id);
    if (!removed) throw new Error('Comment not found in this review');
    await writeJSON(await location(root, preview), comments.filter(comment => comment.id !== id));
    return { id, preview, change: scope.job.change, file: removed.file };
  });
}

export async function exportFeedback(root, preview) {
  const scope = await reviewScope(root, preview);
  return withLock(await location(root, preview, 'review.lock'), async () => {
    const comments = await reviewComments(root, preview);
    if (!comments.length) throw new Error('Add at least one comment before exporting feedback');
    for (const comment of comments.filter(comment => comment.kind === 'artifact')) {
      const expected = `.spequi/reviews/${artifactReviewID(scope.job.change)}/documents/${comment.sourceHash}.md`;
      if (!/^[a-f0-9]{64}$/.test(comment.sourceHash) || comment.change !== scope.job.change || comment.sourcePath !== expected || documentHash(await fs.readFile(await within(root, expected), 'utf8')) !== comment.sourceHash) throw new Error('Retained document changed; restore it before exporting feedback');
    }
    const images = [...new Map(comments.flatMap(comment => (comment.images || []).map(image => [image.file, { scope: comment.preview, id: image.id, hash: image.hash }]))).values()];
    for (const image of images) if ((await readReviewImage(root, image.scope, image.id)).hash !== image.hash) throw new Error('An attached image changed; review it before exporting');
    const id = randomUUID(), exportedAt = new Date().toISOString();
    const relative = `.spequi/reviews/${preview}/feedback-${id}.md`;
    const planning = await planningEvidence(root, scope.job.change);
    const document = feedbackMarkdown({ ...scope, planning, exportId: id, exportFile: relative }, comments, exportedAt);
    await fs.writeFile(await within(root, relative), document, { flag: 'wx', mode: 0o600 });
    const record = { id, preview, change: scope.job.change, file: relative, exportedAt, count: comments.length, images, hash: createHash('sha256').update(document).digest('hex') };
    await writeJSON(await location(root, preview, `export-${id}.json`), record);
    return record;
  });
}

export async function feedbackExport(root, preview, id) {
  await reviewScope(root, preview); safeID(id);
  const record = await readJSON(await within(root, `.spequi/reviews/${safeID(preview)}/export-${id}.json`));
  if (!record || record.preview !== preview || record.id !== id) throw new Error('Feedback document not found');
  const file = `.spequi/reviews/${preview}/feedback-${id}.md`;
  const document = await fs.readFile(await within(root, file), 'utf8');
  if (record.hash !== createHash('sha256').update(document).digest('hex')) throw new Error('Feedback document changed after export; create a new export');
  for (const image of record.images || []) if ((await readReviewImage(root, image.scope, image.id)).hash !== image.hash) throw new Error('An exported image changed; create a new feedback snapshot');
  return { ...record, file, document };
}

export async function listFeedbackExports(root, preview) {
  const directory = await within(root, `.spequi/reviews/${safeID(preview)}`);
  const files = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const records = await Promise.all(files.filter(file => /^export-[a-zA-Z0-9_-]+\.json$/.test(file)).map(async file => readJSON(await within(root, `.spequi/reviews/${preview}/${file}`))));
  return records.filter(Boolean).sort((a, b) => b.exportedAt.localeCompare(a.exportedAt)).slice(0, 3);
}
