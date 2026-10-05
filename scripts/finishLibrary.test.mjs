// 🎨 The finish library keeps itself straight (Stuart 2026-10-05, M2C · FLAT IRON NEW).   node scripts/finishLibrary.test.mjs
import { finishCodeOf, missingMaterialOf, codeTakenBy, duplicateCodesOf, duplicateRemovalText, withoutIds, withMaterial, finishSaveRefusal, materialKnownFromCode, finishLine } from '../src/components/Shared/finishLibrary.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// The master list as read live on 2026-10-05: SM01 twice (the sync's, then a hand-made copy), both METAL;
// three of the nine the recipe sync made with no material; a CE stain; an outsourced plating.
const A = (n, name) => ({ id: `FIN-1783617207646-a${n}`, code: `SM0${n}`, name, type: 'MIXED', material: 'METAL', status: 'Production Ready', textureUrl: 'tex', clientMapping: [] });
const B = (n, name) => ({ id: `FIN-178361807${n}`, code: `SM0${n}`, name, type: 'WOOD', material: 'METAL', status: 'Working', textureUrl: '', clientMapping: [] });
const list = [
    { id: 'S03', code: 'S03', name: 'PURE OAK', material: 'WOOD', textureUrl: 't' },
    A(1, 'NATURAL OAK'), A(2, 'BLONDE'), B(1, 'NATURAL OAK'), B(2, 'BLONDE'),
    { id: 'bw', code: 'BRASSWASH', name: 'BRASSWASH', type: 'MIXED', status: 'Production Ready', textureUrl: '', clientMapping: [] },
    { id: 'gm', code: 'GUNMETAL', name: 'GUNMETAL', type: 'MIXED', textureUrl: '' },
    { id: 'n66a', code: 'N66', name: 'NICKEL', material: 'METAL', textureUrl: 't', clientMapping: [{ customerId: 'FABRICUT', clientFinishName: 'Satin Nickel' }] },
    { id: 'n66b', code: 'N66', name: 'NICKEL 66', material: 'METAL', textureUrl: '', clientMapping: [{ customerId: 'BRIMAR', clientFinishName: 'Nickel' }] },
];
const outsourced = [{ id: 'EP2', code: 'EP2', name: 'Polished Nickel', material: 'METAL', multiplier: 1 }];

// ── duplicates ──────────────────────────────────────────────────────────────────────────────
const dups = duplicateCodesOf(list);
eq('the codes that exist twice', dups.map(d => d.code), ['N66', 'SM01', 'SM02']);
const sm1 = dups.find(d => d.code === 'SM01');
eq('SM01: keep the Production Ready record with the picture, remove the hand-made copy', [sm1.keep.id, sm1.remove.map(r => r.id), sm1.look.length], ['FIN-1783617207646-a1', ['FIN-1783618071'], 0]);
const n66 = dups.find(d => d.code === 'N66');
eq('N66: the copy carries a customer name the kept one lacks — a person looks, nothing is removed', [n66.keep.id, n66.remove.length, n66.look.map(r => r.id)], ['n66a', 0, ['n66b']]);
eq('a copy with the only picture is never the one removed', (() => { const d = duplicateCodesOf([{ id: 'x', code: 'Q1', status: 'Production Ready', material: 'METAL' }, { id: 'y', code: 'Q1', textureUrl: 't' }])[0]; return [d.keep.id, d.remove.map(r => r.id)]; })(), ['y', ['x']]);
const text = duplicateRemovalText(dups);
ok('the confirm names what is kept, what goes, and what is left to a person', text.startsWith('Remove 2 duplicate finish records?')
    && text.includes('KEEP    SM01 (NATURAL OAK) — Production Ready, picture, material METAL')
    && text.includes('remove  SM01 (NATURAL OAK) — Working, no picture, material METAL')
    && text.includes('Left for you to look at') && text.includes('N66'));
const cleaned = withoutIds(list, dups.flatMap(d => d.remove.map(r => r.id)));
eq('after it: SM01 and SM02 once each, N66 untouched', [cleaned.filter(f => f.code === 'SM01').length, cleaned.filter(f => f.code === 'SM02').length, cleaned.filter(f => f.code === 'N66').length, duplicateCodesOf(cleaned).map(d => d.code)], [1, 1, 2, ['N66']]);
eq('no duplicates: nothing', duplicateCodesOf([{ id: 'a', code: 'P01' }, { id: 'b', code: 'P02' }]), []);

// ── material ────────────────────────────────────────────────────────────────────────────────
eq('finishes with no material', missingMaterialOf(list).map(finishCodeOf), ['BRASSWASH', 'GUNMETAL']);
const wood = withMaterial(cleaned, cleaned.filter(f => /^SM/.test(f.code)).map(f => f.id), 'wood');
eq('bulk: the ticked SM stains become WOOD — and nothing else changes', [wood.filter(f => /^SM/.test(f.code)).map(f => f.material), wood.find(f => f.code === 'S03').material, wood.find(f => f.code === 'N66').material, wood.find(f => f.code === 'BRASSWASH').material], [['WOOD', 'WOOD'], 'WOOD', 'METAL', undefined]);
eq('bulk with no material chosen changes nothing', withMaterial(cleaned, ['bw'], ''), cleaned);
eq('a code that says its own material, and one that does not', [materialKnownFromCode('S03'), materialKnownFromCode('P29'), materialKnownFromCode('EP2'), materialKnownFromCode('MEP11'), materialKnownFromCode('AC'), materialKnownFromCode('SM01'), materialKnownFromCode('BRASSWASH'), materialKnownFromCode('SL1'), materialKnownFromCode('N66')], ['WOOD', 'METAL', 'METAL', 'METAL', 'CLEAR', '', '', '', '']);

// ── the editor's save ───────────────────────────────────────────────────────────────────────
const lists = [list, outsourced];
eq('a new finish with a code that exists is refused', finishSaveRefusal({ config: { name: 'Natural Oak', code: 'sm01', material: 'WOOD' }, lists }).startsWith('SM01 already exists (NATURAL OAK).'), true);
eq('…also when the code lives in the OUTSOURCED list (the board shows both lists)', finishSaveRefusal({ config: { name: 'x', code: 'EP2', material: 'METAL' }, lists }).startsWith('EP2 already exists'), true);
eq('editing a record keeps its own code', finishSaveRefusal({ config: { name: 'PURE OAK', code: 'S03', material: 'WOOD' }, lists, exceptId: 'S03' }), '');
eq('editing one copy of a code that is ALREADY doubled still saves (that is how it gets corrected)', finishSaveRefusal({ config: { name: 'NICKEL', code: 'N66', material: 'METAL' }, lists, exceptId: 'n66a', originalCode: 'N66' }), '');
eq('…but changing a record\'s code INTO one that is taken is refused', finishSaveRefusal({ config: { name: 'PURE OAK', code: 'N66', material: 'WOOD' }, lists, exceptId: 'S03', originalCode: 'S03' }).startsWith('N66 already exists'), true);
eq('no material: refused, and it says why', finishSaveRefusal({ config: { name: 'Matte Brass', code: 'MB', material: '' }, lists }).startsWith('Choose a MATERIAL.'), true);
eq('no name: refused first', finishSaveRefusal({ config: { name: '', code: 'MB', material: 'METAL' }, lists }), 'Finish name required.');
eq('a new code with a material saves', finishSaveRefusal({ config: { name: 'Matte Brass', code: 'MB', material: 'METAL' }, lists }), '');
eq('who holds a code', [codeTakenBy(lists, 'gunmetal').id, codeTakenBy(lists, 'ZZ'), codeTakenBy(lists, '')], ['gm', null, null]);
eq('a record in one line', finishLine(list[5]), 'BRASSWASH — Production Ready, no picture, material NONE');

console.log(`finishLibrary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
