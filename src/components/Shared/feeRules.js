// FEE & ADD-ON RULES (Stuart 2026-07-30, from "Fabricut Hardware 2026 Fee Pricing.xlsx").
//
// The fee sheet is not a price list — it is four different pricing SHAPES wearing one column:
//   flat per unit      cover plate $10 · packaging $12 · flat-rate shipping $22.50–$300
//   per NAMED unit     per return · per foot (traverse track) · per bend $600 · per strike-off $75
//   % of order         outdoor coating 25%
//   % with a floor     custom colour "10% or $100 minimum" · rush "25% OF ORDER/MIN $100"
// The first two are the same arithmetic (amount × qty) differing only in what the operator is
// counting, so this models TWO modes and lets the UNIT carry the meaning.
//
// WHAT LIVES WHERE: the RULE lives here, on the item (manufacturingSpecs.feeRule). The PRICE does
// not — it stays where every other price in the app lives (base price, the customer's clientPricing
// row, the Fabricut box), so a fee is priced per customer by the machinery that already exists.
//
// THE PERCENTAGE BASE is the CONFIGURATION SUBTOTAL — parts and labour for the configured product,
// BEFORE any other fee and before shipping (Stuart's call, 2026-07-30). It is deliberately not the
// order total: two percentage fees on one order must never compound, and adding shipping must never
// inflate a rush fee. Callers pass that figure in; this module never guesses it.

export const FEE_MODES = [
    { id: 'FLAT', label: 'Flat amount × quantity', hint: 'The price is per unit. Quantity is whatever the unit says.' },
    { id: 'PERCENT', label: 'Percentage of the configuration', hint: 'Percent of parts + labour, before other fees and shipping. A minimum can hold the floor.' },
];

// The unit names what the operator is counting. EACH is the default and asks for a plain quantity.
export const FEE_UNITS = [
    { id: 'EACH', label: 'each', plural: 'each' },
    { id: 'RETURN', label: 'per return', plural: 'returns' },
    { id: 'FOOT', label: 'per foot', plural: 'feet' },
    { id: 'POLE', label: 'per pole', plural: 'poles' },
    { id: 'WINDOW', label: 'per window', plural: 'windows' },
    { id: 'BOX', label: 'per box / shipment', plural: 'boxes' },
    { id: 'BEND', label: 'per bend', plural: 'bends' },
    { id: 'STRIKE_OFF', label: 'per strike-off', plural: 'strike-offs' },
    { id: 'VIAL', label: 'per vial', plural: 'vials' },
    { id: 'COLOR', label: 'per colour', plural: 'colours' },
];

export const unitLabel = (id) => (FEE_UNITS.find(u => u.id === id) || FEE_UNITS[0]).label;
export const unitPlural = (id) => (FEE_UNITS.find(u => u.id === id) || FEE_UNITS[0]).plural;

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// The stored rule, normalized. An item with no rule is a plain flat fee charged once — which is how
// every existing fee behaved before this existed, so nothing changes for them.
export const feeRuleOf = (specs) => {
    const r = (specs && specs.feeRule) || {};
    const mode = String(r.mode || '').toUpperCase() === 'PERCENT' ? 'PERCENT' : 'FLAT';
    return {
        mode,
        unit: FEE_UNITS.some(u => u.id === r.unit) ? r.unit : 'EACH',
        percent: num(r.percent),
        minAmount: num(r.minAmount),
        maxAmount: num(r.maxAmount),
        portalSelectable: r.portalSelectable === true,
        defaultQty: num(r.defaultQty) || 1,
        note: String(r.note || ''),
    };
};

export const hasFeeRule = (specs) => !!(specs && specs.feeRule && (specs.feeRule.mode || specs.feeRule.unit || specs.feeRule.percent));

// A fee's own price for this context — the caller resolves it the normal way (clientPricing row →
// Fabricut tier → base price) and hands it in, so this module has one job: apply the rule.
//
// Returns { amount, explain, capped } — amount is ALWAYS a number ≥ 0, rounded to the cent.
// `explain` is the sentence shown on the quote line, so the arithmetic is never a mystery.
export function computeFee({ rule, unitPrice, qty, configSubtotal }) {
    const r = rule && rule.mode ? rule : feeRuleOf({ feeRule: rule });
    const q = Math.max(0, num(qty) ?? 1);
    const price = num(unitPrice) ?? 0;
    const base = Math.max(0, num(configSubtotal) ?? 0);
    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    if (r.mode === 'PERCENT') {
        const pct = num(r.percent) ?? 0;
        const raw = base * (pct / 100);
        const min = num(r.minAmount);
        // "10% or $100 minimum" — the MINIMUM WINS when the percentage falls short. On a small
        // order that is the whole point of the rule; on a large one the percentage takes over.
        const floored = (min !== null && raw < min) ? min : raw;
        const max = num(r.maxAmount);
        const capped = max !== null && floored > max;
        const amount = round(capped ? max : floored);
        const pctTxt = `${pct}% of ${round(base).toFixed(2)}`;
        const explain = (min !== null && raw < min)
            ? `${pctTxt} = ${round(raw).toFixed(2)} — below the ${min.toFixed(2)} minimum, so the minimum applies`
            : capped ? `${pctTxt} = ${round(raw).toFixed(2)} — capped at ${max.toFixed(2)}` : pctTxt;
        return { amount, explain, capped };
    }

    const amount = round(price * q);
    const min = num(r.minAmount);
    if (min !== null && amount < min) {
        return { amount: round(min), explain: `${q} × ${price.toFixed(2)} = ${amount.toFixed(2)} — below the ${min.toFixed(2)} minimum, so the minimum applies`, capped: false };
    }
    return {
        amount,
        explain: q === 1 ? `${price.toFixed(2)} ${unitLabel(r.unit)}` : `${q} ${unitPlural(r.unit)} × ${price.toFixed(2)}`,
        capped: false,
    };
}

// A one-line summary of the rule for a picker row ("25% of the configuration, min $100.00").
export function feeRuleSummary(rule, unitPrice) {
    const r = rule && rule.mode ? rule : feeRuleOf({ feeRule: rule });
    if (r.mode === 'PERCENT') {
        const pct = num(r.percent);
        const min = num(r.minAmount);
        return `${pct === null ? '—' : pct + '%'} of the configuration${min !== null ? `, min $${min.toFixed(2)}` : ''}`;
    }
    const p = num(unitPrice);
    return `${p === null ? '—' : '$' + p.toFixed(2)} ${unitLabel(r.unit)}`;
}
