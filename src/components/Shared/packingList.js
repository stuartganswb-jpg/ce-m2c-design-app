// ══ THE PACKING LIST — what was ORDERED beside what was PACKED ══════════════════════════════
//
// Stuart 2026-09-11: "the packing list has to reflect what was packed … qty ordered and qty
// shipped side by side … no prices … the packer scans/counts as they put into the box; poles are
// counted as the piece, not the length." NetSuite keeps the quote, the sales order, the
// fulfilments and the invoice on one audit stream; this is ours. The ORDERED side is the sales
// order's own customer lines (Shared/lineClassification.customerDocLines, the reader every
// customer document uses). The SHIPPED side is the floor's fact: each pack document's lines
// (Shared/pickLines.packLinesOf) and the packer's count on each tick (`packedLines.<key>.qty`,
// S3's stamp); a tick made before the count existed falls back to the line quantity less any
// pick short. The two sides meet by ITEM CODE; an ordered line nothing packed is flagged, and a
// packed line nothing ordered is listed — a miss is exactly what this document exists to catch.
//
// Pure — no React, no Firestore — so the CRM card and the WMS pack screen print the SAME list
// from the same builder, and every rule is in scripts/packingList.test.mjs. Owner: S2 (the order's
// spine); the form is S1's, the count is S3's.
import { packLinesOf } from './pickLines.js';

const up = (s) => String(s || '').trim().toUpperCase();
const num = (v) => Number(v) || 0;
export const codeOf = (l) => up((l && (l.erp || l.legacyErpId || l.partId || l.code || l.itemCode)) || '');
export const toMs = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : (v ? (Date.parse(v) || 0) : 0));

export const LINE_STATUS = Object.freeze({
    MATCH: 'MATCH',             // shipped = ordered
    SHORT: 'SHORT',             // shipped < ordered (some packed)
    OVER: 'OVER',               // shipped > ordered
    NOT_PACKED: 'NOT_PACKED',   // ordered, nothing packed
    NOT_ORDERED: 'NOT_ORDERED', // packed, not on the order
});

// A line that is goods in a box. Fees, discount / net rows, headers and display-only rows are
// paper, not parcels. (customerDocLines on a non-money type already drops display-only rows.)
export const isPhysicalLine = (l) => !!l && !l.isHeader && !l.isDiscount && !l.isNetLine && !l.isFee && !l.isDisplayOnly && num(l.qty ?? l.quantity) > 0;

/** The packer's count for one pack line of one pack document. Untouched tick = not packed. */
export const packedQtyOf = (doc, line) => {
    const tick = doc && doc.packedLines && line && doc.packedLines[line.key];
    if (!tick) return 0;
    if (tick.qty !== undefined && tick.qty !== null) return Math.max(0, num(tick.qty));
    // Ticked before the count existed (pre-2026-09-11): the line less any short recorded at pick.
    const short = (doc.pickShorts || [])
        .filter(s => up(s.itemId) === up(line.erp))
        .reduce((n, s) => n + Math.max(0, num(s.target) - num(s.picked)), 0);
    return Math.max(0, num(line.qty) - short);
};

/** Every packed line across the order's pack documents, with the count. */
export const packedLinesOf = (packDocs = []) =>
    (packDocs || []).flatMap(doc => packLinesOf(doc).map(l => ({
        docId: doc.id || '', key: l.key, code: up(l.erp), name: l.name || '', isPole: !!l.isPole,
        qtyLine: num(l.qty), qtyPacked: packedQtyOf(doc, l),
    })));

/**
 * Build the packing list.
 *   ordered   — the sales order's customer lines (non-money reader output)
 *   packDocs  — the order's pack documents (fin_workorders; a QUICKSHIP order passes its SO doc)
 *   shipDate  — optional; else the latest pack completion
 *   tracking  — optional; else the union of the documents' trackingNumbers
 */
export function packingListOf({ ordered = [], packDocs = [], shipDate = null, tracking = null } = {}) {
    const packed = packedLinesOf(packDocs);
    // Packed quantity pooled by code, consumed in order down the ordered lines (two ordered lines
    // of one code share the pool, first line first).
    const pool = new Map();
    packed.forEach(p => { if (p.code) pool.set(p.code, (pool.get(p.code) || 0) + p.qtyPacked); });
    const lines = [];
    (ordered || []).filter(isPhysicalLine).forEach(l => {
        const code = codeOf(l);
        const qtyOrdered = num(l.qty ?? l.quantity);
        const avail = code ? (pool.get(code) || 0) : 0;
        const qtyShipped = Math.min(avail, qtyOrdered);
        if (code) pool.set(code, Math.max(0, avail - qtyShipped));
        const status = qtyShipped === 0 ? LINE_STATUS.NOT_PACKED : (qtyShipped < qtyOrdered ? LINE_STATUS.SHORT : LINE_STATUS.MATCH);
        lines.push({ code, name: l.name || l.partName || code, finish: l.finishLabel || l.finish || '', qtyOrdered, qtyShipped, status });
    });
    // Whatever is left in the pool was packed beyond the order — an OVER on a known code, or a
    // line nothing ordered. Both are listed; neither is hidden.
    const extras = [];
    pool.forEach((left, code) => {
        if (left <= 0) return;
        const own = lines.find(x => x.code === code);
        if (own) { own.qtyShipped += left; own.status = LINE_STATUS.OVER; return; }
        const p = packed.find(x => x.code === code);
        extras.push({ code, name: (p && p.name) || code, finish: '', qtyOrdered: 0, qtyShipped: left, status: LINE_STATUS.NOT_ORDERED });
    });
    const packedAt = (packDocs || []).reduce((m, d) => Math.max(m, toMs(d && d.packedAt)), 0) || null;
    const trackingOut = tracking || [...new Set((packDocs || []).flatMap(d => (d && d.trackingNumbers) || []))];
    const all = [...lines, ...extras];
    return {
        lines: all,
        shipDate: shipDate || packedAt,
        tracking: trackingOut,
        packed: (packDocs || []).length > 0 && (packDocs || []).every(d => d && d.packStatus === 'Packed'),
        complete: all.length > 0 && all.every(x => x.status === LINE_STATUS.MATCH),
        flagged: all.filter(x => x.status !== LINE_STATUS.MATCH),
        totals: { ordered: lines.reduce((n, x) => n + x.qtyOrdered, 0), shipped: all.reduce((n, x) => n + x.qtyShipped, 0) },
    };
}

/**
 * The invoice's quantities: the sales order's PRICED lines with each physical line's quantity
 * replaced by what the packing list shipped and its amount re-multiplied (Stuart 2026-09-11:
 * "sales order items and prices × packing slip qty"). Paper rows (fees, discount, net) pass
 * through untouched — their arithmetic is the money reader's (S1), not this module's.
 */
export function invoiceLinesOf({ priced = [], packingList }) {
    const pool = new Map();
    ((packingList && packingList.lines) || []).forEach(x => { if (x.code) pool.set(x.code, (pool.get(x.code) || 0) + x.qtyShipped); });
    return (priced || []).map(l => {
        if (!isPhysicalLine(l)) return l;
        const code = codeOf(l);
        const qtyOrdered = num(l.qty ?? l.quantity);
        const unit = l.price != null ? num(l.price) : (qtyOrdered ? num(l.amount) / qtyOrdered : 0);
        const avail = code ? (pool.get(code) || 0) : 0;
        const qty = Math.min(avail, qtyOrdered);
        if (code) pool.set(code, Math.max(0, avail - qty));
        return { ...l, qtyOrdered, qty, price: unit, amount: Math.round(unit * qty * 100) / 100, invoiceAdjusted: qty !== qtyOrdered };
    });
}
