// A WOOD ROD IS ROUTED BY ITS CUT, NOT BY ITS TAG (Stuart 2026-09-08).
// "wood + miter → Custom, wood + straight → finishing" — settled 2026-09-03, still untrue in the
// app until now, because classifyLine let the ITEM's Part Handling win unconditionally and the
// wood rods are correctly tagged Custom.
import assert from 'node:assert';
import { classifyLine, DIVISION_SMALL, DIVISION_CUSTOM } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const t = (n, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log(`  FAIL ${n}: ${e.message}`); } };

const woodRod = { manufacturingSpecs: { material: 'WOOD', productType: 'POLE', partHandling: 'Custom' } };
const metalRod = { manufacturingSpecs: { material: 'METAL', productType: 'POLE', partHandling: 'Custom' } };
const untagged = { manufacturingSpecs: { productType: 'POLE', partHandling: 'Custom' } };
const woodFinial = { manufacturingSpecs: { material: 'WOOD', productType: 'FINIAL', partHandling: 'Custom' } };
const line = { name: 'rod', partId: 'P1' };
const straight = { qtyMiters: 0, qtyBends: 0, qtySplices: 0 };
const mitered = { qtyMiters: 2, qtyBends: 0, qtySplices: 0 };

// ── THE RULE ─────────────────────────────────────────────────────────────────────────
t('wood rod + straight → FINISHING (the defect, fixed)', () => {
    assert.strictEqual(classifyLine(line, woodRod, straight), DIVISION_SMALL);
});
t('wood rod + miter → SHOP', () => {
    assert.strictEqual(classifyLine(line, woodRod, mitered), DIVISION_CUSTOM);
});
t('a bend keeps it in the shop', () => {
    assert.strictEqual(classifyLine(line, woodRod, { qtyBends: 1 }), DIVISION_CUSTOM);
});
t('a splice keeps it in the shop', () => {
    assert.strictEqual(classifyLine(line, woodRod, { qtySplices: 1 }), DIVISION_CUSTOM);
});
t('a miter RETURN keeps it in the shop', () => {
    assert.strictEqual(classifyLine(line, woodRod, { qtyMiterReturns: 1 }), DIVISION_CUSTOM);
});

// ── SILENCE IS NOT "STRAIGHT" ────────────────────────────────────────────────────────
t('no fab facts → the rule does not fire, the item tag still decides', () => {
    assert.strictEqual(classifyLine(line, woodRod), DIVISION_CUSTOM, 'omitting the cut facts must not route a pole to finishing');
    assert.strictEqual(classifyLine(line, woodRod, null), DIVISION_CUSTOM);
});

// ── BLAST RADIUS: NOTHING ELSE MOVES ─────────────────────────────────────────────────
t('METAL is untouched — "metal follows the same rules as cpq"', () => {
    assert.strictEqual(classifyLine(line, metalRod, straight), DIVISION_CUSTOM);
    assert.strictEqual(classifyLine(line, metalRod, mitered), DIVISION_CUSTOM);
});
t('an UNTAGGED rod reads as metal and is untouched', () => {
    assert.strictEqual(classifyLine(line, untagged, straight), DIVISION_CUSTOM);
});
t('wood that is NOT a rod is untouched — Stuart: "just the rods"', () => {
    assert.strictEqual(classifyLine(line, woodFinial, straight), DIVISION_CUSTOM);
});
t('a small-parts item stays small', () => {
    const bracket = { manufacturingSpecs: { material: 'METAL', productType: 'BRACKET', partHandling: 'Small Parts' } };
    assert.strictEqual(classifyLine(line, bracket, straight), DIVISION_SMALL);
});

// ── THE ORDER OF PRECEDENCE IS PRESERVED ─────────────────────────────────────────────
t('a FEE line is still custom, wood or not', () => {
    assert.strictEqual(classifyLine({ ...line, isFee: true }, woodRod, straight), DIVISION_CUSTOM);
});
t('the operator override still wins over everything', () => {
    assert.strictEqual(classifyLine({ ...line, customOverrideHandling: 'Custom' }, woodRod, straight), DIVISION_CUSTOM);
    assert.strictEqual(classifyLine({ ...line, customOverrideHandling: 'Small Parts' }, metalRod, mitered), DIVISION_SMALL);
});

// ── THE TAG IS READ LENIENTLY, BECAUSE IT WAS FREE TEXT UNTIL TODAY ──────────────────
t('case and surrounding words do not matter', () => {
    const p = (m) => ({ manufacturingSpecs: { material: m, productType: 'POLE', partHandling: 'Custom' } });
    ['WOOD', 'wood', 'Wood', 'WHITE OAK WOOD'].forEach(m =>
        assert.strictEqual(classifyLine(line, p(m), straight), DIVISION_SMALL, `"${m}" should read as wood`));
});
t('a word that merely CONTAINS "wood" is NOT wood', () => {
    // WOODGRAIN LAMINATE STEEL is a STEEL rod that looks like wood — it is cut and finished as
    // metal, and routing it to the paint line on a substring match would be exactly wrong. The
    // word boundary in \\bWOOD\\b is doing real work here, not tidiness.
    const p = { manufacturingSpecs: { material: 'WOODGRAIN LAMINATE STEEL', productType: 'POLE', partHandling: 'Custom' } };
    assert.strictEqual(classifyLine(line, p, straight), DIVISION_CUSTOM);
    const q = { manufacturingSpecs: { material: 'PLYWOOD', productType: 'POLE', partHandling: 'Custom' } };
    assert.strictEqual(classifyLine(line, q, straight), DIVISION_CUSTOM, 'PLYWOOD is one word, not "wood"');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
