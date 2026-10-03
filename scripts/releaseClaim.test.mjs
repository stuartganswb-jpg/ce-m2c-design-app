// 🔒 One release at a time, wherever it is pressed (Stuart 2026-10-02).   node scripts/releaseClaim.test.mjs
import { releaseClaimVerdict, liveClaimOf, newClaimToken, claimRefusedText, RELEASE_CLAIM_TTL_MS } from '../src/components/Shared/releaseClaim.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));
const v = (rec, o) => releaseClaimVerdict(rec, { now: 1_000_000_000, ...o }).ok;

const parked = { id: 'WO-OE-SO60585-7242-C', status: 'Approved' };
eq('a parked record may be released', v(parked), true);
// SO60585 Row 2 at 12:55: the record was already Dispatched; the tab's old view still said Approved.
eq('a record already released is refused — whatever the tab\'s own copy says', v({ ...parked, status: 'Dispatched' }), false);
eq('…the words', releaseClaimVerdict({ ...parked, status: 'Dispatched' }).why, 'it is already Dispatched');
eq('…unless a person confirmed a deliberate re-dispatch', v({ ...parked, status: 'Dispatched' }, { redispatch: true }), true);
eq('closed / deleted / gone are refused even on a re-dispatch', [v({ status: 'Closed' }, { redispatch: true }), v({ status: 'Deleted' }, { redispatch: true }), v({ status: 'Approved', deleted: true }), v(null)], [false, false, false, false]);
eq('a record with no status (legacy) may be released', v({ id: 'X' }), true);

// ── another screen is releasing it ──────────────────────────────────────────────────────────
const now = 1_000_000_000;
const claimed = { ...parked, releaseClaim: { by: 'Vicki Vanderpool', at: now - 2 * 60000, token: 'vicki-1' } };
eq('another screen\'s live claim refuses', v(claimed), false);
eq('…and says who, and when', releaseClaimVerdict(claimed, { now }).why, 'Vicki Vanderpool is already releasing it (started 2 min ago)');
eq('…a re-dispatch waits for it too', v(claimed, { redispatch: true }), false);
eq('the release that holds the claim passes its token down — it never blocks itself', v(claimed, { token: 'vicki-1' }), true);
eq('a different token is refused', v(claimed, { token: 'eric-9' }), false);
eq('a claim older than 15 minutes has expired (a tab closed mid-release frees it)', [v({ ...parked, releaseClaim: { by: 'V', at: now - RELEASE_CLAIM_TTL_MS - 1, token: 't' } }), liveClaimOf({ releaseClaim: { at: now - RELEASE_CLAIM_TTL_MS - 1 } }, now)], [true, null]);
eq('a claim with no time is no claim', liveClaimOf({ releaseClaim: { by: 'V' } }, now), null);

ok('tokens differ', newClaimToken(5) !== newClaimToken(5));
eq('the refusal line', claimRefusedText('WO-OE-SO60585-7242-C', 'it is already Dispatched'), '🔒 WO-OE-SO60585-7242-C not released — it is already Dispatched.');

console.log(`releaseClaim: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
