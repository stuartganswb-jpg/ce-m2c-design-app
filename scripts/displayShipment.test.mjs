// node scripts/displayShipment.test.mjs — one display, one showroom (Stuart 2026-09-30: "fulfill one at a time (1/50 logic
// works) at $0.00 on new sales orders to the showrooms with custom shipping addresses" · "fabricut with custom ship to").
import { displayShipmentOf, shipToError, shipToLines, fulfilFromBinItems } from '../src/components/Shared/displayShipment.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

const parent = { id: 'SO-APP-QUOTE-1789660306300', soId: 'SO60551', customer: 'FABRICUT', customerId: 'CUST-4572', committedBin: 'ORDERS-COM1' };
const share = [
    { idx: 0, code: 'H1-1R/EP4', name: '1" Round Rod', row: 'ROW 1', pieces: 1, nsCode: 'H1-1R', nsQty: 2 },
    { idx: 3, code: 'H1-1CP-V/EP4', name: 'Cover Plate', row: 'ROW 1', pieces: 1, nsCode: 'H1-1CP-V/EP4', nsQty: 1 },
    { idx: 4, code: 'H1-1CP-V/EP4', name: 'Cover Plate', row: 'ROW 1', pieces: 1, nsCode: 'H1-1CP-V/EP4', nsQty: 1 },
    { idx: 22, code: 'H1-138CC/P06', name: 'End Cap', row: 'Base Front 2', pieces: 1, nsCode: 'H1-138CC/P', nsQty: 1 },
    { idx: 19, code: 'HTSLNTCAR', name: 'Carrier', row: 'Row 2', pieces: 10, nsCode: 'HTSLNTCAR', nsQty: 10 },
];
const lib = { 'H1-1R': { netSuiteInternalId: '101', itemName: '1" Round Rod' }, 'H1-1CP-V/EP4': { netSuiteInternalId: '102', itemName: 'Cover Plate EP4' }, 'H1-138CC/P': { netSuiteInternalId: '103', itemName: 'End Cap /P' }, HTSLNTCAR: { netSuiteInternalId: '104', itemName: 'Silent Carrier' } };
const shipTo = { addressee: 'Fabricut Showroom Dallas', attention: 'Receiving', addr1: '1025 N Stemmons Fwy', addr2: 'Suite 400', city: 'Dallas', state: 'tx', zip: '75207', phone: '214-555-0100' };
const r = displayShipmentOf({ parent, n: 7, boards: 50, share, shipTo, brand: 'ce', by: 'Andrea', now: Date.UTC(2026, 8, 30, 15), findByCode: (c) => lib[c] || null, boxes: { SMALL: '18x12x3' } });

eq('display 7 of 50 is its own order: Fabricut, the custom ship-to, born packed', [r.ok, r.id, r.doc.customerId, r.doc.orderClass, r.doc.status, r.doc.packStatus, r.doc.packMode, r.doc.displayOf, r.doc.displayNo, r.doc.fulfilFromBin],
    [true, 'QS-DSP-SO60551-007', 'CUST-4572', 'QUICKSHIP', 'NS_QUEUED', 'Packed', 'DISPLAY', 'SO-APP-QUOTE-1789660306300', 7, 'ORDERS-COM1']);
eq('NetSuite: Fabricut, the brand\'s form and location, a custom ship-to, SO60551 as the reference', [r.payload.entity.id, r.payload.subsidiary.id, r.payload.location.id, r.payload.customForm.id, r.payload.otherRefNum, r.payload.memo, r.payload.shippingaddress],
    ['4572', '2', '17', '177', 'SO60551', 'Display 7 of 50 SO60551', { attention: 'Receiving', addressee: 'Fabricut Showroom Dallas', addr1: '1025 N Stemmons Fwy', addr2: 'Suite 400', city: 'Dallas', state: 'TX', zip: '75207', country: { id: 'US' } }]);
eq('its lines: each NetSuite item once, at $0, from the brand\'s location — 2 ft of rod, 2 cover plates, the /P cap, 10 carriers', r.payload.item.items.map(i => [i.item.id, i.quantity, i.rate, i.price.id, i.location.id]),
    [['101', 2, 0, '-1', '17'], ['102', 2, 0, '-1', '17'], ['103', 1, 0, '-1', '17'], ['104', 10, 0, '-1', '17']]);
eq('what the display order gives up: pieces off its bin count, NetSuite items off its bin record', r.give, { committed: { 'H1-1R/EP4': 1, 'H1-1CP-V/EP4': 2, 'H1-138CC/P06': 1, HTSLNTCAR: 10 }, nsBin: { 'H1-1R': 2, 'H1-1CP-V/EP4': 2, 'H1-138CC/P': 1, HTSLNTCAR: 10 } });
eq('the build\'s ship plan gets a shipped row', r.row, { date: '2026-09-30', qty: 1, shipped: 1, note: '#7 → Fabricut Showroom Dallas, Dallas TX (QS-DSP-SO60551-007)' });
eq('the label lines', shipToLines(shipTo), ['Fabricut Showroom Dallas', 'Attn: Receiving', '1025 N Stemmons Fwy', 'Suite 400', 'Dallas, TX 75207', '214-555-0100']);
eq('refused: an incomplete ship-to · a display past the order · an item with no NetSuite id · no customer id', [
    displayShipmentOf({ parent, n: 1, boards: 50, share, shipTo: { addressee: 'X', addr1: '1 A St' }, findByCode: (c) => lib[c] }).why,
    displayShipmentOf({ parent, n: 51, boards: 50, share, shipTo, findByCode: (c) => lib[c] }).ok,
    displayShipmentOf({ parent, n: 1, boards: 50, share, shipTo, findByCode: (c) => (c === 'HTSLNTCAR' ? null : lib[c]) }).why,
    displayShipmentOf({ parent: { ...parent, customerId: '' }, n: 1, boards: 50, share, shipTo, findByCode: (c) => lib[c] }).ok,
], ['the ship-to is not complete — add the city, the state, the zip', false, 'no NetSuite id for HTSLNTCAR — sync the item first', false]);
eq('shipToError on a complete address is empty', shipToError(shipTo), '');

// THE FULFILMENT: every open line of the showroom's order taken out of the order's bin.
const items = [{ orderLine: 1, location: { id: '17' }, itemReceive: true }, { orderLine: 2, location: { id: '17' }, itemReceive: true }];
const rows = [{ line: '1', qty: 2, shipped: 0 }, { line: '2', qty: 10, shipped: 4 }];
eq('from ORDERS-COM1: the open quantity of each line, bin by name', fulfilFromBinItems(items, rows, 'ORDERS-COM1'), [
    { orderLine: 1, location: { id: '17' }, itemReceive: true, quantity: 2, inventoryDetail: { inventoryAssignment: { items: [{ binNumber: { refName: 'ORDERS-COM1' }, quantity: 2 }] } } },
    { orderLine: 2, location: { id: '17' }, itemReceive: true, quantity: 6, inventoryDetail: { inventoryAssignment: { items: [{ binNumber: { refName: 'ORDERS-COM1' }, quantity: 6 }] } } },
]);
eq('no bin: the lines as they were', fulfilFromBinItems(items, rows, ''), items);

console.log(`displayShipment: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
