// ── THE COUNTER'S PRICE LIST, PURE (S7, 2026-10-15) ────────────────────────────────────────────────
//
// Stuart: "add to the sales counter a simple tab as a price list for quick reference, just show the category
// throws or pillows, and displays prices at base price, then a check box to show the prices at less 10%, 20%,
// 30%, 40%, 50% or 60% these are all our discount levels then we can quote quickly … needs to be really quick
// to look at". Read-only: the pillow grid is the price chart the quick sell charges (size × fabric group,
// Shared/pillowPricing.sizePriceOf); the throws are each throw item's own base price (Standard / XL / XXL per
// colourway). A ticked discount is the order discount's own arithmetic (Shared/lineDiscount.orderPercentRate —
// rounded to cents per line), so what the list says is what the sales order would charge.

import { sizePriceOf } from './pillowPricing.js';
import { sizeKeysOf } from './pillowCuts.js';
import { basePriceOf } from './pillowCatalog.js';
import { orderPercentRate } from './lineDiscount.js';

export const DISCOUNT_LEVELS = [10, 20, 30, 40, 50, 60];
export const THROW_VARIANTS = [{ code: 'STD', label: 'Standard' }, { code: 'XL', label: 'XL' }, { code: 'XXL', label: 'XXL' }];

const up = (v) => String(v == null ? '' : v).trim().toUpperCase();
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

/** The price less a percent, as the order discount rounds it; null stays null. */
export const lessPercent = (price, pct) => (num(price) === null ? null : orderPercentRate(num(price), pct));

/** The ticked levels, in chart order, each a whole number from the list. */
export const levelsOf = (ticked = []) => DISCOUNT_LEVELS.filter(l => (ticked || []).map(Number).includes(l));

/** One cell: the base and a line per ticked level. */
export const cellOf = (price, ticked = []) => ({ base: num(price), less: levelsOf(ticked).map(pct => ({ pct, price: lessPercent(price, pct) })) });

/**
 * The pillow grid: the chart's groups across (ranked), its sizes down, the chart price in each cell.
 * A group with no rank sorts last; a cell the chart does not price is null (shown as a dash).
 */
export const pillowPriceGridOf = (config, ticked = []) => {
    const cfg = config || {};
    const groups = Object.entries(cfg.fabricGroups || {})
        .map(([code, g]) => ({ code: up(code), label: (g && g.label) || `Group ${up(code)}`, rank: num(g && g.rank) === null ? Infinity : num(g.rank) }))
        .sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    // a group priced on the chart but not in fabricGroups still shows (the chart wins)
    const seen = new Set(groups.map(g => g.code));
    Object.values(cfg.prices || {}).forEach(row => Object.keys(row || {}).forEach(code => { if (!seen.has(up(code))) { seen.add(up(code)); groups.push({ code: up(code), label: `Group ${up(code)}`, rank: Infinity }); } }));
    const sizes = sizeKeysOf(cfg);
    const rows = sizes.map(sizeKey => ({ sizeKey, cells: groups.map(g => cellOf(sizePriceOf(cfg, sizeKey, g.code), ticked)) }));
    return { groups, rows, levels: levelsOf(ticked), empty: sizes.length === 0 || groups.length === 0 };
};

/**
 * The throw rows: one per colourway that carries a throw, the variant's base price in each cell, searched by
 * pattern, colour name or number. `rateFor(item)` wins over the item's own base price when a caller passes one; the
 * counter passes NONE (Stuart 2026-10-15: the list shows the LIST price, a customer's level made a $700 throw read $420).
 */
export const throwPriceRowsOf = (catalog, { ticked = [], q = '', rateFor = null } = {}) => {
    const t = up(q);
    const priceOf = (it) => { if (!it) return null; const r = typeof rateFor === 'function' ? num(rateFor(it)) : null; return r !== null && r > 0 ? r : basePriceOf(it); };
    const rows = ((catalog && catalog.list) || [])
        .filter(cw => cw.throws && (cw.throws.STD || cw.throws.XL || cw.throws.XXL))
        .filter(cw => !t || [cw.key, cw.patternRaw, cw.label, cw.colourName, cw.colour].some(v => up(v).includes(t)))
        .map(cw => ({
            key: cw.key, pattern: cw.patternRaw || cw.pattern, colour: cw.colour, colourName: cw.colourName || '', label: cw.label, group: cw.group || '',
            cells: THROW_VARIANTS.map(v => ({ variant: v.code, code: cw.throws[v.code] ? (cw.throws[v.code].legacyErpId || cw.throws[v.code].itemId || '') : '', ...cellOf(priceOf(cw.throws[v.code]), ticked) })),
        }));
    return { rows, levels: levelsOf(ticked), variants: THROW_VARIANTS };
};

export const money = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
