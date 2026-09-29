/**
 * Packet -> paginated PDF.
 *
 * The engine is split in two so it can be tested without a PDF backend:
 *
 *   layoutPacket(packet, measurer)  -> { pages: Op[][], threadStarts, meta }
 *   paintPages(pages, renderer)     -> draws the ops
 *
 * A "measurer" only has to answer text-width questions; a "renderer" also
 * draws. `createJsPdfRenderer` supplies both on top of jsPDF, while the tests
 * use a deterministic fixed-width measurer.
 *
 * Layout runs in one pass: the body is laid out first into a page buffer, and
 * because the number of TOC pages is a function of the entry count alone, the
 * final page numbers are known before anything is drawn.
 */

export const LETTER = { width: 612, height: 792 };
export const A4 = { width: 595.28, height: 841.89 };

export const THEME = {
  margin: 54,
  bodyFont: 'helvetica',
  monoFont: 'courier',
  bodySize: 10.5,
  bodyLeading: 1.45,
  monoSize: 9,
  monoLeading: 1.35,
  ink: '#1a1a1a',
  muted: '#6b6b6b',
  rule: '#d8d8d8',
  codeBg: '#f4f5f7',
  accent: '#2f5bd7',
  quoteBar: '#c9d2ea',
};

/* ------------------------------------------------------------------ layout */

class Layout {
  constructor(measurer, opts) {
    this.m = measurer;
    this.page = opts.page;
    this.theme = opts.theme;
    this.margin = opts.theme.margin;
    this.contentWidth = this.page.width - this.margin * 2;
    this.bottom = this.page.height - this.margin - 24; // leave room for footer
    this.pages = [];
    this.ops = [];
    this.y = this.margin;
  }

  get x() { return this.margin; }

  newPage() {
    this.pages.push(this.ops);
    this.ops = [];
    this.y = this.margin;
  }

  finish() {
    if (this.ops.length || !this.pages.length) this.pages.push(this.ops);
    this.ops = [];
    return this.pages;
  }

  /** Current 0-based page index content is landing on. */
  get pageIndex() { return this.pages.length; }

  need(height) {
    if (this.y + height > this.bottom) this.newPage();
  }

  space(h) { this.y += h; }

  push(op) { this.ops.push(op); }

  lineHeight(size, leading) { return size * leading; }

  /** Greedy line breaker over styled spans. Returns lines of styled tokens. */
  wrapSpans(spans, maxWidth, size, font) {
    const lines = [];
    let line = [];
    let width = 0;
    const flush = () => { lines.push(line); line = []; width = 0; };

    for (const span of spans) {
      const style = spanStyle(span);
      const spanFont = span.code ? this.theme.monoFont : font;
      const segments = String(span.text).split('\n');
      segments.forEach((segment, si) => {
        if (si > 0) flush();
        const tokens = segment.match(/\S+\s*|\s+/g) || [];
        for (const token of tokens) {
          const w = this.m.measure(token, spanFont, size, style);
          const trimmedW = this.m.measure(token.trimEnd(), spanFont, size, style);
          if (line.length && width + trimmedW > maxWidth) flush();
          if (!line.length && /^\s+$/.test(token)) continue; // no leading space
          line.push({ text: token, font: spanFont, style, href: span.href, width: w });
          width += w;
        }
      });
    }
    if (line.length) flush();
    return lines.filter((l) => l.length);
  }

  drawWrappedSpans(spans, { indent = 0, size, font, color, leading }) {
    const maxWidth = this.contentWidth - indent;
    const lines = this.wrapSpans(spans, maxWidth, size, font);
    const lh = this.lineHeight(size, leading);
    for (const line of lines) {
      this.need(lh);
      let x = this.x + indent;
      for (const token of line) {
        this.push({
          op: 'text', x, y: this.y + size, text: token.text,
          font: token.font, size, style: token.style,
          color: token.href ? this.theme.accent : color,
        });
        if (token.href) {
          this.push({
            op: 'line', x1: x, y1: this.y + size + 1.4,
            x2: x + this.m.measure(token.text.trimEnd(), token.font, size, token.style),
            y2: this.y + size + 1.4, color: this.theme.accent, width: 0.4,
          });
        }
        x += token.width;
      }
      this.space(lh);
    }
    return lines.length;
  }
}

function spanStyle(span) {
  if (span.bold && span.italic) return 'bolditalic';
  if (span.bold) return 'bold';
  if (span.italic) return 'italic';
  return 'normal';
}

/* ------------------------------------------------------------- block paint */

function layoutBlocks(L, blocks, indent = 0) {
  const t = L.theme;
  blocks.forEach((block, i) => {
    switch (block.type) {
      case 'heading': {
        const size = [0, 15, 13, 11.5, 11][block.level] || 11;
        const lh = L.lineHeight(size, 1.3);
        // Keep a heading with at least one body line after it.
        L.need(lh + L.lineHeight(t.bodySize, t.bodyLeading));
        L.space(i === 0 ? 2 : 8);
        L.drawWrappedSpans(block.spans, {
          indent, size, font: t.bodyFont, color: t.ink, leading: 1.3, bold: true,
        });
        L.space(3);
        break;
      }
      case 'paragraph':
        L.drawWrappedSpans(block.spans, {
          indent, size: t.bodySize, font: t.bodyFont, color: t.ink, leading: t.bodyLeading,
        });
        L.space(6);
        break;
      case 'list':
        layoutList(L, block, indent);
        L.space(6);
        break;
      case 'code':
        layoutCode(L, block, indent);
        L.space(8);
        break;
      case 'quote':
        layoutQuote(L, block, indent);
        L.space(8);
        break;
      case 'table':
        layoutTable(L, block, indent);
        L.space(8);
        break;
      case 'rule': {
        L.need(14);
        L.space(6);
        L.push({
          op: 'line', x1: L.x + indent, y1: L.y, x2: L.x + L.contentWidth, y2: L.y,
          color: t.rule, width: 0.6,
        });
        L.space(8);
        break;
      }
      default:
        break;
    }
  });
}

function layoutList(L, block, indent) {
  const t = L.theme;
  let counter = 0;
  for (const item of block.items) {
    const depth = item.depth || 0;
    const itemIndent = indent + depth * 16;
    const marker = block.ordered && depth === 0 ? `${(counter += 1)}.` : bullet(depth);
    const markerWidth = 14;
    const lh = L.lineHeight(t.bodySize, t.bodyLeading);
    L.need(lh);
    L.push({
      op: 'text', x: L.x + itemIndent, y: L.y + t.bodySize, text: marker,
      font: t.bodyFont, size: t.bodySize, style: 'normal', color: t.muted,
    });
    L.drawWrappedSpans(item.spans, {
      indent: itemIndent + markerWidth, size: t.bodySize, font: t.bodyFont,
      color: t.ink, leading: t.bodyLeading,
    });
    L.space(1.5);
  }
}

function bullet(depth) {
  return ['•', '–', '·'][depth % 3];
}

function layoutCode(L, block, indent) {
  const t = L.theme;
  const padX = 8;
  const padY = 6;
  const innerWidth = L.contentWidth - indent - padX * 2;
  const charWidth = L.m.measure('M', t.monoFont, t.monoSize, 'normal') || t.monoSize * 0.6;
  const cols = Math.max(20, Math.floor(innerWidth / charWidth));
  const lines = wrapCode(block.code, cols);
  const lh = L.lineHeight(t.monoSize, t.monoLeading);

  // Never start a code block with fewer than three lines of room.
  L.need(Math.min(lines.length, 3) * lh + padY * 2 + (block.language ? 12 : 0));

  if (block.language) {
    L.push({
      op: 'text', x: L.x + indent, y: L.y + 8, text: block.language.toUpperCase(),
      font: t.bodyFont, size: 7.5, style: 'bold', color: t.muted,
    });
    L.space(11);
  }

  let i = 0;
  while (i < lines.length) {
    const avail = Math.max(1, Math.floor((L.bottom - L.y - padY * 2) / lh));
    const chunk = lines.slice(i, i + avail);
    const boxHeight = chunk.length * lh + padY * 2;
    L.push({
      op: 'rect', x: L.x + indent, y: L.y, w: L.contentWidth - indent, h: boxHeight,
      fill: t.codeBg, radius: 3,
    });
    let y = L.y + padY;
    for (const line of chunk) {
      L.push({
        op: 'text', x: L.x + indent + padX, y: y + t.monoSize, text: line,
        font: t.monoFont, size: t.monoSize, style: 'normal', color: t.ink,
      });
      y += lh;
    }
    L.space(boxHeight);
    i += chunk.length;
    if (i < lines.length) L.newPage();
  }
}

/** Hard-wraps code at the column budget, preferring to break at whitespace. */
export function wrapCode(code, cols) {
  const out = [];
  for (const raw of String(code).replace(/\t/g, '  ').split('\n')) {
    if (raw.length <= cols) { out.push(raw); continue; }
    let rest = raw;
    const indentMatch = /^\s*/.exec(raw);
    const hangIndent = ' '.repeat(Math.min((indentMatch ? indentMatch[0].length : 0) + 2, cols - 10));
    let first = true;
    while (rest.length > cols) {
      const budget = first ? cols : cols - hangIndent.length;
      let cut = rest.lastIndexOf(' ', budget);
      if (cut <= budget * 0.5) cut = budget;
      out.push((first ? '' : hangIndent) + rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).replace(/^\s+/, '');
      first = false;
    }
    if (rest.length) out.push((first ? '' : hangIndent) + rest);
  }
  return out;
}

function layoutQuote(L, block, indent) {
  const t = L.theme;
  const barX = L.x + indent + 1;
  const startPage = L.pageIndex;
  const startY = L.y;
  layoutBlocks(L, block.blocks, indent + 14);
  // Draw the bar after the fact so it matches the laid-out height. A quote
  // spanning a page break gets a bar on each page it touches.
  if (L.pageIndex === startPage) {
    L.push({ op: 'rect', x: barX, y: startY, w: 2.2, h: Math.max(4, L.y - startY - 6), fill: t.quoteBar });
  } else {
    L.pages[startPage].push({
      op: 'rect', x: barX, y: startY, w: 2.2, h: Math.max(4, L.bottom - startY), fill: t.quoteBar,
    });
    for (let p = startPage + 1; p < L.pageIndex; p += 1) {
      L.pages[p].push({ op: 'rect', x: barX, y: L.margin, w: 2.2, h: L.bottom - L.margin, fill: t.quoteBar });
    }
    L.push({ op: 'rect', x: barX, y: L.margin, w: 2.2, h: Math.max(4, L.y - L.margin - 6), fill: t.quoteBar });
  }
}

function layoutTable(L, block, indent) {
  const t = L.theme;
  const rows = [...block.head.map((r) => ({ cells: r, head: true })),
    ...block.rows.map((r) => ({ cells: r, head: false }))];
  if (!rows.length) return;
  const cols = Math.max(...rows.map((r) => r.cells.length));
  const width = L.contentWidth - indent;
  const colWidth = width / cols;
  const size = 9.5;
  const lh = L.lineHeight(size, 1.3);
  const padX = 5;
  const padY = 4;

  for (const row of rows) {
    const wrapped = Array.from({ length: cols }, (_, c) => {
      const spans = [{ text: row.cells[c] || '' }];
      return L.wrapSpans(spans, colWidth - padX * 2, size, t.bodyFont);
    });
    const height = Math.max(...wrapped.map((w) => w.length), 1) * lh + padY * 2;
    L.need(height);
    if (row.head) {
      L.push({ op: 'rect', x: L.x + indent, y: L.y, w: width, h: height, fill: t.codeBg });
    }
    for (let c = 0; c < cols; c += 1) {
      let y = L.y + padY;
      for (const line of wrapped[c]) {
        L.push({
          op: 'text', x: L.x + indent + c * colWidth + padX, y: y + size,
          text: line.map((tok) => tok.text).join(''), font: t.bodyFont, size,
          style: row.head ? 'bold' : 'normal', color: t.ink,
        });
        y += lh;
      }
    }
    L.push({
      op: 'line', x1: L.x + indent, y1: L.y + height, x2: L.x + indent + width, y2: L.y + height,
      color: t.rule, width: 0.5,
    });
    L.space(height);
  }
}

/* ------------------------------------------------------------ document body */

import { includedMessages } from './model.js';

function layoutBody(L, packet) {
  const t = L.theme;
  const threadStarts = [];
  const { threads, meta } = packet;

  threads.forEach((thread, i) => {
    if (i > 0) L.newPage(); // each thread opens a page — it reads as a section
    threadStarts.push(L.pageIndex);

    L.push({
      op: 'text', x: L.x, y: L.y + 8, text: `${thread.vendorLabel.toUpperCase()}${thread.model ? ` · ${thread.model}` : ''}`,
      font: t.bodyFont, size: 7.5, style: 'bold', color: t.accent,
    });
    L.space(14);
    L.drawWrappedSpans([{ text: `${i + 1}. ${thread.title}` }], {
      size: 17, font: t.bodyFont, color: t.ink, leading: 1.25,
    });
    L.space(2);
    L.push({ op: 'line', x1: L.x, y1: L.y, x2: L.x + L.contentWidth, y2: L.y, color: t.rule, width: 0.8 });
    L.space(12);

    for (const msg of includedMessages(thread)) {
      const label = msg.role === 'user'
        ? (meta.userLabel || 'Prompt')
        : (meta.assistantLabel || 'Response');
      L.need(30);
      L.push({
        op: 'text', x: L.x, y: L.y + 8, text: label.toUpperCase(),
        font: t.bodyFont, size: 7.5, style: 'bold',
        color: msg.role === 'user' ? t.muted : t.accent,
      });
      L.space(13);
      layoutBlocks(L, msg.blocks);
      L.space(8);
    }
  });

  return threadStarts;
}

/* ------------------------------------------------------------------- cover */

function layoutCover(L, packet) {
  const t = L.theme;
  const meta = packet.meta;
  const ops = [];
  const cx = L.margin;
  let y = L.margin + 40;

  if (meta.logoDataUrl) {
    const h = Math.min(meta.logoHeight || 42, 80);
    const w = h * (meta.logoAspect || 3);
    ops.push({ op: 'image', dataUrl: meta.logoDataUrl, x: cx, y, w, h });
    y += h + 30;
  }

  ops.push({
    op: 'text', x: cx, y: y + 10, text: 'PREPARED FOR', font: t.bodyFont,
    size: 8, style: 'bold', color: t.muted,
  });
  y += 20;
  if (meta.clientName) {
    ops.push({
      op: 'text', x: cx, y: y + 20, text: meta.clientName, font: t.bodyFont,
      size: 20, style: 'bold', color: t.ink,
    });
    y += 34;
  }

  y += 24;
  const titleLines = L.wrapSpans([{ text: meta.title }], L.contentWidth, 27, t.bodyFont);
  for (const line of titleLines) {
    ops.push({
      op: 'text', x: cx, y: y + 27, text: line.map((tk) => tk.text).join(''),
      font: t.bodyFont, size: 27, style: 'bold', color: t.ink,
    });
    y += 27 * 1.25;
  }

  y += 14;
  ops.push({ op: 'line', x1: cx, y1: y, x2: cx + 90, y2: y, color: t.accent, width: 2.4 });
  y += 26;

  if (meta.summary) {
    const sub = new Layout(L.m, { page: L.page, theme: t });
    sub.y = y;
    sub.drawWrappedSpans([{ text: meta.summary }], {
      size: 11.5, font: t.bodyFont, color: t.muted, leading: 1.5,
    });
    ops.push(...sub.ops);
    y = sub.y + 10;
  }

  // Facts block sits on the lower third so the cover keeps its air.
  let fy = Math.max(y + 40, L.page.height - L.margin - 150);
  const facts = [
    ['DATE', meta.dateLabel],
    ['PREPARED BY', meta.preparedBy],
    ['TOOLS USED', (meta.toolsUsed || []).join(' · ')],
    ['CONTENTS', threadCountLabel(packet)],
  ].filter(([, v]) => v);

  ops.push({ op: 'line', x1: cx, y1: fy - 18, x2: cx + L.contentWidth, y2: fy - 18, color: t.rule, width: 0.6 });
  for (const [label, value] of facts) {
    ops.push({
      op: 'text', x: cx, y: fy + 7, text: label, font: t.bodyFont,
      size: 7.5, style: 'bold', color: t.muted,
    });
    ops.push({
      op: 'text', x: cx + 110, y: fy + 7, text: value, font: t.bodyFont,
      size: 10, style: 'normal', color: t.ink,
    });
    fy += 19;
  }
  return ops;
}

function threadCountLabel(packet) {
  const n = packet.threads.length;
  const msgs = packet.threads.reduce((a, t) => a + includedMessages(t).length, 0);
  return `${n} thread${n === 1 ? '' : 's'} · ${msgs} message${msgs === 1 ? '' : 's'}`;
}

/* --------------------------------------------------------------------- TOC */

const TOC_ROW_HEIGHT = 26;

export function tocPageCount(L, entryCount) {
  if (!entryCount) return 0;
  const usable = L.bottom - L.margin - 54;
  const perPage = Math.max(1, Math.floor(usable / TOC_ROW_HEIGHT));
  return Math.ceil(entryCount / perPage);
}

function layoutToc(L, packet, threadStarts, offset) {
  const t = L.theme;
  const usable = L.bottom - L.margin - 54;
  const perPage = Math.max(1, Math.floor(usable / TOC_ROW_HEIGHT));
  const pages = [];
  const entries = packet.threads.map((thread, i) => ({
    label: `${i + 1}. ${thread.title}`,
    meta: thread.vendorLabel + (thread.model ? ` · ${thread.model}` : ''),
    page: threadStarts[i] + offset + 1,
  }));

  for (let p = 0; p * perPage < entries.length; p += 1) {
    const ops = [];
    let y = L.margin;
    if (p === 0) {
      ops.push({
        op: 'text', x: L.margin, y: y + 16, text: 'Contents', font: t.bodyFont,
        size: 17, style: 'bold', color: t.ink,
      });
      y += 30;
      ops.push({ op: 'line', x1: L.margin, y1: y, x2: L.margin + L.contentWidth, y2: y, color: t.rule, width: 0.8 });
      y += 20;
    }
    for (const e of entries.slice(p * perPage, (p + 1) * perPage)) {
      const pageLabel = String(e.page);
      const pageWidth = L.m.measure(pageLabel, t.bodyFont, 10.5, 'normal');
      const labelMax = L.contentWidth - pageWidth - 26;
      const label = truncate(L.m, e.label, labelMax, t.bodyFont, 11, 'bold');
      ops.push({
        op: 'text', x: L.margin, y: y + 11, text: label, font: t.bodyFont,
        size: 11, style: 'bold', color: t.ink,
      });
      ops.push({
        op: 'text', x: L.margin + L.contentWidth - pageWidth, y: y + 11, text: pageLabel,
        font: t.bodyFont, size: 10.5, style: 'normal', color: t.muted,
      });
      ops.push({
        op: 'text', x: L.margin, y: y + 22, text: e.meta, font: t.bodyFont,
        size: 8.5, style: 'normal', color: t.muted,
      });
      y += TOC_ROW_HEIGHT;
    }
    pages.push(ops);
  }
  return pages;
}

function truncate(m, text, maxWidth, font, size, style) {
  if (m.measure(text, font, size, style) <= maxWidth) return text;
  let out = text;
  while (out.length > 4 && m.measure(`${out}…`, font, size, style) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

/* ------------------------------------------------------------- entry points */

export function layoutPacket(packet, measurer, options = {}) {
  const theme = { ...THEME, ...(options.theme || {}) };
  const page = options.page || LETTER;
  const meta = packet.meta || {};

  const body = new Layout(measurer, { page, theme });
  const threadStarts = layoutBody(body, packet);
  const bodyPages = body.finish();

  const wantToc = meta.includeToc !== false && packet.threads.length > 1;
  const tocCount = wantToc ? tocPageCount(body, packet.threads.length) : 0;
  const coverCount = meta.includeCover === false ? 0 : 1;
  const offset = coverCount + tocCount;

  const pages = [];
  if (coverCount) pages.push(layoutCover(body, packet));
  if (tocCount) pages.push(...layoutToc(body, packet, threadStarts, offset));
  pages.push(...bodyPages);

  // Footers and watermark go on last so they sit above the code/table fills.
  const firstNumbered = coverCount; // never number the cover
  pages.forEach((ops, i) => {
    if (meta.watermark) ops.unshift(watermarkOp(page, theme, meta.watermark));
    if (i >= firstNumbered) {
      ops.push(...footerOps(page, theme, meta, i + 1, pages.length));
    }
  });

  return { pages, threadStarts, offset, page, theme };
}

function watermarkOp(page, theme, text) {
  return {
    op: 'text', x: page.width / 2, y: page.height / 2, text,
    font: theme.bodyFont, size: 54, style: 'bold', color: '#eef0f4',
    angle: 38, align: 'center',
  };
}

function footerOps(page, theme, meta, pageNo, total) {
  const y = page.height - theme.margin + 14;
  const ops = [{
    op: 'line', x1: theme.margin, y1: y - 12, x2: page.width - theme.margin, y2: y - 12,
    color: theme.rule, width: 0.5,
  }];
  const left = meta.footer || [meta.clientName, meta.dateLabel].filter(Boolean).join(' · ');
  if (left) {
    ops.push({
      op: 'text', x: theme.margin, y, text: left, font: theme.bodyFont,
      size: 8, style: 'normal', color: theme.muted,
    });
  }
  ops.push({
    op: 'text', x: page.width - theme.margin, y, text: `${pageNo} / ${total}`,
    font: theme.bodyFont, size: 8, style: 'normal', color: theme.muted, align: 'right',
  });
  return ops;
}

export function paintPages(layout, renderer) {
  layout.pages.forEach((ops, i) => {
    if (i > 0) renderer.addPage();
    for (const op of ops) renderer.draw(op);
  });
  return renderer;
}
