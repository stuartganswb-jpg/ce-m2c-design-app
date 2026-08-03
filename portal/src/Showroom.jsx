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
  const [pickSizes, setPickSizes] = useState(null); // size-group landing: { name, sizes: [{flowId, choice}] }

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

  // Rod-diameter landing for a size-group product (the per-assembly model, e.g. Simple
  // Elegance): one showroom card, then "pick rod diameter first" — each card opens that
  // diameter's own flow, exactly like the internal CPQ landing.
  if (pickSizes) {
    return (
      <div style={{ marginTop: 24 }}>
        <button className="btn-ghost" onClick={() => setPickSizes(null)}>← All products</button>
        <h2 className="sec" style={{ marginTop: 14 }}>{pickSizes.name} — pick your rod diameter</h2>
        <div className="catalog">
          {pickSizes.sizes.map((s) => (
            <button key={s.flowId} className="catalog-card" onClick={() => { setActive({ flowId: s.flowId, name: `${pickSizes.name} — ${s.choice}` }); setPickSizes(null); }}>
              <span className="c-name">{s.choice}</span>
              <span className="c-cta"><span /><span className="c-open">Configure →</span></span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (err) return <div className="empty" style={{ marginTop: 24 }}>{err}</div>;
  if (!data) return <div className="empty" style={{ marginTop: 24 }}>Loading your showroom…</div>;

  const items = data.items || [];
  if (items.length === 0) {
    // The BFF already distinguishes WHY the showroom is empty — it has for a while — but this
    // screen collapsed every cause into one sentence, so "no flows assigned" and "the collection
    // filter ate everything" looked identical (Stuart 2026-08-03: "the fabricut H1 collection
    // which is marked on the crm portal access … is no longer available?"). Name the cause: the
    // two are fixed in different places in the CRM.
    const why = data.reason === 'NO_COLLECTIONS'
      ? 'Your product lines are assigned, but the collection filter on your account is hiding all of them.'
      : "Your showroom hasn't been set up yet.";
    return (
      <div className="empty" style={{ marginTop: 24 }}>
        {why} Contact your Classical Elements representative to have your product lines enabled.
        {data.reason ? <span className="why-code"> ({data.reason})</span> : null}
      </div>
    );
  }

  return (
    <div className="catalog">
      {items.map((it) => (
        <button key={it.flowId || it.id} className="catalog-card" onClick={() => it.isGroup ? setPickSizes({ name: it.name, sizes: it.sizes || [] }) : setActive({ flowId: it.flowId, name: it.name })}>
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
