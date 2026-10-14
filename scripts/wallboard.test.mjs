// 📺 The wallboard — what is happening now, and the week's board (Stuart 2026-10-13).   node scripts/wallboard.test.mjs
// Made-up people only — the repo is public.
import { floorNowOf, wmsNowOf, boardHalfOf, sayMins, CLAIM_STALE_MS } from '../src/components/Shared/wallboard.js';
import { floorTimersOf, wallboardDocOf, rankWeek, GROUP } from '../src/components/Shared/floorMetrics.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const MIN = 60000;
const at = (h, mi = 0) => new Date(2026, 9, 14, h, mi).getTime();
const NOW = at(10, 0);
const cfg = floorTimersOf({ ovenMins: 6, spinPaintMins: 4 });

// ── the finishing floor ─────────────────────────────────────────────────────────────────────────────────────
const run = (who, mins) => ({ status: 'Running', assignedTo: who, startTime: NOW - mins * MIN });
const floor = [
    { id: 'a', nsWoTran: 'WO100', currentPhase: 'Painting', reqDate: '2026-10-13', totalParts: 20, stockErpId: 'HCUSR1/SG', tasks: { spinSpray: run('Pat', 2), spinSetup: { status: 'Complete', completedBy: 'Pat', completedAt: NOW - 5 * MIN } } },
    { id: 'b', nsWoTran: 'WO101', currentPhase: 'Painting', reqDate: '2026-10-14', totalParts: 12, sprayStation: 'BOOTH', tasks: { spinSpray: run('Lee', 20) } },     // booth: 15 min → overdue
    { id: 'c', nsWoTran: 'WO102', currentPhase: 'Painting', reqDate: '2026-10-20', totalParts: 10, totalPoles: 10, type: 'Poles', tasks: { poleBake: run('Kim', 4) } },   // oven, 2 min left
    { id: 'd', nsWoTran: 'WO103', currentPhase: 'Painting', totalParts: 30, tasks: { spinBake: run('Pat', 9) } },                                                      // oven, done — take it out
    { id: 'e', nsWoTran: 'WO104', currentPhase: 'Setup', reqDate: '2026-10-15' },
    { id: 'f', nsWoTran: 'WO105', currentPhase: 'Complete', completedAt: NOW - 30 * MIN, tasks: { hand: { status: 'Complete', completedBy: 'Ann', completedAt: NOW - 30 * MIN } } },
    { id: 'g', nsWoTran: 'WO106', currentPhase: 'Complete', completedAt: NOW - 60 * MIN, pickOnly: true, completedBy: 'split (pick only)' },
    { id: 'h', nsWoTran: 'WO107', currentPhase: 'Complete', completedAt: at(9, 0) - 24 * 60 * MIN },
    { id: 'i', nsWoTran: 'WO108', currentPhase: 'Closed', tasks: { spinSpray: run('Ghost', 5) } },                                                                    // not on the floor
    { id: 'j', nsWoTran: 'WO109', currentPhase: 'Painting', tasks: { spinSetup: { status: 'Running', assignedTo: 'Tablet', startTime: NOW - MIN } } },
];
const f = floorNowOf({ workOrders: floor, cfg, nowMs: NOW });
eq('working now: hands-on steps on the floor, longest first ("Tablet" is no one, but the step still shows)', f.working.map(w => `${w.who || '-'}:${w.ref}:${w.step}`), ['Lee:WO101:Spray Coat', 'Pat:WO100:Spray Coat', 'Tablet:WO109:Sled Setup']);
eq('a booth coat is timed as the booth (15 min) — 20 min in is overdue', [f.working[0].estMins, f.working[0].state, f.working[0].window], [15, 'overdue', 'Large Booth']);
eq('a spin coat is timed as the spin machine', [f.working[1].estMins, f.working[1].state, f.working[1].window], [4, 'running', 'Spin Machine']);
eq('the oven: the PRODUCT, soonest out first; a bake past its time says so', f.oven.map(o => `${o.ref}:${o.leftMins}:${o.done}`), ['WO103:0:true', 'WO102:2:false']);
eq('the crew: working, free while their product bakes, or no step running — a closed order\'s step is not the floor\'s', f.crew.map(c => `${c.name}:${c.state}`), ['Lee:working', 'Pat:working', 'Kim:free', 'Ann:none']);
eq('Pat is working (spray) and has a bake in the oven too', [f.crew[1].doing.ref, f.crew[1].ovenRefs], ['WO100', ['WO103']]);
eq('the counts', f.counts, { onFloor: 5, inOven: 2, setupQueue: 1, finishedToday: 1, dueToday: 1, late: 1 });
eq('an empty floor', floorNowOf({ workOrders: [], cfg, nowMs: NOW }).counts, { onFloor: 0, inOven: 0, setupQueue: 0, finishedToday: 0, dueToday: 0, late: 0 });

// ── the pick / pack bench ───────────────────────────────────────────────────────────────────────────────────
const docs = [
    { id: 'p1', nsWoTran: 'WO200', pickStatus: 'Pending', reqDate: '2026-10-10', pickInProgress: { by: 'Robin', startedAt: NOW - 25 * MIN } },
    { id: 'p2', nsWoTran: 'WO201', pickStatus: 'Pending', reqDate: '2026-10-20' },
    { id: 'p3', nsWoTran: 'WO202', pickStatus: 'Pending', needBy: '2026-10-12' },
    { id: 's1', nsWoTran: 'WO203', pickStatus: 'Picked_Awaiting_Staging', pickedAt: NOW - 50 * MIN, pickedBy: 'Robin' },
    { id: 'k1', nsWoTran: 'WO204', currentPhase: 'Complete', completedAt: NOW - 300 * MIN, packInProgress: { by: 'Max', startedAt: NOW - 5 * 60 * MIN } },   // stale claim
    { id: 'k2', nsWoTran: 'WO205', currentPhase: 'Complete', completedAt: NOW - 30 * MIN },
    { id: 'x1', nsWoTran: 'WO206', packStatus: 'Packed', packedAt: NOW - 20 * MIN, packedBy: 'Max', pickedAt: NOW - 200 * MIN, pickedBy: 'robin' },
    { id: 'x2', nsWoTran: 'WO207', packStatus: 'Packed', packedAt: NOW - 26 * 60 * MIN, packedBy: 'Max' },                                                      // yesterday
    { id: 'q1', soId: 'SO9', status: 'Picked', packStatus: 'Packed', packedAt: NOW - 10 * MIN, packedBy: 'Packer' },                                          // nobody
];
const refOf = (d) => (d.soId ? `SO ${d.soId}` : d.nsWoTran);
const w = wmsNowOf({ openPicks: docs.slice(0, 3), staging: [docs[3]], packQueue: [docs[4], docs[5]], docs: [...docs, docs[0]], refOf, nowMs: NOW });
eq('who holds a pick or a pack right now — a 4-hour-old claim is flagged', w.claims.map(c => `${c.who}:${c.kind}:${c.ref}:${c.mins}:${c.stale}`), ['Max:pack:WO204:300:true', 'Robin:pick:WO200:25:false']);
eq('today, by person (case-blind; "Packer" is no one; yesterday is not today)', w.today, [{ name: 'Robin', picks: 2, packs: 0 }, { name: 'Max', picks: 0, packs: 1 }]);
eq('picks past their due date, oldest first (needBy or reqDate)', w.latePicks, [{ ref: 'WO200', due: '2026-10-10' }, { ref: 'WO202', due: '2026-10-12' }]);
eq('the longest waits to pack', w.oldestPacks, [{ ref: 'WO204', waitingMins: 300 }, { ref: 'WO205', waitingMins: 30 }]);
eq('the counts', w.counts, { awaitingPick: 3, picking: 1, staging: 1, readyToPack: 2, packing: 1, pickedToday: 2, packedToday: 1 });
eq('the claim line is the WMS\'s own', CLAIM_STALE_MS, 4 * 60 * MIN);

// ── the week ────────────────────────────────────────────────────────────────────────────────────────────────
const row = (who, group, o) => ({ pk: who.toLowerCase(), who, group, week: '2026-10-05', activeDays: 4, steps: 40, actions: 40, startLagMins: 10, realShare: 1, paceRatio: 1, nextGapMins: 5, steadyShare: 0.9, actionsPerHour: 2, onTime: { ok: 4, total: 4 }, ...o });
const ranked = rankWeek([row('Ace', GROUP.FINISHING), row('Bea', GROUP.FINISHING, { realShare: 0.4 }), row('Hal', GROUP.WMS), row('Ivy', GROUP.WMS, { steadyShare: 0.5 })]);
const published = wallboardDocOf({ week: '2026-10-05', ranked, by: 'Admin', nowMs: 99 });
const fin = boardHalfOf(published, GROUP.FINISHING);
eq('the finishing half: the week, who published, the ranks in order', [fin.week, fin.weekEnd, fin.publishedBy, fin.ranked.map(r => `${r.rank}.${r.name}`)], ['2026-10-05', '2026-10-11', 'Admin', ['1.Ace', '2.Bea']]);
eq('the halls of fame and shame, one each side of two', [fin.fame.map(x => x.name), fin.shame.map(x => x.name)], [['Ace'], ['Bea']]);
eq('the WMS half', boardHalfOf(published, GROUP.WMS).ranked.map(r => r.name), ['Hal', 'Ivy']);
eq('nothing published yet, or a board that does not exist', [boardHalfOf(null, GROUP.FINISHING), boardHalfOf({}, GROUP.WMS), boardHalfOf(published, 'both')], [null, null, null]);

// ── chores on the wallboard (Stuart 2026-10-14) ─────────────────────────────────────────────────────────────────
const withChore = [...floor, { id: 'k', nsWoTran: 'WO110', currentPhase: 'Painting', totalParts: 5, chores: { kim: { kind: 'paintPrep', by: 'Kim', startedAt: NOW - 7 * MIN } } },
    { id: 'z', nsWoTran: 'WO111', currentPhase: 'Complete', chores: { ann: { kind: 'setupPrep', by: 'Ann', startedAt: NOW - 90 * MIN } } }];
const fc = floorNowOf({ workOrders: withChore, cfg, nowMs: NOW });
eq('a chore is working now — on its order, with no step started (an order off the floor is not the floor\'s)', fc.working.filter(w => w.chore).map(w => `${w.who}:${w.step}:${w.ref}:${w.elapsedMins}:${w.state}`), ['Kim:Paint prep:WO110:7:chore']);
eq('the person on a chore is working, not free — even with their product in the oven', fc.crew.find(c => c.name === 'Kim').state, 'working');

eq('minutes, said for a wall', [sayMins(0), sayMins(8.4), sayMins(80), sayMins(null)], ['0 min', '8 min', '1 h 20', '—']);

console.log(`wallboard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
