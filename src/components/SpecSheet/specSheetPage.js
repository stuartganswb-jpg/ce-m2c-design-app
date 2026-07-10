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

// fit-mode letter layout (row-centered columns)
const COL_FIT = { detail: 130, front: 430, code: 660, profile: 890 };
const BOX_FIT = { detail: [96, 60], front: [380, 42], profile: [230, 42] }; // [maxWpx, rowH inset]
// 1:1 tabloid layout: detail column returns, profile takes the right side
const COL_ACTUAL = { detail: 170, front: 560, code: 560, profile: 1290 };

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

// Shared fit-mode column scale: tightest fit across rows, capped at letter 1:1.
function columnScale(rows, key, rowH) {
  const [maxW, inset] = BOX_FIT[key];
  let s = Infinity;
  for (const r of rows) {
    const zb = r[key]?.zb;
    if (!zb) continue;
    s = Math.min(s, maxW / (zb.maxU - zb.minU), (rowH - inset) / (zb.maxV - zb.minV));
  }
  return isFinite(s) ? Math.min(s, SCALE_1TO1) : 1;
}

function pageFrame(P, title, subtitle) {
  let svg = '';
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${P.W - 2 * MARGIN}" height="${P.H - 2 * MARGIN}" fill="none" stroke="black" stroke-width="1.5"/>`;
  for (let i = 1; i < 8; i++) {
    const x = MARGIN + ((P.W - 2 * MARGIN) * i) / 8;
    svg += `<line x1="${x}" y1="${MARGIN}" x2="${x}" y2="${MARGIN - 8}" stroke="black"/><line x1="${x}" y1="${P.H - MARGIN}" x2="${x}" y2="${P.H - MARGIN + 8}" stroke="black"/>`;
    svg += `<text x="${x - (P.W - 2 * MARGIN) / 16}" y="${MARGIN - 12}" font-size="10" text-anchor="middle">${9 - i}</text>`;
  }
  ['D', 'C', 'B', 'A'].forEach((z, i) => {
    const y = MARGIN + ((P.H - 2 * MARGIN) * (i + 0.5)) / 4;
    svg += `<text x="${MARGIN - 16}" y="${y}" font-size="10" text-anchor="middle">${z}</text>`;
    svg += `<text x="${P.W - MARGIN + 16}" y="${y}" font-size="10" text-anchor="middle">${z}</text>`;
  });
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 34}" font-size="13">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 50}" font-size="11" fill="#444">${subtitle}</text>`;
  return svg;
}

const wrapSvg = (P, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.W} ${P.H}" font-family="Helvetica, Arial, sans-serif"><rect width="${P.W}" height="${P.H}" fill="white"/>${inner}</svg>`;

// rows[i] = { rowKey, code, wallCode, front, profile, detail, dims } — dim specs:
//   { t:'h', u0, u1, v, off? } | { t:'v', u, v0, v1, off?, side?, ldy?, dia? } | { t:'dia', u, v, val, dir? }
export function buildPageSvg({ title, subtitle, rows, manualDims = [], noteLines = [], scaleMode = 'fit', paper, footerNote }) {
  const actual = scaleMode === 'actual';
  const P = PAPERS[paper || (actual ? 'tabloid' : 'letter')];
  const oneToOne = scaleForPaper(paper || (actual ? 'tabloid' : 'letter'));
  let svg = pageFrame(P, title, subtitle);
  const viewMaps = [];

  const rowH = (P.H - 2 * MARGIN - 90) / Math.max(rows.length, 1);
  const scales = actual
    ? { detail: oneToOne, front: oneToOne, profile: oneToOne }
    : {
      detail: columnScale(rows, 'detail', rowH),
      front: columnScale(rows, 'front', rowH),
      profile: columnScale(rows, 'profile', rowH),
    };
  const cols = actual ? COL_ACTUAL : COL_FIT;

  const drawDims = (dims, mu, mv) => {
    let s = '';
    for (const d of dims || []) {
      if (d.t === 'h') s += dimH(mu(d.u0), mu(d.u1), mv(d.v) + (d.off || 0), d.in);
      else if (d.t === 'v') s += dimV(mu(d.u) + (d.off || 0), mv(d.v0), mv(d.v1), d.in, d.dia, d.side || 1, d.ldy || 0);
      else if (d.t === 'dia') s += leaderDia(mu(d.u), mv(d.v), d.in, d.dir || 1);
    }
    return s;
  };

  // actual mode: rows stack by their real content height; fit mode: equal rows
  let cursor = MARGIN + 78;
  rows.forEach((r, i) => {
    let cy, rowBottom;
    if (actual) {
      const hPx = ((r.front.zb.maxV - r.front.zb.minV) * scales.front) + 76; // dims + code padding
      cy = cursor + hPx / 2;
      rowBottom = cursor + hPx;
      cursor = rowBottom;
    } else {
      cy = MARGIN + 95 + rowH * i + rowH / 2;
      rowBottom = MARGIN + 95 + rowH * (i + 1);
    }
    let frontBottom = cy;
    for (const key of ['detail', 'front', 'profile']) {
      const view = r[key];
      if (!view) continue;
      const { mu, mv, mapping } = place(view.zb, cols[key], cy, scales[key]);
      svg += segPaths(view.vis, mu, mv);
      svg += drawDims(r.dims?.[key], mu, mv);
      if (key === 'detail' && r.wallCode) {
        svg += `<text x="${cols.detail}" y="${mapping.rect[1] - 34}" font-size="10" text-anchor="middle">${r.wallCode}</text>`;
      }
      if (key === 'front') frontBottom = mapping.rect[1] + mapping.rect[3];
      viewMaps.push({ rowKey: r.rowKey, view: key, mapping });
      for (const md of manualDims) {
        if (md.rowKey === r.rowKey && md.view === key) {
          svg += dimManual(mu(md.aU), mv(md.aV), mu(md.bU), mv(md.bV), md.value);
        }
      }
    }
    if (actual) {
      const yUnder = frontBottom + 24;
      if (yUnder < P.H - MARGIN - 34) svg += `<text x="${cols.code}" y="${yUnder}" font-size="12" text-anchor="middle">${r.code || ''}</text>`;
      else svg += `<text x="${MARGIN + 55}" y="${P.H - MARGIN - 16}" font-size="12">${r.code || ''}</text>`;
    } else svg += `<text x="${cols.code}" y="${cy + 4}" font-size="12" text-anchor="middle">${r.code || ''}</text>`;
  });

  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 290}" y="${P.H - MARGIN - 12 - (noteLines.length - 1 - i) * 14}" font-size="10">${line}</text>`;
  });
  const footer = footerNote || (actual ? `SCALE 1:1 ON ${P.label} LANDSCAPE (0.25" margins, print at 100%)` : '');
  if (footer) svg += `<text x="${P.W - MARGIN - 8}" y="${P.H - MARGIN - 12}" font-size="10" text-anchor="end">${footer}</text>`;

  return { svg: wrapSvg(P, svg), viewMaps, paper: paper || (actual ? 'tabloid' : 'letter') };
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
