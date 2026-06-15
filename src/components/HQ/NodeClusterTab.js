import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, getDoc, getDocs } from "firebase/firestore";
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
    // Handle BOTH raw glb names ("1in Loop Bracket Ext. v4:1") and sanitized exports
    // ("1in_Loop_Bracket_Ext_v41"). Normalizing underscores to spaces first lets the
    // version/instance suffix (v4, v41) strip cleanly so repeats collapse to one base
    // name and get grouped into Left/Center/Right.
    let s = String(raw).replace(/_/g, ' '), prev;
    do {
        prev = s;
        s = s.replace(/\s*:\d+$/, '')
             .replace(/\.\d{3,}$/, '')
             .replace(/\s+[0-9a-f]{6,}$/i, '')
             .replace(/\s*\bv\d+\b/gi, ' ')
             .trim();
    } while (s !== prev);
    return s.replace(/\s{2,}/g, ' ').replace(/\s*\.\s*$/, '').trim();
};

// Assistive default for the region "Location" tag (Wall / Ceiling / End). Guesses from the
// part code / words in the name; returns '' (user tags it) when ambiguous, e.g. shared
// backplates that live at both wall and ceiling positions. Purely a pre-fill — overridable.
const guessLocation = (s) => {
    const t = String(s || '').toUpperCase();
    if (/\bFIW|\bWALL\b/.test(t)) return 'WALL';
    if (/\bFIC|CEIL/.test(t)) return 'CEILING';
    if (/\bFIIM|\bEND\b|INSIDE\s*MOUNT/.test(t)) return 'END';
    return '';
};
const LOCATIONS = ['WALL', 'CEILING', 'END'];
const POSITIONS = ['LEFT', 'CENTER', 'RIGHT'];
// Library-driven categorization. The Auto-Group tool matches each node to a library
// component (by name / ERP id), then reads its productType + bracket mount to pre-fill
// the group's Category (Bracket / Pole / Finial) and — for brackets — its Location.
const CATEGORIES = ['BRACKET', 'POLE', 'FINIAL', 'BACKPLATE'];
// Normalize any name / id to a comparable key (drop case, spaces, punctuation).
const normKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Bucket a library productType string into one of our categories.
const classifyCategory = (pt) => {
    const t = String(pt || '').toUpperCase();
    if (t.includes('BACKPLATE') || t.includes('BACK PLATE') || t.includes('BACK-PLATE')) return 'BACKPLATE';
    if (t.includes('BRACKET')) return 'BRACKET';
    if (t.includes('FINIAL')) return 'FINIAL';
    if (t.includes('POLE') || t.includes('ROD')) return 'POLE';
    return '';
};
// A bracket's mount type -> region Location (inside-mount = end of the pole). Non-brackets: ''.
const bracketLocation = (productType, bracketType) => {
    if (!String(productType || '').toUpperCase().includes('BRACKET')) return '';
    const t = String(bracketType || '').toUpperCase();
    if (t.includes('CEIL')) return 'CEILING';
    if (t.includes('WALL')) return 'WALL';
    if (t.includes('INSIDE') || t.includes('END') || /\bIM\b/.test(t)) return 'END';
    return '';
};
// Name-only fallback when no library item matches.
const guessCategory = (s) => classifyCategory(s);
// Best library component for a group's candidate names (its clean base name + node names).
// Exact id/name match wins; otherwise a containment overlap above 0.5 is accepted. Returns
// the matched item plus the derived category/location, or null when nothing aligns.
const matchLibrary = (candidates, libraryIndex) => {
    const cks = [...new Set(candidates.map(normKey).filter(k => k && k.length >= 3))];
    if (!cks.length || !libraryIndex.length) return null;
    let best = null;
    for (const entry of libraryIndex) {
        for (const k of entry.keys) {
            for (const c of cks) {
                let score = 0;
                if (k === c) score = 1;
                else if (k.length >= 4 && c.length >= 4 && (k.includes(c) || c.includes(k))) {
                    score = Math.min(k.length, c.length) / Math.max(k.length, c.length);
                }
                if (score > (best ? best.score : 0)) best = { entry, score, exact: k === c };
            }
        }
    }
    if (!best || best.score < 0.5) return null;
    const e = best.entry;
    return {
        item: e.part, itemName: e.itemName, productType: e.productType, bracketType: e.bracketType,
        category: classifyCategory(e.productType), location: bracketLocation(e.productType, e.bracketType),
        exact: best.exact, score: best.score,
    };
};
// Distinct, evenly-spread hue per group index — lets the Auto-Group panel paint every
// proposed group its own color in the 3D so the whole grouping reads at a glance.
const GROUP_COLOR = (i) => `hsl(${(i * 57) % 360}, 70%, 55%)`;
// Region label shown in the flow builder, composed from the tags (the cluster name itself
// stays part-based so BOM Auto-Assign keeps matching). e.g. {location:'WALL',position:'LEFT'} -> "WALL · LEFT".
export const regionLabel = (cl) => [cl.location, cl.position].filter(Boolean).join(' · ') || 'UNGROUPED';

// Normalize a node name for cross-cluster matching. Older clusters stored sanitized
// names ("1in_Loop_Bracket_Ext_v41", "Body1017"); Auto-Group stores raw glb names
// ("1in Loop Bracket Ext. v4:1", "Body1.017"). Sanitizing both sides lets us tell when
// a new proposal covers the same geometry as an existing cluster, regardless of format.
const sanitizeNodeName = (n) => String(n || '').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');

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
const SelectableModel = ({ url, selectedNodes, existingClusters, hiddenNodes, highlightUnassigned, locatingNodes = [], colorGroups = [], onMeshClick, onHoverMesh, onLoaded, onComponents }) => {
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
            if (!Array.isArray(nodeNameList) || nodeNameList.length === 0) return false; // skip clusters with no node list
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

                // Locate mode: isolate one saved cluster — light it up, fade everything else.
                if (locatingNodes.length > 0) {
                    if (isDescendantOf(child, locatingNodes)) {
                        child.material = new THREE.MeshStandardMaterial({ color: '#b08d57', emissive: '#b08d57', emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
                    } else {
                        child.material = new THREE.MeshBasicMaterial({ color: '#cccccc', transparent: true, opacity: 0.12 });
                    }
                    return;
                }

                // Color-all-groups mode: paint each proposed group its own color so the whole
                // grouping is visible at a glance. Unassigned meshes fade out.
                if (colorGroups.length > 0) {
                    const g = colorGroups.find(grp => isDescendantOf(child, grp.nodes));
                    if (g) {
                        child.material = new THREE.MeshStandardMaterial({ color: g.color, emissive: g.color, emissiveIntensity: 0.4, transparent: true, opacity: 0.95 });
                    } else {
                        child.material = new THREE.MeshBasicMaterial({ color: '#cccccc', transparent: true, opacity: 0.12 });
                    }
                    return;
                }

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
    }, [clonedScene, selectedNodes, existingClusters, hiddenNodes, highlightUnassigned, locatingNodes, colorGroups]);

    return (
        <primitive 
            object={clonedScene} 
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'crosshair'; }}
            onPointerMove={onHoverMesh ? (e) => { e.stopPropagation(); onHoverMesh(e.object.name || (e.object.parent && e.object.parent.name) || null); } : undefined}
            onPointerOut={(e) => { e.stopPropagation(); document.body.style.cursor = 'auto'; if (onHoverMesh) onHoverMesh(null); }}
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
    const [libraryParts, setLibraryParts] = useState([]); // inventory components, for library category matching
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
    const [locatingClusterId, setLocatingClusterId] = useState(null); // visual confirm: isolate a saved cluster in 3D
    const [hoveredClusterId, setHoveredClusterId] = useState(null); // hover a saved cluster row -> glow its meshes

    // --- AUTO-GROUP STATE ---
    const [cadComponents, setCadComponents] = useState([]); // raw top-level subassemblies from the model
    const [showAutoPanel, setShowAutoPanel] = useState(false);
    const [splitByPosition, setSplitByPosition] = useState(true);
    const [autoChecked, setAutoChecked] = useState({});
    const [autoNames, setAutoNames] = useState({});
    const [autoLocations, setAutoLocations] = useState({}); // proposalId -> 'WALL'|'CEILING'|'END'|''
    const [autoCategories, setAutoCategories] = useState({}); // proposalId -> 'BRACKET'|'POLE'|'FINIAL'|''
    const [showGroupColors, setShowGroupColors] = useState(false); // optional: paint every proposed group its own color (off by default — hover to glow instead)
    const [hoveredProposalId, setHoveredProposalId] = useState(null); // hover a part / row -> glow that group
    const [previewProposalId, setPreviewProposalId] = useState(null); // click a part / row -> isolate that group
    const [activeProposalId, setActiveProposalId] = useState(null);   // group being edited: 3D clicks add/remove parts
    const [proposalNodeOverrides, setProposalNodeOverrides] = useState({}); // proposalId -> edited node list

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"), where("partClass", "in", ["Assembly", "Master Assembly"]));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Only MAIN assemblies belong here — sub-assemblies / components (e.g. screws) are
            // grouped via their own main assembly, not on their own. Mirrors the BOM Engine.
            docs = docs.filter(d => (d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand))) && (d.routingType || '').toUpperCase() === 'MAIN');
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

    // Library components (brackets / poles / finials) used to categorize nodes: match a
    // node's name / ERP id to a library item, then read its productType + bracketType.
    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory"));
        const unsub = onSnapshot(q, (snap) => {
            const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            setLibraryParts(docs);
        });
        return () => unsub();
    }, [activeBrand]);

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
        if (showAutoPanel) return handleAutoMeshClick(nodeName);
        if (interactionMode === "hide") handleToggleHide(nodeName);
        else handleToggleSelect(nodeName);
    };

    const handleSaveCluster = async () => {
        if (!newClusterName.trim()) return alert("Please enter a name for this Sub-Assembly/Cluster.");
        if (selectedNodes.length === 0) return alert("Please select at least one 3D Node or Mesh.");

        const newCluster = {
            id: `CLUSTER-${Date.now()}`,
            name: newClusterName.toUpperCase().trim(),
            nodes: selectedNodes
        };

        try {
            // Re-read the latest clusters first so adding one can't wipe Location/Position tags set elsewhere.
            const ref = doc(db, "Approved_Designs", activeAssembly.id);
            const snap = await getDoc(ref);
            const currentClusters = (snap.exists() ? snap.data().nodeClusters : activeAssembly.nodeClusters) || [];
            await updateDoc(ref, { nodeClusters: [...currentClusters, newCluster] });
            setNewClusterName("");
            setSelectedNodes([]);
        } catch (err) { console.error(err); alert("Failed to save cluster."); }
    };

    // Re-tag one cluster field without re-running Auto-Group. Re-reads the latest clusters first
    // (not the possibly-stale prop) so a second tab / rapid clicks can't clobber other edits — and
    // every other field (nodes, name, the other tag) is preserved via spread.
    const setClusterField = async (clusterId, patch) => {
        try {
            const ref = doc(db, "Approved_Designs", activeAssembly.id);
            const snap = await getDoc(ref);
            const updated = ((snap.exists() ? snap.data().nodeClusters : activeAssembly.nodeClusters) || []).map(c => c.id === clusterId ? { ...c, ...patch } : c);
            await updateDoc(ref, { nodeClusters: updated });
        } catch (err) { console.error(err); }
    };
    const handleSetClusterLocation = (clusterId, location) => setClusterField(clusterId, { location });
    const handleSetClusterPosition = (clusterId, position) => setClusterField(clusterId, { position });
    const handleSetClusterCategory = (clusterId, category) => setClusterField(clusterId, { category });

    // Stage 0a — empty ALL clusters on this assembly to re-group from scratch. Double-confirmed
    // and warns if generated CPQ flows depend on it; never auto-runs.
    const handleClearAllClusters = async () => {
        if (!activeAssembly) return;
        const count = existingClusters.length;
        if (!count) return alert("No clusters to clear.");
        let flowWarn = '';
        try {
            const fsnap = await getDocs(query(collection(db, "cpq_flows"), where("linkedAssemblyId", "==", activeAssembly.id)));
            if (!fsnap.empty) flowWarn = `\n\n⚠ ${fsnap.size} generated CPQ flow(s) link to this assembly and will stop rendering until you re-group + regenerate.`;
        } catch (e) { /* non-fatal: still confirm below */ }
        if (!window.confirm(`Clear ALL ${count} clusters on "${activeAssembly.itemName}"?${flowWarn}\n\nThis empties nodeClusters and cannot be undone. Do NOT do this if a live customer quote/draft points at this assembly.`)) return;
        if (!window.confirm(`Last chance — permanently clear all ${count} clusters?`)) return;
        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: [] });
            setLocatingClusterId(null);
            setHoveredClusterId(null);
            setSelectedNodes([]);
        } catch (err) { console.error(err); alert("Failed to clear clusters."); }
    };

    const handleDeleteCluster = async (clusterId) => {
        if (!window.confirm("Delete this grouping? The meshes will return to being unassigned.")) return;
        try {
            const ref = doc(db, "Approved_Designs", activeAssembly.id);
            const snap = await getDoc(ref);
            const updatedClusters = ((snap.exists() ? snap.data().nodeClusters : activeAssembly.nodeClusters) || []).filter(c => c.id !== clusterId);
            await updateDoc(ref, { nodeClusters: updatedClusters });
        } catch (err) { console.error(err); }
    };

    const existingClusters = activeAssembly?.nodeClusters || [];
    const locatingNodes = existingClusters.find(c => c.id === locatingClusterId)?.nodes || [];
    const hoveredClusterNodes = existingClusters.find(c => c.id === hoveredClusterId)?.nodes || [];

    // Normalized lookup of library components for fast name / ERP matching.
    const libraryIndex = useMemo(() => libraryParts.map(part => {
        const specs = part.manufacturingSpecs || {};
        const productType = (specs.productType || part.productType || '').toString().toUpperCase();
        const bracketType = (specs.customData?.bracketType || '').toString().toUpperCase();
        return {
            part, itemName: part.itemName || '', productType, bracketType,
            keys: [normKey(part.legacyErpId), normKey(part.itemId), normKey(part.itemName)].filter(k => k && k !== 'PENDING'),
        };
    }), [libraryParts]);

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

        let proposals;
        if (splitByPosition) {
            // One proposal per instance, with a position label.
            proposals = cadComponents.map(c => {
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
                const library = matchLibrary([base, ...(c.nodes || []).map(cleanCadName)], libraryIndex);
                return {
                    id: `AUTO-${c.uuid}`,
                    base,
                    pos,
                    suggestedName: pos ? `${base} — ${pos}` : base,
                    nodes: c.nodes,
                    meshCount: c.meshCount,
                    flags,
                    alreadyGrouped: flags.some(x => x.startsWith('Already in')),
                    center: c.center,
                    guessedLocation: (library && library.location) || guessLocation(base),
                    guessedCategory: (library && library.category) || guessCategory(base),
                    library,
                };
            });
        } else {
            // Merge: one proposal per base name (all instances combined).
            proposals = Object.entries(byBase).map(([base, group]) => {
            const nodes = [...new Set(group.flatMap(g => g.nodes))];
            const meshCount = group.reduce((s, g) => s + g.meshCount, 0);
            const flags = flagsFor(nodes, meshCount, base, false);
            if (group.length > 1) flags.push(`${group.length} instances merged into one cluster`);
            const center = ['x', 'y', 'z'].reduce((o, a) => ({ ...o, [a]: group.reduce((s, g) => s + g.center[a], 0) / group.length }), {});
            const library = matchLibrary([base, ...nodes.map(cleanCadName)], libraryIndex);
            return {
                id: `AUTO-${base.replace(/\s+/g, '_')}`,
                base,
                pos: '',
                suggestedName: base,
                nodes,
                meshCount,
                flags,
                alreadyGrouped: flags.some(x => x.startsWith('Already in')),
                center,
                guessedLocation: (library && library.location) || guessLocation(base),
                guessedCategory: (library && library.category) || guessCategory(base),
                library,
            };
            });
        }

        // Backplates have no intrinsic wall/ceiling — they assemble onto a bracket arm.
        // Give each backplate the Location of the geometrically nearest LOCATED bracket
        // (wall arm -> WALL, ceiling arm -> CEILING), overriding any name-based guess.
        const locatedBrackets = proposals.filter(b => b.guessedCategory === 'BRACKET' && b.guessedLocation && b.center);
        if (locatedBrackets.length) {
            proposals.forEach(p => {
                if (p.guessedCategory !== 'BACKPLATE' || !p.center) return;
                let best = null, bestD = Infinity;
                locatedBrackets.forEach(b => {
                    const d = Math.hypot((p.center.x || 0) - (b.center.x || 0), (p.center.y || 0) - (b.center.y || 0), (p.center.z || 0) - (b.center.z || 0));
                    if (d < bestD) { bestD = d; best = b; }
                });
                if (best) { p.guessedLocation = best.guessedLocation; p.inheritedFrom = { base: best.base, location: best.guessedLocation }; }
            });
        }
        return proposals;
    }, [cadComponents, splitByPosition, existingClusters, libraryIndex]);

    // Initialise checkboxes + editable names whenever the proposal set changes.
    useEffect(() => {
        const checked = {};
        const names = {};
        const locs = {};
        const cats = {};
        autoProposals.forEach(p => {
            checked[p.id] = !p.alreadyGrouped && p.meshCount > 0;
            names[p.id] = p.suggestedName;
            // Pre-fill location + category: an existing cluster's saved tags (re-run keeps them),
            // else the library match, else the name-based guess.
            const matched = existingClusters.find(c => (c.nodes || []).some(n => p.nodes.includes(n)));
            locs[p.id] = (matched && matched.location) || p.guessedLocation || '';
            cats[p.id] = (matched && matched.category) || p.guessedCategory || '';
        });
        setAutoChecked(checked);
        setAutoNames(names);
        setAutoLocations(locs);
        setAutoCategories(cats);
        setProposalNodeOverrides({});
        setActiveProposalId(null);
        setPreviewProposalId(null);
    }, [autoProposals, existingClusters]);

    // Match each selected proposal to an existing cluster by sanitized node overlap so
    // re-running Auto-Group REPLACES the old grouping in place (reusing its id) instead
    // of appending a duplicate. Reusing the id means assembly_pins stay linked and pick
    // up the refreshed name/label automatically — no re-assigning needed.
    const autoSavePlan = useMemo(() => {
        const chosen = autoProposals.filter(p => autoChecked[p.id]);
        const sanSets = existingClusters.map(c => new Set((c.nodes || []).map(sanitizeNodeName)));
        const claimed = new Set();
        const plan = chosen.map(p => {
            const pset = new Set((proposalNodeOverrides[p.id] || p.nodes).map(sanitizeNodeName));
            let bestIdx = -1, bestScore = 0;
            existingClusters.forEach((c, idx) => {
                if (claimed.has(idx)) return;
                const cs = sanSets[idx];
                let shared = 0;
                pset.forEach(n => { if (cs.has(n)) shared++; });
                const score = shared / Math.max(1, Math.min(pset.size, cs.size));
                if (score > bestScore) { bestScore = score; bestIdx = idx; }
            });
            let matchedId = null;
            if (bestIdx >= 0 && bestScore >= 0.6) { claimed.add(bestIdx); matchedId = existingClusters[bestIdx].id; }
            return { p, matchedId, name: (autoNames[p.id] || p.suggestedName).toUpperCase().trim() };
        });
        return { plan, replaceCount: plan.filter(x => x.matchedId).length, newCount: plan.filter(x => !x.matchedId).length };
    }, [autoProposals, autoChecked, autoNames, existingClusters, proposalNodeOverrides]);

    const handleAutoSaveSelected = async () => {
        const { plan } = autoSavePlan;
        if (plan.length === 0) return alert("No proposals are selected.");
        const stamp = Date.now();
        const updatedById = {};
        const additions = [];
        plan.forEach((x, i) => {
            // Region tags travel with the cluster (the name stays part-based for BOM Auto-Assign).
            const region = { position: x.p.pos || '', location: autoLocations[x.p.id] || '', category: autoCategories[x.p.id] || '', center: x.p.center || null };
            const savedNodes = proposalNodeOverrides[x.p.id] || x.p.nodes; // honor hand-edits
            if (x.matchedId) {
                const ex = existingClusters.find(c => c.id === x.matchedId);
                updatedById[x.matchedId] = { ...ex, name: x.name, nodes: savedNodes, ...region };
            } else {
                additions.push({ id: `CLUSTER-${stamp}-${i}`, name: x.name, nodes: savedNodes, ...region });
            }
        });
        const merged = existingClusters.map(c => updatedById[c.id] || c).concat(additions);
        try {
            await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: merged });
            setShowAutoPanel(false);
            setSelectedNodes([]);
            setPreviewProposalId(null);
            setActiveProposalId(null);
        } catch (err) { console.error(err); alert("Failed to save auto-groups."); }
    };

    // A proposal's CURRENT node set = its hand-edited override (if any) else the auto-derived nodes.
    const nodesOf = (p) => proposalNodeOverrides[p.id] || p.nodes || [];
    // Stable color per proposal (by its index), and the color-group set fed to the 3D when
    // "Color groups" is on — only the CHECKED proposals get painted; the rest fade.
    const proposalColor = (p) => GROUP_COLOR(autoProposals.indexOf(p));
    const colorGroups = useMemo(
        () => autoProposals.filter(p => autoChecked[p.id]).map(p => ({ nodes: proposalNodeOverrides[p.id] || p.nodes, color: GROUP_COLOR(autoProposals.indexOf(p)) })),
        [autoProposals, autoChecked, proposalNodeOverrides]
    );
    // Reveal mode isolates one clicked group; edit mode keeps every group colored (so you can
    // grab a part from any group), so don't isolate while editing.
    // What glows in the 3D: the group you're editing, else the one you're hovering (row or
    // part), else the one you clicked to lock. Everything else keeps its natural material —
    // no always-on colors, so the glow alone confirms a grouping at a glance.
    const glowProposalId = activeProposalId || hoveredProposalId || previewProposalId;
    const glowProposal = autoProposals.find(p => p.id === glowProposalId);
    const glowNodes = glowProposal ? nodesOf(glowProposal) : [];

    // Hover a 3D mesh -> glow its owning group (skipped while editing, where clicks add/remove).
    const handleAutoMeshHover = (nodeName) => {
        if (activeProposalId) return;
        if (!nodeName) { setHoveredProposalId(prev => (prev === null ? prev : null)); return; }
        const target = findNodeByName(sceneGraph, nodeName);
        const sub = new Set(target ? getAllNames(target) : [nodeName]);
        const owner = autoProposals.find(p => nodesOf(p).some(n => sub.has(n)));
        const id = owner ? owner.id : null;
        setHoveredProposalId(prev => (prev === id ? prev : id));
    };

    // 3D mesh clicks while the Auto-Group panel is open: in edit mode, add/remove the part
    // to/from the active group (a part belongs to one group); otherwise reveal its group.
    const handleAutoMeshClick = (nodeName) => {
        const target = findNodeByName(sceneGraph, nodeName);
        const subtree = target ? getAllNames(target) : [nodeName];
        const sub = new Set(subtree);
        if (activeProposalId) {
            setProposalNodeOverrides(prev => {
                const next = { ...prev };
                const active = autoProposals.find(p => p.id === activeProposalId);
                const activeNodes = new Set(next[activeProposalId] || (active ? active.nodes : []));
                const allIn = subtree.every(n => activeNodes.has(n));
                if (allIn) {
                    subtree.forEach(n => activeNodes.delete(n)); // toggle off
                } else {
                    subtree.forEach(n => activeNodes.add(n));
                    autoProposals.forEach(p => { // a part lives in one group — pull it out of the others
                        if (p.id === activeProposalId) return;
                        const pn = next[p.id] || p.nodes;
                        if (pn.some(n => sub.has(n))) next[p.id] = pn.filter(n => !sub.has(n));
                    });
                }
                next[activeProposalId] = [...activeNodes];
                return next;
            });
        } else {
            const owner = autoProposals.find(p => nodesOf(p).some(n => sub.has(n)));
            if (owner) setPreviewProposalId(owner.id);
        }
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
                            <div key={asm.id} onClick={() => { setActiveAssembly(asm); setSelectedNodes([]); setSceneGraph(null); setHiddenNodes([]); setHighlightUnassigned(false); setCadComponents([]); setShowAutoPanel(false); setLocatingClusterId(null); }} style={{ background: activeAssembly?.id === asm.id ? 'var(--paper-2)' : '#fff', border: activeAssembly?.id === asm.id ? '1px solid var(--brass)' : '1px solid var(--line)', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activeAssembly?.id === asm.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
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
                                {showAutoPanel ? (
                                    <>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', letterSpacing: '.1em' }}>Hover to confirm a group</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '4px', fontStyle: 'italic', maxWidth: '200px' }}>
                                            {activeProposalId ? 'Editing — click parts to add/remove them from the highlighted group.' : 'Hover a part or a row to glow its whole group · click to lock · ✎ Edit to move parts.'}
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', letterSpacing: '.1em' }}>■ Current Selection</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>■ Clustered / Bound</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', borderTop: '1px solid var(--line)', paddingTop: '8px', marginTop: '4px', fontStyle: 'italic' }}>
                                            Tip: Right-click & drag to pan.
                                        </div>
                                    </>
                                )}
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
                                        locatingNodes={(showAutoPanel && glowNodes.length) ? glowNodes : (hoveredClusterNodes.length ? hoveredClusterNodes : locatingNodes)}
                                        colorGroups={showAutoPanel && showGroupColors && !glowNodes.length ? colorGroups : []}
                                        onHoverMesh={showAutoPanel ? handleAutoMeshHover : undefined}
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
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Saved BOM Bindings ({existingClusters.length})</h3>
                                    {existingClusters.length > 0 && (
                                        <button onClick={handleClearAllClusters} title="Empty ALL clusters on this assembly and start grouping from scratch" style={{ background: '#fff', color: '#d9534f', border: '1px solid #d9534f', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer' }}>Clear all</button>
                                    )}
                                </div>
                                {existingClusters.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>No meshes bound to BOM components yet.</div>}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                    {existingClusters.map(cl => {
                                        const isLocating = locatingClusterId === cl.id;
                                        return (
                                        <div key={cl.id} onMouseEnter={() => setHoveredClusterId(cl.id)} onMouseLeave={() => setHoveredClusterId(prev => prev === cl.id ? null : prev)} style={{ border: `1px solid ${(isLocating || hoveredClusterId === cl.id) ? 'var(--brass)' : 'var(--line)'}`, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: isLocating ? 'var(--paper-2)' : 'var(--paper)', borderLeft: '2px solid var(--brass)' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 500, color: 'var(--ink)', fontSize: '1rem' }}>{cl.name}</div>
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: '6px' }}>
                                                    {cl.category && <span style={{ color: 'var(--ink)', background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '1px 5px', marginRight: '8px' }}>{cl.category}</span>}{(cl.location || cl.position) && <span style={{ color: 'var(--brass)', marginRight: '8px' }}>{regionLabel(cl)}</span>}{cl.nodes?.length || 0} Nodes
                                                </div>
                                                {/* Re-tag region location + position without re-running Auto-Group */}
                                                <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
                                                    {LOCATIONS.map(L => (
                                                        <button key={L} onClick={() => handleSetClusterLocation(cl.id, cl.location === L ? '' : L)} style={{ padding: '3px 8px', background: cl.location === L ? 'var(--ink)' : '#fff', color: cl.location === L ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{L}</button>
                                                    ))}
                                                </div>
                                                <div style={{ display: 'flex', gap: '5px', marginTop: '5px' }}>
                                                    {POSITIONS.map(P => (
                                                        <button key={P} onClick={() => handleSetClusterPosition(cl.id, cl.position === P ? '' : P)} style={{ padding: '3px 8px', background: cl.position === P ? 'var(--brass)' : '#fff', color: cl.position === P ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{P}</button>
                                                    ))}
                                                </div>
                                                {/* Re-tag category (was write-once from Auto-Group) */}
                                                <div style={{ display: 'flex', gap: '5px', marginTop: '5px', flexWrap: 'wrap' }}>
                                                    {CATEGORIES.map(C => (
                                                        <button key={C} onClick={() => handleSetClusterCategory(cl.id, cl.category === C ? '' : C)} style={{ padding: '3px 8px', background: cl.category === C ? 'var(--ink)' : '#fff', color: cl.category === C ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{C}</button>
                                                    ))}
                                                </div>
                                                {/* Node names — shown while Locating so the 3D isolate is paired with the exact mesh list */}
                                                {isLocating && (
                                                    <div style={{ marginTop: '8px', maxHeight: '90px', overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', padding: '6px 8px', fontFamily: 'var(--mono)', fontSize: '8px', color: 'var(--ink-soft)', lineHeight: 1.6, wordBreak: 'break-all' }}>
                                                        {(cl.nodes || []).join(', ') || '(no nodes)'}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
                                                <button onClick={() => setLocatingClusterId(isLocating ? null : cl.id)} title="Highlight this group in the 3D view" style={{ background: isLocating ? 'var(--brass)' : '#fff', color: isLocating ? '#fff' : 'var(--ink)', border: '1px solid var(--brass)', padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer' }}>{isLocating ? '◉ Locating' : 'Locate'}</button>
                                                <button onClick={() => handleDeleteCluster(cl.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1rem', cursor: 'pointer' }}>Del</button>
                                            </div>
                                        </div>
                                        );
                                    })}
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

            {/* AUTO-GROUP DOCKED PANEL — sits beside the live 3D (no popup) so you tag while you
                look at the model; clicking a row highlights its nodes in the viewer. */}
            {showAutoPanel && (
                <div style={{ position: 'fixed', top: '80px', right: '24px', bottom: '24px', width: '500px', maxWidth: 'calc(100vw - 48px)', zIndex: 1000, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', borderRadius: '2px' }}>
                    {/* Header */}
                    <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Auto-Group · tag regions</span>
                                <h2 style={{ margin: '4px 0 0 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Group by Location & Position</h2>
                            </div>
                            <button onClick={() => { setShowAutoPanel(false); setPreviewProposalId(null); setActiveProposalId(null); }} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '14px', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', border: '1px solid var(--line)', background: '#fff' }}>
                                <button onClick={() => setSplitByPosition(true)} style={{ padding: '7px 12px', background: splitByPosition ? 'var(--ink)' : 'transparent', color: splitByPosition ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Split by Position</button>
                                <button onClick={() => setSplitByPosition(false)} style={{ padding: '7px 12px', background: !splitByPosition ? 'var(--ink)' : 'transparent', color: !splitByPosition ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Merge Instances</button>
                            </div>
                            <div style={{ display: 'flex', gap: '10px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                <button onClick={() => setAutoChecked(Object.fromEntries(autoProposals.map(p => [p.id, true])))} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer' }}>Select all</button>
                                <span style={{ color: 'var(--line)' }}>|</span>
                                <button onClick={() => setAutoChecked({})} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer' }}>None</button>
                            </div>
                            <button onClick={() => setShowGroupColors(v => !v)} title="Paint every group its own color in the 3D" style={{ padding: '6px 10px', background: showGroupColors ? 'var(--ink)' : '#fff', color: showGroupColors ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>◧ {showGroupColors ? 'Colors on' : 'Color groups'}</button>
                        </div>
                        {/* Bulk tag the checked proposals */}
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px', flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Tag checked:</span>
                            {LOCATIONS.map(loc => (
                                <button key={loc} onClick={() => setAutoLocations(prev => { const n = { ...prev }; autoProposals.forEach(p => { if (autoChecked[p.id]) n[p.id] = loc; }); return n; })} style={{ padding: '5px 10px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{loc}</button>
                            ))}
                            <span style={{ color: 'var(--line)' }}>|</span>
                            {CATEGORIES.map(c => (
                                <button key={c} onClick={() => setAutoCategories(prev => { const n = { ...prev }; autoProposals.forEach(p => { if (autoChecked[p.id]) n[p.id] = c; }); return n; })} style={{ padding: '5px 10px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{c}</button>
                            ))}
                            <button onClick={() => { setAutoLocations(prev => { const n = { ...prev }; autoProposals.forEach(p => { if (autoChecked[p.id] && p.library) n[p.id] = p.library.location || n[p.id] || ''; }); return n; }); setAutoCategories(prev => { const n = { ...prev }; autoProposals.forEach(p => { if (autoChecked[p.id] && p.library) n[p.id] = p.library.category || n[p.id] || ''; }); return n; }); }} title="Fill Location + Category from the matched library item for every checked group" style={{ padding: '5px 10px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>⛓ From Library</button>
                        </div>
                    </div>
                    {/* List */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '14px 22px' }}>
                        {autoProposals.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>No sub-assemblies detected in this model.</div>}
                        {activeProposalId && (() => {
                            const ap = autoProposals.find(p => p.id === activeProposalId);
                            return (
                                <div style={{ position: 'sticky', top: 0, zIndex: 1, marginBottom: '10px', padding: '10px 12px', background: 'var(--brass)', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', borderRadius: '2px' }}>
                                    <span style={{ fontSize: '0.82rem' }}>✎ Editing <strong>{(autoNames[activeProposalId] ?? ap?.suggestedName) || ''}</strong> — click parts in the 3D to add / remove them.</span>
                                    <button onClick={() => setActiveProposalId(null)} style={{ background: '#fff', color: 'var(--brass)', border: 'none', padding: '5px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>✓ Done</button>
                                </div>
                            );
                        })()}
                        {autoProposals.map(p => {
                            const on = !!autoChecked[p.id];
                            const loc = autoLocations[p.id] || '';
                            const cat = autoCategories[p.id] || '';
                            const isEditing = activeProposalId === p.id;
                            const isPreview = previewProposalId === p.id && !activeProposalId;
                            const isGlow = (activeProposalId || hoveredProposalId || previewProposalId) === p.id;
                            const color = proposalColor(p);
                            return (
                                <div key={p.id} onMouseEnter={() => { if (!activeProposalId) setHoveredProposalId(p.id); }} onMouseLeave={() => setHoveredProposalId(prev => prev === p.id ? null : prev)} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '10px', marginBottom: '4px', borderRadius: '2px', border: `1px solid ${isGlow ? 'var(--brass)' : 'transparent'}`, background: isGlow ? 'var(--paper-2)' : 'transparent', boxShadow: (showGroupColors && on) ? `inset 5px 0 0 ${color}` : (isGlow ? 'inset 5px 0 0 var(--brass)' : 'none'), opacity: on ? 1 : 0.55 }}>
                                    <input type="checkbox" checked={on} onChange={(e) => setAutoChecked(prev => ({ ...prev, [p.id]: e.target.checked }))} style={{ marginTop: '10px', width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brass)' }} />
                                    <div style={{ flex: 1, cursor: isEditing ? 'default' : 'pointer' }} onClick={() => { if (!isEditing) setPreviewProposalId(isPreview ? null : p.id); }} title={isEditing ? '' : 'Click to isolate this group in the 3D'}>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <span title="Hover to glow this group in the 3D" style={{ width: '14px', height: '14px', flexShrink: 0, borderRadius: '3px', border: '1px solid var(--line)', background: showGroupColors ? color : (isGlow ? 'var(--brass)' : 'transparent'), opacity: showGroupColors ? (on ? 1 : 0.25) : 1 }} />
                                            <input value={autoNames[p.id] ?? p.suggestedName} onClick={(e) => e.stopPropagation()} onChange={(e) => setAutoNames(prev => ({ ...prev, [p.id]: e.target.value }))} style={{ flex: 1, padding: '7px 9px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', textTransform: 'uppercase', outline: 'none' }} />
                                            {p.pos && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', background: 'var(--paper-2)', color: 'var(--brass)', padding: '4px 8px', textTransform: 'uppercase', letterSpacing: '.05em', whiteSpace: 'nowrap' }}>{p.pos}</span>}
                                            <button onClick={(e) => { e.stopPropagation(); if (!isEditing) setAutoChecked(prev => ({ ...prev, [p.id]: true })); setActiveProposalId(isEditing ? null : p.id); setPreviewProposalId(null); }} title="Add/remove parts: then click meshes in the 3D" style={{ background: isEditing ? 'var(--brass)' : '#fff', color: isEditing ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', padding: '4px 8px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{isEditing ? '✓ Done' : '✎ Edit'}</button>
                                        </div>
                                        {/* Location tag (Wall / Ceiling / End) */}
                                        <div style={{ display: 'flex', gap: '6px', marginTop: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Loc:</span>
                                            {LOCATIONS.map(L => (
                                                <button key={L} onClick={() => setAutoLocations(prev => ({ ...prev, [p.id]: loc === L ? '' : L }))} style={{ padding: '4px 9px', background: loc === L ? 'var(--ink)' : '#fff', color: loc === L ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{L}</button>
                                            ))}
                                        </div>
                                        {/* Category tag (Bracket / Pole / Finial) — from the matched library item */}
                                        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Cat:</span>
                                            {CATEGORIES.map(C => (
                                                <button key={C} onClick={() => setAutoCategories(prev => ({ ...prev, [p.id]: cat === C ? '' : C }))} style={{ padding: '4px 9px', background: cat === C ? 'var(--ink)' : '#fff', color: cat === C ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{C}</button>
                                            ))}
                                        </div>
                                        {/* Library match — verify the node resolved to the right component */}
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '.05em', color: p.library ? 'var(--brass)' : 'var(--ink-soft)' }}>
                                            {p.library
                                                ? `⛓ ${p.library.itemName}${p.library.productType ? ' · ' + p.library.productType : ''}${p.library.bracketType ? ' · ' + p.library.bracketType : ''}${p.library.exact ? '' : ' (≈)'}`
                                                : '⛓ no library match'}
                                        </div>
                                        {p.inheritedFrom && (
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>
                                                ↳ backplate → {p.inheritedFrom.location} (nearest arm: {p.inheritedFrom.base})
                                            </div>
                                        )}
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '6px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                                            {nodesOf(p).length} nodes{proposalNodeOverrides[p.id] ? ' · edited' : ''}
                                        </div>
                                        {p.flags.map((f, i) => (
                                            <div key={i} style={{ fontSize: '0.76rem', color: f.startsWith('Already') ? 'var(--ink-soft)' : '#b9770e', marginTop: '4px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                <span>⚠</span><span>{f}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    {/* Footer */}
                    <div style={{ padding: '16px 22px', borderTop: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                            {autoProposals.filter(p => autoChecked[p.id]).length} of {autoProposals.length}
                            {autoSavePlan.replaceCount > 0 && <span style={{ color: 'var(--brass)' }}> · {autoSavePlan.replaceCount}↻ · {autoSavePlan.newCount}+</span>}
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button onClick={() => { setShowAutoPanel(false); setPreviewProposalId(null); setActiveProposalId(null); }} style={{ padding: '12px 18px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Cancel</button>
                            <button onClick={handleAutoSaveSelected} style={{ padding: '12px 22px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save Clusters</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NodeClusterTab;