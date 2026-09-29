// THE SPIN MACHINE RUNS IN LOADS (Stuart 2026-09-29): "when the order is say 420pcs and they set up
// 140pcs at a time, they go thru all finishing steps for the first batch of 140 before starting the next
// batch of 140 and then go thru all the steps again … give them the ability to enter how many per batch
// (batch being all steps in recipe)" — "sometimes it is expected to fit 70 but only 35 fit".
//
// A LOAD is the small parts on the machine for one pass of the WHOLE recipe. The job loops the recipe
// once per load. The crew types the load size, any time during the load; nobody typing means everything
// remaining in one load — how every job ran before this. Only the small-parts stream on the spin machine
// runs in loads: the booth, the poles and the hand bench run their quantity once, as before. A job moved
// to the booth part-way runs its remaining pieces in one pass.
//
// On the finishing document (fin_workorders):
//   spinLoadQty   the pieces on the machine for THIS load, as typed (absent = all that is left)
//   spinLoads     [{ n, qty, doneAt, by }] — every load that has been through the whole recipe
// The QC count and the job's completion come once, after the last load, for the full quantity (the
// floor's final-coat gate, unchanged). RTG, the WMS pack and NetSuite hear of it once, at the end.
//
// Pure. ActiveFloor asks spinLoadRollover at the last coat of the parts stream.

import { woHasPoles, woHasSmallParts, sprayStationOf, SPRAY_STATIONS } from './floorActivity.js';

const N = (v) => Math.max(0, Math.floor(Number(v) || 0));

// The small parts on the document — its pieces less its poles (the count the floor's rows show).
export function smallPartsTotalOf(wo) {
    if (!wo) return 0;
    const total = N(wo.totalParts);
    if (!woHasPoles(wo)) return total;
    const poles = N(wo.totalPoles || (wo.poles && wo.poles.qty));
    return poles ? Math.max(0, total - poles) : total;
}

// Loads apply to the small-parts stream on the spin machine, and only when there are pieces to load.
export const runsInLoads = (wo) => !!wo && sprayStationOf(wo) === SPRAY_STATIONS.SPIN && woHasSmallParts(wo) && smallPartsTotalOf(wo) > 0;

// → { total, done, remaining, n (this load, 1-based), qty (this load's pieces), typed, last, loads }
export function spinLoadsOf(wo) {
    const total = smallPartsTotalOf(wo);
    const loads = Array.isArray(wo && wo.spinLoads) ? wo.spinLoads : [];
    const done = loads.reduce((a, l) => a + N(l && l.qty), 0);
    const remaining = Math.max(0, total - done);
    const typedQty = N(wo && wo.spinLoadQty);
    const qty = typedQty > 0 ? Math.min(typedQty, remaining) : remaining;
    return { total, done, remaining, n: loads.length + 1, qty, typed: typedQty > 0, last: qty >= remaining, loads };
}

// Is the typed size a load this job can take? → the reason it cannot, or null.
export function spinLoadQtyError(wo, value) {
    const s = spinLoadsOf(wo);
    const raw = String(value == null ? '' : value).trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return 'Type how many pieces are on the machine for this load — a whole number, 1 or more.';
    if (Number(raw) > s.remaining) return `Only ${s.remaining} of ${s.total} are left to run — a load cannot be bigger than that.`;
    return null;
}

// THE END OF A PASS. At the last coat of the parts stream: does another load follow?
//   → null: this was the last load (or the job does not run in loads) — the job finishes as before.
//   → { record, loads, nextQty, after, n }: the recipe loops — record this load, start the next at coat 1.
// The next load keeps the size just run (capped at what is left), so a steady 140 needs typing once.
export function spinLoadRollover(wo, { by = '', at = Date.now() } = {}) {
    if (!runsInLoads(wo)) return null;
    const s = spinLoadsOf(wo);
    if (s.last || s.qty <= 0) return null;
    const record = { n: s.n, qty: s.qty, doneAt: at, by: by || '' };
    const after = s.remaining - s.qty;
    return { record, loads: [...s.loads, record], nextQty: Math.min(s.qty, after), after, n: s.n };
}

// The last load's record — written with the completion, so the history lists every load run.
export function spinFinalLoadRecord(wo, { by = '', at = Date.now() } = {}) {
    if (!runsInLoads(wo)) return null;
    const s = spinLoadsOf(wo);
    if (s.qty <= 0) return null;
    const record = { n: s.n, qty: s.qty, doneAt: at, by: by || '' };
    return { record, loads: [...s.loads, record] };
}
