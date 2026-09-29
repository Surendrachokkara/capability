import { htmlToBlocks, findDescendant, textOf } from '../../lib/extract.js';
import { makeThreadId } from '../../lib/model.js';

/**
 * chatgpt.com adapter.
 *
 * Primary path uses the stable-ish `data-message-author-role` contract, which
 * has outlived several ChatGPT redesigns. Each fallback is one step more
 * generic so a layout change costs fidelity instead of the whole capture.
 */
export const vendor = 'chatgpt';
export const vendorLabel = 'ChatGPT';

export function matches(loc) {
  return /(^|\.)(chatgpt\.com|chat\.openai\.com)$/.test(loc.hostname);
}

const TURN_SELECTORS = [
  '[data-message-author-role]',
  'article [data-message-id]',
  '[data-testid^="conversation-turn"]',
];

const CONTENT_SELECTORS = [
  '[data-message-content]',
  '.markdown',
  '.prose',
  '.whitespace-pre-wrap',
];

export function collect(doc, loc) {
  const nodes = firstNonEmpty(doc, TURN_SELECTORS);
  const messages = [];
  nodes.forEach((node, i) => {
    const role = readRole(node);
    if (!role) return;
    const content = pickContent(node);
    const blocks = htmlToBlocks(content);
    if (!blocks.length) return;
    messages.push({
      id: node.getAttribute('data-message-id') || `${vendor}-${i}`,
      role,
      blocks,
      include: true,
    });
  });

  return {
    id: makeThreadId(vendor, conversationId(loc)),
    vendor,
    vendorLabel,
    model: readModel(doc, nodes),
    title: readTitle(doc),
    url: loc.href,
    capturedAt: new Date().toISOString(),
    messages,
  };
}

function firstNonEmpty(doc, selectors) {
  for (const sel of selectors) {
    const found = Array.from(doc.querySelectorAll(sel));
    if (found.length) return found;
  }
  return [];
}

function readRole(node) {
  const direct = node.getAttribute('data-message-author-role');
  if (direct) return normalizeRole(direct);
  const inner = node.querySelector('[data-message-author-role]');
  if (inner) return normalizeRole(inner.getAttribute('data-message-author-role'));
  // Last resort: ChatGPT gives user turns a bubble background class.
  const cls = node.getAttribute('class') || '';
  if (/user-message|bg-token-message-surface/.test(cls)) return 'user';
  return null;
}

function normalizeRole(raw) {
  const r = (raw || '').toLowerCase();
  if (r === 'user') return 'user';
  if (r === 'assistant') return 'assistant';
  return null; // system / tool turns are chrome for our purposes
}

function pickContent(node) {
  for (const sel of CONTENT_SELECTORS) {
    const el = node.querySelector(sel);
    if (el && textOf(el).trim()) return el;
  }
  return node;
}

function readModel(doc, nodes) {
  for (const n of nodes) {
    const slug = n.getAttribute('data-message-model-slug');
    if (slug) return slug;
    const inner = n.querySelector('[data-message-model-slug]');
    const innerSlug = inner && inner.getAttribute('data-message-model-slug');
    if (innerSlug) return innerSlug;
  }
  const picker = doc.querySelector('[data-testid="model-switcher-dropdown-button"]');
  const label = picker && textOf(picker).trim();
  return label || null;
}

function readTitle(doc) {
  const active = doc.querySelector('nav a[data-active], nav li[data-active] a');
  const fromNav = active && textOf(active).trim();
  if (fromNav) return fromNav;
  const heading = findDescendant(doc.body || doc, (el) => el.tagName === 'H1');
  const fromHeading = heading && textOf(heading).trim();
  if (fromHeading) return fromHeading;
  return cleanDocTitle(doc.title);
}

function cleanDocTitle(title) {
  return (title || 'ChatGPT conversation').replace(/\s*[|\-–]\s*ChatGPT\s*$/i, '').trim()
    || 'ChatGPT conversation';
}

function conversationId(loc) {
  const m = /\/c\/([\w-]+)/.exec(loc.pathname);
  return m ? m[1] : loc.pathname || 'unknown';
}
