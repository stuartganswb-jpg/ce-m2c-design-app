// Matching an app-only customer, pinned (S7, 2026-10-17): the orders and quotes carrying the app-only id are re-stamped
// to the real record, the app-only record is marked matched (kept), refusals by name, nothing else touched.
import { matchPatchesOf, isMatchedAway } from '../src/components/Shared/customerMatch.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const appOnly = { id: 'CUST-APP-1792249886', name: 'Baker Stone Studio', nsPending: true };
const target = { id: 'CUST-67685', name: 'Baker Stone Studio' };
const orders = [{ id: 'QS-1', customerId: 'CUST-APP-1792249886', customer: 'Baker Stone Studio' }, { id: 'QS-2', customerId: 'CUST-11813', customer: 'Katie' }];
const quotes = [{ id: 'QSQUOTE-1', customer: { id: 'CUST-APP-1792249886', name: 'Baker Stone Studio' } }, { id: 'QSQUOTE-2', customer: { id: 'CUST-11813', name: 'Katie' } }];
const r = matchPatchesOf({ appOnly, target, orders, quotes, by: 'stuart', at: 9 });
ok('the order and the quote on the app-only id are re-stamped to the real record; the others untouched', r.ok && r.count === 2 && r.orders.length === 1 && r.orders[0].id === 'QS-1' && r.orders[0].patch.customerId === 'CUST-67685' && r.orders[0].patch.customerMatchedFrom === 'CUST-APP-1792249886' && r.quotes.length === 1 && r.quotes[0].patch.customer.id === 'CUST-67685' && r.quotes[0].patch.customer.name === 'Baker Stone Studio');
ok('the app-only record is marked matched and kept', r.crm.length === 1 && r.crm[0].id === 'CUST-APP-1792249886' && r.crm[0].patch.matchedTo === 'CUST-67685' && r.crm[0].patch.matchedBy === 'stuart' && isMatchedAway({ matchedTo: 'CUST-67685' }) && !isMatchedAway(appOnly));
ok('refusals: no target, an app-only target, the same record, no source', matchPatchesOf({ appOnly, target: null }).errors[0].code === 'NO_TARGET' && matchPatchesOf({ appOnly, target: { id: 'CUST-APP-5', nsPending: true } }).errors[0].code === 'TARGET_APP_ONLY' && matchPatchesOf({ appOnly, target: appOnly }).errors.some(e => e.code === 'SAME') && matchPatchesOf({ appOnly: null, target }).errors[0].code === 'NO_SOURCE');
ok('nothing carrying the id = a match with zero re-stamps (still ok)', matchPatchesOf({ appOnly, target, orders: [], quotes: [] }).count === 0 && matchPatchesOf({ appOnly, target }).ok);
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
