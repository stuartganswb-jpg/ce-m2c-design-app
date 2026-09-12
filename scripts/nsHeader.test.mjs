// Harness for Shared/nsHeader — ONE NetSuite transaction header, both doors (E3 / #22, S1 2026-09-12).
//
//   node scripts/nsHeader.test.mjs
//
// The contract: CE gets its form + class; a brand with no ids on file REFUSES with a named error
// (never a default form); shipping rides the same way from both doors; the memo is cut to 40.

import { nsTransactionHeader, nsCustomerIdOf } from '../src/components/Shared/nsHeader.js';
import { BRAND_NETSUITE_FORMS, BRAND_NETSUITE_MAP } from '../src/components/Shared/brandNetsuite.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

eq('CUST- prefix stripped', [nsCustomerIdOf('CUST-4720'), nsCustomerIdOf('4720'), nsCustomerIdOf('')], ['4720', '4720', '']);

// ── CE, both doors, both types ───────────────────────────────────────────────────────────────
{
    const r = nsTransactionHeader({ brand: 'ce', asType: 'estimate', customerId: 'CUST-4720', memo: 'SMITH RESIDENCE', poNumber: 'PO-1', internalMemo: 'call first', appJobId: 'QUOTE-1' });
    ok('CE estimate builds', r.ok);
    eq('CE estimate header', r.header, { entity: { id: '4720' }, subsidiary: { id: '2' }, location: { id: '17' }, customForm: { id: '299' }, class: { id: '2' }, memo: 'SMITH RESIDENCE', otherRefNum: 'PO-1', custbody_bit_internalmemo: 'call first', custbody50: 'QUOTE-1' });
    const so = nsTransactionHeader({ brand: 'ce', asType: 'salesorder', customerId: '4720', memo: 'x' });
    eq('CE sales order = form 177, class 2', [so.header.customForm.id, so.header.class.id], ['177', '2']);
    eq('no PO / memo / job id → the keys are absent, not blank', Object.keys(so.header).sort(), ['class', 'customForm', 'entity', 'location', 'memo', 'subsidiary']);
    eq('memo passed as the door cut it (CPQ sends it whole)', nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x'.repeat(60) }).header.memo.length, 60);
}
// ── the refusal ──────────────────────────────────────────────────────────────────────────────
{
    ['m2c', 'uniquity', 'leyla'].forEach(b => {
        const r = nsTransactionHeader({ brand: b, asType: 'estimate', customerId: '1', memo: 'x' });
        eq(`${b}: refuses with a named code until Eric's ids are on file`, [r.ok, r.error.code], [false, 'NO_NS_FORM_FOR_BRAND']);
        ok(`${b}: the message names the brand and where the ids go`, r.error.message.includes(`"${b}"`) && /BRAND_NETSUITE_FORMS/.test(r.error.message));
        ok(`${b}: subsidiary / location ARE on file (the refusal is the form, not the map)`, !!BRAND_NETSUITE_MAP[b]);
    });
    eq('unknown brand: refuses on the subsidiary map first', nsTransactionHeader({ brand: 'nope', customerId: '1' }).error.code, 'NO_NS_SUBSIDIARY_FOR_BRAND');
    eq('no customer: NO_CUSTOMER', nsTransactionHeader({ brand: 'ce', customerId: '' }).error.code, 'NO_CUSTOMER');
    eq('only CE has ids today', Object.keys(BRAND_NETSUITE_FORMS), ['ce']);
    // the day Eric's ids land, the refusal lifts with no code change
    BRAND_NETSUITE_FORMS.m2c = { estimate: '900', salesorder: '901', class: '9' };
    eq('an added brand row builds at once', nsTransactionHeader({ brand: 'm2c', asType: 'salesorder', customerId: '1', memo: 'x' }).header.customForm.id, '901');
    delete BRAND_NETSUITE_FORMS.m2c;
}
// ── shipping, one way from both doors ────────────────────────────────────────────────────────
{
    const saved = nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x', shipping: { method: 'SAVED', addressId: '55', amount: 12.5, shipMethod: { id: '7', name: 'UPS' } } });
    eq('saved address + charge + method', [saved.header.shipaddresslist, saved.header.shippingcost, saved.header.shipMethod, saved.warnings], [{ id: '55' }, 12.5, { id: '7' }, []]);
    const custom = nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x', shipping: { method: 'CUSTOM', custom: { attention: 'A', addressee: 'B', addr1: '1 Main', city: 'Denver', state: 'co.', zip: '80202' } } });
    eq('custom address: state upper-cased, dots stripped, country defaults US', custom.header.shippingaddress, { attention: 'A', addressee: 'B', addr1: '1 Main', addr2: '', city: 'Denver', state: 'CO', zip: '80202', country: { id: 'US' } });
    const noAddr = nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x', shipping: { method: 'CUSTOM', custom: { addr1: '' } } });
    ok('a CUSTOM method with no street sends no address block (both doors agree now)', !noAddr.header.shippingaddress && !noAddr.header.shipaddresslist);
    const noMethod = nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x', shipping: { method: 'SAVED', addressId: '55', amount: 20, shipMethod: null } });
    eq('a charge with no ship item: no cost on the header, one warning', [noMethod.header.shippingcost, noMethod.warnings.length], [undefined, 1]);
    eq('no shipping at all → nothing', Object.keys(nsTransactionHeader({ brand: 'ce', customerId: '1', memo: 'x' }).header).some(k => /ship/i.test(k)), false);
}

console.log(`\nnsHeader: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
