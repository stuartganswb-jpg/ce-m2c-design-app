// NetSuite to fix today — the queue's side (functions/nsFix.js), and its twin rule held to the app's list.
//   node scripts/nsFixServer.test.mjs
import { createRequire } from 'module';
import { fixRowsOf } from '../src/components/Shared/nsFixList.js';
const require = createRequire(import.meta.url);
const S = require('../functions/nsFix.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };
const NS = (detail) => `HTTP 400: {"o:errorDetails":[{"detail":"Error while accessing a resource. ${detail}","o:errorCode":"USER_ERROR"}]}`;

// ── the records a write is for, and the field ──
const so = { id: 'o1', kind: 'salesorder', label: 'Quick Ship SO · Baker Stone', writeBack: [{ collection: 'hq_sales_orders', docId: 'QS-1', idField: 'nsInternalId' }] };
eq('targets from an array', S.writeBackTargetsOf(so), [{ collection: 'hq_sales_orders', docId: 'QS-1' }]);
eq('targets from one spec', S.writeBackTargetsOf({ writeBack: { collection: 'fin_workorders', docId: 'W1' } }), [{ collection: 'fin_workorders', docId: 'W1' }]);
eq('no writeBack → nothing told', S.writeBackTargetsOf({ writeBack: null }), []);
eq('a half spec is skipped', S.writeBackTargetsOf({ writeBack: [{ collection: 'x' }] }), []);
eq('field-safe kind', [S.refusedKeyOf('salesorder'), S.refusedKeyOf('itemfulfillment-ship'), S.refusedKeyOf('')], ['salesorder', 'itemfulfillment_ship', 'write']);
eq('the mark', S.refusalMarkOf(so, NS('You have entered an Invalid Field Value 6 for the following field: subsidiary.'), 5), { at: 5, outboxId: 'o1', kind: 'salesorder', label: 'Quick Ship SO · Baker Stone', error: 'You have entered an Invalid Field Value 6 for the following field: subsidiary.' });

// ── a later post settles an earlier refusal ──
const failedSo = { ...so, status: 'FAILED', createdAt: 1 };
ok('same kind, same record → settled', S.settles({ ...so, id: 'o2', createdAt: 9 }, failedSo));
ok('same dedupe key → settled', S.settles({ id: 'p', kind: 'workorder', dedupeKey: 'wo:hq_work_orders:A', createdAt: 9 }, { id: 'f', kind: 'workorder', dedupeKey: 'wo:hq_work_orders:A', status: 'FAILED', createdAt: 1 }));
ok('another record → not settled (Baker Stone re-entered on a new order stays for Eric)', !S.settles({ id: 'o3', kind: 'salesorder', writeBack: [{ collection: 'hq_sales_orders', docId: 'QS-2' }], createdAt: 9 }, failedSo));
ok('another kind → not settled', !S.settles({ ...so, id: 'o4', kind: 'estimate', createdAt: 9 }, failedSo));
ok('already dealt with → left as it is', !S.settles({ ...so, id: 'o5', createdAt: 9 }, { ...failedSo, fix: { how: 'NOT_NEEDED' } }));
ok('itself → no', !S.settles(failedSo, failedSo));
ok('a refusal made AFTER the post is not settled by it', !S.settles({ ...so, id: 'o6', createdAt: 1 }, { ...failedSo, id: 'o7', createdAt: 9 }));
ok('four separate runs of one item are four separate things', !S.settles({ id: 'w2', kind: 'workorder', dedupeKey: 'wo:hq_work_orders:B', writeBack: [{ collection: 'hq_work_orders', docId: 'B' }], createdAt: 9 }, { id: 'w1', kind: 'workorder', dedupeKey: 'wo:hq_work_orders:A', writeBack: [{ collection: 'hq_work_orders', docId: 'A' }], status: 'FAILED', createdAt: 1 }));

// ── the twin rule: the same records, the same open rows as the app's list ──
const now = Date.UTC(2026, 9, 20, 19, 0);   // 3 pm in High Point
const min = 60000, day = 86400000;
const entries = [
    { id: 'a1', status: 'FAILED', kind: 'workorder', label: 'NS WO — build HCUSR15/N25-EA ×120', createdBy: 'Eric', createdAt: now - day, failedAt: now - day, lastError: NS('You must enter at least one line item for this transaction.') },
    { id: 'a2', status: 'FAILED', kind: 'inventoryadjustment', label: 'JFP pull −5 × HCUMWND40', createdBy: 'Rueben', createdAt: now - 8 * day, failedAt: now - 8 * day, lastError: NS('Invalid binnumber reference key WANDS.') },
    { id: 'a3', status: 'FAILED', kind: 'itemreceipt', label: 'Receipt — POM2C-1619', createdAt: now - 20 * day, failedAt: now - 20 * day, lastError: 'x' },
    { id: 'a4', status: 'FAILED', kind: 'salesorder', label: 'Quick Ship SO', createdAt: now - 3 * day, fix: { how: 'NOT_NEEDED' } },
    { id: 'a5', status: 'FAILED', kind: 'itemfulfillment', label: 'NS Fulfillment — WO-SO60838', createdBy: 'Eric', createdAt: now - 2 * 60 * min, failedAt: now - 2 * 60 * min, lastError: NS('The total inventory detail quantity must be 2.') },
    { id: 'a6', status: 'POSTED', kind: 'itemfulfillment', createdAt: now - 60 * min },
    { id: 'a7', status: 'PENDING', kind: 'workordercompletion', label: 'Build NS WO WO11700', attempts: 4, createdAt: now - 50 * min },
    { id: 'a8', status: 'WAITING', kind: 'bintransfer', label: 'move', createdAt: now - 5 * min },
    { id: 'a9', status: 'PROCESSING', kind: 'salesorder', label: 'SO', createdAt: now - 20 * min, leasedAt: now - 15 * min },
];
const logs = [
    { id: 'h1', u: 'Sandra G', t: { seconds: Math.floor((now - 8 * day) / 1000) }, msg: 'NetSuite POST … → FAILED (HTTP 400) — Rod cut by Sandra G: 10 × HTA1235', audit: { kind: 'NS_DIRECT', ok: false, error: 'Error while accessing a resource. Invalid binnumber reference key RTS-CUS.' } },
    { id: 'h2', u: 'Eric', t: { seconds: Math.floor((now - 3 * 60 * min) / 1000) }, msg: 'NetSuite POST … → FAILED (HTTP 400) — Cycle count by Eric', audit: { kind: 'NS_DIRECT', ok: false, error: 'reconfigure the inventory detail record' } },
    { id: 'h3', u: 'x', t: { seconds: Math.floor((now - 30 * day) / 1000) }, msg: 'old', audit: { kind: 'NS_DIRECT', ok: false } },
    { id: 'h4', u: 'x', t: { seconds: Math.floor((now - day) / 1000) }, msg: 'done', audit: { kind: 'NS_DIRECT', ok: false }, nsFix: { how: 'DONE_IN_NS' } },
];
const app = fixRowsOf({ outbox: entries, directLogs: logs, now });
const srv = S.openOf({ entries, logs, now });
eq('the server lists exactly the app\'s rows, in the same order', srv.rows.map(r => r.key), app.rows.map(r => r.key));
eq('…and counts the same', [srv.counts.open, srv.counts.carried], [app.counts.open, app.counts.carried]);
eq('what it lists', srv.rows.map(r => r.key), ['ob:a2', 'hl:h1', 'ob:a1', 'hl:h2', 'ob:a5', 'ob:a7', 'ob:a9']);
eq('the shop day agrees', S.shopDayStartOf(now), new Date('2026-10-20T04:00:00Z').getTime());

// ── the 3 pm note ──
const note = S.digestOf({ entries, logs, now });
ok('names Eric and the count', /^🧾 Eric — NetSuite: 7 still to fix today \(3 from before today\)/.test(note), note);
ok('a line in NetSuite\'s words', note.includes('• NS WO — build HCUSR15/N25-EA ×120 (Eric) — You must enter at least one line item for this transaction.'), note);
ok('a stuck write says so', note.includes('• Build NS WO WO11700 — not through yet — still trying'));
ok('a direct call by its action', note.includes('• Rod cut by Sandra G: 10 × HTA1235 (Sandra G) — Invalid binnumber reference key RTS-CUS.'));
eq('nothing owed → no note', S.digestOf({ entries: [{ id: 'z', status: 'POSTED' }], logs: [], now }), '');
const many = Array.from({ length: 11 }, (_, i) => ({ id: `m${i}`, status: 'FAILED', kind: 'x', label: `L${i}`, createdAt: now - min, lastError: 'e' }));
eq('a long list is cut with a count', S.digestOf({ entries: many, logs: [], now }).split('\n').slice(-1)[0], '…and 3 more');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
