import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase';
import { doc, updateDoc } from "firebase/firestore";
import { resolveRecipe } from '../Shared/finishingTime';

const cardStyle = { background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column' };
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
// Where the (single, track-mounted) oven is, derived from production: slid LEFT over the pole rack
// when poles are baking, otherwise over whichever sled is curing, else parked off the sleds.
const ovenOverOf = (redWO, blueWO, activeWOs) => {
    if (activeWOs.some(w => w.tasks?.poleBake?.status === 'Running')) return 'POLES';
    if (redWO?.tasks?.spinBake?.status === 'Running') return 'RED';
    if (blueWO?.tasks?.spinBake?.status === 'Running') return 'BLUE';
    return 'PARKED';
};

// --- LIVE DIGITAL TWIN (production-driven) ---
// Fixed RED + BLUE sleds; the oven slides over the curing sled or off-left for poles. Everything is
// derived from the work orders' task state, so it animates as operators enter PINs for each step.
const DigitalTwinSCADA = ({ redWO, blueWO, activeWOs }) => {
    const ovenOver = ovenOverOf(redWO, blueWO, activeWOs);
    const redAct = sledActivity(redWO);
    const blueAct = sledActivity(blueWO);
    const ovenRunning = ovenOver !== 'PARKED';
    const ovenLeft = { POLES: '1%', RED: '34%', BLUE: '56%', PARKED: '80%' }[ovenOver];
    const ovenLabel = { POLES: 'Curing poles', RED: 'Curing RED', BLUE: 'Curing BLUE', PARKED: 'Parked' }[ovenOver];

    const Sled = ({ color, wo, act, under }) => {
        const accent = color === 'RED' ? 'var(--ink)' : 'var(--brass)';
        return (
            <div style={{ position: 'absolute', top: '36px', left: color === 'RED' ? '37%' : '59%', width: '13%', height: '86px', background: '#fff', border: `2px solid ${accent}`, borderRadius: '2px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '4px', zIndex: 10, boxShadow: act.running ? '0 0 0 3px rgba(176,141,87,0.30)' : (under ? '0 0 0 2px rgba(176,141,87,0.18)' : '0 4px 12px rgba(0,0,0,0.05)') }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: accent, fontWeight: 600 }}>{color}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--ink)', marginTop: '3px' }}>{act.label}</span>
                {wo && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', marginTop: '2px' }}>{wo.id}</span>}
            </div>
        );
    };

    return (
        <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', marginBottom: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '15px', marginBottom: '24px' }}>
                <h3 style={{ margin: 0, color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Live Digital Twin: Sleds & Oven</h3>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: ovenRunning ? 'var(--brass)' : 'var(--ink-soft)', border: '1px solid var(--line)', padding: '5px 10px', borderRadius: '2px' }}>
                    ● Live · {ovenLabel}
                </span>
            </div>

            <div style={{ position: 'relative', height: '160px', background: 'var(--paper)', border: '1px solid var(--line)', overflow: 'hidden' }}>
                {/* POLE RACK (far left — where the oven slides for long poles) */}
                <div style={{ position: 'absolute', left: '2%', top: '30px', width: '14%', height: '100px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: '5px', background: '#fff' }}>
                    <div style={{ height: '2px', background: 'var(--line)' }} />
                    <div style={{ height: '2px', background: 'var(--line)' }} />
                    <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center' }}>Pole Rack</span>
                </div>

                {/* spindle track the sleds sit on */}
                <div style={{ position: 'absolute', left: '34%', right: '4%', top: '78px', height: '4px', background: 'var(--line)' }} />

                <Sled color="RED" wo={redWO} act={redAct} under={ovenOver === 'RED'} />
                <Sled color="BLUE" wo={blueWO} act={blueAct} under={ovenOver === 'BLUE'} />

                {/* the single track-mounted oven, sliding to its production-derived position */}
                <div style={{ position: 'absolute', top: '8px', left: ovenLeft, width: '18%', height: '144px', background: ovenRunning ? 'rgba(176,141,87,0.10)' : 'rgba(250,248,244,0.55)', border: '2px solid var(--brass)', boxShadow: ovenRunning ? 'inset 0 0 24px rgba(176,141,87,0.35)' : 'none', transition: 'left 1.6s ease-in-out', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '8px', zIndex: 20 }}>
                    <span style={{ color: '#fff', background: 'var(--brass)', padding: '4px 10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Oven</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', marginTop: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{ovenRunning ? 'Curing' : 'Idle'}</span>
                </div>
            </div>

            <div style={{ marginTop: '18px', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em', lineHeight: 1.6 }}>
                RED: {redAct.label}{redWO ? ` (${redWO.id})` : ''} · BLUE: {blueAct.label}{blueWO ? ` (${blueWO.id})` : ''} · Oven {ovenLabel}.
                Updates live as operators run each step — one sled cures while the other is set up; the oven slides left for poles.
            </div>
        </div>
    );
};

const ActiveFloor = ({ workOrders, recipes, activePots, sysConfig, setMixModal, now, user, setQcModal, users }) => {
  const activeWOs = workOrders.filter(w => w.currentPhase === "Painting");
  const activeJobs = workOrders.filter(j => j.tasks && Object.values(j.tasks).some(t => t.status === 'Running'));
  const redlineWOs = workOrders.filter(w => w.redlineAlert);
  const floorOps = users?.filter(u => ['painter', 'hand_painter', 'paint_manager'].includes(u.role)) || [];

  const cfg = {
    potLifeMins: sysConfig?.potLifeMins || 189, recoatMins: sysConfig?.recoatMins || 90,
    mixMins: sysConfig?.mixMins || 5, 
    spinSetupMins: sysConfig?.spinSetupMins || 10, spinPaintMins: sysConfig?.spinPaintMins || 3, 
    ovenMins: sysConfig?.ovenMins || 10, handSmallMins: sysConfig?.handSmallMins || 1.35,
    handPoleMins: sysConfig?.handPoleMins || 10, poleMins: sysConfig?.poleMins || 5
  };

  // --- SLED ASSIGNMENT ENGINE ---
  const spinningWOs = [...activeWOs].filter(w => w.tasks?.spinSetup && w.tasks.spinBake?.status !== 'Complete').sort((a,b) => a.id.localeCompare(b.id));

  const redWO = activeWOs.find(w => w.machineAssigned === 'RED') || (spinningWOs.find(w => !w.machineAssigned) || null);
  const blueWO = activeWOs.find(w => w.machineAssigned === 'BLUE') || (spinningWOs.find(w => !w.machineAssigned && w.id !== redWO?.id) || null);

  if (redWO && !redWO.machineAssigned) updateDoc(doc(db,"fin_workorders", redWO.id), { machineAssigned: 'RED' });
  if (blueWO && !blueWO.machineAssigned) updateDoc(doc(db,"fin_workorders", blueWO.id), { machineAssigned: 'BLUE' });

  // Machine state is DERIVED from production (no manual toggles): the oven sits over whichever sled is
  // curing, or slides left for poles. A curing sled is "at the oven" (LEFT); otherwise it's at the
  // spray/setup side (RIGHT). This drives both the twin graphic and the task-card stations live.
  const ovenOver = ovenOverOf(redWO, blueWO, activeWOs);
  const machineState = {
      redSledAt: ovenOver === 'RED' ? 'LEFT' : 'RIGHT',
      blueSledAt: ovenOver === 'BLUE' ? 'LEFT' : 'RIGHT',
      ovenPos: ovenOver === 'POLES' ? 'POLES' : 'SPINDLE',
      isOvenRunning: ovenOver !== 'PARKED',
  };

  const getSledLocation = (sledColor) => sledColor === 'RED' ? machineState.redSledAt : machineState.blueSledAt;

  const handleCompleteRecipeStep = async (wo) => {
      const updates = {};
      updates.currentStepIndex = wo.currentStepIndex + 1;
      updates.lastCoatTime = Date.now();
      
      updates["tasks.spinSetup.status"] = "Pending";
      updates["tasks.spinSpray.status"] = "Pending";
      updates["tasks.spinBake.status"] = "Pending";
      updates["tasks.poleSpray.status"] = "Pending";
      updates["tasks.poleBake.status"] = "Pending";
      updates["tasks.hand.status"] = "Pending";
      
      await updateDoc(doc(db,"fin_workorders", wo.id), updates);
  };

  const colorGroups = {};
  activeWOs.forEach(wo => {
      const r = resolveRecipe(recipes, wo.recipe);
      if (!r || !r.steps || r.steps.length <= wo.currentStepIndex) return;
      const step = r.steps[wo.currentStepIndex];
      if (!colorGroups[step.color]) colorGroups[step.color] = [];
      colorGroups[step.color].push({ wo, step });
  });

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
        <DigitalTwinSCADA redWO={redWO} blueWO={blueWO} activeWOs={activeWOs} />

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

        {Object.keys(colorGroups).length === 0 && <div style={{ padding: '40px', background: 'var(--paper)', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '1.2rem', marginBottom: '30px' }}>No batches actively painting.</div>}

        {Object.keys(colorGroups).map(color => {
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
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. Setup Parts" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} />
                                } else if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"spinSpray"} titleOverride="2. Spray Coat" wo={item.wo} type="spinSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={cfg.spinPaintMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSpray')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSpray ? "Waiting on Station 2 Oven" : null} />
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
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. Setup Parts" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSetup ? "Oven is blocking station" : null} />
                                } else if (!isBakeComplete) {
                                    return <TaskCard key={item.wo.id+"spinBake"} titleOverride="2. Bake Cycle" wo={item.wo} type="spinBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinBake')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockBake ? "Oven is at pole rack" : null} />
                                } else {
                                    return (
                                        <div key={item.wo.id} style={{ ...cardStyle, background: 'var(--paper-2)', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--ink)', marginBottom: '16px' }}>Baking Complete</div>
                                            <button onClick={() => {
                                                const polesDone = !item.wo.tasks?.poleSpray || item.wo.tasks.poleBake?.status === 'Complete';
                                                if (polesDone) handleCompleteRecipeStep(item.wo);
                                                else alert("Waiting on Poles to finish before advancing recipe.");
                                            }} style={{ width: '100%', padding: '12px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Unload Parts</button>
                                        </div>
                                    )
                                }
                            })}
                        </div>

                        {/* --- POLE RACK / CUSTOM --- */}
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Pole Rack</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || item.wo.tasks?.poleSpray?.status === 'Complete' && item.wo.tasks?.poleBake?.status === 'Complete') return null;
                                
                                const isSprayComplete = item.wo.tasks?.poleSpray?.status === 'Complete';
                                const blockBake = machineState.ovenPos === 'SPINDLE';

                                if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"poleSpray"} titleOverride="Spray Poles" wo={item.wo} type="poleSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={(item.wo.totalParts || 0) * cfg.poleMins} activePots={activePots} now={now} aiRec={getAiRecommendation('poleSpray')} users={users} activeWOs={activeWOs} cfg={cfg} />
                                } else {
                                    return <TaskCard key={item.wo.id+"poleBake"} titleOverride="Bake Poles" wo={item.wo} type="poleBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} now={now} aiRec={getAiRecommendation('poleBake')} users={users} activeWOs={activeWOs} cfg={cfg} blockReason={blockBake ? "Oven is at spindle track" : null} />
                                }
                            })}
                        </div>

                        {/* --- HAND FINISH OFF-RAMP --- */}
                        <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px', gridColumn: '1 / -1', borderRadius: '2px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', color: 'var(--ink-soft)', marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Hand Finish Station (Off-Track)</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                {colorGroups[color]?.map(item => item.step.app === 'Hand Applied' && item.wo.tasks?.hand?.status !== 'Complete' && (
                                    <TaskCard key={item.wo.id+"hand"} wo={item.wo} type="hand" step={item.step} user={user} setQcModal={setQcModal} estTime={item.wo.type === 'Poles' ? ((item.wo.totalParts || 0) * cfg.handPoleMins) : ((item.wo.totalParts || 0) * cfg.handSmallMins)} activePots={activePots} now={now} aiRec={getAiRecommendation('hand')} users={users} activeWOs={activeWOs} cfg={cfg} />
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
                          <div key={wo.id} style={{ border: '1px solid var(--line)', padding: '16px', background: 'var(--paper)', borderLeft: recoatWarning ? '2px solid #d9534f' : '2px solid var(--brass)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '0.95rem' }}>WO: {wo.id}</span>
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
    </div>
  );
};

const TaskCard = ({ titleOverride, wo, type, step, user, setQcModal, estTime, activePots, now, aiRec, users, activeWOs, cfg, sled, blockReason }) => {
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
                <div style={{ color: 'var(--ink)', fontWeight: 500, fontSize: '0.95rem' }}>{wo.id}</div>
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

            <div style={{ fontSize: '1.05rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '4px' }}>WO: {wo.id}</div>
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