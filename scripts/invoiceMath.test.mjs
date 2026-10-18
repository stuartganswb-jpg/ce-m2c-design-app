// Harness for Shared/invoiceMath — the invoice's arithmetic on a shipped-quantity bill (S1, 2026-09-11).
//
//   node scripts/invoiceMath.test.mjs

import { invoiceDocOf } from '../src/components/Shared/invoiceMath.js';
import { packingListOf } from '../src/components/Shared/packingList.js';
import { customerDocLines } from '../src/components/Shared/lineClassification.js';

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

// ── SO60427 (Fabricut) end to end, as stored 2026-10-17 — Eric's App Imp card: the invoice read $260 of $621 ─────────
{
    const r = (o) => ({ finishCode: 'P16', finishLabel: 'P16', isFee: false, qtyEach: 1, configQty: 2, ...o });
    const breakdown = [
        { isHeader: true, total: 621, qty: 2, name: '▶ H1-75 [WRD]' },
        r({ name: '  - 3/4" Round Hollow Rod Stock (14 GA)', partHandling: 'Custom', legacyErpId: 'H1-75R', perFoot: true, total: 126, clientSku: 'H2578F', qty: 2, cutLength: 76, feet: 7, price: 9 }),
        r({ name: '  - MITER RETURN', partHandling: 'CUSTOM', legacyErpId: 'H1-MRPF', clientSku: 'H1-MRPF', qty: 2, price: 50, total: 100 }),
        r({ name: '  - MITER RETURN', partHandling: 'CUSTOM', legacyErpId: 'H1-MRPF', clientSku: 'H1-MRPF', qty: 2, price: 50, total: 100 }),
        r({ name: '  - In Line Bracket (4-5/8" P)', partHandling: 'Small Parts', legacyErpId: 'H1-75ILE/P', clientSku: 'H3553F', qty: 2, price: 26.5, total: 53 }),
        r({ name: '  - Square Cover Plate for Returns', partHandling: 'Small Parts', legacyErpId: 'H1-75RCP-S/P', clientSku: null, qty: 2, price: 10, total: 20 }),
        r({ name: '  - Square Cover Plate', partHandling: 'Small Parts', legacyErpId: 'H1-75CP-S/P', clientSku: null, qty: 2, price: 10, total: 20 }),
        r({ name: '  - Square Cover Plate for Returns', partHandling: 'Small Parts', legacyErpId: 'H1-75RCP-S/P', clientSku: null, qty: 2, price: 10, total: 20 }),
        r({ name: '  - Chamfered Edge Ring for .75" Rod', partHandling: 'Small Parts', legacyErpId: 'H1-75BR/P', clientSku: 'H4527F', qty: 52, qtyEach: 26, price: 3.5, total: 182 }),
    ];
    const pl = (o) => ({ finishCode: 'P16', configQty: 2, clientSku: '', qtyEach: 1, ...o });
    const doc = { id: 'WO-SO60427', orderType: 'sales', packStatus: 'Packed', currentPhase: 'Complete', hasCustomSibling: true, customFabStatus: 'Complete',
        partsList: [pl({ name: 'In Line Bracket', legacyErpId: 'H1-75ILE/P', qty: 2 }), pl({ name: 'Square Cover Plate for Returns', legacyErpId: 'H1-75RCP-S/P', qty: 2 }),
            pl({ name: 'Square Cover Plate', legacyErpId: 'H1-75CP-S/P', qty: 2 }), pl({ name: 'Square Cover Plate for Returns', legacyErpId: 'H1-75RCP-S/P', qty: 2 }),
            pl({ name: 'Chamfered Edge Ring', legacyErpId: 'H1-75BR/P', qty: 52, qtyEach: 26 })],
        poleLines: [{ length: 76, qty: 2, unit: 'in', code: 'H1-75R', name: 'Rod', riders: [{ qty: 2, code: 'H1-MRPF', name: 'MITER RETURN' }, { qty: 2, code: 'H1-MRPF', name: 'MITER RETURN' }] }],
        packedLines: { 'POLE-0': { qty: 2 }, L0: { qty: 2 }, L1: { qty: 2 }, L2: { qty: 2 }, L3: { qty: 2 }, L4: { qty: 52 }, 'POLE-0-R0': { qty: 2, withPole: 'POLE-0' }, 'POLE-0-R1': { qty: 2, withPole: 'POLE-0' } } };
    const ordered = customerDocLines(breakdown, 'PACKING_SLIP', '', {}).filter(l => !l.isKit);
    const packingList = packingListOf({ ordered, packDocs: [doc] });
    const inv = invoiceDocOf({ priced: customerDocLines(breakdown, 'INVOICE', '', {}), packingList, shippingAmount: 0, orderedTotal: 621 });
    eq('SO60427: everything shipped → the invoice IS the order, $621', [inv.total, inv.adjusted, inv.note], [621, false, '']);
    eq('SO60427: Fabricut\'s numbers still print on the invoice', inv.rows.filter(x => x.clientSku).map(x => x.legacyErpId), ['H2578F', 'H1-MRPF', 'H1-MRPF', 'H3553F', 'H4527F']);
    // the rings left behind: a line that shipped nothing is a line that differs, and its dollars stay in the pro-rating
    const noRings = { ...doc, packedLines: { ...doc.packedLines, L4: { qty: 0 } } };
    const inv2 = invoiceDocOf({ priced: customerDocLines([...breakdown, { isDiscount: true, name: 'Trade discount', total: -62.1, amount: -62.1 }], 'INVOICE', '', {}),
        packingList: packingListOf({ ordered, packDocs: [noRings] }), shippingAmount: 0, orderedTotal: 558.9 });
    eq('no rings: one line differs, said', /^Billed at shipped quantities: 1 line\(s\) differ/.test(inv2.note), true);
    eq('no rings: the rings bill nothing', inv2.rows.find(x => x.legacyErpId === 'H4527F').amount, 0);
    eq('no rings: the discount follows the goods that went', Math.round(inv2.rows.find(x => x.isDiscount).amount * 100) / 100, Math.round(-62.1 * ((621 - 182) / 621) * 100) / 100);
}

console.log(`\ninvoiceMath: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
