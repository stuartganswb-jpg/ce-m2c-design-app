// 🪵 WHAT THE APP HAS ALREADY TAKEN FROM THE SHELF (Eric 2026-09-30, App Imp: "Looks like each Rod stock order
// assesses the current On Hand inventory, regardless of availability … the first item says only 1 cut is needed,
// when really it should be 5 rods cut" · Stuart: "yes go ahead" — HCUMP410/CP and HCUMP410/N25).
//
// 12.5 decides cut-or-shelf for a rod stock order against NetSuite's AVAILABLE count, with a running tally inside
// ONE Generate press. The orders an earlier press raised are the app's: parked in RTG with no NetSuite work order
// yet, or dispatched and picked but not built — NetSuite commits nothing for them, so its "available" still counts
// the rods they took. On 9/28 two HCUMP410 orders took the 18 on the rack; on 9/30 the next HCUMP410/CP × 10 read
// the rack as free again and offered "cut 1" where five cuts were needed.
//
// This is what the app's own OPEN documents have claimed and NetSuite cannot see, per code:
//   • a document with a NetSuite WORK ORDER is NetSuite's to count — it commits the rods while the work order is
//     open and consumes them when it is built (HCUMP410's WO11657 / WO11624 / WO11610 are Built, WO11612 holds its
//     last one) — so it claims nothing here;
//   • every other open document (not packed) takes its pulls from the shelf: a finishing document its pull lines,
//     an RTG record with no finishing document yet its material rows — a record and its finishing document are
//     one claim, never two (9/28's HCUMP410/N25 × 10, parked with no NetSuite work order, had taken the last 8);
//   • pieces the document's OWN open rod cut will add do not come off today's shelf (a DONE cut has posted to
//     NetSuite — the WMS marks it done only when the adjustment is accepted — so its pieces are on hand);
//   • an OPEN rod cut will take its SOURCE rods off the shelf.
// Over-claiming raises a cut that was not needed (spare stock); under-claiming leaves an order short. Pure.
// scripts/shelfClaims.test.mjs asserts it.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const RTG_CLOSED = new Set(['CLOSED', 'COMPLETE', 'COMPLETED', 'CANCELLED', 'DELETED']);
const openFin = (d) => !!d && !d.deleted && d.currentPhase !== 'Closed' && !d.packStatus;
const openRtg = (d) => !!d && !d.deleted && !RTG_CLOSED.has(U(d.status));
const openCut = (c) => !!c && U(c.status) === 'OPEN';

const add = (m, code, q) => { const c = U(code); if (c && q > 0) m[c] = (m[c] || 0) + q; return m; };
/** A finishing document's pull lines, per code. */
const needsOfFin = (d) => ((d && d.partsList) || []).reduce((m, l) => (l && !l.isFee && !l.lineIsFee && !l.isKit ? add(m, l.legacyErpId || l.partId, N(l.qty)) : m), {});
/** An RTG record's material rows, per code. */
const needsOfRtg = (d) => ((d && d.materialRows) || []).reduce((m, r) => add(m, r && r.code, N(r && r.need)), {});
/** What an open rod cut will ADD, per target code. */
const cutTargetsOf = (c) => {
    const list = Array.isArray(c && c.targets) && c.targets.length ? c.targets : [{ itemId: c && c.targetItemId, qty: c && c.qtyTarget }];
    return list.reduce((m, t) => add(m, t && t.itemId, N(t && t.qty)), {});
};

/**
 * @param finDocs       fin_workorders (all — closed ones tell an RTG record it is no longer its own claim)
 * @param rtgDocs       hq_work_orders
 * @param cutOrders     rod_cut_orders
 * @param codes         the codes being decided (any case)
 * @param exceptIds     documents to leave out (the order being written now)
 * @returns { CODE: { claimed, rows: [{ docId, source, need, fromCut, claim }] } }
 */
export function shelfClaimsOf({ finDocs = [], rtgDocs = [], cutOrders = [], codes = [], exceptIds = [] } = {}) {
    const want = new Set((codes || []).map(U).filter(Boolean));
    const out = {};
    want.forEach(c => { out[c] = { claimed: 0, rows: [] }; });
    const skip = new Set((exceptIds || []).map(String));
    const cutsById = new Map((cutOrders || []).filter(c => c && c.id).map(c => [String(c.id), c]));
    const rtgById = new Map((rtgDocs || []).filter(d => d && d.id).map(d => [String(d.id), d]));
    const allFinIds = new Set((finDocs || []).filter(Boolean).map(d => String(d.id)));
    const pendingCutOf = (doc) => {
        const id = (doc && doc.rodCutId) || ((rtgById.get(String(doc && doc.id)) || {}).rodCutId);
        const c = id ? cutsById.get(String(id)) : null;
        return openCut(c) ? cutTargetsOf(c) : {};
    };
    const hasNsWo = (doc) => [doc.nsWoTran, doc.nsWoId, doc.netsuiteWoNo, doc.netsuiteWoId].some(v => U(v) && U(v) !== 'N/A');
    const consider = (doc, needs, source) => {
        if (skip.has(String(doc.id)) || hasNsWo(doc) || hasNsWo(rtgById.get(String(doc.id)) || {})) return;
        const fromCutMap = pendingCutOf(doc);
        Object.entries(needs).forEach(([code, need]) => {
            if (!want.has(code) || !(need > 0)) return;
            const fromCut = Math.min(need, N(fromCutMap[code]));
            const claim = Math.max(0, need - fromCut);
            if (!claim) return;
            out[code].claimed += claim;
            out[code].rows.push({ docId: String(doc.id), source, need, fromCut, claim });
        });
    };
    (finDocs || []).filter(openFin).forEach(d => consider(d, needsOfFin(d), 'finishing'));
    (rtgDocs || []).filter(openRtg).forEach(d => {
        if (allFinIds.has(String(d.finWoId || d.id)) || allFinIds.has(String(d.id))) return;   // its finishing document speaks for it
        consider(d, needsOfRtg(d), 'rtg');
    });
    // An open cut takes its source rods off the shelf.
    (cutOrders || []).filter(openCut).forEach(c => {
        const code = U(c.sourceItemId);
        const q = N(c.qtySource ?? c.sourceQty);
        if (!want.has(code) || !(q > 0) || skip.has(String(c.id))) return;
        out[code].claimed += q;
        out[code].rows.push({ docId: String(c.id), source: 'rod cut', need: q, fromCut: 0, claim: q });
    });
    return out;
}

/** NetSuite's available less what the app has claimed, per code (never below 0). */
export function freeAfterClaims(avail = {}, claims = {}) {
    const out = {};
    Object.entries(avail || {}).forEach(([c, v]) => { out[U(c)] = Math.max(0, N(v) - N(claims[U(c)] && claims[U(c)].claimed)); });
    return out;
}

/** "28 already taken by open orders not yet in NetSuite (WO-STK-…1694 10, WO-STK-…8094 8 …)". */
export function claimText(entry, max = 3) {
    if (!entry || !(entry.claimed > 0)) return '';
    const rows = [...entry.rows].sort((a, b) => b.claim - a.claim);
    const shown = rows.slice(0, max).map(r => `${r.docId.length > 18 ? `…${r.docId.slice(-12)}` : r.docId} ${r.claim}`);
    return `${entry.claimed} already taken by open orders NetSuite cannot see yet (${shown.join(', ')}${rows.length > max ? ` +${rows.length - max} more` : ''})`;
}
