// ✉️ THE EMAIL OUTBOX — what we send, to whom, as whom (Stuart 2026-10-16).
//
// The app had no transactional email at all: every document was printed through the browser and
// every "email" was a mailto: draft someone had to finish by hand. Postmark sends them now, and
// this module holds the parts worth testing offline — WHO a brand sends as, WHAT each letter says,
// and the key that stops one being sent twice. The plumbing (Firestore, the API call, retries)
// lives in index.js.
//
// ⛔ A BRAND SENDS AS ITSELF OR IT DOES NOT SEND. The same rule as the gateway keys: a brand with
// no sender on file REFUSES rather than borrowing another company's name. A Uniq'uity order
// confirmation signed "Classical Elements" is the same mistake the pay page made, arriving in a
// customer's inbox instead of on a screen we can correct.
const SENDERS = {
    uniquity: {
        from: 'orders@uniquitystyle.com',          // not a mailbox — replies go to replyTo
        replyTo: 'sales@uniquitystyle.com',        // a mailbox someone reads (Stuart 2026-10-16)
        merchant: "MC America dba Uniq'uity",      // the merchant of record, as the pay page says it
        tokenSecret: 'POSTMARK_TOKEN_UNIQUITY',
    },
    // CE, M2C and Leyla send nothing until each has its own Postmark server and sender.
};

const str = (v) => String(v === undefined || v === null ? '' : v).trim();
const money = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (v) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function senderFor(brand) {
    const s = SENDERS[String(brand || '').toLowerCase()];
    if (!s) throw new Error(`NO_SENDER_FOR_BRAND: no email sender is on file for "${brand}" — it would have to send as another company, so it sends nothing.`);
    return s;
}

// AN ADDRESS WE WILL ACTUALLY SEND TO. Deliberately strict: a malformed address is a bounce, and
// bounces are what ruin a sending reputation for every other letter.
const looksLikeEmail = (v) => /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]{2,}$/.test(str(v));

// ONE KEY PER THING THAT HAPPENED, so a retry, a double click or a replayed trigger cannot send a
// customer the same letter twice. It becomes the outbox document's id: writing it again is the
// same row, not a second one.
const dedupeKeyOf = (kind, ...parts) =>
    [str(kind).toUpperCase(), ...parts.map((p) => str(p).replace(/[^A-Za-z0-9_-]/g, ''))].filter(Boolean).join('__').slice(0, 480);

// ── THE LETTERS ──────────────────────────────────────────────────────────────────────────────
// Plain, short, and factual. Everything in them is read from the order, never retyped.

function paymentReceivedEmail({ brand, customerName, reference, amount, paidTotal, orderTotal, transactionId, docUrl }) {
    const s = senderFor(brand);
    const paid = Number(paidTotal || amount || 0);
    const total = Number(orderTotal || 0);
    const balance = total > 0 ? Math.round((total - paid) * 100) / 100 : null;
    const subject = `${s.merchant} — payment received for ${str(reference) || 'your order'}`;

    const lines = [
        `Thank you${customerName ? `, ${str(customerName)}` : ''}.`,
        '',
        `We have received ${money(amount)} for ${str(reference) || 'your order'}.`,
    ];
    if (total > 0) {
        lines.push('');
        lines.push(`Order total: ${money(total)}`);
        lines.push(`Paid to date: ${money(paid)}`);
        lines.push(balance !== null && balance > 0.005 ? `Balance: ${money(balance)}` : 'Paid in full — nothing further is due.');
    }
    // THE ORDER ITSELF, as a link. There is no PDF: a page they can open, read and print is what a
    // customer actually wants, and it is always current rather than a snapshot of this moment.
    if (str(docUrl)) { lines.push(''); lines.push('Your order, showing what has been paid:'); lines.push(str(docUrl)); }
    if (transactionId) { lines.push(''); lines.push(`Reference: ${str(transactionId)}`); }
    lines.push('');
    lines.push(`Reply to this email and it reaches us at ${s.replyTo}.`);
    lines.push('');
    lines.push(s.merchant);

    const rows = total > 0 ? [
        ['Order total', money(total)],
        ['Paid to date', money(paid)],
        [balance !== null && balance > 0.005 ? 'Balance' : 'Status', balance !== null && balance > 0.005 ? money(balance) : 'Paid in full'],
    ] : [];

    const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#1c1a16;font-size:15px;line-height:1.5;max-width:520px">
<p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#b08d57;margin:0 0 18px">${esc(s.merchant)}</p>
<p style="margin:0 0 14px">Thank you${customerName ? `, ${esc(customerName)}` : ''}.</p>
<p style="margin:0 0 18px">We have received <strong>${money(amount)}</strong> for ${esc(reference) || 'your order'}.</p>
${rows.length ? `<table style="border-collapse:collapse;margin:0 0 18px">${rows.map(([k, v]) => `<tr><td style="padding:4px 18px 4px 0;color:#524e46">${esc(k)}</td><td style="padding:4px 0;text-align:right"><strong>${esc(v)}</strong></td></tr>`).join('')}</table>` : ''}
${str(docUrl) ? `<p style="margin:0 0 18px"><a href="${esc(docUrl)}" style="display:inline-block;padding:10px 18px;background:#1c1a16;color:#fff;text-decoration:none;font-size:14px">View your order</a></p>
<p style="margin:0 0 18px;font-size:12px;color:#524e46">Or open ${esc(docUrl)}</p>` : ''}
${transactionId ? `<p style="margin:0 0 18px;font-size:12px;color:#524e46">Reference ${esc(transactionId)}</p>` : ''}
<p style="margin:0 0 6px;font-size:13px;color:#524e46">Reply to this email and it reaches us at ${esc(s.replyTo)}.</p>
<p style="margin:18px 0 0;font-size:13px">${esc(s.merchant)}</p>
</div>`;

    return { subject, text: lines.join('\n'), html, from: s.from, replyTo: s.replyTo };
}

module.exports = { SENDERS, senderFor, looksLikeEmail, dedupeKeyOf, paymentReceivedEmail, money };
