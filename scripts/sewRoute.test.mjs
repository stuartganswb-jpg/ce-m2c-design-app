// The Stitch & Sew route, pinned (S7, step 5a, 2026-10-11): the one classifier calls a pillow holder 'sew', the
// floor-line test sees it, the parts beneath the holder are read off the sales order in yards / each, a sewing
// group becomes ONE finishing document with no shop half — division SEW, the four zones, the pillows with their
// one-side cut, the parts list — and nothing of the poles / sled shape.
import { classifyLine, DIVISION_SEW, DIVISION_SMALL, DIVISION_CUSTOM } from '../src/components/Shared/lineClassification.js';
import { oeIsFloorLine } from '../src/components/Shared/oeLines.js';
import { isSewLine, sewHolderKeyOf, sewPartsOf, isSewGroup, sewPillowOf, sewDocShapeOf, SEW_ZONES, SEW_FINISH, SEW_DIVISION } from '../src/components/Shared/sewRouteShape.js';
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

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
