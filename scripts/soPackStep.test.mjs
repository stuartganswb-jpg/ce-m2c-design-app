// 🧪 Step 2 — a CPQ order is boxed and packed on SO Pack (Stuart 2026-10-17).   node scripts/soPackStep.test.mjs
import { PACK_STAGE, awaitsOrderPack, orderPackedOnSoPack, orderAwaitsPackOf, orderPackBlockerOf, orderPackedPatchOf, docOrderPackedPatchOf } from '../src/components/Shared/soPackStep.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n}\n    got  ${JSON.stringify(a)}\n    want ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

const line = (key, erp, qty) => ({ key, erp, name: erp, qty });
const L = { A: [line('a1', 'H1-138BR', 4), line('a2', 'H1-138FN', 2)], B: [line('b1', 'H1-138P8', 2)] };
const linesOf = (d) => L[d.id] || [];
const refOf = (d) => `WO-${d.id}`;
const tick = (qty, boxes) => ({ at: 1, by: 'Andrea', qty, ...(boxes ? { boxes } : {}) });
const pkgA = { id: 'A', packStatus: 'Packed', packStage: PACK_STAGE.PACKAGED, packedLines: { a1: tick(4), a2: tick(2) } };
const pkgB = { id: 'B', packStatus: 'Packed', packStage: PACK_STAGE.PACKAGED, packedLines: { b1: tick(2) } };
const so = { id: 'SO-APP-QUOTE-1', soId: 'SO-APP-QUOTE-1' };

ok('a document packaged at Prep awaits its order', awaitsOrderPack(pkgA));
ok('a document packed the old way (no stage) does not', !awaitsOrderPack({ packStatus: 'Packed' }));
ok('nor does one the order has packed', !awaitsOrderPack({ ...pkgA, packStage: PACK_STAGE.ORDER_PACKED }));
ok('nor an unpacked one that somehow carries the stage', !awaitsOrderPack({ packStage: PACK_STAGE.PACKAGED, packStatus: 'Packing' }));
ok('the order is packed on SO Pack when its sales order says so', orderPackedOnSoPack({ packStatus: 'Packed' }) && !orderPackedOnSoPack(so) && !orderPackedOnSoPack(null));

ok('every work order packaged → the order waits to be boxed', orderAwaitsPackOf(so, [pkgA, pkgB]));
ok('one still on the floor → not yet', !orderAwaitsPackOf(so, [pkgA, { id: 'B', packStatus: '' }]));
ok('a closed or deleted work order does not hold it back', orderAwaitsPackOf(so, [pkgA, { id: 'C', currentPhase: 'Closed' }, { id: 'D', deleted: true }]));
ok('every work order packed the old way → nothing to box here', !orderAwaitsPackOf(so, [{ id: 'A', packStatus: 'Packed' }]));
ok('a mix (one old, one packaged) → boxed here', orderAwaitsPackOf(so, [{ id: 'A', packStatus: 'Packed' }, pkgB]));
ok('an order already packed → not again', !orderAwaitsPackOf({ ...so, packStatus: 'Packed' }, [pkgA, pkgB]));
ok('no work orders → nothing', !orderAwaitsPackOf(so, []));

const block = (o, docs, mine = true) => orderPackBlockerOf({ so: o, docs, linesOf, refOf, mine });
eq('no sales order', block(null, [pkgA]), 'no sales order on file for this order');
eq('already packed', block({ ...so, packStatus: 'Packed' }, [pkgA]), 'this order is already packed');
eq('a work order not packaged yet is named', block(so, [pkgA, { id: 'B', packStatus: '' }]), '1 work order is not packaged at Packaging Prep yet (WO-B)');
ok('packed the old way → said, not asked', /before boxing moved here/.test(block(so, [{ id: 'A', packStatus: 'Packed' }])));
eq('not yours → start packing first', block(so, [pkgA, pkgB], false), 'press START PACKING first — this order is not yours yet');
eq('pieces in no box are counted and named', block(so, [pkgA, pkgB]), '3 packed lines are not in a box yet (H1-138BR, H1-138FN, H1-138P8) — open a box and put them in');
const boxedA = { ...pkgA, packedLines: { a1: tick(4, [{ no: 1, qty: 4 }]), a2: tick(2, [{ no: 1, qty: 1 }, { no: 2, qty: 1 }]) } };
const boxedB = { ...pkgB, packedLines: { b1: tick(2, [{ no: 2, qty: 2 }]) } };
eq('a split line counts as boxed only when every piece is', block(so, [{ ...boxedA, packedLines: { ...boxedA.packedLines, a2: tick(2, [{ no: 1, qty: 1 }]) } }, boxedB]), '1 packed line is not in a box yet (H1-138FN) — open a box and put them in');
eq('every piece boxed, no photo → the photo of the closed boxes', block(so, [boxedA, boxedB]), 'take a photo of the closed boxes (📷 Add Photo)');
eq('boxed and photographed → nothing stands in the way', block({ ...so, packPhotos: ['u'] }, [boxedA, boxedB]), '');
eq('an old-way document already boxed sits beside a packaged one', block({ ...so, packPhotos: ['u'] }, [{ ...boxedA, packStage: undefined }, boxedB]), '');
ok('riders are packed with their pole, never asked to be boxed', block({ ...so, packPhotos: ['u'] }, [boxedA, { ...boxedB, id: 'B' }]) === '' && orderPackBlockerOf({ so: { ...so, packPhotos: ['u'] }, docs: [boxedA], linesOf: (d) => [...linesOf(d), { key: 'r1', erp: 'FEE-H1-MR', qty: 2, rider: true }], refOf, mine: true }) === '');

eq('the sales order\'s stamp', orderPackedPatchOf({ by: 'Eric', at: 5 }), { packStatus: 'Packed', packedAt: 5, packedBy: 'Eric', packInProgress: null });
eq('each document\'s stamp, with its box types', docOrderPackedPatchOf({ by: 'Eric', at: 5, packBoxes: { SMALL: 'A', POLE: '' } }), { packStage: 'ORDER_PACKED', orderPackedAt: 5, orderPackedBy: 'Eric', packBoxes: { SMALL: 'A', POLE: '' } });
eq('no name → Packer', orderPackedPatchOf({ at: 1 }).packedBy, 'Packer');

console.log(`soPackStep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
