// Tier-inheritance tests for fabricutPriceOf — built from Stuart's H1-2TRV-EWB setup (2026-08-12):
// painted 47.5/95/190, plated 75/150/300 on the BASE doc, own price 37.5/75/150 for the mill /
// simple-finish item. The question these answer, verbatim: "i am not sure how that will price in
// the cpq, just need to be by me entering prices in on this item's own price, that the cpq still
// follows the pricing rules for the /P and /EP."
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricutPriceOf } from './priceLevels.mjs';

const BASE = {
    legacyErpId: 'H1-2TRV-EWB',
    manufacturingSpecs: { fabricut: {
        cost: 37.5, wholesale: 75, retail: 150,                    // "this item's own price" — mill/Bronze/Champagne
        paintedCost: 47.5, paintedWholesale: 95, paintedRetail: 190,
        platedCost: 75, platedWholesale: 150, platedRetail: 300,
        fabCodePainted: 'H3643F', fabCodePremium: 'H3643F PREMIUM',
    } },
};
// The unstamped variant docs exactly as they sit in his library — no fabricut struct of their own.
const bare = (code) => ({ legacyErpId: code, manufacturingSpecs: {} });
const lib = { 'H1-2TRV-EWB': BASE };
const find = (c) => lib[c] || null;

test('the base doc picked directly (mill / a simple component finish) prices at its OWN rate', () => {
    assert.equal(fabricutPriceOf(BASE, 'FAB_COST'), 37.5);
    assert.equal(fabricutPriceOf(BASE, 'FAB_WHOLESALE'), 75);
    assert.equal(fabricutPriceOf(BASE, 'FAB_RETAIL'), 150);
    // …including when a non-plated finish code rides along (Bronze/Champagne once they are finishes)
    assert.equal(fabricutPriceOf(BASE, 'FAB_COST', 'C'), 37.5);
});

test('an unstamped /P variant INHERITS the base painted tier — own price never shadows it', () => {
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/P'), 'FAB_COST', 'P01', [], find), 47.5);
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/P'), 'FAB_WHOLESALE', 'P01', [], find), 95);
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/P'), 'FAB_RETAIL', 'P01', [], find), 190);
});

test('an unstamped /EPn variant inherits the base PLATED tier; /P25 counts as plated too', () => {
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/EP2'), 'FAB_COST', 'EP2', [], find), 75);
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/EP2'), 'FAB_RETAIL', 'EP2', [], find), 300);
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/P25'), 'FAB_COST', 'P25', [], find), 75);
});

test('a STAMPED variant still wins with its own exact numbers — H1 behavior unchanged', () => {
    const stamped = { legacyErpId: 'H1-2TRV-EWB/EP3', manufacturingSpecs: { fabricut: { cost: 80, wholesale: 160, retail: 320 } } };
    assert.equal(fabricutPriceOf(stamped, 'FAB_COST', 'EP3', [], find), 80);
});

test('no findByCode passed (the portal mirror today) = exactly the old behavior: null', () => {
    assert.equal(fabricutPriceOf(bare('H1-2TRV-EWB/P'), 'FAB_COST', 'P01', []), null);
});

test('a variant whose base has no fabricut struct stays null — standard pricing keeps it', () => {
    assert.equal(fabricutPriceOf(bare('H2-XX/P'), 'FAB_COST', 'P01', [], find), null);
});

test('inherited wholesale falls back to retail ÷ 2 when the tier has no wholesale', () => {
    const noWholesale = { legacyErpId: 'H1-NW', manufacturingSpecs: { fabricut: { paintedCost: 10, paintedRetail: 40 } } };
    assert.equal(fabricutPriceOf(bare('H1-NW/P'), 'FAB_WHOLESALE', 'P01', [], (c) => c === 'H1-NW' ? noWholesale : null), 20);
});
