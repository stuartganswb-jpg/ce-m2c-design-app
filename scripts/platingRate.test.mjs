// node scripts/platingRate.test.mjs — the plater's rate for one staged line (Stuart 2026-09-28: "$20.00 per foot … $25 for the
// H1-2 poles … H1-75SR ok at $25 as well … there are no stock plating poles, always custom").
import { polePlatingClassOf, platingRuleOf, platingLineRateOf } from '../src/components/Shared/platingRate.js';
import { shopFeetPerPieceOf } from '../src/components/Shared/splitPlan.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

// The live rules (system/plating_fees) and the live library items (their product line is the shape).
const rules = { 'POLE ROUND': { fee: 20, unit: 'ft' }, 'POLE SQUARE': { fee: 25, unit: 'ft' }, BRACKET: { fee: 3.5, unit: 'ea' } };
const item = (code, name, watch, type = 'Pole') => ({ legacyErpId: code, itemName: name, manufacturingSpecs: { productType: type, customData: { watchlist: watch } } });
const H1_1R = item('H1-1R', '1" Round Hollow Rod Stock (14 GA)', '1" ROUND');
const H1_138R = item('H1-138R', '1-3/8" Round Hollow Rod Stock (14 GA)', '1-3/8" ROUND');
const H1_75SR = item('H1-75SR', '3/4" Square Hollow Rod Stock (14 GA)', '3/4" SQUARE');
const H1_2RCTAR = item('H1-2RCTAR', '2" Aluminum Extrusion Rod', '2" RECTANGULAR');
const BKT = item('H1-1BKT', 'Bracket', 'N/A', 'BRACKET');

eq('a pole\'s class is its shape: round → POLE ROUND; square and rectangular (H1-75SR, H1-2) → POLE SQUARE',
    [H1_1R, H1_138R, H1_75SR, H1_2RCTAR].map(polePlatingClassOf), ['POLE ROUND', 'POLE ROUND', 'POLE SQUARE', 'POLE SQUARE']);
eq('…a pole with no shape said anywhere has no class', polePlatingClassOf(item('H1-X', 'Pole', '')), '');
eq('the rule: a pole by its shape ($20 / $25 a foot), anything else by its product type', [platingRuleOf(H1_1R, rules).fee, platingRuleOf(H1_2RCTAR, rules).fee, platingRuleOf(BKT, rules).fee, platingRuleOf(item('H1-X', 'Pole', ''), rules)], [20, 25, 3.5, null]);

// SO60551's two plated poles (PO2340, typed by hand at $20/ft): now the default.
const bf3 = { custom: true, erpId: 'H1-1R', qty: 50, feetPerPiece: 0.625 };      // 7.5"
const row1 = { custom: true, erpId: 'H1-1R', qty: 50, feetPerPiece: 1.3958 };    // 16.75"
eq('a custom round pole: $20 × its feet per piece — Base Front 3 7.5" = $12.50, ROW 1 16.75" = $27.92', [platingLineRateOf({ line: bf3, part: H1_1R, rules }), platingLineRateOf({ line: row1, part: H1_1R, rules })], [12.5, 27.92]);
eq('a custom square / H1-2 pole: $25 a foot (12" = $25.00, 17.5" = $36.46)', [platingLineRateOf({ line: { custom: true, feetPerPiece: 1 }, part: H1_75SR, rules }), platingLineRateOf({ line: { custom: true, feetPerPiece: 1.4583 }, part: H1_2RCTAR, rules })], [25, 36.46]);
eq('a custom pole with no length says $0 (the ship step\'s zero-rate guard names it)', platingLineRateOf({ line: { custom: true }, part: H1_1R, rules }), 0);
eq('a stock pull keeps the rule on its qty (a pole pull\'s qty is already feet; a bracket is per piece)', [platingLineRateOf({ line: { custom: false, qty: 16 }, part: H1_1R, rules }), platingLineRateOf({ line: { qty: 10 }, part: BKT, rules })], [20, 3.5]);
eq('no item, no rule → 0', [platingLineRateOf({ line: bf3, part: null, rules }), platingLineRateOf({ line: bf3, part: H1_1R, rules: {} })], [0, 0]);

// Feet per piece from the shop job — the job's count first, else its lead pole, else its single cut.
eq('feet per piece: the job\'s feet ÷ poles (ROW 1: 69.79 ft / 50)', shopFeetPerPieceOf({ feet: 69.79, poles: 50 }), 1.3958);
eq('…else the lead pole\'s cut, riders ignored', shopFeetPerPieceOf({ cutList: [{ legacyErpId: 'H1-FRPF', qty: 2 }, { legacyErpId: 'H1-1R', qty: 1, cutLength: 96 }] }), 8);
eq('…else a per-foot line\'s feet, else the job\'s cut; nothing → 0', [shopFeetPerPieceOf({ cutList: [{ legacyErpId: 'H1-138R', qty: 4, feetPer: 8 }] }), shopFeetPerPieceOf({ cutLength: 7.5 }), shopFeetPerPieceOf({})], [8, 0.625, 0]);
console.log(`platingRate: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
