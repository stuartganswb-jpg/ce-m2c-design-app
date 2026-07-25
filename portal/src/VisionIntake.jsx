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
const dgTxt = { fontFamily: 'var(--mono, monospace)', fontSize: 9.5, letterSpacing: '.06em' };
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
  // STRAIGHT example drawn WITH FRENCH RETURNS (Stuart 2026-07-25: "the finials have less
  // understanding problem than the french return"), geometry per his 2nd review: the return legs
  // run 90° STRAIGHT back to the wall (no inward curl); MAIN WALL C2C points at the CENTER of
  // those legs (= the backplate centers); BACKPLATES sit on the wall extending just past the C2C
  // ticks, and TOTAL SYSTEM O2O spans their OUTER edges — the backplate drives that number.
  return (
    <svg viewBox="0 0 460 178" style={{ width: '100%', display: 'block' }} aria-label="Straight rod with french returns diagram">
      <line x1="30" y1="24" x2="430" y2="24" stroke={DG.wall} strokeWidth="3" />
      <text x="230" y="14" textAnchor="middle" fill={DG.dim} style={dgTxt}>WALL / OPENING — YOUR MEASUREMENT</text>
      {/* backplates on the wall, centered on the return legs — their outer edges = the system's outside */}
      <rect x="46" y="27" width="36" height="6" fill="#a89f8d" />
      <rect x="378" y="27" width="36" height="6" fill="#a89f8d" />
      <line x1="60" y1="33" x2="96" y2="41" stroke={DG.dim} strokeWidth="1" />
      <text x="100" y="44" fill={DG.ink} style={dgTxt}>BACKPLATE ON THE WALL</text>
      {/* pole: the returns run 90° straight back to the wall, radiused only at the elbow */}
      <path d="M 64 34 L 64 48 Q 64 62 78 62 L 382 62 Q 396 62 396 48 L 396 34" fill="none" stroke={DG.pole} strokeWidth="4" strokeLinecap="round" />
      <line x1="394" y1="42" x2="356" y2="54" stroke={DG.dim} strokeWidth="1" />
      <text x="352" y="57" textAnchor="end" fill={DG.ink} style={dgTxt}>FRENCH RETURN — 90° BACK TO THE WALL</text>
      <DimLine x1={64} x2={396} y={94} dash label="MAIN WALL C2C — CENTER OF RETURN / BACKPLATE" />
      <DimLine x1={62} x2={398} y={122} label="POLE O2O (EDGE-TO-EDGE — INCLUDES THE RETURNS)" />
      <DimLine x1={46} x2={414} y={154} bold label="TOTAL SYSTEM O2O — TO THE BACKPLATE OUTER EDGES" />
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
  const [priced, setPriced] = useState(null);    // portalResolve stepOptions — the customer's codes + prices, "just like cpq"
  const [sidemark, setSidemark] = useState('');
  const [note, setNote] = useState('');
  const [sel, setSel] = useState({ shape: 'STRAIGHT', inputMode: 'WALL', endStyle: 'FINIAL', endStyleRight: 'FINIAL', mountLeft: 'OPEN', mountRight: 'OPEN', mountOuter: 'OPEN' });
  const [params, setParams] = useState({});      // stepId → optId, the CPQ selection shape
  const [m, setM] = useState({ w1: '', w2: '', w3: '', bowDepth: '', proj: '', poleDiameter: '1', bracketW: '3', returnRadius: '4', gripAllowance: '8.5', insideMountDeduct: '0.25' });
  const [showAdv, setShowAdv] = useState(false);
  const [zoomDia, setZoomDia] = useState(false); // click-to-enlarge lightbox for the fit diagram
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

  // Per-customer option pricing + code spellings from the SAME engine the configurator uses
  // (portalResolve → resolveStepOptions): desc, OUR code, the customer's Fabricut pattern #, and
  // their level-priced amount. Re-fetched when the diameter changes (codes/prices size-swap).
  useEffect(() => {
    if (!flowId || !flow) { setPriced(null); return; }
    let alive = true;
    const sizeParams = {};
    if (stepDia && diaOpt) sizeParams[stepDia.id] = diaOpt.optId;
    if (stepProjSz && projOpt) sizeParams[stepProjSz.id] = projOpt.optId;
    httpsCallable(functions, 'portalResolve')({ flowId, selections: { params: sizeParams, quantities: {} } })
      .then((res) => { if (alive) setPriced(res.data?.stepOptions || null); })
      .catch(() => { if (alive) setPriced(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowId, flow, diaOpt?.optId, projOpt?.optId]);

  // Dropdown text "just like cpq": DESCRIPTION — OUR code / FABRICUT code — $customer price.
  const optionLabel = (st, o, isSub) => {
    const fallback = o.partName || o.label || o.optId;
    const po = st && priced?.[st.id]?.[isSub ? 'subOptions' : 'options']?.[o.optId || o.partId];
    if (!po) return fallback;
    const codes = [po.ourCode, po.fabCode && po.fabCode !== po.ourCode ? po.fabCode : ''].filter(Boolean).join(' / ');
    const pr = parseFloat(po.price);
    const price = Number.isFinite(pr) && pr > 0 ? ` — $${(Math.round(pr * 100) / 100).toLocaleString('en-US')}` : '';
    return `${po.desc || po.name || fallback}${codes ? ` — ${codes}` : ''}${price}`;
  };

  const endOptL = optOf(stepEndL, stepEndL ? params[stepEndL.id] : null);
  const endOptR = optOf(stepEndR, stepEndR ? params[stepEndR.id] : null);
  // A chosen return replaces that side's bracket when the step carries return-only plates —
  // same grey rule as the internal board ("— replaced by —").
  const brLocked = (brStep, endOpt) => !!(brStep && (brStep.subOptions || []).some((o) => o.returnOnly) && optIsReturn(endOpt));
  const brLockedL = brLocked(stepBrL, endOptL), brLockedR = brLocked(stepBrR, endOptR);
  // Selected brackets + BACKPLATES (Stuart 2026-07-25: "the next step will be to choose the
  // backplate, which is essential as the backplate drives the total system o2o"). Plate params
  // ride under `${stepId}__sub` — the exact key CPQ and the internal board use.
  const brOptL = optOf(stepBrL, stepBrL ? params[stepBrL.id] : null);
  const brOptR = optOf(stepBrR, stepBrR ? params[stepBrR.id] : null);
  const brOptC = optOf(stepBrC, stepBrC ? params[stepBrC.id] : null);
  const subOf = (step, sel2) => step ? ((step.subOptions || []).find((o) => (o.optId || o.partId) === sel2) || null) : null;
  const subL = subOf(stepBrL, stepBrL ? params[`${stepBrL.id}__sub`] : null);
  const subR = subOf(stepBrR, stepBrR ? params[`${stepBrR.id}__sub`] : null);
  const subC = subOf(stepBrC, stepBrC ? params[`${stepBrC.id}__sub`] : null);
  // Plate pool per position — a chosen return scopes to the RETURN plates, otherwise the regular
  // (non-return, non-inline) plates: the same rule as the internal board / CPQ sub-picker.
  const subPoolFor = (st, endOpt) => {
    const subs = st?.subOptions || [];
    if (!subs.length) return [];
    if (optIsReturn(endOpt) && subs.some((o) => o.returnOnly)) return subs.filter((o) => o.returnOnly);
    return subs.filter((o) => !o.returnOnly && !o.inlineOnly);
  };
  const subPoolL = subPoolFor(stepBrL, endOptL), subPoolR = subPoolFor(stepBrR, endOptR), subPoolC = subPoolFor(stepBrC, null);
  useEffect(() => {
    if (brLockedL && stepBrL && params[stepBrL.id]) setParam(stepBrL.id, '');
    if (brLockedR && stepBrR && params[stepBrR.id]) setParam(stepBrR.id, '');
    // End flip → a plate selected from the other pool (regular ↔ return) clears.
    [[stepBrL, subPoolL], [stepBrR, subPoolR]].forEach(([st, pool]) => {
      if (!st) return;
      const k = `${st.id}__sub`;
      if (params[k] && !pool.some((o) => (o.optId || o.partId) === params[k])) setParam(k, '');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brLockedL, brLockedR, endOptL, endOptR]);
  // Synthetic parts library from the flow's attached dims (portalFlow ships width/length/
  // orientation/arm for bracket-step options) — the VERBATIM bayMath then resolves
  // bpEndHalf/armThk/isReturnBracket exactly as the internal board does with the real library.
  const dimParts = useMemo(() => {
    const out = [];
    [stepBrL, stepBrR, stepBrC].forEach((st) => {
      if (!st) return;
      [...(st.styleOptions || []), ...(st.subOptions || [])].forEach((o) => {
        if (!o?.partId || !o.dims) return;
        out.push({ id: o.partId, manufacturingSpecs: {
          parametric: { width: o.dims.width ?? '', length: o.dims.length ?? '', fixedDiameter: o.dims.fixedDiameter ?? '' },
          customData: { bpOrientation: o.dims.bpOrientation || 'VERTICAL', armThickness: o.dims.armThickness ?? '', isReturnBracket: !!o.dims.isReturnBracket },
        } });
      });
    });
    return out;
  }, [stepBrL, stepBrR, stepBrC]);

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
      bracketId: brOptL?.partId || '', bracketIdRight: brOptR?.partId || '', bracketIdCenter: brOptC?.partId || '',
      backplateIdLeft: subL?.partId || '', backplateIdRight: subR?.partId || '', backplateIdCenter: subC?.partId || '',
      poleDiameter: dia, bracketW: parseMeas(m.bracketW) || 3, finialW: 3.5,
      bracketThickness: 0.25, insideMountDeduct: parseMeas(m.insideMountDeduct) || 0.25,
      returnRadius: parseMeas(m.returnRadius) || 4, gripAllowance: parseMeas(m.gripAllowance) || 8.5,
    };
  }, [sel, m, stepEndL, stepEndR, endOptL, endOptR, diaOpt, projOpt, stepProjSz, brOptL, brOptR, brOptC, subL, subR, subC]);

  // IDENTICAL math to the internal board (verbatim bayMath copy), fed the flow's attached
  // bracket/backplate dims — a chosen backplate on a return end drives Total System O2O.
  const fit = useMemo(() => computeBayMath({ engData, safeProj: safeProjOf(engData), libraryParts: dimParts }), [engData, dimParts]);

  const isBay = sel.shape !== 'STRAIGHT';
  const needProj = isBay && !safeProjOf(engData);
  // Readouts stay blank until the measurements exist — a half-filled form must never show a
  // plausible-looking wrong number (the empty-width "3-inch system" incident, 2026-07-25).
  const measReady = engData.w2 > 0
    && (sel.shape !== 'MITERED' || (engData.w1 > 0 && engData.w3 > 0))
    && (sel.shape !== 'BOW' || engData.bowDepth > 0)
    && !needProj;
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
        {(st.styleOptions || []).map((o) => <option key={o.optId} value={o.optId}>{optionLabel(st, o, false)}</option>)}
      </select>
    );
  };
  const bracketSelect = (st, locked) => (
    <select style={{ ...field, opacity: locked ? 0.5 : 1 }} value={locked ? '' : (params[st.id] || '')} disabled={locked} onChange={(e) => setParam(st.id, e.target.value)}>
      <option value="">{locked ? '— replaced by the return —' : '— our team can choose —'}</option>
      {(st.styleOptions || []).map((o) => <option key={o.optId} value={o.optId}>{optionLabel(st, o, false)}</option>)}
    </select>
  );
  const plateSelect = (st, pool) => (
    <select style={field} value={params[`${st.id}__sub`] || ''} onChange={(e) => setParam(`${st.id}__sub`, e.target.value)}>
      <option value="">— our team can choose —</option>
      {pool.map((o) => <option key={o.optId || o.partId} value={o.optId || o.partId}>{optionLabel(st, o, true)}</option>)}
    </select>
  );

  return (
    // Breaks out of the 980px shell (Stuart: "i have more room left and right") — this tab only;
    // Orders/Showroom keep the standard width.
    <div style={{ marginTop: 24, position: 'relative', left: '50%', transform: 'translateX(-50%)', width: 'min(1320px, calc(100vw - 48px))' }}>
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
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Left wall (in)</label><input style={field} value={m.w1} onChange={(e) => setMKey('w1', e.target.value)} placeholder="e.g. 30" /></div>}
              <div style={cell}><label style={lbl}>{sel.shape === 'MITERED' ? 'Center wall (in)' : 'Width (in)'}</label><input style={field} value={m.w2} onChange={(e) => setMKey('w2', e.target.value)} placeholder="e.g. 138 3/4" /></div>
              {sel.shape === 'MITERED' && <div style={cell}><label style={lbl}>Right wall (in)</label><input style={field} value={m.w3} onChange={(e) => setMKey('w3', e.target.value)} placeholder="e.g. 30" /></div>}
              {sel.shape === 'BOW' && <div style={cell}><label style={lbl}>Bay depth (in)</label><input style={field} value={m.bowDepth} onChange={(e) => setMKey('bowDepth', e.target.value)} placeholder="e.g. 15" /></div>}
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
                <div style={cell}><label style={lbl}>Rod diameter (in)</label><input style={field} value={m.poleDiameter} onChange={(e) => setMKey('poleDiameter', e.target.value)} placeholder="e.g. 1 3/8" /></div>
                {!stepProjSz && <div style={cell}><label style={lbl}>Bracket projection (in){isBay ? '' : ' — optional'}</label><input style={field} value={m.proj} onChange={(e) => setMKey('proj', e.target.value)} placeholder="e.g. 4 5/8" /></div>}
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
            {((stepBrL && subPoolL.length > 0) || (stepBrC && subPoolC.length > 0) || (stepBrR && subPoolR.length > 0)) && (
              <div style={{ ...row, marginBottom: 14 }}>
                {stepBrL && subPoolL.length > 0 && <div style={cell}><label style={lbl}>Left backplate{optIsReturn(endOptL) ? ' — for the return' : ''}</label>{plateSelect(stepBrL, subPoolL)}</div>}
                {stepBrC && subPoolC.length > 0 && <div style={cell}><label style={lbl}>Center backplate</label>{plateSelect(stepBrC, subPoolC)}</div>}
                {stepBrR && subPoolR.length > 0 && <div style={cell}><label style={lbl}>Right backplate{optIsReturn(endOptR) ? ' — for the return' : ''}</label>{plateSelect(stepBrR, subPoolR)}</div>}
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
          <div className="card" style={{ flex: '1 1 430px', padding: 20, position: 'sticky', top: 12 }}>
            <span className="eyebrow">Will it fit?</span>
            <div onClick={() => setZoomDia(true)} title="Enlarge the diagram" style={{ margin: '12px 0 2px', border: '1px solid var(--line)', background: '#faf8f3', borderRadius: 2, padding: '8px 6px', cursor: 'zoom-in' }}>
              <FitDiagram shape={sel.shape} />
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--ink-soft)', textAlign: 'right', margin: '0 2px 2px', fontFamily: 'var(--mono, monospace)', letterSpacing: '.06em' }}>⊕ CLICK TO ENLARGE</div>
            <div style={{ margin: '8px 0 4px', fontSize: '0.82rem', color: 'var(--ink-soft)' }}>Total System O2O (+ brackets) — <b>the outside-edge size your opening must accommodate</b></div>
            <div style={{ fontSize: '1.9rem', fontWeight: 600, color: 'var(--ink)' }}>{measReady ? both(fit.totalSystemO2O) : '—'}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', margin: '2px 0 14px' }}>
              {measReady
                ? <>= {both(fit.poleO2O)} pole + {toFrac(fit.endAddL)} left + {toFrac(fit.endAddR)} right</>
                : 'Enter your measurements on the left and the numbers appear here.'}
            </div>
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Pole O2O (edge-to-edge)</span><b>{measReady ? both(fit.poleO2O) : '—'}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Left wall C2C</span><b>{measReady ? both(fit.pole1) : '—'}</b></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>{sel.shape === 'STRAIGHT' ? 'Main wall C2C' : 'Center wall C2C'}</span><b>{measReady ? both(fit.pole2) : '—'}</b></div>
              {sel.shape === 'MITERED' && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Right wall C2C</span><b>{measReady ? both(fit.pole3) : '—'}</b></div>}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Rod diameter</span><b>{both(engData.poleDiameter)}</b></div>
              {safeProjOf(engData) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink-soft)' }}>Projection</span><b>{both(safeProjOf(engData))}</b></div>}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: 14, lineHeight: 1.5 }}>
              Returns and inside mounts change these numbers automatically. End allowances use half your bracket width until our team confirms the exact hardware on review.
            </div>
          </div>
        </div>
      )}

      {/* Click-to-enlarge lightbox — the big, readable version of the current shape's diagram */}
      {zoomDia && (
        <div onClick={() => setZoomDia(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.72)', zIndex: 4000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, cursor: 'zoom-out', padding: 20 }}>
          <div style={{ background: '#faf8f3', border: '1px solid var(--line)', borderRadius: 2, padding: '20px 16px', width: 'min(1100px, 96vw)' }}>
            <FitDiagram shape={sel.shape} />
          </div>
          <div style={{ color: '#fff', fontFamily: 'var(--mono, monospace)', fontSize: 11, letterSpacing: '.08em' }}>CLICK ANYWHERE TO CLOSE</div>
        </div>
      )}
    </div>
  );
}
