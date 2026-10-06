// node scripts/rowRelease.test.mjs — a row is released by the display, not only whole (Stuart 2026-10-05: "put say just
// 10pcs (full rows) of the 35pcs into motion" · "1. release count" · "if we make 10pcs of row 1 and 25 of row 2 and 7pc of
// row 3, the maximum that could be shipped would be 7").
import { isReleaseByCount, releaseByCountPatch, releaseRowKeyOf, rowTargetOf, rowDisplaysOf, releaseRunOf, nextRowReleaseOf, releaseLabelOf, lineTargetOf, lineDueOf, releasedByKindOf, releasedQtyOf, releaseStampOf, stampWithoutRunOf, rowReleasePlanOf, countSwitchOf, isWholeStamp, ORDER_ROW_KEY } from '../src/components/Shared/rowRelease.js';
import { soLineReleasedOf, soCodeReleasedOf, soCodeReleasedNeedOf, soShelfToPickOf, soPackLineStateOf, gatherPlanOf, soLineIsShelfPick, soCodeNeedOf } from '../src/components/Shared/pickLines.js';
import { soGatherStageOf, shelfPickPlanOf, lineBinShareOf, shippableDisplaysOf, displayShareOf, nsBinPlanOf } from '../src/components/Shared/orderBinPick.js';
import { lineStateOf, rowStateOf, rowReleaseText, rowReleaseCountOf, countSwitchText, rowRestartPlanOf, rowRestartText, LINE_STATE } from '../src/components/Shared/displayRelease.js';
import { pairShapeOf } from '../src/components/Shared/rowPairShape.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => eq(n, !!c, true);

// ── A wall of 35 displays, three rows ─────────────────────────────────────────────────────────────────────────────────
//  Row 1: a painted connector (2 per display, made), a standoff (1 per display, stocked), a plated finial (1, made → shelf)
//  Row 2: a pole cut to length (1 per display, made) and its French-return fee (2 per display, rides the pole)
//  Row 3: a stocked bracket only (1 per display)
//  the order's own line: its base (1 per display, stocked, orderLevel)
const lines = [
    { erp: 'H1-138CC', finishCode: 'P06', toBeFinished: true, qty: 70, row: 'Row 1' },                              // 0
    { erp: 'H1-1STDOFF', qty: 35, row: 'Row 1' },                                                                  // 1 stocked
    { erp: 'H1-1BF', finishCode: 'EP2', toBeFinished: true, finishOutsourced: true, qty: 35, row: 'Row 1' },       // 2 plated small part
    { erp: 'H1-75SR', finishCode: 'P06', toBeFinished: true, qty: 35, perFoot: true, feetPer: 2, cutLength: 18, row: 'Row 2' },   // 3 pole
    { erp: 'H1-FRPF', finishCode: 'P06', toBeFinished: true, qty: 70, isFee: true, row: 'Row 2' },                 // 4 fee riding the pole
    { erp: 'H1-75SBKT', qty: 35, row: 'Row 3' },                                                                   // 5 stocked only
    { erp: 'H1-WB1', qty: 35, orderLevel: true },                                                                  // 6 the base
    { erp: 'H1-KIT', qty: 35, isKit: true, itemKit: true, row: 'Row 1' },                                          // 7 kit line — no pieces
];
const base = { id: 'S1', soId: 'SO70001', displayRelease: true, orderClass: 'QUICKSHIP', lines, ...releaseByCountPatch(35) };

eq('the patch that puts an order on release counts', releaseByCountPatch(35), { releaseByCount: true, releaseOf: 35 });
eq('…and no patch when the build does not say how many displays it is', releaseByCountPatch(0), {});
ok('the order is released by count', isReleaseByCount(base));
ok('an order from before is not', !isReleaseByCount({ ...base, releaseByCount: undefined }));
eq('a line releases under its row; the order\'s own line under ORDER', [releaseRowKeyOf(lines[0]), releaseRowKeyOf(lines[5]), releaseRowKeyOf(lines[6])], ['ROW_1', 'ROW_3', ORDER_ROW_KEY]);

// ── the row's count ──
eq('nothing released: target 0 of 35', [rowTargetOf(base, 'ROW_1'), rowDisplaysOf(base, 'ROW_1')], [0, 35]);
const r1 = nextRowReleaseOf({ so: base, rowKey: 'ROW_1', add: 10, of: 35, by: 'stuart', now: 1 });
eq('10 more → 10 of 35, logged as run 1 (displays 1–10)', r1, { boards: 10, of: 35, at: 1, by: 'stuart', log: [{ no: 1, from: 0, to: 10, at: 1, by: 'stuart' }] });
const so10 = { ...base, rowRelease: { ROW_1: r1 } };
eq('the run a start belongs to', releaseRunOf(so10, 'ROW_1'), { no: 1, from: 0, to: 10, of: 35 });
const r1b = nextRowReleaseOf({ so: so10, rowKey: 'ROW_1', add: 10, of: 35, by: 'stuart', now: 2 });
eq('10 more again → 20, run 2 (displays 11–20)', [r1b.boards, r1b.log.length, r1b.log[1]], [20, 2, { no: 2, from: 10, to: 20, at: 2, by: 'stuart' }]);
eq('run again at the same count adds no run', nextRowReleaseOf({ so: so10, rowKey: 'ROW_1', add: 0, of: 35, now: 3 }).log.length, 1);
eq('never past the displays on the order', nextRowReleaseOf({ so: so10, rowKey: 'ROW_1', add: 99, of: 35, now: 3 }).boards, 35);
eq('what a release is called', [releaseLabelOf({ from: 0, to: 10, of: 35 }), releaseLabelOf({ from: 10, to: 20, of: 35 }), releaseLabelOf({ from: 20, to: 21, of: 35 }), releaseLabelOf(null)], ['displays 1–10 of 35', 'displays 11–20 of 35', 'display 21 of 35', '']);

// ── what a line is due ──
eq('2 per display × 10 displays', lineTargetOf(so10, lines[0]).qty, 20);
eq('1 per display × 10', lineTargetOf(so10, lines[1]).qty, 10);
eq('a row not released is due nothing', lineTargetOf(so10, lines[3]).qty, 0);
eq('due = target less what is already raised', lineDueOf(so10, lines[0], 0).qty, 20);
const odd = { ...base, lines: [{ erp: 'X', qty: 54, row: 'Row 1' }], rowRelease: { ROW_1: { boards: 10, of: 35 } } };
eq('a line that does not divide by the display stops a partial release', [lineTargetOf(odd, odd.lines[0]).ok, lineTargetOf(odd, odd.lines[0]).why], [false, '54 does not divide into 35 displays']);
eq('…but every display released is the whole line, no division asked', lineTargetOf({ ...odd, rowRelease: { ROW_1: { boards: 35, of: 35 } } }, odd.lines[0]), { qty: 54, ok: true, why: '', target: 35, of: 35, whole: true });
eq('a fee riding a pole is counted with it (rounded), never a stop', lineTargetOf(odd, odd.lines[0], { round: true }).qty, 15);

// ── the line's stamp: releases join, the stamp's own kind stays what older readers ask ──
const st1 = releaseStampOf({ cur: null, kind: 'WO', ids: ['WO-A', 'WO-A-C'], qty: 20, run: { no: 1, from: 0, to: 10, of: 35 }, at: 5, by: 'u', rowKey: 'ROW_1', finish: 'P06' });
eq('release 1 on a line', [st1.kind, st1.ids, st1.released, st1.releases.length, st1.releases[0].qty], ['WO', ['WO-A', 'WO-A-C'], 20, 1, 20]);
const st2 = releaseStampOf({ cur: st1, kind: 'WO', ids: ['WO-B'], qty: 20, run: { no: 2, from: 10, to: 20, of: 35 }, at: 6, by: 'u' });
eq('release 2 joins it: 40 released, every document listed', [st2.released, st2.ids, st2.releases.map(r => r.qty), st2.rowKey, st2.finish], [40, ['WO-A', 'WO-A-C', 'WO-B'], [20, 20], 'ROW_1', 'P06']);
const stSplit = releaseStampOf({ cur: st1, kind: 'WO', ids: ['WO-A2'], qty: 5, run: { no: 1, from: 0, to: 10, of: 35 }, at: 6 });
eq('a second document of the SAME run (a start-now split) joins that run', [stSplit.releases.length, stSplit.releases[0].qty, stSplit.releases[0].ids], [1, 25, ['WO-A', 'WO-A-C', 'WO-A2']]);
const shelf1 = releaseStampOf({ cur: null, kind: 'STOCK', code: 'H1-1BF/EP2', qty: 10, run: { no: 1, from: 0, to: 10, of: 35 }, at: 5 });
eq('a shelf release: the stamp reads STOCK and names its code', [shelf1.kind, shelf1.code, shelf1.released], ['STOCK', 'H1-1BF/EP2', 10]);
const mixed = releaseStampOf({ cur: shelf1, kind: 'WO', ids: ['WO-C'], qty: 10, run: { no: 2, from: 10, to: 20, of: 35 }, at: 6 });
eq('shelf for one release, a floor for the next: the stamp reads WO, the releases say which', [mixed.kind, releasedByKindOf(mixed, 35)], ['WO', { shelf: 10, floor: 10, total: 20 }]);
eq('a stamp written for the whole line is the whole line', [releasedByKindOf({ kind: 'WO', ids: ['W'] }, 70), releasedByKindOf({ kind: 'STOCK' }, 35)], [{ shelf: 0, floor: 70, total: 70 }, { shelf: 35, floor: 0, total: 35 }]);
eq('the latest run taken back off', [stampWithoutRunOf(st2, 2).released, stampWithoutRunOf(st2, 2).ids, stampWithoutRunOf(st1, 1)], [20, ['WO-A', 'WO-A-C'], null]);
eq('…and a shelf stamp is a shelf stamp again', stampWithoutRunOf(mixed, 2).kind, 'STOCK');

// ── the plan a release is confirmed against ──
const plan = rowReleasePlanOf({ so: base, rowKey: 'ROW_1', target: 10, of: 35 });
eq('Row 1 to 10 of 35: every piece line at its quantity, no kit line', [plan.ok, plan.lines.map(l => [l.lineIdx, l.now])], [true, [[0, 20], [1, 10], [2, 10]]]);
eq('…a line that cannot divide is named and the release refused', rowReleasePlanOf({ so: odd, rowKey: 'ROW_1', target: 10, of: 35 }), { ok: false, why: ['X: 54 does not divide into 35 displays'], lines: [] });
eq('…the next 10: the made line is due 20 more; `prev` is what the count called for before', rowReleasePlanOf({ so: { ...so10, oeGen: { 0: st1 } }, rowKey: 'ROW_1', target: 20, of: 35 }).lines.map(l => [l.lineIdx, l.released, l.now, l.prev]), [[0, 20, 20, 20], [1, 0, 20, 10], [2, 0, 20, 10]]);
ok('the confirm names the release and what is left', /Start Row 1 for 10 of 35 — displays 11–20\?/.test(rowReleaseText({ label: 'Row 1', from: 10, to: 20, of: 35, lines: [{ erp: 'H1-138CC', finish: 'P06', qty: 70, released: 20, now: 20 }] })) && /15 display\(s\) of this row stay unreleased/.test(rowReleaseText({ label: 'Row 1', from: 10, to: 20, of: 35, lines: [] })));

// ── THE WMS: what is released, not the whole order ───────────────────────────────────────────────────────────────────
// Row 1 released for 10: the connector on a floor document (20), the finial found on the shelf (10), the standoff follows
// the row (10). Row 2 released for 25: the pole on a floor document. Row 3 for 7. The base (ORDER) for 7.
const live = {
    ...base,
    rowRelease: { ROW_1: { boards: 10, of: 35, log: [{ no: 1, from: 0, to: 10 }] }, ROW_2: { boards: 25, of: 35, log: [{ no: 1, from: 0, to: 25 }] }, ROW_3: { boards: 7, of: 35, log: [{ no: 1, from: 0, to: 7 }] }, ORDER: { boards: 7, of: 35, log: [{ no: 1, from: 0, to: 7 }] } },
    oeGen: {
        0: releaseStampOf({ kind: 'WO', ids: ['WO-OE-SO70001-0001'], qty: 20, run: { no: 1, from: 0, to: 10, of: 35 } }),
        2: releaseStampOf({ kind: 'STOCK', code: 'H1-1BF/EP2', qty: 10, run: { no: 1, from: 0, to: 10, of: 35 } }),
        3: releaseStampOf({ kind: 'WO', ids: ['WO-OE-SO70001-0002', 'WO-OE-SO70001-0002-C'], qty: 25, run: { no: 1, from: 0, to: 25, of: 35 } }),
        4: releaseStampOf({ kind: 'WO', ids: ['WO-OE-SO70001-0002', 'WO-OE-SO70001-0002-C'], qty: 50, run: { no: 1, from: 0, to: 25, of: 35 }, rider: true }),
    },
    committedBin: 'ORDERS-COM2', committedQty: {},
};
eq('released per line: made on a floor · stocked follows its row · plated from the shelf · the pole · the fee carries none', [0, 1, 2, 3, 4, 5, 6, 7].map(i => soLineReleasedOf(live, lines[i], i).total), [20, 10, 10, 25, 0, 7, 7, 0]);
eq('…and where from', [soLineReleasedOf(live, lines[0], 0), soLineReleasedOf(live, lines[1], 1), soLineReleasedOf(live, lines[2], 2)], [{ shelf: 0, floor: 20, total: 20 }, { shelf: 10, floor: 0, total: 10 }, { shelf: 10, floor: 0, total: 10 }]);
eq('the bin\'s need NOW is what is released; the order\'s whole need is untouched', [soCodeReleasedNeedOf(live, 'H1-138CC/P06'), soCodeNeedOf(live, 'H1-138CC/P06'), soCodeReleasedNeedOf(live, 'H1-1STDOFF'), soCodeNeedOf(live, 'H1-1STDOFF')], [20, 70, 10, 35]);
eq('an order released whole: its need is its need', soCodeReleasedNeedOf({ ...live, releaseByCount: false }, 'H1-1STDOFF'), 35);
eq('to pick from the shelf: the released share, nothing for a floor item', [soShelfToPickOf(live, 'H1-1STDOFF'), soShelfToPickOf(live, 'H1-1BF/EP2'), soShelfToPickOf(live, 'H1-138CC/P06'), soShelfToPickOf(live, 'H1-75SBKT')], [10, 10, 0, 7]);
eq('…less what has already reached the bin, or shipped', [soShelfToPickOf({ ...live, committedQty: { 'H1-1STDOFF': 4 } }, 'H1-1STDOFF'), soShelfToPickOf({ ...live, committedQty: { 'H1-1STDOFF': 4 }, shippedQty: { 'H1-1STDOFF': 5 } }, 'H1-1STDOFF')], [6, 1]);
const stats = { 'H1-1STDOFF': { avail: 200 }, 'H1-1BF/EP2': { avail: 40 }, 'H1-75SBKT': { avail: 3 }, 'H1-WB1': { avail: 50 } };
const statOf = (c) => stats[c] || null;
const stage = soGatherStageOf({ so: live, statOf });
eq('floor documents out, one shelf item short → WAITING; the shelf that covers its release is offered', [stage.stage, stage.waiting.sort(), stage.toPick.sort(), stage.partial, stage.anyReleased], ['WAITING', ['H1-138CC/P06', 'H1-75SBKT', 'H1-75SR/P06'], ['H1-1BF/EP2', 'H1-1STDOFF', 'H1-WB1'], true, true]);
eq('nothing released at all → WAITING, and says nothing is in motion', (({ stage: s, anyReleased }) => [s, anyReleased])(soGatherStageOf({ so: { ...base, committedQty: {} }, statOf })), ['WAITING', false]);
const pickPlan = shelfPickPlanOf({ so: live, binsOf: (c) => [{ bin: 'A1', qty: stats[c] ? stats[c].avail : 0 }], toBin: 'ORDERS-COM2' });
eq('the shelf picks: each item for what is RELEASED of it (10, 10, 7, 7) — the short one says so', pickPlan.map(p => [p.code, p.qty, p.ok]), [['H1-1STDOFF', 10, true], ['H1-1BF/EP2', 10, true], ['H1-75SBKT', 7, false], ['H1-WB1', 7, true]]);
eq('a line state: released 10 of 35, shelf covers it → READY', (({ state, ordered, need, released }) => [state, ordered, need, released])(soPackLineStateOf({ so: live, line: lines[1], idx: 1, stat: stats['H1-1STDOFF'] })), ['READY', 35, 10, 10]);
eq('…a made line whose release is out: FROM THE FLOOR against 20, not 70', (({ state, need }) => [state, need])(soPackLineStateOf({ so: live, line: lines[0], idx: 0 })), ['FROM THE FLOOR', 20]);
eq('…a row not released reads NOT RELEASED, never short', soPackLineStateOf({ so: { ...live, rowRelease: { ...live.rowRelease, ROW_3: undefined } }, line: lines[5], idx: 5, stat: { avail: 0 } }).state, 'NOT RELEASED');

// the gather: a release's document brings what IT carries
const finDoc = { id: 'WO-OE-SO70001-0001', soLineIdxs: [0], soLineQty: { 0: 20 }, partsList: [] };
eq('the pair of release 1 gathers its 20 connectors — not the line\'s 70', gatherPlanOf({ job: finDoc, order: live }).map(w => [w.code, w.qty, w.add]), [['H1-138CC/P06', 20, 20]]);
eq('a document that says nothing of its own quantity gathers its line, as before', gatherPlanOf({ job: { id: 'W', soLineIdxs: [0] }, order: live }).map(w => [w.qty, w.add]), [[70, 70]]);

// everything released is in the bin
const inBin = { ...live, committedQty: { 'H1-138CC/P06': 20, 'H1-1STDOFF': 10, 'H1-1BF/EP2': 10, 'H1-75SR/P06': 25, 'H1-75SBKT': 7, 'H1-WB1': 7 } };
eq('every released piece in the bin → PACK (with more of the order still to release)', (({ stage: s, partial, toPick, waiting }) => [s, partial, toPick, waiting])(soGatherStageOf({ so: inBin, statOf })), ['PACK', true, [], []]);
eq('each line holds what is released of it', [0, 1, 2, 3, 5, 6].map(i => lineBinShareOf(inBin, i)), [20, 10, 10, 25, 7, 7]);
eq('nothing left to pick', shelfPickPlanOf({ so: inBin, binsOf: () => [{ bin: 'A1', qty: 999 }], toBin: 'ORDERS-COM2' }), []);
// "10 of row 1, 25 of row 2, 7 of row 3 → the maximum that could be shipped would be 7"
eq('10 of row 1, 25 of row 2, 7 of row 3 → 7 displays can ship', shippableDisplaysOf({ so: inBin, boards: 35 }), 7);
eq('…one display\'s pieces are there to ship', displayShareOf({ so: inBin, boards: 35 }).ok, true);
eq('…with a row not in the bin at all, none can', shippableDisplaysOf({ so: { ...inBin, committedQty: { ...inBin.committedQty, 'H1-75SBKT': 0 } }, boards: 35 }), 0);
// after 7 displays shipped the bin holds the rest and nothing is re-offered
const shipped7 = { ...inBin, displayShipments: [1, 2, 3, 4, 5, 6, 7], shippedQty: { 'H1-138CC/P06': 14, 'H1-1STDOFF': 7, 'H1-1BF/EP2': 7, 'H1-75SR/P06': 7, 'H1-75SBKT': 7, 'H1-WB1': 7 }, committedQty: { 'H1-138CC/P06': 6, 'H1-1STDOFF': 3, 'H1-1BF/EP2': 3, 'H1-75SR/P06': 18, 'H1-75SBKT': 0, 'H1-WB1': 0 } };
eq('after 7 ship: no more can (row 3 and the base are spent), nothing is re-picked', [shippableDisplaysOf({ so: shipped7, boards: 35 }), shelfPickPlanOf({ so: shipped7, binsOf: () => [{ bin: 'A1', qty: 999 }], toBin: 'ORDERS-COM2' }), soGatherStageOf({ so: shipped7, statOf }).stage], [0, [], 'PACK']);
// row 3 released for 10 more → 3 more of it to pick, the rest untouched
const more = { ...shipped7, rowRelease: { ...shipped7.rowRelease, ROW_3: { boards: 17, of: 35 }, ORDER: { boards: 17, of: 35 } } };
eq('row 3 and the base released for 10 more → exactly 10 more of each to pick', shelfPickPlanOf({ so: more, binsOf: () => [{ bin: 'A1', qty: 999 }], toBin: 'ORDERS-COM2' }).map(p => [p.code, p.qty]), [['H1-75SBKT', 10], ['H1-WB1', 10]]);
// the bin in NetSuite follows what is gathered (the pole in feet)
eq('the bin in NetSuite: gathered pieces as their items — a rod in feet', nsBinPlanOf({ so: inBin }).map(r => [r.code, r.want]).find(r => r[0] === 'H1-75SR'), ['H1-75SR', 50]);

// a stock colour: the shelf for release 1, painted for release 2 — the shelf share is counted by the pick
const sc = { ...base, lines: [{ erp: 'H1-2TRVBP/C', qty: 35, row: 'Row 1', stockColour: true }], rowRelease: { ROW_1: { boards: 20, of: 35 } }, oeGen: { 0: mixed }, committedQty: {} };
eq('shelf 10 + floor 10 released: 10 to pick', soShelfToPickOf(sc, 'H1-2TRVBP/C'), 10);
eq('…the painted 10 arrive first: still 10 to pick', soShelfToPickOf({ ...sc, committedQty: { 'H1-2TRVBP/C': 10 } }, 'H1-2TRVBP/C'), 10);
eq('…the shelf 10 picked first (counted): nothing more to pick, the floor\'s 10 still awaited', [soShelfToPickOf({ ...sc, committedQty: { 'H1-2TRVBP/C': 10 }, shelfPicked: { 'H1-2TRVBP/C': 10 } }, 'H1-2TRVBP/C'), soGatherStageOf({ so: { ...sc, committedQty: { 'H1-2TRVBP/C': 10 }, shelfPicked: { 'H1-2TRVBP/C': 10 } }, statOf: () => ({ avail: 99 }) }).waiting], [0, ['H1-2TRVBP/C']]);
ok('a line with a floor release reads from the floor (the pick is offered by the item)', !soLineIsShelfPick(sc, sc.lines[0], 0));

// ── 10.5: the line and the row ──────────────────────────────────────────────────────────────────────────────────────
const links = { wos: [{ id: 'WO-OE-SO70001-0001', status: 'Dispatched' }, { id: 'WO-OE-SO70001-0002', status: 'Approved' }], pos: [], demands: [] };
const s0 = lineStateOf({ so: live, line: lines[0], lineIdx: 0, links });
eq('a released line: its count and where its release is', [s0.key, s0.releasedQty, s0.dueQty, /^20 of 70 released — 20 \(displays 1–10 of 35\): WO-OE-SO70001-0001 — on the floor$/.test(s0.text)], [LINE_STATE.FLOOR, 20, 0, true]);
const s1 = lineStateOf({ so: live, line: lines[1], lineIdx: 1, links });
eq('a stocked line follows its row', [s1.key, s1.text], [LINE_STATE.STOCKED, 'stocked — 10 of 35 released to the pick at SO Pack']);
const up20 = { ...live, rowRelease: { ...live.rowRelease, ROW_1: { boards: 20, of: 35, log: [{ no: 1, from: 0, to: 10 }, { no: 2, from: 10, to: 20 }] } } };
const s0b = lineStateOf({ so: up20, line: lines[0], lineIdx: 0, links });
eq('the count raised and the line not yet raised for it: still to start, and says how much', [s0b.key, s0b.dueQty, /20 more due for the displays released \(not started\)/.test(s0b.text)], [LINE_STATE.NONE, 20, true]);
const rowLive = rowStateOf({ entries: [0, 1, 2].map(i => ({ so: live, line: lines[i], lineIdx: i, links })) });
eq('the row: on the floor, nothing open at this count', [rowLive.key, rowLive.open], ['ON_FLOOR', 0]);
eq('…and open again once the count is raised', rowStateOf({ entries: [0, 1, 2].map(i => ({ so: up20, line: lines[i], lineIdx: i, links })) }).open, 2);
eq('the row\'s count across its orders', rowReleaseCountOf({ orders: [live], rowKey: 'ROW_1', of: 35 }), { byCount: true, released: 10, of: 35, left: 25 });
eq('…an order released whole has no count', rowReleaseCountOf({ orders: [{ ...live, releaseByCount: false }], rowKey: 'ROW_1', of: 35 }), { byCount: false, released: 0, of: 0, left: 0 });
// an order from before: every reading it had
const old = { ...live, releaseByCount: undefined, rowRelease: undefined, oeGen: { 0: { kind: 'WO', ids: ['WO-OE-SO70001-0001'] } } };
eq('an order released whole: the line reads as it always did', lineStateOf({ so: old, line: lines[0], lineIdx: 0, links }).text, 'WO-OE-SO70001-0001 — on the floor');
eq('…and its stocked line too', lineStateOf({ so: old, line: lines[1], lineIdx: 1, links }).text, 'stocked — picked by the warehouse, not started here');

// ── the pair of a release says which displays, and what it carries ──────────────────────────────────────────────────
const part = { id: 'p1', itemId: 'H1-138CC', legacyErpId: 'H1-138CC', itemName: 'Connector', manufacturingSpecs: { productType: 'Bracket' } };
const group = { key: 'ROW_1|P06|', rowKey: 'ROW_1', rowLabel: 'Row 1', finish: 'P06', tag: '', release: { no: 2, from: 10, to: 20, of: 35 }, jobs: [{ so: live, line: { ...lines[0], qty: 20 }, lineIdx: 0, part, finish: 'P06', qty: 20, __planLines: [{ legacyErpId: 'H1-138CC/P', quantity: 20 }] }] };
const shape = pairShapeOf({ group, so: live, brand: 'ce', woId: 'WO-OE-SO70001-0003', shopWoId: 'WO-OE-SO70001-0003-C', inventory: [part] });
eq('the pair is named for its release and carries the line\'s 20', [shape.hq.itemName, shape.hq.releaseLabel, shape.hq.soLineQty, shape.finPayload.soLineQty, shape.finPayload.releaseTo, shape.hq.qty], ['Row 1 · P06 · displays 11–20 of 35 · 1 small-part line', 'displays 11–20 of 35', { 0: 20 }, { 0: 20 }, 20, 20]);
const whole = pairShapeOf({ group: { ...group, release: null }, so: live, brand: 'ce', woId: 'W', shopWoId: 'W-C', inventory: [part] });
eq('a whole-row pair carries no release fields and its old name', [whole.hq.itemName, 'soLineQty' in whole.hq, 'releaseLabel' in whole.finPayload], ['Row 1 · P06 · 1 small-part line', false, false]);

// ── THE WALL, 2026-10-06: released whole on 10-01/02, switched onto counts, then restarted row by row ───────────────
// Row 1's connector and plated finial were started whole; Row 2's pole too; Row 3 and the base were never started.
const wall = { ...base, releaseByCount: undefined, releaseOf: undefined, oeGen: { 0: { kind: 'WO', ids: ['WO-OE-SO70001-0001'], rowKey: 'ROW_1', finish: 'P06' }, 2: { kind: 'STOCK', code: 'H1-1BF/EP2', qty: 35 }, 3: { kind: 'WO', ids: ['WO-OE-SO70001-0002', 'WO-OE-SO70001-0002-C'] }, 4: { kind: 'WO', ids: ['WO-OE-SO70001-0002', 'WO-OE-SO70001-0002-C'], rider: true } }, backorderLines: [{ code: 'H1-1BF/EP2', qty: 35, source: 'OE_ROW', lineIndex: 2 }, { code: 'ZZ', qty: 1, source: 'SPLIT', lineIndex: 9 }], displayRows: { ROW_1: { state: 'DONE' } } };
ok('a stamp from before release counts is a whole-line stamp', isWholeStamp(wall.oeGen[0]) && !isWholeStamp(st1) && !isWholeStamp(null));
const sw = countSwitchOf({ so: wall, of: 35, by: 'stuart', now: 9 });
eq('the switch: by count of 35, and every STARTED row reads fully released', [sw.patch.releaseByCount, sw.patch.releaseOf, sw.rows.sort(), sw.patch.rowRelease.ROW_1, Object.keys(sw.patch.rowRelease).sort()], [true, 35, ['ROW_1', 'ROW_2'], { boards: 35, of: 35, at: 9, by: 'stuart', whole: true, log: [{ no: 1, from: 0, to: 35, at: 9, by: 'stuart', whole: true }] }, ['ROW_1', 'ROW_2']]);
eq('an order already on counts, or a build with no display count, is not switched', [countSwitchOf({ so: live, of: 35 }), countSwitchOf({ so: wall, of: 0 })], [null, null]);
ok('the switch says what stays and that it cannot be undone', /Release SO70001 by count\?/.test(countSwitchText({ orders: ['SO70001'], of: 35, rows: ['Row 1', 'Row 2'] })) && /read 35 of 35 released:\n  • Row 1\n  • Row 2/.test(countSwitchText({ orders: ['SO70001'], of: 35, rows: ['Row 1', 'Row 2'] })) && /cannot be switched back/.test(countSwitchText({ orders: ['X'], of: 35, rows: [] })));
const sw1 = { ...wall, ...sw.patch };
// after the switch: nothing on the floor changes — the started rows read whole, the others 0
eq('after the switch a started row is 35 of 35 with nothing more due; a row never started is 0 of 35', [rowReleaseCountOf({ orders: [sw1], rowKey: 'ROW_1', of: 35 }), lineDueOf(sw1, lines[0], 0).qty, rowReleaseCountOf({ orders: [sw1], rowKey: 'ROW_3', of: 35 }).released], [{ byCount: true, released: 35, of: 35, left: 0 }, 0, 0]);
eq('…its made line still reads off its own document, its stocked line follows the row (35), the unstarted row offers nothing', [lineStateOf({ so: sw1, line: lines[0], lineIdx: 0, links }).text, soLineReleasedOf(sw1, lines[1], 1).total, soLineReleasedOf(sw1, lines[2], 2), soLineReleasedOf(sw1, lines[5], 5).total], ['WO-OE-SO70001-0001 — on the floor', 35, { shelf: 35, floor: 0, total: 35 }, 0]);
eq('…a whole-row document still gathers its whole line', gatherPlanOf({ job: { id: 'WO-OE-SO70001-0001', soLineIdxs: [0] }, order: sw1 }).map(w => [w.qty, w.add]), [[70, 70]]);
// restart Row 1
const rp = rowRestartPlanOf({ so: sw1, rowKey: 'ROW_1' });
eq('restart Row 1: its lines, the ones with a record, and exactly the documents they name', [rp.idxs, rp.hit, rp.ids], [[0, 1, 2, 7], [0, 2], ['WO-OE-SO70001-0001']]);
eq('…the row\'s records and count are gone, Row 2\'s untouched', [Object.keys(rp.after.oeGen).sort(), Object.keys(rp.after.rowRelease), rp.gathered], [['3', '4'], ['ROW_2'], []]);
eq('…its own shortfall record goes, another writer\'s stays', [rp.boChanged, rp.backorderLines.map(r => r.code)], [true, ['ZZ']]);
eq('…and the row then reads 0 of 35, every line due nothing until it is started', [rowReleaseCountOf({ orders: [rp.after], rowKey: 'ROW_1', of: 35 }).released, lineDueOf(rp.after, lines[0], 0).qty, soLineReleasedOf(rp.after, lines[1], 1).total], [0, 0, 0]);
// the closed documents of the restarted row still exist and still carry its item — they must not read as work
const closedLinks = { wos: [{ id: 'WO-OE-SO70001-0001', status: 'Closed', closedFrom: '10.5', rootItem: 'H1-138CC', recipe: 'P06' }], pos: [], demands: [] };
eq('a restarted row\'s closed document does not make its line read done', lineStateOf({ so: rp.after, line: lines[0], lineIdx: 0, links: closedLinks }).key, LINE_STATE.NONE);
eq('…while on an order released whole the old lookup is unchanged', lineStateOf({ so: { ...wall, oeGen: {} }, line: lines[0], lineIdx: 0, links: closedLinks }).key, LINE_STATE.DONE);
eq('a row with pieces already in the order\'s bin is refused, and says which', rowRestartPlanOf({ so: { ...sw1, committedQty: { 'H1-1STDOFF': 5 } }, rowKey: 'ROW_1' }).gathered, ['H1-1STDOFF: 5 in the order\'s bin or shipped — only 0 would stay released; release them at SO Pack first']);
ok('the restart says what closes and to tell the floor', /Restart Row 1 — close its documents and put it back to 0 of 35\?/.test(rowRestartText({ label: 'Row 1', of: 35, docs: [{ kind: 'floor', id: 'WO-A', text: 'Setup · 280 pcs' }], stock: 1 })) && /floor WO-A — Setup · 280 pcs/.test(rowRestartText({ label: 'Row 1', of: 35, docs: [{ kind: 'floor', id: 'WO-A', text: 'Setup · 280 pcs' }] })) && /Tell the floor BEFORE/.test(rowRestartText({ label: 'Row 1', of: 35 })));
// then Row 1 for 2 of 35
const two = { ...rp.after, rowRelease: { ...rp.after.rowRelease, ROW_1: nextRowReleaseOf({ so: rp.after, rowKey: 'ROW_1', add: 2, of: 35 }) } };
eq('Row 1 started again for 2: 4 connectors, 2 standoffs, 2 finials due — Row 2 still whole', [lineDueOf(two, lines[0], 0).qty, soLineReleasedOf(two, lines[1], 1).total, lineDueOf(two, lines[2], 2).qty, lineDueOf(two, lines[3], 3).qty], [4, 2, 2, 0]);

console.log(`rowRelease: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
