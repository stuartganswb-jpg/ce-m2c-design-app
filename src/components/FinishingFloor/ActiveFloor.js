import React, { useState, useRef } from 'react';
import { finishingDb as db } from '../../firebase';
import { doc, updateDoc, addDoc, collection, getDocs, query, orderBy, limit, serverTimestamp } from "firebase/firestore";
import { resolveRecipe } from '../Shared/finishingTime';

const cardStyle = { background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column' };
// Source numbers first: the REAL NetSuite WO # leads wherever it exists; long app id is the fallback.
const woRef = (wo) => (wo && (wo.nsWoTran || wo.displayId || wo.woNum || wo.id)) || '';
const inputStyle = { padding: '10px', border: '1px solid var(--line)', borderRadius: '2px', width: '100%', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' };

// What a sled is doing right now, derived from its WO's current-step task state (set by operator
// PIN actions). This is what makes the twin "live".
const ACTIVITY = {
    IDLE: { label: 'Empty', running: false },
    SETUP: { label: 'Setting up', running: true },
    SPRAY: { label: 'Spraying', running: true },
    CURE: { label: 'Curing', running: true },
    WAIT_SPRAY: { label: 'Ready to spray', running: false },
    WAIT_OVEN: { label: 'Ready for oven', running: false },
    STAGED: { label: 'Staged', running: false },
};
const sledActivity = (wo) => {
    if (!wo) return { code: 'IDLE', ...ACTIVITY.IDLE };
    const t = wo.tasks || {};
    if (t.spinBake?.status === 'Running') return { code: 'CURE', ...ACTIVITY.CURE };
    if (t.spinSpray?.status === 'Running') return { code: 'SPRAY', ...ACTIVITY.SPRAY };
    if (t.spinSetup?.status === 'Running') return { code: 'SETUP', ...ACTIVITY.SETUP };
    if (t.spinSpray?.status === 'Complete' && t.spinBake?.status !== 'Complete') return { code: 'WAIT_OVEN', ...ACTIVITY.WAIT_OVEN };
    if (t.spinSetup?.status === 'Complete' && t.spinSpray?.status !== 'Complete') return { code: 'WAIT_SPRAY', ...ACTIVITY.WAIT_SPRAY };
    return { code: 'STAGED', ...ACTIVITY.STAGED };
};
// A sled is "at the oven (left) spot" when it is curing or waiting for the oven; otherwise it is at
// the setup/spray (right) spot. The two sleds shuffle between those two fixed positions.
const atOvenSpot = (act) => act.code === 'CURE' || act.code === 'WAIT_OVEN';

// Derive the live machine layout from production: which sled is at the oven (left) vs setup/spray
// (right) spot, and where the single left-mounted oven sits — over the left sled (curing) or slid
// further left for poles. The oven never moves to the right sled; the SLEDS move to the oven.
const computeLayout = (redWO, blueWO, activeWOs) => {
    const redAct = sledActivity(redWO);
    const blueAct = sledActivity(blueWO);
    let redPos = 'LEFT', bluePos = 'RIGHT';
    if (atOvenSpot(blueAct) && !atOvenSpot(redAct)) { redPos = 'RIGHT'; bluePos = 'LEFT'; }
    const polesBaking = activeWOs.some(w => w.tasks?.poleBake?.status === 'Running');
    const leftAct = redPos === 'LEFT' ? redAct : blueAct;
    const ovenMode = polesBaking ? 'POLES' : 'SLED';       // SLED = over the left sled spot
    const ovenRunning = leftAct.code === 'CURE' || polesBaking;
    return { redAct, blueAct, redPos, bluePos, ovenMode, polesBaking, ovenRunning };
};

// --- LIVE DIGITAL TWIN (production-driven) ---
// The oven is fixed on the LEFT over the cure spot; the two sleds shuffle between the left (under-
// oven) spot and the right (setup/spray) spot. The oven only slides further left, over the pole
// rack, when poles bake. All derived from task state, so it animates as operators run each step.
const DigitalTwinSCADA = ({ redWO, blueWO, activeWOs, onForceClear, onStation }) => {
    const { redAct, blueAct, redPos, bluePos, ovenMode, polesBaking, ovenRunning } = computeLayout(redWO, blueWO, activeWOs);
    const spotLeft = (pos) => pos === 'LEFT' ? '36%' : '58%';   // left = oven/cure, right = setup/spray
    const ovenLeft = ovenMode === 'POLES' ? '2%' : '33%';       // over pole rack vs over the left sled
    const ovenLabel = polesBaking ? 'Slid left · poles' : (ovenRunning ? 'Curing left sled' : 'Over left sled');

    const Sled = ({ color, wo, act, pos }) => {
        const accent = color === 'RED' ? 'var(--ink)' : 'var(--brass)';
        return (
            <div onClick={() => onStation && onStation(color)} title={`Tap for manual controls — ${color} sled`} style={{ position: 'absolute', top: '42px', left: spotLeft(pos), width: '14%', height: '88px', background: '#fff', border: `2px solid ${accent}`, borderRadius: '2px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4px', zIndex: 10, transition: 'left 1.5s ease-in-out', boxShadow: act.running ? '0 0 0 3px rgba(176,141,87,0.30)' : '0 4px 12px rgba(0,0,0,0.06)', cursor: onStation ? 'pointer' : 'default' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: accent, fontWeight: 600 }}>{color}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink)', marginTop: '3px' }}>{act.label}</span>
                {wo && <span title={wo.id} style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', marginTop: '2px' }}>{woRef(wo)}</span>}
            </div>
        );
    };

    return (
        <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', marginBottom: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Live Digital Twin: Sleds & Oven</h3>
                <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: ovenRunning ? 'var(--brass)' : 'var(--ink-soft)', border: '1px solid var(--line)', padding: '5px 10px', borderRadius: '2px' }}>
                        ● Live · {ovenLabel}
                    </span>
                    {onForceClear && (
                        <button onClick={onForceClear} title="Reset every Running bake back to Pending — un-jams a locked oven; nothing is marked complete" style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', background: 'transparent', border: '1px solid #d9534f', padding: '5px 10px', borderRadius: '2px', cursor: 'pointer' }}>
                            ⚠ Force Oven Clear
                        </button>
                    )}
                </span>
            </div>

            <div style={{ position: 'relative', height: '170px', background: 'var(--paper)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                {/* spindle track the sleds shuffle along */}
                <div style={{ position: 'absolute', left: '34%', right: '4%', top: '86px', height: '4px', background: 'var(--line)' }} />

                {/* POLE RACK (far left — the oven slides over here for poles) */}
                <div onClick={() => onStation && onStation('POLES')} title="Tap for manual controls — pole rack" style={{ position: 'absolute', left: '2%', top: '34px', width: '24%', height: '104px', border: `1px solid ${polesBaking ? 'var(--brass)' : 'var(--line)'}`, background: polesBaking ? 'rgba(176,141,87,0.06)' : '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: onStation ? 'pointer' : 'default', zIndex: 7 }}>
                    <div style={{ width: '80%', height: '2px', background: 'var(--line)' }} />
                    <div style={{ width: '80%', height: '2px', background: 'var(--line)' }} />
                    <span style={{ color: polesBaking ? 'var(--brass)' : 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{polesBaking ? 'Poles curing' : 'Pole Rack'}</span>
                </div>

                {/* OVEN — fixed over the left sled spot (a translucent hood the sled sits inside); slides
                    further left over the pole rack for poles. Behind the sleds so they show "inside" it. */}
                <div onClick={() => onStation && onStation('OVEN')} title="Tap for manual controls — oven" style={{ position: 'absolute', top: '12px', left: ovenLeft, width: '22%', height: '150px', background: ovenRunning ? 'rgba(176,141,87,0.12)' : 'rgba(176,141,87,0.04)', border: '2px solid var(--brass)', boxShadow: ovenRunning ? 'inset 0 0 26px rgba(176,141,87,0.35)' : 'none', transition: 'left 1.6s ease-in-out', zIndex: 6, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', paddingTop: '8px', cursor: onStation ? 'pointer' : 'default' }}>
                    <span style={{ color: '#fff', background: 'var(--brass)', padding: '4px 10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Oven</span>
                </div>

                {/* HAND FINISH zone (far right — off-track bench work) */}
                {(() => { const n = activeWOs.filter(w => w.tasks?.hand?.status === 'Running').length; return (
                <div onClick={() => onStation && onStation('HAND')} title="Tap for manual controls — hand finish bench" style={{ position: 'absolute', right: '1%', top: '34px', width: '16%', height: '104px', border: `1px solid ${n ? 'var(--brass)' : 'var(--line)'}`, background: n ? 'rgba(176,141,87,0.06)' : '#fff', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px', cursor: onStation ? 'pointer' : 'default', zIndex: 7 }}>
                    <span style={{ color: n ? 'var(--brass)' : 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center' }}>Hand Finish{n ? ` · ${n} running` : ''}</span>
                </div>); })()}

                <Sled color="RED" wo={redWO} act={redAct} pos={redPos} />
                <Sled color="BLUE" wo={blueWO} act={blueAct} pos={bluePos} />
            </div>

            <div style={{ marginTop: '18px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em', lineHeight: 1.6 }}>
                RED: {redAct.label}{redWO ? ` (${woRef(redWO)})` : ''} · BLUE: {blueAct.label}{blueWO ? ` (${woRef(blueWO)})` : ''} · Oven {ovenLabel}.
                Sleds shuffle — the cured sled moves right to setup/spray, the next moves left under the oven; the oven slides left for poles.
            </div>
        </div>
    );
};

const ActiveFloor = ({ workOrders, recipes, activePots, sysConfig, setMixModal, now, user, setQcModal, users }) => {
  const activeWOs = workOrders.filter(w => w.currentPhase === "Painting");
  const activeJobs = workOrders.filter(j => j.tasks && Object.values(j.tasks).some(t => t.status === 'Running'));
  const redlineWOs = workOrders.filter(w => w.redlineAlert);
  const floorOps = users?.filter(u => ['painter', 'hand_painter', 'paint_manager'].includes(u.role)) || [];
  const [viewWo, setViewWo] = useState(null); // read-only order details popup (tap any job window)

  const cfg = {
    potLifeMins: sysConfig?.potLifeMins || 189, recoatMins: sysConfig?.recoatMins || 90,
    mixMins: sysConfig?.mixMins || 5, 
    spinSetupMins: sysConfig?.spinSetupMins || 10, spinPaintMins: sysConfig?.spinPaintMins || 3, 
    ovenMins: sysConfig?.ovenMins || 10, handSmallMins: sysConfig?.handSmallMins || 1.35,
    handPoleMins: sysConfig?.handPoleMins || 10, poleMins: sysConfig?.poleMins || 5
  };

  // --- SLED ASSIGNMENT ENGINE ---
  const spinningWOs = [...activeWOs].filter(w => w.tasks?.spinSetup && w.tasks.spinBake?.status !== 'Complete')
    .sort((a, b) => ((a.scheduleSeq ?? 1e9) - (b.scheduleSeq ?? 1e9)) || a.id.localeCompare(b.id));

  const redWO = activeWOs.find(w => w.machineAssigned === 'RED') || (spinningWOs.find(w => !w.machineAssigned) || null);
  const blueWO = activeWOs.find(w => w.machineAssigned === 'BLUE') || (spinningWOs.find(w => !w.machineAssigned && w.id !== redWO?.id) || null);

  if (redWO && !redWO.machineAssigned) updateDoc(doc(db,"fin_workorders", redWO.id), { machineAssigned: 'RED' });
  if (blueWO && !blueWO.machineAssigned) updateDoc(doc(db,"fin_workorders", blueWO.id), { machineAssigned: 'BLUE' });

  // Machine state is DERIVED from production (no manual toggles): the sled that is curing / waiting
  // for the oven sits at the left (oven) spot; the other is at the right (setup/spray) spot, and they
  // shuffle as steps complete. Same computeLayout that drives the twin, so graphic + task-card
  // stations stay in lockstep. ovenPos POLES when poles are baking.
  const layout = computeLayout(redWO, blueWO, activeWOs);
  const machineState = {
      redSledAt: layout.redPos,
      blueSledAt: layout.bluePos,
      ovenPos: layout.ovenMode === 'POLES' ? 'POLES' : 'SPINDLE',
      isOvenRunning: layout.ovenRunning,
  };

  const getSledLocation = (sledColor) => sledColor === 'RED' ? machineState.redSledAt : machineState.blueSledAt;

  // POLES vs SMALL PARTS run on THEIR OWN TRACKS (Stuart 2026-07-20): batching them into the
  // same coat is the ideal, never a gate. Small parts advance on currentStepIndex; poles advance
  // on poleStepIndex (defaults to currentStepIndex on legacy docs). Orders without real poles
  // never see pole cards or pole gates at all.
  const woHasPoles = (wo) => Number(wo.totalPoles || (wo.poles && wo.poles.qty)) > 0 || wo.type === 'Poles';
  const poleIdxOf = (wo) => (wo.poleStepIndex !== undefined && wo.poleStepIndex !== null) ? wo.poleStepIndex : (wo.currentStepIndex || 0);
  const recipeLen = (wo) => { const r = resolveRecipe(recipes, wo.recipe); return (r && r.steps && r.steps.length) || 0; };

  // Advance the SMALL-PARTS stream one coat. Pole tasks are untouched — they belong to the pole
  // stream. When BOTH streams are past the last step, the order completes (currentPhase Complete
  // → it enters the WMS packing queue) and the sled frees either way.
  const finalizePartsAdvance = async (wo) => {
      const len = recipeLen(wo);
      const nextParts = (wo.currentStepIndex || 0) + 1;
      const polesFinished = !woHasPoles(wo) || poleIdxOf(wo) >= len;
      const updates = {
          currentStepIndex: nextParts,
          lastCoatTime: Date.now(),
          "tasks.spinSetup.status": "Pending",
          "tasks.spinSpray.status": "Pending",
          "tasks.spinBake.status": "Pending",
          "tasks.hand.status": "Pending",
      };
      if (nextParts >= len) {
          updates.machineAssigned = null; // parts are off the sled — free it for the next order
          if (polesFinished) { updates.currentPhase = 'Complete'; updates.stepStatus = 'Complete'; updates.completedAt = Date.now(); }
      }
      await updateDoc(doc(db,"fin_workorders", wo.id), updates);
  };
  // FINAL-STEP QC GATE (Stuart 2026-07-20 — restored): completing the order's LAST step first
  // asks good-vs-scrap (QcModal): stock builds record completedParts/scrapReported (the NetSuite
  // completion posts the GOOD count), and a custom sales order with ANY scrap is redline-BLOCKED
  // with the supervisor alerted. The order only completes after QC passes.
  const handleCompleteRecipeStep = async (wo) => {
      const len = recipeLen(wo);
      const nextParts = (wo.currentStepIndex || 0) + 1;
      const polesFinished = !woHasPoles(wo) || poleIdxOf(wo) >= len;
      if (nextParts >= len && polesFinished && setQcModal) {
          setQcModal({ id: wo.id, parts: wo.totalParts || 0, taskType: null, onPassed: () => finalizePartsAdvance(wo) });
          return;
      }
      await finalizePartsAdvance(wo);
  };

  // Advance the POLE stream one coat (its own pointer). Completes the order when parts are
  // already done too — through the same final QC gate.
  const finalizePoleAdvance = async (wo) => {
      const len = recipeLen(wo);
      const next = poleIdxOf(wo) + 1;
      const partsFinished = (wo.currentStepIndex || 0) >= len;
      const updates = {
          poleStepIndex: next,
          lastPoleCoatTime: Date.now(),
          "tasks.poleSpray.status": "Pending",
          "tasks.poleBake.status": "Pending",
      };
      if (next >= len && partsFinished) { updates.currentPhase = 'Complete'; updates.stepStatus = 'Complete'; updates.completedAt = Date.now(); }
      await updateDoc(doc(db,"fin_workorders", wo.id), updates);
  };
  const handleCompletePoleStep = async (wo) => {
      const len = recipeLen(wo);
      const next = poleIdxOf(wo) + 1;
      const partsFinished = (wo.currentStepIndex || 0) >= len;
      if (next >= len && partsFinished && setQcModal) {
          setQcModal({ id: wo.id, parts: wo.totalParts || 0, taskType: null, onPassed: () => finalizePoleAdvance(wo) });
          return;
      }
      await finalizePoleAdvance(wo);
  };

  // FORCE OVEN CLEAR (Stuart 2026-07-20): a bake left 'Running' (often on a ghost WO whose cards
  // no longer render) pins the oven and blocks both stations. This resets every Running bake back
  // to PENDING — nothing is marked complete (so no NetSuite completion fires); restart the bake
  // when the parts are really in the oven.
  const forceOvenClear = async () => {
      const stuck = [];
      workOrders.forEach(w => {
          const t = w.tasks || {};
          if (t.spinBake?.status === 'Running') stuck.push({ id: w.id, field: 'spinBake' });
          if (t.poleBake?.status === 'Running') stuck.push({ id: w.id, field: 'poleBake' });
      });
      if (!stuck.length) return alert('The oven is not running anything — already clear.');
      if (!window.confirm(`⚠ FORCE-CLEAR THE OVEN?\n\nRunning bake cycles found:\n${stuck.map(s => `  • ${s.field} on ${s.id}`).join('\n')}\n\nThey reset to PENDING — nothing is marked complete, restart the bake when ready.`)) return;
      try {
          for (const s of stuck) {
              await updateDoc(doc(db, "fin_workorders", s.id), { [`tasks.${s.field}.status`]: 'Pending', [`tasks.${s.field}.forceClearedAt`]: Date.now(), [`tasks.${s.field}.forceClearedBy`]: user?.name || '' });
          }
          alert(`✅ Oven cleared — ${stuck.length} bake cycle(s) reset to Pending.`);
      } catch (e) { alert('Force clear failed: ' + (e.message || e)); }
  };

  // ✔ FORCE COMPLETE → PACKING (Stuart 2026-07-25): a work order can strand on the floor with
  // steps still Pending (a card that never rendered, a bake that was run off-app, a stock build
  // already assembled in NetSuite by hand). This supervisor override marks every step Complete,
  // frees the sled and stamps currentPhase 'Complete' — which is exactly what the WMS PACKING
  // queue reads (PickPackApp: currentPhase === 'Complete' && packStatus !== 'Packed'), so the
  // order appears there immediately. No scan, no QC, no timing — it is the exception path.
  //
  // THE NETSUITE FORK (this is the part that matters): the onStockBuildDone trigger fires on any
  // fin_workorders write where orderType 'stock' + nsWoId + bake Complete + !nsCompletionQueued,
  // and enqueues the WO-linked assembly build. So for a WO that is ALREADY built in NetSuite we
  // write nsCompletionQueued:true in the SAME atomic update as the completion — the trigger reads
  // the after-state, sees the stamp and returns early, so nothing double-posts. For a WO that
  // still needs its build we simply omit the stamp and let that proven server path do the work
  // (it looks up the receive bin itself) — no duplicate NetSuite payload lives here.
  const forceCompleteToPacking = async (wo) => {
      const len = recipeLen(wo);
      const t = wo.tasks || {};
      const pend = [['Sled Setup', t.spinSetup], ['Sled Spray', t.spinSpray], ['Sled Bake', t.spinBake],
          ...(woHasPoles(wo) ? [['Pole Spray', t.poleSpray], ['Pole Bake', t.poleBake]] : []), ['Hand Finish', t.hand]]
          .filter(([, task]) => (task?.status || 'Pending') !== 'Complete').map(([label]) => label);
      const isStockBuild = wo.orderType === 'stock' && !!wo.nsWoId;
      const alreadyHandled = !!(wo.nsCompletionQueued || wo.nsWoCompletionPosted);

      if (!window.confirm(
          `✔ FORCE COMPLETE — ${woRef(wo)}?\n\n` +
          `${wo.stockErpId || wo.type || 'Order'} · ${wo.totalParts || 0} pcs${wo.recipe ? ` · ${wo.recipe}` : ''}\n` +
          `${pend.length ? `Still pending: ${pend.join(', ')}` : 'All steps already complete'}\n\n` +
          `Every step is marked Complete, the sled is freed, and the order goes STRAIGHT TO THE WMS PACKING QUEUE.\n\n` +
          `Supervisor override — nothing is scanned, QC'd or timed.`)) return;

      // NetSuite question — only for a stock build that hasn't already queued/posted its completion.
      let blockNsPost = true;
      if (isStockBuild && !alreadyHandled) {
          blockNsPost = window.confirm(
              `Is ${wo.nsWoTran || wo.nsWoId} ALREADY BUILT in NetSuite?\n\n` +
              `OK  = YES, already built → the app posts NOTHING (use this for a WO you built in NetSuite yourself).\n\n` +
              `CANCEL = NO, not built yet → the app queues the assembly build now (watch HQ 11.1 → NetSuite Sync Queue).`);
      }

      const updates = {
          currentPhase: 'Complete', stepStatus: 'Complete', completedAt: Date.now(),
          currentStepIndex: len || (wo.currentStepIndex || 0),
          machineAssigned: null,
          "tasks.spinSetup.status": "Complete", "tasks.spinSpray.status": "Complete", "tasks.spinBake.status": "Complete",
          "tasks.hand.status": "Complete",
          forceCompletedAt: Date.now(), forceCompletedBy: user?.name || '',
          forceCompleteNsBuildSkipped: isStockBuild ? blockNsPost : null,
      };
      if (woHasPoles(wo)) {
          updates.poleStepIndex = len || poleIdxOf(wo);
          updates["tasks.poleSpray.status"] = "Complete";
          updates["tasks.poleBake.status"] = "Complete";
      }
      // Same write as the completion — the trigger reads the after-state, so the stamp always wins.
      if (blockNsPost) updates.nsCompletionQueued = true;

      try {
          await updateDoc(doc(db, "fin_workorders", wo.id), updates);
          setViewWo(null);
          alert(`✅ ${woRef(wo)} marked COMPLETE — it is now in the WMS Packing queue.\n\n` +
              (isStockBuild
                  ? (blockNsPost ? 'No NetSuite build was posted (already built).' : 'The NetSuite assembly build was queued — check HQ 11.1 → NetSuite Sync Queue.')
                  : 'Custom order — NetSuite is handled by the sales-order fulfillment, not here.'));
      } catch (e) { alert('Force complete failed: ' + (e.message || e)); }
  };

  // ===== MANUAL STATION CONTROLS (Stuart 2026-07-20) =====
  // The machines aren't fully dialed in yet, so operators need direct start/stop/complete on
  // whatever job sits at a station — tap the RED/BLUE sled, the OVEN, the POLE RACK or the HAND
  // zone on the twin. EVERY tap is logged to fin_logs (cat 'manual') with station, task, WO,
  // operator and — on stop/complete — the measured elapsed minutes, so real step timings can be
  // learned from this period and fed back into the time matrix.
  const [stationCtl, setStationCtl] = useState(null);   // 'RED' | 'BLUE' | 'OVEN' | 'POLES' | 'HAND'
  const [manualRecent, setManualRecent] = useState([]);
  const loadManualRecent = async () => {
      try {
          // Only manual entries carry the numeric `at` field, so orderBy('at') returns exactly them.
          const s = await getDocs(query(collection(db, 'fin_logs'), orderBy('at', 'desc'), limit(40)));
          setManualRecent(s.docs.map(d => d.data()).filter(x => x.cat === 'manual').slice(0, 12));
      } catch (e) { setManualRecent([]); }
  };
  const openStation = (st) => { setStationCtl(st); loadManualRecent(); };
  const logManual = async (entry) => {
      try {
          await addDoc(collection(db, 'fin_logs'), { u: user?.name || 'Floor', cat: 'manual', t: serverTimestamp(), at: Date.now(), ...entry });
      } catch (e) { console.warn('manual log failed', e); }
  };
  const manualTask = async (wo, taskKey, action, actor) => {
      const t = (wo.tasks || {})[taskKey] || {};
      const startedMs = t.startTime || null;
      const elapsedMs = (action !== 'START' && t.status === 'Running' && startedMs) ? (Date.now() - startedMs) : null;
      const updates = { [`tasks.${taskKey}.manual`]: true };
      if (action === 'START') {
          updates[`tasks.${taskKey}.status`] = 'Running';
          updates[`tasks.${taskKey}.startTime`] = Date.now();
          updates[`tasks.${taskKey}.assignedTo`] = actor || t.assignedTo || user?.name || 'Manual';
      } else if (action === 'STOP') {
          updates[`tasks.${taskKey}.status`] = 'Pending';
      } else if (action === 'COMPLETE') {
          updates[`tasks.${taskKey}.status`] = 'Complete';
          updates[`tasks.${taskKey}.completedAt`] = Date.now();
          if (actor) updates[`tasks.${taskKey}.completedBy`] = actor;
      }
      try {
          await updateDoc(doc(db, 'fin_workorders', wo.id), updates);
          await logManual({
              ...(actor ? { u: actor } : {}),
              msg: `MANUAL ${action} · ${taskKey} · ${woRef(wo)} @ ${stationCtl || 'floor'}${elapsedMs != null ? ` · ran ${(elapsedMs / 60000).toFixed(1)}m` : ''}`,
              action, station: stationCtl || '', woId: wo.id, woRefNo: woRef(wo), task: taskKey,
              recipe: wo.recipe || '', stepIndex: wo.currentStepIndex || 0, poleStepIndex: poleIdxOf(wo),
              elapsedMs, startedAtMs: startedMs
          });
          loadManualRecent();
      } catch (e) { alert('Manual update failed: ' + (e.message || e)); }
  };

  // ===== MANUAL MODE (Stuart 2026-07-21) =====
  // The machines aren't online yet (only the oven), so the station-driven flow confuses the
  // crew. Manual mode is scan-first: find the cart, SCAN THE SETUP LABEL (barcode = the
  // staging orderKey), enter your PIN, and step through the recipe — Start/Complete per task,
  // coat by coat. The machine view (twin + stations) collapses out of the way until real.
  const [machineViewOpen, setMachineViewOpen] = useState(false);
  const [manualScan, setManualScan] = useState('');
  const [manualWoId, setManualWoId] = useState(null);
  const manualWo = activeWOs.find(w => w.id === manualWoId) || null;
  const finUsersRef = useRef(null);
  // PIN check: fin_users carries the chip PINs (the directory projection is PIN-free by
  // design). Fetched once, matched on pin/chip fields or the doc id (chip docs are often
  // keyed by their pin).
  const pinActor = async () => {
      const pin = window.prompt('Enter your PIN (chip #):');
      if (pin == null) return null;
      const p = String(pin).trim();
      if (!p) return null;
      try {
          if (!finUsersRef.current) {
              const s = await getDocs(collection(db, 'fin_users'));
              finUsersRef.current = s.docs.map(d => ({ id: d.id, ...d.data() }));
          }
      } catch (e) { finUsersRef.current = finUsersRef.current || []; }
      const pool = [...(finUsersRef.current || []), ...(users || [])];
      const hit = pool.find(u => [u.pin, u.chipPin, u.chip, u.id].some(v => v != null && String(v).trim() === p));
      if (!hit) { alert('PIN not recognized — check the finishing user chips (Users tab).'); return null; }
      return hit.name || String(hit.id);
  };
  const resolveManualScan = () => {
      const s = String(manualScan || '').trim().toUpperCase();
      if (!s) return;
      const hit = activeWOs.find(w => [w.orderKey, w.salesOrderId, w.soNum, w.nsWoTran, w.displayId, w.woNum, w.id]
          .some(k => k && String(k).trim().toUpperCase() === s));
      setManualScan('');
      if (!hit) return alert(`No ACTIVE job matches "${s}".\n\nIs the order staged to the floor yet? (Setup Queue → Stage to Floor)`);
      setManualWoId(hit.id);
  };
  // The single next action for the PARTS stream on the current coat.
  const nextPartsAction = (wo) => {
      const r = resolveRecipe(recipes, wo.recipe);
      const len = (r && r.steps && r.steps.length) || 0;
      const idx = wo.currentStepIndex || 0;
      if (!len || idx >= len) return null; // parts done (order completes when poles catch up)
      const step = r.steps[idx];
      const t = wo.tasks || {};
      if (step.app === 'Hand Applied') {
          if (t.hand?.status === 'Running') return { key: 'hand', action: 'COMPLETE', label: '✓ Complete Hand Finish', running: t.hand };
          if (t.hand?.status !== 'Complete') return { key: 'hand', action: 'START', label: '▶ Start Hand Finish' };
          return { advance: true, label: idx + 1 >= len ? '✓ Final Coat Done — QC & Complete' : `→ Coat Done — Advance to Coat ${idx + 2}` };
      }
      const seq = [['spinSetup', 'Sled Setup'], ['spinSpray', 'Spray Coat'], ['spinBake', 'Bake (oven)']];
      for (const [key, label] of seq) {
          const st = t[key]?.status;
          if (st === 'Running') return { key, action: 'COMPLETE', label: `✓ Complete ${label}`, running: t[key] };
          if (st !== 'Complete') return { key, action: 'START', label: `▶ Start ${label}` };
      }
      return { advance: true, label: idx + 1 >= len ? '✓ Final Coat Done — QC & Complete' : `→ Unload — Advance to Coat ${idx + 2}` };
  };
  const nextPoleAction = (wo) => {
      if (!woHasPoles(wo)) return null;
      const len = recipeLen(wo);
      const idx = poleIdxOf(wo);
      if (!len || idx >= len) return null;
      const t = wo.tasks || {};
      if (t.poleSpray?.status !== 'Complete') {
          if (t.poleSpray?.status === 'Running') return { key: 'poleSpray', action: 'COMPLETE', label: '✓ Complete Pole Spray', running: t.poleSpray };
          return { key: 'poleSpray', action: 'START', label: '▶ Start Pole Spray' };
      }
      if (t.poleBake?.status !== 'Complete') {
          if (t.poleBake?.status === 'Running') return { key: 'poleBake', action: 'COMPLETE', label: '✓ Complete Pole Bake', running: t.poleBake };
          return { key: 'poleBake', action: 'START', label: '▶ Start Pole Bake' };
      }
      return { advance: true, label: idx + 1 >= len ? '✓ Poles Finished' : `→ Poles — Next Coat ${idx + 2}` };
  };
  const runManualAction = async (wo, act, stream) => {
      const actor = await pinActor();
      if (!actor) return;
      if (act.advance) {
          await logManual({ u: actor, msg: `MANUAL ADVANCE (${stream}) · ${woRef(wo)} · coat ${(stream === 'poles' ? poleIdxOf(wo) : wo.currentStepIndex || 0) + 1}`, action: 'ADVANCE', station: 'MANUAL', woId: wo.id, woRefNo: woRef(wo), task: stream, recipe: wo.recipe || '' });
          if (stream === 'poles') await handleCompletePoleStep(wo); else await handleCompleteRecipeStep(wo);
      } else {
          await manualTask(wo, act.key, act.action, actor);
      }
  };
  // PER-STEP MANUAL CONTROLS (Stuart 2026-07-28: "i need a manual step to start and stop every
  // step in the recipe, they are currently getting hung up as pending in between").
  // Manual mode used to offer ONE button — whatever the engine decided came next — so a job whose
  // real state didn't match that guess (hand finished before the sled steps, a task stopped
  // mid-coat) had no way forward and sat Pending. Now EVERY task in the coat carries its own
  // PIN'd control:
  //   Pending  → ▶ Start
  //   Running  → ■ Stop  = the step RAN and is DONE (elapsed minutes logged) — this is the bit
  //                        that keeps things moving; the old Stop dropped it back to Pending,
  //                        which is precisely how jobs got stuck.
  //   Complete → ✓ with ↺ to put a mis-tap back to Pending.
  // The coat-advance button is unchanged and still runs the final-coat QC gate.
  const manualStepBtn = (wo, key, label) => {
      const tk = (wo.tasks || {})[key] || {};
      const st = tk.status || 'Pending';
      const mins = (st === 'Running' && tk.startTime) ? Math.floor((now - tk.startTime) / 60000) : null;
      const run = async (action) => { const a = await pinActor(); if (a) await manualTask(wo, key, action, a); };
      const base = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', cursor: 'pointer', padding: '9px 12px' };
      return (
          <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', border: '1px solid var(--line)', padding: '4px 6px', background: st === 'Complete' ? '#f0f7f1' : (st === 'Running' ? '#fdf8ef' : '#fff') }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.06em' }}>{label}</span>
              {st === 'Running' && mins !== null && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--brass)' }}>{mins}m</span>}
              {st === 'Pending' && <button onClick={() => run('START')} style={{ ...base, background: 'var(--ink)', color: '#fff', border: 'none' }}>▶ Start</button>}
              {st === 'Running' && <button onClick={() => run('COMPLETE')} title="The step ran and is done — logs the elapsed time" style={{ ...base, background: 'var(--brass)', color: '#fff', border: 'none' }}>■ Stop</button>}
              {st === 'Complete' && (
                  <>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#3a7d44' }}>✓</span>
                      <button onClick={() => run('STOP')} title="Mis-tap? Put this step back to Pending" style={{ ...base, padding: '6px 8px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)' }}>↺</button>
                  </>
              )}
          </span>
      );
  };
  // ===== END MANUAL MODE =====
  // Which WO tasks a station's panel controls.
  const stationTargets = (st) => {
      const out = [];
      const pushT = (wo, key, label) => { if (wo && wo.tasks && wo.tasks[key]) out.push({ wo, key, label }); };
      if (st === 'RED' || st === 'BLUE') {
          const wo = st === 'RED' ? redWO : blueWO;
          pushT(wo, 'spinSetup', 'Sled Setup'); pushT(wo, 'spinSpray', 'Spray Coat'); pushT(wo, 'spinBake', 'Bake (oven)');
      } else if (st === 'OVEN') {
          activeWOs.forEach(wo => { pushT(wo, 'spinBake', 'Sled Bake'); if (woHasPoles(wo)) pushT(wo, 'poleBake', 'Pole Bake'); });
      } else if (st === 'POLES') {
          activeWOs.filter(woHasPoles).forEach(wo => { pushT(wo, 'poleSpray', 'Pole Spray'); pushT(wo, 'poleBake', 'Pole Bake'); });
      } else if (st === 'HAND') {
          activeWOs.forEach(wo => pushT(wo, 'hand', 'Hand Finish'));
      }
      return out;
  };

  const colorGroups = {};
  activeWOs.forEach(wo => {
      const r = resolveRecipe(recipes, wo.recipe);
      if (!r || !r.steps || r.steps.length <= wo.currentStepIndex) return;
      const step = r.steps[wo.currentStepIndex];
      if (!colorGroups[step.color]) colorGroups[step.color] = [];
      colorGroups[step.color].push({ wo, step });
  });
  // Pole stream groups by the POLE pointer's step color — an order's poles can be a coat (or a
  // color) behind its small parts, and each shows under its own batch.
  const poleGroups = {};
  activeWOs.forEach(wo => {
      if (!woHasPoles(wo)) return;
      const r = resolveRecipe(recipes, wo.recipe);
      const idx = poleIdxOf(wo);
      if (!r || !r.steps || idx >= r.steps.length) return;
      const step = r.steps[idx];
      if (!poleGroups[step.color]) poleGroups[step.color] = [];
      poleGroups[step.color].push({ wo, step });
  });
  const batchColors = Array.from(new Set([...Object.keys(colorGroups), ...Object.keys(poleGroups)]));

  const getRemainingMins = (timestampMs, totalMinsAllowed) => Math.max(0, Math.floor(((totalMinsAllowed * 60000) - (now - timestampMs)) / 60000));

  const busyOperators = activeJobs.map(job => {
      let runningTask = Object.values(job.tasks).find(t => t.status === 'Running');
      return runningTask?.assignedTo;
  });

  const getAiRecommendation = (taskType) => {
      if (!users || users.length === 0) return "Pending";
      let eligible = users.filter(u => {
          if (taskType.includes('spin')) return ['painter', 'hand_painter', 'paint_manager'].includes(u.role);
          if (taskType.includes('pole')) return ['painter', 'paint_manager'].includes(u.role);
          if (taskType === 'hand') return ['hand_painter', 'paint_manager'].includes(u.role);
          return false;
      });

      let available = eligible.filter(u => !busyOperators.includes(u.name));
      if (available.length === 0) return "NO OP AVAILABLE";
      available.sort((a, b) => {
          if (a.role === 'paint_manager' && b.role !== 'paint_manager') return 1;
          if (b.role === 'paint_manager' && a.role !== 'paint_manager') return -1;
          return 0;
      });
      return available[0].name;
  };

  return (
    <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '30px', minHeight: '100vh', fontFamily: 'var(--sans)' }}>
      
      {/* LEFT: PIPELINE */}
      <div>
        {/* 🖐 MANUAL MODE — scan-first while the machines are offline (only the oven runs). */}
        <div style={{ background: '#fff', border: '1px solid var(--line)', marginBottom: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '20px 30px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Manual mode · find the cart → scan the setup label → PIN → run the steps</span>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>🖐 Manual Floor Control</span>
                </div>
                <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input autoFocus value={manualScan} onChange={e => setManualScan(e.target.value)} onKeyDown={e => e.key === 'Enter' && resolveManualScan()} placeholder="SCAN SETUP LABEL…" style={{ padding: '12px 14px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '1rem', outline: 'none', width: '260px', textTransform: 'uppercase' }} />
                    <button onClick={resolveManualScan} style={{ padding: '12px 18px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Find Job</button>
                </span>
            </div>
            {manualWo ? (() => {
                const r = resolveRecipe(recipes, manualWo.recipe);
                const len = (r && r.steps && r.steps.length) || 0;
                const idx = manualWo.currentStepIndex || 0;
                const step = len && idx < len ? r.steps[idx] : null;
                const pAct = nextPartsAction(manualWo);
                const poAct = nextPoleAction(manualWo);
                // (status chips + elapsed now live inside manualStepBtn, which also carries the controls)
                return (
                    <div style={{ padding: '20px 30px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap', marginBottom: '6px' }}>
                            <span onClick={() => setViewWo(manualWo)} title={`${manualWo.id} — tap for full details`} style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 600, color: 'var(--ink)', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--line)' }}>{woRef(manualWo)}</span>
                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)' }}>{manualWo.stockErpId || manualWo.type || ''} ×{manualWo.totalParts || 0} · {manualWo.recipe || ''}</span>
                            <button onClick={() => setManualWoId(null)} style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '8px 14px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>✕ Done — scan next</button>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '14px' }}>
                            {step ? `COAT ${idx + 1} OF ${len} — ${step.color} (${step.app})` : `PARTS DONE (${len}/${len})`}{manualWo.customerName ? ` · ${manualWo.customerName}` : ''}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--line)', marginBottom: '10px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink)', width: '92px' }}>Small parts</span>
                            {/* Every step of this coat, each with its own PIN'd Start / Stop — no
                                waiting on the engine's single "next" guess. */}
                            {step && step.app !== 'Hand Applied'
                                ? [manualStepBtn(manualWo, 'spinSetup', 'Setup'), manualStepBtn(manualWo, 'spinSpray', 'Spray'), manualStepBtn(manualWo, 'spinBake', 'Bake')]
                                : (step ? manualStepBtn(manualWo, 'hand', 'Hand') : null)}
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                                {pAct && pAct.advance
                                    ? <button onClick={() => runManualAction(manualWo, pAct, 'parts')} style={{ padding: '12px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{pAct.label}</button>
                                    : !pAct ? <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#3a7d44' }}>✓ parts complete</span>
                                    : <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>finish the steps to advance the coat</span>}
                            </span>
                        </div>
                        {woHasPoles(manualWo) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '12px 14px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink)', width: '92px' }}>Poles</span>
                                {manualStepBtn(manualWo, 'poleSpray', 'Spray')}{manualStepBtn(manualWo, 'poleBake', 'Bake')}
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>coat {Math.min(poleIdxOf(manualWo) + 1, len || 1)}/{len || 1}</span>
                                <span style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                                    {poAct && poAct.advance
                                        ? <button onClick={() => runManualAction(manualWo, poAct, 'poles')} style={{ padding: '12px 20px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{poAct.label}</button>
                                        : !poAct ? <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#3a7d44' }}>✓ poles complete</span>
                                        : <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>finish the steps to advance the coat</span>}
                                </span>
                            </div>
                        )}
                    </div>
                );
            })() : (
                <div style={{ padding: '20px 30px', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                    Scan the setup label from the cart (or type the WO #) — the job opens here with its next step ready. The pipeline order is on the right.
                </div>
            )}
        </div>

        {/* MACHINE VIEW — collapsed while the machines are offline; the oven stays reachable. */}
        <div style={{ marginBottom: '30px' }}>
            <div onClick={() => setMachineViewOpen(!machineViewOpen)} style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{machineViewOpen ? '▾' : '▸'} Machine View — twin + station cards (machines not fully online)</span>
                <button onClick={(e) => { e.stopPropagation(); forceOvenClear(); }} style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', background: 'transparent', border: '1px solid #d9534f', padding: '5px 10px', borderRadius: '2px', cursor: 'pointer' }}>⚠ Force Oven Clear</button>
            </div>
            {machineViewOpen && <div style={{ marginTop: '16px' }}><DigitalTwinSCADA redWO={redWO} blueWO={blueWO} activeWOs={activeWOs} onForceClear={forceOvenClear} onStation={openStation} /></div>}
        </div>

        {redlineWOs.length > 0 && (
            <div style={{ background: '#fdf2f2', border: '1px solid #d9534f', padding: '24px', marginBottom: '30px', borderRadius: '2px' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', fontWeight: 500 }}>
                    Supervisor Action Required
                </div>
                <ul style={{ margin: '12px 0 0 20px', fontSize: '0.95rem', color: 'var(--ink)' }}>
                    {redlineWOs.map(w => <li key={w.id}>{w.redlineAlert}</li>)}
                </ul>
            </div>
        )}

        {machineViewOpen && batchColors.length === 0 && <div style={{ padding: '40px', background: 'var(--paper)', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '1.2rem', marginBottom: '30px' }}>No batches actively painting.</div>}

        {machineViewOpen && batchColors.map(color => {
            let potRemMins = null;
            let potBg = 'var(--ink)'; let potColor = '#fff';
            if (activePots[color]) {
                potRemMins = getRemainingMins(activePots[color], cfg.potLifeMins);
                if (potRemMins <= 5) { potBg = '#d9534f'; potColor = '#fff'; }
                else if (potRemMins <= 15) { potBg = 'var(--brass)'; potColor = '#fff'; }
            }

            return (
                <div key={color} style={{ background: '#fff', border: '1px solid var(--line)', marginBottom: '30px', padding: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid var(--line)', paddingBottom: '16px' }}>
                        <div>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Active Batch</span>
                            <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>{color}</h3>
                        </div>
                        {activePots[color] ? (
                            <span style={{ background: potBg, color: potColor, padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Pot Life: {potRemMins} mins left</span>
                        ) : (
                            <button onClick={() => setMixModal(color)} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                                Start {cfg.mixMins} Min Mix
                            </button>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                        
                        {/* --- STATION 1 (RIGHT): SETUP & SPRAY --- */}
                        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Station 1 (Right) - Spray</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || !item.wo.machineAssigned) return null; 
                                const location = getSledLocation(item.wo.machineAssigned);
                                if (location !== 'RIGHT') return null; 

                                const isSetupComplete = item.wo.tasks?.spinSetup?.status === 'Complete';
                                const isSprayComplete = item.wo.tasks?.spinSpray?.status === 'Complete';

                                const blockSpray = machineState.ovenPos === 'SPINDLE' && machineState.isOvenRunning;

                                if (!isSetupComplete) {
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. Setup Parts" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} />
                                } else if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"spinSpray"} titleOverride="2. Spray Coat" wo={item.wo} type="spinSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={cfg.spinPaintMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('spinSpray')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSpray ? "Waiting on Station 2 Oven" : null} />
                                } else if (item.wo.tasks?.spinBake?.status === 'Complete') {
                                    // Fully baked but parked at the RIGHT spot (manual completes can do
                                    // this) — without this card the WO dead-ends on "Ready for track
                                    // cycle" with no way to advance (WO11311, 2026-07-21).
                                    return (
                                        <div key={item.wo.id} style={{ ...cardStyle, background: 'var(--paper-2)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}>Coat Complete</div>
                                            <button onClick={() => {
                                                if (!woHasPoles(item.wo)) return handleCompleteRecipeStep(item.wo);
                                                const len = recipeLen(item.wo);
                                                const pIdx = poleIdxOf(item.wo);
                                                const polesCaughtUp = pIdx >= len || pIdx > item.wo.currentStepIndex || (pIdx === item.wo.currentStepIndex && item.wo.tasks?.poleBake?.status === 'Complete');
                                                if (polesCaughtUp || window.confirm(`Poles for this order are still on coat ${pIdx + 1} of ${len}.\n\nAdvance the SMALL PARTS anyway? Poles keep moving on their own track.`)) handleCompleteRecipeStep(item.wo);
                                            }} style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Unload Parts</button>
                                        </div>
                                    );
                                } else {
                                    return <div key={item.wo.id} style={{ ...cardStyle, background: 'var(--paper-2)', textAlign: 'center', fontSize: '0.9rem', color: 'var(--ink)', fontFamily: 'var(--sans)' }}>Ready for track cycle</div>
                                }
                            })}
                        </div>

                        {/* --- STATION 2 (LEFT): SETUP & BAKE --- */}
                        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Station 2 (Left) - Oven</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || !item.wo.machineAssigned) return null; 
                                const location = getSledLocation(item.wo.machineAssigned);
                                if (location !== 'LEFT') return null;

                                const isSetupComplete = item.wo.tasks?.spinSetup?.status === 'Complete';
                                const isBakeComplete = item.wo.tasks?.spinBake?.status === 'Complete';

                                const blockSetup = machineState.ovenPos === 'SPINDLE';
                                const blockBake = machineState.ovenPos === 'POLES';

                                if (!isSetupComplete) {
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. Setup Parts" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSetup ? "Oven is blocking station" : null} />
                                } else if (!isBakeComplete) {
                                    return <TaskCard key={item.wo.id+"spinBake"} titleOverride="2. Bake Cycle" wo={item.wo} type="spinBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('spinBake')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockBake ? "Oven is at pole rack" : null} />
                                } else {
                                    return (
                                        <div key={item.wo.id} style={{ ...cardStyle, background: 'var(--paper-2)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}>Baking Complete</div>
                                            <button onClick={() => {
                                                // Poles never gate the small parts (Stuart 2026-07-20): batching the
                                                // two together is the ideal, so we SUGGEST — but each moves on its own.
                                                if (!woHasPoles(item.wo)) return handleCompleteRecipeStep(item.wo);
                                                const len = recipeLen(item.wo);
                                                const pIdx = poleIdxOf(item.wo);
                                                const polesCaughtUp = pIdx >= len || pIdx > item.wo.currentStepIndex || (pIdx === item.wo.currentStepIndex && item.wo.tasks?.poleBake?.status === 'Complete');
                                                if (polesCaughtUp || window.confirm(`Poles for this order are still on coat ${pIdx + 1} of ${len}.\n\nAdvance the SMALL PARTS anyway? Poles keep moving on their own track (painting them together is ideal, not required).`)) handleCompleteRecipeStep(item.wo);
                                            }} style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Unload Parts</button>
                                        </div>
                                    )
                                }
                            })}
                        </div>

                        {/* --- POLE RACK / CUSTOM --- */}
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Pole Rack — own track</div>
                            {(poleGroups[color] || []).map(item => {
                                // Pole stream only (orders that actually HAVE poles), on the POLE step pointer.
                                const poleQty = Number(item.wo.totalPoles || (item.wo.poles && item.wo.poles.qty)) || Number(item.wo.totalParts) || 0;
                                const isSprayComplete = item.wo.tasks?.poleSpray?.status === 'Complete';
                                const isBakeComplete = item.wo.tasks?.poleBake?.status === 'Complete';
                                const blockBake = machineState.ovenPos === 'SPINDLE' && machineState.isOvenRunning;
                                const len = recipeLen(item.wo);
                                const idx = poleIdxOf(item.wo);

                                if (item.step.app !== 'Sprayed') {
                                    // Hand-applied coat in the pole stream — done off-rack; advance when finished.
                                    return (
                                        <div key={item.wo.id + 'poleHand'} style={{ ...cardStyle, textAlign: 'center' }}>
                                            <div onClick={() => setViewWo(item.wo)} title={`${item.wo.id} — tap for order details`} style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '6px', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--line)' }}>WO: {woRef(item.wo)}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '14px' }}>Poles · Step {item.step.step}: {item.step.color} (hand applied)</div>
                                            <button onClick={() => handleCompletePoleStep(item.wo)} style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{idx + 1 >= len ? 'Poles Finished' : 'Hand Coat Done → Next'}</button>
                                        </div>
                                    );
                                }
                                if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"poleSpray"} titleOverride={`Spray Poles (coat ${idx + 1}/${len})`} wo={item.wo} type="poleSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={poleQty * cfg.poleMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('poleSpray')} users={users} activeWOs={activeWOs} cfg={cfg} />
                                } else if (!isBakeComplete) {
                                    return <TaskCard key={item.wo.id+"poleBake"} titleOverride={`Bake Poles (coat ${idx + 1}/${len})`} wo={item.wo} type="poleBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('poleBake')} users={users} activeWOs={activeWOs} cfg={cfg} blockReason={blockBake ? "Oven busy curing a sled" : null} />
                                } else {
                                    return (
                                        <div key={item.wo.id + 'poleNext'} style={{ ...cardStyle, background: 'var(--paper-2)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}>Poles Baked — coat {idx + 1}/{len}</div>
                                            <button onClick={() => handleCompletePoleStep(item.wo)} style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{idx + 1 >= len ? 'Poles Finished — Unload' : 'Next Pole Coat →'}</button>
                                        </div>
                                    );
                                }
                            })}
                        </div>

                        {/* --- HAND FINISH OFF-RAMP --- */}
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', gridColumn: '1 / -1', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Hand Finish Station (Off-Track)</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                {colorGroups[color]?.map(item => item.step.app === 'Hand Applied' && item.wo.tasks?.hand?.status !== 'Complete' && (
                                    <TaskCard key={item.wo.id+"hand"} wo={item.wo} type="hand" step={item.step} user={user} setQcModal={setQcModal} estTime={item.wo.type === 'Poles' ? ((item.wo.totalParts || 0) * cfg.handPoleMins) : ((item.wo.totalParts || 0) * cfg.handSmallMins)} activePots={activePots} onViewWo={setViewWo} now={now} aiRec={getAiRecommendation('hand')} users={users} activeWOs={activeWOs} cfg={cfg} />
                                ))}
                            </div>
                        </div>

                    </div>
                </div>
            );
        })}
      </div>

      {/* RIGHT: LIVE ASSIGNMENTS */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
          <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>Live Operator Status</h3>
              {floorOps.length === 0 ? <p style={{color: 'var(--ink-soft)', fontSize: '0.9rem'}}>No floor operators in directory.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {floorOps.map(op => {
                      let activeOpJob = activeJobs.find(j => Object.values(j.tasks).some(t => t.status === 'Running' && t.assignedTo === op.name));
                      let isBusy = !!activeOpJob;
                      let statusText = 'IDLE';

                      if (isBusy) {
                          let runningTaskEntry = Object.entries(activeOpJob.tasks).find(([k, t]) => t.status === 'Running' && t.assignedTo === op.name);
                          let tType = runningTaskEntry[0];
                          let taskData = runningTaskEntry[1];

                          let taskEstTime = 0;
                          if (tType === 'spinSetup') taskEstTime = cfg.spinSetupMins;
                          if (tType === 'spinSpray') taskEstTime = cfg.spinPaintMins;
                          if (tType.includes('pole')) taskEstTime = (activeOpJob.totalParts || 0) * cfg.poleMins;
                          if (tType === 'hand') taskEstTime = activeOpJob.type === 'Poles' ? ((activeOpJob.totalParts || 0) * cfg.handPoleMins) : ((activeOpJob.totalParts || 0) * cfg.handSmallMins);

                          if (taskData.startTime) {
                              let elapsedMins = (now - taskData.startTime) / 60000;
                              let leftMins = Math.ceil(taskEstTime - elapsedMins);
                              if (leftMins >= 0) statusText = `BUSY (${leftMins}m left)`;
                              else statusText = `BUSY (Overdue ${Math.abs(leftMins)}m)`;
                          } else {
                              statusText = 'BUSY';
                          }
                      }

                      return (
                          <div key={op.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                              <div>
                                  <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.95rem' }}>{op.name}</div>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>{op.role.replace(/_/g, ' ')}</div>
                              </div>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: isBusy ? '#d9534f' : 'var(--ink-soft)' }}>
                                  {statusText}
                              </div>
                          </div>
                      );
                  })}
                  </div>
              )}
          </div>

          <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)', paddingBottom: '15px' }}>Pipeline Overview</h3>
              {activeWOs.length === 0 ? <p style={{color: 'var(--ink-soft)', fontSize: '0.9rem'}}>No active jobs in pipeline.</p> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {activeWOs.map(wo => {
                      let recoatWarning = null;
                      if (wo.lastCoatTime) {
                          const recoatMinsLeft = Math.max(0, Math.floor(((cfg.recoatMins * 60000) - (now - wo.lastCoatTime)) / 60000));
                          if (recoatMinsLeft < 30) recoatWarning = `Recoat Danger: ${recoatMinsLeft}m left`;
                      }
                      return (
                          <div key={wo.id} onClick={() => setViewWo(wo)} title={`${wo.id} — tap for order details`} style={{ border: '1px solid var(--line)', padding: '16px', background: 'var(--paper)', borderLeft: recoatWarning ? '2px solid #d9534f' : '2px solid var(--brass)', cursor: 'pointer' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.95rem' }}>WO: {woRef(wo)}</span>
                                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{wo.recipe}</span>
                              </div>
                              {recoatWarning && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: '#d9534f', marginTop: '8px' }}>{recoatWarning}</div>}
                          </div>
                      );
                  })}
                  </div>
              )}
          </div>
      </div>

      {/* 🎛 MANUAL STATION CONTROLS — tap a twin zone; every action is logged with timings. */}
      {stationCtl && (() => {
          const targets = stationTargets(stationCtl);
          const stTitle = { RED: 'RED Sled', BLUE: 'BLUE Sled', OVEN: 'Oven', POLES: 'Pole Rack', HAND: 'Hand Finish Bench' }[stationCtl] || stationCtl;
          const stChip = (st) => (
              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', fontWeight: 600, padding: '3px 8px', border: '1px solid var(--line)', color: st === 'Complete' ? '#3a7d44' : (st === 'Running' ? 'var(--brass)' : 'var(--ink-soft)'), background: st === 'Complete' ? '#f0f7f1' : (st === 'Running' ? '#fdf8ef' : '#fff') }}>{st || 'Pending'}</span>
          );
          const btn = (label, onClick, dark) => (
              <button onClick={onClick} style={{ padding: '9px 14px', background: dark ? 'var(--ink)' : 'transparent', color: dark ? '#fff' : 'var(--ink)', border: dark ? 'none' : '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em' }}>{label}</button>
          );
          return (
              <div onClick={() => setStationCtl(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                  <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '680px', maxWidth: '96vw', maxHeight: '92vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 12px 48px rgba(0,0,0,0.2)' }}>
                      <div style={{ padding: '18px 26px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                          <div>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Manual controls · every action is logged with times</span>
                              <span style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--ink)' }}>🎛 {stTitle}</span>
                          </div>
                          <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                              {stationCtl === 'OVEN' && <button onClick={() => { setStationCtl(null); forceOvenClear(); }} style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', background: 'transparent', border: '1px solid #d9534f', padding: '6px 10px', cursor: 'pointer' }}>⚠ Force Oven Clear</button>}
                              <button onClick={() => setStationCtl(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                          </span>
                      </div>
                      <div style={{ padding: '18px 26px' }}>
                          {targets.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>Nothing at this station right now.</div>}
                          {targets.map(({ wo, key, label }) => {
                              const t = (wo.tasks || {})[key] || {};
                              const running = t.status === 'Running';
                              const elapsed = running && t.startTime ? Math.floor((now - t.startTime) / 60000) : null;
                              return (
                                  <div key={wo.id + key} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderTop: '1px solid var(--paper-2)', flexWrap: 'wrap' }}>
                                      <div style={{ flex: 1, minWidth: '160px' }}>
                                          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--ink)' }}>{woRef(wo)}</div>
                                          <div style={{ fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{label} · {wo.stockErpId || wo.type || ''} · {wo.recipe || ''}{t.assignedTo ? ` · ${t.assignedTo}` : ''}</div>
                                      </div>
                                      {stChip(t.status)}
                                      {elapsed !== null && <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)' }}>{elapsed}m</span>}
                                      <span style={{ display: 'flex', gap: '8px' }}>
                                          {t.status !== 'Running' && t.status !== 'Complete' && btn('▶ Start', () => manualTask(wo, key, 'START'), true)}
                                          {running && btn('⏸ Stop', () => manualTask(wo, key, 'STOP'))}
                                          {t.status !== 'Complete' && btn('✓ Complete', () => manualTask(wo, key, 'COMPLETE'))}
                                          {t.status === 'Complete' && btn('↩ Reopen', () => manualTask(wo, key, 'STOP'))}
                                      </span>
                                  </div>
                              );
                          })}
                          {manualRecent.length > 0 && (
                              <div style={{ marginTop: '20px' }}>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '8px' }}>Recent manual actions (fin log · cat "manual")</div>
                                  {manualRecent.map((m, i) => (
                                      <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', padding: '3px 0' }}>
                                          {m.at ? new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · {m.u || ''} · {m.msg || ''}
                                      </div>
                                  ))}
                              </div>
                          )}
                      </div>
                  </div>
              </div>
          );
      })()}

      {/* 📋 ORDER DETAILS — read-only view+confirm popup; tap any job window to open. */}
      {viewWo && (() => {
          const wo = workOrders.find(w => w.id === viewWo.id) || viewWo;
          const len = recipeLen(wo);
          const hasP = woHasPoles(wo);
          const pIdx = poleIdxOf(wo);
          const t = wo.tasks || {};
          const chip = (label, st) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 10px', border: '1px solid var(--line)', background: st === 'Complete' ? '#f0f7f1' : (st === 'Running' ? '#fdf8ef' : '#fff') }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' }}>{label}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', fontWeight: 600, color: st === 'Complete' ? '#3a7d44' : (st === 'Running' ? 'var(--brass)' : 'var(--ink-soft)') }}>{st || 'Pending'}</span>
              </div>
          );
          const row = (k, v) => v ? <div style={{ display: 'flex', gap: '10px', fontSize: '0.9rem', lineHeight: 1.7 }}><span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', width: '110px', flexShrink: 0, paddingTop: '2px' }}>{k}</span><span style={{ color: 'var(--ink)' }}>{v}</span></div> : null;
          return (
              <div onClick={() => setViewWo(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                  <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '560px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 12px 48px rgba(0,0,0,0.2)' }}>
                      <div style={{ padding: '18px 26px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--ink)' }}>{woRef(wo)}</div>
                              {woRef(wo) !== wo.id && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '3px' }}>{wo.id}</div>}
                          </div>
                          <button onClick={() => setViewWo(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {row('NetSuite WO', wo.nsWoTran || wo.nsWoId || 'not posted yet')}
                          {row('Item', wo.stockErpId || wo.type || '')}
                          {row('Recipe', wo.recipe || '')}
                          {row('Quantity', `${wo.totalParts || 0} pcs${hasP ? ` · ${Number(wo.totalPoles || (wo.poles && wo.poles.qty)) || 0} pole(s)` : ''}`)}
                          {row('Customer', wo.customerName || wo.clientName || wo.customer || '')}
                          {row('Required', wo.reqDate || '')}
                          {row('Parts coat', len ? (wo.currentStepIndex >= len ? `done (${len}/${len})` : `${(wo.currentStepIndex || 0) + 1} of ${len}`) : '')}
                          {hasP && row('Poles coat', len ? (pIdx >= len ? `done (${len}/${len})` : `${pIdx + 1} of ${len}`) : '')}
                          {wo.convertSuggestion && row('⇄ Suggestion', `convert ${wo.convertSuggestion.qty} × ${wo.convertSuggestion.from} → ${wo.convertSuggestion.to} (Setup Queue converter)`)}
                          {row('Note', wo.note || '')}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '14px' }}>
                              {chip('Sled Setup', t.spinSetup?.status)}
                              {chip('Sled Spray', t.spinSpray?.status)}
                              {chip('Sled Bake', t.spinBake?.status)}
                              {hasP && chip('Pole Spray', t.poleSpray?.status)}
                              {hasP && chip('Pole Bake', t.poleBake?.status)}
                              {chip('Hand Finish', t.hand?.status)}
                          </div>
                          {/* ▶ OPEN IN MANUAL CONTROL (Stuart 2026-07-28: "we have a shortage of
                              scanners right now") — the scan at the top of Manual Floor Control is
                              just a way to pick the job; tapping it here does the same thing without
                              a scanner. The per-step Start/Stop controls (each still PIN'd) open up
                              top. Open to every operator — only Force Complete is supervisor-gated. */}
                          {activeWOs.some(w => w.id === wo.id) && (
                              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                                  <button onClick={() => { setManualWoId(wo.id); setViewWo(null); setMachineViewOpen(false); }}
                                      title="Load this job into Manual Floor Control — same as scanning its setup label"
                                      style={{ width: '100%', padding: '16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                      ▶ Open in Manual Control — Start Steps
                                  </button>
                                  <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textAlign: 'center', marginTop: '8px', letterSpacing: '.04em' }}>No scanner needed · step Start/Stop opens at the top of the screen</div>
                              </div>
                          )}

                          {/* Supervisor override — a stranded order (steps stuck Pending, or a stock
                              build already assembled in NetSuite) goes straight to WMS Packing. */}
                          {(() => {
                              const role = String(user?.role || '').toLowerCase().replace(/[^a-z]/g, '');
                              const canForce = user?.superAdmin === true || ['superadmin', 'admin', 'floormanager', 'paintmanager'].includes(role);
                              if (!canForce) return null;
                              const done = wo.currentPhase === 'Complete';
                              return (
                                  <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--line)' }}>
                                      <button onClick={() => forceCompleteToPacking(wo)} disabled={done}
                                          title={done ? 'This order is already complete — find it on the WMS Packing tab.' : 'Mark every step Complete and send this order to the WMS Packing queue. Asks first whether NetSuite is already built so nothing double-posts.'}
                                          style={{ width: '100%', padding: '14px', background: done ? 'var(--paper)' : 'var(--ink)', color: done ? 'var(--ink-soft)' : '#fff', border: '1px solid var(--line)', cursor: done ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                          {done ? '✓ Complete — waiting in WMS Packing' : '✔ Force Complete → Packing'}
                                      </button>
                                      {!done && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textAlign: 'center', marginTop: '8px', letterSpacing: '.04em' }}>Supervisor override · no scan, QC or timing · logged on the order</div>}
                                  </div>
                              );
                          })()}
                      </div>
                  </div>
              </div>
          );
      })()}
    </div>
  );
};

const TaskCard = ({ titleOverride, wo, type, step, user, setQcModal, estTime, activePots, now, aiRec, users, activeWOs, cfg, sled, blockReason, onViewWo }) => {
    const task = wo.tasks?.[type] || {}; 
    const isRunning = task.status === 'Running';
    
    const [manualOp, setManualOp] = useState("");
    const currentOp = manualOp || (aiRec === "NO OP AVAILABLE" ? "" : aiRec);

    const eligibleUsers = users?.filter(u => {
        const isAdminOrMgr = ['admin', 'floor_manager', 'paint_manager'].includes(u.role);
        if (type.includes('spin')) return isAdminOrMgr || ['painter', 'hand_painter'].includes(u.role);
        if (type.includes('pole')) return isAdminOrMgr || u.role === 'painter';
        if (type === 'hand') return isAdminOrMgr || u.role === 'hand_painter';
        return false;
    }) || [];

    const loggedInUserHasAccess = ['admin', 'floor_manager', 'paint_manager'].includes(user?.role) || 
                                  (user?.role === 'painter' && ['spinSetup', 'spinSpray', 'spinBake', 'poleSpray', 'poleBake'].includes(type)) || 
                                  (user?.role === 'hand_painter' && ['spinSetup', 'spinSpray', 'hand'].includes(type));

    let selectedOpManualLoad = 0;
    activeWOs.forEach(w => {
        if(w.tasks) {
            Object.entries(w.tasks).forEach(([tType, t]) => {
                if(t.status === 'Running' && t.assignedTo === currentOp && ['spinSetup', 'spinSpray', 'spinBake', 'poleSpray', 'poleBake', 'hand'].includes(tType)) {
                    selectedOpManualLoad++;
                }
            });
        }
    });

    const isSelectedOpBusy = selectedOpManualLoad >= 1;
    let recoatWarning = null;
    if (wo.lastCoatTime) {
        const recoatMinsLeft = Math.max(0, Math.floor(((cfg.recoatMins * 60000) - (now - wo.lastCoatTime)) / 60000));
        if (recoatMinsLeft < 30) recoatWarning = `Recoat: ${recoatMinsLeft}m left`;
        else recoatWarning = `Recoat window: ${recoatMinsLeft}m`;
    }

    const isPaintReady = !!activePots[step.color];
    const disabledStart = !loggedInUserHasAccess || !isPaintReady || !currentOp || isSelectedOpBusy || blockReason;
    
    let btnText = 'Start Task';
    if (!loggedInUserHasAccess) btnText = 'Role Restricted';
    else if (!isPaintReady) btnText = 'Awaiting Paint Mix';
    else if (!currentOp) btnText = 'No Op Available';
    else if (isSelectedOpBusy) btnText = `${currentOp} is Busy`;
    else if (blockReason) btnText = blockReason;

    // --- BAKING COUNTDOWN UI ---
    if (isRunning && type.includes('Bake')) {
        const rem = Math.max(0, Math.floor(((estTime * 60000) - (now - task.startTime)) / 60000));
        return (
            <div style={{ ...cardStyle, borderLeft: '2px solid var(--brass)', textAlign: 'center', background: '#fff' }}>
                <div onClick={() => onViewWo && onViewWo(wo)} title={`${wo.id} — tap for order details`} style={{ color: 'var(--ink)', fontWeight: 500, fontSize: '0.95rem', cursor: onViewWo ? 'pointer' : 'default', textDecoration: onViewWo ? 'underline' : 'none', textDecorationColor: 'var(--line)' }}>{woRef(wo)}</div>
                {sled && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>{sled} Station (Oven)</div>}
                <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: 'var(--ink)', margin: '16px 0' }}>{rem} mins</div>
                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' })} style={{ width: '100%', padding: '12px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Mark Dry Early</button>
            </div>
        );
    }

    return (
        <div style={{ ...cardStyle, border: isRunning ? '1px solid var(--ink)' : '1px solid var(--line)', position: 'relative', background: '#fff' }}>
            
            {titleOverride && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{titleOverride}</div>}

            {type.includes('spin') && sled && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '12px' }}>
                    {sled} Sled
                </div>
            )}

            <div onClick={() => onViewWo && onViewWo(wo)} title={`${wo.id} — tap for order details`} style={{ fontSize: '1.05rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '4px', cursor: onViewWo ? 'pointer' : 'default', textDecoration: onViewWo ? 'underline' : 'none', textDecorationColor: 'var(--line)' }}>WO: {woRef(wo)}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>Step {step.step}: {step.color}</div>
            
            {isRunning ? (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)', background: 'var(--paper-2)', padding: '8px', marginBottom: '16px', border: '1px solid var(--line)' }}>Active: {task.assignedTo}</div>
            ) : (
                <div style={{ marginBottom: '20px' }}>
                    <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Assign Operator</label>
                    <select value={currentOp} onChange={(e) => setManualOp(e.target.value)} style={{ ...inputStyle, padding: '10px' }}>
                        {aiRec !== "NO OP AVAILABLE" && <option value={aiRec}>AI Rec: {aiRec}</option>}
                        {eligibleUsers.map(u => {
                            if (u.name === aiRec) return null; 
                            return <option key={u.name} value={u.name}>{u.name} ({u.role.replace(/_/g, ' ')})</option>;
                        })}
                    </select>
                </div>
            )}
            
            {recoatWarning && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: recoatWarning.includes('Danger') ? '#d9534f' : 'var(--ink-soft)', marginBottom: '12px' }}>{recoatWarning}</div>}
            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '20px' }}>Est Time: {Math.ceil(estTime)} mins</div>
            
            {!isRunning ? (
                <button disabled={disabledStart} onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Running', [`tasks.${type}.assignedTo`]: currentOp, [`tasks.${type}.startTime`]: Date.now() })} style={{ width: '100%', padding: '12px', background: disabledStart ? 'var(--paper-2)' : 'var(--ink)', color: disabledStart ? 'var(--ink-soft)' : '#fff', border: disabledStart ? '1px solid var(--line)' : 'none', cursor: disabledStart ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>{btnText}</button>
            ) : (
                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' })} style={{ width: '100%', padding: '12px', background: 'var(--paper)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--paper-2)'} onMouseOut={e => e.currentTarget.style.background = 'var(--paper)'}>Complete Task</button>
            )}
        </div>
    )
}

export default ActiveFloor;