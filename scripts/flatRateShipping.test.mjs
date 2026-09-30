// 📦 Flat-rate shipping, counted in boxes (Eric 2026-09-29 · Stuart 2026-09-30).   node scripts/flatRateShipping.test.mjs
import {
    boxKeyFor, cutPiecesOf, splicePositionsOf, polePiecesOf, shippingPlanOf, shippingChargeOf, isShippingItem, isTraverseLine, FLAT_RATE_BOXES,
} from '../src/components/Shared/flatRateShipping.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// A cart line the way the configurator writes it.
const line = ({ len, qty = 1, setup = 'SINGLE', rodKind = '', splices = 0, note = '', returns = 0, noRod = false, code = 'H1-1R' }) => ({
    engine: 'TAGS', qty, assemblyName: 'H1-1',
    engineConfig: { lengthInches: len, answers: { setup, mount: 'WALL', ...(rodKind ? { rodKind } : {}) } },
    pricingBreakdown: [
        ...(noRod ? [] : [{ legacyErpId: code, qty: 1, perFoot: true, feet: Math.ceil(len / 12), cutLength: len }]),
        ...(noRod ? [] : setup === 'DOUBLE' ? [{ legacyErpId: code, qty: 1, perFoot: true, cutLength: len }] : []),
        { legacyErpId: 'H1-1CC/P', qty: 2 },
        ...(splices ? [{ legacyErpId: 'H1-1JNR', name: 'Joiner for 1" Round', qty: splices, addedByHand: true, ...(note ? { customNote: note } : {}) }] : []),
        ...(returns ? [{ legacyErpId: 'H1-MRPF', name: 'MITER RETURN', qty: returns, isFee: true }] : []),
        { legacyErpId: 'H1-1BS/P', qty: 3 },
    ],
});
const S = (plan) => [plan.counts.S, plan.counts.M, plan.counts.L, plan.counts.XL];

// ── the bands ───────────────────────────────────────────────────────────────────────────────
eq('bands meet: 47.9 S · 48 M · 94.5 M · 95 L · 104.9 L · 105 XL · 120 XL', [47.9, 48, 94.5, 95, 104.9, 105, 120].map(boxKeyFor), ['S', 'M', 'M', 'L', 'L', 'XL', 'XL']);

// ── Eric's order: one 1" rod at 116" ───────────────────────────────────────────────────────
let p = shippingPlanOf([line({ len: 116 })]);
eq('Eric\'s 116" rod: one small box and one XL (the H1-SHIP-XL he named)', S(p), [1, 0, 0, 1]);
const prices = { 'H1-SHIP-S': 22.5, 'H1-SHIP-M': 45, 'H1-SHIP-L': 155, 'H1-SHIP-XL': 300 };
let c = shippingChargeOf(p, (code) => prices[code] ?? null);
eq('…$22.50 + $300 = $322.50', [c.rows.map(r => `${r.qty}×${r.code}`), c.total], [['1×H1-SHIP-S', '1×H1-SHIP-XL'], 322.5]);

// ── windows: a line × qty 3 is three windows ────────────────────────────────────────────────
p = shippingPlanOf([line({ len: 90, qty: 3 })]);
eq('three windows → two small boxes; three 90" poles → one M', S(p), [2, 1, 0, 0]);
eq('five 90" poles → two M boxes (4 + 1)', S(shippingPlanOf([line({ len: 90, qty: 5 })])), [3, 2, 0, 0]);
eq('a line with no rod still counts as a window', S(shippingPlanOf([line({ len: 0, noRod: true }), line({ len: 0, noRod: true })])), [1, 0, 0, 0]);

// ── splices ship as their pieces ────────────────────────────────────────────────────────────
p = shippingPlanOf([line({ len: 144, splices: 1 })]);
eq('144" spliced once (centre) → two 72" pieces in one M box, not an XL', [S(p), p.boxes[0].pieces], [[1, 1, 0, 0], [72, 72]]);
eq('the noted spots are used when the note names every splice', cutPiecesOf(144, 2, '36" from left edge · 36" from right edge'), [36, 72, 36]);
eq('…and read the other wordings too', splicePositionsOf('24 in from the left, center', 120), [24, 60]);
eq('a note that does not name them all → even pieces', cutPiecesOf(150, 2, 'near the window'), [50, 50, 50]);
eq('no splice → the whole length', cutPiecesOf(116, 0), [116]);

// ── shorter poles ride with longer; the box bills as its longest ────────────────────────────
p = shippingPlanOf([line({ len: 110 }), line({ len: 90, qty: 5 })]);
eq('a 110" and five 90" poles → one XL (room for 10), no M', S(p), [3, 0, 0, 1]);
eq('…its pieces, longest first', p.boxes[0].pieces, [110, 90, 90, 90, 90, 90]);
p = shippingPlanOf([line({ len: 100, qty: 4 }), line({ len: 60, qty: 2 })]);
eq('four 100" fill an L; two 60" open an M', S(p), [3, 1, 1, 0]);

// ── returns take more room ──────────────────────────────────────────────────────────────────
p = shippingPlanOf([line({ len: 90, returns: 2, qty: 2 }), line({ len: 90 })]);
eq('two 90" poles with returns fill an M (two a box); the plain one opens another', S(p), [2, 2, 0, 0]);
p = shippingPlanOf([line({ len: 110, returns: 2, qty: 6 }), line({ len: 108 })]);
eq('six XL poles with returns fill an XL; a seventh pole opens another', [p.counts.XL, p.boxes.map(b => [b.returns, b.plain])], [2, [[6, 0], [0, 1]]]);
p = shippingPlanOf([line({ len: 110, returns: 1 }), line({ len: 110, qty: 8 })]);
eq('one return + eight plain fit an XL (1/6 + 8/10 ≤ 1)', p.counts.XL, 1);
eq('a spliced pole with returns at both ends: both end pieces carry a return', polePiecesOf(line({ len: 150, splices: 2, returns: 2 })).map(x => x.withReturn), [true, false, true]);
eq('one return: only the first piece', polePiecesOf(line({ len: 144, splices: 1, returns: 1 })).map(x => x.withReturn), [true, false]);

// ── doubles and traverses ───────────────────────────────────────────────────────────────────
eq('a double is two runs; two joiners → one each', polePiecesOf(line({ len: 100, setup: 'DOUBLE', splices: 2 })).map(x => x.lengthIn), [50, 50, 50, 50]);
eq('a double with three returns: two on the first run, one on the second', polePiecesOf(line({ len: 90, setup: 'DOUBLE', returns: 3 })).map(x => x.withReturn), [true, true]);
const trv = line({ len: 60, qty: 2, rodKind: 'TRAVERSE', code: 'H1-2RCTWR-W' });
trv.pricingBreakdown.push({ legacyErpId: 'H1-2TRV', qty: 1, perFoot: true, cutLength: 58 }, { legacyErpId: 'H1-2TRVCLP', qty: 1, cutLength: 57 });
ok('a traverse line is known by its rodKind', isTraverseLine(trv) && !isTraverseLine(line({ len: 60 })));
eq('a traverse ships one pole a run at its length (track and clips ride with it)', polePiecesOf(trv).map(x => [x.lengthIn, x.traverse]), [[60, true]]);
p = shippingPlanOf([trv, line({ len: 116 })]);
eq('…in the boxes like any pole, and its configurations are counted for H1-PCKF2', [S(p), p.traverseConfigs], [[2, 0, 0, 1], 2]);

// ── edges ───────────────────────────────────────────────────────────────────────────────────
p = shippingPlanOf([line({ len: 36 })]);
eq('a 36" pole rides in the small box', [S(p), p.shortPoles], [[1, 0, 0, 0], 1]);
eq('an unspliced 130" pole is named as too long for any box', shippingPlanOf([line({ len: 130 })]).tooLong, 1);
eq('an empty cart ships nothing', S(shippingPlanOf([])), [0, 0, 0, 0]);
c = shippingChargeOf(shippingPlanOf([line({ len: 116 })]), (code) => (code === 'H1-SHIP-S' ? 22.5 : null));
eq('a box this customer has no price for is named, not guessed', [c.total, c.missing], [22.5, ['H1-SHIP-XL']]);

// ── shipping is never a line ────────────────────────────────────────────────────────────────
ok('each box item is shipping', FLAT_RATE_BOXES.every(b => isShippingItem({ legacyErpId: b.code })));
ok('the packaging fees and PENDING records are not', !isShippingItem({ legacyErpId: 'H1-PCKF2' }) && !isShippingItem({ legacyErpId: 'PENDING', itemId: 'CE-INV-2535' }));
ok('a record known by its itemId only is still recognised', isShippingItem({ legacyErpId: 'PENDING', itemId: 'h1-ship-m' }));

console.log(`flatRateShipping: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
