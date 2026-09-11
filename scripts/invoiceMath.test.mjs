// Harness for Shared/invoiceMath — the invoice's arithmetic on a shipped-quantity bill (S1, 2026-09-11).
//
//   node scripts/invoiceMath.test.mjs

import { invoiceDocOf } from '../src/components/Shared/invoiceMath.js';
import { packingListOf } from '../src/components/Shared/packingList.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };

// A CPQ sales order as the money reader hands it: two physical lines, a fee, a trade discount and its net row.
const priced = [
    { name: 'Rod', legacyErpId: 'H1-138R', partId: 'P1', qty: 7, price: 12.5, total: 87.5 },
    { name: 'Bracket', legacyErpId: 'H1-138B6', partId: 'P2', qty: 2, price: 16, total: 32 },
    { name: 'Miter fee', legacyErpId: 'CE-FEE-4642', qty: 1, price: 40, total: 40, isFee: true },
    { name: '  Trade Discount - (20%)', qty: 1, price: -23.9, total: -23.9, isDiscount: true, partId: null },
    { name: '  Net Line Total', qty: 1, price: 95.6, total: 95.6, isNetLine: true, partId: null },
];
const orderedTotal = 87.5 + 32 + 40 - 23.9;   // 135.60, the SO's net total as saved

// pack docs: everything shipped
const full = { id: 'WO-1', packStatus: 'Packed', packedAt: 1000, partsList: [{ legacyErpId: 'H1-138R', name: 'Rod', qty: 7 }, { legacyErpId: 'H1-138B6', name: 'Bracket', qty: 2 }], packedLines: { L0: { at: 1, by: 'S', qty: 7 }, L1: { at: 1, by: 'S', qty: 2 } } };
{
    const d = invoiceDocOf({ priced, packingList: packingListOf({ ordered: priced, packDocs: [full] }), shippingAmount: 12, orderedTotal });
    eq('everything shipped: the invoice IS the order (+ shipping)', [d.adjusted, d.total, d.rows.length, d.note], [false, 147.6, 5, '']);
    eq('rows untouched', d.rows.map(r => r.total), [87.5, 32, 40, -23.9, 95.6]);
}
// pack docs: one bracket short
const short = { ...full, packedLines: { L0: { at: 1, by: 'S', qty: 7 }, L1: { at: 1, by: 'S', qty: 1 } } };
{
    const d = invoiceDocOf({ priced, packingList: packingListOf({ ordered: priced, packDocs: [short] }), shippingAmount: 12, orderedTotal });
    eq('adjusted', d.adjusted, true);
    eq('the bracket bills at 1 × 16; the rod in full', d.rows.slice(0, 2).map(r => [r.qty, r.amount]), [[7, 87.5], [1, 16]]);
    eq('the fee bills in full', d.rows[2].total, 40);
    // goods: ordered 119.5, shipped 103.5 → factor .86611; discount 23.9 × factor = 20.70
    eq('the discount is pro-rated to the goods that went', [d.rows[3].amount, d.rows[3].invoiceProrated], [-20.7, true]);
    eq('the net-line subtotal is gone', d.rows.some(r => r.isNetLine), false);
    eq('total = 87.5 + 16 + 40 − 20.70 + 12', d.total, 134.8);
    eq('the note says what happened', /1 line\(s\) differ.*pro-rated to 86\.6%.*fees in full/.test(d.note), true);
}
// nothing packed at all
{
    const none = { ...full, packedLines: {} };
    const d = invoiceDocOf({ priced, packingList: packingListOf({ ordered: priced, packDocs: [none] }), shippingAmount: 0, orderedTotal });
    eq('nothing shipped: items 0, discount 0, fee in full', [d.rows[0].amount, d.rows[1].amount, d.rows[3].amount, d.total], [0, 0, 0, 40]);
}
// no packing list at all (a call before packing) → treated as nothing shipped, and said
{
    const d = invoiceDocOf({ priced, packingList: null, shippingAmount: 0, orderedTotal });
    eq('no packing list: adjusted, everything at 0 but the fee', [d.adjusted, d.total], [true, 40]);
}

console.log(`\ninvoiceMath: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
