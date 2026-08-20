// Harness for Shared/hardwarePricing.js — the precedence, stated once and checked.
//   node scripts/hardwarePricing.test.mjs
//
// Pricing ships on invoices, so the order it resolves in is asserted rather than described.

import { priceChoice, priceConfiguration, pricingWarnings, PRICE_SOURCES } from '../src/components/Shared/hardwarePricing.js';

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

    const ten = priceConfiguration(model, ctx(10));
    eq('ten feet of rod bills ten times', ten.lines[0].total, 125);
    eq('and so does the second rod of a double', ten.lines[1].total, 125);
    ok('the rod line says it is per foot', ten.lines[0].perFoot === true);
    eq('the finial is untouched — it does not grow with the pole', ten.lines[2].total, 56);
    ok('and is not marked per foot', !ten.lines[2].perFoot);
    eq('the total adds up', ten.total, 125 + 125 + 56);
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
