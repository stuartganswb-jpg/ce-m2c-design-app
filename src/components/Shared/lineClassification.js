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
