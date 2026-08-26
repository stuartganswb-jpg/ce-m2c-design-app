// SEARCH BY THE CUSTOMER'S NUMBER (Stuart 2026-08-26: "our clients are going to all be sending in
// orders with their items — to enter/research them this will help greatly").
//
// A part answers to every code a customer knows it by:
//   • clientPricing[].clientSku            — "Their SKU", set per customer in 4.6
//   • manufacturingSpecs.fabricut.fabCode* — the painted / premium / base pattern #s from the
//                                            Customer Alias & Pricing box
// ONE matcher, imported by every search field (Master Library, Mass Update, Stock View, the
// Sales Snapshot…) so HTS7504F finds H1-2TRV-4/P everywhere, not just on the screen that
// happened to be taught. Alias RECORDS (partClass Alias) already match by their own code in any
// list that includes them — this covers the codes that live ON the main record.

const FAB_CODE_KEYS = ['fabCodePainted', 'fabCodePremium', 'fabCodeBase'];

/** Every customer-facing code carried on this part record. */
export const customerCodesOf = (part) => {
    if (!part) return [];
    const out = [];
    const fab = part.manufacturingSpecs?.fabricut;
    if (fab) for (const k of FAB_CODE_KEYS) { if (fab[k]) out.push(String(fab[k])); }
    const rows = Array.isArray(part.clientPricing) ? part.clientPricing : [];
    for (const r of rows) { if (r && r.clientSku) out.push(String(r.clientSku)); }
    return out;
};

/** True when the search term hits any customer code on the part. Empty terms never match. */
export const matchesCustomerCode = (part, term) => {
    const t = String(term || '').trim().toLowerCase();
    if (!t) return false;
    return customerCodesOf(part).some(c => c.toLowerCase().includes(t));
};
