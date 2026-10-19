// The customer's NetSuite price level → the order discount, pinned (Stuart 2026-10-12): the record's own
// discount % first, else the percent in the name, Base Price = 0, a level with no percent is UNKNOWN and said.
import { priceLevelCacheOf, tileLevelWordsOf, priceLevelsBulkQuery, nsLevelAppliesAt, nsLevelSkippedNoteOf } from '../src/components/Shared/nsPriceLevel.js';
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
// ── the level on the tile (2026-10-16) ───────────────────────────────────────────────────────
const cache = priceLevelCacheOf(D({ id: '41', name: 'U - 60%' }), 7);
ok('the cache keeps id, name, percent, reason and when', cache.id === '41' && cache.name === 'U - 60%' && cache.percent === 60 && cache.reason === 'NAME' && cache.readAt === 7);
ok('tile words: a discount, base, none, unknown, not read', tileLevelWordsOf({ nsPriceLevel: cache }).words === 'U - 60% · 60% off' && tileLevelWordsOf({ nsPriceLevel: cache }).tone === 'discount' && tileLevelWordsOf({ nsPriceLevel: priceLevelCacheOf(D({ id: '1', name: 'Base Price' }), 1) }).words === 'Base Price · no discount' && tileLevelWordsOf({ nsPriceLevel: priceLevelCacheOf(D({}), 1) }).words === 'no price level' && tileLevelWordsOf({ nsPriceLevel: priceLevelCacheOf(D({ id: '36', name: 'R2 Wholesale' }), 1) }).tone === 'unknown' && tileLevelWordsOf({}).words === 'level not read yet');
ok('the bulk query joins every active customer to its level', /FROM customer c LEFT JOIN pricelevel pl/.test(priceLevelsBulkQuery()) && /customerid/.test(priceLevelsBulkQuery()));

// ── a customer on a 4.6 level is already at their price (2026-10-19, Fabricut PO 682688) ─────────────────
ok('the NetSuite level is the order discount only at STANDARD', nsLevelAppliesAt('STANDARD') && nsLevelAppliesAt('') && nsLevelAppliesAt(undefined) && !nsLevelAppliesAt('FAB_COST') && !nsLevelAppliesAt('fab_wholesale') && !nsLevelAppliesAt('FAB_RETAIL'));
ok('Fabricut: the 20% level is said and not applied', nsLevelSkippedNoteOf(D({ id: '33', name: '20% Discount - Jobber/165yd' }), 'FABRICUT COST') === 'NetSuite price level 20% Discount - Jobber/165yd (20%) not applied — this customer prices at its 4.6 level (FABRICUT COST)');
ok('…a level with no percent is named without one', nsLevelSkippedNoteOf(D({ id: '36', name: 'R2 Wholesale' }), 'FABRICUT COST') === 'NetSuite price level R2 Wholesale not applied — this customer prices at its 4.6 level (FABRICUT COST)');
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
