// Harness for displayRelease — 10.5 as mission control for a display order.
//
//   node scripts/displayRelease.test.mjs
//
// Three things can go wrong here and none of them is visible on the screen: a breakdown line lands
// in the wrong row, a physical part is dropped (or a non-part is kept) on the way into the line
// shape, or a row reads "done" while a line on it is still waiting. Each is a wrong thing on the
// floor, so each gets a case.

import {
    rowKeyOf, rowOfLine, rowLinesFromBreakdown, soRowsOf, lineStateOf, rowStateOf,
    displayAnchorPatch, soNeedsLines, rowStartText, LINE_STATE, ROW_STATE, wholeOrderDocsOf, wholeOrderText, retireBlockersOf, retireText, splitRetiredOf, packagingIdsOf, needsPackCard, packCardToRemove,
} from '../src/components/Shared/displayRelease.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── ROW KEYS ────────────────────────────────────────────────────────────────────────────────
eq('a row label becomes a safe field key', rowKeyOf('Row 2'), 'ROW_2');
eq('case and spacing do not matter', rowKeyOf('  row 2 '), 'ROW_2');
eq('a tab-7 line names its row in the memo', rowOfLine({ memo: 'Row 3' }), 'Row 3');
eq('a written row wins over the memo', rowOfLine({ row: 'Row 1', memo: 'left window' }), 'Row 1');

// ── THE CPQ BREAKDOWN → LINES, ONE PER PART PER ROW ─────────────────────────────────────────
{
    const breakdown = [
        { name: '▶ H1-75 [Row 1]  ·  P06', isHeader: true, sidemark: 'Row 1', qty: 35, total: 1 },
        { name: '  - Pole', legacyErpId: 'H1-75SR', qty: 35, price: 30, total: 1050, finishCode: 'P06', perFoot: true, feet: 2, cutLength: 18 },
        { name: '  - Finial', legacyErpId: 'H1-75SPF', qty: 70, price: 5, total: 350, finishCode: 'P06' },
        { name: '  - Standoff', legacyErpId: 'H1-1STDOFF', qty: 70, price: 0, total: 0, hidden: true, finishCode: 'P06' },
        { name: '  Trade Discount - (20%)', qty: 1, price: -1, total: -1, isDiscount: true },
        { name: '  Net Line Total', qty: 1, price: 1, total: 1, isNetLine: true },
        { name: 'Rod Diameter: 3/4"', qty: 0, isSizeRow: true },
        { name: '  - Parked', legacyErpId: 'HIDDEN-node7', qty: 1, price: 0, total: 0 },
        // An older header with the row only in the brackets.
        { name: '▶ H1-1 [Row 2]  ·  EP2', isHeader: true, qty: 35, total: 1 },
        { name: '  - Pole', legacyErpId: 'H1-1R', qty: 35, price: 1, total: 1, finishCode: 'EP2', perFoot: true, feet: 2 },
        { name: '  - Acrylic', legacyErpId: 'H1-1ACR', qty: 35, price: 1, total: 1 },
        { name: '  - Bend fee', qty: 35, price: 5, total: 175, isFee: true },
        { name: 'Add-ons & Fees', qty: 1, price: 0, total: 0, isHeader: true },
        { name: '  - Rush', qty: 1, price: 50, total: 50, isFee: true, isAddOn: true },
    ];
    const lines = rowLinesFromBreakdown(breakdown);
    eq('exactly the physical parts survive — including the hidden standoff, which is built and picked',
        lines.map(l => l.erp), ['H1-75SR', 'H1-75SPF', 'H1-1STDOFF', 'H1-1R', 'H1-1ACR']);
    eq('each is tagged with its row', lines.map(l => l.row), ['Row 1', 'Row 1', 'Row 1', 'Row 2', 'Row 2']);
    eq('the row also rides the memo, which is where a tab-7 line keeps it', lines[0].memo, 'Row 1');
    eq('a finished part is to-be-finished with its code', [lines[0].toBeFinished, lines[0].finishCode], [true, 'P06']);
    eq('a plated part is marked outsourced', [lines[3].finishCode, lines[3].finishOutsourced], ['EP2', true]);
    eq('a part with no finish is a stocked pick', [lines[4].toBeFinished, lines[4].finishCode], [false, undefined]);
    eq('a per-foot line carries pieces, feet per piece and billed feet, as tab 7 writes them',
        [lines[0].qty, lines[0].perFoot, lines[0].feetPer, lines[0].billedFeet], [35, true, 2, 70]);
    eq('the cut rides along', lines[0].cutLength, 18);
    eq('a part with no cut carries none', 'cutLength' in lines[1], false);
    eq('the name loses its list dash', lines[0].name, 'Pole');
    ok('no discount, net, size echo, fee, add-on or parked geometry became a line',
        !lines.some(l => /Discount|Net Line|Diameter|Bend|Rush|HIDDEN/.test(l.erp + l.name)));
    eq('an empty breakdown makes no lines', rowLinesFromBreakdown([]), []);
}

// ── GROUPING THE SALES ORDER BY THE DISPLAY'S ROWS ──────────────────────────────────────────
{
    const so = { lines: [
        { erp: 'A', row: 'Row 1' }, { erp: 'B', memo: 'row 2' }, { erp: 'C', memo: 'Left window' }, { erp: 'D' }, { erp: 'E', row: 'Row 9' },
    ] };
    const { rows, unassigned } = soRowsOf(so, ['Row 1', 'Row 2', 'Row 3']);
    eq('a written row and a typed memo both find their row', [rows['Row 1'].map(x => x.line.erp), rows['Row 2'].map(x => x.line.erp)], [['A'], ['B']]);
    eq('a row with no lines is still listed, empty', rows['Row 3'], []);
    eq('a memo naming no row, a blank line, and a row the display lacks are UNASSIGNED — never guessed into a row',
        unassigned.map(x => x.line.erp), ['C', 'D', 'E']);
    eq('the line index is kept — that is the anchor the work order will carry', unassigned.map(x => x.lineIdx), [2, 3, 4]);
}

// ── WHAT A LINE IS DOING ────────────────────────────────────────────────────────────────────
{
    const so = { id: 'SO1', lines: [
        { erp: 'H1-75SR', qty: 35, toBeFinished: true, finishCode: 'P06', row: 'Row 1' },
        { erp: 'H1-1R', qty: 35, toBeFinished: true, finishCode: 'EP2', row: 'Row 2' },
        { erp: 'H1-1ACR', qty: 35, toBeFinished: false, row: 'Row 2' },
    ], oeGen: {} };
    const none = { wos: [], pos: [], demands: [] };
    eq('a stocked line is never started from here', lineStateOf({ so, line: so.lines[2], lineIdx: 2, links: none }).key, LINE_STATE.STOCKED);
    eq('a to-be-finished line with nothing raised is NOT started', lineStateOf({ so, line: so.lines[0], lineIdx: 0, links: none }).key, LINE_STATE.NONE);
    eq('a parked work order waiting on material reads BACKORDERED, with the reason',
        (() => { const s = lineStateOf({ so, line: so.lines[0], lineIdx: 0, links: { ...none, wos: [{ id: 'WO-1', soLineIdx: 0, status: 'Approved', backOrdered: true, backOrderReason: '10 × H1-75SR short' }] } }); return [s.key, /short/.test(s.text)]; })(),
        [LINE_STATE.BACKORDER, true]);
    eq('a dispatched work order is ON THE FLOOR', lineStateOf({ so, line: so.lines[0], lineIdx: 0, links: { ...none, wos: [{ id: 'WO-1', soLineIdx: 0, status: 'Dispatched' }] } }).key, 'FLOOR');
    eq('a closed work order is DONE', lineStateOf({ so, line: so.lines[0], lineIdx: 0, links: { ...none, wos: [{ id: 'WO-1', soLineIdx: 0, status: 'Closed' }] } }).key, 'DONE');
    // The plated line, followed through the plater by the shipment's demandWoNum ↔ the stamp's ref.
    const soP = { ...so, oeGen: { 1: { kind: 'PLATING', ids: ['PLD-1'], ref: 'PLW-CE-000123' } } };
    const step = (status) => lineStateOf({ so: soP, line: soP.lines[1], lineIdx: 1, links: none, shipments: [{ demandWoNum: 'PLW-CE-000123', status }] }).key;
    eq('issued and pulled → staged', step('staged'), LINE_STATE.PLATING_STAGED);
    eq('shipped to the plater', step('shipped'), LINE_STATE.PLATING_SHIPPED);
    eq('received back', step('received'), LINE_STATE.PLATING_RECEIVED);
    eq('built back', step('built'), LINE_STATE.PLATING_BUILT);
    eq('issued but not yet pulled reads as issued', lineStateOf({ so: soP, line: soP.lines[1], lineIdx: 1, links: none }).key, LINE_STATE.PLATING);
    eq('a shipment for a DIFFERENT demand is not this line', lineStateOf({ so: soP, line: soP.lines[1], lineIdx: 1, links: none, shipments: [{ demandWoNum: 'PLW-CE-000999', status: 'built' }] }).key, LINE_STATE.PLATING);
}

// ── WHAT A ROW SAYS — the worst thing on it ─────────────────────────────────────────────────
{
    const so = { id: 'SO1', lines: [
        { erp: 'A', qty: 1, toBeFinished: true, finishCode: 'P06', row: 'Row 1' },
        { erp: 'B', qty: 1, toBeFinished: true, finishCode: 'EP2', row: 'Row 1' },
        { erp: 'C', qty: 1, toBeFinished: false, row: 'Row 1' },
    ], oeGen: {} };
    const entries = so.lines.map((line, lineIdx) => ({ line, lineIdx }));
    const none = { wos: [], pos: [], demands: [] };
    const wo = (idx, extra) => ({ id: `WO-${idx}`, soLineIdx: idx, status: 'Approved', ...extra });
    const st = (links, extra = {}) => rowStateOf({ so, entries, links, ...extra });

    eq('nothing raised → NOT STARTED, and the count of what would start', [st(none).key, st(none).open, st(none).stocked], [ROW_STATE.NOT_STARTED, 2, 1]);
    eq('one line raised, one not → PARTLY STARTED', st({ ...none, wos: [wo(0)] }).key, ROW_STATE.PARTLY_STARTED);
    eq('a line the run named for review → NEEDS A DECISION, and it outranks a backorder',
        st({ ...none, wos: [wo(0, { backOrdered: true })] }, { reviews: { 1: ['B is flagged BOTH'] } }).key, ROW_STATE.NEEDS_DECISION);
    // ⚠ A LINE NAMED FOR REVIEW IS NOT STARTED (2026-09-22: "no change"). Nothing was raised for it,
    // so it stays OPEN and the row can be run again — the rule may have changed since it was named.
    eq('…and that line still counts as open, so the row offers a Start', st(none, { reviews: { 1: ['B is flagged BOTH'] } }).open, 2);
    ok('…and the confirmation says it is being tried again', /named for a decision last time/.test(rowStartText('Row 1', st(none, { reviews: { 1: ['x'] } }))));
    eq('a backordered line → BACKORDERED', st({ ...none, wos: [wo(0, { backOrdered: true }), wo(1)] }).key, ROW_STATE.BACKORDERED);
    eq('all issued, none dispatched → ISSUED', st({ ...none, wos: [wo(0), wo(1)] }).key, ROW_STATE.ISSUED);
    eq('one on the floor → ON THE FLOOR', st({ ...none, wos: [wo(0, { status: 'Dispatched' }), wo(1)] }).key, ROW_STATE.ON_FLOOR);
    eq('a plated line issued → AT THE PLATER', st({ ...none, wos: [wo(0, { status: 'Dispatched' })], demands: [{ id: 'PLD-1', baseErpId: 'B', finishCode: 'EP2', woNum: 'PLW-1' }] }).key, ROW_STATE.AT_PLATER);
    eq('everything closed or built → DONE', st({ ...none, wos: [wo(0, { status: 'Closed' }), wo(1, { status: 'Closed' })] }).key, ROW_STATE.DONE);
    // ⚠ A row is NOT done while one of its lines still waits — the mistake that ships a board short.
    eq('one line still open keeps the row from reading done', st({ ...none, wos: [wo(0, { status: 'Closed' })] }).key, ROW_STATE.PARTLY_STARTED);
    eq('a row with no lines says so', rowStateOf({ so, entries: [], links: none }).key, ROW_STATE.EMPTY);
    eq('a row of only stocked parts has nothing to make', rowStateOf({ so, entries: [entries[2]], links: none }).key, ROW_STATE.DONE);

    const text = rowStartText('Row 1', st(none));
    ok('the start confirmation names every line it will start', /2 line\(s\) will be started/.test(text) && /1 × A in P06/.test(text));
    ok('and what it leaves alone', /left as they are/.test(text) && /C — stocked/.test(text));
}

// ── A DISPLAY ACROSS SEVERAL SALES ORDERS, ONE OF THEM ALREADY SPLIT WHOLE ──────────────────
// The tabletop: SO60551 (CPQ, RTG split it as one document, nearly built) + SO60565 (tab 7). Its
// rows are the union; the split order's lines read off its documents and are never offered a Start.
{
    const cpq = { id: 'SO-APP-1', soId: 'SO60551', lines: [{ erp: 'H1-1R', qty: 50, toBeFinished: true, finishCode: 'EP4', row: 'Top Row 1' }] };
    const oe = { id: 'SO-APP-2', soId: 'SO60565', lines: [{ erp: 'H1-75SR', qty: 50, toBeFinished: true, finishCode: 'P24', memo: 'Base Front 1' }], oeGen: {} };
    const fin = [{ id: 'WO-SO60551', currentPhase: 'Setup' }];
    const shop = [{ id: 'SHOP-SO60551', status: 'Pending' }];
    const whole = wholeOrderDocsOf(cpq, fin, shop);
    ok('the split order\'s documents are recognised by RTG\'s own ids', !!whole && whole.fin.id === 'WO-SO60551' && whole.shop.id === 'SHOP-SO60551');
    eq('an order with no such documents is not whole-order', wholeOrderDocsOf(oe, fin, shop), null);
    eq('a row\'s OWN work orders (WO-OE-…) are never mistaken for the whole-order document',
        wholeOrderDocsOf(oe, [{ id: 'WO-OE-H1-75SR-1-0' }], []), null);
    ok('the words name both documents and their state', /WO-SO60551 · Setup/.test(wholeOrderText(whole)) && /SHOP-SO60551 · Pending/.test(wholeOrderText(whole)));
    // THE RETIRE LEAVES THE DOCUMENTS IN PLACE, CLOSED FROM 10.5 (the wall, 2026-09-23: SO60585 and
    // SO60586 read whole-order again after their retire — every row DONE, nothing startable).
    const retiredFin = [{ id: 'WO-SO60585', status: 'Closed', currentPhase: 'Closed', closedFrom: '10.5' }];
    const retiredShop = [{ id: 'SHOP-SO60585', status: 'Completed', closed: true, closedFrom: '10.5' }];
    const wall = { id: 'SO-APP-3', soId: 'SO60585' };
    eq('documents the retire closed are no longer the split — the order releases by rows', wholeOrderDocsOf(wall, retiredFin, retiredShop), null);
    eq('…and the strip can name them', splitRetiredOf(wall, retiredFin, retiredShop).map(d => d.id), ['WO-SO60585', 'SHOP-SO60585']);
    ok('a whole-order document RTG closed as FINISHED still counts — a built display is never offered a Start',
        !!wholeOrderDocsOf(wall, [{ id: 'WO-SO60585', status: 'Closed', closedFrom: 'RTG', closeReason: 'FLOOR_DONE' }], [{ id: 'SHOP-SO60585', status: 'Completed' }]));
    eq('…and nothing reads as retired on it', splitRetiredOf(wall, [{ id: 'WO-SO60585', status: 'Closed', closedFrom: 'RTG' }], []), null);

    const none = { wos: [], pos: [], demands: [] };
    const entries = [
        { so: cpq, line: cpq.lines[0], lineIdx: 0, links: none, shipments: [], whole },
        { so: oe, line: oe.lines[0], lineIdx: 0, links: none, shipments: [] },
    ];
    const st = rowStateOf({ entries });
    eq('the split order\'s line is ON THE WHOLE-ORDER DOCUMENTS, not "not started"', st.lines[0].key, LINE_STATE.WHOLE);
    eq('…and the tab-7 line, with nothing raised, IS not started', st.lines[1].key, LINE_STATE.NONE);
    eq('only the tab-7 line counts as startable', st.open, 1);
    eq('each line knows which sales order it came from', st.lines.map(l => l.soId), ['SO60551', 'SO60565']);
    eq('a whole-order line whose finishing doc is Complete reads done',
        rowStateOf({ entries: [{ ...entries[0], whole: { fin: { id: 'WO-SO60551', currentPhase: 'Complete' }, shop: null } }] }).lines[0].key, LINE_STATE.DONE);
    eq('a row made only of whole-order lines has nothing to start', rowStateOf({ entries: [entries[0]] }).open, 0);
    ok('…and does not read "not started"', rowStateOf({ entries: [entries[0]] }).key !== ROW_STATE.NOT_STARTED);
}

// ── RETIRING THE WHOLE-ORDER SPLIT — only while nothing has moved ───────────────────────────
{
    const so = { id: 'SO-APP-9', soId: 'SO60585' };
    const untouched = { fin: { id: 'WO-SO60585', currentPhase: 'Setup', pickStatus: 'Pending' }, shop: { id: 'SHOP-SO60585', status: 'Pending' }, plating: [] };
    eq('untouched documents may be retired', retireBlockersOf(untouched), []);
    eq('a finishing doc past Setup blocks, and says where it is',
        retireBlockersOf({ ...untouched, fin: { ...untouched.fin, currentPhase: 'Painting' } }), ['WO-SO60585 is at Painting on the finishing floor']);
    eq('a picked doc blocks', retireBlockersOf({ ...untouched, fin: { ...untouched.fin, pickStatus: 'Picked' } }), ['WO-SO60585 has been picked (Picked)']);
    eq('a packed doc blocks', retireBlockersOf({ ...untouched, fin: { ...untouched.fin, packStatus: 'Packed' } }), ['WO-SO60585 has been packed (Packed)']);
    eq('a shop doc that is being fabricated blocks', retireBlockersOf({ ...untouched, shop: { id: 'SHOP-SO60585', status: 'In Process' } }), ['SHOP-SO60585 is In Process on the shop floor']);
    eq('parts already shipped to the plater block', retireBlockersOf({ ...untouched, plating: [{ __coll: 'plating_shipments', woNum: 'PLW-1', status: 'shipped' }] }), ['PLW-1 is shipped at the plater']);
    eq('an open demand (nothing pulled) does not block — it is cancelled instead', retireBlockersOf({ ...untouched, plating: [{ __coll: 'plating_demand', woNum: 'PLW-2', status: 'open' }] }), []);
    eq('in the pick QUEUE is not picked', retireBlockersOf({ ...untouched, fin: { ...untouched.fin, pickStatus: 'Pending', sentToPickPack: true } }), []);
    // THE PACKAGING LEG (Stuart 2026-09-23): the split writes PKG-<so> too; pending closes with the split, packed blocks.
    eq('a pending packaging doc does not block — it closes with the split', retireBlockersOf({ ...untouched, pkg: [{ id: 'PKG-SO60585', status: 'pending' }] }), []);
    eq('a packed packaging doc blocks', retireBlockersOf({ ...untouched, pkg: [{ id: 'PKG-SO60585', status: 'packed' }] }), ['PKG-SO60585 is packed at packaging']);
    eq('one already closed by a retire is neither blocker nor named again', retireBlockersOf({ ...untouched, pkg: [{ id: 'PKG-SO60585', status: 'closed', closed: true, closedFrom: '10.5' }] }), []);
    ok('the words name the packaging document', /PKG-SO60585 — the whole-order packaging document/.test(retireText(so, { ...untouched, pkg: [{ id: 'PKG-SO60585', status: 'pending' }] })));
    eq('the packaging ids follow the split\'s own convention', packagingIdsOf({ id: 'SO-APP-X', soId: 'SO60585' }), ['PKG-SO60585', 'PKG-SO-APP-X']);
    // AN ORDER RELEASED BY ROWS IS AN ORDER ENTRY ORDER (Stuart 2026-09-23): the stamp rides the one patch.
    const cpqPatch = displayAnchorPatch({ buildId: 'B1', lines: [{ erp: 'X', qty: 1 }], so: { source: 'CPQ', status: 'Dispatched' } });
    eq('a CPQ order anchored for rows gets the Order Entry class and a pending pick', [cpqPatch.orderClass, cpqPatch.pickStatus, cpqPatch.displayRelease], ['QUICKSHIP', 'Pending', true]);
    const oePatch = displayAnchorPatch({ buildId: 'B1', so: { orderClass: 'QUICKSHIP', pickStatus: 'Picked' } });
    eq('an order already picked is never set back to pending', [oePatch.orderClass, 'pickStatus' in oePatch], ['QUICKSHIP', false]);
    eq('a released order without the class needs its pack card; a stamped or unreleased one does not',
        [needsPackCard({ displayRelease: true, source: 'CRM' }), needsPackCard({ displayRelease: true, orderClass: 'QUICKSHIP' }), needsPackCard({ source: 'CPQ' })], ['class', '', '']);
    // THE PIECE COUNT (2026-09-23, "1 pcs" on the wall's cards): the sum of the lines, as tab 7 writes it.
    eq('the stamp writes the piece count from the lines', displayAnchorPatch({ buildId: 'B', lines: [{ erp: 'A', qty: 70 }, { erp: 'B', qty: 35 }] }).totalParts, 105);
    eq('…from the order\'s own lines when none are handed in', displayAnchorPatch({ buildId: 'B', so: { lines: [{ erp: 'A', qty: 3 }] } }).totalParts, 3);
    eq('…and leaves the count alone when there are no lines to sum', 'totalParts' in displayAnchorPatch({ buildId: 'B' }), false);
    eq('a stamped order whose count disagrees with its lines needs the count', needsPackCard({ displayRelease: true, orderClass: 'QUICKSHIP', totalParts: 1, lines: [{ qty: 70 }, { qty: 35 }] }), 'count');
    eq('…and nothing when it agrees', needsPackCard({ displayRelease: true, orderClass: 'QUICKSHIP', totalParts: 105, lines: [{ qty: 70 }, { qty: 35 }] }), '');
    // THE TABLETOP'S SO60551: whole-order, stamped by mistake — the class comes off; an Order Entry sale never loses it.
    const wholeDocs = { fin: { id: 'WO-SO60551' }, shop: null };
    eq('a whole-order CPQ order carrying the class is offered the removal', packCardToRemove({ source: 'CPQ', orderClass: 'QUICKSHIP' }, wholeDocs), true);
    eq('…not when it is not whole-order, nor when it was sold through Order Entry, nor without the class',
        [packCardToRemove({ source: 'CPQ', orderClass: 'QUICKSHIP' }, null), packCardToRemove({ source: 'QUICKSHIP', orderClass: 'QUICKSHIP' }, wholeDocs), packCardToRemove({ source: 'CPQ' }, wholeDocs)], [false, false, false]);
    ok('the confirmation names both documents and the demand it will cancel',
        (() => { const t = retireText(so, { ...untouched, plating: [{ __coll: 'plating_demand', woNum: 'PLW-2' }] }); return /WO-SO60585/.test(t) && /SHOP-SO60585/.test(t) && /CANCELS 1 open plating demand/.test(t) && /stays open/.test(t); })());
}

// ── THE ANCHOR ──────────────────────────────────────────────────────────────────────────────
eq('the anchor patch stands the auto-engines down, lets rows release alone, and makes the order an Order Entry order',
    displayAnchorPatch({ buildId: 'BUILD-1' }), { displayRelease: true, displayBuildId: 'BUILD-1', finishAsAvailable: true, orderClass: 'QUICKSHIP', pickStatus: 'Pending' });
eq('…and writes lines only when handed some', Object.keys(displayAnchorPatch({ buildId: 'B', lines: [] })).includes('lines'), true);
eq('a CPQ order with no lines needs them written', soNeedsLines({ hqJobId: 'J' }), true);
eq('an Order Entry order already has them', soNeedsLines({ lines: [{ erp: 'A' }] }), false);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
