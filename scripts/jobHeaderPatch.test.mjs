// Harness for jobHeaderPatchOf — the checkout header as ONE patch on the jobs doc, edited from the
// CRM after the save (Stuart 2026-09-10: "we should be able to reopen at the checkout").
//
//   node scripts/jobHeaderPatch.test.mjs
//
// The contract: the patch is the field set CPQ's finalize writes for the header, so soHeaderOf
// rebuilds the same hq_sales_orders header from the edited job that the save built.

import { jobHeaderPatchOf, soHeaderOf, EMPTY_SHIP_ADDRESS } from '../src/components/Shared/salesOrderHeader.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// The form as the CRM modal holds it, seeded from this morning's ST091026-01 and edited.
const FORM = { id: 'QUOTE-1789044572972', jobName: 'Room Right', sidemark: ' HP Market ', status: 'CONFIGURED', poNumber: ' 25254 ', internalMemo: 'call before ship',
    needBy: '2026-10-09', productionNotes: 'match sample on file', shippingMethod: 'CUSTOM', shippingAddressId: 'AB-1',
    customShippingAddress: { attention: 'Maida Cameron', addressee: '', addr1: '115 s. lindsay', addr2: '', city: 'Tulsa', state: 'OK', zip: '74145' }, shippingAmount: '12.5', customerId: 'CUST-4720', nsRef: '' };

{
    const p = jobHeaderPatchOf(FORM);
    eq('typed sidemark → orderSidemark (trimmed) and sidemark', [p.orderSidemark, p.sidemark], ['HP Market', 'HP Market']);
    eq('PO / memo / notes trimmed as typed', [p.poNumber, p.internalMemo, p.productionNotes], ['25254', 'call before ship', 'match sample on file']);
    eq('need-by kept when it is a date', p.needBy, '2026-10-09');
    eq('CUSTOM: address block kept, saved id dropped', [p.shippingMethod, p.shippingAddressId, p.customShippingAddress.city], ['CUSTOM', null, 'Tulsa']);
    eq('shipping charge is a number', p.shippingAmount, 12.5);
    ok('the modal-only keys never reach the job', !('id' in p) && !('status' in p) && !('customerId' in p) && !('nsRef' in p));
}
{
    const p = jobHeaderPatchOf({ ...FORM, sidemark: '', shippingMethod: 'SAVED', needBy: 'next week', poNumber: '', shippingAmount: '' });
    eq('no typed sidemark → orderSidemark null, sidemark falls to the job name (CPQ chain)', [p.orderSidemark, p.sidemark], [null, 'Room Right']);
    eq('…and to the historical default when there is no job name either', jobHeaderPatchOf({ sidemark: '', jobName: '' }).sidemark, 'Multi-Room Project');
    eq('a cleared PO is written as cleared (an edit is a decision)', p.poNumber, '');
    eq('a need-by that is not a date is never invented', p.needBy, '');
    eq('SAVED: the address id kept, the custom block dropped', [p.shippingMethod, p.shippingAddressId, p.customShippingAddress], ['SAVED', 'AB-1', null]);
    eq('SAVED with no id → null, not ""', jobHeaderPatchOf({ shippingMethod: 'SAVED', shippingAddressId: '' }).shippingAddressId, null);
    eq('blank charge → 0', p.shippingAmount, 0);
    eq('every custom-address key is present, as strings', Object.keys(jobHeaderPatchOf({ shippingMethod: 'CUSTOM', customShippingAddress: { city: 'X' } }).customShippingAddress), Object.keys(EMPTY_SHIP_ADDRESS));
}
{
    // The round trip that matters: the SO header rebuilt from the patched job says what was edited.
    const job = { id: 'QUOTE-1', quoteNo: 'ST091026-01', jobName: 'Room Right', orderSidemark: null, sidemark: 'Room Right', poNumber: '', shippingMethod: 'SAVED', shippingAddressId: 'AB-9',
        needBy: '', readyDate: '2026-10-22', leadWeeks: 6, leadBasis: 'PLATED', rushApplied: false, customer: { id: 'CUST-4720', name: 'FABRICUT' },
        cpqData: { cartItems: [{ finishes: [{ code: 'EP5' }], pricingBreakdown: [{ finishCode: 'EP5' }] }] } };
    const edited = { ...job, ...jobHeaderPatchOf(FORM) };
    const h = soHeaderOf({ door: 'CPQ', job: edited, customer: { id: 'CUST-4720', name: 'FABRICUT' }, finishes: [{ code: 'EP5', name: 'Aged Brass' }], outsourceFinishes: [{ code: 'EP5' }], by: 'stuart' });
    eq('SO header: sidemark, PO, need-by, notes from the edit', [h.sidemark, h.customerPo, h.needBy, h.productionNotes], ['HP Market', '25254', '2026-10-09', 'match sample on file']);
    eq('SO header: ship-to lines from the custom block', h.shipTo.slice(0, 2), ['Maida Cameron', '115 s. lindsay']);
    eq('SO header: the promise the job was saved with is KEPT (finishes did not change)', [h.readyDate, h.leadBasis, h.leadWeeks], ['2026-10-22', 'PLATED', 6]);
    eq('SO header: memo follows the typed sidemark', h.memo, 'HP Market');
    eq('SO header: shipping amount', h.shippingAmount, 12.5);
}

{
    // ONE DISCOUNT FIELD, BOTH DOORS (Stuart 2026-09-11)
    const qs = (ex) => soHeaderOf({ door: 'QUICKSHIP', form: { soExtras: ex, ship: {}, jobName: 'J', lines: [] }, by: 'Stuart' }).orderDiscount;
    eq('tab 7: a set % rides the SO header', qs({ orderDiscountPercent: '20' }), { mode: 'ORDER_PERCENT', percent: 20, code: '', by: 'Stuart' });
    eq('tab 7: blank = NONE', qs({}), { mode: 'NONE', percent: null, code: '', by: 'Stuart' });
    eq('tab 7: 0 = NONE', qs({ orderDiscountPercent: '0' }), { mode: 'NONE', percent: null, code: '', by: 'Stuart' });
    const cpq = (od) => soHeaderOf({ door: 'CPQ', job: { jobName: 'J', ...(od !== undefined ? { orderDiscount: od } : {}) } }).orderDiscount;
    eq('CPQ: the job\'s stamp rides as saved', cpq({ mode: 'LINES', percent: null, code: '', by: 'M' }), { mode: 'LINES', percent: null, code: '', by: 'M' });
    eq('CPQ: a code stamp keeps percent + code', cpq({ mode: 'CODE', percent: 20, code: 'D20', by: '' }), { mode: 'CODE', percent: 20, code: 'D20', by: '' });
    eq('CPQ: a job from before the field → NONE', cpq(undefined), { mode: 'NONE', percent: null, code: '', by: '' });
    eq('CPQ: garbage → NONE', cpq('yes'), { mode: 'NONE', percent: null, code: '', by: '' });
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
