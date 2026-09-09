// ── THE PURCHASE-ORDER VOCABULARY AND THE FINALITY RULE ───────────────────────────────────────
// Split out of Shared/purchaseOrders so it can be TESTED. That module imports firebase, so nothing
// in it can run under node — and a rule this firm ("no changes or add's after these steps") is
// exactly the kind that must be provable, not merely written down. purchaseOrders re-exports
// every name here, so no caller changes and there is still one definition of each.

export const PO_STATUS = {
    DRAFT: 'Draft',                       // created, previewed, not yet approved — goes nowhere
    APPROVED: 'Approved',                 // approved, waiting on the outbox worker
    QUEUED: 'Queued to NetSuite',
    PUSHED: 'Pushed to NetSuite',         // has its real PO number
    SENT: 'Sent to Vendor',
    SENT_TO_PLATER: 'Sent to Plater',     // the WMS weekly plating shipment creates AND sends in one act
    PARTIAL: 'Partially Received',        // some arrived — OPEN, and the one people chase
    RECEIVED: 'Received',                 // everything arrived
    CLOSED: 'Closed',
    DELETED: 'Deleted',                   // soft delete
};

// ── WHICH POs ARE STILL LIVE ───────────────────────────────────────────────────────────────────
// The RTG board asked `status == 'Approved'` and nothing else, so a PO was invisible to it for the
// whole of its real life: born Draft, then Queued → Pushed → Sent, never passing through the one
// status the board looked for. Every reader asks THIS instead, so the board, the Open POs review
// and the receiving station cannot drift apart, and a status added later is honoured everywhere at
// once. Terminal is only: everything arrived, or somebody closed or deleted it.
export const PO_TERMINAL_STATUSES = [PO_STATUS.RECEIVED, PO_STATUS.CLOSED, PO_STATUS.DELETED];
export const isOpenPo = (po) => !!po && !po.deleted && !PO_TERMINAL_STATUSES.includes(String(po.status || ''));
// What is still owed on one line: ordered minus what has actually ARRIVED. Never header status —
// a PO for 5 that returned 4 with 1 short still owes 1, and reading the header would hide it.
export const openQtyOf = (line) => Math.max(0, (Number(line && line.quantity) || 0) - (Number(line && line.received) || 0));
export const poFullyReceived = (po) => ((po && po.items) || []).every(l => openQtyOf(l) === 0);
export const isDraftPo = (po) => String((po && po.status) || '') === PO_STATUS.DRAFT;
export const hasNsNumber = (po) => !!(po && (po.nsPoTran || po.nsPoId));
export const poRef = (po) => String((po && (po.nsPoTran || po.poId || po.id)) || '');

// ── WHEN A PURCHASE ORDER STOPS BEING EDITABLE (Stuart 2026-09-08) ─────────────────────────────
// "we are firm — once po has been sent to netsuite for po# and sent to vendor (via email,
//  acknowledgement received back) then it is final, no changes or add's after these steps
//  (acknowledgement attached = final confirmation)."
//
// Lines accumulate freely while a PO is a DRAFT — that is the whole point of
// addToOpenPurchaseOrder and of vendor minimums. The moment it has a NetSuite number, that number
// exists in NetSuite and our copy must not drift from it; once it is with the vendor, they are
// quoting and scheduling against what they were sent; once acknowledged, it is a mutual record.
// Each step is stricter than the last, so the lock lands at the FIRST of them and the reason
// returned is the strongest one true.
//
// This governs LINES ONLY — quantities, rates, adds, removals. Receiving, delivery notes, the
// acknowledgement itself and the status progression are how a locked PO is meant to keep moving,
// and none of them changes what was ordered.
export const poLineLock = (po) => {
    if (!po) return null;
    if (po.vendorAck && (po.vendorAck.ackRef || po.vendorAck.vendorReadyDate || po.vendorAck.at)) {
        return 'the vendor has acknowledged it — that acknowledgement is the final confirmation';
    }
    if (String(po.status || '') === PO_STATUS.SENT || po.sentAt) return 'it has been sent to the vendor';
    if (hasNsNumber(po)) return `NetSuite has given it a number (${po.nsPoTran || po.nsPoId}) — our copy must not drift from it`;
    if ([PO_STATUS.QUEUED, PO_STATUS.PUSHED].includes(String(po.status || ''))) return 'it is on its way to NetSuite for a number';
    return null;
};
export const poLinesLocked = (po) => !!poLineLock(po);

/** The sentence to show an operator who tried to change a locked PO. */
export const poLockMessage = (po) => {
    const why = poLineLock(po);
    return why ? `${poRef(po)} is final — ${why}.\n\nNothing can be added or changed on it. Raise a new purchase order for anything further; the vendor needs to see a new document, not a quietly different one.` : '';
};
