// 🔗 A hand-added item for the rod it fits — H1-138's joiners (Stuart 2026-09-30).   node scripts/flowExtras.test.mjs
import { rodMaterialsOf, itemRodMaterials, extraFitsRod, extrasForRod, liveExtrasOf, baseMaterial, ROD_MATERIALS } from '../src/components/Shared/flowExtras.js';
import { normalizeChoice } from '../src/components/Shared/hardwareModel.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// H1-138 as 1.6 tags it: steel rod untagged (= METAL), wood rod WOOD, acrylic 'CLEAR (NO FINISH)'.
const choices = [
    { id: 'R', partId: 'H1-138R', category: 'POLE', role: 'ROD', position: 'CENTER', tier: 'FRONT', nodes: ['r'] },
    { id: 'WR', partId: 'H1-138WR', role: 'ROD', position: 'CENTER', tier: 'FRONT', materials: 'WOOD', nodes: ['wr'] },
    { id: 'AR', partId: 'H1-138AR', role: 'ROD', position: 'CENTER', tier: 'FRONT', materials: 'CLEAR (NO FINISH)', nodes: ['ar'] },
    { id: 'WRB', partId: 'H1-138WR', role: 'ROD', position: 'CENTER', tier: 'BACK', materials: 'WOOD', nodes: ['wrb'] },
    { id: 'RB', partId: 'H1-138R', role: 'ROD', position: 'CENTER', tier: 'BACK', materials: 'METAL', nodes: ['rb'] },
    { id: 'FIN', partId: 'H1-138WGF', role: 'FINIAL', position: 'LEFT', materials: 'WOOD', nodes: ['f'] },
].map(normalizeChoice);

// ── what the chosen rod is made in ──────────────────────────────────────────────────────────
eq('no rod chosen → nothing known', rodMaterialsOf(choices, []), []);
eq('an untagged steel rod is METAL', rodMaterialsOf(choices, ['R']), ['METAL']);
eq('the wood rod', rodMaterialsOf(choices, ['WR']), ['WOOD']);
eq('the acrylic rod is CLEAR (its note dropped)', rodMaterialsOf(choices, ['AR']), ['CLEAR']);
eq('a wood finial is not a rod', rodMaterialsOf(choices, ['R', 'FIN']), ['METAL']);
eq('a double names both rods', rodMaterialsOf(choices, ['WR', 'RB']), ['METAL', 'WOOD']);
eq('a raw (un-normalized) choice reads the same', rodMaterialsOf([{ id: 'x', role: 'ROD', materials: 'wood' }], ['x']), ['WOOD']);
eq('baseMaterial', [baseMaterial('clear (no finish)'), baseMaterial(' Wood '), baseMaterial('')], ['CLEAR', 'WOOD', '']);

// ── the tab-11 list for H1-138 once it is set ───────────────────────────────────────────────
const JNR = { code: 'H1-138JNR', label: 'Splice for Solid Rod', rodMaterials: ['METAL'] };
const WJ = { code: 'HSCPC1', label: 'Splice for Wood Rod', rodMaterials: ['WOOD'] };
const RING = { code: 'H1-138RING', label: 'Extra ring' };                 // no rod named = any rod
const items = [JNR, WJ, RING];
eq('item materials: array, text, blank', [itemRodMaterials(JNR), itemRodMaterials({ rodMaterials: 'wood, clear (no finish)' }), itemRodMaterials(RING)], [['METAL'], ['WOOD', 'CLEAR'], []]);
eq('steel rod → the steel joiner + the any-rod item', extrasForRod(items, ['METAL']).map(i => i.code), ['H1-138JNR', 'H1-138RING']);
eq('wood rod → the wood joiner', extrasForRod(items, ['WOOD']).map(i => i.code), ['HSCPC1', 'H1-138RING']);
eq('acrylic rod → neither joiner (none is named for it)', extrasForRod(items, ['CLEAR']).map(i => i.code), ['H1-138RING']);
eq('no rod yet → everything is offered', extrasForRod(items, []).map(i => i.code), ['H1-138JNR', 'HSCPC1', 'H1-138RING']);
eq('a double of wood + steel → both joiners', extrasForRod(items, ['METAL', 'WOOD']).map(i => i.code), ['H1-138JNR', 'HSCPC1', 'H1-138RING']);
ok('an item for several rods fits each', extraFitsRod({ rodMaterials: ['METAL', 'CLEAR'] }, ['CLEAR']) && !extraFitsRod({ rodMaterials: ['METAL', 'CLEAR'] }, ['WOOD']));

// ── EVERY FLOW AS IT IS TODAY: no item names a rod, so nothing changes ─────────────────────
const today = [{ code: 'H1-138JNR', label: 'Splice for Solid Rod' }, { code: '', label: '' }];
eq('today\'s H1-138 list on a wood rod is unchanged', extrasForRod(today, ['WOOD']), today);
ok('rows typed today are all live on any rod', liveExtrasOf([{ code: 'H1-138JNR', qty: '1' }], today, ['WOOD']).length === 1);

// ── typed rows: filtered, never deleted ─────────────────────────────────────────────────────
const typed = [{ code: 'HSCPC1', qty: '1', note: '40" from left edge' }, { code: 'H1-138RING', qty: '2' }];
eq('switch the wood rod to steel: the wood joiner stops billing', liveExtrasOf(typed, items, ['METAL']).map(x => x.code), ['H1-138RING']);
eq('…switch back: it is live again, note and all', liveExtrasOf(typed, items, ['WOOD'])[0], typed[0]);
eq('case of the code does not matter', liveExtrasOf([{ code: 'hscpc1', qty: '1' }], items, ['METAL']), []);
eq('a row whose code is not on the list (an older order) is kept', liveExtrasOf([{ code: 'H1-OLDJNR', qty: '1' }], items, ['WOOD']).map(x => x.code), ['H1-OLDJNR']);
eq('empty inputs', [liveExtrasOf(), extrasForRod(), rodMaterialsOf()], [[], [], []]);
eq('the materials tab 11 offers', ROD_MATERIALS.map(m => m.key), ['METAL', 'WOOD', 'CLEAR']);

console.log(`flowExtras: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
