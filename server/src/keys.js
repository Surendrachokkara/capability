/**
 * Key material helpers. The private key never leaves the server; the public
 * JWK is copied into the extension's config.js so it can verify offline.
 */
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function generateKeypair() {
  const kp = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  );
  return {
    publicJwk: await webcrypto.subtle.exportKey('jwk', kp.publicKey),
    privateJwk: await webcrypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

/**
 * Loads the signing key from LICENSE_PRIVATE_JWK (inline JSON, preferred for
 * hosted envs) or LICENSE_PRIVATE_JWK_FILE.
 */
export function loadPrivateJwk(env = process.env) {
  if (env.LICENSE_PRIVATE_JWK) return JSON.parse(env.LICENSE_PRIVATE_JWK);
  if (env.LICENSE_PRIVATE_JWK_FILE) {
    return JSON.parse(readFileSync(env.LICENSE_PRIVATE_JWK_FILE, 'utf8'));
  }
  throw new Error('Set LICENSE_PRIVATE_JWK or LICENSE_PRIVATE_JWK_FILE (see npm run keygen)');
}

export { webcrypto };
