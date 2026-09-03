// Shared helpers for the unified work-order contract (WORK_ORDER_CONTRACT.md).
// Centralized so the canonical task shape, the cross-floor status mirror, and the
// staging key can't drift between HQ, Finishing, Shop, and Pick/Pack.

import { db } from '../../firebase';
import { doc, updateDoc } from 'firebase/firestore';

// The finishing task object ActiveFloor actually renders (spin/pole/hand). §3.
export const makeFullTasks = () => ({
    spinSetup: { status: 'Pending', assignedTo: null },
    spinSpray: { status: 'Pending', assignedTo: null },
    spinBake:  { status: 'Pending', assignedTo: null },
    poleSpray: { status: 'Pending', assignedTo: null },
    poleBake:  { status: 'Pending', assignedTo: null },
    hand:      { status: 'Pending', assignedTo: null },
    // POLES HAND-FINISH ON ITS OWN TASK (Grace 2026-08-11/17). `hand` belongs to the small-parts
    // stream; a pole coat that is hand applied — her CP poles run DTM-7 → Champagne 587 → HAND →
    // 30 sheen — had no task of its own, so the floor had nothing to start or stop for it. Sharing
    // `hand` between the two streams would be worse than none: Rafa hand-finishing poles would mark
    // the small parts' hand step done.
    poleHand:  { status: 'Pending', assignedTo: null }
});

// §5: the custom half's status, mirrored onto the sibling fin work order so the Setup Queue,
// the WMS pack gate and RTG read it without a cross-collection query. FOUR states (Brief B5,
// Stuart 2026-09-02 — "sent to plating never needs to hit finishing"):
//   PENDING → IN_PROCESS (shop START; releases the small-parts pick)
//           → SENT_TO_PLATING (shop Complete & Label when the finish is outsourced — the parts are
//                              OUT at the plater; the pack gate waits: orderStatus.customPartsReady)
//           → COMPLETE (in-house: shop Complete & Label; plated: the WMS plating RECEIPT)
// Before the third state the shop mirrored 'Complete' whether or not the parts went to the
// plater, so a plated order's small parts could be packed while its poles were away (P0 #3).
// Only `finSiblingId` is read off the first argument — a bare { finSiblingId } link is enough.
// No-op when there is no linked sibling (manual/legacy orders); an unknown status is REFUSED
// and logged, never written — a misspelt state on the pack gate is worse than none.
export const CUSTOM_FAB_STATUS = Object.freeze({
    PENDING: 'Pending', IN_PROCESS: 'In Process', SENT_TO_PLATING: 'Sent to Plating', COMPLETE: 'Complete',
});
const CUSTOM_FAB_VALUES = Object.values(CUSTOM_FAB_STATUS);
export const mirrorCustomStatusToSibling = async (shopOrder, customFabStatus) => {
    if (!shopOrder || !shopOrder.finSiblingId) return;
    if (!CUSTOM_FAB_VALUES.includes(customFabStatus)) {
        console.error(`mirrorCustomStatusToSibling: '${customFabStatus}' is not a customFabStatus (${CUSTOM_FAB_VALUES.join(' | ')}) — nothing written`);
        return;
    }
    try {
        await updateDoc(doc(db, "fin_workorders", shopOrder.finSiblingId), { customFabStatus, customFabAt: Date.now() });
    } catch (e) {
        console.error("mirrorCustomStatusToSibling failed:", e);
    }
};

// §A1: the Pick/Pack trigger. PickPack only shows jobs with sentToPickPack === true,
// and nothing flipped it before — so the pick queue was always empty. The intended
// trigger is the shop operator STARTING the custom job: that's the moment the small
// parts should be released to pick (they meet the poles again at staging). No-op when
// the shop order has no small-parts sibling (custom-only / legacy orders).
export const releaseSiblingToPickPack = async (shopOrder) => {
    if (!shopOrder || !shopOrder.finSiblingId) return;
    try {
        await updateDoc(doc(db, "fin_workorders", shopOrder.finSiblingId), { sentToPickPack: true });
    } catch (e) {
        console.error("releaseSiblingToPickPack failed:", e);
    }
};

// §8: the staging key both halves share. The shop label encodes this; Pick/Pack
// scans it to re-pair. Normalize for tolerant matching.
export const normalizeKey = (v) => String(v == null ? '' : v).trim().toUpperCase();

// True if a scanned label identifies this fin work order (match on the shared key).
export const stagingScanMatches = (finWO, scan) => {
    const s = normalizeKey(scan);
    if (!s) return false;
    const candidates = [finWO.orderKey, finWO.salesOrderId, finWO.soNum].map(normalizeKey).filter(Boolean);
    return candidates.some(k => k === s || k.includes(s) || s.includes(k));
};

// §A2: the staging handshake resolves a scanned label to a fin WO by EXACT shared-key
// match (no substring — that's how we refuse to pair two different orders). Both the
// small-parts label and the shop custom label encode orderKey, so an exact compare on
// the normalized key is the verification. Returns the matching fin WO, or null.
export const resolveByExactKey = (finWOs = [], scan) => {
    const s = normalizeKey(scan);
    if (!s) return null;
    return finWOs.find(w =>
        [w.orderKey, w.salesOrderId, w.soNum].map(normalizeKey).filter(Boolean).includes(s)
    ) || null;
};

// ── WHAT IS THIS ORDER FOR? (Stuart 2026-08-17) ─────────────────────────────────────────────────
// "why are none of the work order windows displaying any product info, there is no pattern# nothing
//  they are all blank on wms set up and finishing floor?"
//
// Because the floor card reads `type`, and `type` means two different things depending on who wrote
// the order. The Sales Snapshot writes the ITEM CODE into it (`type: r.itemid`), so those cards have
// always shown the pattern number. Every other stock-build path — the Master Library's direct build
// and its make-up cascade, Stock View's grid push — writes the literal string "Stock Build", and RTG
// copies it forward. The item was never lost; it was sitting in stockErpId / partErpId, which no
// floor screen looked at.
//
// This resolves the identity from every field any writer has ever used, so a screen asks one
// question and gets the same answer wherever the order came from. Writers now also stamp it
// properly, making this the safety net rather than the mechanism.
const looksLikeItemCode = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (!s || /\s/.test(s)) return false;                                    // no code has spaces
    if (/^(stock build|custom|mixed|n\/a|pending|unassigned|none)$/i.test(s)) return false;
    // A code carries a DIGIT or a FINISH SLASH — HCUMB415/BB, H1-138BE/P, HTA435/SG. Without this
    // the sales-order cards read "Item: BRIMAR" (2026-08-17), because `type` holds the assembly
    // name on those and a bare word passed every other test. A collection or customer name is not
    // a pattern number, and labelling it "Item" is worse than showing nothing.
    return /[0-9]/.test(s) || s.includes('/');
};
export const woItemCodeOf = (wo) => {
    if (!wo) return '';
    // `itemCode` is CANONICAL (2026-08-25): every writer stamps it via withItemCode below, so on
    // any order created after that date the first candidate answers and the rest is the safety net
    // for the seven legacy spellings. `erpId` was the seventh (Eric: "orders from Stocked Sales do
    // not show the item information") — the Sales Snapshot wrote it while the resolver knew only
    // the other six, and the card went blank on exactly the orders it was built for.
    const candidates = [wo.itemCode, wo.jfpItemCode, wo.stockErpId, wo.variantErpId, wo.partErpId, wo.rootItem, wo.erpId, wo.type];
    for (const c of candidates) if (looksLikeItemCode(c)) return String(c).trim().toUpperCase();
    return '';
};
// The canonical stamp. Wrap every payload that CREATES a work-order document (hq_work_orders,
// fin_workorders, parked finPayloads) so the identity lands under ONE name and readers stop
// needing the legacy chain. No-op when nothing on the payload resolves to a code — never
// manufactures data, and never overwrites an itemCode a caller set deliberately.
export const withItemCode = (payload) => {
    if (!payload) return payload;
    if (looksLikeItemCode(payload.itemCode)) return payload;
    const code = woItemCodeOf(payload);
    return code ? { ...payload, itemCode: code } : payload;
};
// The human name, when the order carries one. Never the item code — callers show both.
export const woItemNameOf = (wo) => {
    if (!wo) return '';
    const code = woItemCodeOf(wo);
    for (const v of [wo.itemName, wo.jfpItemName, wo.type]) {
        const s = String(v == null ? '' : v).trim();
        if (s && s.toUpperCase() !== code && !/^(stock build|custom|mixed)$/i.test(s)) return s;
    }
    return '';
};
// The 10×5×2 that `dimensions` falls back to when nothing supplied real ones. A stock build has no
// measured box, so printing that trio as "Item Dimensions" states a fact nobody established.
export const isPlaceholderDims = (d) =>
    !d || (Number(d.length) === 10 && Number(d.width) === 5 && Number(d.height) === 2)
       || (!Number(d.length) && !Number(d.width) && !Number(d.height));
