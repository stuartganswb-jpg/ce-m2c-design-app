// The pillow line's facts in the cart, pinned (S7, 2026-10-17): read from the design, the treatment named with its
// placement and colour, a one-of-a-kind by its tag, nothing for an ordinary line.
import { cartLineFactsOf } from '../src/components/Shared/cartLineFacts.js';
import { quickSellDesignOf } from '../src/components/Shared/pillowQuickSell.js';
import { colourwaysOf } from '../src/components/Shared/pillowCatalog.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const item = (code, extra = {}) => ({ id: `ID-${code}`, legacyErpId: code, itemName: extra.name || code, manufacturingSpecs: { ...(extra.specs || {}) } });
const lib = [item('Bell/10F', { specs: { productType: 'FABRIC', priceGroup: 'C', width: 54, uom: 'RY' } }), item('Bell/10P19x19', { specs: { basePrice: 500 } }), item('Brush fringe', { specs: { productType: 'TRIMMING', uom: 'RY' } })];
const findPart = (id) => lib.find(x => x.id === id) || null;
const cw = colourwaysOf(lib).list.find(c => c.key === 'BELL/10');
const row = (facts, label) => (facts.find(f => f.label === label) || {}).value;

const mid = cartLineFactsOf({ pillow: { sizeKey: '19x19', group: 'C', standardSku: 'Bell/10P19x19', design: quickSellDesignOf({ cw, sizeKey: '19x19', treatment: 'STITCH_BLANKET', placement: 'MIDDLE', colour: 'Burnt Orange', fill: 'DOWN' }) } }, { findPart });
ok('down the middle: the seam row says the stitch and the colour under its placement; the edge is knife', row(mid, 'size') === '19x19 (19" wide × 19" tall)' && row(mid, 'fabric') === 'Bell/10F · group C' && row(mid, 'edge') === 'knife edge' && row(mid, 'down the middle') === 'blanket stitch · burnt orange' && row(mid, 'fill') === 'down' && row(mid, 'standard') === 'Bell/10P19x19' && !row(mid, 'round the 4 sides') && !row(mid, 'seams'));
const four = cartLineFactsOf({ pillow: { sizeKey: '19x19', group: 'C', design: quickSellDesignOf({ cw, sizeKey: '19x19', edge: 'FLANGE', treatment: 'LEATHER_WELT', placement: 'FOUR_SIDES', colour: 'Rust', trimId: 'ID-Brush fringe' }) } }, { findPart });
ok('4 sides: the leather with its NAU code under "round the 4 sides", the flange edge, the trim on every edge', row(four, 'round the 4 sides') === 'leather welt · rust NAU330/434' && row(four, 'edge') === 'flange' && row(four, 'trim') === 'Brush fringe on top, bottom, left, right' && !row(four, 'down the middle'));
const plain = cartLineFactsOf({ pillow: { sizeKey: '23x23', group: 'A', design: quickSellDesignOf({ cw, sizeKey: '23x23' }) } }, { findPart });
ok('a plain pillow says "stitch / leather: none"', row(plain, 'stitch / leather') === 'none' && row(plain, 'edge') === 'knife edge');
const board = cartLineFactsOf({ pillow: { sizeKey: '22x22', group: 'C', design: { size: '22x22', fill: 'DOWN', flange: 'NONE', panels: [{ fabricId: 'ID-Bell/10F' }], seams: [{ id: 1, treatment: 'STANDARD' }, { id: 2, treatment: 'LEATHER_MINI_WELT', colour: 'Cactus' }], edgeTreatment: { code: 'STITCH_RAILROAD', colour: 'Cream' }, outerTrim: {} } } }, { findPart });
ok('a board design: the edge stitch round the 4 sides, the leather on a seam, one plain seam counted', row(board, 'round the 4 sides') === 'railroad stitch · cream' && row(board, 'on a seam') === 'mini leather welt · cactus NAU320/445' && row(board, 'seams') === '1 drawn');
ok('a one-of-a-kind line shows its tag; an ordinary line nothing', cartLineFactsOf({ oneOfAKind: { code: 'BP-FW10-11' } })[0].value === 'BP-FW10-11' && cartLineFactsOf({ erp: 'Bell/10T' }).length === 0 && cartLineFactsOf(null).length === 0);
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
