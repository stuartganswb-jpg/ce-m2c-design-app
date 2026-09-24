// The pillow face as panels, pinned (S7, 2026-09-24): drawn seams become full dividers on their
// dominant axis, the dividers cut a grid, tags claim cells, untagged cells take panel A, and the
// panels feed the price rule with real inches — no more "dimensions unknown".
import { faceOriginOf, dividerOf, panelsOf, seamLengthIn } from '../src/components/Shared/pillowPanels.js';
import { pricePillow, designFromPillowData, DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// a 22x22 face at 7 px/in: origin (423, 223), face 154 px square
const S = 7, W = 22, H = 22;
const o = faceOriginOf({ w: W, h: H, pxPerIn: S });
ok('face origin follows the board\'s rule', o.x0 === 423 && o.y0 === 223);
const px = (xin, yin) => ({ x: o.x0 + xin * S, y: o.y0 + yin * S });

// ── dividers ─────────────────────────────────────────────────────────────────────────────────
const hSeam = { id: 1, x1: px(0, 8).x, y1: px(0, 8).y, x2: px(22, 8.2).x, y2: px(22, 8.2).y };
const d1 = dividerOf(hSeam, { w: W, h: H, pxPerIn: S });
ok('a mostly horizontal seam is a horizontal divider at its mean y (8.1")', d1.axis === 'H' && d1.at === 8.1 && d1.inside && !d1.diagonal);
const vSeam = { id: 2, x1: px(15, 0).x, y1: px(15, 0).y, x2: px(15, 22).x, y2: px(15, 22).y };
ok('a vertical seam is a vertical divider at 15"', dividerOf(vSeam, { w: W, h: H, pxPerIn: S }).axis === 'V' && dividerOf(vSeam, { w: W, h: H, pxPerIn: S }).at === 15);
const diag = { id: 3, x1: px(0, 0).x, y1: px(0, 0).y, x2: px(22, 18).x, y2: px(22, 18).y };
ok('a diagonal seam is flagged and read by its dominant axis', dividerOf(diag, { w: W, h: H, pxPerIn: S }).diagonal === true && dividerOf(diag, { w: W, h: H, pxPerIn: S }).axis === 'H');
ok('a seam on the edge cuts nothing', dividerOf({ x1: px(0, 0).x, y1: px(0, 0).y, x2: px(22, 0).x, y2: px(22, 0).y }, { w: W, h: H, pxPerIn: S }).inside === false);
ok('a zero-length seam is null', dividerOf({ x1: 1, y1: 1, x2: 1, y2: 1 }, { w: W, h: H }) === null);
ok('seam length in inches', seamLengthIn({ x1: 0, y1: 0, x2: 70, y2: 0 }, 7) === 10);

// ── the grid ─────────────────────────────────────────────────────────────────────────────────
const one = panelsOf({ w: W, h: H, seams: [], tags: [], fabrics: ['FAB-A'], pxPerIn: S });
ok('no seams = one panel, the whole face, panel A', one.panels.length === 1 && one.panels[0].label === 'A' && one.panels[0].widthIn === 22 && one.panels[0].heightIn === 22 && one.panels[0].fabricId === 'FAB-A' && one.warnings.length === 0);
const two = panelsOf({ w: W, h: H, seams: [hSeam], tags: [{ ...px(11, 3), label: 'A' }, { ...px(11, 15), label: 'B' }], fabrics: ['FAB-A', 'FAB-B'], pxPerIn: S });
ok('one horizontal seam = two panels, top 22 × 8.1 tagged A, bottom 22 × 13.9 tagged B', two.panels.length === 2 && two.panels[0].label === 'A' && two.panels[0].heightIn === 8.1 && two.panels[0].fabricId === 'FAB-A' && two.panels[1].label === 'B' && two.panels[1].heightIn === 13.9 && two.panels[1].fabricId === 'FAB-B' && two.warnings.length === 0, JSON.stringify(two));
const four = panelsOf({ w: W, h: H, seams: [hSeam, vSeam], tags: [{ ...px(5, 3), label: 'A' }, { ...px(18, 3), label: 'B' }, { ...px(5, 15), label: 'C' }, { ...px(18, 15), label: 'D' }], fabrics: ['F1', 'F2', 'F3', 'F4'], pxPerIn: S });
ok('a cross = four panels with the right sizes and fabrics', four.panels.length === 4 && four.panels.map(p => `${p.label}:${p.widthIn}x${p.heightIn}:${p.fabricId}`).join(',') === 'A:15x8.1:F1,B:7x8.1:F2,C:15x13.9:F3,D:7x13.9:F4', four.panels.map(p => `${p.label}:${p.widthIn}x${p.heightIn}:${p.fabricId}`).join(','));
const untagged = panelsOf({ w: W, h: H, seams: [hSeam], tags: [{ ...px(11, 3), label: 'A' }], fabrics: ['FAB-A', 'FAB-B'], pxPerIn: S });
ok('an untagged panel takes panel A\'s fabric, said', untagged.panels[1].fabricId === 'FAB-A' && untagged.warnings.some(w => /no tag/.test(w)));
const outside = panelsOf({ w: W, h: H, seams: [], tags: [{ x: 10, y: 10, label: 'A' }], fabrics: ['FAB-A'], pxPerIn: S });
ok('a tag outside the face is dropped, said', outside.panels.length === 1 && outside.warnings.some(w => /outside/.test(w)));
const twice = panelsOf({ w: W, h: H, seams: [], tags: [{ ...px(5, 5), label: 'A' }, { ...px(6, 6), label: 'B' }], fabrics: ['FAB-A', 'FAB-B'], pxPerIn: S });
ok('a second tag in one cell is ignored, said', twice.panels[0].fabricId === 'FAB-A' && twice.warnings.some(w => /already tagged/.test(w)));
const dup = panelsOf({ w: W, h: H, seams: [hSeam, { ...hSeam, id: 9 }], tags: [], fabrics: ['FAB-A'], pxPerIn: S });
ok('two seams on the same line make one divider', dup.panels.length === 2);
ok('no size → no panels', panelsOf({ w: 0, h: 22 }).panels.length === 0);

// ── into the price rule with real inches ──────────────────────────────────────────────────────
const SIZES = ['20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'];
const config = { ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES, prices: { '22x22': { A: 650, B: 775 } }, fabricGroups: { A: { rank: 1 }, B: { rank: 2 } }, seamLabor: { perSeam: 15 }, seamAllowanceIn: 0.5 };
const items = { 'FAB-A': { id: 'a', legacyErpId: 'FAB-A', manufacturingSpecs: { priceGroup: 'A', width: 54 } }, 'FAB-B': { id: 'b', legacyErpId: 'FAB-B', manufacturingSpecs: { priceGroup: 'B', width: 54 } }, 'CUSTOM PILLOW': { id: 'cp', legacyErpId: 'CUSTOM PILLOW' } };
const pd = { size: '22x22', fabrics: ['FAB-A', 'FAB-B'], seams: [{ ...hSeam, treatment: 'STANDARD', trimId: '' }], flange: 'NONE', fill: 'DOWN', stitch: 'STANDARD', outerTrim: { trimId: '' } };
const design = { ...designFromPillowData(pd, { pxPerIn: S }), panels: two.panels };
const priced = pricePillow({ design, findPart: (id) => items[id] || null, config });
ok('a two-panel 22x22 (A over B) prices at group B + one seam = 790, with real consumption for BOTH panels (A: 9.1" cut → ⅜ yd; B: 14.4" → ½ yd)', priced.ok && priced.unitPrice === 790 && priced.group === 'B' && priced.rows.find(r => r.panel === 'A').qty === 0.375 && priced.rows.find(r => r.panel === 'B').qty === 0.5, JSON.stringify(priced.errors) + JSON.stringify(priced.rows.map(r => [r.panel, r.qty])));
ok('no "dimensions unknown" warning any more', !priced.warnings.some(w => /dimensions unknown/.test(w)));

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
