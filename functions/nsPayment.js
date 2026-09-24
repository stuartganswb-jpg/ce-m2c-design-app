// A CARD PAYMENT AS NETSUITE RECORDS IT — the two shapes Eric specified (2026-09-23), and the one
// rule for whether a payment is ready to post at all.
//
//   quote / sales order → CUSTOMER DEPOSIT   (customer, salesorder, location, memo, payment,
//                                             paymentmethod 22, checknum)
//   invoice             → CUSTOMER PAYMENT   (customer, location, memo, payment, paymentmethod 22,
//                                             checknum + the APPLY sublist naming the invoice)
//
// Stuart 2026-09-24: checknum = the NMI transaction id; posting is automatic; the memo reads
// "Card payment · <reference> · NMI <txn>".
//
// Pure, and the ONLY copy — functions/index.js requires it, scripts/nsPayment.test.mjs tests it.

// "First Citizens Merchant Service" (Eric: internal id 22). Every card payment posts against it.
const NS_PAYMENT_METHOD_ID = '22';
// NetSuite's memo field is short; the outbox also appends its own marker.
const NS_MEMO_MAX = 90;

const str = (v) => String(v === undefined || v === null ? '' : v).trim();
// The CRM id IS the NetSuite customer, prefixed — the same rule nsHeader.nsCustomerIdOf applies.
const nsCustomerIdOf = (id) => { const s = str(id); return s.startsWith('CUST-') ? s.slice(5) : s; };
const paymentMemo = ({ reference, transactionId }) =>
    `Card payment${reference ? ` · ${str(reference)}` : ''}${transactionId ? ` · NMI ${str(transactionId)}` : ''}`.slice(0, NS_MEMO_MAX);

// Is there enough to post, and if not, what is missing — in words a person can act on. A deposit
// without its sales order WAITS (Eric: salesorder is important); it is never posted unattached.
function postabilityOf({ kind, customerId, salesOrderNsId, invoiceNsId, locationId, amount, environment }) {
    if (environment && environment !== 'PRODUCTION') {
        return { ready: false, waiting: true, reason: 'test payment — nothing posts to NetSuite' };
    }
    if (!(Number(amount) > 0)) return { ready: false, waiting: false, reason: 'no amount' };
    if (!nsCustomerIdOf(customerId)) return { ready: false, waiting: false, reason: 'no NetSuite customer id on the order' };
    if (!str(locationId)) return { ready: false, waiting: false, reason: 'no location for this brand' };
    if (kind === 'customerdeposit' && !str(salesOrderNsId)) {
        return { ready: false, waiting: true, reason: 'waiting for the sales order to reach NetSuite' };
    }
    if (kind === 'customerpayment' && !str(invoiceNsId)) {
        return { ready: false, waiting: true, reason: 'waiting for the invoice to be billed in NetSuite' };
    }
    return { ready: true, waiting: false, reason: '' };
}

function customerDepositPayload({ customerId, salesOrderNsId, locationId, amount, reference, transactionId }) {
    return {
        customer: { id: nsCustomerIdOf(customerId) },
        salesorder: { id: str(salesOrderNsId) },
        location: { id: str(locationId) },
        payment: Number(Number(amount).toFixed(2)),
        paymentmethod: { id: NS_PAYMENT_METHOD_ID },
        checknum: str(transactionId).slice(0, 45),
        memo: paymentMemo({ reference, transactionId }),
    };
}

// The apply sublist is a checklist of the customer's open invoices: name the one this pays, tick
// it, and state the amount (so a part payment applies as a part payment, not the whole invoice).
function customerPaymentPayload({ customerId, invoiceNsId, locationId, amount, reference, transactionId }) {
    const amt = Number(Number(amount).toFixed(2));
    return {
        customer: { id: nsCustomerIdOf(customerId) },
        location: { id: str(locationId) },
        payment: amt,
        paymentmethod: { id: NS_PAYMENT_METHOD_ID },
        checknum: str(transactionId).slice(0, 45),
        memo: paymentMemo({ reference, transactionId }),
        apply: { items: [{ doc: str(invoiceNsId), apply: true, amount: amt }] },
    };
}

const nsPaymentUrl = (kind) =>
    `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${kind === 'customerpayment' ? 'customerPayment' : 'customerDeposit'}`;

module.exports = {
    NS_PAYMENT_METHOD_ID, NS_MEMO_MAX, nsCustomerIdOf, paymentMemo,
    postabilityOf, customerDepositPayload, customerPaymentPayload, nsPaymentUrl,
};
