// ONE STOCK RELEASE, CALLABLE FROM ANYWHERE (Brief B, Stuart 2026-09-04).
//
// "the cuts went thru but now the order is gone … these fixes are imperative … everything is all to
// prevent ever happening again."
//
// Until today the release of a STOCK work order to the finishing floor — the verbatim copy of its
// parked finPayload PLUS Route A, the real NetSuite work order — lived only inside the RTG Dispatch
// component. So it ran only while somebody had the RTG tab open in a browser. The WMS rod-cut
// completion cleared the gate and printed the label, then the order sat parked until a person
// happened to open RTG. A release must never depend on a tab. This module is that release, with
// no React in it, so the WMS (rod cut complete, convert complete), RTG, and A's clearConvertGate
// all call the same function and nothing reaches the floor unanchored.
//
// A SALES-typed order is NOT released here: its NetSuite record is the sales order (or its FLOW
// anchor opened at creation) and finishedRunPrecheck.releaseFinWoToFloor is its door. Callers pick
// the door by orderType — RTG's auto-flow effect is the reference.
//
// Route A stays exactly what it was in RTG (2026-07-16 → 2026-08-31): four-source assembly-id
// resolution, the once-ever STOP (nsWoQueued / nsWoId), the outbox dedupeKey, writeBack of the
// number onto BOTH docs. Moved, not rewritten.

import { db } from '../../firebase';
import { collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { enqueueNsWrite } from './nsOutbox';
import { withItemCode } from './workOrderContract';
import { isOutsourcedFinishCode, finishRouteOf } from './finishRouting';

const noop = () => {};

/**
 * ROUTE A — queue the real NetSuite work order for a released stock build. Returns a note for the
 * operator ('' when the payload is sales-typed). `log(msg, level)` is optional (RTG passes addLog).
 */
export async function queueNsStockWorkOrder({ hqOrder, fp, brand, by = '', log = noop }) {
    // A SALES-typed payload (Order Entry to-be-finished lines) never queues an app-created
    // NetSuite work order: the SALES ORDER is its NetSuite record, exactly like CPQ customs —
    // and the finished-variant code (RAW/FIN) may not even exist as a NetSuite item.
    if (!hqOrder || !fp || fp.orderType === 'sales') return '';
    try {
        const nsConfig = BRAND_NETSUITE_MAP[brand] || {};
        // Resolve the assembly's NetSuite internal id from FOUR sources — the payload field →
        // the item # (payload or the WO doc's own partErpId) → the WO id — so one dropped field
        // can never silently skip the NetSuite work order.
        let nsAsmId = String(fp.stockInternalId || '');
        let idSrc = 'payload';
        const erp = fp.stockErpId || hqOrder.partErpId || hqOrder.rootItem || hqOrder.variantErpId || '';
        if (!nsAsmId && erp) {
            try {
                const libSnap = await getDocs(query(collection(db, 'Approved_Designs'), where('legacyErpId', '==', erp)));
                const hit = libSnap.docs.map(d => d.data()).find(p => p.netSuiteInternalId);
                if (hit) { nsAsmId = String(hit.netSuiteInternalId); idSrc = 'library'; }
            } catch (lookErr) { /* fall through to the WO-id parse */ }
        }
        if (!nsAsmId) {
            const m = String(hqOrder.id || '').match(/^WO-STK-(\d+)-/);
            if (m) { nsAsmId = m[1]; idSrc = 'wo-id'; }
        }
        // STOP MECHANISM: one NetSuite work order per app WO, ever — a re-release (or double
        // tap) must not queue a second one.
        if (nsAsmId && nsConfig.location && (hqOrder.nsWoQueued || hqOrder.nsWoId || fp.nsWoId)) {
            log(`ℹ NetSuite WO already queued/created for ${fp.woNum || fp.id} — not queued again.`, 'warn');
            return '\n\nℹ The NetSuite work order was already queued/created earlier — NOT duplicated.';
        }
        if (nsAsmId && nsConfig.location) {
            await enqueueNsWrite({
                kind: 'workorder',
                // The outbox duplicate guard (2026-08-31) — belt under the nsWoQueued STOP.
                dedupeKey: `wo:hq_work_orders:${hqOrder.id}`,
                label: `NS WO — build ${erp || fp.id} ×${fp.totalParts}`,
                sourceApp: 'RTG', createdBy: by || '',
                targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder',
                method: 'POST',
                payload: {
                    // NetSuite's workorder record names the assembly field `assemblyItem`
                    // (plain `item` is rejected with FIELD_PARAM_REQD — learned 2026-07-17).
                    assemblyItem: { id: nsAsmId },
                    quantity: Number(fp.totalParts) || 1,
                    location: { id: nsConfig.location },
                    subsidiary: { id: nsConfig.subsidiary },
                    ...(fp.reqDate ? { endDate: fp.reqDate } : {}),
                    memo: `Stock build ${fp.woNum || fp.id}`
                },
                // Ids stamp back onto BOTH docs: the floor card shows the WO#, and the
                // completion trigger needs nsWoId on the fin doc.
                writeBack: [
                    { collection: 'fin_workorders', docId: fp.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' },
                    { collection: 'hq_work_orders', docId: hqOrder.id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' }
                ]
            });
            await updateDoc(doc(db, 'hq_work_orders', hqOrder.id), { nsWoQueued: true });
            log(`📤 NetSuite work order queued: ${erp || fp.id} ×${fp.totalParts}${idSrc !== 'payload' ? ` (internal id recovered via ${idSrc})` : ''}.`, 'success');
            return '\n\n📤 A real NetSuite work order is queued (11.1 → NetSuite Sync Queue) — On-Ord picks it up on the next live pull, and completion posts automatically when the bake finishes.';
        }
        const why = !nsAsmId
            ? `no NetSuite internal id found for ${erp || 'this order'} — check the item is synced (11.1 → Sync Master Library)`
            : 'no NetSuite location mapping for this brand';
        log(`⚠ No NetSuite WO queued for ${fp.woNum || fp.id} — ${why}.`, 'warn');
        return `\n\n⚠ No NetSuite work order queued — ${why}.`;
    } catch (nsErr) {
        console.error('Route A queue failed:', nsErr);
        log(`⚠ NetSuite WO queue failed for ${fp.woNum || fp.id}: ${nsErr.message || nsErr} — the floor job still went out.`, 'warn');
        return `\n\n⚠ The NetSuite work order could not be queued (${nsErr.message || nsErr}). The floor job WAS released.`;
    }
}

// ── THE FINISHING DOCUMENT, BUILT ONCE (Brief B1) ─────────────────────────────────────────────
// Every path that writes a fin_workorders doc — the stock release below, the CPQ split's small-parts
// half (RTG), A's sales release (finishedRunPrecheck.releaseFinWoToFloor) — assembles it HERE. The
// four hand-copied field lists each carried something the others lacked (urgent vs nsWoId vs holds
// vs needBy); this is their union, once.
const IS_DEV = typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production';
const hasPoles = (d) => (Number(d.totalPoles) || 0) > 0 || (d.poles && (Number(d.poles.qty) || 0) > 0);
const hasSled = (d) => !!d.paintSize || (d.paintSizes && Object.values(d.paintSizes).some(v => (Number(v) || 0) > 0));

/**
 * @param {object} p.hqOrder     the RTG record (hq_work_orders or hq_sales_orders) — the later statement of intent
 * @param {object} p.finPayload  the complete floor doc as the writer/split computed it (the Snapshot model)
 * @param {string} p.by          who released
 * @param {number} [p.now]
 * @param {object} [p.extra]     stamps the caller adds (cutSheetMissing, visionUsed, recipeSource…)
 * @returns the exact fin_workorders document to write (id = finPayload.id)
 */
export function buildFinDoc({ hqOrder = {}, finPayload, by = '', now = Date.now(), extra = {} }) {
    if (!finPayload || !finPayload.id) throw new Error('buildFinDoc: finPayload with an id is required');
    const fp = finPayload;
    // A POLE IS NOT A SLED (00b26f3, Sandra's WO11535: an order carrying both streams could never
    // complete). The writer decides; this asserts. Dev throws so the writer bug is found; prod
    // logs and stamps shapeWarning so the board can count it — it never silently strips a stream.
    let shapeWarning = null;
    if (hasPoles(fp) && hasSled(fp)) {
        shapeWarning = `poles/totalPoles AND paintSize/paintSizes both present on ${fp.id} — a pole order must not carry a sled stream`;
        if (IS_DEV) throw new Error(`buildFinDoc: ${shapeWarning}`);
        console.error('buildFinDoc:', shapeWarning);
    }
    const docOut = {
        ...fp,
        // The customer's date (E, 2026-09-03): needBy is the ONE key; '' means no date. The payload's
        // own value stands; the RTG record fills it when the payload has none.
        needBy: fp.needBy !== undefined ? fp.needBy : (hqOrder.needBy || ''),
        // The board's later urgent statement wins over what the payload carried at creation.
        ...(hqOrder.urgent ? { urgent: true, urgentAck: false, needBy: hqOrder.needBy || fp.needBy || fp.reqDate || '', urgentBy: hqOrder.urgentBy || by || '', urgentAt: hqOrder.urgentAt || now } : {}),
        // The NetSuite anchor rides onto the floor card when the record already has it (Order Entry
        // anchors open at creation; Route A stamps stock ones back after release).
        ...(hqOrder.nsWoId ? { nsWoId: hqOrder.nsWoId, nsWoTran: hqOrder.nsWoTran || null } : {}),
        // A hold placed while the order was parked is NOT lost at release.
        ...(hqOrder.held === true ? { held: true, heldAt: hqOrder.heldAt || now, heldBy: hqOrder.heldBy || '', heldReason: hqOrder.heldReason || '', heldStage: hqOrder.heldStage || null } : {}),
        ...(shapeWarning ? { shapeWarning } : {}),
        ...extra,
        dispatchedAt: now, dispatchedBy: by || '',
    };
    return withItemCode(docOut);
}

/**
 * Release a parked STOCK work order to the finishing floor: the verbatim finPayload (the Snapshot
 * model — nothing re-derived at dispatch), the board's later urgent statement winning, the
 * dispatched stamps, and then Route A. Returns { released, nsNote, finId }.
 * Refuses (released:false) when there is no payload, the order is sales-typed, or it was already
 * dispatched — the callers decide the gates (orderStatus.isReleasable) BEFORE calling this.
 */
export async function releaseStockWoToFloor({ hqOrder, brand, by = '', log = noop }) {
    const fp = hqOrder && hqOrder.finPayload;
    if (!fp || !fp.id) return { released: false, nsNote: '', finId: null, why: 'no finPayload on the record' };
    if (fp.orderType === 'sales' || hqOrder.orderType === 'sales') return { released: false, nsNote: '', finId: fp.id, why: 'sales-typed — releaseFinWoToFloor is its door' };
    if (hqOrder.pushedToFinishing) return { released: false, nsNote: '', finId: fp.id, why: 'already dispatched' };
    const now = Date.now();
    await setDoc(doc(db, 'fin_workorders', fp.id), buildFinDoc({ hqOrder, finPayload: fp, by, now }));
    await updateDoc(doc(db, 'hq_work_orders', hqOrder.id), { pushedToFinishing: true, status: 'Dispatched', dispatchedAt: now, dispatchedBy: by || '' });
    // ROUTE A (2026-07-16): these stocked items are real NetSuite assemblies with BOMs, so
    // releasing to the floor ALSO queues a real NetSuite work order (outbox — serial, retried,
    // idempotent). On-Ord sees it on the next live pull; component demand is real; the floor's
    // bake-complete auto-queues the WO COMPLETION (server trigger).
    const nsNote = await queueNsStockWorkOrder({ hqOrder, fp, brand, by, log });
    log(`🏭 ${fp.woNum || fp.id} released to the finishing floor and its NetSuite work order queued (Route A).`, 'success');
    return { released: true, nsNote, finId: fp.id };
}

// ── THE SHOP DOCUMENT, BUILT ONCE (Brief B1) ─────────────────────────────────────────────────
// pushToShop's payload, the CPQ split's shop half and (through parkWorkOrder + pushToShop) A's
// component milling orders all wrote shop_custom_orders by hand. The decisions they must agree on
// live here: category/routeTo from the order type, the sibling links always carried, OUTSOURCED by
// the shared finish rule (never the hq_outsource_finishes name-includes match — two tests for one
// fact), phosphate by the one rule, a caller-supplied id (the Order Entry pair's '<woId>-C'), the
// urgent flag, the item's shopInstruction for C's card, and the cut-sheet facts. The caller passes
// what only it knows (lines, cut list, fab notes, drawing, customer) in `fields`.
const MILL_RE = /\b(MILL|RAW|UNFINISHED)\b/i;
export const isOutsourcedRecipe = (recipe) => {
    const r = String(recipe || '').trim();
    if (!r) return false;
    return isOutsourcedFinishCode(r) || !!finishRouteOf({ recipe: r }).outsourced;
};
/**
 * @param {object} p.hqOrder       the RTG record (hq_work_orders / hq_sales_orders)
 * @param {'stock'|'sales'} p.orderType
 * @param {string} p.shopId        the doc id (SHOP-<hq id> by convention; the OE pair passes its own)
 * @param {string} p.finishRecipe  the recipe code or label as resolved by the caller
 * @param {string|null} p.finSiblingId
 * @param {object} [p.part]        the library record for the item (shopInstruction comes from it)
 * @param {object} [p.fields]      caller-specific fields (item, partNum, qty, cutList, fabNotes, imageUrl…)
 * @param {object} [p.extra]       stamps (cutSheetMissing, visionUsed)
 */
export function buildShopDoc({ hqOrder = {}, orderType = 'stock', shopId, finishRecipe = '', finSiblingId = null, part = null, by = '', now = Date.now(), fields = {}, extra = {} }) {
    if (!shopId) throw new Error('buildShopDoc: shopId is required');
    const isStock = orderType === 'stock';
    const recipe = String(finishRecipe || '');
    const isOutsourced = isOutsourcedRecipe(recipe);
    // Fundamental rule (Stuart 2026-07-15): ANY in-house finish (a real recipe that is not outsourced
    // and not mill/raw) → the custom parts get phosphated at the station adjacent to custom fab.
    // An explicit flag on the record wins.
    const needsPhosphating = hqOrder.needsPhosphating === true
        || (!isOutsourced && recipe && recipe !== 'PENDING-RECIPE' && !MILL_RE.test(recipe));
    const orderKey = (orderType === 'sales' ? (hqOrder.soId || hqOrder.orderKey) : null) || hqOrder.hqJobId || hqOrder.id;
    const spec = part && part.manufacturingSpecs ? part.manufacturingSpecs : null;
    const docOut = {
        id: shopId, woNum: shopId,
        orderKey,
        quoteId: hqOrder.hqJobId || hqOrder.quoteId || null,
        salesOrderId: (orderType === 'sales' ? (hqOrder.soId || null) : null),
        soNum: hqOrder.soId || hqOrder.woId || orderKey || 'N/A',
        // CARRY THE SIBLING (Stuart 2026-09-01): releaseSiblingToPickPack and the customFabStatus
        // mirror both key entirely on this.
        finSiblingId: finSiblingId || null, hasSmallSibling: !!finSiblingId,
        isStock,
        routeTo: isStock ? 'MILLING' : 'CUSTOM_FAB',
        category: isStock ? 'Stock Milling' : 'Custom Fabrication',
        status: 'Pending', priority: 999,
        brand: hqOrder.brand || fields.brand || null,
        isOutsourced, finishRecipe: recipe, needsPhosphating,
        isPlatingDemand: hqOrder.isPlatingDemand || false,
        rootItem: hqOrder.rootItem || '',
        reqDate: hqOrder.reqDate || fields.reqDate || '',
        needBy: hqOrder.needBy || fields.needBy || '',
        // The per-item shop instruction (C, Stuart: "on the item") — the card reads this first.
        ...(spec && spec.shopInstruction ? { shopInstruction: String(spec.shopInstruction) } : {}),
        ...fields,
        // Same flag, same field names as the finishing side — the shop list sorts on it.
        ...(hqOrder.urgent ? { urgent: true, urgentAck: false, needBy: hqOrder.needBy || hqOrder.reqDate || fields.needBy || '', urgentBy: hqOrder.urgentBy || by || '', urgentAt: hqOrder.urgentAt || now } : {}),
        ...extra,
        createdAt: now, createdBy: by || '',
    };
    return withItemCode(docOut);
}
