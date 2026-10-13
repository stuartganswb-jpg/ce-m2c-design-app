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
// 12 ADDED 2026-08-25 (Eric: "the items listed as HTA1235 are just under 12-ft in length").
// The 12 alternative is FIRST because alternation is ordered — "1235" must read as 12 ft + 35 mm,
// not fail to match at all, which is what it did before and why no 12 ft rod could be cut.
const LEN_RE = /(12|[468])(10|15|35)/;

/** The raw item behind a finished code: HCUMP410/G → HCUMP410. */
const rawOf = (erp) => { const s = String(erp || '').trim().toUpperCase(); const i = s.lastIndexOf('/'); return i > 0 ? s.slice(0, i) : s; };

/** 8 ft yields two 4 ft, or one 6 ft with 2 ft of scrap. Used by the AUTOMATIC work-order path. */
export const YIELD = { 4: { per: 2, scrapFt: 0 }, 6: { per: 1, scrapFt: 2 } };

// ── WHAT ONE ROD CUTS INTO (Eric 2026-08-19, verbatim) ─────────────────────────────────────────
// "One 8-ft can be cut to one 6-ft or two 4-ft and one 6-ft can be cut into one 4-ft. For the HTA
//  rods specifically, the items listed as HTA1235 are just under 12-ft in length. They can be cut
//  into one 8-ft or one 6-ft + one 4-ft."
//
// Encoded exactly as he stated it and no further. 12 → 8 + 4 is NOT here: his rods are just UNDER
// 12 ft, so the two would not both come out of one stick. Inventing that option would have the
// warehouse expect a piece that does not exist.
//
// A cut can produce TWO different lengths from one stick (his 6 + 4), so a yield is a LIST of
// targets rather than one — the whole reason the old single-target shape could not express it.
export const CUT_OPTIONS = {
    12: [
        { key: '8FT',     label: '1 × 8 ft',          targets: [{ ft: 8, per: 1 }],                 scrapFt: 4 },
        { key: '6FT+4FT', label: '1 × 6 ft + 1 × 4 ft', targets: [{ ft: 6, per: 1 }, { ft: 4, per: 1 }], scrapFt: 2 },
    ],
    8: [
        { key: '4FT', label: '2 × 4 ft', targets: [{ ft: 4, per: 2 }], scrapFt: 0 },
        { key: '6FT', label: '1 × 6 ft', targets: [{ ft: 6, per: 1 }], scrapFt: 2 },
    ],
    6: [
        { key: '4FT', label: '1 × 4 ft', targets: [{ ft: 4, per: 1 }], scrapFt: 2 },
    ],
};
export const cutOptionsFor = (sourceFt) => CUT_OPTIONS[Number(sourceFt)] || [];

// ── THE SAW, READ BACKWARDS (Brief A, Q5 — Stuart 2026-09-02) ──────────────────────────────────
// "if order for a stocked length pole with small parts finish is entered, check if stocked length
//  pole in stock? if so straight to floor, if not in stock check if suitable length is (order for
//  6ft no 6ft in stock but 8ft is), then make recommendation in pop up and operator decides to
//  either put order on back order and wait for 6ft stock to arrive, or go ahead and cut 8ft down."
//
// CUT_OPTIONS says what one stick becomes. This asks the same table the other way: which sticks
// yield the length I am short of, and how many of that length come off each one. Derived from the
// table rather than written out, so a change to what the saw can do can never be half-applied.
// Ordered shortest source first — the least material spent on the piece we need.
export const sourcesForLength = (targetFt) => {
    const want = Number(targetFt);
    const out = [];
    Object.keys(CUT_OPTIONS).forEach(srcKey => {
        const sourceFt = Number(srcKey);
        if (!(sourceFt > want)) return;
        (CUT_OPTIONS[srcKey] || []).forEach(opt => {
            const hit = (opt.targets || []).find(t => Number(t.ft) === want);
            if (!hit || !(Number(hit.per) > 0)) return;
            out.push({
                sourceFt, per: Number(hit.per), optionKey: opt.key, label: opt.label,
                scrapFt: Number(opt.scrapFt) || 0,
                // What ELSE the same cut produces — a 12 ft cut to 6+4 also yields a 4 ft, and the
                // operator should see that before choosing it.
                alsoYields: (opt.targets || []).filter(t => Number(t.ft) !== want).map(t => ({ ft: Number(t.ft), per: Number(t.per) || 0 })),
            });
        });
    });
    return out.sort((a, b) => a.sourceFt - b.sourceFt);
};

// ── THE OPTIONS, WITH LIVE STOCK AGAINST EACH ──────────────────────────────────────────────────
// Both doors that can offer a cut — Order Entry and the Sales Snapshot — need the same list: which
// sticks yield this length, how many rods it would take, whether the shelf can cover it. It was
// written inline on the Order Entry side; a second copy on the Snapshot side is exactly how the
// two would drift into disagreeing about what the saw can do.
//
// `availOf` is passed in rather than read here, because the two doors get their stock from
// different places (Order Entry from its review pull, the Snapshot from its pre-check) and neither
// should have to care which.
export const poleOptionsWithStock = ({ pullErp, pullFt, short, availOf }) =>
    sourcesForLength(pullFt)
        .map(o => ({ ...o, sourceErp: targetCodeFor(pullErp, o.sourceFt) }))
        .filter(o => o.sourceErp)
        .map(o => {
            const avail = Math.max(0, Number(availOf(o.sourceErp)) || 0);
            const rodsNeeded = Math.ceil(Math.max(0, Number(short) || 0) / o.per);
            return { ...o, avail, rodsNeeded, enough: avail >= rodsNeeded && rodsNeeded > 0 };
        });

/**
 * The cut plan for a source the OPERATOR chose (Q5), rather than the automatic 8 ft rule.
 *
 * Same shape poleCutPlan returns, so the work-order writer and the WMS Rod Cuts tab read one
 * thing. `per` and `scrapFt` come from sourcesForLength — the saw's table, not the caller.
 */
export function cutPlanFromSource({ targetErp, targetFt, sourceFt, per, scrapFt = 0, want }) {
    const raw = rawOf(targetErp);
    const sourceItemId = targetCodeFor(raw, sourceFt);
    const n = Math.max(0, Math.floor(Number(want) || 0));
    const each = Math.max(1, Number(per) || 1);
    if (!sourceItemId || !n) return null;
    const sourceQty = Math.ceil(n / each);
    const targetQty = sourceQty * each;
    return {
        sourceItemId, targetItemId: raw,
        sourceQty, targetQty, wantQty: n,
        overrun: targetQty - n,
        cutTo: `${Number(targetFt)}FT`,
        scrapFt: sourceQty * (Number(scrapFt) || 0),
        lengthFt: Number(targetFt),
    };
}

// ── THE OFFCUT IS STOCK, NOT SCRAP (Stuart 2026-10-12) ───────────────────────────────────────────────────────────────
// "when taking HTA1235 and turning into HTA635, the off cuts should also turn in to HTA435 as we can get one 6 and
//  one 4 from each 12."  CUT_OPTIONS has said so since Eric wrote it down (12 → "1 × 6 ft + 1 × 4 ft", 2 ft scrap),
// and a bench cut carries both lengths (`targets`). But a cut raised FOR A WORK ORDER names one length — the one the
// order wants — so five open orders read "10 × HTA1235 → 10 × HTA635" and the ten 4 ft pieces coming off the same
// sticks went nowhere: not into NetSuite, not onto a shelf record. The rule is read where the cut is COMPLETED, from
// the saw's own table, so it holds for a cut raised by any door (a finishing work order, Order Entry's pole choice,
// the Sales Snapshot) and for the orders already open.
/** What ELSE comes off each stick when a `sourceFt` stick is cut for `targetFt` pieces: [{ ft, per }]. */
export const alsoYieldsFor = (sourceFt, targetFt) => {
    const want = Number(targetFt);
    const opt = cutOptionsFor(sourceFt).find(o => (o.targets || []).some(t => Number(t.ft) === want));
    return opt ? (opt.targets || []).filter(t => Number(t.ft) !== want && Number(t.per) > 0).map(t => ({ ft: Number(t.ft), per: Number(t.per) })) : [];
};
// The same rod at another length, its finish kept: HTA1235 → 4 → HTA435 · HTA1235/SG → 4 → HTA435/SG.
const codeAtLength = (erp, ft) => { const c = String(erp || '').trim().toUpperCase(); const out = LEN_RE.test(rawOf(c)) ? c.replace(LEN_RE, `${ft}$2`) : ''; return out === c ? '' : out; };
/**
 * THE PIECES A CUT ORDER PUTS ON THE SHELF — one line per item its completion receives.
 * A cut that names its own lengths (`targets`, the bench) is read as written. Otherwise: the length the order was
 * raised for, and every other length the saw yields from the same sticks (`offcut: true`) — one per stick for 12 → 6.
 * @param order   a rod_cut_orders record
 * @param nsIdOf  (item code) → its NetSuite internal id, or null when the app does not know the item
 * @returns [{ itemId, internalId, qty, ft, offcut }]
 */
export const cutYieldLinesOf = (order, { nsIdOf = () => null } = {}) => {
    const o = order || {};
    if (Array.isArray(o.targets) && o.targets.length) {
        return o.targets.map(t => ({ itemId: String(t.itemId || '').toUpperCase(), internalId: t.internalId != null ? String(t.internalId) : null, qty: Number(t.qty) || 0, ft: poleLengthOf(t.itemId), offcut: false }));
    }
    const main = { itemId: String(o.targetItemId || '').toUpperCase(), internalId: o.targetInternalId != null ? String(o.targetInternalId) : null, qty: Number(o.qtyTarget) || 0, ft: poleLengthOf(o.targetItemId), offcut: false };
    const sFt = poleLengthOf(o.sourceItemId), sticks = Number(o.qtySource) || 0;
    const extra = (sFt && main.ft && sticks > 0) ? alsoYieldsFor(sFt, main.ft).map(y => {
        const itemId = codeAtLength(o.sourceItemId, y.ft);
        if (!itemId) return null;
        const id = nsIdOf(itemId);
        return { itemId, internalId: id != null && id !== '' ? String(id) : null, qty: sticks * y.per, ft: y.ft, offcut: true };
    }).filter(Boolean) : [];
    return [main, ...extra];
};
/** "10 × HTA635 + 10 × HTA435" */
export const cutYieldText = (lines = []) => (lines || []).map(l => `${l.qty} × ${l.itemId}`).join(' + ');

// ── WHERE THE WORK ORDER IS ONCE ITS CUT IS POSTED — SAID TRUTHFULLY (Stuart 2026-10-13) ─────────────────────────────
// Completing a cut for finishing clears the work order's cut gate and prints its label; it does not put the order on
// the finishing floor. RTG does that — on its own when ⚡ automatic release is on for the division (and nothing else
// holds the order), by a person when it is off. The WMS used to say "released to finishing" either way; with the switch
// off on 2026-10-12 the cut poles went to the floor and the orders stayed parked in RTG.
//   autoRelease true / false = the switch as read; null = it could not be read (say only what is known)
export const cutReleaseText = ({ woRef = '', autoRelease = null } = {}) => {
    const head = `▶ WO ${woRef}: its cut is done and its setup label is printing.`;
    if (autoRelease === true) return `${head}\nRTG's automatic release is ON — it goes to the finishing floor on its own once nothing else holds it. Send the cut poles with the label.`;
    if (autoRelease === false) return `${head}\n⚠ It is NOT on the finishing floor yet: RTG's automatic release is OFF, so someone has to release it on RTG (HQ → RTG Dispatch). Keep the cut poles and the label together until it shows in the Setup Queue.`;
    return `${head}\nIt goes to the finishing floor when RTG releases it — check the Setup Queue before sending the poles.`;
};
/** The same fact for the WMS log. */
export const cutReleaseLog = ({ cutId = '', woRef = '', autoRelease = null } = {}) =>
    `Cut ${cutId} cleared the cut gate on WO ${woRef} — label printed${autoRelease === true ? '; RTG automatic release is ON' : autoRelease === false ? '; RTG automatic release is OFF — it waits for a release on RTG' : ''}.`;

/**
 * The code for the same rod at a different length: HCUMP810 → 4 ft → HCUMP410.
 * A SUGGESTION ONLY (Stuart 2026-08-25: "we shouldn't have to limit it by pattern, you could always
 * add the input fields on the tool itself"). The grammar pre-fills the field; it never decides
 * whether a cut is allowed. Returns '' when the code carries no length block, and the operator
 * types the target themselves — which is the entire point, because HMLP810/SG and every other
 * pattern that does not follow the house grammar was simply uncuttable before.
 */
export const targetCodeFor = (sourceErp, targetFt) => {
    const raw = rawOf(sourceErp);
    if (!LEN_RE.test(raw)) return '';
    const out = raw.replace(LEN_RE, `${targetFt}$2`);
    return out === raw ? '' : out;
};

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
//
// PART HANDLING IS NOT DERIVED FROM THE CATEGORY, AND NOT FROM isStocked (Stuart 2026-09-01).
// This file briefly carried an `autoPartHandlingFor` that read "stocked poles are Small Parts" as
// implying "unstocked poles are Custom". He never said that, and it took stocked poles off the
// finishing floor: "that force should not have forced the change to custom (they should have
// stayed small parts to stay in finishing), custom drives poles to shop floor, it should have
// updated the tag finish stream to Poles finish like a pole".
//
// Handling is decided by the FINISH SUFFIX on the item code, not by the category and not by a
// stock flag — see Shared/finishRouting.handlingForErp, which owns that rule and the vocabulary
// it needs. A pole answers TWO questions from two different places: this file says how it is
// FINISHED (the pole recipe), finishRouting says where it is BUILT (finishing or the shop).
export const autoFinishStream = (productType) => isPoleCategory(productType) ? 'POLES' : '';

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

/**
 * VALIDATE A HAND-BUILT CUT — the one gate both tools go through (Stuart 2026-08-25:
 * "as long as it is category pole and the larger pole and smaller poles are all existing items in
 *  Netsuite that can be selected this would solve the problem").
 *
 * That sentence IS the rule, so it is written once here rather than re-implemented per screen —
 * the previous pair of tools drifted (HQ derived a target code, WMS demanded an 8 ft source) and
 * between them refused every rod that did not follow the house code grammar.
 *
 * Three things must be true of the source and of EVERY target, and nothing else matters:
 *   1. it is categorised POLE or ROD          — a bracket with an 8 in its code is still a bracket
 *   2. it exists in the library               — the caller resolves it and passes what it found
 *   3. it has a NetSuite internal id          — a cut moves real stock; a guessed id is worse than
 *                                               no cut at all, which is the standing rule here
 *
 * Pure: callers pass resolved records, so this is node-testable and cannot reach Firestore.
 *
 * @param {{code,internalId,productType}} source
 * @param {Array<{code,internalId,productType,per}>} targets  one entry per cut length (6 ft + 4 ft = two)
 * @param {number} qtySource how many source rods are being cut
 * @param {number} scrapFt   feet of offcut per source rod
 */
export function planManualCut({ source, targets = [], qtySource, scrapFt = 0 } = {}) {
    const errors = [];
    const q = Math.max(0, Math.floor(Number(qtySource) || 0));
    const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
    if (!q) errors.push('How many rods are being cut?');
    if (!source || !U(source.code)) errors.push('Name the rod being cut.');
    else {
        if (!isPoleCategory(source.productType)) errors.push(`${U(source.code)} is not categorised POLE or ROD — only poles are cut.`);
        if (!source.internalId) errors.push(`${U(source.code)} has no NetSuite id. Sync it first (HQ 11.1) — a cut moves real stock.`);
    }
    const tl = (targets || []).filter(t => t && U(t.code));
    if (!tl.length) errors.push('Name at least one cut length.');
    const seen = new Set();
    tl.forEach(t => {
        const code = U(t.code);
        if (seen.has(code)) errors.push(`${code} is listed twice.`);
        seen.add(code);
        if (source && code === U(source.code)) errors.push(`${code} is the same item as the rod being cut.`);
        if (!isPoleCategory(t.productType)) errors.push(`${code} is not categorised POLE or ROD.`);
        if (!t.internalId) errors.push(`${code} has no NetSuite id. Create & sync it first (HQ 11.1).`);
        if (!(Number(t.per) > 0)) errors.push(`${code}: how many come off one rod?`);
    });
    const lines = tl.map(t => ({
        itemId: U(t.code), internalId: String(t.internalId || ''),
        per: Number(t.per) || 0, qty: (Number(t.per) || 0) * q,
    }));
    return { ok: errors.length === 0, errors, qtySource: q, lines, scrapFt: (Number(scrapFt) || 0) * q };
}
