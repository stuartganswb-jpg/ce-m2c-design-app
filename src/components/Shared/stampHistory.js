// ── WHO DID WHAT, WHEN — the history behind each stamp on "Where is it?" (Stuart 2026-10-20) ────────────────────────────
// "each stamp should be a link we can click for the details so we could see right there that Grace had performed all those
//  steps, we need an easy way to see whom did what, when and i think there is the perfect spot".
//
// The day it was asked for, WO11579 read Complete in the WMS pack queue while the office said nothing had been painted; the
// answer sat in the finishing floor's own log — three coats, nine steps, three advances, 47 minutes, one PIN — and no screen
// showed it. This builds that answer for one document from what the app already keeps; nothing new is recorded:
//   · the FLOOR — every punch in fin_logs under the document's id (start · complete · stop · coat advance · spin load ·
//     station · the stops, overrides and punch warnings the floor raised at the time, kept in their own words). The coat
//     each step belongs to is counted from the advances, in order, as the floor counted them;
//   · the WAREHOUSE — the document's own stamps: released to the pick, picked, returned to the shelf, cleared, matched and
//     staged, each packed line, packed / put away / gathered; and every NetSuite write the queue holds for it (ns_outbox,
//     written back to this document), coloured by the audit log's own rule (Shared/auditLog.flagsOf);
//   · the CUSTOM SHOP — its job's start, finish (to the plater or not) and reopen;
//   · the ORDER — created, released from RTG, closed.
// What is NOT recorded is said, never invented: who staged an order (only when), and a step run from a tablet card is logged
// only when the floor flagged it (Manual Control logs every tap — every step of the 30 days to 2026-10-20 went through it).
// Pure. Harness: scripts/stampHistory.test.mjs.

import { rowFromOutbox, flagsOf, msOf } from './auditLog.js';
import { dryAwareLabel } from './airDry.js';

const PARTS_TASKS = ['spinSetup', 'spinSpray', 'spinBake', 'hand', 'parts'];
const POLE_TASKS = ['poleSpray', 'poleBake', 'poleHand', 'poles'];
const STEP_WORD = { spinSetup: 'Setup', spinSpray: 'Spray', spinBake: 'Bake', hand: 'Hand finish', poleSpray: 'Pole spray', poleBake: 'Pole bake', poleHand: 'Pole hand finish' };
const STATION_WORD = { MANUAL: 'Manual Control', CARD: 'tablet card', SPIN: 'spin machine', BOOTH: 'spray booth', OVEN: 'oven', POLES: 'pole rack', HAND: 'hand bench', RED: 'red sled', BLUE: 'blue sled' };

/** Which stamp a row belongs to. ALL = every stamp's view (a reset); FLOOR = both finishing tracks. */
export const PART = Object.freeze({ PARTS: 'PARTS', POLES: 'POLES', FLOOR: 'FLOOR', FULFIL: 'FULFIL', CUSTOM: 'CUSTOM', ORDER: 'ORDER', ALL: 'ALL' });

const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const afterDash = (msg) => { const s = String(msg || ''); const i = s.indexOf(' — '); return i >= 0 ? s.slice(i + 3).trim() : ''; };
const streamOf = (task) => (POLE_TASKS.includes(task) ? PART.POLES : PARTS_TASKS.includes(task) ? PART.PARTS : PART.FLOOR);
const stepWord = (task, wo) => dryAwareLabel(task, wo, null, STEP_WORD[task] || task || 'step');
const placeWord = (station) => STATION_WORD[String(station || '').toUpperCase()] || String(station || '');

/** The floor's punches for one document, in order, with the coat each belongs to. */
export function floorRowsOf(wo, finLogs = [], { recipeLen = 0, poleRecipeLen } = {}) {
    const logs = (finLogs || []).filter(Boolean).map(l => ({ ...l, __at: N(l.at) || msOf(l.t) || 0 })).sort((a, b) => a.__at - b.__at);
    const coat = { PARTS: 1, POLES: 1 };
    const lenOf = (s) => (s === PART.POLES ? (poleRecipeLen !== undefined ? poleRecipeLen : recipeLen) : recipeLen);
    return logs.map((l, i) => {
        const action = String(l.action || '').toUpperCase();
        const stream = streamOf(String(l.task || ''));
        const c = stream === PART.FLOOR ? null : coat[stream];
        const ran = l.elapsedMs != null && N(l.elapsedMs) != null ? N(l.elapsedMs) / 60000 : null;
        // Manual Control's start / complete lines carry no station — their own words say it ("MANUAL START · …").
        const where = placeWord(l.station) || (/^MANUAL /.test(String(l.msg || '')) ? STATION_WORD.MANUAL : '');
        const base = { key: `fl:${l.id || i}`, at: l.__at, who: l.u || '', where, ran: null, coat: null, flag: '', part: stream };
        const step = stepWord(l.task, wo);
        switch (action) {
            case 'START': return { ...base, coat: c, what: `▶ ${step} started` };
            case 'COMPLETE': return { ...base, coat: c, ran, what: `✓ ${step} done` };
            case 'STOP': return { ...base, coat: c, ran, what: `■ ${step} stopped` };
            case 'ADVANCE': {
                const m = String(l.msg || '').match(/coat (\d+)/i);
                const done = m ? Number(m[1]) : c;
                if (stream !== PART.FLOOR) coat[stream] = (done || 0) + 1;
                const len = lenOf(stream);
                return { ...base, what: `→ coat ${done || '?'} finished${len && done >= len ? ' — the last coat: finished on the floor' : ''}` };
            }
            case 'LOAD': {
                if (/DONE/i.test(String(l.msg || ''))) coat.PARTS = 1;
                return { ...base, part: PART.PARTS, what: `🌀 ${String(l.msg || 'spin load').replace(/\s*·\s*WO[^\s·—]*/i, '')}` };
            }
            case 'BLOCKED': return { ...base, coat: c, flag: 'stop', what: `⛔ step stop — ${afterDash(l.msg) || 'refused by the floor'}` };
            case 'OVERRIDE': return { ...base, coat: c, flag: 'warn', what: `⚠ manager override — ${afterDash(l.msg) || 'went ahead despite a step stop'}` };
            case 'PUNCH_WARNING': return { ...base, coat: c, ran, flag: 'warn', what: `⏱ punch warning — ${afterDash(l.msg) || 'flagged'}` };
            case 'RESET': {
                coat.PARTS = 1; coat.POLES = 1;
                // "↩ NOT FINISHED — BACK TO THE FLOOR · <ref> — <why> · <summary>" (orderLifecycle.sendBackToFloor)
                const m = String(l.msg || '').match(/BACK TO THE FLOOR · .*? — (.*)$/);
                return { ...base, part: PART.ALL, flag: 'warn', what: `↩ sent back to the floor — ${m ? m[1] : afterDash(l.msg)}` };
            }
            default: return { ...base, coat: c, what: String(l.msg || [action, l.task].filter(Boolean).join(' · ') || 'floor entry') };
        }
    });
}

/** The warehouse's stamps on the document itself, and every NetSuite write queued for it. */
export function warehouseRowsOf(wo, outbox = [], { now = Date.now() } = {}) {
    if (!wo) return [];
    const rows = [];
    const add = (at, who, what, extra = {}) => { const t = msOf(at); if (t) rows.push({ key: `wh:${rows.length}`, at: t, who: who || '', what, where: 'WMS', ran: null, coat: null, flag: '', part: PART.FULFIL, ...extra }); };
    add(wo.sentToPickPackAt, '', '📦 parts pick released to the WMS', { note: 'who released it is not recorded' });
    add(wo.pickedAt, wo.pickedBy, `✓ picked${wo.pickHadSkips ? ' — with skips' : ''}`);
    add(wo.returnedToQueueAt, wo.returnedToQueueBy, `↩ returned to the pick queue${wo.returnedToQueueReason ? ` — ${wo.returnedToQueueReason}` : ''}`);
    add(wo.pickClearedAt, wo.pickClearedBy, '⚠ pick cleared as overtaken — the floor already had the order', { flag: 'warn' });
    add(wo.stagedAt, '', '✓ matched & staged', { note: 'who staged it is not recorded' });
    Object.entries(wo.packedLines || {}).forEach(([k, v]) => { if (v && v.at) add(v.at, v.by, `✓ packed ${k}`); });
    if (wo.packStatus === 'Packed') {
        const away = wo.packMode === 'PUTAWAY' || wo.orderType === 'stock';
        add(wo.packedAt, wo.packedBy, away ? `✓ put away${wo.putawayBin ? ` in ${wo.putawayBin}` : ''}` : '✓ packed');
    }
    add(wo.gatheredAt, wo.gatheredBy, `✓ gathered into its order${wo.gatheredInto ? ` (${wo.gatheredInto})` : ''}`);
    (outbox || []).filter(Boolean).forEach((e, i) => {
        const r = rowFromOutbox(e);
        const level = flagsOf(r, { now }).level;
        const st = r.ns.status ? r.ns.status.toLowerCase() : 'queued';
        rows.push({
            key: `ns:${e.id || i}`, at: r.at || 0, who: r.who, where: `NetSuite · ${r.ns.type}`, ran: null, coat: null, part: PART.FULFIL,
            what: `${r.action || r.ns.type} — ${st}${r.ns.tran ? ` ${r.ns.tran}` : ''}${r.ns.error && level === 'red' ? ` (${String(r.ns.error).slice(0, 140)})` : ''}`,
            flag: level === 'red' ? 'stop' : level === 'orange' ? 'warn' : '',
        });
    });
    return rows;
}

/** The custom shop's job (when the order has one). */
export function customRowsOf(wo, shop = null) {
    const rows = [];
    const add = (at, who, what) => { const t = msOf(at); if (t) rows.push({ key: `cu:${rows.length}`, at: t, who: who || '', what, where: 'shop floor', ran: null, coat: null, flag: '', part: PART.CUSTOM }); };
    if (shop) {
        add(shop.startedAt, shop.startedBy, '▶ shop started');
        add(shop.completedAt, shop.completedBy, shop.status === 'Sent to Plating' ? '✓ shop finished — sent to the plater' : '✓ shop finished');
        add(shop.reopenedAt, shop.reopenedBy, '↩ shop job reopened');
    } else if (wo && wo.hasCustomSibling && wo.customFabAt) {
        add(wo.customFabAt, '', `custom half: ${String(wo.customFabStatus || '').toLowerCase()}`);
    }
    return rows;
}

/** The order's own life: created, released from RTG, force-completed, closed — plus the floor's finish when no punch shows it. */
export function orderRowsOf(wo, { floorRowCount = 0 } = {}) {
    if (!wo) return [];
    const rows = [];
    const add = (at, who, what, extra = {}) => { const t = msOf(at); if (t) rows.push({ key: `or:${rows.length}`, at: t, who: who || '', what, where: 'app', ran: null, coat: null, flag: '', part: PART.ORDER, ...extra }); };
    add(wo.createdAt, wo.createdBy, '✚ order created');
    add(wo.dispatchedAt, wo.dispatchedBy, '→ released from RTG to the floor');
    if (!floorRowCount) add(wo.completedAt, '', '✓ finished on the floor', { part: PART.FLOOR, note: 'no floor punch is logged for it' });
    add(wo.forceCompletedAt, wo.forceCompletedBy, `⚡ force-completed${wo.forceCompleteNsBuildSkipped === true ? ' — marked already built in NetSuite' : ''}`, { part: PART.FLOOR, flag: 'warn' });
    add(wo.closedAt, wo.closedBy, `✕ closed${wo.closedFrom ? ` from ${wo.closedFrom}` : ''}${wo.closeReason ? ` — ${wo.closeReason}` : ''}`);
    return rows;
}

/** Everything known about one document, oldest first. */
export function stampHistoryOf({ wo, finLogs = [], outbox = [], shop = null, recipeLen = 0, poleRecipeLen, now = Date.now() } = {}) {
    if (!wo) return [];
    const floor = floorRowsOf(wo, finLogs, { recipeLen, poleRecipeLen });
    return [
        ...floor,
        ...warehouseRowsOf(wo, outbox, { now }),
        ...customRowsOf(wo, shop),
        ...orderRowsOf(wo, { floorRowCount: floor.length }),
    ].sort((a, b) => (a.at || 0) - (b.at || 0));
}

/**
 * The rows one stamp shows. `keys` = every stamp key the order shows: with both a PARTS and a POLES stamp each shows its own
 * track; a single finishing stamp shows both. The ORDER stamp (a closed order) shows everything.
 */
export function rowsForStamp(rows = [], key = '', keys = []) {
    const split = keys.includes(PART.PARTS) && keys.includes(PART.POLES);
    const want = (p) => {
        if (p === PART.ALL || key === PART.ORDER) return true;
        if (key === PART.PARTS) return p === PART.PARTS || p === PART.FLOOR || (!split && p === PART.POLES);
        if (key === PART.POLES) return p === PART.POLES || p === PART.FLOOR || (!split && p === PART.PARTS);
        return p === key;
    };
    return rows.filter(r => want(r.part));
}

/** The heading for a stamp's history. */
export const STAMP_HEADING = { PARTS: 'Finishing floor', POLES: 'Finishing floor · poles', FULFIL: 'Warehouse & NetSuite', CUSTOM: 'Custom shop', ORDER: 'The whole order' };
