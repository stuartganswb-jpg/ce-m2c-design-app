// A second run of the same thing is asked about first (Stuart 2026-10-20).   node scripts/openRuns.test.mjs
import { openRunsOf, isOpenRun, runItemOf, openRunLineOf, openRunsQuestionOf } from '../src/components/Shared/openRuns.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };

// The four HCUSR15/N25-EA runs of 2026-10-19 (8:15, 8:15, 8:27, 8:28 in High Point), each WO refused.
const t = (h, m) => Date.UTC(2026, 9, 19, h, m);
const refused = { workorder: { at: t(12, 36), error: 'You must enter at least one line item for this transaction.' } };
const runs = [
    { id: 'WO-STK-62102-1792412137349', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(12, 15), createdBy: 'Eric', status: 'Dispatched', floorPhase: 'Setup', nsWoQueued: true, nsRefused: refused },
    { id: 'WO-STK-62102-1792412151547', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(12, 15) + 14000, createdBy: 'Eric', status: 'Dispatched', floorPhase: 'Setup', nsWoQueued: true },
    { id: 'WO-STK-62102-1792412830469', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(12, 27), createdBy: 'Eric', status: 'Approved' },
    { id: 'WO-STK-OLD', itemCode: 'HCUSR15/N25-EA', qty: 60, createdAt: t(12, 0) - 30 * 86400000, createdBy: 'Eric', status: 'Dispatched' },
    { id: 'WO-STK-DONE', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(11, 0), status: 'Dispatched', floorPhase: 'Shelved' },
    { id: 'WO-STK-CLOSED', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(11, 0), status: 'Closed' },
    { id: 'WO-STK-PACKED', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(11, 0), packStatus: 'Packed' },
    { id: 'WO-STK-GONE', itemCode: 'HCUSR15/N25-EA', qty: 120, createdAt: t(11, 0), deleted: true },
    { id: 'WO-STK-OTHER', itemCode: 'HCUSR15/SG-EA', qty: 120, createdAt: t(12, 20), status: 'Dispatched' },
];
const now = t(12, 28);
const open = openRunsOf(runs, { erp: 'hcusr15/n25-ea', now });
eq('the open runs of the item this week, newest first', open.map(r => r.id), ['WO-STK-62102-1792412830469', 'WO-STK-62102-1792412151547', 'WO-STK-62102-1792412137349']);
ok('closed / put away / packed / deleted are not open', ['WO-STK-DONE', 'WO-STK-CLOSED', 'WO-STK-PACKED', 'WO-STK-GONE'].every(id => !isOpenRun(runs.find(r => r.id === id))));
ok('another finish is another item', !open.some(r => r.id === 'WO-STK-OTHER'));
ok('a month-old run is not asked about', !open.some(r => r.id === 'WO-STK-OLD'));
eq('no item → nothing', openRunsOf(runs, { erp: '', now }), []);
eq('the item, from whichever field the record carries', [runItemOf({ itemCode: 'a' }), runItemOf({ erpId: 'b' }), runItemOf({ partErpId: 'c' }), runItemOf({ stockErpId: 'd' })], ['A', 'B', 'C', 'D']);

eq('a run in words — refused WO', openRunLineOf(runs[0]), '120 pcs · Oct 19, 8:15 AM by Eric · on the floor (Setup) · ⛔ NetSuite refused its work order — it is on the NetSuite-to-fix list');
eq('a run in words — WO queued', openRunLineOf(runs[1]), '120 pcs · Oct 19, 8:15 AM by Eric · on the floor (Setup) · NetSuite WO queued');
eq('a run in words — parked', openRunLineOf(runs[2]), '120 pcs · Oct 19, 8:27 AM by Eric · parked in RTG');
eq('a run in words — in NetSuite', openRunLineOf({ qty: 70, createdAt: t(12, 0), floorPhase: 'Complete', nsWoTran: 'WO11579' }), '70 pcs · Oct 19, 8:00 AM · on the floor (Complete) · NetSuite WO11579');

const q = openRunsQuestionOf({ erp: 'HCUSR15/N25-EA', qty: 120, runs: open });
ok('the question names the item and how many are open', q.startsWith('HCUSR15/N25-EA already has 3 open runs:'), q);
ok('…lists each with its id', open.every(r => q.includes(`• ${r.id} — `)));
ok('…asks about ANOTHER of the quantity', q.includes('Make ANOTHER run of 120 anyway?'));
ok('…and says a refused run is put right, not made again', /not made again/.test(q));
const many = Array.from({ length: 8 }, (_, i) => ({ id: `R${i}`, qty: 1, createdAt: now }));
ok('a long list is cut with a count', openRunsQuestionOf({ erp: 'X', qty: 1, runs: many }).includes('…and 2 more'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
