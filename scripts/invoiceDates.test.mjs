// 🧪 An invoice's dates — shipped and due (Stuart 2026-10-20).   node scripts/invoiceDates.test.mjs
import { shipDateOf, orderTermsOf, dueDateOf, invoiceDatesOf } from '../src/components/Shared/invoiceDates.js';
import { termDaysOf, NS_TERM_DAYS, NS_TERM_NAMES } from '../src/components/Shared/nsTerms.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const DAY = 86400000;
const T = Date.UTC(2026, 9, 20, 15, 0);   // 2026-10-20
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// the terms' days, as NetSuite's invoices carry them (read 2026-10-20) — and 60+60 is 120 (Stuart)
eq('measured', ['1', '2', '3', '6', '12', '13', '14', '15', '17', '18', '20', '22', '27'].map(termDaysOf), [15, 30, 60, 30, 45, 0, 120, 30, 0, 0, 0, 0, 30]);
eq('by their names', ['16', '19', '21', '23', '24', '25', '26'].map(termDaysOf), [90, 0, 120, 30, 0, 10, 0]);
ok('every named term has its days', Object.keys(NS_TERM_NAMES).every(k => Object.prototype.hasOwnProperty.call(NS_TERM_DAYS, k)));
eq('a name typed by hand, and one we do not know', [termDaysOf('Net 30'), termDaysOf('net 60'), termDaysOf('Per agreement'), termDaysOf('')], [30, 60, null, null]);

// the ship date: the UPS shipment, else the pack — never the entry date
eq('shipped by UPS', shipDateOf({ order: { createdAt: T - 9 * DAY, packedAt: T - DAY, shippedAt: T } }), T);
eq('packed and fulfilled, no UPS label', shipDateOf({ order: { createdAt: T - 9 * DAY, orderPackedAt: T - DAY } }), T - DAY);
eq('a CPQ order: the latest of its pack documents', shipDateOf({ order: { createdAt: T - 9 * DAY }, packDocs: [{ packedAt: T - 3 * DAY }, { packedAt: T - DAY }] }), T - DAY);
eq('…and its UPS stamp wins over every pack', shipDateOf({ order: { shippedAt: T }, packDocs: [{ packedAt: T + DAY }] }), T);
eq('not shipped → 0', shipDateOf({ order: { createdAt: T } }), 0);
eq('a Firestore timestamp reads too', shipDateOf({ order: { shippedAt: { seconds: T / 1000 } } }), T);

// the terms: the order's own (kept by the ship check), else the customer's
eq('kept on the order', orderTermsOf({ order: { nsTerms: { id: '22', name: 'Pay Before Shipping' } }, customer: { terms: '2' } }), '22');
eq('…or on its hold', orderTermsOf({ order: { shipHold: { termId: '3' } }, customer: { terms: '2' } }), '3');
eq('else the customer\'s', orderTermsOf({ order: {}, customer: { terms: '2' } }), '2');
eq('a CPQ order: on its pack documents', orderTermsOf({ order: {}, packDocs: [{}, { nsTerms: { id: '6' } }], customer: { terms: '2' } }), '6');

// the due date
eq('Net 30 from the ship date', iso(dueDateOf({ shipMs: T, terms: '2' }).at), '2026-11-19');
eq('Net 60+60 is 120 days', iso(dueDateOf({ shipMs: T, terms: '21' }).at), '2027-02-17');
eq('pay-first terms are due on receipt', [iso(dueDateOf({ shipMs: T, terms: '22' }).at), dueDateOf({ shipMs: T, terms: '22' }).receipt], ['2026-10-20', true]);
eq('not shipped, or a term we do not know: no due date', [dueDateOf({ shipMs: 0, terms: '2' }).at, dueDateOf({ shipMs: T, terms: 'Per agreement' }).at], [0, 0]);

// the rows
const r = invoiceDatesOf({ order: { createdAt: T - 9 * DAY, shippedAt: T, nsTerms: { id: '3' } }, fmt: iso });
eq('an invoice\'s three rows', r, { shipDate: '2026-10-20', terms: 'Net 60', dueDate: '2026-12-19' });
eq('a confirmation before it ships says no ship or due date', invoiceDatesOf({ order: { createdAt: T }, customer: { terms: '2' }, fmt: iso }), { shipDate: '', terms: 'Net 30', dueDate: '' });
eq('due on receipt says so', invoiceDatesOf({ order: { shippedAt: T, nsTerms: { id: '13' } }, fmt: iso }).dueDate, '2026-10-20 — due on receipt');

console.log(`invoiceDates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
