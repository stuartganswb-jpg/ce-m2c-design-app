// "Where is it?" shows OPEN work only (Stuart 2026-09-16).   node scripts/whereIsIt.test.mjs
import { openForSearch, openExtraForSearch } from '../src/components/Shared/orderLifecycle.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── ORDERS: still working = still findable ────────────────────────────────────────────────────
ok('a job in Setup is open', openForSearch({ id: 'A', currentPhase: 'Setup' }));
ok('a job being painted is open', openForSearch({ id: 'B', currentPhase: 'Painting', stepStatus: 'Running' }));
ok('a board record awaiting dispatch is open', openForSearch({ id: 'C', status: 'Approved' }));
ok('a dispatched sales order is open', openForSearch({ id: 'D', status: 'Dispatched' }));

// COMPLETE IS NOT DONE (Stuart 2026-09-10) — the WMS still has to pick, pack and put it away.
ok('off the paint line but not packed is STILL OPEN', openForSearch({ id: 'E', currentPhase: 'Complete' }));
ok('a pick-only doc, born Complete, is STILL OPEN', openForSearch({ id: 'F', currentPhase: 'Complete', pickOnly: true, stepStatus: 'Complete' }));
ok('a floor that reported Complete is STILL OPEN', openForSearch({ id: 'G', floorPhase: 'Complete' }));

// ── ORDERS: finished = gone ───────────────────────────────────────────────────────────────────
ok('packed is not open', !openForSearch({ id: 'H', packStatus: 'Packed' }));
ok('put away on the shelf is not open', !openForSearch({ id: 'I', floorPhase: 'Shelved' }));
ok('the floor reported Packed is not open', !openForSearch({ id: 'J', floorPhase: 'Packed' }));
ok('shipped is not open', !openForSearch({ id: 'K', currentPhase: 'Complete', shippedAt: 1789500000000 }));
ok('a closed phase is not open', !openForSearch({ id: 'L', currentPhase: 'Closed' }));
ok('closed:true is not open', !openForSearch({ id: 'M', closed: true }));
ok('status Closed is not open', !openForSearch({ id: 'N', status: 'Closed' }));
ok('a completed shop half is not open', !openForSearch({ id: 'O', status: 'Completed' }));
ok('a built stock order is not open', !openForSearch({ id: 'P', status: 'Built' }));
ok('cancelled is not open', !openForSearch({ id: 'Q', status: 'CANCELLED' }));
ok('soft-deleted is not open', !openForSearch({ id: 'R', deleted: true }));
ok('nothing is not open', !openForSearch(null));

// ── PURCHASE ORDERS: open until received, closed or deleted (Shared/poLock owns the rule) ─────
ok('a PO sent to the vendor is open', openExtraForSearch({ __kind: 'PO', status: 'Sent to Vendor' }));
ok('a PARTIALLY received PO is open — it is the one people chase', openExtraForSearch({ __kind: 'PO', status: 'Partially Received' }));
ok('a draft PO is open', openExtraForSearch({ __kind: 'PO', status: 'Draft' }));
ok('a PO sent to the plater is open', openExtraForSearch({ __kind: 'PO', status: 'Sent to Plater' }));
ok('a fully received PO is NOT open', !openExtraForSearch({ __kind: 'PO', status: 'Received' }));
ok('a closed PO is NOT open', !openExtraForSearch({ __kind: 'PO', status: 'Closed' }));
ok('a deleted PO is NOT open', !openExtraForSearch({ __kind: 'PO', status: 'Deleted' }));
ok('a soft-deleted PO is NOT open', !openExtraForSearch({ __kind: 'PO', status: 'Sent to Vendor', deleted: true }));

// ── ROD CUTS + DEMANDS ────────────────────────────────────────────────────────────────────────
ok('an OPEN rod cut is open', openExtraForSearch({ __kind: 'RODCUT', status: 'OPEN' }));
ok('a cut rod cut is NOT open', !openExtraForSearch({ __kind: 'RODCUT', status: 'DONE' }));
ok('a cancelled rod cut is NOT open', !openExtraForSearch({ __kind: 'RODCUT', status: 'CANCELLED' }));
// The WMS DELETES a demand when the pull posts, so one still on screen is live unless cancelled.
ok('a convert demand is open while it exists', openExtraForSearch({ __kind: 'CONVERT', status: 'open' }));
ok('a demand on the cart is open', openExtraForSearch({ __kind: 'CONVERT', status: 'on_cart' }));
ok('a plating demand with no status is open', openExtraForSearch({ __kind: 'PLATING' }));
ok('a cancelled demand is NOT open', !openExtraForSearch({ __kind: 'PLATING', status: 'CANCELLED' }));
ok('nothing is not an open extra', !openExtraForSearch(null));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
