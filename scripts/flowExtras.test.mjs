// 🔗 A hand-added item for the rod it fits — H1-138's joiners (Stuart 2026-09-30).   node scripts/flowExtras.test.mjs
import { rodMaterialsOf, itemRodMaterials, extraFitsRod, extrasForRod, liveExtrasOf, baseMaterial, ROD_MATERIALS, noSpliceOf, noSpliceNote } from '../src/components/Shared/flowExtras.js';
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
eq('the rods tab 11 offers', ROD_MATERIALS.map(m => m.key), ['METAL', 'WOOD', 'CLEAR', 'TRAVERSE']);

// ── A TRAVERSE ROD IS ITS OWN KIND (Stuart 2026-10-01: two joiners on an H1-138 traverse) ───
const trv = [
    { id: 'FA', partId: 'H1-138TRV', role: 'FASCIA', position: 'CENTER', tier: 'FRONT', materials: 'METAL', nodes: ['fa'] },
    { id: 'TK', partId: 'H1-2TRVTRK', role: 'TRACK', position: 'CENTER', tier: 'FRONT', nodes: ['tk'] },
    { id: 'TR', partId: 'H1-138TRV', role: 'ROD', rodKind: 'TRAVERSE', position: 'CENTER', tier: 'FRONT', nodes: ['tr'] },
].map(normalizeChoice);
eq('a fascia + its track is a TRAVERSE rod, not METAL', rodMaterialsOf(trv, ['FA', 'TK']), ['TRAVERSE']);
eq('a pole tagged traverse reads the same', rodMaterialsOf(trv, ['TR']), ['TRAVERSE']);
eq('raw fascia (un-normalized) too', rodMaterialsOf([{ id: 'f', role: 'FASCIA' }], ['f']), ['TRAVERSE']);
eq('H1-138 traverse: the round-rod joiner is NOT offered — the chart supplies H1-138TRVJNR', extrasForRod(items, ['TRAVERSE']).map(i => i.code), ['H1-138RING']);
eq('an item ticked TRAVERSE is', extrasForRod([{ code: 'X', rodMaterials: ['TRAVERSE'] }, JNR], ['TRAVERSE']).map(i => i.code), ['X']);
eq('a flow with nothing ticked offers its splice on a traverse as before (H1-2TRV)', extrasForRod([{ code: 'H1-2TRVSPLC', label: 'Splice' }], ['TRAVERSE']).length, 1);

// ── over the one-piece limit with no splice: allowed, and said ─────────────────────────────
ok('144" with the joiner on the line: nothing to say', !noSpliceOf({ lengthInches: 144, limitInches: 120, canSplice: true, spliceQty: 1 }));
ok('144" and the joiner set to 0: a no-splice pole', noSpliceOf({ lengthInches: 144, limitInches: 120, canSplice: true, spliceQty: 0 }));
ok('exactly at the limit is one piece by right', !noSpliceOf({ lengthInches: 120, limitInches: 120, canSplice: true, spliceQty: 0 }));
ok('a flow that offers no joiner is never warned', !noSpliceOf({ lengthInches: 200, limitInches: 120, canSplice: false, spliceQty: 0 }));
ok('a blank limit is 120"', noSpliceOf({ lengthInches: 121, canSplice: true }) && !noSpliceOf({ lengthInches: 119, canSplice: true }));
ok('the flow\'s own limit is used', !noSpliceOf({ lengthInches: 144, limitInches: 150, canSplice: true }));
eq('the shop note', noSpliceNote(144, 120), 'NO SPLICE — 144" pole ships in ONE PIECE (over the 120" one-piece limit; no joiner on this line)');

console.log(`flowExtras: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
