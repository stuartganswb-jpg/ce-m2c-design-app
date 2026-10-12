// A new customer in NetSuite first, pinned (the show counter, 2026-10-12): the body NetSuite takes, the id read
// from its answer, the refusal in its words, and the CRM record in the 11.1 sync's own shape.
import { customerPayloadOf, nsIdOfCreateAnswer, nsErrorOf, crmRecordOf, crmRecordAppOnlyOf } from '../src/components/Shared/nsCustomer.js';
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
ok('an app-only record says it is pending NetSuite and why', /^CUST-\d{4}$/.test(a.id) && a.nsPending === true && a.nsPendingReason === 'proxy 503' && a.nsInternalId === '');
console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
