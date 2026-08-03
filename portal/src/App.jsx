import React, { useEffect, useState, lazy, Suspense } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

const Showroom = lazy(() => import('./Showroom.jsx'));
const VisionIntake = lazy(() => import('./VisionIntake.jsx'));
const QuickShip = lazy(() => import('./QuickShip.jsx'));
const Gallery = lazy(() => import('./Gallery.jsx'));
const Tools = lazy(() => import('./Tools.jsx'));

const fmtMoney = (v) => (v === null || v === undefined) ? '' :
  Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const stageClass = (stage) => {
  if (/ship/i.test(stage)) return 's-shipping';
  if (/finish/i.test(stage)) return 's-finishing';
  if (/production/i.test(stage)) return 's-production';
  return 's-received';
};

// Quote pipeline statuses → client-friendly words.
const QUOTE_LABELS = {
  PORTAL_REQUEST: 'Sent — awaiting pricing',
  CONFIGURED: 'In review',
  SENT_TO_CLIENT: 'Awaiting your approval',
  REVISION_REQUESTED: 'Revising',
  APPROVED: 'Approved',
  TRANSMITTED_TO_ERP: 'Order placed',
  SO_CONFIRMED: 'Order placed',
  IN_PRODUCTION: 'In production',
  COMPLETED: 'Completed',
  SHIPPED: 'Shipped',
  CANCELLED: 'Cancelled',
};

// Their own part # gets its own column — but only when the order actually carries them, so a
// customer without mapped numbers doesn't stare at an empty column.
const LineTable = ({ lines }) => {
  if (!lines?.length) return null;
  const anySku = lines.some((l) => l.sku);
  return (
    <div className="lines">
      <table>
        <thead>
          <tr>
            {anySku && <th style={{ width: 150 }}>Your Part #</th>}
            <th>Item</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 110 }}>Price</th><th style={{ width: 110 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              {anySku && <td className="sku">{l.sku || ''}</td>}
              <td>{l.name}</td>
              <td className="num">{l.qty || ''}</td>
              <td className="num">{fmtMoney(l.price)}</td>
              <td className="num">{fmtMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const OrderCard = ({ o, badge, badgeClass, onDelete }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="card">
      <div className="card-head" onClick={() => setOpen(!open)}>
        <div className="card-title">
          <div className="name">{o.name}{o.id ? <span className="date" style={{ marginLeft: 10 }}>#{o.id}</span> : null}</div>
          {o.sidemark ? <div className="side">{o.sidemark}</div> : null}
        </div>
        <span className="date">{fmtDate(o.date)}</span>
        {o.total !== null && o.total !== undefined ? <span className="total">{fmtMoney(o.total)}</span> : null}
        <span className={`stage ${badgeClass}`}>{badge}</span>
      </div>
      {open && (
        <>
          {/* A quote you just sent has no prices yet — say so, rather than showing blank money. */}
          {o.awaitingPricing && (
            <div className="await-note">Your request is with the team — this is what you sent. Pricing follows shortly.</div>
          )}
          <LineTable lines={o.lines} />
          {onDelete && o.canDelete && (
            <div className="card-foot">
              <button className="btn-ghost danger" onClick={(e) => { e.stopPropagation(); onDelete(o); }}>Delete this quote</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const SignIn = () => {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(null); // { ok, text }
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setMsg(null); setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (err) {
      const code = err?.code || '';
      setMsg({
        ok: false,
        text: code === 'auth/user-disabled' ? 'This account has been disabled. Contact your Classical Elements representative.'
          : code === 'auth/too-many-requests' ? 'Too many attempts — try again in a few minutes.'
          : 'Email or password is incorrect.',
      });
    } finally { setBusy(false); }
  };

  const forgot = async () => {
    setMsg(null);
    if (!email.trim()) { setMsg({ ok: false, text: 'Enter your email above first, then tap "Forgot password".' }); return; }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg({ ok: true, text: `Password reset email sent to ${email.trim()}.` });
    } catch (err) {
      setMsg({ ok: false, text: 'Could not send the reset email — check the address.' });
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <span className="eyebrow">Classical Elements</span>
        <h1>Client Portal</h1>
        <p className="sub">Sign in to view your quotes and order status.</p>
        <form className="gate-form" onSubmit={submit}>
          <input type="email" placeholder="you@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <input type="password" placeholder="Password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="btn" disabled={busy || !email || !pw}>{busy ? 'Signing in…' : 'Sign In'}</button>
        </form>
        {msg && <div className={`msg${msg.ok ? ' ok' : ''}`}>{msg.text}</div>}
        <div style={{ textAlign: 'center', marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
          <button className="btn-ghost" onClick={forgot}>Forgot password</button>
        </div>
      </div>
    </div>
  );
};

const Orders = () => {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [note, setNote] = useState(null);

  const load = (alive = { v: true }) => {
    httpsCallable(functions, 'portalMyOrders')()
      .then((res) => { if (alive.v) setData(res.data); })
      .catch((e) => {
        if (!alive.v) return;
        setErr(/permission/i.test(e.message || '')
          ? 'This login is not set up as a client portal account. Contact your Classical Elements representative.'
          : 'Could not load your orders right now — please try again shortly.');
      });
    return alive;
  };

  useEffect(() => {
    const alive = load();
    return () => { alive.v = false; };
  }, []);

  // Deleting withdraws the quote from your list and tells the Classical Elements team. Nothing is
  // erased on their side — they keep the record, marked deleted, so nobody chases a ghost.
  const deleteQuote = async (q) => {
    const why = window.prompt(`Delete quote ${q.id}?\n\nIt is withdrawn from your list and your Classical Elements team is notified.\n\nOptional — tell them why:`, '');
    if (why === null) return;
    setBusyId(q.docId || q.id); setNote(null);
    try {
      await httpsCallable(functions, 'portalDeleteQuote')({ quoteId: q.docId || q.id, reason: why });
      setData((d) => (d ? { ...d, quotes: d.quotes.filter((x) => (x.docId || x.id) !== (q.docId || q.id)) } : d));
      setNote({ ok: true, text: `Quote ${q.id} deleted. Your team has been notified.` });
    } catch (e) {
      setNote({ ok: false, text: /failed-precondition|approved/i.test(e.message || '')
        ? 'That quote has already been approved or ordered — please contact your representative.'
        : 'Could not delete it just now — please try again shortly.' });
    } finally { setBusyId(null); }
  };

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your orders…</div>;

  const { quotes = [], orders = [] } = data;
  return (
    <>
      <h2 className="sec">Orders in progress<span className="count">{orders.length}</span></h2>
      {orders.length === 0
        ? <div className="empty">No orders in progress. Your quotes appear below — contact us to place an order.</div>
        : orders.map((o) => <OrderCard key={o.id} o={o} badge={o.stage} badgeClass={stageClass(o.stage)} />)}

      <h2 className="sec">Quotes<span className="count">{quotes.length}</span></h2>
      {note && <div className={`msg${note.ok ? ' ok' : ''}`} style={{ marginBottom: 14 }}>{note.text}</div>}
      {quotes.length === 0
        ? <div className="empty">No open quotes. Reach out to your representative to start one.</div>
        : quotes.map((q) => (
            <OrderCard key={q.docId || q.id} o={q}
              badge={busyId === (q.docId || q.id) ? 'Deleting…' : (QUOTE_LABELS[q.status] || 'In review')}
              badgeClass="s-received" onDelete={deleteQuote} />
          ))}
    </>
  );
};

const TABS = [
  { id: 'orders', label: 'Orders & Quotes' },
  { id: 'showroom', label: 'Showroom' },
  { id: 'measure', label: 'Measure & Fit' },
  { id: 'quickship', label: 'Quick Ship' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'tools', label: 'Tools, Specs & FAQs' },
];

const Dashboard = ({ user }) => {
  const [tab, setTab] = useState('orders');
  const [branding, setBranding] = useState(null);
  // Branding is cosmetic — a failure here must never keep the portal from loading.
  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalBranding')()
      .then((r) => { if (alive) setBranding(r.data); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return (
    <div className="shell">
      <Header user={user} branding={branding} />
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      {tab === 'orders' && <Orders />}
      {tab === 'showroom' && (
        <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading the 3D showroom…</div>}>
          <Showroom />
        </Suspense>
      )}
      {tab === 'measure' && (
        <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading Measure &amp; Fit…</div>}>
          <VisionIntake />
        </Suspense>
      )}
      {tab === 'quickship' && (
        <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading the stock counter…</div>}>
          <QuickShip />
        </Suspense>
      )}
      {tab === 'gallery' && (
        <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading your gallery…</div>}>
          <Gallery />
        </Suspense>
      )}
      {tab === 'tools' && (
        <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading tools…</div>}>
          <Tools />
        </Suspense>
      )}
      <PortalFooter />
    </div>
  );
};

// Their logo sits beside ours at the top — this is their portal, so it should look like it
// (Stuart 2026-08-02). No logo loaded = exactly the header as it was.
const Header = ({ user, branding }) => (
  <div className="shell-head">
    <div className="brand">
      {branding?.logoUrl
        ? <img className="client-logo" src={branding.logoUrl} alt={branding.customerName || 'Client'} />
        : null}
      <div>
        <span className="eyebrow">Classical Elements</span>
        <h1>{branding?.customerName ? `${branding.customerName} — Client Portal` : 'Client Portal'}</h1>
      </div>
    </div>
    <div className="who">
      <span>{user.email}</span>
      <button className="btn-ghost" onClick={() => signOut(auth)}>Sign Out</button>
    </div>
  </div>
);

const PortalFooter = () => (
  <footer className="portal">
    <span>Classical Elements</span>
    <a href="https://www.classicalelements.com">www.classicalelements.com</a>
  </footer>
);

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) return <div className="loading">One moment…</div>;
  return user ? <Dashboard user={user} /> : <SignIn />;
}
