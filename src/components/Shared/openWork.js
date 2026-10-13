// ── WHAT IS STILL OPEN — ONE READING, AND WHAT KEEPS IT HONEST (Stuart 2026-10-13) ───────────────────────────────────
// "the open work orders screen has 120 open work orders which seems out of sync with real world. how do we make sure it
//  all stays aligned and current" — "go, 14 days is fine".
// Read that day: of the 120, fourteen were shop jobs already COMPLETED (the list looked only at finishing documents, so
// a work order with no finishing half never left it), two were finished in NetSuite and never told to the app (WO11627
// Closed, SO60932 Billed — as WO11578 had been), eighteen were display rows correctly waiting for their display to
// ship, and some two dozen had simply sat for weeks with nobody asked. Three things keep it current, all from this file:
//   1. openWorkOf     — the list itself: a work order is its RTG record, its finishing document and its shop job read
//                       TOGETHER. Packed, closed, or (with no finishing half) shop-completed is done. Every row is put
//                       in a group, with its age and the last time anything was recorded against it.
//   2. outOfStepOf    — open here, finished in NetSuite: the work order Built / Closed / Cancelled, or the sales order
//                       fully fulfilled, Billed, Closed or Cancelled. Read from NetSuite; a person presses Close.
//   3. noMovementOf   — open, and nothing recorded for fourteen days. A person says "still real" or closes it.
// Nothing here closes anything by itself. Pure, except fetchNsStatuses. scripts/openWork.test.mjs asserts it.
import { isClosedState, isDoneState } from './orderLifecycle.js';

const S = (v) => String(v == null ? '' : v).trim();
const U = (v) => S(v).toUpperCase();
export const msOf = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis()
    : (v && typeof v.seconds === 'number' ? v.seconds * 1000 : (typeof v === 'number' ? v : (typeof v === 'string' && v ? (Date.parse(v) || 0) : 0)));
const DAY = 86400000;
const digits = (v) => (/^\d+$/.test(S(v)) ? S(v) : '');

export const OPEN_GROUP = Object.freeze({ FLOOR: 'FLOOR', PACK: 'PACK', DISPLAY: 'DISPLAY', SHOP: 'SHOP', PARKED: 'PARKED' });
export const OPEN_GROUP_LABEL = Object.freeze({
    FLOOR: 'On the finishing floor', PACK: 'Finished — waiting to pack', DISPLAY: 'Display rows — finished, waiting for the display to ship',
    SHOP: 'On the shop floor', PARKED: 'Parked in RTG — not released',
});
const GROUP_ORDER = ['FLOOR', 'PACK', 'SHOP', 'PARKED', 'DISPLAY'];
export const NO_MOVEMENT_DAYS = 14;

// The stamps that mean a PERSON or a FLOOR did something — never a refresh, a repair or an archive sweep.
const FIN_MOVES = ['createdAt', 'dispatchedAt', 'sentToPickPackAt', 'pickedAt', 'stagedAt', 'gatheredAt', 'sprayStationAt', 'lastCoatTime', 'lastPoleCoatTime',
    'completedAt', 'forceCompletedAt', 'packedAt', 'returnedToQueueAt', 'customFabAt', 'spinLoadQtyAt', 'resetAt', 'urgentAt', 'openConfirmedAt'];
const HQ_MOVES = ['createdAt', 'dispatchedAt', 'floorUpdatedAt', 'floorCompletedAt', 'millCompletedAt', 'rodCutDoneAt', 'openConfirmedAt'];
const SHOP_MOVES = ['createdAt', 'startedAt', 'completedAt', 'phosAt', 'reopenedAt', 'heldAt', 'heldClearedAt', 'openConfirmedAt'];
const lastOf = (d, keys) => (d ? Math.max(0, ...keys.map(k => msOf(d[k]))) : 0);
const lastTask = (fin) => (fin ? Math.max(0, ...Object.values(fin.tasks || {}).map(t => Math.max(msOf(t && t.startTime), msOf(t && t.completedAt)))) : 0);

const isDisplayOrder = (so, fin) => !!((so && (so.displayRelease || U(so.packMode) === 'DISPLAY')) || (fin && U(fin.packMode) === 'DISPLAY'));
const soOfDoc = (d, soIndex) => {
    const keys = [d && d.soAppId, d && d.salesOrderId, d && d.orderKey, d && d.soId].filter(Boolean).map(String);
    for (const k of keys) { const hit = soIndex.get(k); if (hit) return hit; }
    return null;
};

/**
 * @param hqDocs       hq_work_orders          @param finDocs  fin_workorders
 * @param shopDocs     shop_custom_orders      @param salesOrders  hq_sales_orders (to tell a display row, and for the sales order's NetSuite id)
 * @param refOf        (doc) → the number people know it by
 * @returns rows, grouped then oldest first:
 *   { key, hq, fin, shop, so, lead, ref, brand, item, qty, group, where, createdAt, ageDays, lastMoveAt, idleDays, nsWoId, nsWoTran, soNsId, soRef }
 */
export function openWorkOf({ hqDocs = [], finDocs = [], shopDocs = [], salesOrders = [], now = Date.now(), refOf = (d) => (d && (d.nsWoTran || d.woDisplayId || d.id)) || '' } = {}) {
    const finById = new Map((finDocs || []).filter(Boolean).map(d => [String(d.id), d]));
    const shopById = new Map((shopDocs || []).filter(Boolean).map(d => [String(d.id), d]));
    const soIndex = new Map();
    (salesOrders || []).filter(Boolean).forEach(o => { soIndex.set(String(o.id), o); if (o.soId) soIndex.set(String(o.soId), o); });
    const seenFin = new Set();
    const out = [];
    const push = (hq, fin) => {
        const lead = fin || hq;
        // The shop job of this work order: the record's own (SHOP-<record id>), else the finishing document's sibling.
        const shop = (hq && shopById.get(`SHOP-${hq.id}`)) || (fin && fin.shopSiblingId && shopById.get(String(fin.shopSiblingId))) || (fin && shopById.get(`SHOP-${fin.id}`)) || null;
        const shopLive = !!shop && !shop.deleted && !isClosedState(shop);
        const shopDone = !!shop && isDoneState(shop);
        let group, where;
        if (fin) {
            const so = soOfDoc(fin, soIndex) || (hq ? soOfDoc(hq, soIndex) : null);
            if (S(fin.currentPhase) === 'Complete') { group = isDisplayOrder(so, fin) ? OPEN_GROUP.DISPLAY : OPEN_GROUP.PACK; where = fin.pickOnly ? 'picked — not packed' : 'finished — not packed'; }
            else { group = OPEN_GROUP.FLOOR; where = `${S(fin.currentPhase) || '—'}${fin.currentPhase === 'Setup' ? '' : ` · coat ${(Number(fin.currentStepIndex) || 0) + 1}`}`; }
        } else if (shop) {
            if (shopDone || !shopLive) return;                       // a shop-only work order whose shop job is done is DONE
            group = OPEN_GROUP.SHOP; where = `shop · ${S(shop.status) || 'Pending'}`;
        } else if (S(hq.status) === 'Approved') { group = OPEN_GROUP.PARKED; where = 'parked — not released'; }
        else { group = OPEN_GROUP.PARKED; where = `${S(hq.status) || '—'} — no floor document found`; }
        const so = soOfDoc(lead, soIndex) || (hq && hq !== lead ? soOfDoc(hq, soIndex) : null);
        const createdAt = msOf(lead.createdAt) || msOf(hq && hq.createdAt) || 0;
        const lastMoveAt = Math.max(lastOf(fin, FIN_MOVES), lastTask(fin), lastOf(hq, HQ_MOVES), lastOf(shopLive ? shop : null, SHOP_MOVES), createdAt);
        const days = (t) => (t ? Math.max(0, Math.floor((now - t) / DAY)) : null);
        out.push({
            key: String(lead.id), hq: hq || null, fin: fin || null, shop: shop || null, so: so || null, lead,
            ref: S(refOf(fin && (fin.nsWoTran || fin.woDisplayId) ? fin : (hq || fin))) || String(lead.id),
            brand: S(lead.brand || (hq && hq.brand) || '').toLowerCase(),
            item: S((fin && (fin.stockErpId || fin.itemCode)) || (hq && (hq.itemCode || hq.stockErpId || hq.erpId)) || (fin && fin.type) || (hq && hq.type) || ''),
            qty: Number((fin && fin.totalParts) || (hq && (hq.totalParts || hq.qty)) || 0) || 0,
            group, where, createdAt, ageDays: days(createdAt), lastMoveAt, idleDays: days(lastMoveAt),
            nsWoId: digits((fin && fin.nsWoId) || (hq && hq.nsWoId)), nsWoTran: S((fin && fin.nsWoTran) || (hq && hq.nsWoTran)),
            soNsId: U(lead.orderType) === 'STOCK' ? '' : digits(so && so.nsInternalId), soRef: so ? S(so.soId || so.id) : '',
        });
    };
    (hqDocs || []).filter(Boolean).forEach(hq => {
        if (hq.deleted || ['Closed', 'Cancelled', 'Done', 'Deleted'].includes(S(hq.status))) return;
        const fin = finById.get(String((hq.finPayload && hq.finPayload.id) || hq.id)) || null;
        if (fin) seenFin.add(String(fin.id));
        if (fin && (fin.deleted || S(fin.currentPhase) === 'Closed' || fin.packStatus === 'Packed')) return;   // done and put away = not open
        push(hq, fin);
    });
    (finDocs || []).filter(Boolean).forEach(fin => {
        if (seenFin.has(String(fin.id)) || fin.deleted || S(fin.currentPhase) === 'Closed' || fin.packStatus === 'Packed') return;
        push(null, fin);
    });
    return out.sort((a, b) => (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) || ((a.createdAt || 0) - (b.createdAt || 0)));
}

/** Counts per group, in the order the list shows them. */
export const openGroupCounts = (rows = []) => GROUP_ORDER.map(g => ({ group: g, label: OPEN_GROUP_LABEL[g], count: (rows || []).filter(r => r.group === g).length })).filter(x => x.count);

// ── OPEN HERE, FINISHED IN NETSUITE ──────────────────────────────────────────────────────────────────────────────────
// NetSuite's status is a bare code (never "WorkOrd:G"); read with the transaction's type so one letter is never read as
// another record's. Work order: G Built · H Closed · C Cancelled. Sales order: F Pending Billing (everything has been
// fulfilled) · G Billed · H Closed · C Cancelled. Anything else — Released, In Process, Pending or Partially Fulfilled —
// is still open there, and says nothing.
const WO_DONE = { G: 'Built', H: 'Closed', C: 'Cancelled' };
const SO_DONE = { F: 'fully fulfilled', G: 'Billed', H: 'Closed', C: 'Cancelled' };
const bare = (code) => { const c = U(code); const i = c.lastIndexOf(':'); return i >= 0 ? c.slice(i + 1) : c; };
/** The word for a finished NetSuite transaction; '' while it is still open there (or the type is not one we read). */
export const nsDoneWord = (st) => {
    if (!st) return '';
    const t = U(st.type), c = bare(st.code);
    if (t === 'WORKORD') return WO_DONE[c] || '';
    if (t === 'SALESORD') return SO_DONE[c] || '';
    return '';
};
/** Every NetSuite transaction the open rows hang on — their work orders and their sales orders. */
export const nsIdsOfRows = (rows = []) => [...new Set((rows || []).flatMap(r => [r.nsWoId, r.soNsId]).filter(Boolean))];
export const nsStatusSql = (ids = []) => {
    const list = [...new Set((ids || []).map(digits).filter(Boolean))];
    return list.length ? `SELECT t.id AS id, t.tranid AS tranid, t.type AS ttype, t.status AS code FROM Transaction t WHERE t.id IN (${list.join(',')})` : '';
};
/** SuiteQL rows → { '<id>': { tran, type, code } } */
export const nsStatusOf = (items = []) => {
    const out = {};
    (items || []).forEach(r => { const id = digits(r && r.id); if (id) out[id] = { tran: S(r.tranid), type: S(r.ttype), code: bare(r.code) }; });
    return out;
};
/**
 * @param nsStatus  { '<NetSuite id>': { tran, type, code } } — null when it could not be read (then nothing is said)
 * @returns the rows NetSuite has finished, each with `why`
 */
export function outOfStepOf(rows = [], nsStatus = null) {
    if (!nsStatus) return [];
    return (rows || []).map(r => {
        const wo = r.nsWoId ? nsStatus[r.nsWoId] : null, so = r.soNsId ? nsStatus[r.soNsId] : null;
        const woWord = nsDoneWord(wo), soWord = nsDoneWord(so);
        if (!woWord && !soWord) return null;
        const why = [woWord ? `NetSuite work order ${(wo && wo.tran) || r.nsWoTran || r.nsWoId} is ${woWord}` : '', soWord ? `NetSuite sales order ${(so && so.tran) || r.soRef} is ${soWord}` : ''].filter(Boolean).join(' · ');
        return { ...r, why };
    }).filter(Boolean);
}

// ── OPEN, AND NOTHING RECORDED FOR FOURTEEN DAYS ─────────────────────────────────────────────────────────────────────
// A display row waiting for its display to ship is waiting on purpose and is not listed. `except` = keys already said
// to be out of step (one row, one list). "Still real" stamps openConfirmedAt, which counts as movement.
export function noMovementOf(rows = [], { days = NO_MOVEMENT_DAYS, except = [] } = {}) {
    const skip = new Set((except || []).map(String));
    return (rows || []).filter(r => r.group !== OPEN_GROUP.DISPLAY && !skip.has(String(r.key)) && r.idleDays != null && r.idleDays >= days)
        .sort((a, b) => (b.idleDays - a.idleDays) || String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }));
}
/** The document a "still real" is written on, and the stamp. */
export const stillRealTargetOf = (row) => (row && row.fin ? { coll: 'fin_workorders', id: row.fin.id } : row && row.hq ? { coll: 'hq_work_orders', id: row.hq.id } : null);
export const stillRealStamp = (by, at = Date.now()) => ({ openConfirmedAt: at, openConfirmedBy: S(by) });

/** Both lists as plain text, for the Day summary's copy. '' when both are empty. */
export function openWorkText({ outOfStep = [], noMovement = [], days = NO_MOVEMENT_DAYS } = {}) {
    const lines = [];
    if (outOfStep.length) {
        lines.push('OUT OF STEP — open here, finished in NetSuite');
        outOfStep.forEach(r => lines.push(`   ${r.ref}${r.item ? ` · ${r.item}` : ''}${r.qty ? ` ×${r.qty}` : ''} — ${r.where} — ${r.why}`));
    }
    if (noMovement.length) {
        if (lines.length) lines.push('');
        lines.push(`NO MOVEMENT — open, nothing recorded for ${days} days or more`);
        noMovement.forEach(r => lines.push(`   ${r.ref}${r.item ? ` · ${r.item}` : ''}${r.qty ? ` ×${r.qty}` : ''} — ${r.where} — ${r.idleDays} days`));
    }
    return lines.join('\n');
}

/** The read. { map, known } — known false = it failed, and nothing is called out of step. */
export const fetchNsStatuses = async (ids = [], { chunk = 300 } = {}) => {
    const list = [...new Set((ids || []).map(digits).filter(Boolean))];
    if (!list.length) return { map: {}, known: true };
    const { nsProxyFetch } = await import('./nsProxy');
    const map = {};
    try {
        for (let i = 0; i < list.length; i += chunk) {
            const resp = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q: nsStatusSql(list.slice(i, i + chunk)) } });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(JSON.stringify(data).slice(0, 200));
            Object.assign(map, nsStatusOf(data.items || []));
        }
        return { map, known: true };
    } catch (e) {
        console.warn('NetSuite status read failed — nothing is called out of step:', e);
        return { map: {}, known: false };
    }
};
