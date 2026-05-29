import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds } from '@react-three/drei';

// --- HIERARCHY CASCADE HELPERS ---
const findNodeByName = (tree, name) => {
    if (!tree || !name) return null;
    if (tree.name === name) return tree;
    for (let child of tree.children || []) {
        const found = findNodeByName(child, name);
        if (found) return found;
    }
    return null;
};

const getAllNames = (tree) => {
    if (!tree) return [];
    let names = tree.name ? [tree.name] : [];
    for (let child of tree.children || []) {
        names = names.concat(getAllNames(child));
    }
    return names.filter(Boolean);
};

const getAncestors = (tree, targetName, currentPath = []) => {
    if (!tree || !targetName) return [];
    if (tree.name === targetName) return currentPath;
    const nextPath = tree.name ? [...currentPath, tree.name] : currentPath;
    for (let child of tree.children || []) {
        const path = getAncestors(child, targetName, nextPath);
        if (path.length > 0) return path;
    }
    return [];
};

// --- RECURSIVE SCENE GRAPH EXPLORER ---
const SceneNodeTree = ({ node, level = 0, selectedNodes, hiddenNodes, onToggleSelect, onToggleHide }) => {
    const [isExpanded, setIsExpanded] = useState(level < 2); 
    const nodeRef = useRef(null);

    const descendantSelected = useMemo(() => {
        if (!node || !node.children || node.children.length === 0) return false;
        const checkDescendant = (n) => selectedNodes.includes(n.name) || (n.children && n.children.some(checkDescendant));
        return node.children.some(checkDescendant);
    }, [node, selectedNodes]);

    useEffect(() => {
        if (descendantSelected) setIsExpanded(true);
    }, [descendantSelected]);

    if (!node) return null;
    
    if (node.name === 'Scene' || node.name === 'RootNode') {
        return <>{node.children.map(c => <SceneNodeTree key={c.uuid} node={c} level={level} selectedNodes={selectedNodes} hiddenNodes={hiddenNodes} onToggleSelect={onToggleSelect} onToggleHide={onToggleHide} />)}</>;
    }

    const isSelected = selectedNodes.includes(node.name);
    const isHidden = hiddenNodes.includes(node.name);
    const hasChildren = node.children && node.children.length > 0;
    const hasName = !!node.name;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
        if (isSelected && nodeRef.current) {
            nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [isSelected]);

    return (
        <div ref={nodeRef} style={{ paddingLeft: `${level * 12}px`, marginBottom: '2px', fontFamily: 'monospace' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', background: isSelected ? '#e6f2ff' : 'transparent', padding: '4px', border: isSelected ? '1px solid #007bff' : '1px solid transparent', borderRadius: '4px' }}>
                
                {hasChildren ? (
                    <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', width: '15px' }}>{isExpanded ? '▼' : '▶'}</button>
                ) : <div style={{ width: '15px' }} />}

                <button onClick={() => hasName && onToggleHide(node.name)} disabled={!hasName} style={{ background: 'none', border: 'none', cursor: hasName ? 'pointer' : 'not-allowed', fontSize: '0.9rem', opacity: hasName ? 1 : 0.3 }} title="Toggle Visibility">
                    {isHidden ? '👁️‍🗨️' : '👁️'}
                </button>

                <div onClick={() => hasName && onToggleSelect(node.name)} style={{ cursor: hasName ? 'pointer' : 'not-allowed', fontWeight: node.type === 'Group' ? 'bold' : 'normal', color: hasName ? (isSelected ? '#007bff' : '#333') : '#aaa', fontSize: '0.75rem', flex: 1, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {node.type === 'Mesh' ? '🧊' : '📁'} 
                    {hasName ? node.name : <span style={{ fontStyle: 'italic' }}>Unnamed {node.type}</span>}
                </div>
            </div>
            
            {isExpanded && hasChildren && (
                <div style={{ borderLeft: '1px dashed #ccc', marginLeft: '6px', paddingTop: '2px' }}>
                    {node.children.map(c => (
                        <SceneNodeTree key={c.uuid} node={c} level={level + 1} selectedNodes={selectedNodes} hiddenNodes={hiddenNodes} onToggleSelect={onToggleSelect} onToggleHide={onToggleHide} />
                    ))}
                </div>
            )}
        </div>
    );
};

// --- 3D INTERACTIVE HIGHLIGHT & VISIBILITY MODEL ---
const SelectableModel = ({ url, selectedNodes, existingClusters, hiddenNodes, highlightUnassigned, onMeshClick, onLoaded }) => {
    const { scene } = useGLTF(url);
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    useEffect(() => {
        const buildTree = (node) => ({
            uuid: node.uuid,
            name: node.name,
            type: node.type,
            children: node.children ? node.children.map(buildTree) : []
        });
        if (onLoaded) onLoaded(buildTree(clonedScene));
    }, [clonedScene, onLoaded]);

    useMemo(() => {
        const isDescendantOf = (child, nodeNameList) => {
            let curr = child;
            while (curr) {
                if (curr.name && nodeNameList.includes(curr.name)) return true;
                curr = curr.parent;
            }
            return false;
        };

        clonedScene.traverse((child) => {
            if (child.isMesh) {
                if (isDescendantOf(child, hiddenNodes)) {
                    child.visible = false;
                    return; 
                }
                child.visible = true;

                if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
                
                const isSelected = isDescendantOf(child, selectedNodes);
                const isClustered = existingClusters.some(cl => isDescendantOf(child, cl.nodes));

                if (isSelected) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#007bff', emissive: '#007bff', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (highlightUnassigned && !isClustered) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#fd7e14', emissive: '#fd7e14', emissiveIntensity: 0.8, transparent: true, opacity: 0.9 });
                } else if (highlightUnassigned && isClustered) {
                    child.material = new THREE.MeshBasicMaterial({ color: '#aaaaaa', transparent: true, opacity: 0.1 });
                } else if (isClustered) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#28a745', emissive: '#28a745', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
                } else {
                    child.material = child.userData.originalMaterial;
                }
            }
        });
    }, [clonedScene, selectedNodes, existingClusters, hiddenNodes, highlightUnassigned]);

    return (
        <primitive 
            object={clonedScene} 
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; }}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; }}
            onClick={(e) => { 
                e.stopPropagation(); 
                const targetName = e.object.name || (e.object.parent && e.object.parent.name);
                if (targetName) onMeshClick(targetName); 
            }} 
        />
    );
};

const NodeClusterTab = ({ currentUser, activeBrand }) => {
    const [masterAssemblies, setMasterAssemblies] = useState([]);
    const [activeAssembly, setActiveAssembly] = useState(null);
    const [sceneGraph, setSceneGraph] = useState(null);
    
    const [searchQuery, setSearchQuery] = useState("");
    const [projectFilter, setProjectFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [availableProjects, setAvailableProjects] = useState([]);

    const [newClusterName, setNewClusterName] = useState("");
    const [selectedNodes, setSelectedNodes] = useState([]);
    
    const [interactionMode, setInteractionMode] = useState("select"); 
    const [hiddenNodes, setHiddenNodes] = useState([]);
    const [highlightUnassigned, setHighlightUnassigned] = useState(false); 

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            docs.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));
            setMasterAssemblies(docs);
            
            const projects = [...new Set(docs.map(d => d.project).filter(Boolean))].sort();
            setAvailableProjects(projects);

            if (activeAssembly) {
                const updated = docs.find(d => d.id === activeAssembly.id);
                if (updated) setActiveAssembly(updated);
            }
        });
        return () => unsubscribe();
    }, [activeBrand, activeAssembly?.id]);

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

    // 🚀 NEW: CASCADING SELECTION LOGIC
    const handleToggleSelect = (nodeName) => {
        const targetNode = findNodeByName(sceneGraph, nodeName);
        const descendants = targetNode ? getAllNames(targetNode) : [nodeName];
        const ancestors = getAncestors(sceneGraph, nodeName);

        setSelectedNodes(prev => {
            const isCurrentlySelected = prev.includes(nodeName);
            if (isCurrentlySelected) {
                // Toggling OFF: Remove node, all its descendants, AND all its parent ancestors
                const toRemove = new Set([...descendants, ...ancestors]);
                return prev.filter(n => !toRemove.has(n));
            } else {
                // Toggling ON: Select node and all its descendants
                return [...new Set([...prev, ...descendants])];
            }
        });
    };

    // 🚀 NEW: CASCADING VISIBILITY LOGIC
    const handleToggleHide = (nodeName) => {
        const targetNode = findNodeByName(sceneGraph, nodeName);
        const descendants = targetNode ? getAllNames(targetNode) : [nodeName];
        const ancestors = getAncestors(sceneGraph, nodeName);

        setHiddenNodes(prev => {
            const isCurrentlyHidden = prev.includes(nodeName);
            if (isCurrentlyHidden) {
                // Unhiding: Unhide the node, its descendants, and its parent ancestors
                const toRemove = new Set([...descendants, ...ancestors]);
                return prev.filter(n => !toRemove.has(n));
            } else {
                // Hiding: Hide the node and its descendants
                const toDeselect = new Set([...descendants, ...ancestors]);
                // Automatically deselect hidden items to prevent phantom saves
                setSelectedNodes(curr => curr.filter(n => !toDeselect.has(n)));
                return [...new Set([...prev, ...descendants])];
            }
        });
    };

    const handleMeshClick = (nodeName) => {
        if (interactionMode === "hide") handleToggleHide(nodeName);
        else handleToggleSelect(nodeName);
    };

    const handleSaveCluster = async () => {
        if (!newClusterName.trim()) return alert("Please enter a name for this Sub-Assembly/Cluster.");
        if (selectedNodes.length === 0) return alert("Please select at least one 3D Node or Mesh.");

        const currentClusters = activeAssembly.nodeClusters || [];
        
        const newCluster = {
            id: `CLUSTER-${Date.now()}`,
            name: newClusterName.toUpperCase().trim(),
            nodes: selectedNodes 
        };

        const updatedClusters = [...currentClusters, newCluster];

        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updatedClusters });
            setNewClusterName("");
            setSelectedNodes([]);
        } catch (err) { console.error(err); alert("Failed to save cluster."); }
    };

    const handleDeleteCluster = async (clusterId) => {
        if (!window.confirm("Delete this grouping? The meshes will return to being unassigned.")) return;
        const updatedClusters = (activeAssembly.nodeClusters || []).filter(c => c.id !== clusterId);
        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updatedClusters });
        } catch (err) { console.error(err); }
    };

    const existingClusters = activeAssembly?.nodeClusters || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            
            <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '5px 5px 0 #000' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#6f42c1' }}>1.5 Node Grouping Studio</h2>
                        <span style={{ fontSize: '0.7rem', color: '#666' }}>EXTRACT SUB-ASSEMBLIES DIRECTLY FROM CAD NATIVE DATA</span>
                    </div>
                </div>
                
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: '#f8f9fa', padding: '10px', border: '1px solid #ccc' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>SEARCH:</label>
                        <input type="text" placeholder="Search Assembly Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>PROJECT:</label>
                        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold', boxSizing: 'border-box' }}>
                            <option value="ALL">ALL PROJECTS</option>
                            {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666', display: 'block' }}>STATUS:</label>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '6px', border: '1px solid #ccc', fontWeight: 'bold', boxSizing: 'border-box' }}>
                            <option value="ALL">ALL STATUSES</option>
                            <option value="NO_CAD">⚠️ AWAITING CAD</option>
                            <option value="NEEDS_CLUSTERING">⚙️ NEEDS CLUSTERING</option>
                            <option value="CLUSTERED">✅ FULLY CLUSTERED</option>
                        </select>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flex: 1 }}>
                
                <div style={{ width: '220px', display: 'flex', flexDirection: 'column', gap: '15px', flexShrink: 0, maxHeight: '800px', overflowY: 'auto' }}>
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
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedNodes([]); setSceneGraph(null); setHiddenNodes([]); setHighlightUnassigned(false); }} style={{ background: activeAssembly?.id === asm.id ? '#e6e6fa' : '#fff', border: activeAssembly?.id === asm.id ? '3px solid #6f42c1' : '2px solid #ccc', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activeAssembly?.id === asm.id ? '5px 5px 0 #6f42c1' : 'none' }}>
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

                {activeAssembly && activeAssembly.manufacturingSpecs?.cadUrl ? (
                    <div style={{ flex: 1, display: 'flex', gap: '20px', minHeight: '600px' }}>
                        
                        <div style={{ flex: 1.8, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '15px', left: '15px', zIndex: 10, background: 'rgba(255,255,255,0.95)', padding: '10px', border: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>🟦 CURRENT SELECTION</div>
                                <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#28a745' }}>🟩 CLUSTERED / BOUND</div>
                                <div style={{ fontSize: '0.65rem', color: '#666', borderTop: '1px dotted #ccc', paddingTop: '5px', marginTop: '2px' }}>
                                    <i>Tip: Right-click & drag to pan.</i>
                                </div>
                            </div>

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
                                <button 
                                    onClick={() => setHighlightUnassigned(!highlightUnassigned)}
                                    style={{ padding: '6px 12px', background: highlightUnassigned ? '#fd7e14' : '#fff', color: highlightUnassigned ? '#fff' : '#fd7e14', fontWeight: 'bold', border: '1px solid #fd7e14', cursor: 'pointer', fontSize: '0.75rem', width: '100%' }}
                                >
                                    {highlightUnassigned ? '🛑 CLEAR HIGHLIGHT' : '🔍 HIGHLIGHT UNASSIGNED'}
                                </button>

                                {hiddenNodes.length > 0 && (
                                    <button 
                                        onClick={() => setHiddenNodes([])}
                                        style={{ padding: '6px 12px', background: '#ffc107', color: '#000', fontWeight: 'bold', border: '1px solid #000', cursor: 'pointer', fontSize: '0.75rem', width: '100%' }}
                                    >
                                        👁️ SHOW ALL ({hiddenNodes.length} HIDDEN)
                                    </button>
                                )}
                            </div>

                            <Canvas camera={{ position: [5, 5, 5], fov: 50 }}>
                                <ambientLight intensity={0.5} />
                                <directionalLight position={[10, 10, 5]} intensity={1} />
                                <OrbitControls makeDefault enablePan={true} />
                                <Bounds fit clip observe margin={1.2}>
                                    <SelectableModel 
                                        url={activeAssembly.manufacturingSpecs.cadUrl} 
                                        selectedNodes={selectedNodes} 
                                        existingClusters={existingClusters}
                                        hiddenNodes={hiddenNodes}
                                        highlightUnassigned={highlightUnassigned}
                                        onMeshClick={handleMeshClick} 
                                        onLoaded={setSceneGraph}
                                    />
                                </Bounds>
                            </Canvas>
                        </div>

                        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            
                            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', height: '350px', boxShadow: '5px 5px 0 #17a2b8' }}>
                                <div style={{ padding: '10px 15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1rem', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🌲 NATIVE CAD HIERARCHY</span>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa' }}>
                                    {!sceneGraph ? (
                                        <div style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem' }}>Parsing GLTF Nodes...</div>
                                    ) : (
                                        <SceneNodeTree 
                                            node={sceneGraph} 
                                            selectedNodes={selectedNodes} 
                                            hiddenNodes={hiddenNodes} 
                                            onToggleSelect={handleToggleSelect} 
                                            onToggleHide={handleToggleHide} 
                                        />
                                    )}
                                </div>
                            </div>

                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '5px 5px 0 #6f42c1', display: 'flex', flexDirection: 'column' }}>
                                <h3 style={{ margin: '0 0 15px 0', color: '#6f42c1' }}>CREATE SUB-ASSEMBLY</h3>
                                <div style={{ background: '#e6f2ff', padding: '10px', border: '1px solid #007bff', marginBottom: '15px', fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>
                                    {selectedNodes.length} Nodes / Groups Selected
                                </div>
                                
                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>NAME THIS CLUSTER:</label>
                                <input 
                                    value={newClusterName} 
                                    onChange={e => setNewClusterName(e.target.value)} 
                                    placeholder="e.g. UPPER EXTENSION POLE"
                                    style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', fontWeight: 'bold', textTransform: 'uppercase' }}
                                />
                                
                                <button onClick={handleSaveCluster} style={{ width: '100%', padding: '15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>💾 SAVE TO MASTER FILE CABINET</button>
                                <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '10px', textAlign: 'center' }}>
                                    Saving this cluster makes it instantly available to the BOM Engine in Tab 2.
                                </div>
                            </div>

                            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', flex: 1, overflowY: 'auto' }}>
                                <h3 style={{ margin: '0 0 15px 0' }}>SAVED BOM BINDINGS ({existingClusters.length})</h3>
                                {existingClusters.length === 0 && <div style={{ color: '#666', fontStyle: 'italic', fontSize: '0.8rem' }}>No meshes bound to BOM components yet.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {existingClusters.map(cl => (
                                        <div key={cl.id} style={{ border: '2px solid #28a745', padding: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eafaf1' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: '#1e7e34' }}>{cl.name}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '4px' }}>{cl.nodes?.length || 0} Nodes Attached</div>
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
                        <div style={{ color: '#999', fontWeight: 'bold', fontSize: '1.2rem' }}>Please upload a 3D CAD model in Tab 1 to manage nodes.</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NodeClusterTab;