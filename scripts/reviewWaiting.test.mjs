// node scripts/reviewWaiting.test.mjs — the orders parked for a person's review, as RTG says them (Stuart 2026-10-12).
// The two orders are the two that were sitting in production that day.
import { reviewWaitingOf, waitedText } from '../src/components/Shared/reviewWaiting.js';
let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const DAY = 86400000, now = 100 * DAY;
const so60583 = { id: 'QS-1', soId: 'SO60583', customer: 'FABRICUT', status: 'Pending', lines: [{ erp: 'H1-75SR' }, { erp: 'H1-75SPF' }],
    oeAuto: { state: 'NEEDS_REVIEW', at: now - 22 * DAY, review: [{ lineIdx: 1, erp: 'H1-75SPF', finish: 'P06', reasons: ['55812 is not in the Master Library — sync it first'] }, { lineIdx: 0, erp: 'H1-75SR', finish: 'P06', reasons: ['H1-75SR is a bought item — the purchase is reviewed before anything is ordered'] }] } };
const so60812 = { id: 'QS-2', soId: 'SO60812', customer: 'READ WINDOW PRODUCTS, LLC', status: 'Pending', lines: [{ erp: 'HTAEC35' }, { erp: 'HRW-138TRAVLB' }, { erp: 'HRW-138TRAV12' }, { erp: 'H1-138TRV' }],
    oeAuto: { state: 'NEEDS_REVIEW', at: now - 12 * DAY, review: [{ lineIdx: 1, erp: 'HRW-138TRAVLB', finish: 'RF1', reasons: ['H2-138-TB3/P: 200 short (have 0 of 200) — sourcing it is a decision'] }, { lineIdx: 3, erp: 'H1-138TRV', finish: 'RF1', reasons: ['no cut length'] }, { lineIdx: 0, erp: 'HTAEC35', finish: 'RF1', reasons: ['ready — waits with HRW-138TRAVLB'] }] } };
const rows = reviewWaitingOf([so60812, so60583], { now });
eq('oldest first, with the days it has waited', rows.map(r => [r.ref, r.customer, r.days]), [['SO60583', 'FABRICUT', 22], ['SO60812', 'READ WINDOW PRODUCTS, LLC', 12]]);
eq('each line not started, in line order, with the reason the automatic start recorded', rows[0].lines.map(l => [l.lineIdx, l.erp, l.finish, l.reason.slice(0, 22)]), [[0, 'H1-75SR', 'P06', 'H1-75SR is a bought it'], [1, 'H1-75SPF', 'P06', '55812 is not in the Ma']]);
// Eric's Review & start on 10-11 stamped SO60812's three lines: nothing of it is waiting any more.
eq('a line that has since been started is not listed — and an order with none left is gone', reviewWaitingOf([{ ...so60812, oeGen: { 0: { kind: 'WO' }, 1: { kind: 'WO' }, 3: { kind: 'WO' } } }, so60583], { now }).map(r => r.ref), ['SO60583']);
eq('…one line started, the others still listed', reviewWaitingOf([{ ...so60812, oeGen: { 0: { kind: 'WO' } } }], { now })[0].lines.map(l => l.lineIdx), [1, 3]);
eq('a start that FAILED is listed with its error, lines or not', reviewWaitingOf([{ id: 'QS-3', soId: 'SO60999', status: 'Pending', lines: [], oeAuto: { state: 'FAILED', at: now, error: 'NetSuite unreachable', review: [] } }], { now }).map(r => [r.ref, r.state, r.error, r.days]), [['SO60999', 'FAILED', 'NetSuite unreachable', 0]]);
eq('closed, deleted, archived, done and running orders are not; a display order is worked from 10.5, never here',
    reviewWaitingOf([{ ...so60583, status: 'Closed' }, { ...so60583, deleted: true }, { ...so60583, rtgArchived: true }, { ...so60583, oeAuto: { ...so60583.oeAuto, state: 'DONE' } }, { ...so60583, oeAuto: { ...so60583.oeAuto, state: 'RUNNING' } }, { ...so60583, displayRelease: true }, { id: 'X', status: 'Pending' }, null], { now }), []);
eq('a review entry for a line no longer on the order is dropped', reviewWaitingOf([{ ...so60583, lines: [{ erp: 'H1-75SR' }] }], { now })[0].lines.map(l => l.lineIdx), [0]);
eq('in words', [waitedText(0), waitedText(1), waitedText(12)], ['today', '1 day', '12 days']);
console.log(`reviewWaiting: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
