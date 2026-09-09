// SOURCING MODE — how an item is replenished: we MAKE it, we BUY it, or BOTH.
// (Stuart 2026-07-28: "in H1 and H2 we have assembly items that we produce in house — work order —
// but we also buy them.")
//
// WHY A SEPARATE FIELD: `manufacturingSpecs.isInHouse` is NetSuite-fed — the item sync writes it
// from custitem26 on every import, so a third value stored there would be wiped the next time
// Stuart syncs items. `sourcingMode` is app-owned and the sync never writes it, so it survives.
//
// BOTH stores isInHouse TRUE. Every screen that never learned about BOTH keeps reading isInHouse
// and sees an in-house item — deliberately the safe direction, because a work order parks in RTG
// for review while a wrong PO is a real purchase. Only the screens that ASK (the Stock View vendor
// modal) need to know the difference.
export const SOURCING = { IN: 'IN', OUT: 'OUT', BOTH: 'BOTH' };

export const SOURCING_LABEL = { IN: 'In-House', OUT: 'Outsourced', BOTH: 'Both' };

// The one place the three-way answer is derived. An explicit sourcingMode wins; otherwise fall back
// to the legacy boolean, which is what every un-migrated item still carries.
export const sourcingOf = (specs) => {
    const m = String((specs && specs.sourcingMode) || '').toUpperCase();
    if (m === SOURCING.BOTH || m === SOURCING.OUT || m === SOURCING.IN) return m;
    return (specs && specs.isInHouse === false) ? SOURCING.OUT : SOURCING.IN;
};

export const isBothSourced = (specs) => sourcingOf(specs) === SOURCING.BOTH;

// The field patch for a chosen mode — always writes BOTH fields together so the legacy boolean and
// the new mode can never drift apart.
export const sourcingPatch = (mode) => {
    const m = String(mode || '').toUpperCase();
    if (m === SOURCING.OUT) return { isInHouse: false, sourcingMode: SOURCING.OUT };
    if (m === SOURCING.BOTH) return { isInHouse: true, sourcingMode: SOURCING.BOTH };
    return { isInHouse: true, sourcingMode: SOURCING.IN };
};

// ── HOW AN ORDER ON THIS ITEM IS ROUTED — ONE ANSWER, EVERY VIEW ───────────────────────────────
// Stuart 2026-09-09, after an IN-HOUSE bracket produced a draft PO to its vendor: "in house stays
// work order, it happens to be able to be purchased — we will need to switch to BOTH, that is the
// reason for it."
//
// The Snapshot used to treat A VENDOR ON THE RECORD as if it overrode the sourcing field: an
// in-house item that named a supplier was called "ambiguous" and the chooser opened pre-selected
// to PO. So a bracket we make became a purchase order by pressing through. But a vendor on the
// record only says who COULD supply it — saying we do both is what BOTH is for, and it is now the
// only way to say it.
//
// AN EXPLICIT MODE IS AN ANSWER, NOT A HINT. Once someone has set the three-way field in the
// Master Library, nothing here second-guesses it. Only an UN-MIGRATED item — no sourcingMode at
// all, in-house by the legacy boolean, carrying a vendor — is still genuinely uncertain, and that
// is the only case that still asks.
//
// AND AN ASK ALWAYS DEFAULTS TO THE WORK ORDER. That rule was already written at the top of this
// file for BOTH — "a work order parks in RTG for review while a wrong PO is a real purchase" — and
// the in-house-with-vendor path contradicted it. Doing nothing must produce the recoverable answer.
export const ORDER_ROUTE = { MAKE: 'MAKE', BUY: 'BUY', ASK: 'ASK', NO_VENDOR: 'NO_VENDOR' };

/** Has somebody actually answered the sourcing question on this item? */
export const hasExplicitSourcing = (specs) => {
    const m = String((specs && specs.sourcingMode) || '').toUpperCase();
    return m === SOURCING.IN || m === SOURCING.OUT || m === SOURCING.BOTH;
};

/**
 * @returns {{ route, choice, why }} — `choice` is what an ASK opens pre-selected to (always 'WO').
 */
export const orderRouteFor = (specs) => {
    const mode = sourcingOf(specs);
    const vendor = String((specs && specs.vendorName) || '').trim();
    if (mode === SOURCING.BOTH) {
        return { route: ORDER_ROUTE.ASK, choice: 'WO', why: 'flagged BOTH — we make it and we buy it' };
    }
    if (mode === SOURCING.OUT) {
        return vendor
            ? { route: ORDER_ROUTE.BUY, choice: 'PO', why: 'outsourced' }
            : { route: ORDER_ROUTE.NO_VENDOR, choice: 'PO', why: 'outsourced with no vendor set' };
    }
    // IN-HOUSE. Explicit means made, full stop — a vendor on the record is not a second opinion.
    if (hasExplicitSourcing(specs)) {
        return { route: ORDER_ROUTE.MAKE, choice: 'WO', why: 'in-house — switch it to BOTH if it should also be buyable' };
    }
    return vendor
        ? { route: ORDER_ROUTE.ASK, choice: 'WO', why: 'in-house by the legacy flag but carries a vendor — sourcing has never been set' }
        : { route: ORDER_ROUTE.MAKE, choice: 'WO', why: 'in-house' };
};
