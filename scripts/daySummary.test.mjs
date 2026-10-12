// node scripts/daySummary.test.mjs — the day's orders as management reads them on RTG (Stuart 2026-10-12).
import { daySummaryOf, orderWorkOf, dayBoundsOf, dayStrOf, daySummaryText, daySummaryHtml, DOOR, VERDICT, msOf } from '../src/components/Shared/daySummary.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const { start, end } = dayBoundsOf('2026-10-12');
ok('a day is local midnight to the next', end - start === 86400000 && dayStrOf(start) === '2026-10-12' && dayStrOf(end - 1) === '2026-10-12' && dayStrOf(end) === '2026-10-13');
eq('a moment, whatever shape it was saved in', [msOf(5), msOf({ seconds: 2 }), msOf({ toMillis: () => 7 }), msOf(null)], [5, 2000, 7, 0]);
const at = (h) => start + h * 3600000;
const isOrderEntry = (o) => o.orderClass === 'QUICKSHIP';

// Order Entry, as available: the ready lines on the floor, the bracket parked behind its milling.
const oeA = { id: 'QS-1', soId: 'SO61001', customer: 'READ WINDOW', orderClass: 'QUICKSHIP', status: 'Pending', nsInternalId: '950001', createdAt: at(9), createdBy: 'Eric',
    finishMode: 'AS_AVAILABLE', finishAsAvailable: true, finishAsAvailableBy: 'Eric',
    lines: [{ erp: 'HTAEC35', toBeFinished: true }, { erp: 'HRW-138TRAVLB', toBeFinished: true }], oeGen: { 0: { kind: 'WO' }, 1: { kind: 'WO' } } };
const woNow = { id: 'WO-OE-SO61001-1111', soAppId: 'QS-1', status: 'Dispatched', routeTo: 'FINISHING', finishGroup: 'RF1', finPayload: { id: 'WO-OE-SO61001-1111' } };
const woLater = { id: 'WO-OE-SO61001-2222', soAppId: 'QS-1', status: 'Approved', routeTo: 'FINISHING', finishGroup: 'RF1', awaitingComponents: true, componentShopWoIds: ['WO-CMP-1'] };
const finNow = { id: 'WO-OE-SO61001-1111', orderKey: 'QS-1', currentPhase: 'Setup' };
// Order Entry, complete, still with a person: nothing started.
const oeB = { id: 'QS-2', soId: 'SO61002', customer: 'FABRICUT', orderClass: 'QUICKSHIP', status: 'Pending', nsInternalId: '950002', createdAt: at(11), createdBy: 'Sandra G', finishMode: 'COMPLETE', finishAsAvailable: false,
    lines: [{ erp: 'H1-75SR', toBeFinished: true }, { erp: 'H1-75SPF', toBeFinished: true }],
    oeAuto: { state: 'NEEDS_REVIEW', at: at(11), review: [{ lineIdx: 0, erp: 'H1-75SR', finish: 'P06', reasons: ['bought item — the purchase is reviewed'] }] } };
// CPQ, split and on hold for a backorder that day.
const cpq = { id: 'SO-APP-Q1', soId: 'SO61003', customer: 'FABRICUT', status: 'Dispatched', nsInternalId: '950003', hqJobId: 'JOB-1', createdAt: { seconds: at(13) / 1000 },
    backorderLines: [{ code: 'H1-138ILPS/EP5', qty: 3, onOrder: 0, name: 'Inside loop' }], backorderAt: at(13) };
const cpqFin = { id: 'WO-SO61003', orderKey: 'SO61003', currentPhase: 'Setup', held: true, heldReason: 'waiting on backordered material — 3 × H1-138ILPS/EP5', recipe: 'EP5' };
// CPQ, accepted, not yet split; and one NetSuite has not taken yet.
const cpqNew = { id: 'SO-APP-Q2', soId: 'SO61004', customer: 'BRIMAR', status: 'Approved', nsInternalId: '950004', hqJobId: 'JOB-2', createdAt: at(15) };
const queued = { id: 'QS-9', soId: 'QS-9', customer: 'KRAVET', orderClass: 'QUICKSHIP', status: 'NS_QUEUED', createdAt: at(16), lines: [{ erp: 'H1-1R/EP2' }] };
// Not that day; a display shipment; a deleted one; an older order whose part went on backorder TODAY.
const yesterday = { id: 'QS-0', soId: 'SO60990', customer: 'OLD', orderClass: 'QUICKSHIP', status: 'Pending', nsInternalId: '1', createdAt: start - 5 };
const dsp = { id: 'QS-DSP-1', soId: 'SO61009', packMode: 'DISPLAY', status: 'Pending', createdAt: at(10) };
const gone = { ...oeB, id: 'QS-3', deleted: true };
const older = { id: 'SO-APP-Q0', soId: 'SO60900', customer: 'FABRICUT', status: 'Dispatched', nsInternalId: '2', createdAt: start - 9 * 86400000, backorderLines: [{ code: 'H1-138ILPS/EP5', qty: 2, onOrder: 10 }, { code: 'H1-75CC/EP1', qty: 4 }], backorderAt: at(8) };

const sum = daySummaryOf({ orders: [cpqNew, oeB, yesterday, oeA, dsp, gone, cpq, queued, older], workOrders: [woNow, woLater], finDocs: [finNow, cpqFin], shopDocs: [], start, end, isOrderEntry, now: at(17) });
eq('the day\'s orders, in the order they were entered — not yesterday\'s, not a display shipment, not a deleted one', sum.rows.map(r => [r.ref, r.door]), [['SO61001', DOOR.OE], ['SO61002', DOOR.OE], ['SO61003', DOOR.CPQ], ['SO61004', DOOR.CPQ], ['QS-9', DOOR.OE]]);
eq('each one\'s standing, in a word', sum.rows.map(r => r.verdict), [VERDICT.FLOOR, VERDICT.REVIEW, VERDICT.HOLD, VERDICT.NOT_STARTED, VERDICT.NETSUITE]);
eq('who entered it, what NetSuite said, how it finishes and who chose', sum.rows.slice(0, 3).map(r => [r.enteredBy, r.netsuite, r.finishMode, r.finishAsked, r.finishBy]),
    [['Eric', 'accepted · SO61001', 'AS_AVAILABLE', true, 'Eric'], ['Sandra G', 'accepted · SO61002', 'COMPLETE', true, ''], ['', 'accepted · SO61003', 'COMPLETE', false, '']]);
eq('as available: one work order on the floor, the other parked and saying what it waits for', sum.rows[0].work.map(w => [w.ref, w.state, w.finish, /on the floor|Setup/.test(w.text) || /parked/.test(w.text)]),
    [['WO-OE-SO61001-1111', 'FLOOR', 'RF1', true], ['WO-OE-SO61001-2222', 'PARKED', 'RF1', true]]);
ok('…the parked one names its gate', /^parked — /.test(sum.rows[0].work[1].text) && sum.rows[0].work[1].text.length > 12);
eq('waiting for review: the line and the reason the automatic start recorded; both lines not started', [sum.rows[1].review.map(l => [l.lineIdx, l.erp]), sum.rows[1].unstarted.length, sum.rows[1].canReview], [[[0, 'H1-75SR']], 2, true]);
eq('a CPQ order on hold says why, and carries its backorder', [sum.rows[2].work.map(w => [w.ref, w.held, /ON HOLD — waiting on backordered material/.test(w.text)]), sum.rows[2].backorders], [[['WO-SO61003', true, true]], [{ code: 'H1-138ILPS/EP5', qty: 3, onOrder: 0, name: 'Inside loop' }]]);
eq('what the screen may offer: a CPQ order not yet split can be dispatched; nothing else can', sum.rows.map(r => r.canDispatch), [false, false, false, true, false]);
eq('BACKORDERED TODAY — by part, across every order whose part went short that day (an older order too)', sum.backorders.map(b => [b.code, b.qty, b.onOrder, b.orders]),
    [['H1-138ILPS/EP5', 5, 10, ['SO61003', 'SO60900']], ['H1-75CC/EP1', 4, 0, ['SO60900']]]);
eq('the counts at the top', sum.counts, { entered: 5, orderEntry: 3, cpq: 2, display: 0, needAttention: 4, onFloor: 1, parked: 0, asAvailable: 1, backorderedParts: 2 });
eq('a complete order whose only work order is ready waits for its unstarted line — and says so', orderWorkOf({ so: { ...oeB, oeGen: { 0: { kind: 'WO' } } }, workOrders: [{ id: 'WO-OE-SO61002-1', soAppId: 'QS-2', status: 'Approved', routeTo: 'FINISHING' }] })[0].text, 'parked — waiting for the rest of the order — 1 line not started yet (H1-75SPF)');
eq('an order of stock lines only is a pick and pack; a closed one is closed', [
    daySummaryOf({ orders: [{ id: 'QS-5', soId: 'SO61010', orderClass: 'QUICKSHIP', status: 'Pending', nsInternalId: '9', createdAt: at(9), lines: [{ erp: 'H1-1R/EP2' }] }], start, end, isOrderEntry }).rows[0].verdict,
    daySummaryOf({ orders: [{ ...oeA, status: 'Closed' }], start, end, isOrderEntry }).rows[0].verdict,
], [VERDICT.STOCK, VERDICT.CLOSED]);
eq('an empty day', [daySummaryOf({ orders: [yesterday], start, end, isOrderEntry }).rows, daySummaryOf({ orders: [yesterday], start, end, isOrderEntry }).counts.entered], [[], 0]);
const text = daySummaryText(sum, { day: '2026-10-12', brand: 'ce' });
ok('in words: the heading, each order with its standing, its work, its review and its backorder — then the day\'s backorders', /^ORDERS ENTERED 2026-10-12 · CE\n5 entered \(3 Order Entry, 2 CPQ\) · 4 need attention/.test(text)
    && /\nSO61002 · FABRICUT · Order Entry · Sandra G .* — WAITING FOR REVIEW/.test(text) && /\nQS-9 · KRAVET|\nSO QS-9 · KRAVET/.test(text) && /needs review — line 1 H1-75SR: bought item/.test(text) && /BACKORDERED TODAY\n {3}5 × H1-138ILPS\/EP5 — Inside loop · SO61003, SO60900 · 10 on order/.test(text));
const html = daySummaryHtml(sum, { day: '2026-10-12', brand: 'ce', printedBy: 'Stuart' });
ok('a page to print: letter, the same facts, nothing unescaped', /size: letter portrait/.test(html) && /<b>SO61001<\/b>/.test(html) && /Backordered today/.test(html) && /printed by Stuart/.test(html) && !/<script/i.test(daySummaryHtml({ ...sum, rows: [{ ...sum.rows[0], customer: '<script>x</script>' }] })));
console.log(`daySummary: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
