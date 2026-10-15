// The counter's price list, pinned (S7, 2026-10-15): the pillow grid is the chart, the throws are the items' own
// prices, a ticked level is the order discount's own rounding, the search narrows the throws.
import { DISCOUNT_LEVELS, lessPercent, levelsOf, cellOf, pillowPriceGridOf, throwPriceRowsOf, money } from '../src/components/Shared/counterPriceList.js';
import { colourwaysOf } from '../src/components/Shared/pillowCatalog.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

ok('six levels, 10 to 60', DISCOUNT_LEVELS.join() === '10,20,30,40,50,60');
ok('less a percent rounds to cents like the order discount; null stays null; a wild percent is the base', lessPercent(675, 10) === 607.5 && lessPercent(333.33, 30) === 233.33 && lessPercent(null, 10) === null && lessPercent(100, 150) === 100);
ok('the ticked levels come back in chart order, as numbers, unknown ones dropped', levelsOf(['40', 10, 99]).join() === '10,40' && levelsOf().length === 0);
ok('a cell: the base and one line per ticked level', JSON.stringify(cellOf(500, [20, 60])) === JSON.stringify({ base: 500, less: [{ pct: 20, price: 400 }, { pct: 60, price: 200 }] }));

const config = {
    ...DEFAULT_PILLOW_PRICING, sizeOrder: ['19x19', '23x23', '36x20'],
    prices: { '19x19': { A: 375, C: 500 }, '23x23': { A: 475, C: 575 }, '36x20': { C: 725, D: 900 } },
    fabricGroups: { C: { label: 'Group C', rank: 3 }, A: { label: 'Group A', rank: 1 } },
};
const grid = pillowPriceGridOf(config, [40]);
ok('the groups rank across, a chart-only group last; the sizes go down in chart order', grid.groups.map(g => g.code).join() === 'A,C,D' && grid.rows.map(r => r.sizeKey).join() === '19x19,23x23,36x20' && !grid.empty);
ok('each cell is the chart price with the ticked level beneath; an unpriced cell is null', grid.rows[0].cells[1].base === 500 && grid.rows[0].cells[1].less[0].price === 300 && grid.rows[2].cells[0].base === null && grid.rows[2].cells[2].base === 900);
ok('the empty default table is empty', pillowPriceGridOf(DEFAULT_PILLOW_PRICING).empty);

const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [
    item('Bell/10T', { name: 'Bell color 10 Natural & Cream 71" x 51"', specs: { basePrice: 675, priceGroup: 'C' } }),
    item('Bell/10T-XL', { name: 'Bell color 10 Natural & Cream XL', specs: { basePrice: 950 } }),
    item('Bell/22T', { name: 'Bell color 22 Yellow', specs: { basePrice: 675 } }),
    item('Nash/01T', { name: 'Nash color 01 Ivory', specs: { basePrice: 425 } }),
    item('Nash/01P19x19', { specs: { basePrice: 375 } }),   // a pillow only — not a throw row
];
const cat = colourwaysOf(lib);
const rows = throwPriceRowsOf(cat, { ticked: [10, 20] });
ok('one row per colourway with a throw, sorted; the pillow-only colourway is not a row', rows.rows.map(r => r.key).join() === 'BELL/10,BELL/22,NASH/01');
ok('Standard / XL / XXL cells: the base, the ticked levels, the item code; a missing variant is a dash', rows.rows[0].cells[0].base === 675 && rows.rows[0].cells[0].less.map(x => x.price).join() === '607.5,540' && rows.rows[0].cells[1].base === 950 && rows.rows[0].cells[1].code === 'Bell/10T-XL' && rows.rows[0].cells[2].base === null);
ok('the counter\'s rate rule wins over the base price when it answers; 0 falls back', throwPriceRowsOf(cat, { rateFor: (it) => (it.legacyErpId === 'Bell/10T' ? 700 : 0) }).rows[0].cells[0].base === 700 && throwPriceRowsOf(cat, { rateFor: () => 0 }).rows[2].cells[0].base === 425);
ok('the search narrows by pattern, colour name or number', throwPriceRowsOf(cat, { q: 'nash' }).rows.length === 1 && throwPriceRowsOf(cat, { q: 'yellow' }).rows[0].key === 'BELL/22' && throwPriceRowsOf(cat, { q: '10' }).rows.length === 1);
ok('money', money(607.5) === '$607.5' && money(null) === '—' && money(1200) === '$1,200');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
