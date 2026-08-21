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

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
