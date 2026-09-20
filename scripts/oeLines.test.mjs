// node scripts/oeLines.test.mjs — which Order Entry lines are covered, and which plans may run with
// nobody looking (Stuart 2026-09-20: to-be-finished orders start from RTG by themselves).
import { oeIsTbf, oeLineFinish, oeCoverageOf, uncoveredTbfOf, oeAutoSig, autoRunnable, oeLineStateOf, oeJobBlocked } from '../src/components/Shared/oeLines.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const tbf = (erp, fin, qty, more = {}) => ({ erp, qty, toBeFinished: true, finishCode: fin, ...more });
const so = { id: 'QS-1', lines: [{ erp: 'STOCKED-1', qty: 4 }, tbf('H1-SQ', 'P14', 10, { cutLength: 18 }), tbf('H1-SQ', 'P14', 5), tbf('H1-RD', 'EP2', 2), { erp: 'OLD', qty: 1, note: 'TO BE FINISHED · P07' }] };

ok('a stocked line is not to-be-finished', !oeIsTbf(so.lines[0]) && oeIsTbf(so.lines[1]));
eq('a legacy line is read from its note', [oeIsTbf(so.lines[4]), oeLineFinish(so.lines[4])], [true, 'P07']);
eq('nothing raised → every to-be-finished line is open, stocked lines never', uncoveredTbfOf(so, {}).map(x => x.lineIdx), [1, 2, 3, 4]);

// TWO IDENTICAL LINES ARE TWO LINES. The old reverse lookup (item + finish) read them as one.
const woLine1 = { id: 'WO-A', rootItem: 'H1-SQ', recipe: 'P14', soLineIdx: 1, status: 'Approved' };
eq('a work order stamped for line 1 covers line 1 only', uncoveredTbfOf(so, { wos: [woLine1] }).map(x => x.lineIdx), [2, 3, 4]);
const legacyWo = { id: 'WO-OLD', rootItem: 'H1-SQ', recipe: 'P14', status: 'Approved' };
eq('an unstamped (older) work order still covers by item + finish', uncoveredTbfOf(so, { wos: [legacyWo] }).map(x => x.lineIdx), [3, 4]);
eq('…matched by the alias the line was entered under too', !!oeCoverageOf({ so, line: so.lines[1], lineIdx: 1, wos: [{ id: 'W', rootItem: 'REAL', aliasErp: 'H1-SQ', recipe: 'P14' }] }), true);

// THE LINE'S OWN RECORD ON THE SALES ORDER
const stamped = { ...so, oeGen: { 1: { kind: 'WO', ids: ['WO-GONE'] }, 3: { kind: 'PLATING', ids: ['PLD-1'], ref: 'PLW-1' } } };
eq('a work-order record whose work order is gone no longer covers — it can be raised again', !!oeCoverageOf({ so: stamped, line: so.lines[1], lineIdx: 1, wos: [] }), false);
eq('…and covers while it is live', oeCoverageOf({ so: stamped, line: so.lines[1], lineIdx: 1, wos: [{ id: 'WO-GONE', status: 'Approved', soLineIdx: 9 }] }).kind, 'WO');
eq('a plating record stands after the demand ships (a shipped demand is deleted)', oeCoverageOf({ so: stamped, line: so.lines[3], lineIdx: 3, demands: [] }).kind, 'PLATING');
eq('a live plating demand covers a plated line with no record', oeCoverageOf({ so, line: so.lines[3], lineIdx: 3, demands: [{ id: 'P', baseErpId: 'H1-RD', finishCode: 'EP2' }] }).kind, 'PLATING');
ok('the signature changes when the open lines change', oeAutoSig(uncoveredTbfOf(so, {})) !== oeAutoSig(uncoveredTbfOf(so, { wos: [woLine1] })));

// THE AUTOMATIC START READS "ANYTHING EVER RAISED" (any: true) — a FINISHED work order is Closed too.
const closedWo = { id: 'WO-DONE', rootItem: 'H1-SQ', recipe: 'P14', soLineIdx: 1, status: 'Closed' };
eq('the board: a closed work order does not cover (a person may raise it again)', !!oeCoverageOf({ so, line: so.lines[1], lineIdx: 1, wos: [closedWo] }), false);
eq('the automatic start: a closed work order DOES cover — a finished line is never re-made', uncoveredTbfOf(so, { wos: [closedWo] }, { any: true }).map(x => x.lineIdx), [2, 3, 4]);
const deadWo = { ...closedWo, id: 'WO-DEL', status: 'Approved', deleted: true };
eq('…a deleted one covers too, flagged dead so the card says so in red', oeCoverageOf({ so, line: so.lines[1], lineIdx: 1, wos: [deadWo], any: true }).dead, true);
eq('…and the card text', oeLineStateOf({ coverage: oeCoverageOf({ so, line: so.lines[1], lineIdx: 1, wos: [deadWo], any: true }) }).key, 'DEAD');
eq('a deleted first try with a live replacement reads as the live one', oeCoverageOf({ so, line: so.lines[1], lineIdx: 1, wos: [deadWo, woLine1], any: true }).doc.id, 'WO-A');
eq('a line raised once whose work orders are all gone is NOT re-raised by itself', oeCoverageOf({ so: stamped, line: so.lines[1], lineIdx: 1, wos: [], any: true }).dead, true);

// MAY IT RUN BY ITSELF?
const comp = (o) => ({ code: 'X', need: 10, have: 10, short: 0, actions: [], ...o });
eq('everything on the shelf, units agree → runs', autoRunnable({ components: [comp()] }).ok, true);
eq('the routine phosphate convert with its raw on the shelf → runs', autoRunnable({ components: [comp({ have: 0, short: 10, actions: [{ kind: 'CONVERT', qty: 10, rawHave: 12 }] })] }).ok, true);
eq('a convert whose raw is ALSO short → a person', autoRunnable({ components: [comp({ have: 0, short: 10, actions: [{ kind: 'CONVERT', qty: 10, rawHave: 3 }, { kind: 'SHOP', code: 'RAW', qty: 7 }] })] }).ok, false);
eq('a short with a shop or PO action → a person', autoRunnable({ components: [comp({ have: 2, short: 8, actions: [{ kind: 'SHOP', qty: 8 }] })] }).ok, false);
eq('a short "covered by inbound" is still a person\'s call', autoRunnable({ components: [comp({ have: 2, short: 8, actions: [{ kind: 'PO', qty: 8, skip: true }] })] }).ok, false);
eq('a unit mismatch → a person', autoRunnable({ components: [comp({ unitMismatch: true, held: true, holdReason: 'PR vs EA' })] }).reasons, ['PR vs EA']);
eq('a bought line → a person', autoRunnable({ buy: true, components: [comp()] }).ok, false);
eq('a short pole (cut a longer stick or wait) → a person', autoRunnable({ components: [comp()], poleChoice: { pullErp: 'H1-1R-6', pullFt: 6, short: 2 } }).ok, false);
eq('units unreadable on this NetSuite read → a person', autoRunnable({ components: [comp()] }, { unitsKnown: false }).ok, false);
ok('the review-gate block rule moved here unchanged', oeJobBlocked({ components: [{ held: true, short: 1 }] }) && !oeJobBlocked({ components: [{ held: true, short: 0 }] }));

// WHAT THE RTG CARD SAYS
eq('nothing raised', oeLineStateOf({ coverage: null }).key, 'NONE');
eq('named by the automatic run', oeLineStateOf({ coverage: null, review: { reasons: ['RAW: 7 short'] } }).text, 'needs a decision — RAW: 7 short');
eq('parked, and why', oeLineStateOf({ coverage: { kind: 'WO', doc: { id: 'WO-A', status: 'Approved', awaitingConvert: true } } }).text, 'WO-A — parked: waiting on phosphate convert');
eq('on the floor', oeLineStateOf({ coverage: { kind: 'WO', doc: { id: 'WO-A', status: 'Dispatched' } } }).key, 'FLOOR');
console.log(`oeLines: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
