// 🧪 A stock run is put away by scanning it into its bin — packaged, the item label, the bin label, then ✓ Put Away (Stuart 2026-10-08).
//    node scripts/putAwayScan.test.mjs
import { itemScanOf, runItemCodeOf, runItemCodesOf, expectedBinsOf, expectedBinsText, binQuestionOf, putAwayStepOf, putAwayBlockerOf, tidyBin, PUT_AWAY_STEP } from '../src/components/Shared/putAwayScan.js';
import { encodeUomScan } from '../src/components/Shared/labelScan.js';
import { packLinesOf } from '../src/components/Shared/pickLines.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

const run = { id: 'WO-11702', orderType: 'stock', stockErpId: 'H1-138RG/P', type: 'H1-138RG/P', totalParts: 200, completedParts: 198 };
const paintRun = { id: 'WO-JFP-HTFMRLG-04', orderType: 'stock', paintOnly: true, jfpItemCode: 'HTFMRLG/04', stockErpId: 'HTFMRLG', type: 'HTFMRLG', totalParts: 40 };

// ── which item a run puts away ──
eq('a stock run puts away its finished item', runItemCodeOf(run), 'H1-138RG/P');
eq('a paint run puts away the item it adjusts in', runItemCodeOf(paintRun), 'HTFMRLG/04');
eq('…and answers to every code it carries', runItemCodesOf(paintRun), ['HTFMRLG/04', 'HTFMRLG']);
eq('the pack bench\'s one row is the same item (Shared/pickLines)', packLinesOf(run).map(l => `${l.key} ${l.erp} ×${l.qty}`), ['STOCK H1-138RG/P ×198']);

// ── the item scan ──
eq('nothing scanned yet is not an error', itemScanOf('', run), { ok: false, empty: true, code: '', msg: '' });
eq('the run\'s own item label', itemScanOf('H1-138RG/P', run), { ok: true, empty: false, code: 'H1-138RG/P', msg: '' });
eq('typed by hand, lower case and spaced', itemScanOf('  h1-138rg/p ', run).ok, true);
eq('a pack label of the item reads as the item', itemScanOf(encodeUomScan({ code: 'H1-138RG/P', uom: '7PK', pcs: 7 }), run), { ok: true, empty: false, code: 'H1-138RG/P', msg: '' });
const wrong = itemScanOf('H1-138RG/P25', run);
eq('another finish of the same part is another item', [wrong.ok, wrong.code], [false, 'H1-138RG/P25']);
ok('…and is refused by name, both names', /That is H1-138RG\/P25 — this run is H1-138RG\/P\./.test(wrong.msg));
eq('the base item is not the painted item', itemScanOf('H1-138RG', run).ok, false);
eq('a paint run accepts the item it adjusts in', itemScanOf('HTFMRLG/04', paintRun).ok, true);
eq('…and the label the bench prints for it', itemScanOf('HTFMRLG', paintRun).ok, true);
const woLabel = itemScanOf('WO-11702', run, { runKeys: ['WO-11702', 'WO11702'] });
eq('the run\'s own work-order label is not its item label', woLabel.ok, false);
ok('…and the message says which label it was', /work-order label/.test(woLabel.msg) && /H1-138RG\/P/.test(woLabel.msg));
eq('a work-order label of ANOTHER run reads as a wrong item', /this run is H1-138RG\/P/.test(itemScanOf('WO-11999', run, { runKeys: ['WO-11702'] }).msg), true);
const noItem = itemScanOf('H1-138RG/P', { id: 'X', orderType: 'stock' });
ok('a run that names no item cannot be checked, and says so', !noItem.ok && /names no item/.test(noItem.msg));

// ── where the item is expected ──
const live = { bins: [{ bin: 'U S19-E2L-R4', name: 'U S19-E2L-R4', qty: 120 }, { bin: 'RTS-CUS', name: 'RTS-Cus', qty: 6 }, { bin: 'EMPTY-1', name: 'EMPTY-1', qty: 0 }] };
const part = { legacyErpId: 'H1-138RG/P', binLocation: 'BB 2-2, UNASSIGNED, bb 2 - 2', manufacturingSpecs: {} };
eq('NetSuite\'s bins first — only the ones that hold it', expectedBinsOf({ live, part }), { source: 'NETSUITE', bins: [{ bin: 'U S19-E2L-R4', name: 'U S19-E2L-R4', qty: 120 }, { bin: 'RTS-CUS', name: 'RTS-Cus', qty: 6 }] });
eq('the Library\'s bins when NetSuite holds none (no UNASSIGNED, no doubles)', expectedBinsOf({ live: { bins: [] }, part }), { source: 'LIBRARY', bins: [{ bin: 'BB 2-2', name: 'BB 2-2', qty: null }] });
eq('the Library bin kept under manufacturingSpecs is read too', expectedBinsOf({ part: { manufacturingSpecs: { binLocation: 'M E5R-N16-R1' } } }).bins.map(b => b.bin), ['M E5R-N16-R1']);
eq('nothing known', expectedBinsOf({ live: null, part: { binLocation: 'UNASSIGNED' } }), { source: '', bins: [] });
eq('in words — NetSuite', expectedBinsText(expectedBinsOf({ live, part })), 'NetSuite holds it in: U S19-E2L-R4 ×120 · RTS-Cus ×6');
eq('in words — the Library', expectedBinsText(expectedBinsOf({ live: { bins: [] }, part })), 'The Library names: BB 2-2 (NetSuite holds none today)');
eq('in words — nothing', expectedBinsText(expectedBinsOf({})), 'No bin on record for this item yet.');
ok('a long list is cut, and says how many more', / · \+2 more$/.test(expectedBinsText({ source: 'NETSUITE', bins: ['A', 'B', 'C', 'D', 'E'].map(b => ({ bin: b, name: b, qty: 1 })) })));

// ── "are you sure you want to put it in this bin?" ──
const expected = expectedBinsOf({ live, part });
eq('a bin NetSuite holds the item in — no question', binQuestionOf({ bin: 'U S19-E2L-R4', code: 'H1-138RG/P', expected }), '');
eq('…whatever the case or the spacing round the dash', binQuestionOf({ bin: 'rts - cus', code: 'H1-138RG/P', expected }), '');
const q = binQuestionOf({ bin: 'BB 4-1', code: 'H1-138RG/P', expected });
ok('another bin is ASKED, in his words', q.startsWith('Are you sure you want to put it in this bin?'));
ok('…naming the bin and where NetSuite holds the item', /BB 4-1/.test(q) && /NetSuite holds H1-138RG\/P in U S19-E2L-R4, RTS-Cus today/.test(q));
ok('…and what each answer does', /OK = put it away in BB 4-1/.test(q) && /Cancel = scan another bin/.test(q));
ok('against the Library when NetSuite holds none', /the Library names BB 2-2 for H1-138RG\/P/.test(binQuestionOf({ bin: 'BB 4-1', code: 'H1-138RG/P', expected: expectedBinsOf({ live: { bins: [] }, part }) })));
eq('nothing to compare against is not a wrong bin', binQuestionOf({ bin: 'BB 4-1', code: 'H1-138RG/P', expected: expectedBinsOf({}) }), '');
eq('no bin, no question', binQuestionOf({ bin: '  ', expected }), '');
eq('a bin is tidied as the WMS tidies one', tidyBin('  bb  2 - 2 '), 'BB 2-2');

// ── the order of the work ──
eq('nothing done: package first', putAwayStepOf({}), PUT_AWAY_STEP.PACKAGE);
eq('a scan before the packaging is confirmed does not skip it', putAwayStepOf({ packaged: false, itemOk: true, bin: 'BB 2-2' }), PUT_AWAY_STEP.PACKAGE);
eq('packaged: the item label', putAwayStepOf({ packaged: true }), PUT_AWAY_STEP.ITEM);
eq('a bin with no item scan is not enough', putAwayStepOf({ packaged: true, itemOk: false, bin: 'BB 2-2' }), PUT_AWAY_STEP.ITEM);
eq('item scanned: the bin label', putAwayStepOf({ packaged: true, itemOk: true, bin: ' ' }), PUT_AWAY_STEP.BIN);
eq('all three: ready', putAwayStepOf({ packaged: true, itemOk: true, bin: 'BB 2-2' }), PUT_AWAY_STEP.READY);
ok('the button says what it waits for — packaging', /Packaging finished/.test(putAwayBlockerOf(PUT_AWAY_STEP.PACKAGE)));
eq('…the item, by name', putAwayBlockerOf(PUT_AWAY_STEP.ITEM, 'H1-138RG/P'), 'scan the item label of H1-138RG/P');
ok('…the bin', /bin label/.test(putAwayBlockerOf(PUT_AWAY_STEP.BIN)));
eq('…and nothing when it is ready', putAwayBlockerOf(PUT_AWAY_STEP.READY), '');

console.log(`putAwayScan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
