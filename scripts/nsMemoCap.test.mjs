// node scripts/nsMemoCap.test.mjs — the queue's memo on a record whose memo field is short, and the
// one-run-at-a-time latch (Eric, App Imp 2026-09-19: PO2128's bin move + the twin receipt).
import { memoCapFor, cappedMemo } from '../src/components/Shared/nsMemoCap.js';
import { onceAtATime } from '../src/components/Shared/onceAtATime.js';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) pass++; else { fail++; console.log(`✗ ${n} ${x}`); } };
const BT = 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/binTransfer';
ok('a bin transfer is capped at 40', memoCapFor(BT) === 40 && memoCapFor(BT.toLowerCase()) === 40);
ok('a receipt and an adjustment are not', memoCapFor('https://x/services/rest/record/v1/purchaseorder/1/!transform/itemreceipt') === 0 && memoCapFor('https://x/services/rest/record/v1/inventoryadjustment') === 0);
const live = cappedMemo('PO PO2128 received to COMP-005, put awa…', 'NEHxScABCDEF', 40);
ok('the memo that failed now fits', live.length <= 40, live);
ok('…and still carries what crash recovery searches for', /#NEHxSc\]$/.test(live), live);
ok('a short memo is kept whole', cappedMemo('Bin move', 'abcdef123', 40) === 'Bin move [#abcdef]');
ok('no memo → the tag alone', cappedMemo('', 'abcdef123', 40) === '[#abcdef]' && cappedMemo(undefined, 'abcdef123', 40) === '[#abcdef]');
ok('never over the cap, whatever comes in', [10, 31, 32, 33, 200].every(n => cappedMemo('x'.repeat(n), 'abcdef', 40).length <= 40));

// the latch
const latch = { current: false }; let runs = 0; let release;
const slow = onceAtATime(latch, async () => { runs++; await new Promise(r => { release = r; }); return 'done'; });
const first = slow(); const second = slow();
ok('a second call while the first is in flight does nothing', (await second) === undefined && runs === 1);
release(); ok('the first finishes', (await first) === 'done' && latch.current === false);
const again = slow(); release(); await again;
ok('…and the next run is allowed', runs === 2);
const boom = onceAtATime(latch, async () => { throw new Error('x'); });
await boom().catch(() => {}); ok('a failed run releases the latch', latch.current === false);
console.log(`nsMemoCap: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
