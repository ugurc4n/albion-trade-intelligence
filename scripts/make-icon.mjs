/**
 * Draws the app icon (electron/build/icon.png, 512×512) without any image library: a violet cut-corner
 * tile with a white "A" mark and a cyan bar — the same shapes as the in-app brand. Run once: npm run icon
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";

const S = 512;
const px = new Uint8Array(S * S * 4);

const VIOLET = [124, 108, 255];
const WHITE = [255, 255, 255];
const CYAN = [34, 211, 238];

function inTile(x, y) {
  const m = 24; // outer margin
  const c = 92; // chamfer
  if (x < m || y < m || x >= S - m || y >= S - m) return false;
  const lx = x - m;
  const ly = y - m;
  const w = S - 2 * m;
  if (lx + ly < c) return false; // top-left cut
  if (w - 1 - lx + (w - 1 - ly) < c) return false; // bottom-right cut
  return true;
}

function distToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// "A": two legs and a crossbar, drawn as thick strokes; a cyan underline below.
const legs = [
  [256, 120, 150, 380],
  [256, 120, 362, 380],
];
const bar = [196, 290, 316, 290];
const STROKE = 26;

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (!inTile(x, y)) continue;
    let color = VIOLET;
    const onA = legs.some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) < STROKE) || distToSegment(x, y, ...bar) < STROKE * 0.8;
    if (onA) color = WHITE;
    if (y > 410 && y < 432 && x > 170 && x < 342) color = CYAN;
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = 255;
  }
}

// Minimal PNG encoder (RGBA, no interlace).
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0);
ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(process.cwd(), "electron", "build", "icon.png");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`Wrote ${out} (${png.length} bytes)`);
