import React, { useState } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, setDoc, deleteDoc, updateDoc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as oldCol, getDocs as oldGetDocs } from 'firebase/firestore';

const shopDb = { collection: (colName) => collection(db, colName.startsWith('shop_') ? colName : `shop_${colName}`) };
const cleanId = (s1, s2) => `${s1}_${s2}`.replace(/[^a-zA-Z0-9]/g, "_");

const ShopEngineering = ({ activeTab, user, hqParts, routings, programs, programsMap, machines, categories, setupCodes, tooling, materials, users, perms, setPerms, writeLog, handleDelete, safeUserRole, TABS }) => {
    
    const [routingForm, setRoutingForm] = useState({ id: null, partId: '', isRawMat: false, matProfile: '', matLength: '', ops: [] });
    const [progForm, setProgForm] = useState({ id: null, name: '', machine: '', timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} });
    const [toolForm, setToolForm] = useState({ item: '', desc: '', machine: '', max: '', qty: '', reorder: '' });
    const [matForm, setMatForm] = useState({ type: '', thick: '', width: '' });
    
    const [adminForm, setAdminForm] = useState({ catName: '', catType: 'Manual', macName: '', macCat: '', scName: '', uName: '', uPin: '', uRole: 'operator', oldPin: '' });

    // ==========================================
    // 🚀 THE MIGRATION ENGINE (BRIDGES 1 & 2)
    // ==========================================
    const handleMigrateToHQ = async () => {
        if (!window.confirm("⚠️ DEV MIGRATION: This will copy all Shop Routings and Programs into the HQ Master Library. Proceed?")) return;
        
        try {
            const batch = writeBatch(db);
            let count = 0;

            for (const routing of routings) {
                const hqPart = hqParts.find(p => 
                    p.id === routing.partId || 
                    p.legacyErpId === routing.partId || 
                    p.itemName === routing.partId ||
                    p.id === routing.displayName
                );

                if (hqPart) {
                    const bundledOps = routing.ops.map(op => {
                        const prog = programsMap[op.progId] || {};
                        return {
                            machine: op.machine,
                            progId: op.progId,
                            progName: prog.name || 'Unknown Program',
                            setupTime: prog.setupTime || 0,
                            timePerPiece: prog.timePerPiece || 0,
                            steps: prog.steps || 'No instructions provided.'
                        };
                    });

                    const hqRef = doc(db, "Approved_Designs", hqPart.id);
                    batch.set(hqRef, {
                        manufacturingSpecs: {
                            ...hqPart.manufacturingSpecs,
                            shopRoutings: bundledOps
                        }
                    }, { merge: true });
                    count++;
                }
            }

            await batch.commit();
            writeLog(`Migrated ${count} Routings to HQ`, 'admin');
            alert(`✅ MIGRATION COMPLETE! Successfully linked ${count} Shop Routings to their HQ Master Assemblies.`);
        } catch (error) {
            console.error(error);
            alert("Migration Failed. Check console.");
        }
    };

    // ==========================================
    // ENGINEERING ACTIONS
    // ==========================================
    const handleSaveRouting = async () => {
        if(!routingForm.partId || routingForm.ops.length === 0) return alert("Select an HQ Part and add at least one Operation.");
        
        const hqPart = hqParts.find(p => p.id === routingForm.partId);
        const displayId = hqPart ? (hqPart.legacyErpId !== 'PENDING' ? hqPart.legacyErpId : hqPart.itemName) : routingForm.partId;
        const shopRefId = routingForm.id || cleanId(routingForm.partId, ""); 

        // 1. Save to Legacy Shop Floor Collection
        await setDoc(doc(shopDb.collection("routings"), shopRefId), {
            partId: routingForm.partId,
            displayName: displayId,
            isRawMat: routingForm.isRawMat,
            matProfile: routingForm.matProfile,
            matLength: routingForm.matLength,
            ops: routingForm.ops
        }, { merge: true });

        // 2. 🚀 BRIDGE 2: Dual-Save directly into HQ Master Library
        if (hqPart) {
            const bundledOps = routingForm.ops.map(op => {
                const prog = programsMap[op.progId] || {};
                return {
                    machine: op.machine,
                    progId: op.progId,
                    progName: prog.name || '',
                    setupTime: prog.setupTime || 0,
                    timePerPiece: prog.timePerPiece || 0,
                    steps: prog.steps || ''
                };
            });

            await setDoc(doc(db, "Approved_Designs", hqPart.id), {
                manufacturingSpecs: {
                    ...hqPart.manufacturingSpecs,
                    shopRoutings: bundledOps
                }
            }, { merge: true });
        }

        writeLog(`Engineered Routing: ${displayId}`, 'engineering');
        setRoutingForm({ id: null, partId: '', isRawMat: false, matProfile: '', matLength: '', ops: [] });
        alert("✅ Routing saved to Shop Floor AND HQ Master Library.");
    };

    const handleSaveProgram = async () => {
        if(!progForm.name || !progForm.machine) return alert("Name & Machine required.");
        let drawingUrl = null;
        if(progForm.file) { const fRef = ref(storage, `drawings/${progForm.name}.pdf`); await uploadBytesResumable(fRef, progForm.file); drawingUrl = await getDownloadURL(fRef); }
        const payload = { name: progForm.name, machine: progForm.machine, timePerPiece: parseFloat(progForm.timePerPiece)||0, setupTime: parseFloat(progForm.setupTime)||0, setupCode: progForm.setupCode, steps: progForm.steps, toolTimes: progForm.toolTimes };
        if(drawingUrl) payload.drawingUrl = drawingUrl;
        await setDoc(doc(shopDb.collection("programs"), progForm.id || cleanId(progForm.name, "")), payload, {merge:true});
        writeLog(`Saved Operation Program: ${progForm.name}`, 'engineering');
        setProgForm({ id: null, name: '', machine: '', timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} });
    };

    const handleToolAction = async (action, tool) => {
        const refDoc = doc(shopDb.collection("tooling"), tool.id);
        if (action === 'replace') { await updateDoc(refDoc, { currentHours: 0, qty: increment(-1) }); writeLog(`Replaced tool ${tool.name}`, 'inventory'); }
        if (action === 'bench') { await updateDoc(refDoc, { benchedHours: tool.currentHours, currentHours: 0, qty: increment(-1) }); writeLog(`Benched tool ${tool.name}`, 'inventory'); }
        if (action === 'swap') { await updateDoc(refDoc, { currentHours: tool.benchedHours, benchedHours: tool.currentHours }); writeLog(`Swapped tool ${tool.name}`, 'inventory'); }
        if (action === 'discard') { await updateDoc(refDoc, { benchedHours: null }); writeLog(`Discarded tool ${tool.name}`, 'inventory'); }
    };

    const syncLegacyMaterials = async () => {
        if(!window.confirm("WARNING: Pull Materials from Legacy DB?")) return;
        try {
            const oldApp = initializeApp({ apiKey: "AIzaSyAmXhVF4qX8WKW-8erHZfgSBQqkuqJ-hu0", authDomain: "shop-floor-b84ae.firebaseapp.com", projectId: "shop-floor-b84ae" }, "LegacyMatApp");
            const snap = await oldGetDocs(oldCol(getFirestore(oldApp), "materials"));
            let count = 0; const batch = writeBatch(db);
            snap.docs.forEach(d => { batch.set(doc(shopDb.collection("materials"), d.id), d.data()); count++; });
            await batch.commit(); alert(`✅ Synced ${count} raw materials!`);
        } catch(e) { alert("Sync failed."); }
    };

    const saveAdminDoc = async (col, id, data, msg) => { await setDoc(doc(shopDb.collection(col), cleanId(id, "")), data, {merge:true}); writeLog(msg, 'admin'); };
    const handlePermToggle = (role, tab) => { const rolePerms = perms[role] || []; const newPerms = rolePerms.includes(tab) ? rolePerms.filter(t => t !== tab) : [...rolePerms, tab]; setPerms({ ...perms, [role]: newPerms }); };
    const savePermissions = async () => { await setDoc(doc(shopDb.collection("config"), "permissions"), perms); writeLog("Updated Matrix", "admin"); alert("Matrix Saved!"); };

    // ==========================================
    // RENDERERS
    // ==========================================
    if (activeTab === 'routings') {
        // 🚀 FIX 1: Allow ALL parts (Inventory AND Assemblies) into the Routing Dropdown
        const hqInventory = hqParts; 
        return (
            <div>
                <h2 style={{ color: '#0056b3', marginBottom: '5px' }}>Master Part Routings</h2>
                <p style={{ color: '#666', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>Link HQ Inventory Parts to their material requirements and sequential manufacturing operations.</p>
                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: '#fff', border: '1px solid #0056b3', padding: '20px', borderRadius: '10px', marginBottom: '25px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <h4 style={{ margin: '0 0 10px 0', color: '#0056b3' }}>1. Select Master HQ Part</h4>
                                <select value={routingForm.partId} onChange={e => setRoutingForm({...routingForm, partId: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #ccc', borderRadius: '4px' }}>
                                    <option value="">Select HQ Part...</option>
                                    {hqInventory.map(p => {
                                        const id = p.legacyErpId && p.legacyErpId !== "PENDING" ? p.legacyErpId : p.itemId || p.id;
                                        // Use p.id as the internal value so we link exactly to the HQ doc ID
                                        return <option key={p.id} value={p.id}>{id} - {p.itemName || p.name}</option>;
                                    })}
                                </select>
                                <div style={{ marginTop: '15px', background: '#fffdf5', padding: '15px', border: '1px solid #f39c12', borderRadius: '6px' }}>
                                    <label style={{ fontWeight: 'bold', color: '#f39c12', cursor: 'pointer' }}><input type="checkbox" checked={routingForm.isRawMat} onChange={e => setRoutingForm({...routingForm, isRawMat: e.target.checked})} /> Consume Raw Material on OP 1?</label>
                                    {routingForm.isRawMat && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginTop: '10px' }}>
                                            <select value={routingForm.matProfile} onChange={e => setRoutingForm({...routingForm, matProfile: e.target.value})} style={{ padding: '8px', borderRadius: '4px' }}><option value="">Material Profile...</option>{materials.map(m => <option key={m.id} value={m.id}>{m.type} ({m.thickness}x{m.width})</option>)}</select>
                                            <input type="number" placeholder="Length/Pc (in)" step="0.01" value={routingForm.matLength} onChange={e => setRoutingForm({...routingForm, matLength: e.target.value})} style={{ padding: '8px', borderRadius: '4px' }} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div>
                                <h4 style={{ margin: '0 0 10px 0', color: '#0056b3' }}>2. Sequential Operations</h4>
                                {routingForm.ops.map((op, index) => (
                                    <div key={index} style={{ display: 'flex', gap: '10px', marginBottom: '10px', alignItems: 'center', background: '#f8f9fa', padding: '10px', border: '1px solid #ccc', borderRadius: '6px' }}>
                                        <span style={{ fontWeight: 'bold', width: '40px' }}>OP {index + 1}:</span>
                                        <select value={op.progId} onChange={e => { const newOps = [...routingForm.ops]; const pData = programsMap[e.target.value]; newOps[index] = { progId: e.target.value, name: pData?.name, machine: pData?.machine, setupCode: pData?.setupCode }; setRoutingForm({...routingForm, ops: newOps}); }} style={{ flex: 1, padding: '8px', borderRadius: '4px' }}>
                                            <option value="">Select Machine Program...</option>{programs.map(p => <option key={p.id} value={p.id}>{p.machine} - {p.name}</option>)}
                                        </select>
                                        <button onClick={() => { const newOps = routingForm.ops.filter((_, i) => i !== index); setRoutingForm({...routingForm, ops: newOps}); }} style={{ background: '#fff0f0', border: '1px solid #dc3545', color: '#dc3545', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>✖</button>
                                    </div>
                                ))}
                                <button onClick={() => setRoutingForm({...routingForm, ops: [...routingForm.ops, {progId: '', name: '', machine: '', setupCode: ''}]})} style={{ background: '#eef5ff', color: '#0056b3', border: '1px dashed #0056b3', padding: '8px', width: '100%', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>+ ADD OPERATION</button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                            <button onClick={handleSaveRouting} style={{ flex: 1, background: '#0056b3', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>SAVE PART ROUTING</button>
                            {routingForm.partId && <button onClick={() => setRoutingForm({ id: null, partId: '', isRawMat: false, matProfile: '', matLength: '', ops: [] })} style={{ background: '#888', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>CANCEL</button>}
                        </div>
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '15px' }}>
                    {routings.map(r => (
                        <div key={r.id} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', padding: '15px', position: 'relative' }}>
                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => handleDelete('routings', r.id)} style={{ position: 'absolute', top: '15px', right: '15px', background: '#fff0f0', border: '1px solid #ffcccc', color: '#dc3545', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>DEL</button>}
                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => setRoutingForm(r)} style={{ position: 'absolute', top: '15px', right: '60px', background: '#fffdf5', border: '1px solid #f39c12', color: '#000', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>EDIT</button>}
                            <h3 style={{ margin: '0 0 10px 0', color: '#0056b3', fontSize: '18px' }}>{r.displayName || r.partId}</h3>
                            {r.isRawMat && <div style={{ fontSize: '11px', background: '#fffdf5', border: '1px solid #f39c12', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', marginBottom: '10px' }}>📦 Mat: {materials.find(m=>m.id===r.matProfile)?.type || 'Unknown'} @ {r.matLength}" / pc</div>}
                            <div style={{ marginTop: '10px' }}>
                                {r.ops.map((op, i) => (
                                    <div key={i} style={{ fontSize: '12px', borderTop: '1px solid #eee', padding: '8px 0', display: 'flex', justifyContent: 'space-between' }}><b>OP {i+1}:</b> <span>{op.machine} - <span style={{ color: '#0056b3' }}>{op.name}</span></span></div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (activeTab === 'programs') {
        return (
            <div>
                <h2 style={{ color: '#0056b3' }}>Programs Library (Standalone Operations)</h2>
                <p style={{ color: '#666', fontSize: '13px', marginTop: 0, marginBottom: '20px' }}>Define standalone machine programs (feeds, speeds, tooling) here. Then sequence them into Master Parts on the Routings tab.</p>
                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: '#fff', border: '1px solid #0056b3', padding: '20px', borderRadius: '10px', marginBottom: '25px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                            <input type="text" placeholder="Program ID (Name)" value={progForm.name} onChange={e => setProgForm({...progForm, name: e.target.value})} disabled={progForm.id !== null} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
                            <select value={progForm.machine} onChange={e => setProgForm({...progForm, machine: e.target.value})} style={{ padding: '10px', borderRadius: '4px' }}><option value="">Select Machine...</option>{machines.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select>
                            <input type="number" placeholder="Time per Piece (Mins)" step="0.1" value={progForm.timePerPiece} onChange={e => setProgForm({...progForm, timePerPiece: e.target.value})} style={{ padding: '10px', borderRadius: '4px' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                            <input type="number" placeholder="Setup Time (Mins)" step="0.1" value={progForm.setupTime} onChange={e => setProgForm({...progForm, setupTime: e.target.value})} style={{ padding: '10px', borderRadius: '4px' }} />
                            <select value={progForm.setupCode} onChange={e => setProgForm({...progForm, setupCode: e.target.value})} style={{ padding: '10px', borderRadius: '4px' }}><option value="">Setup Category...</option>{setupCodes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select>
                        </div>
                        {progForm.machine && (
                            <div style={{ marginTop: '15px', background: '#f8f9fa', padding: '10px', border: '1px solid #ccc', borderRadius: '6px' }}>
                                <h4 style={{ margin: '0 0 10px 0' }}>Assign Cutting Tools:</h4>
                                {tooling.filter(t => t.machine === progForm.machine).map(t => (
                                    <div key={t.id} style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '5px' }}>
                                        <input type="checkbox" checked={progForm.toolTimes[t.name] !== undefined} onChange={e => { const newTools = {...progForm.toolTimes}; if(e.target.checked) newTools[t.name] = ''; else delete newTools[t.name]; setProgForm({...progForm, toolTimes: newTools}); }} />
                                        <span style={{ fontWeight: 'bold', width: '150px' }}>{t.name}</span>
                                        {progForm.toolTimes[t.name] !== undefined && <input type="number" placeholder="Mins per cycle" value={progForm.toolTimes[t.name]} onChange={e => setProgForm({...progForm, toolTimes: {...progForm.toolTimes, [t.name]: parseFloat(e.target.value)||0}})} style={{ padding: '4px', width: '100px' }} />}
                                    </div>
                                ))}
                            </div>
                        )}
                        <textarea placeholder="Set Up & Run Instructions..." value={progForm.steps} onChange={e => setProgForm({...progForm, steps: e.target.value})} style={{ width: '100%', padding: '10px', boxSizing: 'border-box', marginTop: '10px', minHeight: '80px', borderRadius: '4px' }}></textarea>
                        <div style={{ marginTop: '10px' }}><small>Upload PDF Drawing:</small><input type="file" onChange={e => setProgForm({...progForm, file: e.target.files[0]})} style={{ width: '100%', boxSizing: 'border-box' }} /></div>
                        <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                            <button onClick={handleSaveProgram} style={{ flex: 1, background: progForm.id ? '#f39c12' : '#0056b3', color: progForm.id ? '#000' : '#fff', border: 'none', padding: '12px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>{progForm.id ? 'UPDATE PROGRAM' : 'SAVE NEW PROGRAM'}</button>
                            {progForm.id && <button onClick={() => setProgForm({ id: null, name: '', machine: '', timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} })} style={{ background: '#888', color: '#fff', border: 'none', padding: '12px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>CANCEL</button>}
                        </div>
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
                    {programs.map(p => (
                        <div key={p.id} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', padding: '15px' }}>
                            {['admin', 'programmer'].includes(safeUserRole) && <div style={{ float: 'right' }}><button onClick={() => setProgForm(p)} style={{ background: '#fffdf5', border: '1px solid #f39c12', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginRight: '5px' }}>EDIT</button><button onClick={() => handleDelete('programs', p.id)} style={{ background: '#fff0f0', border: '1px solid #dc3545', color: '#dc3545', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>DEL</button></div>}
                            <h4 style={{ margin: '0 0 5px 0', fontSize: '18px', color: '#0056b3' }}>{p.name}</h4>
                            <div style={{ fontSize: '12px', marginBottom: '5px' }}><b>Machine:</b> {p.machine} {p.setupCode && <span style={{ background: '#eef5ff', color: '#0056b3', padding: '2px 6px', borderRadius: '4px', marginLeft: '5px' }}>Setup: {p.setupCode}</span>}</div>
                            <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px' }}><b>Cycle:</b> {p.timePerPiece}m | <b>Setup:</b> {p.setupTime}m</div>
                            {p.drawingUrl && <button onClick={() => window.open(p.drawingUrl)} style={{ background: '#f39c12', color: '#000', border: 'none', padding: '6px 10px', fontSize: '11px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer', width: '100%' }}>VIEW DRAWING</button>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (activeTab === 'tooling') {
        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h2 style={{ color: '#0056b3', margin: 0 }}>Tooling & Raw Material Inventory</h2>
                    {['admin', 'programmer'].includes(safeUserRole) && <button onClick={syncLegacyMaterials} style={{ background: '#f39c12', color: '#000', border: 'none', padding: '8px 15px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>🔄 SYNC LEGACY MATERIALS</button>}
                </div>

                {['admin', 'programmer', 'purchasing'].includes(safeUserRole) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '25px' }}>
                        <div style={{ background: '#fff', border: '1px solid #f39c12', padding: '20px', borderRadius: '10px' }}>
                            <h3 style={{ margin: '0 0 15px 0', color: '#f39c12' }}>Add New Tool</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}><input type="text" placeholder="Tool Name / Item #" value={toolForm.item} onChange={e => setToolForm({...toolForm, item: e.target.value})} style={{ padding: '8px' }} /><select value={toolForm.machine} onChange={e => setToolForm({...toolForm, machine: e.target.value})} style={{ padding: '8px' }}><option value="">Machine...</option>{machines.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
                            <input type="text" placeholder="Description" value={toolForm.desc} onChange={e => setToolForm({...toolForm, desc: e.target.value})} style={{ padding: '8px', width: '100%', boxSizing: 'border-box', marginTop: '10px' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}><input type="number" placeholder="Max Life (Hr)" value={toolForm.max} onChange={e => setToolForm({...toolForm, max: e.target.value})} style={{ padding: '8px' }} /><input type="number" placeholder="Stock Qty" value={toolForm.qty} onChange={e => setToolForm({...toolForm, qty: e.target.value})} style={{ padding: '8px' }} /><input type="number" placeholder="Reorder Pt" value={toolForm.reorder} onChange={e => setToolForm({...toolForm, reorder: e.target.value})} style={{ padding: '8px' }} /></div>
                            <button onClick={async () => { if(!toolForm.item || !toolForm.machine) return alert("Item and Machine required"); await setDoc(doc(shopDb.collection("tooling"), cleanId(toolForm.machine, toolForm.item)), { name: toolForm.item, desc: toolForm.desc, machine: toolForm.machine, currentHours: 0, maxHours: parseFloat(toolForm.max||10), qty: parseInt(toolForm.qty||1), reorder: parseInt(toolForm.reorder||0) }, {merge:true}); writeLog(`Registered Tool: ${toolForm.item}`, 'inventory'); setToolForm({ item: '', desc: '', machine: '', max: '', qty: '', reorder: '' }); }} style={{ background: '#f39c12', color: '#000', border: 'none', padding: '10px', width: '100%', marginTop: '15px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>REGISTER TOOL</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                            <div style={{ background: '#fff', border: '1px solid #0056b3', padding: '15px', borderRadius: '10px' }}>
                                <h4 style={{ margin: '0 0 10px 0', color: '#0056b3' }}>Register Material Profile</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}><input type="text" placeholder="Type (e.g. Steel)" value={matForm.type} onChange={e => setMatForm({...matForm, type: e.target.value})} style={{ padding: '8px' }} /><input type="number" placeholder="Thick (in)" step="0.01" value={matForm.thick} onChange={e => setMatForm({...matForm, thick: e.target.value})} style={{ padding: '8px' }} /><input type="number" placeholder="Width (in)" step="0.01" value={matForm.width} onChange={e => setMatForm({...matForm, width: e.target.value})} style={{ padding: '8px' }} /></div>
                                <button onClick={async () => { if(!matForm.type || !matForm.thick || !matForm.width) return alert("All fields required"); await setDoc(doc(shopDb.collection("materials"), cleanId(matForm.type, `${matForm.thick}x${matForm.width}`)), { type: matForm.type, thickness: matForm.thick, width: matForm.width, totalLength: 0 }); writeLog(`Registered Material`, 'admin'); setMatForm({ type: '', thick: '', width: '' }); }} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '8px', width: '100%', marginTop: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>REGISTER</button>
                            </div>
                        </div>
                    </div>
                )}
                
                <h3 style={{ borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>Raw Material Stock</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '15px', marginBottom: '30px' }}>
                    {materials.map(m => {
                        const available = m.totalLength || 0;
                        return (
                            <div key={m.id} style={{ background: available < 0 ? '#fff0f0' : '#fff', padding: '15px', border: '1px solid #ccc', borderRadius: '8px' }}>
                                {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('materials', m.id)} style={{ float: 'right', background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer' }}>✖</button>}
                                <b style={{ color: '#0056b3', fontSize: '16px' }}>{m.type}</b>
                                <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#555' }}>Profile: {m.thickness}" x {m.width}"</div>
                                <div style={{ marginTop: '10px', borderTop: '1px solid #ccc', paddingTop: '10px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '22px', fontWeight: 'bold', color: available < 0 ? '#dc3545' : '#28a745' }}>{available.toFixed(1)}"</div>
                                    <div style={{ fontSize: '10px', color: '#666' }}>ON HAND</div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                <h3 style={{ borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>Cutting Tools</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px', marginBottom: '30px' }}>
                    {tooling.map(t => {
                        const lifePct = Math.min((t.currentHours / t.maxHours) * 100, 100);
                        return (
                        <div key={t.id} style={{ background: '#fff', padding: '15px', border: '1px solid #ccc', borderRadius: '8px' }}>
                            {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('tooling', t.id)} style={{ float: 'right', background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer' }}>✖</button>}
                            <div style={{ fontWeight: 'bold', fontSize: '16px' }}>{t.machine} | {t.name}</div>
                            {t.desc && <div style={{ fontSize: '11px', color: '#666', marginBottom: '5px' }}>{t.desc}</div>}
                            <div style={{ fontSize: '12px', fontWeight: 'bold', marginTop: '5px' }}>Active Life: {t.currentHours.toFixed(2)} / {t.maxHours}h</div>
                            <div style={{ background: '#eee', height: '8px', borderRadius: '4px', margin: '5px 0' }}><div style={{ background: lifePct > 90 ? '#dc3545' : '#0056b3', width: `${lifePct}%`, height: '100%', borderRadius: '4px' }}></div></div>
                            <div style={{ fontSize: '12px', marginBottom: '10px' }}><b>Stock:</b> <span style={{ color: t.qty <= t.reorder ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>{t.qty}</span> (Reorder: {t.reorder})</div>
                            {['admin', 'operator', 'programmer'].includes(safeUserRole) && (
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handleToolAction('replace', t)} style={{ flex: 1, background: '#0056b3', color: '#fff', border: 'none', padding: '6px', fontSize: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>DISCARD & NEW</button>
                                    <button onClick={() => handleToolAction('bench', t)} style={{ flex: 1, background: '#f39c12', color: '#000', border: 'none', padding: '6px', fontSize: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>BENCH & NEW</button>
                                </div>
                            )}
                            {t.benchedHours != null && (
                                <div style={{ marginTop: '10px', background: '#fffdf5', border: '1px solid #f39c12', padding: '8px', borderRadius: '6px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 'bold', color: '#f39c12', marginBottom: '5px' }}>Benched: {t.benchedHours.toFixed(2)} / {t.maxHours}h</div>
                                    <div style={{ display: 'flex', gap: '5px' }}>
                                        <button onClick={() => handleToolAction('swap', t)} style={{ flex: 1, background: '#0056b3', color: '#fff', border: 'none', padding: '4px', fontSize: '10px', borderRadius: '4px', cursor: 'pointer' }}>SWAP</button>
                                        <button onClick={() => handleToolAction('discard', t)} style={{ flex: 1, background: '#dc3545', color: '#fff', border: 'none', padding: '4px', fontSize: '10px', borderRadius: '4px', cursor: 'pointer' }}>DEL</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )})}
                </div>
            </div>
        );
    }

    if (activeTab === 'admin') {
        return (
            <div>
                <h2 style={{ color: '#0056b3' }}>Management & Configuration</h2>
                
                {/* 🚀 1. MIGRATION ENGINE (Visible on Admin tab) */}
                <div style={{ background: '#eef5ff', border: '2px solid #0056b3', padding: '20px', borderRadius: '8px', marginBottom: '30px', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                    <h3 style={{ color: '#0056b3', margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>🚀 ENTERPRISE MIGRATION ENGINE (BRIDGE 1 & 2)</h3>
                    <p style={{ fontSize: '14px', color: '#555', marginBottom: '15px', lineHeight: '1.5' }}>
                        Clicking this button will safely scan all existing Shop Floor Routings and CNC Programs, find their matching Part ID in the HQ Master Library, and permanently inject the machine instructions into the HQ Database.<br/>
                        <b>This creates your Single Source of Truth.</b>
                    </p>
                    <button onClick={handleMigrateToHQ} style={{ padding: '15px 30px', background: '#0056b3', color: '#fff', fontWeight: 'bold', fontSize: '16px', border: 'none', cursor: 'pointer', borderRadius: '6px' }}>
                        ⚡ EXECUTE HQ MIGRATION
                    </button>
                </div>

                <div style={{ background: '#fff', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 15px 0' }}>Permissions Setup Matrix</h3>
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center' }}>
                            <thead style={{ background: '#f8f9fa' }}>
                                <tr>
                                    <th style={{ padding: '8px', borderBottom: '2px solid #ccc', textAlign: 'left' }}>Tab</th>
                                    {['operator', 'programmer', 'admin', 'purchasing', 'csr'].map(r => <th key={r} style={{ padding: '8px', borderBottom: '2px solid #ccc' }}>{r.toUpperCase()}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {TABS.map(tab => (
                                    <tr key={tab} style={{ borderBottom: '1px solid #eee' }}>
                                        <td style={{ padding: '8px', fontWeight: 'bold', textAlign: 'left' }}>{tab.toUpperCase()}</td>
                                        {['operator', 'programmer', 'admin', 'purchasing', 'csr'].map(role => (
                                            <td key={role} style={{ padding: '8px' }}><input type="checkbox" checked={perms[role]?.includes(tab) || false} onChange={() => handlePermToggle(role, tab)} /></td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={savePermissions} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: '4px', marginTop: '15px', fontWeight: 'bold', cursor: 'pointer' }}>SAVE MATRIX</button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                    <div>
                        <div style={{ background: '#fff', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0' }}>Machine Categories</h3>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}><input type="text" placeholder="Name" value={adminForm.catName} onChange={e => setAdminForm({...adminForm, catName: e.target.value})} style={{ flex: 1, padding: '8px' }} /><select value={adminForm.catType} onChange={e => setAdminForm({...adminForm, catType: e.target.value})} style={{ padding: '8px' }}><option value="Manual">Manual</option><option value="Automated">Automated</option></select><button onClick={() => { if(!adminForm.catName) return; saveAdminDoc('machine_categories', adminForm.catName, { name: adminForm.catName, type: adminForm.catType }, 'Added Category'); setAdminForm({...adminForm, catName: ''}); }} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>ADD</button></div>
                            {categories.map(c => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #eee' }}><span>{c.name} <span style={{ fontSize: '10px', background: '#eee', padding: '2px 6px', borderRadius: '4px', marginLeft: '10px' }}>{c.type}</span></span><button onClick={() => handleDelete('machine_categories', c.id)} style={{ color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer' }}>✖</button></div>)}
                        </div>
                        
                        <div style={{ background: '#fff', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0' }}>Setup Categories (AI Grouping Codes)</h3>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <input type="text" placeholder="Setup Code Name" value={adminForm.scName} onChange={e => setAdminForm({...adminForm, scName: e.target.value})} style={{ flex: 1, padding: '8px' }} />
                                <button onClick={() => { if(!adminForm.scName) return; saveAdminDoc('setup_codes', adminForm.scName, { name: adminForm.scName }, 'Added Setup Code'); setAdminForm({...adminForm, scName: ''}); }} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>ADD</button>
                            </div>
                            {setupCodes.map(s => <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #eee' }}><span>{s.name}</span><button onClick={() => handleDelete('setup_codes', s.id)} style={{ color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer' }}>✖</button></div>)}
                        </div>

                        <div style={{ background: '#fff', padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 10px 0' }}>Shop Machines</h3>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}><input type="text" placeholder="Name" value={adminForm.macName} onChange={e => setAdminForm({...adminForm, macName: e.target.value})} style={{ flex: 1, padding: '8px' }} /><select value={adminForm.macCat} onChange={e => setAdminForm({...adminForm, macCat: e.target.value})} style={{ padding: '8px' }}><option value="">Category...</option>{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select><button onClick={() => { if(!adminForm.macName || !adminForm.macCat) return; saveAdminDoc('machines', adminForm.macName, { name: adminForm.macName, category: adminForm.macCat }, 'Added Machine'); setAdminForm({...adminForm, macName: ''}); }} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>ADD</button></div>
                            {machines.map(m => <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px', borderBottom: '1px solid #eee' }}><span><b>{m.name}</b> <span style={{ fontSize: '11px', color: '#666', marginLeft: '10px' }}>{m.category}</span></span><button onClick={() => handleDelete('machines', m.id)} style={{ color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer' }}>✖</button></div>)}
                        </div>
                    </div>
                    <div>
                        <div style={{ background: '#fff', padding: '20px', border: '1px solid #ccc', borderRadius: '8px', marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 10px 0' }}>User Directory</h3>
                            
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                                <input type="text" placeholder="Name" value={adminForm.uName} onChange={e => setAdminForm({...adminForm, uName: e.target.value})} disabled={!!adminForm.oldPin} style={{ flex: 1, padding: '8px', background: adminForm.oldPin ? '#f8f9fa' : '#fff' }} />
                                <input type="text" placeholder="PIN" value={adminForm.uPin} onChange={e => setAdminForm({...adminForm, uPin: e.target.value})} style={{ width: '80px', padding: '8px' }} />
                                <select value={adminForm.uRole} onChange={e => setAdminForm({...adminForm, uRole: e.target.value})} style={{ padding: '8px' }}>
                                    <option value="operator">Operator</option><option value="programmer">Programmer</option><option value="admin">Admin</option><option value="purchasing">Purchasing</option><option value="csr">CSR</option>
                                </select>
                            </div>
                            
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button onClick={async () => { 
                                    if(!adminForm.uName || !adminForm.uPin) return alert('Name and PIN are required.'); 
                                    if(adminForm.oldPin && adminForm.oldPin !== adminForm.uPin) {
                                        await deleteDoc(doc(shopDb.collection("users"), adminForm.oldPin)); 
                                    }
                                    await setDoc(doc(shopDb.collection("users"), adminForm.uPin), { name: adminForm.uName, pin: adminForm.uPin, role: adminForm.uRole }); 
                                    await setDoc(doc(shopDb.collection("directory"), adminForm.uName), { name: adminForm.uName, role: adminForm.uRole, pin: adminForm.uPin, hidden: false }, {merge:true}); 
                                    writeLog(adminForm.oldPin ? `Updated User: ${adminForm.uName}` : `Added User: ${adminForm.uName}`, 'admin'); 
                                    setAdminForm({...adminForm, uName: '', uPin: '', oldPin: '', uRole: 'operator'}); 
                                }} style={{ background: adminForm.oldPin ? '#f39c12' : '#0056b3', color: adminForm.oldPin ? '#000' : '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', flex: 1 }}>
                                    {adminForm.oldPin ? 'UPDATE USER' : 'ADD NEW USER'}
                                </button>
                                
                                {adminForm.oldPin && (
                                    <button onClick={() => setAdminForm({...adminForm, uName: '', uPin: '', oldPin: '', uRole: 'operator'})} style={{ background: '#888', color: '#fff', border: 'none', padding: '8px 15px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                                        CANCEL
                                    </button>
                                )}
                            </div>
                            
                            {users.map(u => (
                                <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px', borderBottom: '1px solid #eee', opacity: u.hidden ? 0.5 : 1 }}>
                                    <span><b>{u.name}</b> <span style={{ fontSize: '11px', color: '#666', marginLeft: '5px' }}>[{u.role}]</span></span>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        
                                        <button onClick={() => setAdminForm({...adminForm, uName: u.name, uPin: u.pin || '', uRole: u.role || 'operator', oldPin: u.pin || ''})} style={{ background: '#fffdf5', border: '1px solid #f39c12', color: '#000', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', padding: '4px 8px', borderRadius: '4px' }}>EDIT</button>
                                        
                                        <button onClick={async () => { await updateDoc(doc(shopDb.collection("directory"), u.id), { hidden: !u.hidden }); }} style={{ background: 'none', border: 'none', color: '#0056b3', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>{u.hidden ? 'SHOW' : 'HIDE'}</button>
                                        <button onClick={async () => { if(!window.confirm(`Terminate ${u.name}?`)) return; await deleteDoc(doc(shopDb.collection("directory"), u.id)); if(u.pin) await deleteDoc(doc(shopDb.collection("users"), u.pin)); writeLog(`Terminated User: ${u.name}`, 'admin'); }} style={{ color: '#dc3545', background: 'none', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>TERM</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

export default ShopEngineering;