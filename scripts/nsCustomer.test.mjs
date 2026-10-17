// A new customer in NetSuite first, pinned (the show counter, 2026-10-12): the body NetSuite takes, the id read
// from its answer, the refusal in its words, and the CRM record in the 11.1 sync's own shape.
import { isAppOnlyCustomerId } from '../src/components/Shared/nsCustomer.js';
import { customerPayloadOf, nsIdOfCreateAnswer, nsErrorOf, crmRecordOf, crmRecordAppOnlyOf, customerByExternalIdSql, customerLookupSql, sameCustomersOf, existingCustomersOf, createNsCustomer } from '../src/components/Shared/nsCustomer.js';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };
const p = customerPayloadOf({ name: 'Smith Design', email: 'a@b.c', phone: '555 1212', brand: 'uniquity', salesRep: 'Liz', at: 1000 });
ok('the body: a company in Uniquity\'s subsidiary 6 with email, phone, an external id and a comment naming the rep', p.ok && p.payload.companyName === 'Smith Design' && p.payload.isPerson === false && p.payload.subsidiary.id === '6' && p.payload.email === 'a@b.c' && p.payload.phone === '555 1212' && p.payload.externalId === 'APP-UNIQUITY-1000' && /show counter by Liz/.test(p.payload.comments));
ok('no name / unknown brand refuse by name', customerPayloadOf({ name: '' }).errors[0].code === 'NO_NAME' && customerPayloadOf({ name: 'x', brand: 'nobody' }).errors[0].code === 'NO_SUBSIDIARY');
ok('blank email / phone are left off the body', !('email' in customerPayloadOf({ name: 'x' }).payload) && !('phone' in customerPayloadOf({ name: 'x' }).payload));
ok('the id from the record answer, from its self link, from a Location, else blank', nsIdOfCreateAnswer({ id: '48877' }) === '48877' && nsIdOfCreateAnswer({ links: [{ rel: 'self', href: 'https://x/record/v1/customer/5151' }] }) === '5151' && nsIdOfCreateAnswer({}, '/record/v1/customer/777') === '777' && nsIdOfCreateAnswer({}) === '');
ok('NetSuite\'s refusal in its words', nsErrorOf({ 'o:errorDetails': [{ detail: 'Please enter value(s) for: Company Name' }] }, 400) === 'Please enter value(s) for: Company Name' && nsErrorOf({}, 503) === 'NetSuite HTTP 503');
const r = crmRecordOf({ nsId: '48877', name: 'Smith Design', email: 'a@b.c', phone: '555', brand: 'uniquity', by: 'Liz', at: 1000 });
ok('the CRM record: id CUST-<nsid>, the sync\'s fields, the CRM\'s app fields, the rep, the counter named', r.id === 'CUST-48877' && r.type === 'CUSTOMER' && r.stage === 'CUSTOMER' && r.brandId === 'uniquity' && r.sharedBrands[0] === 'uniquity' && r.creditLimit === 0 && r.salesRep === 'Liz' && r.contact === 'Smith Design' && r.ytd === 0 && r.createdVia === 'SHOW_COUNTER' && r.nsInternalId === '48877');
const a = crmRecordAppOnlyOf({ name: 'Walk-in', brand: 'uniquity', by: 'Liz', reason: 'proxy 503' });
ok('an app-only record says it is pending NetSuite and why, with an id that can never be a NetSuite number', /^CUST-APP-\d+$/.test(a.id) && isAppOnlyCustomerId(a.id) && !isAppOnlyCustomerId('CUST-48877') && a.nsPending === true && a.nsPendingReason === 'proxy 503' && a.nsInternalId === '');

// ── 2026-10-17: the id NetSuite says only in its Location header, and one customer made once (Baker Stone Studio) ──
ok('the id from the Location the proxy hands on in the body', nsIdOfCreateAnswer({ location: 'https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/customer/76875' }) === '76875');
ok('the read-back by externalId, quotes escaped; none without one', customerByExternalIdSql("APP-UNIQUITY-1") === "SELECT c.id AS id, c.entityid AS entityid FROM customer c WHERE c.externalid = 'APP-UNIQUITY-1'" && customerByExternalIdSql("a'b").includes("'a''b'") && customerByExternalIdSql('') === '');
const lk = customerLookupSql({ name: "Baker Stone Studio", email: 'PBaker@BakerStoneStudio.com', brand: 'uniquity' });
ok('the NetSuite look: active, the brand\'s subsidiary, same email (lower) OR same company (upper)', /isinactive = 'F'/.test(lk) && /c\.subsidiary = 6 /.test(lk) && lk.includes("LOWER(c.email) = 'pbaker@bakerstonestudio.com' OR UPPER(c.companyname) = 'BAKER STONE STUDIO'"), lk);
ok('the NetSuite look: a name alone, an apostrophe escaped; nothing to look for / no brand = no query', !/LOWER\(c\.email\)/.test(customerLookupSql({ name: "O'Neil Home" })) && customerLookupSql({ name: "O'Neil Home" }).includes("'O''NEIL HOME'") && customerLookupSql({}) === '' && customerLookupSql({ name: 'x', brand: 'nobody' }) === '');
const crm = [
    { id: 'CUST-67685', name: 'Baker Stone Studio', email: 'pbaker@bakerstonestudio.com', nsInternalId: '' },
    { id: 'CUST-3585', name: 'Baker Stone Studio', email: 'pbaker@bakerstonestudio.com', nsPending: true },
    { id: 'CUST-1', name: 'Smith Design', email: 'smith@x.com' },
];
const same = sameCustomersOf({ name: 'baker stone studio.', email: '', customers: crm });
ok('the CRM look: same name ignoring case and punctuation; an app-only record is never offered', same.length === 1 && same[0].id === 'CUST-67685');
ok('the CRM look: same email whatever the name; nothing typed = nothing found', sameCustomersOf({ name: 'Someone', email: ' SMITH@x.com ', customers: crm })[0].id === 'CUST-1' && sameCustomersOf({ customers: crm }).length === 0);
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => '' } });
const fetchSeq = (answers) => { const calls = []; const f = async (req) => { calls.push(req); const a = answers.shift(); if (a instanceof Error) throw a; return a; }; f.calls = calls; return f; };
{
    const f = fetchSeq([res(200, { items: [{ id: '67685', entityid: '3779', companyname: 'Baker Stone Studio', email: 'pbaker@bakerstonestudio.com' }, { id: '76875', entityid: '3908', companyname: 'Baker Stone Studio', email: 'pbaker@bakerstonestudio.com' }] })]);
    const found = await existingCustomersOf({ nsProxyFetch: f, name: 'Baker Stone Studio', email: 'pbaker@bakerstonestudio.com', customers: crm });
    const a1 = found.matches.find(m => m.nsId === '67685'), a2 = found.matches.find(m => m.nsId === '76875');
    ok('existing: the CRM record is matched to its NetSuite row (#3779) and picked as it is', found.nsChecked && a1 && a1.rec && a1.rec.id === 'CUST-67685' && a1.entityId === '3779' && a1.inApp);
    ok('existing: a NetSuite-only customer is offered with no CRM record, to be filed when used', a2 && a2.rec === null && a2.entityId === '3908' && !a2.inApp && found.matches.length === 2);
    ok('existing: one SuiteQL read, nothing written', f.calls.length === 1 && /query\/v1\/suiteql/.test(f.calls[0].targetUrl) && f.calls[0].method === 'POST');
}
{
    const found = await existingCustomersOf({ nsProxyFetch: fetchSeq([new Error('proxy 503')]), name: 'Baker Stone Studio', customers: crm });
    ok('existing: NetSuite not answering is SAID (nsChecked false), and the app\'s own matches still stand', found.nsChecked === false && found.nsError === 'proxy 503' && found.matches.length === 1);
}
{
    const pay = { companyName: 'X', externalId: 'APP-UNIQUITY-9' };
    const r1 = await createNsCustomer({ nsProxyFetch: fetchSeq([res(200, { location: 'https://x/record/v1/customer/76875' })]), payload: pay });
    ok('create: the id from the handed-on Location — made, no second read', r1.ok && r1.nsId === '76875' && r1.made);
    const f2 = fetchSeq([res(200, {}), res(200, { items: [{ id: '76875', entityid: '3908' }] })]);
    const r2 = await createNsCustomer({ nsProxyFetch: f2, payload: pay });
    ok('create: an accepted answer with no id is read back by its externalId', r2.ok && r2.nsId === '76875' && f2.calls.length === 2 && f2.calls[1].payload.q.includes("externalid = 'APP-UNIQUITY-9'"));
    const r3 = await createNsCustomer({ nsProxyFetch: fetchSeq([res(200, {}), res(200, { items: [] })]), payload: pay });
    ok('create: made but unreadable says MADE and never "not created" (no app-only, no second create)', !r3.ok && r3.made === true && /Do NOT create it again/.test(r3.error));
    const r4 = await createNsCustomer({ nsProxyFetch: fetchSeq([res(400, { 'o:errorDetails': [{ detail: 'Please enter value(s) for: Company Name' }] })]), payload: pay });
    ok('create: a refusal is not made, in NetSuite\'s words', !r4.ok && r4.made === false && r4.error === 'Please enter value(s) for: Company Name');
}
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
