// 12.7 Launch, pinned (S7, 2026-10-20): every line one kind; a mixed order (pillows + shelf) holds its shelf lines by
// default; ship ahead releases them; a hand decision wins; Classical's finish + stock order is NOT held; the pick-side
// question; the board's rows and suggestions.
import { launchLineKindOf, launchIsMixed, launchLineStateOf, lineIsLaunchHeld, launchOrderOf, launchPatchOf, shipAheadPatchOf, holdAllPatchOf, launchRowsOf, SUGGESTION_WORDS,
    shipmentPlanOf, launchShipmentOf, shipmentFulfilItemsOf, shipmentsOf, isShipmentRecord, shipmentAmountOf, shipmentWordsOf } from '../src/components/Shared/launchBoard.js';
import { pickableLinesOf, packLinesOf, soCodeNeedOf, heldLinesOf, soLineReleasedOf } from '../src/components/Shared/pickLines.js';
import { soGatherStageOf } from '../src/components/Shared/orderBinPick.js';
import { nothingToPick, quickShipStatusOf } from '../src/components/Shared/orderStatus.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const throwL = { erp: 'Bell/10T', name: 'Bell throw', qty: 1 };
const pillowL = { erp: 'CUSTOM PILLOW', name: 'Custom Pillow 19x19', qty: 1, madeToOrder: 'SEW', pillow: { requestId: 'q' } };
const fabricL = { erp: 'Bell/10F', name: 'fabric', qty: 0.625, inKit: true, kitOf: 'pillow-q-0', hidden: true };
const tbfL = { erp: 'H1-138CC', name: 'cap', qty: 2, toBeFinished: true, finishCode: 'P24' };
const stockL = { erp: 'H1-138WEC', name: 'end cap', qty: 2 };
const feeL = { erp: 'RUSH', name: 'rush', qty: 1, isFee: true };
const phL = { erp: 'TBD', name: 'Hand-loomed lumbar', qty: 1, placeholder: { description: 'Hand-loomed lumbar' } };

const uniqMixed = { id: 'QS-1', soId: 'QS-1', brand: 'uniquity', customer: 'Patina', createdAt: 5000, nsInternalId: '956871', lines: [throwL, pillowL, fabricL] };
const uniqAllShelf = { id: 'QS-2', soId: 'QS-2', brand: 'uniquity', customer: 'Katie', createdAt: 6000, nsInternalId: '956872', lines: [throwL, { ...throwL, erp: 'Bell/22T' }] };
const ceMixed = { id: 'QS-3', soId: 'QS-3', brand: 'ce', customer: 'Fabricut', createdAt: 7000, nsInternalId: '956873', lines: [tbfL, stockL, feeL] };
const held = { id: 'QS-4', soId: 'QS-4', brand: 'uniquity', customer: 'Patina', createdAt: 8000, lines: [throwL, phL] };

ok('every line one kind', [launchLineKindOf(uniqMixed, throwL, 0), launchLineKindOf(uniqMixed, pillowL, 1), launchLineKindOf(uniqMixed, fabricL, 2), launchLineKindOf(ceMixed, tbfL, 0), launchLineKindOf(ceMixed, stockL, 1), launchLineKindOf(ceMixed, feeL, 2), launchLineKindOf(held, phL, 1)].join() === 'SHELF,SEW,FEE,FINISH,SHELF,FEE,PLACEHOLDER');
ok('a pillow + throw order is mixed; all-shelf and finish + stock are not', launchIsMixed(uniqMixed) && !launchIsMixed(uniqAllShelf) && !launchIsMixed(ceMixed));
ok('HOLD by default: the mixed order\'s throw is HELD; the all-shelf order\'s throws are AUTO; Classical\'s stock beside a finish line is AUTO', launchLineStateOf(uniqMixed, 0) === 'HELD' && launchLineStateOf(uniqAllShelf, 0) === 'AUTO' && launchLineStateOf(ceMixed, 1) === 'AUTO');
ok('the pick side: the mixed order\'s throw is held back; nothing else is', lineIsLaunchHeld(uniqMixed, throwL, 0) && !lineIsLaunchHeld(uniqAllShelf, throwL, 0) && !lineIsLaunchHeld(ceMixed, stockL, 1) && !lineIsLaunchHeld(uniqMixed, pillowL, 1));
const ahead = shipAheadPatchOf(uniqMixed, { by: 'ashley', at: 9 });
const aheadSo = { ...uniqMixed, ...ahead };
ok('ship ahead releases every shelf line and marks the decision', ahead.launch.mode === 'SHIP_AHEAD' && ahead.launch.lines[0].state === 'RELEASED' && !('1' in ahead.launch.lines) && ahead.launch.decidedBy === 'ashley' && launchLineStateOf(aheadSo, 0) === 'RELEASED' && !lineIsLaunchHeld(aheadSo, throwL, 0));
const holdAll = holdAllPatchOf(uniqMixed, { by: 'ashley', at: 9 });
ok('hold all keeps them held, decided, with the reason', holdAll.launch.mode === 'HOLD' && holdAll.launch.lines[0].state === 'HELD' && /hold until/.test(holdAll.launch.lines[0].note) && launchOrderOf({ ...uniqMixed, ...holdAll }).suggestion === 'START');
const partial = launchPatchOf(ceMixed, { lineIdxs: [1], state: 'HELD', by: 'eric', at: 10, note: 'ship with the caps' });
ok('Classical: a hand hold on one stock line holds it for the pick; the rest unchanged', lineIsLaunchHeld({ ...ceMixed, ...partial }, stockL, 1) && partial.launch.mode === 'PARTIAL' && partial.launch.lines[1].note === 'ship with the caps');
const re = launchPatchOf({ ...ceMixed, ...partial }, { lineIdxs: [1], state: 'RELEASED', by: 'eric', at: 11 });
ok('…and releasing it again merges over the hold', re.launch.lines[1].state === 'RELEASED' && re.launch.mode === 'PARTIAL');

const o1 = launchOrderOf(uniqMixed, { docs: [] });
ok('the board row: kinds counted, mixed, shelf held 1, suggestion DECIDE', o1.kinds.SHELF === 1 && o1.kinds.SEW === 1 && o1.kinds.FEE === 1 && o1.mixed && o1.shelf.held === 1 && o1.suggestion === 'DECIDE' && o1.nsAccepted);
ok('a started pillow line shows its document; a decided mixed order with the pillow still to sew says START', launchOrderOf({ ...uniqMixed, ...holdAll }, { docs: [{ id: 'WO-OE-QS-1-1', lineIdx: 1 }] }).lines[1].started && launchOrderOf({ ...uniqMixed, ...holdAll }, { docs: [{ id: 'WO-OE-QS-1-1', lineIdx: 1 }] }).suggestion === 'HELD');
ok('all shelf = AUTO; a placeholder = IDENTIFY first; no NetSuite id = WAIT_NS', launchOrderOf(uniqAllShelf).suggestion === 'AUTO' && launchOrderOf(held).suggestion === 'IDENTIFY' && launchOrderOf({ ...uniqAllShelf, nsInternalId: null }).suggestion === 'WAIT_NS');
const rows = launchRowsOf([uniqMixed, uniqAllShelf, ceMixed, { ...held, status: 'Closed' }], { brand: 'uniquity', sinceMs: 5500 });
ok('the rows: the brand, the window, closed left out, newest first', rows.map(r => r.number).join() === 'QS-2' && launchRowsOf([uniqMixed, uniqAllShelf, ceMixed], { brand: '' }).length === 3 && SUGGESTION_WORDS.DECIDE.includes('ship the shelf lines ahead'));

ok('a caller\'s coverage rule decides STARTED when given', launchOrderOf(uniqMixed, { startedOf: (so, l, i) => i === 1 }).lines[1].started && !launchOrderOf(uniqMixed, { startedOf: () => false }).lines[1].started);


// ── PHASE 2: THE WAREHOUSE HONOURS THE DECISION ──────────────────────────────────────────────────────
const qs = (so) => ({ orderClass: 'QUICKSHIP', ...so });
const mixedQs = qs({ ...uniqMixed, lines: [{ ...throwL, price: 95, total: 95 }, { ...pillowL, price: 420, total: 420 }, fabricL], committedBin: 'ORDERS-UNQ1' });
ok('the pick side: a mixed order with no decision pulls nothing off the shelf (the throw is held), and the held line is named', pickableLinesOf(mixedQs).map(l => l.erp).join() === 'CUSTOM PILLOW,Bell/10F' && heldLinesOf(mixedQs).map(l => l.erp).join() === 'Bell/10T');
ok('its need in the bin leaves the held throw out; released, it is back', soCodeNeedOf(mixedQs, 'Bell/10T') === 0 && soCodeNeedOf({ ...mixedQs, ...shipAheadPatchOf(mixedQs, { by: 'a', at: 1 }) }, 'Bell/10T') === 1 && soLineReleasedOf(mixedQs, mixedQs.lines[0], 0).total === 0);
ok('a held line is never "nothing to pick"; an order with no held line reads as before', !nothingToPick(mixedQs) && nothingToPick(qs({ lines: [feeL] })) && !nothingToPick(qs({ lines: [throwL] })));
ok('the gather stage names the held line and does not read as shipped', (soGatherStageOf({ so: { ...mixedQs, shippedQty: { 'CUSTOM PILLOW': 1 } } }).held || []).join() === 'BELL/10T' && soGatherStageOf({ so: { ...mixedQs, shippedQty: { 'CUSTOM PILLOW': 1 } } }).stage === 'WAITING');
ok('no decision = no plan: the order packs whole as it always has', shipmentPlanOf(mixedQs) === null && packLinesOf(mixedQs).map(l => l.erp).join() === 'BELL/10T,CUSTOM PILLOW,BELL/10F');
const ahead2 = { ...mixedQs, ...shipAheadPatchOf(mixedQs, { by: 'ashley', at: 9 }) };
const planEmpty = shipmentPlanOf(ahead2);
ok('ship ahead, throw not yet in the bin: nothing to pack, the throw and the pillow wait', planEmpty.pack.length === 0 && planEmpty.waiting.join() === '0,1' && planEmpty.partial && planEmpty.n === 1 && packLinesOf(ahead2).length === 0);
const inBin = { ...ahead2, committedQty: { 'BELL/10T': 1 } };
const plan1 = shipmentPlanOf(inBin);
ok('…the throw picked into the bin: it packs as shipment 1, the pillow waits', plan1.pack.join() === '0' && plan1.waiting.join() === '1' && plan1.partial && packLinesOf(inBin).map(l => l.erp).join() === 'BELL/10T');
const shp = launchShipmentOf({ parent: inBin, plan: plan1, by: 'sandra', now: 77, boxes: { SMALL: 'Box A' }, photos: ['p1'] });
ok('the shipment record: its own packed order on the parent\'s NetSuite SO, the throw only, from the parent\'s bin', shp.ok && shp.id === 'QS-SHP-QS-1-01' && shp.doc.packStatus === 'Packed' && shp.doc.packMode === 'SHIPMENT' && shp.doc.shipmentOf === 'QS-1' && shp.doc.nsInternalId === '956871' && shp.doc.lines.length === 1 && shp.doc.lines[0].erp === 'Bell/10T' && shp.doc.lines[0].parentLineIdx === 0 && shp.doc.fulfilFromBin === 'ORDERS-UNQ1' && shp.doc.shipmentAmount === 95 && shp.doc.customer === 'Patina' && isShipmentRecord(shp.doc) && !('launch' in shp.doc) && !('committedQty' in shp.doc));
ok('what the parent gives up, and the record on it', JSON.stringify(shp.give) === '{"BELL/10T":1}' && shp.record.n === 1 && shp.record.lineIdxs.join() === '0' && shp.record.waitingIdxs.join() === '1' && shp.record.amount === 95 && shipmentWordsOf(shp.record) === 'Shipment 1 · 1 × BELL/10T · sandra');
ok('refusals: nothing in the bin; not a partial; no NetSuite order', !launchShipmentOf({ parent: ahead2, plan: planEmpty }).ok && /pick the released/.test(launchShipmentOf({ parent: ahead2, plan: planEmpty }).why) && !launchShipmentOf({ parent: inBin, plan: { ...plan1, partial: false } }).ok && !launchShipmentOf({ parent: { ...inBin, nsInternalId: '' }, plan: plan1 }).ok);
const after1 = { ...inBin, committedQty: { 'BELL/10T': 0 }, shippedQty: { 'BELL/10T': 1 }, shipments: { 1: shp.record }, status: 'Pending' };
const plan2 = shipmentPlanOf(after1);
ok('after shipment 1: the throw reads shipped, the pillow still waits; the status says so', plan2.shipped.join() === '0' && plan2.waiting.join() === '1' && plan2.n === 2 && shipmentsOf(after1).length === 1 && quickShipStatusOf(after1).detail === '1 shipment sent, the rest to pick');
const sewn = { ...after1, committedQty: { 'BELL/10T': 0, 'CUSTOM PILLOW': 1 } };
const planLast = shipmentPlanOf(sewn);
ok('the pillow gathered: the last pack is not partial — the ordinary ✓ Packed, packing the pillow alone', !planLast.partial && planLast.pack.join() === '1' && packLinesOf(sewn).map(l => l.erp).join() === 'CUSTOM PILLOW');
const heldOne = { ...mixedQs, ...launchPatchOf(mixedQs, { lineIdxs: [0], state: 'HELD', by: 'o', at: 2 }), committedQty: { 'CUSTOM PILLOW': 1 } };
ok('a hand-held line stays behind even when everything else is in the bin', shipmentPlanOf(heldOne).held.join() === '0' && shipmentPlanOf(heldOne).pack.join() === '1' && shipmentPlanOf(heldOne).partial);
ok('the amount: a line total, else price × qty', shipmentAmountOf([{ total: 95 }, { price: 10, qty: 3 }]) === 125);
// the fulfilment, scoped to the shipment's lines (NetSuite rows as Shared/fulfilmentLines reads them)
const nsRows = [{ line: '3', item: 'Bell/10T', qty: 2, shipped: 0, location: '20' }, { line: '5', item: 'CUSTOM PILLOW', qty: 1, shipped: 0, location: '20' }, { line: '7', item: 'Bell/10T', qty: 1, shipped: 0, location: '20' }];
const items = nsRows.map(r => ({ orderLine: Number(r.line), location: { id: '20' }, itemReceive: true }));
const f1 = shipmentFulfilItemsOf({ items, rows: nsRows, lines: [{ erp: 'Bell/10T', qty: 3 }], bin: 'ORDERS-UNQ1' });
ok('three throws across two NetSuite lines, from the order\'s bin; the pillow line untouched', f1.ok && f1.items.map(i => `${i.orderLine}:${i.quantity}`).join() === '3:2,7:1' && f1.items[0].inventoryDetail.inventoryAssignment.items[0].binNumber.refName === 'ORDERS-UNQ1' && f1.items[0].inventoryDetail.inventoryAssignment.items[0].quantity === 2 && f1.missing.length === 0);
ok('never more than NetSuite has open; a line NetSuite has no open line for is missing', shipmentFulfilItemsOf({ items, rows: nsRows.map(r => ({ ...r, shipped: r.line === '3' ? 2 : 0 })), lines: [{ erp: 'Bell/10T', qty: 3 }] }).items.map(i => `${i.orderLine}:${i.quantity}`).join() === '7:1' && !shipmentFulfilItemsOf({ items, rows: nsRows, lines: [{ erp: 'NOPE', qty: 1 }] }).ok && shipmentFulfilItemsOf({ items, rows: nsRows, lines: [{ erp: 'NOPE', qty: 1 }] }).missing[0].code === 'NOPE');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
