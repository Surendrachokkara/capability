#!/usr/bin/env node
/**
 * One-time setup: prints a fresh signing keypair plus the snippet to paste into
 * src/lib/public-key.js.
 *
 *   npm run keygen
 */
import { generateKeypair } from './keys.js';

const { publicJwk, privateJwk } = await generateKeypair();

console.log('# 1. Keep this secret. Set it on the licence server:\n');
console.log(`LICENSE_PRIVATE_JWK='${JSON.stringify(privateJwk)}'\n`);
console.log('# 2. Paste this into the extension\'s config.js:\n');
console.log(`export const LICENSE_PUBLIC_JWK = ${JSON.stringify(publicJwk, null, 2)};\n`);
console.log('# 3. Also set CHECKOUT_BASE in config.js to this server\'s public URL.\n');
