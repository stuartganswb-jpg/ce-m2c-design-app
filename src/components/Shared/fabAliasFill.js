// ── FABRICUT'S NUMBER AND PRICES BELONG IN CUSTOMER ALIAS & PRICING (Stuart 2026-10-18) ───────────────────────────────────
// Stuart, on HSOM-19 in the Library: "the fabricut information was entered in the wrong alias area, maybe you can run a search
// to find all of these" → "go ahead on item 2". The search (10-18): 22 items carry Fabricut's pattern # and prices ONLY on a
// Fabricut client-pricing row — 20 Somfy items, the traverse joiner, H1-TTB1, almost all written by the traverse kit-sheet
// import — and H1-2TRVSPLC has a Customer Alias & Pricing box with no number in it. The box (manufacturingSpecs.fabricut) is
// what the Fabricut price levels read — the portal, the price list, the guide — while CPQ reads the customer's row first;
// so an item whose data sits only on the row prices for Fabricut and nowhere else.
//
// The fill is the exact inverse of the Library's "row from the box" (LibraryTab.fabClientRowFor: SKU = pattern #, Client
// Cost = cost, Sales = wholesale; Retail = retail). It never writes over a box that has numbers, never touches a KIT (the
// kit sheet's rows ARE its record, by Stuart's 2026-08 design — "per-customer data lives with the customer"), and never a
// finish variant whose base item carries the tiers (it inherits them). The customer's row stays as it is. Pure.

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
const numOrNull = (v) => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Is this the Fabricut customer? (the same test the Library's own Fabricut button uses) */
export const isFabricutCustomer = (c) => !!c && /fabricut/i.test(S(c.name || c.customerName));
/** The customer's row on an item. */
export const rowOfCustomer = (part, customerId) => ((part && part.clientPricing) || []).find(r => r && U(r.customerId) === U(customerId)) || null;
export const isKitRecord = (part) => !!part && (S(part.partClass) === 'Kit' || /^KIT-/.test(S(part.id)));
// A FEE made in 4.6's fee mode is a customer / collection creature (its row IS its pricing — the flat-rate shipping fees,
// H1-ROF); the fill leaves fees to that screen.
export const isFeeRecord = (part) => !!part && (S(part.partClass) === 'Fee' || /^FEE-/.test(S(part.id)) || U(part.manufacturingSpecs && part.manufacturingSpecs.productType) === 'FEE');
const codeOf = (part) => U((part && part.legacyErpId && part.legacyErpId !== 'PENDING') ? part.legacyErpId : (part && part.itemId));
const hasTierNumbers = (fab) => !!fab && ['cost', 'wholesale', 'retail', 'paintedCost', 'paintedWholesale', 'paintedRetail', 'platedCost', 'platedWholesale', 'platedRetail']
    .some(k => fab[k] !== undefined && fab[k] !== '');
const fabCodesOf = (fab) => (fab ? [fab.fabCodeBase, fab.fabCodePainted, fab.fabCodePremium].map(S).filter(Boolean) : []);

/**
 * What one item's Customer Alias & Pricing should receive from the Fabricut row → { kind, patch, sku, cost, wholesale, retail, why } | null.
 *   kind NEW  — the item has no box: the whole box (pattern # + cost / wholesale / retail)
 *   kind CODE — the item has a box with prices but no pattern #: the number only
 *   baseFab   — the box of the item's base (the code before "/"), when the item is a finish variant
 */
export function aliasFillOf({ part, row, baseFab = null, at = Date.now(), by = '' } = {}) {
    if (!part || !row || isKitRecord(part) || isFeeRecord(part)) return null;
    const sku = S(row.clientSku);
    const cost = numOrNull(row.price), wholesale = numOrNull(row.clientSalesPrice), retail = numOrNull(row.clientRetailPrice);
    const fab = part.manufacturingSpecs && part.manufacturingSpecs.fabricut;
    if (!fab) {
        if (baseFab && (hasTierNumbers(baseFab) || fabCodesOf(baseFab).length)) return null;   // a variant inherits its base's tiers
        if (!sku && cost === null && wholesale === null && retail === null) return null;       // nothing on the row to move
        const box = { ...(sku ? { fabCodeBase: sku } : {}), ...(cost !== null ? { cost } : {}), ...(wholesale !== null ? { wholesale } : {}),
            ...(retail !== null ? { retail } : {}), source: 'CLIENT_MAPPING', importedAt: at, ...(S(by) ? { importedBy: S(by) } : {}) };
        return { kind: 'NEW', patch: { 'manufacturingSpecs.fabricut': box }, sku, cost, wholesale, retail, why: 'no Customer Alias & Pricing — filled from the Fabricut row' };
    }
    if (!fabCodesOf(fab).length && sku) {
        return { kind: 'CODE', patch: { 'manufacturingSpecs.fabricut.fabCodeBase': sku }, sku, cost: null, wholesale: null, retail: null, why: 'the box has prices but no pattern # — the number from the Fabricut row' };
    }
    return null;
}

/** The whole plan for a list of items (one brand's library) → [{ id, code, name, kind, sku, cost, wholesale, retail, patch, why }]. */
export function aliasFillPlanOf({ items = [], customerId, by = '', at = Date.now() } = {}) {
    const byCode = new Map((items || []).filter(Boolean).map(p => [codeOf(p), p]));
    return (items || []).filter(Boolean).map(part => {
        const row = rowOfCustomer(part, customerId);
        if (!row) return null;
        const code = codeOf(part), base = code.includes('/') ? code.split('/')[0] : '';
        const baseDoc = base ? byCode.get(base) : null;
        const fill = aliasFillOf({ part, row, baseFab: baseDoc && baseDoc.manufacturingSpecs && baseDoc.manufacturingSpecs.fabricut, at, by });
        return fill ? { id: part.id, code, name: S(part.itemName), ...fill } : null;
    }).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}
