// ONE LIFECYCLE, ONE AUTHORITY (Stuart 2026-08-19: "this needs to be the single source of truth
// and all places need to point back and be updated, no more orphans still open on the floor").
//
// An order exists as up to four documents — the RTG record (hq_work_orders / hq_sales_orders), the
// finishing job (fin_workorders), the shop job (shop_custom_orders), and the NetSuite work order.
// Until now each SCREEN closed the documents it happened to know about:
//
//   RTG        → fin ✓  shop ✓  RTG ✓  NetSuite ✓
//   Setup Queue→ fin ✓  shop ✗  RTG ✗  NetSuite ✓
//   Stock View → fin ✓  shop ✗  RTG ✓  NetSuite ✓
//   Active Floor completion → fin ✓, and nothing else is ever told
//
// Every ✗ is an orphan: an order closed on the floor that RTG still lists as live work, or a job
// finished by the floor that the board still shows as dispatched. This module is the one closer and
// the one reconciler, so a close means the same thing wherever it is pressed.
//
// Firestore-only and dependency-injected (db, doc, getDoc, …) so it can be reasoned about and
// tested without dragging a component in.

// Every identity an order might be keyed under. The floor and the board have historically keyed the
// same order four different ways, which is why linkage has to be by SET rather than by one field.
export const identityKeysOf = (o) => [...new Set([
    o && o.id, o && o.woId, o && o.soId, o && o.orderKey, o && o.hqJobId, o && o.quoteId,
    o && o.finSiblingId, o && o.shopSiblingId,
].filter(Boolean).map(String))];

// Is this document finished as far as the business is concerned?
export const isClosedState = (d) => !!d && (
    d.currentPhase === 'Closed' || d.status === 'Closed' || d.closed === true ||
    d.stepStatus === 'Closed' ||
    // Soft-deleted (2026-08-25) is terminal too — without this a tombstoned parent silences the
    // orphan audit instead of tripping it.
    d.deleted === true || d.status === 'Deleted' || d.status === 'CANCELLED'
);
export const isDoneState = (d) => !!d && (
    isClosedState(d) || d.currentPhase === 'Complete' || d.packStatus === 'Packed' ||
    d.status === 'Completed' || d.status === 'Built'
);

/**
 * Find every document belonging to one order, starting from ANY of them.
 * Returns { fin: Map, shop: Map, hq: {coll, id, data} | null }.
 */
export async function linkedDocsOf(ctx, order, kind) {
    const { db, doc, getDoc, getDocs, query, collection, where } = ctx;
    const keys = identityKeysOf(order);
    const fin = new Map(), shop = new Map();
    await Promise.all(keys.map(async (k) => {
        const [f, s] = await Promise.all([
            getDoc(doc(db, 'fin_workorders', k)),
            getDoc(doc(db, 'shop_custom_orders', `SHOP-${k}`)),
        ]);
        if (f.exists()) fin.set(f.id, f.data());
        if (s.exists()) shop.set(s.id, s.data());
    }));
    // `in` takes at most 10 — the keys above are already de-duplicated and small.
    const slice = keys.slice(0, 10);
    if (slice.length) {
        const [fq, sq] = await Promise.all([
            getDocs(query(collection(db, 'fin_workorders'), where('orderKey', 'in', slice))),
            getDocs(query(collection(db, 'shop_custom_orders'), where('orderKey', 'in', slice))),
        ]);
        fq.forEach(d => fin.set(d.id, d.data()));
        sq.forEach(d => shop.set(d.id, d.data()));
    }
    // The RTG parent, hunted from the floor as well as from the board — this is the leg that was
    // missing everywhere except RTG itself, and the reason floor closes left orphans behind.
    let hq = null;
    const hqColls = kind === 'sales' ? ['hq_sales_orders'] : ['hq_work_orders', 'hq_sales_orders'];
    for (const coll of hqColls) {
        if (hq) break;
        for (const k of keys) {
            const snap = await getDoc(doc(db, coll, k));
            if (snap.exists()) { hq = { coll, id: snap.id, data: snap.data() }; break; }
        }
    }
    return { fin, shop, hq };
}

/**
 * Close an order EVERYWHERE, from any starting screen.
 *
 * `from` is recorded on every document so a closed order can always answer "who closed me, where".
 * Returns a summary the caller can put in front of the operator — including whether a NetSuite
 * close was queued, which is a REQUEST and not a confirmation (a non-WIP work order refuses it).
 */
export async function closeOrderEverywhere(ctx, { order, kind, by, from, reason, notify }) {
    const { db, doc, updateDoc } = ctx;
    const links = await linkedDocsOf(ctx, order, kind);
    const stamp = {
        closedAt: Date.now(),
        closedBy: by || '',
        closedFrom: from || 'APP',
        ...(reason ? { closeReason: reason } : {}),
    };
    const done = { fin: 0, shop: 0, hq: 0, ns: null };

    for (const [id] of links.fin) {
        // Clearing the PICK fields is part of closing — a job with only its phase stamped stayed in
        // the WMS pick queue afterwards (Sandra 2026-08-17).
        await updateDoc(doc(db, 'fin_workorders', id), {
            currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed',
            sentToPickPack: false, pickStatus: 'Closed', ...stamp,
        });
        done.fin++;
    }
    for (const [id] of links.shop) {
        // The shop queues exit on 'Completed'; `closed: true` records it was closed, not built.
        await updateDoc(doc(db, 'shop_custom_orders', id), { status: 'Completed', closed: true, ...stamp });
        done.shop++;
    }
    if (links.hq) {
        await updateDoc(doc(db, links.hq.coll, links.hq.id), { status: 'Closed', ...stamp });
        done.hq++;
    }

    // NetSuite: one close per order, and only when a work order is actually open there.
    const nsSrc = [...links.fin.entries()].find(([, d]) => d.nsWoId && !d.nsWoClosed && !d.nsWoCompletionPosted);
    const ns = nsSrc
        ? { coll: 'fin_workorders', docId: nsSrc[0], nsWoId: nsSrc[1].nsWoId, tran: nsSrc[1].nsWoTran }
        : ((links.hq && links.hq.data.nsWoId && !links.hq.data.nsWoClosed)
            ? { coll: links.hq.coll, docId: links.hq.id, nsWoId: links.hq.data.nsWoId, tran: links.hq.data.nsWoTran }
            : null);
    if (ns) {
        // ── THE APP CANNOT CLOSE A NON-WIP WORK ORDER (Eric 2026-08-21) ────────────────────────
        // "We do not want to turn on WIP … As the Close function for non-WIP does not create a
        // transaction record, it may not be possible, outside of scripting, for the app."
        //
        // He is right, and it is worth writing down WHY so nobody tries again: !transform/
        // workorderclose only accepts WIP orders, and NetSuite's own Close button is a client-side
        // call — onclick="close_remaining(890002,'workord')" — not an endpoint anything outside
        // that page can reach. There is no REST close for these.
        //
        // So Option 3, his pick: build what is good, and RAISE THE CLOSE AS A TASK for someone to
        // do in NetSuite. The app stops queueing a call that fails every time and starts asking a
        // person, which is the honest version of the same intent. `nsWoClosed` is then stamped by
        // whoever confirms they did it — never by us guessing.
        await updateDoc(doc(db, ns.coll, ns.docId), {
            nsWoCloseRequired: true, nsWoCloseRequestedAt: Date.now(), nsWoCloseRequestedBy: by || '',
            nsWoClosePending: false,
        }).catch(() => {});
        if (links.hq) await updateDoc(doc(db, links.hq.coll, links.hq.id), {
            nsWoCloseRequired: true, nsWoCloseRequestedAt: Date.now(), nsWoCloseRequestedBy: by || '',
            nsWoClosePending: false,
        }).catch(() => {});
        if (notify) {
            await notify(`🔒 CLOSE IN NETSUITE — work order ${ns.tran || ns.nsWoId} (${order.id}) was closed in the app${reason ? ` — ${reason}` : ''}. A non-WIP work order cannot be closed through the API, so its balance needs closing on the NetSuite transaction. Closed by ${by || 'the app'} from ${from || 'the app'}.`).catch(() => {});
        }
        done.ns = ns.tran || ns.nsWoId;
        done.nsNeedsManualClose = true;
    }
    return { ...done, hqFound: !!links.hq, finIds: [...links.fin.keys()], shopIds: [...links.shop.keys()] };
}

/**
 * Tell the RTG record what the floor just did. The board is the single source of truth, which only
 * works if the floor keeps it informed — before this, an order finished on the floor sat on the
 * dispatch board as live work forever.
 */
export async function propagateFloorState(ctx, { finWo, phase, by }) {
    const { db, doc, updateDoc } = ctx;
    if (!finWo) return null;
    const links = await linkedDocsOf(ctx, finWo, finWo.orderType === 'sales' ? 'sales' : 'stock');
    if (!links.hq) return null;                       // orphan — the audit below is what surfaces it
    const patch = phase === 'Complete'
        ? { floorPhase: 'Complete', floorCompletedAt: Date.now(), floorCompletedBy: by || '' }
        : { floorPhase: phase || '', floorUpdatedAt: Date.now() };
    await updateDoc(doc(db, links.hq.coll, links.hq.id), patch).catch(() => {});
    return links.hq.id;
}

/**
 * The orphan audit. Given the board's records and the floor's, report every disagreement:
 *   ORPHAN_FLOOR   — a floor job with no RTG record at all
 *   FLOOR_CLOSED   — closed on the floor, still live on the board
 *   FLOOR_DONE     — the floor finished it, the board still lists it as live work
 *   BOARD_CLOSED   — closed on the board, still live on the floor
 *   NS_CLOSE_TODO  — the app closed it, a person still owes NetSuite the balance close
 *   DEMAND_ORPHAN  — a convert/plating demand whose work order / sales order no longer lives
 *   RODCUT_ORPHAN  — an open rod cut whose work order no longer lives
 * v2 (Stuart 2026-08-29: "after this complete run we should eliminate all orphans everywhere")
 * extends the reach to the demand documents — the exact class that piled up unfound on the WMS
 * Convert tab. Pure, so the rules can be reasoned about without Firestore in the room.
 */
export function auditOrphans({ hqOrders = [], finWos = [], shopJobs = [], convertDemands = [], platingDemands = [], rodCuts = [], salesOrders = [] }) {
    const byKey = new Map();
    hqOrders.forEach(o => identityKeysOf(o).forEach(k => byKey.set(k, o)));
    const parentOf = (d) => identityKeysOf(d).map(k => byKey.get(k)).find(Boolean) || null;
    const out = [];
    const floorJobs = [
        ...finWos.map(d => ({ d, coll: 'fin_workorders' })),
        ...shopJobs.map(d => ({ d, coll: 'shop_custom_orders' })),
    ];
    floorJobs.forEach(({ d, coll }) => {
        const parent = parentOf(d);
        if (!parent) {
            if (!isDoneState(d)) out.push({ type: 'ORPHAN_FLOOR', coll, floor: d, parent: null });
            return;
        }
        if (isClosedState(d) && !isClosedState(parent)) out.push({ type: 'FLOOR_CLOSED', coll, floor: d, parent });
        // Finished (packed/complete/built) but the board still lists it as live work — the exact
        // stale-dispatched problem propagateFloorState was written for, now audited too.
        else if (isDoneState(d) && !isClosedState(parent) && !isDoneState(parent)) out.push({ type: 'FLOOR_DONE', coll, floor: d, parent });
        else if (isClosedState(parent) && !isDoneState(d)) out.push({ type: 'BOARD_CLOSED', coll, floor: d, parent });
    });
    hqOrders.forEach(o => {
        // Not an error — a job someone still has to do in NetSuite by hand (Eric's Option 3).
        if (o.nsWoCloseRequired && !o.nsWoClosed) out.push({ type: 'NS_CLOSE_TODO', coll: null, floor: null, parent: o });
    });
    // The fin doc is stamped first by closeOrderEverywhere — an hq-less close must still surface.
    finWos.forEach(d => {
        if (d.nsWoCloseRequired && !d.nsWoClosed && !parentOf(d)) out.push({ type: 'NS_CLOSE_TODO', coll: 'fin_workorders', floor: d, parent: null });
    });
    // Demands live only as long as the order they serve. finWoId points at hq_work_orders;
    // a demand whose parent is gone, tombstoned, or closed gates NOTHING and must be named.
    const liveWoById = new Map();
    hqOrders.forEach(o => { if (!isClosedState(o)) { liveWoById.set(String(o.id), o); if (o.woId) liveWoById.set(String(o.woId), o); } });
    convertDemands.forEach(d => {
        if (d.finWoId && !liveWoById.has(String(d.finWoId))) out.push({ type: 'DEMAND_ORPHAN', coll: 'convert_demand', floor: d, parent: null });
    });
    // Plating demands carry only soAppId (they never have a finishing WO) — matched against the
    // live sales orders, NEVER through identityKeysOf (soAppId is deliberately not an identity
    // key: sibling lines share it, and linking through it would let one line's close take its
    // siblings' documents down).
    const liveSoIds = new Set(salesOrders.filter(o => !isClosedState(o)).map(o => String(o.id)));
    platingDemands.forEach(d => {
        if (d.soAppId && !liveSoIds.has(String(d.soAppId))) out.push({ type: 'DEMAND_ORPHAN', coll: 'plating_demand', floor: d, parent: null });
    });
    rodCuts.forEach(d => {
        const open = !['DONE', 'CANCELLED'].includes(String(d.status || '').toUpperCase());
        if (open && d.finWoId && !liveWoById.has(String(d.finWoId))) out.push({ type: 'RODCUT_ORPHAN', coll: 'rod_cut_orders', floor: d, parent: null });
    });
    return out;
}

// ── THE DELETION LEDGER (Stuart 2026-08-25: "when a delete is processed … it needs to be recorded
// … even though the deleted items can be removed from their screen, the master record stays and is
// stamped deleted, date deleted and by whom") ────────────────────────────────────────────────────
//
// Two modes, one rule — NO order-like document leaves this system without a permanent record:
//
//   SOFT — the document STAYS in its collection, stamped {deleted, deletedAt, deletedBy,
//          deletedFrom, deleteReason, statusBeforeDelete} and moved to a terminal status so every
//          status-filtered screen drops it naturally. The tombstone is the master record; the
//          ledger entry is the index. A failed ledger write therefore warns but never blocks.
//   HARD — the document is destroyed (test cleanup, shop schedule rows). The ledger entry carries
//          a full trimmed copy of the record and MUST commit BEFORE the delete — if the ledger
//          write fails, the delete does not happen. An unrecorded delete is worse than a refused one.
//
// The ledger collection is append-only (firestore.rules: create yes, update/delete never).
export const DELETION_LEDGER = 'hq_deletion_log';

// Ledger entries must always fit a Firestore doc — drop the fields that can be huge (render
// configs, SVG data URIs, engineering HTML). The identity summary survives regardless.
const trimmedCopyOf = (record) => {
    try {
        const r = JSON.parse(JSON.stringify(record || {}));
        if (r.cpqData) { delete r.cpqData.configuration; delete r.cpqData.quantities; delete r.cpqData.dimensions; }
        delete r.engineeringNotes; delete r.imageUrl; delete r.finPayload;
        const s = JSON.stringify(r);
        if (s.length > 300000) return { _truncated: true, _bytes: s.length, id: r.id, status: r.status };
        return r;
    } catch (e) { return { _unserializable: true }; }
};

const deletionIdentityOf = (record) => {
    const r = record || {};
    return {
        itemCode: r.itemCode || r.jfpItemCode || r.stockErpId || r.variantErpId || r.partErpId || r.rootItem || r.erpId || null,
        quoteNo: r.quoteNo || null,
        soId: r.soId || r.soNum || r.salesOrderId || null,
        woNum: r.nsWoTran || r.woNum || r.woId || r.woDisplayId || null,
        customer: (r.customer && r.customer.name) || r.customerName || (typeof r.customer === 'string' ? r.customer : null) || r.clientName || null,
        status: r.status || r.currentPhase || null,
        totalPrice: (r.cpqData && r.cpqData.totalPrice) || r.invoiceTotal || r.totalPrice || null,
        totalParts: r.totalParts || r.qty || null,
        brand: r.brand || r.brandId || null,
    };
};

/** Append one entry to the master deletion ledger. Returns the ledger doc id. */
export async function recordDeletion(ctx, { collection: coll, docId, record, kind, mode, by, from, reason }) {
    const { db, doc, setDoc } = ctx;
    const id = `DEL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await setDoc(doc(db, DELETION_LEDGER, id), {
        id, at: Date.now(), mode: mode || 'SOFT',
        by: by || '', from: from || 'APP', reason: reason || '',
        kind: kind || '', collection: coll, docId: String(docId),
        identity: deletionIdentityOf(record),
        ...(mode === 'HARD' ? { record: trimmedCopyOf(record) } : {}),
    });
    return id;
}

/**
 * SOFT delete — the standard for every order-like document (jobs, hq_sales_orders,
 * hq_work_orders, hq_purchase_orders, hq_inventory_tasks). The doc is stamped and statused out of
 * every screen; the ledger indexes it. `terminalStatus` defaults to the collection's own
 * vocabulary: jobs speak SCREAMING_CASE ('CANCELLED'), RTG records speak title case ('Deleted').
 */
export async function softDeleteOrder(ctx, { collection: coll, docId, record, kind, by, from, reason, terminalStatus }) {
    const { db, doc, updateDoc } = ctx;
    const status = terminalStatus || (coll === 'jobs' ? 'CANCELLED' : 'Deleted');
    await updateDoc(doc(db, coll, docId), {
        deleted: true, deletedAt: Date.now(), deletedBy: by || '', deletedFrom: from || 'APP',
        ...(reason ? { deleteReason: reason } : {}),
        statusBeforeDelete: (record && (record.status || record.currentPhase)) || '',
        status,
    });
    try {
        await recordDeletion(ctx, { collection: coll, docId, record, kind, mode: 'SOFT', by, from, reason });
    } catch (e) {
        // The tombstone above IS the record — a ledger index miss is reported, never fatal.
        console.warn('Deletion ledger write failed (tombstone kept):', e);
        return { ledger: false };
    }
    return { ledger: true };
}

/**
 * HARD delete with the ledger as a precondition. The caller passes its own `deleteDoc` (this
 * module never imports Firestore). Throws — and does NOT delete — if the ledger write fails.
 */
export async function hardDeleteWithLedger(ctx, { collection: coll, docId, record, kind, by, from, reason }) {
    const { db, doc, deleteDoc } = ctx;
    await recordDeletion(ctx, { collection: coll, docId, record, kind, mode: 'HARD', by, from, reason });
    await deleteDoc(doc(db, coll, docId));
}

/**
 * Delete the convert/plating demands raised FOR an order — the missing leg of the delete cascade
 * (2026-08-29: deleting a WO left its convert demands standing, so every earlier ordering attempt
 * piled a duplicate wave onto the WMS Convert tab, each gating a work order that no longer
 * existed). Convert demands link back by finWoId and are matched against every identity the order
 * is keyed under — precisely scoped to THIS order. Plating demands carry only soAppId (they never
 * have a finishing WO), so they are matched ONLY when the caller says the record being removed IS
 * the sales order itself (`includePlating`) — deleting one WO of an SO must not wipe the plating
 * demands of its sibling lines. Requires ctx: db, doc, deleteDoc, getDocs, query, collection, where.
 */
export async function deleteLinkedDemands(ctx, order, { includePlating = false } = {}) {
    const { db, doc, deleteDoc, getDocs, query, collection, where } = ctx;
    const keys = identityKeysOf(order);
    if (order && order.soAppId) keys.push(String(order.soAppId));
    const uniq = [...new Set(keys)].filter(Boolean);
    const removed = { convert: 0, plating: 0, convertIds: [], platingIds: [] };
    for (let i = 0; i < uniq.length; i += 10) {
        const slice = uniq.slice(i, i + 10);
        const cv = await getDocs(query(collection(db, 'convert_demand'), where('finWoId', 'in', slice)));
        for (const d of cv.docs) { await deleteDoc(doc(db, 'convert_demand', d.id)); removed.convert++; removed.convertIds.push((d.data() || {}).woNum || d.id); }
        if (includePlating) {
            const pl = await getDocs(query(collection(db, 'plating_demand'), where('soAppId', 'in', slice)));
            for (const d of pl.docs) { await deleteDoc(doc(db, 'plating_demand', d.id)); removed.plating++; removed.platingIds.push((d.data() || {}).woNum || d.id); }
        }
    }
    return removed;
}

/**
 * Someone closed the balance on the NetSuite transaction — record that it is done.
 *
 * This is the other half of Eric's Option 3. The app cannot perform the close, so the only honest
 * way for `nsWoClosed` to become true is a person saying they did it, with their name against it.
 * Stamps every document the order owns so no screen is left believing the work is outstanding.
 */
export async function confirmNsClosed(ctx, { order, kind, by }) {
    const { db, doc, updateDoc } = ctx;
    const links = await linkedDocsOf(ctx, order, kind);
    const patch = {
        nsWoClosed: true, nsWoCloseRequired: false,
        nsWoClosedBy: by || '', nsWoClosedAt: Date.now(), nsWoClosedVia: 'MANUAL_NETSUITE',
    };
    let n = 0;
    for (const [id] of links.fin) { await updateDoc(doc(db, 'fin_workorders', id), patch).catch(() => {}); n++; }
    if (links.hq) { await updateDoc(doc(db, links.hq.coll, links.hq.id), patch).catch(() => {}); n++; }
    return n;
}
