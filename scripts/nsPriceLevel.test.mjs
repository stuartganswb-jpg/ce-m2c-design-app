// The customer's NetSuite price level → the order discount, pinned (Stuart 2026-10-12): the record's own
// discount % first, else the percent in the name, Base Price = 0, a level with no percent is UNKNOWN and said.
import { discountPctOfPriceLevel, priceLevelNoteOf, mayAutoSetDiscount, priceLevelQuery, NS_PRICE_LEVELS_KNOWN } from '../src/components/Shared/nsPriceLevel.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const D = discountPctOfPriceLevel;
ok('"U - 30%" → 30 from the name', D({ id: '38', name: 'U - 30%' }).percent === 30 && D({ id: '38', name: 'U - 30%' }).reason === 'NAME');
ok('"20% Discount - Jobber/165yd" → 20', D({ id: '33', name: '20% Discount - Jobber/165yd' }).percent === 20);
ok('the record\'s own discountpct wins over the name (-25 → 25)', D({ id: '38', name: 'U - 30%', discountpct: -25 }).percent === 25 && D({ id: '38', name: 'U - 30%', discountpct: -25 }).reason === 'DISCOUNTPCT');
ok('Base Price → 0, by name or by id 1', D({ id: '1', name: 'Base Price' }).percent === 0 && D({ id: '1' }).percent === 0 && D({ id: '1' }).reason === 'BASE');
ok('"R2 Wholesale" carries no percent → UNKNOWN, null, said', D({ id: '36', name: 'R2 Wholesale' }).percent === null && D({ id: '36', name: 'R2 Wholesale' }).reason === 'UNKNOWN' && /carries no percent/.test(priceLevelNoteOf(D({ id: '36', name: 'R2 Wholesale' }))));
ok('an id with no name falls back to Stuart\'s list (42 → U - 20% → 20)', D({ id: '42' }).percent === 20 && D({ id: '42' }).name === 'U - 20%' && Object.keys(NS_PRICE_LEVELS_KNOWN).length === 10);
ok('no level at all → NONE', D({}).reason === 'NONE' && /no price level/.test(priceLevelNoteOf(D({}))));
ok('the note says the level and the percent', priceLevelNoteOf(D({ id: '40', name: 'U - 50%' })) === 'NetSuite price level U - 50% → 50% order discount');
ok('auto-set may write over a blank box or the last auto value, never a typed percent', mayAutoSetDiscount('', null) && mayAutoSetDiscount('30', 30) && !mayAutoSetDiscount('15', 30) && !mayAutoSetDiscount('15', null));
ok('the query reads the customer joined to its level', /FROM customer c LEFT JOIN pricelevel pl/.test(priceLevelQuery('1234')) && /c\.id = 1234/.test(priceLevelQuery('1234')));
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
