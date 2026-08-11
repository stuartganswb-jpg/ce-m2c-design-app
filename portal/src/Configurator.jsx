// Client-facing configurator — runs one assigned CPQ flow with the same render engine and the same
// step→geometry logic as the internal HQ CPQ tab (ported in cpqRender + the builders below). The
// customer steps through the flow; the 3D model updates live. Pricing shows the starting price and
// is confirmed by the team on quote request (exact configured pricing is a later iteration).
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { DynamicModel, StudioRig, buildPbrRegistry } from './cpqRender.jsx';
import { sizeSelectionsOf, isReturnOption, returnsAllowedFor, projAllowedAtDia, renderScaleOf } from './shared/sizeMatrix';
import { splitNodes, splitNodesLower, exactNode } from './shared/nodeList';

const SIZE_TYPE = 'SIZE_SELECT';
const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// The customer's own price ladder (Fabricut-leveled accounts): their cost / wholesale / retail.
const LEVEL_LABELS = { FAB_COST: 'Your cost', FAB_WHOLESALE: 'Wholesale', FAB_RETAIL: 'Retail' };

// Finish lookup by id across the palette (in-house + outsourced).
const findFinish = (finishes, id) => finishes.find((f) => f.id === id) || null;

// A one-line human summary of a step's current selection, for the review list. Uses the server-
// resolved name (item # for parts, description for fees) so fees read "Miter Return", not the fee id.
const summaryLabel = (step, params, finishes, info) => {
  const optLabel = (opts, id) => {
    const rec = info && info.options && info.options[id];
    if (rec && rec.name) return rec.name;
    const o = (opts || []).find((x) => (x.optId || x.partId) === id);
    return (o && (o.label || o.partName)) || '';
  };
  const finName = (id) => { const f = findFinish(finishes, id); return f ? (f.clientName || f.name) : ''; };
  if (step.type === SIZE_TYPE) return optLabel(step.styleOptions, params[step.id]);
  const isCompound = !!step.finishDataSource;
  const isSimpleFinish = !isCompound && step.targetNodes && (!step.styleOptions || step.styleOptions.length === 0);
  if (isSimpleFinish) return finName(params[step.id]);
  const parts = [];
  if (step.styleOptions && step.styleOptions.length) { const l = optLabel(step.styleOptions, params[step.id]); if (l) parts.push(l); }
  if (step.subOptions && step.subOptions.length) { const l = optLabel(step.subOptions, params[`${step.id}__sub`]); if (l) parts.push(l); }
  if (isCompound) { const n = finName(params[`${step.id}__finish`]); if (n) parts.push(n); }
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
  // 🧊 Acrylic tops take the AC (clear acrylic) master-finish chip — appended LAST so it wins the
  // renderer's last-match-wins loop over the step's metal finish (ported from CPQTab; Phase B's
  // top-scoped finish selector will exempt steps that carry one).
  const acChip = (finishes || []).find((f) => String(f.code || '').toUpperCase() === 'AC')
    || (finishes || []).find((f) => /clear\s*acrylic|^acrylic\b/i.test(String(f.name || '')));
  if (acChip && acChip.textureUrl) {
    for (const step of steps) {
      const t = String(step.title || '');
      if (/ACRYLIC/i.test(t) && !/COLLAR/i.test(t) && step.targetNodes) overrides[step.targetNodes] = acChip.textureUrl;
      for (const o of (step.styleOptions || [])) {
        const txt = `${o.partName || ''} ${o.partId || ''}`;
        const looksAcrylic = !!o.acrylicTopNodes || /ACRYLIC/i.test(txt);
        if (!looksAcrylic || /COLLAR|(^|[^A-Z])AFC([^A-Z]|$)/i.test(txt)) continue;
        const nodes = o.acrylicTopNodes || o.targetNode || (step.geometryMap || {})[o.optId] || '';
        if (nodes) overrides[nodes] = acChip.textureUrl;
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
        (cl.nodes || []).forEach((n) => merge(exactNode(String(n).toLowerCase()), allowed));
      });
    }
    // geometryMap / subGeometryMap: nodes controlled by an option only show when it's selected.
    const applyMap = (map, sel) => {
      if (!map) return;
      const controlled = new Set();
      const inSelected = new Set();
      Object.entries(map).forEach(([optId, csv]) => {
        splitNodesLower(csv).forEach((n) => {
          controlled.add(n);
          if (optId === sel) inSelected.add(n);
        });
      });
      controlled.forEach((n) => merge(exactNode(n), inSelected.has(n)));
    };
    applyMap(step.geometryMap, params[step.id]);
    applyMap(step.subGeometryMap, params[`${step.id}__sub`]);
  }

  // Flow-level force-hide always wins.
  (hiddenClusters || []).forEach((cid) => {
    const cl = clusters.find((c) => c.id === cid);
    (cl ? (cl.nodes || []) : []).forEach((n) => { overrides[exactNode(String(n).toLowerCase())] = false; });
  });
  (hiddenNodes || []).forEach((n) => { overrides[exactNode(String(n).toLowerCase())] = false; });
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
    const meshNames = [main, sub].flatMap(splitNodes);
    if (!meshNames.length) continue;
    let count = parseInt(quantities[step.id]);
    if (!Number.isFinite(count)) count = 1;
    if (step.hideQty && count === 0) count = 1;
    // Rail = a pole/rod style step's geometry, else the model box (handled in the renderer).
    const railStep = steps.find((s) => /pole|rod/i.test(s.title || '') && (s.geometryMap || s.targetNodes));
    const railNames = railStep
      ? splitNodes((railStep.geometryMap && railStep.geometryMap[params[railStep.id]]) || railStep.targetNodes || '')
      : [];
    specs.push({ stepId: step.id, meshNames, anchorNames: splitNodes(main), railNames, count });
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
    const leaves = splitNodes((o && o.targetNode) || '').map((s2) => { const seg = String(s2).trim().split('__').pop() || ''; return seg.replace(/^\d+_?/, ''); }).join(' ');
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
function scopedBackplates(step, allSteps, params, info) {
  // Merge the server-resolved pool flags (returnOnly derived from the plate's real RBP/RCP code +
  // location) onto the flow subOptions, so scoping works even when the flow didn't stamp them.
  const meta = (info && info.subOptions) || {};
  const merged = (step.subOptions || []).map((o) => { const m = meta[o.optId || o.partId] || {}; return { ...o, returnOnly: o.returnOnly || m.returnOnly, inlineOnly: o.inlineOnly || m.inlineOnly, location: o.location || m.location }; });
  const selMain = (step.styleOptions || []).find((o) => (o.optId || o.partId) === params[step.id]);
  const selLoc = selMain && selMain.location;
  let subs = merged.filter((o) => !selLoc || !o.location || o.location === selLoc);
  if (subs.some((o) => o.returnOnly || o.inlineOnly)) {
    const returnChosen = isReturnChosenForPos(step.position, allSteps, params) || !!(selMain && selMain.isReturnArm);
    const inlineBracket = !!(selMain && selMain.usesReturnPlates);
    const hasInl = subs.some((o) => o.inlineOnly);
    const retPoolLive = subs.some((o) => o.returnOnly); // returns fall back to standard plates when none survive
    subs = subs.filter((o) => returnChosen ? (retPoolLive ? o.returnOnly : (!o.returnOnly && !o.inlineOnly))
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
          <button key={f.id} type="button" className={`chip${value === f.id ? ' on' : ''}`} title={f.clientName || f.name} onClick={() => onChange(f.id)}>
            <span className="chip-img" style={{ backgroundImage: `url(${f.textureUrl})` }} />
            <span className="chip-label">{f.clientName || f.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Match HQ's option label: "<item # / Fabricut code> — <description>", then the per-option price.
const optLabelText = (info, o, kind) => {
  const rec = info && info[kind] && info[kind][o.optId || o.partId];
  const code = rec && rec.name;   // resolved item # (Fabricut code at wholesale/retail)
  const desc = rec && rec.desc;   // description
  const label = [code, desc].filter(Boolean).join(' — ') || o.label || o.partName || (o.optId || o.partId);
  const price = rec && rec.price;
  return `${label}${(price !== undefined && price !== null && price > 0) ? `  ·  ${fmtMoney(price)}` : ''}`;
};

function StepControl({ step, params, setParam, quantities, setQty, finishes, sizeSel, allSteps, info, projTagOk, dims, onDim }) {
  const sel = params[step.id];

  // Return-pool gating (matches HQ): french/miter/bent returns drop out when the chosen projection
  // doesn't allow returns. isReturn is stamped by the flow; fall back to the sizeMatrix detector.
  // Per-assembly flows (H2 pivot) add the projection-TAG gate (projTagOk, mirrored from
  // VisionHardware/CPQTab): brackets match their tag exactly, returns treat it as a minimum.
  const allowReturns = returnsAllowedFor(sizeSel);
  const optionAllowed = (o) => (allowReturns || !(o.isReturn || isReturnOption(o))) && (!projTagOk || projTagOk(o));
  const visStyleOptions = (step.styleOptions || []).filter(optionAllowed);

  // A return on this side replaces the bracket arm (grey it out); or a return-arm bracket replaces
  // the end treatment. When locked, only the (scoped) backplate below remains.
  const armLocked = returnLocksBracket(step, allSteps, params) || armLocksEnd(step, allSteps, params);

  // Quantity input on every non-size step that isn't hideQty (matches HQ) — rods, rings, etc. need
  // a count alongside their finish. Empty = the BOM default (1) is used by the pricing engine.
  const showQty = !step.hideQty && step.type !== SIZE_TYPE;
  const qtyEl = showQty ? (
    <label className="qty-row">Quantity
      <input type="number" min="1" step="1" placeholder="1" value={quantities[step.id] ?? ''} onChange={(e) => setQty(step.id, e.target.value)} />
    </label>
  ) : null;

  // DIMENSIONAL INPUT (matches HQ): on calculator steps the customer types the finished size in
  // inches and the purchase quantity (feet) computes itself — 100.25" → 9 ft. A calc-typed step
  // with no template (older BFF payloads) falls back to the straight-pole math (ceil(len / 12))
  // so the qty always computes instead of sticking at 1.
  const template = step.calculatorTemplate || ((step.type === 'DIMENSIONS' || step.type === 'VISUAL_DIMENSIONS') ? 'calc_straight_pole' : '');
  const isCalc = !!template || step.type === 'DIMENSIONS' || step.type === 'VISUAL_DIMENSIONS';
  const dm = (dims && dims[step.id]) || { length: '', type: 'O2O', wallA: '', wallB: '', wallC: '' };
  const dimLbl = { flex: 1, fontSize: '0.75rem', color: 'var(--ink-soft)' };
  const dimInp = { width: '100%', boxSizing: 'border-box', padding: 8, border: '1px solid var(--line)', marginTop: 4, background: '#fff' };
  const dimEl = (isCalc && onDim) ? (
    <div style={{ margin: '10px 0 4px', padding: 12, border: '1px solid var(--line)', background: '#faf8f3', borderRadius: 2 }}>
      <div style={{ fontFamily: 'var(--mono, monospace)', fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 8 }}>
        Dimensional input — type the finished size, the feet compute themselves
      </div>
      {template === 'calc_mitered_bay' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {[['wallA', 'Wall A (left)'], ['wallB', 'Wall B (center)'], ['wallC', 'Wall C (right)']].map(([k, label]) => (
            <label key={k} style={dimLbl}>{label}
              <input type="number" min="0" step="0.01" placeholder="in" value={dm[k] || ''} onChange={(e) => onDim(step.id, k, e.target.value, template)} style={dimInp} />
            </label>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8 }}>
          {(template === 'calc_french_return_1in' || template === 'calc_curved_bay') && (
            <label style={dimLbl}>Measurement
              <select value={dm.type || 'O2O'} onChange={(e) => onDim(step.id, 'type', e.target.value, template)} style={dimInp}>
                <option value="O2O">Outside to outside (O2O)</option>
                <option value="C2C">Center to center (C2C)</option>
              </select>
            </label>
          )}
          <label style={dimLbl}>Finished length (in)
            <input type="number" min="0" step="0.01" placeholder="e.g. 100.25" value={dm.length || ''} onChange={(e) => onDim(step.id, 'length', e.target.value, template)} style={dimInp} />
          </label>
        </div>
      )}
    </div>
  ) : null;

  if (step.type === SIZE_TYPE || step.type === 'PROJ_SELECT') {
    // SIZE steps: diameter-dependent projections (sizeMatrix `dias`, matches HQ); stale invalid
    // picks self-heal in sizeSelectionsOf. PROJ_SELECT (per-assembly flows): the generated
    // Bracket Projection question renders as the same cards — the pick drives projTagOk.
    const sizeOpts = step.type === 'PROJ_SELECT'
      ? visStyleOptions
      : visStyleOptions.filter((o) => step.sizeAxis !== 'PROJ' || projAllowedAtDia(step.sizeFamily, o, sizeSel?.dia));
    return (
      <div className="opt-cards">
        {sizeOpts.map((o) => (
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
    return <>
      <FinishPicker finishes={finishOptionsFor(step, finishes, null)} value={sel} onChange={(v) => setParam(step.id, v)} />
      {dimEl}
      {qtyEl}
    </>;
  }

  return (
    <>
      {(visStyleOptions.length > 0) && (
        <select className={`opt-select${armLocked ? ' locked' : ''}`} disabled={armLocked} value={armLocked ? '' : (sel || '')} onChange={(e) => { setParam(step.id, e.target.value); setParam(`${step.id}__finish`, ''); }}>
          <option value="">{returnLocksBracket(step, allSteps, params) ? 'Return selected — bracket replaced (choose the return backplate below)' : armLocksEnd(step, allSteps, params) ? 'End return arm selected — it is this end' : 'Select…'}</option>
          {visStyleOptions.map((o) => <option key={o.optId} value={o.optId}>{optLabelText(info, o, 'options')}</option>)}
        </select>
      )}
      {(step.subOptions && step.subOptions.length > 0) && (() => {
        const noPlate = basicNoBackplate(step, params);
        const subs = scopedBackplates(step, allSteps, params, info).filter((o) => !projTagOk || projTagOk(o));
        return (
          <div style={{ marginTop: 8 }}>
            <label className="cfg-sublabel">Backplate</label>
            <select className={`opt-select${noPlate ? ' locked' : ''}`} disabled={noPlate} value={noPlate ? '' : (params[`${step.id}__sub`] || '')} onChange={(e) => setParam(`${step.id}__sub`, e.target.value)}>
              <option value="">{noPlate ? 'None (basic bracket — no backplate)' : 'None'}</option>
              {subs.map((o) => <option key={o.optId} value={o.optId}>{optLabelText(info, o, 'subOptions')}</option>)}
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
      {dimEl}
      {qtyEl}
    </>
  );
}

// A copy-paste block of item # + qty for the customer to enter into their own ERP. Only lines that
// carry an item # appear (fees are excluded). Order will be tuned later to match their entry order.
function ErpCopyBox({ lines }) {
  const [copied, setCopied] = useState(false);
  const rows = (lines || []).filter((l) => l.itemNo && l.qty);
  if (!rows.length) return null;
  const text = rows.map((r) => `${r.itemNo}\t${r.qty}`).join('\n');
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { window.prompt('Copy the item list:', text); }
  };
  return (
    <div className="erp-box">
      <div className="erp-head">
        <span>For your system — item # &amp; qty</span>
        <button className="btn-ghost" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <table className="erp-table"><tbody>
        {rows.map((r, i) => (
          <tr key={i}><td className="erp-no">{r.itemNo}</td><td className="erp-qty">{r.qty}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

// onAddLine(line, goCheckout) — the parent (Showroom) owns the order cart and the checkout
// screen; the configurator just hands finished lines up. `line` carries everything checkout
// and the quote request need: selections, the room tag, the viewed price snapshot, and the
// presentation-matching metadata (computed HERE, where steps/params/finishes are at hand).
export default function Configurator({ flowId, flowName, onExit, onAddLine }) {
  const [data, setData] = useState(null); // { flow, assembly, finishes }
  const [err, setErr] = useState(null);
  const [params, setParams] = useState({});
  const [quantities, setQuantities] = useState({});
  const [stepIdx, setStepIdx] = useState(0);
  // PER-LINE TAG (Stuart 2026-08-10, mirrors HQ CPQ): "Living Room", "Primary Bedroom" — names
  // THIS configuration on every document. The ORDER sidemark ("Smith Residence") lives on the
  // checkout screen, since it tags the whole order.
  const [lineTag, setLineTag] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null); setParams({}); setQuantities({}); setDims({}); setStepIdx(0); setLineTag('');
    httpsCallable(functions, 'portalFlow')({ flowId })
      .then((res) => {
        if (!alive) return;
        setData(res.data);
        // Splice / cut-splice steps are opt-in extras — default their quantity to 0.
        const seed = {};
        (res.data.flow?.steps || []).forEach((s) => { if (!s.hideQty && s.type !== SIZE_TYPE && /splice/i.test(s.title || '')) seed[s.id] = '0'; });
        if (Object.keys(seed).length) setQuantities(seed);
      })
      .catch((e) => { if (alive) setErr(/permission/i.test(e.message || '') ? 'This product is not enabled on your account.' : 'Could not load this product right now — please try again shortly.'); });
    return () => { alive = false; };
  }, [flowId]);

  const [price, setPrice] = useState(null); // { level, total, lines }
  const [stepOptions, setStepOptions] = useState({}); // { [stepId]: { options, subOptions } }
  const [pricing, setPricing] = useState(false);
  // Price-ladder view toggle (Stuart 2026-07-27): a Fabricut-leveled customer flips the quote
  // view between THEIR three levels — cost / wholesale / retail. '' = the assigned default.
  // The server validates the override (only FAB_ levels, only for FAB_-assigned customers).
  const [viewLevel, setViewLevel] = useState('');

  const setParam = (k, v) => setParams((p) => ({ ...p, [k]: v }));
  const setQty = (k, v) => setQuantities((q) => ({ ...q, [k]: v }));

  // DIMENSIONAL INPUT (Stuart 2026-07-26: "we need to be able to enter in 100.25 there, which
  // would enter in 9ft in the qty field") — mirrors CPQTab's handleDimensionChange EXACTLY,
  // template for template: straight = ceil(len/12); 1" french return = O2O/C2C, cut = O2O+17;
  // mitered = walls+12; curved = len+12. The raw dims ride the quote request as `__dims` params
  // so the team sees the entered size, and the computed FEET land in the step quantity.
  const [dims, setDims] = useState({});
  const handleDimensionChange = (stepId, key, value, template) => {
    setDims((prev) => {
      const current = prev[stepId] || { length: '', type: 'O2O', wallA: '', wallB: '', wallC: '' };
      const updated = { ...current, [key]: value };
      let calculatedQty = 1;
      if (template === 'calc_french_return_1in') {
        const baseLength = parseFloat(updated.length) || 0;
        const o2o = updated.type === 'C2C' ? baseLength + 1 : baseLength;
        calculatedQty = Math.max(1, Math.ceil((o2o + 17) / 12));
      } else if (template === 'calc_straight_pole') {
        const baseLength = parseFloat(updated.length) || 0;
        calculatedQty = Math.max(1, Math.ceil(baseLength / 12));
      } else if (template === 'calc_mitered_bay') {
        const a = parseFloat(updated.wallA) || 0, b = parseFloat(updated.wallB) || 0, c = parseFloat(updated.wallC) || 0;
        calculatedQty = Math.max(1, Math.ceil((a + b + c + 12) / 12));
      } else if (template === 'calc_curved_bay') {
        const baseLength = parseFloat(updated.length) || 0;
        calculatedQty = Math.max(1, Math.ceil((baseLength + 12) / 12));
      }
      if (value !== '') setQuantities((q) => ({ ...q, [stepId]: String(calculatedQty) }));
      return { ...prev, [stepId]: updated };
    });
  };

  // Live configured pricing + resolved option descriptions/prices from the server engine (debounced),
  // at the customer's assigned level.
  useEffect(() => {
    if (!data) return;
    setPricing(true);
    const t = setTimeout(() => {
      httpsCallable(functions, 'portalResolve')({ flowId, selections: { params, quantities }, ...(viewLevel ? { priceLevel: viewLevel } : {}) })
        .then((res) => { setPrice(res.data.price); if (res.data.stepOptions) setStepOptions(res.data.stepOptions); })
        .catch(() => {})
        .finally(() => setPricing(false));
    }, 450);
    return () => clearTimeout(t);
  }, [flowId, params, quantities, data, viewLevel]);

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
  // 🎯 Per-assembly projection context (H2 pivot) — VERBATIM mirror of VisionHardware/CPQTab:
  // the PROJ_SELECT pick (or the flow's stamped implied projection) gates proj-tagged options.
  // A bracket's proj: tag is the exact projection the physical item IS; a return-type option's
  // tag is a MINIMUM depth. Fabricut/legacy flows carry neither the step nor the stamp →
  // flowProjSel null → every option passes untouched.
  const flowProjSel = useMemo(() => {
    const st = allSteps.find((s) => s.type === 'PROJ_SELECT');
    if (!st) {
      const imp = parseFloat(String(data?.flow?.impliedProjInches ?? ''));
      return Number.isFinite(imp) ? imp : null;
    }
    const o = (st.styleOptions || []).find((x) => x.optId === params[st.id]);
    const f = parseFloat(String(o?.projInches ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(f) ? f : null;
  }, [allSteps, data, params]);
  const projTagOk = (o) => {
    if (flowProjSel == null || !o?.projInches) return true;
    const f = parseFloat(String(o.projInches).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(f)) return true;
    const et = String(o.endTreatment || '').toUpperCase();
    const returnish = et === 'FRENCH_RETURN' || et === 'MITER_RETURN'
      || (o.isFee && /return|miter|mitre|french|bend/i.test(String(o.partName || '')));
    return returnish ? (flowProjSel >= f - 0.01) : (Math.abs(f - flowProjSel) < 0.01);
  };
  // Stale-pick sweep: flipping the projection clears any selection whose tag no longer fits
  // (main picks AND backplate sub-picks) — the config can never carry an impossible combination.
  useEffect(() => {
    setParams((prev) => {
      let changed = false; const next = { ...prev };
      allSteps.forEach((st) => {
        const o = (st.styleOptions || []).find((x) => (x.optId || x.partId) === next[st.id]);
        if (o && !projTagOk(o)) { delete next[st.id]; changed = true; }
        const so = (st.subOptions || []).find((x) => (x.optId || x.partId) === next[`${st.id}__sub`]);
        if (so && !projTagOk(so)) { delete next[`${st.id}__sub`]; changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowProjSel]);
  // Render scale normalized to the master GLB's native dia (mirrors CPQTab): raw sizeSel.scale is
  // anchored to the family base (¾"), wrong for flows generated from a non-base master (H2's
  // 1-3/8"). The portal payload carries no assembly codes, so renderScaleOf resolves the master
  // dia from the flow's own option codes; base-native flows (H1) resolve to 1 = unchanged.
  const sizeScale = useMemo(() => {
    try { return renderScaleOf(data?.flow, params, null); } catch (e) { return 1; }
  }, [data, params]);

  const safeIdx = Math.min(stepIdx, Math.max(0, steps.length - 1));
  const onReview = steps.length > 0 && stepIdx >= steps.length;

  // Steps that require a finish before advancing (enforce finish selection).
  const finishMissing = (step) => {
    if (!step) return false;
    const isCompound = !!step.finishDataSource;
    const isSimpleFinish = !isCompound && step.targetNodes && (!step.styleOptions || step.styleOptions.length === 0);
    if (isSimpleFinish) return !params[step.id];
    if (isCompound) {
      const engaged = !!params[step.id] || !!params[`${step.id}__sub`] || !(step.styleOptions && step.styleOptions.length);
      return engaged && !params[`${step.id}__finish`];
    }
    return false;
  };

  // Hand the finished configuration up to the order cart. The presentation-matching metadata
  // (dominant finish code, chosen arm/plate codes — see the combo-gate notes in Checkout.jsx)
  // is computed here because only the configurator holds steps/params/finishes together.
  const addLine = (goCheckout) => {
    const dimParams = Object.fromEntries(Object.entries(dims).map(([sid, v]) => [`${sid}__dims`, v]));
    const domFin = (() => {
      const counts = {};
      Object.values(params).forEach((v) => {
        const f = v && finishes.find((x) => x.id === v);
        if (f && f.code) counts[f.code] = (counts[f.code] || 0) + 1;
      });
      return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [''])[0];
    })();
    const codesOfOpt = (o) => [o?.partId, o?.partName, o?.label, o?.optId]
      .map((x) => String(x || '').trim().toUpperCase()).filter(Boolean);
    const chosenArms = new Set();
    const chosenPlates = new Set();
    steps.forEach((st) => {
      const main = (st.styleOptions || []).find((o) => (o.optId || o.partId) === params[st.id]);
      if (main) codesOfOpt(main).forEach((c) => chosenArms.add(c));
      const sub = (st.subOptions || []).find((o) => (o.optId || o.partId) === params[`${st.id}__sub`]);
      if (sub) codesOfOpt(sub).forEach((c) => chosenPlates.add(c));
    });
    onAddLine && onAddLine({
      flowId,
      flowName: data?.flow?.name || flowName,
      lineTag: lineTag.trim(),
      selections: { params: { ...params, ...dimParams }, quantities },
      viewedTotal: price?.total ?? null,
      viewedLevel: price?.level || '',
      priceLines: (price?.lines || []).filter((l) => (l.total || 0) !== 0),
      presMeta: { domFin, chosenArms: [...chosenArms], chosenPlates: [...chosenPlates] },
    }, goCheckout);
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
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          {/* Their price ladder — shows only for Fabricut-leveled accounts (server-validated). */}
          {price && String(price.level || '').indexOf('FAB_') === 0 && (
            <span style={{ display: 'inline-flex', border: '1px solid var(--line)', borderRadius: 2, overflow: 'hidden' }}>
              {Object.entries(LEVEL_LABELS).map(([id, label]) => {
                const on = (viewLevel || price.level) === id;
                return (
                  <button key={id} type="button" onClick={() => setViewLevel(id)} style={{ padding: '7px 11px', fontFamily: 'var(--mono, monospace)', fontSize: '0.65rem', letterSpacing: '.07em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', background: on ? 'var(--brass, #b08d57)' : '#fff', color: on ? '#fff' : 'var(--ink-soft)' }}>
                    {label}
                  </button>
                );
              })}
            </span>
          )}
          {price ? (
            <span className={`cfg-price${pricing ? ' stale' : ''}`}>{fmtMoney(price.total)}</span>
          ) : (start !== null && start !== undefined ? <span className="cfg-price">Starting at {fmtMoney(start)}</span> : <span />)}
        </span>
      </div>

      <div className="cfg-body">
        <div className="cfg-stage">
          {cadUrl ? (
            <div className="viewer">
              <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]}
                style={{ width: '100%', height: '100%' }} resize={{ debounce: 0 }}>
                <Suspense fallback={null}>
                  <StudioRig />
                  {/* No scale wrapper: DynamicModel frames itself (scale + centre + broadside)
                      and folds the diameter cue into how much of the frame it fills. */}
                  <DynamicModel url={cadUrl} textureOverrides={textureOverrides} visibilityOverrides={visibilityOverrides} cloneSpecs={cloneSpecs} pbrRegistry={pbrRegistry} fitSizeScale={sizeScale} />
                </Suspense>
                <OrbitControls makeDefault />
              </Canvas>
              <span className="viewer-hint">Drag to rotate · scroll to zoom</span>
            </div>
          ) : (
            <div className="empty">This product doesn't have a 3D model yet.</div>
          )}
          {onReview && price && <ErpCopyBox lines={price.lines} />}
        </div>

        <div className="cfg-panel">
          {steps.length === 0 && <div className="empty">This product has no options to configure.</div>}

          {/* Room / line tag — asked up front; the ORDER sidemark lives on the checkout screen. */}
          {steps.length > 0 && (
            <div className="cfg-tags">
              <label>
                <span>Room / line tag</span>
                <input value={lineTag} onChange={(e) => setLineTag(e.target.value)} placeholder={'e.g. Living Room'}
                  title="Names this configuration on the quote (each room or line gets its own)." />
              </label>
            </div>
          )}

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
                  <StepControl step={step} params={params} setParam={setParam} quantities={quantities} setQty={setQty} finishes={finishes} sizeSel={sizeSel} allSteps={allSteps} info={stepOptions[step.id]} projTagOk={projTagOk} dims={dims} onDim={handleDimensionChange} />
                </div>
                {finishMissing(step) && <div className="cfg-require">Please select a finish to continue.</div>}
                <div className="cfg-nav">
                  <button className="btn-ghost" disabled={safeIdx === 0} onClick={() => setStepIdx(safeIdx - 1)}>← Back</button>
                  {safeIdx < steps.length - 1
                    ? <button className="btn" disabled={finishMissing(step)} onClick={() => setStepIdx(safeIdx + 1)}>Next →</button>
                    : <button className="btn" disabled={finishMissing(step)} onClick={() => setStepIdx(steps.length)}>Review →</button>}
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
                    <span>{summaryLabel(s, params, finishes, stepOptions[s.id]) || '—'}</span>
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
              <div className="cfg-submit">
                <div className="cfg-nav">
                  <button className="btn-ghost" onClick={() => setStepIdx(steps.length - 1)}>← Back</button>
                  <button className="btn-ghost" onClick={() => addLine(false)} title="Adds this configuration to your order and returns to the showroom to configure the next line.">+ Add &amp; configure another</button>
                  <button className="btn" onClick={() => addLine(true)}>Add to order &amp; checkout →</button>
                </div>
                <div className="cfg-fineprint">Your order can carry several configurations — each with its own room tag. Add-ons, sidemark and notes come next, at checkout. Nothing is ordered automatically.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
