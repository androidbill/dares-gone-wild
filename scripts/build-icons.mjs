// Generates the PWA icons (public/icons/*.png) with zero image dependencies —
// draws a flame with metaballs on a dark magenta gradient and encodes PNG by hand.
// Run: `node scripts/build-icons.mjs`
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const mix = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// A flame is the convex hull of a circle (the fat base) and a point (the tip) — a
// teardrop. Metaballs won't do it: the base circle's field swallows the small tip
// circles and the whole thing rounds off into an egg.
function makeFlame(cx, cy, r, tipX, tipY) {
  const ux = tipX - cx;
  const uy = tipY - cy;
  const d = Math.hypot(ux, uy);
  // tangent point along the axis, and its half-width off the axis
  const at = (r * r) / d;
  const bt = r * Math.sqrt(Math.max(0, 1 - (r * r) / (d * d)));
  return { cx, cy, r, ux: ux / d, uy: uy / d, d, at, bt };
}

function inFlame(x, y, f) {
  const wx = x - f.cx;
  const wy = y - f.cy;
  if (wx * wx + wy * wy <= f.r * f.r) return true;      // the round base
  const a = wx * f.ux + wy * f.uy;                       // distance along the axis
  if (a < f.at || a > f.d) return false;
  const b = Math.abs(wx * f.uy - wy * f.ux);             // distance off the axis
  return b <= f.bt * (f.d - a) / (f.d - f.at);           // inside the tangent cone
}

function draw(size, maskable) {
  const S = size;
  const buf = Buffer.alloc(S * S * 4);
  // Maskable icons get cropped to a circle by the launcher, so shrink the art.
  const scale = maskable ? 0.72 : 1;
  const S0 = (v, mid) => mid + (v - mid) * scale; // shrink about the icon centre
  const outer = makeFlame(S0(0.475, 0.5), S0(0.655, 0.5), 0.205 * scale, S0(0.560, 0.5), S0(0.105, 0.5));
  const inner = makeFlame(S0(0.500, 0.5), S0(0.715, 0.5), 0.112 * scale, S0(0.545, 0.5), S0(0.375, 0.5));
  const ss = 3; // 3x3 supersampling for smooth edges

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // background: vertical gradient, dark magenta into near-black plum
      const t = y / S;
      let r = mix(46, 14, t);
      let g = mix(10, 5, t);
      let b = mix(50, 18, t);

      let outerCov = 0;
      let innerCov = 0;
      let fy = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = (x + (sx + 0.5) / ss) / S;
          const py = (y + (sy + 0.5) / ss) / S;
          if (inFlame(px, py, outer)) outerCov++;
          if (inFlame(px, py, inner)) innerCov++;
          fy += py;
        }
      }
      const n = ss * ss;
      outerCov /= n;
      innerCov /= n;
      fy /= n;

      if (outerCov > 0) {
        // hot at the base, brighter orange toward the tip
        const k = clamp01((0.72 - fy) / 0.46);
        const fr = mix(255, 255, k);
        const fg = mix(78, 168, k);
        const fb = mix(96, 92, k);
        r = mix(r, fr, outerCov);
        g = mix(g, fg, outerCov);
        b = mix(b, fb, outerCov);
      }
      if (innerCov > 0) {
        const k = clamp01((0.72 - fy) / 0.30);
        const ir = 255;
        const ig = mix(206, 245, k);
        const ib = mix(102, 190, k);
        r = mix(r, ir, innerCov);
        g = mix(g, ig, innerCov);
        b = mix(b, ib, innerCov);
      }

      const o = (y * S + x) * 4;
      buf[o] = Math.round(r);
      buf[o + 1] = Math.round(g);
      buf[o + 2] = Math.round(b);
      buf[o + 3] = 255;
    }
  }
  return buf;
}

const outDir = new URL('../public/icons/', import.meta.url);
mkdirSync(outDir, { recursive: true });

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const png = encodePNG(size, draw(size, maskable));
  writeFileSync(new URL(name, outDir), png);
  console.log(`Wrote public/icons/${name} (${png.length} bytes)`);
}
