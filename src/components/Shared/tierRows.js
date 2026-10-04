// ── A CUSTOMER ROW FROM THE TIERS — ONE READER, ONE SOURCE PER ROW (Stuart 2026-10-04, 4.6 · H1-138BST) ──────────
// "i am trying to hit the button seed fabricut row from tiers, which i thought would copy the same information i
//  have on the base item onto all the stocked /ep finishes, but its behavior is weird."
// Three things were wrong, all in 4.6's own copy of the rule:
//   · the reader did not know what the price engine knows — a finish variant with no tier box of its own INHERITS
//     the base item's tiers (Shared/priceLevels.fabricutPriceOf, 2026-08-12). So CPQ quoted H1-138BST/EP1 at the
//     plated tier while 4.6 showed the variant blank and its seed said "No sellable tier price on this item";
//   · it filled a row field by field: the base's own cost ($13) beside the PAINTED wholesale and retail (24 / 48)
//     — one row, two sources;
//   · the button wrote the one item whose editor was open, never its finishes.
// The rule, here and nowhere else:
//   · ONE SOURCE PER ROW. An item with a price of its own (cost / wholesale / retail on its own box) → those, and
//     only those. Else the tier its finish suffix names: /EPn and the outsourced codes (/P25) → PLATED, anything
//     else → PAINTED. A blank stays blank; nothing is borrowed from another tier. (Wholesale alone falls back to
//     retail ÷ 2 of the SAME source — the Traversing sheet has no wholesale column.)
//   · A VARIANT WITH NO BOX OF ITS OWN reads the base's tier for its suffix — never the base's own price (that
//     is the mill item's rate), exactly as the engine prices it.
//   · their part # is the engine's (fabricutCodeOf): premium for a plated suffix, painted otherwise.
//   · SEEDING FROM A BASE writes the base's row and a row on every STOCKED, live finish under it; from a variant,
//     that variant alone. Each write is listed before it happens, and a row it would replace is named.
// Pure. Harness: scripts/tierRows.test.mjs.

import { fabricutCodeOf, isPlatedSuffix } from './priceLevels.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
export const tierCodeOf = (p) => U((p && p.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p && p.itemId)) || '');
const has = (v) => v !== undefined;
const cell = (v) => (v === null || v === undefined ? '' : v);
const TIER_KEYS = {
    OWN: ['cost', 'wholesale', 'retail'],
    PAINTED: ['paintedCost', 'paintedWholesale', 'paintedRetail'],
    PLATED: ['platedCost', 'platedWholesale', 'platedRetail'],
};
export const TIER_LABEL = { OWN: "the item's own price", PAINTED: 'painted tier', PLATED: 'plated tier' };

/**
 * The customer row an item's tiers give — or null (no price at that source; a group-priced $0 plate).
 * @returns {null | { clientSku, price, clientSalesPrice, clientRetailPrice, plated, tier: 'OWN'|'PAINTED'|'PLATED', inherited }}
 */
export function tierRowOf(part, findByCode, outsourceCodes) {
    if (!part) return null;
    const code = tierCodeOf(part);
    const [base, sfx = ''] = code.split('/');
    const plated = isPlatedSuffix(sfx, outsourceCodes);
    let fab = part.manufacturingSpecs && part.manufacturingSpecs.fabricut;
    let inherited = false;
    if (!fab && sfx && typeof findByCode === 'function') {
        const baseDoc = findByCode(base);
        fab = (baseDoc && baseDoc.manufacturingSpecs && baseDoc.manufacturingSpecs.fabricut) || null;
        inherited = !!fab;
    }
    if (!fab) return null;
    const own = !inherited && (has(fab.cost) || has(fab.wholesale) || has(fab.retail));
    const tier = own ? 'OWN' : (plated ? 'PLATED' : 'PAINTED');
    const [kCost, kWs, kRetail] = TIER_KEYS[tier];
    const cost = fab[kCost], retail = fab[kRetail];
    let ws = fab[kWs];
    if (ws === undefined || ws === null) ws = Number.isFinite(parseFloat(retail)) ? parseFloat(retail) / 2 : null;
    if (cost === undefined && retail === undefined) return null;   // nothing at this source
    if (cost === null && retail === null) return null;             // group-priced ($0 with the arm) — stays out of Client Pricing
    return {
        clientSku: fabricutCodeOf(part, findByCode, outsourceCodes) || '',
        price: cell(cost), clientSalesPrice: cell(ws), clientRetailPrice: cell(retail),
        plated, tier, inherited,
    };
}

/** The live, stocked finish variants of a base item (CODE/…): not retired, not an alias record. */
export function stockedVariantsOf(basePart, inventory = []) {
    const base = tierCodeOf(basePart);
    if (!base || base.includes('/')) return [];
    return (inventory || [])
        .filter(p => p && p.id !== basePart.id && tierCodeOf(p).startsWith(`${base}/`))
        .filter(p => { const ms = p.manufacturingSpecs || {}; return ms.isStocked === true && ms.isRetired !== true && !ms.aliasOf; })
        .sort((a, b) => tierCodeOf(a).localeCompare(tierCodeOf(b)));
}

const same = (a, b) => String(a == null ? '' : a) === String(b == null ? '' : b);
const HAND = (r) => !r.source || !/^(TIER_SEED|ADOPTED_)/.test(String(r.source));

/**
 * What a seed would write. From a base: the base and its stocked variants; from a variant: itself.
 * @param customerKeys  a Set of the customer's ids / names, UPPERCASE (the page's custKeys)
 * @returns {{ rows: Array<{ part, code, row, existing, change: 'NEW'|'REPLACE'|'SAME', hand }>, skipped: Array<{ code, why }> }}
 */
export function seedPlanOf({ part, inventory = [], findByCode, outsourceCodes, customerKeys }) {
    const keys = customerKeys || new Set();
    const targets = [part, ...stockedVariantsOf(part, inventory)];
    const rows = [], skipped = [];
    targets.forEach(p => {
        const code = tierCodeOf(p);
        const row = tierRowOf(p, findByCode, outsourceCodes);
        if (!row) { skipped.push({ code, why: p === part && !code.includes('/') ? 'no price of its own on the base item' : 'no price at its tier' }); return; }
        const existing = (p.clientPricing || []).find(r => keys.has(U(r && r.customerId))) || null;
        const change = !existing ? 'NEW'
            : (same(existing.clientSku, row.clientSku) && same(existing.price, row.price) && same(existing.clientSalesPrice, row.clientSalesPrice) && same(existing.clientRetailPrice, row.clientRetailPrice) ? 'SAME' : 'REPLACE');
        rows.push({ part: p, code, row, existing, change, hand: !!existing && HAND(existing) });
    });
    return { rows, skipped };
}

const money = (v) => (v === '' || v === null || v === undefined ? '—' : `$${v}`);
const line = (r) => `${r.clientSku || 'no part #'} · net ${money(r.price)} · sales ${money(r.clientSalesPrice)} · retail ${money(r.clientRetailPrice)}`;

/** The words the confirm shows — every row it will write, and what each one replaces. */
export function seedConfirmText(plan, customerName = 'the customer') {
    const writes = plan.rows.filter(x => x.change !== 'SAME');
    const out = [`Write ${writes.length} ${customerName} price row${writes.length === 1 ? '' : 's'} from the saved tiers?`, ''];
    writes.forEach(x => {
        out.push(`${x.code}  →  ${line(x.row)}  (${TIER_LABEL[x.row.tier]}${x.row.inherited ? ', from the base item' : ''})`);
        if (x.change === 'REPLACE') out.push(`      replaces ${x.hand ? 'a HAND-ENTERED row' : 'the row'}: ${line(x.existing)}`);
    });
    const sameN = plan.rows.length - writes.length;
    if (sameN) out.push('', `${sameN} row${sameN === 1 ? '' : 's'} already match${sameN === 1 ? 'es' : ''} — left as ${sameN === 1 ? 'it is' : 'they are'}.`);
    if (plan.skipped.length) out.push('', `Not written: ${plan.skipped.map(s => `${s.code} (${s.why})`).join(', ')}.`);
    return out.join('\n');
}

/** The stored row. */
export const seedRowDoc = (row, { customerId, customerName = '', by = '', now = Date.now() }) => ({
    customerId, customerName, clientSku: row.clientSku || '', price: row.price, clientSalesPrice: row.clientSalesPrice,
    clientRetailPrice: row.clientRetailPrice, source: 'TIER_SEED', updatedAt: now, updatedBy: String(by || ''),
});
