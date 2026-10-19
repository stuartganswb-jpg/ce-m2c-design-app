// 📄 THE SALES ORDER AS THE CUSTOMER SEES IT — the data behind the link in their email.
//
// Stuart 2026-09-23 wanted "a copy of the sales order showing the deposit amount" emailed once a
// payment is taken. The app has no PDF renderer and a browser-made one cannot work unattended, so
// the letter carries a LINK to a page, and this is what that page is given.
//
// ⚠ IT MIRRORS Shared/QuickShipInvoiceModal, which is the staff's view of the same document: the
// same line rule (invoiceLines when priced, else the order's own lines), the same totals, the same
// paid-and-balance block. A customer and the office must never be looking at different numbers for
// the same order. If one changes, change both — scripts/orderDocument.test.mjs locks the shape.
//
// It is DATA ONLY: no html, no styling, no decisions about what to show. The page decides how it
// looks; this decides what is true.

const str = (v) => String(v === undefined || v === null ? '' : v).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (v) => Math.round(num(v) * 100) / 100;

// A LINE AS THE CUSTOMER ORDERED IT. `invoiceLines` carry rates and totals once an order is
// priced; the raw `lines` are what was picked and may not. Either way the customer sees what they
// bought, and an alias code when they order under their own numbering.
function linesOf(order) {
    const priced = Array.isArray(order && order.invoiceLines) ? order.invoiceLines : [];
    if (priced.length) {
        return priced.map((l) => ({
            code: str(l.erp || l.realErp),
            name: str(l.name),
            note: str(l.note),
            qty: num(l.qty),
            rate: l.rate === null || l.rate === undefined ? null : money(l.rate),
            amount: l.total === null || l.total === undefined ? null : money(l.type === 'KIT' ? (l.price ?? l.total) : l.total),
        }));
    }
    return (Array.isArray(order && order.lines) ? order.lines : []).map((l) => ({
        code: str(l.aliasErp || l.erp),
        name: str(l.name),
        note: str(l.note),
        qty: num(l.qty),
        rate: null,
        amount: null,
    }));
}

// ⚠ FREIGHT IS PART OF WHAT THE CUSTOMER OWES (Stuart 2026-10-19: "the amount it is wanting to
// collect is ignoring the shipping charge"). `invoiceTotal` is the GOODS only — freight rides
// separately, because NetSuite wants it in its own shippingcost field — so a total built from it
// alone understates the bill, asks for a deposit on the wrong figure, and disagrees with NetSuite's
// own total for the same order. The order carries it as `shippingAmount` or `shipping.amount`
// depending on which door wrote it; both are the same number.
const shippingOf = (order) => money((order && order.shippingAmount) || (order && order.shipping && order.shipping.amount) || 0);

// THE MONEY, worked out once. The order's total is its own figure when it has one, else the lines
// add up to it — never a second reckoning that could disagree with the printed page.
function totalsOf(order, lines) {
    const goods = order && order.invoiceTotal !== undefined && order.invoiceTotal !== null
        ? money(order.invoiceTotal)
        : money(lines.reduce((s, l) => s + num(l.amount), 0));
    const shipping = shippingOf(order);
    const total = money(goods + shipping);
    const paid = money(order && order.paymentsTotal);
    const balance = money(total - paid);
    return {
        goods,
        shipping,
        total,
        paid,
        balance: balance > 0 ? balance : 0,
        paidInFull: total > 0 && balance <= 0.005,
    };
}

// What the page is handed. `kind` lets the page title itself honestly: an order that NetSuite has
// billed is an invoice, everything else is a sales order — the same test the portal's payables use.
function orderDocumentOf(order, { merchantName = '', reference = '' } = {}) {
    const o = order || {};
    const lines = linesOf(o);
    const totals = totalsOf(o, lines);
    return {
        kind: str(o.nsInvoiceNo) ? 'INVOICE' : 'SALES_ORDER',
        merchantName: str(merchantName),
        reference: str(reference || o.soId || o.id),
        nsInvoiceNo: str(o.nsInvoiceNo),
        orderDate: num(o.createdAt) || 0,
        customerName: typeof o.customer === 'object' && o.customer ? str(o.customer.name) : str(o.customer),
        poNumber: str(o.po || o.poNumber),
        sidemark: str(o.orderSidemark || o.sidemark),
        lines,
        ...totals,
        // Said plainly so the page need not infer it, and so the customer is never shown a figure
        // without being told what it means.
        paidNote: totals.paid > 0
            ? (totals.paidInFull ? 'Paid in full — thank you.' : `Deposit received. ${totals.balance > 0 ? 'The balance is shown above.' : ''}`.trim())
            : '',
    };
}

module.exports = { orderDocumentOf, linesOf, totalsOf, shippingOf };
