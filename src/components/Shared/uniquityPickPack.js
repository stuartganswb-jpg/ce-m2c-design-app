// ── THE UNIQUITY PICK CHANNEL, pure (S7, 2026-10-20) ────────────────────────────────────────────────────────────────
//
// Stuart: "we need a separate pick/pack for uniquity, it is a totally different team that pulls and ships these from the
// classical team. it is simple as we just need a pick channel for these orders above that are clicked ok to ship, it
// appears in order for them, by order/customer and they click the block need to mark each one packed and eventually
// marked each one shipped." · "own uniquity pick pack" · "same as classical, direct integration with ups, just a different
// ups account#" · "yes once stitch and sew say its complete, we are going to keep all these steps clean and simple".
//
// The channel reads what 12.7 decided (Shared/launchBoard) and what Stitch & Sew finished (a sewing document of the order,
// fin_workorders division SEW, currentPhase Complete), and shows each order as ONE block:
//   TO PACK   every line that is OK to ship is in hand: the shelf lines not held, the pillows sewn — one press packs it
//   WAITING   something is not here yet (a pillow at Stitch & Sew, a line held on 12.7, a quick-add to identify, a mixed
//             order 12.7 has not decided) — the block says what
//   SHIP      packed; the UPS label and the tracking are the Fulfilment panel's (Shared/fulfilmentPanel), brand uniquity
// No order bin, no bin scans, no photos: "in hand" is what the block says, and the NetSuite fulfilment takes the pieces
// from the item's bin. A partial (released lines while pillows are still sewn) is a SHIPMENT child exactly as the WMS
// makes one (Shared/launchShipment) — the same record, the same NetSuite path.
import { isQuickShip, soLineCodeOf } from './pickLines.js';
import { committedQtyOf } from './committedBins.js';
import { launchLineKindOf, launchLineStateOf, launchIsMixed, shipmentPlanOf, shipmentsOf, isShipmentRecord } from './launchBoard.js';

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** The sewing documents of an order (fin_workorders, division SEW), live ones first. */
export const sewDocsOf = (so, sewDocs = []) => (sewDocs || []).filter(d => d && !d.deleted && str(d.division).toUpperCase() === 'SEW'
    && (str(d.salesOrderId) === str(so && so.id) || str(d.soAppId) === str(so && so.id) || str(d.orderKey) === str(so && so.id)));
const sewDone = (d) => !!d && (d.currentPhase === 'Complete' || d.stepStatus === 'Complete' || !!d.completedAt);

/** Is this pillow line sewn? — a sewing document naming the line (soLineIdxs) is Complete; with no document naming lines, any Complete document of the order. */
export const sewLineReadyOf = (so, idx, sewDocs = []) => {
    const docs = sewDocsOf(so, sewDocs);
    const naming = docs.filter(d => Array.isArray(d.soLineIdxs) && d.soLineIdxs.includes(idx));
    if (naming.length) return naming.every(sewDone);
    return docs.length > 0 && docs.every(sewDone);
};

/**
 * One line's reading for the channel: { kind, ready, why }.
 *   SHELF  ready unless HELD on 12.7 · SEW ready once sewn · FINISH / FLOOR ready once gathered into the order's bin
 *   FEE never counts · PLACEHOLDER waits on the office
 */
export const channelLineOf = (so, l, idx, { sewDocs = [] } = {}) => {
    const kind = launchLineKindOf(so, l, idx);
    if (kind === 'FEE') return { kind, ready: false, why: '' };
    if (kind === 'PLACEHOLDER') return { kind, ready: false, why: 'a quick-add to identify first (RTG or the CRM)' };
    if (kind === 'SHELF') { const st = launchLineStateOf(so, idx); return st === 'HELD' ? { kind, ready: false, why: 'held on 12.7 Launch' } : { kind, ready: true, why: '' }; }
    if (kind === 'SEW') return sewLineReadyOf(so, idx, sewDocs) ? { kind, ready: true, why: '' } : { kind, ready: false, why: 'at Stitch & Sew' };
    const code = up(soLineCodeOf(l));
    return committedQtyOf(so, code) >= num(l && l.qty) ? { kind, ready: true, why: '' } : { kind, ready: false, why: 'made on a floor — not gathered yet' };
};

/**
 * THE BLOCK for one order. → { so, stage: 'TO PACK' | 'WAITING' | 'SHIP' | 'OFF', lines: [{ idx, line, kind, ready, why, shipped }],
 *   pack: [idx], waiting: [{ idx, why }], shipped: [idx], plan (Shared/launchBoard.shipmentPlanOf, null without a decision),
 *   partial, note, shipments }
 * OFF = not this channel's (closed, shipped, NetSuite not yet accepted, a shipment child — the panel's).
 */
export function channelOrderOf(so, { sewDocs = [] } = {}) {
    const st = str(so && (so.status || so.pickStatus));
    const closed = !so || so.closed === true || ['Closed', 'CANCELLED', 'Cancelled', 'Deleted', 'Shipped'].includes(st) || so.currentPhase === 'Closed';
    const base = { so, lines: [], pack: [], waiting: [], shipped: [], plan: null, partial: false, note: '', shipments: shipmentsOf(so) };
    if (closed || !isQuickShip(so) || isShipmentRecord(so)) return { ...base, stage: 'OFF' };
    if (!str(so.nsInternalId)) return { ...base, stage: 'WAITING', note: st === 'HELD_PLACEHOLDER' ? 'held — a quick-add to identify first (RTG or the CRM)' : 'waiting for NetSuite to accept the order' };
    if (so.packStatus === 'Packed') return { ...base, stage: 'SHIP', note: so.shipHold ? `waiting for payment — ${str(so.shipHold.why)}` : 'packed — the label and the tracking are on the Ship side' };
    // "in hand" per code: the ready lines (plus anything already gathered into a bin) — what the shipment plan reads as the bin
    const readyByCode = {};
    const lines = ((so.lines) || []).map((l, idx) => {
        const r = channelLineOf(so, l, idx, { sewDocs });
        if (r.ready) { const c = up(soLineCodeOf(l)); readyByCode[c] = (readyByCode[c] || 0) + num(l && l.qty); }
        return { idx, line: l, ...r, shipped: false };
    });
    const inHandOf = (o, code) => (readyByCode[up(code)] || 0) + committedQtyOf(o, code);
    const plan = shipmentPlanOf(so, { committedOf: inHandOf });
    let pack = [], waiting = [], shipped = [];
    if (plan) {
        pack = plan.pack; shipped = plan.shipped;
        waiting = [...plan.held.map(idx => ({ idx, why: 'held on 12.7 Launch' })), ...plan.waiting.map(idx => ({ idx, why: (lines[idx] && lines[idx].why) || 'not in hand yet' }))];
    } else if (launchIsMixed(so)) {
        // pillows beside shelf lines and no decision yet: 12.7 decides — ship the shelf lines ahead, or hold them
        waiting = lines.filter(x => x.kind !== 'FEE').map(x => ({ idx: x.idx, why: x.kind === 'SHELF' ? 'waiting for 12.7 Launch to decide' : x.why || 'at Stitch & Sew' }));
    } else {
        const live = lines.filter(x => x.kind !== 'FEE');
        pack = live.filter(x => x.ready).map(x => x.idx);
        waiting = live.filter(x => !x.ready).map(x => ({ idx: x.idx, why: x.why }));
        // an undecided order ships whole, as it always has: anything not in hand holds the block
        if (waiting.length) pack = [];
    }
    lines.forEach(x => { x.shipped = shipped.includes(x.idx); });
    const partial = !!(plan && plan.partial);
    const stage = pack.length ? 'TO PACK' : 'WAITING';
    const note = stage === 'TO PACK'
        ? (partial ? `ships ${pack.length} line${pack.length === 1 ? '' : 's'} now as shipment ${plan.n}; ${waiting.length} stay${waiting.length === 1 ? 's' : ''} behind` : `every line in hand — pack it`)
        : (waiting.length ? [...new Set(waiting.map(w => w.why))].join(' · ') : 'nothing to pack');
    return { so, stage, lines, pack, waiting, shipped, plan, partial, note, shipments: shipmentsOf(so) };
}

/** The channel's blocks: the brand's orders, oldest first, TO PACK before WAITING; the SHIP side is the panel's own list. */
export const channelRowsOf = (orders = [], { brand = 'uniquity', sewDocs = [] } = {}) => (orders || [])
    .filter(so => so && (!brand || str(so.brand) === brand))
    .map(so => channelOrderOf(so, { sewDocs }))
    .filter(r => r.stage === 'TO PACK' || r.stage === 'WAITING')
    .sort((a, b) => (a.stage === b.stage ? (num(a.so.createdAt) - num(b.so.createdAt)) : (a.stage === 'TO PACK' ? -1 : 1)));

/** The whole-order PACKED stamp — what the WMS pack bench writes, less the boxes and the photos the channel does not take. */
export const channelPackedPatchOf = (so, packIdxs = [], { by = '', now = Date.now() } = {}) => ({
    status: 'Picked', pickStatus: 'Picked', pickedAt: now, pickedBy: str(by) || 'Packer', pickInProgress: null,
    packStatus: 'Packed', packedAt: now, packedBy: str(by) || 'Packer', packInProgress: null, packBoxes: {},
    packedLines: Object.fromEntries((packIdxs || []).map(i => [`L${i}`, { qty: num(((so && so.lines) || [])[i] && so.lines[i].qty), by: str(by), at: now, boxes: [] }])),
    packedFrom: 'UNIQ_PICKPACK',
});

/** The words on a block's lines. */
export const channelLineWords = (x) => (x.shipped ? 'shipped' : x.ready ? (x.kind === 'SEW' ? 'sewn — in hand' : 'on the shelf') : x.why);
