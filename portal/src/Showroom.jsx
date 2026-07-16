// Showroom = the customer's product picker. Each product is one assigned CPQ flow (portalCatalog);
// selecting one opens the live Configurator (3D + flow steps), exactly like the internal Vision/CPQ
// tools but scoped to the flows enabled on their account.
import React, { lazy, Suspense, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

const Configurator = lazy(() => import('./Configurator.jsx'));

const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function Showroom() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(null); // { flowId, name }

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalCatalog')()
      .then((res) => { if (alive) setData(res.data); })
      .catch(() => { if (alive) setErr('Could not load your product showroom right now — please try again shortly.'); });
    return () => { alive = false; };
  }, []);

  if (active) {
    return (
      <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Loading configurator…</div>}>
        <Configurator flowId={active.flowId} flowName={active.name} onExit={() => setActive(null)} />
      </Suspense>
    );
  }

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your showroom…</div>;

  const items = data.items || [];
  if (items.length === 0) {
    return <div className="empty" style={{ marginTop: 24 }}>Your showroom hasn't been set up yet — contact your Classical Elements representative to have your product lines enabled.</div>;
  }

  return (
    <div className="catalog">
      {items.map((it) => (
        <button key={it.flowId || it.id} className="catalog-card" onClick={() => setActive({ flowId: it.flowId, name: it.name })}>
          <span className="c-name">{it.name}</span>
          {it.sku ? <span className="c-sku">{it.sku}</span> : null}
          <span className="c-cta">
            {it.price !== null ? <span className="c-price">Starting at {fmtMoney(it.price)}</span> : <span />}
            <span className="c-open">Configure →</span>
          </span>
        </button>
      ))}
    </div>
  );
}
