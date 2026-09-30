// 🪵 What the app has already taken from the shelf (Eric 2026-09-30, HCUMP410/CP + /N25).   node scripts/shelfClaims.test.mjs
import { shelfClaimsOf, freeAfterClaims, claimText } from '../src/components/Shared/shelfClaims.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// The HCUMP410 picture on 9/30 at 12:46, as the data shows it.
const rtg = [
    // 9/28 18:27 — CP × 10 took 10 off the shelf; it has a NetSuite work order (WO11657, now Built)
    { id: 'WO-STK-62069-1790620067694', status: 'Dispatched', nsWoTran: 'WO11657', materialRows: [{ code: 'HCUMP410', need: 10 }] },
    // 9/28 18:27 — N25 × 10: 8 off the shelf + an OPEN cut of 1 × HCUMP810 → 2; parked, NO NetSuite work order
    { id: 'WO-STK-62069-1790620068094', status: 'Approved', rodCutId: 'RC-N25-928', awaitingRodCut: true, materialRows: [{ code: 'HCUMP410', need: 10 }] },
    // 9/08 SG × 20 — its own cut DONE, NetSuite WO11610 Built
    { id: 'WO-STK-49005-1788884550797', status: 'Dispatched', nsWoTran: 'WO11610', rodCutId: 'RC-SG-908', materialRows: [{ code: 'HCUMP410', need: 20 }] },
    // an old one, deleted
    { id: 'WO-STK-49005-1788553971213', status: 'Deleted', materialRows: [{ code: 'HCUMP410', need: 20 }] },
];
const fin = [
    { id: 'WO-STK-62069-1790620067694', nsWoTran: 'WO11657', currentPhase: 'Complete', pickStatus: 'Picked_Awaiting_Staging', partsList: [{ legacyErpId: 'HCUMP410', qty: 10 }] },
    { id: 'WO-STK-49005-1788884550797', nsWoTran: 'WO11610', currentPhase: 'Complete', pickStatus: 'Picked_Awaiting_Staging', partsList: [{ legacyErpId: 'HCUMP410', qty: 20 }] },
];
const cuts = [
    { id: 'RC-N25-928', status: 'OPEN', sourceItemId: 'HCUMP810', qtySource: 1, targetItemId: 'HCUMP410', qtyTarget: 2 },
    { id: 'RC-SG-908', status: 'DONE', sourceItemId: 'HCUMP810', qtySource: 10, targetItemId: 'HCUMP410', qtyTarget: 20 },
    { id: 'RC-OLD', status: 'CANCELLED', sourceItemId: 'HCUMP810', qtySource: 5, targetItemId: 'HCUMP410', qtyTarget: 10 },
];
let c = shelfClaimsOf({ finDocs: fin, rtgDocs: rtg, cutOrders: cuts, codes: ['hcump410', 'HCUMP810'] });
eq('Eric\'s case: only the parked N25 claims — 10 less its own open cut of 2 = 8', [c.HCUMP410.claimed, c.HCUMP410.rows.map(r => [r.docId.slice(-4), r.claim])], [8, [['8094', 8]]]);
ok('documents with a NetSuite work order are NetSuite\'s to count (committed or built)', !c.HCUMP410.rows.some(r => /7694|0797/.test(r.docId)));
ok('deleted and cancelled are nothing', !c.HCUMP410.rows.some(r => /3971/.test(r.docId)) && !c.HCUMP810.rows.some(r => r.docId === 'RC-OLD'));
eq('an OPEN cut takes its source rods; a DONE one already posted', [c.HCUMP810.claimed, c.HCUMP810.rows.map(r => r.docId)], [1, ['RC-N25-928']]);
// the free count the 9/30 press should have read: 8 on the rack, all 8 taken → 0 free → need 10 → 5 cuts (2 per 8 ft)
const free = freeAfterClaims({ HCUMP410: 8, HCUMP810: 444 }, c);
eq('8 available less 8 claimed = 0 free (and the 8 ft rack less the open cut)', [free.HCUMP410, free.HCUMP810], [0, 443]);
eq('→ HCUMP410/CP × 10 needs ceil(10 / 2) = 5 cuts, not 1', Math.ceil(Math.max(0, 10 - free.HCUMP410) / 2), 5);

// ── the finishing document speaks for its record, once ─────────────────────────────────────
c = shelfClaimsOf({
    finDocs: [{ id: 'WO-A', currentPhase: 'Setup', pickStatus: 'Pending', partsList: [{ legacyErpId: 'HTA435', qty: 10 }] }],
    rtgDocs: [{ id: 'WO-A', status: 'Dispatched', materialRows: [{ code: 'HTA435', need: 10 }] }, { id: 'WO-B', status: 'Approved', materialRows: [{ code: 'HTA435', need: 10 }] }],
    codes: ['HTA435'],
});
eq('a dispatched record and its finishing document are one claim; a parked record its own', [c.HTA435.claimed, c.HTA435.rows.map(r => [r.docId, r.source])], [20, [['WO-A', 'finishing'], ['WO-B', 'rtg']]]);
c = shelfClaimsOf({ finDocs: [{ id: 'WO-A', packStatus: 'Packed', partsList: [{ legacyErpId: 'HTA435', qty: 10 }] }], rtgDocs: [{ id: 'WO-A', status: 'Dispatched', materialRows: [{ code: 'HTA435', need: 10 }] }], codes: ['HTA435'] });
eq('packed — gone from the shelf and from the claims; its record is not counted instead', c.HTA435.claimed, 0);
c = shelfClaimsOf({ rtgDocs: [{ id: 'WO-B', status: 'Approved', materialRows: [{ code: 'HTA435', need: 10 }] }], codes: ['HTA435'], exceptIds: ['WO-B'] });
eq('the order being written now is left out', c.HTA435.claimed, 0);
c = shelfClaimsOf({ rtgDocs: [{ id: 'WO-C', status: 'Approved', rodCutId: 'RC-C', materialRows: [{ code: 'HCUMP410', need: 10 }] }], cutOrders: [{ id: 'RC-C', status: 'OPEN', sourceItemId: 'HCUMP810', qtySource: 5, targets: [{ itemId: 'HCUMP410', qty: 10 }] }], codes: ['HCUMP410'] });
eq('an order fully covered by its own open cut claims no shelf', c.HCUMP410.claimed, 0);
ok('a code nobody asked about is not reported', !('HTA835' in shelfClaimsOf({ rtgDocs: rtg, codes: ['HCUMP410'] })));

// ── the words ───────────────────────────────────────────────────────────────────────────────
ok('the line names the claim and who holds it', /^8 already taken by open orders NetSuite cannot see yet \(…62069-\d+ 8\)$/.test(claimText(shelfClaimsOf({ finDocs: fin, rtgDocs: rtg, cutOrders: cuts, codes: ['HCUMP410'] }).HCUMP410)) || /8 already taken/.test(claimText(shelfClaimsOf({ finDocs: fin, rtgDocs: rtg, cutOrders: cuts, codes: ['HCUMP410'] }).HCUMP410)));
eq('nothing claimed → no line', claimText({ claimed: 0, rows: [] }), '');

console.log(`shelfClaims: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
