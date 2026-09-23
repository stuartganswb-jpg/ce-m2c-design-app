// node scripts/stagingKey.test.mjs — the staging key is the work order (Stuart 2026-09-23).
import { stagingKeyOf, resolveStagingScan, stagingScanMatches, resolveByExactKey, legacyStagingKeysOf } from '../src/components/Shared/stagingKey.js';
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

console.log(`stagingKey: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
