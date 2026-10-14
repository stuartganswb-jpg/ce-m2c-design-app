// ── THE TIME CLOCK (Stuart 2026-10-13 / 10-14, phase 4 of the metrics work) ────────────────────────────────────
// "we will add a clock in, need to track clock in, lunch out, lunch in, end of day out. need to have hours listed to an
// excel sheet on HQ (admin only), we catch payroll 2 weeks pay period. need to break out any hours over 40 per week.
// then first pin on floor since clock in." · "this Monday the 12th started a new pay period, it runs thru 23rd" ·
// "Lunch we need ability to make corrections warnings should appear for missed punches that need correcting" ·
// "yes it will be — we will need to set a conversion date" (the app's clock replaces the current one from that date).
//
// A PUNCH (time_punches — admin-read only; Firestore rules):
//   { name, kind: in | lunchOut | lunchIn | out, t (server time), at (device time), source: 'clock' | 'admin',
//     by?, reason?, void?, voidBy?, voidReason?, voidAt? }
// A person punches their own (the name on their PIN token, the server's time). An admin corrects: never an edit, never
// a delete — a missing punch is ADDED (source 'admin', with who and why) and a wrong one is VOIDED (who, why). The raw
// punches stay, so every correction can be seen.
// A person's STATE (time_status/<key> — read by that person or an admin): { name, state: in | lunch | out, kind, at }.
//
// Pure — no React, no Firestore. Harness: scripts/timeClock.test.mjs.

import { dateKeyOf, addDays, weekKeyOf, dayStartOf } from './timecardImport.js';

const MIN = 60000;
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const msOf = (t) => (!t ? 0 : typeof t === 'number' ? t : typeof t.toMillis === 'function' ? t.toMillis() : (t.seconds != null ? t.seconds * 1000 : 0));
const clean = (s) => String(s == null ? '' : s).trim();

export const PUNCH = { IN: 'in', LUNCH_OUT: 'lunchOut', LUNCH_IN: 'lunchIn', OUT: 'out' };
export const PUNCH_LABEL = {
    in: { en: 'Clock in', es: 'Entrada' },
    lunchOut: { en: 'Lunch out', es: 'Salida a comer' },
    lunchIn: { en: 'Lunch in', es: 'Regreso de comer' },
    out: { en: 'Clock out', es: 'Salida' },
};
export const STATE = { IN: 'in', LUNCH: 'lunch', OUT: 'out' };
/** Where each punch leaves a person. */
const STATE_AFTER = { in: STATE.IN, lunchOut: STATE.LUNCH, lunchIn: STATE.IN, out: STATE.OUT };
/** The punches that make sense from each state — the kiosk offers these first. */
const NEXT = { out: [PUNCH.IN], in: [PUNCH.LUNCH_OUT, PUNCH.OUT], lunch: [PUNCH.LUNCH_IN] };

/** A person's key on the clock — Firestore-safe ("Sandra G" → "sandra_g"). The security rules build the same key from the
 *  name on the PIN token (firestore.rules clockKey: trim · lower · non-alphanumerics → "_") — keep the two identical. */
export const clockKeyOf = (name) => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '_');

// ── pay periods ───────────────────────────────────────────────────────────────────────────────────────────
/** Two weeks, Monday to Sunday, counted from Monday 2026-10-12 ("this Monday the 12th started a new pay period"). */
export const PAY_PERIOD_ANCHOR = '2026-10-12';
export const PAY_PERIOD_DAYS = 14;
/** OT is hours over this in a week (Monday → Sunday). */
export const WEEK_REGULAR_HOURS = 40;
/** A day worked longer than this with no lunch punched is flagged. */
export const LUNCH_EXPECTED_AFTER_HOURS = 6;

const daysBetween = (a, b) => Math.round((dayStartOf(b) - dayStartOf(a)) / (24 * 60 * MIN));
/** The pay period a day falls in → { start, end } ('YYYY-MM-DD', end inclusive). */
export function payPeriodOf(dateKey) {
    const n = Math.floor(daysBetween(PAY_PERIOD_ANCHOR, dateKey) / PAY_PERIOD_DAYS);
    const start = addDays(PAY_PERIOD_ANCHOR, n * PAY_PERIOD_DAYS);
    return { start, end: addDays(start, PAY_PERIOD_DAYS - 1) };
}
/** The period `offset` periods from the one a day falls in (−1 = the last one). */
export const payPeriodFrom = (dateKey, offset = 0) => payPeriodOf(addDays(payPeriodOf(dateKey).start, offset * PAY_PERIOD_DAYS));

// ── the kiosk ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * What the kiosk offers someone, from their state.
 * @returns { state, expected: [kinds], stale: null | { day, kind, at } }   stale = a day left open (no clock-out)
 */
export function clockOfferOf(status, nowMs = Date.now()) {
    const state = (status && STATE_AFTER[status.kind]) || STATE.OUT;
    const at = msOf(status && status.at);
    const stale = state !== STATE.OUT && at && dateKeyOf(at) < dateKeyOf(nowMs) ? { day: dateKeyOf(at), kind: status.kind, at } : null;
    // a day left open is over: the next punch starts a new one
    return { state: stale ? STATE.OUT : state, expected: NEXT[stale ? STATE.OUT : state], stale };
}
/** A punch out of its order → the words to say before it is made (it is still allowed — a wrong punch gets corrected). */
export function punchOrderWarning(status, kind, nowMs = Date.now()) {
    const { state, expected, stale } = clockOfferOf(status, nowMs);
    const lines = [];
    if (stale) lines.push(`Your last punch was ${PUNCH_LABEL[stale.kind].en} on ${stale.day} — that day has no clock-out. Your manager will correct it.\nSu último registro fue ${PUNCH_LABEL[stale.kind].es} el ${stale.day} — ese día no tiene salida. Su gerente lo corregirá.`);
    if (!expected.includes(kind)) {
        const now = { in: 'clocked in', lunch: 'out to lunch', out: 'clocked out' }[state];
        const nowEs = { in: 'con entrada', lunch: 'en la comida', out: 'con salida' }[state];
        lines.push(`You are ${now} — ${PUNCH_LABEL[kind].en} does not follow. Expected: ${expected.map(k => PUNCH_LABEL[k].en).join(' or ')}.\nUsted está ${nowEs} — ${PUNCH_LABEL[kind].es} no corresponde. Se espera: ${expected.map(k => PUNCH_LABEL[k].es).join(' o ')}.`);
    }
    return lines.length ? lines.join('\n\n') : null;
}
/** The punch a person writes at the kiosk. `t` is the server's time, set by the caller (serverTimestamp). */
export const punchRecordOf = ({ name, kind, nowMs, device = '' }) => ({ name: clean(name), kind, at: nowMs, source: 'clock', device: clean(device) });
/** The person's state after a punch. */
export const statusAfterOf = ({ name, kind, nowMs }) => ({ name: clean(name), kind, state: STATE_AFTER[kind], at: nowMs });

// ── a person's day ────────────────────────────────────────────────────────────────────────────────────────
/** When a punch happened: the server's time for a clock punch, the time the admin entered for a correction. */
export const punchTimeOf = (p) => (p && p.source === 'admin' ? N(p.at) : (msOf(p && p.t) || N(p && p.at)));
const live = (p) => p && !p.void && PUNCH_LABEL[p.kind];

export const WARN = {
    NO_OUT: 'No clock-out', NO_IN: 'No clock-in', NO_LUNCH_IN: 'No lunch-in', NO_LUNCH_OUT: 'No lunch-out',
    DOUBLE_IN: 'Clocked in twice', NO_LUNCH: 'No lunch punched',
};
/**
 * One person's day from their punches → hours and what is missing.
 * @param isToday  a day still going is not missing its clock-out yet
 * @returns { date, punches, inMs, outMs, workedMins, lunchMins, warnings: [WARN…], open }
 */
export function dayOfPunches(punches = [], { isToday = false } = {}) {
    const ps = punches.filter(live).map(p => ({ ...p, ms: punchTimeOf(p) })).filter(p => p.ms).sort((a, b) => a.ms - b.ms);
    const warnings = [];
    let open = null, lunchFrom = null, worked = 0, lunch = 0, firstIn = null, lastOut = null;
    const warn = (w) => { if (!warnings.includes(w)) warnings.push(w); };
    ps.forEach(p => {
        if (p.kind === PUNCH.IN) {
            if (open != null) warn(WARN.DOUBLE_IN); else open = p.ms;
            if (firstIn == null) firstIn = p.ms;
        } else if (p.kind === PUNCH.LUNCH_OUT) {
            if (open == null) warn(WARN.NO_IN); else { worked += p.ms - open; open = null; }
            lunchFrom = p.ms;
        } else if (p.kind === PUNCH.LUNCH_IN) {
            if (lunchFrom == null) warn(WARN.NO_LUNCH_OUT); else { lunch += p.ms - lunchFrom; lunchFrom = null; }
            if (open == null) open = p.ms;
        } else if (p.kind === PUNCH.OUT) {
            // out to lunch and clocked out without a lunch-in: the lunch-in is what is missing (the time after it is not paid
            // until it is corrected) — not a clock-in
            const missedLunchIn = lunchFrom != null;
            if (missedLunchIn) { warn(WARN.NO_LUNCH_IN); lunchFrom = null; }
            if (open == null) { if (!missedLunchIn) warn(WARN.NO_IN); } else { worked += p.ms - open; open = null; }
            lastOut = p.ms;
        }
    });
    if (!isToday) {
        if (lunchFrom != null) warn(WARN.NO_LUNCH_IN);
        if (open != null) warn(WARN.NO_OUT);
    }
    const hadLunch = ps.some(p => p.kind === PUNCH.LUNCH_OUT || p.kind === PUNCH.LUNCH_IN);
    if (!hadLunch && !isToday && worked / 60 / MIN > LUNCH_EXPECTED_AFTER_HOURS) warn(WARN.NO_LUNCH);
    return {
        date: ps.length ? dateKeyOf(ps[0].ms) : '', punches: ps, inMs: firstIn, outMs: lastOut,
        workedMins: worked / MIN, lunchMins: lunch / MIN, warnings, open: open != null || lunchFrom != null,
    };
}

// ── payroll ───────────────────────────────────────────────────────────────────────────────────────────────
const r2 = (h) => Math.round(h * 100) / 100;
/**
 * The pay period, person by person: every day, each week's regular hours and hours over 40, the period's totals.
 * Hours are exact to the minute — no rounding (none was asked for).
 * @param punches     every punch in (or around) the period
 * @param period      { start, end }
 * @param numberOf    name → employee number (Floor Metrics' name map), '' when unknown
 * @param todayKey    the day that is still going
 * @returns [{ name, number, days: [{ date, inMs, outMs, hours, lunchMins, warnings, punches }], weeks: [{ week, hours, regular, overtime }], hours, regular, overtime, warnings }]
 */
export function payrollOf({ punches = [], period, numberOf = () => '', todayKey = '' } = {}) {
    const inPeriod = (k) => k >= period.start && k <= period.end;
    const byPerson = new Map();
    punches.forEach(p => {
        const ms = punchTimeOf(p); const name = clean(p && p.name);
        if (!ms || !name) return;
        const date = dateKeyOf(ms);
        if (!inPeriod(date)) return;
        const k = clockKeyOf(name);
        if (!byPerson.has(k)) byPerson.set(k, { name, days: new Map() });
        const person = byPerson.get(k);
        if (!person.days.has(date)) person.days.set(date, []);
        person.days.get(date).push(p);
    });
    return [...byPerson.values()].map(({ name, days }) => {
        const dayRows = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, ps]) => {
            const d = dayOfPunches(ps, { isToday: date === todayKey });
            return { date, inMs: d.inMs, outMs: d.outMs, exactHours: d.workedMins / 60, hours: r2(d.workedMins / 60), lunchMins: Math.round(d.lunchMins), warnings: d.warnings, punches: ps };
        });
        const weekKeys = [period.start, addDays(period.start, 7)];
        const weeks = weekKeys.map(week => {
            // summed to the minute, rounded once — never a sum of rounded days
            const hours = r2(dayRows.filter(d => weekKeyOf(d.date) === week).reduce((t, d) => t + d.exactHours, 0));
            return { week, hours, regular: r2(Math.min(WEEK_REGULAR_HOURS, hours)), overtime: r2(Math.max(0, hours - WEEK_REGULAR_HOURS)) };
        });
        const sum = (k) => r2(weeks.reduce((t, w) => t + w[k], 0));
        return {
            name, number: clean(numberOf(name)), days: dayRows, weeks,
            hours: sum('hours'), regular: sum('regular'), overtime: sum('overtime'),
            warnings: dayRows.reduce((t, d) => t + d.warnings.length, 0),
        };
    }).sort((a, b) => a.name.localeCompare(b.name));
}

/** A correction: a missing punch added by an admin, with who and why. `t` is set by the caller (serverTimestamp). */
export const correctionOf = ({ name, kind, atMs, by, reason }) => ({ name: clean(name), kind, at: atMs, source: 'admin', by: clean(by), reason: clean(reason) });
/** Voiding a wrong punch — the punch stays, marked. */
export const voidPatchOf = ({ by, reason, nowMs }) => ({ void: true, voidBy: clean(by), voidReason: clean(reason), voidAt: nowMs });

// ── Floor Metrics ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * The app's clock as the time-clock days Floor Metrics reads (Shared/floorMetrics.clockIndexOf's shape), by person:
 * personKey (lower-case name) → (date → { date, inMs, outMs, totalHours }). The lunch reads as the span less the
 * hours worked, as the time clock's export does (Shared/timecardImport.breakMinsOf).
 */
export function clockDaysByPersonOf(punches = [], { todayKey = '' } = {}) {
    const by = new Map();
    punches.forEach(p => {
        const ms = punchTimeOf(p); const name = clean(p && p.name);
        if (!ms || !name || !live(p)) return;
        const pk = name.toLowerCase().replace(/\s+/g, ' ');
        const date = dateKeyOf(ms);
        if (!by.has(pk)) by.set(pk, new Map());
        if (!by.get(pk).has(date)) by.get(pk).set(date, []);
        by.get(pk).get(date).push(p);
    });
    const out = new Map();
    by.forEach((days, pk) => {
        const m = new Map();
        days.forEach((ps, date) => {
            const d = dayOfPunches(ps, { isToday: date === todayKey });
            if (!d.inMs) return;
            m.set(date, { date, inMs: d.inMs, outMs: d.outMs || null, totalHours: d.workedMins / 60, source: 'app' });
        });
        if (m.size) out.set(pk, m);
    });
    return out;
}
