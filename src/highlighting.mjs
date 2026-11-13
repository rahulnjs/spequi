import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { codeToTokens, createOnigurumaEngine, getSingletonHighlighter } from 'shiki';
import { diffWordsWithSpace } from 'diff';
import { escape } from './specs.mjs';

const require = createRequire(import.meta.url);
const languages = { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json', css: 'css', scss: 'scss', html: 'html', htm: 'html', md: 'markdown', mdx: 'mdx', yaml: 'yaml', yml: 'yaml', py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php', sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash', xml: 'xml', toml: 'toml', vue: 'vue', svelte: 'svelte', graphql: 'graphql', gql: 'graphql', diff: 'diff', patch: 'diff' };
const cache = new Map();
let highlighterReady;
const colorCache = new Map();
const backgrounds = {
  light: { context: '#fdfdfe', addition: '#e7f5eb', deletion: '#fff0ee', 'word-addition': '#a7e5b7', 'word-deletion': '#ffc0b8' },
  dark: { context: '#1c2330', addition: '#183428', deletion: '#382326', 'word-addition': '#275e3b', 'word-deletion': '#79383d' }
};
const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const luminance = color => color.map(value => { const s = value / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
export function contrastRatio(foreground, background) {
  const a = luminance(rgb(foreground)), b = luminance(rgb(background));
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
export function readableColor(color, background, dark) {
  const key = `${color}:${background}:${dark}`;
  if (colorCache.has(key)) return colorCache.get(key);
  const original = rgb(color);
  let result = color;
  for (let step = 0; step <= 20 && contrastRatio(result, background) < 4.5; step++) {
    result = '#' + original.map(channel => Math.round(channel + ((dark ? 255 : 0) - channel) * (step + 1) / 21).toString(16).padStart(2, '0')).join('');
  }
  colorCache.set(key, result);
  return result;
}
export function fileLanguage(file) {
  if (path.basename(file).toLowerCase() === 'dockerfile') return 'dockerfile';
  const extension = path.extname(file).slice(1).toLowerCase();
  return Object.hasOwn(languages, extension) ? languages[extension] : 'text';
}
export async function highlightSource(source, file) {
  const language = fileLanguage(file);
  const key = language + ':' + createHash('sha256').update(source).digest('hex');
  if (cache.has(key)) return cache.get(key);
  const raw = source.replace(/\r\n/g, '\n').split('\n');
  let result;
  if (language === 'text' || source.length > 250000) {
    result = { language, limited: source.length > 250000, lines: raw.map(content => [{ content }]) };
  } else {
    // Extremely long minified lines remain readable plain text; other lines still tokenize.
    const input = raw.map(line => line.length > 10000 ? '' : line).join('\n');
    try {
      // Shiki's inlined loader uses Response.bytes(), unavailable in early Node 20.
      await (highlighterReady ||= getSingletonHighlighter({ engine: createOnigurumaEngine(readFile(require.resolve('shiki/onig.wasm'))) }));
      const { tokens } = await codeToTokens(input, { lang: language, themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false });
      result = { language, limited: raw.some(line => line.length > 10000), lines: raw.map((line, index) => line.length > 10000 ? [{ content: line }] : tokens[index] || [{ content: line }]) };
    } catch {
      result = { language: 'text', limited: true, lines: raw.map(content => [{ content }]) };
    }
  }
  cache.set(key, result);
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  return result;
}
export function changedWordRanges(before, after) {
  if (!before || !after || before.length + after.length > 10000) return { before: [], after: [] };
  const result = { before: [], after: [] };
  let oldOffset = 0, newOffset = 0;
  for (const part of diffWordsWithSpace(before, after)) {
    if (part.removed) { result.before.push([oldOffset, oldOffset + part.value.length]); oldOffset += part.value.length; }
    else if (part.added) { result.after.push([newOffset, newOffset + part.value.length]); newOffset += part.value.length; }
    else { oldOffset += part.value.length; newOffset += part.value.length; }
  }
  return result;
}
export function renderTokens(tokens, ranges = [], type = '') {
  let offset = 0;
  return (tokens || []).map(token => {
    const start = offset, end = offset + token.content.length;
    offset = end;
    const boundaries = [...new Set([start, end, ...ranges.flat().filter(boundary => boundary > start && boundary < end)])].sort((a, b) => a - b);
    const light = token.htmlStyle?.['--shiki-light'];
    const dark = token.htmlStyle?.['--shiki-dark'];
    return boundaries.slice(0, -1).map((boundary, index) => {
      const text = escape(token.content.slice(boundary - start, boundaries[index + 1] - start));
      const changed = ranges.some(([from, to]) => boundary >= from && boundary < to);
      const role = changed && type ? `word-${type}` : type || 'context';
      const style = light && dark && /^#[0-9a-f]{6,8}$/i.test(light) && /^#[0-9a-f]{6,8}$/i.test(dark) ? ` style="--syntax-light:${readableColor(light, backgrounds.light[role] || backgrounds.light.context, false)};--syntax-dark:${readableColor(dark, backgrounds.dark[role] || backgrounds.dark.context, true)}"` : '';
      return `<span class="syntax-token${changed ? ` word-change ${type}` : ''}"${style}>${text}</span>`;
    }).join('');
  }).join('') || ' ';
}
