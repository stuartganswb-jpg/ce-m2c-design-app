// Harness for Shared/partLookup.js — the read-only part lookup behind CPQ's search box.
//
//   node scripts/partLookup.test.mjs
//
// The fixtures are TONIGHT'S REAL DEFECTS (2026-09-03, Fabricut order 3), because a lookup whose
// whole purpose is "so above can be fixed when it occurs" is only worth having if it actually
// reports those two:
//
//   • CE-INV-60175 / H1-75ILE — "In Line Bracket (4-5/8" P)" pinned with proj 3.625". The customer
//     orders it as H3553F and it cannot be picked at 4-5/8"; nothing said why.
//   • CE-FEE-6294 — MITER RETURN tagged 6" only, so a 4-5/8" mitered return does not exist.
//
// The invariant under all of it: this module must never form its own opinion. Every admissibility
// answer has to come back identical to admits(), or there are two answers to one question again.

import { admits, contextOf } from '../src/components/Shared/hardwareModel.js';
import {
    buildLookupIndex, indexForAssembly, searchLookup, verdictFor, tagLinesOf, ourCodeOf,
} from '../src/components/Shared/partLookup.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};

// ── FIXTURE: the H1-75 assembly as it is pinned today ────────────────────────────────────────
// ⚠ Role and position come from the CLUSTER (category / position); projection, setup and the
// hidden flag come from the PIN (projInches / trvSetup / isHiddenPart). Getting these names wrong
// is why the first run of this harness indexed nothing — the fixture, not the code, was lying.
const assembly = {
    id: 'ASM-H1-75', itemId: 'CE-ASM-H1-75',
    nodeClusters: [
        { id: 'CL-BKT', category: 'BRACKET', position: 'CENTER', nodes: ['bkt'] },
        { id: 'CL-END', category: 'FINIAL', position: 'LEFT', nodes: ['end'] },
        { id: 'CL-ROD', category: 'POLE', nodes: ['rod'] },
        { id: 'CL-HID', category: 'OTHER', nodes: ['sleeve'] },
    ],
};

const pins = [
    // The defect: an EXTENDED (4-5/8") bracket carrying the STANDARD (3-5/8") projection tag.
    { id: 'P1', assemblyId: 'ASM-H1-75', clusterId: 'CL-BKT', partId: 'CE-INV-60175',
      partName: 'In Line Bracket (4-5/8" P)', projInches: '3-5/8', targetNode: 'bkt', sort: 1 },
    // Its correctly-tagged sibling, so a passing case exists beside the failing one.
    { id: 'P2', assemblyId: 'ASM-H1-75', clusterId: 'CL-BKT', partId: 'CE-INV-60054',
      partName: 'In Line Passing Bracket (4-5/8" P)', projInches: '4-5/8', targetNode: 'bkt', sort: 2 },
    // The second defect: the miter return exists only at 6".
    { id: 'P3', assemblyId: 'ASM-H1-75', clusterId: 'CL-END', partId: 'CE-FEE-6294',
      partName: 'MITER RETURN', endTreatment: 'MITER_RETURN', projInches: '6', targetNode: 'end', sort: 3 },
    // A rod: no projection, and that absence is NOT a defect.
    { id: 'P4', assemblyId: 'ASM-H1-75', clusterId: 'CL-ROD', partId: 'H1-75R',
      partName: '3/4" Round Hollow Rod Stock (14 GA)', targetNode: 'rod', sort: 4 },
    // Hidden = built and billed, never shown. It must still be findable — the shop asks about it.
    { id: 'P5', assemblyId: 'ASM-H1-75', clusterId: 'CL-HID', partId: 'H1-75SLV',
      partName: 'Internal Sleeve', isHiddenPart: true, targetNode: 'sleeve', sort: 5 },
];

const parts = [
    { id: 'CE-INV-60175', itemId: 'CE-INV-60175', legacyErpId: 'H1-75ILE',
      clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H3553F', price: '53' }] },
    { id: 'CE-INV-60054', itemId: 'CE-INV-60054', legacyErpId: 'H1-75ILPE',
      clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H3556F', price: '69' }] },
    { id: 'CE-FEE-6294', itemId: 'CE-FEE-6294', legacyErpId: 'H1-MRPF', clientPricing: [] },
    { id: 'H1-75R', itemId: 'H1-75R', legacyErpId: 'H1-75R',
      clientPricing: [{ customerId: 'CUST-4720', clientSku: 'H2578F', price: '9' }] },
    { id: 'H1-75SLV', itemId: 'H1-75SLV', legacyErpId: 'H1-75SLV', clientPricing: [] },
];

const findPart = (key) => parts.find(p => p.id === key || p.itemId === key || p.legacyErpId === key) || null;
const aliasCtx = { customerId: 'CUST-4720', customer: { id: 'CUST-4720', name: 'FABRICUT' }, findByCode: findPart };
const flow = { id: 'FLOW-75', name: '3/4" Round Rod', linkedAssemblyId: 'ASM-H1-75', sizeGroupLabel: 'Fabricut H1', sizeGroupChoice: 'H1-75' };

const index = indexForAssembly({ assembly, pins, flow, findPart, aliasCtx });

// ── IDENTITY ─────────────────────────────────────────────────────────────────────────────────
ok('index covers every pin', index.length === 5, `got ${index.length}`);
eq('ourCodeOf prefers the ERP code', ourCodeOf(parts[0]), 'H1-75ILE');

const ile = index.find(r => r.ours === 'H1-75ILE');
eq('their code resolves from the negotiated row', ile.theirs, 'H3553F');
eq('description carried from the pin', ile.name, 'In Line Bracket (4-5/8" P)');
eq('flow named', [ile.flowGroup, ile.flowChoice], ['Fabricut H1', 'H1-75']);

// ── SEARCH: THEIR NUMBER IS THE POINT ────────────────────────────────────────────────────────
eq('their code finds our part', searchLookup('H3553F', index).map(r => r.ours), ['H1-75ILE']);
eq('our code finds it too', searchLookup('H1-75ILE', index).map(r => r.ours), ['H1-75ILE']);
eq('punctuation ignored on codes', searchLookup('h175ile', index).map(r => r.ours), ['H1-75ILE']);
eq('their pole code', searchLookup('H2578F', index).map(r => r.ours), ['H1-75R']);
ok('description search works', searchLookup('miter', index).some(r => r.ours === 'H1-MRPF'));
eq('a one-character term is not a search', searchLookup('H', index), []);
ok('an unknown code returns nothing', searchLookup('ZZZ999', index).length === 0);
ok('hidden parts are still findable', searchLookup('H1-75SLV', index).some(r => r.hidden));

// Their number outranks ours when a term could be either.
const both = [...index, { ...index[0], key: 'x', ours: 'H3553F', theirs: 'ZZZ' }];
eq('exact customer-code match ranks first', searchLookup('H3553F', both)[0].theirs, 'H3553F');

// ── THE TAGS ─────────────────────────────────────────────────────────────────────────────────
const projOf = (row) => (tagLinesOf(row).find(t => t.key === 'proj') || {}).value;
eq('the mis-tagged bracket reports 3.625"', projOf(ile), '3.625"');
eq('the miter return reports 6"', projOf(index.find(r => r.ours === 'H1-MRPF')), '6"');
// A rod has no projection — the arm holding it does — so the panel must not cry defect.
ok('a rod reports no projection line', !tagLinesOf(index.find(r => r.ours === 'H1-75R')).some(t => t.key === 'proj'));
// An untagged NON-rod is reported as untagged, which is a different fact from a wrong tag.
const sleeve = index.find(r => r.ours === 'H1-75SLV');
ok('an untagged part says so explicitly', tagLinesOf(sleeve).some(t => t.key === 'proj' && t.untagged));

// ── THE VERDICT — AND THAT IT IS admits()'s, NOT OURS ────────────────────────────────────────
const choices = index.map(r => r.choice);
// 4.625 is what the live flow puts in `answers.proj` (the explainer prints "this order is 4.625\"").
const answers = { proj: '4.625', setup: 'SINGLE', mount: 'WALL' };

const vIle = verdictFor(ile, { choices, answers });
ok('the mis-tagged bracket is refused at 4-5/8"', vIle && vIle.ok === false);
eq('and the rule is the projection', vIle.rule, 'projection');
ok('with the detail naming both depths', /3\.625/.test(vIle.detail) && /4\.625/.test(vIle.detail), vIle.detail);

const vRet = verdictFor(index.find(r => r.ours === 'H1-MRPF'), { choices, answers });
ok('the 6" miter return is refused at 4-5/8"', vRet && vRet.ok === false);
eq('also on projection', vRet.rule, 'projection');

const vOk = verdictFor(index.find(r => r.ours === 'H1-75ILPE'), { choices, answers });
ok('the correctly-tagged sibling is admitted', vOk && vOk.ok === true);

// THE INVARIANT: identical to calling admits() directly. If this ever drifts, the lookup has grown
// an opinion — which is the exact failure the module exists to avoid.
index.forEach(row => {
    const mine = verdictFor(row, { choices, answers });
    const ctx = contextOf(choices, answers);
    const theirs = admits(row.choice, row.choice.position ? { ...ctx, position: row.choice.position } : ctx);
    eq(`verdict matches admits() for ${row.ours}`, mine, theirs);
});

// With no flow open there is nothing to judge against — and that must read as "unknown", never
// as a silent pass.
ok('no choices → null verdict, not a pass', verdictFor(ile, { choices: [], answers }) === null);

// ── THE CROSS-FLOW INDEX ─────────────────────────────────────────────────────────────────────
const flows = [flow, { id: 'FLOW-1', name: '1" Round Rod', linkedAssemblyId: 'ASM-MISSING' }];
const cross = buildLookupIndex({
    flows,
    assemblyFor: (f) => (f.linkedAssemblyId === 'ASM-H1-75' ? assembly : null),
    pinsFor: () => pins,
    findPart,
    aliasCtx,
});
ok('a flow with no resolvable assembly is skipped, not fatal', cross.length === 5, `got ${cross.length}`);
eq('rows carry their flow', [...new Set(cross.map(r => r.flowId))], ['FLOW-75']);
ok('empty input is safe', buildLookupIndex({}).length === 0 && indexForAssembly({}).length === 0);

// A part pinned into two flows returns BOTH — "which flow" is the question being asked.
const twoFlows = buildLookupIndex({
    flows: [flow, { id: 'FLOW-DUP', name: 'Other', linkedAssemblyId: 'ASM-H1-75' }],
    assemblyFor: () => assembly, pinsFor: () => pins, findPart, aliasCtx,
});
eq('same part, two flows, two rows', searchLookup('H3553F', twoFlows).map(r => r.flowId).sort(), ['FLOW-75', 'FLOW-DUP'].sort());

// ── NO CUSTOMER: our codes still work, theirs are simply absent ──────────────────────────────
const anon = indexForAssembly({ assembly, pins, flow, findPart, aliasCtx: {} });
eq('no customer → no their-code', anon.find(r => r.ours === 'H1-75ILE').theirs, '');
eq('our codes unaffected', searchLookup('H1-75ILE', anon).map(r => r.ours), ['H1-75ILE']);
eq('their code no longer resolves', searchLookup('H3553F', anon), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
