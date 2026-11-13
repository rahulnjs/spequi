import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {renderReviewMarkdown} from '../src/document-view.mjs';
import {icon} from '../src/views.mjs';

const render = (source, comments=[]) => parseHTML(renderReviewMarkdown(source,{sourceHash:'current-hash',comments,icon})).document;

test('rendered Markdown gutters map headings, paragraphs, list items, code lines and references to CRLF source ranges',()=>{
  const lines=['# Heading','','First paragraph line','continued **bold** line','','- First item','  continuation','- Second item','','```js','const value = 1;','console.log(value);','```','','[Reference][ref]','','[ref]: https://example.com'];
  const doc=render(lines.join('\r\n'));
  assert.deepEqual([...doc.querySelectorAll('[data-review-line]')].map(node=>[Number(node.dataset.reviewLine),Number(node.dataset.reviewEnd)]),[[1,1],[3,4],[6,7],[8,8],[11,11],[12,12],[15,15]]);
  assert.equal(doc.querySelector('strong').textContent,'bold');
  assert.equal(doc.querySelector('a').getAttribute('href'),'https://example.com');
  assert.equal(doc.querySelectorAll('ul.markdown-review-list>li').length,2);
  assert.equal(doc.querySelector('.markdown-code-review-line code').textContent,'const value = 1;');
});

test('Markdown review preserves tables, nested/ordered lists and sanitization without allowing forged controls',()=>{
  const doc=render('3. Third\n   - Nested\n4. Fourth\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n<script>alert(1)</script>\n\n<div data-review-line="999" id="review-comment-form"><button data-review-line="888">Spoof</button><a href="javascript:alert(1)">Unsafe</a></div>\n');
  assert.equal(doc.querySelector('ol').getAttribute('start'),'3');
  assert.equal(doc.querySelectorAll('ol.markdown-review-list>li').length,2);
  assert.equal(doc.querySelector('li ul li').textContent,'Nested');
  assert.equal(doc.querySelector('table tbody td').textContent,'A');
  assert.equal(doc.querySelector('script,#review-comment-form,[data-review-line="999"],[data-review-line="888"]'),null);
  assert.equal(doc.querySelector('a[href^="javascript:"]'),null);
});

test('only current-version source comments are placed inline once, with other notes kept for discussion',()=>{
  const notes=[{id:'current',preview:'scope',sourceHash:'current-hash',side:'document',start:3,end:4,createdAt:'2026-11-10T00:00:00Z',body:'Literal <script>feedback</script>'},{id:'old',preview:'scope',sourceHash:'older-hash',side:'document',start:3,end:4,body:'Old version'},{id:'general',preview:'scope',sourceHash:'current-hash',side:'file',body:'General note'}];
  const doc=render('# Heading\n\nFirst line\nSecond line\n',notes);
  assert.equal(doc.querySelectorAll('.document-comment').length,1);
  assert.ok(doc.getElementById('inline-document-comment-current'));
  assert.equal(doc.querySelector('[data-comment-disclosure]').hasAttribute('open'),false);
  assert.ok(doc.querySelector('.document-comment > .saved-comment-tools [data-delete-comment]'));
  assert.equal(doc.querySelector('.document-comment p').textContent,'Literal <script>feedback</script>');
  assert.equal(doc.querySelector('.document-comment script'),null);
  assert.equal(doc.querySelector('.document-inline-thread').textContent,'');
  assert.equal(doc.getElementById('inline-document-comment-current').closest('[data-document-thread]').dataset.documentThread,'3');
  const empty=render('```\n```\n');
  assert.equal(empty.querySelector('.markdown-code-review-line'),null);
  assert.equal(empty.querySelector('[data-review-line]').dataset.reviewLine,'1');
});
