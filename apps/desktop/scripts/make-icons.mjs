// Generates the app and tray icons without any image tooling:
// shapes are drawn with signed-distance anti-aliasing and encoded as PNG.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const sdRoundRect = (px, py, cx, cy, hw, hh, r) => {
  const qx = Math.abs(px - cx) - hw + r;
  const qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cover = (d, aa) => Math.max(0, Math.min(1, 0.5 - d / aa));

function draw(size, shapesAt) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 3; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;
          const [cr, cg, cb, ca] = shapesAt(u, v, 1 / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      buf[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
    }
  }
  return png(size, size, buf);
}

function over(dst, src) {
  const [dr, dg, db, da] = dst;
  const [sr, sg, sb, sa] = src;
  const a = sa + da * (1 - sa);
  if (a === 0) return [0, 0, 0, 0];
  return [
    (sr * sa + dr * da * (1 - sa)) / a,
    (sg * sa + dg * da * (1 - sa)) / a,
    (sb * sa + db * da * (1 - sa)) / a,
    a,
  ];
}

// [y center, width] of the three note lines.
const LINES = [
  [0.36, 0.42],
  [0.5, 0.32],
  [0.64, 0.22],
];

/** Colored app/tray icon: indigo tile, three note lines, optional red dot. */
function appIcon(dot) {
  return (u, v, px) => {
    let c = [0, 0, 0, 0];
    const tile = sdRoundRect(u, v, 0.5, 0.5, 0.41, 0.41, 0.2);
    if (tile < px * 2) {
      const t = v;
      c = over(c, [
        99 + (67 - 99) * t,
        102 + (56 - 102) * t,
        241 + (202 - 241) * t,
        cover(tile, px * 1.2),
      ]);
    }
    for (const [cy, w] of LINES) {
      const d = sdRoundRect(u, v, 0.29 + w / 2, cy, w / 2, 0.036, 0.036);
      c = over(c, [255, 255, 255, cover(d, px * 1.2) * (tile < 0 ? 1 : 0)]);
    }
    if (dot) {
      const d = Math.hypot(u - 0.73, v - 0.3) - 0.1;
      const ring = Math.hypot(u - 0.73, v - 0.3) - 0.14;
      c = over(c, [255, 255, 255, cover(ring, px * 1.2)]);
      c = over(c, [229, 72, 77, cover(d, px * 1.2)]);
    }
    return c;
  };
}

/** macOS template tray icon: black glyph with alpha; the system tints it. */
function templateIcon(dot) {
  return (u, v, px) => {
    let a = 0;
    for (const [cy, w] of LINES)
      a = Math.max(
        a,
        cover(sdRoundRect(u, v, 0.12 + (w * 1.7) / 2, cy, (w * 1.7) / 2, 0.065, 0.065), px),
      );
    if (dot) a = Math.max(a, cover(Math.hypot(u - 0.8, v - 0.28) - 0.16, px));
    return [0, 0, 0, a];
  };
}

function write(rel, data) {
  const file = join(root, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  console.log('wrote', rel);
}

write('build/icon.png', draw(1024, appIcon(false)));
write('resources/icon.png', draw(512, appIcon(false)));
write('resources/tray.png', draw(32, appIcon(false)));
write('resources/tray-recording.png', draw(32, appIcon(true)));
write('resources/trayTemplate.png', draw(22, templateIcon(false)));
write('resources/trayTemplate@2x.png', draw(44, templateIcon(false)));
write('resources/trayRecordingTemplate.png', draw(22, templateIcon(true)));
write('resources/trayRecordingTemplate@2x.png', draw(44, templateIcon(true)));
