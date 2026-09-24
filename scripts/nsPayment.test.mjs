// A card payment as NetSuite records it.   node scripts/nsPayment.test.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const {
  nsCustomerIdOf, paymentMemo, postabilityOf, customerDepositPayload, customerPaymentPayload, nsPaymentUrl, NS_MEMO_MAX,
} = require('../functions/nsPayment.js');
let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };

// customer id
eq('CUST- prefix stripped', nsCustomerIdOf('CUST-4720'), '4720');
eq('a bare id passes through', nsCustomerIdOf('4720'), '4720');
eq('nothing stays nothing', nsCustomerIdOf(null), '');

// memo
eq('memo carries both references', paymentMemo({ reference: 'SO60428', transactionId: '1234567890' }), 'Card payment · SO60428 · NMI 1234567890');
ok('memo is capped', paymentMemo({ reference: 'X'.repeat(200), transactionId: '1' }).length <= NS_MEMO_MAX);

// postability — a deposit WAITS for its sales order rather than posting unattached
const base = { kind: 'customerdeposit', customerId: 'CUST-4720', locationId: '17', amount: 500, environment: 'PRODUCTION' };
eq('deposit with a sales order is ready', postabilityOf({ ...base, salesOrderNsId: '867437' }).ready, true);
eq('deposit without one waits', postabilityOf({ ...base }), { ready: false, waiting: true, reason: 'waiting for the sales order to reach NetSuite' });
eq('invoice payment needs the invoice', postabilityOf({ ...base, kind: 'customerpayment' }).reason, 'waiting for the invoice to be billed in NetSuite');
eq('invoice payment with one is ready', postabilityOf({ ...base, kind: 'customerpayment', invoiceNsId: '921725' }).ready, true);
eq('a TEST payment never posts', postabilityOf({ ...base, salesOrderNsId: '867437', environment: 'SANDBOX' }), { ready: false, waiting: true, reason: 'test payment — nothing posts to NetSuite' });
eq('no customer id is a problem, not a wait', postabilityOf({ ...base, salesOrderNsId: '1', customerId: '' }), { ready: false, waiting: false, reason: 'no NetSuite customer id on the order' });
eq('no location is a problem', postabilityOf({ ...base, salesOrderNsId: '1', locationId: '' }).reason, 'no location for this brand');
eq('no amount is a problem', postabilityOf({ ...base, salesOrderNsId: '1', amount: 0 }).reason, 'no amount');

// deposit payload — Eric's field ids
eq('deposit payload', customerDepositPayload({ customerId: 'CUST-4720', salesOrderNsId: '867437', locationId: '17', amount: 500.004, reference: 'SO60428', transactionId: '1234567890' }), {
  customer: { id: '4720' }, salesorder: { id: '867437' }, location: { id: '17' },
  payment: 500, paymentmethod: { id: '22' }, checknum: '1234567890',
  memo: 'Card payment · SO60428 · NMI 1234567890',
});

// invoice payment — the apply sublist names the invoice and the amount applied
const cp = customerPaymentPayload({ customerId: '4720', invoiceNsId: '921725', locationId: '17', amount: 250.5, reference: 'INV68988', transactionId: '999' });
eq('payment applies to the invoice', cp.apply, { items: [{ doc: '921725', apply: true, amount: 250.5 }] });
eq('payment header', [cp.customer, cp.location, cp.payment, cp.paymentmethod, cp.checknum], [{ id: '4720' }, { id: '17' }, 250.5, { id: '22' }, '999']);
ok('a part payment applies only its own amount', cp.apply.items[0].amount === cp.payment);

// urls
eq('deposit url', nsPaymentUrl('customerdeposit').endsWith('/customerDeposit'), true);
eq('payment url', nsPaymentUrl('customerpayment').endsWith('/customerPayment'), true);

// several existing NetSuite invoices, paid by one card charge
const many = customerPaymentPayload({ customerId: 'CUST-4720', locationId: '17', transactionId: '777', reference: '3 invoices',
  invoices: [{ id: '921725', amount: 100.25 }, { id: '921800', amount: 50 }] });
eq('applies to every invoice selected', many.apply.items, [{ doc: '921725', apply: true, amount: 100.25 }, { doc: '921800', apply: true, amount: 50 }]);
eq('payment is the sum of them', many.payment, 150.25);
eq('one invoice still works the old way', customerPaymentPayload({ customerId: '1', invoiceNsId: '9', locationId: '17', amount: 10 }).apply.items, [{ doc: '9', apply: true, amount: 10 }]);

console.log(`nsPayment: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
