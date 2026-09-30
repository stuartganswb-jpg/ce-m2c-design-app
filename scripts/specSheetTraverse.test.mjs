// The traverse sheets — which drawings exist, and what each one draws.
//   node scripts/specSheetTraverse.test.mjs
//
// Asked of the live H1-2TRV pins (2026-09-29, prod shape). Every assertion is one of the rules Stuart set on
// the drafts that day: two per sheet, wall brackets → ceiling → end arms → miters → the track-ends sheet; the
// drive is a note, never its own drawing; a rod front carries rings and no front track; a double's rear track
// and its ends are drawn; an end arm (a part) and a miter (a fee) are told apart by the fee, not the tag.
//
// SPECTRAV_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { choicesFromAssembly } from '../src/components/Shared/hardwareAdapter.js';
import { resolve } from '../src/components/Shared/hardwareModel.js';
import { specPages, auditPages, narrowings } from '../src/components/SpecSheet/specSheetPages.js';
import { ASSEMBLY, PINS } from './specSheetTraverse.fixture.mjs';

const T = await import(process.env.SPECTRAV_MODULE || new URL('../src/components/SpecSheet/specSheetTraverse.js', import.meta.url).href);

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// Library ids → codes (read 2026-09-29), so the assertions read like the sheet.
const CODE = {
    'CE-ASM-64480': 'H1-2TRV-WB', 'CE-ASM-64482': 'H1-2TRV-EWB', 'CE-ASM-64484': 'H1-2TRV-6WB', 'CE-ASM-64486': 'H1-2TRV-DWB',
    'CE-ASM-64669': 'H1-2TRV-DRTWB', 'CE-INV-52988': 'H1-2TRV', 'CE-INV-57902': 'H1-2TRVPLUG', 'CE-INV-48935': 'HSOM-04',
    'CE-INV-52994': 'HTSLNTCAR', 'CE-ASM-64472': 'H1-2TRVSRA', 'CE-ASM-64474': 'H1-2TRVERA', 'CE-ASM-64476': 'H1-2TRV6RA',
    'CE-ASM-64478': 'H1-2TRVDRA', 'H1-2TRVMTR': 'H1-2TRVMTR',
};
const code = (c) => (c ? CODE[c.partId] || c.partId : null);

const CHOICES = choicesFromAssembly(ASSEMBLY, PINS);
const all = specPages({ choices: CHOICES });
// Built through the module under test (so a mutant is what gets judged), from the same leaves specPages walks.
const leaves = narrowings(resolve({ choices: CHOICES }).choices).filter(l => T.isTrackLeaf(resolve({ choices: CHOICES, answers: l }), l));
const sheets = T.traverseSheets({ choices: CHOICES, leaves });
const drawings = sheets.flatMap(p => p.drawings.map(d => ({ ...d, group: p.group })));
const byBracket = (partCode, kind = 'BRACKET') => drawings.find(d => d.kind === kind && code(d.bracket) === partCode);
const groupCodes = (d, key) => [...new Set((d?.groups?.[key]?.choices || []).map(code))];

// ── WHICH LEAVES THESE SHEETS TAKE ───────────────────────────────────────────────────────────
{
    const trvLeaf = { rodKind: 'TRAVERSE', setup: 'SINGLE', drive: 'MANUAL', mount: 'WALL', proj: 3.625 };
    ok('a traverse leaf that carries a track is a traverse sheet', T.isTrackLeaf(resolve({ choices: CHOICES, answers: trvLeaf }), trvLeaf));
    const solid = { rodKind: 'SOLID', proj: 3.625 };
    ok('a solid leaf is not', !T.isTrackLeaf(resolve({ choices: CHOICES, answers: solid }), solid));
    const noTrack = CHOICES.filter(c => c.role !== 'TRACK');
    ok('a traverse world with no track (H1-138\'s integrated pole) keeps the page it had', !T.isTrackLeaf(resolve({ choices: noTrack, answers: trvLeaf }), trvLeaf));
    ok('no traverse sheet is ever a solid leaf', sheets.every(p => p.drawings.every(d => d.answers.rodKind === 'TRAVERSE')));
}

// ── THE SHEETS, IN ORDER, TWO PER SHEET ──────────────────────────────────────────────────────
{
    eq('specPages carries exactly these sheets, in this order', all.filter(p => p.kind === 'TRAVERSE' || p.kind === 'TRAVERSE_ENDS').map(p => p.key), sheets.map(p => p.key));
    eq('the order: wall brackets → ceiling → end arms → miters → the track ends', [...new Set(sheets.map(p => p.group))], ['BRACKET', 'CEILING', 'ARM', 'MITER', 'ENDS']);
    ok('never more than two drawings to a sheet', sheets.every(p => p.drawings.length >= 1 && p.drawings.length <= 2));
    eq('the wall brackets, singles by depth then the doubles (track front first)',
        drawings.filter(d => d.kind === 'BRACKET').map(d => code(d.bracket)), ['H1-2TRV-WB', 'H1-2TRV-EWB', 'H1-2TRV-6WB', 'H1-2TRV-DWB', 'H1-2TRV-DRTWB']);
    ok('the drive is a note: no drawing but the ends sheet is motorized', drawings.every(d => d.group === 'ENDS' || d.drive === 'MANUAL'));
    ok('the track-ends sheet is last', sheets[sheets.length - 1].kind === 'TRAVERSE_ENDS');
}

// ── A SINGLE: the fascia, one track, its carriers and its ends ───────────────────────────────
{
    const d = byBracket('H1-2TRV-WB');
    eq('single: one track, at the front', [groupCodes(d, 'TRACK/FRONT'), !!d.groups['TRACK/BACK']], [['H1-2TRV'], false]);
    eq('single: the carriers ride it', groupCodes(d, 'CARRIER/FRONT'), ['HTSLNTCAR']);
    eq('single: the drive named the end — the manual plug', groupCodes(d, 'TRV_END/FRONT'), ['H1-2TRVPLUG']);
    ok('single: a fascia, no rings', !!d.groups['FASCIA/FRONT'] && d.rings.length === 0 && !d.rodFront);
}

// ── THE DOUBLES ───────────────────────────────────────────────────────────────────────────────
{
    const dwb = byBracket('H1-2TRV-DWB');
    eq('track-front double: both tracks', [groupCodes(dwb, 'TRACK/FRONT'), groupCodes(dwb, 'TRACK/BACK')], [['H1-2TRV'], ['H1-2TRV']]);
    eq('track-front double: ends on both tracks (the #44/#45 fix)', [groupCodes(dwb, 'TRV_END/FRONT'), groupCodes(dwb, 'TRV_END/BACK')], [['H1-2TRVPLUG'], ['H1-2TRVPLUG']]);
    ok('track-front double: no rings', dwb.rings.length === 0);
    ok('track-front double: the rear is placed from the tag', dwb.projTiers && Number(dwb.projTiers.BACK) === 3.25);

    const rod = byBracket('H1-2TRV-DRTWB');
    ok('rod-front double: a rod front', rod.rodFront === true);
    eq('rod-front double: every ring option is drawn', rod.rings.map(r => code(r.choice)).length, 2);
    ok('rod-front double: no front track behind the stationary rod', !rod.groups['TRACK/FRONT']);
    eq('rod-front double: the rear track, its ends and its carriers', [groupCodes(rod, 'TRACK/BACK'), groupCodes(rod, 'TRV_END/BACK'), groupCodes(rod, 'CARRIER/BACK')], [['H1-2TRV'], ['H1-2TRVPLUG'], ['HTSLNTCAR']]);
    ok('rod-front double: the F-clip stays (the passing brackets attach with it)', !!rod.groups.FCLIP);
}

// ── THE CEILING BRACKET ───────────────────────────────────────────────────────────────────────
{
    const ceil = drawings.filter(d => d.kind === 'CEILING');
    ok('the ceiling bracket is drawn single and double', ceil.some(d => d.answers.setup === 'SINGLE') && ceil.some(d => d.answers.setup === 'DOUBLE'));
    ok('every ceiling drawing is the ceiling mount', ceil.every(d => d.answers.mount === 'CEILING'));
}

// ── END ARM OR MITER: THE FEE DECIDES ─────────────────────────────────────────────────────────
{
    const arms = drawings.filter(d => d.group === 'ARM'), miters = drawings.filter(d => d.group === 'MITER');
    eq('the end arms (parts), singles by depth then the double', arms.map(d => code(d.end)), ['H1-2TRVSRA', 'H1-2TRVERA', 'H1-2TRV6RA', 'H1-2TRVDRA']);
    ok('an end arm is not a miter — the fascia is cut straight into it', arms.every(d => d.isMiter === false));
    eq('the miters (a fee) at each depth and the double', miters.length, 4);
    ok('a miter is a miter — the fascia is mitred', miters.every(d => d.isMiter === true && code(d.end) === 'H1-2TRVMTR'));
    ok('the end on its drawing is the one chosen', arms.every(d => groupCodes(d, 'RETURN').includes(code(d.end))));
}

// ── THE TRACK ENDS, FROM BELOW ────────────────────────────────────────────────────────────────
{
    const ends = sheets.find(p => p.kind === 'TRAVERSE_ENDS');
    eq('manual beside motorized', ends.drawings.map(d => d.drive), ['MANUAL', 'MOTORIZED']);
    eq('the plug, then the Somfy drive', ends.drawings.map(d => groupCodes(d, 'TRV_END/FRONT')), [['H1-2TRVPLUG'], ['HSOM-04']]);
}

// ── THE AUDIT: CLEAN ON WHAT THE ENGINE BUILT, AND EACH FAULT NAMED ──────────────────────────
{
    eq('the set the engine built audits clean', auditPages(all, CHOICES), []);
    eq('and the traverse audit on its own finds nothing', T.auditTraverse(sheets, null), []);
    const dwbSheet = sheets.find(p => p.drawings.some(d => code(d.bracket) === 'H1-2TRV-DWB' && d.kind === 'BRACKET'));
    const i = dwbSheet.drawings.findIndex(d => code(d.bracket) === 'H1-2TRV-DWB');
    const swap = (patch) => [{ ...dwbSheet, drawings: dwbSheet.drawings.map((d, k) => (k === i ? { ...d, ...patch(d) } : d)) }];
    const ring = byBracket('H1-2TRV-DRTWB').rings[0];
    ok('rings on a track-front drawing are caught', T.auditTraverse(swap(() => ({ rings: [ring] })), null).some(v => /stationary rod/.test(v.why)));
    ok('a track with no carriers is caught', T.auditTraverse(swap(d => ({ groups: Object.fromEntries(Object.entries(d.groups).filter(([k]) => !k.startsWith('CARRIER'))) })), null).some(v => /no carriers/.test(v.why)));
    ok('a drawing with no track is caught', T.auditTraverse(swap(d => ({ groups: Object.fromEntries(Object.entries(d.groups).filter(([k]) => !k.startsWith('TRACK'))) })), null).some(v => /no track/.test(v.why)));
    ok('a front track behind a rod front is caught', T.auditTraverse(swap(d => ({ answers: { ...d.answers, frontLayer: 'FASCIA' } })), null).some(v => /front track behind/.test(v.why)));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
