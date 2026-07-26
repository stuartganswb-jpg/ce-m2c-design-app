// QUICK SHIP — the customer-facing stock counter (browse + QUOTE REQUEST, settled 2026-07-25).
// The customer builds their own stock quote with the SAME Kit Builder cascade as HQ tab 7 —
// collection → rod diameter → finish → pole / outer / center brackets / rings / finials — under
// the pack rules (qty means PACKS, rate is per EACH, the request carries the each count) and at
// their own clientPricing rates, alias-faced (§4b: customers always see the alias code).
// The cascade runs the VERBATIM shared modules tab 7 uses (aliasIdentity / quickShipUom /
// sizeMatrix) over the slim, entitled item set the portalStock BFF serves; submit re-validates
// and re-prices everything server-side and lands a PORTAL_REQUEST job staff load in Quick Ship.
// Test collection: SIMPLE ELEGANCE (entitle it via CRM → Portal Access → Available Collections).
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { sizeKeyOf, SIZE_FAMILIES } from './shared/sizeMatrix.js';
import { packSizeOf, packLabelOf, packUnitFor, isRealPack } from './shared/quickShipUom.js';
import { buildAliasIndex, aliasCodesOf, effectiveCollectionsOf, bareCode, collectionsOf } from './shared/aliasIdentity.js';

// ——— mirrors of tab 7's local helpers (QuickShipTab.js) — keep in lockstep ———
const erpOf = (it) => String(it.legacyErpId || it.itemId || '').toUpperCase();
const classifyCat = (pt) => {
  const t = String(pt || '').toUpperCase();
  if (t.includes('BACKPLATE') || t.includes('BACK PLATE')) return 'BACKPLATE';
  if (t.includes('BRACKET')) return 'BRACKET';
  if (t.includes('FINIAL')) return 'FINIAL';
  if (t.includes('RING')) return 'RING';
  if (t.includes('POLE') || t.includes('ROD')) return 'POLE';
  return '';
};
const catOf = (it) => classifyCat(it.manufacturingSpecs?.productType || it.productType);
const finishCodeOf = (it) => erpOf(it).split('/')[1] || '';
const isFinished = (it) => erpOf(it).includes('/'); // sellable = finished "/CODE" variants only
const isInsideMount = (it) => /INSIDE/.test(String(it?.manufacturingSpecs?.customData?.bracketType || '').toUpperCase());
const diaCellLabel = (cell) => {
  const [fam, dia] = String(cell || '').split('|');
  const opt = SIZE_FAMILIES[fam]?.dia?.options?.find((o) => o.value === dia);
  return opt ? `${SIZE_FAMILIES[fam].label} · ${opt.label}` : cell;
};

const fmt$ = (v) => Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '';
const lbl = { fontFamily: 'var(--mono, monospace)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', margin: '0 0 6px' };
const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontSize: '0.92rem', outline: 'none', background: '#fff', borderRadius: 2 };
const row = { display: 'flex', gap: 12, flexWrap: 'wrap' };
const cell = { flex: 1, minWidth: 160 };

const EMPTY_KB = { poleId: '', poleQty: '', bracketId: '', bracketQty: '', centerBracketId: '', centerBracketQty: '', ringId: '', ringQty: '', finialId: '', finialQty: '' };
const KB_SLOTS = [
  { label: 'Pole', idKey: 'poleId', qtyKey: 'poleQty', poolKey: 'poles' },
  { label: 'Outer Brackets', idKey: 'bracketId', qtyKey: 'bracketQty', poolKey: 'outerBrackets' },
  { label: 'Center Brackets', idKey: 'centerBracketId', qtyKey: 'centerBracketQty', poolKey: 'centerBrackets' },
  { label: 'Rings', idKey: 'ringId', qtyKey: 'ringQty', poolKey: 'rings' },
  { label: 'Finials', idKey: 'finialId', qtyKey: 'finialQty', poolKey: 'finials' },
];

export default function QuickShip() {
  const [data, setData] = useState(null);   // portalStock payload
  const [loadErr, setLoadErr] = useState(null);
  const [scope, setScope] = useState('');
  const [dia, setDia] = useState('');
  const [fin, setFin] = useState('');
  const [kb, setKb] = useState(EMPTY_KB);
  const [cart, setCart] = useState([]);
  const [jobName, setJobName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { quoteNo, total }
  const [subErr, setSubErr] = useState(null);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalStock')()
      .then((res) => {
        if (!alive) return;
        const d = res.data || {};
        setData(d);
        if ((d.collections || []).length === 1) setScope(d.collections[0]);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadErr(/permission/i.test(e.message || '')
          ? 'Quick Ship is not enabled on your account yet — contact your Classical Elements representative.'
          : 'Could not load the stock counter right now — please try again shortly.');
      });
    return () => { alive = false; };
  }, []);

  const items = data?.items || [];
  const index = useMemo(() => buildAliasIndex(items), [items]);
  const packCustomer = data?.packPrefs || {};

  // The same predicate cascade as tab 7, over the entitled set the BFF served.
  const sellableAll = useMemo(() => items.filter((it) => it.sellable), [items]);
  const scoped = useMemo(
    () => scope ? sellableAll.filter((it) => effectiveCollectionsOf(index, it).has(scope)) : sellableAll,
    [sellableAll, scope, index]
  );
  const diaCandidatesFor = (it) => {
    const cells = [];
    aliasCodesOf(index, it).forEach((c) => {
      const sk = sizeKeyOf({ legacyErpId: c });
      if (!sk) return;
      const inScope = !scope || (index.docsByCode.get(c) || []).some((d) => collectionsOf(d).includes(scope));
      cells.push({ cell: `${sk.family}|${sk.dia}`, inScope });
    });
    const sc = cells.filter((c) => c.inScope);
    return [...new Set((sc.length ? sc : cells).map((c) => c.cell))];
  };
  const diaCells = useMemo(() => {
    const seen = new Map();
    scoped.forEach((it) => diaCandidatesFor(it).forEach((c) => { if (!seen.has(c)) seen.set(c, diaCellLabel(c)); }));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], undefined, { numeric: true })).map(([c, label]) => ({ cell: c, label }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, scope, index]);
  const finishes = useMemo(() => [...new Set(scoped.map(finishCodeOf).filter(Boolean))].sort(), [scoped]);

  const byCat = (cat) => scoped.filter((it) => catOf(it) === cat && isFinished(it));
  const atDia = (list) => dia ? list.filter((it) => diaCandidatesFor(it).includes(dia)) : list;
  const atFinish = (list) => fin ? list.filter((it) => finishCodeOf(it) === fin) : list;
  const pool = (cat) => atFinish(atDia(byCat(cat)));
  const outerSet = useMemo(() => new Set(data?.bracketPos?.outer || []), [data]);
  const centerSet = useMemo(() => new Set(data?.bracketPos?.center || []), [data]);
  const hasPos = outerSet.size > 0 || centerSet.size > 0;
  const bracketIn = (set, it) => [...aliasCodesOf(index, it)].some((x) => x && set.has(x));
  const pools = useMemo(() => {
    const brackets = pool('BRACKET');
    return {
      poles: pool('POLE'),
      outerBrackets: hasPos ? brackets.filter((it) => bracketIn(outerSet, it)) : brackets,
      centerBrackets: hasPos ? brackets.filter((it) => bracketIn(centerSet, it)) : brackets,
      rings: pool('RING'),
      finials: pool('FINIAL'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, dia, fin, outerSet, centerSet, index]);

  // Customer-facing code + rate — the alias face for the scope wins (its rate only when > 0),
  // mirroring tab 7's rateForLine / aliasFaceOf capture.
  const faceOf = (it) => (scope && it.faces && it.faces[scope]) || null;
  const codeOf = (it) => faceOf(it)?.code || erpOf(it);
  const rateOf = (it) => { const f = faceOf(it); return (f && f.rate > 0) ? f.rate : (it.rate || 0); };
  const packOf = (it) => {
    const c = catOf(it);
    const slot = c === 'RING' ? 'ring' : c === 'FINIAL' ? 'finial' : (c === 'BRACKET' && isInsideMount(it)) ? 'insideMount' : '';
    if (!slot) return { uom: '', size: 1 };
    const uom = packUnitFor(slot, packCustomer, it);
    return isRealPack(uom) ? { uom: packLabelOf(uom), size: packSizeOf(uom) } : { uom: '', size: 1 };
  };

  // Stale-pick sweeps — narrowing must never leave an invisible part selected (tab 7 rule).
  useEffect(() => { setDia((p) => (p && !diaCells.some((d) => d.cell === p)) ? '' : p); }, [diaCells]);
  useEffect(() => { setFin((p) => (p && !finishes.includes(p)) ? '' : p); }, [finishes]);
  useEffect(() => {
    setKb((prev) => {
      const ok = (id, list) => !id || list.some((x) => x.id === id);
      if (KB_SLOTS.every((s) => ok(prev[s.idKey], pools[s.poolKey]))) return prev;
      const next = { ...prev };
      KB_SLOTS.forEach((s) => { if (!ok(prev[s.idKey], pools[s.poolKey])) next[s.idKey] = ''; });
      return next;
    });
  }, [pools]);

  const itemById = (id) => items.find((it) => it.id === id);
  const setK = (k, v) => setKb((p) => ({ ...p, [k]: v }));

  const addToQuote = () => {
    const noQty = KB_SLOTS.filter((s) => kb[s.idKey] && !(parseInt(kb[s.qtyKey]) > 0)).map((s) => s.label);
    if (noQty.length) { setSubErr(`Enter a quantity for: ${noQty.join(', ')}.`); return; }
    const lines = [];
    KB_SLOTS.forEach((s) => {
      const it = itemById(kb[s.idKey]);
      const qty = parseInt(kb[s.qtyKey]) || 0;
      if (!it || !(qty > 0)) return;
      const pack = packOf(it);
      lines.push({ key: `${it.id}-${Date.now()}-${lines.length}`, id: it.id, code: codeOf(it), name: it.itemName || codeOf(it), qty, packUom: pack.uom, packSize: pack.size, rate: rateOf(it) });
    });
    if (!lines.length) { setSubErr('Pick at least one item and give it a quantity.'); return; }
    setSubErr(null);
    setCart((prev) => [...prev, ...lines]);
    setKb(EMPTY_KB);
  };

  const eachQtyOf = (l) => (parseInt(l.qty) || 0) * (l.packSize || 1);
  const cartTotal = cart.reduce((s, l) => s + l.rate * eachQtyOf(l), 0);

  const submit = async () => {
    if (!cart.length || busy) return;
    setBusy(true); setSubErr(null);
    try {
      const res = await httpsCallable(functions, 'portalStockQuoteRequest')({
        lines: cart.map((l) => ({ id: l.id, qty: l.qty })),
        jobName: jobName.trim(), note, collection: scope,
      });
      setSubmitted({ quoteNo: res.data?.quoteNo || '', total: res.data?.total });
      setCart([]);
    } catch (e) {
      setSubErr(/permission/i.test(e.message || '') ? 'This collection is not enabled on your account.' : 'Could not submit right now — please try again shortly.');
    } finally { setBusy(false); }
  };

  if (submitted) {
    return (
      <div className="card" style={{ padding: 28, marginTop: 24, textAlign: 'center' }}>
        <span className="eyebrow">Quote request received</span>
        <h2 style={{ margin: '10px 0 6px' }}>Request {submitted.quoteNo}</h2>
        {Number.isFinite(submitted.total) && <div style={{ fontSize: '1.3rem', fontWeight: 600, marginBottom: 8 }}>{fmt$(submitted.total)}</div>}
        <p style={{ color: 'var(--ink-soft)', maxWidth: 520, margin: '0 auto 18px' }}>
          Our team will review stock and confirm your quote. Track it under <b>Orders &amp; Quotes</b>.
        </p>
        <button className="btn" onClick={() => { setSubmitted(null); setJobName(''); setNote(''); }}>Build another quote</button>
      </div>
    );
  }

  const slotSelect = (s) => {
    const list = pools[s.poolKey];
    return (
      <div key={s.label} style={{ ...row, marginBottom: 12, alignItems: 'flex-end' }}>
        <div style={{ ...cell, flex: 3 }}>
          <label style={lbl}>{s.label}{list.length === 0 ? ' — none at this diameter/finish' : ''}</label>
          <select style={field} value={kb[s.idKey]} onChange={(e) => setK(s.idKey, e.target.value)} disabled={list.length === 0}>
            <option value="">—</option>
            {list
              .slice()
              .sort((a, b) => codeOf(a).localeCompare(codeOf(b), undefined, { numeric: true }))
              .map((it) => {
                const pack = packOf(it);
                return (
                  <option key={it.id} value={it.id}>
                    {codeOf(it)} — {it.itemName || ''} — {fmt$(rateOf(it))}{pack.uom ? ` · sold as ${pack.uom} (${pack.size} ea)` : ''}
                  </option>
                );
              })}
          </select>
        </div>
        <div style={{ ...cell, flex: 1, minWidth: 110 }}>
          <label style={lbl}>Qty{(() => { const it = itemById(kb[s.idKey]); const p = it && packOf(it); return p && p.uom ? ` (${p.uom}S)` : ''; })()}</label>
          <input style={field} inputMode="numeric" value={kb[s.qtyKey]} onChange={(e) => setK(s.qtyKey, e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 24, position: 'relative', left: '50%', transform: 'translateX(-50%)', width: 'min(1320px, calc(100vw - 48px))' }}>
      <h2 className="sec">Quick Ship — build your stock quote</h2>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 16px', fontSize: '0.92rem' }}>
        Stocked, pre-finished hardware at your prices. Pick the collection, rod diameter and finish — every list narrows to what fits together. Quantities are in your pack units where they apply.
      </p>

      {loadErr && <div className="empty">{loadErr}</div>}
      {!loadErr && !data && <div className="empty">Loading your stock counter…</div>}
      {data && data.collections.length === 0 && <div className="empty">No stocked collections are enabled on your account yet — contact your representative.</div>}
      {data && data.collections.length > 0 && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── the kit builder ── */}
          <div className="card" style={{ flex: '1 1 480px', padding: 20 }}>
            <div style={{ ...row, marginBottom: 14 }}>
              <div style={cell}>
                <label style={lbl}>Collection</label>
                <select style={field} value={scope} onChange={(e) => { setScope(e.target.value); setKb(EMPTY_KB); }}>
                  {data.collections.length > 1 && <option value="">— pick a collection —</option>}
                  {data.collections.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div style={cell}>
                <label style={lbl}>Rod diameter</label>
                <select style={field} value={dia} onChange={(e) => setDia(e.target.value)}>
                  <option value="">Any</option>
                  {diaCells.map((d) => <option key={d.cell} value={d.cell}>{d.label}</option>)}
                </select>
              </div>
              <div style={cell}>
                <label style={lbl}>Finish</label>
                <select style={field} value={fin} onChange={(e) => setFin(e.target.value)}>
                  <option value="">Any</option>
                  {finishes.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
            </div>
            {scope || data.collections.length === 1 ? KB_SLOTS.map(slotSelect) : <div className="empty">Pick a collection to see its stock.</div>}
            {subErr && <div className="empty" style={{ margin: '10px 0' }}>{subErr}</div>}
            <button className="btn" onClick={addToQuote} style={{ width: '100%' }}>Add to quote</button>
          </div>

          {/* ── the quote ── */}
          <div className="card" style={{ flex: '1 1 380px', padding: 20, position: 'sticky', top: 12 }}>
            <span className="eyebrow">Your quote</span>
            {cart.length === 0 ? (
              <div className="empty" style={{ marginTop: 12 }}>Nothing yet — build a kit on the left and add it.</div>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', margin: '12px 0' }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
                    <th style={{ padding: '4px 4px' }}>Item</th><th style={{ padding: '4px 4px' }}>Qty</th><th style={{ padding: '4px 4px', textAlign: 'right' }}>Each</th><th style={{ padding: '4px 4px', textAlign: 'right' }}>Total</th><th />
                  </tr></thead>
                  <tbody>
                    {cart.map((l) => (
                      <tr key={l.key} style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '7px 4px' }}>
                          <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.8rem' }}>{l.code}</div>
                          <div style={{ color: 'var(--ink-soft)', fontSize: '0.78rem' }}>{l.name}</div>
                        </td>
                        <td style={{ padding: '7px 4px', whiteSpace: 'nowrap' }}>{l.qty}{l.packUom ? ` × ${l.packUom} (${eachQtyOf(l)} ea)` : ''}</td>
                        <td style={{ padding: '7px 4px', textAlign: 'right' }}>{fmt$(l.rate)}</td>
                        <td style={{ padding: '7px 4px', textAlign: 'right' }}>{fmt$(l.rate * eachQtyOf(l))}</td>
                        <td style={{ padding: '7px 0', textAlign: 'right' }}><button className="btn-ghost" onClick={() => setCart((p) => p.filter((x) => x.key !== l.key))}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, borderTop: '1px solid var(--line)', paddingTop: 10, marginBottom: 14 }}>
                  <span>Total</span><span>{fmt$(cartTotal)}</span>
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={lbl}>Job / reference name</label>
                  <input style={field} value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. Smith residence restock" />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={lbl}>Notes for our team</label>
                  <textarea style={{ ...field, minHeight: 56, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cut lengths, timing, anything else…" />
                </div>
                <button className="btn" disabled={busy} onClick={submit} style={{ width: '100%' }}>
                  {busy ? 'Sending…' : 'Send quote request'}
                </button>
                <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 8, lineHeight: 1.5 }}>
                  Our team reviews stock and confirms the quote before anything ships — nothing is charged or reserved by sending this.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
