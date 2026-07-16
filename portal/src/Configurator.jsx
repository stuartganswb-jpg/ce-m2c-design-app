// Client-facing configurator — runs one assigned CPQ flow with the same render engine and the same
// step→geometry logic as the internal HQ CPQ tab (ported in cpqRender + the builders below). The
// customer steps through the flow; the 3D model updates live. Pricing shows the starting price and
// is confirmed by the team on quote request (exact configured pricing is a later iteration).
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Bounds } from '@react-three/drei';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { DynamicModel, StudioRig, buildPbrRegistry } from './cpqRender.jsx';
import { sizeSelectionsOf, isReturnOption, returnsAllowedFor } from './shared/sizeMatrix';

const SIZE_TYPE = 'SIZE_SELECT';
const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Finish lookup by id across the palette (in-house + outsourced).
const findFinish = (finishes, id) => finishes.find((f) => f.id === id) || null;

// A one-line human summary of a step's current selection, for the review list.
const summaryLabel = (step, params, finishes) => {
  const optLabel = (opts, id) => (opts || []).find((o) => (o.optId || o.partId) === id)?.label
    || (opts || []).find((o) => (o.optId || o.partId) === id)?.partName || '';
  if (step.type === SIZE_TYPE) return optLabel(step.styleOptions, params[step.id]);
  const isCompound = !!step.finishDataSource;
  const isSimpleFinish = !isCompound && step.targetNodes && (!step.styleOptions || step.styleOptions.length === 0);
  if (isSimpleFinish) return findFinish(finishes, params[step.id])?.name || '';
  const parts = [];
  if (step.styleOptions && step.styleOptions.length) { const l = optLabel(step.styleOptions, params[step.id]); if (l) parts.push(l); }
  if (step.subOptions && step.subOptions.length) { const l = optLabel(step.subOptions, params[`${step.id}__sub`]); if (l) parts.push(l); }
  if (isCompound) { const f = findFinish(finishes, params[`${step.id}__finish`]); if (f) parts.push(f.name); }
  return parts.join(' · ');
};

// ---- Override builders (ported from CPQTab.js textureOverrides / visibilityOverrides memos) ----
function buildTextureOverrides(steps, params, finishes) {
  const overrides = {};
  for (const step of steps) {
    // Path A — simple finish step: params[step.id] is a finish id, applied to step.targetNodes.
    const sel = params[step.id];
    if (sel && step.targetNodes && !step.finishDataSource) {
      const f = findFinish(finishes, sel);
      if (f && f.textureUrl) overrides[step.targetNodes] = f.textureUrl;
    }
    // Path B — compound style+finish step.
    if (step.finishDataSource) {
      const finishId = params[`${step.id}__finish`];
      const f = finishId && findFinish(finishes, finishId);
      if (f && f.textureUrl) {
        const selMain = params[step.id];
        const selSub = params[`${step.id}__sub`];
        const mainNode = (step.geometryMap && step.geometryMap[selMain])
          || (step.styleOptions || []).find((o) => (o.optId || o.partId) === selMain)?.targetNode
          || step.finishTargetNodes;
        const subNode = (step.subGeometryMap && selSub) ? step.subGeometryMap[selSub] : '';
        [mainNode, subNode].filter(Boolean).forEach((node) => { overrides[node] = f.textureUrl; });
      }
    }
  }
  return overrides;
}

function buildVisibilityOverrides(steps, params, assembly, hiddenClusters, hiddenNodes) {
  const overrides = {};
  const merge = (n, allowed) => { overrides[n] = (n in overrides) ? (overrides[n] && allowed) : allowed; };
  const clusters = (assembly && assembly.nodeClusters) || [];

  for (const step of steps) {
    // Mount selector: the chosen location gates which cluster's nodes show.
    if (step.mountSelector) {
      const selectedLoc = params[step.id];
      clusters.forEach((cl) => {
        const inScope = !step.mountPosition || String(cl.position || '') === String(step.mountPosition);
        if (!inScope) return;
        const allowed = String(cl.location || '') === String(selectedLoc || '');
        (cl.nodes || []).forEach((n) => merge(String(n).toLowerCase(), allowed));
      });
    }
    // geometryMap / subGeometryMap: nodes controlled by an option only show when it's selected.
    const applyMap = (map, sel) => {
      if (!map) return;
      const controlled = new Set();
      const inSelected = new Set();
      Object.entries(map).forEach(([optId, csv]) => {
        String(csv).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean).forEach((n) => {
          controlled.add(n);
          if (optId === sel) inSelected.add(n);
        });
      });
      controlled.forEach((n) => merge(n, inSelected.has(n)));
    };
    applyMap(step.geometryMap, params[step.id]);
    applyMap(step.subGeometryMap, params[`${step.id}__sub`]);
  }

  // Flow-level force-hide always wins.
  (hiddenClusters || []).forEach((cid) => {
    const cl = clusters.find((c) => c.id === cid);
    (cl ? (cl.nodes || []) : []).forEach((n) => { overrides[String(n).toLowerCase()] = false; });
  });
  (hiddenNodes || []).forEach((n) => { overrides[String(n).toLowerCase()] = false; });
  return overrides;
}

function buildCloneSpecs(steps, params, quantities) {
  const specs = [];
  for (const step of steps) {
    if (!step.isCenterClone) continue;
    const selId = params[step.id];
    const selSub = params[`${step.id}__sub`];
    const main = (step.geometryMap && step.geometryMap[selId]) || '';
    const sub = (step.subGeometryMap && selSub) ? step.subGeometryMap[selSub] : '';
    const meshNames = [main, sub].filter(Boolean).join(',').split(',').map((s) => s.trim()).filter(Boolean);
    if (!meshNames.length) continue;
    let count = parseInt(quantities[step.id]);
    if (!Number.isFinite(count)) count = 1;
    if (step.hideQty && count === 0) count = 1;
    // Rail = a pole/rod style step's geometry, else the model box (handled in the renderer).
    const railStep = steps.find((s) => /pole|rod/i.test(s.title || '') && (s.geometryMap || s.targetNodes));
    const railNames = railStep
      ? String((railStep.geometryMap && railStep.geometryMap[params[railStep.id]]) || railStep.targetNodes || '').split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    specs.push({ stepId: step.id, meshNames, anchorNames: String(main).split(',').map((s) => s.trim()).filter(Boolean), railNames, count });
  }
  return specs;
}

// ---- Return / bracket rules (ported from CPQTab.js:1174-1223) --------------------------------
const RETURN_PICK_RE = /bend|return|miter|mitre|mtr|french/i;

// Is the End Treatment at this position a return (french/miter/inside-mount)?
function isReturnChosenForPos(pos, allSteps, params) {
  if (!pos) return false;
  const p = String(pos).toUpperCase();
  return allSteps.some((s) => {
    if (String(s.position || '').toUpperCase() !== p || !/end treatment/i.test(s.title || '')) return false;
    const sel = params[s.id];
    if (!sel) return false;
    const o = (s.styleOptions || []).find((x) => (x.optId || x.partId) === sel);
    const et = String((o && o.endTreatment) || '').toUpperCase();
    if (et) return et === 'FRENCH_RETURN' || et === 'MITER_RETURN' || et === 'INSIDE_MOUNT';
    if (/^OPT-(BEND|MITER)/i.test(sel)) return true;
    const leaves = String((o && o.targetNode) || '').split(',').map((s2) => { const seg = String(s2).trim().split('__').pop() || ''; return seg.replace(/^\d+_?/, ''); }).join(' ');
    return !!(o && RETURN_PICK_RE.test(`${(o.partName) || ''} ${(o.optId) || ''} ${leaves}`));
  });
}
// A return replaces the outer bracket → grey the bracket's arm dropdown (only the return backplate remains).
function returnLocksBracket(step, allSteps, params) {
  return !!(step && Array.isArray(step.subOptions) && step.subOptions.some((o) => o.returnOnly) && isReturnChosenForPos(step.position, allSteps, params));
}
// Inverse (Flat Iron): a selected end-return arm IS the end treatment → grey that side's End Treatment step.
function isArmChosenForPos(pos, allSteps, params) {
  if (!pos) return false;
  const p = String(pos).toUpperCase();
  return allSteps.some((s) => {
    if (String(s.position || '').toUpperCase() !== p) return false;
    if (!(s.stepRole === 'BRACKET' || /bracket/i.test(s.title || '')) || /end treatment/i.test(s.title || '')) return false;
    const sel = params[s.id];
    const o = sel && (s.styleOptions || []).find((x) => (x.optId || x.partId) === sel);
    return !!(o && o.isReturnArm);
  });
}
function armLocksEnd(step, allSteps, params) {
  return !!(step && /end treatment/i.test(step.title || '') && isArmChosenForPos(step.position, allSteps, params));
}
// Basic brackets take no backplate.
function basicNoBackplate(step, params) {
  const sel = params[step && step.id];
  const o = sel && (step.styleOptions || []).find((x) => (x.optId || x.partId) === sel);
  return !!(o && (o.isBasic || /basic/i.test(o.partName || '')));
}
// The three backplate pools (return / inline / regular) occupy the same spot — show one at a time,
// scoped to the selected bracket's location. (Size-native plate gating is deferred — no parts here.)
function scopedBackplates(step, allSteps, params) {
  const selMain = (step.styleOptions || []).find((o) => (o.optId || o.partId) === params[step.id]);
  const selLoc = selMain && selMain.location;
  let subs = (step.subOptions || []).filter((o) => !selLoc || !o.location || o.location === selLoc);
  if (subs.some((o) => o.returnOnly || o.inlineOnly)) {
    const returnChosen = isReturnChosenForPos(step.position, allSteps, params) || !!(selMain && selMain.isReturnArm);
    const inlineBracket = !!(selMain && selMain.usesReturnPlates);
    const hasInl = subs.some((o) => o.inlineOnly);
    subs = subs.filter((o) => returnChosen ? o.returnOnly
      : inlineBracket ? (hasInl ? o.inlineOnly : o.returnOnly)
      : (!o.returnOnly && !o.inlineOnly));
  }
  return subs;
}

// ---- Step controls -------------------------------------------------------------------------
// Scope the finish list EXACTLY like HQ: a dedicated finish step uses step.allowedOptions (finish
// ids); a compound style step uses the selected option's finishAllowedOptions, else the step's.
// Empty/absent → the flow allows all (matches internal behavior).
const finishOptionsFor = (step, finishes, selOpt) => {
  if (step.finishDataSource) {
    const scoped = (selOpt && Array.isArray(selOpt.finishAllowedOptions) && selOpt.finishAllowedOptions.length)
      ? selOpt.finishAllowedOptions
      : (Array.isArray(step.finishAllowedOptions) ? step.finishAllowedOptions : []);
    return scoped.length ? finishes.filter((f) => scoped.includes(f.id)) : finishes;
  }
  const allow = step.allowedOptions;
  return (Array.isArray(allow) && allow.length) ? finishes.filter((f) => allow.includes(f.id)) : finishes;
};

// Group a finish for the picker tabs. EP / outsourced = plated; wood stains by name; P-series =
// painted; everything else (satin S-codes, clear acrylic AC, aged steel, etc.) = other.
function finishGroup(f) {
  const code = String(f.code || '').toUpperCase();
  const name = String(f.name || '').toUpperCase();
  if (f.outsourced || /^EP\d/.test(code) || code === 'EP') return 'Plated';
  if (/OAK|WALNUT|WOOD|EBONY|BLONDE|NATURAL|WASH|COFFEE|ALMOND|SHROOM|STAIN|DRIFT/.test(name)) return 'Wood';
  if (/^P\d/.test(code) || code === 'CP') return 'Painted';
  return 'Other';
}
const GROUP_ORDER = ['Painted', 'Plated', 'Wood', 'Other'];
const GROUP_LABELS = { Painted: 'Painted (P)', Plated: 'Plated (EP)', Wood: 'Wood', Other: 'Other' };

function FinishPicker({ finishes, value, onChange }) {
  const groups = useMemo(() => {
    const m = {};
    finishes.forEach((f) => { const g = finishGroup(f); (m[g] = m[g] || []).push(f); });
    return m;
  }, [finishes]);
  const present = GROUP_ORDER.filter((g) => (groups[g] || []).length);
  const selectedGroup = value ? finishGroup(findFinish(finishes, value) || {}) : null;
  const [tab, setTab] = useState(selectedGroup && present.includes(selectedGroup) ? selectedGroup : present[0]);
  useEffect(() => { if (selectedGroup && present.includes(selectedGroup)) setTab(selectedGroup); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = groups[tab] || [];

  return (
    <div>
      {present.length > 1 && (
        <div className="finish-tabs">
          {present.map((g) => (
            <button key={g} type="button" className={`finish-tab${tab === g ? ' on' : ''}`} onClick={() => setTab(g)}>
              {GROUP_LABELS[g]} <em>{groups[g].length}</em>
            </button>
          ))}
        </div>
      )}
      <div className="chips">
        {list.map((f) => (
          <button key={f.id} type="button" className={`chip${value === f.id ? ' on' : ''}`} title={f.name} onClick={() => onChange(f.id)}>
            <span className="chip-img" style={{ backgroundImage: `url(${f.textureUrl})` }} />
            <span className="chip-label">{f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function StepControl({ step, params, setParam, quantities, setQty, finishes, sizeSel, allSteps }) {
  const sel = params[step.id];

  // Return-pool gating (matches HQ): french/miter/bent returns drop out when the chosen projection
  // doesn't allow returns. isReturn is stamped by the flow; fall back to the sizeMatrix detector.
  const allowReturns = returnsAllowedFor(sizeSel);
  const optionAllowed = (o) => allowReturns || !(o.isReturn || isReturnOption(o));
  const visStyleOptions = (step.styleOptions || []).filter(optionAllowed);

  // A return on this side replaces the bracket arm (grey it out); or a return-arm bracket replaces
  // the end treatment. When locked, only the (scoped) backplate below remains.
  const armLocked = returnLocksBracket(step, allSteps, params) || armLocksEnd(step, allSteps, params);

  if (step.type === SIZE_TYPE) {
    return (
      <div className="opt-cards">
        {visStyleOptions.map((o) => (
          <button key={o.optId} type="button" className={`opt-card${sel === o.optId ? ' active' : ''}`} onClick={() => setParam(step.id, o.optId)}>
            {o.label || o.partName}
          </button>
        ))}
      </div>
    );
  }

  const isCompound = !!step.finishDataSource;
  const isSimpleFinish = !isCompound && step.targetNodes && (!step.styleOptions || step.styleOptions.length === 0);

  if (isSimpleFinish) {
    return <FinishPicker finishes={finishOptionsFor(step, finishes, null)} value={sel} onChange={(v) => setParam(step.id, v)} />;
  }

  return (
    <>
      {(visStyleOptions.length > 0) && (
        <select className={`opt-select${armLocked ? ' locked' : ''}`} disabled={armLocked} value={armLocked ? '' : (sel || '')} onChange={(e) => { setParam(step.id, e.target.value); setParam(`${step.id}__finish`, ''); }}>
          <option value="">{returnLocksBracket(step, allSteps, params) ? 'Return selected — bracket replaced (choose the return backplate below)' : armLocksEnd(step, allSteps, params) ? 'End return arm selected — it is this end' : 'Select…'}</option>
          {visStyleOptions.map((o) => <option key={o.optId} value={o.optId}>{o.label || o.partName}</option>)}
        </select>
      )}
      {(step.subOptions && step.subOptions.length > 0) && (() => {
        const noPlate = basicNoBackplate(step, params);
        const subs = scopedBackplates(step, allSteps, params);
        return (
          <div style={{ marginTop: 8 }}>
            <label className="cfg-sublabel">Backplate</label>
            <select className={`opt-select${noPlate ? ' locked' : ''}`} disabled={noPlate} value={noPlate ? '' : (params[`${step.id}__sub`] || '')} onChange={(e) => setParam(`${step.id}__sub`, e.target.value)}>
              <option value="">{noPlate ? 'None (basic bracket — no backplate)' : 'None'}</option>
              {subs.map((o) => <option key={o.optId} value={o.optId}>{o.label || o.partName}</option>)}
            </select>
          </div>
        );
      })()}
      {isCompound && (
        <div style={{ marginTop: 10 }}>
          <FinishPicker
            finishes={finishOptionsFor(step, finishes, (step.styleOptions || []).find((o) => (o.optId || o.partId) === sel))}
            value={params[`${step.id}__finish`]}
            onChange={(v) => setParam(`${step.id}__finish`, v)}
          />
        </div>
      )}
      {!step.hideQty && step.type !== SIZE_TYPE && step.isCenterClone && (
        <label className="qty-row">Qty
          <input type="number" min="0" value={quantities[step.id] ?? ''} onChange={(e) => setQty(step.id, e.target.value)} />
        </label>
      )}
    </>
  );
}

export default function Configurator({ flowId, flowName, onExit }) {
  const [data, setData] = useState(null); // { flow, assembly, finishes }
  const [err, setErr] = useState(null);
  const [params, setParams] = useState({});
  const [quantities, setQuantities] = useState({});
  const [stepIdx, setStepIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null); setParams({}); setQuantities({}); setStepIdx(0); setSubmitted(false);
    httpsCallable(functions, 'portalFlow')({ flowId })
      .then((res) => { if (alive) setData(res.data); })
      .catch((e) => { if (alive) setErr(/permission/i.test(e.message || '') ? 'This product is not enabled on your account.' : 'Could not load this product right now — please try again shortly.'); });
    return () => { alive = false; };
  }, [flowId]);

  const [price, setPrice] = useState(null); // { level, total, lines }
  const [pricing, setPricing] = useState(false);

  const setParam = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const setQty = (k, v) => setQuantities((q) => ({ ...q, [k]: v }));

  // Live configured pricing from the server engine (debounced), at the customer's assigned level.
  useEffect(() => {
    if (!data) return;
    setPricing(true);
    const t = setTimeout(() => {
      httpsCallable(functions, 'portalResolve')({ flowId, selections: { params, quantities } })
        .then((res) => setPrice(res.data.price))
        .catch(() => {})
        .finally(() => setPricing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [flowId, params, quantities, data]);

  const allSteps = data?.flow?.steps || [];
  const finishes = data?.finishes || [];
  const assembly = data?.assembly || null;
  const pbrRegistry = useMemo(() => buildPbrRegistry(finishes), [finishes]);

  // Rule-driven step disabling (ported from CPQTab engineFlags): a selected option flagged
  // hidesBracket disables BRACKET-role steps at the same position; disabled steps drop out of the
  // wizard, render, and summary — matching the internal tool.
  const disabledStepIds = useMemo(() => {
    const dis = new Set();
    allSteps.forEach((step) => {
      const opt = (step.styleOptions || []).find((o) => (o.optId || o.partId) === params[step.id]);
      if (!opt || !opt.hidesBracket) return;
      const pos = String(step.position || '').toUpperCase();
      allSteps.forEach((bs) => {
        if (bs.stepRole !== 'BRACKET') return;
        if (pos && String(bs.position || '').toUpperCase() !== pos) return;
        dis.add(bs.id);
      });
    });
    return dis;
  }, [allSteps, params]);
  const steps = useMemo(() => allSteps.filter((s) => !disabledStepIds.has(s.id)), [allSteps, disabledStepIds]);

  const textureOverrides = useMemo(() => buildTextureOverrides(steps, params, finishes), [steps, params, finishes]);
  const visibilityOverrides = useMemo(() => buildVisibilityOverrides(steps, params, assembly, data?.flow?.hiddenClusters, data?.flow?.hiddenNodes), [steps, params, assembly, data]);
  const cloneSpecs = useMemo(() => buildCloneSpecs(steps, params, quantities), [steps, params, quantities]);
  const sizeSel = useMemo(() => {
    try { return sizeSelectionsOf(data?.flow, params); } catch (e) { return null; }
  }, [data, params]);
  const sizeScale = sizeSel?.scale || 1;

  const safeIdx = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const onReview = steps.length > 0 && stepIdx >= steps.length;

  const submit = async () => {
    setSubmitting(true);
    try {
      await httpsCallable(functions, 'portalQuoteRequest')({ flowId, flowName: data?.flow?.name || flowName, selections: { params, quantities }, note });
      setSubmitted(true);
    } catch (e) {
      alert('Could not send your request: ' + (e.message || e));
    } finally { setSubmitting(false); }
  };

  if (err) return <div className="cfg"><button className="btn-ghost" onClick={onExit}>← Back</button><div className="empty" style={{ marginTop: 20 }}>{err}</div></div>;
  if (!data) return <div className="cfg"><button className="btn-ghost" onClick={onExit}>← Back</button><div className="empty" style={{ marginTop: 20 }}>Loading configurator…</div></div>;

  const cadUrl = assembly?.cadUrl;
  const start = assembly?.startingPrice;

  return (
    <div className="cfg">
      <div className="cfg-top">
        <button className="btn-ghost" onClick={onExit}>← All products</button>
        <h2 className="sec" style={{ margin: 0 }}>{data.flow.name}</h2>
        {price ? (
          <span className={`cfg-price${pricing ? ' stale' : ''}`}>{fmtMoney(price.total)}</span>
        ) : (start !== null && start !== undefined ? <span className="cfg-price">Starting at {fmtMoney(start)}</span> : <span />)}
      </div>

      <div className="cfg-body">
        <div className="cfg-stage">
          {cadUrl ? (
            <div className="viewer">
              <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]}>
                <Suspense fallback={null}>
                  <StudioRig />
                  <Bounds fit clip margin={1.2}>
                    <group scale={sizeScale}>
                      <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibilityOverrides} cloneSpecs={cloneSpecs} pbrRegistry={pbrRegistry} />
                    </group>
                  </Bounds>
                </Suspense>
                <OrbitControls makeDefault />
              </Canvas>
              <span className="viewer-hint">Drag to rotate · scroll to zoom</span>
            </div>
          ) : (
            <div className="empty">This product doesn't have a 3D model yet.</div>
          )}
        </div>

        <div className="cfg-panel">
          {steps.length === 0 && <div className="empty">This product has no options to configure.</div>}

          {steps.length > 0 && !onReview && (() => {
            const step = steps[safeIdx];
            return (
              <div className="cfg-wizard">
                <div className="cfg-progress">
                  <span>Step {safeIdx + 1} of {steps.length}</span>
                  <div className="cfg-dots">
                    {steps.map((s, i) => <span key={s.id} className={`dot${i === safeIdx ? ' on' : ''}${i < safeIdx ? ' done' : ''}`} onClick={() => setStepIdx(i)} title={s.title} />)}
                  </div>
                </div>
                <div className="cfg-step-title lg">{step.title}</div>
                <div className="cfg-step-body">
                  <StepControl step={step} params={params} setParam={setParam} quantities={quantities} setQty={setQty} finishes={finishes} sizeSel={sizeSel} allSteps={allSteps} />
                </div>
                <div className="cfg-nav">
                  <button className="btn-ghost" disabled={safeIdx === 0} onClick={() => setStepIdx(safeIdx - 1)}>← Back</button>
                  {safeIdx < steps.length - 1
                    ? <button className="btn" onClick={() => setStepIdx(safeIdx + 1)}>Next →</button>
                    : <button className="btn" onClick={() => setStepIdx(steps.length)}>Review →</button>}
                </div>
              </div>
            );
          })()}

          {steps.length > 0 && onReview && (
            <div className="cfg-review">
              <div className="cfg-progress"><span>Review &amp; request</span></div>
              <ul className="cfg-summary">
                {steps.map((s) => (
                  <li key={s.id}>
                    <button className="sum-edit" onClick={() => setStepIdx(steps.indexOf(s))}>{s.title}</button>
                    <span>{summaryLabel(s, params, finishes) || '—'}</span>
                  </li>
                ))}
              </ul>
              {price && price.lines && price.lines.length > 0 && (
                <div className="cfg-pricetable">
                  {price.lines.filter((l) => (l.total || 0) !== 0).map((l, i) => (
                    <div className="pl-row" key={i}><span>{l.name}{l.qty > 1 ? ` ×${l.qty}` : ''}</span><span className="pl-amt">{fmtMoney(l.total)}</span></div>
                  ))}
                  <div className="pl-row pl-total"><span>Total{pricing ? ' …' : ''}</span><span className="pl-amt">{fmtMoney(price.total)}</span></div>
                </div>
              )}
              {submitted ? (
                <div className="msg ok" style={{ textAlign: 'left' }}>✓ Request sent. Your Classical Elements team will confirm pricing and follow up. You can see it under Orders &amp; Quotes.</div>
              ) : (
                <div className="cfg-submit">
                  <textarea className="cfg-note" placeholder="Notes for your rep (quantity, project, timing…)" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="cfg-nav">
                    <button className="btn-ghost" onClick={() => setStepIdx(steps.length - 1)}>← Back</button>
                    <button className="btn" disabled={submitting} onClick={submit}>{submitting ? 'Sending…' : 'Request a quote'}</button>
                  </div>
                  <div className="cfg-fineprint">Final pricing is confirmed by your rep. Nothing is ordered automatically.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
