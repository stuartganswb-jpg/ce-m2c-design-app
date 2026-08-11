// FEE RULE ARITHMETIC — CJS PORT of the pieces of src/components/Shared/feeRules.js the BFF
// needs (feeRuleOf normalization, computeFee, feeRuleSummary, the fee/checkout predicates).
//
// ⚠ MIRROR: Cloud Functions deploys only functions/, CRA only imports from src/ — neither can
// reach the other. This is a subset port, not the whole module (FEE_MODES, buildFeeCatalog and
// buildAddOnLines stay app-side). If the src arithmetic changes, change this file in the same
// commit. The WHY of the rule shapes lives in the src copy's header.

const FEE_UNITS = [
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
const unitLabel = (id) => (FEE_UNITS.find((u) => u.id === id) || FEE_UNITS[0]).label;
const unitPlural = (id) => (FEE_UNITS.find((u) => u.id === id) || FEE_UNITS[0]).plural;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

const feeRuleOf = (specs) => {
    const r = (specs && specs.feeRule) || {};
    const mode = String(r.mode || '').toUpperCase() === 'PERCENT' ? 'PERCENT' : 'FLAT';
    return {
        mode,
        unit: FEE_UNITS.some((u) => u.id === r.unit) ? r.unit : 'EACH',
        percent: num(r.percent),
        minAmount: num(r.minAmount),
        maxAmount: num(r.maxAmount),
        portalSelectable: r.portalSelectable === true,
        defaultQty: num(r.defaultQty) || 1,
        note: String(r.note || ''),
    };
};

function computeFee({ rule, unitPrice, qty, configSubtotal }) {
    const r = rule && rule.mode ? rule : feeRuleOf({ feeRule: rule });
    const q = Math.max(0, num(qty) ?? 1);
    const price = num(unitPrice) ?? 0;
    const base = Math.max(0, num(configSubtotal) ?? 0);
    const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

    if (r.mode === 'PERCENT') {
        const pct = num(r.percent) ?? 0;
        const raw = base * (pct / 100);
        const min = num(r.minAmount);
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

const isFeeItemRecord = (p) => {
    const u = (v) => String(v || '').trim().toUpperCase();
    const pt = u(p && p.manufacturingSpecs && p.manufacturingSpecs.productType || p && p.productType);
    return pt === 'FEE' || (p && p.partClass === 'Fee') || /(^|-)FEE-/.test(u(p && (p.legacyErpId || p.itemId)));
};

const isCheckoutSelectable = (part) => !!(part && part.manufacturingSpecs && part.manufacturingSpecs.checkoutSelectable === true);

function feeRuleSummary(rule, unitPrice) {
    const r = rule && rule.mode ? rule : feeRuleOf({ feeRule: rule });
    if (r.mode === 'PERCENT') {
        const pct = num(r.percent);
        const min = num(r.minAmount);
        return `${pct === null ? '—' : pct + '%'} of the configuration${min !== null ? `, min $${min.toFixed(2)}` : ''}`;
    }
    const p = num(unitPrice);
    return `${p === null ? '—' : '$' + p.toFixed(2)} ${unitLabel(r.unit)}`;
}

module.exports = { feeRuleOf, computeFee, feeRuleSummary, isFeeItemRecord, isCheckoutSelectable, unitLabel, unitPlural };
