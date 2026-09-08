// Stock-first at the split, offline.   node scripts/splitPlan.test.mjs
import { planSmallLines, isPlatedLine } from '../src/components/Shared/splitPlan.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

ok('E stamp wins: finishOutsourced true', isPlatedLine({ legacyErpId: 'H1-1CP-V/BS', finishOutsourced: true }, 'S04'));
ok('E stamp wins: finishOutsourced false on an /EP code', !isPlatedLine({ legacyErpId: 'H1-1CP-V/EP4', finishOutsourced: false }, 'EP4'));
ok('suffix decides when unstamped: /EP4 plated', isPlatedLine({ legacyErpId: 'H1-1CP-V/EP4' }, 'S04'));
ok('suffix decides when unstamped: /BS in-house', !isPlatedLine({ legacyErpId: 'HCUMB410/BS' }, 'EP5'));
ok('no suffix takes the order recipe: EP5 → plated', isPlatedLine({ legacyErpId: 'H1-138JNR' }, 'EP5'));
ok('no suffix takes the order recipe: P14 → in-house', !isPlatedLine({ legacyErpId: 'H1-138JNR' }, 'P14'));

const stock = { map: { 'H1-1CP-V/EP4': { available: 5, onOrder: 20, unit: 'EA' }, 'H1-1R-V/EP4': { available: 0, onOrder: 0, unit: 'EA' } }, unitsKnown: true };
const lines = [
    { legacyErpId: 'HCUMB410/BS', qty: 4 },                 // in-house
    { legacyErpId: 'H1-1CP-V/EP4', qty: 3 },                // plated, covered
    { legacyErpId: 'H1-1CP-V/EP4', qty: 4 },                // plated, 2 covered + 2 short (running remainder)
    { legacyErpId: 'H1-1R-V/EP4', qty: 2 },                 // plated, zero on hand → short
    { legacyErpId: 'H1-1X-V/EP4', qty: 1 },                 // plated, no inventory row → unknown
];
const p = planSmallLines(lines, 'EP4', stock);
eq('in-house untouched', p.inHouse.map(l => l.legacyErpId), ['HCUMB410/BS']);
eq('covered picks (running remainder)', p.pick.map(l => [l.legacyErpId, l.qty]), [['H1-1CP-V/EP4', 3], ['H1-1CP-V/EP4', 2]]);
eq('short goes to backorder with the shortfall named', p.backorder.map(b => [b.code, b.qty, b.wanted]), [['H1-1CP-V/EP4', 2, 4], ['H1-1R-V/EP4', 2, 2]]);
eq('no inventory row = unknown, not a shortage', p.unknown.map(l => [l.legacyErpId, l.stockUnknown]), [['H1-1X-V/EP4', 'no inventory row at this location']]);
ok('pick lines are flagged pickOnly + finishOutsourced', p.pick.every(l => l.pickOnly && l.finishOutsourced));
ok('summary names every bucket', /1 in-house/.test(p.summary) && /2 plated lines in stock/.test(p.summary) && /SHORT/.test(p.summary) && /UNKNOWN/.test(p.summary));

const noRead = planSmallLines([{ legacyErpId: 'H1-1CP-V/EP4', qty: 3 }], 'EP4', null);
eq('stock not read → unknown, never backorder', [noRead.unknown.length, noRead.backorder.length], [1, 0]);
const unitsBad = planSmallLines([{ legacyErpId: 'H1-1CP-V/EP4', qty: 3 }], 'EP4', { map: { 'H1-1CP-V/EP4': { available: 9, onOrder: 0, unit: null } }, unitsKnown: false });
eq('unitsKnown false → unknown (retry), never a confident pick', [unitsBad.unknown.length, unitsBad.pick.length], [1, 0]);
eq('OE planner dialect (quantity) is read', planSmallLines([{ partId: 'H1-1CP-V/EP4', quantity: 2 }], 'EP4', stock).pick[0].qty, 2);
eq('all in-house → nothing to check', planSmallLines([{ legacyErpId: 'A/BS', qty: 1 }], 'BS', null).inHouse.length, 1);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
