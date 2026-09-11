// ── HAND-ADDED EXTRAS, RESTORED WITHOUT MULTIPLYING (Stuart 2026-09-11, S1: "QUO147 has one
//    splice entered on cpq but shows 3") ─────────────────────────────────────────────────────────
//
// The loop that did it: a saved line carried no record of its hand-added extras, so a reopen
// rebuilt them from the breakdown rows flagged addedByHand — rows that name the part by its
// library DOC ID (partId), while the length step knows the joiner by its tab-11 CODE. The step
// looked for the code, did not find it under that name, and auto-added one more; the panel showed
// the first row (one), the line billed both. Re-save, reopen: three. Every cycle added one.
//
// Two pure rules close it, and the handoff now saves `engineConfig.extras` as typed:
//   extrasFromSavedItem  — the exact saved extras when the line carries them; otherwise the
//                          addedByHand rows under OUR part number (legacyErpId), merged one row
//                          per item (+ slot) with the quantities summed — a legacy triple reopens
//                          as ONE row of 3, which the operator sets to 1 once.
//   normalizeExtras      — inside the configurator, every restored row is re-keyed to the code the
//                          flow's add-by-hand list uses for that same part (by identity), and
//                          duplicates merge — so no comparison downstream can miss its twin again.

const str = (v) => String(v == null ? '' : v).trim();
const up = (v) => str(v).toUpperCase();

/** Merge rows that name the same code (+ slot): one row, quantities summed, first note kept. */
export function mergeExtras(rows = []) {
    const out = [];
    (rows || []).forEach(r => {
        if (!r || !str(r.code)) return;
        const slot = str(r.slot);
        const i = out.findIndex(o => up(o.code) === up(r.code) && str(o.slot) === slot);
        const qty = Number(r.qty) > 0 ? Number(r.qty) : 1;
        if (i < 0) out.push({ code: str(r.code), qty: String(qty), note: str(r.note), ...(slot ? { slot } : {}) });
        else {
            out[i] = { ...out[i], qty: String((Number(out[i].qty) || 0) + qty), note: out[i].note || str(r.note) };
        }
    });
    return out;
}

/** What a cart item's extras are, for a reopen: the saved list when it carries one, else the rows. */
export function extrasFromSavedItem(item) {
    const saved = item && item.engineConfig && Array.isArray(item.engineConfig.extras) ? item.engineConfig.extras.filter(x => x && str(x.code)) : [];
    if (saved.length) return saved.map(x => ({ code: str(x.code), qty: String(Number(x.qty) > 0 ? Number(x.qty) : 1), note: str(x.note), ...(str(x.slot) ? { slot: str(x.slot) } : {}) }));
    const rows = ((item && item.pricingBreakdown) || []).filter(l => l && l.addedByHand)
        .map(l => ({ code: l.legacyErpId || l.partId, qty: l.qty, note: l.customNote || '', ...(l.slot ? { slot: l.slot } : {}) }));
    return mergeExtras(rows);
}

/**
 * Re-key restored rows to the flow's own code for the same part (identity through findPart —
 * doc id, item id or our number all resolve to one library doc), then merge duplicates.
 *   extraItems  the flow's add-by-hand list [{ code, … }]
 *   findPart    (code) → library part | null
 */
export function normalizeExtras(extras = [], extraItems = [], findPart = () => null) {
    const idOf = (code) => { const p = findPart ? findPart(code) : null; return p && p.id ? String(p.id) : ''; };
    const flowCodeFor = (code) => {
        const direct = (extraItems || []).find(it => it && up(it.code) === up(code));
        if (direct) return direct.code;
        const id = idOf(code);
        if (!id) return code;
        const byId = (extraItems || []).find(it => it && idOf(it.code) === id);
        return byId ? byId.code : code;
    };
    return mergeExtras((extras || []).filter(x => x && str(x.code)).map(x => ({ ...x, code: flowCodeFor(x.code) })));
}
