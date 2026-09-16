// THE RECEIPT-SIDE LIFT OF A BACKORDER HOLD (close-out #18 · S2's hand-off 2026-09-15).
//
// `Shared/backorder` decides the hold once at the split and stamps it on every document an order
// owns; RTG's "Finish as available" was the ONLY lift. Nothing cleared a hold when the material
// actually ARRIVED — the rule module always said "the receipt marks it covered" and that half was
// never built. This is it: the WMS calls `coverArrival` wherever material lands (a vendor receipt,
// a plating put-away, a convert, a finished stock put-away), the arrived pieces cover the short
// lines that name that code — oldest first — and when an order has NO short line left, the hold is
// lifted on every sibling with the same patch RTG writes, so the two lifts are one fact.
//
// FINISH COMPLETE stays the rule: while any line is still short the order keeps waiting, and
// `finishAsAvailable` stays the one exception (RTG's, by hand). A floor STOP is never lifted by a
// delivery: only a BACKORDER hold (`isBackorderHold`) is touched.
//
// `allocateArrival` is pure (scripts/backorderCover.test.mjs asserts it); `coverArrival` writes.
import { coverCodesOf, isBackorderHold } from './backorder.js';
import { linkedDocsOf } from './orderLifecycle.js';

const U = (s) => String(s || '').trim().toUpperCase();

// The codes whose arrival covers a short line — the record's own list (the split stamps
// `coverCodes`), else derived from the code and the order's recipe exactly as the split would.
export const lineCoverCodes = (b, recipe) => {
    const own = Array.isArray(b && b.coverCodes) ? b.coverCodes.map(U).filter(Boolean) : [];
    if (own.length) return own;
    return coverCodesOf({ legacyErpId: b && b.code }, recipe).map(U);
};

export const isShortLine = (b) => !!b && Number(b.qty) > 0;

// Sales orders that still have a short line.
export const openBackorders = (orders = []) =>
    (orders || []).filter(so => so && !so.deleted && Array.isArray(so.backorderLines) && so.backorderLines.some(isShortLine));

/**
 * Spread an arrival over the short lines it covers, oldest first.
 * @returns {{ code, arrived, leftover, covered: [{soId, soRef, code, take, remaining}],
 *             patches: { [soId]: backorderLines[] }, lifted: soId[] }}
 */
export const allocateArrival = ({ orders = [], code, qty, by = '', source = '', now = Date.now() } = {}) => {
    const c = U(code);
    let left = Math.max(0, Number(qty) || 0);
    const result = { code: c, arrived: left, leftover: left, covered: [], patches: {}, lifted: [] };
    if (!c || !left) return result;
    const cands = [];
    openBackorders(orders).forEach(so => {
        (so.backorderLines || []).forEach((b, i) => {
            if (!isShortLine(b)) return;
            if (!lineCoverCodes(b, so.recipe).includes(c)) return;
            cands.push({ so, i, since: Number(b.since) || Number(so.backorderAt) || Number(so.createdAt) || 0 });
        });
    });
    cands.sort((a, b) => a.since - b.since);
    for (const k of cands) {
        if (!left) break;
        const lines = result.patches[k.so.id] || k.so.backorderLines.map(b => ({ ...b }));
        const b = lines[k.i];
        const take = Math.min(left, Number(b.qty) || 0);
        if (!take) continue;
        lines[k.i] = {
            ...b, qty: Number(b.qty) - take,
            covered: (Number(b.covered) || 0) + take,
            coveredAt: now, coveredBy: by || '', coveredFrom: source || '', coveredCode: c,
        };
        result.patches[k.so.id] = lines;
        left -= take;
        result.covered.push({ soId: k.so.id, soRef: String(k.so.soId || k.so.id), code: b.code, take, remaining: Number(b.qty) - take });
    }
    result.leftover = left;
    for (const [soId, lines] of Object.entries(result.patches)) {
        if (!lines.some(isShortLine)) result.lifted.push(soId);
    }
    return result;
};

/**
 * Write the allocation: the sales order's backorderLines, then — for every order with nothing
 * short left — the hold lifted on each sibling (fin + shop) that carries a BACKORDER hold.
 * @param ctx { db, doc, getDoc, getDocs, query, collection, where, updateDoc }
 */
export async function coverArrival(ctx, { orders = [], code, qty, by = '', source = '', now = Date.now() } = {}) {
    const { db, doc, updateDoc } = ctx;
    const res = allocateArrival({ orders, code, qty, by, source, now });
    res.written = []; res.liftedDocs = 0;
    for (const [soId, lines] of Object.entries(res.patches)) {
        await updateDoc(doc(db, 'hq_sales_orders', soId), { backorderLines: lines, backorderCoveredAt: now });
        res.written.push(soId);
    }
    for (const soId of res.lifted) {
        const so = orders.find(o => o && o.id === soId);
        if (!so) continue;
        const links = await linkedDocsOf(ctx, so, 'sales');
        const clearPatch = {
            held: false, heldClearedAt: now, heldClearedBy: by || 'WMS',
            heldClearedNote: `Material arrived: ${res.code}${source ? ` (${source})` : ''} — no line short`,
        };
        for (const [fid, fdoc] of links.fin) { if (isBackorderHold(fdoc)) { await updateDoc(doc(db, 'fin_workorders', fid), clearPatch); res.liftedDocs++; } }
        for (const [sid, sdoc] of links.shop) { if (isBackorderHold(sdoc)) { await updateDoc(doc(db, 'shop_custom_orders', sid), clearPatch); res.liftedDocs++; } }
    }
    return res;
}
