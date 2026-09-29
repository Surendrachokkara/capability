/**
 * Studio controller.
 *
 * State lives in the background worker; this module keeps a local mirror,
 * writes through on every change, and re-renders the preview from the same
 * packet object the exporters consume. The gate is applied by
 * `gatePacket` at build time, so preview, PDF and Markdown always agree about
 * what the current licence allows.
 */
import { renderPreviewHtml } from '../lib/html-preview.js';
import { renderMarkdown } from '../lib/markdown.js';
import { buildPdf } from '../lib/pdf-jspdf.js';
import { entitlements, gatePacket, FREE_WATERMARK } from '../lib/license.js';
import { includedMessages, blocksToText } from '../lib/model.js';

const CHECKOUT_BASE = 'http://localhost:8787';

const $ = (sel) => document.querySelector(sel);
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

/** @type {{threads: any[], meta: any, entitlements: any, license: any}} */
let state = { threads: [], meta: {}, entitlements: entitlements(null), license: null };
let expanded = new Set();

const META_FIELDS = [
  'title', 'clientName', 'preparedBy', 'dateLabel', 'summary',
  'footer', 'watermark', 'userLabel', 'assistantLabel',
];
const META_TOGGLES = ['includeCover', 'includeToc'];

init();

async function init() {
  const res = await send({ type: 'pp:state' });
  if (!res.ok) return banner(res.error, 'error');
  state = res;

  bindForm();
  bindToolbar();
  bindLicenceDialog();
  fillForm();
  renderThreads();
  renderPlan();
  refreshPreview();

  // Another window (the popup) may capture while the Studio is open.
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes['pp.threads']) return;
    const next = await send({ type: 'pp:state' });
    if (!next.ok) return;
    state = next;
    renderThreads();
    refreshPreview();
  });
  return undefined;
}

/* ------------------------------------------------------------------- form */

function bindForm() {
  for (const id of META_FIELDS) {
    $(`#${id}`).addEventListener('input', (e) => updateMeta({ [id]: e.target.value }));
  }
  for (const id of META_TOGGLES) {
    $(`#${id}`).addEventListener('change', (e) => updateMeta({ [id]: e.target.checked }));
  }
  $('#logo').addEventListener('change', onLogoPicked);
  $('#logoClear').addEventListener('click', () => {
    $('#logo').value = '';
    updateMeta({ logoDataUrl: null });
    renderLogo();
  });
}

function fillForm() {
  for (const id of META_FIELDS) $(`#${id}`).value = state.meta[id] || '';
  for (const id of META_TOGGLES) $(`#${id}`).checked = state.meta[id] !== false;
  renderLogo();
}

function renderLogo() {
  const img = $('#logoPreview');
  const has = Boolean(state.meta.logoDataUrl);
  img.hidden = !has;
  $('#logoClear').hidden = !has;
  if (has) img.src = state.meta.logoDataUrl;
}

const MAX_LOGO_BYTES = 750 * 1024;

async function onLogoPicked(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > MAX_LOGO_BYTES) {
    banner('That logo is over 750 KB. Use a smaller PNG so the packet stays light.', 'error');
    event.target.value = '';
    return;
  }
  try {
    const dataUrl = await readAsDataUrl(file);
    const aspect = await imageAspect(dataUrl);
    await updateMeta({ logoDataUrl: dataUrl, logoAspect: aspect });
    renderLogo();
  } catch {
    banner('Could not read that image.', 'error');
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageAspect(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : 3);
    img.onerror = () => resolve(3);
    img.src = dataUrl;
  });
}

async function updateMeta(patch) {
  state.meta = { ...state.meta, ...patch };
  refreshPreview();
  await send({ type: 'pp:setMeta', meta: patch });
}

/* ---------------------------------------------------------------- threads */

function renderThreads() {
  const list = $('#threadList');
  list.textContent = '';
  $('#noThreads').hidden = state.threads.length > 0;
  $('#threadCount').textContent = state.threads.length
    ? `${selectedThreads().length} of ${state.threads.length} selected`
    : '';

  state.threads.forEach((thread, index) => list.appendChild(threadCard(thread, index)));
}

function threadCard(thread, index) {
  const card = el('div', 'thread-card');
  const head = el('div', 'thread-head');

  const check = el('input');
  check.type = 'checkbox';
  check.checked = thread.selected !== false;
  check.title = 'Include in packet';
  check.addEventListener('change', () => {
    thread.selected = check.checked;
    persistThreads();
  });

  const main = el('div', 'thread-main');
  const title = el('input', 'thread-title');
  title.value = thread.title;
  title.title = 'Rename for the packet';
  title.addEventListener('input', () => {
    thread.title = title.value;
    persistThreads({ skipRender: true });
  });

  const sub = el('div', 'thread-sub');
  const badge = el('span', `badge ${thread.vendor}`);
  badge.textContent = thread.vendorLabel;
  const counts = el('span');
  const kept = includedMessages(thread).length;
  counts.textContent = `${kept}/${thread.messages.length} messages`;
  const toggle = el('button', 'ghost small');
  toggle.textContent = expanded.has(thread.id) ? 'Hide' : 'Choose';
  toggle.addEventListener('click', () => {
    if (expanded.has(thread.id)) expanded.delete(thread.id);
    else expanded.add(thread.id);
    renderThreads();
  });
  sub.append(badge, counts, toggle);
  main.append(title, sub);

  const tools = el('div', 'thread-tools');
  tools.append(
    iconButton('↑', 'Move up', index > 0, () => move(index, -1)),
    iconButton('↓', 'Move down', index < state.threads.length - 1, () => move(index, 1)),
    iconButton('×', 'Remove', true, async () => {
      const res = await send({ type: 'pp:removeThread', id: thread.id });
      if (res.ok) {
        state.threads = res.threads;
        renderThreads();
        refreshPreview();
      }
    }),
  );

  head.append(check, main, tools);
  card.append(head);
  if (expanded.has(thread.id)) card.append(messageList(thread));
  return card;
}

function messageList(thread) {
  const ul = el('ul', 'messages');
  thread.messages.forEach((msg) => {
    const li = el('li', msg.include === false ? 'off' : '');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = msg.include !== false;
    box.addEventListener('change', () => {
      msg.include = box.checked;
      persistThreads();
    });
    const role = el('span', 'role');
    role.textContent = msg.role === 'user' ? 'You' : 'AI';
    const excerpt = el('span', 'excerpt');
    excerpt.textContent = blocksToText(msg.blocks).replace(/\s+/g, ' ').slice(0, 160);
    li.append(box, role, excerpt);
    ul.append(li);
  });
  return ul;
}

function move(index, delta) {
  const next = index + delta;
  if (next < 0 || next >= state.threads.length) return;
  const [item] = state.threads.splice(index, 1);
  state.threads.splice(next, 0, item);
  persistThreads();
}

async function persistThreads({ skipRender = false } = {}) {
  if (!skipRender) renderThreads();
  else $('#threadCount').textContent = `${selectedThreads().length} of ${state.threads.length} selected`;
  refreshPreview();
  await send({ type: 'pp:setThreads', threads: state.threads });
}

function selectedThreads() {
  return state.threads.filter((t) => t.selected !== false && includedMessages(t).length > 0);
}

/* ----------------------------------------------------------------- packet */

/** Builds the packet exactly as the exporters will see it, gate included. */
function buildPacket() {
  const raw = { meta: { ...state.meta }, threads: selectedThreads() };
  return gatePacket(raw, state.entitlements);
}

function refreshPreview() {
  const { packet, trimmed } = buildPacket();
  $('#preview').srcdoc = renderPreviewHtml(packet);

  const msgs = packet.threads.reduce((a, t) => a + includedMessages(t).length, 0);
  $('#previewMeta').textContent = packet.threads.length
    ? `${packet.threads.length} thread${packet.threads.length === 1 ? '' : 's'} · ${msgs} messages`
    : 'Nothing selected';

  const canExport = packet.threads.length > 0;
  $('#exportPdf').disabled = !canExport;
  $('#exportMd').disabled = !canExport;

  if (trimmed > 0) {
    banner(
      `Free plan exports one thread. ${trimmed} more ${trimmed === 1 ? 'is' : 'are'} waiting — upgrade to merge them.`,
      'warn',
      { label: 'Upgrade', action: openLicence },
    );
  } else {
    clearBanner();
  }
}

/* ---------------------------------------------------------------- exports */

function bindToolbar() {
  $('#exportPdf').addEventListener('click', exportPdf);
  $('#exportMd').addEventListener('click', exportMarkdown);
  $('#licenceBtn').addEventListener('click', openLicence);
}

async function exportPdf() {
  const btn = $('#exportPdf');
  btn.disabled = true;
  btn.textContent = 'Building…';
  try {
    await ensureJsPdf();
    const { packet } = buildPacket();
    const { doc } = buildPdf(packet);
    doc.save(fileName('pdf'));
    banner('PDF saved.', 'ok');
  } catch (err) {
    console.error(err);
    banner(`Could not build the PDF: ${err.message}`, 'error');
  } finally {
    btn.textContent = 'Export PDF';
    btn.disabled = false;
  }
}

function exportMarkdown() {
  const { packet } = buildPacket();
  download(new Blob([renderMarkdown(packet)], { type: 'text/markdown' }), fileName('md'));
  banner('Markdown saved.', 'ok');
}

/** jsPDF is a 350 KB UMD bundle; load it only when someone actually exports. */
let jsPdfLoaded = null;
function ensureJsPdf() {
  if (!jsPdfLoaded) {
    jsPdfLoaded = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('vendor/jspdf.umd.min.js');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('jsPDF failed to load'));
      document.head.appendChild(script);
    });
  }
  return jsPdfLoaded;
}

function fileName(ext) {
  const base = [state.meta.clientName, state.meta.title]
    .filter(Boolean).join(' - ') || 'packet';
  const safe = base.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '-').slice(0, 70);
  return `${safe}.${ext}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------------------------------------------------------- licence */

function renderPlan() {
  const ent = state.entitlements;
  $('#plan').textContent = ent.planLabel;
  $('#plan').className = `badge${ent.plan === 'free' ? '' : ' pro'}`;

  const branding = $('.branding');
  branding.disabled = !ent.canBrand;
  $('#brandingLock').hidden = ent.canBrand;
  if (!ent.canBrand) {
    $('#watermark').placeholder = `Free packets carry “${FREE_WATERMARK}”`;
  }
}

function bindLicenceDialog() {
  const dialog = $('#licenceDialog');
  $('#licenceActivate').addEventListener('click', activate);
  $('#licenceRemove').addEventListener('click', async () => {
    const res = await send({ type: 'pp:clearLicense' });
    if (res.ok) {
      state = res;
      renderPlan();
      refreshPreview();
      dialog.close();
    }
  });
  $('#buyMonthly').addEventListener('click', () => checkout('monthly'));
  $('#buyPack').addEventListener('click', () => checkout('pack'));
}

function openLicence() {
  const ent = state.entitlements;
  $('#licenceState').textContent = ent.plan === 'free'
    ? 'Free plan: one thread per packet, PacketPress watermark, no logo.'
    : `${ent.planLabel} active${ent.expiresAt ? ` · renews ${ent.expiresAt.slice(0, 10)}` : ''}.`;
  $('#licenceRemove').hidden = ent.plan === 'free';
  $('#licenceError').hidden = true;
  $('#licenceDialog').showModal();
}

async function activate() {
  const key = $('#licenceKey').value.trim();
  const jwkRaw = $('#publicJwk').value.trim();
  let publicJwk;
  if (jwkRaw) {
    try {
      publicJwk = JSON.parse(jwkRaw);
    } catch {
      return licenceError('That public key is not valid JSON.');
    }
  }

  const res = await send({ type: 'pp:activateLicense', key, publicJwk });
  if (!res.ok) return licenceError(res.error);

  state = res;
  renderPlan();
  refreshPreview();
  $('#licenceDialog').close();
  banner(`${state.entitlements.planLabel} activated.`, 'ok');
  return undefined;
}

function licenceError(text) {
  const el_ = $('#licenceError');
  el_.textContent = text;
  el_.hidden = false;
  return undefined;
}

async function checkout(plan) {
  try {
    const res = await fetch(`${CHECKOUT_BASE}/api/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const data = await res.json();
    if (!data.url) throw new Error(data.error || 'checkout unavailable');
    window.open(data.url, '_blank', 'noopener');
  } catch (err) {
    licenceError(`Could not start checkout (${err.message}). Is the licence server running?`);
  }
}

/* ----------------------------------------------------------------- chrome */

function banner(text, kind, action) {
  const el_ = $('#banner');
  el_.textContent = text;
  el_.className = `notice ${kind === 'warn' ? '' : kind}`;
  el_.hidden = false;
  if (action) {
    const btn = el('button', 'small');
    btn.textContent = action.label;
    btn.style.marginLeft = '10px';
    btn.addEventListener('click', action.action);
    el_.appendChild(btn);
  }
  if (kind === 'ok') setTimeout(clearBanner, 3000);
}

function clearBanner() {
  $('#banner').hidden = true;
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function iconButton(label, title, enabled, onClick) {
  const btn = el('button', 'ghost');
  btn.textContent = label;
  btn.title = title;
  btn.disabled = !enabled;
  btn.addEventListener('click', onClick);
  return btn;
}
