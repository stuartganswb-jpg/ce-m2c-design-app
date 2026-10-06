// 🧪 SO Pack, line by line — ordered beside packed, the box, and the stamps that are about that line (Stuart 2026-10-06).
//    node scripts/soPackBoard.test.mjs
import { soPackBoardOf, lineStampsOf, lineBoxOf, boxSlotOf, LINE_STATE, ORDER_VERDICT } from '../src/components/Shared/soPackBoard.js';
import { packLinesOf } from '../src/components/Shared/pickLines.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// ── SO60831 as the screenshot showed it: three documents, nothing packed ────────────────────────────────────
const POLES = { S11: [{ code: 'H1-138P8', name: 'Rod 1-3/8', qty: 2, length: 96, unit: 'in', riders: [{ code: 'FEE-H1-MR', name: 'Mitered return', qty: 2 }] }], UNF: [{ code: 'H1-138T8', name: 'Track', qty: 1, length: 84, unit: 'in' }] };
const ep5 = { id: 'EP5', pickOnly: true, currentPhase: 'Complete', sentToPickPack: true, pickStatus: 'Pending', salesOrderId: 'SO60831',
    partsList: [{ legacyErpId: 'H1-138RG/EP5', partName: 'Ring', qty: 14 }] };
const s11 = { id: 'S11', hasCustomSibling: true, customFabStatus: 'Complete', currentPhase: 'Setup', totalPoles: 2, sentToPickPack: true, pickStatus: 'Pending', salesOrderId: 'SO60831',
    partsList: [{ legacyErpId: 'H1-138BR', partName: 'Bracket', qty: 4 }, { legacyErpId: 'H1-138FN', partName: 'Finial', quantity: 2 }, { legacyErpId: 'FEE-H1-SPL', partName: 'Splice fee', qty: 1, isFee: true }] };
const unf = { id: 'UNF', hasCustomSibling: true, customFabStatus: 'Complete', pickOnly: true, currentPhase: 'Complete', sentToPickPack: true, pickStatus: 'Pending', salesOrderId: 'SO60831',
    partsList: [{ legacyErpId: 'H1-CARRIER', partName: 'Carrier', qty: 20 }] };
const linesOf = (d) => packLinesOf(d, { poleRows: POLES[d.id] || null });
const refOf = (d) => `WO-SO60831-${d.id}`;
const board = (docs) => soPackBoardOf({ docs, linesOf, refOf });
const stampsOf = (r) => r.stamps.map(s => `${s.key}:${s.stage}`);
const row = (b, code) => b.rows.find(r => r.code === code);

let b = board([ep5, s11, unf]);
eq('every part of the order is a row — fees and riders are not', b.rows.map(r => `${r.ref.slice(-3)} ${r.code} ${r.ordered}`),
    ['EP5 H1-138RG/EP5 14', 'S11 H1-138BR 4', 'S11 H1-138FN 2', 'S11 H1-138P8 2', 'UNF H1-CARRIER 20', 'UNF H1-138T8 1']);
eq('ordered beside packed, by piece', b.pieces, { ordered: 43, packed: 0, ready: 0, waiting: 43 });
eq('nothing packed, pulls still open → the order is WAITING', b.verdict, ORDER_VERDICT.WAITING);
eq('a small part carries the small-parts stream and the warehouse pick', stampsOf(row(b, 'H1-138BR')), ['PARTS:SETUP', 'FULFIL:PICKING']);
eq('a pole carries the custom shop and the POLE stream — never the pick', stampsOf(row(b, 'H1-138P8')), ['CUSTOM:FINISHED', 'POLES:SETUP']);
eq('a pick-only part: no finishing, in the pick queue', stampsOf(row(b, 'H1-138RG/EP5')), ['PARTS:NONE', 'FULFIL:PICKING']);
eq('a pole on a pick-only document: the shop, and "no finishing"', stampsOf(row(b, 'H1-138T8')), ['CUSTOM:FINISHED', 'PARTS:NONE']);
ok('a pole reads as a pole, with its length in its name', row(b, 'H1-138P8').isPole && /96/.test(row(b, 'H1-138P8').name));
eq('no box before anything is packed', b.rows.map(r => r.box).join(''), '');

// ── the plated pick is done and that document packs first ───────────────────────────────────────────────────
const ep5Picked = { ...ep5, pickStatus: 'Picked_Awaiting_Staging' };
b = board([ep5Picked, s11, unf]);
eq('picked and finished with → READY to pack', row(b, 'H1-138RG/EP5').state, LINE_STATE.READY);
eq('…the rest still coming', b.pieces, { ordered: 43, packed: 0, ready: 14, waiting: 29 });
eq('one document ready, two not → still WAITING', b.verdict, ORDER_VERDICT.WAITING);

const ep5Ticked = { ...ep5Picked, packedLines: { L0: { at: 1000, by: 'Sandra', qty: 14 } } };
b = board([ep5Ticked, s11, unf]);
eq('ticked on a document still open: packed, no box on record yet', [row(b, 'H1-138RG/EP5').state, row(b, 'H1-138RG/EP5').packed, row(b, 'H1-138RG/EP5').box, row(b, 'H1-138RG/EP5').packedBy], [LINE_STATE.PACKED, 14, '', 'Sandra']);
eq('…and its stamp says so', row(b, 'H1-138RG/EP5').stamps.map(s => `${s.stage}:${s.detail}`), ['PACKED:packing still open']);

const ep5Packed = { ...ep5Ticked, packStatus: 'Packed', packedAt: 2000, packedBy: 'Sandra', packBoxes: { SMALL: 'Small Box A', POLE: '' } };
b = board([ep5Packed, s11, unf]);
eq('packing completed: the box it went in', [row(b, 'H1-138RG/EP5').box, stampsOf(row(b, 'H1-138RG/EP5'))], ['Small Box A', ['FULFIL:PACKED']]);
eq('14 of 43 packed', [b.pieces.packed, b.pieces.ordered, b.lines.packed, b.lines.all], [14, 43, 1, 6]);

// ── the pole is at the plater while its small parts are finished ────────────────────────────────────────────
const s11Plating = { ...s11, customFabStatus: 'Sent to Plating', customFabAt: 1, currentPhase: 'Complete', pickStatus: 'Staged_Ready_For_Finishing', stagedAt: 5 };
b = board([s11Plating]);
eq('the pole says where it is — at the plater, and nothing else', stampsOf(row(b, 'H1-138P8')), ['CUSTOM:PLATING']);
eq('…a pole still being fabricated: the shop alone', stampsOf(row(board([{ ...s11, customFabStatus: 'In Process' }]), 'H1-138P8')), ['CUSTOM:SHOP']);
eq('its small parts are finished — but the document does not pack until the pole is back', [row(b, 'H1-138BR').state, stampsOf(row(b, 'H1-138BR'))], [LINE_STATE.WAITING, ['PARTS:FINISHED', 'FULFIL:STAGED']]);

// ── every document packed → ready to ship ───────────────────────────────────────────────────────────────────
const tickAll = (d, boxes) => ({ ...d, currentPhase: 'Complete', pickStatus: 'Staged_Ready_For_Finishing', packStatus: 'Packed', packedAt: 9, packedBy: 'Sandra', packBoxes: boxes,
    poleLines: POLES[d.id] || undefined, packedLines: Object.fromEntries(linesOf(d).map(l => [l.key, { at: 9, by: 'Sandra', qty: l.qty }])) });
b = board([ep5Packed, tickAll(s11, { SMALL: 'Small Box A', POLE: 'Tube 10ft' }), tickAll(unf, { SMALL: 'Small Box B', POLE: 'Tube 8ft' })]);
eq('ALL PACKED', [b.verdict, b.pieces], [ORDER_VERDICT.ALL_PACKED, { ordered: 43, packed: 43, ready: 0, waiting: 0 }]);
eq('small parts in the small box, poles in the pole box', b.rows.map(r => `${r.code}=${r.box}`),
    ['H1-138RG/EP5=Small Box A', 'H1-138BR=Small Box A', 'H1-138FN=Small Box A', 'H1-138P8=Tube 10ft', 'H1-CARRIER=Small Box B', 'H1-138T8=Tube 8ft']);

// every line ticked but a document not completed: NOT "ready to ship"
const s11Open = { ...tickAll(s11, null), packStatus: undefined, packBoxes: undefined };
b = board([ep5Packed, s11Open]);
eq('every line ticked, one document still open → READY (to complete), not ALL PACKED', [b.verdict, b.pieces.packed, b.pieces.ordered], [ORDER_VERDICT.READY, 22, 22]);

// ── the edges ───────────────────────────────────────────────────────────────────────────────────────────────
const closedDoc = { id: 'OLD', currentPhase: 'Closed', closedAt: 3, partsList: [{ legacyErpId: 'H1-OLD', partName: 'Old', qty: 9 }] };
b = board([ep5Packed, closedDoc]);
eq('a closed document is shown, and is not part of what ships', [row(b, 'H1-OLD').state, stampsOf(row(b, 'H1-OLD')), b.pieces.ordered, b.verdict], [LINE_STATE.CLOSED, ['ORDER:CLOSED'], 14, ORDER_VERDICT.ALL_PACKED]);
const bare = { id: 'BARE', currentPhase: 'Setup', sentToPickPack: true, pickStatus: 'Pending' };
b = board([bare]);
eq('a document with no line detail is never hidden — it shows with all its stamps', [b.rows.length, b.rows[0].noLines, stampsOf(b.rows[0]), b.verdict], [1, true, ['PARTS:SETUP', 'FULFIL:PICKING'], ORDER_VERDICT.WAITING]);
eq('no documents → nothing to say', board([]).verdict, ORDER_VERDICT.NONE);
const short = { ...ep5Picked, packedLines: { L0: { at: 1, by: 'A', qty: 10 } } };
eq('a short count reads PART — 10 of 14', [row(board([short]), 'H1-138RG/EP5').state, board([short]).pieces], [LINE_STATE.PART, { ordered: 14, packed: 10, ready: 4, waiting: 0 }]);

// ── one row per part: SO60932 (Brimar) lists the same item once per window ──────────────────────────────────
const brimar = { id: 'WO-SO60932', hasCustomSibling: true, customFabStatus: 'Complete', currentPhase: 'Setup', totalPoles: 5, sentToPickPack: true, pickStatus: 'Picked_Awaiting_Staging',
    partsList: [{ legacyErpId: 'HCUDEC1', partName: 'Domed End Cap', qty: 5 }, { legacyErpId: 'HCUDEC1', partName: 'Domed End Cap', qty: 5 }, { legacyErpId: 'HCUMB410', partName: 'Bracket', qty: 5 },
        { legacyErpId: 'HCUSR1', partName: 'Ring', qty: 36, quantity: 36 }, { legacyErpId: 'HCUDEC1', partName: 'Domed End Cap', qty: 2, quantity: 2 }] };
const bLines = (d) => packLinesOf(d, { poleRows: [{ code: 'HBR1-1INPOLE', name: '1" Round Rod', qty: 5, length: 48, unit: 'in' }] });
let bb = soPackBoardOf({ docs: [brimar], linesOf: bLines, refOf: (d) => d.id });
eq('the same item on three lines is ONE row — 12 end caps', bb.rows.map(r => `${r.code} ${r.ordered}`), ['HCUDEC1 12', 'HCUMB410 5', 'HCUSR1 36', 'HBR1-1INPOLE 5']);
eq('…and it remembers the lines it stands for', bb.rows[0].keys, ['L0', 'L1', 'L4']);
eq('picked, on the floor: small parts in the setup queue + picked; the pole in the pole queue', [stampsOf(bb.rows[0]), stampsOf(bb.rows[3])], [['PARTS:SETUP', 'FULFIL:PICKED'], ['CUSTOM:FINISHED', 'POLES:SETUP']]);
const brimarPart = { ...brimar, currentPhase: 'Complete', pickStatus: 'Staged_Ready_For_Finishing', packedLines: { L0: { at: 5, by: 'Ana', qty: 5 }, L1: { at: 7, by: 'Sandra', qty: 5 } } };
bb = soPackBoardOf({ docs: [brimarPart], linesOf: bLines, refOf: (d) => d.id });
eq('two of its three lines ticked → 10 of 12, PART, and the stamps of the line still to pack', [bb.rows[0].packed, bb.rows[0].ordered, bb.rows[0].state, bb.rows[0].packedBy, stampsOf(bb.rows[0])], [10, 12, LINE_STATE.PART, 'Sandra', ['PARTS:FINISHED', 'FULFIL:STAGED']]);
eq('pieces: 10 packed, the rest ready — the 2 end caps left included', bb.pieces, { ordered: 58, packed: 10, ready: 48, waiting: 0 });

// the box slot follows the bench's own grouping when it is given
eq('box slot: the bench category wins, else the pole flag', [boxSlotOf({ cat: 'POLE' }), boxSlotOf({ cat: 'RING', isPole: false }), boxSlotOf({ isPole: true }), boxSlotOf({}), boxSlotOf(null)], ['POLE', 'SMALL', 'POLE', 'SMALL', 'SMALL']);
eq('a stocked pole on the parts list (bench category POLE) is in the pole box', lineBoxOf({ packBoxes: { SMALL: 'S', POLE: 'T' } }, { cat: 'POLE', isPole: false }, 1), 'T');
eq('no box without a packed piece or a record', [lineBoxOf({ packBoxes: { SMALL: 'S' } }, { key: 'L0' }, 0), lineBoxOf({}, { key: 'L0' }, 2), lineBoxOf(null, null, 2)], ['', '', '']);
eq('stamps of nothing', lineStampsOf(null, null), []);

// An Order Entry sales order is its own pack document: the same two readers serve its card.
const oe = { id: 'SO1', orderClass: 'QUICKSHIP', lines: [{ erp: 'A/BS', name: 'Ring', qty: 6 }, { erp: 'FEE-X', name: 'Fee', qty: 1, isFee: true }, { erp: 'B/P', name: 'Bracket', qty: 2 }],
    packedLines: { L0: { at: 1, by: 'A', qty: 6 } }, packStatus: 'Packed', packBoxes: { SMALL: 'Small Box A' } };
const oeBoard = soPackBoardOf({ docs: [oe], linesOf: (d) => packLinesOf(d), refOf: () => 'SO 1' });
eq('an Order Entry order, by its own lines (keys stay the sold line numbers)', oeBoard.rows.map(r => `${r.key} ${r.code} ${r.packed}/${r.ordered} ${r.box}`), ['L0 A/BS 6/6 Small Box A', 'L2 B/P 0/2 ']);

console.log(`soPackBoard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
