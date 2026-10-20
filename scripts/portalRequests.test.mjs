// Shared/portalRequests — the one reading of "a portal request waiting for us, and is it new" (CRM panel + HQ's tab *).
// Run: node scripts/portalRequests.test.mjs
import { isPortalRequest, isUnopened, portalRequestsOf, requestKindOf, requestSummaryOf, requestTotalOf, openedPatchOf } from '../src/components/Shared/portalRequests.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`✗ ${name} ${extra}`); } };

const req = (id, extra = {}) => ({ id, status: 'PORTAL_REQUEST', brandId: 'ce', portalRequest: { kind: 'CONFIG', lines: [{}] }, ...extra });

// what is a request, and what is new
ok('a PORTAL_REQUEST job is a request', isPortalRequest(req('a')));
ok('a priced quote is not', !isPortalRequest({ status: 'CONFIGURED' }) && !isPortalRequest(null));
ok('a request nobody opened is new', isUnopened(req('a')));
ok('an opened request is not new', !isUnopened(req('a', { portalRequest: { kind: 'CONFIG', openedAt: '2026-10-20T10:00:00Z' } })));
ok('a request taken on (status moved) is neither', !isUnopened({ ...req('a'), status: 'QUICKSHIP_REVIEW' }));

// the brand's list, newest first, brand-less ones included, other brands' left out
const jobs = [
  req('old', { createdAt: { seconds: 100 } }),
  req('new', { createdAt: { seconds: 300 } }),
  req('nobrand', { brandId: null, dateSaved: '1970-01-01T00:03:20Z' }),     // 200 s
  req('m2c', { brandId: 'm2c', createdAt: { seconds: 400 } }),
  { id: 'quote', status: 'CONFIGURED', brandId: 'ce', createdAt: { seconds: 500 } },
];
const list = portalRequestsOf(jobs, 'ce');
ok('the brand\'s requests and the brand-less ones, newest first', JSON.stringify(list.map((j) => j.id)) === JSON.stringify(['new', 'nobrand', 'old']), JSON.stringify(list.map((j) => j.id)));
ok('another brand\'s request is left out', !list.some((j) => j.id === 'm2c'));
ok('no jobs, no list', portalRequestsOf(undefined, 'ce').length === 0);

// words
ok('the door: Quick Ship or Configured', requestKindOf(req('q', { portalRequest: { kind: 'QUICKSHIP' } })) === 'Quick Ship' && requestKindOf(req('c')) === 'Configured' && requestKindOf({ status: 'PORTAL_REQUEST' }) === 'Configured');
ok('a stock request says its lines and kits', requestSummaryOf(req('q', { portalRequest: { kind: 'QUICKSHIP', lines: [{}, {}], traverse: [{}] } })) === '2 stock lines · 1 traverse kit');
ok('a kit-only request says its kits', requestSummaryOf(req('q', { portalRequest: { kind: 'QUICKSHIP', lines: [], traverse: [{}, {}] } })) === '2 traverse kits');
ok('one stock line, singular', requestSummaryOf(req('q', { portalRequest: { kind: 'QUICKSHIP', lines: [{}] } })) === '1 stock line');
ok('a configured request says its configurations', requestSummaryOf(req('c', { portalRequest: { kind: 'CONFIG', lines: [{}, {}, {}] } })) === '3 configurations');
ok('an old single-configuration request says one', requestSummaryOf(req('c', { portalRequest: { selections: { a: 1 } } })) === '1 configuration');

// totals
ok('the request\'s own total', requestTotalOf(req('q', { portalRequest: { kind: 'QUICKSHIP', total: 468 } })) === 468);
ok('else the priced configuration\'s', requestTotalOf(req('c', { cpqData: { totalPrice: 1234.5 } })) === 1234.5);
ok('no money, no total', requestTotalOf(req('c')) === null && requestTotalOf(req('c', { portalRequest: { total: 0 } })) === null);

// the stamp
const p = openedPatchOf('Grace', '2026-10-20T12:00:00Z');
ok('the first opening is two field paths and nothing else', JSON.stringify(p) === JSON.stringify({ 'portalRequest.openedAt': '2026-10-20T12:00:00Z', 'portalRequest.openedBy': 'Grace' }));
ok('nobody named is "staff"', openedPatchOf('').hasOwnProperty('portalRequest.openedBy') && openedPatchOf('')['portalRequest.openedBy'] === 'staff');
ok('it is dated now when no time is given', !Number.isNaN(Date.parse(openedPatchOf('x')['portalRequest.openedAt'])));

console.log(`portalRequests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
