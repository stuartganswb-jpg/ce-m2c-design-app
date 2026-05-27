import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, addDoc, serverTimestamp, orderBy, where, doc, updateDoc } from "firebase/firestore";

// Define the color coding for the Universal Comm-Link
const APP_COLORS = {
    'HQ': '#007bff',
    'PICK_PACK': '#28a745',
    'FINISHING': '#6f42c1',
    'SHOP_FLOOR': '#fd7e14',
    'SYSTEM': '#333333'
};

const PickPackApp = ({ currentUser = "Warehouse Lead", activeBrand = "m2c" }) => {
    const [activeTab, setActiveTab] = useState('QUEUE');
    
    // Data State
    const [jobs, setJobs] = useState([]);
    const [libraryParts, setLibraryParts] = useState([]);
    const [messages, setMessages] = useState([]);
    const [dailyCounts, setDailyCounts] = useState([]);

    // Forms State
    const [chatInput, setChatInput] = useState("");
    const [countForm, setCountForm] = useState({ binId: '', partId: '', qty: '' });
    const [activeJob, setActiveJob] = useState(null);

    // 1. Fetch Orders (Jobs) that need picking
    useEffect(() => {
        const q = query(collection(db, "jobs"), where("brandId", "==", activeBrand));
        const unsub = onSnapshot(q, (snap) => {
            let fetchedJobs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Only show jobs that have been synced to ERP / dispatched to floor
            fetchedJobs = fetchedJobs.filter(j => j.status === 'IN_PRODUCTION' || j.status === 'DISPATCHED');
            // Sort oldest first (FIFO)
            fetchedJobs.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
            setJobs(fetchedJobs);
        });
        return () => unsub();
    }, [activeBrand]);

    // 2. Fetch Master Library for Bin Locations
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
            setLibraryParts(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    // 3. Fetch Universal Messages
    useEffect(() => {
        const q = query(collection(db, "global_messages"), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(q, (snap) => {
            setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    // 4. Fetch Today's Bin Counts
    useEffect(() => {
        // Start of today
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const q = query(collection(db, "bin_counts"), where("brandId", "==", activeBrand), orderBy("createdAt", "desc"));
        const unsub = onSnapshot(q, (snap) => {
            const counts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Filter locally for today to avoid complex composite indexing on initial load
            const todaysCounts = counts.filter(c => c.createdAt && (c.createdAt.seconds * 1000) >= startOfToday.getTime());
            setDailyCounts(todaysCounts);
        });
        return () => unsub();
    }, [activeBrand]);

    // --- LOGIC: HELPER FUNCTIONS ---
    const getPartLocation = (partId) => {
        if (!partId) return 'UNKNOWN BIN';
        const p = libraryParts.find(x => x.id === partId || x.itemId === partId || x.legacyErpId === partId);
        if (!p) return 'UNASSIGNED BIN';
        return p.manufacturingSpecs?.binLocation || 'UNASSIGNED BIN';
    };

    // --- LOGIC: MESSAGING ---
    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!chatInput.trim()) return;
        try {
            await addDoc(collection(db, "global_messages"), {
                text: chatInput,
                sender: currentUser,
                appSource: 'PICK_PACK', // Identifies where it came from
                brandId: activeBrand,
                createdAt: serverTimestamp()
            });
            setChatInput("");
        } catch (error) { console.error("Message Error:", error); alert("Failed to send."); }
    };

    // --- LOGIC: BIN COUNTING ---
    const handleSaveCount = async (e) => {
        e.preventDefault();
        if (!countForm.binId || !countForm.partId || !countForm.qty) return alert("Fill all fields.");
        try {
            await addDoc(collection(db, "bin_counts"), {
                binId: countForm.binId.toUpperCase(),
                partId: countForm.partId.toUpperCase(),
                qty: parseInt(countForm.qty),
                operator: currentUser,
                brandId: activeBrand,
                createdAt: serverTimestamp()
            });
            // Clear only Part & Qty, leave Bin in case they are counting multiple items in one bin
            setCountForm(prev => ({ ...prev, partId: '', qty: '' }));
            document.getElementById('partIdInput')?.focus();
        } catch (error) { console.error("Count Error:", error); alert("Failed to save count."); }
    };

    const handleExportCSV = () => {
        if (dailyCounts.length === 0) return alert("No counts logged today.");
        
        let csvContent = "data:text/csv;charset=utf-8,";
        csvContent += "Date,Time,Operator,Bin Number,Part/SKU,Quantity\n"; // Headers

        dailyCounts.forEach(c => {
            const dateObj = c.createdAt ? new Date(c.createdAt.seconds * 1000) : new Date();
            const dateStr = dateObj.toLocaleDateString();
            const timeStr = dateObj.toLocaleTimeString();
            const row = `"${dateStr}","${timeStr}","${c.operator}","${c.binId}","${c.partId}",${c.qty}`;
            csvContent += row + "\n";
        });

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Bin_Counts_${activeBrand}_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- LOGIC: FULFILLMENT ---
    const markLinePacked = async (jobId, lineIndex) => {
        const job = jobs.find(j => j.id === jobId);
        if (!job || !job.projectLines) return;

        const updatedLines = [...job.projectLines];
        updatedLines[lineIndex] = { ...updatedLines[lineIndex], status: 'PICKED_AND_PACKED' };

        try {
            await updateDoc(doc(db, "jobs", jobId), { projectLines: updatedLines });
        } catch (err) { console.error(err); alert("Failed to update status."); }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace' }}>
            
            {/* WAREHOUSE HEADER */}
            <header style={{ background: '#28a745', color: '#fff', padding: '15px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '4px solid #000' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '1px' }}>WMS: PICK & PACK WAREHOUSE</h1>
                    <span style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>BRAND: {activeBrand.toUpperCase()} | OPERATOR: {currentUser.toUpperCase()}</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => setActiveTab('QUEUE')} style={{ padding: '10px 20px', background: activeTab === 'QUEUE' ? '#fff' : 'transparent', color: activeTab === 'QUEUE' ? '#28a745' : '#fff', border: '2px solid #fff', fontWeight: 'bold', cursor: 'pointer' }}>📦 ORDER QUEUE</button>
                    <button onClick={() => setActiveTab('BIN_COUNT')} style={{ padding: '10px 20px', background: activeTab === 'BIN_COUNT' ? '#fff' : 'transparent', color: activeTab === 'BIN_COUNT' ? '#28a745' : '#fff', border: '2px solid #fff', fontWeight: 'bold', cursor: 'pointer' }}>🔢 CYCLE COUNT (BINS)</button>
                    <button onClick={() => setActiveTab('MESSAGES')} style={{ padding: '10px 20px', background: activeTab === 'MESSAGES' ? '#fff' : 'transparent', color: activeTab === 'MESSAGES' ? '#28a745' : '#fff', border: '2px solid #fff', fontWeight: 'bold', cursor: 'pointer' }}>💬 COMM-LINK</button>
                </div>
            </header>

            <main style={{ flex: 1, padding: '20px', overflow: 'hidden', display: 'flex' }}>
                
                {/* 📦 TAB: PICK QUEUE */}
                {activeTab === 'QUEUE' && (
                    <div style={{ display: 'flex', gap: '20px', width: '100%', height: '100%' }}>
                        
                        {/* Order List */}
                        <div style={{ width: '400px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000' }}>
                            <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>DISPATCHED ORDERS</div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {jobs.length === 0 && <div style={{ color: '#888', fontStyle: 'italic' }}>No orders currently require picking.</div>}
                                {jobs.map(job => {
                                    const isSelected = activeJob?.id === job.id;
                                    const totalLines = job.projectLines?.length || 0;
                                    const packedLines = job.projectLines?.filter(l => l.status === 'PICKED_AND_PACKED').length || 0;
                                    const progress = totalLines === 0 ? 0 : Math.round((packedLines / totalLines) * 100);

                                    return (
                                        <div key={job.id} onClick={() => setActiveJob(job)} style={{ background: isSelected ? '#d4edda' : '#fff', border: `2px solid ${isSelected ? '#28a745' : '#ccc'}`, padding: '15px', cursor: 'pointer', transition: '0.1s' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '1.1rem', color: '#000' }}>
                                                <span>{job.soNum || job.jobId}</span>
                                                <span style={{ color: progress === 100 ? '#28a745' : '#d9534f' }}>{progress}%</span>
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '5px' }}>{job.jobName || job.sidemark}</div>
                                            
                                            <div style={{ background: '#eee', height: '6px', width: '100%', marginTop: '10px', borderRadius: '3px', overflow: 'hidden' }}>
                                                <div style={{ background: progress === 100 ? '#28a745' : '#007bff', height: '100%', width: `${progress}%` }} />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {/* Pick List */}
                        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                            {!activeJob ? (
                                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '1.5rem', fontWeight: 'bold' }}>
                                    SELECT AN ORDER TO VIEW PICK LIST
                                </div>
                            ) : (
                                <>
                                    <div style={{ padding: '20px', background: '#28a745', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                        <div>
                                            <h2 style={{ margin: 0, fontSize: '1.8rem' }}>{activeJob.soNum || activeJob.jobId}</h2>
                                            <div style={{ fontSize: '1rem', marginTop: '5px' }}>{activeJob.customer?.name} - {activeJob.sidemark}</div>
                                        </div>
                                        <div style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                            <div>REQ: {activeJob.reqDate || 'ASAP'}</div>
                                            <div style={{ fontSize: '0.8rem', marginTop: '5px' }}>Lines: {activeJob.projectLines?.length || 0}</div>
                                        </div>
                                    </div>
                                    
                                    <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f4f4f4' }}>
                                        {!activeJob.projectLines ? <div style={{ fontStyle: 'italic', color: '#666' }}>Order not dissected by ERP yet.</div> : (
                                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: '#fff', border: '1px solid #ccc' }}>
                                                <thead style={{ background: '#333', color: '#fff' }}>
                                                    <tr>
                                                        <th style={{ padding: '15px' }}>BIN LOCATION</th>
                                                        <th style={{ padding: '15px' }}>PART / SKU</th>
                                                        <th style={{ padding: '15px' }}>ORDER TYPE</th>
                                                        <th style={{ padding: '15px' }}>ACTION</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {activeJob.projectLines.map((line, idx) => {
                                                        const isPacked = line.status === 'PICKED_AND_PACKED';
                                                        const bin = getPartLocation(line.partId);
                                                        return (
                                                            <tr key={idx} style={{ borderBottom: '1px solid #eee', background: isPacked ? '#eafaf1' : '#fff', opacity: isPacked ? 0.6 : 1 }}>
                                                                <td style={{ padding: '15px', fontWeight: 'bold', fontSize: '1.2rem', color: '#6f42c1' }}>{bin}</td>
                                                                <td style={{ padding: '15px' }}>
                                                                    <div style={{ fontWeight: 'bold', color: '#000', fontSize: '1.1rem' }}>{line.partName}</div>
                                                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '3px' }}>ID: {line.partId}</div>
                                                                </td>
                                                                <td style={{ padding: '15px', fontWeight: 'bold', color: line.orderType === 'WO' ? '#007bff' : '#d9534f' }}>
                                                                    {line.orderId}
                                                                </td>
                                                                <td style={{ padding: '15px' }}>
                                                                    {isPacked ? (
                                                                        <span style={{ fontWeight: 'bold', color: '#28a745' }}>✓ PACKED</span>
                                                                    ) : (
                                                                        <button onClick={() => markLinePacked(activeJob.id, idx)} style={{ padding: '10px 20px', background: '#000', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.9rem' }}>
                                                                            MARK PACKED
                                                                        </button>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* 🔢 TAB: BIN CYCLE COUNTING */}
                {activeTab === 'BIN_COUNT' && (
                    <div style={{ display: 'flex', gap: '20px', width: '100%', height: '100%' }}>
                        
                        {/* Scanner / Input Form */}
                        <div style={{ width: '400px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', padding: '20px' }}>
                            <h2 style={{ margin: '0 0 20px 0', color: '#007bff', borderBottom: '2px solid #007bff', paddingBottom: '10px' }}>BARCODE / MANUAL ENTRY</h2>
                            
                            <form onSubmit={handleSaveCount} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                <div>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#666' }}>1. SCAN OR TYPE BIN LOCATION</label>
                                    <input autoFocus type="text" value={countForm.binId} onChange={e => setCountForm({...countForm, binId: e.target.value})} placeholder="e.g. A1-B2" style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontWeight: 'bold', textTransform: 'uppercase', border: '3px solid #6f42c1', boxSizing: 'border-box', marginTop: '5px' }} />
                                </div>
                                
                                <div>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#666' }}>2. SCAN OR TYPE PART/SKU</label>
                                    <input id="partIdInput" type="text" value={countForm.partId} onChange={e => setCountForm({...countForm, partId: e.target.value})} placeholder="e.g. H1-75BS" style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontWeight: 'bold', textTransform: 'uppercase', border: '3px solid #007bff', boxSizing: 'border-box', marginTop: '5px' }} />
                                </div>

                                <div>
                                    <label style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#666' }}>3. ENTER COUNT QUANTITY</label>
                                    <input type="number" value={countForm.qty} onChange={e => setCountForm({...countForm, qty: e.target.value})} placeholder="0" style={{ width: '100%', padding: '15px', fontSize: '1.5rem', fontWeight: 'bold', border: '3px solid #28a745', boxSizing: 'border-box', marginTop: '5px', textAlign: 'center' }} />
                                </div>

                                <button type="submit" style={{ padding: '20px', background: '#000', color: '#fff', fontSize: '1.2rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '10px', boxShadow: '4px 4px 0 #333' }}>
                                    💾 SAVE COUNT
                                </button>
                            </form>
                        </div>

                        {/* Daily Log & Export */}
                        <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                            <div style={{ padding: '20px', background: '#333', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                <h2 style={{ margin: 0, fontSize: '1.4rem' }}>TODAY'S CYCLE COUNTS</h2>
                                <button onClick={handleExportCSV} style={{ padding: '10px 20px', background: '#28a745', color: '#fff', border: '2px solid #fff', fontWeight: 'bold', cursor: 'pointer' }}>
                                    📥 EXPORT CSV TO ERP
                                </button>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: '#f4f4f4' }}>
                                {dailyCounts.length === 0 ? <div style={{ color: '#999', fontStyle: 'italic', textAlign: 'center', marginTop: '50px' }}>No bins counted today.</div> : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', background: '#fff', border: '1px solid #ccc' }}>
                                        <thead style={{ background: '#eee', color: '#333' }}>
                                            <tr>
                                                <th style={{ padding: '12px' }}>TIME</th>
                                                <th style={{ padding: '12px' }}>BIN LOCATION</th>
                                                <th style={{ padding: '12px' }}>PART / SKU</th>
                                                <th style={{ padding: '12px', textAlign: 'right' }}>QUANTITY</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {dailyCounts.map(count => (
                                                <tr key={count.id} style={{ borderBottom: '1px solid #eee' }}>
                                                    <td style={{ padding: '12px', color: '#666' }}>{count.createdAt ? new Date(count.createdAt.seconds * 1000).toLocaleTimeString() : 'Just now'}</td>
                                                    <td style={{ padding: '12px', fontWeight: 'bold', color: '#6f42c1' }}>{count.binId}</td>
                                                    <td style={{ padding: '12px', fontWeight: 'bold' }}>{count.partId}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', fontSize: '1.2rem', color: '#28a745' }}>{count.qty}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 💬 TAB: UNIVERSAL COMM-LINK */}
                {activeTab === 'MESSAGES' && (
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', maxWidth: '1000px', margin: '0 auto', background: '#fff', border: '2px solid #000', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                        <div style={{ padding: '20px', background: '#000', color: '#fff', borderBottom: '2px solid #000' }}>
                            <h2 style={{ margin: 0, fontSize: '1.4rem', textTransform: 'uppercase' }}>UNIVERSAL COMM-LINK</h2>
                            <div style={{ fontSize: '0.8rem', color: '#aaa', marginTop: '5px' }}>Cross-Department Communication Protocol</div>
                        </div>

                        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column-reverse', overflowY: 'auto', background: '#f8f9fa', gap: '15px' }}>
                            {messages.length === 0 && <div style={{ textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No messages in system.</div>}
                            {messages.map(msg => {
                                const isMe = msg.appSource === 'PICK_PACK';
                                const color = APP_COLORS[msg.appSource] || '#666';

                                return (
                                    <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                                        <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', marginBottom: '4px' }}>
                                            {msg.sender.toUpperCase()} [{msg.appSource.replace('_', ' ')}] - {msg.createdAt ? new Date(msg.createdAt.seconds * 1000).toLocaleTimeString() : ''}
                                        </div>
                                        <div style={{ background: isMe ? '#eafaf1' : '#fff', border: `2px solid ${color}`, color: '#000', padding: '12px 18px', borderRadius: '8px', maxWidth: '70%', fontSize: '1rem', fontWeight: 'bold', boxShadow: `3px 3px 0 ${color}33` }}>
                                            {msg.text}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>

                        <form onSubmit={handleSendMessage} style={{ padding: '20px', borderTop: '2px solid #ccc', background: '#fff', display: 'flex', gap: '15px' }}>
                            <input 
                                type="text" 
                                value={chatInput} 
                                onChange={e => setChatInput(e.target.value)} 
                                placeholder="Broadcast message to all departments..." 
                                style={{ flex: 1, padding: '15px', fontSize: '1.1rem', border: '2px solid #000', outline: 'none' }} 
                            />
                            <button type="submit" style={{ padding: '0 30px', background: APP_COLORS['PICK_PACK'], color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', border: '2px solid #000', cursor: 'pointer', boxShadow: '3px 3px 0 #000' }}>
                                BROADCAST
                            </button>
                        </form>
                    </div>
                )}
            </main>
        </div>
    );
};

export default PickPackApp;