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
  // ⚠ PORTRAIT EXISTS BECAUSE FOUR-ROW SHEETS ARE BOUND BY HEIGHT (Stuart 2026-08-23: "we either
  // switch orientation away from landscape or fix the scaling"). Landscape 11×17 gives 10.5" of
  // drawing height; four plate-and-ring rows want about twenty. Portrait gives 16.5" — the same
  // sheet, turned — which is worth roughly a doubling of drawn size on exactly the pages that
  // are short of it. It costs width, which those pages were not using.
  tabloidP: { W: 1100, H: 1700, printW: 10.5, printH: 16.5, label: '11×17 portrait' },
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
// ⚠ PADDING IS CHARGED PER ROW, SO IT IS SPENT FOUR TIMES. At 26 units a side this was ~1/2"
// top and bottom of every row — over four rows, more than an inch of a ten-inch page before a
// single part is drawn. Trimmed hard; the dimensions carry their own offsets anyway.
const PAD = { x: 26, y: 10 };
const GUTTER = 34;      // between columns

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
// `datumV` (optional) is a world height that must land on cy — the shared datum that makes a row
// read across. Without it the cell is simply centred, as before.
function place(zb, cx, cy, scale, datumV = null) {
  const wWorld = zb.maxU - zb.minU, hWorld = zb.maxV - zb.minV;
  const x0 = cx - (wWorld * scale) / 2;
  const y0 = (datumV != null && isFinite(datumV))
    ? cy + (datumV - zb.minV) * scale
    : cy + (hWorld * scale) / 2;
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
// ⚠ 'code' IS NO LONGER A COLUMN. It used to be a strip of text between the elevation and the
// section, which left the part numbers floating in the middle of the sheet attached to nothing
// (Stuart 2026-08-23: "the pattern id's … currently floating by themselves"). They belong under
// the part they name, so they are drawn beneath the section instead — arm code and plate code
// together, because a row is that pairing.
const CELL_KEYS = ['detail', 'front', 'profile'];

// ── ONE DATUM PER ROW, SO THE COLUMNS READ ACROSS (Stuart 2026-08-23) ────────────────────────
// "maybe offset the vertical alignment of the bracket side view with the front view so
//  horizontally they agree more."
//
// Each cell used to be centred on its own bounding box, so the rod in the elevation and the rod
// in the section sat at whatever height their own extents put them — a row that does not line up
// is a row you cannot read across. Both views contain the rod, so its centreline is the datum:
// every cell in a row places that world height on the same page line, exactly as the reference
// sheets do.
const cellAboveBelow = (view, scale, datumV) => {
  if (!view || !view.zb || !isFinite(view.zb.maxU)) return { w: 0, above: 0, below: 0 };
  const zb = view.zb;
  const d = (datumV != null && isFinite(datumV)) ? datumV : (zb.minV + zb.maxV) / 2;
  return {
    w: (zb.maxU - zb.minU) * scale + PAD.x * 2,
    above: (zb.maxV - d) * scale + PAD.y,
    below: (d - zb.minV) * scale + PAD.y,
  };
};

/** Column widths and row heights that fit the content, at `scale`. */
function measureGrid(rows, scale) {
  const colW = {};
  CELL_KEYS.forEach(k => { colW[k] = 0; });
  const above = [], below = [];
  const rowH = rows.map(r => {
    // ⚠ A CAPTION BELONGS TO ITS CELL, NOT TO THE ROW. Ring ids hang under the ELEVATION; the arm
    // and plate codes sit under the SECTION. Adding both to the row's own depth charged the row
    // for text that is nowhere near its tallest cell — and the section is far shorter than the
    // elevation, so its codes fit in space the row already had. Charging the row twice for room
    // it did not need is what drove four-row sheets down to a third of size while single-row
    // sheets (H1-138BD, H1-138BE) looked right (Stuart 2026-08-23).
    const extra = {
      front: Number(r.padBelow) || 0,
      profile: ([r.armCode, r.code].filter(Boolean).length) * (FS.code + 3) + 6,
    };
    let a = 0, b = 0;
    CELL_KEYS.forEach(k => {
      const m = cellAboveBelow(r[k], scale, r.datum?.[k]);
      if (m.w > colW[k]) colW[k] = m.w;
      if (m.above > a) a = m.above;
      const cellBelow = m.below + (m.w ? (extra[k] || 0) : 0);
      if (cellBelow > b) b = cellBelow;
    });
    above.push(a); below.push(b);
    return Math.max(a + b, 60);
  });
  const totalW = CELL_KEYS.reduce((a, k) => a + (colW[k] ? colW[k] + GUTTER : 0), -GUTTER);
  const totalH = rowH.reduce((a, h) => a + h, 0);
  return { colW, rowH, above, below, totalW, totalH };
}

// rows[i] = { rowKey, code, wallCode, front, profile, detail, dims } — dim specs:
//   { t:'h', u0, u1, v, off? } | { t:'v', u, v0, v1, off?, side?, ldy?, dia? } | { t:'dia', u, v, val, dir? }
export function buildPageSvg({ title, subtitle, rows, manualDims = [], noteLines = [], paper = 'tabloid', footerNote }) {
  const P = PAPERS[paper] || PAPERS.tabloid;
  const oneToOne = scaleForPaper(paper || 'tabloid');
  const viewMaps = [];

  // Space the drawings may occupy, once the title block, the notes and the bottom strip are out.
  const bodyTop = MARGIN + 78;
  const notesH = noteLines.length * (FS.note + 4) + 18;
  // The bottom ring strip is gone (Stuart 2026-08-23): each ring is named where it hangs, so
  // the whole body height belongs to the rows.
  const bodyH = P.H - MARGIN - bodyTop - notesH;
  const bodyW = P.W - 2 * MARGIN - 80;

  // One scale for the page: true 1:1, reduced uniformly only if the content will not fit. A page
  // that had to shrink says so in the footer rather than quietly lying about being actual size.
  // ⚠ THE FIT HAS TO CONVERGE, NOT BE GUESSED ONCE. A row's height is partly GEOMETRY, which
  // shrinks with the scale, and partly TEXT — captions, dimension labels, the room they need —
  // which does not. Scaling once by bodyH/totalH therefore undershoots: the drawings get smaller,
  // the fixed part stays, and the last row still walks off the page (Stuart 2026-08-23: "the
  // lowest row is now off the page and there is tons of wasted white space"). Re-measuring after
  // each step converges in two or three passes and stops early once it fits.
  let scale = oneToOne;
  let grid = measureGrid(rows, scale);
  for (let i = 0; i < 6; i++) {
    if (grid.totalW <= bodyW && grid.totalH <= bodyH) break;
    const k = Math.min(bodyW / (grid.totalW || 1), bodyH / (grid.totalH || 1), 1);
    if (!isFinite(k) || k >= 0.999) break;
    scale *= k;
    grid = measureGrid(rows, scale);
  }
  const shrink = scale / oneToOne;
  const toScale = shrink >= 0.999;
  // WHICH CONSTRAINT BOUND THE FIT. Height and width shrink the page for completely different
  // reasons and want opposite fixes — a narrower elevation helps one and does nothing for the
  // other. Saying which is binding turns "it looks small" into a number that points somewhere.
  const bindW = grid.totalW / bodyW, bindH = grid.totalH / bodyH;
  const boundBy = toScale ? '' : (bindW >= bindH ? 'width' : 'height');

  let svg = pageFrame(P, title, subtitle);

  // Column centres, left to right, from the measured widths.
  // ── THE SECTION SITS OUT ON THE RIGHT (Stuart 2026-08-23) ──────────────────────────────────
  // "horizontally you can push the right row (side view) over to the right of the page quite a
  //  bit." Columns were packed left with a fixed gutter and whatever was left over sat as dead
  //  margin on the right. The leftover goes into the gap BEFORE the section instead, so the
  //  elevation keeps the left of the sheet and the section is out at the right where it reads as
  //  a separate view rather than a continuation of the drawing.
  const used = CELL_KEYS.reduce((a, k) => a + (grid.colW[k] ? grid.colW[k] + GUTTER : 0), -GUTTER);
  const spare = Math.max(0, bodyW - used);
  const cx = {};
  let x = MARGIN + 40;
  CELL_KEYS.forEach(k => {
    if (!grid.colW[k]) return;
    if (k === 'profile') x += spare;
    cx[k] = x + grid.colW[k] / 2;
    x += grid.colW[k] + GUTTER;
  });

  const drawDims = (dims, mu, mv) => {
    let s2 = '';
    for (const d of dims || []) {
      if (d.t === 'h') s2 += dimH(mu(d.u0), mu(d.u1), mv(d.v) + (d.off || 0), d.in);
      else if (d.t === 'v') s2 += dimV(mu(d.u) + (d.off || 0), mv(d.v0), mv(d.v1), d.in, d.dia, d.side || 1, d.ldy || 0);
      else if (d.t === 'dia') s2 += leaderDia(mu(d.u), mv(d.v), d.in, d.dir || 1);
      // A caption at a world point — the ring's pattern id, under the ring it names. `lead`
      // draws the thin leader back up to the part, so a label dropped clear of a crowded row is
      // still unambiguously attached to one ring.
      else if (d.t === 'text') {
        const x = mu(d.u), yTop = mv(d.v), y = yTop + (d.off || 0);
        if (d.lead) s2 += `<line x1="${x}" y1="${yTop + 2}" x2="${x}" y2="${y - FS.label + 2}" stroke="black" stroke-width="0.4"/>`;
        s2 += `<text x="${x}" y="${y}" font-size="${FS.label}" text-anchor="middle">${d.text}</text>`;
      }
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
    // cy is the row's DATUM line, not its centre — the cells hang from it consistently.
    const cy = cursor + grid.above[i];
    for (const key of CELL_KEYS) {
      if (key === 'code' || cx[key] === undefined) continue;
      const view = r[key];
      if (!view) continue;
      const { mu, mv, mapping } = place(view.zb, cx[key], cy, scale, r.datum?.[key]);
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
    // Arm code then plate code, under the section they belong to.
    if (cx.profile !== undefined) {
      const labels = [r.armCode, r.code].filter(Boolean);
      const below = cy + grid.below[i] - FS.code * (labels.length + 0.6);
      labels.forEach((t, n) => {
        svg += `<text x="${cx.profile}" y="${below + n * (FS.code + 4)}" font-size="${FS.code}" text-anchor="middle">${t}</text>`;
      });
    }
    cursor += h + lead;
  });

  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 40}" y="${P.H - MARGIN - 14 - (noteLines.length - 1 - i) * (FS.note + 4)}" font-size="${FS.note}">${line}</text>`;
  });
  const footer = footerNote || (toScale
    ? `SCALE 1:1 ON ${P.label} LANDSCAPE (0.25" margins, print at 100%)`
    : `REDUCED ${Math.round(shrink * 100)}% TO FIT ${P.label} (${rows.length} row${rows.length === 1 ? '' : 's'}, bound by ${boundBy}) — NOT TO SCALE, READ THE DIMENSIONS`);
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
