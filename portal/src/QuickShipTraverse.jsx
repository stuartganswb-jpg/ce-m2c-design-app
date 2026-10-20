// TRAVERSE KITS ON THE PORTAL'S QUICK SHIP — tab 7's "Traverse Kits" card, the customer's side of it (Stuart 2026-10-20: "add and align —
// a kit can be sold, kit + additional per foot price in __ finish"). The same questions in the same order — the kit, the motor on a
// motorised kit, the depth a single sells at, the finish (and the colour its track takes), the length — then the components, the panel
// tab 7's popup asks (./TraversePanel). Every line shown is tab 7's (./quickShipKit over Shared/traverseKitSale): their complete kit,
// "Additional foot · <finish>" × the feet above the minimum charge at their per-foot price, the components. Add puts the kit on the quote
// as its ANSWERS + those lines; the server re-checks and re-prices the answers when the request is sent.
import React, { useMemo, useState } from 'react';
import TraversePanel from './TraversePanel.jsx';
import { kitOrderOf, kitLinesOf, answersAt, panelViewOf } from './quickShipKit.js';

const NO_ITEMS = {};

export default function QuickShipTraverse({ traverse, onAdd, fmt$, lbl, field, row, cell }) {
  const kits = traverse.kits || [];
  const [kitId, setKitId] = useState('');
  const [motor, setMotor] = useState('');
  const [proj, setProj] = useState('');
  const [finish, setFinish] = useState('');
  const [feet, setFeet] = useState('');
  const [mine, setMine] = useState(null);     // the customer's own panel answers { at: billed feet, answers } — none = the panel's opening answers
  const [err, setErr] = useState(null);
  const k = kits.find((x) => x.id === kitId) || null;
  const chart = (k && traverse.charts && traverse.charts[k.family]) || null;
  const items = traverse.items || NO_ITEMS;
  // the kit lines first (their billed length decides the chart's counts), then the components at the answers as they stand at that length
  const order = useMemo(() => {
    if (!k) return null;
    const lines = kitLinesOf({ k, finish, proj, motorItem: motor, feet });
    return kitOrderOf({ k, finish, proj, motorItem: motor, feet, chart, items, sel: lines.error ? null : answersAt(mine, chart, lines.cfg) });
  }, [k, finish, proj, motor, feet, mine, chart, items]);
  const ready = order && !order.error;

  const pickKit = (id) => {
    const next = kits.find((x) => x.id === id) || null;
    setKitId(id); setMotor(''); setProj(''); setMine(null); setErr(null);
    setFinish((f) => (next && next.finishes.some((x) => x.code === f) ? f : ''));
  };
  const onSel = (patch) => { if (!ready) return; const cur = order.sel || {}; setMine({ at: order.cfg.feet, answers: { ...cur, ...patch(cur) } }); };
  const add = () => {
    if (!order || order.error) { setErr(order ? order.error : 'Pick a kit.'); return; }
    setErr(null);
    onAdd({ trv: order.entry, lines: order.lines, total: order.total, still: order.still, title: `${order.lines[0].code} — ${k.name}` });
    setKitId(''); setMotor(''); setProj(''); setFinish(''); setFeet(''); setMine(null);
  };
  const kitRate = k ? k.rate : 0;

  return (
    <div className="card" style={{ padding: 20 }}>
      <span className="eyebrow">Traverse kits</span>
      <p style={{ color: 'var(--ink-soft)', margin: '6px 0 14px', fontSize: '0.88rem' }}>
        A complete kit at your price — the 4 ft set, then each additional foot at your per-foot price, in the finish you choose — and the track's components.
      </p>
      <div style={{ ...row, marginBottom: 12, alignItems: 'flex-end' }}>
        <div style={{ ...cell, flex: 3 }}>
          <label style={lbl}>Kit</label>
          <select style={field} value={kitId} onChange={(e) => pickKit(e.target.value)} data-trv-kit>
            <option value="">— pick a kit —</option>
            {kits.map((x) => <option key={x.id} value={x.id}>{x.sku && x.sku.toUpperCase() !== x.code ? `${x.sku} · ` : ''}{x.code} — {x.name} — {fmt$(x.rate)}</option>)}
          </select>
        </div>
        <div style={{ ...cell, flex: 1, minWidth: 110 }}>
          <label style={lbl}>Total feet</label>
          <input style={field} inputMode="numeric" value={feet} onChange={(e) => setFeet(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} placeholder={String((k && k.minFeet) || 4)} data-trv-feet />
        </div>
      </div>
      {k && k.drive === 'MOTORIZED' && (
        <div style={{ marginBottom: 12 }}>
          {/* tab 7's words: the set includes HSOM-21; another motor bills at its own per-motor kit code and price */}
          <label style={lbl}>Motor — the set includes HSOM-21; others bill the difference</label>
          <select style={field} value={motor} onChange={(e) => setMotor(e.target.value)} data-trv-motor>
            <option value="">HSOM-21 (included)</option>
            {k.motors.map((m) => { const d = Number.isFinite(m.rate) ? m.rate - kitRate : 0; return <option key={m.motorItem} value={m.motorItem}>{m.motorItem}{m.sku ? ` · ${m.sku}` : ''} — {m.name || 'motor'}{d > 0 ? ` (+${fmt$(d)})` : ' (included)'}</option>; })}
          </select>
        </div>
      )}
      {k && k.single && (
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Bracket projection — standard depths only</label>
          <select style={field} value={proj} onChange={(e) => setProj(e.target.value)} data-trv-proj>
            <option value="">— pick the projection —</option>
            {k.projections.map((p) => <option key={p.value} value={p.value}>{p.label}{p.standard ? ' — standard' : ' — extended'}</option>)}
          </select>
        </div>
      )}
      {k && !k.single && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginBottom: 12 }}>A double — one bracket carries both rods, so there is no projection to pick.</div>}
      {k && (
        <div style={{ marginBottom: 12 }}>
          <label style={lbl}>Finish</label>
          <select style={field} value={finish} onChange={(e) => setFinish(e.target.value)} disabled={!k.finishes.length} data-trv-finish>
            <option value="">{k.finishes.length ? '— pick the finish —' : 'no finishes offered for this kit yet'}</option>
            {k.finishes.map((f) => <option key={f.code} value={f.code}>{f.code} — {f.name}{f.track ? ` · track ${f.track}` : ''}</option>)}
          </select>
        </div>
      )}
      {ready && (
        <>
          <div style={{ margin: '6px 0 14px' }}>
            <label style={lbl}>Traverse components — the chart's counts for {order.cfg.feet} ft are included; raising a count adds the difference</label>
            <TraversePanel t={panelViewOf({ chart, cfg: order.cfg, items, sel: order.sel })} sel={order.sel || {}} onSel={onSel} fmtMoney={fmt$} />
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', margin: '4px 0 12px' }} data-trv-preview>
            <tbody>
              {order.lines.map((l, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '6px 4px' }}><div style={{ fontFamily: 'var(--mono, monospace)', fontSize: '0.78rem' }}>{l.code}</div><div style={{ color: 'var(--ink-soft)', fontSize: '0.76rem' }}>{l.name}{l.note ? ` — ${l.note}` : ''}</div></td>
                  <td style={{ padding: '6px 4px', whiteSpace: 'nowrap' }}>{l.qty}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{l.rate ? fmt$(l.rate) : 'included'}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmt$(l.rate * l.qty)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: '1px solid var(--line)', fontWeight: 600 }}><td style={{ padding: '6px 4px' }} colSpan={3}>This kit</td><td style={{ padding: '6px 4px', textAlign: 'right' }}>{fmt$(order.total)}</td></tr>
            </tbody>
          </table>
          {order.missing > 0 && <div className="empty" style={{ marginBottom: 10 }}>{order.missing} of the chosen components are not set up yet — our team will add them when they confirm your quote.</div>}
        </>
      )}
      {k && !ready && order && <div style={{ fontSize: '0.82rem', color: 'var(--ink-soft)', margin: '0 0 10px' }}>{order.error}</div>}
      {err && <div className="empty" style={{ margin: '10px 0' }}>{err}</div>}
      <button className="btn" onClick={add} style={{ width: '100%' }} disabled={!k} data-trv-add>Add kit to quote</button>
    </div>
  );
}
