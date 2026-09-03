// ONE WRITER FOR EVERY STOCK WORK ORDER (Brief A, A1 — Stuart 2026-09-02).
//
// Ten screens used to hand-write an hq_work_orders document, each with its own field list, and a
// field added to one was missing from the next: the pole-count bug, the PENDING-RECIPE bug and the
// missing-`type` bug were each a field present in one writer and absent in another. Every screen
// now states an INTENT — "make N of this item" — and this module does the rest, once:
//   1. identity + route     buildParkedWorkOrder (Shared/stockRun) — routeTo always stated; a /P
//                            core or an outsourced finish is REFUSED, never parked route-open
//   2. pre-build            a finishing route parks the COMPLETE floor doc (finPayload); RTG
//                            releases it verbatim (Q5, "always pre-build")
//   3. gates from birth     the component pre-check's make-up actions are executed FIRST, so the
//                            order carries awaitingConvert / awaitingComponents when it is written;
//                            a stocked 4/6 ft pole gets its rod cut and awaitingRodCut the same way
//   4. anchor by policy     AT_CREATION → the NetSuite work order is queued now (a milled root that
//                            is a NetSuite assembly); AT_RELEASE → RTG's Route A does it; NONE
//   5. control stamps       source, orderType 'stock', autoFlow true — RTG's auto-release takes it
//                            the moment its gates are clear; nobody presses Push (Q6/Q11, S3)
//
// What this module does NOT do: release to a floor (RTG's, Brief B), raise a purchase order
// (Shared/purchaseOrders, A4), or raise a plating demand (Shared/platingDemand, A3). It parks.

import { db } from '../../firebase';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { withItemCode, makeFullTasks } from './workOrderContract';
import { buildParkedWorkOrder, routeForCode, ROUTE_FINISHING, ROUTE_SHOP, REFUSE_PHOSPHATE, REFUSE_OUTSOURCED } from './stockRun.js';
import { planFinishedRun, erpOf } from './finishedGoodsRun.js';
import { executeMakeupActions } from './finishedRunPrecheck';
import { poleCutPlan } from './poleCut.js';
import { queueNsAssemblyWorkOrder, isNsAssemblyRec } from './nsWorkOrder';

export const INTENT = { STOCK_FINISH: 'STOCK_FINISH', STOCK_MILL: 'STOCK_MILL', COMPONENT_MILL: 'COMPONENT_MILL' };
export const ANCHOR = { AT_CREATION: 'AT_CREATION', AT_RELEASE: 'AT_RELEASE', NONE: 'NONE' };

// A refusal is a typed error so a batch caller can log the row and carry on with the next.
export class ParkRefusal extends Error {
    constructor(code, message) { super(message); this.name = 'ParkRefusal'; this.code = code; }
}
export const REFUSAL = { PHOSPHATE: REFUSE_PHOSPHATE, OUTSOURCED: REFUSE_OUTSOURCED, RAW_UNKNOWN: 'RAW_UNKNOWN', INTENT: 'INTENT', NO_PART: 'NO_PART' };

// What the NetSuite memo says about where the order came from — the same words on every screen.
const SOURCE_LABEL = {
    SALES_SNAPSHOT: 'Sales Snapshot', STOCKVIEW_GRID: 'Stock View grid', RAW_CORES: 'raw core replenish',
    STOCKVIEW_PO_BUILDER: 'PO builder, core short for plating', LIBRARY_MAKEUP: 'library make-up',
    PRECHECK_MAKEUP: 'component make-up', PLATING: 'core short for plating', STOCK_BUILD_NEEDS: 'Stock Build Needs',
};

let seq = 0;
const safeCode = (erp) => String(erp).replace(/[^A-Za-z0-9]+/g, '-');

/**
 * Park one stock work order in RTG.
 *
 * @param {object} p
 * @param {string}  p.intent      STOCK_FINISH | STOCK_MILL | COMPONENT_MILL
 * @param {object}  p.part        the Master Library record (legacyErpId|itemId, itemName, manufacturingSpecs…)
 * @param {number}  p.qty
 * @param {string}  p.brand       'ce' | 'm2c' | …
 * @param {string}  p.source      SALES_SNAPSHOT | STOCKVIEW_GRID | RAW_CORES | … (stamped verbatim)
 * @param {object}  [p.precheck]  this row's runBatchPrecheck result: { plan, actions, rawUnknown }
 * @param {object[]} [p.pins]     assembly_pins rows, for the pull lines when no pre-check ran
 * @param {object[]} [p.inventory] library records (make-up execution + pin resolution)
 * @param {function} [p.nsIdOf]   code → NetSuite internal id, for the rod cut (defaults to inventory)
 * @param {string}  [p.anchor]    AT_CREATION | AT_RELEASE | NONE (default by intent)
 * @param {string}  [p.woId]      caller-chosen id (the Snapshot keeps its WO-STK-<nsid>- form, which RTG's Route A can parse)
 * @returns {{ woId, routeTo, finish, gate, made: string[], finPayload, rodCut }}
 * @throws {ParkRefusal} PHOSPHATE | OUTSOURCED | RAW_UNKNOWN | INTENT | NO_PART — nothing written
 */
export const parkWorkOrder = async ({
    intent, part, qty, brand, createdBy = '', reqDate = '', needBy = '', urgent = false, note = '',
    source, precheck = null, pins = [], inventory = [], locationId, nsIdOf = null,
    anchor, woId, replaces = null, forPlating = null, convertSuggestion = null, soRef = '',
}) => {
    const erp = erpOf(part);
    if (!erp || erp === 'PENDING') throw new ParkRefusal(REFUSAL.NO_PART, 'No item code on the part — sync or save it with an ERP id first.');
    const n = Math.max(1, Math.floor(Number(qty) || 1));

    // 1. THE ROUTE — stated or refused, never open.
    const route = routeForCode(erp);
    if (route.refuse === REFUSE_PHOSPHATE) throw new ParkRefusal(REFUSAL.PHOSPHATE, `${erp} is a phosphated core: phosphating raw → /P is a bulk WMS convert (raise a Convert to-do), never a work order.`);
    if (route.refuse === REFUSE_OUTSOURCED) throw new ParkRefusal(REFUSAL.OUTSOURCED, `${erp} carries an outsourced finish (/${route.finish}): it never enters the finishing floor — raise the plating demand instead.`);
    const wantFinishing = intent === INTENT.STOCK_FINISH;
    if (wantFinishing && route.routeTo !== ROUTE_FINISHING) throw new ParkRefusal(REFUSAL.INTENT, `${erp} has no finish suffix — it is shop work (STOCK_MILL), not a finishing run.`);
    if (!wantFinishing && route.routeTo !== ROUTE_SHOP) throw new ParkRefusal(REFUSAL.INTENT, `${erp} carries finish /${route.finish} — it is finishing work (STOCK_FINISH), not a milling order.`);
    if (precheck && precheck.rawUnknown) throw new ParkRefusal(REFUSAL.RAW_UNKNOWN, `${erp}: /P components are short but the RAW availability read failed — a convert against unverified raw silently skips milling. Retry when NetSuite answers.`);

    const id = woId || `WO-${safeCode(erp)}-${Date.now().toString().slice(-6)}-${++seq}`;
    const made = [];

    // 2. PULL LINES — the pre-check's plan when it ran, else the planner on the pins.
    const plan = (precheck && precheck.plan) || (pins.length ? planFinishedRun({ part, qty: n, pins, inventory }) : null);
    const partsList = plan && plan.exploded ? plan.lines : [];

    // 3. GATES FROM BIRTH — make-up orders first, so the demands carry this WO's id and the WO
    //    carries its gate when it is written. A component shop WO still milling gates the order
    //    too (awaitingComponents): under auto-release there is no operator to "wait for the
    //    components" — the gate is what waits, and RTG clears it when the shop completes.
    let gate = {};
    if (precheck && Array.isArray(precheck.actions) && precheck.actions.length) {
        const exec = await executeMakeupActions({
            actions: precheck.actions, brandId: brand, finWoId: id, finWoErpId: erp,
            createdBy, inventory, source: `${String(source || 'precheck').toLowerCase()}-precheck`, reqDate, soRef,
        });
        gate = {
            ...exec.gateFields,
            ...(exec.shopWoIds.length ? { awaitingComponents: true, componentShopWoIds: exec.shopWoIds } : {}),
        };
        exec.made.forEach(m => made.push(m));
    }

    // 4. A STOCKED POLE IS CUT BEFORE IT IS FINISHED (Stuart 2026-08-19): a 4/6 ft order raises a
    //    cut from 8 ft rods and waits on it; the cut prints this order's finishing label.
    let rodCut = null;
    if (wantFinishing) {
        const ptype = String((part.manufacturingSpecs && part.manufacturingSpecs.productType) || part.productType || '');
        const cut = poleCutPlan(erp, n, { productType: ptype });
        if (cut) {
            const idOf = nsIdOf || ((code) => {
                const hit = inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(code).toUpperCase());
                return hit && hit.netSuiteInternalId ? String(hit.netSuiteInternalId) : null;
            });
            const srcNs = idOf(cut.sourceItemId), tgtNs = idOf(cut.targetItemId);
            if (srcNs && tgtNs) {
                rodCut = { ...cut, cutId: `RC-${id}`, sourceInternalId: String(srcNs), targetInternalId: String(tgtNs) };
                gate = { ...gate, awaitingRodCut: true, rodCutId: rodCut.cutId, rodCutNote: `${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}` };
                made.push(`✂ needs cutting first — cut order ${rodCut.cutId}: ${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}${cut.overrun ? ` (+${cut.overrun} spare to stock)` : ''}. WMS → ROD CUTS → Cuts for Finishing.`);
            } else {
                // Never invent an id — say which side is missing and leave the order un-gated.
                made.push(`⚠ ${erp} is a ${cut.lengthFt} ft pole needing ${cut.sourceQty} × ${cut.sourceItemId}, but no NetSuite id was found for ${!srcNs ? cut.sourceItemId : cut.targetItemId} — NO cut order raised. Sync that item, then raise the cut from the Snapshot's ✂ button.`);
            }
        }
    }

    // 5. THE DOCUMENT — one shape.
    const built = buildParkedWorkOrder({
        intent, woId: id, part, qty: n, brand, createdBy, reqDate, needBy, urgent, note,
        source, routeTo: route.routeTo, finish: route.finish,
        partsList, bomExploded: !!(plan && plan.exploded), gate, replaces, forPlating, convertSuggestion,
        tasks: wantFinishing ? makeFullTasks() : null, now: Date.now(),
    });
    const hq = withItemCode({ ...built.hq, ...(built.finPayload ? { finPayload: withItemCode(built.finPayload) } : {}) });
    await setDoc(doc(db, 'hq_work_orders', id), hq, { merge: true });
    if (rodCut) {
        await setDoc(doc(db, 'rod_cut_orders', rodCut.cutId), {
            id: rodCut.cutId, brand, status: 'OPEN',
            sourceItemId: rodCut.sourceItemId, sourceInternalId: rodCut.sourceInternalId,
            targetItemId: rodCut.targetItemId, targetInternalId: rodCut.targetInternalId,
            qtySource: rodCut.sourceQty, qtyTarget: rodCut.targetQty,
            cutTo: rodCut.cutTo, scrapFt: rodCut.scrapFt,
            sourceBin: null, destBin: null, nsAdjustmentId: null,
            // WHAT MAKES IT A "CUT FOR FINISHING": it belongs to a work order, and finishing waits on it.
            purpose: 'FINISHING', createdVia: 'FINISHING_WO',
            finWoId: id, finWoErpId: erp, finWoQty: n,
            finWoRecipe: route.finish || '', finWoReqDate: reqDate,
            overrun: rodCut.overrun,
            createdAt: Date.now(), createdBy,
            completedAt: null, completedBy: null,
        }, { merge: true });
    }

    // 6. THE ANCHOR — by policy. A milled root that is a NetSuite assembly opens its own work
    //    order with the milling order; the number stamps back here and RTG's ⛏ Mill Build closes
    //    it. A finishing run's anchor (Route A) is RTG's, at release.
    const policy = anchor || (wantFinishing ? ANCHOR.AT_RELEASE : ANCHOR.AT_CREATION);
    if (policy === ANCHOR.AT_CREATION) {
        if (isNsAssemblyRec(part)) {
            try {
                await queueNsAssemblyWorkOrder({
                    brandId: brand, assemblyInternalId: String(part.netSuiteInternalId),
                    erp, qty: n, reqDate,
                    memo: `${soRef ? `SO ${soRef} · ` : ''}mill ${erp} · ${SOURCE_LABEL[source] || String(source || '').toLowerCase()}${forPlating ? ` · for plating ${forPlating}` : ''}`,
                    writeBacks: [{ collection: 'hq_work_orders', docId: id, patch: {}, idField: 'nsWoId', tranField: 'nsWoTran' }],
                    sourceApp: source || 'APP', createdBy,
                });
                await updateDoc(doc(db, 'hq_work_orders', id), { nsWoQueued: true });
                made.push(`📤 NS work order queued on ${erp} ×${n} (the root — milling anchor)`);
            } catch (e) {
                made.push(`⚠ ${erp}: root NS WO queue failed (${e.message || e}) — the RTG anchor review will re-offer it`);
            }
        } else {
            made.push(`ℹ ${erp} is not a synced NetSuite assembly — no work-order anchor at creation (RTG's ⛏ path has nothing to close)`);
        }
    }

    made.unshift(`${route.routeTo === ROUTE_FINISHING ? '🎨' : '🏭'} ${id} — ${n} × ${erp}${route.finish ? ` (${route.finish})` : ''} → RTG, route ${route.routeTo}${Object.keys(gate).length ? ' · gated: ' + Object.keys(gate).filter(k => /^awaiting/.test(k) && gate[k]).map(k => k.replace(/^awaiting/, '').toLowerCase()).join(' + ') : ' · auto-release when clear'}`);
    return { woId: id, routeTo: route.routeTo, finish: route.finish, gate, made, finPayload: hq.finPayload || null, rodCut };
};
