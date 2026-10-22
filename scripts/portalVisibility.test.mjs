// functions/portalVisibility — who on a portal account sees which quotes and orders (Stuart 2026-10-22: "limit that for now to only
// orders and quotes that the user configured via the portal (team member). then team lead can see all their team members quotes and
// orders grouped by the member. Leave regional member access alone now till i get further clarity" · "go with recommendations").
//   node scripts/portalVisibility.test.mjs
// Both doors (CLAUDE.md rule 5): a CPQ-priced request is the request's own record; an Order Entry-priced request is a NEW quote that
// takes its sender through Shared/quoteChain.portalSenderStampOf — the server must attribute both, and the orders made from them.
import { createRequire } from 'node:module';
import { portalSenderStampOf, revisionStampOf, fromQuoteStampOf, lineageWordsOf } from '../src/components/Shared/quoteChain.js';
const V = createRequire(import.meta.url)('../functions/portalVisibility.js');

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// ── the account: department EAST (lead Lena, members Mia + Max), WEST (member Wes), a regional manager, a login with no team entry
const team = [
    { email: 'lena@fab.com', name: 'Lena Lead', role: 'LEAD', department: 'EAST', departments: [] },
    { email: 'mia@fab.com', name: 'Mia', role: 'MEMBER', department: 'EAST', departments: [] },
    { email: 'Max@Fab.com', name: '', role: 'MEMBER', department: 'EAST', departments: [] },
    { email: 'wes@fab.com', name: 'Wes', role: 'MEMBER', department: 'WEST', departments: [] },
    { email: 'rita@fab.com', name: 'Rita', role: 'REGIONAL', department: '', departments: ['EAST', 'WEST'] },
    { email: 'lonely@fab.com', name: 'Lonely Lead', role: 'LEAD', department: '', departments: [] },
];
const portal = (email, name) => ({ name, email, via: 'PORTAL' });

// ── 1. the view ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
eq('a Team Member sees what they sent', [V.viewOf({ email: 'mia@fab.com', team }).role, [...V.viewOf({ email: 'mia@fab.com', team }).circle]], ['MEMBER', ['mia@fab.com']]);
eq('…matched by email whatever its case', V.viewOf({ email: 'MIA@FAB.COM', team }).role, 'MEMBER');
const lena = V.viewOf({ email: 'lena@fab.com', team });
eq('a Team Lead sees their department — themselves first, then by name (no name = their email)', [lena.role, lena.people.map(p => [p.name, p.you])], ['LEAD', [['Lena Lead', true], ['max@fab.com', false], ['Mia', false]]]);
ok('…not another department, not the regional manager', !lena.circle.has('wes@fab.com') && !lena.circle.has('rita@fab.com'));
eq('a Regional Manager: the whole account, as before (left alone)', V.viewOf({ email: 'rita@fab.com', team }).role, 'ALL');
eq('a login with no team entry: the whole account, as before', [V.viewOf({ email: 'stuart@fab.com', team }).role, V.viewOf({ email: 'x@y.com', team: undefined }).role, V.viewOf({}).role], ['ALL', 'ALL', 'ALL']);
eq('a lead with no department sees their own only', [...V.viewOf({ email: 'lonely@fab.com', team }).circle], ['lonely@fab.com']);
eq('what the portal is told: the role and a lead\'s people — never an email', [V.publicViewOf(lena), V.publicViewOf(V.viewOf({ email: 'mia@fab.com', team })), V.publicViewOf(null)],
    [{ role: 'LEAD', people: [{ key: 'p0', name: 'Lena Lead', you: true }, { key: 'p1', name: 'max@fab.com', you: false }, { key: 'p2', name: 'Mia', you: false }] }, { role: 'MEMBER' }, { role: 'ALL' }]);

// ── 2. who sent a quote — both doors ─────────────────────────────────────────────────────────────────────────────────────────
// CPQ door: the portal Configure request, priced in CPQ in its own record (createdBy survives; author is the pricer)
const cpqReq = { id: 'MI102226-01', jobId: 'MI102226-01', source: 'PORTAL', status: 'CONFIGURED', createdBy: portal('mia@fab.com', 'Mia'), author: 'Stuart', portalRequest: { kind: 'CONFIG', byEmail: 'mia@fab.com' }, cpqData: { breakdown: [{ name: 'Rod' }] } };
// Order Entry door: Max's Quick Ship request, loaded in tab 7 and saved as a quote → QSQUOTE-A supersedes it; reopened and saved again → QSQUOTE-B
const oeReq = { id: 'MA102226-01', jobId: 'MA102226-01', quoteNo: 'MA102226-01', source: 'PORTAL', status: 'SUPERSEDED', supersededBy: 'QSQUOTE-A', createdBy: portal('max@fab.com', 'Max'), portalRequest: { kind: 'QUICKSHIP', byEmail: 'max@fab.com' } };
const qsA = { id: 'QSQUOTE-A', jobId: 'QSQUOTE-A', source: 'QUICKSHIP', status: 'SUPERSEDED', supersededBy: 'QSQUOTE-B', createdBy: portalSenderStampOf(oeReq), author: 'Stuart', supersedes: 'MA102226-01', ...revisionStampOf(oeReq, []) };
const qsB = { id: 'QSQUOTE-B', jobId: 'QSQUOTE-B', source: 'QUICKSHIP', status: 'CONFIGURED', createdBy: { name: 'Stuart', via: 'QUICKSHIP' }, supersedes: 'QSQUOTE-A', ...revisionStampOf(qsA, [oeReq]) };
// an older request with no createdBy; a quote the team built; a team revision of a team quote
const oldReq = { id: 'OLD-1', jobId: 'OLD-1', status: 'PORTAL_REQUEST', portalRequest: { kind: 'QUICKSHIP', byEmail: 'Wes@fab.com' } };
const staffCpq = { id: 'QUOTE-9', jobId: 'QUOTE-9', status: 'CONFIGURED', createdBy: { name: 'Stuart', via: 'CPQ' } };
const staffQs = { id: 'QSQUOTE-S1', jobId: 'QSQUOTE-S1', source: 'QUICKSHIP', status: 'SUPERSEDED', supersededBy: 'QSQUOTE-S2', createdBy: { name: 'Eric', via: 'QUICKSHIP' } };
const staffQs2 = { id: 'QSQUOTE-S2', jobId: 'QSQUOTE-S2', source: 'QUICKSHIP', createdBy: { name: 'Eric', via: 'QUICKSHIP' }, supersedes: 'QSQUOTE-S1', ...revisionStampOf(staffQs, []) };
const jobs = [cpqReq, oeReq, qsA, qsB, oldReq, staffCpq, staffQs, staffQs2];
const jobOf = V.jobIndexOf(jobs);
eq('the sender of each quote', jobs.map(j => [j.id, V.senderOfJob(j, jobOf)]), [
    ['MI102226-01', 'mia@fab.com'],   // CPQ door: the request's own record
    ['MA102226-01', 'max@fab.com'],
    ['QSQUOTE-A', 'max@fab.com'],     // Order Entry door: the quote that priced it took its sender
    ['QSQUOTE-B', 'max@fab.com'],     // …and a revision of it reads the chain's root
    ['OLD-1', 'wes@fab.com'],         // older request: portalRequest.byEmail
    ['QUOTE-9', ''], ['QSQUOTE-S1', ''], ['QSQUOTE-S2', ''],   // the team's own: nobody sent them from the portal
]);
eq('the quote Order Entry prices a request as carries the request\'s sender as its creator', qsA.createdBy, { name: 'Max', email: 'max@fab.com', via: 'PORTAL' });

// ── 3. who sent an order — both doors ────────────────────────────────────────────────────────────────────────────────────────
const sos = [
    { id: 'SO-APP-MI102226-01', hqJobId: 'MI102226-01' },                                        // CPQ door: names its job
    { id: 'QS-1', source: 'QUICKSHIP', ...fromQuoteStampOf([qsA, qsB], 'QSQUOTE-B') },            // OE: from the revision
    { id: 'QS-2', source: 'QUICKSHIP', ...fromQuoteStampOf([oldReq], 'OLD-1') },                  // OE: straight from a loaded request
    { id: 'QS-3', source: 'QUICKSHIP', customerId: 'CUST-F' },                                     // OE: a counter sale — no quote
    { id: 'SO-APP-QUOTE-9', hqJobId: 'QUOTE-9' },                                                  // CPQ: the team's quote
    { id: 'QS-4', source: 'QUICKSHIP', quoteChain: ['ZZZ', 'MA102226-01'] },                       // only the chain names it
];
eq('the sender of each order', sos.map(so => [so.id, V.senderOfOrder(so, jobOf)]),
    [['SO-APP-MI102226-01', 'mia@fab.com'], ['QS-1', 'max@fab.com'], ['QS-2', 'wes@fab.com'], ['QS-3', ''], ['SO-APP-QUOTE-9', ''], ['QS-4', 'max@fab.com']]);
eq('…an order that names only the quote it came from', V.senderOfOrder({ id: 'QS-5', fromQuote: 'OLD-1' }, jobOf), 'wes@fab.com');

// ── 4. the page each login gets (the filter portalMyOrders runs) ─────────────────────────────────────────────────────────────
const pageOf = (email) => {
    const view = V.viewOf({ email, team });
    const live = jobs.filter(j => !/^(SUPERSEDED|CONVERTED)$/.test(j.status || ''));
    return {
        quotes: live.map(j => ({ j, s: V.senderOfJob(j, jobOf) })).filter(x => V.sees(view, x.s)).map(({ j, s }) => view.role === 'LEAD' ? `${j.id}@${V.personKeyOf(view, s)}` : j.id),
        orders: sos.map(so => ({ so, s: V.senderOfOrder(so, jobOf) })).filter(x => V.sees(view, x.s)).map(({ so, s }) => view.role === 'LEAD' ? `${so.id}@${V.personKeyOf(view, s)}` : so.id),
    };
};
eq('Mia (member) sees her own quote and order', pageOf('mia@fab.com'), { quotes: ['MI102226-01'], orders: ['SO-APP-MI102226-01'] });
eq('Max (member) sees his Order Entry-priced quote and the orders made from it — not the request it replaced', pageOf('max@fab.com'), { quotes: ['QSQUOTE-B'], orders: ['QS-1', 'QS-4'] });
eq('Wes (member, WEST) sees his', pageOf('wes@fab.com'), { quotes: ['OLD-1'], orders: ['QS-2'] });
eq('Lena (lead, EAST) sees her department, filed by person — p1 Max, p2 Mia; nothing of Wes\'s, nothing the team built', pageOf('lena@fab.com'),
    { quotes: ['MI102226-01@p2', 'QSQUOTE-B@p1'], orders: ['SO-APP-MI102226-01@p2', 'QS-1@p1', 'QS-4@p1'] });
const everything = { quotes: ['MI102226-01', 'QSQUOTE-B', 'OLD-1', 'QUOTE-9', 'QSQUOTE-S2'], orders: sos.map(s => s.id) };
eq('Rita (regional) sees the whole account, as before', pageOf('rita@fab.com'), everything);
eq('a login with no team entry sees the whole account, as before', pageOf('stuart@fab.com'), everything);
eq('a quote nobody sent from the portal is seen only by the whole-account logins', [V.sees(V.viewOf({ email: 'mia@fab.com', team }), ''), V.sees(lena, ''), V.sees(V.viewOf({ email: 'rita@fab.com', team }), '')], [false, false, true]);

// ── 5. the CRM's words for the request Order Entry priced (Shared/quoteChain) ─────────────────────────────────────────────────
eq('the request reads "Priced as" — it never reached NetSuite, so there is no estimate to close', lineageWordsOf(oeReq, jobs), 'Priced as QSQUOTE-A');
eq('…a quote that did reach NetSuite still says to close it', lineageWordsOf({ ...qsA, netsuiteEstimateId: '99' }, jobs), 'Superseded by QSQUOTE-B — close its old NetSuite estimate by hand · Rev 2 · supersedes MA102226-01');
eq('portalSenderStampOf: createdBy first, then byEmail; nothing for the team\'s own', [portalSenderStampOf(oldReq), portalSenderStampOf(staffQs), portalSenderStampOf(null), portalSenderStampOf({ createdBy: { name: 'Ann', email: 'Ann@X.com', via: 'PORTAL' } })],
    [{ name: 'wes@fab.com', email: 'wes@fab.com', via: 'PORTAL' }, null, null, { name: 'Ann', email: 'ann@x.com', via: 'PORTAL' }]);

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
