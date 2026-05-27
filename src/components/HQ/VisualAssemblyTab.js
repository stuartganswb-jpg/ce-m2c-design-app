import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html } from '@react-three/drei';

const SnapshotModel = ({ url, interactionMode, onMeshClick, isFrozen }) => {
    const { scene } = useGLTF(url);
    const clonedScene = useMemo(() => scene.clone(true), [scene]);
    const isPinMode = interactionMode === 'pin';
    
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
  const [assemblyTypesList, setAssemblyTypesList] = useState(["STANDARD", "MASTER", "OUTSOURCE KIT"]); 
  const [cpqRoutingTypes, setCpqRoutingTypes] = useState([]); 
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  
  const [creationMode, setCreationMode] = useState("EXISTING"); 
  const [searchQuery, setSearchQuery] = useState("");
  const [newPartName, setNewPartName] = useState("");
  const [newPartType, setNewPartType] = useState("Inventory"); 
  const [newPartRouting, setNewPartRouting] = useState("");
  
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

  // 🚀 UNIFIED FREEZE STATE
  const [isFrozen, setIsFrozen] = useState(false);

  // 📸 CROP STUDIO STATE
  const [cropState, setCropState] = useState(null); 
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);

  const svgRef = useRef(null);
  const innerGroupRef = useRef(null);

  useEffect(() => {
      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
          if (docSnap.exists()){
              const data = docSnap.data();
              let types = data.assemblyTypes || [];
              types = types.filter(t => !t.toUpperCase().includes('INSTRUCT'));
              
              const uppercaseTypes = types.map(t => t.toUpperCase());
              if (!uppercaseTypes.includes("MASTER")) types.unshift("MASTER");
              if (!uppercaseTypes.includes("STANDARD")) types.unshift("STANDARD");
              
              setAssemblyTypesList(types);
              setCpqRoutingTypes(data.cpqRoutingTypes || []); 
          }
      });
      return () => unsubLists();
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
    
    setScale(1); setPan({ x: 0, y: 0 }); setPendingPin(null); setIsCanvasLocked(true); setDrawerOpen(false); setCropState(null); setIsFrozen(false);
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

  const saveNewCustomPart = async () => {
    if (!newPartName.trim()) return alert("Enter a name for the new entity.");
    if (newPartType === 'Assembly' && !newPartRouting) return alert("Please select a Routing Type for this Sub-Assembly.");
    if (!pendingPin) return;

    try {
      const newMasterId = `${activeBrand.toUpperCase()}-${newPartType === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
      
      const newDoc = {
          id: newMasterId, itemId: newMasterId, legacyErpId: "PENDING", itemName: newPartName.toUpperCase(),
          brandId: activeBrand, partClass: newPartType, sharedBrands: [activeBrand],
          createdAt: new Date().toISOString()
      };

      if (newPartType === 'Inventory') {
          newDoc.manufacturingSpecs = { productType: "COMPONENT", uom: "EA", isInHouse: true, watchList: "NONE", status: "NEEDS_SPECS" };
      } else {
          newDoc.routingType = newPartRouting;
          newDoc.manufacturingSpecs = { basePrice: 0, cost: 0, isInHouse: true };
          newDoc.collection = activeAssembly?.collection || "N/A";
          newDoc.project = activeAssembly?.project || "";
      }

      await setDoc(doc(db, "Approved_Designs", newMasterId), newDoc);

      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId, 
        x: viewMode === '3D' ? pendingPin.x : pendingPin.pinX, 
        y: viewMode === '3D' ? pendingPin.y : pendingPin.pinY,
        z: viewMode === '3D' ? pendingPin.z : null,
        targetNode: pendingPin.targetNode || "", 
        imageUrl: viewMode === '3D' ? '3D_CAD' : activeImageUrl,
        partName: newPartName.toUpperCase(), partId: newMasterId, legacyErpId: "PENDING",
        isExistingLibraryPart: false, status: "NEEDS_SPECS", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      
      setDrawerOpen(false); setPendingPin(null);
      setIsCanvasMaximized(false);
    } catch (err) { console.error(err); alert("Failed to create part."); }
  };

  const saveExistingLibraryPart = async (part) => {
    if (!pendingPin) return;
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId, 
        x: viewMode === '3D' ? pendingPin.x : pendingPin.pinX, 
        y: viewMode === '3D' ? pendingPin.y : pendingPin.pinY,
        z: viewMode === '3D' ? pendingPin.z : null,
        targetNode: pendingPin.targetNode || "", 
        imageUrl: viewMode === '3D' ? '3D_CAD' : activeImageUrl, 
        partName: part.itemName, partId: part.itemId, legacyErpId: part.legacyErpId || "N/A",
        isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: "SPECS_LOCKED", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      setDrawerOpen(false); setPendingPin(null);
      setIsCanvasMaximized(false);
    } catch (err) { console.error(err); }
  };

  // =====================================
  // 📸 UNIVERSAL 2D & 3D CROP LOGIC
  // =====================================
  const onCropPointerDown = (e, actionType) => {
      e.stopPropagation();
      e.target.setPointerCapture(e.pointerId);
      setCropState(prev => ({ ...prev, action: actionType, startX: e.clientX, startY: e.clientY, origX: prev.x, origY: prev.y, origW: prev.w, origH: prev.h }));
  };

  const onCropPointerMove = (e) => {
      if (!cropState || !cropState.action) return;
      const dx = e.clientX - cropState.startX;
      const dy = e.clientY - cropState.startY;

      if (cropState.action === 'MOVE') {
          setCropState(prev => ({ ...prev, x: prev.origX + dx, y: prev.origY + dy }));
      } else if (cropState.action === 'RESIZE') {
          setCropState(prev => ({ ...prev, w: Math.max(80, prev.origW + dx), h: Math.max(80, prev.origH + dy) }));
      }
  };

  const onCropPointerUp = (e) => {
      if (!cropState || !cropState.action) return;
      e.target.releasePointerCapture(e.pointerId);
      setCropState(prev => ({ ...prev, action: null }));
  };

  const executeThumbnailCrop = async () => {
      if (!cropState || !cropState.pinId) return alert("Please select a BOM Component from the dropdown to attach this thumbnail to.");
      setIsProcessingCrop(true);

      try {
          const targetPin = pins.find(p => p.id === cropState.pinId);
          if (!targetPin) throw new Error("Pin not found.");

          const targetSize = 512; 
          const cropCanvas = document.createElement('canvas');
          cropCanvas.width = targetSize;
          cropCanvas.height = targetSize;
          const ctx = cropCanvas.getContext('2d');

          // 🧊 3D CROP LOGIC
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

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetSize, targetSize);
              ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetSize, targetSize);
          } 
          // 🖼️ 2D CROP LOGIC (MATH TRANSLATION)
          else {
              const container = document.getElementById('canvas-container');
              const rect = container.getBoundingClientRect();
              
              const img = new Image();
              img.crossOrigin = "Anonymous";
              img.src = activeImageUrl;
              await new Promise(r => img.onload = r);

              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, targetSize, targetSize);

              // Map crop box to the target canvas
              ctx.scale(targetSize / cropState.w, targetSize / cropState.h);
              ctx.translate(-cropState.x, -cropState.y);

              // SVG container is always 1000x1000 mapped to the rect
              const svgRatioX = rect.width / 1000;
              const svgRatioY = rect.height / 1000;
              const cx = 500 * svgRatioX;
              const cy = 500 * svgRatioY;
              const panPx = (pan.x || 0) * svgRatioX;
              const panPy = (pan.y || 0) * svgRatioY;

              // Apply the user's pan and scale
              ctx.translate(panPx, panPy);
              ctx.translate(cx, cy);
              ctx.scale(scale, scale);
              ctx.translate(-cx, -cy);

              // Draw the image exactly where the SVG placed it
              ctx.drawImage(img, 100 * svgRatioX, 100 * svgRatioY, 800 * svgRatioX, 800 * svgRatioY);
          }

          // 💾 UPLOAD TO STORAGE
          cropCanvas.toBlob(async (blob) => {
              const thumbRef = ref(storage, `dynamic_assets/auto_crops/${targetPin.partId}_${Date.now()}.png`);
              await uploadBytes(thumbRef, blob);
              const dlUrl = await getDownloadURL(thumbRef);
              
              await updateDoc(doc(db, "Approved_Designs", targetPin.partId), { finalImageUrl: dlUrl });
              await updateDoc(doc(db, "assembly_pins", targetPin.id), { imageUrl: dlUrl });
              
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

  const canvasContainerStyle = isCanvasMaximized ? {
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 9999, 
      background: '#e5e5e5', display: 'flex', flexDirection: 'column', boxSizing: 'border-box'
  } : {
      border: '2px solid #d9534f', background: '#e5e5e5', display: 'flex', flexDirection: 'column', flex: 1, minHeight: '600px', overflow: 'hidden', position: 'relative'
  };

  const showLockOverlay = isCanvasLocked && !isCanvasMaximized;

  // Generic Button Styling
  const getToolStyle = (mode) => ({
      padding: '8px 15px',
      background: interactionMode === mode ? '#28a745' : '#fff',
      color: interactionMode === mode ? '#fff' : '#000',
      border: '1px solid #000',
      borderRadius: '20px',
      fontWeight: 'bold',
      fontSize: '0.8rem',
      cursor: 'pointer',
      boxShadow: interactionMode === mode ? '2px 2px 0 #1e7e34' : 'none'
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      {!isCanvasMaximized && (
          <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
            <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>2. Visual Assembly Details</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>BOM BUILDER & ROUTING</span></div>
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>MASTER ASSEMBLY:</label>
              <select value={selectedAssemblyId} onChange={(e) => setSelectedAssemblyId(e.target.value)} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '250px' }}>
                {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
                {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
              </select>
              <button onClick={onProceed} style={{ padding: '10px 20px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>PROCEED TO BOM ➔</button>
            </div>
          </div>
      )}

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        <div style={canvasContainerStyle} id="canvas-container">
          
          {/* 📸 THE UNIVERSAL CROP STUDIO */}
          {cropState && (
              <div 
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10000, overflow: 'hidden' }}
                  onPointerMove={onCropPointerMove}
                  onPointerUp={onCropPointerUp}
              >
                  <div style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '10px 20px', border: '3px solid #000', borderRadius: '30px', fontWeight: 'bold', display: 'flex', gap: '10px', alignItems: 'center', boxShadow: '0 8px 16px rgba(0,0,0,0.4)', zIndex: 10001 }}>
                      <span style={{ color: '#007bff' }}>📸 FRAME & CROP</span>
                      
                      <select value={cropState.pinId || ""} onChange={(e) => setCropState({...cropState, pinId: e.target.value})} style={{ padding: '8px', border: '2px solid #007bff', borderRadius: '4px', fontWeight: 'bold', outline: 'none' }}>
                          <option value="">-- SELECT BOM COMPONENT --</option>
                          {pins.map(p => <option key={p.id} value={p.id}>{p.partName}</option>)}
                      </select>

                      <button onClick={executeThumbnailCrop} disabled={!cropState.pinId || isProcessingCrop} style={{ background: cropState.pinId ? '#28a745' : '#ccc', color: '#fff', padding: '8px 15px', border: 'none', borderRadius: '20px', fontWeight: 'bold', cursor: cropState.pinId ? 'pointer' : 'not-allowed' }}>{isProcessingCrop ? 'SAVING...' : '✅ SNAP & SAVE'}</button>
                      <button onClick={() => { setCropState(null); setIsFrozen(true); setInteractionMode('pin'); }} disabled={isProcessingCrop} style={{ background: '#d9534f', color: '#fff', padding: '8px 15px', border: 'none', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer' }}>CANCEL</button>
                  </div>

                  <div 
                      style={{ position: 'absolute', top: cropState.y, left: cropState.x, width: cropState.w, height: cropState.h, border: '4px dashed #fff', boxShadow: '0 0 0 9999px rgba(0,0,0,0.65)', cursor: cropState.action === 'MOVE' ? 'grabbing' : 'move' }}
                      onPointerDown={(e) => onCropPointerDown(e, 'MOVE')}
                  >
                      <div 
                          style={{ position: 'absolute', bottom: -6, right: -6, width: 24, height: 24, background: '#fff', border: '3px solid #000', cursor: 'nwse-resize', borderRadius: '50%' }}
                          onPointerDown={(e) => onCropPointerDown(e, 'RESIZE')}
                      />
                  </div>
              </div>
          )}

          {/* 🔲 MAXIMIZED TOOLBAR */}
          {isCanvasMaximized && (
              <div style={{ position: 'absolute', top: '15px', left: '50%', transform: 'translateX(-50%)', zIndex: 9990, background: '#fff', border: '2px solid #000', borderRadius: '30px', padding: '5px', display: 'flex', gap: '5px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                  <div style={{ display: 'flex', border: '2px solid #007bff', borderRadius: '20px', overflow: 'hidden', marginRight: '10px' }}>
                      <button onClick={() => { setViewMode('2D'); setIsFrozen(false); setInteractionMode('pan'); }} style={{ padding: '5px 15px', background: viewMode === '2D' ? '#007bff' : '#fff', color: viewMode === '2D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>🖼️ 2D</button>
                      <button onClick={() => { setViewMode('3D'); setIsFrozen(false); setInteractionMode('pan'); }} disabled={!activeAssembly?.manufacturingSpecs?.cadUrl} style={{ padding: '5px 15px', background: viewMode === '3D' ? '#007bff' : '#fff', color: viewMode === '3D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: activeAssembly?.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly?.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontSize: '0.8rem' }}>🧊 3D</button>
                  </div>
                  
                  {!isFrozen ? (
                      <>
                          <button onClick={() => setInteractionMode('pan')} style={getToolStyle('pan')}>🖐️ NAVIGATE</button>
                          <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                          {viewMode === '2D' && (
                              <>
                                  <button onClick={handleZoomIn} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>➕</button>
                                  <button onClick={handleZoomOut} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }}>➖</button>
                                  <div style={{ width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                              </>
                          )}
                          <button onClick={() => { setIsFrozen(true); setInteractionMode('pin'); }} style={{ padding: '8px 15px', background: '#007bff', color: '#fff', border: '1px solid #004085', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>📸 FREEZE VIEWER</button>
                      </>
                  ) : (
                      <>
                          <button onClick={() => { setInteractionMode('pin'); setCropState(null); }} style={getToolStyle('pin')}>📍 DROP PINS</button>
                          <button onClick={() => { setInteractionMode('crop'); setCropState({ x: 50, y: 50, w: 250, h: 250, action: null, pinId: '' }); }} style={getToolStyle('crop')}>📸 CAPTURE THUMBNAIL</button>
                          <button onClick={() => { setIsFrozen(false); setInteractionMode('pan'); setCropState(null); }} style={{ padding: '8px 15px', background: '#d9534f', color: '#fff', border: '1px solid #851c19', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>🔓 UNFREEZE</button>
                      </>
                  )}

                  <div style={{ width: '2px', background: '#ccc', margin: '0 5px' }}></div>
                  <button onClick={() => setIsCanvasMaximized(false)} style={{ padding: '8px 20px', background: '#d9534f', color: '#fff', border: 'none', borderRadius: '20px', fontWeight: 'bold', fontSize: '0.8rem', cursor: 'pointer' }}>✅ CLOSE FULLSCREEN</button>
              </div>
          )}

          {/* 🔲 STANDARD TOOLBAR */}
          {!isCanvasMaximized && activeAssembly && (
            <div style={{ padding: '10px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', border: '2px solid #007bff', borderRadius: '4px', overflow: 'hidden' }}>
                  <button onClick={() => { setViewMode('2D'); setIsFrozen(false); setInteractionMode('pan'); }} style={{ padding: '5px 15px', background: viewMode === '2D' ? '#007bff' : '#fff', color: viewMode === '2D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>🖼️ 2D IMAGE</button>
                  <button onClick={() => { setViewMode('3D'); setIsFrozen(false); setInteractionMode('pan'); }} disabled={!activeAssembly.manufacturingSpecs?.cadUrl} style={{ padding: '5px 15px', background: viewMode === '3D' ? '#007bff' : '#fff', color: viewMode === '3D' ? '#fff' : '#007bff', fontWeight: 'bold', border: 'none', cursor: activeAssembly.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontSize: '0.8rem' }}>🧊 3D CAD</button>
              </div>

              {viewMode === '2D' && availableImages.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>VIEW ANGLE:</label>
                      <select value={activeImageUrl} onChange={(e) => { setActiveImageUrl(e.target.value); setPendingPin(null); setIsFrozen(false); }} style={{ padding: '5px', border: '2px solid #000', fontWeight: 'bold', outline: 'none' }}>
                          {availableImages.map((img, idx) => <option key={idx} value={img.url}>{img.name}</option>)}
                      </select>
                  </div>
              )}

              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                  {!isFrozen ? (
                      <>
                          <button onClick={() => setInteractionMode('pan')} style={{ padding: '6px 12px', background: interactionMode === 'pan' ? '#000' : '#fff', color: interactionMode === 'pan' ? '#fff' : '#000', fontWeight: 'bold', border: '1px solid #000', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>🖐️ NAVIGATE</button>
                          
                          {viewMode === '2D' && (
                              <>
                                  <div style={{ height: '20px', width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                                  <button onClick={handleZoomIn} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>➕ ZOOM</button>
                                  <button onClick={handleZoomOut} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>➖ ZOOM</button>
                                  <button onClick={handleZoomReset} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>🔄 RESET</button>
                              </>
                          )}

                          <div style={{ height: '20px', width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                          <button onClick={() => { setIsFrozen(true); setInteractionMode('pin'); }} style={{ padding: '6px 12px', background: '#007bff', color: '#fff', fontWeight: 'bold', border: '1px solid #004085', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>📸 FREEZE VIEWER</button>
                      </>
                  ) : (
                      <>
                          <button onClick={() => { setInteractionMode('pin'); setCropState(null); }} style={{ padding: '6px 12px', background: interactionMode === 'pin' ? '#28a745' : '#fff', color: interactionMode === 'pin' ? '#fff' : '#000', fontWeight: 'bold', border: '1px solid #1e7e34', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>📍 DROP PINS</button>
                          <button onClick={() => { setInteractionMode('crop'); setCropState({ x: 50, y: 50, w: 250, h: 250, action: null, pinId: '' }); }} style={{ padding: '6px 12px', background: interactionMode === 'crop' ? '#17a2b8' : '#fff', color: interactionMode === 'crop' ? '#fff' : '#000', fontWeight: 'bold', border: '1px solid #117a8b', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>📸 CAPTURE THUMBNAIL</button>
                          
                          <div style={{ height: '20px', width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                          <button onClick={() => { setIsFrozen(false); setInteractionMode('pan'); setCropState(null); }} style={{ padding: '6px 12px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: '1px solid #851c19', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>🔓 UNFREEZE</button>
                      </>
                  )}
                  
                  <div style={{ height: '20px', width: '1px', background: '#ccc', margin: '0 5px' }}></div>
                  <button onClick={() => { setIsCanvasMaximized(true); setIsCanvasLocked(false); }} style={{ padding: '6px 12px', background: '#000', color: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem', borderRadius: '4px' }}>🔲 MAXIMIZE</button>
              </div>
            </div>
          )}

          <div style={{ position: 'relative', flex: 1, background: '#e5e5e5', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
            
                {showLockOverlay && (
                    <div onClick={() => setIsCanvasLocked(false)} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 100, background: 'rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <div style={{ background: '#000', color: '#fff', padding: '15px 30px', fontWeight: 'bold', borderRadius: '30px', fontSize: '1.2rem', boxShadow: '0 8px 16px rgba(0,0,0,0.4)', pointerEvents: 'none' }}>
                            🖱️ CLICK TO UNLOCK & INTERACT
                        </div>
                    </div>
                )}

                {!isCanvasLocked && !isCanvasMaximized && (
                    <div style={{ position: 'absolute', bottom: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 100 }}>
                        <button onClick={() => setIsCanvasLocked(true)} style={{ background: '#d9534f', color: '#fff', padding: '10px 20px', fontWeight: 'bold', border: '2px solid #fff', borderRadius: '30px', cursor: 'pointer', boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                            🔒 LOCK CANVAS TO SCROLL PAGE
                        </button>
                    </div>
                )}

                {!activeAssembly ? ( <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}><h3>NO ASSEMBLY SELECTED</h3><p>Create a Master Assembly in Tab 1 first.</p></div> ) : 
                 
                 viewMode === '3D' ? (
                    <React.Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', fontWeight: 'bold', color: '#007bff' }}>⏳ LOADING 3D ENGINE...</div>}>
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
                                    />
                                </Bounds>

                                {/* Hide pins if cropping to keep the image clean */}
                                {!cropState && visiblePins.map(pin => {
                                    if (pin.imageUrl !== '3D_CAD' || pin.z === undefined) return null;
                                    const boxColor = pin.isExistingLibraryPart ? '#007bff' : '#d9534f';
                                    return (
                                        <Html key={pin.id} position={[pin.x, pin.y, pin.z]} zIndexRange={[100, 0]}>
                                            <div 
                                                onClick={(e) => { e.stopPropagation(); handlePinClick(e, pin.id); }}
                                                style={{ width: '15px', height: '15px', background: boxColor, borderRadius: '50%', border: '2px solid #fff', cursor: 'pointer', transform: 'translate(-50%, -50%)', boxShadow: '0 0 5px rgba(0,0,0,0.5)' }} 
                                                title={`${pin.partName} (${pin.targetNode})`}
                                            />
                                        </Html>
                                    )
                                })}
                            </Canvas>
                        </div>
                    </React.Suspense>
                 ) : (
                  <svg ref={svgRef} viewBox="0 0 1000 1000" style={{ width: '100%', height: '100%', display: 'block', cursor: canvasCursor, touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                    <g ref={innerGroupRef} transform={`translate(${pan.x || 0}, ${pan.y || 0}) translate(500, 500) scale(${scale || 1}) translate(-500, -500)`}>
                      
                      {activeImageUrl && <image href={activeImageUrl} x="100" y="100" width="800" height="800" preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: 'none' }} />}
                      
                      {!cropState && visiblePins.map((pin) => {
                        const isRightHalf = pin.x > 500; const elbowX = isRightHalf ? pin.x + 40 : pin.x - 40; const elbowY = pin.y - 50; const landingX = isRightHalf ? 800 : 20; const boxColor = pin.isExistingLibraryPart ? '#007bff' : '#d9534f'; 
                        return (
                          <g key={pin.id} onPointerDown={(e) => handlePinClick(e, pin.id)} style={{ cursor: 'pointer' }}>
                            <path d={`M ${pin.x} ${pin.y} L ${elbowX} ${elbowY} L ${landingX} ${elbowY}`} fill="none" stroke={boxColor} strokeWidth="2" />
                            <circle cx={pin.x} cy={pin.y} r="8" fill={boxColor} stroke="#fff" strokeWidth="2" />
                            <rect x={landingX} y={elbowY - 20} width="180" height="40" fill="#fff" stroke={boxColor} strokeWidth="2" />
                            <text x={landingX + 10} y={elbowY + 5} fill="#000" fontSize="12" fontWeight="bold">{pin.partName.length > 20 ? pin.partName.substring(0, 18) + "..." : pin.partName}</text>
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '12px 15px', background: '#007bff', color: '#fff', borderBottom: '2px solid #000', fontWeight: 'bold' }}>📋 MASTER BOM ({pins.length} COMPONENTS)</div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa' }}>
                        {pins.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '20px', fontStyle: 'italic' }}>Drop pins on the image to build the BOM.</div>}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {pins.map(pin => {
                                const libraryMatch = libraryParts.find(p => p.id === pin.partId);
                                const hasThumb = libraryMatch?.finalImageUrl;
                                return (
                                <div key={pin.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: `5px solid ${pin.isExistingLibraryPart ? '#007bff' : '#d9534f'}`, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                        <div style={{ width: '40px', height: '40px', background: '#eee', border: '1px solid #ccc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {hasThumb ? <img src={hasThumb} alt="" style={{width: '100%', height:'100%', objectFit:'contain'}}/> : <span style={{fontSize:'0.6rem', color:'#999'}}>No Img</span>}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{pin.partName}</div>
                                            <div style={{ fontSize: '0.65rem', color: '#666' }}>{pin.legacyErpId}</div>
                                            {pin.targetNode && <div style={{ fontSize: '0.65rem', color: '#e83e8c', fontWeight: 'bold' }}>🎯 {pin.targetNode.substring(0, 20)}{pin.targetNode.length > 20 ? '...' : ''}</div>}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        
                                        {/* 🚀 QUICK CROP SHORTCUT: Auto-freezes and pre-selects the part! */}
                                        <button 
                                            onClick={() => { setIsFrozen(true); setInteractionMode('crop'); setCropState({ pinId: pin.id, x: 50, y: 50, w: 250, h: 250, action: null }); }} 
                                            style={{ background: '#fff', border: '2px solid #007bff', color: '#007bff', fontSize: '0.7rem', fontWeight: 'bold', cursor: 'pointer', padding: '5px 10px', borderRadius: '4px' }}
                                        >
                                            📸 CROP
                                        </button>
                                        
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666' }}>QTY</label><input type="number" min="1" value={pin.defaultQty || 1} onChange={(e) => handleUpdatePinQty(pin.id, e.target.value)} style={{ width: '40px', padding: '4px', border: '2px solid #007bff', textAlign: 'center', fontWeight: 'bold' }} /></div>
                                        <button onClick={(e) => handlePinClick(e, pin.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', padding: '0 5px' }}>🗑️</button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                </div>

                <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '12px 15px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', fontWeight: 'bold' }}>🛤️ [PARENT] ENTIRE ASSEMBLY ROUTING</div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>CLASSIFY THIS ENTIRE IMAGE AS:</label>
                        <select value={routingType} onChange={(e) => setRoutingType(e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold', textTransform: 'uppercase' }}>
                            <option value="">-- SELECT ROUTING TYPE --</option>
                            {assemblyTypesList.map(type => ( <option key={type} value={type}>{type}</option> ))}
                        </select>
                        <button onClick={handleSaveRouting} disabled={!activeAssembly || !routingType} style={{ padding: '15px', background: isSavingRouting ? '#17a2b8' : '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: (activeAssembly && routingType) ? 'pointer' : 'not-allowed', fontSize: '1rem', marginTop: '5px' }}>{isSavingRouting ? "ROUTING SAVED ✓" : "💾 SAVE ROUTING TYPE"}</button>
                    </div>
                </div>
            </div>
        )}
      </div>

      {drawerOpen && (
        <div style={{ position: 'fixed', top: 0, right: 0, width: '500px', height: '100vh', backgroundColor: '#fff', display: 'flex', flexDirection: 'column', boxShadow: '-10px 0 20px rgba(0,0,0,0.5)', zIndex: 10005, borderLeft: '4px solid #000' }}>
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>[CHILD] DEFINE PINNED COMPONENT</h3>
                <button onClick={() => { setDrawerOpen(false); setPendingPin(null); }} disabled={isProcessingCrop} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: isProcessingCrop ? 'not-allowed' : 'pointer' }}>×</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
              <button onClick={() => setCreationMode("EXISTING")} disabled={isProcessingCrop} style={{ flex: 1, padding: '15px', background: creationMode === "EXISTING" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', borderRight: '2px solid #000', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "EXISTING" ? '#007bff' : '#666' }}>🔍 SELECT FROM LIBRARY</button>
              <button onClick={() => setCreationMode("NEW")} disabled={isProcessingCrop} style={{ flex: 1, padding: '15px', background: creationMode === "NEW" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "NEW" ? '#d9534f' : '#666' }}>➕ CREATE NEW PART</button>
            </div>
            
            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', background: '#f9f9f9' }}>
              
              {pendingPin?.targetNode !== undefined && viewMode === '3D' && (
                  <div style={{ background: '#e3f2fd', border: '1px solid #007bff', padding: '10px', fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      
                      {activeAssembly?.nodeClusters?.length > 0 && (
                          <div style={{ marginBottom: '10px', background: '#eafaf1', border: '1px solid #28a745', padding: '10px' }}>
                              <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#1e7e34', marginBottom: '5px' }}>📦 PRE-DEFINED SUB-ASSEMBLIES (FROM TAB 2.5):</div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                  {activeAssembly.nodeClusters.map(cluster => (
                                      <span 
                                          key={cluster.id} 
                                          onClick={() => setPendingPin(prev => ({...prev, targetNode: prev.targetNode ? `${prev.targetNode}, ${cluster.meshes.join(', ')}` : cluster.meshes.join(', ')}))} 
                                          style={{ background: '#28a745', color: '#fff', padding: '4px 8px', fontSize: '0.65rem', cursor: 'pointer', borderRadius: '4px', fontWeight: 'bold', boxShadow: '2px 2px 0 rgba(0,0,0,0.1)' }}
                                      >
                                          {cluster.name} ({cluster.meshes.length} Meshes)
                                      </span>
                                  ))}
                              </div>
                          </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                          <span style={{ fontSize: '1.5rem', marginTop: '2px' }}>🎯</span>
                          <div style={{ flex: 1 }}>
                              <div style={{ color: '#000', fontSize: '0.9rem' }}>3D MESHES TARGETED</div>
                              <div style={{ fontSize: '0.65rem', color: '#666', marginBottom: '5px' }}>Click other meshes on the model to add them to this group!</div>
                              <input 
                                  value={pendingPin.targetNode} 
                                  onChange={(e) => setPendingPin({...pendingPin, targetNode: e.target.value})}
                                  style={{ width: '100%', padding: '8px', border: '1px solid #007bff', boxSizing: 'border-box', fontWeight: 'bold', fontFamily: 'monospace', color: '#000' }}
                              />
                          </div>
                      </div>
                  </div>
              )}

              {creationMode === "NEW" && (
                <div style={{ padding: '20px', background: '#fff', border: '2px dashed #d9534f' }}>
                  <h4 style={{ margin: '0 0 15px 0', color: '#d9534f' }}>WHAT DOES THIS SPECIFIC PIN REPRESENT?</h4>
                  
                  <div style={{ marginBottom: '15px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ENTITY TYPE:</label>
                      <div style={{ display: 'flex', gap: '10px' }}>
                          <button onClick={() => { setNewPartType("Inventory"); setNewPartRouting(""); }} style={{ flex: 1, padding: '10px', background: newPartType === "Inventory" ? '#000' : '#eee', color: newPartType === "Inventory" ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>RAW MAT / COMPONENT</button>
                          <button onClick={() => setNewPartType("Assembly")} style={{ flex: 1, padding: '10px', background: newPartType === "Assembly" ? '#000' : '#eee', color: newPartType === "Assembly" ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>SUB-ASSEMBLY / KIT</button>
                      </div>
                  </div>

                  {newPartType === "Assembly" && (
                      <div style={{ marginBottom: '15px', background: '#eafaf1', padding: '10px', border: '1px solid #28a745' }}>
                          <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#1e7e34' }}>ROUTING CLASSIFICATION:</label>
                          <select value={newPartRouting} onChange={(e) => setNewPartRouting(e.target.value)} style={{ width: '100%', padding: '10px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold' }}>
                              <option value="">-- SELECT ROUTING --</option>
                              {assemblyTypesList.map(type => ( <option key={type} value={type}>{type}</option> ))}
                          </select>
                      </div>
                  )}

                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ENTER ENTITY NAME / DESCRIPTION:</label>
                  <input autoFocus value={newPartName} onChange={(e) => setNewPartName(e.target.value)} disabled={isProcessingCrop} placeholder="e.g. UPPER EXTENSION POLE" style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', textTransform: 'uppercase' }} />
                  
                  <button onClick={saveNewCustomPart} disabled={isProcessingCrop || (newPartType === 'Assembly' && !newPartRouting)} style={{ width: '100%', padding: '15px', background: (isProcessingCrop || (newPartType === 'Assembly' && !newPartRouting)) ? '#ccc' : '#d9534f', color: '#fff', fontWeight: 'bold', border: 'none', cursor: (isProcessingCrop || (newPartType === 'Assembly' && !newPartRouting)) ? 'not-allowed' : 'pointer', transition: '0.2s' }}>
                    SAVE & CREATE NEW {newPartType.toUpperCase()}
                  </button>
                </div>
              )}
              {creationMode === "EXISTING" && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
                  <input autoFocus placeholder="Search Master Library by Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', boxSizing: 'border-box', marginBottom: '15px', fontSize: '1rem' }} />
                  <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', background: '#fff' }}>
                    {filteredLibrary.length === 0 ? ( <div style={{ padding: '30px', textAlign: 'center', color: '#999', fontWeight: 'bold' }}>NO MATCHING PARTS FOUND</div> ) : (
                      filteredLibrary.map(part => (
                        <div key={part.id} onClick={() => saveExistingLibraryPart(part)} style={{ display: 'flex', gap: '15px', alignItems: 'center', padding: '10px 15px', borderBottom: '1px solid #eee', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = '#f0f8ff'} onMouseOut={(e) => e.currentTarget.style.background = '#fff'}>
                          <div style={{ flex: 1 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>
                                  {part.partClass === 'Assembly' && <span style={{ color: '#fff', background: '#28a745', padding: '2px 4px', fontSize: '0.6rem', marginRight: '5px' }}>ASM</span>}
                                  {part.legacyErpId !== "PENDING" && part.legacyErpId !== "N/A" ? part.legacyErpId : part.itemId}
                              </div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#000' }}>{part.itemName}</div>
                          </div>
                          <div style={{ width: '60px', height: '60px', background: '#f4f4f4', border: '1px solid #ccc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{part.finalImageUrl ? <img src={part.finalImageUrl} alt={part.itemName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '1.2rem', color: '#ccc' }}>⚙️</span>}</div>
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