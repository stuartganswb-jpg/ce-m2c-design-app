// The packing list: ordered beside packed, by item code.   node scripts/packingList.test.mjs
import { packingListOf, invoiceLinesOf, packedQtyOf, LINE_STATUS, isPhysicalLine } from '../src/components/Shared/packingList.js';
import { inProduction, packedStateOf, canReopenInProduction } from '../src/components/Shared/orderStatus.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// physical vs paper
ok('a fee is paper', !isPhysicalLine({ isFee: true, qty: 1 }));
ok('a discount row is paper', !isPhysicalLine({ isDiscount: true, qty: 1 }));
ok('a part with qty is goods', isPhysicalLine({ erp: 'HCUSR1/BR', qty: 2 }));

// the packer's count is the fact; a pre-count tick falls back to line less short
const fin = { id: 'WO-SO1', packStatus: 'Packed', packedAt: 1000,
    partsList: [{ legacyErpId: 'HCUSR1/BR', name: 'Ring', qty: 10 }, { legacyErpId: 'HCUBK1/BR', name: 'Bracket', qty: 2 }, { legacyErpId: 'HCUFN1/BR', name: 'Finial', qty: 2 }],
    totalPoles: 2, poles: { type: 'HCUMP610/BR', qty: 2 },
    packedLines: { L0: { at: 1, by: 'Sylvia', qty: 10 }, L1: { at: 1, by: 'Sylvia' }, POLES: { at: 1, by: 'Sylvia', qty: 2 } },
    pickShorts: [{ itemId: 'HCUBK1/BR', target: 2, picked: 1 }] };
eq('count on the tick wins', packedQtyOf(fin, { key: 'L0', erp: 'HCUSR1/BR', qty: 10 }), 10);
eq('tick without a count: line less the pick short', packedQtyOf(fin, { key: 'L1', erp: 'HCUBK1/BR', qty: 2 }), 1);
eq('no tick: nothing packed', packedQtyOf(fin, { key: 'L2', erp: 'HCUFN1/BR', qty: 2 }), 0);

const ordered = [
    { erp: 'HCUMP610/BR', name: '6ft pole', qty: 2, price: 54 },          // sold by the foot, shipped as pieces
    { erp: 'HCUSR1/BR', name: 'Ring', qty: 10, price: 1.2 },
    { erp: 'HCUBK1/BR', name: 'Bracket', qty: 2, price: 8 },
    { erp: 'HCUFN1/BR', name: 'Finial', qty: 2, price: 12 },
    { isFee: true, name: 'Miter fee', qty: 1, price: 40 },
];
const pl = packingListOf({ ordered, packDocs: [fin] });
eq('poles counted as pieces: 2 ordered, 2 shipped', pl.lines[0], { code: 'HCUMP610/BR', name: '6ft pole', finish: '', qtyOrdered: 2, qtyShipped: 2, status: 'MATCH' });
eq('rings match', [pl.lines[1].qtyShipped, pl.lines[1].status], [10, 'MATCH']);
eq('bracket short (pick short honoured)', [pl.lines[2].qtyShipped, pl.lines[2].status], [1, 'SHORT']);
eq('finial not packed is flagged', [pl.lines[3].qtyShipped, pl.lines[3].status], [0, 'NOT_PACKED']);
eq('the fee is not on the list', pl.lines.length, 4);
eq('ship date = pack completion', pl.shipDate, 1000);
eq('packed, not complete, two flagged', [pl.packed, pl.complete, pl.flagged.length], [true, false, 2]);
eq('totals', pl.totals, { ordered: 16, shipped: 13 });
// packed but never ordered
const finExtra = { ...fin, partsList: [...fin.partsList, { legacyErpId: 'HCUEX1/BR', name: 'Extra', qty: 1 }], packedLines: { ...fin.packedLines, L3: { at: 1, by: 'S', qty: 1 } } };
const plx = packingListOf({ ordered, packDocs: [finExtra] });
eq('a packed line nothing ordered is listed, not hidden', plx.lines.find(x => x.code === 'HCUEX1/BR').status, 'NOT_ORDERED');
// over-pack on a known code
const finOver = { ...fin, packedLines: { ...fin.packedLines, L0: { at: 1, by: 'S', qty: 12 } } };
eq('over-pack is OVER with the true count', [packingListOf({ ordered, packDocs: [finOver] }).lines[1].qtyShipped, packingListOf({ ordered, packDocs: [finOver] }).lines[1].status], [12, 'OVER']);
// a QUICKSHIP order passes its SO doc (lines[] dialect)
const qs = { id: 'QS-1', orderClass: 'QUICKSHIP', packStatus: 'Packed', packedAt: 5, lines: [{ erp: 'H1-2RCTCB', name: 'Kit', qty: 3 }], packedLines: { L0: { at: 1, by: 'A', qty: 3 } } };
eq('quick ship: lines dialect read', packingListOf({ ordered: [{ erp: 'H1-2RCTCB', name: 'Kit', qty: 3 }], packDocs: [qs] }).lines[0].status, 'MATCH');
// the invoice: SO prices × shipped qty; paper untouched
const inv = invoiceLinesOf({ priced: ordered, packingList: pl });
eq('invoice: bracket billed at 1 × 8', [inv[2].qty, inv[2].amount, inv[2].invoiceAdjusted], [1, 8, true]);
eq('invoice: finial billed at 0', [inv[3].qty, inv[3].amount], [0, 0]);
eq('invoice: rings unchanged', [inv[1].qty, inv[1].amount, inv[1].invoiceAdjusted], [10, 12, false]);
eq('invoice: the fee passes through', inv[4], ordered[4]);
// status: in production from RTG dispatch of a SALES ORDER
ok('a dispatched sales order is in production', inProduction({ status: 'Dispatched' }));
ok('an approved (parked) sales order is not', !inProduction({ status: 'Approved' }));
ok('a closed one still is (no reopen from the card)', inProduction({ status: 'Closed' }));
ok('quick ship: picked is in production', inProduction({ orderClass: 'QUICKSHIP', status: 'Picked' }));
ok('quick ship: pending is not', !inProduction({ orderClass: 'QUICKSHIP', status: 'Pending' }));
ok('manager may reopen', canReopenInProduction('manager') && canReopenInProduction('SUPERADMIN'));
ok('sales may not', !canReopenInProduction('sales'));
eq('packed state: every pack doc packed', packedStateOf({ status: 'Dispatched' }, [fin, { packStatus: 'Packed', packedAt: 2000, nsIfTran: 'IF1' }]), { packed: true, packedAt: 2000, shipped: true, tracking: [] });
eq('packed state: one doc still open → not packed', packedStateOf({ status: 'Dispatched' }, [fin, { packStatus: null }]).packed, false);
eq('packed state: quick ship reads the SO doc', packedStateOf({ orderClass: 'QUICKSHIP', packStatus: 'Packed', packedAt: 9, status: 'Shipped', trackingNumbers: ['1Z'] }), { packed: true, packedAt: 9, shipped: true, tracking: ['1Z'] });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
