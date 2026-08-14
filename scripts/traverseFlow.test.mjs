// Node tests for the forked traverse generator, built from Stuart's real 1.6 tag dump (H1-2TRV,
// 2026-08-04). App Check blocks any script from reaching Firestore and the app is behind a PIN
// gate, so a pure-module test on the real tag shapes is the only verification available.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTraverseFlow, isTraverseAssembly, projectionsOffered } from './traverseFlow.mjs';
// Node lists are joined by Shared/nodeList (pipe-delimited since c9e3755, comma-safe) — tests
// assert through its splitter rather than a hardcoded separator, so a delimiter change never
// breaks them again.
import { splitNodes } from './nodeList.mjs';

// ── Fixture: his tag dump, in post-groupPlacements option shape ──────────────────────────────────
const opt = (o) => ({ price: 0, position: '', targetNode: `N-${o.optId}`, ...o });

// POLE clusters. The fascia is pinned TWICE — SHORT-ROD-CENTER and NEW-SLOT-POLE-CENTER — which is
// what used to leak into the pole path and emit the phantom steps.
const pole = [
    opt({ optId: 'F-WR-A', partId: 'p-wr', partName: 'H1-2RCTWR', position: 'CENTER', traverseRole: 'FASCIA' }),
    opt({ optId: 'F-AR-A', partId: 'p-ar', partName: 'H1-2RCTAR', position: 'CENTER', traverseRole: 'FASCIA' }),
    opt({ optId: 'F-AR-B', partId: 'p-ar', partName: 'H1-2RCTAR', position: 'CENTER', traverseRole: 'FASCIA' }),
    opt({ optId: 'F-WR-B', partId: 'p-wr', partName: 'H1-2RCTWR', position: 'CENTER', traverseRole: 'FASCIA' }),
    opt({ optId: 'CLP', partId: 'p-clp', partName: 'H1-2TRVCLP', position: 'CENTER', traverseRole: 'FCLIP' }),
];

// BRACKET clusters: one double (proj any) + three single projections, per position — plus the
// duplicate NEW-SLOT bracket pins.
const bkt = (pos, sfx) => [
    opt({ optId: `B-DBL-${sfx}`, partId: 'p-bdbl', partName: 'H1-2TRV-DRTWB', position: pos, trvSetup: 'DOUBLE' }),
    opt({ optId: `B-TB-${sfx}`, partId: 'p-btb', partName: 'H1-2TRV-WB', position: pos, trvSetup: 'SINGLE', projInches: '3.625' }),
    opt({ optId: `B-BE-${sfx}`, partId: 'p-bbe', partName: 'H1-2TRV-EWB', position: pos, trvSetup: 'SINGLE', projInches: '4.625' }),
    opt({ optId: `B-B6-${sfx}`, partId: 'p-bb6', partName: 'H1-2TRV-6WB', position: pos, trvSetup: 'SINGLE', projInches: '6.00' }),
    opt({ optId: `B-DUP-${sfx}`, partId: 'p-btb', partName: 'H1-2TRV-WB', position: pos, trvSetup: 'SINGLE', projInches: '3.625' }),
];
const brackets = [...bkt('LEFT', 'L'), ...bkt('CENTER', 'C'), ...bkt('RIGHT', 'R')];

// FINIAL clusters: return arms + miter returns, plus the plugs/pulleys the designer dropped into a
// FINIAL slot. Once those are tagged trv:end they must LEAVE the End Treatment picker.
const finial = [
    opt({ optId: 'RA-L', partId: 'p-ra', partName: 'H1-2TRVSRA', position: 'LEFT', trvSetup: 'SINGLE', projInches: '3.625' }),
    opt({ optId: 'RAD-L', partId: 'p-rad', partName: 'H1-2TRVRAD', position: 'LEFT', trvSetup: 'DOUBLE' }),
    opt({ optId: 'MTR-L', partId: 'p-mtr', partName: 'H1-2TRVMTR', position: 'LEFT', trvSetup: 'SINGLE', projInches: '4.625', endTreatment: 'MITER_RETURN' }),
    opt({ optId: 'RA-R', partId: 'p-ra', partName: 'H1-2TRVSRA', position: 'RIGHT', trvSetup: 'SINGLE', projInches: '3.625' }),
    // The plug and the pulley are each pinned at BOTH ends — manual gets two plugs, motorised two
    // pulleys. That is the either/or the Drive step has to collapse into one question.
    opt({ optId: 'PLUG-L', partId: 'p-plug', partName: 'H1-2TRVPLUG', position: 'LEFT', traverseRole: 'TRV_END', driveType: 'MANUAL' }),
    opt({ optId: 'PLUG-R', partId: 'p-plug', partName: 'H1-2TRVPLUG', position: 'RIGHT', traverseRole: 'TRV_END', driveType: 'MANUAL' }),
    opt({ optId: 'PULL-L', partId: 'p-pull', partName: 'HSOM-04', position: 'LEFT', traverseRole: 'TRV_END', driveType: 'MOTORIZED' }),
    opt({ optId: 'PULL-R', partId: 'p-pull', partName: 'HSOM-04', position: 'RIGHT', traverseRole: 'TRV_END', driveType: 'MOTORIZED' }),
];

// OTHER clusters — the pool nothing used to read. Both tracks and the carriers live here.
const other = [
    opt({ optId: 'TRK-S', partId: 'p-trk', partName: 'H1-2TRVTRK/C', position: 'CENTER', traverseRole: 'TRACK', trvSetup: 'SINGLE' }),
    opt({ optId: 'TRK-D', partId: 'p-trk', partName: 'H1-2TRVTRK/C', position: '', traverseRole: 'TRACK', trvSetup: 'DOUBLE' }),
    opt({ optId: 'CAR-1', partId: 'p-car', partName: 'HTSLNTCAR', position: '', traverseRole: 'CARRIER' }),
    opt({ optId: 'CAR-2', partId: 'p-car', partName: 'HTSLNTCAR', position: 'CENTER', traverseRole: 'CARRIER' }),
];

const rings = [opt({ optId: 'RING', partId: 'p-ring', partName: 'H1-2RCTPR', position: 'SHARED' })];

function run(over = {}) {
    const steps = [];
    const seen = { endTreatment: null, perPosition: [] };
    const add = (s) => steps.push({ id: `S${steps.length + 1}`, ...s });
    const geom = (o) => Object.fromEntries((o || []).filter(x => x.targetNode).map(x => [x.optId, x.targetNode]));
    const ctx = {
        pole, finial, brackets, backplates: [], rings, other,
        add, geom, takeIncluded: () => null,
        addEndTreatment: (opts) => { seen.endTreatment = opts; add({ title: 'Left End Treatment', styleOptions: opts }); },
        addPerPosition: (opts, base) => { seen.perPosition.push({ opts, base }); add({ title: `Bracket & Mount`, styleOptions: opts }); },
        bay: { calc: 'STRAIGHT', qtyHelper: 'ft', poleTitle: 'Rod Length & Finish' },
        singleMode: true, sizeFamily: null,
        ...over,
    };
    return { steps, seen, out: buildTraverseFlow(ctx) };
}

const titles = (steps) => steps.map(s => s.title);

test('an assembly with any trv: tag is a traverse assembly', () => {
    assert.equal(isTraverseAssembly([...pole, ...other]), true);
    assert.equal(isTraverseAssembly([opt({ optId: 'x', partId: 'p' })]), false);
});

test('NO pole steps are emitted — the phantom pair is gone by construction', () => {
    const { steps } = run();
    const t = titles(steps);
    assert.equal(t.includes('Pole / Rod Material'), false);
    assert.equal(t.some(x => /^Rod Length/.test(x)), false);
});

test('step order matches the flow Stuart described', () => {
    const { steps } = run();
    assert.deepEqual(titles(steps), [
        'Fascia Material',
        'Fascia Length',
        'Single or Double',
        'Traverse Drive',
        'Bracket Projection',
        'Track',
        'Left End Treatment',
        'Bracket & Mount',
        'Splice',
        'Cut / Splice Fee',
    ]);
});

test('one material, listed once — the four fascia pins dedupe to two, keeping every node', () => {
    const { steps } = run();
    const fascia = steps.find(s => s.title === 'Fascia Material');
    assert.equal(fascia.styleOptions.length, 2);
    // both copies' geometry survives the merge — dropping one is what made the fascia vanish
    const ar = fascia.styleOptions.find(o => o.partName === 'H1-2RCTAR');
    assert.deepEqual(splitNodes(ar.targetNode).sort(), ['N-F-AR-A', 'N-F-AR-B']);
});

test('the Track step exists — proving the OTHER pool now reaches the generator', () => {
    const { steps } = run();
    const track = steps.find(s => s.title === 'Track');
    assert.ok(track, 'no Track step');
    assert.equal(track.stepRole, 'TRACK');
    // ONE track to choose. The double's second track is not an alternative to the first, so it is
    // never offered as one — asking the customer to pick between a thing and itself.
    assert.equal(track.styleOptions.length, 1);
});

test('SINGLE is the default — the standard build, not the one that happens to carry geometry', () => {
    const { steps } = run();
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    assert.equal(setup.defaultOptId, 'OPT-SETUP-SINGLE');
    // and SINGLE genuinely has no geometry, which is exactly why the seeder needed telling
    assert.equal(setup.styleOptions.find(o => o.trvSetup === 'SINGLE').targetNode, '');
});

test('the base track survives BOTH setups — it is never filtered out of its own picker', async () => {
    const { setupAllows } = await import('./traverseTags.mjs');
    const base = other.find(o => o.optId === 'TRK-S');   // tagged setup: single
    assert.equal(setupAllows(base, 'SINGLE'), true);
    // a double HAS the base track too. Filtering it here emptied the one-option Track picker the
    // moment DOUBLE was chosen, and the front track vanished.
    assert.equal(setupAllows(base, 'DOUBLE'), true);
    // brackets are still filtered normally — the exemption is by ROLE, not blanket
    const dblBracket = brackets.find(o => o.trvSetup === 'DOUBLE');
    assert.equal(setupAllows(dblBracket, 'SINGLE'), false);
});

test('a DOUBLE pin on the SAME mesh as the base track adds nothing — it never hides the single', () => {
    // the duplicate-pinning pattern: both track pins pointing at one mesh. Left alone, the AND
    // across steps would hide the only track whenever SINGLE was chosen.
    const sameMesh = other.map(o => o.optId === 'TRK-D' ? { ...o, targetNode: 'N-TRK-S' } : o);
    const { steps } = run({ other: sameMesh });
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    assert.deepEqual(setup.geometryMap, {});
    assert.equal(setup.styleOptions.find(o => o.trvSetup === 'DOUBLE').targetNode, '');
    // the base track is still offered and still owns its mesh (alongside its own ends)
    assert.ok(splitNodes(steps.find(s => s.title === 'Track').geometryMap['TRK-S']).includes('N-TRK-S'));
});

test('DOUBLE ADDS the second track — it does not swap for it', () => {
    const { steps } = run();
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    const dbl = setup.styleOptions.find(o => o.trvSetup === 'DOUBLE');
    const single = setup.styleOptions.find(o => o.trvSetup === 'SINGLE');
    // the DOUBLE answer owns the extra track's geometry and bills its part
    assert.equal(dbl.targetNode, 'N-TRK-D');
    assert.equal(dbl.partId, 'p-trk');
    assert.equal(setup.geometryMap['OPT-SETUP-DOUBLE'], 'N-TRK-D');
    // SINGLE adds nothing — it is the base configuration, not a variant
    assert.equal(single.targetNode, '');
    assert.equal(single.partId, '');
});

test('the REAR track\'s ends ride the DOUBLE answer too — no rear pulley on a single', () => {
    // his rear-end pins, tagged setup:double so they belong to the second track
    const withRearEnds = [
        ...other,
        opt({ optId: 'PULL-RD', partId: 'p-pull', partName: 'HSOM-04', traverseRole: 'TRV_END', driveType: 'MOTORIZED', trvSetup: 'DOUBLE' }),
    ];
    const { steps } = run({ other: withRearEnds });
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    // the rear pulley is gated by DOUBLE...
    assert.ok(splitNodes(setup.geometryMap['OPT-SETUP-DOUBLE']).includes('N-PULL-RD'));
    // ...AND by the drive, because visibilityOverrides ANDs every step that lists the node
    const drive = steps.find(s => s.stepRole === 'TRV_DRIVE');
    const motor = drive.styleOptions.find(o => o.driveType === 'MOTORIZED');
    assert.ok(splitNodes(motor.targetNode).includes('N-PULL-RD'));
    // and the drive answer carries no setup tag, so it is never filtered out of its own picker
    assert.equal(motor.trvSetup, '');
});

test('the drive step asks for no finish, and the fascia material step does', () => {
    const { steps } = run();
    assert.equal(steps.find(s => s.stepRole === 'TRV_DRIVE').finishDataSource, undefined);
    assert.equal(steps.find(s => s.title === 'Fascia Material').finishDataSource, 'master_finishes');
});

test('with no DOUBLE-tagged track the setup step still works, carrying no extra geometry', () => {
    const noSecond = other.filter(o => o.optId !== 'TRK-D');
    const { steps } = run({ other: noSecond });
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    assert.deepEqual(setup.geometryMap, {});
    assert.equal(steps.find(s => s.title === 'Track').styleOptions.length, 1);
});

test('the drive is ITS OWN step — an either/or for the order, never a per-track sub-choice', () => {
    const { steps } = run();
    const track = steps.find(s => s.title === 'Track');
    assert.equal(track.subOptions, undefined, 'drive must not hang off the track');
    const drive = steps.find(s => s.stepRole === 'TRV_DRIVE');
    assert.ok(drive, 'no Drive step');
    // exactly two answers, no combination — one per drive, not one per end
    assert.deepEqual(drive.styleOptions.map(o => o.driveType), ['MOTORIZED', 'MANUAL']);
    // the answer speaks the question's language; the real part rides in driveLabel + partId
    assert.deepEqual(drive.styleOptions.map(o => o.partName), ['Motorized', 'Manual']);
    assert.deepEqual(drive.styleOptions.map(o => o.driveLabel), ['HSOM-04', 'H1-2TRVPLUG']);
    assert.deepEqual(drive.styleOptions.map(o => o.partId), ['p-pull', 'p-plug']);
});

test('one answer lights BOTH ends — the plug is pinned left and right', () => {
    const { steps } = run();
    const drive = steps.find(s => s.stepRole === 'TRV_DRIVE');
    const manual = drive.styleOptions.find(o => o.driveType === 'MANUAL');
    assert.deepEqual(splitNodes(manual.targetNode).sort(), ['N-PLUG-L', 'N-PLUG-R']);
    assert.deepEqual(drive.geometryMap[manual.optId], manual.targetNode);
});

test('one drive only → no question, but the ends still get built', () => {
    const manualOnly = finial.filter(o => o.driveType !== 'MOTORIZED');
    const { steps } = run({ finial: manualOnly });
    assert.equal(steps.some(s => s.stepRole === 'TRV_DRIVE'), false);
    const track = steps.find(s => s.title === 'Track');
    assert.deepEqual(track.includedParts.map(p => p.partName), ['H1-2TRVPLUG', 'H1-2TRVPLUG']);
});

test('setup gates projection: the question is skipped on DOUBLE', () => {
    const { steps } = run();
    const proj = steps.find(s => s.title === 'Bracket Projection');
    assert.deepEqual(proj.styleOptions.map(o => o.partName),
        ['3-5/8" Projection', '4-5/8" Projection', '6" Projection']);
    assert.equal(proj.trvSetupOnly, 'SINGLE');
    // and it is asked AFTER the setup step it depends on
    assert.ok(titles(steps).indexOf('Single or Double') < titles(steps).indexOf('Bracket Projection'));
});

test('a single-only assembly asks neither setup nor a setup-gated projection', () => {
    // every pool must be single-only — ONE double-capable part anywhere (his second track lives in
    // the OTHER pool) is enough to make the question real, which is the correct reading.
    const noDbl = (l) => l.filter(o => o.trvSetup !== 'DOUBLE');
    const { steps } = run({ brackets: noDbl(brackets), finial: noDbl(finial), other: noDbl(other) });
    assert.equal(titles(steps).includes('Single or Double'), false);
    assert.equal(steps.find(s => s.title === 'Bracket Projection').trvSetupOnly, undefined);
});

test('riders are built, never offered — carriers and the F-clip ride the fascia length step', () => {
    const { steps, seen } = run();
    const inc = steps.find(s => s.title === 'Fascia Length').includedParts;
    assert.deepEqual([...new Set(inc.map(p => p.traverseRole))].sort(), ['CARRIER', 'FCLIP']);
    // and never appear in any picker
    const everyOption = steps.flatMap(s => s.styleOptions || []).map(o => o.partName);
    assert.equal(everyOption.includes('HTSLNTCAR'), false);
    assert.equal(everyOption.includes('H1-2TRVCLP'), false);
    assert.equal(seen.perPosition[0].opts.some(o => o.partName === 'H1-2TRVCLP'), false);
});

test('trv:end parts leave the finial pool — no drive pulley in the End Treatment picker', () => {
    const { seen } = run();
    const names = seen.endTreatment.map(o => o.partName);
    assert.equal(names.includes('HSOM-04'), false);
    assert.equal(names.includes('H1-2TRVPLUG'), false);
    assert.ok(names.includes('H1-2TRVSRA'));
});

test('returns never invent a projection card — their tag is a minimum, not an offer', () => {
    const vals = projectionsOffered([
        opt({ optId: 'a', projInches: '4.625' }),
        opt({ optId: 'b', projInches: '0.75', endTreatment: 'FRENCH_RETURN' }),
        opt({ optId: 'c', projInches: '4.62', endTreatment: 'MITER_RETURN' }),
    ]);
    assert.deepEqual(vals.map(v => v.f), [4.625]);
});

test('one projection = no question, stamped as the implied value instead', () => {
    const only = brackets.filter(o => o.projInches === '3.625' || o.trvSetup === 'DOUBLE');
    const { steps, out } = run({ brackets: only, finial: finial.filter(o => !o.projInches) });
    assert.equal(titles(steps).includes('Bracket Projection'), false);
    assert.equal(out.impliedProjInches, 3.625);
});

test('a single fascia material folds finish and length into one step', () => {
    const { steps } = run({ pole: pole.filter(o => o.partId !== 'p-ar') });
    const t = titles(steps);
    assert.equal(t.includes('Fascia Material'), false);
    assert.ok(t.includes('Fascia Length & Finish'));
    assert.equal(steps[0].linkedItemId, 'p-wr');
});

test('a ring becomes the Front Rail sub-choice, not a Rings step', () => {
    const { steps } = run();
    // his H1-2RCTPR is the front-rail alternative, so it must not ALSO be a rings picker
    assert.equal(titles(steps).includes('Rings'), false);
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    assert.equal(setup.subLabel, 'Front Rail');
    assert.deepEqual(setup.subOptions.map(o => o.partName), ['Front as track', 'Front as ring on pole']);
});

test('the Front Rail picker exists only on a double, and opens on track', () => {
    const { steps } = run();
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    // both options are DOUBLE-tagged, so the sub list is empty until DOUBLE is chosen
    assert.deepEqual([...new Set(setup.subOptions.map(o => o.trvSetup))], ['DOUBLE']);
    assert.equal(setup.defaultSubOptId, 'OPT-FRONT-TRACK');
});

test('front-as-ring removes the front track from render, price and BOM together', () => {
    const { steps } = run();
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    const ring = setup.subOptions.find(o => o.hidesStepRole);
    // it disables the TRACK step rather than fighting it for the same mesh
    assert.equal(ring.hidesStepRole, 'TRACK');
    assert.equal(steps.find(s => s.title === 'Track').stepRole, 'TRACK');
    // only the ring carries geometry, so it stays hidden until chosen
    assert.deepEqual(Object.keys(setup.subGeometryMap), [ring.optId]);
    assert.equal(setup.subGeometryMap[ring.optId], 'N-RING');
    assert.equal(setup.subOptions.find(o => o.optId === 'OPT-FRONT-TRACK').targetNode, '');
});

test('the front track\'s ends ride WITH the front track, the rear\'s do not', () => {
    const withRearEnds = [
        ...other,
        opt({ optId: 'PULL-RD', partId: 'p-pull', partName: 'HSOM-04', traverseRole: 'TRV_END', driveType: 'MOTORIZED', trvSetup: 'DOUBLE' }),
    ];
    const { steps } = run({ other: withRearEnds });
    const trackGeom = splitNodes(steps.find(s => s.title === 'Track').geometryMap['TRK-S']);
    // the Track step co-owns the FRONT ends, so disabling it (front-as-ring) takes them with it
    assert.ok(trackGeom.includes('N-TRK-S'));
    ['N-PLUG-L', 'N-PLUG-R', 'N-PULL-L', 'N-PULL-R'].forEach(n =>
        assert.ok(trackGeom.includes(n), `front end ${n} missing from the track's map`));
    // the REAR end answers to the setup step instead — a ring up front leaves the rear dressed
    assert.equal(trackGeom.includes('N-PULL-RD'), false);
    // and the drive still gates them all, because visibilityOverrides ANDs the two steps
    const drive = steps.find(s => s.stepRole === 'TRV_DRIVE');
    assert.ok(drive.styleOptions.find(o => o.driveType === 'MANUAL').targetNode.includes('N-PLUG-L'));
});

test('the ring is counted, the track is measured', () => {
    const { steps } = run();
    const setup = steps.find(s => s.stepRole === 'TRV_SETUP');
    const ring = setup.subOptions.find(o => o.hidesStepRole);
    assert.equal(ring.needsQty, true);
    assert.equal(ring.qtyHelperText, 'Number of rings');
    // "front as track" is not counted — it is the absence of a ring, not a quantity of one
    assert.equal(setup.subOptions.find(o => o.optId === 'OPT-FRONT-TRACK').needsQty, undefined);
    // and the length step is labelled so the track can take its footage from it
    assert.ok(steps.find(s => s.stepRole === 'TRV_LENGTH'));
});

test('no ring pinned → no Front Rail picker at all', () => {
    const { steps } = run({ rings: [] });
    assert.equal(steps.find(s => s.stepRole === 'TRV_SETUP').subOptions, undefined);
});
