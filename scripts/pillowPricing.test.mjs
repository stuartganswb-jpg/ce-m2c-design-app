// The custom pillow price rule, pinned (S7, 2026-09-13). Stuart's rule in assertions: the size at the
// HIGHEST fabric group among the panels, + labour per drawn seam, + a charge per custom detail; every
// panel consumes its own fabric; a missing table row REFUSES with a named code, never a $0 line.
import {
    DEFAULT_PILLOW_PRICING, PILLOW_DIVISION, PILLOW_HANDLING,
    sizeKeyOf, dimsOf, priceGroupOf, groupRankOf, highestGroupOf, sizePriceOf, fabricUnitOf,
    panelConsumptionOf, trimInchesOf, designFromPillowData, pricePillow,
} from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } };
const near = (a, b, eps = 0.005) => Math.abs((a || 0) - (b || 0)) <= eps;

// ── fixtures: the table the spreadsheet will seed, and the items the board picks ─────────────
const config = {
    ...DEFAULT_PILLOW_PRICING,
    prices: { '22x22': { A: 150, B: 185, C: 240 }, '12x20': { A: 120, B: 150 } },
    sizes: { '22x22': { label: '22x22 Square', fillItem: 'FILL-22', zipperItem: 'ZIP-22' }, '18x18': { label: '18x18 Square', base: 130 } },
    fabricGroups: { A: { label: 'Group A', rank: 1, upcharge: 0 }, B: { label: 'Group B', rank: 2, upcharge: 35 }, C: { label: 'Group C', rank: 3, upcharge: 90 } },
    seamLabor: { perSeam: 15 },
    details: { FLANGE: { price: 20, per: 'EACH' }, WELT: { price: 12, per: 'EACH' }, OUTER_TRIM: { price: 8, per: 'YARD' }, FRINGE_SEAM: { price: 10, per: 'YARD' } },
};
const items = {
    'FAB-A': { id: 'u1', legacyErpId: 'FAB-A', itemName: 'Linen Natural', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'A', width: 54, uom: 'RY' } },
    'FAB-B': { id: 'u2', legacyErpId: 'FAB-B', itemName: 'Velvet Moss', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'b', width: 54 } },
    'PANEL-C': { id: 'u3', legacyErpId: 'PANEL-C', itemName: 'Naka throw panel 20x40', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'C', width: 20, length: 40 } },
    'FAB-NOGROUP': { id: 'u4', legacyErpId: 'FAB-NOGROUP', itemName: 'Untagged', manufacturingSpecs: { productType: 'Fabric', width: 54 } },
    'FAB-NOWIDTH': { id: 'u5', legacyErpId: 'FAB-NOWIDTH', itemName: 'No width', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'A' } },
    'TRIM-1': { id: 'u6', legacyErpId: 'TRIM-1', itemName: 'Brush fringe', manufacturingSpecs: { productType: 'Trimming', uom: 'RY' } },
    'FILL-22': { id: 'u7', legacyErpId: 'FILL-22', itemName: '22x22 down insert', manufacturingSpecs: { productType: 'Insert' } },
    'ZIP-22': { id: 'u8', legacyErpId: 'ZIP-22', itemName: '20" zipper', manufacturingSpecs: { productType: 'Component' } },
    'CUSTOM PILLOW': { id: 'u9', legacyErpId: 'CUSTOM PILLOW', itemName: 'Custom Pillow', manufacturingSpecs: { productType: 'Non-Inventory' } },
};
const findPart = (id) => items[String(id || '')] || null;
const panel = (label, fabricId, w = 22, h = 22) => ({ label, fabricId, widthIn: w, heightIn: h });
const design = (over = {}) => ({ size: '22x22 Square', fill: 'DOWN', flange: 'NONE', flangeSize: 0, stitch: 'STANDARD',
    panels: [panel('A', 'FAB-A')], back: null, seams: [], outerTrim: { trimId: '', top: false, bottom: false, left: false, right: false }, ...over });

// ── readers ──────────────────────────────────────────────────────────────────────────────────
ok('size key from a label', sizeKeyOf('22x22 Square') === '22x22');
ok('size key tolerates spaces and ×', sizeKeyOf('12 × 20 Lumbar') === '12x20');
ok('size key empty when unreadable', sizeKeyOf('Lumbar') === '');
ok('dims of a size', dimsOf('12x20 Lumbar').w === 12 && dimsOf('12x20 Lumbar').h === 20);
ok('price group read upper-cased', priceGroupOf(items['FAB-B']) === 'B');
ok('no group → empty', priceGroupOf(items['FAB-NOGROUP']) === '');
ok('group rank from the table', groupRankOf(config, 'c') === 3);
ok('unknown group has no rank', groupRankOf(config, 'Z') === null);
ok('highest group wins', highestGroupOf(config, ['A', 'C', 'B']) === 'C');
ok('highest ignores unranked', highestGroupOf(config, ['A', 'Z']) === 'A');
ok('matrix cell is the price', sizePriceOf(config, '22x22 Square', 'B') === 185);
ok('base + upcharge when no matrix row', sizePriceOf(config, '18x18', 'B') === 165);
ok('no row at all → null', sizePriceOf(config, '30x30', 'A') === null);
ok('RY uom → YARD', fabricUnitOf(items['FAB-A']) === 'YARD');
ok('width + length, no uom → EACH', fabricUnitOf(items['PANEL-C']) === 'EACH');
ok('width only, no uom → YARD', fabricUnitOf(items['FAB-B']) === 'YARD');

// ── consumption ──────────────────────────────────────────────────────────────────────────────
const cA = panelConsumptionOf({ item: items['FAB-A'], panel: panel('A', 'FAB-A'), config });
ok('22" panel on 54" goods: one width, 23" cut → 0.75 yd (rounded up to 1/8)', cA.unit === 'YARD' && cA.widths === 1 && cA.qty === 0.75);
const cWide = panelConsumptionOf({ item: items['FAB-A'], panel: panel('A', 'FAB-A', 60, 22), config });
ok('61" cut on 54" goods needs two widths: 2 × 23" = 1.278 yd → 1.375', cWide.widths === 2 && cWide.qty === 1.375);
const cP = panelConsumptionOf({ item: items['PANEL-C'], panel: panel('A', 'PANEL-C', 18, 18), config });
ok('a cut throw panel consumes ONE each', cP.unit === 'EACH' && cP.qty === 1 && cP.warnings.length === 0);
const cBig = panelConsumptionOf({ item: items['PANEL-C'], panel: panel('A', 'PANEL-C', 22, 22), config });
ok('a 23" cut does not fit a 20×40 piece → warned, still one each', cBig.qty === 1 && /does not fit/.test(cBig.warnings[0] || ''));
const cRot = panelConsumptionOf({ item: items['PANEL-C'], panel: panel('A', 'PANEL-C', 38, 18), config });
ok('a 39×19 cut fits the 20×40 piece turned', cRot.warnings.length === 0);
const cNoW = panelConsumptionOf({ item: items['FAB-NOWIDTH'], panel: panel('A', 'FAB-NOWIDTH'), config });
ok('no width on the item → one width assumed, warned', cNoW.widths === 1 && /no width/.test(cNoW.warnings[0] || ''));
const cUnk = panelConsumptionOf({ item: items['FAB-A'], panel: { label: 'B', fabricId: 'FAB-A' }, config });
ok('unknown panel dims → qty null + warning, never a guess', cUnk.qty === null && /dimensions unknown/.test(cUnk.warnings[0] || ''));
const t = trimInchesOf({ outerTrim: { trimId: 'TRIM-1', top: true, bottom: true, left: false, right: true }, seams: [{ treatment: 'FRINGE', lengthIn: 10 }, { treatment: 'STANDARD', lengthIn: 5 }] }, { w: 22, h: 22 });
ok('outer trim inches = the ticked edges', t.outer === 66);
ok('fringe inches = fringe seams only', t.fringe === 10);

// ── the rule: one panel ──────────────────────────────────────────────────────────────────────
const r1 = pricePillow({ design: design(), findPart, config });
ok('one-panel 22x22 in group A prices at the matrix cell', r1.ok && r1.unitPrice === 150 && r1.total === 150);
ok('the group is named', r1.group === 'A' && r1.groupOf.A === 'A');
ok('holder = the non-inventory custom pillow, priced', r1.holder && r1.holder.legacyErpId === 'CUSTOM PILLOW' && r1.holder.partId === 'u9' && r1.holder.isRollup === true && r1.holder.price === 150);
ok('holder routes Custom to the SEW division', r1.holder.partHandling === PILLOW_HANDLING && r1.holder.division === PILLOW_DIVISION && PILLOW_DIVISION === 'SEW');
ok('back panel assumed from panel A, said', r1.warnings.some(w => /back panel/.test(w)) && r1.rows.filter(r => r.panel === 'BACK').length === 1);
ok('face + back consume 0.75 yd each of FAB-A', r1.rows.filter(r => r.legacyErpId === 'FAB-A').every(r => r.qty === 0.75 && r.uom === 'YARD' && r.price === 0 && r.consumes));
ok('fill + zipper consumed at $0 when the size names them', r1.rows.some(r => r.legacyErpId === 'FILL-22' && r.qty === 1) && r1.rows.some(r => r.legacyErpId === 'ZIP-22' && r.qty === 1));
ok('every row carries the hardwareHandoff contract', [r1.holder, ...r1.rows].every(r => 'name' in r && 'qty' in r && 'price' in r && 'total' in r && 'partHandling' in r && 'partId' in r && 'legacyErpId' in r && r.finishCode === '' && r.isFee === false));
ok('no hardware field rides a pillow row', [r1.holder, ...r1.rows].every(r => !('enginePicks' in r) && !('visionPartIds' in r) && !('role' in r) && !('clusterId' in r)));

// ── three panels, three groups: the highest is charged, each consumes its own ────────────────
const r3 = pricePillow({ design: design({ panels: [panel('A', 'FAB-A', 22, 8), panel('B', 'FAB-B', 22, 7), panel('C', 'PANEL-C', 22, 7)], seams: [{ id: 1, treatment: 'STANDARD', lengthIn: 22 }, { id: 2, treatment: 'STANDARD', lengthIn: 22 }] }), findPart, config });
ok('three groups → priced at C (240) + 2 seams × 15', r3.ok && r3.group === 'C' && r3.breakdown.sizePrice === 240 && r3.breakdown.seams.total === 30 && r3.unitPrice === 270);
ok('each panel consumes its own fabric', r3.rows.some(r => r.panel === 'A' && r.legacyErpId === 'FAB-A') && r3.rows.some(r => r.panel === 'B' && r.legacyErpId === 'FAB-B') && r3.rows.some(r => r.panel === 'C' && r.legacyErpId === 'PANEL-C' && r.uom === 'EACH'));
ok('a 22×8 strip on 54" goods = 9" cut → 0.25 yd', r3.rows.find(r => r.panel === 'A').qty === 0.25);
ok('the 23×8 cut fits the 20×40 piece turned — no warning', !r3.warnings.some(w => /does not fit/.test(w)));

// ── details ──────────────────────────────────────────────────────────────────────────────────
const rF = pricePillow({ design: design({ flange: 'FLANGE', flangeSize: 2 }), findPart, config });
ok('a flange adds its EACH charge', rF.ok && rF.unitPrice === 170 && rF.breakdown.details[0].code === 'FLANGE' && /2"/.test(rF.breakdown.details[0].label));
const rT = pricePillow({ design: design({ outerTrim: { trimId: 'TRIM-1', top: true, bottom: true, left: false, right: false } }), findPart, config });
ok('outer trim on two 22" edges = 1.222 yd × $8 = $9.78', rT.ok && near(rT.breakdown.detailTotal, 9.78) && near(rT.unitPrice, 159.78));
ok('the trim is consumed, rounded UP to 1/8 yd', rT.rows.some(r => r.legacyErpId === 'TRIM-1' && r.qty === 1.25 && r.uom === 'YARD'));
const rG = pricePillow({ design: design({ seams: [{ id: 1, treatment: 'FRINGE', trimId: 'TRIM-1', lengthIn: 18 }] }), findPart, config });
ok('a fringe seam = seam labour + fringe per yard (0.5 yd × $10) + trim consumed', rG.ok && near(rG.unitPrice, 150 + 15 + 5) && rG.rows.some(r => r.legacyErpId === 'TRIM-1' && r.qty === 0.5));

// ── quantity ─────────────────────────────────────────────────────────────────────────────────
const rQ = pricePillow({ design: design({ flange: 'WELT' }), findPart, config, qty: 4 });
ok('qty 4: holder total = 4 × unit, consumption × 4', rQ.holder.qty === 4 && rQ.holder.price === 162 && rQ.holder.total === 648 && rQ.rows.find(r => r.legacyErpId === 'FAB-A').qty === 3 && rQ.rows.find(r => r.legacyErpId === 'FILL-22').qty === 4);

// ── refusals: a missing row is named, never $0 ───────────────────────────────────────────────
const codes = (r) => r.errors.map(e => e.code);
const rNoGroup = pricePillow({ design: design({ panels: [panel('A', 'FAB-NOGROUP')] }), findPart, config });
ok('a fabric with no price group refuses', !rNoGroup.ok && codes(rNoGroup).includes('FABRIC_NO_GROUP') && rNoGroup.holder === null && rNoGroup.unitPrice === null);
const rNoSize = pricePillow({ design: design({ size: '30x30 Floor' }), findPart, config });
ok('a size with no row refuses', !rNoSize.ok && codes(rNoSize).includes('SIZE_GROUP_UNPRICED'));
const rBadSize = pricePillow({ design: design({ size: 'Lumbar' }), findPart, config });
ok('an unreadable size refuses', !rBadSize.ok && codes(rBadSize).includes('SIZE_UNREADABLE'));
const rNoFab = pricePillow({ design: design({ panels: [panel('A', '')] }), findPart, config });
ok('an unassigned panel refuses', !rNoFab.ok && codes(rNoFab).includes('FABRIC_MISSING'));
const rUnk = pricePillow({ design: design({ panels: [panel('A', 'GHOST')] }), findPart, config });
ok('an unknown fabric refuses', !rUnk.ok && codes(rUnk).includes('FABRIC_UNKNOWN'));
const rSeamless = pricePillow({ design: design({ seams: [{ id: 1, treatment: 'STANDARD', lengthIn: 10 }] }), findPart, config: { ...config, seamLabor: { perSeam: null } } });
ok('seams with no labour row refuse', !rSeamless.ok && codes(rSeamless).includes('SEAM_UNPRICED'));
const rNoDetail = pricePillow({ design: design({ flange: 'BOX' }), findPart, config });
ok('a detail with no row refuses and names it', !rNoDetail.ok && rNoDetail.errors.some(e => e.code === 'DETAIL_UNPRICED' && /BOX/.test(e.message)));
const rNoTrimPick = pricePillow({ design: design({ seams: [{ id: 1, treatment: 'FRINGE', trimId: '', lengthIn: 10 }] }), findPart, config });
ok('a fringe seam with no trim chosen refuses', !rNoTrimPick.ok && codes(rNoTrimPick).includes('TRIM_MISSING'));
const rEmpty = pricePillow({ design: design(), findPart, config: DEFAULT_PILLOW_PRICING });
ok('the empty default table prices nothing', !rEmpty.ok && rEmpty.holder === null);
ok('the default table is empty by design', Object.keys(DEFAULT_PILLOW_PRICING.prices).length === 0 && DEFAULT_PILLOW_PRICING.seamLabor.perSeam === null);

// ── from the board's pillowData ───────────────────────────────────────────────────────────────
const pd = { size: '22x22 Square', fabrics: ['FAB-A'], seams: [{ id: 1, x1: 100, y1: 100, x2: 170, y2: 100, treatment: 'STANDARD', trimId: '' }], flange: 'NONE', flangeSize: 0, fill: 'DOWN', stitch: 'STANDARD', outerTrim: { trimId: '', top: false, bottom: false, left: false, right: false } };
const d1 = designFromPillowData(pd, { pxPerIn: 7 });
ok('one fabric = one full-face panel', d1.panels.length === 1 && d1.panels[0].widthIn === 22 && d1.panels[0].heightIn === 22 && d1.panels[0].label === 'A');
ok('a drawn seam converts board px → inches', d1.seams[0].lengthIn === 10);
const rPd = pricePillow({ design: d1, findPart, config });
ok('the board\'s one-panel design prices: 150 + one seam', rPd.ok && rPd.unitPrice === 165);
const d2 = designFromPillowData({ ...pd, fabrics: ['FAB-A', 'FAB-B'] });
ok('two fabrics without geometry → panel dims unknown', d2.panels.length === 2 && d2.panels[1].widthIn === null);
const rPd2 = pricePillow({ design: d2, findPart, config });
ok('…still priced at the highest group (B), consumption null + warned', rPd2.ok && rPd2.unitPrice === 185 + 15 && rPd2.rows.find(r => r.panel === 'A').qty === null && rPd2.warnings.some(w => /dimensions unknown/.test(w)));

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
