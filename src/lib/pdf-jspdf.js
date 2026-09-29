/**
 * jsPDF binding for the layout engine's draw ops. Browser-only: it expects the
 * UMD bundle in src/vendor to have put `jspdf` on the global.
 */
import { layoutPacket, paintPages, LETTER } from './pdf.js';
import { createFixedMeasurer } from './measure.js';

function resolveJsPdf(explicit) {
  const ctor = explicit
    || (typeof globalThis !== 'undefined' && globalThis.jspdf && globalThis.jspdf.jsPDF)
    || (typeof globalThis !== 'undefined' && globalThis.jsPDF);
  if (!ctor) throw new Error('jsPDF is not loaded');
  return ctor;
}

export function createJsPdfRenderer(doc) {
  let font = null;
  let size = null;
  let fill = null;
  let stroke = null;
  let lineWidth = null;

  const setFont = (f, style, s) => {
    const key = `${f}|${style}`;
    if (font !== key) { doc.setFont(f, style); font = key; }
    if (size !== s) { doc.setFontSize(s); size = s; }
  };

  return {
    doc,
    measure(text, f, s, style) {
      setFont(f, style || 'normal', s);
      return doc.getTextWidth(String(text));
    },
    addPage() { doc.addPage(); font = size = fill = stroke = lineWidth = null; },
    draw(op) {
      switch (op.op) {
        case 'text': {
          setFont(op.font, op.style || 'normal', op.size);
          doc.setTextColor(op.color || '#000000');
          const opts = {};
          if (op.align) opts.align = op.align;
          if (op.angle) opts.angle = op.angle;
          doc.text(String(op.text), op.x, op.y, opts);
          break;
        }
        case 'rect': {
          if (fill !== op.fill) { doc.setFillColor(op.fill); fill = op.fill; }
          if (op.radius) doc.roundedRect(op.x, op.y, op.w, op.h, op.radius, op.radius, 'F');
          else doc.rect(op.x, op.y, op.w, op.h, 'F');
          break;
        }
        case 'line': {
          if (stroke !== op.color) { doc.setDrawColor(op.color); stroke = op.color; }
          const w = op.width || 0.5;
          if (lineWidth !== w) { doc.setLineWidth(w); lineWidth = w; }
          doc.line(op.x1, op.y1, op.x2, op.y2);
          break;
        }
        case 'image':
          try {
            doc.addImage(op.dataUrl, undefined, op.x, op.y, op.w, op.h);
          } catch (err) {
            // A bad logo must not cost the user their whole packet.
            console.warn('PacketPress: could not place logo', err);
          }
          break;
        default:
          break;
      }
    },
  };
}

/** Builds the PDF and returns the jsPDF document. */
export function buildPdf(packet, options = {}) {
  const JsPDF = resolveJsPdf(options.jsPDF);
  const page = options.page || LETTER;
  const doc = new JsPDF({ unit: 'pt', format: [page.width, page.height], compress: true });
  const renderer = createJsPdfRenderer(doc);
  const measurer = options.measurer || renderer || createFixedMeasurer();
  const layout = layoutPacket(packet, measurer, { ...options, page });
  paintPages(layout, renderer);
  applyMetadata(doc, packet);
  return { doc, layout };
}

function applyMetadata(doc, packet) {
  const meta = packet.meta || {};
  try {
    doc.setProperties({
      title: meta.title || 'Client packet',
      subject: meta.clientName ? `Prepared for ${meta.clientName}` : '',
      author: meta.preparedBy || '',
      keywords: (meta.toolsUsed || []).join(', '),
      creator: 'PacketPress',
    });
  } catch {
    // setProperties is cosmetic; never fail an export over it.
  }
}
