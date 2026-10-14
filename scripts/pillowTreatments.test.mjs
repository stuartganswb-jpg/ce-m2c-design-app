// The stitch / leather treatments, pinned (S7, 2026-10-14): four treatments, two counter placements, the
// yarn card and the NAU leather lists, the words that ride the sewing document, and the pricing — one
// charge per placement, same price every colour, the counter's middle seam carries no seam labour.
import { TREATMENTS, PLACEMENTS, YARN_COLOURS, LEATHER_COLOURS, treatmentOf, isTreatmentCode, coloursOf, colourOf, treatmentsOffered, treatmentWordsOf, treatmentsOfDesign, treatmentWordsOfDesign, BUILT_IN_TREATMENT_DETAILS } from '../src/components/Shared/pillowTreatments.js';
import { pricePillow, designFromPillowData, DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';
import { quickSellDesignOf, quickSellPlanOf, quickSellTreatmentsOf } from '../src/components/Shared/pillowQuickSell.js';
import { pillowSummaryOf } from '../src/components/Shared/pillowRequest.js';
import { colourwaysOf } from '../src/components/Shared/pillowCatalog.js';
import { BUILT_IN_DETAILS, detailRowsOf } from '../src/components/Shared/pillowPriceSheet.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// ── the lists ─────────────────────────────────────────────────────────────────────────────────
ok('four treatments, two placements', TREATMENTS.length === 4 && PLACEMENTS.map(p => p.code).join() === 'FOUR_SIDES,MIDDLE');
ok('the yarn card has 15 colours, white first, black last', YARN_COLOURS.length === 15 && YARN_COLOURS[0].name === 'White' && YARN_COLOURS[14].name === 'Black');
ok('leather welt 7 colours on NAU330, mini welt 5 on NAU320', LEATHER_COLOURS.LEATHER_WELT.length === 7 && LEATHER_COLOURS.LEATHER_MINI_WELT.length === 5 && coloursOf('LEATHER_WELT')[0].code === 'NAU330/406' && coloursOf('LEATHER_MINI_WELT')[1].code === 'NAU320/445');
ok('a stitch offers the yarn card with no code; leather carries the NAU code', coloursOf('STITCH_BLANKET').length === 15 && coloursOf('STITCH_BLANKET')[2].code === '' && colourOf('leather_welt', 'taupe').code === 'NAU330/406');
ok('an unknown code is nothing', treatmentOf('FLANGE') === null && !isTreatmentCode('WELT') && coloursOf('X').length === 0 && colourOf('STITCH_RAILROAD', 'Pink') === null);
ok('the four built-in detail rows are kind TREATMENT per EACH and sit in the price sheet after the four originals', BUILT_IN_TREATMENT_DETAILS.every(r => r.kind === 'TREATMENT' && r.per === 'EACH') && BUILT_IN_DETAILS.length === 8 && detailRowsOf({}).map(r => r.code).slice(4).join() === 'STITCH_RAILROAD,STITCH_BLANKET,LEATHER_WELT,LEATHER_MINI_WELT');

const config = {
    ...DEFAULT_PILLOW_PRICING, sizeOrder: ['19x19', '22x22'],
    prices: { '19x19': { A: 375, C: 500 }, '22x22': { A: 650, C: 875 } },
    fabricGroups: { A: { rank: 1 }, C: { rank: 3 } },
    seamLabor: { perSeam: 25 },
    details: { FLANGE: { price: 40, per: 'EACH' }, STITCH_RAILROAD: { price: 50, per: 'EACH', kind: 'TREATMENT' }, STITCH_BLANKET: { price: 50, per: 'EACH', kind: 'TREATMENT' }, LEATHER_WELT: { price: 65, per: 'EACH', kind: 'TREATMENT' } },
    seamAllowanceIn: 0.5, yardRounding: 0.125, rollupItem: { legacyErpId: 'CUSTOM PILLOW', itemId: '' },
};
ok('the price table offers the three priced treatments, not the mini welt (blank)', treatmentsOffered(config).map(t => t.code).join() === 'STITCH_RAILROAD,STITCH_BLANKET,LEATHER_WELT' && treatmentsOffered(config)[2].price === 65 && quickSellTreatmentsOf(DEFAULT_PILLOW_PRICING).length === 0);

// ── the words ─────────────────────────────────────────────────────────────────────────────────
ok('words: blanket stitch · down the middle · burnt orange', treatmentWordsOf({ code: 'STITCH_BLANKET', placement: 'MIDDLE', colour: 'Burnt Orange' }) === 'blanket stitch · down the middle · burnt orange');
ok('words: leather welt · 4 sides · taupe NAU330/406', treatmentWordsOf({ code: 'LEATHER_WELT', placement: 'FOUR_SIDES', colour: 'taupe' }) === 'leather welt · 4 sides · taupe NAU330/406');
ok('words on a drawn seam', treatmentWordsOf({ code: 'LEATHER_MINI_WELT', placement: 'SEAM', colour: 'Cactus' }) === 'mini leather welt · on a seam · cactus NAU320/445');

// ── the library + the counter design ──────────────────────────────────────────────────────────
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, netSuiteInternalId: '1', manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [
    item('Bell/10P19x19', { name: 'Bell Pillow color 10 Natural & Cream 19" x 19"', specs: { basePrice: 500 } }),
    item('Bell/10T', { name: 'Bell color 10 Natural & Cream 71" x 51"', specs: { basePrice: 420 } }),
    item('Bell/10F', { name: 'Bell fabric color 10', specs: { productType: 'FABRIC', priceGroup: 'C', width: 54, uom: 'RY' } }),
    item('Custom Pillow', { name: 'Pillow with customized options' }),
];
const findPart = (id) => lib.find(x => x.id === id) || lib.find(x => String(x.legacyErpId).toUpperCase() === String(id || '').toUpperCase()) || null;
const cat = colourwaysOf(lib);
const bell10 = cat.list.find(c => c.key === 'BELL/10');

const dFour = quickSellDesignOf({ cw: bell10, sizeKey: '19x19', treatment: 'LEATHER_WELT', placement: 'FOUR_SIDES', colour: 'Rust' });
ok('4 sides: one whole face panel, the edge treatment set, no seam', dFour.panels.length === 1 && dFour.panels[0].widthIn === 19 && dFour.edgeTreatment.code === 'LEATHER_WELT' && dFour.edgeTreatment.colour === 'Rust' && dFour.seams.length === 0);
const dMid = quickSellDesignOf({ cw: bell10, sizeKey: '19x19', treatment: 'STITCH_BLANKET', placement: 'MIDDLE', colour: 'Denim' });
ok('down the middle: two half-width face panels of the same fabric, one included seam down the middle, no edge treatment', dMid.panels.length === 2 && dMid.panels[0].widthIn === 9.5 && dMid.panels[1].widthIn === 9.5 && dMid.panels[1].heightIn === 19 && dMid.panels[0].fabricId === dMid.panels[1].fabricId && dMid.seams.length === 1 && dMid.seams[0].middle === true && dMid.seams[0].included === true && dMid.seams[0].treatment === 'STITCH_BLANKET' && dMid.seams[0].colour === 'Denim' && dMid.edgeTreatment === null);
ok('the design lists its treatments', treatmentsOfDesign(dMid).length === 1 && treatmentsOfDesign(dMid)[0].placement === 'MIDDLE' && treatmentsOfDesign(dFour)[0].placement === 'FOUR_SIDES' && treatmentsOfDesign(dFour)[0].colourCode === 'NAU330/434');

// ── the pricing ───────────────────────────────────────────────────────────────────────────────
const pFour = pricePillow({ design: dFour, findPart, config });
ok('4 sides leather welt on a 19x19 group C = 500 + 65, no seam labour', pFour.ok && pFour.unitPrice === 565 && pFour.breakdown.seams.count === 0 && pFour.breakdown.details[0].code === 'LEATHER_WELT' && /rust NAU330\/434/.test(pFour.breakdown.details[0].label));
const pMid = pricePillow({ design: dMid, findPart, config });
ok('down the middle blanket stitch = 500 + 50 — the included seam carries NO seam labour', pMid.ok && pMid.unitPrice === 550 && pMid.breakdown.seams.count === 0 && pMid.breakdown.treatments.length === 1);
ok('the middle design cuts two half panels + the back: A 9.5×19, B 9.5×19, BACK 19×19', pMid.rows.filter(r => r.panel).map(r => `${r.panel}:${r.perPillow}`).join() === 'A:0.625,B:0.625,BACK:0.625');
const pNoColour = pricePillow({ design: quickSellDesignOf({ cw: bell10, sizeKey: '19x19', treatment: 'STITCH_RAILROAD', placement: 'FOUR_SIDES', colour: '' }), findPart, config });
ok('a treatment with no colour refuses by name', !pNoColour.ok && pNoColour.errors.some(e => e.code === 'TREATMENT_NO_COLOUR'));
const pUnpriced = pricePillow({ design: quickSellDesignOf({ cw: bell10, sizeKey: '19x19', treatment: 'LEATHER_MINI_WELT', placement: 'FOUR_SIDES', colour: 'Mauve' }), findPart, config });
ok('an unpriced treatment refuses as any detail does', !pUnpriced.ok && pUnpriced.errors.some(e => e.code === 'DETAIL_UNPRICED' && /LEATHER_MINI_WELT/.test(e.message)));

// the board: a drawn seam in any position carries one — seam labour + the treatment; the edge picker takes one round the four sides
const pd = { size: '22x22 Square', fabrics: ['ID-Bell/10F'], seams: [{ id: 1, x1: 100, y1: 100, x2: 170, y2: 100, treatment: 'LEATHER_WELT', trimId: '', colour: 'Black' }], flange: 'FLANGE', flangeSize: 2, fill: 'DOWN', stitch: 'STANDARD', edgeTreatment: { code: 'STITCH_RAILROAD', colour: 'Cream' }, outerTrim: { trimId: '', top: false, bottom: false, left: false, right: false } };
const dBoard = designFromPillowData(pd, { pxPerIn: 7 });
ok('the board design carries the edge treatment and the seam colour', dBoard.edgeTreatment.code === 'STITCH_RAILROAD' && dBoard.seams[0].colour === 'Black' && !dBoard.seams[0].included);
const pBoard = pricePillow({ design: dBoard, findPart, config });
ok('the board: 875 + flange 40 + railroad 4 sides 50 + seam labour 25 + leather welt on the seam 65 = 1055', pBoard.ok && pBoard.unitPrice === 1055 && pBoard.breakdown.seams.count === 1 && pBoard.breakdown.treatments.map(t => t.placement).join() === 'FOUR_SIDES,SEAM');
ok('the board design ignores an edge treatment that is not a treatment code', designFromPillowData({ ...pd, edgeTreatment: { code: 'WELT', colour: '' } }).edgeTreatment === null);
ok('the summary carries the words for the sewing document', pillowSummaryOf({ priced: pBoard, geometry: null, design: dBoard }) === '22x22 · group C · 1 seam · flange · railroad stitch · 4 sides · cream · leather welt · on a seam · black NAU330/444 · down' && treatmentWordsOfDesign(dBoard).split(' · ').length === 6);

// ── the quick sell plan ───────────────────────────────────────────────────────────────────────
const plan = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', treatment: 'STITCH_BLANKET', placement: 'MIDDLE', colour: 'Burnt Orange', qty: 2, available: 5, config, findPart });
ok('a treatment makes the line made to order even with the SKU on the shelf, the SKU named', plan.ok && plan.kind === 'MTO' && plan.why === 'OPTIONS' && plan.note === 'standard Bell/10P19x19' && plan.mto.unitPrice === 550);
ok('its summary says the stitch, the placement and the colour', /blanket stitch · down the middle · burnt orange/.test(plan.summary) && /19x19/.test(plan.summary));
ok('its line carries both half panels and the fabric pulls for 2 pillows', plan.mto.line.panels.length === 2 && plan.mto.line.consumed.find(c => c.panel === 'B').qty === 1.25);
const plainPlan = quickSellPlanOf({ cw: bell10, sizeKey: '19x19', qty: 1, available: 5, config, findPart });
ok('no treatment = the plain SKU, unchanged', plainPlan.ok && plainPlan.kind === 'SKU');
ok('a treatment with no colour refuses on the plan', quickSellPlanOf({ cw: bell10, sizeKey: '19x19', treatment: 'LEATHER_WELT', placement: 'FOUR_SIDES', colour: '', config, findPart }).errors[0].code === 'TREATMENT_NO_COLOUR');
ok('a wrong placement or an unknown treatment refuse', quickSellPlanOf({ cw: bell10, sizeKey: '19x19', treatment: 'LEATHER_WELT', placement: 'CORNER', colour: 'Rust', config, findPart }).errors[0].code === 'PLACEMENT_UNKNOWN' && quickSellPlanOf({ cw: bell10, sizeKey: '19x19', treatment: 'PIPING', colour: 'Rust', config, findPart }).errors[0].code === 'TREATMENT_UNKNOWN');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
