import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPacket, wrapCode, LETTER } from '../src/lib/pdf.js';
import { createFixedMeasurer } from '../src/lib/measure.js';
import { buildPdf } from '../src/lib/pdf-jspdf.js';
import { samplePacket } from './fixtures/sample-packet.js';

const m = createFixedMeasurer();
const textOps = (ops) => ops.filter((o) => o.op === 'text').map((o) => o.text);
// Text is emitted one styled token at a time, so joined output needs its
// whitespace normalised before matching against prose.
const pageText = (ops) => textOps(ops).join(' ').replace(/\s+/g, ' ').trim();
const allText = (layout) => layout.pages.map(pageText).join('\n');

test('emits a cover, a contents page and one page per thread at minimum', () => {
  const layout = layoutPacket(samplePacket(), m);
  assert.ok(layout.pages.length >= 4);
  assert.equal(layout.offset, 2); // cover + one contents page
  assert.deepEqual(layout.threadStarts.length, 2);
});

test('cover carries the client, title and fact rows', () => {
  const [cover] = layoutPacket(samplePacket(), m).pages;
  const text = pageText(cover);
  assert.match(text, /PREPARED FOR/);
  assert.match(text, /Northwind Studio/);
  assert.match(text, /Positioning/);
  assert.match(text, /TOOLS USED/);
  assert.match(text, /ChatGPT · Claude/);
  assert.match(text, /2 threads · 4 messages/); // the excluded message is not counted
});

test('contents page numbers point at the page the thread actually starts on', () => {
  const layout = layoutPacket(samplePacket(), m);
  const toc = layout.pages[1];
  const entries = textOps(toc);

  layout.threadStarts.forEach((bodyPage, i) => {
    const expected = String(bodyPage + layout.offset + 1);
    const at = entries.findIndex((t) => t.startsWith(`${i + 1}. `));
    assert.notEqual(at, -1, 'thread missing from contents');
    assert.equal(entries[at + 1], expected, `wrong page number for thread ${i + 1}`);

    // And that page really does open that thread.
    const page = layout.pages[bodyPage + layout.offset];
    assert.ok(textOps(page).some((t) => t.startsWith(`${i + 1}. `)), 'page does not open the thread');
  });
});

test('the cover is unnumbered and every later page has a footer number', () => {
  const layout = layoutPacket(samplePacket(), m);
  const total = layout.pages.length;
  assert.ok(!textOps(layout.pages[0]).some((t) => /^\d+ \/ \d+$/.test(t)));
  for (let i = 1; i < total; i += 1) {
    assert.ok(
      textOps(layout.pages[i]).includes(`${i + 1} / ${total}`),
      `page ${i + 1} is missing its footer`,
    );
  }
});

test('excluded messages never reach the page', () => {
  assert.ok(!allText(layoutPacket(samplePacket(), m)).includes('EXCLUDED MESSAGE'));
});

test('cover and contents can be turned off', () => {
  const layout = layoutPacket(samplePacket({ meta: { includeCover: false, includeToc: false } }), m);
  assert.equal(layout.offset, 0);
  assert.match(pageText(layout.pages[0]), /Retainer pricing strategy/);
});

test('a single-thread packet skips the contents page', () => {
  const one = samplePacket();
  one.threads = one.threads.slice(0, 1);
  assert.equal(layoutPacket(one, m).offset, 1); // cover only
});

test('long content paginates instead of overflowing the page box', () => {
  const big = samplePacket();
  big.threads[0].messages[1].blocks = Array.from({ length: 40 }, (_, i) => ({
    type: 'paragraph',
    spans: [{ text: `Paragraph ${i}. ${'word '.repeat(90)}` }],
  }));
  const layout = layoutPacket(big, m);
  assert.ok(layout.pages.length > 6, 'expected many pages');

  const maxY = LETTER.height;
  for (const page of layout.pages) {
    for (const op of page) {
      if (op.op === 'text') assert.ok(op.y <= maxY, `text drawn below the page at y=${op.y}`);
      if (op.op === 'rect') assert.ok(op.y + op.h <= maxY, 'box overflows the page');
    }
  }
});

test('a code block taller than a page is split across pages', () => {
  const packet = samplePacket();
  packet.threads = [{
    ...packet.threads[0],
    messages: [{
      id: 'c', role: 'assistant', include: true,
      blocks: [{ type: 'code', language: 'js', code: Array.from({ length: 150 }, (_, i) => `line(${i});`).join('\n') }],
    }],
  }];
  const layout = layoutPacket(packet, m);
  const codePages = layout.pages.filter((p) => p.some((o) => o.op === 'text' && /^line\(/.test(o.text)));
  assert.ok(codePages.length >= 2, 'code block did not paginate');
});

test('the watermark is drawn beneath the content on every page', () => {
  const layout = layoutPacket(samplePacket({ meta: { watermark: 'DRAFT' } }), m);
  for (const page of layout.pages) {
    assert.equal(page[0].text, 'DRAFT', 'watermark must be the first op so content sits above it');
  }
});

test('wrapCode breaks over-long lines at whitespace and keeps short ones intact', () => {
  assert.deepEqual(wrapCode('short', 20), ['short']);
  const wrapped = wrapCode(`  ${'a'.repeat(10)} ${'b'.repeat(10)} ${'c'.repeat(10)}`, 20);
  assert.ok(wrapped.length >= 2);
  for (const line of wrapped) assert.ok(line.length <= 20, `line too long: ${line}`);
  assert.equal(wrapped.join('').replace(/\s/g, ''), `${'a'.repeat(10)}${'b'.repeat(10)}${'c'.repeat(10)}`);
});

test('tabs are expanded so code alignment survives the mono font', () => {
  assert.deepEqual(wrapCode('\tif x:', 40), ['  if x:']);
});

test('produces a real PDF through jsPDF', async () => {
  const { jsPDF } = await import('jspdf');
  const { doc, layout } = buildPdf(samplePacket(), { jsPDF });
  const bytes = Buffer.from(doc.output('arraybuffer'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 3000, 'suspiciously small PDF');
  assert.equal(doc.getNumberOfPages(), layout.pages.length);
});
