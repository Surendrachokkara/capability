import { htmlToBlocks, textOf } from '../../lib/extract.js';
import { makeThreadId } from '../../lib/model.js';

/**
 * claude.ai adapter.
 *
 * Claude marks the human turn with `data-testid="user-message"` and styles the
 * assistant turn with a `font-claude-*` class rather than a role attribute, so
 * roles are derived from whichever marker a turn carries.
 */
export const vendor = 'claude';
export const vendorLabel = 'Claude';

export function matches(loc) {
  return /(^|\.)claude\.ai$/.test(loc.hostname);
}

const USER_SELECTOR = '[data-testid="user-message"], .font-user-message';
const ASSISTANT_SELECTOR = '[data-testid="assistant-message"], .font-claude-message, .font-claude-response';

export function collect(doc, loc) {
  const seen = new Set();
  const messages = [];
  const candidates = Array.from(doc.querySelectorAll(`${USER_SELECTOR}, ${ASSISTANT_SELECTOR}`));

  candidates.forEach((node, i) => {
    // Nested matches (an assistant container inside a turn wrapper that also
    // matched) would duplicate content.
    if (Array.from(seen).some((prev) => prev.contains && prev.contains(node))) return;
    seen.add(node);

    const role = node.matches(USER_SELECTOR) ? 'user' : 'assistant';
    const blocks = htmlToBlocks(node);
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
    model: readModel(doc),
    title: readTitle(doc),
    url: loc.href,
    capturedAt: new Date().toISOString(),
    messages,
  };
}

function readModel(doc) {
  const picker = doc.querySelector('[data-testid="model-selector-dropdown"]');
  const label = picker && textOf(picker).replace(/\s+/g, ' ').trim();
  return label || null;
}

function readTitle(doc) {
  const trigger = doc.querySelector('[data-testid="chat-menu-trigger"]');
  const fromTrigger = trigger && textOf(trigger).trim();
  if (fromTrigger) return fromTrigger;
  return (doc.title || 'Claude conversation')
    .replace(/\s*[|\-–—·]\s*Claude\s*$/i, '').trim() || 'Claude conversation';
}

function conversationId(loc) {
  const m = /\/chat\/([\w-]+)/.exec(loc.pathname);
  return m ? m[1] : loc.pathname || 'unknown';
}
