import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { markdown, sanitizeMarkdownHTML } from '../src/specs.mjs';

test('Markdown keeps readable structure, links, code languages, disclosures and disabled task checkboxes', () => {
  const { document } = parseHTML(markdown('# Plan\n\n[Safe link](https://example.com)\n\n- [x] Done\n- [ ] Pending\n\n```js\nconst value = 1;\n```\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n<details><summary>More</summary><p>Details</p></details>'));
  assert.equal(document.querySelector('h1').textContent, 'Plan');
  assert.equal(document.querySelector('a').getAttribute('href'), 'https://example.com');
  assert.equal(document.querySelector('pre code').getAttribute('class'), 'language-js');
  assert.equal(document.querySelector('tbody td').textContent, 'A');
  assert.equal(document.querySelector('details summary').textContent, 'More');
  const inputs = [...document.querySelectorAll('input')];
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every(node => node.getAttribute('type') === 'checkbox' && node.hasAttribute('disabled')));
  assert.deepEqual(inputs.map(node => node.hasAttribute('checked')), [true, false]);
});

test('raw HTML cannot forge controls, enable inputs, execute scripts or retain unsafe URL schemes', () => {
  const { document } = parseHTML(sanitizeMarkdownHTML('<div id="review-comment-form" data-review-line="9" onclick="alert(1)"><input type="text" onfocus="alert(1)" checked><button data-delete-comment>Fake</button><a href="javascript:alert(1)">Unsafe</a><a href="data:text/html,unsafe">Data</a><a href="mailto:user@example.com">Email</a><script>alert(1)</script><style>body{display:none}</style></div>'));
  assert.equal(document.querySelector('#review-comment-form,[data-review-line],[data-delete-comment],[onclick],[onfocus],button,script,style'), null);
  assert.equal(document.querySelector('input').getAttribute('type'), 'checkbox');
  assert.ok(document.querySelector('input').hasAttribute('disabled'));
  assert.deepEqual([...document.querySelectorAll('a')].map(node => node.getAttribute('href')), [null, null, 'mailto:user@example.com']);
  assert.doesNotMatch(document.querySelector('div').textContent, /alert\(1\)|display:none/);
});

test('malformed raw-text and foreign content stay safe after HTML parsing and serialization', () => {
  for (const payload of [
    '<textarea>hidden</textarea/><img src=x onerror=alert(1)><p>Visible</p>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">text</p>',
    '<svg><a><animate attributeName="href" values="https://example.com;javascript:alert(1)"></animate></a></svg>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
    '<a href="java&#x09;script:alert(1)">Unsafe</a>'
  ]) {
    const { document } = parseHTML(sanitizeMarkdownHTML(payload));
    assert.equal(document.querySelector('script,style,textarea,noscript,svg,math,img,iframe,object,[onerror],[onclick]'), null);
    assert.ok([...document.querySelectorAll('a[href]')].every(node => !/^(?:javascript|data):/i.test(node.getAttribute('href').replace(/[\s\x00-\x1f]/g, ''))));
  }
});
