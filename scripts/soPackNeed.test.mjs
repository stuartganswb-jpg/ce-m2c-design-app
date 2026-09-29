// node scripts/soPackNeed.test.mjs — one item, one need (Stuart 2026-09-29, SO60551: "H1-1CP-V/EP4 100 required, the top two
// rows are full poles") and a kit taken off the order ("this is base so it is a single pole with one endcap, it needs just 50").
import { soPackLineStateOf, soOrderReadyOf, soCodeNeedOf, gatherPlanOf, soLineIsFee } from '../src/components/Shared/pickLines.js';
import { planCommit } from '../src/components/Shared/committedBins.js';
import { kitQtyEditOf, lineStateOf } from '../src/components/Shared/displayRelease.js';
import { isOffOrderLine } from '../src/components/Shared/itemKit.js';
import { customerDocLines } from '../src/components/Shared/lineClassification.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

// SO60551's repeated items, as the order carries them (two full-pole rows: a cover plate at each end).
const lines = [
    { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, finishOutsourced: true, qty: 50, row: 'ROW 1' },   // 0
    { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, finishOutsourced: true, qty: 50, row: 'ROW 1' },   // 1
    { erp: 'H1-1STDOFF', qty: 50, row: 'ROW 1' }, { erp: 'H1-1STDOFF', qty: 50, row: 'ROW 1' }, { erp: 'H1-1STDOFF', qty: 50, row: 'ROW 1' },   // 2-4
    { erp: 'H1-FRPF', finishCode: 'EP4', toBeFinished: true, qty: 50, isFee: true, row: 'ROW 1' },               // 5 — a fee
    { erp: 'H1-2TRVCLP', finishCode: 'TCP', subFinishCode: 'TCP', toBeFinished: true, qty: 50, row: 'ROW 2' },    // 6
    { erp: 'H1-2TRVCLP', finishCode: 'TCP', subFinishCode: 'TCP', toBeFinished: true, qty: 50, row: 'ROW 2' },    // 7
];
const so = { id: 'SO-APP-QUOTE-1789660306300', soId: 'SO60551', lines, oeGen: { 0: { kind: 'STOCK' }, 1: { kind: 'STOCK' } }, committedBin: 'ORDERS-COM1', committedQty: {} };

eq('an item on two lines is ONE need: cover plates 100, standoffs 150, F-clips 100; a fee needs nothing', [soCodeNeedOf(so, 'H1-1CP-V/EP4'), soCodeNeedOf(so, 'H1-1STDOFF'), soCodeNeedOf(so, 'H1-2TRVCLP/C'), soCodeNeedOf(so, 'H1-FRPF/EP4')], [100, 150, 100, 0]);
const at = (o, i, avail) => soPackLineStateOf({ so: o, line: o.lines[i], idx: i, stat: { avail } });
eq('130 cover plates on the shelf cover the 100; 60 do not — on BOTH lines', [at(so, 0, 130).state, at(so, 1, 130).state, at(so, 0, 60).state, at(so, 1, 60).state], ['READY', 'READY', 'SHORT', 'SHORT']);
const half = { ...so, committedQty: { 'H1-1CP-V/EP4': 50 } };
eq('50 gathered of the 100 is NOT gathered — neither line (it read both GATHERED before)', [at(half, 0, 0).state, at(half, 1, 0).state], ['SHORT', 'SHORT']);
const full = { ...so, committedQty: { 'H1-1CP-V/EP4': 100 } };
eq('100 gathered: both lines GATHERED', [at(full, 0, 0).state, at(full, 1, 0).state], ['GATHERED', 'GATHERED']);
eq('the gather caps at the whole need, not one line: 50 more on top of 50 is allowed; 51 is not', [
    planCommit({ order: half, code: 'H1-1CP-V/EP4', qty: 50, ordered: soCodeNeedOf(half, 'H1-1CP-V/EP4') }).ok,
    planCommit({ order: half, code: 'H1-1CP-V/EP4', qty: 51, ordered: soCodeNeedOf(half, 'H1-1CP-V/EP4') }).ok,
], [true, false]);
eq('a floor document carrying both F-clip lines gathers both (100), and needs no second pass', gatherPlanOf({ job: { soLineIdxs: [6, 7] }, order: so }).map(w => [w.code, w.qty, w.need, w.add]), [['H1-2TRVCLP/C', 50, 100, 50], ['H1-2TRVCLP/C', 50, 100, 50]]);
eq('…and a second document for the same item adds only what is still needed', gatherPlanOf({ job: { soLineIdxs: [7] }, order: { ...so, committedQty: { 'H1-2TRVCLP/C': 50 } } }).map(w => w.add), [50]);
eq('…nothing when the item is already whole', gatherPlanOf({ job: { soLineIdxs: [7] }, order: { ...so, committedQty: { 'H1-2TRVCLP/C': 100 } } }).map(w => w.add), [0]);
eq('the order is ready only when every item\'s whole need is covered', [
    soOrderReadyOf({ so: { ...so, committedQty: { 'H1-2TRVCLP/C': 100 } }, statOf: (c) => ({ 'H1-1CP-V/EP4': { avail: 130 }, 'H1-1STDOFF': { avail: 276 } })[c] || null }),
    soOrderReadyOf({ so: { ...so, committedQty: { 'H1-2TRVCLP/C': 100 } }, statOf: (c) => ({ 'H1-1CP-V/EP4': { avail: 130 }, 'H1-1STDOFF': { avail: 100 } })[c] || null }),
], [true, false]);

// ── the Base Back 1 end cap: two kit lines (the 9/16 clear cap and its EP1 collar, each read as a whole kit) ──
const kitLines = [];
kitLines[29] = { erp: 'H1-2RCTAEC', qty: 50, row: 'Base Back 1', isKit: true, itemKit: true, finishCode: 'EP1' };
kitLines[30] = { erp: 'H1-2RCTAEC', qty: 50, row: 'Base Back 1', isKit: true, itemKit: true, finishCode: 'EP1', finishOutsourced: true };
kitLines[43] = { erp: 'H1-2RCTAECC', qty: 50, row: 'Base Back 1', inKit: true, kitLineIdx: 29, finishCode: 'EP1', toBeFinished: true, finishOutsourced: true, hidden: true, price: 0 };
kitLines[44] = { erp: 'H1-2RCTACEC', qty: 50, row: 'Base Back 1', inKit: true, kitLineIdx: 29, noFinish: true, hidden: true, price: 0 };
kitLines[45] = { erp: 'H1-2RCTAECC', qty: 50, row: 'Base Back 1', inKit: true, kitLineIdx: 30, finishCode: 'EP1', toBeFinished: true, finishOutsourced: true, hidden: true, price: 0 };
kitLines[46] = { erp: 'H1-2RCTACEC', qty: 50, row: 'Base Back 1', inKit: true, kitLineIdx: 30, noFinish: true, hidden: true, price: 0 };
for (let i = 0; i < 29; i++) kitLines[i] = { erp: `X${i}`, qty: 1 };
for (let i = 31; i < 43; i++) kitLines[i] = { erp: `Y${i}`, qty: 1 };
const kso = { id: 'S', soId: 'SO60551', lines: kitLines, oeGen: { 30: { kind: 'STOCK' }, 43: { kind: 'STOCK', code: 'H1-2RCTAECC/EP1' }, 45: { kind: 'STOCK', code: 'H1-2RCTAECC/EP1' } } };
eq('before: the collar and the clear cap read as 100 each', [soCodeNeedOf(kso, 'H1-2RCTAECC/EP1'), soCodeNeedOf(kso, 'H1-2RCTACEC')], [100, 100]);
const r = kitQtyEditOf({ so: kso, lineIdx: 29, qty: 0, by: 'stuart', reason: 'one end cap per pole', now: 3 });
eq('0 takes the kit and its parts off the order — in their places, stamped; the collar\'s shelf-pick stamp goes', [
    r.ok, r.from, r.to, r.lines.length, [29, 43, 44].map(i => [r.lines[i].qty, r.lines[i].offOrder, r.lines[i].qtyChangedReason]), r.oeGenDrop, r.parts.map(p => [p.idx, p.code, p.from, p.to]),
], [true, 50, 0, 47, [[0, true, 'one end cap per pole'], [0, true, 'one end cap per pole'], [0, true, 'one end cap per pole']], [43], [[43, 'H1-2RCTAECC/EP1', 50, 0], [44, 'H1-2RCTACEC', 50, 0]]]);
const after = { ...kso, lines: r.lines, oeGen: { 30: { kind: 'STOCK' }, 45: { kind: 'STOCK' } } };
eq('after: 50 collars and 50 clear caps — the other kit, untouched', [soCodeNeedOf(after, 'H1-2RCTAECC/EP1'), soCodeNeedOf(after, 'H1-2RCTACEC'), r.lines[30], r.lines[45]], [50, 50, kitLines[30], kitLines[45]]);
eq('an off-order line needs nothing at SO Pack, and never holds the order back', [soPackLineStateOf({ so: after, line: after.lines[43], idx: 43, stat: { avail: 0 } }).state, soLineIsFee(after, after.lines[44], 44), isOffOrderLine(after.lines[29])], ['OFF THE ORDER', true, true]);
eq('10.5 says so, and counts it with nothing to start', lineStateOf({ so: after, line: after.lines[43], lineIdx: 43 }), { key: 'STOCKED', text: 'off the order — one end cap per pole', tone: 'grey' });
eq('no customer paper carries it', customerDocLines([{ erp: 'A', qty: 1, name: 'A' }, { ...after.lines[29] }], 'PACKING_SLIP').map(l => l.erp), ['A']);
eq('refused: not a kit · unchanged · no reason · not whole · floor work on a part · raising an off-order kit', [
    kitQtyEditOf({ so: kso, lineIdx: 43, qty: 0, reason: 'x' }).ok,
    kitQtyEditOf({ so: kso, lineIdx: 29, qty: 50, reason: 'x' }).ok,
    kitQtyEditOf({ so: kso, lineIdx: 29, qty: 0, reason: ' ' }).ok,
    kitQtyEditOf({ so: kso, lineIdx: 29, qty: 1.5, reason: 'x' }).ok,
    kitQtyEditOf({ so: { ...kso, oeGen: { 43: { kind: 'WO' } } }, lineIdx: 29, qty: 0, reason: 'x' }).ok,
    kitQtyEditOf({ so: after, lineIdx: 29, qty: 50, reason: 'x' }).ok,
], [false, false, false, false, false, false]);
eq('refused while more is gathered than the order would still need', kitQtyEditOf({ so: { ...kso, committedQty: { 'H1-2RCTAECC/EP1': 100 } }, lineIdx: 29, qty: 0, reason: 'x' }).ok, false);
eq('…allowed when what is gathered still fits', kitQtyEditOf({ so: { ...kso, committedQty: { 'H1-2RCTAECC/EP1': 50 } }, lineIdx: 29, qty: 0, reason: 'x' }).ok, true);
eq('a kit\'s quantity can change without leaving the order: its parts keep their per-kit count', (() => { const x = kitQtyEditOf({ so: kso, lineIdx: 29, qty: 25, reason: 'x' }); return [x.lines[29].qty, x.lines[43].qty, x.lines[44].qty, x.lines[43].offOrder, x.oeGenDrop]; })(), [25, 25, 25, undefined, []]);

console.log(`soPackNeed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
