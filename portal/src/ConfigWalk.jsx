// ONE PRODUCT, CONFIGURED THE WAY HQ'S CPQ CONFIGURES IT (step 4 of the portal rebuild, 2026-10-14).
//
// "ok as long as we can always keep in total alignment." (Stuart 2026-10-12)
//
// The server decides, this page draws. Every click changes the customer's ANSWERS — the same answers CPQ's screen keeps
// (answers, picks, sizes, the length as typed, counts, fabric, finishes) — and the server sends back the whole screen for
// them: the steps and what each offers, what a finish click applies to, the picture, the price at the level Portal Access
// shows, what a later choice took off, and why it cannot be requested yet. Nothing here works out a part, a price or a
// rule; the clicks themselves are CPQ's (a second click on a choice takes it off; a swatch sets what the server says it
// sets). What a customer may not do on the portal is not offered: no items added by hand, no notes to the shop, no kit,
// no solid brass (Stuart 2026-10-12 / 10-13).
import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { loadView, troubleOf } from './configApi';
import { shownOf } from './configBasket';
import { FRACTIONS, blankAnswers, wireOf, toggled } from './configAnswers';
import { renderThumbnails, cachedThumb } from '@engine/hardwareThumbs.js';
import { spanRiskOf, SpanRiskArt, SPAN_RISK_ASK } from '@engine/spanRisk.js';   // the risk window's words and drawings — CPQ shows the same
import TraversePanel from './TraversePanel.jsx';

const ConfigStage = lazy(() => import('./ConfigStage.jsx'));

const fmtMoney = (v) => (v === null || v === undefined) ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const LEVEL_WORDS = { FAB_RETAIL: 'Retail', FAB_WHOLESALE: 'Wholesale', STANDARD: 'Your price' };

export default function ConfigWalk({ flow, start, onAdd, onLeave, basketCount, onOpenBasket, editing }) {
  const [a, setA] = useState(() => (start && start.answers ? start.answers : blankAnswers()));
  const [stepKey, setStepKey] = useState((start && start.stepKey) || '');
  const [scopePick, setScopePick] = useState(null);          // { step, scope } — what a finish click applies to, as last chosen on a step
  const [view, setView] = useState(null);
  const [viewUi, setViewUi] = useState({ step: '', scope: '' });   // the step and scope the view on screen was worked out for
  const [lastClicked, setLastClicked] = useState('');
  const [pending, setPending] = useState(true);
  const [trouble, setTrouble] = useState(null);
  const [thumbs, setThumbs] = useState({});
  const [added, setAdded] = useState(null);
  // THE RISK WINDOW (Stuart 2026-10-19): fewer centre brackets than recommended, said and drawn, with a Confirm — when a count field is
  // left short (once the screen has the count back) and at Add.
  const [riskAsk, setRiskAsk] = useState(null);          // { r: view.risk entry, then: 'add' | null }
  const [riskCheck, setRiskCheck] = useState(false);
  // "START FROM A KIT" (CPQ's picker, 2026-10-20): what the kit filled in and what it could not, until dismissed; and the "additional ft"
  // box while it is being typed in
  const [kitReport, setKitReport] = useState(null);
  const [feetDraft, setFeetDraft] = useState(null);
  const seq = useRef(0);
  const typing = useRef(false);
  // THE PICTURE AT ADD (step 5, Stuart 2026-10-20): the stage hands over a function that takes the view as it stands (CPQ's picture
  // at Add); the line carries it, and a request reopened in CPQ shows it. Stable, so the stage's effect does not re-fire each render.
  const captureRef = useRef(null);
  const registerCapture = useRef((fn) => { captureRef.current = fn; }).current;

  const steps = view ? view.steps : [];
  const ix = Math.max(0, steps.findIndex((s) => s.key === stepKey));
  const step = steps[ix] || null;
  // The finish switch depends on the step only where the step is a part's: elsewhere the server's answer is the same.
  const scopeStep = step && step.kind === 'SLOT' ? step.key : '';
  const scopeNow = scopePick && scopePick.step === scopeStep ? scopePick.scope : '';

  // ── EVERY CHANGE ASKS THE SERVER FOR THE SCREEN (typing waits until the customer pauses) ──
  useEffect(() => {
    const my = ++seq.current;
    const wait = typing.current ? 450 : 0;
    typing.current = false;
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const ui = { step: scopeStep, scope: scopeNow, kitStart: a.kitStart || '', kitArmed: !!(a.kitArmed && a.kitPick), kitDone: a.kitDone || [] };
        const v = await loadView({ flowId: flow.id, state: wireOf(a), ui });
        if (my !== seq.current) return;
        setView(v); setViewUi(ui); setTrouble(null);
        // An Understood belongs to a removal: once that removal is gone (its pick came back), so is the Understood —
        // a fresh removal asks again (CPQ's pickDrops.mergeDrops).
        const live = new Set((v.removals || []).map((r) => r.key));
        setA((cur) => (cur.acks.every((k) => live.has(k)) ? cur : { ...cur, acks: cur.acks.filter((k) => live.has(k)) }));
        // A KIT JUST PICKED: what it fills in (the server worked it out on this model) is adopted ONCE, as CPQ's picker does — the answers,
        // the picks, the kit's base length only where none is typed; a kit this product cannot build fills in nothing.
        const ks = v.kitStart;
        if (ks && ks.id === a.kitStart) {
          setKitReport(ks.report);
          setA((cur) => (cur.kitStart !== ks.id ? cur : ks.blocked
            ? { ...cur, kitStart: '', kitPick: '', kitMotor: '', kitArmed: false, kitDone: [] }
            : { ...cur, kitStart: '', kitPick: ks.id, kitMotor: '', kitArmed: true, kitDone: [], answers: { ...cur.answers, ...ks.answers }, picks: { ...cur.picks, ...ks.picks },
              ...(ks.lengthInches && !String(cur.poleIn || '').trim() ? { poleIn: String(Math.floor(ks.lengthInches)), poleFrac: '' } : {}) }));
        }
        // …and the kit's brackets as their steps become answerable (CPQ's kit-bracket fill) — each filled once, never over a choice
        const fills = v.kitFills || {};
        const fillKeys = Object.keys(fills);
        if (fillKeys.length && ui.kitArmed) {
          setA((cur) => (!cur.kitArmed || cur.kitPick !== a.kitPick ? cur
            : { ...cur, picks: { ...cur.picks, ...fills }, kitDone: [...cur.kitDone, ...fillKeys.map((k) => `${k}|${fills[k]}`)] }));
        }
      } catch (e) {
        if (my === seq.current) setTrouble(await troubleOf(e));
      } finally {
        if (my === seq.current) setPending(false);
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [flow.id, a, scopeStep, scopeNow]);

  useEffect(() => {
    if (!riskCheck || pending || !view) return;
    setRiskCheck(false);
    const r = (view.risk || [])[0];
    if (r && r.key !== a.riskConfirmed) setRiskAsk({ r, then: null });
  }, [riskCheck, pending, view]); // eslint-disable-line react-hooks/exhaustive-deps

  // The step on screen stays the one the customer was on, as the walk grows or shrinks around it.
  useEffect(() => {
    if (!view || !view.steps.length) return;
    if (!view.steps.some((s) => s.key === stepKey)) setStepKey(view.steps[Math.min(ix, view.steps.length - 1)].key);
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── THE PICTURE OF EACH CHOICE ON THIS STEP — photographed from the model's own file by HQ's own thumbnail code ──
  const cadUrl = (view && view.assembly && view.assembly.cadUrl) || '';
  const onStep = useMemo(() => {
    if (!step || step.kind !== 'SLOT') return [];
    return [...(step.options || []), ...((step.sub && step.sub.options) || [])].filter((o) => o.nodes && o.nodes.length).map((o) => ({ key: o.id, nodes: o.nodes }));
  }, [step]);
  const onStepKey = onStep.map((g) => g.key).join('|');
  useEffect(() => {
    if (!cadUrl || !onStep.length) return undefined;
    let live = true;
    const seed = {};
    onStep.forEach((g) => { const c = cachedThumb(cadUrl, g.nodes); if (c !== undefined) seed[g.key] = c; });
    if (Object.keys(seed).length) setThumbs((t) => ({ ...seed, ...t }));
    renderThumbnails(cadUrl, onStep, (k, data) => { if (live) setThumbs((t) => (t[k] === data ? t : { ...t, [k]: data })); });
    return () => { live = false; };
  }, [cadUrl, onStepKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── THE CLICKS — each one changes an answer, as CPQ's do ──
  const set = (patch, isTyping = false) => { typing.current = isTyping; setA((cur) => ({ ...cur, ...patch(cur) })); };
  const answer = (key, value) => set((cur) => ({ answers: toggled(cur.answers, key, value) }));
  const pick = (slotKey, id) => { setLastClicked(id); set((cur) => ({ picks: toggled(cur.picks, slotKey, id) })); };
  const size = (stepId, optId) => set((cur) => ({ sizePick: { ...cur.sizePick, [stepId]: optId } }));
  const count = (slotKey, typed) => set((cur) => ({ stepQty: { ...cur.stepQty, [slotKey]: String(typed).replace(/[^0-9]/g, '') } }), true);
  const understood = (key) => set((cur) => ({ acks: cur.acks.includes(key) ? cur.acks : [...cur.acks, key] }));
  // A swatch sets what the server says a click on this step sets (CPQ's finishScope): this part, its collar, or the
  // whole configuration — and a second click on the chosen swatch takes it off again.
  // …and only once the screen shows the switch for THIS step and THIS choice of scope: a click in between would land where
  // the step before said it would.
  const finishLive = !!view && viewUi.step === scopeStep && viewUi.scope === scopeNow;
  const swatch = (g, code) => set((cur) => {
    const next = g.sel === code ? '' : code;
    if (g.applies.part) { const pf = { ...cur.partFinish }; if (next) pf[g.applies.part] = next; else delete pf[g.applies.part]; return { partFinish: pf }; }
    const gf = { ...cur.globalFinishes }; if (next) gf[g.material] = next; else delete gf[g.material]; return { globalFinishes: gf };
  });
  const backToConfiguration = (id) => set((cur) => { const pf = { ...cur.partFinish }; delete pf[id]; return { partFinish: pf }; });
  const finishAnswer = (code, label, choice) => set((cur) => ({ finishAnswers: { ...cur.finishAnswers, [code]: { ...(cur.finishAnswers[code] || {}), [label]: choice } } }));

  // "Start from a kit": the server works out what the kit fills in and the walk adopts it once (above). Back to "from scratch" keeps
  // every answer and drops the kit — CPQ's picker.
  const startKit = (id) => { setKitReport(null); set(() => (id ? { kitStart: id } : { kitStart: '', kitPick: '', kitMotor: '', kitArmed: false, kitDone: [] })); };
  // The kit's base set + the feet above it (CPQ: "on rod qty it starts at the 4ft set then each additional foot") — it sets the length.
  const extraFeet = (typed) => {
    const clean = String(typed).replace(/[^0-9]/g, '');
    setFeetDraft(clean);
    const base = (view && view.kit && view.kit.baseFeet) || 4;
    set(() => ({ poleIn: String((base + (parseInt(clean, 10) || 0)) * 12), poleFrac: '' }), true);
  };
  const chooseMotor = (code) => set(() => ({ kitMotor: code }));
  // The Traverse components answers: what stands is the customer's own, or — until they answer — the chart's defaults the server sent.
  const trvStep = steps.find((st) => st.kind === 'TRV') || null;
  const setTrv = (patch, isTyping = false) => set((cur) => {
    const base = cur.trvSel || (trvStep && trvStep.trv ? trvStep.trv.sel : { carrierStyle: '', carrierQty: '', draw: '', motorSide: '', picks: {}, accessories: {} });
    return { trvSel: { ...base, ...patch(base) } };
  }, isTyping);

  const go = (d) => { const next = steps[Math.max(0, Math.min(steps.length - 1, ix + d))]; if (next) setStepKey(next.key); };
  const canAdd = !!view && !view.refusal && !pending && !trouble;
  const add = (confirmedKey) => {
    if (!canAdd) return;
    const r = (view.risk || [])[0];
    const confirmed = typeof confirmedKey === 'string' ? confirmedKey : a.riskConfirmed;
    if (r && r.key !== confirmed) { setRiskAsk({ r, then: 'add' }); return; }
    const sent = { ...a, riskConfirmed: confirmed || '' };
    // No picture (no 3D view on this device, or it failed) is no reason to stop: the line is the answers, the picture a courtesy.
    const picture = (() => { try { return captureRef.current ? captureRef.current() : null; } catch (_) { return null; } })();
    onAdd({ flowId: flow.id, flowName: flow.name, state: wireOf(sent), memo: a.memo, qty: Math.max(1, parseInt(a.qty, 10) || 1), shown: shownOf(view), picture: picture || null });
    setAdded({ memo: a.memo || flow.name, editing: !!editing });
    if (!editing) { setA(blankAnswers()); setStepKey(''); setScopePick(null); setKitReport(null); setFeetDraft(null); }
  };

  const closeRisk = (confirmed) => {
    const ask = riskAsk;
    setRiskAsk(null);
    if (!confirmed || !ask) return;
    set(() => ({ riskConfirmed: ask.r.key }));
    if (ask.then === 'add') add(ask.r.key);
  };
  const riskWords = riskAsk ? spanRiskOf(riskAsk.r) : null;

  // ── DRAWING ──
  const optionCard = (o, onClick) => {
    return (
      <button key={o.id} data-id={o.id} className={`cf-opt${o.on ? ' on' : ''}${pending && lastClicked === o.id ? ' pending' : ''}`} onClick={onClick} disabled={!!trouble}>
        <span className="cf-opt-img">{thumbs[o.id] ? <img src={thumbs[o.id]} alt="" /> : <span className="cf-opt-wait">{thumbs[o.id] === null ? '' : '···'}</span>}</span>
        <span className="cf-opt-codes"><span className="cf-ours">{o.code}</span>{o.sku ? <span className="cf-theirs">{o.sku}</span> : null}</span>
        <span className="cf-opt-name">{o.name}</span>
        {o.noFinish && <span className="cf-opt-note">clear · takes no finish</span>}
      </button>
    );
  };

  const stepBody = () => {
    if (!step) return null;
    if (step.kind === 'AXIS' || step.kind === 'AXES') {
      return step.axes.map((ax) => (
        <div key={ax.key} className="cf-q">
          {step.kind === 'AXES' && <div className="cf-q-label">{ax.label}</div>}
          <div className="cf-chips">
            {ax.values.map((v) => <button key={String(v.value)} data-axis={ax.key} data-value={String(v.value)} className={`cf-chip${v.on ? ' on' : ''}`} onClick={() => answer(ax.key, v.value)}>{v.label}</button>)}
          </div>
        </div>
      ));
    }
    if (step.kind === 'SIZE') {
      return <div className="cf-chips">{step.options.map((o) => <button key={o.optId} data-size={o.optId} className={`cf-chip${o.on ? ' on' : ''}`} onClick={() => size(step.sizeStepId, o.optId)}>{o.label}</button>)}</div>;
    }
    if (step.kind === 'SLOT') {
      const picked = step.options.find((o) => o.on);
      const shown = step.collapse && picked ? [picked] : step.options;
      return (
        <>
          {step.notAsked && <div className="cf-note">Not needed — {step.notAsked}.</div>}
          {!step.notAsked && !step.options.length && <div className="cf-note">Nothing to choose here for the choices so far.</div>}
          {!!shown.length && <div className="cf-opts">{shown.map((o) => optionCard(o, () => pick(step.key, o.id)))}</div>}
          {step.collapse && picked && <div className="cf-fine">{step.options.length - 1} other choice{step.options.length - 1 === 1 ? '' : 's'} hidden — click the return again to show them.</div>}
          {step.qty && (
            <label className="cf-count">
              <span>How many</span>
              <input value={a.stepQty[step.key] !== undefined ? a.stepQty[step.key] : ''} inputMode="numeric"
                placeholder={step.qty.recommended ? String(step.qty.recommended) : '1'} onChange={(e) => count(step.key, e.target.value)}
                onBlur={() => { if (step.qty.rounded) count(step.key, String(step.qty.rounded)); setRiskCheck(true); }} />
              {step.qty.recommended ? <span className="cf-fine">recommended {step.qty.recommended} — leave it empty to use it</span> : null}
              {step.qty.splices ? <span className="cf-fine">{step.qty.splices === 1 ? 'this pole is spliced: one centre bracket sits at the splice, so the count is odd (1, 3, 5)' : `one centre bracket at each of the ${step.qty.splices} splices`}</span> : null}
              {step.qty.rounded ? <span className="cf-fine">rounded up to {step.qty.rounded}</span> : null}
            </label>
          )}
          {step.short && <div className="cf-note warn">{step.short.chosen ? `${step.short.chosen} centre bracket${step.short.chosen === 1 ? '' : 's'} chosen` : 'No centre bracket chosen'} — {step.short.recommended} recommended for this pole. You can still add this to your request; our team will look at it.</div>}
          {step.sub && (
            <div className="cf-sub">
              <div className="cf-q-label">{step.sub.label}{step.sub.notAsked ? <span className="cf-fine"> · {step.sub.notAsked}</span> : null}</div>
              {!!step.sub.options.length && <div className="cf-opts">{step.sub.options.map((o) => optionCard(o, () => pick(step.sub.key, o.id)))}</div>}
            </div>
          )}
        </>
      );
    }
    if (step.kind === 'LENGTH') {
      return (
        <>
          <div className="cf-length">
            <label><span>Inches</span><input value={a.poleIn} inputMode="decimal" placeholder="—" onChange={(e) => set(() => ({ poleIn: e.target.value.replace(/[^0-9.]/g, '') }), true)} /></label>
            <label><span>Fraction</span>
              <select value={a.poleFrac} onChange={(e) => set(() => ({ poleFrac: e.target.value }))}>{FRACTIONS.map((f) => <option key={f} value={f}>{f || '—'}</option>)}</select>
            </label>
            <label><span>Feet · billed</span><input value={step.feetBilled || ''} readOnly placeholder="—" /></label>
          </div>
          {step.lengthInches ? <div className="cf-fine">{step.lengthInches}&Prime; ÷ 12 = {step.exactFeet} ft → billed at <b>{step.feetBilled} full feet</b>, rounded up.</div> : null}
          {step.splice && (
            <div className={`cf-note${step.splice.included ? '' : ' warn'}`}>
              {step.splice.included
                ? (step.splice.splices > 1
                  // (a pole of three pieces or more — 2026-10-20: it said "two pieces … at the center" whatever the length)
                  ? <>Over the {step.splice.overInches}&Prime; one-piece limit, this pole is made in {step.splice.pieces} pieces joined by {step.splice.splices} splices, evenly along it — the joiners are on the order.</>
                  : <>Over the {step.splice.overInches}&Prime; one-piece limit, this pole is made in two pieces joined by a splice at the center — it is on the order.</>)
                : <>Over the {step.splice.overInches}&Prime; one-piece limit — our team will confirm how this pole is joined.</>}
            </div>
          )}
          {/* WHAT THE SPAN IS WORKED FROM (2026-10-19): the fabric weight, the curtain length (rod to floor) and whether the
              brackets go into studs — CPQ asks the same three on the same step. */}
          <div className="cf-length cf-span">
            <label className="cf-fabric"><span>Fabric weight</span>
              <select value={a.fabricId} onChange={(e) => set(() => ({ fabricId: e.target.value }))}>{(step.fabrics || []).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
            </label>
            <label><span>Curtain length (ft)</span>
              <input data-span="drop" value={a.dropFt || ''} inputMode="decimal" placeholder={String(step.dropFt || 8)} onChange={(e) => set(() => ({ dropFt: e.target.value.replace(/[^0-9.]/g, '') }), true)} />
            </label>
            <label><span>Wall fixing</span>
              <select data-span="stud" value={a.onStud === true ? 'STUD' : 'DRYWALL'} onChange={(e) => set(() => ({ onStud: e.target.value === 'STUD' }))}>
                <option value="DRYWALL">Drywall with toggles</option>
                <option value="STUD">In a stud</option>
              </select>
            </label>
          </div>
          <div className="cf-fine">Curtain length is rod to floor — a longer curtain is heavier.{a.dropFt && Number(a.dropFt) !== step.dropFt ? ` Worked at ${step.dropFt} ft.` : ''}</div>
          {step.support && (
            <div className="cf-note">
              A support every {step.support.everyInches}&Prime; — {step.support.why}. This pole wants <b>{step.support.supports}</b> support{step.support.supports === 1 ? '' : 's'}
              {step.support.other && step.support.other !== step.support.supports ? ` (${step.support.other} ${step.support.onStud ? 'on drywall toggles' : 'in a stud'})` : ''}.
              {step.support.unlisted ? ' One of the rods chosen has no span on file — our team will confirm the supports for it.' : ''}
            </div>
          )}
          {/* a traverse sold as a kit (H1-2TRV, 2026-10-20): the brackets its kit includes at this length — what the bracket steps ask for */}
          {step.kitChart && (
            <div className="cf-note">Our kit for {step.kitChart.feet} ft includes <b>{step.kitChart.count}</b> bracket{step.kitChart.count === 1 ? '' : 's'} — {step.kitChart.where}.</div>
          )}
          {(step.rods || []).map((r) => {
            const picked = r.options.find((o) => o.picked);
            const nameOf = (o) => o.name || o.sku || o.code;
            return (
              <div key={r.key} className={`cf-note${r.better ? ' warn' : ''}`}>
                {r.better && picked && <div>{nameOf(r.better)} would need {r.better.supports} — fewer than the {nameOf(picked)}'s {picked.supports}.</div>}
                <div className="cf-fine">{r.label} at this length: {r.options.map((o) => `${o.sku || o.code} ${o.supports == null ? '—' : o.supports}${o.picked ? ' (chosen)' : ''}`).join(' · ')}</div>
              </div>
            );
          })}
        </>
      );
    }
    if (step.kind === 'CARRIERS') {
      return (
        <>
          <div className="cf-note">The track carries the drapery on carriers — nothing to choose; the count follows the length.</div>
          {step.rows.map((r, i) => <div key={i} className="cf-row"><span className="cf-ours">{r.code}</span><span>{r.name}</span></div>)}
        </>
      );
    }
    if (step.kind === 'TRV') return trvBody(step.trv);
    return null;
  };

  // ── THE TRAVERSE COMPONENTS STEP — CPQ's panel, drawn by ./TraversePanel (the one Quick Ship's traverse kit draws too) ──
  const trvBody = (t) => <TraversePanel t={t} sel={a.trvSel || (t && t.sel)} onSel={setTrv} fmtMoney={fmtMoney} />;

  const finishPanel = () => {
    if (!view) return null;
    const f = view.finishes;
    return (
      <div className={`cf-box cf-finish${finishLive ? '' : ' stale'}`}>
        <div className="cf-box-head"><span>Finish</span><span className="cf-fine">{f.scope.exceptions ? `${f.scope.exceptions} part${f.scope.exceptions === 1 ? '' : 's'} in a finish of their own` : 'whole configuration'}</span></div>
        {f.scope.targets.length > 1 && (
          <div className="cf-scope">
            <span className="cf-q-label">A click applies to</span>
            <div className="cf-chips">
              {f.scope.targets.map((t) => (
                <button key={t.scope} data-scope={t.scope} className={`cf-chip${t.scope === f.scope.now ? ' on' : ''}`} onClick={() => setScopePick({ step: scopeStep, scope: t.scope })}>
                  {t.scope === 'WHOLE' ? 'Whole configuration' : `${t.scope === 'COLLAR' ? 'Collar only' : 'This part only'} · ${t.sku || t.code}`}
                </button>
              ))}
            </div>
            {f.scope.exception && <button className="btn-ghost" onClick={() => backToConfiguration(f.scope.exception.id)}>{f.scope.exception.code} is in its own finish — back to the configuration's</button>}
          </div>
        )}
        {(f.asking || []).map((q) => (
          <div key={q.code} className="cf-scope">
            <span className="cf-q-label">{q.name || q.code}</span>
            {q.questions.map((qq) => (
              <div key={qq.label} className="cf-chips"><span className="cf-fine">{qq.label}</span>
                {qq.choices.map((c) => <button key={c} className={`cf-chip${String((q.answers || {})[qq.label] || '').toUpperCase() === c.toUpperCase() ? ' on' : ''}`} onClick={() => finishAnswer(q.code, qq.label, c)}>{c}</button>)}
              </div>
            ))}
          </div>
        ))}
        {!f.groups.length && <div className="cf-fine">Choose a part to see its finishes.</div>}
        {f.groups.map((g) => (
          <div key={g.material} className="cf-fgroup">
            <div className="cf-q-label">{g.heading}</div>
            {g.lists.map((l) => (
              <div key={l.label} className="cf-flist">
                {l.label !== g.heading && <div className="cf-fine">{l.label}</div>}
                <div className="cf-swatches">
                  {l.swatches.map((s) => (
                    <button key={s.code} data-material={g.material} data-code={s.code} className={`cf-swatch${g.sel === s.code ? ' on' : ''}`} title={`${s.theirs || s.name || s.code}${s.theirs && s.name ? ` · ${s.name}` : ''} · ${s.code}`}
                      onClick={() => finishLive && swatch(g, s.code)} disabled={!finishLive}>
                      <span className="cf-swatch-img" style={s.swatch ? { backgroundImage: `url(${s.swatch})` } : undefined} />
                      <span className="cf-swatch-name">{s.theirs || s.name || s.code}</span>
                      <span className="cf-fine">{s.code}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  const pricePanel = () => {
    if (!view) return null;
    const p = view.price;
    const money = p.total !== undefined;
    return (
      <div className="cf-box cf-price">
        <div className="cf-box-head"><span>Price</span><span className="cf-fine">{money ? (LEVEL_WORDS[p.level] || p.level) : 'from our team'}</span></div>
        {!p.lines.length && <div className="cf-fine">Nothing chosen yet.</div>}
        <table><tbody>
          {p.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <span className="cf-opt-codes"><span className="cf-ours">{l.code}</span>{l.sku ? <span className="cf-theirs">{l.sku}</span> : null}
                  {l.feet ? <span className="cf-fine">{l.feet} ft</span> : (l.qty > 1 ? <span className="cf-fine">×{l.qty}</span> : null)}{l.added ? <span className="cf-fine">added</span> : null}</span>
                <span className="cf-line-name">{l.name}</span>
                <span className="cf-line-finish">{l.finish ? `${l.finish}${l.stock ? ' · stock colour' : ''}` : (l.clear ? 'clear · takes no finish' : '')}</span>
              </td>
              <td className="num">{l.onReview ? <span className="cf-fine">{money ? 'priced on review' : ''}</span> : fmtMoney(l.total)}</td>
            </tr>
          ))}
          {money && !!p.lines.length && (
            <tr className="cf-total"><td>{p.qty > 1 ? `Each set · ${p.qty} sets ${fmtMoney(p.totalForAll)}` : 'Estimated'}{p.hasReview ? ' · before the items priced on review' : ''}</td><td className="num">{fmtMoney(p.total)}</td></tr>
          )}
        </tbody></table>
        <div className="cf-fine">{money ? `Shown at ${LEVEL_WORDS[p.level] || p.level}, for reference. Your quote comes from Classical Elements at your account's pricing.` : 'Your quote comes from Classical Elements at your account\'s pricing.'}</div>
      </div>
    );
  };

  return (
    <div className="cf">
      {riskWords && (
        <div className="cf-risk" role="dialog" aria-modal="true" aria-label={riskWords.title}>
          <div className="cf-risk-card">
            <div className="cf-risk-title">{riskWords.title}</div>
            <SpanRiskArt kind={riskWords.kind} width={396} />
            <p className="cf-risk-lead">{riskWords.lead}</p>
            <p>{riskWords.body}</p>
            <p className="cf-fine">{SPAN_RISK_ASK}</p>
            <div className="cf-risk-go">
              <button className="btn-ghost" onClick={() => closeRisk(false)}>Go back</button>
              <button className="btn" onClick={() => closeRisk(true)}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      <div className="cf-top">
        <button className="btn-ghost" onClick={onLeave}>← All products</button>
        <div className="cf-title">{flow.name}{flow.preview ? <span className="cf-preview">Preview · only you can see this product</span> : null}</div>
        <button className="btn-ghost" onClick={onOpenBasket}>Your request ({basketCount})</button>
      </div>

      {trouble && (
        <div className="msg">{trouble.text}{trouble.reload ? <> <button className="btn-ghost" onClick={() => window.location.reload()}>Refresh</button></> : null}</div>
      )}
      {added && (
        <div className="msg ok">
          {added.editing ? 'Saved to your request.' : `${added.memo} is in your request.`}{' '}
          <button className="btn-ghost" onClick={onOpenBasket}>Review and send</button>
          {!added.editing && <button className="btn-ghost" onClick={() => setAdded(null)}>Configure another</button>}
        </div>
      )}

      {!view && !trouble && <div className="empty">Opening {flow.name}…</div>}
      {view && (
        <>
          <div className="cf-rail">
            {steps.map((s, i) => {
              const picked = s.kind === 'SLOT' ? (s.options || []).find((o) => o.on) : null;
              return (
                <button key={s.key} data-step={s.key} className={`cf-rail-cell${i === ix ? ' now' : ''}${s.answer ? ' done' : ''}`} onClick={() => setStepKey(s.key)} title={s.label}>
                  <span className="cf-rail-label">{s.label}</span>
                  <span className="cf-rail-answer">{picked ? (picked.sku || picked.code) : (s.answer || '—')}</span>
                </button>
              );
            })}
          </div>

          {view.kit && (
            <div className="cf-kit">
              <label className="cf-kit-pick">
                <span className="cf-q-label">Start from a kit</span>
                <select value={a.kitStart || a.kitPick || ''} onChange={(e) => startKit(e.target.value)} disabled={!!a.kitStart} data-kit-pick="">
                  <option value="">— configure from scratch —</option>
                  {view.kit.offered.map((k) => <option key={k.id} value={k.id}>{k.code}{k.sku ? ` · ${k.sku}` : ''}{k.name ? ` · ${k.name}` : ''}</option>)}
                </select>
              </label>
              {view.kit.chosen && (
                <label className="cf-kit-feet">
                  <span className="cf-fine">{view.kit.baseFeet} ft set +</span>
                  <input value={feetDraft !== null ? feetDraft : (view.kit.extraFeet || '')} placeholder="0" inputMode="numeric" onChange={(e) => extraFeet(e.target.value)} onBlur={() => setFeetDraft(null)} />
                  <span className="cf-fine">additional ft</span>
                </label>
              )}
              {view.kit.motor && (
                <select className={`cf-kit-motor${view.kit.motor.chosen ? '' : ' need'}`} value={a.kitMotor || ''} onChange={(e) => chooseMotor(e.target.value)} data-kit-motor="">
                  <option value="">motor — choose the code</option>
                  {view.kit.motor.codes.map((m) => <option key={m.code} value={m.code}>{m.code}{m.motor ? ` · ${m.motor}` : ''}</option>)}
                </select>
              )}
              {view.kit.mountFollow && <span className={`cf-kit-mount${view.kit.mountFollow.noKit ? ' warn' : ''}`}>{view.kit.mountFollow.words}</span>}
              <span className="cf-fine">{view.kit.chosen
                ? `The ${view.kit.baseFeet} ft kit is the first line; the feet above it are priced under it. Anything else you add is its own line.`
                : 'Fills in the opening answers. Everything stays editable.'}</span>
            </div>
          )}
          {kitReport && (
            <div className={`cf-kit-report${kitReport.blocked ? ' blocked' : (kitReport.missed.length ? ' missed' : '')}`}>
              <div>
                <div className="cf-q-label">{kitReport.blocked ? 'This product cannot be built as' : 'Started from kit'} · {kitReport.name}</div>
                {kitReport.blocked && <div className="cf-fine cf-need">⚠ {kitReport.blocked.what} — {kitReport.blocked.why} Nothing was filled in.</div>}
                {kitReport.carried.length > 0 && <div className="cf-fine">Filled in: {kitReport.carried.join(' · ')}</div>}
                {kitReport.missed.map((m, i) => <div key={i} className="cf-fine">○ {m.what} — {m.why}</div>)}
              </div>
              <button className="btn-ghost" onClick={() => setKitReport(null)}>Dismiss</button>
            </div>
          )}

          {view.removals.length > 0 && (
            <div className={`cf-removals${view.removals.some((r) => !r.acked) ? ' open' : ''}`}>
              {view.removals.map((r) => (
                <div key={r.key} className={`cf-removal${r.acked ? ' acked' : ''}`}>
                  <span className="cf-fine">{r.step}</span>
                  <span><b>{r.code}</b> {r.part} was taken off — {r.why}.</span>
                  {!r.acked && <button className="btn-ghost" data-removal={r.key} onClick={() => understood(r.key)}>Understood</button>}
                </div>
              ))}
            </div>
          )}

          <div className="cf-body">
            <div className="cf-step cf-box">
              <div className="cf-box-head"><span>Step {ix + 1} of {steps.length}</span>{pending && <span className="cf-fine">updating…</span>}</div>
              <div className="cf-step-title">{step && step.label}</div>
              {step && step.hint && <div className="cf-fine">{step.hint}</div>}
              <div className="cf-step-body">{stepBody()}</div>
              <div className="cf-nav">
                <button className="btn-ghost" onClick={() => go(-1)} disabled={ix === 0}>Back</button>
                {ix < steps.length - 1
                  ? <button className="btn" onClick={() => go(1)}>Next step</button>
                  : <button className="btn" onClick={add} disabled={!canAdd} title={view.refusal ? view.refusal.message : ''}>{editing ? 'Save to request' : 'Add to request'}</button>}
              </div>
            </div>

            <div className="cf-side">
              <div className="cf-stage">
                <Suspense fallback={<div className="cf-stage-msg">Loading the 3D view…</div>}>
                  <ConfigStage cadUrl={cadUrl} render={view.render} onCapture={registerCapture} />
                </Suspense>
                <span className="cf-stage-hint">Drag to rotate · scroll to zoom</span>
              </div>
              <div className="cf-panels">
                {finishPanel()}
                {pricePanel()}
              </div>
            </div>
          </div>

          <div className="cf-addbar">
            <label><span>Room / tag</span><input value={a.memo} maxLength={120} placeholder="Living room" onChange={(e) => set(() => ({ memo: e.target.value }), true)} /></label>
            <label title="How many of THIS exact set — 2 is two complete sets, never a length"><span>How many of this set</span><input value={a.qty} inputMode="numeric" onChange={(e) => set(() => ({ qty: e.target.value.replace(/[^0-9]/g, '') }), true)} /></label>
            <div className="cf-addbar-go">
              {(view.supportShort || []).map((t, i) => <span key={i} className="cf-short">{t}</span>)}
              {(view.trvStill || []).length > 0 && <span className="cf-short">Still needed on the track: {view.trvStill.join(' · ')}</span>}
              {view.refusal && <span className="cf-refusal">{view.refusal.message}</span>}
              <button className="btn" onClick={add} disabled={!canAdd}>{editing ? 'Save to request' : 'Add to request'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
