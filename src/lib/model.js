/**
 * Canonical data shapes shared by the collectors, the studio UI and the
 * renderers. Everything that crosses a boundary (content script -> storage ->
 * studio -> renderer) is one of these plain-JSON structures.
 *
 * Thread {
 *   id: string            stable per (vendor, sourceId)
 *   vendor: 'chatgpt' | 'claude'
 *   vendorLabel: string   display name, e.g. 'ChatGPT'
 *   model: string|null    model name if the page exposed one
 *   title: string
 *   url: string
 *   capturedAt: string    ISO timestamp
 *   messages: Message[]
 * }
 *
 * Message {
 *   id: string
 *   role: 'user' | 'assistant'
 *   blocks: Block[]
 *   include: boolean      studio-level per-message selection
 * }
 *
 * Block is one of:
 *   { type: 'paragraph', spans: Span[] }
 *   { type: 'heading', level: 1..4, spans: Span[] }
 *   { type: 'list', ordered: boolean, items: { spans: Span[], depth: number }[] }
 *   { type: 'code', language: string|null, code: string }
 *   { type: 'quote', blocks: Block[] }
 *   { type: 'table', head: string[][], rows: string[][] }
 *   { type: 'rule' }
 *
 * Span { text: string, bold?: boolean, italic?: boolean, code?: boolean, href?: string }
 */

export const VENDORS = {
  chatgpt: { label: 'ChatGPT', host: 'chatgpt.com' },
  claude: { label: 'Claude', host: 'claude.ai' },
};

/** Roles we keep. Tool/system chatter is chat chrome, not client content. */
export const KEPT_ROLES = new Set(['user', 'assistant']);

export function makeThreadId(vendor, sourceId) {
  return `${vendor}:${sourceId}`;
}

/** Plain text of a block tree — used for Markdown fallbacks and word counts. */
export function blocksToText(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        out.push(spansToText(b.spans));
        break;
      case 'list':
        for (const it of b.items) out.push(spansToText(it.spans));
        break;
      case 'code':
        out.push(b.code);
        break;
      case 'quote':
        out.push(blocksToText(b.blocks));
        break;
      case 'table':
        for (const row of [...b.head, ...b.rows]) out.push(row.join(' '));
        break;
      default:
        break;
    }
  }
  return out.filter(Boolean).join('\n');
}

export function spansToText(spans) {
  return (spans || []).map((s) => s.text).join('');
}

export function countWords(thread) {
  const text = thread.messages
    .filter((m) => m.include !== false)
    .map((m) => blocksToText(m.blocks))
    .join('\n');
  const words = text.split(/\s+/).filter(Boolean);
  return words.length;
}

/** Messages the user has kept, in order. */
export function includedMessages(thread) {
  return thread.messages.filter((m) => m.include !== false);
}

/**
 * Drops threads/messages that carry no content after extraction, so an empty
 * capture never reaches a client packet.
 */
export function isMeaningful(thread) {
  return includedMessages(thread).some((m) => blocksToText(m.blocks).trim().length > 0);
}
