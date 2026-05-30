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
    
    // 🚀 NEW: Live CRM Data State
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

    // Fetch Master Assemblies, Data Lists, and unified CRM records
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

        // 🚀 NEW: Listen for unified CRM records
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
                linkedAssemblyId: selectedAssemblyId, // 🚀 Critical for Tab 8 alignment
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
                
                // Lookup full entity data for formatting
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
                {/* Stem/Chain from ceiling */}
                <Cylinder args={[0.5, 0.5, fixture.drop, 8]} position={[0, mountY - (fixture.drop / 2), 0]}>
                    <meshStandardMaterial color="#333" />
                </Cylinder>
                
                {/* Parametric Tiers */}
                <group position={[0, topOfFixtureY, 0]}>
                    {fixture.tiers.map(tier => (
                        <group key={tier.id} position={[0, tier.zOffset - (tier.height / 2), 0]}>
                            {/* Inner Volume Block */}
                            <Cylinder args={[tier.diameter / 2, tier.diameter / 2, tier.height, 32, 1, true]} side={THREE.DoubleSide}>
                                <meshStandardMaterial color="#007bff" transparent opacity={0.1} depthWrite={false} />
                            </Cylinder>
                            {/* Crisp Wireframe Edge */}
                            <Cylinder args={[tier.diameter / 2, tier.diameter / 2, tier.height, 32, 1, true]} side={THREE.DoubleSide} wireframe>
                                <meshBasicMaterial color="#007bff" />
                            </Cylinder>
                            <Html position={[0, 0, tier.diameter / 2]} center>
                                <div style={{ color: '#fff', background: '#007bff', padding: '2px 5px', fontSize: '0.6rem', fontWeight: 'bold', borderRadius: '4px', whiteSpace: 'nowrap' }}>
                                    Ø {tier.diameter}" | {tier.height}"h
                                </div>
                            </Html>
                        </group>
                    ))}
                </group>
            </group>
        );
    };

    return (
        <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1, minHeight: '800px' }}>
            
            {/* LEFT: CONTROLS */}
            <div style={{ width: '450px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', overflowY: 'auto' }}>
                <div style={{ padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold' }}>📐 SCALE & SPATIAL PLANNER</div>
                
                {/* Assembly Data Binder */}
                <div style={{ padding: '15px', borderBottom: '2px solid #ccc', background: '#eafaf1' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#1e7e34' }}>1. BASE CHANDELIER MODEL</h4>
                    <select 
                        value={selectedAssemblyId} 
                        onChange={(e) => setSelectedAssemblyId(e.target.value)} 
                        style={{ width: '100%', padding: '10px', border: '2px solid #28a745', fontWeight: 'bold' }}
                    >
                        <option value="">-- Select Master Assembly --</option>
                        {validAssemblies.map(a => (
                            <option key={a.id} value={a.id}>{a.legacyErpId && a.legacyErpId !== "PENDING" ? `[${a.legacyErpId}] ` : ''}{a.itemName}</option>
                        ))}
                    </select>
                </div>

                <div style={{ padding: '15px', borderBottom: '2px solid #000', background: '#f0f8ff' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#007bff' }}>2. ROOM DIMENSIONS (INCHES)</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>CEILING HEIGHT (in):</label><input type="number" value={room.height} onChange={e => setRoom({...room, height: Number(e.target.value)})} style={{ width: '100%', padding: '8px', border: '2px solid #000', fontWeight: 'bold' }} /></div>
                        <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>ROOM WIDTH:</label><input type="number" value={room.width} onChange={e => setRoom({...room, width: Number(e.target.value)})} style={{ width: '100%', padding: '5px', border: '1px solid #ccc' }} /></div>
                        <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>ROOM DEPTH:</label><input type="number" value={room.depth} onChange={e => setRoom({...room, depth: Number(e.target.value)})} style={{ width: '100%', padding: '5px', border: '1px solid #ccc' }} /></div>
                    </div>
                </div>

                <div style={{ padding: '15px', flex: 1, overflowY: 'auto', background: '#f8f9fa' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <h4 style={{ margin: 0, color: '#e83e8c' }}>3. LIGHTING CLUSTER ({cluster.length})</h4>
                        <button onClick={addFixture} style={{ padding: '5px 10px', background: '#e83e8c', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>+ ADD FIXTURE</button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {cluster.map((fix, idx) => (
                            <div key={fix.id} style={{ background: '#fff', border: '2px solid #e83e8c', padding: '10px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eee', paddingBottom: '10px', marginBottom: '10px' }}>
                                    <strong style={{ color: '#e83e8c', fontSize: '1.1rem' }}>Fixture {idx + 1}</strong>
                                    <button onClick={() => removeFixture(fix.id)} disabled={cluster.length === 1} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontWeight: 'bold' }}>🗑️ REMOVE</button>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                                    <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>X POSITION (OFFSET):</label><input type="range" min={-room.width/2} max={room.width/2} value={fix.x} onChange={e => updateFixture(fix.id, 'x', e.target.value)} style={{ width: '100%' }} /><div style={{fontSize:'0.75rem', textAlign:'center', fontWeight:'bold'}}>{fix.x}"</div></div>
                                    <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>Z POSITION (OFFSET):</label><input type="range" min={-room.depth/2} max={room.depth/2} value={fix.y} onChange={e => updateFixture(fix.id, 'y', e.target.value)} style={{ width: '100%' }} /><div style={{fontSize:'0.75rem', textAlign:'center', fontWeight:'bold'}}>{fix.y}"</div></div>
                                    <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d9534f' }}>STEM / OVERALL DROP FROM CEILING:</label><input type="range" min="6" max={room.height - 30} value={fix.drop} onChange={e => updateFixture(fix.id, 'drop', e.target.value)} style={{ width: '100%' }} /><div style={{fontSize:'0.75rem', textAlign:'center', color: '#d9534f', fontWeight: 'bold'}}>{fix.drop}" DROP</div></div>
                                </div>

                                <div style={{ background: '#fdfdfd', border: '2px dashed #007bff', padding: '10px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                        <strong style={{ fontSize: '0.85rem', color: '#007bff' }}>TIERS / RINGS ({fix.tiers.length})</strong>
                                        <button onClick={() => addTier(fix.id)} style={{ padding: '5px 10px', background: '#007bff', color: '#fff', border: 'none', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer' }}>+ ADD TIER</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {fix.tiers.map((tier, tIdx) => (
                                            <div key={tier.id} style={{ background: '#fff', border: '1px solid #ccc', padding: '10px', position: 'relative' }}>
                                                <button onClick={() => removeTier(fix.id, tier.id)} disabled={fix.tiers.length === 1} style={{ position: 'absolute', top: '5px', right: '5px', background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }}>×</button>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '10px' }}>Tier {tIdx + 1}</div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>Diameter (in):</label><input type="number" value={tier.diameter} onChange={e => updateTier(fix.id, tier.id, 'diameter', e.target.value)} style={{ width: '80px', padding: '4px', border: '1px solid #000' }} /></div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>Tassel Height (in):</label><input type="number" value={tier.height} onChange={e => updateTier(fix.id, tier.id, 'height', e.target.value)} style={{ width: '80px', padding: '4px', border: '1px solid #000' }} /></div>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#CC6600' }}>Z-Offset (Gap in):</label><input type="number" value={tier.zOffset} onChange={e => updateTier(fix.id, tier.id, 'zOffset', e.target.value)} style={{ width: '80px', padding: '4px', border: '1px solid #CC6600' }} /></div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '5px', padding: '10px', background: '#f4f4f4', borderTop: '2px solid #ccc' }}>
                    <button onClick={pushToCPQ} disabled={isSaving} style={{ flex: 1, padding: '15px', background: isSaving ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', boxShadow: '2px 2px 0 rgba(0,0,0,0.2)' }}>
                        {isSaving ? "SAVING..." : "📥 PUSH TO CPQ"}
                    </button>
                    <button onClick={() => setCoopModalOpen(true)} disabled={isSaving} style={{ flex: 1, padding: '15px', background: isSaving ? '#ccc' : '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', boxShadow: '2px 2px 0 rgba(0,0,0,0.2)' }}>
                        📸 PUSH TO COOP
                    </button>
                </div>
            </div>

            {/* RIGHT: LIVE 3D CANVAS */}
            <div id="vision-lighting-canvas" style={{ flex: 1, background: '#fff', border: '2px solid #000', boxShadow: '10px 10px 0 #000', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: '15px', left: '20px', color: '#000', zIndex: 10 }}>
                    <h3 style={{ margin: 0 }}>ARCHITECTURAL SCALE ENVIRONMENT</h3>
                    <div style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>{room.width}"w x {room.depth}"d x {room.height}"h</div>
                </div>
                
                <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [0, room.height / 2, room.width], fov: 60 }}>
                    <ambientLight intensity={0.6} />
                    <directionalLight position={[100, 200, 100]} intensity={1.2} />
                    <OrbitControls makeDefault target={[0, room.height / 2, 0]} maxPolarAngle={Math.PI / 2 - 0.05} />

                    {/* Room Floor */}
                    <Plane args={[room.width, room.depth]} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
                        <meshStandardMaterial color="#f0f0f0" />
                    </Plane>

                    {/* Ceiling Grid */}
                    <Plane args={[room.width, room.depth]} rotation={[Math.PI / 2, 0, 0]} position={[0, room.height, 0]}>
                        <meshStandardMaterial color="#ddd" wireframe />
                    </Plane>

                    {/* Reference Dining Table (72" x 40" x 30"h) */}
                    <group position={[0, 15, 0]}>
                        <Box args={[72, 30, 40]}>
                            <meshStandardMaterial color="#ddd" />
                        </Box>
                        <Html position={[0, 20, 0]} center>
                            <div style={{ color: '#333', background: '#fff', padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px', fontWeight: 'bold', whiteSpace: 'nowrap', border: '1px solid #ccc' }}>72" Reference Table</div>
                        </Html>
                    </group>

                    {/* Render Cluster */}
                    {cluster.map(fixture => (
                        <FixtureGhost key={fixture.id} fixture={fixture} ceilingHeight={room.height} />
                    ))}
                </Canvas>
            </div>

            {coopModalOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
                   <div style={{ background: '#fff', border: '4px solid #000', width: '450px', boxShadow: '15px 15px 0 #000', display: 'flex', flexDirection: 'column' }}>
                       <div style={{ padding: '20px', background: '#17a2b8', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                           <h3 style={{ margin: 0, fontSize: '1.2rem' }}>📸 CAPTURE & PUSH TO COOP</h3>
                           <button onClick={() => setCoopModalOpen(false)} disabled={isCapturing} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: isCapturing ? 'not-allowed' : 'pointer' }}>×</button>
                       </div>
                       <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                           <div>
                               <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ROUTING DESTINATION:</label>
                               <select value={coopFormData.target} onChange={(e) => setCoopFormData({...coopFormData, target: e.target.value, entityId: '' })} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }}>
                                   <option value="CUSTOMER">👥 Customer CRM</option>
                                   <option value="VENDOR">🏢 Vendor Portal</option>
                               </select>
                           </div>
                           <div>
                               <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#007bff' }}>ASSIGN TO {coopFormData.target}:</label>
                               <select value={coopFormData.entityId} onChange={(e) => setCoopFormData({...coopFormData, entityId: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #007bff', boxSizing: 'border-box' }}>
                                   <option value="">-- Select {coopFormData.target} --</option>
                                   {(coopFormData.target === 'CUSTOMER' ? liveCustomers : liveVendors).map(item => ( 
                                       <option key={item.id} value={item.id}>{item.name} - {item.id}</option> 
                                   ))}
                               </select>
                           </div>
                           <div>
                               <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>EXTERNAL NOTE / RFI:</label>
                               <textarea value={coopFormData.note} onChange={(e) => setCoopFormData({...coopFormData, note: e.target.value})} placeholder="e.g. Please review chandelier scale..." rows={4} style={{ width: '100%', padding: '10px', border: '1px solid #ccc', boxSizing: 'border-box', resize: 'none' }} />
                           </div>
                           <button onClick={handlePushToCoop} disabled={isCapturing} style={{ width: '100%', padding: '15px', background: isCapturing ? '#ccc' : '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: 'none', cursor: isCapturing ? 'wait' : 'pointer', marginTop: '10px' }}>
                               {isCapturing ? "📸 SNAPPING & UPLOADING..." : "🚀 SEND TO TAB 10 (COOP)"}
                           </button>
                       </div>
                   </div>
                </div>
            )}
        </div>
    );
};

export default VisionLighting;