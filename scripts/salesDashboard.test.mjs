// node scripts/salesDashboard.test.mjs — the sales dashboard's pure half (Stuart 2026-10-16).
import {
    ymdOf, daysOf, rangeMsOf, presetRangeOf, lastYearOf, PRESET, isOpenOrder, isDisplayShipment, orderMoneyOf, quoteDepositsOf,
    orderRowsOf, bookOf, doorSplitOf, quotePipelineOf, cpqLinesOf, oeLinesOf, periodSql, transactionsOf, basisOf, periodFiguresOf,
    compareRowsOf, cumulativeOf, topCustomersOf, receivablesOf, subsidiariesOf, usd, pctText,
} from '../src/components/Shared/salesDashboard.js';
import { DOOR } from '../src/components/Shared/daySummary.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

// ── dates ──
const today = new Date(2026, 9, 16);
eq('MTD', presetRangeOf(PRESET.MTD, today), { from: '2026-10-01', to: '2026-10-16' });
eq('last month', presetRangeOf(PRESET.LAST_MONTH, today), { from: '2026-09-01', to: '2026-09-30' });
eq('QTD', presetRangeOf(PRESET.QTD, today), { from: '2026-10-01', to: '2026-10-16' });
eq('QTD mid-quarter', presetRangeOf(PRESET.QTD, new Date(2026, 7, 20)), { from: '2026-07-01', to: '2026-08-20' });
eq('YTD', presetRangeOf(PRESET.YTD, today), { from: '2026-01-01', to: '2026-10-16' });
eq('last month from January is December', presetRangeOf(PRESET.LAST_MONTH, new Date(2027, 0, 5)), { from: '2026-12-01', to: '2026-12-31' });
eq('same MTD last year', lastYearOf({ from: '2026-10-01', to: '2026-10-16' }), { from: '2025-10-01', to: '2025-10-16' });
eq('Feb 29 a year earlier is Feb 28', lastYearOf({ from: '2028-02-01', to: '2028-02-29' }), { from: '2027-02-01', to: '2027-02-28' });
eq('both ends counted', daysOf({ from: '2026-10-01', to: '2026-10-16' }).length, 16);
eq('a backwards range is empty', daysOf({ from: '2026-10-16', to: '2026-10-01' }), []);
const r = rangeMsOf({ from: '2026-10-01', to: '2026-10-16' });
ok('range ms: midnight to the midnight after the last day', ymdOf(new Date(r.start)) === '2026-10-01' && ymdOf(new Date(r.end - 1)) === '2026-10-16' && ymdOf(new Date(r.end)) === '2026-10-17');

// ── orders ──
ok('open: pending, approved, dispatched', ['Pending', 'Approved', 'Dispatched', 'NS_QUEUED', 'HELD_PLACEHOLDER'].every(s => isOpenOrder({ status: s })));
ok('done: shipped / closed / cancelled / deleted', ['Shipped', 'Closed', 'CANCELLED', 'Cancelled', 'Deleted'].every(s => !isOpenOrder({ status: s })) && !isOpenOrder({ status: 'Pending', deleted: true }) && !isOpenOrder({ status: 'Pending', closed: true }));
ok('a display shipment is a $0 child', isDisplayShipment({ packMode: 'DISPLAY' }) && isDisplayShipment({ source: 'DISPLAY_SHIP' }) && !isDisplayShipment({ source: 'QUICKSHIP' }));

const oe = { id: 'QS-1', soId: 'SO61001', customer: 'READ WINDOW', orderClass: 'QUICKSHIP', status: 'Pending', invoiceTotal: 1000, shippingAmount: 45, paymentsTotal: 500, lastPaymentAt: 9, createdAt: new Date(2026, 9, 14).getTime(), fromQuote: 'QSQUOTE-1', quoteChain: ['QSQUOTE-1'] };
eq('Order Entry money: its lines + shipping; its own paid', orderMoneyOf(oe, null, { orderEntry: true }), { merch: 1000, shipping: 45, total: 1045, paid: 500, balance: 545, known: true, lastPaymentAt: 9 });
const job = { id: 'J2', jobId: 'QUOTE-2', quoteNo: 'Q-2002', brandId: 'ce', status: 'APPROVED', cpqData: { totalPrice: 2400, cartItems: [] }, shippingAmount: 100, paymentsTotal: 1200, lastPaymentAt: 20, supersedes: 'QUOTE-1', customer: { name: 'FABRICUT' } };
const rev1 = { id: 'J1', jobId: 'QUOTE-1', quoteNo: 'Q-2001', status: 'SUPERSEDED', supersededBy: 'QUOTE-2', cpqData: { totalPrice: 2000 }, paymentsTotal: 300, createdAt: new Date(2026, 9, 2).getTime() };
const cpq = { id: 'SO-APP-Q2', soId: 'SO61003', status: 'Dispatched', hqJobId: 'QUOTE-2', nsInternalId: '9', createdAt: new Date(2026, 9, 10).getTime() };
eq('CPQ money: the quote record\'s total + shipping; paid where the CRM takes it', orderMoneyOf(cpq, job), { merch: 2400, shipping: 100, total: 2500, paid: 1200, balance: 1300, known: true, lastPaymentAt: 20 });
eq('a CPQ order with no quote record: unknown, never $0', orderMoneyOf({ id: 'SO-APP-X', status: 'Approved' }, null).known, false);
const qsQuote = { id: 'QSQUOTE-1', jobId: 'QSQUOTE-1', source: 'QUICKSHIP', status: 'CONVERTED', convertedTo: 'QS-1', cpqData: { totalPrice: 1000 }, paymentsTotal: 250, createdAt: new Date(2026, 9, 13).getTime() };
const jobs = [job, rev1, qsQuote];
eq('option B: an OE order names the deposit on the quote it came from', quoteDepositsOf({ so: oe, jobs, orderEntry: true }).map(q => [q.no, q.paid]), [['QSQUOTE-1', 250]]);
eq('option B: a CPQ order names its earlier revision\'s deposit, not its own record', quoteDepositsOf({ so: cpq, job, jobs }).map(q => [q.no, q.paid]), [['Q-2001', 300]]);
eq('no deposit on any quote → nothing named', quoteDepositsOf({ so: { id: 'QS-9' }, jobs, orderEntry: true }), []);

const isOrderEntry = (so) => so.orderClass === 'QUICKSHIP';
const dsp = { id: 'QS-DSP-SO1-001', packMode: 'DISPLAY', source: 'DISPLAY_SHIP', status: 'NS_QUEUED', invoiceTotal: 0 };
const closed = { id: 'QS-3', orderClass: 'QUICKSHIP', status: 'Closed', customer: 'OLD', invoiceTotal: 50, createdAt: new Date(2026, 9, 1).getTime() };
const lost = { id: 'SO-APP-Z', status: 'Approved', hqJobId: 'GONE', customer: 'NOBODY', createdAt: new Date(2026, 9, 15).getTime(), backorderLines: [{ code: 'h1-1r/ep2', qty: 3, onOrder: 1 }, { code: 'X', qty: 0 }] };
const rows = orderRowsOf({ orders: [oe, cpq, dsp, closed, lost, { id: 'DEL', deleted: true }], jobs, isOrderEntry });
eq('rows: display shipments and deleted records left out, newest first', rows.map(x => x.id), ['SO-APP-Z', 'QS-1', 'SO-APP-Q2', 'QS-3']);
eq('rows: doors', rows.map(x => x.door), [DOOR.CPQ, DOOR.OE, DOOR.CPQ, DOOR.OE]);
eq('rows: customer from the order, else from its quote', rows.map(x => x.customer), ['NOBODY', 'READ WINDOW', 'FABRICUT', 'OLD']);
eq('rows: backorders recorded on the order', rows[0].backorders, [{ code: 'H1-1R/EP2', qty: 3, onOrder: 1, name: '' }]);
const open = rows.filter(x => x.open);
const book = bookOf(open);
eq('book: open orders, value, paid, balance, unknown', [book.count, book.total, book.paid, book.balance, book.unknown], [3, 3545, 1700, 1845, 1]);
eq('book: no deposit yet; waiting on backorders; deposits sitting on quotes', [book.noDeposit, book.onBackorder, book.backorderLines, book.quoteDeposits], [0, 1, 1, 550]);
const split = doorSplitOf(rows, rangeMsOf({ from: '2026-10-01', to: '2026-10-16' }));
eq('by door, entered in the range', [split.count, split.byDoor[DOOR.OE], split.byDoor[DOOR.CPQ]], [4, { count: 2, total: 1095 }, { count: 2, total: 2500 }]);

// ── quote pipeline ──
const openQuote = { id: 'J5', jobId: 'QUOTE-5', status: 'CONFIGURED', cpqData: { totalPrice: 800 }, shippingAmount: 20, createdAt: { seconds: new Date(2026, 9, 5).getTime() / 1000 } };
const request = { id: 'J6', status: 'PORTAL_REQUEST', cpqData: { totalPrice: 0 }, createdAt: new Date(2026, 9, 6).getTime() };
const oldOpen = { id: 'J7', status: 'CONFIGURED', cpqData: { totalPrice: 100 }, createdAt: new Date(2026, 5, 1).getTime() };
const jobApproved = { ...job, createdAt: new Date(2026, 9, 3).getTime() };
const pipe = quotePipelineOf({ jobs: [jobApproved, rev1, qsQuote, openQuote, request, oldOpen], ...rangeMsOf({ from: '2026-10-01', to: '2026-10-16' }) });
eq('pipeline: open = priced, not an order, not superseded / converted', pipe.open, { count: 2, total: 920 });
eq('pipeline: written in the range, a revised quote counted once', pipe.written, { count: 3, total: 4320 });
eq('pipeline: of those, became orders', [pipe.converted, Math.round(pipe.rate * 100)], [{ count: 2, total: 3500 }, 67]);

// ── lines ──
const cart = { cpqData: { cartItems: [
    { assemblyName: 'H1 Traverse', sidemark: 'Living', qty: 2, pricing: { finalPrice: 500 }, tradeDiscount: { amount: 50 } },
    { assemblyName: 'Finial set', qty: 1, pricing: { finalPrice: 100 }, lineDiscount: { mode: 'PERCENT', percent: 10 } },
] } };
eq('CPQ lines net of trade and line discounts', cpqLinesOf(cart).map(l => [l.name, l.qty, l.each, l.total]), [['H1 Traverse', 2, 450, 900], ['Finial set', 1, 90, 90]]);
const inv = { invoiceLines: [
    { type: 'KIT', code: 'HS0109T - SG', price: 300, components: [{ erp: 'A', qty: 2 }, { erp: 'B', qty: 1 }] },
    { type: 'ITEM', erp: 'H1-1R', name: 'Rod', qty: 3, rate: 40, total: 120 },
    { type: 'ITEM', name: 'Order Discount (10%)', isDiscount: true, total: 0 },
] };
eq('OE lines: the kit as one priced line, items, no discount row', oeLinesOf(inv).map(l => [l.name, l.qty, l.total]), [['HS0109T - SG', 1, 300], ['H1-1R — Rod', 3, 120]]);
eq('OE lines: an order with no invoice lines falls back to its lines, unpriced', oeLinesOf({ lines: [{ erp: 'X', name: 'x', qty: 2 }, { erp: 'Y', inKit: true, hidden: true }] }).map(l => [l.name, l.total]), [['X — x', null]]);

// ── NetSuite ──
const map = { ce: { subsidiary: '2' }, m2c: { subsidiary: '3' } };
eq('subsidiaries from the one map', subsidiariesOf(['ce', 'm2c', 'nope'], map), [2, 3]);
const q = periodSql({ subsidiaries: [2], from: '2026-10-01', to: '2026-10-16' });
ok('sql: the five types, the range, not voided, the subsidiary, grouped per transaction',
    q.includes("t.type IN ('SalesOrd', 'CustInvc', 'CashSale', 'CustDep', 'CustPymt')") && q.includes("TO_DATE('2026-10-01', 'YYYY-MM-DD')") && q.includes("TO_DATE('2026-10-16', 'YYYY-MM-DD')")
    && q.includes("NVL(t.voided, 'F') = 'F'") && q.includes('tl.subsidiary IN (2)') && q.includes('GROUP BY t.id') && q.includes("'Subtotal'") && q.includes("'EndGroup'") && !q.includes("'Discount'"));
const qh = periodSql({ subsidiaries: [2, 3], from: '2026-10-01', to: '2026-10-16', withLines: false });
ok('sql, header only: the main line, no grouping', qh.includes("tl.mainline = 'T'") && !qh.includes('GROUP BY') && qh.includes('tl.subsidiary IN (2, 3)'));
let threw = 0; try { periodSql({ subsidiaries: [], from: '2026-10-01', to: '2026-10-02' }); } catch (e) { threw++; } try { periodSql({ subsidiaries: [2], from: 'x', to: '2026-10-02' }); } catch (e) { threw++; }
eq('sql refuses with no subsidiary or a bad date', threw, 2);

const raw = [
    { id: 1, type: 'SalesOrd', tranid: 'SO1', d: '2026-10-01', entity: 7, cust: 'FABRICUT', st: 'B', gross: 1100, merch: -1000 },
    { id: 2, type: 'SalesOrd', tranid: 'SO2', d: '2026-10-03', entity: 8, cust: 'KRAVET', st: 'D', gross: 560, merch: -500 },
    { id: 3, type: 'SalesOrd', tranid: 'SO3', d: '2026-10-03', entity: 8, cust: 'KRAVET', st: 'C', gross: 999, merch: -999 },
    { id: 4, type: 'CustInvc', tranid: 'INV1', d: '2026-10-02', entity: 7, cust: 'FABRICUT', st: 'A', gross: 330, merch: 300 },
    { id: 5, type: 'CashSale', tranid: 'CS1', d: '2026-10-02', entity: 9, cust: null, st: 'C', gross: 55, merch: -50 },
    { id: 6, type: 'CustDep', tranid: 'DEP1', d: '2026-10-01', entity: 7, cust: 'FABRICUT', st: 'B', gross: 550, merch: 0 },
    { id: 7, type: 'CustPymt', tranid: 'PY1', d: '2026-10-16', entity: 8, cust: 'KRAVET', st: 'C', gross: 200, merch: 0 },
];
const txs = transactionsOf(raw);
eq('a customer with no name is named by number', txs[4].customer, 'Customer #9');
eq('basis: merchandise when the lines answered', basisOf(txs), 'MERCH');
eq('basis: gross when the lines came back empty', basisOf(transactionsOf(raw.map(x => ({ ...x, merch: 0 })))), 'GROSS');
eq('basis: gross when the line read was refused', basisOf(txs, { withLines: false }), 'GROSS');
const fig = periodFiguresOf(txs, { from: '2026-10-01', to: '2026-10-16', basis: 'MERCH' });
eq('booked: sales orders, cancelled left out, merchandise', fig.booked, { amount: 1500, count: 2, avg: 750 });
eq('invoiced: invoices + cash sales', fig.invoiced, { amount: 350, count: 2 });
eq('cash in: deposits + payments + cash sales, as received', fig.cash, { amount: 805, count: 3 });
eq('customers ordering', fig.customersBooked, 2);
eq('by day', [fig.daily['2026-10-01'], fig.daily['2026-10-03'].booked, fig.daily['2026-10-16'].cash], [{ booked: 1000, invoiced: 0, cash: 550 }, 500, 200]);
const gross = periodFiguresOf(txs, { from: '2026-10-01', to: '2026-10-16', basis: 'GROSS' });
eq('gross basis uses the document totals', gross.booked.amount, 1660);
eq('pace line: the running total, every day of the range', cumulativeOf(fig).map(x => x.value).filter((v, i) => [0, 1, 2, 15].includes(i)), [1000, 1000, 1500, 1500]);
const ly = periodFiguresOf(transactionsOf([{ id: 11, type: 'SalesOrd', d: '2025-10-04', entity: 7, cust: 'FABRICUT', st: 'B', gross: 880, merch: -800 }]), { from: '2025-10-01', to: '2025-10-16', basis: 'MERCH' });
const cmp = compareRowsOf(fig, ly);
eq('compare: booked, orders, average', cmp.slice(0, 3).map(x => [x.a, x.b, x.diff, Math.round(x.pct * 1000) / 1000]), [[1500, 800, 700, 0.875], [2, 1, 1, 1], [750, 800, -50, -0.062]]);
eq('compare: no figure last year → no %', cmp.find(x => x.key === 'cash').pct, null);
eq('top customers with last year beside', topCustomersOf(fig, ly).map(c => [c.name, c.booked, c.orders, c.compare]), [['FABRICUT', 1000, 1, 800], ['KRAVET', 500, 1, 0]]);
eq('receivables: open, overdue, over 60 days', receivablesOf([{ due: 100, dueDate: '2026-11-01' }, { due: 250.5, dueDate: '2026-10-01' }, { due: 40, dueDate: '2026-07-01' }], '2026-10-16'), { count: 3, due: 390.5, overdue: 290.5, overdueCount: 2, over60: 40 });

// ── words ──
eq('money words', [usd(1234.5), usd(-20), usd(null), usd(1500, { cents: false })], ['$1,234.50', '−$20.00', '—', '$1,500']);
eq('percent words', [pctText(0.875), pctText(-0.0625), pctText(null), pctText(0)], ['+88%', '−6.3%', '—', '0.0%']);

console.log(`salesDashboard: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
