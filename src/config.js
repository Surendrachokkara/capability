/**
 * Deployment configuration — the only file you must edit before shipping a
 * build. Everything else in the extension reads from here.
 */

/**
 * Where the licence server runs. Used for Stripe checkout links.
 * Leave the localhost default while developing.
 */
export const CHECKOUT_BASE = 'http://localhost:8787';

/**
 * Public half of the licence signing keypair, printed by `npm run keygen` in
 * the server directory.
 *
 * Left null, keys cannot be verified and every install stays on the free tier,
 * so a misconfigured build fails closed rather than giving the product away.
 *
 * For local development you can leave this null: the Studio's Licence dialog
 * has a developer field that accepts a public JWK directly and stores it in
 * chrome.storage.
 *
 * @type {JsonWebKey | null}
 */
export const LICENSE_PUBLIC_JWK = null;
