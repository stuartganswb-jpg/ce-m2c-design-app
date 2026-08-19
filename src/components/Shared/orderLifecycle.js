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
    d.stepStatus === 'Closed'
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
export async function closeOrderEverywhere(ctx, { order, kind, by, from, reason, enqueueNsWrite }) {
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
    if (ns && enqueueNsWrite) {
        await enqueueNsWrite({
            kind: 'workorderclose',
            label: `Close NS WO ${ns.tran || ns.nsWoId} — ${order.id}`,
            sourceApp: from || 'APP', createdBy: by || '',
            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/workorder/${ns.nsWoId}/!transform/workorderclose`,
            method: 'POST', payload: { memo: `Closed from ${from || 'the app'} (${order.id})` },
            // nsWoClosed is set by the WRITE-BACK — i.e. only once NetSuite accepts it.
            writeBack: { collection: ns.coll, docId: ns.docId, patch: { nsWoClosed: true, nsWoClosePending: false } },
        });
        await updateDoc(doc(db, ns.coll, ns.docId), { nsWoClosePending: true, nsWoCloseQueuedAt: Date.now() }).catch(() => {});
        if (links.hq) await updateDoc(doc(db, links.hq.coll, links.hq.id), { nsWoClosePending: true }).catch(() => {});
        done.ns = ns.tran || ns.nsWoId;
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
 *   BOARD_CLOSED   — closed on the board, still live on the floor
 *   NS_UNCONFIRMED — the app closed it, NetSuite never confirmed
 * Pure, so the rules can be reasoned about without Firestore in the room.
 */
export function auditOrphans({ hqOrders = [], finWos = [], shopJobs = [] }) {
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
        else if (isClosedState(parent) && !isDoneState(d)) out.push({ type: 'BOARD_CLOSED', coll, floor: d, parent });
    });
    hqOrders.forEach(o => {
        if (o.nsWoClosePending && !o.nsWoClosed) out.push({ type: 'NS_UNCONFIRMED', coll: null, floor: null, parent: o });
    });
    return out;
}
