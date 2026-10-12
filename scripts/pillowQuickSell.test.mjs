// The quick sell, pinned (S7 step 2, 2026-10-12): a plain pillow with a SKU in stock is the SKU at the
// chart price (the mismatch said); an edge, a trim, a size with no SKU or a short shelf is made to order
// in the custom shape with the SKU named; the throw is the throw; refusals by name.
import { quickSellSizesOf, quickSellEdgesOf, quickSellDesignOf, quickSellPlanOf, quickSellTilesOf, honestThrowsOf, EDGES } from '../src/components/Shared/pillowQuickSell.js';
import { colourwaysOf } from '../src/components/Shared/pillowCatalog.js';
import { pillowCartPlanOf } from '../src/components/Shared/pillowRequest.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const SIZES = ['20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'];
const CHART = { A: [300, 350, 375, 475, 575, 575, 650, 650, 650, 650], C: [375, 475, 500, 575, 725, 725, 875, 875, 875, 875] };
const config = {
    ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES,
    prices: Object.fromEntries(SIZES.map((s, i) => [s, { A: CHART.A[i], C: CHART.C[i] }])),
    fabricGroups: { A: { rank: 1 }, C: { rank: 3 } },
    sizes: { '19x19': { fillItem: 'Insert-PC-19x19', zipperItem: 'Zipper/10in' }, '20x20': { fillItem: 'INSERT-PC-20x20-DWALL' } },
    details: { FLANGE: { price: 40, per: 'EACH' }, WELT: { price: 35, per: 'EACH' }, OUTER_TRIM: { price: 12, per: 'YARD' } },
    seamAllowanceIn: 0.5, yardRounding: 0.125, rollupItem: { legacyErpId: 'CUSTOM PILLOW', itemId: '' },
};
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, netSuiteInternalId: extra.ns || '1', manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [
    item('Bell/10P19x19', { name: 'Bell Pillow color 10 Natural & Cream 19" x 19"', specs: { basePrice: 500 } }),
    item('Bell/10P23x23', { name: 'Bell Pillow color 10 Natural & Cream 23" x 23"', specs: { basePrice: 560 } }),   // off the chart (575)
    item('Bell/10T', { name: 'Bell color 10 Natural & Cream 71" x 51"', specs: { basePrice: 420 } }),
    item('Bell/10T-XL', { name: 'Bell color 10 Natural & Cream XL', specs: { basePrice: 640 } }),
    item('Bell/10F', { name: 'Bell fabric color 10', specs: { productType: 'FABRIC', priceGroup: 'C', width: 54, uom: 'RY' } }),
    item('Bell/22P19x19', { name: 'Bell Pillow color 22 Yellow 19" x 19"', specs: { basePrice: 500 } }),
    item('Bell/22T', { name: 'Bell color 22 Natural & Yellow', specs: { basePrice: 420, priceGroup: 'C' } }),          // no fabric item
    item('Nash/01P19x19', { specs: { basePrice: 375 } }),
    item('Nash/01F', { specs: { productType: 'FABRIC', priceGroup: 'A' } }),                                           // no width
    item('Lost/05P19x19', { specs: { basePrice: 500 } }),                                                              // no group anywhere
    item('Custom Pillow', { name: 'Pillow with customized options', ns: '9001' }),
    item('Insert-PC-19x19'), item('Zipper/10in'), item('Brush fringe', { specs: { productType: 'TRIMMING', uom: 'RY' } }),
];
// the board's index: by id, and by CODE (the fill / zipper rows name their code)
const findPart = (id) => lib.find(x => x.id === id) || lib.find(x => String(x.legacyErpId).toUpperCase() === String(id || '').toUpperCase()) || null;
const findByCode = (c) => lib.find(x => String(x.legacyErpId).toUpperCase() === String(c).toUpperCase()) || null;
const cat = colourwaysOf(lib);
const bell10 = cat.byKey.get('BELL/10'), bell22 = cat.byKey.get('BELL/22'), nash = cat.byKey.get('NASH/01'), lost = cat.byKey.get('LOST/05');

// ── the tiles ────────────────────────────────────────────────────────────────────────────────
const sizes = quickSellSizesOf(config, cat);
ok('ten size tiles in chart order; 19x19 and 23x23 are in the catalog, 20x20 is not; squares know it', sizes.length === 10 && sizes[0].key === '20x12' && sizes.find(s => s.key === '19x19').inCatalog && !sizes.find(s => s.key === '20x20').inCatalog && sizes.find(s => s.key === '19x19').square && !sizes[0].square);
ok('edges offered = the priced ones + none', quickSellEdgesOf(config).map(e => e.code).join(',') === 'NONE,FLANGE,WELT' && quickSellEdgesOf({ details: { FLANGE: { price: 40 } } }).map(e => e.code).join(',') === 'NONE,FLANGE' && EDGES.length === 3);
ok('the colourway tiles: four for pillows, two for throws; searched by colour name; narrowed to a group', quickSellTilesOf(cat).length === 4 && quickSellTilesOf(cat, { mode: 'THROW' }).length === 2 && quickSellTilesOf(cat, { q: 'yellow' })[0].key === 'BELL/22' && quickSellTilesOf(cat, { group: 'A' }).length === 1);
const design = quickSellDesignOf({ cw: bell10, sizeKey: '19x19', edge: 'FLANGE', trimId: 'ID-Brush fringe', fill: 'DOWN' });
ok('the design: one fabric both sides, no seams, the edge, trim all round', design.panels.length === 1 && design.panels[0].fabricId === 'ID-Bell/10F' && design.panels[0].widthIn === 19 && design.back.fabricId === 'ID-Bell/10F' && design.seams.length === 0 && design.flange === 'FLANGE' && design.outerTrim.top && design.outerTrim.trimId === 'ID-Brush fringe');

// ── the SKU ──────────────────────────────────────────────────────────────────────────────────
const sku = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', qty: 2, available: 5, config, findPart });
ok('a plain 19x19 with 5 on the shelf is the SKU at the chart price, no note', sku.ok && sku.kind === 'SKU' && sku.why === 'IN_STOCK' && sku.sku.code === 'Bell/10P19x19' && sku.chartPrice === 500 && sku.sku.mismatch === false && sku.note === '' && sku.warnings.length === 0);
const mis = quickSellPlanOf({ cw: bell10, sizeKey: '23x23', qty: 1, available: 3, config, findPart });
ok('23x23 priced 560 on the item and 575 on the chart → the chart wins, the mismatch is on the note and a warning', mis.ok && mis.kind === 'SKU' && mis.chartPrice === 575 && mis.sku.skuPrice === 560 && mis.sku.mismatch && mis.note === 'chart $575 · item $560' && mis.warnings.some(w => /chart wins/.test(w)));
const unread = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', qty: 1, available: null, config, findPart });
ok('stock not read → still the SKU, said as unknown', unread.ok && unread.kind === 'SKU' && unread.why === 'STOCK_UNKNOWN' && unread.warnings.some(w => /not read/.test(w)));

// ── made to order ────────────────────────────────────────────────────────────────────────────
const short = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', qty: 3, available: 1, config, findPart });
ok('1 on the shelf for 3 → made to order in the custom shape, the SKU named, the shelf said', short.ok && short.kind === 'MTO' && short.why === 'SHORT' && short.mto.line.standardSku === 'Bell/10P19x19' && /as Bell\/10P19x19/.test(short.summary) && short.warnings.some(w => /1 available for 3/.test(w)));
ok('…at the chart price with the fabric at two one-side cuts, the insert and the zipper beneath', short.mto.unitPrice === 500 && short.mto.line.holder.price === 500 && short.mto.line.holder.legacyErpId === 'CUSTOM PILLOW' && short.mto.line.consumed.map(c => c.legacyErpId).join(',') === 'Bell/10F,Bell/10F,Insert-PC-19x19,Zipper/10in' && short.mto.line.consumed[0].uom === 'YARD' && short.mto.line.consumed[0].qty === 1.875 && short.mto.line.consumed[2].qty === 3);   // (19 + 1)" / 36 = 0.556 → ⅛ up = 0.625 a side × 3
const flange = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', edge: 'FLANGE', qty: 1, available: 9, config, findPart });
ok('a flange on a stocked size is made to order at chart + the flange charge, why OPTIONS', flange.ok && flange.kind === 'MTO' && flange.why === 'OPTIONS' && flange.mto.unitPrice === 540 && /flange/.test(flange.summary));
const trimmed = quickSellPlanOf({ cw: bell10, sizeKey: '20x20', trimId: 'ID-Brush fringe', qty: 1, config, findPart });
ok('20x20 has no SKU → made to order; the trim rides as yards beneath and the OUTER_TRIM charge is per yard', trimmed.ok && trimmed.kind === 'MTO' && trimmed.why === 'NO_SKU' && trimmed.mto.line.standardSku === '' && trimmed.mto.line.consumed.some(c => c.legacyErpId === 'Brush fringe' && c.uom === 'YARD') && Math.abs(trimmed.mto.unitPrice - (875 + 12 * 2.222)) < 0.01);   // 80" round = 2.222 yd at $12
const loaded = pillowCartPlanOf({ line: short.mto.line, findByCode });
ok('the made-to-order line loads through tab 7\'s own cart plan: the holder with its NetSuite id, four parts', loaded.ok && loaded.holder.item.legacyErpId === 'Custom Pillow' && loaded.holder.rate === 500 && loaded.holder.qty === 3 && loaded.parts.length === 4 && loaded.parts[0].yards === 1.875);

// ── the throw ────────────────────────────────────────────────────────────────────────────────
const thr = quickSellPlanOf({ cw: bell10, mode: 'THROW', qty: 2 });
ok('a throw short on the honest shelf is sold short and said; in stock says so; unread stays unknown', quickSellPlanOf({ cw: bell10, mode: 'THROW', qty: 3, available: 2 }).why === 'SHORT' && quickSellPlanOf({ cw: bell10, mode: 'THROW', qty: 3, available: 2 }).warnings.some(w => /2 whole throws on the shelf for 3/.test(w)) && quickSellPlanOf({ cw: bell10, mode: 'THROW', qty: 1, available: 2 }).why === 'IN_STOCK' && thr.why === 'STOCK_UNKNOWN');
ok('the throw is the throw item; XL on request; a missing variant refuses', thr.ok && thr.kind === 'THROW' && thr.throwItem.legacyErpId === 'Bell/10T' && quickSellPlanOf({ cw: bell10, mode: 'THROW', variant: 'XL' }).throwItem.legacyErpId === 'Bell/10T-XL' && !quickSellPlanOf({ cw: bell10, mode: 'THROW', variant: 'XXL' }).ok);

// ── the sample ───────────────────────────────────────────────────────────────────────────────
{
    const lib3 = [...lib, item('SWA/Bell10', { name: 'Bell- Natural #10 Small Sample', specs: { basePrice: 15 } }), item('SWAL/Bell10', { name: 'Bell- Natural #10 Large Sample', specs: { basePrice: 40 } })];
    const cat3 = colourwaysOf(lib3);
    const b = cat3.byKey.get('BELL/10');
    const sm = quickSellPlanOf({ cw: b, mode: 'SAMPLE', qty: 2 });
    ok('a sample is the SWA item (small) or SWAL (large); a colourway with none refuses', sm.ok && sm.kind === 'SAMPLE' && sm.sampleItem.legacyErpId === 'SWA/Bell10' && quickSellPlanOf({ cw: b, mode: 'SAMPLE', variant: 'L' }).sampleItem.legacyErpId === 'SWAL/Bell10' && !quickSellPlanOf({ cw: cat3.byKey.get('BELL/22'), mode: 'SAMPLE' }).ok);
    ok('the sample tiles list only colourways with a sample', quickSellTilesOf(cat3, { mode: 'SAMPLE' }).length === 1 && quickSellTilesOf(cat3, { mode: 'SAMPLE' })[0].key === 'BELL/10');
}

// ── refusals ─────────────────────────────────────────────────────────────────────────────────
const noGroup = quickSellPlanOf({ cw: lost, sizeKey: '19x19', available: 4, config, findPart });
ok('no group on the colourway refuses by name, even with a SKU on the shelf', !noGroup.ok && noGroup.errors[0].code === 'NO_GROUP');
const b22stock = quickSellPlanOf({ cw: bell22, sizeKey: '19x19', qty: 1, available: 2, config, findPart });
ok('Bell/22 (group from its throw, no fabric item) sells its SKU from stock', b22stock.ok && b22stock.kind === 'SKU' && b22stock.chartPrice === 500);
const b22short = quickSellPlanOf({ cw: bell22, sizeKey: '19x19', qty: 4, available: 2, config, findPart });
ok('…short with nothing to cut: sold as the item short, said plainly (NetSuite backorders)', b22short.ok && b22short.kind === 'SKU' && b22short.why === 'SHORT_NO_FABRIC' && b22short.warnings.some(w => /no fabric yardage item/.test(w)));
const b22edge = quickSellPlanOf({ cw: bell22, sizeKey: '19x19', edge: 'WELT', available: 2, config, findPart });
ok('…with an edge it cannot be sewn: NO_FABRIC_ITEM names the yardage code', !b22edge.ok && b22edge.errors[0].code === 'NO_FABRIC_ITEM' && /Bell\/22F/.test(b22edge.errors[0].message));
const nashMto = quickSellPlanOf({ cw: nash, sizeKey: '23x23', config, findPart });
ok('a fabric with no width refuses made-to-order by name', !nashMto.ok && nashMto.errors[0].code === 'FABRIC_NO_WIDTH');
ok('no size / no colourway refuse', quickSellPlanOf({ cw: bell10, config, findPart }).errors[0].code === 'NO_SIZE' && quickSellPlanOf({ config }).errors[0].code === 'NO_COLOURWAY');
ok('a size the chart does not price refuses', quickSellPlanOf({ cw: bell10, sizeKey: '30x30', available: 1, config, findPart }).errors[0].code === 'NO_SIZE_PRICE');


// ── the throw's honest shelf ─────────────────────────────────────────────────────────────────
const pcs = [{ lengthIn: 27, status: 'CUT' }, { lengthIn: 45, status: 'CUT' }, { lengthIn: 60, status: 'CONSUMED' }];
const h = honestThrowsOf({ available: 3.5, pieces: pcs, yardsPerThrow: 2 });
ok('3.5 throws in NetSuite with 2 yd of live cuts on the shelf = 2 whole throws to sell (72" = 2 yd = 1 throw; consumed pieces ignored)', h.whole === 2 && h.pieceYards === 2 && h.pieceThrows === 1);
ok('two half throws never make one; an unread shelf stays unread', honestThrowsOf({ available: 1, pieces: [{ lengthIn: 36 }, { lengthIn: 36 }] }).whole === 0 && honestThrowsOf({ available: 0.75, pieces: [] }).whole === 0 && honestThrowsOf({ available: null }).whole === null);
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
