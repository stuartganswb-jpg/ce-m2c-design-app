// ── WHAT THE FLOOR MADE — PIECES, ORDERS, AND WHAT THEY TOOK (Stuart 2026-10-22) ─────────────────────────────────
// "i also want a what we did today, what we did this week. Details by parts, how many rings today, this week? small
// parts brackets and finials?, poles — how many just spray finished, how many with hand finishing (goes for small parts
// as well), how many this week of each category vs last, whom did what … i need to start seeing some metrics on per
// piece, per order to start to learn our capacity" · "finial collars count as finials".
//
// A PIECE IS DONE when its order is signed off the floor (completedAt — the moment it leaves for packing). A pick-only
// line, a line not finished here (noFinish, finishOutsourced) and an order that never came to the floor (pickOnly) are
// not counted. Its CATEGORY — rings · brackets · finials (collars and tops too) · poles · other small parts — is read
// in turn from the line's product type, the item master (by its code), the order's own type, then its name; every
// piece says which (`by`), so a count that rests on a name can be seen. Its FINISH — spray only, or with a hand coat — is
// the recipe that track actually ran (the copy an order keeps — Shared/floorActivity.partsRecipeOfWo / poleRecipeOfWo),
// small parts and poles each on their own.
// WHO DID WHAT reads the floor's own punches (Shared/floorMetrics.floorStepsOf): the pieces each person set up, sprayed,
// hand-finished or baked, coat by coat — a spin job in loads counted by the load it was.
//
// Pure — no React, no Firestore. Harness: scripts/floorOutput.test.mjs.

import { partsRecipeOfWo, poleRecipeOfWo, streamHasHandCoat, woHasPoles, woHasSmallParts, smallPartsTotalOf, sprayStationOf, SPRAY_STATIONS } from './floorActivity.js';
import { runsInLoads, spinLoadsOf } from './spinLoads.js';
import { woRecipeCode } from './finishingTime.js';
import { dateKeyOf, weekKeyOf, addDays, dayStartOf } from './timecardImport.js';

const MIN = 60000;
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const msOf = (t) => (!t ? 0 : typeof t === 'number' ? t : typeof t.toMillis === 'function' ? t.toMillis() : (t.seconds != null ? t.seconds * 1000 : 0));
const median = (xs) => { const a = xs.filter(Number.isFinite).sort((p, q) => p - q); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

export const CATEGORY = { RINGS: 'rings', BRACKETS: 'brackets', FINIALS: 'finials', POLES: 'poles', OTHER: 'other' };
export const CATEGORIES = [CATEGORY.RINGS, CATEGORY.BRACKETS, CATEGORY.FINIALS, CATEGORY.OTHER, CATEGORY.POLES];
export const CATEGORY_LABEL = { rings: 'Rings', brackets: 'Brackets', finials: 'Finials', other: 'Other small parts', poles: 'Poles' };
export const CATEGORY_LABEL_ES = { rings: 'Anillos', brackets: 'Soportes', finials: 'Remates', other: 'Otras piezas', poles: 'Barras' };
export const MODE = { SPRAY: 'spray', HAND: 'hand' };

/** A product type, however it is spelled ("BRACKET", "Bracket", "FINIAL COLLAR") → a category, or null for no type at all. */
export function categoryOfType(type) {
    const t = String(type || '').trim().toUpperCase();
    if (!t) return null;
    if (/\bRING/.test(t)) return CATEGORY.RINGS;
    if (/BRACKET|BACKPLATE|HOLDBACK/.test(t)) return CATEGORY.BRACKETS;
    if (/FINIAL|COLLAR/.test(t)) return CATEGORY.FINIALS;
    if (/\bPOLE|\bROD\b|TRAVERSE|TRACK/.test(t)) return CATEGORY.POLES;
    return CATEGORY.OTHER;
}
/** An item's NAME → a category — the last resort (a repaint run's code the item master has no record of). */
export function categoryOfName(name) {
    const n = String(name || '').toUpperCase();
    if (!n.trim()) return null;
    if (/\bRINGS?\b/.test(n)) return CATEGORY.RINGS;
    if (/BRKT|BRACKET|BACKPLATE|PROJ(ECTION)?\b|RETURN|INSIDE M(OU)?NT|\bARM\b/.test(n)) return CATEGORY.BRACKETS;
    if (/FINIAL|\bFNL\b|COLLAR|\bORB\b/.test(n)) return CATEGORY.FINIALS;
    if (/\bPOLE|\bROD\b|\bRD\b|TRAVERSE|TRACK/.test(n)) return CATEGORY.POLES;
    return CATEGORY.OTHER;
}

const bareCode = (c) => String(c || '').trim().toUpperCase().split('/')[0];
const pcsOf = (p) => N(p && p.pcs) || N(p && p.quantity) || N(p && p.qty);
const finishedHere = (p) => p && !p.pickOnly && !p.noFinish && !p.finishOutsourced && pcsOf(p) > 0;
/**
 * The pieces an order finished, line by line → [{ code, name, qty, category, by }].
 * @param typeOfCode  item code → product type from the item master ('' when it has none); both the full and the bare code are asked
 */
export function piecesOfOrder(wo, { typeOfCode = () => '' } = {}) {
    if (!wo) return [];
    const lines = (Array.isArray(wo.partsList) ? wo.partsList : []).filter(finishedHere);
    const one = !lines.length || lines.length === 1;
    const read = (code, lineType, name) => {
        let c = categoryOfType(lineType); if (c) return { category: c, by: 'line' };
        c = categoryOfType(typeOfCode(code) || typeOfCode(bareCode(code))); if (c) return { category: c, by: 'master' };
        if (one) { c = categoryOfType(wo.productType); if (c) return { category: c, by: 'order' }; }
        // the line's name, else (a one-line order) the order's — whichever says more than "other"
        const byLine = categoryOfName(name), byOrder = one ? categoryOfName(wo.type || wo.stockErpId) : null;
        c = [byLine, byOrder].find(x => x && x !== CATEGORY.OTHER) || byLine || byOrder; if (c) return { category: c, by: 'name' };
        return { category: CATEGORY.OTHER, by: 'none' };
    };
    if (!lines.length) {
        const qty = N(wo.totalParts);
        if (!qty) return [];
        const code = wo.stockErpId || wo.itemCode || '';
        // a pole-only document is its poles, whatever else it says
        if (woHasPoles(wo) && !woHasSmallParts(wo)) return [{ code, name: wo.type || '', qty, category: CATEGORY.POLES, by: 'order' }];
        return [{ code, name: wo.type || '', qty, ...read(code, '', wo.type || code) }];
    }
    return lines.map(p => {
        const code = String(p.legacyErpId || p.itemCode || p.partId || '');
        return { code, name: String(p.partName || p.name || ''), qty: pcsOf(p), ...read(code, p.productType, p.partName || p.name || code) };
    });
}

// The finish code settled as the floor settles it (FinishingFloor withRecipe — an order released with no recipe reads it off
// its item code), so HQ, reading the raw documents, and the wallboard, reading the floor's, give the same answer.
const settled = (wo) => { const r = woRecipeCode(wo); return wo && r && r !== wo.recipe ? { ...wo, recipe: r } : wo; };
/** Each finished piece of an order, with how it was finished → [{ category, mode, qty, by, code }]. The finish is the floor's
 *  own reading of that track's recipe (Shared/floorActivity.streamHasHandCoat — the copy the order kept, once begun). */
export function finishedPiecesOf(wo, { recipes = {}, typeOfCode } = {}) {
    const w = settled(wo);
    const partsMode = streamHasHandCoat(recipes, w, 'parts') ? MODE.HAND : MODE.SPRAY;
    const poleMode = streamHasHandCoat(recipes, w, 'poles') ? MODE.HAND : MODE.SPRAY;
    return piecesOfOrder(wo, { typeOfCode }).map(p => ({ ...p, mode: p.category === CATEGORY.POLES ? poleMode : partsMode }));
}

/** An order the floor signed off, and when → its completion time, or 0. */
// A Stitch & Sew document (division SEW) shares the collection but is never the finishing floor's (FinishingFloor notSew).
export const finishedAtOf = (wo) => (wo && wo.pickOnly !== true && !/pick only/i.test(String(wo.completedBy || '')) && String(wo.division || '').toUpperCase() !== 'SEW' ? msOf(wo.completedAt) : 0);

const emptyTable = () => Object.fromEntries(CATEGORIES.map(c => [c, { spray: 0, hand: 0, total: 0, orders: 0 }]));
/**
 * Pieces finished between two times, by category and finish → { byCategory: { rings: { spray, hand, total, orders } … },
 * total, orders, byName (pieces whose category rests on a name or nothing) }.
 */
export function outputBetween({ workOrders = [], recipes = {}, typeOfCode, fromMs, toMs }) {
    const t = emptyTable(); let total = 0, orders = 0, byName = 0;
    workOrders.forEach(wo => {
        const at = finishedAtOf(wo);
        if (!at || at < fromMs || at >= toMs) return;
        const pieces = finishedPiecesOf(wo, { recipes, typeOfCode });
        if (!pieces.length) return;
        orders += 1;
        const seen = new Set();
        pieces.forEach(p => {
            const row = t[p.category];
            row[p.mode] += p.qty; row.total += p.qty; total += p.qty;
            if (p.by === 'name' || p.by === 'none') byName += p.qty;
            if (!seen.has(p.category)) { row.orders += 1; seen.add(p.category); }
        });
    });
    return { byCategory: t, total, orders, byName };
}

/** Today, this week (Monday on) and last week, by the floor's local day — and last week up to this moment a week ago,
 *  the fair line for "this week vs last" while the week is still running. */
export function periodsOf(nowMs = Date.now()) {
    const today = dateKeyOf(nowMs);
    const week = weekKeyOf(today);
    return {
        today: { fromMs: dayStartOf(today), toMs: nowMs + 1, label: 'Today', es: 'Hoy' },
        week: { fromMs: dayStartOf(week), toMs: nowMs + 1, label: 'This week', es: 'Esta semana' },
        lastWeek: { fromMs: dayStartOf(addDays(week, -7)), toMs: dayStartOf(week), label: 'Last week', es: 'Semana pasada' },
        lastWeekToDate: { fromMs: dayStartOf(addDays(week, -7)), toMs: dayStartOf(addDays(today, -7)) + (nowMs - dayStartOf(today)) + 1, label: 'Last week, to this point', es: 'Semana pasada, a esta hora' },
    };
}
/** This week against last week to the same point → { diff, pct } (pct null when last week had none). */
export const changeOf = (now, before) => ({ diff: N(now) - N(before), pct: N(before) ? (N(now) - N(before)) / N(before) : null });
/** The periods at once — what the wallboard and HQ print. */
export function outputPeriodsOf({ workOrders, recipes, typeOfCode, nowMs = Date.now() }) {
    const p = periodsOf(nowMs);
    return Object.fromEntries(Object.entries(p).map(([k, r]) => [k, { ...r, ...outputBetween({ workOrders, recipes, typeOfCode, fromMs: r.fromMs, toMs: r.toMs }) }]));
}

/** Pieces finished day by day between two times → [{ date, total, orders, byCategory: { rings: n … } }], every day in range. */
export function outputByDayOf({ workOrders = [], recipes = {}, typeOfCode, fromMs, toMs }) {
    const out = [];
    for (let d = dateKeyOf(fromMs); dayStartOf(d) < toMs; d = addDays(d, 1)) {
        const o = outputBetween({ workOrders, recipes, typeOfCode, fromMs: dayStartOf(d), toMs: Math.min(toMs, dayStartOf(addDays(d, 1))) });
        out.push({ date: d, total: o.total, orders: o.orders, byCategory: Object.fromEntries(CATEGORIES.map(c => [c, o.byCategory[c].total])) });
    }
    return out;
}

// ── the item master ───────────────────────────────────────────────────────────────────────────────────────────
/** The codes to ask the item master for: every finished line since `fromMs` that carries no product type of its own
 *  (its full code and its bare code), and the order's own code where it has no lines. Upper case, once each. */
export function codesToAskOf(workOrders = [], { fromMs = 0 } = {}) {
    const out = new Set();
    const add = (c) => { const u = String(c || '').trim().toUpperCase(); if (u) { out.add(u); out.add(bareCode(u)); } };
    workOrders.forEach(wo => {
        const at = finishedAtOf(wo); if (!at || at < fromMs) return;
        const lines = (Array.isArray(wo.partsList) ? wo.partsList : []).filter(finishedHere);
        if (!lines.length) { add(wo.stockErpId || wo.itemCode); return; }
        lines.forEach(p => { if (!categoryOfType(p.productType)) add(p.legacyErpId || p.itemCode || p.partId); });
    });
    return [...out];
}
/** The item records read by code ({ CODE: record }, Shared/PullLinesLive.fetchPartsByCode) → the `typeOfCode` the readers take. */
export const typeOfCodeFrom = (partsByCode = {}) => (code) => {
    const p = partsByCode[String(code || '').trim().toUpperCase()];
    return p ? String((p.manufacturingSpecs && p.manufacturingSpecs.productType) || p.productType || '') : '';
};

// ── who did what ──────────────────────────────────────────────────────────────────────────────────────────────
// The pieces a step handled: the poles for a pole step; for a small-parts step the small parts — on a spin job in loads,
// the load it was (the first load finished after the step), else what was left.
export function piecesOfStep(task, wo, atMs, typeOfCode) {
    if (!wo) return 0;
    const own = (poles) => piecesOfOrder(wo, { typeOfCode }).filter(x => (x.category === CATEGORY.POLES) === poles).reduce((t, x) => t + x.qty, 0);
    if (String(task).startsWith('pole')) return N(wo.totalPoles || (wo.poles && wo.poles.qty)) || (woHasSmallParts(wo) ? own(true) : N(wo.totalParts) || own(true));
    if (runsInLoads(wo)) {
        const loads = (Array.isArray(wo.spinLoads) ? wo.spinLoads : []).filter(Boolean).slice().sort((a, b) => N(a.doneAt) - N(b.doneAt));
        const hit = loads.find(l => N(l.doneAt) >= atMs);
        if (hit) return N(hit.qty);
        if (loads.length || N(wo.spinLoadQty)) return spinLoadsOf(wo).qty;
    }
    return smallPartsTotalOf(wo) || own(false);   // an order with no piece total stamped: its own lines
}
const KIND_OF_TASK = { spinSetup: 'setup', spinSpray: 'sprayed', poleSpray: 'sprayed', hand: 'handFinished', poleHand: 'handFinished', spinBake: 'baked', poleBake: 'baked' };
/**
 * Per person, the pieces they handled between two times: { [name]: { setup, sprayed, handFinished, baked, steps, orders, byCategory: { rings: n … } } }.
 * `steps` are Shared/floorMetrics.floorStepsOf's (who, woId, task, startMs, endMs). A coat counts each time — two coats of 20 rings is 40.
 * `byCategory` is the COATS they put on (sprayed + hand-finished) by category — a setup or a bake is not a coat.
 */
export function workByPersonOf({ steps = [], wosById = {}, typeOfCode, fromMs, toMs }) {
    const out = {};
    steps.forEach(s => {
        if (!s || s.endMs < fromMs || s.endMs >= toMs) return;
        const kind = KIND_OF_TASK[s.task]; if (!kind) return;
        const wo = wosById[s.woId];
        const qty = piecesOfStep(s.task, wo, s.endMs, typeOfCode); if (!qty) return;
        const p = out[s.who] || (out[s.who] = { setup: 0, sprayed: 0, handFinished: 0, baked: 0, steps: 0, orders: new Set(), byCategory: Object.fromEntries(CATEGORIES.map(c => [c, 0])) });
        p[kind] += qty; p.steps += 1; p.orders.add(s.woId);
        if (kind !== 'sprayed' && kind !== 'handFinished') return;
        // the order's own mix, for the track this step worked
        const pieces = piecesOfOrder(wo, { typeOfCode }).filter(x => (String(s.task).startsWith('pole') ? x.category === CATEGORY.POLES : x.category !== CATEGORY.POLES));
        const sum = pieces.reduce((t, x) => t + x.qty, 0);
        if (sum) pieces.forEach(x => { p.byCategory[x.category] += qty * (x.qty / sum); });
        else p.byCategory[String(s.task).startsWith('pole') ? CATEGORY.POLES : CATEGORY.OTHER] += qty;
    });
    Object.values(out).forEach(p => { p.orders = p.orders.size; Object.keys(p.byCategory).forEach(k => { p.byCategory[k] = Math.round(p.byCategory[k]); }); });
    return out;
}

// ── capacity ──────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Orders finished between two times, each with what it took → [{ woId, ref, at, pieces, poles, coats, floorMins, handsOnMins, flow, categories }]
 *   floorMins    first punch on the order → finished
 *   handsOnMins  the minutes someone was on it (every hands-on step, as punched — a step left running counts its standard, `leftRunning` says how many)
 *   flow         handsOnMins ÷ floorMins — how much of its time on the floor something was being done to it
 * @param refOf  the order's name (Shared/woRef)
 */
export function ordersBetween({ workOrders = [], steps = [], recipes = {}, typeOfCode, fromMs, toMs, refOf = (w) => w.id }) {
    const byOrder = new Map();
    steps.forEach(s => { if (!byOrder.has(s.woId)) byOrder.set(s.woId, []); byOrder.get(s.woId).push(s); });
    return workOrders.filter(w => { const at = finishedAtOf(w); return at && at >= fromMs && at < toMs; }).map(w => {
        const at = finishedAtOf(w);
        const st = byOrder.get(w.id) || [];
        const first = st.length ? Math.min(...st.map(s => s.startMs)) : null;
        const hands = st.filter(s => s.person);
        const handsOn = hands.reduce((t, s) => t + N(s.overrun ? s.normalMins : s.ranMins), 0);
        const pieces = finishedPiecesOf(w, { recipes, typeOfCode });
        const coats = (r) => (r && Array.isArray(r.steps) ? r.steps.length : 0);
        const floorMins = first ? Math.max(0, (at - first) / MIN) : null;
        return {
            woId: w.id, ref: refOf(w), at, pieces: pieces.reduce((t, p) => t + p.qty, 0),
            poles: pieces.filter(p => p.category === CATEGORY.POLES).reduce((t, p) => t + p.qty, 0),
            coats: Math.max(coats(partsRecipeOfWo(recipes, settled(w))), woHasPoles(w) ? coats(poleRecipeOfWo(recipes, settled(w))) : 0),
            floorMins, handsOnMins: handsOn, leftRunning: hands.filter(s => s.overrun).length, flow: floorMins ? Math.min(1, handsOn / floorMins) : null,
            categories: [...new Set(pieces.map(p => p.category))],
        };
    }).sort((a, b) => b.at - a.at);
}

/**
 * Minutes per piece, by category, from REAL punches only (a step that ran what the floor's punch check accepts and was
 * not left running): { sprayed: { rings: m, … }, handFinished: { … } } — each coat's minutes ÷ the pieces it covered.
 */
export function minutesPerPieceOf({ steps = [], wosById = {}, typeOfCode, fromMs, toMs }) {
    const acc = { sprayed: {}, handFinished: {} };
    steps.forEach(s => {
        if (!s || !s.person || s.short || s.overrun || s.endMs < fromMs || s.endMs >= toMs) return;
        const kind = KIND_OF_TASK[s.task]; if (kind !== 'sprayed' && kind !== 'handFinished') return;
        const wo = wosById[s.woId]; const qty = piecesOfStep(s.task, wo, s.endMs, typeOfCode); if (!qty) return;
        const pieces = piecesOfOrder(wo, { typeOfCode }).filter(x => (String(s.task).startsWith('pole') ? x.category === CATEGORY.POLES : x.category !== CATEGORY.POLES));
        const main = pieces.length ? pieces.slice().sort((a, b) => b.qty - a.qty)[0].category : (String(s.task).startsWith('pole') ? CATEGORY.POLES : CATEGORY.OTHER);
        const a = acc[kind][main] || (acc[kind][main] = { mins: [], pieces: 0, minutes: 0 });
        a.mins.push(N(s.ranMins) / qty); a.pieces += qty; a.minutes += N(s.ranMins);
    });
    const shape = (o) => Object.fromEntries(Object.entries(o).map(([c, a]) => [c, { perPiece: a.pieces ? a.minutes / a.pieces : null, median: median(a.mins), pieces: a.pieces, coats: a.mins.length }]));
    return { sprayed: shape(acc.sprayed), handFinished: shape(acc.handFinished) };
}

/** The oven, day by day: loads baked and how much of the working day it was busy (first punch → last punch). A step left
 *  running (overrun) neither counts as a load nor stretches the day — one left on overnight made a 26-hour day. */
export function ovenByDayOf({ steps = [], fromMs, toMs }) {
    const days = new Map();
    steps.forEach(s => {
        if (!s || s.overrun || s.endMs < fromMs || s.endMs >= toMs) return;
        const d = dateKeyOf(s.startMs);
        const end = Math.min(s.endMs, dayStartOf(addDays(d, 1)));
        if (!days.has(d)) days.set(d, { loads: 0, ivs: [], first: s.startMs, last: end });
        const x = days.get(d); x.first = Math.min(x.first, s.startMs); x.last = Math.max(x.last, end);
        if (s.oven) { x.loads += 1; x.ivs.push([s.startMs, end]); }
    });
    return [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, x]) => {
        const iv = x.ivs.sort((a, b) => a[0] - b[0]).reduce((acc, [s, e]) => { const l = acc[acc.length - 1]; if (l && s <= l[1]) l[1] = Math.max(l[1], e); else acc.push([s, e]); return acc; }, []);
        const busy = iv.reduce((t, [s, e]) => t + (e - s), 0) / MIN;
        const span = (x.last - x.first) / MIN;
        return { date, loads: x.loads, busyMins: busy, dayMins: span, busyShare: span > 0 ? Math.min(1, busy / span) : null };
    });
}

// ── the stations (Stuart 2026-10-22: "whom ran it last week vs this week for each station that will paint a clearer
// picture") ── who worked the spin machine, the booth, the poles and the hand bench, day by day. A setup counts at the
// station it loads for; a bake is the oven's, not a person's station.
export const STATION = { SPIN: 'spin', BOOTH: 'booth', POLES: 'poles', HAND: 'hand' };
export const STATIONS = [STATION.SPIN, STATION.BOOTH, STATION.POLES, STATION.HAND];
export const STATION_LABEL = { spin: 'Spin machine', booth: 'Booth', poles: 'Poles', hand: 'Hand finish' };
/** The station a step worked at: a hand coat (small parts or pole) the hand bench's, a pole spray the poles', else the order's spray station. */
export const stationOf = (task, wo) => {
    const t = String(task || '');
    if (t === 'hand' || t === 'poleHand') return STATION.HAND;
    if (t.startsWith('pole')) return STATION.POLES;
    return sprayStationOf(wo) === SPRAY_STATIONS.BOOTH ? STATION.BOOTH : STATION.SPIN;
};
const isCoat = (task) => KIND_OF_TASK[task] === 'sprayed' || KIND_OF_TASK[task] === 'handFinished';
const isWork = (task) => isCoat(task) || KIND_OF_TASK[task] === 'setup';
const realStep = (s) => s && !s.short && !s.overrun;
const unionMins = (ivs) => ivs.slice().sort((a, b) => a[0] - b[0]).reduce((acc, [a, b]) => { const l = acc[acc.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else acc.push([a, b]); return acc; }, []).reduce((t, [a, b]) => t + (b - a), 0) / MIN;

/**
 * WHAT A STEP IS WORTH — the crew's usual time for that step, at that station, for a batch that size: the median of every
 * real punch of that kind (2026-10-22). Pieces alone mislead — time does not grow piece by piece (a 300-chip booth coat
 * took 65 minutes, not 300 × the 4 minutes a three-bracket coat takes a piece), and the floor's flat spin standard
 * (4 min) is half what a sled really takes. A band with fewer than WORTH_MIN_REAL real punches is worth the floor's own
 * standard for the step (Production Times). → { worthOf(step) → minutes, table: [{ key, task, station, band, mins, n }] }
 */
export const SIZE_BANDS = [{ max: 5, label: '1–5' }, { max: 20, label: '6–20' }, { max: 60, label: '21–60' }, { max: 150, label: '61–150' }, { max: Infinity, label: '151+' }];
export const bandOf = (qty) => SIZE_BANDS.find(b => qty <= b.max).label;
export const WORTH_MIN_REAL = 3;
export function stepWorthOf({ steps = [], wosById = {}, typeOfCode } = {}) {
    const keyOf = (s) => { const wo = wosById[s.woId]; const qty = piecesOfStep(s.task, wo, s.endMs, typeOfCode); return qty ? { key: `${s.task}|${stationOf(s.task, wo)}|${bandOf(qty)}`, qty } : null; };
    const by = {};
    steps.forEach(s => {
        if (!s || !s.person || !realStep(s) || !isWork(s.task)) return;
        const k = keyOf(s); if (!k) return;
        (by[k.key] = by[k.key] || []).push(N(s.ranMins));
    });
    const table = Object.entries(by).map(([key, xs]) => { const [task, station, band] = key.split('|'); return { key, task, station, band, mins: median(xs), n: xs.length }; });
    const worth = Object.fromEntries(table.filter(t => t.n >= WORTH_MIN_REAL).map(t => [t.key, t.mins]));
    const worthOf = (s) => {
        if (!s || !s.person || !isWork(s.task)) return 0;
        const k = keyOf(s); if (!k) return 0;
        return worth[k.key] != null ? worth[k.key] : N(s.normalMins);
    };
    return { worthOf, table: table.sort((a, b) => (a.key < b.key ? -1 : 1)) };
}

/**
 * The stations between two times →
 *   people   [{ station, who, days, steps, real, setUp, coats, mins, orders }] — coats = pieces sprayed or hand-finished
 *            there (each coat counts), setUp = pieces loaded; mins = real punches' minutes
 *   days     [{ date, stations: { spin: [{ who, coats, steps }], … } }] — who coated what, each day
 *   spin     [{ date, sprays, coats, rings, busyMins, firstMs, lastMs, operators, gaps: [{ fromMs, toMs, mins, before, after }] }]
 *            — the spin machine's day: its sprays, how long it was spraying, and every stretch of GAP_MINS or more with no spray
 */
export const GAP_MINS = 45;
export function stationsOf({ steps = [], wosById = {}, typeOfCode, fromMs, toMs }) {
    const mine = steps.filter(s => s && s.person && isWork(s.task) && s.startMs >= fromMs && s.startMs < toMs)
        .map(s => { const wo = wosById[s.woId]; return { ...s, wo, station: stationOf(s.task, wo), qty: piecesOfStep(s.task, wo, s.endMs, typeOfCode), date: dateKeyOf(s.startMs) }; })
        .sort((a, b) => a.startMs - b.startMs);
    const people = new Map();
    mine.forEach(s => {
        const k = `${s.station}|${s.who}`;
        const p = people.get(k) || { station: s.station, who: s.who, days: new Set(), steps: 0, real: 0, setUp: 0, coats: 0, mins: 0, orders: new Set() };
        p.days.add(s.date); p.steps += 1; p.orders.add(s.woId);
        if (realStep(s)) { p.real += 1; p.mins += N(s.ranMins); }
        if (isCoat(s.task)) p.coats += s.qty; else p.setUp += s.qty;
        people.set(k, p);
    });
    const days = new Map();
    mine.filter(s => isCoat(s.task)).forEach(s => {
        const d = days.get(s.date) || { date: s.date, stations: {} };
        const list = d.stations[s.station] || (d.stations[s.station] = []);
        const p = list.find(x => x.who === s.who) || (list.push({ who: s.who, coats: 0, steps: 0 }), list[list.length - 1]);
        p.coats += s.qty; p.steps += 1;
        days.set(s.date, d);
    });
    days.forEach(d => Object.values(d.stations).forEach(l => l.sort((a, b) => b.coats - a.coats)));
    const spinDays = new Map();
    mine.filter(s => s.task === 'spinSpray' && s.station === STATION.SPIN).forEach(s => {
        const d = spinDays.get(s.date) || { date: s.date, list: [] }; d.list.push(s); spinDays.set(s.date, d);
    });
    const spin = [...spinDays.values()].map(({ date, list }) => {
        const ends = list.map(s => (s.overrun ? s.startMs + N(s.normalMins) * MIN : s.endMs));
        const gaps = [];
        for (let i = 1; i < list.length; i++) {
            const from = Math.max(...ends.slice(0, i)), to = list[i].startMs, mins = (to - from) / MIN;
            if (mins >= GAP_MINS) gaps.push({ fromMs: from, toMs: to, mins, before: list[i - 1].who, after: list[i].who });
        }
        const rings = list.reduce((t, s) => { const ps = piecesOfOrder(s.wo, { typeOfCode }).filter(x => x.category !== CATEGORY.POLES); const all = ps.reduce((u, x) => u + x.qty, 0); const r = ps.filter(x => x.category === CATEGORY.RINGS).reduce((u, x) => u + x.qty, 0); return t + (all ? s.qty * r / all : 0); }, 0);
        return {
            date, sprays: list.length, coats: list.reduce((t, s) => t + s.qty, 0), rings: Math.round(rings),
            busyMins: unionMins(list.filter(realStep).map(s => [s.startMs, s.endMs])),
            firstMs: list[0].startMs, lastMs: Math.max(...ends), operators: [...new Set(list.map(s => s.who))], gaps,
        };
    });
    return {
        people: [...people.values()].map(p => ({ ...p, days: p.days.size, orders: p.orders.size }))
            .sort((a, b) => STATIONS.indexOf(a.station) - STATIONS.indexOf(b.station) || b.coats - a.coats),
        days: [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
        spin: spin.sort((a, b) => (a.date < b.date ? -1 : 1)),
    };
}

/** What the spin machine sprayed — coats, and the ring coats among them — today, this week, last week to this point and
 *  all last week: the machine's work, before any of those orders is signed off. */
export function spinPeriodsOf({ steps = [], wosById = {}, typeOfCode, nowMs = Date.now() }) {
    const p = periodsOf(nowMs);
    return Object.fromEntries(Object.entries(p).map(([k, r]) => {
        const days = stationsOf({ steps, wosById, typeOfCode, fromMs: r.fromMs, toMs: r.toMs }).spin;
        return [k, { coats: days.reduce((t, d) => t + d.coats, 0), rings: days.reduce((t, d) => t + d.rings, 0) }];
    }));
}
