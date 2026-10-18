// 📄 A CUSTOMER'S OWN SALES ORDER, opened from the link in their receipt.
//
// Stuart 2026-09-23: "a copy of the sales order from the app showing the deposit amount". There is
// no PDF and a browser-made one cannot run unattended, so the email carries a link to this page.
// It is better than an attachment in one way worth stating: it is always CURRENT. A deposit taken
// today and a balance settled next week both show here, where a PDF would be a snapshot of the
// moment it was made and would quietly go out of date in the customer's inbox.
//
// The token in the address is the credential, as the pay page's is. No login, nothing to remember.
// Print works from the browser, which is also how the office makes its own PDFs.
import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const fmt = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (ms) => (ms ? new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');

const sayable = (e, fallback) => {
  const m = String((e && e.message) || '');
  return /not valid|expired|could not be found/i.test(m) ? m : fallback;
};

export default function Doc({ token }) {
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!token) { setErr('This link is not valid.'); return; }
    httpsCallable(functions, 'docIntent')({ token })
      .then((res) => setDoc(res.data))
      .catch((e) => setErr(sayable(e, 'This order could not be opened. Please contact us and we will send it again.')));
  }, [token]);

  if (err) {
    return (
      <div className="gate">
        <div className="gate-card" style={{ textAlign: 'center' }}>
          <span className="eyebrow">Your order</span>
          <h1 style={{ marginBottom: 6 }}>Not available</h1>
          <p className="sub">{err}</p>
        </div>
      </div>
    );
  }
  if (!doc) return <div className="loading">One moment…</div>;

  const priced = doc.lines.some((l) => l.amount !== null && l.amount !== undefined);

  return (
    <div className="gate" style={{ alignItems: 'flex-start' }}>
      <div className="gate-card" style={{ maxWidth: 680, width: '100%' }}>
        <span className="eyebrow">{doc.merchantName}</span>
        <h1 style={{ marginBottom: 4 }}>{doc.kind === 'INVOICE' ? 'Invoice' : 'Sales order'}</h1>
        <p className="sub" style={{ marginBottom: 18 }}>
          {doc.nsInvoiceNo || doc.reference}
          {doc.orderDate ? <><br />{day(doc.orderDate)}</> : null}
          {doc.customerName ? <><br />{doc.customerName}</> : null}
          {doc.poNumber ? <><br />PO {doc.poNumber}</> : null}
          {doc.sidemark ? <><br />{doc.sidemark}</> : null}
        </p>

        {doc.lines.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, marginBottom: 18 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 0', borderBottom: '1px solid rgba(28,26,22,.14)', fontWeight: 500 }}>Item</th>
                <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid rgba(28,26,22,.14)', fontWeight: 500, width: 54 }}>Qty</th>
                {priced && <th style={{ textAlign: 'right', padding: '6px 0', borderBottom: '1px solid rgba(28,26,22,.14)', fontWeight: 500, width: 96 }}>Amount</th>}
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={i}>
                  <td style={{ padding: '8px 0', verticalAlign: 'top' }}>
                    {l.name || l.code}
                    {l.code && l.name ? <div style={{ fontSize: 12, opacity: 0.65 }}>{l.code}</div> : null}
                    {l.note ? <div style={{ fontSize: 12, opacity: 0.65 }}>{l.note}</div> : null}
                  </td>
                  <td style={{ padding: '8px 0', textAlign: 'right', verticalAlign: 'top' }}>{l.qty}</td>
                  {priced && <td style={{ padding: '8px 0', textAlign: 'right', verticalAlign: 'top' }}>{l.amount === null ? '—' : fmt(l.amount)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* THE MONEY, and what is left of it. The whole reason the email exists. */}
        <div style={{ borderTop: '2px solid #1c1a16', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row k="Order total" v={fmt(doc.total)} />
          {doc.paid > 0 && <Row k="Paid" v={`−${fmt(doc.paid)}`} />}
          <Row k={doc.paidInFull ? 'Paid in full' : 'Balance'} v={fmt(doc.balance)} big />
        </div>
        {doc.paidNote && <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 10 }}>{doc.paidNote}</p>}

        <div style={{ marginTop: 22, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => window.print()}>Print or save as PDF</button>
        </div>
        <p style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 14 }}>
          This page always shows the current state of your order, so it stays right as things change.
        </p>
      </div>
    </div>
  );
}

const Row = ({ k, v, big = false }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
    <span style={{ fontSize: big ? 15 : 14, color: big ? 'var(--ink)' : 'var(--ink-soft)' }}>{k}</span>
    <span style={{ fontSize: big ? 22 : 15, fontFamily: big ? 'var(--serif, Georgia)' : undefined }}>{v}</span>
  </div>
);
