// An order keeps the recipe it started with — offline.
//   node scripts/recipeFreeze.test.mjs
//
// Grace, App Imp 2026-10-06 (Row 3 of SO60585, S03): "the system returned the order to the Hand Finishing step, which
// had already been completed the day before. I think this happened because I added a step in the S03 recipe at the end
// of the day." A document counts its coats by number and the floor read FINISH RECIPES live, so a step added in front
// moved every order part-way through back a coat. Stuart 2026-10-13: "build the recipe fix".
// If a row here breaks, the change is wrong — unless Stuart changed the rule.

import { recipeCopyOf, copyOfRecipe, sameSteps } from '../src/components/Shared/recipeCopy.js';
import { recipeFreezesOf, freezeText, stillOnTheFloor } from '../src/components/Shared/recipeFreeze.js';
import { partsRecipeOfWo, poleRecipeOfWo, coatCountsOf, streamBegun, recipeCopyInForce, liveRecipeOfWo, asksSprayStation } from '../src/components/Shared/floorActivity.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

const S = (color) => ({ color, app: 'Sprayed' });
const H = (color) => ({ color, app: 'Hand Applied' });
const num = (steps) => steps.map((s, i) => ({ ...s, step: i + 1 }));
const fresh = () => Object.fromEntries(['spinSetup', 'spinSpray', 'spinBake', 'poleSpray', 'poleBake', 'hand', 'poleHand'].map(k => [k, { status: 'Pending', assignedTo: '' }]));

// S03 as it stood on 10-05: the small parts and the poles each ran four coats.
const OLD = num([S('Stain 03'), S('Sealer'), H('Glaze'), S('Top coat')]);
const NEW = num([H('Wood Conditioner'), S('Stain 03'), S('Sealer'), H('Glaze'), S('Top coat')]);
const before = {
    S03: { code: 'S03', name: 'Walnut', steps: OLD, instructions: 'wipe first' },
    'S03-S': { code: 'S03-S', name: 'Walnut — SMALL PARTS', masterCode: 'S03', steps: OLD, instructions: 'wipe first' },
    'S03-P': { code: 'S03-P', name: 'Walnut — POLES', masterCode: 'S03', steps: OLD, instructions: '' },
};
const after = { ...before, 'S03-S': { ...before['S03-S'], steps: NEW } };

// Row 3: 105 small parts, the hand coat (3) finished yesterday, on coat 4 this morning.
const row3 = { id: 'WO-OE-SO60585-6916', recipe: 'S03', totalParts: 105, productType: 'FINIAL', currentPhase: 'Painting', currentStepIndex: 3, tasks: fresh() };
const notStarted = { id: 'WO-NEW', recipe: 'S03', totalParts: 20, productType: 'RING', currentPhase: 'Painting', currentStepIndex: 0, tasks: fresh() };
const done = { id: 'WO-DONE', recipe: 'S03', totalParts: 20, productType: 'RING', currentPhase: 'Complete', currentStepIndex: 4, tasks: fresh() };
const closed = { id: 'WO-CLOSED', recipe: 'S03', totalParts: 20, productType: 'RING', currentPhase: 'Painting', status: 'Closed', currentStepIndex: 2, tasks: fresh() };
const twoTrack = { id: 'WO-PAIR', recipe: 'S03', totalParts: 12, totalPoles: 2, poles: { qty: 2, type: 'POLE' }, productType: 'FINIAL', currentPhase: 'Painting', currentStepIndex: 1, poleStepIndex: 2, tasks: fresh() };
const other = { id: 'WO-P24', recipe: 'P24', totalParts: 9, productType: 'FINIAL', currentPhase: 'Painting', currentStepIndex: 1, tasks: fresh() };
const all = [row3, notStarted, done, closed, twoTrack, other];
const applied = (wo, patches) => {
    const p = patches.find(x => x.id === wo.id);
    if (!p) return wo;
    const copy = { ...(wo.recipeCopy || {}) };
    Object.entries(p.patch).forEach(([k, v]) => { copy[k.split('.')[1]] = v; });
    return { ...wo, recipeCopy: copy };
};

// ── the day it happened, without the fix ──
eq('before the fix: Row 3 reads coat 4 of the NEW recipe — the hand coat again', partsRecipeOfWo(after, row3).steps[3].color, 'Glaze');

// ── the fix: the save names and keeps the orders part-way through ──
const fz = recipeFreezesOf({ workOrders: all, recipesBefore: before, recipesAfter: after, at: 1000, by: 'Grace', why: 'the change to S03-S' });
eq('two documents are part-way through the small-parts recipe', fz.patches.map(p => p.id), ['WO-OE-SO60585-6916', 'WO-PAIR']);
eq('each is given the steps it is running, under its small-parts pointer only', fz.patches.map(p => Object.keys(p.patch)), [['recipeCopy.parts'], ['recipeCopy.parts']]);
eq('the copy is the recipe as it stood', fz.patches[0].patch['recipeCopy.parts'], { code: 'S03-S', name: 'Walnut — SMALL PARTS', steps: OLD, instructions: 'wipe first', at: 1000, by: 'Grace', why: 'the change to S03-S' });
eq('the people saving are told which, and where each is', fz.staying.map(s => [s.id, s.role, s.code, s.coat, s.of]), [['WO-OE-SO60585-6916', 'parts', 'S03-S', 4, 4], ['WO-PAIR', 'parts', 'S03-S', 2, 4]]);
ok('an order that has not started a coat is not touched', !fz.patches.some(p => p.id === 'WO-NEW'));
ok('…nor a finished one, a closed one, or one on another recipe', !fz.patches.some(p => ['WO-DONE', 'WO-CLOSED', 'WO-P24'].includes(p.id)));
ok('a finished or closed document is not on the floor', !stillOnTheFloor(done) && !stillOnTheFloor(closed) && stillOnTheFloor(row3) && !stillOnTheFloor({ id: 'x', deleted: true }));

const row3Kept = applied(row3, fz.patches);
eq('after the save Row 3 still reads ITS coat 4 — the top coat', partsRecipeOfWo(after, row3Kept).steps[3].color, 'Top coat');
eq('…and counts four coats, on every screen that asks', coatCountsOf(after, row3Kept).recipeLen, 4);
eq('the order that had not started reads the new five', coatCountsOf(after, notStarted).recipeLen, 5);
eq('…and starts on the new first coat', partsRecipeOfWo(after, notStarted).steps[0].color, 'Wood Conditioner');
const pairKept = applied(twoTrack, fz.patches);
eq('the pair: small parts on their copy, poles on FINISH RECIPES (-P did not change)', [recipeCopyInForce(pairKept, 'parts').code, recipeCopyInForce(pairKept, 'poles')], ['S03-S', null]);
eq('…the poles read the live -P', poleRecipeOfWo(after, pairKept), before['S03-P']);

// ── a second change: who is named, who is written ──
const NEWER = num([...NEW, S('Wax')]);
const after2 = { ...after, 'S03-S': { ...after['S03-S'], steps: NEWER } };
const fz2 = recipeFreezesOf({ workOrders: [row3Kept, pairKept, { ...notStarted, currentStepIndex: 1 }], recipesBefore: after, recipesAfter: after2, at: 2000, by: 'Grace' });
eq('a document that already holds its steps is not written again', fz2.patches.map(p => p.id), ['WO-NEW']);
eq('…but is still named as staying on them', fz2.staying.map(s => s.id), ['WO-OE-SO60585-6916', 'WO-PAIR', 'WO-NEW']);
eq('the one that started on the five-coat recipe keeps the five', fz2.patches[0].patch['recipeCopy.parts'].steps.length, 5);

// ── a change that moves nobody ──
const renamed = { ...before, 'S03-S': { ...before['S03-S'], name: 'Walnut (small)', instructions: 'wipe twice' } };
eq('a new name or new floor instructions keep nobody and name nobody', recipeFreezesOf({ workOrders: all, recipesBefore: before, recipesAfter: renamed }), { patches: [], staying: [] });
eq('…so the new instructions reach the order part-way through', partsRecipeOfWo(renamed, row3).instructions, 'wipe twice');
eq('putting a held recipe back as the order holds it names nobody', recipeFreezesOf({ workOrders: [row3Kept], recipesBefore: after, recipesAfter: before }).staying, []);

// ── deleting, and the -S / -P variants ──
const gone = Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'S03-S'));
const master5 = { ...gone, S03: { ...before.S03, steps: NEW } };
const fzDel = recipeFreezesOf({ workOrders: [row3], recipesBefore: { ...before, S03: master5.S03 }, recipesAfter: master5 });
eq('un-ticking -S when the master differs: the order keeps the -S steps', fzDel.patches[0].patch['recipeCopy.parts'].code, 'S03-S');
eq('un-ticking -S when the master is the same coats moves nobody', recipeFreezesOf({ workOrders: [row3], recipesBefore: before, recipesAfter: gone }).patches, []);
const noRecipe = {};
const fzAll = recipeFreezesOf({ workOrders: [row3], recipesBefore: { S03: before.S03 }, recipesAfter: noRecipe });
eq('deleting the recipe outright: the order part-way through keeps its steps', fzAll.patches[0].patch['recipeCopy.parts'].steps.length, 4);
eq('…and still counts its coats with the recipe gone', coatCountsOf(noRecipe, applied(row3, fzAll.patches)).recipeLen, 4);
eq('an order that had not started reads no recipe, as before', coatCountsOf(noRecipe, notStarted).recipeLen, 0);
const fzNewVariant = recipeFreezesOf({ workOrders: [row3], recipesBefore: { S03: before.S03 }, recipesAfter: { S03: before.S03, 'S03-S': { code: 'S03-S', steps: NEW } } });
eq('a NEW -S saved under an order running the master: it keeps the master', fzNewVariant.patches[0].patch['recipeCopy.parts'].code, 'S03');
eq('nothing to keep where the order never had a recipe', recipeFreezesOf({ workOrders: [row3], recipesBefore: {}, recipesAfter: { S03: before.S03 } }).patches, []);

// ── the elbow: a small part that runs the -P recipe keeps it under ITS pointer ──
const elbow = { id: 'WO-ELBOW', recipe: 'S03', finishStream: 'POLES', totalParts: 4, productType: 'ELBOW', currentPhase: 'Painting', currentStepIndex: 2, tasks: fresh() };
const afterP = { ...before, 'S03-P': { ...before['S03-P'], steps: NEW } };
const fzElbow = recipeFreezesOf({ workOrders: [elbow, row3], recipesBefore: before, recipesAfter: afterP });
eq('a change to -P keeps the elbow (its small-parts pointer runs -P), not Row 3', fzElbow.patches.map(p => [p.id, Object.keys(p.patch)[0], Object.values(p.patch)[0].code]), [['WO-ELBOW', 'recipeCopy.parts', 'S03-P']]);
// A pole-only document counts its pole coats on the old pointer.
const poleOnly = { id: 'WO-POLE', recipe: 'S03', totalParts: 6, productType: 'POLE', currentPhase: 'Painting', currentStepIndex: 2, tasks: fresh() };
eq('a pole-only document is kept under its pole pointer', recipeFreezesOf({ workOrders: [poleOnly], recipesBefore: before, recipesAfter: afterP }).patches.map(p => Object.keys(p.patch)), [['recipeCopy.poles']]);

// ── has it begun ──
ok('coat 1, nothing touched → not begun', !streamBegun(notStarted, 'parts') && !streamBegun(notStarted, 'poles'));
ok('a coat finished → begun', streamBegun(row3, 'parts'));
ok('a step of coat 1 running → begun', streamBegun({ ...notStarted, tasks: { ...fresh(), spinSetup: { status: 'Running', startTime: 5 } } }, 'parts'));
ok('a step started then put back to Pending → begun', streamBegun({ ...notStarted, tasks: { ...fresh(), hand: { status: 'Pending', startTime: 5 } } }, 'parts'));
ok('a pole step does not begin the small parts', !streamBegun({ ...twoTrack, currentStepIndex: 0, tasks: { ...fresh(), poleSpray: { status: 'Complete', completedAt: 9 } } }, 'parts'));
ok('…it begins the poles', streamBegun({ ...twoTrack, poleStepIndex: 0, tasks: { ...fresh(), poleSpray: { status: 'Complete', completedAt: 9 } } }, 'poles'));
ok('a spin load done and the next at coat 1 → still begun', streamBegun({ ...notStarted, spinLoads: [{ n: 1, qty: 35 }] }, 'parts'));
// A document reset to coat 1 (Stock View ↩ Reset: fresh tasks) reads FINISH RECIPES again.
const reset = { ...row3Kept, currentStepIndex: 0, tasks: fresh() };
eq('a document reset to coat 1 with fresh tasks drops back to FINISH RECIPES', [recipeCopyInForce(reset, 'parts'), coatCountsOf(after, reset).recipeLen], [null, 5]);
ok('…though the copy is still on it', !!recipeCopyOf(reset, 'parts'));
eq('the next load of a spin order keeps running its copy', coatCountsOf(after, { ...reset, spinLoads: [{ n: 1, qty: 35 }] }).recipeLen, 4);
eq('Start Setup asks Spin or Booth from the same reading', asksSprayStation({ ...row3Kept, recipeCopy: { parts: { code: 'X', steps: num([H('Wax')]) } } }, after), false);
eq('FINISH RECIPES itself is still readable for a kept order', liveRecipeOfWo(after, row3Kept, 'parts').steps.length, 5);

// ── the shape ──
ok('the copy does not share its steps with the recipe', copyOfRecipe(before.S03).steps !== OLD && copyOfRecipe(before.S03).steps[0] !== OLD[0]);
eq('a recipe with no steps is not copied', [copyOfRecipe({ code: 'STUB', steps: [] }), copyOfRecipe(null)], [null, null]);
eq('a copy with no steps reads as none', recipeCopyOf({ recipeCopy: { parts: { code: 'S03', steps: [] } } }, 'parts'), null);
ok('same coats: paint and application, whatever the spacing or case', sameSteps({ steps: [{ color: ' Sealer ', app: 'sprayed' }] }, { steps: [S('Sealer')] }));
ok('a different paint, a different application or a different count is a different recipe', !sameSteps({ steps: [S('A')] }, { steps: [S('B')] }) && !sameSteps({ steps: [S('A')] }, { steps: [H('A')] }) && !sameSteps({ steps: [S('A')] }, { steps: [S('A'), S('B')] }) && !sameSteps({ steps: [S('A')] }, null));

// ── what the save says ──
const text = freezeText({ staying: fz.staying, refOf: (w) => w.id.replace('WO-OE-', ''), what: 'the change to S03-S' });
ok('it counts orders, names each with its stream and coat, and says who takes the new steps',
    /^2 orders are part-way through and will FINISH ON THE STEPS THEY STARTED WITH — the change to S03-S does not move them:/.test(text)
    && /• SO60585-6916 — small parts, coat 4 of 4 \(S03-S\)/.test(text) && /• WO-PAIR — small parts, coat 2 of 4 \(S03-S\)/.test(text)
    && /Orders that have not started a coat take the new steps\.$/.test(text));
ok('one order reads in the singular', /^1 order is part-way through and will FINISH ON THE STEPS IT STARTED WITH — this change does not move it:/.test(freezeText({ staying: fz.staying.slice(0, 1) })));
eq('nobody part-way through → nothing said', freezeText({ staying: [] }), '');
ok('a long list is cut at twelve', /…and 3 more/.test(freezeText({ staying: Array.from({ length: 15 }, (_, i) => ({ id: `W${i}`, wo: { id: `W${i}` }, role: 'parts', code: 'S03', coat: 2, of: 4 })) })));

console.log(`recipeFreeze: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
