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

import { planFinishedRun, fetchAvailability, stockCheckReport } from './finishedGoodsRun.js';
import { millBaseOf } from './finishRouting.js';
// The firebase imports serve only the executor/gate-clearer at the bottom — the planners above
// never touch them, so node tests can import the planning half without dragging firebase in.
import { db } from '../../firebase';
import { doc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { withItemCode } from './workOrderContract';

// ── PURE PLANNING ──────────────────────────────────────────────────────────────────────────────

// One row's short pull lines → the make-up actions that cover them. `rawRemaining` is the live
// raw availability MINUS what earlier rows in the same batch already claimed (the caller deducts);
// pass rawKnown:false when the raw read failed — converts are still raised (the operator sees the
// raw situation on the Convert tab), but no shop WO is invented off a number we do not have.
export const planMakeupActions = ({ shortRows = [], rawRemaining = {}, rawKnown = true }) => {
    const actions = [];
    shortRows.forEach(r => {
        const code = String(r.code || '').toUpperCase();
        const mill = millBaseOf(code);
        const isPhos = /\/P$/.test(code) && mill !== code;
        if (isPhos) {
            const rawHave = rawKnown ? Math.max(0, Number(rawRemaining[mill]) || 0) : null;
            actions.push({ kind: 'CONVERT', target: code, base: mill, qty: r.short, rawHave });
            if (rawKnown && rawHave < r.short) actions.push({ kind: 'SHOP', code: mill, qty: r.short - rawHave, reason: `raw behind ${code}` });
        } else {
            actions.push({ kind: 'SHOP', code, qty: r.short, reason: 'pull line short' });
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
// Returns { results: [{ key, plan, check, actions }], nsError }. nsError set = NetSuite was
// unreachable: checks are null and actions empty — callers proceed exactly as before the
// pre-check existed, saying so.
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

    let avail;
    try { avail = await fetchAvailability(pullCodes, locationId); }
    catch (e) { return { results: results.map(x => ({ ...x, check: null, actions: [] })), nsError: e.message || String(e) }; }

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
    let rawRemaining = {}, rawKnown = true;
    if (rawCodes.size) {
        try { rawRemaining = { ...(await fetchAvailability([...rawCodes], locationId)) }; }
        catch (e) { rawKnown = false; }
    }

    return {
        nsError: null,
        results: checked.map(x => {
            const actions = planMakeupActions({ shortRows: x.check.shortRows, rawRemaining, rawKnown });
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
export const executeMakeupActions = async ({ actions = [], brandId, finWoId, finWoErpId, createdBy = '', inventory = [], source = 'precheck', reqDate = '' }) => {
    const partOf = (c) => inventory.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === String(c).toUpperCase()) || null;
    const made = [], convertDemandIds = [], shopWoIds = [];
    for (let i = 0; i < actions.length; i++) {
        const a = actions[i];
        if (a.kind === 'CONVERT') {
            const basePart = partOf(a.base), targetPart = partOf(a.target);
            const demandId = `CVD-${String(brandId).toUpperCase()}-${Date.now()}-${++seq}`;
            await setDoc(doc(db, 'convert_demand', demandId), {
                id: demandId, brandId, status: 'open',
                woNum: `CVW-${String(brandId).toUpperCase()}-${(Date.now() + i).toString().slice(-6)}`,
                baseErpId: a.base, baseItemId: basePart?.id || null,
                baseInternalId: basePart?.netSuiteInternalId ? String(basePart.netSuiteInternalId) : null,
                baseAvailAtRequest: a.rawHave ?? null,
                targetErpId: a.target, targetItemId: targetPart?.id || null,
                targetInternalId: targetPart?.netSuiteInternalId ? String(targetPart.netSuiteInternalId) : null,
                qty: a.qty, source,
                // The gate link — same idea as rod_cut_orders.finWoId: completing this demand
                // releases (or helps release) the work order it was raised for.
                finWoId: finWoId || null, finWoErpId: finWoErpId || null,
                note: `Component pre-check for ${finWoErpId || finWoId || 'run'} — ${a.target} short ${a.qty}`,
                createdBy, createdAt: Date.now(),
            });
            convertDemandIds.push(demandId);
            made.push(`⇄ CONVERT ${a.qty} × ${a.base} → ${a.target} (WMS Convert tab)`);
        } else if (a.kind === 'SHOP') {
            const p = partOf(a.code);
            if (!p) { made.push(`⚠ ${a.code} not in the library — order it manually`); continue; }
            const stamp = Date.now().toString().slice(-6);
            const safe = String(a.code).replace(/[^A-Za-z0-9]+/g, '-');
            const woId = `WO-CMP-${safe}-${stamp}-${++seq}`;
            await setDoc(doc(db, 'hq_work_orders', woId), withItemCode({
                id: woId, woId, brand: brandId, type: 'Stock', status: 'Approved',
                source: 'PRECHECK_MAKEUP', routeTo: 'SHOP',
                erpId: a.code, partErpId: a.code, rootItem: a.code,
                nsItemId: p.netSuiteInternalId ? String(p.netSuiteInternalId) : null,
                hqJobId: p.id || null,
                qty: a.qty, totalParts: a.qty, reqDate: reqDate || '',
                customer: 'Internal Stock',
                routingType: p.routingType || 'Standard',
                note: `Component make-up for ${finWoErpId || finWoId || 'finished run'} — ${a.reason || 'short'}`,
                createdAt: Date.now(), createdBy,
            }), { merge: true });
            shopWoIds.push(woId);
            made.push(`🏭 SHOP WO ${woId} — ${a.qty} × ${a.code} (RTG → Push to Shop)`);
        }
    }
    const gateFields = convertDemandIds.length ? {
        awaitingConvert: true, convertDemandIds,
        convertGateNote: made.filter(m => m.startsWith('⇄')).join(' · '),
    } : {};
    return { made, convertDemandIds, shopWoIds, gateFields };
};

// Called by the WMS after a convert_demand carrying a finWoId completes (the demand doc is deleted
// by then — pass the data captured before the delete). The gate opens only when no OTHER open
// demand still points at the same work order. Returns true when the gate was cleared.
export const clearConvertGate = async (demand, operatorName = '') => {
    const finWoId = demand && demand.finWoId;
    if (!finWoId) return false;
    const snap = await getDocs(query(collection(db, 'convert_demand'), where('finWoId', '==', finWoId)));
    if (snap.docs.some(d => d.id !== demand.id)) return false;
    await updateDoc(doc(db, 'hq_work_orders', finWoId), {
        awaitingConvert: false, convertDoneAt: Date.now(), convertDoneBy: operatorName || '',
    });
    return true;
};
