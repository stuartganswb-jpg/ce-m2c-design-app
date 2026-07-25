// MEASURE & FIT — the customer-facing half of Client Vision (measurement intake ONLY).
// FLOW-DRIVEN (Stuart 2026-07-25: "the vision tool must ask which brackets and end treatment and
// these choices come from the cpq flow"): after the product pick this page loads the flow via the
// portalFlow BFF and mirrors the internal Vision board's flow-mirror — Rod Diameter / Bracket
// Projection come from the flow's SIZE steps (inches resolved from the verbatim sizeMatrix
// registry by optId), each end's treatment comes from that side's End Treatment step's OPTIONS
// (endStyleOf mapping copied from VisionHardware: FRENCH_RETURN→RETURN_BEND, MITER_RETURN→
// RETURN_MITER, INSIDE_MOUNT/OPT-FLUSH→FLUSH), and brackets come from that position's Bracket &
// Mount step. Selections are stored as STEP params (stepId → optId — the same shape CPQ and the
// internal board use), so staff Load-Line/Configure pre-pick the exact same options.
// The readouts run the VERBATIM fit-math copy (shared/bayMath.js). NOTHING shop-only renders —
// no raw cuts, no saw angles, no drawings; staff derive those from this data in Vision.
import React, { useEffect, useMemo, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { computeBayMath, safeProjOf } from './shared/bayMath.js';
import { SIZE_STEP_TYPE, SIZE_FAMILIES, projAllowedAtDia, projOptionInches } from './shared/sizeMatrix.js';

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

// ——— flow-mirror helpers, copied from VisionHardware's flow-driven Fabrication Settings ———
const upperS = (s) => String(s || '').toUpperCase();
const endStepFor = (steps, pos) => (steps || []).find((s) => /end treatment/i.test(s.title || '') && upperS(s.position) === pos);
const bracketStepFor = (steps, pos) => (steps || []).find((s) => (s.stepRole === 'BRACKET' || /bracket/i.test(s.title || '')) && !/end treatment/i.test(s.title || '') && upperS(s.position) === pos);
const optOf = (step, sel) => step ? ((step.styleOptions || []).find((o) => (o.optId || o.partId) === sel) || null) : null;
const optIsReturn = (o) => {
  const t = upperS(o?.endTreatment);
  if (t) return t === 'FRENCH_RETURN' || t === 'MITER_RETURN' || t === 'INSIDE_MOUNT';
  if (!o) return false;
  if (/^OPT-(BEND|MITER)/i.test(o.optId || '')) return true;
  return /bend|return|miter|mitre|mtr|french/i.test(String(o.partName || ''));
};
const endStyleOf = (o) => {
  const t = upperS(o?.endTreatment);
  if (t === 'FRENCH_RETURN') return 'RETURN_BEND';
  if (t === 'MITER_RETURN') return 'RETURN_MITER';
  if (t === 'INSIDE_MOUNT') return 'FLUSH';
  if (t === 'FINIAL') return 'FINIAL';
  if (/^OPT-FLUSH/i.test(o?.optId || '')) return 'FLUSH';
  if (/^OPT-BEND/i.test(o?.optId || '')) return 'RETURN_BEND';
  if (/^OPT-MITER/i.test(o?.optId || '')) return 'RETURN_MITER';
  return o ? 'FINIAL' : '';
};

const SHAPES = [
  { id: 'STRAIGHT', label: 'Straight' },
  { id: 'MITERED', label: 'Angled Bay' },
  { id: 'BOW', label: 'Curved Bay' },
];
const GENERIC_ENDS = [
  { id: 'FINIAL', label: 'Finial / End Cap' },
  { id: 'RETURN_BEND', label: 'French (Bent) Return' },
  { id: 'RETURN_MITER', label: 'Mitered Return' },
  { id: 'FLUSH', label: 'Flush Cut' },
];

// ——— static fit diagrams, one per shape (Stuart 2026-07-25: "put the drawings from the vision
// board onto the portal screen as a static example showing the marked lines") ———
// Simplified from the internal Vision board's plan view, same visual language: GREY = the wall
// (what the customer measured), BRASS = the pole, DASHED = bracket-center C2C, and the outer
// span = Total System O2O. Illustrative only — the live numbers are in the readout rows below.
const DG = { wall: '#c9c3b6', pole: '#b08d57', dim: '#8a857b', ink: '#4a463e' };
const dgTxt = { fontFamily: 'var(--mono, monospace)', fontSize: 8.5, letterSpacing: '.06em' };
const DimLine = ({ x1, x2, y, label, bold, dash }) => (
  <g>
    <line x1={x1} y1={y} x2={x2} y2={y} stroke={bold ? DG.ink : DG.dim} strokeWidth={bold ? 1.2 : 1} strokeDasharray={dash ? '4 3' : undefined} />
    <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} stroke={bold ? DG.ink : DG.dim} strokeWidth={1} />
    <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} stroke={bold ? DG.ink : DG.dim} strokeWidth={1} />
    <text x={(x1 + x2) / 2} y={y - 5} textAnchor="middle" fill={bold ? DG.ink : DG.dim} style={dgTxt} fontWeight={bold ? 700 : 400}>{label}</text>
  </g>
);
const FitDiagram = ({ shape }) => {
  if (shape === 'MITERED') {
    return (
      <svg viewBox="0 0 460 186" style={{ width: '100%', display: 'block' }} aria-label="Angled bay diagram">
        <polyline points="30,148 120,42 340,42 430,148" fill="none" stroke={DG.wall} strokeWidth="3" />
        <text x="230" y="30" textAnchor="middle" fill={DG.dim} style={dgTxt}>CENTER WALL — YOUR MEASUREMENT</text>
        <text x="52" y="86" fill={DG.dim} style={dgTxt} transform="rotate(-50 52 86)">LEFT WALL</text>
        <text x="418" y="78" fill={DG.dim} style={dgTxt} transform="rotate(50 418 78)">RIGHT WALL</text>
        <polyline points="52,142 130,54 330,54 408,142" fill="none" stroke={DG.pole} strokeWidth="4" strokeLinejoin="round" />
        <circle cx="130" cy="54" r="2.5" fill={DG.ink} /><circle cx="330" cy="54" r="2.5" fill={DG.ink} />
        <text x="130" y="74" textAnchor="middle" fill={DG.ink} style={dgTxt}>MITER</text>
        <text x="330" y="74" textAnchor="middle" fill={DG.ink} style={dgTxt}>MITER</text>
        <DimLine x1={130} x2={330} y={96} dash label="CENTER WALL C2C" />
        <DimLine x1={52} x2={408} y={170} bold label="TOTAL SYSTEM O2O (+ BRACKETS) — MUST FIT" />
      </svg>
    );
  }
  if (shape === 'BOW') {
    return (
      <svg viewBox="0 0 460 186" style={{ width: '100%', display: 'block' }} aria-label="Curved bay diagram">
        <path d="M 40 132 Q 230 14 420 132" fill="none" stroke={DG.wall} strokeWidth="3" />
        <text x="230" y="26" textAnchor="middle" fill={DG.dim} style={dgTxt}>WALL — POLE FOLLOWS THE CURVE</text>
        <path d="M 58 130 Q 230 34 402 130" fill="none" stroke={DG.pole} strokeWidth="4" />
        <circle cx="58" cy="130" r="4" fill={DG.pole} /><circle cx="402" cy="130" r="4" fill={DG.pole} />
        <line x1="230" y1="140" x2="230" y2="76" stroke={DG.dim} strokeWidth="1" />
        <line x1="226" y1="80" x2="230" y2="76" stroke={DG.dim} strokeWidth="1" /><line x1="234" y1="80" x2="230" y2="76" stroke={DG.dim} strokeWidth="1" />
        <text x="238" y="106" fill={DG.dim} style={dgTxt}>BAY DEPTH</text>
        <DimLine x1={40} x2={420} y={148} dash label="CHORD WIDTH — YOUR MEASUREMENT" />
        <DimLine x1={58} x2={402} y={174} bold label="TOTAL SYSTEM O2O (+ BRACKETS) — MUST FIT" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 460 168" style={{ width: '100%', display: 'block' }} aria-label="Straight rod diagram">
      <line x1="30" y1="26" x2="430" y2="26" stroke={DG.wall} strokeWidth="3" />
      <text x="230" y="16" textAnchor="middle" fill={DG.dim} style={dgTxt}>WALL / OPENING — YOUR MEASUREMENT</text>
      <rect x="86" y="26" width="7" height="30" fill={DG.wall} />
      <rect x="367" y="26" width="7" height="30" fill={DG.wall} />
      <line x1="58" y1="60" x2="402" y2="60" stroke={DG.pole} strokeWidth="4" />
      <circle cx="52" cy="60" r="5" fill={DG.pole} /><circle cx="408" cy="60" r="5" fill={DG.pole} />
      <DimLine x1={89} x2={371} y={88} dash label="MAIN WALL C2C — BRACKET CENTERS" />
      <DimLine x1={58} x2={402} y={116} label="POLE O2O (EDGE-TO-EDGE)" />
      <DimLine x1={47} x2={413} y={148} bold label="TOTAL SYSTEM O2O (+ BRACKETS) — MUST FIT" />
    </svg>
  );
};

const lbl = { fontFamily: 'var(--mono, monospace)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', margin: '0 0 6px' };
const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontSize: '0.95rem', outline: 'none', background: '#fff', borderRadius: 2 };
const row = { display: 'flex', gap: 12, flexWrap: 'wrap' };
const cell = { flex: 1, minWidth: 150 };
const toggleBtn = (on) => ({ flex: 1, padding: '10px 4px', cursor: 'pointer', borderRadius: 2, fontSize: '0.85rem', border: `1px solid ${on ? 'var(--brass, #b08d57)' : 'var(--line)'}`, background: on ? 'var(--brass, #b08d57)' : '#fff', color: on ? '#fff' : 'var(--ink)' });

export default function VisionIntake() {
  const [products, setProducts] = useState(null);
  const [loadErr, setLoadErr] = useState(null);
  const [flowId, setFlowId] = useState('');
  const [flow, setFlow] = useState(null);        // sanitized flow from portalFlow
  const [flowBusy, setFlowBusy] = useState(false);
  const [sidemark, setSidemark] = useState('');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState({ shape: 'STRAIGHT', inputMode: 'WALL', endStyle: 'FINIAL', endStyleRight: 'FINIAL', mountLeft: 'OPEN', mountRight: 'OPEN', mountOuter: 'OPEN' });
  const [params, setParams] = useState({});      // stepId → optId, the CPQ selection shape
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

  // Product pick → load its flow (same BFF the configurator uses). Seed the shape from the
  // flow's bay configuration and reset step picks to the flow's defaults.
  useEffect(() => {
    if (!flowId) { setFlow(null); setParams({}); return; }
    let alive = true;
    setFlowBusy(true); setFlow(null); setParams({});
    httpsCallable(functions, 'portalFlow')({ flowId })
      .then((res) => {
        if (!alive) return;
        const f = res.data?.flow || null;
        setFlow(f);
        const fs = upperS(res.data?.fabShape || '');
        if (fs === 'MITERED' || fs === 'BOW' || fs === 'STRAIGHT') setSel((p) => ({ ...p, shape: fs }));
      })
      .catch(() => { if (alive) setFlow(null); })
      .finally(() => { if (alive) setFlowBusy(false); });
    return () => { alive = false; };
  }, [flowId]);

  const steps = flow?.steps || [];
  const stepDia = steps.find((s) => s.type === SIZE_STEP_TYPE && s.sizeAxis === 'DIA') || null;
  const stepProjSz = steps.find((s) => s.type === SIZE_STEP_TYPE && s.sizeAxis === 'PROJ') || null;
  const stepEndL = endStepFor(steps, 'LEFT'), stepEndR = endStepFor(steps, 'RIGHT');
  const stepBrL = bracketStepFor(steps, 'LEFT'), stepBrR = bracketStepFor(steps, 'RIGHT'), stepBrC = bracketStepFor(steps, 'CENTER');
  const fam = stepDia ? SIZE_FAMILIES[stepDia.sizeFamily] : null;

  const setParam = (stepId, v) => setParams((p) => { const n = { ...p }; if (v) n[stepId] = v; else delete n[stepId]; return n; });

  // Registry-resolved size picks (defaults = the family base, exactly what the internal board
  // labels "-- Default --"). Registry lookup by optId, never label parsing.
  const diaOpt = useMemo(() => {
    if (!stepDia || !fam) return null;
    const selId = params[stepDia.id];
    return fam.dia.options.find((o) => o.optId === selId) || fam.dia.options.find((o) => o.value === fam.baseDia) || fam.dia.options[0];
  }, [stepDia, fam, params]);
  const projOptsAtDia = useMemo(() => {
    if (!stepProjSz || !fam) return [];
    return (stepProjSz.styleOptions || []).filter((o) => projAllowedAtDia(stepProjSz.sizeFamily, o, diaOpt?.value));
  }, [stepProjSz, fam, diaOpt]);
  const projOpt = useMemo(() => {
    if (!stepProjSz || !fam) return null;
    const selId = params[stepProjSz.id];
    return projOptsAtDia.find((o) => o.optId === selId)
      || projOptsAtDia.find((o) => o.sizeValue === fam.baseProj) || projOptsAtDia[0] || null;
  }, [stepProjSz, fam, params, projOptsAtDia]);

  const endOptL = optOf(stepEndL, stepEndL ? params[stepEndL.id] : null);
  const endOptR = optOf(stepEndR, stepEndR ? params[stepEndR.id] : null);
  // A chosen return replaces that side's bracket when the step carries return-only plates —
  // same grey rule as the internal board ("— replaced by —").
  const brLocked = (brStep, endOpt) => !!(brStep && (brStep.subOptions || []).some((o) => o.returnOnly) && optIsReturn(endOpt));
  const brLockedL = brLocked(stepBrL, endOptL), brLockedR = brLocked(stepBrR, endOptR);
  useEffect(() => {
    if (brLockedL && stepBrL && params[stepBrL.id]) setParam(stepBrL.id, '');
    if (brLockedR && stepBrR && params[stepBrR.id]) setParam(stepBrR.id, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brLockedL, brLockedR]);

  const setSelKey = (k, v) => setSel((p) => ({ ...p, [k]: v }));
  const setMKey = (k, v) => setM((p) => ({ ...p, [k]: v }));

  // The engData the internal Vision board runs on — same keys, decimal inches always.
  // Flow-driven fields (dia / proj / end styles / INSIDE mount flip) derive from the STEP picks,
  // exactly like VisionHardware's flow-mirror; free inputs remain only where the flow has no step.
  const engData = useMemo(() => {
    const endL = stepEndL ? (endOptL ? endStyleOf(endOptL) : 'FINIAL') : sel.endStyle;
    const endR = stepEndR ? (endOptR ? endStyleOf(endOptR) : 'FINIAL') : sel.endStyleRight;
    const imL = upperS(endOptL?.endTreatment) === 'INSIDE_MOUNT';
    const imR = upperS(endOptR?.endTreatment) === 'INSIDE_MOUNT';
    const mountL = sel.shape === 'STRAIGHT' && stepEndL ? (imL ? 'INSIDE' : (sel.mountLeft === 'INSIDE' ? 'OPEN' : sel.mountLeft)) : sel.mountLeft;
    const mountR = sel.shape === 'STRAIGHT' && stepEndR ? (imR ? 'INSIDE' : (sel.mountRight === 'INSIDE' ? 'OPEN' : sel.mountRight)) : sel.mountRight;
    const dia = diaOpt && Number.isFinite(diaOpt.inches) ? diaOpt.inches : (parseMeas(m.poleDiameter) || 1);
    const projIn = projOpt ? projOptionInches(stepProjSz.sizeFamily, projOpt) : null;
    const proj = projIn != null ? projIn : (m.proj === '' ? '' : parseMeas(m.proj));
    return {
      shape: sel.shape, inputMode: sel.inputMode,
      w1: parseMeas(m.w1), w2: parseMeas(m.w2), w3: parseMeas(m.w3),
      a1: 135, a2: 135, bowDepth: parseMeas(m.bowDepth),
      mountLeft: mountL, mountRight: mountR, mountCenter: 'OPEN', mountOuter: sel.mountOuter,
      endStyle: endL, endStyleRight: endR,
      proj,
      bracketId: '', bracketIdRight: '', bracketIdCenter: '', backplateIdLeft: '', backplateIdRight: '', backplateIdCenter: '',
      poleDiameter: dia, bracketW: parseMeas(m.bracketW) || 3, finialW: 3.5,
      bracketThickness: 0.25, insideMountDeduct: parseMeas(m.insideMountDeduct) || 0.25,
      returnRadius: parseMeas(m.returnRadius) || 4, gripAllowance: parseMeas(m.gripAllowance) || 8.5,
    };
  }, [sel, m, stepEndL, stepEndR, endOptL, endOptR, diaOpt, projOpt, stepProjSz]);

  // IDENTICAL math to the internal board (verbatim bayMath copy). No parts library on the
  // portal → open ends use the half-bracket-width allowance; staff confirm exact hardware.
  const fit = useMemo(() => computeBayMath({ engData, safeProj: safeProjOf(engData), libraryParts: [] }), [engData]);

  const isBay = sel.shape !== 'STRAIGHT';
  const needProj = isBay && !safeProjOf(engData);
  const missing =
    !flowId ? 'Pick a product first.'
    : flowBusy ? 'Loading the product’s options…'
    : !sidemark.trim() ? 'Give this window a name (sidemark) — e.g. “Living Room East”.'
    : !(engData.w2 > 0) ? (sel.shape === 'MITERED' ? 'Enter the center wall measurement.' : 'Enter the width measurement.')
    : (sel.shape === 'MITERED' && !(engData.w1 > 0 && engData.w3 > 0)) ? 'Enter the left and right wall measurements.'
    : (sel.shape === 'BOW' && !(engData.bowDepth > 0)) ? 'Enter the bay depth.'
    : needProj ? 'Pick the bracket projection (bay math needs it).'
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
      // Step params include the registry defaults explicitly, so the staff board and CPQ
      // Configure open with the SAME picks the customer's readouts used.
      const outParams = { ...params };
      if (stepDia && diaOpt) outParams[stepDia.id] = diaOpt.optId;
      if (stepProjSz && projOpt) outParams[stepProjSz.id] = projOpt.optId;
      const res = await httpsCallable(functions, 'portalVisionDraft')({ flowId, flowName, sidemark: sidemark.trim(), note, engData, preview, params: outParams });
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

  const endSelect = (side, st, endOpt) => {
    const isLeft = side === 'LEFT';
    if (!st) {
      // No End Treatment step on this flow → generic fallback (never the case for generated flows).
      const key = isLeft ? 'endStyle' : 'endStyleRight';
      return (
        <select style={field} value={sel[key]} onChange={(e) => setSelKey(key, e.target.value)}>
          {GENERIC_ENDS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      );
    }
    return (
      <select style={field} value={endOpt?.optId || ''} onChange={(e) => setParam(st.id, e.target.value)}>
        <option value="">— choose from this collection —</option>
        {(st.styleOptions || []).map((o) => <option key={o.optId} value={o.optId}>{o.partName || o.label || o.optId}</option>)}
      </select>
    );
  };
  const bracketSelect = (st, locked) => (
    <select style={{ ...field, opacity: locked ? 0.5 : 1 }} value={locked ? '' : (params[st.id] || '')} disabled={locked} onChange={(e) => setParam(st.id, e.target.value)}>
      <option value="">{locked ? '— replaced by the return —' : '— our team can choose —'}</option>
      {(st.styleOptions || []).map((o) => <option key={o.optId} value={o.optId}>{o.partName || o.label || o.optId}</option>)}
    </select>
  );

  return (
    <div style={{ marginTop: 24 }}>
      <h2 className="sec">Measure &amp; Fit</h2>
      <p style={{ color: 'var(--ink-soft)', margin: '0 0 16px', fontSize: '0.92rem' }}>
        Enter your wall measurements and pick the end treatments — we show the <b>outside-edge size the finished system needs</b>, so it fits before it ships.
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
                    <button key={s.id} onClick={() => setSelKey('shape', s.id)} style={toggleBtn(sel.shape === s.id)}>{s.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              <div style={{ ...cell, flexBasis: '100%' }}>
                <label style={lbl}>What did you measure?</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setSelKey('inputMode', 'WALL')} style={toggleBtn(sel.inputMode === 'WALL')}>Wall / opening (outside edges)</button>
                  <button onClick={() => setSelKey('inputMode', 'ORDERING')} style={toggleBtn(sel.inputMode === 'ORDERING')}>Exact pole length I want</button>
                </div>
              </div>
            </div>

            <div style={{ ...row, marginBottom: 14 }}>
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Left wall (in)</label><input style={field} value={m.w1} onChange={(e) => setMKey('w1', e.target.value)} placeholder="30" /></div>}
              <div style={cell}><label style={lbl}>{sel.shape === 'MITERED' ? 'Center wall (in)' : 'Width (in)'}</label><input style={field} value={m.w2} onChange={(e) => setMKey('w2', e.target.value)} placeholder="138 3/4" /></div>
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Right wall (in)</label><input style={field} value={m.w3} onChange={(e) => setMKey('w3', e.target.value)} placeholder="30" /></div>}
              {sel.shape === 'BOW' && <div style={cell}><label style={lbl}>Bay depth (in)</label><input style={field} value={m.bowDepth} onChange={(e) => setMKey('bowDepth', e.target.value)} placeholder="15" /></div>}
            </div>

            {flowBusy && <div className="empty" style={{ marginBottom: 14 }}>Loading this collection's options…</div>}

            {/* Size steps — from the flow, inches from the registry (never typed) */}
            {(stepDia || stepProjSz) && (
              <div style={{ ...row, marginBottom: 14 }}>
                {stepDia && (
                  <div style={cell}>
                    <label style={lbl}>{stepDia.title || 'Rod Diameter'} — from this collection</label>
                    <select style={field} value={diaOpt?.optId || ''} onChange={(e) => setParam(stepDia.id, e.target.value)}>
                      {(fam?.dia.options || []).map((o) => <option key={o.optId} value={o.optId}>{o.label}</option>)}
                    </select>
                  </div>
                )}
                {stepProjSz && (
                  <div style={cell}>
                    <label style={lbl}>{stepProjSz.title || 'Bracket Projection'} — from this collection</label>
                    <select style={field} value={projOpt?.optId || ''} onChange={(e) => setParam(stepProjSz.id, e.target.value)}>
                      {projOptsAtDia.map((o) => <option key={o.optId} value={o.optId}>{o.partName || o.label}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
            {/* Free inputs ONLY when the flow carries no size steps */}
            {flow && !stepDia && (
              <div style={{ ...row, marginBottom: 14 }}>
                <div style={cell}><label style={lbl}>Rod diameter (in)</label><input style={field} value={m.poleDiameter} onChange={(e) => setMKey('poleDiameter', e.target.value)} placeholder="1 3/8" /></div>
                {!stepProjSz && <div style={cell}><label style={lbl}>Bracket projection (in){isBay ? '' : ' — optional'}</label><input style={field} value={m.proj} onChange={(e) => setMKey('proj', e.target.value)} placeholder="4 5/8" /></div>}
              </div>
            )}

            <div style={{ ...row, marginBottom: 14 }}>
              <div style={cell}>
                <label style={lbl}>Left end{stepEndL ? ' — from this collection' : ''}</label>
                {endSelect('LEFT', stepEndL, endOptL)}
              </div>
              <div style={cell}>
                <label style={lbl}>Right end{stepEndR ? ' — from this collection' : ''}</label>
                {endSelect('RIGHT', stepEndR, endOptR)}
              </div>
            </div>

            {(stepBrL || stepBrR || stepBrC) && (
              <div style={{ ...row, marginBottom: 14 }}>
                {stepBrL && <div style={cell}><label style={lbl}>Left bracket</label>{bracketSelect(stepBrL, brLockedL)}</div>}
                {stepBrC && <div style={cell}><label style={lbl}>Center bracket</label>{bracketSelect(stepBrC, false)}</div>}
                {stepBrR && <div style={cell}><label style={lbl}>Right bracket</label>{bracketSelect(stepBrR, brLockedR)}</div>}
              </div>
            )}

            <div style={{ ...row, marginBottom: 14 }}>
              {sel.shape === 'STRAIGHT' ? (
                <>
                  <div style={cell}>
                    <label style={lbl}>Left mount</label>
                    <select style={field} value={engData.mountLeft} disabled={upperS(endOptL?.endTreatment) === 'INSIDE_MOUNT'} onChange={(e) => setSelKey('mountLeft', e.target.value)}>
                      <option value="OPEN">Wall</option><option value="CEILING">Ceiling</option>
                      {(upperS(endOptL?.endTreatment) === 'INSIDE_MOUNT' || !stepEndL) && <option value="INSIDE">Inside Mount</option>}
                    </select>
                  </div>
                  <div style={cell}>
                    <label style={lbl}>Right mount</label>
                    <select style={field} value={engData.mountRight} disabled={upperS(endOptR?.endTreatment) === 'INSIDE_MOUNT'} onChange={(e) => setSelKey('mountRight', e.target.value)}>
                      <option value="OPEN">Wall</option><option value="CEILING">Ceiling</option>
                      {(upperS(endOptR?.endTreatment) === 'INSIDE_MOUNT' || !stepEndR) && <option value="INSIDE">Inside Mount</option>}
                    </select>
                  </div>
                </>
              ) : (
                <div style={cell}>
                  <label style={lbl}>End mounts</label>
                  <select style={field} value={sel.mountOuter} onChange={(e) => setSelKey('mountOuter', e.target.value)}>
                    <option value="OPEN">Wall</option><option value="CEILING">Ceiling</option><option value="INSIDE">Inside Mount</option>
                  </select>
                </div>
              )}
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
            <div style={{ margin: '12px 0 4px', border: '1px solid var(--line)', background: '#faf8f3', borderRadius: 2, padding: '8px 6px' }}>
              <FitDiagram shape={sel.shape} />
            </div>
            <div style={{ margin: '10px 0 4px', fontSize: '0.82rem', color: 'var(--ink-soft)' }}>Total System O2O (+ brackets) — <b>the outside-edge size your opening must accommodate</b></div>
            <div style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--ink)' }}>{both(fit.totalSystemO2O)}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: '2px 0 14px' }}>
              = {both(fit.poleO2O)} pole + {toFrac(fit.endAddL)} left + {toFrac(fit.endAddR)} right
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Pole O2O (edge-to-edge)</span><b>{both(fit.poleO2O)}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Left wall C2C</span><b>{both(fit.pole1)}</b></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>{sel.shape === 'STRAIGHT' ? 'Main wall C2C' : 'Center wall C2C'}</span><b>{both(fit.pole2)}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Right wall C2C</span><b>{both(fit.pole3)}</b></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Rod diameter</span><b>{both(engData.poleDiameter)}</b></div>
              {safeProjOf(engData) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Projection</span><b>{both(safeProjOf(engData))}</b></div>}
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
