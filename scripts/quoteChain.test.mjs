// Quote revisions and conversion, pinned (S7, 2026-10-16): the chain walk, the revision stamp, the lineage words,
// the converted patches for the whole chain, and what counts as archived.
import { chainOf, revisionStampOf, lineageWordsOf, convertedPatchesOf, fromQuoteStampOf, isQuoteArchived } from '../src/components/Shared/quoteChain.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const q1 = { id: 'QSQUOTE-1', jobId: 'QSQUOTE-1', status: 'SUPERSEDED', supersededBy: 'QSQUOTE-2' };
const q2 = { id: 'QSQUOTE-2', jobId: 'QSQUOTE-2', status: 'SUPERSEDED', supersedes: 'QSQUOTE-1', supersededBy: 'QSQUOTE-3', rootQuote: 'QSQUOTE-1', revision: 2 };
const q3 = { id: 'QSQUOTE-3', jobId: 'QSQUOTE-3', status: 'CONFIGURED', supersedes: 'QSQUOTE-2', rootQuote: 'QSQUOTE-1', revision: 3 };
const lone = { id: 'QSQUOTE-9', jobId: 'QSQUOTE-9', status: 'CONFIGURED' };
const jobs = [q3, lone, q1, q2];

ok('the chain from any member, root first', chainOf(jobs, 'QSQUOTE-2').map(j => j.id).join() === 'QSQUOTE-1,QSQUOTE-2,QSQUOTE-3' && chainOf(jobs, 'QSQUOTE-3')[0].id === 'QSQUOTE-1' && chainOf(jobs, 'QSQUOTE-1').length === 3);
ok('a lone quote is its own chain; an unknown id is nothing', chainOf(jobs, 'QSQUOTE-9').length === 1 && chainOf(jobs, 'nope').length === 0);
ok('a broken link (the next quote missing) stops cleanly', chainOf([q1], 'QSQUOTE-1').map(j => j.id).join() === 'QSQUOTE-1');
ok('the stamp for a new quote superseding the latest: the root and rev 4', JSON.stringify(revisionStampOf(q3, jobs)) === JSON.stringify({ rootQuote: 'QSQUOTE-1', revision: 4 }));
ok('…superseding a quote that never had a stamp: rev 2 with itself as the root', JSON.stringify(revisionStampOf(lone, jobs)) === JSON.stringify({ rootQuote: 'QSQUOTE-9', revision: 2 }) && revisionStampOf(null).revision === 1);
ok('lineage words: the live revision, the superseded one, a converted one', lineageWordsOf(q3, jobs) === 'Rev 3 · supersedes QSQUOTE-2' && lineageWordsOf(q1, jobs) === 'Superseded by QSQUOTE-2 — close its old NetSuite estimate by hand' && lineageWordsOf({ ...q3, status: 'CONVERTED', convertedToNo: 'SOUNIQ-4010' }, jobs) === 'Converted → SOUNIQ-4010 · Rev 3 · supersedes QSQUOTE-2' && lineageWordsOf(lone, jobs) === '');
ok('a revision with no stamp still counts its place in the chain', lineageWordsOf({ ...q2, revision: undefined, rootQuote: undefined }, jobs).startsWith('Superseded by QSQUOTE-3') && /Rev 2/.test(lineageWordsOf({ ...q2, revision: undefined, rootQuote: undefined }, jobs)));
const patches = convertedPatchesOf(chainOf(jobs, 'QSQUOTE-3'), { soId: 'QS-77', soNumber: 'SOUNIQ-4010', by: 'laetitia', at: 5 });
ok('converting closes every quote in the chain with the order on it', patches.map(p => p.id).join() === 'QSQUOTE-1,QSQUOTE-2,QSQUOTE-3' && patches.every(p => p.patch.status === 'CONVERTED' && p.patch.convertedTo === 'QS-77' && p.patch.convertedToNo === 'SOUNIQ-4010' && p.patch.convertedBy === 'laetitia' && p.patch.convertedAt === 5) && patches[2].patch.statusBeforeConverted === 'CONFIGURED');
ok('an already converted quote is not patched again', convertedPatchesOf([{ id: 'x', status: 'CONVERTED' }], { soId: 'y' }).length === 0);
ok('the order records the quote it came from and the chain', JSON.stringify(fromQuoteStampOf(chainOf(jobs, 'QSQUOTE-3'), 'QSQUOTE-3')) === JSON.stringify({ fromQuote: 'QSQUOTE-3', quoteChain: ['QSQUOTE-1', 'QSQUOTE-2', 'QSQUOTE-3'] }));
ok('archived: superseded and converted leave the active pipeline; configured stays', isQuoteArchived(q1) && isQuoteArchived({ status: 'CONVERTED' }) && isQuoteArchived({ status: 'CANCELLED' }) && !isQuoteArchived(q3) && !isQuoteArchived(null));

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
