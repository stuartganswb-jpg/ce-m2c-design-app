import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; 
import { doc, updateDoc } from "firebase/firestore";

const cardStyle = { background: '#fff', padding: '15px', border: '1px solid #ccc', borderRadius: 0, boxShadow: '4px 4px 0 rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' };
const btnStyle = { padding: '10px 15px', border: 'none', borderRadius: 0, cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase' };
const inputStyle = { padding: '8px', border: '2px solid #ccc', borderRadius: 0, width: '100%', boxSizing: 'border-box' };

// --- NATIVE SCADA SIMULATOR ---
const DigitalTwinSCADA = ({ machineState, setMachineState, redWO, blueWO, activeWOs }) => {
    
    // Check if ANY task is actively running (preventing shuffle)
    const isAnyStationRunning = activeWOs.some(w => 
        (w.machineAssigned === 'RED' || w.machineAssigned === 'BLUE') &&
        (w.tasks?.spinSpray?.status === 'Running' || w.tasks?.spinBake?.status === 'Running')
    );

    const handleMoveOven = (pos) => {
        if (machineState.isOvenRunning) return alert("Cannot move oven while curing in process!");
        setMachineState({ ...machineState, ovenPos: pos });
    };

    const handleCycleTrack = () => {
        if (isAnyStationRunning) return alert("Cannot cycle track while a station is running a task!");
        setMachineState({ 
            ...machineState, 
            redSledAt: machineState.redSledAt === 'RIGHT' ? 'LEFT' : 'RIGHT',
            blueSledAt: machineState.blueSledAt === 'RIGHT' ? 'LEFT' : 'RIGHT'
        });
    };

    return (
        <div style={{ background: '#222', padding: '20px', border: '4px solid #000', marginBottom: '20px', fontFamily: 'Avenir, sans-serif' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #444', paddingBottom: '10px', marginBottom: '15px' }}>
                <h3 style={{ margin: 0, color: '#fff', fontSize: '1rem' }}>LIVE DIGITAL TWIN: TRACK & OVEN</h3>
                
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button 
                        onClick={() => handleMoveOven('POLES')} 
                        disabled={machineState.isOvenRunning || machineState.ovenPos === 'POLES'} 
                        style={{ padding: '6px 12px', background: machineState.ovenPos === 'POLES' ? '#CC6600' : '#444', color: '#fff', border: '1px solid #fff', cursor: machineState.isOvenRunning ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        ◀ MOVE OVEN TO POLES
                    </button>
                    <button 
                        onClick={() => handleMoveOven('SPINDLE')} 
                        disabled={machineState.isOvenRunning || machineState.ovenPos === 'SPINDLE'} 
                        style={{ padding: '6px 12px', background: machineState.ovenPos === 'SPINDLE' ? '#CC6600' : '#444', color: '#fff', border: '1px solid #fff', cursor: machineState.isOvenRunning ? 'not-allowed' : 'pointer', fontSize: '0.75rem', fontWeight: 'bold' }}>
                        MOVE OVEN TO STATION 2 ▶
                    </button>
                </div>
            </div>
            
            <div style={{ position: 'relative', height: '140px', background: '#333', border: '2px solid #555', display: 'flex', alignItems: 'center' }}>
                {/* POLE RACK */}
                <div style={{ position: 'absolute', left: '2%', width: '15%', height: '100px', border: '2px solid #777', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: '5px' }}>
                    <div style={{ height: '4px', background: '#777', width: '100%' }}></div>
                    <div style={{ height: '4px', background: '#777', width: '100%' }}></div>
                    <span style={{ color: '#aaa', fontSize: '0.6rem', textAlign: 'center', marginTop: '5px', fontWeight: 'bold' }}>POLE RACK</span>
                </div>

                <div style={{ position: 'absolute', left: '25%', right: '5%', height: '40px', border: '2px dashed #666', background: '#2a2a2a' }}></div>
                
                <div style={{ position: 'absolute', left: '27%', bottom: '15px', color: '#aaa', fontSize: '0.6rem', fontWeight: 'bold' }}>STATION 2 (SETUP / DRY)</div>
                <div style={{ position: 'absolute', right: '5%', bottom: '15px', color: '#aaa', fontSize: '0.6rem', fontWeight: 'bold' }}>STATION 1 (SETUP / SPRAY)</div>

                {/* Sled Rendering based on Track Position */}
                <div style={{ position: 'absolute', top: '30px', left: machineState.redSledAt === 'LEFT' ? '30%' : '80%', width: '60px', height: '80px', background: '#d9534f', border: '2px solid #fff', transition: 'left 1.5s ease-in-out', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '0.7rem', zIndex: 10 }}>RED</div>
                <div style={{ position: 'absolute', top: '30px', left: machineState.blueSledAt === 'LEFT' ? '30%' : '80%', width: '60px', height: '80px', background: '#007bff', border: '2px solid #fff', transition: 'left 1.5s ease-in-out', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '0.7rem', zIndex: 10 }}>BLUE</div>

                {/* Mobile Oven Rendering */}
                <div style={{ position: 'absolute', top: '10px', left: machineState.ovenPos === 'POLES' ? '1%' : '23%', width: '22%', height: '120px', background: machineState.isOvenRunning ? 'rgba(204, 102, 0, 0.4)' : 'rgba(204, 102, 0, 0.1)', border: '4px solid #CC6600', boxShadow: machineState.isOvenRunning ? 'inset 0 0 40px #CC6600' : 'inset 0 0 10px #CC6600', transition: 'left 2s ease-in-out', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '10px', zIndex: 20 }}>
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', background: '#CC6600', padding: '2px 8px' }}>CURING OVEN</span>
                </div>
            </div>

            <button 
                onClick={handleCycleTrack} 
                disabled={isAnyStationRunning}
                style={{ width: '100%', padding: '12px', marginTop: '15px', background: isAnyStationRunning ? '#555' : '#28a745', color: isAnyStationRunning ? '#888' : '#fff', border: 'none', fontWeight: 'bold', cursor: isAnyStationRunning ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}>
                {isAnyStationRunning ? "TRACK LOCKED (TASKS RUNNING)" : "🔄 CYCLE TRACK (SWAP STATIONS)"}
            </button>
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

  // --- DIGITAL TWIN MACHINE STATE ---
  // In production, this syncs with a Firestore document (e.g. fin_floor/machine_state)
  const [machineState, setMachineState] = useState({
      redSledAt: 'RIGHT',  // Station 1
      blueSledAt: 'LEFT',  // Station 2
      ovenPos: 'SPINDLE',  // 'SPINDLE' or 'POLES'
      isOvenRunning: false
  });

  // --- SLED ASSIGNMENT ENGINE ---
  // A spinning order claims a sled until BOTH Setup and Bake are complete for the current step.
  const spinningWOs = [...activeWOs].filter(w => w.tasks?.spinSetup && w.tasks.spinBake?.status !== 'Complete').sort((a,b) => a.id.localeCompare(b.id));
  
  // To avoid mutating Firebase during this demo, we read assignment if it exists, otherwise we assign.
  const redWO = activeWOs.find(w => w.machineAssigned === 'RED') || (spinningWOs.find(w => !w.machineAssigned) || null);
  const blueWO = activeWOs.find(w => w.machineAssigned === 'BLUE') || (spinningWOs.find(w => !w.machineAssigned && w.id !== redWO?.id) || null);

  // Auto-assign to DB if not assigned (mocked for UI consistency here)
  if (redWO && !redWO.machineAssigned) updateDoc(doc(db,"fin_workorders", redWO.id), { machineAssigned: 'RED' });
  if (blueWO && !blueWO.machineAssigned) updateDoc(doc(db,"fin_workorders", blueWO.id), { machineAssigned: 'BLUE' });

  // Update global oven status based on active tasks
  const isAnyOvenRunning = activeWOs.some(w => w.tasks?.spinBake?.status === 'Running' || w.tasks?.poleBake?.status === 'Running');
  if (machineState.isOvenRunning !== isAnyOvenRunning) setMachineState({...machineState, isOvenRunning: isAnyOvenRunning});

  const getSledLocation = (sledColor) => sledColor === 'RED' ? machineState.redSledAt : machineState.blueSledAt;

  // The Master Unload & Advance Logic (Checks if Mixed Orders are fully complete)
  const handleCompleteRecipeStep = async (wo) => {
      const updates = {};
      updates.currentStepIndex = wo.currentStepIndex + 1;
      updates.lastCoatTime = Date.now();
      
      // Reset all tasks for the next recipe step
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
      const r = recipes[wo.recipe];
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
    <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '30px', height: '100%', fontFamily: 'Avenir, sans-serif' }}>
      
      {/* LEFT: PIPELINE */}
      <div>
        <DigitalTwinSCADA machineState={machineState} setMachineState={setMachineState} redWO={redWO} blueWO={blueWO} activeWOs={activeWOs} />

        {redlineWOs.length > 0 && (
            <div style={{ background: '#d9534f', color: '#fff', padding: '15px', border: '4px solid #333', marginBottom: '20px', fontWeight: 'bold', fontSize: '1.1rem', textTransform: 'uppercase' }}>
                🚨 SUPERVISOR ACTION REQUIRED: 
                <ul style={{ margin: '5px 0 0 20px', fontSize: '0.9rem' }}>
                    {redlineWOs.map(w => <li key={w.id}>{w.redlineAlert}</li>)}
                </ul>
            </div>
        )}

        {Object.keys(colorGroups).length === 0 && <div style={{ padding: '20px', background: '#fff', border: '1px dashed #ccc', color: '#666', marginBottom: '20px' }}>No batches actively painting.</div>}

        {Object.keys(colorGroups).map(color => {
            let potRemMins = null;
            let potBg = '#28a745'; let potColor = '#fff';
            if (activePots[color]) {
                potRemMins = getRemainingMins(activePots[color], cfg.potLifeMins);
                if (potRemMins <= 5) { potBg = '#d9534f'; potColor = '#fff'; }
                else if (potRemMins <= 15) { potBg = '#CC6600'; potColor = '#fff'; }
            }

            return (
                <div key={color} style={{ background: '#fff', border: '2px solid #333', marginBottom: '20px', padding: '15px' }}>
                    <h3 style={{ margin: '0 0 15px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#CC6600' }}>BATCH: {color}</span>
                        {activePots[color] ? (
                            <span style={{ background: potBg, color: potColor, padding: '5px 10px', fontSize: '0.9rem', fontWeight: 'bold' }}>POT LIFE: {potRemMins} MINS LEFT</span>
                        ) : (
                            <button onClick={() => setMixModal(color)} style={{ padding: '8px 15px', background: '#007bff', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                                START {cfg.mixMins} MIN MIX
                            </button>
                        )}
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                        
                        {/* --- STATION 1 (RIGHT): SETUP & SPRAY --- */}
                        <div style={{ background: '#f8f9fa', border: '2px solid #000', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.85rem', textAlign: 'center', background: '#333', color: '#fff', padding: '8px', marginBottom: '10px' }}>STATION 1 (RIGHT) - SPRAY</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || !item.wo.machineAssigned) return null; 
                                const location = getSledLocation(item.wo.machineAssigned);
                                if (location !== 'RIGHT') return null; // Only show WO if its sled is currently on the right

                                const isSetupComplete = item.wo.tasks?.spinSetup?.status === 'Complete';
                                const isSprayComplete = item.wo.tasks?.spinSpray?.status === 'Complete';

                                // Validation: Cannot spray if Station 2 is actively baking
                                const blockSpray = machineState.ovenPos === 'SPINDLE' && machineState.isOvenRunning;

                                if (!isSetupComplete) {
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. SETUP PARTS" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} />
                                } else if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"spinSpray"} titleOverride="2. SPRAY COAT" wo={item.wo} type="spinSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={cfg.spinPaintMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSpray')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSpray ? "WAITING ON STATION 2 OVEN" : null} />
                                } else {
                                    return <div key={item.wo.id} style={{ ...cardStyle, background: '#eafaf1', borderLeft: '5px solid #28a745', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: '#28a745' }}>✅ READY FOR TRACK CYCLE</div>
                                }
                            })}
                        </div>

                        {/* --- STATION 2 (LEFT): SETUP & BAKE --- */}
                        <div style={{ background: '#f8f9fa', border: '2px solid #000', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.85rem', textAlign: 'center', background: '#333', color: '#fff', padding: '8px', marginBottom: '10px' }}>STATION 2 (LEFT) - OVEN</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || !item.wo.machineAssigned) return null; 
                                const location = getSledLocation(item.wo.machineAssigned);
                                if (location !== 'LEFT') return null;

                                const isSetupComplete = item.wo.tasks?.spinSetup?.status === 'Complete';
                                const isBakeComplete = item.wo.tasks?.spinBake?.status === 'Complete';

                                // Validation: Cannot setup if Oven is physically covering Station 2
                                const blockSetup = machineState.ovenPos === 'SPINDLE';
                                // Validation: Cannot bake if Oven is currently over the poles
                                const blockBake = machineState.ovenPos === 'POLES';

                                if (!isSetupComplete) {
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="1. SETUP PARTS" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockSetup ? "OVEN IS BLOCKING STATION" : null} />
                                } else if (!isBakeComplete) {
                                    return <TaskCard key={item.wo.id+"spinBake"} titleOverride="2. BAKE CYCLE" wo={item.wo} type="spinBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinBake')} users={users} activeWOs={activeWOs} cfg={cfg} sled={item.wo.machineAssigned} blockReason={blockBake ? "OVEN IS AT POLE RACK" : null} />
                                } else {
                                    return (
                                        <div key={item.wo.id} style={{ ...cardStyle, background: '#eafaf1', borderLeft: '5px solid #28a745', textAlign: 'center' }}>
                                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#28a745', marginBottom: '10px' }}>✅ BAKING COMPLETE</div>
                                            <button onClick={() => {
                                                const polesDone = !item.wo.tasks?.poleSpray || item.wo.tasks.poleBake?.status === 'Complete';
                                                if (polesDone) handleCompleteRecipeStep(item.wo);
                                                else alert("Waiting on Poles to finish before advancing recipe.");
                                            }} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>UNLOAD PARTS (CHECK RECIPE)</button>
                                        </div>
                                    )
                                }
                            })}
                        </div>

                        {/* --- POLE RACK / CUSTOM --- */}
                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>POLE RACK</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || item.wo.tasks?.poleSpray?.status === 'Complete' && item.wo.tasks?.poleBake?.status === 'Complete') return null;
                                
                                const isSprayComplete = item.wo.tasks?.poleSpray?.status === 'Complete';
                                const blockBake = machineState.ovenPos === 'SPINDLE';

                                if (!isSprayComplete) {
                                    return <TaskCard key={item.wo.id+"poleSpray"} titleOverride="SPRAY POLES" wo={item.wo} type="poleSpray" step={item.step} user={user} setQcModal={setQcModal} estTime={(item.wo.totalParts || 0) * cfg.poleMins} activePots={activePots} now={now} aiRec={getAiRecommendation('poleSpray')} users={users} activeWOs={activeWOs} cfg={cfg} />
                                } else {
                                    return <TaskCard key={item.wo.id+"poleBake"} titleOverride="BAKE POLES" wo={item.wo} type="poleBake" step={item.step} user={user} estTime={cfg.ovenMins} activePots={activePots} now={now} aiRec={getAiRecommendation('poleBake')} users={users} activeWOs={activeWOs} cfg={cfg} blockReason={blockBake ? "OVEN IS AT SPINDLE TRACK" : null} />
                                }
                            })}
                        </div>

                        {/* --- HAND FINISH OFF-RAMP --- */}
                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px', gridColumn: '1 / -1' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>HAND FINISH STATION (OFF-TRACK)</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ background: '#f8f9fa', padding: '20px', borderLeft: '4px solid #CC6600', border: '2px solid #333' }}>
              <h3 style={{ marginTop: 0, color: '#333', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>LIVE OPERATOR STATUS</h3>
              {floorOps.length === 0 ? <p style={{color: '#666'}}>No floor operators in directory.</p> : (
                  floorOps.map(op => {
                      let activeOpJob = activeJobs.find(j => Object.values(j.tasks).some(t => t.status === 'Running' && t.assignedTo === op.name));
                      let isBusy = !!activeOpJob;
                      let statusText = 'IDLE';
                      let statusColor = '#28a745';

                      if (isBusy) {
                          statusColor = '#d9534f';
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
                          <div key={op.name} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px dashed #ccc' }}>
                              <span style={{ fontWeight: 'bold', color: '#333' }}>{op.name} <span style={{fontSize:'0.6rem', color:'#666'}}>({op.role.replace(/_/g, ' ')})</span></span>
                              <span style={{ fontWeight: 'bold', color: statusColor, fontSize: '0.8rem' }}>{statusText}</span>
                          </div>
                      );
                  })
              )}
          </div>

          <div style={{ background: '#fff', padding: '20px', border: '2px solid #333' }}>
              <h3 style={{ marginTop: 0, color: '#333', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>PIPELINE OVERVIEW</h3>
              {activeWOs.length === 0 ? <p style={{color: '#666', fontSize: '0.8rem'}}>No active jobs in pipeline.</p> : (
                  activeWOs.map(wo => {
                      let recoatWarning = null;
                      if (wo.lastCoatTime) {
                          const recoatMinsLeft = Math.max(0, Math.floor(((cfg.recoatMins * 60000) - (now - wo.lastCoatTime)) / 60000));
                          if (recoatMinsLeft < 30) recoatWarning = `⚠️ RECOAT DANGER: ${recoatMinsLeft}m LEFT!`;
                      }
                      return (
                          <div key={wo.id} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', borderLeft: recoatWarning ? '4px solid #d9534f' : '4px solid #333' }}>
                              <div style={{ fontWeight: 'bold', color: '#333', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                  <span>WO: {wo.id}</span>
                                  <span style={{ color: '#CC6600' }}>{wo.recipe}</span>
                              </div>
                              {recoatWarning && <div style={{ color: '#d9534f', fontSize: '0.75rem', fontWeight: 'bold', marginTop: '3px' }}>{recoatWarning}</div>}
                          </div>
                      );
                  })
              )}
          </div>
      </div>

      {/* --- PINNED ORDER NOTES OVERLAY --- */}
      <div style={{ position: 'fixed', bottom: '20px', right: '20px', width: '340px', maxHeight: '500px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', zIndex: 1000 }}>
          {activeWOs.map(wo => {
              const smallParts = (wo.partsList || []).filter(p => p.name.toUpperCase().includes('RING') || p.name.toUpperCase().includes('FINIAL') || p.name.toUpperCase().includes('BRACKET'));
              const customParts = (wo.partsList || []).filter(p => p.name.toUpperCase().includes('POLE') || p.name.toUpperCase().includes('TRACK') || p.name.toUpperCase().includes('SPLICE'));

              return (
                  <div key={`note-${wo.id}`} style={{ background: '#f4f4f4', border: '2px solid #333', padding: '15px', boxShadow: '-6px 6px 0px rgba(0,0,0,0.1)' }}>
                      <div style={{ fontWeight: 'bold', borderBottom: '2px solid #333', paddingBottom: '8px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontSize: '0.9rem', color: '#007bff' }}>WO: {wo.id}</span>
                              <span style={{ fontSize: '0.75rem', color: '#555' }}>SO: {wo.soId || 'NO-SO'}</span>
                          </div>
                          <span style={{ color: '#fff', background: '#CC6600', padding: '3px 8px', fontSize: '0.75rem', fontWeight: 'bold' }}>{wo.recipe}</span>
                      </div>
                      
                      <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: '5px', fontWeight: 'bold', textTransform: 'uppercase', background: '#e3f2fd', padding: '4px', border: '1px solid #007bff' }}>
                          MACHINE LOADOUT: {smallParts.reduce((acc, p) => acc + p.qty, 0)} PARTS
                      </div>
                      <ul style={{ margin: '0 0 10px 0', paddingLeft: '15px', fontSize: '0.75rem', color: '#555' }}>
                          {smallParts.length > 0 ? smallParts.map((p, i) => (
                              <li key={`sm-${i}`} style={{ marginBottom: '4px' }}><b>{p.qty}x</b> {p.name}</li>
                          )) : <li style={{ fontStyle: 'italic', color: '#888' }}>No small parts.</li>}
                      </ul>

                      <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: '5px', fontWeight: 'bold', textTransform: 'uppercase', background: '#eafaf1', padding: '4px', border: '1px solid #28a745' }}>
                          POLES / CUSTOM LOADOUT: {customParts.reduce((acc, p) => acc + p.qty, 0)} PARTS
                      </div>
                      <ul style={{ margin: 0, paddingLeft: '15px', fontSize: '0.75rem', color: '#555' }}>
                          {customParts.length > 0 ? customParts.map((p, i) => (
                              <li key={`cu-${i}`} style={{ marginBottom: '4px' }}><b>{p.qty}x</b> {p.name}</li>
                          )) : <li style={{ fontStyle: 'italic', color: '#888' }}>No poles or tracks.</li>}
                      </ul>
                  </div>
              )
          })}
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
        if (recoatMinsLeft < 30) recoatWarning = `⚠️ RECOAT: ${recoatMinsLeft}m LEFT!`;
        else recoatWarning = `Recoat Window: ${recoatMinsLeft}m`;
    }

    const isPaintReady = !!activePots[step.color];
    const disabledStart = !loggedInUserHasAccess || !isPaintReady || !currentOp || isSelectedOpBusy || blockReason;
    
    let btnText = 'START TASK';
    if (!loggedInUserHasAccess) btnText = 'ROLE RESTRICTED';
    else if (!isPaintReady) btnText = 'AWAITING PAINT MIX';
    else if (!currentOp) btnText = 'NO OP AVAILABLE';
    else if (isSelectedOpBusy) btnText = `${currentOp.toUpperCase()} IS BUSY`;
    else if (blockReason) btnText = blockReason;

    // --- BAKING COUNTDOWN UI ---
    if (isRunning && type.includes('Bake')) {
        const rem = Math.max(0, Math.floor(((estTime * 60000) - (now - task.startTime)) / 60000));
        return (
            <div style={{ ...cardStyle, borderLeft: '5px solid #d9534f', textAlign: 'center' }}>
                <b style={{color: '#333'}}>{wo.id}</b>
                {sled && <div style={{ fontSize: '0.7rem', color: sled === 'RED' ? '#d9534f' : '#007bff', fontWeight: 'bold', marginTop: '5px' }}>{sled} STATION (OVEN)</div>}
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#d9534f', margin: '10px 0' }}>{rem} MINS LEFT</div>
                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' })} style={{ width: '100%', padding: '6px', background: '#f4f4f4', color: '#d9534f', border: '1px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>MARK DRY EARLY</button>
            </div>
        );
    }

    return (
        <div style={{ ...cardStyle, borderLeft: isRunning ? '5px solid #007bff' : '5px solid #333', position: 'relative' }}>
            
            {titleOverride && <div style={{ fontSize: '0.7rem', color: '#fff', background: '#333', padding: '4px', textAlign: 'center', fontWeight: 'bold', marginBottom: '10px' }}>{titleOverride}</div>}

            {type.includes('spin') && sled && (
                <div style={{ background: sled === 'RED' ? '#d9534f' : '#007bff', color: '#fff', padding: '6px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '10px', textTransform: 'uppercase', border: '1px solid #000' }}>
                    {sled} STATION
                </div>
            )}

            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#333' }}>WO: {wo.id}</div>
            <div style={{ fontSize: '0.7rem', color: '#666', margin: '5px 0' }}>Step {step.step}: {step.color}</div>
            
            {isRunning ? (
                <div style={{ fontSize: '0.75rem', background: '#e3f2fd', color: '#007bff', padding: '4px', marginBottom: '5px', fontWeight: 'bold' }}>Active: {task.assignedTo}</div>
            ) : (
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#CC6600' }}>ASSIGN OPERATOR</label>
                    <select value={currentOp} onChange={(e) => setManualOp(e.target.value)} style={{ ...inputStyle, padding: '4px', fontSize: '0.75rem', borderColor: '#CC6600' }}>
                        {aiRec !== "NO OP AVAILABLE" && <option value={aiRec}>🤖 AI REC: {aiRec}</option>}
                        {eligibleUsers.map(u => {
                            if (u.name === aiRec) return null; 
                            return <option key={u.name} value={u.name}>{u.name} ({u.role.replace(/_/g, ' ')})</option>;
                        })}
                    </select>
                </div>
            )}
            
            {recoatWarning && <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: recoatWarning.includes('⚠️') ? '#d9534f' : '#007bff', marginBottom: '5px' }}>{recoatWarning}</div>}
            <div style={{ fontSize: '0.7rem', color: '#333', marginBottom: '10px', fontWeight: 'bold' }}>⏱️ Est: {Math.ceil(estTime)} mins</div>
            
            {!isRunning ? (
                <button disabled={disabledStart} onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Running', [`tasks.${type}.assignedTo`]: currentOp, [`tasks.${type}.startTime`]: Date.now() })} style={{ width: '100%', padding: '8px', background: disabledStart ? '#ccc' : blockReason ? '#ffc107' : '#333', color: disabledStart ? '#666' : blockReason ? '#000' : '#fff', border: 'none', fontWeight: 'bold', cursor: disabledStart ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>{btnText}</button>
            ) : (
                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' })} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>COMPLETE TASK</button>
            )}
        </div>
    )
}

export default ActiveFloor;