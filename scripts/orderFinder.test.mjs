// node scripts/orderFinder.test.mjs — the order finder's rules, offline.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

// The module is app source (ESM, no JSX) — load it by rewriting the export keywords away.
const src = readFileSync(new URL('../src/components/Shared/orderFinder.js', import.meta.url), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const { findOrders, isOrderJob, numbersOf } = mod;

let n = 0;
const ok = (cond, what) => { assert.ok(cond, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };

// The two record types keep time differently — a CPQ job carries a Firestore timestamp (SECONDS),
// an Order Entry order carries epoch MILLISECONDS. Both fixtures are the real shape, one minute
// apart, so "newest first" is actually being tested rather than the units.
const job = (over) => ({ id: 'J1', status: 'APPROVED', customer: { id: 'CUST-9', name: 'Fabricut' }, createdAt: { seconds: 1700000000 }, ...over });
const oe = (over) => ({ id: 'SO-OE-1', soId: 'SO-OE-1', status: 'Pending', customerId: 'CUST-9', customer: 'Fabricut', createdAt: 1700000060000, ...over });

// ── which jobs are orders at all ──────────────────────────────────────────────
ok(isOrderJob(job({ status: 'APPROVED' })), 'approved is an order');
ok(isOrderJob(job({ status: 'IN_PRODUCTION' })), 'in production is an order');
ok(isOrderJob(job({ status: 'SO_CONFIRMED' })), 'SO confirmed is an order');
ok(!isOrderJob(job({ status: 'PENDING_REVIEW' })), 'a quote is not an order');
ok(isOrderJob(job({ status: 'PENDING_REVIEW', netsuiteSalesOrderId: '77' })), 'NetSuite having it makes it an order whatever the status says');

// ── a number is a number however it is typed ──────────────────────────────────
const jobs = [job({ netsuiteSalesOrderNo: 'SO12345' })];
for (const typed of ['SO12345', 'so12345', 'SO 12345', 'so-12345', '12345', ' 12345 ']) {
    eq(findOrders({ jobs, term: typed }).matches.length, 1, `finds it typed as "${typed}"`);
}
eq(findOrders({ jobs, term: '99999' }).matches.length, 0, 'a number that is not there finds nothing');

// ── a short term never sweeps the whole book ──────────────────────────────────
eq(findOrders({ jobs, term: '1' }).matches.length, 0, 'one character is not a search');
eq(findOrders({ jobs, term: '' }).matches.length, 0, 'an empty box searches nothing');

// ── every number an order answers to ──────────────────────────────────────────
const many = job({ netsuiteSalesOrderNo: 'SO500', soNum: 'SO-APP-Q9', quoteNo: 'Q9', jobId: 'JOB-9' });
for (const typed of ['SO500', 'SOAPPQ9', 'Q9', 'JOB-9']) {
    eq(findOrders({ jobs: [many], term: typed }).matches.length, 1, `matches on ${typed}`);
}
ok(numbersOf({ kind: 'CPQ', raw: many }).includes('SO500'), 'the NetSuite number is one of its numbers');
ok(!numbersOf({ kind: 'CPQ', raw: job({}) }).includes(''), 'a field with no value is not a number');

// ── both record types answer the same search ──────────────────────────────────
const both = findOrders({ jobs: [job({ netsuiteSalesOrderNo: 'SO777' })], oeOrders: [oe({ soId: 'SO777-OE' })], term: 'SO777' });
eq(both.matches.length, 2, 'a CPQ order and an Order Entry order both answer');
eq(both.matches.map((m) => m.kind).sort(), ['CPQ', 'OE'], 'and each says which kind it is');
eq(both.matches[0].kind, 'OE', 'newest first — the Order Entry one was created later');

// ── open vs closed ────────────────────────────────────────────────────────────
const closed = { jobs: [job({ netsuiteSalesOrderNo: 'SO1', status: 'COMPLETED' })], term: 'SO1' };
eq(findOrders(closed).matches.length, 0, 'a completed order is not open');
eq(findOrders(closed).closedCount, 1, 'but the count says one exists, so the screen can say so');
eq(findOrders({ ...closed, openOnly: false }).matches.length, 1, 'and asking for it shows it');
eq(findOrders({ jobs: [job({ netsuiteSalesOrderNo: 'SO1', deleted: true })], term: 'SO1' }).matches.length, 0, 'a deleted job is never open');
for (const st of ['Closed', 'Shipped', 'Cancelled']) {
    eq(findOrders({ oeOrders: [oe({ soId: 'SO-OE-1', status: st })], term: 'SO-OE-1' }).matches.length, 0, `an Order Entry order that is ${st} is not open`);
}
eq(findOrders({ oeOrders: [oe({ packStatus: 'Packed' })], term: 'SO-OE-1' }).matches.length, 1, 'packed but not shipped is still open — it is on the floor');

// ── what the caller needs to open the card ────────────────────────────────────
const m = findOrders({ jobs: [job({ netsuiteSalesOrderNo: 'SO42', jobName: 'Lobby rods', poNumber: 'PO-8' })], term: 'SO42' }).matches[0];
eq(m.customerId, 'CUST-9', 'it carries whose card to open');
eq(m.customerName, 'Fabricut', 'and the name to show');
eq(m.soNumber, 'SO42', 'and the SO number');
eq(m.jobName, 'Lobby rods', 'and enough to recognise it');
eq(m.poNumber, 'PO-8', 'including the customer PO');
const nsOnly = findOrders({ jobs: [job({ netsuiteSalesOrderId: '881' })], term: '881' }).matches[0];
eq(nsOnly.soNumber, 'NetSuite #881', 'an order known only by internal id still names itself');

// ── the cap ───────────────────────────────────────────────────────────────────
const lots = Array.from({ length: 40 }, (_, i) => job({ id: `J${i}`, netsuiteSalesOrderNo: `SO90${i}` }));
eq(findOrders({ jobs: lots, term: 'SO90' }).matches.length, 25, 'the list is capped');
eq(findOrders({ jobs: lots, term: 'SO90', limit: 5 }).matches.length, 5, 'and the cap is the callers to set');

console.log(`orderFinder: ${n} assertions passed`);
