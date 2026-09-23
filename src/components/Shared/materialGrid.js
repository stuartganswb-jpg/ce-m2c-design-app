// ── THE MATERIAL PICTURE ON THE FLOOR CARD (Stuart 2026-09-23) ──────────────────────────────
// "look at the order cards, there is no way anyone on the floor will ever touch these as they are
//  so confusing, not clear what we have on hand, what is backordered, etc. … list the parts in a
//  small grid with on hand and backordered so it is crystal clear what is going on."
//
// Every document the route writes carried a parts list (code × quantity) and a scatter of TEXT
// stamps — a hold sentence, a backorder sentence, a "waiting on components" gate, a convert
// suggestion, a cut note. The numbers that make it clear — on hand against need, short, on order —
// were computed at release by the plan, used to raise the make-up orders, and thrown away. The
// floor never got them.
//
// THE RULE: computed ONCE at release by the one writer (Shared/workOrderCreate.parkWorkOrder, and
// RTG's whole-order split), stamped on EVERY document that writer produces (the RTG record, the
// finishing document, the shop sibling), drawn by ONE renderer (Shared/MaterialGridCard) on all
// three floor apps. No floor tablet reads NetSuite for it. RTG refreshes the stock columns once a
// morning (Stuart: "the stock situation in a week will look stale") on documents nothing has been
// pulled for yet — refreshMaterialRows / materialRefreshable below.
//
// ⚠ This file and MaterialGridCard.js must keep DIFFERENT names: macOS is case-insensitive, and a
// "MaterialGrid.js" beside "materialGrid.js" is the same file (2026-09-23, learned the hard way).
//
// One row per pull code, need summed across configurations:
//   { code, name, need, onHand, short, onOrder, unit, state, coveredBy, coverCodes }
//   state COVERED  — the shelf covers the need (green)
//         SHORT    — it does not; coveredBy says what was raised for the gap (red)
//         UNVERIFIED — the shelf could not be read, or the units disagree; onHand/short are null,
//                      never a number that looks like a fact (grey)
// Pure. scripts/materialGrid.test.mjs asserts it.
import { classifyLine } from './backorder.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const MATERIAL_STATE = { COVERED: 'COVERED', SHORT: 'SHORT', UNVERIFIED: 'UNVERIFIED' };

const stateOf = (onHand, need) => (onHand == null ? MATERIAL_STATE.UNVERIFIED : (onHand >= need ? MATERIAL_STATE.COVERED : MATERIAL_STATE.SHORT));

/** What one make-up action means to the person holding the card. */
const actionText = (a, nextShopId) => {
    const k = U(a && a.kind);
    if (k === 'CONVERT') return `⇄ convert ${N(a.qty)} × ${U(a.base)} → ${U(a.target)}${N(a.rawHave) < N(a.qty) ? ` (raw short ${N(a.qty) - N(a.rawHave)})` : ''}`;
    if (k === 'SHOP') { const id = nextShopId(); return `🏭 shop${id ? ` ${id}` : ''} · ${N(a.qty)} × ${U(a.code)}`; }
    if (k === 'PO') return `🧾 PO${a.vendorName ? ` · ${a.vendorName}` : ''} · ${N(a.qty)} × ${U(a.code)}`;
    if (k === 'BUY_NOTE') return `🧾 bought — PO${a.vendorName ? ` to ${a.vendorName}` : ''} to be raised · ${N(a.qty)}`;
    if (k === 'COVERED') return `✔ ${N(a.qty)} inbound on order`;
    if (k === 'ASK') return `${U(a.chosen) === 'PO' ? '🧾 PO' : '🏭 shop'} · ${N(a.qty)} × ${U(a.code)}`;
    if (k === 'HOLD') return `⛔ ${a.holdReason || 'held'}`;
    return '';
};

/**
 * The rows for a document parked by the one writer, from what the release already knows.
 * @param components  the plan's per-code rows ({ code, name, need, have, short, onOrder, actions, unitMismatch, noStockRecord })
 * @param planLines   the pull lines, used only when there are no components (stock not read)
 * @param gate        the gate object as stamped (awaitingRodCut/rodCutNote, awaitingReceipt/receiptGateNote)
 * @param poleChoice  the operator's pole decision ({ pullErp, pullFt, need, have, short, chosen })
 * @param backOrder   the back-order reason string, when the operator chose to wait for a length
 * @param shopWoIds   the shop work orders the make-up raised, in action order
 * @param unitsKnown  false when NetSuite's units could not be read this pull
 */
export const materialRowsOf = ({ components = [], planLines = [], gate = {}, poleChoice = null, backOrder = '', shopWoIds = [], unitsKnown = true } = {}) => {
    const rows = new Map();
    const shopIds = [...(shopWoIds || [])];
    const nextShopId = () => shopIds.shift() || '';
    if ((components || []).length) {
        (components || []).forEach(c => {
            const code = U(c && c.code);
            if (!code) return;
            const cover = (c.actions || []).map(a => actionText(a, nextShopId)).filter(Boolean);
            const unverified = !!c.unitMismatch || !!c.noStockRecord || !unitsKnown || c.have == null;
            if (c.unitMismatch) cover.unshift(`⚠ units disagree (NetSuite ${c.nsUnit || '?'} · app ${c.appUnit || '?'})`);
            else if (c.noStockRecord) cover.unshift('⚠ no inventory row at this location');
            else if (!unitsKnown) cover.unshift('⚠ stock units unreadable this pull');
            const need = N(c.need);
            const onHand = unverified ? null : N(c.have);
            const cur = rows.get(code);
            if (cur) {
                cur.need += need;
                if (onHand == null) { cur.onHand = null; cur.short = null; }
                else if (cur.onHand != null) { cur.short = Math.max(0, cur.need - cur.onHand); }
                cur.state = stateOf(cur.onHand, cur.need);
                cover.forEach(t => { if (!cur.coveredBy.includes(t)) cur.coveredBy.push(t); });
                return;
            }
            rows.set(code, {
                code, name: String((c && c.name) || ''), need,
                onHand, short: unverified ? null : Math.max(0, N(c.short)),
                onOrder: N(c.onOrder), unit: String(c.nsUnit || c.appUnit || ''),
                state: stateOf(onHand, need), coveredBy: cover, coverCodes: [code],
            });
        });
    } else {
        (planLines || []).forEach(l => {
            const code = U(l && (l.legacyErpId || l.partId || l.code));
            if (!code) return;
            const need = N(l.quantity != null ? l.quantity : l.qty);
            const cur = rows.get(code);
            if (cur) { cur.need += need; return; }
            rows.set(code, { code, name: String((l && (l.partName || l.name)) || ''), need, onHand: null, short: null, onOrder: 0, unit: '', state: MATERIAL_STATE.UNVERIFIED, coveredBy: ['stock not read at release'], coverCodes: [code] });
        });
    }
    // THE POLE (Q5): cut from a longer stick, or waited for — the operator's decision, said on its row.
    if (poleChoice && poleChoice.pullErp) {
        const code = U(poleChoice.pullErp);
        const row = rows.get(code) || { code, name: '', need: N(poleChoice.need), onHand: N(poleChoice.have), short: N(poleChoice.short), onOrder: 0, unit: '', state: stateOf(N(poleChoice.have), N(poleChoice.need)), coveredBy: [], coverCodes: [code] };
        if (gate && gate.awaitingRodCut) row.coveredBy = [`✂ cut · ${gate.rodCutNote || gate.rodCutId || 'cut order raised'}`];
        else if (backOrder || U(poleChoice.chosen) === 'BACKORDER') row.coveredBy = [`⏳ back order — ${backOrder || `waiting for the ${poleChoice.pullFt || ''} ft length`}`];
        rows.set(code, row);
    } else if (backOrder) {
        const first = [...rows.values()].find(r => r.state === MATERIAL_STATE.SHORT);
        if (first) first.coveredBy = [`⏳ back order — ${backOrder}`, ...first.coveredBy];
    }
    if (gate && gate.awaitingReceipt && gate.receiptGateNote) {
        [...rows.values()].filter(r => r.state === MATERIAL_STATE.SHORT).forEach(r => { if (!r.coveredBy.some(t => /waiting on material/.test(t))) r.coveredBy.push(`📦 waiting on material — ${gate.receiptGateNote}`); });
    }
    return finish(rows);
};

/**
 * The rows for RTG's whole-order split, from its stock-first plan. `lines` = the small-parts list
 * the split built (legacyErpId, partName, qty); `stock` = the availability read ({ map, unitsKnown });
 * `plan` = planSmallLines' answer (its backorder records say which lines it recorded short).
 * A painted line is made from ANY of its cover codes (finished, /P, raw), so on hand is the sum over
 * them, exactly as the split decides — and coverCodes rides on the row so the morning refresh sums
 * the same codes.
 */
export const materialRowsFromSplit = ({ lines = [], plan = null, stock = null, recipe = '' } = {}) => {
    const rows = new Map();
    (lines || []).forEach(l => {
        const code = U(l && (l.legacyErpId || l.partId));
        if (!code) return;
        const need = N(l.quantity != null ? l.quantity : l.qty);
        const cur = rows.get(code);
        if (cur) { cur.need += need; return; }
        rows.set(code, { code, name: String((l && (l.partName || l.name)) || ''), need, line: l });
    });
    const backordered = new Set(((plan && plan.backorder) || []).map(b => U(b && b.code)));
    const map = stock && stock.map ? stock.map : null;
    const unitsKnown = stock ? stock.unitsKnown !== false : false;
    const out = new Map();
    for (const [code, r] of rows) {
        const base = { code, name: r.name, need: r.need, onOrder: 0, unit: '', coverCodes: [code] };
        if (!map) { out.set(code, { ...base, onHand: null, short: null, state: MATERIAL_STATE.UNVERIFIED, coveredBy: ['stock not read at the split'] }); continue; }
        if (!unitsKnown) { out.set(code, { ...base, onHand: null, short: null, state: MATERIAL_STATE.UNVERIFIED, coveredBy: ['⚠ stock units unreadable — verify before pulling'] }); continue; }
        const cls = classifyLine({ ...r.line, legacyErpId: code }, recipe, map, r.need);
        if (cls.state === 'unknown') { out.set(code, { ...base, onHand: null, short: null, state: MATERIAL_STATE.UNVERIFIED, coveredBy: ['⚠ no inventory row at this location'] }); continue; }
        const onHand = Object.values(cls.available || {}).reduce((a, v) => a + N(v), 0);
        const short = N(cls.shortfall);
        const state = short > 0 ? MATERIAL_STATE.SHORT : MATERIAL_STATE.COVERED;
        const coveredBy = state === MATERIAL_STATE.COVERED
            ? [cls.kind === 'plated' ? '✔ in stock — WMS pick' : '✔ on the shelf (finished, /P or raw)']
            : [backordered.has(code) ? '⏳ BACK ORDER — recorded on the sales order' : '⚠ short'];
        out.set(code, { ...base, onHand, short, onOrder: N(cls.onOrder), state, coveredBy, coverCodes: (cls.coverCodes && cls.coverCodes.length) ? cls.coverCodes.map(U) : [code] });
    }
    return finish(out);
};

const rank = (s) => (s === MATERIAL_STATE.SHORT ? 0 : s === MATERIAL_STATE.UNVERIFIED ? 1 : 2);
const finish = (rows) => [...rows.values()]
    .map(r => { const { line, ...rest } = r; return { ...rest, coveredBy: Array.isArray(rest.coveredBy) ? rest.coveredBy.join(' · ') : String(rest.coveredBy || '') }; })
    .sort((a, b) => (rank(a.state) - rank(b.state)) || a.code.localeCompare(b.code));

/** The fields stamped on a document: the rows and when their stock was read. */
export const materialStampOf = (rows, now = Date.now()) => ((rows || []).length ? { materialRows: rows, materialAsOf: now, materialRefreshedAt: null } : {});

/**
 * THE MORNING REFRESH: only the stock columns move (on hand, on order, short, state); need and
 * covered-by are the release's. A row whose cover codes sum on the shelf is read as the split read
 * it. A code the read does not know reads UNVERIFIED — never a number.
 * @returns { rows, changed }
 */
export const refreshMaterialRows = (rows = [], avail = null) => {
    const map = avail && avail.map ? avail.map : null;
    const unitsKnown = avail ? avail.unitsKnown !== false : false;
    let changed = false;
    const out = (rows || []).map(r => {
        const codes = (r.coverCodes && r.coverCodes.length) ? r.coverCodes.map(U) : [U(r.code)];
        const known = !!map && unitsKnown && codes.some(c => c in map);
        const onHand = known ? codes.reduce((a, c) => a + N((map[c] || {}).available), 0) : null;
        const onOrder = known ? codes.reduce((a, c) => a + N((map[c] || {}).onOrder), 0) : N(r.onOrder);
        const short = onHand == null ? null : Math.max(0, N(r.need) - onHand);
        const state = stateOf(onHand, N(r.need));
        if (onHand !== r.onHand || short !== r.short || onOrder !== r.onOrder || state !== r.state) changed = true;
        return { ...r, onHand, onOrder, short, state };
    });
    return { rows: out, changed };
};

/** Every code the refresh has to read for a set of documents (cover codes included). */
export const materialCodesOf = (docs = []) => [...new Set((docs || []).flatMap(d => (d && d.materialRows) || []).flatMap(r => (r.coverCodes && r.coverCodes.length) ? r.coverCodes.map(U) : [U(r.code)]).filter(Boolean))];

/**
 * MAY A DOCUMENT'S STOCK BE REFRESHED? Only while nothing has been pulled for it: once its pick is
 * done the shelf dropped because of THIS order, and a refresh would show a false short. Picked,
 * staged, started and closed documents keep the rows from their release.
 */
export const materialRefreshable = (d, coll) => {
    if (!d || d.deleted || d.closed === true) return false;
    if (!Array.isArray(d.materialRows) || !d.materialRows.length) return false;
    const st = U(d.status), ph = U(d.currentPhase), pk = U(d.pickStatus);
    if (coll === 'fin_workorders') return !['CLOSED', 'COMPLETE', 'COMPLETED'].includes(ph) && !['CLOSED', 'COMPLETED', 'COMPLETE'].includes(st) && ['', 'PENDING'].includes(pk) && !d.packStatus;
    if (coll === 'shop_custom_orders') return ['', 'PENDING', 'RELEASED', 'QUEUED', 'APPROVED', 'NOT STARTED'].includes(st);
    if (coll === 'hq_work_orders') return st === 'APPROVED';
    return false;
};

/** "12 min ago" / "3 h ago" / "2 days ago" — the honesty line under the grid. */
export const materialAgeText = (asOf, now = Date.now()) => {
    const t = N(asOf);
    if (!t) return '';
    const mins = Math.max(0, Math.round((now - t) / 60000));
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
};

/** The local calendar day, the key the morning run is recorded under. */
export const refreshDayKey = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * IS THE MORNING RUN DUE? Once a day, from 6 am local: the first RTG session open after that runs
 * it. A run recorded for today, or one started in the last ten minutes by another session, means no.
 */
export const refreshDue = (rec = null, now = Date.now(), { hour = 6 } = {}) => {
    if (new Date(now).getHours() < hour) return false;
    const r = rec || {};
    if (r.lastRunDay === refreshDayKey(now)) return false;
    if (r.running && (now - N(r.running.at)) < 10 * 60 * 1000) return false;
    return true;
};
