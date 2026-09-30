// node scripts/orderBinPick.test.mjs — every piece into the order's bin before it packs (Stuart 2026-09-30: "this order at
// this point should be showing 100% ready to pack … once it is all picked to the Orders-Com1 bin you do a bin transfer").
import { soGatherStageOf, shelfPickPlanOf, lineBinShareOf, pieceLinesOf, nsItemOf, nsQtyOf, nsBinPlanOf, binSourcesOf, displayShareOf } from '../src/components/Shared/orderBinPick.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

// A slice of SO60551: a plated pole off the floor, two cover-plate lines from the shelf, a standoff line, a fee, a kit,
// and the kit line taken off the order.
const lines = [
    { erp: 'H1-1R', finishCode: 'EP4', toBeFinished: true, finishOutsourced: true, qty: 50 },                  // 0 floor
    { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, finishOutsourced: true, qty: 50 },               // 1 shelf (STOCK)
    { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, finishOutsourced: true, qty: 50 },               // 2 shelf (STOCK)
    { erp: 'H1-1STDOFF', qty: 50 },                                                                            // 3 shelf (stocked)
    { erp: 'H1-FRPF', finishCode: 'EP4', toBeFinished: true, qty: 50, isFee: true },                           // 4 fee
    { erp: 'H1-2RCTAEC', qty: 50, isKit: true, itemKit: true },                                                // 5 kit
    { erp: 'H1-2RCTACEC', qty: 0, offOrder: true, inKit: true, kitLineIdx: 5 },                                // 6 off the order
];
const so = { id: 'S', soId: 'SO60551', lines, oeGen: { 1: { kind: 'STOCK' }, 2: { kind: 'STOCK' } }, committedBin: 'ORDERS-COM1', committedQty: { 'H1-1R/EP4': 50 } };
const stats = { 'H1-1CP-V/EP4': { avail: 130 }, 'H1-1STDOFF': { avail: 276 } };
const statOf = (c) => stats[c] || null;

eq('the lines that carry pieces: no fee, no kit line, nothing taken off the order', pieceLinesOf(so).map(x => x.idx), [0, 1, 2, 3]);
eq('the floor is in, the shelf covers the rest → PICK (not "ready to pack")', soGatherStageOf({ so, statOf }), { stage: 'PICK', waiting: [], toPick: ['H1-1CP-V/EP4', 'H1-1STDOFF'] });
eq('a floor document not yet gathered → WAITING', soGatherStageOf({ so: { ...so, committedQty: {} }, statOf }).stage, 'WAITING');
eq('the shelf short → WAITING, and says which', soGatherStageOf({ so, statOf: (c) => (c === 'H1-1STDOFF' ? { avail: 10 } : statOf(c)) }), { stage: 'WAITING', waiting: ['H1-1STDOFF'], toPick: ['H1-1CP-V/EP4'] });
const all = { ...so, committedQty: { 'H1-1R/EP4': 50, 'H1-1CP-V/EP4': 100, 'H1-1STDOFF': 50 } };
eq('every piece in the bin → PACK', soGatherStageOf({ so: all, statOf }).stage, 'PACK');
eq('…half the cover plates is not all of them', soGatherStageOf({ so: { ...all, committedQty: { ...all.committedQty, 'H1-1CP-V/EP4': 50 } }, statOf }).stage, 'PICK');

// THE PICKS: each item's remaining need, from its live bins largest first, never from the order's own bin.
const binsByCode = {
    'H1-1CP-V/EP4': [{ bin: 'M E4R-N2-R3', name: 'M E4R-N2-R3', qty: 60 }, { bin: 'RAW', name: 'RAW', qty: 70 }, { bin: 'ORDERS-COM1', name: 'ORDERS-COM1', qty: 5 }],
    'H1-1STDOFF': [{ bin: 'U S19', name: 'U S19', qty: 20 }],
};
eq('cover plates: 100 needed — 70 from RAW, 30 from M E4R-N2-R3; standoffs: only 20 on the shelf, named', shelfPickPlanOf({ so, binsOf: (c) => binsByCode[c], toBin: 'ORDERS-COM1' }), [
    { code: 'H1-1CP-V/EP4', need: 100, have: 0, qty: 100, from: [{ bin: 'RAW', qty: 70 }, { bin: 'M E4R-N2-R3', qty: 30 }], ok: true, why: '' },
    { code: 'H1-1STDOFF', need: 50, have: 0, qty: 50, from: [{ bin: 'U S19', qty: 20 }], ok: false, why: 'only 20 of 50 on the shelf' },
]);
eq('one item only, and only what is still missing from the bin', shelfPickPlanOf({ so: { ...so, committedQty: { 'H1-1CP-V/EP4': 80 } }, binsOf: (c) => binsByCode[c], toBin: 'ORDERS-COM1', only: 'h1-1cp-v/ep4' }).map(p => [p.code, p.qty, p.from]), [['H1-1CP-V/EP4', 20, [{ bin: 'RAW', qty: 20 }]]]);
eq('a floor line is never picked from the shelf', shelfPickPlanOf({ so: { ...so, committedQty: {} }, binsOf: () => [{ bin: 'X', qty: 999 }] }).map(p => p.code), ['H1-1CP-V/EP4', 'H1-1STDOFF']);

// THE PACK VIEW: what each line holds in the bin — the item's count handed to its lines in order.
eq('100 cover plates in the bin: 50 on each line; 70 → 50 and 20', [lineBinShareOf(all, 1), lineBinShareOf(all, 2), lineBinShareOf({ ...all, committedQty: { 'H1-1CP-V/EP4': 70 } }, 1), lineBinShareOf({ ...all, committedQty: { 'H1-1CP-V/EP4': 70 } }, 2)], [50, 50, 50, 20]);
eq('a fee or an off-order line holds nothing', [lineBinShareOf(all, 4), lineBinShareOf(all, 6)], [0, 0]);

// ── THE ORDER'S BIN IN NETSUITE: each piece as the item NetSuite knows (Stuart 2026-09-30: "no assemblies for the /P09
// finished items … you are committing the /P stock item and the app is handling the finish") ──
const t = {
    id: 'T', soId: 'SO60551', committedBin: 'ORDERS-COM1',
    lines: [
        { erp: 'H1-1R', finishCode: 'EP4', toBeFinished: true, qty: 50, perFoot: true, feetPer: 2 },          // 0 plated pole, 2 ft, billed by the foot
        { erp: 'H1-138CC', finishCode: 'P06', toBeFinished: true, qty: 50, billedErp: 'H1-138CC/P' },         // 1 painted cap, bills the shared /P
        { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, qty: 50, billedErp: 'H1-1CP-V/EP4' },       // 2 shelf pick (STOCK)
        { erp: 'H1-1CP-V', finishCode: 'EP4', toBeFinished: true, qty: 50, billedErp: 'H1-1CP-V/EP4' },       // 3 shelf pick (STOCK)
        { erp: 'H1-2RCTAECC', finishCode: 'EP1', toBeFinished: true, qty: 50, inKit: true, kitLineIdx: 5 },   // 4 kit part, shelf pick (STOCK)
        { erp: 'H1-2RCTAEC', finishCode: 'EP1', qty: 50, isKit: true, itemKit: true },                        // 5 kit line
        { erp: 'HTSLNTCAR', qty: 500 },                                                                        // 6 stocked
        { erp: 'H1-FRPF', finishCode: 'EP4', toBeFinished: true, qty: 50, isFee: true },                       // 7 fee
    ],
    oeGen: { 0: { kind: 'WO' }, 1: { kind: 'WO' }, 2: { kind: 'STOCK' }, 3: { kind: 'STOCK' }, 4: { kind: 'STOCK' } },
    committedQty: { 'H1-1R/EP4': 50, 'H1-138CC/P06': 50, 'H1-1CP-V/EP4': 100, 'H1-2RCTAECC/EP1': 50, HTSLNTCAR: 500 },
    nsBinQty: { 'H1-1CP-V/EP4': 100, 'H1-2RCTAECC/EP1': 50, HTSLNTCAR: 500 },
};
eq('the NetSuite item: a floor line bills its item (the rod, the shared /P); a shelf pick is the stock item it moved', [0, 1, 2, 4, 6].map(i => nsItemOf(t, t.lines[i], i)), ['H1-1R', 'H1-138CC/P', 'H1-1CP-V/EP4', 'H1-2RCTAECC/EP1', 'HTSLNTCAR']);
eq('a rod sold by the foot moves in feet: 50 poles × 2 ft = 100 ft; pieces are pieces', [nsQtyOf(t.lines[0], 50), nsQtyOf(t.lines[1], 50)], [100, 50]);
eq('what ORDERS-COM1 must still take in NetSuite: the floor pieces (100 ft of H1-1R, 50 × H1-138CC/P); the shelf picks are already there', nsBinPlanOf({ so: t }).map(r => [r.code, r.want, r.have, r.qty]),
    [['H1-1R', 100, 0, 100], ['H1-138CC/P', 50, 0, 50], ['H1-1CP-V/EP4', 100, 100, 0], ['H1-2RCTAECC/EP1', 50, 50, 0], ['HTSLNTCAR', 500, 500, 0]]);
eq('sources: largest bins first, never the order\'s bin; a shortfall is said', [binSourcesOf([{ bin: 'RAW', qty: 80 }, { bin: 'R2', qty: 500 }, { bin: 'ORDERS-COM1', qty: 9 }], 100, 'ORDERS-COM1'), binSourcesOf([{ bin: 'RAW', qty: 30 }], 50, 'ORDERS-COM1')],
    [{ from: [{ bin: 'R2', qty: 100 }], short: 0 }, { from: [{ bin: 'RAW', qty: 30 }], short: 20 }]);

// ONE DISPLAY: every line ÷ 50 — the pieces in the box, and the NetSuite item and quantity the showroom's order carries.
const d1 = displayShareOf({ so: t, boards: 50 });
eq('one display of fifty: a pole (2 ft of H1-1R), a painted cap, two cover plates (one per line), a collar, ten carriers', [d1.ok, d1.lines.map(l => [l.code, l.pieces, l.nsCode, l.nsQty])], [true, [
    ['H1-1R/EP4', 1, 'H1-1R', 2], ['H1-138CC/P06', 1, 'H1-138CC/P', 1], ['H1-1CP-V/EP4', 1, 'H1-1CP-V/EP4', 1], ['H1-1CP-V/EP4', 1, 'H1-1CP-V/EP4', 1], ['H1-2RCTAECC/EP1', 1, 'H1-2RCTAECC/EP1', 1], ['HTSLNTCAR', 10, 'HTSLNTCAR', 10],
]]);
eq('refused: a line that does not divide, or a bin short of one display', [displayShareOf({ so: t, boards: 7 }).ok, displayShareOf({ so: { ...t, committedQty: { ...t.committedQty, HTSLNTCAR: 5 } }, boards: 50 }).why, displayShareOf({ so: t, boards: 0 }).ok],
    [false, 'HTSLNTCAR: the bin holds 5, a display needs 10', false]);

console.log(`orderBinPick: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
