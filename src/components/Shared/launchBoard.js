// ── 12.7 LAUNCH — the day's orders, line by line, and what to do with each (S7, 2026-10-20) ─────────
//
// Stuart: "we need a more focused screen for all the brands that just address launching the orders … list the daily
// orders and click each one open and decide what to do, release partial lines … orders that are entirely in stock can
// go straight to auto release just like Classical. only difference the throws for uniquity never hit the floor they can
// go straight to be picked, packed, shipped as long as they are paid. the orders that have some pillows with throws we
// need to look at to decide whether to ship the throws ahead or wait for the pillows … we could use this screen even
// for Classical when we want to release partial orders as well." Decisions: tab 12.7; HOLD as the default for a mixed
// order; a second shipment per order is fine.
//
// THE RULE, pure. Every line of a stocked (Order Entry / counter) sales order is one KIND:
//   SHELF        picked off the shelf (a throw, a stocked pillow, any stocked item)
//   SEW          made at Stitch & Sew (a pillow line — madeToOrder SEW / pillow)
//   FINISH       made on the finishing floor (a to-be-finished line)
//   FLOOR        made on a floor though it wears nothing (a cut length, a WO line)
//   PLACEHOLDER  a quick-add still to identify (the NetSuite order waits on it)
//   FEE / HIDDEN a fee, a kit face, a $0 making — never picked, never decided
// and one LAUNCH STATE for a SHELF line:
//   AUTO      no decision needed — the order has no SEW line, so the warehouse picks it as it always has
//   HELD      waiting on the office (a mixed order's shelf lines, by default) or held by hand
//   RELEASED  released by hand — the warehouse may pick it now (Ship ahead)
// The decision lives on the record: `launch: { mode: 'HOLD' | 'SHIP_AHEAD' | 'PARTIAL', lines: { [idx]: { state, by, at,
// note } }, decidedAt, decidedBy }`. No marker = today's behaviour for every order that has no SEW line.
//
// The pick side (Shared/pickLines.pickableLinesOf) reads `lineIsLaunchHeld` — a SHELF line that is HELD is not picked
// until released. A mixed order with no decision holds its shelf lines; an order with FINISH + SHELF but no SEW line is
// NOT held by default (Classical keeps picking stock while the floor works, exactly as today) — the office holds a
// Classical line by hand on 12.7 when it wants a partial.

// PHASE 2 (S7, 2026-10-20 — Stuart: "build it here with clearance … second shipment/fulfillment is fine and acceptable in
// netsuite and how we do it now"). THE WAREHOUSE HONOURS THE DECISION, through the one reader every WMS screen already
// asks (Shared/pickLines): a HELD line is not a pull line, not part of the order's need (soCodeNeedOf), not a pack line.
// A decided order PACKS WHAT IS IN ITS BIN (shipmentPlanOf) — the released shelf lines picked into it, a made line
// gathered into it — and when something stays behind (held, or still being sewn) the pack is a SHIPMENT: its own
// record on the sales-order route, born packed, pointing at the SAME NetSuite sales order (launchShipmentOf — the
// display shipment's model, Shared/displayShipment, less the $0 order), fulfilled for ITS lines only
// (shipmentFulfilItemsOf) and shipped from the Fulfilment tab like any packed order. The parent order keeps the rest,
// goes back to Pending, and packs again when the rest is in the bin; its LAST pack is the ordinary ✓ Packed, whose
// whole-order fulfilment takes exactly what is still open in NetSuite.
import { isPlaceholderLine } from './placeholderLine.js';
import { oeIsTbf } from './oeLines.js';
import { soLineIsFee, soLineIsShelfPick, soLineCodeOf } from './pickLines.js';
import { committedQtyOf } from './committedBins.js';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

export const LAUNCH_KINDS = ['SHELF', 'SEW', 'FINISH', 'FLOOR', 'PLACEHOLDER', 'FEE'];
export const LAUNCH_STATES = ['AUTO', 'HELD', 'RELEASED'];
export const LAUNCH_MODES = { HOLD: 'HOLD', SHIP_AHEAD: 'SHIP_AHEAD', PARTIAL: 'PARTIAL' };

export const isSewLine = (l) => !!l && (up(l.madeToOrder) === 'SEW' || !!l.pillow);

/** One line's kind. */
export function launchLineKindOf(so, l, idx) {
    if (!l) return 'FEE';
    if (isPlaceholderLine(l)) return 'PLACEHOLDER';
    if (l.inKit || l.ooakPart || l.hidden) return 'FEE';
    if (soLineIsFee(so, l, idx)) return 'FEE';
    if (isSewLine(l)) return 'SEW';
    if (oeIsTbf(l)) return 'FINISH';
    if (!soLineIsShelfPick(so, l, idx)) return 'FLOOR';
    return 'SHELF';
}

/** The order is MIXED when a SEW line and a SHELF line share it — the case the office decides. */
export const launchIsMixed = (so) => {
    const kinds = ((so && so.lines) || []).map((l, i) => launchLineKindOf(so, l, i));
    return kinds.includes('SEW') && kinds.includes('SHELF');
};

/** A SHELF line's launch state. */
export function launchLineStateOf(so, idx) {
    const d = so && so.launch && so.launch.lines && so.launch.lines[idx];
    if (d && (d.state === 'RELEASED' || d.state === 'HELD')) return d.state;
    if (so && so.launch && so.launch.mode === LAUNCH_MODES.SHIP_AHEAD) return 'RELEASED';
    return launchIsMixed(so) ? 'HELD' : 'AUTO';
}

/** The pick side's one question: is this line held back from the shelf pick? */
export const lineIsLaunchHeld = (so, l, idx) => launchLineKindOf(so, l, idx) === 'SHELF' && launchLineStateOf(so, idx) === 'HELD';

/**
 * The order on the board.
 *   docsOf(so) → the order's work orders / documents (hq_work_orders with soAppId) — a SEW / FINISH line with one is STARTED
 * → { id, number, customer, brand, kinds: {SHELF,SEW,…counts}, mixed, lines: [{ idx, line, kind, state, started, doc }],
 *    shelf: { total, held, released, auto }, suggestion, backorders, placeholders, nsAccepted, closed }
 */
export function launchOrderOf(so, { docs = [], startedOf = null } = {}) {
    const lines = ((so && so.lines) || []).map((l, idx) => {
        const kind = launchLineKindOf(so, l, idx);
        const made = kind === 'SEW' || kind === 'FINISH' || kind === 'FLOOR';
        // STARTED = the line has a live document: the caller's coverage rule (RTG's oeCoverageOf) when given, else a document
        // naming the line by index
        const doc = made ? ((docs || []).find(d => d && !d.deleted && (d.lineIdx === idx || (Array.isArray(d.lineIdxs) && d.lineIdxs.includes(idx)) || (d.soLineIdx === idx))) || null) : null;
        const started = made && (typeof startedOf === 'function' ? !!startedOf(so, l, idx) : !!doc);
        return { idx, line: l, kind, state: kind === 'SHELF' ? launchLineStateOf(so, idx) : '', started, doc };
    });
    const kinds = {};
    LAUNCH_KINDS.forEach(k => { kinds[k] = lines.filter(x => x.kind === k).length; });
    const shelfLines = lines.filter(x => x.kind === 'SHELF');
    const shelf = { total: shelfLines.length, held: shelfLines.filter(x => x.state === 'HELD').length, released: shelfLines.filter(x => x.state === 'RELEASED').length, auto: shelfLines.filter(x => x.state === 'AUTO').length };
    const mixed = kinds.SEW > 0 && kinds.SHELF > 0;
    const st = up(so && (so.status || so.pickStatus));
    const closed = st === 'CLOSED' || st === 'CANCELLED' || !!(so && (so.closed || so.currentPhase === 'Closed'));
    const nsAccepted = !!(so && so.nsInternalId);
    const placeholders = kinds.PLACEHOLDER;
    const makes = lines.filter(x => (x.kind === 'SEW' || x.kind === 'FINISH') && !x.started).length;
    let suggestion = 'AUTO';
    if (closed) suggestion = 'CLOSED';
    else if (placeholders) suggestion = 'IDENTIFY';
    else if (!nsAccepted) suggestion = 'WAIT_NS';
    else if (mixed && shelf.held > 0 && !(so.launch && so.launch.decidedAt)) suggestion = 'DECIDE';
    else if (makes > 0) suggestion = 'START';
    else if (shelf.held > 0) suggestion = 'HELD';
    return {
        id: so.id, number: so.soId || so.id, customer: str(so.customer), brand: str(so.brand), createdAt: Number(so.createdAt) || Number(so.nsQueuedAt) || 0,
        kinds, mixed, lines, shelf, suggestion, closed, nsAccepted,
        backorders: Array.isArray(so.backorderLines) ? so.backorderLines : [], placeholders,
        decided: !!(so.launch && so.launch.decidedAt), mode: str(so.launch && so.launch.mode),
    };
}

/** The patch for a decision: `lineIdxs` to `state`, under `mode`; merged over what was decided before. */
export function launchPatchOf(so, { lineIdxs = [], state = 'RELEASED', mode = '', by = '', at = 0, note = '' } = {}) {
    const now = at || Date.now();
    const prev = (so && so.launch) || {};
    const lines = { ...(prev.lines || {}) };
    (lineIdxs || []).forEach(i => { lines[i] = { state, by: str(by), at: now, ...(str(note) ? { note: str(note) } : {}) }; });
    return { launch: { ...prev, mode: str(mode) || str(prev.mode) || LAUNCH_MODES.PARTIAL, lines, decidedAt: now, decidedBy: str(by) } };
}

/** Ship ahead = every SHELF line released now; Hold = every SHELF line held until the office says. */
export const shipAheadPatchOf = (so, { by = '', at = 0 } = {}) => launchPatchOf(so, { lineIdxs: ((so && so.lines) || []).map((l, i) => (launchLineKindOf(so, l, i) === 'SHELF' ? i : -1)).filter(i => i >= 0), state: 'RELEASED', mode: LAUNCH_MODES.SHIP_AHEAD, by, at, note: 'ship ahead' });
export const holdAllPatchOf = (so, { by = '', at = 0, note = '' } = {}) => launchPatchOf(so, { lineIdxs: ((so && so.lines) || []).map((l, i) => (launchLineKindOf(so, l, i) === 'SHELF' ? i : -1)).filter(i => i >= 0), state: 'HELD', mode: LAUNCH_MODES.HOLD, by, at, note: note || 'hold until the made lines are ready' });

/** The board's rows: open orders of the brand within the window, newest first. */
export const launchRowsOf = (orders = [], { brand = '', sinceMs = 0, docsOf = () => [], startedOf = null } = {}) => (orders || [])
    .filter(so => so && (!brand || str(so.brand) === brand) && (!sinceMs || (Number(so.createdAt) || Number(so.nsQueuedAt) || 0) >= sinceMs))
    .map(so => launchOrderOf(so, { docs: docsOf(so), startedOf }))
    .filter(r => !r.closed)
    .sort((a, b) => b.createdAt - a.createdAt);

export const SUGGESTION_WORDS = {
    AUTO: 'on the shelf — picked as it is',
    DECIDE: 'pillows + shelf lines — decide: ship the shelf lines ahead, or hold them until the pillows are sewn',
    START: 'lines to make — start them',
    HELD: 'shelf lines held — release when ready',
    IDENTIFY: 'a quick-add to identify first (RTG or the CRM)',
    WAIT_NS: 'waiting for NetSuite to accept the order',
    CLOSED: 'closed',
};

// ── PHASE 2: SHIPMENTS ────────────────────────────────────────────────────────────────────────────────

/** The shipments an order has sent, in order (`shipments` is a map keyed by n, so the outbox can stamp into one). */
export const shipmentsOf = (so) => Object.values((so && so.shipments) || {}).filter(Boolean).sort((a, b) => num(a.n) - num(b.n));

/** Is this record a shipment of a parent order (born packed; ships from the Fulfilment tab; never picked)? */
export const isShipmentRecord = (d) => !!d && d.packMode === 'SHIPMENT' && !!d.shipmentOf;
/** The NetSuite sales order a sales-order-route record fulfils against: a shipment's parent's, else its own. */
export const nsSoIdOfRecord = (d) => str(d && (d.shipmentOfNsId || d.nsInternalId || ''));

/**
 * THE NEXT SHIPMENT of a DECIDED order — null for an order with no Launch decision (it packs whole, as it always has).
 *   pack     ships now: a line whose pieces are in the order's bin (committedOf(so, code) covers it, in line order)
 *   held     a SHELF line HELD on 12.7 — not picked, not packed, not fulfilled until released
 *   waiting  a line whose pieces are not in the bin yet (a pillow still at Stitch & Sew, a released line not picked yet)
 *   shipped  a line already gone in an earlier shipment (its code's shippedQty covers it, in line order)
 * partial = something stays behind, so this pack is a SHIPMENT and not the order's ✓ Packed.
 */
export function shipmentPlanOf(so, { committedOf = committedQtyOf } = {}) {
    if (!so || !so.launch) return null;
    const shippedLeft = {};
    Object.entries((so && so.shippedQty) || {}).forEach(([c, q]) => { shippedLeft[up(c)] = num(q); });
    const binLeft = {};
    const pack = [], held = [], waiting = [], shipped = [];
    ((so && so.lines) || []).forEach((l, idx) => {
        const kind = launchLineKindOf(so, l, idx);
        if (kind === 'FEE' || kind === 'PLACEHOLDER') return;
        const code = up(soLineCodeOf(l)), qty = num(l && l.qty);
        if (!code || !(qty > 0)) return;
        if ((shippedLeft[code] || 0) >= qty) { shippedLeft[code] -= qty; shipped.push(idx); return; }
        if (lineIsLaunchHeld(so, l, idx)) { held.push(idx); return; }
        if (binLeft[code] == null) binLeft[code] = num(committedOf(so, code));
        if (binLeft[code] >= qty) { binLeft[code] -= qty; pack.push(idx); return; }
        waiting.push(idx);
    });
    return { pack, held, waiting, shipped, partial: held.length + waiting.length > 0, n: shipmentsOf(so).length + 1 };
}

/** What the lines shipping now are worth — the line's own total, else price × qty; before any order discount (the stricter side). */
export const shipmentAmountOf = (lines = []) => r2((lines || []).reduce((s, l) => s + (l ? (l.total != null ? num(l.total) : num(l.price) * num(l.qty)) : 0), 0));

// The header fields a shipment carries from its parent — what the Fulfilment tab reads (Shared/fulfilment.shipToOf),
// the packing list and the label. Nothing of the parent's pick / pack / pay / launch state crosses over.
const SHIPMENT_HEADER_FIELDS = ['brand', 'customer', 'customerId', 'customerName', 'customerEmail', 'shippingMethod', 'customShippingAddress', 'shippingAddressId', 'needBy', 'needByDate', 'poNumber', 'customerPo', 'salesRep', 'blindShip', 'shipNotes', 'productionNotes'];

/**
 * THE SHIPMENT RECORD: its own document on the sales-order route (hq_sales_orders, Quick Ship class), born PACKED with the
 * lines of the plan's `pack`, the boxes and the photos of this pack, pointing at the parent's NetSuite sales order
 * (the fulfilment is a second fulfilment of THAT order — Stuart 2026-10-20). `give` = what the parent's bin gives up,
 * per code (its app count, and NetSuite's record of the bin, since the fulfilment takes them out of it).
 */
export function launchShipmentOf({ parent = {}, plan = null, by = '', now = Date.now(), boxes = null, photos = [] } = {}) {
    if (!parent || !plan) return { ok: false, why: 'no shipment plan' };
    if (!plan.partial) return { ok: false, why: 'nothing stays behind — this pack is the order\'s ✓ Packed, not a shipment' };
    if (!plan.pack.length) return { ok: false, why: `nothing is in ${str(parent.committedBin) || 'the order\'s bin'} to ship — pick the released shelf lines into it first (⤓)` };
    if (!str(parent.nsInternalId)) return { ok: false, why: 'NetSuite has not accepted the order yet — its fulfilment needs the NetSuite sales order' };
    const n = Math.max(1, Math.floor(num(plan.n)) || 1);
    const soRef = str(parent.soId || parent.id);
    const id = `QS-SHP-${soRef}-${String(n).padStart(2, '0')}`;
    const lines = plan.pack.map(idx => ({ ...(parent.lines[idx] || {}), parentLineIdx: idx }));
    const give = {};
    lines.forEach(l => { const c = up(soLineCodeOf(l)); give[c] = r3((give[c] || 0) + num(l.qty)); });
    const head = {};
    SHIPMENT_HEADER_FIELDS.forEach(k => { if (parent[k] !== undefined && parent[k] !== null) head[k] = parent[k]; });
    const doc = {
        ...head,
        id, orderClass: 'QUICKSHIP', source: 'LAUNCH_SHIP', status: 'Pending', pickStatus: 'Pending',
        // The parent's NetSuite order, under ITS OWN name — never `nsInternalId`: every reader that finds an order by that field
        // (the Payments callable's limit(1), the Fulfilment tab's send, the stock holds) must keep finding the PARENT.
        soId: soRef, shipmentOfNsId: str(parent.nsInternalId),
        shipmentOf: str(parent.id), shipmentOfSoId: soRef, shipmentNo: n,
        jobName: `Shipment ${n} of ${soRef}${str(parent.jobName) ? ` — ${str(parent.jobName)}` : ''}`,
        lines,
        totalParts: lines.reduce((a, l) => a + num(l.qty), 0),
        shipmentAmount: shipmentAmountOf(lines),
        packStatus: 'Packed', packMode: 'SHIPMENT', packedAt: now, packedBy: str(by), packBoxes: boxes || {}, packPhotos: photos || [],
        packedLines: Object.fromEntries(lines.map((l, i) => [`L${i}`, { qty: num(l.qty), by: str(by), at: now, boxes: [] }])),
        fulfilFromBin: str(parent.committedBin), createdAt: now, createdBy: str(by),
    };
    const record = { n, id, at: now, by: str(by), lineIdxs: plan.pack.slice(), codes: give, amount: doc.shipmentAmount, heldIdxs: plan.held.slice(), waitingIdxs: plan.waiting.slice() };
    return { ok: true, why: '', id, n, doc, give, record };
}

/**
 * THE SHIPMENT'S FULFILMENT LINES: of the NetSuite sales order's open lines (Shared/fulfilmentLines.fulfilmentItemsOf —
 * `items` with their `rows`), only those the shipment carries, at the shipment's quantity (never more than is open),
 * taken from `bin` (the parent order's bin, as the display shipment does). A shipment line NetSuite has no open line
 * for is `missing`; a shipment with nothing to fulfil is not ok.
 */
export function shipmentFulfilItemsOf({ items = [], rows = [], lines = [], bin = '' } = {}) {
    const openOf = (r) => r3(num(r && r.qty) - num(r && r.shipped));
    const pool = (items || []).map(it => {
        const r = (rows || []).find(x => Number(x.line) === Number(it.orderLine)) || {};
        return { it, code: up(r.item), open: openOf(r) };
    }).filter(x => x.code && x.open > 0);
    const out = [], missing = [];
    (lines || []).forEach(l => {
        const code = up(soLineCodeOf(l));
        let want = num(l && l.qty);
        if (!code || !(want > 0)) return;
        let took = 0;
        for (const x of pool) {
            if (x.code !== code || !(x.open > 0) || !(want > 0)) continue;
            const q = r3(Math.min(x.open, want));
            x.open = r3(x.open - q); want = r3(want - q); took = r3(took + q);
            const prev = out.find(o => o.orderLine === x.it.orderLine);
            if (prev) prev.quantity = r3(prev.quantity + q);
            else out.push({ ...x.it, quantity: q, ...(str(bin) ? { inventoryDetail: { inventoryAssignment: { items: [{ binNumber: { refName: str(bin) }, quantity: q }] } } } : {}) });
        }
        if (str(bin)) out.filter(o => o.inventoryDetail).forEach(o => { o.inventoryDetail.inventoryAssignment.items[0].quantity = o.quantity; });
        if (!(took > 0)) missing.push({ code, qty: num(l.qty), name: str(l && l.name) });
    });
    if (!out.length) return { ok: false, reason: missing.length ? 'LINES_NOT_OPEN' : 'NOTHING_TO_FULFIL', items: [], missing };
    return { ok: true, reason: '', items: out, missing };
}

/** The words beside a shipment on a card. */
export const shipmentWordsOf = (s) => (s ? `Shipment ${s.n} · ${Object.entries(s.codes || {}).map(([c, q]) => `${q} × ${c}`).join(', ')}${s.by ? ` · ${s.by}` : ''}` : '');
