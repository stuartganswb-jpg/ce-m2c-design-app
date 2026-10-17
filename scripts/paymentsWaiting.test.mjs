// node scripts/paymentsWaiting.test.mjs — money taken that NetSuite has not heard about.
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/components/Shared/paymentsWaiting.js', import.meta.url), 'utf8');
const mod = await import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
const { isUnposted, waitingRowsOf, overdueOf, waitingSummary, waitingLine, WAITING_HOURS } = mod;

let n = 0;
const ok = (c, what) => { assert.ok(c, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };

const NOW = Date.parse('2026-10-17T12:00:00Z');
const hoursAgo = (h) => NOW - h * 3600000;
const pay = (over) => ({ id: 'p1', amount: 100, environment: 'PRODUCTION', paidAt: hoursAgo(1), netsuitePosted: false, netsuiteQueued: false, reference: 'SO1', ...over });

// ── what counts as money still out ───────────────────────────────────────────
ok(isUnposted(pay()), 'taken, not posted, not queued');
ok(!isUnposted(pay({ netsuitePosted: true })), 'posted is done');
ok(!isUnposted(pay({ netsuiteQueued: true })), 'queued is on its way — not a problem to chase');
ok(!isUnposted(pay({ environment: 'SANDBOX' })), 'a test payment was never going to post');
ok(!isUnposted(pay({ amount: 0 })), 'no money, nothing out');
ok(!isUnposted(null), 'nothing is not a payment');

// ── the threshold Stuart set ─────────────────────────────────────────────────
eq(WAITING_HOURS, 24, "24 hours — “the money will post the next day and need to be addressed”");
eq(waitingRowsOf([pay({ paidAt: hoursAgo(23) })], NOW)[0].overdue, false, 'still inside the day');
eq(waitingRowsOf([pay({ paidAt: hoursAgo(24) })], NOW)[0].overdue, true, 'a day later it is wrong');
eq(waitingRowsOf([pay({ paidAt: hoursAgo(100) })], NOW)[0].ageDays, 4, 'and the age is in days a person can read');

// ── oldest first: the one to deal with is at the top ─────────────────────────
const rows = waitingRowsOf([
    pay({ id: 'new', paidAt: hoursAgo(2) }),
    pay({ id: 'old', paidAt: hoursAgo(72) }),
    pay({ id: 'mid', paidAt: hoursAgo(30) }),
], NOW);
eq(rows.map((r) => r.id), ['old', 'mid', 'new'], 'oldest first');
eq(overdueOf(rows).map((r) => r.id), ['old', 'mid'], 'only the ones past the day');

// ── the sentence says the MONEY, because that is the point ───────────────────
const s = waitingSummary(rows);
ok(s.includes('2 payments'), 'how many');
ok(s.includes('$200.00'), 'how much — the figure that matters');
ok(s.includes('3 days'), 'and how long the worst one has sat');
eq(waitingSummary(waitingRowsOf([pay({ paidAt: hoursAgo(2) })], NOW)), '', 'nothing overdue, nothing said — no crying wolf');
eq(waitingSummary([]), '', 'and nothing at all says nothing');

// At the default threshold anything overdue is at least a day old, so it is said in days.
ok(waitingSummary(waitingRowsOf([pay({ paidAt: hoursAgo(26) })], NOW)).includes('1 day'), '26 hours reads as a day, not as 26 hours');
ok(!waitingSummary(waitingRowsOf([pay({ paidAt: hoursAgo(26) })], NOW)).includes('1 days'), 'and one day is singular');
// The hours wording is for a caller who sets a tighter threshold than Stuart's 24.
ok(waitingSummary(waitingRowsOf([pay({ paidAt: hoursAgo(5) })], NOW, 4), 4).includes('5 hours'), 'a tighter threshold counts in hours');

// ── a row a person can act on ────────────────────────────────────────────────
const line = waitingLine(rows[0]);
ok(line.includes('3d'), 'the age');
ok(line.includes('$100.00'), 'the money');
ok(line.includes('SO1'), 'and which order');
ok(waitingLine({ ...rows[0], reason: 'waiting for the customer to reach NetSuite' }).includes('reach NetSuite'), 'and why, when we know');
ok(waitingLine({ ...rows[0], reference: '' }).includes('(no reference)'), 'a payment with no reference still names itself as one');

console.log(`paymentsWaiting: ${n} assertions passed`);
