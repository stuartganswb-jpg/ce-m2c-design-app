// Harness for customerDocLines — what a customer may read on a money document.
//
//   node scripts/customerDocLines.test.mjs
//
// Stuart 2026-08-22: "hidden go to all shop doc's just not customer docs."
//
// The rule has two halves and the second one is the easy one to lose: the money documents drop
// BOM-only parts, and EVERYTHING ELSE STILL GETS THEM. A test that only proved the dropping would
// pass just as happily if the parts had been dropped everywhere — which would take the standoffs
// off the shop floor and the pick list.
//
// Stuart 2026-09-11 (S1): the money documents KEEP the discount / net rows — the paper has to add
// up — while the floors and every non-money document still never see them.

import { customerDocLines, isDisplayOnlyLine, MONEY_DOC_TYPES } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

const LINES = [
    { name: '▶ H1-2TRV-4/EP [Living Room]', isHeader: true },
    { name: 'fascia', partId: 'F', legacyErpId: 'H1-2TRVF', total: 90 },
    { name: 'track', partId: 'T', legacyErpId: 'H1-2TRVT', total: 0, shopOnly: true },
    { name: 'standoff', partId: 'S', legacyErpId: 'H1-138STDOFF', total: 4, hidden: true },
    { name: 'finial', partId: 'C', legacyErpId: 'H1-1CC', total: 30 },
];
const codes = (ls) => ls.map(l => l.legacyErpId || l.name);

// ── THE MONEY DOCUMENTS ──────────────────────────────────────────────────────────────────────
for (const type of MONEY_DOC_TYPES) {
    const out = customerDocLines(LINES, type);
    eq(`${type}: the customer sees what they bought`, codes(out), ['H1-2TRVF', 'H1-1CC']);
    ok(`${type}: no BOM-only part`, !out.some(l => l.hidden));
    ok(`${type}: no shop-only row`, !out.some(l => l.shopOnly));
    ok(`${type}: and no header`, !out.some(l => l.isHeader));
}

// ── EVERYTHING ELSE STILL GETS EVERY PART ────────────────────────────────────────────────────
// ⚠ A PACKING SLIP IS A LIST OF WHAT IS IN THE BOX. The standoff is physically in there and the
// customer counts against it, so a contents document that hid it would be wrong in the other
// direction — and the shop screens would lose real work.
{
    for (const type of ['PACKING_SLIP', 'FACTORY_ROUTER', 'FULL_PACKET', '']) {
        const out = customerDocLines(LINES, type);
        eq(`${type || '(no type)'}: every real line survives`, codes(out),
            ['H1-2TRVF', 'H1-2TRVT', 'H1-138STDOFF', 'H1-1CC']);
        ok(`${type || '(no type)'}: the standoff is still on it`, out.some(l => l.hidden));
    }
}

// ── IT IS STILL THE DISPLAY-ONLY FILTER UNDERNEATH ───────────────────────────────────────────
// Two questions, two functions: isDisplayOnlyLine answers "is this a line at all", and this one
// answers "may a customer read it". Folding the second into the first would strip BOM-only parts
// from the shop screens, because getJobLines feeds those too.
{
    const junk = [{ name: 'Rod Diameter: 1-3/8"' }, { name: 'Trade Discount - (20%)', isDiscount: true }];
    // 2026-09-11: the size echo is gone from both; the DISCOUNT row stays on the money document
    // (it is the arithmetic) and is gone from the shop view.
    eq('the size echo is gone from the invoice; the discount row stays (it is the arithmetic)', customerDocLines(junk, 'INVOICE').map(l => l.name), ['Trade Discount - (20%)']);
    eq('…and both are gone from the shop view', customerDocLines(junk, 'PACKING_SLIP').length, 0);
    ok('a hidden part is NOT display-only — it is a real line', !isDisplayOnlyLine({ partId: 'S', total: 4, hidden: true }));
    ok('a discount row IS display-only for every work consumer', isDisplayOnlyLine(junk[1]));
}

// ── THE PAPER HAS TO ADD UP (Stuart 2026-09-11, S1) ─────────────────────────────────────────
{
    const lines = [
        { name: '▶ Fabricut H1-138', isHeader: true, qty: 0, total: 0 },
        { name: 'Rod', partId: 'P1', legacyErpId: 'H1-138R', qty: 1, price: 87.5, total: 87.5, perFoot: true, feet: 7 },
        { name: 'Bracket', partId: 'P2', legacyErpId: 'H1-138B6', qty: 2, price: 16, total: 32 },
        { name: '  Trade Discount - (20%)', qty: 1, price: -23.9, total: -23.9, isDiscount: true, partId: null },
        { name: '  Net Line Total', qty: 1, price: 95.6, total: 95.6, isNetLine: true, partId: null },
        { name: '  Line Discount - (10%) · by M', qty: 1, price: -11.95, total: -11.95, isDiscount: true, isLineDiscount: true, partId: null },
        { name: 'Rod Diameter: 1-3/8"', qty: 0, isSizeRow: true },
        { name: 'Hidden joiner', partId: 'P3', qty: 1, price: 6, total: 6, hidden: true },
    ];
    const names = (out) => out.map(l => l.name.trim());
    eq('QUOTE keeps the discount and net rows, in order, after the items', names(customerDocLines(lines, 'QUOTE')),
        ['Rod', 'Bracket', 'Trade Discount - (20%)', 'Net Line Total', 'Line Discount - (10%) · by M']);
    eq('SALES_ORDER and INVOICE the same', [names(customerDocLines(lines, 'SALES_ORDER')).length, names(customerDocLines(lines, 'INVOICE')).length], [5, 5]);
    eq('a money document still drops the header, the size echo and the hidden line', names(customerDocLines(lines, 'INVOICE')).some(n => /▶|Diameter|Hidden/.test(n)), false);
    eq('a money document still shows the feet as the qty', customerDocLines(lines, 'QUOTE')[0].qty, 7);
    eq('WORK_ORDER (not money) drops them as before', names(customerDocLines(lines, 'WORK_ORDER')), ['Rod', 'Bracket', 'Hidden joiner']);
    eq('a discount row is not renamed or re-finished on the way through', customerDocLines(lines, 'QUOTE', 'P14', { findPart: () => ({ itemName: 'LIBRARY NAME' }) })[2].name, '  Trade Discount - (20%)');
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
