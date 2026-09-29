/**
 * Thin, promise-shaped wrapper over chrome.storage.local. All persisted state
 * lives here so the background worker, popup and studio agree on the shape.
 */
export const KEYS = {
  threads: 'pp.threads',
  meta: 'pp.meta',
  license: 'pp.license',
  publicJwk: 'pp.publicJwk',
};

export function defaultMeta() {
  return {
    title: 'Client packet',
    clientName: '',
    preparedBy: '',
    dateLabel: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    summary: '',
    footer: '',
    toolsUsed: [],
    includeCover: true,
    includeToc: true,
    userLabel: 'Prompt',
    assistantLabel: 'Response',
    watermark: '',
    logoDataUrl: null,
    logoAspect: 3,
  };
}

export async function getAll() {
  const raw = await chrome.storage.local.get(Object.values(KEYS));
  return {
    threads: raw[KEYS.threads] || [],
    meta: { ...defaultMeta(), ...(raw[KEYS.meta] || {}) },
    license: raw[KEYS.license] || null,
    publicJwk: raw[KEYS.publicJwk] || null,
  };
}

export async function getThreads() {
  return (await chrome.storage.local.get(KEYS.threads))[KEYS.threads] || [];
}

export async function setThreads(threads) {
  await chrome.storage.local.set({ [KEYS.threads]: threads });
  return threads;
}

/** Re-capturing a thread replaces it in place, keeping its position. */
export async function upsertThread(thread) {
  const threads = await getThreads();
  const i = threads.findIndex((t) => t.id === thread.id);
  if (i >= 0) threads[i] = { ...thread, selected: threads[i].selected !== false };
  else threads.push({ ...thread, selected: true });
  await setThreads(threads);
  return { threads, replaced: i >= 0 };
}

export async function removeThread(id) {
  const threads = (await getThreads()).filter((t) => t.id !== id);
  await setThreads(threads);
  return threads;
}

export async function setMeta(meta) {
  const current = (await chrome.storage.local.get(KEYS.meta))[KEYS.meta] || {};
  const next = { ...defaultMeta(), ...current, ...meta };
  await chrome.storage.local.set({ [KEYS.meta]: next });
  return next;
}

export async function setLicense(license) {
  await chrome.storage.local.set({ [KEYS.license]: license });
  return license;
}
