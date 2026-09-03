// OUTSOURCED-FINISH ROUTING — one vocabulary for "does this order touch our spray line, or does it
// go out to the plater?" (Stuart 2026-07-30: "these orders … are both for items that have
// outsourced finishes, so the cpq/routing … needs to respect the outsourced and these both should
// be routed to wms pick and pack").
//
// An outsourced finish (EP1…EP6, MEP*, P25) is applied by an outside plater. There is nothing for
// the Finishing Floor to set up, batch or spray — the parts are picked, staged into the OB PLATING
// bin and ride the weekly plater PO. Before this, those orders still landed in the finishing Setup
// queue (grouped under PENDING-RECIPE, because no in-house recipe ever resolves for them) where
// they sat as work nobody could do.
//
// The codes live in the ITEM ID's finish suffix — H1-1CP-V/EP4 is the plated part, H1-1CP-V is the
// mill-finish core it is plated FROM. That relationship is also what lets the pick app cover a
// short plated bin by pulling mill cores and sending them out to plate (see PickPackApp).

// EP1–EP6 / bare EP (Classical Elements), MEP* (M2C bronze patina family), P25.
const OUTSOURCED_CODE_RE = /^(?:M?EP\d*|P25)$/i;
// The same set, for scanning free text like a recipe string ("Brimar MEP2 patina").
const OUTSOURCED_TEXT_RE = /\b(M?EP\d*|P25)\b/gi;

export const isOutsourcedFinishCode = (code) => OUTSOURCED_CODE_RE.test(String(code || '').trim());

// The finish suffix of an item id: everything after the LAST '/'. '' when the id carries none.
export const finishSuffixOf = (erpId) => {
    const s = String(erpId || '').trim();
    const i = s.lastIndexOf('/');
    return i > 0 ? s.slice(i + 1).toUpperCase() : '';
};

// The mill-finish core an id is finished FROM: H1-1CP-V/EP4 → H1-1CP-V. An id with no finish
// suffix is already the core and comes back unchanged.
export const millBaseOf = (erpId) => {
    const s = String(erpId || '').trim();
    const i = s.lastIndexOf('/');
    return i > 0 ? s.slice(0, i) : s;
};

export const isOutsourcedErp = (erpId) => isOutsourcedFinishCode(finishSuffixOf(erpId));

// ── THE STOCK TIER of a code (Brief A, A6 — 2026-09-02) ────────────────────────────────────────
// Fabricut H1 is stocked at three levels that only make sense read together: the raw mill core,
// the /P phosphated base, the outsourced plated variant — and any other painted suffix that stocks
// in its own right is finished goods. Two local copies of this rule (Stock View's tierOfItem and
// 4.5 Mass Update's tierOfErp) disagreed on what "plated" meant: one asked whether a configured
// outsource-finish record happened to match, the other whether the suffix started with EP. The
// canonical outsourced vocabulary above decides, once.
export const TIER = { RAW: 'RAW', P: 'P', PLATE: 'PLATE', FIN: 'FIN' };
export const tierOfErp = (erpId) => {
    const sfx = finishSuffixOf(erpId);
    if (!sfx) return TIER.RAW;
    if (sfx === 'P') return TIER.P;
    return isOutsourcedFinishCode(sfx) ? TIER.PLATE : TIER.FIN;
};

// ── APPLIED FINISH vs ASSEMBLY FINISH — what decides Custom / Small Parts ──────────────────────
// Stuart 2026-09-01, after the isStocked rule shipped and was wrong:
//   "any pole that does not have an assembly finish code, which ends before the /p, and the cpq
//    and/or order entry apply the finish /P01, /EP1, etc. these all are routed to custom and
//    finish like poles. any pole that has a complete assembly ie. HCUMP810/BS these are routed to
//    small parts and finish like poles, any pole that is handled with rod cuts is this same way."
//   "all finishes with /P are in house custom (except P25 that is out source custom), all EP and
//    MEP are outsourced custom. All other colors like CP, SG, N90, etc. are all small parts."
//
// So the question is never "is it stocked" — it is "does this code already NAME its finish, or is
// a finish about to be applied to it". A mill code (HCUMP810) and an applied-finish code
// (HCUMP810/P, /P01, /EP3) are both made to order: cut, fabricated and finished for this order,
// which is the custom division. A complete assembly (HCUMP810/BS, /N90, /CP) is an ordinary
// finishing job on a stocked part — including the ones rod cuts produce, which arrive as exactly
// that. The suffix is the whole test.
const APPLIED_PAINT_RE = /^P\d*$/i;                 // P (the rollup), P01…P24, P25 is plated below
// ── WOOD IS SMALL PARTS UNTIL THE ORDER SAYS OTHERWISE (Stuart 2026-09-03) ────────────────────
// Asked twice and settled on the second pass. First answer: "stained wood can go to custom to be
// cut then finished" — which read as "S-codes are an applied finish". Wrong place. He then gave
// the actual rule:
//
//   "wood + miter → Custom, wood + straight → finishing is perfect. there will never be miter or
//    custom bends/french returns on order entry, those will always come from cpq. so wood from
//    order entry right to finishing. metal from order entry follows same rules as cpq."
//
// Straight-vs-miter is a fact about the ORDER LINE, not about the item: the same wood pole is
// straight on one order and mitered on the next. So it cannot live in this function, which sees
// only an item code — a wood stain stays SMALL PARTS here, the straight case, which is also what
// Order Entry always wants because miters never come through that door.
//
// The miter escalation already has its home and needs nothing from this file:
// Shared/lineClassification reads `manufacturingSpecs.partHandling` from the item and lets the
// PER-LINE `partHandling` (propagated from the CPQ flow step) override it, and RTG's
// autoSplitSalesOrder splits on that. A mitered CPQ line escalates there; a straight one does not.
//
// So `SG` (Satin Gold), `N90`, `CP` AND the wood stains `S04`/`S11` all fall through together —
// which is what this function did before 224af1c, now deliberate and explained rather than
// accidental.
// WHAT A WOOD STAIN IS, for the screens that need to NAME it — not for routing. Brief E's
// ready-date rule needs it (Stuart 2026-09-03: "for wood 4 weeks is lead time", and a stained
// order must not read "painted finish"). S plus DIGITS: `SG` is a small-parts colour he named
// himself and is not a stain. Deliberately NOT part of isAppliedFinishCode — see the note above.
const WOOD_STAIN_RE = /^S\d+$/i;
export const isWoodStainCode = (code) => WOOD_STAIN_RE.test(String(code || '').trim());

export const isAppliedFinishCode = (code) =>
    isOutsourcedFinishCode(code) || APPLIED_PAINT_RE.test(String(code || '').trim());

/**
 * Part Handling from the item code alone: 'Custom' or 'Small Parts'.
 *
 * DELIBERATELY NOT APPLIED LIBRARY-WIDE. Brackets, backplates, rings and finials are tagged Small
 * Parts on purpose (see Shared/lineClassification §1) and a plated bracket — H1-1CP-V/EP4 — must
 * stay there; routing those to the shop is what starved the finishing pick list once already.
 * Callers scope it to the pole/rod category.
 */
export const handlingForErp = (erpId) => {
    const suffix = finishSuffixOf(erpId);
    return (!suffix || isAppliedFinishCode(suffix)) ? 'Custom' : 'Small Parts';
};

const uniq = (a) => Array.from(new Set(a.map(x => String(x).toUpperCase())));

/**
 * Does this work order belong to the plater instead of the finishing floor?
 *
 * Deliberately CONSERVATIVE: it reroutes only on positive evidence of an outsourced finish AND no
 * evidence of in-house finishing. A mixed order (some plated parts, some sprayed here) still needs
 * the floor, so it stays exactly where it is.
 *
 * @param {object} wo   fin_workorders doc — recipe/color/finishRecipe, stockErpId/type, partsList[]
 * @returns {{outsourced: boolean, codes: string[], via: string}}
 */
export const finishRouteOf = (wo) => {
    const none = { outsourced: false, codes: [], via: '' };
    if (!wo) return none;

    // 1. A RESOLVED recipe is the order's own answer — trust it over the part ids.
    const recipe = String(wo.recipe || wo.color || wo.finishRecipe || '').trim();
    const recipeResolved = recipe && !/^(PENDING[-\s]?RECIPE|PENDING|N\/A|NONE|[-—])$/i.test(recipe);
    if (recipeResolved) {
        const hits = recipe.match(OUTSOURCED_TEXT_RE) || [];
        return hits.length ? { outsourced: true, codes: uniq(hits), via: 'recipe' } : none;
    }

    // 2. No recipe (the PENDING-RECIPE case these orders sit in): read the finish suffixes off the
    //    parts themselves. Lines with no suffix are raw/unfinished and vote neither way.
    const ids = [
        ...(Array.isArray(wo.partsList) ? wo.partsList : []).map(l => (l && (l.legacyErpId || l.partId)) || ''),
        wo.stockErpId || '',
        wo.orderType === 'stock' ? (wo.type || '') : ''
    ];
    const out = [], inHouse = [];
    ids.forEach(id => {
        const sfx = finishSuffixOf(id);
        if (!sfx) return;
        (isOutsourcedFinishCode(sfx) ? out : inHouse).push(sfx);
    });
    if (out.length && !inHouse.length) return { outsourced: true, codes: uniq(out), via: 'part ids' };
    return none;
};

/**
 * Which item codes on an order cannot be covered from stock?
 *
 * Demand is summed PER CODE ACROSS THE ORDER, which is the whole point: the Fabricut order carries
 * H1-1CP-V/EP4 twice at 100 pc against a bin holding 100. Per line each looks satisfiable; only the
 * total (200 vs 100) is short. Each shortage also reports its mill core, so the pick app can offer
 * to cover it by pulling mill stock and sending it out to plate.
 *
 * @param {object[]} lines   pickable lines: { legacyErpId|partId, quantity|qty }
 * @param {(code:string)=>number} availOf   live availability for a code
 * @returns {{code,need,have,short,finishCode,mill,millAvail,plateable}[]}
 */
export const shortagesOf = (lines, availOf) => {
    const need = {};
    (lines || []).forEach(l => {
        const c = String(((l && (l.legacyErpId || l.partId)) || '')).toUpperCase();
        if (!c || c === 'PENDING' || c === 'N/A' || c === 'UNASSIGNED') return;
        need[c] = (need[c] || 0) + (Number((l && (l.quantity ?? l.qty))) || 0);
    });
    return Object.keys(need).map(code => {
        const have = Number(availOf(code)) || 0;
        const short = need[code] - have;
        if (short <= 0) return null;
        const finishCode = finishSuffixOf(code);
        const mill = millBaseOf(code);
        return {
            code, need: need[code], have, short, finishCode, mill,
            millAvail: Number(availOf(mill)) || 0,
            plateable: !!finishCode && isOutsourcedFinishCode(finishCode) && mill !== code
        };
    }).filter(Boolean);
};

/**
 * What can actually be done about a shortage, given what the mill core holds right now.
 *
 * Three outcomes, and the middle one matters: a mill holding 40 of the 100 we are short should
 * still send 40 out to plate AND raise the make-40-more flag — not stall the whole line on
 * all-or-nothing (Stuart 2026-07-30: "if we do not have enough stock of the base item in mill
 * finish then it needs to pop up on the stocked sales snapshot to be work ordered").
 *
 * @param {number} short      pieces the order is short of the plated code
 * @param {number} millAvail  pieces of the mill core on hand
 * @returns {{fromMill:number, coresToMake:number, plate:boolean, flagUrgent:boolean}}
 */
export const coverPlan = (short, millAvail) => {
    const s = Math.max(0, Number(short) || 0);
    const m = Math.max(0, Number(millAvail) || 0);
    const fromMill = Math.min(s, m);
    const coresToMake = s - fromMill;
    return { fromMill, coresToMake, plate: fromMill > 0, flagUrgent: coresToMake > 0 };
};
