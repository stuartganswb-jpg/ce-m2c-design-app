// True backorders — the one definition, offline.   node scripts/backorder.test.mjs
import { isPlatedLine, coverCodesOf, classifyLine, backorderHoldOf, isBackorderHold } from '../src/components/Shared/backorder.js';
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


// ── THE BACKORDER HOLD (Stuart 2026-09-15, SO60427–SO60432) ──────────────────────────────────
const shorts = [{ code: 'H1-1R-V/EP4', qty: 2 }, { code: 'HCUMB410/CP', qty: 6 }];
ok('no short lines → no hold', backorderHoldOf({ lines: [], finishAsAvailable: false }) === null);
ok('lines that are short by zero → no hold', backorderHoldOf({ lines: [{ code: 'X', qty: 0 }] }) === null);
ok('finish as available → no hold, however short', backorderHoldOf({ lines: shorts, finishAsAvailable: true }) === null);
const fin = backorderHoldOf({ lines: shorts, now: 1000 });
eq('a short order is held, and says which kind', [fin.held, fin.heldReasonKind, fin.heldStage], [true, 'BACKORDER', 'FINISHING']);
ok('the reason names every short line by code and qty', /2 × H1-1R-V\/EP4/.test(fin.heldReason) && /6 × HCUMB410\/CP/.test(fin.heldReason));
ok('the reason says how to run the in-stock parts now', /Finish as available/.test(fin.heldReason));
const shop = backorderHoldOf({ lines: shorts, stage: 'SHOP', now: 1000 });
eq('the shop sibling is held at its own stage, same instant', [shop.heldStage, shop.heldAt, fin.heldAt], ['SHOP', 1000, 1000]);
// A PICK-ONLY DOCUMENT IS NOT EXEMPT (SO60429 carried 7 short lines to the WMS pick): the rule
// takes no pickOnly argument at all, so there is nothing left to exempt it.
eq('one rule, no pick-only escape hatch', backorderHoldOf({ lines: shorts, now: 1000 }).heldReason, fin.heldReason);
ok('a backorder hold is recognised as one', isBackorderHold({ held: true, heldReasonKind: 'BACKORDER' }));
ok('lower case reads the same', isBackorderHold({ held: true, heldReasonKind: 'backorder' }));
ok('a floor STOP is NOT a backorder hold (only its raiser lifts it)', !isBackorderHold({ held: true, heldReason: 'scrap at packing' }));
ok('a document that is not held is not a backorder hold', !isBackorderHold({ held: false, heldReasonKind: 'BACKORDER' }));
ok('nothing is not a backorder hold', !isBackorderHold(null));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
