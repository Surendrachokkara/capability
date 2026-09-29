import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { htmlToBlocks, isChrome, textOf } from '../src/lib/extract.js';
import { blocksToText } from '../src/lib/model.js';

const parse = (html) => parseHTML(`<!doctype html><body><div id="root">${html}</div>`)
  .document.getElementById('root');

test('keeps paragraphs and inline formatting', () => {
  const blocks = htmlToBlocks(parse('<p>Hello <strong>bold</strong> and <em>italic</em>.</p>'));
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'paragraph');
  assert.deepEqual(blocks[0].spans.map((s) => s.text), ['Hello ', 'bold', ' and ', 'italic', '.']);
  assert.equal(blocks[0].spans[1].bold, true);
  assert.equal(blocks[0].spans[3].italic, true);
});

test('merges adjacent spans that share formatting', () => {
  const blocks = htmlToBlocks(parse('<p><span>one </span><span>two </span><span>three</span></p>'));
  assert.equal(blocks[0].spans.length, 1);
  assert.equal(blocks[0].spans[0].text, 'one two three');
});

test('drops chat chrome: buttons, svg, aria-hidden and sr-only nodes', () => {
  const html = `
    <div class="sr-only">You said:</div>
    <div aria-hidden="true">avatar</div>
    <button aria-label="Copy">Copy</button>
    <svg><path d="M0 0"/></svg>
    <div class="message-actions"><span>Regenerate</span></div>
    <p>Real content.</p>`;
  const blocks = htmlToBlocks(parse(html));
  assert.equal(blocks.length, 1);
  assert.equal(blocksToText(blocks), 'Real content.');
});

test('isChrome does not swallow ordinary containers', () => {
  const root = parse('<div class="prose"><p>x</p></div>');
  assert.equal(isChrome(root.firstChild), false);
});

test('captures code blocks with their language and strips the copy button', () => {
  const html = `<pre><div class="sticky"><button>Copy</button></div>`
    + `<code class="language-python">def f():\n    return 1</code></pre>`;
  const [block] = htmlToBlocks(parse(html));
  assert.equal(block.type, 'code');
  assert.equal(block.language, 'python');
  assert.equal(block.code, 'def f():\n    return 1');
});

test('reads data-language when no class is present', () => {
  const [block] = htmlToBlocks(parse('<pre data-language="SQL"><code>select 1</code></pre>'));
  assert.equal(block.language, 'sql');
});

test('flattens nested lists into depth-tagged items', () => {
  const html = '<ol><li>one<ul><li>one a</li></ul></li><li>two</li></ol>';
  const [list] = htmlToBlocks(parse(html));
  assert.equal(list.type, 'list');
  assert.equal(list.ordered, true);
  assert.deepEqual(
    list.items.map((i) => [i.spans.map((s) => s.text).join(''), i.depth]),
    [['one', 0], ['one a', 1], ['two', 0]],
  );
});

test('reads tables with and without a header row', () => {
  const withHead = htmlToBlocks(parse(
    '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
  ))[0];
  assert.deepEqual(withHead.head, [['A', 'B']]);
  assert.deepEqual(withHead.rows, [['1', '2']]);

  const noHead = htmlToBlocks(parse('<table><tr><td>1</td><td>2</td></tr></table>'))[0];
  assert.deepEqual(noHead.head, []);
  assert.deepEqual(noHead.rows, [['1', '2']]);
});

test('keeps blockquotes as nested blocks', () => {
  const [quote] = htmlToBlocks(parse('<blockquote><p>quoted</p><p>again</p></blockquote>'));
  assert.equal(quote.type, 'quote');
  assert.equal(quote.blocks.length, 2);
});

test('treats links as spans carrying href', () => {
  const [p] = htmlToBlocks(parse('<p>See <a href="https://x.test/a">this</a>.</p>'));
  assert.equal(p.spans[1].href, 'https://x.test/a');
});

test('unwraps div soup without inventing empty paragraphs', () => {
  const [p, ...rest] = htmlToBlocks(parse('<div><div><div><span>deep</span></div></div></div>'));
  assert.equal(p.type, 'paragraph');
  assert.equal(p.spans[0].text, 'deep');
  assert.equal(rest.length, 0);
});

test('renders <br> as a newline inside one paragraph', () => {
  const [p] = htmlToBlocks(parse('<p>line one<br>line two</p>'));
  assert.equal(p.spans.map((s) => s.text).join(''), 'line one\nline two');
});

test('textOf ignores chrome subtrees', () => {
  assert.equal(textOf(parse('<p>keep<button>drop</button></p>')), 'keep');
});

test('inline children of a container stay in one paragraph', () => {
  // The ChatGPT user turn puts bare text and <strong> side by side inside one
  // wrapper; splitting them would stack every phrase on its own line.
  const blocks = htmlToBlocks(parse(
    '<div class="whitespace-pre-wrap">How should I price <strong>value-based</strong> retainers?</div>',
  ));
  assert.equal(blocks.length, 1);
  assert.equal(
    blocks[0].spans.map((s) => s.text).join(''),
    'How should I price value-based retainers?',
  );
});

test('inline runs around a block element split at the block, not per span', () => {
  const blocks = htmlToBlocks(parse(
    'lead <em>in</em><pre><code>x = 1</code></pre>tail <strong>out</strong>',
  ));
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'code', 'paragraph']);
  assert.equal(blocks[0].spans.map((s) => s.text).join(''), 'lead in');
  assert.equal(blocks[2].spans.map((s) => s.text).join(''), 'tail out');
});

test('an inline link between text keeps the sentence together', () => {
  const [p] = htmlToBlocks(parse('<div>See <a href="https://x.test">the guide</a> for more.</div>'));
  assert.equal(p.spans.map((s) => s.text).join(''), 'See the guide for more.');
  assert.equal(p.spans[1].href, 'https://x.test');
});
