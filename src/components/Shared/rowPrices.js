// A PRICE TYPED OVER THE ENGINE'S, ON ONE PART OF A CPQ CONFIGURATION (Stuart 2026-10-20: "on the cpq in the cart down below, can
// you make it editable, i have quote to prepare for a different customer and it is for parts on the fabricut 4.6 so many will not price
// correctly i need and easy way to over rule prices that come up" · 2026-10-21: "1. yes, 2. manager or higher 3. only a manual apply
// discount can still be used, the customer netsuite level is ignored. 4. correct").
//
// The configurator's Pricing box gives each part a price can be typed on a $ box (a manager or higher — Shared/lineDiscount
// .canLineDiscount). What is typed is the UNIT price — per foot on a pole sold by the foot, the way the box already says it. At
// "+ Add configuration" CPQ bakes it into the cart line: the row's price and total and the line's pricing.finalPrice — the figures every
// reader downstream already reads (the save, the documents, the NetSuite push, the portal's card) — with the engine's own figures kept
// beside them (enginePrice / engineTotal / pricing.engineFinalPrice) for the box to show what was over-ruled. The typed map rides the
// line (rowPrices), so Edit, a Vision re-save and a reload bring it back. Paper prints the typed price as the price, unmarked.
//
// Discounts (decision 3): the customer's own standing discount (their code — CPQTab tradeDiscountFor, CODE) leaves a typed price
// alone; a discount applied by hand still reaches it (the order % typed at checkout, a manager's line discount).
// HQ only: no engine door imports this (scripts/sync-engine.mjs), so a portal customer can never type a price.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A price can be typed on a row that carries its own money: shown (hidden parts are billed but never listed), not a part a kit
 *  already paid for (inKit · covered by the kit · one of a kit's own parts), not a kit's per-foot row (billed by the kit's feet).
 *  A kit's own row — the kit price — can. */
export function priceSettable(row) {
    if (!row || row.hidden) return false;
    if (row.inKit || row.kitOf || Number(row.coveredQty) > 0) return false;
    if (row.billedFeet !== undefined && row.billedFeet !== null) return false;
    return true;
}

/** What the unit price is multiplied by to make the row's total — the engine's own rule (hardwarePricing: unit × qty × feet on a
 *  pole sold by the foot). */
export const factorOf = (row) => (Number(row && row.qty) > 0 ? Number(row.qty) : 1) * (row && row.perFoot ? (Number(row.feet) || 0) : 1);

/** A typed map, clean: finite prices of $0 or more, by key. */
export function cleanRowPrices(map) {
    const out = {};
    Object.entries(map && typeof map === 'object' ? map : {}).forEach(([k, v]) => {
        if (v === '' || v === null || v === undefined) return;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0) out[k] = round2(n);
    });
    return out;
}

// ── ONE KEY FOR ONE PART, ON THE BOX AND ON THE LINE IT BECOMES ──────────────────────────────────────────────────────────────────────
// kind P = the engine's priced lines · H = added by hand · T = traverse components; then the part (the doc id the cart line carries)
// and where it sits (role, position, tier); a repeat of the same key counts on (#2, #3…) in list order — the configurator's box and the
// handoff list each kind's rows in the same order.
const keyOf = (kind, id, role, position, tier) => [kind, U(id), U(role), U(position), U(tier)].join('|');
function numbered(keys) {
    const seen = new Map();
    return keys.map(k => { const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n === 1 ? k : `${k}#${n}`; });
}
/** The configurator's rows → their keys. `lines` = the engine's priced lines (ALL of them, hidden too — the line keeps them),
 *  `extraLines` = added by hand (partId is the tab-11 code: findPart gives the doc id the line will carry), `trvLines` = components. */
export function boxRowKeys({ lines = [], extraLines = [], trvLines = [], findPart = () => null }) {
    const p = numbered(lines.map(l => keyOf('P', l.soldPartId || l.partId, l.role, l.position, l.tier)));
    const h = numbered(extraLines.map(l => keyOf('H', (findPart(l.partId) || {}).id || l.partId, '', '', '')));
    const t = numbered(trvLines.map(l => keyOf('T', l.partId, '', '', '')));
    return { lines: p, extraLines: h, trvLines: t };
}
/** A cart line's rows → their keys, in row order. */
export function cartRowKeys(rows = []) {
    const kinds = rows.map(r => (r && r.trvComponent ? 'T' : r && r.addedByHand ? 'H' : 'P'));
    const raw = rows.map((r, i) => (kinds[i] === 'P' ? keyOf('P', r && r.partId, r && r.role, r && r.position, r && r.tier) : keyOf(kinds[i], r && r.partId, '', '', '')));
    // repeats count within the same key, in row order — the kit's bill order keeps a part's repeats together and in order
    return numbered(raw);
}

/** A box row with a typed price, as the box shows it: the typed unit, its total, and the engine's figures for the strike-through. */
export function typedRow(line, unit) {
    return { ...line, engineUnit: Number(line.unit) || 0, engineTotal: Number(line.total) || 0, unit, total: round2(unit * factorOf(line)), typed: true };
}

/**
 * The cart line with the typed prices baked in (idempotent — applied again, or with a price taken away, it returns to the engine's
 * figures where nothing is typed). The rows' price / total, pricing.finalPrice, the traverse components NetSuite reads (rate,
 * billable) and the map itself (rowPrices — only keys that found a row). `by` / `at` say who typed them; nothing prints them.
 */
export function applyRowPrices(item, rowPrices, { by = '', at = '' } = {}) {
    if (!item || !Array.isArray(item.pricingBreakdown)) return item;
    const typed = cleanRowPrices(rowPrices);
    const rows = item.pricingBreakdown;
    const keys = cartRowKeys(rows);
    const used = {};
    const trvTyped = [];   // [code, occurrence, unit] — the components NetSuite prices from
    const trvSeen = new Map();
    const nextRows = rows.map((row, i) => {
        const k = keys[i];
        const isTrv = !!(row && row.trvComponent);
        const occ = isTrv ? (trvSeen.set(U(row.partId), (trvSeen.get(U(row.partId)) || 0) + 1), trvSeen.get(U(row.partId))) : 0;
        const engineUnit = row && row.enginePrice !== undefined ? row.enginePrice : (row && row.price);
        const engineTotal = row && row.engineTotal !== undefined ? row.engineTotal : (row && row.total);
        if (has(typed, k) && priceSettable(row)) {
            used[k] = typed[k];
            if (isTrv) trvTyped.push([U(row.partId), occ, typed[k]]);
            return { ...row, enginePrice: Number(engineUnit) || 0, engineTotal: Number(engineTotal) || 0, price: typed[k], total: round2(typed[k] * factorOf(row)), priceSetByHand: true };
        }
        if (row && row.priceSetByHand) {
            const { enginePrice, engineTotal: et, priceSetByHand, ...rest } = row;
            return { ...rest, price: Number(engineUnit) || 0, total: Number(engineTotal) || 0 };
        }
        return row;
    });
    const any = Object.keys(used).length > 0;
    const comps = Array.isArray(item.trvComponents) ? item.trvComponents : null;
    let nextComps = comps;
    if (comps) {
        const seen = new Map();
        nextComps = comps.map(c => {
            const code = U(c && c.code);
            const n = (seen.get(code) || 0) + 1; seen.set(code, n);
            const hit = trvTyped.find(([tc, o]) => tc === code && o === n);
            const engineRate = c && c.engineRate !== undefined ? c.engineRate : (c && c.rate);
            const engineBillable = c && c.engineBillable !== undefined ? c.engineBillable : (c && c.billable);
            if (hit) return { ...c, engineRate, engineBillable: !!engineBillable, rate: hit[2], billable: hit[2] > 0 ? true : !!engineBillable };
            if (c && c.engineRate !== undefined) { const { engineRate: er, engineBillable: eb, ...rest } = c; return { ...rest, rate: er, billable: !!eb }; }
            return c;
        });
    }
    const pricing = { ...(item.pricing || {}) };
    const engineFinal = pricing.engineFinalPrice !== undefined ? pricing.engineFinalPrice : pricing.finalPrice;
    if (any) { pricing.engineFinalPrice = Number(engineFinal) || 0; pricing.finalPrice = round2(nextRows.reduce((s, r) => s + (Number(r && r.total) || 0), 0)); }
    else if (pricing.engineFinalPrice !== undefined) { pricing.finalPrice = pricing.engineFinalPrice; delete pricing.engineFinalPrice; }
    const out = { ...item, pricingBreakdown: nextRows, pricing, ...(nextComps ? { trvComponents: nextComps } : {}) };
    if (any) { out.rowPrices = used; out.rowPricesSet = { by: String(by || ''), at: String(at || '') }; }
    else { delete out.rowPrices; delete out.rowPricesSet; }
    return out;
}

/** How many prices on a cart line were typed by hand — for the cart's note under it. */
export const typedCountOf = (item) => ((item && item.pricingBreakdown) || []).filter(r => r && r.priceSetByHand).length;
