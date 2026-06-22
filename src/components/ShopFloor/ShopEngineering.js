import React, { useState } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, setDoc, updateDoc, writeBatch, increment } from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { saveProgramPrint, resolvePrintUrl } from '../Shared/programPrints';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection as oldCol, getDocs as oldGetDocs } from 'firebase/firestore';
import { unzipSync, strFromU8 } from 'fflate';

const shopDb = { collection: (colName) => collection(db, colName.startsWith('shop_') ? colName : `shop_${colName}`) };
const cleanId = (s1, s2) => `${s1}_${s2}`.replace(/[^a-zA-Z0-9]/g, "_");

// Seed max tool-life (hours) by Fusion tool type on import; the machinist tunes per tool afterward.
const DEFAULT_TOOL_LIFE_HRS = { 'drill': 8, 'spot drill': 12, 'center drill': 12, 'reamer': 10, 'tap right hand': 6, 'tap left hand': 6, 'flat end mill': 10, 'bull nose end mill': 10, 'ball end mill': 10, 'slot mill': 8, 'tapered mill': 8, 'dovetail mill': 8, 'chamfer mill': 15, 'face mill': 20, 'turning general': 8, 'turning threading': 6, 'turning boring': 8, 'probe': 0, 'holder': 0 };
const defaultToolLife = (type) => { const v = DEFAULT_TOOL_LIFE_HRS[String(type || '').toLowerCase()]; return v === undefined ? 8 : v; };

const ShopEngineering = ({ activeTab, user, hqParts, routings, programs, programsMap, machines, categories, setupCodes, tooling, materials, writeLog, handleDelete, safeUserRole, printMap = new Map() }) => {
    
    const [routingForm, setRoutingForm] = useState({ id: null, partId: '', isRawMat: false, matProfile: '', matLength: '', ops: [] });
    const [progForm, setProgForm] = useState({ id: null, name: '', machines: [], timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} });
    const [toolForm, setToolForm] = useState({ item: '', desc: '', machine: '', max: '', qty: '', reorder: '', toolNum: '' });
    const [importCat, setImportCat] = useState('');     // machine category/pool the .tools file imports into
    const [importBusy, setImportBusy] = useState(false);

    // A tool's pool = its machine's category, so interchangeable machines (VF2/VF4 = Vertical Mills)
    // share one tool inventory. Falls back to the machine name when no category.
    const poolOf = (machineName) => (machines.find(m => m.name === machineName)?.category) || machineName || '';

    // Import a Fusion 360 .tools library (zip of tools.json) into shop_tooling, keyed by pool + guid so
    // re-imports update in place and the operator's stock/max-life edits are preserved.
    const handleToolLibraryImport = async (file) => {
        if (!file) return;
        const pool = importCat;
        if (!pool) return alert("Pick the machine pool / category this library is for first (e.g. Vertical Mills, Lathes).");
        setImportBusy(true);
        try {
            const buf = new Uint8Array(await file.arrayBuffer());
            const entries = unzipSync(buf);
            const jsonName = Object.keys(entries).find(k => k.toLowerCase().endsWith('tools.json'));
            if (!jsonName) throw new Error("No tools.json inside the .tools file.");
            const data = (JSON.parse(strFromU8(entries[jsonName])) || {}).data || [];
            if (!data.length) throw new Error("No tools found in the library.");
            const existingByGuid = {}; tooling.forEach(t => { if (t.guid) existingByGuid[t.guid] = t; });
            const usedNames = new Set(tooling.filter(t => (t.pool || poolOf(t.machine)) === pool && !data.some(x => x.guid === t.guid)).map(t => t.name));
            const batch = writeBatch(db);
            let added = 0, updated = 0;
            data.forEach((t, i) => {
                const guid = t.guid || cleanId(pool, t.description || `tool${i}`);
                const num = t['post-process'] ? t['post-process'].number : null;
                const desc = String(t.description || t.type || 'Tool').trim();
                let name = `${desc}${Number.isFinite(num) && num > 0 ? ` (T${num})` : ''}`;
                const base = name; let n = 2; while (usedNames.has(name)) name = `${base} #${n++}`;
                usedNames.add(name);
                const g = t.geometry || {};
                const descriptive = {
                    name, desc, type: t.type || '', pool, machineCategory: pool,
                    toolNum: Number.isFinite(num) ? num : null, guid,
                    vendor: t.vendor || '', productId: t['product-id'] || '', productLink: t['product-link'] || '',
                    diameter: g.DC != null ? g.DC : null, flutes: g.NOF != null ? g.NOF : null, unit: t.unit || 'inches',
                };
                const existing = existingByGuid[guid];
                const id = existing ? existing.id : cleanId(pool, guid);
                const payload = existing ? descriptive : { ...descriptive, maxHours: defaultToolLife(t.type), currentHours: 0, qty: 0, reorder: 1, benchedHours: null, needsChange: false };
                batch.set(doc(shopDb.collection("tooling"), id), payload, { merge: true });
                if (existing) updated++; else added++;
            });
            await batch.commit();
            writeLog(`Imported tool library into ${pool}: ${added} new, ${updated} updated`, 'inventory');
            alert(`✅ Imported into "${pool}": ${added} new tool${added === 1 ? '' : 's'}, ${updated} updated.${added ? `\n\nSet stock qty and tune max-life on the new tools below.` : ''}`);
        } catch (e) {
            console.error('tool import failed', e);
            alert("Import failed: " + (e.message || e) + "\n\nMake sure it's a Fusion 360 .tools file.");
        } finally { setImportBusy(false); }
    };
    const [matForm, setMatForm] = useState({ type: '', thick: '', width: '' });
    
    const [adminForm, setAdminForm] = useState({ catName: '', catType: 'Manual', macName: '', macCat: '', scName: '' });

    // --- ALIGNED FILTER STATES ---
    const [hqSearch, setHqSearch] = useState('');
    const [filterWatchlist, setFilterWatchlist] = useState(false);
    const [filterCollection, setFilterCollection] = useState('');
    const [filterRoutingType, setFilterRoutingType] = useState('');
    const [showMissingPrograms, setShowMissingPrograms] = useState(false);

    // ==========================================
    // 🚀 FORCE SYNC TO HQ LIBRARY
    // ==========================================
    const handleForceSyncToHQ = async () => {
        if (!window.confirm("⚠️ DEV MIGRATION: This will force-sync all Shop Routings and Programs directly into the HQ Master Library. Proceed?")) return;
        
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
            writeLog(`Force Synced ${count} Routings to HQ`, 'admin');
            alert(`✅ SYNC COMPLETE! Successfully pushed ${count} Shop Routings to their HQ Master Assemblies.`);
        } catch (error) {
            console.error(error);
            alert("Sync Failed. Check console.");
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

        // 2. Dual-Save directly into HQ Master Library
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
        if(!progForm.name || progForm.machines.length === 0) return alert("Name & at least one Compatible Machine required.");
        let drawingUrl = null;
        if(progForm.file) { const fRef = ref(storage, `drawings/${progForm.name}.pdf`); await uploadBytesResumable(fRef, progForm.file); drawingUrl = await getDownloadURL(fRef); }
        const payload = { name: progForm.name, machines: progForm.machines, timePerPiece: parseFloat(progForm.timePerPiece)||0, setupTime: parseFloat(progForm.setupTime)||0, setupCode: progForm.setupCode, steps: progForm.steps, toolTimes: progForm.toolTimes };
        if(drawingUrl) {
            payload.drawingUrl = drawingUrl;
            // Also register centrally (hidden program_prints store) so the Print button resolves it everywhere.
            try {
                await saveProgramPrint(db, { name: progForm.name, url: drawingUrl, fileType: 'pdf', uploadedBy: user?.name || 'Shop' });
            } catch (e) { console.warn("Central print registration failed (drawingUrl still saved):", e); }
        }
        await setDoc(doc(shopDb.collection("programs"), progForm.id || cleanId(progForm.name, "")), payload, {merge:true});
        writeLog(`Saved Operation Program: ${progForm.name}`, 'engineering');
        setProgForm({ id: null, name: '', machines: [], timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} });
    };

    const handleToolAction = async (action, tool) => {
        const refDoc = doc(shopDb.collection("tooling"), tool.id);
        if (action === 'replace') { await updateDoc(refDoc, { currentHours: 0, qty: increment(-1), needsChange: false }); writeLog(`Replaced tool ${tool.name}`, 'inventory'); }
        if (action === 'bench') { await updateDoc(refDoc, { benchedHours: tool.currentHours, currentHours: 0, qty: increment(-1), needsChange: false }); writeLog(`Benched tool ${tool.name}`, 'inventory'); }
        if (action === 'swap') { await updateDoc(refDoc, { currentHours: tool.benchedHours, benchedHours: tool.currentHours, needsChange: false }); writeLog(`Swapped tool ${tool.name}`, 'inventory'); }
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

    // ==========================================
    // RENDERERS
    // ==========================================
    const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' };
    const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
    const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' };
    const btnStyle = { padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' };

    if (activeTab === 'routings') {
        
        // --- DYNAMIC DATA EXTRACTION (Aligned with Mass Update Library) ---
        const dynamicCollections = Array.from(new Set(
            hqParts.flatMap(p => {
                const specs = p.manufacturingSpecs || {};
                const cust = specs.customData || {};
                const legacyCollection = specs.collection && specs.collection !== 'N/A' ? specs.collection : null;
                return [
                    ...(specs.collections || []),
                    cust.collection !== 'N/A' ? cust.collection : null,
                    legacyCollection
                ].filter(Boolean).map(c => c.toUpperCase());
            })
        )).sort();

        const dynamicRoutingTypes = Array.from(new Set(
            hqParts.map(p => (p.manufacturingSpecs?.routingType || p.routingType || "").toUpperCase()).filter(Boolean)
        )).sort();

        // --- FILTERING LOGIC ---
        const filteredHqInventory = hqParts.filter(p => {
            const id = p.legacyErpId && p.legacyErpId !== "PENDING" ? p.legacyErpId : p.itemId || p.id;
            const name = p.itemName || p.name || '';
            const specs = p.manufacturingSpecs || {};
            const cust = specs.customData || {};

            // 1. Omit Finished Parts (Filters out anything with '/' like /EP1, /P)
            if (id.includes('/')) return false;

            // 2. Search Box Filter
            if (hqSearch && !id.toLowerCase().includes(hqSearch.toLowerCase()) && !name.toLowerCase().includes(hqSearch.toLowerCase())) return false;

            // 3. Collection Filter (Checks arrays and legacy fields mapped to library)
            if (filterCollection) {
                const partCols = [
                    ...(specs.collections || []),
                    cust.collection !== 'N/A' ? cust.collection : null,
                    specs.collection !== 'N/A' ? specs.collection : null
                ].filter(Boolean).map(c => c.toUpperCase());
                
                if (!partCols.includes(filterCollection.toUpperCase())) return false;
            }

            // 4. Assembly / Routing Type Filter
            if (filterRoutingType) {
                const rType = (specs.routingType || p.routingType || "").toUpperCase();
                if (rType !== filterRoutingType.toUpperCase()) return false;
            }

            // 5. Watchlist Filter
            if (filterWatchlist) {
                const wl = specs.watchList || cust.watchlist || "";
                if (!wl || wl === 'NONE' || wl === 'N/A') return false;
            }

            // 6. Missing Programs Filter
            if (showMissingPrograms) {
                const hasProgramNum = !!(specs.programNum || p.programNum);
                const hasRouting = routings.some(r => r.partId === p.id && r.ops && r.ops.length > 0);
                
                if (hasProgramNum || hasRouting) return false;
            }

            return true;
        });

        return (
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Engineering</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Master Part Routings</h2>
                    <p style={{ margin: '8px 0 0 0', fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)' }}>Link HQ Inventory Parts to their material requirements and sequential manufacturing operations.</p>
                </div>
                
                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', marginBottom: '40px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
                            <div>
                                <h4 style={sectionHeaderStyle}>1. Select Master HQ Part</h4>
                                
                                {/* ALIGNED FILTER CONTROLS */}
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                    <input 
                                        type="text" 
                                        placeholder="Search Base Assemblies..." 
                                        value={hqSearch} 
                                        onChange={e => setHqSearch(e.target.value)} 
                                        style={{ ...fieldStyle, flex: 2, padding: '8px 12px' }} 
                                    />
                                    <select 
                                        value={filterCollection} 
                                        onChange={e => setFilterCollection(e.target.value)} 
                                        style={{ ...fieldStyle, flex: 1, padding: '8px 12px', background: '#fff' }}
                                    >
                                        <option value="">All Collections...</option>
                                        {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <select 
                                        value={filterRoutingType} 
                                        onChange={e => setFilterRoutingType(e.target.value)} 
                                        style={{ ...fieldStyle, flex: 1, padding: '8px 12px', background: '#fff' }}
                                    >
                                        <option value="">All Assembly Types...</option>
                                        {dynamicRoutingTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={filterWatchlist} 
                                            onChange={e => setFilterWatchlist(e.target.checked)} 
                                        /> 
                                        Watchlist
                                    </label>
                                </div>
                                <div style={{ marginBottom: '16px' }}>
                                    <button 
                                        onClick={() => setShowMissingPrograms(!showMissingPrograms)} 
                                        style={{ width: '100%', padding: '10px', background: showMissingPrograms ? 'var(--ink)' : 'var(--paper-2)', color: showMissingPrograms ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                    >
                                        {showMissingPrograms ? 'Clear Missing Programs Filter' : 'Find Assemblies Missing Programs'}
                                    </button>
                                </div>

                                <select value={routingForm.partId} onChange={e => setRoutingForm({...routingForm, partId: e.target.value})} style={{ ...fieldStyle, background: '#fff' }}>
                                    <option value="">Select HQ Part ({filteredHqInventory.length} results)...</option>
                                    {filteredHqInventory.map(p => {
                                        const id = p.legacyErpId && p.legacyErpId !== "PENDING" ? p.legacyErpId : p.itemId || p.id;
                                        return <option key={p.id} value={p.id}>{id} - {p.itemName || p.name}</option>;
                                    })}
                                </select>
                                <div style={{ marginTop: '24px', background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px' }}>
                                    <label style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <input type="checkbox" checked={routingForm.isRawMat} onChange={e => setRoutingForm({...routingForm, isRawMat: e.target.checked})} /> Consume Raw Material on OP 1?
                                    </label>
                                    {routingForm.isRawMat && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginTop: '16px' }}>
                                            <select value={routingForm.matProfile} onChange={e => setRoutingForm({...routingForm, matProfile: e.target.value})} style={fieldStyle}><option value="">Material Profile...</option>{materials.map(m => <option key={m.id} value={m.id}>{m.type} ({m.thickness}x{m.width})</option>)}</select>
                                            <input type="number" placeholder="Length/Pc (in)" step="0.01" value={routingForm.matLength} onChange={e => setRoutingForm({...routingForm, matLength: e.target.value})} style={fieldStyle} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div>
                                <h4 style={sectionHeaderStyle}>2. Sequential Operations</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {routingForm.ops.map((op, index) => (
                                        <div key={index} style={{ display: 'flex', gap: '12px', alignItems: 'center', background: '#fff', padding: '16px', border: '1px solid var(--line)' }}>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', width: '40px' }}>OP {index + 1}</span>
                                            
                                            <select value={op.progId} onChange={e => { 
                                                const newOps = [...routingForm.ops]; 
                                                const pData = programsMap[e.target.value]; 
                                                newOps[index] = { progId: e.target.value, name: pData?.name, machine: pData?.machines?.[0] || '', setupCode: pData?.setupCode }; 
                                                setRoutingForm({...routingForm, ops: newOps}); 
                                            }} style={{ flex: 1.5, ...fieldStyle, padding: '8px' }}>
                                                <option value="">Select Program...</option>{programs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>

                                            <select value={op.machine} onChange={e => {
                                                const newOps = [...routingForm.ops];
                                                newOps[index].machine = e.target.value;
                                                setRoutingForm({...routingForm, ops: newOps});
                                            }} style={{ flex: 1, ...fieldStyle, padding: '8px' }} disabled={!op.progId}>
                                                <option value="">Route To...</option>
                                                {(programsMap[op.progId]?.machines || []).map(m => <option key={m} value={m}>{m}</option>)}
                                            </select>

                                            <button onClick={() => { const newOps = routingForm.ops.filter((_, i) => i !== index); setRoutingForm({...routingForm, ops: newOps}); }} style={{ background: 'transparent', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>
                                        </div>
                                    ))}
                                    <button onClick={() => setRoutingForm({...routingForm, ops: [...routingForm.ops, {progId: '', name: '', machine: '', setupCode: ''}]})} style={{ background: 'transparent', color: 'var(--ink)', border: '1px dashed var(--line)', padding: '16px', width: '100%', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'var(--paper-2)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>+ Add Operation</button>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '16px', marginTop: '30px' }}>
                            <button onClick={handleSaveRouting} style={{ flex: 2, ...btnStyle }}>Save Part Routing</button>
                            {routingForm.partId && <button onClick={() => setRoutingForm({ id: null, partId: '', isRawMat: false, matProfile: '', matLength: '', ops: [] })} style={{ flex: 1, ...btnStyle, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)' }}>Cancel</button>}
                        </div>
                    </div>
                )}
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '24px' }}>
                    {routings.map(r => {
                        let totalSetupMins = 0;
                        let totalCycleMins = 0;
                        
                        r.ops.forEach(op => {
                            const prog = programsMap[op.progId];
                            if (prog) {
                                totalSetupMins += parseFloat(prog.setupTime) || 0;
                                totalCycleMins += parseFloat(prog.timePerPiece) || 0;
                            }
                        });

                        return (
                            <div key={r.id} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '24px', position: 'relative', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                {['admin', 'programmer'].includes(safeUserRole) && (
                                    <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', gap: '12px' }}>
                                        <button onClick={() => setRoutingForm(r)} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Edit</button>
                                        <button onClick={() => handleDelete('routings', r.id)} style={{ background: 'transparent', border: 'none', color: '#d9534f', padding: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Del</button>
                                    </div>
                                )}
                                
                                <h3 style={{ margin: '0 0 16px 0', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, paddingRight: '100px' }}>{r.displayName || r.partId}</h3>
                                
                                {r.isRawMat && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '6px 10px', display: 'inline-block', marginBottom: '16px', color: 'var(--ink)' }}>📦 Mat: {materials.find(m=>m.id===r.matProfile)?.type || 'Unknown'} @ {r.matLength}" / pc</div>}
                                
                                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Total Setup</span>
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)' }}>{totalSetupMins.toFixed(1)} mins</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Run Time (Per Pc)</span>
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)' }}>{totalCycleMins.toFixed(2)} mins</span>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {r.ops.map((op, i) => {
                                        const opProg = programsMap[op.progId];
                                        return (
                                            <div key={i} style={{ fontSize: '0.9rem', fontFamily: 'var(--sans)', borderTop: '1px solid var(--line)', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', color: 'var(--ink)' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>OP {i+1}: {op.machine}</span> 
                                                    <span><span style={{ fontWeight: 500 }}>{op.name}</span></span>
                                                </div>
                                                {opProg && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                                                        <div style={{ textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>
                                                            {opProg.setupTime}m SU<br/>
                                                            {opProg.timePerPiece}m /pc
                                                        </div>
                                                        {(() => {
                                                            const url = resolvePrintUrl(printMap, opProg.name, opProg.drawingUrl);
                                                            return url ? <button onClick={() => window.open(url, '_blank')} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '3px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 Print</button> : null;
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    }

    if (activeTab === 'programs') {
        return (
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Engineering</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Programs Library (Standalone Operations)</h2>
                    <p style={{ margin: '8px 0 0 0', fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)' }}>Define standalone machine programs (feeds, speeds, tooling) here. Then sequence them into Master Parts on the Routings tab.</p>
                </div>
                
                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', marginBottom: '40px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '30px', marginBottom: '20px' }}>
                            <div>
                                <label style={labelStyle}>Program ID (Name)</label>
                                <input type="text" value={progForm.name} onChange={e => setProgForm({...progForm, name: e.target.value})} disabled={progForm.id !== null} style={fieldStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Compatible Machines</label>
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', padding: '12px', background: '#fff', border: '1px solid var(--line)' }}>
                                    {machines.map(m => (
                                        <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem', cursor: 'pointer' }}>
                                            <input 
                                                type="checkbox" 
                                                checked={progForm.machines?.includes(m.name)} 
                                                onChange={(e) => {
                                                    const newMacs = e.target.checked ? [...(progForm.machines||[]), m.name] : (progForm.machines||[]).filter(x => x !== m.name);
                                                    setProgForm({...progForm, machines: newMacs});
                                                }}
                                            /> 
                                            {m.name}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginTop: '20px' }}>
                            <div><label style={labelStyle}>Time per Piece (Mins)</label><input type="number" step="0.1" value={progForm.timePerPiece} onChange={e => setProgForm({...progForm, timePerPiece: e.target.value})} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Setup Time (Mins)</label><input type="number" step="0.1" value={progForm.setupTime} onChange={e => setProgForm({...progForm, setupTime: e.target.value})} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Setup Category</label><select value={progForm.setupCode} onChange={e => setProgForm({...progForm, setupCode: e.target.value})} style={fieldStyle}><option value="">Setup Category...</option>{setupCodes.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></div>
                        </div>
                        
                        {progForm.machines?.length > 0 && (
                            <div style={{ marginTop: '24px', background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px' }}>
                                <h4 style={sectionHeaderStyle}>Assign Cutting Tools</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {tooling.filter(t => { const pools = new Set((progForm.machines || []).map(poolOf)); return pools.has(t.pool || poolOf(t.machine)); }).map(t => (
                                        <div key={t.id} style={{ display: 'flex', gap: '16px', alignItems: 'center', background: 'var(--paper-2)', padding: '12px 16px', border: '1px solid var(--line)' }}>
                                            <input type="checkbox" checked={progForm.toolTimes[t.name] !== undefined} onChange={e => { const newTools = {...progForm.toolTimes}; if(e.target.checked) newTools[t.name] = ''; else delete newTools[t.name]; setProgForm({...progForm, toolTimes: newTools}); }} style={{ cursor: 'pointer' }} />
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 'bold', width: '30px' }}>T{t.toolNum || '-'}</span>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)', width: '200px' }}>{t.name}</span>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', width: '100px' }}>({t.pool || t.machine})</span>
                                            {progForm.toolTimes[t.name] !== undefined && <input type="number" placeholder="Mins per cycle" value={progForm.toolTimes[t.name]} onChange={e => setProgForm({...progForm, toolTimes: {...progForm.toolTimes, [t.name]: parseFloat(e.target.value)||0}})} style={{ padding: '8px', width: '120px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }} />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                        <div style={{ marginTop: '24px' }}>
                            <label style={labelStyle}>Set Up & Run Instructions</label>
                            <textarea value={progForm.steps} onChange={e => setProgForm({...progForm, steps: e.target.value})} style={{ ...fieldStyle, minHeight: '100px', resize: 'vertical' }}></textarea>
                        </div>
                        <div style={{ marginTop: '20px' }}><label style={labelStyle}>Upload PDF Drawing</label><input type="file" onChange={e => setProgForm({...progForm, file: e.target.files[0]})} style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem' }} /></div>
                        
                        <div style={{ display: 'flex', gap: '16px', marginTop: '30px' }}>
                            <button onClick={handleSaveProgram} style={{ flex: 2, ...btnStyle, background: progForm.id ? 'var(--brass)' : 'var(--ink)' }}>{progForm.id ? 'Update Program' : 'Save New Program'}</button>
                            {progForm.id && <button onClick={() => setProgForm({ id: null, name: '', machines: [], timePerPiece: '', setupTime: '', setupCode: '', steps: '', file: null, toolTimes: {} })} style={{ flex: 1, ...btnStyle, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)' }}>Cancel</button>}
                        </div>
                    </div>
                )}
                
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
                    {programs.map(p => (
                        <div key={p.id} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '24px', position: 'relative', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            {['admin', 'programmer'].includes(safeUserRole) && (
                                <div style={{ position: 'absolute', top: '24px', right: '24px', display: 'flex', gap: '12px' }}>
                                    <button onClick={() => setProgForm(p)} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Edit</button>
                                    <button onClick={() => handleDelete('programs', p.id)} style={{ background: 'transparent', border: 'none', color: '#d9534f', padding: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Del</button>
                                </div>
                            )}
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', paddingRight: '80px' }}>{p.name}</h4>
                            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '8px', lineHeight: '1.4' }}>
                                Machines: <span style={{ fontWeight: 500 }}>{(p.machines || []).join(', ')}</span>
                                {p.setupCode && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '4px 8px', marginLeft: '12px', display: 'inline-block' }}>Setup: {p.setupCode}</span>}
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '20px' }}>
                                Cycle: {p.timePerPiece}m | Setup: {p.setupTime}m
                            </div>
                            {(() => {
                                const url = resolvePrintUrl(printMap, p.name, p.drawingUrl);
                                return url
                                    ? <button onClick={() => window.open(url, '_blank')} style={{ width: '100%', ...btnStyle, background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)' }}>🖨 Print</button>
                                    : <div style={{ width: '100%', textAlign: 'center', padding: '10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', border: '1px dashed var(--line)', boxSizing: 'border-box' }}>No print on file</div>;
                            })()}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (activeTab === 'tooling') {
        return (
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Inventory</span>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Tooling & Raw Material</h2>
                    </div>
                    {['admin', 'programmer'].includes(safeUserRole) && <button onClick={syncLegacyMaterials} style={{ ...btnStyle, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)' }}>Sync Legacy Materials</button>}
                </div>

                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--brass)', padding: '24px', borderRadius: '2px', marginBottom: '30px' }}>
                        <h3 style={{ ...sectionHeaderStyle, marginTop: 0 }}>Import Fusion 360 Tool Library (.tools)</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: 0, marginBottom: '16px', lineHeight: 1.5 }}>Upload a Fusion <strong>.tools</strong> file. Tools import into the chosen machine pool — interchangeable machines that share a category (e.g. VF2/VF4 = Vertical Mills) share one tool inventory, so nothing is double-counted. Re-importing updates by tool; your stock & max-life edits are kept.</p>
                        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={importCat} onChange={e => setImportCat(e.target.value)} style={{ ...fieldStyle, width: 'auto', minWidth: '220px' }}>
                                <option value="">Pool / machine category…</option>
                                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                            <label style={{ ...btnStyle, cursor: importBusy || !importCat ? 'not-allowed' : 'pointer', opacity: importBusy || !importCat ? 0.55 : 1, display: 'inline-block' }}>
                                {importBusy ? 'Importing…' : 'Choose .tools file'}
                                <input type="file" accept=".tools,.zip" disabled={importBusy || !importCat} onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; handleToolLibraryImport(f); }} style={{ display: 'none' }} />
                            </label>
                        </div>
                    </div>
                )}

                {['admin', 'programmer', 'purchasing'].includes(safeUserRole) && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '40px' }}>
                        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px' }}>
                            <h3 style={sectionHeaderStyle}>Add New Tool</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr', gap: '20px', marginBottom: '20px' }}>
                                <div><label style={labelStyle}>Tool Name / Item #</label><input type="text" value={toolForm.item} onChange={e => setToolForm({...toolForm, item: e.target.value})} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>Haas T-#</label><input type="number" placeholder="e.g. 1 for T1" value={toolForm.toolNum} onChange={e => setToolForm({...toolForm, toolNum: e.target.value})} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>Machine</label><select value={toolForm.machine} onChange={e => setToolForm({...toolForm, machine: e.target.value})} style={fieldStyle}><option value="">Select...</option>{machines.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></div>
                            </div>
                            <div style={{ marginBottom: '20px' }}>
                                <label style={labelStyle}>Description</label>
                                <input type="text" value={toolForm.desc} onChange={e => setToolForm({...toolForm, desc: e.target.value})} style={fieldStyle} />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                <div><label style={labelStyle}>Max Life (Hr)</label><input type="number" value={toolForm.max} onChange={e => setToolForm({...toolForm, max: e.target.value})} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>Stock Qty</label><input type="number" value={toolForm.qty} onChange={e => setToolForm({...toolForm, qty: e.target.value})} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>Reorder Pt</label><input type="number" value={toolForm.reorder} onChange={e => setToolForm({...toolForm, reorder: e.target.value})} style={fieldStyle} /></div>
                            </div>
                            <button onClick={async () => { if(!toolForm.item || !toolForm.machine) return alert("Item and Machine required"); await setDoc(doc(shopDb.collection("tooling"), cleanId(toolForm.machine, toolForm.item)), { name: toolForm.item, desc: toolForm.desc, machine: toolForm.machine, toolNum: parseInt(toolForm.toolNum) || null, currentHours: 0, maxHours: parseFloat(toolForm.max||10), qty: parseInt(toolForm.qty||1), reorder: parseInt(toolForm.reorder||0) }, {merge:true}); writeLog(`Registered Tool: ${toolForm.item}`, 'inventory'); setToolForm({ item: '', desc: '', machine: '', max: '', qty: '', reorder: '', toolNum: '' }); }} style={{ width: '100%', ...btnStyle }}>Register Tool</button>
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <h4 style={sectionHeaderStyle}>Register Material Profile</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                    <div><label style={labelStyle}>Type</label><input type="text" placeholder="e.g. Steel" value={matForm.type} onChange={e => setMatForm({...matForm, type: e.target.value})} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Thick (in)</label><input type="number" step="0.01" value={matForm.thick} onChange={e => setMatForm({...matForm, thick: e.target.value})} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Width (in)</label><input type="number" step="0.01" value={matForm.width} onChange={e => setMatForm({...matForm, width: e.target.value})} style={fieldStyle} /></div>
                                </div>
                                <button onClick={async () => { if(!matForm.type || !matForm.thick || !matForm.width) return alert("All fields required"); await setDoc(doc(shopDb.collection("materials"), cleanId(matForm.type, `${matForm.thick}x${matForm.width}`)), { type: matForm.type, thickness: matForm.thick, width: matForm.width, totalLength: 0 }); writeLog(`Registered Material`, 'admin'); setMatForm({ type: '', thick: '', width: '' }); }} style={{ width: '100%', ...btnStyle }}>Register Material</button>
                            </div>
                        </div>
                    </div>
                )}
                
                <h3 style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px', margin: '0 0 20px 0' }}>Raw Material Stock</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', marginBottom: '40px' }}>
                    {materials.map(m => {
                        const available = m.totalLength || 0;
                        return (
                            <div key={m.id} style={{ background: available < 0 ? '#fdf2f2' : '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('materials', m.id)} style={{ float: 'right', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>×</button>}
                                <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{m.type}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>Profile: {m.thickness}" × {m.width}"</div>
                                <div style={{ marginTop: '20px', borderTop: '1px solid var(--line)', paddingTop: '20px', textAlign: 'center' }}>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '2rem', color: available < 0 ? '#d9534f' : 'var(--ink)', fontWeight: 500 }}>{available.toFixed(1)}"</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>On Hand</div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                <h3 style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px', margin: '0 0 20px 0' }}>Cutting Tools</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px', marginBottom: '40px' }}>
                    {tooling.map(t => {
                        const lifePct = Math.min((t.currentHours / t.maxHours) * 100, 100);
                        const warn = t.maxHours > 0 && (t.needsChange || t.currentHours >= t.maxHours * 0.9);
                        return (
                        <div key={t.id} style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('tooling', t.id)} style={{ float: 'right', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>×</button>}
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                {t.toolNum && <div style={{ background: 'var(--ink)', color: '#fff', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 'bold', borderRadius: '2px' }}>T{t.toolNum}</div>}
                                <div>
                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)', paddingRight: '20px' }}>{t.name}{warn && <span style={{ marginLeft: '8px', background: '#d9534f', color: '#fff', fontFamily: 'var(--mono)', fontSize: '8px', padding: '2px 6px', borderRadius: '2px', textTransform: 'uppercase', letterSpacing: '.05em' }}>Change soon</span>}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '4px' }}>{t.pool || t.machine}{t.vendor ? ` · ${t.vendor}${t.productId ? ` ${t.productId}` : ''}` : ''}</div>
                                </div>
                            </div>
                            
                            {t.desc && <div style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-soft)', marginTop: '8px', fontStyle: 'italic' }}>{t.desc}</div>}
                            
                            <div style={{ marginTop: '20px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)' }}>
                                    <span>Active Life</span>
                                    <span>{t.currentHours.toFixed(2)} / {t.maxHours}h</span>
                                </div>
                                <div style={{ background: 'var(--paper-2)', height: '4px', marginTop: '8px', marginBottom: '16px' }}>
                                    <div style={{ background: lifePct > 90 ? '#d9534f' : 'var(--ink)', width: `${lifePct}%`, height: '100%' }}></div>
                                </div>
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '12px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Stock: <strong style={{ color: t.qty <= t.reorder ? '#d9534f' : 'var(--ink)', fontSize: '1.1rem' }}>{t.qty}</strong></span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Reorder: {t.reorder}</span>
                            </div>

                            {['admin', 'operator', 'programmer'].includes(safeUserRole) && (
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button onClick={() => handleToolAction('replace', t)} style={{ flex: 1, padding: '10px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Discard & New</button>
                                    <button onClick={() => handleToolAction('bench', t)} style={{ flex: 1, padding: '10px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Bench & New</button>
                                </div>
                            )}
                            
                            {t.benchedHours != null && (
                                <div style={{ marginTop: '16px', background: '#fff', border: '1px dashed var(--line)', padding: '16px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '12px' }}>Benched: {t.benchedHours.toFixed(2)} / {t.maxHours}h</div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button onClick={() => handleToolAction('swap', t)} style={{ flex: 1, padding: '8px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Swap</button>
                                        <button onClick={() => handleToolAction('discard', t)} style={{ flex: 1, padding: '8px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Del</button>
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
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
                <div style={{ borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '30px' }}>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Machine Configuration</h2>
                </div>
                
                {/* 🚀 1. MIGRATION ENGINE (Visible on Machine Config tab) */}
                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', marginBottom: '40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h3 style={{ color: 'var(--ink)', margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Force Sync: Shop Floor → HQ Library</h3>
                        <p style={{ fontSize: '0.95rem', color: 'var(--ink-soft)', margin: 0, maxWidth: '700px', lineHeight: '1.5' }}>
                            Safely scan all existing Shop Floor Routings and CNC Programs, find their matching Part ID in the HQ Master Library, and permanently inject the sequence and run times into the HQ Database.
                        </p>
                    </div>
                    <button onClick={handleForceSyncToHQ} style={{ padding: '16px 32px', background: 'var(--ink)', color: '#fff', fontWeight: 500, fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s', whiteSpace: 'nowrap' }}>
                        Force Sync to HQ
                    </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                        
                        <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <h3 style={sectionHeaderStyle}>Machine Categories</h3>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                <input type="text" placeholder="Name" value={adminForm.catName} onChange={e => setAdminForm({...adminForm, catName: e.target.value})} style={fieldStyle} />
                                <select value={adminForm.catType} onChange={e => setAdminForm({...adminForm, catType: e.target.value})} style={{ ...fieldStyle, width: 'auto' }}><option value="Manual">Manual</option><option value="Automated">Automated</option></select>
                                <button onClick={() => { if(!adminForm.catName) return; saveAdminDoc('machine_categories', adminForm.catName, { name: adminForm.catName, type: adminForm.catType }, 'Added Category'); setAdminForm({...adminForm, catName: ''}); }} style={btnStyle}>Add</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {categories.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No categories defined.</span>}
                                {categories.map(c => (
                                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', fontWeight: 500 }}>{c.name}</span> 
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '4px 8px' }}>{c.type}</span>
                                        </div>
                                        <button onClick={() => handleDelete('machine_categories', c.id)} style={{ color: '#d9534f', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <h3 style={sectionHeaderStyle}>Setup Categories (AI Grouping)</h3>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                <input type="text" placeholder="Setup Code Name" value={adminForm.scName} onChange={e => setAdminForm({...adminForm, scName: e.target.value})} style={fieldStyle} />
                                <button onClick={() => { if(!adminForm.scName) return; saveAdminDoc('setup_codes', adminForm.scName, { name: adminForm.scName }, 'Added Setup Code'); setAdminForm({...adminForm, scName: ''}); }} style={btnStyle}>Add</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {setupCodes.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No setup codes defined.</span>}
                                {setupCodes.map(s => (
                                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)' }}>{s.name}</span>
                                        <button onClick={() => handleDelete('setup_codes', s.id)} style={{ color: '#d9534f', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <h3 style={sectionHeaderStyle}>Shop Machines</h3>
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
                                <input type="text" placeholder="Name" value={adminForm.macName} onChange={e => setAdminForm({...adminForm, macName: e.target.value})} style={fieldStyle} />
                                <select value={adminForm.macCat} onChange={e => setAdminForm({...adminForm, macCat: e.target.value})} style={{ ...fieldStyle, width: 'auto' }}><option value="">Category...</option>{categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}</select>
                                <button onClick={() => { if(!adminForm.macName || !adminForm.macCat) return; saveAdminDoc('machines', adminForm.macName, { name: adminForm.macName, category: adminForm.macCat }, 'Added Machine'); setAdminForm({...adminForm, macName: ''}); }} style={btnStyle}>Add</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                {machines.length === 0 && <span style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem' }}>No machines defined.</span>}
                                {machines.map(m => (
                                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', fontWeight: 500 }}>{m.name}</span> 
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{m.category}</span>
                                        </div>
                                        <button onClick={() => handleDelete('machines', m.id)} style={{ color: '#d9534f', background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, lineHeight: 1 }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
    return null;
};

export default ShopEngineering;