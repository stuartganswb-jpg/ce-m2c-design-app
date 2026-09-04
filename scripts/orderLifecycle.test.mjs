// The order-lifecycle identity set, offline.
//   node scripts/orderLifecycle.test.mjs
//
// Brief B7 (2026-09-04). A shop job is SHOP-<hq id>; a milling spine's orderKey/quoteId are the
// library part id — so the hq record was never in the key set and the shop could not tell RTG
// anything. This pins that the id convention is a key, from either side.

import { identityKeysOf, isClosedState, isDoneState, auditOrphans } from '../src/components/Shared/orderLifecycle.js';

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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
