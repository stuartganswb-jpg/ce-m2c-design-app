// node scripts/itemKit.test.mjs — an item kit is one thing sold and several things made, on every door (Stuart 2026-09-28:
// "we will never stock these complete … for netsuite just push the 3 independent parts … correct and very important rule for
// all screens"). The library records below are SO60551's, as they are live.
import { isItemKit, itemKitOfCode, itemKitOrderLinesOf, kitPartFinishOf, isKitLine, isFootCountedRod, kitPartCountOf, kitRodLinePatchOf } from '../src/components/Shared/itemKit.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const rec = (id, code, extra = {}) => ({ id, legacyErpId: code, itemName: code, manufacturingSpecs: {}, ...extra });
const lib = [
    rec('CE-ASM-64480', 'H1-2TRV-WB', { partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ qty: 1, partId: 'CE-ASM-64488' }, { partId: 'CE-ASM-64490', qty: 1 }, { qty: 1, partId: 'CE-ASM-64492' }] } }),
    rec('CE-ASM-64481', 'H1-2TRV-WB/P', { partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ qty: 1, partId: 'BPP' }] } }),
    rec('CE-ASM-64562', 'H1-2TRV-WB/C', { partClass: 'Assembly' }),     // never stocked or built — names the kit in TCP
    rec('CE-ASM-64488', 'H1-2TRVBP'), rec('CE-ASM-64490', 'H1-2TRVLA'), rec('CE-ASM-64492', 'H1-2TRVBA'),
    rec('CE-INV-55963', 'H1-2RCTAEC', { partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ qty: 1, partId: 'CE-INV-59098' }, { partId: 'CE-ASM-64652', qty: 1 }] } }),
    rec('CE-INV-59098', 'H1-2RCTAECC', { partClass: 'Assembly' }),                                  // the collar
    rec('CE-ASM-64652', 'H1-2RCTACEC', { partClass: 'Inventory', manufacturingSpecs: { customData: { unfinished: true } } }),   // clear acrylic
    rec('CE-ASM-64654', 'H1-2RCTAEC/EP1', { partClass: 'Assembly' }),
    rec('TRV-SYS', 'H1-2TRV-4M/P', { partClass: 'Kit', manufacturingSpecs: { kitAlign: { setup: 'SINGLE' }, kitComponents: [{ partId: 'CE-ASM-64488', qty: 1 }] } }),
];
const byCode = (c) => lib.find(p => p.legacyErpId === String(c || '').toUpperCase()) || null;
const byId = (id) => lib.find(p => p.id === id) || null;

ok('an item kit: Kit class with components', isItemKit(byCode('H1-2TRV-WB')));
ok('…a traverse SYSTEM kit is not', !isItemKit(byCode('H1-2TRV-4M/P')));
eq('a finished kit code names the MILL kit and its finish: /C → TCP, /B → TBR, /EP1 → EP1, /P → primed', [
    ['H1-2TRV-WB/C', 'H1-2TRV-WB', 'H1-2RCTAEC/EP1', 'H1-2TRV-WB/P'].map(c => { const h = itemKitOfCode(c, byCode); return h && [h.kitCode, h.finishCode, h.subFinishCode, h.primed]; }),
], [[['H1-2TRV-WB', '', 'TCP', false], ['H1-2TRV-WB', '', '', false], ['H1-2RCTAEC', 'EP1', '', false], ['H1-2TRV-WB', '', '', true]]]);
eq('…and a part that is not a kit is null', [itemKitOfCode('H1-2TRVBP', byCode), itemKitOfCode('H1-2TRV-4M/P', byCode)], [null, null]);

// SO60551 line 13: 50 × H1-2TRV-WB/C, Row 2 — the kit, then its three parts in their /C items (the shelf first).
const wb = itemKitOrderLinesOf({ line: { erp: 'H1-2TRV-WB/C', qty: 50, row: 'Row 2', memo: 'Row 2' }, findByCode: byCode, findPart: byId });
eq('the kit line stays as sold, flagged — never made or picked', [wb.kitLine.erp, wb.kitLine.isKit, wb.kitLine.kitCode, wb.kitLine.toBeFinished, isKitLine(wb.kitLine)], ['H1-2TRV-WB/C', true, 'H1-2TRV-WB', false, true]);
eq('three parts, each its /C item in TCP, 50 each, in the kit\'s row, $0, hidden, kitOf the sold code',
    wb.parts.map(p => [p.erp, p.subFinishCode, p.stockColour, p.toBeFinished, p.qty, p.row, p.price, p.hidden, p.kitOf]),
    [['H1-2TRVBP/C', 'TCP', true, false, 50, 'Row 2', 0, true, 'H1-2TRV-WB/C'], ['H1-2TRVLA/C', 'TCP', true, false, 50, 'Row 2', 0, true, 'H1-2TRV-WB/C'], ['H1-2TRVBA/C', 'TCP', true, false, 50, 'Row 2', 0, true, 'H1-2TRV-WB/C']]);

// SO60551 line 30: 50 × H1-2RCTAEC/EP1 — the acrylic wears nothing (Unfinished), the collar is plated EP1.
const ec = itemKitOrderLinesOf({ line: { erp: 'H1-2RCTAEC/EP1', qty: 50, row: 'Base Back 1' }, findByCode: byCode, findPart: byId });
eq('the acrylic end cap kit in EP1: the collar to be plated, the clear acrylic as it is', ec.parts.map(p => [p.erp, p.finishCode || '', !!p.toBeFinished, !!p.finishOutsourced, !!p.noFinish]),
    [['H1-2RCTAECC', 'EP1', true, true, false], ['H1-2RCTACEC', '', false, false, true]]);
// SO60551 line 29: the same kit with no finish — both parts as they are.
eq('…with no finish: both parts as they are', itemKitOrderLinesOf({ line: { erp: 'H1-2RCTAEC', qty: 50 }, findByCode: byCode, findPart: byId }).parts.map(p => [p.erp, !!p.noFinish]), [['H1-2RCTAECC', true], ['H1-2RCTACEC', true]]);
eq('the line\'s own finish wins over the finish its code names (a painted order of the mill kit)', itemKitOrderLinesOf({ line: { erp: 'H1-2TRV-WB', qty: 2, finishCode: 'P06' }, findByCode: byCode, findPart: byId }).parts.map(p => [p.erp, p.finishCode, p.toBeFinished]),
    [['H1-2TRVBP', 'P06', true], ['H1-2TRVLA', 'P06', true], ['H1-2TRVBA', 'P06', true]]);
eq('a primed kit (/P) is its parts\' /P items', itemKitOrderLinesOf({ line: { erp: 'H1-2TRV-WB/P', qty: 1 }, findByCode: byCode, findPart: byId }).parts.map(p => p.erp), ['H1-2TRVBP/P', 'H1-2TRVLA/P', 'H1-2TRVBA/P']);
eq('a part the library cannot find is named, never guessed', itemKitOrderLinesOf({ line: { erp: 'H1-2TRV-WB/C', qty: 1 }, findByCode: byCode, findPart: (id) => id === 'CE-ASM-64490' ? null : byId(id) }).missing, ['CE-ASM-64490']);
eq('an ordinary line is not a kit', itemKitOrderLinesOf({ line: { erp: 'H1-2TRVBP', qty: 1 }, findByCode: byCode, findPart: byId }), null);
eq('a part\'s finish: the kit\'s, else its colour, never on an Unfinished part', [kitPartFinishOf(byCode('H1-2TRVBP'), { finishCode: 'P06' }), kitPartFinishOf(byCode('H1-2TRVBP'), { subFinishCode: 'TBR' }), kitPartFinishOf(byCode('H1-2RCTACEC'), { finishCode: 'EP1' })],
    [{ finishCode: 'P06', subFinishCode: '', noFinish: false }, { finishCode: '', subFinishCode: 'TBR', noFinish: false }, { finishCode: '', subFinishCode: '', noFinish: true }]);
// ── A KIT'S ROD IS ONE ROD OF THAT LENGTH, PER KIT (Stuart 2026-10-12, SO60812: 100 × HRW-138TRAV12, RF1) ─────────
// The records as they are live: the 12 ft track kit lists 12 × H1-138TRV, and H1-138TRV is a POLE counted by the FOOT.
const rodLib = [
    rec('CE-INV-1179', 'HRW-138TRAV12', { partClass: 'Kit', manufacturingSpecs: { productType: 'POLE', uom: 'EA', kitComponents: [{ partId: 'CE-INV-52989', qty: 12 }] } }),
    rec('CE-INV-52989', 'H1-138TRV', { partClass: 'Inventory', manufacturingSpecs: { productType: 'POLE', uom: 'FOOT', stockUnit: 'FOOT' } }),
    rec('CE-INV-7', 'HTAEC35', { partClass: 'Inventory', manufacturingSpecs: { productType: 'End Cap', uom: 'Each' } }),
    rec('CE-INV-8', 'POLE-EA', { partClass: 'Inventory', manufacturingSpecs: { productType: 'POLE', uom: 'EA' } }),
    rec('CE-INV-9', 'TAPE-FT', { partClass: 'Inventory', manufacturingSpecs: { productType: 'Tape', uom: 'FT' } }),
];
const rodByCode = (c) => rodLib.find(p => p.legacyErpId === String(c || '').toUpperCase()) || null;
const rodById = (id) => rodLib.find(p => p.id === id) || null;
eq('a rod counted by the foot: a POLE whose unit is the foot — never a pole by the each, never a non-pole by the foot',
    ['H1-138TRV', 'POLE-EA', 'TAPE-FT', 'HTAEC35'].map(c => isFootCountedRod(rodByCode(c))), [true, false, false, false]);
ok('…NetSuite\'s stock unit counts when the Library unit is blank', isFootCountedRod({ manufacturingSpecs: { productType: 'POLE', stockUnit: 'FOOT' } }));
eq('100 kits × 12 ft of rod = 100 rods at 12 ft, 1200 ft billed', kitPartCountOf(rodByCode('H1-138TRV'), 12, 100), { qty: 100, perFoot: true, feetPer: 12, billedFeet: 1200 });
eq('…every other part multiplies as it always has', [kitPartCountOf(rodByCode('HTAEC35'), 2, 100), kitPartCountOf(rodByCode('POLE-EA'), 1, 5), kitPartCountOf(null, 3, 2)], [{ qty: 200 }, { qty: 5 }, { qty: 6 }]);
const trv = itemKitOrderLinesOf({ line: { erp: 'HRW-138TRAV12', qty: 100, finishCode: 'RF1' }, findByCode: rodByCode, findPart: rodById });
eq('SO60812 entered today: the kit line, then ONE rod line — 100 pieces, by the foot, 12 ft each, 1200 ft billed, to be finished RF1',
    trv.parts.map(p => [p.erp, p.qty, p.perFoot, p.feetPer, p.billedFeet, p.finishCode, p.toBeFinished, p.inKit, p.kitOf, p.hidden, p.price]),
    [['H1-138TRV', 100, true, 12, 1200, 'RF1', true, true, 'HRW-138TRAV12', true, 0]]);
// SO60812 as it was saved 2026-09-30: the rod as 1200 (feet), no length.
const oldRod = { erp: 'H1-138TRV', qty: 1200, toBeFinished: true, finishCode: 'RF1', inKit: true, kitOf: 'HRW-138TRAV12', hidden: true };
eq('a kit rod saved as feet with no length reads as the kit\'s rods: 1200 ft = 100 × 12 ft',
    kitRodLinePatchOf({ line: oldRod, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }), { qty: 100, perFoot: true, feetPer: 12, billedFeet: 1200 });
eq('…a line that already carries its length, a line that is not in a kit, a part that is not a foot rod, a kit that does not list it: left alone', [
    kitRodLinePatchOf({ line: { ...oldRod, qty: 100, perFoot: true, feetPer: 12 }, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }),
    kitRodLinePatchOf({ line: { ...oldRod, cutLength: 144 }, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }),
    kitRodLinePatchOf({ line: { erp: 'H1-138TRV', qty: 1200 }, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }),
    kitRodLinePatchOf({ line: { ...oldRod, erp: 'HTAEC35' }, part: rodByCode('HTAEC35'), findByCode: rodByCode, findPart: rodById }),
    kitRodLinePatchOf({ line: { ...oldRod, kitOf: 'NOT-A-KIT' }, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }),
], [null, null, null, null, null]);
eq('…and feet that do not divide into whole rods are a person\'s to look at, never rounded', kitRodLinePatchOf({ line: { ...oldRod, qty: 1205 }, part: rodByCode('H1-138TRV'), findByCode: rodByCode, findPart: rodById }), null);

console.log(`itemKit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
