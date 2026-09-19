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
import { takesNoFinish } from './finishLabel.js';
import { fabricutPriceOf, fabricutCodeOf, priceLevelShort, isPlatedSuffix } from './priceLevels.js';
import { finishVariantOf, stockColourVariantOf } from './finishVariant.js';
import { speciesVariantOf } from './sizeMatrix.js';
import { ROD_ROLES, companionsFor } from './hardwareModel.js';

export const PRICE_SOURCES = {
    OVERRIDE: 'authored override',
    LEVEL: 'price level (4.6 tier)',
    CLIENT: 'customer price (4.6)',
    BASE: 'item base price',
    // ⚠ LAST RESORT, AND IT SAYS SO ON THE LINE (Stuart 2026-08-21: "an area to apply a default
    // back up price per step"). A collection mid-set-up has items nobody has priced yet, and a $0
    // line is worse than a rough one — it goes out under cost and nothing about the quote objects.
    // So a flow may carry a fallback PER KIND OF PART, used only where every real rule has failed.
    // It can never overrule a price somebody actually set, and a line quoted this way is called out
    // in the warnings, because a number nobody chose per item must not pass quietly as one.
    FALLBACK: 'flow default (no price on the item)',
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
 *                 …and optionally `finishFor(choice, entry)` — the per-part finish, where the
 *                 caller allows a part to be finished differently from the configuration.
 * @returns { price, source, sku, aliasCode, detail }
 */
export function priceChoice(choice, part, ctx = {}) {
    const { customerId, customer, priceLevel = 'STANDARD', finishCode, outsourceCodes, findByCode, levelIsDefault } = ctx;
    // ── 0 — WHICH RECORD IS THIS, ONCE A FINISH IS CHOSEN ────────────────────────────────────
    // Before anything is priced, the mill base resolves to the item that is actually sold: the /P
    // paint rollup, the exact /EPn plating, the generic /EP on a fee. This is identity, not a
    // pricing rule — but every rule below reads the RESOLVED record, because the mill item
    // legitimately has no price, no tier and no pattern number, and pricing it was reporting "no
    // price under any rule" for parts that are priced perfectly well under their real SKU.
    // ── 0a — THE SPECIES FIRST (Stuart 2026-09-16: "the items on the bom should be H1-138WEC-O
    //        rather than just H1-138WEC"). A stain tagged OAK / WALNUT in 4.5 carries a bomSuffix, and
    //        the physical item consumed is the per-species one (H1-138WEC-O / -W; the wood pole through
    //        its customData.speciesMap). The NetSuite push already did this swap, so NetSuite billed the
    //        oak cap while the breakdown, the work order and the pick all said the base code — the same
    //        rule, in the one place every consumer reads. Identity when the finish has no suffix, or
    //        when the caller passes no finish lookup (`ctx.finishObjOf`), so every other line is exactly
    //        as it was. Runs BEFORE the /P //EPn swap, as the old engine ordered it (sizeMatrix).
    const finishObj = (finishCode && typeof ctx.finishObjOf === 'function') ? (ctx.finishObjOf(finishCode) || null) : null;
    const basePart = part;
    const speciesPart = speciesVariantOf(part, finishObj, findByCode) || part;
    const speciesSwapped = !!part && speciesPart !== part;
    // ── 0b — A STOCK COLOUR (Stuart 2026-09-18): a part that wears no finish of its own but is made in
    //        the order's aligned stock colour is SOLD as that item — H1-2TRV-WB + TCP → H1-2TRV-WB/C.
    const stockColour = (!finishCode && ctx.subFinishCode) ? stockColourVariantOf(speciesPart, ctx.subFinishCode, findByCode) : null;
    const sold = stockColour || finishVariantOf(speciesPart, finishCode, findByCode) || speciesPart;
    const billedId = sold ? String(
        (sold.legacyErpId && sold.legacyErpId !== 'PENDING' ? sold.legacyErpId : sold.itemId) || ''
    ).trim() : '';
    // The chain below prices ONE record. It runs on the sold record; when that record is a species
    // variant with no price of its own, it runs again on the base product — to Fabricut a wood item
    // is ONE product at ONE price (Stuart 2026-07-09), and the -O / -W record is the thing consumed,
    // not a second price list. The billed identity stays the species item either way.
    const chain = (part) => {
        const keys = customerId ? customerKeys(customerId, customer) : null;
        const row = (part && keys) ? findClientPriceRow(part.clientPricing, keys) : null;
        // Their part number, from the same box as their price — shown wherever the line is shown.
        const sku = row?.clientSku ? String(row.clientSku).trim() : '';
        const aliasCode = part ? (fabricutCodeOf(part, findByCode, outsourceCodes) || '') : '';
        const out = (price, source, detail) => ({ price: price || 0, source, sku, aliasCode, billedId, ...(stockColour ? { soldPartId: stockColour.id } : {}), detail: detail || '' });

        // 1 — an authored override on the pin wins outright.
        const override = num(choice?.price);
        if (override !== null && override > 0) return out(override, PRICE_SOURCES.OVERRIDE, 'priced on the pin');

        if (!part) return out(0, PRICE_SOURCES.NONE, 'no library item resolved for this choice');

        // ⚠ A DEFAULTED LEVEL IS A FALLBACK, NOT A DECISION (Eric via Stuart, 2026-08-21: "For Brimar,
        // the French Return pricing is coming in at $35, which is the Fabricut painted standard price,
        // and not the $45 defined for the Brimar fee").
        //
        // Selecting a customer quietly defaults the level to FAB_COST — "our cost to them" — which was
        // right for the problem it solved: a mill item has no base price, so a connected customer got a
        // screen of $0.00 lines with a perfectly good number sitting in the tier box beside them.
        //
        // But the tier box belongs to the ITEM, not to the customer being quoted, and it is Fabricut's
        // data. Applied to BRIMAR it prices their french return off somebody else's sheet — and it beat
        // Brimar's OWN negotiated row, which was sitting right there (the line even printed their SKU,
        // DFR01, from the row whose price it had just skipped).
        //
        // So the order depends on whether the level was CHOSEN or merely defaulted:
        //   · chosen (staff picked Fabricut Cost / Wholesale / Retail) → the level means it, and wins.
        //   · defaulted → the customer's own row is the more specific fact and wins; the level stays
        //     underneath it, still catching the mill items that have no row and no base price, which is
        //     the whole reason it exists.
        // ── A TWO-PART FINIAL IS PRICED BY ITS COLLAR'S FINISH (Stuart 2026-09-19, the wood gem: "where do
        // i assign the plating upcharge for the gem, i am assuming on the collar portion?"). H1-138WGF is
        // ONE product to Fabricut — H1551F painted at 47, H1551F PREMIUM plated at 55 — and both tiers sit
        // on the one record. But the top is wood (or acrylic): the finish on ITS line is a stain, or
        // nothing, so the tier always read painted and a plated collar billed 47. What is plated is the
        // collar, so the collar's finish picks the tier (`ctx.tierFinishCode`, set by priceConfiguration
        // for a part that requires a collar, and by nothing else).
        const tierFinish = ctx.tierFinishCode || finishCode;
        const levelPrice = () => {
            if (!priceLevel || priceLevel === 'STANDARD') return null;
            const lv = fabricutPriceOf(part, priceLevel, tierFinish, outsourceCodes, findByCode);
            return (lv === null || lv === undefined) ? null : lv;
        };
        const clientPrice = () => (keys ? clientPriceFor(part.clientPricing, keys) : null);
        const levelOut = (lv) => out(lv, PRICE_SOURCES.LEVEL, `${priceLevel}${finishCode ? ` · finish ${finishCode}` : ''}${levelIsDefault ? ' · defaulted' : ''}`);
        const clientOut = (cv) => out(cv, PRICE_SOURCES.CLIENT, row?.customerId ? `row keyed "${row.customerId}"` : '');

        // …and a PLATED collar outranks the customer's row even under a defaulted level: that row is one
        // number (4.6 seeds it from the painted tier) and cannot hold both, while the plated tier on the
        // same record is the same customer's own price for exactly this case. Their PREMIUM part number
        // travels with it.
        if (ctx.tierFinishCode && isPlatedSuffix(tierFinish, outsourceCodes)) {
            const lv = levelPrice();
            if (lv !== null && lv > 0) {
                const premium = String(part.manufacturingSpecs?.fabricut?.fabCodePremium || '').trim();
                const o = levelOut(lv);
                return { ...o, ...(premium ? { sku: premium, aliasCode: premium } : {}), detail: `${o.detail} · plated tier — the collar is ${tierFinish}` };
            }
        }

        if (!levelIsDefault) {
            // 2 — the CHOSEN price level, when this item has tier data to answer with. Items without it
            //     (fees, one-offs) fall through untouched, so a quote is a faithful mix rather than a
            //     level applied by force.
            const lv = levelPrice();
            if (lv !== null) return levelOut(lv);
            // 3 — this customer's negotiated price.
            const cv = clientPrice();
            if (cv !== null) return clientOut(cv);
        } else {
            // 2 — this customer's own negotiated price beats a level nobody asked for.
            const cv = clientPrice();
            if (cv !== null) return clientOut(cv);
            // 3 — …and the defaulted level still catches what the row does not cover.
            const lv = levelPrice();
            if (lv !== null) return levelOut(lv);
        }

        // 4 — the item's own price.
        const base = num(part.manufacturingSpecs?.basePrice);
        if (base !== null && base > 0) return out(base, PRICE_SOURCES.BASE, '');

        // 5 — the flow's fallback for this KIND of part, where it has one. Keyed on the role rather
        //     than the item, because that is the only thing known about a part nobody has priced.
        const kind = String(choice?.role || '').toUpperCase();
        const fb = kind ? num((ctx.fallbackPrices || {})[kind]) : null;
        if (fb !== null && fb > 0) return out(fb, PRICE_SOURCES.FALLBACK, `${kind.toLowerCase().replace('_', ' ')} default on this flow — ${billedId || 'this item'} has no price of its own`);

        return out(0, PRICE_SOURCES.NONE, `nothing on ${billedId || 'this item'} at ${priceLevel === 'STANDARD' ? 'standard pricing' : priceLevelShort(priceLevel)} — no override, no tier, no customer row, no base price`);    };
    const first = chain(sold);
    // …and the same for a stock-colour item: H1-2TRV-WB/C is the thing pulled, H1-2TRV-WB is the product
    // that carries the price and the customer's pattern number (Stuart 2026-09-18: "the placeholder for
    // the item# and price").
    if (first.source !== PRICE_SOURCES.NONE || !(speciesSwapped || stockColour)) return first;
    const baseSold = stockColour ? basePart : (finishVariantOf(basePart, finishCode, findByCode) || basePart);
    const alt = chain(baseSold);
    if (alt.source === PRICE_SOURCES.NONE) return first;
    const baseCode = String((basePart.legacyErpId && basePart.legacyErpId !== 'PENDING' ? basePart.legacyErpId : basePart.itemId) || '').trim();
    return { ...alt, billedId, detail: `${alt.detail ? alt.detail + ' · ' : ''}priced from the base product ${baseCode} — ${billedId} carries no price of its own` };
}

/**
 * Price a whole configuration. Returns one line per selected part, plus the total.
 *
 * Riders are included — a carrier is built and billed even though it is never offered as a choice,
 * which is the entire reason `always` exists.
 */
// ── AN ITEM KIT IS ONE THING SOLD AND SEVERAL THINGS MADE (Stuart 2026-09-18, H1-2RCTCB) ──────────
// "this is set up as an IN app kit and contains the bracket arm, cuff and has the customer alias price
//  info on it … only show the kit item and price to the customer — this is just a single bracket as we
//  assemble it." A Kit-class record with `kitComponents` and no NetSuite item: the customer buys ONE
// bracket under their pattern number at one price; the floor, the pick and NetSuite need the cuff and
// the arm. So the chosen kit becomes the bill shape every kit already has (Brief F, 2026-09-03):
//   · the KIT line carries the money and the customer's number — `isKit` (no NetSuite identity, never
//     floor work: Shared/lineClassification) + `itemKit` (NOT a traverse system — the NetSuite holder
//     line is not renamed for it);
//   · each COMPONENT rides beneath it at $0, `inKit` (NetSuite sends it at $0, the rollup carries the
//     kit's price) and `hidden` (built and picked, never on a customer document), wearing the finish
//     the kit was given, resolved to its own /P · /EPn item by the same identity rule as any part.
// Quantities multiply: three centre brackets are three cuffs and three arms.
export const isItemKit = (part) => !!part && part.partClass === 'Kit'
    && Array.isArray(part.manufacturingSpecs?.kitComponents) && part.manufacturingSpecs.kitComponents.length > 0
    && !part.manufacturingSpecs?.kitAlign;

function kitComponentLines(holder, kitPart, ctx) {
    const { findPart } = ctx;
    const missing = [];
    const lines = (kitPart.manufacturingSpecs.kitComponents || []).map(c => {
        const part = typeof findPart === 'function' ? findPart(c.partId) : null;
        const per = Number(c.qty) > 0 ? Number(c.qty) : 1;
        if (!part) missing.push(String(c.partId || '?'));
        const finishCode = part && !takesNoFinish(part) ? (holder.finishCode || '') : '';
        const p = priceChoice({ partId: c.partId, role: holder.role }, part, { ...ctx, finishCode, subFinishCode: '' });
        return {
            partId: c.partId, name: part?.itemName || String(c.partId || ''), role: holder.role || '', position: holder.position || '',
            sku: '', aliasCode: '', billedId: p.billedId,
            qty: per * (Number(holder.qty) > 0 ? Number(holder.qty) : 1), perFoot: false,
            finishCode, noFinish: !finishCode,
            unit: 0, total: 0, source: PRICE_SOURCES.BASE, detail: `in the ${holder.billedId || 'kit'} kit`,
            hidden: true, inKit: true, kitOf: holder.billedId || '',
        };
    });
    return { lines, missing };
}

export function priceConfiguration(model, ctx = {}) {
    const { findPart } = ctx;
    const choiceById = new Map((model?.choices || []).map(c => [String(c.id), c]));
    const lines = (model?.bom || []).flatMap(entry => {
        const choice = entry.raw && entry.raw.__choice ? entry.raw.__choice : entry;
        const part = typeof findPart === 'function' ? findPart(entry.partId) : null;
        // ⚠ THE FINISH IS A PER-PART DECISION (Stuart 2026-08-21: "in case people do choose
        // different finishes for different parts"). One `finishCode` for the whole configuration
        // priced every line off the configuration's finish — so brass rings on a black pole billed
        // the black variant of the ring, and the sheet that reaches finishing said black too.
        //
        // `ctx.finishFor(choice, entry)` is the caller's per-part answer, falling back to the
        // configuration's own. It arrives as a FUNCTION rather than a map because the caller is the
        // only thing that knows the material gate — a wood stain does not land on a steel bracket,
        // and a clear acrylic finial wears nothing at all.
        // ⚠ AN UNFINISHED ITEM WEARS NOTHING (Stuart 2026-09-03, Shared/finishLabel.takesNoFinish):
        // the item's own tag, read here so the line prices the PLAIN part and carries no finish
        // code — the pin's no-finish tag (acrylic) already did this; the item's tag now does too.
        const unfinished = takesNoFinish(part) || !!choice.noFinish;
        const finishCode = unfinished ? '' : (typeof ctx.finishFor === 'function'
            ? (ctx.finishFor(choice, entry) || '')
            : ctx.finishCode);
        // THE STOCK COLOUR this part is made in, when it takes one and wears no finish (the caller knows
        // which parts do and which colour is aligned — Shared/finishVariant.stockColourVariantOf).
        const subFinishCode = (!finishCode && !unfinished && typeof ctx.subFinishFor === 'function') ? String(ctx.subFinishFor(choice, part) || '').toUpperCase() : '';
        // The finish of the COLLAR this part requires (a two-part finial) — it picks the price tier.
        const full = choiceById.get(String(entry.id || '')) || null;
        const collar = (full && full.requiresCollar) ? (companionsFor(model.choices || [], [full.id])[0] || null) : null;
        const collarRow = collar ? ((model.bom || []).find(e => e.id === collar.id) || collar) : null;
        const tierFinishCode = collarRow ? String((typeof ctx.finishFor === 'function' ? ctx.finishFor(collarRow, collarRow) : ctx.finishCode) || '').toUpperCase() : '';
        const p = priceChoice(choice, part, (finishCode === ctx.finishCode && !subFinishCode && !tierFinishCode) ? ctx : { ...ctx, finishCode, subFinishCode, tierFinishCode });
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
        const line = {
            partId: entry.partId,
            name: entry.name,
            role: entry.role || '',
            sku: p.sku,
            aliasCode: p.aliasCode,
            billedId: p.billedId,   // the finished SKU that is actually sold and billed
            qty,
            perFoot,                  // the line is priced by the foot — the panel says so
            ...(perFoot ? { feet } : {}),
            // What the shop cuts to. Read by RTG, the floor, the labels and packaging — and never
            // set by this engine until now, so a pole reached the bench with no length on it.
            ...(perFoot && inches ? { cutLength: inches } : {}),
            // WHAT THIS LINE IS FINISHED IN — on the line, not only on the configuration, so the
            // quote panel can show it per part and the finishing floor is told per part.
            finishCode: finishCode || '',
            // …or the stock colour it is made in, and the record that is actually pulled for it.
            ...(subFinishCode ? { subFinishCode } : {}),
            ...(p.soldPartId ? { soldPartId: p.soldPartId } : {}),
            // …and WHY it has none, where it has none: a clear acrylic finial takes no finish at
            // all, which is a different fact from a steel part left in mill.
            noFinish: unfinished,
            unit: p.price,
            total: p.price * qty * (perFoot ? feet : 1),
            source: p.source,
            detail: p.detail,
            hidden: !!entry.hidden,   // built and billed, never shown on a customer document
            role: entry.role || '',
            position: entry.position || '',
        };
        if (!isItemKit(part)) return [line];
        const kit = kitComponentLines(line, part, ctx);
        return [{ ...line, isKit: true, itemKit: true, ...(kit.missing.length ? { kitMissing: kit.missing } : {}) }, ...kit.lines];
    });
    return { lines, total: lines.reduce((s, l) => s + l.total, 0) };
}

/**
 * Lines a human should look at before quoting. Being loud about a $0 line is the point: a part
 * that silently prices at nothing is how a quote goes out under cost.
 */
export function pricingWarnings({ lines }) {
    const out = [];
    lines.filter(l => Array.isArray(l.kitMissing) && l.kitMissing.length).forEach(l =>
        out.push({ sev: 'red', msg: `${l.billedId || l.name} is a kit, and ${l.kitMissing.join(', ')} in it is not in the library — that part will not reach the pick, the floor or NetSuite. Fix the kit's component list in the Master Library.` }));
    lines.filter(l => l.source === PRICE_SOURCES.NONE).forEach(l =>
        out.push({ sev: 'red', msg: `${l.name}${l.billedId || l.partId ? ` (${l.billedId || l.partId})` : ''} has no price under any rule — ${l.detail}. It is quoting at $0.` }));
    // A fallback is a placeholder that reached a customer. Not an error — it was chosen
    // deliberately — but it must never be mistaken for a price somebody set on the item.
    lines.filter(l => l.source === PRICE_SOURCES.FALLBACK).forEach(l =>
        out.push({ sev: 'amber', msg: `${l.name}${l.billedId || l.partId ? ` (${l.billedId || l.partId})` : ''} is quoting the flow's ${l.detail.split(' default')[0]} default at $${(l.unit || 0).toFixed(2)} — price the item in 4.6 to make it real.` }));
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
