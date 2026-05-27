import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; 
import { doc, updateDoc } from "firebase/firestore";

const cardStyle = { background: '#fff', padding: '15px', border: '1px solid #ccc', boxShadow: '4px 4px 0 rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column' };
const btnStyle = { padding: '10px 15px', border: 'none', cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase' };
const inputStyle = { padding: '8px', border: '2px solid #ccc', width: '100%', boxSizing: 'border-box' };

const ActiveFloor = ({ workOrders, recipes, activePots, sysConfig, setMixModal, now, user, setQcModal, users }) => {
  const activeWOs = workOrders.filter(w => w.currentPhase === "Painting");
  const queuedWOs = workOrders.filter(w => w.currentPhase === "Setup" || (w.currentPhase === "Painting" && w.stepStatus !== "Oven" && !Object.values(w.tasks || {}).some(t => t.status === "Running")));
  const activeJobs = workOrders.filter(j => j.tasks && Object.values(j.tasks).some(t => t.status === 'Running'));
  const redlineWOs = workOrders.filter(w => w.redlineAlert);

  const floorOps = users?.filter(u => ['painter', 'hand_painter', 'paint_manager'].includes(u.role)) || [];

  const cfg = {
    potLifeMins: sysConfig?.potLifeMins || 189, recoatMins: sysConfig?.recoatMins || 90,
    mixMins: sysConfig?.mixMins || 5, spinMins: sysConfig?.spinMins || 6,
    ovenMins: sysConfig?.ovenMins || 6, handSmallMins: sysConfig?.handSmallMins || 1.35,
    handPoleMins: sysConfig?.handPoleMins || 10, poleMins: sysConfig?.poleMins || 5
  };

  const colorGroups = {};
  activeWOs.forEach(wo => {
      const r = recipes[wo.recipe];
      if (!r || !r.steps || r.steps.length <= wo.currentStepIndex) return;
      const step = r.steps[wo.currentStepIndex];
      if (!colorGroups[step.color]) colorGroups[step.color] = [];
      colorGroups[step.color].push({ wo, step });
  });

  const ovenContents = activeWOs.filter(w => w.stepStatus === "Oven");
  const ovenHasPoles = ovenContents.some(w => w.type === 'Poles');
  const ovenHasSpin = ovenContents.some(w => w.type !== 'Poles');

  const getRemainingMins = (timestampMs, totalMinsAllowed) => {
      if (!timestampMs) return null;
      return Math.max(0, Math.floor(((totalMinsAllowed * 60000) - (now - timestampMs)) / 60000));
  };

  // --- AI DISPATCHER LOGIC ---
  const busyOperators = activeJobs.map(job => {
      let runningTask = Object.values(job.tasks).find(t => t.status === 'Running');
      return runningTask?.assignedTo;
  });

  const getAiRecommendation = (taskType) => {
      if (!users || users.length === 0) return "Pending";
      let eligible = users.filter(u => {
          if (taskType === 'spin') return ['painter', 'hand_painter', 'paint_manager'].includes(u.role);
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

      if (taskType === 'spin') {
          let idleHandPainter = available.find(u => u.role === 'hand_painter'); 
          return idleHandPainter ? idleHandPainter.name : available[0].name;
      }
      return available[0].name;
  };

  return (
    <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: '3fr 1.2fr', gap: '30px', height: '100%' }}>
      {/* LEFT: PIPELINE & QUEUE */}
      <div>
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
                            <span style={{ background: potBg, color: potColor, padding: '5px 10px', borderRadius: '4px', fontSize: '0.9rem', fontWeight: 'bold' }}>
                                POT LIFE: {potRemMins} MINS LEFT
                            </span>
                        ) : (
                            <button onClick={() => setMixModal(color)} style={{ padding: '8px 15px', background: '#007bff', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                                START {cfg.mixMins} MIN MIX
                            </button>
                        )}
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>SPINNING</div>
                            {colorGroups[color]?.map(item => item.wo.tasks?.spin?.status !== 'Complete' && item.wo.tasks?.spin?.status !== 'N/A' && (
                                <TaskCard key={item.wo.id+"spin"} wo={item.wo} type="spin" step={item.step} user={user} setQcModal={setQcModal} cfg={cfg} activePots={activePots} ovenHasPoles={ovenHasPoles} now={now} aiRec={getAiRecommendation('spin')} users={users} activeWOs={activeWOs} />
                            ))}
                        </div>

                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>POLES</div>
                            {colorGroups[color]?.map(item => item.wo.tasks?.pole?.status !== 'Complete' && item.wo.tasks?.pole?.status !== 'N/A' && (
                                <TaskCard key={item.wo.id+"pole"} wo={item.wo} type="pole" step={item.step} user={user} setQcModal={setQcModal} cfg={cfg} activePots={activePots} ovenHasSpin={ovenHasSpin} now={now} aiRec={getAiRecommendation('pole')} users={users} activeWOs={activeWOs} />
                            ))}
                        </div>

                        <div style={{ background: '#f8f9fa', border: '1px solid #ccc', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '10px', color: '#333' }}>HAND FINISH</div>
                            {colorGroups[color]?.map(item => item.wo.tasks?.hand?.status !== 'Complete' && item.wo.tasks?.hand?.status !== 'N/A' && (
                                <TaskCard key={item.wo.id+"hand"} wo={item.wo} type="hand" step={item.step} user={user} setQcModal={setQcModal} cfg={cfg} activePots={activePots} now={now} aiRec={getAiRecommendation('hand')} users={users} activeWOs={activeWOs} />
                            ))}
                        </div>

                        <div style={{ background: '#fff0f0', border: '1px solid #d9534f', padding: '10px' }}>
                            <div style={{ fontWeight: '900', fontSize: '0.8rem', textAlign: 'center', borderBottom: '2px solid #d9534f', paddingBottom: '10px', marginBottom: '10px', color: '#d9534f' }}>OVEN (AUTO)</div>
                            {ovenContents.filter(w => recipes[w.recipe]?.steps[w.currentStepIndex]?.color === color).map(wo => {
                                const rem = getRemainingMins(wo.ovenStartTime, cfg.ovenMins);
                                const isReady = rem <= 0;
                                return (
                                    <div key={wo.id} style={{ ...cardStyle, borderLeft: isReady ? '5px solid #28a745' : '5px solid #d9534f', textAlign: 'center' }}>
                                        <b style={{color: '#333'}}>{wo.id}</b>
                                        <div style={{ fontSize: '0.7rem', color: '#666' }}>{wo.type}</div>
                                        {isReady ? (
                                            <button onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { stepStatus: "Pending", currentStepIndex: wo.currentStepIndex + 1, lastCoatTime: Date.now() })} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', marginTop: '10px', cursor: 'pointer' }}>UNLOAD OVEN</button>
                                        ) : (
                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#d9534f', marginTop: '10px' }}>{rem} MINS LEFT</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            );
        })}

        {/* IN QUEUE SECTION */}
        <h2 style={{ margin: '40px 0 10px 0', color: '#333', borderBottom: '2px solid #333', paddingBottom: '10px' }}>IN QUEUE (UPCOMING SHIFT WORKLOAD)</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
            {queuedWOs.length === 0 && <div style={{ color: '#666', fontStyle: 'italic' }}>No pending orders staged for production.</div>}
            {queuedWOs.map(wo => (
                <div key={wo.id} style={{ ...cardStyle, borderLeft: '5px solid #ccc', background: '#f8f9fa' }}>
                    <div style={{ fontWeight: 'bold', color: '#333' }}>{wo.id}</div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>Recipe: {wo.recipe} | {wo.type}</div>
                    <div style={{ fontSize: '0.7rem', color: '#007bff', marginTop: '5px', fontWeight: 'bold' }}>Phase: {wo.currentPhase.toUpperCase()}</div>
                </div>
            ))}
        </div>
      </div>

      {/* RIGHT: LIVE ASSIGNMENTS, OVERVIEW & AI LOGIC */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* LIVE OPERATOR STATUS WITH TIMERS */}
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

                          let estTime = 0;
                          if (tType === 'spin') estTime = cfg.spinMins;
                          if (tType === 'pole') estTime = (activeOpJob.totalParts || 0) * cfg.poleMins;
                          if (tType === 'hand') estTime = activeOpJob.type === 'Poles' ? ((activeOpJob.totalParts || 0) * cfg.handPoleMins) : ((activeOpJob.totalParts || 0) * cfg.handSmallMins);

                          if (taskData.startTime) {
                              let elapsedMins = (now - taskData.startTime) / 60000;
                              let leftMins = Math.ceil(estTime - elapsedMins);
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

          {/* PIPELINE OVERVIEW (THE NEW WINDOW) */}
          <div style={{ background: '#fff', padding: '20px', border: '2px solid #333' }}>
              <h3 style={{ marginTop: 0, color: '#333', borderBottom: '1px solid #ccc', paddingBottom: '10px' }}>PIPELINE OVERVIEW</h3>
              {activeWOs.length === 0 ? <p style={{color: '#666', fontSize: '0.8rem'}}>No active jobs in pipeline.</p> : (
                  activeWOs.map(wo => {
                      const recipe = recipes[wo.recipe];
                      const steps = recipe?.steps || [];
                      const currentStep = wo.currentStepIndex || 0;
                      
                      let recoatWarning = null;
                      if (wo.lastCoatTime) {
                          const recoatMinsLeft = Math.max(0, Math.floor(((cfg.recoatMins * 60000) - (now - wo.lastCoatTime)) / 60000));
                          if (recoatMinsLeft < 30) recoatWarning = `⚠️ RECOAT DANGER: ${recoatMinsLeft}m LEFT!`;
                      }

                      let remainingMinsToFinish = 0;
                      for (let i = currentStep; i < steps.length; i++) {
                          if (steps[i].app === 'None') continue;
                          let stepMins = wo.type === 'Poles' ? ((wo.totalParts || 0) * cfg.poleMins) : cfg.spinMins;
                          stepMins += cfg.ovenMins;
                          remainingMinsToFinish += stepMins;
                      }
                      
                      const estCompletionDate = new Date(now + remainingMinsToFinish * 60000).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

                      return (
                          <div key={wo.id} style={{ border: '1px solid #eee', padding: '10px', marginBottom: '10px', borderLeft: recoatWarning ? '4px solid #d9534f' : '4px solid #333' }}>
                              <div style={{ fontWeight: 'bold', color: '#333', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                  <span>{wo.soId ? `SO: ${wo.soId} | ` : ''}WO: {wo.id}</span>
                                  <span style={{ color: '#CC6600' }}>{wo.recipe}</span>
                              </div>
                              {recoatWarning && <div style={{ color: '#d9534f', fontSize: '0.75rem', fontWeight: 'bold', marginTop: '3px' }}>{recoatWarning}</div>}
                              
                              <div style={{ display: 'flex', gap: '5px', marginTop: '8px', flexWrap: 'wrap' }}>
                                  {steps.map((st, idx) => {
                                      if (st.app === 'None') return null;
                                      return (
                                          <span key={idx} style={{ padding: '2px 6px', fontSize: '0.65rem', borderRadius: '4px', background: idx === currentStep ? '#007bff' : (idx < currentStep ? '#28a745' : '#eee'), color: idx <= currentStep ? '#fff' : '#666', textDecoration: idx < currentStep ? 'line-through' : 'none' }}>
                                              S{st.step}: {st.color}
                                          </span>
                                      );
                                  })}
                              </div>
                              
                              <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '8px' }}>
                                  {wo.lastCoatTime && <div>Last Phase: {new Date(wo.lastCoatTime).toLocaleTimeString()}</div>}
                                  <div style={{ fontWeight: 'bold', color: '#333' }}>Est. Final Completion: {estCompletionDate}</div>
                              </div>
                          </div>
                      );
                  })
              )}
          </div>

          {/* AI DISPATCH BRAIN */}
          <div style={{ background: '#333', padding: '20px', color: '#00ff00', fontFamily: 'monospace', fontSize: '0.8rem', border: '4px solid #000' }}>
              <h3 style={{ marginTop: 0, color: '#fff', borderBottom: '1px solid #555', paddingBottom: '10px' }}>AI DISPATCH BRAIN</h3>
              <div style={{ marginBottom: '10px' }}>{'>'} Scanning floor capacity...</div>
              <div style={{ marginBottom: '10px' }}>{'>'} {activeJobs.length} tasks currently running.</div>
              <div style={{ marginBottom: '10px', color: '#ffcc00' }}>{'>'} RULE: Max 1 manual machine per operator enforced.</div>
              <div style={{ marginBottom: '10px', color: '#ffcc00' }}>{'>'} RULE: Paint Manager acts as overflow (last resort).</div>
              {Object.keys(colorGroups).map(c => (
                  <div key={c} style={{ marginLeft: '10px', color: '#aaa' }}>- Batch {c} routing active.</div>
              ))}
              <div style={{ marginTop: '15px' }}>{'>'} Waiting for operator PIN confirmation...</div>
          </div>

      </div>
    </div>
  );
};

const TaskCard = ({ wo, type, step, user, setQcModal, cfg, activePots, ovenHasPoles, ovenHasSpin, now, aiRec, users, activeWOs }) => {
    const task = wo.tasks?.[type] || {}; 
    const isRunning = task.status === 'Running';
    
    const [manualOp, setManualOp] = useState("");
    const currentOp = manualOp || (aiRec === "NO OP AVAILABLE" ? "" : aiRec);

    let estTime = 0;
    if (type === 'spin') estTime = cfg.spinMins;
    if (type === 'pole') estTime = (wo.totalParts || 0) * cfg.poleMins;
    if (type === 'hand') estTime = wo.type === 'Poles' ? ((wo.totalParts || 0) * cfg.handPoleMins) : ((wo.totalParts || 0) * cfg.handSmallMins);

    const eligibleUsers = users?.filter(u => {
        const isAdminOrMgr = ['admin', 'floor_manager', 'paint_manager'].includes(u.role);
        if (type === 'spin') return isAdminOrMgr || ['painter', 'hand_painter'].includes(u.role);
        if (type === 'pole') return isAdminOrMgr || u.role === 'painter';
        if (type === 'hand') return isAdminOrMgr || u.role === 'hand_painter';
        return false;
    }) || [];

    const loggedInUserHasAccess = ['admin', 'floor_manager', 'paint_manager'].includes(user?.role) || 
                                  (user?.role === 'painter' && ['spin', 'pole'].includes(type)) || 
                                  (user?.role === 'hand_painter' && ['spin', 'hand'].includes(type));

    let selectedOpManualLoad = 0;
    activeWOs.forEach(w => {
        if(w.tasks) {
            Object.entries(w.tasks).forEach(([tType, t]) => {
                if(t.status === 'Running' && t.assignedTo === currentOp && ['spin', 'pole', 'hand'].includes(tType)) {
                    selectedOpManualLoad++;
                }
            });
        }
    });

    const isSelectedOpBusy = selectedOpManualLoad >= 1;
    
    const needsOven = ['spin', 'pole'].includes(type);
    let ovenBlocked = (needsOven && type === 'spin' && ovenHasPoles) || (needsOven && type === 'pole' && ovenHasSpin);

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

    return (
        <div style={{ ...cardStyle, borderLeft: isRunning ? '5px solid #007bff' : '5px solid #333', position: 'relative' }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#333', display: 'flex', justifyContent: 'space-between' }}>
                {wo.id}
            </div>
            
            <div style={{ fontSize: '0.7rem', color: '#666', margin: '5px 0' }}>Step {step.step}: {step.color}</div>
            
            {isRunning ? (
                <div style={{ fontSize: '0.75rem', background: '#e3f2fd', color: '#007bff', padding: '4px', borderRadius: '4px', marginBottom: '5px', fontWeight: 'bold' }}>Active: {task.assignedTo}</div>
            ) : (
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#CC6600' }}>ASSIGN OPERATOR</label>
                    <select 
                        value={currentOp} 
                        onChange={(e) => setManualOp(e.target.value)} 
                        style={{ ...inputStyle, padding: '4px', fontSize: '0.75rem', width: '100%', borderColor: '#CC6600' }}
                    >
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
                <button 
                    disabled={disabledStart} 
                    onClick={() => updateDoc(doc(db,"fin_workorders", wo.id), { [`tasks.${type}.status`]: 'Running', [`tasks.${type}.assignedTo`]: currentOp, [`tasks.${type}.startTime`]: Date.now() })} 
                    style={{ width: '100%', padding: '8px', background: disabledStart ? '#ccc' : '#333', color: disabledStart ? '#666' : '#fff', border: 'none', fontWeight: 'bold', cursor: disabledStart ? 'not-allowed' : 'pointer', fontSize: '0.75rem' }}
                >
                    {btnText}
                </button>
            ) : (
                <>
                    {ovenBlocked ? (
                        <button disabled style={{ width: '100%', padding: '8px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '0.75rem' }}>OVEN BLOCKED</button>
                    ) : (
                        <button onClick={() => setQcModal({ id: wo.id, parts: wo.totalParts, type: wo.type, phase: 'Painting', taskType: type, needsOven })} style={{ width: '100%', padding: '8px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.75rem' }}>{needsOven ? 'COMPLETE & SEND TO OVEN' : 'COMPLETE TASK'}</button>
                    )}
                </>
            )}
        </div>
    )
}

export default ActiveFloor;