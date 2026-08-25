// STOCKED POLES ARE 8 FT — a 4 ft order is a CUT, not a pull.
// (Stuart 2026-08-19: "the raw poles are nearly always stocked as 8ft … if an order of 10 4ft poles
//  is placed immediately send an order to rod cuts … for 5pcs of the associated 8ft pole, then the
//  rod cut tool turns this into 10pcs of the 4ft, then once confirmed as cut and complete it prints
//  the work order label there for the finishing of the 4ft poles just the same as if it was any
//  normal piece.")
//
// This is what Sandra hit: a work order for 20 × 4 ft asked the warehouse for 20 raw 4 ft rods,
// which is not a thing anyone stocks. The pick was never going to be satisfiable — the pieces have
// to be MADE by cutting, and that cut is a real inventory movement NetSuite has to see. So the work
// order gets a cut order in front of it rather than a pull it can't fulfil.
//
// Length lives in the item code as the leading digit of a 3-digit group: HCUMP810 = 8 ft, HCUMP410
// = 4 ft, HCUMP610 = 6 ft; the trailing 10/15 is the profile family. Same grammar the Sales
// Snapshot's ✂ builder already uses, so the two agree by construction.

// Length is the digit before the DIAMETER family. Diameters seen in the catalogue: 10 = 1",
// 15 = 1-3/8", 35 = 35 mm (the wood poles) — Stuart 2026-08-22.
const LEN_RE = /([468])(10|15|35)/;

/** The raw item behind a finished code: HCUMP410/G → HCUMP410. */
const rawOf = (erp) => { const s = String(erp || '').trim().toUpperCase(); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : s; };

/** 8 ft yields two 4 ft, or one 6 ft with 2 ft of scrap. Anything else is not a cut we make. */
export const YIELD = { 4: { per: 2, scrapFt: 0 }, 6: { per: 1, scrapFt: 2 } };

export function poleLengthOf(erp) {
    const m = LEN_RE.exec(rawOf(erp));
    return m ? Number(m[1]) : null;
}

/**
 * What has to be cut before this work order can be finished.
 * Returns null when nothing needs cutting — an 8 ft order, or a code with no length grammar, is a
 * normal pull and must stay one.
 *
 * @param {string} erpId finished or raw item on the work order (HCUMP410/G)
 * @param {number} qty   finished pieces wanted
 */
// WHAT COUNTS AS A POLE — the PRODUCT CATEGORY, and nothing else.
// Stuart 2026-08-22: "assign this rule to only items with category pole or rods, as we do have some
// small items like brackets that get finished like poles recipe and i do not want you to get those
// mixed up. All poles are tagged as either poles or rods."
//
// That distinction is the whole point. A bracket can run the POLE finishing stream — the elbow does
// exactly that — and it is still a bracket: you cannot cut an 8 ft one in half. So this must never
// be wired to `finishStream`, `poles.qty`, "rack of 8", or any of the other pole-ISH flags floating
// around the work order. Those describe how a thing is FINISHED. This asks what it IS.
export const isPoleCategory = (productType) => /\b(POLES?|RODS?)\b/i.test(String(productType == null ? '' : productType));

// ── HOW A POLE IS TAGGED (Stuart 2026-08-25, from Grace's WO11485/11486) ────────────────────────
// Grace: "Two orders of CP poles that are not correctly pulling the CP Pole Recipe … the system is
// treating them as small parts and not poles. These are 4ft rods."
//
// Four different places asked "is this a pole?" four different ways, and only this one knew about
// RODS. The Setup Queue's test was `productType.includes('POLE')` — so a 4 ft rod, tagged ROD
// exactly as it should be, answered NO, got no pole count, and every piece fell into the small
// parts stream and ran CP-S instead of CP-P. Grace was reading the consequence of a spelling.
//
// So the two tags a pole carries, derived from the one category rather than typed in per item:
//   FINISH STREAM  — POLES for anything in the pole/rod category, always. This is the recipe
//                    variant only (-P), and it is what was missing on her orders.
//   PART HANDLING  — SMALL PARTS for a STOCKED pole. Stuart: "they need to be tagged small parts
//                    in the parts handling as these are stocked poles and do not require custom".
//                    Custom routes a line to the custom shop division; a stocked 4 ft rod is an
//                    ordinary finishing job and does not belong there. A pole that is NOT stocked
//                    is cut to order, so it stays Custom.
export const autoFinishStream = (productType) => isPoleCategory(productType) ? 'POLES' : '';
export const autoPartHandlingFor = (productType, isStocked) =>
    isPoleCategory(productType) ? (isStocked ? 'Small Parts' : 'Custom') : 'Small Parts';

export function poleCutPlan(erpId, qty, opts = {}) {
    // CATEGORY FIRST, GRAMMAR SECOND (Stuart 2026-08-22: "MB is bracket … you are safe to go to
    // the category pole, restrict it").
    //
    // The code grammar alone is not enough and was actively dangerous: HCUMB415 is a 1-3/8"
    // BRACKET, and reading its "415" as "4 ft" would have had the app raise a cut order against an
    // HCUMB815 that does not exist — or, worse, against one that does and means something else.
    // The product type is the authority on what a pole is; the code only says how long it is.
    //
    // The caller passes the CATEGORY, not a boolean — a boolean is exactly how a pole-ish finishing
    // flag would end up here by accident.
    if (!isPoleCategory(opts.productType)) return null;
    const raw = rawOf(erpId);
    const m = LEN_RE.exec(raw);
    if (!m) return null;
    const len = Number(m[1]);
    const y = YIELD[len];
    if (!y) return null;                                   // 8 ft — already the stocked length
    const want = Math.max(0, Math.floor(Number(qty) || 0));
    if (!want) return null;
    // Round UP: 9 × 4 ft still needs 5 rods, and the spare 4 ft goes to stock rather than being
    // silently lost.
    const sourceQty = Math.ceil(want / y.per);
    const targetQty = sourceQty * y.per;
    return {
        sourceItemId: raw.replace(LEN_RE, `8$2`),          // the stocked 8 ft rod
        targetItemId: raw,                                 // the cut length, raw (unfinished)
        sourceQty,
        targetQty,                                         // what the cut actually yields
        wantQty: want,
        overrun: targetQty - want,                         // spare pieces the cut leaves in stock
        cutTo: `${len}FT`,
        scrapFt: sourceQty * y.scrapFt,
        lengthFt: len,
    };
}

/** Does this work order need a cut before it can be picked? */
export const needsPoleCut = (erpId, qty, opts) => !!poleCutPlan(erpId, qty, opts);
