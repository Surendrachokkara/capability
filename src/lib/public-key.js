/**
 * Public half of the licence signing keypair.
 *
 * Run `npm run keygen` and paste the printed JWK here before shipping a build.
 * Left null, every install stays on the free tier (keys cannot be verified), so
 * a misconfigured build fails closed rather than giving the product away.
 *
 * For local development you can skip editing this file: the Studio reads an
 * override from chrome.storage (`pp.publicJwk`), which the licence screen sets
 * when you paste a dev public key.
 */
export const LICENSE_PUBLIC_JWK = null;
