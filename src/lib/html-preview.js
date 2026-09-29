/**
 * Packet -> HTML, for the Studio's live preview. Mirrors the PDF's structure
 * (cover, contents, per-thread sections) closely enough that what the user
 * approves on screen is what lands in the file.
 *
 * Everything interpolated here originates in page DOM we scraped, so every
 * value goes through `esc`. The preview is rendered into a sandboxed iframe as
 * well, which is belt and braces on purpose.
 */
import { includedMessages } from './model.js';

export function renderPreviewHtml(packet) {
  const { meta, threads } = packet;
  const parts = [];

  if (meta.includeCover !== false) parts.push(cover(meta, packet));
  if (meta.includeToc !== false && threads.length > 1) parts.push(toc(threads));

  threads.forEach((thread, i) => {
    parts.push(`<section class="thread" id="t${i}">
      <p class="src">${esc(thread.vendorLabel)}${thread.model ? ` · ${esc(thread.model)}` : ''}</p>
      <h2>${i + 1}. ${esc(thread.title)}</h2>
      ${includedMessages(thread).map((m) => message(m, meta)).join('')}
    </section>`);
  });

  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body${meta.watermark ? ' class="watermarked"' : ''}>
${meta.watermark ? `<div class="watermark">${esc(meta.watermark)}</div>` : ''}
<main>${parts.join('')}</main></body></html>`;
}

function cover(meta, packet) {
  const facts = [
    ['Date', meta.dateLabel],
    ['Prepared by', meta.preparedBy],
    ['Tools used', (meta.toolsUsed || []).join(' · ')],
    ['Contents', contentsLabel(packet)],
  ].filter(([, v]) => v);

  return `<section class="cover">
    ${meta.logoDataUrl ? `<img class="logo" src="${esc(meta.logoDataUrl)}" alt="">` : ''}
    ${meta.clientName ? `<p class="kicker">Prepared for</p><p class="client">${esc(meta.clientName)}</p>` : ''}
    <h1>${esc(meta.title || 'Client packet')}</h1>
    <div class="accent"></div>
    ${meta.summary ? `<p class="summary">${esc(meta.summary)}</p>` : ''}
    <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
  </section>`;
}

function contentsLabel(packet) {
  const n = packet.threads.length;
  const m = packet.threads.reduce((a, t) => a + includedMessages(t).length, 0);
  return `${n} thread${n === 1 ? '' : 's'} · ${m} message${m === 1 ? '' : 's'}`;
}

function toc(threads) {
  return `<section class="toc"><h2>Contents</h2><ol>${
    threads.map((t) => `<li><span>${esc(t.title)}</span><em>${esc(t.vendorLabel)}</em></li>`).join('')
  }</ol></section>`;
}

function message(msg, meta) {
  const label = msg.role === 'user' ? (meta.userLabel || 'Prompt') : (meta.assistantLabel || 'Response');
  return `<article class="msg ${esc(msg.role)}">
    <p class="role">${esc(label)}</p>
    ${blocksToHtml(msg.blocks)}
  </article>`;
}

export function blocksToHtml(blocks) {
  return (blocks || []).map((b) => {
    switch (b.type) {
      case 'heading': return `<h${b.level + 2}>${spans(b.spans)}</h${b.level + 2}>`;
      case 'paragraph': return `<p>${spans(b.spans)}</p>`;
      case 'list': return list(b);
      case 'code': return `<pre${b.language ? ` data-lang="${esc(b.language)}"` : ''}><code>${esc(b.code)}</code></pre>`;
      case 'quote': return `<blockquote>${blocksToHtml(b.blocks)}</blockquote>`;
      case 'table': return table(b);
      case 'rule': return '<hr>';
      default: return '';
    }
  }).join('');
}

function list(block) {
  // The extractor flattens nesting into a depth field; rebuild it for display.
  const root = [];
  const stack = [{ depth: -1, children: root }];
  for (const item of block.items) {
    const depth = item.depth || 0;
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const node = { depth, spans: item.spans, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const tag = block.ordered ? 'ol' : 'ul';
  const render = (nodes) => `<${tag}>${nodes.map(
    (n) => `<li>${spans(n.spans)}${n.children.length ? render(n.children) : ''}</li>`,
  ).join('')}</${tag}>`;
  return render(root);
}

function table(block) {
  const head = block.head.length
    ? `<thead>${block.head.map((r) => `<tr>${r.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</thead>`
    : '';
  const body = `<tbody>${block.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  return `<table>${head}${body}</table>`;
}

function spans(list_) {
  return (list_ || []).map((s) => {
    let html = esc(s.text).replace(/\n/g, '<br>');
    if (s.code) html = `<code>${html}</code>`;
    if (s.bold) html = `<strong>${html}</strong>`;
    if (s.italic) html = `<em>${html}</em>`;
    if (s.href) html = `<a href="${esc(s.href)}" rel="noreferrer nofollow">${html}</a>`;
    return html;
  }).join('');
}

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const CSS = `
*{box-sizing:border-box}
body{margin:0;background:#eceef2;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#16181d;position:relative}
main{max-width:760px;margin:0 auto;padding:28px 16px 60px}
section{background:#fff;padding:44px 52px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-radius:3px}
.cover{min-height:420px;display:flex;flex-direction:column}
.logo{max-height:56px;max-width:230px;object-fit:contain;align-self:flex-start;margin-bottom:26px}
.kicker,.role,.src{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#6b7280;margin:0 0 4px}
.src{color:#2f5bd7}
.client{font-size:21px;font-weight:650;margin:0 0 26px}
.cover h1{font-size:30px;line-height:1.2;margin:0 0 14px;letter-spacing:-.02em}
.accent{width:92px;height:3px;background:#2f5bd7;margin-bottom:22px}
.summary{color:#6b7280;font-size:15px;margin:0}
.facts{margin:auto 0 0;padding-top:22px;border-top:1px solid #e3e6ec;display:grid;grid-template-columns:130px 1fr;gap:7px 0;font-size:13px}
.facts dt{font-size:10px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#6b7280;align-self:center}
.facts dd{margin:0}
.toc h2{font-size:19px;margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #e3e6ec}
.toc ol{margin:0;padding-left:20px}
.toc li{margin-bottom:9px}
.toc em{color:#6b7280;font-style:normal;font-size:12px;margin-left:8px}
.thread h2{font-size:21px;margin:0 0 6px;padding-bottom:12px;border-bottom:1px solid #e3e6ec;letter-spacing:-.01em}
.msg{margin-top:22px}
.msg.user .role{color:#6b7280}
h3,h4,h5,h6{margin:18px 0 6px;font-size:15px}
p{margin:0 0 10px}
ul,ol{margin:0 0 10px;padding-left:22px}
li{margin-bottom:4px}
pre{background:#f4f5f7;padding:12px 14px;border-radius:6px;overflow-x:auto;margin:0 0 12px;position:relative}
pre[data-lang]::before{content:attr(data-lang);position:absolute;top:5px;right:10px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#9aa1ad;font-weight:700}
code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
blockquote{margin:0 0 12px;padding-left:14px;border-left:2.5px solid #c9d2ea;color:#3d4350}
table{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:13px}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid #e3e6ec;vertical-align:top}
th{background:#f4f5f7;font-weight:650}
hr{border:0;border-top:1px solid #e3e6ec;margin:16px 0}
a{color:#2f5bd7}
.watermark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;
  font-size:64px;font-weight:800;color:rgba(22,24,29,.05);transform:rotate(-38deg);z-index:1;letter-spacing:.04em}
`;
