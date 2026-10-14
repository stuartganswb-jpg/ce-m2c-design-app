// ── THE WALLBOARD: WHAT IS HAPPENING NOW, AND WHO IS DOING WELL (Stuart 2026-10-13, phase 2 of the metrics work) ──
// "a new tab for the finishing and wms that will display in large landscape format on a large monitor that will show
// the current status on the left, and a hall of fame and hall of shame and show whom is doing good so they can be
// rewarded and whom is dragging the team down."
//
// LEFT — now, read from the lists each app already holds (no new listener): the finishing floor's running steps by the
// floor's own Live Operator Status reading (Shared/floorActivity.activityOf); the oven as the PRODUCT in the oven and
// the operator FREE (Stuart 2026-10-14: "oven should show the product in there, but the operator is free"); the WMS's
// pick / staging / pack queues as its own tabs list them, and who holds a pick or a pack right now (the claim the WMS
// writes: pickInProgress / packInProgress = { by, startedAt }).
// RIGHT — the week, read from fin_config/wallboard, which HQ → System Admin → Floor Metrics publishes (Shared/
// floorMetrics.wallboardDocOf): names, ranks, scores and the fact behind each — never hours.
//
// Pure — no React, no Firestore. Harness: scripts/wallboard.test.mjs.

import { runningStepsOf, activityOf, isOvenTask, TASK_LABEL, windowOfTask, WINDOW_LABEL } from './floorActivity.js';
import { woRefOf } from './woRef.js';
import { dateKeyOf } from './timecardImport.js';
import { msOf, personKeyOf, isPersonName, GROUP } from './floorMetrics.js';
import { openChoresOf, choreLabelOf } from './floorChores.js';

const MIN = 60000;
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const dueOf = (w) => String((w && (w.needBy || w.reqDate)) || '').slice(0, 10);
const itemOf = (w) => String((w && (w.stockErpId || w.itemCode || w.type)) || '');

/** A claim older than this is a tablet that died mid-pick — the WMS's own line (PickPackApp CLAIM_STALE_MS). */
export const CLAIM_STALE_MS = 4 * 60 * MIN;

// ── the finishing floor, now ──────────────────────────────────────────────────────────────────────────────
/**
 * @param workOrders  the floor's documents (the finishing app's own subscription)
 * @param cfg         the floor's timers (Shared/floorMetrics.floorTimersOf — the Active Floor's figures)
 * @returns { working, oven, crew, counts }
 *   working  hands-on steps and chores running: [{ who, ref, item, step, window, elapsedMins, estMins, state, chore? }]
 *   oven     product in the oven:    [{ ref, item, step, who, elapsedMins, estMins, leftMins, done }]
 *   crew     everyone who touched a step today or is running one: [{ name, state: 'working' | 'free' | 'none', doing, ovenRefs }]
 *   counts   { onFloor, inOven, setupQueue, finishedToday, dueToday, late }
 */
export function floorNowOf({ workOrders = [], cfg = {}, nowMs = Date.now() } = {}) {
    const today = dateKeyOf(nowMs);
    const onFloor = workOrders.filter(w => w && w.currentPhase === 'Painting');
    const running = runningStepsOf(onFloor).map(s => ({ s, a: activityOf(s, { cfg, now: nowMs }) }));
    const working = running.filter(({ s }) => !isOvenTask(s.key)).map(({ s, a }) => ({
        who: String(s.operator || '').trim(), ref: woRefOf(s.wo), item: itemOf(s.wo), step: TASK_LABEL[s.key] || s.key,
        window: WINDOW_LABEL[windowOfTask(s.key, s.wo)] || '', elapsedMins: a.elapsedMins, estMins: a.estMins, state: a.state,
    }));
    // 🧰 chores in between the steps (Shared/floorChores) — someone working, on an order, with no step started
    openChoresOf(workOrders.filter(w => w && w.currentPhase === 'Painting')).forEach(c => working.push({
        who: c.by, ref: woRefOf(c.wo), item: itemOf(c.wo), step: choreLabelOf(c.kind), window: 'Chore', chore: true,
        elapsedMins: c.startedAt ? Math.max(0, Math.floor((nowMs - c.startedAt) / MIN)) : null, estMins: 0, state: 'chore',
    }));
    working.sort((x, y) => (y.elapsedMins || 0) - (x.elapsedMins || 0));
    const oven = running.filter(({ s }) => isOvenTask(s.key)).map(({ s, a }) => ({
        ref: woRefOf(s.wo), item: itemOf(s.wo), step: TASK_LABEL[s.key] || s.key, who: String(s.operator || '').trim(),
        elapsedMins: a.elapsedMins, estMins: a.estMins,
        leftMins: a.estMins > 0 && a.elapsedMins != null ? Math.max(0, a.estMins - a.elapsedMins) : null,
        done: a.estMins > 0 && a.elapsedMins != null && a.elapsedMins >= a.estMins,
    })).sort((x, y) => (x.leftMins == null ? 1e9 : x.leftMins) - (y.leftMins == null ? 1e9 : y.leftMins));

    // the crew: who started or completed a step today (the steps' own stamps), and who is running one now
    const crew = new Map();
    const see = (name) => { if (!isPersonName(name)) return; const k = personKeyOf(name); if (!crew.has(k)) crew.set(k, { name: String(name).trim(), doing: null, ovenRefs: [] }); };
    const isClosed = (w) => w && (w.currentPhase === 'Closed' || w.stepStatus === 'Closed' || w.status === 'Closed');
    workOrders.filter(w => w && !isClosed(w)).forEach(w => Object.values(w.tasks || {}).forEach(t => {
        if (!t) return;
        if (t.assignedTo && msOf(t.startTime) && dateKeyOf(msOf(t.startTime)) === today) see(t.assignedTo);
        if (t.completedBy && msOf(t.completedAt) && dateKeyOf(msOf(t.completedAt)) === today) see(t.completedBy);
    }));
    working.forEach(x => { see(x.who); const c = crew.get(personKeyOf(x.who)); if (c && !c.doing) c.doing = x; });
    oven.forEach(x => { see(x.who); const c = crew.get(personKeyOf(x.who)); if (c) c.ovenRefs.push(x.ref); });
    const crewList = [...crew.values()].map(c => ({ ...c, state: c.doing ? 'working' : c.ovenRefs.length ? 'free' : 'none' }))
        .sort((a, b) => ['working', 'free', 'none'].indexOf(a.state) - ['working', 'free', 'none'].indexOf(b.state) || a.name.localeCompare(b.name));

    return {
        working, oven, crew: crewList,
        counts: {
            onFloor: onFloor.length,
            inOven: oven.length,
            setupQueue: workOrders.filter(w => w && (w.currentPhase === 'Setup' || w.currentPhase === 'setup')).length,
            finishedToday: workOrders.filter(w => w && w.currentPhase === 'Complete' && w.pickOnly !== true && msOf(w.completedAt) && dateKeyOf(msOf(w.completedAt)) === today).length,
            dueToday: onFloor.filter(w => dueOf(w) === today).length,
            late: onFloor.filter(w => dueOf(w) && dueOf(w) < today).length,
        },
    };
}

// ── the pick / pack bench, now ────────────────────────────────────────────────────────────────────────────
/**
 * @param openPicks  the WMS's Awaiting Pick list (its own isOpenPick)
 * @param staging    its Awaiting Staging list
 * @param packQueue  its pack queue
 * @param docs       every document the WMS holds (finishing documents + its stocked sales orders) — claims and today's stamps
 * @param refOf      the WMS's own name for an order (PickPackApp packRef)
 * @returns { claims, today, latePicks, oldestPacks, counts }
 */
export function wmsNowOf({ openPicks = [], staging = [], packQueue = [], docs = [], refOf = woRefOf, nowMs = Date.now() } = {}) {
    const today = dateKeyOf(nowMs);
    const seen = new Set();
    const all = docs.filter(d => { if (!d) return false; const k = d.id || refOf(d); if (seen.has(k)) return false; seen.add(k); return true; });
    const claims = [];
    all.forEach(d => [['pick', d.pickInProgress], ['pack', d.packInProgress]].forEach(([kind, c]) => {
        if (!c || !isPersonName(c.by)) return;
        const since = N(c.startedAt);
        claims.push({ who: String(c.by).trim(), kind, ref: refOf(d), mins: since ? Math.max(0, Math.round((nowMs - since) / MIN)) : null, stale: !!since && nowMs - since > CLAIM_STALE_MS });
    }));
    claims.sort((a, b) => (b.mins || 0) - (a.mins || 0));
    const people = new Map();
    const tally = (name, kind) => { if (!isPersonName(name)) return; const k = personKeyOf(name); const p = people.get(k) || { name: String(name).trim(), picks: 0, packs: 0 }; p[kind] += 1; people.set(k, p); };
    all.forEach(d => {
        if (msOf(d.pickedAt) && dateKeyOf(msOf(d.pickedAt)) === today) tally(d.pickedBy, 'picks');
        if (msOf(d.packedAt) && dateKeyOf(msOf(d.packedAt)) === today) tally(d.packedBy, 'packs');
    });
    const todayList = [...people.values()].sort((a, b) => (b.picks + b.packs) - (a.picks + a.packs) || a.name.localeCompare(b.name));
    const latePicks = openPicks.filter(d => dueOf(d) && dueOf(d) < today).map(d => ({ ref: refOf(d), due: dueOf(d) })).sort((a, b) => a.due.localeCompare(b.due));
    const oldestPacks = packQueue.map(d => ({ ref: refOf(d), since: N(d.packedReadyAt || msOf(d.completedAt) || msOf(d.createdAt)) }))
        .filter(x => x.since).sort((a, b) => a.since - b.since).slice(0, 5)
        .map(x => ({ ref: x.ref, waitingMins: Math.max(0, Math.round((nowMs - x.since) / MIN)) }));
    return {
        claims, today: todayList, latePicks, oldestPacks,
        counts: {
            awaitingPick: openPicks.length, picking: claims.filter(c => c.kind === 'pick').length, staging: staging.length,
            readyToPack: packQueue.length, packing: claims.filter(c => c.kind === 'pack').length,
            pickedToday: todayList.reduce((t, p) => t + p.picks, 0), packedToday: todayList.reduce((t, p) => t + p.packs, 0),
        },
    };
}

// ── the week, as Floor Metrics published it ───────────────────────────────────────────────────────────────
/** One board's half of the published wallboard → { week, weekEnd, publishedAt, publishedBy, ranked, fame, shame } | null */
export function boardHalfOf(published, group) {
    if (!published || !published.week || ![GROUP.FINISHING, GROUP.WMS].includes(group)) return null;
    return {
        week: published.week, weekEnd: published.weekEnd || '', publishedAt: N(published.publishedAt), publishedBy: published.publishedBy || '',
        ranked: ((published.groups || {})[group] || []).slice().sort((a, b) => N(a.rank) - N(b.rank)),
        fame: ((published.fame || {})[group] || []), shame: ((published.shame || {})[group] || []),
    };
}

/** Minutes, said the way a wall says them: "8 min", "1 h 20". */
export const sayMins = (m) => {
    if (m == null || !Number.isFinite(m)) return '—';
    const r = Math.max(0, Math.round(m));
    return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`;
};
