// The Uniquity pick channel, pinned (S7, 2026-10-20): one block per order; TO PACK when every OK-to-ship line is in hand
// (shelf lines not held, pillows sewn), WAITING with the reason otherwise; a released partial packs as a shipment; the
// whole-order packed stamp.   node scripts/uniquityPickPack.test.mjs
import { channelOrderOf, channelRowsOf, channelLineOf, sewLineReadyOf, channelPackedPatchOf, channelLineWords } from '../src/components/Shared/uniquityPickPack.js';
import { shipAheadPatchOf, holdAllPatchOf, launchPatchOf } from '../src/components/Shared/launchBoard.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const throwL = { erp: 'Bell/10T', name: 'Bell throw', qty: 1, price: 95, total: 95 };
const pillowL = { erp: 'CUSTOM PILLOW', name: 'Custom Pillow 19x19', qty: 2, madeToOrder: 'SEW', pillow: { requestId: 'q' } };
const fabricL = { erp: 'Bell/10F', name: 'fabric', qty: 0.625, inKit: true, kitOf: 'pillow-q-0', hidden: true, noPack: true };
const feeL = { erp: 'RUSH', name: 'rush', qty: 1, isFee: true };
const qs = (so) => ({ orderClass: 'QUICKSHIP', brand: 'uniquity', nsInternalId: '956871', createdAt: 100, ...so });
const allShelf = qs({ id: 'QS-A', soId: 'SOUNIQ-1', customer: 'Katie', lines: [throwL, { ...throwL, erp: 'Bell/22T' }, feeL] });
const mixed = qs({ id: 'QS-B', soId: 'SOUNIQ-2', customer: 'Patina', createdAt: 50, lines: [throwL, pillowL, fabricL] });
const sewOpen = { id: 'WO-SEW-1', division: 'SEW', salesOrderId: 'QS-B', soLineIdxs: [1], currentPhase: 'Running' };
const sewDone = { ...sewOpen, currentPhase: 'Complete', completedAt: 5 };

ok('an all-shelf order is TO PACK with every real line, the fee left out', (() => { const r = channelOrderOf(allShelf); return r.stage === 'TO PACK' && r.pack.join() === '0,1' && r.lines[2].kind === 'FEE' && !r.partial && /every line in hand/.test(r.note); })());
ok('a mixed order with no decision WAITS for 12.7', (() => { const r = channelOrderOf(mixed, { sewDocs: [sewOpen] }); return r.stage === 'WAITING' && r.pack.length === 0 && /12.7 Launch to decide/.test(r.note) && /Stitch & Sew/.test(r.note); })());
const ahead = { ...mixed, ...shipAheadPatchOf(mixed, { by: 'office', at: 9 }) };
ok('ship ahead, pillow still sewing: the throw packs now as shipment 1, the pillow stays', (() => { const r = channelOrderOf(ahead, { sewDocs: [sewOpen] }); return r.stage === 'TO PACK' && r.pack.join() === '0' && r.partial && r.plan.n === 1 && r.waiting.length === 1 && r.waiting[0].why === 'at Stitch & Sew' && /shipment 1/.test(r.note); })());
ok('…pillow sewn too: the whole order packs at once, not a shipment', (() => { const r = channelOrderOf(ahead, { sewDocs: [sewDone] }); return r.stage === 'TO PACK' && r.pack.join() === '0,1' && !r.partial; })());
const held = { ...mixed, ...holdAllPatchOf(mixed, { by: 'office', at: 9 }) };
ok('hold until the pillows are sewn: nothing packs while sewing; once sewn, the held throw is still held — the pillow alone would be a shipment, and the block says what is held', (() => {
    const a = channelOrderOf(held, { sewDocs: [sewOpen] }), b = channelOrderOf(held, { sewDocs: [sewDone] });
    return a.stage === 'WAITING' && b.stage === 'TO PACK' && b.pack.join() === '1' && b.partial && b.waiting[0].why === 'held on 12.7 Launch';
})());
const after1 = { ...ahead, shippedQty: { 'BELL/10T': 1 }, shipments: { 1: { n: 1, id: 'QS-SHP-SOUNIQ-2-01', at: 9, by: 'u', codes: { 'BELL/10T': 1 } } } };
ok('after shipment 1 the throw reads shipped; the sewn pillow is the last pack, whole (no partial)', (() => { const r = channelOrderOf(after1, { sewDocs: [sewDone] }); return r.lines[0].shipped && r.pack.join() === '1' && !r.partial && r.shipments.length === 1 && channelLineWords(r.lines[0]) === 'shipped' && channelLineWords(r.lines[1]) === 'sewn — in hand'; })());
ok('a hand hold on a shelf line of an all-shelf order: the rest packs as a shipment, the held line stays', (() => { const r = channelOrderOf({ ...allShelf, ...launchPatchOf(allShelf, { lineIdxs: [1], state: 'HELD', by: 'o', at: 2 }) }); return r.stage === 'TO PACK' && r.pack.join() === '0' && r.partial && r.waiting[0].why === 'held on 12.7 Launch'; })());
ok('packed → the SHIP side; shipped / closed / a shipment child / NetSuite not yet accepted → off or waiting, with the reason', (() => {
    const packed = channelOrderOf({ ...allShelf, packStatus: 'Packed' }), shipped = channelOrderOf({ ...allShelf, status: 'Shipped' }), closed = channelOrderOf({ ...allShelf, closed: true });
    const child = channelOrderOf({ ...allShelf, id: 'QS-SHP-SOUNIQ-1-01', packMode: 'SHIPMENT', shipmentOf: 'QS-A', packStatus: 'Packed' });
    const ns = channelOrderOf({ ...allShelf, nsInternalId: '' }), ph = channelOrderOf({ ...allShelf, nsInternalId: '', status: 'HELD_PLACEHOLDER' });
    return packed.stage === 'SHIP' && shipped.stage === 'OFF' && closed.stage === 'OFF' && child.stage === 'OFF' && ns.stage === 'WAITING' && /NetSuite/.test(ns.note) && /quick-add/.test(ph.note);
})());
ok('a sewing document that names no lines still answers for the order; an open one says not ready', sewLineReadyOf(mixed, 1, [{ ...sewDone, soLineIdxs: undefined }]) && !sewLineReadyOf(mixed, 1, [{ ...sewOpen, soLineIdxs: undefined }]) && !sewLineReadyOf(mixed, 1, []));
ok('the lines read: a held shelf line, a pillow at the sewing floor, a quick-add', channelLineOf(held, throwL, 0).why === 'held on 12.7 Launch' && channelLineOf(mixed, pillowL, 1, { sewDocs: [sewOpen] }).why === 'at Stitch & Sew' && channelLineOf(mixed, { erp: 'TBD', name: 'x', qty: 1, placeholder: { description: 'x' } }, 5).kind === 'PLACEHOLDER');
const rows = channelRowsOf([allShelf, mixed, { ...allShelf, id: 'QS-C', status: 'Shipped' }, { ...allShelf, id: 'QS-D', brand: 'ce' }], { sewDocs: [sewOpen] });
ok('the rows: this brand only, shipped left out, TO PACK first then oldest first', rows.map(r => `${r.so.id}:${r.stage}`).join() === 'QS-A:TO PACK,QS-B:WAITING');
const refused = { ...allShelf, nsInternalId: '', nsRefused: { salesorder: { error: 'Invalid customer' } } };
ok('a refused order is TO PACK, says NetSuite refused it, and is held at shipping once packed', (() => { const r = channelOrderOf(refused); const p = channelOrderOf({ ...refused, packStatus: 'Packed', shipHold: { rule: 'NO_SO', why: 'no order yet' } }); return r.stage === 'TO PACK' && r.nsRefused && /NetSuite refused the order \(Invalid customer\)/.test(r.note) && p.stage === 'SHIP' && /waiting for NetSuite/.test(p.note); })());
const patch = channelPackedPatchOf(allShelf, [0, 1], { by: 'ashley', now: 7 });
ok('the packed stamp: what the WMS writes, every packed line ticked, from this channel', patch.packStatus === 'Packed' && patch.status === 'Picked' && patch.packedBy === 'ashley' && patch.packedLines.L0.qty === 1 && patch.packedLines.L1.by === 'ashley' && patch.packedFrom === 'UNIQ_PICKPACK' && JSON.stringify(patch.packBoxes) === '{}');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
