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
