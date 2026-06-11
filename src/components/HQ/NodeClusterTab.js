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

// --- AUTO-GROUP HELPERS ---
// Fusion exports tag instances/versions onto node names: "1in Loop Bracket Ext. v4:2".
// Strip the :N instance, vN version, .00N clone, and _<hex> hash suffixes to get a
// clean human BOM name. Iterative because several can stack.
const cleanCadName = (raw) => {
    if (!raw) return raw || '';
    let s = String(raw), prev;
    do {
        prev = s;
        s = s.replace(/\s*:\d+$/, '')
             .replace(/\.\d{3,}$/, '')
             .replace(/_[0-9a-f]{6,}$/i, '')
             .replace(/\s*\bv\d+\b/gi, ' ')
             .trim();
    } while (s !== prev);
    return s.replace(/\s{2,}/g, ' ').replace(/\s*\.\s*$/, '').trim();
};

// Walk down single-child wrapper nodes (Scene -> RootNode -> "Assembly v5") until we
// reach the node whose children are the real top-level sub-assemblies.
const findAssemblyRoot = (scene) => {
    let root = scene;
    while (root.children && root.children.length === 1 &&
           root.children[0].children && root.children[0].children.length > 0) {
        root = root.children[0];
    }
    return root;
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
const SelectableModel = ({ url, selectedNodes, existingClusters, hiddenNodes, highlightUnassigned, onMeshClick, onLoaded, onComponents }) => {
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

    // Extract the top-level sub-assemblies for Auto-Group: each is a BOM component.
    // We capture every descendant node NAME (the cluster format) plus a world-space
    // center (Box3) so the parent can auto-label Left/Center/Right by geometry.
    useEffect(() => {
        if (!onComponents) return;
        clonedScene.updateMatrixWorld(true);
        const root = findAssemblyRoot(clonedScene);
        const comps = (root.children || []).map((child) => {
            const names = [];
            let meshCount = 0;
            child.traverse((o) => {
                if (o.name) names.push(o.name);
                if (o.isMesh) meshCount++;
            });
            let center = { x: 0, y: 0, z: 0 };
            try {
                const box = new THREE.Box3().setFromObject(child);
                if (!box.isEmpty()) {
                    const c = new THREE.Vector3();
                    box.getCenter(c);
                    center = { x: c.x, y: c.y, z: c.z };
                }
            } catch (e) { /* keep default center */ }
            return {
                uuid: child.uuid,
                name: child.name || '',
                nodes: [...new Set(names)],
                meshCount,
                isMesh: !!child.isMesh,
                center,
            };
        }).filter((c) => c.nodes.length > 0 || c.name);
        onComponents(comps);
    }, [clonedScene, onComponents]);

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

    // --- AUTO-GROUP STATE ---
    const [cadComponents, setCadComponents] = useState([]); // raw top-level subassemblies from the model
    const [showAutoPanel, setShowAutoPanel] = useState(false);
    const [splitByPosition, setSplitByPosition] = useState(true);
    const [autoChecked, setAutoChecked] = useState({});
    const [autoNames, setAutoNames] = useState({});

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

    // --- AUTO-GROUP PROPOSALS ---
    // Turn the raw CAD sub-assemblies into reviewable cluster proposals: clean name,
    // auto Left/Center/Right label (by geometry along the assembly's longest axis),
    // and flags for anything questionable.
    const autoProposals = useMemo(() => {
        if (!cadComponents.length) return [];

        // Dominant spread axis across all components (the pole runs along this axis).
        const axes = ['x', 'y', 'z'];
        const spread = axes.map(a => {
            const vs = cadComponents.map(c => c.center[a]);
            return Math.max(...vs) - Math.min(...vs);
        });
        const axis = axes[spread.indexOf(Math.max(...spread))];

        const overlapsExisting = (nodes) =>
            existingClusters.find(cl => (cl.nodes || []).some(n => nodes.includes(n)));

        // Group components by clean base name to detect repeated instances.
        const byBase = {};
        cadComponents.forEach(c => {
            const base = cleanCadName(c.name) || c.name || 'UNNAMED';
            (byBase[base] = byBase[base] || []).push(c);
        });

        const positionLabel = (group, c) => {
            if (group.length < 2) return '';
            const sorted = [...group].sort((a, b) => a.center[axis] - b.center[axis]);
            const idx = sorted.indexOf(c);
            if (group.length === 2) return idx === 0 ? 'LEFT' : 'RIGHT';
            if (group.length === 3) return ['LEFT', 'CENTER', 'RIGHT'][idx];
            return `#${idx + 1}`;
        };

        const flagsFor = (nodes, meshCount, name, isMesh) => {
            const f = [];
            if (!name) f.push('Unnamed node — name it before saving');
            if (isMesh && /^body\d/i.test(name || '')) f.push('Loose geometry (generic mesh, not a named sub-assembly)');
            if (!meshCount) f.push('No visible geometry');
            const ex = overlapsExisting(nodes);
            if (ex) f.push(`Already in cluster "${ex.name}"`);
            return f;
        };

        if (splitByPosition) {
            // One proposal per instance, with a position label.
            return cadComponents.map(c => {
                const base = cleanCadName(c.name) || c.name || 'UNNAMED';
                const pos = positionLabel(byBase[base], c);
                // Style-option detection: another component at (nearly) the same spot
                // with a different base name = an alternate "Choose/Swap" option.
                const eps = (Math.max(...spread) || 1) * 0.04;
                const overlapOptions = cadComponents.filter(o =>
                    o.uuid !== c.uuid &&
                    (cleanCadName(o.name) || o.name) !== base &&
                    Math.hypot(o.center.x - c.center.x, o.center.y - c.center.y, o.center.z - c.center.z) < eps
                ).length;
                const flags = flagsFor(c.nodes, c.meshCount, c.name, c.isMesh);
                if (overlapOptions > 0) flags.push(`Shares position with ${overlapOptions} other part(s) — likely a Choose/Swap style option`);
                return {
                    id: `AUTO-${c.uuid}`,
                    base,
                    pos,
                    suggestedName: pos ? `${base} — ${pos}` : base,
                    nodes: c.nodes,
                    meshCount: c.meshCount,
                    flags,
                    alreadyGrouped: flags.some(x => x.startsWith('Already in')),
                };
            });
        }

        // Merge: one proposal per base name (all instances combined).
        return Object.entries(byBase).map(([base, group]) => {
            const nodes = [...new Set(group.flatMap(g => g.nodes))];
            const meshCount = group.reduce((s, g) => s + g.meshCount, 0);
            const flags = flagsFor(nodes, meshCount, base, false);
            if (group.length > 1) flags.push(`${group.length} instances merged into one cluster`);
            return {
                id: `AUTO-${base.replace(/\s+/g, '_')}`,
                base,
                pos: '',
                suggestedName: base,
                nodes,
                meshCount,
                flags,
                alreadyGrouped: flags.some(x => x.startsWith('Already in')),
            };
        });
    }, [cadComponents, splitByPosition, existingClusters]);

    // Initialise checkboxes + editable names whenever the proposal set changes.
    useEffect(() => {
        const checked = {};
        const names = {};
        autoProposals.forEach(p => {
            checked[p.id] = !p.alreadyGrouped && p.meshCount > 0;
            names[p.id] = p.suggestedName;
        });
        setAutoChecked(checked);
        setAutoNames(names);
    }, [autoProposals]);

    const handleAutoSaveSelected = async () => {
        const chosen = autoProposals.filter(p => autoChecked[p.id]);
        if (chosen.length === 0) return alert("No proposals are selected.");
        const stamp = Date.now();
        const newClusters = chosen.map((p, i) => ({
            id: `CLUSTER-${stamp}-${i}`,
            name: (autoNames[p.id] || p.suggestedName).toUpperCase().trim(),
            nodes: p.nodes,
        }));
        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), {
                nodeClusters: [...existingClusters, ...newClusters],
            });
            setShowAutoPanel(false);
            setSelectedNodes([]);
        } catch (err) { console.error(err); alert("Failed to save auto-groups."); }
    };

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
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedNodes([]); setSceneGraph(null); setHiddenNodes([]); setHighlightUnassigned(false); setCadComponents([]); setShowAutoPanel(false); }} style={{ background: activeAssembly?.id === asm.id ? 'var(--paper-2)' : '#fff', border: activeAssembly?.id === asm.id ? '1px solid var(--brass)' : '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activeAssembly?.id === asm.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
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
                                    onClick={() => setShowAutoPanel(true)}
                                    disabled={cadComponents.length === 0}
                                    title={cadComponents.length === 0 ? 'Waiting for the model to finish loading…' : 'Auto-detect sub-assemblies from the CAD hierarchy'}
                                    style={{ padding: '12px 20px', background: cadComponents.length === 0 ? 'var(--paper-2)' : 'var(--brass)', color: cadComponents.length === 0 ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: cadComponents.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', width: '100%', fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                                >
                                    ⚡ Auto-Group ({cadComponents.length})
                                </button>
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
                                        onComponents={setCadComponents}
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

            {/* AUTO-GROUP REVIEW MODAL */}
            {showAutoPanel && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }} onClick={() => setShowAutoPanel(false)}>
                    <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', width: '760px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', borderRadius: '2px' }}>
                        {/* Header */}
                        <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Auto-Trace from CAD Hierarchy</span>
                                    <h2 style={{ margin: '4px 0 0 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Review Proposed Sub-Assemblies</h2>
                                </div>
                                <button onClick={() => setShowAutoPanel(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '16px' }}>
                                <div style={{ display: 'flex', border: '1px solid var(--line)', background: '#fff' }}>
                                    <button onClick={() => setSplitByPosition(true)} style={{ padding: '8px 14px', background: splitByPosition ? 'var(--ink)' : 'transparent', color: splitByPosition ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Split by Position</button>
                                    <button onClick={() => setSplitByPosition(false)} style={{ padding: '8px 14px', background: !splitByPosition ? 'var(--ink)' : 'transparent', color: !splitByPosition ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Merge Instances</button>
                                </div>
                                <div style={{ display: 'flex', gap: '10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                    <button onClick={() => setAutoChecked(Object.fromEntries(autoProposals.map(p => [p.id, true])))} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer' }}>Select all</button>
                                    <span style={{ color: 'var(--line)' }}>|</span>
                                    <button onClick={() => setAutoChecked({})} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer' }}>None</button>
                                </div>
                            </div>
                        </div>
                        {/* List */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
                            {autoProposals.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>No sub-assemblies detected in this model.</div>}
                            {autoProposals.map(p => {
                                const on = !!autoChecked[p.id];
                                return (
                                    <div key={p.id} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', padding: '14px 0', borderBottom: '1px solid var(--line)', opacity: on ? 1 : 0.55 }}>
                                        <input type="checkbox" checked={on} onChange={(e) => setAutoChecked(prev => ({ ...prev, [p.id]: e.target.checked }))} style={{ marginTop: '12px', width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brass)' }} />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                <input value={autoNames[p.id] ?? p.suggestedName} onChange={(e) => setAutoNames(prev => ({ ...prev, [p.id]: e.target.value }))} style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', textTransform: 'uppercase', outline: 'none' }} />
                                                {p.pos && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', background: 'var(--paper-2)', color: 'var(--brass)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>{p.pos}</span>}
                                            </div>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                                {p.nodes.length} nodes · {p.meshCount} mesh{p.meshCount === 1 ? '' : 'es'}
                                            </div>
                                            {p.flags.map((f, i) => (
                                                <div key={i} style={{ fontSize: '0.78rem', color: f.startsWith('Already') ? 'var(--ink-soft)' : '#b9770e', marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                    <span>⚠</span><span>{f}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {/* Footer */}
                        <div style={{ padding: '20px 28px', borderTop: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                {autoProposals.filter(p => autoChecked[p.id]).length} of {autoProposals.length} selected
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button onClick={() => setShowAutoPanel(false)} style={{ padding: '14px 24px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Cancel</button>
                                <button onClick={handleAutoSaveSelected} style={{ padding: '14px 28px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save Selected as Clusters</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NodeClusterTab;