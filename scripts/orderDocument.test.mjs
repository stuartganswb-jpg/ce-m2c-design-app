// node scripts/orderDocument.test.mjs — the sales order as the customer sees it.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { orderDocumentOf, linesOf, totalsOf, shippingOf } = require('../functions/orderDocument.js');

let n = 0;
const ok = (c, what) => { assert.ok(c, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };

const order = (over) => ({
    id: 'SO-OE-1', soId: 'SOUNIQ-3996', customer: 'Uniquity Marketing', createdAt: 1760000000000,
    invoiceTotal: 6460, paymentsTotal: 516.8,
    invoiceLines: [
        { type: 'ITEM', erp: 'DOWELL/57P24X15', name: 'Custom pillow', qty: 2, rate: 220, total: 440, note: '24x15' },
    ],
    ...over,
});

// ── the lines a customer sees ────────────────────────────────────────────────
const d = orderDocumentOf(order(), { merchantName: "MC America dba Uniq'uity" });
eq(d.lines.length, 1, 'the priced line');
eq(d.lines[0].code, 'DOWELL/57P24X15', 'under the code they ordered');
eq(d.lines[0].qty, 2, 'the quantity');
eq(d.lines[0].rate, 220, 'the rate');
eq(d.lines[0].amount, 440, 'and the amount');

// An unpriced order still shows what was bought — the customer knows what they ordered even when
// the office has not rated it yet.
const raw = orderDocumentOf(order({ invoiceLines: [], lines: [{ aliasErp: 'ALLEN/58T', name: 'Allen throw', qty: 1 }] }));
eq(raw.lines[0].code, 'ALLEN/58T', 'the alias code the customer orders under');
eq(raw.lines[0].rate, null, 'no rate is invented');
eq(raw.lines[0].amount, null, 'nor an amount');

// ── the money ────────────────────────────────────────────────────────────────
eq(d.total, 6460, "the order's own total");
eq(d.paid, 516.8, 'what has been paid');
eq(d.balance, 5943.2, 'and what is left');
eq(d.paidInFull, false, 'a deposit is not payment in full');
ok(d.paidNote.includes('Deposit received'), 'and is named as a deposit');

const settled = orderDocumentOf(order({ paymentsTotal: 6460 }));
eq(settled.balance, 0, 'a settled order owes nothing');
eq(settled.paidInFull, true, 'and says so');
ok(settled.paidNote.includes('Paid in full'), 'in words');
ok(!settled.paidNote.includes('balance'), 'without mentioning a balance of nothing');

const unpaid = orderDocumentOf(order({ paymentsTotal: 0 }));
eq(unpaid.paid, 0, 'nothing paid');
eq(unpaid.paidNote, '', 'and nothing claimed about it');

// Overpaid never shows a NEGATIVE balance to a customer — it shows nothing owing.
eq(orderDocumentOf(order({ paymentsTotal: 7000 })).balance, 0, 'an overpayment owes nothing, never minus');

// With no total of its own, the lines add up to one — but only ONE reckoning either way.
eq(totalsOf({ paymentsTotal: 0 }, [{ amount: 100 }, { amount: 50 }]).total, 150, 'lines make the total when there is none');
eq(totalsOf({ invoiceTotal: 999, paymentsTotal: 0 }, [{ amount: 100 }]).total, 999, "the order's own total wins");

// ── FREIGHT IS PART OF THE BILL (Stuart 2026-10-19) ──────────────────────────
// invoiceTotal is the GOODS only; freight rides separately because NetSuite wants it in its own
// field. Totalling the goods alone understated every bill, asked a deposit on the wrong figure,
// and disagreed with NetSuite's own total for the same order — SOUNIQ-3991 was 700 + 70 = 770
// there and 700 here.
{
    const ship = orderDocumentOf(order({ invoiceTotal: 700, shipping: { amount: 70 }, paymentsTotal: 0 }));
    eq(ship.goods, 700, 'the goods');
    eq(ship.shipping, 70, 'the freight');
    eq(ship.total, 770, 'and the bill is both — the figure NetSuite already had');
    eq(ship.balance, 770, 'so the balance owes the freight too');
    // Either spelling: the two doors write it differently and mean the same thing.
    eq(orderDocumentOf(order({ invoiceTotal: 700, shippingAmount: 70, shipping: undefined })).total, 770, 'shippingAmount is the same freight');
    eq(shippingOf({ shippingAmount: 12 }), 12, 'read either way');
    eq(shippingOf({ shipping: { amount: 12 } }), 12, 'or the other');
    eq(shippingOf({}), 0, 'no freight, no charge');
    // A deposit still leaves the freight owing.
    eq(orderDocumentOf(order({ invoiceTotal: 700, shipping: { amount: 70 }, paymentsTotal: 385 })).balance, 385, 'half the goods paid still owes the freight');
}

// ── what it calls itself ─────────────────────────────────────────────────────
eq(d.kind, 'SALES_ORDER', 'an unbilled order is a sales order');
eq(orderDocumentOf(order({ nsInvoiceNo: 'INV-9' })).kind, 'INVOICE', 'a billed one is an invoice');
eq(d.merchantName, "MC America dba Uniq'uity", 'and names the company taking the money');
eq(d.reference, 'SOUNIQ-3996', 'by the number the customer was given');

// ── a customer object, not just a string (CPQ spells it differently) ─────────
eq(orderDocumentOf(order({ customer: { id: 'CUST-1', name: 'Fabricut' } })).customerName, 'Fabricut',
    'an object customer is read by name, never printed as [object Object]');

// ── nothing at all does not throw ────────────────────────────────────────────
const empty = orderDocumentOf(null);
eq(empty.lines, [], 'no order, no lines');
eq(empty.total, 0, 'and no money');
ok(typeof empty.reference === 'string', 'and it still answers in the right shape');

console.log(`orderDocument: ${n} assertions passed`);
