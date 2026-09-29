/**
 * The path the product actually sells: two vendor pages -> captured threads ->
 * one merged packet -> PDF and Markdown.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { makePage, CHATGPT_HTML, CLAUDE_HTML } from './fixtures/dom.js';
import { adapterFor } from '../src/content/adapters/index.js';
import { renderMarkdown } from '../src/lib/markdown.js';
import { buildPdf } from '../src/lib/pdf-jspdf.js';
import { layoutPacket } from '../src/lib/pdf.js';
import { createFixedMeasurer } from '../src/lib/measure.js';
import { entitlements, gatePacket, signLicense, verifyLicenseKey } from '../src/lib/license.js';
import { generateKeypair } from '../server/src/keys.js';

function capture(html, url) {
  const { document, location } = makePage(html, url);
  return adapterFor(location).collect(document, location);
}

function mergedPacket() {
  const threads = [
    capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc'),
    capture(CLAUDE_HTML, 'https://claude.ai/chat/def'),
  ];
  return {
    meta: {
      title: 'Cross-tool working session',
      clientName: 'Northwind Studio',
      preparedBy: 'Jane Doe',
      dateLabel: 'September 29, 2026',
      toolsUsed: [...new Set(threads.map((t) => t.vendorLabel))],
      includeCover: true,
      includeToc: true,
    },
    threads,
  };
}

test('two vendors merge into one packet whose cover names both tools', () => {
  const packet = mergedPacket();
  assert.deepEqual(packet.meta.toolsUsed, ['ChatGPT', 'Claude']);

  const md = renderMarkdown(packet);
  assert.match(md, /\*\*Tools used:\*\* ChatGPT, Claude/);
  assert.match(md, /Source: ChatGPT · model gpt-5-thinking/);
  assert.match(md, /Source: Claude · model Claude Opus 5/);
  // Content from both vendors survives the round trip.
  assert.match(md, /Anchor on outcomes/);
  assert.match(md, /Outcome-first/);
  assert.match(md, /```python\ndef price\(v\):/);
});

test('the merged packet renders to a multi-page PDF', async () => {
  const { jsPDF } = await import('jspdf');
  const { doc, layout } = buildPdf(mergedPacket(), { jsPDF });
  assert.ok(layout.pages.length >= 3);
  assert.equal(doc.getNumberOfPages(), layout.pages.length);
  assert.equal(Buffer.from(doc.output('arraybuffer')).subarray(0, 5).toString(), '%PDF-');
});

test('deselecting a message removes it from both exports', () => {
  const packet = mergedPacket();
  packet.threads[0].messages[0].include = false; // drop the human prompt

  const md = renderMarkdown(packet);
  assert.ok(!md.includes('How should I price'));

  const text = layoutPacket(packet, createFixedMeasurer()).pages
    .flat().filter((o) => o.op === 'text').map((o) => o.text).join(' ')
    .replace(/\s+/g, ' ');
  assert.ok(!text.includes('How should I price'));
});

test('free tier exports one thread with a watermark; a paid key exports both without', async () => {
  const keys = await generateKeypair();
  const packet = mergedPacket();

  const free = gatePacket(packet, entitlements(null));
  assert.equal(free.packet.threads.length, 1);
  assert.equal(free.trimmed, 1);
  assert.ok(renderMarkdown(free.packet).includes('ChatGPT'));

  const key = await signLicense({ id: 'lic_e2e', plan: 'pack' }, keys.privateJwk, { crypto: webcrypto });
  const license = await verifyLicenseKey(key, keys.publicJwk, { crypto: webcrypto });
  const paid = gatePacket(packet, entitlements(license));
  assert.equal(paid.trimmed, 0);
  assert.equal(paid.packet.threads.length, 2);
  assert.equal(paid.packet.meta.watermark, undefined);
});
