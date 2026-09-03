// ONE PURCHASE ORDER WRITER (Brief A, A4 — Stuart 2026-09-02).
//
// Three screens cut their own POs with three different field lists: the Stock View PO builder, the
// Sales Snapshot and the Order Entry review. Only one of them checked whether the vendor was even
// assigned to the buying subsidiary; only one stamped `source`; only one resolved a vendor by its
// NetSuite id when the name did not match. They now all call this.
//
// THE LIFE OF A PO, as Stuart described it:
//   1. CREATE   an operator enters quantities for 50 items across 5 vendors and presses Generate.
//               Lines group by vendor: one PO per vendor, holding only that vendor's items. Saved
//               as DRAFT — nothing has been sent anywhere.
//   2. PREVIEW  the whole set is shown back: every PO, its lines, its total. Nothing is committed.
//   3. APPROVE  the PO is pushed to NetSuite LINE FOR LINE. Only NetSuite can mint a PO number, so
//               this is where the real number comes from; it stamps back onto the app's record.
//   4. SEND     with its number, the PO can be opened and emailed to the vendor — the same way a
//               sales order goes out from the CRM.
//   5. ACK      days later the vendor acknowledges, usually with a ready date. That lands on the
//               PO header (tab 10, the vendor's own page), where the record lives from then on.
//
// A sales order number stays attached to the LINE it belongs to (Stuart: "if the po has 20 items
// on order and 4 items have demand for specific sales orders the sales order #'s should stay
// aligned"), and the header carries the distinct list so the Order Entry Needs board can find its
// coverage without reading every line.
//
// The floors never see a purchase order. The WMS will, when it receives against one — that tab is
// Brief D's, and it reads what is written here.

import { db } from '../../firebase';
import { doc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { enqueueNsWrite } from './nsOutbox';
import { BRAND_NETSUITE_MAP } from './brandNetsuite';
import { reserveShortNo } from './shortId';

// ── STATUS, THE WHOLE LIFE ─────────────────────────────────────────────────────────────────────
// Draft is new (2026-09-02). Everything from Approved on is the existing vocabulary — RTG's board
// queries `status == 'Approved'`, the outbox write-back sets 'Pushed to NetSuite', and the plating
// POs the WMS raises use 'Sent to Plater'. Nothing already written changes meaning.
export const PO_STATUS = {
    DRAFT: 'Draft',                       // created, previewed, not yet approved — goes nowhere
    APPROVED: 'Approved',                 // approved, waiting on the outbox worker
    QUEUED: 'Queued to NetSuite',
    PUSHED: 'Pushed to NetSuite',         // has its real PO number
    SENT: 'Sent to Vendor',
};
export const isDraftPo = (po) => String((po && po.status) || '') === PO_STATUS.DRAFT;
export const hasNsNumber = (po) => !!(po && (po.nsPoTran || po.nsPoId));
export const poRef = (po) => String((po && (po.nsPoTran || po.poId || po.id)) || '');

// ── VENDOR RESOLUTION ──────────────────────────────────────────────────────────────────────────
// The library's vendor NAMES against the NetSuite-synced CRM records (crm_records VEND-<ns id>,
// from 11.1 "Sync Active Vendors"). The vendor's INTERNAL id is stamped on the PO at creation, so
// the push can never mis-resolve it.
let vendorsCache = null;
export const loadNsVendors = async ({ refresh = false } = {}) => {
    if (vendorsCache && !refresh) return vendorsCache;
    const snap = await getDocs(query(collection(db, 'crm_records'), where('type', '==', 'VENDOR')));
    vendorsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return vendorsCache;
};

const normVend = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const resolveVendorRec = (vendors, name) => {
    const n = normVend(name);
    if (!n) return null;
    return (vendors || []).find(v => normVend(v.name) === n)
        || (vendors || []).find(v => normVend(v.name).startsWith(n) || n.startsWith(normVend(v.name)))
        || null;
};

// NAME MATCHING IS THE FALLBACK, NOT THE MECHANISM (2026-08-15). The item sync carries the vendor's
// NetSuite internal id (`manufacturingSpecs.vendorNsId`, off the ItemVendor sublist), so a PO no
// longer depends on a name spelling its way to a CRM record — a near miss used to produce NO PO at
// all. The name still wins when it resolves (an operator's override is a deliberate choice); the id
// only rescues what the name drops.
export const resolveVendorByNsId = (vendors, nsId) => {
    const id = String(nsId || '').replace(/^VEND-/, '').trim();
    if (!id) return null;
    return (vendors || []).find(v => String(v.id) === `VEND-${id}`) || null;
};

// The id most of a group's items agree on — one straggler with a stale vendor cannot hijack it.
export const consensusVendorNsId = (parts) => {
    const tally = {};
    (parts || []).forEach(p => { const id = p?.manufacturingSpecs?.vendorNsId; if (id) tally[id] = (tally[id] || 0) + 1; });
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

// CAN THIS SUBSIDIARY BUY FROM THIS VENDOR? (Eric 2026-08-15) A PO carries the BUYING company's
// subsidiary, but NetSuite only accepts a vendor assigned to it — and ours are routinely assigned
// the other way round. Unchecked, that surfaces at push time as a confusing complaint about the
// LOCATION field. An empty list means the vendor sync could not read the assignments, which is
// silence, not a denial — so it never warns on missing data.
export const vendorSubsidiaryGap = (rec, subsidiaryId) => {
    const subs = Array.isArray(rec?.nsSubsidiaries) ? rec.nsSubsidiaries.map(String) : [];
    if (!subs.length || !subsidiaryId) return null;
    return subs.includes(String(subsidiaryId)) ? null : subs;
};

// What the vendor actually charges, in the order NetSuite knows it: the vendor sublist's own
// purchase price, then the item's purchase price (Eric's `cost`), then average cost — a costing
// artefact that was silently rating every PO line until 2026-08-15.
export const poRateOf = (part) => {
    const s = part?.manufacturingSpecs || {};
    return parseFloat(s.vendorPurchasePrice) || parseFloat(s.purchasePrice) || parseFloat(s.cost) || 0;
};

// The vendor's minimum, when the record carries one — shown beside the running total so a PO is
// not sent under it. Read only; nothing here writes or invents an MOQ.
export const vendorMinimumOf = (rec, lines) => {
    const min = parseFloat(rec?.orderMinimum ?? rec?.minimumOrder ?? rec?.moq);
    if (!(min > 0)) return null;
    const total = (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.rate) || 0), 0);
    return { minimum: min, total, short: Math.max(0, min - total) };
};

// ── THE NETSUITE PAYLOAD ───────────────────────────────────────────────────────────────────────
// ONE builder for the one push (agreed with Brief B, 2026-09-02): identical to what RTG's PO panel
// has always sent, except the memo, which now says where the PO came from instead of naming the
// Sales Snapshot on every PO including Order Entry component buys. Every line goes: they are all
// NetSuite items (Stuart: "push line for line into a new po").
const SOURCE_LABEL = {
    SALES_SNAPSHOT: 'Sales Snapshot', STOCKVIEW_PO_BUILDER: 'Stock View PO builder',
    OE_REVIEW: 'Order Entry review', STOCK_BUILD_NEEDS: 'Stock Build Needs', PLATING: 'plating',
};
export const poMemoOf = (po) => {
    const ref = po.poId || po.id;
    const base = String(po.note || SOURCE_LABEL[po.source] || 'Stock replenishment').trim();
    const sos = (po.soAppIds || []).length ? ` · SO ${(po.soRefs || po.soAppIds).slice(0, 4).join(', ')}${(po.soAppIds || []).length > 4 ? '…' : ''}` : '';
    return `${base} ${ref}${sos}`;
};
export const NS_PO_URL = 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseorder';
export const buildPoNsPayload = (po, brandId) => {
    const nsConfig = BRAND_NETSUITE_MAP[String(brandId || '').toLowerCase()] || {};
    return {
        entity: { id: String(po.nsVendorId) },
        // SUBSIDIARY MUST COME BEFORE LOCATION, AND NEITHER GOES ALONE (Eric 2026-08-15). Setting
        // the entity first auto-populates the VENDOR's primary subsidiary, and our vendors sit
        // opposite the company buying from them; NetSuite then rejects a location belonging to the
        // subsidiary it just defaulted away from, and blames the location. Keep this key order.
        ...(nsConfig.subsidiary
            ? { subsidiary: { id: String(nsConfig.subsidiary) }, location: { id: String(nsConfig.location) } }
            : {}),
        // Without a due date NetSuite dates the whole PO today and receiving has nothing to
        // schedule against.
        ...(po.reqDate ? { dueDate: po.reqDate } : {}),
        memo: poMemoOf(po),
        item: {
            items: (po.items || []).map(l => ({
                item: { id: String(l.nsItemId) },
                quantity: parseInt(l.quantity, 10) || 1,
                ...(parseFloat(l.rate) > 0 ? { rate: parseFloat(l.rate) } : {}),
                description: l.description || l.itemId,
            })),
        },
    };
};

// ── CREATE: one DRAFT PO per vendor, from one press ────────────────────────────────────────────
/**
 * @param {object} p
 * @param {object[]} p.lines   [{ part, qty, rate?, reason?, from?, soAppId?, soRef?, vendorName? }]
 *                             `part` is the library record; `vendorName` overrides the item's own.
 * @param {string} p.brand · p.createdBy · p.reqDate · p.source · [p.note]
 * @returns {{ pos: [], unmatched: [{vendor, items[]}], gaps: [{poId, vendor, has[]}] }}
 *          `pos` are written as Draft; nothing is sent.
 */
export const createDraftPurchaseOrders = async ({ lines = [], brand, createdBy = '', reqDate = '', source = '', note = '' }) => {
    const vendors = await loadNsVendors();
    const subsidiary = (BRAND_NETSUITE_MAP[String(brand || '').toLowerCase()] || {}).subsidiary || '';
    const byVendor = new Map();
    lines.forEach(l => {
        const v = String(l.vendorName || l.part?.manufacturingSpecs?.vendorName || '').trim();
        if (!byVendor.has(v)) byVendor.set(v, []);
        byVendor.get(v).push(l);
    });

    const pos = [], unmatched = [], gaps = [];
    for (const [vendorName, group] of byVendor.entries()) {
        const rec = resolveVendorRec(vendors, vendorName)
            || resolveVendorByNsId(vendors, consensusVendorNsId(group.map(l => l.part)));
        if (!rec) { unmatched.push({ vendor: vendorName, items: group.map(l => String(l.part?.legacyErpId || l.part?.itemId || '')) }); continue; }
        const nsVendorId = String(rec.id || '').replace(/^VEND-/, '');
        let poId;
        try { poId = await reserveShortNo('PO'); }
        catch (e) { poId = `PO-${(vendorName || 'VEND').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5)}-${Date.now().toString().slice(-6)}`; }

        // ONE LINE PER ITEM, and the sales order that wants it stays ON that line. Two demands for
        // the same code from the same sales order merge; from different orders they do not, or the
        // line could no longer say who it is for.
        const merged = new Map();
        group.forEach(l => {
            const code = String(l.part?.legacyErpId || l.part?.itemId || '').toUpperCase();
            const key = `${code}|${l.soAppId || ''}`;
            const row = merged.get(key) || {
                itemId: code,
                nsItemId: l.part?.netSuiteInternalId ? String(l.part.netSuiteInternalId) : null,
                vendorPart: l.part?.manufacturingSpecs?.vendorId || 'N/A',
                quantity: 0,
                rate: l.rate != null ? Number(l.rate) : poRateOf(l.part),
                description: l.part?.manufacturingSpecs?.purchaseDescription || l.part?.itemName || code,
                ...(l.soAppId ? { soAppId: l.soAppId, soRef: l.soRef || '' } : {}),
                ...(l.reason ? { reason: l.reason } : {}),
                ...(l.from ? { from: l.from } : {}),
                received: 0,
            };
            row.quantity += Math.max(0, Number(l.qty) || 0);
            merged.set(key, row);
        });
        const items = [...merged.values()].filter(r => r.quantity > 0);
        if (!items.length) continue;

        const gap = vendorSubsidiaryGap(rec, subsidiary);
        if (gap) gaps.push({ poId, vendor: rec.name || vendorName, has: gap });
        const soAppIds = [...new Set(items.map(i => i.soAppId).filter(Boolean))];
        const soRefs = [...new Set(items.map(i => i.soRef).filter(Boolean))];
        const po = {
            id: poId, poId, brand, status: PO_STATUS.DRAFT,
            vendor: rec.name || vendorName, nsVendorId, vendorCrmId: rec.id,
            nsSubsidiary: subsidiary, vendorSubsidiaryGap: gap ? gap.join(',') : '',
            items, source, note,
            // The sales orders this PO serves — on each line, and listed here so the Order Entry
            // Needs board can find its coverage without reading every line.
            ...(soAppIds.length ? { soAppIds, soRefs } : {}),
            reqDate: reqDate || new Date(Date.now() + 12096e5).toISOString().split('T')[0],
            createdAt: Date.now(), createdBy,
        };
        await setDoc(doc(db, 'hq_purchase_orders', poId), po);
        pos.push({ ...po, vendorRec: rec, minimum: vendorMinimumOf(rec, items) });
    }
    return { pos, unmatched, gaps };
};

// ── APPROVE: push it, line for line, and take NetSuite's number ────────────────────────────────
// Stuart: "the po before sending once approved should send to netsuite to get actual po# — only
// netsuite can generate the po# — … receive po# from netsuite and stamp to po in app, then can
// open to send to vendor." The outbox worker posts it (serial, retried, idempotent) and writes
// nsPoId / nsPoTran back onto this doc.
export const approvePurchaseOrder = async ({ po, brand, createdBy = '' }) => {
    if (!po?.nsVendorId) throw new Error(`${poRef(po)}: no NetSuite vendor id — sync vendors (11.1) and re-create the PO.`);
    const missing = (po.items || []).filter(l => !l.nsItemId);
    if (missing.length) throw new Error(`${poRef(po)}: ${missing.length} line(s) have no NetSuite item id (${missing.slice(0, 3).map(l => l.itemId).join(', ')}) — every line must post, so sync those items (11.1) first.`);
    const obId = await enqueueNsWrite({
        kind: 'purchaseorder',
        dedupeKey: `po:${po.id}`,                 // one NetSuite PO per app PO, ever
        label: `PO ${po.poId || po.id} → ${po.vendor}`,
        sourceApp: po.source || 'APP', createdBy,
        targetUrl: NS_PO_URL,
        method: 'POST',
        payload: buildPoNsPayload(po, brand),
        writeBack: { collection: 'hq_purchase_orders', docId: po.id, patch: { status: PO_STATUS.PUSHED, pushedAt: Date.now() }, idField: 'nsPoId', tranField: 'nsPoTran' },
    });
    await updateDoc(doc(db, 'hq_purchase_orders', po.id), {
        status: PO_STATUS.QUEUED, nsOutboxId: obId,
        approvedAt: Date.now(), approvedBy: createdBy,
    });
    return obId;
};

// ── SEND: the vendor's copy, once it has its number ────────────────────────────────────────────
// Same shape the CRM sends a sales order: the document is printed/downloaded and the operator's own
// mail client carries it, so nothing leaves this machine without a person seeing it.
export const poEmailDraft = (po, vendorRec) => {
    const emails = [...new Set([vendorRec?.email, ...((vendorRec?.contacts || []).map(c => c.email))].filter(Boolean))];
    const ref = poRef(po);
    const lines = (po.items || []).map(l => `  ${l.quantity} × ${l.itemId}${l.description && l.description !== l.itemId ? ` — ${l.description}` : ''}`).join('\r\n');
    return {
        to: emails,
        subject: `Purchase Order ${ref}${po.brand ? ` — ${String(po.brand).toUpperCase()}` : ''}`,
        body: `Hello,\r\n\r\nPlease find our purchase order ${ref} below${po.reqDate ? `, required by ${po.reqDate}` : ''}.\r\n\r\n${lines}\r\n\r\nPlease confirm receipt and your ready date.\r\n\r\nThank you.`,
    };
};
export const markPoSent = async (poId, by = '') =>
    updateDoc(doc(db, 'hq_purchase_orders', poId), { status: PO_STATUS.SENT, sentAt: Date.now(), sentBy: by });

// ── ACKNOWLEDGE: the vendor's answer, days later ───────────────────────────────────────────────
// Stuart: "the po's must have ability to add at the header level a vendor acknowledgement with
// updated ready date. this information usually arrives a few days after it is sent." Header-level,
// exactly as asked — the per-line receipts the WMS will post are a separate thing.
export const acknowledgePurchaseOrder = async ({ poId, ackRef = '', readyDate = '', note = '', by = '' }) =>
    updateDoc(doc(db, 'hq_purchase_orders', poId), {
        vendorAck: {
            acknowledged: true, ackRef: String(ackRef || ''), readyDate: String(readyDate || ''),
            note: String(note || ''), at: Date.now(), by,
        },
        // The date the rest of the app already reads for an expected arrival.
        ...(readyDate ? { expectedReceiveDate: readyDate } : {}),
    });
