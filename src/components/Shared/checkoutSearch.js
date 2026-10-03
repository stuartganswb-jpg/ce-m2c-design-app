// ── ANY STOCKED ITEM, AT CHECKOUT (Stuart 2026-10-02) ───────────────────────────────────────────────
// "add the ability at check out, as the last check out choice item, to be an open search field where we can add
//  any stocked item, no apply finish or anything just enter a stocked item, it pulls up customer price if customer
//  selected/loaded if not goes for base price."
//
// The checkout list offers what 4.6 and tab 11 ASSIGN. This is the open door beside it: search the brand's library
// for anything NetSuite holds as stocked (manufacturingSpecs.isStocked — custitem27), never a retired item, never a
// flat-rate shipping box (that is shipping, not a line), never a fee and never a kit. A pick becomes a checkout entry
// of exactly the shape the assigned ones have (Shared/feeRules.buildCheckoutCatalog), priced by the SAME chain —
// the customer's own row when one is loaded, their price level where they price by one, else base — so from the
// moment it is picked it is an ordinary checkout line: its own NetSuite line, routed by its own Part Handling, on
// the quote among the products. A quote reopened with one keeps it.
// Pure — no React, no Firestore. Harness: scripts/checkoutSearch.test.mjs.

import { feeRuleOf, feeRuleSummary, isFeeItemRecord } from './feeRules.js';
import { isShippingItem } from './flatRateShipping.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const codeOf = (p) => U((p && p.legacyErpId && p.legacyErpId !== 'PENDING') ? p.legacyErpId : (p && p.itemId));

/** May this record be added from the search? */
export const isSearchableStockedItem = (p) => !!p
    && p.manufacturingSpecs?.isStocked === true
    && p.manufacturingSpecs?.isRetired !== true
    && p.partClass !== 'Kit'
    && !isFeeItemRecord(p)
    && !isShippingItem(p);

/**
 * Up to `limit` stocked items matching the words typed — every word must appear in the code or the name.
 * An exact code first, then codes that start with it, then the rest by code.
 * @param exclude  doc ids already on the checkout list
 */
export function searchStockedItems(parts = [], query = '', { exclude = [], limit = 12 } = {}) {
    const words = U(query).split(/\s+/).filter(Boolean);
    if (!words.length || U(query).length < 2) return [];
    const skip = new Set((exclude || []).map(String));
    const seen = new Set();
    const q = U(query);
    const rank = (p) => { const c = codeOf(p); return c === q ? 0 : (c.startsWith(q) ? 1 : 2); };
    return (parts || [])
        .filter(p => p && p.id && !skip.has(String(p.id)) && !seen.has(p.id) && seen.add(p.id) && isSearchableStockedItem(p))
        .filter(p => { const hay = `${codeOf(p)} ${U(p.itemName)}`; return words.every(w => hay.includes(w)); })
        .sort((a, b) => rank(a) - rank(b) || codeOf(a).localeCompare(codeOf(b)))
        .slice(0, Math.max(1, limit));
}

/**
 * Checkout entries for items picked from the search — the shape buildCheckoutCatalog gives the assigned ones,
 * `via: 'SEARCH'`. No finish is ever applied: the line bills the item as it is stocked.
 */
export function pickedItemEntries(parts = [], { priceFor, skuFor } = {}) {
    return (parts || []).filter(Boolean).map(p => {
        const rule = feeRuleOf(p.manufacturingSpecs);
        const unitPrice = typeof priceFor === 'function' ? priceFor(p) : (Number(p?.manufacturingSpecs?.basePrice) || 0);
        return {
            id: p.id,
            code: codeOf(p),
            clientSku: typeof skuFor === 'function' ? (skuFor(p) || '') : '',
            name: p.itemName || '',
            partHandling: p?.manufacturingSpecs?.partHandling || '',
            isFee: isFeeItemRecord(p),
            rule, unitPrice: unitPrice ?? null,
            portalOk: false,
            summary: `${feeRuleSummary(rule, unitPrice)} · added by search`,
            via: 'SEARCH',
        };
    });
}
