// ─────────────────────────────────────────────────────────────────────────────────────────────
// ONE SALES-ORDER HEADER, WHICHEVER DOOR IT CAME THROUGH (Stuart 2026-09-02, Q9 / Q10 — Brief E)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "One SO header shape regardless of door — yes, 100%." Until this existed CPQ's save-as-SO wrote a
// thin hq_sales_orders doc (memo, PENDING-RECIPE, reqDate = today + 14 days) and Order Entry wrote a
// rich one (customerPo, sidemark, shipTo[], needByDate, productionNotes) — so RTG read `reqDate`
// for one door and `needByDate` for the other, the finishing recipe of a CPQ order was re-derived
// at release from five places, and every document / WMS / CRM feature on the header was written
// twice. This module is the one place the header is built. A new door calls it; nobody writes the
// keys by hand again.
//
// THE KEYS (every door, the same names):
//   customer, customerId          who
//   customerPo, sidemark, jobName the customer's references
//   memo                          sidemark || jobName — the one line RTG shows on the card
//   needBy                        the CUSTOMER'S date, ISO yyyy-mm-dd, '' when none was given.
//                                 NEVER invented. (The +14-day fiction is gone: a date nobody
//                                 chose was scheduling both floors.)
//   readyDate, leadWeeks,         the date the finish class promises — see LEAD_WEEKS. '' / null
//   leadBasis, rushApplied        when the order carries no applied finish (mill, small parts).
//   shipTo[]                      resolved address lines, both doors
//   shippingMethod, shippingAddressId, customShippingAddress, shippingAmount
//   productionNotes, internalMemo
//   recipe, recipeLabel,          THE FINISH, STAMPED AT SAVE (Q10). recipe is a CODE (P01, EP3),
//   recipeSource, recipes[]       recipeLabel the words, recipeSource names which of the five
//                                 sources it came from — or 'none', so PENDING-RECIPE on the
//                                 floor explains itself. recipes[] = every distinct code on the
//                                 order (a mixed order has several).
//   source, hqJobId, appCreated   provenance
//   reqDate, needByDate           ALIASES of needBy for ONE release (RTG / WMS / Order Entry
//                                 Needs still read them); readers switch, then these stop.
//
// RULES: pure functions, no Firestore, no React. Resolve through the finish lists handed in —
// never a local regex for "is this outsourced" (that test lives in Shared/finishRouting and the
// hq_outsource_finishes list; this module only CALLS it).

import { isOutsourcedFinishCode, isAppliedFinishCode } from './finishRouting';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();

// ── THE FINISH, ONCE ─────────────────────────────────────────────────────────────────────────

/**
 * Is a finish CODE outsourced (plated)? 'P' is never outsourced — phosphate is the convert stage,
 * not a finish, and a stray record coded P must not send an in-house item to the plater. The
 * hq_outsource_finishes list is the routing authority; the canonical suffix vocabulary backs it.
 * (Lifted verbatim from Order Entry's local test so both doors share ONE.)
 */
export const isFinishOutsourced = (code, outsourceFinishes = []) => {
    const c = up(code);
    if (!c || c === 'P') return false;
    const hit = (outsourceFinishes || []).find(f => f && up(f.code || f.name) === c);
    if (hit) return hit.outsourced === undefined ? true : hit.outsourced === true;
    return isOutsourcedFinishCode(c);
};

const labelOf = (f) => f ? (f.code ? `${f.code} - ${f.name || f.code}` : (f.name || '')) : '';

/**
 * Resolve the recipe of a CPQ job from what the job carries — RTG's five-source scan
 * (fetchEnrichedJobData, 2026-08-29/30) lifted here so it runs ONCE, at save, and the SO carries
 * the answer. Sources, in RTG's order:
 *   1 finishes      cartItems[].finishes[] (the TAGS engine writes finish OBJECTS on the item)
 *   2 finishLabel   cartItems[].finishLabel (the words; matched back to a master finish)
 *   3 configKey     `…__finish` step keys in cartItems[].config / dynamicConfigParams / the legacy
 *                   cpqData.configuration
 *   4 lineCode      cartItems[].engineConfig.globalFinish + every pricingBreakdown[] / breakdown[]
 *                   finishCode (codes)
 *   5 configValue   any config value that happens to be a master finish id or code
 * Matched against the finish lists by id OR code, case-insensitive.
 *
 * @returns { recipe: CODE|'', recipeLabel, recipeSource, recipes: [CODE…] }
 */
export function resolveJobRecipe(job, finishes = []) {
    const cpq = (job && job.cpqData) || {};
    const carts = Array.isArray(cpq.cartItems) ? cpq.cartItems.filter(Boolean) : [];
    const pool = (finishes || []).filter(Boolean);
    const byId = (v) => pool.find(f => String(f.id) === String(v));
    const byCode = (v) => pool.find(f => f.code && up(f.code) === up(v));
    const match = (v) => (v == null || v === '') ? null : (byId(v) || byCode(v) || null);

    // Every distinct per-line code on the order — what a mixed order looks like.
    const lineCodes = [
        ...carts.flatMap(ci => (ci.pricingBreakdown || [])).map(l => l && l.finishCode),
        ...(cpq.breakdown || []).map(l => l && l.finishCode),
    ].filter(Boolean).map(up);
    const recipes = [...new Set(lineCodes)];

    const out = (fin, source, fallbackCode = '') => {
        const code = fin ? up(fin.code || fin.name) : up(fallbackCode);
        return {
            recipe: code,
            recipeLabel: fin ? labelOf(fin) : code,
            recipeSource: source,
            recipes: code && !recipes.includes(code) ? [code, ...recipes] : recipes,
        };
    };

    // 1 — finish objects on the item
    const finObj = carts.flatMap(ci => ci.finishes || []).find(f => f && (f.code || f.name));
    if (finObj) return out(match(finObj.code) || match(finObj.id) || finObj, 'finishes');

    // 2 — the words on the item ("P01 - Bronze"): the code is the part before the dash
    const label = carts.map(ci => str(ci.finishLabel)).find(Boolean);
    if (label) {
        const head = label.split(/\s[-–—]\s/)[0];
        const fin = match(head) || match(label);
        return out(fin, 'finishLabel', head);
    }

    // 3 — `__finish` step keys
    const configs = [];
    if (cpq.configuration) configs.push(cpq.configuration);
    carts.forEach(ci => { if (ci.config) configs.push(ci.config); if (ci.dynamicConfigParams) configs.push(ci.dynamicConfigParams); });
    const keyVals = configs.flatMap(c => Object.entries(c || {}).filter(([k]) => /__finish$/i.test(k)).map(([, v]) => v));
    for (const v of keyVals) { const fin = match(v); if (fin) return out(fin, 'configKey'); }

    // 4 — codes the engine wrote
    const engineCodes = [
        ...carts.map(ci => ci.engineConfig && ci.engineConfig.globalFinish).filter(Boolean),
        ...lineCodes,
    ];
    for (const v of engineCodes) { const fin = match(v); if (fin) return out(fin, 'lineCode'); }
    if (engineCodes.length) return out(null, 'lineCode', engineCodes[0]);

    // 5 — any config value
    const prim = (v) => (typeof v === 'string' || typeof v === 'number') ? [String(v)] : [];
    const allVals = configs.flatMap(c => Object.values(c || {})).flatMap(v => (v && typeof v === 'object') ? Object.values(v).flatMap(prim) : prim(v));
    for (const v of allVals) { const fin = match(v); if (fin) return out(fin, 'configValue'); }

    return { recipe: '', recipeLabel: '', recipeSource: 'none', recipes };
}

// ── THE READY DATE ───────────────────────────────────────────────────────────────────────────
//
// Stuart 2026-09-03: "show ready date of 4 weeks if /P finish, and 6 weeks for /EP /MEP; to
// shorten days they must add the rush fee at check out, then 2 weeks and 4 weeks." The lead
// time is a property of the FINISH CLASS, not of a flow or an item — so it lives here, once.
// An order with no applied finish (mill, or a small-parts colour like /BS /N90 /CP) makes no
// promise: leadBasis null, readyDate ''. Ask before adding a class here; do not derive one.
export const LEAD_WEEKS = {
    PAINT:  { std: 4, rush: 2 },   // in-house applied paint: P, P01…P24
    PLATED: { std: 6, rush: 4 },   // outsourced: EP1…EP6, MEP*, P25
};

/** The finish class the order's lead time follows: 'PLATED' beats 'PAINT'; null = no promise. */
export const leadBasisOf = (codes = []) => {
    const cs = (codes || []).filter(Boolean).map(up);
    if (cs.some(isOutsourcedFinishCode)) return 'PLATED';
    if (cs.some(c => isAppliedFinishCode(c))) return 'PAINT';
    return null;
};

/** { leadBasis, leadWeeks, readyDate, rushApplied } for the codes on an order. */
export function readyDateOf({ codes = [], rush = false, from = Date.now() } = {}) {
    const basis = leadBasisOf(codes);
    if (!basis) return { leadBasis: null, leadWeeks: null, readyDate: '', rushApplied: !!rush };
    const weeks = rush ? LEAD_WEEKS[basis].rush : LEAD_WEEKS[basis].std;
    const d = new Date(typeof from === 'number' ? from : Date.parse(from) || Date.now());
    d.setDate(d.getDate() + weeks * 7);
    return { leadBasis: basis, leadWeeks: weeks, readyDate: d.toISOString().split('T')[0], rushApplied: !!rush };
}

/**
 * Is this library item a RUSH fee? The same keyword test Order Entry's fee pickers have always
 * used (productType / name / customData.feeType contains RUSH or EXPEDITE). One copy.
 * (S1 candidate: a feeType tag on the item would replace the keyword — not this pass.)
 */
export const isRushFeeItem = (part) => {
    if (!part) return false;
    const hay = `${part.manufacturingSpecs?.productType || ''} ${part.productType || ''} ${part.itemName || ''} ${part.customData?.feeType || ''} ${part.manufacturingSpecs?.customData?.feeType || ''}`.toUpperCase();
    return hay.includes('RUSH') || hay.includes('EXPEDITE');
};

/** Words for the checkout panel and the documents. */
export const leadText = ({ leadBasis, leadWeeks, readyDate, rushApplied }) => {
    if (!leadBasis) return 'No ready-date promise — nothing on this order carries an applied (painted or plated) finish.';
    const cls = leadBasis === 'PLATED' ? 'plated finish' : 'painted finish';
    const alt = rushApplied ? '' : ` — add the Rush fee at checkout to shorten to ${LEAD_WEEKS[leadBasis].rush} weeks`;
    return `Ready ${readyDate} (${leadWeeks} weeks, ${cls}${rushApplied ? ', rush' : ''})${alt}.`;
};

// ── THE ADDRESS LINES ────────────────────────────────────────────────────────────────────────

// A custom drop-ship carries attention + addressee (both print); a saved NetSuite address-book
// entry carries a label, which prints only when the entry has no street (Order Entry's rule).
const fmtAddr = (a) => !a ? [] : [
    a.attention, a.addressee,
    (!a.addr1 && !a.addressee && !a.attention) ? a.label : '',
    a.addr1, a.addr2,
    [a.city, a.state].filter(Boolean).join(', ') + (a.zip ? ' ' + a.zip : ''),
].map(x => str(x)).filter(Boolean);

/**
 * The ship-to lines a document prints and the pack station reads: the order's custom drop-ship
 * address, else its saved NetSuite address-book entry, else the customer's default — never the
 * sidemark. `customer` is the CRM record (shippingAddresses[]).
 */
export function shipToLinesOf({ shippingMethod, shippingAddressId, customShippingAddress, customer } = {}) {
    if (String(shippingMethod || '').toUpperCase() === 'CUSTOM' && customShippingAddress && str(customShippingAddress.addr1)) {
        return fmtAddr(customShippingAddress);
    }
    const list = (customer && customer.shippingAddresses) || [];
    const saved = list.find(a => String(a.addressBookId) === String(shippingAddressId))
        || list.find(a => a.isDefault) || list[0] || null;
    return fmtAddr(saved);
}

// ── THE HEADER ───────────────────────────────────────────────────────────────────────────────

/**
 * The one header block every door spreads into its hq_sales_orders doc.
 *
 * door 'CPQ' | 'CRM'     → from the JOB (jobs doc as saved by finalize / as approved in the CRM)
 * door 'QUICKSHIP'       → from the Order Entry FORM: { soExtras, ship, jobName, lines }
 * `customer` = the CRM record (for the ship-to lines), `finishes` = master + outsourced finish
 * objects (for the recipe), `outsourceFinishes` = the hq_outsource_finishes list.
 */
export function soHeaderOf({ door, job = null, form = null, customer = null, by = '', finishes = [], outsourceFinishes = [], now = Date.now() } = {}) {
    const d = up(door) || 'CPQ';
    let h;
    if (d === 'QUICKSHIP') {
        const ex = (form && form.soExtras) || {};
        const ship = (form && form.ship) || {};
        const lines = (form && form.lines) || [];
        const codes = [...new Set(lines.filter(l => l && l.toBeFinished && l.finishCode).map(l => up(l.finishCode)))];
        const rush = !!(form && form.rush);
        h = {
            customerPo: str(ex.po), sidemark: str(ex.sidemark), jobName: str(form && form.jobName),
            needBy: str(ex.needBy),
            shipTo: shipToLinesOf({ shippingMethod: ship.method, shippingAddressId: ship.addressId, customShippingAddress: ship.custom, customer }),
            shippingMethod: ship.method || 'SAVED', shippingAddressId: ship.addressId || null,
            customShippingAddress: ship.method === 'CUSTOM' ? (ship.custom || null) : null,
            shippingAmount: parseFloat(ship.amount) || 0,
            productionNotes: str(ex.prodNotes), internalMemo: str(ex.internalMemo),
            recipe: codes.length === 1 ? codes[0] : '',
            recipeLabel: codes.length === 1 ? (labelOf((finishes || []).find(f => f && up(f.code) === codes[0])) || codes[0]) : '',
            recipeSource: codes.length === 1 ? 'lineCode' : (codes.length ? 'mixed' : 'none'),
            recipes: codes,
            ...readyDateOf({ codes, rush, from: now }),
            source: 'QUICKSHIP', hqJobId: null, appCreated: true,
        };
    } else {
        const j = job || {};
        const rec = resolveJobRecipe(j, finishes);
        const codes = rec.recipes.length ? rec.recipes : (rec.recipe ? [rec.recipe] : []);
        h = {
            customerPo: str(j.poNumber), sidemark: str(j.orderSidemark || ''), jobName: str(j.jobName),
            needBy: str(j.needBy),
            shipTo: shipToLinesOf({ shippingMethod: j.shippingMethod, shippingAddressId: j.shippingAddressId, customShippingAddress: j.customShippingAddress, customer }),
            shippingMethod: j.shippingMethod || 'SAVED', shippingAddressId: j.shippingAddressId || null,
            customShippingAddress: j.shippingMethod === 'CUSTOM' ? (j.customShippingAddress || null) : null,
            shippingAmount: parseFloat(j.shippingAmount) || 0,
            productionNotes: str(j.productionNotes), internalMemo: str(j.internalMemo),
            ...rec,
            // The job already carries the promise it was saved with; recompute only when it has none.
            ...(j.readyDate !== undefined
                ? { leadBasis: j.leadBasis || null, leadWeeks: j.leadWeeks || null, readyDate: str(j.readyDate), rushApplied: !!j.rushApplied }
                : readyDateOf({ codes, rush: !!j.rushApplied, from: now })),
            source: d, hqJobId: j.id || j.jobId || null, appCreated: true,
        };
    }
    const custName = str(customer && customer.name) || str(job && job.customer && job.customer.name) || str(form && form.customerName);
    const custId = str(customer && customer.id) || str(job && job.customer && job.customer.id) || str(form && form.customerId);
    // `memo` keeps CPQ's historical fallback chain (job.sidemark carries jobName / 'Multi-Room
    // Project' fallbacks) because RTG cards, floor notes and the NetSuite memo all read it.
    const memo = str(job && job.sidemark) || h.sidemark || h.jobName || '';
    return {
        customer: custName, customerId: custId,
        ...h,
        memo,
        // Aliases for one release — see the header comment. Readers switch, then these go.
        reqDate: h.needBy, needByDate: h.needBy,
        createdBy: by || '',
    };
}

/**
 * Stamp `finishOutsourced` on every line that carries a finish code (both doors, one test).
 * Lines without a finish are left untouched — absence means mill, and a false flag would read as
 * "in-house" on a line that was never finished at all.
 */
export const stampLineFinishRouting = (lines = [], outsourceFinishes = []) =>
    (lines || []).map(l => (l && l.finishCode) ? { ...l, finishOutsourced: isFinishOutsourced(l.finishCode, outsourceFinishes) } : l);
