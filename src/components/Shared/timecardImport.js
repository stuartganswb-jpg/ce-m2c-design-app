// ── THE TIME CLOCK'S EXPORT, READ (Stuart 2026-10-14) ───────────────────────────────────────────────────────
// "in meantime let's build it with the history you have over the past few weeks … will drop in the October26
// subfolder the timecards for the past two pay periods". The time clock exports one row per person per day:
//   Employee Name ("Last, First") · Employee Number · Date · Total / Regular / Overtime 1-3 Hours · Vacation …
//   · First Punch In · Last Punch Out · Tip / Bonus / Commission · Mileage
// — no lunch punches. HQ → System Admin → Floor Metrics reads the file in the browser; it is NEVER stored
// (payroll hours are admin-only — Stuart 2026-10-13), and nothing here writes anywhere.
//
// Pure — no React, no Firestore. Harness: scripts/floorMetrics.test.mjs.

const MIN = 60000;
const pad = (n) => String(n).padStart(2, '0');
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : 0; };

/** A local calendar day, 'YYYY-MM-DD'. Every day in the metrics is a LOCAL day — the floor's day. */
export const dateKeyOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const dayStartMs = (key) => { const [y, m, d] = String(key).split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
export const addDays = (key, n) => { const [y, m, d] = String(key).split('-').map(Number); return dateKeyOf(new Date(y, m - 1, d + n).getTime()); };
/** The Monday that starts the week a day falls in (weeks run Monday → Sunday, as the pay periods do). */
export const weekKeyOf = (key) => { const [y, m, d] = String(key).split('-').map(Number); const dow = new Date(y, m - 1, d).getDay(); return addDays(key, dow === 0 ? -6 : 1 - dow); };
export const dayStartOf = dayStartMs;

/** RFC-4180-ish: quoted fields, doubled quotes, commas and line breaks inside quotes, CRLF. */
export function parseCsv(text) {
    const rows = []; let row = []; let f = ''; let q = false;
    const s = String(text || '').replace(/^﻿/, '');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) {
            if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
            else f += c;
        } else if (c === '"') q = true;
        else if (c === ',') { row.push(f); f = ''; }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(f); rows.push(row); row = []; f = '';
        } else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
}

// "9/29/2026" → '2026-09-29' · "9/29/2026 8:52:00 AM" → local ms. Anything else → null.
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/;
export function usDateKeyOf(s) {
    const m = String(s || '').trim().match(US_DATE);
    return m ? `${m[3]}-${pad(m[1])}-${pad(m[2])}` : null;
}
export function usDateTimeMsOf(s) {
    const m = String(s || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
    if (!m) return null;
    let h = Number(m[4]) % 24;
    const ap = (m[7] || '').toUpperCase();
    if (ap === 'PM' && h < 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6] || 0)).getTime();
}

/** "Thompson, Grace" → "Grace Thompson"; a name without a comma is kept as written. */
export const displayNameOf = (raw) => {
    const s = String(raw || '').trim();
    const i = s.indexOf(',');
    return i < 0 ? s : `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`.trim();
};

const COLS = {
    name: 'employee name', number: 'employee number', date: 'date', total: 'total hours', regular: 'regular hours',
    ot1: 'overtime 1 hours', ot2: 'overtime 2 hours', ot3: 'overtime 3 hours',
    vacation: 'vacation hours', holiday: 'holiday hours', sick: 'sick hours', personal: 'personal hours',
    in: 'first punch in', out: 'last punch out',
};

/**
 * One time-clock export → its days.
 * @returns [{ employee, name, number, date, totalHours, regularHours, otHours, leaveHours, inMs, outMs }]
 * @throws  when the file is not a time-clock export (the columns the metrics need are missing)
 */
export function timecardDaysOf(text) {
    const rows = parseCsv(text);
    if (!rows.length) return [];
    const head = rows[0].map(h => String(h).trim().toLowerCase());
    const at = {}; Object.entries(COLS).forEach(([k, label]) => { at[k] = head.indexOf(label); });
    const missing = ['name', 'date', 'total'].filter(k => at[k] < 0).map(k => COLS[k]);
    if (missing.length) throw new Error(`Not a time clock export — no ${missing.join(', ')} column.`);
    const cell = (r, k) => (at[k] >= 0 ? String(r[at[k]] == null ? '' : r[at[k]]).trim() : '');
    return rows.slice(1).map(r => {
        const date = usDateKeyOf(cell(r, 'date'));
        if (!date || !cell(r, 'name')) return null;
        const inMs = usDateTimeMsOf(cell(r, 'in'));
        const outMs = usDateTimeMsOf(cell(r, 'out'));
        return {
            employee: cell(r, 'name'), name: displayNameOf(cell(r, 'name')), number: cell(r, 'number'), date,
            totalHours: num(cell(r, 'total')), regularHours: num(cell(r, 'regular')),
            otHours: num(cell(r, 'ot1')) + num(cell(r, 'ot2')) + num(cell(r, 'ot3')),
            leaveHours: num(cell(r, 'vacation')) + num(cell(r, 'holiday')) + num(cell(r, 'sick')) + num(cell(r, 'personal')),
            inMs, outMs: (inMs && outMs && outMs > inMs) ? outMs : null,
        };
    }).filter(Boolean);
}

/** Several exports (two pay periods, a re-export) → one list: one row per person per day, the later file wins. */
export function mergeTimecardDays(...lists) {
    const by = new Map();
    lists.flat().filter(Boolean).forEach(d => by.set(`${d.number || d.employee}|${d.date}`, d));
    return [...by.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
}

/** The people on the cards: [{ number, name, employee, days }] — what the name map offers. */
export function timecardPeopleOf(days = []) {
    const by = new Map();
    days.forEach(d => {
        const k = d.number || d.employee;
        const p = by.get(k) || { number: d.number, name: d.name, employee: d.employee, days: 0 };
        p.days += 1; by.set(k, p);
    });
    return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Minutes on the clock that day (first punch in → last punch out); null when a punch is missing. */
export const clockedMinsOf = (day) => (day && day.inMs && day.outMs ? (day.outMs - day.inMs) / MIN : null);

/**
 * The unpaid break inside the day: the span from first punch in to last punch out, less the hours paid.
 * The export shows only the first and last punch, but the clock deducts lunch — on the 2026-09-14 → 10-09
 * cards 259 of 430 days paid 21-35 minutes less than their span. 0 when the day paid its whole span.
 */
export const breakMinsOf = (day) => {
    const span = clockedMinsOf(day);
    return span == null ? 0 : Math.max(0, Math.round(span - num(day.totalHours) * 60));
};
