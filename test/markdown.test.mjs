import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, spansToMarkdown, escapeInline } from '../src/lib/markdown.js';
import { samplePacket } from './fixtures/sample-packet.js';

test('renders cover front-matter, contents and per-thread sections', () => {
  const md = renderMarkdown(samplePacket());
  assert.match(md, /^# Positioning & Pricing — Discovery Packet/);
  assert.match(md, /\*\*Prepared for:\*\* Northwind Studio/);
  assert.match(md, /\*\*Tools used:\*\* ChatGPT, Claude/);
  assert.match(md, /## Contents/);
  assert.match(md, /## 1\. Retainer pricing strategy/);
  assert.match(md, /## 2\. Landing page copy pass/);
  assert.match(md, /Source: ChatGPT · model gpt-5-thinking/);
});

test('omits messages the studio excluded', () => {
  const md = renderMarkdown(samplePacket());
  assert.ok(!md.includes('EXCLUDED MESSAGE'));
});

test('contents links resolve to anchors that exist in the document', () => {
  const md = renderMarkdown(samplePacket());
  const links = [...md.matchAll(/\]\(#([\w-]+)\)/g)].map((m) => m[1]);
  assert.ok(links.length >= 2);
  for (const id of links) assert.ok(md.includes(`<a id="${id}"></a>`), `missing anchor ${id}`);
});

test('fences code and widens the fence when the snippet contains backticks', () => {
  const md = renderMarkdown(samplePacket({
    threads: [thread([{ type: 'code', language: 'md', code: 'a ``` b' }])],
  }));
  assert.match(md, /````md\na `` ` b|````md\na ``` b/);
  assert.ok(md.includes('````'));
});

test('renders pipe tables with escaped cell content', () => {
  const md = renderMarkdown(samplePacket({
    threads: [thread([{ type: 'table', head: [['A', 'B']], rows: [['x|y', 'z']] }])],
  }));
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| x\\\|y \| z \|/);
});

test('nests list items by depth and numbers only the top level', () => {
  const md = renderMarkdown(samplePacket({ threads: [thread([{
    type: 'list',
    ordered: true,
    items: [
      { spans: [{ text: 'one' }], depth: 0 },
      { spans: [{ text: 'deep' }], depth: 1 },
      { spans: [{ text: 'two' }], depth: 0 },
    ],
  }])] }));
  assert.match(md, /1\. one\n {2}- deep\n2\. two/);
});

test('quotes prefix every line', () => {
  const md = renderMarkdown(samplePacket({ threads: [thread([{
    type: 'quote', blocks: [{ type: 'paragraph', spans: [{ text: 'a' }] }, { type: 'paragraph', spans: [{ text: 'b' }] }],
  }])] }));
  assert.match(md, /> a\n>\n> b/);
});

test('inline spans combine bold, italic, code and links', () => {
  assert.equal(
    spansToMarkdown([
      { text: 'b', bold: true },
      { text: 'i', italic: true },
      { text: 'c', code: true },
      { text: 'l', href: 'https://x.test' },
    ]),
    '**b***i*`c`[l](https://x.test)',
  );
});

test('code spans are not markdown-escaped', () => {
  assert.equal(spansToMarkdown([{ text: 'a_b*c', code: true }]), '`a_b*c`');
  assert.equal(escapeInline('a_b*c'), 'a\\_b\\*c');
});

test('headings inside a message stay below the message heading level', () => {
  const md = renderMarkdown(samplePacket({ threads: [thread([
    { type: 'heading', level: 1, spans: [{ text: 'H' }] },
    { type: 'heading', level: 4, spans: [{ text: 'deep' }] },
  ])] }));
  assert.match(md, /#### H/);
  assert.match(md, /###### deep/); // clamped at h6
});

function thread(blocks) {
  return {
    id: 't', vendor: 'chatgpt', vendorLabel: 'ChatGPT', model: null,
    title: 'T', url: '', capturedAt: '2026-09-29T00:00:00.000Z',
    messages: [{ id: 'm', role: 'assistant', include: true, blocks }],
  };
}
