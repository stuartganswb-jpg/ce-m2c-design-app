// specSheetPage.js — composes one spec-sheet page (SVG string) in the Fabricut drawing
// style. Layout is paper-aware:
//   letter  (8.5×11 landscape)  — 'fit' mode: compact 4-5 row pages, drawings scale to fit
//                                  (capped at 1:1 so nothing prints oversize).
//   tabloid (11×17 landscape)   — 'actual' mode: EVERYTHING at true 1:1 print scale;
//                                  wall-mount detail | front (rod broken) | code | profile,
//                                  rows stacked by their real content height.
// The tabloid master can also be printed reduced onto letter (~64%, footer marks it
// NOT TO SCALE) — same SVG, different output paper.
import { fracSvg, fracSvgFromText } from './specSheetGeometry';

export const PAPERS = {
  letter: { W: 1100, H: 850, printW: 10.5, printH: 8.0, label: '8.5×11' },
  tabloid: { W: 1700, H: 1100, printW: 16.5, printH: 10.5, label: '11×17' },
};
// page units per world meter such that printed output (inside 0.25" margins) is actual size
export const scaleForPaper = (paper) => (PAPERS[paper].W / PAPERS[paper].printW) / 0.0254;

// legacy exports (letter defaults) — display sizing + raster output still import these
export const PAGE_W = PAPERS.letter.W;
export const PAGE_H = PAPERS.letter.H;
export const SCALE_1TO1 = scaleForPaper('letter');

const MARGIN = 28;
const SW = 0.6; // dimension line weight

// ── TYPE SCALE (Stuart 2026-08-23) ───────────────────────────────────────────────────────────
// "the prints will be printed on 8.5x11, i am ok having it scale 1:1 at 11 x17 as long as the page
//  formats to print well at the reduced 8.5x11."
//
// That reduction is ~64%, and it is what decides the type size — not the 11×17 master. At 103 page
// units per printed inch, the old 10–12 unit text came out at 5–7pt on the tabloid and 3–4.5pt
// reduced, which is not readable. The hand-made sheets run ~11pt at 11×17 → ~7pt on letter, so the
// scale below targets that and everything on the page is sized from it.
const FS = { title: 17, sub: 13, code: 16, label: 13, dim: 14, note: 12, zone: 11 };
// Breathing room around a drawing, in page units, so dimension lines and their labels have
// somewhere to go. ~1/4" printed on either side.
const PAD = { x: 30, y: 26 };
const GUTTER = 34;      // between columns
const CODE_COL = 150;   // the code column carries text only — a fixed, generous width

export function dimH(x0, x1, y, inches) {
  let s = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x0}" y1="${y - 4}" x2="${x0}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg((x0 + x1) / 2 - 7, y - 5, inches);
  return s;
}
// side: +1 label right of the line (default), -1 label to the left (clear of artwork).
// labelDy: extra vertical label offset in page units (~26 = 1/4" printed on letter).
export function dimV(x, y0, y1, inches, dia = false, side = 1, labelDy = 0) {
  let s = `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y0}" x2="${x + 4}" y2="${y0}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg(side < 0 ? x - 34 : x + 7, (y0 + y1) / 2 + 4 + labelDy, inches, 11, dia);
  return s;
}
// dir +1: leader runs up-right, text right of it (default); -1: up-left, text to the left.
export function leaderDia(x, y, inches, dir = 1) {
  let s = `<line x1="${x}" y1="${y}" x2="${x + 24 * dir}" y2="${y - 16}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg(dir < 0 ? x - 24 - 46 : x + 26, y - 18, inches, 11, true);
  return s;
}
// Aligned manual dimension between two arbitrary page points, label = user text.
export function dimManual(x0, y0, x1, y1, valueText) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const tx = Math.cos(ang + Math.PI / 2) * 4, ty = Math.sin(ang + Math.PI / 2) * 4;
  let s = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x0 - tx}" y1="${y0 - ty}" x2="${x0 + tx}" y2="${y0 + ty}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x1 - tx}" y1="${y1 - ty}" x2="${x1 + tx}" y2="${y1 + ty}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvgFromText((x0 + x1) / 2 + 6, (y0 + y1) / 2 - 5, valueText);
  return s;
}

const segPaths = (vis, mu, mv) => {
  let p = '';
  for (const [u0, v0, u1, v1] of vis) {
    const X0 = mu(u0), Y0 = mv(v0), X1 = mu(u1), Y1 = mv(v1);
    if (Math.hypot(X1 - X0, Y1 - Y0) < 0.3) continue;
    p += `M${X0.toFixed(1)} ${Y0.toFixed(1)}L${X1.toFixed(1)} ${Y1.toFixed(1)}`;
  }
  return `<path d="${p}" stroke="black" stroke-width="0.7" fill="none" stroke-linecap="round"/>`;
};

// Place a rendered view centered at (cx, cy) at an explicit scale (px per world unit).
// mapping carries what the manual-dim tool needs to invert page → world coords.
function place(zb, cx, cy, scale) {
  const wWorld = zb.maxU - zb.minU, hWorld = zb.maxV - zb.minV;
  const x0 = cx - (wWorld * scale) / 2;
  const y0 = cy + (hWorld * scale) / 2;
  const mu = (u) => x0 + (u - zb.minU) * scale;
  const mv = (v) => y0 - (v - zb.minV) * scale;
  return {
    mu, mv,
    mapping: {
      x0, y0, scale, minU: zb.minU, minV: zb.minV,
      rect: [x0, y0 - hWorld * scale, wWorld * scale, hWorld * scale],
    },
  };
}

function pageFrame(P, title, subtitle) {
  let svg = '';
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${P.W - 2 * MARGIN}" height="${P.H - 2 * MARGIN}" fill="none" stroke="black" stroke-width="1.5"/>`;
  for (let i = 1; i < 8; i++) {
    const x = MARGIN + ((P.W - 2 * MARGIN) * i) / 8;
    svg += `<line x1="${x}" y1="${MARGIN}" x2="${x}" y2="${MARGIN - 8}" stroke="black"/><line x1="${x}" y1="${P.H - MARGIN}" x2="${x}" y2="${P.H - MARGIN + 8}" stroke="black"/>`;
    svg += `<text x="${x - (P.W - 2 * MARGIN) / 16}" y="${MARGIN - 12}" font-size="${FS.zone}" text-anchor="middle">${9 - i}</text>`;
  }
  ['D', 'C', 'B', 'A'].forEach((z, i) => {
    const y = MARGIN + ((P.H - 2 * MARGIN) * (i + 0.5)) / 4;
    svg += `<text x="${MARGIN - 16}" y="${y}" font-size="${FS.zone}" text-anchor="middle">${z}</text>`;
    svg += `<text x="${P.W - MARGIN + 16}" y="${y}" font-size="${FS.zone}" text-anchor="middle">${z}</text>`;
  });
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 36}" font-size="${FS.title}">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 56}" font-size="${FS.sub}" fill="#444">${subtitle}</text>`;
  return svg;
}

const wrapSvg = (P, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.W} ${P.H}" font-family="Helvetica, Arial, sans-serif"><rect width="${P.W}" height="${P.H}" fill="white"/>${inner}</svg>`;

// rows[i] = { rowKey, code, wallCode, front, profile, detail, dims } — dim specs:
//   { t:'h', u0, u1, v, off? } | { t:'v', u, v0, v1, off?, side?, ldy?, dia? } | { t:'dia', u, v, val, dir? }
// ── THE GRID IS MEASURED, NOT DECLARED (Stuart 2026-08-23) ───────────────────────────────────
// What was here: four fixed column centres (COL_FIT / COL_ACTUAL), fixed maximum widths per
// column, equal row heights, and — in fit mode — ONE SCALE PER COLUMN taken as the tightest fit
// across every row, so a single long rod drew every plate on the page tiny. A wide cell had
// nowhere to go and a narrow one left a hole.
//
// What is here now: every cell is measured at print scale, columns are as wide as their widest
// cell, rows as tall as their tallest, and the page shrinks UNIFORMLY (and says so) only if the
// result overflows the paper. Scale is a property of the page, not of a column — which is what
// makes 1:1 mean anything.
const CELL_KEYS = ['detail', 'front', 'code', 'profile'];

// Drawn size of one cell at a given scale, including the room its dimensions need.
const cellSize = (view, scale) => (view && view.zb && isFinite(view.zb.maxU))
  ? { w: (view.zb.maxU - view.zb.minU) * scale + PAD.x * 2, h: (view.zb.maxV - view.zb.minV) * scale + PAD.y * 2 }
  : { w: 0, h: 0 };

/** Column widths and row heights that fit the content, at `scale`. */
function measureGrid(rows, scale) {
  const colW = {};
  CELL_KEYS.forEach(k => { colW[k] = k === 'code' ? CODE_COL : 0; });
  const rowH = rows.map(r => {
    let h = 0;
    CELL_KEYS.forEach(k => {
      if (k === 'code') return;
      const { w, h: ch } = cellSize(r[k], scale);
      if (w > colW[k]) colW[k] = w;
      if (ch > h) h = ch;
    });
    return Math.max(h, 60);
  });
  const totalW = CELL_KEYS.reduce((a, k) => a + (colW[k] ? colW[k] + GUTTER : 0), -GUTTER);
  const totalH = rowH.reduce((a, h) => a + h, 0);
  return { colW, rowH, totalW, totalH };
}

// rows[i] = { rowKey, code, wallCode, front, profile, detail, dims } — dim specs:
//   { t:'h', u0, u1, v, off? } | { t:'v', u, v0, v1, off?, side?, ldy?, dia? } | { t:'dia', u, v, val, dir? }
export function buildPageSvg({ title, subtitle, rows, manualDims = [], noteLines = [], paper = 'tabloid', footerNote, bottomItems = [] }) {
  const P = PAPERS[paper] || PAPERS.tabloid;
  const oneToOne = scaleForPaper(paper || 'tabloid');
  const viewMaps = [];

  // Space the drawings may occupy, once the title block, the notes and the bottom strip are out.
  const bodyTop = MARGIN + 78;
  const bottomStripH = bottomItems.length ? 210 : 0;
  const notesH = noteLines.length * (FS.note + 4) + 18;
  const bodyH = P.H - MARGIN - bodyTop - bottomStripH - notesH;
  const bodyW = P.W - 2 * MARGIN - 80;

  // One scale for the page: true 1:1, reduced uniformly only if the content will not fit. A page
  // that had to shrink says so in the footer rather than quietly lying about being actual size.
  let scale = oneToOne;
  let grid = measureGrid(rows, scale);
  const shrink = Math.min(bodyW / (grid.totalW || 1), bodyH / (grid.totalH || 1), 1);
  if (shrink < 1) { scale = oneToOne * shrink; grid = measureGrid(rows, scale); }
  const toScale = shrink >= 0.999;

  let svg = pageFrame(P, title, subtitle);

  // Column centres, left to right, from the measured widths.
  const cx = {};
  let x = MARGIN + 40;
  CELL_KEYS.forEach(k => {
    if (!grid.colW[k]) return;
    cx[k] = x + grid.colW[k] / 2;
    x += grid.colW[k] + GUTTER;
  });

  const drawDims = (dims, mu, mv) => {
    let s2 = '';
    for (const d of dims || []) {
      if (d.t === 'h') s2 += dimH(mu(d.u0), mu(d.u1), mv(d.v) + (d.off || 0), d.in);
      else if (d.t === 'v') s2 += dimV(mu(d.u) + (d.off || 0), mv(d.v0), mv(d.v1), d.in, d.dia, d.side || 1, d.ldy || 0);
      else if (d.t === 'dia') s2 += leaderDia(mu(d.u), mv(d.v), d.in, d.dir || 1);
    }
    return s2;
  };

  // ── THE DRAWINGS FILL THE SHEET (Stuart 2026-08-23: "lots of dead white space") ───────────
  // Rows sized to content leave whatever is left over at the bottom, so a one-row or two-row page
  // hugged the title block with two thirds of the sheet blank. The slack is shared out between
  // the rows instead — the hand-made sheets space four rows evenly down the page, and this is the
  // same rule when there are fewer.
  const slack = Math.max(0, bodyH - grid.totalH);
  const lead = slack / (rows.length + 1);

  let cursor = bodyTop + lead;
  rows.forEach((r, i) => {
    const h = grid.rowH[i];
    const cy = cursor + h / 2;
    for (const key of CELL_KEYS) {
      if (key === 'code' || cx[key] === undefined) continue;
      const view = r[key];
      if (!view) continue;
      const { mu, mv, mapping } = place(view.zb, cx[key], cy, scale);
      svg += segPaths(view.vis, mu, mv);
      svg += drawDims(r.dims?.[key], mu, mv);
      if (key === 'detail' && r.wallCode) {
        svg += `<text x="${cx.detail}" y="${mapping.rect[1] - 16}" font-size="${FS.label}" text-anchor="middle">${r.wallCode}</text>`;
      }
      viewMaps.push({ rowKey: r.rowKey, view: key, mapping });
      for (const md of manualDims) {
        if (md.rowKey === r.rowKey && md.view === key) {
          svg += dimManual(mu(md.aU), mv(md.aV), mu(md.bU), mv(md.bV), md.value);
        }
      }
    }
    if (cx.code !== undefined && r.code) {
      svg += `<text x="${cx.code}" y="${cy + FS.code / 3}" font-size="${FS.code}" text-anchor="middle">${r.code}</text>`;
    }
    cursor += h + lead;
  });

  // ── EACH RING ON ITS OWN, ALONG THE BOTTOM (Stuart 2026-08-23) ─────────────────────────────
  // "then along the bottom you can show each ring on its own from the side." Was a two-item huddle
  // in the bottom-right corner; it is a strip across the page now, so a collection with four ring
  // options shows four.
  if (bottomItems.length) {
    const stripTop = P.H - MARGIN - notesH - bottomStripH;
    const cellW = (P.W - 2 * MARGIN - 80) / bottomItems.length;
    const baseCy = stripTop + bottomStripH / 2;
    svg += `<line x1="${MARGIN + 40}" y1="${stripTop}" x2="${P.W - MARGIN - 40}" y2="${stripTop}" stroke="#999" stroke-width="0.6"/>`;
    bottomItems.forEach((it, i) => {
      const bcx = MARGIN + 40 + cellW * i + cellW / 2;
      const { mu, mv, mapping } = place(it.view.zb, bcx, baseCy, scale);
      svg += segPaths(it.view.vis, mu, mv);
      const [bx, by, bw, bh] = mapping.rect;
      svg += `<text x="${bcx}" y="${stripTop + 20}" font-size="${FS.label}" text-anchor="middle">${it.code}</text>`;
      if (it.odIn) svg += leaderDia(bx + bw * 0.18, by + bh * 0.15, it.odIn, -1);
      if (it.hIn) svg += dimV(bx + bw + 12, by, by + bh, it.hIn);
    });
  }

  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 40}" y="${P.H - MARGIN - 14 - (noteLines.length - 1 - i) * (FS.note + 4)}" font-size="${FS.note}">${line}</text>`;
  });
  const footer = footerNote || (toScale
    ? `SCALE 1:1 ON ${P.label} LANDSCAPE (0.25" margins, print at 100%)`
    : `REDUCED ${Math.round(shrink * 100)}% TO FIT ${P.label} — NOT TO SCALE, READ THE DIMENSIONS`);
  svg += `<text x="${P.W - MARGIN - 8}" y="${P.H - MARGIN - 14}" font-size="${FS.note}" text-anchor="end">${footer}</text>`;

  return { svg: wrapSvg(P, svg), viewMaps, paper: paper || 'tabloid', toScale, scale };
}

// Generic 1:1 items-grid page — used for the wall-mounts reference and the finials catalog.
// items: [{ code, view, wIn, hIn, note? }] — each drawn face-on at actual size with W/H dims.
export function buildItemsGridPage({ title, subtitle, items = [], noteLines = [], paper = 'letter', footerNote, perRowOverride }) {
  const P = PAPERS[paper];
  const oneToOne = scaleForPaper(paper);
  let svg = '';
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${P.W - 2 * MARGIN}" height="${P.H - 2 * MARGIN}" fill="none" stroke="black" stroke-width="1.5"/>`;
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 34}" font-size="13">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 50}" font-size="11" fill="#444">${subtitle}</text>`;
  const perRow = perRowOverride || (paper === 'tabloid' ? 4 : 3);
  const cellW = (P.W - 2 * MARGIN - 80) / perRow;
  const cellH = (P.H - 2 * MARGIN - 110) / Math.max(1, Math.ceil(items.length / perRow));
  items.forEach((it, i) => {
    const cx = MARGIN + 40 + cellW * (i % perRow) + cellW / 2;
    const cy = MARGIN + 100 + cellH * Math.floor(i / perRow) + cellH / 2;
    const { mu, mv, mapping } = place(it.view.zb, cx, cy, oneToOne);
    svg += segPaths(it.view.vis, mu, mv);
    svg += `<text x="${cx}" y="${mapping.rect[1] - 30}" font-size="11" text-anchor="middle">${it.code}</text>`;
    const [bx, by, bw, bh] = mapping.rect;
    svg += dimH(bx, bx + bw, by - 12, it.wIn);
    svg += dimV(bx + bw + 12, by, by + bh, it.hIn);
    if (it.note) svg += `<text x="${cx}" y="${by + bh + 22}" font-size="9" text-anchor="middle">${it.note}</text>`;
  });
  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 40}" y="${P.H - MARGIN - 12 - (noteLines.length - 1 - i) * 14}" font-size="10">${line}</text>`;
  });
  svg += `<text x="${P.W - MARGIN - 8}" y="${P.H - MARGIN - 12}" font-size="10" text-anchor="end">${footerNote || `SCALE 1:1 ON ${P.label} LANDSCAPE (0.25" margins, print at 100%)`}</text>`;
  return { svg: wrapSvg(P, svg), viewMaps: [], paper };
}

// Dedicated wall-mounts reference page: every unique style at TRUE 1:1, face-on.
export function buildWallMountsPage({ title, items = [], noteLines = [], paper = 'letter', footerNote }) {
  return buildItemsGridPage({
    title,
    subtitle: 'All wall-mount styles at actual size — print at 100% and hold against the part.',
    items: items.map(it => ({ ...it, note: it.topHole ? `top hole ${it.topHole}" from top` : '' })),
    noteLines, paper, footerNote,
  });
}
