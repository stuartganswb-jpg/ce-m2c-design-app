// STOCK FIRST AT THE SPLIT (Brief B5 part 2, Stuart 2026-09-03):
//   "EP finishes since they are outsourced we often have them in stock, so the proper address is
//    to first check stock at time of push from RTG (once it becomes a firm sales order) if the
//    items are in stock it is routed right to wms pick. if the items are not in stock it needs to
//    be routed to stock view 12.5 … a new window of Backorder items on the sales snapshot."
//
// A plated finish is NOT plating work: plated finished goods are commonly stocked. So a PLATED
// small-parts line is decided by LIVE STOCK, after the sales order has posted (NetSuite has then
// committed what it can — `available` is net of every commitment, Stuart's definition of
// "committed"): covered → a pick line; genuinely short → a BACKORDER line the Snapshot covers
// with a WO or PO (never a plating demand from the split — A's Q4 design issues those together);
// cannot be answered → a pick line that says so, never invented as a shortage. In-house lines
// (painted here) are untouched: the floor paints them from the raw pull as today.
//
// Pure. The three-way answer is the contract; a data fault (no inventory row, units unknown for
// the pull) is its own bucket — the Backorder window must never fill with data problems wearing
// the costume of demand (D, 2026-09-03).
import { finishSuffixOf, isOutsourcedFinishCode } from './finishRouting';

const U = (v) => String(v || '').trim().toUpperCase();
const codeOf = (l) => U(l && (l.legacyErpId || l.partId));

// Is this small-parts line PLATED — i.e. a stocked finished good, not something the floor sprays?
// E's line stamp (finishOutsourced, c73263e) wins; else the code's own suffix; a code with no
// suffix takes the order's recipe.
export const isPlatedLine = (line, orderRecipe) => {
    if (!line) return false;
    if (line.finishOutsourced === true) return true;
    if (line.finishOutsourced === false) return false;
    const sfx = finishSuffixOf(codeOf(line));
    if (sfx) return isOutsourcedFinishCode(sfx);
    return isOutsourcedFinishCode(U(orderRecipe));
};

/**
 * @param {object[]} lines       the split's small-parts pull lines (legacyErpId/partId, qty|quantity)
 * @param {string}   orderRecipe the order's recipe CODE
 * @param {object}   stock       { map: { CODE: { available, onOrder, unit } }, unitsKnown } from
 *                               fetchAvailabilityUnits — or null when the read was not made
 * @returns {{ inHouse, pick, backorder, unknown, summary }}
 */
export function planSmallLines(lines = [], orderRecipe = '', stock = null) {
    const out = { inHouse: [], pick: [], backorder: [], unknown: [] };
    const remaining = {};
    const map = stock && stock.map ? stock.map : null;
    const unitsKnown = stock ? stock.unitsKnown !== false : false;
    (lines || []).forEach(l => {
        const code = codeOf(l);
        const qty = Number(l.quantity != null ? l.quantity : l.qty) || 0;
        if (!isPlatedLine(l, orderRecipe)) { out.inHouse.push(l); return; }
        // A plated line — decided by stock, never by the floor.
        if (!map) { out.unknown.push({ ...l, stockUnknown: 'stock not read', pickOnly: true, finishOutsourced: true }); return; }
        if (!(code in map)) { out.unknown.push({ ...l, stockUnknown: 'no inventory row at this location', pickOnly: true, finishOutsourced: true }); return; }
        if (!unitsKnown) { out.unknown.push({ ...l, stockUnknown: 'stock unit could not be read — retry the pull', pickOnly: true, finishOutsourced: true }); return; }
        // A running remainder: two lines shorting one shelf do not both claim it.
        if (!(code in remaining)) remaining[code] = Math.max(0, Number(map[code].available) || 0);
        const have = remaining[code];
        const covered = Math.min(qty, have);
        remaining[code] = have - covered;
        if (covered > 0) out.pick.push({ ...l, qty: covered, quantity: covered, pickOnly: true, finishOutsourced: true, stockAvailable: have });
        const short = qty - covered;
        if (short > 0) out.backorder.push({ code, name: l.partName || l.name || '', qty: short, wanted: qty, available: have, onOrder: Number(map[code].onOrder) || 0, unit: map[code].unit || null });
    });
    out.summary = [
        out.inHouse.length ? `${out.inHouse.length} in-house line${out.inHouse.length === 1 ? '' : 's'} → finishing` : '',
        out.pick.length ? `${out.pick.length} plated line${out.pick.length === 1 ? '' : 's'} in stock → WMS pick` : '',
        out.backorder.length ? `${out.backorder.length} plated line${out.backorder.length === 1 ? '' : 's'} SHORT → backorder (${out.backorder.map(b => `${b.qty} × ${b.code}`).join(', ')})` : '',
        out.unknown.length ? `${out.unknown.length} plated line${out.unknown.length === 1 ? '' : 's'} stock UNKNOWN → picked with a warning` : '',
    ].filter(Boolean).join(' · ');
    return out;
}
