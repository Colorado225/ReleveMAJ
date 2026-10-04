/*
 * Génère les icônes PWA sans dépendance externe.
 * Usage : node scripts/generate-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/**
 * Icône : pastille gris anthracite (#111827) avec la lettre C blanche,
 * cohérente avec le logo affiché dans l'application.
 */
function renderPng(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // marge plus large pour l'icône maskable (zone sûre du système)
  const pad = maskable ? size * 0.2 : size * 0.07;
  const outer = size / 2 - pad;
  const ringRadius = size * 0.21;
  const ringThickness = size * 0.06;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx + 0.5;
      const dy = y - cy + 0.5;
      const r = Math.hypot(dx, dy);

      if (r > outer) {
        px[i + 3] = 0; // transparent hors pastille
        continue;
      }

      px[i] = 17;
      px[i + 1] = 24;
      px[i + 2] = 39;
      px[i + 3] = 255;

      // lettre C : anneau ouvert à droite
      const onRing = Math.abs(r - ringRadius) < ringThickness;
      const angle = Math.atan2(dy, dx);
      const isGap = angle > -1.15 && angle < 1.15;
      if (onRing && !isGap) {
        px[i] = 255;
        px[i + 1] = 255;
        px[i + 2] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filtre None
    px.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(process.cwd(), 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable.png', 512, true],
  ['apple-touch-icon.png', 180, false],
];

for (const [name, size, maskable] of targets) {
  const buf = renderPng(size, { maskable });
  writeFileSync(path.join(outDir, name), buf);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${buf.length} octets`);
}