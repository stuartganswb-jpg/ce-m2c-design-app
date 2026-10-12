// node scripts/fulfilmentBins.test.mjs — the bin a fulfilment takes from, asked when an item sits in more than one
// (Stuart 2026-10-12). The rows are SO60991's, read live from NetSuite the day its fulfilment failed.
import { binsSql, fulfilItemIdsOf, binChoicesOf, binPickRefusal, fulfilmentItemsWithBins, binPickText } from '../src/components/Shared/fulfilmentBins.js';
import { soLinesSql, fulfilmentItemsOf } from '../src/components/Shared/fulfilmentLines.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const soRows = [
    { line: '1', itemid: '65644', item: 'FABRICUT H1', itemtype: 'NonInvtPart', location: '17', qty: '1', shipped: '0' },
    { line: '2', itemid: '58252', item: 'H1-75R', itemtype: 'InvtPart', location: '17', qty: '12', shipped: '0' },
    { line: '3', itemid: '56211', item: 'H1-75IM/P', itemtype: 'Assembly', location: '17', qty: '4', shipped: '0' },
    { line: '4', itemid: '56347', item: 'H1-75BR/P', itemtype: 'Assembly', location: '17', qty: '52', shipped: '0' },
    { line: '5', itemid: '26506', item: 'CE - UPS Ground', itemtype: 'ShipItem', location: '17', qty: '1', shipped: '0' },
];
const binRows = [
    { item: '56211', location: '17', binid: '9196', bin: '75R-007', status: '1', onhand: '24' },
    { item: '56347', location: '17', binid: '9190', bin: '75R-001', status: '1', onhand: '929' },
    { item: '58252', location: '17', binid: '39694', bin: 'ORDERS-COM1', status: '1', onhand: '50' },
    { item: '58252', location: '17', binid: '7957', bin: 'Production Stock', status: '1', onhand: '380' },
];
ok('the order-lines read now carries each line\'s NetSuite item id', /tl\.item AS itemid/.test(soLinesSql('947628')));
const ifItems = fulfilmentItemsOf(soRows);
eq('the lines being fulfilled, as before', ifItems.items.map(i => i.orderLine), [1, 2, 3, 4]);
eq('…and their item ids', fulfilItemIdsOf(ifItems.items, soRows), ['65644', '58252', '56211', '56347']);
ok('one read, bin by bin, for exactly those items', /ib\.item IN \(65644,58252,56211,56347\)/.test(binsSql(fulfilItemIdsOf(ifItems.items, soRows))) && binsSql([]) === '' && binsSql(['x; DROP']) === '');

const choices = binChoicesOf({ items: ifItems.items, soRows, binRows });
eq('SO60991: ONE line is asked about — H1-75R, in two bins; the lines in one bin are not', choices.map(c => [c.orderLine, c.item, c.qty, c.bins.map(b => [b.bin, b.onhand]), c.pick]),
    [[2, 'H1-75R', 12, [['Production Stock', 380], ['ORDERS-COM1', 50]], []]]);
eq('an order gathered into its own bin has that bin chosen already — when it covers the line', binChoicesOf({ items: ifItems.items, soRows, binRows, preferBin: 'orders-com1' })[0].pick, [{ binId: '39694', qty: 12 }]);
eq('…and not when it does not', binChoicesOf({ items: ifItems.items, soRows: soRows.map(r => (r.line === '2' ? { ...r, qty: '60' } : r)), binRows, preferBin: 'ORDERS-COM1' })[0].pick, []);
eq('stock in another status, at another location, or already shipped lines are never offered', [
    binChoicesOf({ items: ifItems.items, soRows, binRows: binRows.map(b => (b.bin === 'ORDERS-COM1' ? { ...b, status: '13' } : b)) }).length,
    binChoicesOf({ items: ifItems.items, soRows, binRows: binRows.map(b => (b.bin === 'ORDERS-COM1' ? { ...b, location: '19' } : b)) }).length,
    binChoicesOf({ items: ifItems.items, soRows: soRows.map(r => (r.line === '2' ? { ...r, shipped: '12' } : r)), binRows }).length,
], [0, 0, 0]);
eq('a line partly shipped asks for what is left', binChoicesOf({ items: ifItems.items, soRows: soRows.map(r => (r.line === '2' ? { ...r, shipped: '5' } : r)), binRows })[0].qty, 7);

const c = choices[0];
eq('a pick must be made, must be this line\'s bin, must not over-draw it, and must add up to the line', [
    binPickRefusal(c, []), binPickRefusal(c, [{ binId: '9190', qty: 12 }]), binPickRefusal(c, [{ binId: '39694', qty: 60 }]), binPickRefusal(c, [{ binId: '7957', qty: 10 }]),
], ['choose the bin H1-75R was taken from', 'H1-75R: that bin does not hold it', 'H1-75R: ORDERS-COM1 holds 50, not 60', 'H1-75R: the bins add up to 10 — the line ships 12']);
eq('one bin, or the line split across two', [binPickRefusal(c, [{ binId: '7957', qty: 12 }]), binPickRefusal(c, [{ binId: '7957', qty: 8 }, { binId: '39694', qty: 4 }])], ['', '']);

const sent = fulfilmentItemsWithBins(ifItems.items, choices, { 2: [{ binId: '7957', qty: 12 }] });
eq('the choice rides its line as NetSuite\'s inventory detail, bin by ID', sent[1], { orderLine: 2, location: { id: '17' }, itemReceive: true, quantity: 12, inventoryDetail: { quantity: 12, inventoryAssignment: { items: [{ binNumber: { id: '7957' }, quantity: 12 }] } } });
eq('…every other line is sent exactly as it was', [sent[0], sent[2], sent[3]], [ifItems.items[0], ifItems.items[2], ifItems.items[3]]);
eq('a split is two rows on the one line', fulfilmentItemsWithBins(ifItems.items, choices, { 2: [{ binId: '7957', qty: 8 }, { binId: '39694', qty: 4 }] })[1].inventoryDetail.inventoryAssignment.items, [{ binNumber: { id: '7957' }, quantity: 8 }, { binNumber: { id: '39694' }, quantity: 4 }]);
eq('nothing asked → nothing changed', fulfilmentItemsWithBins(ifItems.items, [], {}), ifItems.items);
eq('in words', [binPickText(choices, { 2: [{ binId: '7957', qty: 12 }] }), binPickText(choices, { 2: [{ binId: '7957', qty: 8 }, { binId: '39694', qty: 4 }] })], ['H1-75R × 12 from Production Stock', 'H1-75R × 12 from Production Stock (8) + ORDERS-COM1 (4)']);
console.log(`fulfilmentBins: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
