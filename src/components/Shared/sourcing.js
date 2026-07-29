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
