/**
 * Dev-only: renders layout draw-ops to SVG so PDF layout can be eyeballed (and
 * diffed in CI screenshots) without a PDF rasterizer. Not shipped in the
 * extension; it reads the same op stream jsPDF consumes.
 */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FAMILY = { helvetica: 'Helvetica, Arial, sans-serif', courier: 'Courier, monospace', times: 'Georgia, serif' };

export function opsToSvg(layout) {
  const { page } = layout;
  return layout.pages.map((ops, i) => {
    const body = ops.map((op) => opToSvg(op)).join('\n');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" data-page="${i + 1}">
<rect width="100%" height="100%" fill="#fff"/>
${body}
</svg>`;
  });
}

function opToSvg(op) {
  if (op.op === 'rect') {
    const r = op.radius || 0;
    return `<rect x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" rx="${r}" fill="${op.fill}"/>`;
  }
  if (op.op === 'line') {
    return `<line x1="${op.x1}" y1="${op.y1}" x2="${op.x2}" y2="${op.y2}" stroke="${op.color}" stroke-width="${op.width || 0.5}"/>`;
  }
  if (op.op === 'image') {
    return `<image x="${op.x}" y="${op.y}" width="${op.w}" height="${op.h}" href="${op.dataUrl}"/>`;
  }
  if (op.op === 'text') {
    const anchor = op.align === 'center' ? 'middle' : op.align === 'right' ? 'end' : 'start';
    const weight = (op.style || '').includes('bold') ? 'bold' : 'normal';
    const italic = (op.style || '').includes('italic') ? 'italic' : 'normal';
    const rotate = op.angle ? ` transform="rotate(${-op.angle} ${op.x} ${op.y})"` : '';
    return `<text x="${op.x}" y="${op.y}" font-family="${FAMILY[op.font] || FAMILY.helvetica}" font-size="${op.size}" font-weight="${weight}" font-style="${italic}" fill="${op.color}" text-anchor="${anchor}" xml:space="preserve"${rotate}>${esc(op.text)}</text>`;
  }
  return '';
}

export function svgContactSheet(layout, title = 'PDF layout preview') {
  const pages = opsToSvg(layout)
    .map((svg, i) => `<figure><figcaption>page ${i + 1}</figcaption>${svg}</figure>`)
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{margin:24px;background:#e9ebef;font:13px system-ui}figure{margin:0 0 24px}figcaption{margin:0 0 6px;color:#555}
svg{box-shadow:0 2px 12px rgba(0,0,0,.18);background:#fff}</style>
<h1>${esc(title)}</h1>${pages}`;
}
