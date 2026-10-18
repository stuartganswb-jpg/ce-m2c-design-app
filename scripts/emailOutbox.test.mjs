// node scripts/emailOutbox.test.mjs — who a brand sends as, what the letter says, and the key
// that stops it being sent twice.
import assert from 'node:assert';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { senderFor, looksLikeEmail, dedupeKeyOf, paymentReceivedEmail } = require('../functions/emailOutbox.js');

let n = 0;
const ok = (c, what) => { assert.ok(c, what); n += 1; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); n += 1; };
const throws = (fn, re, what) => { assert.throws(fn, re, what); n += 1; };

// ── A BRAND SENDS AS ITSELF OR NOT AT ALL ────────────────────────────────────
const u = senderFor('uniquity');
eq(u.from, 'orders@uniquitystyle.com', "Uniq'uity sends from its own From");
eq(u.replyTo, 'sales@uniquitystyle.com', 'and replies reach a mailbox someone reads');
eq(u.merchant, "MC America dba Uniq'uity", 'and signs as the merchant of record, as the pay page does');
eq(senderFor('UNIQUITY').from, u.from, 'the brand is matched whatever its case');
for (const b of ['ce', 'm2c', 'leyla', '', null, 'nonsense']) {
    throws(() => senderFor(b), /NO_SENDER_FOR_BRAND/, `${String(b)} has no sender — it refuses rather than borrowing another company's name`);
}

// ── ADDRESSES WE WILL SEND TO ────────────────────────────────────────────────
for (const good of ['a@b.co', 'stuart@classicalelements.com', 'first.last+tag@sub.domain.org']) {
    ok(looksLikeEmail(good), `${good} is an address`);
}
for (const bad of ['', '  ', 'nope', 'a@b', 'a@@b.com', 'a b@c.com', 'a@b.c', 'a@b.com, c@d.com', null, undefined]) {
    ok(!looksLikeEmail(bad), `${String(bad)} is not — a bounce costs every other letter`);
}

// ── THE SAME THING NEVER SENDS TWICE ─────────────────────────────────────────
eq(dedupeKeyOf('PAYMENT', 'pay_123'), 'PAYMENT__pay_123', 'a key is the event, not the moment');
eq(dedupeKeyOf('payment', 'pay_123'), 'PAYMENT__pay_123', 'and does not care about case');
// A SLASH WOULD NOT SURVIVE AS A DOCUMENT ID — Firestore reads it as a path. Anything that is not
// a letter, digit, dash or underscore is stripped, so the key is always an id we can actually use.
eq(dedupeKeyOf('PAYMENT', 'pay/123'), 'PAYMENT__pay123', 'a slash cannot smuggle a path into a document id');
eq(dedupeKeyOf('PAYMENT', 'SO 60551'), 'PAYMENT__SO60551', 'nor a space');
ok(dedupeKeyOf('PAYMENT', 'x'.repeat(900)).length <= 480, 'and it stays short enough to be a document id');
ok(dedupeKeyOf('PAYMENT', 'a') !== dedupeKeyOf('PAYMENT', 'b'), 'two payments are two letters');

// ── THE PAYMENT RECEIVED LETTER ──────────────────────────────────────────────
const deposit = paymentReceivedEmail({
    brand: 'uniquity', customerName: 'Uniquity Marketing', reference: 'SOUNIQ-3996',
    amount: 516.8, paidTotal: 516.8, orderTotal: 6460, transactionId: '12680595160',
});
ok(deposit.subject.includes("MC America dba Uniq'uity"), 'the subject names who is writing');
ok(deposit.subject.includes('SOUNIQ-3996'), 'and which order');
ok(deposit.text.includes('$516.80'), 'the text says what was paid');
ok(deposit.text.includes('$6,460.00'), 'and the order total');
ok(deposit.text.includes('Balance: $5,943.20'), 'and what is left — the arithmetic, done once');
ok(deposit.html.includes('$5,943.20'), 'the html agrees with the text');
ok(deposit.text.includes('sales@uniquitystyle.com'), 'and says where a reply lands');
eq(deposit.from, 'orders@uniquitystyle.com', 'sent as the brand');
eq(deposit.replyTo, 'sales@uniquitystyle.com', 'answered by a person');

// PAID IN FULL says so rather than printing a balance of nothing.
const full = paymentReceivedEmail({ brand: 'uniquity', reference: 'SOUNIQ-3996', amount: 6460, paidTotal: 6460, orderTotal: 6460 });
ok(full.text.includes('Paid in full'), 'a settled order is told it is settled');
ok(!full.text.includes('Balance:'), 'and is not shown a balance of zero');

// A payment with no order total behind it still sends — it just claims less.
const bare = paymentReceivedEmail({ brand: 'uniquity', reference: 'test', amount: 7 });
ok(bare.text.includes('$7.00'), 'the amount is always said');
ok(!bare.text.includes('Order total'), 'but no total is invented when none is known');

// A customer whose name we do not have is not greeted with an empty space.
const noName = paymentReceivedEmail({ brand: 'uniquity', reference: 'X', amount: 5 });
ok(noName.text.startsWith('Thank you.'), 'no name, no awkward gap');
ok(deposit.text.startsWith('Thank you, Uniquity Marketing.'), 'a name is used when we have one');

// ── THE ORDER ITSELF, AS A LINK (2026-10-18) ─────────────────────────────────
// There is no PDF and a browser-made one cannot run unattended, so the letter carries a page the
// customer can open, read and print — always current, rather than a snapshot of this moment.
{
    const withDoc = paymentReceivedEmail({
        brand: 'uniquity', reference: 'SOUNIQ-3996', amount: 516.8, paidTotal: 516.8, orderTotal: 6460,
        docUrl: 'https://pay.uniquitystyle.com/#/doc/abc123',
    });
    ok(withDoc.text.includes('https://pay.uniquitystyle.com/#/doc/abc123'), 'the text carries the address in full');
    ok(withDoc.html.includes('View your order'), 'the html offers a button');
    ok(withDoc.html.includes('href="https://pay.uniquitystyle.com/#/doc/abc123"'), 'pointing at the order');
    ok(withDoc.text.includes('showing what has been paid'), 'and says what it is');
    const noDoc = paymentReceivedEmail({ brand: 'uniquity', reference: 'X', amount: 5 });
    ok(!noDoc.html.includes('View your order'), 'no link, no button — never a dead one');
    ok(!noDoc.text.includes('Your order, showing'), 'and nothing promised that is not there');
}

// ── NOTHING UNESCAPED REACHES AN INBOX ───────────────────────────────────────
const nasty = paymentReceivedEmail({ brand: 'uniquity', customerName: '<script>alert(1)</script>', reference: 'A&B "quoted"', amount: 1 });
ok(!nasty.html.includes('<script>'), 'a customer name cannot inject html into our own letter');
ok(nasty.html.includes('&lt;script&gt;'), 'it is shown as text instead');
ok(nasty.html.includes('&amp;'), 'and an ampersand in a reference is escaped');

console.log(`emailOutbox: ${n} assertions passed`);
