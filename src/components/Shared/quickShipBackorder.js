// ── AN ORDER ENTRY ORDER CARRIES ITS TRUE BACKORDERS TOO (STATE #17, close-out item 4; S1 2026-09-13) ──
//
// A CPQ order reaches RTG's split, which classifies every small-parts line against live stock through
// the ONE definition (Shared/backorder.classifyLine, via Shared/splitPlan.planSmallLines) and writes
// `hq_sales_orders.backorderLines[]` for the Snapshot's Backorders board. An Order Entry (tab 7) order
// never reaches the split — the WMS packs it off the SO doc itself — so its shorts were invisible to
// the board. This module hands tab 7's lines to THE SAME planner at save, so both doors write the same
// record from the same rule. Pure: the stock read (fetchAvailabilityUnits) is the caller's.
import { planSmallLines } from './splitPlan.js';
import { coverCodesOf } from './backorder.js';

const num = (v) => Number(v) || 0;

/**
 * Tab 7's lines in the split's shape: { legacyErpId, partName, qty, finishOutsourced? }.
 *   lines        the priced stock lines (erp, name, eachQty, qty, perFoot, toBeFinished, finishOutsourced)
 *   trvDocLines  the traverse mirror rows; PART rows are the components the WMS pulls (code, name, qty)
 * A per-foot line is pulled as PIECES (its `qty`), as the SO's own lines[] records it.
 */
export function quickShipPullLines(lines = [], trvDocLines = []) {
    const out = [];
    (lines || []).forEach(l => {
        if (!l || !l.erp) return;
        const qty = l.perFoot ? num(l.qty) : num(l.eachQty != null ? l.eachQty : l.qty);
        if (qty <= 0) return;
        out.push({
            legacyErpId: String(l.erp), partName: l.name || '', qty,
            // a to-be-finished line says whether its finish is outsourced (the line's own stamp);
            // a plain stocked line lets the finish suffix decide, exactly as the split does.
            ...(l.toBeFinished && l.finishOutsourced === true ? { finishOutsourced: true } : {}),
        });
    });
    (trvDocLines || []).forEach(d => {
        if (!d || d.kind !== 'PART' || !d.code) return;
        const qty = num(d.qty);
        if (qty > 0) out.push({ legacyErpId: String(d.code), partName: d.name || '', qty, trvComponent: true });
    });
    return out;
}

/** Every code whose stock can satisfy the order — the read to make before classifying. */
export const quickShipCoverCodes = (pull = [], orderRecipe = '') =>
    [...new Set((pull || []).flatMap(l => coverCodesOf(l, orderRecipe)))];

/**
 * The backorder records for a tab 7 order — planSmallLines' `backorder`, nothing else:
 *   stock = { map, unitsKnown } from fetchAvailabilityUnits, or null when the read was not made
 *   (then nothing is claimed — an unread shelf is never a shortage).
 */
export function quickShipBackorderLines(pull = [], orderRecipe = '', stock = null, { since = null } = {}) {
    if (!pull || !pull.length) return [];
    return planSmallLines(pull, orderRecipe, stock, { since }).backorder;
}
