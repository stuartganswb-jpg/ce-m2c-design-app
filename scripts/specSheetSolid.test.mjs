// The SOLID sheets — which assemblies take the new layout, and what each sheet carries.
//   node scripts/specSheetSolid.test.mjs
//
// Stuart 2026-09-30 / 10-01: one sheet per bracket or return at one projection (the hero view, the rings, a
// Backplates row and a Cover plates row with the client's dimensions), the metal rod always the one drawn, "H1-2TRV
// first" — an assembly with anything this layout cannot draw yet keeps the sheets it has, whole. Asked of the live
// H1-2TRV pins (2026-09-30, prod shape).
//
// SPECSOLID_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { choicesFromAssembly } from '../src/components/Shared/hardwareAdapter.js';
import { specPages } from '../src/components/SpecSheet/specSheetPages.js';
import { ASSEMBLY, PINS, CODES } from './specSheetSolid.fixture.mjs';

const S = await import(process.env.SPECSOLID_MODULE || new URL('../src/components/SpecSheet/specSheetSolid.js', import.meta.url).href);
const { solidReady, solidUnsupported, solidSheets, auditSolid, returnTypeOf, plateRowOf, materialsOf, ROW_KINDS } = S;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const code = (c) => (c ? CODES[c.partId] || c.partId : null);
const CHOICES = choicesFromAssembly(ASSEMBLY, PINS);
const PAGES = specPages({ choices: CHOICES });
const ROWS = PAGES.filter(p => ROW_KINDS.includes(p.kind));
const SHEETS = solidSheets({ pages: PAGES, choices: CHOICES });

// ── H1-2TRV TAKES THE NEW LAYOUT, WHOLE ──────────────────────────────────────────────────────
{
    eq('the engine still answers 72 row pages — it is not touched', ROWS.length, 72);
    ok('every one of them can be drawn in this layout', ROWS.every(p => solidUnsupported(p) === null));
    ok('so the assembly is ready', solidReady(PAGES) === true);
    eq('72 pages become 12 sheets: one per bracket / return at one projection, in the engine\'s own order',
        SHEETS.map(s => `${code(s.subject)}@${s.answers.proj}`),
        ['H1-2RCTSPA@3.625', 'H1-2RCTCB@3.625', 'H1-2RCTSRA@3.625', 'H1-2TRVMTR@3.625',
            'H1-2RCTEPA@4.625', 'H1-2RCTECB@4.625', 'H1-2RCTERA@4.625', 'H1-2TRVMTR@4.625',
            'H1-2RCTPA6@6', 'H1-2RCT6CB@6', 'H1-2RCTRA6@6', 'H1-2TRVMTR@6']);
    ok('every sheet is a SOLID sheet of its page kind', SHEETS.every(s => s.kind === 'SOLID' && (s.group === 'BRACKET' || s.group === 'RETURN')));
    const keys = SHEETS.flatMap(s => s.pageKeys);
    eq('every engine page lands on exactly one sheet', [keys.length, new Set(keys).size, SHEETS.every(s => s.pageKeys.length === 6)], [72, 72, true]);
    eq('the grouping audits clean', auditSolid(SHEETS), []);
    // One part sold at two projections (a fee modelled once) is two sheets — the projection is part of what a sheet is.
    const one = ROWS[0], twoDepths = [{ ...one, key: 'a' }, { ...one, key: 'b', answers: { ...one.answers, proj: 6 } }];
    eq('the same part at two projections is two sheets', solidSheets({ pages: twoDepths, choices: CHOICES }).map(s => s.answers.proj), [3.625, 6]);
}

// ── WHAT A SHEET CARRIES ──────────────────────────────────────────────────────────────────────
{
    const spa = SHEETS[0];
    eq('all eight plates, each in its family\'s row',
        spa.plates.map(p => `${code(p.choice)}:${p.row.key}`).sort(),
        ['H1-138BP-R:BP', 'H1-138BP-S:BP', 'H1-138BP-V:BP', 'H1-138CP-R:CP', 'H1-138CP-S:CP', 'H1-138CP-V:CP', 'H1-2RCTBP-H:BP', 'H1-2RCTCP-H:CP']);
    ok('every sheet has the same eight', SHEETS.every(s => s.plates.length === 8 && s.plates.filter(p => p.row.key === 'BP').length === 4));
    eq('both rings — the acrylic one under its own number (the 09-30 tag fix)', spa.rings.map(code).sort(), ['H1-2RCTACRING', 'H1-2RCTPR']);
    // The engine hands the cuff brackets and the returns the WOOD rod (rodForArm's metal preference runs only on tiered
    // brackets) — the sheet draws the metal one regardless.
    const cb = SHEETS[1], enginePage = ROWS.find(p => code(p.subject) === 'H1-2RCTCB');
    eq('the engine\'s own rod for the cuff bracket is the wood one', [...new Set((enginePage.rods || [enginePage.rod]).map(code))], ['H1-2RCTWR']);
    eq('the sheet draws the metal rod', [...new Set(cb.rods.map(code))], ['H1-2RCTAR']);
    ok('no sheet draws a wood rod', SHEETS.every(s => s.rods.length > 0 && s.rods.every(r => materialsOf(r).includes('METAL'))));
    const noMetal = CHOICES.filter(c => !(c.role === 'ROD' && materialsOf(c).includes('METAL')));
    eq('with no metal rod tagged, the engine\'s own pick stands', [...new Set(solidSheets({ pages: PAGES, choices: noMetal })[1].rods.map(code))], ['H1-2RCTWR']);
}

// ── WHAT A RETURN IS: ITS TAGS AND THE FEE, NEVER ITS CODE ───────────────────────────────────
{
    eq('the end return arms are parts (ARM), the miter is a fee (MITER), a bracket is neither',
        SHEETS.map(s => s.returnType),
        [null, null, 'ARM', 'MITER', null, null, 'ARM', 'MITER', null, null, 'ARM', 'MITER']);
    eq('a french return bends', returnTypeOf({ endTreatment: 'FRENCH_RETURN', isFee: true }), 'FRENCH');
    eq('a miter-return FEE is a miter', returnTypeOf({ endTreatment: 'MITER_RETURN', raw: { isFee: true } }), 'MITER');
    eq('a miter-return PART is an end arm (the traverse end arms)', returnTypeOf({ endTreatment: 'MITER_RETURN', isReturnArm: true }), 'ARM');
    eq('a return-arm part with no end treatment is an end arm (END-ARM on a bracket cluster)', returnTypeOf({ endTreatment: '', isReturnArm: true }), 'ARM');
    eq('a fee with no end treatment is nothing this layout knows', returnTypeOf({ feeItemNo: 'X-FEE' }), null);
    eq('nor is an untagged part', returnTypeOf({ endTreatment: '' }), null);
}

// ── THE PLATE ROWS READ THE ENGINE'S FAMILY STEM ─────────────────────────────────────────────
{
    eq('…BP is the Backplates row (never "Screw backplates")', plateRowOf('H1-138BP'), { key: 'BP', name: 'Backplates (BP)', order: 0 });
    eq('…CP is the Cover plates row, after it', plateRowOf('H1-2RCTCP'), { key: 'CP', name: 'Cover plates (CP)', order: 1 });
    eq('return plates fall in the same two rows', [plateRowOf('H1-75RBP').key, plateRowOf('H1-75RCP').key], ['BP', 'CP']);
    eq('any other family gets a row of its own, last — nothing is dropped', plateRowOf('H1-XYZ'), { key: 'H1-XYZ', name: 'Plates · H1-XYZ', order: 2 });
    eq('materials: a string or a list; none named is metal', [materialsOf({ materials: '' }), materialsOf({ materials: 'WOOD' }), materialsOf({ materials: ['wood', 'METAL'] }), materialsOf({})], [['METAL'], ['WOOD'], ['WOOD', 'METAL'], ['METAL']]);
}

// ── ONE ASSEMBLY, ONE LAYOUT: anything it cannot draw yet keeps the whole assembly on its old sheets ─
{
    const good = ROWS[0];
    const why = (patch) => solidUnsupported({ ...good, ...patch });
    eq('a double, by its setup', why({ answers: { ...good.answers, setup: 'DOUBLE' } }), 'a double');
    eq('a double, by its two rods', why({ rods: [good.rod, good.rod] }), 'a double');
    eq('a double, by its tiered projection', why({ subject: { ...good.subject, projTiers: { FRONT: 6.5, BACK: 3.25 } } }), 'a double');
    eq('a ceiling mount, by the leaf', why({ answers: { ...good.answers, mount: 'CEILING' } }), 'a ceiling mount');
    eq('a ceiling mount, by the bracket\'s own tag', why({ subject: { ...good.subject, mount: 'CEILING' } }), 'a ceiling mount');
    eq('a basic — the plate is in the arm', why({ plates: [] }), 'no separate plate (a basic)');
    eq('the 1-3/8" traverse pole', why({ answers: { ...good.answers, rodKind: 'TRAVERSE' } }), 'not the solid rod world');
    eq('an inside mount', why({ kind: 'INSIDE_MOUNT' }), 'not a bracket or a return');
    eq('a return of no known kind', why({ kind: 'RETURN', subject: { ...good.subject, endTreatment: '', isReturnArm: false } }), 'a return this layout does not know');
    eq('an assembly with no rod-world question at all is still solid', solidUnsupported({ ...good, answers: { proj: 3.625 } }), null);

    const oneDouble = [...PAGES, { ...good, key: 'DBL', answers: { ...good.answers, setup: 'DOUBLE' } }];
    ok('ONE page this layout cannot draw keeps the whole assembly on the sheets it has', solidReady(oneDouble) === false);
    ok('pages that are not row pages (traverse sheets, the finials catalog) do not hold it back', PAGES.some(p => !ROW_KINDS.includes(p.kind)) && solidReady(PAGES));
    ok('an assembly with no row pages is not "ready"', solidReady(PAGES.filter(p => !ROW_KINDS.includes(p.kind))) === false && solidReady([]) === false);
}

// ── THE AUDIT NAMES EACH FAULT ────────────────────────────────────────────────────────────────
{
    const s0 = SHEETS[2];
    const faults = (patch) => auditSolid([{ ...s0, ...patch }]).map(v => v.why);
    eq('no plate', faults({ plates: [] }), ['no plate']);
    eq('no rod', faults({ rods: [] }), ['no rod']);
    eq('a return of no known kind', faults({ returnType: null }), ['a return of no known kind']);
    eq('a plate twice', faults({ plates: [s0.plates[0], s0.plates[0]] }), ['a plate twice']);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
