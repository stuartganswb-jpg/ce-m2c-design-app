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
import { tierOfErp, TIER, handlingForErp, isAppliedFinishCode, isWoodStainCode } from '../src/components/Shared/finishRouting.js';
import { sourcesForLength, cutPlanFromSource } from '../src/components/Shared/poleCut.js';

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

test('part handling: wood is SMALL PARTS on the item; the miter escalation is per-line', () => {
    // Stuart 2026-09-03, second pass — the rule he actually wanted: "wood + miter → Custom, wood +
    // straight → finishing … there will never be miter or custom bends/french returns on order
    // entry, those will always come from cpq. so wood from order entry right to finishing."
    // Straight-vs-miter belongs to the ORDER LINE, not the item, so this function keeps wood on the
    // straight case; a mitered CPQ line escalates through lineClassification's per-line
    // partHandling override. S04/S11 therefore sit with the other small-parts colours.
    assert.equal(handlingForErp('H1-138WR/S04'), 'Small Parts');
    assert.equal(handlingForErp('H1-138WR/S11'), 'Small Parts');
    assert.equal(handlingForErp('HCUMP810/SG'), 'Small Parts');
    assert.equal(handlingForErp('HCUMP810/N90'), 'Small Parts');
    assert.equal(handlingForErp('HCUMP810/CP'), 'Small Parts');
    assert.equal(isAppliedFinishCode('S04'), false);            // a stain is not an applied finish
    // Metal is untouched — "metal rules we have correct already".
    ['P', 'P01', 'P25', 'EP3', 'MEP2'].forEach(c => assert.equal(isAppliedFinishCode(c), true, c));
    assert.equal(handlingForErp('HCUMP810/P01'), 'Custom');
    assert.equal(handlingForErp('HCUMP810/EP3'), 'Custom');
    assert.equal(handlingForErp('HCUMP810'), 'Custom');          // a mill code is made to order
    // The stain is still NAMEABLE, for lead time — identification only, never routing.
    assert.equal(isWoodStainCode('S04'), true);
    assert.equal(isWoodStainCode('SG'), false);
});

test('tier: raw / P / PLATE / FIN from the canonical vocabulary, one reader for Stock View and 4.5', () => {
    assert.equal(tierOfErp('H1-75DS'), TIER.RAW);
    assert.equal(tierOfErp('H1-75DS/P'), TIER.P);
    assert.equal(tierOfErp('H1-75DS/EP1'), TIER.PLATE);
    assert.equal(tierOfErp('H1-75DS/MEP2'), TIER.PLATE);
    assert.equal(tierOfErp('H1-75DS/P25'), TIER.PLATE);
    assert.equal(tierOfErp('HCUMB410/BS'), TIER.FIN);
    assert.equal(tierOfErp('X/P01'), TIER.FIN);
});

test('the saw read backwards: which sticks yield a length, and the cut plan for the one chosen', () => {
    // Eric's rules, verbatim (poleCut CUT_OPTIONS): 8 → two 4 ft or one 6 ft; 6 → one 4 ft;
    // 12 → one 8 ft, or one 6 ft + one 4 ft. Read backwards, shortest source first.
    assert.deepEqual(sourcesForLength(6).map(o => [o.sourceFt, o.per]), [[8, 1], [12, 1]]);
    assert.deepEqual(sourcesForLength(4).map(o => [o.sourceFt, o.per]), [[6, 1], [8, 2], [12, 1]]);
    assert.deepEqual(sourcesForLength(8).map(o => [o.sourceFt, o.per]), [[12, 1]]);
    assert.deepEqual(sourcesForLength(12), []);           // nothing longer is stocked
    // A 12 ft cut to 6+4 also leaves a 4 ft — the operator sees that before choosing it.
    assert.deepEqual(sourcesForLength(6).find(o => o.sourceFt === 12).alsoYields, [{ ft: 4, per: 1 }]);

    // Short 5 × 6 ft: one 6 ft per 8 ft stick → 5 sticks, no overrun, 2 ft scrap each.
    const six = cutPlanFromSource({ targetErp: 'HCUMP610/N90', targetFt: 6, sourceFt: 8, per: 1, scrapFt: 2, want: 5 });
    assert.equal(six.sourceItemId, 'HCUMP810');
    assert.equal(six.targetItemId, 'HCUMP610');           // the RAW pull, not the finished variant
    assert.equal(six.sourceQty, 5);
    assert.equal(six.targetQty, 5);
    assert.equal(six.overrun, 0);
    assert.equal(six.scrapFt, 10);
    assert.equal(six.cutTo, '6FT');
    // Short 9 × 4 ft: two per 8 ft stick → 5 sticks, 10 pieces, one spare to stock.
    const four = cutPlanFromSource({ targetErp: 'HCUMP410', targetFt: 4, sourceFt: 8, per: 2, scrapFt: 0, want: 9 });
    assert.equal(four.sourceQty, 5);
    assert.equal(four.targetQty, 10);
    assert.equal(four.overrun, 1);
    // A code with no length grammar cannot be cut, and neither can nothing.
    assert.equal(cutPlanFromSource({ targetErp: 'HMLPXX/SG', targetFt: 6, sourceFt: 8, per: 1, want: 3 }), null);
    assert.equal(cutPlanFromSource({ targetErp: 'HCUMP610', targetFt: 6, sourceFt: 8, per: 1, want: 0 }), null);
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

test('Order Entry custom pair: sales header, finished code, raw rootItem, linked shop sibling', () => {
    const rawPole = { id: 'doc9', legacyErpId: 'HCUMP810', itemName: '8ft pole', netSuiteInternalId: 12500,
        manufacturingSpecs: { productType: 'POLES' } };
    const sales = { soAppId: 'so-app-1', soId: 'SO-77', customerId: 'cust-1', customer: 'Acme', rawErp: 'HCUMP810',
        aliasErp: null, soAccepted: true, flow2: true, stockInternalId: '99001', custom: true, shopWoId: 'WO-OE-HCUMP810-1-C' };
    const { hq, finPayload, shopSibling } = buildParkedWorkOrder({
        intent: 'ORDER_ENTRY', woId: 'WO-OE-HCUMP810-1', part: rawPole, code: 'HCUMP810/P01', qty: 4, brand: 'ce', createdBy: 'stuart',
        reqDate: '2026-09-20', needBy: '2026-09-20', note: 'Order Entry SO-77 · Acme · HCUMP810 in P01',
        source: 'ORDER_ENTRY', routeTo: ROUTE_FINISHING, finish: 'P01',
        partsList: [{ legacyErpId: 'HCUMP810', quantity: 4 }], bomExploded: false,
        gate: { awaitingComponents: true, componentShopWoIds: ['WO-CMP-1'] }, sales, tasks: TASKS, now: NOW,
    });
    // the finishing half
    assert.equal(hq.orderType, 'sales');
    assert.equal(hq.orderClass, 'ORDER_ENTRY');
    assert.equal(hq.soAppId, 'so-app-1');
    assert.equal(hq.customer, 'Acme');
    assert.equal(hq.type, 'HCUMP810/P01');
    assert.equal(hq.erpId, 'HCUMP810/P01');
    assert.equal(hq.rootItem, 'HCUMP810');          // the raw code — the OE Needs board matches on it
    assert.equal(hq.recipe, 'P01');
    assert.equal(hq.awaitingNsWo, true);            // FLOW2 waits for its NetSuite number
    assert.equal(hq.soAccepted, true);
    assert.equal(hq.awaitingComponents, true);
    assert.equal('hqJobId' in hq, false);           // never a CPQ-job lookup key on a sales doc
    assert.equal(hq.stockInternalId, '99001');      // the FLOW2 assembly, not the raw part's id
    assert.equal(finPayload.orderType, 'sales');
    assert.equal(finPayload.orderKey, 'so-app-1');
    assert.equal(finPayload.salesOrderId, 'so-app-1');
    assert.equal(finPayload.soId, 'SO-77');
    assert.equal(finPayload.customerName, 'Acme');
    assert.equal(finPayload.stockErpId, 'HCUMP810/P01');
    assert.equal(finPayload.stockInternalId, '99001');
    assert.equal(finPayload.shopSiblingId, 'SHOP-WO-OE-HCUMP810-1-C');
    assert.equal(finPayload.hasCustomSibling, true);
    assert.equal(finPayload.totalPoles, 4);
    assert.equal(finPayload.finishStream, 'POLES');
    assert.equal(finPayload.partsList[0].legacyErpId, 'HCUMP810');
    // the custom half
    assert.equal(shopSibling.id, 'WO-OE-HCUMP810-1-C');
    assert.equal(shopSibling.routeTo, 'SHOP');
    assert.equal(shopSibling.orderType, 'sales');
    assert.equal(shopSibling.finSiblingId, 'WO-OE-HCUMP810-1');
    assert.equal(shopSibling.hasSmallSibling, true);
    assert.equal(shopSibling.awaitingComponents, true);   // the same gate rides both halves
    assert.equal(shopSibling.awaitingNsWo, true);
    assert.equal(shopSibling.rootItem, 'HCUMP810');
    assert.equal(shopSibling.memo, hq.note);
    assert.equal('finPayload' in shopSibling, false);
    // a complete assembly (/N90) is one finishing WO — no sibling
    const single = buildParkedWorkOrder({ intent: 'ORDER_ENTRY', woId: 'WO-OE-2', part: rawPole, code: 'HCUMP810/N90', qty: 1, brand: 'ce',
        source: 'ORDER_ENTRY', routeTo: ROUTE_FINISHING, finish: 'N90', sales: { ...sales, custom: false, shopWoId: null }, tasks: TASKS, now: NOW });
    assert.equal(single.shopSibling, null);
    assert.equal(single.finPayload.hasCustomSibling, false);
    assert.equal(single.finPayload.shopSiblingId, null);
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
