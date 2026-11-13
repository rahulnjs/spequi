import * as fs from 'node:fs/promises';
import path from 'node:path';
import { marked } from 'marked';
import { fromHtml } from 'hast-util-from-html';
import { sanitize } from 'hast-util-sanitize';
import { toHtml } from 'hast-util-to-html';
import { createTwoFilesPatch } from 'diff';
import { walk, within, exists } from './files.mjs';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const markdownSchema = {
  tagNames: 'address article aside footer header h1 h2 h3 h4 h5 h6 hgroup main nav section blockquote dd div dl dt figcaption figure hr li menu ol p pre ul a abbr b bdi bdo br cite code data dfn em i kbd mark q rb rp rt rtc ruby s samp small span strong sub sup time u var wbr caption col colgroup table tbody td tfoot th thead tr input details summary'.split(' '),
  attributes: { a: ['href', 'name', 'target'], input: ['checked'], code: ['className'] },
  protocols: { href: ['http', 'https', 'mailto'] },
  required: { input: { type: 'checkbox', disabled: true } },
  strip: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'svg', 'math']
};
export const sanitizeMarkdownHTML = html => toHtml(sanitize(fromHtml(html, { fragment: true }), markdownSchema), { preferNamedReferences: true });
export const markdown = text => sanitizeMarkdownHTML(marked.parse(text));
export function taskProgress(text) {
  const tasks = [...text.matchAll(/^\s*[-*]\s+\[([^\]]*)\]\s+(.+)$/gm)].map(match => ({ done: match[1].trim().toLowerCase() === 'x', text: match[2] }));
  return { total: tasks.length, done: tasks.filter(task => task.done).length, tasks };
}
export function changeState(change) {
  if (change?.archived) return { label: 'Archived', type: '', complete: false };
  if (!change?.progress.total) return { label: 'Planning', type: '', complete: false };
  if (change.progress.done === change.progress.total) return { label: 'Tasks complete', type: 'success', complete: true };
  return { label: 'In progress', type: 'blue', complete: false };
}
export function jobMatchesChange(job, change) {
  return job.change === change.id || Boolean(change.archived && /^\d{4}-\d{2}-\d{2}-/.test(change.id) && job.change === change.id.slice(11));
}
export async function readArtifact(root, file) {
  if (!file.endsWith('.md') || !file.startsWith('openspec/')) throw new Error('Select a Markdown file under openspec/');
  const absolute = await within(root, file);
  if ((await fs.stat(absolute)).size > 2 * 1024 * 1024) throw new Error('Document exceeds the 2 MB reading limit');
  return fs.readFile(absolute, 'utf8');
}
export async function inventory(root) {
  const discovered = (await walk(root, { filter: relative => relative === 'openspec' || relative.startsWith('openspec/') })).filter(file => file.endsWith('.md') || path.basename(file) === '.openspec.yaml');
  const files = discovered.filter(file => file.endsWith('.md'));
  const active = new Map(), archived = new Map(), specs = [];
  for (const file of discovered) {
    const parts = file.split('/');
    if (parts[1] === 'specs') { if (parts.at(-1) === 'spec.md') specs.push({ id: parts.slice(2, -1).join('/'), file }); continue; }
    if (parts[1] !== 'changes') continue;
    const isArchive = parts[2] === 'archive';
    const id = parts[isArchive ? 3 : 2];
    if (!id) continue;
    const map = isArchive ? archived : active;
    if (!map.has(id)) map.set(id, { id, archived: isArchive, files: [], progress: { total: 0, done: 0, tasks: [] }, title: id.replace(/-/g, ' ') });
    const change = map.get(id);
    if (file.endsWith('.md')) change.files.push(file);
    if (parts.at(-1) === 'tasks.md') change.progress = taskProgress(await readArtifact(root, file));
    if (parts.at(-1) === 'proposal.md') {
      const source = await readArtifact(root, file);
      change.title = source.match(/^#\s+(.+)$/m)?.[1] || change.title;
      change.summary = source.match(/## Why\s+([\s\S]*?)(?=\n##|$)/)?.[1]?.trim() || '';
    }
  }
  const changes = [...active.values(), ...archived.values()];
  for (const change of changes) change.files.sort((a, b) => {
    const rank = file => ({ 'proposal.md': 0, 'design.md': 1, 'tasks.md': 2 }[path.basename(file)] ?? 3);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return { name: path.basename(root), root, files, changes, specs };
}
export async function requirementDiffs(root, change) {
  const prefix = `openspec/changes/${change.archived ? 'archive/' : ''}${change.id}/specs/`;
  const results = [];
  for (const file of change.files.filter(file => file.startsWith(prefix) && file.endsWith('/spec.md'))) {
    const capability = file.slice(prefix.length, -'/spec.md'.length);
    const source = await readArtifact(root, file);
    const currentFile = `openspec/specs/${capability}/spec.md`;
    const current = await exists(await within(root, currentFile)) ? await readArtifact(root, currentFile) : '';
    const operations = [...source.matchAll(/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements\s*([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match => ({ operation: match[1], count: (match[2].match(/^### Requirement:/gm) || []).length || (match[2].match(/FROM:/g) || []).length }));
    results.push({ capability, current, proposed: source, operations, patch: createTwoFilesPatch(currentFile, file, current, source) });
  }
  return results;
}
