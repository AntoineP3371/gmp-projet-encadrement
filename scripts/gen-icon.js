'use strict';

/* Generates the app icon (build/icon.ico + build/icon.png) from hand-drawn
   shapes — no fonts, no native deps (pngjs + to-ico are pure JS). Also has a
   --preview mode used once to compare concepts before picking one (see
   scripts/gen-icon-preview.js). Run: node scripts/gen-icon.js [concept] */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const toIco = require('to-ico');

/* ---------------- tiny raster toolkit ---------------- */
function canvas(size) {
  const png = new PNG({ width: size, height: size });
  png.data.fill(0); // transparent
  return png;
}
function setPx(img, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (img.width * y + x) << 2;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function fillRect(img, x0, y0, x1, y1, color) {
  const [r, g, b] = hex(color);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) setPx(img, x, y, r, g, b, 255);
  }
}
function inRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const left = px < x0 + r, right = px > x1 - r, top = py < y0 + r, bottom = py > y1 - r;
  const d = (cx, cy) => Math.hypot(px - cx, py - cy);
  if (left && top) return d(x0 + r, y0 + r) <= r;
  if (right && top) return d(x1 - r, y0 + r) <= r;
  if (left && bottom) return d(x0 + r, y1 - r) <= r;
  if (right && bottom) return d(x1 - r, y1 - r) <= r;
  return true;
}
function fillRoundedRect(img, x0, y0, x1, y1, r, color) {
  const [cr, cg, cb] = hex(color);
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      if (inRoundedRect(x + 0.5, y + 0.5, x0, y0, x1, y1, r)) setPx(img, x, y, cr, cg, cb, 255);
    }
  }
}
function fillCircle(img, cx, cy, r, color) {
  const [cr, cg, cb] = hex(color);
  for (let y = Math.floor(cy - r); y < Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x < Math.ceil(cx + r); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) setPx(img, x, y, cr, cg, cb, 255);
    }
  }
}
function distSeg(px, py, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = x0 + t * dx, cy = y0 + t * dy;
  return Math.hypot(px - cx, py - cy);
}
function strokeLine(img, x0, y0, x1, y1, thick, color) {
  const [cr, cg, cb] = hex(color);
  const minX = Math.floor(Math.min(x0, x1) - thick), maxX = Math.ceil(Math.max(x0, x1) + thick);
  const minY = Math.floor(Math.min(y0, y1) - thick), maxY = Math.ceil(Math.max(y0, y1) + thick);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (distSeg(x + 0.5, y + 0.5, x0, y0, x1, y1) <= thick / 2) setPx(img, x, y, cr, cg, cb, 255);
    }
  }
}

/* ---------------- icon concepts (drawn proportionally, any size) ---------------- */
const BLUE = '#2563eb';
const NAVY = '#1e3a8a';
const GREEN = '#16a34a';
const WHITE = '#ffffff';
const SLATE = '#cbd5e1';

function bg(img, s) { fillRoundedRect(img, 0, 0, s, s, s * 0.22, BLUE); }

function conceptCalendar(s) {
  const img = canvas(s);
  bg(img, s);
  // binder rings
  fillRoundedRect(img, s * 0.30, s * 0.10, s * 0.38, s * 0.30, s * 0.03, NAVY);
  fillRoundedRect(img, s * 0.62, s * 0.10, s * 0.70, s * 0.30, s * 0.03, NAVY);
  // plate
  const px0 = s * 0.16, py0 = s * 0.22, px1 = s * 0.84, py1 = s * 0.84, pr = s * 0.06;
  fillRoundedRect(img, px0, py0, px1, py1, pr, WHITE);
  // header band (clip to plate rounding by drawing slightly inset + rounded top only via rect is fine visually)
  fillRect(img, px0, py0, px1, py0 + (py1 - py0) * 0.24, NAVY);
  fillRoundedRect(img, px0, py0, px1, py0 + (py1 - py0) * 0.30, pr, NAVY);
  fillRect(img, px0, py0 + (py1 - py0) * 0.20, px1, py0 + (py1 - py0) * 0.30, NAVY);
  // checkmark
  const cx = (px0 + px1) / 2, cy = py0 + (py1 - py0) * 0.62;
  const t = s * 0.09;
  strokeLine(img, cx - s * 0.16, cy, cx - s * 0.03, cy + s * 0.13, t, GREEN);
  strokeLine(img, cx - s * 0.03, cy + s * 0.13, cx + s * 0.20, cy - s * 0.13, t, GREEN);
  return img;
}

function conceptGrid(s) {
  const img = canvas(s);
  bg(img, s);
  const px0 = s * 0.18, py0 = s * 0.18, px1 = s * 0.82, py1 = s * 0.82;
  fillRoundedRect(img, px0, py0, px1, py1, s * 0.06, WHITE);
  const pad = s * 0.06;
  const gx0 = px0 + pad, gy0 = py0 + pad, gx1 = px1 - pad, gy1 = py1 - pad;
  const n = 3;
  const gap = s * 0.035;
  const cw = (gx1 - gx0 - gap * (n - 1)) / n;
  const ch = (gy1 - gy0 - gap * (n - 1)) / n;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const x0 = gx0 + c * (cw + gap), y0 = gy0 + r * (ch + gap);
      const hit = (r === 1 && c === 1);
      fillRoundedRect(img, x0, y0, x0 + cw, y0 + ch, s * 0.02, hit ? GREEN : SLATE);
    }
  }
  return img;
}

function conceptClipboard(s) {
  const img = canvas(s);
  bg(img, s);
  const px0 = s * 0.20, py0 = s * 0.16, px1 = s * 0.80, py1 = s * 0.86;
  fillRoundedRect(img, px0, py0, px1, py1, s * 0.05, WHITE);
  fillRoundedRect(img, s * 0.38, s * 0.09, s * 0.62, s * 0.20, s * 0.03, NAVY);
  const lineX0 = px0 + s * 0.08, lineX1 = px1 - s * 0.08;
  const rows = [0.36, 0.52, 0.68];
  rows.forEach((ry, i) => {
    const y = py0 + (py1 - py0) * ry;
    fillRoundedRect(img, lineX0, y - s * 0.025, lineX0 + s * 0.09, y + s * 0.025, s * 0.02, i === 1 ? GREEN : SLATE);
    fillRoundedRect(img, lineX0 + s * 0.14, y - s * 0.02, lineX1, y + s * 0.02, s * 0.015, SLATE);
  });
  return img;
}

function conceptMonogram(s) {
  const img = canvas(s);
  bg(img, s);
  const t = s * 0.10; // stroke thickness
  // E
  const ex0 = s * 0.20, ex1 = s * 0.44, ey0 = s * 0.28, ey1 = s * 0.72;
  fillRect(img, ex0, ey0, ex0 + t, ey1, WHITE);
  fillRect(img, ex0, ey0, ex1, ey0 + t, WHITE);
  fillRect(img, ex0, (ey0 + ey1) / 2 - t / 2, ex1 - s * 0.04, (ey0 + ey1) / 2 + t / 2, WHITE);
  fillRect(img, ex0, ey1 - t, ex1, ey1, WHITE);
  // P
  const px0 = s * 0.52, py0 = s * 0.28, py1 = s * 0.72, pw = s * 0.24;
  fillRect(img, px0, py0, px0 + t, py1, WHITE);
  fillRoundedRect(img, px0, py0, px0 + pw, py0 + (py1 - py0) * 0.55, t * 0.9, WHITE);
  // punch the inner hole of the P bowl
  const bowlR = (py0 + (py1 - py0) * 0.55 - py0) / 2 - t * 0.55;
  fillCircle(img, px0 + pw / 2 + t * 0.15, py0 + (py1 - py0) * 0.275, Math.max(1, bowlR), BLUE);
  return img;
}

const CONCEPTS = {
  calendar: conceptCalendar,
  grid: conceptGrid,
  clipboard: conceptClipboard,
  monogram: conceptMonogram
};

function savePNG(img, file) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    img.pack().pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

async function buildFinal(conceptName) {
  const draw = CONCEPTS[conceptName];
  if (!draw) throw new Error('unknown concept: ' + conceptName);
  const buildDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = [];
  for (const s of sizes) {
    const img = draw(s);
    const buf = PNG.sync.write(img);
    buffers.push(buf);
    if (s === 256) fs.writeFileSync(path.join(buildDir, 'icon.png'), buf);
  }
  const ico = await toIco(buffers);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('wrote build/icon.ico + build/icon.png (concept: ' + conceptName + ')');
}

if (require.main === module) {
  const concept = process.argv[2] || 'calendar';
  buildFinal(concept).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { CONCEPTS, canvas, savePNG, fillRect, fillRoundedRect, fillCircle, strokeLine, buildFinal };
