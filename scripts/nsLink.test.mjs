// Link an app quote to the sales order already in NetSuite — offline.
//   node scripts/nsLink.test.mjs
// Stuart 2026-10-16: "go with option 2". The three orders are the ones M2C entered in NetSuite by hand while the app
// refused them (9/12–10/14): Laprade SOM2C-1038, Cresthaven SOM2C-1035, Dahle Barn SOM2C-1033 — as NetSuite read that day.
import { nsSoLookupSql, nsSoOf, boardSoIdOf, linkRefusalOf, linkPatchesOf, linkConfirmText } from '../src/components/Shared/nsLink.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

const laprade = { id: 'QUOTE-1791291125531', jobId: 'QUOTE-1791291125531', quoteNo: 'SI100626-01', status: 'CONFIGURED', sidemark: 'Laprade (NSB) - Bed 1', customer: { id: 'CUST-737', name: 'Brianna Michelle Int Design' } };
const cresthaven = { id: 'QUOTE-1789390262015', jobId: 'QUOTE-1789390262015', status: 'APPROVED', sidemark: 'CRESTHAVEN / Rod - Great Room Window H', customer: { id: 'CUST-7946', name: 'Michele Dunker Interior Design' } };
const so1038 = nsSoOf([{ id: '943260', tranid: 'SOM2C-1038', ttype: 'SalesOrd', status: 'B', entity: '737', cust: 'M2CB004 Brianna Michelle Int Design', subsidiary: '3', jobid: null, total: '1018', trandate: '10/5/2026', memo: 'Laprade (NSB) - Bed 1' }]);
const so1035 = nsSoOf([{ id: '916687', tranid: 'SOM2C-1035', status: 'B', entity: '7946', cust: '1078 Michele Dunker Interior Design', subsidiary: '3', total: '2356', trandate: '9/16/2026' }]);

// ── the read ──
ok('the read: one sales order by its number, upper-cased', /UPPER\(t\.tranid\) = 'SOM2C-1038' AND t\.type = 'SalesOrd'$/.test(nsSoLookupSql(' som2c-1038 ')));
eq('a number that is not one reads nothing', [nsSoLookupSql(''), nsSoLookupSql("SO'; DROP"), nsSoLookupSql('a b')], ['', '', '']);
eq('the row', so1038, { id: '943260', tranid: 'SOM2C-1038', status: 'B', entity: '737', customer: 'M2CB004 Brianna Michelle Int Design', subsidiary: '3', jobId: '', total: 1018, date: '10/5/2026', memo: 'Laprade (NSB) - Bed 1' });
eq('no row → none', [nsSoOf([]), nsSoOf(null), nsSoOf([{ id: '' }])], [null, null, null]);
eq('a status written with its record type reads by its letter', nsSoOf([{ id: '1', status: 'SalesOrd:B' }]).status, 'B');
eq('the RTG card is the one CPQ and the CRM write', [boardSoIdOf(laprade), boardSoIdOf(cresthaven)], ['SO-APP-SI100626-01', 'SO-APP-QUOTE-1789390262015']);

// ── may it be linked ──
eq('Laprade → SOM2C-1038: same customer, same division, still to be made', linkRefusalOf({ job: laprade, so: so1038, brand: 'm2c' }), '');
eq('Cresthaven → SOM2C-1035', linkRefusalOf({ job: cresthaven, so: so1035, brand: 'm2c' }), '');
eq('a number NetSuite does not have', linkRefusalOf({ job: laprade, so: null, typed: 'SOM2C-9999', brand: 'm2c' }), 'NetSuite has no sales order "SOM2C-9999" — check the number (e.g. SOM2C-1038).');
eq('another customer\'s order', linkRefusalOf({ job: laprade, so: so1035, brand: 'm2c' }), 'SOM2C-1035 is for 1078 Michele Dunker Interior Design; this quote is for Brianna Michelle Int Design.');
eq('another division\'s order', linkRefusalOf({ job: laprade, so: { ...so1038, subsidiary: '2' }, brand: 'm2c' }), 'SOM2C-1038 belongs to another division (subsidiary 2, this board is 3).');
eq('an order that has shipped — SOM2C-1018 was F', linkRefusalOf({ job: laprade, so: { ...so1038, status: 'F' }, brand: 'm2c' }), 'SOM2C-1038 has already shipped or closed in NetSuite (status F) — linking it would send the work to the floor a second time.');
ok('…partly shipped, billed, closed or cancelled too', ['D', 'E', 'G', 'H', 'C'].every(s => /already shipped or closed/.test(linkRefusalOf({ job: laprade, so: { ...so1038, status: s }, brand: 'm2c' }))));
eq('pending approval may be linked', linkRefusalOf({ job: laprade, so: { ...so1038, status: 'A' }, brand: 'm2c' }), '');
eq('already linked to another quote', linkRefusalOf({ job: laprade, so: { ...so1038, jobId: 'QUOTE-1' }, brand: 'm2c' }), 'SOM2C-1038 is already linked to another app quote (QUOTE-1).');
eq('…to this one is fine (a second press)', linkRefusalOf({ job: laprade, so: { ...so1038, jobId: 'QUOTE-1791291125531' }, brand: 'm2c' }), '');
eq('the quote already has another NetSuite order', linkRefusalOf({ job: { ...laprade, netsuiteSalesOrderId: '5', netsuiteSalesOrderNo: 'SOM2C-1000' }, so: so1038, brand: 'm2c' }), 'This quote is already linked to NetSuite sales order SOM2C-1000.');
eq('already on RTG as another card', linkRefusalOf({ job: laprade, so: so1038, brand: 'm2c', boardHolders: ['SO-SOM2C-1038'] }), 'SOM2C-1038 is already on RTG as SO-SOM2C-1038.');
eq('…its own card carrying it is fine', linkRefusalOf({ job: laprade, so: so1038, brand: 'm2c', boardHolders: ['SO-APP-SI100626-01'] }), '');
eq('a quote with no NetSuite customer cannot be matched', linkRefusalOf({ job: { ...laprade, customer: { name: 'X' } }, so: so1038, brand: 'm2c' }), 'SOM2C-1038 is for M2CB004 Brianna Michelle Int Design; this quote is for X.');
eq('an unknown division', linkRefusalOf({ job: laprade, so: so1038, brand: 'zzz' }), 'No NetSuite subsidiary on file for division "zzz".');

// ── what it writes ──
const p = linkPatchesOf({ job: laprade, so: so1038, by: 'stuart', at: 5 });
eq('a quote still a quote becomes approved, with the order it was linked to', p.jobPatch, { netsuiteSalesOrderId: '943260', netsuiteSalesOrderNo: 'SOM2C-1038', status: 'APPROVED', nsLinkedExisting: { tranid: 'SOM2C-1038', id: '943260', at: 5, by: 'stuart', wasStatus: 'CONFIGURED' } });
eq('…its RTG card carries the NetSuite id and number', [p.boardId, p.boardPatch], ['SO-APP-SI100626-01', { nsInternalId: '943260', soId: 'SOM2C-1038', nsLinkedExistingAt: 5, nsLinkedExistingBy: 'stuart' }]);
eq('…and NetSuite is stamped with the quote', p.nsPatch, { custbody50: 'QUOTE-1791291125531' });
ok('an approved quote keeps its status', !('status' in linkPatchesOf({ job: cresthaven, so: so1035 }).jobPatch));

// ── what the person reads ──
const t = linkConfirmText({ job: laprade, so: so1038, quoteTotal: 768, autoReleaseOn: true });
ok('the confirm names both, the difference, that nothing new is made, and what happens next',
    /^🔗 Link SI100626-01 to SOM2C-1038\?/.test(t) && /NetSuite SOM2C-1038 · M2CB004 Brianna Michelle Int Design · pending fulfilment · \$1018\.00/.test(t) && /App quote SI100626-01 · Brianna Michelle Int Design · \$768\.00/.test(t)
    && /⚠ The totals differ by \$250\.00/.test(t) && /No new NetSuite order is created/.test(t) && /RTG releases it to the floors/.test(t));
ok('the same totals say nothing about a difference', !/differ/.test(linkConfirmText({ job: laprade, so: { ...so1038, total: 768 }, quoteTotal: 768 })));
ok('automatic release off is said', /automatic release is OFF/.test(linkConfirmText({ job: laprade, so: so1038, quoteTotal: 1018, autoReleaseOn: false })));

console.log(`nsLink: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
