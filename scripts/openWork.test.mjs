// What is still open, and what keeps the list honest — offline.
//   node scripts/openWork.test.mjs
// Stuart 2026-10-13: "the open work orders screen has 120 open work orders which seems out of sync with real world. how
// do we make sure it all stays aligned and current" — "go, 14 days is fine". The rows are shaped like the ones read in
// production that day. If a row here breaks, the change is wrong — unless Stuart changed the rule.
import { openWorkOf, openGroupCounts, outOfStepOf, noMovementOf, nsDoneWord, nsIdsOfRows, nsStatusSql, nsStatusOf, stillRealTargetOf, stillRealStamp, openWorkText, OPEN_GROUP, NO_MOVEMENT_DAYS, msOf } from '../src/components/Shared/openWork.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const DAY = 86400000, now = 1000 * DAY;
const ago = (d) => now - d * DAY;

const sos = [
    { id: 'APP-551', soId: 'SO60551', nsInternalId: '936808', displayRelease: { rows: 9 } },
    { id: 'QS-932', soId: 'SO60932', nsInternalId: '950932' },
    { id: 'QS-156', soId: 'SO60156', nsInternalId: '903197', status: 'Closed' },
];
const hq = [
    // a stock build on the floor
    { id: 'WO-STK-1', status: 'Dispatched', brand: 'ce', orderType: 'stock', nsWoId: '953078', nsWoTran: 'WO11722', createdAt: ago(3), dispatchedAt: ago(3) },
    // shop-only work orders: one whose shop job is Completed (and NetSuite Built), one at the plater, one pending
    { id: 'WO-MILL-1', status: 'Dispatched', brand: 'ce', routeTo: 'SHOP', nsWoId: '900575', nsWoTran: 'WO11575', createdAt: ago(43), dispatchedAt: ago(43) },
    { id: 'WO-MILL-2', status: 'Dispatched', brand: 'ce', routeTo: 'SHOP', createdAt: ago(20), dispatchedAt: ago(20) },
    { id: 'WO-MILL-3', status: 'Dispatched', brand: 'ce', routeTo: 'SHOP', nsWoId: '951690', nsWoTran: 'WO11690', createdAt: ago(2), dispatchedAt: ago(2) },
    // parked, never released — one old M2C record
    { id: 'WO-JTREE-1', status: 'Approved', brand: 'm2c', type: 'JTREEWD-X3/SM01', qty: 4, createdAt: ago(56) },
    // dispatched with nothing on any floor
    { id: 'WO-LOST', status: 'Dispatched', brand: 'ce', createdAt: ago(9), dispatchedAt: ago(9) },
    // closed and deleted records are never open
    { id: 'WO-CLOSED', status: 'Closed', brand: 'ce', createdAt: ago(5) }, { id: 'WO-DEL', status: 'Dispatched', deleted: true, createdAt: ago(5) },
    // the record of a packed finishing document
    { id: 'WO-PACKED', status: 'Dispatched', brand: 'ce', createdAt: ago(8) },
    // a record whose finishing document has another id (finPayload)
    { id: 'REC-9', status: 'Dispatched', brand: 'ce', finPayload: { id: 'FIN-9' }, createdAt: ago(18) },
];
const fin = [
    { id: 'WO-STK-1', brand: 'ce', orderType: 'stock', stockErpId: 'HTA635/SG', totalParts: 10, currentPhase: 'Setup', nsWoId: '953078', nsWoTran: 'WO11722', createdAt: ago(3), pickedAt: ago(1), tasks: {} },
    { id: 'WO-PACKED', brand: 'ce', currentPhase: 'Complete', packStatus: 'Packed', createdAt: ago(8) },
    // a paint run nobody has touched for eighteen days
    { id: 'FIN-9', brand: 'ce', orderType: 'stock', stockErpId: 'HCUBEA1/BS', totalParts: 50, currentPhase: 'Setup', createdAt: ago(18), dispatchedAt: ago(18), materialRefreshedAt: ago(0), updatedAt: ago(0), tasks: { spinSetup: { status: 'Pending' } } },
    // a display row, finished and in the order bin
    { id: 'WO-OE-SO60551-ROW-2', brand: 'ce', orderType: 'sales', salesOrderId: 'APP-551', totalParts: 12, currentPhase: 'Complete', completedAt: ago(20), createdAt: ago(25), tasks: {} },
    // an ordinary sales document finished, not packed — NetSuite has billed its order
    { id: 'WO-SO60932', brand: 'ce', orderType: 'sales', salesOrderId: 'SO60932', totalParts: 6, currentPhase: 'Complete', completedAt: ago(8), createdAt: ago(9), tasks: {} },
    // a stock build finished here, closed in NetSuite by hand — no record of its own
    { id: 'WO-STK-627', brand: 'ce', orderType: 'stock', stockErpId: 'HCUMB410/BS', totalParts: 120, currentPhase: 'Complete', nsWoId: '940627', nsWoTran: 'WO11627', completedAt: ago(25), createdAt: ago(27), tasks: {} },
    // painting, a coat finished this morning
    { id: 'WO-STK-PAINT', brand: 'ce', orderType: 'stock', totalParts: 30, currentPhase: 'Painting', currentStepIndex: 1, createdAt: ago(16), tasks: { spinSpray: { status: 'Complete', startTime: ago(0.2), completedAt: ago(0.1) } } },
    { id: 'WO-FIN-CLOSED', brand: 'ce', currentPhase: 'Closed', createdAt: ago(4) },
];
const shop = [
    { id: 'SHOP-WO-MILL-1', status: 'Completed', createdAt: ago(43), completedAt: ago(30) },
    { id: 'SHOP-WO-MILL-2', status: 'Sent to Plating', createdAt: ago(20), startedAt: ago(19) },
    { id: 'SHOP-WO-MILL-3', status: 'Pending', createdAt: ago(2) },
];
const rows = openWorkOf({ hqDocs: hq, finDocs: fin, shopDocs: shop, salesOrders: sos, now });
const by = Object.fromEntries(rows.map(r => [r.key, r]));

// ── the list ──
eq('what is open, grouped: floor, waiting to pack, shop, parked, then the display rows — oldest first in each',
    rows.map(r => `${r.group}:${r.key}`),
    ['FLOOR:FIN-9', 'FLOOR:WO-STK-PAINT', 'FLOOR:WO-STK-1', 'PACK:WO-STK-627', 'PACK:WO-SO60932', 'SHOP:WO-MILL-2', 'SHOP:WO-MILL-3', 'PARKED:WO-JTREE-1', 'PARKED:WO-LOST', 'DISPLAY:WO-OE-SO60551-ROW-2']);
ok('a shop-only work order whose shop job is COMPLETED is done — it was fourteen of the 120', !by['WO-MILL-1']);
ok('packed, closed and deleted are not open', !by['WO-PACKED'] && !by['WO-CLOSED'] && !by['WO-DEL'] && !by['WO-FIN-CLOSED']);
eq('each says where it is', [by['FIN-9'].where, by['WO-STK-PAINT'].where, by['WO-STK-627'].where, by['WO-MILL-2'].where, by['WO-MILL-3'].where, by['WO-JTREE-1'].where, by['WO-LOST'].where],
    ['Setup', 'Painting · coat 2', 'finished — not packed', 'shop · Sent to Plating', 'shop · Pending', 'parked — not released', 'Dispatched — no floor document found']);
eq('a finished row of a display order is its own group', by['WO-OE-SO60551-ROW-2'].group, OPEN_GROUP.DISPLAY);
eq('…an ordinary finished sales document waits to pack', by['WO-SO60932'].group, OPEN_GROUP.PACK);
eq('age is from when it was raised', [by['FIN-9'].ageDays, by['WO-JTREE-1'].ageDays, by['WO-STK-1'].ageDays], [18, 56, 3]);
eq('the record and its finishing document are ONE row, named by the NetSuite number', [rows.filter(r => /STK-1$/.test(r.key)).length, by['WO-STK-1'].ref, by['WO-STK-1'].item, by['WO-STK-1'].qty], [1, 'WO11722', 'HTA635/SG', 10]);
eq('a record finds its finishing document by finPayload.id', [by['FIN-9'].hq.id, by['FIN-9'].fin.id], ['REC-9', 'FIN-9']);
eq('a finishing document with no record is still a row', [by['WO-STK-627'].hq, by['WO-STK-627'].ref], [null, 'WO11627']);
eq('division travels on the row', [by['WO-JTREE-1'].brand, by['WO-STK-1'].brand], ['m2c', 'ce']);
eq('the counts, in the order shown', openGroupCounts(rows).map(g => `${g.group}:${g.count}`), ['FLOOR:3', 'PACK:2', 'SHOP:2', 'PARKED:2', 'DISPLAY:1']);
eq('the NetSuite transactions each row hangs on: a stock row its work order, a sales row its sales order', [by['WO-STK-1'].nsWoId, by['WO-STK-1'].soNsId, by['WO-SO60932'].soNsId, by['WO-OE-SO60551-ROW-2'].soNsId, by['WO-MILL-3'].nsWoId], ['953078', '', '950932', '936808', '951690']);

// ── movement: what a person or a floor did, never a refresh ──
eq('a morning stock refresh and an updatedAt are not movement — the paint run has sat eighteen days', by['FIN-9'].idleDays, 18);
eq('a pick yesterday is', by['WO-STK-1'].idleDays, 1);
eq('a step finished this morning is', by['WO-STK-PAINT'].idleDays, 0);
eq('the shop job\'s own stamps count for a shop row', by['WO-MILL-2'].idleDays, 19);
eq('a completed finish counts from when it completed', by['WO-STK-627'].idleDays, 25);

// ── out of step: open here, finished in NetSuite ──
const ns = nsStatusOf([
    { id: '953078', tranid: 'WO11722', ttype: 'WorkOrd', code: 'B' }, { id: '940627', tranid: 'WO11627', ttype: 'WorkOrd', code: 'H' },
    { id: '951690', tranid: 'WO11690', ttype: 'WorkOrd', code: 'B' }, { id: '950932', tranid: 'SO60932', ttype: 'SalesOrd', code: 'G' },
    { id: '936808', tranid: 'SO60551', ttype: 'SalesOrd', code: 'B' },
]);
const oos = outOfStepOf(rows, ns);
eq('the two NetSuite has finished, each saying why', oos.map(r => [r.key, r.why]), [['WO-STK-627', 'NetSuite work order WO11627 is Closed'], ['WO-SO60932', 'NetSuite sales order SO60932 is Billed']]);
eq('NetSuite not read → nothing is called out of step', [outOfStepOf(rows, null), outOfStepOf(rows, {}).length], [[], 0]);
eq('the words: a work order', ['G', 'H', 'C', 'B', 'D', 'A'].map(c => nsDoneWord({ type: 'WorkOrd', code: c })), ['Built', 'Closed', 'Cancelled', '', '', '']);
eq('the words: a sales order — fully fulfilled counts, partly does not', ['F', 'G', 'H', 'C', 'B', 'D', 'E', 'A'].map(c => nsDoneWord({ type: 'SalesOrd', code: c })), ['fully fulfilled', 'Billed', 'Closed', 'Cancelled', '', '', '', '']);
eq('a status written with its record type is read by its letter; another record type says nothing', [nsDoneWord({ type: 'WorkOrd', code: 'WorkOrd:G' }), nsDoneWord({ type: 'CustInvc', code: 'G' }), nsDoneWord(null)], ['Built', '', '']);
eq('both finished: both said', outOfStepOf([{ key: 'X', nsWoId: '1', soNsId: '2', nsWoTran: 'WO1', soRef: 'SO2' }], { 1: { tran: 'WO1', type: 'WorkOrd', code: 'G' }, 2: { tran: 'SO2', type: 'SalesOrd', code: 'F' } })[0].why, 'NetSuite work order WO1 is Built · NetSuite sales order SO2 is fully fulfilled');
eq('the ids to read, once each', nsIdsOfRows(rows).sort(), ['936808', '940627', '950932', '951690', '953078']);
ok('the read names only numbers', nsStatusSql(['953078', 'x; DROP', '940627', '953078']) === 'SELECT t.id AS id, t.tranid AS tranid, t.type AS ttype, t.status AS code FROM Transaction t WHERE t.id IN (953078,940627)' && nsStatusSql([]) === '');

// ── no movement for fourteen days ──
const idle = noMovementOf(rows, { except: oos.map(r => r.key) });
eq('fourteen days is the line', NO_MOVEMENT_DAYS, 14);
eq('longest first: the parked M2C record, the plater job, the paint run — and neither the display row nor a row already out of step',
    idle.map(r => [r.key, r.idleDays]), [['WO-JTREE-1', 56], ['WO-MILL-2', 19], ['FIN-9', 18]]);
ok('a display row waiting to ship is waiting on purpose', !noMovementOf(rows).some(r => r.group === OPEN_GROUP.DISPLAY) && by['WO-OE-SO60551-ROW-2'].idleDays === 20);
eq('thirteen days is not listed, fourteen is', noMovementOf([{ key: 'A', group: 'FLOOR', idleDays: 13, ref: 'A' }, { key: 'B', group: 'FLOOR', idleDays: 14, ref: 'B' }]).map(r => r.key), ['B']);
// "Still real" is movement.
eq('where "still real" is written, and the stamp', [stillRealTargetOf(by['FIN-9']), stillRealTargetOf(by['WO-JTREE-1']), stillRealTargetOf(null), stillRealStamp(' Eric ', 5)], [{ coll: 'fin_workorders', id: 'FIN-9' }, { coll: 'hq_work_orders', id: 'WO-JTREE-1' }, null, { openConfirmedAt: 5, openConfirmedBy: 'Eric' }]);
const confirmed = openWorkOf({ hqDocs: hq, finDocs: fin.map(f => (f.id === 'FIN-9' ? { ...f, openConfirmedAt: ago(1) } : f)), shopDocs: shop, salesOrders: sos, now });
ok('once someone says still real it is off the list for fourteen days', !noMovementOf(confirmed).some(r => r.key === 'FIN-9') && confirmed.find(r => r.key === 'FIN-9').idleDays === 1);

// ── the text for the Day summary's copy ──
const text = openWorkText({ outOfStep: oos, noMovement: idle });
ok('both lists, each row with its number, item, where and why', /^OUT OF STEP — open here, finished in NetSuite\n {3}WO11627 · HCUMB410\/BS ×120 — finished — not packed — NetSuite work order WO11627 is Closed/.test(text)
    && /\n\nNO MOVEMENT — open, nothing recorded for 14 days or more\n {3}WO-JTREE-1 · JTREEWD-X3\/SM01 ×4 — parked — not released — 56 days/.test(text));
eq('nothing to say → nothing', openWorkText({}), '');
eq('time is read from a number, a Firestore stamp or a date string', [msOf(5), msOf({ seconds: 2 }), msOf({ toMillis: () => 7 }), msOf('1970-01-01T00:00:01Z'), msOf(null), msOf('')], [5, 2000, 7, 1000, 0, 0]);

console.log(`openWork: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
