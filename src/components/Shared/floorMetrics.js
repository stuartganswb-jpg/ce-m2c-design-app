// ── HOW THE FLOOR WORKS, PERSON BY PERSON, WEEK BY WEEK (Stuart 2026-10-13 / 10-14) ─────────────────────────
// "create a system to watch what time the painters start, when they touch first item, how long they actually
// take on each step, how quickly they start the next order, how close to on time it takes, how steady they
// work throughout the day … a hall of fame and hall of shame and show whom is doing good so they can be
// rewarded and whom is dragging the team down." Weekly, names named, finishing AND pick / pack; on time is
// BOTH the step against its standard and the order against its due date; "when their job / step is in the
// oven / bake they are free" — the product shows in the oven, the operator shows free.
//
// Built first from the history the app already keeps (phase 1 — HQ → System Admin → Floor Metrics):
//   · the finishing floor's punches (fin_logs): START / COMPLETE with the step's start time and elapsed time;
//   · the apps' logs (hq_logs): every WMS action (picked, put away, received, moved, counted …), the Setup
//     Queue's actions;
//   · the pick and pack stamps on each finishing document (pickedAt / pickedBy, packedAt / packedBy);
//   · the time clock's export (Shared/timecardImport) — clock-in and clock-out per person per day.
// What the history CANNOT say, said plainly where it shows: the machine cards' Start / Complete are not
// logged (only the PIN'd Manual Control is); the WMS keeps when work FINISHED, not when it began, so pickers
// and packers are measured by their actions across the day, not per pick; no lunch punches yet, so lunch
// reads as idle; no chores yet, so oven time is shown as free and never scored.
//
// The step standards are the floor's own (Shared/punchCheck.normalMinutesOf, the "Est Time" its cards print),
// and a punch is REAL when it ran at least what the floor's punch check accepts (a quarter of normal, never
// under a minute) — the same line that raises the punch warning on the floor.
//
// Pure — no React, no Firestore. Harness: scripts/floorMetrics.test.mjs.

import { normalMinutesOf, minHonestMinutes } from './punchCheck.js';
import { runsInLoads, spinLoadsOf } from './spinLoads.js';
import { sprayStationOf, SPRAY_STATIONS, BOOTH_COAT_MINS, BOOTH_LOAD_PCS } from './floorActivity.js';
import { dateKeyOf, weekKeyOf, addDays, clockedMinsOf, breakMinsOf } from './timecardImport.js';
import { woRefOf } from './woRef.js';

const MIN = 60000;
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const median = (xs) => { const a = xs.filter(x => Number.isFinite(x)).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Firestore Timestamp | ms | ISO string → ms (0 when absent). */
export const msOf = (t) => {
    if (!t) return 0;
    if (typeof t === 'number') return t;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (t.seconds != null) return t.seconds * 1000 + Math.round(N(t.nanoseconds) / 1e6);
    if (typeof t === 'string') return Date.parse(t) || 0;
    return 0;
};

// ── the steps ─────────────────────────────────────────────────────────────────────────────────────────────
/** Steps a person does with their hands. */
export const PERSON_STEPS = ['spinSetup', 'spinSpray', 'poleSpray', 'hand', 'poleHand'];
/** Steps the oven does — the product is in the oven, the operator is free. */
export const OVEN_STEPS = ['spinBake', 'poleBake'];
/** A step that ran past three times its standard (and an hour over it) was left running — not timed work. */
export const OVERRUN_FACTOR = 3;
export const OVERRUN_EXTRA_MINS = 60;
/** A START log and the start time its COMPLETE carries are the same punch when this close. */
const STARTER_MATCH_MS = 15000;

// The floor's timers. The same figures and the same fall-backs the Active Floor's cards use (ActiveFloor `cfg`):
// fin_config/settings where set, these where not.
export const FLOOR_TIMER_DEFAULTS = { spinSetupMins: 10, spinPaintMins: 3, ovenMins: 10, handSmallMins: 1.35, handPoleMins: 10, poleMins: 5, boothCoatMins: BOOTH_COAT_MINS, boothLoadPcs: BOOTH_LOAD_PCS };
export const floorTimersOf = (settings) => {
    const s = settings || {}; const out = {};
    Object.keys(FLOOR_TIMER_DEFAULTS).forEach(k => { out[k] = N(s[k]) || FLOOR_TIMER_DEFAULTS[k]; });
    return out;
};

// A hand coat on a spin job that runs in LOADS (Shared/spinLoads) is done one load at a time — its standard is
// that load's pieces, not the whole order's. The load a step belongs to is the first one finished after it.
const handPiecesAt = (wo, atMs) => {
    if (!wo || !runsInLoads(wo)) return null;
    const loads = (Array.isArray(wo.spinLoads) ? wo.spinLoads : []).filter(Boolean);
    if (!loads.length && !(N(wo.spinLoadQty) > 0)) return null;
    const hit = loads.slice().sort((a, b) => N(a.doneAt) - N(b.doneAt)).find(l => N(l.doneAt) >= atMs);
    return hit ? N(hit.qty) : (spinLoadsOf(wo).qty || null);
};
/** The minutes this step should take — the floor's own standard (0 when the floor has none). */
export function standardMinsOf(task, wo, timers = FLOOR_TIMER_DEFAULTS, atMs = 0) {
    if (task === 'hand') { const pcs = handPiecesAt(wo, atMs); if (pcs) return pcs * N(timers.handSmallMins); }
    return normalMinutesOf(task, wo || {}, timers);
}

// ── people ────────────────────────────────────────────────────────────────────────────────────────────────
const NOBODY = new Set(['', '?', 'floor', 'tablet', 'manual', 'unattributed', 'unknown', 'packer', 'system', 'split (pick only)', 'row (pick only)']);
/** One person, however their name was typed ("stuart" and "Stuart" are one key). */
export const personKeyOf = (name) => String(name == null ? '' : name).trim().toLowerCase().replace(/\s+/g, ' ');
const isPerson = (name) => !NOBODY.has(personKeyOf(name));
/** A real person's name — not "Tablet", "Floor", "Packer", "Unattributed" or blank. */
export const isPersonName = isPerson;

// The two boards a person is ranked on. BOTH is a person on each (Stuart 2026-10-14: "Sandra G needs to be on both as
// she is charge of set up and organizing / scheduling the paint jobs (which goes to which station)") — a row on each
// board, each read the way that board reads.
export const GROUP = { FINISHING: 'finishing', WMS: 'wms', BOTH: 'both', NONE: 'none' };
export const GROUP_LABEL = { finishing: 'Finishing floor', wms: 'Pick / pack (WMS)', both: 'Both boards', none: 'Not ranked' };
const FINISHING_ROLES = new Set(['painter', 'hand_painter', 'paint_manager', 'floor_manager']);
const WMS_ROLES = new Set(['setup', 'packaging']);
const BOTH_ROLES = new Set(['setup_manager']);
/** Which board(s) a role is ranked on. Office, shop and admin roles are not ranked; Floor Metrics can move anyone. */
export const boardOfRole = (role) => {
    const r = personKeyOf(role);
    return FINISHING_ROLES.has(r) ? GROUP.FINISHING : WMS_ROLES.has(r) ? GROUP.WMS : BOTH_ROLES.has(r) ? GROUP.BOTH : GROUP.NONE;
};
/** A board setting → the boards ranked on. */
export const boardsOf = (board) => (board === GROUP.BOTH ? [GROUP.FINISHING, GROUP.WMS]
    : [GROUP.FINISHING, GROUP.WMS].includes(board) ? [board] : [GROUP.NONE]);

// ── the floor's steps, timed ───────────────────────────────────────────────────────────────────────────────
/**
 * Every timed step completion → who did it, when, how long, against what standard.
 * The person is whoever STARTED it (their PIN on the START punch); the completer when no start punch matches.
 * A completion the floor did not time (no start, no elapsed) is left out — it has no length to measure.
 * @returns [{ who, completedBy, woId, task, person, oven, startMs, endMs, ranMins, normalMins, short, overrun }]
 */
export function floorStepsOf({ finLogs = [], wosById = {}, timers = FLOOR_TIMER_DEFAULTS } = {}) {
    const starts = new Map();
    finLogs.forEach(l => {
        if (!l || l.action !== 'START' || !isPerson(l.u)) return;
        const k = `${l.woId}|${l.task}`;
        if (!starts.has(k)) starts.set(k, []);
        starts.get(k).push({ at: N(l.at), u: String(l.u).trim() });
    });
    const starterOf = (woId, task, startMs) => {
        const hit = (starts.get(`${woId}|${task}`) || []).find(s => Math.abs(s.at - startMs) <= STARTER_MATCH_MS);
        return hit ? hit.u : '';
    };
    const seen = new Set(); const out = [];
    finLogs.forEach(l => {
        if (!l || l.action !== 'COMPLETE') return;
        const task = String(l.task || '');
        const person = PERSON_STEPS.includes(task), oven = OVEN_STEPS.includes(task);
        if (!person && !oven) return;
        const endMs = N(l.at), startMs = N(l.startedAtMs), elapsedMs = N(l.elapsedMs);
        if (!endMs || !startMs || elapsedMs <= 0) return;
        const key = `${l.woId}|${task}|${startMs}`;
        if (seen.has(key)) return;
        seen.add(key);
        const completedBy = isPerson(l.u) ? String(l.u).trim() : '';
        const who = starterOf(l.woId, task, startMs) || completedBy;
        if (!who) return;
        const normalMins = standardMinsOf(task, wosById[l.woId] || null, timers, endMs);
        const ranMins = elapsedMs / MIN;
        out.push({
            who, completedBy, woId: String(l.woId || ''), task, person, oven, startMs, endMs, ranMins, normalMins,
            short: ranMins < minHonestMinutes(normalMins),
            overrun: normalMins > 0 && ranMins > Math.max(normalMins * OVERRUN_FACTOR, normalMins + OVERRUN_EXTRA_MINS),
        });
    });
    return out.sort((a, b) => a.startMs - b.startMs);
}

// ── everything a person touched ────────────────────────────────────────────────────────────────────────────
export const WMS_KIND = { PICK: 'pick', PACK: 'pack', STAGE: 'stage', PUTAWAY: 'putaway', RECEIVE: 'receive', MOVE: 'move', COUNT: 'count', LABEL: 'label', OTHER: 'other' };
const WMS_CATS = new Set(['wms', 'packing', 'fulfilment']);
/** A WMS action in hq_logs: stamped src WMS (since 2026-10-03), or one of the WMS's own categories before that. */
export const isWmsLog = (l) => !!l && (l.src === 'WMS' || WMS_CATS.has(String(l.cat || '').toLowerCase()));
/** What kind of WMS action a log line records, read from the words the WMS writes. */
export function wmsKindOf(msg) {
    const m = String(msg || '');
    if (/^Order Picked\b/i.test(m)) return WMS_KIND.PICK;
    if (/^Packed\b/i.test(m)) return WMS_KIND.PACK;
    if (/^Order Staged/i.test(m)) return WMS_KIND.STAGE;
    if (/put[- ]away/i.test(m)) return WMS_KIND.PUTAWAY;
    if (/^(Receiving|Plating receive)/i.test(m)) return WMS_KIND.RECEIVE;
    if (/^Count push/i.test(m)) return WMS_KIND.COUNT;
    if (/label/i.test(m)) return WMS_KIND.LABEL;
    if (/^(Bin Transfer|Plating pull|Ring Pack|Cut |Committed|Assembly Build)|pull: /i.test(m)) return WMS_KIND.MOVE;
    return WMS_KIND.OTHER;
}
const refOfWmsMsg = (msg, kind) => {
    const m = String(msg || '');
    if (kind === WMS_KIND.PICK || kind === WMS_KIND.STAGE) return (m.match(/:\s*(\S+)/) || [])[1] || '';
    if (kind === WMS_KIND.PACK) return (m.match(/^Packed\s+(\S+)/i) || [])[1] || '';
    return '';
};
// Where an action happened: the finishing floor's punches · the floor's other screens (the Setup Queue) · the
// WMS · anything else in the apps.
export const SRC = { FLOOR: 'floor', FLOOR_APP: 'floor-app', WMS: 'wms', APP: 'app' };
// Before 2026-10-03 the floor's log lines carried no src; its categories say whose they are (the shop has stamped its
// own src SHOP since 2026-08-26, the WMS its categories above, HQ writes no cat at all).
const FLOOR_APP_CATS = new Set(['setup', 'production', 'recipes', 'inventory']);
const hqSrcOf = (l) => isWmsLog(l) ? SRC.WMS
    : (l.src === 'FINISHING' || (!l.src && FLOOR_APP_CATS.has(String(l.cat || '').toLowerCase()))) ? SRC.FLOOR_APP : SRC.APP;
/** The Setup Queue's two log lines that name an order: "Started Setup for <ref> …" and "Staged <ref> to Floor …". */
export const SETUP_KIND = { SETUP: 'setup', STAGED: 'staged' };
const floorAppOf = (msg) => {
    const m = String(msg || '');
    const a = m.match(/^Started Setup for (\S+)/); if (a) return { kind: SETUP_KIND.SETUP, ref: a[1] };
    const b = m.match(/^Staged (\S+) to Floor/); if (b) return { kind: SETUP_KIND.STAGED, ref: b[1] };
    return { kind: 'app', ref: '' };
};

/** Every action by a person, in time order: [{ who, at, src, kind, ref }]. */
export function activityOf({ finLogs = [], hqLogs = [], wos = [] } = {}) {
    const ev = [];
    finLogs.forEach(l => {
        if (!l || !isPerson(l.u) || !N(l.at) || l.action === 'PUNCH_WARNING') return;   // a warning repeats its completion
        ev.push({ who: String(l.u).trim(), at: N(l.at), src: SRC.FLOOR, kind: String(l.action || 'floor').toLowerCase(), ref: String(l.woId || '') });
    });
    hqLogs.forEach(l => {
        const at = msOf(l && l.t);
        if (!at || !isPerson(l.u)) return;
        const src = hqSrcOf(l);
        if (src === SRC.WMS) { const kind = wmsKindOf(l.msg); ev.push({ who: String(l.u).trim(), at, src, kind, ref: refOfWmsMsg(l.msg, kind) }); return; }
        const fa = src === SRC.FLOOR_APP ? floorAppOf(l.msg) : { kind: 'app', ref: '' };
        ev.push({ who: String(l.u).trim(), at, src, kind: fa.kind, ref: fa.ref });
    });
    wos.forEach(w => {
        if (!w) return;
        const pa = msOf(w.pickedAt), ka = msOf(w.packedAt);
        if (pa && isPerson(w.pickedBy)) ev.push({ who: String(w.pickedBy).trim(), at: pa, src: SRC.WMS, kind: WMS_KIND.PICK, ref: String(w.id || '') });
        if (ka && isPerson(w.packedBy)) ev.push({ who: String(w.packedBy).trim(), at: ka, src: SRC.WMS, kind: WMS_KIND.PACK, ref: String(w.id || '') });
    });
    return ev.sort((a, b) => a.at - b.at);
}

// ── the clock ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The time clock, by app person: personKey → (date → timecard day). `nameMap` is { personKey: employeeNumber }
 * — set in Floor Metrics, because the app's names ("Sandra G") are not the clock's ("George, Sandra").
 */
export function clockIndexOf(timecardDays = [], nameMap = {}) {
    const byNumber = new Map();
    timecardDays.forEach(d => { const k = String(d.number || ''); if (!k) return; if (!byNumber.has(k)) byNumber.set(k, new Map()); byNumber.get(k).set(d.date, d); });
    const out = new Map();
    Object.entries(nameMap || {}).forEach(([pk, no]) => { const days = byNumber.get(String(no || '')); if (days) out.set(personKeyOf(pk), days); });
    return out;
}

// ── a person's day ────────────────────────────────────────────────────────────────────────────────────────
/** Half-hours: a stretch of the clocked day is WORKING when anything was done in it, or a step or a chore was running. */
export const SLOT_MINS = 30;
/** The first day the floor could punch a chore (Shared/floorChores, shipped 2026-10-14 afternoon) — from then on, oven time
 *  with nothing else done is idle; before it there was nothing to punch, so it is shown as oven-free and never scored. */
export const CHORES_FROM = '2026-10-15';
/** A gap to the next order longer than this is not "between orders" (lunch, a meeting, another job). */
export const NEXT_ORDER_MAX_MINS = 240;

const unionOf = (ivs) => {
    const a = ivs.filter(([s, e]) => e > s).sort((p, q) => p[0] - q[0]); const out = [];
    a.forEach(([s, e]) => { const last = out[out.length - 1]; if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]); });
    return out;
};
const clipTo = (ivs, win) => (win ? ivs.map(([s, e]) => [Math.max(s, win[0]), Math.min(e, win[1])]).filter(([s, e]) => e > s) : ivs);
const minus = (ivs, cut) => {
    let out = ivs.map(x => x.slice());
    cut.forEach(([cs, ce]) => { out = out.flatMap(([s, e]) => (ce <= s || cs >= e) ? [[s, e]] : [[s, Math.min(e, cs)], [Math.max(s, ce), e]].filter(([a, b]) => b > a)); });
    return out;
};
const minsOf = (ivs) => ivs.reduce((t, [s, e]) => t + (e - s), 0) / MIN;

// The day's unpaid break (lunch — Shared/timecardImport.breakMinsOf) is taken out of the idle half-hours and out of
// the longest idle stretch: the export cannot say WHEN lunch was, only how long, so it is not held against anyone.
// `freeIsIdle`: once there are chores to punch (CHORES_FROM), a half-hour with the product in the oven and nothing else
// done is idle, not free — "should be expected to do other chores" (Stuart 2026-10-13).
function slotsOf({ inMs, outMs, eventAts, workIvs, freeIvs, breakMins = 0, freeIsIdle = false }) {
    const slotMs = SLOT_MINS * MIN;
    const n = Math.max(1, Math.ceil((outMs - inMs) / slotMs));
    let working = 0, free = 0, run = 0, longest = 0;
    for (let i = 0; i < n; i++) {
        const a = inMs + i * slotMs, b = Math.min(outMs, a + slotMs);
        const w = eventAts.some(t => t >= a && t < b) || workIvs.some(([s, e]) => s < b && e > a);
        const f = !w && !freeIsIdle && freeIvs.some(([s, e]) => s < b && e > a);
        if (w) { working++; run = 0; } else if (f) { free++; run = 0; } else { run++; longest = Math.max(longest, run); }
    }
    const lunch = Math.min(n - working - free, Math.round(breakMins / SLOT_MINS));
    return { total: n, working, free, lunch, idle: n - working - free - lunch, longestIdleMins: Math.max(0, longest * SLOT_MINS - breakMins) };
}
// What counts as a person's work, by board: the floor's punches and its Setup Queue (finishing); the WMS and the
// Setup Queue — the bench that picks is the bench that stages (pick / pack).
const RELEVANT_SRC = { [GROUP.FINISHING]: [SRC.FLOOR, SRC.FLOOR_APP], [GROUP.WMS]: [SRC.WMS, SRC.FLOOR_APP] };

/**
 * Every person-day: what they did, against their clock.
 * @param boardOf    personKey → a board setting (role + Floor Metrics' moves); BOTH gives a day row on each board
 * @param nameOf     personKey → the name to show
 * @param chores     finished chores (Shared/floorChores.choreIntervalsOf) — work, like a step
 * @returns [{ pk, who, date, week, group, clock, firstMs, startLagMins, steps, short, overruns, ratios, gaps,
 *             busyMins, choreMins, ovenFreeMins, clockedMins, slots, picks, packs, actions, done, orders, setups, setupRefs, unclocked }]
 */
export function personDaysOf({ steps = [], events = [], chores = [], clockByPerson = new Map(), boardOf = () => GROUP.NONE, nameOf = (pk) => pk } = {}) {
    const days = new Map();
    const dayOf = (pk, date) => {
        const k = `${pk}|${date}`;
        if (!days.has(k)) days.set(k, { pk, date, events: [], steps: [], chores: [] });
        return days.get(k);
    };
    events.forEach(e => dayOf(personKeyOf(e.who), dateKeyOf(e.at)).events.push(e));
    steps.forEach(s => dayOf(personKeyOf(s.who), dateKeyOf(s.startMs)).steps.push(s));
    chores.forEach(c => dayOf(personKeyOf(c.who), dateKeyOf(c.startMs)).chores.push(c));
    clockByPerson.forEach((byDate, pk) => byDate.forEach((_, date) => dayOf(pk, date)));

    return [...days.values()].flatMap(d => boardsOf(boardOf(d.pk)).map(group => {
        const clock = (clockByPerson.get(d.pk) || new Map()).get(d.date) || null;
        const win = clock && clock.inMs && clock.outMs ? [clock.inMs, clock.outMs] : null;
        const rel = RELEVANT_SRC[group] ? d.events.filter(e => RELEVANT_SRC[group].includes(e.src)) : d.events;
        const touched = (rel.length ? rel : d.events).map(e => e.at).concat(d.steps.map(s => s.startMs));
        const firstMs = touched.length ? Math.min(...touched) : null;

        // the floor: the person's own steps, the oven's time, the gap to the next order
        const own = d.steps.filter(s => s.person);
        const timed = own.filter(s => !s.overrun);
        const busy = clipTo(unionOf(timed.map(s => [s.startMs, s.endMs])), win);
        // chores are work too (Shared/floorChores) — the time they cover is neither idle nor oven-free
        const choreIvs = minus(clipTo(unionOf(d.chores.map(c => [c.startMs, c.endMs])), win), busy);
        const working = unionOf([...busy, ...choreIvs]);
        const oven = minus(clipTo(unionOf(d.steps.filter(s => s.oven && !s.overrun).map(s => [s.startMs, s.endMs])), win), working);
        const gaps = [];
        let last = null;
        own.slice().sort((a, b) => a.startMs - b.startMs).forEach(s => {
            if (last && s.woId !== last.woId) { const g = Math.max(0, (s.startMs - last.endMs) / MIN); if (g <= NEXT_ORDER_MAX_MINS) gaps.push(g); }
            if (!last || s.endMs >= last.endMs) last = s;
        });

        // the WMS: what was picked, packed, done
        const wms = d.events.filter(e => e.src === SRC.WMS);
        const refsOf = (kind) => new Set(wms.filter(e => e.kind === kind).map(e => e.ref || `@${e.at}`));
        const done = [];
        const seenDone = new Set();
        wms.filter(e => (e.kind === WMS_KIND.PICK || e.kind === WMS_KIND.PACK) && e.ref).forEach(e => {
            const k = `${e.kind}|${e.ref}`; if (seenDone.has(k)) return; seenDone.add(k); done.push({ kind: e.kind, ref: e.ref, at: e.at });
        });
        // one action, however many records it left (a pick's stamp and its log line, a double-logged move)
        const distinct = [];
        (rel.length ? rel : d.events).forEach(e => {
            const same = (x) => x.kind === e.kind && (e.ref ? x.ref === e.ref && Math.abs(x.at - e.at) < 5 * MIN : x.at === e.at);
            if (!distinct.some(same)) distinct.push(e);
        });

        const slots = win ? slotsOf({ inMs: win[0], outMs: win[1], eventAts: rel.map(e => e.at), workIvs: working, freeIvs: oven, breakMins: breakMinsOf(clock), freeIsIdle: d.date >= CHORES_FROM }) : null;
        return {
            pk: d.pk, who: nameOf(d.pk), date: d.date, week: weekKeyOf(d.date), group, clock,
            // first touch needs only the clock-in — a day still going (no clock-out yet) has one
            firstMs, startLagMins: (clock && clock.inMs && firstMs) ? Math.max(0, (firstMs - clock.inMs) / MIN) : null,
            steps: own.length, short: own.filter(s => s.short).length, overruns: own.filter(s => s.overrun).length,
            ratios: timed.filter(s => !s.short && s.normalMins > 0).map(s => s.ranMins / s.normalMins),
            gaps, busyMins: minsOf(busy), choreMins: minsOf(choreIvs), chores: d.chores.length, ovenFreeMins: minsOf(oven), clockedMins: clockedMinsOf(clock), slots,
            picks: refsOf(WMS_KIND.PICK).size, packs: refsOf(WMS_KIND.PACK).size, actions: distinct.length, done,
            orders: [...new Set(own.map(s => s.woId).filter(Boolean))],
            // the Setup Queue: the orders this person started setup on or staged to the floor
            setups: d.events.filter(e => e.src === SRC.FLOOR_APP && (e.kind === SETUP_KIND.SETUP || e.kind === SETUP_KIND.STAGED)).length,
            setupRefs: [...new Set(d.events.filter(e => e.src === SRC.FLOOR_APP && e.ref).map(e => e.ref))],
            unclocked: !clock && (d.events.length > 0 || d.steps.length > 0),
        };
    })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.pk.localeCompare(b.pk) || a.group.localeCompare(b.group)));
}

// ── a person's week ───────────────────────────────────────────────────────────────────────────────────────
/** By its due date: finished (the floor's completedAt) or picked / packed on or before reqDate. */
const byDue = (atMs, reqDate) => !!reqDate && dateKeyOf(atMs) <= String(reqDate).slice(0, 10);

/** One row per person for the week starting `week` (a Monday, 'YYYY-MM-DD'). Hours stay on the row — never published. */
export function weekRowsOf({ personDays = [], week, wosById = {} } = {}) {
    const by = new Map();
    personDays.filter(d => d.week === week).forEach(d => { const k = `${d.pk}|${d.group}`; if (!by.has(k)) by.set(k, []); by.get(k).push(d); });
    // the Setup Queue names an order the way every log line does (Shared/woRef) — back to its document
    const byRef = new Map();
    Object.values(wosById).forEach(w => { if (!w) return; byRef.set(String(woRefOf(w)), w); if (w.id) byRef.set(String(w.id), w); });
    return [...by.values()].map((ds) => {
        const pk = ds[0].pk;
        const sum = (f) => ds.reduce((t, d) => t + N(f(d)), 0);
        const steps = sum(d => d.steps), short = sum(d => d.short);
        const slots = ds.filter(d => d.slots);
        const totalSlots = slots.reduce((t, d) => t + d.slots.total, 0), freeSlots = slots.reduce((t, d) => t + d.slots.free, 0);
        const lunchSlots = slots.reduce((t, d) => t + d.slots.lunch, 0);
        const workingSlots = slots.reduce((t, d) => t + d.slots.working, 0);
        const clockedMins = sum(d => d.clockedMins);
        const actions = sum(d => d.actions);
        // due dates: the orders they worked that the floor has finished, and what they picked / packed
        const setOrders = ds.flatMap(d => d.setupRefs || []).map(r => byRef.get(String(r))).filter(Boolean).map(w => w.id);
        const orders = [...new Set([...ds.flatMap(d => d.orders), ...setOrders])];
        const finished = orders.map(id => wosById[id]).filter(w => w && msOf(w.completedAt) && w.reqDate);
        const handled = ds.flatMap(d => d.done).map(x => ({ ...x, wo: wosById[x.ref] })).filter(x => x.wo && x.wo.reqDate);
        const onTime = ds[0].group === GROUP.WMS
            ? { ok: handled.filter(x => byDue(x.at, x.wo.reqDate)).length, total: handled.length }
            : { ok: finished.filter(w => byDue(msOf(w.completedAt), w.reqDate)).length, total: finished.length };
        return {
            pk, who: ds[0].who, group: ds[0].group, week,
            days: ds.filter(d => d.firstMs || d.clock).length, activeDays: ds.filter(d => d.firstMs).length,
            clockDays: ds.filter(d => d.clock).length, unclockedDays: ds.filter(d => d.unclocked).length,
            hours: ds.reduce((t, d) => t + N(d.clock && d.clock.totalHours), 0),
            startLagMins: median(ds.map(d => d.startLagMins).filter(x => x != null)),
            steps, short, overruns: sum(d => d.overruns), setups: sum(d => d.setups),
            realShare: steps ? (steps - short) / steps : null,
            paceRatio: median(ds.flatMap(d => d.ratios)),
            nextGapMins: median(ds.flatMap(d => d.gaps)),
            busyMins: sum(d => d.busyMins), choreMins: sum(d => d.choreMins), chores: sum(d => d.chores), ovenFreeMins: sum(d => d.ovenFreeMins), clockedMins,
            steadyShare: totalSlots - freeSlots - lunchSlots > 0 ? workingSlots / (totalSlots - freeSlots - lunchSlots) : null,
            freeShare: totalSlots ? freeSlots / totalSlots : null,
            longestIdleMins: median(slots.map(d => d.slots.longestIdleMins)),   // the usual day's, not the worst
            picks: sum(d => d.picks), packs: sum(d => d.packs), actions,
            actionsPerHour: clockedMins > 0 ? actions / (clockedMins / 60) : null,
            onTime,
        };
    });
}

// ── the score ─────────────────────────────────────────────────────────────────────────────────────────────
// Each part reads 0 … 1 between a BAD and a GOOD mark; a part with nothing to read is left out and the score
// is out of the parts that could be read. The marks are the floor's own where it has them (the standard, the
// punch check) and a plain first setting where it does not — change them here, the harness says what moves.
const lin = (v, good, bad) => (v == null || !Number.isFinite(v)) ? null : Math.max(0, Math.min(1, (v - bad) / (good - bad)));
const pct = (x) => `${Math.round(x * 100)}%`;
export const SCORE_PARTS = {
    [GROUP.FINISHING]: [
        { key: 'start', label: 'Start', weight: 15, of: r => lin(r.startLagMins, 15, 60), says: r => `${Math.round(r.startLagMins)} min from clock-in to first pin` },
        { key: 'punches', label: 'Real punches', weight: 25, of: r => r.realShare, says: r => `${pct(r.realShare)} of ${r.steps} steps punched for real` },
        { key: 'pace', label: 'Pace', weight: 15, of: r => lin(r.paceRatio, 1, 2), says: r => `${r.paceRatio.toFixed(1)}× the standard time` },
        { key: 'next', label: 'Next order', weight: 15, of: r => lin(r.nextGapMins, 10, 60), says: r => `${Math.round(r.nextGapMins)} min to start the next order` },
        { key: 'steady', label: 'Steady', weight: 20, of: r => lin(r.steadyShare, 0.85, 0.4), says: r => `working ${pct(r.steadyShare)} of the day` },
        { key: 'onTime', label: 'Due dates', weight: 10, of: r => (r.onTime.total ? r.onTime.ok / r.onTime.total : null), says: r => `${r.onTime.ok} of ${r.onTime.total} orders done by their due date` },
    ],
    [GROUP.WMS]: [
        { key: 'start', label: 'Start', weight: 20, of: r => lin(r.startLagMins, 15, 60), says: r => `${Math.round(r.startLagMins)} min from clock-in to first action` },
        { key: 'steady', label: 'Steady', weight: 35, of: r => lin(r.steadyShare, 0.85, 0.4), says: r => `working ${pct(r.steadyShare)} of the day` },
        { key: 'volume', label: 'Volume', weight: 30, of: (r, ctx) => (r.actionsPerHour != null && ctx.medianRate ? Math.min(1, r.actionsPerHour / ctx.medianRate) : null), says: r => `${r.actionsPerHour.toFixed(1)} actions an hour` },
        { key: 'onTime', label: 'Due dates', weight: 15, of: r => (r.onTime.total ? r.onTime.ok / r.onTime.total : null), says: r => `${r.onTime.ok} of ${r.onTime.total} picks / packs by their due date` },
    ],
};
/** Enough of a week to rank: two days of work; ten steps or Setup Queue setups (floor) or ten actions (WMS); three parts read. */
export const RANK_MIN = { days: 2, work: 10, parts: 3 };
export const FAME_SIZE = 3;

/** Score each row against its group; rank the groups; name the top and the bottom. */
export function rankWeek(rows = []) {
    const eligible = (r) => r.group !== GROUP.NONE && r.activeDays >= RANK_MIN.days
        && (r.group === GROUP.FINISHING ? N(r.steps) + N(r.setups) : r.actions) >= RANK_MIN.work;
    const out = { [GROUP.FINISHING]: [], [GROUP.WMS]: [], unranked: [], fame: {}, shame: {} };
    [GROUP.FINISHING, GROUP.WMS].forEach(g => {
        const mine = rows.filter(r => r.group === g && eligible(r));
        const ctx = { medianRate: median(mine.map(r => r.actionsPerHour).filter(x => x != null)) };
        const scored = mine.map(r => {
            const parts = SCORE_PARTS[g].map(p => { const v = p.of(r, ctx); return { key: p.key, label: p.label, weight: p.weight, value: v, says: v == null ? '' : p.says(r) }; });
            const read = parts.filter(p => p.value != null);
            const w = read.reduce((t, p) => t + p.weight, 0);
            const score = read.length >= RANK_MIN.parts && w > 0 ? Math.round(100 * read.reduce((t, p) => t + p.weight * p.value, 0) / w) : null;
            return { ...r, parts, score };
        });
        const ranked = scored.filter(r => r.score != null).sort((a, b) => b.score - a.score || a.who.localeCompare(b.who));
        ranked.forEach((r, i) => { r.rank = i + 1; });
        out[g] = ranked;
        out.unranked.push(...scored.filter(r => r.score == null));
        const n = ranked.length >= 2 * FAME_SIZE ? FAME_SIZE : Math.floor(ranked.length / 2);
        const best = (r) => r.parts.filter(p => p.value != null).sort((a, b) => b.value - a.value || b.weight - a.weight)[0];
        const worst = (r) => r.parts.filter(p => p.value != null).sort((a, b) => a.value - b.value || b.weight - a.weight)[0];
        out.fame[g] = ranked.slice(0, n).map(r => ({ name: r.who, score: r.score, why: best(r).says }));
        out.shame[g] = ranked.slice(ranked.length - n).reverse().map(r => ({ name: r.who, score: r.score, why: worst(r).says }));
    });
    out.unranked.push(...rows.filter(r => !eligible(r)));
    return out;
}

// ── the wallboard ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * What the floor's screens may read (fin_config/wallboard): names, scores, the parts and the facts behind them.
 * NO hours, no clock times — payroll stays in HQ (Stuart 2026-10-13: hours are admin-only).
 */
export function wallboardDocOf({ week, ranked, by = '', nowMs = Date.now() } = {}) {
    const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
    const pub = (r) => ({
        name: r.who, rank: r.rank, score: r.score,
        parts: Object.fromEntries(r.parts.map(p => [p.key, p.value == null ? null : Math.round(p.value * 100)])),
        facts: {
            days: r.activeDays, startLagMins: r1(r.startLagMins), steps: r.steps, setups: r.setups || 0, realPunchPct: r.realShare == null ? null : Math.round(r.realShare * 100),
            paceRatio: r1(r.paceRatio), nextGapMins: r1(r.nextGapMins), steadyPct: r.steadyShare == null ? null : Math.round(r.steadyShare * 100),
            longestIdleMins: r.longestIdleMins, picks: r.picks, packs: r.packs, actions: r.actions, actionsPerHour: r1(r.actionsPerHour), onTime: r.onTime,
        },
    });
    return {
        week, weekEnd: addDays(week, 6), publishedAt: nowMs, publishedBy: by,
        groups: { [GROUP.FINISHING]: (ranked[GROUP.FINISHING] || []).map(pub), [GROUP.WMS]: (ranked[GROUP.WMS] || []).map(pub) },
        fame: ranked.fame || {}, shame: ranked.shame || {},
    };
}

// ── the standards, against the floor ─────────────────────────────────────────────────────────────────────────
// Pace is read against Production Times. Where the crew's real punches sit far from a standard, the standard — not
// the crew — is what is off, and pace reads wrong for everyone on that step until it is set (2026-10-14: spray coats
// on a 3-minute standard that was never saved; the real median is about 20 minutes, spin machine and booth alike).
export const STANDARD_OFF = { far: 2, minReal: 10 };
const stationOfStep = (task, wo) => (task.startsWith('pole') ? 'poles' : task === 'hand' ? 'hand'
    : (wo && sprayStationOf(wo) === SPRAY_STATIONS.BOOTH ? 'booth' : 'spin'));
/** Per step and station: how many, how many not real, the real median against the standard → [{ task, station, n, short, real, realMedianMins, standardMins, off }] */
export function standardsCheckOf(steps = [], wosById = {}) {
    const by = new Map();
    steps.forEach(s => { const k = `${s.task}|${stationOfStep(s.task, wosById[s.woId])}`; if (!by.has(k)) by.set(k, []); by.get(k).push(s); });
    return [...by.entries()].map(([k, ss]) => {
        const [task, station] = k.split('|');
        const real = ss.filter(s => !s.short && !s.overrun);
        const realMedianMins = median(real.map(s => s.ranMins));
        const standardMins = median(ss.map(s => s.normalMins));
        const off = real.length >= STANDARD_OFF.minReal && standardMins > 0 && realMedianMins != null
            && (realMedianMins / standardMins >= STANDARD_OFF.far || realMedianMins / standardMins <= 1 / STANDARD_OFF.far);
        return { task, station, oven: OVEN_STEPS.includes(task), n: ss.length, short: ss.filter(s => s.short).length, real: real.length, realMedianMins, standardMins, off };
    }).sort((a, b) => b.n - a.n);
}

/** The weeks that have anything in them, newest first. */
export const weeksOf = (personDays = []) => [...new Set(personDays.map(d => d.week))].sort().reverse();
