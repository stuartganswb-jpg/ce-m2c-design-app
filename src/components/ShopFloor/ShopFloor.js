import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, storage } from '../../firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, increment } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import './shopStyles.css';

// IMPORT THE COMPONENTS
import ShopEngineering from './ShopEngineering';
import AssetGalleryTab from '../Shared/AssetGalleryTab';

// 🚀 NEW: Import the Shared App
import SharedMessaging from '../Shared/SharedMessaging';

const shopDb = { collection: (colName) => collection(db, colName.startsWith('shop_') ? colName : `shop_${colName}`) };

const TABS = ['floor', 'milling', 'scheduler', 'custom', 'logs', 'export', 'routings', 'programs', 'tooling', 'messaging', 'reports', 'livio', 'assets', 'admin'];
const ENG_TABS = ['routings', 'programs', 'tooling', 'admin'];

const ShopFloor = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [pinInput, setPinInput] = useState("");
    const [activeTab, setActiveTab] = useState('floor');
    const [perms, setPerms] = useState({});

    // STATE
    const [hqParts, setHqParts] = useState([]);
    const [routings, setRoutings] = useState([]);
    const [machines, setMachines] = useState([]);
    const [categories, setCategories] = useState([]);
    const [setupCodes, setSetupCodes] = useState([]);
    const [schedule, setSchedule] = useState([]);
    const [milling, setMilling] = useState([]);
    const [programs, setPrograms] = useState([]);
    const [tooling, setTooling] = useState([]);
    const [materials, setMaterials] = useState([]);
    const [customOrders, setCustomOrders] = useState([]);
    const [matHistory, setMatHistory] = useState([]);
    const [failures, setFailures] = useState([]);
    const [livio, setLivio] = useState([]);
    const [users, setUsers] = useState([]);
    const [logs, setLogs] = useState([]);

    const [machineCategoryMap, setMachineCategoryMap] = useState({});
    const [categoryTypeMap, setCategoryTypeMap] = useState({});
    const [programsMap, setProgramsMap] = useState({});
    const [routingsMap, setRoutingsMap] = useState({});

    // FORMS
    const [millForm, setMillForm] = useState({ partNum: '', woNum: '', soNum: '', item: '', qty: '', reqDate: '', phosphate: 'No', file: null });
    const [dispatchForm, setDispatchForm] = useState({ op: '', routingId: '', woNum: '', targetQty: '', estStart: '', estFinish: '', estHrs: '', notes: '', phosphate: 'No' });
    const [livioForm, setLivioForm] = useState({ desc: '', reqDate: '', file: null });

    // MODALS
    const [activeModal, setActiveModal] = useState(null); 
    const [modalData, setModalData] = useState({});
    const [qcForm, setQcForm] = useState({ good: 0, scrap: 0, failReason: 'Out of Tolerance', failNotes: '', failImg: null });
    const [shiftLogQty, setShiftLogQty] = useState(0);

    const safeUserRole = user?.role ? user.role.toLowerCase() : 'operator';
    
    // PERMISSIONS BYPASS: Admins ALWAYS see all tabs
    const myTabs = user?.role === 'admin' ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            const snap = await getDocs(query(shopDb.collection("directory"), where("pin", "==", pinInput)));
            if (!snap.empty) {
                const uData = snap.docs[0].data();
                const pSnap = await getDoc(doc(shopDb.collection("config"), "permissions"));
                let pData = pSnap.exists() ? pSnap.data() : {};
                
                setPerms(pData); setUser(uData);
                const r = uData.role ? uData.role.toLowerCase() : 'operator';
                setActiveTab(pData[r]?.includes('floor') ? 'floor' : (pData[r]?.[0] || 'scheduler'));
            } else { alert("Invalid PIN. Access Denied."); }
        } catch (error) { console.error(error); alert("Authentication failed."); }
    };

    useEffect(() => {
        if (!user) return;
        const unsubs = [
            onSnapshot(collection(db, "Approved_Designs"), s => {
                const parts = s.docs.map(d => ({id: d.id, ...d.data()})).filter(p => ['Inventory', 'Assembly', 'Master Assembly'].includes(p.partClass) || p.category === 'Inventory');
                setHqParts(parts.sort((a,b) => (a.legacyErpId || a.itemName || '').localeCompare(b.legacyErpId || b.itemName || '')));
            }),
            onSnapshot(shopDb.collection("routings"), s => { const arr = s.docs.map(d=>({id: d.id, ...d.data()})); setRoutings(arr); const m={}; arr.forEach(r=>m[r.partId]=r); setRoutingsMap(m); }),
            onSnapshot(shopDb.collection("programs"), s => { const arr = s.docs.map(d=>({id: d.id, ...d.data()})); setPrograms(arr); const m={}; arr.forEach(p=>m[p.id]=p); setProgramsMap(m); }),
            onSnapshot(shopDb.collection("machines"), s => { const arr = s.docs.map(d=>({id: d.id, ...d.data()})); setMachines(arr); const m={}; arr.forEach(x=>m[x.name]=x.category||''); setMachineCategoryMap(m); }),
            onSnapshot(shopDb.collection("machine_categories"), s => { const arr = s.docs.map(d=>({id: d.id, ...d.data()})); setCategories(arr); const m={}; arr.forEach(x=>m[x.name]=x.type||'Manual'); setCategoryTypeMap(m); }),
            onSnapshot(shopDb.collection("setup_codes"), s => setSetupCodes(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("schedule"), s => setSchedule(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("milling"), s => setMilling(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("tooling"), s => setTooling(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("materials"), s => setMaterials(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("custom_orders"), s => setCustomOrders(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(query(shopDb.collection("material_history"), orderBy("t", "desc"), limit(50)), s => setMatHistory(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(query(shopDb.collection("shop_failures"), orderBy("timestamp", "desc")), s => setFailures(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("livio"), s => setLivio(s.docs.map(d=>({id: d.id, ...d.data()})))),
            onSnapshot(shopDb.collection("directory"), s => setUsers(s.docs.map(d=>({id: d.id, ...d.data()}))))
        ];
        return () => unsubs.forEach(u => u()); 
    }, [user]);

    const writeLog = async (msg, cat) => { await addDoc(shopDb.collection("logs"), { u: user.name, msg, cat, t: serverTimestamp() }); };
    const cleanId = (s1, s2) => `${s1}_${s2}`.replace(/[^a-zA-Z0-9]/g, "_");
    const handleDelete = async (col, id) => { if(window.confirm("Delete record?")) { await deleteDoc(doc(shopDb.collection(col), id)); writeLog(`Deleted from ${col}`, 'admin'); } };

    // ==========================================
    // EXECUTION ACTIONS
    // ==========================================
    const handleAddMilling = async () => {
        if (!millForm.partNum || !millForm.woNum || !millForm.qty) return alert("HQ Part, WO #, and Qty required.");
        const routing = routingsMap[millForm.partNum];
        if(!routing) return alert(`ERROR: No routing exists for this Part ID. Please build its sequence in the Routings tab first.`);
        
        let totalEstHrs = 0;
        routing.ops.forEach(op => {
            const prog = programsMap[op.progId];
            if(prog) totalEstHrs += ((parseFloat(prog.setupTime)||0) + ((parseFloat(prog.timePerPiece)||0) * millForm.qty)) / 60;
        });

        let fileUrl = null;
        if (millForm.file) { const fRef = ref(storage, `production_needs/${Date.now()}_${millForm.file.name}`); await uploadBytesResumable(fRef, millForm.file); fileUrl = await getDownloadURL(fRef); }
        await addDoc(shopDb.collection("milling"), { ...millForm, qty: parseFloat(millForm.qty), mach: routing.ops[0]?.machine || "Unassigned", estHrs: parseFloat(totalEstHrs.toFixed(2)), priority: millForm.reqDate ? new Date(millForm.reqDate).getTime() : 9999999999999, fileUrl, phosphate: millForm.phosphate === 'Yes', t: serverTimestamp() });
        writeLog(`Added ${millForm.partNum} to backlog`, 'production');
        setMillForm({ partNum: '', woNum: '', soNum: '', item: '', qty: '', reqDate: '', phosphate: 'No', file: null });
    };

    const pushToTracker = (m) => {
        setDispatchForm({ op: '', routingId: m.partNum || '', woNum: m.woNum || '', targetQty: m.qty || '', estStart: '', estFinish: '', estHrs: m.estHrs || '', notes: `SO: ${m.soNum||'N/A'} | Desc: ${m.item||'None'}`, phosphate: m.phosphate ? 'Yes' : 'No', _sourceId: m.id, _customFileUrl: m.fileUrl || null, _reqDate: m.reqDate || null });
        setActiveTab('scheduler');
    };

    const handleDispatch = async () => {
        if(!dispatchForm.routingId) return alert("Select an HQ Part Routing to dispatch.");
        const routing = routingsMap[dispatchForm.routingId];
        if(!routing || routing.ops.length === 0) return alert("Invalid Routing sequence. Operations missing.");

        const firstOp = routing.ops[0];
        await addDoc(shopDb.collection("schedule"), { 
            routingId: dispatchForm.routingId, currentOpIndex: 0, op: dispatchForm.op || '', mach: firstOp.machine, prog: firstOp.progId, woNum: dispatchForm.woNum, targetQty: parseInt(dispatchForm.targetQty) || null, estStart: dispatchForm.estStart, estFinish: dispatchForm.estFinish, reqDate: dispatchForm._reqDate || null, estHrs: parseFloat(dispatchForm.estHrs) || null, notes: dispatchForm.notes, customFileUrl: dispatchForm._customFileUrl || null, phosphate: dispatchForm.phosphate === 'Yes', status: "Pending", totalPausedMs: 0, partialGoodQty: 0, t: serverTimestamp() 
        });
        if(dispatchForm._sourceId) await deleteDoc(doc(shopDb.collection("milling"), dispatchForm._sourceId));
        writeLog(`Dispatched WO ${dispatchForm.woNum} (OP 1)`, 'scheduler');
        setDispatchForm({ op: '', routingId: '', woNum: '', targetQty: '', estStart: '', estFinish: '', estHrs: '', notes: '', phosphate: 'No' });
    };

    const aiOptimizeSchedule = async () => {
        if(!window.confirm("✨ AI RECOMMENDED SORT: Group identical Setup Codes on Automated machines, and strictly respect Operator Manual capacity limits?")) return;
        const pendingJobs = schedule.filter(s => s.status === 'Pending');
        let jobsByMach = {}; pendingJobs.forEach(t => { if(!jobsByMach[t.mach]) jobsByMach[t.mach] = []; jobsByMach[t.mach].push(t); });
        const batch = writeBatch(db); const today = new Date(); today.setHours(0,0,0,0);
        const operatorManualBlocks = {}; const machineAvailability = {};

        Object.keys(jobsByMach).forEach(mach => {
            machineAvailability[mach] = today.getTime();
            let machJobs = jobsByMach[mach].sort((a, b) => (a.reqDate ? new Date(a.reqDate).getTime() : 9999999999999) - (b.reqDate ? new Date(b.reqDate).getTime() : 9999999999999));
            let optimizedJobs = []; const catName = machineCategoryMap[mach] || "Uncategorized";
            const isManual = categoryTypeMap[catName] === "Manual";

            if (!isManual) {
                while (machJobs.length > 0) {
                    const currentJob = machJobs.shift(); optimizedJobs.push(currentJob);
                    const prog = programsMap[currentJob.prog];
                    const currentSetupCode = prog?.setupCode;
                    if (currentSetupCode) {
                        for (let i = 0; i < machJobs.length; i++) {
                            const p2 = programsMap[machJobs[i].prog];
                            if (p2?.setupCode === currentSetupCode) { optimizedJobs.push(machJobs[i]); machJobs.splice(i, 1); i--; }
                        }
                    }
                }
            } else { optimizedJobs = machJobs; }

            optimizedJobs.forEach(job => {
                let proposedStartMs = machineAvailability[mach];
                const durationMs = (job.estHrs || 1) * 3600000; 
                if (isManual && job.op) {
                    if (!operatorManualBlocks[job.op]) operatorManualBlocks[job.op] = [];
                    let hasConflict = true;
                    while (hasConflict) {
                        const conflict = operatorManualBlocks[job.op].find(block => (proposedStartMs >= block.start && proposedStartMs < block.end) || ((proposedStartMs + durationMs) > block.start && proposedStartMs <= block.start));
                        if (conflict) { proposedStartMs = conflict.end; } else { hasConflict = false; }
                    }
                    operatorManualBlocks[job.op].push({ start: proposedStartMs, end: proposedStartMs + durationMs });
                }
                batch.update(doc(shopDb.collection("schedule"), job.id), { estStart: new Date(proposedStartMs).toISOString().split('T')[0], estFinish: new Date(proposedStartMs + durationMs).toISOString().split('T')[0] });
                machineAvailability[mach] = proposedStartMs + durationMs; 
            });
        });
        await batch.commit(); writeLog('AI Optimized schedule', 'scheduler'); alert("✨ AI Schedule Optimization Complete!");
    };

    const updateJobStatus = async (id, newStatus) => {
        const task = schedule.find(s => s.id === id);
        const payload = { status: newStatus };
        if (newStatus === 'Setup') payload.setupStart = Date.now();
        if (newStatus === 'Running') { payload.actualSetupMins = task?.setupStart ? (Date.now() - task.setupStart) / 60000 : 0; payload.actualStart = serverTimestamp(); }
        if (newStatus === 'Paused') payload.lastPauseStart = Date.now();
        if (newStatus === 'Resume') { payload.status = 'Running'; payload.totalPausedMs = increment(Date.now() - (task?.lastPauseStart || Date.now())); }
        await updateDoc(doc(shopDb.collection("schedule"), id), payload);
        if(newStatus !== 'Resume') writeLog(`Updated Job ${id} to ${newStatus}`, 'production');
    };

    const triggerStartModal = (taskId, progId) => { setModalData({ taskId, prog: programsMap[progId] || {}, task: schedule.find(s=>s.id===taskId) }); setActiveModal('start'); };
    const triggerShiftLog = (taskId) => { setModalData({ taskId, task: schedule.find(s=>s.id===taskId) }); setShiftLogQty(0); setActiveModal('shiftLog'); };
    
    const submitShiftLog = async () => {
        if(shiftLogQty <= 0) return setActiveModal(null);
        await updateDoc(doc(shopDb.collection("schedule"), modalData.taskId), { partialGoodQty: increment(parseInt(shiftLogQty)) });
        writeLog(`Shift Log: ${shiftLogQty} parts for WO# ${modalData.task.woNum}`, 'production');
        setActiveModal(null); alert(`Logged ${shiftLogQty} parts to the running job.`);
    };

    const triggerQcModal = (taskId, progId) => {
        const task = schedule.find(s=>s.id===taskId);
        setModalData({ taskId, prog: programsMap[progId] || {}, task });
        const previouslyLogged = task?.partialGoodQty || 0, target = task?.targetQty || 0, remaining = Math.max(0, target - previouslyLogged);
        setQcForm({ good: remaining, scrap: 0, failReason: 'Out of Tolerance', failNotes: '', failImg: null });
        setActiveModal('qc');
    };

    const finishRun = async (statusType) => {
        const { taskId, prog, task } = modalData;
        const shiftLoggedParts = task.partialGoodQty || 0;
        const gQty = parseInt(qcForm.good) || 0, sQty = parseInt(qcForm.scrap) || 0;
        const grandTotalGood = gQty + shiftLoggedParts, totalPartsRun = gQty + sQty; 

        if(statusType === 'GOOD') {
            if(prog.toolTimes) {
                for (let [toolId, mins] of Object.entries(prog.toolTimes)) {
                    await setDoc(doc(shopDb.collection("tooling"), cleanId(prog.machine, toolId)), { currentHours: increment(mins / 60) }, { merge: true });
                }
            }
            const routing = routingsMap[task.routingId];
            if(task.currentOpIndex === 0 && routing?.isRawMat && routing?.matProfile) {
                const deductInches = (parseFloat(routing.matLength) || 0) * totalPartsRun;
                if(deductInches > 0) {
                    await updateDoc(doc(shopDb.collection("materials"), routing.matProfile), { totalLength: increment(-deductInches) });
                    await addDoc(shopDb.collection("material_history"), { matId: routing.matProfile, woNum: task.woNum || 'N/A', prog: routing.partId, parts: totalPartsRun, inches: deductInches, op: user.name, t: serverTimestamp() });
                }
            }
        } else {
            let imgUrl = null; 
            if(qcForm.failImg) { const fRef = ref(storage, `fails/${Date.now()}.jpg`); await uploadBytesResumable(fRef, qcForm.failImg); imgUrl = await getDownloadURL(fRef); }
            await addDoc(shopDb.collection("shop_failures"), { machine: task.mach, program: prog.name, operator: user.name, reason: qcForm.failReason, notes: qcForm.failNotes, status: 'Open', timestamp: serverTimestamp() });
            
            // 🚀 NEW: Auto-post Failure to Shared Message Board
            await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'ALL', msg: `⚠️ MACHINING FAILURE: ${prog.name} on ${task.mach}. Reason: ${qcForm.failReason}. \nNotes: ${qcForm.failNotes}`, t: serverTimestamp(), readBy: [], isSystem: true });
        }

        const hrsWorked = (Date.now() - (task.actualStart?.toMillis ? task.actualStart.toMillis() : Date.now()) - (task.totalPausedMs || 0)) / 3600000; 
        await updateDoc(doc(shopDb.collection("schedule"), taskId), { status: statusType === 'GOOD' ? "Completed" : "Failed", actualFinish: serverTimestamp(), actualWork: hrsWorked, goodQty: grandTotalGood, scrapQty: sQty });

        if (statusType === 'GOOD') {
            const routing = routingsMap[task.routingId];
            const hasNextOp = routing && task.currentOpIndex < (routing.ops.length - 1);
            if (hasNextOp && grandTotalGood > 0) {
                const nextIndex = task.currentOpIndex + 1;
                const nextOp = routing.ops[nextIndex];
                await addDoc(shopDb.collection("schedule"), { routingId: task.routingId, currentOpIndex: nextIndex, op: '', mach: nextOp.machine, prog: nextOp.progId, woNum: task.woNum, targetQty: grandTotalGood, reqDate: task.reqDate, notes: task.notes, customFileUrl: task.customFileUrl, phosphate: task.phosphate, status: "Pending", totalPausedMs: 0, partialGoodQty: 0, t: serverTimestamp() });
                writeLog(`Spawned OP ${nextIndex + 1} for ${task.woNum}`, 'production');
            } else if (!hasNextOp) {
                const customOrder = customOrders.find(o => o.woNum === task.woNum && o.status !== 'Completed');
                if (customOrder) handleCompleteCustomOrder(customOrder);
            }
        }
        writeLog(`Run finalized: OP ${task.currentOpIndex + 1} of ${task.routingId}`, 'production'); setActiveModal(null);
    };

    const handleCompleteCustomOrder = async (order) => {
        if(!window.confirm(`Mark ${order.partNum} complete?`)) return;
        await updateDoc(doc(shopDb.collection("custom_orders"), order.id), { status: 'Completed', completedAt: serverTimestamp(), completedBy: user.name });
        const pendingForSO = customOrders.filter(o => o.soNum === order.soNum && o.status !== 'Completed' && o.id !== order.id);
        if (pendingForSO.length === 0) {
            
            // 🚀 NEW: Auto-post Custom Order alert to Shared Message Board
            await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'ALL', msg: `✅ CUSTOM ORDER READY: All custom parts for SO ${order.soNum} have finished machining and are ready for the Finishing Floor!`, t: serverTimestamp(), readBy: [], isSystem: true });

            alert(`Part marked complete! Shared Message Board alerted.`);
        } else { alert(`Part complete. SO ${order.soNum} still has ${pendingForSO.length} parts pending.`); }
    };

    const handleExportBatch = async () => {
        const unexported = schedule.filter(s => {
            if (s.status !== 'Completed' || s.erpExported) return false;
            const routing = routingsMap[s.routingId];
            return routing && s.currentOpIndex === (routing.ops.length - 1);
        });
        if(unexported.length === 0) return alert("No new final operations ready to export.");
        if(!window.confirm(`Archive ${unexported.length} finished parts to ERP Exported?`)) return;
        const batch = writeBatch(db); const dateStr = new Date().toISOString().split('T')[0];
        unexported.forEach(job => batch.update(doc(shopDb.collection("schedule"), job.id), { erpExported: true, erpExportDate: dateStr }));
        await batch.commit(); writeLog(`Exported batch to ERP`, 'admin');
    };

    // ==========================================
    // RENDERERS
    // ==========================================
    const renderModal = () => {
        if (!activeModal) return null;
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: '#fff', padding: '30px', borderRadius: '12px', width: activeModal === 'specs' ? '800px' : '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                    
                    {activeModal === 'specs' && (
                        <div>
                            <h2 style={{ color: '#0056b3', marginTop: 0, borderBottom: '2px solid #ccc', paddingBottom: '10px' }}>JOB SPECIFICATIONS: {modalData.woNum}</h2>
                            <div style={{ display: 'flex', gap: '20px' }}>
                                {modalData.imageUrl && (
                                    <div style={{ flex: 1 }}>
                                        <img src={modalData.imageUrl} alt="Part" style={{ width: '100%', border: '2px solid #ccc', borderRadius: '8px' }}/>
                                    </div>
                                )}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                                        <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>CLIENT</div>
                                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#000' }}>{modalData.clientName || 'N/A'}</div>
                                    </div>
                                    {modalData.note && (
                                        <div style={{ background: '#fffdf5', padding: '15px', borderRadius: '8px', border: '1px solid #f39c12' }}>
                                            <div style={{ fontSize: '12px', color: '#f39c12', fontWeight: 'bold' }}>CLIENT / RFI NOTES</div>
                                            <div style={{ fontSize: '14px', whiteSpace: 'pre-wrap' }}>{modalData.note}</div>
                                        </div>
                                    )}
                                    {modalData.cpqSpecs && Object.keys(modalData.cpqSpecs).length > 0 && (
                                        <div style={{ background: '#eef5ff', padding: '15px', borderRadius: '8px', border: '1px solid #0056b3' }}>
                                            <div style={{ fontSize: '12px', color: '#0056b3', fontWeight: 'bold', marginBottom: '5px' }}>CPQ BUILD SPECS</div>
                                            {Object.entries(modalData.cpqSpecs).map(([k, v]) => {
                                                const part = hqParts.find(p => p.id === v);
                                                const displayVal = part ? part.itemName : v;
                                                return (
                                                    <div key={k} style={{ fontSize: '13px', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #cce0ff', padding: '6px 0' }}>
                                                        <span style={{ color: '#555' }}>{k}:</span><span style={{ fontWeight: 'bold' }}>{displayVal}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <button onClick={() => setActiveModal(null)} style={{ width: '100%', background: '#888', border: 'none', padding: '15px', color: '#fff', fontWeight: 'bold', cursor: 'pointer', marginTop: '20px', borderRadius: '6px' }}>CLOSE VIEW</button>
                        </div>
                    )}

                    {activeModal === 'start' && (
                        <div>
                            <h2 style={{ color: '#0056b3', marginTop: 0 }}>First Part Verification</h2>
                            <div style={{ background: '#fffdf5', padding: '15px', borderLeft: '5px solid #f39c12', whiteSpace: 'pre-wrap', marginBottom: '20px' }}><b>Instructions:</b><br/>{modalData.prog.steps || 'None provided'}</div>
                            <div style={{ display: 'flex', gap: '10px' }}><button onClick={() => { updateJobStatus(modalData.taskId, 'Running'); setActiveModal(null); }} style={{ flex: 1, background: '#28a745', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>VERIFIED (Start Run)</button><button onClick={() => setActiveModal(null)} style={{ flex: 1, background: '#dc3545', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>CANCEL</button></div>
                        </div>
                    )}
                    {activeModal === 'shiftLog' && (
                        <div>
                            <h2 style={{ color: '#f39c12', marginTop: 0 }}>Log Intermediate Shift Progress</h2>
                            <div style={{ background: '#f8f9fa', padding: '15px', border: '1px solid #ccc', borderRadius: '8px', textAlign: 'center', marginBottom: '20px' }}><label style={{ color: '#333', fontWeight: 'bold' }}>GOOD PIECES COMPLETED THIS SHIFT</label><input type="number" value={shiftLogQty} onChange={e => setShiftLogQty(e.target.value)} style={{ fontSize: '24px', textAlign: 'center', width: '100%', marginTop: '10px', padding: '10px' }} /></div>
                            <div style={{ display: 'flex', gap: '10px' }}><button onClick={submitShiftLog} style={{ flex: 1, background: '#0056b3', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>LOG PARTS</button><button onClick={() => setActiveModal(null)} style={{ flex: 1, background: '#888', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>CANCEL</button></div>
                        </div>
                    )}
                    {activeModal === 'qc' && (
                        <div>
                            <h2 style={{ color: '#0056b3', marginTop: 0 }}>Final QC & Operation Completion</h2>
                            {modalData.task?.partialGoodQty > 0 && <div style={{ background: '#fffdf5', padding: '10px', border: '1px solid #f39c12', borderRadius: '6px', marginBottom: '15px', fontWeight: 'bold', color: '#f39c12', textAlign: 'center' }}>⚠️ Previous shifts logged {modalData.task.partialGoodQty} completed parts.</div>}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div style={{ background: '#eafaf1', padding: '15px', border: '1px solid #28a745', borderRadius: '8px', textAlign: 'center' }}><label style={{ color: '#28a745', fontWeight: 'bold' }}>GOOD PIECES (YOUR SHIFT)</label><input type="number" value={qcForm.good} onChange={e => setQcForm({...qcForm, good: e.target.value})} style={{ fontSize: '24px', textAlign: 'center', width: '100%', marginTop: '10px' }} /></div>
                                <div style={{ background: '#fff0f0', padding: '15px', border: '1px solid #dc3545', borderRadius: '8px', textAlign: 'center' }}><label style={{ color: '#dc3545', fontWeight: 'bold' }}>SCRAP PIECES</label><input type="number" value={qcForm.scrap} onChange={e => setQcForm({...qcForm, scrap: e.target.value})} style={{ fontSize: '24px', textAlign: 'center', width: '100%', marginTop: '10px' }} /></div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}><button onClick={() => finishRun('GOOD')} style={{ flex: 1, background: '#28a745', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>GOOD (Log & Complete OP)</button><button onClick={() => finishRun('BAD')} style={{ flex: 1, background: '#dc3545', color: '#fff', border: 'none', padding: '15px', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px' }}>BAD (Submit Failure)</button></div>
                            <button onClick={() => setActiveModal(null)} style={{ width: '100%', background: 'none', border: 'none', padding: '15px', color: '#888', cursor: 'pointer', marginTop: '10px' }}>Cancel</button>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderFloorTab = () => {
        const activeJobs = schedule.filter(s => ['Running', 'Setup', 'Paused'].includes(s.status));
        return (
            <div>
                <h2 style={{ color: '#0056b3' }}>Active Machine Floor</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                    {machines.map(m => {
                        const mJobs = activeJobs.filter(j => j.mach === m.name);
                        const isSetup = mJobs.some(j => j.status === 'Setup');
                        return (
                            // 🚀 ADJUSTED: Border reduced from 3px/2px to 1px/2px for lighter aesthetic
                            <div key={m.id} style={{ background: '#fff', border: mJobs.length > 0 ? (isSetup ? '2px solid #0056b3' : '2px solid #f39c12') : '1px solid #ccc', borderRadius: '8px', padding: '20px', textAlign: 'center', cursor: 'pointer', transition: '0.2s' }} onClick={() => setActiveTab('scheduler')}>
                                <h3 style={{ margin: '0 0 10px 0', fontSize: '22px' }}>{m.name}</h3>
                                {mJobs.length > 0 ? (
                                    <div style={{ background: isSetup ? '#eef5ff' : '#fffdf5', padding: '10px', borderRadius: '6px', textAlign: 'left' }}>
                                        <div style={{ color: isSetup ? '#0056b3' : '#f39c12', fontWeight: 'bold', marginBottom: '10px' }}>⚡ ACTIVE: {mJobs.length}</div>
                                        {mJobs.map(j => (
                                            <div key={j.id} style={{ fontSize: '14px', borderTop: '1px solid #ccc', paddingTop: '10px', marginTop: '5px' }}>
                                                <b>{j.woNum}</b> - <span style={{ color: j.status === 'Setup' ? '#0056b3' : '#f39c12', fontWeight: 'bold' }}>{j.status}</span><br/>
                                                <span style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>OP {j.currentOpIndex+1}/{routingsMap[j.routingId]?.ops?.length||1}: {programsMap[j.prog]?.name || j.prog}</span>
                                                <br/><span style={{ fontSize: '12px', color: '#888' }}>Part: {j.routingId} | Op: {j.op}</span>
                                            </div>
                                        ))}
                                    </div>
                                ) : <div style={{ color: '#888', fontWeight: 'bold', marginTop: '20px' }}>IDLE / READY</div>}
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    };

    const renderSchedulerTab = () => {
        const activeTracker = schedule.filter(s => !['Completed', 'Failed'].includes(s.status)).sort((a, b) => b.t?.toMillis() - a.t?.toMillis());
        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h2 style={{ color: '#0056b3', margin: 0 }}>Active Production Tracker</h2>
                    {['admin', 'programmer'].includes(safeUserRole) && <button onClick={aiOptimizeSchedule} style={{ background: '#f39c12', color: '#000', border: 'none', padding: '8px 15px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>✨ AI OPTIMIZE SCHEDULE</button>}
                </div>
                {['admin', 'programmer'].includes(safeUserRole) && (
                    <div style={{ background: '#fff', border: '1px solid #0056b3', padding: '20px', borderRadius: '10px', marginBottom: '25px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '10px' }}>
                            <select value={dispatchForm.op} onChange={e => setDispatchForm({...dispatchForm, op: e.target.value})} style={{ padding: '10px' }}><option value="">Operator (For OP 1)...</option>{users.filter(u => !u.hidden && ['operator', 'programmer'].includes(u.role?.toLowerCase())).map(u => <option key={u.id} value={u.name}>{u.name}</option>)}</select>
                            <select value={dispatchForm.routingId} onChange={e => { 
                                const rId = e.target.value; const routing = routingsMap[rId]; 
                                if(routing && routing.ops.length > 0) {
                                    const p = programsMap[routing.ops[0].progId];
                                    const est = p && dispatchForm.targetQty ? (((parseFloat(p.setupTime)||0)+((parseFloat(p.timePerPiece)||0)*dispatchForm.targetQty))/60).toFixed(2) : '';
                                    setDispatchForm({...dispatchForm, routingId: rId, estHrs: est});
                                } else { setDispatchForm({...dispatchForm, routingId: rId, estHrs: ''}); }
                            }} style={{ padding: '10px', gridColumn: 'span 2' }}>
                                <option value="">Select HQ Part (Routing)...</option>{routings.map(r => <option key={r.id} value={r.partId}>{r.partId} ({r.ops.length} Ops)</option>)}
                            </select>
                            <input type="text" placeholder="WO #" value={dispatchForm.woNum} onChange={e => setDispatchForm({...dispatchForm, woNum: e.target.value})} style={{ padding: '10px' }} />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 2fr 1fr', gap: '10px', marginTop: '10px' }}>
                            <input type="number" placeholder="Qty" value={dispatchForm.targetQty} onChange={e => setDispatchForm({...dispatchForm, targetQty: e.target.value})} style={{ padding: '10px' }} /><input type="date" value={dispatchForm.estStart} onChange={e => setDispatchForm({...dispatchForm, estStart: e.target.value})} style={{ padding: '10px' }} /><input type="date" value={dispatchForm.estFinish} onChange={e => setDispatchForm({...dispatchForm, estFinish: e.target.value})} style={{ padding: '10px' }} /><input type="number" placeholder="Est Hrs (OP 1)" step="0.1" value={dispatchForm.estHrs} onChange={e => setDispatchForm({...dispatchForm, estHrs: e.target.value})} style={{ padding: '10px' }} /><input type="text" placeholder="Notes" value={dispatchForm.notes} onChange={e => setDispatchForm({...dispatchForm, notes: e.target.value})} style={{ padding: '10px' }} /><select value={dispatchForm.phosphate} onChange={e => setDispatchForm({...dispatchForm, phosphate: e.target.value})} style={{ padding: '10px' }}><option value="No">Phos: No</option><option value="Yes">Phos: Yes</option></select>
                        </div>
                        <button onClick={handleDispatch} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '12px', width: '100%', fontWeight: 'bold', borderRadius: '6px', marginTop: '15px', cursor: 'pointer' }}>DISPATCH WO TO FLOOR</button>
                    </div>
                )}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', background: '#fff', borderRadius: '8px', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ background: '#e9ecef', borderBottom: '2px solid #0056b3' }}>
                            <tr><th style={{ padding: '12px', textAlign: 'left' }}>Part & Sequence</th><th style={{ padding: '12px', textAlign: 'left' }}>WO #</th><th style={{ padding: '12px', textAlign: 'left' }}>Machine</th><th style={{ padding: '12px', textAlign: 'left' }}>Operator</th><th style={{ padding: '12px', textAlign: 'center' }}>Target</th><th style={{ padding: '12px', textAlign: 'center' }}>Status</th><th style={{ padding: '12px', textAlign: 'right' }}>Actions</th></tr>
                        </thead>
                        <tbody>
                            {activeTracker.length === 0 && <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>Tracker is empty.</td></tr>}
                            {activeTracker.map(t => {
                                const canRun = t.op === user.name || safeUserRole === 'admin';
                                const rowColor = t.status === 'Running' ? '#eef5ff' : (t.status === 'Paused' ? '#fff0f0' : (t.status === 'Setup' ? '#fffdf5' : '#fff'));
                                return (
                                <tr key={t.id} style={{ borderBottom: '1px solid #eee', background: rowColor }}>
                                    <td style={{ padding: '12px' }}><b style={{ color: '#0056b3', fontSize: '16px' }}>{t.routingId}</b> {t.phosphate && <span style={{ background: '#f39c12', padding: '2px 4px', fontSize: '10px', borderRadius: '4px' }}>PHOS</span>}<br/><span style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>OP {t.currentOpIndex+1}/{routingsMap[t.routingId]?.ops?.length||1}: {programsMap[t.prog]?.name || t.prog}</span></td>
                                    <td style={{ padding: '12px', color: '#dc3545', fontWeight: 'bold' }}>{t.woNum}</td><td style={{ padding: '12px' }}>{t.mach}</td><td style={{ padding: '12px' }}>{t.op || <span style={{ color: '#f39c12', fontWeight: 'bold' }}>Unassigned</span>}</td>
                                    <td style={{ padding: '12px', textAlign: 'center' }}>{t.targetQty || '-'} {t.partialGoodQty > 0 && <span style={{ color: '#28a745', fontSize: '11px', display: 'block' }}>(Logged: {t.partialGoodQty})</span>}</td>
                                    <td style={{ padding: '12px', textAlign: 'center' }}><span style={{ background: t.status === 'Running' ? '#0056b3' : (t.status === 'Paused' ? '#dc3545' : (t.status === 'Setup' ? '#f39c12' : '#888')), color: t.status === 'Setup' ? '#000' : '#fff', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>{t.status.toUpperCase()}</span></td>
                                    <td style={{ padding: '12px', textAlign: 'right' }}>
                                        {canRun && t.status === 'Pending' && <button onClick={() => updateJobStatus(t.id, 'Setup')} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>BEGIN SETUP</button>}
                                        {canRun && t.status === 'Setup' && <button onClick={() => triggerStartModal(t.id, t.prog)} style={{ background: '#f39c12', color: '#000', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>VERIFY & RUN</button>}
                                        {canRun && t.status === 'Running' && (
                                            <>
                                                <button onClick={() => updateJobStatus(t.id, 'Paused')} style={{ background: '#888', color: '#fff', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginRight: '5px' }}>PAUSE</button>
                                                <button onClick={() => triggerShiftLog(t.id)} style={{ background: '#17a2b8', color: '#fff', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginRight: '5px' }}>SHIFT LOG</button>
                                                <button onClick={() => triggerQcModal(t.id, t.prog)} style={{ background: '#28a745', color: '#fff', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>FINISH OP</button>
                                            </>
                                        )}
                                        {canRun && t.status === 'Paused' && <button onClick={() => updateJobStatus(t.id, 'Resume')} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>RESUME</button>}
                                        {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => handleDelete('schedule', t.id)} style={{ background: '#fff0f0', color: '#dc3545', border: '1px solid #ffcccc', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', marginLeft: '5px' }}>DEL</button>}
                                    </td>
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderMillingTab = () => {
        const grouped = { 'Uncategorized': [] }; categories.forEach(c => grouped[c.name] = []); milling.forEach(m => { const cat = machineCategoryMap[m.mach] || 'Uncategorized'; if(!grouped[cat]) grouped[cat] = []; grouped[cat].push(m); });
        return (
            <div>
                <h2 style={{ color: '#0056b3' }}>Production Backlog</h2>
                <div style={{ background: '#fff', border: '1px solid #0056b3', padding: '20px', borderRadius: '10px', marginBottom: '25px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px' }}><input type="text" placeholder="Internal Description (Optional)" value={millForm.item} onChange={e => setMillForm({...millForm, item: e.target.value})} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} /><input type="number" placeholder="Target Qty" value={millForm.qty} onChange={e => setMillForm({...millForm, qty: e.target.value})} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} /></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px' }}>
                        <div style={{ position: 'relative' }}>
                            <select value={millForm.partNum} onChange={e => setMillForm({...millForm, partNum: e.target.value})} style={{ padding: '10px', width: '100%', boxSizing: 'border-box', border: '2px solid #0056b3', borderRadius: '4px', fontWeight: 'bold' }}>
                                <option value="">Select Engineered HQ Part...</option>{routings.map(r => <option key={r.id} value={r.partId}>{r.partId}</option>)}
                            </select>
                        </div>
                        <input type="text" placeholder="WO #" value={millForm.woNum} onChange={e => setMillForm({...millForm, woNum: e.target.value})} style={{ padding: '10px', border: '2px solid #dc3545', borderRadius: '4px' }} /><input type="text" placeholder="SO #" value={millForm.soNum} onChange={e => setMillForm({...millForm, soNum: e.target.value})} style={{ padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginTop: '10px', alignItems: 'end' }}>
                        <div><small style={{ fontWeight: 'bold' }}>Req Date:</small><input type="date" value={millForm.reqDate} onChange={e => setMillForm({...millForm, reqDate: e.target.value})} style={{ padding: '10px', width: '100%', boxSizing: 'border-box', borderRadius: '4px' }} /></div>
                        <div><small style={{ fontWeight: 'bold' }}>Print (Opt):</small><input type="file" onChange={e => setMillForm({...millForm, file: e.target.files[0]})} style={{ padding: '10px', width: '100%', boxSizing: 'border-box' }} /></div>
                        <div><small style={{ color: '#f39c12', fontWeight: 'bold' }}>Phosphate?</small><select value={millForm.phosphate} onChange={e => setMillForm({...millForm, phosphate: e.target.value})} style={{ padding: '10px', width: '100%', boxSizing: 'border-box', borderRadius: '4px' }}><option value="No">No</option><option value="Yes">Yes</option></select></div>
                    </div>
                    <button onClick={handleAddMilling} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '12px', width: '100%', marginTop: '15px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold' }}>ADD TO BACKLOG</button>
                </div>
                {Object.keys(grouped).map(cat => {
                    const groupItems = grouped[cat].sort((a, b) => a.priority - b.priority);
                    if (groupItems.length === 0 && cat === 'Uncategorized') return null;
                    return (
                        <div key={cat} style={{ background: '#fff', border: '1px solid #ccc', borderRadius: '8px', padding: '20px', marginBottom: '20px' }}>
                            <h3 style={{ margin: '0 0 15px 0', color: '#0056b3', borderBottom: '2px solid #0056b3', paddingBottom: '5px' }}>{cat} Queue</h3>
                            {groupItems.length === 0 ? <div style={{ color: '#888', fontStyle: 'italic' }}>No pending jobs.</div> : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
                                    {groupItems.map(m => {
                                        return (
                                        <div key={m.id} style={{ background: '#f8f9fa', padding: '15px', border: '1px solid #ccc', borderRadius: '8px', position: 'relative' }}>
                                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => handleDelete('milling', m.id)} style={{ position: 'absolute', top: '10px', right: '10px', background: '#fff0f0', border: '1px solid #ffcccc', color: '#dc3545', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>Del</button>}
                                            <h4 style={{ margin: '0 0 5px 0', color: '#0056b3', fontSize: '16px' }}>{m.partNum} {m.phosphate && <span style={{ background: '#f39c12', padding: '2px 4px', fontSize: '10px', borderRadius: '4px' }}>PHOS</span>}</h4>
                                            <div style={{ fontSize: '12px', marginBottom: '5px' }}><b>WO:</b> <span style={{ color: '#dc3545', fontWeight: 'bold' }}>{m.woNum}</span> {m.soNum && `| SO: ${m.soNum}`}</div>
                                            <div style={{ fontSize: '12px', display: 'flex', gap: '10px', marginBottom: '5px' }}><span><b>Target:</b> {m.qty}</span></div>
                                            {m.reqDate && <div style={{ fontSize: '12px', color: '#dc3545', fontWeight: 'bold' }}>Req By: {m.reqDate}</div>}
                                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => pushToTracker(m)} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '8px', width: '100%', marginTop: '10px', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold', fontSize: '11px' }}>PUSH TO TRACKER</button>}
                                        </div>
                                    )})}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const renderCustomTab = () => {
        const activeOrders = customOrders.filter(o => o.status !== 'Completed').sort((a,b) => a.priority - b.priority);
        const rods = activeOrders.filter(o => o.category === 'Cut to Size Rods');
        const fabs = activeOrders.filter(o => o.category === 'Custom Fabrication');

        const CustomCard = ({ order }) => {
            // Generates raw ZPL for a standard 2x4 Zebra label
            const printZebraLabel = (order) => {
                const zpl = `
                    ^XA
                    ^FO50,50^A0N,40,40^FDWO: ${order.woNum}^FS
                    ^FO50,100^A0N,30,30^FDSO: ${order.soNum}^FS
                    ^FO50,150^A0N,25,25^FDCustomer: ${order.clientName}^FS
                    ^FO50,200^A0N,25,25^FDItem: ${order.item || order.partNum}^FS
                    ^FO50,250^A0N,25,25^FDQty: ${order.qty}  ${order.cutLength ? `Cut: ${order.cutLength}"` : ''}^FS
                    ^FO50,300^BY3,2,70^BCN,70,Y,N,N^FD${order.woNum}^FS
                    ^XZ
                `;
                // Route this via PrintNode API or raw socket to your Wilmington floor printers
                console.log("Sending ZPL to Zebra Printer:", zpl);
                alert(`🖨️ Zebra Label Spooled for ${order.woNum}`);
            };

            const handleStartProcess = async () => {
                await updateDoc(doc(db, "shop_custom_orders", order.id), { status: 'In Process' });
                // Alert Finishing Floor Setup Queue
                await addDoc(collection(db, "global_messages"), { 
                    sender: 'System', sourceApp: 'SHOP', target: 'FINISHING', 
                    msg: `Custom Fab Started for SO: ${order.soNum}.`, t: serverTimestamp(), isSystem: true 
                });
            };

            const handleCompleteWithLabel = async () => {
                if (!window.confirm(`Mark ${order.woNum} complete and print Zebra label?`)) return;
                
                printZebraLabel(order);
                
                await updateDoc(doc(db, "shop_custom_orders", order.id), { 
                    status: 'Completed', completedAt: serverTimestamp(), completedBy: user.name 
                });

                // Ping Pick/Pack App that custom staging is ready
                await addDoc(collection(db, "global_messages"), { 
                    sender: 'System', sourceApp: 'SHOP', target: 'PICK_PACK', 
                    msg: `STAGING ALERT: Custom parts for ${order.woNum} are arriving at staging.`, t: serverTimestamp(), isSystem: true 
                });

                const pendingForSO = customOrders.filter(o => o.soNum === order.soNum && o.status !== 'Completed' && o.id !== order.id);
                if (pendingForSO.length === 0) {
                    await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'ALL', msg: `✅ CUSTOM ORDER READY: All custom parts for SO ${order.soNum} have finished machining and are ready for the Finishing Floor!`, t: serverTimestamp(), readBy: [], isSystem: true });
                }
            };

            const isRunning = order.status === 'In Process';

            return (
                <div style={{ background: '#fff', border: '1px solid #ccc', borderLeft: isRunning ? '6px solid #28a745' : (order.category === 'Cut to Size Rods' ? '6px solid #0056b3' : '6px solid #f39c12'), borderRadius: '8px', padding: '15px', marginBottom: '15px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <h4 style={{ margin: '0 0 5px 0', fontSize: '16px', color: '#333' }}>{order.item || order.partNum}</h4>
                        <span style={{ background: isRunning ? '#28a745' : '#e9ecef', color: isRunning ? '#fff' : '#000', padding: '4px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>
                            {isRunning ? 'IN PROCESS' : `WO: ${order.woNum}`}
                        </span>
                    </div>
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '10px' }}>SO: {order.soNum}</div>
                    <div style={{ display: 'flex', gap: '15px', marginBottom: '10px', background: '#f8f9fa', padding: '10px', borderRadius: '6px' }}>
                        <div><small style={{ display: 'block', color: '#888', fontWeight: 'bold' }}>REQ QTY</small><span style={{ fontSize: '16px', fontWeight: 'bold', color: '#28a745' }}>{order.qty}</span></div>
                        {order.cutLength && <div><small style={{ display: 'block', color: '#888', fontWeight: 'bold' }}>CUT TO</small><span style={{ fontSize: '16px', fontWeight: 'bold', color: '#0056b3' }}>{order.cutLength}"</span></div>}
                        <div><small style={{ display: 'block', color: '#888', fontWeight: 'bold' }}>DEADLINE</small><span style={{ fontSize: '14px', fontWeight: 'bold', color: '#dc3545' }}>{order.reqDate || 'ASAP'}</span></div>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button onClick={() => { setModalData(order); setActiveModal('specs'); }} style={{ flex: 1, background: '#17a2b8', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>🖼️ SPECS</button>
                        
                        {!isRunning ? (
                            <button onClick={handleStartProcess} style={{ flex: 1.5, background: '#007bff', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>▶️ START PROCESS</button>
                        ) : (
                            <button onClick={handleCompleteWithLabel} style={{ flex: 1.5, background: '#28a745', color: '#fff', border: 'none', padding: '10px', fontWeight: 'bold', borderRadius: '4px', cursor: 'pointer' }}>✅ COMPLETE & LABEL</button>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div>
                <h2 style={{ color: '#0056b3', marginBottom: '5px' }}>Custom Orders Inbox</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginTop: '20px' }}>
                    <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '10px', border: '1px solid #dee2e6' }}><h3 style={{ margin: '0 0 15px 0', color: '#0056b3', display: 'flex', alignItems: 'center', gap: '10px' }}>📏 Cut-to-Size Rods<span style={{ background: '#0056b3', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{rods.length}</span></h3>{rods.length === 0 ? <div style={{ color: '#888', fontStyle: 'italic' }}>No pending rod orders.</div> : rods.map(o => <CustomCard key={o.id} order={o} />)}</div>
                    <div style={{ background: '#f8f9fa', padding: '20px', borderRadius: '10px', border: '1px solid #dee2e6' }}><h3 style={{ margin: '0 0 15px 0', color: '#f39c12', display: 'flex', alignItems: 'center', gap: '10px' }}>🛠️ Custom Fabrication<span style={{ background: '#f39c12', color: '#000', padding: '2px 8px', borderRadius: '12px', fontSize: '12px' }}>{fabs.length}</span></h3>{fabs.length === 0 ? <div style={{ color: '#888', fontStyle: 'italic' }}>No pending custom fab orders.</div> : fabs.map(o => <CustomCard key={o.id} order={o} />)}</div>
                </div>
            </div>
        );
    };

    const renderExportTab = () => {
        const unexported = schedule.filter(s => {
            if (s.status !== 'Completed' || s.erpExported) return false;
            const routing = routingsMap[s.routingId];
            return routing && s.currentOpIndex === (routing.ops.length - 1);
        });

        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ color: '#0056b3', margin: 0 }}>ERP Export Batch (Final Ops Only)</h2>
                    {['admin', 'purchasing', 'csr'].includes(safeUserRole) && <button onClick={handleExportBatch} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '10px 20px', fontWeight: 'bold', borderRadius: '6px', cursor: 'pointer' }}>MARK BATCH EXPORTED</button>}
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', background: '#fff', borderRadius: '8px', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ background: '#e9ecef', borderBottom: '2px solid #0056b3' }}>
                            <tr><th style={{ padding: '12px', textAlign: 'left' }}>WO #</th><th style={{ padding: '12px', textAlign: 'left' }}>SO #</th><th style={{ padding: '12px', textAlign: 'left' }}>Part #</th><th style={{ padding: '12px', textAlign: 'center' }}>Good Qty Completed</th></tr>
                        </thead>
                        <tbody>
                            {unexported.length === 0 ? <tr><td colSpan="4" style={{ padding: '20px', textAlign: 'center', color: '#888' }}>No unexported completed jobs.</td></tr> : unexported.map(h => (
                                <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '12px', color: '#dc3545', fontWeight: 'bold', fontSize: '16px' }}>{h.woNum}</td>
                                    <td style={{ padding: '12px' }}>{h.notes?.includes("SO:") ? h.notes.split("SO:")[1].split("|")[0].trim() : '-'}</td>
                                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{h.routingId}</td>
                                    <td style={{ padding: '12px', textAlign: 'center', fontSize: '16px', fontWeight: 'bold', color: '#28a745' }}>{h.goodQty}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderLogsTab = () => {
        const history = schedule.filter(s => ['Completed', 'Failed'].includes(s.status)).sort((a,b) => b.actualFinish?.toMillis() - a.actualFinish?.toMillis());
        return (
            <div>
                <h2 style={{ color: '#0056b3' }}>Historical Job Logs</h2>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', background: '#fff', borderRadius: '8px', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead style={{ background: '#e9ecef', borderBottom: '2px solid #0056b3' }}>
                            <tr><th style={{ padding: '12px', textAlign: 'left' }}>Date</th><th style={{ padding: '12px', textAlign: 'left' }}>Routing / OP</th><th style={{ padding: '12px', textAlign: 'left' }}>WO #</th><th style={{ padding: '12px', textAlign: 'left' }}>Operator</th><th style={{ padding: '12px', textAlign: 'center' }}>Yield (G/S)</th><th style={{ padding: '12px', textAlign: 'center' }}>Scrap Rate</th><th style={{ padding: '12px', textAlign: 'center' }}>Act Hrs</th><th style={{ padding: '12px', textAlign: 'center' }}>Status</th>{['admin'].includes(safeUserRole) && <th>Admin</th>}</tr>
                        </thead>
                        <tbody>
                            {history.map(h => {
                                const good = h.goodQty||0, scrap = h.scrapQty||0, total = good+scrap, rate = total>0 ? Math.round((scrap/total)*100) : 0;
                                const dateStr = h.actualFinish?.toDate ? h.actualFinish.toDate().toLocaleDateString() : '-';
                                return (
                                <tr key={h.id} style={{ borderBottom: '1px solid #eee' }}>
                                    <td style={{ padding: '12px' }}>{dateStr}</td>
                                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{h.routingId} (OP {h.currentOpIndex+1})</td>
                                    <td style={{ padding: '12px', color: '#dc3545', fontWeight: 'bold' }}>{h.woNum}</td>
                                    <td style={{ padding: '12px' }}>{h.op}</td>
                                    <td style={{ padding: '12px', textAlign: 'center' }}><span style={{ color: '#28a745', fontWeight: 'bold' }}>{good}</span> / <span style={{ color: '#dc3545', fontWeight: 'bold' }}>{scrap}</span></td>
                                    <td style={{ padding: '12px', textAlign: 'center', color: rate>0 ? '#dc3545' : '#28a745', fontWeight: 'bold' }}>{rate}%</td>
                                    <td style={{ padding: '12px', textAlign: 'center' }}>{h.actualWork?.toFixed(2) || '-'}</td>
                                    <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold', color: h.status === 'Completed' ? '#28a745' : '#dc3545' }}>{h.status.toUpperCase()}</td>
                                    {['admin'].includes(safeUserRole) && <td style={{ padding: '12px', textAlign: 'center' }}><button onClick={() => handleDelete('schedule', h.id)} style={{ background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer' }}>✖</button></td>}
                                </tr>
                            )})}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const renderReportsTab = () => (
        <div>
            <h2 style={{ color: '#0056b3' }}>Visual Failure Reports</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                {failures.map(f => (
                    <div key={f.id} style={{ background: '#fff', borderLeft: '5px solid #dc3545', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                        {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('shop_failures', f.id)} style={{ float: 'right', background: '#fff0f0', border: '1px solid #ffcccc', color: '#dc3545', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>Resolve</button>}
                        <div style={{ color: '#dc3545', fontWeight: 'bold', fontSize: '16px' }}>{f.machine} - {f.reason}</div>
                        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>Op: {f.operator} | Prog: {f.program} | Date: {f.timestamp?.toDate ? f.timestamp.toDate().toLocaleString() : '-'}</div>
                        <div style={{ background: '#f8f9fa', padding: '10px', borderRadius: '6px', marginTop: '10px', fontStyle: 'italic' }}>"{f.notes}"</div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderLivioTab = () => (
        <div>
            <h2 style={{ color: '#0056b3' }}>Handyman Tasks (Livio)</h2>
            <div style={{ background: '#fff', border: '1px solid #ccc', padding: '20px', borderRadius: '10px', marginBottom: '25px' }}>
                <input type="text" placeholder="Job Description" value={livioForm.desc} onChange={e => setLivioForm({...livioForm, desc: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '10px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '10px' }}>
                    <div><small>Req By:</small><input type="date" value={livioForm.reqDate} onChange={e => setLivioForm({...livioForm, reqDate: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '8px' }} /></div>
                    <div><small>Photo (Opt):</small><input type="file" onChange={e => setLivioForm({...livioForm, file: e.target.files[0]})} style={{ width: '100%', boxSizing: 'border-box', padding: '8px' }} /></div>
                </div>
                <button onClick={async () => { if(!livioForm.desc) return; let fileUrl = null; if(livioForm.file) { const fRef = ref(storage, `livio/${Date.now()}_${livioForm.file.name}`); await uploadBytesResumable(fRef, livioForm.file); fileUrl = await getDownloadURL(fRef); } await addDoc(shopDb.collection("livio"), { desc: livioForm.desc, reqDate: livioForm.reqDate, fileUrl, t: serverTimestamp() }); setLivioForm({ desc: '', reqDate: '', file: null }); writeLog('Added Handyman task', 'livio'); }} style={{ background: '#0056b3', color: '#fff', border: 'none', padding: '12px', width: '100%', marginTop: '15px', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>SUBMIT TICKET</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
                {livio.map(l => (
                    <div key={l.id} style={{ background: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                        <button onClick={() => handleDelete('livio', l.id)} style={{ float: 'right', background: '#eafaf1', color: '#28a745', border: '1px solid #28a745', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>Complete</button>
                        <h4 style={{ margin: '0 0 5px 0', color: '#0056b3' }}>Handyman Task</h4>
                        <div style={{ fontSize: '14px', marginBottom: '10px' }}>{l.desc}</div>
                        {l.reqDate && <div style={{ fontSize: '12px', color: '#dc3545', fontWeight: 'bold' }}>Req By: {l.reqDate}</div>}
                        {l.fileUrl && <button onClick={() => window.open(l.fileUrl)} style={{ background: '#f39c12', border: 'none', color: '#000', padding: '4px 8px', fontSize: '11px', borderRadius: '4px', cursor: 'pointer', marginTop: '10px', fontWeight: 'bold' }}>VIEW PHOTO</button>}
                    </div>
                ))}
            </div>
        </div>
    );

    if (!user) {
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#e5e5e5', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace' }}>
                <div style={{ background: '#fff', padding: '40px', border: '2px solid #000', boxShadow: '15px 15px 0 #000', width: '350px', textAlign: 'center' }}>
                    <h2 style={{ color: '#0056b3', margin: '0 0 20px 0', fontSize: '2rem', textTransform: 'uppercase' }}>SHOP COMMAND</h2>
                    <form onSubmit={attemptLogin}>
                        <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{ textAlign: 'center', fontSize: '24px', width: '100%', padding: '15px', margin: '8px 0 20px 0', border: '2px solid #000', boxSizing: 'border-box', fontFamily: 'monospace', fontWeight: 'bold' }} />
                        <button type="submit" style={{ background: '#0056b3', color: '#fff', border: '2px solid #000', padding: '15px', width: '100%', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.2rem', boxShadow: '4px 4px 0 #000' }}>LOGIN</button>
                    </form>
                    <button onClick={() => navigate('/')} style={{ marginTop: '20px', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', textDecoration: 'underline' }}>← BACK TO HUB</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ background: '#f8f9fa', color: '#333', minHeight: '100vh', fontFamily: 'monospace' }}>
            
            {/* 🚀 NAV BAR: Reduced font-weight from 900 to bold, and border from 4px to 2px */}
            <nav style={{ background: '#fff', padding: '20px 30px', borderBottom: '2px solid #000', display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 'bold', color: '#0056b3', fontSize: '1.8rem', textTransform: 'uppercase', letterSpacing: '1px', textShadow: '2px 2px 0px rgba(0,0,0,0.1)' }}>FAB-OS</div>
                
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', flex: 1 }}>
                    {TABS.filter(t => myTabs.includes(t)).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{ 
                            background: activeTab === tab ? '#0056b3' : '#fff', 
                            color: activeTab === tab ? '#fff' : '#000', 
                            border: '1px solid #000', 
                            padding: '10px 20px', 
                            fontWeight: 'bold', 
                            fontSize: '0.9rem', 
                            cursor: 'pointer', 
                            textTransform: 'uppercase',
                            boxShadow: activeTab === tab ? 'inset 3px 3px 0 rgba(0,0,0,0.2)' : '2px 2px 0 #000',
                            transition: '0.1s'
                        }}>
                            {tab}
                        </button>
                    ))}
                </div>

                <button onClick={() => navigate('/')} style={{ color: '#d9534f', background: '#fff', border: '1px solid #d9534f', padding: '10px 20px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '2px 2px 0 #d9534f', fontSize: '0.9rem', textTransform: 'uppercase', transition: '0.1s' }}>🏠 HUB / LOGOUT</button>
            </nav>

            <main style={{ padding: '30px', maxWidth: '1400px', margin: 'auto' }}>
                {ENG_TABS.includes(activeTab) ? (
                    <ShopEngineering 
                        activeTab={activeTab} user={user} hqParts={hqParts} routings={routings} programs={programs} 
                        programsMap={programsMap} machines={machines} categories={categories} setupCodes={setupCodes} 
                        tooling={tooling} materials={materials} users={users} perms={perms} setPerms={setPerms} 
                        writeLog={writeLog} handleDelete={handleDelete} safeUserRole={safeUserRole} TABS={TABS} 
                    />
                ) : (
                    <>
                        {activeTab === 'floor' && renderFloorTab()}
                        {activeTab === 'scheduler' && renderSchedulerTab()}
                        {activeTab === 'milling' && renderMillingTab()}
                        {activeTab === 'custom' && renderCustomTab()}
                        {activeTab === 'export' && renderExportTab()}
                        {activeTab === 'logs' && renderLogsTab()}
                        {activeTab === 'livio' && renderLivioTab()}
                        {activeTab === 'reports' && renderReportsTab()}
                        
                        {/* 🚀 SHARED APPS */}
                        {activeTab === 'assets' && <AssetGalleryTab currentUser={user.name} activeBrand={null} />}
                        {activeTab === 'messaging' && <SharedMessaging currentUser={user.name} currentApp="SHOP" writeLog={writeLog} />}
                    </>
                )}
            </main>

            {renderModal()}
        </div>
    );
};

export default ShopFloor;