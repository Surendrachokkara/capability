/**
 * Background worker: owns the thread library, the packet settings and the
 * licence, and brokers capture requests to the active tab.
 *
 * The popup and studio never touch chrome.storage directly for writes — routing
 * them through here keeps one place responsible for validation and for opening
 * the studio tab.
 */
import * as store from '../lib/storage.js';
import { verifyLicenseKey, entitlements } from '../lib/license.js';
import { LICENSE_PUBLIC_JWK } from '../config.js';

const STUDIO_URL = 'studio/studio.html';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handle(msg)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true;
});

async function handle(msg) {
  switch (msg && msg.type) {
    case 'pp:state': return getState();
    case 'pp:capture': return captureActiveTab();
    case 'pp:removeThread': return { threads: await store.removeThread(msg.id) };
    case 'pp:setThreads': return { threads: await store.setThreads(msg.threads) };
    case 'pp:setMeta': return { meta: await store.setMeta(msg.meta) };
    case 'pp:openStudio': return openStudio();
    case 'pp:activateLicense': return activateLicense(msg.key, msg.publicJwk);
    case 'pp:clearLicense': {
      await store.setLicense(null);
      return getState();
    }
    default:
      throw new Error(`unknown message: ${msg && msg.type}`);
  }
}

async function getState() {
  const state = await store.getAll();
  const license = await currentLicense(state);
  return { ...state, license, entitlements: entitlements(license) };
}

/**
 * Re-verifies the stored key on every read. A key that expired since it was
 * saved (a lapsed subscription) drops the install back to the free tier without
 * needing the server.
 */
async function currentLicense(state) {
  if (!state.license || !state.license.key) return null;
  const jwk = state.publicJwk || LICENSE_PUBLIC_JWK;
  if (!jwk) return null;
  const result = await verifyLicenseKey(state.license.key, jwk);
  return { ...result, key: state.license.key };
}

async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error('No active tab.');

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: 'pp:collect' });
  } catch {
    // The content script is missing when the tab was open before the extension
    // was installed or reloaded; inject it and retry once.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/boot.js'] });
    response = await chrome.tabs.sendMessage(tab.id, { type: 'pp:collect' });
  }

  if (!response || !response.ok) {
    throw new Error((response && response.error) || 'Capture failed.');
  }
  const { threads, replaced } = await store.upsertThread(response.thread);
  await rememberToolsUsed(threads);
  return { threads, thread: response.thread, replaced };
}

/** Keeps the cover's "tools used" line in sync with what was actually captured. */
async function rememberToolsUsed(threads) {
  const labels = [...new Set(threads.map((t) => t.vendorLabel).filter(Boolean))];
  await store.setMeta({ toolsUsed: labels });
}

async function openStudio() {
  const url = chrome.runtime.getURL(STUDIO_URL);
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.tabs.reload(existing[0].id);
    return { tabId: existing[0].id };
  }
  const tab = await chrome.tabs.create({ url });
  return { tabId: tab.id };
}

async function activateLicense(key, publicJwkOverride) {
  if (publicJwkOverride) {
    await chrome.storage.local.set({ [store.KEYS.publicJwk]: publicJwkOverride });
  }
  const state = await store.getAll();
  const jwk = publicJwkOverride || state.publicJwk || LICENSE_PUBLIC_JWK;
  if (!jwk) throw new Error('This build has no licence public key configured.');

  const result = await verifyLicenseKey(key, jwk);
  if (!result.valid) throw new Error(licenseError(result.reason));
  await store.setLicense({ key, claims: result.claims, activatedAt: new Date().toISOString() });
  return getState();
}

function licenseError(reason) {
  switch (reason) {
    case 'malformed': return 'That does not look like a PacketPress key.';
    case 'bad-signature': return 'This key failed verification. Copy it again from your receipt page.';
    case 'expired': return 'This key has expired. Reopen the Studio once your subscription renews.';
    case 'unknown-plan': return 'This key is for a plan this version does not know about.';
    default: return 'Could not verify this key.';
  }
}
