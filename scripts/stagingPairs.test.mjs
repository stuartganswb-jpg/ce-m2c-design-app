// 🧩 Waiting on its other half — the WMS staging card (Stuart 2026-09-30).   node scripts/stagingPairs.test.mjs
import { pairWaitOf, pairWaitsOf, waitedText, PAIR_WAIT } from '../src/components/Shared/stagingPairs.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const parts = [{ legacyErpId: 'HCUSR1', qty: 44 }, { legacyErpId: 'HUSCBPSTA', qty: 2 }];
const doc = (x) => ({ id: 'WO-SO1', salesOrderId: 'SO1', orderType: 'sales', partsList: parts, sentToPickPack: true, pickStatus: 'Pending', currentPhase: 'Setup', ...x });

// ── the three waits ─────────────────────────────────────────────────────────────────────────
let r = pairWaitOf(doc({ pickStatus: 'Picked_Awaiting_Staging', pickedAt: 100, hasCustomSibling: true, customFabStatus: 'In Process' }));
eq('small parts picked, shop still fabricating', [r.kind, r.ready, r.missing, r.since], [PAIR_WAIT.SMALL_READY, 'small parts picked', 'shop half: in process', 100]);
r = pairWaitOf(doc({ pickStatus: 'Picked_Awaiting_Staging', hasCustomSibling: true, customFabStatus: 'Sent to Plating', customFabAt: new Date(2026, 8, 28).getTime() }));
ok('…or at the plater, named', r.kind === PAIR_WAIT.SMALL_READY && /at the plater/.test(r.missing));
r = pairWaitOf(doc({ hasCustomSibling: true, customFabStatus: 'Complete', customFabAt: 200 }));
eq('shop half done, small parts still in the pick queue', [r.kind, r.missing, r.since], [PAIR_WAIT.SHOP_READY, 'small parts: in the WMS pick queue, not picked', 200]);
r = pairWaitOf(doc({ hasCustomSibling: true, customFabStatus: 'Complete', sentToPickPack: false }));
eq('…or never released to the pick', r.missing, 'small parts: not released to the pick yet');
r = pairWaitOf(doc({ hasCustomSibling: true, customFabStatus: 'Complete', pickInProgress: { by: 'Sandra B' } }));
eq('…or open on someone\'s tablet', r.missing, 'small parts: being picked by Sandra B');
// SO60676 before today's scan
r = pairWaitOf(doc({ id: 'WO-SO60676', pickStatus: 'Picked_Awaiting_Staging', pickedAt: 300, hasCustomSibling: true, customFabStatus: 'Complete', customFabAt: 250 }));
eq('SO60676: both halves in, nobody scanned', [r.kind, r.ready, r.since], [PAIR_WAIT.BOTH_READY, 'small parts picked · shop half complete', 300]);
r = pairWaitOf(doc({ pickStatus: 'Picked_Awaiting_Staging', pickedAt: 5 }));
eq('a small-only order picked and never scanned is listed too', [r.kind, r.ready], [PAIR_WAIT.BOTH_READY, 'small parts picked (no shop half)']);
r = pairWaitOf(doc({ partsList: [], hasCustomSibling: true, customFabStatus: 'Complete', customFabAt: 9 }));
eq('a pole-only pair with nothing to pick, shop done → waiting on the scan', [r.kind, r.ready], [PAIR_WAIT.BOTH_READY, 'shop half complete (nothing to pick)']);

// ── not on the card ─────────────────────────────────────────────────────────────────────────
ok('neither half ready', pairWaitOf(doc({ hasCustomSibling: true, customFabStatus: 'Pending' })) === null);
ok('a pole-only pair whose shop is still working', pairWaitOf(doc({ partsList: [], hasCustomSibling: true, customFabStatus: 'In Process' })) === null);
ok('matched', pairWaitOf(doc({ pickStatus: 'Staged_Ready_For_Finishing', stagingStatus: 'MATCHED', hasCustomSibling: true, customFabStatus: 'Complete' })) === null);
ok('cleared by hand at the WMS', pairWaitOf(doc({ pickStatus: 'Cleared_Overtaken', hasCustomSibling: true, customFabStatus: 'Complete' })) === null);
ok('finishing already complete', pairWaitOf(doc({ pickStatus: 'Picked_Awaiting_Staging', currentPhase: 'Complete' })) === null);
ok('packed, closed or deleted', [doc({ pickStatus: 'Picked_Awaiting_Staging', packStatus: 'Packed' }), doc({ pickStatus: 'Picked_Awaiting_Staging', currentPhase: 'Closed' }), doc({ pickStatus: 'Picked_Awaiting_Staging', deleted: true })].every(d => pairWaitOf(d) === null));
ok('a stock build or a pick-only document skips the match', pairWaitOf(doc({ orderType: 'stock', salesOrderId: '', pickStatus: 'Picked_Awaiting_Staging' })) === null && pairWaitOf(doc({ pickOnly: true, pickStatus: 'Picked_Awaiting_Staging' })) === null);

// ── the list ────────────────────────────────────────────────────────────────────────────────
const list = pairWaitsOf([
    doc({ id: 'WO-B', pickStatus: 'Picked_Awaiting_Staging', pickedAt: 500 }),
    doc({ id: 'WO-A', pickStatus: 'Picked_Awaiting_Staging', pickedAt: 100, hasCustomSibling: true, customFabStatus: 'Pending' }),
    doc({ id: 'WO-C', hasCustomSibling: true, customFabStatus: 'Pending' }),
    doc({ id: 'WO-D', hasCustomSibling: true, customFabStatus: 'Complete' }),
]);
eq('oldest wait first, unknown time last, the not-waiting left out', list.map(x => x.id), ['WO-A', 'WO-B', 'WO-D']);
ok('each row carries its document', list.every(x => x.doc && x.doc.id === x.id));
eq('how long', [waitedText(0), waitedText(1000 - 20 * 60000, 1000), waitedText(0 + 1, 5 * 3600000), waitedText(1, 3 * 86400000)], ['', '20 min', '5 h', '3 days']);

console.log(`stagingPairs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
