import React, { useState } from 'react';
import { finishingDb as db } from '../../firebase'; // 🔒 SECURE IMPORT
import { doc, updateDoc, setDoc } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle } from './finishingStyles';

// Added setUser to the incoming props for seamless logout!
export const MixModal = ({ color, paintProfiles, setMixModal, writeLog, user, setUser }) => {
    // Defaulting to ML as requested
    const [volume, setVolume] = useState(1000);
    const [unit, setUnit] = useState('ML');

    // Find the paint profile for the selected color
    const profile = Object.values(paintProfiles).find(p => p.base === color) || paintProfiles[color];

    const rBase = profile ? Number(profile.rBase) : 0;
    const rCat = profile ? Number(profile.rCat) : 0;
    const totalParts = rBase + rCat;

    // Calculate Exact Volumes
    const baseResult = totalParts > 0 ? ((volume / totalParts) * rBase).toFixed(2) : '0.00';
    const catResult = totalParts > 0 ? ((volume / totalParts) * rCat).toFixed(2) : '0.00';

    const handleMix = async () => {
        await setDoc(doc(db, "fin_pots", color), { mixedAt: Date.now(), mixedBy: user.name });
        writeLog(`Mixed paint batch: ${color} (${volume} ${unit})`, 'paint');
        
        // Instant React Logout (No browser flash!)
        if (user.role !== 'admin' && user.role !== 'floor_manager') {
            if (setUser) setUser(null); 
            else window.location.reload(); // Fallback just in case
        }
        
        setMixModal(null);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
            <div style={{ background: '#fff', padding: '30px', border: '4px solid #333', width: '450px' }}>
                <h2 style={{ color: '#CC6600', marginTop: 0, borderBottom: '2px solid #ccc', paddingBottom: '10px' }}>PAINT MIX CALCULATOR</h2>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '5px', color: '#333' }}>{color}</div>
                
                {!profile ? (
                    <div style={{ color: '#d9534f', marginBottom: '20px', fontWeight: 'bold', background: '#fff0f0', padding: '10px', border: '1px solid #d9534f' }}>
                        ⚠️ No mix profile found. Please configure the Base and Catalyst ratios in the Finish Recipes tab.
                    </div>
                ) : (
                    <>
                        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '20px', fontWeight: 'bold' }}>
                            MIX RATIO: {rBase} Base to {rCat} Catalyst
                        </div>
                        
                        <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #ccc', marginBottom: '20px' }}>
                            <label style={{ fontWeight: 'bold', color: '#333', fontSize: '0.8rem' }}>TARGET TOTAL MIXED VOLUME</label>
                            <div style={{ display: 'flex', gap: '10px', marginTop: '10px', marginBottom: '15px' }}>
                                <input 
                                    type="number" 
                                    value={volume} 
                                    onChange={e => setVolume(e.target.value)} 
                                    style={{ ...inputStyle, fontSize: '1.5rem', fontWeight: 'bold', textAlign: 'center', flex: 1, borderColor: '#CC6600' }} 
                                />
                                <select 
                                    value={unit} 
                                    onChange={e => setUnit(e.target.value)} 
                                    style={{ ...inputStyle, fontSize: '1rem', flex: 1, borderColor: '#CC6600' }}
                                >
                                    <option value="ML">Milliliters (ML)</option>
                                    <option value="Ounces">Ounces</option>
                                    <option value="Quarts">Quarts</option>
                                    <option value="Gallons">Gallons</option>
                                </select>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div style={{ background: '#e3f2fd', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid #b6d4fe' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#555', fontWeight: 'bold' }}>BASE REQUIRED</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#007bff', margin: '5px 0' }}>{baseResult}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold' }}>{profile.base}</div>
                                </div>
                                <div style={{ background: '#e3f2fd', padding: '10px', borderRadius: '6px', textAlign: 'center', border: '1px solid #b6d4fe' }}>
                                    <div style={{ fontSize: '0.7rem', color: '#555', fontWeight: 'bold' }}>CATALYST REQUIRED</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#007bff', margin: '5px 0' }}>{catResult}</div>
                                    <div style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'bold' }}>{profile.cat}</div>
                                </div>
                            </div>
                        </div>
                    </>
                )}

                <button 
                    disabled={!profile} 
                    onClick={handleMix} 
                    style={{ ...btnStyle, width: '100%', background: profile ? '#CC6600' : '#ccc', color: '#fff', cursor: profile ? 'pointer' : 'not-allowed', border: 'none', padding: '12px' }}
                >
                    LOG MIX & START POT TIMER
                </button>
                <button onClick={() => setMixModal(null)} style={{ background: 'none', border: 'none', color: '#888', marginTop: '15px', cursor: 'pointer', width: '100%', fontWeight: 'bold' }}>CANCEL</button>
            </div>
        </div>
    );
};

export const QcModal = ({ qcModal, setQcModal, writeLog, user, setUser, workOrders }) => {
    const [good, setGood] = useState(qcModal.parts || 0);
    const [scrap, setScrap] = useState(0);

    const wo = workOrders.find(w => w.id === qcModal.id);

    const handleSubmit = async () => {
        if (!wo) return;

        const isCustomSalesOrder = wo.orderType === 'sales' || wo.soId;

        // THE REDLINE BLOCKER
        if (isCustomSalesOrder && Number(scrap) > 0) {
            await updateDoc(doc(db, "fin_workorders", wo.id), {
                redlineAlert: `${user.name} reported ${scrap} scrap on Custom Sales Order ${wo.soId || wo.id}. Completion blocked.`
            });
            writeLog(`Redline Alert: Scrap on Sales Order ${wo.id}`, 'alert');
            alert("❌ SALES ORDER SHORTAGE: Supervisor has been alerted. You cannot complete a custom order short.");
            
            if (user.role !== 'admin' && user.role !== 'floor_manager') setUser(null);
            setQcModal(null);
            return;
        }

        // Normal Completion Processing
        const updates = { 
            [`tasks.${qcModal.taskType}.status`]: 'Complete',
            completedParts: Number(good),
            scrapParts: Number(scrap)
        };
        
        // Move to oven if required by station
        if (qcModal.needsOven) {
            updates.stepStatus = "Oven";
            updates.ovenStartTime = Date.now();
        }

        await updateDoc(doc(db, "fin_workorders", wo.id), updates);
        writeLog(`Completed ${qcModal.taskType} on ${wo.id}`, 'production');
        
        // Auto Logout Standard Users on successful completion
        if (user.role !== 'admin' && user.role !== 'floor_manager') setUser(null);
        setQcModal(null);
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
            <div style={{ background: '#fff', padding: '30px', border: '4px solid #333', width: '400px' }}>
                <h2 style={{ marginTop: 0, borderBottom: '2px solid #333', paddingBottom: '10px' }}>QC & TASK COMPLETION</h2>
                <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#CC6600', marginBottom: '20px' }}>{wo?.id}</div>
                
                <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ ...labelStyle, color: '#28a745' }}>GOOD PIECES</label>
                        <input type="number" value={good} onChange={e => setGood(e.target.value)} style={{ ...inputStyle, fontSize: '1.5rem', textAlign: 'center', fontWeight: 'bold' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ ...labelStyle, color: '#d9534f' }}>SCRAP PIECES</label>
                        <input type="number" value={scrap} onChange={e => setScrap(e.target.value)} style={{ ...inputStyle, fontSize: '1.5rem', textAlign: 'center', fontWeight: 'bold' }} />
                    </div>
                </div>

                <button onClick={handleSubmit} style={{ ...btnStyle, width: '100%', background: '#333', color: '#fff' }}>CONFIRM & LOGOUT</button>
                <button onClick={() => setQcModal(null)} style={{ background: 'none', border: 'none', color: '#888', marginTop: '15px', cursor: 'pointer', width: '100%' }}>Cancel</button>
            </div>
        </div>
    );
};