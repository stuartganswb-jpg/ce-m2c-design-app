// The order-lifecycle identity set, offline.
//   node scripts/orderLifecycle.test.mjs
//
// Brief B7 (2026-09-04). A shop job is SHOP-<hq id>; a milling spine's orderKey/quoteId are the
// library part id — so the hq record was never in the key set and the shop could not tell RTG
// anything. This pins that the id convention is a key, from either side.

import { identityKeysOf, isClosedState, isDoneState, auditOrphans, queuedWriteTargets, orderDocIdsOf, entryNamesOrder } from '../src/components/Shared/orderLifecycle.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// a stock milling shop job whose keys are the LIBRARY PART id
const shop = { id: 'SHOP-WO-CMP-HCUMSBF15-655311-1', orderKey: 'libDoc123', quoteId: 'libDoc123' };
ok('shop job: the hq id is in the set', identityKeysOf(shop).includes('WO-CMP-HCUMSBF15-655311-1'));
ok('shop job: its own id stays', identityKeysOf(shop).includes('SHOP-WO-CMP-HCUMSBF15-655311-1'));
ok('shop job: the part id stays (nothing dropped)', identityKeysOf(shop).includes('libDoc123'));
// the Order Entry pair's shop half: SHOP-<woId>-C
eq('OE pair shop half strips to its hq id', identityKeysOf({ id: 'SHOP-WO-OE-H1-1788-0-C' }).includes('WO-OE-H1-1788-0-C'), true);
// a fin doc naming its sibling
eq('fin doc: shopSiblingId SHOP-X yields X too', identityKeysOf({ id: 'WO-SO60239', shopSiblingId: 'SHOP-SO60239' }), ['WO-SO60239', 'SHOP-SO60239', 'SO60239']);
// no duplicates, nothing falsy
eq('de-duplicated, falsy dropped', identityKeysOf({ id: 'A', woId: 'A', soId: null, orderKey: '' }), ['A']);
eq('null in → empty', identityKeysOf(null), []);

// terminal predicates unchanged
ok('closed: status Closed', isClosedState({ status: 'Closed' }));
ok('closed: soft-deleted counts', isClosedState({ deleted: true }));
ok('done: packed counts', isDoneState({ packStatus: 'Packed' }));
ok('not done: Setup', !isDoneState({ currentPhase: 'Setup' }));

// the audit still sees a shop job whose hq parent is gone, and is quiet when it is alive
const orphans = auditOrphans({ hqOrders: [], shopJobs: [{ id: 'SHOP-WO-GONE', status: 'Pending' }] });
ok('audit: shop job with no hq parent is an orphan', orphans.some(x => x.type === 'ORPHAN_FLOOR'));
const quiet = auditOrphans({ hqOrders: [{ id: 'WO-HERE', status: 'Dispatched' }], shopJobs: [{ id: 'SHOP-WO-HERE', status: 'Pending', orderKey: 'libDoc' }] });
ok('audit: shop job whose hq parent lives is not an orphan (the SHOP- key)', !quiet.some(x => x.type === 'ORPHAN_FLOOR'));

// ── a queued NetSuite write is the order's only when it names the order's OWN documents ──
const order = { id: 'WO-STK-52919', woId: 'WO-STK-52919', hqJobId: 'lib42' };
const links = { fin: new Map([['WO-STK-52919', {}]]), shop: new Map([['SHOP-WO-STK-52919', {}]]), hq: { id: 'WO-STK-52919' } };
const ids = orderDocIdsOf(order, links);
ok('doc ids include record, fin, shop', ids.has('WO-STK-52919') && ids.has('SHOP-WO-STK-52919'));
eq('writeBack array → targets', queuedWriteTargets({ writeBack: [{ collection: 'fin_workorders', docId: 'A' }, { collection: 'hq_work_orders', docId: 'B' }] }).length, 2);
eq('writeBack object → one target', queuedWriteTargets({ writeBack: { collection: 'hq_work_orders', docId: 'B' } }).length, 1);
eq('no writeBack → none', queuedWriteTargets({}), []);
ok('Route A work order for this order matches (writeBack)', entryNamesOrder({ kind: 'workorder', writeBack: [{ collection: 'fin_workorders', docId: 'WO-STK-52919' }, { collection: 'hq_work_orders', docId: 'WO-STK-52919' }] }, ids));
ok('matches by dedupeKey wo:hq_work_orders:<id>', entryNamesOrder({ kind: 'workorder', dedupeKey: 'wo:hq_work_orders:WO-STK-52919' }, ids));
ok('matches by dedupeKey wocmpl:<finId>', entryNamesOrder({ kind: 'workordercompletion', dedupeKey: 'wocmpl:WO-STK-52919' }, ids));
ok('a PURCHASE ORDER write is NOT the order\'s (other record)', !entryNamesOrder({ kind: 'purchaseorder', dedupeKey: 'po:PO-7', writeBack: { collection: 'hq_purchase_orders', docId: 'PO-7' } }, ids));
ok('another order\'s work order is NOT matched', !entryNamesOrder({ kind: 'workorder', writeBack: { collection: 'hq_work_orders', docId: 'WO-OTHER' } }, ids));
ok('a pick adjustment with no writeBack is NOT matched', !entryNamesOrder({ kind: 'inventoryadjustment' }, ids));
// the audit lists a write that posted after its order closed, until acknowledged
const afterClose = auditOrphans({ outbox: [{ id: 'ob1', label: 'NS WO — build X', postedForClosedOrder: true, postedForClosedOrderId: 'WO-STK-52919', nsTran: 'WO11600' }] });
ok('flagged outbox entry → NS_POSTED_AFTER_CLOSE', afterClose.some(x => x.type === 'NS_POSTED_AFTER_CLOSE' && x.detail.includes('WO11600')));
const acked = auditOrphans({ outbox: [{ id: 'ob1', postedForClosedOrder: true, postedForClosedOrderAckAt: 1 }] });
ok('acknowledged entry is quiet', !acked.some(x => x.type === 'NS_POSTED_AFTER_CLOSE'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
