import assert from 'node:assert';
import { kindOf, coverCodesOf, availabilityOf, rowsFor, uncoveredCount } from '../src/components/Shared/backorderBoard.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };

// ── KIND ─────────────────────────────────────────────────────────────────────────────
t('B\'s explicit kind wins', () => {
    assert.strictEqual(kindOf({ code: 'X/N25', kind: 'plated' }), 'plated');
    assert.strictEqual(kindOf({ code: 'X/EP1', kind: 'painted' }), 'painted');
});
t('derived from the suffix when absent', () => {
    assert.strictEqual(kindOf({ code: 'HHRMBF75/EP1' }), 'plated');
    assert.strictEqual(kindOf({ code: 'HCUMSBF15/N25' }), 'painted');
});

// ── COVER CODES ──────────────────────────────────────────────────────────────────────
t('a plated line is covered only by itself', () => {
    assert.deepStrictEqual(coverCodesOf({ code: 'HHRMBF75/EP1' }), ['HHRMBF75/EP1']);
});
t('a painted line is covered by finished, /P, then mill', () => {
    assert.deepStrictEqual(coverCodesOf({ code: 'HCUMSBF15/N25' }), ['HCUMSBF15/N25', 'HCUMSBF15/P', 'HCUMSBF15']);
});
t('B\'s explicit coverCodes win', () => {
    assert.deepStrictEqual(coverCodesOf({ code: 'A/N25', coverCodes: ['A/N25', 'A'] }), ['A/N25', 'A']);
});

// ── THE SHAPE MIGRATION — both records must read ─────────────────────────────────────
t('OLD shape: available is a number for the finished code', () => {
    const line = { code: 'A/EP1', available: 4 };
    assert.deepStrictEqual(availabilityOf(line, ['A/EP1']), { 'A/EP1': 4 });
});
t('NEW shape: available is a map', () => {
    const line = { code: 'A/N25', available: { 'A/N25': 0, 'A/P': 6, A: 2 } };
    assert.deepStrictEqual(availabilityOf(line, ['A/N25', 'A/P', 'A']), { 'A/N25': 0, 'A/P': 6, A: 2 });
});
t('a missing available never yields undefined', () => {
    const out = availabilityOf({ code: 'A/N25' }, ['A/N25', 'A/P', 'A']);
    Object.values(out).forEach(v => assert.strictEqual(typeof v, 'number'));
});

// ── THE BOARD ────────────────────────────────────────────────────────────────────────
const so = (id, createdAt, lines, extra = {}) => ({ id, createdAt, customer: 'Acme', orderKey: id, backorderLines: lines, ...extra });

t('UNCOVERED when nothing is open and nothing is on the shelf', () => {
    const rows = rowsFor({ orders: [so('SO1', 1000, [{ code: 'A/EP1', qty: 8, wanted: 8, available: 0 }])] });
    assert.strictEqual(rows[0].state, 'UNCOVERED');
    assert.strictEqual(uncoveredCount(rows), 1);
});
t('COVERED when an open PO names a cover code', () => {
    const rows = rowsFor({
        orders: [so('SO1', 1000, [{ code: 'A/EP1', qty: 8 }])],
        poByCode: { 'A/EP1': [{ poNumber: 'PO2296', open: 500, due: '2026-09-18' }] },
    });
    assert.strictEqual(rows[0].state, 'COVERED');
    assert.strictEqual(rows[0].cover[0].poNumber, 'PO2296');
    assert.strictEqual(uncoveredCount(rows), 0);
});
t('COVERED by an open WORK order too, not only a PO', () => {
    const rows = rowsFor({
        orders: [so('SO1', 1000, [{ code: 'A/N25', qty: 8 }])],
        openWos: [{ itemCode: 'A/P', woDisplayId: 'WO-9', totalParts: 20, status: 'Approved' }],
    });
    assert.strictEqual(rows[0].state, 'COVERED');
    assert.strictEqual(rows[0].cover[0].kind, 'WO');
});
t('ARRIVED outranks COVERED — landed stock needs a person, not a watch', () => {
    const rows = rowsFor({
        orders: [so('SO1', 1000, [{ code: 'A/EP1', qty: 8 }])],
        poByCode: { 'A/EP1': [{ poNumber: 'PO1', open: 500 }] },
        availByCode: { 'A/EP1': 12 },
    });
    assert.strictEqual(rows[0].state, 'ARRIVED');
});
t('a painted line arrives on its MILL base too', () => {
    const rows = rowsFor({ orders: [so('SO1', 1, [{ code: 'A/N25', qty: 5 }])], availByCode: { A: 9 } });
    assert.strictEqual(rows[0].state, 'ARRIVED');
});
t('a plated line does NOT arrive on its mill base', () => {
    const rows = rowsFor({ orders: [so('SO1', 1, [{ code: 'A/EP1', qty: 5 }])], availByCode: { A: 9 } });
    assert.strictEqual(rows[0].state, 'UNCOVERED');
});
t('partial live stock is not ARRIVED', () => {
    const rows = rowsFor({ orders: [so('SO1', 1, [{ code: 'A/EP1', qty: 8 }])], availByCode: { 'A/EP1': 3 } });
    assert.strictEqual(rows[0].state, 'UNCOVERED');
});

// ── OLDEST FIRST ─────────────────────────────────────────────────────────────────────
t('oldest order first', () => {
    const rows = rowsFor({ orders: [so('NEW', 5000, [{ code: 'B/EP1', qty: 1 }]), so('OLD', 1000, [{ code: 'A/EP1', qty: 1 }])] });
    assert.deepStrictEqual(rows.map(r => r.soId), ['OLD', 'NEW']);
});
t('a dateless line sorts LAST, never first', () => {
    const rows = rowsFor({ orders: [so('NODATE', 0, [{ code: 'Z/EP1', qty: 1 }]), so('OLD', 1000, [{ code: 'A/EP1', qty: 1 }])] });
    assert.strictEqual(rows[0].soId, 'OLD', 'an unknown age must not outrank a genuinely old order');
});
t('line.since wins over the order date when B supplies it', () => {
    const rows = rowsFor({ orders: [so('SO1', 9000, [{ code: 'A/EP1', qty: 1, since: 100 }])] });
    assert.strictEqual(rows[0].since, 100);
});

t('multiple lines on one order each get a row with a stable key', () => {
    const rows = rowsFor({ orders: [so('SO1', 1, [{ code: 'A/EP1', qty: 1 }, { code: 'B/EP1', qty: 2 }])] });
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(new Set(rows.map(r => r.key)).size, 2);
});
t('orders with no backorder lines contribute nothing', () => {
    assert.strictEqual(rowsFor({ orders: [so('SO1', 1, [])] }).length, 0);
});
t('the pack doc is attached when there is one', () => {
    const rows = rowsFor({ orders: [so('SO1', 1, [{ code: 'A/EP1', qty: 1 }])], packByOrderKey: { SO1: { id: 'WO-SO1', bin: 'A12' } } });
    assert.strictEqual(rows[0].pack.bin, 'A12');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
