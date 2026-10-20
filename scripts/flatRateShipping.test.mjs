// 📦 Flat-rate shipping, counted in boxes (Eric 2026-09-29 · Stuart 2026-09-30).   node scripts/flatRateShipping.test.mjs
import {
    boxKeyFor, cutPiecesOf, splicePositionsOf, polePiecesOf, shippingPlanOf, shippingChargeOf, isShippingItem, isTraverseLine, FLAT_RATE_BOXES,
    packFeeFor, packagingFeeOf, packagingPlanOf, orderPackagingPlanOf, STANDARD_PACK_FEE_CODE, LARGE_PACK_FEE_CODE, TRAVERSE_PACK_FEE_CODE, PACK_FEE_CODES, orderShippingPlanOf } from '../src/components/Shared/flatRateShipping.js';
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

// ── a fee row the engine did not flag (2026-10-12) ─────────────────────────────────────────────────────────
// The tags engine writes a walked-in return fee with NO isFee; the caller that knows the library says it is one.
const unflag = (it) => ({ ...it, pricingBreakdown: it.pricingBreakdown.map(l => { const { isFee, ...rest } = l; return rest; }) });
const FEES = new Set(['H1-MRPF', 'H1-FRPF', 'H1-2TRMR', 'H1-BOWF', 'H1-MRBAYF', '138TRVMTR']);
const isFee = (l) => FEES.has(String(l.legacyErpId || '').toUpperCase());
const bare = unflag(line({ len: 100, returns: 2 }));
eq('an unflagged return row counts for nothing without the library…', polePiecesOf(bare).map(x => x.withReturn), [false]);
eq('…and as a return with it', polePiecesOf(bare, { isFee }).map(x => x.withReturn), [true]);
eq('three poles with returns: two boxes once the returns are seen, one while they are not',
    [shippingPlanOf([unflag(line({ len: 100, returns: 2, qty: 3 }))]).counts.L, shippingPlanOf([unflag(line({ len: 100, returns: 2, qty: 3 }))], { isFee }).counts.L], [1, 2]);
ok('a cover plate FOR returns and a return ARM are parts, not returns',
    !polePiecesOf({ ...line({ len: 100 }), pricingBreakdown: [...line({ len: 100 }).pricingBreakdown, { legacyErpId: 'H1-75RCP-R/P', name: 'Round Cover Plate for Returns', qty: 2 }, { legacyErpId: 'H1-2TRVSRA', name: 'Traverse End Return Arm (3-5/8" P)', qty: 2 }] }, { isFee })[0].withReturn);

// ── 📦 the packaging fee (Stuart 2026-10-12) ───────────────────────────────────────────────────────────────
const S12 = STANDARD_PACK_FEE_CODE, L25 = LARGE_PACK_FEE_CODE;
eq('the two fees, and the traverse constant still names the $25 one', [S12, L25, TRAVERSE_PACK_FEE_CODE, [...PACK_FEE_CODES]], ['H1-PCKF1', 'H1-PCKF2', 'H1-PCKF2', ['H1-PCKF1', 'H1-PCKF2']]);
eq('a plain pole takes the standard fee', packFeeFor({ lengthIn: 96 }), { code: S12, why: [] });
eq('motorized, returns, a bend, over 16 ft — each alone is the $25 fee, and it says why',
    [packFeeFor({ motorized: true }), packFeeFor({ returns: 1 }), packFeeFor({ shaped: true }), packFeeFor({ lengthIn: 193 })].map(f => [f.code, f.why.join()]),
    [[L25, 'motorized'], [L25, 'returns'], [L25, 'curved or bay'], [L25, 'over 16 ft']]);
eq('16 ft exactly is not over 16 ft', packFeeFor({ lengthIn: 192 }).code, S12);
const withRow = (it, row) => ({ ...it, pricingBreakdown: [...it.pricingBreakdown, row] });
const manualTrv = line({ len: 60, rodKind: 'TRAVERSE', code: 'H1-2RCTWR-W' });
const motorTrv = { ...manualTrv, engineConfig: { ...manualTrv.engineConfig, answers: { ...manualTrv.engineConfig.answers, drive: 'MOTORIZED' } } };
const kitMotor = { ...manualTrv, engineConfig: { ...manualTrv.engineConfig, kitMotor: 'H1-2TRV-4M/W-60W' } };
eq('a manual traverse is the standard fee — it was $25 on every traverse (QUO201 / 202 / 204)', packagingFeeOf(manualTrv).code, S12);
eq('a motorized one is $25, by its drive answer or by its per-motor kit', [packagingFeeOf(motorTrv).code, packagingFeeOf(kitMotor).code], [L25, L25]);
eq('a pole with a miter return is $25 — flagged or not, once the library is asked', [packagingFeeOf(line({ len: 60, returns: 2 })).code, packagingFeeOf(unflag(line({ len: 60, returns: 2 }))).code, packagingFeeOf(unflag(line({ len: 60, returns: 2 })), { isFee }).code], [L25, S12, L25]);
eq('French, a traverse miter and a bay cut read by their names', [
    packagingFeeOf(withRow(line({ len: 60 }), { legacyErpId: 'H1-FRPF', name: 'FRENCH RETURN', qty: 1 }), { isFee }).why.join(),
    packagingFeeOf(withRow(manualTrv, { legacyErpId: 'H1-2TRMR', name: '2" Rectangular Traverse Miter', qty: 2 }), { isFee }).why.join(),
    packagingFeeOf(withRow(line({ len: 60 }), { legacyErpId: 'H1-MRBAYF', name: 'Miter Cut Less than 90d', qty: 1 }), { isFee }).why.join(),
    packagingFeeOf(withRow(line({ len: 60 }), { legacyErpId: 'H1-BOWF', name: 'Bay Window Bend Fee', qty: 1 }), { isFee }).why.join(),
], ['returns', 'returns', 'curved or bay', 'curved or bay']);
eq('a pole over 16 ft is $25 by its sold length, spliced or not', [packagingFeeOf(line({ len: 200, splices: 1 })).why.join(), packagingFeeOf(line({ len: 192 })).code], ['over 16 ft', S12]);
eq('a line with no pole takes no packaging fee, and neither does a fee or an add-on line', [packagingFeeOf(line({ len: 0, noRod: true })), packagingFeeOf({ ...line({ len: 60 }), isFee: true }), packagingFeeOf({ ...line({ len: 60 }), isAddOn: true }), packagingFeeOf(null)], [null, null, null, null]);
let pk = packagingPlanOf([line({ len: 60, qty: 2 }), motorTrv, line({ len: 60, returns: 1 }), line({ len: 0, noRod: true })]);
eq('a cart: one fee a configuration — two standard, two $25, the parts-only line none', [pk.counts[S12], pk.counts[L25], pk.lines.length], [2, 2, 3]);
eq('a double is ONE system', packagingPlanOf([line({ len: 90, setup: 'DOUBLE' })]).counts, { [S12]: 1, [L25]: 0 });
// tab 7: a flat order — the fee lines are shared out to the poles
eq('tab 7: two poles and a motorized system, no fees', orderPackagingPlanOf({ systems: [{ qty: 2, lengthIn: 60 }, { qty: 1, lengthIn: 60, motorized: true }] }).counts, { [S12]: 2, [L25]: 1 });
eq('tab 7: two return fees go to ONE pole — the plain one first, not the motorized one', orderPackagingPlanOf({ systems: [{ qty: 1, lengthIn: 60, motorized: true }, { qty: 2, lengthIn: 60 }], returnQty: 2 }).counts, { [S12]: 1, [L25]: 2 });
eq('tab 7: three return fees reach two poles; a bend reaches one more', [orderPackagingPlanOf({ systems: [{ qty: 3, lengthIn: 60 }], returnQty: 3 }).counts, orderPackagingPlanOf({ systems: [{ qty: 3, lengthIn: 60 }], returnQty: 2, shapedQty: 1 }).counts], [{ [S12]: 1, [L25]: 2 }, { [S12]: 1, [L25]: 2 }]);
eq('tab 7: the fee lines can be given by name', orderPackagingPlanOf({ systems: [{ qty: 2, lengthIn: 60 }], feeNames: [{ name: 'MITER RETURN', qty: 2 }, { name: 'Rush Order Fee', qty: 1 }, { name: 'Pole Pack Standard', qty: 1 }] }).counts, { [S12]: 1, [L25]: 1 });
eq('tab 7: no pole, no fee — whatever fee lines the order carries', orderPackagingPlanOf({ systems: [], returnQty: 2 }).counts, { [S12]: 0, [L25]: 0 });

// ── 📦 the same boxes for an ORDER ENTRY order (Stuart 2026-10-20 · Eric's PO 682688) ─────────────────────
{
    eq('a small part alone ships in one small box', orderShippingPlanOf({ systems: [], feeNames: [], goods: 1 }).counts, { S: 1, M: 0, L: 0, XL: 0 });
    eq('nothing physical, no box', orderShippingPlanOf({ goods: 0 }).counts, { S: 0, M: 0, L: 0, XL: 0 });
    const four = orderShippingPlanOf({ systems: [{ qty: 4, lengthIn: 90 }], goods: 2 });
    eq('four 90" rods: one M box, and a small box per two of them', [four.windows, four.counts], [4, { S: 2, M: 1, L: 0, XL: 0 }]);
    const ret = orderShippingPlanOf({ systems: [{ qty: 3, lengthIn: 90 }], feeNames: [{ name: 'FRENCH RETURN', qty: 4 }], goods: 2 });
    eq('returns go two to a pole: two poles with returns fill an M box, the plain one starts another', [ret.boxes.map(b => `${b.key}:${b.plain}/${b.returns}`)], [['M:0/2', 'M:1/0']]);
    eq('a short rod rides in the small box; a long one goes XL; a traverse system is a pole of its length', [orderShippingPlanOf({ systems: [{ qty: 1, lengthIn: 36 }], goods: 1 }).counts, orderShippingPlanOf({ systems: [{ qty: 1, lengthIn: 110 }, { qty: 1, lengthIn: 72, traverse: true }], goods: 2 }).counts], [{ S: 1, M: 0, L: 0, XL: 0 }, { S: 1, M: 0, L: 0, XL: 1 }]);
    const ch = shippingChargeOf(orderShippingPlanOf({ goods: 1 }), (code) => ({ 'H1-SHIP-S': 22.5, 'H1-SHIP-M': 45 })[code] ?? null);
    eq('PO 682688 — one acrylic end cap kit — is one small box at Fabricut\'s $22.50', [ch.total, ch.rows.map(r => `${r.qty}×${r.code}`)], [22.5, ['1×H1-SHIP-S']]);
}

console.log(`flatRateShipping: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
