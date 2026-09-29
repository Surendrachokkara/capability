/** Dev-only: writes an HTML contact sheet of a sample packet's PDF layout. */
import { writeFileSync } from 'node:fs';
import { jsPDF } from 'jspdf';
import { buildPdf } from '../src/lib/pdf-jspdf.js';
import { samplePacket } from '../test/fixtures/sample-packet.js';
import { svgContactSheet } from './ops-to-svg.mjs';

const out = process.argv[2] || 'packet-preview.html';
// Build through jsPDF so the preview uses the same text metrics as the export.
const { layout } = buildPdf(samplePacket(), { jsPDF });
writeFileSync(out, svgContactSheet(layout, samplePacket().meta.title));
console.log(`wrote ${out} (${layout.pages.length} pages)`);
