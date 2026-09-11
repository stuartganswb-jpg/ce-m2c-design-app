// Harness for Shared/lineClassification.customerDocLines — the money documents keep the discount
// and net rows so the paper adds up (Stuart 2026-09-11, S1); the floors still never see them.
//
//   node scripts/customerDocLines.test.mjs

import { customerDocLines, isDisplayOnlyLine } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };

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
eq('FULL_PACKET / WORK_ORDER (not money) drop them as before', names(customerDocLines(lines, 'WORK_ORDER')), ['Rod', 'Bracket', 'Hidden joiner']);
eq('no docType (the floors) drops them as before', names(customerDocLines(lines, '')), ['Rod', 'Bracket', 'Hidden joiner']);
eq('the rows stay display-only for every work consumer', lines.filter(l => l.isDiscount || l.isNetLine).every(isDisplayOnlyLine), true);
eq('a discount row is not renamed or re-finished on the way through', customerDocLines(lines, 'QUOTE', 'P14', { findPart: () => ({ itemName: 'LIBRARY NAME' }) })[2].name, '  Trade Discount - (20%)');

console.log(`\ncustomerDocLines: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
