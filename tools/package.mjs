/**
 * Builds the two deployable artifacts:
 *
 *   dist/packetpress-extension-<version>.zip
 *     The extension, manifest at the zip root — the layout the Chrome Web Store
 *     expects, and what you get after unzipping for "Load unpacked".
 *
 *   dist/packetpress-server-<version>.zip
 *     The licence server, keeping the repo-relative layout its imports expect
 *     (server/ plus the shared src/lib/license.js).
 *
 *   node tools/package.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const manifest = JSON.parse(readFileSync(join(root, 'src/manifest.json'), 'utf8'));
const version = manifest.version;

const dist = join(root, 'dist');
const stage = join(dist, '.stage');
rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const zip = (cwd, outFile, entries) => {
  rmSync(outFile, { force: true });
  execFileSync('zip', ['-r', '-q', '-X', outFile, ...entries, '-x', '*.DS_Store'], { cwd });
  return outFile;
};

/* ------------------------------------------------------------- extension */

const extDir = join(stage, 'extension');
cpSync(join(root, 'src'), extDir, { recursive: true });
const extZip = join(dist, `packetpress-extension-${version}.zip`);
zip(extDir, extZip, ['.']);

/* ---------------------------------------------------------------- server */

const srvDir = join(stage, 'server-bundle');
mkdirSync(join(srvDir, 'src/lib'), { recursive: true });
cpSync(join(root, 'server'), join(srvDir, 'server'), {
  recursive: true,
  filter: (src) => !/node_modules|[/\\]data([/\\]|$)|\.env$|\.env\.local$/.test(src),
});
// The server imports the shared licence module by relative path; ship it.
cpSync(join(root, 'src/lib/license.js'), join(srvDir, 'src/lib/license.js'));
writeFileSync(join(srvDir, 'DEPLOY.md'), SERVER_README(version));
const srvZip = join(dist, `packetpress-server-${version}.zip`);
zip(srvDir, srvZip, ['.']);

/* ----------------------------------------------------------------- notes */

writeFileSync(join(dist, 'DEPLOY.md'), DEPLOY(version));
rmSync(stage, { recursive: true, force: true });

for (const file of [extZip, srvZip]) {
  const bytes = readFileSync(file).length;
  console.log(`${file.replace(`${root}/`, '')}  ${(bytes / 1024).toFixed(0)} KB`);
}
if (!existsSync(join(dist, 'DEPLOY.md'))) throw new Error('notes missing');
console.log('dist/DEPLOY.md');

function DEPLOY(v) {
  return `# Deploying PacketPress ${v}

Two artifacts, in the order you need them.

## 1. Licence server (do this first — the extension needs its public key)

Unzip \`packetpress-server-${v}.zip\`, then:

\`\`\`bash
cd server
npm install
npm run keygen          # prints the signing keypair — run once, keep the output
\`\`\`

Copy \`.env.example\` to \`.env\` and fill in:

| Variable | Where it comes from |
|---|---|
| \`STRIPE_SECRET_KEY\` | Stripe dashboard → Developers → API keys |
| \`STRIPE_WEBHOOK_SECRET\` | Stripe → Webhooks → your endpoint → signing secret |
| \`STRIPE_PRICE_MONTHLY\` | a recurring $12/month price you create |
| \`STRIPE_PRICE_PACK\` | a one-time $29 price you create |
| \`LICENSE_PRIVATE_JWK\` | the private JWK printed by \`npm run keygen\` |
| \`PUBLIC_BASE_URL\` | the public URL the server runs on |

Point a Stripe webhook at \`<PUBLIC_BASE_URL>/api/stripe/webhook\` for the events
\`checkout.session.completed\`, \`customer.subscription.deleted\` and
\`charge.refunded\`. Then \`npm start\` (or run it under your process manager).

Licence records are written to \`server/data/licenses.json\` — put that on a
persistent disk, and back it up: it is your record of who bought what.

Check it is up: \`curl <PUBLIC_BASE_URL>/healthz\`

## 2. Extension

Unzip \`packetpress-extension-${v}.zip\` and edit **\`config.js\`** — the only file
you must change:

\`\`\`js
export const CHECKOUT_BASE = 'https://your-server.example.com';
export const LICENSE_PUBLIC_JWK = { /* public JWK from npm run keygen */ };
\`\`\`

Leaving \`LICENSE_PUBLIC_JWK\` as \`null\` is safe but keeps every install on the
free tier — keys cannot be verified, so the build fails closed.

**Load it locally:** chrome://extensions → Developer mode → Load unpacked →
select the unzipped folder.

**Publish it:** re-zip the folder *after* editing \`config.js\` (the manifest must
stay at the zip root) and upload at
<https://chrome.google.com/webstore/devconsole>. You will need a one-time $5
developer registration, a privacy policy URL, and a justification for each
permission:

- \`storage\` — keeps captured threads and packet settings on the user's machine
- \`activeTab\` / \`scripting\` — reads the conversation the user asks to capture
- \`tabs\` — reopens the Studio tab instead of piling up duplicates
- host permissions for chatgpt.com and claude.ai — the two sites it captures from

Nothing is sent anywhere: capture, merge and PDF rendering all happen locally,
and the only outbound request is Stripe checkout when the user chooses to buy.

## Smoke test before launch

1. Capture a real thread on chatgpt.com, another on claude.ai.
2. Open the Studio: both appear, free tier trims to one with a watermark.
3. Buy through the Stripe test card \`4242 4242 4242 4242\`.
4. The success page shows a key — paste it into Studio → Licence → Activate.
5. Both threads now export; the watermark is gone and the logo appears.
`;
}

function SERVER_README(v) {
  return `# PacketPress licence server ${v}

\`\`\`bash
cd server && npm install && npm run keygen
cp .env.example .env    # fill it in — see dist/DEPLOY.md
npm start
\`\`\`

Runs on \`PORT\` (default 8787). Health check: \`GET /healthz\`.

Layout note: \`server/src/index.js\` imports the shared licence module from
\`../../src/lib/license.js\`, which is why this bundle keeps both directories.
Keep them side by side.
`;
}
