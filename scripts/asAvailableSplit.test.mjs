// node scripts/asAvailableSplit.test.mjs — "Finish as available" flipped on an order whose work is already parked
// (Stuart 2026-10-12: "No, let's fix it for real"). The record below is WO-OE-SO60812-5757 as it stood in production:
// Read Window, RF1 — 100 end caps (line 1), 200 brackets whose two arms were at the mill (line 2), 100 twelve-foot rods
// under the HRW-138TRAV12 kit (line 4; line 3 is the kit, sold, never made).
import { isParkedPair, openGateCodesOf, parkedSplitOf, pairWithoutLinesOf, splitSentence } from '../src/components/Shared/asAvailableSplit.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const partsList = [
    { legacyErpId: 'H2-138-TB3/P', quantity: 200, pcs: 200, soLineIdx: 1, lineNo: 2, productType: 'BRACKET', paintSize: 'S', material: 'METAL' },
    { legacyErpId: 'H2-138-TB4/P', quantity: 200, pcs: 200, soLineIdx: 1, lineNo: 2, productType: 'BRACKET', paintSize: 'S', material: 'METAL' },
    { legacyErpId: 'H1-138TRV', quantity: 1200, pcs: 1200, soLineIdx: 3, lineNo: 4, productType: 'POLE', material: 'METAL' },
];
const record = {
    id: 'WO-OE-SO60812-5757', status: 'Approved', source: 'ORDER_ENTRY', routeTo: 'FINISHING', soAppId: 'QS-1790791318893', soId: 'SO60812',
    finishGroup: 'RF1', recipe: 'RF1', soLineIdxs: [0, 1, 3], qty: 1600, totalParts: 1600, lineCount: 4, lineNos: [2, 4],
    awaitingConvert: true, awaitingComponents: true,
    convertDemandIds: ['CVD-1', 'CVD-3'], componentShopWoIds: ['WO-CMP-H2-138-TB3-647633-2', 'WO-CMP-H2-138-TB4-649140-4'],
    partsList,
    materialRows: [{ code: 'H2-138-TB3/P', need: 200 }, { code: 'H2-138-TB4/P', need: 200 }, { code: 'H1-138TRV', need: 1200 }],
    finPayload: { id: 'WO-OE-SO60812-5757', recipe: 'RF1', partsList, soLineIdxs: [0, 1, 3], totalParts: 1600, poles: { qty: 1200, type: 'POLE' }, totalPoles: 1200, poleStepIndex: 0, paintSize: 'S', paintSizes: { S: 400, M: 0, L: 0 }, currentPhase: 'Setup', note: 'Order Entry SO60812' },
};
const demands = [{ id: 'CVD-1', status: 'open', targetErpId: 'H2-138-TB3/P', baseErpId: 'H2-138-TB3' }, { id: 'CVD-3', status: 'open', targetErpId: 'H2-138-TB4/P', baseErpId: 'H2-138-TB4' }];
const componentWos = [{ id: 'WO-CMP-H2-138-TB3-647633-2', status: 'Dispatched', partErpId: 'H2-138-TB3' }, { id: 'WO-CMP-H2-138-TB4-649140-4', status: 'Dispatched', partErpId: 'H2-138-TB4' }];
const lines = [{ erp: 'HTAEC35' }, { erp: 'HRW-138TRAVLB' }, { erp: 'HRW-138TRAV12', isKit: true }, { erp: 'H1-138TRV' }];

ok('a parked pair: Order Entry, finishing side, approved, never released', isParkedPair(record));
eq('…not its shop half, not one already on the floor, not a closed or deleted one, not a CPQ document',
    [isParkedPair({ ...record, id: 'WO-OE-SO60812-5757-C' }), isParkedPair({ ...record, pushedToFinishing: true }), isParkedPair({ ...record, status: 'Dispatched' }), isParkedPair({ ...record, deleted: true }), isParkedPair({ ...record, id: 'WO-SO60427', source: 'CPQ' })],
    [false, false, false, false, false]);

const gate = openGateCodesOf({ record, demands, componentWos });
eq('the open gates name the two arms — as the /P the convert makes and the raw the mill makes', [[...gate.codes].sort(), gate.open], [['H2-138-TB3', 'H2-138-TB3/P', 'H2-138-TB4', 'H2-138-TB4/P'], ['convert', 'components']]);
eq('a convert that is done and a milling order the floor finished name nothing',
    [...openGateCodesOf({ record, demands: demands.map(d => ({ ...d, status: 'DONE' })), componentWos: componentWos.map(w => ({ ...w, floorPhase: 'Complete' })) }).codes], []);
eq('a receipt gate names what has not arrived; a rod cut its rod', [
    [...openGateCodesOf({ record: { awaitingReceipt: true, receiptRefs: [{ itemId: 'H1-75R', qtyNeeded: 50, receivedSoFar: 0 }, { itemId: 'H1-1R', qtyNeeded: 5, receivedSoFar: 5 }] } }).codes],
    [...openGateCodesOf({ record: { awaitingRodCut: true }, rodCuts: [{ status: 'OPEN', targetItemId: 'HTA635', sourceItemId: 'HTA835' }] }).codes].sort(),
], [['H1-75R'], ['HTA635', 'HTA835']]);

const split = parkedSplitOf({ record, gate });
eq('SO60812: the bracket waits (its arms are at the mill); the end caps and the rods are ready', split, { ready: [0, 3], waiting: [1], why: '' });
eq('a pair with one line, a pair with a shop job, a pair waiting on nothing: left whole, and why', [
    parkedSplitOf({ record: { ...record, soLineIdxs: [1] }, gate }).why,
    parkedSplitOf({ record: { ...record, hasCustomSibling: true }, gate }).why,
    parkedSplitOf({ record, gate: { codes: new Set(), open: [] } }).why,
], ['it carries one line', 'it has a shop job — a pole and what rides it stay with their work order', 'it is not waiting on anything — it releases as it is']);
eq('an open gate that names none of the pair\'s lines: nothing is guessed', [parkedSplitOf({ record, gate: { codes: new Set(['SOMETHING-ELSE']), open: ['receipt'] } }).ready, /names none of its lines/.test(parkedSplitOf({ record, gate: { codes: new Set(['SOMETHING-ELSE']), open: ['receipt'] } }).why)], [[], true]);
eq('every line waiting: nothing to move', parkedSplitOf({ record: { ...record, soLineIdxs: [1, 3] }, gate: { codes: new Set(['H2-138-TB3/P', 'H1-138TRV']), open: ['convert'] } }).why, 'every line of it is waiting');

const after = pairWithoutLinesOf({ record, moved: split.ready, lineCount: 4, now: 9 });
const p = after.patch;
eq('what stays on 5757: the bracket\'s two arms, 400 pieces, line 2 only', [p.partsList.map(x => x.legacyErpId), p.soLineIdxs, p.totalParts, p.qty, p.lineNos, p.lineCount], [['H2-138-TB3/P', 'H2-138-TB4/P'], [1], 400, 400, [2], 4]);
eq('…named for what it now holds', p.itemName, 'Order SO60812 · RF1 · 1 small-part line');
eq('…its finishing payload rebuilt: no pole track left behind, the sled sizes of what is left', [p.finPayload.poles, p.finPayload.totalPoles, p.finPayload.poleStepIndex, p.finPayload.paintSize, p.finPayload.paintSizes, p.finPayload.totalParts, p.finPayload.partsList.length, p.finPayload.soLineIdxs],
    [undefined, undefined, undefined, 'S', { S: 400, M: 0, L: 0 }, 400, 2, [1]]);
eq('…its facts by material and its material rows follow', [p.partsByMaterial, p.materialRows.map(r => r.code), p.finPayload.partsByMaterial], [[{ material: 'METAL', rods: 0, small: 400 }], ['H2-138-TB3/P', 'H2-138-TB4/P'], [{ material: 'METAL', rods: 0, small: 400 }]]);
eq('…and everything it did not have to change is untouched: its phase, its note, its id', [p.finPayload.currentPhase, p.finPayload.note, p.finPayload.id, p.finPayload.recipe], ['Setup', 'Order Entry SO60812', 'WO-OE-SO60812-5757', 'RF1']);
ok('the gates and their links are not in the patch — they stay as they are', !('awaitingConvert' in p) && !('convertDemandIds' in p) && !('componentShopWoIds' in p) && !('status' in p));
eq('the move is recorded on the pair', [p.asAvailableSplitAt, p.asAvailableMovedLines], [9, [0, 3]]);
eq('moving everything is refused', pairWithoutLinesOf({ record, moved: [0, 1, 3] }).refuse, 'nothing would be left on it');
eq('in words', splitSentence({ ref: 'WO-OE-SO60812-5757', ready: split.ready, waiting: split.waiting, lines }),
    'WO-OE-SO60812-5757: line 1 (HTAEC35), line 4 (H1-138TRV) are ready and start as their own work order; line 2 (HRW-138TRAVLB) stays on WO-OE-SO60812-5757 until its gates clear');

console.log(`asAvailableSplit: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
