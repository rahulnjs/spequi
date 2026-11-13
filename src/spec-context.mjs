import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { marked } from 'marked';
import { buildDiffRows } from './diffs.mjs';
import { readJSON, within, safeID } from './files.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const lines = text => text ? text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
const relative = value => typeof value === 'string' && value.length <= 500 && !value.includes('\\') && !value.includes('\0') && !/^[a-z]:/i.test(value) && !path.posix.isAbsolute(value) && value === path.posix.normalize(value) && !value.split('/').includes('..');
const range = (start, end, count, maximum) => Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= count && end - start < maximum;
const changed = row => row.before?.type === 'deletion' || row.after?.type === 'addition';
export const specLinkKey = reference => digest(`${reference.spec}:${reference.specStart}:${reference.specEnd}`).slice(0, 16);

function headings(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  let offset = 0;
  const output = [];
  for (const token of marked.lexer(normalized)) {
    if (token.type === 'heading') output.push({ start: normalized.slice(0, offset).split('\n').length, depth: token.depth, title: token.text });
    offset += token.raw.length;
  }
  return output;
}

async function snapshot(root, id) {
  const base = `.spequi/previews/${safeID(id)}`;
  const manifest = await readJSON(await within(root, `${base}/manifest.json`));
  const job = await readJSON(await within(root, `.spequi/jobs/${id}.json`));
  if (!manifest || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/.test(job?.change || '')) throw new Error('Spec snapshot unavailable');
  const prefix = `openspec/changes/${job.change}/`;
  const artifact = file => relative(file) && file.endsWith('.md') && (file.startsWith(prefix) || file.startsWith('openspec/specs/') && file.endsWith('/spec.md')) && Object.hasOwn(manifest, file);
  const cache = new Map();
  let bytes = 0;
  async function source(file) {
    if (cache.has(file)) return cache.get(file);
    cache.set(file, null);
    if (!artifact(file)) return null;
    try {
      const location = await within(root, `${base}/baseline/${file}`), stat = await fs.stat(location);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || bytes + stat.size > 2 * 1024 * 1024) return null;
      const buffer = await fs.readFile(location);
      if (buffer.length > 2 * 1024 * 1024 || bytes + buffer.length > 2 * 1024 * 1024) return null;
      bytes += buffer.length;
      if (buffer.includes(0) || digest(buffer) !== manifest[file].hash) return null;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      const value = { file, hash: manifest[file].hash, text, lines: lines(text), headings: headings(text) };
      cache.set(file, value);
      return value;
    } catch { return null; }
  }
  return { base, manifest, prefix, source };
}

function quote(source, reference, provenance) {
  if (!source || !range(reference.specStart, reference.specEnd, source.lines.length, 80)) return null;
  const text = source.lines.slice(reference.specStart - 1, reference.specEnd).join('\n');
  if (!text.trim() || text.length > 6000) return null;
  const heading = source.headings.filter(item => item.start <= reference.specStart).at(-1);
  return { ...reference, key: specLinkKey(reference), title: heading?.title.replace(/^(?:Requirement|Scenario):\s*/i, '') || path.posix.basename(source.file), quote: text, provenance };
}

// The agent supplies locations only; source text and hashes always come from the baseline.
export async function captureSpecLinks(root, id, changes) {
  const empty = { version: 1, links: [], invalidFiles: [], invalidReport: false };
  try {
    const reportFile = await within(root, `.spequi/previews/${safeID(id)}/work/.spequi/spec-links.json`);
    const stat = await fs.stat(reportFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return empty;
    if (!stat.isFile() || stat.size > 65536) return { ...empty, invalidReport: true };
    const report = JSON.parse(await fs.readFile(reportFile, 'utf8'));
    if (report?.version !== 1 || !Array.isArray(report.links) || report.links.length > 100) return { ...empty, invalidReport: true };
    const saved = await snapshot(root, id), fileRows = new Map(), seen = new Set();
    for (const reference of report.links) {
      const file = changes.find(item => item.file === reference?.file);
      const reject = () => { if (file && !empty.invalidFiles.includes(file.file)) empty.invalidFiles.push(file.file); else if (!file) empty.invalidReport = true; };
      if (!file || !['current', 'proposed'].includes(reference.side) || empty.links.filter(item => item.file === file.file).length >= 8) { reject(); continue; }
      if (!fileRows.has(file.file)) {
        const content = async (tree, hash) => {
          if (!hash) return '';
          const buffer = await fs.readFile(await within(root, `${saved.base}/${tree}/${file.file}`));
          if (buffer.length > 2 * 1024 * 1024 || digest(buffer) !== hash) throw new Error('Preview source changed');
          return buffer.toString('utf8');
        };
        const before = await content('baseline', file.beforeHash), after = await content('proposed', file.afterHash);
        fileRows.set(file.file, { before, after, rows: buildDiffRows(before, after).split });
      }
      const content = fileRows.get(file.file), side = reference.side === 'current' ? 'before' : 'after';
      if (!range(reference.start, reference.end, lines(content[side]).length, 500) || !content.rows.some(row => changed(row) && row[side]?.type !== 'context' && row[side]?.number >= reference.start && row[side]?.number <= reference.end)) { reject(); continue; }
      const source = await saved.source(reference.spec);
      const clean = { file: file.file, side: reference.side, start: reference.start, end: reference.end, spec: reference.spec, specStart: reference.specStart, specEnd: reference.specEnd, specHash: source?.hash };
      if (!quote(source, clean, 'agent')) { reject(); continue; }
      const identity = JSON.stringify(clean);
      if (!seen.has(identity)) { empty.links.push(clean); seen.add(identity); }
    }
    return empty;
  } catch { return { ...empty, invalidReport: true }; }
}

async function suggestions(saved, file, rows) {
  const candidates = [], basename = path.posix.basename(file.file);
  const uniqueName = Object.keys(saved.manifest).filter(name => path.posix.basename(name) === basename).length === 1;
  const changedText = rows.filter(changed).flatMap(row => [row.before?.type === 'deletion' ? row.before.line : '', row.after?.type === 'addition' ? row.after.line : '']).join('\n');
  const identifiers = new Set(changedText.match(/[A-Za-z_$][\w$]{3,}/g) || []);
  for (const name of Object.keys(saved.manifest).filter(name => name.startsWith(saved.prefix) && name.endsWith('.md')).sort().slice(0, 80)) {
    const source = await saved.source(name);
    if (!source) continue;
    const sections = source.headings.length ? source.headings : [{ start: 1, depth: 1, title: path.posix.basename(name) }];
    for (let index = 0; index < sections.length; index++) {
      const section = sections[index];
      // A requirement owns its scenarios; avoid repeating the same quote for its child headings.
      if (section.depth > 3) continue;
      const nextSection = sections.slice(index + 1).find(next => next.depth <= 3);
      const end = Math.min(nextSection ? nextSection.start - 1 : source.lines.length, section.start + 79);
      const text = source.lines.slice(section.start - 1, end).join('\n');
      const symbols = [...text.matchAll(/`([A-Za-z_$][\w$]{3,})`/g)].map(match => match[1]).filter(value => identifiers.has(value) && !['true', 'false', 'null', 'const', 'return', 'function', 'string', 'number', 'boolean'].includes(value));
      const paths = [...text.matchAll(/(?:`|\b)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?:`|\b)/g)].map(match => match[1]);
      const explicit = paths.includes(file.file), filename = uniqueName && paths.includes(basename);
      if (!explicit && !filename && !symbols.length) continue;
      const reference = quote(source, { spec: name, specStart: section.start, specEnd: end, specHash: source.hash, reason: explicit ? 'File path mentioned' : filename ? 'Unique filename mentioned' : `Changed symbol: ${symbols[0]}` }, 'suggested');
      if (reference) candidates.push({ ...reference, score: explicit ? 3 : filename ? 2 : 1 });
    }
  }
  return candidates.sort((a, b) => b.score - a.score || a.spec.localeCompare(b.spec) || a.specStart - b.specStart).slice(0, 2);
}

export async function specContextForFile(root, job, file, result, before, after) {
  const context = { links: [], suggestions: [], notice: '' };
  try {
    const saved = await snapshot(root, job.id);
    const verified = (hash, text) => hash ? hash === digest(text) : text === '';
    if (!verified(file.beforeHash, before) || !verified(file.afterHash, after)) return { ...context, notice: 'The saved code changed; spec context cannot be verified.' };
    const rows = buildDiffRows(before, after).split;
    const records = result.specContext?.version === 1 ? result.specContext.links || [] : [];
    for (const reference of records.filter(item => item.file === file.file).slice(0, 8)) {
      const source = await saved.source(reference.spec);
      const side = reference.side === 'current' ? 'before' : 'after';
      const valid = ['current', 'proposed'].includes(reference.side) && range(reference.start, reference.end, lines(side === 'before' ? before : after).length, 500) && rows.some(row => changed(row) && row[side]?.type !== 'context' && row[side]?.number >= reference.start && row[side]?.number <= reference.end);
      const linked = valid && source?.hash === reference.specHash ? quote(source, reference, 'agent') : null;
      if (linked) context.links.push(linked);
      else context.notice = 'Some spec links could not be verified against this preview.';
    }
    if (result.specContext?.invalidReport || result.specContext?.invalidFiles?.includes(file.file)) context.notice = 'Some recorded spec links were invalid and are not shown.';
    if (!context.links.length) context.suggestions = await suggestions(saved, file, rows);
    return context;
  } catch { return { ...context, notice: 'The retained spec snapshot is unavailable for this preview.' }; }
}
