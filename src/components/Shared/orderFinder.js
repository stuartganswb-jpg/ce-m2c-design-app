// FIND AN ORDER BY ITS NUMBER — one search across both kinds of sales order.
//
// Until now the only way to reach an open order was to remember whose it was, find that customer
// in the CRM and read down their card (Stuart 2026-09-26). This is the shortcut: type the SO
// number, get the order, land on its real card.
//
// It deliberately does NOT render an order. The card carries the rules — in production, posted to
// NetSuite, who may reopen — and a second card would be a second copy of those rules that drifts
// the first time one changes. This module only says WHICH order and WHOSE, and the caller opens
// the card that already exists.
//
// Two record types answer to "a sales order" here, and staff should not have to know which:
//   CPQ  — a `jobs` document that crossed into the order group (Approved onward).
//   OE   — an `hq_sales_orders` document written by Order Entry / Quick Ship.

// The order group on the customer card: a job crosses at APPROVED, or the moment NetSuite has it.
const ORDER_STATUSES = ['APPROVED', 'IN_PRODUCTION', 'SO_CONFIRMED'];
// Archived states — the same list the card's active pipeline excludes.
const ARCHIVED_STATUSES = ['COMPLETED', 'SHIPPED', 'CANCELLED', 'TRANSMITTED_TO_ERP'];
// An Order Entry order is done when it is closed, shipped or cancelled. Packed but not yet shipped
// still counts as open — it is on the floor, and that is exactly when someone comes looking.
const OE_DONE_STATUSES = ['Closed', 'Shipped', 'Cancelled'];

// An order is anything that BECAME one, whatever its status says now. The card's own test can lean
// on the status alone because archived jobs never reach the active pipeline — this searches the
// whole book, so a completed order still has to be recognised as an order or the "it exists, it is
// just closed" answer could never be given for the very orders people come looking for.
export const isOrderJob = (j) => !!j && (
    ORDER_STATUSES.includes(String(j.status || ''))
    || !!j.netsuiteSalesOrderId || !!j.netsuiteSalesOrderNo || !!j.soNum || !!j.soId
);

// Numbers get typed however they are read: "SO 12345", "so-12345", "12345". Strip everything that
// is not a letter or a digit so all three find the same order.
const norm = (v) => String(v === undefined || v === null ? '' : v).replace(/[^a-z0-9]/gi, '').toUpperCase();

// Every number this order answers to. A falsy field simply is not one of them.
export function numbersOf(match) {
    return (match.kind === 'OE'
        ? [match.raw.soId, match.raw.id, match.raw.nsInternalId, match.raw.nsSalesOrderNo]
        : [match.raw.netsuiteSalesOrderNo, match.raw.netsuiteSalesOrderId, match.raw.soNum, match.raw.soId,
            match.raw.quoteNo, match.raw.jobId, match.raw.id]
    ).filter(Boolean).map(String);
}

const msOf = (v) => (v && typeof v === 'object' && v.seconds ? v.seconds * 1000 : Number(v) || 0);

const cpqMatch = (j) => ({
    kind: 'CPQ', id: String(j.id || ''), raw: j,
    customerId: String((j.customer && j.customer.id) || ''),
    customerName: String((j.customer && j.customer.name) || ''),
    number: String(j.netsuiteSalesOrderNo || j.soNum || j.quoteNo || j.jobId || j.id || ''),
    soNumber: String(j.netsuiteSalesOrderNo || (j.netsuiteSalesOrderId ? `NetSuite #${j.netsuiteSalesOrderId}` : '')),
    status: String(j.status || ''),
    jobName: String(j.jobName || ''),
    sidemark: String(j.orderSidemark || j.sidemark || ''),
    poNumber: String(j.poNumber || ''),
    open: !j.deleted && !ARCHIVED_STATUSES.includes(String(j.status || '')),
    createdAtMs: msOf(j.createdAt),
});

const oeMatch = (o) => ({
    kind: 'OE', id: String(o.id || ''), raw: o,
    customerId: String(o.customerId || ''),
    customerName: String(o.customer || ''),
    number: String(o.soId || o.id || ''),
    soNumber: String(o.soId || ''),
    status: String(o.status || ''),
    jobName: String(o.jobName || ''),
    sidemark: String(o.orderSidemark || o.sidemark || ''),
    poNumber: String(o.poNumber || ''),
    open: !o.deleted && !OE_DONE_STATUSES.includes(String(o.status || '')),
    createdAtMs: msOf(o.createdAt),
});

// Both lists are already in memory for the brand, so this costs nothing and answers as you type.
//
// `openOnly` is the default because the question is "where is this order". When it finds nothing
// open, the caller is told whether a CLOSED one matches rather than being shown a bare "no
// results" for an order that plainly exists — a wrong "not found" sends someone hunting in
// NetSuite for a record that was here all along.
export function findOrders({ jobs = [], oeOrders = [], term = '', openOnly = true, limit = 25 } = {}) {
    const q = norm(term);
    if (q.length < 2) return { matches: [], closedCount: 0, term: String(term || '').trim() };
    const all = [
        ...(jobs || []).filter(isOrderJob).map(cpqMatch),
        ...(oeOrders || []).map(oeMatch),
    ];
    const hit = all.filter((m) => numbersOf(m).some((n) => norm(n).includes(q)));
    const open = hit.filter((m) => m.open);
    const chosen = openOnly ? open : hit;
    return {
        matches: chosen.sort((a, b) => b.createdAtMs - a.createdAtMs).slice(0, limit),
        // What is being withheld, so the empty state can say so instead of implying nothing exists.
        closedCount: hit.length - open.length,
        term: String(term || '').trim(),
    };
}
