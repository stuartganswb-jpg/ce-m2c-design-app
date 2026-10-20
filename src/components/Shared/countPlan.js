// ── WHAT A CYCLE COUNT SENDS NETSUITE — one bin per adjustment line (Stuart 2026-10-20: "can we fix these?") ───────────────
// Eric's three counts of 2026-10-14 were refused: "You still need to reconfigure the inventory detail record after changing the
// quantity" — NetSuite saying a line's quantity and its bin detail did not agree. The six counts he posted that evening
// (IA27851–56) each carried one bin on its line, and of the 196 adjustments the app has ever queued, every one of the 172 that
// posted sends ONE bin per line. A count was the only thing that could put several bins on one line (an item counted in two
// bins that both went down, or both up). So a count now sends what every adjustment that posts sends: one line per item and
// bin — NetSuite takes the same item on several lines — with the quantities rounded to five places so a line and its detail
// can never differ by a hair, and two count rows of the same item and bin merged into one first. Bin transfers (an item whose
// bins moved both ways) are paired exactly as before. The net change per item and bin is exactly what it was.
// Pure. Harness: scripts/countPlan.test.mjs.

export const round5 = (n) => Math.round((Number(n) || 0) * 1e5) / 1e5;
const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/**
 * rowDeltas: [{ internalId, binNumber, adjustQtyBy }] → {
 *   transferItems: [{ internalId, moves: [{ from, to, qty }] }]   — an item's down-bins paired with its up-bins (bin transfers)
 *   adjustLines:   [{ internalId, binNumber, qty }]               — what is left, one line per item and bin (the adjustment)
 * }
 */
export function countPlanOf(rowDeltas = []) {
    const byItem = new Map();
    (rowDeltas || []).forEach(d => {
        if (!d || !d.internalId) return;
        const q = round5(d.adjustQtyBy);
        if (!q) return;
        const key = String(d.internalId);
        const it = byItem.get(key) || { internalId: key, bins: [] };
        const bin = String(d.binNumber || '').trim();
        const same = it.bins.find(b => U(b.binNumber) === U(bin));
        if (same) same.qty = round5(same.qty + q); else it.bins.push({ binNumber: bin, qty: q });
        byItem.set(key, it);
    });
    const transferItems = [], adjustLines = [];
    byItem.forEach(it => {
        const bins = it.bins.filter(b => b.qty !== 0);
        const decs = bins.filter(b => b.qty < 0).map(b => ({ bin: b.binNumber, rem: -b.qty }));
        const incs = bins.filter(b => b.qty > 0).map(b => ({ bin: b.binNumber, rem: b.qty }));
        const moves = [];
        let di = 0, ii = 0;
        while (di < decs.length && ii < incs.length) {
            const move = round5(Math.min(decs[di].rem, incs[ii].rem));
            if (move > 0) moves.push({ from: decs[di].bin, to: incs[ii].bin, qty: move });
            decs[di].rem = round5(decs[di].rem - move);
            incs[ii].rem = round5(incs[ii].rem - move);
            if (decs[di].rem <= 0) di++;
            if (incs[ii].rem <= 0) ii++;
        }
        if (moves.length) transferItems.push({ internalId: it.internalId, moves });
        decs.filter(x => x.rem > 0).forEach(x => adjustLines.push({ internalId: it.internalId, binNumber: x.bin, qty: round5(-x.rem) }));
        incs.filter(x => x.rem > 0).forEach(x => adjustLines.push({ internalId: it.internalId, binNumber: x.bin, qty: round5(x.rem) }));
    });
    return { transferItems, adjustLines };
}

/** The inventory adjustment's lines: one per item and bin, its quantity, its detail and its one bin all the same number. */
export const adjustmentItemsOf = (adjustLines = [], locationId) => adjustLines.map(l => ({
    item: { id: String(l.internalId) },
    location: { id: String(locationId) },
    adjustQtyBy: l.qty,
    inventoryDetail: { quantity: l.qty, inventoryAssignment: { items: [{ binNumber: { refName: l.binNumber }, quantity: l.qty }] } },
}));

/** The bin transfer's lines (unchanged in shape): line-level quantity before the detail, each move from → to. */
export const binTransferItemsOf = (transferItems = []) => transferItems.map(t => {
    const lineQty = round5(t.moves.reduce((s, m) => s + m.qty, 0));
    return {
        item: { id: String(t.internalId) },
        quantity: lineQty,   // line-level qty is required before NetSuite accepts the inventoryDetail
        inventoryDetail: { quantity: lineQty, inventoryAssignment: { items: t.moves.map(m => ({ binNumber: { refName: m.from }, toBinNumber: { refName: m.to }, quantity: m.qty })) } },
    };
});
