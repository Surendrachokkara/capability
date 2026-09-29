/**
 * Dev-only: installs the built extension into a real Chromium and exercises the
 * paths that only exist in a browser — MV3 service-worker registration, the
 * content script's dynamic import chain, and the extension pages.
 *
 * Unit tests import modules straight from disk, so they cannot catch a module
 * that the manifest never made web-accessible. This can.
 *
 *   npm run package && node tools/browser-smoke.mjs [outDir]
 *
 * Needs a display; on a headless box run it under xvfb:
 *   xvfb-run -a node tools/browser-smoke.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const OUT = process.argv[2] || 'screenshots';
mkdirSync(OUT, { recursive: true });

/* Unpack the built zip, so this tests the artifact people install. */
const zip = readdirSync('dist').find((f) => /^packetpress-extension-.*\.zip$/.test(f));
if (!zip) throw new Error('no extension zip in dist/ — run `npm run package` first');
const work = join(tmpdir(), `pp-smoke-${Date.now()}`);
const ext = join(work, 'ext');
mkdirSync(ext, { recursive: true });
execFileSync('unzip', ['-q', join('dist', zip), '-d', ext]);

const ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-sandbox'],
});

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exitCode = 1; };

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const id = new URL(sw.url()).host;
console.log(`service worker  registered (${id})`);

/* Messages must originate from an extension page: chrome.runtime.sendMessage
   does not deliver back into the sender's own context. */
const bg = await ctx.newPage();
await bg.goto(`chrome-extension://${id}/popup/popup.html`);
const ask = (msg) => bg.evaluate((m) => new Promise((r) => chrome.runtime.sendMessage(m, r)), msg);

const state = await ask({ type: 'pp:state' });
if (!state || !state.ok) fail('background did not answer pp:state');
console.log(`background      pp:state ok, plan "${state.entitlements.planLabel}"`);

/* A stand-in ChatGPT conversation, served to the real content script. */
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));
await page.route('https://chatgpt.com/**', (route) => route.fulfill({
  contentType: 'text/html; charset=utf-8',
  body: `<!doctype html><html><head><title>Retainer pricing — ChatGPT</title></head><body>
    <article data-testid="conversation-turn-2">
      <div class="sr-only">You said:</div>
      <div data-message-author-role="user" data-message-id="u1">
        <div class="whitespace-pre-wrap">How should I price <strong>value-based</strong> retainers?</div>
      </div>
      <button aria-label="Copy">Copy</button>
    </article>
    <article data-testid="conversation-turn-3">
      <div data-message-author-role="assistant" data-message-id="a1" data-message-model-slug="gpt-5-thinking">
        <div class="markdown prose"><h2>Anchor on outcomes</h2><p>Price the result.</p>
        <pre><code class="language-python">def price(v):
    return v * 0.12</code></pre></div>
      </div>
    </article></body></html>`,
}));
await page.goto('https://chatgpt.com/c/abc123');
await page.bringToFront();

const capture = await ask({ type: 'pp:capture' });
if (!capture.ok) fail(`capture failed: ${capture.error}`);
else {
  const t = capture.thread;
  console.log(`capture         "${t.title}" · ${t.model} · ${t.messages.map((m) => m.role).join(', ')}`);
  console.log(`                blocks: ${t.messages[1].blocks.map((b) => b.type).join(', ')}`);
  if (t.title.includes('ChatGPT')) fail('vendor suffix left in the thread title');
}
if (pageErrors.length) fail(`page errors: ${pageErrors.join('; ')}`);

const studio = await ctx.newPage();
await studio.setViewportSize({ width: 1440, height: 900 });
await studio.goto(`chrome-extension://${id}/studio/studio.html`);
await studio.waitForSelector('.thread-card', { timeout: 10000 });
await studio.screenshot({ path: join(OUT, 'installed-studio.png') });
console.log(`studio          ${(await studio.locator('#threadCount').textContent()).trim()}`);

await bg.reload();
await bg.setViewportSize({ width: 360, height: 460 });
await bg.screenshot({ path: join(OUT, 'installed-popup.png') });
console.log(`popup           library ${(await bg.locator('#count').textContent()).trim()}`);

await ctx.close();
console.log(process.exitCode ? 'smoke FAILED' : `smoke passed · screenshots in ${OUT}/`);
