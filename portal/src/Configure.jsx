// THE CONFIGURE TAB (step 4 of the portal rebuild, 2026-10-14): the products this login may configure, the walk for one of
// them (ConfigWalk — HQ's engine on the server, HQ's drawing in the browser), and the request being built — several
// configurations, one request. Sending it lands ONE request in HQ, at the account's own pricing, where staff open it in
// CPQ; it appears under Orders & Quotes as "Sent — awaiting pricing". Nothing here prices anything that is kept.
import React, { Suspense, lazy, useEffect, useState } from 'react';
import { auth } from './firebase';
import { loadView, sendRequest, troubleOf } from './configApi';
import { readBasket, writeBasket, lineId, shownOf } from './configBasket';
import { answersOf } from './configAnswers';

const ConfigWalk = lazy(() => import('./ConfigWalk.jsx'));

const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const LEVEL_WORDS = { FAB_RETAIL: 'Retail', FAB_WHOLESALE: 'Wholesale', STANDARD: 'Your price' };

export default function Configure({ flows }) {
  const uid = (auth.currentUser && auth.currentUser.uid) || '';
  const [basket, setBasket] = useState(() => readBasket(uid));
  const [mode, setMode] = useState('list');                 // list | walk | basket | sent
  const [walk, setWalk] = useState(null);                   // { flow, start, editing }
  const [checks, setChecks] = useState({});                 // line id → { refusal, shown } as the server sees the line today
  const [sending, setSending] = useState(false);
  const [trouble, setTrouble] = useState(null);
  const [sent, setSent] = useState(null);

  const save = (next) => setBasket(writeBasket(uid, next));
  const flowOf = (id) => (flows || []).find((f) => f.id === id) || { id, name: 'Product' };

  const startWalk = (flow) => { setWalk({ flow, start: null, editing: null, key: Date.now() }); setMode('walk'); };
  const editLine = (line) => { setWalk({ flow: flowOf(line.flowId), start: { answers: answersOf(line.state) }, editing: line.id, key: Date.now() }); setMode('walk'); };
  const onAdd = (line) => {
    if (walk && walk.editing) save({ ...basket, lines: basket.lines.map((l) => (l.id === walk.editing ? { ...l, ...line, id: l.id } : l)) });
    else save({ ...basket, lines: [...basket.lines, { ...line, id: lineId() }] });
  };
  const removeLine = (id) => save({ ...basket, lines: basket.lines.filter((l) => l.id !== id) });

  // Every line, as the server sees it TODAY — a product changed in HQ since it was added says so here, before it is sent.
  useEffect(() => {
    if (mode !== 'basket' || !basket.lines.length) return undefined;
    let live = true;
    (async () => {
      const out = {};
      for (const l of basket.lines) {
        try { const v = await loadView({ flowId: l.flowId, state: l.state, ui: {} }); out[l.id] = { refusal: v.refusal, shown: shownOf(v) }; }
        catch (e) { out[l.id] = { refusal: { message: (await troubleOf(e)).text } }; }
        if (!live) return;
      }
      if (live) setChecks(out);
    })();
    return () => { live = false; };
  }, [mode, basket.lines]);

  const send = async () => {
    setSending(true); setTrouble(null);
    try {
      const res = await sendRequest({ lines: basket.lines.map((l) => ({ flowId: l.flowId, state: l.state })), note: basket.note, sidemark: basket.sidemark });
      setSent({ quoteNo: res.quoteNo || res.id, count: basket.lines.length });
      save({ lines: [], sidemark: '', note: '' });
      setMode('sent');
    } catch (e) {
      setTrouble(await troubleOf(e));
    } finally { setSending(false); }
  };

  if (mode === 'walk' && walk) {
    return (
      <Suspense fallback={<div className="empty" style={{ marginTop: 24 }}>Opening the configurator…</div>}>
        <ConfigWalk key={walk.key} flow={walk.flow} start={walk.start} editing={walk.editing} onAdd={onAdd}
          onLeave={() => setMode('list')} basketCount={basket.lines.length} onOpenBasket={() => setMode('basket')} />
      </Suspense>
    );
  }

  if (mode === 'sent' && sent) {
    return (
      <div className="cf-sent">
        <h2 className="sec">Request sent</h2>
        <p>Your request <b>{sent.quoteNo}</b> ({sent.count} configuration{sent.count === 1 ? '' : 's'}) is with the Classical Elements team. It is under <b>Orders &amp; Quotes</b> as "Sent — awaiting pricing" — your quote follows from our team at your account's pricing.</p>
        <button className="btn" onClick={() => { setSent(null); setMode('list'); }}>Configure another</button>
      </div>
    );
  }

  if (mode === 'basket') {
    const total = basket.lines.reduce((n, l) => n + (Number(((checks[l.id] || {}).shown || l.shown || {}).totalForAll) || 0), 0);
    const anyMoney = basket.lines.some((l) => ((checks[l.id] || {}).shown || l.shown || {}).totalForAll != null);
    const blocked = basket.lines.some((l) => (checks[l.id] || {}).refusal);
    return (
      <div className="cf-basket">
        <div className="cf-top">
          <button className="btn-ghost" onClick={() => setMode('list')}>← All products</button>
          <div className="cf-title">Your request</div>
          <span />
        </div>
        {!basket.lines.length && <div className="empty">Nothing in your request yet — configure a product and add it.</div>}
        {basket.lines.map((l, i) => {
          const c = checks[l.id] || {};
          const shown = c.shown || l.shown || {};
          const lineTrouble = c.refusal || (trouble && trouble.line === i + 1 ? { message: trouble.text } : null);
          return (
            <div key={l.id} className={`card cf-bline${lineTrouble ? ' warn' : ''}`}>
              <div className="card-head">
                <div className="card-title">
                  <div className="name">{l.flowName}{l.qty > 1 ? ` × ${l.qty}` : ''}</div>
                  {l.memo ? <div className="side">{l.memo}</div> : null}
                  {lineTrouble ? <div className="side cf-refusal">{lineTrouble.message}</div> : null}
                </div>
                <span className="date">{shown.parts ? `${shown.parts} part${shown.parts === 1 ? '' : 's'}` : ''}</span>
                {shown.totalForAll != null ? <span className="total">{fmtMoney(shown.totalForAll)}{shown.onReview ? ' +' : ''}</span> : <span className="date">priced by our team</span>}
                <button className="btn-ghost" onClick={() => editLine(l)}>Edit</button>
                <button className="btn-ghost danger" onClick={() => removeLine(l.id)}>Remove</button>
              </div>
            </div>
          );
        })}
        {!!basket.lines.length && (
          <div className="cf-send">
            {anyMoney && <div className="cf-fine">Shown at {LEVEL_WORDS[((basket.lines[0] || {}).shown || {}).level] || 'the level set for your account'}, for reference: {fmtMoney(total)}{basket.lines.some((l) => ((checks[l.id] || {}).shown || l.shown || {}).onReview) ? ', plus the items priced on review (+)' : ''}. Your quote comes from Classical Elements at your account's pricing.</div>}
            <label><span>Sidemark / project</span><input value={basket.sidemark} maxLength={120} placeholder="Smith Residence" onChange={(e) => save({ ...basket, sidemark: e.target.value })} /></label>
            <label><span>Note to our team</span><textarea value={basket.note} maxLength={2000} rows={3} placeholder="Anything we should know — timing, installation, questions" onChange={(e) => save({ ...basket, note: e.target.value })} /></label>
            {trouble && !trouble.line && <div className="msg">{trouble.text}{trouble.reload ? <> <button className="btn-ghost" onClick={() => window.location.reload()}>Refresh</button></> : null}</div>}
            <button className="btn" onClick={send} disabled={sending || blocked}>{sending ? 'Sending…' : `Send request (${basket.lines.length})`}</button>
            {blocked && <div className="cf-fine">A line above needs a look before the request can go — open it with Edit.</div>}
          </div>
        )}
      </div>
    );
  }

  // ── THE PRODUCTS ──
  return (
    <div className="cf-list">
      <div className="cf-top">
        <h2 className="sec" style={{ margin: 0 }}>Configure</h2>
        <span />
        <button className="btn-ghost" onClick={() => setMode('basket')}>Your request ({basket.lines.length})</button>
      </div>
      {!(flows || []).length && <div className="empty">No products are set up for configuring on your account yet.</div>}
      <div className="cf-products">
        {(flows || []).map((f) => (
          <button key={f.id} className="cf-product" onClick={() => startWalk(f)}>
            <span className="cf-product-img" style={f.picture ? { backgroundImage: `url(${f.picture})` } : undefined} />
            <span className="cf-product-name">{f.name}</span>
            {f.preview && <span className="cf-preview">Preview · only you can see this</span>}
            <span className="cf-product-go">Configure →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
