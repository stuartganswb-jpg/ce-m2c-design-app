// TRUE BACKORDERS — the one definition (Stuart 2026-09-08; A + B).
//   "if plated not on hand and/or if painted and there is no /P stock and no raw mill item stock
//    these should be considered true backorders."
//
// A sales-order line is a TRUE BACKORDER when nothing on the shelf can make it:
//   plated  — the finished code's available (net of NetSuite commitment) is 0;
//   painted — the finished code is not stocked AND <mill>/P is 0 AND the raw mill base is 0
//             (any one of those in stock = the floor can make it; the pick / convert path covers it).
// A line whose cover codes cannot be read at all is a DATA FAULT, not a backorder — the board lists
// it separately so data problems never wear the costume of demand (D, 2026-09-03).
//
// Pure. The split (B) writes the record; Stock View's Backorders board (A) reads it and pairs each
// line with the open PO/WO that covers any of its cover codes; the receipt (D) marks it covered.
import { finishSuffixOf, isOutsourcedFinishCode, millBaseOf } from './finishRouting.js';

const U = (v) => String(v || '').trim().toUpperCase();
export const lineCodeOf = (l) => U(l && (l.legacyErpId || l.partId));

export const isPlatedLine = (line, orderRecipe) => {
    if (!line) return false;
    if (line.finishOutsourced === true) return true;
    if (line.finishOutsourced === false) return false;
    const sfx = finishSuffixOf(lineCodeOf(line));
    if (sfx) return isOutsourcedFinishCode(sfx);
    return isOutsourcedFinishCode(U(orderRecipe));
};

// The codes whose stock can satisfy a line, in the order the floor would use them.
export const coverCodesOf = (line, orderRecipe) => {
    const code = lineCodeOf(line);
    if (!code) return [];
    if (isPlatedLine(line, orderRecipe)) return [code];
    const mill = U(millBaseOf(code));
    return [...new Set([code, `${mill}/P`, mill].filter(Boolean))];
};

/**
 * Classify one line against a stock map ({ CODE: { available, onOrder, unit } }).
 * @returns {{ kind: 'plated'|'painted', coverCodes, readable: string[], available: {code:n},
 *             onOrder: number, state: 'covered'|'backorder'|'unknown', shortfall: number }}
 */
export const classifyLine = (line, orderRecipe, stockMap, qtyWanted) => {
    const kind = isPlatedLine(line, orderRecipe) ? 'plated' : 'painted';
    const coverCodes = coverCodesOf(line, orderRecipe);
    const map = stockMap || {};
    const readable = coverCodes.filter(c => c in map);
    const available = {};
    readable.forEach(c => { available[c] = Math.max(0, Number(map[c].available) || 0); });
    const onOrder = readable.reduce((t, c) => t + (Number(map[c].onOrder) || 0), 0);
    const wanted = Math.max(0, Number(qtyWanted) || 0);
    if (!readable.length) return { kind, coverCodes, readable, available, onOrder, state: 'unknown', shortfall: 0 };
    // Plated: only the finished code counts. Painted: any cover code in stock means the floor can make it.
    const canMake = kind === 'plated' ? (available[coverCodes[0]] || 0) : readable.reduce((t, c) => t + available[c], 0);
    if (canMake >= wanted) return { kind, coverCodes, readable, available, onOrder, state: 'covered', shortfall: 0 };
    return { kind, coverCodes, readable, available, onOrder, state: 'backorder', shortfall: wanted - canMake };
};

// The record written on the sales order (backorderLines[]) — one per short line.
export const backorderRecordOf = (line, cls, { since = null, lineIndex = null } = {}) => ({
    code: lineCodeOf(line), name: line.partName || line.name || '',
    qty: cls.shortfall, wanted: Math.max(0, Number(line.quantity != null ? line.quantity : line.qty) || 0),
    kind: cls.kind, coverCodes: cls.coverCodes, available: cls.available, onOrder: cls.onOrder,
    unit: (cls.readable[0] && cls.readable[0]) ? null : null,
    since: since || null, lineIndex,
});
