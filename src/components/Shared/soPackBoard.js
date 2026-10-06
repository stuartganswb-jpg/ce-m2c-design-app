// ── SO PACK READS LIKE A FULFILMENT SHEET — every part of the order, ordered beside packed, its box, where it is ──
// Stuart 2026-10-06: "for each SO card, the stamps are there but what would read much clearer would be to list each
// part of the order and the qty ordered the qty packed and what box its packed in so we can see what we are waiting
// for before shipping. it should look more like a true fulfillment center. the cards should be next to each line
// rather than one per order."
// A configured order's card listed its FLOOR DOCUMENTS (WO-SO60831-S11 …), each with that document's stamps — never a
// part, a quantity or a box, so nobody could see WHICH piece an order was waiting for. Everything needed was already
// recorded; this reads it once, the way the screens that write it do:
//   · THE PARTS   the rows the packer ticks at Packaging Prep (Shared/pickLines.packLinesOf — the caller passes the
//                 same reader the bench uses, poles by their shop cut rows). "Ordered" is what the document carries of
//                 the part: the pieces the order breaks down into, not the configuration line the customer reads.
//   · PACKED      the packer's count on the tick (Shared/packingList.packedQtyOf — the printed packing list's count).
//   · THE BOX     the NUMBERED box each packed piece went in (Shared/orderBoxes — "Box 2 · Tube 10ft", or
//                 "Box 1 ×8 · Box 2 ×6" for a line split across boxes), written with the tick. A document packed before
//                 box numbers shows the box TYPE chosen for that half of it (packBoxes), on record once it was completed.
//   · WHERE IT IS the document's own stamps (Shared/orderStatus.orderStatusOf — one vocabulary, every screen), but
//                 only the ones that are about THIS line: a pole follows the custom shop and the pole stream, a small
//                 part follows the small-parts stream and the warehouse pick.
// Pure — nothing is written. Harness: scripts/soPackBoard.test.mjs.
import { orderStatusOf, packReadinessOf } from './orderStatus.js';
import { packedQtyOf } from './packingList.js';
import { boxSlotOf, boxSpreadOf, boxSpreadLabel, spreadTrackingOf } from './orderBoxes.js';

const num = (v) => Number(v) || 0;
const str = (v) => String(v == null ? '' : v).trim();

export const LINE_STATE = Object.freeze({
    PACKED: 'PACKED',     // every piece ticked
    PART: 'PART',         // some ticked
    READY: 'READY',       // nothing ticked — its document is finished and in the pack queue
    WAITING: 'WAITING',   // nothing ticked — still on a floor, at the plater, or its pick is open
    CLOSED: 'CLOSED',     // its document is out of production — not part of what ships
});
export const ORDER_VERDICT = Object.freeze({ ALL_PACKED: 'ALL_PACKED', READY: 'READY', WAITING: 'WAITING', NONE: 'NONE' });

export { boxSlotOf };   // which half of a document a line is — the pack bench's grouping (Shared/orderBoxes)

/**
 * The box TYPE a packed line went in, as documents packed BEFORE box numbers recorded it (packBoxes.SMALL / .POLE,
 * written at completion) — '' while nothing of it is packed or its document is still open. A line packed since
 * says its box NUMBER on its tick, and that is read first (Shared/orderBoxes).
 */
export const lineBoxOf = (doc, line, packed) => {
    if (!doc || !line || !(num(packed) > 0)) return '';
    return str(doc.packBoxes && doc.packBoxes[boxSlotOf(line)]);
};

// The warehouse pick is about what is pulled off the shelf — never about a pole, which comes off the shop order.
const PICK_STAGES = new Set(['PICKING', 'PICKED']);

/**
 * The stamps that are about ONE line of a document.
 *   closed document → the one "closed" stamp          packed document → the warehouse stamp (packed / shipped)
 *   a line ticked on a document still open → "packed · packing still open"
 *   a pole → the custom shop alone while it is still there (or at the plater); once back, the shop and the pole
 *            stream (the document's one stream when it has no pole stream)
 *   a small part → the small-parts stream, then the warehouse pick / staging
 */
export function lineStampsOf(doc, line, coats = {}) {
    if (!doc || !line) return [];
    const st = orderStatusOf(doc, coats || {});
    const closed = st.streams.find(s => s.key === 'ORDER');
    if (closed) return [closed];
    if (doc.packStatus === 'Packed' && st.fulfilment) return [st.fulfilment];
    const tick = doc.packedLines && doc.packedLines[line.key];
    if (tick) return [{ key: 'PACK', label: 'Warehouse', stage: 'PACKED', detail: 'packing still open', since: tick.at || null, by: tick.by || '' }];
    const of = (k) => st.streams.find(s => s.key === k) || null;
    if (line.isPole) {
        // Still at the shop or the plater: that is where the pole IS — the document's finishing is not about it yet.
        const custom = of('CUSTOM');
        if (custom && custom.stage !== 'FINISHED') return [custom];
        const out = [custom, of('POLES') || of('PARTS')].filter(Boolean);
        if (st.fulfilment && !PICK_STAGES.has(st.fulfilment.stage)) out.push(st.fulfilment);
        return out;
    }
    return [of('PARTS'), st.fulfilment].filter(Boolean);
}

/**
 * The order, line by line.
 * @param docs     the order's floor documents (fin_workorders)
 * @param linesOf  (doc) → its pack lines — the pack bench's reader (riders are packed with their pole, never rows)
 * @param refOf    (doc) → the reference to print for it
 * @param coatsOf  (doc) → { recipeLen, poleRecipeLen } when the caller knows the coat counts
 * @param boxes    the order's numbered boxes (Shared/orderBoxes.orderBoxesOf) — for a box's type beside its number
 * @returns {{ rows, pieces: { ordered, packed, ready, waiting }, lines: { all, packed }, verdict }}
 */
export function soPackBoardOf({ docs = [], linesOf = () => [], refOf = (d) => (d && d.id) || '', coatsOf = () => ({}), boxes = [] } = {}) {
    const rows = [];
    let anyWaiting = false, live = 0, done = 0;
    (docs || []).forEach(doc => {
        if (!doc) return;
        const coats = coatsOf(doc) || {};
        const rd = packReadinessOf(doc, coats);
        const closed = doc.currentPhase === 'Closed';
        if (!closed) { live++; if (rd && rd.done) done++; else if (!(rd && rd.ready)) anyWaiting = true; }
        const ref = refOf(doc);
        const lines = (linesOf(doc) || []).filter(l => l && !l.rider);
        // A DOCUMENT IS NEVER HIDDEN: one with no line detail still shows, with every stamp it has.
        if (!lines.length) {
            const st = orderStatusOf(doc, coats);
            rows.push({ docId: doc.id || '', ref, key: '', code: '', name: '', isPole: false, noLines: true, ordered: 0, packed: 0, box: '',
                state: closed ? LINE_STATE.CLOSED : (rd && rd.done ? LINE_STATE.PACKED : (rd && rd.ready ? LINE_STATE.READY : LINE_STATE.WAITING)),
                stamps: [...st.streams, ...(st.fulfilment ? [st.fulfilment] : [])] });
            return;
        }
        // ONE ROW PER PART (a configured order lists the same item once per window — HCUDEC1 ×5, ×5, ×2 is 12 end caps
        // to the person counting them into a box). Lines of one item on one document read as one row: ordered and
        // packed summed, and the stamps of a line of it that is NOT packed yet — where the rest of it is.
        const groups = [], byPart = new Map();
        lines.forEach(line => {
            const k = `${str(line.erp).toUpperCase()}|${str(line.name)}|${line.isPole ? 'P' : 'S'}|${boxSlotOf(line)}`;
            if (!byPart.has(k)) { byPart.set(k, []); groups.push(byPart.get(k)); }
            byPart.get(k).push(line);
        });
        groups.forEach(group => {
            const first = group[0];
            const counts = group.map(l => ({ l, ordered: num(l.qty), packed: packedQtyOf(doc, l) }));
            const ordered = counts.reduce((n, c) => n + c.ordered, 0), packed = counts.reduce((n, c) => n + c.packed, 0);
            const state = closed ? LINE_STATE.CLOSED
                : (ordered > 0 && packed >= ordered) ? LINE_STATE.PACKED
                : packed > 0 ? LINE_STATE.PART
                : (rd && rd.ready) ? LINE_STATE.READY : LINE_STATE.WAITING;
            const open = counts.find(c => c.packed < c.ordered) || null;
            const tickList = group.map(l => (doc.packedLines && doc.packedLines[l.key]) || null).filter(Boolean);
            const ticks = [...tickList].sort((x, y) => num(y.at) - num(x.at));
            rows.push({
                docId: doc.id || '', ref, key: first.key, keys: group.map(l => l.key), code: str(first.erp), aliasErp: str(first.aliasErp), name: str(first.name), isPole: !!first.isPole,
                docReady: !!(rd && rd.ready),
                ordered, packed, state,
                // The numbered box(es) its ticks name; else the box type a document packed before box numbers recorded.
                boxSpread: boxSpreadOf(tickList),
                boxTracking: spreadTrackingOf(boxSpreadOf(tickList), boxes),   // a box ships once — its tracking number is on the box
                box: boxSpreadLabel(boxSpreadOf(tickList), boxes) || [...new Set(counts.map(c => lineBoxOf(doc, c.l, c.packed)).filter(Boolean))].join(', '),
                packedBy: ticks.length ? str(ticks[0].by) : '', packedAt: ticks.length ? (ticks[0].at || null) : null,
                stamps: lineStampsOf(doc, (open || counts[0]).l, coats),
            });
        });
    });
    const counted = rows.filter(r => r.state !== LINE_STATE.CLOSED && !r.noLines);
    const left = (r) => Math.max(0, r.ordered - r.packed);
    const pieces = {
        ordered: counted.reduce((n, r) => n + r.ordered, 0),
        packed: counted.reduce((n, r) => n + Math.min(r.packed, r.ordered), 0),
        // What is left of a part-packed row is ready or still coming as its DOCUMENT is.
        ready: counted.filter(r => r.state === LINE_STATE.READY || (r.state === LINE_STATE.PART && r.docReady)).reduce((n, r) => n + left(r), 0),
        waiting: counted.filter(r => r.state === LINE_STATE.WAITING || (r.state === LINE_STATE.PART && !r.docReady)).reduce((n, r) => n + left(r), 0),
    };
    // ALL PACKED is the DOCUMENTS' word, not the ticks': a document with every line ticked is still open until its
    // packing is completed (photo, box, the fulfilment to NetSuite) — and that is what "ready to ship" waits on.
    const verdict = !live ? ORDER_VERDICT.NONE : done === live ? ORDER_VERDICT.ALL_PACKED : anyWaiting ? ORDER_VERDICT.WAITING : ORDER_VERDICT.READY;
    return { rows, pieces, lines: { all: counted.length, packed: counted.filter(r => r.state === LINE_STATE.PACKED).length }, verdict };
}
