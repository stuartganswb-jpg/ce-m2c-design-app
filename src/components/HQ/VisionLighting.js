import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, addDoc, serverTimestamp, onSnapshot, query, where, doc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Box, Cylinder, Plane, Html } from '@react-three/drei';

const generateId = () => Math.random().toString(36).substr(2, 9);

const VisionLighting = ({ currentUser, activeBrand }) => {
    // --- Data Hooks ---
    const [masterAssemblies, setMasterAssemblies] = useState([]);
    const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
    const [cpqRoutingTypes, setCpqRoutingTypes] = useState([]);
    
    // Live CRM Data State
    const [liveCustomers, setLiveCustomers] = useState([]);
    const [liveVendors, setLiveVendors] = useState([]);

    // --- Application State ---
    const [room, setRoom] = useState({ width: 240, depth: 240, height: 144 }); 
    const [cluster, setCluster] = useState([{
        id: generateId(), x: 0, y: 0, drop: 36, 
        tiers: [{ id: generateId(), diameter: 44, height: 24, zOffset: 0 }]
    }]);

    const [isSaving, setIsSaving] = useState(false);
    const [isCapturing, setIsCapturing] = useState(false);
    
    const [coopModalOpen, setCoopModalOpen] = useState(false);
    const [coopFormData, setCoopFormData] = useState({ target: 'CUSTOMER', entityId: '', note: '' });

    useEffect(() => {
        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
            if (docSnap.exists() && docSnap.data().cpqRoutingTypes) {
                setCpqRoutingTypes(docSnap.data().cpqRoutingTypes);
            }
        });

        const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand));
        const unsubAsm = onSnapshot(q, (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setMasterAssemblies(docs);
        });

        const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
            const records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            setLiveCustomers(records.filter(r => r.type === 'CUSTOMER'));
            setLiveVendors(records.filter(r => r.type === 'VENDOR'));
        });

        return () => { unsubLists(); unsubAsm(); unsubCrm(); };
    }, [activeBrand]);

    const validAssemblies = masterAssemblies.filter(d => {
        const rType = (d.routingType || "").toUpperCase();
        return d.partClass === 'Master Assembly' || 
               cpqRoutingTypes.includes(d.routingType) ||
               rType === 'MASTER' || rType === 'MAIN' || rType.includes('CPQ');
    });

    // --- State Handlers ---
    const addFixture = () => {
        setCluster([...cluster, { id: generateId(), x: 48, y: 0, drop: 36, tiers: [{ id: generateId(), diameter: 36, height: 18, zOffset: 0 }] }]);
    };
    
    const removeFixture = (fixId) => setCluster(cluster.filter(f => f.id !== fixId));

    const updateFixture = (fixId, key, value) => {
        setCluster(cluster.map(f => f.id === fixId ? { ...f, [key]: Number(value) } : f));
    };

    const addTier = (fixId) => {
        setCluster(cluster.map(f => {
            if (f.id === fixId) {
                return { ...f, tiers: [...f.tiers, { id: generateId(), diameter: 24, height: 12, zOffset: -20 }] };
            }
            return f;
        }));
    };

    const removeTier = (fixId, tierId) => {
        setCluster(cluster.map(f => f.id === fixId ? { ...f, tiers: f.tiers.filter(t => t.id !== tierId) } : f));
    };

    const updateTier = (fixId, tierId, key, value) => {
        setCluster(cluster.map(f => {
            if (f.id === fixId) {
                return { ...f, tiers: f.tiers.map(t => t.id === tierId ? { ...t, [key]: Number(value) } : t) };
            }
            return f;
        }));
    };

    const pushToCPQ = async () => {
        if (!selectedAssemblyId) return alert("Please select a Master Assembly Model first so the CPQ Engine knows what to load!");
        setIsSaving(true);
        try {
            const payload = {
                category: 'LIGHTING',
                brandId: activeBrand,
                author: currentUser,
                linkedAssemblyId: selectedAssemblyId, 
                specs: { room, cluster },
                createdAt: serverTimestamp()
            };
            await addDoc(collection(db, "cpq_drafts"), payload);
            alert("✅ SCALE MODEL PUSHED TO CPQ DRAFTS!\n\nYou can now resume this configuration in Tab 8 to apply specific textures and pricing.");
        } catch (e) {
            console.error(e);
            alert("Error saving draft.");
        }
        setIsSaving(false);
    };

    const handlePushToCoop = async () => {
        if (!coopFormData.entityId) return alert(`Please select a ${coopFormData.target} first.`);
        setIsCapturing(true);
        try {
            const canvas = document.querySelector('#vision-lighting-canvas canvas');
            if (!canvas) throw new Error("Canvas not found");
            
            const dataUrl = canvas.toDataURL('image/png');
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            
            const storageRef = ref(storage, `coop_captures/VISION_${Date.now()}.png`);
            const uploadTask = uploadBytesResumable(storageRef, blob);
            
            uploadTask.on("state_changed", null, null, async () => {
                const dlUrl = await getDownloadURL(uploadTask.snapshot.ref);
                
                const newJobId = `LEAD-${Math.floor(1000 + Math.random() * 9000)}`;
                
                const selectedEntity = (coopFormData.target === 'CUSTOMER' ? liveCustomers : liveVendors).find(e => e.id === coopFormData.entityId);
                const entityName = selectedEntity ? `${selectedEntity.name} - ${selectedEntity.id}` : coopFormData.entityId;

                const payload = {
                    jobId: newJobId, status: 'INCEPTION', brandId: activeBrand,
                    clientName: coopFormData.target === 'CUSTOMER' ? entityName : '',
                    vendorName: coopFormData.target === 'VENDOR' ? entityName : '',
                    customer: coopFormData.target === 'CUSTOMER' && selectedEntity ? { id: selectedEntity.id, name: selectedEntity.name } : null,
                    note: `[Scale/Spatial Concept] ${coopFormData.note}`,
                    linkedAssemblyId: selectedAssemblyId || "", 
                    imageUrl: dlUrl,
                    date: new Date().toISOString().split('T')[0],
                    createdAt: serverTimestamp()
                };
                
                await setDoc(doc(db, "jobs", newJobId), payload);
                alert(`✅ Snapshot captured and pushed to External Coop (${coopFormData.target})!`);
                setCoopModalOpen(false);
                setCoopFormData({ ...coopFormData, note: '', entityId: '' });
                setIsCapturing(false);
            });

        } catch(e) {
            console.error(e);
            alert("Capture failed.");
            setIsCapturing(false);
        }
    };

    // --- 3D Ghost Rendering Component ---
    const FixtureGhost = ({ fixture, ceilingHeight }) => {
        const mountY = ceilingHeight;
        const topOfFixtureY = mountY - fixture.drop;

        return (
            <group position={[fixture.x, 0, fixture.y]}>
                <Cylinder args={[0.5, 0.5, fixture.drop, 8]} position={[0, mountY - (fixture.drop / 2), 0]}>
                    <meshStandardMaterial color="#b08d57" />
                </Cylinder>
                
                <group position={[0, topOfFixtureY, 0]}>
                    {fixture.tiers.map(tier => (
                        <group key={tier.id} position={[0, tier.zOffset - (tier.height / 2), 0]}>
                            <Cylinder args={[tier.diameter / 2, tier.diameter / 2, tier.height, 32, 1, true]} side={THREE.DoubleSide}>
                                <meshStandardMaterial color="#b08d57" transparent opacity={0.05} depthWrite={false} />
                            </Cylinder>
                            <Cylinder args={[tier.diameter / 2, tier.diameter / 2, tier.height, 32, 1, true]} side={THREE.DoubleSide} wireframe>
                                <meshBasicMaterial color="#b08d57" />
                            </Cylinder>
                            <Html position={[0, 0, tier.diameter / 2]} center>
                                <div style={{ color: '#fff', background: 'var(--ink)', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px', whiteSpace: 'nowrap' }}>
                                    Ø {tier.diameter}" | {tier.height}"h
                                </div>
                            </Html>
                        </group>
                    ))}
                </group>
            </group>
        );
    };

    const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' };
    const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
    const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

    return (
        <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1, minHeight: '800px', backgroundColor: 'transparent' }}>
            
            {/* LEFT: CONTROLS */}
            <div style={{ width: '450px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', overflowY: 'auto' }}>
                <div style={{ padding: '20px 24px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, borderBottom: '1px solid var(--line)' }}>Scale & Spatial Planner</div>
                
                {/* Assembly Data Binder */}
                <div style={{ padding: '24px', borderBottom: '1px solid var(--line)', background: 'var(--paper)' }}>
                    <h4 style={sectionHeaderStyle}>1. Base Chandelier Model</h4>
                    <select 
                        value={selectedAssemblyId} 
                        onChange={(e) => setSelectedAssemblyId(e.target.value)} 
                        style={{ ...fieldStyle, background: '#fff' }}
                    >
                        <option value="">-- Select Master Assembly --</option>
                        {validAssemblies.map(a => (
                            <option key={a.id} value={a.id}>{a.legacyErpId && a.legacyErpId !== "PENDING" ? `[${a.legacyErpId}] ` : ''}{a.itemName}</option>
                        ))}
                    </select>
                </div>

                <div style={{ padding: '24px', borderBottom: '1px solid var(--line)', background: '#fff' }}>
                    <h4 style={sectionHeaderStyle}>2. Room Dimensions (Inches)</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Ceiling Height (in)</label><input type="number" value={room.height} onChange={e => setRoom({...room, height: Number(e.target.value)})} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Room Width</label><input type="number" value={room.width} onChange={e => setRoom({...room, width: Number(e.target.value)})} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Room Depth</label><input type="number" value={room.depth} onChange={e => setRoom({...room, depth: Number(e.target.value)})} style={fieldStyle} /></div>
                    </div>
                </div>

                <div style={{ padding: '24px', flex: 1, overflowY: 'auto', background: 'var(--paper-2)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h4 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>3. Lighting Cluster ({cluster.length})</h4>
                        <button onClick={addFixture} style={{ padding: '8px 16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Add Fixture</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                        {cluster.map((fix, idx) => (
                            <div key={fix.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)', paddingBottom: '16px', marginBottom: '20px' }}>
                                    <strong style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Fixture {idx + 1}</strong>
                                    <button onClick={() => removeFixture(fix.id)} disabled={cluster.length === 1} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Remove</button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                    <div><label style={labelStyle}>X Position</label><input type="range" min={-room.width/2} max={room.width/2} value={fix.x} onChange={e => updateFixture(fix.id, 'x', e.target.value)} style={{ width: '100%' }} /><div style={{fontFamily: 'var(--mono)', fontSize: '10px', textAlign: 'center', marginTop: '8px', color: 'var(--ink-soft)'}}>{fix.x}"</div></div>
                                    <div><label style={labelStyle}>Z Position</label><input type="range" min={-room.depth/2} max={room.depth/2} value={fix.y} onChange={e => updateFixture(fix.id, 'y', e.target.value)} style={{ width: '100%' }} /><div style={{fontFamily: 'var(--mono)', fontSize: '10px', textAlign: 'center', marginTop: '8px', color: 'var(--ink-soft)'}}>{fix.y}"</div></div>
                                    <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Stem / Drop from Ceiling</label><input type="range" min="6" max={room.height - 30} value={fix.drop} onChange={e => updateFixture(fix.id, 'drop', e.target.value)} style={{ width: '100%' }} /><div style={{fontFamily: 'var(--mono)', fontSize: '10px', textAlign: 'center', color: 'var(--ink)', marginTop: '8px'}}>{fix.drop}" Drop</div></div>
                                </div>

                                <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                        <strong style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)' }}>Tiers / Rings ({fix.tiers.length})</strong>
                                        <button onClick={() => addTier(fix.id)} style={{ padding: '6px 12px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Add Tier</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        {fix.tiers.map((tier, tIdx) => (
                                            <div key={tier.id} style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px', position: 'relative' }}>
                                                <button onClick={() => removeTier(fix.id, tier.id)} disabled={fix.tiers.length === 1} style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '12px' }}>Tier {tIdx + 1}</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Diameter (in):</label><input type="number" value={tier.diameter} onChange={e => updateTier(fix.id, tier.id, 'diameter', e.target.value)} style={{ width: '80px', padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--sans)' }} /></div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Tassel Height (in):</label><input type="number" value={tier.height} onChange={e => updateTier(fix.id, tier.id, 'height', e.target.value)} style={{ width: '80px', padding: '6px', border: '1px solid var(--line)', fontFamily: 'var(--sans)' }} /></div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)' }}>Z-Offset (Gap in):</label><input type="number" value={tier.zOffset} onChange={e => updateTier(fix.id, tier.id, 'zOffset', e.target.value)} style={{ width: '80px', padding: '6px', border: '1px solid var(--ink)', fontFamily: 'var(--sans)' }} /></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', padding: '20px', background: 'var(--paper)', borderTop: '1px solid var(--line)' }}>
                    <button onClick={pushToCPQ} disabled={isSaving} style={{ flex: 1, padding: '16px', background: isSaving ? 'var(--paper-2)' : 'var(--ink)', color: isSaving ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                        {isSaving ? "Saving..." : "Push to CPQ"}
                    </button>
                    <button onClick={() => setCoopModalOpen(true)} disabled={isSaving} style={{ flex: 1, padding: '16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                        Push to Coop
                    </button>
                </div>
            </div>

            {/* RIGHT: LIVE 3D CANVAS */}
            <div id="vision-lighting-canvas" style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '24px', left: '30px', color: 'var(--ink)', zIndex: 10 }}>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500 }}>Architectural Scale Environment</h3>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>{room.width}"W × {room.depth}"D × {room.height}"H</div>
                </div>
                
                <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, room.height / 2, room.width], fov: 60 }}>
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[100, 200, 100]} intensity={1.2} />
                    <OrbitControls makeDefault target={[0, room.height / 2, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />

                    <Plane args={[room.width, room.depth]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                        <meshStandardMaterial color="#f2efe8" /> {/* var(--paper-2) */}
                    </Plane>

                    <Plane args={[room.width, room.depth]} rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]}>
                        <meshStandardMaterial color="#e5e5e5" wireframe />
                    </Plane>

                    <group position={[0, 15, 0]}>
                        <Box args={[72, 30, 40]}>
                            <meshStandardMaterial color="#e5e5e5" />
                        </Box>
                        <Html position={[0, 20, 0]} center>
                            <div style={{ color: 'var(--ink-soft)', background: '#fff', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px', whiteSpace: 'nowrap', border: '1px solid var(--line)' }}>72" Reference Table</div>
                        </Html>
                    </group>

                    {cluster.map(fixture => (
                        <FixtureGhost key={fixture.id} fixture={fixture} ceilingHeight={room.height} />
                    ))}
                </Canvas>
            </div>

            {coopModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                   <div style={{ background: '#fff', border: '1px solid var(--line)', width: '500px', borderRadius: '2px', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'column' }}>
                       <div style={{ padding: '24px 30px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Capture & Push to Coop</h3>
                           <button onClick={() => setCoopModalOpen(false)} disabled={isCapturing} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: isCapturing ? 'not-allowed' : 'pointer' }}>×</button>
                       </div>
                       <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                           <div>
                               <label style={labelStyle}>Routing Destination</label>
                               <select value={coopFormData.target} onChange={(e) => setCoopFormData({...coopFormData, target: e.target.value, entityId: '' })} style={fieldStyle}>
                                   <option value="CUSTOMER">Customer CRM</option>
                                   <option value="VENDOR">Vendor Portal</option>
                               </select>
                           </div>
                           <div>
                               <label style={{ ...labelStyle, color: 'var(--ink)' }}>Assign to {coopFormData.target}</label>
                               <select value={coopFormData.entityId} onChange={(e) => setCoopFormData({...coopFormData, entityId: e.target.value})} style={fieldStyle}>
                                   <option value="">-- Select {coopFormData.target} --</option>
                                   {(coopFormData.target === 'CUSTOMER' ? liveCustomers : liveVendors).map(item => ( 
                                       <option key={item.id} value={item.id}>{item.name} - {item.id}</option> 
                                   ))}
                               </select>
                           </div>
                           <div>
                               <label style={labelStyle}>External Note / RFI</label>
                               <textarea value={coopFormData.note} onChange={(e) => setCoopFormData({...coopFormData, note: e.target.value})} placeholder="e.g. Please review chandelier scale..." rows={4} style={{ ...fieldStyle, resize: 'vertical' }} />
                           </div>
                           <button onClick={handlePushToCoop} disabled={isCapturing} style={{ width: '100%', padding: '16px', background: isCapturing ? 'var(--paper-2)' : 'var(--ink)', color: isCapturing ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isCapturing ? 'wait' : 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                               {isCapturing ? "Snapping & Uploading..." : "Send to Tab 10 (Coop)"}
                           </button>
                       </div>
                   </div>
                </div>
            )}
        </div>
    );
};

export default VisionLighting;