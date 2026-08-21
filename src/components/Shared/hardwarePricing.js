// ─────────────────────────────────────────────────────────────────────────────────────────────
// PRICING FOR THE TAG-DRIVEN ENGINE (Stuart 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "please refer back to the customer alias and pricing window assigned to every item in a
//  collection. this resides in the master library and is maintained in tab 4.6 … when there is
//  information there and the collection is chosen, this is the pricing rules. portal allows
//  selection of at client cost (our selling price), wholesale (their selling price) or retail, end
//  customers resale price. if this does not exist it falls back to base price on item. Lastly there
//  can be an over-ride set up the flow's step. the customer alias box also contains their part#
//  which is important to display."
//
// ⚠ THIS FILE ADDS NO PRICING RULES. Every rule already exists and is already trusted — the tiers
// in Shared/priceLevels, the per-customer rows in Shared/clientPricing. There is a great deal of
// work behind both, and re-deriving any of it here would create a SECOND pricing implementation
// that drifts from the first. That is precisely the mistake that cost this week in the geometry
// engine, and it would cost more here, because a wrong price ships on an invoice rather than
// looking wrong on a screen. So this composes them, in one documented order, and nothing else.
//
// THE ORDER, most specific wins:
//   1. OVERRIDE      an explicit price authored on the pin. Beats everything, by definition.
//   2. PRICE LEVEL   cost / wholesale / retail from the item's Customer Alias & Pricing box, when
//                    a level other than Standard is selected AND the item carries tier data.
//                    Painted vs plated follows the chosen finish (…/EPn and /P25 are plated).
//   3. CLIENT ROW    this customer's negotiated price for this item (4.6, matched by CRM id or by
//                    name — rows have been hand-entered both ways for years).
//   4. BASE PRICE    the item's own price. The floor, and what "if this does not exist" means.
//
// An item with NO price under any rule prices at 0 and SAYS SO, rather than quietly reading as
// free. `source` on every result names the rule that decided it, so a quote line can always answer
// "why does it cost that" without anyone reading this file.
//
// THEIR PART NUMBER TRAVELS WITH THE PRICE. The same 4.6 box carries the customer's own SKU for the
// item; it is what the customer recognises, so it is returned here rather than looked up separately
// somewhere that might forget to.

import { customerKeys, clientPriceFor, findClientPriceRow } from './clientPricing.js';
import { fabricutPriceOf, fabricutCodeOf, priceLevelShort } from './priceLevels.js';
import { finishVariantOf } from './finishVariant.js';
import { ROD_ROLES } from './hardwareModel.js';

export const PRICE_SOURCES = {
    OVERRIDE: 'authored override',
    LEVEL: 'price level (4.6 tier)',
    CLIENT: 'customer price (4.6)',
    BASE: 'item base price',
    NONE: 'no price on this item',
};

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

/**
 * What one selected part costs, and why.
 *
 * @param choice   a resolved hardware-model choice (carries partId and any authored price)
 * @param part     the Approved_Designs doc for that part — the carrier of basePrice,
 *                 clientPricing[] and the manufacturingSpecs tier box
 * @param ctx      { customerId, customer, priceLevel, finishCode, outsourceCodes, findByCode }
 * @returns { price, source, sku, aliasCode, detail }
 */
export function priceChoice(choice, part, ctx = {}) {
    const { customerId, customer, priceLevel = 'STANDARD', finishCode, outsourceCodes, findByCode } = ctx;
    // ── 0 — WHICH RECORD IS THIS, ONCE A FINISH IS CHOSEN ────────────────────────────────────
    // Before anything is priced, the mill base resolves to the item that is actually sold: the /P
    // paint rollup, the exact /EPn plating, the generic /EP on a fee. This is identity, not a
    // pricing rule — but every rule below reads the RESOLVED record, because the mill item
    // legitimately has no price, no tier and no pattern number, and pricing it was reporting "no
    // price under any rule" for parts that are priced perfectly well under their real SKU.
    const sold = finishVariantOf(part, finishCode, findByCode) || part;
    const billedId = sold ? String(
        (sold.legacyErpId && sold.legacyErpId !== 'PENDING' ? sold.legacyErpId : sold.itemId) || ''
    ).trim() : '';
    part = sold;
    const keys = customerId ? customerKeys(customerId, customer) : null;
    const row = (part && keys) ? findClientPriceRow(part.clientPricing, keys) : null;
    // Their part number, from the same box as their price — shown wherever the line is shown.
    const sku = row?.clientSku ? String(row.clientSku).trim() : '';
    const aliasCode = part ? (fabricutCodeOf(part, findByCode, outsourceCodes) || '') : '';
    const out = (price, source, detail) => ({ price: price || 0, source, sku, aliasCode, billedId, detail: detail || '' });

    // 1 — an authored override on the pin wins outright.
    const override = num(choice?.price);
    if (override !== null && override > 0) return out(override, PRICE_SOURCES.OVERRIDE, 'priced on the pin');

    if (!part) return out(0, PRICE_SOURCES.NONE, 'no library item resolved for this choice');

    // 2 — the selected price level, when this item has tier data to answer with. Items without it
    //     (fees, one-offs) fall through untouched, so a quote is a faithful mix rather than a
    //     level applied by force.
    if (priceLevel && priceLevel !== 'STANDARD') {
        const lv = fabricutPriceOf(part, priceLevel, finishCode, outsourceCodes, findByCode);
        if (lv !== null && lv !== undefined) return out(lv, PRICE_SOURCES.LEVEL, `${priceLevel}${finishCode ? ` · finish ${finishCode}` : ''}`);
    }

    // 3 — this customer's negotiated price.
    if (keys) {
        const cv = clientPriceFor(part.clientPricing, keys);
        if (cv !== null) return out(cv, PRICE_SOURCES.CLIENT, row?.customerId ? `row keyed "${row.customerId}"` : '');
    }

    // 4 — the item's own price.
    const base = num(part.manufacturingSpecs?.basePrice);
    if (base !== null && base > 0) return out(base, PRICE_SOURCES.BASE, '');
    return out(0, PRICE_SOURCES.NONE, `nothing on ${billedId || 'this item'} at ${priceLevel === 'STANDARD' ? 'standard pricing' : priceLevelShort(priceLevel)} — no override, no tier, no customer row, no base price`);
}

/**
 * Price a whole configuration. Returns one line per selected part, plus the total.
 *
 * Riders are included — a carrier is built and billed even though it is never offered as a choice,
 * which is the entire reason `always` exists.
 */
export function priceConfiguration(model, ctx = {}) {
    const { findPart } = ctx;
    const lines = (model?.bom || []).map(entry => {
        const choice = entry.raw && entry.raw.__choice ? entry.raw.__choice : entry;
        const part = typeof findPart === 'function' ? findPart(entry.partId) : null;
        const p = priceChoice(choice, part, ctx);
        // ⚠ ROD STOCK IS SOLD BY THE FOOT (Stuart 2026-08-20: "it needs to take billed ft qty on
        // step 6 and multiply it times price of selected rod in 10 and 11 if double"). H1-138R is
        // "Round Hollow Rod Stock" at 12.50 — a foot of it, not a pole of it — so a ten-foot order
        // was billing 12.50 for the whole rod. Same for a fascia and a track: all three are cut
        // from linear stock, and all three are ROD_ROLES.
        //
        // Only rods. A finial does not get longer with the pole. And only where the length has
        // actually been answered — before that this multiplies by nothing and the line reads as it
        // always did, rather than quietly showing a per-foot price as if it were the total.
        // ⚠ THE POLE IS ONE LINE (Stuart 2026-08-20: "the pole should be on the bom as one line
        // item, one pole 119\" - 10ft"). The footage is how it is PRICED, not how many there are —
        // billing ten feet must never read as ten poles on the router. So the quantity stays at
        // one, the feet multiply the money, and the length travels as the cut.
        const feet = Number(ctx.billedFeet) > 0 ? Number(ctx.billedFeet) : 0;
        const perFoot = feet > 0 && ROD_ROLES.includes(entry.role);
        const qty = Number(entry.qty) > 0 ? Number(entry.qty) : 1;
        const inches = Number(ctx.lengthInches) > 0 ? Number(ctx.lengthInches) : 0;
        return {
            partId: entry.partId,
            name: entry.name,
            sku: p.sku,
            aliasCode: p.aliasCode,
            billedId: p.billedId,   // the finished SKU that is actually sold and billed
            qty,
            perFoot,                  // the line is priced by the foot — the panel says so
            ...(perFoot ? { feet } : {}),
            // What the shop cuts to. Read by RTG, the floor, the labels and packaging — and never
            // set by this engine until now, so a pole reached the bench with no length on it.
            ...(perFoot && inches ? { cutLength: inches } : {}),
            unit: p.price,
            total: p.price * qty * (perFoot ? feet : 1),
            source: p.source,
            detail: p.detail,
            hidden: !!entry.hidden,   // built and billed, never shown on a customer document
            role: entry.role || '',
            position: entry.position || '',
        };
    });
    return { lines, total: lines.reduce((s, l) => s + l.total, 0) };
}

/**
 * Lines a human should look at before quoting. Being loud about a $0 line is the point: a part
 * that silently prices at nothing is how a quote goes out under cost.
 */
export function pricingWarnings({ lines }) {
    const out = [];
    lines.filter(l => l.source === PRICE_SOURCES.NONE).forEach(l =>
        out.push({ sev: 'red', msg: `${l.name}${l.billedId || l.partId ? ` (${l.billedId || l.partId})` : ''} has no price under any rule — ${l.detail}. It is quoting at $0.` }));
    return out;
}

/**
 * The customer's own name for a part, with no pricing involved.
 *
 * The pricing path already returns this, but only for parts that are ON the order — so an option
 * the customer had not chosen yet showed our number alone, in the one place (the picker) where
 * their number is most useful for reading a request back over the phone. Their negotiated row's
 * SKU wins; the item's resolved pattern # stands in when there is no row.
 *
 * @param part the library doc (already finish-resolved, or a mill base — the pattern # falls back
 *             to the base doc either way)
 */
export function aliasFor(part, ctx = {}) {
    const { customerId, customer, outsourceCodes, findByCode } = ctx;
    if (!part) return '';
    const keys = customerId ? customerKeys(customerId, customer) : null;
    const row = keys ? findClientPriceRow(part.clientPricing, keys) : null;
    const sku = row?.clientSku ? String(row.clientSku).trim() : '';
    return sku || fabricutCodeOf(part, findByCode, outsourceCodes) || '';
}
