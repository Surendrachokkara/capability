import test from 'node:test';
import assert from 'node:assert/strict';
import { renderPreviewHtml, blocksToHtml, esc } from '../src/lib/html-preview.js';
import { samplePacket } from './fixtures/sample-packet.js';

test('preview includes cover, contents and every selected thread', () => {
  const html = renderPreviewHtml(samplePacket());
  assert.match(html, /Northwind Studio/);
  assert.match(html, /class="toc"/);
  assert.match(html, /Retainer pricing strategy/);
  assert.match(html, /Landing page copy pass/);
  assert.ok(!html.includes('EXCLUDED MESSAGE'));
});

test('scraped content is escaped, so page markup cannot leak into the preview', () => {
  const html = blocksToHtml([
    { type: 'paragraph', spans: [{ text: '<img src=x onerror=alert(1)>' }] },
    { type: 'code', language: 'html', code: '</code><script>alert(1)</script>' },
  ]);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;img src=x/);
});

test('a hostile href is escaped into the attribute rather than closing it', () => {
  const html = blocksToHtml([{ type: 'paragraph', spans: [{ text: 'x', href: '" onmouseover="alert(1)' }] }]);
  assert.ok(!html.includes('onmouseover="alert(1)"'));
  assert.match(html, /&quot; onmouseover=&quot;/);
});

test('flattened list depth is rebuilt into real nesting', () => {
  const html = blocksToHtml([{
    type: 'list',
    ordered: false,
    items: [
      { spans: [{ text: 'a' }], depth: 0 },
      { spans: [{ text: 'a1' }], depth: 1 },
      { spans: [{ text: 'b' }], depth: 0 },
    ],
  }]);
  assert.match(html, /<li>a<ul><li>a1<\/li><\/ul><\/li><li>b<\/li>/);
});

test('watermark renders only when set', () => {
  assert.ok(!renderPreviewHtml(samplePacket()).includes('class="watermark"'));
  assert.match(renderPreviewHtml(samplePacket({ meta: { watermark: 'DRAFT' } })), /class="watermark"/);
});

test('esc covers every character that could break out of markup', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
