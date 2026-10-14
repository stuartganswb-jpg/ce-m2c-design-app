// ⏱ The time clock — punches, the day, the pay period, hours over 40 (Stuart 2026-10-14).   node scripts/timeClock.test.mjs
// Made-up people only — the repo is public.
import {
    PUNCH, STATE, WARN, clockKeyOf, payPeriodOf, payPeriodFrom, clockOfferOf, punchOrderWarning, punchRecordOf, statusAfterOf,
    punchTimeOf, dayOfPunches, payrollOf, correctionOf, voidPatchOf, clockDaysByPersonOf, PAY_PERIOD_ANCHOR,
} from '../src/components/Shared/timeClock.js';
import { breakMinsOf, clockedMinsOf } from '../src/components/Shared/timecardImport.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const at = (m, d, h, mi = 0) => new Date(2026, m - 1, d, h, mi).getTime();
const ts = (ms) => ({ seconds: ms / 1000 });   // a Firestore server time
const p = (name, kind, ms, o = {}) => ({ name, kind, t: ts(ms), at: ms + 2000, source: 'clock', ...o });

// ── pay periods ───────────────────────────────────────────────────────────────────────────────────────────
eq('the anchor: Monday the 12th', PAY_PERIOD_ANCHOR, '2026-10-12');
eq('this period: Oct 12 → 25 (two weeks, Monday → Sunday)', [payPeriodOf('2026-10-12'), payPeriodOf('2026-10-23'), payPeriodOf('2026-10-25')], [{ start: '2026-10-12', end: '2026-10-25' }, { start: '2026-10-12', end: '2026-10-25' }, { start: '2026-10-12', end: '2026-10-25' }]);
eq('the next and the last', [payPeriodOf('2026-10-26'), payPeriodOf('2026-10-11'), payPeriodFrom('2026-10-14', -1), payPeriodFrom('2026-10-14', 1)],
    [{ start: '2026-10-26', end: '2026-11-08' }, { start: '2026-09-28', end: '2026-10-11' }, { start: '2026-09-28', end: '2026-10-11' }, { start: '2026-10-26', end: '2026-11-08' }]);
eq('across the year end', payPeriodOf('2027-01-01'), { start: '2026-12-21', end: '2027-01-03' });

// ── the kiosk ─────────────────────────────────────────────────────────────────────────────────────────────
const NOW = at(10, 14, 12, 5);
eq('a key for the clock', [clockKeyOf('Sandra G'), clockKeyOf(' G Florida ')], ['sandra_g', 'g_florida']);
eq('nobody yet → clock in', clockOfferOf(null, NOW), { state: 'out', expected: ['in'], stale: null });
eq('clocked in → lunch out or clock out', clockOfferOf({ kind: 'in', at: at(10, 14, 7) }, NOW).expected, ['lunchOut', 'out']);
eq('at lunch → lunch in', clockOfferOf({ kind: 'lunchOut', at: at(10, 14, 11, 30) }, NOW).expected, ['lunchIn']);
eq('back from lunch → lunch out or clock out', clockOfferOf({ kind: 'lunchIn', at: at(10, 14, 12) }, NOW).state, STATE.IN);
const stale = clockOfferOf({ kind: 'in', at: at(10, 13, 7) }, NOW);
eq('yesterday never clocked out → today starts fresh, and it is said', [stale.state, stale.expected, stale.stale.day], ['out', ['in'], '2026-10-13']);
eq('the expected punch is said nothing about', punchOrderWarning({ kind: 'in', at: at(10, 14, 7) }, PUNCH.LUNCH_OUT, NOW), null);
ok('clock out while at lunch → asked, in English and Spanish', /out to lunch/.test(punchOrderWarning({ kind: 'lunchOut', at: at(10, 14, 11, 30) }, PUNCH.OUT, NOW) || '') && /en la comida/.test(punchOrderWarning({ kind: 'lunchOut', at: at(10, 14, 11, 30) }, PUNCH.OUT, NOW) || ''));
ok('a day left open is told at the next punch', /no clock-out/.test(punchOrderWarning({ kind: 'in', at: at(10, 13, 7) }, PUNCH.IN, NOW) || ''));
eq('the punch written', punchRecordOf({ name: ' Pat ', kind: 'in', nowMs: NOW, device: 'tablet 2' }), { name: 'Pat', kind: 'in', at: NOW, source: 'clock', device: 'tablet 2' });
eq('the state after it', statusAfterOf({ name: 'Pat', kind: 'lunchOut', nowMs: NOW }), { name: 'Pat', kind: 'lunchOut', state: 'lunch', at: NOW });

// ── a day ─────────────────────────────────────────────────────────────────────────────────────────────────
eq('a clock punch is the server\'s time; a correction is the time the admin entered', [punchTimeOf(p('Pat', 'in', at(10, 14, 7))), punchTimeOf({ source: 'admin', at: at(10, 14, 7, 5), t: ts(NOW) })], [at(10, 14, 7), at(10, 14, 7, 5)]);
const full = dayOfPunches([p('Pat', 'out', at(10, 13, 15, 30)), p('Pat', 'in', at(10, 13, 7)), p('Pat', 'lunchOut', at(10, 13, 11, 30)), p('Pat', 'lunchIn', at(10, 13, 12))]);
eq('a full day: 8 h worked, a 30-minute lunch, nothing missing', [full.workedMins / 60, full.lunchMins, full.warnings, full.inMs, full.outMs], [8, 30, [], at(10, 13, 7), at(10, 13, 15, 30)]);
eq('no clock-out', dayOfPunches([p('Pat', 'in', at(10, 13, 7))]).warnings, [WARN.NO_OUT]);
eq('…but not on a day still going', dayOfPunches([p('Pat', 'in', at(10, 14, 7))], { isToday: true }).warnings, []);
eq('out to lunch and never back', dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'lunchOut', at(10, 13, 11, 30)), p('Pat', 'out', at(10, 13, 15, 30))]).warnings, [WARN.NO_LUNCH_IN]);
eq('back from a lunch never punched out to', dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'lunchIn', at(10, 13, 12)), p('Pat', 'out', at(10, 13, 15, 30))]).warnings, [WARN.NO_LUNCH_OUT]);
eq('a clock-out with no clock-in', dayOfPunches([p('Pat', 'out', at(10, 13, 15, 30))]).warnings, [WARN.NO_IN]);
eq('clocked in twice', dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'in', at(10, 13, 7, 2)), p('Pat', 'lunchOut', at(10, 13, 11)), p('Pat', 'lunchIn', at(10, 13, 11, 30)), p('Pat', 'out', at(10, 13, 15))]).warnings, [WARN.DOUBLE_IN]);
const noLunch = dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'out', at(10, 13, 15, 30))]);
eq('8½ hours with no lunch punched is flagged — and paid as punched', [noLunch.warnings, noLunch.workedMins / 60], [[WARN.NO_LUNCH], 8.5]);
eq('a short day needs no lunch', dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'out', at(10, 13, 12))]).warnings, []);
const corrected = dayOfPunches([p('Pat', 'in', at(10, 13, 7)), p('Pat', 'out', at(10, 13, 9), { void: true }), correctionOf({ name: 'Pat', kind: 'out', atMs: at(10, 13, 11), by: 'Boss', reason: 'forgot' })]);
eq('a voided punch is out, an admin\'s correction is in', [corrected.workedMins / 60, corrected.warnings], [4, []]);
eq('a correction, as written', correctionOf({ name: 'Pat', kind: 'out', atMs: 5, by: ' Boss ', reason: ' forgot ' }), { name: 'Pat', kind: 'out', at: 5, source: 'admin', by: 'Boss', reason: 'forgot' });
eq('a void, as written', voidPatchOf({ by: 'Boss', reason: 'wrong person', nowMs: 9 }), { void: true, voidBy: 'Boss', voidReason: 'wrong person', voidAt: 9 });

// ── the pay period ────────────────────────────────────────────────────────────────────────────────────────
const day = (name, m, d, inH, outH, lunch = true) => [p(name, 'in', at(m, d, inH)), ...(lunch ? [p(name, 'lunchOut', at(m, d, 11, 30)), p(name, 'lunchIn', at(m, d, 12))] : []), p(name, 'out', at(m, d, outH))];
const punches = [
    // Pat: week 1 five 9-hour days (45 h → 5 OT), week 2 four 8-hour days
    ...[12, 13, 14, 15, 16].flatMap(d => day('Pat', 10, d, 6, 15, false).concat()).filter(x => x.kind !== 'lunchOut'),
    ...[19, 20, 21, 22].flatMap(d => day('Pat', 10, d, 7, 15, false)),
    // Robin: one day with a missing clock-out, one Saturday
    ...day('Robin', 10, 12, 7, 15), p('Robin', 'in', at(10, 13, 7)), ...day('Robin', 10, 17, 8, 12, false),
    // outside the period
    ...day('Pat', 10, 9, 7, 15), ...day('Pat', 10, 26, 7, 15),
];
const pay = payrollOf({ punches, period: payPeriodOf('2026-10-14'), numberOf: (n) => ({ Pat: '9001' })[n] || '', todayKey: '2026-10-27' });
eq('one row per person, by name', pay.map(r => `${r.name}#${r.number}`), ['Pat#9001', 'Robin#']);
eq('Pat: week 1 45 h → 40 regular + 5 over 40; week 2 32 h', pay[0].weeks, [{ week: '2026-10-12', hours: 45, regular: 40, overtime: 5 }, { week: '2026-10-19', hours: 32, regular: 32, overtime: 0 }]);
eq('Pat: the period', [pay[0].hours, pay[0].regular, pay[0].overtime, pay[0].days.length], [77, 72, 5, 9]);
eq('…and every 9-hour day with no lunch is flagged', pay[0].warnings, 9);
eq('Robin: the open day is flagged and pays nothing; Saturday counts', [pay[1].days.map(d => `${d.date}:${d.hours}:${d.warnings.join('/')}`), pay[1].hours], [['2026-10-12:7.5:', '2026-10-13:0:No clock-out', '2026-10-17:4:'], 11.5]);

// sums are to the minute — two days of 9 h 05 min are 18.17 h, not 2 × 9.08
const odd = payrollOf({ punches: [p('Pat', 'in', at(10, 13, 6, 55)), p('Pat', 'out', at(10, 13, 16)), p('Pat', 'in', at(10, 14, 6, 55)), p('Pat', 'out', at(10, 14, 16))], period: payPeriodOf('2026-10-14'), todayKey: '2026-10-20' });
eq('a week is summed to the minute, then rounded once', [odd[0].days.map(d => d.hours), odd[0].weeks[0].hours], [[9.08, 9.08], 18.17]);

// ── Floor Metrics reads the app's clock ───────────────────────────────────────────────────────────────────
const byPerson = clockDaysByPersonOf([...day('Pat', 10, 13, 7, 15, true), p('Pat', 'in', at(10, 14, 7))], { todayKey: '2026-10-14' });
const d13 = byPerson.get('pat').get('2026-10-13');
eq('a worked day, in the shape Floor Metrics reads', [d13.inMs, d13.outMs, d13.totalHours, clockedMinsOf(d13), breakMinsOf(d13)], [at(10, 13, 7), at(10, 13, 15), 7.5, 480, 30]);
eq('today, still clocked in: in, no out yet', [byPerson.get('pat').get('2026-10-14').inMs, byPerson.get('pat').get('2026-10-14').outMs], [at(10, 14, 7), null]);

console.log(`timeClock: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
