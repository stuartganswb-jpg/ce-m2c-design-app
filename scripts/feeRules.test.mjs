// Harness for Shared/feeRules.js — the fee arithmetic, and especially the shape nobody has run in
// anger yet: a PERCENTAGE OF THE ORDER WITH A MINIMUM (outdoor coating 25%, rush "25% of order /
// min $100", custom colour "10% or $100 minimum").
//   node scripts/feeRules.test.mjs
//
// Percentages are the one fee shape where the number on the quote is not a number anybody typed —
// it is worked out from the configuration subtotal at the moment the quote is finalized. So the
// floor, the base, and the never-compound rule are asserted rather than trusted.

import { computeFee, feeRuleOf, feeRuleSummary, buildAddOnLines, buildCheckoutCatalog, buildFeeCatalog, addOnsTotal, isFeeItemRecord } from '../src/components/Shared/feeRules.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

// The two fees this file exists for, as 4.6 → FEES would store them.
const OUTDOOR = {
    id: 'F-OUT', legacyErpId: 'CE-FEE-OUTDOOR', itemName: 'Outdoor Coating', partClass: 'Fee',
    manufacturingSpecs: { productType: 'FEE', checkoutSelectable: true, feeRule: { mode: 'PERCENT', percent: 25, portalSelectable: false } },
};
const RUSH = {
    id: 'F-RUSH', legacyErpId: 'CE-FEE-RUSH', itemName: 'Rush', partClass: 'Fee',
    manufacturingSpecs: { productType: 'FEE', checkoutSelectable: true, feeRule: { mode: 'PERCENT', percent: 25, minAmount: 100, portalSelectable: true } },
};
const PACKAGING = {   // a flat one, for the mixed-catalogue cases
    id: 'F-PACK', legacyErpId: 'CE-FEE-PACK', itemName: 'Packaging', partClass: 'Fee',
    manufacturingSpecs: { productType: 'FEE', checkoutSelectable: true, basePrice: 12, feeRule: { mode: 'FLAT', unit: 'BOX' } },
};

// ── the rule, as stored ────────────────────────────────────────────────────────────────────────
const outRule = feeRuleOf(OUTDOOR.manufacturingSpecs);
const rushRule = feeRuleOf(RUSH.manufacturingSpecs);
eq('outdoor: percent mode, no floor', [outRule.mode, outRule.percent, outRule.minAmount], ['PERCENT', 25, null]);
eq('rush: percent mode with a $100 floor', [rushRule.mode, rushRule.percent, rushRule.minAmount], ['PERCENT', 25, 100]);
eq('a fee with no rule at all is a flat charge, once', feeRuleOf({}).mode, 'FLAT');

// ── the arithmetic ─────────────────────────────────────────────────────────────────────────────
eq('outdoor 25% of 1200', computeFee({ rule: outRule, qty: 1, configSubtotal: 1200 }).amount, 300);
eq('outdoor rounds to the cent, never a fraction of one', computeFee({ rule: outRule, configSubtotal: 333.33 }).amount, 83.33);

// The floor is the whole point of the rule on a small order, and must vanish on a large one.
eq('rush on a $200 order: 25% = 50, so the $100 minimum applies', computeFee({ rule: rushRule, configSubtotal: 200 }).amount, 100);
eq('rush at exactly the crossover ($400) is the percentage, not the floor', computeFee({ rule: rushRule, configSubtotal: 400 }).amount, 100);
eq('rush on a $2000 order: the percentage has taken over', computeFee({ rule: rushRule, configSubtotal: 2000 }).amount, 500);
ok('the quote line SAYS the minimum applied', /below the 100.00 minimum/.test(computeFee({ rule: rushRule, configSubtotal: 200 }).explain));
ok('…and says the plain percentage when it did not', computeFee({ rule: rushRule, configSubtotal: 2000 }).explain === '25% of 2000.00');

// A percentage fee never reads the unit price, however tempting the field looks.
eq('a price on a percentage fee is ignored', computeFee({ rule: outRule, unitPrice: 999, qty: 7, configSubtotal: 1000 }).amount, 250);
// An order with nothing configured yet cannot charge 25% of nothing — but the floor still holds.
eq('outdoor on an empty cart is 0', computeFee({ rule: outRule, configSubtotal: 0 }).amount, 0);
eq('rush on an empty cart is the floor', computeFee({ rule: rushRule, configSubtotal: 0 }).amount, 100);

eq('the picker line reads as the sheet does', feeRuleSummary(rushRule), '25% of the configuration, min $100.00');

// ── the lines a quote gets ─────────────────────────────────────────────────────────────────────
const priceFor = (p) => parseFloat(p?.manufacturingSpecs?.basePrice) || 0;
const catalog = buildCheckoutCatalog([OUTDOOR, RUSH, PACKAGING], { priceFor });
eq('all three are on the checkout screen', catalog.length, 3);
ok('and all three read as fees', catalog.every(e => e.isFee === true));

// ⚠ THE RULE THAT MUST NOT DRIFT: two percentage fees on one order both work off the CONFIGURATION
// subtotal, so neither ever charges a percentage of the other.
const both = buildAddOnLines({ 'F-OUT': true, 'F-RUSH': true }, catalog, 1000);
eq('outdoor + rush on a $1000 configuration', both.map(l => l.total).sort((a, b) => a - b), [250, 250]);
eq('…and they do not compound', addOnsTotal(both), 500);
ok('a percentage line is qty 1 at the computed amount', both.every(l => l.qty === 1 && l.price === l.total));
ok('every percentage line rides as a FEE (rollup, never a NetSuite item line)', both.every(l => l.isFee === true && l.isAddOn === true));

// Percentage fees are on/off — a quantity box would be a lie, and an unticked one contributes
// nothing rather than a zero-dollar line.
eq('unticked percentage fees produce no lines', buildAddOnLines({ 'F-OUT': false }, catalog, 1000).length, 0);
eq('an untouched catalogue produces no lines', buildAddOnLines({}, catalog, 1000).length, 0);

// A flat fee alongside them still counts its own way.
const mixed = buildAddOnLines({ 'F-RUSH': true, 'F-PACK': 2 }, catalog, 200);
eq('rush floors at 100, packaging is 2 boxes × 12', addOnsTotal(mixed), 124);
ok('the flat line keeps its unit price and count', mixed.some(l => l.qty === 2 && l.price === 12 && l.total === 24));

// ── identity ───────────────────────────────────────────────────────────────────────────────────
ok('a percentage fee is still a fee everywhere', [OUTDOOR, RUSH].every(isFeeItemRecord));
eq('the fee catalogue finds them without the checkout tick', buildFeeCatalog([OUTDOOR, RUSH, PACKAGING], { priceFor }).length, 3);
eq('rush is portal-selectable, outdoor is staff-only',
    buildFeeCatalog([OUTDOOR, RUSH], { priceFor }).map(e => [e.code, e.portalOk]),
    [['CE-FEE-OUTDOOR', false], ['CE-FEE-RUSH', true]]);

console.log(`\n${fail ? '❌' : '✅'}  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
