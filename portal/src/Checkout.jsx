// PORTAL CHECKOUT (Stuart 2026-08-10): the order's configurations reviewed together, the
// 4.6-curated add-ons offered (portalCheckoutCatalog — the same Checkout Items ticks that feed
// the CPQ checkout screen), the order sidemark + notes captured, and ONE quote request sent for
// the whole order. The success view carries the presentation generator that used to live in
// Configurator — it now draws on every line's stored price snapshot and matching metadata.
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { readCart, removeLine, clearCart } from './orderCart';

const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LEVEL_LABELS = { FAB_COST: 'Your cost', FAB_WHOLESALE: 'Wholesale', FAB_RETAIL: 'Retail' };

// Add-on arithmetic for DISPLAY (mirrors Shared/feeRules.computeFee): FLAT = unit × qty (with a
// minimum floor); PERCENT = % of the configuration subtotal with a minimum/cap. The server
// re-validates the items; staff pricing in CPQ is what lands on the confirmed quote.
const addOnAmount = (entry, qty, subtotal) => {
  const r = entry.rule || {};
  const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  if (r.mode === 'PERCENT') {
    if (subtotal === null) return null;               // some lines unpriced — amount unknowable here
    const raw = Math.max(0, subtotal) * ((parseFloat(r.percent) || 0) / 100);
    const min = parseFloat(r.minAmount);
    const floored = Number.isFinite(min) && raw < min ? min : raw;
    const max = parseFloat(r.maxAmount);
    return round(Number.isFinite(max) && floored > max ? max : floored);
  }
  const amount = round((parseFloat(entry.unitPrice) || 0) * (parseFloat(qty) || 0));
  const min = parseFloat(r.minAmount);
  return Number.isFinite(min) && amount > 0 && amount < min ? round(min) : amount;
};

export default function Checkout({ onBack, onDone }) {
  const [cart, setCart] = useState(readCart());
  const [catalog, setCatalog] = useState(null);       // null = loading, [] = none curated
  const [sel, setSel] = useState({});                 // { [itemId]: qty | true }
  const [sidemark, setSidemarkState] = useState(() => { try { return sessionStorage.getItem('portal_order_sidemark') || ''; } catch { return ''; } });
  const setSidemark = (v) => { setSidemarkState(v); try { sessionStorage.setItem('portal_order_sidemark', v); } catch { /* private mode */ } };
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);   // { quoteNo, lines } after send
  const [presBusy, setPresBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalCheckoutCatalog')()
      .then((res) => { if (alive) setCatalog(res.data?.items || []); })
      .catch(() => { if (alive) setCatalog([]); });
    return () => { alive = false; };
  }, []);

  const lines = cart.lines || [];
  // Subtotal for percentage add-ons: null when ANY line has no viewed price — the fee then reads
  // "calculated on your confirmation" instead of a wrong number.
  const subtotal = useMemo(() => {
    if (!lines.length || lines.some((l) => l.viewedTotal === null || l.viewedTotal === undefined)) return null;
    return lines.reduce((s, l) => s + (Number(l.viewedTotal) || 0), 0);
  }, [lines]);

  const chosenAddOns = (catalog || []).filter((e) => {
    const v = sel[e.id];
    return e.rule?.mode === 'PERCENT' ? !!v : (parseFloat(v) || 0) > 0;
  });
  const addOnsTotal = chosenAddOns.reduce((s, e) => {
    const amt = addOnAmount(e, e.rule?.mode === 'PERCENT' ? 1 : sel[e.id], subtotal);
    return amt === null ? s : s + amt;
  }, 0);

  const remove = (idx) => setCart(removeLine(idx));

  const submit = async () => {
    if (!lines.length) return;
    setSubmitting(true);
    try {
      const first = lines[0];
      const res = await httpsCallable(functions, 'portalQuoteRequest')({
        lines: lines.map((l) => ({ flowId: l.flowId, flowName: l.flowName, lineTag: l.lineTag || '', selections: l.selections })),
        addOns: chosenAddOns.map((e) => ({ id: e.id, qty: e.rule?.mode === 'PERCENT' ? 1 : (parseFloat(sel[e.id]) || 0) })),
        sidemark: sidemark.trim(),
        note,
        viewedLevel: first.viewedLevel || '',
        // Line[0] mirrored at the top level so a not-yet-redeployed portalQuoteRequest (Cloud
        // Shell lag) still lands the first configuration instead of rejecting the order.
        flowId: first.flowId, flowName: first.flowName, selections: first.selections, lineTag: first.lineTag || '',
      });
      setSubmitted({ quoteNo: res.data?.quoteNo || null, lines: [...lines] });
      clearCart();
      setCart({ lines: [] });
    } catch (e) {
      alert('Could not send your request: ' + (e.message || e));
    } finally { setSubmitting(false); }
  };

  // ---- Presentation (moved from Configurator 2026-08-10; mechanics unchanged, now multi-line):
  // gallery assets matched on every line's item #s, gated by the arm/plate combos each
  // configuration actually chose, finish-filtered by the order's dominant finish code.
  const generatePresentation = async () => {
    if (presBusy || !submitted) return;
    setPresBusy(true);
    try {
      const res = await httpsCallable(functions, 'portalAssets')();
      const assets = res.data?.assets || [];
      const doneLines = submitted.lines;
      const priceRows = doneLines.flatMap((l) => l.priceLines || []);
      const itemNos = [...new Set(priceRows.map((l) => String(l.itemNo || '').trim().toUpperCase()).filter(Boolean))];
      const chosenArms = new Set(doneLines.flatMap((l) => l.presMeta?.chosenArms || []));
      const chosenPlates = new Set(doneLines.flatMap((l) => l.presMeta?.chosenPlates || []));
      const domFin = (() => {
        const counts = {};
        doneLines.forEach((l) => { const f = l.presMeta?.domFin; if (f) counts[f] = (counts[f] || 0) + 1; });
        return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [''])[0];
      })();
      const wasChosen = (set, code) => {
        const c = String(code || '').trim().toUpperCase();
        if (!c) return false;
        if (set.has(c)) return true;
        for (const v of set) { if (v.includes(c) || c.includes(v)) return true; }
        return false;
      };
      const scored = assets.map((a) => {
        const blob = a.blob || '';
        let hits = 0; let firstCode = '';
        itemNos.forEach((no) => {
          const [base, fin] = no.split('/');
          if (!base || !blob.includes(base.toLowerCase())) return;
          if (fin && !blob.includes(fin.toLowerCase())) return;
          hits++; if (!firstCode) firstCode = base;
        });
        if (!hits) return null;
        const plateTag = a.fab?.plateCode || '';
        const armTag = a.fab?.pairedCode || '';
        const plateWrong = plateTag && chosenPlates.size && !wasChosen(chosenPlates, plateTag);
        const armWrong = armTag && chosenArms.size && !wasChosen(chosenArms, armTag);
        const comboOk = !plateWrong && !armWrong;
        let score = hits * 10;
        if (plateTag && armTag && wasChosen(chosenPlates, plateTag) && wasChosen(chosenArms, armTag)) score += 6;
        else if (plateTag && wasChosen(chosenPlates, plateTag)) score += 3;
        return { a, score, code: firstCode, comboOk };
      }).filter(Boolean).sort((x, y) => y.score - x.score);
      const gated = scored.filter((x) => x.comboOk);
      const matched = gated.length ? gated : scored;
      const inFinish = domFin ? matched.filter(({ a }) => (a.blob || '').includes(String(domFin).toLowerCase())) : matched;
      const pool = inFinish.length ? inFinish : matched;
      const picks = [];
      const seen = new Set();
      const codeUsed = {};
      for (const { a, code } of pool) {
        if (seen.has(a.id) || codeUsed[code]) continue;
        seen.add(a.id); codeUsed[code] = true; picks.push(a);
        if (picks.length >= 8) break;
      }
      for (const { a } of pool) {
        if (picks.length >= 8) break;
        if (seen.has(a.id)) continue;
        seen.add(a.id); picks.push(a);
      }
      openPresentation(doneLines, picks);
    } catch (e) {
      alert('Could not gather the gallery images right now — please try again shortly.');
    } finally { setPresBusy(false); }
  };

  const openPresentation = (doneLines, picks) => {
    const w = window.open('', '_blank');
    if (!w) return alert('Pop-up blocked — allow pop-ups for this site to generate the presentation.');
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const levelLabel = LEVEL_LABELS[doneLines[0]?.viewedLevel] || '';
    const capOf = (a) => {
      const fabNo = String(a.fabCode || '').trim();
      const color = String(a.fab?.fabColorName || a.fab?.ourFinishName || '').trim();
      return [fabNo, color].filter(Boolean).join(' · ') || String(a.name || '');
    };
    const rows = doneLines.map((l) => {
      const head = `<tr><td class="ln"><b>${esc(l.flowName || 'Configuration')}${l.lineTag ? ` — ${esc(l.lineTag)}` : ''}</b></td><td class="amt">${l.viewedTotal != null ? esc(fmtMoney(l.viewedTotal)) : ''}</td></tr>`;
      const items = (l.priceLines || []).map((r) => `<tr><td class="ln">${esc(r.name)}${r.qty > 1 ? ` <span class="q">×${r.qty}</span>` : ''}</td><td class="amt">${esc(fmtMoney(r.total))}</td></tr>`).join('');
      return head + items;
    }).join('');
    const figs = picks.map((a) => `<figure><img src="${esc(a.fullUrl || a.url)}" alt=""><figcaption>${esc(capOf(a))}</figcaption></figure>`).join('');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Presentation — Quote ${esc(submitted?.quoteNo || '')}</title><style>
      @page { size: letter landscape; margin: 0.4in; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #1c1a16; }
      .wrap { display: flex; gap: 28px; align-items: flex-start; }
      .left { flex: 0 0 44%; }
      .brand { font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: .25em; color: #b08d57; }
      h1 { font-size: 21px; font-weight: 500; margin: 6px 0 2px; }
      .meta { font-family: 'Courier New', monospace; font-size: 10px; color: #524e46; margin-bottom: 14px; }
      table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
      td { padding: 5px 4px; border-top: 1px solid rgba(28,26,22,.14); vertical-align: top; }
      .amt { text-align: right; white-space: nowrap; }
      .q { color: #524e46; }
      .fine { font-size: 9px; color: #524e46; margin-top: 12px; line-height: 1.5; }
      .right { flex: 1 1 56%; display: grid; grid-template-columns: repeat(${picks.length > 4 ? 3 : 2}, 1fr); gap: 12px; }
      figure { margin: 0; break-inside: avoid; }
      figure img { width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #f4f1ea; border: 1px solid rgba(28,26,22,.14); }
      figcaption { font-family: 'Courier New', monospace; font-size: 8.5px; color: #524e46; padding-top: 4px; text-align: center; letter-spacing: .04em; }
    </style></head><body>
      <div class="wrap">
        <div class="left">
          <div class="brand">CLASSICAL ELEMENTS</div>
          <h1>Proposal${sidemark ? ` — ${esc(sidemark)}` : ''}</h1>
          <div class="meta">Quote ${esc(submitted?.quoteNo || '')} · ${esc(today)}${levelLabel ? ` · Priced at: ${esc(levelLabel)}` : ''}</div>
          <table>${rows}</table>
          <div class="fine">Prices shown are the values quoted at configuration time; final pricing is confirmed on your Sales Order Acknowledgement.</div>
        </div>
        <div class="right">${figs || '<div style="font-family:monospace;font-size:10px;color:#524e46">No matching gallery images were found for this order.</div>'}</div>
      </div>
      <script>
        (function(){ var imgs = [].slice.call(document.images); var n = 0;
          function done(){ if (++n >= imgs.length) setTimeout(function(){ window.print(); }, 250); }
          if (!imgs.length) setTimeout(function(){ window.print(); }, 350);
          else imgs.forEach(function(i){ if (i.complete) done(); else { i.onload = done; i.onerror = done; } });
        })();
      <\/script>
    </body></html>`);
    w.document.close();
  };

  if (submitted) {
    return (
      <div className="cfg" style={{ marginTop: 24 }}>
        <div className="msg ok" style={{ textAlign: 'left' }}>
          ✓ Request sent{submitted.quoteNo ? <> — <strong>Quote #{submitted.quoteNo}</strong></> : ''} ({submitted.lines.length} configuration{submitted.lines.length === 1 ? '' : 's'}). Your Classical Elements team will confirm pricing and follow up. You can see it under Orders &amp; Quotes.
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
            <div style={{ marginBottom: 8 }}>Would you like to generate a presentation? It pairs this order with the matching product images from your gallery on one landscape page — ready to print or save as PDF.</div>
            <button className="btn" disabled={presBusy} onClick={generatePresentation}>{presBusy ? 'Gathering images…' : 'Generate presentation'}</button>
          </div>
        </div>
        <div className="cfg-nav" style={{ marginTop: 16 }}>
          <button className="btn-ghost" onClick={onDone || onBack}>← Back to showroom</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cfg" style={{ marginTop: 24 }}>
      <div className="cfg-top">
        <button className="btn-ghost" onClick={onBack}>← Keep shopping</button>
        <h2 className="sec" style={{ margin: 0 }}>Checkout</h2>
        <span />
      </div>

      {!lines.length && <div className="empty" style={{ marginTop: 20 }}>Your order is empty — configure a product in the showroom first.</div>}

      {lines.length > 0 && (
        <div className="co-body">
          <div className="co-lines">
            <div className="co-head">Your configurations</div>
            {lines.map((l, i) => (
              <div className="co-line" key={i}>
                <div className="co-line-main">
                  <div className="co-line-name">{l.flowName || 'Configuration'}{l.lineTag ? <span className="co-tag"> [{l.lineTag}]</span> : null}</div>
                  <div className="co-line-sub">{l.viewedTotal != null ? fmtMoney(l.viewedTotal) : 'Priced on your confirmation'}</div>
                </div>
                <button className="btn-ghost co-x" title="Remove this configuration from the order" onClick={() => remove(i)}>✕</button>
              </div>
            ))}
            {subtotal !== null && (
              <div className="co-line co-subtotal"><span>Configurations subtotal</span><span>{fmtMoney(subtotal)}</span></div>
            )}
          </div>

          <div className="co-lines">
            <div className="co-head">Add-ons</div>
            {catalog === null && <div className="co-note">Loading add-ons…</div>}
            {catalog !== null && !catalog.length && <div className="co-note">No add-ons are available on your account.</div>}
            {(catalog || []).map((e) => {
              const v = sel[e.id];
              const on = e.rule?.mode === 'PERCENT' ? !!v : (parseFloat(v) || 0) > 0;
              const amt = on ? addOnAmount(e, e.rule?.mode === 'PERCENT' ? 1 : v, subtotal) : null;
              return (
                <div className={`co-line${on ? ' on' : ''}`} key={e.id}>
                  <div className="co-line-main">
                    <div className="co-line-name">{e.name || e.code}</div>
                    <div className="co-line-sub">{e.code} · {e.summary}</div>
                  </div>
                  {e.rule?.mode === 'PERCENT' ? (
                    <label className="co-check"><input type="checkbox" checked={!!v} onChange={(ev) => setSel({ ...sel, [e.id]: ev.target.checked })} /> add</label>
                  ) : (
                    <input className="co-qty" type="number" min="0" step="any" value={v ?? ''} placeholder="0"
                      onChange={(ev) => setSel({ ...sel, [e.id]: ev.target.value === '' ? '' : Math.max(0, parseFloat(ev.target.value) || 0) })} />
                  )}
                  <div className="co-amt">{on ? (amt === null ? 'on confirmation' : fmtMoney(amt)) : '—'}</div>
                </div>
              );
            })}
            {chosenAddOns.length > 0 && addOnsTotal > 0 && (
              <div className="co-line co-subtotal"><span>Add-ons</span><span>{fmtMoney(addOnsTotal)}</span></div>
            )}
          </div>

          <div className="cfg-tags">
            <label>
              <span>Order sidemark</span>
              <input value={sidemark} onChange={(e) => setSidemark(e.target.value)} placeholder="e.g. Smith Residence"
                title="Tags the whole order — prints at the header of your quote and order documents." />
            </label>
          </div>
          <textarea className="cfg-note" placeholder="Notes for your rep (quantity, project, timing…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="cfg-nav">
            <button className="btn" disabled={submitting} onClick={submit}>{submitting ? 'Sending…' : `Request a quote (${lines.length} line${lines.length === 1 ? '' : 's'})`}</button>
          </div>
          <div className="cfg-fineprint">Final pricing is confirmed on your Sales Order Acknowledgement. Nothing is ordered automatically.</div>
        </div>
      )}
    </div>
  );
}
