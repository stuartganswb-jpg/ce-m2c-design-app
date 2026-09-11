// Harness for Shared/lineDiscount — the cart-or-checkout discount rule (Stuart 2026-09-11, S1).
//
//   node scripts/lineDiscount.test.mjs
//
// The contract: a quote is discounted ONE way — lines in the cart (manager+, percent or net
// price), a set % at checkout, the customer's code, or not at all. The gross unit price is never
// overwritten; the net derives. Rows are display-only (isDiscount / isNetLine). NetSuite scales
// the discounted item's own rates by netFactorOf.

import {
    canLineDiscount, lineDiscountOf, lineDiscountStamp, applyLineDiscount, clearLineDiscount,
    cartHasLineDiscounts, discountModeOf, lineDiscountRows, netFactorOf, orderDiscountStamp,
    orderPercentRate, orderPercentInfoRow,
} from '../src/components/Shared/lineDiscount.js';
import { isDisplayOnlyLine } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

const item = (id, gross, qty = 1, extra = {}) => ({ id, qty, pricing: { finalPrice: gross }, pricingBreakdown: [], ...extra });

// ── who may ──────────────────────────────────────────────────────────────────────────────────
ok('manager may', canLineDiscount('manager'));
ok('Executive (any case) may', canLineDiscount('Executive'));
ok('admin may', canLineDiscount('admin'));
ok('sales_rep may not', !canLineDiscount('sales_rep'));
ok('design_team may not', !canLineDiscount('design_team'));
ok('no role may not', !canLineDiscount(''));
ok('super-admin flag wins over role', canLineDiscount('operator', true));

// ── the stamp ────────────────────────────────────────────────────────────────────────────────
eq('percent stamp', lineDiscountStamp({ mode: 'PERCENT', value: '20', by: 'Stuart', at: 1 }), { mode: 'PERCENT', percent: 20, by: 'Stuart', at: 1 });
eq('net stamp rounds to cents', lineDiscountStamp({ mode: 'NET', value: '99.999', by: 'Stuart', at: 1 }), { mode: 'NET', netPrice: 100, by: 'Stuart', at: 1 });
eq('0% is nothing to apply', lineDiscountStamp({ mode: 'PERCENT', value: '0' }), null);
eq('101% is nothing to apply', lineDiscountStamp({ mode: 'PERCENT', value: '101' }), null);
eq('negative net is nothing to apply', lineDiscountStamp({ mode: 'NET', value: '-5' }), null);
eq('blank is nothing to apply', lineDiscountStamp({ mode: 'NET', value: '' }), null);
eq('unknown mode is nothing to apply', lineDiscountStamp({ mode: 'AMOUNT', value: '5' }), null);

// ── the money ────────────────────────────────────────────────────────────────────────────────
const p20 = { mode: 'PERCENT', percent: 20, by: 'Stuart', at: 1 };
const d1 = lineDiscountOf(item('a', 250, 2, { lineDiscount: p20 }));
eq('20% of 250: amount 50, net 200', [d1.amount, d1.net, d1.netPrice, d1.gross, d1.percent], [50, 200, 200, 250, 20]);
const d2 = lineDiscountOf(item('b', 333.33, 1, { lineDiscount: { mode: 'PERCENT', percent: 15 } }));
eq('15% of 333.33 rounds to cents', [d2.amount, d2.net], [50, 283.33]);
const d3 = lineDiscountOf(item('c', 250, 1, { lineDiscount: { mode: 'NET', netPrice: 199 } }));
eq('net 199 on 250: amount 51, percent 20.4', [d3.amount, d3.net, d3.percent], [51, 199, 20.4]);
const d4 = lineDiscountOf(item('d', 250, 1, { lineDiscount: { mode: 'NET', netPrice: 300 } }));
eq('a net ABOVE gross is a price set upward: negative amount, allowed', [d4.amount, d4.net], [-50, 300]);
eq('no stamp → null', lineDiscountOf(item('e', 250)), null);
eq('stamp on an unpriced item → null', lineDiscountOf({ id: 'f', lineDiscount: p20 }), null);
eq('garbage stamp → null', lineDiscountOf(item('g', 250, 1, { lineDiscount: 'yes' })), null);
ok('the gross unit price is never touched', item('h', 250, 1, { lineDiscount: p20 }).pricing.finalPrice === 250);

// ── apply / clear on a cart ──────────────────────────────────────────────────────────────────
const cart0 = [item('a', 100), item('b', 200), item('c', 300)];
const cart1 = applyLineDiscount(cart0, ['a', 'c'], p20);
eq('applied to the ticked lines only', cart1.map(it => !!it.lineDiscount), [true, false, true]);
ok('untouched lines are the same objects', cart1[1] === cart0[1]);
eq('a null stamp applies nothing', applyLineDiscount(cart0, ['a'], null).map(it => !!it.lineDiscount), [false, false, false]);
const cart2 = clearLineDiscount(cart1, ['a']);
eq('clear removes the field, not nulls it', ['lineDiscount' in cart2[0], !!cart2[2].lineDiscount], [false, true]);
ok('cart has line discounts', cartHasLineDiscounts(cart1));
ok('cart without', !cartHasLineDiscounts(cart0));

// ── ONE way, never two ───────────────────────────────────────────────────────────────────────
eq('lines beat everything', discountModeOf({ cart: cart1, orderPercent: '10', customerCode: 'D20' }), 'LINES');
eq('a set % replaces the code', discountModeOf({ cart: cart0, orderPercent: '10', customerCode: 'D20' }), 'ORDER_PERCENT');
eq('the code alone', discountModeOf({ cart: cart0, orderPercent: '', customerCode: 'D20' }), 'CODE');
eq('blank set % is not a set %', discountModeOf({ cart: cart0, orderPercent: '0', customerCode: '' }), 'NONE');
eq('nothing', discountModeOf({ cart: cart0 }), 'NONE');
eq('a stamp that computes to nothing does not count as LINES', discountModeOf({ cart: [item('z', 0, 1, { lineDiscount: { mode: 'NET', netPrice: 0 } })].map(it => ({ ...it, pricing: { finalPrice: null } })), customerCode: 'D20' }), 'CODE');

// ── the rows ─────────────────────────────────────────────────────────────────────────────────
const rows = lineDiscountRows(item('a', 250, 2, { lineDiscount: p20 }), d1, 2);
eq('two rows: discount then net, line totals × qty', rows.map(r => [r.name.trim(), r.price, r.total]), [['Line Discount - (20%) · by Stuart', -50, -100], ['Net Line Total', 200, 400]]);
ok('both rows are display-only for every floor consumer', rows.every(isDisplayOnlyLine));
ok('the discount row says it is a LINE discount (documents tell it from the trade rows)', rows[0].isDiscount && rows[0].isLineDiscount && rows[1].isNetLine);
eq('net-price rows read "Price set to"', lineDiscountRows(item('c', 250), d3, 1)[0].name.trim(), 'Price set to $199.00');
eq('no discount, no rows', lineDiscountRows(item('e', 250), null), []);

// ── NetSuite factor ──────────────────────────────────────────────────────────────────────────
eq('20% off → factor .8', netFactorOf(item('a', 250, 1, { lineDiscount: p20 })), 0.8);
eq('net 199 on 250 → .796', netFactorOf(item('c', 250, 1, { lineDiscount: { mode: 'NET', netPrice: 199 } })), 0.796);
eq('set upward → 1.2', netFactorOf(item('d', 250, 1, { lineDiscount: { mode: 'NET', netPrice: 300 } })), 1.2);
eq('no discount → 1', netFactorOf(item('e', 250)), 1);
eq('gross 0 → 1 (never divide by zero)', netFactorOf(item('z', 0, 1, { lineDiscount: { mode: 'NET', netPrice: 0 } })), 1);

// ── the header stamp ─────────────────────────────────────────────────────────────────────────
eq('LINES', orderDiscountStamp({ mode: 'LINES', percent: 10, code: 'D20', by: 'S' }), { mode: 'LINES', percent: null, code: '', by: 'S' });
eq('ORDER_PERCENT keeps the percent, drops the code', orderDiscountStamp({ mode: 'ORDER_PERCENT', percent: '12.5', code: 'D20' }), { mode: 'ORDER_PERCENT', percent: 12.5, code: '', by: '' });
eq('CODE keeps both', orderDiscountStamp({ mode: 'CODE', percent: 20, code: 'd20' }), { mode: 'CODE', percent: 20, code: 'D20', by: '' });
eq('unknown → NONE', orderDiscountStamp({ mode: 'x' }), { mode: 'NONE', percent: null, code: '', by: '' });

// ── tab 7: a set % on the rates ──────────────────────────────────────────────────────────────
eq('20% off 12.50 → 10.00', orderPercentRate(12.5, 20), 10);
eq('15% off 2.60 rounds to cents (2.21)', orderPercentRate(2.6, 15), 2.21);
eq('blank / 0 / 101% → the rate as is', [orderPercentRate(9.99, ''), orderPercentRate(9.99, 0), orderPercentRate(9.99, 101)], [9.99, 9.99, 9.99]);
eq('a string percent works (the input is a string)', orderPercentRate(100, '12.5'), 87.5);
const info = orderPercentInfoRow({ percent: '20', saved: 33.333 });
eq('the info row bills nothing and is display-only', [info.price, info.total, info.isDiscount, info.isOrderDiscount, isDisplayOnlyLine(info)], [0, 0, true, true, true]);
eq('…and says the saving', info.name.trim(), 'Order Discount - (20%) · item prices above are net of it · saved $33.33');

console.log(`\nlineDiscount: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
