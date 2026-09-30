// 🧩 WAITING ON ITS OTHER HALF (Stuart 2026-09-30, after SO60676 sat picked-and-complete for a day with nobody
// scanning it: "next to that staging scan center, can you create a card that shows all the current orders where one
// half small parts or poles/custom are shown as completed and ready for match but the other side is missing, so we
// can be sure nothing is getting lost in the cracks").
//
// A sales order's finishing document reaches the floor only through the WMS staging handshake (PickPackApp
// handleStagingMatch): its small parts PICKED (awaiting staging) and — when it has a shop half — its custom parts
// COMPLETE (customPartsReady, the one test the scan and the Setup Queue already share), both labels scanned
// together. This reads every open document that has not been matched and has at least one half ready:
//   SMALL_READY  small parts picked, sitting at staging — the shop half is not in yet
//   SHOP_READY   the shop half is complete — the small parts are not picked yet
//   BOTH_READY   everything is in and nobody has scanned the handshake (where SO60676 was)
// Stock builds and pick-only documents skip the match; staged, packed, cleared-by-hand and closed documents are
// past it. Pure — scripts/stagingPairs.test.mjs asserts it.
import { customPartsReady, customFabLabel, isSalesDoc, nothingToPick, stagingMatched } from './orderStatus.js';

export const PAIR_WAIT = { SMALL_READY: 'SMALL_READY', SHOP_READY: 'SHOP_READY', BOTH_READY: 'BOTH_READY' };
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const tsOf = (v) => (v && typeof v === 'object' && typeof v.toMillis === 'function' ? v.toMillis() : v && typeof v === 'object' && Number.isFinite(v.seconds) ? v.seconds * 1000 : N(v));

const isOpen = (w) => !!w && !w.deleted && w.closed !== true && w.currentPhase !== 'Closed'
    && !['CLOSED', 'CANCELLED'].includes(String(w.status || '').toUpperCase()) && !w.packStatus;

/** Where the small-parts half is, in words, when it is not picked. */
const smallStateOf = (w) => {
    const claim = w.pickInProgress && w.pickInProgress.by ? w.pickInProgress.by : '';
    if (w.sentToPickPack) return claim ? `being picked by ${claim}` : 'in the WMS pick queue, not picked';
    return 'not released to the pick yet';
};

/** One document's place on the card, or null when it is not waiting on a half. */
export function pairWaitOf(w) {
    if (!isOpen(w) || !isSalesDoc(w) || w.orderType === 'stock' || w.pickOnly === true) return null;
    const ps = String(w.pickStatus || '');
    if (stagingMatched(w) || ps === 'Staged_Ready_For_Finishing' || ps.startsWith('Cleared')) return null;
    if (w.currentPhase === 'Complete') return null;                 // off the floor — long past staging
    const hasShop = !!w.hasCustomSibling;
    const noSmall = nothingToPick(w);
    const smallPicked = ps === 'Picked_Awaiting_Staging';
    const shopDone = hasShop && customPartsReady(w);
    const smallSince = tsOf(w.pickedAt) || null, shopSince = tsOf(w.customFabAt) || null;
    const base = { id: w.id, hasShop, noSmall };
    if (smallPicked && hasShop && !shopDone) {
        return { ...base, kind: PAIR_WAIT.SMALL_READY, ready: 'small parts picked', missing: `shop half: ${String(customFabLabel(w)).toLowerCase()}`, since: smallSince };
    }
    if (shopDone && !noSmall && !smallPicked) {
        return { ...base, kind: PAIR_WAIT.SHOP_READY, ready: 'shop half complete', missing: `small parts: ${smallStateOf(w)}`, since: shopSince };
    }
    if ((smallPicked && (!hasShop || shopDone)) || (noSmall && shopDone)) {
        const since = Math.max(smallPicked ? (smallSince || 0) : 0, hasShop ? (shopSince || 0) : 0) || null;
        const ready = noSmall ? 'shop half complete (nothing to pick)' : hasShop ? 'small parts picked · shop half complete' : 'small parts picked (no shop half)';
        return { ...base, kind: PAIR_WAIT.BOTH_READY, ready, missing: 'the staging scan — nobody has matched it', since };
    }
    return null;
}

/** The card's rows, oldest wait first; rows with no known time go last. */
export function pairWaitsOf(docs = []) {
    return (docs || []).map(w => { const p = pairWaitOf(w); return p ? { ...p, doc: w } : null; }).filter(Boolean)
        .sort((a, b) => (a.since || Infinity) - (b.since || Infinity) || String(a.id).localeCompare(String(b.id)));
}

/** "3 h" / "2 days" — how long a half has been waiting. */
export const waitedText = (since, now = Date.now()) => {
    const t = N(since);
    if (!t) return '';
    const m = Math.max(0, Math.round((now - t) / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} h`;
    return `${Math.round(h / 24)} days`;
};
