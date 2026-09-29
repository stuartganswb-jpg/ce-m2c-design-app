// node scripts/scrapClose.test.mjs — a stock order closes short, a custom order does not (Stuart 2026-09-29: "order is
// 100, 96 good, 4 scrap we need to be able to close out the work order and call it complete … for custom orders the rule
// is no, add warning and fix").
import {
    planBalanceClose, isCustomSalesDoc, stockCloseShortOf, closeShortStamps, closeShortLine, closeShortNext,
    shortBuildStamps, shortBalanceOpen, scrapRawOf, scrapBinOf, adjustmentPayload,
} from '../src/components/Shared/scrapClose.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

// WHO closes short: the live stock runs on the floor today (WO11631 …) are orderType 'stock'; an Order Entry / CPQ
// document is 'sales'; an old doc with no type but a sales order behind it is custom too.
eq('stock closes short; sales and SO-backed docs are custom', [
    isCustomSalesDoc({ orderType: 'stock' }), isCustomSalesDoc({ orderType: 'sales' }),
    isCustomSalesDoc({ soId: 'SO60551' }), isCustomSalesDoc({ salesOrderId: 'x' }), isCustomSalesDoc({ orderType: 'stock', soId: null }), isCustomSalesDoc({}),
], [false, true, true, true, false, false]);

// THE CLOSE: 100 ordered, 96 good, 4 scrap.
const p = stockCloseShortOf({ ordered: 100, good: 96, scrap: 4 });
eq('100 / 96 good / 4 scrap → short, balance 4, scrap 4', p, { ordered: 100, good: 96, scrap: 4, balance: 4, short: true });
eq('scrap never exceeds the pieces that were not good', stockCloseShortOf({ ordered: 100, good: 96, scrap: 10 }).scrap, 4);
eq('96 good and no scrap: short by 4 pieces that never ran', stockCloseShortOf({ ordered: 100, good: 96, scrap: 0 }), { ordered: 100, good: 96, scrap: 0, balance: 4, short: true });
eq('all good is not short', stockCloseShortOf({ ordered: 100, good: 100, scrap: 0 }).short, false);
eq('typed text reads as numbers (the QC inputs are strings)', stockCloseShortOf({ ordered: '140', good: '138', scrap: '2' }), { ordered: 140, good: 138, scrap: 2, balance: 2, short: true });
eq('an order with no quantity is never short', stockCloseShortOf({ ordered: 0, good: 0, scrap: 0 }).short, false);
eq('the record carries the fields RTG\'s ⚖ Close Short writes', closeShortStamps(p, { by: 'Grace', at: 5 }),
    { closedShort: true, builtQty: 96, badQty: 4, balanceClosed: 4, balanceClosedBy: 'Grace', balanceClosedAt: 5 });
eq('one sentence', [closeShortLine(p), closeShortLine(stockCloseShortOf({ ordered: 100, good: 90, scrap: 4 }))],
    ['built 96 of 100 · 4 scrap', 'built 90 of 100 · 4 scrap · 6 never ran']);
eq('what happens next: a stock build, a paint-only run, a run with no NetSuite work order', [
    closeShortNext(p), closeShortNext(p, { paintOnly: true }), closeShortNext(p, { hasNsWo: false }),
], [
    'At put-away NetSuite builds 96 and the raw for the 4 scrapped piece(s) comes off the books; RTG then lists the work order\'s balance of 4 to close in NetSuite.',
    'At put-away the 96 good are adjusted into the bin — the pull already took all 100 out, so the other 4 are accounted for.',
    'This run has no NetSuite work order, so nothing posts to NetSuite.',
]);
eq('…and it agrees with the manager\'s balance close on the numbers', [planBalanceClose({ ordered: 100, good: 96, bad: 4, salvage: false }).balance, planBalanceClose({ ordered: 100, good: 96, bad: 4, salvage: false }).adjustOutQty], [p.balance, p.scrap]);

// NETSUITE'S BALANCE: stamped only when the build is short; open until someone confirms the close.
eq('a short build owes NetSuite its balance', shortBuildStamps({ ordered: 100, built: 96 }), { nsWoShortBalance: 4, nsWoShortBuilt: 96, nsWoShortOrdered: 100 });
eq('a full build owes nothing', shortBuildStamps({ ordered: 100, built: 100 }), {});
eq('open until ✓ Closed in NetSuite', [shortBalanceOpen({ nsWoShortBalance: 4 }), shortBalanceOpen({ nsWoShortBalance: 4, nsWoClosed: true }), shortBalanceOpen({}), shortBalanceOpen(null)], [true, false, false, false]);

// THE RAW OF THE SCRAP — WO11631's pull list: 140 × HCUMLB410 for 140 pieces; 4 scrapped → 4 raw.
const wo11631 = [{ quantity: 140, partId: 'HCUMLB410', legacyErpId: 'HCUMLB410', uom: 'EA' }];
eq('WO11631: 4 scrapped → 4 × HCUMLB410', scrapRawOf({ partsList: wo11631, ordered: 140, scrap: 4 }), [{ code: 'HCUMLB410', qty: 4 }]);
eq('two pulls per piece scale with it; the same code on two lines is summed', scrapRawOf({
    partsList: [{ legacyErpId: 'A', quantity: 20 }, { legacyErpId: 'B', quantity: 5 }, { legacyErpId: 'B', qty: 5 }], ordered: 10, scrap: 3,
}), [{ code: 'A', qty: 6 }, { code: 'B', qty: 3 }]);
eq('a line the pick skipped was never pulled', scrapRawOf({ partsList: [{ legacyErpId: 'A', quantity: 10 }, { legacyErpId: 'B', quantity: 10 }], ordered: 10, scrap: 2, skipped: [{ itemId: 'b' }] }), [{ code: 'A', qty: 2 }]);
eq('no scrap, no raw', scrapRawOf({ partsList: wo11631, ordered: 140, scrap: 0 }), []);
eq('a fractional pull keeps three places', scrapRawOf({ partsList: [{ legacyErpId: 'R', quantity: 10 }], ordered: 3, scrap: 1 }), [{ code: 'R', qty: 3.333 }]);

// THE BIN: a live bin that holds it, largest first — never a guess.
const bins = [{ bin: 'M E5R-N16-R1', name: 'M E5R-N16-R1', qty: 3 }, { bin: 'U S19-E2L-R4', name: 'U S19-E2L-R4', qty: 1516 }];
eq('the bin that holds it', scrapBinOf(bins, 4).name, 'U S19-E2L-R4');
eq('…the largest when two hold it', scrapBinOf(bins, 2).name, 'U S19-E2L-R4');
eq('none holds it → null (named, nothing posted)', scrapBinOf(bins, 2000), null);
eq('no live read → null', scrapBinOf([], 1), null);

// THE ADJUSTMENT: NetSuite's own bin spelling posts as given (twin bins differ only in case); a stored name is tidied.
const binOf = (pl) => pl.inventory.items[0].inventoryDetail.inventoryAssignment.items[0].binNumber.refName;
const adj = adjustmentPayload({ nsItemId: 5, qty: -4, binExact: 'Production Stock', location: '17', subsidiary: '2', memo: 'Scrap WO11631' });
eq('exact spelling posts as given, −4 on the line and the bin', [binOf(adj), adj.inventory.items[0].adjustQtyBy, adj.inventory.items[0].inventoryDetail.quantity], ['Production Stock', -4, -4]);
eq('a stored name is tidied as before (RTG\'s ⚖ Close Short)', binOf(adjustmentPayload({ nsItemId: 5, qty: -2, bin: 'u s19-e2l-r4', location: '17', subsidiary: '2' })), 'U S19-E2L-R4');
eq('a fractional pull keeps three places; whole pieces are unchanged', [adjustmentPayload({ nsItemId: 5, qty: -3.3333, bin: 'X', location: '17', subsidiary: '2' }).inventory.items[0].adjustQtyBy, adjustmentPayload({ nsItemId: 5, qty: -4, bin: 'X', location: '17', subsidiary: '2' }).inventory.items[0].adjustQtyBy], [-3.333, -4]);

console.log(`scrapClose: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
