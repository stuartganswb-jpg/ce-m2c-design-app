// ── THE ONE WRITER FOR A ROW PAIR (Stuart 2026-09-23) — the shape and the grouping rule are pure, in
// Shared/rowPairShape (asserted by scripts/rowPair.test.mjs); this file writes them.
import { db } from '../../firebase';
import { doc, setDoc } from 'firebase/firestore';
import { withItemCode, makeFullTasks } from './workOrderContract';
import { executeMakeupActions } from './finishedRunPrecheck';
import { receiptGateFields } from './workOrderCreate';
import { materialRowsOf, materialStampOf } from './materialGrid.js';
import { floorGroupsOf, splitGroupJobs, pairShapeOf, pairIdsOf } from './rowPairShape.js';
export { floorGroupsOf, splitGroupJobs, pairShapeOf, pairIdsOf };

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * THE ONE WRITER FOR A PAIR. Make-up actions for every short in the group (converts, sourced shop
 * work orders, the bought notes) run once against the pair; the receipt gate is the union of the
 * group's purchases; a stocked pole's cut (Q5) rides as it does on a single work order; the
 * material grid is the group's. Writes the RTG record, its finishing payload and the shop sibling.
 * @returns { woId, shopWoId, gate, finPayload, made, custom }
 */
export const parkRowPair = async ({ group, so, brand, user = '', inventory = [], now = Date.now(), poleCutsOf = () => ({ poleCut: null, backOrder: '' }), receiptRefs = [], makeupActions = [], nsIdOf = null }) => {
    const { custom, small } = splitGroupJobs(group);
    const { woId, shopWoId } = pairIdsOf(so, group, now);
    const made = [];
    const soRef = String((so && (so.soId || so.id)) || '');
    const needBy = String((so && (so.needBy || so.reqDate)) || '');
    let gate = {};
    let execRes = null;
    if (makeupActions.length) {
        execRes = await executeMakeupActions({
            actions: makeupActions, brandId: brand, finWoId: woId, finWoErpId: `${group.rowLabel || soRef} · ${group.finish}`,
            createdBy: user, inventory, source: 'order_entry-precheck', reqDate: needBy, soRef,
            dispatchShop: true, customerName: (so && so.customer) || '',
        });
        gate = { ...execRes.gateFields, ...(execRes.shopWoIds.length ? { awaitingComponents: true, componentShopWoIds: execRes.shopWoIds } : {}) };
        execRes.made.forEach(m => made.push(m));
    }
    // A STOCKED POLE IS CUT BEFORE IT IS FINISHED (Q5) — only a finishing-side pole; a custom pole is the shop's.
    const rodCuts = [];
    let backOrder = '';
    for (const job of small) {
        const pc = poleCutsOf(job) || {};
        if (pc.backOrder && !backOrder) backOrder = String(pc.backOrder);
        const cut = pc.poleCut;
        if (!cut) continue;
        const srcNs = nsIdOf ? nsIdOf(cut.sourceItemId) : null, tgtNs = nsIdOf ? nsIdOf(cut.targetItemId) : null;
        if (srcNs && tgtNs) {
            const rodCut = { ...cut, cutId: `RC-${woId}${rodCuts.length ? `-${rodCuts.length + 1}` : ''}`, sourceInternalId: String(srcNs), targetInternalId: String(tgtNs), erp: U(job.part && (job.part.legacyErpId || job.part.itemId)), qty: N(job.qty) };
            rodCuts.push(rodCut);
            gate = { ...gate, awaitingRodCut: true, rodCutId: rodCut.cutId, rodCutNote: [gate.rodCutNote, `${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}`].filter(Boolean).join(' · ') };
            made.push(`✂ needs cutting first — cut order ${rodCut.cutId}: ${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}`);
        } else made.push(`⚠ ${cut.targetItemId}: no NetSuite id for ${!srcNs ? cut.sourceItemId : cut.targetItemId} — the cut was not raised; raise it from WMS → Rod Cuts`);
    }
    if (receiptRefs && receiptRefs.length) {
        const rg = receiptGateFields(receiptRefs);
        if (rg.awaitingReceipt) { gate = { ...gate, ...rg }; made.push(`📦 waiting on material — ${rg.receiptGateNote}`); }
    }
    const backOrderStamp = backOrder ? { backOrdered: true, backOrderReason: backOrder, backOrderedAt: now } : {};
    if (backOrder) made.push(`⏳ BACK ORDER — ${backOrder}. The job goes to the floor; its pick waits at the WMS until the stock arrives.`);
    const fullGate = { ...gate, ...backOrderStamp };
    const components = (group.jobs || []).flatMap(j => j.components || []);
    const planLines = (group.jobs || []).flatMap(j => j.__planLines || []);
    const materialStamp = materialStampOf(materialRowsOf({
        components, planLines, gate: fullGate,
        poleChoice: (small.find(j => j.poleChoice) || {}).poleChoice || null,
        backOrder, shopWoIds: execRes ? execRes.shopWoIds : [], unitsKnown: !(group.jobs || []).some(j => j.unitsKnown === false),
    }), now);
    const note = `Order Entry ${soRef} · ${(so && so.customer) || ''} · ${group.rowLabel ? `${group.rowLabel} · ` : ''}${group.finish}${so && so.productionNotes ? ` · 📝 ${so.productionNotes}` : ''}`;
    const shape = pairShapeOf({ group, so, brand, createdBy: user, now, inventory, gate: fullGate, materialStamp, woId, shopWoId, tasks: makeFullTasks(), note });
    const hq = withItemCode({ ...shape.hq, finPayload: withItemCode(shape.finPayload) });
    await setDoc(doc(db, 'hq_work_orders', woId), hq, { merge: true });
    if (shape.shopSibling) {
        await setDoc(doc(db, 'hq_work_orders', shopWoId), withItemCode(shape.shopSibling), { merge: true });
        made.push(`🔧 custom pole${custom.length === 1 ? '' : 's'} — shop job ${shopWoId} + finishing job ${woId}, linked; the small-parts pick releases when the shop starts`);
    }
    for (const rc of rodCuts) {
        await setDoc(doc(db, 'rod_cut_orders', rc.cutId), {
            id: rc.cutId, brand, status: 'OPEN',
            sourceItemId: rc.sourceItemId, sourceInternalId: rc.sourceInternalId,
            targetItemId: rc.targetItemId, targetInternalId: rc.targetInternalId,
            qtySource: rc.sourceQty, qtyTarget: rc.targetQty, cutTo: rc.cutTo, scrapFt: rc.scrapFt,
            sourceBin: null, destBin: null, nsAdjustmentId: null,
            purpose: 'FINISHING', createdVia: 'FINISHING_WO',
            finWoId: woId, finWoErpId: rc.erp, finWoQty: rc.qty, finWoRecipe: group.finish, finWoReqDate: needBy,
            overrun: rc.overrun, createdAt: now, createdBy: user, completedAt: null, completedBy: null,
        }, { merge: true });
    }
    made.unshift(`🎨 ${woId} — ${group.rowLabel ? `${group.rowLabel} · ` : ''}${group.finish}: ${small.length} small-part line${small.length === 1 ? '' : 's'}${custom.length ? ` + ${custom.length} custom pole line${custom.length === 1 ? '' : 's'}` : ''} (SO ${soRef}) → RTG${Object.keys(fullGate).length ? ` — gated: ${Object.keys(fullGate).filter(k => /^awaiting|^backOrdered$/.test(k)).join(', ')}` : ''}`);
    return { woId, shopWoId: shape.shopSibling ? shopWoId : null, gate: fullGate, finPayload: hq.finPayload, made, custom, small };
};
