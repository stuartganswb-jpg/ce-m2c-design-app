// ── THE SALES DASHBOARD, PURE (Stuart 2026-10-16) ─────────────────────────────────────────────────────────────────────
// "now that we have added the credit card payments and sales counter we need to create a sales dashboard for me, i like
//  to see collapsed the name of the customer, the order total, amount paid (deposit) … click on the collapsed and it
//  opens a popup with the order details that also shows what is in stock vs what needs to be made/ordered … below this
//  an area with the months sales, a comparative report with this month vs same mtd last year (both able to be date
//  adjusted), as well as other relevant KPI's" — and, approving the plan, "go ahead and add 1-6".
//
// Two books, each the one that holds the answer:
//   · THE OPEN ORDERS are RTG's sales-order records (hq_sales_orders) — every door: CPQ, Order Entry, the show counter
//     (a counter order IS an Order Entry order). Their money is read where the pay link and the CRM's 💳 chip read it:
//     an Order Entry order carries its own lines' total and paymentsTotal; a CPQ order's live on its quote record
//     (jobs — cpqData.totalPrice, shippingAmount, paymentsTotal), which is where the CRM mints its pay link.
//   · THE PERIOD'S SALES and last year's come from NETSUITE: the app holds no October 2025, and M2C entered its orders
//     straight into NetSuite until 2026-10-14. NetSuite is the only book with both years in it.
//
// It decides nothing about an order — stock vs make, where it stands — those are RTG's, the WMS's and the floor's own
// readings, called by the screen. It writes nothing. Pure — scripts/salesDashboard.test.mjs.
import { msOf, DOOR, soLabel } from './daySummary.js';
import { chainOf, isQuoteArchived } from './quoteChain.js';
import { isOrderJob } from './orderFinder.js';
import { netSuiteOrderNoOf } from './orderStatus.js';
import { lineDiscountOf } from './lineDiscount.js';

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v) => Math.round(N(v) * 100) / 100;
const DAY = 86400000;

// ── DATES ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ranges are local calendar dates 'YYYY-MM-DD', both ends INCLUDED — the way a person reads "Oct 1 – Oct 16".
const pad = (n) => String(n).padStart(2, '0');
export const ymdOf = (d = new Date()) => { const x = d instanceof Date ? d : new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
export const dateOfYmd = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(S(s)); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
export const isYmd = (s) => !!dateOfYmd(s);
/** The range as milliseconds: local midnight of `from` up to (not including) the midnight after `to`. */
export const rangeMsOf = ({ from, to } = {}) => {
    const a = dateOfYmd(from), b = dateOfYmd(to);
    if (!a || !b) return { start: 0, end: 0 };
    return { start: a.getTime(), end: new Date(b.getFullYear(), b.getMonth(), b.getDate() + 1).getTime() };
};
/** Every calendar day in the range, in order. */
export const daysOf = ({ from, to } = {}) => {
    const a = dateOfYmd(from), b = dateOfYmd(to);
    if (!a || !b || b < a) return [];
    const out = [];
    for (let d = new Date(a); d <= b && out.length < 800; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push(ymdOf(d));
    return out;
};

export const PRESET = Object.freeze({ MTD: 'MTD', LAST_MONTH: 'LAST_MONTH', QTD: 'QTD', YTD: 'YTD' });
export const PRESET_LABEL = { MTD: 'Month to date', LAST_MONTH: 'Last month', QTD: 'Quarter to date', YTD: 'Year to date' };
/** A preset's range, as of `today`. */
export function presetRangeOf(preset, today = new Date()) {
    const t = today instanceof Date ? today : (dateOfYmd(today) || new Date(today));
    const y = t.getFullYear(), m = t.getMonth();
    if (preset === PRESET.LAST_MONTH) return { from: ymdOf(new Date(y, m - 1, 1)), to: ymdOf(new Date(y, m, 0)) };
    if (preset === PRESET.QTD) return { from: ymdOf(new Date(y, m - (m % 3), 1)), to: ymdOf(t) };
    if (preset === PRESET.YTD) return { from: ymdOf(new Date(y, 0, 1)), to: ymdOf(t) };
    return { from: ymdOf(new Date(y, m, 1)), to: ymdOf(t) };
}
// One date a year earlier — Feb 29 becomes Feb 28, never Mar 1.
const yearEarlier = (s) => {
    const d = dateOfYmd(s);
    if (!d) return '';
    const y = d.getFullYear() - 1, m = d.getMonth();
    const last = new Date(y, m + 1, 0).getDate();
    return ymdOf(new Date(y, m, Math.min(d.getDate(), last)));
};
/** The same dates last year — the default comparison ("same mtd last year"). */
export const lastYearOf = ({ from, to } = {}) => ({ from: yearEarlier(from), to: yearEarlier(to) });
export const rangeLabelOf = ({ from, to } = {}) => {
    const a = dateOfYmd(from), b = dateOfYmd(to);
    if (!a || !b) return '—';
    const f = (d, withYear) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
    return a.getFullYear() === b.getFullYear() ? `${f(a, false)} – ${f(b, true)}` : `${f(a, true)} – ${f(b, true)}`;
};

// ── THE OPEN ORDERS (app) ──────────────────────────────────────────────────────────────────────────────────────────────
// Done = the words every other screen uses for a finished order (PickPack's openOe, Stock View's open list).
export const ORDER_DONE_STATUSES = ['Shipped', 'Closed', 'CANCELLED', 'Cancelled', 'Deleted'];
/** A display shipment (Shared/displayShipment) is a $0 child of its display order — the money is on the parent. */
export const isDisplayShipment = (so) => !!so && (so.packMode === 'DISPLAY' || U(so.source) === 'DISPLAY_SHIP' || !!S(so.displayOf));
export const isOpenOrder = (so) => !!so && !so.deleted && so.closed !== true && !ORDER_DONE_STATUSES.includes(S(so.status));

const keyOf = (j) => S(j && (j.jobId || j.id));
/** jobs by both of their names (doc id and jobId) — RTG's hqJobId may be either. */
export const jobIndexOf = (jobs = []) => {
    const m = new Map();
    (jobs || []).forEach(j => { if (!j) return; [j.id, j.jobId].map(S).filter(Boolean).forEach(k => { if (!m.has(k)) m.set(k, j); }); });
    return m;
};
const latest = (...vs) => vs.map(N).reduce((a, b) => Math.max(a, b), 0) || null;

/**
 * What an order is worth and what has been paid on it — read where the pay link reads it.
 *   Order Entry (tab 7 / the counter): the order's own lines (invoiceTotal) + its shipping; paid = its paymentsTotal.
 *   CPQ: the quote record's cpqData.totalPrice + shippingAmount; paid = the quote record's paymentsTotal (the CRM takes
 *        the deposit there), plus anything a link took against the RTG record itself.
 * `known: false` when the order's money could not be found (a CPQ order whose quote record is gone) — shown as a dash,
 * never as $0.
 */
export function orderMoneyOf(so, job = null, { orderEntry = false } = {}) {
    if (!so) return { merch: 0, shipping: 0, total: 0, paid: 0, balance: 0, known: false, lastPaymentAt: null };
    let merch = null, shipping = 0, paid = N(so.paymentsTotal), lastPaymentAt = latest(so.lastPaymentAt);
    if (orderEntry || typeof so.invoiceTotal === 'number') {
        merch = typeof so.invoiceTotal === 'number' ? N(so.invoiceTotal) : null;
        shipping = N(so.shippingAmount);
    } else if (job) {
        merch = (job.cpqData && job.cpqData.totalPrice != null) ? N(job.cpqData.totalPrice) : null;
        shipping = N(job.shippingAmount != null ? job.shippingAmount : so.shippingAmount);
        paid += N(job.paymentsTotal);
        lastPaymentAt = latest(so.lastPaymentAt, job.lastPaymentAt);
    }
    const known = merch != null;
    const total = known ? r2(merch + shipping) : 0;
    return { merch: known ? r2(merch) : 0, shipping: r2(shipping), total, paid: r2(paid), balance: known ? r2(total - paid) : 0, known, lastPaymentAt };
}

/**
 * OPTION B (Stuart 2026-10-16): a deposit taken on a QUOTE stays on the quote when it becomes a sales order — the
 * order's own paid figure (above, the same one the CRM chip and the printed documents show) does not include it. Until
 * the Payments session makes "what is paid" follow the quote to its order, the popup NAMES those deposits beside the
 * paid figure; they are not added into it. The quotes looked at: an Order Entry order's quoteChain / fromQuote / the
 * quote it was approved from; a CPQ order's earlier revisions (Shared/quoteChain). The record that carries the order's
 * own money is never listed twice.
 */
export function quoteDepositsOf({ so, job = null, jobs = [], orderEntry = false, idx = null } = {}) {
    if (!so) return [];
    const index = idx || jobIndexOf(jobs);
    const own = orderEntry ? '' : keyOf(job);
    const keys = new Set();
    (Array.isArray(so.quoteChain) ? so.quoteChain : []).forEach(k => keys.add(S(k)));
    [so.fromQuote, orderEntry ? so.hqJobId : ''].map(S).filter(Boolean).forEach(k => keys.add(k));
    if (!orderEntry && job) chainOf(jobs, keyOf(job)).forEach(j => keys.add(keyOf(j)));
    const seen = new Set();
    const out = [];
    keys.forEach(k => {
        const j = index.get(k);
        if (!j || keyOf(j) === own || seen.has(keyOf(j))) return;
        seen.add(keyOf(j));
        const paid = r2(j.paymentsTotal);
        if (paid > 0) out.push({ id: S(j.id), no: S(j.quoteNo || j.netsuiteEstimateNo || j.jobId || j.id), paid, at: N(j.lastPaymentAt) || null });
    });
    return out;
}

const backorderLinesOf = (so) => (Array.isArray(so && so.backorderLines) ? so.backorderLines : []).filter(b => b && N(b.qty) > 0)
    .map(b => ({ code: U(b.code), qty: N(b.qty), onOrder: N(b.onOrder), name: S(b.name) }));

/**
 * One row per sales order, newest first: who, how much, what is paid. `isOrderEntry(so, job)` is the one door test
 * (Shared/reopenQuote.isOrderEntryOrder), handed in so this file stays pure.
 */
export function orderRowsOf({ orders = [], jobs = [], isOrderEntry = () => false } = {}) {
    const idx = jobIndexOf(jobs);
    return (orders || []).filter(o => o && !o.deleted && !isDisplayShipment(o)).map(so => {
        const job = idx.get(S(so.hqJobId)) || null;
        const orderEntry = !!isOrderEntry(so, job);
        const money = orderMoneyOf(so, job, { orderEntry });
        const quoteDeposits = quoteDepositsOf({ so, job, jobs, orderEntry, idx });
        const backorders = backorderLinesOf(so);
        return {
            id: S(so.id), so, job, orderEntry, brand: S(so.brand || (job && job.brandId)),
            door: so.displayRelease ? DOOR.DISPLAY : (orderEntry ? DOOR.OE : DOOR.CPQ),
            ref: netSuiteOrderNoOf(job, so) || soLabel(so.soId || so.id),
            customer: S(so.customer || so.customerName || (job && job.customer && job.customer.name) || (job && job.customerName)) || '—',
            enteredAt: msOf(so.createdAt) || msOf(so.nsQueuedAt) || (job ? msOf(job.createdAt) : 0),
            enteredBy: S((so.createdBy && (so.createdBy.name || so.createdBy)) || so.savedBy || so.author || ''),
            open: isOpenOrder(so),
            ...money,
            quoteDeposits, quoteDepositTotal: r2(quoteDeposits.reduce((s, q) => s + q.paid, 0)),
            backorders,
        };
    }).sort((a, b) => b.enteredAt - a.enteredAt || a.customer.localeCompare(b.customer));
}

/** KPI 1 — the open order book; KPI 6 — the orders waiting on backorders. */
export function bookOf(rows = []) {
    const known = rows.filter(r => r.known);
    return {
        count: rows.length,
        total: r2(known.reduce((s, r) => s + r.total, 0)),
        paid: r2(rows.reduce((s, r) => s + r.paid, 0)),
        balance: r2(known.reduce((s, r) => s + Math.max(0, r.balance), 0)),
        unknown: rows.length - known.length,
        noDeposit: known.filter(r => r.total > 0 && !(r.paid > 0)).length,
        noDepositValue: r2(known.filter(r => r.total > 0 && !(r.paid > 0)).reduce((s, r) => s + r.total, 0)),
        onBackorder: rows.filter(r => r.backorders.length).length,
        backorderLines: rows.reduce((s, r) => s + r.backorders.length, 0),
        quoteDeposits: r2(rows.reduce((s, r) => s + r.quoteDepositTotal, 0)),
    };
}

/** KPI 5 — the orders entered in a range, by the door they came through. */
export function doorSplitOf(rows = [], { start = 0, end = 0 } = {}) {
    const inRange = rows.filter(r => r.enteredAt >= start && r.enteredAt < end);
    const out = {};
    [DOOR.CPQ, DOOR.OE, DOOR.DISPLAY].forEach(d => { out[d] = { count: 0, total: 0 }; });
    inRange.forEach(r => { const b = out[r.door] || (out[r.door] = { count: 0, total: 0 }); b.count += 1; b.total = r2(b.total + (r.known ? r.total : 0)); });
    return { byDoor: out, count: inRange.length, total: r2(inRange.reduce((s, r) => s + (r.known ? r.total : 0), 0)) };
}

// ── KPI 2: THE QUOTE PIPELINE (app) ────────────────────────────────────────────────────────────────────────────────────
// Both kinds of quote carry cpqData.totalPrice (tab 7 writes it too) and shippingAmount — the pay link's own total.
export const quoteTotalOf = (j) => r2(N(j && j.cpqData && j.cpqData.totalPrice) + N(j && j.shippingAmount));
// A portal request / pillow request (Shared/pillowRequest PILLOW_REQUEST_STATUS) is asked for, not yet quoted.
const REQUEST_STATUSES = ['PORTAL_REQUEST', 'PILLOW_REQUEST'];
const isPricedQuote = (j) => !!j && !j.deleted && !j.portalDeleted && quoteTotalOf(j) > 0 && !REQUEST_STATUSES.includes(U(j.status));
export const isConvertedQuote = (j) => !!j && (isOrderJob(j) || U(j.status) === 'CONVERTED' || !!S(j.convertedTo));
/**
 * Open: priced, not an order, not superseded / converted / done. Written in the range: every priced quote created then,
 * counting a revised quote ONCE (its superseded revisions are left out); how many of those became sales orders.
 */
export function quotePipelineOf({ jobs = [], start = 0, end = 0 } = {}) {
    const quotes = (jobs || []).filter(isPricedQuote);
    const open = quotes.filter(j => !isConvertedQuote(j) && !isQuoteArchived(j));
    const written = quotes.filter(j => { const t = msOf(j.createdAt) || Date.parse(S(j.dateSaved)) || 0; return t >= start && t < end && U(j.status) !== 'SUPERSEDED'; });
    const converted = written.filter(isConvertedQuote);
    const sum = (list) => r2(list.reduce((s, j) => s + quoteTotalOf(j), 0));
    return {
        open: { count: open.length, total: sum(open) },
        written: { count: written.length, total: sum(written) },
        converted: { count: converted.length, total: sum(converted) },
        rate: written.length ? converted.length / written.length : null,
    };
}

// ── THE ORDER'S LINES, AS THE CUSTOMER BOUGHT THEM ─────────────────────────────────────────────────────────────────────
/** CPQ: one row per configured item in the cart, net of its trade / line discount (CPQTab's own grand-total arithmetic). */
export function cpqLinesOf(job) {
    const items = (job && job.cpqData && Array.isArray(job.cpqData.cartItems)) ? job.cpqData.cartItems : [];
    return items.map(it => {
        const qty = N(it.qty) || 1;
        const gross = N(it.pricing && it.pricing.finalPrice);
        const trade = N(it.tradeDiscount && it.tradeDiscount.amount);
        const ld = lineDiscountOf(it);
        const each = r2(gross - trade - (ld ? N(ld.amount) : 0));
        return { name: S(it.assemblyName || it.name || 'Configured item'), note: S(it.sidemark), qty, each, total: r2(each * qty), finish: S(it.engineConfig && it.engineConfig.globalFinish) };
    });
}
/** Order Entry: the invoice lines tab 7 captured at the sale (kits as one priced line, their parts beneath at no charge). */
export function oeLinesOf(so) {
    const inv = Array.isArray(so && so.invoiceLines) ? so.invoiceLines : [];
    if (inv.length) {
        return inv.filter(l => l && !l.isDiscount).map(l => (l.type === 'KIT'
            ? { name: S(l.code), note: (l.components || []).map(c => `${N(c.qty)} × ${S(c.erp || c.realErp)}`).join(' · '), qty: 1, each: r2(l.price), total: r2(l.price), kit: true }
            : { name: [S(l.erp), S(l.name)].filter(Boolean).join(' — '), note: S(l.note), qty: N(l.qty), each: r2(l.rate), total: r2(l.total != null ? l.total : N(l.rate) * N(l.qty)) }));
    }
    return (Array.isArray(so && so.lines) ? so.lines : []).filter(l => l && !l.hidden && !l.inKit).map(l => ({ name: [S(l.erp), S(l.name)].filter(Boolean).join(' — '), note: S(l.memo || l.note), qty: N(l.qty), each: null, total: null }));
}

// ── THE PERIOD'S SALES (NetSuite) ──────────────────────────────────────────────────────────────────────────────────────
// What each figure counts:
//   Booked      — sales orders dated in the range, cancelled ones left out.
//   Invoiced    — invoices + cash sales dated in the range.
//   Cash in     — customer deposits + customer payments + cash sales dated in the range (before refunds).
//   Amounts are the MERCHANDISE — the item lines, before tax and shipping — for Booked and Invoiced; Cash in is what was
//   received. If NetSuite refuses the line-level read, every figure falls back to the document totals and the screen
//   says "incl. tax & shipping" (basis GROSS) — never a silent mix of the two.
// Status codes are BARE in SuiteQL ('C' = a cancelled sales order — Shared/nsInvoiceQuery's lesson).
export const TX = Object.freeze({ SO: 'SalesOrd', INV: 'CustInvc', CASH_SALE: 'CashSale', DEP: 'CustDep', PMT: 'CustPymt' });
export const PERIOD_TYPES = [TX.SO, TX.INV, TX.CASH_SALE, TX.DEP, TX.PMT];
// Line types that are not merchandise: shipping, tax, the subtotal / group-total echo lines (which would count the
// items twice), description and payment lines. Discounts, fees (other charges), kits and assemblies ARE merchandise.
export const NOT_MERCH_TYPES = ['ShipItem', 'TaxItem', 'TaxGroup', 'Subtotal', 'Description', 'Group', 'EndGroup', 'Payment'];
const sqlDate = (s) => (isYmd(s) ? S(s) : '');
export const subsidiariesOf = (brands = [], map = {}) => [...new Set((brands || []).map(b => N(map[b] && map[b].subsidiary)).filter(n => n > 0))];

export function periodSql({ subsidiaries = [], from, to, withLines = true } = {}) {
    const subs = (subsidiaries || []).map(Number).filter(n => Number.isInteger(n) && n > 0);
    const f = sqlDate(from), t = sqlDate(to);
    if (!subs.length) throw new Error('No NetSuite subsidiary to read.');
    if (!f || !t) throw new Error('A date range needs a from and a to date.');
    const where = [
        `t.type IN (${PERIOD_TYPES.map(x => `'${x}'`).join(', ')})`,
        `t.trandate >= TO_DATE('${f}', 'YYYY-MM-DD')`,
        `t.trandate <= TO_DATE('${t}', 'YYYY-MM-DD')`,
        "NVL(t.voided, 'F') = 'F'",
        `tl.subsidiary IN (${subs.join(', ')})`,
    ].join(' AND ');
    const head = `SELECT t.id AS id, t.type AS type, t.tranid AS tranid, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS d, t.entity AS entity, `
        + `NVL(c.companyname, c.entityid) AS cust, t.status AS st, ABS(NVL(t.foreigntotal, 0)) AS gross`;
    if (!withLines) {
        return `${head} FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' `
            + `LEFT JOIN customer c ON c.id = t.entity WHERE ${where} ORDER BY t.id`;
    }
    const merch = `SUM(CASE WHEN tl.mainline = 'F' AND NVL(tl.taxline, 'F') = 'F' AND NVL(tl.iscogs, 'F') = 'F' `
        + `AND NVL(tl.itemtype, '-') NOT IN (${NOT_MERCH_TYPES.map(x => `'${x}'`).join(', ')}) THEN NVL(tl.foreignamount, 0) ELSE 0 END) AS merch`;
    return `${head}, ${merch} FROM transaction t JOIN transactionline tl ON tl.transaction = t.id `
        + `LEFT JOIN customer c ON c.id = t.entity WHERE ${where} `
        + `GROUP BY t.id, t.type, t.tranid, t.trandate, t.entity, c.companyname, c.entityid, t.status, t.foreigntotal ORDER BY t.id`;
}

/** NetSuite's rows → one record per transaction. `merch` is the item-line sum's size (its sign is NetSuite's). */
export const transactionsOf = (rows = [], { withLines = true } = {}) => (rows || []).map(r => ({
    id: S(r.id), type: S(r.type), tranid: S(r.tranid), date: S(r.d), entity: S(r.entity), customer: S(r.cust) || `Customer #${S(r.entity)}`,
    status: S(r.st), gross: r2(Math.abs(N(r.gross))), merch: withLines && r.merch != null ? r2(Math.abs(N(r.merch))) : null,
}));

/** Which basis the figures can honestly use: MERCH when the line read came back with amounts, else GROSS. */
export const basisOf = (txs = [], { withLines = true } = {}) => {
    if (!withLines) return 'GROSS';
    const sales = txs.filter(t => [TX.SO, TX.INV, TX.CASH_SALE].includes(t.type) && t.gross > 0);
    if (!sales.length) return 'MERCH';
    // A line read that answers but carries no amounts on any sale is an unpopulated column, not a month of $0 sales.
    return sales.some(t => N(t.merch) > 0) ? 'MERCH' : 'GROSS';
};

/** The figures of one range: Booked / Invoiced / Cash in, by day and by customer. */
export function periodFiguresOf(txs = [], { from, to, basis = 'MERCH' } = {}) {
    const amt = (t) => (basis === 'MERCH' && t.merch != null ? t.merch : t.gross);
    const booked = txs.filter(t => t.type === TX.SO && U(t.status) !== 'C');
    const invoiced = txs.filter(t => t.type === TX.INV || t.type === TX.CASH_SALE);
    const cash = txs.filter(t => t.type === TX.DEP || t.type === TX.PMT || t.type === TX.CASH_SALE);
    const sum = (list, f) => r2(list.reduce((s, t) => s + f(t), 0));
    const daily = {};
    daysOf({ from, to }).forEach(d => { daily[d] = { booked: 0, invoiced: 0, cash: 0 }; });
    const add = (t, k, v) => { if (!daily[t.date]) return; daily[t.date][k] = r2(daily[t.date][k] + v); };
    booked.forEach(t => add(t, 'booked', amt(t)));
    invoiced.forEach(t => add(t, 'invoiced', amt(t)));
    cash.forEach(t => add(t, 'cash', t.gross));
    const customers = {};
    const cust = (t) => (customers[t.entity] = customers[t.entity] || { entity: t.entity, name: t.customer, booked: 0, orders: 0, invoiced: 0 });
    booked.forEach(t => { const c = cust(t); c.booked = r2(c.booked + amt(t)); c.orders += 1; });
    invoiced.forEach(t => { const c = cust(t); c.invoiced = r2(c.invoiced + amt(t)); });
    const bookedAmt = sum(booked, amt);
    return {
        from, to, basis,
        booked: { amount: bookedAmt, count: booked.length, avg: booked.length ? r2(bookedAmt / booked.length) : 0 },
        invoiced: { amount: sum(invoiced, amt), count: invoiced.length },
        cash: { amount: sum(cash, t => t.gross), count: cash.length },
        customersBooked: new Set(booked.map(t => t.entity)).size,
        daily, customers,
    };
}

export const METRICS = [
    { key: 'booked', label: 'Booked (orders entered)', pick: (f) => f.booked.amount, money: true },
    { key: 'orders', label: 'Sales orders', pick: (f) => f.booked.count, money: false },
    { key: 'avg', label: 'Average order', pick: (f) => f.booked.avg, money: true },
    { key: 'customers', label: 'Customers ordering', pick: (f) => f.customersBooked, money: false },
    { key: 'invoiced', label: 'Invoiced (shipped & billed)', pick: (f) => f.invoiced.amount, money: true },
    { key: 'cash', label: 'Cash in (deposits + payments)', pick: (f) => f.cash.amount, money: true },
];
/** This period against the compare period, metric by metric. pct is null when the compare figure is 0. */
export const compareRowsOf = (a, b) => METRICS.map(m => {
    const va = a ? m.pick(a) : null, vb = b ? m.pick(b) : null;
    const diff = va != null && vb != null ? r2(va - vb) : null;
    return { key: m.key, label: m.label, money: m.money, a: va, b: vb, diff, pct: diff != null && vb ? diff / Math.abs(vb) : null };
});

/** The running total, day 1 … day N of the range — the pace line on the chart. */
export const cumulativeOf = (fig, metric = 'booked') => {
    if (!fig) return [];
    let run = 0;
    return daysOf({ from: fig.from, to: fig.to }).map(d => { run = r2(run + N(fig.daily[d] && fig.daily[d][metric])); return { date: d, value: run }; });
};

/** KPI 4 — the top customers of this period by booked, with the same customer's compare-period figure beside. */
export const topCustomersOf = (a, b, n = 10) => Object.values((a && a.customers) || {})
    .filter(c => c.booked > 0)
    .sort((x, y) => y.booked - x.booked || x.name.localeCompare(y.name))
    .slice(0, n)
    .map(c => ({ ...c, compare: r2(N(b && b.customers && b.customers[c.entity] && b.customers[c.entity].booked)) }));

/** KPI 3 — open receivables from Shared/nsInvoiceQuery's own open-invoice rows. */
export function receivablesOf(invoices = [], today = ymdOf()) {
    const overdue = (invoices || []).filter(i => S(i.dueDate) && S(i.dueDate) < S(today));
    return {
        count: (invoices || []).length,
        due: r2((invoices || []).reduce((s, i) => s + N(i.due), 0)),
        overdue: r2(overdue.reduce((s, i) => s + N(i.due), 0)),
        overdueCount: overdue.length,
        over60: r2(overdue.filter(i => (dateOfYmd(today) - dateOfYmd(i.dueDate)) / DAY > 60).reduce((s, i) => s + N(i.due), 0)),
    };
}

// ── WORDS ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const usd = (v, { cents = true } = {}) => (v == null || !Number.isFinite(Number(v)) ? '—'
    : `${Number(v) < 0 ? '−' : ''}$${Math.abs(Number(v)).toLocaleString(undefined, { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`);
export const pctText = (p) => (p == null || !Number.isFinite(p) ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toFixed(Math.abs(p) < 0.1 ? 1 : 0)}%`);
