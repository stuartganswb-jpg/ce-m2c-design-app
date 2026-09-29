// Who NetSuite holds the stock for — the WMS reads it before it takes stock (commitments A, Stuart 2026-09-30).
//   node scripts/stockHolds.test.mjs
import { holdsSql, holdsOf, ownRefsOf, holdsView, holdNote, holdSummary, heldByRef, HOLDS_PAGE } from '../src/components/Shared/stockHolds.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the query ───────────────────────────────────────────────────────────────────────────────
const sql = holdsSql(['hcusr1', "H1-138CC/P"], 17);
ok('reads commitments by item and transaction at the location', /tl\.quantitycommitted <> 0/.test(sql) && /tl\.location = 17/.test(sql) && /'HCUSR1','H1-138CC\/P'/.test(sql));
let threw = false; try { holdsSql(['X'], '17; DROP'); } catch (e) { threw = true; }
ok('a location that is not an id is refused', threw);
eq('no codes, no query', holdsSql([], 17), '');

// ── the live rows of 2026-09-30 @ loc 17 ────────────────────────────────────────────────────
const rows = [
    { itemid: 'H1-138CC/P', tid: 918825, tranid: 'SO60551', ttype: 'SalesOrd', held: 50 },
    { itemid: 'HCUSR1', tid: 903648, tranid: 'SO60161', ttype: 'SalesOrd', held: 16 },
    { itemid: 'HCUSR1', tid: 928088, tranid: 'SO60676', ttype: 'SalesOrd', held: 88 },
    { itemid: 'HCUSR1', tid: 931628, tranid: 'WO11652', ttype: 'WorkOrd', held: 300 },
];
const map = holdsOf(rows, ['HCUSR1', 'H1-138CC/P', 'CR58X316']);
eq('committed = the sum of the holds (NetSuite read 404)', map.HCUSR1.committed, 404);
eq('holds biggest first', map.HCUSR1.holds.map(h => h.tran), ['WO11652', 'SO60676', 'SO60161']);
eq('an item nothing holds reads zero, known', map.CR58X316, { committed: 0, holds: [] });
ok('a full page may be cut off → unknown', holdsOf(new Array(HOLDS_PAGE).fill(rows[0])) === null);

// ── one item seen from one job ──────────────────────────────────────────────────────────────
// SO60676's pick: 404 on hand, all 404 committed — 88 of them to SO60676 itself.
const own676 = ownRefsOf({ salesOrderId: 'SO60676', orderKey: 'SO60676' });
let v = holdsView(404, map.HCUSR1, own676);
eq('its own 88 are its own; 316 are held for others; 88 free', [v.ownHeld, v.othersHeld, v.free], [88, 316, 88]);
eq('picking its 88 warns nothing', holdNote('HCUSR1', 88, v), null);
ok('picking 100 warns, naming who holds the rest', /NetSuite holds 316 of the 404 × HCUSR1 here for WO11652 \(300\), SO60161 \(16\) — 88 free for this job\. Taking 100 uses 12 of theirs\./.test(holdNote('HCUSR1', 100, v) || ''));
// another order with no hold of its own: every piece belongs to someone
v = holdsView(404, map.HCUSR1, ownRefsOf({ salesOrderId: 'SO60999' }));
eq('a job with no hold: nothing free', [v.ownHeld, v.othersHeld, v.free], [0, 404, 0]);
ok('…so any need warns', /0 free for this job\. Taking 20 uses 20 of theirs\./.test(holdNote('HCUSR1', 20, v) || ''));
// the work order's own components count as its own — by number or internal id
v = holdsView(404, map.HCUSR1, ownRefsOf({ nsWoTran: 'WO11652' }));
eq('a work order\'s own component hold is its own', [v.ownHeld, v.free], [300, 300]);
eq('…by internal id too', holdsView(404, map.HCUSR1, ownRefsOf({ nsWoId: '931628' })).ownHeld, 300);
// a physically short line: the warning never claims more than is on the shelf
v = holdsView(30, { committed: 50, holds: [{ tid: '1', tran: 'SO1', qty: 50 }] }, new Set());
ok('short on the shelf: uses only what is there', /Taking 60 uses 30 of theirs/.test(holdNote('X', 60, v) || ''));
// nothing committed → nothing said
v = holdsView(101, map.CR58X316, new Set());
eq('nothing held, nothing said', [holdNote('CR58X316', 500, v), holdSummary(v)], [null, '']);
eq('no read, no view', holdsView(10, null, new Set()), null);

// ── the one-line summary, and holds by order for the arrival alert ──────────────────────────
eq('summary from the order that holds some', holdSummary(holdsView(404, map.HCUSR1, own676)), '404 on hand · 316 held for others · 88 held for this job · 88 free');
const byRef = heldByRef(map.HCUSR1);
eq('held by SO number and by internal id', [byRef.SO60676, byRef['928088'], byRef.WO11652], [88, 88, 300]);
eq('ownRefsOf ignores blanks and N/A', [...ownRefsOf({ soNum: 'N/A', woNum: '', salesOrderId: 'so60676' })], ['SO60676']);

console.log(`stockHolds: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
