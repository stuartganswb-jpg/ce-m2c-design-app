// THE PLATED TRIPLE, ISSUED ONCE (Brief A, A3 — Stuart 2026-09-02, Q4 second pass).
//
// Every plated item is a complete assembly whose BOM names its mill core, with an outsourced
// finish (EP*, MEP*, P25). One short — at the ROP load, on the Sales Snapshot, on the Library
// card, on an Order Entry line — produces, together:
//   1. a PLATING DEMAND for the core: the WMS Plating tab pulls it from stock, moves its bin to
//      OB PLATING and stages it for the weekly shipment. "The plating tab is the connection
//      between the PO for the outsourced finish and the actual component."
//   2. a SHOP WORK ORDER for the core, only when the core is short — milled first, then plated.
//   3. NO purchase order. The plater's PO is issued BY THE WMS SHIPMENT, weekly, with the shipped
//      quantities and the plating fees (the S5 exception Stuart named; BRIEF_D line 30).
//
// Three screens wrote their own copy of (1) and two of (2); they call this now. The demand's doc
// shape is FROZEN — Brief D's reader consumes it as-is; tell D before adding a field.

import { db } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { finishSuffixOf, isOutsourcedFinishCode, millBaseOf } from './finishRouting.js';
import { parkWorkOrder, INTENT, ParkRefusal } from './workOrderCreate';

let seq = 0;

// Which parkWorkOrder `source` a demand origin maps to — the same words on the RTG board.
const WO_SOURCE = { stockview: 'STOCKVIEW_PO_BUILDER', snapshot: 'SALES_SNAPSHOT', 'library-wo': 'LIBRARY_MAKEUP', 'oe-needs': 'OE_REVIEW' };

/**
 * Issue a plated demand (and the core-short milling order behind it).
 *
 * @param {object} p
 * @param {string}  p.target         the plated code (H1-75DS/EP1)
 * @param {string}  [p.base]         the core (defaults to millBaseOf(target))
 * @param {number}  p.qty            plated pieces wanted
 * @param {string}  p.brand
 * @param {string}  p.from           demand `source` as the WMS shows it: 'stockview' | 'snapshot' | 'library-wo' | 'oe-needs'
 * @param {string}  [p.createdBy]
 * @param {object[]} [p.inventory]   library records (resolves the base part for the WO and the demand's baseItemId)
 * @param {number|null} [p.coreAvailable]  live core stock the CALLER read (its own formula: on hand, or on hand + inbound + what
 *                                          was typed on the base row this press). null = not checked → no milling order, said so.
 * @param {string}  [p.finishName]   the outsource-finish record's name (defaults to the code)
 * @param {string}  [p.note]
 * @param {object}  [p.extra]        extra demand fields already in the frozen shape: soAppId, customerId, customerName,
 *                                   parentAssemblyErp, parentAssemblyQty
 * @param {string}  [p.reqDate]
 * @param {string}  [p.woSource]     parkWorkOrder `source` for the core-short order (defaults by `from`)
 * @returns {{ demandId, woNum, shopWoId: string|null, coreShort: number, made: string[] }}
 * @throws {Error} when the target's suffix is not an outsourced finish — nothing written
 */
export const issuePlatedDemand = async ({
    target, base = '', qty, brand, from, createdBy = '', inventory = [], coreAvailable = null,
    finishName = '', note = '', extra = {}, reqDate = '', woSource = '',
}) => {
    const tgt = String(target || '').toUpperCase();
    const finishCode = finishSuffixOf(tgt);
    if (!finishCode || !isOutsourcedFinishCode(finishCode)) throw new Error(`${tgt || '(blank)'} does not carry an outsourced finish — a plating demand needs an EP/MEP/P25 code.`);
    const core = String(base || millBaseOf(tgt)).toUpperCase();
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const B = String(brand || '').toUpperCase();
    const partOf = (c) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === c) || null;
    const basePart = partOf(core);
    const made = [];

    // 1. THE DEMAND — the frozen shape PickPack reads (baseErpId/targetErpId/finishCode/qty/woNum/status).
    const demandId = `PLD-${B}-${Date.now()}-${++seq}`;
    const woNum = `PLW-${B}-${(Date.now() + seq).toString().slice(-6)}`;
    await setDoc(doc(db, 'plating_demand', demandId), {
        id: demandId, brandId: brand, status: 'open', woNum,
        baseItemId: basePart ? basePart.id : null, baseErpId: core, targetErpId: tgt,
        finishCode, finishName: finishName || finishCode, qty: n,
        source: from, ...(note ? { note } : {}), ...extra,
        createdBy, createdAt: Date.now(),
    });
    made.push(`⚡ PLATING DEMAND ${woNum}: ${n} × ${core} → ${tgt} (WMS Plating tab)`);

    // 2. THE CORE, IF SHORT — a milling order parked in RTG, routed SHOP, released on its own.
    let shopWoId = null, coreShort = 0;
    if (coreAvailable == null) {
        made.push(`ℹ ${core}: core stock not checked on this screen — order the core on the RAW view if it is short`);
    } else {
        coreShort = Math.max(0, n - Math.max(0, Number(coreAvailable) || 0));
        if (coreShort > 0 && !basePart) {
            made.push(`⚠ ${core} is not in the library — core short ${coreShort}, no milling WO raised; add/sync it`);
        } else if (coreShort > 0) {
            try {
                const res = await parkWorkOrder({
                    intent: INTENT.STOCK_MILL, part: basePart, qty: coreShort, brand, createdBy,
                    reqDate: reqDate || new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                    note: `Raw core short for plating ${tgt} · have ${Number(coreAvailable) || 0} · need ${n}${note ? ` · ${note}` : ''}`,
                    source: woSource || WO_SOURCE[from] || 'PLATING', forPlating: tgt, inventory,
                });
                shopWoId = res.woId;
                res.made.forEach(m => made.push(m));
            } catch (e) {
                if (e instanceof ParkRefusal) made.push(`⛔ ${core}: ${e.message}`);
                else throw e;
            }
        } else {
            made.push(`✓ ${core}: ${Number(coreAvailable) || 0} on hand covers the ${n} — pull to plating`);
        }
    }
    return { demandId, woNum, shopWoId, coreShort, made };
};

// ══ THE END OF A DEMAND'S LIFE — one module owns the collection ═══════════════════════════════
//
// `plating_demand` was written by three screens and deleted by three more, each reaching into the
// collection directly. A3 gave the RAISING one home (above); this gives the ENDING one home too,
// so the successor session has a single place to read for "what can happen to a demand".
//
// TWO ENDINGS, and they are genuinely different acts:
//   FULFILLED  the demand became a plating_shipments line — the pull posted, or a custom part was
//              scanned in at OB PLATING. The demand did its job.
//   CANCELLED  the work went away. Brief C's case (2026-09-04 sweep): the shop REOPENS a completed
//              plated order, so the parts are back on the bench, but the demand it raised stayed
//              open on the WMS Plating tab — the warehouse kept being told to pull parts that are
//              no longer going anywhere.
//
// ── WHY BOTH DELETE RATHER THAN SET A TERMINAL STATUS ────────────────────────────────────────
// The obvious shape — `status: 'CANCELLED'` — is WRONG here, and the reason is downstream.
// `auditOrphans` (Shared/orderLifecycle :327) checks plating demands with NO status filter, unlike
// rod cuts which test `open` first. A demand left in the collection with a terminal status becomes
// a permanent DEMAND_ORPHAN on RTG's audit panel the moment its sales order closes — a phantom
// backlog that nothing can clear, which is the exact failure the audit exists to surface.
// So the record is preserved where the WMS already preserves such things: the DELETION LEDGER
// (`hq_deletion_log`), the same route PickPack uses for a cancelled plating_shipments line. The
// reason survives, the audit stays clean, and no reader needs changing.
// (If plating demands ever DO want a terminal status, the one-line fix is to mirror the rodCuts
// guard in auditOrphans first. Named, not done — it is not this change.)

/**
 * The demand became a shipment line. Ctx needs: db, doc, deleteDoc, setDoc.
 * @returns {Promise<boolean>} false when there was nothing to end (already gone).
 */
export async function fulfilPlatingDemand(ctx, { id, record = null, shipmentRef = '', by = '', from = 'WMS' }) {
    if (!id) return false;
    const { hardDeleteWithLedger } = await import('./orderLifecycle');
    await hardDeleteWithLedger(ctx, {
        collection: 'plating_demand', docId: id, record: record || { id }, kind: 'plating_demand',
        by, from, reason: `staged for plating${shipmentRef ? ` — ${shipmentRef}` : ''}`,
    });
    return true;
}

/**
 * The work went away, so the demand must too (Brief C's shop REOPEN).
 *
 * REFUSES when the parts have already SHIPPED to the plater — the caller is expected to refuse its
 * own action on that answer ("parts are at the plater — receive them first") rather than cancelling
 * a demand whose pieces are physically out of the building. The caller passes the shipment lines it
 * can already see, so this stays free of its own Firestore read.
 *
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
export async function cancelPlatingDemand(ctx, { id, record = null, reason = '', by = '', from = 'SHOP', shipmentLines = [] }) {
    if (!id) return { ok: false, reason: 'no demand id' };
    const woNum = String((record && record.woNum) || '');
    const shipped = (shipmentLines || []).some(l => l && String(l.woNum || '') && woNum && String(l.woNum) === woNum
        && !['staged'].includes(String(l.status || '')));
    if (shipped) return { ok: false, reason: 'those parts are already at the plater — receive them back before reopening' };
    const { hardDeleteWithLedger } = await import('./orderLifecycle');
    await hardDeleteWithLedger(ctx, {
        collection: 'plating_demand', docId: id, record: record || { id }, kind: 'plating_demand',
        by, from, reason: reason || 'cancelled',
    });
    return { ok: true };
}
