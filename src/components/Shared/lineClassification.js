import { findClientPriceRow } from './clientPricing';

// Single source of truth for splitting a CPQ order line into the two
// production divisions: 'small' (-> Finishing Floor) vs 'custom' (-> Shop Floor).
//
// See WORK_ORDER_CONTRACT.md §7. The authoritative signal is the ITEM's own
// `manufacturingSpecs.partHandling` in the Master Library — that field exists precisely to say
// which floor a physical part belongs to, so a bracket tagged 'Small Parts' goes to finishing
// regardless of which flow pulled it. The per-step flag from the CPQ flow builder (AdminTab
// "Part Handling & Routing") is the FALLBACK, for lines whose part can't be resolved.
// CPQTab bakes that flag (and the selected partId) onto each priced line, so by
// the time the SO-import handler reads job.cpqData lines it can classify without
// re-joining to the flow doc.

// A quote breakdown carries DISPLAY rows alongside real part lines: the ▶ assembly header, the
// trade-discount/net rows, and the SIZE / PROJECTION echoes CPQ emits so the quote reads
// "Rod Diameter: 1\" Round Rod". Those echoes carry NO part, NO price and NO item # — they are
// not pickable and not buildable. They were reaching the floors as work: Sandra's pick queue
// showed "Rod Diameter" and "Bracket Projection" as line items with ITEM #: UNASSIGNED, and the
// rod appeared in picking even though the real rod is custom and belongs to the shop order
// (Stuart 2026-07-28). Every consumer that turns a quote into WORK must filter through this.
export function isDisplayOnlyLine(line) {
    if (!line) return true;
    if (line.isHeader || line.isDiscount || line.isNetLine || line.isSizeRow) return true;
    // Legacy quotes saved before isSizeRow existed: a size/projection echo is identifiable by
    // having no part identity at all, no money, and the "Step Title: Option" shape. Fees are
    // excluded from this test — they legitimately have no part and DO ride the shop order.
    if (line.isFee || line.lineIsFee) return false;
    const noPart = !line.partId && !line.legacyErpId;
    const noMoney = !(Number(line.price) || 0) && !(Number(line.total) || 0);
    const titleColonShape = /^\s*[-–▶]?\s*[^:]{2,}:\s+\S/.test(String(line.name || ''));
    return noPart && noMoney && titleColonShape;
}

// ── WHAT A CUSTOMER MAY SEE (Stuart 2026-08-22) ──────────────────────────────────────────────
// "hidden go to all shop doc's just not customer docs."
//
// `hidden` has always meant BOM-ONLY — built, picked, billed, and not something the customer chose
// or should read. The floors and the ERP push take every line; a standoff is real work and real
// stock. But it had no effect on printed paperwork, because the document builders filtered only
// isDisplayOnlyLine — which is a different question (headers, discounts, size echoes are not lines
// at all). So a customer's sales order has been listing standoffs.
//
// ⚠ THIS IS NOT isDisplayOnlyLine, AND MUST NOT BECOME IT. getJobLines feeds the shop screens as
// well as the printed forms, so folding `hidden` in there would strip those parts from the floor —
// the exact opposite of the rule. Two questions, two functions.
//
// ⚠ A PACKING SLIP IS A LIST OF WHAT IS IN THE BOX, not a list of what was sold. The standoff is
// physically in there and the customer counts against it, so contents documents keep every line
// and only the MONEY documents — the sales order, the invoice, the quote — drop the hidden ones.
export const MONEY_DOC_TYPES = ['SALES_ORDER', 'INVOICE', 'QUOTE'];

// ── THE FINISH IS SAID ON EVERY LINE (Stuart 2026-08-30: "the sales order, the packing slip …
// everywhere they do not show the finish, the finish code needs to be applied to each line") ────
// The line's own stamp wins (per-part exceptions); the configuration-level finishLabel covers
// lines saved before per-line stamping. Headers, fees, discounts and kit-included rows carry
// nothing — a fee has no finish, and stamping the fallback on it would be a lie.
export const cartFinishLabelOf = (cpqData) =>
    ((cpqData && cpqData.cartItems) || []).map(ci => ci && String(ci.finishLabel || '').trim()).find(Boolean) || '';

const withLineFinish = (l, fallback) => {
    if (!l || l.isHeader || l.isDiscount || l.isNetLine || l.isFee || l.inKit) return l;
    const fin = l.finishLabel || l.finishCode || fallback || '';
    if (!fin || String(l.name || '').includes(fin)) return l;
    return { ...l, name: `${l.name} — Finish: ${fin}`, finishText: fin };
};

/**
 * Lines a customer may read on a money document: no BOM-only parts, no shop-only rows.
 * `finishFallback` (optional): the configuration-level finish label, stamped onto physical lines
 * that carry no per-line finish of their own — so EVERY document says what each line is finished
 * in, from one place, and no two forms can disagree about it.
 */
// ── THE PAPER IS ONLY AS GOOD AS THE MOMENT IT WAS SAVED — UNLESS IT RE-RESOLVES ────────────
// (Stuart 2026-09-03: "the sales forms need help, it is not showing the descriptions and customer
// part#'s on the docs, it has once again ONCE AGAIN reverted to the designer's node files from
// upload".) A breakdown line stores the name and the customer SKU it had at SAVE time. The
// 2026-08-31 fix made a line take its name from the Master Library instead of the 1.6 node label
// — but only for lines saved after it, so every earlier order (and any line whose part did not
// resolve that day) prints "H21INPOLELEFT" on the customer's paper for ever. Re-resolving HERE,
// at print time, repairs the paperwork of every order ever saved without touching stored data,
// and is why this cannot regress a third time: the document no longer inherits a bad save.
//
// `opts.findPart(idOrCode)` → the Master Library part (by doc id, itemId or legacyErpId);
// `opts.custKeys` → the customer's clientPricing keys (Shared/clientPricing.customerKeys).
// Both optional: callers that pass neither (the floors, RTG) behave exactly as before.
const NAME_PREFIX_RE = /^(\s*[-–—]\s*)(.*)$/;   // "  - H21INPOLELEFT" → indent survives, label is replaced
const reResolve = (l, findPart, custKeys) => {
    if (typeof findPart !== 'function' || l.isHeader) return l;
    const part = findPart(l.partId) || findPart(l.legacyErpId);
    if (!part) return l;
    const out = { ...l };
    // The LIBRARY's description is what a customer reads; the 1.6 node label never leaves 1.6.
    if (part.itemName) {
        const m = String(l.name || '').match(NAME_PREFIX_RE);
        out.name = m ? `${m[1]}${part.itemName}` : part.itemName;
    }
    // Their part number, if this line was saved before clientSku was stamped on it.
    if (!out.clientSku && custKeys && Array.isArray(part.clientPricing)) {
        const row = findClientPriceRow(part.clientPricing, custKeys);
        if (row && row.clientSku) out.clientSku = row.clientSku;
    }
    return out;
};

export const customerDocLines = (lines = [], docType = '', finishFallback = '', opts = {}) => {
    const { findPart = null, custKeys = null } = opts || {};
    const real = (lines || []).filter(l => !isDisplayOnlyLine(l))
        .map(l => withLineFinish(reResolve(l, findPart, custKeys), finishFallback));
    if (!MONEY_DOC_TYPES.includes(String(docType || '').toUpperCase())) return real;
    // ── A POLE IS SOLD BY THE FOOT AND SHIPPED AS ONE PIECE (Stuart 2026-08-25) ──────────────
    // The engine pins a per-foot line's qty at 1 (one pole on the router) and multiplies the money
    // by the feet — so a money document printed "1 × $9.00 = $72.00", which reads as an error and
    // disagrees with the NetSuite line (8 × $9.00). On MONEY documents the qty column shows the
    // FEET billed, so qty × unit = amount and the paper matches the estimate; the physical
    // documents (work order, router, packing list) keep qty = pieces with the cut length, because
    // one pole is what is built and boxed.
    return real.filter(l => !l.hidden && !l.shopOnly)
        .map(l => (l.perFoot && Number(l.feet) > 0
            ? { ...l, qty: (Number(l.qty) || 1) * Number(l.feet) }
            : l))
        // ── THE CUSTOMER'S PART# ON THE CUSTOMER'S PAPER (Stuart 2026-08-31, invoice S060147:
        // "it has a customer part# associated with it and Brimar is the chosen customer … it
        // should display their part#'s"). A line priced off the customer's own clientPricing row
        // carries their SKU as `clientSku`; on a money document that IS the item number — ours
        // survives on `houseItemNo` for anything that still needs to trace it. The floors and the
        // ERP push never come through this branch, so picking and NetSuite stay on our numbers.
        .map(l => (l.clientSku && l.clientSku !== l.legacyErpId
            ? { ...l, legacyErpId: l.clientSku, houseItemNo: l.legacyErpId || l.partId || '' }
            : l));
};

export const DIVISION_SMALL = 'small';
export const DIVISION_CUSTOM = 'custom';

// Normalize any free-text handling value ('Small Parts', 'SMALL', 'Custom',
// 'Custom Fabrication', ...) to a division, or null if it isn't a handling value.
function normalizeHandling(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (v.includes('small')) return DIVISION_SMALL;
  if (v.includes('custom')) return DIVISION_CUSTOM;
  return null;
}

/**
 * Classify a single order line as 'small' or 'custom'.
 *
 * @param {object} line  A cpqData line. Expected (after the CPQTab change):
 *                       { name, qty, price, total, partHandling, partId }.
 * @param {object} [part] The resolved Approved_Designs part for line.partId,
 *                        used only for fallback signals when the line carries
 *                        no explicit flag.
 * @returns {'small'|'custom'}
 */
export function classifyLine(line, part) {
  // -1. OPERATOR OVERRIDE (CPQ "custom work on this step"): the chosen fee item's Part Handling
  //     wins over every other signal, including the fee rule below — a Custom FINISH fee is
  //     meant to reach the finishing floor, and a Custom LABOR fee the shop.
  const overridden = normalizeHandling(line && line.customOverrideHandling);
  if (overridden) return overridden;

  // 0. FEES, RETURN fabrication and SPLICE fee lines are never small-part picks (Stuart
  //    2026-07-14): a french/miter/bent return is pole FABRICATION (rides the custom order's
  //    fab notes), splicing happens on the shop floor, and fee entities have no physical item.
  //    PRECISION FIX (2026-07-17): the NAME test only applies to lines with NO REAL ITEM # —
  //    option names echo into real part lines ("Backplate (Mounting Base for 1\" French
  //    Return)" is a pickable backplate, not a fee), and the old any-name match routed those
  //    CUSTOM and starved the pick list. A line with a real part routes by its handling flags.
  const lineFee = !!(line && (line.isFee || line.lineIsFee));
  const partFee = !!(part && (part.partClass === 'Fee' || String((part.manufacturingSpecs && part.manufacturingSpecs.productType) || '').toUpperCase() === 'FEE'));
  const pid = String((line && line.partId) || '');
  const noRealPart = !part && (!pid || pid === 'PENDING' || pid === 'N/A' || /(^|-)(FEE|HIDDEN)-/.test(pid));
  const nameFeeish = /\b(FRENCH|MITERED|MITER|BENT)\s+RETURN\b|\bSPLICE\b|\bFEE\b/i.test(String((line && line.name) || ''));
  if (lineFee || partFee || (noRealPart && nameFeeish)) return DIVISION_CUSTOM;

  // 1. THE ITEM'S OWN Part Handling WINS (Stuart 2026-07-28: "the cpq flow should respect the
  //    routing that is placed on the items it is pulling, it should refer back — in the master
  //    library all of our brackets, backplates, rings, finials are all tagged small parts, that
  //    is the whole intention of these fields"). Previously the flow STEP's stamp was
  //    authoritative, and the flow generator stamps every bracket step 'Custom' — so brackets and
  //    their backplates went to the shop floor no matter how the library had them tagged, and the
  //    finishing pick list starved.
  const specs = part && part.manufacturingSpecs;
  const partLevel = normalizeHandling(specs && specs.partHandling);
  if (partLevel) return partLevel;

  // 2. Fall back to the per-line flag (propagated from step.partHandling) — used when the line
  //    carries no resolvable part, or the item has no handling tag of its own.
  const explicit = normalizeHandling(line && line.partHandling);
  if (explicit) return explicit;

  // 3. Made-to-measure parts are custom fabrication.
  if (part && part.parametric && part.parametric.isCutToSize === true) {
    return DIVISION_CUSTOM;
  }

  // 4. Default: route to the small-parts/finishing side.
  return DIVISION_SMALL;
}
