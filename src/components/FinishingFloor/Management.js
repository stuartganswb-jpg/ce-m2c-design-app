import React, { useState } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, deleteDoc, collection, getDocs, writeBatch } from "firebase/firestore";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as oldCol, getDocs as oldGetDocs } from 'firebase/firestore';
import { cardStyle, btnStyle, inputStyle, labelStyle } from './finishingStyles';

const ROLES = ['setup', 'setup_manager', 'painter', 'hand_painter', 'paint_manager', 'packaging', 'floor_manager', 'office', 'admin'];
const TABS = ['SETUP QUEUE', 'ACTIVE FLOOR', 'FINISH RECIPES', 'SUPPLIES', 'MESSAGING', 'MANAGEMENT', 'DAILY SUMMARY'];

const Management = ({ sysConfig, users, logs, writeLog, user, perms, setPerms }) => {
    // 1. Timers State - UPDATED FOR DUAL-STATION SPINDLE
    const [config, setConfig] = useState({
        mixMins: sysConfig?.mixMins || 5,
        spinSetupMins: sysConfig?.spinSetupMins || 10,
        spinPaintMins: sysConfig?.spinPaintMins || 3,
        ovenMins: sysConfig?.ovenMins || 10, // Synced to setup time
        handSmallMins: sysConfig?.handSmallMins || 1.35,
        handPoleMins: sysConfig?.handPoleMins || 10,
        poleMins: sysConfig?.poleMins || 5,
        potLifeMins: sysConfig?.potLifeMins || 189,
        recoatMins: sysConfig?.recoatMins || 90
    });

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

    const syncLegacyPaintProfiles = async () => {
        if(!window.confirm("WARNING: Pull Paint Profiles from Legacy Firebase?")) return;
        try {
            const oldApp = initializeApp({ apiKey: "AIzaSyAmXhVF4qX8WKW-8erHZfgSBQqkuqJ-hu0", authDomain: "shop-floor-b84ae.firebaseapp.com", projectId: "shop-floor-b84ae" }, "LegacyPaintApp");
            const oldDb = getFirestore(oldApp);
            let snap = await oldGetDocs(oldCol(oldDb, "fin_paint_profiles"));
            if (snap.empty) snap = await oldGetDocs(oldCol(oldDb, "paint_profiles"));

            let count = 0; 
            const batch = writeBatch(db);
            snap.docs.forEach(d => { 
                batch.set(doc(collection(db, "fin_paint_profiles"), d.id), d.data()); 
                count++; 
            });
            await batch.commit(); 
            alert(`✅ Successfully synced ${count} paint profiles from Legacy Database!`);
            writeLog(`Synced ${count} legacy paint profiles`, "admin");
        } catch(e) { console.error(e); alert("Sync failed. Check console for details."); }
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
                    <button onClick={syncLegacyPaintProfiles} style={{ width: '100%', padding: '10px', background: '#CC6600', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>🔄 SYNC LEGACY PROFILES</button>
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
                <h2 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #333', paddingBottom: '10px', color: '#333' }}>SYSTEM LOGS</h2>
                <div style={{ background: '#333', color: '#00ff00', padding: '15px', height: '400px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.8rem', border: '2px solid #000' }}>
                    {logs.map(l => (
                        <div key={l.id} style={{ marginBottom: '5px', borderBottom: '1px solid #444', paddingBottom: '5px' }}>
                            <span style={{ color: '#888' }}>[{new Date(l.t?.toDate()).toLocaleTimeString()}]</span> <span style={{ color: '#fff' }}>{l.u}:</span> {l.msg}
                        </div>
                    ))}
                </div>

                <h2 style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginTop: '30px', color: '#333' }}>PERMISSIONS SETUP</h2>
                <div style={{ background: '#fff', border: '2px solid #333', overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'center' }}>
                        <thead style={{ background: '#333', color: '#fff' }}>
                            <tr>
                                <th style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid #000' }}>TAB</th>
                                {ROLES.map(r => (
                                    <th key={r} style={{ padding: '10px 5px', height: '80px', verticalAlign: 'bottom', borderBottom: '2px solid #000', borderLeft: '1px solid #444' }}>
                                        {r.replace(/_/g, ' ').toUpperCase()}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {TABS.map(tab => (
                                <tr key={tab} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '10px', textAlign: 'left', fontWeight: 'bold', borderRight: '2px solid #333' }}>{tab}</td>
                                    {ROLES.map(role => (
                                        <td key={role} style={{ padding: '10px', borderLeft: '1px solid #eee' }}>
                                            <input type="checkbox" checked={permissions[role]?.includes(tab) || false} onChange={() => togglePermission(tab, role)} style={{ cursor: 'pointer', transform: 'scale(1.3)' }} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <button onClick={handleSavePermissions} style={{ ...btnStyle, width: '100%', background: '#CC6600', color: '#fff', borderRadius: 0, border: 'none', marginTop: '15px' }}>SAVE MATRIX</button>
                </div>
            </div>
        </div>
    );
};

export default Management;