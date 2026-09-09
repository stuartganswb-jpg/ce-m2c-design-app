// HOW AN ORDER ON AN ITEM IS ROUTED — one rule, every view (Stuart 2026-09-09).
// Born from an IN-HOUSE bracket (HCUMLB415/CP) that produced a draft PO to its vendor because the
// chooser opened pre-selected to PO: "in house stays work order, it happens to be able to be
// purchased — we will need to switch to BOTH, that is the reason for it."
import assert from 'node:assert';
import { orderRouteFor, hasExplicitSourcing, ORDER_ROUTE, SOURCING, sourcingOf } from '../src/components/Shared/sourcing.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };
const V = 'Xiamen XuChang Handiwork Co. L';

// ── THE DEFECT ITSELF ────────────────────────────────────────────────────────────────
t('an EXPLICITLY in-house item with a vendor is MADE, never asked', () => {
    const specs = { sourcingMode: 'IN', isInHouse: true, vendorName: V };
    const r = orderRouteFor(specs);
    assert.strictEqual(r.route, ORDER_ROUTE.MAKE, 'HCUMLB415/CP must not become a purchase order');
    assert.ok(/switch it to BOTH/.test(r.why), 'and it should say how to make it buyable');
});
t('in-house with NO vendor is made', () => {
    assert.strictEqual(orderRouteFor({ sourcingMode: 'IN', isInHouse: true }).route, ORDER_ROUTE.MAKE);
});

// ── BOTH IS HOW YOU SAY "WE ALSO BUY IT" ─────────────────────────────────────────────
t('BOTH asks, defaulted to the WORK ORDER', () => {
    const r = orderRouteFor({ sourcingMode: 'BOTH', isInHouse: true, vendorName: V });
    assert.strictEqual(r.route, ORDER_ROUTE.ASK);
    assert.strictEqual(r.choice, 'WO', 'doing nothing must produce the recoverable answer');
});
t('BOTH with no vendor still asks — the modal offers make', () => {
    assert.strictEqual(orderRouteFor({ sourcingMode: 'BOTH', isInHouse: true }).route, ORDER_ROUTE.ASK);
});

// ── OUTSOURCED ───────────────────────────────────────────────────────────────────────
t('outsourced with a vendor buys', () => {
    const r = orderRouteFor({ sourcingMode: 'OUT', isInHouse: false, vendorName: V });
    assert.strictEqual(r.route, ORDER_ROUTE.BUY);
    assert.strictEqual(r.choice, 'PO');
});
t('outsourced with NO vendor is held, not guessed', () => {
    assert.strictEqual(orderRouteFor({ sourcingMode: 'OUT', isInHouse: false }).route, ORDER_ROUTE.NO_VENDOR);
});
t('the legacy boolean alone still reads as outsourced', () => {
    assert.strictEqual(orderRouteFor({ isInHouse: false, vendorName: V }).route, ORDER_ROUTE.BUY);
});

// ── THE ONLY THING STILL AMBIGUOUS: AN UN-MIGRATED ITEM ──────────────────────────────
t('legacy in-house WITH a vendor and no sourcingMode still asks — defaulted WO', () => {
    const r = orderRouteFor({ isInHouse: true, vendorName: V });
    assert.strictEqual(r.route, ORDER_ROUTE.ASK);
    assert.strictEqual(r.choice, 'WO', 'the old default was PO — that is the bug');
    assert.ok(/never been set/.test(r.why));
});
t('legacy in-house with NO vendor is simply made', () => {
    assert.strictEqual(orderRouteFor({ isInHouse: true }).route, ORDER_ROUTE.MAKE);
});
t('an empty spec is made, never bought', () => {
    assert.strictEqual(orderRouteFor({}).route, ORDER_ROUTE.MAKE);
    assert.strictEqual(orderRouteFor(null).route, ORDER_ROUTE.MAKE);
});

// ── NO ASK ANYWHERE DEFAULTS TO A PURCHASE ───────────────────────────────────────────
t('every ASK, whatever its cause, opens on the work order', () => {
    [{ sourcingMode: 'BOTH', vendorName: V }, { isInHouse: true, vendorName: V }]
        .map(orderRouteFor).filter(r => r.route === ORDER_ROUTE.ASK)
        .forEach(r => assert.strictEqual(r.choice, 'WO'));
});

// ── hasExplicitSourcing ──────────────────────────────────────────────────────────────
t('explicit means the three-way field was set', () => {
    assert.strictEqual(hasExplicitSourcing({ sourcingMode: 'IN' }), true);
    assert.strictEqual(hasExplicitSourcing({ sourcingMode: 'both' }), true, 'case-insensitive');
    assert.strictEqual(hasExplicitSourcing({ isInHouse: true }), false);
    assert.strictEqual(hasExplicitSourcing({ sourcingMode: '' }), false);
});
t('sourcingOf is unchanged by any of this', () => {
    assert.strictEqual(sourcingOf({ sourcingMode: 'BOTH' }), SOURCING.BOTH);
    assert.strictEqual(sourcingOf({ isInHouse: false }), SOURCING.OUT);
    assert.strictEqual(sourcingOf({}), SOURCING.IN);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
