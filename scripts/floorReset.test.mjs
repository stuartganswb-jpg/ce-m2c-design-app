// Not finished — back to the floor (Stuart 2026-10-20, WO11579).   node scripts/floorReset.test.mjs
// One reset in Shared/orderLifecycle: the pack-bench guard, the patch, and the applier against a fake Firestore.
import { floorResetRefusalOf, floorResetPatchOf, pickHappened, sendBackToFloor, DELETE } from '../src/components/Shared/orderLifecycle.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };
const TASKS = () => ({ spinSetup: { status: 'Pending', assignedTo: null }, spinSpray: { status: 'Pending', assignedTo: null } });

// WO11579 as it stood on 2026-10-20: Complete since 9-28, picked early then returned to the shelf, the pick cleared.
const wo11579 = {
    id: 'WO-STK-49004-1788228574452', nsWoTran: 'WO11579', nsWoId: '904193', orderType: 'stock', recipe: 'SG', totalParts: 70,
    currentPhase: 'Complete', stepStatus: 'Complete', currentStepIndex: 3, completedAt: 1790622016925, completedParts: 70, scrapReported: 0,
    lastCoatTime: 1790622016925, machineAssigned: null, redlineAlert: false,
    pickStatus: 'Cleared_Overtaken', sentToPickPack: false, pickedAt: null, pickedBy: null, pickClearedAt: 1792431239194, pickClearedBy: 'Sandra G',
    returnedToQueueAt: 1792431178850, returnedToQueueBy: 'Sandra G', returnedToQueueReason: 'picked early — parts returned to shelf',
    sentToPickPackAt: 1788433354241, partsList: [{ partId: 'HCUMLB415', legacyErpId: 'HCUMLB415', quantity: 70, partHandling: 'Small Parts' }],
    tasks: { spinSetup: { status: 'Pending', completedBy: 'Grace', completedCoat: 3 } },
};

// ── the guard ──
eq('WO11579 may go back', floorResetRefusalOf(wo11579), null);
ok('no document refused', /no finishing document/.test(floorResetRefusalOf(null)));
ok('closed refused', /closed/.test(floorResetRefusalOf({ ...wo11579, currentPhase: 'Closed' })));
ok('still on the floor refused', /still on the floor \(painting\)/.test(floorResetRefusalOf({ ...wo11579, currentPhase: 'Painting' })));
ok('Setup refused', /still on the floor \(setup\)/.test(floorResetRefusalOf({ ...wo11579, currentPhase: 'Setup' })));
ok('pick-only refused', /pick-only/.test(floorResetRefusalOf({ ...wo11579, pickOnly: true })));
ok('packed refused, names Stock View', /already packed.*Stock View/.test(floorResetRefusalOf({ ...wo11579, packStatus: 'Packed' })));
ok('gathered refused', /already gathered/.test(floorResetRefusalOf({ ...wo11579, packStatus: 'Gathered' })));
ok('put away refused', /put away in A-01/.test(floorResetRefusalOf({ ...wo11579, putawayBin: 'A-01' })));
ok('a packed line refused', /1 line is already packed/.test(floorResetRefusalOf({ ...wo11579, packedLines: { a: { by: 'Andrea', at: 1 } } })));
eq('an empty packedLines map is not packing', floorResetRefusalOf({ ...wo11579, packedLines: { a: null } }), null);
ok('open on a packing tablet refused', /Andrea has it open to pack/.test(floorResetRefusalOf({ ...wo11579, packInProgress: { by: 'Andrea', startedAt: 1 } })));
ok('open on a pick tablet refused', /Sandra G has its pick open/.test(floorResetRefusalOf({ ...wo11579, pickInProgress: { by: 'Sandra G' } })));
ok('a posted build refused, names it', /already has its build \(ASSYB1\)/.test(floorResetRefusalOf({ ...wo11579, nsWoCompletionTran: 'ASSYB1' })));
ok('a queued build refused', /waiting in the queue/.test(floorResetRefusalOf({ ...wo11579, nsCompletionQueued: true })));
ok('force-completed as already built refused', /ALREADY BUILT/.test(floorResetRefusalOf({ ...wo11579, forceCompleteNsBuildSkipped: true })));
eq('force-completed and built by the app later is still the build rule, not this one', floorResetRefusalOf({ ...wo11579, forceCompleteNsBuildSkipped: false }), null);
ok('a fulfilment refused', /fulfilment is posted \(IF9\)/.test(floorResetRefusalOf({ ...wo11579, orderType: 'sales', nsIfTran: 'IF9' })));
ok('a queued fulfilment refused', /fulfilment is queued/.test(floorResetRefusalOf({ ...wo11579, orderType: 'sales', nsFulfillQueued: true })));

// ── did the pick happen? ──
ok('WO11579: cleared, never picked → no', !pickHappened(wo11579));
ok('released, still Pending → no', !pickHappened({ pickStatus: 'Pending', sentToPickPack: true }));
ok('picked → yes', pickHappened({ pickStatus: 'Picked_Awaiting_Staging', pickedAt: 5 }));
ok('staged → yes', pickHappened({ pickStatus: 'Staged_Ready_For_Finishing', stagedAt: 6 }));
ok('matched at staging, no stamp → yes', pickHappened({ stagingStatus: 'MATCHED' }));
ok('a pickedAt alone → yes', pickHappened({ pickedAt: 7, pickStatus: 'Cleared_Overtaken' }));

// ── the patch ──
let threw = false; try { floorResetPatchOf(wo11579, {}); } catch (e) { threw = true; }
ok('no fresh tasks → refuses to build a patch', threw);
const p = floorResetPatchOf(wo11579, { by: 'Stuart', why: 'never painted — clicked through 9-28', from: 'WMS · Packing Station', now: 1800000000000, tasks: TASKS() });
eq('back to Setup, coat 1', [p.currentPhase, p.stepStatus, p.currentStepIndex, p.machineAssigned], ['Setup', 'Pending', 0, null]);
eq('fresh steps', p.tasks, TASKS());
ok('completion, QC, coat clocks and loads removed', ['completedAt', 'completedParts', 'scrapReported', 'lastCoatTime', 'lastPoleCoatTime', 'spinLoads', 'spinLoadQty', 'poleStepIndex'].every(k => p[k] === DELETE));
ok('pack + NetSuite-build stamps removed, as Stock View always did', ['packStatus', 'packedLines', 'packedAt', 'packedBy', 'nsCompletionQueued', 'nsWoCompletionPosted', 'nsWoCompletionTran', 'nsFulfillQueued', 'nsIfTran'].every(k => p[k] === DELETE));
eq('the pick reopens: Pending, not released, the clear removed', [p.pickStatus, p.sentToPickPack, p.pickClearedAt === DELETE, p.pickClearedBy === DELETE], ['Pending', false, true, true]);
ok('NetSuite identity untouched', !('nsWoId' in p) && !('nsWoTran' in p));
ok('the parts list (the pull) untouched', !('partsList' in p));
ok('force-complete stamps untouched', !('forceCompletedBy' in p) && !('forceCompleteNsBuildSkipped' in p));
eq('history kept', p.floorResets.length, 1);
const h = p.floorResets[0];
eq('history: who, why, from, pick', [h.by, h.why, h.from, h.pickReopened], ['Stuart', 'never painted — clicked through 9-28', 'WMS · Packing Station', true]);
eq('history: what it was', [h.was.currentPhase, h.was.currentStepIndex, h.was.completedParts, h.was.pickStatus, h.was.pickClearedBy], ['Complete', 3, 70, 'Cleared_Overtaken', 'Sandra G']);
ok('history: no undefined (Firestore refuses it)', !JSON.stringify(h).includes('undefined') && Object.values(h.was).every(v => v !== undefined));
eq('stamped', [p.resetAt, p.resetBy], [1800000000000, 'Stuart']);
const p2 = floorResetPatchOf({ ...wo11579, floorResets: p.floorResets }, { by: 'Eric', why: 'again', tasks: TASKS() });
eq('a second reset appends, never replaces', p2.floorResets.map(x => x.by), ['Stuart', 'Eric']);
// a real pick stays
const picked = { ...wo11579, pickStatus: 'Staged_Ready_For_Finishing', pickedAt: 5, stagedAt: 6, sentToPickPack: true, pickClearedBy: undefined, pickClearedAt: undefined };
const pp = floorResetPatchOf(picked, { by: 'S', why: 'w', tasks: TASKS() });
ok('a real pick is kept as it is', !('pickStatus' in pp) && !('sentToPickPack' in pp) && pp.floorResets[0].pickReopened === false);
// Stock View's wider use: a packed order after a wrong build was deleted in NetSuite
const packed = { ...picked, packStatus: 'Packed', packedAt: 9, packedBy: 'Andrea', nsWoCompletionTran: 'ASSYB2', nsWoCompletionPosted: true };
const ps = floorResetPatchOf(packed, { by: 'Eric', why: 'wrong build deleted in NetSuite', from: 'HQ · Stock View', tasks: TASKS() });
eq('Stock View: pack and build stamps go, its history names them', [ps.packStatus === DELETE, ps.nsWoCompletionTran === DELETE, ps.floorResets[0].was.packStatus, ps.floorResets[0].was.nsWoCompletionTran], [true, true, 'Packed', 'ASSYB2']);

// ── the applier, against a fake Firestore ──
const fake = () => {
    const writes = [], adds = [];
    const store = { 'hq_work_orders/WO-STK-49004-1788228574452': { id: 'WO-STK-49004-1788228574452', status: 'Dispatched', floorPhase: 'Complete', floorCompletedBy: 'Grace' } };
    const ctx = {
        db: {}, doc: (db, coll, id) => ({ coll, id, path: `${coll}/${id}` }),
        getDoc: async (r) => ({ exists: () => !!store[r.path], data: () => store[r.path], id: r.id }),
        getDocs: async () => ({ docs: [], empty: true, forEach() {} }),
        query: (...a) => a, collection: (db, coll) => ({ coll }), where: (...a) => a,
        updateDoc: async (r, patch) => { writes.push({ path: r.path, patch }); },
        deleteField: () => '__DEL__', addDoc: async (c, d) => { adds.push({ coll: c.coll, d }); return { id: 'x' }; },
        serverTimestamp: () => 'TS', makeFullTasks: TASKS,
    };
    return { ctx, writes, adds };
};
{
    const { ctx, writes, adds } = fake();
    const r = await sendBackToFloor(ctx, { finWo: wo11579, by: 'Stuart', why: '  never painted  ', from: 'WMS · Packing Station', ref: 'WO11579' });
    eq('applier: ok, pick reopened', [r.ok, r.pickReopened, r.ref], [true, true, 'WO11579']);
    const fin = writes.find(w => w.path === 'fin_workorders/WO-STK-49004-1788228574452');
    ok('applier: the document is written', !!fin);
    eq('applier: DELETE becomes deleteField()', [fin.patch.completedAt, fin.patch.pickClearedBy, fin.patch.currentPhase], ['__DEL__', '__DEL__', 'Setup']);
    ok('applier: no DELETE marker reaches Firestore', !Object.values(fin.patch).some(v => v === DELETE));
    eq('applier: the reason is trimmed into the history', fin.patch.floorResets[0].why, 'never painted');
    const log = adds.find(a => a.coll === 'fin_logs');
    ok('applier: a floor-log line under the document id', log && log.d.woId === wo11579.id && log.d.action === 'RESET' && /BACK TO THE FLOOR · WO11579 — never painted/.test(log.d.msg), JSON.stringify(log));
}
{
    const { ctx, writes } = fake();
    const r = await sendBackToFloor(ctx, { finWo: { ...wo11579, packStatus: 'Packed' }, by: 'S', why: 'x' });
    eq('applier: a refused document is never written', [r.ok, writes.length], [false, 0]);
    const r2 = await sendBackToFloor(ctx, { finWo: wo11579, by: 'S', why: '   ' });
    eq('applier: no reason, nothing written', [r2.ok, /reason/.test(r2.refused), writes.length], [false, true, 0]);
}

{
    // judged on the document as it is NOW: the screen's copy is free, but a packer opened it a moment ago
    const { ctx, writes } = fake();
    const live = { ...wo11579, packInProgress: { by: 'Andrea', startedAt: 1 } };
    ctx.getDoc = async (r) => ({ exists: () => r.path === `fin_workorders/${wo11579.id}`, data: () => live, id: r.id });
    const r = await sendBackToFloor(ctx, { finWo: wo11579, by: 'S', why: 'x' });
    eq('applier: the fresh read decides — refused, nothing written', [r.ok, /Andrea has it open to pack/.test(r.refused), writes.length], [false, true, 0]);
}
{
    // and the fresh copy is what is reset (its history included)
    const { ctx, writes } = fake();
    const live = { ...wo11579, floorResets: [{ at: 1, by: 'Earlier', why: 'first time', from: 'x', pickReopened: true, was: {} }] };
    ctx.getDoc = async (r) => ({ exists: () => r.path === `fin_workorders/${wo11579.id}`, data: () => live, id: r.id });
    await sendBackToFloor(ctx, { finWo: wo11579, by: 'Stuart', why: 'again' });
    const fin = writes.find(w => w.path === `fin_workorders/${wo11579.id}`);
    eq('applier: the fresh history is appended to', fin.patch.floorResets.map(x => x.by), ['Earlier', 'Stuart']);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
