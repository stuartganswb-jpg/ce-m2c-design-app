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
export const pairShapeOf = ({ group, so, brand, createdBy = '', now = Date.now(), inventory = [], gate = {}, materialStamp = {}, woId, shopWoId, tasks = null, note = '' }) => {
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
                ...uomStampOf(part || pl, N(pl.quantity != null ? pl.quantity : pl.qty)),
            });
        });
    });
    const paintSizes = partsList.reduce((acc, p) => { if (p.paintSize && ['S', 'M', 'L'].includes(p.paintSize)) acc[p.paintSize] += N(p.pcs || p.quantity || p.qty) || 0; return acc; }, { S: 0, M: 0, L: 0 });
    const hasSize = (paintSizes.S + paintSizes.M + paintSizes.L) > 0;
    const paintSize = hasSize ? Object.keys(paintSizes).sort((a, b) => paintSizes[b] - paintSizes[a]).find(k => paintSizes[k] > 0) : null;
    const smallPcs = partsList.reduce((s, p) => s + (N(p.pcs) || N(p.quantity) || N(p.qty)), 0);
    // ── the shop side: the custom poles as the cut list, their pull lines ──
    const cutList = custom.map(job => {
        const erp = U(job.part && (job.part.legacyErpId || job.part.itemId));
        return {
            name: (job.part && job.part.itemName) || erp, legacyErpId: erp, partId: (job.part && job.part.id) || erp,
            qty: N(job.qty) || 1, qtyEach: null, configQty: null,
            cutLength: N(job.line && job.line.cutLength) > 0 ? N(job.line.cutLength) : null,
            finishCode: job.finish, soLineIdx: job.lineIdx,
            ...uomStampOf(job.part, N(job.qty) || 1),
        };
    });
    const pullLines = custom.flatMap(job => (job.__planLines || []).map(pl => ({ ...pl, soLineIdx: job.lineIdx })));
    const shopQty = customShopQtyOf(cutList);
    const poleOnly = custom.length > 0 && small.length === 0;
    const poleQty = custom.reduce((s, j) => s + (N(j.qty) || 0), 0);
    const totalParts = smallPcs || poleQty || 1;
    const lineIdxs = (group.jobs || []).map(j => j.lineIdx).filter(i => Number.isInteger(i) && i >= 0);
    const soRef = String((so && (so.soId || so.id)) || '');
    const label = `${rowLabel ? `${rowLabel} · ` : ''}${finish}`;
    const itemName = `${rowLabel || `Order ${soRef}`} · ${finish} · ${small.length} small-part line${small.length === 1 ? '' : 's'}${custom.length ? ` + ${custom.length} custom` : ''}`;
    const salesHeader = {
        orderClass: 'ORDER_ENTRY', soAppId: so && so.id, soId: soRef, customerId: (so && so.customerId) || null, customer: cust,
        soAccepted: !!(so && so.nsInternalId), soLineIdxs: lineIdxs,
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
        paintSize: poleOnly ? null : paintSize, paintSizes: (!poleOnly && hasSize) ? paintSizes : null,
        ...(poleOnly ? { poles: { qty: poleQty, type: 'POLE' }, totalPoles: poleQty, finishStream: 'POLES' } : {}),
        note, memo: note,
        reqDate: needBy, needBy,
        cpqSpecs: {}, imageUrl: null,
        dimensions: { length: 10, width: 5, height: 2 },
        partsList, bomExploded: false,
        currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
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
        qty: totalParts, totalParts, reqDate: needBy, ...(needBy ? { needBy } : {}),
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
        erpId: cutList.length === 1 ? cutList[0].legacyErpId : '', partErpId: cutList.length === 1 ? cutList[0].legacyErpId : '', variantErpId: cutList.length === 1 ? `${cutList[0].legacyErpId}/${finish}` : '',
        rootItem: cutList.length === 1 ? cutList[0].legacyErpId : '',
        itemName: cutList.length === 1 ? cutList[0].name : `${cutList.length} custom pole lines`,
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

