import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inventory, readArtifact } from './specs.mjs';
import { eligible } from './previews.mjs';
import { references, resolveReference } from './impact.mjs';
import { walk, within, runtime, readJSON, writeJSON, withLock } from './files.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const textExtensions = new Set('.js .mjs .cjs .ts .tsx .jsx .css .scss .html .svg .json .yaml .yml .md .py .go .rs .java .rb .php .sh .sql .toml .xml .txt .c .h .cpp .cs .vue .svelte'.split(' '));
const stop = new Set('that this with from have will shall must should when then given and the for are into only use uses using file files source sources change changes project system user users support existing current proposed implementation requirement requirements scenario scenarios add added modified removed return returns export exports import imports function const await async string boolean number true false null test tests code data name value selected local before after preview viewer'.split(' '));
const words = text => [...new Set(text.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !stop.has(word)))];
export function sourceEligible(file) {
  return eligible(file) && !file.split('/').some(part => ['openspec', '.agents', '.claude', '.codex'].includes(part));
}
const location = (root, change) => runtime(root, 'analyses', `${hash(change)}.json`);

export async function activeChange(root, id) {
  const change = (await inventory(root)).changes.find(change => change.id === id && !change.archived);
  if (!change) throw new Error('Select an existing active change');
  return change;
}

export async function analysisInputs(root, id) {
  const change = await activeChange(root, id);
  const artifacts = [];
  let specBytes = 0;
  for (const file of change.files) {
    const content = await readArtifact(root, file);
    specBytes += Buffer.byteLength(content);
    if (specBytes > 2 * 1024 * 1024) throw new Error('Change documents exceed the 2 MiB analysis limit');
    artifacts.push({ file, content, hash: hash(content) });
  }
  if (!artifacts.length) throw new Error('This change has no planning documents to analyze');
  const files = (await walk(root, { filter: sourceEligible })).sort();
  const sources = new Map(), skipped = [];
  let bytes = 0;
  for (const file of files) {
    if (!textExtensions.has(path.posix.extname(file).toLowerCase()) && path.posix.basename(file) !== 'Dockerfile') { skipped.push({ file, reason: 'Unsupported source type' }); continue; }
    const absolute = await within(root, file), stat = await fs.stat(absolute);
    if (stat.size > 512000 || sources.size >= 1000 || bytes + stat.size > 8 * 1024 * 1024) { skipped.push({ file, reason: 'Analysis size limit' }); continue; }
    bytes += stat.size;
    const buffer = await fs.readFile(absolute);
    if (buffer.length > 512000 || buffer.includes(0)) { skipped.push({ file, reason: 'Binary or oversized source' }); continue; }
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { skipped.push({ file, reason: 'Source is not UTF-8 text' }); continue; }
    sources.set(file, { content, hash: hash(buffer) });
  }
  const fingerprint = hash(JSON.stringify({ artifacts: artifacts.map(({ file, hash }) => [file, hash]), sources: [...sources].map(([file, source]) => [file, source.hash]), files, skipped }));
  return { change, artifacts, sources, fingerprint, skipped, bytes };
}

export function sourceGraph(sources) {
  const files = new Set(sources.keys()), imports = new Map(), consumers = new Map(), unresolved = [];
  for (const [file, source] of sources) {
    const targets = new Set();
    for (const reference of references(source.content, file)) {
      const target = resolveReference(file, reference, files);
      if (target) {
        targets.add(target);
        if (!consumers.has(target)) consumers.set(target, new Set());
        consumers.get(target).add(file);
      } else if (target === undefined) unresolved.push({ file, reference });
    }
    imports.set(file, targets);
  }
  return { imports, consumers, unresolved };
}

function candidatesFor({ artifacts, sources }) {
  const graph = sourceGraph(sources), candidates = new Map();
  const documents = artifacts.flatMap(artifact => artifact.content.split(/\r?\n/).map((text, index) => ({ artifact: artifact.file, line: index + 1, text })));
  const prose = artifacts.map(artifact => artifact.content).join('\n');
  const terms = words(prose).slice(0, 128);
  const symbols = [...new Set([...prose.matchAll(/`([a-zA-Z_$][\w$]{3,})`/g)].map(match => match[1]))].filter(symbol => !stop.has(symbol.toLowerCase())).slice(0, 80);
  const basenameCounts = new Map();
  for (const file of sources.keys()) { const name = path.posix.basename(file); basenameCounts.set(name, (basenameCounts.get(name) || 0) + 1); }
  const cite = (file, token, label) => {
    const found = documents.find(doc => doc.text.includes(token));
    return found ? { kind: label, artifact: found.artifact, line: found.line, text: found.text.slice(0, 320) } : { kind: label, text: `Matches ${token}` };
  };
  for (const [file, source] of sources) {
    const evidence = [], name = path.posix.basename(file);
    let score = 0, strength = 'Related text', sourceLine = 1;
    if (prose.includes(file)) { evidence.push(cite(file, file, 'Explicit path')); score = 100; strength = 'Direct reference'; }
    else if (name.includes('.') && basenameCounts.get(name) === 1 && prose.includes(name)) { evidence.push(cite(file, name, 'Unique filename')); score = 80; strength = 'Filename match'; }
    const sourceWords = new Set(words(source.content));
    const matchingSymbols = symbols.filter(symbol => {
      const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(source.content);
    });
    if (matchingSymbols.length) {
      evidence.push(...matchingSymbols.slice(0, 2).map(symbol => cite(file, symbol, 'Named symbol')));
      if (score < 60) { score = 60; strength = 'Symbol match'; }
      sourceLine = source.content.split(/\r?\n/).findIndex(line => line.includes(matchingSymbols[0])) + 1;
    }
    const pathWords = new Set(words(file)), matchedPath = terms.filter(term => pathWords.has(term));
    const matchedSource = terms.filter(term => sourceWords.has(term));
    if (!score && (matchedPath.length || matchedSource.length >= 3)) {
      score = Math.min(40, matchedPath.length * 10 + matchedSource.length * 2);
      if (score >= 10) evidence.push({ kind: 'Text match', text: `Related terms: ${[...new Set([...matchedPath, ...matchedSource])].slice(0, 5).join(', ')}` });
    }
    if (score >= 10) candidates.set(file, { file, score, strength, evidence, sourceLine });
  }
  const seeds = [...candidates.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 30);
  const queue = seeds.map(seed => ({ file: seed.file, depth: 0 }));
  const visited = new Set(queue.map(item => item.file));
  for (let index = 0; index < queue.length; index++) {
    const { file, depth } = queue[index];
    if (depth >= 2) continue;
    for (const [kind, targets] of [['Imported by', graph.imports.get(file)], ['Consumer of', graph.consumers.get(file)]]) for (const target of targets || []) {
      const relationship = { kind, text: file };
      if (candidates.has(target)) { const evidence = candidates.get(target).evidence; if (evidence.length < 6) evidence.push(relationship); }
      else candidates.set(target, { file: target, score: 8 - depth, strength: 'Dependency', evidence: [relationship], sourceLine: 1 });
      if (!visited.has(target)) { visited.add(target); queue.push({ file: target, depth: depth + 1 }); }
    }
  }
  const ranked = [...candidates.values()].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  return { candidates: ranked.slice(0, 60).map(({ score, sourceLine, ...candidate }) => {
    const lines = sources.get(candidate.file).content.split(/\r?\n/), start = Math.max(0, sourceLine - 2);
    return { ...candidate, sourceHash: sources.get(candidate.file).hash, excerpt: lines.slice(start, start + 5).map((line, index) => ({ line: start + index + 1, text: line.slice(0, 400) })) };
  }), unresolved: graph.unresolved, omitted: Math.max(0, ranked.length - 60) };
}

export async function analyzeChange(root, change) {
  if (typeof change !== 'string' || !change) throw new Error('Select an existing active change');
  await fs.mkdir(runtime(root, 'analyses'), { recursive: true });
  return withLock(runtime(root, 'analyses', `${hash(change)}.lock`), async () => {
    const input = await analysisInputs(root, change), found = candidatesFor(input);
    const analysis = { id: randomUUID(), change, createdAt: new Date().toISOString(), fingerprint: input.fingerprint,
      artifacts: input.artifacts.map(({ file, hash }) => ({ file, hash })), candidates: found.candidates,
      coverage: { scanned: input.sources.size, bytes: input.bytes, skipped: input.skipped, unresolved: found.unresolved, omitted: found.omitted,
        scope: 'Path, symbol, and text matches with local JS/TS imports, CSS imports, and HTML assets. Dynamic imports without literal paths, aliases, external packages, and other language dependency graphs are not resolved. Matches suggest scope; they do not prove changes are needed.' } };
    await writeJSON(location(root, change), analysis);
    return analysis;
  });
}

export async function savedAnalysis(root, change) {
  const analysis = await readJSON(location(root, change));
  if (!analysis) return null;
  try { return { ...analysis, stale: (await analysisInputs(root, change)).fingerprint !== analysis.fingerprint }; }
  catch { return { ...analysis, stale: true }; }
}
