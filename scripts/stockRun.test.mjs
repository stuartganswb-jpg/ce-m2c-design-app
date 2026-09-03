// The ONE parked stock work-order shape (Brief A, A1 — 2026-09-02), offline.
//   node scripts/stockRun.test.mjs
//
// What every stock writer now produces, asserted once: the route rule (stated or refused, never
// open), the floor fields a pole vs a small part carries, the parked finPayload, and that the
// Library run's direct payload is byte-for-byte what it was before the builder grew.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    routeForCode, floorFieldsOf, buildStockFinPayload, buildParkedWorkOrder,
    ROUTE_FINISHING, ROUTE_SHOP, REFUSE_PHOSPHATE, REFUSE_OUTSOURCED,
} from '../src/components/Shared/stockRun.js';

const TASKS = { spinSetup: 'Pending' };   // stand-in for makeFullTasks(); the shape is the contract's
const NOW = 1_700_000_000_000;

const pole = { id: 'doc1', legacyErpId: 'HCUMP410/N25', itemName: '4ft pole N25', netSuiteInternalId: 11941, partClass: 'Assembly',
    manufacturingSpecs: { productType: 'POLES', paintSize: 'L' } };
const bracket = { id: 'doc2', legacyErpId: 'HCUMB410/BS', itemName: 'Bracket BS', netSuiteInternalId: 11950,
    manufacturingSpecs: { productType: 'BRACKET', paintSize: 'M', finishStream: 'SMALL' } };
const rawCore = { id: 'doc3', legacyErpId: 'H1-75DS', itemName: 'Core', netSuiteInternalId: 12000, routingType: 'Standard',
    manufacturingSpecs: { productType: 'FINIAL' } };

test('route: stated for sprayed finishes and raw codes, refused for /P and outsourced', () => {
    assert.deepEqual(routeForCode('HCUMB410/BS'), { routeTo: ROUTE_FINISHING, refuse: null, finish: 'BS' });
    assert.deepEqual(routeForCode('X/P01'), { routeTo: ROUTE_FINISHING, refuse: null, finish: 'P01' });
    assert.deepEqual(routeForCode('H1-75DS'), { routeTo: ROUTE_SHOP, refuse: null, finish: '' });
    assert.equal(routeForCode('H1-75DS/P').refuse, REFUSE_PHOSPHATE);
    assert.equal(routeForCode('X/P-N').refuse, REFUSE_PHOSPHATE);
    assert.equal(routeForCode('H1-75DS/EP1').refuse, REFUSE_OUTSOURCED);
    assert.equal(routeForCode('X/MEP2').refuse, REFUSE_OUTSOURCED);
    assert.equal(routeForCode('X/P25').refuse, REFUSE_OUTSOURCED);
    // the -N new-item marker and -10/-12 pack sizes are not part of the finish
    assert.equal(routeForCode('X/BL-N').finish, 'BL');
    assert.equal(routeForCode('X/CP-10').finish, 'CP');
});

test('floor fields: a pole is racked (count, no sled size); a small part carries its size', () => {
    const p = floorFieldsOf(pole, 10);
    assert.equal(p.isPole, true);
    assert.equal(p.paintSize, null);
    assert.equal(p.paintSizes, null);
    assert.deepEqual(p.poles, { qty: 10, type: 'POLES' });
    assert.equal(p.totalPoles, 10);
    assert.equal(p.finishStream, 'POLES');            // category rule when the item has no flag
    const b = floorFieldsOf(bracket, 7);
    assert.equal(b.isPole, false);
    assert.equal(b.paintSize, 'M');
    assert.deepEqual(b.paintSizes, { S: 0, M: 7, L: 0 });
    assert.equal(b.poles, null);
    assert.equal(b.finishStream, 'SMALL');            // the item's own flag wins
});

test('parked finishing order: route, recipe, control stamps, complete finPayload', () => {
    const { hq, finPayload } = buildParkedWorkOrder({
        intent: 'STOCK_FINISH', woId: 'WO-STK-11941-1', part: pole, qty: 10, brand: 'ce', createdBy: 'stuart',
        reqDate: '2026-09-16', urgent: true, needBy: '2026-09-10', note: 'Stock replenish',
        source: 'SALES_SNAPSHOT', routeTo: ROUTE_FINISHING, finish: 'N25',
        partsList: [{ legacyErpId: 'HCUMP410', quantity: 10 }], bomExploded: true,
        gate: { awaitingRodCut: true, rodCutId: 'RC-WO-STK-11941-1' }, tasks: TASKS, now: NOW,
    });
    assert.equal(hq.routeTo, 'FINISHING');
    assert.equal(hq.recipe, 'N25');
    assert.equal(hq.type, 'HCUMP410/N25');            // the item code, never a category label
    assert.equal(hq.source, 'SALES_SNAPSHOT');
    assert.equal(hq.orderType, 'stock');
    assert.equal(hq.autoFlow, true);
    assert.equal(hq.status, 'Approved');
    assert.equal(hq.stockInternalId, '11941');
    assert.equal(hq.nsItemId, '11941');
    assert.equal(hq.awaitingRodCut, true);
    assert.equal(hq.urgent, true);
    assert.equal(hq.needBy, '2026-09-10');
    assert.equal(hq.totalPoles, 10);
    assert.equal(hq.paintSize, null);
    assert.equal(hq.memo, 'Stock replenish');
    assert.equal(hq.bomExploded, true);
    assert.equal(hq.finPayload, finPayload);
    // the payload is the complete floor doc
    assert.equal(finPayload.id, 'WO-STK-11941-1');
    assert.equal(finPayload.orderKey, 'WO-STK-11941-1');
    assert.equal(finPayload.orderType, 'stock');
    assert.equal(finPayload.recipe, 'N25');
    assert.equal(finPayload.type, 'HCUMP410/N25');
    assert.equal(finPayload.stockErpId, 'HCUMP410/N25');
    assert.equal(finPayload.stockInternalId, '11941');
    assert.equal(finPayload.totalParts, 10);
    assert.deepEqual(finPayload.poles, { qty: 10, type: 'POLES' });
    assert.equal(finPayload.totalPoles, 10);
    assert.equal(finPayload.paintSize, null);
    assert.equal(finPayload.paintSizes, null);
    assert.equal(finPayload.finishStream, 'POLES');
    assert.equal(finPayload.productType, 'POLES');
    assert.equal(finPayload.partsList.length, 1);
    assert.equal(finPayload.bomExploded, true);
    assert.equal(finPayload.tasks, TASKS);
    assert.equal(finPayload.sentToPickPack, false);
    assert.equal(finPayload.currentPhase, 'Setup');
    assert.equal(finPayload.releasedDirect, false);   // parked: RTG releases it
    assert.equal(finPayload.urgent, true);
    assert.equal(finPayload.needBy, '2026-09-10');
    assert.equal(finPayload.customer, 'Internal Stock');
});

test('parked shop order: route SHOP, no recipe, no payload, memo for the shop card', () => {
    const { hq, finPayload } = buildParkedWorkOrder({
        intent: 'STOCK_MILL', woId: 'WO-CORE-H1-75DS-1', part: rawCore, qty: 5, brand: 'ce', createdBy: 'stuart',
        reqDate: '2026-09-16', note: 'Raw core replenish · avail 2 · threshold 6',
        source: 'RAW_CORES', routeTo: ROUTE_SHOP, finish: '', tasks: null, now: NOW,
    });
    assert.equal(finPayload, null);
    assert.equal(hq.routeTo, 'SHOP');
    assert.equal('recipe' in hq, false);
    assert.equal('finPayload' in hq, false);
    assert.equal(hq.type, 'H1-75DS');
    assert.equal(hq.rootItem, 'H1-75DS');
    assert.equal(hq.partErpId, 'H1-75DS');
    assert.equal(hq.memo, hq.note);
    assert.equal(hq.autoFlow, true);
    assert.equal(hq.routingType, 'Standard');
    assert.equal(hq.hqJobId, 'doc3');
});

test('Library run payload is unchanged by the new parameters', () => {
    const before = {
        id: 'WO-X', displayId: 'WO-X', woNum: 'WO-X', orderKey: 'WO-X', quoteId: 'doc2', salesOrderId: null, estimateId: null,
        orderType: 'stock', soId: null, soNum: null, customerId: null,
        customerName: 'Internal Stock', customer: 'Internal Stock', clientName: 'Internal Stock',
        stockErpId: 'HCUMB410/BS', itemCode: 'HCUMB410/BS', recipe: 'BS', reqDate: '2026-09-09', type: 'Bracket BS', totalParts: 3,
        paintSize: null, productType: null, paintSizes: null, note: 'n', cpqSpecs: {}, imageUrl: null,
        dimensions: { length: 10, width: 5, height: 2 }, partsList: [], currentPhase: 'Setup', stepStatus: 'Pending',
        currentStepIndex: 0, tasks: TASKS, machineAssigned: null, redlineAlert: false, sentToPickPack: false, pickStatus: 'Pending',
        shopSiblingId: null, hasCustomSibling: false, customFabStatus: 'Pending', brand: 'ce', createdAt: NOW, updatedAt: NOW,
        createdBy: 'stuart', releasedDirect: true, finishLabel: 'BS - Brass',
    };
    const now = buildStockFinPayload({ woId: 'WO-X', part: bracket, qty: 3, finishLabel: 'BS', brand: 'ce', createdBy: 'stuart',
        reqDate: '2026-09-09', note: 'n', tasks: TASKS, extra: { finishLabel: 'BS - Brass' }, now: NOW });
    assert.deepEqual(now, before);
});
