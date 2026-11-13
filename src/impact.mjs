import * as fs from 'node:fs/promises';
import path from 'node:path';
import { readJSON, within, safeID } from './files.mjs';
import { reviewScope } from './review-store.mjs';

const cache = new Map();
const extensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.scss', '.html', '.svg'];
const supported = new Set(extensions.filter(extension => !['.json', '.svg'].includes(extension)));
const moduleExtensions = new Set(['.js', '.mjs', '.ts', '.tsx', '.jsx']);
const identifier = token => /^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(token || '');
const moduleTokens = source => [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*|[^\s]/gu)].map(match => match[0]).filter(token => !token.startsWith('//') && !token.startsWith('/*'));
export const isTestFile = file => /(?:^|\/)(?:test|tests|__tests__)\//.test(file) || /\.(?:test|spec)\.[^/]+$/.test(file);

// Explicit ES-module names are source evidence; wildcard exports are not expanded.
export function exportedNames(source, file) {
  if (!moduleExtensions.has(path.posix.extname(file).toLowerCase())) return null;
  const tokens = moduleTokens(source), names = new Set();
  let wildcard = false;
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] !== 'export') continue;
    let at = index + 1;
    if (tokens[at] === 'default') { names.add('default'); continue; }
    if (tokens[at] === 'async') at++;
    if (tokens[at] === 'type' && tokens[at + 1] === '{') at++;
    if (tokens[at] === '{') {
      let name = null;
      for (at++; at < tokens.length && tokens[at] !== '}'; at++) {
        if (tokens[at] === ',') { if (name) names.add(name); name = null; }
        else if (tokens[at] === 'as') name = tokens[++at];
        else if (!name && identifier(tokens[at]) && tokens[at] !== 'type') name = tokens[at];
      }
      if (name) names.add(name);
    } else if (tokens[at] === '*') {
      if (tokens[at + 1] === 'as') names.add(tokens[at + 2]); else wildcard = true;
    } else if (['function', 'class', 'const', 'let', 'var', 'interface', 'type', 'enum'].includes(tokens[at])) {
      if (tokens[at + 1] === '*') at++;
      if (identifier(tokens[at + 1])) names.add(tokens[at + 1]);
    }
  }
  return { names: [...names].sort(), wildcard };
}

// Extract module strings without treating comments or string contents as code.
export function references(source, file) {
  const extension = path.posix.extname(file).toLowerCase();
  if (['.css', '.scss'].includes(extension)) return [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']|url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(match => match[1] || match[2]);
  if (extension === '.html') return [...source.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  if (!supported.has(extension)) return [];
  const tokens = moduleTokens(source);
  const string = token => token && /^['"]/.test(token) ? token.slice(1, -1) : null;
  const refs = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === 'import' && string(tokens[index + 1])) refs.push(string(tokens[index + 1]));
    if (token === 'from' && string(tokens[index + 1])) refs.push(string(tokens[index + 1]));
    if (['import', 'require', 'URL'].includes(token) && tokens[index + 1] === '(' && string(tokens[index + 2])) refs.push(string(tokens[index + 2]));
  }
  return [...new Set(refs)];
}

export function resolveReference(file, reference, files) {
  if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) return null;
  const relative = reference.split(/[?#]/)[0];
  const candidates = [];
  if (relative.startsWith('.')) candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), relative)));
  else if (relative.startsWith('/')) candidates.push(`public/${relative.slice(1)}`, relative.slice(1));
  else if (['.html', '.css', '.scss'].includes(path.posix.extname(file))) candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(file), relative)));
  else return null;
  for (const base of candidates) {
    if (base.startsWith('../')) continue;
    const options = [base, ...extensions.map(extension => base + extension), ...extensions.map(extension => `${base}/index${extension}`)];
    if (base.endsWith('.js')) options.push(base.slice(0, -3) + '.ts', base.slice(0, -3) + '.tsx');
    const found = options.find(candidate => files.has(candidate));
    if (found) return found;
  }
  return undefined;
}

async function buildGraphs(root, preview, result) {
  const manifest = await readJSON(await within(root, `.spequi/previews/${preview}/manifest.json`));
  if (!manifest) throw new Error('Preview manifest is unavailable');
  const beforeFiles = new Set(Object.keys(manifest));
  const changes = new Map(result.changes.map(change => [change.file, change]));
  const afterFiles = new Set([...beforeFiles].filter(file => changes.get(file)?.type !== 'deleted'));
  for (const change of result.changes) if (change.type !== 'deleted') afterFiles.add(change.file);
  // Unsupported files retain their baseline relationship, with that limitation disclosed.
  const before = new Map(), after = new Map(), unresolved = new Map(), symbols = new Map();
  let skipped = 0;
  const readRefs = async (file, tree) => {
    if (!supported.has(path.posix.extname(file).toLowerCase())) return [];
    const absolute = await within(root, `.spequi/previews/${preview}/${tree}/${file}`);
    const stat = await fs.stat(absolute);
    if (stat.size > 512000) { skipped++; return []; }
    const source = await fs.readFile(absolute, 'utf8');
    if (changes.has(file)) {
      if (!symbols.has(file)) symbols.set(file, {});
      symbols.get(file)[tree] = exportedNames(source, file);
    }
    return references(source, file);
  };
  const graph = (file, refs, files, destination) => {
    const dependencies = new Set();
    for (const reference of refs) {
      const target = resolveReference(file, reference, files);
      if (target) dependencies.add(target);
      else if (target === undefined) unresolved.set(`${file}\0${reference}`, { file, reference });
    }
    destination.set(file, dependencies);
  };
  for (const file of new Set([...beforeFiles, ...afterFiles])) {
    const oldRefs = beforeFiles.has(file) ? await readRefs(file, 'baseline') : [];
    if (beforeFiles.has(file)) graph(file, oldRefs, beforeFiles, before);
    if (afterFiles.has(file)) graph(file, changes.has(file) && changes.get(file).type !== 'deleted' ? await readRefs(file, 'proposed') : oldRefs, afterFiles, after);
  }
  return { before, after, symbols, unresolved: [...unresolved.values()], skipped, unsupported: result.unsupported.length };
}

function impactSummary(change, direct, transitive, dependencies, symbols) {
  const count = direct.length + transitive.length;
  const tests = [...direct, ...transitive.map(item => item.file)].filter(isTestFile);
  const oldNames = symbols?.baseline?.names || [], newNames = symbols?.proposed?.names || [];
  const addedExports = newNames.filter(name => !oldNames.includes(name));
  const removedExports = oldNames.filter(name => !newNames.includes(name));
  const title = change.type === 'deleted' ? 'A file is being removed.' : count ? `${count} ${count === 1 ? 'file depends' : 'files depend'} on this change.` : 'No static dependents found.';
  const sentences = [];
  if (count) sentences.push(`${direct.length} direct ${direct.length === 1 ? 'consumer' : 'consumers'}${transitive.length ? ` connect it to ${transitive.length} downstream ${transitive.length === 1 ? 'file' : 'files'}` : ' reference this file'} across the baseline and proposal.`);
  else sentences.push('Runtime usage and references outside this static scan can still be affected.');
  if (change.type === 'deleted') sentences.push('Review callers and their replacements before applying the deletion.');
  if (removedExports.length) sentences.push(`Removes ${removedExports.length} explicit ${removedExports.length === 1 ? 'export' : 'exports'}; consumers may need to update their imports.`);
  else if (addedExports.length) sentences.push(`Adds ${addedExports.length} explicit ${addedExports.length === 1 ? 'export' : 'exports'} to the module interface.`);
  const changedImports = dependencies.filter(item => item.state !== 'retained');
  if (changedImports.length) sentences.push(`${changedImports.length} local ${changedImports.length === 1 ? 'dependency changes' : 'dependencies change'} in this proposal.`);
  if (change.type === 'modified' && change.additions === 0 && change.deletions === 0 && change.lineEndings?.before !== change.lineEndings?.after) sentences.push('The proposal changes line endings without content-line edits.');
  return { title, text: sentences.join(' '), tests, addedExports, removedExports, wildcard: Boolean(symbols?.baseline?.wildcard || symbols?.proposed?.wildcard), dependentCount: count };
}

export async function dependencyImpact(root, preview, file) {
  safeID(preview);
  const { result } = await reviewScope(root, preview);
  if (!result.changes.some(change => change.file === file)) throw new Error('Impact file is not part of this preview');
  const key = `${root}\0${preview}`;
  if (!cache.has(key)) {
    if (cache.size >= 6) cache.delete(cache.keys().next().value);
    const pending = buildGraphs(root, preview, result).catch(error => { cache.delete(key); throw error; });
    cache.set(key, pending);
  }
  const { before, after, symbols, unresolved, skipped, unsupported } = await cache.get(key);
  const reverse = new Map();
  for (const graph of [before, after]) for (const [importer, targets] of graph) for (const target of targets) {
    if (!reverse.has(target)) reverse.set(target, new Set());
    reverse.get(target).add(importer);
  }
  const direct = [...(reverse.get(file) || [])].filter(item => item !== file).sort();
  const visited = new Set([file, ...direct]), queue = direct.map(item => ({ file: item, via: file })), transitive = [];
  for (let at = 0; at < queue.length; at++) for (const dependent of reverse.get(queue[at].file) || []) if (!visited.has(dependent)) {
    visited.add(dependent); const entry = { file: dependent, via: queue[at].file }; transitive.push(entry); queue.push(entry);
  }
  const dependencies = [...new Set([...(before.get(file) || []), ...(after.get(file) || [])])].sort().map(target => ({ file: target, state: !before.get(file)?.has(target) ? 'added' : !after.get(file)?.has(target) ? 'removed' : 'retained' }));
  const summary = impactSummary(result.changes.find(change => change.file === file), direct, transitive, dependencies, symbols.get(file));
  return { file, direct, transitive: transitive.sort((a, b) => a.file.localeCompare(b.file)), dependencies, summary, unresolved, skipped, unsupported, scope: 'Relative JS/TS modules, CSS imports, HTML assets, and explicit ES-module exports across baseline and proposal. Runtime behavior, aliases, external packages, other languages, and wildcard export targets are outside this static scan.' };
}
