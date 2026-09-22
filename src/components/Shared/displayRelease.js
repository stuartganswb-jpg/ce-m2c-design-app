// 10.5 IS MISSION CONTROL FOR A DISPLAY ORDER — the rows are what it starts, stops and watches.
//
// Stuart 2026-09-22: "the SO's have all the rows with tons of parts, some rows can be started
// because we have stock of all parts, some can't … ideally each row gets its own work order that is
// tied back to the main sales order … the work orders themselves would follow the exact same rules
// … row is the anchor and all parts follow existing routes, i do not want to build any new tools or
// routings for the floor … from this screen is where we release these large projects … rtg still
// manages … but 10.5 is really mission control for these types of orders."
//
// THE ONE ROUTE, SCOPED TO A ROW. Order Entry's generator (Shared/oeGenerate) already raises work per
// sales-order LINE — anchored soAppId + soLineIdx, stamped oeGen[idx], on RTG under the order, plated
// lines to the plater, auto-released when clear. A display order's row is a set of those lines. So a
// row start is that generator run over the row's lines and nothing else; the floor never learns a
// new document, and RTG governs every work order exactly as it governs any other.
//
// TWO DOORS, ONE LINE SHAPE. An Order Entry display order already has `lines[]` in that shape, each
// line's memo naming its row. A CPQ display order keeps its bill in the job's breakdown, grouped by
// the ▶ header whose sidemark IS the row ("Row 2"). This module turns that breakdown into the same
// `lines[]` — the floor-facing reading, so BOM-only parts (standoffs) are built and picked — and
// that is the only way a CPQ order joins the row route: written once, read by everything after.
//
// Pure. The panel loads and writes; RTG's guards read `displayRelease` on the sales order.

import { isDisplayOnlyLine, isParkedGeometryLine, headerSidemarkOf } from './lineClassification.js';
import { oeIsTbf, oeLineFinish, oeCoverageOf, oeLineStateOf } from './oeLines.js';
import { isOutsourcedFinishCode } from './finishRouting.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** "Row 2" → "ROW_2": the field key a row's run is recorded under on the sales order. */
export const rowKeyOf = (label) => U(label).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

/** The row a sales-order line belongs to. `row` when it was written with one (a CPQ display
 *  order); otherwise the memo the operator typed on an Order Entry line ("Row 2"). */
export const rowOfLine = (line) => String((line && (line.row || line.memo)) || '').trim();

/**
 * A CPQ display order's breakdown → Order Entry's line shape, one per physical part per row.
 * The floor-facing reading: BOM-only (`hidden`) parts are kept because they are built and picked;
 * headers, discounts, fees, add-ons, size echoes and parked geometry are not parts. A line without a
 * finish is a stocked pick and is written `toBeFinished: false`, exactly as tab 7 writes it.
 */
export const rowLinesFromBreakdown = (breakdown = []) => {
    const out = [];
    let row = '';
    (breakdown || []).forEach(l => {
        if (!l) return;
        if (l.isHeader) { row = headerSidemarkOf(l); return; }       // the add-ons header carries no row
        if (isDisplayOnlyLine(l) || l.isFee || l.isAddOn || isParkedGeometryLine(l)) return;
        const erp = U(l.legacyErpId || l.partId);
        const qty = N(l.qty);
        if (!erp || !(qty > 0)) return;
        const fin = U(l.finishCode || '');
        const feetPer = l.perFoot ? N(l.feet) : 0;
        out.push({
            erp, aliasErp: '', name: String(l.name || '').replace(/^\s*[-–▶]\s*/, '').trim(),
            qty, row, memo: row,
            ...(l.perFoot ? { perFoot: true, feetPer, billedFeet: qty * feetPer } : {}),
            ...(N(l.cutLength) > 0 ? { cutLength: N(l.cutLength) } : {}),
            ...(fin ? { toBeFinished: true, finishCode: fin, ...(isOutsourcedFinishCode(fin) ? { finishOutsourced: true } : {}) } : { toBeFinished: false }),
            fromBreakdown: true,
        });
    });
    return out;
};

/**
 * The sales order's lines grouped by the display's rows. Matching is by label, case-insensitively,
 * so "row 2" typed on a tab-7 line meets "Row 2" on the display. A line naming no row, or a row the
 * display does not have, is UNASSIGNED — it belongs to no button until somebody says which row.
 */
export const soRowsOf = (so, rowLabels = []) => {
    const byKey = new Map((rowLabels || []).map(l => [rowKeyOf(l), l]));
    const rows = {};
    (rowLabels || []).forEach(l => { rows[l] = []; });
    const unassigned = [];
    ((so && so.lines) || []).forEach((line, lineIdx) => {
        const label = byKey.get(rowKeyOf(rowOfLine(line)));
        if (label) rows[label].push({ line, lineIdx });
        else unassigned.push({ line, lineIdx });
    });
    return { rows, unassigned };
};

/**
 * A SALES ORDER RTG ALREADY SPLIT WHOLE (Stuart 2026-09-22: the tabletop's SO60551 — "nearly
 * completed in the physical world … no need to start anything over"). Its finishing and shop
 * documents carry every row already: `WO-<orderKey>` and `SHOP-<orderKey>`, the ids
 * autoSplitSalesOrder gives them. Such an order is anchored for VISIBILITY — its rows read their
 * state off those documents — and never offered a Start, because a row started on top of a
 * whole-order document is the same parts twice. A row's own work orders are `WO-OE-…`, so the two
 * cannot be confused.
 */
export const wholeOrderDocsOf = (so, fin = [], shop = []) => {
    const keys = [...new Set([so && so.soId, so && so.id].map(k => String(k || '').trim()).filter(Boolean))];
    const finDoc = (fin || []).find(d => d && keys.some(k => String(d.id) === `WO-${k}`)) || null;
    const shopDoc = (shop || []).find(d => d && keys.some(k => String(d.id) === `SHOP-${k}`)) || null;
    return (finDoc || shopDoc) ? { fin: finDoc, shop: shopDoc } : null;
};

/** The words for a whole-order sales order's rows: what its documents say, from RTG's side. */
export const wholeOrderText = (whole) => {
    if (!whole) return '';
    const parts = [];
    if (whole.fin) parts.push(`${whole.fin.id} · ${whole.fin.pickOnly ? (whole.fin.pickStatus || 'Pending') : (whole.fin.currentPhase || 'Setup')}${whole.fin.packStatus ? ` · ${whole.fin.packStatus}` : ''}`);
    if (whole.shop) parts.push(`${whole.shop.id} · ${whole.shop.status || 'Pending'}`);
    return parts.join(' · ');
};

/** Per-line state words, in the order the floor reaches them. */
export const LINE_STATE = {
    STOCKED: 'STOCKED', NONE: 'NONE', REVIEW: 'REVIEW', DEAD: 'DEAD', BACKORDER: 'BACKORDER',
    PARKED: 'PARKED', FLOOR: 'FLOOR', PLATING: 'PLATING', PLATING_STAGED: 'PLATING_STAGED',
    PLATING_SHIPPED: 'PLATING_SHIPPED', PLATING_RECEIVED: 'PLATING_RECEIVED', PLATING_BUILT: 'PLATING_BUILT', DONE: 'DONE',
    WHOLE: 'WHOLE',   // on a whole-order document RTG raised — managed there, never started here
};

/**
 * What ONE line is doing, read from the floor. Everything comes from what Order Entry's route
 * already leaves behind: the work order (with its gates), the plating demand, the oeGen stamp, and
 * the plater's shipment — which carries `demandWoNum`, the same PLW number the stamp records as
 * `ref`, so a plated line can be followed from "issued" through staged → shipped → received → built
 * without any new field anywhere.
 */
export const lineStateOf = ({ so, line, lineIdx, links, shipments = [], review = null, whole = null }) => {
    if (whole) {
        const done = whole.fin && /closed|complete|packed|shelved/i.test(String(whole.fin.currentPhase || whole.fin.status || ''));
        return { key: done ? LINE_STATE.DONE : LINE_STATE.WHOLE, text: `on the whole-order documents (${wholeOrderText(whole)}) — managed on RTG`, tone: done ? 'green' : 'brass' };
    }
    if (!oeIsTbf(line)) return { key: LINE_STATE.STOCKED, text: 'stocked — picked by the warehouse, not started here', tone: 'grey' };
    const coverage = oeCoverageOf({ so, line, lineIdx, ...(links || {}), any: true });
    const base = oeLineStateOf({ coverage, review });
    // A plated line, once pulled: follow its shipment.
    if (coverage && coverage.kind === 'PLATING') {
        const ref = U((coverage.stamp && coverage.stamp.ref) || (coverage.doc && coverage.doc.woNum) || '');
        const sh = ref ? (shipments || []).filter(s => U(s.demandWoNum) === ref) : [];
        const st = sh.map(s => String(s.status || '').toLowerCase());
        const at = (name) => st.includes(name);
        if (at('built')) return { key: LINE_STATE.PLATING_BUILT, text: `${ref} — back from the plater and built`, tone: 'green' };
        if (at('received')) return { key: LINE_STATE.PLATING_RECEIVED, text: `${ref} — received from the plater`, tone: 'green' };
        if (at('shipped')) return { key: LINE_STATE.PLATING_SHIPPED, text: `${ref} — at the plater`, tone: 'brass' };
        if (at('staged')) return { key: LINE_STATE.PLATING_STAGED, text: `${ref} — pulled, staged for the plater`, tone: 'brass' };
        return { key: LINE_STATE.PLATING, text: base.text, tone: base.tone };
    }
    // A parked work order that is waiting on MATERIAL is what the floor calls backordered.
    if (base.key === 'PARKED' && coverage && coverage.doc && (coverage.doc.backOrdered || coverage.doc.materialShort || coverage.doc.awaitingReceipt)) {
        const w = coverage.doc;
        const why = w.backOrderReason || w.materialShortNote || (w.awaitingReceipt ? `waiting on ${(w.receiptCodes || []).join(', ') || 'a receipt'}` : 'material short');
        return { key: LINE_STATE.BACKORDER, text: `${w.id} — backordered: ${why}`, tone: 'red' };
    }
    return { key: base.key, text: base.text, tone: base.tone };
};

/** Row-level words. The order matters: the worst thing in the row is what the row says. */
export const ROW_STATE = {
    NOT_STARTED: 'NOT_STARTED', NEEDS_DECISION: 'NEEDS_DECISION', BACKORDERED: 'BACKORDERED',
    PARTLY_STARTED: 'PARTLY_STARTED', ISSUED: 'ISSUED', ON_FLOOR: 'ON_FLOOR', AT_PLATER: 'AT_PLATER', DONE: 'DONE', EMPTY: 'EMPTY',
};

const ROW_TEXT = {
    NOT_STARTED: 'not started', NEEDS_DECISION: 'needs a decision', BACKORDERED: 'backordered',
    PARTLY_STARTED: 'partly started', ISSUED: 'work orders issued', ON_FLOOR: 'on the floor', AT_PLATER: 'at the plater',
    DONE: 'done', EMPTY: 'no lines on the sales order',
};

/**
 * One row, summed up. `reviews` = the reasons the last run named for this row's lines (lineIdx →
 * reasons[]), so a line waiting on a person says why.
 */
export const rowStateOf = ({ so, entries = [], links, shipments = [], reviews = {} }) => {
    // A DISPLAY SPANS SEVERAL SALES ORDERS (Stuart 2026-09-22: the tabletop is SO60551 + SO60565,
    // the wall is SO60583 + SO60585). An entry may carry its own order and that order's links,
    // shipments, review and whole-order documents; the row is the union of them all.
    const lines = (entries || []).map((e) => {
        const { line, lineIdx } = e;
        const ctxSo = e.so || so;
        const rvs = e.reviews || reviews;
        const rv = rvs && rvs[lineIdx] ? { reasons: rvs[lineIdx] } : null;
        const st = lineStateOf({ so: ctxSo, line, lineIdx, links: e.links || links, shipments: e.shipments || shipments, review: rv, whole: e.whole || null });
        return { lineIdx, soId: ctxSo && (ctxSo.soId || ctxSo.id), soAppId: ctxSo && ctxSo.id, erp: U(line.erp), finish: oeLineFinish(line), qty: N(line.qty), ...st };
    });
    const tbf = lines.filter(l => l.key !== LINE_STATE.STOCKED);
    const has = (k) => tbf.some(l => l.key === k);
    const all = (ks) => tbf.length > 0 && tbf.every(l => ks.includes(l.key));
    let key;
    if (!lines.length) key = ROW_STATE.EMPTY;
    else if (!tbf.length) key = ROW_STATE.DONE;                       // nothing to make: all stocked
    else if (all([LINE_STATE.NONE])) key = ROW_STATE.NOT_STARTED;
    else if (has(LINE_STATE.REVIEW) || has(LINE_STATE.DEAD)) key = ROW_STATE.NEEDS_DECISION;
    else if (has(LINE_STATE.BACKORDER)) key = ROW_STATE.BACKORDERED;
    else if (has(LINE_STATE.NONE)) key = ROW_STATE.PARTLY_STARTED;
    else if (all([LINE_STATE.DONE, LINE_STATE.PLATING_BUILT, LINE_STATE.PLATING_RECEIVED])) key = ROW_STATE.DONE;
    else if (has(LINE_STATE.PLATING_STAGED) || has(LINE_STATE.PLATING_SHIPPED) || has(LINE_STATE.PLATING)) key = ROW_STATE.AT_PLATER;
    else if (has(LINE_STATE.FLOOR) || has(LINE_STATE.WHOLE)) key = ROW_STATE.ON_FLOOR;
    else key = ROW_STATE.ISSUED;
    const open = lines.filter(l => l.key === LINE_STATE.NONE).length;
    return { key, text: ROW_TEXT[key], lines, open, started: tbf.length - open, stocked: lines.length - tbf.length };
};

/** The patch that puts a sales order on the row route. Writes `lines` only when handed some. */
export const displayAnchorPatch = ({ buildId, lines = null }) => ({
    // RTG's whole-order split and the Order Entry auto-start both stand down for this order — its
    // rows are started from 10.5, one at a time, by a person.
    displayRelease: true,
    displayBuildId: buildId || '',
    // Every row's work orders release on their own; without this each waits for all its siblings.
    finishAsAvailable: true,
    ...(Array.isArray(lines) ? { lines } : {}),
});

/** True when the sales order needs its lines written before rows can be read off it. */
export const soNeedsLines = (so) => !!so && !(Array.isArray(so.lines) && so.lines.length);

/** The words of the start confirmation — every line named, nothing implied. */
export const rowStartText = (label, state) => {
    const go = state.lines.filter(l => l.key === LINE_STATE.NONE);
    const rest = state.lines.filter(l => l.key !== LINE_STATE.NONE);
    return [
        `Start ${label}?`,
        go.length ? `\n${go.length} line(s) will be started — plated parts go to the plater, painted to finishing, custom to the shop:\n${go.map(l => `  • ${l.qty} × ${l.erp}${l.finish ? ` in ${l.finish}` : ''}`).join('\n')}` : '\nNothing to start on this row.',
        rest.length ? `\n${rest.length} line(s) already in motion or stocked are left as they are:\n${rest.map(l => `  • ${l.erp} — ${l.text}`).join('\n')}` : '',
        '\nEach work order lands on RTG under this sales order. Lines the plan cannot start cleanly are named for review, not guessed.',
    ].filter(Boolean).join('\n');
};
