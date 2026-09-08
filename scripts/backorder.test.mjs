// True backorders — the one definition, offline.   node scripts/backorder.test.mjs
import { isPlatedLine, coverCodesOf, classifyLine } from '../src/components/Shared/backorder.js';
import { planSmallLines } from '../src/components/Shared/splitPlan.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

eq('plated cover = the finished code only', coverCodesOf({ legacyErpId: 'H1-1CP-V/EP4' }, 'EP4'), ['H1-1CP-V/EP4']);
eq('painted cover = finished, /P, mill', coverCodesOf({ legacyErpId: 'HCUMB410/CP' }, 'CP'), ['HCUMB410/CP', 'HCUMB410/P', 'HCUMB410']);
ok('plated line', isPlatedLine({ legacyErpId: 'X/MEP2' }, 'CP'));

const map = {
    'H1-1CP-V/EP4': { available: 0, onOrder: 12, unit: 'EA' },
    'HCUMB410/CP': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMB410/P': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMB410': { available: 0, onOrder: 50, unit: 'EA' },
    'HCUMR15/BS': { available: 0, onOrder: 0, unit: 'EA' }, 'HCUMR15/P': { available: 3, onOrder: 0, unit: 'EA' }, 'HCUMR15': { available: 0, onOrder: 0, unit: 'EA' },
};
eq('plated, none on hand → backorder with the shortfall', classifyLine({ legacyErpId: 'H1-1CP-V/EP4' }, 'EP4', map, 4).state, 'backorder');
eq('plated backorder carries on-order for the board', classifyLine({ legacyErpId: 'H1-1CP-V/EP4' }, 'EP4', map, 4).onOrder, 12);
eq('painted, no finished, no /P, no mill → TRUE backorder', classifyLine({ legacyErpId: 'HCUMB410/CP' }, 'CP', map, 6).state, 'backorder');
eq('painted, /P in stock → the floor can make it (not a backorder)', classifyLine({ legacyErpId: 'HCUMR15/BS' }, 'BS', map, 2).state, 'covered');
eq('painted, /P short of the qty → backorder for the remainder', classifyLine({ legacyErpId: 'HCUMR15/BS' }, 'BS', map, 5).shortfall, 2);
eq('no cover code readable → unknown, never a backorder', classifyLine({ legacyErpId: 'ZZZ/CP' }, 'CP', map, 1).state, 'unknown');

const plan = planSmallLines([{ legacyErpId: 'HCUMB410/CP', qty: 6 }, { legacyErpId: 'HCUMR15/BS', qty: 2 }, { legacyErpId: 'H1-1CP-V/EP4', qty: 4 }], 'CP', { map, unitsKnown: true }, { since: 123 });
eq('painted lines still go to finishing', plan.inHouse.length, 2);
eq('the painted true backorder is recorded (kind painted)', plan.backorder.filter(b => b.kind === 'painted').map(b => [b.code, b.qty]), [['HCUMB410/CP', 6]]);
eq('the plated short is recorded (kind plated)', plan.backorder.filter(b => b.kind === 'plated').map(b => [b.code, b.qty]), [['H1-1CP-V/EP4', 4]]);
ok('records carry since + cover codes', plan.backorder.every(b => b.since === 123 && b.coverCodes.length >= 1));
ok('summary says TRUE BACKORDER', /TRUE BACKORDER/.test(plan.summary));
const noStock = planSmallLines([{ legacyErpId: 'HCUMB410/CP', qty: 6 }], 'CP', null);
eq('painted with no stock read → finishing, no backorder claimed', [noStock.inHouse.length, noStock.backorder.length], [1, 0]);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
