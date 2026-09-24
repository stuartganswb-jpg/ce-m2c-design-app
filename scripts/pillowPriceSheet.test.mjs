// The pillow price chart reader, pinned (S7, 2026-09-24) — against Stuart's REAL chart
// (0903/Pillows Size Price Chart.xlsx, dumped cell for cell) and the refusals: an unreadable size
// header, a cell that is not a price, a group listed twice. Then the merge (the chart never touches
// labour / details / fill / zipper), the diff the preview shows, and the editor's round trips.
import {
    findChartSheet, parsePillowPriceChart, mergePricingFromChart, masterListSizesOf, chartDiffOf, masterListDiffOf,
    detailRowsOf, detailsFromRows, numbersPatchOf, BUILT_IN_DETAILS,
} from '../src/components/Shared/pillowPriceSheet.js';
import { DEFAULT_PILLOW_PRICING, sizePriceOf, pricePillow } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// ── the real chart, as the shared workbook reader hands it over ──────────────────────────────
const CHART = [
    [null, null, null, null, null, null, null, null, null, null, null, null],
    ['Group', 'Fabric', '20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'],
    ['A', 'Savery', 300, 350, 375, 475, 575, 575, 650, 650, 650, 650],
    ['B', 'Nash', 350, 400, 450, 500, 650, 650, 775, 775, 775, 775],
    ['C', 'Becker', 375, 475, 500, 575, 725, 725, 875, 875, 875, 875],
    ['D', 'Winters', 500, 550, 575, 675, 875, 875, 1025, 1025, 1025, 1025],
    ['E', 'Kurlisuri ', 575, 650, 675, 825, 1025, 1025, 1650, 1650, 1650, 1650],
];
const sheets = [{ name: 'Sheet1', grid: CHART.map(r => r.slice()) }];
const clone = () => JSON.parse(JSON.stringify(CHART));

// ── reading ──────────────────────────────────────────────────────────────────────────────────
ok('the chart sheet is found by its GROUP · FABRIC header', findChartSheet(sheets).headerRow === 1);
ok('a workbook with no chart is refused', parsePillowPriceChart([{ name: 'x', grid: [['a', 'b']] }]).errors[0].code === 'NO_CHART');
const p = parsePillowPriceChart(sheets);
ok('the real chart parses clean', p.ok && p.errors.length === 0, JSON.stringify(p.errors));
ok('ten sizes in chart order', p.sizeKeys.join(',') === '20x12,24x15,19x19,23x23,36x20,45x15,20x20,22x22,24x24,52x28');
ok('five groups ranked by row', p.groups.map(g => `${g.code}${g.rank}`).join(',') === 'A1,B2,C3,D4,E5');
ok('the typical fabric is the label, trimmed', p.groups[4].label === 'Kurlisuri' && p.groups[0].label === 'Savery');
ok('50 prices', Object.values(p.prices).reduce((n, row) => n + Object.keys(row).length, 0) === 50);
ok('spot cells: A 20x12 = 300, E 20x20 = 1650, C 23x23 = 575', p.prices['20x12'].A === 300 && p.prices['20x20'].E === 1650 && p.prices['23x23'].C === 575);
ok('orientation: 20x12 stays 20 wide × 12 tall (never re-ordered)', p.sizeKeys.includes('20x12') && !p.sizeKeys.includes('12x20'));

// header variants the reader tolerates
const g2 = clone(); g2[1][2] = '20 X 12'; g2[1][3] = ' 24x15 '; g2[2][2] = '$300'; g2[3][2] = '350.00';
ok('spaced / cased headers and $-formatted cells read', parsePillowPriceChart([{ name: 's', grid: g2 }]).ok && parsePillowPriceChart([{ name: 's', grid: g2 }]).prices['20x12'].A === 300);
const g3 = clone(); g3.push([null, null, null, null, null, null, null, null, null, null, null, null]);
ok('a trailing blank row is ignored', parsePillowPriceChart([{ name: 's', grid: g3 }]).ok);

// ── refusals, by cell ────────────────────────────────────────────────────────────────────────
const bad1 = clone(); bad1[1][5] = 'Square';
const r1 = parsePillowPriceChart([{ name: 's', grid: bad1 }]);
ok('an unreadable size header refuses and names the cell', !r1.ok && r1.errors[0].code === 'SIZE_HEADER_UNREADABLE' && r1.errors[0].cell === 'F2');
const bad2 = clone(); bad2[4][6] = 'call';
const r2 = parsePillowPriceChart([{ name: 's', grid: bad2 }]);
ok('a cell that is not a price refuses and names size / group / cell', !r2.ok && r2.errors[0].code === 'CELL_NOT_A_PRICE' && r2.errors[0].cell === 'G5' && /36x20/.test(r2.errors[0].message) && /group C/.test(r2.errors[0].message));
const bad3 = clone(); bad3[5][0] = 'B';
const r3 = parsePillowPriceChart([{ name: 's', grid: bad3 }]);
ok('a group listed twice refuses', !r3.ok && r3.errors[0].code === 'GROUP_DUPLICATE');
const bad4 = clone(); bad4[1][10] = '22x22';
ok('a size column twice refuses', parsePillowPriceChart([{ name: 's', grid: bad4 }]).errors.some(e => e.code === 'SIZE_DUPLICATE'));
const bad5 = clone(); bad5[3][4] = 0;
ok('a zero price refuses', parsePillowPriceChart([{ name: 's', grid: bad5 }]).errors.some(e => e.code === 'CELL_NOT_A_PRICE' && e.cell === 'E4'));
const bad6 = clone(); bad6[6][0] = null;
ok('a price row with no group code refuses', parsePillowPriceChart([{ name: 's', grid: bad6 }]).errors.some(e => e.code === 'GROUP_MISSING'));
const bad7 = clone(); bad7[2][1] = '';
ok('a missing fabric name is a warning, not a refusal', parsePillowPriceChart([{ name: 's', grid: bad7 }]).ok && parsePillowPriceChart([{ name: 's', grid: bad7 }]).warnings.length === 1);

// ── the merge keeps what the chart does not carry ────────────────────────────────────────────
const existing = {
    ...DEFAULT_PILLOW_PRICING,
    prices: { '22x22': { A: 999, Z: 5 } },
    fabricGroups: { A: { label: 'old', rank: 1, upcharge: 12 }, Z: { label: 'gone', rank: 9 } },
    sizes: { '22x22': { label: '22x22 Square', fillItem: 'FILL-22', zipperItem: 'ZIP-22' }, '12x20': { label: 'Lumbar', fillItem: 'FILL-12' } },
    seamLabor: { perSeam: 15 }, details: { FLANGE: { price: 20, per: 'EACH' } }, rollupItem: { legacyErpId: 'CUSTOM PILLOW', itemId: 'u9' },
    seamAllowanceIn: 0.75,
};
const merged = mergePricingFromChart(existing, p);
ok('prices are REPLACED by the chart (the old 999 and group Z are gone)', merged.prices['22x22'].A === 650 && merged.prices['22x22'].Z === undefined && !merged.fabricGroups.Z);
ok('labour, details, rollup, allowance survive the chart', merged.seamLabor.perSeam === 15 && merged.details.FLANGE.price === 20 && merged.rollupItem.itemId === 'u9' && merged.seamAllowanceIn === 0.75);
ok('a kept size keeps its stored min cut', mergePricingFromChart({ ...existing, sizes: { '22x22': { minCut: { lengthIn: 24, widthIn: 24 } } } }, p).sizes['22x22'].minCut.lengthIn === 24);
ok('a kept size keeps its fill / zipper items; a size off the chart drops', merged.sizes['22x22'].fillItem === 'FILL-22' && merged.sizes['22x22'].zipperItem === 'ZIP-22' && !merged.sizes['12x20']);
ok('a kept group keeps its upcharge, its label follows the chart', merged.fabricGroups.A.upcharge === 12 && merged.fabricGroups.A.label === 'Savery');
ok('the size order rides the document', merged.sizeOrder.join(',') === p.sizeKeys.join(','));
ok('a failed parse merges nothing', mergePricingFromChart(existing, r1).prices['22x22'].A === 999);

// ── the module prices from the merged document ───────────────────────────────────────────────
ok('sizePriceOf reads the merged matrix', sizePriceOf(merged, '23x23', 'C') === 575 && sizePriceOf(merged, '52x28', 'e') === 1650);
const items = { 'FAB-C': { id: 'f1', legacyErpId: 'FAB-C', itemName: 'Becker', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'C', width: 54 } }, 'CUSTOM PILLOW': { id: 'u9', legacyErpId: 'CUSTOM PILLOW', itemName: 'Custom Pillow' } };
const priced = pricePillow({ design: { size: '23x23', panels: [{ label: 'A', fabricId: 'FAB-C', widthIn: 23, heightIn: 23 }], seams: [{ id: 1, treatment: 'STANDARD', lengthIn: 23 }], outerTrim: {} }, findPart: (id) => items[id] || null, config: merged });
ok('a 23x23 Becker pillow with one seam = 575 + 15', priced.ok && priced.unitPrice === 590, JSON.stringify(priced.errors));
const fresh = mergePricingFromChart(DEFAULT_PILLOW_PRICING, p);
const unpricedSeam = pricePillow({ design: { size: '23x23', panels: [{ label: 'A', fabricId: 'FAB-C', widthIn: 23, heightIn: 23 }], seams: [{ id: 1, treatment: 'STANDARD', lengthIn: 23 }], outerTrim: {} }, findPart: (id) => items[id] || null, config: fresh });
ok('a fresh import with the labour blank refuses a seamed pillow (SEAM_UNPRICED), by design', !unpricedSeam.ok && unpricedSeam.errors[0].code === 'SEAM_UNPRICED');

// ── the diff the preview shows ───────────────────────────────────────────────────────────────
const d0 = chartDiffOf(DEFAULT_PILLOW_PRICING, p);
ok('first import: 10 sizes, 5 groups, 50 new cells, nothing changed', d0.firstImport && d0.addedSizes.length === 10 && d0.addedGroups.length === 5 && d0.newCells === 50 && d0.changedCells.length === 0);
const d1 = chartDiffOf(existing, p);
ok('against the old document: 22x22/A changes 999 → 650, Z leaves', d1.changedCells.length === 1 && d1.changedCells[0].from === 999 && d1.changedCells[0].to === 650 && d1.removedGroups.join() === 'Z' && d1.addedSizes.length === 9);
const d2 = chartDiffOf(merged, p);
ok('re-importing the same chart changes nothing', d2.newCells === 0 && d2.changedCells.length === 0 && d2.addedSizes.length === 0 && d2.removedSizes.length === 0);
const bump = clone(); bump[2][3] = 360;
ok('a price bump shows as one changed cell', chartDiffOf(merged, parsePillowPriceChart([{ name: 's', grid: bump }])).changedCells.map(c => `${c.size}/${c.group}:${c.from}>${c.to}`).join() === '24x15/A:350>360');

// ── the master list ──────────────────────────────────────────────────────────────────────────
ok('the master list becomes the chart\'s sizes in chart order', masterListSizesOf(p).join(',') === p.sizeKeys.join(','));
const ml = masterListDiffOf(['12x20 Lumbar', '18x18 Square', '22x22 Square'], p);
ok('the preview names what leaves (12x20 Lumbar, 18x18 Square) and what is relabelled (22x22 Square → 22x22)', ml.removed.join(',') === '12x20 Lumbar,18x18 Square' && ml.relabelled.join() === '22x22 Square' && ml.added.length === 9);
ok('a failed parse changes no list', masterListSizesOf(r1).length === 0);

// ── the editor's blanks ──────────────────────────────────────────────────────────────────────
const rows = detailRowsOf(merged);
ok('built-in details lead, the priced one carries its price, the rest are blank', rows.length === BUILT_IN_DETAILS.length && rows[0].code === 'FLANGE' && rows[0].price === 20 && rows[1].price === '');
const back = detailsFromRows([...rows, { code: 'button tuft', label: 'Button tufting', kind: 'ADDON', per: 'EACH', price: '18' }]);
ok('rows round-trip: blanks write no row, a new detail is coded BUTTON_TUFT', back.ok && Object.keys(back.details).join() === 'FLANGE,BUTTON_TUFT' && back.details.BUTTON_TUFT.price === 18 && back.details.BUTTON_TUFT.kind === 'ADDON');
ok('a duplicate code refuses', !detailsFromRows([{ code: 'X', price: 1 }, { code: 'x', price: 2 }]).ok);
ok('a non-price refuses and names the row', detailsFromRows([{ code: 'X', price: 'ten' }]).errors[0].message.includes('row 1'));
ok('a row with a label but no code refuses', !detailsFromRows([{ code: '', label: 'Mystery', price: 5 }]).ok);
ok('the merged editor rows survive a second detailRowsOf (an added detail lists after the built-ins)', detailRowsOf({ details: back.details }).map(r => r.code).join() === 'FLANGE,WELT,OUTER_TRIM,FRINGE_SEAM,BUTTON_TUFT');
const n1 = numbersPatchOf({ perSeam: '15', seamAllowanceIn: '', yardRounding: '', rollupCode: 'custom pillow' });
ok('labour 15, defaults for the allowances, rollup upper-cased', n1.ok && n1.patch.seamLabor.perSeam === 15 && n1.patch.seamAllowanceIn === 0.5 && n1.patch.yardRounding === 0.125 && n1.patch.rollupItem.legacyErpId === 'CUSTOM PILLOW');
ok('a blank labour writes null (refuses at pricing), not 0', numbersPatchOf({ perSeam: '' }).patch.seamLabor.perSeam === null);
ok('a bad allowance refuses', !numbersPatchOf({ perSeam: 15, seamAllowanceIn: '9' }).ok);
ok('a bad yard rounding refuses', !numbersPatchOf({ yardRounding: '2' }).ok);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
