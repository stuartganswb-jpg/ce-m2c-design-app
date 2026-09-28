// SO60551's ROW 1 and Row 2 as CPQ saved them on 2026-09-16 (the Fabricut tabletop), with the library facts
// the route reads. Row 2 is the LIVE row, read off the job and the sales order on 2026-09-27: an 18" oak fascia
// stained S04 (2 ft billed), the track H1-2TRV at the fascia's 18" (the quote predates CPQ's 9/19 track deduction)
// stamped TCP by CPQ, two miter fees quoted EP4 and two H1-2TRV-WB brackets quoted EP4 (both before CPQ's 9/18 rules
// — "the ep4 is a mistake", Stuart), end plugs, two F-clip lines with no cut, carriers and a square nut.
// Library: H1-FRPF and H1-2TRVMTR are Fee records; H1-2TRV (the track) and H1-2TRVCLP (the F-clip) are Custom Poles;
// H1-2TRV-WB is a Kit flagged usesSubFinish with /B /C /EP4 records. 4.5: S04 → TCP (Traverse Champagne).
export const BRAND = 'ce';
export const SO_APP_ID = 'SO-APP-QUOTE-TEST';
export const SO_NS_ID = '777001';
export const JOB_ID = 'QUOTE-TEST';

const inv = (code, name, specs = {}, more = {}) => ({ id: `lib-${code}`, legacyErpId: code, itemId: code, itemName: name, brandId: BRAND, partClass: 'Inventory', netSuiteInternalId: String(100000 + code.length * 7 + code.charCodeAt(code.length - 1)), manufacturingSpecs: { isInHouse: true, ...specs }, ...more });

export const library = [
    // ROW 1 — a plated pole with two French returns bent into it, plated fittings beside it
    inv('H1-1R', '1" Round Rod', { productType: 'RODS', partHandling: 'Custom', material: 'STEEL', isInHouse: false, vendorName: 'Metals USA' }),
    inv('H1-FRPF', 'French Return', { productType: 'FEE' }, { partClass: 'Fee' }),
    inv('H1-1CP-V', 'Cap Finial'), inv('H1-1CP-V/EP4', 'Cap Finial Satin Gold', {}, { partClass: 'Assembly' }),
    inv('H1-1BR', '1" Bracket', { partHandling: 'Small Parts' }), inv('H1-1BR/EP4', '1" Bracket Satin Gold', { partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    // the standoff is tagged Unfinished (live, 2026-09-28) and there is no /EP4 record — it rides the returns
    inv('H1-1STDOFF', 'Standoff', { productType: 'Component', partHandling: 'Small Parts', customData: { unfinished: true } }, { partClass: 'Assembly' }),
    // Row 2 — a stained oak fascia with miters, the traverse track and F-clips cut from it, stock-colour brackets,
    // and the stocked hardware that rides along
    inv('H1-2RCTWR-O', '2" x 3/4" Rectangular Oak Rod', { productType: 'Pole', partHandling: 'Custom', material: 'Wood', isInHouse: false, vendorName: 'Oak Supply' }),
    inv('H1-2TRV', '1.5" Square Traverse Track', { productType: 'Pole', partHandling: 'Custom' }),
    inv('H1-2TRVCLP', 'F-Clip Hanger for 1.5" Square Traverse Track', { productType: 'Pole', partHandling: 'Custom' }),
    inv('H1-2TRVMTR', 'Miter Return 2" Rectangular Rod', { productType: 'FEE' }, { partClass: 'Fee' }),
    inv('H1-2TRV-WB', '2" Traverse Wall Bracket (3-5/8" P)', { productType: 'BRACKET', partHandling: 'Small Parts', usesSubFinish: true }, { partClass: 'Kit' }),
    inv('H1-2TRV-WB/C', '2" Traverse Wall Bracket (3-5/8" P) - Champagne', { productType: 'Bracket', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    inv('H1-2TRV-WB/EP4', '2" Traverse Wall Bracket (3-5/8" P) - Satin Gold', { productType: 'Bracket', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    inv('H1-2TRVPLUG', 'End Plug for 1.5" Square Traverse', { productType: 'Component', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    inv('H1-2TRVNUT', 'Square Nut for 1.5" Traverse Track', { productType: 'Component', partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    inv('HTSLNTCAR', 'Silent Carrier', { productType: 'Traverse', partHandling: 'Small Parts' }),
    // Base Back 1 — a clear acrylic rod cut to 12" (no finish: it wears nothing) and plated end caps
    inv('H1-2RCTACR', '2" x 3/4" Rectangular Acrylic Pole', { productType: 'POLE', partHandling: 'Custom', isInHouse: false, vendorName: 'ARLINEA INDUSTRIES CO.' }),
    inv('H1-2RCTAEC', 'Acrylic End Cap', { partHandling: 'Small Parts' }), inv('H1-2RCTAEC/EP1', 'Acrylic End Cap Satin Nickel', { partHandling: 'Small Parts' }, { partClass: 'Assembly' }),
    // the display's own base — not a row
    inv('H1-TTB1', 'WALNUT TABLE TOP BASE', { productType: 'SAMPLE CHIP', partHandling: 'Small Parts', material: 'Wood' }, { partClass: 'Assembly' }),
    // base front 4 — a bought 3/4" rod (NetSuite counts it in feet) and a painted finial the customer knows by
    // its own code
    inv('H1-75R', '3/4" Round Hollow Rod Stock', { productType: 'POLE', isInHouse: false, vendorName: 'Metals USA' }),
    inv('H1-75KF', '3/4" Knob Finial', { partHandling: 'Small Parts' }, { clientPricing: [{ customerId: 'CUST-FAB', clientSku: 'FAB-KF-75', price: 4 }] }),
    inv('H1-75KF/P', '3/4" Knob Finial — phosphated', { partHandling: 'Small Parts' }),
];

// NetSuite at location 17: free stock (quantityavailable) and each item's stock unit.
export const stock = {
    'H1-1R': { available: 900, unit: 'FOOT' },
    'H1-1CP-V/EP4': { available: 120, unit: 'EACH' },
    'H1-1BR/EP4': { available: 60, unit: 'EACH' },
    'H1-1STDOFF': { available: 300, unit: 'EACH' },
    'H1-2RCTACR': { available: 200, unit: 'FOOT' },
    'H1-2RCTAEC/EP1': { available: 60, unit: 'EACH' },
    'H1-TTB1': { available: 50, unit: 'EACH' },
    'H1-2RCTWR-O': { available: 400, unit: 'FOOT' },
    'H1-2TRV': { available: 400, unit: 'FOOT' },
    'H1-2TRVCLP': { available: 400, unit: 'FOOT' },
    'H1-2TRV-WB/EP4': { available: 0, unit: 'EACH' },
    'H1-2TRV-WB/C': { available: 200, unit: 'EACH' },
    'H1-2TRVPLUG': { available: 500, unit: 'EACH' },
    'H1-2TRVNUT': { available: 500, unit: 'EACH' },
    'HTSLNTCAR': { available: 5000, unit: 'EACH' },
    'H1-75R': { available: 430, unit: 'FOOT' },
    'H1-75KF/P': { available: 100, unit: 'EACH' },
};

const header = (row) => ({ isHeader: true, sidemark: row, name: `▶ Configuration — SM: ${row}` });
const L = (legacyErpId, qty, more = {}) => ({ legacyErpId, partId: legacyErpId, name: legacyErpId, qty, price: 1, total: qty, ...more });
export const breakdown = [
    header('ROW 1'),
    L('H1-1R/EP4', 50, { finishCode: 'EP4', cutLength: 18 }),
    L('H1-FRPF/EP4', 50, { finishCode: 'EP4' }),                       // French return L — a Fee, 9/16: no isFee flag
    L('H1-FRPF/EP4', 50, { finishCode: 'EP4' }),                       // French return R
    L('H1-1CP-V/EP4', 50, { finishCode: 'EP4' }),
    L('H1-1BR/EP4', 50, { finishCode: 'EP4' }),
    L('H1-1STDOFF', 50, { finishCode: 'EP4', hidden: true, partId: 'lib-H1-1STDOFF' }),   // standoffs: quoted EP4 on 9/16 (stale)
    L('H1-1STDOFF', 50, { finishCode: 'EP4', hidden: true, partId: 'lib-H1-1STDOFF' }),
    header('Row 2'),
    L('H1-2RCTWR-O', 50, { finishCode: 'S04', cutLength: 18, perFoot: true, feet: 2, partId: 'lib-H1-2RCTWR-O' }),   // stained oak fascia, mitered
    L('H1-2TRV', 50, { cutLength: 18, perFoot: true, feet: 2, subFinishCode: 'TCP', partId: 'lib-H1-2TRV' }),        // the track: TCP, the fascia's length
    L('H1-2TRVMTR', 50, { finishCode: 'EP4' }),                         // miter fee — EP4 is the pre-9/18 error
    L('H1-2TRVMTR', 50, { finishCode: 'EP4' }),
    L('H1-2TRV-WB/EP4', 50, { finishCode: 'EP4', partId: 'lib-H1-2TRV-WB' }),   // bracket — /C since 9/18
    L('H1-2TRV-WB/EP4', 50, { finishCode: 'EP4', partId: 'lib-H1-2TRV-WB' }),
    L('H1-2TRVPLUG', 50),
    L('H1-2TRVPLUG', 50),
    L('H1-2TRVCLP', 50),                                                // F-clips: no cut on the 9/16 quote
    L('H1-2TRVCLP', 50),
    L('HTSLNTCAR', 500),
    L('H1-2TRVNUT', 50),
    header('Base Back 1'),
    L('H1-2RCTACR', 50, { cutLength: 12, perFoot: true, feet: 1, partId: 'lib-H1-2RCTACR' }),   // clear acrylic: no finish
    L('H1-2RCTAEC/EP1', 50, { finishCode: 'EP1', partId: 'lib-H1-2RCTAEC' }),
    header('base front 4'),
    L('H1-75R/P', 50, { finishCode: 'P30', cutLength: 84 }),           // CPQ bills paint on the shared /P SKU
    L('H1-75KF/P', 50, { finishCode: 'P30' }),
    { isHeader: true, name: '▶ ADD-ONS' },
    L('H1-TTB1', 50, { partId: 'lib-H1-TTB1' }),                         // the tabletop base — the order's own line
];

// 4.5 — the finishes the route reads the sub finish from (live values, 2026-09-27).
export const finishes = [
    { code: 'S04', name: 'S04', subFinishCode: 'TCP', type: 'MIXED' },
    { code: 'P30', name: 'P30', subFinishCode: 'TCP', type: 'MIXED' },
    { code: 'P14', name: 'P14', subFinishCode: 'TBR', type: 'MIXED' },
    { code: 'TBR', name: 'TRAVERSE BRONZE', isSubFinish: true, type: 'TRAVERSE TRACK AND PARTS' },
    { code: 'TCP', name: 'TRAVERSE CHAMPAGNE', isSubFinish: true, type: 'TRAVERSE TRACK AND PARTS' },
    { code: 'EP4', name: 'SATIN GOLD', outsourced: true },
];

export const job = {
    id: JOB_ID,
    customer: { id: 'CUST-FAB', name: 'FABRICUT' },
    cpqData: { breakdown, cartItems: [{ assemblyName: 'Fabricut H1 Tabletop', generalNotes: 'Tabletop display', finishLabel: 'EP4 - Satin Gold' }] },
    // CPQ keeps ONE cart item's cut facts for the whole job (the first) — here ROW 1's, which has no miters.
    engineeringNotes: { shape: 'STRAIGHT', qtyMiters: 0, qtyBends: 0, qtySplices: 0, qtyMiterReturns: 0, svgString: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
};

export const salesOrder = (lines) => ({
    id: SO_APP_ID, soId: 'SO60551', brand: BRAND, customer: 'FABRICUT', customerId: 'CUST-FAB',
    nsInternalId: SO_NS_ID, hqJobId: JOB_ID, status: 'Dispatched', createdAt: 1, lines,
});
