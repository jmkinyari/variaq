// Generates the PWA / home-screen icons (PNG) without image libraries: a plum tile with a white "N".
// Run: node scripts/make-icons.js   → public/icons/*.png
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PLUM = [0x70, 0x55, 0x6f], WHITE = [0xff, 0xfd, 0xfa];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, { radius, inset }) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const r = radius * size, pad = inset * size;
  // Letter N geometry in a unit box inside the safe zone.
  const box = { x0: pad + size * 0.27, x1: size - pad - size * 0.27, y0: pad + size * 0.25, y1: size - pad - size * 0.25 };
  const stroke = (box.x1 - box.x0) * 0.24;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // Rounded-rectangle tile (anti-aliasing kept simple: 2x2 supersampling at the corner edge).
      let cover = 0;
      for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const px = x + ox, py = y + oy;
        const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
        if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) cover++;
      }
      let col = PLUM, a = cover / 4;
      const inN = y >= box.y0 && y <= box.y1 && (
        (x >= box.x0 && x <= box.x0 + stroke) || (x >= box.x1 - stroke && x <= box.x1) ||
        (() => { const t = (y - box.y0) / (box.y1 - box.y0); const cx = box.x0 + stroke / 2 + t * (box.x1 - box.x0 - stroke); return Math.abs(x - cx) <= stroke * 0.62; })());
      if (inN && a > 0) col = WHITE;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2]; raw[o + 3] = Math.round(a * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(out, { recursive: true });
const files = [
  ["icon-192.png", 192, { radius: 0.22, inset: 0 }],
  ["icon-512.png", 512, { radius: 0.22, inset: 0 }],
  ["maskable-512.png", 512, { radius: 0, inset: 0.1 }], // full-bleed with safe-zone padding for Android masks
  ["apple-touch-icon.png", 180, { radius: 0, inset: 0 }], // iOS applies its own rounding
];
for (const [name, size, opts] of files) { fs.writeFileSync(path.join(out, name), png(size, opts)); console.log("wrote", name); }
