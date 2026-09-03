// A stock run, as a finishing work order, and (2026-09-02, Brief A) the ONE parked work-order
// shape every stock writer produces. Kept free of Firestore imports so both document shapes can be
// asserted in a node test (scripts/stockRun.test.mjs) — the canonical TASK shape is NOT duplicated
// here: the caller passes makeFullTasks() from workOrderContract, which stays the one place that
// defines it.
import { finishSuffixOf, isOutsourcedFinishCode } from './finishRouting.js';
import { finishCodeFromErp } from './finishingTime.js';
import { isPoleCategory, autoFinishStream } from './poleCut.js';

// ── WHERE A STOCK ORDER GOES (Stuart 2026-09-02, Q4: "everything routes to where it belongs,
// always") ─────────────────────────────────────────────────────────────────────────────────────
// Decided from the item code alone, the same way every screen already reads the finish:
//   a finish suffix that is sprayed here (…/BS, /N90, /P01)  → FINISHING
//   a raw / mill code (no suffix)                            → SHOP
//   …/P (the phosphated core)                                → REFUSED: phosphating raw → /P is a
//                                                              bulk WMS convert, never a work order
//   an outsourced finish (…/EP3, /MEP2, /P25)                → REFUSED: an outsourced finish never
//                                                              enters the finishing floor — it is a
//                                                              plating demand (Shared/platingDemand)
// Route-open parking ("RTG decides later") no longer exists: a writer that cannot state the route
// does not write the order. `finish` is the recipe code the floor batches on ('' for SHOP).
export const ROUTE_FINISHING = 'FINISHING';
export const ROUTE_SHOP = 'SHOP';
export const REFUSE_PHOSPHATE = 'PHOSPHATE';
export const REFUSE_OUTSOURCED = 'OUTSOURCED';
export const routeForCode = (erpId) => {
    const suffix = finishSuffixOf(erpId);
    const finish = finishCodeFromErp(erpId);            // strips -N / -10 markers; '' for raw and /P
    if (suffix && suffix.split('-')[0] === 'P') return { routeTo: null, refuse: REFUSE_PHOSPHATE, finish: '' };
    if (finish && isOutsourcedFinishCode(finish)) return { routeTo: null, refuse: REFUSE_OUTSOURCED, finish };
    return { routeTo: finish ? ROUTE_FINISHING : ROUTE_SHOP, refuse: null, finish };
};

// The floor-scheduling fields every writer used to derive by hand (and each derived differently —
// the pole-count and sled-size bugs of 2026-09-01 were exactly that). One derivation, from the
// item's own category and size: a pole is racked (8 to a rack) and carries a pole count and NO sled
// size; a small part carries its S/M/L size. The finish stream is the item's flag, else the
// category rule (POLES for the pole/rod category), which is what "Auto (by product type)" promised.
export const floorFieldsOf = (part, qty) => {
    const specs = (part && part.manufacturingSpecs) || {};
    const ptype = String(specs.productType || (part && part.productType) || '').toUpperCase() || null;
    const isPole = isPoleCategory(ptype);
    const size = String(specs.paintSize || '').toUpperCase();
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const stream = String(specs.finishStream || autoFinishStream(ptype) || '').toUpperCase();
    return {
        productType: ptype,
        isPole,
        paintSize: isPole ? null : (size || null),
        paintSizes: (!isPole && ['S', 'M', 'L'].includes(size)) ? { S: 0, M: 0, L: 0, [size]: n } : null,
        poles: isPole ? { qty: n, type: ptype || 'POLE' } : null,
        totalPoles: isPole ? n : null,
        finishStream: stream || null,
    };
};

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
// PARKED-PAYLOAD FIELDS (2026-09-02): the same builder now also produces the finPayload a parked
// stock order carries into RTG (Q5, "always pre-build"). Every added parameter is optional and
// defaults to exactly what the Library run produced before, so that path's document is unchanged
// until it converts (writer 7 waits on Brief B's builder).
export function buildStockFinPayload({
    woId, part, qty, finishLabel, brand, createdBy, reqDate, note, tasks, extra = {}, now,
    type, stockInternalId, productType, paintSize, paintSizes, poles, totalPoles, finishStream,
    partsList, bomExploded, urgent, needBy, urgentBy, urgentAt, convertSuggestion, releasedDirect = true,
    // A SALES-typed payload (Order Entry, writer 5): the item code is the finished variant the
    // customer ordered (raw + applied finish), the order keys off the sales order, and the custom
    // pair names its shop sibling. `code` overrides the part's own id; `sales` overrides the
    // stock header. Absent, the payload is the stock payload exactly as before.
    code, sales = null,
}) {
    const t = Number(now) || 0;
    const erp = String(code || (part && (part.legacyErpId || part.itemId)) || '').toUpperCase();
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const cust = sales ? String(sales.customer || '') : 'Internal Stock';
    return {
        id: woId, displayId: woId, woNum: woId,
        orderKey: sales ? (sales.soAppId || woId) : woId,
        quoteId: sales ? null : ((part && part.id) || null),
        salesOrderId: sales ? (sales.soAppId || null) : null, estimateId: null,
        orderType: sales ? 'sales' : 'stock',
        soId: sales ? (sales.soId || null) : null, soNum: sales ? (sales.soId || null) : null,
        customerId: sales ? (sales.customerId || null) : null,
        customerName: cust, customer: cust, clientName: cust,
        stockErpId: erp || null,
        // Canonical identity (2026-08-25) — same field every writer stamps; see workOrderContract.
        ...(erp ? { itemCode: erp } : {}),
        ...(stockInternalId ? { stockInternalId: String(stockInternalId) } : {}),
        recipe: finishLabel || 'PENDING-RECIPE',
        reqDate: reqDate || '',
        type: type || (part && part.itemName) || erp || 'Stock Build',
        totalParts: n,
        paintSize: paintSize == null ? null : paintSize, productType: productType || null, paintSizes: paintSizes || null,
        ...(poles ? { poles, totalPoles: totalPoles || poles.qty } : {}),
        ...(finishStream ? { finishStream: String(finishStream).toUpperCase() } : {}),
        ...(convertSuggestion ? { convertSuggestion } : {}),
        note: note || '',
        cpqSpecs: {},
        imageUrl: (part && (part.finalImageUrl || part.thumbnailUrl)) || null,
        dimensions: {
            length: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.length) || 10,
            width: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.width) || 5,
            height: Number(part && part.manufacturingSpecs && part.manufacturingSpecs.parametric && part.manufacturingSpecs.parametric.height) || 2,
        },
        partsList: Array.isArray(partsList) ? partsList : [],
        ...(bomExploded ? { bomExploded: true } : {}),
        currentPhase: 'Setup',
        stepStatus: 'Pending',
        currentStepIndex: 0,
        tasks: tasks || {},
        machineAssigned: null,
        redlineAlert: false,
        // A stock build has nothing to pick — the finished goods go to the shelf at packing.
        sentToPickPack: false,
        pickStatus: 'Pending',
        // §A1 (Shared/workOrderContract): a paired order's small-parts pick is released by the
        // shop operator STARTING the custom job — they meet again at staging.
        shopSiblingId: sales && sales.custom && sales.shopWoId ? `SHOP-${sales.shopWoId}` : null,
        hasCustomSibling: !!(sales && sales.custom),
        customFabStatus: 'Pending',
        brand: brand || null,
        createdAt: t, updatedAt: t,
        createdBy: createdBy || '',
        // Urgent rides INSIDE the payload so it survives the RTG review hop verbatim and lands on
        // fin_workorders, which is what the Setup Queue actually reads.
        ...(urgent ? { urgent: true, urgentAck: false, needBy: needBy || reqDate || '', urgentBy: urgentBy || createdBy || '', urgentAt: urgentAt || t } : {}),
        // How it got here — so a job that skipped the dispatch board still says who released it.
        // A PARKED payload is the opposite case: RTG releases it, so the flag is off.
        releasedDirect: !!releasedDirect,
        ...extra,
    };
}

// ── THE PARKED WORK ORDER — one shape for every stock writer (Brief A, A1, 2026-09-02) ─────────
// The hq_work_orders document RTG holds as the master record. Every field a downstream reader
// looks for is stamped here, once, from the item — so the grid, the Snapshot, Raw Cores, the
// Library card and the PO builder's core-short order can no longer disagree:
//   identity   itemCode (via the caller's withItemCode), type = the ITEM CODE (never a category
//              label — the floor card reads `type`), erpId/partErpId/variantErpId/rootItem for the
//              legacy readers, hqJobId/originalVariantId for the library lookups, itemName,
//              stockInternalId + nsItemId (the two spellings the release paths read)
//   route      routeTo — always stated (routeForCode); recipe on a finishing route
//   control    source, orderType 'stock', autoFlow true (Q6/Q11: RTG releases on its own),
//              status Approved, customer Internal Stock
//   floor      productType, paintSize, poles/totalPoles, finishStream, routingType, partsList
//   gates      whatever the pre-check / rod cut produced, spread in by the caller
//   payload    finPayload (finishing route only) — the complete floor doc, released verbatim
// Pure: `now` is passed in, tasks come from the caller, nothing here touches Firestore.
export const buildParkedWorkOrder = ({
    intent, woId, part, qty, brand, createdBy = '', reqDate = '', needBy = '', urgent = false, note = '',
    source, routeTo, finish = '', partsList = [], bomExploded = false, gate = {},
    replaces = null, forPlating = null, convertSuggestion = null, tasks, now,
    // ORDER ENTRY (writer 5): `code` is the finished variant (raw + applied finish); `sales` =
    // { soAppId, soId, customerId, customer, rawErp, aliasErp, soAccepted, flow2, stockInternalId,
    //   custom, shopWoId } — the header, the SO link, the FLOW2 wait and the custom pair.
    code = '', sales = null,
}) => {
    const t = Number(now) || 0;
    const erp = String(code || (part && (part.legacyErpId || part.itemId)) || '').toUpperCase();
    const n = Math.max(1, Math.floor(Number(qty) || 1));
    const ff = floorFieldsOf(part, n);
    const finishing = routeTo === ROUTE_FINISHING;
    // A sales order's NetSuite item is the FLOW2 assembly when there is one, never the raw part's.
    const nsId = sales ? (sales.stockInternalId ? String(sales.stockInternalId) : null)
        : (part && part.netSuiteInternalId != null && part.netSuiteInternalId !== '' ? String(part.netSuiteInternalId) : null);
    const urgentBlock = urgent ? { urgent: true, urgentAck: false, needBy: needBy || reqDate, urgentBy: createdBy, urgentAt: t } : {};
    const finPayload = !finishing ? null : buildStockFinPayload({
        woId, part, qty: n, finishLabel: finish, brand, createdBy, reqDate, note, tasks, now: t,
        type: erp, stockInternalId: nsId, code: erp, sales,
        productType: ff.productType, paintSize: ff.paintSize, paintSizes: ff.paintSizes,
        poles: ff.poles, totalPoles: ff.totalPoles, finishStream: ff.finishStream,
        partsList, bomExploded, urgent, needBy, convertSuggestion, releasedDirect: false,
        extra: sales ? { itemName: (part && part.itemName) || '' } : { orderKey: woId },
    });
    const salesHeader = sales ? {
        orderClass: 'ORDER_ENTRY', soAppId: sales.soAppId || null, soId: sales.soId || null,
        customerId: sales.customerId || null, customer: String(sales.customer || ''),
        ...(sales.aliasErp ? { aliasErp: sales.aliasErp } : {}),
        soAccepted: !!sales.soAccepted,
        // FLOW2: the floor waits for the NetSuite work-order number (Stuart 2026-08-29).
        ...(sales.flow2 ? { awaitingNsWo: true } : {}),
    } : {};
    const hq = {
        id: woId, woId, woDisplayId: woId,
        brand, status: 'Approved', customer: sales ? String(sales.customer || '') : 'Internal Stock',
        source, intent, routeTo, orderType: sales ? 'sales' : 'stock', autoFlow: true,
        type: erp, erpId: erp, partErpId: erp, variantErpId: erp, rootItem: sales ? String(sales.rawErp || erp).toUpperCase() : erp,
        itemName: (part && part.itemName) || '',
        // The library lookups (RTG's enrich path reads hqJobId as a CPQ job on a sales order —
        // so a sales doc carries none, exactly as Order Entry wrote it).
        ...(sales ? {} : { hqJobId: (part && part.id) || null, originalVariantId: (part && part.id) || null }),
        ...(nsId ? { stockInternalId: nsId, nsItemId: nsId } : {}),
        ...salesHeader,
        productType: ff.productType, paintSize: ff.paintSize,
        ...(ff.poles ? { poles: ff.poles, totalPoles: ff.totalPoles } : {}),
        ...(ff.finishStream ? { finishStream: ff.finishStream } : {}),
        routingType: (part && part.routingType) || 'Standard',
        ...(finishing ? { recipe: finish } : {}),
        qty: n, totalParts: n, reqDate,
        ...(needBy ? { needBy } : {}),
        ...urgentBlock,
        // `memo` is what RTG's pushToShop puts on the shop card; `note` is what every other
        // reader shows. Same words in both.
        note, memo: note,
        ...(partsList.length ? { partsList, bomExploded: !!bomExploded } : {}),
        ...gate,
        ...(finPayload ? { finPayload } : {}),
        ...(replaces && replaces.woId ? { replacesWo: replaces.woId, replacesReason: replaces.reason || '' } : {}),
        ...(forPlating ? { forPlating } : {}),
        createdAt: t, createdBy,
    };
    // THE CUSTOM HALF (Stuart 2026-09-01, b531f53): a mill code plus an applied finish is made
    // to order — the shop sibling is parked exactly like its twin, routed SHOP, and the two ids
    // point at each other (finSiblingId is what workOrderContract keys on). The gates are
    // per-LINE, so the same gate object rides both halves.
    const shopSibling = sales && sales.custom && sales.shopWoId ? {
        id: sales.shopWoId, woId: sales.shopWoId, woDisplayId: sales.shopWoId,
        brand, status: 'Approved', customer: String(sales.customer || ''),
        source, intent, routeTo: ROUTE_SHOP, orderType: 'sales', autoFlow: true,
        finSiblingId: woId, hasSmallSibling: true,
        type: erp, erpId: erp, partErpId: erp, variantErpId: erp, rootItem: String(sales.rawErp || erp).toUpperCase(),
        itemName: (part && part.itemName) || '',
        ...salesHeader,
        ...(finishing ? { recipe: finish } : {}),
        qty: n, totalParts: n, reqDate,
        ...(needBy ? { needBy } : {}),
        ...urgentBlock,
        note, memo: note,
        ...gate,
        createdAt: t, createdBy,
    } : null;
    return { hq, finPayload, shopSibling, erp, floor: ff };
};
