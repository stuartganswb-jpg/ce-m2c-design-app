// Harness for Shared/altPattern.js — one item, a second customer number, chosen by how it was ordered.
//   node scripts/altPattern.test.mjs
//
// Stuart 2026-10-04: "we need to be able to enter both depending on what they order it must be clear on the customer
// forms and to the floor" · "take in consideration the 2\" return arms as well". The records below are the 1-3/8"
// traverse arm and the 2" traverse return arm as the library carries them (tiers and pattern #s read live that day).

import {
    altPatternRowsOf, altPatternFor, defaultPatternsOf, printedPatternOf, altPatternCodesOf, altPatternListOf, ALT_POSITIONS,
} from '../src/components/Shared/altPattern.js';
import { customerCodesOf, matchesCustomerCode } from '../src/components/Shared/aliasSearch.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

const EBA = { id: 'CE-INV-62502', legacyErpId: 'H1-138TRVEBA', itemName: 'Extended Bracket Arm (4-5/8" P) for 1-3/8" Traverse', partClass: 'Assembly',
    manufacturingSpecs: { fabricut: { paintedCost: 32, platedCost: 42, fabCodePainted: 'H3629F', fabCodePremium: 'H3629F PREMIUM',
        altCodes: [{ plate: 'H1-138TRVBP-V', position: '', painted: 'H3626F', premium: 'H3626F PREMIUM' }] } } };
const EBA_P = { id: 'CE-ASM-62509', legacyErpId: 'H1-138TRVEBA/P', itemName: 'Extended Bracket Arm - Paint', partClass: 'Assembly', manufacturingSpecs: {} };
const EBA_EP1 = { id: 'CE-ASM-62503', legacyErpId: 'H1-138TRVEBA/EP1', itemName: 'Extended Bracket Arm - Satin Nickel', partClass: 'Assembly', manufacturingSpecs: {} };
const SRA = { id: 'CE-INV-SRA', legacyErpId: 'H1-2TRVSRA', itemName: 'Traverse End Return Arm (3-5/8" P)', partClass: 'Assembly',
    manufacturingSpecs: { fabricut: { paintedCost: 22, platedCost: 30, fabCodePainted: 'H3634F', fabCodePremium: 'H3634F PREMIUM',
        altCodes: [{ plate: '', position: 'RIGHT', painted: 'H3635F', premium: 'H3635F PREMIUM' }] } } };
const BS = { id: 'CE-INV-56899', legacyErpId: 'H1-138BS', itemName: 'Basic Bracket', partClass: 'Assembly',
    manufacturingSpecs: { fabricut: { paintedCost: 13, fabCodePainted: 'H3588F', fabCodePremium: 'H3588F PREMIUM' } } };
const lib = Object.fromEntries([EBA, EBA_P, EBA_EP1, SRA, BS].map(p => [p.legacyErpId, p]));
const find = (c) => lib[String(c || '').trim().toUpperCase()] || null;

// ── THE ROWS ─────────────────────────────────────────────────────────────────────────────
eq('the positions a row may name', ALT_POSITIONS, ['LEFT', 'CENTER', 'RIGHT']);
eq('an item with no second number has no rows', altPatternRowsOf(BS, find), []);
eq('the arm carries one row, cleaned', altPatternRowsOf(EBA, find), [{ plate: 'H1-138TRVBP-V', position: '', painted: 'H3626F', premium: 'H3626F PREMIUM' }]);
eq('a finish variant answers from its base item, as its pattern # does', altPatternRowsOf(EBA_P, find).length, 1);
eq('…and with no lookup it has nothing of its own', altPatternRowsOf(EBA_P).length, 0);
{
    const messy = { legacyErpId: 'X', manufacturingSpecs: { fabricut: { altCodes: [
        { plate: '', position: '', painted: 'NEVER' },                      // says no WHEN → ignored
        { plate: 'h1-138trvbp-v/p ', position: 'right', painted: ' h1f ', premium: '' },   // typed loosely → cleaned
        { plate: 'A', position: 'SIDEWAYS', painted: '', premium: '' },      // no number → ignored
        null,
    ] } } };
    eq('a row with no condition, or no number, is not a row; the rest is cleaned', altPatternRowsOf(messy), [{ plate: 'H1-138TRVBP-V', position: 'RIGHT', painted: 'H1F', premium: '' }]);
    eq('a broken box is no rows, not a crash', [altPatternRowsOf({ manufacturingSpecs: { fabricut: { altCodes: 'x' } } }), altPatternRowsOf(null), altPatternRowsOf({})], [[], [], []]);
}

// ── BY THE BACKPLATE (the 1-3/8" traverse arm) ──────────────────────────────────────────────
eq('with the vertical backplate → the vertical number', altPatternFor(EBA, { plateCode: 'H1-138TRVBP-V', position: 'LEFT' }, find), 'H3626F');
eq('the plate\'s finish does not matter', altPatternFor(EBA, { plateCode: 'H1-138TRVBP-V/EP1', position: 'CENTER' }, find), 'H3626F');
eq('with the horizontal backplate → no second number', altPatternFor(EBA, { plateCode: 'H1-138TRVBP-H', position: 'LEFT' }, find), '');
eq('with no backplate picked → none', altPatternFor(EBA, { position: 'LEFT' }, find), '');
eq('plated → the premium number', altPatternFor(EBA, { plateCode: 'H1-138TRVBP-V', plated: true }, find), 'H3626F PREMIUM');
eq('asked of the paint variant, the same', altPatternFor(EBA_P, { plateCode: 'H1-138TRVBP-V' }, find), 'H3626F');
{
    const onlyPainted = { legacyErpId: 'Y', manufacturingSpecs: { fabricut: { altCodes: [{ plate: 'P1', painted: 'ONE' }] } } };
    eq('plated with no premium number falls back to the painted one — the pattern # rule', altPatternFor(onlyPainted, { plateCode: 'P1', plated: true }), 'ONE');
}

// ── BY THE POSITION (the 2" traverse return arm) ─────────────────────────────────────────────
eq('at the right → the right-hand number', altPatternFor(SRA, { position: 'RIGHT' }, find), 'H3635F');
eq('at the left → none (its ordinary number is the left one)', altPatternFor(SRA, { position: 'LEFT' }, find), '');
eq('position is read loosely', altPatternFor(SRA, { position: ' right ' }, find), 'H3635F');
eq('no position on the line → none', altPatternFor(SRA, {}, find), '');

// ── A ROW THAT NAMES BOTH OUTRANKS A ROW THAT NAMES ONE ───────────────────────────────────────
{
    const both = { legacyErpId: 'Z', manufacturingSpecs: { fabricut: { altCodes: [
        { plate: 'PL', painted: 'PLATE-ONLY' }, { position: 'RIGHT', painted: 'RIGHT-ONLY' }, { plate: 'PL', position: 'RIGHT', painted: 'BOTH' },
    ] } } };
    eq('plate and position both true → the row naming both', altPatternFor(both, { plateCode: 'PL', position: 'RIGHT' }), 'BOTH');
    eq('only the plate true → the plate row', altPatternFor(both, { plateCode: 'PL', position: 'LEFT' }), 'PLATE-ONLY');
    eq('only the position true → the position row', altPatternFor(both, { plateCode: 'OTHER', position: 'RIGHT' }), 'RIGHT-ONLY');
    eq('neither → none', altPatternFor(both, { plateCode: 'OTHER', position: 'LEFT' }), '');
}

// ── WHAT A PRICED LINE PRINTS ────────────────────────────────────────────────────────────────
eq('the ordinary numbers of an item', defaultPatternsOf(EBA_P, find), ['H3629F', 'H3629F PREMIUM']);
eq('the pattern # is replaced', printedPatternOf(EBA, { printed: 'H3629F', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/P' }, find), 'H3626F');
eq('a plated bill prints the premium second number', printedPatternOf(EBA, { printed: 'H3629F PREMIUM', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/EP1' }, find), 'H3626F PREMIUM');
eq('an outsourced finish is plated too', printedPatternOf(EBA, { printed: 'H3629F PREMIUM', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/P25' }, find), 'H3626F PREMIUM');
eq('…and a registry code, when the caller passes the registry', printedPatternOf(EBA, { printed: 'H3629F', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/LBR', outsourceCodes: ['LBR'] }, find), 'H3626F PREMIUM');
eq('a line that printed nothing takes it', printedPatternOf(EBA, { printed: '', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/P' }, find), 'H3626F');
eq('ANOTHER customer\'s own SKU stands', printedPatternOf(EBA, { printed: 'BRIMAR-TB2', plateCode: 'H1-138TRVBP-V', billedId: 'H1-138TRVEBA/P' }, find), '');
eq('no row applies → the line is left alone', printedPatternOf(EBA, { printed: 'H3629F', plateCode: 'H1-138TRVBP-H', billedId: 'H1-138TRVEBA/P' }, find), '');
eq('an item with no second number is left alone', printedPatternOf(BS, { printed: 'H3588F', plateCode: 'H1-138TRVBP-V', position: 'RIGHT', billedId: 'H1-138BS/P' }, find), '');

// ── SEARCH: THE ITEM ANSWERS TO ITS SECOND NUMBER TOO ─────────────────────────────────────────
eq('every second number on the record', altPatternCodesOf(EBA), ['H3626F', 'H3626F PREMIUM']);
eq('none on a record without them', [altPatternCodesOf(BS), altPatternCodesOf(null)], [[], []]);
eq('the customer-code list carries both sets', customerCodesOf(EBA), ['H3629F', 'H3629F PREMIUM', 'H3626F', 'H3626F PREMIUM']);
ok('typing the vertical number finds the arm', matchesCustomerCode(EBA, 'h3626f'));
ok('typing the right-hand number finds the return arm', matchesCustomerCode(SRA, 'H3635F'));
ok('an ordinary item is found by its own number only', matchesCustomerCode(BS, 'H3588F') && !matchesCustomerCode(BS, 'H3626F'));
eq('a lookup is told WHEN each number applies', altPatternListOf(EBA, find), [
    { code: 'H3626F', when: 'with H1-138TRVBP-V', plate: 'H1-138TRVBP-V', position: '' },
    { code: 'H3626F PREMIUM', when: 'with H1-138TRVBP-V', plate: 'H1-138TRVBP-V', position: '' }]);
eq('…a position in words', altPatternListOf(SRA, find).map(a => `${a.code} · ${a.when}`), ['H3635F · at the right', 'H3635F PREMIUM · at the right']);

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
