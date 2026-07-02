import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { mergeWindowConfig } from './systemWindows';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html } from '@react-three/drei';
import * as THREE from 'three';
import { loadGLBScene, buildComponentFiles, isolateCluster, snapshotPNG } from '../Shared/componentExport';

class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError(error) { return { hasError: true }; }
    componentDidCatch(error, errorInfo) { console.error("3D Render Error:", error); }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', background: '#fff', border: '1px dashed var(--line)' }}>
                    <div style={{ textAlign: 'center', color: 'var(--ink-soft)' }}>
                        <h3 style={{ fontFamily: 'var(--serif)', fontSize: '2rem', margin: '0 0 10px 0', color: 'var(--ink)' }}>Render Unavailable</h3>
                        <p style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>The uploaded 3D file is corrupted, missing .bin buffer data, or is an unsupported format.</p>
                        <p style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>Please use the <b>Upload</b> button in Tab 1 to replace this with a valid <b>.glb</b> file.</p>
                    </div>
                </div>
            );
        }
        return this.props.children; 
    }
}

const SnapshotModel = ({ url, interactionMode, onMeshClick, isFrozen, locatingNodes = [], hiddenNodes = [], onMeshesLoaded }) => {
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    const clonedScene = useMemo(() => scene.clone(true), [scene]);
    const isPinMode = interactionMode === 'pin';

    useEffect(() => {
        const meshes = [];
        clonedScene.traverse(c => { 
            if (c.isMesh) {
                let displayName = c.name;
                
                if ((displayName.toLowerCase().startsWith('body') || displayName.toLowerCase().startsWith('mesh') || displayName.trim() === '') && c.parent && c.parent.name) {
                    if (c.parent.name !== 'Scene' && c.parent.name !== 'RootNode') {
                        displayName = `${c.parent.name} ➔ ${displayName || 'Mesh'}`;
                    }
                }
                if (c.userData && c.userData.name) {
                    displayName = c.userData.name;
                }

                meshes.push({ originalName: c.name, displayName: displayName });
            } 
        });
        if (onMeshesLoaded) onMeshesLoaded(meshes);
    }, [clonedScene, onMeshesLoaded]);

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
                if (!child.userData.originalMaterial) child.userData.originalMaterial = child.material;
                
                child.visible = !hiddenNodes.includes(child.name);

                if (locatingNodes.length > 0 && isDescendantOf(child, locatingNodes)) {
                    // Located part pops in strong brass (matches the Node Grouping highlight).
                    child.material = new THREE.MeshStandardMaterial({ color: '#b08d57', emissive: '#b08d57', emissiveIntensity: 0.6, transparent: true, opacity: 0.95 });
                } else if (locatingNodes.length > 0) {
                    // Everything else hard-ghosts (unlit, opacity 0.12) so the located part stands out clearly.
                    child.material = new THREE.MeshBasicMaterial({ color: '#cccccc', transparent: true, opacity: 0.12 });
                } else {
                    child.material = child.userData.originalMaterial;
                }
            }
        });
    }, [clonedScene, locatingNodes, hiddenNodes]);
    
    return (
        <primitive 
            object={clonedScene} 
            onPointerOver={(e) => { 
                if (isPinMode && isFrozen) { e.stopPropagation(); document.body.style.cursor = 'crosshair'; }
            }}
            onPointerOut={(e) => { 
                if (isPinMode && isFrozen) { e.stopPropagation(); document.body.style.cursor = 'auto'; }
            }}
            onClick={(e) => { 
                if (isPinMode && isFrozen) { 
                    e.stopPropagation(); 
                    onMeshClick(e.point, e.object.name); 
                }
            }}
        />
    );
};

const CameraController = ({ zoomTrigger }) => {
    const { camera } = useThree();
    useEffect(() => {
        if (zoomTrigger === 'IN') camera.position.multiplyScalar(0.8);
        if (zoomTrigger === 'OUT') camera.position.multiplyScalar(1.2);
        camera.updateProjectionMatrix();
    }, [zoomTrigger, camera]);
    return null;
};

const VisualAssemblyTab = ({ currentUser, activeBrand, onProceed }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [activeAssembly, setActiveAssembly] = useState(null);

  const [pins, setPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  const [globalLists, setGlobalLists] = useState({ prodTypes: [], collections: [], uom: [], partHandling: [], inventoryTypes: [], assemblyTypes: [] });
  const [windowConfig, setWindowConfig] = useState(mergeWindowConfig(null));
  const [customSchema, setCustomSchema] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  
  const [creationMode, setCreationMode] = useState("EXISTING"); 
  const [searchQuery, setSearchQuery] = useState("");
  const [newPartName, setNewPartName] = useState("");
  const [newPartType, setNewPartType] = useState("Inventory"); 
  const [newPartRouting, setNewPartRouting] = useState(""); 
  
  const [newPartSpecs, setNewPartSpecs] = useState({ productType: '', collection: '', uom: 'EA', partHandling: '', dynamicDicts: {}, customData: {} });

  const [viewMode, setViewMode] = useState("3D");

  const [pendingPin, setPendingPin] = useState(null);
  const [reassignPinId, setReassignPinId] = useState(null); // when set, the drawer's library pick swaps this pin's part
  const [routingType, setRoutingType] = useState("");
  const [isSavingRouting, setIsSavingRouting] = useState(false);
  const [activeImageUrl, setActiveImageUrl] = useState("");
  const [availableImages, setAvailableImages] = useState([]);

  const [interactionMode, setInteractionMode] = useState("pan"); 
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [zoomTrigger, setZoomTrigger] = useState(null);

  const [isCanvasMaximized, setIsCanvasMaximized] = useState(false);
  const [showAutoAssign, setShowAutoAssign] = useState(false);
  const [autoAssignPart, setAutoAssignPart] = useState({});    // clusterId -> chosen partId
  const [autoAssignChecked, setAutoAssignChecked] = useState({});
  const [genState, setGenState] = useState(null);              // {done,total,label} while generating component files
  const [isCanvasLocked, setIsCanvasLocked] = useState(true); 

  const [isFrozen, setIsFrozen] = useState(false);

  const [cropState, setCropState] = useState(null); 
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  const [thumbBusy, setThumbBusy] = useState(null); // pinId whose node thumbnail is rendering
  
  const [locatingClusterId, setLocatingClusterId] = useState(null);

  const [sceneMeshes, setSceneMeshes] = useState([]);
  const [hiddenNodes, setHiddenNodes] = useState([]);

  const svgRef = useRef(null);
  const innerGroupRef = useRef(null);

  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists()){
              const data = docSnap.data();
              setGlobalLists({
                  prodTypes: data.prodTypes || [],
                  collections: data.collections || [],
                  uom: data.uom || ['EA'],
                  partHandling: data.partHandling || ['Small Parts', 'Custom'],
                  inventoryTypes: data.inventoryTypes || [],
                  assemblyTypes: data.assemblyTypes || [] 
              });
          }
      });
      const unsubWin = onSnapshot(doc(db, "system", "window_config"), snap => {
          setWindowConfig(mergeWindowConfig(snap.data()));
      });
      const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), snap => {
          if(snap.exists() && snap.data().inventoryFields) setCustomSchema(snap.data().inventoryFields);
      });
      const unsubDyn = onSnapshot(collection(db, "hq_dynamic_data"), snap => {
          setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()})));
      });
      
      return () => { unsubLists(); unsubWin(); unsubSchema(); unsubDyn(); };
  }, []);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("brandId", "==", activeBrand), where("partClass", "==", "Assembly"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Master Assembly list = MAINLINE only (a mainline assembly routingType MAIN, or a PRODUCT from
      // Inception). Orphans / sub-components / unrouted parts live in the BOM Engine / Master Library.
      // Mainline AND fully APPROVED in Inception (all 3 sign-offs) — un-approved products don't flow here yet.
      docs = docs.filter(d => ((d.routingType || '').toUpperCase() === 'MAIN' || (d.recordType || '').toUpperCase() === 'PRODUCT') && d.approvals && d.approvals.designer && d.approvals.technical && d.approvals.machinist);
      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setAssemblies(docs);
      if (docs.length > 0 && !selectedAssemblyId) setSelectedAssemblyId(docs[0].itemId);
    });
    return () => unsubscribe();
  }, [activeBrand, selectedAssemblyId]);

  // DATA refresh — keep activeAssembly + routingType in sync with the latest data. Runs whenever the
  // assemblies list updates; must NOT reset interaction state (that would close an open part drawer).
  useEffect(() => {
    const found = assemblies.find(a => a.itemId === selectedAssemblyId);
    setActiveAssembly(found || null);
    setRoutingType(found?.routingType || "");
  }, [selectedAssemblyId, assemblies]);

  // ASSEMBLY SWITCH — rebuild the image gallery / view mode and reset view + interaction state. Keyed ONLY
  // on selectedAssemblyId so a background Firestore snapshot refresh can't nuke an open drawer / pending pin.
  useEffect(() => {
    const found = assemblies.find(a => a.itemId === selectedAssemblyId);
    if (found) {
        const gallery = [];
        if (found.finalImageUrl) gallery.push({ url: found.finalImageUrl, name: 'Main Final Image' });
        if (found.revisions && found.revisions.length > 0) {
            found.revisions.forEach(rev => {
                if (rev.url && rev.url !== found.finalImageUrl && !rev.is3D) gallery.push({ url: rev.url, name: rev.name || 'Additional View' });
            });
        }
        setAvailableImages(gallery);
        setActiveImageUrl(gallery.length > 0 ? gallery[0].url : "");
        setViewMode(found.manufacturingSpecs?.cadUrl ? "3D" : "2D");
    } else {
        setAvailableImages([]); setActiveImageUrl(""); setViewMode("2D");
    }
    setScale(1); setPan({ x: 0, y: 0 }); setPendingPin(null); setReassignPinId(null); setIsCanvasLocked(true); setDrawerOpen(false); setCropState(null); setIsFrozen(false); setLocatingClusterId(null); setHiddenNodes([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (!selectedAssemblyId) return;
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => setPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      docs.sort((a, b) => (a.itemName || "").localeCompare(b.itemName || ""));
      setLibraryParts(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 4)); 
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.5)); 
  const handleZoomReset = () => { setScale(1); setPan({ x: 0, y: 0 }); };

  const getBaseSvgPoint = (clientX, clientY) => {
    if (!svgRef.current) return null;
    try {
        const svg = svgRef.current;
        const ctm = svg.getScreenCTM(); 
        if (!ctm) return null;
        const inverse = ctm.inverse();
        const point = svg.createSVGPoint(); 
        point.x = clientX; point.y = clientY;
        const transformed = point.matrixTransform(inverse);
        if (isNaN(transformed.x) || isNaN(transformed.y)) return null;
        return transformed;
    } catch (e) { return null; }
  };

  const getAdjustedSvgPoint = (clientX, clientY) => {
    if (!svgRef.current || !innerGroupRef.current) return null;
    try {
        const svg = svgRef.current; 
        const ctm = innerGroupRef.current.getScreenCTM(); 
        if (!ctm) return null;
        const inverse = ctm.inverse();
        const point = svg.createSVGPoint(); 
        point.x = clientX; point.y = clientY;
        const transformed = point.matrixTransform(inverse);
        if (isNaN(transformed.x) || isNaN(transformed.y)) return null;
        return { x: transformed.x, y: transformed.y };
    } catch (e) { return null; }
  };

  const onPointerDown = (e) => {
    if (viewMode === '3D' || !activeAssembly || !activeImageUrl || cropState) return;
    if (e.target.tagName === 'button' || e.target.tagName === 'text' || e.target.tagName === 'circle') return;

    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
    
    if (interactionMode === "pan" && !isFrozen) { 
      setIsPanning(true); 
      const pt = getBaseSvgPoint(e.clientX, e.clientY);
      if (pt) setPanStart({ clientX: e.clientX, clientY: e.clientY }); 
      return; 
    }
    
    if (interactionMode === "pin" && isFrozen) {
      const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
      if (pt) {
          setPendingPin({ pinX: pt.x, pinY: pt.y, targetNode: "" });
          setDrawerOpen(true); 
      }
    }
  };

  const onPointerMove = (e) => {
    if (viewMode === '3D' || cropState) return;
    if (interactionMode === "pan" && isPanning && panStart && !isFrozen) {
      const rawCurrent = getBaseSvgPoint(e.clientX, e.clientY); 
      const rawStart = getBaseSvgPoint(panStart.clientX, panStart.clientY);
      if (rawCurrent && rawStart) {
          const dx = rawCurrent.x - rawStart.x;
          const dy = rawCurrent.y - rawStart.y;
          if (!isNaN(dx) && !isNaN(dy)) {
              setPan(prev => ({ x: (prev.x || 0) + dx, y: (prev.y || 0) + dy }));
              setPanStart({ clientX: e.clientX, clientY: e.clientY });
          }
      }
    }
  };

  const onPointerUp = (e) => { 
      try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}
      if (interactionMode === "pan") { setIsPanning(false); setPanStart(null); } 
  };

  const handle3DMeshClick = (point3D, meshName) => {
      if (!isFrozen || interactionMode !== 'pin') return;

      if (drawerOpen && pendingPin) {
          setPendingPin(prev => {
              const currentNodes = prev.targetNode ? prev.targetNode.split(',').map(n => n.trim()) : [];
              if (!currentNodes.includes(meshName)) currentNodes.push(meshName);
              return { ...prev, targetNode: currentNodes.join(', ') };
          });
      } else {
          setPendingPin({ x: point3D.x, y: point3D.y, z: point3D.z, targetNode: meshName });
          setDrawerOpen(true);
          setSearchQuery(""); setNewPartName(""); setNewPartType("Inventory"); setNewPartRouting("");
          setNewPartSpecs({ productType: '', collection: '', uom: 'EA', partHandling: '', dynamicDicts: {}, customData: {} });
      }
  };

  const handlePinClick = async (e, pinId) => {
    e.stopPropagation();
    if (window.confirm("Delete this component from the assembly?")) {
      try { await deleteDoc(doc(db, "assembly_pins", pinId)); } catch (err) { console.error(err); }
    }
  };

  const handleUpdatePinQty = async (pinId, newQty) => {
      try { await updateDoc(doc(db, "assembly_pins", pinId), { defaultQty: parseInt(newQty) || 1 }); } catch (err) { console.error(err); }
  };

  const handleSaveRouting = async () => {
      if (!activeAssembly) return;
      setIsSavingRouting(true);
      try {
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { routingType });
          setTimeout(() => setIsSavingRouting(false), 800);
      } catch (err) { console.error(err); setIsSavingRouting(false); alert("Failed to save routing."); }
  };

  const handleDictChange = (dictId, value) => { setNewPartSpecs(prev => ({ ...prev, dynamicDicts: { ...prev.dynamicDicts, [dictId]: value } })); };
  const handleCustomDataChange = (key, value) => { setNewPartSpecs(prev => ({ ...prev, customData: { ...prev.customData, [key]: value } })); };
  const handleNewSpecChange = (e) => { setNewPartSpecs(prev => ({ ...prev, [e.target.name]: e.target.value })); };

  const saveNewCustomPart = async () => {
    if (!newPartName.trim()) return alert("Enter a name for the new entity.");
    if (newPartType === 'Assembly' && !newPartRouting) return alert("Please select a Routing Type for this Sub-Assembly.");
    if (newPartType === 'Inventory' && !newPartRouting) return alert("Please select an Inventory Category.");
    if (!reassignPinId && !pendingPin) return; // reassign updates an existing pin; a fresh define needs a pending pin

    // Duplicate-name guard: the typed name is often a raw CAD node like "H1-1EC_V61". If a real
    // library part already matches it (by name/ERP, or its base with a trailing _V## version suffix
    // stripped), offer to LINK to that part instead of minting a duplicate placeholder.
    const typedName = newPartName.trim().toUpperCase();
    const baseName = typedName.replace(/[ _-]?V\d+$/i, '').trim();
    const candidate = (libraryParts || []).find(p => {
      const nm = (p.itemName || '').toUpperCase();
      const erp = (p.legacyErpId || '').toUpperCase();
      const erpReal = erp && erp !== 'PENDING';
      return nm === typedName || (baseName && nm === baseName) || (erpReal && (erp === typedName || erp === baseName));
    });
    if (candidate) {
      const erpLabel = candidate.legacyErpId && candidate.legacyErpId !== 'PENDING' ? candidate.legacyErpId : (candidate.itemId || candidate.id);
      if (window.confirm(`A library part already exists that matches "${newPartName.trim()}":\n\n  ${candidate.itemName}  (${erpLabel})\n\nLink this pin to the existing part instead of creating a duplicate?\n\nOK = link to existing\nCancel = create a new part anyway`)) {
        return saveExistingLibraryPart(candidate);
      }
    }

    try {
      const prefix = newPartType === 'Inventory' ? 'INV' : newPartType === 'Fee' ? 'FEE' : 'ASM';
      const newMasterId = `${activeBrand.toUpperCase()}-${prefix}-${Math.floor(1000+Math.random()*9000)}`;
      
      const newDoc = {
          id: newMasterId, itemId: newMasterId, legacyErpId: "PENDING", itemName: newPartName.toUpperCase(),
          brandId: activeBrand, partClass: newPartType, sharedBrands: [activeBrand],
          collection: newPartSpecs.collection || activeAssembly?.collection || "N/A",
          productType: newPartSpecs.productType || "",
          routingType: newPartRouting,
          createdAt: new Date().toISOString()
      };

      const baseSpecs = {
          productType: newPartSpecs.productType || "",
          partHandling: newPartSpecs.partHandling || "",
          uom: newPartSpecs.uom || "EA",
          dynamicDicts: newPartSpecs.dynamicDicts || {},
          customData: newPartSpecs.customData || {},
          isInHouse: true,
          status: "NEEDS_SPECS"
      };

      if (newPartType === 'Fee') {
          // A fee/charge: not physical, books as a fee line. productType 'FEE' so the CPQ generator
          // treats it as a fee (like the built-in miter/bend/flush options) rather than a geometry part.
          newDoc.productType = newPartSpecs.productType || 'FEE';
          newDoc.manufacturingSpecs = { ...baseSpecs, productType: newPartSpecs.productType || 'FEE', isFee: true, basePrice: 0, cost: 0 };
      } else if (newPartType === 'Inventory') {
          newDoc.manufacturingSpecs = { ...baseSpecs };
      } else {
          newDoc.project = activeAssembly?.project || "";
          newDoc.manufacturingSpecs = { ...baseSpecs, basePrice: 0, cost: 0 };
      }

      await setDoc(doc(db, "Approved_Designs", newMasterId), newDoc);

      // REASSIGN mode: swap the newly-created part onto the EXISTING pin (keep its cluster/node/qty),
      // instead of dropping a new pin. This is what was silently failing before.
      if (reassignPinId) {
        await updateDoc(doc(db, "assembly_pins", reassignPinId), {
          partName: newPartName.toUpperCase(), partId: newMasterId, legacyErpId: "PENDING",
          isExistingLibraryPart: false, specs: newDoc.manufacturingSpecs || {}, status: "NEEDS_SPECS"
        });
        setDrawerOpen(false); setReassignPinId(null);
        setNewPartSpecs({ productType: '', collection: '', uom: 'EA', partHandling: '', dynamicDicts: {}, customData: {} });
        setIsCanvasMaximized(false);
        return;
      }

      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId,
        x: viewMode === '3D' ? (pendingPin.x || 0) : pendingPin.pinX, 
        y: viewMode === '3D' ? (pendingPin.y || 0) : pendingPin.pinY,
        z: viewMode === '3D' ? (pendingPin.z || 0) : null,
        targetNode: pendingPin.targetNode || "", 
        clusterId: pendingPin.clusterId || null, 
        imageUrl: viewMode === '3D' ? '3D_CAD' : activeImageUrl,
        partName: newPartName.toUpperCase(), partId: newMasterId, legacyErpId: "PENDING",
        isExistingLibraryPart: false, status: "NEEDS_SPECS", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      
      setDrawerOpen(false); setPendingPin(null);
      setNewPartSpecs({ productType: '', collection: '', uom: 'EA', partHandling: '', dynamicDicts: {}, customData: {} });
      setIsCanvasMaximized(false);
    } catch (err) { console.error(err); alert("Failed to create part."); }
  };

  const saveExistingLibraryPart = async (part) => {
    // Reassign mode: swap the library part on an EXISTING BOM pin in place — same pin, cluster, node link
    // and quantity are kept; only the part (name / item# / specs) changes. No delete / re-pin.
    if (reassignPinId) {
      try {
        await updateDoc(doc(db, "assembly_pins", reassignPinId), {
          partName: part.itemName, partId: part.itemId, legacyErpId: part.legacyErpId || "N/A",
          isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: "SPECS_LOCKED"
        });
        setDrawerOpen(false); setReassignPinId(null);
      } catch (e) { console.error('reassign failed', e); alert('Reassign failed — check console.'); }
      return;
    }
    if (!pendingPin) return;
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId, 
        x: viewMode === '3D' ? (pendingPin.x || 0) : pendingPin.pinX, 
        y: viewMode === '3D' ? (pendingPin.y || 0) : pendingPin.pinY,
        z: viewMode === '3D' ? (pendingPin.z || 0) : null,
        targetNode: pendingPin.targetNode || "", 
        clusterId: pendingPin.clusterId || null, 
        imageUrl: viewMode === '3D' ? '3D_CAD' : activeImageUrl, 
        partName: part.itemName, partId: part.itemId, legacyErpId: part.legacyErpId || "N/A",
        isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: "SPECS_LOCKED", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      setDrawerOpen(false); setPendingPin(null);
      setNewPartSpecs({ productType: '', collection: '', uom: 'EA', partHandling: '', dynamicDicts: {}, customData: {} });
      setIsCanvasMaximized(false);
    } catch (err) { console.error(err); }
  };

  const onCropPointerDown = (e, actionType) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      setCropState(prev => {
          if (!prev) return prev;
          return { ...prev, action: actionType, startX: e.clientX, startY: e.clientY, origX: prev.x, origY: prev.y, origW: prev.w, origH: prev.h };
      });
  };

  const onCropPointerMove = (e) => {
      setCropState(prev => {
          if (!prev || !prev.action) return prev;
          
          const dx = e.clientX - prev.startX;
          const dy = e.clientY - prev.startY;

          if (prev.action === 'MOVE') {
              return { ...prev, x: prev.origX + dx, y: prev.origY + dy };
          } else if (prev.action === 'RESIZE') {
              const sizeDelta = Math.max(dx, dy); 
              const newSize = Math.max(80, prev.origW + sizeDelta);
              return { ...prev, w: newSize, h: newSize };
          }
          return prev;
      });
  };

  const onCropPointerUp = (e) => {
      setCropState(prev => {
          if (!prev || !prev.action) return prev;
          try { e.currentTarget.releasePointerCapture(e.pointerId); } catch(err) {}
          return { ...prev, action: null };
      });
  };

  const executeThumbnailCrop = async () => {
      if (!cropState || !cropState.pinId) return alert("Please select a target for this thumbnail from the dropdown.");
      setIsProcessingCrop(true);

      try {
          const isMasterThumb = cropState.pinId === 'MASTER_ASSEMBLY';
          const targetPin = isMasterThumb ? null : pins.find(p => p.id === cropState.pinId);
          if (!isMasterThumb && !targetPin) throw new Error("Pin not found.");

          const targetSize = 512; 
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = targetSize;
          cropCanvas.height = targetSize;
          const ctx = cropCanvas.getContext('2d');

          if (viewMode === '3D') {
              const canvasElement = document.querySelector('#r3f-canvas-tab2 canvas');
              if (!canvasElement) throw new Error("Could not find 3D Canvas");

              const dataUrl = canvasElement.toDataURL('image/png');
              const rect = canvasElement.getBoundingClientRect();
              
              const img = new Image();
              img.crossOrigin = "Anonymous";
              img.src = dataUrl;
              await new Promise(r => img.onload = r);

              const scaleX = img.width / rect.width;
              const scaleY = img.height / rect.height;

              const sx = cropState.x * scaleX;
              const sy = cropState.y * scaleY;
              const sw = cropState.w * scaleX;
              const sh = cropState.h * scaleY;

              ctx.fillStyle = '#faf8f4'; 
              ctx.fillRect(0, 0, targetSize, targetSize);
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetSize, targetSize);
          } else {
              const container = document.getElementById('canvas-container');
              const rect = container.getBoundingClientRect();
              
              const img = new Image();
              img.crossOrigin = "Anonymous";
              img.src = activeImageUrl;
              await new Promise(r => { img.onload = r; img.onerror = r; });

              ctx.fillStyle = '#faf8f4';
              ctx.fillRect(0, 0, targetSize, targetSize);

              const Ssvg = Math.min(rect.width / 1000, rect.height / 1000);
              const OffsetXsvg = (rect.width - 1000 * Ssvg) / 2;
              const OffsetYsvg = (rect.height - 1000 * Ssvg) / 2;

              const Vx = (cropState.x - OffsetXsvg) / Ssvg;
              const Vy = (cropState.y - OffsetYsvg) / Ssvg;

              const Gx = 500 + (Vx - (pan.x || 0) - 500) / (scale || 1);
              const Gy = 500 + (Vy - (pan.y || 0) - 500) / (scale || 1);

              const Simg = Math.min(800 / img.width, 800 / img.height);
              const ImgOffsetX = 100 + (800 - img.width * Simg) / 2;
              const ImgOffsetY = 100 + (800 - img.height * Simg) / 2;

              const Px = (Gx - ImgOffsetX) / Simg;
              const Py = (Gy - ImgOffsetY) / Simg;

              const Pw = cropState.w / (Ssvg * (scale || 1) * Simg);
              const Ph = cropState.h / (Ssvg * (scale || 1) * Simg);

              ctx.drawImage(img, Px, Py, Pw, Ph, 0, 0, targetSize, targetSize);
          }

          cropCanvas.toBlob(async (blob) => {
              if (isMasterThumb) {
                  const thumbRef = ref(storage, `thumbnails/${activeBrand}_MASTER_${activeAssembly.id}_${Date.now()}.png`);
                  await uploadBytes(thumbRef, blob);
                  const dlUrl = await getDownloadURL(thumbRef);
                  await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { finalImageUrl: dlUrl });
              } else {
                  const thumbRef = ref(storage, `dynamic_assets/auto_crops/${targetPin.partId}_${Date.now()}.png`);
                  await uploadBytes(thumbRef, blob);
                  const dlUrl = await getDownloadURL(thumbRef);
                  await updateDoc(doc(db, "Approved_Designs", targetPin.partId), { finalImageUrl: dlUrl });
                  await updateDoc(doc(db, "assembly_pins", targetPin.id), { imageUrl: dlUrl });
              }
              
              setCropState(null);
              setIsFrozen(false);
              setInteractionMode('pan');
              setIsProcessingCrop(false);
          }, 'image/jpeg', 0.9); 
          
      } catch (e) {
          console.error(e);
          alert("Error capturing thumbnail.");
          setIsProcessingCrop(false);
      }
  };

  // Render a crisp thumbnail for ONE item straight from its node in the assembly .glb — far
  // cleaner than a 2D crop. Single-item counterpart to handleGenerateComponentFiles; stamps
  // the library part's finalImageUrl/componentImageUrl (where the BOM list reads thumbnails).
  const handleNodeThumbnail = async (pin) => {
      const cadUrl = activeAssembly?.manufacturingSpecs?.cadUrl;
      if (!cadUrl) return alert("This assembly has no 3D CAD (.glb) to render from.");
      const cluster = activeAssembly?.nodeClusters?.find(c => c.id === pin.clusterId);
      const nodes = (cluster?.nodes?.length)
          ? cluster.nodes
          : (pin.targetNode ? pin.targetNode.split(',').map(s => s.trim()).filter(Boolean) : []);
      if (!nodes.length) return alert("This item isn't linked to a 3D node or cluster yet — pin it to a node/cluster first.");
      setThumbBusy(pin.id);
      try {
          const scene = await loadGLBScene(cadUrl);
          const group = isolateCluster(scene, nodes);
          if (!group.children.length) throw new Error("No geometry matched this item's node(s) in the model.");
          const png = await snapshotPNG(group, 512);
          const sref = ref(storage, `component_images/${activeBrand}_${pin.partId || pin.id}_${Date.now()}.png`);
          await uploadBytes(sref, png);
          const url = await getDownloadURL(sref);
          if (pin.partId) await updateDoc(doc(db, "Approved_Designs", pin.partId), { finalImageUrl: url, componentImageUrl: url });
          if (pin.clusterId && Array.isArray(activeAssembly?.nodeClusters)) {
              const updated = activeAssembly.nodeClusters.map(c => c.id === pin.clusterId ? { ...c, imageUrl: url } : c);
              await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: updated });
          }
      } catch (e) {
          console.error(e);
          alert("Failed to render node thumbnail: " + (e.message || e));
      }
      setThumbBusy(null);
  };

  // Sort the library by ITEM # (legacy ERP id) using a natural/numeric compare so it's easy to scan by
  // number (e.g. H1-2 before H1-10), not by description.
  const libCode = (p) => (p.legacyErpId && p.legacyErpId !== 'PENDING' && p.legacyErpId !== 'N/A') ? p.legacyErpId : (p.itemId || p.id || '');
  const filteredLibrary = libraryParts.filter(p =>
      (p.partClass === 'Inventory' || p.partClass === 'Assembly') &&
      ((p.itemName && p.itemName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (p.legacyErpId && p.legacyErpId.toLowerCase().includes(searchQuery.toLowerCase())))
  ).sort((a, b) => String(libCode(a)).localeCompare(String(libCode(b)), undefined, { numeric: true, sensitivity: 'base' }));

  let canvasCursor = 'default';
  if (interactionMode === 'pan' && viewMode === '2D' && !isFrozen) canvasCursor = isPanning ? 'grabbing' : 'grab';
  else if (interactionMode === 'pin' && isFrozen) canvasCursor = 'crosshair';

  const visiblePins = pins.filter(p => 
      viewMode === '3D' ? p.imageUrl === '3D_CAD' : (p.imageUrl === activeImageUrl || (!p.imageUrl && activeImageUrl === activeAssembly?.finalImageUrl))
  );

  // Memoized so its identity is stable across renders — otherwise the autoAssignProposals memo
  // (which depends on it) recomputes every render and the seed effect below wipes the user's picks.
  const unassignedClusters = useMemo(() => (activeAssembly?.nodeClusters || []).filter(cluster => {
      return !pins.some(pin => pin.clusterId === cluster.id || pin.targetNode === cluster.nodes?.join(', '));
  }), [activeAssembly, pins]);

  // --- AUTO-ASSIGN BOM ---
  // Match each unassigned cluster to a library part by its code/pattern name (e.g.
  // cluster "FIVBP — LEFT" -> the part whose itemId/legacyErpId/itemName is FIVBP),
  // so the whole BOM can be built in one reviewed pass instead of pin-by-pin.
  const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const stripPosition = (name) => String(name || '').replace(/\s*[—–-]\s*(LEFT|CENTER|RIGHT|MID|#?\d+)\b.*$/i, '').trim();
  const autoAssignProposals = useMemo(() => {
      return unassignedClusters.map(cl => {
          const base = normCode(stripPosition(cl.name));
          let best = null, bestScore = 0;
          if (base) {
              libraryParts.forEach(p => {
                  if (p.id === activeAssembly?.id) return; // skip the assembly itself
                  const codes = [p.legacyErpId, p.itemId, p.itemName].map(normCode).filter(Boolean);
                  let s = 0;
                  codes.forEach(c => {
                      if (c === base) s = Math.max(s, 1);
                      else if (c.startsWith(base) || base.startsWith(c)) s = Math.max(s, 0.85);
                      else if (c.includes(base) || base.includes(c)) s = Math.max(s, 0.6);
                  });
                  if (s > bestScore) { bestScore = s; best = p; }
              });
          }
          return { cluster: cl, part: best, score: bestScore };
      });
  }, [unassignedClusters, libraryParts, activeAssembly]);

  // Seed defaults for any cluster we haven't seen yet, but PRESERVE the user's existing picks —
  // overwriting unconditionally made a manual selection vanish on the next render ("keeps
  // deselecting"). Only fills keys not already in state.
  useEffect(() => {
      setAutoAssignChecked(prev => {
          const next = { ...prev };
          autoAssignProposals.forEach(p => { if (!(p.cluster.id in next)) next[p.cluster.id] = p.score >= 0.85 && !!p.part; });
          return next;
      });
      setAutoAssignPart(prev => {
          const next = { ...prev };
          autoAssignProposals.forEach(p => { if (!(p.cluster.id in next)) next[p.cluster.id] = p.part?.id || ''; });
          return next;
      });
  }, [autoAssignProposals]);

  const handleAutoAssign = async () => {
      const chosen = autoAssignProposals.filter(p => autoAssignChecked[p.cluster.id] && autoAssignPart[p.cluster.id]);
      if (chosen.length === 0) return alert("Nothing selected to assign.");
      if (!window.confirm(`Create ${chosen.length} BOM component(s) by matching clusters to library parts?`)) return;
      try {
          for (const p of chosen) {
              const part = libraryParts.find(lp => lp.id === autoAssignPart[p.cluster.id]);
              if (!part) continue;
              await addDoc(collection(db, "assembly_pins"), {
                  assemblyId: selectedAssemblyId,
                  x: 0, y: 0, z: 0,
                  targetNode: (p.cluster.nodes || []).join(', '),
                  clusterId: p.cluster.id,
                  imageUrl: '3D_CAD',
                  partName: part.itemName, partId: part.itemId, legacyErpId: part.legacyErpId || "N/A",
                  isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: "SPECS_LOCKED",
                  author: currentUser, defaultQty: 1, createdAt: serverTimestamp()
              });
          }
          setShowAutoAssign(false);
      } catch (err) { console.error(err); alert("Auto-assign failed."); }
  };

  // --- GENERATE PER-COMPONENT FILES ---
  // For each cluster: isolate it from the master .glb, lay it FLAT, and emit a standalone
  // .glb + a thumbnail PNG. The PNG becomes the item image (auto-generated, no manual
  // screenshot); the .glb is reusable and feeds the Packaging tab's foam-cut tracer. Names
  // by the matched part code so repeats (L/C/R) share one file. Retrofits existing
  // assemblies — it just iterates whatever clusters are already there, and is re-runnable.
  const handleGenerateComponentFiles = async () => {
      const cadUrl = activeAssembly?.manufacturingSpecs?.cadUrl;
      const clusters = activeAssembly?.nodeClusters || [];
      if (!cadUrl) return alert("This assembly has no 3D CAD (.glb). Upload one in Inception first.");
      if (clusters.length === 0) return alert("No clusters to export — run Auto-Group first.");
      if (!window.confirm(`Generate a flat per-component .glb + thumbnail for ${clusters.length} cluster(s)?\nThis loads the model and renders each part — may take a minute.`)) return;

      const codeForCluster = (cl) => {
          const pin = pins.find(p => p.clusterId === cl.id);
          const fromPin = pin && pin.legacyErpId && !['N/A', 'PENDING', ''].includes(pin.legacyErpId) ? pin.legacyErpId : '';
          return normCode(fromPin) || normCode(stripPosition(cl.name)) || cl.id;
      };

      setGenState({ done: 0, total: clusters.length, label: 'Loading model…' });
      try {
          const scene = await loadGLBScene(cadUrl);

          // Dedupe by code — L/C/R repeats share identical geometry, so build the files once.
          const built = {};          // code -> { glbUrl, imageUrl, dims } | null
          const clusterUpdates = {}; // clusterId -> { glbUrl, imageUrl, dims }
          let done = 0, made = 0, empty = 0;

          for (const cl of clusters) {
              const code = codeForCluster(cl);
              setGenState({ done, total: clusters.length, label: code });
              if (!(code in built)) {
                  const files = await buildComponentFiles(scene, cl.nodes || []);
                  if (files) {
                      const glbRef = ref(storage, `component_models/${activeBrand}_${code}.glb`);
                      const pngRef = ref(storage, `component_images/${activeBrand}_${code}.png`);
                      await uploadBytes(glbRef, files.glbBlob, { contentType: 'model/gltf-binary' });
                      await uploadBytes(pngRef, files.pngBlob, { contentType: 'image/png' });
                      built[code] = { glbUrl: await getDownloadURL(glbRef), imageUrl: await getDownloadURL(pngRef), dims: files.dims };
                      made++;
                  } else { built[code] = null; empty++; }
              }
              if (built[code]) clusterUpdates[cl.id] = built[code];
              done++;
              setGenState({ done, total: clusters.length, label: code });
          }

          // Stamp the generated files + measured dims onto each cluster.
          const newClusters = clusters.map(cl => clusterUpdates[cl.id]
              ? { ...cl, glbUrl: clusterUpdates[cl.id].glbUrl, imageUrl: clusterUpdates[cl.id].imageUrl, dimsIn: clusterUpdates[cl.id].dims }
              : cl);
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { nodeClusters: newClusters });

          // Carry to the matched library parts: record component artefacts + the measured
          // Geometry & Z-Index dimensions (Width/Height, in inches), and set the primary item
          // image only when the part has no curated one (non-destructive on retrofit). One
          // write per part.
          const seenPart = new Set();
          for (const cl of clusters) {
              const u = clusterUpdates[cl.id]; if (!u) continue;
              const pin = pins.find(p => p.clusterId === cl.id); if (!pin?.partId) continue;
              const part = libraryParts.find(lp => lp.itemId === pin.partId || lp.id === pin.partId);
              if (!part || seenPart.has(part.id)) continue;
              seenPart.add(part.id);
              const patch = {
                  componentGlbUrl: u.glbUrl,
                  componentImageUrl: u.imageUrl,
                  'manufacturingSpecs.parametric.width': u.dims.width,
                  'manufacturingSpecs.parametric.height': u.dims.height,
              };
              if (!part.finalImageUrl) patch.finalImageUrl = u.imageUrl;
              await updateDoc(doc(db, "Approved_Designs", part.id), patch);
          }

          setGenState(null);
          alert(`✅ Generated ${made} component file set(s)${empty ? ` (${empty} cluster(s) had no mesh — skipped)` : ''}.\nFlat .glb + thumbnails saved, true dimensions written to each part's Geometry rules; .glb's are ready for foam tracing in Packaging.`);
      } catch (err) {
          console.error(err); setGenState(null);
          alert(`Generate failed: ${err.message || err}`);
      }
  };
  
  // Resolve the nodes to highlight for "Locate". Works for an unassigned cluster (by id)
  // and for an already-assigned BOM pin (by its clusterId, or its own targetNode) — so
  // you can confirm any assignment visually without building the BOM.
  const activeLocatingNodes = (() => {
      if (!locatingClusterId) return [];
      const cl = activeAssembly?.nodeClusters?.find(c => c.id === locatingClusterId);
      if (cl) return cl.nodes || [];
      const pin = pins.find(p => p.id === locatingClusterId || p.clusterId === locatingClusterId);
      if (pin) {
          const byCluster = activeAssembly?.nodeClusters?.find(c => c.id === pin.clusterId)?.nodes;
          if (byCluster?.length) return byCluster;
          if (pin.targetNode) return pin.targetNode.split(',').map(s => s.trim()).filter(Boolean);
      }
      return [];
  })();

  const canvasContainerStyle = isCanvasMaximized ? {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, 
      background: 'var(--paper)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
  } : {
      border: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '600px', overflow: 'hidden', position: 'relative'
  };

  const showLockOverlay = isCanvasLocked && !isCanvasMaximized;

  const getToolStyle = (mode) => ({
      padding: '8px 16px',
      background: interactionMode === mode ? 'var(--ink)' : 'transparent',
      color: interactionMode === mode ? '#fff' : 'var(--ink)',
      border: interactionMode === mode ? 'none' : '1px solid var(--line)',
      borderRadius: '2px',
      fontFamily: 'var(--mono)',
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '.1em',
      cursor: 'pointer',
      transition: 'all 0.2s ease'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh', position: 'relative' }}>
      
      {!isCanvasMaximized && (
          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
            <div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>BOM Builder & Routing</span>
                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Visual Assembly Details</h2>
            </div>
            <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Master Assembly:</label>
              <select value={selectedAssemblyId} onChange={(e) => setSelectedAssemblyId(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', minWidth: '300px', outline: 'none' }}>
                {assemblies.length === 0 && <option value="">No Assemblies Found</option>}
                {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
              </select>
              <button onClick={onProceed} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Proceed to BOM</button>
            </div>
          </div>
      )}

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', height: isCanvasMaximized ? 'auto' : 'calc(100vh - 150px)', minHeight: isCanvasMaximized ? 'auto' : '600px', overflow: isCanvasMaximized ? 'visible' : 'hidden' }}>

        {/* Evil Eye per-mesh hide panel removed — the body-label checkboxes weren't useful;
            the screen is now a clean split between the 3D viewer and the cluster/BOM column. */}

        <div style={canvasContainerStyle} id="canvas-container">
          
          {cropState && (
              <div 
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, overflow: 'hidden' }}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
              >
                  <div style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '16px 24px', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', gap: '16px', alignItems: 'center', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', zIndex: 10001 }}>
                      <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Frame & Crop</span>
                      
                      <select value={cropState.pinId || ""} onChange={(e) => setCropState(prev => ({...prev, pinId: e.target.value}))} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                          <option value="">-- SELECT TARGET FOR THUMBNAIL --</option>
                          <option value="MASTER_ASSEMBLY">★ Parent Assembly Thumbnail</option>
                          <optgroup label="BOM Components">
                            {pins.map(p => <option key={p.id} value={p.id}>{p.partName}</option>)}
                          </optgroup>
                      </select>

                      <button onClick={executeThumbnailCrop} disabled={!cropState.pinId || isProcessingCrop} style={{ background: cropState.pinId ? 'var(--ink)' : 'var(--paper-2)', color: cropState.pinId ? '#fff' : 'var(--ink-soft)', padding: '12px 24px', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: cropState.pinId ? 'pointer' : 'not-allowed' }}>{isProcessingCrop ? 'Saving...' : 'Snap & Save'}</button>
                      <button onClick={() => { setCropState(null); setIsFrozen(true); setInteractionMode('pin'); }} disabled={isProcessingCrop} style={{ background: 'transparent', color: 'var(--ink)', padding: '12px 24px', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Cancel</button>
                  </div>

                  <div 
                      style={{ position: 'absolute', top: cropState.y, left: cropState.x, width: cropState.w, height: cropState.h, border: '2px dashed #fff', boxShadow: '0 0 0 9999px rgba(28,26,22,0.6)', cursor: cropState.action === 'MOVE' ? 'grabbing' : 'move' }}
                      onPointerDown={(e) => onCropPointerDown(e, 'MOVE')}
                  >
                      <div 
                          style={{ position: 'absolute', bottom: -6, right: -6, width: 24, height: 24, background: '#fff', border: '1px solid var(--line)', cursor: 'nwse-resize', borderRadius: '50%' }}
                          onPointerDown={(e) => onCropPointerDown(e, 'RESIZE')}
                      />
                  </div>
              </div>
          )}

          {isCanvasMaximized && (
              <div style={{ position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 9990, background: '#fff', border: '1px solid var(--line)', padding: '12px', display: 'flex', gap: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', borderRadius: '2px' }}>
                  <div style={{ display: 'flex', border: '1px solid var(--line)', background: 'var(--paper)', borderRadius: '2px', overflow: 'hidden' }}>
                      <button onClick={() => { setViewMode('2D'); setIsFrozen(false); setInteractionMode('pan'); }} style={{ padding: '10px 20px', background: viewMode === '2D' ? 'var(--ink)' : 'transparent', color: viewMode === '2D' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>2D</button>
                      <button onClick={() => { setViewMode('3D'); setIsFrozen(false); setInteractionMode('pan'); }} disabled={!activeAssembly?.manufacturingSpecs?.cadUrl} style={{ padding: '10px 20px', background: viewMode === '3D' ? 'var(--ink)' : 'transparent', color: viewMode === '3D' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: activeAssembly?.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>3D</button>
                  </div>
                  
                  {!isFrozen ? (
                      <>
                          <button onClick={() => setInteractionMode('pan')} style={getToolStyle('pan')}>Navigate</button>
                          <div style={{ width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                          {viewMode === '2D' && (
                              <>
                                  <button onClick={handleZoomIn} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px', cursor: 'pointer' }}>➕</button>
                                  <button onClick={handleZoomOut} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '10px', cursor: 'pointer' }}>➖</button>
                                  <button onClick={handleZoomReset} style={{ padding: '10px 20px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Reset</button>
                                  <div style={{ width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                              </>
                          )}
                          <button onClick={() => { setIsFrozen(true); setInteractionMode('pin'); }} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Freeze Viewer</button>
                      </>
                  ) : (
                      <>
                          <button onClick={() => { setInteractionMode('pin'); setCropState(null); }} style={getToolStyle('pin')}>Drop Pins</button>
                          <button onClick={() => { setInteractionMode('crop'); setCropState({ x: 50, y: 50, w: 250, h: 250, action: null, pinId: '' }); }} style={getToolStyle('crop')}>Capture Thumbnail</button>
                          <button onClick={() => { setIsFrozen(false); setInteractionMode('pan'); setCropState(null); }} style={{ padding: '10px 20px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Unfreeze</button>
                      </>
                  )}

                  <div style={{ width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                  <button onClick={() => setIsCanvasMaximized(false)} style={{ padding: '10px 24px', background: '#d9534f', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Close Fullscreen</button>
              </div>
          )}

          {!isCanvasMaximized && activeAssembly && (
            <div style={{ padding: '16px 20px', background: '#fff', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
              <div style={{ display: 'flex', border: '1px solid var(--line)', background: 'var(--paper)', borderRadius: '2px', overflow: 'hidden' }}>
                  <button onClick={() => { setViewMode('2D'); setIsFrozen(false); setInteractionMode('pan'); }} style={{ padding: '10px 20px', background: viewMode === '2D' ? 'var(--ink)' : 'transparent', color: viewMode === '2D' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>2D Image</button>
                  <button onClick={() => { setViewMode('3D'); setIsFrozen(false); setInteractionMode('pan'); }} disabled={!activeAssembly.manufacturingSpecs?.cadUrl} style={{ padding: '10px 20px', background: viewMode === '3D' ? 'var(--ink)' : 'transparent', color: viewMode === '3D' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: activeAssembly.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>3D CAD</button>
              </div>

              {viewMode === '2D' && availableImages.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>View Angle</label>
                      <select value={activeImageUrl} onChange={(e) => { setActiveImageUrl(e.target.value); setPendingPin(null); setIsFrozen(false); }} style={{ padding: '10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                          {availableImages.map((img, idx) => <option key={idx} value={img.url}>{img.name}</option>)}
                      </select>
                  </div>
              )}

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {!isFrozen ? (
                      <>
                          <button onClick={() => setInteractionMode('pan')} style={getToolStyle('pan')}>Navigate</button>
                          
                          {viewMode === '2D' && (
                              <>
                                  <div style={{ height: '24px', width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                                  <button onClick={handleZoomIn} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➕</button>
                                  <button onClick={handleZoomOut} style={{ padding: '10px 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer' }}>➖</button>
                                  <button onClick={handleZoomReset} style={{ padding: '10px 16px', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Reset</button>
                              </>
                          )}

                          <div style={{ height: '24px', width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                          <button onClick={() => { setIsFrozen(true); setInteractionMode('pin'); }} style={{ padding: '10px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px' }}>Freeze Viewer</button>
                      </>
                  ) : (
                      <>
                          <button onClick={() => { setInteractionMode('pin'); setCropState(null); }} style={getToolStyle('pin')}>Drop Pins</button>
                          <button onClick={() => { setInteractionMode('crop'); setCropState({ x: 50, y: 50, w: 250, h: 250, action: null, pinId: '' }); }} style={getToolStyle('crop')}>Capture Thumbnail</button>
                          
                          <div style={{ height: '24px', width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                          <button onClick={() => { setIsFrozen(false); setInteractionMode('pan'); setCropState(null); }} style={{ padding: '10px 16px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px' }}>Unfreeze</button>
                      </>
                  )}
                  
                  <div style={{ height: '24px', width: '1px', background: 'var(--line)', margin: '0 8px' }}></div>
                  <button onClick={() => { setIsCanvasMaximized(true); setIsCanvasLocked(false); }} style={{ padding: '10px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderRadius: '2px' }}>Maximize</button>
              </div>
            </div>
          )}

          <div style={{ position: 'relative', flex: 1, background: 'var(--paper)', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            
                {showLockOverlay && (
                    <div onClick={() => setIsCanvasLocked(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, background: 'rgba(250,248,244,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <div style={{ background: '#fff', color: 'var(--ink)', padding: '16px 32px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', boxShadow: '0 8px 32px rgba(0,0,0,0.05)', pointerEvents: 'none' }}>
                            Click to Interact
                        </div>
                    </div>
                )}

                {!isCanvasLocked && !isCanvasMaximized && (
                    <div style={{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
                        <button onClick={() => setIsCanvasLocked(true)} style={{ background: 'var(--ink)', color: '#fff', padding: '12px 24px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                            Lock Canvas to Scroll
                        </button>
                    </div>
                )}

                {!activeAssembly ? ( <div style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-soft)' }}><h3 style={{fontFamily: 'var(--serif)', fontSize: '1.8rem', margin: '0 0 10px 0'}}>No Assembly Selected</h3><p style={{fontFamily: 'var(--sans)', fontSize: '0.95rem'}}>Create a Master Assembly in Tab 1 first.</p></div> ) : 
                 
                 viewMode === '3D' ? (
                    <ErrorBoundary>
                        <React.Suspense fallback={<div style={{ padding: '60px', textAlign: 'center', fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading 3D Engine...</div>}>
                            <div id="r3f-canvas-tab2" style={{ width: '100%', height: '100%' }}>
                                <Canvas gl={{ preserveDrawingBuffer: true }} camera={{ position: [5, 5, 5], fov: 50 }}>
                                    <ambientLight intensity={0.5} />
                                    <directionalLight position={[10, 10, 5]} intensity={1} />
                                    
                                    <OrbitControls makeDefault enabled={!isFrozen && interactionMode === 'pan' && !isCanvasLocked && !cropState} />
                                    <CameraController zoomTrigger={zoomTrigger} />
                                    
                                    <Bounds fit clip margin={1.2}>
                                        <SnapshotModel 
                                            url={activeAssembly.manufacturingSpecs.cadUrl} 
                                            interactionMode={interactionMode}
                                            onMeshClick={handle3DMeshClick} 
                                            isFrozen={isFrozen}
                                            locatingNodes={activeLocatingNodes}
                                            hiddenNodes={hiddenNodes} 
                                            onMeshesLoaded={setSceneMeshes} 
                                        />
                                    </Bounds>

                                    {!cropState && visiblePins.map(pin => {
                                        if (pin.imageUrl !== '3D_CAD' || pin.z === undefined) return null;
                                        const boxColor = pin.isExistingLibraryPart ? 'var(--ink)' : 'var(--brass)';
                                        return (
                                            <Html key={pin.id} position={[pin.x, pin.y, pin.z]} zIndexRange={[100, 0]}>
                                                <div 
                                                    onClick={(e) => { e.stopPropagation(); handlePinClick(e, pin.id); }}
                                                    style={{ width: '16px', height: '16px', background: boxColor, borderRadius: '50%', border: '2px solid #fff', cursor: 'pointer', transform: 'translate(-50%, -50%)', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} 
                                                    title={`${pin.partName} (${pin.targetNode})`}
                                                />
                                            </Html>
                                        )
                                    })}
                                </Canvas>
                            </div>
                        </React.Suspense>
                    </ErrorBoundary>
                 ) : (
                  <svg ref={svgRef} viewBox="0 0 1000 1000" style={{ width: '100%', height: '100%', display: 'block', cursor: canvasCursor, touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                    <g ref={innerGroupRef} transform={`translate(${pan.x || 0}, ${pan.y || 0}) translate(500, 500) scale(${scale || 1}) translate(-500, -500)`}>
                      
                      {activeImageUrl && <image href={activeImageUrl} x="100" y="100" width="800" height="800" preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />}
                      
                      {!cropState && visiblePins.map((pin) => {
                        const isRightHalf = pin.x > 500; const elbowX = isRightHalf ? pin.x + 40 : pin.x - 40; const elbowY = pin.y - 50; const landingX = isRightHalf ? 800 : 20; const boxColor = pin.isExistingLibraryPart ? 'var(--ink)' : 'var(--brass)'; 
                        return (
                          <g key={pin.id} onPointerDown={(e) => handlePinClick(e, pin.id)} style={{ cursor: 'pointer' }}>
                            <path d={`M ${pin.x} ${pin.y} L ${elbowX} ${elbowY} L ${landingX} ${elbowY}`} fill="none" stroke={boxColor} strokeWidth="1" />
                            <circle cx={pin.x} cy={pin.y} r="6" fill={boxColor} stroke="#fff" strokeWidth="1.5" />
                            <rect x={landingX} y={elbowY - 20} width="180" height="40" fill="#fff" stroke={boxColor} strokeWidth="1" />
                            <text x={landingX + 16} y={elbowY + 4} fill="var(--ink)" fontSize="11" fontFamily="var(--sans)" fontWeight="500">{pin.partName.length > 20 ? pin.partName.substring(0, 18) + "..." : pin.partName}</text>
                          </g>
                        );
                      })}
                    </g>
                  </svg>
                )}
            </div>
          </div>
        </div>

        {!isCanvasMaximized && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minHeight: 0 }}>

                {viewMode === '3D' && unassignedClusters.length > 0 && (
                    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Unassigned Clusters</span>
                            <button onClick={() => setShowAutoAssign(true)} title="Match these clusters to library parts by name and build the BOM in one pass" style={{ padding: '10px 16px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, whiteSpace: 'nowrap' }}>⚡ Auto-Assign BOM</button>
                            <button onClick={handleGenerateComponentFiles} disabled={!!genState || !activeAssembly?.manufacturingSpecs?.cadUrl} title="Isolate each cluster from the .glb, lay it flat, and save a per-component .glb + thumbnail. The PNG becomes the item image; the .glb feeds foam-cut tracing in Packaging." style={{ padding: '10px 16px', background: genState ? 'var(--ink-soft)' : 'var(--ink)', color: '#fff', border: 'none', cursor: genState || !activeAssembly?.manufacturingSpecs?.cadUrl ? 'not-allowed' : 'pointer', opacity: !activeAssembly?.manufacturingSpecs?.cadUrl ? 0.5 : 1, fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                {genState ? `⚙ ${genState.done}/${genState.total} ${genState.label}` : '⚙ Generate Component Files'}
                            </button>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>These 3D groupings have not been converted into BOM items yet. <strong>Locate</strong> highlights one in the 3D view.</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '32vh', overflowY: 'auto' }}>
                            {unassignedClusters.map(cl => {
                                const isLocating = locatingClusterId === cl.id;
                                return (
                                <div key={cl.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px', borderRadius: '2px', background: isLocating ? 'rgba(176,141,87,0.14)' : 'transparent', border: `1px solid ${isLocating ? 'var(--brass)' : 'transparent'}` }}>
                                    {cl.imageUrl
                                        ? <img src={cl.imageUrl} alt="" style={{ width: '46px', height: '46px', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', flexShrink: 0 }} />
                                        : <span style={{ width: '46px', height: '46px', flexShrink: 0, border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', color: 'var(--ink-soft)', textAlign: 'center' }}>no img</span>}
                                    <button
                                        onClick={() => setLocatingClusterId(isLocating ? null : cl.id)}
                                        style={{ padding: '12px', background: isLocating ? 'var(--brass)' : '#fff', color: isLocating ? '#fff' : 'var(--ink-soft)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0 }}
                                    >
                                        {isLocating ? 'Clear' : 'Locate'}
                                    </button>
                                    <button 
                                        onClick={() => {
                                            setPendingPin({ x: 0, y: 0, z: 0, targetNode: cl.nodes?.join(', '), clusterId: cl.id });
                                            setNewPartName(cl.name);
                                            setDrawerOpen(true);
                                            setCreationMode("NEW");
                                            setLocatingClusterId(null);
                                        }}
                                        style={{ padding: '12px 16px', background: 'var(--paper-2)', color: 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', textAlign: 'left', flex: 1, display: 'flex', justifyContent: 'space-between' }}
                                    >
                                        <span>+ Assign: {cl.name}</span>
                                        <span style={{ opacity: 0.7 }}>({cl.nodes?.length || 0} nodes)</span>
                                    </button>
                                </div>
                            )})}
                        </div>
                    </div>
                )}

                <div style={{ flex: 1, minHeight: 0, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--paper-2)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Master BOM</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{pins.length} Components</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#fff' }}>
                        {pins.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>Drop pins on the image to build the BOM.</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {pins.map(pin => {
                                const libraryMatch = libraryParts.find(p => p.id === pin.partId);
                                const cluster = activeAssembly?.nodeClusters?.find(c => c.id === pin.clusterId);
                                const hasThumb = libraryMatch?.finalImageUrl || libraryMatch?.componentImageUrl || cluster?.imageUrl;
                                const isLoc = locatingClusterId === (pin.clusterId || pin.id);
                                const canThumb = !!(activeAssembly?.manufacturingSpecs?.cadUrl && ((cluster?.nodes?.length) || pin.targetNode));
                                const thumbing = thumbBusy === pin.id;
                                return (
                                <div key={pin.id} style={{ background: isLoc ? 'rgba(176,141,87,0.12)' : 'var(--paper)', border: `1px solid ${isLoc ? 'var(--brass)' : 'var(--line)'}`, borderLeft: `4px solid ${pin.isExistingLibraryPart ? 'var(--ink)' : 'var(--brass)'}`, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                        <div style={{ width: '48px', height: '48px', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                            {hasThumb ? <img src={hasThumb} alt="" style={{width: '100%', height:'100%', objectFit:'contain'}}/> : <span style={{fontSize:'12px', color:'var(--ink-soft)'}}>No Img</span>}
                                        </div>
                                        <div>
                                            <div style={{ fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)' }}>{pin.partName}</div>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>{pin.legacyErpId}</div>
                                            {pin.clusterId ? (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px', alignItems: 'center' }}>
                                                    {cluster?.location && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink)', background: 'var(--paper-2)', padding: '2px 6px', border: '1px solid var(--line)' }}>{cluster.location}</span>}
                                                    {cluster?.position && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: '#fff', background: 'var(--brass)', padding: '2px 6px' }}>{cluster.position}</span>}
                                                    {cluster?.category && <span style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '2px 6px' }}>{cluster.category}</span>}
                                                    {!(cluster?.location || cluster?.position || cluster?.category) && <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink)', background: 'var(--paper-2)', padding: '2px 6px', border: '1px solid var(--line)' }}>Clustered 3D Data</span>}
                                                </div>
                                            ) : pin.targetNode && (
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', marginTop: '6px' }}>🎯 {pin.targetNode.substring(0, 20)}{pin.targetNode.length > 20 ? '...' : ''}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>

                                        {viewMode === '3D' && (pin.clusterId || pin.targetNode) && (
                                            <button
                                                onClick={() => setLocatingClusterId(isLoc ? null : (pin.clusterId || pin.id))}
                                                title="Highlight this part in the 3D view to confirm the assignment"
                                                style={{ background: isLoc ? 'var(--brass)' : 'transparent', border: '1px solid var(--brass)', color: isLoc ? '#fff' : 'var(--brass)', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer', padding: '8px 12px' }}
                                            >
                                                {isLoc ? '◉ Locating' : 'Locate'}
                                            </button>
                                        )}

                                        <button
                                            onClick={() => handleNodeThumbnail(pin)}
                                            disabled={!canThumb || thumbing}
                                            title={canThumb ? "Render this item's thumbnail straight from its node in the 3D model" : "Needs a .glb model and a linked node/cluster"}
                                            style={{ background: thumbing ? 'var(--brass)' : 'transparent', border: '1px solid var(--brass)', color: thumbing ? '#fff' : 'var(--brass)', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: (canThumb && !thumbing) ? 'pointer' : 'not-allowed', padding: '8px 12px', opacity: canThumb ? 1 : 0.5, whiteSpace: 'nowrap' }}
                                        >
                                            {thumbing ? '⏳ Rendering' : '📷 Node Thumb'}
                                        </button>

                                        <button
                                            onClick={() => { setReassignPinId(pin.id); setPendingPin(null); setCreationMode("EXISTING"); setSearchQuery(""); setDrawerOpen(true); }}
                                            title="Swap this BOM line to a different library part — keeps the node link and quantity"
                                            style={{ background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer', padding: '8px 12px', whiteSpace: 'nowrap' }}
                                        >
                                            ⇄ Reassign
                                        </button>

                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><label style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginBottom: '4px' }}>QTY</label><input type="number" min="1" value={pin.defaultQty || 1} onChange={(e) => handleUpdatePinQty(pin.id, e.target.value)} style={{ width: '48px', padding: '6px', border: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--sans)' }} /></div>
                                        <button onClick={(e) => handlePinClick(e, pin.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1rem', cursor: 'pointer', padding: '0' }}>Del</button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                </div>

                {/* Parent Routing is just a one-off classification dropdown — keep it a compact
                    single row so it doesn't squeeze the Master BOM. */}
                <div style={{ flexShrink: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', whiteSpace: 'nowrap', letterSpacing: '.1em' }} title="Classify the entire assembly (routing type). Setting this also lets the CPQ flow builder recognise it as a CPQ master assembly.">Parent Routing</label>
                    <select value={routingType} onChange={(e) => setRoutingType(e.target.value)} style={{ flex: 1, padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                        <option value="">-- Classify entire image as… --</option>
                        {(globalLists.assemblyTypes || []).map(type => ( <option key={type} value={type}>{type}</option> ))}
                    </select>
                    <button onClick={handleSaveRouting} disabled={!activeAssembly || !routingType} style={{ padding: '10px 18px', background: isSavingRouting ? 'var(--brass)' : 'var(--ink)', color: '#fff', border: 'none', cursor: (activeAssembly && routingType) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap', transition: 'background 0.2s' }}>{isSavingRouting ? "Saving…" : "Save"}</button>
                </div>
            </div>
        )}
      </div>

      {drawerOpen && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: '500px', height: '100vh', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.1)', zIndex: 10005, borderLeft: '1px solid var(--line)' }}>
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>{reassignPinId ? 'Reassign Part' : 'Define Component'}</h3>
                <button onClick={() => { setDrawerOpen(false); setPendingPin(null); setReassignPinId(null); }} disabled={isProcessingCrop} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: isProcessingCrop ? 'not-allowed' : 'pointer' }}>×</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
              <button onClick={() => setCreationMode("EXISTING")} disabled={isProcessingCrop} style={{ flex: 1, padding: '16px', background: creationMode === "EXISTING" ? '#fff' : 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', borderRight: '1px solid var(--line)', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "EXISTING" ? 'var(--ink)' : 'var(--ink-soft)' }}>Select From Library</button>
              <button onClick={() => setCreationMode("NEW")} disabled={isProcessingCrop} style={{ flex: 1, padding: '16px', background: creationMode === "NEW" ? '#fff' : 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', border: 'none', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "NEW" ? 'var(--brass)' : 'var(--ink-soft)' }}>Create New Part</button>
            </div>
            
            <div style={{ padding: '30px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', background: '#fff' }}>
              
              {pendingPin?.targetNode !== undefined && viewMode === '3D' && (
                  <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                          <span style={{ fontSize: '1.2rem', marginTop: '2px', color: 'var(--ink)' }}>🎯</span>
                          <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', color: 'var(--ink)', fontWeight: 500 }}>{pendingPin.clusterId ? '3D Cluster Assigned' : '3D Meshes Targeted'}</div>
                              <input 
                                  value={pendingPin.targetNode} 
                                  disabled
                                  style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', background: '#fff', marginTop: '8px' }}
                              />
                          </div>
                      </div>
                  </div>
              )}

              {creationMode === "NEW" && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  <div>
                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Entity Type</label>
                      <div style={{ display: 'flex', gap: '10px' }}>
                          <button onClick={() => { setNewPartType("Inventory"); setNewPartRouting(""); }} style={{ flex: 1, padding: '12px', background: newPartType === "Inventory" ? 'var(--ink)' : 'var(--paper)', color: newPartType === "Inventory" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Raw Mat / Component</button>
                          <button onClick={() => setNewPartType("Assembly")} style={{ flex: 1, padding: '12px', background: newPartType === "Assembly" ? 'var(--ink)' : 'var(--paper)', color: newPartType === "Assembly" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Sub-Assembly / Kit</button>
                          <button onClick={() => { setNewPartType("Fee"); setNewPartRouting("FEE"); setNewPartSpecs(prev => ({ ...prev, productType: prev.productType || 'FEE' })); }} style={{ flex: 1, padding: '12px', background: newPartType === "Fee" ? 'var(--ink)' : 'var(--paper)', color: newPartType === "Fee" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Fee / Charge</button>
                      </div>
                  </div>

                  {newPartType === "Fee" ? (
                      <div style={{ background: 'var(--paper-2)', padding: '16px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                          <strong style={{ color: 'var(--ink)' }}>Fee / charge</strong> — not physical inventory, no routing. Books as a fee line (e.g. a French-return bend fee), so it doesn't tie the render to a real item.
                      </div>
                  ) : newPartType === "Inventory" ? (
                      <div style={{ background: 'var(--paper-2)', padding: '16px', border: '1px solid var(--line)' }}>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Inventory Category</label>
                          <select value={newPartRouting} onChange={(e) => setNewPartRouting(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                              <option value="">-- SELECT CATEGORY --</option>
                              {(globalLists.inventoryTypes || []).map(type => ( <option key={type} value={type}>{type}</option> ))}
                          </select>
                      </div>
                  ) : (
                      <div style={{ background: 'var(--paper-2)', padding: '16px', border: '1px solid var(--line)' }}>
                          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Routing Classification</label>
                          <select value={newPartRouting} onChange={(e) => setNewPartRouting(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                              <option value="">-- SELECT ROUTING --</option>
                              {(globalLists.assemblyTypes || []).map(type => ( <option key={type} value={type}>{type}</option> ))}
                          </select>
                      </div>
                  )}

                  <div>
                      <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Enter Entity Name / Description</label>
                      <input autoFocus value={newPartName} onChange={(e) => setNewPartName(e.target.value)} disabled={isProcessingCrop} placeholder="e.g. UPPER EXTENSION POLE" style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '1rem', outline: 'none' }} />
                  </div>
                  
                  <div style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                      <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Global Master Properties</h4>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Prod Type</label>
                              <select name="productType" value={newPartSpecs.productType} onChange={handleNewSpecChange} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  <option value="">SELECT...</option>{globalLists.prodTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                              </select>
                          </div>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Part Handling</label>
                              <select name="partHandling" value={newPartSpecs.partHandling} onChange={handleNewSpecChange} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  <option value="">UNASSIGNED</option>{globalLists.partHandling.map(ph => <option key={ph} value={ph}>{ph}</option>)}
                              </select>
                          </div>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>UOM</label>
                              <select name="uom" value={newPartSpecs.uom} onChange={handleNewSpecChange} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  {globalLists.uom.map(u => <option key={u} value={u}>{u}</option>)}
                              </select>
                          </div>
                          <div>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Collection</label>
                              <select name="collection" value={newPartSpecs.collection} onChange={handleNewSpecChange} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  <option value="">SELECT...</option>{globalLists.collections.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                          </div>
                      </div>

                      {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                          <div key={w.id} style={{ marginBottom: '16px' }}>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>{w.name}</label>
                              <select value={newPartSpecs.dynamicDicts[w.id] || ""} onChange={(e) => handleDictChange(w.id, e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                  <option value="">SELECT...</option><option value="N/A">N/A</option>
                                  {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
                              </select>
                          </div>
                      ))}

                      {customSchema.map(field => (
                          <div key={field.key} style={{ marginBottom: '16px' }}>
                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>{field.label}</label>
                              {field.type === 'dropdown' ? (
                                  <select value={newPartSpecs.customData[field.key] || ""} onChange={(e) => handleCustomDataChange(field.key, e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)' }}>
                                      <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                  </select>
                              ) : (
                                  <input type={field.type} value={newPartSpecs.customData[field.key] || ""} onChange={(e) => handleCustomDataChange(field.key, e.target.value)} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)' }} />
                              )}
                          </div>
                      ))}
                  </div>

                  <button onClick={saveNewCustomPart} disabled={isProcessingCrop || !newPartRouting} style={{ width: '100%', padding: '16px', background: (isProcessingCrop || !newPartRouting) ? 'var(--paper-2)' : 'var(--brass)', color: (isProcessingCrop || !newPartRouting) ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: (isProcessingCrop || !newPartRouting) ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                    Save & Create New {newPartType}
                  </button>
                </div>
              )}
              {creationMode === "EXISTING" && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
                  <input autoFocus placeholder="Search Master Library by Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', marginBottom: '20px', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} />
                  <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--line)', background: '#fff' }}>
                    {filteredLibrary.length === 0 ? ( <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No Matching Parts Found</div> ) : (
                      filteredLibrary.map(part => (
                        <div key={part.id} onClick={() => saveExistingLibraryPart(part)} style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = 'var(--paper-2)'} onMouseOut={(e) => e.currentTarget.style.background = '#fff'}>
                          <div style={{ flex: 1 }}>
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '0.95rem', fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {part.partClass === 'Assembly' && <span style={{ fontSize: '8px', color: 'var(--ink)', background: 'var(--paper-2)', padding: '2px 4px', border: '1px solid var(--line)' }}>ASM</span>}
                                  {part.legacyErpId !== "PENDING" && part.legacyErpId !== "N/A" ? part.legacyErpId : part.itemId}
                              </div>
                              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '3px' }}>{part.itemName}</div>
                          </div>
                          <div style={{ width: '48px', height: '48px', background: 'var(--paper)', border: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{part.finalImageUrl ? <img src={part.finalImageUrl} alt={part.itemName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '1rem', color: 'var(--ink-soft)' }}>⚙️</span>}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
        </div>
      )}

      {/* AUTO-ASSIGN BOM REVIEW MODAL */}
      {showAutoAssign && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,15,0.55)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }} onClick={() => setShowAutoAssign(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', width: '820px', maxWidth: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', borderRadius: '2px' }}>
            <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Match Clusters to Library Parts</span>
                  <h2 style={{ margin: '4px 0 0 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Auto-Assign BOM</h2>
                </div>
                <button onClick={() => setShowAutoAssign(false)} style={{ background: 'none', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>
                <button onClick={() => setAutoAssignChecked(Object.fromEntries(autoAssignProposals.filter(p => autoAssignPart[p.cluster.id]).map(p => [p.cluster.id, true])))} style={{ background: 'none', border: 'none', color: 'var(--brass)', cursor: 'pointer' }}>Select all matched</button>
                <span style={{ color: 'var(--line)' }}>|</span>
                <button onClick={() => setAutoAssignChecked({})} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer' }}>None</button>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
              {autoAssignProposals.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>No unassigned clusters — the BOM is fully assigned.</div>}
              {autoAssignProposals.map(p => {
                const on = !!autoAssignChecked[p.cluster.id];
                const conf = p.score >= 1 ? 'exact' : p.score >= 0.85 ? 'strong' : p.score > 0 ? 'weak' : 'none';
                const confColor = p.score >= 0.85 ? 'var(--brass)' : p.score > 0 ? '#b9770e' : '#d9534f';
                return (
                  <div key={p.cluster.id} style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--line)', opacity: on ? 1 : 0.6 }}>
                    <input type="checkbox" checked={on} onChange={(e) => setAutoAssignChecked(prev => ({ ...prev, [p.cluster.id]: e.target.checked }))} style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--brass)' }} />
                    <div style={{ width: '230px', flexShrink: 0 }}>
                      <div style={{ fontSize: '0.9rem', color: 'var(--ink)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cluster.name}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: confColor, textTransform: 'uppercase', marginTop: '2px' }}>{conf === 'none' ? '⚠ no match — pick one' : `${conf} match`}</div>
                    </div>
                    <span style={{ color: 'var(--ink-soft)' }}>→</span>
                    <select value={autoAssignPart[p.cluster.id] || ''} onChange={(e) => setAutoAssignPart(prev => ({ ...prev, [p.cluster.id]: e.target.value }))} style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                      <option value="">-- pick a library part --</option>
                      {libraryParts.filter(lp => lp.id !== activeAssembly?.id)
                        .sort((a, b) => String(libCode(a)).localeCompare(String(libCode(b)), undefined, { numeric: true, sensitivity: 'base' }))
                        .map(lp => (
                          <option key={lp.id} value={lp.id}>{libCode(lp)} — {lp.itemName}</option>
                        ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <div style={{ padding: '20px 28px', borderTop: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                {autoAssignProposals.filter(p => autoAssignChecked[p.cluster.id] && autoAssignPart[p.cluster.id]).length} of {autoAssignProposals.length} will be assigned
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={() => setShowAutoAssign(false)} style={{ padding: '14px 24px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Cancel</button>
                <button onClick={handleAutoAssign} style={{ padding: '14px 28px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Assign Selected to BOM</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default VisualAssemblyTab;