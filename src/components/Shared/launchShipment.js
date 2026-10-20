// ── A LAUNCH SHIPMENT'S WRITES — one pair of hands for two screens (S7, 2026-10-20) ─────────────────────────────────
//
// The rules are pure in Shared/launchBoard (shipmentPlanOf · launchShipmentOf · shipmentFulfilItemsOf). What is here is
// the Firestore and NetSuite side of them, lifted from the WMS pack bench so the Uniquity Pick & Pack page does exactly
// the same thing with the same code: the child record written and the parent relieved (writeShipment), the terms gate
// (gateShipmentWith), and the shipment's own NetSuite fulfilment — ITS lines only, from the order's bin
// (queueShipmentFulfilment). Never Shared/fulfilmentQueue.queueSoFulfilment for a shipment: that takes EVERY open line.
import { doc, getDoc, setDoc, updateDoc, FieldPath, increment } from 'firebase/firestore';
import { db } from '../../firebase';
import { enqueueNsWrite } from './nsOutbox';
import { soLinesSql, fulfilmentItemsOf, refusalText } from './fulfilmentLines';
import { fulfilmentTargetOf } from './fulfilmentBins';
import { fetchShipClearance, shipHoldStampOf } from './shipClearance';
import { launchShipmentOf, shipmentFulfilItemsOf, shipmentWordsOf, nsSoIdOfRecord } from './launchBoard';

const SUITEQL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql';
const NS_MEMO_MAX = 40;
export const nsMemoOf = (s) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return t.length <= NS_MEMO_MAX ? t : `${t.slice(0, NS_MEMO_MAX - 1).trimEnd()}…`; };
export const packRefOfRecord = (d) => `SO ${(d && (d.soId || d.id)) || ''}${d && d.shipmentNo ? ` · shipment ${d.shipmentNo}` : ''}`;

/**
 * THE TERMS GATE for a fulfilment about to be queued — the whole-order rule, or the part-payment rule when `shippingNow`
 * names the worth of the part (Shared/shipClearance). Not clear → the hold is stamped on every `ref` given and logged.
 * → { clear, facts, clearance, ok }
 */
export async function gateShipmentWith({ nsProxyFetch, unpostedOf = null, nsSoId, refs = [], ref = '', shippingNow = 0, by = '', log = () => {} }) {
    const r = await fetchShipClearance({ nsProxyFetch, nsSoId, unpostedOf, shippingNow });
    if (r.clearance.clear) return { clear: true, ...r };
    const stamp = shipHoldStampOf(r, { at: Date.now(), by });
    for (const x of refs) { try { await updateDoc(x, stamp); } catch (e) { console.warn('ship hold stamp failed (the order is still held here):', e); } }
    log(`⏸ ${ref} packed, NOT shipped — ${r.clearance.why}`, 'packing');
    return { clear: false, ...r };
}
export const shipHoldNoteOf = (gate) => `\n\n⏸ NOT SHIPPED YET — ${gate.clearance.why}.\n\nThe NetSuite fulfilment was not sent. It waits under "Waiting for payment": press Check again once it is paid, or a manager releases it with a reason.`;

/**
 * WRITE THE SHIPMENT: the child record (born packed), then the parent gives up the pieces — its bin count, the shipped
 * count, NetSuite's record of the bin when it was counted — records `shipments.<n>`, clears its ticks and photos and goes
 * back to Pending for the rest. → { ok, why, built } (built = Shared/launchBoard.launchShipmentOf's answer).
 */
export async function writeShipment({ parent, plan, by = '', now = Date.now(), boxes = null, photos = [] }) {
    const built = launchShipmentOf({ parent, plan, by, now, boxes, photos });
    if (!built.ok) return { ok: false, why: built.why, built };
    const exists = await getDoc(doc(db, 'hq_sales_orders', built.id));
    if (exists.exists()) return { ok: false, why: `${built.id} already exists — shipment ${built.n} was already made from another screen. Nothing was written.`, built };
    await setDoc(doc(db, 'hq_sales_orders', built.id), built.doc);
    const args = [];
    Object.entries(built.give).forEach(([c, q]) => {
        args.push(new FieldPath('committedQty', c), increment(-q), new FieldPath('shippedQty', c), increment(q));
        if (parent.nsBinQty && parent.nsBinQty[c] != null) args.push(new FieldPath('nsBinQty', c), increment(-q));
    });
    args.push(new FieldPath('shipments', String(built.n)), built.record, 'packedLines', {}, 'packPhotos', [], 'packInProgress', null, 'status', 'Pending', 'pickStatus', 'Pending', 'lastShipmentAt', now);
    await updateDoc(doc(db, 'hq_sales_orders', parent.id), ...args);
    return { ok: true, why: '', built };
}

/**
 * THE SHIPMENT'S FULFILMENT: the parent's NetSuite order (carried as `shipmentOfNsId`, never nsInternalId — the Payments
 * callable finds an order by that field with limit(1)), ITS lines only (shipmentFulfilItemsOf), from the parent's bin —
 * after the terms gate with the part-payment rule (Stuart 2026-10-20: "as long as the remaining funds from deposit are
 * over 50% the amount of the balance order it is fine to ship first part"). → the words for the alert.
 *   gate(args) → gateShipmentWith's answer (a screen passes its own, with its unposted-card read); false = no gate
 */
export async function queueShipmentFulfilment({ child: d, nsProxyFetch, gate = null, by = '', sourceApp = 'WMS', log = () => {} }) {
    const ref = packRefOfRecord(d);
    const refDoc = doc(db, 'hq_sales_orders', d.id);
    const nsSoId = nsSoIdOfRecord(d);
    try {
        if (typeof gate === 'function') {
            const g = await gate({ nsSoId, refs: [refDoc], ref, shippingNow: Number(d.shipmentAmount) || 0 });
            if (!g.clear) return shipHoldNoteOf(g);
        }
        const rq = await nsProxyFetch({ targetUrl: SUITEQL, method: 'POST', payload: { q: soLinesSql(nsSoId) } });
        const jq = await rq.json();
        if (!rq.ok) throw new Error(`could not read the sales order lines — ${JSON.stringify(jq).slice(0, 200)}`);
        const open = fulfilmentItemsOf(jq.items || []);
        if (!open.ok) { await updateDoc(refDoc, { nsFulfillRefused: open.reason }); log(`⚠ Fulfilment NOT queued for ${ref} — ${open.reason}`, 'alert'); return `\n\n⚠ ${refusalText(open)}`; }
        const scoped = shipmentFulfilItemsOf({ items: open.items, rows: jq.items || [], lines: d.lines || [], bin: d.fulfilFromBin || '' });
        if (!scoped.ok) {
            await updateDoc(refDoc, { nsFulfillRefused: scoped.reason });
            const w = `NetSuite has no open line for ${scoped.missing.map(m => m.code).join(', ')} — the fulfilment was NOT queued; fulfil ${ref} by hand in NetSuite.`;
            log(`⚠ ${w}`, 'alert');
            return `\n\n⚠ ${w}`;
        }
        await enqueueNsWrite({
            kind: 'itemfulfillment', dedupeKey: `if:${nsSoId}:s${d.shipmentNo || 0}`,
            label: `NS Fulfillment — ${ref} (${d.customer || ''}) from ${d.fulfilFromBin || '—'}`,
            sourceApp, createdBy: by,
            // ITS lines, from the order's bin — replacing the bin NetSuite fills in itself (Shared/fulfilmentBins).
            targetUrl: fulfilmentTargetOf(nsSoId, scoped.items), method: 'POST',
            payload: { shipStatus: { id: 'B' }, memo: nsMemoOf(`Shipment ${d.shipmentNo || ''} of ${d.shipmentOfSoId || ''} — packed in app by ${by || 'Packer'}`), item: { items: scoped.items } },
            writeBack: [{ collection: 'hq_sales_orders', docId: d.id, patch: {}, idField: 'nsIfId', tranField: 'nsIfTran' }],
        });
        await updateDoc(refDoc, { nsFulfillQueued: true, nsFulfillNeedsBins: false, nsFulfillRefused: null });
        log(`📤 Fulfilment queued for ${ref} — ${scoped.items.length} NetSuite line${scoped.items.length === 1 ? '' : 's'} from ${d.fulfilFromBin || '—'}${scoped.missing.length ? ` · ⚠ no open NetSuite line for ${scoped.missing.map(m => m.code).join(', ')}` : ''}`, 'packing');
        return `\n\n📤 NetSuite Item Fulfillment queued for these lines only (status: Packed). It ships from the Fulfilment tab.${scoped.missing.length ? `\n\n⚠ NetSuite has no open line for ${scoped.missing.map(m => m.code).join(', ')} — check the order in NetSuite.` : ''}`;
    } catch (e) { return `\n\n⚠ Could not queue the NetSuite fulfilment for ${ref}: ${e.message || e}. The shipment stands — press Send on its line under the order, or fulfil it in NetSuite.`; }
}

export { shipmentWordsOf };
