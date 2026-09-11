// ── DISCOUNTS ON A CPQ QUOTE: THE CART OR THE CHECKOUT, NEVER BOTH (Stuart 2026-09-11, S1) ──
//
// "in the cart, select items and apply a discount percentage or overwrite the price to a net
//  price — a manager or higher role. The checkout can be left alone: it looks at the customer's
//  discount code and either applies that, or in place of that a fixed discount percentage
//  applied to the whole order. Either the discounted lines in the cpq or the checkout discount
//  method, not both. Checkout: the customer's code or a set % — not both."
//
// So a quote is discounted in exactly ONE of four ways, and this module is the one place that
// decides which (discountModeOf) and does the money (lineDiscountOf):
//   LINES          — one or more cart lines carry a `lineDiscount` (a percent off, or a net unit
//                    price typed over the configured one). The checkout discount is OFF.
//   ORDER_PERCENT  — a percent typed at checkout, applied per item on the trade-discount base
//                    (item-priced lines only) — the same rows, the same push — REPLACING the
//                    customer's standing code for this order.
//   CODE           — the customer's CRM discountCode (D20 …), exactly as before.
//   NONE
//
// A line keeps its configured (gross) unit price: `item.pricing.finalPrice` is never overwritten.
// The net is derived here, so a reopen, an undo or a later reader always has the original number.
// Every row this emits is flagged `isDiscount` / `isNetLine` — the flags every floor consumer
// already filters through Shared/lineClassification.isDisplayOnlyLine — so nothing here can ever
// become work. NetSuite lands at the net: buildNsTransaction scales the discounted line's own rates
// by `netFactorOf` (LINES) and the whole quote by the existing scale-to-quoted (CODE / ORDER_PERCENT).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// Who may discount a line in the cart: the CRM's manager list (OE_MANAGER_ROLES), plus the
// super-admin flag the HQ shell passes separately.
export const LINE_DISCOUNT_ROLES = ['admin', 'superadmin', 'manager', 'executive'];
export const canLineDiscount = (role, isSuperAdmin = false) =>
    !!isSuperAdmin || LINE_DISCOUNT_ROLES.includes(String(role || '').trim().toLowerCase());

/**
 * The money of one cart line's discount, or null when it carries none / none that applies.
 *   PERCENT → amount = gross × percent / 100
 *   NET     → amount = gross − netPrice  (a net ABOVE the gross is a price set upward: the amount
 *             goes negative and the line reads "Price set to $x" — allowed, said on screen)
 * Per-UNIT figures; multiply by qty for the line.
 */
export function lineDiscountOf(item) {
    const ld = item && item.lineDiscount;
    if (!ld || typeof ld !== 'object') return null;
    const gross = num(item.pricing && item.pricing.finalPrice);
    if (gross == null) return null;
    const mode = String(ld.mode || '').toUpperCase();
    if (mode === 'PERCENT') {
        const percent = num(ld.percent);
        if (!(percent > 0)) return null;
        const amount = round2(gross * percent / 100);
        return { mode, percent, netPrice: round2(gross - amount), gross, amount, net: round2(gross - amount), by: ld.by || '', at: ld.at || null };
    }
    if (mode === 'NET') {
        const netPrice = num(ld.netPrice);
        if (netPrice == null || netPrice < 0) return null;
        const amount = round2(gross - netPrice);
        return { mode, percent: gross > 0 ? round2(amount / gross * 100) : 0, netPrice: round2(netPrice), gross, amount, net: round2(netPrice), by: ld.by || '', at: ld.at || null };
    }
    return null;
}

/** The stamp written on a cart item. Returns null for an empty / invalid request (nothing to apply). */
export function lineDiscountStamp({ mode, value, by = '', at = Date.now() } = {}) {
    const m = String(mode || '').toUpperCase();
    const v = num(value);
    if (m === 'PERCENT') return (v > 0 && v <= 100) ? { mode: 'PERCENT', percent: v, by: String(by || ''), at } : null;
    if (m === 'NET') return (v != null && v >= 0) ? { mode: 'NET', netPrice: round2(v), by: String(by || ''), at } : null;
    return null;
}

/** Apply one stamp to the selected lines (by id); other lines untouched. */
export const applyLineDiscount = (cart, ids, stamp) => {
    const set = new Set(ids || []);
    return (cart || []).map(it => (it && set.has(it.id) && stamp) ? { ...it, lineDiscount: stamp } : it);
};
export const clearLineDiscount = (cart, ids) => {
    const set = new Set(ids || []);
    return (cart || []).map(it => {
        if (!it || !set.has(it.id) || !it.lineDiscount) return it;
        const { lineDiscount, ...rest } = it;
        return rest;
    });
};

export const cartHasLineDiscounts = (cart) => (cart || []).some(it => !!lineDiscountOf(it));

/**
 * Which ONE discount is live on this quote.
 *   cart          — the cart items
 *   orderPercent  — the percent typed at checkout ('' / null = none)
 *   customerCode  — the customer's CRM discountCode ('' = none)
 */
export function discountModeOf({ cart = [], orderPercent = '', customerCode = '' } = {}) {
    if (cartHasLineDiscounts(cart)) return 'LINES';
    if (num(orderPercent) > 0) return 'ORDER_PERCENT';
    if (String(customerCode || '').trim()) return 'CODE';
    return 'NONE';
}

/** The two display rows a discounted line adds under its own rows in the merged breakdown. */
export function lineDiscountRows(item, d, qty = 1) {
    if (!d) return [];
    const q = Math.max(1, parseInt(qty) || 1);
    const label = d.mode === 'NET'
        ? `  Price set to $${d.netPrice.toFixed(2)}${d.by ? ` · by ${d.by}` : ''}`
        : `  Line Discount - (${d.percent}%)${d.by ? ` · by ${d.by}` : ''}`;
    return [
        { name: label, qty: 1, price: -d.amount, total: round2(-d.amount * q), isDiscount: true, isLineDiscount: true, partHandling: '', partId: null },
        { name: '  Net Line Total', qty: 1, price: d.net, total: round2(d.net * q), isNetLine: true, partHandling: '', partId: null },
    ];
}

/**
 * net ÷ gross for one cart item — what buildNsTransaction multiplies THAT item's line rates by so
 * the discounted line drops in NetSuite and the other lines stay. 1 when the line carries none.
 */
export function netFactorOf(item) {
    const d = lineDiscountOf(item);
    if (!d || !(d.gross > 0)) return 1;
    return d.net / d.gross;
}

/** The header stamp on the job: which way this quote was discounted, for the record and for S5's display orders. */
export function orderDiscountStamp({ mode, percent = null, code = '', by = '' } = {}) {
    const m = ['LINES', 'ORDER_PERCENT', 'CODE', 'NONE'].includes(mode) ? mode : 'NONE';
    return {
        mode: m,
        percent: (m === 'ORDER_PERCENT' || m === 'CODE') ? (num(percent) || 0) : null,
        code: m === 'CODE' ? String(code || '').trim().toUpperCase() : '',
        by: String(by || ''),
    };
}
