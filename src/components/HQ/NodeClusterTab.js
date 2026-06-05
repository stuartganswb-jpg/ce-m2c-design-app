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
        <div ref={nodeRef} style={{ paddingLeft: `${level * 16}px`, marginBottom: '4px', fontFamily: 'var(--mono)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: isSelected ? 'var(--paper-2)' : 'transparent', padding: '6px', border: isSelected ? '1px solid var(--brass)' : '1px solid transparent', borderRadius: '2px' }}>
                
                {hasChildren ? (
                    <button onClick={() => setIsExpanded(!isExpanded)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', width: '20px', color: 'var(--ink-soft)' }}>{isExpanded ? '▼' : '▶'}</button>
                ) : <div style={{ width: '20px' }} />}

                <button onClick={() => hasName && onToggleHide(node.name)} disabled={!hasName} style={{ background: 'none', border: 'none', cursor: hasName ? 'pointer' : 'not-allowed', fontSize: '1rem', opacity: hasName ? 1 : 0.3 }} title="Toggle Visibility">
                    {isHidden ? '👁️‍🗨️' : '👁️'}
                </button>

                <div onClick={() => hasName && onToggleSelect(node.name)} style={{ cursor: hasName ? 'pointer' : 'not-allowed', fontWeight: node.type === 'Group' ? 600 : 400, color: hasName ? (isSelected ? 'var(--ink)' : 'var(--ink-soft)') : 'var(--line)', fontSize: '0.8rem', flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {node.type === 'Mesh' ? '🧊' : '📁'} 
                    {hasName ? node.name : <span style={{ fontStyle: 'italic' }}>Unnamed {node.type}</span>}
                </div>
            </div>
            
            {isExpanded && hasChildren && (
                <div style={{ borderLeft: '1px dashed var(--line)', marginLeft: '10px', paddingTop: '4px' }}>
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
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
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
                    child.material = new THREE.MeshStandardMaterial({ color: '#b08d57', emissive: '#b08d57', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (highlightUnassigned && !isClustered) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#d9534f', emissive: '#d9534f', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (highlightUnassigned && isClustered) {
                    child.material = new THREE.MeshBasicMaterial({ color: '#cccccc', transparent: true, opacity: 0.1 });
                } else if (isClustered) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#524e46', emissive: '#524e46', emissiveIntensity: 0.2, transparent: true, opacity: 0.9 });
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

    const handleToggleSelect = (nodeName) => {
        const targetNode = findNodeByName(sceneGraph, nodeName);
        const descendants = targetNode ? getAllNames(targetNode) : [nodeName];
        const ancestors = getAncestors(sceneGraph, nodeName);

        setSelectedNodes(prev => {
            const isCurrentlySelected = prev.includes(nodeName);
            if (isCurrentlySelected) {
                const toRemove = new Set([...descendants, ...ancestors]);
                return prev.filter(n => !toRemove.has(n));
            } else {
                return [...new Set([...prev, ...descendants])];
            }
        });
    };

    const handleToggleHide = (nodeName) => {
        const targetNode = findNodeByName(sceneGraph, nodeName);
        const descendants = targetNode ? getAllNames(targetNode) : [nodeName];
        const ancestors = getAncestors(sceneGraph, nodeName);

        setHiddenNodes(prev => {
            const isCurrentlyHidden = prev.includes(nodeName);
            if (isCurrentlyHidden) {
                const toRemove = new Set([...descendants, ...ancestors]);
                return prev.filter(n => !toRemove.has(n));
            } else {
                const toDeselect = new Set([...descendants, ...ancestors]);
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Extract Sub-Assemblies from Native CAD</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Node Grouping Studio</h2>
                </div>
                
                <div style={{ display: 'flex', gap: '20px', alignItems: 'center', background: 'var(--paper)', padding: '20px', border: '1px solid var(--line)' }}>
                    <div style={{ flex: 1.5 }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Search</label>
                        <input type="text" placeholder="Search Assembly Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Project</label>
                        <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', boxSizing: 'border-box' }}>
                            <option value="ALL">All Projects</option>
                            {availableProjects.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Status</label>
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', boxSizing: 'border-box' }}>
                            <option value="ALL">All Statuses</option>
                            <option value="NO_CAD">Awaiting CAD</option>
                            <option value="NEEDS_CLUSTERING">Needs Clustering</option>
                            <option value="CLUSTERED">Fully Clustered</option>
                        </select>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flex: 1 }}>
                
                {/* LEFT: ASSEMBLY SELECTOR */}
                <div style={{ width: '280px', display: 'flex', flexDirection: 'column', gap: '16px', flexShrink: 0, maxHeight: '800px', overflowY: 'auto' }}>
                    {filteredAssemblies.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '20px', fontFamily: 'var(--serif)', fontSize: '1.1rem' }}>No assemblies match criteria.</div>}
                    {filteredAssemblies.map(asm => {
                        const hasCAD = !!asm.manufacturingSpecs?.cadUrl;
                        const clusterCount = asm.nodeClusters?.length || 0;
                        
                        let statusColor = 'var(--ink-soft)';
                        let statusText = 'Awaiting CAD';
                        if (hasCAD) {
                            statusColor = clusterCount > 0 ? 'var(--brass)' : 'var(--ink)';
                            statusText = clusterCount > 0 ? `Clustered (${clusterCount})` : 'Needs Clustering';
                        }

                        return (
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedNodes([]); setSceneGraph(null); setHiddenNodes([]); setHighlightUnassigned(false); }} style={{ background: activeAssembly?.id === asm.id ? 'var(--paper-2)' : '#fff', border: activeAssembly?.id === asm.id ? '1px solid var(--brass)' : '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activeAssembly?.id === asm.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                                <div style={{ padding: '8px 12px', background: 'var(--paper)', color: statusColor, fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', textAlign: 'center', borderBottom: '1px solid var(--line)' }}>
                                    {statusText}
                                </div>
                                <div style={{ padding: '20px' }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)', marginTop: '8px' }}>{asm.itemName}</div>
                                </div>
                            </div>
                        )
                    })}
                </div>

                {/* CENTER & RIGHT PANEL */}
                {activeAssembly && activeAssembly.manufacturingSpecs?.cadUrl ? (
                    <div style={{ flex: 1, display: 'flex', gap: '24px', minHeight: '600px' }}>
                        
                        {/* 3D VIEWER */}
                        <div style={{ flex: 1.8, background: '#fff', border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', position: 'relative', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{ position: 'absolute', top: '20px', left: '20px', zIndex: 10, background: 'rgba(255,255,255,0.95)', padding: '16px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', letterSpacing: '.1em' }}>■ Current Selection</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>■ Clustered / Bound</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '4px', fontStyle: 'italic' }}>
                                    Tip: Right-click & drag to pan.
                                </div>
                            </div>

                            <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 10, display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'flex-end' }}>
                                <div style={{ display: 'flex', gap: '8px', background: '#fff', border: '1px solid var(--line)', padding: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                                    <button 
                                        onClick={() => setInteractionMode('select')} 
                                        style={{ padding: '8px 16px', background: interactionMode === 'select' ? 'var(--ink)' : 'transparent', color: interactionMode === 'select' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                    >
                                        Select
                                    </button>
                                    <button 
                                        onClick={() => setInteractionMode('hide')} 
                                        style={{ padding: '8px 16px', background: interactionMode === 'hide' ? 'var(--ink)' : 'transparent', color: interactionMode === 'hide' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                    >
                                        Hide Parts
                                    </button>
                                </div>
                                <button 
                                    onClick={() => setHighlightUnassigned(!highlightUnassigned)}
                                    style={{ padding: '10px 20px', background: highlightUnassigned ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', width: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                                >
                                    {highlightUnassigned ? 'Clear Highlight' : 'Highlight Unassigned'}
                                </button>

                                {hiddenNodes.length > 0 && (
                                    <button 
                                        onClick={() => setHiddenNodes([])}
                                        style={{ padding: '10px 20px', background: '#fff', color: 'var(--brass)', border: '1px solid var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', width: '100%', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}
                                    >
                                        Show All ({hiddenNodes.length} Hidden)
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

                        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            
                            <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', height: '400px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Native CAD Hierarchy</span>
                                </div>
                                <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#fff' }}>
                                    {!sceneGraph ? (
                                        <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>Parsing GLTF Nodes...</div>
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

                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Create Sub-Assembly</h3>
                                <div style={{ background: 'var(--paper)', padding: '16px', border: '1px solid var(--line)', marginBottom: '20px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)' }}>
                                    {selectedNodes.length} Nodes / Groups Selected
                                </div>
                                
                                <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Name This Cluster:</label>
                                <input 
                                    value={newClusterName} 
                                    onChange={e => setNewClusterName(e.target.value)} 
                                    placeholder="e.g. UPPER EXTENSION POLE"
                                    style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', marginBottom: '20px', fontFamily: 'var(--sans)', fontSize: '1rem', textTransform: 'uppercase' }}
                                />
                                
                                <button onClick={handleSaveCluster} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Save to Master File Cabinet</button>
                                <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '12px', textAlign: 'center' }}>
                                    Saving this cluster makes it instantly available to the BOM Engine.
                                </div>
                            </div>

                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', flex: 1, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <h3 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Saved BOM Bindings ({existingClusters.length})</h3>
                                {existingClusters.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>No meshes bound to BOM components yet.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {existingClusters.map(cl => (
                                        <div key={cl.id} style={{ border: '1px solid var(--line)', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', borderLeft: '2px solid var(--brass)' }}>
                                            <div>
                                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>{cl.name}</div>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: '6px' }}>{cl.nodes?.length || 0} Nodes Attached</div>
                                            </div>
                                            <button onClick={() => handleDeleteCluster(cl.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1rem', cursor: 'pointer' }}>Del</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                    </div>
                ) : activeAssembly && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '1px dashed var(--line)' }}>
                        <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.4rem' }}>Please upload a 3D CAD model to manage nodes.</div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default NodeClusterTab;