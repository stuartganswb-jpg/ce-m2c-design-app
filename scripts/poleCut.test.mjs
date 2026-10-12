// node scripts/poleCut.test.mjs — what a completed rod cut puts on the shelf (Stuart 2026-10-12: "we can get one 6 and
// one 4 from each 12"). The orders are the ones open on the WMS Rod Cuts tab that day.
import { alsoYieldsFor, cutYieldLinesOf, cutYieldText, sourcesForLength, cutPlanFromSource, poleLengthOf } from '../src/components/Shared/poleCut.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ns = { HTA1235: '21530', HTA435: '21531', HTA635: '21532', HTA835: '21533' };
const nsIdOf = (c) => ns[c] || null;

eq('the saw\'s table, read for what ELSE comes off the stick', [alsoYieldsFor(12, 6), alsoYieldsFor(12, 4), alsoYieldsFor(12, 8), alsoYieldsFor(8, 6), alsoYieldsFor(8, 4), alsoYieldsFor(6, 4), alsoYieldsFor(4, 4)],
    [[{ ft: 4, per: 1 }], [{ ft: 6, per: 1 }], [], [], [], [], []]);
// RC-WO-STK-49047-1791814095751 as it is in production: raised for a work order, one length named.
const order = { id: 'RC-WO-STK-49047-1791814095751', sourceItemId: 'HTA1235', sourceInternalId: '21530', targetItemId: 'HTA635', targetInternalId: '21532', qtySource: 10, qtyTarget: 10, cutTo: '6FT', scrapFt: 20, purpose: 'FINISHING' };
const lines = cutYieldLinesOf(order, { nsIdOf });
eq('10 × HTA1235 cut for 10 × HTA635 also puts 10 × HTA435 on the shelf', lines, [
    { itemId: 'HTA635', internalId: '21532', qty: 10, ft: 6, offcut: false },
    { itemId: 'HTA435', internalId: '21531', qty: 10, ft: 4, offcut: true },
]);
eq('in words', cutYieldText(lines), '10 × HTA635 + 10 × HTA435');
eq('the lengths add up: 10 sticks of 12 ft = 60 ft of 6 + 40 ft of 4 + the 20 ft of scrap the order already names', lines.reduce((t, l) => t + l.qty * l.ft, 0) + order.scrapFt, 10 * poleLengthOf('HTA1235'));
eq('an offcut item the app does not know is named with NO id — the completion stops on it, it is never skipped', cutYieldLinesOf(order, { nsIdOf: () => null })[1], { itemId: 'HTA435', internalId: null, qty: 10, ft: 4, offcut: true });
eq('an 8 ft stick cut to 6 ft, or to two 4 ft, yields that length only', [
    cutYieldLinesOf({ sourceItemId: 'HCUMP815', targetItemId: 'HCUMP615', targetInternalId: '5', qtySource: 20, qtyTarget: 20 }, { nsIdOf }).map(l => [l.itemId, l.qty, l.offcut]),
    cutYieldLinesOf({ sourceItemId: 'HCUMP815', targetItemId: 'HCUMP415', targetInternalId: '6', qtySource: 5, qtyTarget: 10 }, { nsIdOf }).map(l => [l.itemId, l.qty, l.offcut]),
], [[['HCUMP615', 20, false]], [['HCUMP415', 10, false]]]);
eq('a bench cut that names its own lengths is read exactly as written — nothing is added to it',
    cutYieldLinesOf({ sourceItemId: 'HTA1235', qtySource: 3, targets: [{ itemId: 'HTA635', internalId: '21532', qty: 3 }, { itemId: 'HTA435', internalId: '21531', qty: 3 }] }, { nsIdOf }).map(l => [l.itemId, l.internalId, l.qty, l.offcut]),
    [['HTA635', '21532', 3, false], ['HTA435', '21531', 3, false]]);
eq('a finished stick keeps its finish on the offcut', cutYieldLinesOf({ sourceItemId: 'HTA1235/SG', targetItemId: 'HTA635/SG', targetInternalId: '9', qtySource: 2, qtyTarget: 2 }, { nsIdOf: (c) => (c === 'HTA435/SG' ? '77' : null) })[1], { itemId: 'HTA435/SG', internalId: '77', qty: 2, ft: 4, offcut: true });
eq('a code with no length grammar is one line, as it always was', cutYieldLinesOf({ sourceItemId: 'RODSTOCK', targetItemId: 'RODCUT', targetInternalId: '1', qtySource: 4, qtyTarget: 4 }, { nsIdOf }).length, 1);
eq('nothing to read → one empty line, never a throw', cutYieldLinesOf(null).length, 1);
// The plan a work order is raised with is unchanged — the offcut is the completion's business.
const src12 = sourcesForLength(6).find(o => o.sourceFt === 12);
eq('the review already shows that a 12 ft cut for 6 ft also yields a 4 ft', [src12.per, src12.scrapFt, src12.alsoYields], [1, 2, [{ ft: 4, per: 1 }]]);
eq('…and the cut plan it writes is what it was', cutPlanFromSource({ targetErp: 'HTA635/CP', targetFt: 6, sourceFt: 12, per: 1, scrapFt: 2, want: 10 }), { sourceItemId: 'HTA1235', targetItemId: 'HTA635', sourceQty: 10, targetQty: 10, wantQty: 10, overrun: 0, cutTo: '6FT', scrapFt: 20, lengthFt: 6 });
console.log(`poleCut: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
