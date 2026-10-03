// ── A NETSUITE BUILD THE FORCE-COMPLETE SKIPPED (Eric, App Imp 2026-10-02 · WO11639) ──────────────────
// "App posted the Scrap adjustment but did not post the assemble build. Does not show up as having attempted
//  to do so then failed; does not show up at all."
// WO11639 was force-completed on the finishing floor, and the floor asked "Is WO11639 ALREADY BUILT in NetSuite?
// OK = YES … the app posts NOTHING". OK was pressed, so the order was stamped forceCompleteNsBuildSkipped and
// nsCompletionQueued — the stamp the server's build trigger (functions onStockBuildDone) stands down for — and
// at put-away there was nothing to post but the scrap. Nothing failed, so nothing showed.
//
// Two rules, one place:
//   · the question: the NORMAL answer builds; skipping takes typing the work order's number (a reflex OK can no
//     longer post nothing);
//   · a skipped build SAYS so wherever the order shows (never "build queued…"). Posting it afterwards is RTG's
//     one repair — the order's card there carries "⚠ NS build never posted — 🔨 post now" — so no second
//     writer of the build lives anywhere else.
// Pure. Harness: scripts/skippedBuild.test.mjs.

const U = (v) => String(v == null ? '' : v).replace(/\s+/g, '').trim().toUpperCase();

/** Was this order's NetSuite build skipped at force-complete, and is it still not posted? */
export const buildSkippedAtForceComplete = (wo) => !!wo
    && wo.forceCompleteNsBuildSkipped === true && !!wo.nsWoId
    && !wo.nsWoCompletionPosted && !wo.nsWoCompletionTran && !wo.nsWoCompletionId;

/** The quantity a build posts — the server trigger's and RTG's own expression: the good count, else the order. */
export const buildQtyOf = (wo) => (Number(wo && wo.completedParts) > 0 ? Number(wo.completedParts) : (Number(wo && wo.totalParts) || 1));

/** The words a screen shows for a skipped build. */
export const SKIPPED_BUILD_TEXT = '⚠ NetSuite build SKIPPED at force-complete (marked already built)';

/** Where it gets posted if NetSuite was NOT in fact built. */
export const skippedBuildHint = (wo) => {
    const bin = String((wo && wo.putawayBin) || '').trim().toUpperCase();
    return `If NetSuite does NOT show ${(wo && (wo.nsWoTran || wo.nsWoId)) || 'the work order'} built: RTG → this order → "🔨 post now" builds ${buildQtyOf(wo)}${bin ? ` into ${bin}` : ''}.`;
};

/** The force-complete answer: skip the build only when the operator typed the work order's own number. */
export const typedAlreadyBuilt = (typed, wo) => {
    const t = U(typed);
    if (!t) return false;
    return [wo && wo.nsWoTran, wo && wo.nsWoId].filter(Boolean).map(U).includes(t);
};
