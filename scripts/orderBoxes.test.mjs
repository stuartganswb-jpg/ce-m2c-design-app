// 🧪 Numbered boxes — an order's boxes, which box each packed piece is in, the split (Stuart 2026-10-06).
//    node scripts/orderBoxes.test.mjs
import { orderBoxesOf, nextBoxNoOf, withNewBox, newBoxRefusal, boxOf, boxName, tickBoxesOf, tickQtyOf, unboxedQtyOf, tickIntoBox, moveIntoBox,
    boxSpreadOf, boxSpreadLabel, boxContentsOf, boxRemovalRefusal, unboxedLinesOf, boxCompleteBlocker, packBoxesOfTicks, docBoxLinesOf, boxSlotOf } from '../src/components/Shared/orderBoxes.js';
import { soPackBoardOf } from '../src/components/Shared/soPackBoard.js';
import { packLinesOf } from '../src/components/Shared/pickLines.js';
import { packedQtyOf, packingListOf } from '../src/components/Shared/packingList.js';
import { packagesFromPack } from '../src/components/Shared/fulfilment.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

// ── the order's boxes ───────────────────────────────────────────────────────────────────────────────────────
eq('an order with none', [orderBoxesOf(null), orderBoxesOf({}), nextBoxNoOf([])], [[], [], 1]);
let { no, list } = withNewBox([], { type: 'Small Box A', by: 'Sandra', now: 10 });
eq('the first box is Box 1', [no, list], [1, [{ no: 1, type: 'Small Box A', by: 'Sandra', at: 10 }]]);
({ no, list } = withNewBox(list, { type: 'Tube 10ft', by: 'Ana', now: 20 }));
({ no, list } = withNewBox(list, { type: 'Small Box A', by: 'Ana', now: 30 }));
eq('numbers run on — Box 3', [no, list.map(b => b.no)], [3, [1, 2, 3]]);
eq('read back in number order, whatever order it was stored in', orderBoxesOf({ orderBoxes: [list[2], list[0], null, { no: 0, type: 'x' }, list[1]] }).map(b => `${b.no}:${b.type}`), ['1:Small Box A', '2:Tube 10ft', '3:Small Box A']);
eq('a box needs a type', [!!newBoxRefusal({ type: '' }), !!newBoxRefusal({}), newBoxRefusal({ type: 'Tube' })], [true, true, '']);
eq('its name', [boxName(boxOf(list, 2)), boxName({ no: 4, type: '' }), boxName(null)], ['Box 2 · Tube 10ft', 'Box 4', '']);

// ── a packed line says which box ────────────────────────────────────────────────────────────────────────────
const ring = { key: 'L0', erp: 'HCUSR1', name: 'Ring', qty: 14 };
let tick = tickIntoBox(ring, 1, { by: 'Sandra', at: 5 });
eq('packed into the open box, whole', tick, { at: 5, by: 'Sandra', qty: 14, boxes: [{ no: 1, qty: 14 }] });
eq('the count stays where the packing list reads it', [packedQtyOf({ packedLines: { L0: tick } }, ring), tickQtyOf(tick, ring), unboxedQtyOf(tick, ring)], [14, 14, 0]);
eq('a tick from before box numbers: packed, in no box', [tickBoxesOf({ at: 1, by: 'A', qty: 14 }), unboxedQtyOf({ at: 1, by: 'A', qty: 14 }, ring), unboxedQtyOf({ at: 1, by: 'A' }, ring)], [[], 14, 14]);
eq('no box open → the tick carries none (stock put-away, gather)', tickIntoBox(ring, null, { by: 'A', at: 1 }), { at: 1, by: 'A', qty: 14 });

// ── the split ───────────────────────────────────────────────────────────────────────────────────────────────
let r = moveIntoBox(tick, ring, 2, 6);
eq('6 of the 14 into Box 2', [r.ok, r.boxes], [true, [{ no: 1, qty: 8 }, { no: 2, qty: 6 }]]);
const split = { ...tick, boxes: r.boxes };
eq('…the count is unchanged', [tickQtyOf(split, ring), unboxedQtyOf(split, ring), packedQtyOf({ packedLines: { L0: split } }, ring)], [14, 0, 14]);
r = moveIntoBox(split, ring, 3, 10);
eq('10 into Box 3 come out of the fullest box first', r.boxes, [{ no: 2, qty: 4 }, { no: 3, qty: 10 }]);
eq('the whole line moved to another box', moveIntoBox(tick, ring, 2, 14).boxes, [{ no: 2, qty: 14 }]);
eq('back together', moveIntoBox(split, ring, 1, 6).boxes, [{ no: 1, qty: 14 }]);
eq('refused: more than there is to move', [moveIntoBox(split, ring, 2, 9).ok, moveIntoBox(split, ring, 2, 9).movable], [false, 8]);
eq('refused: zero, a fraction, no box, not packed, already all there', [moveIntoBox(split, ring, 2, 0).ok, moveIntoBox(split, ring, 2, 1.5).ok, moveIntoBox(split, ring, null, 1).ok, moveIntoBox(null, ring, 2, 1).ok, moveIntoBox(tick, ring, 1, 1).ok], [false, false, false, false, false]);
const old = { at: 1, by: 'A', qty: 14 };
eq('a tick from before box numbers goes into a box — all of it', moveIntoBox(old, ring, 1, 14).boxes, [{ no: 1, qty: 14 }]);
eq('…or part of it, the rest still in no box', [moveIntoBox(old, ring, 1, 5).boxes, unboxedQtyOf({ ...old, boxes: moveIntoBox(old, ring, 1, 5).boxes }, ring)], [[{ no: 1, qty: 5 }], 9]);
const half = { ...old, boxes: [{ no: 1, qty: 5 }] };
eq('pieces in no box go first, then the other boxes', moveIntoBox(half, ring, 2, 11).boxes, [{ no: 1, qty: 3 }, { no: 2, qty: 11 }]);

// ── what the screens say ────────────────────────────────────────────────────────────────────────────────────
eq('all in one box: its number and type', boxSpreadLabel(boxSpreadOf([tick]), list), 'Box 1 · Small Box A');
eq('split: each box and its count', boxSpreadLabel(boxSpreadOf([split]), list), 'Box 1 ×8 · Box 2 ×6');
eq('one part on several lines: the boxes added up', boxSpreadOf([split, tickIntoBox({ qty: 5 }, 2, {})]), [{ no: 1, qty: 8 }, { no: 2, qty: 11 }]);
eq('in no box → nothing to say', [boxSpreadLabel(boxSpreadOf([old]), list), boxSpreadLabel([], list)], ['', '']);

// ── an order across two documents: SO60831 ──────────────────────────────────────────────────────────────────
const POLES = [{ code: 'H1-138WR-O', name: 'Wood Rod', qty: 2, length: 144, unit: 'in', riders: [{ code: 'FEE-H1-MR', name: 'Miter', qty: 1 }] }];
const ep5 = { id: 'EP5', pickOnly: true, currentPhase: 'Complete', pickStatus: 'Picked_Awaiting_Staging', sentToPickPack: true,
    partsList: [{ legacyErpId: 'H1-138BPR/EP5', partName: 'Passing Ring', qty: 48 }, { legacyErpId: 'H1-138CP-V/EP5', partName: 'Cover Plate', qty: 1 }, { legacyErpId: 'H1-138CP-V/EP5', partName: 'Cover Plate', qty: 1 }] };
const s11 = { id: 'S11', hasCustomSibling: true, customFabStatus: 'Complete', currentPhase: 'Complete', totalPoles: 2, pickStatus: 'Staged_Ready_For_Finishing', sentToPickPack: true, poleLines: POLES,
    partsList: [{ legacyErpId: 'H1-138WGF-O', partName: 'Finial', qty: 2 }] };
const linesOf = (d) => packLinesOf(d).map(l => ({ ...l, cat: l.isPole ? 'POLE' : 'SMALL' }));
const boxes = list;   // Box 1 Small Box A · Box 2 Tube 10ft · Box 3 Small Box A
const T = (line, n) => tickIntoBox(line, n, { by: 'Sandra', at: 9 });
const ep5L = linesOf(ep5), s11L = linesOf(s11);
const ep5P = { ...ep5, packedLines: { L0: { ...T(ep5L[0], 1), boxes: [{ no: 1, qty: 30 }, { no: 3, qty: 18 }] }, L1: T(ep5L[1], 1), L2: T(ep5L[2], 3) } };
const pole = s11L.find(l => l.isPole && !l.rider), rider = s11L.find(l => l.rider);
const s11P = { ...s11, packedLines: { L0: T(s11L[0], 1), [pole.key]: T(pole, 2), [rider.key]: { at: 9, by: 'Sandra', qty: 1, withPole: pole.key } } };

const contents = boxContentsOf({ docs: [ep5P, s11P], linesOf });
eq('what is in each box, across both documents — a rider is not a piece', Object.entries(contents).map(([n, b]) => `${n}: ${b.pcs} — ${b.items.map(i => `${i.code}×${i.qty}`).join(', ')}`),
    ['1: 33 — H1-138BPR/EP5×30, H1-138CP-V/EP5×1, H1-138WGF-O×2', '2: 2 — H1-138WR-O×2', '3: 19 — H1-138BPR/EP5×18, H1-138CP-V/EP5×1']);
eq('the document says which boxes it went in', docBoxLinesOf(ep5P, ep5L, boxes), ['Box 1 · Small Box A — 31 pcs', 'Box 3 · Small Box A — 19 pcs']);
eq('…and the box types as Fulfilment reads them: the first box each half went in', [packBoxesOfTicks(ep5P, ep5L, boxes), packBoxesOfTicks(s11P, s11L, boxes)], [{ SMALL: 'Small Box A', POLE: '' }, { SMALL: 'Small Box A', POLE: 'Tube 10ft' }]);
eq('…which seeds the same packages it always did', packagesFromPack(packBoxesOfTicks(s11P, s11L, boxes), []).map(p => `${p.slot}:${p.boxName}`), ['SMALL:Small Box A', 'POLE:Tube 10ft']);
eq('everything boxed → nothing blocks the completion', [boxCompleteBlocker(ep5P, ep5L), boxCompleteBlocker(s11P, s11L), unboxedLinesOf(s11P, s11L).length], ['', '', 0]);
const legacy = { ...ep5, packedLines: { L0: { at: 1, by: 'A', qty: 48 }, L1: T(ep5L[1], 1) } };
ok('a line ticked before box numbers blocks the completion, by name', /1 packed line is not in a box yet \(H1-138BPR\/EP5\)/.test(boxCompleteBlocker(legacy, ep5L)));
eq('a line not packed is not this rule\'s business', boxCompleteBlocker(ep5, ep5L), '');

// removing a box
eq('a box with pieces in it stays', /19 piece/.test(boxRemovalRefusal(boxes, 3, contents)), true);
const four = withNewBox(boxes, { type: 'Tube 8ft' }).list;
eq('the last box, empty, may go', boxRemovalRefusal(four, 4, contents), '');
ok('an empty box in the middle stays — no gaps', /Only the last box \(Box 4\)/.test(boxRemovalRefusal(four, 2, {})));
ok('a box that is not there', /no Box 9/.test(boxRemovalRefusal(four, 9, {})));

// ── SO Pack reads the box numbers ───────────────────────────────────────────────────────────────────────────
const closeOut = (d, lines) => ({ ...d, packStatus: 'Packed', packedAt: 9, packedBy: 'Sandra', packBoxes: packBoxesOfTicks(d, lines, boxes) });
const board = soPackBoardOf({ docs: [closeOut(ep5P, ep5L), s11P], linesOf, refOf: (d) => d.id, boxes });
eq('each part with its box — a split line and a part on two lines say every box', board.rows.map(r => `${r.code} ${r.packed}/${r.ordered} ${r.box}`),
    ['H1-138BPR/EP5 48/48 Box 1 ×30 · Box 3 ×18', 'H1-138CP-V/EP5 2/2 Box 1 ×1 · Box 3 ×1', 'H1-138WGF-O 2/2 Box 1 · Small Box A', 'H1-138WR-O 2/2 Box 2 · Tube 10ft']);
ok('a line ticked on a document still OPEN already has its box', board.rows[2].box === 'Box 1 · Small Box A' && board.rows[2].stamps[0].detail === 'packing still open');
const before = { ...ep5, packStatus: 'Packed', packBoxes: { SMALL: 'Small Box A' }, packedLines: { L0: { at: 1, by: 'A', qty: 48 }, L1: { at: 1, by: 'A', qty: 1 }, L2: { at: 1, by: 'A', qty: 1 } } };
eq('a document packed BEFORE box numbers still shows the box type it recorded', soPackBoardOf({ docs: [before], linesOf, refOf: (d) => d.id, boxes: [] }).rows.map(r => r.box), ['Small Box A', 'Small Box A']);

// the packing list — ordered beside packed — is untouched by any of it
const pl = packingListOf({ ordered: [{ erp: 'H1-138BPR/EP5', name: 'Passing Ring', qty: 48 }, { erp: 'H1-138CP-V/EP5', name: 'Cover Plate', qty: 2 }], packDocs: [ep5P] });
eq('the packing list reads the same counts, split or not', pl.lines.map(l => `${l.code} ${l.qtyShipped}/${l.qtyOrdered} ${l.status}`), ['H1-138BPR/EP5 48/48 MATCH', 'H1-138CP-V/EP5 2/2 MATCH']);
eq('box slot: the bench category wins, else the pole flag', [boxSlotOf({ cat: 'POLE' }), boxSlotOf({ cat: 'RING', isPole: false }), boxSlotOf({ isPole: true }), boxSlotOf(null)], ['POLE', 'SMALL', 'POLE', 'SMALL']);

console.log(`orderBoxes: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
