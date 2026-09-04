// Committed order bins, offline.
//   node scripts/committedBins.test.mjs
//
// Brief D, 2026-09-03. These bins exist to stop pieces reaching the wrong customer, so the
// refusals are the feature and this pins them. If a rule change breaks a row here, the change is
// wrong — unless Stuart changed the rule.

import {
    upBin, committedBinOf, committedQtyOf, binConflict,
    planCommit, planRelease, totalGathered, nextBinFor, lineGathering,
    planAllocation, allocationSummary,
} from '../src/components/Shared/committedBins.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};

const isOpen = (o) => !['Shipped', 'Closed'].includes(String(o.status || ''));

// ── normalising ───────────────────────────────────────────────────────────────────────────────
eq('bin is upper-cased and space-collapsed', upBin('  co  1a '), 'CO 1A');
eq('no bin reads empty', committedBinOf({}), '');
eq('qty of an unknown code is 0', committedQtyOf({ committedQty: { A: 3 } }, 'B'), 0);
eq('qty is case-insensitive', committedQtyOf({ committedQty: { 'H1-138BS': 4 } }, 'h1-138bs'), 4);

// ── the one rule: a bin belongs to one OPEN order ─────────────────────────────────────────────
const orders = [
    { id: 'SO-1', soId: 'QS-1', committedBin: 'CO 1', status: 'Pending' },
    { id: 'SO-2', soId: 'QS-2', committedBin: 'CO 2', status: 'Shipped' },
];
ok('a bin held by another OPEN order conflicts', !!binConflict('CO 1', orders, 'SO-9', isOpen));
ok('a bin held by a SHIPPED order is free again', !binConflict('CO 2', orders, 'SO-9', isOpen));
ok('my own bin is not a conflict with myself', !binConflict('CO 1', orders, 'SO-1', isOpen));
ok('a blank bin conflicts with nothing', !binConflict('', orders, 'SO-9', isOpen));

// ── committing ────────────────────────────────────────────────────────────────────────────────
const fresh = { id: 'SO-9', committedQty: {} };
let r = planCommit({ order: fresh, code: 'h1-138bs', qty: 6, bin: 'co 3', ordered: 12, orders, isOpen });
ok('first commit is allowed and takes the bin', r.ok && r.bin === 'CO 3' && r.wasFirst);
eq('first commit totals correctly', r.total, 6);

const partly = { id: 'SO-9', committedBin: 'CO 3', committedQty: { 'H1-138BS': 6 } };
r = planCommit({ order: partly, code: 'H1-138BS', qty: 6, ordered: 12, orders, isOpen });
ok('later commits need no bin — they inherit the order\'s', r.ok && r.bin === 'CO 3' && !r.wasFirst);
eq('later commit accumulates', r.total, 12);

r = planCommit({ order: partly, code: 'H1-138BS', qty: 7, ordered: 12, orders, isOpen });
ok('over-committing past the ordered qty is REFUSED', !r.ok);
ok('and says how many are already gathered', /6 already gathered/.test(r.reason));

r = planCommit({ order: partly, code: 'H1-138BS', qty: 1, ordered: 0, orders, isOpen });
ok('ordered:0 skips the over-commit check rather than pretending it passed', r.ok);

r = planCommit({ order: fresh, code: 'X', qty: 1, bin: 'CO 1', ordered: 5, orders, isOpen });
ok('a bin already holding another open order is REFUSED', !r.ok);
ok('and names the order holding it', /QS-1/.test(r.reason));

r = planCommit({ order: partly, code: 'H1-138BS', qty: 1, bin: 'CO 8', ordered: 12, orders, isOpen });
ok('moving a part-full order to a new bin is REFUSED', !r.ok);
ok('and points at release as the way to move it', /release/i.test(r.reason));

r = planCommit({ order: fresh, code: 'A', qty: 1, ordered: 5, orders, isOpen });
ok('a first commit with no bin is refused, not silently binned', !r.ok && /scan the committed bin/.test(r.reason));
ok('zero quantity is refused', !planCommit({ order: fresh, code: 'A', qty: 0, bin: 'CO 4', orders, isOpen }).ok);
ok('a blank code is refused', !planCommit({ order: fresh, code: '', qty: 1, bin: 'CO 4', orders, isOpen }).ok);

// ── releasing — partial is the normal case ────────────────────────────────────────────────────
const two = { id: 'SO-9', committedBin: 'CO 3', committedQty: { A: 10, B: 4 } };
r = planRelease({ order: two, code: 'A', qty: 4 });
ok('a partial release is allowed', r.ok);
eq('and leaves the remainder gathered', r.left, 6);
ok('the bin is not empty while another code is still in it', !r.emptyAfter);

r = planRelease({ order: { id: 'S', committedQty: { A: 4 } }, code: 'A', qty: 4 });
ok('releasing the last of the last code empties the bin', r.ok && r.emptyAfter);
ok('releasing more than is gathered is refused', !planRelease({ order: two, code: 'A', qty: 11 }).ok);
ok('releasing a code that is not gathered is refused', !planRelease({ order: two, code: 'ZZ', qty: 1 }).ok);

// ── the card's arithmetic ─────────────────────────────────────────────────────────────────────
eq('total gathered sums every code', totalGathered(two), 14);
eq('next bin is the order\'s bin', nextBinFor(two), 'CO 3');
eq('an order with no bin has no next bin', nextBinFor({}), '');
eq('line gathering, part way', lineGathering({ order: two, code: 'A', ordered: 12 }), { gathered: 10, ordered: 12, outstanding: 2, complete: false });
eq('line gathering, complete', lineGathering({ order: two, code: 'B', ordered: 4 }), { gathered: 4, ordered: 4, outstanding: 0, complete: true });
eq('a line ordering nothing is never complete', lineGathering({ order: two, code: 'A', ordered: 0 }).complete, false);

// ── the arrival alert: who is waiting, oldest need first ──────────────────────────────────────
const demands = [
    { orderId: 'B', ref: 'QS-B', ordered: 10, gathered: 0, needBy: '2026-10-01', createdAt: 200 },
    { orderId: 'A', ref: 'QS-A', ordered: 6, gathered: 2, needBy: '2026-09-20', createdAt: 100 },
    { orderId: 'C', ref: 'QS-C', ordered: 5, gathered: 5, needBy: '2026-09-01', createdAt: 50 },
];
let p = planAllocation({ qty: 20, demands });
eq('oldest NEED is served first, and a fully-gathered order does not queue',
    p.allocations, [{ orderId: 'A', ref: 'QS-A', qty: 4, outstanding: 4 }, { orderId: 'B', ref: 'QS-B', qty: 10, outstanding: 10 }]);
eq('the remainder goes to stock', p.toStock, 6);
eq('demand total counts only what is outstanding', p.demandTotal, 14);
eq('nothing is short when the arrival covers it', p.shortfall, 0);

p = planAllocation({ qty: 6, demands });
eq('a short arrival fills the oldest first and stops', p.allocations, [{ orderId: 'A', ref: 'QS-A', qty: 4, outstanding: 4 }, { orderId: 'B', ref: 'QS-B', qty: 2, outstanding: 10 }]);
eq('nothing is left for stock when orders are short', p.toStock, 0);
eq('and the shortfall is reported', p.shortfall, 8);

p = planAllocation({ qty: 5, demands: [] });
eq('no claimants sends it all to stock', [p.allocations.length, p.toStock], [0, 5]);
eq('an order with no need-by sorts after one that has a date',
    planAllocation({ qty: 1, demands: [{ orderId: 'X', ordered: 1, gathered: 0, createdAt: 1 }, { orderId: 'Y', ordered: 1, gathered: 0, needBy: '2026-12-01', createdAt: 9 }] }).allocations[0].orderId, 'Y');
eq('zero arriving allocates nothing', planAllocation({ qty: 0, demands }).allocations.length, 0);
ok('the summary names the orders', /QS-A/.test(allocationSummary(planAllocation({ qty: 20, demands }), 'h1-1')));
ok('the summary says so when nobody is waiting', /no open order/.test(allocationSummary(planAllocation({ qty: 3, demands: [] }), 'h1-1')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
