// COMPONENT PRE-CHECK — the ONE routing check every work-order-creating screen runs before a
// FINISHED-goods work order is written (Stuart 2026-08-27, from WO11494: HRW-138TRAVLB, a NetSuite
// assembly with a 2-component BOM, reached the finishing Setup Queue with no component check at
// all — the check lived only in the Master Library tool, and every screen is supposed to answer
// this question the same way).
//
// The policy, per pull line the run needs (planFinishedRun decides the lines — a stocked assembly
// takes its BOM literally, a custom single pulls its own /P core):
//   pull line IN STOCK        → nothing to do; the pick pulls it from its bin.
//   /P core short, raw exists → a CONVERT demand (the WMS Convert tab phosphates raw → /P) and
//                               the work order is GATED (awaitingConvert) until the convert POSTS —
//                               the same wait the rod-cut gate already implements. The gate clears
//                               from the WMS when the last linked demand completes.
//   /P short, raw short too   → the convert demand PLUS a component shop WO (parked in RTG,
//                               Push to Shop → milling scheduler) for the raw shortfall. The
//                               finishing WO still gates on the convert only: the convert cannot
//                               post until the shop has made the raw, so the chain holds without
//                               a shop-completion signal.
//   raw pull line short       → a component shop WO for the shortfall (no gate — the operator
//                               releases the finishing WO when the components arrive).
//
// The planning half is PURE (assertable in node --test); the executor and the gate-clearer touch
// Firestore and live at the bottom.

import { planFinishedRun, fetchAvailability, stockCheckReport, isAssemblyPart } from './finishedGoodsRun.js';
import { millBaseOf } from './finishRouting.js';
import { fetchAvailabilityUnits } from './oeReviewPlan.js';
import { SOURCING, sourcingOf } from './sourcing.js';
import { queueNsAssemblyWorkOrder, pickNsWoItem } from './nsWorkOrder';
// The firebase imports serve only the executor/gate-clearer at the bottom — the planners above
// never touch them, so node tests can import the planning half without dragging firebase in.
import { db } from '../../firebase';
import { doc, setDoc, updateDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { withItemCode } from './workOrderContract';

// ── PURE PLANNING ──────────────────────────────────────────────────────────────────────────────

// One row's short pull lines → the make-up actions that cover them. `rawRemaining` is the live
// raw availability MINUS what earlier rows in the same batch already claimed (the caller deducts).
// rawKnown:false (the raw read failed) once meant "converts anyway, just no shop WO" — that is the
// exact state the 2026-08-29 TRAVLB test failed into: a WO gated on phosphating raw that did not
// exist, with production silently skipped. runBatchPrecheck now refuses to plan such a row at all
// (rawUnknown), so this function only ever sees rawKnown:false for a row with no /P shorts.
// v2 (Stuart 2026-08-30, "1–5 tonight"): the same lessons the review gate learned, inherited by
// EVERY caller of this planner — coverage and sourcing decided here, so no legacy path can invent
// a milling WO for a bought part or re-order what is already inbound.
//   onOrderLeft — NetSuite quantityonorder per code, consumed as it covers shorts.
//   partOf      — resolve a component code to its library record (sourcing decisions).
// A short that inbound covers → COVERED (a note, no document). A short on a BOUGHT part →
// BUY_NOTE (a note naming the vendor — the PO decision belongs to a person, never invented here).
export const planMakeupActions = ({ shortRows = [], rawRemaining = {}, rawKnown = true, onOrderLeft = {}, partOf = null }) => {
    const actions = [];
    const acquire = (code, qty, reason) => {
        const pool = Math.max(0, Number(onOrderLeft[code]) || 0);
        if (pool >= qty) {
            onOrderLeft[code] = pool - qty;
            return { kind: 'COVERED', code, qty, reason, coveredBy: pool };
        }
        const p = partOf ? partOf(code) : null;
        if (p && !isAssemblyPart(p) && sourcingOf(p.manufacturingSpecs || {}) === SOURCING.OUT) {
            return { kind: 'BUY_NOTE', code, qty, reason, vendorName: String(p.manufacturingSpecs?.vendorName || '').trim(), onOrder: pool };
        }
        return { kind: 'SHOP', code, qty, reason };
    };
    shortRows.forEach(r => {
        const code = String(r.code || '').toUpperCase();
        const mill = millBaseOf(code);
        const isPhos = /\/P$/.test(code) && mill !== code;
        if (isPhos) {
            const rawHave = rawKnown ? Math.max(0, Number(rawRemaining[mill]) || 0) : null;
            actions.push({ kind: 'CONVERT', target: code, base: mill, qty: r.short, rawHave });
            if (rawKnown && rawHave < r.short) actions.push(acquire(mill, r.short - rawHave, `raw behind ${code}`));
        } else {
            actions.push(acquire(code, r.short, 'pull line short'));
        }
    });
    return actions;
};

// ── BATCH CHECK (one live NetSuite read for a whole Generate press) ────────────────────────────
//
// rows: [{ key, part, qty, pins }] — part is the library record (or {legacyErpId} when unlinked),
// pins the assembly_pins rows (empty for singles). Availability is read ONCE for every pull code
// in the batch and consumed row by row, so two rows shorting the same component do not both read
// the same shelf as covering them; the raw behind /P shorts is read the same way.
//
// Returns { results: [{ key, plan, check, actions, rawUnknown? }], nsError, rawError }. nsError
// set = NetSuite was unreachable: checks are null and actions empty — callers proceed exactly as
// before the pre-check existed, saying so. rawError set = the availability read succeeded but the
// RAW read behind the /P shorts failed twice: every affected row comes back rawUnknown:true with
// NO actions, and the caller MUST NOT create that row's work order — block it loudly and let the
// operator retry Generate (writing converts against unverified raw is how production gets
// silently skipped).
export const runBatchPrecheck = async ({ rows = [], inventory = [], locationId }) => {
    const results = rows.map(row => {
        const plan = planFinishedRun({ part: row.part, qty: row.qty, pins: row.pins || [], inventory });
        // A single with no /P record "pulls" its own code (the planner's fallback). Checking that
        // would read the very shortage that prompted the order and mint a bogus make-up WO for the
        // finished item itself — the pre-check knows components, not the item, so drop self-pulls.
        const lines = plan.exploded ? plan.lines : plan.lines.filter(l => String(l.legacyErpId || '').toUpperCase() !== plan.erp);
        return { key: row.key, plan: { ...plan, lines } };
    });
    const pullCodes = [...new Set(results.flatMap(x => x.plan.lines.map(l => String(l.legacyErpId || '').toUpperCase()).filter(Boolean)))];
    if (!pullCodes.length) return { results: results.map(x => ({ ...x, check: null, actions: [] })), nsError: null };

    let avail, onOrderLeft = {};
    try {
        // Units read carries quantityonorder — coverage prevents re-ordering inbound stock
        // (Stuart 2026-08-30). Falls back to the plain read if the units query is refused.
        const res = await fetchAvailabilityUnits(pullCodes, locationId);
        avail = {}; Object.entries(res.map).forEach(([c, v]) => { avail[c] = v.available; onOrderLeft[c] = v.onOrder || 0; });
    } catch (e0) {
        try { avail = await fetchAvailability(pullCodes, locationId); }
        catch (e) { return { results: results.map(x => ({ ...x, check: null, actions: [] })), nsError: e.message || String(e) }; }
    }

    // First pass: per-row shortages against the running remainder.
    const remaining = { ...avail };
    const checked = results.map(x => {
        const check = stockCheckReport(x.plan.lines, remaining);
        x.plan.lines.forEach(l => {
            const c = String(l.legacyErpId || '').toUpperCase();
            remaining[c] = Math.max(0, (Number(remaining[c]) || 0) - (Number(l.quantity) || 0));
        });
        return { ...x, check };
    });

    // Raw behind every /P short — one read, then consumed convert by convert.
    const rawCodes = new Set();
    checked.forEach(x => x.check.shortRows.forEach(r => {
        const mill = millBaseOf(r.code);
        if (/\/P$/.test(String(r.code)) && mill && mill !== r.code) rawCodes.add(mill);
    }));
    let rawRemaining = {}, rawKnown = true, rawError = null;
    if (rawCodes.size) {
        // Two attempts: the first raw read failing is what silently skipped TRAVLB's production
        // on 2026-08-29 — a transient NetSuite hiccup must not decide routing.
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const rr = await fetchAvailabilityUnits([...rawCodes], locationId);
                rawRemaining = {}; Object.entries(rr.map).forEach(([c, v]) => { rawRemaining[c] = v.available; if (onOrderLeft[c] == null) onOrderLeft[c] = v.onOrder || 0; });
                rawKnown = true; rawError = null; break;
            }
            catch (e) { rawKnown = false; rawError = e.message || String(e); }
        }
    }

    return {
        nsError: null,
        rawError,
        results: checked.map(x => {
            // A /P short with the raw read down is UNDECIDABLE: raising the convert without knowing
            // whether raw exists gates the WO on phosphating stock that may not be there, and the
            // shop WO that would make it is never raised. Refuse to plan the row — the caller must
            // block it loudly and offer a retry, never write the convert-only outcome.
            const hasPhosShort = x.check.shortRows.some(r => {
                const code = String(r.code || '').toUpperCase();
                return /\/P$/.test(code) && millBaseOf(code) !== code;
            });
            if (!rawKnown && hasPhosShort) return { ...x, actions: [], rawUnknown: true };
            const partOfInv = (c) => (inventory || []).find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;
            const actions = planMakeupActions({ shortRows: x.check.shortRows, rawRemaining, rawKnown, onOrderLeft, partOf: partOfInv });
            actions.forEach(a => {
                if (a.kind === 'CONVERT') rawRemaining[a.base] = Math.max(0, (Number(rawRemaining[a.base]) || 0) - a.qty);
            });
            return { ...x, actions };
        }),
    };
};

// ── EXECUTION (Firestore writes) ───────────────────────────────────────────────────────────────

// Write one row's make-up actions: convert demands (linked to the parent WO by finWoId — the WMS
// clears the gate through that link) and component shop WOs (parked in RTG, route SHOP).
// Returns what was made plus the gate fields the caller stamps on the parent work order.
// `seq` de-dupes doc ids across same-millisecond calls (two batch rows shorting one component).
let seq = 0;
export const executeMakeupActions = async ({ actions = [], brandId, finWoId, finWoErpId, createdBy = '', inventory = [], source = 'precheck', reqDate = '', dispatchShop = false, soRef = '', customerName = '' }) => {
    const partOf = (c) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;
    const made = [], convertDemandIds = [], shopWoIds = [];
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.kind === 'CONVERT') {
            const basePart = partOf(a.base), targetPart = partOf(a.target);
            const woPick = pickNsWoItem({ base: basePart, target: targetPart, baseErp: a.base, targetErp: a.target });
            const targetIsNsAsm = !!(woPick && woPick.side === 'target');
            const demandId = `CVD-${String(brandId).toUpperCase()}-${Date.now()}-${++seq}`;
            await setDoc(doc(db, 'convert_demand', demandId), {
                id: demandId, brandId, status: 'open',
                woNum: `CVW-${String(brandId).toUpperCase()}-${(Date.now() + i).toString().slice(-6)}`,
                baseErpId: a.base, baseItemId: basePart?.id || null,
                baseInternalId: basePart?.netSuiteInternalId ? String(basePart.netSuiteInternalId) : null,
                baseAvailAtRequest: a.rawHave ?? null,
                targetErpId: a.target, targetItemId: targetPart?.id || null,
                targetInternalId: targetPart?.netSuiteInternalId ? String(targetPart.netSuiteInternalId) : null,
                targetIsNsAssembly: targetIsNsAsm,
                qty: a.qty, source,
                // The gate link — same idea as rod_cut_orders.finWoId: completing this demand
                // releases (or helps release) the work order it was raised for.
                finWoId: finWoId || null, finWoErpId: finWoErpId || null,
                note: `Component pre-check for ${finWoErpId || finWoId || 'run'} — ${a.target} short ${a.qty}`,
                createdBy, createdAt: Date.now(),
            });
            convertDemandIds.push(demandId);
            made.push(`⇄ CONVERT ${a.qty} × ${a.base} → ${a.target} (WMS Convert tab)`);
            // THE NETSUITE ANCHOR (Stuart 2026-08-30: "RTG is king, anchored to NetSuite" — the
            // /P assembly IS the work-order vehicle for a raw-consuming convert). An open NS WO
            // is queued for the /P; the number stamps back onto the DEMAND, and the WMS convert
            // then builds AGAINST it (createdfrom) so NetSuite closes it as the build posts.
            // No NS assembly for the /P → said out loud, never guessed.
            if (woPick) {
                try {
                    await queueNsAssemblyWorkOrder({
                        brandId, assemblyInternalId: woPick.internalId,
                        erp: woPick.erp, qty: a.qty, reqDate,
                        memo: `${soRef ? `SO ${soRef} · ` : ''}${woPick.side === 'base' ? `mill ${a.base}, convert to ${a.target}` : `convert ${a.base} → ${a.target}`}${finWoErpId ? ` · for ${finWoErpId}` : ''}`,
                        writeBacks: [{ collection: 'convert_demand', docId: demandId, patch: { nsWoOnErp: woPick.erp }, idField: 'nsWoId', tranField: 'nsWoTran' }],
                        sourceApp: source || 'precheck', createdBy,
                    });
                    // The claim stamp — RTG's auto-anchor skips demands that already queued,
                    // so a slow outbox never earns a duplicate NetSuite work order.
                    await updateDoc(doc(db, 'convert_demand', demandId), { nsWoQueuedAt: Date.now(), nsWoQueuedBy: createdBy || 'creation', nsWoAttempts: 1 });
                    made.push(`📤 NS work order queued on ${woPick.erp} ×${a.qty}${woPick.side === 'base' ? ' (the root item — NetSuite\'s assembly)' : ' — the convert builds against it'}`);
                } catch (nsErr) {
                    made.push(`⚠ ${woPick.erp}: NetSuite WO queue failed (${nsErr.message || nsErr}) — RTG auto-anchor will retry`);
                }
            } else {
                made.push(`⚠ neither ${a.base} nor ${a.target} is a synced NetSuite ASSEMBLY — no work-order anchor; convert posts standalone (fix the item with Eric)`);
            }
        } else if (a.kind === 'COVERED') {
            made.push(`✔ ${a.qty} × ${a.code} already covered by ${a.coveredBy} on order (open PO/WO in NetSuite) — nothing raised`);
        } else if (a.kind === 'BUY_NOTE') {
            made.push(`🧾 ${a.code} short ${a.qty} — BOUGHT item${a.vendorName ? ` (vendor ${a.vendorName})` : ''}: raise the PO from Stock View / the review gate; no shop WO invented${a.onOrder ? ` (${a.onOrder} on order, not enough)` : ''}`);
        } else if (a.kind === 'SHOP') {
            const p = partOf(a.code);
            if (!p) { made.push(`⚠ ${a.code} not in the library — order it manually`); continue; }
            const stamp = Date.now().toString().slice(-6);
            const safe = String(a.code).replace(/[^A-Za-z0-9]+/g, '-');
            const woId = `WO-CMP-${safe}-${stamp}-${++seq}`;
            await setDoc(doc(db, 'hq_work_orders', woId), withItemCode({
                id: woId, woId, brand: brandId, type: 'Stock', status: dispatchShop ? 'Dispatched' : 'Approved',
                source: 'PRECHECK_MAKEUP', routeTo: 'SHOP',
                ...(dispatchShop ? { pushedToShop: true, dispatchedAt: Date.now(), dispatchedBy: createdBy || 'auto-flow' } : {}),
                erpId: a.code, partErpId: a.code, rootItem: a.code,
                itemName: p.itemName || '',
                nsItemId: p.netSuiteInternalId ? String(p.netSuiteInternalId) : null,
                hqJobId: p.id || null,
                qty: a.qty, totalParts: a.qty, reqDate: reqDate || '',
                customer: 'Internal Stock',
                routingType: p.routingType || 'Standard',
                note: `Component make-up for ${finWoErpId || finWoId || 'finished run'} — ${a.reason || 'short'}${soRef ? ` · SO ${soRef}` : ''}`,
                createdAt: Date.now(), createdBy,
            }), { merge: true });
            // ORDER ENTRY AUTO-FLOW (Stuart 2026-08-28): the system already knows the route — a
            // component milling WO goes STRAIGHT to the shop's milling intake instead of parking
            // in RTG for a human's Push to Shop. Same doc shape RTG's pushToShop writes.
            if (dispatchShop) {
                await setDoc(doc(db, 'shop_custom_orders', `SHOP-${woId}`), {
                    id: `SHOP-${woId}`, woNum: `SHOP-${woId}`, orderKey: woId,
                    quoteId: null, salesOrderId: null, finSiblingId: null, hasSmallSibling: false,
                    soNum: soRef || 'N/A', isStock: true, routeTo: 'MILLING',
                    partNum: a.code, itemCode: a.code, item: p.itemName || a.code, qty: a.qty,
                    isOutsourced: false, finishRecipe: 'PENDING-RECIPE', outsourcePrice: 0,
                    reqDate: reqDate || '', category: 'Stock Milling', status: 'Pending', priority: 999,
                    brand: brandId, customerId: null, clientName: customerName || 'Internal Stock',
                    note: `Component make-up for ${finWoErpId || ''}${soRef ? ` · SO ${soRef}` : ''} — mill, then phosphate (convert), then finishing`,
                    cpqSpecs: {}, imageUrl: null,
                    // The raw this WO makes is destined for the /P convert — the shop's own
                    // in-house-finish rule would derive this anyway; stated explicitly here.
                    needsPhosphating: true, isPlatingDemand: false,
                    rootItem: a.code, createdAt: Date.now(), createdBy,
                });
            }
            shopWoIds.push(woId);
            made.push(`🏭 SHOP WO ${woId} — ${a.qty} × ${a.code}${dispatchShop ? ' (sent to shop milling)' : ' (RTG → Push to Shop)'}`);
        }
    }
    const gateFields = convertDemandIds.length ? {
        awaitingConvert: true, convertDemandIds,
        convertGateNote: made.filter(m => m.startsWith('⇄')).join(' · '),
    } : {};
    return { made, convertDemandIds, shopWoIds, gateFields };
};

// Release a parked finishing WO to the floor: verbatim finPayload copy → fin_workorders, the hq
// record marked Dispatched. Used by the ORDER ENTRY AUTO-FLOW — at creation when components are
// in stock, and from the WMS convert-complete hook when the last gate opens. Route A (an
// app-queued NetSuite work order) deliberately never runs here: sales-typed payloads' NetSuite
// record is the sales order itself.
export const releaseFinWoToFloor = async (hqWo, by = '') => {
    const fp = hqWo && hqWo.finPayload;
    if (!fp || !fp.id || hqWo.pushedToFinishing) return false;
    // The NetSuite work-order stamp rides onto the floor card (Stuart 2026-08-29: every floor
    // doc carries its NS WO number). The number lands on the hq record via the outbox writeBack,
    // so at release time the hq doc is the source.
    await setDoc(doc(db, 'fin_workorders', fp.id), withItemCode({
        ...fp,
        ...(hqWo.nsWoId ? { nsWoId: hqWo.nsWoId, nsWoTran: hqWo.nsWoTran || null } : {}),
        dispatchedAt: Date.now(), dispatchedBy: by || 'auto-flow',
    }));
    await updateDoc(doc(db, 'hq_work_orders', hqWo.id), { pushedToFinishing: true, status: 'Dispatched', dispatchedAt: Date.now(), dispatchedBy: by || 'auto-flow' });
    return true;
};

// Called by the WMS after a convert_demand carrying a finWoId completes (the demand doc is deleted
// by then — pass the data captured before the delete). The gate opens only when no OTHER open
// demand still points at the same work order. An AUTO-FLOW work order (Order Entry) then releases
// itself straight to the finishing floor — raw was made, /P now exists, finishing is next; no
// human hop in between. Returns 'released' | 'cleared' | false.
export const clearConvertGate = async (demand, operatorName = '') => {
    const finWoId = demand && demand.finWoId;
    if (!finWoId) return false;
    const snap = await getDocs(query(collection(db, 'convert_demand'), where('finWoId', '==', finWoId)));
    if (snap.docs.some(d => d.id !== demand.id)) return false;
    await updateDoc(doc(db, 'hq_work_orders', finWoId), {
        awaitingConvert: false, convertDoneAt: Date.now(), convertDoneBy: operatorName || '',
    });
    try {
        const woSnap = await getDoc(doc(db, 'hq_work_orders', finWoId));
        const wo = woSnap.exists() ? { id: woSnap.id, ...woSnap.data() } : null;
        if (wo && (wo.autoFlow || wo.orderClass === 'ORDER_ENTRY') && !wo.awaitingSoAccept && !wo.awaitingRodCut
            && !(wo.awaitingNsWo && !wo.nsWoId) && !(wo.awaitingComponents && !wo.componentsDone)) {
            const released = await releaseFinWoToFloor(wo, operatorName || 'convert-complete');
            if (released) return 'released';
        }
    } catch (e) { console.warn('auto-flow release after convert failed (gate is cleared; release from RTG):', e); }
    return 'cleared';
};
