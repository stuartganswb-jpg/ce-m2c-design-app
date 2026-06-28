import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, auth, functions, storage } from '../../firebase';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, query, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, increment } from "firebase/firestore";
import { signInWithCustomToken } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import './shopStyles.css';

// IMPORT THE COMPONENTS
import ShopEngineering from './ShopEngineering';
import AssetGalleryTab from '../Shared/AssetGalleryTab';
import ConfiguredItemViewer from '../Shared/ConfiguredItemViewer';
import SharedMessaging from '../Shared/SharedMessaging';
import { mirrorCustomStatusToSibling, releaseSiblingToPickPack } from '../Shared/workOrderContract';
import { subscribeProgramPrints, resolvePrintUrl } from '../Shared/programPrints';

const shopDb = { collection: (colName) => collection(db, colName.startsWith('shop_') ? colName : `shop_${colName}`) };

const TABS = ['floor', 'milling', 'scheduler', 'custom', 'logs', 'export', 'routings', 'programs', 'tooling', 'messaging', 'reports', 'livio', 'assets', 'admin'];
const ENG_TABS = ['routings', 'programs', 'tooling', 'admin'];

const ShopFloor = () => {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [pinInput, setPinInput] = useState("");
    const [activeTab, setActiveTab] = useState('floor');
    const [cfgQuote, setCfgQuote] = useState(null); // "view configured item" read-only 3D modal
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
    const [printMap, setPrintMap] = useState(new Map()); // program name -> program-print asset

    // FORMS
    const [millForm, setMillForm] = useState({ partNum: '', woNum: '', soNum: '', item: '', qty: '', reqDate: '', phosphate: 'No', file: null, _sourceCustomOrderId: null });
    const [livioForm, setLivioForm] = useState({ desc: '', reqDate: '', file: null });

    // MODALS
    const [activeModal, setActiveModal] = useState(null); 
    const [modalData, setModalData] = useState({});
    const [qcForm, setQcForm] = useState({ good: 0, scrap: 0, failReason: 'Out of Tolerance', failNotes: '', failImg: null });
    const [shiftLogQty, setShiftLogQty] = useState(0);

    // Treat a super admin (role or flag) as 'admin' everywhere on the Shop Floor, so admin-gated
    // controls (tool import, add tool/material, deletes, AI optimize…) show for them, not just on tabs.
    const rawRole = user?.role ? user.role.toLowerCase().replace(/[^a-z]/g, '') : 'operator';
    const safeUserRole = (rawRole === 'superadmin' || user?.superAdmin === true) ? 'admin' : rawRole;
    
    // PERMISSIONS BYPASS: Admins ALWAYS see all tabs
    const myTabs = ['admin', 'superadmin'].includes(safeUserRole) ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            // 🔐 Same secure flow as HQ: mint a custom token server-side, then sign in.
            const authenticatePin = httpsCallable(functions, 'authenticatePin');
            const result = await authenticatePin({ pin: pinInput });
            const { token, user: userData } = result.data;

            await signInWithCustomToken(auth, token);

            if (pinInput === "1032") {
                setUser(userData);
                setPerms({ admin: TABS });
            } else {
                const pSnap = await getDoc(doc(shopDb.collection("config"), "permissions"));
                const pData = pSnap.exists() ? pSnap.data() : {};
                setPerms(pData);
                setUser(userData);
                const r = userData.role ? userData.role.toLowerCase() : 'operator';
                setActiveTab(pData[r]?.includes('floor') ? 'floor' : (pData[r]?.[0] || 'scheduler'));
            }
        } catch (error) {
            console.error(error);
            alert("Authentication failed: " + (error.message || "Invalid PIN"));
            setPinInput("");
        }
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
            onSnapshot(collection(db, "hq_users"), s => setUsers(s.docs.map(d=>({id: d.id, ...d.data()})))),
            subscribeProgramPrints(db, setPrintMap)
        ];
        return () => unsubs.forEach(u => u());
    }, [user]);

    const writeLog = async (msg, cat) => { 
        try {
            await addDoc(collection(db, "hq_logs"), { u: user?.name || 'Unknown', msg, cat, t: serverTimestamp() }); 
        } catch (error) {
            console.error("Failed to write log:", error);
        }
    };
    
    const cleanId = (s1, s2) => `${s1}_${s2}`.replace(/[^a-zA-Z0-9]/g, "_");
    // A tool's pool = its machine's category (interchangeable machines share one tool inventory).
    const poolOf = (machineName) => machineCategoryMap[machineName] || machineName;
    const handleDelete = async (col, id) => { if(window.confirm("Delete record?")) { await deleteDoc(doc(shopDb.collection(col), id)); writeLog(`Deleted from ${col}`, 'admin'); } };

    // Full wipe of every doc in a shop_ collection (chunked under the 500-op batch limit).
    const clearShopCollection = async (name) => {
        const snap = await getDocs(shopDb.collection(name));
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 450) {
            const batch = writeBatch(db);
            docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
            await batch.commit();
        }
        return docs.length;
    };
    // Nuke all the TEST job data across the shop tabs. Leaves setup/master data (routings, programs,
    // machines, categories, setup codes, tools, materials) intact.
    const nukeTestJobs = async () => {
        if (!window.confirm("⚠️ NUKE all test jobs across the shop floor?\n\nDeletes every record in: floor schedule, milling/tracker queue, custom orders, QC failures, material-usage history, and handyman tickets.\n\nKEEPS routings, programs, machines, tools and materials. Cannot be undone.")) return;
        if (!window.confirm("Final confirmation — permanently delete all those job records now?")) return;
        try {
            const cols = ['schedule', 'milling', 'custom_orders', 'shop_failures', 'material_history', 'livio'];
            let total = 0;
            for (const c of cols) total += await clearShopCollection(c);
            writeLog(`Nuked ${total} test job records across the shop floor`, 'admin');
            alert(`✅ Cleared ${total} test job records. Shop floor jobs are fresh.`);
        } catch (e) { console.error(e); alert("Nuke failed: " + (e.message || e)); }
    };
    
    const handleLogout = () => {
        localStorage.removeItem('hq_session');
        navigate('/');
    };

    // ==========================================
    // DATA PIPELINE: HQ -> MILLING -> SCHEDULE
    // ==========================================
    const handleAcceptHQOrder = async () => {
        if (!millForm.partNum || !millForm.woNum || !millForm.qty) return alert("Please select an order from the HQ Dispatch Queue.");
        
        const routing = routingsMap[millForm.partNum];
        if (!routing) return alert(`ERROR: No routing exists for Part ID ${millForm.partNum}. Please build its sequence in the Routings tab first.`);
        
        let totalEstHrs = 0;
        let firstMachine = "Unassigned";

        if (routing.ops && routing.ops.length > 0) {
            firstMachine = routing.ops[0].machine || "Unassigned";
            routing.ops.forEach(op => {
                const prog = programsMap[op.progId];
                if(prog) totalEstHrs += ((parseFloat(prog.setupTime)||0) + ((parseFloat(prog.timePerPiece)||0) * millForm.qty)) / 60;
            });
        }

        // 1. Move into the machine backlog queue
        await addDoc(shopDb.collection("milling"), { 
            ...millForm, 
            qty: parseFloat(millForm.qty), 
            mach: firstMachine, 
            estHrs: parseFloat(totalEstHrs.toFixed(2)), 
            priority: millForm.reqDate ? new Date(millForm.reqDate).getTime() : 9999999999999, 
            phosphate: millForm.phosphate === 'Yes', 
            status: 'Backlog',
            t: serverTimestamp() 
        });
        
        // 2. Remove it from the HQ holding queue
        if (millForm._sourceCustomOrderId) {
            await deleteDoc(doc(db, "shop_custom_orders", millForm._sourceCustomOrderId));
        }

        writeLog(`Accepted HQ Order ${millForm.woNum} into backlog`, 'production');
        setMillForm({ partNum: '', woNum: '', soNum: '', item: '', qty: '', reqDate: '', phosphate: 'No', file: null, _sourceCustomOrderId: null });
    };

    const pushToTrackerQueue = async (m) => {
        await updateDoc(doc(shopDb.collection("milling"), m.id), { status: 'Tracker' });
        writeLog(`Pushed ${m.woNum} to Scheduler Queue`, 'scheduler');
    };

    const dispatchToAIQueue = async (m) => {
        const routing = routingsMap[m.partNum];
        const firstOp = routing && routing.ops?.length > 0 ? routing.ops[0] : { machine: 'Unassigned', progId: 'Manual' };

        // 1. Create the Schedule Document (Status: Pending)
        await addDoc(shopDb.collection("schedule"), { 
            routingId: m.partNum, 
            currentOpIndex: 0, 
            op: '', // AI or Operator will assign
            mach: firstOp.machine, 
            prog: firstOp.progId, 
            woNum: m.woNum, 
            targetQty: parseInt(m.qty) || null, 
            estStart: '', // AI will assign
            estFinish: '', // AI will assign
            reqDate: m.reqDate || null, 
            estHrs: parseFloat(m.estHrs) || null, 
            notes: `SO: ${m.soNum||'N/A'} | Desc: ${m.item||'None'}`, 
            customFileUrl: m.fileUrl || null, 
            phosphate: m.phosphate || false, 
            status: "Pending", 
            totalPausedMs: 0, 
            partialGoodQty: 0, 
            t: serverTimestamp() 
        });
        
        // 2. Remove from Tracker Holding Queue
        await deleteDoc(doc(shopDb.collection("milling"), m.id));
        
        writeLog(`Dispatched WO ${m.woNum} to AI Unscheduled Queue`, 'scheduler');
    };

    // ==========================================
    // EXECUTION ACTIONS
    // ==========================================
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
                const pool = poolOf(task.mach);
                for (let [toolName, minsPerPiece] of Object.entries(prog.toolTimes)) {
                    const hrsToAdd = (minsPerPiece * totalPartsRun) / 60;
                    // Resolve the POOLED tool record by name (so VF2/VF4 hit the same tool); fall back to the
                    // legacy machine-keyed id for tools registered before the pool model.
                    const toolRec = tooling.find(t => t.name === toolName && (t.pool || poolOf(t.machine)) === pool);
                    const toolId = toolRec ? toolRec.id : cleanId(task.mach, toolName);
                    await setDoc(doc(shopDb.collection("tooling"), toolId), { currentHours: increment(hrsToAdd) }, { merge: true });
                    // Change-before-breakage: fire once when this run pushes the tool past 90% of its life.
                    if (toolRec && toolRec.maxHours > 0) {
                        const before = toolRec.currentHours || 0, after = before + hrsToAdd, thresh = toolRec.maxHours * 0.9;
                        if (after >= thresh && before < thresh) {
                            await setDoc(doc(shopDb.collection("tooling"), toolId), { needsChange: true }, { merge: true });
                            await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'ALL', msg: `🔧 TOOL CHANGE DUE: ${toolName} (${pool}) at ${Math.round((after / toolRec.maxHours) * 100)}% of life (${after.toFixed(1)}/${toolRec.maxHours}h). Change before it breaks.`, t: serverTimestamp(), readBy: [], isSystem: true });
                        }
                    }
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
            }
        }
        writeLog(`Run finalized: OP ${task.currentOpIndex + 1} of ${task.routingId}`, 'production'); setActiveModal(null);
    };

    const printBinLabel = (job) => {
        const hqPart = hqParts.find(p => p.id === job.routingId || p.legacyErpId === job.routingId);
        const bin = hqPart?.manufacturingSpecs?.binLocation || 'N/A';
        const partName = routingsMap[job.routingId]?.displayName || job.routingId;
        
        const zpl = `
            ^XA
            ^FO50,50^A0N,40,40^FDWO: ${job.woNum}^FS
            ^FO50,100^A0N,30,30^FDPart: ${partName}^FS
            ^FO50,150^A0N,30,30^FDQty: ${job.goodQty}^FS
            ^FO50,220^A0N,50,50^FDBIN: ${bin}^FS
            ^FO50,300^BY3,2,70^BCN,70,Y,N,N^FD${job.woNum}^FS
            ^XZ
        `;
        
        console.log("Sending ZPL to Zebra Printer:", zpl);
        alert(`🖨️ Zebra Label Spooled for WO ${job.woNum}\nRouting to Bin: ${bin}`);
    };

    const handleExportBatch = async () => {
        const unexported = schedule.filter(s => {
            if (s.status !== 'Completed' || s.erpExported) return false;
            const routing = routingsMap[s.routingId];
            return routing && s.currentOpIndex === (routing.ops.length - 1);
        });
        if(unexported.length === 0) return alert("No new final operations ready to export.");
        if(!window.confirm(`Archive ${unexported.length} finished parts to ERP Exported? This signals NetSuite synchronization.`)) return;
        
        const batch = writeBatch(db); const dateStr = new Date().toISOString().split('T')[0];
        unexported.forEach(job => batch.update(doc(shopDb.collection("schedule"), job.id), { erpExported: true, erpExportDate: dateStr }));
        
        await batch.commit(); 
        writeLog(`Exported batch to ERP`, 'admin');
        alert("✅ Batch Exported. NetSuite Work Order Build routine triggered.");
    };

    // ==========================================
    // RENDERERS
    // ==========================================
    const renderModal = () => {
        if (!activeModal) return null;
        return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ background: '#fff', padding: '40px', borderRadius: '2px', width: activeModal === 'specs' ? '800px' : '600px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)' }}>
                    
                    {activeModal === 'start' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--serif)', margin: '0 0 20px 0', color: 'var(--ink)', fontSize: '1.8rem', fontWeight: 500 }}>First Part Verification</h2>
                            <div style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)', whiteSpace: 'pre-wrap', marginBottom: '30px', fontFamily: 'var(--sans)', fontSize: '0.95rem', lineHeight: '1.6', color: 'var(--ink)' }}>
                                <strong style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>Instructions</strong>
                                {modalData.prog.steps || 'None provided'}
                            </div>
                            {(() => {
                                const url = resolvePrintUrl(printMap, modalData.prog?.name, modalData.prog?.drawingUrl);
                                return url
                                    ? <button onClick={() => window.open(url, '_blank')} style={{ width: '100%', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', marginBottom: '20px' }}>🖨 View Program Print</button>
                                    : <div style={{ width: '100%', textAlign: 'center', padding: '12px', marginBottom: '20px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', border: '1px dashed var(--line)', boxSizing: 'border-box' }}>No print on file</div>;
                            })()}
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <button onClick={() => { updateJobStatus(modalData.taskId, 'Running'); setActiveModal(null); }} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Verified (Start Run)</button>
                                <button onClick={() => setActiveModal(null)} style={{ flex: 1, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Cancel</button>
                            </div>
                        </div>
                    )}
                    {activeModal === 'shiftLog' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--serif)', margin: '0 0 20px 0', color: 'var(--ink)', fontSize: '1.8rem', fontWeight: 500 }}>Log Intermediate Shift Progress</h2>
                            <div style={{ background: 'var(--paper-2)', padding: '30px', border: '1px solid var(--line)', textAlign: 'center', marginBottom: '30px' }}>
                                <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>Good Pieces Completed This Shift</label>
                                <input type="number" value={shiftLogQty} onChange={e => setShiftLogQty(e.target.value)} style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', textAlign: 'center', width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', color: 'var(--ink)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <button onClick={submitShiftLog} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Log Parts</button>
                                <button onClick={() => setActiveModal(null)} style={{ flex: 1, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Cancel</button>
                            </div>
                        </div>
                    )}
                    {activeModal === 'qc' && (
                        <div>
                            <h2 style={{ fontFamily: 'var(--serif)', margin: '0 0 20px 0', color: 'var(--ink)', fontSize: '1.8rem', fontWeight: 500 }}>Final QC & Operation Completion</h2>
                            {modalData.task?.partialGoodQty > 0 && <div style={{ background: 'var(--paper)', padding: '16px', border: '1px solid var(--line)', borderLeft: '4px solid var(--brass)', marginBottom: '24px', fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}>Previous shifts logged <strong style={{color: 'var(--ink)'}}>{modalData.task.partialGoodQty}</strong> completed parts.</div>}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '30px' }}>
                                <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', textAlign: 'center' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>Good Pieces (Your Shift)</label>
                                    <input type="number" value={qcForm.good} onChange={e => setQcForm({...qcForm, good: e.target.value})} style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', textAlign: 'center', width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', color: 'var(--ink)' }} />
                                </div>
                                <div style={{ background: '#fdf2f2', padding: '24px', border: '1px solid #d9534f', textAlign: 'center' }}>
                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', display: 'block', marginBottom: '12px' }}>Scrap Pieces</label>
                                    <input type="number" value={qcForm.scrap} onChange={e => setQcForm({...qcForm, scrap: e.target.value})} style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', textAlign: 'center', width: '100%', padding: '12px', border: '1px solid #d9534f', outline: 'none', color: '#d9534f', background: '#fff' }} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '16px' }}>
                                <button onClick={() => finishRun('GOOD')} style={{ flex: 1, background: 'var(--ink)', color: '#fff', border: 'none', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Good (Log & Complete OP)</button>
                                <button onClick={() => finishRun('BAD')} style={{ flex: 1, background: '#d9534f', color: '#fff', border: 'none', padding: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Bad (Submit Failure)</button>
                            </div>
                            <button onClick={() => setActiveModal(null)} style={{ width: '100%', background: 'none', border: 'none', padding: '16px', color: 'var(--ink-soft)', cursor: 'pointer', marginTop: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Cancel</button>
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
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px 0' }}>Active Machine Floor</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
                    {machines.map(m => {
                        const mJobs = activeJobs.filter(j => j.mach === m.name);
                        const isSetup = mJobs.some(j => j.status === 'Setup');
                        return (
                            <div key={m.id} style={{ background: '#fff', border: mJobs.length > 0 ? (isSetup ? '1px solid var(--brass)' : '1px solid var(--ink)') : '1px solid var(--line)', borderRadius: '2px', padding: '24px', cursor: 'pointer', transition: 'all 0.2s', boxShadow: mJobs.length > 0 ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }} onClick={() => setActiveTab('scheduler')}>
                                <h3 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>{m.name}</h3>
                                {mJobs.length > 0 ? (
                                    <div style={{ background: isSetup ? 'var(--paper)' : 'var(--paper-2)', padding: '16px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: isSetup ? 'var(--brass)' : 'var(--ink)', marginBottom: '12px', fontWeight: 500 }}>⚡ Active: {mJobs.length}</div>
                                        {mJobs.map(j => (
                                            <div key={j.id} style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '8px' }}>
                                                <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{j.woNum}</strong> - <span style={{ color: j.status === 'Setup' ? 'var(--brass)' : 'var(--ink-soft)' }}>{j.status}</span><br/>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--ink)', display: 'block', marginTop: '4px' }}>OP {j.currentOpIndex+1}/{routingsMap[j.routingId]?.ops?.length||1}: {programsMap[j.prog]?.name || j.prog}</span>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Part: {routingsMap[j.routingId]?.displayName || j.routingId} | Op: {j.op}</span>
                                                {(() => {
                                                    const prog = programsMap[j.prog];
                                                    const url = prog && resolvePrintUrl(printMap, prog.name, prog.drawingUrl);
                                                    return url ? <button onClick={(e) => { e.stopPropagation(); window.open(url, '_blank'); }} style={{ marginTop: '8px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '4px 10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 Print</button> : null;
                                                })()}
                                            </div>
                                        ))}
                                    </div>
                                ) : <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '24px' }}>Idle / Ready</div>}
                            </div>
                        )
                    })}
                </div>
            </div>
        );
    };

    const renderSchedulerTab = () => {
        const trackerQueue = milling.filter(m => m.status === 'Tracker').sort((a,b) => a.priority - b.priority);
        const activeTracker = schedule.filter(s => !['Completed', 'Failed'].includes(s.status)).sort((a, b) => b.t?.toMillis() - a.t?.toMillis());
        
        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Pipeline Control</span>
                        <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: 0 }}>Active Production Tracker</h2>
                    </div>
                    {['admin', 'programmer'].includes(safeUserRole) && <button onClick={aiOptimizeSchedule} style={{ background: 'var(--brass)', color: '#fff', border: 'none', padding: '12px 20px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>✨ AI Optimize Schedule</button>}
                </div>

                {/* 🚀 QUEUE FROM MILLING BACKLOG */}
                {trackerQueue.length > 0 && (
                    <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '24px', borderRadius: '2px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            Jobs Ready For Dispatch (From Backlog)
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--brass)', letterSpacing: '.1em', border: '1px solid var(--brass)', padding: '4px 8px' }}>{trackerQueue.length} Pending</span>
                        </h3>
                        <div style={{ display: 'flex', overflowX: 'auto', gap: '16px', paddingBottom: '12px' }}>
                            {trackerQueue.map(q => (
                                <div key={q.id} style={{ minWidth: '280px', background: 'var(--paper-2)', padding: '16px', border: '1px solid var(--line)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                                        <span style={{ fontWeight: 500, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>{q.woNum}</span>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Qty: {q.qty}</span>
                                    </div>
                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>{routingsMap[q.partNum]?.displayName || q.partNum}</div>
                                    <button onClick={() => dispatchToAIQueue(q)} style={{ width: '100%', background: 'var(--ink)', color: '#fff', border: 'none', padding: '10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Dispatch to AI Queue</button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                {/* TRACKER TABLE */}
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--paper-2)' }}>
                            <tr>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Part & Sequence</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>WO #</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Machine</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Operator</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Target</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Status</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {activeTracker.length === 0 && <tr><td colSpan="7" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>Tracker is empty. Waiting for HQ Dispatch.</td></tr>}
                            {activeTracker.map(t => {
                                const canRun = t.op === user.name || safeUserRole === 'admin';
                                const rowColor = t.status === 'Running' ? 'var(--paper-2)' : (t.status === 'Paused' ? '#fdf2f2' : (t.status === 'Setup' ? 'var(--paper)' : '#fff'));
                                return (
                                <tr key={t.id} style={{ borderBottom: '1px solid var(--line)', background: rowColor }}>
                                    <td style={{ padding: '16px' }}>
                                        <div style={{ fontWeight: 500, color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>{routingsMap[t.routingId]?.displayName || t.routingId} {t.phosphate && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', border: '1px solid var(--brass)', padding: '2px 6px', marginLeft: '8px' }}>Phos</span>}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '6px' }}>OP {t.currentOpIndex+1}/{routingsMap[t.routingId]?.ops?.length||1}: {programsMap[t.prog]?.name || t.prog}</div>
                                        {(() => {
                                            const prog = programsMap[t.prog];
                                            const url = prog && resolvePrintUrl(printMap, prog.name, prog.drawingUrl);
                                            return url ? <button onClick={() => window.open(url, '_blank')} style={{ marginTop: '6px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '3px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨 Print</button> : null;
                                        })()}
                                    </td>
                                    <td style={{ padding: '16px', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500 }}>{t.woNum}</td>
                                    <td style={{ padding: '16px', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>{t.mach}</td>
                                    <td style={{ padding: '16px', color: t.op ? 'var(--ink)' : 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.95rem', fontStyle: t.op ? 'normal' : 'italic' }}>{t.op || 'Unassigned'}</td>
                                    <td style={{ padding: '16px', textAlign: 'center', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>
                                        {t.targetQty || '-'} 
                                        {t.partialGoodQty > 0 && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', display: 'block', marginTop: '4px', textTransform: 'uppercase' }}>(Logged: {t.partialGoodQty})</span>}
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', padding: '4px 8px', border: '1px solid var(--line)', color: 'var(--ink)', background: t.status === 'Running' ? 'var(--paper)' : 'transparent' }}>
                                            {t.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px', textAlign: 'right' }}>
                                        {canRun && t.status === 'Pending' && <button onClick={() => updateJobStatus(t.id, 'Setup')} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Begin Setup</button>}
                                        {canRun && t.status === 'Setup' && <button onClick={() => triggerStartModal(t.id, t.prog)} style={{ background: 'var(--brass)', color: '#fff', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Verify & Run</button>}
                                        {canRun && t.status === 'Running' && (
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => updateJobStatus(t.id, 'Paused')} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Pause</button>
                                                <button onClick={() => triggerShiftLog(t.id)} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Shift Log</button>
                                                <button onClick={() => triggerQcModal(t.id, t.prog)} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Finish Op</button>
                                            </div>
                                        )}
                                        {canRun && t.status === 'Paused' && <button onClick={() => updateJobStatus(t.id, 'Resume')} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Resume</button>}
                                        {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => handleDelete('schedule', t.id)} style={{ background: 'transparent', color: '#d9534f', border: 'none', padding: '8px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', marginLeft: '8px' }}>Del</button>}
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
        const grouped = { 'Uncategorized': [] }; 
        categories.forEach(c => grouped[c.name] = []); 
        
        milling.filter(m => m.status !== 'Tracker').forEach(m => { 
            const cat = machineCategoryMap[m.mach] || 'Uncategorized'; 
            if(!grouped[cat]) grouped[cat] = []; 
            grouped[cat].push(m); 
        });

        return (
            <div>
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px 0' }}>Production Backlog</h2>
                
                {/* STRICT HQ DISPATCH TOOL */}
                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', marginBottom: '40px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '12px' }}>HQ App-Generated Work Orders</label>
                        <select onChange={(e) => {
                            const order = customOrders.find(o => o.id === e.target.value);
                            if (order) {
                                const matchedRouting = routings.find(r => r.displayName === order.item || r.partId === order.item || (order.partNum && r.partId === order.partNum));
                                setMillForm({
                                    ...millForm,
                                    partNum: matchedRouting ? matchedRouting.partId : (order.partNum || ''),
                                    woNum: order.woNum, 
                                    soNum: order.soNum, 
                                    qty: order.qty, 
                                    reqDate: order.reqDate || '', 
                                    item: order.note || '',
                                    _sourceCustomOrderId: order.id
                                });
                            }
                        }} style={{ padding: '16px', width: '100%', boxSizing: 'border-box', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '1rem', outline: 'none', background: '#fff' }}>
                            <option value="">-- Select Pending Order from RTG Dispatch --</option>
                            {customOrders.filter(o => o.status === 'Pending').map(o => (
                                <option key={o.id} value={o.id}>{o.woNum} - {o.item} (Qty: {o.qty}){(o.routeTo === 'MILLING' || o.isStock) ? ' [STOCK → MILLING]' : ''}</option>
                            ))}
                        </select>
                        <button onClick={handleAcceptHQOrder} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '16px', width: '100%', marginTop: '16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Accept HQ Order to Machine Backlog</button>
                    </div>
                </div>

                {Object.keys(grouped).map(cat => {
                    const groupItems = grouped[cat].sort((a, b) => a.priority - b.priority);
                    if (groupItems.length === 0 && cat === 'Uncategorized') return null;
                    return (
                        <div key={cat} style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', padding: '30px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>{cat} Queue</h3>
                            {groupItems.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>No pending jobs.</div> : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                                    {groupItems.map(m => {
                                        return (
                                        <div key={m.id} style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)', position: 'relative' }}>
                                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => handleDelete('milling', m.id)} style={{ position: 'absolute', top: '16px', right: '16px', background: 'transparent', border: 'none', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Del</button>}
                                            <h4 style={{ margin: '0 0 12px 0', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500 }}>{routingsMap[m.partNum]?.displayName || m.partNum} {m.phosphate && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', border: '1px solid var(--brass)', padding: '2px 6px', marginLeft: '8px' }}>Phos</span>}</h4>
                                            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)', marginBottom: '8px' }}>WO: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{m.woNum}</span> {m.soNum && `| SO: ${m.soNum}`}</div>
                                            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink-soft)', marginBottom: '8px' }}>Target: <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{m.qty}</span></div>
                                            {m.reqDate && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '12px' }}>Req By: {m.reqDate}</div>}
                                            {['admin', 'programmer'].includes(safeUserRole) && <button onClick={() => pushToTrackerQueue(m)} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '12px', width: '100%', marginTop: '20px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Push to Tracker Queue</button>}
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

    const renderExportTab = () => {
        const unexported = schedule.filter(s => {
            if (s.status !== 'Completed' || s.erpExported) return false;
            const routing = routingsMap[s.routingId];
            return routing && s.currentOpIndex === (routing.ops.length - 1);
        });

        return (
            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                    <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: 0 }}>ERP Export Batch (Final Ops Only)</h2>
                    {['admin', 'purchasing', 'csr'].includes(safeUserRole) && <button onClick={handleExportBatch} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '12px 24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Mark Batch Exported</button>}
                </div>
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: 'var(--paper)' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>WO #</th>
                                <th style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>SO #</th>
                                <th style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Part #</th>
                                <th style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Good Qty Completed</th>
                                <th style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', textAlign: 'right', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Logistics</th>
                            </tr>
                        </thead>
                        <tbody>
                            {unexported.length === 0 ? <tr><td colSpan="5" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No unexported completed jobs.</td></tr> : unexported.map(h => (
                                <tr key={h.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                    <td style={{ padding: '16px 24px', color: 'var(--ink)', fontWeight: 500, fontSize: '1.05rem' }}>{h.woNum}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--ink-soft)' }}>{h.notes?.includes("SO:") ? h.notes.split("SO:")[1].split("|")[0].trim() : '-'}</td>
                                    <td style={{ padding: '16px 24px', color: 'var(--ink)', fontWeight: 500 }}>{routingsMap[h.routingId]?.displayName || h.routingId}</td>
                                    <td style={{ padding: '16px 24px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{h.goodQty}</td>
                                    <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                        <button onClick={() => printBinLabel(h)} style={{ background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 16px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🖨️ Print Bin Label</button>
                                    </td>
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
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px 0' }}>Historical Job Logs</h2>
                <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                        <thead style={{ background: 'var(--paper)' }}>
                            <tr>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Date</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Routing / OP</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>WO #</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Operator</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Yield (G/S)</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Scrap Rate</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Act Hrs</th>
                                <th style={{ padding: '16px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Status</th>
                                {['admin'].includes(safeUserRole) && <th style={{ borderBottom: '1px solid var(--line)' }}></th>}
                            </tr>
                        </thead>
                        <tbody>
                            {history.length === 0 && <tr><td colSpan="9" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No historical logs found.</td></tr>}
                            {history.map(h => {
                                const good = h.goodQty||0, scrap = h.scrapQty||0, total = good+scrap, rate = total>0 ? Math.round((scrap/total)*100) : 0;
                                const dateStr = h.actualFinish?.toDate ? h.actualFinish.toDate().toLocaleDateString() : '-';
                                return (
                                <tr key={h.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                    <td style={{ padding: '16px', color: 'var(--ink-soft)', fontSize: '0.9rem' }}>{dateStr}</td>
                                    <td style={{ padding: '16px', color: 'var(--ink)', fontWeight: 500 }}>{routingsMap[h.routingId]?.displayName || h.routingId} <span style={{fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)'}}>(OP {h.currentOpIndex+1})</span></td>
                                    <td style={{ padding: '16px', color: 'var(--ink)', fontWeight: 500 }}>{h.woNum}</td>
                                    <td style={{ padding: '16px', color: 'var(--ink-soft)' }}>{h.op}</td>
                                    <td style={{ padding: '16px', textAlign: 'center' }}><span style={{ color: 'var(--ink)', fontWeight: 500 }}>{good}</span> / <span style={{ color: '#d9534f' }}>{scrap}</span></td>
                                    <td style={{ padding: '16px', textAlign: 'center', color: rate>0 ? '#d9534f' : 'var(--ink-soft)', fontWeight: 500 }}>{rate}%</td>
                                    <td style={{ padding: '16px', textAlign: 'center', color: 'var(--ink-soft)' }}>{h.actualWork?.toFixed(2) || '-'}</td>
                                    <td style={{ padding: '16px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: h.status === 'Completed' ? 'var(--ink)' : '#d9534f' }}>{h.status}</td>
                                    {['admin'].includes(safeUserRole) && <td style={{ padding: '16px', textAlign: 'center' }}><button onClick={() => handleDelete('schedule', h.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1rem' }}>×</button></td>}
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
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px 0' }}>Visual Failure Reports</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {failures.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)' }}>No failure reports.</div>}
                {failures.map(f => (
                    <div key={f.id} style={{ background: '#fff', border: '1px solid var(--line)', borderLeft: '4px solid #d9534f', padding: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        {['admin'].includes(safeUserRole) && <button onClick={() => handleDelete('shop_failures', f.id)} style={{ float: 'right', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Resolve</button>}
                        <div style={{ color: '#d9534f', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, marginBottom: '8px' }}>{f.machine} - {f.reason}</div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Op: {f.operator} | Prog: {f.program} | Date: {f.timestamp?.toDate ? f.timestamp.toDate().toLocaleString() : '-'}</div>
                        <div style={{ background: 'var(--paper)', padding: '16px', border: '1px solid var(--line)', fontStyle: 'italic', color: 'var(--ink)', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>"{f.notes}"</div>
                    </div>
                ))}
            </div>
        </div>
    );

    const renderLivioTab = () => (
        <div>
            <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', margin: '0 0 24px 0' }}>Handyman Tasks (Livio)</h2>
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', marginBottom: '40px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <input type="text" placeholder="Job Description" value={livioForm.desc} onChange={e => setLivioForm({...livioForm, desc: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                    <div><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Req By</label><input type="date" value={livioForm.reqDate} onChange={e => setLivioForm({...livioForm, reqDate: e.target.value})} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', outline: 'none' }} /></div>
                    <div><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Photo (Opt)</label><input type="file" onChange={e => setLivioForm({...livioForm, file: e.target.files[0]})} style={{ width: '100%', boxSizing: 'border-box', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }} /></div>
                </div>
                <button onClick={async () => { if(!livioForm.desc) return; let fileUrl = null; if(livioForm.file) { const fRef = ref(storage, `livio/${Date.now()}_${livioForm.file.name}`); await uploadBytesResumable(fRef, livioForm.file); fileUrl = await getDownloadURL(fRef); } await addDoc(shopDb.collection("livio"), { desc: livioForm.desc, reqDate: livioForm.reqDate, fileUrl, t: serverTimestamp() }); setLivioForm({ desc: '', reqDate: '', file: null }); writeLog('Added Handyman task', 'livio'); }} style={{ background: 'var(--ink)', color: '#fff', border: 'none', padding: '16px', width: '100%', marginTop: '24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }}>Submit Ticket</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '24px' }}>
                {livio.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)' }}>No active tasks.</div>}
                {livio.map(l => (
                    <div key={l.id} style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '12px', marginBottom: '16px' }}>
                            <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)', fontWeight: 500 }}>Handyman Task</h4>
                            <button onClick={() => handleDelete('livio', l.id)} style={{ background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Complete</button>
                        </div>
                        <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', color: 'var(--ink)', marginBottom: '16px', lineHeight: '1.5', flex: 1 }}>{l.desc}</div>
                        {l.reqDate && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Req By: {l.reqDate}</div>}
                        {l.fileUrl && <button onClick={() => window.open(l.fileUrl)} style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', width: '100%' }}>View Photo</button>}
                    </div>
                ))}
            </div>
        </div>
    );

    const renderCustomTab = () => {
        // Keeping logic for Custom Fab orders from RTG
        const activeOrders = customOrders.filter(o => o.status !== 'Completed' && o.status !== 'Sent to Plating').sort((a,b) => a.priority - b.priority);
        const rods = activeOrders.filter(o => o.category === 'Cut to Size Rods');
        const fabs = activeOrders.filter(o => o.category === 'Custom Fabrication');

        const CustomCard = ({ order }) => {
            const printZebraLabel = (order) => {
                const zpl = `
                    ^XA
                    ^FO50,50^A0N,40,40^FDWO: ${order.woNum}^FS
                    ^FO50,100^A0N,30,30^FDSO: ${order.soNum}^FS
                    ${order.isOutsourced ? `^FO50,150^A0N,30,30^FDFinish: ${order.finishRecipe}^FS` : ''}
                    ${order.isOutsourced ? `^FO50,200^A0N,30,30^FDService/Ea: $${order.outsourcePrice}^FS` : ''}
                    ^FO50,${order.isOutsourced ? '250' : '150'}^A0N,25,25^FDCustomer: ${order.clientName}^FS
                    ^FO50,${order.isOutsourced ? '300' : '200'}^A0N,25,25^FDItem: ${order.item || order.partNum}^FS
                    ^FO50,${order.isOutsourced ? '350' : '250'}^A0N,25,25^FDQty: ${order.qty}  ${order.cutLength ? `Cut: ${order.cutLength}"` : ''}^FS
                    ^FO50,${order.isOutsourced ? '400' : '300'}^BY3,2,70^BCN,70,Y,N,N^FD${order.orderKey || order.woNum}^FS
                    ^XZ
                `;
                console.log("Sending ZPL to Zebra Printer:", zpl);
                alert(`🖨️ Zebra Label Spooled for ${order.woNum}`);
            };

            const handleStartProcess = async () => {
                await updateDoc(doc(db, "shop_custom_orders", order.id), { status: 'In Process' });
                // §5: mirror onto the sibling fin WO so the Setup Queue flips to "In Process".
                await mirrorCustomStatusToSibling(order, 'In Process');
                // §A1: starting the custom job is the trigger that releases the sibling small
                // parts into the Pick/Pack queue (so picking runs in parallel with fabrication).
                await releaseSiblingToPickPack(order);
                await addDoc(collection(db, "global_messages"), {
                    sender: 'System', sourceApp: 'SHOP', target: 'FINISHING',
                    msg: `Custom Fab Started for SO: ${order.soNum}.`, t: serverTimestamp(), isSystem: true
                });
            };

            const handleCompleteWithLabel = async () => {
                const actionText = order.isOutsourced ? 'complete and send to PLATING DISPATCH' : 'complete and print Zebra label';
                if (!window.confirm(`Mark ${order.woNum} ${actionText}?`)) return;
                
                printZebraLabel(order);
                const finalStatus = order.isOutsourced ? 'Sent to Plating' : 'Completed';
                await updateDoc(doc(db, "shop_custom_orders", order.id), { status: finalStatus, completedAt: serverTimestamp(), completedBy: user.name });
                // §5: custom fabrication is done from the finishing floor's perspective.
                await mirrorCustomStatusToSibling(order, 'Complete');

                if (order.isOutsourced) {
                    await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'ALL', msg: `🚚 OUTSOURCE DISPATCH: Custom parts for ${order.woNum} sent to plating/finishing vendor.`, t: serverTimestamp(), isSystem: true });
                } else {
                    await addDoc(collection(db, "global_messages"), { sender: 'System', sourceApp: 'SHOP', target: 'PICK_PACK', msg: `STAGING ALERT: Custom parts for order ${order.orderKey || order.woNum} are arriving at staging.`, t: serverTimestamp(), isSystem: true });
                }
            };

            const isRunning = order.status === 'In Process';

            return (
                <div style={{ background: '#fff', border: '1px solid var(--line)', borderLeft: isRunning ? '4px solid var(--brass)' : '1px solid var(--line)', padding: '24px', marginBottom: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <h4 style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{order.item || order.partNum}</h4>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: isRunning ? 'var(--paper)' : 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '4px 8px' }}>
                                {isRunning ? 'In Process' : `WO: ${order.woNum}`}
                            </span>
                        </div>
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginBottom: '16px' }}>SO: {order.soNum}</div>
                    <div style={{ display: 'flex', gap: '24px', marginBottom: '20px', background: 'var(--paper)', padding: '16px', border: '1px solid var(--line)' }}>
                        <div><span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Req Qty</span><span style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{order.qty}</span></div>
                        {order.cutLength && <div><span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Cut To</span><span style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{order.cutLength}"</span></div>}
                    </div>

                    {(order.fabMethod || order.fabNotes) && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '20px', padding: '12px 16px', background: 'var(--ink)', color: '#fff' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.12em', fontWeight: 600 }}>
                                {order.fabMethod === 'BEND' ? '↳ BEND THE POLE' : order.fabMethod === 'SPLICE' ? '✂ SPLICE THE POLE' : order.fabMethod === 'MITER' ? '∠ MITER THE POLE' : 'FABRICATION'}
                            </span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.85, whiteSpace: 'nowrap' }}>
                                {order.fabNotes?.shape ? `${order.fabNotes.shape}` : ''}
                                {order.fabNotes?.qtyBends ? ` · ${order.fabNotes.qtyBends} bend` : ''}
                                {order.fabNotes?.qtySplices ? ` · ${order.fabNotes.qtySplices} splice` : ''}
                                {order.fabNotes?.qtyMiters ? ` · ${order.fabNotes.qtyMiters} miter` : ''}
                                {(Number(order.fabNotes?.sawAngle1) > 0 || Number(order.fabNotes?.sawAngle2) > 0) ? ` · ∠ ${Number(order.fabNotes?.sawAngle1 || order.fabNotes?.sawAngle2).toFixed(1)}°` : ''}
                                {order.fabNotes?.poleO2O ? ` · O2O ${order.fabNotes.poleO2O}"` : ''}
                            </span>
                        </div>
                    )}

                    {order.fabNotes && (Number(order.fabNotes.pole1) > 0 || Number(order.fabNotes.pole2) > 0 || Number(order.fabNotes.pole3) > 0 || Number(order.fabNotes.rawCenter) > 0) && (
                        <div style={{ marginBottom: '20px', border: '1px solid var(--line)' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#fff', background: 'var(--ink-soft)', padding: '6px 12px' }}>Pole Cut Sheet</div>
                            {[
                                { k: 'Left', fin: order.fabNotes.pole1, raw: order.fabNotes.rawLeft, ang: order.fabNotes.sawAngle1 },
                                { k: 'Center', fin: order.fabNotes.pole2, raw: order.fabNotes.rawCenter, ang: null },
                                { k: 'Right', fin: order.fabNotes.pole3, raw: order.fabNotes.rawRight, ang: order.fabNotes.sawAngle2 },
                            ].filter(s => Number(s.fin) > 0 || Number(s.raw) > 0).map((s, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 12px', borderTop: i ? '1px solid var(--line)' : 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', minWidth: '54px' }}>{s.k}</span>
                                    <span style={{ color: 'var(--ink)' }}>{Number(s.fin) > 0 ? `Finished ${Number(s.fin).toFixed(2)}"` : ''}{Number(s.raw) > 0 ? `  ·  Raw cut ${Number(s.raw).toFixed(2)}"` : ''}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--brass)', textAlign: 'right', minWidth: '70px' }}>{Number(s.ang) > 0 ? `∠ ${Number(s.ang).toFixed(1)}°` : ''}</span>
                                </div>
                            ))}
                            {(Number(order.fabNotes.returnRadius) > 0 || Number(order.fabNotes.poleDiameter) > 0) && (
                                <div style={{ display: 'flex', gap: '18px', padding: '8px 12px', borderTop: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--ink-soft)' }}>
                                    {order.fabNotes.qtyBends && Number(order.fabNotes.returnRadius) > 0 ? <span>Bend radius {order.fabNotes.returnRadius}"</span> : null}
                                    {Number(order.fabNotes.poleDiameter) > 0 ? <span>Pole Ø {order.fabNotes.poleDiameter}"</span> : null}
                                    {Number(order.fabNotes.totalSystemO2O) > 0 ? <span>System O2O {Number(order.fabNotes.totalSystemO2O).toFixed(2)}"</span> : null}
                                </div>
                            )}
                        </div>
                    )}

                    {Array.isArray(order.fabNotes?.hangerLocations) && order.fabNotes.hangerLocations.length > 0 && (
                        <div style={{ marginBottom: '20px', border: '1px solid var(--line)' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#fff', background: 'var(--ink-soft)', padding: '6px 12px' }}>Hidden Hanger Locations</div>
                            {order.fabNotes.hangerLocations.map((h, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '8px 12px', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: 600, color: 'var(--ink)', minWidth: '64px' }}>{h.code}</span>
                                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-soft)', flex: 1 }}>{h.anchor}</span>
                                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)', textAlign: 'right' }}>{h.position}{h.note ? ` — ${h.note}` : ''}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {Array.isArray(order.cutList) && order.cutList.length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Cut List</div>
                            {order.cutList.map((c, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--paper)', border: '1px solid var(--line)', marginBottom: '6px', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>
                                    <span style={{ color: 'var(--ink)' }}>{c.name}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Qty {c.qty}{c.cutLength ? ` · ${c.cutLength}"` : ''}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {(!order.cutList || order.cutList.length === 0) && order.cpqSpecs && Object.keys(order.cpqSpecs).length > 0 && (
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Specs</div>
                            {Object.entries(order.cpqSpecs).map(([k, v], i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: 'var(--paper)', border: '1px solid var(--line)', marginBottom: '6px', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                    <span style={{ color: 'var(--ink)' }}>{k}</span>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{String(v)}</span>
                                </div>
                            ))}
                        </div>
                    )}

                    {order.imageUrl && (
                        <a href={order.imageUrl} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginBottom: '16px', padding: '10px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', textDecoration: 'none' }}>📐 View Vision Drawing</a>
                    )}

                    <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                        {!isRunning ? (
                            <button onClick={handleStartProcess} style={{ flex: 1.5, background: 'var(--ink)', color: '#fff', border: 'none', padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Start Process</button>
                        ) : (
                            <button onClick={handleCompleteWithLabel} style={{ flex: 1.5, background: 'var(--brass)', color: '#fff', border: 'none', padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>
                                {order.isOutsourced ? 'Send to Plating' : 'Complete & Label'}
                            </button>
                        )}
                        {order.quoteId && (
                            <button onClick={() => setCfgQuote(order.quoteId)} style={{ flex: 1, background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>🔍 View Item</button>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div>
                <h2 style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '24px' }}>Custom Orders Inbox</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                    <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <h3 style={{ margin: '0 0 24px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>Cut-to-Size Rods</h3>
                        {rods.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)' }}>No pending rod orders.</div> : rods.map(o => <CustomCard key={o.id} order={o} />)}
                    </div>
                    <div style={{ background: '#fff', padding: '30px', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <h3 style={{ margin: '0 0 24px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--line)', paddingBottom: '12px' }}>Custom Fabrication</h3>
                        {fabs.length === 0 ? <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)' }}>No pending custom fab orders.</div> : fabs.map(o => <CustomCard key={o.id} order={o} />)}
                    </div>
                </div>
            </div>
        );
    };

    if (!user) {
        return (
            <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--paper)', fontFamily: 'var(--sans)' }}>
                <div style={{ background: '#fff', padding: '50px 40px', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '400px', textAlign: 'center', borderRadius: '2px' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: 'var(--brass)', display: 'block', marginBottom: '1rem' }}>
                        Authorization Required
                    </span>
                    <h2 style={{ margin: '0 0 30px 0', color: 'var(--ink)', fontSize: '2.2rem', fontFamily: 'var(--serif)', fontWeight: 500 }}>Shop Command</h2>
                    <form onSubmit={attemptLogin}>
                        <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{width: '100%', padding: '15px', textAlign: 'center', fontSize: '1.5rem', marginBottom: '20px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--mono)', letterSpacing: '10px', outline: 'none'}} />
                        <button type="submit" style={{ width: '100%', padding: '15px', background: 'var(--ink)', color: '#fff', fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}>Authenticate</button>
                    </form>
                    <button onClick={handleLogout} style={{ marginTop: '30px', background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid var(--brass)', paddingBottom: '2px' }}>Return to Hub</button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100vh', backgroundColor: 'var(--paper)', display: 'flex', flexDirection: 'column', fontFamily: 'var(--sans)' }}>
            
            <header style={{ backgroundColor: '#fff', color: 'var(--ink)', padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '4px solid var(--ink)', borderBottom: '1px solid var(--line)' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.6rem', fontFamily: 'var(--serif)', fontWeight: 500, letterSpacing: '0.05em' }}>Fabrication O.S.</h1>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', letterSpacing: '.18em', textTransform: 'uppercase' }}>Shop Floor Execution</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                  <span style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Operator: <strong style={{ color: 'var(--ink)', fontWeight: 500 }}>{user.name}</strong></span>
                  <button onClick={handleLogout} style={{ padding: '8px 16px', cursor: 'pointer', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Return to Hub</button>
                </div>
            </header>

            <nav style={{ display: 'flex', backgroundColor: 'var(--paper)', borderBottom: '1px solid var(--line)', overflowX: 'auto', padding: '0 20px' }}>
                {TABS.filter(t => myTabs.includes(t)).map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)} style={{ whiteSpace: 'nowrap', padding: '16px 20px', cursor: 'pointer', border: 'none', borderBottom: activeTab === tab ? `2px solid var(--brass)` : '2px solid transparent', background: 'transparent', color: activeTab === tab ? 'var(--ink)' : 'var(--ink-soft)', fontWeight: 400, fontFamily: 'var(--mono)', textTransform: 'uppercase', fontSize: '11px', letterSpacing: '.1em', transition: 'all 0.2s', opacity: activeTab === tab ? 1 : 0.7 }}>
                        {tab === 'admin' ? 'MACHINE CONFIG' : tab}
                    </button>
                ))}
            </nav>

            <main style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                <div style={{ backgroundColor: '#fff', border: '1px solid var(--line)', flex: 1, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto', borderRadius: '2px', padding: '30px' }}>
                    {ENG_TABS.includes(activeTab) ? (
                        <ShopEngineering 
                            activeTab={activeTab} user={user} hqParts={hqParts} routings={routings} programs={programs} 
                            programsMap={programsMap} machines={machines} categories={categories} setupCodes={setupCodes} 
                            tooling={tooling} materials={materials} writeLog={writeLog} handleDelete={handleDelete} safeUserRole={safeUserRole}
                            printMap={printMap} nukeTestJobs={nukeTestJobs}
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
                </div>
            </main>

            {renderModal()}
            {cfgQuote && <ConfiguredItemViewer quoteId={cfgQuote} onClose={() => setCfgQuote(null)} />}
        </div>
    );
};

export default ShopFloor;