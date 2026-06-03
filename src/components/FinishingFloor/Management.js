import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as oldCol, getDocs as oldGetDocs } from 'firebase/firestore';

const btnStyle = { padding: '10px 15px', border: 'none', borderRadius: 0, cursor: 'pointer', fontWeight: 'bold', textTransform: 'uppercase' };
const inputStyle = { padding: '8px', border: '2px solid #ccc', borderRadius: 0, width: '100%', boxSizing: 'border-box', fontFamily: 'Avenir, sans-serif' };
const labelStyle = { fontSize: '0.7rem', fontWeight: 'bold', color: '#666', display: 'block', marginBottom: '4px' };

const ROLES = ['setup', 'setup_manager', 'painter', 'hand_painter', 'paint_manager', 'packaging', 'floor_manager', 'office', 'admin'];
const TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'MESSAGING', 'MANAGEMENT', 'DAILY SUMMARY'];

const Management = ({ sysConfig, users, logs, writeLog, user, perms, setPerms }) => {
    
    const [config, setConfig] = useState({
        mixMins: sysConfig?.mixMins || 5,
        spinSetupMins: sysConfig?.spinSetupMins || 10,
        spinPaintMins: sysConfig?.spinPaintMins || 3,
        ovenMins: sysConfig?.ovenMins || 10, 
        handSmallMins: sysConfig?.handSmallMins || 1.35,
        handPoleMins: sysConfig?.handPoleMins || 10,
        poleMins: sysConfig?.poleMins || 5,
        potLifeMins: sysConfig?.potLifeMins || 189,
        recoatMins: sysConfig?.recoatMins || 90
    });

    const [demoSmall, setDemoSmall] = useState(3);
    const [demoLarge, setDemoLarge] = useState(2);

    const [uName, setUName] = useState("");
    const [uPin, setUPin] = useState("");
    const [uRole, setURole] = useState("painter");
    const [oldId, setOldId] = useState("");
    const [permissions, setPermissions] = useState(perms || {});

    if (user?.role !== 'admin' && user?.role !== 'floor_manager') {
        return <div style={{ padding: '30px', fontFamily: 'Avenir, sans-serif' }}><h2>ACCESS DENIED</h2><p>You need Admin or Floor Manager privileges to view this page.</p></div>;
    }

    const handleSaveConfig = async () => {
        await setDoc(doc(db, "fin_config", "settings"), config, { merge: true });
        writeLog("Updated Factory AI Timers", "admin");
        alert("Timers Updated Successfully!");
    };

    const handleSaveUser = async () => {
        if(!uName || !uPin) return alert("Need name and PIN");
        if (oldId && oldId !== uPin) await deleteDoc(doc(db, "fin_users", oldId));
        await setDoc(doc(db, "fin_users", uPin), { name: uName, pin: uPin, role: uRole });
        writeLog(oldId ? `Updated user ${uName} as ${uRole}` : `Added user ${uName} as ${uRole}`, "admin");
        setUName(""); setUPin(""); setURole("painter"); setOldId("");
    };

    const handleSavePermissions = async () => {
        await setDoc(doc(db, "fin_config", "permissions"), permissions);
        if (setPerms) setPerms(permissions); 
        writeLog("Updated Tab Access Permissions", "admin");
        alert("Permissions Matrix Saved!");
    };

    const togglePermission = (tab, role) => {
        const newPerms = { ...permissions };
        if (!newPerms[role]) newPerms[role] = [];
        if (newPerms[role].includes(tab)) newPerms[role] = newPerms[role].filter(t => t !== tab);
        else newPerms[role] = [...newPerms[role], tab];
        setPermissions(newPerms);
    };

    const handleWipePots = async () => {
        if(!window.confirm("Permanently delete all active paint pots? This cannot be undone.")) return;
        const snapshot = await getDocs(collection(db, "fin_pots"));
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        writeLog("WIPED ALL PAINT POTS", "admin");
    };

    const handleWipeWorkOrders = async () => {
        if(!window.confirm("Permanently delete ALL active work orders? This cannot be undone.")) return;
        const snapshot = await getDocs(collection(db, "fin_workorders"));
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
        writeLog("WIPED ALL WORK ORDERS", "admin");
    };

    const handleInjectDemoData = async () => {
        if (!window.confirm(`Inject ${demoSmall} Small and ${demoLarge} Large test orders to the floor using standard P-Codes?`)) return;

        const batch = writeBatch(db);
        const pCodes = ['P01', 'P15', 'P30']; 

        const generateWO = (index, sizeType) => {
            const isLarge = sizeType === 'large';
            const recipeCode = pCodes[index % pCodes.length];
            const letter = String.fromCharCode(65 + index); 

            const partsList = isLarge ? [
                { name: '1.5" Flat Sided Ring', qty: 80 },
                { name: 'Modern Cylinder Finial', qty: 20 },
                { name: '8ft Smooth Steel Pole', qty: 5 }
            ] : [
                { name: '1.5" Flat Sided Ring', qty: 50 },
                { name: 'Modern Cylinder Finial', qty: 15 },
                { name: '8ft Smooth Steel Pole', qty: 2 }
            ];

            return {
                id: `DEMO-WO-${Date.now().toString().slice(-4)}-${letter}`,
                soId: `SO-9${100 + index}`,
                recipe: recipeCode,
                type: 'Mixed', 
                totalParts: isLarge ? 100 : 65, 
                totalPoles: isLarge ? 5 : 2,
                partsList: partsList,
                currentPhase: 'Painting', 
                currentStepIndex: 0,
                // Refined Task Structure to match physical machine states
                tasks: {
                    spinSetup: { status: 'Pending', assignedTo: '' },
                    spinSpray: { status: 'Pending', assignedTo: '' },
                    spinBake: { status: 'Pending', assignedTo: '' },
                    poleSpray: { status: 'Pending', assignedTo: '' },
                    poleBake: { status: 'Pending', assignedTo: '' },
                    hand: { status: 'Pending', assignedTo: '' } 
                },
                machineAssigned: null // 'RED' or 'BLUE'
            };
        };

        let currentIndex = 0;
        for(let i=0; i<demoSmall; i++) {
            const wo = generateWO(currentIndex, 'small');
            batch.set(doc(collection(db, "fin_workorders"), wo.id), wo);
            currentIndex++;
        }
        for(let i=0; i<demoLarge; i++) {
            const wo = generateWO(currentIndex, 'large');
            batch.set(doc(collection(db, "fin_workorders"), wo.id), wo);
            currentIndex++;
        }

        await batch.commit();
        writeLog(`Injected ${demoSmall + demoLarge} Demo Orders onto Active Floor`, "admin");
        alert("Demo Data Injected Successfully! Check the Active Floor tab.");
    };

    return (
        <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', fontFamily: 'Avenir, sans-serif' }}>
            <div>
                <h2 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #333', paddingBottom: '10px', color: '#333' }}>AI PRODUCTION TIMERS (MINUTES)</h2>
                <div style={{ background: '#fff', border: '2px solid #333', padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <div><label style={labelStyle}>Mix Station</label><input type="number" step="0.1" value={config.mixMins} onChange={e=>setConfig({...config, mixMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Setup (Small Parts)</label><input type="number" step="0.1" value={config.spinSetupMins} onChange={e=>setConfig({...config, spinSetupMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Spin Paint Time</label><input type="number" step="0.1" value={config.spinPaintMins} onChange={e=>setConfig({...config, spinPaintMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Oven Bake Time</label><input type="number" step="0.1" value={config.ovenMins} onChange={e=>setConfig({...config, ovenMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Small)</label><input type="number" step="0.1" value={config.handSmallMins} onChange={e=>setConfig({...config, handSmallMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Hand Finish (Pole)</label><input type="number" step="0.1" value={config.handPoleMins} onChange={e=>setConfig({...config, handPoleMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Pole Paint (Per Piece)</label><input type="number" step="0.1" value={config.poleMins} onChange={e=>setConfig({...config, poleMins: Number(e.target.value)})} style={inputStyle} /></div>
                    <div style={{ borderTop: '2px dashed #ccc', paddingTop: '10px', gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <div><label style={{...labelStyle, color: '#CC6600'}}>Pot Life</label><input type="number" step="1" value={config.potLifeMins} onChange={e=>setConfig({...config, potLifeMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={{...labelStyle, color: '#d9534f'}}>Recoat Window</label><input type="number" step="1" value={config.recoatMins} onChange={e=>setConfig({...config, recoatMins: Number(e.target.value)})} style={inputStyle} /></div>
                    </div>
                    <button onClick={handleSaveConfig} style={{ ...btnStyle, gridColumn: '1 / -1', background: '#333', color: '#fff' }}>SAVE TIMERS</button>
                </div>

                <h2 style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginTop: '30px', color: '#333' }}>DATABASE MANAGEMENT</h2>
                <div style={{ background: '#fff0f0', border: '2px solid #d9534f', padding: '15px' }}>
                    <p style={{ fontSize: '0.8rem', color: '#666', marginTop: 0 }}>These actions permanently delete live production data.</p>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                        <button onClick={handleWipePots} style={{ flex: 1, padding: '10px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>WIPE POTS</button>
                        <button onClick={handleWipeWorkOrders} style={{ flex: 1, padding: '10px', background: '#d9534f', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>WIPE WORK ORDERS</button>
                    </div>
                </div>

                <h2 style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginTop: '30px', color: '#333' }}>OPERATOR DIRECTORY</h2>
                <div style={{ background: '#fff', border: '2px solid #333', padding: '20px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '10px', marginBottom: '10px' }}>
                        <input value={uName} onChange={e=>setUName(e.target.value)} placeholder="Name" disabled={!!oldId} style={{ ...inputStyle, background: oldId ? '#eee' : '#fff' }}/>
                        <input value={uPin} onChange={e=>setUPin(e.target.value)} placeholder="PIN" maxLength="4" style={inputStyle}/>
                        <select value={uRole} onChange={e=>setURole(e.target.value)} style={inputStyle}>
                            {ROLES.map(r => <option key={r} value={r}>{r.toUpperCase().replace(/_/g, ' ')}</option>)}
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button onClick={handleSaveUser} style={{ ...btnStyle, flex: 1, background: oldId ? '#CC6600' : '#333', color: '#fff' }}>{oldId ? 'UPDATE OPERATOR' : 'ADD OPERATOR'}</button>
                        {oldId && <button onClick={() => { setUName(""); setUPin(""); setURole("painter"); setOldId(""); }} style={{ ...btnStyle, background: '#888', color: '#fff' }}>CANCEL</button>}
                    </div>
                    <div style={{ marginTop: '20px', maxHeight: '300px', overflowY: 'auto' }}>
                        {users.map(u => (
                            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', borderBottom: '1px solid #eee' }}>
                                <span><b>{u.name}</b> ({u.role})</span>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button onClick={() => { setUName(u.name); setUPin(u.pin || ''); setURole(u.role || 'painter'); setOldId(u.id); }} style={{ background: '#fffdf5', color: '#000', border: '1px solid #CC6600', cursor: 'pointer', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}>EDIT</button>
                                    <button onClick={() => deleteDoc(doc(db, "fin_users", u.id))} style={{ background: '#fff0f0', color: '#d9534f', border: '1px solid #ffcccc', cursor: 'pointer', padding: '4px 8px', fontSize: '11px', fontWeight: 'bold' }}>DEL</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div>
                <h2 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #007bff', paddingBottom: '10px', color: '#007bff' }}>SIMULATION & DEMO DATA</h2>
                <div style={{ background: '#e3f2fd', border: '2px solid #007bff', padding: '20px', marginBottom: '30px' }}>
                    <p style={{ fontSize: '0.85rem', color: '#333', marginTop: 0, marginBottom: '15px' }}>
                        Configure and push synthetic work orders directly to the Active Floor. Uses established P-Codes (e.g. P01, P30) to test dispatch logic, routing, and spindle track animations. 
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginBottom: '15px' }}>
                        <div>
                            <label style={{...labelStyle, color: '#007bff'}}>Small Orders (&lt;70 Parts, 2 Poles)</label>
                            <input type="number" min="0" value={demoSmall} onChange={e=>setDemoSmall(Number(e.target.value))} style={{...inputStyle, borderColor: '#007bff'}} />
                        </div>
                        <div>
                            <label style={{...labelStyle, color: '#007bff'}}>Large Orders (100 Parts, 5 Poles)</label>
                            <input type="number" min="0" value={demoLarge} onChange={e=>setDemoLarge(Number(e.target.value))} style={{...inputStyle, borderColor: '#007bff'}} />
                        </div>
                    </div>
                    <button onClick={handleInjectDemoData} style={{ ...btnStyle, width: '100%', background: '#007bff', color: '#fff' }}>🚀 INJECT BATCH TO FLOOR</button>
                </div>

                <h2 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #333', paddingBottom: '10px', color: '#333' }}>SYSTEM LOGS</h2>
                <div style={{ background: '#333', color: '#00ff00', padding: '15px', height: '300px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem', border: '2px solid #000' }}>
                    {logs.map(l => (
                        <div key={l.id} style={{ marginBottom: '5px', borderBottom: '1px solid #444', paddingBottom: '5px' }}>
                            <span style={{ color: '#888' }}>[{new Date(l.t?.toDate()).toLocaleTimeString()}]</span> <span style={{ color: '#fff' }}>{l.u}:</span> {l.msg}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default Management;