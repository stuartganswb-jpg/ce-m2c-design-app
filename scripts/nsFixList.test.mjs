// NetSuite to fix today (Stuart 2026-10-20).   node scripts/nsFixList.test.mjs
// The real refusals of 2026-10-10 … 10-20, worded and listed.
import { resendWriteBackOf, explainNsError, nsDetailOf, fixRowsOf, queueStateOf, directOpenOf, healRetryOf, resendPatchOf, waitingBehindOf, rewaitPatchOf, fixMarkOf, tranLookupSql, shopDayStartOf, fixChipTextOf, FIX_HOW } from '../src/components/Shared/nsFixList.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };
const NS = (detail) => `HTTP 400: {"type":"https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.1","title":"Bad Request","status":400,"o:errorDetails":[{"detail":"Error while accessing a resource. ${detail}","o:errorCode":"USER_ERROR"}]}`;

// ── the words, from the real errors ──
eq('NetSuite\'s own words, the prefix dropped', nsDetailOf(NS('Invalid binnumber reference key WANDS.')), 'Invalid binnumber reference key WANDS.');
let x = explainNsError(NS('Invalid binnumber reference key WANDS.'), { item: 'HCUMWND40' });
eq('bin: words + fix', [x.words, /set bin WANDS up for the item/.test(x.fix)], ['NetSuite has no bin WANDS for HCUMWND40', true]);
eq('bin with spaces', explainNsError(NS('Invalid binnumber reference key PRODUCTION STOCK.'), { item: 'HTFWP835' }).words, 'NetSuite has no bin PRODUCTION STOCK for HTFWP835');
x = explainNsError(NS('You have entered an Invalid Field Value 24902 for the following field: item.'), { item: 'HCUSP635/CW16' });
eq('item id', x.words, 'NetSuite will not take item #24902 (HCUSP635/CW16) — it is inactive there, or the app holds the wrong id');
eq('subsidiary', explainNsError(NS('You have entered an Invalid Field Value 6 for the following field: subsidiary.')).words, 'The customer is not in this division\'s subsidiary (#6)');
eq('only n available', explainNsError(NS('You only have 2 available. Please enter a different quantity.')).words, 'NetSuite shows only 2 there');
x = explainNsError(NS('You must enter at least one line item for this transaction.'), { kind: 'workorder', item: 'HCUSR15/N25-EA' });
eq('a WO with no BOM, and "do not make another"', [x.words, /do not make another one/.test(x.fix)], ['HCUSR15/N25-EA has no bill of materials in NetSuite', true]);
eq('no lines on another kind', explainNsError(NS('You must enter at least one line item for this transaction.'), { kind: 'salesorder' }).words, 'NetSuite received no lines');
eq('closed WO', explainNsError(NS('You have an invalid work order 917025 or the order is already closed.')).words, 'NetSuite work order #917025 is already closed');
eq('line mismatch names the record', explainNsError(NS('You have attempted an invalid sublist or line item operation. You are either trying to access a field on a non-existent line'), { type: 'Item Receipt' }).words, 'The lines no longer match the NetSuite item receipt');
eq('no bins on the item', explainNsError(NS('You cannot create an inventory detail for this item.')).words, 'NetSuite does not keep bins for that item');
eq('bins add up wrong', explainNsError(NS('The total inventory detail quantity must be 2.')).words, 'The bins add up to a different quantity than the line (NetSuite wants 2)');
eq('the app\'s own mistake is said', explainNsError(NS('You still need to reconfigure the inventory detail record after changing the quantity.')).words, 'The app sent the bin detail in a shape NetSuite refuses (the app\'s mistake)');
eq('class subsidiaries', explainNsError(NS('The subsidiary restrictions on this record are incompatible with those defined for class: Component.')).words, 'The item\'s subsidiaries do not match its class\'s');
eq('waiting behind a refusal', explainNsError('Not sent: the entry it follows (abc) is FAILED — Receipt — POM2C-1619. Fix that first, then retry this one.').words, 'It waits on another write NetSuite refused');
eq('NetSuite did not answer', explainNsError('HTTP 503: {"error":"unavailable"}').fix, '↻ Re-send — nothing in the record is wrong.');
x = explainNsError(NS('Something nobody has seen yet.'));
eq('unknown: NetSuite\'s own words', [x.words, /put the record right in NetSuite/.test(x.fix)], ['Something nobody has seen yet.', true]);

// ── state ──
const now = Date.UTC(2026, 9, 20, 17, 0);          // 1 pm in High Point
const min = 60000, day = 86400000;
eq('refused, not dealt with', queueStateOf({ status: 'FAILED' }, { now }), 'REFUSED');
eq('refused, dealt with', queueStateOf({ status: 'FAILED', fix: { how: 'NOT_NEEDED' } }, { now }), '');
eq('posted', queueStateOf({ status: 'POSTED' }, { now }), '');
eq('cancelled', queueStateOf({ status: 'CANCELLED' }, { now }), '');
eq('pending, first try, an hour old — the drain will take it', queueStateOf({ status: 'PENDING', attempts: 0, createdAt: now - 60 * min }, { now }), '');
eq('pending, retrying for an hour', queueStateOf({ status: 'PENDING', attempts: 3, createdAt: now - 60 * min }, { now }), 'STUCK');
eq('retrying ten minutes — not yet', queueStateOf({ status: 'PENDING', attempts: 2, createdAt: now - 10 * min }, { now }), '');
eq('waiting 40 min', queueStateOf({ status: 'WAITING', createdAt: now - 40 * min }, { now }), 'STUCK');
eq('processing, lease 12 min old', queueStateOf({ status: 'PROCESSING', leasedAt: now - 12 * min, createdAt: now - 12 * min }, { now }), 'STUCK');
ok('a failed direct call is open', directOpenOf({ audit: { kind: 'NS_DIRECT', ok: false } }));
ok('…until dealt with', !directOpenOf({ audit: { kind: 'NS_DIRECT', ok: false }, nsFix: { how: 'DONE_IN_NS' } }));
ok('a good direct call is not', !directOpenOf({ audit: { kind: 'NS_DIRECT', ok: true } }));
ok('an app log line is not', !directOpenOf({ msg: 'x' }));

// ── the shop day ──
const ds = shopDayStartOf(now);
eq('the day starts at midnight in High Point (EDT, UTC-4)', new Date(ds).toISOString(), '2026-10-20T04:00:00.000Z');

// ── the rows ──
const outbox = [
    { id: 'a1', status: 'FAILED', kind: 'workorder', label: 'NS WO — build HCUSR15/N25-EA ×120', createdBy: 'Eric', page: 'HQ · 13. RTG Dispatch', createdAt: now - 1 * day, failedAt: now - 1 * day + 30000, lastError: NS('You must enter at least one line item for this transaction.'), targetUrl: 'https://x/services/rest/record/v1/workorder' },
    { id: 'a2', status: 'FAILED', kind: 'inventoryadjustment', label: 'JFP pull −5 × HCUMWND40 (WO-JFP-HCUMWND40-N25-383887)', createdBy: 'Rueben', createdAt: now - 8 * day, failedAt: now - 8 * day, lastError: NS('Invalid binnumber reference key WANDS.'), targetUrl: 'https://x/services/rest/record/v1/inventoryadjustment' },
    { id: 'a3', status: 'FAILED', kind: 'itemreceipt', label: 'Receipt — POM2C-1619 (21 pcs → RTS-M2C-008)', createdBy: 'Mark', createdAt: now - 20 * day, failedAt: now - 20 * day, lastError: NS('You have attempted an invalid sublist or line item operation.'), targetUrl: 'https://x/services/rest/record/v1/purchaseorder/855919/!transform/itemreceipt' },
    { id: 'a4', status: 'FAILED', kind: 'salesorder', label: 'Quick Ship SO · Baker Stone Studio · 4 line(s)', createdBy: 'stuart', createdAt: now - 3 * day, failedAt: now - 3 * day, lastError: NS('You have entered an Invalid Field Value 6 for the following field: subsidiary.'), fix: { how: 'NOT_NEEDED', by: 'Eric' } },
    { id: 'a5', status: 'FAILED', kind: 'itemfulfillment', label: 'NS Fulfillment — WO-SO60838', createdBy: 'Eric', createdAt: now - 2 * 60 * min, failedAt: now - 2 * 60 * min, lastError: NS('The total inventory detail quantity must be 2.') },
    { id: 'a6', status: 'POSTED', kind: 'itemfulfillment', label: 'NS Fulfillment — WO-SO60838', createdAt: now - 60 * min, postedAt: now - 59 * min, nsTran: 'IF74315' },
    { id: 'a7', status: 'PENDING', kind: 'workordercompletion', label: 'Build NS WO WO11700', attempts: 4, createdAt: now - 50 * min, lastError: 'HTTP 503: {}' },
    { id: 'a8', status: 'PENDING', kind: 'bintransfer', label: 'move', attempts: 0, createdAt: now - 2 * min },
];
const logs = [
    { id: 'h1', u: 'Sandra G', page: 'WMS · ROD CUTS', t: { seconds: Math.floor((now - 8 * day) / 1000) }, msg: 'NetSuite POST record/v1/inventoryadjustment → FAILED (HTTP 400) — Rod cut by Sandra G: 10 × HTA1235 → 10 × HTA1272', audit: { kind: 'NS_DIRECT', ok: false, recordKind: 'inventoryadjustment', error: 'Error while accessing a resource. Invalid binnumber reference key RTS-CUS.' } },
    { id: 'h2', u: 'Sandra G', page: 'WMS · ROD CUTS', t: { seconds: Math.floor((now - 8 * day + 7 * 3600000) / 1000) }, msg: 'NetSuite POST record/v1/inventoryadjustment → OK — Rod cut by Sandra G: 10 × HTA1235 → 10 × HTA1272', audit: { kind: 'NS_DIRECT', ok: true, recordKind: 'inventoryadjustment' } },
    { id: 'h3', u: 'stuart', page: 'HQ · 6.5 Tools', t: { seconds: Math.floor((now - 5 * day) / 1000) }, msg: 'NetSuite POST record/v1/nonInventoryResaleItem → FAILED (HTTP 400)', audit: { kind: 'NS_DIRECT', ok: false, recordKind: 'nonInventoryResaleItem', error: 'The subsidiary restrictions on this record are incompatible with those defined for class: Component.' }, nsFix: { how: 'NOT_NEEDED' } },
];
const { rows, earlier, counts } = fixRowsOf({ outbox, directLogs: logs, now });
eq('open rows: the WO, the JFP pull, the fulfilment, the stuck build, the rod cut', rows.map(r => r.key).sort(), ['hl:h1', 'ob:a1', 'ob:a2', 'ob:a5', 'ob:a7'].sort());
eq('dealt-with and live entries are not listed', ['ob:a4', 'ob:a6', 'ob:a8', 'hl:h2', 'hl:h3'].every(k => !rows.some(r => r.key === k)), true);
eq('older than the window: counted, not listed', [earlier.map(r => r.key), counts.earlier], [['ob:a3'], 1]);
eq('carried over first, oldest first; then today', rows.map(r => r.key), ['ob:a2', 'hl:h1', 'ob:a1', 'ob:a5', 'ob:a7']);
eq('counts', counts, { open: 5, carried: 3, today: 2, refused: 4, stuck: 1, earlier: 1 });
const wo = rows.find(r => r.key === 'ob:a1');
eq('the WO row in words', [wo.who, wo.type, wo.item, wo.qty, wo.words, wo.canResend, wo.carried], ['Eric', 'Work Order', 'HCUSR15/N25-EA', 120, 'HCUSR15/N25-EA has no bill of materials in NetSuite', true, true]);
const cut = rows.find(r => r.key === 'hl:h1');
eq('a direct rod cut: words, no re-send, the later success hinted', [cut.source, cut.words, cut.canResend, !!cut.laterHint, cut.laterHint && cut.laterHint.who], ['DIRECT', 'NetSuite has no bin RTS-CUS for HTA1235', false, true, 'Sandra G']);
const ful = rows.find(r => r.key === 'ob:a5');
eq('a refusal NetSuite took later under the same label is hinted', ful.laterHint && ful.laterHint.ref, 'IF74315');
const stuck = rows.find(r => r.key === 'ob:a7');
eq('stuck: did not answer, re-send not offered (it is still trying)', [stuck.state, stuck.words, stuck.canResend], ['STUCK', 'NetSuite did not answer', false]);

// ── the chip ──
eq('chip', fixChipTextOf(counts), 'NetSuite: 5 to fix · 3 from before today');
eq('chip when clear', fixChipTextOf({ open: 0 }), 'NetSuite ✓');

// ── re-send and the repairs ──
eq('workorder item → assemblyItem', healRetryOf({ kind: 'workorder', payload: { item: { id: '1' } } }).payload, { assemblyItem: { id: '1' } });
eq('build: one bin of a joined list', healRetryOf({ kind: 'workordercompletion', payload: { inventoryDetail: { quantity: 5, inventoryAssignment: { items: [{ binNumber: { refName: 'rts-cus, b-2' } }] } } } }).payload.inventoryDetail.inventoryAssignment.items[0].binNumber.refName, 'RTS-CUS');
eq('build: UNASSIGNED bin dropped', healRetryOf({ kind: 'workordercompletion', payload: { inventoryDetail: { quantity: 5, inventoryAssignment: { items: [{ binNumber: { refName: 'UNASSIGNED' } }] } } } }).payload, {});
eq('build transform flipped to assemblyBuild', healRetryOf({ kind: 'workordercompletion', targetUrl: 'u/workorder/9/!transform/workordercompletion' }).targetUrl, 'u/workorder/9/!transform/assemblyBuild');
const rp = resendPatchOf(outbox[0], { by: 'Eric', now });
eq('re-send: pending now, attempts kept, last words kept, the mark cleared', [rp.status, 'attempts' in rp, rp.lastError, /at least one line/.test(rp.lastErrorBefore), rp.requeuedBy, rp.fix], ['PENDING', false, null, true, 'Eric', null]);
eq('re-send does not change the original entry', outbox[0].status, 'FAILED');
const child = { id: 'c1', afterId: 'a3', status: 'FAILED', lastError: 'Not sent: the entry it follows (a3) is FAILED — Receipt' };
eq('the bin move behind a receipt goes back to waiting with it', waitingBehindOf(outbox[2], [child, { id: 'c2', afterId: 'a3', status: 'FAILED', lastError: 'its own refusal' }]).map(c => c.id), ['c1']);
eq('…as WAITING', rewaitPatchOf({ by: 'Eric', now }).status, 'WAITING');
eq('a mark', fixMarkOf({ how: FIX_HOW.DONE_IN_NS, by: 'Eric', why: ' built by hand ', nsRef: { id: '9', tranid: 'ASSYB1' }, now }), { how: 'DONE_IN_NS', by: 'Eric', why: 'built by hand', nsRef: { id: '9', tranid: 'ASSYB1' }, at: now });
eq('lookup by number', tranLookupSql(' ia27606 '), "SELECT id, tranid, type, BUILTIN.DF(status) AS st, trandate FROM transaction WHERE UPPER(tranid) = 'IA27606'");
ok('lookup by internal id also tries it as a number', /WHERE id = 917025 OR UPPER\(tranid\) = '917025'/.test(tranLookupSql('917025')));
eq('lookup cannot be injected', tranLookupSql("x'; DROP"), "SELECT id, tranid, type, BUILTIN.DF(status) AS st, trandate FROM transaction WHERE UPPER(tranid) = 'XDROP'");
eq('nothing typed → no lookup', tranLookupSql('  '), '');

// ── a re-sent write never rolls a record back ──
const qsSo = { id: 's1', kind: 'salesorder', writeBack: [{ collection: 'hq_sales_orders', docId: 'QS-1', idField: 'nsInternalId', tranField: 'soId', patch: { status: 'Pending' } }] };
eq('still waiting on NetSuite → the status rides', resendWriteBackOf(qsSo, () => ({ status: 'NS_QUEUED' }))[0].patch, { status: 'Pending' });
const moved = resendWriteBackOf(qsSo, () => ({ status: 'Picked' }))[0];
eq('picked while refused → the status is dropped, the ids still stamp', [moved.patch, moved.idField, moved.tranField, moved.statusKept], [{}, 'nsInternalId', 'soId', 'Picked']);
eq('unread record → as it was', resendWriteBackOf(qsSo, () => undefined)[0].patch, { status: 'Pending' });
eq('a patch with no status is left alone', resendWriteBackOf({ writeBack: [{ collection: 'jobs', docId: 'J', patch: { dateTransmitted: 'x' } }] }, () => ({ status: 'Approved' }))[0].patch, { dateTransmitted: 'x' });
eq('a single spec stays a single spec', resendWriteBackOf({ writeBack: { collection: 'hq_purchase_orders', docId: 'P', patch: { status: 'PUSHED' } } }, () => ({ status: 'RECEIVED' })).patch, {});
eq('no writeBack → null', resendWriteBackOf({ writeBack: null }), null);
eq('the re-send carries it', resendPatchOf(qsSo, { by: 'Eric', now: 1, writeBack: [moved] }).writeBack, [moved]);
ok('…and leaves it alone when not given', !('writeBack' in resendPatchOf(qsSo, { by: 'Eric', now: 1 })));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
