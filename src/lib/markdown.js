/**
 * Block tree -> Markdown, including the cover front-matter and a linked TOC.
 * Output targets the common denominator (GitHub / Notion / Obsidian): ATX
 * headings, fenced code, pipe tables, no HTML.
 */
import { includedMessages } from './model.js';

export function renderMarkdown(packet) {
  const { meta, threads } = packet;
  const out = [];

  out.push(`# ${meta.title}`);
  out.push('');
  out.push(coverLines(meta).join('  \n'));
  out.push('');
  if (meta.summary) {
    out.push(meta.summary.trim());
    out.push('');
  }
  out.push('---');
  out.push('');

  if (meta.includeToc && threads.length > 1) {
    out.push('## Contents');
    out.push('');
    threads.forEach((t, i) => {
      out.push(`${i + 1}. [${escapeInline(t.title)}](#${slug(t.title, i)}) — ${t.vendorLabel}`);
    });
    out.push('');
    out.push('---');
    out.push('');
  }

  threads.forEach((thread, i) => {
    out.push(`<a id="${slug(thread.title, i)}"></a>`);
    out.push('');
    out.push(`## ${i + 1}. ${escapeInline(thread.title)}`);
    out.push('');
    out.push(`*${sourceLine(thread)}*`);
    out.push('');
    for (const msg of includedMessages(thread)) {
      out.push(`### ${roleLabel(msg.role, meta)}`);
      out.push('');
      out.push(blocksToMarkdown(msg.blocks));
      out.push('');
    }
    if (i < threads.length - 1) {
      out.push('---');
      out.push('');
    }
  });

  if (meta.footer) {
    out.push('---');
    out.push('');
    out.push(`*${escapeInline(meta.footer)}*`);
    out.push('');
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function coverLines(meta) {
  const lines = [];
  if (meta.clientName) lines.push(`**Prepared for:** ${escapeInline(meta.clientName)}`);
  if (meta.preparedBy) lines.push(`**Prepared by:** ${escapeInline(meta.preparedBy)}`);
  if (meta.dateLabel) lines.push(`**Date:** ${escapeInline(meta.dateLabel)}`);
  if (meta.toolsUsed && meta.toolsUsed.length) {
    lines.push(`**Tools used:** ${meta.toolsUsed.map(escapeInline).join(', ')}`);
  }
  return lines;
}

export function sourceLine(thread) {
  const bits = [`Source: ${thread.vendorLabel}`];
  if (thread.model) bits.push(`model ${thread.model}`);
  if (thread.capturedAt) bits.push(`captured ${thread.capturedAt.slice(0, 10)}`);
  return bits.join(' · ');
}

function roleLabel(role, meta) {
  if (role === 'user') return meta.userLabel || 'Prompt';
  return meta.assistantLabel || 'Response';
}

export function blocksToMarkdown(blocks, depth = 0) {
  const parts = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        // Message bodies live under h3, so nudge inner headings down and clamp.
        parts.push(`${'#'.repeat(Math.min(6, b.level + 3))} ${spansToMarkdown(b.spans)}`);
        break;
      case 'paragraph':
        parts.push(spansToMarkdown(b.spans));
        break;
      case 'list':
        parts.push(listToMarkdown(b));
        break;
      case 'code':
        parts.push(fence(b));
        break;
      case 'quote':
        parts.push(
          blocksToMarkdown(b.blocks, depth + 1)
            .split('\n')
            .map((l) => (l ? `> ${l}` : '>'))
            .join('\n'),
        );
        break;
      case 'table':
        parts.push(tableToMarkdown(b));
        break;
      case 'rule':
        parts.push('---');
        break;
      default:
        break;
    }
  }
  return parts.join('\n\n');
}

function listToMarkdown(block) {
  let n = 0;
  return block.items
    .map((item) => {
      const indent = '  '.repeat(item.depth || 0);
      const marker = block.ordered && !item.depth ? `${(n += 1)}.` : '-';
      return `${indent}${marker} ${spansToMarkdown(item.spans).replace(/\n/g, ' ')}`;
    })
    .join('\n');
}

/** Picks a fence long enough to survive backticks inside the snippet. */
function fence(block) {
  const longest = (block.code.match(/`+/g) || []).reduce((a, s) => Math.max(a, s.length), 0);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${block.language || ''}\n${block.code}\n${ticks}`;
}

function tableToMarkdown(block) {
  const head = block.head.length ? block.head[0] : block.rows[0].map(() => '');
  const body = block.head.length ? block.rows : block.rows.slice(1);
  const width = Math.max(head.length, ...body.map((r) => r.length), 1);
  const pad = (row) => Array.from({ length: width }, (_, i) => escapeCell(row[i] || ''));
  const lines = [
    `| ${pad(head).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...body.map((r) => `| ${pad(r).join(' | ')} |`),
  ];
  return lines.join('\n');
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

export function spansToMarkdown(spans) {
  return (spans || [])
    .map((s) => {
      let text = s.code ? `\`${s.text}\`` : escapeInline(s.text);
      if (s.bold) text = `**${text}**`;
      if (s.italic) text = `*${text}*`;
      if (s.href) text = `[${text}](${s.href})`;
      return text;
    })
    .join('');
}

/**
 * Escapes only the characters that would change the structure of the output.
 * Over-escaping prose is worse than the rare stray asterisk.
 */
export function escapeInline(text) {
  return String(text).replace(/([\\`*_[\]])/g, '\\$1');
}

export function slug(title, index) {
  const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base || 'thread'}-${index + 1}`;
}
