// ── IS THIS PAINT RUN ALREADY ON ORDER? (Stuart 2026-09-26) ──────────────────────────────────
// "we have quite a few JFP items, since they are not actually showing on order in netsuite, i
//  could see a very easy chance that these get put into production accidentally more than once.
//  before a work order is created for a jfp item, it goes out and searches if the exact same item
//  is already on order."
//
// A paint run (Just For Paint or Repaint) has no NetSuite work order, so NetSuite's "on order"
// column cannot warn anyone. The RTG record is the only ledger of them — so the search is against
// the RTG records: every paint-only run for the SAME item code that has not been closed. The
// writer (Shared/repaintRun.raisePaintRun) asks this before it writes; the door shows what is
// found and asks whether a second run is deliberate. Pure; scripts/paintRunGuard.test.mjs asserts.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();

/** Closed, deleted or otherwise off the ledger — not "on order" any more. */
export const runIsClosed = (d) => !!d && (
    d.deleted === true || !!d.closedAt || d.status === 'Closed' || d.currentPhase === 'Closed' || d.floorPhase === 'Closed'
);

/** Where the run is, in the floor's own words when it has reported, else the board's. */
export const runPhaseOf = (d) => String((d && (d.floorPhase || d.status)) || 'Dispatched');

/**
 * The open paint runs for exactly this item code, oldest first.
 * @param docs  RTG records (hq_work_orders), any mix — only paint-only runs of the code count.
 */
export const openPaintRunsOf = (docs = [], targetCode) => {
    const code = U(targetCode);
    if (!code) return [];
    return (docs || [])
        .filter(d => d && d.paintOnly === true && U(d.jfpItemCode) === code && !runIsClosed(d))
        .map(d => ({
            woId: String(d.id || d.woId || ''),
            qty: Math.max(0, Number(d.totalParts) || 0),
            phase: runPhaseOf(d),
            runType: String(d.type || (d.repaint ? 'Repaint' : 'Just For Paint')),
            pullFrom: String(d.jfpPullFrom || d.repaintFrom || ''),
            by: String(d.dispatchedBy || d.createdBy || ''),
            createdAt: Number(d.createdAt) || 0,
            duplicateOf: Array.isArray(d.duplicateOf) ? d.duplicateOf.slice() : [],
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
};

const dateOf = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—');

/** One line per open run, for the door's prompt and for RTG. */
export const runLine = (r) =>
    `${r.woId} · ${r.qty} pcs · ${r.phase}${r.pullFrom ? ` · pulls ${r.pullFrom}` : ''} · ${r.by || '—'} ${dateOf(r.createdAt)}${r.duplicateOf.length ? ' · itself a confirmed 2nd run' : ''}`;

/** The question the door asks. Empty when there is nothing to ask. */
export const duplicateRunText = (targetCode, runs = [], qty = 0) => {
    if (!runs.length) return '';
    const code = U(targetCode);
    const onOrder = runs.reduce((a, r) => a + r.qty, 0);
    return `⚠ ${code} is ALREADY ON ORDER — ${runs.length} open paint run${runs.length === 1 ? '' : 's'}, ${onOrder} pcs, that NetSuite does not show:\n\n`
        + runs.map(r => `   ${runLine(r)}`).join('\n')
        + `\n\nIs this a deliberate second run of ${qty || '?'} pcs (a short first run, a different colour pull, a new need)?\n\nOK creates it, marked as a confirmed 2nd run of the above. Cancel creates nothing.`;
};

/** What a confirmed second run carries, so RTG can see it was on purpose. */
export const duplicateStamp = (runs = [], by = '', now = Date.now()) => (
    runs.length ? { duplicateOf: runs.map(r => r.woId), duplicateConfirmedBy: by || '', duplicateConfirmedAt: now } : {}
);
