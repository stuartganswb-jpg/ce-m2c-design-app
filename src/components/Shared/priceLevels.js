// PRICE LEVELS (Fabricut H1, Stuart 2026-07-09/10) — quote-DISPLAY pricing tiers read from the
// manufacturingSpecs.fabricut struct the CrossReference import stamps on every item/variant:
//   retail    = Fabricut MSRP ("Retail Price" column)
//   wholesale = Fabricut street price ("Wholesale Price" column, uniformly MSRP ÷ 2)
//   cost      = CE's price to Fabricut ("Sale Price" column)
// STANDARD = the app's existing behavior (basePrice + clientPricing) — untouched.
//
// Scope rules: a level other than STANDARD overrides the price ONLY for items that carry Fabricut
// data — fees, author-priced options and non-Fabricut parts keep their standard pricing, so a
// quote is a faithful mix (Fabricut items per the sheet + our fees). The NetSuite push itself is
// NEVER driven by the level: physical lines push at standard rates and the rollup absorbs the
// balance to the quoted total (the push confirm names the level so nobody is surprised).
export const PRICE_LEVELS = [
    { id: 'STANDARD', label: 'Standard — our pricing', short: 'STANDARD' },
    { id: 'FAB_COST', label: 'Fabricut Cost — CE → Fabricut', short: 'FABRICUT COST', field: 'cost' },
    { id: 'FAB_WHOLESALE', label: 'Fabricut Wholesale — MSRP ÷ 2', short: 'FABRICUT WHOLESALE', field: 'wholesale' },
    { id: 'FAB_RETAIL', label: 'Fabricut Retail — MSRP', short: 'FABRICUT RETAIL', field: 'retail' },
];

export const priceLevelShort = (id) => PRICE_LEVELS.find(l => l.id === id)?.short || 'STANDARD';

// ── WHICH LEVEL DOES THIS CUSTOMER PRICE AT (Stuart 2026-08-22) ───────────────────────────────
// "one pricing engine for whole site, portal, etc. … tab 4.6 for all customers whom get their own
//  pricing/id's is the place with those tools, all other customers either base price or we create
//  them their own pricing on 4.6."
//
// The engine used to default ANY named customer to Fabricut Cost. That was written to solve a real
// problem — a mill item has no base price, so a connected customer saw a screen of $0.00 lines —
// but it made somebody else's sheet the fallback for every account. Brimar's french return came in
// at Fabricut's $35 instead of their own $45, and making the customer's row outrank the default
// patched the symptom while leaving the fallback in place for every item they had no row on.
//
// So the level a customer prices at is a fact ABOUT THE CUSTOMER, stored on their CRM record and
// edited in 4.6 — not something inferred from their name in four different files. An account with
// no answer prices at STANDARD: their own rows, then base price. That is the whole rule, and it is
// the same rule for CPQ, Quick Ship and the portal.
//
// `chosen` = a level a human picked on screen this session; it always wins.
// Returns { level, isDefault } — isDefault says the level was not chosen by anyone, which is what
// lets a customer's own negotiated row outrank it (see hardwarePricing's precedence).
export function customerPriceLevel(customer, chosen) {
    if (chosen && chosen !== 'STANDARD') return { level: chosen, isDefault: false };
    const set = String(customer?.defaultPriceLevel || '').trim().toUpperCase();
    if (set && PRICE_LEVELS.some(l => l.id === set)) return { level: set, isDefault: set !== 'STANDARD' };
    // ⚠ TRANSITIONAL: Fabricut priced this way before the field existed, and losing it on deploy
    // would silently reprice their whole catalogue at base price. Set defaultPriceLevel on the CRM
    // record in 4.6 — an explicit STANDARD turns it off — and this shim can be deleted.
    if (/fabricut/i.test(String(customer?.name || customer?.companyName || ''))) return { level: 'FAB_COST', isDefault: true };
    return { level: 'STANDARD', isDefault: false };
}

// ---- WHICH FINISHES ARE "PREMIUM" (Stuart 2026-07-29) ---------------------------------------
// "the premium rule really should apply to OUTSOURCED FINISHES rather than just looking at the EP,
// so that it covers P25 — the import tool missed this at times as well."
//
// Every tier test here used to be `suffix.startsWith('EP')`. /P25 IS an outsourced plated finish —
// we send the part out for it, exactly like /EP1 — but its suffix starts with P, so the EP test
// read it as an in-house paint and priced it off the PAINTED tier. Under-priced, and mislabelled
// on the quote. (The NetSuite item sync already knew better: it flags /P25 Plated + not-in-house.)
//
// The authority is the configured hq_outsource_finishes registry; pass its codes when the caller
// has them subscribed. The defaults are UNIONED in rather than replaced, so a caller without the
// registry still gets P25 right and a registry that hasn't been extended can't silently regress it.
export const DEFAULT_PLATED_SUFFIXES = ['P25'];

export const isPlatedSuffix = (suffix, outsourceCodes) => {
    const s = String(suffix || '').trim().toUpperCase();
    if (!s) return false;
    if (/^EP\d*$/.test(s)) return true;                       // EP, EP1…EP6
    const codes = new Set(DEFAULT_PLATED_SUFFIXES);
    (Array.isArray(outsourceCodes) ? outsourceCodes : []).forEach(c => {
        const v = String((c && (c.code || c.name)) || c || '').trim().toUpperCase();
        if (v) codes.add(v);
    });
    return codes.has(s);
};

// Fabricut pattern id for a resolved item. Variant docs don't carry codes — they live on the BASE
// doc (fabCodePainted / fabCodePremium / fabCodeBase, stamped by the CrossReference import); the
// tier follows the variant's own finish suffix (…/EPn → PREMIUM code). findByCode resolves the
// base doc from an UPPERCASE ERP code.
export function fabricutCodeOf(part, findByCode, outsourceCodes) {
    if (!part) return null;
    const code = String(part.legacyErpId || part.itemId || '').trim().toUpperCase();
    if (!code) return null;
    const [base, sfx = ''] = code.split('/');
    let doc = part;
    if ((sfx || !part.manufacturingSpecs?.fabricut) && typeof findByCode === 'function') doc = findByCode(base) || part;
    const fab = doc?.manufacturingSpecs?.fabricut;
    if (!fab) return null;
    if (isPlatedSuffix(sfx, outsourceCodes)) return fab.fabCodePremium || fab.fabCodePainted || fab.fabCodeBase || null;
    return fab.fabCodePainted || fab.fabCodeBase || fab.fabCodePremium || null;
}

// The level price for a resolved part (AFTER size/species/finish resolution), or null when this
// level has nothing to say about it (→ caller keeps standard pricing).
//   - Finish-variant and single-finish docs carry direct {retail, cost, wholesale}.
//   - Base (mill) docs carry paintedRetail/… + platedRetail/… — the tier follows the doc's own
//     finish suffix through isPlatedSuffix (…/EPn AND /P25 → plated), defaulting to painted.
//   - Explicit null (backplates — "arm price includes the plate") → a $0 line, NOT a fallback.
//   - Missing wholesale falls back to retail ÷ 2 (the Traversing sheet has no wholesale column).
export function fabricutPriceOf(part, levelId, finishCode, outsourceCodes, findByCode) {
    const lvl = PRICE_LEVELS.find(l => l.id === levelId);
    let fab = part?.manufacturingSpecs?.fabricut;
    if (!lvl?.field) return null;

    const code = String(part?.legacyErpId || part?.itemId || '').trim().toUpperCase();
    let suffix = code.includes('/') ? code.split('/')[1] : '';

    // VARIANTS INHERIT THE BASE ITEM'S TIERS (Stuart 2026-08-12, the traverse brackets). The 4.6
    // tier editor has always SAID "a base item carries the painted and plated tiers — its variants
    // inherit them", but only pattern CODES ever fell back to the base doc; prices did not, so a
    // /P variant with no imported struct silently kept standard pricing while the operator's tier
    // entry on the base sat unread. H1 never noticed because its import stamped every variant.
    //
    // Fallback fires ONLY when the resolved doc is a suffixed variant carrying NO fabricut struct
    // of its own — a stamped variant still wins with its exact numbers, and the caller that passes
    // no findByCode (the portal mirror) behaves exactly as before. In the fallback the base doc's
    // DIRECT cost/wholesale/retail are deliberately invisible: those are "this item's own price" —
    // the mill / simple-finish rate — and must never shadow the painted/plated tier a variant
    // prices from.
    let tierOnly = false;
    if (!fab && suffix && typeof findByCode === 'function') {
        const baseDoc = findByCode(code.split('/')[0]);
        const baseFab = baseDoc?.manufacturingSpecs?.fabricut;
        if (baseFab) { fab = baseFab; tierOnly = true; }
    }
    if (!fab) return null;
    // Suffixless docs (FEE items, mill bases priced directly) tier by the CHOSEN finish when the
    // caller passes it — a fee has no /P //EP variant docs; its painted vs plated price follows
    // the finish picked on that step (french return $35 painted / $43 plated on ONE record).
    const fcU = String(finishCode || '').toUpperCase();
    const tier = (isPlatedSuffix(suffix, outsourceCodes) || (!suffix && isPlatedSuffix(fcU, outsourceCodes))) ? 'plated' : 'painted';
    // ⚠ A NULL BARE COLUMN IS NOT ALWAYS "INCLUDED" (Stuart 2026-08-20: the french and miter return
    // fees quoting $0). Two different shapes were being read the same way:
    //
    //   a BACKPLATE has cost UNDEFINED and paintedCost NULL — nothing anywhere, which is the
    //     deliberate "included in the arm price" case the null → 0 rule below exists for;
    //   a FEE like H1-FRPF has cost NULL but paintedCost 35 and platedCost 43 — priced only in the
    //     tier columns, because /P and /EP genuinely cost different amounts and one bare column
    //     cannot hold both.
    //
    // The old test asked `!== undefined`, so a NULL bare column won and never reached the tier
    // beside it — then null → 0 read it as free. Five items were quoting $0 with real money in the
    // painted and plated columns: both return fees and all three acrylic finials.
    //
    // A real bare value still wins; a real TIER value now beats a null bare one; and when neither
    // holds anything this returns exactly what it always did, so the plates stay included.
    const tiered = (f) => {
        const tierKey = `${tier}${f[0].toUpperCase()}${f.slice(1)}`;
        const bare = tierOnly ? undefined : fab[f];
        if (bare !== undefined && bare !== null) return bare;
        const tv = fab[tierKey];
        if (tv !== undefined && tv !== null) return tv;
        return (!tierOnly && fab[f] !== undefined) ? fab[f] : tv;
    };

    let v = tiered(lvl.field);
    if (lvl.field === 'wholesale' && (v === undefined || v === null)) {
        const r = tiered('retail');
        if (r !== undefined && r !== null && Number.isFinite(parseFloat(r))) return parseFloat(r) / 2;
        v = r; // null retail (plates) falls through to the null → $0 rule
    }
    if (v === undefined) return null;          // no data for this tier — keep standard pricing
    if (v === null) return 0;                  // explicit: included in the arm price (BP/RBP)
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
}
