// node scripts/stagingKey.test.mjs — the staging key is the work order (Stuart 2026-09-23).
import { stagingKeyOf, resolveStagingScan, stagingScanMatches, resolveByExactKey, legacyStagingKeysOf, shortPairKeyOf } from '../src/components/Shared/stagingKey.js';
import { pairIdsOf } from '../src/components/Shared/rowPairShape.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };

// two rows of one sales order — each its own finishing document, SAME sales-order key
const row1 = { id: 'WO-OE-H1-75SR-1790094694589-0', orderKey: 'SO-APP-ST0918-02', salesOrderId: 'SO-APP-ST0918-02', soNum: 'SO60565', currentPhase: 'Setup', hasCustomSibling: true };
const row2 = { id: 'WO-OE-H1-1R-1790094700000-1', orderKey: 'SO-APP-ST0918-02', salesOrderId: 'SO-APP-ST0918-02', soNum: 'SO60565', currentPhase: 'Setup', hasCustomSibling: true };
const closed = { id: 'WO-OE-OLD-1', orderKey: 'SO-APP-OLD', soNum: 'SO60001', currentPhase: 'Closed' };
const shopHalf = { id: 'SHOP-WO-OE-H1-75SR-1790094694589-0-C', woNum: 'SHOP-WO-OE-H1-75SR-1790094694589-0-C', finSiblingId: 'WO-OE-H1-75SR-1790094694589-0', orderKey: 'SO-APP-ST0918-02' };
const jobs = [row1, row2, closed];

eq('a finishing document\'s label barcodes its own id', stagingKeyOf(row1), 'WO-OE-H1-75SR-1790094694589-0');
eq('the shop half\'s label barcodes the SAME id — the pair\'s spine', stagingKeyOf(shopHalf), 'WO-OE-H1-75SR-1790094694589-0');
eq('a custom-only shop document (no finishing half) barcodes itself', stagingKeyOf({ id: 'SHOP-X', woNum: 'SHOP-X', orderKey: 'SO-APP-9' }), 'SHOP-X');
eq('a new label resolves to exactly its row, case and spacing aside', resolveStagingScan(jobs, ' wo-oe-h1-1r-1790094700000-1 ').job.id, row2.id);
eq('…and never to a closed document', resolveStagingScan(jobs, 'WO-OE-OLD-1').job, null);
const amb = resolveStagingScan(jobs, 'SO60565');
eq('an older label naming the sales order is AMBIGUOUS across the order\'s rows — nothing is guessed', [amb.job, amb.ambiguous.map(j => j.id), amb.legacy], [null, [row1.id, row2.id], true]);
eq('an older label that names exactly one open document still works, flagged legacy', (() => { const r = resolveStagingScan([row1, closed], 'SO60565'); return [r.job && r.job.id, r.legacy]; })(), [row1.id, true]);
eq('nothing matches → nothing, and not legacy', resolveStagingScan(jobs, 'NOPE'), { job: null, ambiguous: [], legacy: false });
eq('the older name returns the one document or null', [resolveByExactKey(jobs, row1.id) && resolveByExactKey(jobs, row1.id).id, resolveByExactKey(jobs, 'SO60565')], [row1.id, null]);
eq('the pack station\'s matcher: exact on the work order, tolerant on the older key', [stagingScanMatches(row1, row1.id), stagingScanMatches(row1, 'so60565'), stagingScanMatches(row1, row2.id)], [true, true, false]);
eq('the legacy keys a document may still be labelled with', legacyStagingKeysOf(row1), ['SO-APP-ST0918-02', 'SO-APP-ST0918-02', 'SO60565']);

// ── a LONG pair id scans as its short form (Stuart 2026-09-29, SO60551 at packing: "the orders still have long string barcodes") ──
const p14 = { id: 'WO-OE-SO60551-BACK-BASE-3-P14-1790621841166', soId: 'SO60551', orderKey: 'SO60551', currentPhase: 'Complete', hasCustomSibling: true };
const s08 = { id: 'WO-OE-SO60551-BACK-BASE-2-S08-1790629033765', soId: 'SO60551', orderKey: 'SO60551', currentPhase: 'Complete' };
const p14Shop = { id: 'WO-OE-SO60551-BACK-BASE-3-P14-1790621841166-C', finSiblingId: p14.id, orderKey: 'SO60551' };
eq('P14\'s 43-character id prints as the 18-character short form, the same shape a new pair\'s id has', [stagingKeyOf(p14), stagingKeyOf(p14).length, pairIdsOf({ soId: 'SO60551' }, {}, 1790621841166).woId], ['WO-OE-SO60551-1166', 18, 'WO-OE-SO60551-1166']);
eq('…and its shop half\'s label prints the SAME short key', stagingKeyOf(p14Shop), 'WO-OE-SO60551-1166');
eq('a start-now / PO tag keeps its letter, as the new ids do', [shortPairKeyOf('WO-OE-SO60551-ROW-1-EP4-1790621841166-NOW'), shortPairKeyOf('WO-OE-SO60551-ROW-1-EP4-1790621841166-PO')], ['WO-OE-SO60551-1166N', 'WO-OE-SO60551-1166P']);
eq('a new short id, and any other id, is left as it is', [shortPairKeyOf('WO-OE-SO60551-3765'), shortPairKeyOf(row1.id), stagingKeyOf(row1)], ['', '', row1.id]);
eq('the short label resolves to its document among the order\'s rows', resolveStagingScan([p14, s08, row1], 'wo-oe-so60551-1166').job.id, p14.id);
eq('the long label already on the parts still resolves', resolveStagingScan([p14, s08], p14.id).job.id, p14.id);
eq('the pack station\'s matcher takes both the short and the long label, and not another row\'s', [stagingScanMatches(p14, 'WO-OE-SO60551-1166'), stagingScanMatches(p14, p14.id), stagingScanMatches(p14, 'WO-OE-SO60551-3765')], [true, true, false]);
eq('another row\'s LONG label never passes this row\'s box (it contains the same sales order)', stagingScanMatches(p14, s08.id), false);
eq('…while an older label naming only the sales order still does', stagingScanMatches(p14, 'SO60551'), true);
const newPair = { id: 'WO-OE-SO60551-1166', soId: 'SO60551', currentPhase: 'Setup' };
const clash = resolveStagingScan([p14, newPair], 'WO-OE-SO60551-1166');
eq('a newer pair whose id equals an older one\'s short form: ambiguous, neither guessed', [clash.job, clash.ambiguous.map(j => j.id)], [null, [newPair.id, p14.id]]);
eq('two older documents sharing a short form: ambiguous', resolveStagingScan([p14, { ...s08, id: 'WO-OE-SO60551-ROW-2-P06-1790620001166' }], 'WO-OE-SO60551-1166').job, null);

// ── THE NETSUITE NUMBER ON THE CARD (2026-09-30, WO11578) ───────────────────────────────────
{
    const read = { id: 'WO-OE-HRW-138TRAVLB-1788201851904-0', nsWoTran: 'WO11578', nsWoId: '903546', orderKey: 'QS-1788201702363', salesOrderId: 'QS-1788201702363', soNum: 'SO60156', pickStatus: 'Picked_Awaiting_Staging', currentPhase: 'Setup' };
    const other = { id: 'WO-STK-62069-1790620067694', nsWoTran: 'WO11657', currentPhase: 'Setup' };
    eq('typing the NetSuite number the card shows finds the document', resolveStagingScan([read, other, ...jobs], 'wo11578').job.id, read.id);
    eq('…and it is an exact match, not a legacy guess', resolveStagingScan([read], 'WO11578').legacy, false);
    eq('the long id still resolves', resolveStagingScan([read], read.id).job.id, read.id);
    eq('the packing match accepts it too', [stagingScanMatches(read, 'WO11578'), stagingScanMatches(read, 'WO11657')], [true, false]);
    eq('another work order\'s number never passes this one', stagingScanMatches(other, 'WO11578'), false);
    const dup = resolveStagingScan([read, { ...other, nsWoTran: 'WO11578' }], 'WO11578');
    eq('two open documents on one NetSuite number: refused, neither guessed', [dup.job, dup.ambiguous.length], [null, 2]);
    eq('a closed document is not found by its number', resolveStagingScan([{ ...read, currentPhase: 'Closed' }], 'WO11578').job, null);
    eq('a document with no NetSuite number is unaffected', resolveStagingScan(jobs, 'WO11578').job, null);
}

console.log(`stagingKey: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
