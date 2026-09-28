// node scripts/rowPair.test.mjs — a row hits the floor as a production order does (Stuart 2026-09-23):
// grouped by row and finish, one pair per group, the pole the shop's, the small parts finishing's.
import { floorGroupsOf, splitGroupJobs, pairShapeOf, pairIdsOf, finishGroupsOf, holdSplitGroups, pairGroupKeyOf } from '../src/components/Shared/rowPairShape.js';
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
    eq('…is a sled job sized from its parts, one recipe, linked to its shop half, pick released at shop start', [shape.finPayload.recipe, shape.finPayload.paintSize, shape.finPayload.paintSizes, shape.finPayload.totalParts, shape.finPayload.shopSiblingId, shape.finPayload.hasCustomSibling, shape.finPayload.sentToPickPack, shape.finPayload.finishStream || null],
        ['P24', 'M', { S: 50, M: 100, L: 0 }, 200, `SHOP-${shopWoId}`, true, false, null]);
    // EACH PART ON ITS OWN RECIPE (Stuart 2026-09-28): the shop's pole is COUNTED on the finishing document, so the
    // floor runs it on the pole track (-P) while the small parts run the sled track (-S) — read with the floor's own
    // functions (Shared/floorActivity).
    {
        const FA = await import('../src/components/Shared/floorActivity.js');
        const fp = shape.finPayload;
        eq('…and counts the shop\'s pole: two tracks, poles on -P, small parts on -S', [fp.totalPoles, fp.poles && fp.poles.qty, FA.woHasPoles(fp), FA.woHasSmallParts(fp), FA.partsStreamOf(fp), FA.poleStreamOf(fp)], [50, 50, true, true, 'SMALL', 'POLES']);
        // GL5 (Stuart's screenshot): -S 4 coats for the small parts, -P 5 coats for the poles — which recipe each track runs.
        const { resolveStreamRecipe } = await import('../src/components/Shared/finishingTime.js');
        const recipes = [{ id: 'GL5', code: 'GL5', steps: [1, 2, 3, 4] }, { id: 'GL5-S', code: 'GL5-S', steps: [1, 2, 3, 4] }, { id: 'GL5-P', code: 'GL5-P', steps: [1, 2, 3, 4, 5] }];
        const gl5 = { ...fp, recipe: 'GL5' };
        const rOf = (stream) => { const r = resolveStreamRecipe(recipes, 'GL5', stream); return r && (r.code || r.id); };
        eq('GL5 on a mixed document: small parts run GL5-S (4 coats), poles GL5-P (5 coats)', [rOf(FA.partsStreamOf(gl5)), rOf(FA.poleStreamOf(gl5))], ['GL5-S', 'GL5-P']);
        const { docStreamsOf } = await import('../src/components/Shared/rowPairShape.js');
        const only = docStreamsOf({ parts: [], shopPoles: 20 });
        const onlyDoc = { ...only.fields, totalParts: only.totalParts };
        eq('poles alone: the pole stream only (no sled track to wait on)', [onlyDoc.finishStream, FA.woHasSmallParts(onlyDoc), rOf(FA.poleStreamOf(onlyDoc))], ['POLES', false, 'GL5-P']);
        const wood = docStreamsOf({ parts: [{ legacyErpId: 'H1-138WR-O', productType: 'POLE', quantity: 50 }, { legacyErpId: 'H1-138WGF-O', productType: 'FINIAL TOP', quantity: 50, paintSize: 'S' }], shopPoles: 0 });
        const woodDoc = { ...wood.fields, totalParts: wood.totalParts };
        eq('a straight wood rod on the parts list is a POLE (pole track); the finial is the sled\'s', [woodDoc.totalPoles, woodDoc.paintSizes, FA.partsStreamOf(woodDoc), FA.poleStreamOf(woodDoc), FA.woHasSmallParts(woodDoc)], [50, { S: 50, M: 0, L: 0 }, 'SMALL', 'POLES', true]);
        eq('small parts alone: the sled only, no pole track', (() => { const x = docStreamsOf({ parts: [{ productType: 'FINIAL', quantity: 10, paintSize: 'S' }] }); return [x.fields.totalPoles || 0, x.fields.finishStream || null]; })(), [0, null]);
    }
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

// ── THE CPQ SPLIT: ONE PAIR PER FINISH ──────────────────────────────────────────────────────
{
    const small = [{ name: 'Bracket', finishCode: 'P26' }, { name: 'Ring', finishCode: '' }, { name: 'Finial', finishCode: 'S03' }];
    const custom = [{ name: 'Oak rod', finishCode: 'S03', cutLength: 96 }];
    const g = finishGroupsOf({ smallLines: small, customLines: custom, finishOf: (l) => String(l.finishCode || '').toUpperCase() || 'P26' });
    eq('a wood pole stained beside metal painted is two pairs, sorted by finish, each suffixed', g.map(x => [x.finish, x.suffix, x.smallLines.length, x.customLines.length]), [['P26', '-P26', 2, 0], ['S03', '-S03', 1, 1]]);
    eq('a line naming no finish takes the order recipe', g[0].smallLines.map(l => l.name), ['Bracket', 'Ring']);
    const one = finishGroupsOf({ smallLines: small.slice(0, 2), customLines: [], finishOf: () => 'P26' });
    eq('a single-finish order keeps its ids exactly — no suffix', [one.length, one[0].suffix], [1, '']);
}
// A ROW'S FINISH STARTS AS ONE PAIR (Stuart 2026-09-27) — Back Base 3: H1-2RCTAR/P14 ready, H1-2RCTEC/P14
// short → RCTAR waits with it; another row, or another finish of the same row, is not held.
{
    const disp = { id: 'SO-D', displayRelease: true };
    const L = (erp, row) => ({ erp, row, qty: 50 });
    const rctar = { line: L('H1-2RCTAR', 'Back Base 3'), finish: 'P14', lineErp: 'H1-2RCTAR' };
    const bf4 = { line: L('H1-75R', 'base front 4'), finish: 'P30', lineErp: 'H1-75R' };
    const s08 = { line: L('H1-138WR-0', 'Back Base 2'), finish: 'S08', lineErp: 'H1-138WR-0' };
    const r = holdSplitGroups({
        ready: [rctar, bf4, s08],
        waiting: [{ line: L('H1-2RCTEC', 'Back Base 3'), finish: 'P14', erp: 'h1-2rctec' }, { line: L('H1-138WFCON2', 'Back Base 2'), finish: 'P04', erp: 'H1-138WFCON2' }],
        so: disp,
    });
    eq('a ready line waits with the short line of its row + finish', r.held.map(h => [h.job.lineErp, h.withErp]), [['H1-2RCTAR', 'H1-2RCTEC']]);
    eq('another row, and another finish of the same row, still start', r.start.map(j => j.lineErp), ['H1-75R', 'H1-138WR-0']);
    eq('nothing waiting → everything starts', holdSplitGroups({ ready: [rctar, bf4], waiting: [], so: disp }).start.length, 2);
    eq('the key is floorGroupsOf\'s: row label spelling does not matter', pairGroupKeyOf(L('X', 'Back  Base 3'), 'p14', disp), pairGroupKeyOf(L('Y', 'back base 3'), 'P14', disp));
    eq('an order not released by rows is ONE row — its finish group waits together', holdSplitGroups({ ready: [{ line: L('A', 'Row 1'), finish: 'P14' }], waiting: [{ line: L('B', 'Row 2'), finish: 'P14', erp: 'B' }], so: { id: 'SO-X' } }).held.length, 1);
    eq('a waiting line with no line record holds nothing it cannot name', holdSplitGroups({ ready: [rctar], waiting: [{ line: undefined, finish: '', erp: 'Z' }], so: disp }).start.length, 1);
    const fg = floorGroupsOf([rctar, { line: L('H1-2RCTEC', 'Back Base 3'), finish: 'P14' }], disp);
    eq('…and once decided, the two write ONE group', fg.length, 1);
}
// A PLATED GROUP NEVER ENTERS THE FINISHING FLOOR (Stuart 2026-09-27, SO60551 Base Front 3): the shape supports
// the CPQ split's pick lines (pickOnly) on a PICK-ONLY document born Complete. (The Order Entry route itself now
// sends a plated part in stock to the SO Pack card as a shelf pick — oeGen STOCK — so its pairs carry the pole only.)
{
    const display = { id: 'SO-APP-3', soId: 'SO60551', displayRelease: true, customer: 'Fabricut' };
    const rod = { id: 'r1', legacyErpId: 'H1-1R', itemName: '1" Rod', manufacturingSpecs: { productType: 'RODS' } };
    const fin = { id: 'f1', legacyErpId: 'H1-1BF/EP2', itemName: 'Ball Finial Polished Nickel', manufacturingSpecs: { productType: 'FINIALS', paintSize: 'S' } };
    const finial = { so: null, part: { legacyErpId: 'H1-1BF', itemName: 'Ball Finial' }, finish: 'EP2', qty: 50, line: { idx: 7, erp: 'H1-1BF', row: 'Base Front 3' }, lineIdx: 7, key: 7, stock: true,
        __planLines: [{ legacyErpId: 'H1-1BF/EP2', partName: 'Ball Finial Polished Nickel', quantity: 50, pickOnly: true, finishOutsourced: true }] };
    const pole = { so: null, part: rod, finish: 'EP2', qty: 50, line: { idx: 6, erp: 'H1-1R', row: 'Base Front 3', cutLength: 18 }, lineIdx: 6, key: 6, custom: true,
        __planLines: [{ legacyErpId: 'H1-1R', partName: '1" Rod', quantity: 50 }] };
    const g = floorGroupsOf([pole, finial], display);
    eq('the plated pole and the plated finial of one row are ONE group', g.map(x => [x.rowLabel, x.finish, x.jobs.length]), [['Base Front 3', 'EP2', 2]]);
    const sh = pairShapeOf({ group: g[0], so: display, brand: 'ce', now: 5, inventory: [rod, fin], woId: 'WP', shopWoId: 'WP-C' });
    eq('the finishing document is PICK-ONLY, born Complete, nothing for the finishing floor', [sh.finPayload.pickOnly, sh.finPayload.finishingRequired, sh.finPayload.currentPhase, sh.finPayload.stepStatus, sh.finPayload.totalParts, sh.finPayload.paintSize, 'poles' in sh.finPayload],
        [true, false, 'Complete', 'Complete', 0, null, false]);
    eq('…its line is the finished plated code, flagged a pick from stock', sh.finPayload.partsList.map(l => [l.legacyErpId, l.quantity, l.pickOnly, l.finishOutsourced]), [['H1-1BF/EP2', 50, true, true]]);
    {
        // A pair with NO shop half goes to the pick at once — no shop start will ever release it (SO60551 Back Base 2).
        const smallOnly = { key: '|P04|', rowKey: 'BACK_BASE_2', rowLabel: 'Back Base 2', finish: 'P04', tag: '', jobs: [{ line: { erp: 'H1-138WFCON2', qty: 50 }, lineIdx: 33, part: { legacyErpId: 'H1-138WFCON2', itemName: 'Connector', manufacturingSpecs: { productType: 'CONNECTOR' } }, finish: 'P04', qty: 50, custom: false, __planLines: [{ legacyErpId: 'H1-138WFCON2/P', quantity: 50 }] }] };
        const so1 = pairShapeOf({ group: smallOnly, so: display, brand: 'ce', createdBy: 't', now: 1, inventory, woId: 'W1', shopWoId: 'W1-C', tasks: {} });
        eq('a pair with no shop half is sent to the pick straight away (no shop start will release it)', [so1.finPayload.hasCustomSibling, so1.finPayload.sentToPickPack, so1.shopSibling], [false, true, null]);
    }
    eq('…linked to the shop half, the pick released when the shop starts', [sh.finPayload.hasCustomSibling, sh.finPayload.sentToPickPack, sh.shopSibling.recipe, sh.shopSibling.cutList.map(c => [c.legacyErpId, c.cutLength])], [true, false, 'EP2', [['H1-1R', 18]]]);
    eq('RTG still counts the pieces the pair handles', sh.hq.qty, 50);
    const onlyPole = pairShapeOf({ group: floorGroupsOf([pole], display)[0], so: display, brand: 'ce', now: 5, inventory: [rod], woId: 'WQ', shopWoId: 'WQ-C' });
    eq('a plated pole alone: a pick-only document with nothing to pick, no pole stream on the finishing floor', [onlyPole.finPayload.pickOnly, onlyPole.finPayload.partsList.length, 'finishStream' in onlyPole.finPayload], [true, 0, false]);
    const painted = pairShapeOf({ group: floorGroupsOf([{ ...pole, finish: 'P06' }], display)[0], so: display, brand: 'ce', now: 5, inventory: [rod], woId: 'WR', shopWoId: 'WR-C' });
    eq('a PAINTED pole alone is unchanged: the finishing floor paints it on the pole stream', [!!painted.finPayload.pickOnly, painted.finPayload.currentPhase, painted.finPayload.finishStream], [false, 'Setup', 'POLES']);
}
console.log(`rowPair: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
