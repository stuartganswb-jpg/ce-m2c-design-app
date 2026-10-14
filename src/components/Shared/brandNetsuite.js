// THE brand → NetSuite subsidiary/location map — ONE copy (Stuart's brief §10 item 1,
// applied 2026-08-25). Six identical copies lived in RTG / ERP Push-Pull / 11.1 / Quick Ship /
// Admin / PickPack, and a missing `location` in one of them once broke Route A. This is now the
// only place the mapping exists; every consumer imports it.
export const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

// THE brand → NetSuite custom FORM + CLASS map, one copy (E3 / STATE #22, Stuart 2026-09-12:
// "option 1"). CE: quote = "CE - Quote" (299), sales order = 177, class 2 = Hardware (Eric
// 2026-08-11). A brand with no row here REFUSES to queue with a named error
// (Shared/nsHeader.nsTransactionHeader) — never a silent default form. When Eric sends the M2C /
// Uniquity / Leyla ids, they go here and nothing else changes.
export const BRAND_NETSUITE_FORMS = {
    'ce': { estimate: '299', salesorder: '177', class: '2' },
    // M2C (Stuart 2026-10-14): quote = "M2C - Quote" (187), sales order = "M2C - Sales Order Special Order Form W/Link"
    // (281) — the forms M2C's own NetSuite orders already use. Two classes: Hardware (2) and Lighting (3). The class
    // follows what the order sells (Shared/nsHeader.orderClassOf): Lighting when every classed product line is a
    // lighting item, otherwise Hardware.
    'm2c': { estimate: '187', salesorder: '281', class: '2', classByItem: { Hardware: '2', Lighting: '3' } },
};
