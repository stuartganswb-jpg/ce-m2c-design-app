// 12.7 Launch, pinned (S7, 2026-10-20): every line one kind; a mixed order (pillows + shelf) holds its shelf lines by
// default; ship ahead releases them; a hand decision wins; Classical's finish + stock order is NOT held; the pick-side
// question; the board's rows and suggestions.
import { launchLineKindOf, launchIsMixed, launchLineStateOf, lineIsLaunchHeld, launchOrderOf, launchPatchOf, shipAheadPatchOf, holdAllPatchOf, launchRowsOf, SUGGESTION_WORDS } from '../src/components/Shared/launchBoard.js';

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

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
