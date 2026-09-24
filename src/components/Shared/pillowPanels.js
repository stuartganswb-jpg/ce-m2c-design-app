// ── THE PILLOW FACE AS PANELS — GEOMETRY, PURE (Uniquity · S7, 2026-09-24) ─────────────────────
//
// The board draws a pillow face to scale and the operator draws SEAMS across it, then tags each
// panel with a letter and picks that panel's fabric. Pricing and consumption need each panel as a
// rectangle in inches (Shared/pillowPricing.panelConsumptionOf), so this module turns the drawn
// seams into the grid they cut:
//
//   · a seam is a straight line; it is read as a FULL divider along its dominant axis (a mostly
//     horizontal line is a horizontal seam at its mean y; mostly vertical → vertical at its mean x).
//     That is how pillows are pieced — bands and stripes — and it is deterministic. A diagonal seam
//     (within 30° of the diagonal) is still read by its dominant axis, with a warning naming it.
//   · the dividers cut the face into a grid of cells; each cell is a panel.
//   · a tag (the A/B/C marker the operator drops) belongs to the cell containing its point; a cell
//     with no tag takes the FIRST fabric (panel A) — said in the warnings; a tag outside every cell
//     is dropped with a warning.
//   · panel width × height come from the cell; the fabric comes from the tag's letter → the board's
//     fabrics[] list (A = index 0).
//
// Coordinates: the board draws the face at `x0 = 500 − w·S/2`, `y0 = 300 − h·S/2` with S px/in
// (VisionPillow: S = 7); seams and tags are in board px. Pure — proven by scripts/pillowPanels.test.mjs.

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (n) => Math.round(n * 100) / 100;

/** The face's origin on the board for a size, at S px/in (the board's own rule). */
export const faceOriginOf = ({ w, h, pxPerIn = 7 }) => ({ x0: 500 - (w * pxPerIn) / 2, y0: 300 - (h * pxPerIn) / 2 });

/**
 * A drawn seam → its divider: { axis: 'H' | 'V', at (inches from the face's top / left), diagonal }.
 * Returns null for a seam with no length.
 */
export const dividerOf = (seam, { w, h, pxPerIn = 7 }) => {
    const x1 = num(seam && seam.x1), y1 = num(seam && seam.y1), x2 = num(seam && seam.x2), y2 = num(seam && seam.y2);
    if ([x1, y1, x2, y2].some(v => v === null)) return null;
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dx < 1e-6 && dy < 1e-6) return null;
    const { x0, y0 } = faceOriginOf({ w, h, pxPerIn });
    const horizontal = dx >= dy;
    const atPx = horizontal ? (y1 + y2) / 2 - y0 : (x1 + x2) / 2 - x0;
    const at = r2(atPx / pxPerIn);
    const span = horizontal ? h : w;
    const inside = at > 0.25 && at < span - 0.25;   // a divider on the edge cuts nothing
    const diagonal = Math.min(dx, dy) / Math.max(dx, dy) > Math.tan(Math.PI / 6);   // within 30° of the diagonal
    return { axis: horizontal ? 'H' : 'V', at: Math.min(Math.max(at, 0), span), inside, diagonal, id: seam.id };
};

/**
 * The face as panels.
 *   { w, h }       the pillow (inches, wide × tall)
 *   seams[]        the board's drawn seams (px)
 *   tags[]         the board's fabric tags [{ x, y, label }] (px)
 *   fabrics[]      the board's fabric ids, A = index 0
 * → { panels: [{ label, fabricId, widthIn, heightIn, x, y (inches from the face's top-left), tag }], dividers, warnings }
 */
export function panelsOf({ w, h, seams = [], tags = [], fabrics = [], pxPerIn = 7 } = {}) {
    const warnings = [];
    const W = num(w), H = num(h);
    if (W === null || H === null || W <= 0 || H <= 0) return { panels: [], dividers: [], warnings: ['no pillow size'] };
    const dividers = (seams || []).map(s => dividerOf(s, { w: W, h: H, pxPerIn })).filter(Boolean);
    dividers.filter(d => d.diagonal).forEach(d => warnings.push(`seam ${d.id || ''} is diagonal — read as a ${d.axis === 'H' ? 'horizontal' : 'vertical'} seam at ${d.at}"`));
    dividers.filter(d => !d.inside).forEach(d => warnings.push(`seam ${d.id || ''} sits on the edge — it cuts nothing`));
    const xs = [0, ...dividers.filter(d => d.axis === 'V' && d.inside).map(d => d.at), W].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 0.25);
    const ys = [0, ...dividers.filter(d => d.axis === 'H' && d.inside).map(d => d.at), H].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 0.25);
    const { x0, y0 } = faceOriginOf({ w: W, h: H, pxPerIn });
    const cells = [];
    for (let r = 0; r < ys.length - 1; r++) for (let c = 0; c < xs.length - 1; c++) {
        cells.push({ x: xs[c], y: ys[r], widthIn: r2(xs[c + 1] - xs[c]), heightIn: r2(ys[r + 1] - ys[r]), tag: null });
    }
    // tags → cells
    (tags || []).forEach(t => {
        const tx = (num(t.x) - x0) / pxPerIn, ty = (num(t.y) - y0) / pxPerIn;
        const cell = cells.find(c => tx >= c.x && tx <= c.x + c.widthIn && ty >= c.y && ty <= c.y + c.heightIn);
        if (!cell) { warnings.push(`tag ${t.label || ''} is outside the face — dropped`); return; }
        if (cell.tag) { warnings.push(`panel already tagged ${cell.tag.label} — tag ${t.label || ''} ignored`); return; }
        cell.tag = t;
    });
    const letterIndex = (label) => { const c = String(label || '').toUpperCase().charCodeAt(0); return c >= 65 && c <= 90 ? c - 65 : -1; };
    const panels = cells.map((c, i) => {
        const idx = c.tag ? letterIndex(c.tag.label) : -1;
        const fabricId = idx >= 0 && idx < fabrics.length ? fabrics[idx] : (fabrics[0] || '');
        if (!c.tag && cells.length > 1) warnings.push(`panel ${i + 1} (${c.widthIn}" × ${c.heightIn}") has no tag — it takes panel A's fabric`);
        if (c.tag && (idx < 0 || idx >= fabrics.length)) warnings.push(`tag ${c.tag.label} has no fabric row — panel takes panel A's fabric`);
        return { label: c.tag ? String(c.tag.label).toUpperCase() : (cells.length === 1 ? 'A' : `${i + 1}`), fabricId, widthIn: c.widthIn, heightIn: c.heightIn, x: c.x, y: c.y, tag: c.tag ? c.tag.label : null };
    });
    return { panels, dividers, warnings };
}

/** The seam's length in inches (for labour per seam it is a count; for fringe it is yardage). */
export const seamLengthIn = (seam, pxPerIn = 7) => {
    const x1 = num(seam && seam.x1), y1 = num(seam && seam.y1), x2 = num(seam && seam.x2), y2 = num(seam && seam.y2);
    if ([x1, y1, x2, y2].some(v => v === null)) return null;
    return r2(Math.hypot(x2 - x1, y2 - y1) / pxPerIn);
};
