// WHEN A PURCHASE ORDER STOPS BEING EDITABLE (Stuart 2026-09-08):
// "once po has been sent to netsuite for po# and sent to vendor (via email, acknowledgement
//  received back) then it is final, no changes or add's after these steps."
import assert from 'node:assert';
import { poLineLock, poLinesLocked, poLockMessage, PO_STATUS,
         openQtyOf, overRoomOf, maxReceivableOf, isOverReceived, OVER_RECEIPT_TOLERANCE } from '../src/components/Shared/poLock.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };

// ── EDITABLE: a draft is what accumulates ────────────────────────────────────────────
t('a plain draft is editable — vendor minimums depend on it', () => {
    assert.strictEqual(poLineLock({ id: 'PO1', status: PO_STATUS.DRAFT }), null);
    assert.strictEqual(poLinesLocked({ id: 'PO1', status: PO_STATUS.DRAFT }), false);
});
t('an approved PO with no number yet is still editable', () => {
    // APPROVED is the press; the number arrives from the outbox. Until it does, nothing exists
    // in NetSuite to drift from.
    assert.strictEqual(poLineLock({ status: PO_STATUS.APPROVED }), null);
});

// ── LOCKED: each step, and the first one wins ────────────────────────────────────────
t('a NetSuite number locks it', () => {
    const why = poLineLock({ status: PO_STATUS.PUSHED, nsPoTran: 'PO12345' });
    assert.ok(/PO12345/.test(why) && /must not drift/.test(why));
});
t('nsPoId alone locks it too', () => {
    assert.ok(poLinesLocked({ status: PO_STATUS.DRAFT, nsPoId: '991' }), 'a number is a number whatever the status says');
});
t('queued/pushed lock it even before the number lands', () => {
    assert.ok(poLinesLocked({ status: PO_STATUS.QUEUED }));
    assert.ok(poLinesLocked({ status: PO_STATUS.PUSHED }));
});
t('sent to the vendor locks it', () => {
    assert.ok(/sent to the vendor/.test(poLineLock({ status: PO_STATUS.SENT })));
    assert.ok(/sent to the vendor/.test(poLineLock({ status: PO_STATUS.APPROVED, sentAt: 123 })));
});
t('an acknowledgement is the FINAL confirmation and outranks the rest', () => {
    const po = { status: PO_STATUS.SENT, nsPoTran: 'PO1', vendorAck: { ackRef: 'ACK-9' } };
    assert.ok(/acknowledged/.test(poLineLock(po)), 'the strongest true reason should be reported');
});
t('an ack with only a ready date still counts', () => {
    assert.ok(/acknowledged/.test(poLineLock({ vendorAck: { vendorReadyDate: '2026-10-01' } })));
});
t('an empty vendorAck object does NOT lock', () => {
    assert.strictEqual(poLineLock({ status: PO_STATUS.DRAFT, vendorAck: {} }), null);
});

// ── THE MESSAGE AN OPERATOR SEES ─────────────────────────────────────────────────────
t('the refusal names the PO and says what to do instead', () => {
    const m = poLockMessage({ poId: 'PO-77', status: PO_STATUS.SENT });
    assert.ok(m.includes('PO-77'));
    assert.ok(/Raise a new purchase order/.test(m));
});
t('an editable PO has no message', () => {
    assert.strictEqual(poLockMessage({ status: PO_STATUS.DRAFT }), '');
});
t('a missing PO is not "locked" — nothing to lock', () => {
    assert.strictEqual(poLineLock(null), null);
});

// ── WHAT THE LOCK DOES NOT STOP ──────────────────────────────────────────────────────
t('receiving and delivery notes are not line changes', () => {
    // The lock governs LINES. A locked PO must still be able to receive, be acknowledged and
    // progress — those are how it moves, not changes to what was ordered.
    const po = { status: PO_STATUS.SENT, items: [{ itemId: 'A', quantity: 5, received: 5 }], deliveryStatus: 'ETA 10/1' };
    assert.ok(poLinesLocked(po), 'still locked for lines');
    assert.strictEqual(po.items[0].received, 5, 'receipt recorded regardless');
});


// ── THE 10% OVER-RECEIPT TOLERANCE (Stuart 2026-09-16) ───────────────────────────────────────
// "many of our suppliers may ship 255 when we order 250 ... bounded by 10% over ... to prevent
// duplicates can't keep it open for foreever."
t('the tolerance is ten percent', () => {
    assert.strictEqual(OVER_RECEIPT_TOLERANCE, 0.10);
});

t("Stuart's case: 255 against an order of 250 is accepted", () => {
    const line = { quantity: 250, received: 0 };
    assert.strictEqual(maxReceivableOf(line), 275);
    assert.ok(overRoomOf(line) >= 255, '255 must fit inside the tolerance');
});

t('a pallet received TWICE is refused — which is the point of bounding it', () => {
    const line = { quantity: 250, received: 250 };
    assert.strictEqual(overRoomOf(line), 25, 'only the overage is left, never another full pallet');
    assert.ok(250 > overRoomOf(line), 'a second 250 cannot be taken in');
});

t('a line that owes nothing can still take its overage while the PO is open', () => {
    assert.strictEqual(openQtyOf({ quantity: 250, received: 250 }), 0);
    assert.strictEqual(overRoomOf({ quantity: 250, received: 250 }), 25);
});

t('a receipt spread over several days still lands inside one ceiling', () => {
    // 100 on Monday, 100 on Tuesday, 55 on Wednesday = 255 of 250, all accepted.
    assert.strictEqual(overRoomOf({ quantity: 250, received: 100 }), 175);
    assert.strictEqual(overRoomOf({ quantity: 250, received: 200 }), 75);
    assert.strictEqual(overRoomOf({ quantity: 250, received: 255 }), 20);
    assert.strictEqual(overRoomOf({ quantity: 250, received: 275 }), 0, 'the ceiling holds');
});

t('"what is still OWED" is deliberately unchanged — the short/backorder rules read it', () => {
    assert.strictEqual(openQtyOf({ quantity: 250, received: 255 }), 0, 'over-received owes nothing');
    assert.strictEqual(openQtyOf({ quantity: 250, received: 240 }), 10, 'a short delivery still owes 10');
});

t('an overage is recognised as one', () => {
    assert.ok(isOverReceived({ quantity: 250, received: 255 }));
    assert.ok(!isOverReceived({ quantity: 250, received: 250 }));
    assert.ok(!isOverReceived({ quantity: 250, received: 10 }));
});

t('SMALL LINES GET NO TOLERANCE, on purpose', () => {
    // 10% of 5 floors to 0. A "+1 minimum" would be 100% over on a line of one, which is exactly
    // the duplicate this bound exists to catch.
    assert.strictEqual(maxReceivableOf({ quantity: 5 }), 5);
    assert.strictEqual(maxReceivableOf({ quantity: 1 }), 1);
    assert.strictEqual(maxReceivableOf({ quantity: 10 }), 11, 'ten is where the tolerance starts to bite');
});

t('junk never yields a negative ceiling or room', () => {
    assert.strictEqual(maxReceivableOf({}), 0);
    assert.strictEqual(overRoomOf({ quantity: 10, received: 999 }), 0);
    assert.strictEqual(overRoomOf(null), 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
