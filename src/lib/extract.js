/**
 * HTML -> Block tree.
 *
 * Both ChatGPT and Claude render assistant answers as ordinary semantic HTML
 * (p / ul / ol / pre / table / blockquote) wrapped in a lot of product chrome:
 * toolbars, copy buttons, "regenerate", avatars, thumbs up/down, edit fields,
 * citation chips. This module walks the message subtree, discards the chrome,
 * and emits the small block vocabulary described in model.js.
 *
 * It is DOM-library agnostic: it only uses nodeType / tagName / childNodes /
 * getAttribute / classList, so the Node tests can drive it with a tiny DOM
 * shim and the same code runs untouched in the content script.
 */

const ELEMENT = 1;
const TEXT = 3;

/** Tags that never carry client-facing content. */
const DROPPED_TAGS = new Set([
  'BUTTON', 'SVG', 'PATH', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'TEXTAREA',
  'SELECT', 'OPTION', 'FORM', 'AUDIO', 'VIDEO', 'CANVAS', 'IFRAME', 'DIALOG',
  'MENU', 'NAV', 'FOOTER', 'TEMPLATE',
]);

/**
 * Class / attribute fragments that mark product chrome. Matched
 * case-insensitively against class, data-testid, aria-label and role.
 * Kept deliberately narrow: a false positive silently deletes client content.
 */
const CHROME_PATTERNS = [
  'copy-button', 'copy-code', 'copybutton', 'code-block-header', 'sticky',
  'regenerate', 'thumbs', 'feedback', 'vote', 'avatar', 'author-role-icon',
  'message-actions', 'turn-actions', 'action-bar', 'toolbar', 'tooltip',
  'edit-button', 'retry', 'model-switcher', 'share-button', 'branch',
  'citation-chip', 'sources-carousel', 'attribution-pill', 'screenreader',
  'sr-only', 'visually-hidden', 'skip-to', 'scroll-to-bottom',
];

const HEADING_LEVELS = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 4, H6: 4 };

function attr(el, name) {
  if (typeof el.getAttribute !== 'function') return '';
  return el.getAttribute(name) || '';
}

function chromeSignature(el) {
  return [
    attr(el, 'class'),
    attr(el, 'data-testid'),
    attr(el, 'aria-label'),
    attr(el, 'role'),
  ].join(' ').toLowerCase();
}

export function isChrome(el) {
  if (!el || el.nodeType !== ELEMENT) return false;
  if (DROPPED_TAGS.has(el.tagName)) return true;
  if (attr(el, 'aria-hidden') === 'true') return true;
  // A bare `hidden` attribute reads as an empty string, which is still hidden;
  // only an explicit `hidden="false"` is not. Absence is checked first so an
  // ordinary element is never mistaken for a hidden one.
  if (typeof el.hasAttribute === 'function' && el.hasAttribute('hidden')
      && attr(el, 'hidden') !== 'false') {
    return true;
  }
  const sig = chromeSignature(el);
  return CHROME_PATTERNS.some((p) => sig.includes(p));
}

/* ------------------------------------------------------------------ spans */

const INLINE_STYLE = {
  STRONG: { bold: true }, B: { bold: true },
  EM: { italic: true }, I: { italic: true },
  CODE: { code: true }, KBD: { code: true }, SAMP: { code: true },
};

/**
 * Collects inline content into a flat span list. Adjacent spans with identical
 * formatting are merged so the renderers do not have to care about how deeply
 * the source nested its <span> soup.
 */
export function collectSpans(node, inherited = {}, out = []) {
  if (!node) return out;
  if (node.nodeType === TEXT) {
    pushSpan(out, { ...inherited, text: node.nodeValue || '' });
    return out;
  }
  if (node.nodeType !== ELEMENT) return out;
  if (isChrome(node)) return out;

  const tag = node.tagName;
  if (tag === 'BR') {
    pushSpan(out, { ...inherited, text: '\n' });
    return out;
  }
  if (tag === 'IMG') {
    const alt = attr(node, 'alt');
    if (alt) pushSpan(out, { ...inherited, text: `[image: ${alt}]`, italic: true });
    return out;
  }

  let style = { ...inherited, ...(INLINE_STYLE[tag] || {}) };
  if (tag === 'A') {
    const href = attr(node, 'href');
    if (href && !href.startsWith('#')) style = { ...style, href };
  }
  for (const child of childNodes(node)) collectSpans(child, style, out);
  return out;
}

function pushSpan(out, span) {
  if (!span.text) return;
  const prev = out[out.length - 1];
  if (prev && sameStyle(prev, span)) {
    prev.text += span.text;
    return;
  }
  out.push(span);
}

function sameStyle(a, b) {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic
    && !!a.code === !!b.code && (a.href || null) === (b.href || null);
}

function childNodes(node) {
  const kids = node.childNodes;
  if (!kids) return [];
  return Array.from(kids);
}

/** Trims edge whitespace across the span list and drops emptied spans. */
export function normalizeSpans(spans) {
  const cleaned = spans
    .map((s) => ({ ...s, text: s.text.replace(/[ \t]*\n[ \t]*/g, '\n').replace(/[ \t]{2,}/g, ' ') }))
    .filter((s) => s.text.length > 0);
  if (cleaned.length) {
    cleaned[0].text = cleaned[0].text.replace(/^[\s ]+/, '');
    const last = cleaned[cleaned.length - 1];
    last.text = last.text.replace(/[\s ]+$/, '');
  }
  return cleaned.filter((s) => s.text.length > 0);
}

/* ----------------------------------------------------------------- blocks */

/** Entry point: returns a Block[] for a message container element. */
export function htmlToBlocks(root) {
  const blocks = [];
  walkBlocks(root, blocks);
  return mergeAdjacentCode(blocks.filter(nonEmptyBlock));
}

function walkBlocks(node, out) {
  // Inline children (text, <strong>, <a>, <code>, …) that sit directly inside a
  // container belong to one paragraph. Buffering them keeps
  // `price <strong>value-based</strong> retainers` a single sentence instead of
  // three stacked paragraphs.
  let inline = [];
  const flushInline = () => {
    if (!inline.length) return;
    const spans = normalizeSpans(inline.reduce((acc, n) => collectSpans(n, {}, acc), []));
    if (spans.length) out.push({ type: 'paragraph', spans });
    inline = [];
  };

  for (const child of childNodes(node)) {
    if (child.nodeType === TEXT) {
      inline.push(child);
      continue;
    }
    if (child.nodeType !== ELEMENT || isChrome(child)) continue;
    const tag = child.tagName;

    if (!BLOCK_TAGS.has(tag)) {
      inline.push(child);
      continue;
    }
    flushInline();

    if (HEADING_LEVELS[tag]) {
      const spans = normalizeSpans(collectSpans(child));
      if (spans.length) out.push({ type: 'heading', level: HEADING_LEVELS[tag], spans });
      continue;
    }
    if (tag === 'P') {
      const spans = normalizeSpans(collectSpans(child));
      if (spans.length) out.push({ type: 'paragraph', spans });
      continue;
    }
    if (tag === 'PRE') {
      const block = readCode(child);
      if (block) out.push(block);
      continue;
    }
    if (tag === 'UL' || tag === 'OL') {
      const list = readList(child, tag === 'OL', 0);
      if (list.items.length) out.push(list);
      continue;
    }
    if (tag === 'BLOCKQUOTE') {
      const inner = [];
      walkBlocks(child, inner);
      const kept = inner.filter(nonEmptyBlock);
      if (kept.length) out.push({ type: 'quote', blocks: kept });
      continue;
    }
    if (tag === 'TABLE') {
      const table = readTable(child);
      if (table) out.push(table);
      continue;
    }
    if (tag === 'HR') {
      out.push({ type: 'rule' });
      continue;
    }
    if (tag === 'LI') {
      // Stray <li> outside a list container.
      const spans = normalizeSpans(collectSpans(child));
      if (spans.length) out.push({ type: 'list', ordered: false, items: [{ spans, depth: 0 }] });
      continue;
    }

    // Generic container. If it holds block-level children, recurse; otherwise
    // treat its inline content as one paragraph.
    if (hasBlockChild(child)) {
      walkBlocks(child, out);
    } else {
      const spans = normalizeSpans(collectSpans(child));
      if (spans.length) out.push({ type: 'paragraph', spans });
    }
  }
  flushInline();
}

/** Tags that break the flow of a paragraph. Everything else is inline. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'PRE', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'HR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'ARTICLE', 'HEADER', 'MAIN',
  'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ASIDE', 'DETAILS',
]);

function hasBlockChild(el) {
  return childNodes(el).some(
    (c) => c.nodeType === ELEMENT && !isChrome(c) && BLOCK_TAGS.has(c.tagName),
  );
}

/**
 * Reads a fenced code block. Language comes from the conventional
 * `language-xxx` class, a `data-language` attribute, or the little header label
 * both vendors render above the code.
 */
function readCode(pre) {
  const codeEl = findDescendant(pre, (el) => el.tagName === 'CODE') || pre;
  const code = textOf(codeEl).replace(/\n+$/, '');
  if (!code.trim()) return null;
  return { type: 'code', language: detectLanguage(pre, codeEl), code };
}

function detectLanguage(pre, codeEl) {
  for (const el of [codeEl, pre]) {
    const cls = attr(el, 'class');
    const m = /(?:^|\s)(?:language|lang)-([\w+#-]+)/i.exec(cls);
    if (m) return m[1].toLowerCase();
    const data = attr(el, 'data-language') || attr(el, 'data-lang');
    if (data) return data.toLowerCase();
  }
  return null;
}

function readList(listEl, ordered, depth) {
  const items = [];
  for (const li of childNodes(listEl)) {
    if (li.nodeType !== ELEMENT || li.tagName !== 'LI' || isChrome(li)) continue;
    const inlineOnly = childNodes(li).filter(
      (c) => !(c.nodeType === ELEMENT && (c.tagName === 'UL' || c.tagName === 'OL')),
    );
    const spans = normalizeSpans(inlineOnly.reduce((acc, c) => collectSpans(c, {}, acc), []));
    if (spans.length) items.push({ spans, depth });
    for (const nested of childNodes(li)) {
      if (nested.nodeType === ELEMENT && (nested.tagName === 'UL' || nested.tagName === 'OL')) {
        items.push(...readList(nested, nested.tagName === 'OL', depth + 1).items);
      }
    }
  }
  return { type: 'list', ordered, items };
}

function readTable(tableEl) {
  const head = [];
  const rows = [];
  for (const row of collectDescendants(tableEl, (el) => el.tagName === 'TR')) {
    const cells = collectDescendants(row, (el) => el.tagName === 'TH' || el.tagName === 'TD')
      .map((c) => textOf(c).replace(/\s+/g, ' ').trim());
    if (!cells.length) continue;
    const isHead = collectDescendants(row, (el) => el.tagName === 'TH').length === cells.length;
    (isHead && !rows.length ? head : rows).push(cells);
  }
  if (!head.length && !rows.length) return null;
  return { type: 'table', head, rows };
}

/* --------------------------------------------------------------- helpers */

export function textOf(node) {
  if (!node) return '';
  if (node.nodeType === TEXT) return node.nodeValue || '';
  if (node.nodeType !== ELEMENT || isChrome(node)) return '';
  if (node.tagName === 'BR') return '\n';
  return childNodes(node).map(textOf).join('');
}

export function findDescendant(root, pred) {
  for (const child of childNodes(root)) {
    if (child.nodeType !== ELEMENT) continue;
    if (pred(child)) return child;
    const found = findDescendant(child, pred);
    if (found) return found;
  }
  return null;
}

export function collectDescendants(root, pred, out = []) {
  for (const child of childNodes(root)) {
    if (child.nodeType !== ELEMENT) continue;
    if (pred(child)) out.push(child);
    else collectDescendants(child, pred, out);
  }
  return out;
}

function nonEmptyBlock(b) {
  if (!b) return false;
  if (b.type === 'rule') return true;
  if (b.type === 'code') return b.code.trim().length > 0;
  if (b.type === 'list') return b.items.length > 0;
  if (b.type === 'table') return b.head.length > 0 || b.rows.length > 0;
  if (b.type === 'quote') return b.blocks.length > 0;
  return (b.spans || []).some((s) => s.text.trim().length > 0);
}

/**
 * Some builds split one logical code block across sibling <pre> wrappers.
 * Rejoining them keeps snippets copy-pasteable in the deliverable.
 */
function mergeAdjacentCode(blocks) {
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.type === 'code' && prev && prev.type === 'code' && prev.language === b.language) {
      prev.code += `\n${b.code}`;
      continue;
    }
    out.push(b);
  }
  return out;
}
