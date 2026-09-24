// ── FABRIC CUTS FOR STANDARD PILLOWS — THE RULES, PURE (S7, Stuart 2026-09-24) ─────────────────
//
// Stuart: "the pillow matrix for each size needs the minimum fabric cut size required for each one,
// so we associate each fabric cut with the largest size it can accomplish on standard pillows" —
// and the minimum cut is ONE SIDE ("an 18x18 standard pillow will need 2× the minimum, this way
// custom can use just one side in one fabric and another fabric cut for the other side").
//
// Words, once:
//   a SIZE           '20x12' = 20 wide × 12 tall (the way the board draws it)
//   the MIN CUT      one side of that size as a rectangle: lengthIn (the pillow's height + the seam
//                    allowance each way) × widthIn (the pillow's width + the allowance each way).
//                    Stored per size in system/pillow_pricing.sizes[key].minCut; when the size has
//                    none, derived from its dimensions and the document's seamAllowanceIn.
//   a FABRIC         has a bolt WIDTH; goods run off the roll along their LENGTH. In the standard
//                    orientation the pillow's HEIGHT runs along the roll, so the cut taken off the
//                    roll is minCut.lengthIn long and needs minCut.widthIn of the bolt's width.
//   RAILROAD         a fabric whose design requires the pattern to run along the roll: the pillow
//                    is turned — the cut taken is minCut.widthIn long and needs minCut.lengthIn of
//                    the width. A fabric-level checkbox (customData.railroad); never a per-order
//                    choice (Stuart: fewer than 5% of fabrics, "requires a rail road cut for the
//                    design").
//   a CUT (piece)    a ledger entry: lengthIn along the roll × widthIn (the fabric's width, or less
//                    for a remainder the floor declared). Its LARGEST SIZE = the biggest standard
//                    size (by area) whose one-side cut fits inside it, in the fabric's orientation.
//
// No waste rule here: the sewing floor declares what is left and its usable size when a pillow is
// finished (Stuart, answer 3). Pure — proven by scripts/pillowCuts.test.mjs.

import { sizeKeyOf, dimsOf, DEFAULT_PILLOW_PRICING } from './pillowPricing.js';

const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (n) => Math.round(n * 100) / 100;

/** The sizes the table prices, in the chart's order (sizeOrder), else the matrix's keys. */
export const sizeKeysOf = (config) => {
    const cfg = config || {};
    if (Array.isArray(cfg.sizeOrder) && cfg.sizeOrder.length) return cfg.sizeOrder.slice();
    return Object.keys(cfg.prices || {});
};

/** Seam allowance the document declares (default 0.5"). */
export const allowanceOf = (config) => {
    const a = num(config && config.seamAllowanceIn);
    return a === null ? DEFAULT_PILLOW_PRICING.seamAllowanceIn : a;
};

/** The default one-side cut for a size: height + 2×allowance long, width + 2×allowance wide. */
export const defaultMinCutOf = (sizeKey, config) => {
    const d = dimsOf(sizeKey);
    if (!d) return null;
    const a = allowanceOf(config);
    return { lengthIn: r2(d.h + 2 * a), widthIn: r2(d.w + 2 * a), derived: true };
};

/** The min cut in force for a size: the stored one when complete, else the default; null when the size is unreadable. */
export const minCutOf = (sizeKey, config) => {
    const key = sizeKeyOf(sizeKey);
    if (!key) return null;
    const stored = config && config.sizes && config.sizes[key] && config.sizes[key].minCut;
    const L = stored && num(stored.lengthIn), W = stored && num(stored.widthIn);
    if (L !== null && L !== undefined && W !== null && W !== undefined && L > 0 && W > 0) return { lengthIn: L, widthIn: W, derived: false };
    return defaultMinCutOf(key, config);
};

/** Every priced size with its dimensions and min cut — the pricing screen's table. */
export const sizeCutTableOf = (config) => sizeKeysOf(config).map(key => {
    const d = dimsOf(key) || { w: null, h: null };
    const mc = minCutOf(key, config);
    return { key, w: d.w, h: d.h, areaSqIn: d.w && d.h ? d.w * d.h : 0, minCut: mc };
});

/** Is a fabric railroaded? Reads the fabric-level flag (customData.railroad) — the only place it lives. */
export const isRailroad = (fabric) => {
    if (!fabric) return false;
    const specs = fabric.manufacturingSpecs || {};
    const cd = specs.customData || fabric.customData || {};
    return cd.railroad === true || String(cd.railroad || '').toUpperCase() === 'TRUE' || fabric.railroad === true;
};

/** A fabric's bolt width in inches (manufacturingSpecs.width), null when unknown. */
export const fabricWidthOf = (fabric) => {
    const w = num(fabric && fabric.manufacturingSpecs && fabric.manufacturingSpecs.width);
    return w === null ? num(fabric && fabric.width) : w;
};

/**
 * The one-side cut a size takes from a fabric.
 *   { lengthIn (taken off the roll), widthNeededIn (of the bolt), fits (bolt wide enough), railroad }
 * fits is null when the fabric's width is unknown (no claim either way).
 */
export function cutForSize({ sizeKey, fabric = null, widthIn = undefined, railroad = undefined, config = DEFAULT_PILLOW_PRICING } = {}) {
    const mc = minCutOf(sizeKey, config);
    if (!mc) return null;
    const rr = railroad === undefined ? isRailroad(fabric) : !!railroad;
    const bolt = widthIn === undefined ? fabricWidthOf(fabric) : num(widthIn);
    const lengthIn = rr ? mc.widthIn : mc.lengthIn;
    const widthNeededIn = rr ? mc.lengthIn : mc.widthIn;
    const fits = bolt === null ? null : widthNeededIn <= bolt + 1e-9;
    return { sizeKey: sizeKeyOf(sizeKey), lengthIn, widthNeededIn, fits, railroad: rr, boltWidthIn: bolt };
}

/** One row of cut lengths for a fabric across every priced size — the download sheet's cut columns. */
export const cutRowFor = (fabric, config, { widthIn, railroad } = {}) =>
    sizeKeysOf(config).map(key => cutForSize({ sizeKey: key, fabric, widthIn, railroad, config }));

/**
 * The largest standard size a cut can make, in the fabric's orientation.
 *   cut: { lengthIn (along the roll), widthIn (across) }
 * Returns { key, w, h, minCut, cut: { lengthIn, widthNeededIn } } or null when nothing fits.
 * "Largest" = greatest pillow area; ties fall to the chart order.
 */
export function largestSizeFor({ cut, railroad = false, config = DEFAULT_PILLOW_PRICING } = {}) {
    const L = num(cut && cut.lengthIn), W = num(cut && cut.widthIn);
    if (L === null || W === null || L <= 0 || W <= 0) return null;
    let best = null;
    sizeCutTableOf(config).forEach((row, i) => {
        if (!row.minCut) return;
        const need = cutForSize({ sizeKey: row.key, widthIn: W, railroad, config });
        if (!need || need.lengthIn > L + 1e-9 || need.widthNeededIn > W + 1e-9) return;
        if (!best || row.areaSqIn > best.areaSqIn || (row.areaSqIn === best.areaSqIn && i < best.index)) best = { ...row, index: i, cut: { lengthIn: need.lengthIn, widthNeededIn: need.widthNeededIn } };
    });
    if (!best) return null;
    const { index, ...rest } = best;
    return rest;
}

/** Every size a cut can make, largest first — for the drill-down's "up to" and the planner. */
export const sizesFor = ({ cut, railroad = false, config = DEFAULT_PILLOW_PRICING } = {}) => {
    const L = num(cut && cut.lengthIn), W = num(cut && cut.widthIn);
    if (L === null || W === null || L <= 0 || W <= 0) return [];
    return sizeCutTableOf(config)
        .map((row, i) => ({ row, i, need: cutForSize({ sizeKey: row.key, widthIn: W, railroad, config }) }))
        .filter(x => x.need && x.need.lengthIn <= L + 1e-9 && x.need.widthNeededIn <= W + 1e-9)
        .sort((a, b) => (b.row.areaSqIn - a.row.areaSqIn) || (a.i - b.i))
        .map(x => ({ key: x.row.key, w: x.row.w, h: x.row.h, cut: { lengthIn: x.need.lengthIn, widthNeededIn: x.need.widthNeededIn } }));
};

/** The editor's rows → the sizes patch { [key]: { minCut } } with refusals; a blank pair = back to the default. */
export function minCutPatchOf(rows = []) {
    const errors = [];
    const minCuts = {};
    (rows || []).forEach(r => {
        const key = sizeKeyOf(r.key);
        if (!key) { errors.push(`"${r.key}" is not a size`); return; }
        const blankL = r.lengthIn === '' || r.lengthIn === null || r.lengthIn === undefined;
        const blankW = r.widthIn === '' || r.widthIn === null || r.widthIn === undefined;
        if (blankL && blankW) { minCuts[key] = null; return; }
        const L = num(r.lengthIn), W = num(r.widthIn);
        if (L === null || W === null || L <= 0 || W <= 0) { errors.push(`${key}: min cut needs both a length and a width in inches (got "${r.lengthIn}" × "${r.widthIn}")`); return; }
        minCuts[key] = { lengthIn: r2(L), widthIn: r2(W) };
    });
    return { ok: errors.length === 0, errors, minCuts };
}

/** Apply a minCuts patch to the document's sizes map (null = drop the stored cut, back to the default). */
export const sizesWithMinCuts = (config, minCuts = {}) => {
    const sizes = { ...((config && config.sizes) || {}) };
    Object.entries(minCuts || {}).forEach(([key, mc]) => {
        const cur = { ...(sizes[key] || { label: key }) };
        if (mc) cur.minCut = mc; else delete cur.minCut;
        sizes[key] = cur;
    });
    return sizes;
};
