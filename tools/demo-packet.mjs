/**
 * Dev-only: builds a complete branded demo packet through the real pipeline —
 * DOM capture -> merge -> licence gate -> PDF + Markdown. Useful for the launch
 * demo and as a visual regression check on the whole chain.
 *
 *   node tools/demo-packet.mjs [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { chromium } from 'playwright';
import { jsPDF } from 'jspdf';

import { makePage, CHATGPT_HTML, CLAUDE_HTML } from '../test/fixtures/dom.js';
import { adapterFor } from '../src/content/adapters/index.js';
import { buildPdf } from '../src/lib/pdf-jspdf.js';
import { renderMarkdown } from '../src/lib/markdown.js';
import { entitlements, gatePacket, signLicense, verifyLicenseKey } from '../src/lib/license.js';
import { generateKeypair } from '../server/src/keys.js';
import { svgContactSheet } from './ops-to-svg.mjs';

const OUT = process.argv[2] || 'demo';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});

/* A stand-in client logo, so the branded cover shows a real image. */
async function makeLogo() {
  const page = await browser.newPage({ viewport: { width: 640, height: 200 }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;display:flex;align-items:center;gap:18px;
    height:200px;padding:0 24px;font:600 52px/1 -apple-system,system-ui,sans-serif;letter-spacing:-.02em;color:#16181d">
    <svg width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#0b7a5b"/>
      <path d="M18 46V18l28 28V18" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="square"/></svg>
    <span>Northwind</span></body>`);
  const buf = await page.locator('body').screenshot({ omitBackground: false });
  await page.close();
  writeFileSync(join(OUT, 'logo.png'), buf);
  return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, aspect: 640 / 200 };
}

const capture = (html, url) => {
  const loc = new URL(url);
  return adapterFor(loc).collect(makePage(html, url).document, loc);
};

const logo = await makeLogo();

const raw = {
  meta: {
    title: 'Retainer Pricing & Positioning — Working Session',
    clientName: 'Northwind Studio',
    preparedBy: 'Jane Doe, Doe Consulting',
    dateLabel: 'September 29, 2026',
    summary: 'Two working sessions, merged: how to price the retainer, and how the '
      + 'pricing page should read once the tiers are set. Prompts are included so you '
      + 'can see how each recommendation was reached.',
    footer: 'Confidential — prepared for Northwind Studio',
    toolsUsed: ['ChatGPT', 'Claude'],
    includeCover: true,
    includeToc: true,
    userLabel: 'Prompt',
    assistantLabel: 'Response',
    watermark: '',
    logoDataUrl: logo.dataUrl,
    logoAspect: logo.aspect,
    logoHeight: 40,
  },
  threads: [
    capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc'),
    capture(CLAUDE_HTML, 'https://claude.ai/chat/def'),
  ],
};

/* Gate it exactly as the Studio does, with a real signed licence. */
const keys = await generateKeypair();
const key = await signLicense({ id: 'lic_demo', plan: 'pack' }, keys.privateJwk, { crypto: webcrypto });
const license = await verifyLicenseKey(key, keys.publicJwk, { crypto: webcrypto });
const { packet } = gatePacket(raw, entitlements(license));

const { doc, layout } = buildPdf(packet, { jsPDF });
writeFileSync(join(OUT, 'packet.pdf'), Buffer.from(doc.output('arraybuffer')));
writeFileSync(join(OUT, 'packet.md'), renderMarkdown(packet));

/* Page images, so the layout can be viewed without a PDF reader. */
// Reuse the layout jsPDF measured, so the images match the PDF exactly rather
// than approximating its text metrics.
const sheet = join(OUT, 'packet-pages.html');
writeFileSync(sheet, svgContactSheet(layout, packet.meta.title));
const page = await browser.newPage({ viewport: { width: 700, height: 920 }, deviceScaleFactor: 2 });
await page.goto(`file://${process.cwd()}/${sheet}`);
const figures = await page.$$('figure svg');
for (let i = 0; i < figures.length; i += 1) {
  await figures[i].screenshot({ path: join(OUT, `page-${i + 1}.png`) });
}
await browser.close();

console.log(`packet.pdf   ${layout.pages.length} pages`);
console.log(`packet.md    ${renderMarkdown(packet).split('\n').length} lines`);
console.log(`page images  ${figures.length}`);
console.log(`written to   ${OUT}/`);
