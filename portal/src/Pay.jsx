import React, { useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// THE PAY PAGE — what a customer opens from the link on a quote, sales order or invoice
// (#/pay/<token>). No login: the token IS the credential, and it is single-use, time-limited and
// revocable. Card fields are NMI's own (Collect.js), so card numbers go straight from the
// customer's browser to the gateway and never touch our systems — the page only ever holds NMI's
// one-time token. The amount is decided by the server (a sales order defaults to a 50% deposit and
// may be paid up, an invoice is paid in full); this page can only offer what payIntent allows.

const fmt = (v) => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// A customer must never read a system word. Our own refusals (expired link, declined card) are
// written for them and pass through; anything else becomes one plain sentence.
const sayable = (e, fallback) => {
  const m = String((e && e.message) || '').trim();
  if (!m || /^(internal|unknown|unavailable|deadline-exceeded|not-found|failed-precondition)$/i.test(m) || m.length > 200) return fallback;
  return m;
};
const DOC_WORDS = { QUOTE: 'Quote', SALES_ORDER: 'Sales Order', INVOICE: 'Invoice' };

const fieldBox = {
  border: '1px solid var(--line)', background: 'var(--card)', height: 46, padding: '0 12px',
  display: 'flex', alignItems: 'center',
};

export default function Pay() {
  const token = useMemo(() => (window.location.hash.split('/')[2] || '').trim(), []);
  const [intent, setIntent] = useState(null);
  const [err, setErr] = useState('');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldsReady, setFieldsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const configured = useRef(false);

  // 1) What is owed, and which gateway keys this brand pays through.
  useEffect(() => {
    if (!token) { setErr('This payment link is not valid.'); return; }
    httpsCallable(functions, 'payIntent')({ token })
      .then((res) => { setIntent(res.data); setAmount(Number(res.data.amountDue).toFixed(2)); })
      .catch((e) => setErr(sayable(e, 'This payment link could not be opened. It may have expired or already been paid.')));
  }, [token]);

  // 2) NMI's hosted card fields. The script is loaded with the brand's public tokenization key;
  //    the inputs below are iframes served by NMI, not ours.
  useEffect(() => {
    if (!intent || configured.current) return;
    configured.current = true;
    const s = document.createElement('script');
    s.src = intent.collectJsUrl;
    s.async = true;
    s.setAttribute('data-tokenization-key', intent.tokenizationKey);
    s.setAttribute('data-variant', 'inline');
    s.onload = () => {
      if (!window.CollectJS) { setErr('The card form could not be loaded. Please refresh.'); return; }
      window.CollectJS.configure({
        variant: 'inline',
        styleSniffer: false,
        customCss: { 'font-family': 'Inter, -apple-system, sans-serif', 'font-size': '15px', color: '#1c1a16' },
        invalidCss: { color: '#9b2c2c' },
        placeholderCss: { color: '#8b867c' },
        fields: {
          ccnumber: { selector: '#cc-number', placeholder: 'Card number' },
          ccexp: { selector: '#cc-exp', placeholder: 'MM / YY' },
          cvv: { selector: '#cc-cvv', placeholder: 'CVV' },
        },
        fieldsAvailableCallback: () => setFieldsReady(true),
        callback: (r) => charge(r.token),
      });
    };
    s.onerror = () => setErr('The card form could not be loaded. Please refresh.');
    document.body.appendChild(s);
  }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps

  const charge = (paymentToken) => {
    httpsCallable(functions, 'payCharge')({ token, paymentToken, amount, payerName: name, email })
      .then((res) => setDone(res.data))
      .catch((e) => setErr(sayable(e, 'The payment could not be completed. Your card has not been charged — please try again or contact us.')))
      .finally(() => setBusy(false));
  };

  const submit = (e) => {
    e.preventDefault();
    setErr('');
    const amt = Number(amount);
    if (!(amt >= Number(intent.minAmount) && amt <= Number(intent.maxAmount))) {
      setErr(`Please enter an amount between ${fmt(intent.minAmount)} and ${fmt(intent.maxAmount)}.`);
      return;
    }
    if (!name.trim()) { setErr('Please enter the name on the card.'); return; }
    setBusy(true);
    window.CollectJS.startPaymentRequest();
  };

  // ── States ────────────────────────────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="gate">
        <div className="gate-card" style={{ textAlign: 'center' }}>
          <span className="eyebrow">Classical Elements</span>
          <h1 style={{ marginBottom: 6 }}>Thank you</h1>
          <p className="sub">
            {fmt(done.amount)} received for {done.reference || 'your order'}.<br />
            Confirmation number {done.transactionId}.
          </p>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            A receipt is on its way. Your Classical Elements team has been notified.
          </p>
          {done.environment !== 'PRODUCTION' && (
            <p style={{ fontSize: 12, color: '#9b6a2c' }}>TEST MODE — no money moved.</p>
          )}
        </div>
      </div>
    );
  }

  if (err && !intent) {
    return (
      <div className="gate">
        <div className="gate-card" style={{ textAlign: 'center' }}>
          <span className="eyebrow">Classical Elements</span>
          <h1 style={{ marginBottom: 6 }}>Payment link</h1>
          <p className="sub">{err}</p>
          <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            Please contact us at info@classicalelements.com or 1 (336) 967-3313 and we will send a new link.
          </p>
        </div>
      </div>
    );
  }

  if (!intent) return <div className="loading">One moment…</div>;

  const isInvoice = intent.docType === 'INVOICE';
  const canPayMore = Number(intent.maxAmount) > Number(intent.minAmount);

  return (
    <div className="gate">
      <div className="gate-card" style={{ maxWidth: 460 }}>
        <span className="eyebrow">Classical Elements</span>
        <h1 style={{ marginBottom: 4 }}>Payment</h1>
        <p className="sub">
          {DOC_WORDS[intent.docType] || 'Document'} {intent.reference}
          {intent.customerName ? <><br />{intent.customerName}</> : null}
        </p>

        {intent.environment !== 'PRODUCTION' && (
          <div className="msg" style={{ marginBottom: 14 }}>TEST MODE — no card is charged.</div>
        )}

        <div style={{ border: '1px solid var(--line)', padding: '14px 16px', marginBottom: 18, background: 'var(--card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, color: 'var(--ink-soft)' }}>
            <span>{isInvoice ? 'Amount due' : 'Order total'}</span><span>{fmt(intent.totalAmount)}</span>
          </div>
          {!isInvoice && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
              <span>Deposit due ({intent.depositPct}%)</span><span>{fmt(intent.amountDue)}</span>
            </div>
          )}
        </div>

        <form className="gate-form" onSubmit={submit}>
          <label style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            Amount to pay
            <input
              inputMode="decimal" value={amount} disabled={!canPayMore}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              style={{ marginTop: 6 }}
            />
            {canPayMore && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 12 }}>
                {fmt(intent.minAmount)} deposit is due — you may pay up to {fmt(intent.maxAmount)} in full.
              </span>
            )}
          </label>

          <input placeholder="Name on card" value={name} onChange={(e) => setName(e.target.value)} autoComplete="cc-name" />
          <input placeholder="Email for the receipt" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />

          <div id="cc-number" style={fieldBox} />
          <div style={{ display: 'flex', gap: 12 }}>
            <div id="cc-exp" style={{ ...fieldBox, flex: 1 }} />
            <div id="cc-cvv" style={{ ...fieldBox, flex: 1 }} />
          </div>

          <button className="btn" disabled={busy || !fieldsReady}>
            {busy ? 'Processing…' : `Pay ${fmt(amount || 0)}`}
          </button>
        </form>

        {err && <div className="msg" style={{ marginTop: 12 }}>{err}</div>}

        <p style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-soft)', textAlign: 'center' }}>
          Card details are entered directly with our payment provider over an encrypted connection —
          Classical Elements never receives or stores your card number.
          <br />
          <a href="#/policies/security">Payments &amp; Security</a> · <a href="#/policies/terms">Terms</a> · <a href="#/policies/returns">Returns</a>
        </p>
      </div>
    </div>
  );
}
