// The NetSuite item receipt is addressed by PO line (Eric, App Imp 2026-09-17 — PO2205).   node scripts/poReceiptLines.test.mjs
import { poLinesSql, nsPoLinesOf, matchPoLines, itemReceiptItemsOf, receiptShortfallOf, receiptRefusalText } from '../src/components/Shared/poReceiptLines.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the query ───────────────────────────────────────────────────────────────────────────────
ok('sql names the PO by internal id', poLinesSql('48211').includes('tl.transaction = 48211'));
let threw = false; try { poLinesSql("1; DROP"); } catch (e) { threw = true; }
ok('sql refuses anything that is not an id', threw);

// ── rows → lines ────────────────────────────────────────────────────────────────────────────
const rows = [
    { line: 1, item_internal: 900, itemid: 'chip-a', ordered: 30000, done: 0, isclosed: 'F' },
    { line: 2, item_internal: 901, itemid: 'CHIP-B', ordered: 1000, done: 0, isclosed: 'F' },
    { line: 3, item_internal: 902, itemid: 'CHIP-C', ordered: 50, done: 50, isclosed: 'F' },
    { line: 4, item_internal: 900, itemid: 'CHIP-A', ordered: 500, done: 0, isclosed: 'F' },
    { line: 5, item_internal: 903, itemid: 'CHIP-D', ordered: 10, done: 0, isclosed: 'T' },
];
const ns = nsPoLinesOf(rows);
eq('rows normalised', ns[0], { lineId: '1', nsItemId: '900', itemId: 'CHIP-A', ordered: 30000, done: 0, closed: false });
ok('closed flag read', ns[4].closed === true);

// ── matching ────────────────────────────────────────────────────────────────────────────────
const imported = [
    { itemId: 'CHIP-A', nsItemId: '900', nsLineId: '1', quantity: 30000, received: 28600, receivedBin: 'M E5L-N19-R1' },
    { itemId: 'CHIP-B', nsItemId: '901', nsLineId: '2', quantity: 1000, received: 720, receivedBin: 'm e5l-n19-r1' },
    { itemId: 'CHIP-C', nsItemId: '902', nsLineId: '3', quantity: 50, received: 50 },
    { itemId: 'CHIP-A', nsItemId: '900', nsLineId: '4', quantity: 500, received: 0 },
];
let m = matchPoLines(imported, ns);
eq('stored line ids win', [m[0].lineId, m[1].lineId, m[3].lineId], ['1', '2', '4']);
// an app-raised PO never stored a line id: same code twice → nth to nth
const appRaised = [
    { itemId: 'CHIP-A', nsItemId: '900', quantity: 30000 },
    { itemId: 'chip-b', quantity: 1000 },                       // no internal id either — the code matches
    { itemId: 'CHIP-A', nsItemId: '900', quantity: 500 },
];
m = matchPoLines(appRaised, ns);
eq('same code twice: first to first, second to second', [m[0].lineId, m[2].lineId], ['1', '4']);
ok('matches by code when there is no internal id', m[1].lineId === '2');
ok('a NetSuite line is never given twice', new Set(Object.values(m).map(x => x.lineId)).size === 3);
ok('an item NetSuite does not carry is unmatched', matchPoLines([{ itemId: 'NOPE' }], ns)[0] === undefined);

// ── the receipt ─────────────────────────────────────────────────────────────────────────────
let r = itemReceiptItemsOf({ poItems: imported, nsLines: ns, applied: [{ index: 0, itemId: 'CHIP-A', qty: 28600 }], bin: 'M E5L-N19-R1' });
ok('builds', r.ok);
eq('every OPEN line is listed — 1, 2, 4 (3 is done, 5 is closed)', r.items.map(i => i.orderLine), [1, 2, 4]);
eq('the arrived line is received by orderLine, with qty and bin', r.items[0], { orderLine: 1, itemReceive: true, quantity: 28600, inventoryDetail: { quantity: 28600, inventoryAssignment: { items: [{ binNumber: { refName: 'M E5L-N19-R1' }, quantity: 28600 }] } } });
eq('a line that did not arrive says so — never received by silence', r.items[1], { orderLine: 2, itemReceive: false });
ok('no line carries an item id (that is what NetSuite refused)', r.items.every(i => !('item' in i)));
// per-line bins (the catch-up posts each line into the bin it was put away in)
r = itemReceiptItemsOf({ poItems: imported, nsLines: ns, applied: [{ index: 0, itemId: 'CHIP-A', qty: 10, bin: 'A1' }, { index: 1, itemId: 'CHIP-B', qty: 5, bin: 'b2' }] });
eq('each line lands in its own bin', [r.items[0].inventoryDetail.inventoryAssignment.items[0].binNumber.refName, r.items[1].inventoryDetail.inventoryAssignment.items[0].binNumber.refName], ['A1', 'B2']);
// refusals
r = itemReceiptItemsOf({ poItems: [{ itemId: 'NOPE' }], nsLines: ns, applied: [{ index: 0, itemId: 'NOPE', qty: 3 }], bin: 'A1' });
ok('an unmatched line refuses the whole receipt', !r.ok && r.reason === 'LINE_NOT_ON_NETSUITE_PO' && r.lines[0].itemId === 'NOPE');
ok('…and the words name it', receiptRefusalText(r).includes('3 × NOPE'));
r = itemReceiptItemsOf({ poItems: imported, nsLines: ns, applied: [{ index: 2, itemId: 'CHIP-C', qty: 2 }], bin: 'A1' });
ok('an overage on a line NetSuite holds fully received refuses', !r.ok && r.reason === 'LINE_CLOSED_IN_NETSUITE');
ok('no rows read → refuse', itemReceiptItemsOf({ poItems: imported, nsLines: [], applied: [{ index: 0, qty: 1 }] }).reason === 'NO_LINES_READ');
ok('nothing to receive → refuse', itemReceiptItemsOf({ poItems: imported, nsLines: ns, applied: [{ index: 0, qty: 0 }] }).reason === 'NOTHING_TO_RECEIVE');
ok('an ok result has no refusal words', receiptRefusalText({ ok: true }) === '');

// ── the catch-up: PO2205 as it stands today ─────────────────────────────────────────────────
const gap = receiptShortfallOf(imported, ns);
eq('NetSuite is behind on the two chip lines, by what the app received', gap.map(g => [g.itemId, g.qty, g.bin]), [['CHIP-A', 28600, 'M E5L-N19-R1'], ['CHIP-B', 720, 'M E5L-N19-R1']]);
const fix = itemReceiptItemsOf({ poItems: imported, nsLines: ns, applied: gap });
eq('the catch-up receipt receives exactly those', fix.items.map(i => [i.orderLine, i.itemReceive, i.quantity || 0]), [[1, true, 28600], [2, true, 720], [4, false, 0]]);
const after = nsPoLinesOf(rows.map(x => x.line === 1 ? { ...x, done: 28600 } : x.line === 2 ? { ...x, done: 720 } : x));
ok('once NetSuite has them the shortfall is empty', receiptShortfallOf(imported, after).length === 0);
ok('NetSuite ahead of the app is not a shortfall', receiptShortfallOf([{ itemId: 'CHIP-C', nsLineId: '3', received: 10 }], ns).length === 0);

console.log(`poReceiptLines: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
