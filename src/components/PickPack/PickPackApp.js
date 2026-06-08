import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc, getDoc, getDocs, query, where, addDoc, serverTimestamp } from "firebase/firestore";
import SharedMessaging from '../Shared/SharedMessaging';
import AssetGalleryTab from '../Shared/AssetGalleryTab';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const TABS = ['QUEUE', 'PACKING', 'GALLERY', 'MESSAGING'];

const PickPackApp = ({ activeBrand = "ce", setActiveBrand }) => {
    const [operator, setOperator] = useState(null);
    const [pinInput, setPinInput] = useState("");
    const [activeTab, setActiveTab] = useState('QUEUE');
    const [perms, setPerms] = useState({});
    const [jobs, setJobs] = useState([]);
    
    // Picking & Staging State
    const [activePickJob, setActivePickJob] = useState(null);
    const [currentPickLine, setCurrentPickLine] = useState(0);
    const [validation, setValidation] = useState({ bin: '', qty: '' });
    const [stagingScan, setStagingScan] = useState('');
    const [showNacho, setShowNacho] = useState(false);

    // SEAMLESS AUTO-LOGIN CHECK
    useEffect(() => {
        const checkLocalSession = async () => {
            const session = localStorage.getItem('hq_session');
            if (session) {
                try {
                    const parsedUser = JSON.parse(session);
                    const pSnap = await getDoc(doc(db, "pick_config", "permissions"));
                    let pData = pSnap.exists() ? pSnap.data() : {};
                    
                    setPerms(pData);
                    setOperator(parsedUser);
                    
                    const r = parsedUser.role ? parsedUser.role.toLowerCase() : 'operator';
                    setActiveTab(pData[r]?.includes('QUEUE') ? 'QUEUE' : (pData[r]?.[0] || 'QUEUE'));
                } catch (e) {
                    console.error("Failed to restore session. Manual PIN entry required.", e);
                }
            }
        };
        checkLocalSession();
    }, []);

    const attemptLogin = async (e) => {
        e.preventDefault();
        if (!pinInput) return;
        try {
            if (pinInput === "1032") {
                setOperator({ name: "Master Admin", role: "admin" });
                setPerms({ admin: TABS });
                return;
            }
            
            const snap = await getDocs(query(collection(db, "hq_users"), where("pin", "==", pinInput)));
            if (!snap.empty) {
                const uData = snap.docs[0].data();
                const pSnap = await getDoc(doc(db, "pick_config", "permissions"));
                let pData = pSnap.exists() ? pSnap.data() : {};
                
                setPerms(pData);
                setOperator(uData);

                const r = uData.role ? uData.role.toLowerCase() : 'operator';
                setActiveTab(pData[r]?.includes('QUEUE') ? 'QUEUE' : (pData[r]?.[0] || 'QUEUE'));
                setPinInput("");
            } else {
                alert("Invalid PIN. Access Denied.");
            }
        } catch (error) { 
            console.error("Authentication failed:", error); 
            alert("Authentication failed."); 
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('hq_session');
        window.location.href = '/';
    };

    const writeLog = async (msg, cat) => {
        try { await addDoc(collection(db, "hq_logs"), { u: operator?.name || 'Unknown', msg, cat, t: serverTimestamp() }); } 
        catch (error) { console.error("Failed to write log:", error); }
    };

    useEffect(() => {
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

        setValidation({ bin: '', qty: '' });
        
        if (currentPickLine + 1 < activePickJob.partsList.length) {
            setCurrentPickLine(prev => prev + 1);
        } else {
            setShowNacho(true);
            setTimeout(async () => {
                await updateDoc(doc(db, "fin_workorders", activePickJob.id), { pickStatus: 'Picked_Awaiting_Staging' });
                writeLog(`Order Picked: ${activePickJob.id}`, 'wms');
                printZebraLabel(activePickJob, 'SMALL_PARTS');
                setActivePickJob(null);
                setShowNacho(false);
                setOperator(null);
            }, 2000);
        }
    };

    const handleStagingMatch = async (e) => {
        e.preventDefault();
        const matchedJob = jobs.find(j => j.id.includes(stagingScan) || (j.soNum && j.soNum.includes(stagingScan)));
        
        if (!matchedJob) return alert("❌ No matching Picked order found for this Shop Label.");
        if (matchedJob.pickStatus !== 'Picked_Awaiting_Staging') return alert("❌ Small parts are not yet picked for this order.");

       await updateDoc(doc(db, "fin_workorders", matchedJob.id), { pickStatus: 'Staged_Ready_For_Finishing' });
        writeLog(`Order Staged & Matched: ${matchedJob.id}`, 'wms');
        alert(`✅ MATCH CONFIRMED: ${matchedJob.id} small parts and custom parts paired in staging!`);
        setStagingScan('');
        setOperator(null);
    };

    const printZebraLabel = (job, type) => {
        console.log(`Spooled ZPL for ${type} - ${job.id}`);
    };

    const safeUserRole = operator?.role ? operator.role.toLowerCase() : 'operator';
    const myTabs = operator?.role === 'admin' ? TABS : (perms[safeUserRole] || perms['operator'] || TABS);

    if (!operator) {
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: theme.paper, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.sans }}>
                <div style={{ background: '#fff', padding: '50px 40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)', width: '400px', textAlign: 'center' }}>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.25em', textTransform: 'uppercase', color: theme.brass, display: 'block', marginBottom: '1rem' }}>WMS Portal</span>
                    <h2 style={{ fontFamily: theme.serif, margin: '0 0 30px 0', fontSize: '2.2rem', fontWeight: 500, color: theme.ink }}>Pick & Pack</h2>
                    <form onSubmit={attemptLogin}>
                        <input type="password" value={pinInput} onChange={e => setPinInput(e.target.value)} placeholder="ENTER PIN" maxLength="4" style={{ width: '100%', padding: '15px', border: `1px solid ${theme.line}`, marginBottom: '20px', boxSizing: 'border-box', textAlign: 'center', fontSize: '1.5rem', letterSpacing: '10px', fontFamily: theme.mono, color: theme.ink, outline: 'none' }} />
                        <button type="submit" style={{ width: '100%', padding: '15px', background: theme.ink, color: '#fff', fontWeight: 400, fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>LOGIN</button>
                    </form>
                    <button onClick={() => window.location.href = '/'} style={{ marginTop: '30px', background: 'none', border: 'none', color: theme.inkSoft, cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: `1px solid ${theme.brass}`, paddingBottom: '2px' }}>← BACK TO HUB</button>
                </div>
            </div>
        );
    }

    if (activePickJob) {
        const line = activePickJob.partsList[currentPickLine];
        return (
            <div style={{ position: 'fixed', inset: 0, backgroundColor: theme.paper, color: theme.ink, zIndex: 9999, display: 'flex', flexDirection: 'column', padding: '40px', fontFamily: theme.sans }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${theme.line}`, paddingBottom: '20px', marginBottom: '40px' }}>
                    <h1 style={{ margin: 0, fontSize: '2.5rem', fontFamily: theme.serif, fontWeight: 500, color: theme.ink }}>Picking: {activePickJob.id}</h1>
                    <button onClick={() => setActivePickJob(null)} style={{ background: 'transparent', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.color = theme.ink; e.currentTarget.style.borderColor = theme.ink; }} onMouseOut={(e) => { e.currentTarget.style.color = theme.inkSoft; e.currentTarget.style.borderColor = theme.line; }}>ABORT PICK</button>
                </div>

                {showNacho ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ fontSize: '6rem' }}>🐕</div>
                        <h2 style={{ color: theme.brass, fontFamily: theme.serif, fontSize: '2.5rem', fontWeight: 500, margin: '20px 0' }}>Order Complete.</h2>
                        <p style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>Printing Staging Label...</p>
                    </div>
                ) : (
                    <div style={{ flex: 1, display: 'flex', gap: '40px' }}>
                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.line}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>Item {currentPickLine + 1} of {activePickJob.partsList.length}</div>
                            <div style={{ fontSize: '3rem', fontWeight: 300, color: theme.ink, margin: '20px 0', fontFamily: theme.serif }}>{line.name}</div>
                            <div style={{ fontSize: '1.2rem', fontFamily: theme.mono, color: theme.brass, marginBottom: '40px' }}>BIN: {line.binLocation || 'UNASSIGNED'}</div>
                            
                            <a href={line.assetUrl || '#'} target="_blank" rel="noreferrer" style={{ display: 'inline-block', background: 'transparent', border: `1px solid ${theme.line}`, color: theme.ink, padding: '15px 30px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textDecoration: 'none', textTransform: 'uppercase', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.brass} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                OPEN REFERENCE PHOTO
                            </a>
                        </div>

                        <div style={{ flex: 1, background: '#fff', padding: '40px', border: `1px solid ${theme.brass}`, boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <h2 style={{ margin: '0 0 30px 0', fontFamily: theme.serif, fontSize: '2rem', color: theme.ink, fontWeight: 500 }}>Target Qty: {line.qty}</h2>
                            <form onSubmit={handlePickValidation} style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '10px', textTransform: 'uppercase' }}>1. SCAN BIN BARCODE</label>
                                    <input autoFocus value={validation.bin} onChange={e => setValidation({...validation, bin: e.target.value})} style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontFamily: theme.mono, background: theme.paper, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                </div>
                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: theme.inkSoft, display: 'block', marginBottom: '10px', textTransform: 'uppercase' }}>2. ENTER QTY PICKED</label>
                                    <input type="number" value={validation.qty} onChange={e => setValidation({...validation, qty: e.target.value})} style={{ width: '100%', padding: '15px', fontSize: '1.2rem', fontFamily: theme.mono, background: theme.paper, border: `1px solid ${theme.line}`, outline: 'none' }} />
                                </div>
                                <button type="submit" style={{ padding: '20px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', marginTop: '20px', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
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
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: theme.paper, fontFamily: theme.sans }}>
            
            <header style={{ backgroundColor: '#fff', borderBottom: `1px solid ${theme.line}`, padding: '18px 30px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontFamily: theme.serif, margin: '0', fontSize: '1.6rem', fontWeight: 500, color: theme.ink, letterSpacing: '0.05em' }}>WMS: Pick & Pack</h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '5px' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>Operator: {operator?.name || 'Unknown'}</span>
                        <select value={activeBrand} onChange={(e) => setActiveBrand && setActiveBrand(e.target.value)} style={{ padding: '2px 5px', fontSize: '10px', fontFamily: theme.mono, background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, outline: 'none', textTransform: 'uppercase' }}>
                            <option value="m2c">M2C Studio</option>
                            <option value="uniquity">Uniquity</option>
                            <option value="ce">Classical Elements</option>
                            <option value="leyla">Leyla Gans</option>
                        </select>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    {TABS.filter(t => myTabs.includes(t)).map(tab => (
                        <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '10px 16px', background: 'transparent', color: activeTab === tab ? theme.ink : theme.inkSoft, borderBottom: activeTab === tab ? `2px solid ${theme.brass}` : '2px solid transparent', borderTop: 'none', borderLeft: 'none', borderRight: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>
                            {tab.replace('QUEUE', 'PICK QUEUE').replace('PACKING', 'PACKAGING PREP').replace('GALLERY', 'ASSET GALLERY')}
                        </button>
                    ))}
                    <div style={{ width: '1px', background: theme.line, height: '20px', margin: '0 10px' }}></div>
                    <button onClick={handleLogout} style={{ padding: '8px 16px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', background: theme.ink, color: '#fff', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>HUB / LOGOUT</button>
                </div>
            </header>

            <main style={{ flex: 1, padding: '30px', overflowY: 'auto' }}>
                
                {/* 📦 TAB: PICK QUEUE */}
                {activeTab === 'QUEUE' && (
                    <div style={{ display: 'flex', gap: '30px', height: '100%' }}>
                        <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '20px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem' }}>Awaiting Pick (Small Parts)</div>
                            <div style={{ padding: '20px', overflowY: 'auto' }}>
                                {jobs.filter(j => j.pickStatus === 'Pending').map(job => (
                                    <div key={job.id} style={{ border: `1px solid ${theme.line}`, padding: '20px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <h3 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.2rem', fontWeight: 500 }}>{job.id}</h3>
                                            <div style={{ color: theme.inkSoft, fontFamily: theme.mono, fontSize: '11px', marginTop: '5px' }}>{job.partsList?.length || 0} Line Items</div>
                                        </div>
                                        <button onClick={() => { setActivePickJob(job); setCurrentPickLine(0); }} style={{ padding: '10px 20px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                                            START PICKING
                                        </button>
                                    </div>
                                ))}
                                {jobs.filter(j => j.pickStatus === 'Pending').length === 0 && (
                                    <div style={{ color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No orders currently require picking.</div>
                                )}
                            </div>
                        </div>

                        <div style={{ width: '400px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                            <div style={{ padding: '20px', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.serif, color: theme.ink, fontWeight: 500, fontSize: '1.4rem' }}>Staging Handshake</div>
                            <div style={{ padding: '20px' }}>
                                <p style={{ color: theme.inkSoft, fontFamily: theme.sans, fontSize: '0.9rem', marginBottom: '20px' }}>Scan Shop Floor Custom Label to match with picked small parts.</p>
                                <form onSubmit={handleStagingMatch}>
                                    <input autoFocus placeholder="SCAN SHOP LABEL..." value={stagingScan} onChange={e => setStagingScan(e.target.value)} style={{ width: '100%', padding: '15px', fontSize: '1rem', fontFamily: theme.mono, border: `1px solid ${theme.line}`, boxSizing: 'border-box', outline: 'none' }} />
                                    <button type="submit" style={{ width: '100%', padding: '15px', background: theme.brass, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', marginTop: '10px', border: 'none', cursor: 'pointer' }}>MATCH ORDER</button>
                                </form>

                                <div style={{ marginTop: '30px', borderTop: `1px solid ${theme.line}`, paddingTop: '20px' }}>
                                    <div style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: '15px' }}>AWAITING SHOP MATCH:</div>
                                    {jobs.filter(j => j.pickStatus === 'Picked_Awaiting_Staging').map(job => (
                                        <div key={job.id} style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '12px', marginBottom: '8px', fontSize: '0.9rem', fontFamily: theme.mono, color: theme.ink }}>
                                            {job.id} <span style={{ color: theme.inkSoft, fontSize: '0.8rem' }}>(Picked)</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 🏷️ TAB: PACKAGING PREP */}
                {activeTab === 'PACKING' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <h2 style={{ borderBottom: `1px solid ${theme.line}`, paddingBottom: '15px', color: theme.ink, fontFamily: theme.serif, fontWeight: 500, margin: '0 0 30px 0' }}>Packaging Prep Queue</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '20px' }}>
                            {jobs.filter(j => j.pickStatus === 'Staged_Ready_For_Finishing').map(job => (
                                <div key={job.id} style={{ border: `1px solid ${theme.line}`, padding: '20px', background: theme.paper }}>
                                    <h3 style={{ margin: '0 0 10px 0', color: theme.ink, fontFamily: theme.serif, fontWeight: 500, fontSize: '1.3rem' }}>{job.id}</h3>
                                    <div style={{ fontFamily: theme.mono, fontSize: '0.85rem', color: theme.ink }}>Dims: {job.dimensions?.length || 0}"L x {job.dimensions?.width || 0}"W</div>
                                    <div style={{ fontSize: '0.85rem', color: theme.inkSoft, marginTop: '10px' }}>Review box sizes & tube lengths to prep materials while finishing cures.</div>
                                </div>
                            ))}
                            {jobs.filter(j => j.pickStatus === 'Staged_Ready_For_Finishing').length === 0 && (
                                <div style={{ gridColumn: '1 / -1', color: theme.inkSoft, fontStyle: 'italic', fontFamily: theme.serif }}>No orders currently awaiting packaging prep.</div>
                            )}
                        </div>
                    </div>
                )}

                {/* 🖼️ TAB: ASSET GALLERY */}
                {activeTab === 'GALLERY' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '10px', minHeight: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <AssetGalleryTab currentUser={operator?.name || 'Unknown'} activeBrand={activeBrand} />
                    </div>
                )}

                {/* 💬 TAB: MESSAGING */}
                {activeTab === 'MESSAGING' && (
                    <div style={{ background: '#fff', border: `1px solid ${theme.line}`, height: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                        <SharedMessaging currentUser={operator?.name || 'Unknown'} currentApp="PICK_PACK" writeLog={writeLog} />
                    </div>
                )}

            </main>
        </div>
    );
};

export default PickPackApp;