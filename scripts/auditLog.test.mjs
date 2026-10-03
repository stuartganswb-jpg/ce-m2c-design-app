// 🧾 The RTG Audit Log — rows, colours, the NetSuite read-back (Stuart 2026-10-03).   node scripts/auditLog.test.mjs
import {
    msOf, nsTypeOf, pageOf, itemQtyOf, rowFromOutbox, rowFromHqLog, rowFromFinLog, rowFromDeletion, expectedBuildRowOf, expectedReceiptRowOf,
    appSaysOf, writeBackLanded, txQueryOf, linesQueryOf, buildLinksQueryOf, verifyTargetsOf, indexReadBack, verifyVerdictOf, flagsOf,
    filterRows, pageGroupsOf, itemMatches,
} from '../src/components/Shared/auditLog.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const NOW = Date.UTC(2026, 9, 3, 15, 0, 0);

// ── item × qty out of the words the app already writes ──────────────────────────────────────
eq('a scrap', itemQtyOf('Scrap −248 × HCUSR15 (WO11639 closed short)'), { item: 'HCUSR15', qty: -248 });
eq('a work order', itemQtyOf('NS WO — build HCUSR15/SG-EA ×440'), { item: 'HCUSR15/SG-EA', qty: 440 });
eq('a build (the WO number is not the item)', itemQtyOf('Build NS WO WO11639 — HCUSR15/SG-EA ×192'), { item: 'HCUSR15/SG-EA', qty: 192 });
eq('a plating scan', itemQtyOf('OB Plating scan-in: 35 × H1-1R (EP2) WO SHOP-WO-OE-SO60585-7242-C → OB PLATING'), { item: 'H1-1R', qty: 35 });
eq('no item named: the payload quantity', itemQtyOf('Item receipt PO2344', { quantity: 35 }), { item: '', qty: 35 });
eq('nothing', itemQtyOf(''), { item: '', qty: null });

// ── record types and pages ──────────────────────────────────────────────────────────────────
eq('record types', [nsTypeOf('workordercompletion'), nsTypeOf('inventoryadjustment'), nsTypeOf('', 'https://x/services/rest/record/v1/purchaseorder/940982/!transform/itemreceipt'), nsTypeOf('', 'https://x/app/site/hosting/restlet.nl?script=2848'), nsTypeOf('', 'https://x/services/rest/record/v1/inventoryitem/123')],
    ['Assembly Build', 'Inventory Adj.', 'Item Receipt', 'RESTlet (convert build)', 'Item']);
eq('pages: the stamp first, else the app', [pageOf('WMS'), pageOf('order_entry-precheck'), pageOf('FINISHING', 'Finishing floor · ACTIVE FLOOR'), pageOf('')], ['WMS', 'Order Entry · precheck', 'Finishing floor · ACTIVE FLOOR', '—']);
eq('time from any shape', [msOf(5), msOf({ seconds: 2, nanoseconds: 5e6 }), msOf({ toMillis: () => 9 }), msOf(null)], [5, 2005, 9, null]);

// ── the queue (WO11639's real entries, read 2026-10-03) ──────────────────────────────────────
const iaEntry = { id: 'dCvthb1bFEwDxPjJ09kZ', kind: 'inventoryadjustment', label: 'Scrap −248 × HCUSR15 (WO11639 closed short)', status: 'POSTED', createdBy: 'Sandra G', sourceApp: 'WMS', createdAt: NOW - 86400000, postedAt: NOW - 86376000, nsId: '940878', nsTran: 'IA27606', attempts: 0, writeBack: { collection: 'fin_workorders', docId: 'WO-STK-49017-1790350164427', patch: { scrapAdjPosted: true }, idField: 'scrapAdjId' }, targetUrl: 'https://x/services/rest/record/v1/inventoryadjustment' };
const ia = rowFromOutbox(iaEntry);
eq('a queue row: page, who, item × qty, the NetSuite side', [ia.page, ia.who, ia.item, ia.qty, ia.ns.type, ia.ns.tran, ia.appRef], ['WMS', 'Sandra G', 'HCUSR15', -248, 'Inventory Adj.', 'IA27606', { coll: 'fin_workorders', id: 'WO-STK-49017-1790350164427' }]);
eq('posted, not read back yet: plain', flagsOf(ia, { now: NOW }).level, 'posted');

// The read-back: IA27606 is not in NetSuite; build 940669 is, ×26 as the app said.
const build = rowFromOutbox({ id: 'b1', kind: 'workordercompletion', label: 'Build NS WO WO11660 — HCUMLB415/SG ×26', status: 'POSTED', createdBy: 'auto (put away · bin RAW)', sourceApp: 'FINISHING', createdAt: NOW - 3600000, nsId: '940669', nsTran: 'ASSYB10628' });
const idx = indexReadBack({
    tx: [{ id: '940669', tranid: 'ASSYB10628', type: 'Build', st: 'Assembly Build : Undefined', trandate: '10/2/2026', voided: 'F' }, { id: '930292', tranid: 'WO11639', type: 'WorkOrd', st: 'Work Order : Closed', voided: 'F' }],
    lines: [{ tr: '940669', ml: 'T', item: 'HCUMLB415/SG', q: '26' }, { tr: '940669', ml: 'F', item: 'HCUMLB415', q: '-26' }, { tr: '941182', ml: 'T', item: 'HCUSR15/SG-EA', q: '192' }],
    links: [{ wo: '930292', id: '941182', nx: 'Assembly Build #ASSYB10633' }, { wo: '930292', id: '941182', nx: 'Assembly Build #ASSYB10633' }],
});
const vIa = verifyVerdictOf(ia, idx);
eq('IA27606: NOT FOUND in NetSuite', [vIa.found, /NOT FOUND/.test(vIa.text)], [false, true]);
const fIa = flagsOf(ia, { now: NOW, verify: vIa });
eq('…ORANGE, and says why', [fIa.level, fIa.reasons[0].startsWith('NOT FOUND in NetSuite')], ['orange', true]);
const vB = verifyVerdictOf(build, idx);
eq('a build read back: its number, the quantity matches', [vB.text, vB.qtyMatched], ['Assembly Build ASSYB10628 · 10/2/2026', true]);
eq('…green ✓', flagsOf(build, { now: NOW, verify: vB }), { level: 'ok', reasons: ['read back from NetSuite — quantity matches'] });
eq('a different quantity in NetSuite: orange', flagsOf({ ...build, qty: 30 }, { now: NOW, verify: verifyVerdictOf({ ...build, qty: 30 }, idx) }).reasons, ['NetSuite shows 26 × HCUMLB415/SG, the app says 30']);
eq('a line read cut short never calls a quantity different', verifyVerdictOf({ ...build, qty: 30 }, { ...idx, linesComplete: false }).qtyMismatch, undefined);
eq('voided in NetSuite: orange', flagsOf(build, { now: NOW, verify: verifyVerdictOf(build, indexReadBack({ tx: [{ id: '940669', tranid: 'ASSYB10628', type: 'Build', voided: 'T' }] })) }).reasons, ['VOIDED in NetSuite']);

// ── the other queue states ──────────────────────────────────────────────────────────────────
eq('FAILED: red — it did not go through', flagsOf(rowFromOutbox({ id: 'f', status: 'FAILED', lastError: 'INVALID_KEY_OR_REF', createdAt: NOW })).level, 'red');
eq('PENDING 3 min: still fine', flagsOf(rowFromOutbox({ id: 'p', status: 'PENDING', createdAt: NOW - 3 * 60000 }), { now: NOW }).level, 'posted');
eq('PENDING 25 min: orange — not draining', flagsOf(rowFromOutbox({ id: 'p', status: 'PENDING', attempts: 2, createdAt: NOW - 25 * 60000 }), { now: NOW }).reasons, ['still PENDING in the queue after 25 min (try 2)']);
eq('posted with no number back: orange', flagsOf(rowFromOutbox({ id: 'n', status: 'POSTED', createdAt: NOW })).level, 'orange');
eq('cancelled: nothing was sent', flagsOf(rowFromOutbox({ id: 'c', status: 'CANCELLED', createdAt: NOW })).level, 'cancelled');
eq('posted after the order was closed (not yet closed in NetSuite): orange', flagsOf(rowFromOutbox({ id: 'k', status: 'POSTED', nsId: '1', nsTran: 'WO1', postedForClosedOrder: true, createdAt: NOW })).reasons, ['posted after the order was closed in the app — close it in NetSuite']);
const wb = { collection: 'fin_workorders', docId: 'W', patch: { nsWoCompletionPosted: true }, idField: 'nsWoCompletionId', tranField: 'nsWoCompletionTran' };
eq('the write-back: landed / missing / unknown', [writeBackLanded(wb, { nsWoCompletionPosted: true, nsWoCompletionId: '1', nsWoCompletionTran: 'B1' }), writeBackLanded(wb, { nsWoCompletionPosted: true }), writeBackLanded(wb, null)], [true, false, null]);
eq('posted, the app record never got the number: orange', flagsOf(rowFromOutbox({ id: 'w', status: 'POSTED', nsId: '9', nsTran: 'B9', writeBack: wb, createdAt: NOW }), { appDoc: { packStatus: 'Packed' } }).reasons, ['posted, but the app record never got the number (write-back missing)']);

// ── expected and missing: WO11639 ───────────────────────────────────────────────────────────
const wo11639 = { id: 'WO-STK-49017-1790350164427', orderType: 'stock', nsWoId: '930292', nsWoTran: 'WO11639', stockErpId: 'HCUSR15/SG-EA', forceCompleteNsBuildSkipped: true, forceCompletedBy: 'Sandra G', nsCompletionQueued: true, packStatus: 'Packed', packedAt: NOW - 90000000, packedBy: 'Sandra G', putawayBin: 'RTS-CUS', totalParts: 440, completedParts: 192 };
const exp = expectedBuildRowOf(wo11639);
eq('WO11639: a build was expected', [exp.source, exp.page, exp.item, exp.qty, exp.ns.woTran, exp.ns.markedBuilt], ['EXPECTED', 'WMS · Put-away', 'HCUSR15/SG-EA', 192, 'WO11639', true]);
eq('…before the read-back: orange, marked built but unverified', flagsOf(exp, { now: NOW }).reasons, ['marked ALREADY BUILT at force-complete — not verified in NetSuite']);
const vExp = verifyVerdictOf(exp, idx);
eq('…read back: NetSuite has ASSYB10633 × 192 against the work order (made by hand)', vExp.text, 'built in NetSuite outside the app: ASSYB10633 ×192');
eq('…green: built, the app record just never recorded it', flagsOf(exp, { now: NOW, verify: vExp }).level, 'ok');
eq('…had NetSuite built 200: orange', flagsOf({ ...exp, qty: 200 }, { now: NOW, verify: verifyVerdictOf({ ...exp, qty: 200 }, idx) }).level, 'orange');
eq('…no build anywhere: orange, says so', flagsOf(exp, { now: NOW, verify: verifyVerdictOf(exp, indexReadBack({})) }).reasons, ['marked ALREADY BUILT at force-complete — not verified in NetSuite', 'no build in NetSuite against WO11639 either']);
eq('a posted build is not expected', expectedBuildRowOf({ ...wo11639, nsWoCompletionPosted: true }), null);
const plat = { id: 'RIU', status: 'received', itemReceiptPosted: false, qty: 35, targetErpId: 'H1-1R/EP2', nsPoTran: 'PO2344', receivedAtMs: NOW - 2 * 3600000, operator: 'Eric' };
eq('a plating return received two hours ago with no receipt: expected', [expectedReceiptRowOf(plat, { now: NOW }).item, flagsOf(expectedReceiptRowOf(plat, { now: NOW }), { now: NOW }).level], ['H1-1R/EP2', 'orange']);
eq('…10 minutes ago, or with its receipt: not yet / not at all', [expectedReceiptRowOf({ ...plat, receivedAtMs: NOW - 600000 }, { now: NOW }), expectedReceiptRowOf({ ...plat, itemReceiptPosted: true, itemReceiptId: 940884 }, { now: NOW })], [null, null]);

// ── the read-back queries ───────────────────────────────────────────────────────────────────
const tg = verifyTargetsOf([ia, build, exp, { ns: null }]);
eq('what to read back: the transactions and the work orders', tg, { txIds: ['940878', '940669'], woIds: ['930292'] });
ok('the queries name only numeric ids', txQueryOf(['940878', "1; DROP", '940669']).endsWith('IN (940878,940669)') && linesQueryOf([]) === '' && /linktype = 'OrdBuild'/.test(buildLinksQueryOf(['930292'])));
eq('item names as NetSuite writes them', [itemMatches('HCUSR15/SG-EA', 'hcusr15/sg-ea'), itemMatches('Hardware : H1-1R', 'H1-1R'), itemMatches('H1-1RX', 'H1-1R')], [true, true, false]);

// ── app events, floor punches, deletions, direct calls ──────────────────────────────────────
const hq = rowFromHqLog({ id: 'h', t: { seconds: 100 }, u: 'Vicki', app: 'HQ', tab: '11. RTG Dispatch', action: 'Released WO-OE-SO60585-7242' });
eq('an HQ log: its tab is the page', [hq.page, hq.source, flagsOf(hq).level], ['HQ · 11. RTG Dispatch', 'APP', 'info']);
eq('a WMS log with no stamp: its category says WMS', rowFromHqLog({ id: 'w', u: 'Eric', msg: 'x', cat: 'wms', t: 1 }).page, 'WMS');
const direct = rowFromHqLog({ id: 'd', t: 5, u: 'Eric', page: 'WMS · CONVERT', msg: 'NetSuite POST RESTlet (convert build) → 200', audit: { kind: 'NS_DIRECT', targetUrl: 'https://x/restlet.nl?script=2848', ok: true, nsId: '941000', httpStatus: 200 } });
eq('a direct NetSuite call is a NetSuite row', [direct.source, direct.ns.type, direct.ns.id, direct.page], ['NS_DIRECT', 'RESTlet (convert build)', '941000', 'WMS · CONVERT']);
eq('…a failed one is red', flagsOf(rowFromHqLog({ id: 'd2', t: 5, audit: { kind: 'NS_DIRECT', ok: false, httpStatus: 400 } })).level, 'red');
eq('a floor punch', [rowFromFinLog({ id: 'f', at: 9, u: 'Ana', station: 'RED', action: 'COMPLETE', task: 'spinSpray', woRefNo: 'WO11650', woId: 'W' }).page, rowFromFinLog({ id: 'f', at: 9, woId: 'W' }).appRef], ['Finishing floor · RED', { coll: 'fin_workorders', id: 'W' }]);
eq('a deletion', rowFromDeletion({ id: 'x', at: 3, by: 'Stuart', from: 'RTG', collection: 'hq_work_orders', docId: 'WO-1', reason: 'dup' }).action, 'Deleted hq_work_orders/WO-1 — dup');

// ── what the app says ───────────────────────────────────────────────────────────────────────
eq('a finishing job', appSaysOf('fin_workorders', wo11639), 'WO11639 · Packed → RTS-CUS · 192 good of 440 · build SKIPPED (marked already built) · force-completed by Sandra G');
eq('gone from the app', appSaysOf('fin_workorders', null), 'record not found in the app');
eq('not loaded yet', appSaysOf('fin_workorders', undefined), '');

// ── the view ────────────────────────────────────────────────────────────────────────────────
const rows = [ia, build, exp, hq, direct];
const lv = (r) => ({ [ia.key]: 'orange', [exp.key]: 'orange' })[r.key] || 'info';
eq('questionable only', filterRows(rows, { questionableOnly: true }, lv).map(r => r.key), [ia.key, exp.key]);
eq('NetSuite only', filterRows(rows, { nsOnly: true }, lv).length, 4);
eq('search by WO number / item / who', [filterRows(rows, { q: 'wo11639' }).length, filterRows(rows, { q: 'hcusr15' }).length, filterRows(rows, { q: 'vicki' }).length], [2, 2, 1]);
eq('page filter: "HQ" takes "HQ · 11. RTG Dispatch"', filterRows(rows, { page: 'HQ' }).map(r => r.key), [hq.key]);
eq('page groups', pageGroupsOf(rows), ['Finishing floor', 'HQ', 'WMS']);

console.log(`auditLog: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
