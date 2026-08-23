// ─────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THE ENGINE HANDS TO EVERYTHING DOWNSTREAM (Stuart 2026-08-17)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "trace down what the old engine used to include in all the passing of data to other screens, it
//  used to pass data to finishing floor, shop floor, crm docs, etc. that part was right about the
//  old engine and we should mimic it before deleting it in a bit."
//
// He is right, and it is the part of the old engine most worth keeping. A configuration is not
// finished when it looks correct on screen — it is finished when the shop can build it, the
// finishing floor can spray it, the warehouse can pick it, NetSuite can bill it and the customer
// can read it. Six consumers, each reading fields that were added one at a time over months for
// reasons that are not obvious from the field name. Re-deriving that shape by eye is how a rebuild
// quietly loses a year of edge cases.
//
// So the new engine does NOT invent a payload. It builds the SAME cart item and the SAME breakdown
// lines the old one wrote, and every consumer keeps working untouched:
//
//   SHOP FLOOR + FINISHING FLOOR  split the breakdown by division through
//       Shared/lineClassification.classifyLine, which reads `partHandling` off each line (the
//       ITEM's own value, with the step flag as fallback) and drops display-only rows through
//       isDisplayOnlyLine. Lines therefore MUST carry partHandling, partId, legacyErpId, and must
//       NOT invent rows with no part and no money — those read as size echoes and get filtered.
//   RTG DISPATCH  reads finishes/finishLabel for the recipe, sidemark for the tag, cutLength and
//       dimensions for fabrication.
//   ERP PUSH  maps cartItems → NetSuite lines by legacyErpId, rating physical lines at standard
//       and letting the rollup absorb the balance; it needs qty, price, total and the fee flag.
//   CRM DOCUMENTS + PORTAL  print pricingBreakdown, finishLabel, sidemark and the assembly name.
//
// HIDDEN PARTS ARE IN THE BOM AND OFF THE QUOTE. A standoff is picked, built and billed, but it is
// not something a customer chose or should read. `hidden` on the line is the switch: production
// consumers take every line, customer documents filter it out. One list, two audiences — which is
// safer than two lists that can disagree about what is on the order.

import { applyKitPricing } from './kitSeed.js';
import { priceConfiguration } from './hardwarePricing.js';

/** Lines a customer may see: no BOM-only parts. */
export const customerLines = (lines = []) => lines.filter(l => !l.hidden);
/** Lines the shop works from: everything, hidden included. */
export const productionLines = (lines = []) => lines;

const codeOf = (part, fallback) => String(
    (part?.legacyErpId && part.legacyErpId !== 'PENDING' ? part.legacyErpId : part?.itemId) || fallback || ''
).trim() || null;

/**
 * One priced line in the shape every downstream consumer already reads.
 *
 * The field list is not decorative — each one is load-bearing somewhere:
 *   name           quote/document text and the fee-name test in lineClassification
 *   qty/price/total money, and the ERP push's per-line rating
 *   partHandling   THE routing signal: 'Small Parts' → finishing floor, 'Custom' → shop floor
 *   partId         the library doc id, so a consumer can re-join to the item
 *   legacyErpId    OUR number — what NetSuite, the pick list and the router all match on
 *   isFee          fees never become a pick, and never carry a physical item
 *   cutLength      the shop cuts to this; absent on anything that is not cut
 *   dimensions     wall measurements for returns, read by fabrication
 */
function handoffLine(l, part, finishName = '') {
    return {
        name: l.name || codeOf(part, l.partId) || '',
        qty: l.qty || 1,
        price: l.unit || 0,
        total: l.total || 0,
        // The ITEM's own handling is the truth (Shared/lineClassification); a part that cannot be
        // resolved carries none, and the consumer falls back exactly as it always has.
        partHandling: part?.manufacturingSpecs?.partHandling || '',
        partId: l.partId || null,
        legacyErpId: l.billedId || codeOf(part, l.partId),
        ...(l.sku || l.aliasCode ? { clientSku: l.sku || l.aliasCode } : {}),
        ...(l.hidden ? { hidden: true } : {}),
        ...(l.isFee ? { isFee: true } : {}),
        // ⚠ THE FINISH, PER LINE (Stuart 2026-08-21: "of course in the bom to send along to
        // finishing … in case people do choose different finishes for different parts"). The item
        // has carried `finishes`/`finishLabel` for the whole configuration since the old engine and
        // still does — RTG reads those for the recipe. But a configuration with an exception in it
        // cannot be sprayed off one label, so the line says what IT is finished in. A part that
        // wears nothing carries nothing, and the floor reads that as mill.
        ...(l.finishCode ? { finishCode: l.finishCode, finishLabel: finishName || l.finishCode } : {}),
        // ── THE KIT'S OWN FIELDS (Stuart 2026-08-22) ────────────────────────────────────────
        // `isKit`/`noNs` keep it off the NetSuite component list and off the pick list — its money
        // rides the rollup, its components are what ship. `inKit` marks a part the kit already paid
        // for, so a document can print it as included rather than as a free line nobody understands.
        ...(l.isKit ? { isKit: true, noNs: true } : {}),
        ...(l.inKit ? { inKit: true } : {}),
        ...(l.shopOnly ? { shopOnly: true } : {}),
        ...(l.billedFeet !== undefined ? { billedFeet: l.billedFeet } : {}),
        ...(l.detail ? { detail: l.detail } : {}),
        ...(l.cutLength ? { cutLength: l.cutLength } : {}),
        ...(l.dimensions ? { dimensions: l.dimensions } : {}),
    };
}

/**
 * Turn a resolved configuration into the cart item CPQ has always written.
 *
 * @param resolved  the hardware model's resolve() output
 * @param ctx       everything the line needs to be a document:
 *                  { assembly, flow, findPart, pricing ctx, finishes, finishLabel, sidemark,
 *                    lengthInches, lengthFeet, qty, extras, stepNotes, priceLevel }
 */
export function handoffItem(resolved, ctx = {}) {
    const {
        assembly, flow, findPart, qty = 1, sidemark = '', finishes = [], finishLabel = '',
        priceLevel = 'STANDARD', lengthInches = null, lengthFeet = null,
        extras = [], stepNotes = {}, memo = '', trvComponents = [],
    } = ctx;

    // ⚠ PRICED AGAIN, HERE. This is the figure the CART, the documents and the ERP push all read —
    // the configurator's own panel is a second, independent call. So a kit-seeded order must be
    // re-shaped on BOTH paths or the screen and the paperwork quote different numbers, which is
    // the one divergence a quote can never survive. `ctx.kit` is how it travels.
    const priced = ctx.kit
        ? applyKitPricing(priceConfiguration(resolved, ctx), ctx.kit)
        : priceConfiguration(resolved, ctx);
    // Code → the name a human reads. The finish objects are already here for the item-level label;
    // the lines borrow the same list rather than a second one that could disagree with it.
    const finishNameOf = (code) => {
        const f = (finishes || []).find(x => String(x.code || '').toUpperCase() === String(code || '').toUpperCase());
        return f ? (f.name || f.code || '') : '';
    };
    const lines = priced.lines.map(l => handoffLine(l, typeof findPart === 'function' ? findPart(l.partId) : null, finishNameOf(l.finishCode)));

    // Added by hand — real lines, so they route and bill like everything else. They carry their own
    // note because a splice's location is the whole point of adding one.
    const extraRows = (extras || []).filter(x => x.code && Number(x.qty) > 0).map(x => {
        const part = typeof findPart === 'function' ? findPart(x.code) : null;
        const unit = (priced.lines.find(l => l.partId === x.code)?.unit) || 0;
        const n = Number(x.qty) || 1;
        return {
            ...handoffLine({ partId: x.code, name: part?.itemName || x.code, qty: n, unit, total: unit * n }, part),
            addedByHand: true,
            ...(x.note ? { customNote: x.note } : {}),
        };
    });

    // ── TRAVERSE COMPONENTS, IN THE SHAPE THE CART HAS ALWAYS CARRIED THEM ───────────────────
    // Stuart 2026-08-21: the new engine asks for these at its last step rather than in a modal on
    // add. Where they are ASKED changed; what rides the cart item did not — the ERP push reads
    // `trvComponents` off the item (ERPPushPullTab) and every document reads these breakdown rows,
    // so the field names and the row shape are copied from the old path deliberately rather than
    // improved. An included component rides at $0: it is on the BOM and on the pick list without
    // being charged twice, because the per-foot price already carried it.
    const trvRows = (trvComponents || []).map(c => ({
        name: `${c.code} — ${c.why}`, qty: c.qty,
        price: c.billable ? c.rate : 0, total: c.billable ? c.rate * c.qty : 0,
        partHandling: 'Small Parts', partId: c.code, legacyErpId: c.code,
        // ⚠ FLAGGED SO IT IS PUSHED ONCE. These rows are on the breakdown for the documents and the
        // floors, and the ERP push reads the item's `trvComponents` list directly (it always has).
        // Without a mark the TAGS breakdown walk would push them a second time and the order would
        // carry double the carriers.
        trvComponent: true,
    }));

    const breakdown = [...lines, ...extraRows, ...trvRows];
    const total = breakdown.reduce((s, l) => s + (l.total || 0), 0);

    return {
        id: String(Date.now()),
        assemblyId: assembly?.id || null,
        assemblyName: assembly?.itemName || flow?.name || 'Configured Item',
        sidemark: String(sidemark || '').trim() || 'No Sidemark',
        flowId: flow?.id || null,
        qty,
        priceLevel,
        pricing: { finalPrice: total },
        // Every consumer's list. Customer documents filter `hidden`; the floors do not.
        pricingBreakdown: breakdown,
        // The finish in words, stamped here because CPQ holds the finish objects and every
        // document downstream should read ONE field rather than re-deriving it.
        finishes,
        finishLabel,
        // What the engine was actually asked, kept whole so a quote can be reopened into it.
        engineConfig: {
            answers: ctx.answers || {},
            picks: ctx.picks || {},
            partFinish: ctx.partFinish || {},
            lengthInches, lengthFeet,
            stepNotes,
            memo,
        },
        engineeringNotes: ctx.engineeringNotes || null,
        // The saved render, replayed by the floors' viewer. Null on an assembly with no .glb.
        renderState: ctx.renderState || null,
        // The push reads this list directly, not the breakdown rows — same field, same contents.
        trvComponents,
        // What the engine is: the flag that tells a consumer which shape to expect.
        engine: 'TAGS',
    };
}
