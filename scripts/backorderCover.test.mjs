// The receipt-side lift, offline.   node scripts/backorderCover.test.mjs
import { allocateArrival, lineCoverCodes, openBackorders } from '../src/components/Shared/backorderCover.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const so = (id, lines, extra = {}) => ({ id, soId: id.replace('so-', 'SO'), backorderLines: lines, ...extra });
const L = (code, qty, since, extra = {}) => ({ code, qty, wanted: qty, coverCodes: [code], since, ...extra });

eq('cover codes: the record wins', lineCoverCodes({ code: 'HCUMB410/CP', coverCodes: ['x/cp', 'X/P'] }, 'CP'), ['X/CP', 'X/P']);
eq('cover codes: derived when the record has none', lineCoverCodes({ code: 'HCUMB410/CP' }, 'CP'), ['HCUMB410/CP', 'HCUMB410/P', 'HCUMB410']);
eq('open = has a short line', openBackorders([so('so-1', [L('A', 0, 1)]), so('so-2', [L('A', 2, 1)]), { id: 'so-3' }]).map(o => o.id), ['so-2']);

// oldest first, across orders, partial covers, leftover
const orders = [so('so-2', [L('A/CP', 3, 200)]), so('so-1', [L('A/CP', 2, 100), L('B/CP', 1, 100)])];
const r = allocateArrival({ orders, code: 'a/cp', qty: 4, by: 'Andrea', source: 'receipt PO1', now: 999 });
eq('covered oldest first', r.covered.map(c => [c.soId, c.take, c.remaining]), [['so-1', 2, 0], ['so-2', 2, 1]]);
eq('leftover', r.leftover, 0);
eq('so-1 A line covered, B still short', r.patches['so-1'].map(b => [b.code, b.qty, b.covered || 0]), [['A/CP', 0, 2], ['B/CP', 1, 0]]);
eq('so-2 partly covered', r.patches['so-2'].map(b => [b.code, b.qty, b.covered || 0]), [['A/CP', 1, 2]]);
eq('nothing lifted while a line is short', r.lifted, []);
ok('stamps who / from / when', r.patches['so-1'][0].coveredBy === 'Andrea' && r.patches['so-1'][0].coveredFrom === 'receipt PO1' && r.patches['so-1'][0].coveredAt === 999);

// the last short line covered → lifted
const r2 = allocateArrival({ orders: [so('so-1', r.patches['so-1'])], code: 'B/CP', qty: 5, now: 1000 });
eq('lifted when no line short', r2.lifted, ['so-1']);
eq('leftover stays on the shelf', r2.leftover, 4);

// a /P arrival covers a painted line through its derived cover codes; a plated line only by its own code
const r3 = allocateArrival({ orders: [so('so-p', [{ code: 'HCUMB410/CP', qty: 1, since: 1 }], { recipe: 'CP' })], code: 'HCUMB410/P', qty: 1 });
eq('/P covers a painted line', r3.covered.length, 1);
const r4 = allocateArrival({ orders: [so('so-e', [{ code: 'H1-1CP-V/EP4', qty: 1, since: 1 }], { recipe: 'EP4' })], code: 'H1-1CP-V', qty: 1 });
eq('mill does not cover a plated line', r4.covered.length, 0);

// nothing to do
eq('no code → nothing', allocateArrival({ orders, code: '', qty: 3 }).covered, []);
eq('qty 0 → nothing', allocateArrival({ orders, code: 'A/CP', qty: 0 }).covered, []);
eq('deleted orders skipped', allocateArrival({ orders: [so('so-d', [L('A/CP', 1, 1)], { deleted: true })], code: 'A/CP', qty: 1 }).covered, []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
