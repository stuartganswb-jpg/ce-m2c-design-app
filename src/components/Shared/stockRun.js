// A stock run, as a finishing work order. Kept free of Firestore imports so the document shape can
// be asserted in a test — the canonical TASK shape is NOT duplicated here: the caller passes
// makeFullTasks() from workOrderContract, which stays the one place that defines it.

// ── STRAIGHT TO THE FLOOR (Stuart 2026-08-03) ───────────────────────────────────────────────────
// "have it push straight to the finishing floor, it should also go to rtg for file keeping and a
// record but we can skip having to have to go there for an extra step just to push to the floor."
//
// RTG stays the ledger — the hq_work_orders record is still written and still stamped dispatched,
// so the board, the transmit log and every report see the job exactly as before. What goes away is
// the human hop: raising a run in the Master Library already states everything a stock build needs
// (the part, the finish, the quantity), so there is nothing for a dispatcher to decide.
//
// This is the STOCK-BUILD payload only. A sales order still goes through RTG's own path, which has
// to enrich from the CPQ job — resolve the finish out of the flow, split custom from small parts,
// carry the drawing. None of that exists here: a stock run has no quote behind it.
//
// Pure so the shape can be asserted without Firestore. `now` is passed in rather than read, so the
// same inputs always produce the same document.
export function buildStockFinPayload({ woId, part, qty, finishLabel, brand, createdBy, reqDate, note, tasks, extra = {}, now }) {
    const t = Number(now) || 0;
    const erp = String((part && (part.legacyErpId || part.itemId)) || '').toUpperCase();
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    return {
        id: woId, displayId: woId, woNum: woId,
        orderKey: woId,
        quoteId: (part && part.id) || null,
        salesOrderId: null, estimateId: null,
        orderType: 'stock',
        soId: null, soNum: null,
        customerId: null,
        customerName: 'Internal Stock', customer: 'Internal Stock', clientName: 'Internal Stock',
        stockErpId: erp || null,
        // Canonical identity (2026-08-25) — same field every writer stamps; see workOrderContract.
        ...(erp ? { itemCode: erp } : {}),
        recipe: finishLabel || 'PENDING-RECIPE',
        reqDate: reqDate || '',
        type: (part && part.itemName) || erp || 'Stock Build',
        totalParts: n,
        paintSize: null, productType: null, paintSizes: null,
        note: note || '',
        cpqSpecs: {},
        imageUrl: (part && (part.finalImageUrl || part.thumbnailUrl)) || null,
        dimensions: {
            length: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.length) || 10,
            width: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.width) || 5,
            height: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.height) || 2,
        },
        partsList: [],
        currentPhase: 'Setup',
        stepStatus: 'Pending',
        currentStepIndex: 0,
        tasks: tasks || {},
        machineAssigned: null,
        redlineAlert: false,
        // A stock build has nothing to pick — the finished goods go to the shelf at packing.
        sentToPickPack: false,
        pickStatus: 'Pending',
        shopSiblingId: null,
        hasCustomSibling: false,
        customFabStatus: 'Pending',
        brand: brand || null,
        createdAt: t, updatedAt: t,
        createdBy: createdBy || '',
        // How it got here — so a job that skipped the dispatch board still says who released it.
        releasedDirect: true,
        ...extra,
    };
}
