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
export function fabricutPriceOf(part, levelId, finishCode, outsourceCodes) {
    const lvl = PRICE_LEVELS.find(l => l.id === levelId);
    const fab = part?.manufacturingSpecs?.fabricut;
    if (!lvl?.field || !fab) return null;

    const code = String(part.legacyErpId || part.itemId || '').trim().toUpperCase();
    const suffix = code.includes('/') ? code.split('/')[1] : '';
    // Suffixless docs (FEE items, mill bases priced directly) tier by the CHOSEN finish when the
    // caller passes it — a fee has no /P //EP variant docs; its painted vs plated price follows
    // the finish picked on that step (french return $35 painted / $43 plated on ONE record).
    const fcU = String(finishCode || '').toUpperCase();
    const tier = (isPlatedSuffix(suffix, outsourceCodes) || (!suffix && isPlatedSuffix(fcU, outsourceCodes))) ? 'plated' : 'painted';
    const tiered = (f) => fab[f] !== undefined ? fab[f] : fab[`${tier}${f[0].toUpperCase()}${f.slice(1)}`];

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
