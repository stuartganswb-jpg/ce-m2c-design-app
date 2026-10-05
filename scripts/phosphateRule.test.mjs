// 🧪 One phosphate rule — the dispatch stamp and the Shop card (Eric 2026-10-02, wood rods).   node scripts/phosphateRule.test.mjs
import { needsPhosphatingOf, shopDocNeedsPhos, isOutsourcedRecipe, isWoodFinishRecipe, recipeCodeOf } from '../src/components/Shared/phosphateRule.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the rule on a recipe ────────────────────────────────────────────────────────────────────
eq('an in-house paint is phosphated', [needsPhosphatingOf('P29'), needsPhosphatingOf('SL1'), needsPhosphatingOf('BS')], [true, true, true]);
eq('a wood stain is not (S01…S99)', [needsPhosphatingOf('S03'), needsPhosphatingOf(' S24 '), needsPhosphatingOf('S03 Pure Oak')], [false, false, false]);
eq('an outsourced plating is not', [needsPhosphatingOf('EP2'), needsPhosphatingOf('MEP1'), needsPhosphatingOf('P25')], [false, false, false]);
eq('mill / raw / unfinished is not', [needsPhosphatingOf('MILL'), needsPhosphatingOf('RAW'), needsPhosphatingOf('Unfinished')], [false, false, false]);
eq('no recipe yet is not', [needsPhosphatingOf(''), needsPhosphatingOf('PENDING-RECIPE'), needsPhosphatingOf(null)], [false, false, false]);
eq('SL1 (a paint that starts with S then a letter) is not a stain', needsPhosphatingOf('SL1'), true);
eq('outsourced reads the shared finish rule', [isOutsourcedRecipe('EP2'), isOutsourcedRecipe('P29'), isOutsourcedRecipe('')], [true, false, false]);

// ── the Shop card ───────────────────────────────────────────────────────────────────────────
// SO60585 Row 3 as dispatched: stained White Oak, stamped false — the card said "Parts Require Phosphate".
eq('the document\'s own stamp wins: a stained wood rod stamped false', shopDocNeedsPhos({ finishRecipe: 'S03', needsPhosphating: false, isOutsourced: false }), false);
eq('…and a stamp of true stays true', shopDocNeedsPhos({ finishRecipe: 'S03', needsPhosphating: true }), true);
eq('no stamp: the same rule — stain no, paint yes', [shopDocNeedsPhos({ finishRecipe: 'S03' }), shopDocNeedsPhos({ finishRecipe: 'P29' })], [false, true]);
eq('no stamp, marked outsourced: no', shopDocNeedsPhos({ finishRecipe: 'P29', isOutsourced: true }), false);
eq('nothing', shopDocNeedsPhos(null), false);

// ── wood is what the finish is TAGGED (Stuart 2026-10-05, M2C stains SM01…SM10) ──────────────
const lib = [
    { code: 'SM01', name: 'NATURAL OAK', material: 'WOOD' }, { code: 'SM01', name: 'NATURAL OAK', material: 'METAL' },   // a duplicate still tagged metal
    { code: 'SM02', name: 'BLONDE', material: 'METAL' },                                                                // not yet corrected
    { code: 'P29', name: 'BLACK', material: 'METAL' }, { code: 'S03', name: 'PURE OAK', material: 'WOOD' },
    { code: 'BRASSWASH', name: 'BRASSWASH' }, { name: 'DRIFTWOOD', material: 'WOOD' },
];
eq('a finish tagged WOOD is not phosphated, whatever its code', [needsPhosphatingOf('SM01', lib), needsPhosphatingOf('SM01 - Natural Oak', lib), needsPhosphatingOf('sm01', lib)], [false, false, false]);
eq('…without the library to ask, SM01 reads as a paint (the caller passes the list)', needsPhosphatingOf('SM01'), true);
eq('a finish still tagged METAL is phosphated — the tag is the fact', needsPhosphatingOf('SM02', lib), true);
eq('an S-code stain stays exempt with or without the list', [needsPhosphatingOf('S03', lib), needsPhosphatingOf('S03'), needsPhosphatingOf('S07', lib)], [false, false, false]);
eq('a paint is phosphated, with the list too', [needsPhosphatingOf('P29', lib), needsPhosphatingOf('BRASSWASH', lib)], [true, true]);
eq('a wood finish known by its name alone', [isWoodFinishRecipe('DRIFTWOOD', lib), isWoodFinishRecipe('Driftwood', lib)], [true, true]);
eq('outsourced and mill are unchanged by the list', [needsPhosphatingOf('EP2', lib), needsPhosphatingOf('MILL', lib), needsPhosphatingOf('', lib)], [false, false, false]);
eq('the code a recipe leads with', [recipeCodeOf('S03 - Pure Oak'), recipeCodeOf(' sm01 natural oak '), recipeCodeOf('EP2 - EP2'), recipeCodeOf('')], ['S03', 'SM01', 'EP2', '']);

console.log(`phosphateRule: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
