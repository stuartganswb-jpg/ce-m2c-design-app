// Stock-first at the split, offline.   node scripts/splitPlan.test.mjs
import { planSmallLines, isPlatedLine, customShopQtyOf, shopLeadLineOf, shopLeadCodeOf } from '../src/components/Shared/splitPlan.js';
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
// THE WHOLE LINE STAYS ON THE PICK (2026-09-27): a short plated line keeps its full quantity, the backordered
// part named — once it arrives the pick takes it; before, nothing picked it and the order packed short.
eq('every plated line is on the pick at its full quantity, the short part named', p.pick.map(l => [l.legacyErpId, l.qty, l.backorderedQty || 0]), [['H1-1CP-V/EP4', 3, 0], ['H1-1CP-V/EP4', 4, 2], ['H1-1R-V/EP4', 2, 2]]);
eq('short goes to backorder with the shortfall named', p.backorder.map(b => [b.code, b.qty, b.wanted]), [['H1-1CP-V/EP4', 2, 4], ['H1-1R-V/EP4', 2, 2]]);
eq('no inventory row = unknown, not a shortage', p.unknown.map(l => [l.legacyErpId, l.stockUnknown]), [['H1-1X-V/EP4', 'no inventory row at this location']]);
ok('pick lines are flagged pickOnly + finishOutsourced', p.pick.every(l => l.pickOnly && l.finishOutsourced));
ok('summary names every bucket', /1 in-house/.test(p.summary) && /1 plated line in stock/.test(p.summary) && /\+2 on the pick waiting for their backorder/.test(p.summary) && /TRUE BACKORDER/.test(p.summary) && /UNKNOWN/.test(p.summary));

const noRead = planSmallLines([{ legacyErpId: 'H1-1CP-V/EP4', qty: 3 }], 'EP4', null);
eq('stock not read → unknown, never backorder', [noRead.unknown.length, noRead.backorder.length], [1, 0]);
const unitsBad = planSmallLines([{ legacyErpId: 'H1-1CP-V/EP4', qty: 3 }], 'EP4', { map: { 'H1-1CP-V/EP4': { available: 9, onOrder: 0, unit: null } }, unitsKnown: false });
eq('unitsKnown false → unknown (retry), never a confident pick', [unitsBad.unknown.length, unitsBad.pick.length], [1, 0]);
eq('OE planner dialect (quantity) is read', planSmallLines([{ partId: 'H1-1CP-V/EP4', quantity: 2 }], 'EP4', stock).pick[0].qty, 2);
eq('all in-house → nothing to check', planSmallLines([{ legacyErpId: 'A/BS', qty: 1 }], 'BS', null).inHouse.length, 1);

// ── a pole counts as a pole (Stuart 2026-09-12) ──
// A per-foot pole quoted with no cut is counted by its feet per piece; a rider is never a pole (2026-09-27).
{
    const q = customShopQtyOf([{ qty: 10, feetPer: 8 }, { qty: 50, cutLength: 90 }, { qty: 50, rider: true, cutLength: 90 }]);
    eq('per-foot poles by feet-per; the rider not a pole', [q.poles, q.feet, q.riders], [60, 455, 1]);
}
const so60420 = [{ name: '1" Round Hollow Rod Stock', qty: 1, cutLength: 90 }, { name: 'French return L', qty: 1 }, { name: 'French return R', qty: 1 }];
eq('SO60420: one bent rod with two returns is ONE pole, 7.5 ft, billed as 8', customShopQtyOf(so60420), { qty: 1, poles: 1, feet: 7.5, billableFeet: 8, riders: 2, isPoleOrder: true });
eq('two 8 ft poles with a miter line = qty 2, 16 billable feet, one rider line', customShopQtyOf([{ qty: 2, cutLength: 96 }, { qty: 2, name: 'miter' }]), { qty: 2, poles: 2, feet: 16, billableFeet: 16, riders: 1, isPoleOrder: true });
eq('a custom with no pole line keeps its line quantities', customShopQtyOf([{ qty: 4, name: 'bracket set' }]).qty, 4);
eq('empty → 0', customShopQtyOf([]).qty, 0);

// THE POLE A SHOP JOB IS NAMED FOR (Stuart 2026-09-28: "french returns fees with rods will happen often and needs to work from
// all screens"): a return / fee / miter rides the pole and is never the item — the same answer on every door's cut list.
{
    // SO60551 ROW 1 as the row pair writes it (Order Entry / 10.5): the pole first, the riders flagged.
    const oe = [{ legacyErpId: 'H1-1R', qty: 50, cutLength: 16.75 }, { legacyErpId: 'H1-FRPF', qty: 50, rider: true }, { legacyErpId: 'H1-FRPF', qty: 50, rider: true }];
    // The same job as the CPQ split lists it: no rider flag, a fee may come first — it simply has no cut.
    const cpq = [{ legacyErpId: 'H1-FRPF', qty: 2 }, { legacyErpId: 'H1-1R', qty: 1, cutLength: 96 }, { legacyErpId: 'H1-FRPF', qty: 2 }];
    eq('a pole with two French return riders is named for the pole (Order Entry / 10.5 shape)', shopLeadCodeOf(oe), 'H1-1R');
    eq('…and the CPQ split\'s shape of the same job (fee listed first, no rider flag) gives the same pole', shopLeadCodeOf(cpq), 'H1-1R');
    eq('…the pole the lead names is the pole the shop counts', [customShopQtyOf(oe).poles, customShopQtyOf(oe).riders, customShopQtyOf(cpq).poles, customShopQtyOf(cpq).riders], [50, 2, 1, 2]);
    eq('a per-foot pole with no cut is still the pole (feet per piece)', shopLeadCodeOf([{ legacyErpId: 'H1-FRPF', qty: 4 }, { legacyErpId: 'H1-138R', qty: 4, feetPer: 8 }]), 'H1-138R');
    eq('a one-line job is its line (unchanged)', [shopLeadCodeOf([{ legacyErpId: 'H1-75R', qty: 50, cutLength: 7.5 }]), shopLeadCodeOf([{ partId: 'h1-bkt', qty: 4 }])], ['H1-75R', 'H1-BKT']);
    eq('riders alone name nothing; nothing names nothing', [shopLeadCodeOf([{ legacyErpId: 'H1-FRPF', qty: 2, rider: true }, { legacyErpId: 'H1-MITER', qty: 2, rider: true }]), shopLeadCodeOf([]), shopLeadLineOf(null)], ['', '', null]);
    eq('two different poles: the first pole, as the CPQ split names its shop document', shopLeadCodeOf([{ legacyErpId: 'H1-2TRV', qty: 50, cutLength: 17.5, rider: false }, { legacyErpId: 'H1-2TRVCLP', qty: 50, cutLength: 17 }]), 'H1-2TRV');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
