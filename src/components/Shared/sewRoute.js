// ── THE ONE WRITER FOR A STITCH & SEW DOCUMENT (Uniquity · S7, step 5a, 2026-10-11) ──────────────
// The shape is pure in Shared/sewRouteShape (asserted by scripts/sewRoute.test.mjs); this file writes it —
// the same way Shared/rowPair.parkRowPair writes a pair: the RTG record (`hq_work_orders`) with the finishing
// payload inside, the receipt gate when a part is on order, the material grid stamp. No shop sibling, no
// make-up (nothing is converted or milled for a pillow), no rod cut, no NetSuite work order (rule 3 of
// 09-23: the sales order is the record). The release is the route's own (`releaseFinWoToFloor`), exactly
// as a pair's.
import { db } from '../../firebase';
import { doc, setDoc, getDoc, getDocs, query, collection, where, updateDoc, arrayUnion } from 'firebase/firestore';
import { withItemCode } from './workOrderContract';
import { receiptGateFields, ParkRefusal } from './workOrderCreate';
import { materialRowsOf, materialStampOf } from './materialGrid.js';
import { pairIdsOf } from './rowPairShape.js';
import { uomStampOf } from './uom.js';
import { pairFactsOf } from './partFacts.js';
import { sewDocShapeOf, isSewGroup, SEW_FINISH } from './sewRouteShape.js';
import { DEFAULT_PILLOW_PRICING, PILLOW_PRICING_DOC } from './pillowPricing.js';

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * THE WRITER FOR A SEWING GROUP (every job a pillow holder — Shared/sewRouteShape.isSewGroup).
 * @returns { woId, shopWoId: null, gate, finPayload, hq, made, custom: [], small: jobs } — the pair writer's shape,
 *          so the Order Entry route reads the result the same way.
 */
export const parkSewDoc = async ({ group, so, brand, user = '', inventory = [], now = Date.now(), receiptRefs = [] }) => {
    if (!isSewGroup(group)) throw new ParkRefusal('NOT_SEW', 'parkSewDoc: every job of the group must be a custom pillow');
    // AN ID IS NEVER REUSED (the pair writer's rule): the short id carries four digits of the clock; a taken one steps it.
    const taken = async (ids) => (await getDoc(doc(db, 'hq_work_orders', ids.woId))).exists()
        || (await getDoc(doc(db, 'fin_workorders', ids.woId))).exists();
    let ids = pairIdsOf(so, { ...group, finish: SEW_FINISH }, now);
    for (let step = 1; step <= 50 && await taken(ids); step++) ids = pairIdsOf(so, { ...group, finish: SEW_FINISH }, now + step);
    if (await taken(ids)) throw new ParkRefusal('ID_TAKEN', `no free work order id for ${group.rowLabel || 'the order'} · Stitch & Sew — try again`);
    const { woId } = ids;
    const made = [];
    const soRef = String((so && (so.soId || so.id)) || '');
    let gate = {};
    if (receiptRefs && receiptRefs.length) {
        const rg = receiptGateFields(receiptRefs);
        if (rg.awaitingReceipt) { gate = { ...gate, ...rg }; made.push(`📦 waiting on material — ${rg.receiptGateNote}`); }
    }
    // the minimum cut per size rides the document for the cutter (6.5 Tools → Pillow Pricing)
    let config = DEFAULT_PILLOW_PRICING;
    try { const snap = await getDoc(doc(db, 'system', PILLOW_PRICING_DOC)); if (snap.exists()) config = { ...DEFAULT_PILLOW_PRICING, ...snap.data() }; } catch (e) { console.warn('sew route: price table read failed', e); }
    const components = (group.jobs || []).flatMap(j => j.components || []);
    const planLines = (group.jobs || []).flatMap(j => j.__planLines || j.sewParts || []);
    const materialStamp = materialStampOf(materialRowsOf({ components, planLines, gate, poleChoice: null, backOrder: '', shopWoIds: [], unitsKnown: !(group.jobs || []).some(j => j.unitsKnown === false) }), now);
    const note = `Order Entry ${soRef} · ${(so && so.customer) || ''} · ${group.rowLabel ? `${group.rowLabel} · ` : ''}Stitch & Sew${so && so.sidemark ? ` · ${so.sidemark}` : ''}`;
    // A SHELF CUT BEFORE THE ROLL (Stuart 2026-10-11): the live cuts of every fabric this document pulls, read once;
    // the shape allocates; what it allocated is consumed below, named for this work order.
    let pieces = [];
    try {
        const codes = [...new Set(planLines.map(pl => U(pl.legacyErpId)).filter(Boolean))];
        for (let i = 0; i < codes.length; i += 10) {
            const snap = await getDocs(query(collection(db, 'fabric_pieces'), where('itemCode', 'in', codes.slice(i, i + 10)), where('status', '==', 'CUT')));
            pieces.push(...snap.docs.map(d => d.data()));
        }
    } catch (e) { console.warn('sew route: cut ledger read failed — the roll is pulled', e); pieces = []; }
    const shape = sewDocShapeOf({ group, so, brand, createdBy: user, now, inventory, gate, materialStamp, woId, note, config, uomOf: uomStampOf, factsOf: pairFactsOf, pieces });
    for (const a of shape.allocations || []) {
        try {
            await updateDoc(doc(db, 'fabric_pieces', a.pieceId), { status: 'CONSUMED', updatedAt: now, consumedFor: woId, history: arrayUnion({ orderRef: woId, outcome: `allocated to ${woId} · panel ${a.panel || '?'}`, by: user || '', at: now }) });
        } catch (e) { console.warn('sew route: could not consume piece', a.pieceId, e); }
    }
    (shape.allocationNotes || []).forEach(n => made.push(`🧶 shelf cut — ${n}`));
    const hq = withItemCode({ ...shape.hq, finPayload: withItemCode(shape.finPayload) });
    await setDoc(doc(db, 'hq_work_orders', woId), hq, { merge: true });
    const sourced = shape.pillows.flatMap(p => p.sourced || []);
    made.unshift(`🧵 ${woId} — ${group.rowLabel ? `${group.rowLabel} · ` : ''}Stitch & Sew: ${shape.pillows.reduce((s, p) => s + p.qty, 0)} custom pillow(s), ${shape.partsList.length} pull line(s)${sourced.length ? ` · TO BE SOURCED: ${sourced.map(s => U(s.code)).join(', ')}` : ''} — no shop half, no NetSuite work order (the sales order is the record)`);
    return { woId, shopWoId: null, gate, finPayload: hq.finPayload, hq, made, custom: [], small: group.jobs || [] };
};
