// The Stitch & Sew route, pinned (S7, step 5a, 2026-10-11): the one classifier calls a pillow holder 'sew', the
// floor-line test sees it, the parts beneath the holder are read off the sales order in yards / each, a sewing
// group becomes ONE finishing document with no shop half — division SEW, the four zones, the pillows with their
// one-side cut, the parts list — and nothing of the poles / sled shape.
import { classifyLine, DIVISION_SEW, DIVISION_SMALL, DIVISION_CUSTOM } from '../src/components/Shared/lineClassification.js';
import { oeIsFloorLine } from '../src/components/Shared/oeLines.js';
import { isSewLine, sewHolderKeyOf, sewPartsOf, isSewGroup, sewPillowOf, sewDocShapeOf, SEW_ZONES, SEW_FINISH, SEW_DIVISION, panelCutOf, cutFits, allocateCutsOf } from '../src/components/Shared/sewRouteShape.js';
import { readyDateOf, leadBasisOf, LEAD_WEEKS, soHeaderOf } from '../src/components/Shared/salesOrderHeader.js';
import { DEFAULT_PILLOW_PRICING } from '../src/components/Shared/pillowPricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

// the sales order tab 7 wrote (3c): the holder, its two parts beneath (fabric in yards, insert each), a stocked throw
const holder = { erp: 'CUSTOM PILLOW', name: 'Custom Pillow', qty: 2, madeToOrder: 'SEW', pillow: { requestId: 'PILLOWREQ-1', line: 0, summary: '22x22 · group B · 1 seam', sizeKey: '22x22', group: 'B', design: { size: '22x22' }, panels: [{ label: 'A', widthIn: 22, heightIn: 22 }], sourced: [{ code: 'ROMO/INDIGO', panel: 'B' }], capturedFabrics: [], snapshot: 'data:image/jpeg;base64,AA' } };
const fabric = { erp: 'FAB-A', name: 'Savery', qty: 1, inKit: true, kitOf: 'pillow-PILLOWREQ-1-0', hidden: true, perFoot: true, feetPer: 1.5, billedFeet: 1.5, unitWord: 'yd', note: 'panel A · 1.5 yd · for the custom pillow' };
const insert = { erp: 'FILL-22', name: 'Insert', qty: 2, inKit: true, kitOf: 'pillow-PILLOWREQ-1-0', hidden: true };
const otherKitPart = { erp: 'H1-1BS', name: 'bracket', qty: 2, inKit: true, kitOf: 'kit-9' };
const throwLine = { erp: 'NAKA10-THROW', name: 'Naka throw', qty: 1 };
const so = { id: 'QS-1', soId: 'QS-1', customer: 'Acme', customerId: 'C1', needBy: '2026-11-01', nsInternalId: '555', lines: [holder, fabric, insert, otherKitPart, throwLine] };

// ── the classifier ───────────────────────────────────────────────────────────────────────────
ok('a pillow holder is the sewing floor\'s, before any other signal', classifyLine(holder, null) === DIVISION_SEW && DIVISION_SEW === 'sew');
ok('madeToOrder SEW alone is enough', classifyLine({ madeToOrder: 'SEW' }, { manufacturingSpecs: { partHandling: 'Small Parts' } }) === DIVISION_SEW);
ok('a stocked throw is still a shelf pick', classifyLine(throwLine, { manufacturingSpecs: { partHandling: 'Small Parts' } }) === DIVISION_SMALL);
ok('a custom pole is still the shop\'s', classifyLine({ name: 'rod', partHandling: 'Custom' }, null) === DIVISION_CUSTOM);
ok('the floor-line test sees a pillow', oeIsFloorLine(holder) && oeIsFloorLine({ madeToOrder: 'SEW' }) && !oeIsFloorLine(throwLine));

// ── the parts beneath the holder ─────────────────────────────────────────────────────────────
ok('a sew line is recognised', isSewLine(holder) && !isSewLine(fabric) && !isSewLine(throwLine));
ok('the holder\'s key is what tab 7 wrote on its parts', sewHolderKeyOf(holder) === 'pillow-PILLOWREQ-1-0' && sewHolderKeyOf(throwLine) === '');
const parts = sewPartsOf(so, holder, 0);
ok('only the holder\'s own parts: fabric in yards (1.5), insert each (2) — not another kit\'s part, not the throw', parts.map(p => `${p.legacyErpId}:${p.quantity}:${p.uom}:${p.soLineIdx}`).join(',') === 'FAB-A:1.5:YARD:1,FILL-22:2:EACH:2', JSON.stringify(parts));

// ── the group → the document ─────────────────────────────────────────────────────────────────
const SIZES = ['20x12', '22x22'];
const config = { ...DEFAULT_PILLOW_PRICING, sizeOrder: SIZES, prices: { '22x22': { B: 775 } }, seamAllowanceIn: 0.5 };
const job = { key: 0, so, line: holder, lineIdx: 0, part: { id: 'cp', legacyErpId: 'CUSTOM PILLOW', itemName: 'Custom Pillow', manufacturingSpecs: { productType: 'Non-Inventory' } }, finish: SEW_FINISH, qty: 2, sew: true, sewParts: parts, division: DIVISION_SEW, __planLines: parts };
const group = { key: '|SEW|', rowKey: '', rowLabel: '', finish: SEW_FINISH, tag: '', jobs: [job] };
ok('a group of pillow jobs is a sewing group; a mixed one is not', isSewGroup(group) && !isSewGroup({ jobs: [job, { line: throwLine }] }) && !isSewGroup({ jobs: [] }));
const pillow = sewPillowOf({ job, config });
ok('the pillow on the document: qty, size, group, design, panels, the one-side cut (23 × 23), the sourced fabric, the snapshot, every zone Pending', pillow.qty === 2 && pillow.sizeKey === '22x22' && pillow.minCut.lengthIn === 23 && pillow.minCut.widthIn === 23 && pillow.sourced.length === 1 && pillow.snapshot.startsWith('data:') && SEW_ZONES.every(z => pillow.zoneStatus[z] === 'Pending'));
const inventory = [{ legacyErpId: 'FAB-A', itemName: 'Savery', manufacturingSpecs: { uom: 'RY', homeBin: 'F-01', productType: 'FABRIC' } }, { legacyErpId: 'FILL-22', itemName: 'Insert', manufacturingSpecs: { productType: 'Insert', binLocation: 'I-2' } }];
const shape = sewDocShapeOf({ group, so, brand: 'uniquity', createdBy: 'stuart', now: 1000, inventory, woId: 'WO-OE-QS-1-1000', note: 'Order Entry QS-1 · Acme · Stitch & Sew', config, uomOf: (part, qty) => ({ pcs: qty }), factsOf: () => ({ material: 'TEXTILE' }) });
const fp = shape.finPayload;
ok('the document is division SEW on the SEW stream with the four zones and no recipe but SEW', fp.division === SEW_DIVISION && fp.finishStream === 'SEW' && fp.zones.join() === 'CUT,SEW,STUFF,PACK' && fp.recipe === 'SEW' && fp.recipeSource === 'pillow');
ok('no shop half — to the pick at once', fp.hasCustomSibling === false && fp.shopSiblingId === null && fp.sentToPickPack === true && fp.pickStatus === 'Pending');
ok('nothing of the poles / sled shape', !('poles' in fp) && !('totalPoles' in fp) && fp.paintSize === null && fp.paintSizes === null);
ok('the parts list is the pulls in yards / each with bins, the sew finish and the line numbers', fp.partsList.length === 2 && fp.partsList[0].legacyErpId === 'FAB-A' && fp.partsList[0].quantity === 1.5 && fp.partsList[0].uom === 'YARD' && fp.partsList[0].binLocation === 'F-01' && fp.partsList[0].finishCode === 'SEW' && fp.partsList[0].soLineIdx === 1 && fp.partsList[0].pillowLineIdx === 0 && fp.partsList[0].pcs === 1.5 && fp.partsList[1].binLocation === 'I-2');
ok('the pillows ride the document; totals are pillows, not parts', fp.pillows.length === 1 && fp.totalPillows === 2 && fp.totalParts === 2 && fp.imageUrl.startsWith('data:'));
ok('the sales header: Order Entry class, the order, the customer, the line, finish group SEW, division SEW', fp.orderType === 'sales' && fp.soId === 'QS-1' && fp.customer === 'Acme' && fp.soLineIdxs.join() === '0' && fp.finishGroup === 'SEW');
const hq = shape.hq;
ok('the RTG record: Approved, Order Entry source, route FINISHING (the one spine), division SEW, qty = pillows, the payload inside', hq.status === 'Approved' && hq.source === 'ORDER_ENTRY' && hq.routeTo === 'FINISHING' && hq.division === 'SEW' && hq.qty === 2 && hq.finPayload === fp && hq.soAppId === 'QS-1' && hq.soAccepted === true);
ok('the facts and the stamp land on both', hq.material === 'TEXTILE' && fp.material === 'TEXTILE');
ok('the name says what it is', /Stitch & Sew · 2 custom pillows · fabric to be sourced/.test(fp.itemName));

// ── a shelf cut before the roll (5c) ─────────────────────────────────────────────────────────
ok('the back\'s cut is the pillow\'s size; a panel\'s cut is its own rectangle', JSON.stringify(panelCutOf(pillow, 'BACK')) === JSON.stringify({ widthIn: 22, heightIn: 22 }) && JSON.stringify(panelCutOf({ ...pillow, panels: [{ label: 'A', widthIn: 22, heightIn: 8 }] }, 'A')) === JSON.stringify({ widthIn: 22, heightIn: 8 }));
ok('a 24" × 54" cut fits a 22x22 side (23 × 23 with allowance); a 20" cut does not; railroad reads it turned', cutFits({ lengthIn: 24, widthIn: 54 }, { widthIn: 22, heightIn: 22 }) && !cutFits({ lengthIn: 20, widthIn: 54 }, { widthIn: 22, heightIn: 22 }) && cutFits({ lengthIn: 30, widthIn: 20 }, { widthIn: 28, heightIn: 12 }, { railroad: true }) && !cutFits({ lengthIn: 30, widthIn: 20 }, { widthIn: 28, heightIn: 12 }));
const pulls = [{ legacyErpId: 'FAB-A', quantity: 1.5, uom: 'YARD', panel: 'A', pillowLineIdx: 0 }, { legacyErpId: 'FAB-A', quantity: 1.5, uom: 'YARD', panel: 'BACK', pillowLineIdx: 0 }, { legacyErpId: 'FILL-22', quantity: 2, uom: 'EACH', pillowLineIdx: 0 }];
const pcs = [{ id: 'F-BIG', itemCode: 'FAB-A', lengthIn: 40, widthIn: 54, status: 'CUT' }, { id: 'F-SMALL', itemCode: 'FAB-A', lengthIn: 24, widthIn: 54, status: 'CUT' }, { id: 'F-TOO-SHORT', itemCode: 'FAB-A', lengthIn: 20, widthIn: 54, status: 'CUT' }, { id: 'F-OTHER', itemCode: 'FAB-B', lengthIn: 40, widthIn: 54, status: 'CUT' }, { id: 'F-GONE', itemCode: 'FAB-A', lengthIn: 40, widthIn: 54, status: 'CONSUMED' }];
const al = allocateCutsOf({ pulls, pillows: { 0: pillow }, pieces: pcs, fabrics: {}, config });
ok('two pillows need 4 cuts of 22x22; two fitting cuts on the shelf cover two of them — smallest fit first, never a short one, another fabric, or a consumed one', al.allocations.length === 2 && al.allocations.map(a => a.pieceId).sort().join() === 'F-BIG,F-SMALL' && !al.allocations.some(a => ['F-TOO-SHORT', 'F-OTHER', 'F-GONE'].includes(a.pieceId)), JSON.stringify(al.allocations));
ok('the roll pulls shrink by what the cuts cover and each cut is its own pull line by its id', (() => { const roll = al.pulls.filter(p => !p.pickByPiece && p.legacyErpId === 'FAB-A'); const byPiece = al.pulls.filter(p => p.pickByPiece); return byPiece.length === 2 && byPiece.every(p => p.uom === 'YARD' && /^CUT F-/.test(p.partName)) && roll.reduce((s, p) => s + p.quantity, 0) === 1.5 && al.pulls.some(p => p.legacyErpId === 'FILL-22'); })(), JSON.stringify(al.pulls));
ok('the notes say what came from the shelf — both cuts went to ONE pull line (2 of 2), the other stays on the roll', al.notes.length === 1 && /FAB-A · panel/.test(al.notes[0]) && /2 of 2 cut\(s\) from the shelf/.test(al.notes[0]), JSON.stringify(al.notes));
ok('no live cut → the pulls are untouched', JSON.stringify(allocateCutsOf({ pulls, pillows: { 0: pillow }, pieces: [], config }).pulls) === JSON.stringify(pulls));
const shaped = sewDocShapeOf({ group, so, brand: 'uniquity', now: 1000, inventory, woId: 'WO-OE-QS-1-1000', config, uomOf: (part, qty) => ({ pcs: qty }), factsOf: () => ({}), pieces: pcs });
ok('the document carries its allocations and the piece pull lines with the sew finish and a bin', shaped.finPayload.cutAllocations.length === 2 && shaped.finPayload.partsList.filter(p => p.pickByPiece).every(p => p.finishCode === 'SEW' && p.binLocation === 'F-01') && shaped.allocations.length === 2);
ok('without pieces the document has no allocations field', !('cutAllocations' in sewDocShapeOf({ group, so, brand: 'uniquity', now: 1000, inventory, woId: 'X', config }).finPayload));

// ── the SEW lead class (5d) ───────────────────────────────────────────────────────────────────
ok('SEW = 3 weeks, 2 on rush', LEAD_WEEKS.SEW.std === 3 && LEAD_WEEKS.SEW.rush === 2);
ok('a sew line alone → SEW; a plated finish beside it wins; nothing → null', leadBasisOf([], { sew: true }) === 'SEW' && leadBasisOf(['EP2'], { sew: true }) === 'PLATED' && leadBasisOf([], { sew: false }) === null);
const rd = readyDateOf({ codes: [], sew: true, from: Date.parse('2026-10-11T12:00:00Z') });
ok('the ready date is three weeks out, two on rush', rd.leadBasis === 'SEW' && rd.leadWeeks === 3 && rd.readyDate === '2026-11-01' && readyDateOf({ codes: [], sew: true, rush: true, from: Date.parse('2026-10-11T12:00:00Z') }).readyDate === '2026-10-25');
const hdr = soHeaderOf({ door: 'QUICKSHIP', form: { soExtras: {}, ship: { method: 'SAVED' }, jobName: 'x', lines: [holder, fabric, insert], rush: false }, now: Date.parse('2026-10-11T12:00:00Z') });
ok('tab 7\'s header reads the pillow line and promises three weeks', hdr.leadBasis === 'SEW' && hdr.leadWeeks === 3 && hdr.readyDate === '2026-11-01');
ok('a tab 7 header with no pillow and no finish promises nothing', soHeaderOf({ door: 'QUICKSHIP', form: { soExtras: {}, ship: { method: 'SAVED' }, lines: [throwLine] } }).leadBasis === null);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
