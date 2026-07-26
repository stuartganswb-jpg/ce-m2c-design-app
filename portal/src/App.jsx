import React, { useEffect, useState, lazy, Suspense } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';

const Showroom = lazy(() => import('./Showroom.jsx'));
const VisionIntake = lazy(() => import('./VisionIntake.jsx'));
const QuickShip = lazy(() => import('./QuickShip.jsx'));

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

const LineTable = ({ lines }) => (
  !lines?.length ? null : (
    <div className="lines">
      <table>
        <thead>
          <tr><th>Item</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 110 }}>Price</th><th style={{ width: 110 }}>Total</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i}>
              <td>{l.name}</td>
              <td className="num">{l.qty || ''}</td>
              <td className="num">{fmtMoney(l.price)}</td>
              <td className="num">{fmtMoney(l.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
);

const OrderCard = ({ o, badge, badgeClass }) => {
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
      {open && <LineTable lines={o.lines} />}
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

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalMyOrders')()
      .then((res) => { if (alive) setData(res.data); })
      .catch((e) => {
        if (!alive) return;
        setErr(/permission/i.test(e.message || '')
          ? 'This login is not set up as a client portal account. Contact your Classical Elements representative.'
          : 'Could not load your orders right now — please try again shortly.');
      });
    return () => { alive = false; };
  }, []);

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
      {quotes.length === 0
        ? <div className="empty">No open quotes. Reach out to your representative to start one.</div>
        : quotes.map((q) => <OrderCard key={q.id} o={q} badge={QUOTE_LABELS[q.status] || 'In review'} badgeClass="s-received" />)}
    </>
  );
};

const TABS = [
  { id: 'orders', label: 'Orders & Quotes' },
  { id: 'showroom', label: 'Showroom' },
  { id: 'measure', label: 'Measure & Fit' },
  { id: 'quickship', label: 'Quick Ship' },
];

const Dashboard = ({ user }) => {
  const [tab, setTab] = useState('orders');
  return (
    <div className="shell">
      <Header user={user} />
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
      <PortalFooter />
    </div>
  );
};

const Header = ({ user }) => (
  <div className="shell-head">
    <div>
      <span className="eyebrow">Classical Elements</span>
      <h1>Client Portal</h1>
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
