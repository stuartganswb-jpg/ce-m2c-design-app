// ── THE PAINT RUN, WRITTEN ONCE, FOR EVERY DOOR THAT RAISES ONE ────────────────────────────────
//
// Two screens raise this now — the Master Library (an item you are standing on) and the Sales
// Snapshot (a row that is short, alongside the ✂ rod cut, Stuart 2026-09-09: "have it be the exact
// same functioning tool"). "Exact same" is a promise about behaviour, and the only way to keep it
// is for there to be one writer rather than two that look alike on the day they are written.
//
// A paint run has no library assembly and no NetSuite work order. Its pull line is the SOURCE
// colour, so the WMS pick posts −qty of that at pick confirm; at put-away the painted pieces are
// posted +qty into the scanned bin as the TARGET. Both halves already existed (JFP, Eric
// 2026-08-12); what this module owns is writing the order that drives them.
import { db } from '../../firebase';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { withItemCode, makeFullTasks } from './workOrderContract';
import { buildStockFinPayload } from './stockRun';
import { buildFinDoc } from './floorRelease';

/**
 * Release a run straight to the finishing floor: the RTG record and the floor document, in that
 * order, with the floor document built by the ONE builder (Shared/floorRelease.buildFinDoc) so it
 * gains urgent/holds/anchor/dispatch stamps and the pole-vs-sled assertion.
 *
 * The rollback is deliberate and covers the whole of the second half: a floor document that cannot
 * be built removes the ledger entry rather than leaving an RTG record with no job behind it.
 */
export const releaseRunToFloor = async ({
    woId, part, qty, finishLabel, recipe, note, brand, by = '',
    hqExtra = {}, finExtra = {}, now = Date.now(),
}) => {
    const reqDate = new Date(now + 6048e5).toISOString().split('T')[0];
    const erp = String(part.legacyErpId || part.itemId || '').toUpperCase();
    const hqOrder = withItemCode({
        id: woId, woId, woDisplayId: woId,
        partErpId: erp, rootItem: erp,
        brand, customer: 'Internal Stock',
        hqJobId: part.id, totalParts: Math.max(1, Math.floor(Number(qty) || 1)),
        reqDate, type: 'Stock Build', recipe: recipe || finishLabel || 'PENDING-RECIPE',
        finishLabel: finishLabel || '',
        memo: note || '', createdAt: now,
        // Released from the screen, not the board — but the board still holds the record.
        status: 'Dispatched', pushedToFinishing: true,
        dispatchedAt: now, dispatchedBy: by, releasedFrom: 'MASTER_LIBRARY',
        // FINISH-STREAM EXCEPTION rides the order (e.g. the elbow: a small part finished to match
        // the poles) — the floor's recipe resolution reads it off the WO doc.
        ...(part.manufacturingSpecs?.finishStream ? { finishStream: String(part.manufacturingSpecs.finishStream).toUpperCase() } : {}),
        ...hqExtra,
    });
    await setDoc(doc(db, 'hq_work_orders', woId), hqOrder);
    try {
        const finPayload = buildStockFinPayload({
            woId, part, qty, finishLabel: recipe || finishLabel, brand,
            createdBy: by, reqDate, note, tasks: makeFullTasks(),
            extra: {
                finishLabel: finishLabel || '',
                ...(part.manufacturingSpecs?.finishStream ? { finishStream: String(part.manufacturingSpecs.finishStream).toUpperCase() } : {}),
                ...finExtra,
            },
            now,
        });
        await setDoc(doc(db, 'fin_workorders', woId), buildFinDoc({ hqOrder, finPayload, by, now }));
    } catch (err) {
        try { await deleteDoc(doc(db, 'hq_work_orders', woId)); } catch (e) { /* leave the ledger entry; it is visible in RTG */ }
        throw err;
    }
    return { woId, hqOrder };
};

/**
 * A paint run — "Just For Paint" (an item the app was never taught) or "Repaint" (an item it
 * knows, pulled in another colour). They are the SAME order; only the reason differs, and the
 * reason is worth keeping on the record.
 *
 * These fields ride on BOTH documents because by packing time the library record is not in the
 * room, and they are exactly what the WMS reads to decide whether to move stock at all — which is
 * why a second copy of this that drifted by one field name would silently stop adjusting anything.
 */
export const raisePaintRun = async ({
    woId, part, targetCode, nsItem, pullCode, nsPull, finishId, finishLabel, fin,
    qty, desc, brand, by = '', runType = 'Just For Paint', extra = {},
}) => {
    const jfpFields = {
        paintOnly: true, jfpItemCode: targetCode, jfpItemId: String(nsItem.id),
        jfpItemName: nsItem.displayname || '', jfpFinishId: finishId, jfpFinishLabel: finishLabel,
        ...(nsPull && pullCode && pullCode !== targetCode
            ? { jfpPullFrom: pullCode, jfpPullFromNsId: String(nsPull.id), jfpPullFromName: nsPull.displayname || '' }
            : {}),
        ...extra,
    };
    return releaseRunToFloor({
        woId,
        part: { ...part, legacyErpId: targetCode, itemName: nsItem.displayname || targetCode },
        qty, finishLabel, recipe: (fin && fin.code) || finishLabel, note: desc, brand, by,
        hqExtra: { ...jfpFields, type: runType },
        finExtra: { ...jfpFields, type: nsItem.displayname || targetCode },
    });
};

/** The id a repaint carries, so the board and the floor can tell one at a glance. */
export const repaintWoId = (targetCode) =>
    `WO-RPT-${String(targetCode).replace(/[^A-Za-z0-9]+/g, '-')}-${Date.now().toString().slice(-6)}`;
