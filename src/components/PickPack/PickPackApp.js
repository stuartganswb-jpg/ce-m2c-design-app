import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, doc, updateDoc } from "firebase/firestore";

const PickPackApp = ({ currentUser = "Warehouse Lead", activeBrand = "ce" }) => {
    const [activeTab, setActiveTab] = useState('QUEUE');
    const [jobs, setJobs] = useState([]);
    
    // Picking & Staging State
    const [activePickJob, setActivePickJob] = useState(null);
    const [currentPickLine, setCurrentPickLine] = useState(0);
    const [validation, setValidation] = useState({ bin: '', qty: '' });
    const [stagingScan, setStagingScan] = useState('');
    const [showNacho, setShowNacho] = useState(false);

    useEffect(() => {
        // Fetch jobs pushed from Finishing Floor that need picking
        const unsub = onSnapshot(collection(db, "fin_workorders"), (snap) => {
            const fetched = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setJobs(fetched.filter(j => j.sentToPickPack));
        });
        return () => unsub();
    }, []);

    const handlePickValidation = async (e) => {
        e.preventDefault();
        const lineItem = activePickJob.partsList[currentPickLine];
        const expectedBin = lineItem.binLocation || 'UNASSIGNED';

        if (validation.bin.toUpperCase() !== expectedBin.toUpperCase() && expectedBin !== 'UNASSIGNED') {
            return alert("❌ Incorrect Bin Scanned! Please verify location.");
        }
        if (parseInt(validation.qty) !== lineItem.qty) {
            return alert(`❌ Quantity Mismatch. Expected ${lineItem.qty}.`);
        }

        // Success for this line
        setValidation({ bin: '', qty: '' });
        
        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            // Whole order picked
            setShowNacho(true);
            setTimeout(async () => {
                await updateDoc(doc(db, "fin_workorders", activePickJob.id), { pickStatus: 'Picked_Awaiting_Staging' });
                printZebraLabel(activePickJob, 'SMALL_PARTS');
                setActivePickJob(null);
                setShowNacho(false);
            }, 2000);
        }
    };

    const handleStagingMatch = async (e) => {
        e.preventDefault();
        // Assuming stagingScan matches the WO/SO of a picked order
        const matchedJob = jobs.find(j => j.id.includes(stagingScan) || (j.soNum && j.soNum.includes(stagingScan)));
        
        if (!matchedJob) return alert("❌ No matching Picked order found for this Shop Label.");
        if (matchedJob.pickStatus !== 'Picked_Awaiting_Staging') return alert("❌ Small parts are not yet picked for this order.");

        await updateDoc(doc(db, "fin_workorders", matchedJob.id), { pickStatus: 'Staged_Ready_For_Finishing' });
        alert(`✅ MATCH CONFIRMED: ${matchedJob.id} small parts and custom parts paired in staging!`);
        setStagingScan('');
    };

    const printZebraLabel = (job, type) => {
        console.log(`Spooled ZPL for ${type} - ${job.id}`);
        // Similar ZPL payload as Shop Floor for consistency
    };

    // --- FULL SCREEN PICKING MODAL ---
    if (activePickJob) {
        const line = activePickJob.partsList[currentPickLine];
        return (
            <div style={{ position: 'fixed', inset: 0, background: '#222', color: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '40px', fontFamily: 'monospace' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '4px solid #007bff', paddingBottom: '20px', marginBottom: '40px' }}>
                    <h1 style={{ margin: 0, fontSize: '3rem' }}>PICKING: {activePickJob.id}</h1>
                    <button onClick={() => setActivePickJob(null)} style={{ background: '#d9534f', color: '#fff', border: 'none', padding: '20px', fontSize: '1.5rem', fontWeight: 'bold', cursor: 'pointer' }}>ABORT PICK</button>
                </div>

                {showNacho ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: '6rem' }}>🐕</div>
                        <h2 style={{ color: '#28a745', fontSize: '3rem' }}>GOOD BOY! ORDER COMPLETE.</h2>
                        <p style={{ fontSize: '1.5rem' }}>Printing Staging Label...</p>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', gap: '40px' }}>
                        <div style={{ flex: 1, background: '#333', padding: '40px', borderRadius: '15px', border: '2px solid #555' }}>
                            <div style={{ fontSize: '1.5rem', color: '#aaa' }}>ITEM {currentPickLine + 1} OF {activePickJob.partsList.length}</div>
                            <div style={{ fontSize: '4rem', fontWeight: 'bold', color: '#007bff', margin: '20px 0' }}>{line.name}</div>
                            <div style={{ fontSize: '2rem', color: '#f39c12', marginBottom: '40px' }}>BIN: {line.binLocation || 'UNASSIGNED'}</div>
                            
                            <a href={line.assetUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: '#eef5ff', color: '#007bff', padding: '15px 30px', fontSize: '1.5rem', textDecoration: 'none', borderRadius: '8px', fontWeight: 'bold' }}>
                                🖼️ OPEN REFERENCE PHOTO
                            </a>
                        </div>

                        <div style={{ flex: 1, background: '#000', padding: '40px', borderRadius: '15px', border: '4px solid #007bff' }}>
                            <h2 style={{ margin: '0 0 30px 0', fontSize: '2.5rem', color: '#28a745' }}>TARGET QTY: {line.qty}</h2>
                            <form onSubmit={handlePickValidation} style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                <div>
                                    <label style={{ fontSize: '1.5rem', color: '#aaa', display: 'block', marginBottom: '10px' }}>1. SCAN BIN BARCODE</label>
                                    <input autoFocus value={validation.bin} onChange={e => setValidation({...validation, bin: e.target.value})} style={{ width: '100%', padding: '20px', fontSize: '2rem', background: '#222', color: '#fff', border: '2px solid #555' }} />
                                </div>
                                <div>
                                    <label style={{ fontSize: '1.5rem', color: '#aaa', display: 'block', marginBottom: '10px' }}>2. ENTER QTY PICKED</label>
                                    <input type="number" value={validation.qty} onChange={e => setValidation({...validation, qty: e.target.value})} style={{ width: '100%', padding: '20px', fontSize: '2rem', background: '#222', color: '#fff', border: '2px solid #555' }} />
                                </div>
                                <button type="submit" style={{ padding: '30px', background: '#007bff', color: '#fff', fontSize: '2rem', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '20px' }}>
                                    CONFIRM PICK
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#e5e5e5', fontFamily: 'monospace' }}>
            {/* Header omitted for brevity, add PACKING tab to your header buttons */}
            
            <main style={{ flex: 1, padding: '20px', display: 'flex', gap: '20px' }}>
                
                {/* 📦 ACTIVE PICK QUEUE */}
                <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '15px', background: '#007bff', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>AWAITING PICK (SMALL PARTS)</div>
                    <div style={{ padding: '20px', overflowY: 'auto' }}>
                        {jobs.filter(j => j.pickStatus === 'Pending').map(job => (
                            <div key={job.id} style={{ border: '2px solid #ccc', padding: '15px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3 style={{ margin: 0 }}>{job.id}</h3>
                                    <div style={{ color: '#666' }}>{job.partsList?.length || 0} Line Items</div>
                                </div>
                                <button onClick={() => { setActivePickJob(job); setCurrentPickLine(0); }} style={{ padding: '15px 30px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>
                                    START PICKING
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 🔗 STAGING & MATCHING */}
                <div style={{ width: '400px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '15px', background: '#f39c12', color: '#000', fontWeight: 'bold', fontSize: '1.2rem' }}>STAGING HANDSHAKE</div>
                    <div style={{ padding: '20px' }}>
                        <p style={{ color: '#666', fontWeight: 'bold' }}>Scan Shop Floor Custom Label to match with picked small parts.</p>
                        <form onSubmit={handleStagingMatch}>
                            <input autoFocus placeholder="SCAN SHOP LABEL..." value={stagingScan} onChange={e => setStagingScan(e.target.value)} style={{ width: '100%', padding: '15px', fontSize: '1.2rem', border: '3px solid #000', boxSizing: 'border-box' }} />
                            <button type="submit" style={{ width: '100%', padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', marginTop: '10px', border: 'none', cursor: 'pointer' }}>MATCH ORDER</button>
                        </form>

                        <div style={{ marginTop: '30px', borderTop: '2px solid #eee', paddingTop: '15px' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '10px' }}>AWAITING SHOP MATCH:</div>
                            {jobs.filter(j => j.pickStatus === 'Picked_Awaiting_Staging').map(job => (
                                <div key={job.id} style={{ background: '#fffdf5', border: '1px solid #f39c12', padding: '10px', marginBottom: '5px', fontSize: '0.9rem', fontWeight: 'bold' }}>
                                    {job.id} (Picked, in racks)
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 📦 PACKAGING PREP TAB (Can be toggled via State if preferred) */}
                {activeTab === 'PACKING' && (
                    <div style={{ position: 'absolute', inset: '100px 20px 20px 20px', background: '#fff', border: '4px solid #000', padding: '20px', overflowY: 'auto' }}>
                        <h2 style={{ borderBottom: '2px solid #000', paddingBottom: '10px' }}>PACKAGING PREP QUEUE</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                            {jobs.filter(j => j.pickStatus === 'Staged_Ready_For_Finishing').map(job => (
                                <div key={job.id} style={{ border: '2px solid #ccc', padding: '20px' }}>
                                    <h3 style={{ margin: '0 0 10px 0', color: '#007bff' }}>{job.id}</h3>
                                    <div style={{ fontWeight: 'bold' }}>Dimensions: {job.dimensions?.length}"L x {job.dimensions?.width}"W</div>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '10px' }}>Review box sizes & tube lengths to prep materials while finishing cures.</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
};

export default PickPackApp;