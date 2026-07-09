// specSheetPage.js — composes one spec-sheet page (SVG string) in the Fabricut drawing
// style: engineering frame, one row per backplate shape, columns = wall-mount detail |
// front view | combo code | profile view. Pure layout: rows arrive pre-rendered
// (hidden-line segments + measures); this file only places, scales, and dimensions them.
import { fracSvg, fracSvgFromText } from './specSheetGeometry';

export const PAGE_W = 1100;
export const PAGE_H = 850;
const MARGIN = 28;
const SW = 0.6; // dimension line weight

const COL = { detail: 130, front: 430, code: 660, profile: 890 };
const BOX = { detail: [96, 60], front: [380, 42], profile: [230, 42] }; // [maxWpx, rowH inset]

export function dimH(x0, x1, y, inches) {
  let s = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x0}" y1="${y - 4}" x2="${x0}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg((x0 + x1) / 2 - 7, y - 5, inches);
  return s;
}
export function dimV(x, y0, y1, inches, dia = false) {
  let s = `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y0}" x2="${x + 4}" y2="${y0}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg(x + 7, (y0 + y1) / 2 + 4, inches, 11, dia);
  return s;
}
export function leaderDia(x, y, inches) {
  let s = `<line x1="${x}" y1="${y}" x2="${x + 24}" y2="${y - 16}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg(x + 26, y - 18, inches, 11, true);
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

// Fit a rendered view into a box at (cx, cy) with an EXPLICIT scale (px per world unit)
// so a column shares one scale across rows. Returns { mu, mv, mapping } where mapping
// carries everything needed to invert page → world coords for the manual dim tool.
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

// Shared column scale: the tightest fit across all rows keeps the column visually consistent.
function columnScale(rows, key, rowH) {
  const [maxW, inset] = BOX[key];
  let s = Infinity;
  for (const r of rows) {
    const zb = r[key]?.zb;
    if (!zb) continue;
    s = Math.min(s, maxW / (zb.maxU - zb.minU), (rowH - inset) / (zb.maxV - zb.minV));
  }
  return isFinite(s) ? s : 1;
}

// rows[i] = { rowKey, code, wallCode, front: {vis, zb}, profile: {vis, zb}, detail: {vis, zb}|null,
//             dims: { front: [...], profile: [...], detail: [...] } } — dim spec objects:
//   { t:'h', u0, u1, v, off? } | { t:'v', u, v0, v1, off?, dia? } | { t:'dia', u, v, val }
//   values in world units; inches computed from world span (×M2IN by the caller — dims carry `in`).
export function buildPageSvg({ title, subtitle, rows, manualDims = [], noteLines = [] }) {
  let svg = '';
  const viewMaps = []; // { rowKey, view, mapping } for the dim tool
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${PAGE_W - 2 * MARGIN}" height="${PAGE_H - 2 * MARGIN}" fill="none" stroke="black" stroke-width="1.5"/>`;
  for (let i = 1; i < 8; i++) {
    const x = MARGIN + ((PAGE_W - 2 * MARGIN) * i) / 8;
    svg += `<line x1="${x}" y1="${MARGIN}" x2="${x}" y2="${MARGIN - 8}" stroke="black"/><line x1="${x}" y1="${PAGE_H - MARGIN}" x2="${x}" y2="${PAGE_H - MARGIN + 8}" stroke="black"/>`;
    svg += `<text x="${x - (PAGE_W - 2 * MARGIN) / 16}" y="${MARGIN - 12}" font-size="10" text-anchor="middle">${9 - i}</text>`;
  }
  ['D', 'C', 'B', 'A'].forEach((z, i) => {
    const y = MARGIN + ((PAGE_H - 2 * MARGIN) * (i + 0.5)) / 4;
    svg += `<text x="${MARGIN - 16}" y="${y}" font-size="10" text-anchor="middle">${z}</text>`;
    svg += `<text x="${PAGE_W - MARGIN + 16}" y="${y}" font-size="10" text-anchor="middle">${z}</text>`;
  });
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 34}" font-size="13">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 50}" font-size="11" fill="#444">${subtitle}</text>`;

  const rowH = (PAGE_H - 2 * MARGIN - 90) / Math.max(rows.length, 1);
  const scales = {
    detail: columnScale(rows, 'detail', rowH),
    front: columnScale(rows, 'front', rowH),
    profile: columnScale(rows, 'profile', rowH),
  };

  const drawDims = (dims, mu, mv) => {
    let s = '';
    for (const d of dims || []) {
      if (d.t === 'h') s += dimH(mu(d.u0), mu(d.u1), mv(d.v) + (d.off || 0), d.in);
      else if (d.t === 'v') s += dimV(mu(d.u) + (d.off || 0), mv(d.v0), mv(d.v1), d.in, d.dia);
      else if (d.t === 'dia') s += leaderDia(mu(d.u), mv(d.v), d.in);
    }
    return s;
  };

  rows.forEach((r, i) => {
    const cy = MARGIN + 95 + rowH * i + rowH / 2;
    for (const key of ['detail', 'front', 'profile']) {
      const view = r[key];
      if (!view) continue;
      const { mu, mv, mapping } = place(view.zb, COL[key], cy, scales[key]);
      svg += segPaths(view.vis, mu, mv);
      svg += drawDims(r.dims?.[key], mu, mv);
      if (key === 'detail' && r.wallCode) {
        svg += `<text x="${COL.detail}" y="${mapping.rect[1] - 34}" font-size="10" text-anchor="middle">${r.wallCode}</text>`;
      }
      viewMaps.push({ rowKey: r.rowKey, view: key, mapping });
      // manual dims anchored to this row+view (world coords → this placement)
      for (const md of manualDims) {
        if (md.rowKey === r.rowKey && md.view === key) {
          svg += dimManual(mu(md.aU), mv(md.aV), mu(md.bU), mv(md.bV), md.value);
        }
      }
    }
    svg += `<text x="${COL.code}" y="${cy + 4}" font-size="12" text-anchor="middle">${r.code || ''}</text>`;
  });

  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 290}" y="${PAGE_H - MARGIN - 12 - (noteLines.length - 1 - i) * 14}" font-size="10">${line}</text>`;
  });

  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE_W} ${PAGE_H}" font-family="Helvetica, Arial, sans-serif"><rect width="${PAGE_W}" height="${PAGE_H}" fill="white"/>${svg}</svg>`;
  return { svg: doc, viewMaps };
}
