// What a cycle count sends NetSuite — one bin per adjustment line (Stuart 2026-10-20).   node scripts/countPlan.test.mjs
import { countPlanOf, adjustmentItemsOf, binTransferItemsOf, round5 } from '../src/components/Shared/countPlan.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };
const D = (internalId, binNumber, adjustQtyBy) => ({ internalId, binNumber, adjustQtyBy });

// ── one item, one bin (Eric's six that posted on 10-14 — IA27851–56) ──
let p = countPlanOf([D('40012', 'M E7-N5-R3', -35)]);
eq('one bin → one line, as before', [p.transferItems, p.adjustLines], [[], [{ internalId: '40012', binNumber: 'M E7-N5-R3', qty: -35 }]]);

// ── THE REFUSED SHAPE: one item down in two bins — was ONE line carrying both bins ──
p = countPlanOf([D('40020', 'A-1', -3), D('40020', 'B-2', -2)]);
eq('two bins down → two lines, one bin each', p.adjustLines, [{ internalId: '40020', binNumber: 'A-1', qty: -3 }, { internalId: '40020', binNumber: 'B-2', qty: -2 }]);
eq('…and no transfer', p.transferItems, []);
const items = adjustmentItemsOf(p.adjustLines, '17');
ok('every line carries exactly one bin', items.every(l => l.inventoryDetail.inventoryAssignment.items.length === 1));
ok('every line: its quantity = its detail = its one bin', items.every(l => l.adjustQtyBy === l.inventoryDetail.quantity && l.inventoryDetail.quantity === l.inventoryDetail.inventoryAssignment.items[0].quantity));
eq('the net change per item is what it was (−5)', items.reduce((s, l) => s + l.adjustQtyBy, 0), -5);
eq('the line shape', items[0], { item: { id: '40020' }, location: { id: '17' }, adjustQtyBy: -3, inventoryDetail: { quantity: -3, inventoryAssignment: { items: [{ binNumber: { refName: 'A-1' }, quantity: -3 }] } } });
p = countPlanOf([D('40021', 'A-1', 4), D('40021', 'B-2', 6)]);
eq('two bins up → two lines', p.adjustLines.map(l => [l.binNumber, l.qty]), [['A-1', 4], ['B-2', 6]]);

// ── an item that moved both ways is a bin transfer, exactly as before ──
p = countPlanOf([D('40030', 'A-1', -5), D('40030', 'B-2', 5)]);
eq('down 5 + up 5 → one transfer A→B, no adjustment', [p.transferItems, p.adjustLines], [[{ internalId: '40030', moves: [{ from: 'A-1', to: 'B-2', qty: 5 }] }], []]);
p = countPlanOf([D('40031', 'A-1', -5), D('40031', 'B-2', 3)]);
eq('down 5 + up 3 → transfer 3, adjust the 2 left', [p.transferItems[0].moves, p.adjustLines], [[{ from: 'A-1', to: 'B-2', qty: 3 }], [{ internalId: '40031', binNumber: 'A-1', qty: -2 }]]);
p = countPlanOf([D('40032', 'A-1', -2), D('40032', 'C-3', -2), D('40032', 'B-2', 5)]);
eq('two down + one up → two moves, the 1 left adjusted up', [p.transferItems[0].moves, p.adjustLines], [[{ from: 'A-1', to: 'B-2', qty: 2 }, { from: 'C-3', to: 'B-2', qty: 2 }], [{ internalId: '40032', binNumber: 'B-2', qty: 1 }]]);
const bt = binTransferItemsOf(countPlanOf([D('40030', 'A-1', -5), D('40030', 'B-2', 5)]).transferItems);
eq('the transfer line (shape unchanged)', bt[0], { item: { id: '40030' }, quantity: 5, inventoryDetail: { quantity: 5, inventoryAssignment: { items: [{ binNumber: { refName: 'A-1' }, toBinNumber: { refName: 'B-2' }, quantity: 5 }] } } });

// ── two count rows of the same item and bin are one ──
p = countPlanOf([D('40040', 'A-1', -2), D('40040', 'a-1', -1)]);
eq('same bin twice (any case) → one line of −3', p.adjustLines, [{ internalId: '40040', binNumber: 'A-1', qty: -3 }]);
p = countPlanOf([D('40041', 'A-1', -2), D('40041', 'A-1', 2)]);
eq('same bin, +2 and −2 → nothing to send', [p.transferItems, p.adjustLines], [[], []]);

// ── a hair of rounding never splits a line from its detail ──
eq('12.3 − 10.1 is 2.2, not 2.2000000000000006', round5(12.3 - 10.1), 2.2);
p = countPlanOf([D('40050', 'F-1', 12.3 - 10.1)]);
eq('a fractional count lands rounded', p.adjustLines[0].qty, 2.2);
p = countPlanOf([D('40051', 'F-1', -0.1), D('40051', 'F-1', -0.2)]);
eq('0.1 + 0.2 merged is 0.3', p.adjustLines[0].qty, -0.3);
p = countPlanOf([D('40052', 'F-1', -(10.3 - 10)), D('40052', 'G-2', 0.3)]);
eq('a fractional move pairs exactly — no hair left to adjust', [p.transferItems[0].moves[0].qty, p.adjustLines], [0.3, []]);

// ── nothing, or nothing to send ──
eq('no rows', countPlanOf([]), { transferItems: [], adjustLines: [] });
eq('a zero or an item with no NetSuite id is skipped', countPlanOf([D('40060', 'A-1', 0), D('', 'A-1', 3), null]), { transferItems: [], adjustLines: [] });
p = countPlanOf([D('1', 'A', -1), D('2', 'B', 2), D('1', 'C', -4)]);
eq('several items: each its own lines, in count order', p.adjustLines.map(l => `${l.internalId}:${l.binNumber}:${l.qty}`), ['1:A:-1', '1:C:-4', '2:B:2']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
