import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { highlightSource, renderTokens, changedWordRanges, readableColor, contrastRatio } from '../src/highlighting.mjs';
import { buildDiffRows, foldDiffRows } from '../src/diffs.mjs';
import { initProject } from '../src/project.mjs';
import { enqueue, claimNext, updateJob } from '../src/jobs.mjs';
import { startServer } from '../src/server.mjs';
import { addComment } from '../src/review-store.mjs';

test('syntax tokens support both themes, multiline state, and inline changed words', async () => {
  const source = '/* first\nsecond */\nconst count = 2;';
  const code = await highlightSource(source, 'app.mjs');
  assert.equal(code.language, 'javascript');
  assert.equal(code.lines[1].map(token => token.content).join(''), 'second */');
  const ranges = changedWordRanges('const count = 1;', 'const count = 2;');
  const html = renderTokens(code.lines[2], ranges.after, 'addition');
  assert.match(html, /--syntax-light:#[0-9a-f]+;--syntax-dark:#[0-9a-f]+/i);
  assert.match(html, /class="syntax-token word-change addition"[^>]*>2<\/span>/);
  assert.equal(html.replace(/<[^>]+>/g, ''), 'const count = 2;');
  const old = await highlightSource('const count = 1;', 'app.mjs');
  assert.match(renderTokens(old.lines[0], ranges.before, 'deletion'), /word-change deletion/);
});

test('syntax colors retain readable contrast on line and word backgrounds in both modes', () => {
  for (const [dark, fills] of [[false, ['#fdfdfe', '#e7f5eb', '#fff0ee', '#a7e5b7', '#ffc0b8']], [true, ['#1c2330', '#183428', '#382326', '#275e3b', '#79383d']]]) {
    for (const fill of fills) for (const color of ['#6A737D', '#D73A49', '#F97583', '#005CC5', '#79B8FF']) {
      assert.ok(contrastRatio(readableColor(color, fill, dark), fill) >= 4.5);
    }
  }
});

test('supported languages highlight and unknown, minified, or huge input preserves escaped text', async () => {
  for (const [file, source] of [['style.css', '.a { color: red; }'], ['data.json', '{"enabled": true}'], ['spec.md', '# Requirement'], ['config.yaml', 'enabled: true']]) {
    const code = await highlightSource(source, file);
    assert.equal(code.limited, false);
    assert.match(renderTokens(code.lines[0]), /syntax-light/);
  }
  const attack = '</code><script>alert("bad")</script>';
  const plain = await highlightSource(attack, 'file.unknown');
  const html = renderTokens(plain.lines[0]);
  assert.equal(plain.language, 'text');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  const long = 'x'.repeat(10001);
  const minified = await highlightSource(long + '\nconst ok = true;', 'code.js');
  assert.equal(minified.limited, true);
  assert.equal(minified.lines[0][0].content, long);
  assert.match(renderTokens(minified.lines[1]), /syntax-light/);
  const huge = await highlightSource('x'.repeat(250001), 'huge.js');
  assert.equal(huge.lines[0][0].content.length, 250001);
});

test('context folding preserves neighboring lines and expands only the requested gap', () => {
  const before = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
  const after = before.replace('line 20', 'changed line 20');
  const rows = buildDiffRows(before, after).split;
  const folded = foldDiffRows(rows);
  const gaps = folded.filter(entry => entry.kind === 'gap');
  assert.equal(gaps.length, 2);
  assert.ok(folded.some(entry => entry.row?.before?.line === 'line 19'));
  assert.ok(folded.some(entry => entry.row?.after?.line === 'changed line 20'));
  const expanded = foldDiffRows(rows, gaps[0].id);
  assert.equal(expanded.filter(entry => entry.kind === 'gap').length, 1);
  assert.equal(foldDiffRows(rows, 'all').length, 40);
  assert.equal(foldDiffRows(rows, 'all').filter(entry => entry.hunk).length, 1);
});

async function reviewFixture(t, { file = 'src/app.mjs', source } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'opsx-highlight-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await initProject(root);
  const write = async (base, file, content) => { await fs.mkdir(path.dirname(path.join(base, file)), { recursive: true }); await fs.writeFile(path.join(base, file), content); };
  for (const file of ['proposal', 'design', 'tasks']) await write(root, `openspec/changes/highlight/${file}.md`, `# ${file}\n`);
  const before = source ?? [...Array.from({ length: 15 }, (_, index) => `// context ${index}`), 'const count = 1;', ...Array.from({ length: 15 }, (_, index) => `// end ${index}`)].join('\n') + '\n';
  await write(root, file, before);
  await write(root, 'src/next.mjs', 'const keep = true;\n');
  await enqueue(root, { action: 'preview', change: 'highlight' });
  const job = await claimNext(root, 'Test agent');
  await write(job.workingDirectory, file, before.replace('count = 1', 'count = 2'));
  await write(job.workingDirectory, 'src/next.mjs', 'const keep = false;\n');
  await updateJob(root, job.id, job.claimToken, 'finish', 'Ready');
  const viewer = await startServer({ root, port: 0, quiet: true });
  t.after(() => viewer.close());
  return { viewer, job, root };
}

test('review routes render highlighted folded code, wrapping controls, paging, and review tabs', async t => {
  const { viewer, job } = await reviewFixture(t);
  const base = `${viewer.origin}/?change=highlight&view=preview&job=${job.id}&file=src/app.mjs`;
  const html = await (await fetch(base)).text();
  assert.match(html, /word-change addition/);
  assert.match(html, /--syntax-dark/);
  assert.match(html, /diff-context-gap/);
  assert.match(html, /Show \d+ unchanged lines/);
  assert.match(html, /data-diff-jump="next"/);
  assert.match(html, /aria-label="Next file"/);
  assert.match(html, /aria-label="Review details"/);
  assert.match(html, /aria-label="Filter changed files"/);
  assert.equal((await fetch(viewer.origin + '/assets/diff.css')).status, 200);
  const { document } = parseHTML(html);
  assert.deepEqual([...document.querySelectorAll('.document-tab>span:first-of-type')].map(node => node.textContent), ['proposal', 'design', 'tasks', 'Files', 'Build']);
  assert.equal(document.querySelector('.compact-change-header .diff-version-form,.compact-change-header .badge,.compact-change-header details'), null);
  assert.match(document.querySelector('.breadcrumbs').textContent, /Changes.*highlight/);
  assert.equal(document.querySelector('[data-review-details]').getAttribute('aria-expanded'), 'true');
  assert.ok(document.querySelector('.compact-change-header>.breadcrumbs+.document-tabs'));
  assert.equal(document.querySelector('.file-review-intro,.diff-context-toolbar,.change-header'), null);
  assert.deepEqual([...document.querySelectorAll('#review-details>.inspector-section>.section-title>h2')].map(node => node.textContent), ['File impact', 'Review comments', 'Change details']);
  assert.equal(document.querySelector('#review-details [data-apply-form],#review-details .workflow-form,#review-details .activity-section'), null);
  for (const tab of document.querySelectorAll('.document-tab')) {
    const { document: next } = parseHTML(await (await fetch(viewer.origin + tab.getAttribute('href'))).text());
    if (tab.textContent.includes('Build')) { assert.ok(next.querySelector('#studio'));  assert.equal(next.querySelector('#review-details'), null); continue; }
    assert.ok(next.querySelector('.details-icon-toggle[aria-expanded="true"]'));
    assert.ok(next.querySelector('.compact-change-header>.breadcrumbs+.document-tabs'));
    assert.equal(next.querySelector('#review-details .workflow-form,#review-details .activity-section,#review-details .preview-details'), null);
    assert.match(next.querySelector('#review-details').textContent, /Change details/);
  }
  const expandURL = document.querySelector('.expand-context').getAttribute('href');
  const expanded = await (await fetch(viewer.origin + expandURL)).text();
  assert.ok((expanded.match(/diff-context-gap/g) || []).length < (html.match(/diff-context-gap/g) || []).length);
  const unified = await (await fetch(base + '&mode=unified&wrap=0&context=all')).text();
  assert.match(unified, /unified-diff-table/);
  assert.match(unified, /no-wrap/);
  assert.doesNotMatch(unified, /class="diff-context-gap"/);
  assert.match(unified, /word-change deletion/);
});

test('diff controls preserve review panel access, filter files, navigate change blocks, and persist dark mode', async t => {
  const { viewer } = await reviewFixture(t);
  const html = await (await fetch(viewer.origin + '/?view=preview')).text();
  const { document, window } = parseHTML(html);
  const stored = new Map();
  const source = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, {
    document, window, location: { protocol: 'http:', host: new URL(viewer.origin).host },
    localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value) },
    WebSocket: class { addEventListener() {} }, setTimeout, clearTimeout
  });
  const toggle = document.getElementById('toggle-review-details');
  const panel = document.getElementById('review-details');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-label'), 'Hide review details');
  assert.equal(panel.hidden, false);
  toggle.click();
  assert.equal(panel.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('title'), 'Show review details');
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(panel.hidden, true);
  toggle.click();
  assert.equal(panel.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(document.querySelector('#review-details #review-comments'));
  const filter = document.getElementById('file-filter');
  filter.value = 'next.mjs'; filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.querySelector('[data-file-path="src/app.mjs"]').hidden, true);
  assert.equal(document.querySelector('[data-file-path="src/next.mjs"]').hidden, false);
  filter.value = 'missing'; filter.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(document.getElementById('file-filter-empty').hidden, false);
  let scrolled = false;
  document.querySelector('[data-diff-hunk]').scrollIntoView = () => { scrolled = true; };
  document.querySelector('[data-diff-jump="next"]').click();
  assert.equal(scrolled, true);
  assert.match(document.querySelector('.hunk-position').textContent, /Change 1 of 1/);
  const theme = document.getElementById('theme-toggle'); theme.click();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(stored.get('spequi-theme'), 'dark');
});

test('long root-level Markdown is complete in both comparison columns', async t => {
  const source = '# Layout\n\n' + 'A long description of the review workspace. '.repeat(80) + 'count = 1\n';
  const { viewer } = await reviewFixture(t, { file: 'DESIGN.md', source });
  const html = await (await fetch(viewer.origin + '/?view=preview&file=DESIGN.md&context=all&mode=split')).text();
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('.diff-file-identity strong').textContent, 'DESIGN.md');
  assert.equal(document.querySelector('.diff-file-identity>div>span'), null);
  const cells = [...document.querySelectorAll('.review-diff-table tbody tr')].flatMap(row => [...row.querySelectorAll('td.diff-code code')].map(code => code.textContent));
  assert.ok(cells.includes(source.split('\n')[2]));
  assert.ok(cells.includes(source.split('\n')[2].replace('count = 1', 'count = 2')));
  assert.ok(document.querySelector('.diff-code-scroll.wrap-lines'));
});

test('context and layout changes restore the code scroller instead of scrolling the header pane', async t => {
  const { viewer } = await reviewFixture(t);
  const html = await (await fetch(viewer.origin + '/?view=preview')).text();
  const { document, window } = parseHTML(html);
  vm.runInNewContext(await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'), {
    document, window, location: { protocol: 'http:', host: new URL(viewer.origin).host },
    localStorage: { getItem: () => null, setItem() {} },
    WebSocket: class { addEventListener() {} }, setTimeout, clearTimeout
  });
  const reader = document.querySelector('.reader');
  const code = document.querySelector('.diff-code-scroll');
  reader.scrollTop = 17;
  code.scrollTop = 280;
  code.scrollLeft = 35;
  document.dispatchEvent(new window.CustomEvent('htmx:beforeRequest', { detail: { elt: document.querySelector('.expand-context') } }));
  const replacement = code.cloneNode(true);
  replacement.scrollTop = 0;
  replacement.scrollLeft = 0;
  code.replaceWith(replacement);
  document.dispatchEvent(new window.Event('htmx:afterSwap'));
  assert.equal(replacement.scrollTop, 280);
  assert.equal(replacement.scrollLeft, 35);
  assert.equal(reader.scrollTop, 17);
});

test('folding keeps commented context visible while retaining expandable gaps and change-block counts',()=>{
 const before=Array.from({length:100},(_,index)=>`line ${index+1}`).join('\n')+'\n';
 const rows=buildDiffRows(before,before.replace('line 51','changed line 51')).split;
 const plain=foldDiffRows(rows),pinned=foldDiffRows(rows,'',3,[10]);
 assert.equal(plain.some(entry=>entry.row?.before?.number===11),false);
 assert.ok(pinned.some(entry=>entry.row?.before?.number===11));
 assert.ok(pinned.length<rows.length);
 assert.equal(pinned.filter(entry=>entry.hunk).length,plain.filter(entry=>entry.hunk).length);
 const gap=pinned.find(entry=>entry.kind==='gap');
 assert.equal(foldDiffRows(rows,gap.id,3,[10]).some(entry=>entry.id===gap.id),false);
 const originalGap=plain.find(entry=>entry.kind==='gap');
 const expanded=foldDiffRows(rows,originalGap.id,3,[10]);
 assert.ok(expanded.some(entry=>entry.row?.before?.number===1));
 assert.equal(foldDiffRows(rows,'all',3,[10]).length,rows.length);
});

test('unified and split diffs place comments on their retained side and expose folded comment anchors',async t=>{
 const {viewer,job,root:project}=await reviewFixture(t);
 const current=await addComment(project,job.id,{file:'src/app.mjs',side:'current',start:1,end:2,body:'Current context needs explanation.'});
 const proposed=await addComment(project,job.id,{file:'src/app.mjs',side:'proposed',start:16,body:'Proposed <script>text</script>'});
 for(const mode of ['unified','split']){
  const doc=parseHTML(await(await fetch(`${viewer.origin}/?change=highlight&view=preview&job=${job.id}&file=src/app.mjs&mode=${mode}`)).text()).document;
  assert.ok(doc.querySelector('[data-review-side="current"][data-review-line="2"]'));
  assert.equal(doc.querySelectorAll('.diff-comment').length,2);
  const first=doc.getElementById(`inline-diff-comment-${current.id}`),second=doc.getElementById(`inline-diff-comment-${proposed.id}`);
  assert.equal(first.closest('[data-diff-thread]').dataset.diffSide,'current');assert.equal(first.closest('[data-diff-thread]').dataset.diffLine,'2');
  assert.equal(second.closest('[data-diff-thread]').dataset.diffSide,'proposed');assert.equal(second.closest('[data-diff-thread]').dataset.diffLine,'16');
  assert.equal(second.querySelector('p').textContent,'Proposed <script>text</script>');assert.equal(second.querySelector('script'),null);
  assert.equal(first.closest('td').getAttribute('colspan'),mode==='split'?'3':'4');
 }
});
