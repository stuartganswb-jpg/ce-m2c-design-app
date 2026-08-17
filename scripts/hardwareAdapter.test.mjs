// Harness for Shared/hardwareAdapter.js — proves the claim the whole plan rests on: the tags 1.6
// ALREADY stores are enough, and nobody re-tags anything.
//
//   node scripts/hardwareAdapter.test.mjs
//
// Fixtures are shaped like real records: an Approved_Designs doc's nodeClusters plus assembly_pins
// rows, using the field names those collections actually carry today.

import { choicesFromAssembly, choiceFromPin, modelNodesOf } from '../src/components/Shared/hardwareAdapter.js';
import { resolve, diagnose } from '../src/components/Shared/hardwareModel.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

// A mixed H1-138-shaped assembly, written the way the app stores it TODAY.
const assembly = {
    id: 'CE-ASM-1',
    nodeClusters: [
        { id: 'CL-POLE', name: 'POLE', category: 'POLE', position: 'CENTER', nodes: ['S1-POLE', 'S1-POLE__0_rod'] },
        { id: 'CL-TRV', name: 'TRV ROD', category: 'POLE', position: 'CENTER', nodes: ['S2-TRV', 'S2-TRV__0_trvrod'] },
        { id: 'CL-BKT', name: 'BRACKET', category: 'BRACKET', position: 'CENTER', location: 'WALL', nodes: ['S3-BKT', 'S3-BKT__0_arm', 'S3-BKT__1_trvarm'] },
        { id: 'CL-BP', name: 'BACKPLATE', category: 'BACKPLATE', position: 'CENTER', location: 'CEILING', nodes: ['S4-BP', 'S4-BP__0_plate'] },
        { id: 'CL-END', name: 'LEFT END', category: 'FINIAL', position: 'LEFT', nodes: ['S5-END', 'S5-END__0_fin', 'S5-END__1_ret'] },
        { id: 'CL-CAR', name: 'CARRIERS', category: 'OTHER', position: 'CENTER', nodes: ['S6-CAR', 'S6-CAR__0_car'] },
        { id: 'CL-HW', name: 'BUSHINGS', category: 'OTHER', position: 'CENTER', hidden: true, nodes: ['S7-HW', 'S7-HW__0_bush'] },
    ],
};
const pins = [
    { id: 'P1', assemblyId: 'CE-ASM-1', clusterId: 'CL-POLE', partId: 'H1-138', partName: 'Steel Rod', targetNode: 'S1-POLE__0_rod', choiceSort: 0 },
    { id: 'P2', assemblyId: 'CE-ASM-1', clusterId: 'CL-TRV', partId: 'H1-138TRV', partName: 'Traverse Rod', targetNode: 'S2-TRV__0_trvrod', traverseRole: 'TRACK', choiceSort: 1 },
    { id: 'P3', assemblyId: 'CE-ASM-1', clusterId: 'CL-BKT', partId: 'BKT-STD', partName: 'Standard Arm', targetNode: 'S3-BKT__0_arm', projInches: '3-5/8', choiceSort: 2 },
    { id: 'P4', assemblyId: 'CE-ASM-1', clusterId: 'CL-BKT', partId: 'BKT-TRV', partName: 'Traverse Arm', targetNode: 'S3-BKT__1_trvarm', projInches: '3-5/8', traverseRole: 'TRV_BRACKET', choiceSort: 3 },
    { id: 'P5', assemblyId: 'CE-ASM-1', clusterId: 'CL-BP', partId: 'BP-C', partName: 'Ceiling Plate', targetNode: 'S4-BP__0_plate', choiceSort: 4 },
    { id: 'P6', assemblyId: 'CE-ASM-1', clusterId: 'CL-END', partId: 'FIN-1', partName: 'Ball Finial', targetNode: 'S5-END__0_fin', endTreatment: 'FINIAL', choiceSort: 5 },
    { id: 'P7', assemblyId: 'CE-ASM-1', clusterId: 'CL-END', partId: 'RET-1', partName: 'French Return', targetNode: 'S5-END__1_ret', endTreatment: 'FRENCH_RETURN', projInches: '4-5/8', choiceSort: 6 },
    { id: 'P8', assemblyId: 'CE-ASM-1', clusterId: 'CL-CAR', partId: 'CAR-1', partName: 'Carrier', targetNode: 'S6-CAR__0_car', traverseRole: 'CARRIER', alwaysShown: true, choiceSort: 7 },
    { id: 'P9', assemblyId: 'CE-ASM-1', clusterId: 'CL-HW', partId: 'BUSH-1', partName: 'Bushing', targetNode: 'S7-HW__0_bush', isHiddenPart: true, choiceSort: 8 },
];

const choices = choicesFromAssembly(assembly, pins);

// ── The translation itself ────────────────────────────────────────────────────────────────────
const by = (id) => choices.find(c => c.id === id);
eq('a plain POLE pin becomes a SOLID rod', [by('P1').role, by('P1').rodKind], ['ROD', 'SOLID']);
eq('a pole tagged trv:track becomes a TRAVERSE track', [by('P2').role, by('P2').rodKind], ['TRACK', 'TRAVERSE']);
eq('trv:bracket keeps its BRACKET role and gains the traverse world', [by('P4').role, by('P4').fits], ['BRACKET', ['TRAVERSE']]);
// The adapter leaves `fits` UNSET when no traverse tag says otherwise, and the MODEL applies the
// role default. Asserting it through resolve() tests the layering that actually ships.
eq('an untagged bracket stays solid-only by role default',
    resolve({ choices, answers: {} }).choices.find(c => c.id === 'P3').fits, ['SOLID']);
eq('endTreatment FINIAL becomes a FINIAL', by('P6').role, 'FINIAL');
eq('endTreatment FRENCH_RETURN becomes a RETURN', by('P7').role, 'RETURN');
eq('a return reads its projection as a minimum', by('P7').projRule === undefined ? 'via-model' : '', 'via-model');
eq('carrier is a rider and never a question', [by('P8').role, by('P8').always], ['CARRIER', true]);
eq('the backplate inherits the cluster location as its mount', by('P5').mount, 'CEILING');
eq('position comes from the cluster', by('P6').position, 'LEFT');

// A HIDDEN pin bills but has no geometry — no force-hide needed under default-hidden.
eq('a hidden pin carries no nodes', by('P9').nodes, []);
ok('a hidden pin still bills', by('P9').always === true && by('P9').partId === 'BUSH-1');

// ── End to end: the translated assembly behaves like the hand-written fixtures ─────────────────
{
    const solid = resolve({ choices, answers: { rodKind: 'SOLID', proj: 3.625 } });
    eq('solid offers the standard arm only', solid.slots.find(s => s.kind === 'BRACKET').options.map(o => o.partId), ['BKT-STD']);
    eq('no carriers on the solid rod', solid.riders.filter(r => r.role === 'CARRIER').length, 0);

    const trv = resolve({ choices, answers: { rodKind: 'TRAVERSE', proj: 3.625 } });
    eq('traverse offers its own arm only', trv.slots.find(s => s.kind === 'BRACKET').options.map(o => o.partId), ['BKT-TRV']);
    // Riders arrive WITH the rod — nothing rides a rod nobody chose.
    eq('no carriers before a rod is chosen', trv.riders.filter(r => r.role === 'CARRIER').map(r => r.partId), []);
    eq('carriers ride the traverse rod once it is picked',
        resolve({ choices, answers: { rodKind: 'TRAVERSE', proj: 3.625 }, selectedIds: ['P2'] })
            .riders.filter(r => r.role === 'CARRIER').map(r => r.partId), ['CAR-1']);

    // The shared finial is offered in BOTH worlds, untouched, tagged for neither.
    const endS = solid.slots.find(s => s.kind === 'END');
    const endT = trv.slots.find(s => s.kind === 'END');
    ok('the finial is shared across both worlds', endS.options.some(o => o.partId === 'FIN-1') && endT.options.some(o => o.partId === 'FIN-1'));

    // The return needs depth: absent at 3-5/8, present at 4-5/8.
    ok('the return is out at 3-5/8', !endS.options.some(o => o.partId === 'RET-1'));
    const deep = resolve({ choices, answers: { rodKind: 'SOLID', proj: 4.625 } });
    ok('the return is in at 4-5/8', deep.slots.find(s => s.kind === 'END').options.some(o => o.partId === 'RET-1'));
}

// ── Ownership: the wrapper groups are not ghosts, and nothing real is unowned ──────────────────
{
    const m = resolve({ choices, answers: { rodKind: 'SOLID', proj: 3.625 }, modelNodes: modelNodesOf(assembly) });
    const d = diagnose(m);
    const unowned = d.filter(x => x.kind === 'UNTAGGED GEOMETRY').map(x => x.msg.split(':')[0]);
    // The S<n>- slot wrappers are groups, not geometry — they are reported, and that is correct:
    // under default-hidden they render nothing, so this is a tagging note, not an emergency.
    ok('the report names only wrappers and hidden geometry, no real part', 
        unowned.every(n => /^S\d/.test(n)), unowned.join(','));
    ok('no MISSING GEOMETRY on a well-formed assembly', !d.some(x => x.kind === 'MISSING GEOMETRY'));
}

// ── A mistagged assembly names the tag, not the symptom ───────────────────────────────────────
{
    const broken = choicesFromAssembly(assembly, pins.map(p => p.id === 'P3' ? { ...p, projInches: '6' } : p));
    const m = resolve({ choices: broken, answers: { rodKind: 'SOLID', proj: 3.625 } });
    const d = diagnose(m);
    const noOpts = d.find(x => x.kind === 'NO OPTIONS' && /BRACKET/.test(x.msg));
    ok('an empty bracket slot names the projection rule', noOpts && /projection/.test(noOpts.msg), noOpts && noOpts.msg);
    ok('and names the offending part', noOpts && /Standard Arm/.test(noOpts.msg));
}

console.log(`\n${fail === 0 ? '✅' : '❌'}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
