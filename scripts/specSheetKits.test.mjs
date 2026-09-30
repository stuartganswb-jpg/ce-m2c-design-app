// The Fabricut KIT a spec-sheet drawing is named by (Fabricut edition).
//   node scripts/specSheetKits.test.mjs
//
// Stuart 2026-09-30: H1-2TRV and H1-138TRV are sold to Fabricut as 4 ft kits — "select the kit for the
// general style then they select the projection so you can call them all the kit and add - 3 5/8"P,
// 4 5/8"P etc." · "Put Kit# Pending" · "drop down and title" (the parts inside keep their own ids). The
// kits below are the 38 live 4.6 kit records as read 2026-09-30 (code, kitAlign, the FABRICUT row's
// clientSku — one row each, CUST-4720 "FABRICUT"). The traverse sheets are the real ones, built from
// the live H1-2TRV pins.
//
// SPECKITS_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { choicesFromAssembly } from '../src/components/Shared/hardwareAdapter.js';
import { specPages } from '../src/components/SpecSheet/specSheetPages.js';
import { traverseNameParts, sheetName } from '../src/components/SpecSheet/specSheetNarrow.js';
import { ASSEMBLY, PINS } from './specSheetTraverse.fixture.mjs';

const K = await import(process.env.SPECKITS_MODULE || new URL('../src/components/SpecSheet/specSheetKits.js', import.meta.url).href);
const { kitsOfFamily, fabricutKitNumber, kitWantOf, kitsFor, kitName, kitLine, inchWords, projSuffix, KIT_PENDING } = K;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// [code, setup, frontRail, drive, mount, material, bracketStyle, FABRICUT clientSku] — live 2026-09-30.
const LIVE = [
    ['H1-2TRV-4/EP', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'EP', '', 'HTS7504F PREMIUM'], ['H1-2TRV-4/P', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'P', '', 'HTS7504F'],
    ['H1-2TRV-4/W', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'W', '', 'HTS7505F'],
    ['H1-2TRV-4C/EP', 'SINGLE', 'TRACK', 'MANUAL', 'CEILING', 'EP', '', 'HTS7510F PREMIUM'], ['H1-2TRV-4C/P', 'SINGLE', 'TRACK', 'MANUAL', 'CEILING', 'P', '', 'HTS7510F'],
    ['H1-2TRV-4C/W', 'SINGLE', 'TRACK', 'MANUAL', 'CEILING', 'W', '', 'HTS7511F'],
    ['H1-2TRV-4D/EP', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'EP', '', 'HTS7506F PREMIUM'], ['H1-2TRV-4D/P', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'P', '', 'HTS7506F'],
    ['H1-2TRV-4D/W', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'W', '', 'HTS7507F'],
    ['H1-2TRV-4DC/EP', 'DOUBLE', 'TRACK', 'MANUAL', 'CEILING', 'EP', '', 'HTS7512F PREMIUM'], ['H1-2TRV-4DC/P', 'DOUBLE', 'TRACK', 'MANUAL', 'CEILING', 'P', '', 'HTS7512F'],
    ['H1-2TRV-4DC/W', 'DOUBLE', 'TRACK', 'MANUAL', 'CEILING', 'W', '', 'HTS7513F'],
    ['H1-2TRV-4FRT/EP', 'DOUBLE', 'RING', 'MANUAL', 'WALL', 'EP', '', 'HTS7508F PREMIUM'], ['H1-2TRV-4FRT/P', 'DOUBLE', 'RING', 'MANUAL', 'WALL', 'P', '', 'HTS7508F'],
    ['H1-2TRV-4FRT/W', 'DOUBLE', 'RING', 'MANUAL', 'WALL', 'W', '', 'HTS7509F'],
    ['H1-2TRV-4M/EP', 'SINGLE', 'TRACK', 'MOTORIZED', 'WALL', 'EP', '', ''], ['H1-2TRV-4M/P', 'SINGLE', 'TRACK', 'MOTORIZED', 'WALL', 'P', '', ''],
    ['H1-2TRV-4M/W', 'SINGLE', 'TRACK', 'MOTORIZED', 'WALL', 'W', '', ''],
    ['H1-2TRV-4MC/EP', 'SINGLE', 'TRACK', 'MOTORIZED', 'CEILING', 'EP', '', 'HMTS7524F PREMIUM'], ['H1-2TRV-4MC/P', 'SINGLE', 'TRACK', 'MOTORIZED', 'CEILING', 'P', '', 'HMTS7524F'],
    ['H1-2TRV-4MC/W', 'SINGLE', 'TRACK', 'MOTORIZED', 'CEILING', 'W', '', 'HMTS7528F'],
    ['H1-2TRV-4MD/EP', 'DOUBLE', 'TRACK', 'MOTORIZED', 'WALL', 'EP', '', ''], ['H1-2TRV-4MD/P', 'DOUBLE', 'TRACK', 'MOTORIZED', 'WALL', 'P', '', ''],
    ['H1-2TRV-4MD/W', 'DOUBLE', 'TRACK', 'MOTORIZED', 'WALL', 'W', '', ''],
    ['H1-2TRV-4MDC/EP', 'DOUBLE', 'TRACK', 'MOTORIZED', 'CEILING', 'EP', '', 'HMTS7532F PREMIUM'], ['H1-2TRV-4MDC/P', 'DOUBLE', 'TRACK', 'MOTORIZED', 'CEILING', 'P', '', 'HMTS7532F'],
    ['H1-2TRV-4MDC/W', 'DOUBLE', 'TRACK', 'MOTORIZED', 'CEILING', 'W', '', 'HMTS7536F'],
    ['H1-2TRV-4MFRT/EP', 'DOUBLE', 'RING', 'MOTORIZED', 'WALL', 'EP', '', ''], ['H1-2TRV-4MFRT/P', 'DOUBLE', 'RING', 'MOTORIZED', 'WALL', 'P', '', ''],
    ['H1-2TRV-4MFRT/W', 'DOUBLE', 'RING', 'MOTORIZED', 'WALL', 'W', '', ''],
    ['H1-138TRV-4H/EP', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'EP', 'H', 'HTS7500F PREMIUM'], ['H1-138TRV-4H/P', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'P', 'H', 'HTS7500F'],
    ['H1-138TRV-4HD/EP', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'EP', 'H', 'HTS7502F PREMIUM'], ['H1-138TRV-4HD/P', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'P', 'H', 'HTS7502F'],
    ['H1-138TRV-4V/EP', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'EP', 'V', 'HTS7501F PREMIUM'], ['H1-138TRV-4V/P', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'P', 'V', 'HTS7501F'],
    ['H1-138TRV-4VD/EP', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'EP', 'V', 'HTS7503F PREMIUM'], ['H1-138TRV-4VD/P', 'DOUBLE', 'TRACK', 'MANUAL', 'WALL', 'P', 'V', 'HTS7503F'],
];
const kitDoc = ([code, setup, frontRail, drive, mount, material, bracketStyle, sku]) => ({
    id: `K-${code}`, legacyErpId: code, partClass: 'Kit',
    manufacturingSpecs: { kitFamily: code.startsWith('H1-138TRV') ? 'H1-138TRV' : 'H1-2TRV', kitAlign: { setup, frontRail, drive, mount, material, minFeet: 4, ...(bracketStyle ? { bracketStyle } : {}) } },
    clientPricing: [{ customerId: 'CUST-4720', customerName: 'FABRICUT', clientSku: sku }],
});
// Everything the modal hands in: the kits, plus parts that are not system kits (an item kit, a bracket).
const PARTS = [
    ...LIVE.map(kitDoc),
    { id: 'WB', legacyErpId: 'H1-2TRV-WB', partClass: 'Kit', manufacturingSpecs: { kitComponents: [{ partId: 'x', qty: 1 }] } },
    { id: 'BR', legacyErpId: 'H1-2TRV-6WB', partClass: 'Assembly', clientPricing: [{ customerName: 'FABRICUT', clientSku: 'H3644F' }] },
    { ...kitDoc(['H1-2TRV-4/P', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'P', '', 'OLD-RETIRED']), id: 'RET', manufacturingSpecs: { ...kitDoc(LIVE[1]).manufacturingSpecs, isRetired: true } },
];
const name = (answers, family = 'H1-2TRV', styles) => kitName(PARTS, kitWantOf({ family, answers, styles }));

// ── WHICH RECORDS ARE KITS ────────────────────────────────────────────────────────────────────
{
    eq('H1-2TRV has its 30 system kits — not the item kit, not the bracket, not the retired copy', kitsOfFamily(PARTS, 'H1-2TRV').length, 30);
    eq('H1-138TRV has its 8', kitsOfFamily(PARTS, 'h1-138trv').length, 8);
    const noTag = { ...kitDoc(LIVE[1]), manufacturingSpecs: { kitAlign: kitDoc(LIVE[1]).manufacturingSpecs.kitAlign } };
    eq('a kit with no family tag is read by its code', kitsOfFamily([noTag], 'H1-2TRV').length, 1);
    eq('Fabricut\'s number is the clientSku on the FABRICUT row', fabricutKitNumber(kitDoc(LIVE[1])), 'HTS7504F');
    eq('another customer\'s row is never Fabricut\'s number', fabricutKitNumber({ clientPricing: [{ customerName: 'BRIMAR', clientSku: 'B-1' }] }), '');
}

// ── H1-2TRV: THE KIT FOR THE STYLE, THE PROJECTION ADDED ─────────────────────────────────────
{
    eq('single wall, each depth: one kit, the projection added',
        [3.625, 4.625, 6].map(proj => name({ setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj })),
        ['HTS7504F - 3 5/8"P', 'HTS7504F - 4 5/8"P', 'HTS7504F - 6"P']);
    eq('track-front double (no projection asked)', name({ setup: 'DOUBLE', frontLayer: 'TRACK', drive: 'MANUAL', mount: 'WALL' }), 'HTS7506F');
    eq('rod-front double is the FRT kit', name({ setup: 'DOUBLE', frontLayer: 'FASCIA', drive: 'MANUAL', mount: 'WALL' }), 'HTS7508F');
    eq('ceiling, single and track-front double', [name({ setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING' }), name({ setup: 'DOUBLE', frontLayer: 'TRACK', drive: 'MANUAL', mount: 'CEILING' })], ['HTS7510F', 'HTS7512F']);
    eq('no kit for a rod-front ceiling double → Kit# Pending', name({ setup: 'DOUBLE', frontLayer: 'FASCIA', drive: 'MANUAL', mount: 'CEILING' }), KIT_PENDING);
    eq('a kit with no Fabricut number (motorized wall — sold per motor) → Kit# Pending', name({ setup: 'SINGLE', drive: 'MOTORIZED', mount: 'WALL' }), KIT_PENDING);
    eq('the manual drive is asked — the motorized ceiling kit never names a manual drawing', name({ setup: 'SINGLE', drive: 'MANUAL', mount: 'CEILING' }), 'HTS7510F');
    eq('the kit line lists every finish and the set length',
        kitLine(PARTS, kitWantOf({ family: 'H1-2TRV', answers: { setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj: 4.625 } })),
        'Fabricut kit HTS7504F painted · HTS7504F PREMIUM plated · HTS7505F wood — 4 ft set');
    eq('no kit → the line says so', kitLine(PARTS, kitWantOf({ family: 'H1-2TRV', answers: { setup: 'DOUBLE', frontLayer: 'FASCIA', mount: 'CEILING' } })), `Fabricut kit: ${KIT_PENDING}`);
    const woodOnly = [kitDoc(['H1-2TRV-4/W', 'SINGLE', 'TRACK', 'MANUAL', 'WALL', 'W', '', 'HTS7505F'])];
    eq('wood alone names the wood kit', kitName(woodOnly, kitWantOf({ family: 'H1-2TRV', answers: { setup: 'SINGLE', mount: 'WALL' } })), 'HTS7505F');
    eq('a family with no kits at all → Kit# Pending', name({ setup: 'SINGLE', mount: 'WALL' }, 'H2-75'), KIT_PENDING);
}

// ── H1-138TRV: ONE SHEET, TWO STYLES (H and V plates), EACH ITS OWN KIT ──────────────────────
{
    eq('single wall at 3 5/8: both styles, the projection once', name({ setup: 'SINGLE', mount: 'WALL', proj: 3.625 }, 'H1-138TRV', ['H', 'V']), 'HTS7500F (H) / HTS7501F (V) - 3 5/8"P');
    eq('the double', name({ setup: 'DOUBLE' }, 'H1-138TRV', ['H', 'V']), 'HTS7502F (H) / HTS7503F (V)');
    eq('a sheet drawing only the H plate names only the H kit', name({ setup: 'SINGLE', mount: 'WALL', proj: 6 }, 'H1-138TRV', ['H']), 'HTS7500F (H) - 6"P');
    eq('an H-only sheet\'s kit line lists the H kits only',
        kitLine(PARTS, kitWantOf({ family: 'H1-138TRV', answers: { setup: 'SINGLE', mount: 'WALL', proj: 6 }, styles: ['H'] })),
        'Fabricut kit HTS7500F (H) painted · HTS7500F PREMIUM (H) plated — 4 ft set');
    eq('the ceiling arm has no kit → Kit# Pending', name({ setup: 'SINGLE', mount: 'CEILING' }, 'H1-138TRV', []), KIT_PENDING);
    eq('its kit line, painted and plated by style',
        kitLine(PARTS, kitWantOf({ family: 'H1-138TRV', answers: { setup: 'DOUBLE' }, styles: ['H', 'V'] })),
        'Fabricut kit HTS7502F (H) painted · HTS7503F (V) painted · HTS7502F PREMIUM (H) plated · HTS7503F PREMIUM (V) plated — 4 ft set');
}

// ── THE WORDS ─────────────────────────────────────────────────────────────────────────────────
{
    eq('inches as the sheet says them', [3.625, 4.625, 6, 6.5, 0.1875, 3.25].map(inchWords), ['3 5/8', '4 5/8', '6', '6 1/2', '3/16', '3 1/4']);
    eq('the projection suffix, and none without a projection', [projSuffix(3.625), projSuffix(undefined), projSuffix(0)], [' - 3 5/8"P', '', '']);
    eq('a rod front is the kit\'s ring front; a track front is its track', [kitWantOf({ family: 'x', answers: { frontLayer: 'FASCIA' } }).frontRail, kitWantOf({ family: 'x', answers: { frontLayer: 'TRACK' } }).frontRail], ['RING', 'TRACK']);
    ok('an unstated axis is not asked (every H1-138TRV kit is manual — the sheet never says so)', kitsFor(PARTS, kitWantOf({ family: 'H1-138TRV', answers: { setup: 'DOUBLE' } })).length === 4);
}

// ── THE REAL H1-2TRV SHEETS IN THE DROPDOWN, FABRICUT EDITION ────────────────────────────────
{
    const CODE = { 'CE-ASM-64480': 'H1-2TRV-WB', 'CE-ASM-64482': 'H1-2TRV-EWB', 'CE-ASM-64484': 'H1-2TRV-6WB', 'CE-ASM-64486': 'H1-2TRV-DWB', 'CE-ASM-64669': 'H1-2TRV-DRTWB',
        'CE-ASM-64472': 'H1-2TRVSRA', 'CE-ASM-64474': 'H1-2TRVERA', 'CE-ASM-64476': 'H1-2TRV6RA', 'CE-ASM-64478': 'H1-2TRVDRA', 'CE-INV-52988': 'H1-2TRV' };
    const code = (c) => CODE[c?.partId] || c?.partId;
    const armOf = (d) => code(d.kind === 'RETURN' ? d.end : d.bracket);
    // As the modal asks it: a wall / ceiling bracket drawing belongs to the kit family of the track it carries.
    const kitWant = (d) => {
        if (d.kind !== 'BRACKET' && d.kind !== 'CEILING') return null;
        const track = d.groups['TRACK/FRONT'] || d.groups['TRACK/BACK'];
        return track ? kitWantOf({ family: code(track.choices[0]), answers: d.answers }) : null;
    };
    const FAB = { 'H1-2TRVSRA': 'H3634F', 'H1-2TRVERA': 'H3636F' };
    const sheets = specPages({ choices: choicesFromAssembly(ASSEMBLY, PINS) }).filter(p => p.kind === 'TRAVERSE')
        .map(p => ({ key: p.key, nameParts: traverseNameParts(p.drawings, armOf, kitWant) }));
    const kitOf = (w) => kitName(PARTS, w);
    eq('every traverse sheet, as Fabricut reads it: the kit for the brackets, their own numbers for the ends',
        sheets.map(p => sheetName(p, (c) => FAB[c] || null, kitOf)), [
            'HTS7504F - 3 5/8"P (single · wall) + HTS7504F - 4 5/8"P (single · wall)',
            'HTS7504F - 6"P (single · wall) + HTS7506F (double · track front · wall)',
            'HTS7508F (double · rod front · wall)',
            'HTS7510F (single · ceiling) + HTS7512F (double · track front · ceiling)',
            'Kit# Pending (double · rod front · ceiling)',
            'H3634F (single · wall · 3.625") + H3636F (single · wall · 4.625")',
            'H1-2TRV6RA (single · wall · 6") + H1-2TRVDRA (double · track front · wall)',
            'H1-2TRVMTR (single · wall · 3.625") + H1-2TRVMTR (single · wall · 4.625")',
            'H1-2TRVMTR (single · wall · 6") + H1-2TRVMTR (double · track front · wall)',
        ]);
    eq('without the kit lookup (H1 codes, Customer #s) the same sheets read by their parts, as before',
        sheetName(sheets[1]), 'H1-2TRV-6WB (single · wall · 6") + H1-2TRV-DWB (double · track front · wall)');
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
