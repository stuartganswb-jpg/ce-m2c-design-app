// The Stitch & Sew floor rules, pinned (S7, step 5b, 2026-10-11): zones run one at a time in order, Start then
// Complete, only on a staged document; PACK's Complete completes the document the way every floor does; the CUT
// zone's question lists each pulled fabric and refuses nonsense; the three lists split the documents.
import {
    SEW_ZONES, isSewDoc, zoneStateOf, currentZoneOf, sewPhaseOf, zoneStartCheck, zoneCompleteCheck,
    zoneStartPatchOf, zoneCompletePatchOf, remainderRowsOf, remainderPiecesOf, sewQueueOf, sewFloorOf, sewDoneOf, sewLabelOf,
} from '../src/components/Shared/sewFloor.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const base = { id: 'WO-OE-QS-1-1000', division: 'SEW', stepStatus: 'Pending', currentPhase: 'Setup', partsList: [{ legacyErpId: 'FAB-A', partName: 'Savery', quantity: 1.5, uom: 'YARD', binLocation: 'F-01' }, { legacyErpId: 'FILL-22', partName: 'Insert', quantity: 2, uom: 'EACH' }], pillows: [{ qty: 2, sizeKey: '22x22', group: 'B' }], totalPillows: 2, customer: 'Acme', itemName: 'Order QS-1 · Stitch & Sew · 2 custom pillows', needBy: '2026-11-01', createdAt: 1 };
const staged = { ...base, stepStatus: 'Staged', currentPhase: 'Cutting' };

ok('a SEW document is recognised; a finishing one is not', isSewDoc(base) && !isSewDoc({ ...base, division: '' }));
ok('every zone starts Pending', JSON.stringify(zoneStateOf(base)) === JSON.stringify({ CUT: 'Pending', SEW: 'Pending', STUFF: 'Pending', PACK: 'Pending' }));
ok('the current zone is the first not complete', currentZoneOf(base) === 'CUT' && currentZoneOf({ ...base, zoneStatus: { CUT: 'Complete', SEW: 'Running' } }) === 'SEW' && currentZoneOf({ ...base, zoneStatus: { CUT: 'Complete', SEW: 'Complete', STUFF: 'Complete', PACK: 'Complete' } }) === null);
ok('the phase words: Setup before staging, the zone\'s word on the floor, Complete, Closed', sewPhaseOf(base) === 'Setup' && sewPhaseOf(staged) === 'Cutting' && sewPhaseOf({ ...staged, zoneStatus: { CUT: 'Complete' } }) === 'Sewing' && sewPhaseOf({ ...base, currentPhase: 'Complete' }) === 'Complete' && sewPhaseOf({ ...base, currentPhase: 'Closed' }) === 'Closed');

// ── starting and completing zones ────────────────────────────────────────────────────────────
ok('a zone cannot start before the document is staged', /stage it/.test(zoneStartCheck(base, 'CUT')));
ok('CUT may start on a staged document; SEW may not yet', zoneStartCheck(staged, 'CUT') === '' && /Cut comes first/.test(zoneStartCheck(staged, 'SEW')));
const cutRunning = { ...staged, zoneStatus: { CUT: 'Running' } };
ok('a running zone cannot start again', /already running/.test(zoneStartCheck(cutRunning, 'CUT')));
ok('a zone cannot complete unless it is running', /start Cut first/.test(zoneCompleteCheck(staged, 'CUT')) && zoneCompleteCheck(cutRunning, 'CUT') === '' && /not the zone in progress/.test(zoneCompleteCheck(cutRunning, 'SEW')));
const sp = zoneStartPatchOf(staged, 'CUT', { by: 'maria', now: 5000 });
ok('the start patch stamps the zone, who, when, the phase and the step', sp['zoneStatus.CUT'] === 'Running' && sp['zoneLog.CUT.startedBy'] === 'maria' && sp.currentPhase === 'Cutting' && sp.currentStepIndex === 0 && sp.startedAt === 5000);
const cp = zoneCompletePatchOf(cutRunning, 'CUT', { by: 'maria', now: 6000 });
ok('completing CUT moves the phase to Sewing and the step to 1', cp['zoneStatus.CUT'] === 'Complete' && cp.currentPhase === 'Sewing' && cp.currentStepIndex === 1 && !('completedAt' in cp));
const packRunning = { ...staged, zoneStatus: { CUT: 'Complete', SEW: 'Complete', STUFF: 'Complete', PACK: 'Running' } };
const done = zoneCompletePatchOf(packRunning, 'PACK', { by: 'maria', now: 9000 });
ok('completing PACK completes the document the way every floor does', done.currentPhase === 'Complete' && done.stepStatus === 'Complete' && done.completedAt === 9000 && done.completedBy === 'maria' && done.currentStepIndex === SEW_ZONES.length);
ok('a finished document refuses every zone', /finished/.test(zoneStartCheck({ ...staged, currentPhase: 'Complete' }, 'CUT')));

// ── the CUT question ─────────────────────────────────────────────────────────────────────────
const findPart = (c) => (c === 'FAB-A' ? { manufacturingSpecs: { width: 54 } } : null);
const rows = remainderRowsOf(staged, findPart);
ok('one row per pulled FABRIC (yards), never the insert; the width defaults to the bolt', rows.length === 1 && rows[0].code === 'FAB-A' && rows[0].pulledYards === 1.5 && rows[0].widthIn === 54 && rows[0].remWidthIn === '54' && rows[0].none === false);
ok('an unanswered row refuses', !remainderPiecesOf(rows).ok && /say what is left/.test(remainderPiecesOf(rows).errors[0]));
ok('none writes nothing', remainderPiecesOf([{ ...rows[0], none: true }]).ok && remainderPiecesOf([{ ...rows[0], none: true }]).pieces.length === 0);
ok('a length × width becomes a piece', (() => { const r = remainderPiecesOf([{ ...rows[0], lengthIn: '20', remWidthIn: '54' }]); return r.ok && r.pieces[0].itemCode === 'FAB-A' && r.pieces[0].lengthIn === 20 && r.pieces[0].widthIn === 54; })());
ok('more left than was pulled refuses', !remainderPiecesOf([{ ...rows[0], lengthIn: '60', remWidthIn: '54' }]).ok);
ok('a width is required', !remainderPiecesOf([{ ...rows[0], lengthIn: '20', remWidthIn: '' }]).ok);

// ── the lists ────────────────────────────────────────────────────────────────────────────────
const NOW = 10 * 86400000;
const docs = [base, staged, { ...base, id: 'done', currentPhase: 'Complete', completedAt: NOW - 1000 }, { ...base, id: 'old', currentPhase: 'Complete', completedAt: 1 }, { ...base, id: 'closed', currentPhase: 'Closed' }, { ...base, id: 'fin', division: '' }];
ok('the queue = SEW documents not yet staged', sewQueueOf(docs).map(d => d.id).join() === 'WO-OE-QS-1-1000');
ok('the floor = staged SEW documents', sewFloorOf(docs).length === 1 && sewFloorOf(docs)[0].stepStatus === 'Staged');
ok('done = completed within seven days, never closed, never a finishing document', sewDoneOf(docs, NOW).map(d => d.id).join() === 'done');
ok('the staging label says what it is', sewLabelOf(staged).kind === 'STITCH & SEW · PILLOWS' && sewLabelOf(staged).orderKey === 'WO-OE-QS-1-1000' && sewLabelOf(staged).qtyLabel === '2 pillow(s)' && sewLabelOf(staged).facts === '2 × 22x22 B');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
