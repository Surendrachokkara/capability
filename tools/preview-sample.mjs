/** Dev-only: writes an HTML contact sheet of a sample packet's PDF layout. */
import { writeFileSync } from 'node:fs';
import { layoutPacket } from '../src/lib/pdf.js';
import { createFixedMeasurer } from '../src/lib/measure.js';
import { samplePacket } from '../test/fixtures/sample-packet.js';
import { svgContactSheet } from './ops-to-svg.mjs';

const out = process.argv[2] || 'packet-preview.html';
const layout = layoutPacket(samplePacket(), createFixedMeasurer());
writeFileSync(out, svgContactSheet(layout, samplePacket().meta.title));
console.log(`wrote ${out} (${layout.pages.length} pages)`);
