import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html } from '@react-three/drei';
import * as THREE from 'three';

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
                    child.material = new THREE.MeshStandardMaterial({ color: '#b08d57', emissive: '#b08d57', emissiveIntensity: 0.5, transparent: true, opacity: 0.9 });
                } else if (locatingNodes.length > 0) {
                    child.material = new THREE.MeshStandardMaterial({ color: '#cccccc', transparent: true, opacity: 0.3 });
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
  const [windowConfig, setWindowConfig] = useState({ system: {}, custom: [] });
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
  const [isCanvasLocked, setIsCanvasLocked] = useState(true); 

  const [isFrozen, setIsFrozen] = useState(false);

  const [cropState, setCropState] = useState(null); 
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);
  
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
          if(snap.exists()) setWindowConfig({ system: snap.data().system || {}, custom: snap.data().custom || [] });
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
      docs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setAssemblies(docs);
      if (docs.length > 0 && !selectedAssemblyId) setSelectedAssemblyId(docs[0].itemId);
    });
    return () => unsubscribe();
  }, [activeBrand, selectedAssemblyId]);

  useEffect(() => {
    const found = assemblies.find(a => a.itemId === selectedAssemblyId);
    setActiveAssembly(found || null);
    
    if (found) {
        if (found.routingType) setRoutingType(found.routingType); else setRoutingType("");
        
        let gallery = [];
        if (found.finalImageUrl) gallery.push({ url: found.finalImageUrl, name: 'Main Final Image' });
        if (found.revisions && found.revisions.length > 0) {
            found.revisions.forEach(rev => {
                if (rev.url && rev.url !== found.finalImageUrl && !rev.is3D) gallery.push({ url: rev.url, name: rev.name || 'Additional View' });
            });
        }
        setAvailableImages(gallery);
        setActiveImageUrl(gallery.length > 0 ? gallery[0].url : "");
        
        if (found.manufacturingSpecs?.cadUrl) setViewMode("3D");
        else setViewMode("2D");

    } else {
        setRoutingType(""); setAvailableImages([]); setActiveImageUrl(""); setViewMode("2D");
    }
    
    setScale(1); setPan({ x: 0, y: 0 }); setPendingPin(null); setIsCanvasLocked(true); setDrawerOpen(false); setCropState(null); setIsFrozen(false); setLocatingClusterId(null); setHiddenNodes([]);
  }, [selectedAssemblyId, assemblies]);

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
    if (!pendingPin) return;

    try {
      const newMasterId = `${activeBrand.toUpperCase()}-${newPartType === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
      
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

      if (newPartType === 'Inventory') {
          newDoc.manufacturingSpecs = { ...baseSpecs };
      } else {
          newDoc.project = activeAssembly?.project || "";
          newDoc.manufacturingSpecs = { ...baseSpecs, basePrice: 0, cost: 0 };
      }

      await setDoc(doc(db, "Approved_Designs", newMasterId), newDoc);

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

  const filteredLibrary = libraryParts.filter(p => 
      (p.partClass === 'Inventory' || p.partClass === 'Assembly') && 
      ((p.itemName && p.itemName.toLowerCase().includes(searchQuery.toLowerCase())) || 
      (p.legacyErpId && p.legacyErpId.toLowerCase().includes(searchQuery.toLowerCase())))
  );

  let canvasCursor = 'default';
  if (interactionMode === 'pan' && viewMode === '2D' && !isFrozen) canvasCursor = isPanning ? 'grabbing' : 'grab';
  else if (interactionMode === 'pin' && isFrozen) canvasCursor = 'crosshair';

  const visiblePins = pins.filter(p => 
      viewMode === '3D' ? p.imageUrl === '3D_CAD' : (p.imageUrl === activeImageUrl || (!p.imageUrl && activeImageUrl === activeAssembly?.finalImageUrl))
  );

  const unassignedClusters = (activeAssembly?.nodeClusters || []).filter(cluster => {
      return !pins.some(pin => pin.clusterId === cluster.id || pin.targetNode === cluster.nodes?.join(', '));
  });
  
  const activeLocatingNodes = activeAssembly?.nodeClusters?.find(c => c.id === locatingClusterId)?.nodes || [];

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

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1 }}>
        
        {viewMode === '3D' && activeAssembly && (
            <div style={{ width: '280px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                <div style={{ padding: '16px 20px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Evil Eye</span>
                    <button onClick={() => setHiddenNodes([])} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer' }}>Show All</button>
                </div>
                <div style={{ padding: '20px', flex: 1, overflowY: 'auto', background: '#fff' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '16px', fontStyle: 'italic' }}>Uncheck to hide parts for clean screenshots.</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {sceneMeshes.map(meshObj => (
                            <label key={meshObj.originalName} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', background: hiddenNodes.includes(meshObj.originalName) ? 'var(--paper-2)' : '#fff', padding: '8px 12px', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                                <input 
                                    type="checkbox" 
                                    checked={!hiddenNodes.includes(meshObj.originalName)} 
                                    onChange={(e) => {
                                        if (e.target.checked) setHiddenNodes(prev => prev.filter(n => n !== meshObj.originalName));
                                        else setHiddenNodes(prev => [...prev, meshObj.originalName]);
                                    }} 
                                />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={meshObj.displayName}>
                                    {meshObj.displayName}
                                </span>
                            </label>
                        ))}
                    </div>
                </div>
            </div>
        )}

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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {viewMode === '3D' && unassignedClusters.length > 0 && (
                    <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', borderRadius: '2px' }}>
                        <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '8px' }}>
                            Unassigned Clusters
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '16px' }}>These 3D groupings have not been converted into BOM items yet.</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {unassignedClusters.map(cl => {
                                const isLocating = locatingClusterId === cl.id;
                                return (
                                <div key={cl.id} style={{ display: 'flex', gap: '8px' }}>
                                    <button 
                                        onClick={() => setLocatingClusterId(isLocating ? null : cl.id)}
                                        style={{ padding: '12px', background: isLocating ? 'var(--paper)' : '#fff', color: isLocating ? 'var(--ink)' : 'var(--ink-soft)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0 }}
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

                <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--paper-2)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Master BOM</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{pins.length} Components</span>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#fff' }}>
                        {pins.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', fontFamily: 'var(--serif)' }}>Drop pins on the image to build the BOM.</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {pins.map(pin => {
                                const libraryMatch = libraryParts.find(p => p.id === pin.partId);
                                const hasThumb = libraryMatch?.finalImageUrl;
                                return (
                                <div key={pin.id} style={{ background: 'var(--paper)', border: '1px solid var(--line)', borderLeft: `4px solid ${pin.isExistingLibraryPart ? 'var(--ink)' : 'var(--brass)'}`, padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                                        <div style={{ width: '48px', height: '48px', background: '#fff', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                            {hasThumb ? <img src={hasThumb} alt="" style={{width: '100%', height:'100%', objectFit:'contain'}}/> : <span style={{fontSize:'12px', color:'var(--ink-soft)'}}>No Img</span>}
                                        </div>
                                        <div>
                                            <div style={{ fontFamily: 'var(--sans)', fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)' }}>{pin.partName}</div>
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px' }}>{pin.legacyErpId}</div>
                                            {pin.clusterId ? (
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink)', background: 'var(--paper-2)', padding: '2px 6px', display: 'inline-block', marginTop: '6px', border: '1px solid var(--line)' }}>Clustered 3D Data</div>
                                            ) : pin.targetNode && (
                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--brass)', marginTop: '6px' }}>🎯 {pin.targetNode.substring(0, 20)}{pin.targetNode.length > 20 ? '...' : ''}</div>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                        
                                        <button 
                                            onClick={() => { setIsFrozen(true); setInteractionMode('crop'); setCropState({ pinId: pin.id, x: 50, y: 50, w: 250, h: 250, action: null }); }} 
                                            style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', fontSize: '9px', fontFamily: 'var(--mono)', textTransform: 'uppercase', cursor: 'pointer', padding: '8px 12px' }}
                                        >
                                            Crop
                                        </button>
                                        
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><label style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', marginBottom: '4px' }}>QTY</label><input type="number" min="1" value={pin.defaultQty || 1} onChange={(e) => handleUpdatePinQty(pin.id, e.target.value)} style={{ width: '48px', padding: '6px', border: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--sans)' }} /></div>
                                        <button onClick={(e) => handlePinClick(e, pin.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1rem', cursor: 'pointer', padding: '0' }}>Del</button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                </div>

                <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '20px 24px', background: 'var(--paper)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Parent Routing</div>
                    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block' }}>Classify Entire Image As:</label>
                        <select value={routingType} onChange={(e) => setRoutingType(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                            <option value="">-- Select Routing Type --</option>
                            {(globalLists.assemblyTypes || []).map(type => ( <option key={type} value={type}>{type}</option> ))}
                        </select>
                        <button onClick={handleSaveRouting} disabled={!activeAssembly || !routingType} style={{ padding: '16px', background: isSavingRouting ? 'var(--brass)' : 'var(--ink)', color: '#fff', border: 'none', cursor: (activeAssembly && routingType) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '8px', transition: 'background 0.2s' }}>{isSavingRouting ? "Saving..." : "Save Routing Type"}</button>
                    </div>
                </div>
            </div>
        )}
      </div>

      {drawerOpen && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: '500px', height: '100vh', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 32px rgba(0,0,0,0.1)', zIndex: 10005, borderLeft: '1px solid var(--line)' }}>
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Define Component</h3>
                <button onClick={() => { setDrawerOpen(false); setPendingPin(null); }} disabled={isProcessingCrop} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: isProcessingCrop ? 'not-allowed' : 'pointer' }}>×</button>
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
                      <div style={{ display: 'flex', gap: '12px' }}>
                          <button onClick={() => { setNewPartType("Inventory"); setNewPartRouting(""); }} style={{ flex: 1, padding: '12px', background: newPartType === "Inventory" ? 'var(--ink)' : 'var(--paper)', color: newPartType === "Inventory" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Raw Mat / Component</button>
                          <button onClick={() => setNewPartType("Assembly")} style={{ flex: 1, padding: '12px', background: newPartType === "Assembly" ? 'var(--ink)' : 'var(--paper)', color: newPartType === "Assembly" ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.2s' }}>Sub-Assembly / Kit</button>
                      </div>
                  </div>

                  {newPartType === "Inventory" ? (
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
                              <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginBottom: '4px' }}>
                                  {part.partClass === 'Assembly' && <span style={{ color: 'var(--ink)', background: 'var(--paper-2)', padding: '2px 4px', marginRight: '6px', border: '1px solid var(--line)' }}>ASM</span>}
                                  {part.legacyErpId !== "PENDING" && part.legacyErpId !== "N/A" ? part.legacyErpId : part.itemId}
                              </div>
                              <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: 'var(--ink)' }}>{part.itemName}</div>
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

    </div>
  );
};

export default VisualAssemblyTab;