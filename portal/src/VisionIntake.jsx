// MEASURE & FIT — the customer-facing half of Client Vision (measurement intake ONLY).
// The customer enters wall/opening measurements and end treatments; the page shows, live, the
// outside-edge numbers their opening has to accommodate (poleO2O / totalSystemO2O / wall C2C)
// via the VERBATIM fit-math copy in ./shared/bayMath.js — the same computeBayMath the internal
// Vision board runs. Submitting calls the portalVisionDraft BFF, which lands the line as a
// cpq_drafts doc in the exact internal shape: staff reopen the quote (CRM card → Reopen Vision),
// "Load saved line" restores this entire form onto the Engineering board with zero re-entry,
// and their save stamps the shop drawing + cut-sheet numbers. NOTHING shop-only renders here —
// no raw cuts, no saw angles, no drawings; those are derived by staff from this data.
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { computeBayMath, safeProjOf } from './shared/bayMath.js';

// "138 3/4", "138-3/4", "3/4", "138.75" → decimal inches. Blank/invalid → 0.
const parseMeas = (s) => {
  const t = String(s ?? '').trim().replace(/["″”]/g, '');
  if (!t) return 0;
  const m = t.match(/^(\d+(?:\.\d+)?)?[\s-]*(?:(\d+)\s*\/\s*(\d+))?$/);
  if (!m || (!m[1] && !m[2])) { const f = parseFloat(t); return Number.isFinite(f) ? f : 0; }
  const whole = m[1] ? parseFloat(m[1]) : 0;
  const frac = (m[2] && m[3] && parseFloat(m[3])) ? parseFloat(m[2]) / parseFloat(m[3]) : 0;
  return whole + frac;
};

// Decimal inches → nearest-1/16 display, e.g. 138.75 → 138 3/4"
const toFrac = (v) => {
  if (!Number.isFinite(v)) return '—';
  const neg = v < 0; const a = Math.abs(v);
  let whole = Math.floor(a); let n = Math.round((a - whole) * 16); let d = 16;
  if (n === 16) { whole += 1; n = 0; }
  while (n && n % 2 === 0) { n /= 2; d /= 2; }
  const frac = n ? `${n}/${d}` : '';
  return `${neg ? '-' : ''}${whole && frac ? `${whole} ${frac}` : (frac || String(whole))}"`;
};
const both = (v) => Number.isFinite(v) ? `${(Math.round(v * 1000) / 1000)}"  (${toFrac(v)})` : '—';

const SHAPES = [
  { id: 'STRAIGHT', label: 'Straight' },
  { id: 'MITERED', label: 'Angled Bay' },
  { id: 'BOW', label: 'Curved Bay' },
];
const END_STYLES = [
  { id: 'FINIAL', label: 'Finial / End Cap' },
  { id: 'RETURN_BEND', label: 'French (Bent) Return' },
  { id: 'RETURN_MITER', label: 'Mitered Return' },
];
const MOUNTS = [
  { id: 'OPEN', label: 'Wall' },
  { id: 'CEILING', label: 'Ceiling' },
  { id: 'INSIDE', label: 'Inside Mount' },
];

const lbl = { fontFamily: 'var(--mono, monospace)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', margin: '0 0 6px' };
const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontSize: '0.95rem', outline: 'none', background: '#fff', borderRadius: 2 };
const row = { display: 'flex', gap: 12, flexWrap: 'wrap' };
const cell = { flex: 1, minWidth: 150 };

export default function VisionIntake() {
  const [products, setProducts] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [flowId, setFlowId] = useState('');
  const [sidemark, setSidemark] = useState('');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState({ shape: 'STRAIGHT', inputMode: 'WALL', endStyle: 'FINIAL', endStyleRight: 'FINIAL', mountLeft: 'OPEN', mountRight: 'OPEN', mountOuter: 'OPEN' });
  const [m, setM] = useState({ w1: '', w2: '', w3: '', bowDepth: '', proj: '', poleDiameter: '1', bracketW: '3', returnRadius: '4', gripAllowance: '8.5', insideMountDeduct: '0.25' });
  const [showAdv, setShowAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { quoteNo }
  const [subErr, setSubErr] = useState(null);

  useEffect(() => {
    let alive = true;
    httpsCallable(functions, 'portalCatalog')()
      .then((res) => { if (alive) setProducts(res.data?.items || []); })
      .catch(() => { if (alive) setLoadErr('Could not load your products right now — please try again shortly.'); });
    return () => { alive = false; };
  }, []);

  const setSelKey = (k, v) => setSel((p) => ({ ...p, [k]: v }));
  const setMKey = (k, v) => setM((p) => ({ ...p, [k]: v }));

  // The engData the internal Vision board runs on — same keys, decimal inches always.
  const engData = useMemo(() => ({
    shape: sel.shape, inputMode: sel.inputMode,
    w1: parseMeas(m.w1), w2: parseMeas(m.w2), w3: parseMeas(m.w3),
    a1: 135, a2: 135, bowDepth: parseMeas(m.bowDepth),
    mountLeft: sel.mountLeft, mountRight: sel.mountRight, mountCenter: 'OPEN', mountOuter: sel.mountOuter,
    endStyle: sel.endStyle, endStyleRight: sel.endStyleRight,
    proj: m.proj === '' ? '' : parseMeas(m.proj),
    bracketId: '', bracketIdRight: '', bracketIdCenter: '', backplateIdLeft: '', backplateIdRight: '', backplateIdCenter: '',
    poleDiameter: parseMeas(m.poleDiameter) || 1, bracketW: parseMeas(m.bracketW) || 3, finialW: 3.5,
    bracketThickness: 0.25, insideMountDeduct: parseMeas(m.insideMountDeduct) || 0.25,
    returnRadius: parseMeas(m.returnRadius) || 4, gripAllowance: parseMeas(m.gripAllowance) || 8.5,
  }), [sel, m]);

  // IDENTICAL math to the internal board (verbatim bayMath copy). No parts library on the
  // portal → open ends use the half-bracket-width allowance; staff confirm exact hardware.
  const fit = useMemo(() => computeBayMath({ engData, safeProj: safeProjOf(engData), libraryParts: [] }), [engData]);

  const isBay = sel.shape !== 'STRAIGHT';
  const needProj = isBay && !parseMeas(m.proj);
  const missing =
    !flowId ? 'Pick a product first.'
    : !sidemark.trim() ? 'Give this window a name (sidemark) — e.g. “Living Room East”.'
    : !(engData.w2 > 0) ? (sel.shape === 'MITERED' ? 'Enter the center wall measurement.' : 'Enter the width measurement.')
    : (sel.shape === 'MITERED' && !(engData.w1 > 0 && engData.w3 > 0)) ? 'Enter the left and right wall measurements.'
    : (sel.shape === 'BOW' && !(engData.bowDepth > 0)) ? 'Enter the bay depth.'
    : needProj ? 'Enter the bracket projection (bay math needs it).'
    : null;

  const submit = async () => {
    if (missing || busy) return;
    setBusy(true); setSubErr(null);
    try {
      const flowName = products?.find((p) => p.flowId === flowId)?.name || '';
      const preview = {
        poleO2O: fit.poleO2O, totalSystemO2O: fit.totalSystemO2O,
        pole1: fit.pole1, pole2: fit.pole2, pole3: fit.pole3,
        endAddL: fit.endAddL, endAddR: fit.endAddR,
      };
      const res = await httpsCallable(functions, 'portalVisionDraft')({ flowId, flowName, sidemark: sidemark.trim(), note, engData, preview });
      setSubmitted({ quoteNo: res.data?.quoteNo || '' });
    } catch (e) {
      setSubErr(/permission/i.test(e.message || '') ? 'This product is not enabled on your account.' : 'Could not submit right now — please try again shortly.');
    } finally { setBusy(false); }
  };

  if (submitted) {
    return (
      <div className="card" style={{ padding: 28, marginTop: 24, textAlign: 'center' }}>
        <span className="eyebrow">Measurements received</span>
        <h2 style={{ margin: '10px 0 6px' }}>Request {submitted.quoteNo}</h2>
        <p style={{ color: 'var(--ink-soft)', maxWidth: 520, margin: '0 auto 18px' }}>
          Our team will verify the fit, engineer the hardware to your opening, and return a quote.
          Track it under <b>Orders &amp; Quotes</b>.
        </p>
        <button className="btn" onClick={() => { setSubmitted(null); setSidemark(''); setNote(''); }}>Measure another window</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2 className="sec">Measure &amp; Fit</h2>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 16px', fontSize: '0.92rem' }}>
        Enter your wall measurements and end treatments — we show the <b>outside-edge size the finished system needs</b>, so it fits before it ships.
        Measure in inches; fractions welcome (type <i>138 3/4</i>).
      </p>

      {loadErr && <div className="empty">{loadErr}</div>}
      {!loadErr && !products && <div className="empty">Loading your products…</div>}
      {products && (
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* ── inputs ── */}
          <div className="card" style={{ flex: '1 1 460px', padding: 20 }}>
            <div style={{ ...row, marginBottom: 14 }}>
              <div style={{ ...cell, flexBasis: '100%' }}>
                <label style={lbl}>Product</label>
                <select style={field} value={flowId} onChange={(e) => setFlowId(e.target.value)}>
                  <option value="">— pick the collection you're quoting —</option>
                  {products.map((p) => <option key={p.flowId} value={p.flowId}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ ...row, marginBottom: 14 }}>
              <div style={cell}>
                <label style={lbl}>Window / room name (sidemark)</label>
                <input style={field} value={sidemark} onChange={(e) => setSidemark(e.target.value)} placeholder="Living Room East" />
              </div>
              <div style={cell}>
                <label style={lbl}>Shape</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {SHAPES.map((s) => (
                    <button key={s.id} onClick={() => setSelKey('shape', s.id)}
                      style={{ flex: 1, padding: '10px 4px', cursor: 'pointer', borderRadius: 2, fontSize: '0.85rem', border: `1px solid ${sel.shape === s.id ? 'var(--brass, #b08d57)' : 'var(--line)'}`, background: sel.shape === s.id ? 'var(--brass, #b08d57)' : '#fff', color: sel.shape === s.id ? '#fff' : 'var(--ink)' }}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              <div style={{ ...cell, flexBasis: '100%' }}>
                <label style={lbl}>What did you measure?</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setSelKey('inputMode', 'WALL')} style={{ flex: 1, padding: '10px 6px', cursor: 'pointer', borderRadius: 2, fontSize: '0.85rem', border: `1px solid ${sel.inputMode === 'WALL' ? 'var(--brass, #b08d57)' : 'var(--line)'}`, background: sel.inputMode === 'WALL' ? 'var(--brass, #b08d57)' : '#fff', color: sel.inputMode === 'WALL' ? '#fff' : 'var(--ink)' }}>Wall / opening (outside edges)</button>
                  <button onClick={() => setSelKey('inputMode', 'ORDERING')} style={{ flex: 1, padding: '10px 6px', cursor: 'pointer', borderRadius: 2, fontSize: '0.85rem', border: `1px solid ${sel.inputMode === 'ORDERING' ? 'var(--brass, #b08d57)' : 'var(--line)'}`, background: sel.inputMode === 'ORDERING' ? 'var(--brass, #b08d57)' : '#fff', color: sel.inputMode === 'ORDERING' ? '#fff' : 'var(--ink)' }}>Exact pole length I want</button>
                </div>
              </div>
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Left wall (in)</label><input style={field} value={m.w1} onChange={(e) => setMKey('w1', e.target.value)} placeholder="30" /></div>}
              <div style={cell}><label style={lbl}>{sel.shape === 'MITERED' ? 'Center wall (in)' : 'Width (in)'}</label><input style={field} value={m.w2} onChange={(e) => setMKey('w2', e.target.value)} placeholder="138 3/4" /></div>
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Right wall (in)</label><input style={field} value={m.w3} onChange={(e) => setMKey('w3', e.target.value)} placeholder="30" /></div>}
              {sel.shape === 'BOW' && <div style={cell}><label style={lbl}>Bay depth (in)</label><input style={field} value={m.bowDepth} onChange={(e) => setMKey('bowDepth', e.target.value)} placeholder="15" /></div>}
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              <div style={cell}>
                <label style={lbl}>Left end</label>
                <select style={field} value={sel.endStyle} onChange={(e) => setSelKey('endStyle', e.target.value)}>
                  {END_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div style={cell}>
                <label style={lbl}>Right end</label>
                <select style={field} value={sel.endStyleRight} onChange={(e) => setSelKey('endStyleRight', e.target.value)}>
                  {END_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              {sel.shape === 'STRAIGHT' ? (
                <>
                  <div style={cell}>
                    <label style={lbl}>Left mount</label>
                    <select style={field} value={sel.mountLeft} onChange={(e) => setSelKey('mountLeft', e.target.value)}>
                      {MOUNTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                  <div style={cell}>
                    <label style={lbl}>Right mount</label>
                    <select style={field} value={sel.mountRight} onChange={(e) => setSelKey('mountRight', e.target.value)}>
                      {MOUNTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                  </div>
                </>
              ) : (
                <div style={cell}>
                  <label style={lbl}>End mounts</label>
                  <select style={field} value={sel.mountOuter} onChange={(e) => setSelKey('mountOuter', e.target.value)}>
                    {MOUNTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              )}
              <div style={cell}>
                <label style={lbl}>Bracket projection (in){isBay ? '' : ' — optional'}</label>
                <input style={field} value={m.proj} onChange={(e) => setMKey('proj', e.target.value)} placeholder="4 5/8" />
              </div>
              <div style={cell}>
                <label style={lbl}>Rod diameter (in)</label>
                <input style={field} value={m.poleDiameter} onChange={(e) => setMKey('poleDiameter', e.target.value)} placeholder="1 3/8" />
              </div>
            </div>

            <button className="btn-ghost" onClick={() => setShowAdv(!showAdv)} style={{ marginBottom: showAdv ? 10 : 14 }}>
              {showAdv ? '▾ Hide' : '▸ Show'} clearance settings
            </button>
            {showAdv && (
              <div style={{ ...row, marginBottom: 14 }}>
                <div style={cell}><label style={lbl}>Bracket width (in)</label><input style={field} value={m.bracketW} onChange={(e) => setMKey('bracketW', e.target.value)} /></div>
                <div style={cell}><label style={lbl}>Return radius (in)</label><input style={field} value={m.returnRadius} onChange={(e) => setMKey('returnRadius', e.target.value)} /></div>
                <div style={cell}><label style={lbl}>Grip allowance (in)</label><input style={field} value={m.gripAllowance} onChange={(e) => setMKey('gripAllowance', e.target.value)} /></div>
                <div style={cell}><label style={lbl}>Inside-mount deduct (in)</label><input style={field} value={m.insideMountDeduct} onChange={(e) => setMKey('insideMountDeduct', e.target.value)} /></div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label style={lbl}>Notes for our team</label>
              <textarea style={{ ...field, minHeight: 64, resize: 'vertical' }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything unusual about this opening…" />
            </div>

            {subErr && <div className="empty" style={{ marginBottom: 12 }}>{subErr}</div>}
            <button className="btn" disabled={!!missing || busy} onClick={submit} style={{ width: '100%', opacity: missing ? 0.5 : 1 }}>
              {busy ? 'Sending…' : 'Send measurements for engineering & quote'}
            </button>
            {missing && <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: 8 }}>{missing}</div>}
          </div>

          {/* ── the fit readouts — the point of the page ── */}
          <div className="card" style={{ flex: '1 1 320px', padding: 20, position: 'sticky', top: 12 }}>
            <span className="eyebrow">Will it fit?</span>
            <div style={{ margin: '14px 0 4px', fontSize: '0.82rem', color: 'var(--ink-soft)' }}>Total System O2O (+ brackets) — <b>the outside-edge size your opening must accommodate</b></div>
            <div style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--ink)' }}>{both(fit.totalSystemO2O)}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: '2px 0 14px' }}>
              = {both(fit.poleO2O)} pole + {toFrac(fit.endAddL)} left + {toFrac(fit.endAddR)} right
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Pole O2O (edge-to-edge)</span><b>{both(fit.poleO2O)}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Left wall C2C</span><b>{both(fit.pole1)}</b></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>{sel.shape === 'STRAIGHT' ? 'Main wall C2C' : 'Center wall C2C'}</span><b>{both(fit.pole2)}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Right wall C2C</span><b>{both(fit.pole3)}</b></div>}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 14, lineHeight: 1.5 }}>
              Returns and inside mounts change these numbers automatically. End allowances use half your bracket width until our team confirms the exact hardware on review.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
