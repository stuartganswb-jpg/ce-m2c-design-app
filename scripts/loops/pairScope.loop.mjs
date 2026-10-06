// A ROW'S CLOSE, HOLD AND REOPEN REACH THAT ROW ONLY (Stuart 2026-10-06: "fix the rtg bug"). RTG's ✕ Close on one row's
// work order of a display order closed every other row's shop job on that sales order; from the Setup Queue the same
// close reached every row's finishing job and the sales order itself. Two rows of one order on the in-memory Firestore,
// written with the keys the real writers give them (Shared/rowPairShape, Shared/floorRelease.buildShopDoc), and the
// REAL lifecycle functions run against them.
//   node --import ./scripts/loops/register.mjs scripts/loops/pairScope.loop.mjs
import { __fs, doc, getDoc, getDocs, query, collection, where, updateDoc, setDoc, deleteDoc } from './fake-firestore.mjs';
const L = await import('../../src/components/Shared/orderLifecycle.js');
const H = await import('../../src/components/Shared/orderHold.js');

let pass = 0, fail = 0;
const ok = (n, c, detail = '') => { if (c) pass++; else { fail++; console.log(`✗ ${n}${detail ? `\n    ${detail}` : ''}`); } };
const eq = (n, got, want) => ok(n, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
const db = { __fake: true };
const ctx = { db, doc, getDoc, getDocs, query, collection, where, updateDoc, setDoc, deleteDoc };

const SO = { id: 'SO-APP-X', soId: 'SO60585', status: 'Dispatched', orderClass: 'QUICKSHIP', displayRelease: true };
const X = (n) => `WO-OE-SO60585-000${n}`;
const rec = (n) => ({ id: X(n), woId: X(n), soId: 'SO60585', soAppId: 'SO-APP-X', status: 'Dispatched', orderType: 'sales', routeTo: 'FINISHING', shopSiblingId: `SHOP-${X(n)}-C`, shopWoId: `${X(n)}-C` });
const recC = (n) => ({ id: `${X(n)}-C`, woId: `${X(n)}-C`, soId: 'SO60585', soAppId: 'SO-APP-X', status: 'Dispatched', orderType: 'sales', routeTo: 'SHOP', finSiblingId: X(n) });
const fin = (n) => ({ id: X(n), orderKey: 'SO-APP-X', salesOrderId: 'SO-APP-X', soId: 'SO60585', orderType: 'sales', currentPhase: 'Setup', stepStatus: 'Pending', pickStatus: 'Pending', sentToPickPack: true, shopSiblingId: `SHOP-${X(n)}-C` });
const shop = (n) => ({ id: `SHOP-${X(n)}-C`, orderKey: 'SO60585', finSiblingId: X(n), status: 'In Process' });
const seed = () => {
    __fs.reset();
    __fs.seed('hq_sales_orders', SO.id, SO);
    [1, 2].forEach(n => {
        __fs.seed('hq_work_orders', X(n), rec(n)); __fs.seed('hq_work_orders', `${X(n)}-C`, recC(n));
        __fs.seed('fin_workorders', X(n), fin(n)); __fs.seed('shop_custom_orders', `SHOP-${X(n)}-C`, shop(n));
        __fs.seed('rod_cut_orders', `RC-${X(n)}`, { id: `RC-${X(n)}`, status: 'OPEN', finWoId: X(n) });
    });
    // the order's retired whole-order shop document, closed long ago — it must not be re-stamped
    __fs.seed('shop_custom_orders', 'SHOP-SO60585', { id: 'SHOP-SO60585', orderKey: 'SO60585', status: 'Completed', closed: true, closedFrom: '10.5', closedAt: 5, closedBy: 'then' });
};
const g = (c, id) => __fs.get(c, id);
const row2Untouched = () => [g('fin_workorders', X(2)).currentPhase, g('shop_custom_orders', `SHOP-${X(2)}-C`).status, g('shop_custom_orders', `SHOP-${X(2)}-C`).closed || false, g('hq_work_orders', X(2)).status, g('rod_cut_orders', `RC-${X(2)}`).status];
const R2 = ['Setup', 'In Process', false, 'Dispatched', 'OPEN'];

// ── what one row's document reaches ──
seed();
{
    const fromRec = await L.linkedDocsOf(ctx, rec(1), 'stock');
    eq('from the RTG record: its finishing job, its shop job, its own record', [[...fromRec.fin.keys()], [...fromRec.shop.keys()], fromRec.hq && `${fromRec.hq.coll}/${fromRec.hq.id}`], [[X(1)], [`SHOP-${X(1)}-C`], `hq_work_orders/${X(1)}`]);
    const fromFin = await L.linkedDocsOf(ctx, fin(1), 'sales');
    eq('from the finishing job (as the Setup Queue asks): the same — never the sales order, never row 2', [[...fromFin.fin.keys()], [...fromFin.shop.keys()], fromFin.hq && `${fromFin.hq.coll}/${fromFin.hq.id}`], [[X(1)], [`SHOP-${X(1)}-C`], `hq_work_orders/${X(1)}`]);
    const fromShop = await L.linkedDocsOf(ctx, shop(1), 'stock');
    eq('from the shop job: the same pair', [[...fromShop.fin.keys()], [...fromShop.shop.keys()]], [[X(1)], [`SHOP-${X(1)}-C`]]);
    const fromRecAsSales = await L.linkedDocsOf(ctx, rec(1), 'sales');
    eq('…and asked as a sales document (the audit\'s close): still its own record, not the sales order', fromRecAsSales.hq && `${fromRecAsSales.hq.coll}/${fromRecAsSales.hq.id}`, `hq_work_orders/${X(1)}`);
    const fromSo = await L.linkedDocsOf(ctx, SO, 'sales');
    eq('from the SALES ORDER itself: every row, as always', [[...fromSo.fin.keys()].sort(), [...fromSo.shop.keys()].sort(), fromSo.hq && fromSo.hq.id], [[X(1), X(2)], ['SHOP-SO60585', `SHOP-${X(1)}-C`, `SHOP-${X(2)}-C`], 'SO-APP-X']);
}

// ── RTG ✕ Close on row 1's work order ──
seed();
{
    const res = await L.closeOrderEverywhere(ctx, { order: rec(1), kind: 'stock', by: 'stuart', from: 'RTG', reason: 'row 1 only' });
    eq('closes ONE finishing job, ONE shop job, its record — and its own rod cut', [res.fin, res.shop, res.hq, res.rodCuts, res.shopIds], [1, 1, 1, 1, [`SHOP-${X(1)}-C`]]);
    eq('row 1 is closed', [g('fin_workorders', X(1)).currentPhase, g('shop_custom_orders', `SHOP-${X(1)}-C`).closed, g('hq_work_orders', X(1)).status], ['Closed', true, 'Closed']);
    eq('ROW 2 IS UNTOUCHED — its finishing job, its shop job, its record, its rod cut', row2Untouched(), R2);
    eq('the sales order is untouched', g('hq_sales_orders', SO.id).status, 'Dispatched');
    eq('the retired whole-order document keeps the close it had', [g('shop_custom_orders', 'SHOP-SO60585').closedBy, g('shop_custom_orders', 'SHOP-SO60585').closedAt], ['then', 5]);
}

// ── the Setup Queue's ✕ Close on row 1's finishing job (it asks as a sales document) ──
seed();
{
    const res = await L.closeOrderEverywhere(ctx, { order: fin(1), kind: 'sales', by: 'floor', from: 'SETUP_QUEUE' });
    eq('closes that row\'s pair and its RTG record', [res.fin, res.shop, res.hq, res.hqFound], [1, 1, 1, true]);
    eq('…never the sales order, never row 2', [g('hq_sales_orders', SO.id).status, ...row2Untouched()], ['Dispatched', ...R2]);
}

// ── the audit's close (it asks as a sales document because the record carries a sales order number) ──
seed();
{
    await L.closeOrderEverywhere(ctx, { order: rec(1), kind: 'sales', by: 'audit', from: 'RTG_AUDIT' });
    eq('the row\'s record closes; the sales order and row 2 do not', [g('hq_work_orders', X(1)).status, g('hq_sales_orders', SO.id).status, ...row2Untouched()], ['Closed', 'Dispatched', ...R2]);
}

// ── a hold on one row stops that row ──
seed();
{
    const res = await H.holdOrder(ctx, { order: fin(1), kind: 'sales', stage: 'WMS', reason: 'short a part', by: 'sandra' });
    eq('three documents stopped: its finishing job, its shop job, its record', res.docs, 3);
    eq('row 1 held; row 2 and the sales order are not', [g('fin_workorders', X(1)).held, g('shop_custom_orders', `SHOP-${X(1)}-C`).held, g('hq_work_orders', X(1)).held, g('fin_workorders', X(2)).held || false, g('shop_custom_orders', `SHOP-${X(2)}-C`).held || false, g('hq_sales_orders', SO.id).held || false], [true, true, true, false, false, false]);
    await H.releaseHold(ctx, { order: fin(1), kind: 'sales', note: 'part arrived', by: 'sandra' });
    eq('…and the release lifts exactly what the hold set', [g('fin_workorders', X(1)).held, g('shop_custom_orders', `SHOP-${X(1)}-C`).held, g('hq_work_orders', X(1)).held], [false, false, false]);
}

// ── UNCHANGED: the floor's report still goes to the record it always went to ──
seed();
{
    const id = await L.propagateFloorState(ctx, { finWo: fin(1), phase: 'Complete', by: 'jhonaton' });
    eq('a pair\'s finishing report lands where it did before this fix (the order\'s record)', [id, g('hq_sales_orders', SO.id).floorPhase, g('hq_work_orders', X(1)).floorPhase || null], ['SO-APP-X', 'Complete', null]);
    const id2 = await L.propagateFloorState(ctx, { finWo: { id: X(1), salesOrderId: 'SO60585' }, phase: 'Plated', by: 'wms' });
    eq('…and the plating put-away\'s report still lands on the pair\'s own record', [id2, g('hq_work_orders', X(1)).floorPhase], [X(1), 'Plated']);
}

// ── UNCHANGED: a whole-order (CPQ split) order closes whole, from any of its documents ──
{
    __fs.reset();
    __fs.seed('hq_sales_orders', 'SO-APP-Q', { id: 'SO-APP-Q', soId: 'SO60170', status: 'Dispatched' });
    __fs.seed('fin_workorders', 'WO-SO60170-P24', { id: 'WO-SO60170-P24', orderKey: 'SO60170', orderType: 'sales', currentPhase: 'Setup' });
    __fs.seed('fin_workorders', 'WO-SO60170-S03', { id: 'WO-SO60170-S03', orderKey: 'SO60170', orderType: 'sales', currentPhase: 'Setup' });
    __fs.seed('shop_custom_orders', 'SHOP-SO60170-P24', { id: 'SHOP-SO60170-P24', orderKey: 'SO60170', status: 'Pending' });
    const res = await L.closeOrderEverywhere(ctx, { order: { id: 'WO-SO60170-P24', orderKey: 'SO60170', orderType: 'sales' }, kind: 'sales', by: 'x', from: 'SETUP_QUEUE' });
    eq('a CPQ order split by finish still closes as ONE order (both finishing jobs, the shop job, the sales order)', [res.fin, res.shop, res.hq, __fs.get('hq_sales_orders', 'SO-APP-Q').status], [2, 1, 1, 'Closed']);
}

console.log(`pairScope loop: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
