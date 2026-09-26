// node scripts/paintRunGuard.test.mjs — a paint run is refused or confirmed against the runs already on order (Stuart 2026-09-26).
import { openPaintRunsOf, duplicateRunText, duplicateStamp, runIsClosed, runPhaseOf } from '../src/components/Shared/paintRunGuard.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

const T0 = 1790000000000;
const jfpA = { id: 'WO-JFP-HZLWP8135-B5-784532', paintOnly: true, jfpItemCode: 'HZLWP8135/B5', totalParts: 8, status: 'Dispatched', dispatchedBy: 'Eric', createdAt: T0, jfpPullFrom: 'HZLWP8135' };
const jfpB = { id: 'WO-JFP-HZLWP8135-B5-900001', paintOnly: true, jfpItemCode: 'hzlwp8135/b5', totalParts: 4, status: 'Dispatched', floorPhase: 'On Floor', createdBy: 'Grace', createdAt: T0 + 5000, duplicateOf: ['WO-JFP-HZLWP8135-B5-784532'] };
const closedRun = { id: 'WO-JFP-HZLWP8135-B5-100000', paintOnly: true, jfpItemCode: 'HZLWP8135/B5', totalParts: 6, status: 'Closed', closedAt: T0 };
const otherCode = { id: 'WO-JFP-HZLWP8135-B4-850576', paintOnly: true, jfpItemCode: 'HZLWP8135/B4', totalParts: 6, status: 'Dispatched' };
const notPaint = { id: 'WO-STK-1', paintOnly: false, jfpItemCode: 'HZLWP8135/B5', totalParts: 20, status: 'Dispatched' };
const deleted = { id: 'WO-JFP-HZLWP8135-B5-200000', paintOnly: true, jfpItemCode: 'HZLWP8135/B5', totalParts: 3, deleted: true };
const docs = [jfpB, closedRun, otherCode, notPaint, deleted, jfpA];

const open = openPaintRunsOf(docs, ' hzlwp8135/B5 ');
eq('the open paint runs for EXACTLY this code, case-blind, oldest first — closed, deleted, other codes and non-paint runs excluded', open.map(r => r.woId), [jfpA.id, jfpB.id]);
eq('each carries qty, where it is, who and when, what it pulls', open[0], { woId: jfpA.id, qty: 8, phase: 'Dispatched', runType: 'Just For Paint', pullFrom: 'HZLWP8135', by: 'Eric', createdAt: T0, duplicateOf: [] });
eq('the floor\'s own phase wins over the board\'s status once it has reported', open[1].phase, 'On Floor');
eq('a run that was itself a confirmed 2nd run says so', open[1].duplicateOf, [jfpA.id]);
eq('no code → nothing', openPaintRunsOf(docs, ''), []);
eq('a code with nothing open → nothing to ask', [openPaintRunsOf(docs, 'HZLWP8135/B4').length, duplicateRunText('HZLWP8135/B4', [], 2)], [1, '']);
eq('closed by any of the four stamps, or deleted', [runIsClosed(closedRun), runIsClosed({ currentPhase: 'Closed' }), runIsClosed({ floorPhase: 'Closed' }), runIsClosed(deleted), runIsClosed(jfpA)], [true, true, true, true, false]);
eq('phase falls back to Dispatched', runPhaseOf({}), 'Dispatched');

const text = duplicateRunText('hzlwp8135/b5', open, 5);
eq('the question names the code, the count and the pieces already on order', text.startsWith('⚠ HZLWP8135/B5 is ALREADY ON ORDER — 2 open paint runs, 12 pcs'), true);
eq('…lists every run on its own line', [text.includes(`   ${jfpA.id} · 8 pcs · Dispatched · pulls HZLWP8135 · Eric`), text.includes(`   ${jfpB.id} · 4 pcs · On Floor · Grace`), text.includes('itself a confirmed 2nd run')], [true, true, true]);
eq('…and says what OK and Cancel do', [text.includes('second run of 5 pcs'), text.includes('OK creates it, marked as a confirmed 2nd run'), text.includes('Cancel creates nothing')], [true, true, true]);
eq('a confirmed 2nd run is stamped with what it duplicates, by whom, when', duplicateStamp(open, 'Stuart', T0 + 9), { duplicateOf: [jfpA.id, jfpB.id], duplicateConfirmedBy: 'Stuart', duplicateConfirmedAt: T0 + 9 });
eq('no open runs → no stamp at all (nothing undefined reaches Firestore)', duplicateStamp([], 'Stuart'), {});

console.log(`paintRunGuard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
