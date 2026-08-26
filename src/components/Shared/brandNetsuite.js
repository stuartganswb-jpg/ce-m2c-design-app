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
