import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; 
import { doc, updateDoc } from "firebase/firestore";

const cardStyle = { background: '#fff', padding: '15px', border: '1px solid #ccc', borderRadius: 0, boxShadow: '4px 4px 0 rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' };
const btnStyle = { padding: '10px 15px', border: 'none', borderRadius: 0, cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase' };
const inputStyle = { padding: '8px', border: '2px solid #ccc', borderRadius: 0, width: '100%', boxSizing: 'border-box' };

// --- NATIVE SCADA SIMULATOR ---
const SpindleSprayerSim = ({ ovenHasPoles, ovenHasSpin, redWO, blueWO }) => {
    
    // Oven physical locations: '1%' is far-left over poles, '23%' is mid-left over spindle track
    let ovenPos = '23%'; 
    if (ovenHasPoles) ovenPos = '1%'; 
    else if (ovenHasSpin) ovenPos = '23%'; 

    let redPos = 'right';
    let bluePos = 'left';
    
    // Track Sled Positions (Opposite states)
    if (redWO && redWO.tasks?.spinPaint?.status === 'Oven') { redPos = 'left'; bluePos = 'right'; } 
    else if (blueWO && blueWO.tasks?.spinPaint?.status === 'Oven') { bluePos = 'left'; redPos = 'right'; }

    return (
        <div style={{ background: '#222', padding: '20px', border: '4px solid #000', marginBottom: '20px', fontFamily: 'Avenir, sans-serif' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#fff', fontSize: '1rem', borderBottom: '1px solid #444', paddingBottom: '10px' }}>LIVE SCADA: SPINDLE & OVEN TRACKER</h3>
            
            <div style={{ position: 'relative', height: '140px', background: '#333', border: '2px solid #555', display: 'flex', alignItems: 'center' }}>
                
                {/* POLE RACK */}
                <div style={{ position: 'absolute', left: '2%', width: '15%', height: '100px', border: '2px solid #777', display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', padding: '5px' }}>
                    <div style={{ height: '4px', background: '#777', width: '100%' }}></div>
                    <div style={{ height: '4px', background: '#777', width: '100%' }}></div>
                    <div style={{ height: '4px', background: '#777', width: '100%' }}></div>
                    <span style={{ color: '#aaa', fontSize: '0.6rem', textAlign: 'center', marginTop: '5px', fontWeight: 'bold' }}>POLE RACK</span>
                </div>

                <div style={{ position: 'absolute', left: '25%', right: '5%', height: '40px', border: '2px dashed #666', background: '#2a2a2a' }}></div>
                <div style={{ position: 'absolute', right: '5%', bottom: '15px', color: '#aaa', fontSize: '0.6rem', fontWeight: 'bold' }}>SETUP/PAINT STATION</div>

                <div style={{ position: 'absolute', top: '30px', left: redPos === 'left' ? '30%' : '80%', width: '60px', height: '80px', background: '#d9534f', border: '2px solid #fff', transition: 'left 1.5s ease-in-out', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '0.7rem', zIndex: 10 }}>RED</div>
                <div style={{ position: 'absolute', top: '30px', left: bluePos === 'left' ? '30%' : '80%', width: '60px', height: '80px', background: '#007bff', border: '2px solid #fff', transition: 'left 1.5s ease-in-out', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 'bold', fontSize: '0.7rem', zIndex: 10 }}>BLUE</div>

                <div style={{ position: 'absolute', top: '10px', left: ovenPos, width: '22%', height: '120px', background: 'rgba(204, 102, 0, 0.2)', border: '4px solid #CC6600', boxShadow: 'inset 0 0 20px #CC6600', transition: 'left 2s ease-in-out', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', paddingTop: '10px', zIndex: 20 }}>
                    <span style={{ color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', background: '#CC6600', padding: '2px 8px' }}>CURING OVEN</span>
                </div>
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

  // --- SLED ASSIGNMENT & INTERLOCK ENGINE ---
  // A spinning order is assigned to a sled if its setup isn't complete, OR it's painting, OR it's currently in the spindle oven
  const spinningWOs = [...activeWOs].filter(w => w.tasks?.spinSetup && w.tasks.spinSetup.status !== 'N/A' && w.tasks.spinPaint?.status !== 'Complete').sort((a,b) => a.id.localeCompare(b.id));
  const redWO = spinningWOs[0] || null;
  const blueWO = spinningWOs[1] || null;

  const getSledAssignment = (woId) => redWO?.id === woId ? 'RED' : blueWO?.id === woId ? 'BLUE' : null;
  const getOppositeWO = (woId) => redWO?.id === woId ? blueWO : blueWO?.id === woId ? redWO : null;
  
  const isOvenReady = (wo, isSpin) => {
      const task = isSpin ? wo.tasks.spinPaint : wo.tasks.pole;
      return task?.ovenComplete || Math.max(0, Math.floor(((cfg.ovenMins * 60000) - (now - task?.ovenStartTime)) / 60000)) <= 0;
  };

  // The Master Unload & Advance Logic (Checks if Mixed Orders are fully complete)
  const handleUnloadOven = async (wo, taskType) => {
      const isSpin = taskType === 'spinPaint';
      const updates = { [`tasks.${taskType}.status`]: 'Complete' };
      
      const oppTask = isSpin ? wo.tasks?.pole : wo.tasks?.spinPaint;
      const oppDoneOrNA = !oppTask || oppTask.status === 'Complete' || oppTask.status === 'N/A';
      const handDoneOrNA = !wo.tasks?.hand || wo.tasks.hand.status === 'Complete' || wo.tasks.hand.status === 'N/A';

      // If all components of this recipe step are done, increment the recipe index!
      if (oppDoneOrNA && handDoneOrNA) {
          updates.currentStepIndex = wo.currentStepIndex + 1;
          updates.lastCoatTime = Date.now();
          updates["tasks.spinSetup.status"] = "Pending";
          updates["tasks.spinPaint.status"] = "Pending";
          updates["tasks.pole.status"] = "Pending";
          updates["tasks.hand.status"] = "Pending";
      }
      await updateDoc(doc(db,"fin_workorders", wo.id), updates);
  };

  // Interlocked Sled Cycle Command
  const handleCycleTrack = async (paintWO, ovenWO) => {
      if (paintWO) {
          await updateDoc(doc(db, "fin_workorders", paintWO.id), { 'tasks.spinPaint.status': 'Oven', 'tasks.spinPaint.ovenStartTime': Date.now(), 'tasks.spinPaint.ovenComplete': false });
      }
      if (ovenWO) {
          await handleUnloadOven(ovenWO, 'spinPaint');
      }
  };

  const ovenSpinWOs = activeWOs.filter(w => w.tasks?.spinPaint?.status === "Oven");
  const ovenPoleWOs = activeWOs.filter(w => w.tasks?.pole?.status === "Oven");
  const ovenHasSpin = ovenSpinWOs.length > 0;
  const ovenHasPoles = ovenPoleWOs.length > 0;
  
  const spinActiveCount = activeJobs.filter(j => j.type !== 'Poles' && j.tasks?.spinPaint?.status === 'Running').length;

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
          if (taskType === 'pole') return ['painter', 'paint_manager'].includes(u.role);
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
        <SpindleSprayerSim ovenHasPoles={ovenHasPoles} ovenHasSpin={ovenHasSpin} redWO={redWO} blueWO={blueWO} />

        {redlineWOs.length > 0 && (
            <div style={{ background: '#d9534f', color: '#fff', padding: '15px', border: '4px solid #333', marginBottom: '20px', fontWeight: 'bold', fontSize: '1.1rem', textTransform: 'uppercase' }}>
                🚨 SUPERVISOR ACTION REQUIRED: 
                <ul style={{ margin: '5px 0 0 20px', fontSize: '0.9rem' }}>
                    {redlineWOs.map(w => <li key={w.id}>{w.redlineAlert}</li>)}
                </ul>
            </div>
        )}

        <h2 style={{ margin: 0, color: '#333', borderBottom: '2px solid #333', paddingBottom: '10px' }}>ACTIVE PIPELINE</h2>
        
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

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
                        
                        {/* --- SEQUENTIAL SPINNING FLOW --- */}
                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>SPINNING (SETUP & PAINT)</div>
                            {colorGroups[color]?.map(item => {
                                if (item.step.app !== 'Sprayed' || item.wo.tasks?.spinPaint?.status === 'Oven') return null; 
                                
                                const isSetupComplete = item.wo.tasks?.spinSetup?.status === 'Complete';
                                const oppositeWO = getOppositeWO(item.wo.id);
                                const oppInOven = oppositeWO?.tasks?.spinPaint?.status === 'Oven';
                                const oppOvenReady = oppInOven ? isOvenReady(oppositeWO, true) : true;
                                
                                let cycleBlockReason = '';
                                if (oppInOven && !oppOvenReady) cycleBlockReason = `WAITING ON ${getSledAssignment(oppositeWO.id)} OVEN`;
                                else if (ovenHasPoles) cycleBlockReason = `WAITING ON POLES OVEN`;

                                if (!isSetupComplete && item.wo.tasks?.spinSetup?.status !== 'N/A') {
                                    return <TaskCard key={item.wo.id+"spinSetup"} titleOverride="SPIN: SETUP" wo={item.wo} type="spinSetup" step={item.step} user={user} estTime={cfg.spinSetupMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinSetup')} users={users} activeWOs={activeWOs} cfg={cfg} sled={getSledAssignment(item.wo.id)} />
                                } else {
                                    return <TaskCard key={item.wo.id+"spinPaint"} titleOverride="SPIN: PAINT" wo={item.wo} type="spinPaint" step={item.step} user={user} setQcModal={setQcModal} estTime={cfg.spinPaintMins} activePots={activePots} now={now} aiRec={getAiRecommendation('spinPaint')} users={users} activeWOs={activeWOs} cfg={cfg} sled={getSledAssignment(item.wo.id)} cycleBlockReason={cycleBlockReason} onCycle={() => handleCycleTrack(item.wo, oppInOven ? oppositeWO : null)} />
                                }
                            })}
                        </div>

                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>POLES</div>
                            {colorGroups[color]?.map(item => item.step.app === 'Sprayed' && item.wo.tasks?.pole?.status !== 'Complete' && item.wo.tasks?.pole?.status !== 'N/A' && item.wo.tasks?.pole?.status !== 'Oven' && (
                                <TaskCard key={item.wo.id+"pole"} wo={item.wo} type="pole" step={item.step} user={user} setQcModal={setQcModal} estTime={(item.wo.totalParts || 0) * cfg.poleMins} activePots={activePots} ovenHasSpin={ovenHasSpin} now={now} aiRec={getAiRecommendation('pole')} users={users} activeWOs={activeWOs} cfg={cfg} />
                            ))}
                        </div>

                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>HAND FINISH</div>
                            {colorGroups[color]?.map(item => item.step.app === 'Hand Applied' && item.wo.tasks?.hand?.status !== 'Complete' && item.wo.tasks?.hand?.status !== 'N/A' && (
                                <TaskCard key={item.wo.id+"hand"} wo={item.wo} type="hand" step={item.step} user={user} setQcModal={setQcModal} estTime={item.wo.type === 'Poles' ? ((item.wo.totalParts || 0) * cfg.handPoleMins) : ((item.wo.totalParts || 0) * cfg.handSmallMins)} activePots={activePots} now={now} aiRec={getAiRecommendation('hand')} users={users} activeWOs={activeWOs} cfg={cfg} />
                            ))}
                        </div>

                        {/* --- OVEN DASHBOARD --- */}
                        <div style={{ background: '#fff0f0', border: '1px solid #d9534f', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #d9534f', paddingBottom: '10px', marginBottom: '10px', color: '#d9534f' }}>OVEN (AUTO)</div>
                            
                            {/* Render Spinning Parts in Oven */}
                            {ovenSpinWOs.filter(w => recipes[w.recipe]?.steps[w.currentStepIndex]?.color === color).map(wo => {
                                const rem = getRemainingMins(wo.tasks.spinPaint.ovenStartTime, cfg.ovenMins);
                                const isReady = isOvenReady(wo, true);
                                
                                let cycleBlockReason = '';
                                const oppositeWO = getOppositeWO(wo.id);
                                const oppAtPaint = oppositeWO && oppositeWO.tasks?.spinPaint?.status !== 'Oven';
                                const oppPaintComplete = oppAtPaint ? oppositeWO.tasks?.spinPaint?.status === 'Complete' : true;
                                if (oppAtPaint && !oppPaintComplete) cycleBlockReason = `WAITING ON ${getSledAssignment(oppositeWO.id)} PAINT`;

                                return (
                                    <div key={wo.id+"spinOven"} style={{ ...cardStyle, borderLeft: isReady ? '5px solid #28a745' : '5px solid #d9534f', textAlign: 'center', marginBottom: '10px' }}>
                                        <b style={{color: '#333'}}>{wo.id}</b>
                                        <div style={{ fontSize: '0.7rem', color: getSledAssignment(wo.id) === 'RED' ? '#d9534f' : '#007bff', fontWeight: 'bold', marginTop: '2px' }}>{getSledAssignment(wo.id)} STATION (SPINDLE)</div>
                                        
                                        {!isReady ? (
                                            <>
                                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#d9534f', margin: '10px 0' }}>{rem} MINS LEFT</div>
                                                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { 'tasks.spinPaint.ovenComplete': true })} style={{ width: '100%', padding: '6px', background: '#f4f4f4', color: '#d9534f', border: '1px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>MARK DRY EARLY</button>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontSize: '0.85rem', color: '#28a745', fontWeight: 'bold', margin: '10px 0' }}>✅ READY TO CYCLE</div>
                                                {cycleBlockReason ? (
                                                    <button disabled style={{ width: '100%', padding: '8px', background: '#ffc107', color: '#000', border: 'none', fontWeight: 'bold', fontSize: '0.75rem' }}>{cycleBlockReason}</button>
                                                ) : (
                                                    <button onClick={() => handleCycleTrack(oppAtPaint ? oppositeWO : null, wo)} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', marginTop: '5px', cursor: 'pointer', fontSize: '0.75rem' }}>CYCLE TRACK & SWAP</button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                );
                            })}

                            {/* Render Poles in Oven */}
                            {ovenPoleWOs.filter(w => recipes[w.recipe]?.steps[w.currentStepIndex]?.color === color).map(wo => {
                                const rem = getRemainingMins(wo.tasks.pole.ovenStartTime, cfg.ovenMins);
                                const isReady = isOvenReady(wo, false);

                                return (
                                    <div key={wo.id+"poleOven"} style={{ ...cardStyle, borderLeft: isReady ? '5px solid #28a745' : '5px solid #d9534f', textAlign: 'center', marginBottom: '10px' }}>
                                        <b style={{color: '#333'}}>{wo.id}</b>
                                        <div style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold', marginTop: '2px' }}>CUSTOM POLE RACK</div>
                                        
                                        {!isReady ? (
                                            <>
                                                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#d9534f', margin: '10px 0' }}>{rem} MINS LEFT</div>
                                                <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { 'tasks.pole.ovenComplete': true })} style={{ width: '100%', padding: '6px', background: '#f4f4f4', color: '#d9534f', border: '1px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>MARK DRY EARLY</button>
                                            </>
                                        ) : (
                                            <>
                                                <div style={{ fontSize: '0.85rem', color: '#28a745', fontWeight: 'bold', margin: '10px 0' }}>✅ READY TO UNLOAD</div>
                                                <button onClick={() => handleUnloadOven(wo, 'pole')} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', marginTop: '5px', cursor: 'pointer', fontSize: '0.75rem' }}>UNLOAD POLES</button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}

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
                          if (tType === 'spinPaint') taskEstTime = cfg.spinPaintMins;
                          if (tType === 'pole') taskEstTime = (activeOpJob.totalParts || 0) * cfg.poleMins;
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

const TaskCard = ({ titleOverride, wo, type, step, user, setQcModal, estTime, activePots, ovenHasPoles, ovenHasSpin, now, aiRec, users, activeWOs, cfg, sled, cycleBlockReason, onCycle }) => {
    const task = wo.tasks?.[type] || {}; 
    const isRunning = task.status === 'Running';
    const isComplete = task.status === 'Complete';
    
    const [manualOp, setManualOp] = useState("");
    const currentOp = manualOp || (aiRec === "NO OP AVAILABLE" ? "" : aiRec);

    const eligibleUsers = users?.filter(u => {
        const isAdminOrMgr = ['admin', 'floor_manager', 'paint_manager'].includes(u.role);
        if (type.includes('spin')) return isAdminOrMgr || ['painter', 'hand_painter'].includes(u.role);
        if (type === 'pole') return isAdminOrMgr || u.role === 'painter';
        if (type === 'hand') return isAdminOrMgr || u.role === 'hand_painter';
        return false;
    }) || [];

    const loggedInUserHasAccess = ['admin', 'floor_manager', 'paint_manager'].includes(user?.role) || 
                                  (user?.role === 'painter' && ['spinSetup', 'spinPaint', 'pole'].includes(type)) || 
                                  (user?.role === 'hand_painter' && ['spinSetup', 'spinPaint', 'hand'].includes(type));

    let selectedOpManualLoad = 0;
    activeWOs.forEach(w => {
        if(w.tasks) {
            Object.entries(w.tasks).forEach(([tType, t]) => {
                if(t.status === 'Running' && t.assignedTo === currentOp && ['spinSetup', 'spinPaint', 'pole', 'hand'].includes(tType)) {
                    selectedOpManualLoad++;
                }
            });
        }
    });

    const isSelectedOpBusy = selectedOpManualLoad >= 1;
    let ovenBlocked = (type === 'pole' && ovenHasSpin);

    let recoatWarning = null;
    if (wo.lastCoatTime) {
        const recoatMinsLeft = Math.max(0, Math.floor(((cfg.recoatMins * 60000) - (now - wo.lastCoatTime)) / 60000));
        if (recoatMinsLeft < 30) recoatWarning = `⚠️ RECOAT: ${recoatMinsLeft}m LEFT!`;
        else recoatWarning = `Recoat Window: ${recoatMinsLeft}m`;
    }

    const isPaintReady = !!activePots[step.color];
    const disabledStart = !loggedInUserHasAccess || !isPaintReady || !currentOp || isSelectedOpBusy;
    
    let btnText = 'START TASK';
    if (!loggedInUserHasAccess) btnText = 'ROLE RESTRICTED';
    else if (!isPaintReady) btnText = 'AWAITING PAINT MIX';
    else if (!currentOp) btnText = 'NO OP AVAILABLE';
    else if (isSelectedOpBusy) btnText = `${currentOp.toUpperCase()} IS BUSY`;

    // --- RENDER COMPLETED CYCLE STATE FOR PAINT ---
    if (isComplete && type === 'spinPaint') {
        return (
            <div style={{...cardStyle, background: '#eafaf1', borderLeft: '5px solid #28a745'}}>
                {sled && <div style={{ background: sled === 'RED' ? '#d9534f' : '#007bff', color: '#fff', padding: '6px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '10px', textTransform: 'uppercase', border: '1px solid #000' }}>{sled} STATION</div>}
                <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#333' }}>WO: {wo.id}</div>
                <div style={{ fontSize: '0.75rem', color: '#28a745', fontWeight: 'bold', margin: '10px 0' }}>✅ PAINT COMPLETE</div>
                {cycleBlockReason ? (
                    <button disabled style={{...btnStyle, width: '100%', background: '#ffc107', color: '#000', fontSize: '0.75rem'}}>{cycleBlockReason}</button>
                ) : (
                    <button onClick={onCycle} style={{...btnStyle, width: '100%', background: '#28a745', color: '#fff', fontSize: '0.75rem'}}>CYCLE TRACK & SWAP</button>
                )}
            </div>
        );
    }

    // --- RENDER STANDARD TASK UI ---
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
                <button disabled={disabledStart} onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Running', [`tasks.${type}.assignedTo`]: currentOp, [`tasks.${type}.startTime`]: Date.now() })} style={{ width: '100%', padding: '8px', background: disabledStart ? '#ccc' : '#333', color: disabledStart ? '#666' : '#fff', border: 'none', fontWeight: 'bold', cursor: disabledStart ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}>{btnText}</button>
            ) : (
                <>
                    {ovenBlocked ? (
                        <button disabled style={{ width: '100%', padding: '8px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '0.75rem' }}>OVEN IN USE (SPINDLE)</button>
                    ) : (
                        <button onClick={() => {
                            if (type === 'spinPaint') updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' }); 
                            else if (type === 'pole') updateDoc(doc(db,"fin_workorders", wo.id), { 'tasks.pole.status': 'Oven', 'tasks.pole.ovenStartTime': Date.now(), 'tasks.pole.ovenComplete': false });
                            else updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Complete' }); 
                        }} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>
                            {type === 'spinPaint' ? 'COMPLETE PAINT' : type === 'pole' ? 'COMPLETE & SEND TO OVEN' : 'COMPLETE TASK'}
                        </button>
                    )}
                </>
            )}
        </div>
    )
}

export default ActiveFloor;