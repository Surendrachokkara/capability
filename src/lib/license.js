/**
 * Offline-verifiable licence keys.
 *
 * A key is `PP1-<payload>.<signature>`, both base64url. The payload is a small
 * JSON claim set; the signature is ECDSA P-256 / SHA-256 made by the licence
 * server's private key. The extension ships only the public key, so it can
 * verify a key with no network round-trip — the export path keeps working on a
 * plane, and a stolen client build cannot mint keys.
 *
 * Revocation (refunds, chargebacks, cancelled subscriptions) is the one thing
 * offline verification cannot do, so `checkRevocation` re-validates against the
 * server opportunistically and fails open when it cannot reach it.
 */

export const KEY_PREFIX = 'PP1';

export const PLANS = {
  free: { id: 'free', label: 'Free', maxThreads: 1, branding: false, removeWatermark: false },
  monthly: { id: 'monthly', label: 'Pro monthly', maxThreads: Infinity, branding: true, removeWatermark: true },
  pack: { id: 'pack', label: 'One-pack', maxThreads: Infinity, branding: true, removeWatermark: true },
};

export const FREE_WATERMARK = 'Made with PacketPress';

/* ------------------------------------------------------------- base64url */

export function b64urlEncode(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  const b64 = typeof btoa === 'function'
    ? btoa(bin)
    : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(text) {
  const b64 = String(text).replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (text.length % 4)) % 4);
  const bin = typeof atob === 'function'
    ? atob(b64)
    : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

/* --------------------------------------------------------------- verify */

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' };

export function formatKey(payloadBytes, signatureBytes) {
  return `${KEY_PREFIX}-${b64urlEncode(payloadBytes)}.${b64urlEncode(signatureBytes)}`;
}

export function parseKey(key) {
  const trimmed = String(key || '').trim().replace(/\s+/g, '');
  if (!trimmed.startsWith(`${KEY_PREFIX}-`)) return null;
  const rest = trimmed.slice(KEY_PREFIX.length + 1);
  const dot = rest.indexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { payloadB64: rest.slice(0, dot), signatureB64: rest.slice(dot + 1) };
}

/**
 * @returns {Promise<{valid: boolean, reason?: string, claims?: object}>}
 */
export async function verifyLicenseKey(key, publicJwk, { crypto = globalThis.crypto, now = Date.now() } = {}) {
  const parts = parseKey(key);
  if (!parts) return { valid: false, reason: 'malformed' };

  let claims;
  let payloadBytes;
  try {
    payloadBytes = b64urlDecode(parts.payloadB64);
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { valid: false, reason: 'malformed' };
  }

  let ok = false;
  try {
    const pub = await crypto.subtle.importKey('jwk', publicJwk, ALGO, false, ['verify']);
    ok = await crypto.subtle.verify(
      SIGN_PARAMS, pub, b64urlDecode(parts.signatureB64), payloadBytes,
    );
  } catch {
    return { valid: false, reason: 'unverifiable' };
  }
  if (!ok) return { valid: false, reason: 'bad-signature' };

  if (!PLANS[claims.plan]) return { valid: false, reason: 'unknown-plan' };
  // `exp` is absent for the one-time pack, which never expires.
  if (claims.exp && now > Date.parse(claims.exp)) {
    return { valid: false, reason: 'expired', claims };
  }
  return { valid: true, claims };
}

/** Signs a claim set. Server-side only — needs the private key. */
export async function signLicense(claims, privateJwk, { crypto = globalThis.crypto } = {}) {
  const payloadBytes = enc.encode(JSON.stringify(claims));
  const priv = await crypto.subtle.importKey('jwk', privateJwk, ALGO, false, ['sign']);
  const sig = await crypto.subtle.sign(SIGN_PARAMS, priv, payloadBytes);
  return formatKey(payloadBytes, new Uint8Array(sig));
}

/* ----------------------------------------------------------- entitlements */

/**
 * The single source of truth for what the current licence unlocks. The Studio
 * asks this rather than testing plan ids inline, so adding a plan is one edit.
 */
export function entitlements(license) {
  const plan = (license && license.valid && PLANS[license.claims.plan]) || PLANS.free;
  return {
    plan: plan.id,
    planLabel: plan.label,
    maxThreads: plan.maxThreads,
    canBrand: plan.branding,
    canRemoveWatermark: plan.removeWatermark,
    expiresAt: (license && license.claims && license.claims.exp) || null,
  };
}

/**
 * Applies the free-tier limits to a packet just before rendering, so no export
 * path can bypass them by constructing its own packet object.
 */
export function gatePacket(packet, ent) {
  // `Infinity` becomes `null` if entitlements ever round-trip through JSON;
  // treat anything non-finite as unlimited rather than trimming to nothing.
  const limit = Number.isFinite(ent.maxThreads) ? ent.maxThreads : Infinity;
  const threads = packet.threads.slice(0, limit);
  const meta = { ...packet.meta };
  if (!ent.canBrand) {
    delete meta.logoDataUrl;
    meta.footer = '';
  }
  if (!ent.canRemoveWatermark) meta.watermark = FREE_WATERMARK;
  const trimmed = packet.threads.length - threads.length;
  return { packet: { meta, threads }, trimmed };
}
