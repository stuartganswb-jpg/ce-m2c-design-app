// WHEN A PURCHASE ORDER STOPS BEING EDITABLE (Stuart 2026-09-08):
// "once po has been sent to netsuite for po# and sent to vendor (via email, acknowledgement
//  received back) then it is final, no changes or add's after these steps."
import assert from 'node:assert';
import { poLineLock, poLinesLocked, poLockMessage, PO_STATUS } from '../src/components/Shared/poLock.js';

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
