// The spec sheet's rows — the same pairing the CPQ makes, drawn instead of listed.
//   node scripts/specSheetRows.test.mjs
//
// The old sheet worked the arm↔plate pairing out for itself, off node names and geometry, and got
// it wrong in ways the configurator never did. These assertions exist to prove the sheet is not
// deciding anything: it answers the arm and asks the engine what follows.

import { sheetRows, armsOf, platesForArm, rodForArm, visibleNodesForRow } from '../src/components/SpecSheet/specSheetRows.js';
import { resolve } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// H1-138's shape: one rod, four arms — basic (one piece), in-line, decorative, and a plain one —
// with the three plate pools tagged as they are in 1.6.
const CHOICES = [
    { id: 'ROD', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rod'] },
    { id: 'ARM-B', partId: 'H1-138B6', role: 'BRACKET', position: 'LEFT', proj: '6', isBasic: true, nodes: ['ab'] },
    { id: 'ARM-IL', partId: 'H1-138IL6', role: 'BRACKET', position: 'LEFT', proj: '6', usesReturnPlates: true, nodes: ['ai'] },
    { id: 'ARM-D', partId: 'H1-138D6', role: 'BRACKET', position: 'LEFT', proj: '6', nodes: ['ad'] },
    { id: 'PL-IN', partId: 'H1-138BP-INL', role: 'BACKPLATE', position: 'LEFT', proj: '6', inlineOnly: true, nodes: ['pi'] },
    { id: 'PL-CP', partId: 'H1-138CP-INL', role: 'BACKPLATE', position: 'LEFT', proj: '6', inlineOnly: true, nodes: ['pc'] },
    { id: 'PL-RTN', partId: 'H1-138RBP', role: 'BACKPLATE', position: 'LEFT', proj: '6', returnOnly: true, nodes: ['pr'] },
    { id: 'PL-STD', partId: 'H1-138BP-S', role: 'BACKPLATE', position: 'LEFT', proj: '6', nodes: ['ps'] },
];
const rows = sheetRows({ choices: CHOICES, rodId: 'ROD' });
const row = (code) => rows.find(r => r.arm.partId === code);
const codes = (r) => (r ? r.plates.map(p => p.partId).sort() : null);

// ── EVERY ARM GETS A ROW ─────────────────────────────────────────────────────────────────────
{
    eq('one row per arm', rows.length, 3);
    ok('and one row per PART, not per pin', new Set(rows.map(r => r.arm.partId)).size === rows.length);
}

// ── AND THE PLATES ON IT ARE THE ONES THE CPQ WOULD OFFER ────────────────────────────────────
{
    // "basic renders with no backplates"
    eq('a basic arm draws alone', codes(row('H1-138B6')), []);
    ok('…and the row says why, in the engine\'s own words', /one piece/.test(row('H1-138B6').reason));

    // "inline renders with inline back and cover plates"
    eq('an in-line arm draws the in-line back AND cover plates',
        codes(row('H1-138IL6')), ['H1-138BP-INL', 'H1-138CP-INL']);
    ok('and never the return copy', !codes(row('H1-138IL6')).includes('H1-138RBP'));

    // anything else takes the plain plates
    eq('a plain arm draws the plain plate', codes(row('H1-138D6')), ['H1-138BP-S']);
}

// ── THE PROJECTION GATE IS THE ENGINE'S, NOT A SECOND COPY ───────────────────────────────────
{
    const deep = CHOICES.map(c => (c.id === 'PL-STD' ? { ...c, proj: '4.625' } : c));
    const r = sheetRows({ choices: deep, rodId: 'ROD' }).find(x => x.arm.partId === 'H1-138D6');
    ok('a plate made at another depth is not on the sheet', !codes(r).includes('H1-138BP-S'));
}

// ── AND NOTHING IS INVENTED WHERE THERE IS NOTHING ───────────────────────────────────────────
{
    const bare = CHOICES.filter(c => c.role !== 'BACKPLATE');
    const r = sheetRows({ choices: bare, rodId: 'ROD' }).find(x => x.arm.partId === 'H1-138D6');
    eq('an assembly with no plates pinned draws arms only', codes(r), []);
    const model = resolve({ choices: bare, answers: {}, selectedIds: ['ROD'] });
    eq('armsOf reads the arms off the model', armsOf(model).length, 3);
    eq('and platesForArm with no arm is empty rather than throwing',
        platesForArm({ choices: model.choices, arm: null }).plates.length, 0);
}

// ── ONE ROW DRAWS ONE COMBINATION ────────────────────────────────────────────────────────────
// Stuart 2026-08-21: "each drop down should filter and only show the rod and bracket and arm
// assigned to it, you can see the rear rods from doubles showing on the single bracket."
{
    // A double: a front rod and a back rod, with an arm pinned at each tier.
    const DBL = [
        { id: 'ROD-F', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', tier: 'FRONT', nodes: ['rod-front'] },
        { id: 'ROD-B', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', tier: 'BACK', nodes: ['rod-back'] },
        { id: 'ARM-F', partId: 'H1-138B6', role: 'BRACKET', position: 'LEFT', tier: 'FRONT', nodes: ['arm-front'] },
        { id: 'ARM-B', partId: 'H1-138D6', role: 'BRACKET', position: 'LEFT', tier: 'BACK', nodes: ['arm-back'] },
    ];
    const m = resolve({ choices: DBL, answers: {}, selectedIds: [] });
    const arm = (id) => m.choices.find(c => c.id === id);

    eq('a front arm takes the front rod', rodForArm(m, arm('ARM-F'))?.id, 'ROD-F');
    eq('and a back arm takes the back one', rodForArm(m, arm('ARM-B'))?.id, 'ROD-B');

    const nodes = visibleNodesForRow({ choices: DBL, arm: arm('ARM-F'), rod: rodForArm(m, arm('ARM-F')) });
    ok('the row draws its own rod', nodes.has('rod-front'));
    ok('and its own arm', nodes.has('arm-front'));
    ok('NOT the rear rod from the double', !nodes.has('rod-back'));
    ok('and not the other arm', !nodes.has('arm-back'));

    // An untiered single is unaffected — it has one rod and draws it.
    const single = resolve({ choices: CHOICES, answers: {}, selectedIds: [] });
    eq('a single takes its only rod', rodForArm(single, single.choices.find(c => c.id === 'ARM-D'))?.id, 'ROD');
    ok('and an arm with nothing selected draws nothing rather than everything',
        visibleNodesForRow({ choices: CHOICES, arm: null }).size === 0);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
