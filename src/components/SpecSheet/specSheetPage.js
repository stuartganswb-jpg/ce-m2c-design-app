// specSheetPage.js — composes one spec-sheet page (SVG string) in the Fabricut drawing
// style. Layout is paper-aware:
//   letter  (8.5×11 landscape)  — 'fit' mode: compact 4-5 row pages, drawings scale to fit
//                                  (capped at 1:1 so nothing prints oversize).
//   tabloid (11×17 landscape)   — 'actual' mode: EVERYTHING at true 1:1 print scale;
//                                  wall-mount detail | front (rod broken) | code | profile,
//                                  rows stacked by their real content height.
// The tabloid master can also be printed reduced onto letter (~64%, footer marks it
// NOT TO SCALE) — same SVG, different output paper.
import { fracSvg, fracSvgFromText, fracWidth } from './specSheetGeometry';

export const PAPERS = {
  // ── THE PAPER IS THE BINDER'S (Stuart 2026-08-23) ──────────────────────────────────────────
  // "let's lose the 11x17 format, not needed go with 8.5x11 standard should be portrait,
  //  landscape only for long doubles as is now." The sheets live in an 8.5×11 catalog binder, so
  // letter IS the master: no reduced mode, and the footer's % is honest against the page that
  // actually prints. Portrait is the standard; a double is a wide drawing (its section alone is
  // the projection deep), so those sheets turn landscape and bind on the long edge.
  letter: { W: 1100, H: 850, printW: 10.5, printH: 8.0, label: '8.5×11 landscape' },
  letterP: { W: 850, H: 1100, printW: 8.0, printH: 10.5, label: '8.5×11 portrait' },
  // Legacy sizes — kept only so an old saved reference to them cannot crash a render.
  tabloid: { W: 1700, H: 1100, printW: 16.5, printH: 10.5, label: '11×17' },
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

// ── TYPE SCALE (Stuart 2026-08-23b) ──────────────────────────────────────────────────────────
// "your scale on all the brackets with backplates is too aggressive in scaling down … there is
//  plenty of room to not reduce the scale so much."
//
// He is pointing at TEXT. Letter is the master now (no 64% reduction on the way to the binder),
// and the type was still sized for one — so every fixed-size annotation was ~1.5× what the page
// needs, and text is most of a row's fixed overhead, charged four times over. The hand-made
// sheets run ~7pt on letter; at ~104 page units per printed inch that is ~10 units, and the
// whole annotation system below is sized from it. Every unit shaved off the fixed overhead goes
// straight back into drawn geometry on the height-bound multi-row sheets.
// FS.dim 10 → 12 (Stuart 2026-08-27: "the measurements are all listed in a font that is too
// small, please go up one pt and there is plenty of room" — ~1pt printed is ~1.4 page units, and
// the dim labels were a mix of 10 and 11; one size, one point up from the larger).
const FS = { title: 13, sub: 10, code: 11, label: 10, dim: 12, note: 9, zone: 9 };
// Breathing room around a drawing, in page units, so dimension lines and their labels have
// somewhere to go. ~1/4" printed on either side.
// ⚠ PADDING IS CHARGED PER ROW, SO IT IS SPENT FOUR TIMES. At 26 units a side this was ~1/2"
// top and bottom of every row — over four rows, more than an inch of a ten-inch page before a
// single part is drawn. Trimmed hard; the dimensions carry their own offsets anyway.
const PAD = { x: 16, y: 10 };
const GUTTER = 24;      // between columns

export function dimH(x0, x1, y, inches) {
  let s = `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x0}" y1="${y - 4}" x2="${x0}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x1}" y1="${y - 4}" x2="${x1}" y2="${y + 4}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvg((x0 + x1) / 2 - fracWidth(inches, FS.dim) / 2, y - 8, inches, FS.dim);
  return s;
}
// side: +1 label right of the line (default), -1 label to the left (clear of artwork).
// labelDy: extra vertical label offset in page units (~26 = 1/4" printed on letter).
// below: the label sits CENTERED UNDER the line's bottom end instead of beside its middle —
// Stuart 2026-08-27: "can we put the ring drop measurements under the measure line and space
// everything out so it is clearly legible." Beside-the-line labels on a row of ring drops all
// land in the same crowded band between rings; under the line each value sits in its own lane.
export function dimV(x, y0, y1, inches, dia = false, side = 1, labelDy = 0, below = false) {
  let s = `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y0}" x2="${x + 4}" y2="${y0}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x - 4}" y1="${y1}" x2="${x + 4}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  if (below) {
    s += fracSvg(x - fracWidth(inches, FS.dim, dia) / 2, Math.max(y0, y1) + FS.dim + 5, inches, FS.dim, dia);
  } else {
    s += fracSvg(side < 0 ? x - 6 - fracWidth(inches, FS.dim, dia) : x + 9, (y0 + y1) / 2 + 4 + labelDy, inches, FS.dim, dia);
  }
  return s;
}
// dir +1: leader runs up-right, text right of it (default); -1: up-left, text to the left.
// down: the leader runs DOWNWARD instead — for an anchor near the pole (a round plate's ⌀ sits
// just under the rod), where an upward leader walks its label straight into the pole artwork
// (Stuart 2026-08-27, the stray ⌀ on the H1-75D / H1-138D round-plate rows).
export function leaderDia(x, y, inches, dir = 1, down = false) {
  const vy = down ? 16 : -16;
  let s = `<line x1="${x}" y1="${y}" x2="${x + 24 * dir}" y2="${y + vy}" stroke="black" stroke-width="${SW}"/>`;
  const ty = down ? y + 16 + FS.dim : y - 18;
  s += fracSvg(dir < 0 ? x - 26 - fracWidth(inches, FS.dim, true) : x + 26, ty, inches, FS.dim, true);
  return s;
}
// Aligned manual dimension between two arbitrary page points, label = user text.
export function dimManual(x0, y0, x1, y1, valueText) {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const tx = Math.cos(ang + Math.PI / 2) * 4, ty = Math.sin(ang + Math.PI / 2) * 4;
  let s = `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x0 - tx}" y1="${y0 - ty}" x2="${x0 + tx}" y2="${y0 + ty}" stroke="black" stroke-width="${SW}"/>`;
  s += `<line x1="${x1 - tx}" y1="${y1 - ty}" x2="${x1 + tx}" y2="${y1 + ty}" stroke="black" stroke-width="${SW}"/>`;
  s += fracSvgFromText((x0 + x1) / 2 + 6, (y0 + y1) / 2 - 5, valueText, FS.dim);
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
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 28}" font-size="${FS.title}">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 42}" font-size="${FS.sub}" fill="#444">${subtitle}</text>`;
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
const cellAboveBelow = (view, scale, datumV, dims) => {
  if (!view || !view.zb || !isFinite(view.zb.maxU)) return { w: 0, above: 0, below: 0 };
  const zb = view.zb;
  const d = (datumV != null && isFinite(datumV)) ? datumV : (zb.minV + zb.maxV) / 2;
  // ⚠ DIMENSION LINES TAKE ROOM THE GEOMETRY BOX CANNOT SEE. A double's two-step projection dims
  // stack at -8 and -28 above the section, plus a label — ~46 page units of TEXT that does not
  // shrink with the scale. Measured only by mesh bounds, a tight page let one row's dims walk
  // straight into the caption of the row above (H1-138D, first render of the paired-rod sheet).
  // Same rule as padBelow: the row declares the room its annotations need.
  let extraAbove = 0, extraBelow = 0;
  for (const dm of dims || []) {
    if (dm.t === 'h') {
      // line sits (zb.maxV - v)·scale + off below the top; label ~18 above the line
      const room = 14 - ((zb.maxV - dm.v) * scale + (dm.off || 0));
      if (room > extraAbove) extraAbove = room;
    } else if (dm.t === 'dia' && !dm.down) {
      // leader rises 16 from the point, label above that
      const room = 24 - (zb.maxV - dm.v) * scale;
      if (room > extraAbove) extraAbove = room;
    } else if (dm.t === 'dia' && dm.down) {
      // downward leader: 16 down plus the label's line
      const room = 16 + FS.dim + 6 - (dm.v - zb.minV) * scale - PAD.y;
      if (room > extraBelow) extraBelow = room;
    } else if (dm.t === 'text' && (dm.off || 0) < 0) {
      // a label riding ABOVE the artwork (ceiling plates) needs its line of room up there
      const room = FS.label + 2 - ((zb.maxV - dm.v) * scale + dm.off);
      if (room > extraAbove) extraAbove = room;
    } else if (dm.t === 'v' && dm.below) {
      // a below-the-line label hangs FS.dim+~10 under the line's lower end — text, so the row
      // declares that room the same way it declares the head-room above.
      const room = FS.dim + 10 - (Math.min(dm.v0, dm.v1) - zb.minV) * scale - PAD.y;
      if (room > extraBelow) extraBelow = room;
    }
  }
  return {
    w: (zb.maxU - zb.minU) * scale + PAD.x * 2,
    above: (zb.maxV - d) * scale + PAD.y + extraAbove,
    below: (d - zb.minV) * scale + PAD.y + extraBelow,
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
      const m = cellAboveBelow(r[k], scale, r.datum?.[k], r.dims?.[k]);
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
export function buildPageSvg({ title, subtitle, rows, manualDims = [], noteLines = [], paper = 'letterP', footerNote }) {
  const P = PAPERS[paper] || PAPERS.letterP;
  const oneToOne = scaleForPaper(PAPERS[paper] ? paper : 'letterP');
  const viewMaps = [];

  // Space the drawings may occupy, once the title block, the notes and the bottom strip are out.
  const bodyTop = MARGIN + 60;
  // Notes are CENTERED and word-wrapped to the page (Stuart 2026-08-23b: "the text disclaimer
  // on bottom is not centered it goes off page to right side") — the convention note is longer
  // than a portrait page, and a clipped disclaimer is no disclaimer.
  const noteMax = Math.max(20, Math.floor((P.W - 2 * MARGIN - 24) / (FS.note * 0.52)));
  const wrappedNotes = noteLines.flatMap(line => {
    const words = String(line).split(' ');
    const out = []; let cur = '';
    for (const w of words) {
      if (cur && cur.length + 1 + w.length > noteMax) { out.push(cur); cur = w; }
      else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
    return out;
  });
  const notesH = (wrappedNotes.length + 1) * (FS.note + 4) + 18;
  // The bottom ring strip is gone (Stuart 2026-08-23): each ring is named where it hangs, so
  // the whole body height belongs to the rows.
  const bodyH = P.H - MARGIN - bodyTop - notesH;
  const bodyW = P.W - 2 * MARGIN - 80;

  // ── THE DRAWINGS PRINT AS LARGE AS THE PAGE ALLOWS (Stuart 2026-08-27) ─────────────────────
  // "we still do not have a nice even scale amount so that the images print as large as possible,
  //  the H1-75 items are shown much smaller since they are smaller … set scale … so the generator
  //  reads each one and sets appropriately."
  //
  // 1:1 was the old master and the page only ever SHRANK to fit — so a physically small assembly
  // (H1-75) printed small while a big one filled the sheet. The scale now converges toward the
  // page in BOTH directions: grow a small assembly, shrink a big one. An enlarged page then snaps
  // DOWN to the nearest even ratio (1.25 / 1.5 / 1.75 / 2 / 2.5 / 3 — capped at 3:1) so the footer
  // can state a scale a person can reason about, and the dimensions stay the authority either way.
  // ⚠ THE FIT HAS TO CONVERGE, NOT BE GUESSED ONCE. A row's height is partly GEOMETRY, which
  // scales, and partly TEXT — captions, dimension labels, the room they need — which does not.
  // Re-measuring after each step converges in a few passes; growth is damped so a text-heavy page
  // cannot overshoot and oscillate.
  const RATIO_LADDER = [3, 2.5, 2, 1.75, 1.5, 1.25];
  let scale = oneToOne;
  let grid = measureGrid(rows, scale);
  for (let i = 0; i < 8; i++) {
    const k = Math.min(bodyW / (grid.totalW || 1), bodyH / (grid.totalH || 1));
    if (!isFinite(k) || (k >= 0.999 && k <= 1.02)) break;
    scale *= Math.min(k, 1.5);
    grid = measureGrid(rows, scale);
  }
  // Never leave the page overflowing after a growth overshoot.
  for (let i = 0; i < 4 && (grid.totalW > bodyW || grid.totalH > bodyH); i++) {
    const k = Math.min(bodyW / (grid.totalW || 1), bodyH / (grid.totalH || 1), 1);
    if (!isFinite(k) || k >= 0.999) break;
    scale *= k;
    grid = measureGrid(rows, scale);
  }
  let ratio = scale / oneToOne;
  if (ratio > 1.02) {
    const snapped = RATIO_LADDER.find(r => r <= ratio) || 1;
    scale = oneToOne * snapped;
    ratio = snapped;
    grid = measureGrid(rows, scale);
  }
  const shrink = scale / oneToOne;
  const enlarged = shrink > 1.02;
  const toScale = !enlarged && shrink >= 0.999;
  // WHICH CONSTRAINT BOUND THE FIT. Height and width shrink the page for completely different
  // reasons and want opposite fixes — a narrower elevation helps one and does nothing for the
  // other. Saying which is binding turns "it looks small" into a number that points somewhere.
  const bindW = grid.totalW / bodyW, bindH = grid.totalH / bodyH;
  const boundBy = (toScale || enlarged) ? '' : (bindW >= bindH ? 'width' : 'height');

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
  // ⚠ THE GAP IS CAPPED (Stuart 2026-08-27: "super small with tons of wasted white space in
  // between the left and the right"). All the leftover width used to pour into the gap before
  // the section; on a page whose scale is height-bound that gap grew enormous and read as waste.
  // The section still stands apart — up to ~1.3" printed — and the rest centres the whole strip.
  const gap = Math.min(spare, 140);
  const cx = {};
  let x = MARGIN + 40 + (spare - gap) / 2;
  CELL_KEYS.forEach(k => {
    if (!grid.colW[k]) return;
    if (k === 'profile') x += gap;
    cx[k] = x + grid.colW[k] / 2;
    x += grid.colW[k] + GUTTER;
  });

  const drawDims = (dims, mu, mv) => {
    let s2 = '';
    for (const d of dims || []) {
      if (d.t === 'h') s2 += dimH(mu(d.u0), mu(d.u1), mv(d.v) + (d.off || 0), d.in);
      else if (d.t === 'v') s2 += dimV(mu(d.u) + (d.off || 0), mv(d.v0), mv(d.v1), d.in, d.dia, d.side || 1, d.ldy || 0, !!d.below);
      else if (d.t === 'dia') s2 += leaderDia(mu(d.u), mv(d.v), d.in, d.dir || 1, !!d.down);
      // A caption at a world point — the ring's pattern id, under the ring it names. `lead`
      // draws the thin leader back up to the part, so a label dropped clear of a crowded row is
      // still unambiguously attached to one ring.
      else if (d.t === 'text') {
        const x = mu(d.u), yTop = mv(d.v), y = yTop + (d.off || 0);
        // Leader runs anchor→label on whichever side the label sits (negative off = above the
        // artwork — the ceiling plates annotate over the pole), stopping clear of the text.
        if (d.lead) {
          s2 += (d.off || 0) < 0
            ? `<line x1="${x}" y1="${yTop - 2}" x2="${x}" y2="${y + 3}" stroke="black" stroke-width="0.4"/>`
            : `<line x1="${x}" y1="${yTop + 2}" x2="${x}" y2="${y - FS.label + 2}" stroke="black" stroke-width="0.4"/>`;
        }
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

  // Notes end one line ABOVE the footer — on letter the two shared a baseline and the long
  // convention note ran straight through the scale statement (Stuart's 2026-08-23b screenshots).
  wrappedNotes.forEach((line, i) => {
    svg += `<text x="${P.W / 2}" y="${P.H - MARGIN - 14 - (wrappedNotes.length - i) * (FS.note + 4)}" font-size="${FS.note}" text-anchor="middle">${line}</text>`;
  });
  const footer = footerNote || (toScale
    ? `SCALE 1:1 ON ${P.label} (0.25" margins, print at 100%)`
    : enlarged
      ? `SCALE ${shrink}:1 ON ${P.label} (enlarged to fill the sheet — READ THE DIMENSIONS)`
      : `REDUCED ${Math.round(shrink * 100)}% TO FIT ${P.label} (${rows.length} row${rows.length === 1 ? '' : 's'}, bound by ${boundBy}) — NOT TO SCALE, READ THE DIMENSIONS`);
  svg += `<text x="${P.W - MARGIN - 8}" y="${P.H - MARGIN - 14}" font-size="${FS.note}" text-anchor="end">${footer}</text>`;

  return { svg: wrapSvg(P, svg), viewMaps, paper: PAPERS[paper] ? paper : 'letterP', toScale, scale };
}

// Generic 1:1 items-grid page — used for the wall-mounts reference and the finials catalog.
// items: [{ code, view, wIn, hIn, note? }] — each drawn face-on at actual size with W/H dims.
// ── THE GRID IS PACKED BY WHAT THE PARTS MEASURE, NOT BY COUNT (Stuart 2026-08-23b) ──────────
// "finials are all overlapping." The old grid divided the page into count-many equal cells and
// drew every item at 1:1 regardless — a six-inch finial in a two-inch cell lands on its
// neighbours. Items now flow into rows by their true 1:1 width (plus the room their dims take),
// and the page shrinks uniformly — saying so in the footer, same honesty as the sheets — only
// when even that does not fit.
export function buildItemsGridPage({ title, subtitle, items = [], noteLines = [], paper = 'letterP', footerNote }) {
  const P = PAPERS[paper] || PAPERS.letterP;
  const oneToOne = scaleForPaper(PAPERS[paper] ? paper : 'letterP');
  const bodyTop = MARGIN + 56;
  const bodyW = P.W - 2 * MARGIN - 80;
  const bodyH = P.H - MARGIN - bodyTop - (noteLines.length + 1) * 14 - 8;
  // fixed annotation room per item: code above + W dim above (left/right ticks), H dim right,
  // optional note below — text, so it does not scale.
  const PADW = 66, PADH = 72;
  const measure = (scale) => {
    const rows = [];
    let cur = [], curW = 0;
    for (const it of items) {
      const zb = it.view.zb;
      const w = (zb.maxU - zb.minU) * scale + PADW;
      const h = (zb.maxV - zb.minV) * scale + PADH + (it.note ? 12 : 0);
      if (cur.length && curW + w > bodyW) { rows.push(cur); cur = []; curW = 0; }
      cur.push({ it, w, h }); curW += w;
    }
    if (cur.length) rows.push(cur);
    const rowH = rows.map(r => Math.max(...r.map(c => c.h)));
    const widest = Math.max(...rows.flat().map(c => c.w), 1);
    return { rows, rowH, totalH: rowH.reduce((a, b) => a + b, 0), widest };
  };
  let scale = oneToOne;
  let grid = items.length ? measure(scale) : { rows: [], rowH: [], totalH: 0, widest: 0 };
  for (let i = 0; i < 6 && items.length; i++) {
    if (grid.totalH <= bodyH && grid.widest <= bodyW) break;
    const k = Math.min(bodyH / (grid.totalH || 1), bodyW / (grid.widest || 1), 1);
    if (!isFinite(k) || k >= 0.999) break;
    scale *= k;
    grid = measure(scale);
  }
  const toScale = scale / oneToOne >= 0.999;
  let svg = '';
  svg += `<rect x="${MARGIN}" y="${MARGIN}" width="${P.W - 2 * MARGIN}" height="${P.H - 2 * MARGIN}" fill="none" stroke="black" stroke-width="1.5"/>`;
  svg += `<text x="${MARGIN + 40}" y="${MARGIN + 26}" font-size="${FS.title}">${title || ''}</text>`;
  if (subtitle) svg += `<text x="${MARGIN + 40}" y="${MARGIN + 40}" font-size="${FS.sub}" fill="#444">${subtitle}</text>`;
  const lead = Math.max(0, bodyH - grid.totalH) / (grid.rows.length + 1);
  let y = bodyTop + lead;
  grid.rows.forEach((row, ri) => {
    const rowW = row.reduce((a, c) => a + c.w, 0);
    let x = MARGIN + 40 + Math.max(0, bodyW - rowW) / 2;
    const rh = grid.rowH[ri];
    for (const cell of row) {
      const cx = x + cell.w / 2, cy = y + rh / 2;
      const { mu, mv, mapping } = place(cell.it.view.zb, cx, cy, scale);
      svg += segPaths(cell.it.view.vis, mu, mv);
      const [bx, by, bw, bh] = mapping.rect;
      svg += `<text x="${cx}" y="${by - 24}" font-size="${FS.label}" text-anchor="middle">${cell.it.code}</text>`;
      svg += dimH(bx, bx + bw, by - 10, cell.it.wIn);
      svg += dimV(bx + bw + 10, by, by + bh, cell.it.hIn);
      if (cell.it.note) svg += `<text x="${cx}" y="${by + bh + 16}" font-size="${FS.note}" text-anchor="middle">${cell.it.note}</text>`;
      x += cell.w;
    }
    y += rh;
  });
  noteLines.forEach((line, i) => {
    svg += `<text x="${MARGIN + 40}" y="${P.H - MARGIN - 12 - (noteLines.length - i) * 14}" font-size="${FS.note}">${line}</text>`;
  });
  const footer = footerNote || (toScale
    ? `SCALE 1:1 ON ${P.label} (0.25" margins, print at 100%)`
    : `REDUCED ${Math.round((scale / oneToOne) * 100)}% TO FIT ${P.label} — NOT TO SCALE, READ THE DIMENSIONS`);
  svg += `<text x="${P.W - MARGIN - 8}" y="${P.H - MARGIN - 12}" font-size="${FS.note}" text-anchor="end">${footer}</text>`;
  return { svg: wrapSvg(P, svg), viewMaps: [], paper: PAPERS[paper] ? paper : 'letterP' };
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
