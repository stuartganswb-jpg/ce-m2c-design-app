// The 📐 pickers — choosing your way to a sheet with the CPQ's own questions.
//   node scripts/specSheetNarrow.test.mjs
//
// Stuart 2026-09-30 ("go with 1" · "go ahead"): the solid sheets carry their CPQ answers, the questions
// are asked in the CPQ's order (each once the one above is answered), "Bracket arm" is always there,
// and a sheet that draws two things answers per drawing. The solid pages below are shaped exactly as the
// live leaves read on 2026-09-29: H1-2TRV solid = {rodKind, proj}; H1-138 doubles = {rodKind, setup},
// ceiling + inside mount = {rodKind, setup, mount}, singles = all four; H1-75 = no rodKind at all. The
// traverse sheets are the real ones, built from the live H1-2TRV pins.
//
// SPECNARROW_MODULE=<path> runs the same assertions against a mutated copy (mutation check).

import { choicesFromAssembly } from '../src/components/Shared/hardwareAdapter.js';
import { specPages } from '../src/components/SpecSheet/specSheetPages.js';
import { ASSEMBLY, PINS } from './specSheetTraverse.fixture.mjs';

const N = await import(process.env.SPECNARROW_MODULE || new URL('../src/components/SpecSheet/specSheetNarrow.js', import.meta.url).href);
const { NARROW, narrowPages, pageFacts, traverseFacts } = N;

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// A sheet as the modal builds it: its key, and one fact set per thing it draws.
const solid = (key, answers, arm = key) => ({ key, facts: pageFacts(answers, arm) });
const twoBasics = (a, b) => ({ key: `${a.key}+${b.key}`, facts: [...a.facts, ...b.facts] });
const asked = (pages, narrow) => narrowPages(pages, narrow).steps.map(s => s.key);
const valuesOf = (pages, narrow, key) => narrowPages(pages, narrow).steps.find(s => s.key === key)?.values || null;
const keysOf = (pages, narrow) => narrowPages(pages, narrow).pages.map(p => p.key);

// The real traverse sheets (H1-2TRV live pins), filed under each drawing's arm.
const TRV = specPages({ choices: choicesFromAssembly(ASSEMBLY, PINS) })
    .filter(p => p.kind === 'TRAVERSE')
    .map(p => ({ key: p.key, facts: traverseFacts(p.drawings, d => (d.kind === 'RETURN' ? d.end : d.bracket)?.partId) }));

// ── H1-2TRV: two worlds, and the solid world never asks setup or mount ───────────────────────
const H12 = [
    ...[3.625, 4.625, 6].flatMap(proj => ['SPA', 'CB', 'SRA'].map(a => solid(`H1-2RCT${a}@${proj}`, { rodKind: 'SOLID', proj }, `H1-2RCT${a}`))),
    ...TRV,
];
{
    eq('H1-2TRV: untouched, the first question is the rod world — and the arm is always there', asked(H12, {}), ['rodKind', '__arm']);
    eq('H1-2TRV: rod world offers both', valuesOf(H12, {}, 'rodKind'), ['SOLID', 'TRAVERSE']);
    eq('H1-2TRV: Solid → projection is next; setup and mount are never asked of the solid world', asked(H12, { rodKind: 'SOLID' }), ['rodKind', 'proj', '__arm']);
    eq('H1-2TRV: Solid keeps every solid sheet', keysOf(H12, { rodKind: 'SOLID' }).length, 9);
    eq('H1-2TRV: Solid → 4.625 keeps that depth\'s three', keysOf(H12, { rodKind: 'SOLID', proj: '4.625' }), ['H1-2RCTSPA@4.625', 'H1-2RCTCB@4.625', 'H1-2RCTSRA@4.625']);
    eq('H1-2TRV: Traverse asks setup next', asked(H12, { rodKind: 'TRAVERSE' }), ['rodKind', 'setup', '__arm']);
    ok('H1-2TRV: Traverse keeps only traverse sheets, all of them', keysOf(H12, { rodKind: 'TRAVERSE' }).length === TRV.length && keysOf(H12, { rodKind: 'TRAVERSE' }).every(k => k.startsWith('TRV')));
    // THE 09-29 DEFECT: "Setup: SINGLE" with the rod world unanswered emptied the solid world.
    eq('H1-2TRV: setup is not offered before the rod world is answered', valuesOf(H12, {}, 'setup'), null);
    eq('H1-2TRV: a setup pick with the rod world unanswered drops nothing', keysOf(H12, { setup: 'SINGLE' }).length, H12.length);
    eq('H1-2TRV: nor does a mount pick', keysOf(H12, { mount: 'WALL' }).length, H12.length);
}

// ── A SHEET THAT DRAWS TWO THINGS ANSWERS PER DRAWING ────────────────────────────────────────
{
    // The live sheet that pairs the 6" single wall bracket with the track-front double.
    const pair = TRV.find(p => p.facts.some(f => f.setup === 'SINGLE' && Number(f.proj) === 6) && p.facts.some(f => f.setup === 'DOUBLE'));
    ok('the 6WB + DWB sheet is in the fixture', !!pair);
    ok('it shows for a single 6" wall bracket (its first drawing)', keysOf(H12, { rodKind: 'TRAVERSE', setup: 'SINGLE', mount: 'WALL', proj: '6' }).includes(pair?.key));
    ok('and for a track-front double (its second)', keysOf(H12, { rodKind: 'TRAVERSE', setup: 'DOUBLE', frontLayer: 'TRACK', mount: 'WALL' }).includes(pair?.key));
    const wbEwb = TRV.find(p => p.facts.some(f => Number(f.proj) === 3.625) && p.facts.some(f => Number(f.proj) === 4.625));
    ok('the WB + EWB sheet shows for 4.625 (its second drawing — the sheet label says 3.625)', keysOf(H12, { rodKind: 'TRAVERSE', setup: 'SINGLE', mount: 'WALL', proj: '4.625' }).includes(wbEwb?.key));
    // Never one drawing's setup with the other's mount.
    const mixed = { key: 'MIXED', facts: [{ setup: 'DOUBLE', mount: 'WALL', __arm: 'D' }, { setup: 'SINGLE', mount: 'CEILING', __arm: 'S' }] };
    const real = { key: 'REAL', facts: [{ setup: 'DOUBLE', mount: 'CEILING', __arm: 'DC' }] };
    eq('a double-ceiling pick never matches a sheet whose double is wall and whose ceiling is single', keysOf([mixed, real], { setup: 'DOUBLE', mount: 'CEILING' }), ['REAL']);
}

// ── H1-138: doubles never ask mount or projection; ceiling never asks projection ─────────────
const BD = solid('H1-138BD', { rodKind: 'SOLID', setup: 'DOUBLE' });
const B6 = solid('H1-138B6', { rodKind: 'SOLID', setup: 'SINGLE', mount: 'WALL', proj: 6 });
const H138 = [
    solid('H1-138D', { rodKind: 'SOLID', setup: 'DOUBLE' }),
    twoBasics(BD, B6),
    solid('H1-138CB', { rodKind: 'SOLID', setup: 'SINGLE', mount: 'CEILING' }),
    solid('H1-138IM', { rodKind: 'SOLID', setup: 'SINGLE', mount: 'CEILING' }),
    ...[3.625, 4.625, 6].map(proj => solid(`H1-138DS@${proj}`, { rodKind: 'SOLID', setup: 'SINGLE', mount: 'WALL', proj }, 'H1-138DS')),
    solid('H1-138TRVDBA', { rodKind: 'TRAVERSE', setup: 'DOUBLE' }),
    solid('H1-138TRV@3.625', { rodKind: 'TRAVERSE', setup: 'SINGLE', mount: 'WALL', proj: 3.625 }, 'H1-138TRVSA'),
];
{
    eq('H1-138: rod → setup → mount → projection, in the CPQ\'s order', [
        asked(H138, {}), asked(H138, { rodKind: 'SOLID' }), asked(H138, { rodKind: 'SOLID', setup: 'SINGLE' }), asked(H138, { rodKind: 'SOLID', setup: 'SINGLE', mount: 'WALL' }),
    ], [['rodKind', '__arm'], ['rodKind', 'setup', '__arm'], ['rodKind', 'setup', 'mount', '__arm'], ['rodKind', 'setup', 'mount', 'proj', '__arm']]);
    eq('H1-138: a double asks nothing more — and every double is there, the two-basics sheet too', [asked(H138, { rodKind: 'SOLID', setup: 'DOUBLE' }), keysOf(H138, { rodKind: 'SOLID', setup: 'DOUBLE' })],
        [['rodKind', 'setup', '__arm'], ['H1-138D', 'H1-138BD+H1-138B6']]);
    eq('H1-138: the two-basics sheet also shows for its single (6" wall)', keysOf(H138, { rodKind: 'SOLID', setup: 'SINGLE', mount: 'WALL', proj: '6' }), ['H1-138BD+H1-138B6', 'H1-138DS@6']);
    eq('H1-138: ceiling asks no projection, and the inside mount sits with it (as the engine files it)', [asked(H138, { rodKind: 'SOLID', setup: 'SINGLE', mount: 'CEILING' }), keysOf(H138, { rodKind: 'SOLID', setup: 'SINGLE', mount: 'CEILING' })],
        [['rodKind', 'setup', 'mount', '__arm'], ['H1-138CB', 'H1-138IM']]);
    eq('H1-138: a mount pick with setup unanswered drops nothing (the doubles are wall too)', keysOf(H138, { rodKind: 'SOLID', mount: 'WALL' }).length, 7);
}

// ── BRACKET ARM: ALWAYS THERE, NAMES EVERY SHEET ─────────────────────────────────────────────
{
    ok('the arm list is offered with nothing answered', (valuesOf(H138, {}, '__arm') || []).length > 1);
    eq('picking an arm alone finds its sheets', keysOf(H138, { __arm: 'H1-138DS' }), ['H1-138DS@3.625', 'H1-138DS@4.625', 'H1-138DS@6']);
    eq('the second arm on a two-basics sheet finds that sheet', keysOf(H138, { __arm: 'H1-138B6' }), ['H1-138BD+H1-138B6']);
    ok('the arm list narrows with the answers above it', !(valuesOf(H138, { rodKind: 'TRAVERSE' }, '__arm') || []).includes('H1-138DS'));
    eq('the pickers come in the CPQ\'s order, arm last', NARROW.map(a => a.key), ['rodKind', 'setup', 'frontLayer', 'drive', 'mount', 'proj', '__arm']);
}

// ── H1-75: no rod world — setup is the first question ────────────────────────────────────────
const H75 = [
    solid('H1-75D', { setup: 'DOUBLE', mount: 'WALL' }), solid('H1-75CB', { setup: 'DOUBLE', mount: 'CEILING' }),
    ...[3.625, 6].map(proj => solid(`H1-75DS@${proj}`, { setup: 'SINGLE', mount: 'WALL', proj }, 'H1-75DS')),
    solid('H1-75PS@6', { setup: 'SINGLE', mount: 'WALL', proj: 6 }, 'H1-75PS'),
];
eq('H1-75: setup first (no rod question), then mount for doubles, projection for singles',
    [asked(H75, {}), asked(H75, { setup: 'DOUBLE' }), asked(H75, { setup: 'SINGLE' })],
    [['setup', '__arm'], ['setup', 'mount', '__arm'], ['setup', 'proj', '__arm']]);

// ── EVERY PATH: every sheet reachable, and nothing asked of a sheet that never had the question ─
function walk(pages) {
    const reached = new Set(); const gaps = [];
    const go = (narrow) => {
        const { steps, pages: shown } = narrowPages(pages, narrow);
        const next = steps.find(s => !s.always && narrow[s.key] === undefined);
        if (!next) { shown.forEach(p => reached.add(p.key)); return; }
        const blank = shown.filter(p => !p.facts.some(f => f[next.key] !== undefined && f[next.key] !== null && f[next.key] !== ''));
        if (blank.length) gaps.push(`${JSON.stringify(narrow)} asks ${next.key}: ${blank.map(p => p.key).join(', ')}`);
        next.values.forEach(v => go({ ...narrow, [next.key]: String(v) }));
    };
    go({});
    return { unreached: pages.filter(p => !reached.has(p.key)).map(p => p.key), gaps };
}
for (const [name, pages] of [['H1-2TRV', H12], ['H1-138', H138], ['H1-75', H75]]) {
    eq(`${name}: every sheet is reached by answering every question, and no question lands on a sheet without it`, walk(pages), { unreached: [], gaps: [] });
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
