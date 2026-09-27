// node scripts/subFinish.test.mjs — CPQ'S TRAVERSE RULES ON EVERY DOOR (Stuart 2026-09-27, SO60551 Row 2): the track
// and F-clip wear the sub finish 4.5 aligns to the fascia and are cut shorter by CPQ's deduction; a part made in a
// stock colour is the stocked colour item; one naming rule for what leaves the floor.
import { subFinishOfFinish, isStockColourCode, trvRoleOfCode, finishedCodeOf, rowRestampOf, traverseOrderLinesOf, restampBreakdownLines } from '../src/components/Shared/subFinish.js';
import { explodeTraverse } from '../src/components/Shared/traverseExplode.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const P = (code, specs = {}, more = {}) => ({ id: `id-${code}`, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: specs, ...more });
const finishes = [{ code: 'S04', subFinishCode: 'TCP' }, { code: 'P14', subFinishCode: 'TBR' }, { code: 'TCP', isSubFinish: true }, { code: 'TBR', isSubFinish: true }];

// ── the lookups ──
eq('4.5 aligns S04 → TCP, P14 → TBR', [subFinishOfFinish('s04', finishes), subFinishOfFinish('P14', finishes), subFinishOfFinish('P99', finishes)], ['TCP', 'TBR', '']);
eq('a stock-colour item is /B or /C', [isStockColourCode('H1-2TRV-WB/C'), isStockColourCode('H1-2TRVBP/B'), isStockColourCode('H1-1CP-V/EP4'), isStockColourCode('H1-2TRV-WB')], [true, true, false, false]);
eq('the family\'s cut parts', [trvRoleOfCode('H1-2TRV'), trvRoleOfCode('H1-2TRVCLP'), trvRoleOfCode('H1-2TRV-WB'), trvRoleOfCode('H1-138TRV')], [{ family: 'H1-2TRV', role: 'TRACK' }, { family: 'H1-2TRV', role: 'FCLIP' }, null, null]);
eq('what leaves the floor', [finishedCodeOf('H1-2TRV', 'TCP'), finishedCodeOf('H1-2TRV', 'TBR'), finishedCodeOf('H1-2TRVCLP', 'TCP'), finishedCodeOf('H1-2RCTWR-O', 'S04'), finishedCodeOf('H1-1R', 'EP4'), finishedCodeOf('H1-1R/EP4', 'EP4')],
    ['H1-2TRVTRK/C', 'H1-2TRVTRK/B', 'H1-2TRVCLP/C', 'H1-2RCTWR-O/S04', 'H1-1R/EP4', 'H1-1R/EP4']);

// ── SO60551 Row 2, as the old reader anchored it ──
const fascia = P('H1-2RCTWR-O', { productType: 'Pole', partHandling: 'Custom', material: 'Wood' });
const track = P('H1-2TRV', { productType: 'Pole', partHandling: 'Custom' });
const fclip = P('H1-2TRVCLP', { productType: 'Pole', partHandling: 'Custom' });
const miter = P('H1-2TRVMTR', { productType: 'FEE' }, { partClass: 'Fee', itemName: 'Miter Return 2" Rectangular Rod' });
const wb = P('H1-2TRV-WB', { productType: 'BRACKET', usesSubFinish: true }, { partClass: 'Kit' });
const wbC = P('H1-2TRV-WB/C', { productType: 'Bracket' }, { partClass: 'Assembly' });
const plug = P('H1-2TRVPLUG', { productType: 'Component' });
const lib = [fascia, track, fclip, miter, wb, wbC, plug];
const byCode = (c) => lib.find(p => p.legacyErpId === String(c).toUpperCase()) || null;
const row2 = [
    { idx: 0, part: fascia, line: { erp: 'H1-2RCTWR-O', finishCode: 'S04', cutLength: 18, qty: 50 } },
    { idx: 1, part: track, line: { erp: 'H1-2TRV', cutLength: 18, qty: 50 } },
    { idx: 2, part: miter, line: { erp: 'H1-2TRVMTR', finishCode: 'EP4', qty: 50 } },
    { idx: 3, part: wb, line: { erp: 'H1-2TRV-WB', finishCode: 'EP4', billedErp: 'H1-2TRV-WB/EP4', toBeFinished: true, note: 'TO BE FINISHED · EP4', qty: 50 } },
    { idx: 4, part: plug, line: { erp: 'H1-2TRVPLUG', qty: 50 } },
    { idx: 5, part: fclip, line: { erp: 'H1-2TRVCLP', qty: 50 } },
];
const route = rowRestampOf({ rows: row2, finishes, findByCode: byCode });
eq('the route: the rod is the fascia (S04, 18")', [route.rodFinish, route.fasciaCut], ['S04', 18]);
eq('the route: the track → TCP, 17.5" (manual)', [route.patches[1].finishCode, route.patches[1].subFinishCode, route.patches[1].cutLength, route.patches[1].trvRole], ['TCP', 'TCP', 17.5, 'TRACK']);
eq('the route: the F-clip → TCP, 17" (manual)', [route.patches[5].finishCode, route.patches[5].cutLength], ['TCP', 17]);
eq('the route never swaps an item (that changes the NetSuite line)', [route.patches[3], route.patches[2], route.patches[0], route.patches[4]], [undefined, undefined, undefined, undefined]);
const motor = rowRestampOf({ rows: row2.map(r => r.idx === 1 || r.idx === 5 ? { ...r, line: { ...r.line, trvDrive: 'MOTORIZED' } } : r), finishes });
eq('motorized: the track −2", the F-clip −3"', [motor.patches[1].cutLength, motor.patches[5].cutLength], [16, 15]);
const reread = rowRestampOf({ rows: row2, finishes, swapIdentity: true, findByCode: byCode });
eq('↻ Re-read: the EP4 bracket becomes the stocked H1-2TRV-WB/C, a shelf pick', [reread.patches[3].erp, reread.patches[3].toBeFinished, reread.patches[3].finishCode, reread.patches[3].subFinishCode, reread.patches[3].note, reread.patches[3].identityFrom], ['H1-2TRV-WB/C', false, '', 'TCP', '', 'H1-2TRV-WB/EP4']);
eq('↻ Re-read: the miter takes the fascia\'s S04', reread.patches[2].finishCode, 'S04');
eq('↻ Re-read: the NetSuite change is flagged', reread.changes.filter(c => c.netsuite).map(c => c.idx), [3]);
// idempotent
const after = row2.map(r => ({ ...r, line: { ...r.line, ...(reread.patches[r.idx] || {}) }, part: reread.patches[r.idx] && reread.patches[r.idx].erp ? byCode(reread.patches[r.idx].erp) : r.part }));
const twice = rowRestampOf({ rows: after, finishes, swapIdentity: true, findByCode: byCode });
eq('a second pass changes nothing', twice.changes, []);
// a track already cut by CPQ (9/19+) keeps its cut; a paint-to-match track keeps its finish
const newer = rowRestampOf({ rows: [row2[0], { idx: 1, part: track, line: { erp: 'H1-2TRV', cutLength: 17.5, subFinishCode: 'TCP', qty: 50 } }], finishes });
eq('a CPQ-cut track is never cut twice', newer.patches[1].cutLength, undefined);
const matched = rowRestampOf({ rows: [row2[0], { idx: 1, part: track, line: { erp: 'H1-2TRV', cutLength: 17.5, finishCode: 'S04', qty: 50 } }], finishes });
eq('a track painted to match (CPQ\'s upcharge) keeps its finish', matched.patches[1] && matched.patches[1].finishCode, undefined);
// a row with no traverse parts is untouched
eq('ROW 1 (a plated pole + French returns) is untouched', rowRestampOf({ rows: [{ idx: 0, part: P('H1-1R', { productType: 'RODS' }), line: { erp: 'H1-1R', finishCode: 'EP4', cutLength: 18 } }, { idx: 1, part: P('H1-FRPF', { productType: 'FEE' }, { partClass: 'Fee', itemName: 'French Return' }), line: { erp: 'H1-FRPF', finishCode: 'EP4' } }], finishes, swapIdentity: true }).patches, {});
// two fascia finishes → the track waits for a person
const amb = rowRestampOf({ rows: [row2[0], { idx: 9, part: fascia, line: { erp: 'H1-2RCTWR-O', finishCode: 'P14', cutLength: 18 } }, row2[1]], finishes });
eq('two fascia finishes in a row: the track is named, not guessed', [amb.patches[1] && amb.patches[1].finishCode, /which one/.test((amb.notes.find(n => n.idx === 1) || {}).text || '')], [undefined, true]);

// ── the CPQ split's breakdown, row by row ──
const bd = [
    { isHeader: true, sidemark: 'Row 2' },
    { legacyErpId: 'H1-2RCTWR-O', partId: 'id-H1-2RCTWR-O', finishCode: 'S04', cutLength: 18, qty: 50 },
    { legacyErpId: 'H1-2TRV', partId: 'id-H1-2TRV', cutLength: 18, subFinishCode: 'TCP', qty: 50 },
    { isHeader: true, sidemark: 'Row 3' },
    { legacyErpId: 'H1-2RCTWR-O', partId: 'id-H1-2RCTWR-O', finishCode: 'P14', cutLength: 30, qty: 1 },
    { legacyErpId: 'H1-2TRV', partId: 'id-H1-2TRV', cutLength: 30, qty: 1 },
];
const split = restampBreakdownLines({ breakdown: bd, keep: (l) => !l.isHeader, partOf: (l) => lib.find(p => p.id === l.partId) || null, finishes, drive: 'MANUAL' });
eq('the split: each row\'s track takes its own fascia\'s colour and length', split.lines.filter(l => l.legacyErpId === 'H1-2TRV').map(l => [l.finishCode, l.cutLength]), [['TCP', 17.5], ['TBR', 29.5]]);

// ── tab 7's kit ──
const ex = explodeTraverse({ family: 'H1-2TRV', align: { setup: 'SINGLE', material: 'P', drive: 'MOTORIZED', minFeet: 4 }, feet: 6, proj: '3.625', motorItem: 'HSOM-21', rules: null });
const t7 = traverseOrderLinesOf({ exploded: ex.lines, family: 'H1-2TRV', finish: 'P14', feet: 6, drive: 'MOTORIZED', finishes, findByCode: (c) => byCode(c) || (String(c).toUpperCase() === 'H1-2RCTAR' ? P('H1-2RCTAR', { productType: 'Pole' }) : null) });
const tf = t7.find(c => c.role === 'fascia'), tt = t7.find(c => c.role === 'track');
eq('tab 7 fascia: 72", finished P14', [tf.consumeCode, tf.floor.cutLength, tf.floor.finishCode, tf.floor.billedFeet], ['H1-2RCTAR', 72, 'P14', 6]);
eq('tab 7 track: the library\'s H1-2TRV, 70" (motorized), TBR → H1-2TRVTRK/B', [tt.consumeCode, tt.floor.cutLength, tt.floor.finishCode, tt.finishedCode], ['H1-2TRV', 70, 'TBR', 'H1-2TRVTRK/B']);

console.log(`subFinish: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
