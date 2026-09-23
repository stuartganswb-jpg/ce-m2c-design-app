// node scripts/rowPair.test.mjs — a row hits the floor as a production order does (Stuart 2026-09-23):
// grouped by row and finish, one pair per group, the pole the shop's, the small parts finishing's.
import { floorGroupsOf, splitGroupJobs, pairShapeOf, pairIdsOf } from '../src/components/Shared/rowPairShape.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const ok = (n, c) => { if (c) pass++; else { fail++; console.log(`✗ ${n}`); } };

const pole = { id: 'p1', legacyErpId: 'H1-75SR', itemName: '3/4" Square Pole', manufacturingSpecs: { productType: 'POLE', shopInstruction: 'cut square' } };
const cap = { id: 'p2', legacyErpId: 'H1-75SPF', itemName: 'Pyramid End Cap', manufacturingSpecs: { productType: 'FINIAL', paintSize: 'S', binLocation: 'A-01' } };
const bkt = { id: 'p3', legacyErpId: 'H1-75SBP-S', itemName: 'Backplate', manufacturingSpecs: { productType: 'BRACKET', paintSize: 'M' } };
const wood = { id: 'p4', legacyErpId: 'H1-138WR-O', itemName: 'Oak rod', manufacturingSpecs: { productType: 'POLE' } };
const inventory = [pole, cap, bkt, wood];
const job = (part, finish, line, more = {}) => ({ so: null, part, finish, qty: Number(line.qty) || 0, line, lineIdx: line.idx, key: line.idx, __planLines: [{ legacyErpId: part.legacyErpId, partName: part.itemName, quantity: Number(line.qty) || 0 }], ...more });

// ── THE GROUPING RULE ──────────────────────────────────────────────────────────────────────
{
    const display = { id: 'SO-APP-1', soId: 'SO60565', displayRelease: true, customer: 'Fabricut', nsInternalId: 9 };
    const jobs = [
        job(pole, 'P24', { idx: 0, erp: 'H1-75SR', qty: 50, row: 'Base Front 1', cutLength: 7.5 }, { custom: true }),
        job(cap, 'P24', { idx: 1, erp: 'H1-75SPF', qty: 50, row: 'Base Front 1' }),
        job(bkt, 'P24', { idx: 2, erp: 'H1-75SBP-S', qty: 100, memo: 'base front 1' }),   // typed on tab 7 as a memo
        job(wood, 'S03', { idx: 3, erp: 'H1-138WR-O', qty: 35, row: 'Row 3' }, { custom: true }),
        job(bkt, 'P26', { idx: 4, erp: 'H1-138BS', qty: 35, row: 'Row 3' }),
    ];
    const groups = floorGroupsOf(jobs, display);
    eq('a display order groups by row and finish — the pole, the finial and the bracket of one row are one group', groups.map(g => [g.rowLabel, g.finish, g.jobs.map(j => j.lineIdx)]),
        [['Base Front 1', 'P24', [0, 1, 2]], ['Row 3', 'S03', [3]], ['Row 3', 'P26', [4]]]);
    eq('a row with two finishes is two groups (wood stain and metal paint are two batches)', groups.filter(g => g.rowKey === groups[1].rowKey).length, 2);
    const plain = { id: 'SO-APP-2', soId: 'SO60427', customer: 'Read Window' };
    eq('an ordinary order is ONE row: its memos are rooms, not rows', floorGroupsOf(jobs.slice(0, 3).map(j => ({ ...j, line: { ...j.line, memo: 'Living room', row: undefined } })), plain).map(g => [g.rowLabel, g.finish, g.jobs.length]), [['', 'P24', 3]]);
    eq('a start-now split groups apart from its remainder so it can start', floorGroupsOf([job(cap, 'P24', { idx: 1, qty: 20 }, { __tag: '-NOW' }), job(cap, 'P24', { idx: 1, qty: 30 }, { __tag: '-PO' })], plain).map(g => g.tag), ['-NOW', '-PO']);
    eq('the shop\'s and finishing\'s jobs of a group', (() => { const { custom, small } = splitGroupJobs(groups[0]); return [custom.map(j => j.lineIdx), small.map(j => j.lineIdx)]; })(), [[0], [1, 2]]);

    // ── THE PAIR ──────────────────────────────────────────────────────────────────────────
    const { woId, shopWoId } = pairIdsOf(display, groups[0], 1790000000000);
    eq('the ids name the order, the row and the finish; the shop half is -C', [woId, shopWoId], ['WO-OE-SO60565-BASE-FRONT-1-P24-1790000000000', 'WO-OE-SO60565-BASE-FRONT-1-P24-1790000000000-C']);
    const shape = pairShapeOf({ group: groups[0], so: display, brand: 'ce', createdBy: 'stuart', now: 1, inventory, gate: { awaitingComponents: true }, materialStamp: { materialRows: [{ code: 'X' }], materialAsOf: 1 }, woId, shopWoId, tasks: { spinSetup: {} }, note: 'n' });
    eq('the finishing document carries every small part with its finish, and never the pole', shape.finPayload.partsList.map(l => [l.legacyErpId, l.quantity, l.finishCode, l.soLineIdx]), [['H1-75SPF', 50, 'P24', 1], ['H1-75SBP-S', 100, 'P24', 2]]);
    eq('…is a sled job sized from its parts, one recipe, linked to its shop half, pick released at shop start', [shape.finPayload.recipe, shape.finPayload.paintSize, shape.finPayload.paintSizes, shape.finPayload.totalParts, shape.finPayload.shopSiblingId, shape.finPayload.hasCustomSibling, shape.finPayload.sentToPickPack, 'poles' in shape.finPayload],
        ['P24', 'M', { S: 50, M: 100, L: 0 }, 150, `SHOP-${shopWoId}`, true, false, false]);
    eq('the shop sibling carries the pole as its cut list and its pull line, with the cut', [shape.shopSibling.cutList.map(c => [c.legacyErpId, c.qty, c.cutLength]), shape.shopSibling.pullLines.map(l => l.legacyErpId), shape.shopSibling.cutLength, shape.shopSibling.finSiblingId, shape.shopSibling.routeTo],
        [[['H1-75SR', 50, 7.5]], ['H1-75SR'], 7.5, woId, 'SHOP']);
    eq('…and the counts the plater bills on', [shape.shopSibling.poles, shape.shopSibling.feet, shape.shopSibling.billableFeet], [50, 31.25, 32]);
    eq('the item\'s shop instruction rides the shop half', shape.shopSibling.shopInstruction, 'cut square');
    eq('every document says which row and finish it is, and which lines', [shape.hq.rowLabel, shape.hq.finishGroup, shape.hq.soLineIdxs, shape.finPayload.rowLabel, shape.shopSibling.rowLabel], ['Base Front 1', 'P24', [0, 1, 2], 'Base Front 1', 'Base Front 1']);
    eq('the gate and the material grid ride all three', [shape.hq.awaitingComponents, shape.shopSibling.awaitingComponents, shape.finPayload.materialRows.length, shape.shopSibling.materialRows.length], [true, true, 1, 1]);
    eq('the RTG record is a sales record with no NetSuite anchor of its own', [shape.hq.orderType, shape.hq.orderClass, shape.hq.autoFlow, shape.hq.routeTo, 'nsWoId' in shape.hq, 'hqJobId' in shape.hq], ['sales', 'ORDER_ENTRY', true, 'FINISHING', false, false]);

    // a pole-only row keeps the pole stream on its finishing document, as the per-line route did
    const poleOnly = pairShapeOf({ group: groups[1], so: display, brand: 'ce', now: 1, inventory, woId: 'W', shopWoId: 'W-C' });
    eq('a pole-only group: the finishing document is a pole job, the shop half has the pole', [poleOnly.finPayload.partsList.length, poleOnly.finPayload.poles, poleOnly.finPayload.totalPoles, poleOnly.finPayload.finishStream, poleOnly.finPayload.paintSize, poleOnly.shopSibling.cutList.length], [0, { qty: 35, type: 'POLE' }, 35, 'POLES', null, 1]);
    // a small-parts-only group has no shop half
    const smallOnly = pairShapeOf({ group: groups[2], so: display, brand: 'ce', now: 1, inventory, woId: 'W2', shopWoId: 'W2-C' });
    eq('a small-parts-only group has no shop sibling and no custom flag', [smallOnly.shopSibling, smallOnly.finPayload.hasCustomSibling, smallOnly.finPayload.shopSiblingId], [null, false, null]);
}
console.log(`rowPair: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
