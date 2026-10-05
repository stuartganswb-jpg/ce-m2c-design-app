// Harness for Shared/hardwarePricing.js — the precedence, stated once and checked.
//   node scripts/hardwarePricing.test.mjs
//
// Pricing ships on invoices, so the order it resolves in is asserted rather than described.

import { priceChoice, priceConfiguration, pricingWarnings, PRICE_SOURCES } from '../src/components/Shared/hardwarePricing.js';
import { takesFinish } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

const CUST = { id: 'CUST-1', name: 'Fabricut' };
// An item as the master library actually stores it: a base price, this customer's negotiated row
// carrying THEIR part number, and the 4.6 tier box.
const item = {
    id: 'I1', legacyErpId: 'H1-138R', itemName: 'Steel Rod',
    manufacturingSpecs: {
        basePrice: 10,
        fabricut: { cost: 4, wholesale: 7, retail: 14, fabCodeBase: 'FAB-1001' },
    },
    clientPricing: [{ customerId: 'CUST-1', price: 6, clientSku: 'THEIR-9001' }],
};
const noTier = { id: 'I2', legacyErpId: 'X', itemName: 'Plain', manufacturingSpecs: { basePrice: 3 }, clientPricing: [] };
const bare = { id: 'I3', legacyErpId: 'Y', itemName: 'Unpriced', manufacturingSpecs: {}, clientPricing: [] };

const ctx = (over = {}) => ({ customerId: CUST.id, customer: CUST, ...over });

// ── THE ORDER ─────────────────────────────────────────────────────────────────────────────────
{
    const base = priceChoice({}, item, { });                       // no customer, standard
    eq('with nothing else, the item base price', [base.price, base.source], [10, PRICE_SOURCES.BASE]);

    const client = priceChoice({}, item, ctx());
    eq("the customer's own price beats base", [client.price, client.source], [6, PRICE_SOURCES.CLIENT]);

    const cost = priceChoice({}, item, ctx({ priceLevel: 'FAB_COST' }));
    eq('cost level beats the customer row', [cost.price, cost.source], [4, PRICE_SOURCES.LEVEL]);
    eq('wholesale reads its own tier', priceChoice({}, item, ctx({ priceLevel: 'FAB_WHOLESALE' })).price, 7);
    eq('retail reads its own tier', priceChoice({}, item, ctx({ priceLevel: 'FAB_RETAIL' })).price, 14);

    const over = priceChoice({ price: 99 }, item, ctx({ priceLevel: 'FAB_RETAIL' }));
    eq('an authored override beats everything', [over.price, over.source], [99, PRICE_SOURCES.OVERRIDE]);
}

// ── THE FALLBACK Stuart named: "if this does not exist it falls back to base price on item" ────
{
    const lv = priceChoice({}, noTier, ctx({ priceLevel: 'FAB_RETAIL' }));
    eq('an item with no tier data keeps its own price at any level', [lv.price, lv.source], [3, PRICE_SOURCES.BASE]);
    const none = priceChoice({}, bare, ctx({ priceLevel: 'FAB_RETAIL' }));
    eq('an item with nothing anywhere prices at 0 and says so', [none.price, none.source], [0, PRICE_SOURCES.NONE]);
}

// ── THEIR PART NUMBER TRAVELS WITH THE PRICE ──────────────────────────────────────────────────
{
    eq('the customer SKU comes back with the price', priceChoice({}, item, ctx()).sku, 'THEIR-9001');
    eq('and still does at a price level', priceChoice({}, item, ctx({ priceLevel: 'FAB_COST' })).sku, 'THEIR-9001');
    eq('with no customer there is no SKU', priceChoice({}, item, {}).sku, '');
    eq('the pattern code resolves too', priceChoice({}, item, ctx()).aliasCode, 'FAB-1001');
}

// ── THE SPECIES FIRST (Stuart 2026-09-16: "the items on the bom should be H1-138WEC-O rather than
//    just H1-138WEC"). A stain tagged OAK / WALNUT consumes the per-species item; one product, one price.
{
    const cap = { id: 'W1', legacyErpId: 'H1-138WEC', itemName: 'White Oak End Cap', manufacturingSpecs: { basePrice: 20 }, clientPricing: [{ customerId: 'CUST-1', price: 15, clientSku: 'WEC-SKU' }] };
    const capO = { id: 'W1O', legacyErpId: 'H1-138WEC-O', itemName: 'White Oak End Cap — oak', manufacturingSpecs: {}, clientPricing: [] };          // no price of its own
    const capW = { id: 'W1W', legacyErpId: 'H1-138WEC-W', itemName: 'White Oak End Cap — walnut', manufacturingSpecs: { basePrice: 22 }, clientPricing: [] };
    const pole = { id: 'P0', legacyErpId: 'H1-138WR', itemName: '1-3/8" Wood Rod', manufacturingSpecs: { basePrice: 12.5, customData: { speciesMap: { '-O': 'H1-138WHTOAK', '-W': 'H1-138WLNUT' } } }, clientPricing: [] };
    const poleO = { id: 'PO', legacyErpId: 'H1-138WHTOAK', itemName: 'White Oak Rod', manufacturingSpecs: { basePrice: 12.5 }, clientPricing: [] };
    const bkt = { id: 'M1', legacyErpId: 'H1-138ILS', itemName: 'In Line Bracket', manufacturingSpecs: {}, clientPricing: [] };
    const bktEP = { id: 'M1E', legacyErpId: 'H1-138ILS/EP2', itemName: 'In Line Bracket EP2', manufacturingSpecs: { basePrice: 50 }, clientPricing: [] };
    const lib = Object.fromEntries([cap, capO, capW, pole, poleO, bkt, bktEP].map(p => [p.legacyErpId, p]));
    const findByCode = (c) => lib[String(c || '').toUpperCase()] || null;
    const finishes = { S04: { code: 'S04', bomSuffix: 'OAK' }, S12: { code: 'S12', bomSuffix: '-W' }, P14: { code: 'P14' }, EP2: { code: 'EP2' } };
    const fctx = (fc, over = {}) => ctx({ finishCode: fc, findByCode, finishObjOf: (c) => finishes[String(c || '').toUpperCase()] || null, ...over });

    const oak = priceChoice({}, cap, fctx('S04'));
    eq('S04 on a wood cap bills the -O item', oak.billedId, 'H1-138WEC-O');
    eq('…at the base product\'s price when the -O record has none (the customer row, SKU included)', [oak.price, oak.source, oak.sku], [15, PRICE_SOURCES.CLIENT, 'WEC-SKU']);
    ok('…and the detail says where the money came from', /priced from the base product H1-138WEC/.test(oak.detail), oak.detail);
    const wal = priceChoice({}, cap, fctx('S12'));
    eq('S12 bills the -W item at its own price when it has one', [wal.billedId, wal.price, wal.source], ['H1-138WEC-W', 22, PRICE_SOURCES.BASE]);
    eq('the wood pole resolves through its stem map', priceChoice({}, pole, fctx('S04')).billedId, 'H1-138WHTOAK');
    eq('a finish with no suffix is identity', priceChoice({}, cap, fctx('P14')).billedId, 'H1-138WEC');
    eq('a caller with no finish lookup gets exactly what it always got', priceChoice({}, cap, ctx({ finishCode: 'S04', findByCode })).billedId, 'H1-138WEC');
    eq('no finish at all is identity', priceChoice({}, cap, fctx('')).billedId, 'H1-138WEC');
    eq('the /EPn swap on a metal part is untouched', [priceChoice({}, bkt, fctx('EP2')).billedId, priceChoice({}, bkt, fctx('EP2')).price], ['H1-138ILS/EP2', 50]);
    const unpriced = priceChoice({}, { ...cap, manufacturingSpecs: {}, clientPricing: [] }, fctx('S04'));
    eq('a species item whose base has no price either still says NONE, on the species id', [unpriced.billedId, unpriced.source], ['H1-138WEC-O', PRICE_SOURCES.NONE]);
    // The whole-configuration walk carries the lookup through to every line.
    const model = { choices: [{ id: 'c1', partId: 'W1', role: 'END', qty: 1 }], selected: [{ id: 'c1', partId: 'W1', role: 'END', qty: 1 }], riders: [], companions: [], bom: [{ id: 'c1', partId: 'W1', name: 'cap', qty: 1, role: 'END' }] };
    const walk = priceConfiguration(model, { ...fctx('S04'), findPart: (id) => (id === 'W1' ? cap : null) });
    ok('priceConfiguration bills the species item on the line', (walk.lines || []).some(l => String(l.billedId || l.legacyErpId || '') === 'H1-138WEC-O'), JSON.stringify((walk.lines || []).map(l => [l.partId, l.billedId, l.legacyErpId])));
}

// ── A ROW KEYED BY NAME MATCHES, because rows were hand-entered both ways ─────────────────────
{
    const byName = { ...item, clientPricing: [{ customerId: 'Fabricut', price: 5, clientSku: 'N-1' }] };
    const r = priceChoice({}, byName, ctx());
    eq('a row keyed by customer NAME still matches', [r.price, r.sku], [5, 'N-1']);
}

// ── A ZERO / BLANK ROW IS NOT A PRICE ────────────────────────────────────────────────────────
{
    const zero = { ...item, manufacturingSpecs: { basePrice: 10 }, clientPricing: [{ customerId: 'CUST-1', price: 0 }] };
    eq('a 0 row means "no special price", not free', priceChoice({}, zero, ctx()).price, 10);
}

// ── A WHOLE CONFIGURATION, riders included ────────────────────────────────────────────────────
{
    const model = { bom: [
        { partId: 'H1-138R', name: 'Steel Rod', qty: 1 },
        { partId: 'CAR', name: 'Carrier', qty: 4 },
        { partId: 'GHOST', name: 'Unpriceable', qty: 1 },
    ] };
    const parts = { 'H1-138R': item, CAR: noTier };
    const { lines, total } = priceConfiguration(model, ctx({ findPart: (id) => parts[id] || null }));
    eq('quantities multiply', lines.find(l => l.partId === 'CAR').total, 12);
    eq('the total is the sum of the lines', total, 6 + 12 + 0);
    const warn = pricingWarnings({ lines });
    ok('an unpriceable line is called out rather than quoted silently at $0',
        warn.length === 1 && /Unpriceable/.test(warn[0].msg), JSON.stringify(warn));
}

// ── ROD STOCK IS SOLD BY THE FOOT ─────────────────────────────────────────────────────────────
// "it needs to take billed ft qty on step 6 and multiply it times price of selected rod in 10 and
//  11 if double." H1-138R is "Round Hollow Rod Stock" at 12.50 — a foot of it, not a pole of it.
{
    const part = (code, price) => ({ id: code, itemId: code, legacyErpId: code,
        manufacturingSpecs: { basePrice: String(price) } });
    const lib = { 'H1-138R': part('H1-138R', 12.5), 'H1-138KF': part('H1-138KF', 28) };
    const model = { bom: [
        { partId: 'H1-138R', name: 'front rod', role: 'ROD', qty: 1 },
        { partId: 'H1-138R', name: 'back rod', role: 'ROD', qty: 1 },
        { partId: 'H1-138KF', name: 'finial', role: 'FINIAL', qty: 2 },
    ] };
    const ctx = (feet) => ({ findPart: (id) => lib[id] || null, priceLevel: 'STANDARD', billedFeet: feet });

    const none = priceConfiguration(model, ctx(0));
    eq('with no length answered a rod bills once', none.lines[0].total, 12.5);

    const ten = priceConfiguration(model, { ...ctx(10), lengthInches: 119 });
    eq('ten feet of rod bills ten times', ten.lines[0].total, 125);
    eq('and so does the second rod of a double', ten.lines[1].total, 125);
    ok('the rod line says it is per foot', ten.lines[0].perFoot === true);
    eq('the finial is untouched — it does not grow with the pole', ten.lines[2].total, 56);
    ok('and is not marked per foot', !ten.lines[2].perFoot);
    eq('the total adds up', ten.total, 125 + 125 + 56);

    // ⚠ ONE POLE, NOT TEN. The footage is how it is PRICED, never how many there are — the router
    // must not read a ten-foot pole as ten poles.
    eq('the pole is one line item', ten.lines[0].qty, 1);
    eq('the feet ride alongside', ten.lines[0].feet, 10);
    eq('and the bench gets the cut', ten.lines[0].cutLength, 119);
    ok('the finial carries no cut length', ten.lines[2].cutLength === undefined);
    // …and with no length answered, nothing pretends to know one
    const unmeasured = priceConfiguration(model, ctx(0));
    ok('no cut length before a length is typed', unmeasured.lines[0].cutLength === undefined);
    eq('and the rod bills once', unmeasured.lines[0].qty, 1);
}

// ── A FINISH PER PART, NOT PER CONFIGURATION (Stuart 2026-08-21) ─────────────────────────────
// "in case people do choose different finishes for different parts." The render already painted
// per part; the PRICE read one code for the whole configuration, so brass rings on a black pole
// billed the black ring and told finishing black.
{
    const p = (code, price) => ({ id: code, itemId: code, legacyErpId: code, itemName: code,
        manufacturingSpecs: { basePrice: String(price) } });
    const lib = {
        'ROD': p('ROD', 10), 'ROD/P': p('ROD/P', 14),
        'RING': p('RING', 2), 'RING/P': p('RING/P', 3),
    };
    const find = (c) => lib[String(c).toUpperCase()] || null;
    const model = { bom: [
        { partId: 'ROD', name: 'Rod', qty: 1, raw: { __choice: { id: 'c-rod', partId: 'ROD' } } },
        { partId: 'RING', name: 'Ring', qty: 10, raw: { __choice: { id: 'c-ring', partId: 'RING' } } },
    ] };
    const base = { findPart: find, findByCode: find };

    // one finish for everything — both lines bill the painted variant, as they always have
    const whole = priceConfiguration(model, { ...base, finishCode: 'P20' });
    eq('the configuration finish bills the variant', whole.lines.map(l => l.billedId), ['ROD/P', 'RING/P']);
    eq('…and the finish is ON the line now', whole.lines.map(l => l.finishCode), ['P20', 'P20']);

    // an exception on the rings only — the rings go brass, the rod stays where it was
    const split = priceConfiguration(model, { ...base, finishCode: 'P20',
        finishFor: (choice) => (choice.id === 'c-ring' ? 'P07' : 'P20') });
    eq('an exception prices off ITS finish', split.lines.map(l => l.finishCode), ['P20', 'P07']);
    ok('and the untouched line is unmoved', split.lines[0].unit === whole.lines[0].unit);

    // a part that wears nothing carries nothing, and bills the mill item
    const clear = priceConfiguration(model, { ...base, finishCode: 'P20', finishFor: () => '' });
    eq('no finish means the mill item', clear.lines.map(l => l.billedId), ['ROD', 'RING']);
    eq('and the line says it has none', clear.lines.map(l => l.finishCode), ['', '']);
}

// ── THE FLOW'S FALLBACK IS A LAST RESORT, AND IT SAYS SO ─────────────────────────────────────
// Stuart 2026-08-21: "an area to apply a default back up price per step". A collection mid-set-up
// has items nobody has priced, and a $0 line goes out under cost without objecting. A rough number
// that announces itself beats a silent zero — but it must never overrule a real price.
{
    const fb = { BRACKET: 25, RING: 2 };
    const unpriced = { id: 'U', itemId: 'H1-UNPRICED', legacyErpId: 'H1-UNPRICED', itemName: 'Unpriced', manufacturingSpecs: {}, clientPricing: [] };

    const hit = priceChoice({ role: 'BRACKET' }, unpriced, { fallbackPrices: fb });
    eq('an unpriced part takes its kind default', [hit.price, hit.source], [25, PRICE_SOURCES.FALLBACK]);
    ok('and the line says where the number came from', /bracket default on this flow/.test(hit.detail));

    const noKind = priceChoice({ role: 'FINIAL' }, unpriced, { fallbackPrices: fb });
    eq('a kind with no default still quotes nothing', [noKind.price, noKind.source], [0, PRICE_SOURCES.NONE]);

    const untyped = priceChoice({}, unpriced, { fallbackPrices: fb });
    eq('and a line with no role cannot match one', untyped.source, PRICE_SOURCES.NONE);

    // ⚠ IT NEVER OVERRULES A REAL PRICE — that is the whole safety of it.
    const real = priceChoice({ role: 'BRACKET' }, { ...unpriced, manufacturingSpecs: { basePrice: 9 } }, { fallbackPrices: fb });
    eq('an item with a base price is untouched', [real.price, real.source], [9, PRICE_SOURCES.BASE]);
    const over = priceChoice({ role: 'BRACKET', price: 4 }, unpriced, { fallbackPrices: fb });
    eq('and a pin override still wins outright', [over.price, over.source], [4, PRICE_SOURCES.OVERRIDE]);

    // …and it is called out, because a placeholder reached a customer.
    const warn = pricingWarnings({ lines: [{ name: 'Bracket', billedId: 'H1-UNPRICED', unit: 25, source: PRICE_SOURCES.FALLBACK, detail: 'bracket default on this flow — H1-UNPRICED has no price of its own' }] });
    eq('a fallback line warns, in amber not red', warn.map(w => w.sev), ['amber']);
    ok('and it says how to make it real', /price the item in 4\.6/.test(warn[0].msg));
}

// ── THE PER-LINE FINISH GATE IS ASKED WITH A BOM ROW, NOT A CHOICE ───────────────────────────
// 2026-08-21, prod down: "we created a bug in the engine when finishes are selected". The caller's
// finishFor() applies the MATERIAL gate, and it was handed the BOM row — which carried no
// materials — so the gate read `undefined.some` and the configurator died the moment a finish was
// picked. The row carries what a finish is judged on now, and the gate tolerates a row that does
// not. Both are asserted, because either one alone would have prevented the outage.
{
    const p = (code, price) => ({ id: code, itemId: code, legacyErpId: code, itemName: code,
        manufacturingSpecs: { basePrice: String(price) } });
    const lib = { 'ROD': p('ROD', 10) };
    const find = (c) => lib[String(c).toUpperCase()] || null;
    const model = { bom: [{ partId: 'ROD', name: 'Rod', qty: 1, role: 'ROD', materials: ['METAL'], id: 'c-rod' }] };

    // The real shape: finishFor gets the row and applies the gate to it, exactly as the
    // configurator does. This threw before the fix.
    let seen = null;
    const priced = priceConfiguration(model, {
        findPart: find, findByCode: find, finishCode: 'P20',
        finishFor: (choice) => { seen = choice; return takesFinish(choice, { code: 'P20' }) ? 'P20' : ''; },
    });
    ok('the row can answer what it is made of', Array.isArray(seen?.materials));
    ok('…and carries its id, so a per-part exception can match it', !!seen?.id);
    eq('the line is finished', priced.lines[0].finishCode, 'P20');

    // …and a row with nothing on it is read as metal rather than throwing.
    ok('a bare object does not take the engine down', takesFinish({ partId: 'X' }, { code: 'P20' }) === true);
    ok('a clear part still wears nothing', takesFinish({ noFinish: true, materials: ['CLEAR (NO FINISH)'] }, { code: 'P20' }) === false);
}

// ── A DEFAULTED LEVEL MUST NOT OUTRANK THE CUSTOMER'S OWN ROW ────────────────────────────────
// Eric via Stuart, 2026-08-21: "For Brimar, the French Return pricing is coming in at $35, which is
// the Fabricut painted standard price, and not the $45 defined for the Brimar fee." Selecting a
// customer defaults the level to FAB_COST, and the tier box belongs to the ITEM — it is Fabricut's
// data. Applied to Brimar it priced their return off somebody else's sheet, beating the Brimar row
// sitting right there. The line even printed their SKU from the row whose price it had skipped.
{
    const shared = {
        id: 'FR', legacyErpId: 'H1-FRPF', itemName: 'FRENCH RETURN',
        manufacturingSpecs: { basePrice: 30, fabricut: { cost: 35, wholesale: 60, retail: 90 } },
        clientPricing: [{ customerId: 'BRIMAR', price: 45, clientSku: 'DFR01' }],
    };
    const brimar = { id: 'BRIMAR', name: 'Brimar' };
    const at = (over) => priceChoice({}, shared, { customerId: 'BRIMAR', customer: brimar, ...over });

    const defaulted = at({ priceLevel: 'FAB_COST', levelIsDefault: true });
    eq("a defaulted level yields to Brimar's own row", [defaulted.price, defaulted.source], [45, PRICE_SOURCES.CLIENT]);
    ok('and their SKU still prints', defaulted.sku === 'DFR01');

    const chosen = at({ priceLevel: 'FAB_COST', levelIsDefault: false });
    eq('a CHOSEN level still means it', [chosen.price, chosen.source], [35, PRICE_SOURCES.LEVEL]);

    // …and the reason the default exists is untouched: an item with no row still gets the tier
    // price rather than falling to $0.
    const noRow = { ...shared, clientPricing: [] };
    const still = priceChoice({}, noRow, { customerId: 'BRIMAR', customer: brimar, priceLevel: 'FAB_COST', levelIsDefault: true });
    eq('an item with no row still takes the defaulted level', [still.price, still.source], [35, PRICE_SOURCES.LEVEL]);
    ok('and the line says the level was defaulted', /defaulted/.test(still.detail));
}


// ── A STOCK COLOUR IS SOLD AS ITS OWN ITEM (Stuart 2026-09-18, SO60551 row 2) ─────────────────────
{
    const { stockColourVariantOf } = await import('../src/components/Shared/finishVariant.js');
    const lib = {
        'H1-2TRV-WB':   { id: 'ASM-WB',   legacyErpId: 'H1-2TRV-WB',   manufacturingSpecs: { usesSubFinish: true, basePrice: 75 }, clientPricing: [] },
        'H1-2TRV-WB/C': { id: 'ASM-WB-C', legacyErpId: 'H1-2TRV-WB/C', manufacturingSpecs: { isStocked: true }, clientPricing: [] },
        'H1-2TRV-WB/B': { id: 'ASM-WB-B', legacyErpId: 'H1-2TRV-WB/B', manufacturingSpecs: { isStocked: true }, clientPricing: [] },
        'H1-2TRV':      { id: 'INV-TRK',  legacyErpId: 'H1-2TRV',      manufacturingSpecs: { basePrice: 9 }, clientPricing: [] },
    };
    const find = (k) => lib[String(k || '').toUpperCase()] || Object.values(lib).find(p => p.id === k) || null;
    eq('TCP is stocked as /C', stockColourVariantOf(lib['H1-2TRV-WB'], 'TCP', find)?.legacyErpId, 'H1-2TRV-WB/C');
    eq('TBR is stocked as /B', stockColourVariantOf(lib['H1-2TRV-WB'], 'tbr', find)?.legacyErpId, 'H1-2TRV-WB/B');
    eq('an exact <base>/<code> item would win', stockColourVariantOf({ legacyErpId: 'X' }, 'TCP', (c) => (c === 'X/TCP' ? { legacyErpId: 'X/TCP' } : c === 'X/C' ? { legacyErpId: 'X/C' } : null))?.legacyErpId, 'X/TCP');
    eq('no stocked variant → null (the line stays label-only)', stockColourVariantOf(lib['H1-2TRV'], 'TCP', find), null);
    eq('a variant is never re-swapped', stockColourVariantOf(lib['H1-2TRV-WB/C'], 'TBR', find), null);
    eq('no code → null', stockColourVariantOf(lib['H1-2TRV-WB'], '', find), null);

    const p = priceChoice({ role: 'BRACKET' }, lib['H1-2TRV-WB'], { findByCode: find, subFinishCode: 'TCP' });
    eq('the billed item is the stock colour', p.billedId, 'H1-2TRV-WB/C');
    eq('…and the record that is pulled', p.soldPartId, 'ASM-WB-C');
    eq('priced from the base product, the placeholder that carries the price', [p.price, /priced from the base product H1-2TRV-WB/.test(p.detail)], [75, true]);
    const withFinish = priceChoice({ role: 'BRACKET' }, lib['H1-2TRV-WB'], { findByCode: find, finishCode: 'EP4', subFinishCode: 'TCP' });
    eq('a finish picked for the part outranks the stock colour', withFinish.soldPartId, undefined);

    const cfg = priceConfiguration({ bom: [{ partId: 'H1-2TRV-WB', name: 'bracket', role: 'BRACKET', qty: 2 }, { partId: 'H1-2TRV', name: 'track', role: 'TRACK', qty: 1 }] },
        { findPart: find, findByCode: find, finishFor: () => '', subFinishFor: () => 'TCP' });
    eq('the line carries the colour and the sold record', [cfg.lines[0].subFinishCode, cfg.lines[0].billedId, cfg.lines[0].soldPartId, cfg.lines[0].finishCode], ['TCP', 'H1-2TRV-WB/C', 'ASM-WB-C', '']);
    eq('a track with no stocked colour item keeps its base and its label', [cfg.lines[1].subFinishCode, cfg.lines[1].billedId, cfg.lines[1].soldPartId], ['TCP', 'H1-2TRV', undefined]);
    const plain = priceConfiguration({ bom: [{ partId: 'H1-2TRV-WB', name: 'bracket', role: 'BRACKET', qty: 1 }] }, { findPart: find, findByCode: find, finishFor: () => '' });
    eq('no subFinishFor → exactly as before', [plain.lines[0].billedId, plain.lines[0].subFinishCode], ['H1-2TRV-WB', undefined]);
}


// ── AN ITEM KIT: ONE THING SOLD, SEVERAL THINGS MADE (Stuart 2026-09-18 — H1-2RCTCB as it is in the library) ──
{
    const { isItemKit } = await import('../src/components/Shared/hardwarePricing.js');
    const { isDisplayOnlyLine } = await import('../src/components/Shared/lineClassification.js');
    const lib = {
        'KIT-H1-2RCTCB-866911': { id: 'KIT-H1-2RCTCB-866911', legacyErpId: 'H1-2RCTCB', itemName: '2" Cuff Bracket (3-5/8" P)', partClass: 'Kit',
            clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H3622F', price: 61 }],
            manufacturingSpecs: { kitComponents: [{ partId: 'CE-INV-59101', qty: 1 }, { partId: 'CE-ASM-64805', qty: 1 }] } },
        'CE-INV-59101': { id: 'CE-INV-59101', legacyErpId: 'H1-2RCTJC', itemName: 'Center Bracket Cuff', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'H1-2RCTJC/P': { id: 'CE-ASM-59113', legacyErpId: 'H1-2RCTJC/P', itemName: 'Center Bracket Cuff - Paint', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'CE-ASM-64805': { id: 'CE-ASM-64805', legacyErpId: 'H1-2RCTBA', itemName: 'Bracket Arm', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'H1-2RCTBA/P': { id: 'CE-ASM-64806', legacyErpId: 'H1-2RCTBA/P', itemName: 'Bracket Arm - Paint', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'TRV-KIT': { id: 'TRV-KIT', legacyErpId: 'H1-2TRV-4M/P', partClass: 'Kit', manufacturingSpecs: { kitAlign: { setup: 'SINGLE' }, kitComponents: [{ partId: 'CE-INV-59101', qty: 1 }] } },
    };
    const find = (k) => lib[String(k || '').toUpperCase()] || lib[k] || null;
    ok('a kit that lists components is an item kit', isItemKit(lib['KIT-H1-2RCTCB-866911']));
    ok('a TRAVERSE SYSTEM kit is not — it keeps its own path', !isItemKit(lib['TRV-KIT']));
    ok('an ordinary part is not', !isItemKit(lib['CE-INV-59101']));

    const cfg = priceConfiguration({ bom: [{ id: 'BK-C', partId: 'KIT-H1-2RCTCB-866911', name: 'cuff bracket', role: 'BRACKET', position: 'CENTER', qty: 3 }] },
        { findPart: find, findByCode: find, customerId: 'CUST-4720', finishFor: () => 'P06' });
    const [kit, cuff, arm] = cfg.lines;
    eq('three lines: the kit, then its two parts', cfg.lines.length, 3);
    eq('the kit line carries the money and their number', [kit.billedId, kit.unit, kit.total, kit.sku, kit.isKit, kit.itemKit, !!kit.hidden], ['H1-2RCTCB', 61, 183, 'H3622F', true, true, false]);
    eq('the cuff rides beneath at $0, hidden, paid by the kit, in the kit\'s finish, as its PAINTED item', [cuff.billedId, cuff.total, cuff.hidden, cuff.inKit, cuff.finishCode, cuff.kitOf], ['H1-2RCTJC/P', 0, true, true, 'P06', 'H1-2RCTCB']);
    eq('…and the arm the same', [arm.billedId, arm.total, arm.inKit], ['H1-2RCTBA/P', 0, true]);
    eq('three brackets are three cuffs and three arms', [cuff.qty, arm.qty], [3, 3]);
    eq('the configuration totals the kit alone', cfg.total, 183);
    ok('the floor never works the HOLDER', isDisplayOnlyLine({ ...kit, price: 61, legacyErpId: 'H1-2RCTCB' }));
    ok('…and always works the parts', !isDisplayOnlyLine({ ...cuff, legacyErpId: 'H1-2RCTJC/P' }));

    const broken = priceConfiguration({ bom: [{ partId: 'KIT-H1-2RCTCB-866911', name: 'k', role: 'BRACKET', qty: 1 }] },
        { findPart: (k) => (k === 'CE-ASM-64805' ? null : find(k)), findByCode: find, finishFor: () => '' });
    eq('a component the library cannot find is named on the kit', broken.lines[0].kitMissing, ['CE-ASM-64805']);
    ok('…and it is LOUD', pricingWarnings(broken).some(w => w.sev === 'red' && /CE-ASM-64805/.test(w.msg)));
    const plain = priceConfiguration({ bom: [{ partId: 'CE-INV-59101', name: 'cuff', role: 'BRACKET', qty: 2 }] }, { findPart: find, findByCode: find, finishFor: () => '' });
    eq('an ordinary part is exactly one line, as before', [plain.lines.length, plain.lines[0].isKit], [1, undefined]);

    // A STOCK-COLOUR KIT'S PARTS WEAR ITS COLOUR (Stuart 2026-09-28, SO60551's H1-2TRV-WB/C): the kit's TCP was dropped,
    // so the backplate, lower arm and arm billed and pushed RAW. Each part now takes the kit's sub finish → its /C item.
    const trv = {
        'KIT-WB': { id: 'KIT-WB', legacyErpId: 'H1-2TRV-WB', itemName: '2" Traverse Wall Bracket', partClass: 'Kit',
            manufacturingSpecs: { kitComponents: [{ partId: 'BP', qty: 1 }, { partId: 'LA', qty: 1 }, { partId: 'BA', qty: 1 }] } },
        BP: { id: 'BP', legacyErpId: 'H1-2TRVBP', itemName: 'Backplate', manufacturingSpecs: {} },
        LA: { id: 'LA', legacyErpId: 'H1-2TRVLA', itemName: 'Lower Arm', manufacturingSpecs: {} },
        BA: { id: 'BA', legacyErpId: 'H1-2TRVBA', itemName: 'Bracket Arm', manufacturingSpecs: {} },
        'H1-2TRVBP/C': { id: 'BPC', legacyErpId: 'H1-2TRVBP/C', manufacturingSpecs: {} },
        'H1-2TRVLA/C': { id: 'LAC', legacyErpId: 'H1-2TRVLA/C', manufacturingSpecs: {} },
        'H1-2TRVBA/C': { id: 'BAC', legacyErpId: 'H1-2TRVBA/C', manufacturingSpecs: {} },
    };
    const tfind = (k) => trv[String(k || '').toUpperCase()] || trv[k] || null;
    const wb = priceConfiguration({ bom: [{ id: 'WB', partId: 'KIT-WB', name: 'wall bracket', role: 'BRACKET', qty: 2 }] },
        { findPart: tfind, findByCode: tfind, finishFor: () => '', subFinishFor: () => 'TCP' });
    eq('a /C wall-bracket kit: the kit line, then BP / LA / BA each as its /C item in TCP', wb.lines.map(l => [l.billedId, l.finishCode || '', l.subFinishCode || '', !!l.inKit, l.qty]),
        [['H1-2TRV-WB', '', 'TCP', false, 2], ['H1-2TRVBP/C', '', 'TCP', true, 2], ['H1-2TRVLA/C', '', 'TCP', true, 2], ['H1-2TRVBA/C', '', 'TCP', true, 2]]);
}

// ── A TWO-PART FINIAL IS PRICED BY ITS COLLAR'S FINISH (Stuart 2026-09-19, the wood gem) ────────
// The record as it is live: both tiers on H1-138WGF, a customer row seeded from the painted tier, and
// a wood top whose own finish is a stain. The collar is what gets plated, so the collar picks the tier.
{
    const gem = { id: 'G', legacyErpId: 'H1-138WGF', itemName: 'Wood Gem Finial with Collar',
        manufacturingSpecs: { fabricut: { fabCodePainted: 'H1551F', fabCodePremium: 'H1551F PREMIUM', paintedCost: 47, paintedWholesale: 94, paintedRetail: 188, platedCost: 55, platedWholesale: 100, platedRetail: 200 } },
        clientPricing: [{ customerId: 'CUST-1', price: 47, clientSku: 'H1551F' }] };
    const collarPart = { id: 'C', legacyErpId: 'H1-138WFCON2', itemName: 'Collar', manufacturingSpecs: {}, clientPricing: [] };
    const parts = { G: gem, C: collarPart };
    const top = { id: 'top', partId: 'G', name: 'gem', role: 'FINIAL', position: 'LEFT', requiresCollar: 'C', materials: 'WOOD' };
    const col = { id: 'col', partId: 'C', name: 'collar', role: 'FINIAL', position: 'LEFT', isCollar: true, materials: 'METAL' };
    const model = { choices: [top, col], bom: [{ ...top, qty: 1 }, { ...col, qty: 1 }] };
    const run = (collarFinish, over = {}) => priceConfiguration(model, ctx({ priceLevel: 'FAB_COST', levelIsDefault: true,
        findPart: (id) => parts[id] || null, findByCode: () => null,
        finishFor: (c) => (c.id === 'col' ? collarFinish : 'S03'), ...over })).lines[0];
    const painted = run('P26');
    eq('a painted collar: the customer row, their painted number', [painted.unit, painted.sku, painted.source], [47, 'H1551F', PRICE_SOURCES.CLIENT]);
    const plated = run('EP2');
    eq('a plated collar: the plated tier and their PREMIUM number', [plated.unit, plated.sku, plated.source], [55, 'H1551F PREMIUM', PRICE_SOURCES.LEVEL]);
    eq('…at a CHOSEN level too', run('EP2', { priceLevel: 'FAB_WHOLESALE', levelIsDefault: false }).unit, 100);
    eq('the finial line still wears its own stain', plated.finishCode, 'S03');
    // A part with no collar never sees the rule: a plated finish on its own line keeps the row.
    const solo = priceConfiguration({ choices: [{ ...top, requiresCollar: '' }], bom: [{ ...top, requiresCollar: '', qty: 1 }] },
        ctx({ priceLevel: 'FAB_COST', levelIsDefault: true, findPart: (id) => parts[id] || null, findByCode: () => null, finishFor: () => 'EP2' })).lines[0];
    eq('no collar, no rule — the customer row stands as before', [solo.unit, solo.source], [47, PRICE_SOURCES.CLIENT]);
}

// ── A FINIAL KIT BRINGS ITS OWN COLLAR, IN THE COLLAR'S FINISH (Stuart 2026-10-01 — H1-138 as it is in the library:
//    the finial pin retagged to the Fabricut kit, the collar pin left as it was) ─────────────────────────────────────
{
    const { normalizeChoice } = await import('../src/components/Shared/hardwareModel.js');
    const lib = {
        'CE-INV-3597': { id: 'CE-INV-3597', legacyErpId: 'H1-138AKF', itemName: 'Acrylic Knob Finial', partClass: 'Kit',
            clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H1552F', price: 45 }],
            manufacturingSpecs: { kitComponents: [{ partId: 'CE-INV-60132', qty: 1 }, { partId: 'CE-INV-55962', qty: 1 }] } },
        'CE-INV-4484': { id: 'CE-INV-4484', legacyErpId: 'H1-138WCGF', itemName: 'Wood Gem Finial', partClass: 'Kit',
            clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H1551F', price: 47 }],
            manufacturingSpecs: { kitComponents: [{ partId: 'CE-ASM-60131', qty: 1 }, { partId: 'CE-ASM-65309', qty: 1 }] } },
        'CE-INV-60132': { id: 'CE-INV-60132', legacyErpId: 'H1-138FC2', itemName: 'Collar for 1-3/8" Acrylic Finial', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'H1-138FC2/P': { id: 'CE-ASM-70001', legacyErpId: 'H1-138FC2/P', itemName: 'Collar - Paint', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'H1-138FC2/EP5': { id: 'CE-ASM-70002', legacyErpId: 'H1-138FC2/EP5', itemName: 'Collar - EP5', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'CE-INV-55962': { id: 'CE-INV-55962', legacyErpId: 'H1-138ACKF', itemName: 'Acrylic Knob Finial', partClass: 'Inventory', manufacturingSpecs: {}, clientPricing: [] },
        'CE-ASM-60131': { id: 'CE-ASM-60131', legacyErpId: 'H1-138WFCON2', itemName: 'Collar for 1-3/8" Wood Gem Finial', partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [] },
        'CE-ASM-65309': { id: 'CE-ASM-65309', legacyErpId: 'H1-138WGF', itemName: 'Wood Gem Finial', partClass: 'Inventory', manufacturingSpecs: {}, clientPricing: [] },
        'CE-INV-20188': { id: 'CE-INV-20188', legacyErpId: 'H1-138ACBF', itemName: 'Acrylic Ball Finial', partClass: 'Inventory', manufacturingSpecs: {}, clientPricing: [] },
    };
    Object.values({ ...lib }).forEach(pt => { lib[pt.legacyErpId] = pt; });
    const find = (k) => lib[String(k || '').toUpperCase()] || lib[k] || null;
    // The pins, as 1.6 has them: the finial names the kit and the collar it requires; the collar is its own pin.
    const pin = (x) => normalizeChoice({ nodes: ['n' + x.id], position: 'LEFT', tier: 'FRONT', ...x });
    const AKF = pin({ id: 'FIN-A', partId: 'CE-INV-3597', role: 'FINIAL', materials: 'CLEAR (NO FINISH)', requiresCollar: 'H1-138FC2' });
    const COL = pin({ id: 'COL-A', partId: 'CE-INV-60132', name: 'H1-138FC2', role: 'FINIAL', isCollar: true, materials: 'METAL' });
    const WCGF = pin({ id: 'FIN-W', partId: 'CE-INV-4484', role: 'FINIAL', materials: 'WOOD', requiresCollar: 'H1-138WFCON2' });
    const COLW = pin({ id: 'COL-W', partId: 'CE-ASM-60131', name: 'H1-138WFCON2', role: 'FINIAL', isCollar: true, materials: 'WOOD' });
    const LOOSE = pin({ id: 'FIN-L', partId: 'CE-INV-20188', role: 'FINIAL', position: 'RIGHT', materials: 'CLEAR (NO FINISH)', requiresCollar: 'H1-138FC2' });
    // The configurator's finish rule: one finish per material (metal P14, wood S11), nothing on clear.
    const byMaterial = (over = {}) => (c) => over[c.id] || (c.noFinish ? '' : (c.materials || []).includes('WOOD') ? 'S11' : 'P14');
    const ctx = (over) => ({ findPart: find, findByCode: find, customerId: 'CUST-4720', finishCode: 'P14', finishFor: byMaterial(over) });
    const row = (l) => [l.billedId, l.finishCode, !!l.noFinish, l.total, !!l.inKit];

    let cfg = priceConfiguration({ choices: [AKF, COL], bom: [AKF, COL] }, ctx());
    eq('acrylic knob kit: the kit, its collar, its top — and NO second collar line', cfg.lines.map(l => l.billedId), ['H1-138AKF', 'H1-138FC2/P', 'H1-138ACKF']);
    eq('the kit carries the money and Fabricut\'s number', [cfg.lines[0].unit, cfg.lines[0].sku, cfg.lines[0].isKit, cfg.total], [45, 'H1552F', true, 45]);
    eq('the steel collar wears the METAL finish, as its painted item — not the clear kit line\'s nothing', row(cfg.lines[1]), ['H1-138FC2/P', 'P14', false, 0, true]);
    eq('the acrylic top stays clear', row(cfg.lines[2]), ['H1-138ACKF', '', true, 0, true]);

    cfg = priceConfiguration({ choices: [AKF, COL], bom: [AKF, COL] }, ctx({ 'COL-A': 'EP5' }));
    eq('a finish chosen ON the collar wins', row(cfg.lines[1]), ['H1-138FC2/EP5', 'EP5', false, 0, true]);

    cfg = priceConfiguration({ choices: [AKF, COL], bom: [AKF, COL] }, { ...ctx(), finishFor: (c) => (c.id === 'COL-A' ? '' : byMaterial()(c)) });
    eq('no metal finish chosen yet: the collar is mill, and says so', row(cfg.lines[1]), ['H1-138FC2', '', true, 0, true]);

    cfg = priceConfiguration({ choices: [WCGF, COLW], bom: [WCGF, COLW] }, ctx());
    eq('wood gem kit: collar and top both in the stain, one collar', cfg.lines.map(l => [l.billedId, l.finishCode]), [['H1-138WCGF', 'S11'], ['H1-138WFCON2', 'S11'], ['H1-138WGF', 'S11']]);
    eq('…at Fabricut\'s $47', [cfg.lines[0].unit, cfg.lines[0].sku, cfg.total], [47, 'H1551F', 47]);

    cfg = priceConfiguration({ choices: [LOOSE, { ...COL, position: 'RIGHT', id: 'COL-R' }], bom: [LOOSE, { ...COL, position: 'RIGHT', id: 'COL-R' }] }, ctx());
    eq('a LOOSE finial (not a kit) keeps its own collar line, exactly as before', cfg.lines.map(l => [l.billedId, l.finishCode, !!l.inKit]), [['H1-138ACBF', '', false], ['H1-138FC2/P', 'P14', false]]);

    const shared = { ...COL, position: '' };   // one collar pin answering both ends
    cfg = priceConfiguration({ choices: [AKF, LOOSE, shared], bom: [AKF, LOOSE, shared] }, ctx());
    eq('a collar pin a loose finial ALSO asks for keeps its line; the kit still brings its own', cfg.lines.map(l => l.billedId), ['H1-138AKF', 'H1-138FC2/P', 'H1-138ACKF', 'H1-138ACBF', 'H1-138FC2/P']);

    const noReq = pin({ id: 'FIN-N', partId: 'CE-INV-4484', role: 'FINIAL', materials: 'WOOD' });
    cfg = priceConfiguration({ choices: [noReq, COLW], bom: [noReq] }, ctx());
    eq('a kit pin that names no collar: its parts wear the kit\'s finish, as before', cfg.lines.map(l => [l.billedId, l.finishCode]), [['H1-138WCGF', 'S11'], ['H1-138WFCON2', 'S11'], ['H1-138WGF', 'S11']]);

    const other = { ...lib['CE-INV-3597'], manufacturingSpecs: { kitComponents: [{ partId: 'CE-INV-55962', qty: 1 }] } };   // a kit that does NOT list the collar
    cfg = priceConfiguration({ choices: [AKF, COL], bom: [AKF, COL] }, { ...ctx(), findPart: (k) => (String(k) === 'CE-INV-3597' ? other : find(k)) });
    eq('a kit whose parts list does not name the collar leaves the collar line alone', cfg.lines.map(l => [l.billedId, !!l.inKit]), [['H1-138AKF', false], ['H1-138ACKF', true], ['H1-138FC2/P', false]]);
}

// ── THE NUMBER FOLLOWS HOW IT WAS ORDERED (Stuart 2026-10-04, Shared/altPattern) ──────────────────────────────────
// "we need to be able to enter both depending on what they order it must be clear on the customer forms and to the
//  floor" · "we have to sell these as each … in the configurator we select left, center, right" · "just be sure we do
//  not break anything on the actual multi part kit brackets … like this bracket H1-138ILJL".
// The 1-3/8" traverse arm is H3629F with the horizontal backplate, H3626F with the vertical; the 2" traverse return
// arm is H3634F at the left, H3635F at the right. Records as the library carried them that day.
{
    const INCL = { cost: null, wholesale: null, retail: null, paintedCost: null, paintedWholesale: null, paintedRetail: null, platedCost: null, platedWholesale: null, platedRetail: null };
    const rec = (id, code, extra = {}) => ({ id, legacyErpId: code, itemName: code, partClass: 'Assembly', manufacturingSpecs: {}, clientPricing: [], ...extra });
    const armBox = { paintedCost: 32, paintedWholesale: 64, paintedRetail: 128, platedCost: 42, platedWholesale: 77, platedRetail: 154, fabCodePainted: 'H3629F', fabCodePremium: 'H3629F PREMIUM' };
    const ALT = [{ plate: 'H1-138TRVBP-V', position: '', painted: 'H3626F', premium: 'H3626F PREMIUM' }];
    const mk = (armAlt, extra = []) => {
        const list = [
            rec('CE-INV-62502', 'H1-138TRVEBA', { manufacturingSpecs: { fabricut: { ...armBox, ...(armAlt ? { altCodes: armAlt } : {}) } } }),
            rec('CE-ASM-62509', 'H1-138TRVEBA/P'), rec('CE-ASM-62503', 'H1-138TRVEBA/EP1'),
            rec('CE-INV-54516', 'H1-138TRVBP-V', { manufacturingSpecs: { fabricut: INCL } }), rec('CE-ASM-59332', 'H1-138TRVBP-V/P'), rec('CE-ASM-59333', 'H1-138TRVBP-V/EP1'),
            rec('CE-INV-59340', 'H1-138TRVBP-H', { manufacturingSpecs: { fabricut: INCL } }), rec('CE-ASM-59341', 'H1-138TRVBP-H/P'), rec('CE-ASM-59342', 'H1-138TRVBP-H/EP1'),
            rec('CE-INV-SRA', 'H1-2TRVSRA', { manufacturingSpecs: { fabricut: { paintedCost: 22, platedCost: 30, fabCodePainted: 'H3634F', fabCodePremium: 'H3634F PREMIUM',
                altCodes: [{ plate: '', position: 'RIGHT', painted: 'H3635F', premium: 'H3635F PREMIUM' }] } } }),
            rec('CE-ASM-SRAP', 'H1-2TRVSRA/P'), rec('CE-ASM-SRAE', 'H1-2TRVSRA/EP1'),
            // H1-138ILJL — the real in-app kit: cuff + arm, sold to Fabricut as one piece (H3599F)
            rec('CE-INV-ILJL', 'H1-138ILJL', { partClass: 'Kit', manufacturingSpecs: { fabricut: { paintedCost: 41.5, platedCost: 59.5, fabCodePainted: 'H3599F', fabCodePremium: 'H3599F PREMIUM' },
                kitComponents: [{ partId: 'CE-INV-CUFF', qty: 1 }, { partId: 'CE-INV-CA', qty: 1 }] } }),
            rec('CE-INV-CUFF', 'H1-138CUFF'), rec('CE-ASM-CUFFP', 'H1-138CUFF/P'), rec('CE-INV-CA', 'H1-138CA'), rec('CE-ASM-CAP', 'H1-138CA/P'),
            rec('CE-INV-56818', 'H1-138BP-H', { manufacturingSpecs: { fabricut: INCL } }), rec('CE-ASM-56825', 'H1-138BP-H/P'),
            ...extra,
        ];
        const idx = {}; list.forEach(r => { idx[r.id] = r; idx[r.legacyErpId] = r; });
        return (k) => idx[String(k || '')] || idx[String(k || '').toUpperCase()] || null;
    };
    const FAB = { id: 'CUST-4720', name: 'FABRICUT' };
    const fin = { 'ARM-R': 'EP1', 'PL-R': 'EP1' };
    const cx = (find, over = {}) => ({ findPart: find, findByCode: find, customerId: FAB.id, customer: FAB, priceLevel: 'FAB_COST', levelIsDefault: true,
        outsourceCodes: ['P25', 'LBR'], finishFor: (c) => fin[c.id] || 'P06', ...over });
    const arm = (id, position, qty = 1) => ({ id, partId: 'CE-INV-62502', name: 'arm', role: 'BRACKET', position, qty });
    const plate = (id, position, partId) => ({ id, partId, name: 'plate', role: 'BACKPLATE', position, qty: 1 });
    const V = 'CE-INV-54516', H = 'CE-INV-59340';
    const bom = [arm('ARM-L', 'LEFT'), plate('PL-L', 'LEFT', V), arm('ARM-C', 'CENTER', 3), plate('PL-C', 'CENTER', H), arm('ARM-R', 'RIGHT'), plate('PL-R', 'RIGHT', V)];
    const show = (l) => [l.billedId, l.sku, l.aliasCode, l.unit, l.total, l.position];

    const find = mk(ALT);
    const cfg = priceConfiguration({ choices: bom, bom }, cx(find));
    eq('each bracket is its own line, with its plate beneath — six lines, sold each', cfg.lines.length, 6);
    eq('LEFT, vertical backplate → the vertical number, the arm\'s price', show(cfg.lines[0]), ['H1-138TRVEBA/P', 'H3626F', 'H3626F', 32, 32, 'LEFT']);
    eq('CENTER, horizontal backplate → the arm\'s ordinary number, ×3', show(cfg.lines[2]), ['H1-138TRVEBA/P', '', 'H3629F', 32, 96, 'CENTER']);
    eq('RIGHT, vertical backplate, plated → the PREMIUM vertical number at the plated price', show(cfg.lines[4]), ['H1-138TRVEBA/EP1', 'H3626F PREMIUM', 'H3626F PREMIUM', 42, 42, 'RIGHT']);
    eq('the plates are untouched — included, no number of their own', [cfg.lines[1], cfg.lines[3], cfg.lines[5]].map(l => [l.billedId, l.sku, l.aliasCode, l.unit]),
        [['H1-138TRVBP-V/P', '', '', 0], ['H1-138TRVBP-H/P', '', '', 0], ['H1-138TRVBP-V/EP1', '', '', 0]]);

    // THE MONEY, THE ITEMS AND THE LINES ARE EXACTLY WHAT THEY WERE — only two fields on the matching arm lines differ.
    const before = priceConfiguration({ choices: bom, bom }, cx(mk(null)));
    const strip = (l) => { const { sku, aliasCode, ...rest } = l; return rest; };
    eq('without the second number on the record, every line reads as it did', before.lines.map(l => l.aliasCode), ['H3629F', '', 'H3629F', '', 'H3629F PREMIUM', '']);
    eq('…and with it, nothing but the printed number moves', cfg.lines.map(strip), before.lines.map(strip));
    eq('…the total with it', cfg.total, before.total);

    // A ROW SEEDED FROM THE TIERS (4.6) carries the ordinary number as the customer's SKU — the second number replaces it;
    // another customer's OWN number on their own row stands.
    const seeded = mk(ALT, [rec('CE-ASM-62509', 'H1-138TRVEBA/P', { clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H3629F', price: 32 }] })]);
    eq('a Fabricut row carrying the ordinary number gives way', show(priceConfiguration({ choices: bom, bom }, cx(seeded)).lines[0]), ['H1-138TRVEBA/P', 'H3626F', 'H3626F', 32, 32, 'LEFT']);
    const brimar = mk(ALT, [rec('CE-ASM-62509', 'H1-138TRVEBA/P', { clientPricing: [{ customerId: 'CUST-9', clientSku: 'TB-EXT', price: 50 }] })]);
    const bl = priceConfiguration({ choices: bom, bom }, cx(brimar, { customerId: 'CUST-9', customer: { id: 'CUST-9', name: 'BRIMAR' } })).lines[0];
    eq('another customer\'s own SKU on their own row stands', [bl.sku, bl.unit], ['TB-EXT', 50]);

    // NOT THE PLATE PICKED WITH IT: another position, a hidden rider, the other rod of a double.
    const one = (b, choices) => priceConfiguration({ choices: choices || b, bom: b }, cx(find)).lines[0].aliasCode;
    eq('a vertical plate at ANOTHER position is not this arm\'s', one([arm('ARM-L', 'LEFT'), plate('PL-X', 'CENTER', V)]), 'H3629F');
    eq('no plate picked → the ordinary number', one([arm('ARM-L', 'LEFT')]), 'H3629F');
    eq('a hidden plate rider is not a pick', one([arm('ARM-L', 'LEFT'), { ...plate('PL-HID', 'LEFT', V), hidden: true }]), 'H3629F');
    {
        const a = { ...arm('ARM-L', 'LEFT'), tier: 'BACK' }, pf = { ...plate('PL-F', 'LEFT', V), tier: 'FRONT' }, pb = { ...plate('PL-B', 'LEFT', V), tier: 'BACK' }, pn = plate('PL-N', 'LEFT', V);
        eq('a plate tagged for the FRONT rod is not the BACK arm\'s', one([a, pf], [a, pf]), 'H3629F');
        eq('…one tagged BACK is', one([a, pb], [a, pb]), 'H3626F');
        eq('…and a plate with no tier belongs to the arm at its position (hardwareModel.armOf)', one([a, pn], [a, pn]), 'H3626F');
    }

    // BY POSITION — the 2" traverse return arm, one item at both ends.
    const ends = [{ id: 'END-L', partId: 'CE-INV-SRA', name: 'return arm', role: 'RETURN', position: 'LEFT', qty: 1 }, { id: 'END-R', partId: 'CE-INV-SRA', name: 'return arm', role: 'RETURN', position: 'RIGHT', qty: 1 }];
    const ec = priceConfiguration({ choices: ends, bom: ends }, cx(find, { finishFor: (c) => (c.id === 'END-R' ? 'EP1' : 'P06') }));
    eq('the left end prints the left-hand number', show(ec.lines[0]), ['H1-2TRVSRA/P', '', 'H3634F', 22, 22, 'LEFT']);
    eq('the right end prints the right-hand number — premium, plated', show(ec.lines[1]), ['H1-2TRVSRA/EP1', 'H3635F PREMIUM', 'H3635F PREMIUM', 30, 30, 'RIGHT']);

    // ⚠ A REAL KIT BRACKET IS NOT TOUCHED — H1-138ILJL with a backplate picked at its position: the kit line, its
    // number, its price and its two parts beneath are exactly what they were; and a second number typed on a KIT
    // record is never applied (a kit is sold under its own number, whole).
    const kitBom = [{ id: 'BK-C', partId: 'CE-INV-ILJL', name: 'in-line joining loop bracket', role: 'BRACKET', position: 'CENTER', qty: 2 }, plate('PL-C', 'CENTER', 'CE-INV-56818')];
    const kc = priceConfiguration({ choices: kitBom, bom: kitBom }, cx(find));
    eq('the kit, its two parts, then the plate', kc.lines.map(l => [l.billedId, l.aliasCode, l.unit, l.total, !!l.isKit, !!l.inKit, !!l.hidden, l.qty]), [
        ['H1-138ILJL', 'H3599F', 41.5, 83, true, false, false, 2],
        ['H1-138CUFF/P', '', 0, 0, false, true, true, 2],
        ['H1-138CA/P', '', 0, 0, false, true, true, 2],
        ['H1-138BP-H/P', '', 0, 0, false, false, false, 1]]);
    const kitAlt = mk(ALT, [rec('CE-INV-ILJL', 'H1-138ILJL', { partClass: 'Kit', manufacturingSpecs: { fabricut: { paintedCost: 41.5, platedCost: 59.5, fabCodePainted: 'H3599F', fabCodePremium: 'H3599F PREMIUM',
        altCodes: [{ plate: 'H1-138BP-H', painted: 'WRONG' }, { position: 'CENTER', painted: 'WRONG' }] },
        kitComponents: [{ partId: 'CE-INV-CUFF', qty: 1 }, { partId: 'CE-INV-CA', qty: 1 }] } })]);
    eq('a second number on a KIT record is never applied', priceConfiguration({ choices: kitBom, bom: kitBom }, cx(kitAlt)).lines, kc.lines);
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
