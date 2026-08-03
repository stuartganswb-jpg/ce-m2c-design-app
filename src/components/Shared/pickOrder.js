// THE PICK PATH (Stuart 2026-08-03: "especially when picking custom orders, can you sort the pick
// and group them together by like items … several of the same parts keep repeating and it is not
// very efficient to go back and forth for the same parts over and over").
//
// A custom order's BOM is written PER CONFIGURATION — one window's worth of parts, then the next
// window's, then the next. So a 28-line order is really 6 or 7 distinct items listed over and over,
// and the guided pick walked the operator back to the same bin a dozen times.
//
// TWO THINGS HAPPEN HERE, IN THIS ORDER:
//   1. MERGE  — lines for the same item code collapse into ONE line carrying the summed quantity.
//               The operator visits the bin once and counts once.
//   2. SORT   — the merged lines are ordered by BIN, so the walk runs the rack in order instead of
//               bouncing between aisles.
//
// WHY MERGING IS SAFE: the pick loop records nothing per line except skips and shorts, and both are
// keyed by item code and quantity — which a merged line reports MORE accurately (a short on a code
// split across three lines used to read as short on one of them). Quantities are summed, never
// dropped: `mergedFrom` carries the original line count so the screen can say so, and `sources`
// keeps the original lines for anything that needs to look back.
//
// WHAT IS NOT MERGED: lines whose item code is blank/PENDING/N/A. Two nameless lines are not
// provably the same part, so they stay separate and sort to the end.

const codeOf = (l) => String((l && (l.legacyErpId || l.partId)) || '').trim().toUpperCase();
const qtyOf = (l) => Number((l && (l.quantity ?? l.qty))) || 0;

// A code we can't trust to identify a part. Never merged on.
const UNMERGEABLE = new Set(['', 'PENDING', 'N/A', 'NA', '—', '-']);
export const isMergeableCode = (code) => !UNMERGEABLE.has(String(code || '').trim().toUpperCase());

// Bin sort key. Bins read like "M E5R-N18-R2": zone, aisle, then numbers. Plain string sort puts
// N18 before N6, so digit runs are zero-padded — the walk follows the rack, not the alphabet.
// UNASSIGNED (and anything blank) sorts LAST: the operator should clear the known bins first and
// deal with the unknowns at the end, not start the trip with one.
export function binSortKey(bin) {
    const b = String(bin || '').trim().toUpperCase();
    if (!b || b === 'UNASSIGNED') return '￿';
    return b.replace(/\d+/g, (d) => d.padStart(6, '0'));
}

// lines → merged, bin-sorted pick list.
//   binOf(line)  resolves the bin the same way the screen does (live stock → stamped → home bin).
// Deliberately pure: the caller passes the resolver, so this can be tested without Firestore,
// NetSuite or a browser — none of which are reachable from a test runner here.
export function groupPickLines(lines, { binOf } = {}) {
    const bin = typeof binOf === 'function' ? binOf : (l) => (l && l.binLocation) || '';
    const byCode = new Map();
    const out = [];

    (lines || []).forEach((l, i) => {
        const code = codeOf(l);
        if (!isMergeableCode(code)) { out.push({ ...l, mergedFrom: 1, sources: [l], _seq: i }); return; }
        const hit = byCode.get(code);
        if (!hit) {
            const entry = { ...l, quantity: qtyOf(l), mergedFrom: 1, sources: [l], _seq: i };
            delete entry.qty;               // one quantity field on the merged line, never two
            byCode.set(code, entry);
            out.push(entry);
            return;
        }
        hit.quantity += qtyOf(l);
        hit.mergedFrom += 1;
        hit.sources.push(l);
        // Keep the first line's bin stamp, but adopt one from a later line if the first had none.
        if (!hit.binLocation || hit.binLocation === 'UNASSIGNED') hit.binLocation = l.binLocation || hit.binLocation;
    });

    return out
        .map((l) => ({ ...l, _binKey: binSortKey(bin(l)) }))
        .sort((a, b) => (a._binKey < b._binKey ? -1 : a._binKey > b._binKey ? 1 : a._seq - b._seq))
        .map(({ _binKey, _seq, ...l }) => l);
}

// How much the grouping actually saved — shown on the card so the operator knows the list is
// shorter on purpose and nothing went missing.
export function groupingSummary(original, grouped) {
    const from = (original || []).length;
    const to = (grouped || []).length;
    const saved = from - to;
    return { from, to, saved, changed: saved > 0 };
}
