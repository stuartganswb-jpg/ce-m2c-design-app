// Harness for Shared/quoteDisplay's document helpers (close-out item 6, S1 2026-09-12): the date on
// the paper is the day it was saved (not UTC's evening before), "No Sidemark" is not a sidemark,
// and the order sidemark is the typed one.
//
//   node scripts/quoteDisplayDoc.test.mjs

import { docDateOf, cleanSidemark, orderSidemarkOf, quoteDisplayNo } from '../src/components/Shared/quoteDisplay.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };

// ── the date ─────────────────────────────────────────────────────────────────────────────────
const local = (y, m, d) => new Date(y, m - 1, d).toLocaleDateString();
eq('a bare YYYY-MM-DD is THAT calendar day, whatever the zone', docDateOf({ dateSaved: '2026-09-10' }), local(2026, 9, 10));
// the naive parse this replaces printed the evening before in any zone west of UTC — shown here, not assumed
eq('the naive new Date("YYYY-MM-DD") WAS the day before west of UTC (the trap this closes)', new Date().getTimezoneOffset() > 0 ? new Date('2026-09-10').toLocaleDateString() !== local(2026, 9, 10) : true, true);
eq('an ISO stamp is a moment', docDateOf({ dateSaved: '2026-08-05T20:00:58.578Z' }), new Date('2026-08-05T20:00:58.578Z').toLocaleDateString());
eq('no dateSaved: the Firestore createdAt (seconds)', docDateOf({ createdAt: { seconds: 1789000000 } }), new Date(1789000000000).toLocaleDateString());
eq('no dateSaved: a Timestamp with toMillis', docDateOf({ createdAt: { toMillis: () => 1789000000000 } }), new Date(1789000000000).toLocaleDateString());
eq('nothing at all: today', docDateOf({}, new Date(2026, 8, 12)), local(2026, 9, 12));
eq('garbage prints as given', docDateOf({ dateSaved: 'soon' }), 'soon');

// ── the sidemark ─────────────────────────────────────────────────────────────────────────────
eq('"No Sidemark" reads as blank', [cleanSidemark('No Sidemark'), cleanSidemark(' no sidemark '), cleanSidemark(''), cleanSidemark(null)], ['', '', '', '']);
eq('a real sidemark is kept, trimmed', cleanSidemark('  Formal Living 1 '), 'Formal Living 1');
eq('order sidemark: the typed one wins', orderSidemarkOf({ orderSidemark: 'HP Market', sidemark: 'Smith', jobName: 'Smith' }), 'HP Market');
eq('order sidemark: legacy sidemark unless it is the job-name fallback', [orderSidemarkOf({ sidemark: 'Living Room', jobName: 'Smith' }), orderSidemarkOf({ sidemark: 'Smith', jobName: 'Smith' }), orderSidemarkOf({ sidemark: 'Multi-Room Project' })], ['Living Room', '', '']);
eq('order sidemark: the placeholder is blank too', orderSidemarkOf({ sidemark: 'No Sidemark', jobName: 'X' }), '');

// ── the number the paper carries (unchanged rule, stated) ───────────────────────────────────
eq('QUO147 beats the doc id', quoteDisplayNo({ id: 'QUOTE-1789001561704', jobId: 'QUOTE-1789001561704', quoteNo: 'ST090926-09', netsuiteEstimateNo: 'QUO147' }), 'QUO147');
eq('the short number beats the doc id', quoteDisplayNo({ id: 'QUOTE-1789001561704', quoteNo: 'ST090926-09' }), 'ST090926-09');

console.log(`\nquoteDisplayDoc: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
