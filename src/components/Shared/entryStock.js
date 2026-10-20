// ── STOCK, SAID THE MOMENT A LINE IS PICKED (Stuart 2026-10-20) ─────────────────────────────────────────────────────────
// "the components are stocked and the finials and brackets are stocked … do we use stocked or to be finished, doesnt matter
// either way as long as if it checks right away if there is stock and we pull it" · "show live stock would be amazing" ·
// "plated parts solution above is great, so same kits in painted finish will use current behavior to be finishes, plated
// can use new above".
//
// What tab 7 is about to sell, asked of NetSuite's AVAILABLE stock (net of commitments — Shared/oeReviewPlan
// .fetchAvailabilityUnits, the read its save-time backorder check makes) before the Add:
//   · a STOCKED item — as itself;
//   · a part TO BE FINISHED in a PLATED finish — as its finished item (H1-1BE + EP4 → H1-1BE/EP4);
//   · an item KIT in a plated finish — each of its parts in that finish (the collar H1-2RCTAECC/EP3), a part that wears
//     nothing as itself (the clear acrylic tip).
// The order is already routed by the same stock at save (Shared/oeGenerate.oeDoorOf: a plated small part is STOCK — covered
// → the WMS pick, short → the Backorder board); this says so up front. A part to be PAINTED, or a plated POLE (made on the
// shop floor, then plated), keeps its route and is not asked. Pure. Harness: scripts/entryStock.test.mjs.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/**
 * The codes to ask about, each with how many the line needs. → [{ code, need }]
 * @param mode       'STOCKED' | 'TO_BE_FINISHED'
 * @param code       the item's code (the raw part for a line to be finished)
 * @param qty        how many (each) the line sells
 * @param finish     the finish picked (to be finished)
 * @param plated     the finish is plated / outsourced (the finish list's own word)
 * @param pole       the item is a pole or rod (a plated pole is made, not pulled)
 * @param kitParts   an item kit's parts as Shared/itemKit.itemKitOrderLinesOf gives them (erp, qty, finishCode …), or null
 */
export const entryStockAsksOf = ({ mode = 'STOCKED', code = '', qty = 1, finish = '', plated = false, pole = false, kitParts = null } = {}) => {
    const q = Math.max(1, N(qty) || 1);
    if (U(mode) === 'STOCKED') return U(code) ? [{ code: U(code), need: q }] : [];
    if (!plated || !U(finish)) return [];                       // painted: made on the floor, as today
    if (Array.isArray(kitParts) && kitParts.length) {
        const by = new Map();
        kitParts.forEach(p => {
            const c = p && p.finishCode ? `${U(p.erp)}/${U(p.finishCode)}` : U(p && p.erp);
            if (c) by.set(c, (by.get(c) || 0) + Math.max(1, N(p.qty) || 1));
        });
        return [...by.entries()].map(([c, need]) => ({ code: c, need }));
    }
    if (pole || !U(code)) return [];
    return [{ code: `${U(code)}/${U(finish)}`, need: q }];
};

/**
 * What the screen says for each ask, given the availability read (`map`: CODE → { available }). → [{ code, need, available,
 * covered, known, words }]. An item NetSuite does not list reads 0 available; a read that failed says so, never "short".
 */
export const entryStockLinesOf = (asks = [], map = null, { failed = false } = {}) => (asks || []).map(a => {
    if (failed || !map) return { ...a, available: null, covered: false, known: false, words: `${a.code} · stock could not be read — the order still checks it at save` };
    const available = Math.max(0, N(map[a.code] && map[a.code].available));
    const covered = available >= a.need;
    return {
        ...a, available, covered, known: true,
        words: covered
            ? `${a.code} · ${available} available — ${a.need} pulled from stock`
            : `${a.code} · ${available} available of ${a.need} — short ${a.need - available}: goes on the Backorder board (12.5)`,
    };
});
