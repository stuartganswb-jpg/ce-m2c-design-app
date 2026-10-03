// ── ONE RELEASE AT A TIME, WHEREVER IT IS PRESSED (Stuart 2026-10-02, after SO60585 Row 2) ─────────────
// Every open RTG tab runs its own ⚡ release engine, and each one only remembers its OWN tries. A tab looking at
// an old view of the board (Row 2's shop job at 12:55 — already released, completed and plated) released the
// same order again. The finishing doors checked "already dispatched" against that same old copy; on a stock
// order the second release could queue a second NetSuite work order (the outbox refuses a duplicate only while
// the first is still in flight).
//
// So a release CLAIMS the RTG record first, in a transaction that reads it fresh (Shared/floorRelease.claimRelease):
//   · refused when the record is gone, closed, deleted — or no longer Approved (already released), unless a
//     person confirmed a deliberate re-dispatch (the SO split's ↻ Re-dispatch, a finishing re-push past its
//     "already dispatched" warning);
//   · refused while another screen's claim is live (15 minutes — a tab closed mid-release frees it on its own);
//   · the door that holds the claim passes its token to the shared door it calls, so one release never blocks
//     itself; the release's own Dispatched write clears it, and a failure clears it so the order can be retried.
// Pure. Harness: scripts/releaseClaim.test.mjs.

export const RELEASE_CLAIM_TTL_MS = 15 * 60 * 1000;
const ENDED = ['Closed', 'Deleted', 'CANCELLED', 'Cancelled', 'Completed'];

/** The live claim on a record, or null (none, or older than the TTL). */
export const liveClaimOf = (rec, now = Date.now()) => {
    const c = rec && rec.releaseClaim;
    if (!c || !(Number(c.at) > 0)) return null;
    return now - Number(c.at) < RELEASE_CLAIM_TTL_MS ? c : null;
};

/** May this release claim the record? { ok, why } */
export function releaseClaimVerdict(rec, { now = Date.now(), redispatch = false, token = null } = {}) {
    if (!rec) return { ok: false, why: 'the RTG record is gone' };
    const st = String(rec.status || '');
    if (rec.deleted === true || ENDED.includes(st)) return { ok: false, why: `it is ${st || 'deleted'}` };
    const c = liveClaimOf(rec, now);
    if (c && (!token || c.token !== token)) {
        const mins = Math.max(0, Math.round((now - Number(c.at)) / 60000));
        return { ok: false, why: `${c.by || 'another screen'} is already releasing it (started ${mins} min ago)` };
    }
    if (!redispatch && st && st !== 'Approved') return { ok: false, why: `it is already ${st}` };
    return { ok: true, why: '' };
}

/** A token for one release. */
export const newClaimToken = (now = Date.now()) => `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** The line a door logs when it is refused. */
export const claimRefusedText = (id, why) => `🔒 ${id} not released — ${why}.`;
