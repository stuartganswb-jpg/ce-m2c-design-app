// ─────────────────────────────────────────────────────────────────────────────────────────────
// FINISH → THE ITEM THAT IS ACTUALLY SOLD
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// A mill base item ("H1-138KF") is not a sellable thing and usually carries NO price. What ships,
// what NetSuite bills and what the Customer Alias & Pricing box prices is the finished variant:
//
//   • every paint (P01, P02, …) shares ONE rolled-up "/P" item — one record, one price, because
//     the shop charges the same to spray any colour;
//   • plated finishes are stocked as EXACT "/EP1".."/EP6" items, since each plating bath costs
//     differently and each is a real, countable SKU;
//   • fee items carry ONE generic "/EP" record instead of six, so a fee still has a plated price
//     without six near-identical records to maintain;
//   • anything else may have an exact "/<CODE>" SKU.
//
// This resolution is IDENTITY, not pricing — it answers "which record is this", and the price then
// comes from wherever that record's price comes from. It lived inline in CPQTab, where the tag
// engine could not reach it; that is why a configuration in the new engine showed every line at
// $0.00 with no customer alias, while the same parts priced correctly in the old one. The mill item
// genuinely has no price and no pattern number — the variant has both.
//
// It lives here, shared, so there is exactly ONE copy. A second implementation of an identity rule
// is how the geometry engine drifted, and pricing is the one place where drift ships on an invoice.

/**
 * The item a base part becomes once a finish is chosen.
 *
 * @param basePart   the library doc for the mill/base item
 * @param finishCode the chosen finish code (P07, EP2, S05 …)
 * @param findByCode UPPERCASE ERP/item code → library doc
 * @returns the finished variant doc, or basePart when there is no variant to find
 */
export function finishVariantOf(basePart, finishCode, findByCode) {
    if (!basePart || !finishCode || typeof findByCode !== 'function') return basePart;
    const baseCode = String(
        (basePart.legacyErpId && basePart.legacyErpId !== 'PENDING' ? basePart.legacyErpId : basePart.itemId) || ''
    ).trim().toUpperCase();
    if (!baseCode || baseCode.includes('/')) return basePart;   // already a finished variant
    const fc = String(finishCode).trim().toUpperCase();
    const cands = [`${baseCode}/${fc}`];
    if (/^P\d/.test(fc)) cands.push(`${baseCode}/P`);           // the paint rollup
    if (/^EP\d/.test(fc)) cands.push(`${baseCode}/EP`);         // generic plated (fees)
    for (const cand of cands) { const hit = findByCode(cand); if (hit) return hit; }
    return basePart;
}
