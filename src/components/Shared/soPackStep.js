// ── A CPQ ORDER IS BOXED AND PACKED ON SO PACK (step 2 · Stuart 2026-10-17: "go ahead on step 2") ─────────────────────────
//
// Stuart 2026-10-08: "packaging prep is really where the finished products are wrapped and placed in their individual
// product packaging not the final order shipping boxes … the so pack screen is where they should scan the packed product
// labels into the actual shipping boxes … then straight to ups." And 2026-10-17, on the photo and the scan: "yes, … yes for
// now we streamline and make easy then we can refine for tight control" — a photo of the closed boxes, pieces put into a
// box by a tap (a label scan comes later).
//
// So a CPQ floor document is PACKAGED at Packaging Prep: its lines ticked and its product photo, then packStatus 'Packed'
// as before (the NetSuite build, RTG's done-state) and packStage PACKAGED. Its ORDER is boxed on SO Pack: the numbered
// boxes on the sales order (Shared/orderBoxes), every packaged piece in one, a photo of the closed boxes, and ✓ Packed —
// the sales order Packed, each document ORDER_PACKED, and the ONE NetSuite fulfilment (Shared/fulfilmentQueue).
// A document packed before this (no packStage) is finished the old way and is never asked again.
// Pure: no imports but the box rules.
import { unboxedLinesOf } from './orderBoxes.js';

export const PACK_STAGE = Object.freeze({ PACKAGED: 'PACKAGED', ORDER_PACKED: 'ORDER_PACKED' });

const str = (v) => String(v == null ? '' : v).trim();
const liveDocsOf = (docs = []) => (docs || []).filter(d => d && !d.deleted && d.currentPhase !== 'Closed');

/** Packaged at Prep, its order not yet boxed and packed on SO Pack. */
export const awaitsOrderPack = (d) => !!d && d.packStatus === 'Packed' && d.packStage === PACK_STAGE.PACKAGED;

/** Has the ORDER been packed on SO Pack? (its sales order carries the stamp) */
export const orderPackedOnSoPack = (so) => !!so && so.packStatus === 'Packed';

/** The order is waiting to be boxed: every live document packaged or packed, at least one of them awaiting its order. */
export const orderAwaitsPackOf = (so, docs = []) => {
    if (!so || orderPackedOnSoPack(so)) return false;
    const live = liveDocsOf(docs);
    return live.length > 0 && live.every(d => d.packStatus === 'Packed') && live.some(awaitsOrderPack);
};

/**
 * Why ✓ Packed may not be pressed yet, or '' — the first unmet condition, in the order a packer meets them.
 *   linesOf(doc) → its pack lines (riders excluded by the caller or here) · refOf(doc) → its reference · mine = the order is yours
 */
export const orderPackBlockerOf = ({ so, docs = [], linesOf = () => [], refOf = (d) => str(d && d.id), mine = false } = {}) => {
    if (!so) return 'no sales order on file for this order';
    if (orderPackedOnSoPack(so)) return 'this order is already packed';
    const live = liveDocsOf(docs);
    if (!live.length) return 'this order has no open work orders';
    const open = live.filter(d => d.packStatus !== 'Packed');
    if (open.length) return `${open.length} work order${open.length === 1 ? ' is' : 's are'} not packaged at Packaging Prep yet (${open.slice(0, 4).map(refOf).join(', ')}${open.length > 4 ? '…' : ''})`;
    if (!live.some(awaitsOrderPack)) return 'every work order of this order was packed at Packaging Prep before boxing moved here — it ships as it was packed';
    if (!mine) return 'press START PACKING first — this order is not yours yet';
    const loose = live.flatMap(d => unboxedLinesOf(d, (linesOf(d) || []).filter(l => l && !l.rider)).map(l => str(l.erp) || str(l.name)));
    if (loose.length) return `${loose.length} packed line${loose.length === 1 ? ' is' : 's are'} not in a box yet (${loose.slice(0, 4).join(', ')}${loose.length > 4 ? '…' : ''}) — open a box and put them in`;
    if (!((so.packPhotos || []).length)) return 'take a photo of the closed boxes (📷 Add Photo)';
    return '';
};

/** The sales order's stamp when its order is packed on SO Pack. */
export const orderPackedPatchOf = ({ by = '', at = Date.now() } = {}) => ({ packStatus: 'Packed', packedAt: at, packedBy: str(by) || 'Packer', packInProgress: null });

/** Each packaged document's stamp at the same press — packBoxes as the Fulfilment tab reads it (Shared/orderBoxes.packBoxesOfTicks). */
export const docOrderPackedPatchOf = ({ by = '', at = Date.now(), packBoxes = null } = {}) => ({
    packStage: PACK_STAGE.ORDER_PACKED, orderPackedAt: at, orderPackedBy: str(by) || 'Packer',
    ...(packBoxes ? { packBoxes } : {}),
});
