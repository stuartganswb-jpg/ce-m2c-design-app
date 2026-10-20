// ── AN INVOICE'S DATES: SHIPPED, AND DUE (Stuart 2026-10-20) ────────────────────────────────────────────────────────
// "on the invoice the ship date needs to be the date of the fulfillment not the sales order entry date and we need to show
// due date based on the terms code." Both invoices (Order Entry's and the CRM's) printed the order's entry date and the CRM's
// copy of the customer's terms.
//   · SHIP DATE = when the order left: the UPS shipment's stamp (`shippedAt`, the Fulfilment tab) — else when it was packed
//     and its NetSuite fulfilment sent (`orderPackedAt` / `packedAt`, the latest of the order's pack documents). Never the
//     entry date; null until it has shipped.
//   · TERMS = the ORDER's own NetSuite terms, kept on it by the ship check (`nsTerms`, Shared/shipClearance.termsStampOf — the
//     hold stamp carries them too) — else the customer's on file.
//   · DUE DATE = ship date + the term's days (Shared/nsTerms.termDaysOf); 0 days = due on receipt; unknown term = none said.
// Pure. Harness: scripts/invoiceDates.test.mjs.
import { termDaysOf, termNameOf } from './nsTerms.js';

const DAY = 86400000;
const msOf = (v) => {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v.seconds) return v.seconds * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
};

/** When the order shipped — the latest UPS stamp, else the latest pack stamp across the order and its pack documents; 0 = not yet. */
export const shipDateOf = ({ order = null, packDocs = [] } = {}) => {
    const all = [order, ...(Array.isArray(packDocs) ? packDocs : [])].filter(Boolean);
    const shipped = Math.max(0, ...all.map(d => msOf(d.shippedAt)));
    if (shipped > 0) return shipped;
    return Math.max(0, ...all.map(d => Math.max(msOf(d.orderPackedAt), msOf(d.packedAt))));
};

/** The order's own terms (id or name) — kept by the ship check on the order or, for a CPQ order, on its pack documents —
 *  else the customer's. */
const keptTermsOf = (d) => (d && ((d.nsTerms && (d.nsTerms.id || d.nsTerms.name)) || (d.shipHold && (d.shipHold.termId || d.shipHold.termName)))) || '';
export const orderTermsOf = ({ order = null, packDocs = [], customer = null } = {}) => {
    const kept = keptTermsOf(order) || (Array.isArray(packDocs) ? packDocs : []).map(keptTermsOf).find(Boolean) || '';
    return String(kept || (customer && customer.terms) || '').trim();
};

/** → { at, receipt } — `at` the due day (ms) or 0 when it cannot be said; `receipt` true when due on receipt. */
export const dueDateOf = ({ shipMs = 0, terms = '' } = {}) => {
    const days = termDaysOf(terms);
    if (!(shipMs > 0) || days == null) return { at: 0, receipt: false };
    return { at: shipMs + days * DAY, receipt: days === 0 };
};

/** The three rows an invoice prints: ship date, terms (by name), due date. Dates as the caller formats them. */
export const invoiceDatesOf = ({ order = null, packDocs = [], customer = null, fmt = (ms) => new Date(ms).toLocaleDateString() } = {}) => {
    const shipMs = shipDateOf({ order, packDocs });
    const terms = orderTermsOf({ order, packDocs, customer });
    const due = dueDateOf({ shipMs, terms });
    return {
        shipDate: shipMs > 0 ? fmt(shipMs) : '',
        terms: termNameOf(terms),
        dueDate: due.at > 0 ? (due.receipt ? `${fmt(due.at)} — due on receipt` : fmt(due.at)) : '',
    };
};
