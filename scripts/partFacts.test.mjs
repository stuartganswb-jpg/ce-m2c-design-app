// 🧪 What a floor card says about its parts — by material, and by sales-order line (Stuart 2026-10-07).
//    node scripts/partFacts.test.mjs
import { materialOfPart, isRodLine, partsByMaterialOf, materialRowText, materialSummaryText, materialLabelText, materialHeadOf, isCartLineHeader, withCartLines,
    lineFactsOf, lineNosOf, lineSpanText, lineHeadText, rowsByLine, pairFactsOf, cardFactsOf, orderMatesOf } from '../src/components/Shared/partFacts.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// ── material: the item's own Raw Mat ────────────────────────────────────────────────────────────────────────
const P = (material, productType = '') => ({ manufacturingSpecs: { material, productType } });
eq('the item says what it is made of', [materialOfPart(P('WOOD')), materialOfPart(P('wood')), materialOfPart(P('METAL')), materialOfPart(P('CLEAR (NO FINISH)'))], ['WOOD', 'WOOD', 'METAL', 'CLEAR']);
eq('a blank Raw Mat reads METAL (the Library\'s rule) — no item record at all is unknown', [materialOfPart(P('')), materialOfPart({}), materialOfPart(null)], ['METAL', 'METAL', '']);
eq('a rod is a rod on the parts list too — by its type, or by its cut', [isRodLine({ productType: 'POLE' }), isRodLine({ productType: 'WOOD RODS' }), isRodLine({ cutLength: 96 }), isRodLine({ productType: 'FINIAL' }), isRodLine(null)], [true, true, true, false, false]);

// ── SO60831's stained pair as production holds it: a wood rod on the shop, two wood finials and a joiner screw picked ──
const s11Parts = [{ legacyErpId: 'H1-138WGF-O', qty: 1, material: 'WOOD', lineNo: 1, lineTag: 'Room Right A' }, { legacyErpId: 'H1-138WGF-O', qty: 1, material: 'WOOD', lineNo: 2, lineTag: 'Room Right B' }, { legacyErpId: 'HSCPC1', qty: 1, material: 'METAL', lineNo: 1, lineTag: 'Room Right A', noFinish: true }];
const s11Cuts = [{ legacyErpId: 'H1-138WR-O', name: 'Wood Rod', qty: 1, cutLength: 144, material: 'WOOD', lineNo: 1, lineTag: 'Room Right A' }];
let rows = partsByMaterialOf({ partsList: s11Parts, cutList: s11Cuts });
eq('the pair by material — the rod counted as a rod, the small parts as small parts', rows, [{ material: 'WOOD', rods: 1, small: 2 }, { material: 'METAL', rods: 0, small: 1 }]);
eq('…in words', materialSummaryText(rows), 'WOOD · 1 rod + 2 small parts  |  METAL · 1 small part');
eq('…for a label', materialLabelText(rows), 'WOOD 1 rod + 2 pcs · METAL 1 pc');
eq('…in one word', [materialHeadOf(rows), materialHeadOf([rows[0]]), materialHeadOf([]), materialHeadOf(undefined)], ['MIXED', 'WOOD', '', '']);
eq('the plated pair: all metal, by the piece', materialSummaryText(partsByMaterialOf({ partsList: [{ qty: 48, material: 'METAL' }, { qty: 3, pcs: 6, material: 'METAL' }, { quantity: 2, material: '' }] })), 'METAL · 54 small parts  |  OTHER · 2 small parts');
eq('a return or a miter rides the rod — it is no part', partsByMaterialOf({ cutList: [{ qty: 2, cutLength: 96, material: 'METAL' }, { qty: 2, material: 'METAL', name: 'French return' }, { qty: 1, rider: true, material: 'METAL' }] }), [{ material: 'METAL', rods: 2, small: 0 }]);
eq('a per-foot rod quoted with no cut is still a rod', partsByMaterialOf({ cutList: [{ qty: 3, feetPer: 8, material: 'WOOD' }] }), [{ material: 'WOOD', rods: 3, small: 0 }]);
eq('a shop job with no rod (a bracket set) keeps its pieces', partsByMaterialOf({ cutList: [{ qty: 4, material: 'METAL' }] }), [{ material: 'METAL', rods: 0, small: 4 }]);
eq('a straight wood rod finished with the small parts is still a rod', partsByMaterialOf({ partsList: [{ qty: 2, productType: 'POLES', cutLength: 60, material: 'WOOD' }, { qty: 4, productType: 'RING', material: 'WOOD' }] }), [{ material: 'WOOD', rods: 2, small: 4 }]);
eq('nothing → nothing', [partsByMaterialOf(), materialSummaryText(null), materialRowText({ material: 'WOOD', rods: 2, small: 0 })], [[], '', 'WOOD · 2 rods']);

// ── the line: a quote's ▶ headers ───────────────────────────────────────────────────────────────────────────
const breakdown = [
    { name: '▶ H1-138 [Living Room]  ·  S11', qty: 1, sidemark: 'Living Room', isHeader: true },
    { name: 'Wood Rod', partId: 'rod', qty: 1, cutLength: 96 }, { name: 'Finial', partId: 'fin', qty: 2 },
    { name: '  Net Line Total', isNetLine: true },
    { name: '▶ H1-138 [Dining]', qty: 2, isHeader: true },                       // a quote saved before the sidemark field: the room is in the brackets
    { name: 'Wood Rod', partId: 'rod', qty: 2, cutLength: 60 }, { name: 'Bracket', partId: 'brk', qty: 4 },
    { name: '▶ H1-138 []', qty: 1, sidemark: '', isHeader: true },
    { name: 'Bracket', partId: 'brk', qty: 3 },
    { name: 'Add-ons & Fees', isHeader: true },
    { name: 'Crating fee', isFee: true, qty: 1 },
];
const stamped = withCartLines(breakdown);
eq('three lines — the Add-ons header is not one', [stamped.lineCount, stamped.tags], [3, { 1: 'Living Room', 2: 'Dining' }]);
eq('every row knows its line; a row under Add-ons belongs to none', stamped.rows.filter(r => !r.isHeader).map(r => `${r.name.trim()}:${r.lineNo || '-'}:${r.lineTag || '-'}`),
    ['Wood Rod:1:Living Room', 'Finial:1:Living Room', 'Net Line Total:1:Living Room', 'Wood Rod:2:Dining', 'Bracket:2:Dining', 'Bracket:3:-', 'Crating fee:-:-']);
ok('the quote itself is not touched', breakdown[1].lineNo === undefined && stamped.rows[0] === breakdown[0]);
eq('which header is a line', [isCartLineHeader(breakdown[0]), isCartLineHeader(breakdown[9]), isCartLineHeader({ name: '▶ x' }), isCartLineHeader(null)], [true, false, false, false]);
eq('a quote with no headers has no lines', [withCartLines([{ name: 'Rod', qty: 1 }]).lineCount, withCartLines([{ name: 'Rod', qty: 1 }]).rows[0].lineNo, withCartLines(undefined).rows], [0, undefined, []]);
eq('what a parts or cut line carries', [lineFactsOf(stamped.rows[1], P('WOOD')), lineFactsOf(stamped.rows[8], P('')), lineFactsOf(stamped.rows[10], null), lineFactsOf({ name: 'x' }, P('WOOD'))],
    [{ material: 'WOOD', lineNo: 1, lineTag: 'Living Room' }, { material: 'METAL', lineNo: 3 }, { material: '' }, { material: 'WOOD' }]);

// ── what a card says ────────────────────────────────────────────────────────────────────────────────────────
eq('the lines a document covers', lineNosOf({ partsList: s11Parts, cutList: s11Cuts }), [1, 2]);
eq('Line n of m', [lineSpanText([2], 5), lineSpanText([1, 2, 3], 5), lineSpanText([5, 1, 3], 5), lineSpanText([1, 2, 3, 4, 5], 5), lineSpanText([2, 2], 5)], ['Line 2 of 5', 'Lines 1–3 of 5', 'Lines 1, 3, 5 of 5', 'Lines 1–5 of 5', 'Line 2 of 5']);
eq('a one-line order, or a document from before the stamp, says nothing', [lineSpanText([1], 1), lineSpanText([], 5), lineSpanText(undefined, undefined), lineSpanText([1], 0)], ['', '', '', '']);
eq('a line\'s heading', [lineHeadText(2, 5, 'Dining'), lineHeadText(2, 5), lineHeadText(1, 1, 'Den'), lineHeadText(0, 5)], ['Line 2 of 5 · Dining', 'Line 2 of 5', 'Line 1 · Den', '']);
const grouped = rowsByLine([...s11Parts, { legacyErpId: 'FEE', qty: 1 }], 5);
eq('rows grouped under their line — an order-level row last', grouped.map(g => `${g.head} (${g.rows.length})`), ['Line 1 of 5 · Room Right A (2)', 'Line 2 of 5 · Room Right B (1)', 'Whole order (1)']);
eq('one line on the document → one group, no heading, the rows as they were', [rowsByLine(s11Cuts, 5).map(g => `${g.head}|${g.rows.length}`), rowsByLine(s11Parts, 1).map(g => g.head), rowsByLine([{ a: 1 }, { a: 2 }], 0)[0].rows.length], [['|1'], [''], 2]);

const facts = pairFactsOf({ partsList: s11Parts, cutList: s11Cuts, lineCount: 5 });
eq('the stamp both documents of the pair carry', facts, { partsByMaterial: [{ material: 'WOOD', rods: 1, small: 2 }, { material: 'METAL', rods: 0, small: 1 }], lineNos: [1, 2], lineCount: 5 });
eq('…and what the card leads with', cardFactsOf({ ...facts }), { materials: 'WOOD · 1 rod + 2 small parts  |  METAL · 1 small part', head: 'MIXED', lines: 'Lines 1–2 of 5' });
eq('a document from before the stamp leads with nothing', cardFactsOf({ id: 'OLD', totalParts: 4 }), { materials: '', head: '', lines: '' });

// the order's other documents — wood with wood, metal with metal
const s11 = { id: 'WO-SO60831-S11', orderKey: 'SO60831', recipe: 'S11', ...facts };
const ep5 = { id: 'WO-SO60831-EP5', orderKey: 'SO60831', recipe: 'EP5', ...pairFactsOf({ partsList: [{ qty: 58, material: 'METAL', lineNo: 1 }], lineCount: 5 }) };
const other = { id: 'WO-SO60833-S04', orderKey: 'SO60833', recipe: 'S04', ...facts };
const old = { id: 'WO-SO60831-OLD', orderKey: 'SO60831', recipe: 'P14' };
const shut = { ...ep5, id: 'WO-SO60831-X', currentPhase: 'Closed' };
eq('the order\'s other documents, by material — not another order\'s, a closed one\'s, or one from before the stamp', orderMatesOf(s11, [s11, ep5, other, old, shut]).map(m => `${m.ref} ${m.finish} ${m.head}: ${m.materials}`), ['WO-SO60831-EP5 EP5 METAL: METAL · 58 small parts']);
eq('an Order Entry pair finds its order by soAppId', orderMatesOf({ id: 'a', soAppId: 'so1' }, [{ id: 'b', soAppId: 'so1', partsByMaterial: [{ material: 'WOOD', rods: 2, small: 0 }] }]).map(m => m.materials), ['WOOD · 2 rods']);
eq('no order on the document → no mates', [orderMatesOf({ id: 'z' }, [ep5]), orderMatesOf(null, [ep5])], [[], []]);

console.log(`partFacts: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
