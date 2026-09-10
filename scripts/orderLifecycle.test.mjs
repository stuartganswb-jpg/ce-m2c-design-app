// The order-lifecycle identity set, offline.
//   node scripts/orderLifecycle.test.mjs
//
// Brief B7 (2026-09-04). A shop job is SHOP-<hq id>; a milling spine's orderKey/quoteId are the
// library part id — so the hq record was never in the key set and the shop could not tell RTG
// anything. This pins that the id convention is a key, from either side.

import { identityKeysOf, isClosedState, isDoneState, auditOrphans, queuedWriteTargets, orderDocIdsOf, entryNamesOrder, reopenPlanFor, planBulkReopen, pickStatusFromStamps, closedByBulkIn, DELETE, BULK_CLOSE_FROM } from '../src/components/Shared/orderLifecycle.js';

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

// ── REOPENING A BULK CLOSE (S2 Issue 1, 2026-09-10) — every restore comes from a stamp ──────────
const T = 1789040000000;                                   // "this morning"
const bulk = { closedFrom: BULK_CLOSE_FROM, closedAt: T, closedBy: 'stuart', closeReason: 'FLOOR_DONE', currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed', sentToPickPack: false, pickStatus: 'Closed' };
ok('window: in', closedByBulkIn({ closedFrom: BULK_CLOSE_FROM, closedAt: T }, { since: T - 1000 }));
ok('window: the 8/30 bulk close is outside', !closedByBulkIn({ closedFrom: BULK_CLOSE_FROM, closedAt: T - 10 * 86400000 }, { since: T - 1000 }));
ok('window: a hand close is never a bulk close', !closedByBulkIn({ closedFrom: 'RTG', closedAt: T }, { since: 0 }));
eq('pick status: staged beats picked', pickStatusFromStamps({ pickedAt: 1, stagedAt: 2 }), 'Staged_Ready_For_Finishing');
eq('pick status: picked', pickStatusFromStamps({ pickedAt: 1 }), 'Picked_Awaiting_Staging');
eq('pick status: nothing → Pending', pickStatusFromStamps({}), 'Pending');

const fin = (x) => reopenPlanFor({ coll: 'fin_workorders', d: { id: 'WO-1', ...bulk, ...x } });
eq('fin: shipped stays closed', fin({ shippedAt: 5 }).action, 'KEEP');
eq('fin: put away stays closed', fin({ putawayBin: 'M E7-N3-R2', packStatus: 'Packed' }).action, 'KEEP');
eq('fin: FLOOR_CLOSED close is kept (floor had closed it)', fin({ closeReason: 'FLOOR_CLOSED' }).action, 'KEEP');
eq('fin: reopened by this tool → skip', fin({ reopenedAt: 9, reopenedFrom: 'RTG_BULK_REOPEN' }).action, 'SKIP');
eq('fin: packed, fulfilment posted → shipped, kept', fin({ packStatus: 'Packed', packedAt: 3, nsIfTran: 'IF22120' }).action, 'KEEP');
eq('fin: packed, fulfilment queued (stuck or not) → shipped, kept', fin({ packStatus: 'Packed', packedAt: 3, nsFulfillQueued: true }).action, 'KEEP');
eq('fin: not a bulk close → skip', fin({ closedFrom: 'RTG' }).action, 'SKIP');
let r = fin({ packStatus: 'Packed', packedAt: 3, pickedAt: 1, stagedAt: 2 });
eq('fin: packed, not put away → Complete, staged, no confirm chip', [r.action, r.patch.currentPhase, r.patch.sentToPickPack, r.patch.pickStatus, r.patch.reopenConfirmPick], ['RESTORE', 'Complete', true, 'Staged_Ready_For_Finishing', false]);
r = fin({ completedAt: 4, pickedAt: 1 });
eq('fin: finished on the floor, not packed → Complete, back in the WMS, confirm chip', [r.patch.currentPhase, r.patch.stepStatus, r.patch.sentToPickPack, r.patch.pickStatus, r.patch.reopenConfirmPick], ['Complete', 'Complete', true, 'Picked_Awaiting_Staging', true]);
r = fin({ tasks: { spinSetup: { status: 'Complete' }, spinSpray: { status: 'Pending' } }, currentStepIndex: 1 });
eq('fin: tasks partly done → Painting at the recorded step', [r.patch.currentPhase, r.patch.stepStatus, r.patch.currentStepIndex], ['Painting', 'Staged', undefined]);
r = fin({ tasks: { spinSetup: { status: 'Pending' } } });
eq('fin: nothing started → Setup', [r.patch.currentPhase, r.patch.stepStatus, r.patch.currentStepIndex], ['Setup', 'Pending', 0]);
r = fin({ pickOnly: true, completedAt: 1, completedBy: 'split (pick only)', hasCustomSibling: true });
eq('fin: pick-only → Complete and released regardless of the sibling', [r.patch.currentPhase, r.patch.sentToPickPack, r.patch.pickStatus], ['Complete', true, 'Pending']);
r = reopenPlanFor({ coll: 'fin_workorders', d: { id: 'WO-2', ...bulk, completedAt: 4, hasCustomSibling: true }, sibling: { status: 'Completed', closed: true } });
eq('fin: paired, custom half never started → pick NOT released', [r.patch.sentToPickPack, r.patch.pickStatus, r.patch.reopenConfirmPick], [false, 'Pending', false]);
r = reopenPlanFor({ coll: 'fin_workorders', d: { id: 'WO-2', ...bulk, completedAt: 4, hasCustomSibling: true }, sibling: { status: 'Completed', closed: true, startedAt: 1 } });
eq('fin: paired, custom half started (stamp, not status) → released', r.patch.sentToPickPack, true);
ok('fin: the close stamps are removed and kept as history', r.patch.closedAt === DELETE && r.patch.nsWoCloseRequired === DELETE && r.patch.status === DELETE && r.patch.reopenedFromClose.closedBy === 'stuart');

const shopd = (x, sib) => reopenPlanFor({ coll: 'shop_custom_orders', d: { id: 'SHOP-WO-1', ...bulk, status: 'Completed', closed: true, ...x }, sibling: sib });
r = shopd({ completedAt: 3, startedAt: 1 });
eq('shop: completed stays Completed, closed flag removed, not live', [r.action, r.patch.status, r.patch.closed, r.live], ['RESTORE', 'Completed', DELETE, false]);
eq('shop: started → In Process, live', [shopd({ startedAt: 1 }).patch.status, shopd({ startedAt: 1 }).live], ['In Process', true]);
eq('shop: nothing → Pending', shopd({}).patch.status, 'Pending');
r = shopd({ completedAt: null, startedAt: 1, status: 'In Process', reopenedAt: T + 3600000, reopenedBy: 'Livio' });
eq('shop: hand-reopened after the close → status untouched, closed flag removed, live', [r.action, r.patch.status, r.patch.closed, r.live], ['RESTORE', undefined, DELETE, true]);
eq('shop: a reopen BEFORE the close is history, not a hand reopen', shopd({ completedAt: 3, reopenedAt: T - 3600000 }).patch.status, 'Completed');
eq('shop: sibling says at the plater → Sent to Plating', shopd({ completedAt: 3 }, { customFabStatus: 'Sent to Plating' }).patch.status, 'Sent to Plating');
eq('shop: no sibling, outsourced + demand raised → Sent to Plating', shopd({ completedAt: 3, isOutsourced: true, platingDemandCreated: true }).patch.status, 'Sent to Plating');

const hq = (coll, x) => reopenPlanFor({ coll, d: { id: 'R', ...bulk, ...x } });
eq('record: dispatched → Dispatched', hq('hq_work_orders', { dispatchedAt: 1 }).patch.status, 'Dispatched');
eq('record: pushed → Dispatched', hq('hq_work_orders', { pushedToFinishing: true }).patch.status, 'Dispatched');
eq('record: parked → Approved', hq('hq_work_orders', {}).patch.status, 'Approved');
eq('sales order: split → Dispatched', hq('hq_sales_orders', { autoSplit: true }).patch.status, 'Dispatched');
eq('stocked order: status is its pick status', hq('hq_sales_orders', { orderClass: 'QUICKSHIP', pickStatus: 'Picked' }).patch.status, 'Picked');
eq('stocked order: unknown pick status → Pending', hq('hq_sales_orders', { orderClass: 'QUICKSHIP' }).patch.status, 'Pending');

// the plan: the record follows its floor; cuts follow the record; queued writes always come back
const finA = { id: 'WO-SOA', ...bulk, orderKey: 'SOA', completedAt: 4, pickedAt: 1 };                      // live
const finB = { id: 'WO-SOB', ...bulk, orderKey: 'SOB', putawayBin: 'BIN' };                                  // done
const shopB = { id: 'SHOP-WO-SOB', ...bulk, status: 'Completed', closed: true, orderKey: 'SOB', completedAt: 2, finSiblingId: 'WO-SOB' };
const recA = { id: 'WO-SOA', __coll: 'hq_work_orders', ...bulk, dispatchedAt: 1 };
const recB = { id: 'WO-SOB', __coll: 'hq_work_orders', ...bulk, dispatchedAt: 1 };
const recOld = { id: 'WO-OLD', __coll: 'hq_work_orders', ...bulk, closedAt: T - 10 * 86400000 };
const cutA = { id: 'RC-A', status: 'CANCELLED', finWoId: 'WO-SOA', cancelledAt: T + 5, cancelReason: `order WO-SOA closed from ${BULK_CLOSE_FROM} — FLOOR_DONE — the cut was still open; no inventory moved` };
const cutB = { id: 'RC-B', status: 'CANCELLED', finWoId: 'WO-SOB', cancelledAt: T + 5, cancelReason: `order WO-SOB closed from ${BULK_CLOSE_FROM} — FLOOR_DONE — the cut was still open; no inventory moved` };
const cutHand = { id: 'RC-H', status: 'CANCELLED', finWoId: 'WO-SOA', cancelledAt: T + 5, cancelReason: 'cancelled at the saw' };
const obB = { id: 'ob1', status: 'CANCELLED', label: 'NS Fulfillment — WO-SOB', cancelledAt: T + 6, cancelReason: 'order WO-SOB closed — FLOOR_DONE — queued write cancelled' };
const obOther = { id: 'ob2', status: 'CANCELLED', cancelledAt: T + 6, cancelReason: 'order WO-ELSE closed — FLOOR_DONE — queued write cancelled' };
const obFailed = { id: 'ob3', status: 'CANCELLED', label: 'NS Fulfillment — WO-SOA', cancelledAt: T + 6, attempts: 4, lastError: 'Please enter value(s) for: Class', cancelReason: 'order WO-SOA closed — FLOOR_DONE — queued write cancelled' };
const plan = planBulkReopen({ finWos: [finA, finB], shopJobs: [shopB], hqOrders: [recA, recB, recOld], rodCuts: [cutA, cutB, cutHand], outbox: [obB, obOther, obFailed], since: T - 1000, until: T + 60000 });
const rowOf = (coll, id) => plan.rows.find(r => r.coll === coll && r.id === id);
eq('plan: live order → record restored', rowOf('hq_work_orders', 'WO-SOA').action, 'RESTORE');
eq('plan: done order → record kept', rowOf('hq_work_orders', 'WO-SOB').action, 'KEEP');
eq('plan: done order → its finished shop half kept too', rowOf('shop_custom_orders', 'SHOP-WO-SOB').action, 'KEEP');
eq('plan: the live fin doc restores', rowOf('fin_workorders', 'WO-SOA').action, 'RESTORE');
eq('plan: cut for the live order → OPEN', rowOf('rod_cut_orders', 'RC-A').action, 'RESTORE');
eq('plan: cut for the done order stays cancelled', rowOf('rod_cut_orders', 'RC-B').action, 'KEEP');
ok('plan: a cut cancelled by hand is not in the plan', !rowOf('rod_cut_orders', 'RC-H'));
eq('plan: a queued write comes back PENDING even for the done order', [rowOf('ns_outbox', 'ob1').action, rowOf('ns_outbox', 'ob1').patch.status], ['RESTORE', 'PENDING']);
eq('plan: a write that had FAILED goes back to FAILED, not retried', rowOf('ns_outbox', 'ob3').patch.status, 'FAILED');
ok('plan: another order\'s cancelled write is untouched', !rowOf('ns_outbox', 'ob2'));
ok('plan: the earlier bulk close is outside the window and counted', !rowOf('hq_work_orders', 'WO-OLD') && plan.outsideWindow === 1);
eq('plan: counts (kept: put-away fin, its record, its shop half, its cut)', plan.counts, { RESTORE: 5, KEEP: 4 });

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
