// A Vision drawing, read as the tag engine's answers.
//   node scripts/visionBridge.test.mjs
//
// The handoff Vision exists for. What matters here is not that it fills things in — it is that
// what it CANNOT fill in comes back as `missed` rather than as silence, because a quietly dropped
// bracket is how a quote goes out for the wrong hardware.

import { resolve } from '../src/components/Shared/hardwareModel.js';
import { seedFromVision, visionPartIds } from '../src/components/Shared/visionBridge.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n} ${extra}`); };

// RAW choices, as the adapter hands them over.
const CHOICES = [
    { id: 'ROD', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'CENTER', nodes: ['rc'] },
    { id: 'RODL', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'LEFT', nodes: ['rl'] },
    { id: 'RODR', partId: 'H1-138R', role: 'ROD', rodKind: 'SOLID', position: 'RIGHT', nodes: ['rr'] },
    { id: 'BL-A', partId: 'H1-138B6', role: 'BRACKET', position: 'LEFT', mount: 'WALL', nodes: ['bl1'] },
    { id: 'BL-B', partId: 'H1-138D6', role: 'BRACKET', position: 'LEFT', mount: 'WALL', nodes: ['bl2'] },
    { id: 'BR-A', partId: 'H1-138B6', role: 'BRACKET', position: 'RIGHT', mount: 'WALL', nodes: ['br1'] },
    { id: 'BC-A', partId: 'H1-138B6', role: 'BRACKET', position: 'CENTER', mount: 'WALL', nodes: ['bc1'] },
    { id: 'BC-CEIL', partId: 'H1-138BC', role: 'BRACKET', position: 'CENTER', mount: 'CEILING', nodes: ['bc2'] },
    { id: 'PL', partId: 'H1-138BP-S', role: 'BACKPLATE', position: 'LEFT', nodes: ['pl'] },
    { id: 'PR', partId: 'H1-138BP-S', role: 'BACKPLATE', position: 'RIGHT', nodes: ['pr'] },
    { id: 'FINL', partId: 'H1-138KF', role: 'FINIAL', position: 'LEFT', nodes: ['fl'] },
    { id: 'FINL2', partId: 'H1-138GF', role: 'FINIAL', position: 'LEFT', nodes: ['fl2'] },
];
const model = resolve({ choices: CHOICES, answers: {}, selectedIds: [] });

const FLOW = { steps: [
    { id: 'step-end-l', styleOptions: [{ optId: 'o-kf', partId: 'H1-138KF' }, { optId: 'o-gf', partId: 'H1-138GF' }] },
    { id: 'step-bkt-l', styleOptions: [{ optId: 'o-b6', partId: 'H1-138B6' }], subOptions: [{ optId: 'o-bp', partId: 'H1-138BP-S' }] },
] };

const draft = (over = {}) => ({
    specs: {
        engineeringNotes: { poleO2O: 96, totalPoleRawInches: 108 },
        'step-end-l': 'o-gf',
        ...(over.specs || {}),
    },
    spatialData: {
        shape: 'STRAIGHT', mountLeft: 'OPEN', mountRight: 'OPEN',
        bracketId: 'H1-138D6', bracketIdRight: 'H1-138B6', bracketIdCenter: 'H1-138B6',
        backplateIdLeft: 'H1-138BP-S',
        ...(over.spatialData || {}),
    },
});

// ── WHAT THE DRAWING CARRIES ─────────────────────────────────────────────────────────────────
{
    const ids = visionPartIds(draft(), FLOW);
    ok('the fabrication picks come across with their position',
        ids.some(i => i.partId === 'H1-138D6' && i.position === 'LEFT')
        && ids.some(i => i.partId === 'H1-138B6' && i.position === 'RIGHT'));
    ok('a step selection resolves through the flow to a part number',
        ids.some(i => i.partId === 'H1-138GF'));
    ok('metadata on specs is not mistaken for a selection',
        !ids.some(i => /engineeringNotes|collection/i.test(i.partId)));
}

// ── THE DRAWING, AS ANSWERS ──────────────────────────────────────────────────────────────────
{
    const seed = seedFromVision({ model, draft: draft(), flow: FLOW });
    eq('the finished O2O becomes the length', seed.lengthInches, 96);
    eq('an OPEN mount is a wall mount here', seed.answers.mount, 'WALL');

    const at = (kind, pos) => model.slots.find(s => s.kind === kind && s.position === pos);
    const chose = (kind, pos) => seed.picks[at(kind, pos)?.key];
    // ⚠ THE POSITION HINT IS THE POINT: the same part is offered left AND right, so an unhinted
    // match would have put Vision's LEFT bracket wherever it looked first.
    eq('the left bracket is the one drawn for the left', chose('BRACKET', 'LEFT'), 'BL-B');
    eq('the right bracket is its own', chose('BRACKET', 'RIGHT'), 'BR-A');
    eq('and the centre is the centre', chose('BRACKET', 'CENTER'), 'BC-A');
    eq('the plate Vision chose comes with it', chose('BACKPLATE', 'LEFT'), 'PL');
    eq('the end treatment chosen in the flow carries over', chose('END', 'LEFT'), 'FINL2');
    ok('and it says so, in our numbers', seed.carried.some(c => /H1-138D6/.test(c)));
}

// ── WHAT IT CANNOT DO, IT SAYS ───────────────────────────────────────────────────────────────
{
    const d = draft({ spatialData: { bracketId: 'H1-999-NOPE' } });
    const seed = seedFromVision({ model, draft: d, flow: FLOW });
    ok('an unmatched part is reported, never approximated', seed.missed.some(m => m.what === 'H1-999-NOPE'));
    ok('…and the note points at the tags', /1\.6|pinned/.test(seed.missed.find(m => m.what === 'H1-999-NOPE').why));
    ok('nothing is picked for it', !Object.values(seed.picks).includes('H1-999-NOPE'));

    const noLen = seedFromVision({ model, draft: draft({ specs: { engineeringNotes: {} } }), flow: FLOW });
    eq('a drawing with no O2O leaves the length alone', noLen.lengthInches, null);
    ok('…and says to type it', noLen.missed.some(m => m.what === 'length'));

    const badMount = seedFromVision({ model, draft: draft({ spatialData: { mountLeft: 'SOFFIT' } }), flow: FLOW });
    ok('a mount this assembly does not offer is reported', badMount.missed.some(m => m.what === 'mount'));
    ok('…and not answered', badMount.answers.mount === undefined);
}

// ── IDENTITY IS THE CALLER'S, because a Vision id may be a doc id and a pin an item number ────
{
    const d = draft({ spatialData: { bracketId: 'CE-INV-1234' } });
    const seed = seedFromVision({ model, draft: d, flow: FLOW,
        sameId: (a, b) => String(a) === String(b) || (b === 'CE-INV-1234' && a === 'H1-138D6') });
    const left = model.slots.find(s => s.kind === 'BRACKET' && s.position === 'LEFT');
    eq('a doc id resolves through the caller index', seed.picks[left.key], 'BL-B');
}

// ── A DRAWING NAMES THE SAME PART SEVERAL TIMES ──────────────────────────────────────────────
// Stuart 2026-08-21, first Vision → new engine push: "⚠ CE-INV-51280 — nothing in this assembly
// offers it — it may not be pinned", printed for ids the line ABOVE had just listed as carried
// over. Vision stores its answers twice — per position in spatialData, and as step selections in
// specs — so a plate chosen for both ends arrives three or four times. The first copy was placed;
// every later one found the slots already taken and reported a part that was on the order.
{
    const PLATE = 'H1-138BP-S';
    const d = {
        specs: {
            engineeringNotes: { poleO2O: 96 },
            // the SAME plate, arriving again as a flow step selection
            'step-bkt-l': 'o-b6',
        },
        spatialData: {
            shape: 'STRAIGHT', mountLeft: 'OPEN',
            bracketId: 'H1-138B6', bracketIdRight: 'H1-138B6',
            backplateIdLeft: PLATE, backplateIdRight: PLATE,
        },
    };
    // A flow whose sub-option is that same plate — the second source Vision writes.
    const flow2 = { steps: [{ id: 'step-bkt-l', styleOptions: [{ optId: 'o-b6', partId: 'H1-138B6' }], subOptions: [{ optId: 'o-bp', partId: PLATE }] }] };
    const seed = seedFromVision({ model, draft: { ...d, specs: { ...d.specs, 'step-bkt-l__sub': 'o-bp' } }, flow: flow2 });

    ok('the plate is placed on both ends', seed.carried.filter(c => c.startsWith(PLATE)).length === 2);
    eq('and is never reported missing as well', seed.missed.filter(m => m.what === PLATE).length, 0);
    ok('the bracket, named twice, is not reported either', !seed.missed.some(m => m.what === 'H1-138B6'));
    // The point of `missed` survives: something genuinely absent is still called out, once.
    const ghost = seedFromVision({ model, flow: FLOW, draft: { ...d, spatialData: { ...d.spatialData, bracketIdCenter: 'H1-NOT-PINNED' } } });
    eq('a part nothing offers is still reported, exactly once', ghost.missed.filter(m => m.what === 'H1-NOT-PINNED').length, 1);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
