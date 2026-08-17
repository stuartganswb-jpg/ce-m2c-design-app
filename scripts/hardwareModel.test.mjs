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
    resolve, diagnose, normalizeChoice, measureOf, activeAxes, admits, contextOf,
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

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
