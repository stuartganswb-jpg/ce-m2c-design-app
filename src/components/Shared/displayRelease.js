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

import { isQuickShip, ORDER_ENTRY_CLASS, soLineCodeOf } from './pickLines.js';
import { committedQtyOf } from './committedBins.js';
import { isDisplayOnlyLine, isParkedGeometryLine, headerSidemarkOf } from './lineClassification.js';
import { oeIsFloorLine, oeLineFinish, oeCoverageOf, oeLineStateOf } from './oeLines.js';
import { isOutsourcedFinishCode } from './finishRouting.js';
import { rowRestampOf, isStockColourCode } from './subFinish.js';
import { isKitLine, itemKitOrderLinesOf, isOffOrderLine } from './itemKit.js';

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
// THE LINE CARRIES THE BASE ITEM, THE FINISH RIDES BESIDE IT (Stuart 2026-09-27: "it is applying the
// P then /P06, should just be H1-138CC/P06"). A CPQ breakdown line bills a painted part on the
// shared "/P" SKU and a plated part on its exact "/EP2" SKU (Shared/nsTransmit) — that is the
// NetSuite billing identity, not the item to make. Tab 7 writes the BASE item with the finish
// beside it, and the Order Entry route composes base + finish; a line that already carried the
// finish was composed twice (H1-138CC/P/P06, H1-1BF/EP2/EP2) and found no stock and no assembly.
export const rowLineErpOf = (erp, fin) => {
    const e = U(erp), f = U(fin);
    if (!e) return '';
    if (f && e.endsWith(`/${f}`)) return e.slice(0, -(f.length + 1));     // the exact finished SKU → its base
    if (f && /^P\d/.test(f) && e.endsWith('/P')) return e.slice(0, -2);   // the shared paint SKU → its base
    return e;
};
/** The lines an order already carries, with any billing-SKU codes put right; null when nothing needs it. */
export const lineCodeFixesOf = (so) => {
    const lines = Array.isArray(so && so.lines) ? so.lines : [];
    const fixed = [];
    const out = lines.map((l, i) => {
        if (!l || !l.toBeFinished) return l;
        const erp = U(l.erp), fin = U(oeLineFinish(l));
        const want = rowLineErpOf(erp, fin);
        if (!want || want === erp) return l;
        fixed.push({ lineIdx: i, from: erp, to: want, finish: fin });
        return { ...l, erp: want, billedErp: erp };
    });
    return fixed.length ? { lines: out, fixed } : null;
};
export const lineCodeFixText = (so, fix) =>
    `↻ Fix ${fix.fixed.length} line code${fix.fixed.length === 1 ? '' : 's'} on ${(so && (so.soId || so.id)) || ''}?\n\nThese lines carry the CPQ billing SKU as the item, so the route composed the finish twice:\n\n`
    + fix.fixed.map(x => `   line ${x.lineIdx + 1}: ${x.from} → ${x.to} · ${x.finish}`).join('\n')
    + `\n\nThe item becomes the base part with its finish beside it — what tab 7 writes. Rows already started keep their work orders; rows not started plan on the corrected code.`;

export const rowLinesFromBreakdown = (breakdown = []) => {
    const out = [];
    let row = '';
    (breakdown || []).forEach(l => {
        if (!l) return;
        if (l.isHeader) { row = headerSidemarkOf(l); return; }       // the add-ons header carries no row
        // THE CPQ SPLIT'S FILTER, NOTHING MORE (Stuart 2026-09-27). Fee and add-on lines used to be dropped here,
        // so a return or miter flagged as a fee never reached the order, while CPQ keeps them: a fee cut into a
        // rod rides the shop's cut list (Shared/lineClassification, rule 0), a checkout add-on routes by its own
        // handling. Headers, discounts, size echoes and parked geometry are still not parts.
        if (isDisplayOnlyLine(l) || isParkedGeometryLine(l)) return;
        const billed = U(l.legacyErpId || l.partId);
        const qty = N(l.qty);
        if (!billed || !(qty > 0)) return;
        const fin = U(l.finishCode || '');
        const erp = rowLineErpOf(billed, fin);   // the base item; the billing SKU is kept beside it
        const feetPer = l.perFoot ? N(l.feet) : 0;
        out.push({
            erp, aliasErp: '', name: String(l.name || '').replace(/^\s*[-–▶]\s*/, '').trim(),
            ...(billed !== erp ? { billedErp: billed } : {}),
            qty, row, memo: row,
            ...(l.perFoot ? { perFoot: true, feetPer, billedFeet: qty * feetPer } : {}),
            ...(N(l.cutLength) > 0 ? { cutLength: N(l.cutLength) } : {}),
            ...(fin ? { toBeFinished: true, finishCode: fin, ...(isOutsourcedFinishCode(fin) ? { finishOutsourced: true } : {}) } : { toBeFinished: false }),
            // WHAT CPQ'S CLASSIFIER READS ON THE LINE (Shared/oeClassify → classifyLine), and what its pick and
            // cut lists carry — kept, so a row decides shop-or-small exactly as the split does.
            ...(l.partId ? { partId: String(l.partId) } : {}),
            ...(l.partHandling ? { partHandling: String(l.partHandling) } : {}),
            ...(l.customOverrideHandling ? { customOverrideHandling: String(l.customOverrideHandling) } : {}),
            ...(l.isFee || l.lineIsFee ? { isFee: true } : {}),
            ...(l.isAddOn ? { isAddOn: true } : {}),
            ...(l.qtyEach != null ? { qtyEach: N(l.qtyEach) } : {}),
            ...(l.configQty != null ? { configQty: N(l.configQty) } : {}),
            ...(l.clientSku ? { clientSku: String(l.clientSku) } : {}),
            ...(l.hidden ? { hidden: true } : {}),
            ...(l.shopOnly ? { shopOnly: true } : {}),
            ...(l.noFinish ? { noFinish: true } : {}),
            ...(l.subFinishCode ? { subFinishCode: U(l.subFinishCode) } : {}),
            ...(l.finishLabel ? { finishLabel: String(l.finishLabel) } : {}),
            // A KIT'S PART (CPQ's engine, Shared/itemKit): made and picked as itself, sold inside its kit.
            ...(l.inKit ? { inKit: true, ...(l.kitOf ? { kitOf: U(l.kitOf) } : {}) } : {}),
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
// THE ORDER'S OWN LINES (Stuart 2026-09-28: "H1-TTB1 is the actual base it is not a row") — a line marked
// `orderLevel` belongs to the whole display (its base), not to a row: it is neither unassigned nor started with a
// row. It routes exactly as a tab-7 line does (the same Order Entry route): stocked → picked at SO Pack; made → its
// own ▶ Start, grouped by finish with no row.
export const ORDER_ROW_LABEL = 'The order (not a row)';
export const soRowsOf = (so, rowLabels = []) => {
    const byKey = new Map((rowLabels || []).map(l => [rowKeyOf(l), l]));
    const rows = {};
    (rowLabels || []).forEach(l => { rows[l] = []; });
    const unassigned = [];
    const orderLines = [];
    ((so && so.lines) || []).forEach((line, lineIdx) => {
        if (line && line.orderLevel === true) { orderLines.push({ line, lineIdx }); return; }
        const label = byKey.get(rowKeyOf(rowOfLine(line)));
        if (label) rows[label].push({ line, lineIdx });
        else unassigned.push({ line, lineIdx });
    });
    return { rows, unassigned, orderLines };
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
const wholeKeysOf = (so) => [...new Set([so && so.soId, so && so.id].map(k => String(k || '').trim()).filter(Boolean))];
/**
 * A whole-order document the RETIRE closed (below) still exists — the closer keeps it, reopenable —
 * but it is no longer the split. The closer stamps `closedFrom: '10.5'` on it and nothing else
 * closes from 10.5; a document RTG closed as FINISHED keeps counting, so a built whole-order
 * display still reads DONE off it and is never offered a Start.
 */
// A whole-order document is RETIRED when 10.5 closed it, or when 10.5 marked an already-closed one
// retired (the wall's SO60585/SO60586, closed from the WMS pack screen "redoing", 2026-09-26).
export const splitRetiredDoc = (d) => !!d && (d.closed === true || U(d.status) === 'CLOSED' || U(d.currentPhase) === 'CLOSED')
    && (String(d.closedFrom || '').trim() === '10.5' || d.splitRetired === true);
// A whole-order id is WO-<key>, or — since the split writes one pair per finish (2026-09-23) —
// WO-<key>-<FINISH>. A row pair's id is WO-OE-…, never a sales-order key, so the two cannot meet.
const isWholeId = (id, prefix, keys) => keys.some(k => String(id) === `${prefix}-${k}` || String(id).startsWith(`${prefix}-${k}-`));
export const wholeOrderDocsOf = (so, fin = [], shop = []) => {
    const keys = wholeKeysOf(so);
    const fins = (fin || []).filter(d => d && !splitRetiredDoc(d) && isWholeId(d.id, 'WO', keys));
    const shops = (shop || []).filter(d => d && !splitRetiredDoc(d) && isWholeId(d.id, 'SHOP', keys));
    return (fins.length || shops.length) ? { fin: fins[0] || null, shop: shops[0] || null, fins, shops } : null;
};
/** The packaging document ids the split gives an order: PKG-<orderKey>, one per identity key. */
export const packagingIdsOf = (so) => wholeKeysOf(so).map(k => `PKG-${k}`);
/**
 * THE RETIRED SPLIT'S PACK CARD LEFT PENDING (Stuart 2026-09-28, SO60551's PKG-SO60551: written by the whole-order
 * split on 09-17, still pending in the Packaging tab after the 09-23 retire). An order released by rows packs at SO
 * Pack — a row never writes a PKG-<key> — so a pending one on it is the retired split's, left behind. Only a card
 * still PENDING: one that has moved (packed) was worked against the whole order and is a person's call. Pure.
 * @param entry  10.5's read of the order ({ so, whole, pkg })
 */
export const stalePackCardsOf = (entry) => (!entry || entry.whole) ? []
    : (entry.pkg || []).filter(p => p && !p.closed && ['', 'PENDING'].includes(U(p.status)));
/** The stamp every 10.5 close of a pack card writes (the retire, the reopen, and this). */
export const packCardCloseStamp = (by = '', reason = '', now = Date.now()) => ({ status: 'closed', closed: true, closedAt: now, closedBy: by || '', closedFrom: '10.5', closeReason: reason });

/** The whole-order documents the retire closed on this order — the strip says so instead of offering the retire again. */
export const splitRetiredOf = (so, fin = [], shop = []) => {
    const keys = wholeKeysOf(so);
    const docs = [...(fin || []).filter(d => d && isWholeId(d.id, 'WO', keys)), ...(shop || []).filter(d => d && isWholeId(d.id, 'SHOP', keys))].filter(splitRetiredDoc);
    return docs.length ? docs : null;
};

/**
 * MAY THE WHOLE-ORDER SPLIT BE RETIRED? (Stuart 2026-09-22: "keep the sales orders but otherwise
 * start over, it is not workable in current format.") Only while nothing has moved on it: the
 * finishing doc not past Setup, nothing picked or packed, the shop doc not started, nothing pulled
 * to the plater. Anything that HAS moved is named, and the retire refuses — a document with work
 * logged against it is closed by a person on RTG who can see that work, not from here.
 * @returns string[] — empty means it may go
 */
export const retireBlockersOf = ({ fin = null, shop = null, fins = null, shops = null, plating = [], pkg = [] } = {}) => {
    const out = [];
    // Every pair of the order (one per finish) is checked — the first-pair shorthand still works.
    const finList = Array.isArray(fins) && fins.length ? fins : (fin ? [fin] : []);
    const shopList = Array.isArray(shops) && shops.length ? shops : (shop ? [shop] : []);
    // The split also writes PKG-<so> for the packing station (pending until packed); one that has
    // moved past pending was packed against the whole order and is closed by a person who can see it.
    (pkg || []).forEach(p => { if (p && !['', 'PENDING'].includes(U(p.status)) && !splitRetiredDoc(p)) out.push(`${p.id} is ${p.status} at packaging`); });
    const FIN_OK = ['', 'SETUP', 'PENDING', 'QUEUED', 'NOT STARTED'];
    const PICK_OK = ['', 'PENDING', 'WAITING', 'QUEUED'];
    finList.forEach(f => {
        const phase = U(f.currentPhase || f.status || '');
        if (!FIN_OK.includes(phase)) out.push(`${f.id} is at ${f.currentPhase || f.status} on the finishing floor`);
        if (!PICK_OK.includes(U(f.pickStatus || ''))) out.push(`${f.id} has been picked (${f.pickStatus})`);
        if (f.packStatus) out.push(`${f.id} has been packed (${f.packStatus})`);
        if (f.closed || U(f.status) === 'CLOSED') out.push(`${f.id} is already closed`);
    });
    shopList.forEach(sh => {
        const st = U(sh.status || '');
        if (!['', 'PENDING', 'RELEASED', 'QUEUED', 'APPROVED', 'NOT STARTED'].includes(st)) out.push(`${sh.id} is ${sh.status} on the shop floor`);
        if (sh.closed) out.push(`${sh.id} is already closed`);
    });
    (plating || []).forEach(p => {
        if (!p) return;
        if (p.__coll === 'plating_shipments' && !['', 'STAGED'].includes(U(p.status))) out.push(`${p.woNum || p.id} is ${p.status} at the plater`);
    });
    return out;
};

/** The words of the retire confirmation — what closes, what is cancelled, what follows. */
export const retireText = (so, { fin = null, shop = null, fins = null, shops = null, plating = [], pkg = [] } = {}) => {
    const demands = (plating || []).filter(p => p && p.__coll === 'plating_demand');
    const pkgOpen = (pkg || []).filter(p => p && !splitRetiredDoc(p));
    const finList = Array.isArray(fins) && fins.length ? fins : (fin ? [fin] : []);
    const shopList = Array.isArray(shops) && shops.length ? shops : (shop ? [shop] : []);
    return [
        `Retire the whole-order split of ${so.soId || so.id} and release it by ROWS instead?`,
        '\nThis CLOSES, through the same close RTG uses (state kept, reopenable):',
        ...finList.map(f => `  • ${f.id} — the whole-order finishing document`),
        ...shopList.map(sh => `  • ${sh.id} — the whole-order shop document`),
        ...pkgOpen.map(p => `  • ${p.id} — the whole-order packaging document`),
        demands.length ? `\nand CANCELS ${demands.length} open plating demand(s) the split raised (${demands.map(d => d.woNum || d.id).join(', ')}), through the ledger.` : '',
        `\nThe sales order ${so.soId || so.id} itself stays open and is not touched. Its lines are then written for the row route, and each row is started from here when you choose.`,
        '\nNothing has been worked on these documents (checked). This is the point of no return for the whole-order path on this order.',
    ].filter(Boolean).join('\n');
};

/** The words for a whole-order sales order's rows: what its documents say, from RTG's side. */
export const wholeOrderText = (whole) => {
    if (!whole) return '';
    const parts = [];
    const fins = Array.isArray(whole.fins) && whole.fins.length ? whole.fins : (whole.fin ? [whole.fin] : []);
    const shops = Array.isArray(whole.shops) && whole.shops.length ? whole.shops : (whole.shop ? [whole.shop] : []);
    fins.forEach(f => parts.push(`${f.id} · ${f.pickOnly ? (f.pickStatus || 'Pending') : (f.currentPhase || 'Setup')}${f.packStatus ? ` · ${f.packStatus}` : ''}`));
    shops.forEach(sh => parts.push(`${sh.id} · ${sh.status || 'Pending'}`));
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
    // A shelf pick — unless it is made (cut, a fee on a pole, custom handling: oeIsFloorLine) or a start has
    // already raised something for it (a custom line quoted with no finish, 2026-09-27).
    // A LINE TAKEN OFF THE ORDER keeps its place and needs nothing (Shared/itemKit.isOffOrderLine, 2026-09-29).
    if (isOffOrderLine(line)) return { key: LINE_STATE.STOCKED, text: `off the order${line.qtyChangedReason ? ` — ${line.qtyChangedReason}` : ''}`, tone: 'grey' };
    // A KIT LINE is sold as one — its parts, below it, are what is made and picked (Shared/itemKit, 2026-09-28).
    if (isKitLine(line)) return { key: LINE_STATE.STOCKED, text: 'kit — sold as one; its parts are the lines below', tone: 'grey' };
    // A STOCK COLOUR is the start's to decide — the shelf, or painted from its /P (Shared/oeGenerate STOCK_FIRST).
    const stockColour = !line.noFinish && line.finishOutsourced !== true && (line.stockColour === true || isStockColourCode(U(line.erp)));
    if (!oeIsFloorLine(line) && !stockColour && !(so && so.oeGen && so.oeGen[lineIdx])) return { key: LINE_STATE.STOCKED, text: 'stocked — picked by the warehouse, not started here', tone: 'grey' };
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
    // A LINE NAMED FOR REVIEW IS NOT STARTED (Stuart 2026-09-22: "no change" — Base Front 1 read
    // "1 started · 0 to start" and offered no button). Nothing was raised for it; a person was named.
    // The rule may have changed since, the stock may have arrived, the item may have been fixed —
    // so it is OPEN, and a row holding one can be run again from here.
    const startable = (l) => l.key === LINE_STATE.NONE || l.key === LINE_STATE.REVIEW;
    const open = lines.filter(startable).length;
    return { key, text: ROW_TEXT[key], lines, open, started: tbf.length - open, stocked: lines.length - tbf.length };
};

/** The patch that puts a sales order on the row route. Writes `lines` only when handed some. */
export const displayAnchorPatch = ({ buildId, lines = null, so = null }) => ({
    // RTG's whole-order split and the Order Entry auto-start both stand down for this order — its
    // rows are started from 10.5, one at a time, by a person.
    displayRelease: true,
    displayBuildId: buildId || '',
    // Every row's work orders release on their own; without this each waits for all its siblings.
    finishAsAvailable: true,
    // AN ORDER RELEASED BY ROWS IS AN ORDER ENTRY ORDER (Stuart 2026-09-23, the wall's SO60585 /
    // SO60586): its lines are the truth and it packs off the order itself — the SO Pack card picks
    // the stocked lines and holds the made-to-order ones until their row work orders come back.
    // Five readers and three queries key on this class; a CPQ-born order without it fell through
    // every one of them, so its stocked lines had no pick path at all. Stamped ONCE here, at the one
    // writer; `source` still says where it was sold. The pick status starts Pending only when the
    // order has none — an order already picked is never set back.
    orderClass: ORDER_ENTRY_CLASS,
    ...((so && so.pickStatus) ? {} : { pickStatus: 'Pending' }),
    ...(Array.isArray(lines) ? { lines } : {}),
    // The card's piece count is the sum of the lines, as tab 7 writes it — a CPQ record carries the
    // 1 its approve wrote.
    ...(piecesOf(Array.isArray(lines) ? lines : (so && so.lines)) != null ? { totalParts: piecesOf(Array.isArray(lines) ? lines : so.lines) } : {}),
});
const piecesOf = (lines) => (Array.isArray(lines) && lines.length) ? lines.reduce((a, l) => a + (N(l && l.qty) || 0), 0) : null;
/**
 * What the pack-card stamp still owes an anchored, released-by-rows order: 'class' when it was
 * stamped before the class rule, 'count' when its piece count disagrees with its lines; '' when
 * nothing. A whole-order order is the CALLER's to refuse — it packs on its whole-order documents.
 */
export const needsPackCard = (so) => {
    if (!so || so.displayRelease !== true) return '';
    if (!isQuickShip(so)) return 'class';
    const n = piecesOf(so.lines);
    return (n != null && N(so.totalParts) !== n) ? 'count' : '';
};
/**
 * A whole-order order that carries the class by mistake (the tabletop's SO60551, 2026-09-23: anchored
 * before the visibility-only mode, then offered the stamp): it packs on WO-<so>, so the card is a
 * second pack home with no lines. Only an order NOT sold through Order Entry ever loses the class.
 */
export const packCardToRemove = (so, whole) => !!so && !!whole && isQuickShip(so) && U(so.source) !== 'QUICKSHIP';

/** True when the sales order needs its lines written before rows can be read off it. */
export const soNeedsLines = (so) => !!so && !(Array.isArray(so.lines) && so.lines.length);

/** The words of the start confirmation — every line named, nothing implied. */
export const rowStartText = (label, state) => {
    const startable = (l) => l.key === LINE_STATE.NONE || l.key === LINE_STATE.REVIEW;
    const go = state.lines.filter(startable);
    const rest = state.lines.filter(l => !startable(l));
    const again = go.filter(l => l.key === LINE_STATE.REVIEW).length;
    return [
        `Start ${label}?`,
        go.length ? `\n${go.length} line(s) will be started — plated parts picked from stock (short → the Snapshot Backorder board), painted to finishing, poles to the shop (a plated pole goes on to the plater from there)${again ? ` (${again} of them named for a decision last time — the plan is read again from live stock)` : ''}:\n${go.map(l => `  • ${l.qty} × ${l.erp}${l.finish ? ` in ${l.finish}` : ''}`).join('\n')}` : '\nNothing to start on this row.',
        rest.length ? `\n${rest.length} line(s) already in motion or stocked are left as they are:\n${rest.map(l => `  • ${l.erp} — ${l.text}`).join('\n')}` : '',
        '\nEach work order lands on RTG under this sales order. Lines the plan cannot start cleanly are named for review, not guessed.',
    ].filter(Boolean).join('\n');
};


// ── REOPEN FOR ROWS (Stuart 2026-09-26) ──────────────────────────────────────────────────────
// The wall's two sales orders were closed from the WMS pack screen ("redoing") before their rows
// were ever started. That closed the sales orders and their whole-order documents, and 10.5 then
// read every row as "on the whole-order documents (Closed)" — DONE, which looks like released.
// The retire cannot help: it refuses closed documents. This is the door for exactly that state:
// a closed anchored order whose whole-order split never did any work is put back on the row
// route — the sales order restored from its close, the split's documents left closed but marked
// retired, the pack card closed. Nothing is reopened on the floor.
const isClosedRecord = (d) => !!d && (U(d.status) === 'CLOSED' || U(d.currentPhase) === 'CLOSED' || d.closed === true || !!d.closedAt);
export const soIsClosed = (so) => !!so && (U(so.status) === 'CLOSED' || !!so.closedAt);
export const SO_CLOSE_STAMPS = ['closedAt', 'closedBy', 'closedFrom', 'closeReason', 'stateBeforeClose', 'nsWoCloseRequired', 'nsWoCloseRequestedAt', 'nsWoCloseRequestedBy', 'nsWoClosePending'];

/** May this closed order go back on the row route? { ok, why[] } — every reason, not the first. */
export const reopenForRowsCheck = (so, whole) => {
    const why = [];
    if (!soIsClosed(so)) why.push(`${(so && (so.soId || so.id)) || 'the order'} is not closed (${(so && so.status) || '—'}) — use Retire the split instead`);
    if (!whole) why.push('no whole-order split to retire');
    const fins = whole ? (Array.isArray(whole.fins) && whole.fins.length ? whole.fins : (whole.fin ? [whole.fin] : [])) : [];
    const shops = whole ? (Array.isArray(whole.shops) && whole.shops.length ? whole.shops : (whole.shop ? [whole.shop] : [])) : [];
    fins.forEach(f => {
        if (!isClosedRecord(f)) why.push(`${f.id} is still open on the finishing floor (${f.currentPhase || f.status || '—'})`);
        if (f.packStatus) why.push(`${f.id} was packed (${f.packStatus}) — real work; reopen it on RTG instead`);
        if (['PICKED_AWAITING_STAGING', 'STAGED_READY_FOR_FINISHING', 'PICKED', 'STAGED'].includes(U(f.pickStatus))) why.push(`${f.id} was picked (${f.pickStatus}) — real work; reopen it on RTG instead`);
    });
    shops.forEach(s => {
        if (!isClosedRecord(s) && !['COMPLETED', 'COMPLETE'].includes(U(s.status))) why.push(`${s.id} is still open on the shop floor (${s.status || '—'})`);
        if (s.startedAt && (s.cutsLogged || (Array.isArray(s.cutLog) && s.cutLog.length))) why.push(`${s.id} logged cuts — real work; reopen it on RTG instead`);
    });
    return { ok: why.length === 0, why };
};

/** The question 10.5 asks before it does it. */
export const reopenForRowsText = (so, whole, pkg = []) => {
    const ref = (so && (so.soId || so.id)) || '';
    const docs = [...(whole && whole.fins ? whole.fins : (whole && whole.fin ? [whole.fin] : [])), ...(whole && whole.shops ? whole.shops : (whole && whole.shop ? [whole.shop] : []))].map(x => x.id);
    const openPkg = (pkg || []).filter(p => p && !p.closed && String(p.closedFrom || '') !== '10.5').map(p => p.id);
    return `⟲ REOPEN ${ref} FOR ROWS?\n\nIt was closed ${so && so.closedAt ? new Date(Number(so.closedAt) || so.closedAt).toLocaleString() : ''}${so && so.closedBy ? ` by ${so.closedBy}` : ''}${so && so.closeReason ? ` ("${so.closeReason}")` : ''}${so && so.closedFrom ? ` from ${so.closedFrom}` : ''}, and its whole-order split never did any work.\n\n`
        + `• the sales order comes back open, on the row route — its rows start from here, one at a time\n`
        + `• the whole-order documents stay closed and are marked retired: ${docs.join(', ') || '—'}\n`
        + (openPkg.length ? `• the pack card ${openPkg.join(', ')} is closed; the order packs off its own lines\n` : '')
        + `\nNothing goes to the floor until you start a row.`;
};

/**
 * The sales-order patch: restored from its close (the status it had, else Dispatched), the close
 * kept as history, the row-route stamps applied. `clear` names the fields the caller deletes.
 */
export const reopenForRowsSoPatch = ({ so, buildId, lines = null, by = '', now = Date.now() }) => {
    const before = so && so.stateBeforeClose && so.stateBeforeClose.status;
    const status = before && U(before) !== 'CLOSED' ? before : 'Dispatched';
    return {
        patch: {
            status,
            reopenedFromClose: { closedAt: (so && so.closedAt) || null, closedBy: (so && so.closedBy) || '', closedFrom: (so && so.closedFrom) || '', closeReason: (so && so.closeReason) || '' },
            reopenedFrom: '10.5', reopenedAt: now, reopenedBy: by || '', reopenReason: 'reopened for rows — the whole-order split retired',
            splitRetired: true, splitRetiredAt: now, splitRetiredBy: by || '',
            ...displayAnchorPatch({ buildId, lines, so: { ...(so || {}), status } }),
        },
        clear: SO_CLOSE_STAMPS.filter(k => so && so[k] !== undefined),
    };
};
/** What a whole-order document is stamped with — it stays closed. */
export const splitRetiredStamp = (by = '', now = Date.now()) => ({ splitRetired: true, splitRetiredAt: now, splitRetiredBy: by || '', splitRetiredFrom: '10.5' });

// ── ↻ RE-READ LINES FROM THE CPQ JOB (Stuart 2026-09-27, SO60551) ─────────────────────────────────────────
// Lines anchored before 09-27 were built by the old reader: fee and add-on lines dropped, and none of the
// fields CPQ's classifier reads. This re-reads the job's breakdown with today's reader and returns the patch —
// WITHOUT moving any line: work already raised is keyed by line position (oeGen[idx], soLineIdx), so an existing
// line keeps its place, code, finish and quantity and only gains the missing fields; a line the old reader
// dropped is appended. On a rows-released order the retired split's backorder records (not OE_ROW) go too.
// Pure. @returns null when nothing changes, else { lines, enriched, added: [{ erp, row, qty }], droppedBackorders }
const REREAD_FIELDS = ['partId', 'partHandling', 'customOverrideHandling', 'isFee', 'isAddOn', 'qtyEach', 'configQty', 'clientSku', 'hidden', 'shopOnly', 'noFinish', 'subFinishCode', 'finishLabel', 'cutLength'];
// THEN CPQ'S CURRENT RULES FOR EACH ROW (Shared/subFinish.rowRestampOf, Stuart 2026-09-27 — SO60551 Row 2): a track /
// F-clip gains its sub finish and CPQ's cut deduction, a part made in a stock colour but quoted in another finish
// becomes the stocked colour item ("yes /C the ep4 is a mistake"), a fee cut into the rod takes the rod's finish.
// These change what the line IS — so each is listed for the person confirming, the NetSuite line to change named.
// `finishes` = 4.5's finish records; `inventory` = the library (id or code lookup).
export const rereadLinesPatchOf = ({ so, breakdown = [], finishes = [], inventory = [] }) => {
    const existing = Array.isArray(so && so.lines) ? so.lines : [];
    const fresh = rowLinesFromBreakdown(breakdown);
    const used = new Set();
    const lines = existing.map(l => ({ ...l }));
    let enriched = 0;
    const added = [];
    fresh.forEach(f => {
        // A line CPQ's rules made another item (the stock colour — `identityFrom` names what it was quoted as) is still
        // the quote's line: matched by the code it came from, never re-added.
        const sameItem = (e) => U(e.erp) === U(f.erp) || (!!e.identityFrom && [U(f.billedErp), U(f.erp)].includes(U(e.identityFrom)));
        const i = lines.findIndex((e, k) => !used.has(k) && sameItem(e) && rowKeyOf(rowOfLine(e)) === rowKeyOf(rowOfLine(f)) && N(e.qty) === N(f.qty));
        if (i < 0) { lines.push(f); used.add(lines.length - 1); added.push({ erp: f.erp, row: f.row, qty: f.qty }); return; }
        used.add(i);
        let changed = false;
        REREAD_FIELDS.forEach(k => { if (f[k] != null && f[k] !== '' && lines[i][k] == null) { lines[i][k] = f[k]; changed = true; } });
        if (changed) enriched++;
    });
    const byId = new Map((inventory || []).map(p => [String(p.id), p]));
    const byCode = new Map((inventory || []).map(p => [U(p.legacyErpId || p.itemId), p]));
    const partOfLine = (l) => byId.get(String(l.partId || '')) || byCode.get(U(l.erp)) || byCode.get(U(String(l.erp || '').split('/')[0])) || null;
    const restamped = [];
    const notes = [];
    [...new Set(lines.map(l => rowKeyOf(rowOfLine(l))))].forEach(rk => {
        const rows = lines.map((line, idx) => ({ idx, line, part: partOfLine(line) })).filter(r => rowKeyOf(rowOfLine(r.line)) === rk);
        const rs = rowRestampOf({ rows, finishes, swapIdentity: true, findByCode: (c) => byCode.get(U(c)) || null });
        Object.entries(rs.patches).forEach(([idx, patch]) => { lines[Number(idx)] = { ...lines[Number(idx)], ...patch }; });
        rs.changes.forEach(c => restamped.push({ ...c, row: rowOfLine(lines[c.idx]) }));
        rs.notes.forEach(n => notes.push({ ...n, row: rowOfLine(lines[n.idx]) }));
    });
    // ── A KIT ON THE ORDER IS ITS PARTS (Stuart 2026-09-28, Shared/itemKit) ─────────────────────────────────────────
    // A quote from before the kit rule carries the kit as ONE line (SO60551's H1-2TRV-WB/C, H1-2RCTAEC/EP1) — picked as a
    // code nobody stocks. The kit line stays (sold, billed — never made or picked); its parts are ADDED at the END of the
    // order, each tied to its kit line, so no line already on the order moves (work orders and stamps point at positions).
    const kitsExploded = [];
    const n0 = lines.length;
    for (let idx = 0; idx < n0; idx++) {
        const l = lines[idx];
        if (!l || isKitLine(l) || l.inKit) continue;
        const k = itemKitOrderLinesOf({ line: l, findByCode: (c) => byCode.get(U(c)) || null, findPart: (id) => byId.get(String(id)) || null });
        if (!k) continue;
        lines[idx] = k.kitLine;
        if (!lines.some(x => x && x.inKit && x.kitLineIdx === idx)) k.parts.forEach(pt => lines.push({ ...pt, kitLineIdx: idx }));
        kitsExploded.push({ idx, erp: U(l.erp), row: rowOfLine(l), parts: k.parts.map(pt => `${pt.qty} × ${pt.erp}${pt.finishCode ? ` · ${pt.finishCode}` : (pt.subFinishCode ? ` (shelf, else ${pt.subFinishCode})` : '')}`), missing: k.missing });
    }
    const bo = Array.isArray(so && so.backorderLines) ? so.backorderLines : [];
    // A line that became another item (the stock colour) leaves its old code's backorder records behind.
    // …and a line whose stale finish came off (an item tagged Unfinished) leaves its plated code's records too.
    const swappedFrom = new Set([...restamped.filter(c => c.netsuite || c.dropBackorder).map(c => U(c.dropBackorder || lines[c.idx].identityFrom)), ...kitsExploded.map(k => k.erp)]);
    const keptBo = ((so && so.displayRelease) ? bo.filter(r => r && r.source === 'OE_ROW') : bo).filter(r => !swappedFrom.has(U(r && r.code)));
    const droppedBackorders = bo.length - keptBo.length;
    if (!enriched && !added.length && !droppedBackorders && !restamped.length && !kitsExploded.length) return null;
    return { lines, enriched, added, droppedBackorders, backorderLines: keptBo, restamped, notes, kitsExploded };
};
export const rereadLinesText = (so, p) => [
    `↻ Re-read ${(so && (so.soId || so.id)) || ''}'s lines from its CPQ job?`,
    p.enriched ? `\n${p.enriched} line(s) gain the fields CPQ's classifier reads (part id, handling, fee flag, per-config counts, customer code…) — code, finish, quantity and position unchanged.` : '',
    p.added.length ? `\n${p.added.length} line(s) the old reader dropped are ADDED:\n${p.added.map(a => `  • ${a.qty} × ${a.erp}${a.row ? ` (${a.row})` : ' (no row — assign it)'}`).join('\n')}` : '',
    (p.restamped || []).length ? `\nCPQ's rules for these lines (the traverse track and F-clip, stock-colour parts, cuts into a rod, parts tagged Unfinished):\n${p.restamped.map(c => `  • ${c.row ? `${c.row}: ` : ''}${c.text}`).join('\n')}` : '',
    (p.kitsExploded || []).length ? `\nKits become their parts (the kit line stays, sold and billed; its parts are added at the end of the order):\n${p.kitsExploded.map(k => `  • ${k.row ? `${k.row}: ` : ''}${k.erp} → ${k.parts.join(', ')}${k.missing.length ? ` — ⚠ ${k.missing.join(', ')} not in the library` : ''}`).join('\n')}` : '',
    p.droppedBackorders ? `\n${p.droppedBackorders} backorder record(s) from the retired whole-order split or for a replaced item are removed — each row records its own when it starts.` : '',
    (p.notes || []).length ? `\nStill needs a person:\n${p.notes.map(n => `  • ${n.row ? `${n.row}: ` : ''}${n.text}`).join('\n')}` : '',
    (p.restamped || []).some(c => c.netsuite) ? '\n⚠ An item changed: change the same line in NetSuite before the order is packed, or the fulfilment ships the old item.' : '',
    (p.kitsExploded || []).length ? '\n⚠ NetSuite: the sales order must carry the kit\'s PARTS (at $0, the kit\'s price on the rollup) in place of the kit line before the order is fulfilled.' : '',
    '\nNothing is started, ordered or sent to NetSuite.',
].filter(Boolean).join('\n');

// ── ✎ A LINE'S QUANTITY (Stuart 2026-09-28, SO60551's nuts: 50 on the 9/16 quote, 100 by CPQ's rule — one nut rides each
// bracket) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Only a line nothing has been raised or gathered for — no start stamp, nothing of it in the order's committed bin — and
// never a kit or a kit's part (they change together, on the quote). The line keeps what it was, who changed it, when and
// why; NetSuite's sales order is changed by hand to match (the confirm says so). Pure.
// @returns { ok, reason?, lines?, from?, to? }
export const lineQtyEditOf = ({ so, lineIdx, qty, by = '', reason = '', now = Date.now() } = {}) => {
    const lines = Array.isArray(so && so.lines) ? so.lines : [];
    const l = lines[lineIdx];
    const n = Number(qty);
    if (!l) return { ok: false, reason: 'no such line on the order' };
    if (!(Number.isInteger(n) && n > 0)) return { ok: false, reason: 'the quantity must be a whole number above 0' };
    if (n === Number(l.qty)) return { ok: false, reason: 'the quantity is unchanged' };
    if (!String(reason || '').trim()) return { ok: false, reason: 'say why — it is recorded on the line' };
    if (isKitLine(l) || l.inKit) return { ok: false, reason: 'a kit and its parts change together — change the kit on the quote' };
    if (so.oeGen && so.oeGen[lineIdx]) return { ok: false, reason: 'work has already been raised for this line — undo the row start first' };
    if (committedQtyOf(so, soLineCodeOf(l)) > 0) return { ok: false, reason: `${soLineCodeOf(l)} is already gathered into the order — release it at SO Pack first` };
    const from = Number(l.qty) || 0;
    const next = lines.map((x, i) => (i === lineIdx ? { ...x, qty: n, qtyChangedFrom: from, qtyChangedBy: by, qtyChangedAt: now, qtyChangedReason: String(reason).trim() } : x));
    return { ok: true, lines: next, from, to: n };
};

// ── ✎ A KIT'S FINISH (Stuart 2026-09-29: "table top base back1 is ep1") ──────────────────────────────────────────────
// A kit and its parts change together (the qty edit above refuses them): the kit line takes the new finish and its parts
// are worked out again by the ONE kit rule (Shared/itemKit.itemKitOrderLinesOf) — each part the kit's finish, stock
// colour, or nothing when it is tagged Unfinished. SO60551's Base Back 1 carried two H1-2RCTAEC kits, one EP1 and one
// with no finish, so 50 of its collars read as raw aluminium. Only while nothing has been raised or gathered for the
// parts; the parts keep their place, row and link, a part that must now be made reads NOT STARTED, and ▶ Start row
// plans it by today's rules. NetSuite is changed by hand (the confirm says so). Pure.
// @returns { ok, reason?, lines?, from?, to?, parts?: [{ idx, from, to }] }
const KIT_PART_FINISH_FIELDS = ['finishCode', 'subFinishCode', 'toBeFinished', 'finishOutsourced', 'noFinish', 'stockColour'];
export const kitFinishEditOf = ({ so, lineIdx, finishCode, inventory = [], by = '', reason = '', now = Date.now() } = {}) => {
    const lines = Array.isArray(so && so.lines) ? so.lines : [];
    const kit = lines[lineIdx];
    const f = U(finishCode);
    if (!kit) return { ok: false, reason: 'no such line on the order' };
    if (!isKitLine(kit)) return { ok: false, reason: 'that line is not a kit' };
    if (!/^[A-Z0-9-]{1,8}$/.test(f)) return { ok: false, reason: 'give the finish code (EP1, P06, S04 …)' };
    if (f === U(kit.finishCode)) return { ok: false, reason: 'the kit already carries that finish' };
    if (!String(reason || '').trim()) return { ok: false, reason: 'say why — it is recorded on the kit' };
    const partIdxs = lines.map((l, i) => (l && l.inKit && l.kitLineIdx === lineIdx ? i : -1)).filter(i => i >= 0);
    if (!partIdxs.length) return { ok: false, reason: 'the kit has no parts on the order yet — ↻ Re-read lines first' };
    for (const i of partIdxs) {
        if (so.oeGen && so.oeGen[i]) return { ok: false, reason: `work has already been raised for line ${i + 1} (${lines[i].erp}) — undo the row start first` };
        if (committedQtyOf(so, soLineCodeOf(lines[i])) > 0) return { ok: false, reason: `${soLineCodeOf(lines[i])} is already gathered into the order — release it at SO Pack first` };
    }
    const byId = new Map((inventory || []).map(p => [String(p.id), p]));
    const byCode = new Map((inventory || []).map(p => [U(p.legacyErpId || p.itemId), p]));
    const k = itemKitOrderLinesOf({ line: { ...kit, finishCode: f, subFinishCode: '' }, findByCode: (c) => byCode.get(U(c)) || null, findPart: (id) => byId.get(String(id)) || null });
    if (!k) return { ok: false, reason: `${kit.erp} is not a kit in the library` };
    if (k.missing.length) return { ok: false, reason: `${k.missing.join(', ')} not in the library — the kit's parts cannot be worked out` };
    // Each part line is matched to its component by part id, else by its place among the kit's parts.
    const byPartId = new Map(k.parts.map(p => [String(p.partId), p]));
    const unmatched = [...k.parts];
    const next = lines.map(l => ({ ...l }));
    const parts = [];
    for (const [n, i] of partIdxs.entries()) {
        const old = lines[i];
        const fresh = byPartId.get(String(old.partId || '')) || unmatched[n];
        if (!fresh) return { ok: false, reason: `line ${i + 1} (${old.erp}) is not one of ${kit.erp}'s parts in the library — ↻ Re-read lines` };
        unmatched.splice(unmatched.indexOf(fresh), 1);
        const keep = { ...old };
        KIT_PART_FINISH_FIELDS.forEach(key => { delete keep[key]; });
        next[i] = { ...keep, ...fresh, qty: old.qty, kitLineIdx: lineIdx };
        const label = (l) => `${soLineCodeOf(l)}${l.subFinishCode ? ` (shelf, else ${U(l.subFinishCode)})` : (l.noFinish ? ' · no finish' : '')}`;   // the code carries its finish
        parts.push({ idx: i, from: label(old), to: label(next[i]) });
    }
    const from = U(kit.finishCode) || '—';
    next[lineIdx] = { ...next[lineIdx], finishCode: f, subFinishCode: '', finishOutsourced: isOutsourcedFinishCode(f), kitFinishChangedFrom: from, kitFinishChangedBy: by, kitFinishChangedAt: now, kitFinishChangedReason: String(reason).trim() };
    return { ok: true, lines: next, from, to: f, parts };
};

// ── ✎ A KIT'S QUANTITY — 0 TAKES IT OFF THE ORDER (Stuart 2026-09-29: "this is base so it is a single pole with one
// endcap, it needs just 50") ────────────────────────────────────────────────────────────────────────────────────
// SO60551's Base Back 1 end cap was quoted 9/16 as two lines under the kit's code (the clear cap, and its EP1 collar);
// the kit rule read each as a whole kit, so the order carried two. The kit and its parts change together: each part
// keeps its per-kit count. At 0 they are taken OFF THE ORDER (Shared/itemKit.isOffOrderLine) — kept in their places so
// every line number the floors and start stamps point at stays true; a part's STOCK stamp (a shelf pick, nothing made)
// goes with it. Refused once a part has floor work, or once the item is gathered past what the order would still need.
// NetSuite is changed by hand (the confirm says so). Pure.
// @returns { ok, reason?, lines?, from?, to?, parts?: [{ idx, code, from, to }], oeGenDrop?: [idx] }
export const kitQtyEditOf = ({ so, lineIdx, qty, by = '', reason = '', now = Date.now() } = {}) => {
    const lines = Array.isArray(so && so.lines) ? so.lines : [];
    const kit = lines[lineIdx];
    const n = Number(qty);
    if (!kit) return { ok: false, reason: 'no such line on the order' };
    if (!isKitLine(kit)) return { ok: false, reason: 'that line is not a kit' };
    if (!(Number.isInteger(n) && n >= 0)) return { ok: false, reason: 'the quantity must be a whole number — 0 takes the kit off the order' };
    const from = N(kit.qty);
    if (n === from) return { ok: false, reason: 'the quantity is unchanged' };
    if (from <= 0) return { ok: false, reason: 'the kit is off the order — put it back on the quote' };
    if (!String(reason || '').trim()) return { ok: false, reason: 'say why — it is recorded on the kit' };
    const partIdxs = lines.map((l, i) => (l && l.inKit && l.kitLineIdx === lineIdx ? i : -1)).filter(i => i >= 0);
    const stamp = { qtyChangedFrom: from, qtyChangedBy: by, qtyChangedAt: now, qtyChangedReason: String(reason).trim() };
    const off = n === 0 ? { offOrder: true } : {};
    const next = lines.map(l => ({ ...l }));
    next[lineIdx] = { ...next[lineIdx], qty: n, ...stamp, ...off };
    const parts = [], oeGenDrop = [];
    for (const i of partIdxs) {
        const g = so.oeGen && so.oeGen[i];
        if (g && g.kind !== 'STOCK') return { ok: false, reason: `work has already been raised for line ${i + 1} (${lines[i].erp}) — undo the row start first` };
        const was = N(lines[i].qty);
        const to = Math.round((was / from) * n * 1000) / 1000;
        next[i] = { ...next[i], qty: to, ...stamp, qtyChangedFrom: was, ...off };
        if (g && n === 0) oeGenDrop.push(i);
        parts.push({ idx: i, code: soLineCodeOf(lines[i]), from: was, to });
    }
    // Nothing gathered may be left without an order line to belong to.
    const after = { ...so, lines: next };
    for (const p of parts) {
        const need = next.reduce((a, l, i) => a + ((soLineCodeOf(l) === p.code && !isOffOrderLine(l) && !isKitLine(l) && !(l && l.isFee)) ? N(l.qty) : 0), 0);
        if (committedQtyOf(after, p.code) > need) return { ok: false, reason: `${committedQtyOf(after, p.code)} × ${p.code} are already gathered — more than the order would still need (${need}); release them at SO Pack first` };
    }
    return { ok: true, lines: next, from, to: n, parts, oeGenDrop };
};

// ── ↩ UNDO A ROW START — only while nothing on its documents has moved (Stuart 2026-09-27) ─────────────────
// A row started under an older rule (SO60551's ROW 1 without its French returns; Row 2's stained fascia sent to
// finishing as a small part) is put back: its pair's documents are removed through the ledger and its lines read
// NOT STARTED, so ▶ Start row writes it again under today's rules. Refused — with the reasons — once anything has
// moved: a pick, a stage, a shop start, a coat, a pack or a gather, or make-up the pair raised (converts,
// component work orders, rod cuts, purchase orders), which is closed by a person on RTG who can see it.
export const rowUndoBlockersOf = ({ hqs = [], fins = [], shops = [], gatheredCodes = [] } = {}) => {
    const out = [];
    const finsMoved = (fins || []).filter(f => !(f && f.pickOnly === true && U(f.currentPhase) === 'COMPLETE'));   // a pick-only doc is BORN Complete
    retireBlockersOf({ fins: finsMoved, shops }).forEach(b => out.push(b));
    (fins || []).filter(f => f && f.pickOnly === true).forEach(f => {
        if (!['', 'PENDING'].includes(U(f.pickStatus))) out.push(`${f.id} has been picked (${f.pickStatus})`);
        if (f.packStatus) out.push(`${f.id} has been ${String(f.packStatus).toLowerCase()}`);
    });
    (fins || []).forEach(f => { if (f && f.stagingStatus) out.push(`${f.id} is staged (${f.stagingStatus})`); });
    (hqs || []).forEach(h => {
        if (!h) return;
        if (h.awaitingConvert || (h.convertIds && h.convertIds.length)) out.push(`${h.id} raised a phosphate convert`);
        if ((h.componentShopWoIds || []).length) out.push(`${h.id} raised component work orders`);
        if (h.rodCutId) out.push(`${h.id} raised rod cut ${h.rodCutId}`);
        if (h.awaitingReceipt || (h.receiptPoIds || []).length) out.push(`${h.id} is waiting on a purchase order`);
        if (h.nsWoId) out.push(`${h.id} has NetSuite work order ${h.nsWoTran || h.nsWoId}`);
    });
    (gatheredCodes || []).forEach(c => out.push(`${c} is already gathered into the order at SO Pack`));
    return [...new Set(out)];
};
