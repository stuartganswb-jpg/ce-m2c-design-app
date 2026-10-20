// 🚚 THE BASE SHIPPING RATE — a percentage of the goods, so a shipping charge is never left at $0
// by accident (Stuart 2026-10-16: "need a default amount so it does not get missed").
//
// The charge is a free-typed field on both doors and starts EMPTY, which quietly becomes nothing
// at all when a busy counter forgets it. This fills it in, says so, and gets out of the way.
//
// ⛔ THE ORDER OF PRECEDENCE, and it only runs downwards (Stuart, same day):
//   1. THE CUSTOMER'S OWN PROGRAMME, set in 4.6 — Fabricut's flat-rate boxes are the example, and
//      "anything in 4.6 for any brand will always over rule this". A customer who ships flat rate
//      NEVER gets a percentage; charging both would bill them twice for the same freight.
//   2. THE BRAND'S BASE PERCENT, from system/shipping_config. Uniq'uity is 8%. A brand with no
//      rate on file is left exactly as it was — nothing is defaulted, nothing changes.
//   3. Nothing. An empty field, as before.
//
// It NEVER overwrites a figure a person typed, including one brought back by a reopen: a human who
// has said what the freight is has out-ranked every rule here.
//
// The percentage is taken on the GOODS SUBTOTAL AFTER THE ORDER DISCOUNT (Stuart: "yes") — what
// the customer is actually being charged for the goods — never on fees or packaging.

// Where the rates live, so changing 8 to 9 is a field on tab 11 and not a release.
export const SHIPPING_CONFIG_DOC = { collection: 'system', id: 'shipping_config' };

export const BRANDS = ['ce', 'uniquity', 'm2c', 'leyla'];

// A rate is a percent: 8 means 8%. Anything unparseable, negative or absurd is NO rate rather than
// a guess — a wrong freight charge is a wrong invoice.
export function baseRateOf(brand, cfg) {
    const raw = ((cfg && cfg.baseRatePct) || {})[String(brand || '').toLowerCase()];
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return 0;
    return pct;
}

export const shipAmountFor = (goodsSubtotal, pct) => {
    const base = Number(goodsSubtotal);
    if (!Number.isFinite(base) || base <= 0 || !(pct > 0)) return 0;
    return Math.round(base * (pct / 100) * 100) / 100;
};

// MAY THE APP STILL SET THIS FIGURE? Blank, yes. Otherwise only while the box still holds the
// number the APP last put there — so the default follows the cart as lines are added, and stops
// dead the moment a person types something of their own. Same rule, same shape, as the price
// level's mayAutoSetDiscount (Shared/nsPriceLevel): one idea, written once per door's vocabulary.
const num = (v) => Number(String(v === undefined || v === null ? '' : v).trim());
export const mayAutoSetShipping = (current, lastAuto) => {
    const c = String(current === undefined || current === null ? '' : current).trim();
    if (!c) return true;
    if (lastAuto === null || lastAuto === undefined) return false;
    return num(c) === num(lastAuto);
};

// THE ONE ANSWER both doors ask. Returns what to fill and what to SAY — a number that appears by
// itself and explains nothing is how the wrong one gets shipped.
//
//   typed              — what is in the box now ('' when untouched)
//   goodsSubtotal      — goods after the order discount
//   customerFlatRate   — true when 4.6 gives this customer their own shipping programme
//   flatRate           — that programme's figure for this cart, when the caller counted it ({ total, rows } —
//                        Shared/flatRateShipping.shippingChargeOf); tab 7 counts it (2026-10-20), CPQ fills its own
export function defaultShipping({ brand, cfg, typed, goodsSubtotal, customerFlatRate = false, lastAuto = null, flatRate = null }) {
    const none = { apply: false, amount: 0, pct: 0, reason: '' };
    if (!mayAutoSetShipping(typed, lastAuto)) {
        return { ...none, reason: 'typed' };          // a person has already said; never overrule them
    }
    if (customerFlatRate) {
        // 4.6 owns this customer's freight: its boxes, when the cart has been counted into them — never the percent
        const total = Math.round((Number(flatRate && flatRate.total) || 0) * 100) / 100;
        if (total > 0) return { apply: true, amount: total, pct: 0, reason: 'flat-rate', rows: (flatRate && flatRate.rows) || [] };
        return { ...none, reason: 'flat-rate' };
    }
    const pct = baseRateOf(brand, cfg);
    if (!pct) return { ...none, reason: 'no-rate' };
    const amount = shipAmountFor(goodsSubtotal, pct);
    if (!(amount > 0)) return { ...none, reason: 'no-goods' };
    return { apply: true, amount, pct, reason: 'base-rate' };
}

// What the screen and the log say when it fills one in.
export const defaultShippingNote = (d, brand) => {
    if (!(d && d.apply)) return '';
    if (d.reason === 'flat-rate') {
        const boxes = (d.rows || []).map(r => `${r.qty} × ${r.code}`).join(' + ');
        return `Shipping by the customer's flat-rate boxes (4.6) — $${d.amount.toFixed(2)}${boxes ? ` (${boxes})` : ''}. Change it if the freight differs.`;
    }
    return `Shipping defaulted to ${d.pct}% of the goods for ${String(brand || '').toUpperCase()} — $${d.amount.toFixed(2)}. Change it if the freight differs.`;
};
