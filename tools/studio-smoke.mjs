/**
 * Dev-only: loads the Studio in Chromium with a stubbed `chrome` API and real
 * threads captured from the test fixtures, then writes screenshots. This is the
 * fastest way to see the merge UI without packaging and installing the
 * extension.
 *
 *   node tools/studio-smoke.mjs [outDir]
 *
 * Requires `npm i` (playwright is a devDependency). If Chromium lives somewhere
 * unusual, point CHROMIUM_PATH at it.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { makePage, CHATGPT_HTML, CLAUDE_HTML } from '../test/fixtures/dom.js';
import { adapterFor } from '../src/content/adapters/index.js';

const OUT = process.argv[2] || 'screenshots';
mkdirSync(OUT, { recursive: true });

/* Serve src/ — Chrome refuses ES module imports over file://. */
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json',
};
const server = createServer(async (req, res) => {
  try {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/])+/, '');
    const body = await readFile(join(process.cwd(), 'src', rel));
    res.writeHead(200, { 'content-type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((resolve) => server.listen(0, resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const capture = (html, url) => {
  const loc = new URL(url);
  return adapterFor(loc).collect(makePage(html, url).document, loc);
};

const seed = {
  threads: [
    capture(CHATGPT_HTML, 'https://chatgpt.com/c/abc'),
    capture(CLAUDE_HTML, 'https://claude.ai/chat/def'),
  ],
  meta: {
    title: 'Cross-tool working session',
    clientName: 'Northwind Studio',
    preparedBy: 'Jane Doe, Doe Consulting',
    dateLabel: 'September 29, 2026',
    summary: 'Merged from a ChatGPT pricing thread and a Claude copy thread.',
    footer: '', watermark: '', toolsUsed: ['ChatGPT', 'Claude'],
    includeCover: true, includeToc: true,
    userLabel: 'Prompt', assistantLabel: 'Response',
    logoDataUrl: null, logoAspect: 3,
  },
  entitlements: {
    plan: 'free', planLabel: 'Free', maxThreads: 1,
    canBrand: false, canRemoveWatermark: false, expiresAt: null,
  },
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

await page.addInitScript((state) => {
  const s = JSON.parse(JSON.stringify(state));
  window.chrome = {
    runtime: {
      getURL: (path) => new URL(`/${path}`, location.origin).href,
      sendMessage: (msg, cb) => {
        if (msg.type === 'pp:setMeta') Object.assign(s.meta, msg.meta);
        if (msg.type === 'pp:setThreads') s.threads = msg.threads;
        cb({ ok: true, threads: s.threads, meta: s.meta, license: null, entitlements: s.entitlements });
      },
    },
    storage: { onChanged: { addListener() {} }, local: { get: async () => ({}), set: async () => {} } },
  };
}, seed);

await page.goto(`${origin}/studio/studio.html`);
await page.waitForSelector('.thread-card');
await page.screenshot({ path: join(OUT, 'studio.png') });

await page.locator('.thread-card button:has-text("Choose")').first().click();
await page.waitForSelector('.messages');
await page.screenshot({ path: join(OUT, 'studio-messages.png') });

console.log('threads:  ', await page.locator('#threadCount').textContent());
console.log('preview:  ', await page.locator('#previewMeta').textContent());
console.log('gate:     ', (await page.locator('#banner').textContent()).trim());
console.log(`screenshots in ${OUT}/`);

await browser.close();
server.close();
