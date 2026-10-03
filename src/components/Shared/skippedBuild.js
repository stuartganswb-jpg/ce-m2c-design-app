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
    const ref = (wo && (wo.nsWoTran || wo.nsWoId)) || 'the work order';
    return `If NetSuite does NOT show ${ref} built: RTG → this order → "🔨 post only if NetSuite shows none", type ${ref} — it builds ${buildQtyOf(wo)}${bin ? ` into ${bin}` : ''}.`;
};

/** Did the operator type the work order's own number? (Force-complete's skip; RTG's post over an "already built".) */
export const typedWoNumber = (typed, wo) => {
    const t = U(typed);
    if (!t) return false;
    return [wo && wo.nsWoTran, wo && wo.nsWoId].filter(Boolean).map(U).includes(t);
};

// ── RTG'S "🔨 POST NOW" (Stuart 2026-10-02) ────────────────────────────────────────────────────────────────
// The repair for a packed job whose NetSuite build never posted. It used to read only `orderType 'stock'` and
// say "never posted" on every one — including the jobs a person had marked ALREADY BUILT at force-complete
// (seven packed stock jobs on 10/2: WO11639 plus six from August, built by hand in NetSuite), where a press
// builds twice. And it never offered an Order Entry sales job with an anchor work order, which the server
// builds too (WO11578, force-completed 10/1, its build switched off with nobody asked).
//   · a job marked already built says so, and posting it takes typing the WO number;
//   · an Order Entry sales job with an anchor WO is offered, posted as the server posts it (no bin unless one
//     was scanned, the sales memo);
//   · posting clears the skip stamp, so the "build SKIPPED" labels clear.

/** A packed job the server builds whose build never posted — or null. */
export const buildRepairOf = (fin) => {
    if (!fin || !fin.nsWoId || !['stock', 'sales'].includes(String(fin.orderType || ''))) return null;
    if (fin.packStatus !== 'Packed') return null;
    if (fin.nsWoCompletionPosted || fin.nsWoCompletionTran || fin.nsWoCompletionId) return null;
    const sales = fin.orderType === 'sales';
    return {
        ref: fin.nsWoTran || fin.nsWoId, qty: buildQtyOf(fin), sales,
        bin: String(fin.putawayBin || '').trim().toUpperCase(),
        markedBuilt: fin.forceCompleteNsBuildSkipped === true,
        builds: String((sales && fin.nsWoOnErp) || fin.stockErpId || fin.id || ''),
    };
};

/** The button's words. */
export const buildRepairLabel = (r) => (r && r.markedBuilt
    ? '⚠ Marked ALREADY BUILT at force-complete — 🔨 post only if NetSuite shows none'
    : '⚠ NS build never posted — 🔨 post now');

/** The outbox entry's label and memo — the server trigger's own wording, marked as posted from RTG. */
export const buildRepairTexts = (fin, r) => ({
    label: `Build NS WO ${r.ref} — ${r.builds}${r.sales && fin.nsWoOnErp ? ' (base assembly)' : ''} ×${r.qty}${r.sales ? ' · SALES' : ''}`,
    memo: r.sales
        ? `SO build ${fin.id} packed${r.bin ? ` ${r.bin}` : ''} — posted from RTG (auto build never fired)`
        : `Stock build ${fin.id} put away${r.bin ? ` ${r.bin}` : ''} — posted from RTG (auto build never fired)`,
});

/** What the job is stamped with once RTG queues the build. */
export const buildRepairStamp = (r, { by = '', now = Date.now() } = {}) => ({
    nsCompletionQueued: true,
    ...(r && r.markedBuilt ? { forceCompleteNsBuildSkipped: false } : {}),
    nsBuildPostedFromRtgBy: by, nsBuildPostedFromRtgAt: now,
});
