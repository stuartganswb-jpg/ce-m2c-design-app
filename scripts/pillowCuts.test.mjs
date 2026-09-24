// Fabric cuts for standard pillows, pinned (S7, 2026-09-24): the min cut is ONE side; a fabric's
// width and railroad flag decide which way the cut comes off the roll; a ledger cut is labelled with
// the LARGEST standard size it can make; the pricing screen's min-cut edits round-trip.
import {
    sizeKeysOf, allowanceOf, defaultMinCutOf, minCutOf, sizeCutTableOf, isRailroad, fabricWidthOf,
    cutForSize, cutRowFor, largestSizeFor, sizesFor, minCutPatchOf, sizesWithMinCuts,
} from '../src/components/Shared/pillowCuts.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// the live table after Stuart's chart: ten sizes, 0.5" allowance
const SIZES = ['20x12', '24x15', '19x19', '23x23', '36x20', '45x15', '20x20', '22x22', '24x24', '52x28'];
const config = { ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES, prices: Object.fromEntries(SIZES.map(s => [s, { A: 1 }])), sizes: {}, seamAllowanceIn: 0.5 };
const savery = { legacyErpId: 'SAVERY-NAT', manufacturingSpecs: { width: 54, customData: { railroad: false } } };
const naka = { legacyErpId: 'NAKA10-FAB', manufacturingSpecs: { width: 40, customData: { railroad: true } } };
const narrow = { legacyErpId: 'NARROW', manufacturingSpecs: { width: 22 } };
const noWidth = { legacyErpId: 'NOWIDTH', manufacturingSpecs: {} };

// ── the min cut ──────────────────────────────────────────────────────────────────────────────
ok('sizes come in chart order', sizeKeysOf(config).join(',') === SIZES.join(','));
ok('allowance read (0.5) and defaulted', allowanceOf(config) === 0.5 && allowanceOf({}) === 0.5);
ok('20x12 = 20 wide × 12 tall → default one-side cut 13" long × 21" wide', JSON.stringify(defaultMinCutOf('20x12', config)) === JSON.stringify({ lengthIn: 13, widthIn: 21, derived: true }));
ok('52x28 → 29" × 53"', defaultMinCutOf('52x28', config).lengthIn === 29 && defaultMinCutOf('52x28', config).widthIn === 53);
ok('a stored min cut wins over the default', (() => { const c = { ...config, sizes: { '20x12': { minCut: { lengthIn: 14, widthIn: 22 } } } }; const m = minCutOf('20x12', c); return m.lengthIn === 14 && m.widthIn === 22 && m.derived === false; })());
ok('a half-stored min cut falls back to the default', minCutOf('20x12', { ...config, sizes: { '20x12': { minCut: { lengthIn: 14 } } } }).derived === true);
ok('an unreadable size has no cut', minCutOf('Lumbar', config) === null);
ok('the table lists every size with dims, area and cut', (() => { const t = sizeCutTableOf(config); return t.length === 10 && t[0].w === 20 && t[0].h === 12 && t[0].areaSqIn === 240 && t[0].minCut.lengthIn === 13; })());

// ── the fabric's orientation ─────────────────────────────────────────────────────────────────
ok('railroad reads the fabric-level flag only', isRailroad(naka) && !isRailroad(savery) && !isRailroad(null) && isRailroad({ manufacturingSpecs: { customData: { railroad: 'TRUE' } } }));
ok('bolt width read', fabricWidthOf(savery) === 54 && fabricWidthOf(noWidth) === null);
const c1 = cutForSize({ sizeKey: '20x12', fabric: savery, config });
ok('standard: 20x12 on 54" goods = 13" off the roll, needs 21" of width, fits', c1.lengthIn === 13 && c1.widthNeededIn === 21 && c1.fits === true && c1.railroad === false);
const c2 = cutForSize({ sizeKey: '20x12', fabric: naka, config });
ok('railroad: the same size turned = 21" off the roll, needs 13" of width', c2.lengthIn === 21 && c2.widthNeededIn === 13 && c2.fits === true && c2.railroad === true);
const c3 = cutForSize({ sizeKey: '52x28', fabric: naka, config });
ok('52x28 on a 40" railroad fabric: 53" off the roll, needs 29" — fits', c3.lengthIn === 53 && c3.widthNeededIn === 29 && c3.fits === true);
const c4 = cutForSize({ sizeKey: '52x28', fabric: narrow, config });
ok('52x28 on 22" goods (not railroad) needs 53" of width — does NOT fit', c4.fits === false);
ok('a fabric with no width makes no claim (fits null)', cutForSize({ sizeKey: '20x12', fabric: noWidth, config }).fits === null);
ok('explicit width / railroad override the fabric', cutForSize({ sizeKey: '20x12', widthIn: 30, railroad: true, config }).lengthIn === 21);
const row = cutRowFor(savery, config);
ok('a fabric\'s cut row spans every size in order', row.length === 10 && row.map(r => r.sizeKey).join(',') === SIZES.join(',') && row[9].lengthIn === 29 && row[9].fits === true);
ok('narrow goods: the row says which sizes cannot be cut', cutRowFor(narrow, config).filter(r => r.fits === false).map(r => r.sizeKey).join(',') === '24x15,23x23,36x20,45x15,22x22,24x24,52x28');

// ── the largest size a cut can make ──────────────────────────────────────────────────────────
const l1 = largestSizeFor({ cut: { lengthIn: 20, widthIn: 54 }, config });
ok('a 20" × 54" cut of standard goods makes up to 45x15 (16" × 46") — the biggest pillow by AREA that fits, not the squarest', l1 && l1.key === '45x15' && l1.cut.lengthIn === 16 && l1.cut.widthNeededIn === 46, JSON.stringify(l1));
const l2 = largestSizeFor({ cut: { lengthIn: 18, widthIn: 54 }, config });
ok('an 18" × 54" cut makes up to 45x15 (16" × 46") — the biggest by area that fits', l2 && l2.key === '45x15', JSON.stringify(l2));
const l3 = largestSizeFor({ cut: { lengthIn: 30, widthIn: 54 }, config });
ok('a 30" × 54" cut makes 52x28 (29" × 53")', l3 && l3.key === '52x28');
const l4 = largestSizeFor({ cut: { lengthIn: 30, widthIn: 40 }, config });
ok('the same 30" cut on 40"-wide goods cannot make 52x28 — next is 36x20 (21" × 37")', l4 && l4.key === '36x20', JSON.stringify(l4));
const l5 = largestSizeFor({ cut: { lengthIn: 54, widthIn: 40 }, railroad: true, config });
ok('railroad: a 54" × 40" cut turned makes 52x28 (53" along the roll, 29" of width)', l5 && l5.key === '52x28');
ok('a cut too small for any size → null', largestSizeFor({ cut: { lengthIn: 10, widthIn: 54 }, config }) === null);
ok('a nonsense cut → null', largestSizeFor({ cut: { lengthIn: 0, widthIn: 54 }, config }) === null && largestSizeFor({ cut: null, config }) === null);
const all = sizesFor({ cut: { lengthIn: 20, widthIn: 54 }, config });
ok('sizesFor lists every size that fits, largest area first', all.map(s => s.key).join(',') === '45x15,19x19,24x15,20x12', all.map(s => s.key).join(','));
ok('a 21" × 54" cut is one size better: 36x20 (21" × 37", 720 sq in)', largestSizeFor({ cut: { lengthIn: 21, widthIn: 54 }, config }).key === '36x20');
ok('on 40"-wide goods 36x20 still fits (37" of width)', largestSizeFor({ cut: { lengthIn: 21, widthIn: 40 }, config }).key === '36x20');
ok('on 36"-wide goods the same 21" cut cannot make 36x20 — 20x20 (21" × 21") is the largest', largestSizeFor({ cut: { lengthIn: 21, widthIn: 36 }, config }).key === '20x20');
ok('a cut against an empty table → null (nothing to make)', largestSizeFor({ cut: { lengthIn: 40, widthIn: 54 }, config: DEFAULT_PILLOW_PRICING }) === null);

// ── the editor round trip ────────────────────────────────────────────────────────────────────
const patch = minCutPatchOf([{ key: '20x12', lengthIn: '14', widthIn: '22' }, { key: '24x15', lengthIn: '', widthIn: '' }]);
ok('typed cuts save, blanks return the size to its default', patch.ok && patch.minCuts['20x12'].lengthIn === 14 && patch.minCuts['24x15'] === null);
ok('a half-typed cut refuses and names the size', !minCutPatchOf([{ key: '20x12', lengthIn: '14', widthIn: '' }]).ok && /20x12/.test(minCutPatchOf([{ key: '20x12', lengthIn: '14', widthIn: '' }]).errors[0]));
ok('a bad size key refuses', !minCutPatchOf([{ key: 'big', lengthIn: 1, widthIn: 1 }]).ok);
const sizes = sizesWithMinCuts({ sizes: { '20x12': { label: '20x12', fillItem: 'F' }, '24x15': { label: '24x15', minCut: { lengthIn: 9, widthIn: 9 } } } }, patch.minCuts);
ok('the sizes map keeps fill items and drops a cleared cut', sizes['20x12'].fillItem === 'F' && sizes['20x12'].minCut.lengthIn === 14 && !('minCut' in sizes['24x15']));
ok('after the patch the stored cut is what minCutOf reads', minCutOf('20x12', { ...config, sizes }).lengthIn === 14 && minCutOf('24x15', { ...config, sizes }).derived === true);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
