// 🏆 How the floor works, person by person, week by week (Stuart 2026-10-14).   node scripts/floorMetrics.test.mjs
// Made-up people only — the repo is public; real names live in HQ → System Admin → Floor Metrics.
import {
    parseCsv, timecardDaysOf, mergeTimecardDays, timecardPeopleOf, usDateTimeMsOf, usDateKeyOf, displayNameOf,
    weekKeyOf, addDays, dateKeyOf, clockedMinsOf, breakMinsOf,
} from '../src/components/Shared/timecardImport.js';
import {
    floorTimersOf, standardMinsOf, floorStepsOf, activityOf, wmsKindOf, isWmsLog, clockIndexOf, personDaysOf, weekRowsOf,
    rankWeek, wallboardDocOf, weeksOf, boardOfRole, boardsOf, personKeyOf, CHORES_FROM, msOf, GROUP, WMS_KIND, SRC, SCORE_PARTS, standardsCheckOf, stationRatesOf, FLOOR_DAY_MINS,
} from '../src/components/Shared/floorMetrics.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const near = (n, a, b, tol = 0.01) => ok(`${n} — got ${a}`, a != null && Math.abs(a - b) <= tol);
const MIN = 60000;
const at = (y, m, d, h, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime();

// ── the time clock's export ────────────────────────────────────────────────────────────────────────────────
const HEAD = 'Employee Name,Employee Number,Date,Total Hours,Regular Hours,Overtime 1 Hours,Overtime 2 Hours,Overtime 3 Hours,Vacation Hours,Holiday Hours,Sick Hours,Personal Hours,First Punch In,Last Punch Out,Tip Amount,Bonus Amount,Commission Amount,Mileage,';
const row = (name, no, date, total, inT, outT, ot = 0) => `"${name}","${no}",${date},${total},${total - ot},${ot},0.00,0.00,0.00,0.00,0.00,0.00,${inT ? `${date} ${inT}` : ''},${outT ? `${date} ${outT}` : ''},$0,$0,$0,0,`;
const CSV_A = [HEAD,
    row('Painter, Pat', '9001', '10/5/2026', 8.5, '6:55:00 AM', '3:25:00 PM'),
    row('Painter, Pat', '9001', '10/6/2026', 8.5, '7:00:00 AM', '3:30:00 PM'),
    row('Picker, Robin', '9002', '10/5/2026', 8, '7:00:00 AM', '3:00:00 PM'),
    row('Picker, Robin', '9002', '10/6/2026', 8, '7:00:00 AM', '3:00:00 PM'),
    row('Nobody, Noel', '9003', '10/5/2026', 0, '', ''),
].join('\r\n') + '\r\n';
eq('csv: quotes, commas inside quotes, CRLF, trailing comma', parseCsv('"a, b",c,\r\n"x ""y""",2\r\n')[0], ['a, b', 'c', '']);
eq('csv: a doubled quote is one quote', parseCsv('"x ""y""",2\n')[0], ['x "y"', '2']);
eq('csv: blank lines dropped', parseCsv('a\n\n\nb\n').length, 2);
eq('us date', usDateKeyOf('9/29/2026'), '2026-09-29');
eq('us date-time AM', usDateTimeMsOf('9/29/2026 8:52:00 AM'), at(2026, 9, 29, 8, 52));
eq('us date-time PM', usDateTimeMsOf('9/29/2026 3:01:00 PM'), at(2026, 9, 29, 15, 1));
eq('12 PM is noon, 12 AM is midnight', [usDateTimeMsOf('10/1/2026 12:15:00 PM'), usDateTimeMsOf('10/1/2026 12:15:00 AM')], [at(2026, 10, 1, 12, 15), at(2026, 10, 1, 0, 15)]);
eq('not a time', [usDateTimeMsOf(''), usDateTimeMsOf('soon')], [null, null]);
eq('"Last, First" reads First Last', [displayNameOf('Painter, Pat'), displayNameOf('Cher')], ['Pat Painter', 'Cher']);
const daysA = timecardDaysOf(CSV_A);
eq('one row per person per day', daysA.length, 5);
eq('a day, read', (({ name, number, date, totalHours, inMs, outMs }) => ({ name, number, date, totalHours, inMs, outMs }))(daysA[0]),
    { name: 'Pat Painter', number: '9001', date: '2026-10-05', totalHours: 8.5, inMs: at(2026, 10, 5, 6, 55), outMs: at(2026, 10, 5, 15, 25) });
eq('a day with no punches has no clock window', [daysA[4].inMs, daysA[4].outMs, clockedMinsOf(daysA[4])], [null, null, null]);
eq('clocked minutes', clockedMinsOf(daysA[0]), 510);
eq('the unpaid break: the span less the hours paid (none when the whole span is paid)', [breakMinsOf({ inMs: at(2026, 10, 5, 7), outMs: at(2026, 10, 5, 15, 30), totalHours: 8 }), breakMinsOf(daysA[0]), breakMinsOf(daysA[4]), breakMinsOf(null)], [30, 0, 0, 0]);
let threw = ''; try { timecardDaysOf('Name,When\nA,B\n'); } catch (e) { threw = e.message; }
ok('a file that is not the export says so', /Not a time clock export/.test(threw));
eq('an empty file is no days', timecardDaysOf(''), []);
const CSV_B = [HEAD, row('Painter, Pat', '9001', '10/6/2026', 9, '6:30:00 AM', '3:30:00 PM', 1)].join('\n');
const merged = mergeTimecardDays(daysA, timecardDaysOf(CSV_B));
eq('two exports merge — the later file wins a day both carry', [merged.length, merged.find(d => d.number === '9001' && d.date === '2026-10-06').totalHours, merged.find(d => d.number === '9001' && d.date === '2026-10-06').otHours], [5, 9, 1]);
eq('the people on the cards', timecardPeopleOf(merged).map(p => `${p.name}:${p.days}`), ['Noel Nobody:1', 'Pat Painter:2', 'Robin Picker:2']);
eq('weeks run Monday → Sunday', [weekKeyOf('2026-10-05'), weekKeyOf('2026-10-11'), weekKeyOf('2026-10-12'), weekKeyOf('2026-10-14')], ['2026-10-05', '2026-10-05', '2026-10-12', '2026-10-12']);
eq('days add across a month', [addDays('2026-09-28', 6), addDays('2026-10-01', -1)], ['2026-10-04', '2026-09-30']);
eq('local day of a time', dateKeyOf(at(2026, 10, 5, 23, 59)), '2026-10-05');

// ── standards ──────────────────────────────────────────────────────────────────────────────────────────────
const T = floorTimersOf({ ovenMins: 6, poleMins: 4 });
eq('timers: the floor\'s settings where set, its fall-backs where not', T, { spinSetupMins: 10, spinPaintMins: 3, ovenMins: 6, handSmallMins: 1.35, handPoleMins: 10, poleMins: 4, boothCoatMins: 15, boothLoadPcs: 30 });
eq('timers with no settings at all', floorTimersOf(null).ovenMins, 10);
const SLED = { id: 'W1', totalParts: 20, recipe: 'SG' };
const POLES = { id: 'W2', totalParts: 10, totalPoles: 10, type: 'Poles' };
eq('a booth spray is the booth\'s standard, per load', standardMinsOf('spinSpray', { id: 'B', totalParts: 12, sprayStation: 'BOOTH' }, T), 15);
eq('standards — the floor\'s own Est Time', [standardMinsOf('spinSetup', SLED, T), standardMinsOf('spinSpray', SLED, T), standardMinsOf('spinBake', SLED, T), standardMinsOf('poleSpray', POLES, T), standardMinsOf('hand', SLED, T)], [10, 3, 6, 40, 27]);
const LOADS = { id: 'W3', totalParts: 420, sprayStation: 'SPIN', spinLoads: [{ n: 1, qty: 140, doneAt: at(2026, 10, 5, 10) }], spinLoadQty: 70 };
near('a hand coat on a spin job in loads is timed against its LOAD', standardMinsOf('hand', LOADS, T, at(2026, 10, 5, 9)), 140 * 1.35);
near('…the next load once the first is done', standardMinsOf('hand', LOADS, T, at(2026, 10, 5, 11)), 70 * 1.35);
near('a spin job never split into loads keeps the whole order', standardMinsOf('hand', { id: 'W4', totalParts: 40, sprayStation: 'SPIN' }, T, 0), 54);

// ── the floor's punches → steps ────────────────────────────────────────────────────────────────────────────
const D = (h, mi, s = 0) => at(2026, 10, 5, h, mi, s);
const start = (u, woId, task, t) => ({ action: 'START', u, woId, task, at: t });
const done = (u, woId, task, t, startedAtMs) => ({ action: 'COMPLETE', u, woId, task, at: t, startedAtMs, elapsedMs: t - startedAtMs });
const finLogs = [
    start('Pat', 'W1', 'spinSetup', D(7, 10)), done('Pat', 'W1', 'spinSetup', D(7, 21), D(7, 10)),       // 11 min — real
    start('Pat', 'W1', 'spinSpray', D(7, 22)), done('Pat', 'W1', 'spinSpray', D(7, 25), D(7, 22)),       // 3 min — real
    start('Pat', 'W1', 'spinBake', D(7, 26)), done('Pat', 'W1', 'spinBake', D(7, 33), D(7, 26)),         // oven 7 min
    start('Pat', 'W1', 'spinSetup', D(7, 34)), done('Pat', 'W1', 'spinSetup', D(7, 34, 4), D(7, 34)),    // 4 s — not real
    start('Pat', 'W2', 'poleSpray', D(7, 40)), done('Pat', 'W2', 'poleSpray', D(8, 40), D(7, 40)),       // 60 min of 40 — real, 1.5×
    start('Pat', 'W2', 'poleBake', D(8, 41)), done('Lee', 'W2', 'poleBake', D(8, 50), D(8, 41)),         // started by Pat, closed by Lee
    start('Pat', 'W1', 'spinSpray', D(9, 30)), done('Pat', 'W1', 'spinSpray', D(14, 30), D(9, 30)),      // left running — 300 min of 3
    { action: 'COMPLETE', u: 'Pat', woId: 'W1', task: 'spinSetup', at: D(9, 0), startedAtMs: null, elapsedMs: null },   // not timed
    { action: 'PUNCH_WARNING', u: 'Pat', woId: 'W1', task: 'spinSetup', at: D(7, 34, 5) },
    done('Tablet', 'W1', 'spinSpray', D(10, 0), D(9, 55)),                                               // nobody
];
const wosById = { W1: { ...SLED, reqDate: '2026-10-06', completedAt: D(15, 0) }, W2: { ...POLES, reqDate: '2026-10-04', completedAt: D(15, 0) } };
const steps = floorStepsOf({ finLogs, wosById, timers: T });
eq('every timed completion, once — the untimed one and "Tablet" left out', steps.length, 7);
eq('who did what', steps.map(s => `${s.who}:${s.task}`), ['Pat:spinSetup', 'Pat:spinSpray', 'Pat:spinBake', 'Pat:spinSetup', 'Pat:poleSpray', 'Pat:poleBake', 'Pat:spinSpray']);
eq('the person is whoever STARTED it; the completer is kept', [steps[5].who, steps[5].completedBy], ['Pat', 'Lee']);
eq('real or not, by the floor\'s punch check', steps.map(s => s.short), [false, false, false, true, false, false, false]);
eq('left running is marked, not timed', steps.map(s => s.overrun), [false, false, false, false, false, false, true]);
eq('the oven is the oven', steps.filter(s => s.oven).map(s => s.task), ['spinBake', 'poleBake']);
eq('a completion logged twice counts once', floorStepsOf({ finLogs: [...finLogs, finLogs[1]], wosById, timers: T }).length, 7);

// ── everything a person touched ────────────────────────────────────────────────────────────────────────────
eq('WMS words → kinds', ['Order Picked: WO-1', 'Packed SO1 (3 lines, 2 photos)', 'Bin Transfer: 4 X M 1 -> M 2.', 'Put away WO-9 → bin M 4 (1 lines)', 'Plating put-away: 6 × A built into B', 'Receiving PO1: 6 × X onto the cart.', 'Count push: 1 adjustment line(s).', 'Printed 2 × X item label(s).', 'Order Staged & Matched: WO-2', 'Fulfilment deferred for X'].map(wmsKindOf),
    ['pick', 'pack', 'move', 'putaway', 'putaway', 'receive', 'count', 'label', 'stage', 'other']);
eq('a WMS log: stamped, or one of its categories before the stamp', [isWmsLog({ src: 'WMS', cat: 'alert' }), isWmsLog({ cat: 'packing' }), isWmsLog({ cat: 'setup' }), isWmsLog({ src: 'FINISHING', cat: 'production' })], [true, true, false, false]);
eq('Firestore time → ms', [msOf({ seconds: 10, nanoseconds: 5e6 }), msOf({ toMillis: () => 7 }), msOf(5), msOf(null)], [10005, 7, 5, 0]);
const R = (h, mi) => at(2026, 10, 5, h, mi);
const hqLogs = [
    { u: 'Robin', src: 'WMS', cat: 'wms', msg: 'Order Picked: WP1', t: { seconds: R(7, 20) / 1000 } },
    { u: 'Robin', cat: 'wms', msg: 'Bin Transfer: 4 X M 1 -> M 2.', t: { seconds: R(8, 5) / 1000 } },
    { u: 'Robin', src: 'WMS', cat: 'packing', msg: 'Put away WP2 → bin M 4 (1 lines)', t: { seconds: R(11, 40) / 1000 } },
    { u: 'Sam', cat: 'setup', msg: 'Start Setup WO-x', t: { seconds: R(7, 5) / 1000 } },
    { u: 'Ana', src: 'HQ', cat: 'crm', msg: 'Quote saved', t: { seconds: R(9, 0) / 1000 } },
];
const wos = [
    { id: 'WP1', pickedAt: R(7, 20), pickedBy: 'Robin', reqDate: '2026-10-05' },
    { id: 'WP2', packedAt: R(13, 10), packedBy: 'robin', reqDate: '2026-10-02' },
    { id: 'WP3', packedAt: R(13, 15), packedBy: 'Packer' },
];
const events = activityOf({ finLogs, hqLogs, wos });
eq('floor punches, app logs and stamps — the warning and nobody left out', events.filter(e => e.who === 'Pat').length, 14);
eq('where each came from', [...new Set(events.map(e => `${personKeyOf(e.who)}:${e.src}`))].sort(), ['ana:app', 'lee:floor', 'pat:floor', 'robin:wms', 'sam:floor-app']);
eq('the pick stamp and its log line are one pick', events.filter(e => e.kind === WMS_KIND.PICK).map(e => e.ref), ['WP1', 'WP1']);

// ── days, against the clock ───────────────────────────────────────────────────────────────────────────────
const timecard = [
    { number: '9001', date: '2026-10-05', totalHours: 8.5, inMs: at(2026, 10, 5, 6, 55), outMs: at(2026, 10, 5, 15, 25) },
    { number: '9002', date: '2026-10-05', totalHours: 8, inMs: at(2026, 10, 5, 7, 0), outMs: at(2026, 10, 5, 12, 0) },
    { number: '9002', date: '2026-10-06', totalHours: 7.5, inMs: at(2026, 10, 6, 7, 0), outMs: at(2026, 10, 6, 15, 0) },   // a 30-minute lunch
];
const clock = clockIndexOf(timecard, { Pat: '9001', robin: '9002', Ghost: '9999' });
eq('the clock, by app person (case-blind; an unknown number is nobody)', [...clock.keys()], ['pat', 'robin']);
const groups = { pat: GROUP.FINISHING, robin: GROUP.WMS, sam: GROUP.FINISHING, lee: GROUP.FINISHING };
const pdays = personDaysOf({ steps, events, clockByPerson: clock, boardOf: (pk) => groups[pk] || GROUP.NONE, nameOf: (pk) => pk.toUpperCase() });
const pat = pdays.find(d => d.pk === 'pat');
eq('first pin: 7:10 — fifteen minutes after the 6:55 clock-in', [pat.firstMs, pat.startLagMins], [D(7, 10), 15]);
eq('steps, not-real punches, left running', [pat.steps, pat.short, pat.overruns], [5, 1, 1]);
eq('pace: real, timed steps against their standard', pat.ratios.map(r => Math.round(r * 100) / 100), [1.1, 1, 1.5]);
eq('next order: 7:34 setup on W1 → 7:40 poles on W2 = 6 min; back to W1 at 9:30 = 50 min', pat.gaps.map(Math.round), [6, 50]);
near('busy: the person\'s own timed steps (11 + 3 + 0.07 + 60)', pat.busyMins, 74.07);
near('free: their product in the oven while they did nothing else (7 + 9)', pat.ovenFreeMins, 16);
eq('the day in half-hours: 17 on the clock; a step left running is not work', [pat.slots.total, pat.slots.working, pat.slots.free, pat.slots.lunch, pat.slots.idle], [17, 7, 0, 0, 10]);
eq('the longest idle stretch: 9:55 → 14:25', pat.slots.longestIdleMins, 270);
const robin = pdays.filter(d => d.pk === 'robin');
eq('robin works two clocked days; the second with nothing done', robin.map(d => [d.date, d.actions]), [['2026-10-05', 4], ['2026-10-06', 0]]);
eq('the lunch comes off the idle half-hours and off the longest idle stretch', [robin[1].slots.total, robin[1].slots.lunch, robin[1].slots.idle, robin[1].slots.longestIdleMins], [16, 1, 15, 450]);
eq('picks and packs, each once', [robin[0].picks, robin[0].packs], [1, 1]);
eq('first action 7:20 after a 7:00 clock-in', robin[0].startLagMins, 20);
eq('WMS half-hours: 10 on the clock, 3 with something done (the 1:10 pack is after clock-out)', [robin[0].slots.total, robin[0].slots.working], [10, 3]);
const sam = pdays.find(d => d.pk === 'sam');
eq('working without a clock row is flagged', [sam.unclocked, sam.startLagMins, sam.slots], [true, null, null]);

// ── the week ───────────────────────────────────────────────────────────────────────────────────────────────
const rows = weekRowsOf({ personDays: pdays, week: '2026-10-05', wosById: { ...wosById, WP1: wos[0], WP2: wos[1] } });
const patW = rows.find(r => r.pk === 'pat');
eq('week: days, hours (HQ only), steps', [patW.activeDays, patW.hours, patW.steps], [1, 8.5, 5]);
near('week: real punches', patW.realShare, 0.8);
near('week: pace (median)', patW.paceRatio, 1.1);
eq('week: due dates — W1 finished by its date, W2 two days late', patW.onTime, { ok: 1, total: 2 });
const robW = rows.find(r => r.pk === 'robin');
eq('week, WMS: due dates — picked on the day, packed late', robW.onTime, { ok: 1, total: 2 });
eq('week, WMS: steady over both days (3 of 25 half-hours — lunch out)', Math.round(robW.steadyShare * 100), 12);
near('week, WMS: actions an hour (4 actions over 13 clocked hours)', robW.actionsPerHour, 4 / 13);
eq('week: hours are the hours PAID', robW.hours, 15.5);
eq('weeks with anything in them, newest first', weeksOf([{ week: '2026-09-28' }, { week: '2026-10-05' }, { week: '2026-09-28' }]), ['2026-10-05', '2026-09-28']);

// ── the score, the ranks, the halls ───────────────────────────────────────────────────────────────────────
const fin = (who, o) => ({ pk: personKeyOf(who), who, group: GROUP.FINISHING, week: '2026-10-05', activeDays: 4, floorDays: 4, steps: 40, overruns: 0, startLagMins: 10, realShare: 1, paceRatio: 1, nextGapMins: 5, steadyShare: 0.9, onTime: { ok: 4, total: 4 }, ...o });
const wmsRow = (who, o) => ({ pk: personKeyOf(who), who, group: GROUP.WMS, week: '2026-10-05', activeDays: 4, actions: 60, startLagMins: 10, steadyShare: 0.9, actionsPerHour: 2, onTime: { ok: 2, total: 2 }, ...o });
const weekRows = [
    fin('Ace'), fin('Bea', { realShare: 0.5 }), fin('Cal', { startLagMins: 60, realShare: 0.2, paceRatio: 2.5, steadyShare: 0.3 }),
    fin('Dee', { nextGapMins: 35 }), fin('Eve', { paceRatio: 1.5 }), fin('Fay', { realShare: 0.9 }), fin('Gus', { steps: 3 }),
    wmsRow('Hal'), wmsRow('Ivy', { actionsPerHour: 1, steadyShare: 0.5 }), wmsRow('Jo', { startLagMins: null, steadyShare: null, onTime: { ok: 0, total: 0 } }),
    { pk: 'boss', who: 'Boss', group: GROUP.NONE, activeDays: 5, steps: 99 },
];
const ranked = rankWeek(weekRows);
eq('a perfect week scores 100', ranked.finishing[0].who + ':' + ranked.finishing[0].score, 'Ace:100');
eq('finishing, ranked (no production read here — the score is out of the other 75)', ranked.finishing.map(r => `${r.rank}.${r.who}:${r.score}`), ['1.Ace:100', '2.Fay:98', '3.Dee:93', '4.Eve:93', '5.Bea:90', '6.Cal:37']);
eq('too little to rank, a part-read row, and the not-ranked roles wait aside', ranked.unranked.map(r => r.who).sort(), ['Boss', 'Gus', 'Jo']);
eq('WMS volume is against the group\'s own median (Jo\'s rate counts, though Jo cannot be scored)', ranked.wms.map(r => `${r.who}:${r.score}`), ['Hal:100', 'Ivy:58']);
eq('hall of fame: the top three, with what they did best', ranked.fame.finishing.map(f => f.name), ['Ace', 'Fay', 'Dee']);
eq('hall of shame: from the bottom three, only a score under 60 is named (Stuart 10-22) — Bea 88 and Eve 93 are not', ranked.shame.finishing.map(f => `${f.name} — ${f.why}`),
    ['Cal — working 30% of the day']);
eq('a week where everyone scores 60 or more shames nobody', rankWeek([fin('Ace'), fin('Bea', { realShare: 0.5 }), fin('Dee', { nextGapMins: 35 }), fin('Eve', { paceRatio: 1.5 })]).shame.finishing, []);
eq('a group of two: one each side', [ranked.fame.wms.map(f => f.name), ranked.shame.wms.map(f => f.name)], [['Hal'], ['Ivy']]);
eq('every part has a weight, and each group sums to 100', Object.values(SCORE_PARTS).map(ps => ps.reduce((t, p) => t + p.weight, 0)), [100, 100]);
eq('roles → boards (the setup manager is on both)', ['painter', 'hand_painter', 'Paint_Manager', 'setup_manager', 'setup', 'operator', 'admin', 'csr', ''].map(boardOfRole),
    ['finishing', 'finishing', 'finishing', 'both', 'wms', 'none', 'none', 'none', 'none']);
eq('a board setting → the boards ranked on', ['both', 'finishing', 'wms', 'none', '', undefined].map(boardsOf), [['finishing', 'wms'], ['finishing'], ['wms'], ['none'], ['none'], ['none']]);

// ── what the floor may read ───────────────────────────────────────────────────────────────────────────────
const board = wallboardDocOf({ week: '2026-10-05', ranked, by: 'Admin', nowMs: 123 });
eq('the wallboard: the week, who published', [board.week, board.weekEnd, board.publishedBy, board.publishedAt], ['2026-10-05', '2026-10-11', 'Admin', 123]);
eq('the wallboard: names, ranks, scores', board.groups.finishing.map(r => `${r.rank}.${r.name}:${r.score}`).slice(0, 2), ['1.Ace:100', '2.Fay:98']);
const flat = JSON.stringify(board);
ok('the wallboard carries NO hours and no clock times', !/hours|clocked|inMs|outMs|"clock"/i.test(flat));
eq('the wallboard: parts in whole percent', board.groups.finishing[5].parts, { start: 0, punches: 20, closed: 100, next: 100, pace: 0, steady: 0, output: null, onTime: 100 });
eq('the halls ride along', [board.fame.finishing.length, board.shame.wms.length], [3, 1]);
eq('nothing to publish is an empty board, not a crash', wallboardDocOf({ week: '2026-10-05', ranked: rankWeek([]) }).groups, { finishing: [], wms: [] });

// ── WMS work includes the Setup Queue; one action, however many records ─────────────────────────────────────
const stagedDay = personDaysOf({
    events: [
        { who: 'Kit', at: R(7, 30), src: SRC.WMS, kind: WMS_KIND.PICK, ref: 'A' }, { who: 'Kit', at: R(7, 31), src: SRC.WMS, kind: WMS_KIND.PICK, ref: 'A' },
        { who: 'Kit', at: R(8, 0), src: SRC.FLOOR_APP, kind: 'app', ref: '' }, { who: 'Kit', at: R(8, 2), src: SRC.FLOOR_APP, kind: 'app', ref: '' },
        { who: 'Kit', at: R(9, 0), src: SRC.APP, kind: 'app', ref: '' },
    ],
    boardOf: () => GROUP.WMS,
})[0];
eq('WMS: a pick logged twice is one action; two Setup Queue actions are two; an office action is not WMS work', stagedDay.actions, 3);

// ── the standards, against the floor ────────────────────────────────────────────────────────────────────────
const sprays = Array.from({ length: 12 }, (_, i) => ({ task: 'spinSpray', woId: 'B1', ranMins: 20 + i, normalMins: 3, short: false, overrun: false }));
const setups = Array.from({ length: 12 }, (_, i) => ({ task: 'spinSetup', woId: 'S1', ranMins: i < 10 ? 0.1 : 11, normalMins: 10, short: i < 10, overrun: false }));
const check = standardsCheckOf([...sprays, ...setups], { B1: { id: 'B1', totalParts: 12, sprayStation: 'BOOTH' }, S1: { id: 'S1', totalParts: 70, sprayStation: 'SPIN' } });
eq('standards: a booth spray standard far under the crew\'s real median is flagged', check.find(c => c.task === 'spinSpray'), { task: 'spinSpray', station: 'booth', oven: false, n: 12, short: 0, real: 12, realMedianMins: 25.5, standardMins: 3, off: true });
eq('standards: too few real punches to judge is not flagged', [check.find(c => c.task === 'spinSetup').station, check.find(c => c.task === 'spinSetup').real, check.find(c => c.task === 'spinSetup').off], ['spin', 2, false]);

// ── the setup manager, on both boards (Stuart 2026-10-14) ───────────────────────────────────────────────────────
const S = (h, mi) => at(2026, 10, 5, h, mi);
const setupLogs = [
    { u: 'Sid', cat: 'production', msg: 'Started Setup for WO11688 → Large Booth', t: { seconds: S(7, 10) / 1000 } },           // before the src stamp
    { u: 'Sid', src: 'FINISHING', cat: 'production', msg: 'Staged WO11688 to Floor (70 pcs; floor now ~140 pcs)', t: { seconds: S(7, 40) / 1000 } },
    { u: 'Sid', src: 'FINISHING', cat: 'production', msg: 'Started Setup for WO-STK-9 — 1 part line', t: { seconds: S(8, 30) / 1000 } },
    { u: 'Sid', src: 'WMS', cat: 'wms', msg: 'Order Picked: WO-STK-9', t: { seconds: S(9, 0) / 1000 } },
    { u: 'Sid', src: 'SHOP', cat: 'production', msg: 'Cut list printed', t: { seconds: S(9, 30) / 1000 } },
];
const setupWos = { D1: { id: 'D1', nsWoTran: 'WO11688', reqDate: '2026-10-06', completedAt: S(15, 0) }, 'WO-STK-9': { id: 'WO-STK-9', reqDate: '2026-10-01', completedAt: S(14, 0) } };
const sidEv = activityOf({ hqLogs: setupLogs });
eq('the Setup Queue\'s lines — before and after the src stamp — are the floor\'s; the shop\'s are not', sidEv.map(e => `${e.src}:${e.kind}:${e.ref}`),
    ['floor-app:setup:WO11688', 'floor-app:staged:WO11688', 'floor-app:setup:WO-STK-9', 'wms:pick:WO-STK-9', 'app:app:']);
const sidClock = clockIndexOf([{ number: '7001', date: '2026-10-05', totalHours: 8, inMs: S(7, 0), outMs: S(15, 0) }], { sid: '7001' });
const sidDays = personDaysOf({ events: sidEv, clockByPerson: sidClock, boardOf: () => GROUP.BOTH });
eq('on both boards: one day row on each', sidDays.map(d => d.group), ['finishing', 'wms']);
eq('finishing reads the Setup Queue: first touch 7:10, three setups', [sidDays[0].startLagMins, sidDays[0].setups, sidDays[0].actions], [10, 3, 3]);
eq('pick / pack reads the WMS and the Setup Queue', [sidDays[1].actions, sidDays[1].picks], [4, 1]);
const sidRows = weekRowsOf({ personDays: sidDays, week: '2026-10-05', wosById: setupWos });
eq('a row per board', sidRows.map(r => r.group), ['finishing', 'wms']);
eq('finishing due dates: the orders set up, found by the ref the log names (WO11688 on time, WO-STK-9 late)', sidRows[0].onTime, { ok: 1, total: 2 });
eq('pick / pack due dates: what was picked', sidRows[1].onTime, { ok: 0, total: 1 });
const sidWeek = (o) => ({ pk: 'sid', who: 'Sid', group: GROUP.FINISHING, week: '2026-10-05', activeDays: 4, floorDays: 4, steps: 0, setups: 40, startLagMins: 10, realShare: null, paceRatio: null, nextGapMins: null, steadyShare: 0.9, onTime: { ok: 3, total: 4 }, ...o });
const sidRank = rankWeek([sidWeek(), fin('Ace'), fin('Bea', { realShare: 0.5 })]);
eq('a setup manager is ranked on the finishing board by start, steady and due dates — punches, punched out, next order, pace and production left out', [sidRank.finishing.find(r => r.who === 'Sid').score, sidRank.finishing.find(r => r.who === 'Sid').parts.filter(p => p.value == null).map(p => p.key)], [93, ['punches', 'closed', 'next', 'pace', 'output']]);
eq('…and not without the setups', rankWeek([sidWeek({ setups: 3 })]).unranked.map(r => r.who), ['Sid']);

// ── production and punching, scored on their own (Stuart 2026-10-22) ──────────────────────────────────────────────
// "add a score one for prompt and correct punching … and one for actual production amounts"; rank on three floor days
const pr = rankWeek([fin('Ann', { outputRatio: 1.3 }), fin('Bo', { outputRatio: 0.7 }), fin('Cy', { outputRatio: 1 }), fin('Di', { outputRatio: 2, floorDays: 2, activeDays: 4 })]);
eq('production against a usual day at their stations: 1.2× or more is 100, 1.0× is 75, 0.7× is 37; punching is its own', pr.finishing.map(r => `${r.who}:${r.score}:punching ${r.punching}:production ${r.production}`),
    ['Ann:100:punching 100:production 100', 'Cy:94:punching 100:production 75', 'Bo:84:punching 100:production 37']);
eq('two floor days is not ranked on finishing, however good — whatever else they did', pr.unranked.map(r => r.who), ['Di']);
eq('production says what it read', pr.finishing.find(r => r.who === 'Bo').parts.find(p => p.key === 'output').says, '0.7× a usual day at their stations');
eq('punching reads start, real punches, punched out and next order — and a step left running costs it', rankWeek([fin('Ace'), fin('Lo', { overruns: 4, realShare: 0.75, nextGapMins: 35 }), fin('Mo')]).finishing.map(r => `${r.who}:${r.punching}`), ['Ace:100', 'Mo:100', 'Lo:72']);
const wb2 = wallboardDocOf({ week: '2026-10-05', ranked: pr, nowMs: 1 });
eq('the wallboard carries both scores and the floor days', [wb2.groups.finishing[0].punching, wb2.groups.finishing[0].production, wb2.groups.finishing[0].facts.floorDays, wb2.groups.finishing[0].facts.outputRatio], [100, 100, 4, 1.3]);
// what a step is worth: the crew's usual time for it at that station and batch size (three real punches), else its standard
const P = (h, mi) => at(2026, 10, 5, h, mi);
const pw = { W: { id: 'W', totalParts: 100, sprayStation: 'SPIN', partsList: [{ legacyErpId: 'R1', productType: 'RING', quantity: 100 }] }, B: { id: 'B', totalParts: 10, sprayStation: 'BOOTH', partsList: [{ legacyErpId: 'K1', productType: 'BRACKET', quantity: 10 }] } };
const ps = (who, woId, h1, m1, h2, m2) => ({ who, woId, task: 'spinSpray', person: true, oven: false, startMs: P(h1, m1), endMs: P(h2, m2), ranMins: (P(h2, m2) - P(h1, m1)) / 60000, normalMins: 20, short: false, overrun: false });
const pdd = personDaysOf({ steps: [ps('Zed', 'W', 8, 0, 8, 20), ps('Zed', 'B', 9, 0, 9, 30), ps('Yo', 'W', 10, 0, 10, 10), ps('Xi', 'W', 11, 0, 11, 30)], wosById: pw, boardOf: () => GROUP.FINISHING });
eq('earned: a sled of 100 rings is worth the crew\'s usual 20 min (three punches: 20, 10, 30); the lone booth coat its 20-min standard — and a day with no clock row is a full 8 h, however short its punches', ['zed', 'yo', 'xi'].map(k => { const d = pdd.find(x => x.pk === k); return [d.earnedMins, d.attendedMins, d.earnedByStation]; }), [[40, FLOOR_DAY_MINS, { spin: 20, booth: 20 }], [20, 480, { spin: 20 }], [20, 480, { spin: 20 }]]);
const pwk = weekRowsOf({ personDays: pdd, week: '2026-10-05', wosById: pw, rates: { spin: 0.05, booth: 0.1, all: 0.05 } });
eq('the week: earned against what a usual day at those stations earns (Zed half spin at 5%, half booth at 10% of a day)', pwk.map(r => [r.who, Math.round(r.outputRatio * 100) / 100, r.floorDays]), [['xi', 0.83, 1], ['yo', 0.83, 1], ['zed', 1.11, 1]]);
// what a usual FULL day at a station earns — six hours on the floor, most of it at the one station; a helper's steps are no day
const rd = (st, earned, o = {}) => ({ group: GROUP.FINISHING, earnedMins: earned, earnedByStation: { [st]: earned }, attendedMins: 480, spanMins: 480, clock: null, ...o });
const rates = stationRatesOf([rd('spin', 180, { spanMins: 500 }), rd('spin', 200), rd('spin', 160, { spanMins: 420 }), rd('booth', 400), rd('spin', 20, { spanMins: 60 }),
    rd('booth', 300, { clock: {}, attendedMins: 400, spanMins: 100 }), { ...rd('spin', 400), group: GROUP.WMS }]);
eq('a station\'s usual day from its full days (spin: three); too few (booth: two) reads every full day\'s median', [rates.spin, rates.booth, rates.hand, rates.spinDays, rates.boothDays].map(x => Math.round(x * 1000) / 1000), [0.375, 0.417, 0.417, 3, 2]);

// ── chores (Stuart 2026-10-14) — work like a step; from the day they exist, oven time with nothing done is idle ─────
eq('chores count from the day after they shipped', CHORES_FROM, '2026-10-15');
const day = (y, m, d) => (h, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const choreDay = (D, date) => {
    const bake = { who: 'Pat', woId: 'W1', task: 'spinBake', person: false, oven: true, startMs: D(8, 0), endMs: D(9, 0), ranMins: 60, normalMins: 6, short: false, overrun: false };
    const spray = { who: 'Pat', woId: 'W1', task: 'spinSpray', person: true, oven: false, startMs: D(7, 0), endMs: D(7, 50), ranMins: 50, normalMins: 30, short: false, overrun: false };
    const chore = { who: 'Pat', woId: 'W1', kind: 'paintPrep', startMs: D(8, 0), endMs: D(8, 25) };
    const clk = clockIndexOf([{ number: '1', date, totalHours: 3, inMs: D(7, 0), outMs: D(10, 0) }], { pat: '1' });
    return personDaysOf({ steps: [spray, bake], chores: [chore], clockByPerson: clk, boardOf: () => GROUP.FINISHING })[0];
};
const before = choreDay(day(2026, 10, 14), '2026-10-14'), after = choreDay(day(2026, 10, 15), '2026-10-15');
eq('a chore is work: its minutes, and the oven-free time is what the chore did not cover', [Math.round(after.choreMins), Math.round(after.ovenFreeMins), after.chores], [25, 35, 1]);
eq('before chores existed: the half-hour with only the product in the oven is free, not scored', [before.slots.working, before.slots.free, before.slots.idle], [3, 1, 2]);
eq('from CHORES_FROM: that half-hour is idle — "should be expected to do other chores"', [after.slots.working, after.slots.free, after.slots.idle], [3, 0, 3]);

console.log(`floorMetrics: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
