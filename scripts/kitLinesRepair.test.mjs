// 🧰 Kit lines → parts on an old finishing document (Stuart 2026-09-30, WO-SO60432).   node scripts/kitLinesRepair.test.mjs
import { unmarkedKitLinesOf, kitRepairPlanOf, kitRepairStockCodesOf } from '../src/components/Shared/kitLinesRepair.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// The library, as it stands 2026-09-30.
const lib = [
    { id: 'CE-ASM-64480', legacyErpId: 'H1-2TRV-WB', partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ partId: 'CE-ASM-64488', qty: 1 }, { partId: 'CE-ASM-64490', qty: 1 }, { partId: 'CE-ASM-64492', qty: 1 }] } },
    { id: 'CE-ASM-64488', legacyErpId: 'H1-2TRVBP', itemName: 'Backplate for 2" Traverse Wall Bracket', productType: 'Bracket' },
    { id: 'CE-ASM-64489', legacyErpId: 'H1-2TRVBP/P', itemName: 'Backplate for 2" Traverse Wall Bracket - Paint Finish', productType: 'Bracket' },
    { id: 'CE-ASM-64490', legacyErpId: 'H1-2TRVLA', itemName: 'Lower Arm for 2" Traverse Wall Bracket', productType: 'Bracket' },
    { id: 'CE-ASM-64491', legacyErpId: 'H1-2TRVLA/P', itemName: 'Lower Arm for 2" Traverse Wall Bracket - Paint Finish', productType: 'Bracket' },
    { id: 'CE-ASM-64492', legacyErpId: 'H1-2TRVBA', itemName: '2" Traverse Bracket Arm (3-5/8" P)', productType: 'Bracket' },
    { id: 'CE-ASM-64493', legacyErpId: 'H1-2TRVBA/P', itemName: '2" Traverse Bracket Arm (3-5/8" P) - Paint Finish', productType: 'Bracket' },
];
const byCode = (c) => lib.find(p => p.legacyErpId === String(c).toUpperCase()) || null;
const byId = (id) => lib.find(p => p.id === id) || null;

// WO-SO60432 in miniature: the system kit, a real part, two WB/P kits (P14), its hold.
const wb = (cfg) => ({ finishCode: 'P14', finishLabel: 'P14', productType: 'BRACKET', clientSku: 'H3642F', name: '2" Traverse Wall Bracket (3-5/8" P)', binLocation: 'UNASSIGNED', qty: 1, legacyErpId: 'H1-2TRV-WB/P', qtyEach: 1, partId: 'CE-ASM-64480', configQty: cfg });
const fin = {
    id: 'WO-SO60432', recipe: 'P14', pickStatus: 'Pending', held: true, heldReasonKind: 'BACKORDER', heldStage: 'FINISHING', heldBy: 'split', heldAt: 1,
    heldReason: 'waiting on backordered material — 1 × H1-2TRVSRA/P, 1 × H1-2TRV-WB/P, 1 × H1-2TRV-WB/P. The order finishes…',
    partsList: [
        { legacyErpId: 'H1-2TRV-4M/P-45W', qty: 1, binLocation: 'UNASSIGNED' },
        { legacyErpId: 'H1-2TRVSRA/P', qty: 1, finishCode: 'P14', partId: 'CE-ASM-64472' },
        wb(1), wb(2),
    ],
    backorderLines: [
        { qty: 1, code: 'H1-2TRVSRA/P', lineIndex: 1 },
        { qty: 1, code: 'H1-2TRV-WB/P', lineIndex: 2 },
        { qty: 1, code: 'H1-2TRV-WB/P', lineIndex: 3 },
    ],
};

// ── what is found ───────────────────────────────────────────────────────────────────────────
eq('the system kit and both item kits are found, by kind', unmarkedKitLinesOf(fin, byCode).map(k => [k.idx, k.kind]), [[0, 'SYSTEM'], [2, 'ITEM'], [3, 'ITEM']]);
eq('the stock codes to read: each part, its /P and its mill', kitRepairStockCodesOf(fin, byCode, byId).sort(), ['H1-2TRVBA', 'H1-2TRVBA/P', 'H1-2TRVBP', 'H1-2TRVBP/P', 'H1-2TRVLA', 'H1-2TRVLA/P']);

// ── the repair, with none of the parts in stock (the live state 09-30) ─────────────────────
const none = Object.fromEntries(['H1-2TRVBP', 'H1-2TRVBP/P', 'H1-2TRVLA', 'H1-2TRVLA/P', 'H1-2TRVBA', 'H1-2TRVBA/P'].map(c => [c, { available: 0, onOrder: 0 }]));
const soBo = fin.backorderLines.map(b => ({ ...b }));
let p = kitRepairPlanOf({ fin, soBackorderLines: soBo, findByCode: byCode, findPart: byId, stockMap: none, by: 'stuart', now: 9 });
ok('the repair plans', p.ok);
const pl = p.finPatch.partsList;
eq('no line moves: 4 kept in place, 6 parts appended', [pl.length, p.flagged, p.appended], [10, [0, 2, 3], [4, 5, 6, 7, 8, 9]]);
eq('the system kit is flagged, nothing appended for it', [pl[0].isKit, pl[0].kitCode, pl[0].itemKit], [true, 'H1-2TRV-4M/P-45W', undefined]);
eq('each WB/P kit line is flagged an item kit of H1-2TRV-WB', [pl[2].isKit, pl[2].itemKit, pl[2].kitCode], [true, true, 'H1-2TRV-WB']);
eq('its parts: the /P of each, painted P14, one set per kit line', pl.slice(4).map(l => [l.legacyErpId, l.finishCode, l.qty, l.configQty, l.kitLineIdx]),
    [['H1-2TRVBP/P', 'P14', 1, 1, 2], ['H1-2TRVLA/P', 'P14', 1, 1, 2], ['H1-2TRVBA/P', 'P14', 1, 1, 2], ['H1-2TRVBP/P', 'P14', 1, 2, 3], ['H1-2TRVLA/P', 'P14', 1, 2, 3], ['H1-2TRVBA/P', 'P14', 1, 2, 3]]);
eq('a part carries the /P record\'s id and name, and says which kit it came from', [pl[4].partId, pl[4].name, pl[4].inKit, pl[4].kitOf], ['CE-ASM-64489', 'Backplate for 2" Traverse Wall Bracket - Paint Finish', true, 'H1-2TRV-WB/P']);
eq('the real part keeps its place and its backorder', [pl[1].legacyErpId, pl[1].isKit], ['H1-2TRVSRA/P', undefined]);
eq('backorders: the kit\'s two go, six parts come (none in stock)', [p.dropped, p.added, p.finPatch.backorderLines.map(b => [b.code, b.lineIndex])],
    [2, 6, [['H1-2TRVSRA/P', 1], ['H1-2TRVBP/P', 4], ['H1-2TRVLA/P', 5], ['H1-2TRVBA/P', 6], ['H1-2TRVBP/P', 7], ['H1-2TRVLA/P', 8], ['H1-2TRVBA/P', 9]]]);
ok('the hold stays, its words rebuilt from the real parts', p.held && /H1-2TRVSRA\/P/.test(p.finPatch.heldReason) && /H1-2TRVBP\/P/.test(p.finPatch.heldReason) && !/H1-2TRV-WB\/P/.test(p.finPatch.heldReason) && p.finPatch.held === undefined);
eq('the sales order\'s records follow: the kit\'s go, the parts\' come, tagged with the document', [p.soBackorderLines.length, p.soBackorderLines.filter(b => b.finWoId === 'WO-SO60432').length, p.soBackorderLines.some(b => b.code === 'H1-2TRV-WB/P')], [7, 6, false]);
eq('stamped', [p.finPatch.kitRepairedAt, p.finPatch.kitRepairedBy, p.finPatch.kitRepair.dropped], [9, 'stuart', 2]);

// ── parts in stock: no new backorder; with the return arm covered too, the hold is cleared ────
const plenty = Object.fromEntries(Object.keys(none).map(c => [c, { available: 50, onOrder: 0 }]));
p = kitRepairPlanOf({ fin, findByCode: byCode, findPart: byId, stockMap: plenty, now: 9 });
eq('parts in stock: none recorded short, the return arm still holds', [p.added, p.held], [0, true]);
p = kitRepairPlanOf({ fin: { ...fin, backorderLines: fin.backorderLines.filter(b => b.code !== 'H1-2TRVSRA/P') }, findByCode: byCode, findPart: byId, stockMap: plenty, now: 9 });
eq('nothing left short → the hold is cleared, and says why', [p.held, p.finPatch.held, /no line short/.test(p.finPatch.heldClearedNote)], [false, false, true]);
// stock unreadable: parts written, no backorder guessed, the hold not cleared
p = kitRepairPlanOf({ fin: { ...fin, backorderLines: [] }, findByCode: byCode, findPart: byId, stockMap: null, now: 9 });
eq('stock unreadable: no backorder written, no hold cleared', [p.ok, p.added, p.stockKnown, p.finPatch.held], [true, 0, false, undefined]);

// ── refusals ────────────────────────────────────────────────────────────────────────────────
ok('picking started → refused', /picking has started/.test(kitRepairPlanOf({ fin: { ...fin, pickStatus: 'Picked_Awaiting_Staging' }, findByCode: byCode, findPart: byId }).reason));
ok('nothing to repair → said', /no unmarked kit line/.test(kitRepairPlanOf({ fin: { ...fin, partsList: [fin.partsList[1]] }, findByCode: byCode, findPart: byId }).reason));
ok('already repaired → nothing left unmarked', !kitRepairPlanOf({ fin: { ...fin, partsList: kitRepairPlanOf({ fin, findByCode: byCode, findPart: byId, stockMap: none }).finPatch.partsList }, findByCode: byCode, findPart: byId }).ok);
ok('a plated kit is never guessed', /PLATED/.test(kitRepairPlanOf({ fin: { ...fin, partsList: [{ ...wb(1), finishCode: 'EP1', legacyErpId: 'H1-2TRV-WB/EP1' }] }, findByCode: byCode, findPart: byId }).reason));
ok('a part missing from the library → refused, named', /not in the Master Library/.test(kitRepairPlanOf({ fin, findByCode: (c) => (String(c).toUpperCase() === 'H1-2TRVLA/P' ? null : byCode(c)), findPart: byId }).reason));

console.log(`kitLinesRepair: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
