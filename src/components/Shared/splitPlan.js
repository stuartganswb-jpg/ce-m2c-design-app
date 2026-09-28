// STOCK FIRST AT THE SPLIT (Brief B5 part 2, Stuart 2026-09-03):
//   "EP finishes since they are outsourced we often have them in stock, so the proper address is
//    to first check stock at time of push from RTG (once it becomes a firm sales order) if the
//    items are in stock it is routed right to wms pick. if the items are not in stock it needs to
//    be routed to stock view 12.5 … a new window of Backorder items on the sales snapshot."
//
// A plated finish is NOT plating work: plated finished goods are commonly stocked. So a PLATED
// small-parts line is decided by LIVE STOCK, after the sales order has posted (NetSuite has then
// committed what it can). The caller passes the ORDER's view (Shared/oeReviewPlan.fetchStockForOrder,
// 2026-09-27): free stock PLUS what NetSuite holds for this order — `available` alone is net of this
// order's own commitment too, and read its committed stock as short (SO60551, 62 on hand / 50 held /
// 12 available). Covered → a pick line; genuinely short → a BACKORDER line the Snapshot covers
// with a WO or PO (never a plating demand from the split — A's Q4 design issues those together);
// cannot be answered → a pick line that says so, never invented as a shortage. In-house lines
// (painted here) are untouched: the floor paints them from the raw pull as today.
//
// Pure. The three-way answer is the contract; a data fault (no inventory row, units unknown for
// the pull) is its own bucket — the Backorder window must never fill with data problems wearing
// the costume of demand (D, 2026-09-03).
import { isPlatedLine as isPlated, coverCodesOf, classifyLine, backorderRecordOf, lineCodeOf } from './backorder.js';

// The definition lives in Shared/backorder.js (A's board and D's receipt read the same one).
export const isPlatedLine = isPlated;
export { coverCodesOf };

/**
 * @param {object[]} lines       the split's small-parts pull lines (legacyErpId/partId, qty|quantity)
 * @param {string}   orderRecipe the order's recipe CODE
 * @param {object}   stock       { map: { CODE: { available, onOrder, unit } }, unitsKnown } from
 *                               fetchAvailabilityUnits — or null when the read was not made
 * @returns {{ inHouse, pick, backorder, unknown, summary }}
 */
export function planSmallLines(lines = [], orderRecipe = '', stock = null, { since = null } = {}) {
    const out = { inHouse: [], pick: [], backorder: [], unknown: [] };
    const remaining = {};
    const map = stock && stock.map ? stock.map : null;
    const unitsKnown = stock ? stock.unitsKnown !== false : false;
    (lines || []).forEach((l, i) => {
        const code = lineCodeOf(l);
        const qty = Number(l.quantity != null ? l.quantity : l.qty) || 0;
        if (!isPlated(l, orderRecipe)) {
            // PAINTED: the floor makes it from the finished code, its /P, or the raw mill base. It goes to
            // finishing regardless; if NONE of those is on the shelf it is a TRUE BACKORDER as well —
            // recorded, so the Snapshot's board tracks it until the material is ordered and arrives.
            out.inHouse.push(l);
            if (map && unitsKnown) {
                const cls = classifyLine(l, orderRecipe, map, qty);
                if (cls.state === 'backorder') out.backorder.push(backorderRecordOf(l, cls, { since, lineIndex: i }));
            }
            return;
        }
        // PLATED — a stocked finished good, decided by stock, never by the floor.
        if (!map) { out.unknown.push({ ...l, stockUnknown: 'stock not read', pickOnly: true, finishOutsourced: true }); return; }
        if (!(code in map)) { out.unknown.push({ ...l, stockUnknown: 'no inventory row at this location', pickOnly: true, finishOutsourced: true }); return; }
        if (!unitsKnown) { out.unknown.push({ ...l, stockUnknown: 'stock unit could not be read — retry the pull', pickOnly: true, finishOutsourced: true }); return; }
        // A running remainder: two lines shorting one shelf do not both claim it.
        if (!(code in remaining)) remaining[code] = Math.max(0, Number(map[code].available) || 0);
        const have = remaining[code];
        const covered = Math.min(qty, have);
        remaining[code] = have - covered;
        const short = qty - covered;
        // THE WHOLE LINE STAYS ON THE PICK (Stuart 2026-09-27). The pick line used to carry only what the shelf
        // covered, so once the backordered pieces arrived (and the hold lifted) nothing picked them — the order
        // packed short. The line keeps the full quantity; `backorderedQty` says how much of it is on the
        // Snapshot Backorder board, so the WMS never sends that part to the plater a second time.
        out.pick.push({ ...l, qty, quantity: qty, pickOnly: true, finishOutsourced: true, stockAvailable: have, ...(short > 0 ? { backorderedQty: short } : {}) });
        if (short > 0) out.backorder.push({ ...backorderRecordOf(l, { kind: 'plated', coverCodes: [code], readable: [code], available: { [code]: have }, onOrder: Number(map[code].onOrder) || 0, shortfall: short }, { since, lineIndex: i }), unit: map[code].unit || null });
    });
    out.summary = [
        out.inHouse.length ? `${out.inHouse.length} in-house line${out.inHouse.length === 1 ? '' : 's'} → finishing` : '',
        (() => { const full = out.pick.filter(l => !l.backorderedQty).length, part = out.pick.length - full;
            return out.pick.length ? `${full} plated line${full === 1 ? '' : 's'} in stock → WMS pick${part ? ` (+${part} on the pick waiting for their backorder)` : ''}` : ''; })(),
        out.backorder.length ? `${out.backorder.length} TRUE BACKORDER${out.backorder.length === 1 ? '' : 'S'} (${out.backorder.map(b => `${b.qty} × ${b.code} ${b.kind}`).join(', ')})` : '',
        out.unknown.length ? `${out.unknown.length} plated line${out.unknown.length === 1 ? '' : 's'} stock UNKNOWN → picked with a warning` : '',
    ].filter(Boolean).join(' · ');
    return out;
}

// ── A POLE COUNTS AS A POLE (Stuart 2026-09-12, verbatim: "the pole with french return or miter
// return or straight pole anything pole for po to plater is always just the # of feet 1 pole x 8ft
// = 8 billable feet") ────────────────────────────────────────────────────────────────────────────
// The split used to sum EVERY custom line into the shop doc's qty: a bent rod with two French
// returns read "3 pcs", and the demand, the staged line and the plater PO all said 3 × the rod
// (SO60420). A custom line with a cut length IS a pole; a custom line without one (a return, a
// miter, a bend fee) is fabrication ON the pole and adds nothing. qty = poles; feet = poles × the
// cut length; billableFeet = feet rounded UP to the whole foot (the plater bills whole feet). A
// custom order with no pole line at all (a bracket set, say) keeps its line quantities.
export function customShopQtyOf(customLines = []) {
    const lines = (customLines || []).filter(Boolean);
    const num = (v) => Number(v) || 0;
    // A pole's length is its cut — or, on a per-foot line quoted with no cut, its feet per piece (2026-09-27: tab 7's
    // per-foot rod with a blank cut reached the shop as 0 ft). A rider (a fee / return on the pole) is never a pole.
    const lenFt = (l) => (num(l.cutLength) > 0 ? num(l.cutLength) / 12 : (num(l.feetPer) > 0 ? num(l.feetPer) : 0));
    const poleLines = lines.filter(l => !l.rider && lenFt(l) > 0);
    const riders = lines.filter(l => !poleLines.includes(l));
    const poles = poleLines.reduce((s, l) => s + (num(l.qty) || 1), 0);
    const feet = poleLines.reduce((s, l) => s + (num(l.qty) || 1) * lenFt(l), 0);
    const lineQty = lines.reduce((s, l) => s + num(l.qty), 0) || lines.length;
    return {
        qty: poles > 0 ? poles : lineQty,
        poles,
        feet: Math.round(feet * 100) / 100,
        billableFeet: poles > 0 ? Math.ceil(feet - 1e-9) : 0,
        riders: riders.length,
        isPoleOrder: poles > 0,
    };
}

// ── THE POLE A SHOP JOB IS NAMED FOR (Stuart 2026-09-28: "french returns fees with rods will happen often and needs
// to work from all screens") ──────────────────────────────────────────────────────────────────────────────────────
// A French return, a fee, a miter RIDES the pole — it is never the item. SO60551's ROW 1 shop job (H1-1R 16.75" ×50
// + two H1-FRPF riders) had no item code, because the readers took a code only from a ONE-line cut list: its plating
// demand named the row ("ROW 1 · EP4 · 1 pole line + 2 riding") and the plater put-away could not gather the poles
// into the order. The lead is the first line with a length (a cut, or a per-foot line's feet per piece) that is not a
// rider — the pole customShopQtyOf counts first; a one-line job is its line. The CPQ split already names its shop
// document from its first line with a cut (partNum, 2026-09-27); a tab-7 / 10.5 pair now carries the same.
export function shopLeadLineOf(lines = []) {
    const list = (lines || []).filter(Boolean);
    if (list.length === 1) return list[0];
    return list.find(l => !l.rider && (Number(l.cutLength) > 0 || Number(l.feetPer) > 0)) || null;
}
/** The lead pole's code ('' when the job has none). */
export const shopLeadCodeOf = (lines) => {
    const l = shopLeadLineOf(lines);
    return l ? String(l.legacyErpId || l.partId || '').trim().toUpperCase() : '';
};
