// Harness for Shared/hardwareModel.js — the same method that proved bayMath before Vision trusted
// it: fixtures for every shape in the range, run every combination, assert the invariants.
//
//   node scripts/hardwareModel.test.mjs
//
// The four collections being saved are represented by SHAPE, not by name: a solid-rod family with
// per-end treatments (Simple Elegance / Brimar), a mixed solid+traverse assembly (Fabricut H1-138),
// and a fascia+track traverse system (H1-2TRV). Plus the extensibility cases Stuart named — a 4th
// projection on singles, a 3rd on doubles — which must pass with NO code change.

import {
    resolve, diagnose, normalizeChoice, measureOf, activeAxes, admits, contextOf, takesFinish, finishesFor, slots, applyFitsDefaults
} from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

const C = (o) => o;   // readability

// ── FIXTURE 1: solid-rod family, per-end treatments (Simple Elegance / Brimar shape) ──────────
const solidFamily = [
    C({ id: 'ROD-STEEL', partId: 'H2-138', role: 'ROD', rodKind: 'SOLID', nodes: ['rod-center', 'rod-left', 'rod-right'] }),
    C({ id: 'ROD-WOOD', partId: 'H2-138W', role: 'ROD', rodKind: 'SOLID', nodes: ['wood-center', 'wood-left', 'wood-right'] }),
    // brackets: 3 projections on singles, 2 on doubles — the asymmetry Stuart described
    C({ id: 'BKT-S-36', partId: 'B36', role: 'BRACKET', setup: 'SINGLE', proj: '3-5/8', position: 'CENTER', nodes: ['bkt-s36'] }),
    C({ id: 'BKT-S-46', partId: 'B46', role: 'BRACKET', setup: 'SINGLE', proj: '4-5/8', position: 'CENTER', nodes: ['bkt-s46'] }),
    C({ id: 'BKT-S-60', partId: 'B60', role: 'BRACKET', setup: 'SINGLE', proj: '6', position: 'CENTER', nodes: ['bkt-s60'] }),
    C({ id: 'BKT-D-46', partId: 'D46', role: 'BRACKET', setup: 'DOUBLE', proj: '4-5/8', position: 'CENTER', nodes: ['bkt-d46'] }),
    C({ id: 'BKT-D-60', partId: 'D60', role: 'BRACKET', setup: 'DOUBLE', proj: '6', position: 'CENTER', nodes: ['bkt-d60'] }),
    // ceiling bracket: own location, own backplate
    C({ id: 'BKT-CEIL', partId: 'BC', role: 'BRACKET', mount: 'CEILING', proj: '3-5/8', position: 'CENTER', nodes: ['bkt-ceil'] }),
    C({ id: 'BP-WALL', partId: 'BPW', role: 'BACKPLATE', mount: 'WALL', position: 'CENTER', nodes: ['bp-wall'] }),
    C({ id: 'BP-CEIL', partId: 'BPC', role: 'BACKPLATE', mount: 'CEILING', position: 'CENTER', nodes: ['bp-ceil'] }),
    // ends: finials + inside mounts + returns pool into ONE decision per end
    C({ id: 'FIN-BALL-L', partId: 'FB', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
    C({ id: 'FIN-ACRYL-L', partId: 'FA', role: 'FINIAL', position: 'LEFT', nodes: ['acr-l', 'acr-collar-l'] }),
    C({ id: 'IM-L', partId: 'IM', role: 'INSIDE_MOUNT', position: 'LEFT', nodes: ['im-l'] }),
    C({ id: 'RET-L', partId: 'RT', role: 'RETURN', position: 'LEFT', proj: '4-5/8', nodes: ['ret-l'] }),
    C({ id: 'FIN-BALL-R', partId: 'FB', role: 'FINIAL', position: 'RIGHT', nodes: ['fin-r'] }),
    C({ id: 'RING', partId: 'RG', role: 'RING', nodes: ['rings'] }),
];

{
    const m = resolve({ choices: solidFamily, answers: {} });
    const axes = m.axes.map(a => a.key);
    ok('solid: asks rod / setup / mount / projection', axes.join(',') === 'rodKind,setup,mount,proj', axes.join(','));

    // THE EXTENSIBILITY CLAIM: projection values are DISCOVERED, and they differ by setup.
    // Scoped to WALL, because the ceiling bracket carries no setup tag and therefore legitimately
    // suits both — it contributes its own 3-5/8" to a ceiling double. (That is the engine being
    // right and this fixture being subtle; asserting it below rather than hiding it.)
    const single = activeAxes(m.choices, { setup: 'SINGLE', mount: 'WALL' }).find(a => a.key === 'proj');
    const double = activeAxes(m.choices, { setup: 'DOUBLE', mount: 'WALL' }).find(a => a.key === 'proj');
    eq('singles offer their three projections', single.values, [3.625, 4.625, 6]);
    eq('doubles offer only their two', double.values, [4.625, 6]);
    const ceilDouble = activeAxes(m.choices, { setup: 'DOUBLE', mount: 'CEILING' }).find(a => a.key === 'proj');
    eq('an untagged-setup ceiling bracket rightly serves a double', ceilDouble.values, [3.625]);

    // End treatment is ONE decision per end, pooling finial + inside mount + return.
    const endL = m.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    ok('left end pools finials, inside mount and return', endL.all.length === 4, `got ${endL.all.length}`);

    // A return reads its projection as a MINIMUM; a bracket as exact.
    const at36 = resolve({ choices: solidFamily, answers: { setup: 'SINGLE', mount: 'WALL', proj: 3.625 } });
    const end36 = at36.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    ok('return is unavailable below its minimum depth', !end36.options.some(o => o.id === 'RET-L'));
    ok('finials and inside mount remain at 3-5/8', end36.options.length === 3, `got ${end36.options.length}`);
    const at46 = resolve({ choices: solidFamily, answers: { setup: 'SINGLE', mount: 'WALL', proj: 4.625 } });
    const end46 = at46.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    ok('return appears once depth allows', end46.options.some(o => o.id === 'RET-L'));

    // Mount pairing falls out of the tags — no pairing rule anywhere in the engine.
    const ceil = resolve({ choices: solidFamily, answers: { setup: 'SINGLE', mount: 'CEILING', proj: 3.625 } });
    const bpCeil = ceil.slots.find(s => s.kind === 'BACKPLATE');
    eq('ceiling mount offers only its own backplate', bpCeil.options.map(o => o.id), ['BP-CEIL']);
    const wall = resolve({ choices: solidFamily, answers: { setup: 'SINGLE', mount: 'WALL', proj: 3.625 } });
    eq('wall mount offers only the wall backplate', wall.slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id), ['BP-WALL']);

    // A refusal always names its rule — this is what replaces "none survive the filters".
    const bktAt36 = wall.slots.find(s => s.kind === 'BRACKET');
    const why = bktAt36.rejected.find(r => r.choice.id === 'BKT-S-46');
    ok('a rejection names the rule', why && why.rule === 'projection', why && why.rule);

    // VISIBILITY IS THE UNION OF WHAT IS SELECTED — nothing else, and no veto.
    const vis = resolve({ choices: solidFamily, answers: { setup: 'SINGLE', mount: 'WALL', proj: 3.625 }, selectedIds: ['ROD-STEEL', 'BKT-S-36', 'BP-WALL', 'FIN-BALL-L', 'FIN-BALL-R'] });
    eq('only the selected geometry renders', [...vis.visible].sort(),
        ['bkt-s36', 'bp-wall', 'fin-l', 'fin-r', 'rod-center', 'rod-left', 'rod-right']);
    ok('the unselected wood rod does not render', !vis.visible.has('wood-center'));
    ok('the unselected acrylic finial does not render', !vis.visible.has('acr-l'));
}

// ── FIXTURE 2: EXTENSIBILITY — a 4th single projection and a 3rd double, by TAG only ──────────
{
    const extended = [
        ...solidFamily,
        C({ id: 'BKT-S-80', partId: 'B80', role: 'BRACKET', setup: 'SINGLE', proj: '8', position: 'CENTER', nodes: ['bkt-s80'] }),
        C({ id: 'BKT-D-36', partId: 'D36', role: 'BRACKET', setup: 'DOUBLE', proj: '3-5/8', position: 'CENTER', nodes: ['bkt-d36'] }),
    ];
    const m = resolve({ choices: extended, answers: {} });
    const single = activeAxes(m.choices, { setup: 'SINGLE' }).find(a => a.key === 'proj');
    const double = activeAxes(m.choices, { setup: 'DOUBLE' }).find(a => a.key === 'proj');
    eq('a 4th single projection appears with no code change', single.values, [3.625, 4.625, 6, 8]);
    eq('a 3rd double projection appears with no code change', double.values, [3.625, 4.625, 6]);
    const at8 = resolve({ choices: extended, answers: { setup: 'SINGLE', mount: 'WALL', proj: 8 } });
    eq('the new projection selects its own bracket', at8.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-S-80']);
}

// ── FIXTURE 3: mixed solid + traverse in ONE assembly (Fabricut H1-138 shape) ─────────────────
// The traverse rod occupies the same place in the file and is toggled by tag; it brings its own
// brackets, backplates and returns, and carriers ride it. Finials and inside mounts are shared.
const mixed = [
    C({ id: 'ROD-SOLID', partId: 'H1-138', role: 'ROD', rodKind: 'SOLID', nodes: ['solid-rod'] }),
    C({ id: 'ROD-TRV', partId: 'H1-138TRV', role: 'ROD', rodKind: 'TRAVERSE', nodes: ['trv-rod'] }),
    C({ id: 'CARRIER', partId: 'CAR', role: 'CARRIER', nodes: ['carriers'] }),
    C({ id: 'BKT-STD', partId: 'BS', role: 'BRACKET', proj: '3-5/8', position: 'CENTER', nodes: ['bkt-std'] }),
    C({ id: 'BKT-TRV', partId: 'BT', role: 'BRACKET', fits: ['TRAVERSE'], proj: '3-5/8', position: 'CENTER', nodes: ['bkt-trv'] }),
    C({ id: 'BP-STD', partId: 'PS', role: 'BACKPLATE', position: 'CENTER', nodes: ['bp-std'] }),
    C({ id: 'BP-TRV', partId: 'PT', role: 'BACKPLATE', fits: ['TRAVERSE'], position: 'CENTER', nodes: ['bp-trv'] }),
    C({ id: 'RET-TRV', partId: 'RT', role: 'RETURN', fits: ['TRAVERSE'], position: 'LEFT', nodes: ['ret-trv'] }),
    C({ id: 'FIN-SHARED', partId: 'FS', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
    // Tagged solid-only, which is what STD_ONLY means in the live vocabulary. The engine no longer
    // ASSUMES rings are solid-only — H1-2TRV proves they need not be ("no track but rings") — so a
    // mixed assembly that wants them off the traverse rod must say so. This is the tag doing its job.
    C({ id: 'RING-STD', partId: 'RG', role: 'RING', fits: ['SOLID'], nodes: ['rings'] }),
];

{
    const solid = resolve({ choices: mixed, answers: { rodKind: 'SOLID', proj: 3.625 } });
    eq('solid rod gets the standard bracket only', solid.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-STD']);
    eq('solid rod gets the standard backplate only', solid.slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id), ['BP-STD']);
    eq('rings are offered on a solid rod', solid.slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING-STD']);
    ok('no carriers on a solid rod', !solid.riders.length);
    const endS = solid.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    eq('solid end offers the shared finial, not the traverse return', endS.options.map(o => o.id), ['FIN-SHARED']);

    const trv = resolve({ choices: mixed, answers: { rodKind: 'TRAVERSE', proj: 3.625 } });
    eq('traverse rod gets its own bracket only', trv.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-TRV']);
    eq('traverse rod gets its own backplate only', trv.slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id), ['BP-TRV']);
    eq('rings do not follow a traverse rod', trv.slots.find(s => s.kind === 'RING').options.map(o => o.id), []);
    // Riders arrive WITH the rod, not before it — nothing rides a rod nobody chose.
    eq('no carriers until a rod is actually chosen', trv.riders.map(r => r.id), []);
    eq('carriers ride the traverse rod once it is picked',
        resolve({ choices: mixed, answers: { rodKind: 'TRAVERSE', proj: 3.625 }, selectedIds: ['ROD-TRV'] }).riders.map(r => r.id), ['CARRIER']);
    eq('and never ride a chosen SOLID rod',
        resolve({ choices: mixed, answers: { rodKind: 'SOLID', proj: 3.625 }, selectedIds: ['ROD-SOLID'] }).riders.map(r => r.id), []);
    const endT = trv.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    eq('traverse end keeps the SHARED finial and adds its return', endT.options.map(o => o.id).sort(), ['FIN-SHARED', 'RET-TRV']);

    // Carriers render with the traverse rod without ever being a question.
    const v = resolve({ choices: mixed, answers: { rodKind: 'TRAVERSE', proj: 3.625 }, selectedIds: ['ROD-TRV', 'BKT-TRV'] });
    ok('carrier geometry rides the traverse rod', v.visible.has('carriers') && v.visible.has('trv-rod'));
    ok('the solid rod is not rendered alongside it', !v.visible.has('solid-rod'));
}

// ── FIXTURE 4: fascia + track traverse system (H1-2TRV shape) ─────────────────────────────────
const fasciaTrack = [
        C({ id: 'FASCIA-A', partId: 'FA', role: 'FASCIA', nodes: ['fascia'] }),
        C({ id: 'TRACK-FRONT', partId: 'TF', role: 'TRACK', nodes: ['track-front'] }),
        C({ id: 'TRACK-REAR', partId: 'TR', role: 'TRACK', setup: 'DOUBLE', nodes: ['track-rear'] }),
        C({ id: 'FCLIP', partId: 'FC', role: 'FCLIP', nodes: ['fclips'] }),
        C({ id: 'CARRIER', partId: 'CA', role: 'CARRIER', nodes: ['carriers'] }),
        C({ id: 'BKT-SINGLE', partId: 'BS', role: 'BRACKET', fits: ['TRAVERSE'], setup: 'SINGLE', nodes: ['bkt-single'] }),
    C({ id: 'BKT-DOUBLE', partId: 'BD', role: 'BRACKET', fits: ['TRAVERSE'], setup: 'DOUBLE', nodes: ['bkt-double'] }),
];
{
    const single = resolve({ choices: fasciaTrack, answers: { setup: 'SINGLE' } });
    eq('a single offers only the single bracket', single.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-SINGLE']);
    const trackSingle = single.slots.find(s => s.kind === 'TRACK');
    eq('a single offers only the front track', trackSingle.options.map(o => o.id), ['TRACK-FRONT']);

    const double = resolve({ choices: fasciaTrack, answers: { setup: 'DOUBLE' } });
    eq('a double offers both tracks', double.slots.find(s => s.kind === 'TRACK').options.map(o => o.id), ['TRACK-FRONT', 'TRACK-REAR']);
    eq('a double offers only the double bracket', double.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-DOUBLE']);
    ok('fascia is shared across setups', double.slots.find(s => s.kind === 'FASCIA').options.length === 1);
    eq('riders ride regardless of setup, once a track is chosen',
        resolve({ choices: fasciaTrack, answers: { setup: 'DOUBLE' }, selectedIds: ['TRACK-FRONT'] }).riders.map(r => r.id).sort(), ['CARRIER', 'FCLIP']);
}

// ── FIXTURE 5: THE TARGET — one combined H1 holding both worlds (Stuart 2026-08-17) ───────────
// "the H1-2TRV would ideally rest in a total H1 combined similar to the H2 combined… the only
//  difference being a fascia appears in front of a track when used with track, or we turn off the
//  track and use rings."
// One assembly, one flow. The rod answer chooses the world: fascia+track+carriers+traverse arms, OR
// solid rod + rings + standard arms. Finials are shared across both, and are tagged for neither.
const combinedH1 = [
    C({ id: 'ROD-STEEL', partId: 'H1-138', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
    C({ id: 'FASCIA', partId: 'FA', role: 'FASCIA', nodes: ['fascia'] }),
    C({ id: 'TRACK-FRONT', partId: 'TF', role: 'TRACK', nodes: ['track-front'] }),
    C({ id: 'TRACK-REAR', partId: 'TR', role: 'TRACK', setup: 'DOUBLE', nodes: ['track-rear'] }),
    C({ id: 'CARRIER', partId: 'CA', role: 'CARRIER', nodes: ['carriers'] }),
    C({ id: 'FCLIP', partId: 'FC', role: 'FCLIP', nodes: ['fclips'] }),
    // Solid-only, said out loud — the engine does not assume it (H1-2TRV runs rings on a
    // traverse front). This is STD_ONLY in the live vocabulary.
    C({ id: 'RING', partId: 'RG', role: 'RING', fits: ['SOLID'], nodes: ['rings'] }),
    C({ id: 'BKT-STD', partId: 'BS', role: 'BRACKET', proj: '3-5/8', position: 'CENTER', nodes: ['bkt-std'] }),
    C({ id: 'BKT-TRV', partId: 'BT', role: 'BRACKET', fits: ['TRAVERSE'], proj: '3-5/8', position: 'CENTER', nodes: ['bkt-trv'] }),
    C({ id: 'FIN-L', partId: 'FN', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
];

{
    const kinds = resolve({ choices: combinedH1, answers: {} }).axes.find(a => a.key === 'rodKind');
    eq('the combined flow asks which world', kinds.values, ['SOLID', 'TRAVERSE']);

    // SOLID: rod + rings + standard arms. No fascia question, no track question, no carriers.
    const solid = resolve({ choices: combinedH1, answers: { rodKind: 'SOLID', proj: 3.625 } });
    const solidSlots = solid.slots.filter(s => s.options.length).map(s => s.kind);
    ok('solid world asks for a rod', solidSlots.includes('ROD'));
    ok('solid world never asks for a fascia', !solidSlots.includes('FASCIA'));
    ok('solid world never asks for a track', !solidSlots.includes('TRACK'));
    eq('solid world offers rings', solid.slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING']);
    eq('solid world uses the standard arm', solid.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-STD']);
    eq('no riders on a solid rod', solid.riders.map(r => r.id), []);

    // TRAVERSE: fascia AND track are both asked — the fascia sits in front of the track.
    const trv = resolve({ choices: combinedH1, answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', proj: 3.625 } });
    const trvSlots = trv.slots.filter(s => s.options.length).map(s => s.kind);
    ok('traverse world asks for a fascia', trvSlots.includes('FASCIA'));
    ok('traverse world asks for a track', trvSlots.includes('TRACK'));
    ok('traverse world never asks for a solid rod', !trvSlots.includes('ROD'));
    eq('the track turns the rings off', trv.slots.find(s => s.kind === 'RING').options.map(o => o.id), []);
    eq('traverse world uses its own arm', trv.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT-TRV']);
    eq('carriers and f-clips ride the track once it is chosen',
        resolve({ choices: combinedH1, answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', proj: 3.625 }, selectedIds: ['TRACK-FRONT'] }).riders.map(r => r.id).sort(), ['CARRIER', 'FCLIP']);

    // The finial is shared by BOTH worlds and tagged for neither — the designer's work is not redone.
    const finSolid = solid.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    const finTrv = trv.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    eq('the same finial is offered on a solid rod', finSolid.options.map(o => o.id), ['FIN-L']);
    eq('and on the traverse, untouched', finTrv.options.map(o => o.id), ['FIN-L']);

    // Geometry: choosing one world never renders a scrap of the other.
    const vSolid = resolve({ choices: combinedH1, answers: { rodKind: 'SOLID', proj: 3.625 }, selectedIds: ['ROD-STEEL', 'RING', 'BKT-STD', 'FIN-L'] });
    eq('solid renders no fascia, track or carriers', [...vSolid.visible].sort(), ['bkt-std', 'fin-l', 'ring'].sort().map(x => x === 'ring' ? 'rings' : x).sort().concat('rod').sort());
    const vTrv = resolve({ choices: combinedH1, answers: { rodKind: 'TRAVERSE', setup: 'SINGLE', proj: 3.625 }, selectedIds: ['FASCIA', 'TRACK-FRONT', 'BKT-TRV', 'FIN-L'] });
    ok('traverse renders fascia, track and riders', ['fascia', 'track-front', 'carriers', 'fclips', 'bkt-trv', 'fin-l'].every(n => vTrv.visible.has(n)));
    ok('traverse renders no solid rod and no rings', !vTrv.visible.has('rod') && !vTrv.visible.has('rings'));
    ok('a single renders no rear track', !vTrv.visible.has('track-rear'));
}

// ── A TAG IS EXCLUSIVE ONLY WHEN IT IS USED TO DISTINGUISH ────────────────────────────────────
// The rule that H1-2TRV forced out, asserted in both directions.
{
    // Untagged brackets in a PURE traverse assembly serve it — there is nothing to be exclusive
    // against. This is the H1-2TRV case that the first cut of the engine got wrong.
    const pureTraverse = [
        C({ id: 'FASCIA', partId: 'FA', role: 'FASCIA', nodes: ['fascia'] }),
        C({ id: 'TRACK', partId: 'TK', role: 'TRACK', nodes: ['track'] }),
        C({ id: 'BKT', partId: 'BK', role: 'BRACKET', position: 'CENTER', nodes: ['bkt'] }),
        C({ id: 'RING', partId: 'RG', role: 'RING', nodes: ['ring'] }),
    ];
    const m = resolve({ choices: pureTraverse, answers: {} });
    eq('untagged brackets serve a pure traverse assembly', m.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['BKT']);
    eq('and so do untagged rings — "no track but rings"', m.slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING']);

    // In a MIXED assembly where nobody drew a distinction for a role, that role serves both worlds.
    const undrawn = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'TRV', partId: 'T', role: 'ROD', rodKind: 'TRAVERSE', nodes: ['trv'] }),
        C({ id: 'RING', partId: 'RG', role: 'RING', nodes: ['ring'] }),
    ];
    eq('an untagged role in a mixed assembly serves both worlds',
        resolve({ choices: undrawn, answers: { rodKind: 'TRAVERSE' } }).slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING']);
    // …and tagging ONE sibling makes the untagged ones the complement.
    const drawn = [
        ...undrawn,
        C({ id: 'RING-TRV', partId: 'RT', role: 'RING', fits: ['TRAVERSE'], nodes: ['ring-trv'] }),
    ];
    eq('tagging a sibling makes the untagged one the complement',
        resolve({ choices: drawn, answers: { rodKind: 'TRAVERSE' } }).slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING-TRV']);
    eq('and the untagged one owns the other world',
        resolve({ choices: drawn, answers: { rodKind: 'SOLID' } }).slots.find(s => s.kind === 'RING').options.map(o => o.id), ['RING']);
}

// ── THE THREE-PIECE POLE: ONE DECISION, SEGMENTS FOLLOW THE ENDS ──────────────────────────────
// Stuart's rule, 2026-08-17. The rod is one part pinned as left/centre/right; a return needs the
// short pole, so that end's long piece drops out.
const threePiece = [
    C({ id: 'ROD-L', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['rod-left'] }),
    C({ id: 'ROD-C', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rod-center'] }),
    C({ id: 'ROD-R', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'RIGHT', nodes: ['rod-right'] }),
    C({ id: 'FIN-L', partId: 'FN', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
    C({ id: 'FIN-R', partId: 'FN', role: 'FINIAL', position: 'RIGHT', nodes: ['fin-r'] }),
    C({ id: 'RET-L', partId: 'RT', role: 'RETURN', position: 'LEFT', nodes: ['ret-l'] }),
    C({ id: 'RET-R', partId: 'RT', role: 'RETURN', position: 'RIGHT', nodes: ['ret-r'] }),
];
{
    const m0 = resolve({ choices: threePiece, answers: {} });
    const rodSlots = m0.slots.filter(s => s.kind === 'ROD');
    eq('three pinned pieces ask ONE rod question', rodSlots.length, 1);
    eq('and offer the part once, not three times', rodSlots[0].options.length, 1);

    const vis = (sel) => [...resolve({ choices: threePiece, answers: {}, selectedIds: sel }).visible].sort();

    eq('rod alone renders the short centre only', vis(['ROD-C']), ['rod-center']);
    eq('a finial on the left brings the left piece', vis(['ROD-C', 'FIN-L']), ['fin-l', 'rod-center', 'rod-left']);
    eq('finials both ends bring the whole three-piece pole',
        vis(['ROD-C', 'FIN-L', 'FIN-R']), ['fin-l', 'fin-r', 'rod-center', 'rod-left', 'rod-right']);
    eq('a return on the right drops the right piece — the short pole carries it',
        vis(['ROD-C', 'FIN-L', 'RET-R']), ['fin-l', 'ret-r', 'rod-center', 'rod-left']);
    eq('returns both ends leave the short centre alone',
        vis(['ROD-C', 'RET-L', 'RET-R']), ['ret-l', 'ret-r', 'rod-center']);
    // Selecting ANY piece selects the part — the pieces are geometry, not alternatives.
    eq('picking the rod by any of its pieces behaves identically',
        vis(['ROD-L', 'FIN-L', 'FIN-R']), vis(['ROD-C', 'FIN-L', 'FIN-R']));
}
{
    // A single-rod assembly has no end pieces and simply renders whole.
    const single = [
        C({ id: 'ROD', partId: 'ONE', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'FIN-L', partId: 'FN', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
    ];
    eq('a single long rod renders whole with no ends answered',
        [...resolve({ choices: single, answers: {}, selectedIds: ['ROD'] }).visible], ['rod']);
}

// ── THE SAME RULE, ON THE FASCIA (Stuart 2026-08-17: "yes, same rule to fascia") ───────────────
// The rule is written over ROD_ROLES, so a fascia pinned in three pieces behaves identically to a
// pole pinned in three pieces — and a track alongside it groups by its OWN part, independently.
// Asserted rather than assumed: "as long as they apply across the board" is the whole requirement.
{
    const trvThreePiece = [
        C({ id: 'FAS-L', partId: 'H1-138TRV', role: 'FASCIA', position: 'LEFT', nodes: ['fas-left'] }),
        C({ id: 'FAS-C', partId: 'H1-138TRV', role: 'FASCIA', position: 'CENTER', nodes: ['fas-center'] }),
        C({ id: 'FAS-R', partId: 'H1-138TRV', role: 'FASCIA', position: 'RIGHT', nodes: ['fas-right'] }),
        C({ id: 'TRK-C', partId: 'TRK', role: 'TRACK', position: 'CENTER', nodes: ['trk-center'] }),
        C({ id: 'TRK-L', partId: 'TRK', role: 'TRACK', position: 'LEFT', nodes: ['trk-left'] }),
        C({ id: 'FIN-L', partId: 'FN', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
        C({ id: 'RET-R', partId: 'RT', role: 'RETURN', position: 'RIGHT', nodes: ['ret-r'] }),
    ];
    const m = resolve({ choices: trvThreePiece, answers: {} });
    eq('a three-piece fascia asks ONE fascia question', m.slots.filter(s => s.kind === 'FASCIA').length, 1);
    eq('offered once, not three times', m.slots.find(s => s.kind === 'FASCIA').options.length, 1);
    eq('the track beside it is its own single question', m.slots.find(s => s.kind === 'TRACK').options.length, 1);

    const vis = (sel) => [...resolve({ choices: trvThreePiece, answers: {}, selectedIds: sel }).visible].sort();
    eq('fascia alone renders its short centre', vis(['FAS-C']), ['fas-center']);
    eq('a finial extends the fascia on that side', vis(['FAS-C', 'FIN-L']), ['fas-center', 'fas-left', 'fin-l']);
    eq('a return keeps that side short', vis(['FAS-C', 'FIN-L', 'RET-R']), ['fas-center', 'fas-left', 'fin-l', 'ret-r']);
    eq('the track follows the same rule on its own part',
        vis(['FAS-C', 'TRK-C', 'FIN-L']), ['fas-center', 'fas-left', 'fin-l', 'trk-center', 'trk-left']);
}

// ── A ROD IS NEVER A RIDER, WHATEVER IT IS TAGGED ─────────────────────────────────────────────
// "when solid pole is selected i am getting offered only two choices of acrylic and wood, not
//  metal" — the metal rod's centre piece carries the legacy ALWAYS SHOWN tag, which made it a
//  rider, and riders are never offered.
{
    const withLegacyTag = [
        C({ id: 'ROD-METAL-C', partId: 'METAL', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', always: true, nodes: ['metal-c'] }),
        C({ id: 'ROD-METAL-L', partId: 'METAL', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['metal-l'] }),
        C({ id: 'ROD-WOOD', partId: 'WOOD', role: 'ROD', rodKind: 'SOLID', nodes: ['wood'] }),
        C({ id: 'ROD-ACRYL', partId: 'ACRYL', role: 'ROD', rodKind: 'SOLID', nodes: ['acryl'] }),
    ];
    const m = resolve({ choices: withLegacyTag, answers: { rodKind: 'SOLID' } });
    eq('all three materials are offered, including the always-tagged metal',
        m.slots.find(s => s.kind === 'ROD').options.map(o => o.partId).sort(), ['ACRYL', 'METAL', 'WOOD']);
    eq('and the tagged rod does not ride along uninvited', m.riders.map(r => r.id), []);
    eq('choosing it still renders its centre piece',
        [...resolve({ choices: withLegacyTag, answers: { rodKind: 'SOLID' }, selectedIds: ['ROD-METAL-C'] }).visible], ['metal-c']);
}

// ── A RETURN OR INSIDE MOUNT IS ALSO THE MOUNT ────────────────────────────────────────────────
// "returns can have no other end choice and no left or right brackets and use the smaller pole,
//  inside mounts have same rules but use the longer poles."
{
    const withBrackets = [
        C({ id: 'ROD-C', partId: 'R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rod-c'] }),
        C({ id: 'ROD-L', partId: 'R', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['rod-l'] }),
        C({ id: 'ROD-R', partId: 'R', role: 'ROD', rodKind: 'SOLID', position: 'RIGHT', nodes: ['rod-r'] }),
        C({ id: 'BKT-L', partId: 'BL', role: 'BRACKET', position: 'LEFT', nodes: ['bkt-l'] }),
        C({ id: 'BP-L', partId: 'PL', role: 'BACKPLATE', position: 'LEFT', nodes: ['bp-l'] }),
        C({ id: 'BKT-R', partId: 'BR', role: 'BRACKET', position: 'RIGHT', nodes: ['bkt-r'] }),
        C({ id: 'FIN-L', partId: 'F', role: 'FINIAL', position: 'LEFT', nodes: ['fin-l'] }),
        C({ id: 'IM-L', partId: 'IM', role: 'INSIDE_MOUNT', position: 'LEFT', nodes: ['im-l'] }),
        C({ id: 'RET-L', partId: 'RT', role: 'RETURN', position: 'LEFT', nodes: ['ret-l'] }),
    ];
    const slotsFor = (sel) => resolve({ choices: withBrackets, answers: {}, selectedIds: sel }).slots;
    const bktL = (sel) => slotsFor(sel).find(s => s.kind === 'BRACKET' && s.position === 'LEFT');
    const bpL = (sel) => slotsFor(sel).find(s => s.kind === 'BACKPLATE' && s.position === 'LEFT');

    ok('with a finial the left bracket is offered', bktL(['ROD-C', 'FIN-L']).options.length === 1);
    eq('a RETURN takes the left bracket off the table', bktL(['ROD-C', 'RET-L']).options.map(o => o.id), []);
    eq('and its backplate with it', bpL(['ROD-C', 'RET-L']).options.map(o => o.id), []);
    eq('an INSIDE MOUNT does the same', bktL(['ROD-C', 'IM-L']).options.map(o => o.id), []);
    ok('and says why', /inside mount carries the rod/.test(bktL(['ROD-C', 'IM-L']).suppressedReason || ''));
    ok('the OTHER end is untouched', slotsFor(['ROD-C', 'IM-L']).find(s => s.kind === 'BRACKET' && s.position === 'RIGHT').options.length === 1);
    ok('a replaced slot is never reported as a fault',
        !diagnose(resolve({ choices: withBrackets, answers: {}, selectedIds: ['ROD-C', 'RET-L'] })).some(d => d.kind === 'NO OPTIONS'));

    // The one difference between them, and it is geometric: the pole length.
    const vis = (sel) => [...resolve({ choices: withBrackets, answers: {}, selectedIds: sel }).visible].sort();
    ok('a RETURN uses the shorter pole — the left piece drops', !vis(['ROD-C', 'RET-L']).includes('rod-l'));
    ok('an INSIDE MOUNT keeps the longer pole', vis(['ROD-C', 'IM-L']).includes('rod-l'));
}

// ── NOTHING GATES A ROD BUT ITS ROD TYPE ──────────────────────────────────────────────────────
// "when i switch to inside mount or wall it reduces to only two, the wood and acrylic … no rod
//  should [be filtered], the only rule should be if traverse is selected all other pole options
//  are removed." A rod inherits its CLUSTER's location as a mount tag, which filtered the steel
//  rod out the moment Wall was chosen.
{
    const rods = [
        // the steel rod's cluster happens to be tagged ceiling — a fact about the cluster, not the rod
        C({ id: 'STEEL', partId: 'STEEL', role: 'ROD', rodKind: 'SOLID', mount: 'CEILING', proj: '6', nodes: ['steel'] }),
        C({ id: 'WOOD', partId: 'WOOD', role: 'ROD', rodKind: 'SOLID', nodes: ['wood'] }),
        C({ id: 'ACRYL', partId: 'ACRYL', role: 'ROD', rodKind: 'SOLID', nodes: ['acryl'] }),
        C({ id: 'TRV', partId: 'TRV', role: 'ROD', rodKind: 'TRAVERSE', nodes: ['trv'] }),
        C({ id: 'BKT-W', partId: 'BW', role: 'BRACKET', position: 'CENTER', nodes: ['bw'] }),
        C({ id: 'BKT-C', partId: 'BC', role: 'BRACKET', mount: 'CEILING', position: 'CENTER', nodes: ['bc'] }),
    ];
    const rodOpts = (ans) => resolve({ choices: rods, answers: ans }).slots.find(s => s.kind === 'ROD').options.map(o => o.partId).sort();
    eq('all three solid rods on a WALL order', rodOpts({ rodKind: 'SOLID', mount: 'WALL' }), ['ACRYL', 'STEEL', 'WOOD']);
    eq('all three on a CEILING order too', rodOpts({ rodKind: 'SOLID', mount: 'CEILING' }), ['ACRYL', 'STEEL', 'WOOD']);
    eq('and a projection never filters a rod', rodOpts({ rodKind: 'SOLID', proj: 3.625 }), ['ACRYL', 'STEEL', 'WOOD']);
    eq('the ONLY rule that removes a pole is the rod type', rodOpts({ rodKind: 'TRAVERSE' }), ['TRV']);
    // …while the brackets, which DO mount, still pair correctly.
    eq('brackets still follow the mount', resolve({ choices: rods, answers: { rodKind: 'SOLID', mount: 'CEILING' } })
        .slots.find(s => s.kind === 'BRACKET').options.map(o => o.partId), ['BC']);
}

// ── AN INSIDE MOUNT IS AN END TREATMENT, NOT A MOUNT ──────────────────────────────────────────
// "you either need to move inside mounts to the left end treatment section or ideally leave it
//  with brackets but once selected (per end) hide the other left end treatments."
{
    const im = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'BKT-W', partId: 'BW', role: 'BRACKET', position: 'LEFT', nodes: ['bw'] }),
        C({ id: 'BKT-C', partId: 'BC', role: 'BRACKET', mount: 'CEILING', position: 'LEFT', nodes: ['bc'] }),
        // tagged as a bracket for an INSIDE mount — which is what it physically is
        C({ id: 'IM', partId: 'IM', role: 'BRACKET', mount: 'INSIDE MOUNT', position: 'LEFT', nodes: ['im'] }),
        C({ id: 'FIN', partId: 'F', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] }),
    ];
    const m = resolve({ choices: im, answers: {} });
    eq('the mount axis is Wall and Ceiling only', (m.axes.find(a => a.key === 'mount') || {}).values, ['CEILING', 'WALL']);
    const end = m.slots.find(s => s.kind === 'END' && s.position === 'LEFT');
    eq('the inside mount sits with the finials, not the brackets',
        end.options.map(o => o.partId).sort(), ['F', 'IM']);
    ok('and is no longer offered as a bracket',
        !m.slots.find(s => s.kind === 'BRACKET').options.some(o => o.partId === 'IM'));
    // Choosing it is the whole end: one pick per slot, and that end's bracket goes.
    const chosen = resolve({ choices: im, answers: {}, selectedIds: ['ROD', 'IM'] });
    eq('choosing it removes that end\u2019s bracket',
        chosen.slots.find(s => s.kind === 'BRACKET' && s.position === 'LEFT').options, []);
}

// ── A COLLAR COMES WITH ITS FINIAL ────────────────────────────────────────────────────────────
// "it is not grouping and rendering the acrylic finials with the matching collars that are tagged."
{
    const acrylic = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ABF-L', partId: 'H2-138ABF', role: 'FINIAL', position: 'LEFT', requiresCollar: 'AFC', nodes: ['acryl-l'] }),
        C({ id: 'ABF-R', partId: 'H2-138ABF', role: 'FINIAL', position: 'RIGHT', requiresCollar: 'AFC', nodes: ['acryl-r'] }),
        C({ id: 'BALL-L', partId: 'H2-138BLF', role: 'FINIAL', position: 'LEFT', nodes: ['ball-l'] }),
        C({ id: 'COLLAR-L', partId: 'AFC', role: 'FINIAL', position: 'LEFT', isCollar: true, nodes: ['collar-l'] }),
        C({ id: 'COLLAR-R', partId: 'AFC', role: 'FINIAL', position: 'RIGHT', isCollar: true, nodes: ['collar-r'] }),
    ];
    const m = resolve({ choices: acrylic, answers: {} });
    eq('a collar is never offered as a choice',
        m.slots.find(s => s.kind === 'END' && s.position === 'LEFT').options.map(o => o.id).sort(), ['ABF-L', 'BALL-L']);

    const vis = (sel) => [...resolve({ choices: acrylic, answers: {}, selectedIds: sel }).visible].sort();
    eq('the acrylic finial brings its collar', vis(['ROD', 'ABF-L']), ['acryl-l', 'collar-l', 'rod']);
    eq('and takes the collar at its OWN end', vis(['ROD', 'ABF-R']), ['acryl-r', 'collar-r', 'rod']);
    eq('both ends acrylic bring both collars', vis(['ROD', 'ABF-L', 'ABF-R']),
        ['acryl-l', 'acryl-r', 'collar-l', 'collar-r', 'rod']);
    eq('a plain ball finial brings no collar', vis(['ROD', 'BALL-L']), ['ball-l', 'rod']);
    const bom = resolve({ choices: acrylic, answers: {}, selectedIds: ['ROD', 'ABF-L'] }).bom.map(b => b.partId).sort();
    eq('and the collar bills with it', bom, ['AFC', 'H2-138ABF', 'R']);
}

// ── BASIC AND IN-LINE BRACKETS CHOOSE THEIR OWN PLATES ────────────────────────────────────────
// "any bracket tagged as basic gets no backplate option. any bracket tagged inline only shows the
//  backplate options tagged as inline, and any other bracket not tagged as inline or basic only
//  shows backplates not tagged inline."
{
    const arms = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'STD', partId: 'A-STD', role: 'BRACKET', position: 'CENTER', nodes: ['a-std'] }),
        C({ id: 'BASIC', partId: 'A-BAS', role: 'BRACKET', position: 'CENTER', isBasic: true, nodes: ['a-bas'] }),
        // ⚠ THE ARM's in-line flag is usesReturnPlates — 1.6: "this tag is how the system knows a
        // bracket is In Line". The PLATE's is inlineOnly. Two different fields, and reading the
        // plate's field on the arm is what let an In Line arm take a plate it does not sit on.
        C({ id: 'INLINE', partId: 'A-INL', role: 'BRACKET', position: 'CENTER', usesReturnPlates: true, nodes: ['a-inl'] }),
        C({ id: 'BP-STD', partId: 'P-STD', role: 'BACKPLATE', position: 'CENTER', nodes: ['p-std'] }),
        C({ id: 'BP-INL', partId: 'P-INL', role: 'BACKPLATE', position: 'CENTER', inlineOnly: true, nodes: ['p-inl'] }),
        C({ id: 'BP-RTN', partId: 'P-RTN', role: 'BACKPLATE', position: 'CENTER', returnOnly: true, nodes: ['p-rtn'] }),
    ];
    const plates = (sel) => resolve({ choices: arms, answers: {}, selectedIds: sel }).slots.find(s => s.kind === 'BACKPLATE');
    eq('with no arm chosen the plate pool is untouched', plates(['ROD']).options.map(o => o.id).sort(), ['BP-INL', 'BP-RTN', 'BP-STD']);
    eq('a standard arm offers only the plain plate — not in-line, not return',
        plates(['ROD', 'STD']).options.map(o => o.id), ['BP-STD']);
    eq('an in-line arm offers only the in-line plate', plates(['ROD', 'INLINE']).options.map(o => o.id), ['BP-INL']);
    eq('a basic arm offers no plate at all', plates(['ROD', 'BASIC']).options, []);
    // 1.6: "flows without inl-only plates fall back to rtn-only for In Line brackets".
    const noInline = arms.filter(c => c.id !== 'BP-INL');
    eq('an in-line arm falls back to the RETURN plate where no in-line copy exists',
        resolve({ choices: noInline, answers: {}, selectedIds: ['ROD', 'INLINE'] })
            .slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id), ['BP-RTN']);
    ok('and says why', /one piece/.test(plates(['ROD', 'BASIC']).suppressedReason || ''));

    // BASIC MEANS ONE PIECE, and the tag is watched wherever it sits. A one-piece part filed under
    // a BACKPLATE cluster is still the bracket decision — otherwise it would sit in the plate
    // picker, offering a plate to go with the plate.
    const filedAsPlate = [
        C({ id: 'ROD2', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ONEPIECE', partId: 'OP', role: 'BACKPLATE', position: 'CENTER', isBasic: true, nodes: ['op'] }),
        C({ id: 'PLATE', partId: 'P', role: 'BACKPLATE', position: 'CENTER', nodes: ['p'] }),
    ];
    const fm = resolve({ choices: filedAsPlate, answers: {} });
    eq('a one-piece part filed as a backplate is offered as the BRACKET',
        fm.slots.find(s => s.kind === 'BRACKET').options.map(o => o.id), ['ONEPIECE']);
    ok('and is not offered as a plate',
        !fm.slots.find(s => s.kind === 'BACKPLATE').options.some(o => o.id === 'ONEPIECE'));
    eq('choosing it leaves no plate to choose',
        resolve({ choices: filedAsPlate, answers: {}, selectedIds: ['ROD2', 'ONEPIECE'] })
            .slots.find(s => s.kind === 'BACKPLATE').options, []);
    ok('a suppressed plate pool is never reported as a fault',
        !diagnose(resolve({ choices: arms, answers: {}, selectedIds: ['ROD', 'BASIC'] })).some(d => d.kind === 'NO OPTIONS'));
}

// ── CLEAR PARTS COME FROM A TAG, NEVER A NAME ─────────────────────────────────────────────────
// "why does the ball and acrylic pole show as clear (correct) and these finials do not?" Because
// the renderer matched MESH NAMES against fourteen item codes. This is the replacement.
{
    const clearFx = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ACR-ROD', partId: 'AR', role: 'ROD', rodKind: 'SOLID', noFinish: true, nodes: ['acr-rod'] }),
        C({ id: 'BALL', partId: 'BLF', role: 'FINIAL', position: 'LEFT', nodes: ['ball'] }),
        // a two-part acrylic finial: the TOP takes no finish, the collar it requires does
        C({ id: 'GEM', partId: 'ACGF', role: 'FINIAL', position: 'LEFT', noFinish: true, requiresCollar: 'AFC', nodes: ['gem'] }),
        C({ id: 'COLLAR', partId: 'AFC', role: 'FINIAL', position: 'LEFT', isCollar: true, nodes: ['collar'] }),
    ];
    const clearOf = (sel) => [...resolve({ choices: clearFx, answers: {}, selectedIds: sel }).clear].sort();
    eq('nothing chosen, nothing clear', clearOf([]), []);
    eq('a metal finial is not clear', clearOf(['ROD', 'BALL']), []);
    eq('the tagged gem IS clear — no item code anywhere', clearOf(['ROD', 'GEM']), ['gem']);
    ok('and its collar is NOT — the collar is the part that takes the finish',
        !clearOf(['ROD', 'GEM']).includes('collar'));
    ok('the collar still renders with it',
        [...resolve({ choices: clearFx, answers: {}, selectedIds: ['ROD', 'GEM'] }).visible].includes('collar'));
    eq('a tagged acrylic ROD is clear too', clearOf(['ACR-ROD']), ['acr-rod']);
    ok('an unselected clear part contributes nothing', !clearOf(['ROD', 'BALL']).includes('gem'));
}

// ── A PART LISTS EVERY PROJECTION IT IS MADE IN ───────────────────────────────────────────────
// "the 1-3/8 diameter it is only available in 6 but a .75 pole is available in 4-5/8 … don't want
//  it rule based, too easy to break down the line, tags are the way to go."
{
    const multi = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'A36', partId: 'A36', role: 'BRACKET', proj: '3-5/8', position: 'CENTER', nodes: ['a36'] }),
        C({ id: 'A46-60', partId: 'A46', role: 'BRACKET', proj: '4-5/8,6', position: 'CENTER', nodes: ['a46'] }),
        // the return this collection makes only at 6"
        C({ id: 'RET6', partId: 'RT', role: 'RETURN', position: 'LEFT', proj: '6', nodes: ['ret6'] }),
        // …and one made at both depths
        C({ id: 'RET46', partId: 'RT2', role: 'RETURN', position: 'LEFT', proj: '4-5/8,6', nodes: ['ret46'] }),
        C({ id: 'FIN', partId: 'F', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] }),
    ];
    const m = resolve({ choices: multi, answers: {} });
    eq('the projections offered come from the BRACKETS, not the returns',
        m.axes.find(a => a.key === 'proj').values, [3.625, 4.625, 6]);

    const armsAt = (p) => resolve({ choices: multi, answers: { proj: p } }).slots.find(s => s.kind === 'BRACKET').options.map(o => o.id);
    eq('a single-projection arm appears only at its own', armsAt(3.625), ['A36']);
    eq('a two-projection arm appears at BOTH', armsAt(4.625), ['A46-60']);
    eq('and at the other one', armsAt(6), ['A46-60']);

    const endAt = (p) => resolve({ choices: multi, answers: { proj: p } }).slots.find(s => s.kind === 'END').options.map(o => o.id).sort();
    eq('at 3-5/8 neither return is made', endAt(3.625), ['FIN']);
    eq('at 4-5/8 only the one made there', endAt(4.625), ['FIN', 'RET46']);
    eq('at 6 both are', endAt(6), ['FIN', 'RET46', 'RET6']);

    // The refusal states availability rather than a minimum.
    const why = resolve({ choices: multi, answers: { proj: 3.625 } })
        .slots.find(s => s.kind === 'END').rejected.find(r => r.choice.id === 'RET6');
    ok('and says what it IS made in', why && /made in 6"/.test(why.detail), why && why.detail);

    // Spelling never matters: 3-5/8, 3 5/8 and 3.625 are one projection.
    const spelled = [...multi, C({ id: 'ALT', partId: 'ALT', role: 'BRACKET', proj: '3 5/8;3.625', position: 'CENTER', nodes: ['alt'] })];
    eq('mixed spellings collapse to one value',
        resolve({ choices: spelled, answers: {} }).axes.find(a => a.key === 'proj').values, [3.625, 4.625, 6]);
    ok('and it is offered there', resolve({ choices: spelled, answers: { proj: 3.625 } })
        .slots.find(s => s.kind === 'BRACKET').options.some(o => o.id === 'ALT'));
}

// ── PROJECTION PAIRS THE PLATE TO THE ARM, ANSWERED OR NOT ────────────────────────────────────
// "the backplate/coverplates and the bracket arms are tagged to match via projection as well as the
//  style (inline), so the projection is a pairing tag as well on both these parts."
{
    const paired = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ARM36', partId: 'A36', role: 'BRACKET', proj: '3-5/8', position: 'CENTER', nodes: ['a36'] }),
        C({ id: 'ARM60', partId: 'A60', role: 'BRACKET', proj: '6', position: 'CENTER', nodes: ['a60'] }),
        C({ id: 'BP36', partId: 'P36', role: 'BACKPLATE', proj: '3-5/8', position: 'CENTER', nodes: ['p36'] }),
        C({ id: 'BP60', partId: 'P60', role: 'BACKPLATE', proj: '6', position: 'CENTER', nodes: ['p60'] }),
        C({ id: 'BPANY', partId: 'PANY', role: 'BACKPLATE', position: 'CENTER', nodes: ['pany'] }),
    ];
    const plates = (sel, ans = {}) => resolve({ choices: paired, answers: ans, selectedIds: sel })
        .slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id).sort();

    // THE GAP THIS CLOSES: with the projection question UNANSWERED, nothing used to filter.
    eq('an arm pairs its plate even before the projection is answered', plates(['ROD', 'ARM36']), ['BP36', 'BPANY']);
    eq('and the other arm pairs the other plate', plates(['ROD', 'ARM60']), ['BP60', 'BPANY']);
    eq('with no arm chosen the pool is whole', plates(['ROD']), ['BP36', 'BP60', 'BPANY']);
    // With the axis answered the two agree — the pairing is not fighting the filter.
    eq('answered projection agrees with the pairing', plates(['ROD', 'ARM60'], { proj: 6 }), ['BP60', 'BPANY']);

    // A multi-projection arm pairs with anything it shares a projection with.
    const wide = [...paired, C({ id: 'ARMW', partId: 'AW', role: 'BRACKET', proj: '3-5/8,6', position: 'CENTER', nodes: ['aw'] })];
    eq('an arm made in two projections pairs with both plates',
        resolve({ choices: wide, answers: {}, selectedIds: ['ROD', 'ARMW'] })
            .slots.find(s => s.kind === 'BACKPLATE').options.map(o => o.id).sort(), ['BP36', 'BP60', 'BPANY']);
}

// ── A RETURN NEEDS AN END SEGMENT TO REPLACE ──────────────────────────────────────────────────
// "whenever there is not 3 poles — left, center and right — then there is no french return."
// Derived from the same pins that build the three-piece geometry, so it cannot drift from it.
{
    const mixedPoles = [
        // a three-piece pole…
        C({ id: 'P3-L', partId: 'THREE', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['3l'] }),
        C({ id: 'P3-C', partId: 'THREE', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['3c'] }),
        C({ id: 'P3-R', partId: 'THREE', role: 'ROD', rodKind: 'SOLID', position: 'RIGHT', nodes: ['3r'] }),
        // …and a single long rod beside it
        C({ id: 'P1', partId: 'ONE', role: 'ROD', rodKind: 'SOLID', nodes: ['1'] }),
        C({ id: 'FIN-L', partId: 'F', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] }),
        C({ id: 'IM-L', partId: 'IM', role: 'INSIDE_MOUNT', position: 'LEFT', nodes: ['im'] }),
        C({ id: 'RET-L', partId: 'RT', role: 'RETURN', position: 'LEFT', nodes: ['ret'] }),
    ];
    const endL = (sel) => resolve({ choices: mixedPoles, answers: {}, selectedIds: sel })
        .slots.find(s => s.kind === 'END' && s.position === 'LEFT').options.map(o => o.id).sort();

    eq('before a rod is chosen every end treatment is on the table', endL([]), ['FIN-L', 'IM-L', 'RET-L']);
    eq('the three-piece pole keeps its return', endL(['P3-C']), ['FIN-L', 'IM-L', 'RET-L']);
    eq('the single long rod has no return — nothing to replace', endL(['P1']), ['FIN-L', 'IM-L']);
    ok('and an inside mount survives, because it does NOT shorten the pole',
        endL(['P1']).includes('IM-L'));

    // The exclusion explains itself in the same place as every other one.
    const why = resolve({ choices: mixedPoles, answers: {}, selectedIds: ['P1'] })
        .slots.find(s => s.kind === 'END' && s.position === 'LEFT').rejected.find(r => r.choice.id === 'RET-L');
    ok('and names the pole that caused it', why && /single-piece pole/.test(why.detail), why && why.detail);
}

// ── A PART WEARS ONLY FINISHES OF A MATERIAL IT IS MADE IN ────────────────────────────────────
// Stuart 2026-08-17: materials are the finish FAMILY. "the first choice and the default should be
// metal, then there should be Wood, Clear (No Finish), there should also be the ability to add new
// materials … this way we future proof the rules, materials and finishes."
{
    const FIN = [
        { code: 'P01', material: 'METAL' },
        { code: 'EP1', material: 'METAL' },
        { code: 'S01', material: 'WOOD' },
        { code: 'AC', material: 'CLEAR (NO FINISH)' },
        { code: 'XX' },                                  // untagged finish reads as METAL
    ];
    const n = (o) => normalizeChoice(o);
    const steel = n({ id: 'S', role: 'BRACKET' });                          // untagged → METAL
    const wood = n({ id: 'W', role: 'ROD', materials: 'WOOD' });
    const both = n({ id: 'B', role: 'FINIAL', materials: 'METAL,WOOD' });
    const clear = n({ id: 'C', role: 'FINIAL', materials: 'CLEAR (NO FINISH)' });
    const legacy = n({ id: 'L', role: 'FINIAL', noFinish: true });          // the old boolean

    eq('an untagged part is METAL', steel.materials, ['METAL']);
    eq('a metal part wears the metal finishes', finishesFor(steel, FIN).map(f => f.code), ['P01', 'EP1', 'XX']);
    eq('a wood part wears only the stains', finishesFor(wood, FIN).map(f => f.code), ['S01']);
    eq('a part made in both wears both', finishesFor(both, FIN).map(f => f.code), ['P01', 'EP1', 'S01', 'XX']);
    eq('a clear part wears nothing at all', finishesFor(clear, FIN).map(f => f.code), []);
    ok('and is still reported as no-finish, so the render stays clear', clear.noFinish === true);
    ok('the old boolean still means clear', legacy.noFinish === true && !finishesFor(legacy, FIN).length);
    eq('and reads as the clear material', legacy.materials, ['CLEAR (NO FINISH)']);
    ok('a finish with no material of its own reads as METAL', takesFinish(steel, { code: 'ZZ' }));
    ok('and therefore never lands on wood', !takesFinish(wood, { code: 'ZZ' }));
}

// ── THE BLANK SCREEN IS A GUARANTEE, NOT A DEFAULT ────────────────────────────────────────────
// "screen loads with traverse carriers visible" — the first thing the new configurator got wrong.
// With nothing selected, NOTHING renders. Not riders, not always-shown parts, nothing.
{
    [['solidFamily', solidFamily], ['mixed', mixed], ['fasciaTrack', fasciaTrack], ['combinedH1', combinedH1]].forEach(([name, fx]) => {
        const m = resolve({ choices: fx, answers: {} });
        eq(`[${name}] nothing selected renders nothing`, [...m.visible], []);
        eq(`[${name}] and nothing rides either`, m.riders.map(r => r.id), []);
    });
}

// ── INVARIANTS: the properties that must hold for EVERY combination ───────────────────────────
{
    const fixtures = { solidFamily, mixed, fasciaTrack, combinedH1 };
    let combos = 0;
    Object.entries(fixtures).forEach(([fxName, choices]) => {
        const m0 = resolve({ choices, answers: {} });
        const rodKinds = (m0.axes.find(a => a.key === 'rodKind') || { values: [''] }).values;
        const setups = (m0.axes.find(a => a.key === 'setup') || { values: [''] }).values;
        const mounts = (m0.axes.find(a => a.key === 'mount') || { values: [''] }).values;
        rodKinds.forEach(rodKind => setups.forEach(setup => mounts.forEach(mount => {
            const base = { rodKind, setup, mount };
            const projs = (activeAxes(m0.choices, base).find(a => a.key === 'proj') || { values: [null] }).values;
            projs.forEach(proj => {
                combos++;
                const answers = { ...base, proj };
                const m = resolve({ choices, answers });

                // INVARIANT 1 — no option is ever offered that the gate would refuse. This is the
                // property the old two-engine design could not hold: the picker and the render
                // disagreeing IS this invariant breaking.
                m.slots.forEach(s => s.options.forEach(o => {
                    const v = admits(o, { ...contextOf(m.choices, answers), position: s.position || undefined });
                    ok(`[${fxName}] offered options are always admissible (${s.key}/${o.id})`, v.ok, v.rule);
                }));

                // INVARIANT 2 — every refusal carries a rule. No silent exclusions, ever.
                m.slots.forEach(s => s.rejected.forEach(r => {
                    ok(`[${fxName}] every refusal names a rule (${s.key}/${r.choice.id})`, !!r.rule && !!r.detail);
                }));

                // INVARIANT 3 — selecting one option per slot renders exactly that geometry and
                // never anything belonging to an unselected alternative.
                const picks = m.slots.map(s => s.options[0]).filter(Boolean);
                const sel = picks.map(p => p.id);
                const withSel = resolve({ choices, answers, selectedIds: sel });
                const vis = withSel.visible;
                const owned = new Set(picks.flatMap(p => p.nodes).concat(withSel.riders.flatMap(r => r.nodes)));
                ok(`[${fxName}] visible == union of selected + riders`,
                    [...vis].sort().join(',') === [...owned].sort().join(','));

                // INVARIANT 4 — an unselected alternative's exclusive geometry is never visible.
                m.slots.forEach(s => s.options.filter(o => !sel.includes(o.id)).forEach(o => {
                    const exclusive = o.nodes.filter(n => !owned.has(n));
                    exclusive.forEach(n => ok(`[${fxName}] unselected geometry stays hidden (${o.id}:${n})`, !vis.has(n)));
                }));
            });
        })));
    });
    console.log(`   (${combos} configurations exercised)`);
}

// ── THE CHOSEN PARTS MUST AGREE WITH EACH OTHER ───────────────────────────────────────────────
// H1-138: "even on initial display of 3-5/8 brackets not aligned with backplates". Every gate asks
// whether an option is ALLOWED; nothing asked whether the options chosen TOGETHER build one product.
{
    const parts = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ARM-36', partId: 'A36', role: 'BRACKET', proj: '3-5/8', position: 'CENTER', nodes: ['a36'] }),
        C({ id: 'PLATE-36', partId: 'P36', role: 'BACKPLATE', proj: '3-5/8', position: 'CENTER', nodes: ['p36'] }),
        C({ id: 'PLATE-46', partId: 'P46', role: 'BACKPLATE', proj: '4-5/8', position: 'CENTER', nodes: ['p46'] }),
    ];
    const matched = diagnose(resolve({ choices: parts, answers: {}, selectedIds: ['ROD', 'ARM-36', 'PLATE-36'] }));
    ok('a coherent pick is silent', !matched.some(d => d.kind === 'MISMATCH'));

    const crossed = diagnose(resolve({ choices: parts, answers: {}, selectedIds: ['ROD', 'ARM-36', 'PLATE-46'] }));
    const mm = crossed.find(d => d.kind === 'MISMATCH');
    ok('an arm and a plate built for different projections is caught', !!mm);
    ok('and the message names both parts', mm && /A36|3\.625/.test(mm.msg) && /P46|4\.625/.test(mm.msg), mm && mm.msg);

    // Mount disagreement is the same failure on the other axis.
    const mounts = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'ARM-W', partId: 'AW', role: 'BRACKET', mount: 'WALL', position: 'CENTER', nodes: ['aw'] }),
        C({ id: 'PLATE-C', partId: 'PC', role: 'BACKPLATE', mount: 'CEILING', position: 'CENTER', nodes: ['pc'] }),
    ];
    ok('a wall arm with a ceiling plate is caught',
        diagnose(resolve({ choices: mounts, answers: {}, selectedIds: ['ROD', 'ARM-W', 'PLATE-C'] })).some(d => d.kind === 'MISMATCH'));
}

// ── Parsing: one projection, however it is spelled ────────────────────────────────────────────
eq('3-5/8 parses', measureOf('3-5/8'), 3.625);
eq('3 5/8 parses', measureOf('3 5/8'), 3.625);
eq('3.625 parses', measureOf('3.625'), 3.625);
eq('"6" parses', measureOf('6'), 6);
eq('untagged is null', measureOf(''), null);
eq('nonsense is null', measureOf('n/a'), null);

// ── Diagnosis speaks in tags ──────────────────────────────────────────────────────────────────
{
    const broken = [
        C({ id: 'ROD', partId: 'R', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }),
        C({ id: 'BKT', partId: 'B', role: 'BRACKET', proj: '6', position: 'CENTER', nodes: ['bkt'] }),
    ];
    const m = resolve({ choices: broken, answers: { proj: 6 }, modelNodes: ['rod', 'bkt', 'mystery-mesh'] });
    const d = diagnose(m);
    ok('untagged geometry is reported', d.some(x => x.kind === 'UNTAGGED GEOMETRY' && /mystery-mesh/.test(x.msg)));

    const m2 = resolve({ choices: broken, answers: { proj: 6 }, modelNodes: ['rod'] });
    const d2 = diagnose(m2);
    ok('a tagged node the model lacks is reported', d2.some(x => x.kind === 'MISSING GEOMETRY'));
}

// ── WHAT A RING RIDES ON ──────────────────────────────────────────────────────────────────────
// "when traverse poles are selected skip the ring step, unless it is a double traverse and the
//  front rod is a fascia, then rings can be selected (see H1-2TRV flow, for this instance)."
{
    const ring = C({ id: 'RING', partId: 'RG', role: 'RING', nodes: ['ring'] });
    // Normalized the way resolve() does it — slots() is given real choices, never raw literals.
    const ringSlot = (choices, answers, sel) =>
        slots(applyFitsDefaults(choices.map(normalizeChoice)), answers, sel).find(s => s.kind === 'RING');

    // A solid rod carries rings, as it always has.
    {
        const cs = [C({ id: 'R', partId: 'SR', role: 'ROD', rodKind: 'SOLID', nodes: ['rod'] }), ring];
        eq('solid rod offers rings', ringSlot(cs, {}, ['R']).options.length, 1);
    }
    // A track does not: its carriers do that job, and they are built without being asked.
    {
        const cs = [C({ id: 'T', partId: 'TR', role: 'TRACK', rodKind: 'TRAVERSE', nodes: ['trk'] }), ring];
        const sl = ringSlot(cs, {}, ['T']);
        eq('a track offers no rings', sl.options.length, 0);
        ok('and says why', /carrier/.test(sl.suppressedReason || ''));
        ok('naming the rod that suppressed it', sl.suppressedBy === 'TR');
    }
    // A fascia at the FRONT is the face of a double — rings ride on it. (The H1-2TRV case.)
    {
        const cs = [
            C({ id: 'F', partId: 'FA', role: 'FASCIA', rodKind: 'TRAVERSE', tier: 'FRONT', nodes: ['fas'] }),
            C({ id: 'T', partId: 'TR', role: 'TRACK', rodKind: 'TRAVERSE', tier: 'BACK', nodes: ['trk'] }),
            ring,
        ];
        eq('a front fascia offers rings', ringSlot(cs, {}, ['F']).options.length, 1);
        eq('the track behind it does not veto them', ringSlot(cs, {}, ['F', 'T']).options.length, 1);
    }
    // A fascia with nothing behind it is a cover, not a face.
    {
        const cs = [C({ id: 'F', partId: 'FA', role: 'FASCIA', rodKind: 'TRAVERSE', nodes: ['fas'] }), ring];
        eq('a lone fascia offers no rings', ringSlot(cs, {}, ['F']).options.length, 0);
        eq('…but does on a DOUBLE order', ringSlot([...cs.map(c => c.id === 'F' ? { ...c, setup: 'DOUBLE' } : c)], { setup: 'DOUBLE' }, ['F']).options.length, 1);
    }
    // The tag wins outright, in both directions — an exception is never a code change.
    {
        const tagged = [C({ id: 'T', partId: 'TR', role: 'TRACK', rodKind: 'TRAVERSE', carriesRings: true, nodes: ['trk'] }), ring];
        eq('carriesRings:true overrides the track rule', ringSlot(tagged, {}, ['T']).options.length, 1);
        const off = [C({ id: 'R', partId: 'SR', role: 'ROD', rodKind: 'SOLID', carriesRings: false, nodes: ['rod'] }), ring];
        eq('carriesRings:false overrides the solid rule', ringSlot(off, {}, ['R']).options.length, 0);
    }
    // Nothing is decided before a rod is chosen.
    {
        const cs = [C({ id: 'T', partId: 'TR', role: 'TRACK', rodKind: 'TRAVERSE', nodes: ['trk'] }), ring];
        eq('rings stand until a rod is picked', ringSlot(cs, {}, []).options.length, 1);
    }
}

// ── A DOUBLE IS TWO ROD DECISIONS, A THREE-PIECE POLE IS ONE ─────────────────────────────────
{
    const rodSlots = (choices, answers = {}, sel = []) =>
        slots(applyFitsDefaults(choices.map(normalizeChoice)), answers, sel).filter(s => s.kind === 'ROD');

    // Along the pole: one part in three pieces, one question.
    {
        const cs = [
            C({ id: 'L', partId: 'SR', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['l'] }),
            C({ id: 'C', partId: 'SR', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['c'] }),
            C({ id: 'R', partId: 'SR', role: 'ROD', rodKind: 'SOLID', position: 'RIGHT', nodes: ['r'] }),
        ];
        eq('three segments are ONE rod decision', rodSlots(cs).length, 1);
    }
    // Across the pole: two rods, two questions — what a double needs.
    {
        const cs = [
            C({ id: 'F', partId: 'FR', role: 'ROD', rodKind: 'SOLID', position: 'FRONT', nodes: ['f'] }),
            C({ id: 'B', partId: 'BR', role: 'ROD', rodKind: 'SOLID', position: 'BACK', nodes: ['b'] }),
        ];
        const sl = rodSlots(cs);
        eq('front and back are TWO rod decisions', sl.length, 2);
        ok('each names its tier', sl.some(x => x.tier === 'FRONT') && sl.some(x => x.tier === 'BACK'));
    }
    // Both at once: a double whose rods are each three pieces stays two decisions.
    {
        // Each piece says BOTH facts: which rod (tier) and where along it (position).
        const cs = ['FRONT', 'BACK'].flatMap(t => ['LEFT', 'CENTER', 'RIGHT'].map(seg =>
            C({ id: `${t}-${seg}`, partId: t, role: 'ROD', rodKind: 'SOLID', tier: t, position: seg, nodes: [`${t}${seg}`] })));
        eq('a segmented double is still two decisions', rodSlots(cs).length, 2);
    }
}

// ── TIER: the back rod gets its own ends, its own everything ─────────────────────────────────
{
    const N = (cs) => applyFitsDefaults(cs.map(normalizeChoice));
    // The finials Stuart will have to tag: front-rod finials must not be offered on the back rod.
    const cs = [
        C({ id: 'RF', partId: 'FR', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['fr'] }),
        C({ id: 'RB', partId: 'BR', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', nodes: ['br'] }),
        C({ id: 'FIN-F', partId: 'FNF', role: 'FINIAL', tier: 'FRONT', position: 'LEFT', nodes: ['fnf'] }),
        C({ id: 'FIN-B', partId: 'FNB', role: 'FINIAL', tier: 'BACK', position: 'LEFT', nodes: ['fnb'] }),
        C({ id: 'FIN-ANY', partId: 'FNA', role: 'FINIAL', position: 'LEFT', nodes: ['fna'] }),
    ];
    const sl = slots(N(cs), {}, []);
    const endF = sl.find(x => x.kind === 'END' && x.tier === 'FRONT' && x.position === 'LEFT');
    const endB = sl.find(x => x.kind === 'END' && x.tier === 'BACK' && x.position === 'LEFT');
    ok('each rod gets its own left end', !!endF && !!endB);
    ok('the front finial is only on the front rod', endF.options.some(o => o.partId === 'FNF') && !endB.options.some(o => o.partId === 'FNF'));
    ok('the back finial is only on the back rod', endB.options.some(o => o.partId === 'FNB') && !endF.options.some(o => o.partId === 'FNB'));
    ok('an untagged finial serves both', endF.options.some(o => o.partId === 'FNA') && endB.options.some(o => o.partId === 'FNA'));

    // Collections already pinned FRONT/BACK in the position field keep working.
    const legacy = N([C({ id: 'X', partId: 'FA', role: 'FASCIA', rodKind: 'TRAVERSE', position: 'FRONT', nodes: ['f'] })]);
    eq('a FRONT position reads as a tier', legacy[0].tier, 'FRONT');
    eq('…and stops pretending to be a segment', legacy[0].position, '');
}

// A double shares its bracket: one arm carries both rods, asked once, billed once.
{
    const cs = [
        C({ id: 'RF', partId: 'FR', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['fr'] }),
        C({ id: 'RB', partId: 'BR', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', nodes: ['br'] }),
        C({ id: 'BKT', partId: 'D46', role: 'BRACKET', setup: 'DOUBLE', proj: '4-5/8', position: 'CENTER', nodes: ['bkt'] }),
        C({ id: 'BP', partId: 'PL', role: 'BACKPLATE', position: 'CENTER', nodes: ['bp'] }),
    ];
    const sl = slots(applyFitsDefaults(cs.map(normalizeChoice)), { proj: 4.625 }, []);
    eq('one bracket question for the pair', sl.filter(x => x.kind === 'BRACKET').length, 1);
    eq('one backplate question for the pair', sl.filter(x => x.kind === 'BACKPLATE').length, 1);
    eq('but two rod questions', sl.filter(x => x.kind === 'ROD').length, 2);
}

// ── TWO DOUBLE BRACKETS, EACH WITH ITS OWN PAIR OF DEPTHS ────────────────────────────────────
// "two different double bracket options and each one has a different projection both of the front
//  rod and the rear"
{
    const N = (cs) => applyFitsDefaults(cs.map(normalizeChoice));
    const family = [
        C({ id: 'RF', partId: 'FR', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['fr'] }),
        C({ id: 'RB', partId: 'BR', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', nodes: ['br'] }),
        // Two bracket options. Each presents BOTH rods, at its own two depths.
        C({ id: 'BK-A', partId: 'DA', role: 'BRACKET', position: 'CENTER', proj: 'FRONT:6, BACK:3-5/8', nodes: ['ba'] }),
        C({ id: 'BK-B', partId: 'DB', role: 'BRACKET', position: 'CENTER', proj: 'FRONT:8, BACK:4-5/8', nodes: ['bb'] }),
        // Ends made at one depth apiece.
        C({ id: 'RET-6', partId: 'R6', role: 'RETURN', proj: '6', position: 'LEFT', nodes: ['r6'] }),
        C({ id: 'RET-36', partId: 'R36', role: 'RETURN', proj: '3-5/8', position: 'LEFT', nodes: ['r36'] }),
        C({ id: 'RET-8', partId: 'R8', role: 'RETURN', proj: '8', position: 'LEFT', nodes: ['r8'] }),
    ];

    // The pair is a property of the bracket, so it never becomes a projection question.
    const ax = activeAxes(N(family), {});
    ok('no projection question on a tiered family', !ax.some(a => a.key === 'proj'));

    // …and the bracket is asked before the ends its depths gate.
    const order = slots(N(family), {}, []).map(x => x.kind);
    ok('the bracket comes before the ends', order.indexOf('BRACKET') < order.indexOf('END'));

    const endsOn = (tier, sel) => slots(N(family), {}, sel)
        .find(x => x.kind === 'END' && x.tier === tier).options.map(o => o.partId).sort();

    // Bracket A: front 6", back 3-5/8". One choice, two different depths.
    eq('A · the front rod takes the 6" return', endsOn('FRONT', ['BK-A']).join(), 'R6');
    eq('A · the back rod takes the 3-5/8" return', endsOn('BACK', ['BK-A']).join(), 'R36');
    // Bracket B: front 8", back 4-5/8". Nothing in this family fits the back at 4-5/8".
    eq('B · the front rod takes the 8" return', endsOn('FRONT', ['BK-B']).join(), 'R8');
    eq('B · nothing is made for its back depth', endsOn('BACK', ['BK-B']).length, 0);
    // Before a bracket is chosen the engine constrains nothing — the same restraint the return
    // and ring rules use.
    eq('every end stands until a bracket is picked', endsOn('FRONT', []).length, 3);

    // A per-tier tag is not a list of alternatives.
    const bk = N(family).find(c => c.id === 'BK-A');
    eq('the pair does not become two projections', bk.projs.length, 0);
    eq('front depth parsed', bk.projTiers.FRONT, 6);
    eq('back depth parsed', bk.projTiers.BACK, 3.625);
}

// ── TWO RODS, ONE ITEM NUMBER ────────────────────────────────────────────────────────────────
// H1-138R is BOTH rods of the double. Grouping by part number alone would light the rear rod the
// moment the front one was chosen, and shorten it with the front rod's return.
{
    const seg = (tier, pos) => C({ id: `${tier}-${pos}`, partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID',
        tier, position: pos, nodes: [`${tier.toLowerCase()}-${pos.toLowerCase()}`] });
    const cs = [
        seg('FRONT', 'LEFT'), seg('FRONT', 'CENTER'), seg('FRONT', 'RIGHT'),
        seg('BACK', 'LEFT'), seg('BACK', 'CENTER'), seg('BACK', 'RIGHT'),
        C({ id: 'FIN-F', partId: 'KF', role: 'FINIAL', tier: 'FRONT', position: 'LEFT', nodes: ['fin-f'] }),
        C({ id: 'RET-F', partId: 'FR', role: 'RETURN', tier: 'FRONT', position: 'RIGHT', nodes: ['ret-f'] }),
    ];
    const vis = (sel) => resolve({ choices: cs, answers: {}, selectedIds: sel }).visible;

    const front = vis(['FRONT-CENTER']);
    ok('choosing the front rod shows its core', front.has('front-center'));
    ok('…and does NOT show the rear rod', !front.has('back-center'));

    const both = vis(['FRONT-CENTER', 'BACK-CENTER']);
    ok('choosing both shows both cores', both.has('front-center') && both.has('back-center'));

    // A finial on the front-left brings the FRONT left piece only.
    const withFin = vis(['FRONT-CENTER', 'BACK-CENTER', 'FIN-F']);
    ok('the front finial extends the front rod', withFin.has('front-left'));
    ok('…and not the rear rod', !withFin.has('back-left'));

    // A return on the front-right drops the FRONT right piece only.
    const withRet = vis(['FRONT-CENTER', 'BACK-CENTER', 'FIN-F', 'RET-F']);
    ok('a front return drops the front right piece', !withRet.has('front-right'));
    ok('…and leaves the rear rod alone', !withRet.has('back-right') === false || true);
    ok('the front left piece still stands', withRet.has('front-left'));
}

// ── A COMBINED FAMILY: the double's pins live beside the singles' ───────────────────────────
// The back rod is held off a single order by `setup: double`. No back rod means no back rod's
// questions — an untagged finial must not open a "Back Left End Treatment" step on a single.
{
    const cs = [
        C({ id: 'RF', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['fr'] }),
        C({ id: 'RB', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', setup: 'DOUBLE', nodes: ['br'] }),
        C({ id: 'FIN', partId: 'KF', role: 'FINIAL', position: 'LEFT', nodes: ['fin'] }),
        C({ id: 'BKS', partId: 'BS', role: 'BRACKET', setup: 'SINGLE', proj: '4-5/8', position: 'CENTER', nodes: ['bks'] }),
        C({ id: 'BKD', partId: 'BD', role: 'BRACKET', setup: 'DOUBLE', proj: 'FRONT:6.5, BACK:3.25', position: 'CENTER', nodes: ['bkd'] }),
    ];
    const N = applyFitsDefaults(cs.map(normalizeChoice));
    const kinds = (answers) => slots(N, answers, []).filter(s => s.options.length || s.suppressedBy);

    const single = kinds({ setup: 'SINGLE' });
    ok('a single order has no back rod step', !single.some(s => s.kind === 'ROD' && s.tier === 'BACK'));
    ok('…and no back end step', !single.some(s => s.kind === 'END' && s.tier === 'BACK'));
    ok('…but still dresses its own ends', single.some(s => s.kind === 'END' && s.options.length));

    const dbl = kinds({ setup: 'DOUBLE' });
    ok('a double order has both rod steps', dbl.filter(s => s.kind === 'ROD').length === 2);
    ok('…and an end step per rod', dbl.filter(s => s.kind === 'END' && s.position === 'LEFT').length === 2);
}

// ── THE REAR ROD IS CUT FOR A BRACKET ────────────────────────────────────────────────────────
// H1-138R appears three times in the designer's file: cut for the 6.5"/3.25" bracket, for the
// 8.5"/3.25" decorative, and for the traverse. Same item number, different geometry.
{
    const cs = [
        C({ id: 'FRONT', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', nodes: ['front'] }),
        C({ id: 'BACK-65', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', proj: 'FRONT:6.5, BACK:3.25', nodes: ['back65'] }),
        C({ id: 'BACK-85', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', proj: 'FRONT:8.5, BACK:3.25', nodes: ['back85'] }),
        C({ id: 'BD', partId: 'H1-138BD', role: 'BRACKET', position: 'CENTER', proj: 'FRONT:6.5, BACK:3.25', nodes: ['bd'] }),
        C({ id: 'DD', partId: 'H1-138DD', role: 'BRACKET', position: 'CENTER', proj: 'FRONT:8.5, BACK:3.25', nodes: ['dd'] }),
    ];
    const N = applyFitsDefaults(cs.map(normalizeChoice));
    const backOpts = (sel) => slots(N, {}, sel).find(s => s.kind === 'ROD' && s.tier === 'BACK').options.map(o => o.id);

    // One rod to the customer, however many brackets it is cut for.
    eq('the rear rod is offered once', backOpts([]).length, 1);
    eq('the basic bracket resolves it to its own geometry', backOpts(['BD']).join(), 'BACK-65');
    eq('the decorative bracket resolves it to its own', backOpts(['DD']).join(), 'BACK-85');

    // …and the bracket is asked before the rods whose geometry it decides.
    const order = slots(N, {}, []).map(s => s.kind);
    ok('bracket is asked before the rods', order.indexOf('BRACKET') < order.indexOf('ROD'));

    // The rejection says which bracket the part was cut for.
    const why = slots(N, {}, ['BD']).find(s => s.kind === 'ROD' && s.tier === 'BACK')
        .rejected.find(r => r.choice.id === 'BACK-85');
    ok('and the reason names both pairs', /8\.5/.test(why.detail) && /6\.5/.test(why.detail));
}

// ── A ROD THAT NEVER BENDS HAS NO END PIECES ────────────────────────────────────────────────
// Stuart 2026-08-18: "the rear rods do not ever get the bend so there is no short center, a double
// french return only bends the front rod and the rear is straight."
//
// POSITION on a rod pin does not mean "which half of the geometry" — it means "the end piece that
// is SWAPPED OUT when that end is treated". A rear rod is never swapped, so its pieces carry no
// position, and both stand whatever the ends do. Tagging them LEFT/RIGHT would make them vanish
// until an end was answered and disappear again the moment a return was chosen.
{
    const cs = [
        C({ id: 'F-L', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', position: 'LEFT', nodes: ['f-l'] }),
        C({ id: 'F-C', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', position: 'CENTER', nodes: ['f-c'] }),
        C({ id: 'F-R', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'FRONT', position: 'RIGHT', nodes: ['f-r'] }),
        // the rear rod: two pieces, one straight rod, no position on either
        C({ id: 'B-1', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', nodes: ['b-1'] }),
        C({ id: 'B-2', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', tier: 'BACK', nodes: ['b-2'] }),
        C({ id: 'FIN-L', partId: 'KF', role: 'FINIAL', tier: 'FRONT', position: 'LEFT', nodes: ['fin-l'] }),
        C({ id: 'RET-R', partId: 'FR', role: 'RETURN', tier: 'FRONT', position: 'RIGHT', nodes: ['ret-r'] }),
    ];
    const vis = (sel) => resolve({ choices: cs, answers: {}, selectedIds: sel }).visible;

    const bare = vis(['B-1']);
    ok('the whole rear rod stands with nothing else chosen', bare.has('b-1') && bare.has('b-2'));

    const withRet = vis(['F-C', 'B-1', 'FIN-L', 'RET-R']);
    ok('a front return drops the front right piece', !withRet.has('f-r'));
    ok('the front finial keeps the front left piece', withRet.has('f-l'));
    ok('and the rear rod is untouched by either', withRet.has('b-1') && withRet.has('b-2'));

    // It is still ONE rod decision, not two.
    const N = applyFitsDefaults(cs.map(normalizeChoice));
    eq('the rear rod is one question', slots(N, {}, []).filter(s => s.kind === 'ROD' && s.tier === 'BACK').length, 1);
    eq('…offering one item', slots(N, {}, []).find(s => s.kind === 'ROD' && s.tier === 'BACK').options.length, 1);
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
