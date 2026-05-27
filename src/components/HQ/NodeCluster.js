import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds } from '@react-three/drei';

// --- 3D INTERACTIVE HIGHLIGHT MODEL ---
const SelectableModel = ({ url, selectedMeshes, existingClusters, onMeshClick, onLoaded }) => {
    const { scene } = useGLTF(url);

    useEffect(() => {
        const meshes = [];
        scene.traverse(c => {
            if (c.isMesh) meshes.push(c.name);
        });
        if (onLoaded) onLoaded(meshes);
    }, [scene, onLoaded]);

    useMemo(() => {
        scene.traverse((child) => {
            if (child.isMesh) {
                if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material.clone();
                
                // Check if it belongs to an existing cluster
                const isClustered = existingClusters.some(cl => cl.meshes.includes(child.name));

                if (selectedMeshes.includes(child.name)) {
                    // Highlight Active Selection in Blue
                    child.material = new THREE.MeshStandardMaterial({ color: '#007bff', emissive: '#007bff', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (isClustered) {
                    // Highlight already clustered parts in subtle Green
                    child.material = new THREE.MeshStandardMaterial({ color: '#28a745', emissive: '#28a745', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
                } else {
                    child.material = child.userData.originalMaterial;
                }
            }
        });
    }, [scene, selectedMeshes, existingClusters]);

    return (
        <primitive 
            object={scene} 
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; }}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
            onClick={(e) => { e.stopPropagation(); onMeshClick(e.object.name); }} 
        />
    );
};

const NodeClusterTab = ({ currentUser, activeBrand }) => {
    const [masterAssemblies, setMasterAssemblies] = useState([]);
    const [activeAssembly, setActiveAssembly] = useState(null);
    const [allMeshes, setAllMeshes] = useState([]);
    
    const [selectedMeshes, setSelectedMeshes] = useState([]);
    const [clusterName, setClusterName] = useState("");

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            docs.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));
            setMasterAssemblies(docs);
            
            if (activeAssembly) {
                const updated = docs.find(d => d.id === activeAssembly.id);
                if (updated) setActiveAssembly(updated);
            }
        });
        return () => unsubscribe();
    }, [activeBrand, activeAssembly?.id]);

    const handleMeshClick = (meshName) => {
        setSelectedMeshes(prev => prev.includes(meshName) ? prev.filter(m => m !== meshName) : [...prev, meshName]);
    };

    const handleSaveCluster = async () => {
        if (!clusterName.trim()) return alert("Please enter a name for this Sub-Assembly / Cluster.");
        if (selectedMeshes.length === 0) return alert("Please select at least one 3D mesh.");

        const currentClusters = activeAssembly.nodeClusters || [];
        const newCluster = {
            id: `CLUSTER-${Date.now()}`,
            name: clusterName.toUpperCase(),
            meshes: selectedMeshes
        };

        const updatedClusters = [...currentClusters, newCluster];

        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updatedClusters });
            setClusterName("");
            setSelectedMeshes([]);
        } catch (err) { console.error(err); alert("Failed to save cluster."); }
    };

    const handleDeleteCluster = async (clusterId) => {
        if (!window.confirm("Delete this grouping? The meshes will return to being individual parts.")) return;
        const updatedClusters = (activeAssembly.nodeClusters || []).filter(c => c.id !== clusterId);
        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updatedClusters });
        } catch (err) { console.error(err); }
    };

    const existingClusters = activeAssembly?.nodeClusters || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
                <div>
                    <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#6f42c1' }}>3. Node Grouping Studio</h2>
                    <span style={{ fontSize: '0.7rem', color: '#666' }}>DEFINE 3D SUB-ASSEMBLIES & CLUSTERS</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flex: 1 }}>
                
                {/* LEFT: ASSEMBLY SELECTOR */}
                <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '15px', flexShrink: 0 }}>
                    {masterAssemblies.map(asm => {
                        const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
                        const clusterCount = asm.nodeClusters?.length || 0;
                        return (
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedMeshes([]); setAllMeshes([]); }} style={{ background: activeAssembly?.id === asm.id ? '#e6e6fa' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #6f42c1' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #6f42c1' : 'none' }}>
                                <div style={{ padding: '5px 10px', background: hasCAD ? '#6f42c1' : '#666', color: '#fff', fontSize: '0.65rem', fontWeight: 'bold', textAlign: 'center' }}>
                                    {hasCAD ? `⚙️ CAD: ${clusterCount} CLUSTERS` : '⚠️ NO CAD'}
                                </div>
                                <div style={{ padding: '15px' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#000' }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                                    <div style={{ fontSize: '1rem', fontWeight: 'bold', marginTop: '5px' }}>{asm.itemName}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* CENTER & RIGHT PANEL */}
                {activeAssembly && activeAssembly.manufacturingSpecs?.cadUrl ? (
                    <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: '600px' }}>
                        
                        {/* 3D VIEWER */}
                        <div style={{ flex: 2, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '15px', left: '15px', zIndex: 10, background: 'rgba(255,255,255,0.9)', padding: '10px', border: '2px solid #000' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>🟦 CLICK TO SELECT</div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#28a745' }}>🟩 ALREADY CLUSTERED</div>
                            </div>
                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                                <ambientLight intensity={0.5} />
                                <directionalLight position={[10, 10, 5]} intensity={1} />
                                <OrbitControls makeDefault />
                                <Bounds fit clip observe margin={1.2}>
                                    <SelectableModel 
                                        url={activeAssembly.manufacturingSpecs.cadUrl} 
                                        selectedMeshes={selectedMeshes} 
                                        existingClusters={existingClusters}
                                        onMeshClick={handleMeshClick} 
                                        onLoaded={setAllMeshes}
                                    />
                                </Bounds>
                            </Canvas>
                        </div>

                        {/* CLUSTER MANAGER */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '5px 5px 0 #6f42c1' }}>
                                <h3 style={{ margin: '0 0 15px 0', color: '#6f42c1' }}>CREATE CLUSTER</h3>
                                <div style={{ background: '#e6f2ff', padding: '10px', border: '1px solid #007bff', marginBottom: '15px', fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>
                                    {selectedMeshes.length} Meshes Selected
                                </div>
                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>SUB-ASSEMBLY NAME:</label>
                                <input value={clusterName} onChange={e => setClusterName(e.target.value)} placeholder="e.g. Canopy Assembly" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', textTransform: 'uppercase' }} />
                                <button onClick={handleSaveCluster} style={{ width: '100%', padding: '15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>💾 SAVE CLUSTER</button>
                            </div>

                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', flex: 1, overflowY: 'auto' }}>
                                <h3 style={{ margin: '0 0 15px 0' }}>SAVED CLUSTERS ({existingClusters.length})</h3>
                                {existingClusters.length === 0 && <div style={{ color: '#666', fontStyle: 'italic', fontSize: '0.8rem' }}>No sub-assemblies defined.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {existingClusters.map(cl => (
                                        <div key={cl.id} style={{ border: '2px solid #28a745', padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eafaf1' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: '#1e7e34' }}>{cl.name}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '4px' }}>{cl.meshes.length} Meshes Attached</div>
                                            </div>
                                            <button onClick={() => handleDeleteCluster(cl.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                    </div>
                ) : activeAssembly && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '3px dashed #ccc' }}>
                        <div style={{ color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>Please upload a 3D CAD model to manage nodes.</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NodeClusterTab;