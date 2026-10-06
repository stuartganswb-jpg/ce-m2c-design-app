// ── NUMBERED BOXES — an order's boxes, and which box each packed piece is in (Stuart 2026-10-06) ──────────────
// "add a field to create box#, it could be multiples" · split a line across boxes: "yes" · box labels: "yes".
// Until now the pack bench recorded a box TYPE per half of a document (packBoxes.SMALL / .POLE), and only when the
// document's packing was completed: two documents both "in Small Box A" could not be told apart, a line ticked on an
// open document had no box, and nobody could say "it is in box 2 of 3". Now:
//   · AN ORDER HAS BOXES, NUMBERED 1, 2, 3 … — one list, on the SALES ORDER (`orderBoxes: [{ no, type, by, at }]`), so
//     every document of the order shares the numbering: a later document can add to Box 1 or open Box 3. (A pack
//     document with no sales order on file keeps the list on itself.) Each box carries its TYPE — the standard box it
//     is — which is what the two box pickers used to ask for.
//   · A PACKED LINE SAYS WHICH BOX — the tick carries `boxes: [{ no, qty }]`. The count on the tick (`qty`) stays where
//     it has always been, so the packing list and the invoice quantities read exactly as before.
//   · A LINE CAN BE SPLIT — some of its pieces moved into another box (moveIntoBox).
//   · packBoxes IS STILL WRITTEN at completion, from the ticks (packBoxesOfTicks): the type of the first box each half
//     went in — what a document packed before box numbers carries, and still the Fulfilment tab's fallback.
//   · A BOX SHIPS ONCE (Stuart 2026-10-06: "your proposal is good, go ahead"). Fulfilment ships one DOCUMENT at a
//     time and a box can hold pieces of two, so the shipment stamps the BOX (`shippedAt`, `trackingNumber`,
//     `shipmentId` … on its entry in the order's list): a later document of the order is not offered that box again,
//     a shipped box cannot be packed into, and SO Pack shows the tracking number per box.
// Pure — the WMS pack bench writes, SO Pack reads. Harness: scripts/orderBoxes.test.mjs.

const num = (v) => Number(v) || 0;
const str = (v) => String(v == null ? '' : v).trim();

/** Which half of a document a line is — the pack bench's own grouping (its `cat`), poles → the pole box. */
export const boxSlotOf = (line) => {
    if (!line) return 'SMALL';
    if (line.cat != null) return line.cat === 'POLE' ? 'POLE' : 'SMALL';
    return line.isPole ? 'POLE' : 'SMALL';
};

// ── the order's boxes ─────────────────────────────────────────────────────────────────────────────────────────
/** The order's boxes, in number order. `home` = the document the list lives on (the sales order). */
// Every field a box carries rides through (its shipment stamps live on it) — the list is read, changed and
// written back whole, and a reader that kept only the fields it knew would erase the rest.
export const orderBoxesOf = (home) => (Array.isArray(home && home.orderBoxes) ? home.orderBoxes : [])
    .filter(b => b && num(b.no) > 0)
    .map(b => ({ ...b, no: num(b.no), type: str(b.type), by: str(b.by), at: b.at || null }))
    .sort((a, b) => a.no - b.no);

/**
 * WHERE an order's box list lives: on its sales order, so every document of the order shares the numbering — the
 * order itself when the pack document IS the order (Order Entry), the pack document when no sales order is on file.
 * ONE resolver, used by the pack bench (which writes the list) and the Fulfilment tab (which stamps it).
 * @param isOrderDoc (doc) → is this pack document a sales order itself?
 * @returns {{ coll: 'hq_sales_orders'|'fin_workorders', id, data, so }}
 */
export const boxHomeFor = (job, { soIndex = {}, isOrderDoc = () => false } = {}) => {
    if (!job) return null;
    if (isOrderDoc(job)) return { coll: 'hq_sales_orders', id: job.id, data: job, so: job };
    const so = soIndex[String(job.soAppId || '')] || soIndex[String(job.salesOrderId || '')] || soIndex[String(job.orderKey || '')] || null;
    return so ? { coll: 'hq_sales_orders', id: so.id, data: so, so } : { coll: 'fin_workorders', id: job.id, data: job, so: null };
};

export const nextBoxNoOf = (boxes = []) => (boxes || []).reduce((m, b) => Math.max(m, num(b && b.no)), 0) + 1;
export const boxOf = (boxes = [], no) => (boxes || []).find(b => num(b.no) === num(no)) || null;
export const boxName = (box) => (box ? `Box ${box.no}${box.type ? ` · ${box.type}` : ''}` : '');

/** Why a box may not be added, or ''. A box is a choice, not a blank (Stuart 2026-09-11: "force box choice"). */
export const newBoxRefusal = ({ type } = {}) => (str(type) ? '' : 'Choose the box type first — the list comes from HQ → 15. Packaging → Standard boxes.');

/** The list with one more box: the next number, the type chosen. → { no, list } */
export const withNewBox = (boxes = [], { type = '', by = '', now = Date.now() } = {}) => {
    const no = nextBoxNoOf(boxes);
    return { no, list: [...(boxes || []), { no, type: str(type), by: str(by), at: now }] };
};

// ── a packed line's boxes ─────────────────────────────────────────────────────────────────────────────────────
/** Where a tick's pieces are: [{ no, qty }] in box order. A tick from before box numbers → []. */
export const tickBoxesOf = (tick) => (Array.isArray(tick && tick.boxes) ? tick.boxes : [])
    .map(b => ({ no: num(b && b.no), qty: num(b && b.qty) }))
    .filter(b => b.no > 0 && b.qty > 0)
    .sort((a, b) => a.no - b.no);
/** The packer's count on a tick (the packing list's own reading: the count, else the line). */
export const tickQtyOf = (tick, line) => (tick ? ((tick.qty !== undefined && tick.qty !== null) ? Math.max(0, num(tick.qty)) : num(line && line.qty)) : 0);
/** Packed pieces of a line that are in no box yet. */
export const unboxedQtyOf = (tick, line) => Math.max(0, tickQtyOf(tick, line) - tickBoxesOf(tick).reduce((n, b) => n + b.qty, 0));

/** The tick written when a line is packed — into the open box, whole. */
export const tickIntoBox = (line, no, { by = '', at = Date.now() } = {}) => {
    const qty = num(line && line.qty) || 1;
    return { at, by, qty, ...(num(no) > 0 ? { boxes: [{ no: num(no), qty }] } : {}) };
};

/**
 * Move `count` pieces of a packed line into box `toNo` (the split). Pieces in no box go first; then they come out of
 * the line's other boxes, the fullest first.
 * @returns {{ ok: boolean, boxes?: Array<{no, qty}>, msg?: string, movable: number }}
 */
export function moveIntoBox(tick, line, toNo, count) {
    const to = num(toNo), total = tickQtyOf(tick, line);
    const cur = tickBoxesOf(tick);
    const already = cur.filter(b => b.no === to).reduce((n, b) => n + b.qty, 0);
    const movable = Math.max(0, total - already);
    if (!tick) return { ok: false, movable: 0, msg: 'This line is not packed yet.' };
    if (!(to > 0)) return { ok: false, movable, msg: 'Open a box first.' };
    if (!movable) return { ok: false, movable, msg: `All ${total} are already in Box ${to}.` };
    const n = Math.floor(num(count));
    if (!(n >= 1) || n !== num(count) || n > movable) return { ok: false, movable, msg: `Enter a whole number from 1 to ${movable}.` };
    let need = n - Math.min(n, unboxedQtyOf(tick, line));          // what must come out of other boxes
    const others = cur.filter(b => b.no !== to).map(b => ({ ...b })).sort((a, b) => b.qty - a.qty || a.no - b.no);
    others.forEach(b => { const take = Math.min(b.qty, need); b.qty -= take; need -= take; });
    const boxes = [...others.filter(b => b.qty > 0), { no: to, qty: already + n }].sort((a, b) => a.no - b.no);
    return { ok: true, movable, boxes };
}

/** Pieces per box across several ticks (one part on several lines): [{ no, qty }]. */
export const boxSpreadOf = (ticks = []) => {
    const by = new Map();
    (ticks || []).forEach(t => tickBoxesOf(t).forEach(b => by.set(b.no, (by.get(b.no) || 0) + b.qty)));
    return [...by.entries()].map(([no, qty]) => ({ no, qty })).sort((a, b) => a.no - b.no);
};
/** "Box 2 · Tube 10ft" when it is all in one box · "Box 1 ×8 · Box 2 ×6" when it is split · '' when in none. */
export const boxSpreadLabel = (spread = [], boxes = []) => {
    if (!spread || !spread.length) return '';
    if (spread.length === 1) return boxName(boxOf(boxes, spread[0].no) || { no: spread[0].no, type: '' });
    return spread.map(b => `Box ${b.no} ×${b.qty}`).join(' · ');
};

// ── what is in each box ───────────────────────────────────────────────────────────────────────────────────────
/**
 * The contents of every box of the order, across its pack documents.
 * @param docs     the order's pack documents      @param linesOf  (doc) → its pack lines (riders are not pieces)
 * @returns {Object<number, { pcs: number, items: Array<{ code, name, qty }> }>}
 */
export function boxContentsOf({ docs = [], linesOf = () => [] } = {}) {
    const out = {};
    (docs || []).forEach(doc => {
        if (!doc || !doc.packedLines) return;
        (linesOf(doc) || []).filter(l => l && !l.rider).forEach(line => {
            tickBoxesOf(doc.packedLines[line.key]).forEach(b => {
                const box = out[b.no] || (out[b.no] = { pcs: 0, items: [] });
                const code = str(line.erp), name = str(line.name);
                const hit = box.items.find(x => x.code === code && x.name === name);
                if (hit) hit.qty += b.qty; else box.items.push({ code, name, qty: b.qty });
                box.pcs += b.qty;
            });
        });
    });
    return out;
}

/** Why a box may not be removed, or ''. Only the LAST box, and only empty — numbers never have a gap. */
export const boxRemovalRefusal = (boxes = [], no, contents = {}) => {
    const n = num(no);
    if (!boxOf(boxes, n)) return `There is no Box ${n} on this order.`;
    if (isBoxShipped(boxOf(boxes, n))) return `Box ${n} has shipped${boxOf(boxes, n).trackingNumber ? ` (${boxOf(boxes, n).trackingNumber})` : ''} — it stays on the order.`;
    if (contents[n] && contents[n].pcs > 0) return `Box ${n} has ${contents[n].pcs} piece(s) in it — move them to another box first.`;
    if (n !== nextBoxNoOf(boxes) - 1) return `Only the last box (Box ${nextBoxNoOf(boxes) - 1}) can be removed, so the numbers never have a gap. Box ${n} can stay empty, or be used.`;
    return '';
};

// ── completing a document ─────────────────────────────────────────────────────────────────────────────────────
/** The packed lines of a document with pieces in no box. */
export const unboxedLinesOf = (doc, lines = []) => (lines || [])
    .filter(l => l && !l.rider && doc && doc.packedLines && doc.packedLines[l.key] && unboxedQtyOf(doc.packedLines[l.key], l) > 0);

/** Why a document's packing may not be completed yet as far as its boxes go, or ''. */
export const boxCompleteBlocker = (doc, lines = []) => {
    const loose = unboxedLinesOf(doc, lines);
    if (!loose.length) return '';
    return `${loose.length} packed line${loose.length === 1 ? ' is' : 's are'} not in a box yet (${loose.slice(0, 4).map(l => str(l.erp) || str(l.name)).join(', ')}${loose.length > 4 ? '…' : ''}) — open a box and put ${loose.length === 1 ? 'it' : 'them'} in`;
};

/**
 * The box TYPES of a document's two halves, as the Fulfilment tab reads them (packBoxes.SMALL / .POLE): the type of
 * the first box each half went in. A half with nothing boxed is ''.
 */
export const packBoxesOfTicks = (doc, lines = [], boxes = []) => {
    const first = { SMALL: 0, POLE: 0 };
    (lines || []).filter(l => l && !l.rider).forEach(l => {
        const where = tickBoxesOf(doc && doc.packedLines && doc.packedLines[l.key]);
        if (!where.length) return;
        const slot = boxSlotOf(l);
        first[slot] = first[slot] ? Math.min(first[slot], where[0].no) : where[0].no;
    });
    const typeOf = (no) => (no ? str((boxOf(boxes, no) || {}).type) : '');
    return { SMALL: typeOf(first.SMALL), POLE: typeOf(first.POLE) };
};

/** The boxes a document's pieces are in, for its completion confirm: ["Box 1 · Small Box A — 12 pcs", …]. */
export const docBoxLinesOf = (doc, lines = [], boxes = []) => {
    const spread = boxSpreadOf((lines || []).filter(l => l && !l.rider).map(l => doc && doc.packedLines && doc.packedLines[l.key]).filter(Boolean));
    return spread.map(b => `${boxName(boxOf(boxes, b.no) || { no: b.no, type: '' })} — ${b.qty} pc${b.qty === 1 ? '' : 's'}`);
};

// ── a box ships once ──────────────────────────────────────────────────────────────────────────────────────────
export const isBoxShipped = (box) => !!(box && box.shippedAt);
/** Why a box may not be opened to pack into, or ''. A box that has left the building takes nothing more. */
export const boxOpenRefusal = (box) => (isBoxShipped(box)
    ? `Box ${box.no} has already SHIPPED${box.trackingNumber ? ` (${box.trackingNumber})` : ''} — nothing more can go in it. Open another box, or add a new one.`
    : '');

/** The boxes a document's packed pieces are in, by number — read off its ticks (a rider's tick names none). */
export const docBoxNosOf = (doc) => {
    const nos = new Set();
    Object.values((doc && doc.packedLines) || {}).forEach(t => tickBoxesOf(t).forEach(b => nos.add(b.no)));
    return [...nos].sort((a, b) => a - b);
};

/**
 * The order's box list after a shipment: each box that went out carries its tracking number and the shipment it
 * left on. A box already shipped is never stamped twice.
 * @param shipped  [{ no, trackingNumber, weight, length, width, height }] — the numbered packages of this shipment
 */
export const boxShipStampsOf = (boxes = [], shipped = [], { shipmentId = '', shipService = '', shipCarrier = 'UPS', by = '', now = Date.now(), withRef = '', withDocId = '' } = {}) => {
    const byNo = new Map((shipped || []).filter(p => p && num(p.no) > 0).map(p => [num(p.no), p]));
    return (boxes || []).map(b => {
        const p = byNo.get(num(b.no));
        if (!p || isBoxShipped(b)) return b;
        return { ...b, shippedAt: now, shippedBy: str(by), shipCarrier, shipService: str(shipService), shipmentId: str(shipmentId), trackingNumber: str(p.trackingNumber),
            shippedWith: str(withRef), shippedWithId: str(withDocId),
            weight: num(p.weight), length: num(p.length), width: num(p.width), height: num(p.height) };
    });
};

const SHIP_KEYS = ['shippedAt', 'shippedBy', 'shipCarrier', 'shipService', 'shipmentId', 'trackingNumber', 'shippedWith', 'shippedWithId', 'weight', 'length', 'width', 'height'];
/** The order's box list after a shipment is VOIDED: its boxes are back to packed-and-waiting, the others untouched. */
export const boxesAfterVoid = (boxes = [], shipmentId = '') => {
    const id = str(shipmentId);
    return (boxes || []).map(b => {
        if (!id || str(b.shipmentId) !== id) return b;
        const out = { ...b };
        SHIP_KEYS.forEach(k => { delete out[k]; });
        return out;
    });
};

/** The shipped boxes among those a part is in, with their tracking: [{ no, trackingNumber, shipService }]. */
export const spreadTrackingOf = (spread = [], boxes = []) => (spread || [])
    .map(b => boxOf(boxes, b.no)).filter(isBoxShipped)
    .map(b => ({ no: b.no, trackingNumber: str(b.trackingNumber), shipService: str(b.shipService) }));
