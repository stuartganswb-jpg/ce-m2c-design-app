// ── A ROW HITS THE FLOOR AS A PRODUCTION ORDER DOES (Stuart 2026-09-23) ─────────────────────
// "i want them to hit the floor exactly the same way as a production order does now from cpq …
//  the small parts wait on the custom parts. so each row is like a small typical order, this way
//  the flow is accepted on the floor with little disruption. if there are two different finishes
//  get grouped by row and finish, the same should happen when this happens on a normal order."
//
// The Order Entry route wrote one work order per sales-order line, so a display row — a pole with
// its finials and brackets — became two or three documents that travelled alone and met again only
// at the box. Now the to-be-finished lines of an order are grouped BY ROW AND FINISH and each group
// is written as the PAIR the CPQ split writes for an order: ONE finishing document carrying every
// small part of the group, ONE shop sibling carrying its custom pole(s), linked, the small-parts
// pick released when the shop starts (§A1), matched at staging with two labels, painted together.
// An order with no rows is one row. A row with two finishes is two pairs.
//
// NETSUITE (Stuart 2026-09-23, "option 1 — the hybrid approach was the intended design"): a pair
// opens NO NetSuite work order — the sales order is the NetSuite record, exactly as a CPQ pair. The
// stocked-item door of Order Entry is untouched by this.
//
// The pure parts are here and asserted by scripts/rowPair.test.mjs; parkRowPair (below) is the one
// writer for the pair, built from the same pieces parkWorkOrder uses.
// ⚠ PURE — no Firestore here, so scripts/rowPair.test.mjs can assert it; the writer is rowPair.js.
import { customShopQtyOf } from './splitPlan.js';
import { uomStampOf } from './uom.js';
import { rowKeyOf, rowOfLine } from './displayRelease.js';
import { isOutsourcedFinishCode } from './finishRouting.js';
import { findClientPriceRow } from './clientPricing.js';
import { finishedCodeOf, isUnfinishedFinish } from './subFinish.js';
import { isPoleCategory } from './poleCut.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const slug = (v) => String(v || '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toUpperCase();

/**
 * THE GROUPING RULE — pure. A job is one to-be-finished line, as buildOeJobs shapes it
 * ({ so, line, lineIdx, part, finish, qty, custom?, __tag? }). Rows apply only to an order
 * released by rows (so.displayRelease); an ordinary order is one row. The finish is the line's.
 * A start-now split ('-NOW') groups apart from its '-PO' remainder, so it can start.
 * @returns [{ key, rowKey, rowLabel, finish, tag, jobs }]
 */
export const floorGroupsOf = (jobs = [], so = null) => {
    const byRows = !!(so && so.displayRelease);
    const groups = new Map();
    (jobs || []).forEach(job => {
        const rowLabel = byRows ? String(rowOfLine(job.line || {}) || '') : '';
        const rowKey = byRows ? rowKeyOf(rowLabel) : '';
        const finish = U(job.finish);
        const tag = String(job.__tag || '');
        const key = `${rowKey}|${finish}|${tag}`;
        if (!groups.has(key)) groups.set(key, { key, rowKey, rowLabel, finish, tag, jobs: [] });
        groups.get(key).jobs.push(job);
    });
    return [...groups.values()];
};

/**
 * A ROW'S FINISH STARTS AS ONE PAIR (Stuart 2026-09-27) — pure. The automatic start started every line
 * the plan could run and left the rest for a person, so a row's finish reached the floor in pieces
 * (Base Front 2: H1-138TRV/P06 on the floor, H1-138CC/P06 waiting → two finishing documents; Back Base 3
 * would have started H1-2RCTAR/P14 without H1-2RCTEC/P14). A ready line whose row + finish has a line
 * waiting on a decision now waits WITH it; the review starts the group together and the writer makes
 * ONE pair. The key is floorGroupsOf's (row on a rows-released order, else one row · the line's finish).
 * @param ready    jobs the plan could start ({ line, finish, … })
 * @param waiting  lines named for a person ({ line, finish, erp })
 * @returns { start: job[], held: [{ job, withErp }] }
 */
export const pairGroupKeyOf = (line, finish, so = null) => {
    const byRows = !!(so && so.displayRelease);
    return `${byRows ? rowKeyOf(String(rowOfLine(line || {}) || '')) : ''}|${U(finish)}`;
};
export const holdSplitGroups = ({ ready = [], waiting = [], so = null } = {}) => {
    const waitingBy = new Map();
    (waiting || []).forEach(w => {
        const k = pairGroupKeyOf(w.line, w.finish, so);
        if (!waitingBy.has(k)) waitingBy.set(k, U(w.erp));
    });
    const start = [], held = [];
    (ready || []).forEach(j => {
        const k = pairGroupKeyOf(j.line, j.finish, so);
        if (waitingBy.has(k)) held.push({ job: j, withErp: waitingBy.get(k) }); else start.push(j);
    });
    return { start, held };
};

/**
 * THE SAME RULE FOR THE CPQ SPLIT (Stuart 2026-09-23: "the same should happen when this happens on a
 * normal order, there will be plenty of orders from cpq or order entry specifying a wood pole with
 * metal small parts"). The whole-order split wrote one pair per order whatever the finishes; now
 * one pair per FINISH. A single-finish order keeps its ids exactly (WO-<key> / SHOP-<key>); a
 * multi-finish order suffixes every pair with its finish (WO-<key>-P24, WO-<key>-S03), sorted, so
 * a re-dispatch overwrites the same documents.
 * @param finishOf  (line) → the line's finish code, the order's recipe when the line names none
 * @returns [{ finish, suffix, smallLines, customLines }]
 */
export const finishGroupsOf = ({ smallLines = [], customLines = [], finishOf = () => '' } = {}) => {
    const groups = new Map();
    const put = (l, kind) => {
        const f = U(finishOf(l) || '');
        if (!groups.has(f)) groups.set(f, { finish: f, smallLines: [], customLines: [] });
        groups.get(f)[kind].push(l);
    };
    (smallLines || []).forEach(l => put(l, 'smallLines'));
    (customLines || []).forEach(l => put(l, 'customLines'));
    const out = [...groups.values()].sort((a, b) => a.finish.localeCompare(b.finish));
    return out.map(g => ({ ...g, suffix: out.length > 1 ? `-${slug(g.finish) || 'NOFINISH'}` : '' }));
};

/**
 * THE TWO TRACKS OF ONE FINISHING DOCUMENT — the same on every door (Stuart 2026-09-28: "the poles have more finish
 * steps than the small parts so it is imperative the correct parts follow the correct recipe"). The finishing floor
 * runs a document's POLES on the pole track (the recipe's -P variant) and its SMALL PARTS on the sled track (-S), and
 * shows the pole track only when the document COUNTS its poles (Shared/floorActivity woHasPoles). A mixed pair's
 * document carried no count, so the shop's poles joined it at staging and ran the small parts' -S coats. Now:
 *   · poles = the shop's poles finished on this document + every pole / rod on its parts list (a straight wood rod);
 *   · small parts = everything else, with their own sled sizes;
 *   · a document with poles AND small parts carries both (two tracks) — never finishStream 'POLES', which would put
 *     its small parts on -P too; a document of poles alone is the POLE stream.
 * Pure. @param parts     the document's in-house parts-list lines ({ productType, paintSize, pcs|quantity|qty })
 *        @param shopPoles the shop sibling's poles finished here (0 when plated or unfinished — never on this floor)
 * @returns { poles, smallPcs, totalParts, fields } — `fields` go on the finishing document
 */
export const docStreamsOf = ({ parts = [], shopPoles = 0 } = {}) => {
    const pcsOf = (p) => N(p && p.pcs) || N(p && p.quantity) || N(p && p.qty);
    const isPole = (p) => isPoleCategory(p && p.productType);
    const partPoles = (parts || []).filter(isPole).reduce((t, p) => t + pcsOf(p), 0);
    const small = (parts || []).filter(p => p && !isPole(p));
    const smallPcs = small.reduce((t, p) => t + pcsOf(p), 0);
    const sizes = small.reduce((acc, p) => { const z = String(p.paintSize || '').toUpperCase(); if (['S', 'M', 'L'].includes(z)) acc[z] += pcsOf(p); return acc; }, { S: 0, M: 0, L: 0 });
    const hasSize = (sizes.S + sizes.M + sizes.L) > 0;
    const paintSize = hasSize ? Object.keys(sizes).sort((a, b) => sizes[b] - sizes[a]).find(k => sizes[k] > 0) : null;
    const poles = N(shopPoles) + partPoles;
    const sled = { paintSize, paintSizes: hasSize ? sizes : null };
    const fields = poles > 0
        ? { poles: { qty: poles, type: 'POLE' }, totalPoles: poles, ...(small.length ? sled : { paintSize: null, paintSizes: null, finishStream: 'POLES' }) }
        : sled;
    return { poles, smallPcs, totalParts: smallPcs + poles, fields };
};

/** Which jobs of a group are the SHOP's (a custom pole) and which the finishing side's. */
export const splitGroupJobs = (group) => ({
    custom: (group.jobs || []).filter(j => !!j.custom),
    small: (group.jobs || []).filter(j => !j.custom),
});

const partByCode = (inventory, code) => {
    const c = U(code);
    return c ? (inventory || []).find(p => U(p.legacyErpId || p.itemId) === c) || null : null;
};

/**
 * THE PAIR'S THREE DOCUMENTS — pure. Mirrors buildParkedWorkOrder's sales shape, multi-line:
 * the RTG record, the finishing payload (every small part of the group, the CPQ split's parts-list
 * dialect per line), and the shop sibling (the custom poles as a cut list, the pole pull lines).
 * A group with ONLY a custom pole carries the pole stream on its finishing document, as the
 * per-line route did; a mixed group carries the sled stream and the pole is painted with the small
 * parts after staging, as a CPQ pair is (buildFinDoc refuses both streams on one document).
 */
export const pairShapeOf = ({ group, so, brand, createdBy = '', now = Date.now(), inventory = [], gate = {}, materialStamp = {}, woId, shopWoId, tasks = null, note = '', custKeys = null }) => {
    const { custom, small } = splitGroupJobs(group);
    const finish = group.finish;
    const rowLabel = group.rowLabel || '';
    const needBy = String((so && (so.needBy || so.reqDate)) || '');
    const cust = String((so && so.customer) || '');
    // ── the finishing side: every small part's pull lines, each carrying its line's finish ──
    const partsList = [];
    small.forEach(job => {
        (job.__planLines || []).forEach(pl => {
            const code = U(pl.legacyErpId || pl.partId);
            const part = partByCode(inventory, code) || (U(job.part && (job.part.legacyErpId || job.part.itemId)) === code ? job.part : null);
            const specs = (part && part.manufacturingSpecs) || {};
            partsList.push({
                ...pl,
                legacyErpId: code, partId: pl.partId || code,
                partName: pl.partName || (part && part.itemName) || '',
                finishCode: job.finish, finishLabel: job.finish,
                binLocation: specs.binLocation || pl.binLocation || 'UNASSIGNED',
                paintSize: (specs.paintSize || '').toUpperCase() || null,
                productType: (specs.productType || (part && part.productType) || '').toUpperCase() || null,
                soLineIdx: job.lineIdx,
                // THE CUSTOMER'S CODE on the pick line, as the CPQ split puts it (buildPartsList): the line's own,
                // else the item's clientPricing row for this customer (Shared/clientPricing).
                clientSku: (job.line && job.line.clientSku) || ((findClientPriceRow((part && part.clientPricing) || (job.part && job.part.clientPricing), custKeys) || {}).clientSku) || '',
                ...uomStampOf(part || pl, N(pl.quantity != null ? pl.quantity : pl.qty)),
            });
        });
    });
    const smallPcs = partsList.reduce((s, p) => s + (N(p.pcs) || N(p.quantity) || N(p.qty)), 0);
    // ── the shop side: the custom poles as the cut list, their pull lines ──
    // Poles first, then what rides them (fees, returns, miters — Shared/oeClassify), as the CPQ split lists them.
    const cutList = [...custom].sort((a, b) => Number(!!a.rider) - Number(!!b.rider)).map(job => {
        const erp = U(job.part && (job.part.legacyErpId || job.part.itemId));
        return {
            name: (job.part && job.part.itemName) || erp, legacyErpId: erp, partId: (job.part && job.part.id) || erp,
            qty: N(job.qty) || 1, qtyEach: null, configQty: null,
            cutLength: !job.rider && N(job.line && job.line.cutLength) > 0 ? N(job.line.cutLength) : null,
            // A per-foot line quoted with no cut still has a length: its feet per piece (splitPlan.customShopQtyOf).
            ...(!job.rider && job.line && job.line.perFoot && N(job.line.feetPer) > 0 && !(N(job.line.cutLength) > 0) ? { feetPer: N(job.line.feetPer) } : {}),
            ...(job.rider ? { rider: true } : {}),
            // A traverse track / F-clip is cut shorter than its fascia by CPQ's deduction (Shared/subFinish) and leaves
            // the floor in its stock colour — the cut list says both, so the bench reads what it is making.
            ...(!job.rider && job.line && job.line.trvRole ? { trvRole: job.line.trvRole, ...(N(job.line.trvCutFrom) > 0 ? { trvCutFrom: N(job.line.trvCutFrom), trvDrive: job.line.trvDrive || 'MANUAL' } : {}) } : {}),
            ...(!job.rider ? { finishedCode: finishedCodeOf(erp, job.finish) } : {}),
            finishCode: job.finish, soLineIdx: job.lineIdx,
            ...uomStampOf(job.part, N(job.qty) || 1),
        };
    });
    const pullLines = custom.flatMap(job => (job.__planLines || []).map(pl => ({ ...pl, soLineIdx: job.lineIdx })));
    const shopQty = customShopQtyOf(cutList);
    // Poles are the pieces the shop cuts — a rider is fabrication on one, never a pole of its own.
    const poleQty = custom.filter(j => !j.rider).reduce((s, j) => s + (N(j.qty) || 0), 0);
    // A PLATED GROUP NEVER ENTERS THE FINISHING FLOOR (Stuart 2026-09-02 / 09-27 — the CPQ split's shape,
    // HQ/RTGDispatchTab autoSplitSalesOrder): its small parts are PICK lines (pickOnly, from stock) and its
    // pole is the shop's, sent to the plater. The finishing document is then PICK-ONLY — born Complete so
    // no finishing screen selects it, while the WMS pick, staging, pack and fulfilment work unchanged.
    const inHouse = partsList.filter(p => !p.pickOnly);
    const plated = isOutsourcedFinishCode(finish) || (group.jobs || []).some(j => j.line && j.line.finishOutsourced === true && String(j.line.finishCode || '').toUpperCase() === String(finish || '').toUpperCase());
    // A PART THAT WEARS NOTHING (UNFINISHED — Stuart 2026-09-28, the clear acrylic rod): the shop cuts it and it goes to
    // packaging — its finishing half is the pick-only document, exactly as a plated group's, with no plater after.
    const finishingNeeded = inHouse.length > 0 || (custom.length > 0 && !plated && !isUnfinishedFinish(finish));
    const pickOnlyDoc = !finishingNeeded;
    const inHousePcs = inHouse.reduce((t, p) => t + (N(p.pcs) || N(p.quantity) || N(p.qty)), 0);
    // Each part on the recipe it belongs to: the poles on -P, the small parts on -S (docStreamsOf).
    const streams = docStreamsOf({ parts: inHouse, shopPoles: (custom.length > 0 && !plated && !isUnfinishedFinish(finish)) ? poleQty : 0 });
    const totalParts = pickOnlyDoc ? inHousePcs : (streams.totalParts || 1);
    const lineIdxs = (group.jobs || []).map(j => j.lineIdx).filter(i => Number.isInteger(i) && i >= 0);
    const soRef = String((so && (so.soId || so.id)) || '');
    const label = `${rowLabel ? `${rowLabel} · ` : ''}${finish}`;
    const itemName = `${rowLabel || `Order ${soRef}`} · ${finish} · ${small.length} small-part line${small.length === 1 ? '' : 's'}${custom.length ? ` + ${custom.length} custom` : ''}`;
    const salesHeader = {
        orderClass: 'ORDER_ENTRY', soAppId: so && so.id, soId: soRef, customerId: (so && so.customerId) || null, customer: cust,
        soAccepted: !!(so && so.nsInternalId), soLineIdxs: lineIdxs,
        // THE QUOTE, when the order has one (a CPQ order released by rows): RTG's shop release reads the job's
        // cut sheet, Vision notes and drawing from it — the facts the CPQ split puts on its shop document.
        ...(so && so.hqJobId ? { hqJobId: so.hqJobId, quoteId: so.hqJobId } : {}),
        // THE GROUP (2026-09-23): which row and which finish this pair is — every reader that
        // wants to show a row reads these two, never the door.
        rowKey: group.rowKey || '', rowLabel, finishGroup: finish, floorGroupKey: group.key,
    };
    const finPayload = {
        id: woId, displayId: woId, woNum: woId,
        orderKey: so && so.id, quoteId: null,
        salesOrderId: so && so.id, estimateId: null,
        orderType: 'sales', soId: soRef, soNum: soRef,
        customerId: (so && so.customerId) || null, customerName: cust, customer: cust, clientName: cust,
        type: 'Mixed', itemName,
        rowKey: group.rowKey || '', rowLabel, finishGroup: finish,
        recipe: finish, recipeLabel: null, recipeSource: 'lineCode',
        totalParts,
        ...(pickOnlyDoc ? { paintSize: null, paintSizes: null } : streams.fields),
        note, memo: note,
        reqDate: needBy, needBy,
        cpqSpecs: {}, imageUrl: null,
        dimensions: { length: 10, width: 5, height: 2 },
        partsList, bomExploded: false,
        ...(pickOnlyDoc
            ? { currentPhase: 'Complete', stepStatus: 'Complete', currentStepIndex: 0, pickOnly: true, finishingRequired: false, completedAt: now, completedBy: 'row (pick only)' }
            : { currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0 }),
        tasks: tasks || {}, machineAssigned: null, redlineAlert: false,
        sentToPickPack: false, pickStatus: 'Pending',
        shopSiblingId: custom.length ? `SHOP-${shopWoId}` : null, hasCustomSibling: custom.length > 0,
        customFabStatus: 'Pending',
        brand: brand || null, createdAt: now, updatedAt: now, createdBy,
        releasedDirect: false,
        soLineIdxs: lineIdxs,
        ...(materialStamp || {}),
    };
    const hq = {
        id: woId, woId, woDisplayId: woId,
        brand, status: 'Approved', customer: cust,
        source: 'ORDER_ENTRY', intent: 'ORDER_ENTRY', routeTo: 'FINISHING', orderType: 'sales', autoFlow: true,
        type: 'Mixed', erpId: '', partErpId: '', variantErpId: '', rootItem: '',
        itemName,
        ...salesHeader,
        recipe: finish,
        // RTG's count: what the pair handles — a pick-only pair's pieces are picked, not finished.
        qty: pickOnlyDoc ? (smallPcs || totalParts) : totalParts, totalParts, reqDate: needBy, ...(needBy ? { needBy } : {}),
        note: note || label, memo: note || label,
        ...(partsList.length ? { partsList, bomExploded: false } : {}),
        ...(custom.length ? { shopSiblingId: `SHOP-${shopWoId}`, hasCustomSibling: true, shopWoId } : {}),
        ...gate,
        ...(materialStamp || {}),
        finPayload,
        createdAt: now, createdBy,
    };
    const first = custom[0];
    const shopSibling = custom.length ? {
        id: shopWoId, woId: shopWoId, woDisplayId: shopWoId,
        brand, status: 'Approved', customer: cust,
        source: 'ORDER_ENTRY', intent: 'ORDER_ENTRY', routeTo: 'SHOP', orderType: 'sales', autoFlow: true,
        finSiblingId: woId, hasSmallSibling: true,
        type: cutList.length === 1 ? cutList[0].legacyErpId : 'Mixed',
        erpId: cutList.length === 1 ? cutList[0].legacyErpId : '', partErpId: cutList.length === 1 ? cutList[0].legacyErpId : '', variantErpId: cutList.length === 1 ? (cutList[0].finishedCode || `${cutList[0].legacyErpId}/${finish}`) : '',
        rootItem: cutList.length === 1 ? cutList[0].legacyErpId : '',
        // Named for the row: its poles and what rides them (a French return is not a pole — 2026-09-27).
        itemName: cutList.length === 1 ? cutList[0].name : `${rowLabel ? `${rowLabel} · ` : ''}${finish} · ${cutList.filter(c => !c.rider).length} pole line${cutList.filter(c => !c.rider).length === 1 ? '' : 's'}${cutList.some(c => c.rider) ? ` + ${cutList.filter(c => c.rider).length} riding` : ''}`,
        ...salesHeader,
        recipe: finish,
        qty: shopQty.qty, totalParts: shopQty.qty,
        poles: shopQty.poles, feet: shopQty.feet, billableFeet: shopQty.billableFeet, riderLines: shopQty.riders,
        ...(cutList.length === 1 && cutList[0].cutLength ? { cutLength: cutList[0].cutLength } : {}),
        cutList, pullLines,
        reqDate: needBy, ...(needBy ? { needBy } : {}),
        note: note || label, memo: note || label,
        ...gate,
        ...(materialStamp || {}),
        createdAt: now, createdBy,
        ...(first && first.part && first.part.manufacturingSpecs && first.part.manufacturingSpecs.shopInstruction ? { shopInstruction: String(first.part.manufacturingSpecs.shopInstruction) } : {}),
    } : null;
    return { hq, finPayload, shopSibling, partsList, cutList, custom, small };
};

/** The pair's ids: the finishing work order (the pair's spine, the staging key) and its shop sibling. */
export const pairIdsOf = (so, group, now = Date.now()) => {
    const woId = `WO-OE-${slug((so && (so.soId || so.id)) || 'SO')}-${slug(group.rowLabel || 'ORDER')}-${slug(group.finish)}-${now}${group.tag || ''}`;
    return { woId, shopWoId: `${woId}-C` };
};

