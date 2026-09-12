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
import { strandedGatesOf } from './orderStatus.js';

export const identityKeysOf = (o) => {
    const raw = [
        o && o.id, o && o.woId, o && o.soId, o && o.orderKey, o && o.hqJobId, o && o.quoteId,
        o && o.finSiblingId, o && o.shopSiblingId,
    ].filter(Boolean).map(String);
    // THE SHOP DOC'S OWN CONVENTION IS A KEY (Brief B7, C's finding 2026-09-03): a shop job is
    // written as SHOP-<hq work order id> (pushToShop, the split's shop half, RTG's component gate
    // reads it back the same way), but a STOCK milling spine's orderKey and quoteId are the LIBRARY
    // PART id — so the set never held the hq record's id, linkedDocsOf found no parent, and
    // propagateFloorState / closeOrderEverywhere from the shop closed nothing on the board. The
    // deterministic link was always in the id; now it is in the set.
    const stripped = raw.filter(k => k.startsWith('SHOP-')).map(k => k.slice(5));
    return [...new Set([...raw, ...stripped])];
};

// Is this document finished as far as the business is concerned?
export const isClosedState = (d) => !!d && (
    d.currentPhase === 'Closed' || d.status === 'Closed' || d.closed === true ||
    d.stepStatus === 'Closed' ||
    // Soft-deleted (2026-08-25) is terminal too — without this a tombstoned parent silences the
    // orphan audit instead of tripping it.
    d.deleted === true || d.status === 'Deleted' || d.status === 'CANCELLED'
);
// DONE means the work left the building's hands (Stuart 2026-09-10, after "Close all" closed orders
// still in packing): a finishing job's `currentPhase 'Complete'` is "off the paint line" — the WMS
// still has to pick, pack and put it away — and a pick-only doc is BORN Complete. So Complete is not
// done; PACKED (which is also the stock put-away) is, a shop half's Completed is, a build is, a
// close is.
export const isDoneState = (d) => !!d && (
    isClosedState(d) || d.packStatus === 'Packed' ||
    d.status === 'Completed' || d.status === 'Built'
);
// What the RECORD already knows from the floor (propagateFloorState stamps it at every completion,
// pack and put-away). The audit compares the floor to THIS, not to a status the record never carries.
export const FLOOR_REPORTED_DONE = ['Complete', 'Packed', 'Shelved', 'Plated'];
export const recordKnowsDone = (p) => !!p && (isDoneState(p) || FLOOR_REPORTED_DONE.includes(String(p.floorPhase || '')));

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
    // A CPQ SALES ORDER'S RECORD IS NOT KEYED BY ANY ID THE FLOOR DOC CARRIES (2026-09-12): its
    // doc id is SO-APP-<quoteNo> while the fin doc carries WO-SO60170 / SO60170 / the jobs id — so
    // the loop above never found it, propagateFloorState returned null, and no CPQ order's record
    // ever learned its floorPhase (the audit found the parent through the record's OWN soId; the
    // floor's report could not). Same match the audit makes, from the other side.
    if (!hq && slice.length) {
        for (const field of ['soId', 'hqJobId']) {
            if (hq) break;
            try {
                const qs = await getDocs(query(collection(db, 'hq_sales_orders'), where(field, 'in', slice)));
                const d = qs.docs.find(x => !(x.data() || {}).deleted);
                if (d) hq = { coll: 'hq_sales_orders', id: d.id, data: d.data() };
            } catch (e) { /* a caller without the index or the read: the id loop above already ran */ }
        }
    }
    return { fin, shop, hq };
}

// ── A QUEUED NETSUITE WRITE DIES WITH ITS ORDER (Stuart 2026-09-08, B's call: cancel, not hold) ──
// ns_outbox had no delete awareness: close and delete left queued entries alone, and the worker
// posted them — a real NetSuite transaction for an order the app no longer had, i.e. exactly the
// hand-closed work orders Stuart told us to stop making. A queued write for a closed order can only
// ever be wrong to post, so it is CANCELLED (the same status 11.1's Cancel button writes; the worker
// only ever picks up PENDING). Scoped tightly: an entry is the order's only when its writeBack names
// one of the order's OWN documents (the record, its floor docs, its sibling) or its dedupeKey does —
// a purchase order or a pick adjustment belongs to another record and is never touched. An entry
// already in flight cannot be cancelled: it is FLAGGED, and the audit lists it as a NetSuite
// transaction that posted after its order closed, for a person to close there.
const ORDER_COLLS = new Set(['hq_work_orders', 'hq_sales_orders', 'fin_workorders', 'shop_custom_orders']);
export const queuedWriteTargets = (entry) => {
    const wb = entry && entry.writeBack;
    const list = Array.isArray(wb) ? wb : (wb ? [wb] : []);
    return list.filter(w => w && w.collection && w.docId).map(w => ({ collection: String(w.collection), docId: String(w.docId) }));
};
export const orderDocIdsOf = (order, links) => new Set([
    ...identityKeysOf(order),
    ...(links && links.fin ? [...links.fin.keys()] : []),
    ...(links && links.shop ? [...links.shop.keys()] : []),
    ...(links && links.hq ? [String(links.hq.id)] : []),
].map(String));
export const entryNamesOrder = (entry, docIds) => {
    if (!entry) return false;
    if (queuedWriteTargets(entry).some(t => ORDER_COLLS.has(t.collection) && docIds.has(t.docId))) return true;
    const dk = String(entry.dedupeKey || '');
    const m = dk.match(/^(?:wo|wocmpl):(?:[a-z_]+:)?(.+)$/);
    return !!(m && docIds.has(m[1]));
};
export async function cancelQueuedNsWrites(ctx, { order, links, by, reason }) {
    const { db, doc, updateDoc, getDocs, query, collection, where } = ctx;
    const out = { cancelled: [], inFlight: [] };
    if (!getDocs || !query || !collection || !where) return out;      // a caller without the reads cannot look
    const docIds = orderDocIdsOf(order, links);
    let snap;
    try { snap = await getDocs(query(collection(db, 'ns_outbox'), where('status', 'in', ['PENDING', 'FAILED', 'PROCESSING', 'POSTING']))); }
    catch (e) { console.warn('outbox scan on close failed (order is closed regardless):', e); return out; }
    for (const d of snap.docs) {
        const e = { id: d.id, ...d.data() };
        if (!entryNamesOrder(e, docIds)) continue;
        const st = String(e.status || '');
        if (st === 'PENDING' || st === 'FAILED') {
            await updateDoc(doc(db, 'ns_outbox', d.id), {
                status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: by || '',
                cancelReason: `order ${order.id} closed${reason ? ` — ${reason}` : ''} — queued write cancelled`,
            }).catch(() => {});
            out.cancelled.push(e.label || e.kind || d.id);
        } else {
            await updateDoc(doc(db, 'ns_outbox', d.id), { postedForClosedOrder: true, postedForClosedOrderId: String(order.id), postedForClosedOrderAt: Date.now() }).catch(() => {});
            out.inFlight.push(e.label || e.kind || d.id);
        }
    }
    return out;
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

    // THE STATE BEFORE THE CLOSE RIDES ON THE DOCUMENT (2026-09-10): the bulk close overwrote
    // currentPhase / pickStatus / sentToPickPack and the reopen had to reconstruct them from stamps.
    // Now every close keeps what it replaced, so a reopen restores exactly, never infers.
    const snap = (d, keys) => Object.fromEntries(keys.map(k => [k, d && d[k] !== undefined ? d[k] : null]));
    for (const [id, d] of links.fin) {
        // Clearing the PICK fields is part of closing — a job with only its phase stamped stayed in
        // the WMS pick queue afterwards (Sandra 2026-08-17).
        await updateDoc(doc(db, 'fin_workorders', id), {
            currentPhase: 'Closed', stepStatus: 'Closed', status: 'Closed',
            sentToPickPack: false, pickStatus: 'Closed', ...stamp,
            stateBeforeClose: snap(d, ['currentPhase', 'stepStatus', 'status', 'sentToPickPack', 'pickStatus', 'currentStepIndex']),
        });
        done.fin++;
    }
    for (const [id, d] of links.shop) {
        // The shop queues exit on 'Completed'; `closed: true` records it was closed, not built.
        await updateDoc(doc(db, 'shop_custom_orders', id), { status: 'Completed', closed: true, ...stamp, stateBeforeClose: snap(d, ['status', 'closed']) });
        done.shop++;
    }
    if (links.hq) {
        await updateDoc(doc(db, links.hq.coll, links.hq.id), { status: 'Closed', ...stamp, stateBeforeClose: snap(links.hq.data, ['status']) });
        done.hq++;
    }

    // AN OPEN ROD CUT DIES WITH ITS ORDER (Stuart 2026-09-04: WO11582 was completed and closed
    // while its cut — 10 × HTA835 → HTA635 — stayed OPEN on the WMS Rod Cuts tab; the operator had
    // covered the poles another way and adjusted stock by hand). A cut nothing is waiting for is
    // pieces nobody asked for: it is CANCELLED here, with the reason on it, so the saw never sees
    // it and the orphan audit has nothing to find. Never DONE — no inventory moved.
    done.rodCuts = 0;
    try {
        const { getDocs, query, collection, where } = ctx;
        if (getDocs && query && collection && where) {
            const keys = identityKeysOf(order).concat(links.hq ? [String(links.hq.id)] : []);
            const uniq = [...new Set(keys)].filter(Boolean);
            for (let i = 0; i < uniq.length; i += 10) {
                const snap = await getDocs(query(collection(db, 'rod_cut_orders'), where('finWoId', 'in', uniq.slice(i, i + 10))));
                for (const d of snap.docs) {
                    const st = String((d.data() || {}).status || 'OPEN').toUpperCase();
                    if (['DONE', 'CANCELLED'].includes(st)) continue;
                    await updateDoc(doc(db, 'rod_cut_orders', d.id), {
                        status: 'CANCELLED', cancelledAt: Date.now(), cancelledBy: by || '',
                        cancelReason: `order ${order.id} closed${from ? ` from ${from}` : ''}${reason ? ` — ${reason}` : ''} — the cut was still open; no inventory moved`,
                    });
                    done.rodCuts++;
                }
            }
        }
    } catch (e) { console.warn('rod cut cancel on close failed (order is closed regardless):', e); }

    // Queued NetSuite writes for this order are cancelled; ones already in flight are flagged.
    try {
        const nsq = await cancelQueuedNsWrites(ctx, { order, links, by, reason });
        done.nsWritesCancelled = nsq.cancelled; done.nsWritesInFlight = nsq.inFlight;
    } catch (e) { console.warn('queued-write cancel on close failed (order is closed regardless):', e); }

    // NetSuite: one close per order, and only when a work order is actually open there.
    const nsSrc = [...links.fin.entries()].find(([, d]) => d.nsWoId && !d.nsWoClosed && !d.nsWoCompletionPosted);
    // A WORK ORDER WHOSE BUILD POSTED IS DONE IN NETSUITE (2026-09-12): the completion write-back
    // lands on the FIN doc (nsWoCompletionPosted), not on the record — so the record leg below used
    // to raise a "close the balance" task for orders NetSuite had already built (146 of them on the
    // board). The fin docs' word counts for the record's work order.
    const builtIds = new Set([...links.fin.values()].filter(d => d && d.nsWoCompletionPosted && d.nsWoId).map(d => String(d.nsWoId)));
    const hqWoOpen = links.hq && links.hq.data.nsWoId && !links.hq.data.nsWoClosed
        && !links.hq.data.nsWoCompletionPosted && !builtIds.has(String(links.hq.data.nsWoId));
    const ns = nsSrc
        ? { coll: 'fin_workorders', docId: nsSrc[0], nsWoId: nsSrc[1].nsWoId, tran: nsSrc[1].nsWoTran }
        : (hqWoOpen
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
export async function propagateFloorState(ctx, { finWo, phase, by, extra }) {
    const { db, doc, updateDoc } = ctx;
    if (!finWo) return null;
    const links = await linkedDocsOf(ctx, finWo, finWo.orderType === 'sales' ? 'sales' : 'stock');
    if (!links.hq) return null;                       // orphan — the audit below is what surfaces it
    // `extra` (2026-09-04): facts the floor wants on the record beside the phase — a scrap count,
    // a red-line alert, a reset. With no `phase` the record's floorPhase is left alone.
    const patch = phase === 'Complete'
        ? { floorPhase: 'Complete', floorCompletedAt: Date.now(), floorCompletedBy: by || '' }
        : (phase ? { floorPhase: phase, floorUpdatedAt: Date.now() } : { floorUpdatedAt: Date.now() });
    await updateDoc(doc(db, links.hq.coll, links.hq.id), { ...patch, ...(extra || {}) }).catch(() => {});
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
export function auditOrphans({ hqOrders = [], finWos = [], shopJobs = [], convertDemands = [], platingDemands = [], rodCuts = [], salesOrders = [], outbox = [], openPoNumbers = null }) {
    const byKey = new Map();
    hqOrders.forEach(o => identityKeysOf(o).forEach(k => byKey.set(k, o)));
    const parentOf = (d) => identityKeysOf(d).map(k => byKey.get(k)).find(Boolean) || null;
    const out = [];
    const floorJobs = [
        ...finWos.map(d => ({ d, coll: 'fin_workorders' })),
        ...shopJobs.map(d => ({ d, coll: 'shop_custom_orders' })),
    ];
    // FLOOR_DONE IS A WHOLE-ORDER FINDING (Stuart 2026-09-10: "Close all" on it closed orders still
    // in packing and in finishing). It is raised ONCE per record, only when EVERY linked floor
    // document is done (packed / shop Completed — a Completed shop half beside a Painting finishing
    // doc is normal work) and the record neither is closed nor already carries the floor's report
    // (`floorPhase`, which propagateFloorState stamps). The record was right this morning; the test
    // was wrong.
    const floorByParent = new Map();
    floorJobs.forEach(({ d, coll }) => {
        const parent = parentOf(d);
        if (!parent) {
            if (!isDoneState(d)) out.push({ type: 'ORPHAN_FLOOR', coll, floor: d, parent: null });
            return;
        }
        if (isClosedState(d) && !isClosedState(parent)) out.push({ type: 'FLOOR_CLOSED', coll, floor: d, parent });
        else if (isClosedState(parent) && !isDoneState(d)) out.push({ type: 'BOARD_CLOSED', coll, floor: d, parent });
        const pid = String(parent.id);
        if (!floorByParent.has(pid)) floorByParent.set(pid, { parent, docs: [] });
        floorByParent.get(pid).docs.push({ d, coll });
    });
    floorByParent.forEach(({ parent, docs }) => {
        if (isClosedState(parent) || recordKnowsDone(parent)) return;
        if (!docs.every(({ d }) => isDoneState(d))) return;
        const first = docs[0];
        out.push({ type: 'FLOOR_DONE', coll: first.coll, floor: first.d, parent, floors: docs.map(x => x.d) });
    });
    // A work order whose BUILD POSTED needs no balance close — NetSuite already has the assembly
    // (the completion write-back stamps the fin doc; the record's to-do was raised blind).
    const builtWoIds = new Set(finWos.filter(d => d && d.nsWoCompletionPosted && d.nsWoId).map(d => String(d.nsWoId)));
    const woBuilt = (o) => !!o && (o.nsWoCompletionPosted === true || (o.nsWoId && builtWoIds.has(String(o.nsWoId))));
    hqOrders.forEach(o => {
        // Not an error — a job someone still has to do in NetSuite by hand (Eric's Option 3).
        if (o.nsWoCloseRequired && !o.nsWoClosed && !woBuilt(o)) out.push({ type: 'NS_CLOSE_TODO', coll: null, floor: null, parent: o });
    });
    // The fin doc is stamped first by closeOrderEverywhere — an hq-less close must still surface.
    finWos.forEach(d => {
        if (d.nsWoCloseRequired && !d.nsWoClosed && !woBuilt(d) && !parentOf(d)) out.push({ type: 'NS_CLOSE_TODO', coll: 'fin_workorders', floor: d, parent: null });
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

    // ── THE OTHER DIRECTION: A LIVE ORDER WAITING ON SOMETHING THAT NO LONGER EXISTS ───────────
    // Everything above finds a CHILD that outlived its parent. This finds a PARENT still waiting on
    // a child that was cancelled or deleted — the strand with no symptom until the floor notices
    // work that never came (Stuart 2026-09-08, from a rod cut that outlived nothing and an order
    // that outlived its cut).
    //
    // Each gate declares its own clearer in Shared/orderStatus; a gate whose pool we were not
    // handed is skipped, never guessed at. `openPoNumbers` is optional for that reason — pass it
    // and the material gate is audited too, omit it and it simply is not.
    const liveWoIds = new Set([...liveWoById.keys()]);
    hqOrders.forEach(o => {
        if (isClosedState(o) || o.deleted) return;
        const pools = {
            keys: new Set(identityKeysOf(o)),
            rodCuts, convertDemands, liveWoIds,
            ...(openPoNumbers ? { openPoNumbers } : {}),
        };
        strandedGatesOf(o, pools).forEach(g => out.push({
            type: 'STRANDED_GATE', coll: null, floor: null, parent: o,
            gate: g.key, gateLabel: g.label, expected: g.expected,
            detail: `${o.woDisplayId || o.id} is held at "${g.label}" but ${g.expected} no longer exists — nothing can lift it.`,
        }));
    });
    // A NetSuite write that was in flight when its order closed posted anyway (cancelQueuedNsWrites
    // could only flag it). It is a real transaction for an order the app has closed — a person
    // closes it in NetSuite and ticks it here.
    outbox.forEach(e => {
        if (e && e.postedForClosedOrder && !e.postedForClosedOrderAckAt) out.push({
            type: 'NS_POSTED_AFTER_CLOSE', coll: 'ns_outbox', floor: e, parent: null,
            detail: `${e.label || e.kind || e.id} posted to NetSuite after order ${e.postedForClosedOrderId || '?'} was closed${e.nsTran ? ` — ${e.nsTran}` : ''}.`,
        });
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

// ── REOPENING A BULK CLOSE (Stuart 2026-09-10, S2 Issue 1) ──────────────────────────────────
// "Close all" on the Board vs Floor panel closed live orders this morning: the FLOOR_DONE finding
// read ONE floor document's 'Complete' (a finishing job leaving the paint line, a pick-only doc
// born Complete, a shop half done beside a Painting sibling) as the ORDER being done, and the bulk
// button trusted it. The closer overwrote currentPhase / pickStatus / sentToPickPack, so a reopen
// cannot read those back — but every floor stamps FACTS as it works (pickedAt, stagedAt, packedAt,
// putawayBin, shippedAt, completedAt, the task statuses, startedAt) and the closer touched none of
// them. Each document is restored FROM ITS OWN STAMPS, never from a guess; a document whose stamps
// say it was genuinely finished (shipped, put away to a bin) stays closed and says why. Pure, so
// every rule is in scripts/orderLifecycle.test.mjs; the Firestore writes are applyBulkReopen.
export const BULK_CLOSE_FROM = 'RTG_RECONCILE_ALL';
export const REOPEN_FROM = 'RTG_BULK_REOPEN';
// A field the restore REMOVES (mapped to Firestore's deleteField by the applier) — an absent
// field is "unknown", which is more honest than a value the closer invented.
export const DELETE = Object.freeze({ __delete: true });
const has = (v) => !!v;
export const toMs = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : (v ? (Date.parse(v) || 0) : 0));
export const closedByBulkIn = (d, { since = 0, until = Infinity, anyClose = false } = {}) =>
    !!d && (anyClose ? !!(d.closedFrom || d.closedAt) : d.closedFrom === BULK_CLOSE_FROM) && toMs(d.closedAt) >= since && toMs(d.closedAt) <= until;
// The WMS stamps pickedAt at pick confirm and stagedAt at the staging match; the latest wins.
export const pickStatusFromStamps = (d) =>
    has(d && d.stagedAt) ? 'Staged_Ready_For_Finishing' : has(d && d.pickedAt) ? 'Picked_Awaiting_Staging' : 'Pending';
const tasksTouched = (d) => Object.values((d && d.tasks) || {}).some(t => t && t.status && t.status !== 'Pending');
const shopStarted = (s) => !!s && (has(s.startedAt) || has(s.completedAt));
const CLOSE_STAMPS = ['closedAt', 'closedBy', 'closedFrom', 'closeReason', 'nsWoCloseRequired', 'nsWoCloseRequestedAt', 'nsWoCloseRequestedBy', 'nsWoClosePending'];
const clearClose = (d) => ({
    ...Object.fromEntries(CLOSE_STAMPS.map(k => [k, DELETE])),
    // The close is kept as history on the document, never lost.
    reopenedFromClose: { closedAt: d.closedAt || null, closedBy: d.closedBy || '', closedFrom: d.closedFrom || '', closeReason: d.closeReason || '' },
});

/**
 * One document's reopen decision: KEEP (it was genuinely done — left as the close left it),
 * RESTORE (with the exact patch), or SKIP (not this close's, or already reopened).
 * `sibling` is the other floor half (the shop doc for a fin doc, the fin doc for a shop doc) —
 * it decides whether the small-parts pick had been released and whether the custom half is at
 * the plater. `live` says whether the restored document is still WORK (drives the record).
 */
// `force`: 'REOPEN' overrides a KEEP (the operator says it is still work — e.g. Stuart 2026-09-10:
// "keep open only SO60151, SO60152" of the packed orders), 'KEEP' overrides a RESTORE. Recorded.
// `anyClose`: a PER-ORDER reopen (2026-09-12, S3's ask) accepts a close from any screen, not
// only the bulk button — the closer keeps stateBeforeClose on every close since d62b682.
export function reopenPlanFor({ coll, d, sibling = null, force = null, anyClose = false }) {
    const row = { coll, id: d && d.id, closedAt: (d && d.closedAt) || null, closeReason: (d && d.closeReason) || '', live: false };
    if (!d) return { ...row, action: 'SKIP', why: 'no document' };
    if (d.reopenedFrom === REOPEN_FROM) return { ...row, action: 'SKIP', why: `already reopened by this tool (${d.reopenedBy || '?'})` };
    if (!anyClose && d.closedFrom !== BULK_CLOSE_FROM) return { ...row, action: 'SKIP', why: 'not closed by a bulk close' };
    if (anyClose && !isClosedState(d) && !d.closedAt) return { ...row, action: 'SKIP', why: 'not closed' };
    // A hand reopen AFTER the close (the shop's Reopen button stamps reopenedAt but never clears the
    // `closed` flag the bulk close set, so the job stays hidden from its queue).
    const handReopened = has(d.reopenedAt) && toMs(d.reopenedAt) > toMs(d.closedAt);
    // Only a FLOOR_DONE close is suspect. FLOOR_CLOSED means the floor had already closed it;
    // BOARD_CLOSED means the board had; ORPHAN_FLOOR had no record to reopen into.
    if (force === 'KEEP') return { ...row, action: 'KEEP', override: 'KEEP', why: 'OVERRIDE — kept closed by the operator' };
    if (force !== 'REOPEN' && !anyClose && d.closeReason && d.closeReason !== 'FLOOR_DONE') return { ...row, action: 'KEEP', why: `closed as ${d.closeReason} — it was already closed on the other side` };

    // A close made after 2026-09-10 kept the state it replaced — restore it exactly.
    if (d.stateBeforeClose && force !== 'KEEP' && (coll === 'fin_workorders' || coll === 'shop_custom_orders' || coll === 'hq_work_orders' || coll === 'hq_sales_orders')) {
        const sb = d.stateBeforeClose;
        const patch = Object.fromEntries(Object.entries(sb).map(([k, v]) => [k, v === null ? DELETE : v]));
        const live = coll === 'shop_custom_orders' ? sb.status !== 'Completed' : true;
        return { ...row, action: 'RESTORE', live, why: `restored from the snapshot the closer kept (${Object.entries(sb).filter(([, v]) => v !== null).map(([k, v]) => `${k} ${v}`).join(', ') || 'empty'})`, patch: { ...clearClose(d), ...patch, stateBeforeClose: DELETE, ...(coll === 'shop_custom_orders' ? { closed: sb.closed === true ? true : DELETE } : {}) } };
    }
    if (coll === 'fin_workorders') {
        const when = (t) => t ? new Date(toMs(t)).toLocaleDateString() : '';
        // On a SALES order the shipment IS the NetSuite fulfilment: the WMS queues it the moment the
        // pack completes (nsFulfillQueued) and nsIfTran lands when it posts. There is no shippedAt on
        // a finishing doc — reading "packed, no shippedAt" as unshipped would reopen every order
        // ever packed (the 14 July/August Brimar orders in the first dry run).
        if (force !== 'REOPEN') {
            if (has(d.nsIfTran)) return { ...row, action: 'KEEP', why: `shipped — fulfilment ${d.nsIfTran} posted${d.packedAt ? `, packed ${when(d.packedAt)}` : ''}` };
            if (d.nsFulfillQueued === true) return { ...row, action: 'KEEP', why: `shipped — packed ${when(d.packedAt) || '?'}, fulfilment queued (see 11.1 if it has not posted)` };
            if (has(d.shippedAt)) return { ...row, action: 'KEEP', why: 'shipped — it was done' };
            if (has(d.putawayBin)) return { ...row, action: 'KEEP', why: `put away to ${d.putawayBin}${d.packedAt ? ` ${when(d.packedAt)}` : ''} — it was done` };
        }
        const pickOnly = d.pickOnly === true;
        const packed = d.packStatus === 'Packed';
        const complete = pickOnly || packed || has(d.completedAt);
        const painting = !complete && (tasksTouched(d) || Number(d.currentStepIndex) > 0 || has(d.machineAssigned));
        const phase = complete
            ? { currentPhase: 'Complete', stepStatus: 'Complete' }
            : painting ? { currentPhase: 'Painting', stepStatus: 'Staged' }
                : { currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0 };
        // The pick is released at the split for a small-only order, and by the shop STARTING the
        // custom half for a paired one (releaseSiblingToPickPack) — read off the sibling's stamps.
        const released = pickOnly || d.hasCustomSibling !== true || shopStarted(sibling);
        const pickStatus = released ? pickStatusFromStamps(d) : 'Pending';
        const why = [
            pickOnly ? 'pick-only' : packed ? `packed ${when(d.packedAt)}, no fulfilment` : has(d.completedAt) ? `finished on the floor ${when(d.completedAt)}, not packed` : painting ? 'in Painting' : 'not started',
            `→ ${phase.currentPhase}`,
            released ? `WMS ${pickStatus.replace(/_/g, ' ').toLowerCase()}${has(d.pickedAt) ? ` (picked ${when(d.pickedAt)})` : ''}` : 'pick not released (custom half not started)',
        ].join(' · ');
        return {
            ...row, action: 'RESTORE', live: true, why: force === 'REOPEN' ? `OVERRIDE — reopened by the operator · ${why}` : why, ...(force === 'REOPEN' ? { override: 'REOPEN' } : {}),
            patch: {
                ...clearClose(d), status: DELETE, ...phase,
                sentToPickPack: released, pickStatus,
                // The WMS is told the pick state was RECONSTRUCTED (a chip S3 shows) unless the
                // pack had already stamped it.
                reopenConfirmPick: released && !packed,
            },
        };
    }
    if (coll === 'shop_custom_orders') {
        // 'Sent to Plating' lives on the fin sibling's mirror (customFabStatus), which the closer
        // never touched; the demand flag is the fallback when the sibling is not in the room.
        const atPlater = (sibling && sibling.customFabStatus === 'Sent to Plating')
            || (d.isOutsourced === true && has(d.completedAt) && d.platingDemandCreated === true);
        if (handReopened) {
            // Livio's Reopen set the status he wanted; the bulk close's `closed: true` still hides it.
            const status = String(d.status || 'In Process');
            return { ...row, action: 'RESTORE', live: status !== 'Completed', why: `hand-reopened by ${d.reopenedBy || '?'} → ${status} — the closed flag is removed so it shows again`, patch: { ...clearClose(d), closed: DELETE } };
        }
        const status = atPlater ? 'Sent to Plating' : has(d.completedAt) ? 'Completed' : has(d.startedAt) ? 'In Process' : 'Pending';
        return {
            ...row, action: 'RESTORE', live: status !== 'Completed', why: `→ ${status}`,
            patch: { ...clearClose(d), closed: DELETE, status },
        };
    }
    if (coll === 'hq_work_orders') {
        const dispatched = has(d.dispatchedAt) || d.pushedToFinishing === true || d.pushedToShop === true;
        const status = dispatched ? 'Dispatched' : 'Approved';
        return { ...row, action: 'RESTORE', live: true, why: `→ ${status}`, patch: { ...clearClose(d), status } };
    }
    if (coll === 'hq_sales_orders') {
        // A stocked (Order Entry / Quick Ship) order's status IS its pick status — the WMS writes
        // both together and the closer touched only `status`.
        const qs = ['Pending', 'Picked', 'Shipped'];
        const stocked = d.orderClass === 'QUICKSHIP' || (d.autoSplit !== true && qs.includes(String(d.pickStatus || '')));
        const status = stocked
            ? (qs.includes(String(d.pickStatus || '')) ? String(d.pickStatus) : 'Pending')
            : ((has(d.dispatchedAt) || d.autoSplit === true) ? 'Dispatched' : 'Approved');
        return { ...row, action: 'RESTORE', live: true, why: `→ ${status}`, patch: { ...clearClose(d), status } };
    }
    return { ...row, action: 'SKIP', why: `unknown collection ${coll}` };
}

/**
 * The whole plan for one bulk close: every document it stamped inside the window, decided by
 * reopenPlanFor, then the ORDER-level rule — a record is reopened only when at least one of its
 * floor documents is still work; when every floor document was done, the record and its
 * finished shop half stay closed (the close was right for that order). Rod cuts the close
 * cancelled come back OPEN only for reopened orders (a cut for a done order is pieces nobody
 * wants); queued NetSuite writes it cancelled come back PENDING for EVERY order in the close —
 * a build for a packed order or a fulfilment for a shipped one was right to post regardless.
 */
// `overrides`: Map<orderKey, 'REOPEN'|'KEEP'> — any identity key of the order (SO60151, WO-SO60151,
// SHOP-SO60151 …) selects every FLOOR document of that order; the record then follows its floor.
export function planBulkReopen({ finWos = [], shopJobs = [], hqOrders = [], rodCuts = [], outbox = [], siblings = new Map(), since = 0, until = Infinity, overrides = new Map(), anyClose = false }) {
    const inWin = (d) => closedByBulkIn(d, { since, until, anyClose });
    const fin = finWos.filter(inWin), shop = shopJobs.filter(inWin), hq = hqOrders.filter(inWin);
    const byId = new Map([...finWos, ...shopJobs].map(d => [String(d.id), d]));
    const sib = (id) => (id && (byId.get(String(id)) || siblings.get(String(id)))) || null;
    const forceOf = (d) => { for (const k of identityKeysOf(d)) { if (overrides.has(k)) return overrides.get(k); } return null; };
    const rows = [
        ...fin.map(d => ({ ...reopenPlanFor({ coll: 'fin_workorders', d, sibling: sib(d.shopSiblingId), force: forceOf(d), anyClose }), d })),
        ...shop.map(d => ({ ...reopenPlanFor({ coll: 'shop_custom_orders', d, sibling: sib(d.finSiblingId), force: forceOf(d), anyClose }), d })),
    ];
    // Link floor rows to their record the way the audit does — by the identity set.
    const byKey = new Map();
    hq.forEach(o => identityKeysOf(o).forEach(k => byKey.set(k, String(o.id))));
    const floorOf = new Map();
    rows.forEach(r => {
        const pid = identityKeysOf(r.d).map(k => byKey.get(k)).find(Boolean);
        if (pid) { r.recordId = pid; (floorOf.get(pid) || floorOf.set(pid, []).get(pid)).push(r); }
    });
    const keptRecords = new Set();
    const recordRows = hq.map(d => {
        // The loader stamps __coll; the fallback is the board's own sales/stock test.
        const coll = d.__coll || ((d.soId && !d.woId) ? 'hq_sales_orders' : 'hq_work_orders');
        const plan = reopenPlanFor({ coll, d, anyClose, force: forceOf(d) });
        const floor = floorOf.get(String(d.id)) || [];
        if (plan.action !== 'RESTORE') return { ...plan, d };
        if (!floor.length) { keptRecords.add(String(d.id)); return { ...plan, action: 'KEEP', live: false, why: 'no floor document of this close belongs to it — review by hand', d }; }
        if (!floor.some(r => r.live)) { keptRecords.add(String(d.id)); return { ...plan, action: 'KEEP', live: false, why: `every floor document was done (${floor.map(r => r.why).join('; ')})`, d }; }
        return { ...plan, d };
    });
    // A finished shop half of a kept order stays as it is.
    rows.forEach(r => {
        if (r.action === 'RESTORE' && !r.live && r.recordId && keptRecords.has(r.recordId)) { r.action = 'KEEP'; r.why = `${r.why} — its order stays closed`; delete r.patch; }
    });
    const restoredOrderIds = new Set();
    recordRows.filter(r => r.action === 'RESTORE').forEach(r => identityKeysOf(r.d).forEach(k => restoredOrderIds.add(k)));
    rows.filter(r => r.action === 'RESTORE').forEach(r => identityKeysOf(r.d).forEach(k => restoredOrderIds.add(k)));
    const allOrderIds = new Set([...hq, ...fin, ...shop].flatMap(d => identityKeysOf(d)));
    const cutRows = rodCuts
        .filter(rc => String(rc.status || '').toUpperCase() === 'CANCELLED' && (anyClose ? /\bclosed\b/.test(String(rc.cancelReason || '')) : String(rc.cancelReason || '').includes(`from ${BULK_CLOSE_FROM}`)) && toMs(rc.cancelledAt) >= since && toMs(rc.cancelledAt) <= until)
        .map(rc => {
            const mine = restoredOrderIds.has(String(rc.finWoId));
            const base = { coll: 'rod_cut_orders', id: rc.id, closedAt: rc.cancelledAt || null, closeReason: 'cancelled with its order', d: rc, live: mine };
            if (has(rc.reopenedAt)) return { ...base, action: 'SKIP', why: 'already reopened' };
            if (!allOrderIds.has(String(rc.finWoId))) return { ...base, action: 'SKIP', why: 'its order is not in this close' };
            if (!mine) return { ...base, action: 'KEEP', why: 'its order stays closed — the cut is not wanted' };
            return { ...base, action: 'RESTORE', why: '→ OPEN', patch: { status: 'OPEN', cancelledAt: DELETE, cancelledBy: DELETE, cancelReason: DELETE, reopenedFromCancel: { cancelledAt: rc.cancelledAt || null, cancelledBy: rc.cancelledBy || '', cancelReason: rc.cancelReason || '' } } };
        });
    const outboxRows = outbox
        .filter(e => String(e.status || '').toUpperCase() === 'CANCELLED' && toMs(e.cancelledAt) >= since && toMs(e.cancelledAt) <= until)
        .map(e => {
            const m = String(e.cancelReason || '').match(/^order (\S+) closed\b/);
            const base = { coll: 'ns_outbox', id: e.id, closedAt: e.cancelledAt || null, closeReason: 'cancelled with its order', d: e, live: true };
            if (!m || !allOrderIds.has(m[1])) return null;
            if (has(e.reopenedAt)) return { ...base, action: 'SKIP', why: 'already reopened' };
            // Back to where it WAS: an entry with a recorded error had failed and sat in 11.1 with its
            // Retry button — it goes back to FAILED, never auto-posted by this tool; a clean entry
            // goes back to PENDING and the worker posts it.
            const hadFailed = has(e.lastError) || Number(e.attempts) > 0;
            const status = hadFailed ? 'FAILED' : 'PENDING';
            const err = hadFailed ? ` — last error: ${String(e.lastError || '').slice(0, 140)}` : '';
            return { ...base, action: 'RESTORE', why: `→ ${status}${hadFailed ? ' (had failed; retry by hand in 11.1)' : ' (the worker posts it)'}${err}`, patch: { status, cancelledAt: DELETE, cancelledBy: DELETE, cancelReason: DELETE, reopenedFromCancel: { cancelledAt: e.cancelledAt || null, cancelledBy: e.cancelledBy || '', cancelReason: e.cancelReason || '' } } };
        })
        .filter(Boolean);
    const all = [...recordRows, ...rows, ...cutRows, ...outboxRows];
    return {
        rows: all,
        counts: all.reduce((m, r) => { m[r.action] = (m[r.action] || 0) + 1; return m; }, {}),
        outsideWindow: [...finWos, ...shopJobs, ...hqOrders].filter(d => d.closedFrom === BULK_CLOSE_FROM && !inWin(d)).length,
    };
}

/**
 * ONE order's reopen (2026-09-12, S3's ask after the shop's Undo began refusing RTG-closed docs):
 * the same rules as the bulk tool, for one record from ANY close, restored from the snapshot the
 * closer keeps (stateBeforeClose) where it exists and from stamps where it does not. The operator's
 * word is the override — every document of the order is forced REOPEN (a KEEP rule is for a
 * sweep, not for a person pointing at one order). The window is the close itself, so a rod cut or
 * queued write cancelled by that close comes back with it and an older cancellation does not.
 */
export function planOrderReopen({ record, coll, finDocs = [], shopDocs = [], rodCuts = [], outbox = [], siblings = new Map() }) {
    if (!record) return { rows: [], counts: {}, outsideWindow: 0 };
    const closedAt = toMs(record.closedAt) || Math.max(0, ...[...finDocs, ...shopDocs].map(d => toMs(d && d.closedAt))) || Date.now();
    const overrides = new Map(identityKeysOf(record).map(k => [k, 'REOPEN']));
    return planBulkReopen({
        finWos: finDocs, shopJobs: shopDocs, hqOrders: [{ ...record, __coll: coll }], rodCuts, outbox, siblings,
        since: closedAt - 60 * 1000, until: closedAt + 30 * 60 * 1000, overrides, anyClose: true,
    });
}

/** Write the plan: every RESTORE row patched and ledgered; a failure is named and skipped. */
export async function applyBulkReopen(ctx, { plan, by, onProgress }) {
    const { db, doc, updateDoc, deleteField } = ctx;
    const runId = `REOPEN-${Date.now()}`;
    const done = { restored: 0, failed: [], runId };
    const rows = (plan && plan.rows ? plan.rows : []).filter(r => r.action === 'RESTORE' && r.patch);
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const patch = Object.fromEntries(Object.entries(r.patch).map(([k, v]) => [k, v === DELETE ? deleteField() : v]));
        try {
            await updateDoc(doc(db, r.coll, r.id), { ...patch, reopenedAt: Date.now(), reopenedBy: by || '', reopenedFrom: REOPEN_FROM, reopenRunId: runId, ...(r.override ? { reopenOverride: r.override, reopenOverrideBy: by || '' } : {}) });
            done.restored++;
            try {
                await recordDeletion(ctx, { collection: r.coll, docId: r.id, record: r.d, kind: 'BULK_CLOSE_REOPEN', mode: 'REOPEN', by, from: REOPEN_FROM, reason: `${runId} · reopened after the ${BULK_CLOSE_FROM} close of ${r.closedAt ? new Date(toMs(r.closedAt)).toLocaleString() : '?'} — ${r.why}` });
            } catch (e) { console.warn('reopen ledger write failed (document is reopened regardless):', e); }
        } catch (e) { done.failed.push(`${r.coll}/${r.id}: ${e.message || e}`); }
        if (onProgress) onProgress(i + 1, rows.length);
    }
    return done;
}
