import React, { useCallback, useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// THE PORTAL'S OWN CHECKOUT — a signed-in trade customer pays their own quotes, orders and
// invoices, and keeps cards for next time (Stuart 2026-09-23: customers save their own).
//
// The card itself is never ours: the fields below are the gateway's (Collect.js), a saved card is
// held in the gateway's vault, and we keep only its brand and last four to show. What is owed is
// decided by the server from the document — this page can only offer what it is given.

const fmt = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DOC_WORDS = { QUOTE: 'Quote', SALES_ORDER: 'Sales order', INVOICE: 'Invoice' };
const sayable = (e, fallback) => {
  const m = String((e && e.message) || '').trim();
  if (!m || /^(internal|unknown|unavailable|deadline-exceeded|not-found|failed-precondition|permission-denied)$/i.test(m) || m.length > 200) return fallback;
  return m;
};
const fieldBox = { border: '1px solid var(--line)', background: 'var(--card)', height: 46, padding: '0 12px', display: 'flex', alignItems: 'center' };

export default function Payments() {
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState(null);     // open invoices in NetSuite (not raised here)
  const [pickedInv, setPickedInv] = useState({});
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [paying, setPaying] = useState(null);      // the payable being paid
  const [amount, setAmount] = useState('');
  const [useCard, setUseCard] = useState('');      // vault id, or '' for a new card
  const [saveCard, setSaveCard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fieldsReady, setFieldsReady] = useState(false);
  const configured = useRef(false);
  const pending = useRef(null);                    // what to do when the gateway returns a token

  const load = useCallback(() => {
    httpsCallable(functions, 'portalPayables')()
      .then((res) => setData(res.data))
      .catch((e) => setErr(sayable(e, 'Your account could not be loaded just now.')));
    // Invoices that live in our accounting system rather than here — shown with their due dates.
    httpsCallable(functions, 'portalOpenInvoices')()
      .then((res) => { setInvoices(res.data.invoices || []); setPickedInv({}); })
      .catch(() => setInvoices([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  // The gateway's card fields, loaded once, reused by "pay with a new card" and "add a card".
  useEffect(() => {
    if (!data || configured.current || !data.tokenizationKey) return;
    configured.current = true;
    const s = document.createElement('script');
    s.src = data.collectJsUrl;
    s.async = true;
    s.setAttribute('data-tokenization-key', data.tokenizationKey);
    s.setAttribute('data-variant', 'inline');
    s.onload = () => {
      if (!window.CollectJS) { setErr('The card form could not be loaded. Please refresh.'); return; }
      window.CollectJS.configure({
        variant: 'inline',
        styleSniffer: false,
        customCss: { 'font-family': 'Inter, -apple-system, sans-serif', 'font-size': '15px', color: '#1c1a16' },
        invalidCss: { color: '#9b2c2c' },
        fields: {
          ccnumber: { selector: '#pcc-number', placeholder: 'Card number' },
          ccexp: { selector: '#pcc-exp', placeholder: 'MM / YY' },
          cvv: { selector: '#pcc-cvv', placeholder: 'CVV' },
        },
        fieldsAvailableCallback: () => setFieldsReady(true),
        callback: (r) => {
          const job = pending.current;
          pending.current = null;
          if (!job) { setBusy(false); return; }
          if (job.kind === 'PAY_INVOICES') {
            httpsCallable(functions, 'portalPayInvoices')({ ...job.payload, paymentToken: r.token })
              .then((res) => { setNote(`Thank you — ${fmt(res.data.amount)} paid. Confirmation ${res.data.transactionId}.`); load(); })
              .catch((e) => setErr(sayable(e, 'The payment could not be completed. Your card has not been charged.')))
              .finally(() => setBusy(false));
          } else if (job.kind === 'SAVE') {
            httpsCallable(functions, 'portalSaveCard')({ paymentToken: r.token })
              .then(() => { setNote('Card saved.'); load(); })
              .catch((e) => setErr(sayable(e, 'That card could not be saved.')))
              .finally(() => setBusy(false));
          } else {
            httpsCallable(functions, 'portalPayDoc')({ ...job.payload, paymentToken: r.token })
              .then((res) => { setNote(`Thank you — ${fmt(res.data.amount)} paid. Confirmation ${res.data.transactionId}.`); setPaying(null); load(); })
              .catch((e) => setErr(sayable(e, 'The payment could not be completed. Your card has not been charged.')))
              .finally(() => setBusy(false));
          }
        },
      });
    };
    document.body.appendChild(s);
  }, [data, load]);

  const startPay = (p) => {
    setErr(''); setNote('');
    setPaying(p); setAmount(Number(p.suggested).toFixed(2));
    setUseCard((data.cards[0] && data.cards[0].vaultId) || '');
  };

  const pay = (e) => {
    e.preventDefault();
    setErr(''); setNote('');
    const amt = Number(amount);
    if (!(amt > 0 && amt <= Number(paying.maxAmount))) {
      setErr(`Please enter an amount up to ${fmt(paying.maxAmount)}.`);
      return;
    }
    setBusy(true);
    const payload = { collection: paying.collection, docId: paying.docId, amount: amt };
    if (useCard) {
      httpsCallable(functions, 'portalPayDoc')({ ...payload, vaultId: useCard })
        .then((res) => { setNote(`Thank you — ${fmt(res.data.amount)} paid. Confirmation ${res.data.transactionId}.`); setPaying(null); load(); })
        .catch((e) => setErr(sayable(e, 'The payment could not be completed. Your card has not been charged.')))
        .finally(() => setBusy(false));
    } else {
      pending.current = { kind: 'PAY', payload: { ...payload, saveCard } };
      window.CollectJS.startPaymentRequest();
    }
  };

  const chosenInvoices = (invoices || []).filter((i) => pickedInv[i.id]);
  const chosenInvoiceTotal = chosenInvoices.reduce((s2, i) => s2 + Number(i.due || 0), 0);

  const payInvoices = () => {
    if (!chosenInvoices.length) return;
    setErr(''); setNote(''); setBusy(true);
    const payload = { invoiceIds: chosenInvoices.map((i) => i.id) };
    if (useCard) {
      httpsCallable(functions, 'portalPayInvoices')({ ...payload, vaultId: useCard })
        .then((res) => { setNote(`Thank you — ${fmt(res.data.amount)} paid. Confirmation ${res.data.transactionId}.`); load(); })
        .catch((e) => setErr(sayable(e, 'The payment could not be completed. Your card has not been charged.')))
        .finally(() => setBusy(false));
    } else {
      pending.current = { kind: 'PAY_INVOICES', payload: { ...payload, saveCard } };
      window.CollectJS.startPaymentRequest();
    }
  };

  const addCard = () => {
    setErr(''); setNote(''); setBusy(true);
    pending.current = { kind: 'SAVE' };
    window.CollectJS.startPaymentRequest();
  };

  const removeCard = (vaultId) => {
    if (!window.confirm('Remove this card from your account?')) return;
    httpsCallable(functions, 'portalDeleteCard')({ vaultId })
      .then(() => { setNote('Card removed.'); load(); })
      .catch((e) => setErr(sayable(e, 'That card could not be removed.')));
  };

  if (err && !data) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your account…</div>;

  const { payables = [], cards = [] } = data;

  return (
    <>
      {data.environment !== 'PRODUCTION' && <div className="msg" style={{ marginTop: 16 }}>TEST MODE — no card is charged.</div>}
      {note && <div className="msg ok" style={{ marginTop: 16 }}>{note}</div>}
      {err && <div className="msg" style={{ marginTop: 16 }}>{err}</div>}

      <h2 className="sec">Amounts due<span className="count">{payables.length}</span></h2>
      {payables.length === 0 && <div className="empty">Nothing is due at the moment.</div>}

      {payables.map((p) => (
        <div className="card" key={`${p.collection}-${p.docId}`} style={{ padding: '14px 16px', marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 500 }}>{DOC_WORDS[p.docType] || 'Document'} {p.reference}</span>
            <span style={{ color: 'var(--ink-soft)', fontSize: '0.88rem' }}>
              Total {fmt(p.total)}{p.paid > 0 ? ` · paid ${fmt(p.paid)}` : ''} · balance {fmt(p.balance)}
            </span>
            <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => startPay(p)}>
              {paying && paying.docId === p.docId ? 'Close' : 'Pay'}
            </button>
          </div>

          {paying && paying.docId === p.docId && (
            <form className="gate-form" style={{ marginTop: 14 }} onSubmit={pay}>
              <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                Amount
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} style={{ marginTop: 6 }} />
                <span style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                  {p.docType === 'INVOICE'
                    ? `Invoices are paid in full — ${fmt(p.balance)}.`
                    : `${fmt(p.suggested)} deposit is suggested; you may pay up to ${fmt(p.balance)}.`}
                </span>
              </label>

              {cards.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {cards.map((c) => (
                    <label key={c.vaultId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <input type="radio" name="card" checked={useCard === c.vaultId} onChange={() => setUseCard(c.vaultId)} />
                      {c.brand} ending {c.last4}{c.exp ? ` · ${String(c.exp).replace(/^(\d\d)(\d\d)$/, '$1/$2')}` : ''}
                    </label>
                  ))}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                    <input type="radio" name="card" checked={useCard === ''} onChange={() => setUseCard('')} /> Use a new card
                  </label>
                </div>
              )}

              {useCard === '' && (
                <>
                  <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Enter the card below, then press Pay.</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
                    <input type="checkbox" checked={saveCard} onChange={(e) => setSaveCard(e.target.checked)} />
                    Save this card for next time
                  </label>
                </>
              )}

              <button className="btn" disabled={busy || (useCard === '' && !fieldsReady)}>
                {busy ? 'Processing…' : `Pay ${fmt(amount || 0)}`}
              </button>
            </form>
          )}
        </div>
      ))}

      <h2 className="sec">Invoices<span className="count">{(invoices || []).length}</span></h2>
      {invoices && invoices.length === 0 && <div className="empty">No open invoices.</div>}
      {invoices && invoices.length > 0 && (
        <div className="card" style={{ padding: '4px 0 14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
                <th style={{ padding: '8px 10px' }} />
                <th style={{ padding: '8px 10px' }}>Invoice</th>
                <th style={{ padding: '8px 10px' }}>Date</th>
                <th style={{ padding: '8px 10px' }}>Due</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => {
                const late = i.dueDate && new Date(i.dueDate) < new Date();
                return (
                  <tr key={i.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px' }}>
                      <input type="checkbox" checked={!!pickedInv[i.id]} onChange={(e) => setPickedInv({ ...pickedInv, [i.id]: e.target.checked })} />
                    </td>
                    <td style={{ padding: '8px 10px' }}>{i.tranid}</td>
                    <td style={{ padding: '8px 10px' }}>{i.date ? new Date(i.date).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '8px 10px', color: late ? '#9b2c2c' : 'inherit' }}>
                      {i.dueDate ? new Date(i.dueDate).toLocaleDateString() : '—'}{late ? ' · overdue' : ''}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>{fmt(i.due)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {chosenInvoices.length > 0 && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px 0' }}>
              <span>{chosenInvoices.length} selected · <strong>{fmt(chosenInvoiceTotal)}</strong></span>
              {cards.length > 0 && (
                <select value={useCard} onChange={(e) => setUseCard(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--line)', background: 'var(--card)' }}>
                  {cards.map((c) => <option key={c.vaultId} value={c.vaultId}>{c.brand} ending {c.last4}</option>)}
                  <option value="">Use the card entered below</option>
                </select>
              )}
              <button className="btn" style={{ width: 'auto', padding: '10px 18px' }} disabled={busy || (!useCard && !fieldsReady)} onClick={payInvoices}>
                {busy ? 'Processing…' : `Pay ${fmt(chosenInvoiceTotal)}`}
              </button>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Invoices are paid in full.</span>
            </div>
          )}
        </div>
      )}

      <h2 className="sec">Saved cards<span className="count">{cards.length}</span></h2>
      {cards.length === 0 && <div className="empty">No saved cards. You can save one when you pay.</div>}
      {cards.map((c) => (
        <div className="card" key={c.vaultId} style={{ padding: '12px 16px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{c.brand} ending {c.last4}{c.exp ? ` · expires ${String(c.exp).replace(/^(\d\d)(\d\d)$/, '$1/$2')}` : ''}</span>
          <button className="btn-ghost" style={{ marginLeft: 'auto' }} onClick={() => removeCard(c.vaultId)}>Remove</button>
        </div>
      ))}

      {/* ONE set of card fields for the whole page — they are the gateway's iframes and can only
          live in one place, so paying with a new card and saving a card both use these. */}
      <div className="card" style={{ padding: '14px 16px', marginTop: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginBottom: 10 }}>
          {paying && useCard === '' ? 'Card details for this payment' : 'Card details'}
        </div>
        <div id="pcc-number" style={fieldBox} />
        <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
          <div id="pcc-exp" style={{ ...fieldBox, flex: 1 }} />
          <div id="pcc-cvv" style={{ ...fieldBox, flex: 1 }} />
        </div>
        {!(paying && useCard === '') && (
          <button className="btn" style={{ marginTop: 12 }} disabled={busy || !fieldsReady} onClick={addCard}>
            {busy ? 'Saving…' : 'Save this card for next time'}
          </button>
        )}
      </div>

      <p style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-soft)' }}>
        Card details are entered directly with our payment provider over an encrypted connection —
        Classical Elements never receives or stores your card number. See <a href="#/policies/security">Payments &amp; Security</a>.
      </p>
    </>
  );
}
