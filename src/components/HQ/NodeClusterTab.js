import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds } from '@react-three/drei';

// --- 3D INTERACTIVE HIGHLIGHT & VISIBILITY MODEL ---
const SelectableModel = ({ url, selectedMeshes, existingClusters, hiddenMeshes, onMeshClick, onLoaded }) => {
    const { scene } = useGLTF(url);
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    useEffect(() => {
        const meshes = [];
        clonedScene.traverse(c => {
            if (c.isMesh) meshes.push(c.name);
        });
        if (onLoaded) onLoaded(meshes);
    }, [clonedScene, onLoaded]);

    useMemo(() => {
        clonedScene.traverse((child) => {
            if (child.isMesh) {
                // Handle Visibility
                if (hiddenMeshes.includes(child.name)) {
                    child.visible = false;
                    return; // Skip material assignment if hidden
                }
                child.visible = true;

                // Handle Materials
                if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
                
                const isClustered = existingClusters.some(cl => cl.meshes.includes(child.name));

                if (selectedMeshes.includes(child.name)) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#007bff', emissive: '#007bff', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (isClustered) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#28a745', emissive: '#28a745', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
                } else {
                    child.material = child.userData.originalMaterial;
                }
            }
        });
    }, [clonedScene, selectedMeshes, existingClusters, hiddenMeshes]);

    return (
        <primitive 
            object={clonedScene} 
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
    
    // Search & Filter State
    const [searchQuery, setSearchQuery] = useState("");
    const [projectFilter, setProjectFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [availableProjects, setAvailableProjects] = useState([]);

    const [bomPins, setBomPins] = useState([]);
    const [selectedPinId, setSelectedPinId] = useState("");
    
    const [selectedMeshes, setSelectedMeshes] = useState([]);
    
    // 🚀 NEW: Visibility & Interaction State
    const [interactionMode, setInteractionMode] = useState("select"); // 'select', 'hide'
    const [hiddenMeshes, setHiddenMeshes] = useState([]);

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            docs.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));
            setMasterAssemblies(docs);
            
            // Extract unique projects for the filter
            const projects = [...new Set(docs.map(d => d.project).filter(Boolean))].sort();
            setAvailableProjects(projects);

            if (activeAssembly) {
                const updated = docs.find(d => d.id === activeAssembly.id);
                if (updated) setActiveAssembly(updated);
            }
        });
        return () => unsubscribe();
    }, [activeBrand, activeAssembly?.id]);

    useEffect(() => {
        if (!activeAssembly) {
            setBomPins([]);
            return;
        }
        const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activeAssembly.itemId));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        });
        return () => unsubscribe();
    }, [activeAssembly]);

    // 🚀 NEW: Filter Logic
    const filteredAssemblies = masterAssemblies.filter(asm => {
        const matchesSearch = (asm.itemName || "").toLowerCase().includes(searchQuery.toLowerCase()) || 
                              (asm.legacyErpId || "").toLowerCase().includes(searchQuery.toLowerCase());
        const matchesProject = projectFilter === "ALL" || asm.project === projectFilter;
        
        let matchesStatus = true;
        const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
        const clusterCount = asm.nodeClusters?.length || 0;
        
        if (statusFilter === "NO_CAD") {
            matchesStatus = !hasCAD;
        } else if (statusFilter === "NEEDS_CLUSTERING") {
            matchesStatus = hasCAD && clusterCount === 0;
        } else if (statusFilter === "CLUSTERED") {
            matchesStatus = hasCAD && clusterCount > 0;
        }

        return matchesSearch && matchesProject && matchesStatus;
    });

    const handleMeshClick = (meshName) => {
        if (interactionMode === "hide") {
            setHiddenMeshes(prev => [...prev, meshName]);
            // If we hide it, we should also deselect it if it was selected
            setSelectedMeshes(prev => prev.filter(m => m !== meshName));
        } else {
            setSelectedMeshes(prev => prev.includes(meshName) ? prev.filter(m => m !== meshName) : [...prev, meshName]);
        }
    };

    const handleSaveCluster = async () => {
        if (!selectedPinId) return alert("Please select a BOM Component from the dropdown.");
        if (selectedMeshes.length === 0) return alert("Please select at least one 3D mesh.");

        const selectedPin = bomPins.find(p => p.id === selectedPinId);
        if (!selectedPin) return;

        const currentClusters = activeAssembly.nodeClusters || [];
        
        const newCluster = {
            id: selectedPin.id,
            partId: selectedPin.partId, 
            name: selectedPin.partName,
            legacyErpId: selectedPin.legacyErpId || "N/A",
            meshes: selectedMeshes
        };

        const updatedClusters = currentClusters.filter(c => c.id !== selectedPin.id);
        updatedClusters.push(newCluster);

        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updatedClusters });
            setSelectedPinId("");
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
            
            {/* HEADER & FILTERS */}
            <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '5px 5px 0 #000' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#6f42c1' }}>2.5 Node Grouping Studio</h2>
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>BIND 3D MESHES TO BOM COMPONENTS</span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#f8f9fa', padding: '10px', border: '1px solid #ccc' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>SEARCH:</label>
                        <input type="text" placeholder="Search Assembly Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>PROJECT:</label>
                        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold' }}>
                            <option value="ALL">ALL PROJECTS</option>
                            {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>STATUS:</label>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold' }}>
                            <option value="ALL">ALL STATUSES</option>
                            <option value="NO_CAD">⚠️ AWAITING CAD</option>
                            <option value="NEEDS_CLUSTERING">⚙️ NEEDS CLUSTERING</option>
                            <option value="CLUSTERED">✅ CLUSTERED</option>
                        </select>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flex: 1 }}>
                
                {/* LEFT: ASSEMBLY SELECTOR */}
                <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '15px', flexShrink: 0, maxHeight: '800px', overflowY: 'auto' }}>
                    {filteredAssemblies.length === 0 && <div style={{ color: '#999', fontStyle: 'italic', padding: '10px' }}>No assemblies match criteria.</div>}
                    {filteredAssemblies.map(asm => {
                        const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
                        const clusterCount = asm.nodeClusters?.length || 0;
                        
                        let statusColor = '#666';
                        let statusText = '⚠️ AWAITING CAD';
                        if (hasCAD) {
                            statusColor = clusterCount > 0 ? '#28a745' : '#6f42c1';
                            statusText = clusterCount > 0 ? `✅ CLUSTERED (${clusterCount})` : '⚙️ NEEDS CLUSTERING';
                        }

                        return (
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedMeshes([]); setAllMeshes([]); setSelectedPinId(""); setHiddenMeshes([]); }} style={{ background: activeAssembly?.id === asm.id ? '#e6e6fa' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #6f42c1' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #6f42c1' : 'none' }}>
                                <div style={{ padding: '5px 10px', background: statusColor, color: '#fff', fontSize: '0.65rem', fontWeight: 'bold', textAlign: 'center' }}>
                                    {statusText}
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
                            <div style={{ position: 'absolute', top: '15px', left: '15px', zIndex: 10, background: 'rgba(255,255,255,0.95)', padding: '10px', border: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>🟦 CLICK TO SELECT</div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#28a745' }}>🟩 ALREADY CLUSTERED</div>
                                <div style={{ fontSize: '0.65rem', color: '#666', borderTop: '1px dotted #ccc', paddingTop: '5px', marginTop: '2px' }}>
                                    <i>Tip: Right-click & drag to pan.</i>
                                </div>
                            </div>

                            {/* 🚀 NEW: VISIBILITY CONTROLS */}
                            <div style={{ position: 'absolute', top: '15px', right: '15px', zIndex: 10, background: 'rgba(255,255,255,0.95)', padding: '10px', border: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button 
                                        onClick={() => setInteractionMode('select')} 
                                        style={{ padding: '6px 12px', background: interactionMode === 'select' ? '#007bff' : '#fff', color: interactionMode === 'select' ? '#fff' : '#000', fontWeight: 'bold', border: '1px solid #000', cursor: 'pointer', fontSize: '0.75rem' }}
                                    >
                                        🖱️ SELECT
                                    </button>
                                    <button 
                                        onClick={() => setInteractionMode('hide')} 
                                        style={{ padding: '6px 12px', background: interactionMode === 'hide' ? '#d9534f' : '#fff', color: interactionMode === 'hide' ? '#fff' : '#000', fontWeight: 'bold', border: '1px solid #000', cursor: 'pointer', fontSize: '0.75rem' }}
                                    >
                                        👁️‍🗨️ HIDE PARTS
                                    </button>
                                </div>
                                {hiddenMeshes.length > 0 && (
                                    <button 
                                        onClick={() => setHiddenMeshes([])}
                                        style={{ padding: '6px 12px', background: '#ffc107', color: '#000', fontWeight: 'bold', border: '1px solid #000', cursor: 'pointer', fontSize: '0.75rem', width: '100%' }}
                                    >
                                        👁️ SHOW ALL ({hiddenMeshes.length} HIDDEN)
                                    </button>
                                )}
                            </div>

                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                                <ambientLight intensity={0.5} />
                                <directionalLight position={[10, 10, 5]} intensity={1} />
                                {/* 🚀 FIX: enablePan=true (Default behavior for OrbitControls allows right-click panning) */}
                                <OrbitControls makeDefault enablePan={true} />
                                <Bounds fit clip observe margin={1.2}>
                                    <SelectableModel 
                                        url={activeAssembly.manufacturingSpecs.cadUrl} 
                                        selectedMeshes={selectedMeshes} 
                                        existingClusters={existingClusters}
                                        hiddenMeshes={hiddenMeshes}
                                        onMeshClick={handleMeshClick} 
                                        onLoaded={setAllMeshes}
                                    />
                                </Bounds>
                            </Canvas>
                        </div>

                        {/* CLUSTER MANAGER */}
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '5px 5px 0 #6f42c1' }}>
                                <h3 style={{ margin: '0 0 15px 0', color: '#6f42c1' }}>BIND MESHES TO BOM</h3>
                                <div style={{ background: '#e6f2ff', padding: '10px', border: '1px solid #007bff', marginBottom: '15px', fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>
                                    {selectedMeshes.length} Meshes Selected
                                </div>
                                
                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>LINK TO BOM COMPONENT:</label>
                                <select 
                                    value={selectedPinId} 
                                    onChange={e => setSelectedPinId(e.target.value)} 
                                    style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', fontWeight: 'bold', textTransform: 'uppercase' }}
                                >
                                    <option value="">-- SELECT FROM BOM --</option>
                                    {bomPins.map(pin => (
                                        <option key={pin.id} value={pin.id}>
                                            {pin.legacyErpId !== "PENDING" && pin.legacyErpId !== "N/A" ? `[${pin.legacyErpId}] ` : ''}{pin.partName}
                                        </option>
                                    ))}
                                </select>
                                
                                <button onClick={handleSaveCluster} style={{ width: '100%', padding: '15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>💾 SAVE BINDING</button>
                            </div>

                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', flex: 1, overflowY: 'auto' }}>
                                <h3 style={{ margin: '0 0 15px 0' }}>SAVED BOM BINDINGS ({existingClusters.length})</h3>
                                {existingClusters.length === 0 && <div style={{ color: '#666', fontStyle: 'italic', fontSize: '0.8rem' }}>No meshes bound to BOM components yet.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {existingClusters.map(cl => (
                                        <div key={cl.id} style={{ border: '2px solid #28a745', padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eafaf1' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: '#1e7e34' }}>{cl.name}</div>
                                                <div style={{ fontSize: '0.65rem', color: '#555', fontWeight: 'bold' }}>{cl.legacyErpId}</div>
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