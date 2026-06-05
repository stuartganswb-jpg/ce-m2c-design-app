import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { btnStyle, inputStyle, labelStyle } from './finishingStyles';

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
        return <div style={{ padding: '40px', fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center' }}>Access Denied. You need Admin or Floor Manager privileges to view this page.</div>;
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
                tasks: {
                    spinSetup: { status: 'Pending', assignedTo: '' },
                    spinSpray: { status: 'Pending', assignedTo: '' },
                    spinBake: { status: 'Pending', assignedTo: '' },
                    poleSpray: { status: 'Pending', assignedTo: '' },
                    poleBake: { status: 'Pending', assignedTo: '' },
                    hand: { status: 'Pending', assignedTo: '' } 
                },
                machineAssigned: null 
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
        <div style={{ padding: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', fontFamily: 'var(--sans)', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                
                <div>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>AI Production Timers (Minutes)</h2>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div><label style={labelStyle}>Mix Station</label><input type="number" step="0.1" value={config.mixMins} onChange={e=>setConfig({...config, mixMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Spin Setup (Small Parts)</label><input type="number" step="0.1" value={config.spinSetupMins} onChange={e=>setConfig({...config, spinSetupMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Spin Paint Time</label><input type="number" step="0.1" value={config.spinPaintMins} onChange={e=>setConfig({...config, spinPaintMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Oven Bake Time</label><input type="number" step="0.1" value={config.ovenMins} onChange={e=>setConfig({...config, ovenMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Hand Finish (Small)</label><input type="number" step="0.1" value={config.handSmallMins} onChange={e=>setConfig({...config, handSmallMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Hand Finish (Pole)</label><input type="number" step="0.1" value={config.handPoleMins} onChange={e=>setConfig({...config, handPoleMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div><label style={labelStyle}>Pole Paint (Per Piece)</label><input type="number" step="0.1" value={config.poleMins} onChange={e=>setConfig({...config, poleMins: Number(e.target.value)})} style={inputStyle} /></div>
                        <div style={{ borderTop: '1px solid var(--line)', paddingTop: '24px', gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            <div><label style={{...labelStyle, color: 'var(--brass)'}}>Pot Life</label><input type="number" step="1" value={config.potLifeMins} onChange={e=>setConfig({...config, potLifeMins: Number(e.target.value)})} style={inputStyle} /></div>
                            <div><label style={{...labelStyle, color: '#d9534f'}}>Recoat Window</label><input type="number" step="1" value={config.recoatMins} onChange={e=>setConfig({...config, recoatMins: Number(e.target.value)})} style={inputStyle} /></div>
                        </div>
                        <button onClick={handleSaveConfig} style={{ ...btnStyle, gridColumn: '1 / -1', marginTop: '8px' }}>Save Timers</button>
                    </div>
                </div>

                <div>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: '#d9534f' }}>Database Management</h2>
                    </div>
                    <div style={{ background: '#fdf2f2', border: '1px solid #d9534f', padding: '30px', borderRadius: '2px' }}>
                        <p style={{ fontSize: '0.9rem', color: 'var(--ink)', marginTop: 0, marginBottom: '20px' }}>These actions permanently delete live production data. Use with extreme caution.</p>
                        <div style={{ display: 'flex', gap: '16px' }}>
                            <button onClick={handleWipePots} style={{ flex: 1, padding: '16px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>Wipe Pots</button>
                            <button onClick={handleWipeWorkOrders} style={{ flex: 1, padding: '16px', background: '#d9534f', color: '#fff', border: '1px solid #d9534f', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Wipe Work Orders</button>
                        </div>
                    </div>
                </div>

                <div>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Operator Directory</h2>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '16px', marginBottom: '24px' }}>
                            <input value={uName} onChange={e=>setUName(e.target.value)} placeholder="Full Name" disabled={!!oldId} style={{ ...inputStyle, background: oldId ? 'var(--paper-2)' : '#fff' }}/>
                            <input value={uPin} onChange={e=>setUPin(e.target.value)} placeholder="PIN" maxLength="4" style={inputStyle}/>
                            <select value={uRole} onChange={e=>setURole(e.target.value)} style={inputStyle}>
                                {ROLES.map(r => <option key={r} value={r}>{r.toUpperCase().replace(/_/g, ' ')}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', marginBottom: '30px' }}>
                            <button onClick={handleSaveUser} style={{ ...btnStyle, flex: 1, background: oldId ? 'var(--brass)' : 'var(--ink)' }}>{oldId ? 'Update Operator' : 'Add Operator'}</button>
                            {oldId && <button onClick={() => { setUName(""); setUPin(""); setURole("painter"); setOldId(""); }} style={{ ...btnStyle, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)' }}>Cancel</button>}
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {users.map(u => (
                                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
                                    <span style={{ fontSize: '0.95rem', color: 'var(--ink)' }}>
                                        <span style={{ fontWeight: 500 }}>{u.name}</span> 
                                        <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginLeft: '12px' }}>{u.role.replace(/_/g, ' ')}</span>
                                    </span>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button onClick={() => { setUName(u.name); setUPin(u.pin || ''); setURole(u.role || 'painter'); setOldId(u.id); }} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Edit</button>
                                        <button onClick={() => deleteDoc(doc(db, "fin_users", u.id))} style={{ background: 'transparent', color: '#d9534f', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: '0 8px' }}>×</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Permissions Matrix</h2>
                    </div>
                    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', overflowX: 'auto', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'center' }}>
                            <thead style={{ background: 'var(--paper)' }}>
                                <tr>
                                    <th style={{ padding: '16px', textAlign: 'left', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Tab</th>
                                    {ROLES.map(r => (
                                        <th key={r} style={{ padding: '16px', borderBottom: '1px solid var(--line)', borderLeft: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>
                                            {r.replace(/_/g, ' ')}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {TABS.map(tab => (
                                    <tr key={tab} style={{ borderBottom: '1px solid var(--line)' }}>
                                        <td style={{ padding: '16px', textAlign: 'left', fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}>{tab}</td>
                                        {ROLES.map(role => (
                                            <td key={role} style={{ padding: '16px', borderLeft: '1px solid var(--line)' }}>
                                                <input 
                                                    type="checkbox" 
                                                    checked={permissions[role]?.includes(tab) || false} 
                                                    onChange={() => togglePermission(tab, role)} 
                                                    style={{ cursor: 'pointer' }}
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <button onClick={handleSavePermissions} style={{ ...btnStyle, width: '100%', marginTop: '24px' }}>
                            Save Permissions Matrix
                        </button>
                    </div>
                </div>

            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                <div>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Simulation & Demo Data</h2>
                    </div>
                    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px' }}>
                        <p style={{ fontSize: '0.95rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '24px', lineHeight: '1.5' }}>
                            Configure and push synthetic work orders directly to the Active Floor. Uses established P-Codes (e.g. P01, P30) to test dispatch logic, routing, and spindle track animations. 
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                            <div>
                                <label style={labelStyle}>Small Orders (&lt;70 Parts, 2 Poles)</label>
                                <input type="number" min="0" value={demoSmall} onChange={e=>setDemoSmall(Number(e.target.value))} style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Large Orders (100 Parts, 5 Poles)</label>
                                <input type="number" min="0" value={demoLarge} onChange={e=>setDemoLarge(Number(e.target.value))} style={inputStyle} />
                            </div>
                        </div>
                        <button onClick={handleInjectDemoData} style={{ ...btnStyle, width: '100%', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', transition: 'background 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = 'var(--ink)'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'var(--paper-2)'; e.currentTarget.style.color = 'var(--ink)'; }}>
                            Inject Batch to Floor
                        </button>
                    </div>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '24px' }}>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>System Logs</h2>
                    </div>
                    <div style={{ background: 'var(--dark)', color: '#a8a5a0', padding: '24px', flex: 1, minHeight: '400px', overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', borderRadius: '2px' }}>
                        {logs.map(l => (
                            <div key={l.id} style={{ marginBottom: '8px', borderBottom: '1px solid #333', paddingBottom: '8px' }}>
                                <span style={{ opacity: 0.5, marginRight: '12px' }}>[{new Date(l.t?.toDate()).toLocaleTimeString()}]</span> 
                                <span style={{ color: 'var(--paper)', fontWeight: 'bold' }}>{l.u}:</span> {l.msg}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Management;