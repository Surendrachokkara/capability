/**
 * Generates the extension icon set as flat PNGs (no design-tool dependency).
 * The mark is a document sheet over the accent square: the packet, not a chat
 * bubble, because the packet is what the product makes.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const ACCENT = [47, 91, 215];
const SHEET = [255, 255, 255];
const LINE = [47, 91, 215];

function render(size) {
  const px = (x, y) => (y * size + x) * 4;
  const buf = new Uint8Array(size * size * 4);
  const r = size * 0.22; // corner radius of the tile

  const sheetX0 = size * 0.26;
  const sheetX1 = size * 0.74;
  const sheetY0 = size * 0.20;
  const sheetY1 = size * 0.80;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = px(x, y);
      if (!insideRounded(x, y, size, r)) continue; // transparent outside the tile
      set(buf, i, ACCENT, 255);

      if (x >= sheetX0 && x < sheetX1 && y >= sheetY0 && y < sheetY1) {
        set(buf, i, SHEET, 255);
      }
    }
  }

  // Three text lines on the sheet, sized relative to the icon.
  const lines = [0.34, 0.46, 0.58];
  const lineH = Math.max(1, Math.round(size * 0.055));
  for (const ly of lines) {
    const y0 = Math.round(size * ly);
    const short = ly === 0.58;
    const x1 = short ? size * 0.56 : size * 0.66;
    for (let y = y0; y < y0 + lineH; y += 1) {
      for (let x = Math.round(size * 0.34); x < x1; x += 1) {
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        set(buf, px(x, y), LINE, 255);
      }
    }
  }
  return buf;
}

function insideRounded(x, y, size, r) {
  const cx = Math.min(Math.max(x + 0.5, r), size - r);
  const cy = Math.min(Math.max(y + 0.5, r), size - r);
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= r * r;
}

function set(buf, i, [r, g, b], a) {
  buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
}

/* ------------------------------------------------------------- PNG encoder */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // truecolour + alpha
  // filter/compression/interlace default to 0

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(new URL('../src/icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = new URL(`../src/icons/icon${size}.png`, import.meta.url);
  writeFileSync(file, encodePng(render(size), size));
  console.log(`wrote src/icons/icon${size}.png`);
}
