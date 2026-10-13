// Stock to reallocate (RTG → Day summary) and what NetSuite lists for an item — offline.
//   node scripts/stockReallocate.test.mjs
// Stuart 2026-10-13: "can't we make it show what NS lists as stock and committed but allow them to proceed, add the
// warning/scenario to end of day summary so we can reallocate stock if necessary prior to any build, but this does not
// need to stop production." If a row here breaks, the change is wrong — unless Stuart changed the rule.
import { stockToReallocateOf, stockToReallocateText, orderLine, holdersText, REALLOCATE, REALLOCATE_WORD } from '../src/components/Shared/stockReallocate.js';
import { shelfFiguresOf, onHandSql, committedSql } from '../src/components/Shared/shelfFigures.js';
import { holdsOf } from '../src/components/Shared/stockHolds.js';
import { daySummaryText, daySummaryHtml } from '../src/components/Shared/daySummary.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };

// ── what NetSuite lists ──
{
    const fig = shelfFiguresOf([{ itemid: 'hta635', onhand: '50' }, { itemid: 'HCUMP410', onhand: 66 }, { itemid: 'ONLYBIN', onhand: 4 }],
        [{ itemid: 'HTA635', committed: '50' }, { itemid: 'HCUMP410', committed: 61 }, { itemid: 'NOBIN', committed: 3 }]);
    eq('on hand from the bins, committed from the location', [fig.HTA635.nsOnHand, fig.HTA635.nsCommitted, fig.HCUMP410.nsOnHand, fig.HCUMP410.nsCommitted], [50, 50, 66, 61]);
    eq('an item with a location row and nothing in a bin is 0 on hand', fig.NOBIN, { nsOnHand: 0, nsCommitted: 3 });
    eq('an item in a bin with no commitment row is 0 committed', fig.ONLYBIN, { nsCommitted: 0, nsOnHand: 4 });
    eq('an item neither read knows is left out — unknown, not zero', fig.MISSING, undefined);
    ok('the reads name the location and the codes, upper-cased and quoted', /ib\.location = 17/.test(onHandSql(['hta635', "O'B"], '17')) && /'HTA635','O''B'/.test(onHandSql(['hta635', "O'B"], '17')) && /a\.location = 17/.test(committedSql(['hta635'], 17)));
    eq('no codes → no read', [onHandSql([], '17'), committedSql(['', 'N/A', 'PENDING'], '17')], ['', '']);
    let threw = false; try { onHandSql(['X'], '17; DROP'); } catch (e) { threw = true; }
    ok('a location that is not a number is refused', threw);
}

// ── the morning of 10-13, as NetSuite read ──
const fin = (id, nsWoTran, nsWoId, code, need, extra = {}) => ({ coll: 'fin_workorders', d: { id, nsWoTran, nsWoId, orderType: 'stock', materialRows: [{ code, name: code, need, coverCodes: [code] }], ...extra } });
const figures = { HTA635: { nsOnHand: 50, nsCommitted: 50 }, HCUMP410: { nsOnHand: 66, nsCommitted: 61 }, HCUNEC1: { nsOnHand: 1, nsCommitted: 0 }, HCUSR1: { nsOnHand: 404, nsCommitted: 404 }, RING: { nsOnHand: 50, nsCommitted: 0 } };
const holds = holdsOf([
    ...['WO11718', 'WO11719', 'WO11720', 'WO11721', 'WO11722'].map((t, i) => ({ itemid: 'HTA635', tid: String(952700 + i), tranid: t, ttype: 'WorkOrd', held: 10 })),
    ...['WO11711', 'WO11712', 'WO11713', 'WO11714', 'WO11717'].map((t, i) => ({ itemid: 'HCUMP410', tid: String(951879 + i), tranid: t, ttype: 'WorkOrd', held: 10 })),
    { itemid: 'HCUMP410', tid: '900001', tranid: 'SO60900', ttype: 'SalesOrd', held: 11 },
    { itemid: 'HCUSR1', tid: '1', tranid: 'SO60161', ttype: 'SalesOrd', held: 16 }, { itemid: 'HCUSR1', tid: '2', tranid: 'SO60676', ttype: 'SalesOrd', held: 88 }, { itemid: 'HCUSR1', tid: '3', tranid: 'WO11652', ttype: 'WorkOrd', held: 300 },
], ['HTA635', 'HCUMP410', 'HCUNEC1', 'HCUSR1', 'RING']);
const refOf = (d) => d.nsWoTran || d.id;

{
    // Four of the five HTA635 work orders are still to be picked (WO11721 is picked — not in the list); each holds its ten.
    const docs = ['WO11718', 'WO11719', 'WO11720', 'WO11722'].map((t, i) => fin(`F${i}`, t, String(952700 + [0, 1, 2, 4][i]), 'HTA635', 10));
    eq('fifty on the shelf, ten held for each of the orders that want ten: nothing to reallocate', stockToReallocateOf({ docs, figures, holds, refOf }), []);
    // …a sixth order NetSuite holds nothing for wants ten of the same poles.
    const six = stockToReallocateOf({ docs: [...docs, { coll: 'fin_workorders', d: { id: 'WO-OE-SO61100-1', salesOrderId: 'SO61100', orderType: 'sales', materialRows: [{ code: 'HTA635', name: 'Pole 6ft', need: 10 }] } }], figures, holds, refOf });
    eq('a sixth order with no hold: the item is listed HELD — on the shelf, committed to others', [six.length, six[0].code, six[0].kind, six[0].onHand, six[0].committed, six[0].wanted], [1, 'HTA635', REALLOCATE.HELD, 50, 50, 50]);
    eq('the order that cannot be covered comes first, with what is free for it', [six[0].orders[0].ref, six[0].orders[0].need, six[0].orders[0].ownHeld, six[0].orders[0].free, six[0].orders[0].state], ['WO-OE-SO61100-1', 10, 0, 0, REALLOCATE.HELD]);
    eq('the others read covered by their own hold', six[0].orders.slice(1).map(o => [o.ref, o.ownHeld, o.free, o.state]), [['WO11718', 10, 10, 'OK'], ['WO11719', 10, 10, 'OK'], ['WO11720', 10, 10, 'OK'], ['WO11722', 10, 10, 'OK']]);
    eq('who NetSuite holds it for — ours marked, the picked order\'s ten is not one of the listed', six[0].heldFor.map(h => `${h.tran}:${h.qty}:${h.ours ? 'ours' : 'other'}`).sort(), ['WO11718:10:ours', 'WO11719:10:ours', 'WO11720:10:ours', 'WO11721:10:other', 'WO11722:10:ours']);
    eq('free = on hand less what is held for anyone not listed', six[0].free, 40);
    eq('its line', orderLine(six[0].orders[0]), 'WO-OE-SO61100-1 needs 10 — 0 free for it, the rest is committed to other orders');
    eq('a covered line', orderLine(six[0].orders[1]), 'WO11718 needs 10 (10 held for it) — covered, 10 free for it');
}
{
    // Not on the shelf at all.
    const r = stockToReallocateOf({ docs: [fin('F', 'WO11635', '930190', 'HCUNEC1', 50, { materialRows: [{ code: 'HCUNEC1', name: 'End cap', need: 50, coveredBy: '🧾 PO · Acme · 50 × HCUNEC1' }] })], figures, holds, refOf });
    eq('one on the shelf, fifty wanted: SHORT', [r[0].kind, r[0].onHand, r[0].orders[0].state, r[0].orders[0].free, r[0].orders[0].coveredBy], [REALLOCATE.SHORT, 1, REALLOCATE.SHORT, 1, '🧾 PO · Acme · 50 × HCUNEC1']);
    eq('its line says how many short', orderLine(r[0].orders[0]), 'WO11635 needs 50 — 1 free for it — short 49');
    eq('nothing committed', holdersText(r[0]), 'nothing committed');
}
{
    // A sales order's own hold counts by its NetSuite number or id (the WMS warnings' rule).
    const so = { id: 'APP1', soId: 'SO60676', nsInternalId: '2' };
    const d = { coll: 'fin_workorders', d: { id: 'WO-SO60676', salesOrderId: 'APP1', orderType: 'sales', materialRows: [{ code: 'HCUSR1', name: '1" Ring', need: 88 }] } };
    eq('404 on hand, 404 committed, 88 of them this order\'s: covered', stockToReallocateOf({ docs: [d], figures, holds, refOf, soOf: () => so }), []);
    const noSo = stockToReallocateOf({ docs: [d], figures, holds, refOf });
    eq('…read without its sales order it cannot tell the hold is its own: HELD', [noSo[0].kind, noSo[0].orders[0].free], [REALLOCATE.HELD, 0]);
    eq('holders, largest first', holdersText(noSo[0]), 'WO11652 300, SO60676 88, SO60161 16');
}
{
    // SHARED: two parked orders NetSuite commits nothing for each see the same fifty.
    const a = { coll: 'hq_work_orders', d: { id: 'WO-A', materialRows: [{ code: 'RING', need: 40 }] } };
    const b = { coll: 'hq_work_orders', d: { id: 'WO-B', materialRows: [{ code: 'RING', need: 40 }] } };
    const r = stockToReallocateOf({ docs: [a, b], figures, holds, refOf });
    eq('each is covered alone, together they want eighty of fifty', [r[0].kind, r[0].wanted, r[0].free, r[0].orders.map(o => o.state)], [REALLOCATE.SHARED, 80, 50, ['OK', 'OK']]);
    eq('one of them alone is nothing to report', stockToReallocateOf({ docs: [a], figures, holds, refOf }), []);
}
{
    // One claim per release: the RTG record, its finishing document and its shop sibling carry the SAME rows.
    const rows = [{ code: 'RING', name: 'Ring', need: 40 }];
    const trio = [{ coll: 'hq_work_orders', d: { id: 'WO-OE-1', materialRows: rows } }, { coll: 'fin_workorders', d: { id: 'WO-OE-1', nsWoTran: 'WO12000', materialRows: rows } }, { coll: 'shop_custom_orders', d: { id: 'SHOP-9', finSiblingId: 'WO-OE-1', materialRows: rows } }];
    eq('three documents of one release want forty once — covered by fifty', stockToReallocateOf({ docs: trio, figures, holds, refOf }), []);
    const two = stockToReallocateOf({ docs: [...trio, { coll: 'fin_workorders', d: { id: 'WO-OE-2', materialRows: rows } }], figures, holds, refOf });
    eq('…and it is named by its finishing document', [two[0].orders.map(o => o.ref), two[0].wanted], [['WO-OE-2', 'WO12000'], 80]);
    eq('a record that points at its finishing document by finWoId is the same claim', stockToReallocateOf({ docs: [{ coll: 'hq_work_orders', d: { id: 'REC-1', finWoId: 'FIN-1', materialRows: rows } }, { coll: 'fin_workorders', d: { id: 'FIN-1', materialRows: rows } }], figures, holds, refOf }), []);
}
{
    // What cannot be read is never guessed.
    const d = fin('F', 'WO1', '9', 'UNKNOWN', 5);
    eq('an item with no figure is left out', stockToReallocateOf({ docs: [d], figures, holds, refOf }), []);
    const blind = stockToReallocateOf({ docs: [fin('F', 'WO11722', '952704', 'HTA635', 10)], figures, holds: null, refOf });
    eq('holders not read: every commitment counts against the order, and it says so', [blind[0].kind, blind[0].orders[0].free, blind[0].orders[0].ownHeld, blind[0].holdersKnown, holdersText(blind[0])], [REALLOCATE.HELD, 0, null, false, 'who it is held for could not be read']);
    // A painted row sums its cover codes.
    const painted = { coll: 'fin_workorders', d: { id: 'P', materialRows: [{ code: 'X/P06', need: 30, coverCodes: ['X/P06', 'X/P', 'X'] }] } };
    const r = stockToReallocateOf({ docs: [painted], figures: { 'X/P': { nsOnHand: 20, nsCommitted: 20 }, X: { nsOnHand: 15, nsCommitted: 0 } }, holds: holdsOf([{ itemid: 'X/P', tid: '5', tranid: 'SO1', ttype: 'SalesOrd', held: 20 }], ['X/P06', 'X/P', 'X']), refOf });
    eq('cover codes: 35 on the shelf, 20 held for another order, 30 wanted → HELD with 15 free', [r[0].kind, r[0].onHand, r[0].committed, r[0].orders[0].free], [REALLOCATE.HELD, 35, 20, 15]);
    eq('rows with no need or no code are ignored', stockToReallocateOf({ docs: [{ coll: 'fin_workorders', d: { id: 'Z', materialRows: [{ code: '', need: 5 }, { code: 'RING', need: 0 }] } }], figures, holds, refOf }), []);
}
{
    // Order on the page: not on the shelf first, then held, then shared.
    const docs = [
        { coll: 'hq_work_orders', d: { id: 'WO-A', materialRows: [{ code: 'RING', need: 40 }] } }, { coll: 'hq_work_orders', d: { id: 'WO-B', materialRows: [{ code: 'RING', need: 40 }] } },
        fin('F1', 'WO11635', '930190', 'HCUNEC1', 50), { coll: 'fin_workorders', d: { id: 'S', materialRows: [{ code: 'HTA635', need: 10 }] } },
    ];
    const r = stockToReallocateOf({ docs, figures, holds, refOf });
    eq('SHORT, HELD, SHARED', r.map(x => `${x.code}:${x.kind}`), ['HCUNEC1:SHORT', 'HTA635:HELD', 'RING:SHARED']);
    const text = stockToReallocateText(r);
    ok('the text names each item, its figures, each order and the holders', /^STOCK TO REALLOCATE — every open order, as NetSuite reads now \(nothing here stops the floor\)/.test(text)
        && /• HCUNEC1 — HCUNEC1: NOT ON THE SHELF · on hand 1 · committed 0 · wanted 50 by 1 order/.test(text)
        && /• HTA635: ON THE SHELF — COMMITTED TO OTHER ORDERS · on hand 50 · committed 50 · wanted 10 by 1 order/.test(text)
        && /• RING: MORE WANTED THAN IS FREE · on hand 50 · committed 0 · wanted 80 by 2 orders/.test(text)
        && / {4}NetSuite holds it for: WO11718 10, WO11719 10, WO11720 10, WO11721 10, WO11722 10/.test(text));
    eq('nothing to reallocate → no text', stockToReallocateText([]), '');
    ok('every kind has its words', Object.values(REALLOCATE).every(k => REALLOCATE_WORD[k]));
    // The Day summary's copy and print carry the section; without it they read as before.
    const sum = { counts: { entered: 0, orderEntry: 0, cpq: 0, display: 0, needAttention: 0, onFloor: 0, parked: 0, asAvailable: 0, backorderedParts: 0 }, rows: [], backorders: [] };
    ok('copy text: the section is appended', daySummaryText(sum, { day: '2026-10-13', brand: 'ce', stock: r }).includes('STOCK TO REALLOCATE') && !daySummaryText(sum, { day: '2026-10-13', brand: 'ce' }).includes('STOCK TO REALLOCATE'));
    const html = daySummaryHtml(sum, { day: '2026-10-13', brand: 'ce', stock: r });
    ok('print: the section is a table of its own', /<h2>Stock to reallocate/.test(html) && /<b>HCUNEC1<\/b>/.test(html) && /NOT ON THE SHELF/.test(html) && /WO11635 needs 50/.test(html) && !/<h2>Stock to reallocate/.test(daySummaryHtml(sum, { day: '2026-10-13' })));
}

console.log(`stockReallocate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
