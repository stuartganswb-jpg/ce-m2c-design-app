import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, updateDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const CROP_BOX_SIZE = 120; // Size of the draggable crop box in SVG units

const VisualAssemblyTab = ({ currentUser, activeBrand, onProceed }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [activeAssembly, setActiveAssembly] = useState(null);

  const [pins, setPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [creationMode, setCreationMode] = useState("EXISTING"); 
  const [searchQuery, setSearchQuery] = useState("");
  const [newPartName, setNewPartName] = useState("");
  const [isProcessingCrop, setIsProcessingCrop] = useState(false);

  // --- PENDING PIN & CROP STATE ---
  const [pendingPin, setPendingPin] = useState(null); 
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);

  // --- CPQ RULES STATE ---
  const [assemblyRules, setAssemblyRules] = useState({ isParametric: false, maxLength: "", splicePartId: "", basePriceOverride: "" });
  const [isSavingRules, setIsSavingRules] = useState(false);

  // --- CAMERA & VIEWPORT STATE ---
  const [interactionMode, setInteractionMode] = useState("pin"); 
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);

  const svgRef = useRef(null);
  const innerGroupRef = useRef(null);

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
    if (found?.cpqRules) setAssemblyRules(found.cpqRules);
    else setAssemblyRules({ isParametric: false, maxLength: "", splicePartId: "", basePriceOverride: "" });
    setScale(1); setPan({ x: 0, y: 0 });
    setPendingPin(null); 
  }, [selectedAssemblyId, assemblies]);

  useEffect(() => {
    if (!selectedAssemblyId) return;
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => setPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory"));
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
    const svg = svgRef.current; if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };

  const getAdjustedSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current; const group = innerGroupRef.current;
    if (!svg || !group) return { x: 0, y: 0 };
    const point = svg.createSVGPoint(); point.x = clientX; point.y = clientY;
    const transformed = point.matrixTransform(group.getScreenCTM().inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const onPointerDown = (e) => {
    if (!activeAssembly) return;
    if (e.target.dataset.draggable) return;

    e.target.setPointerCapture(e.pointerId);
    
    if (interactionMode === "pan") { 
      setIsPanning(true); setPanStart({ clientX: e.clientX, clientY: e.clientY }); return; 
    }
    
    if (interactionMode === "pin") {
      const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
      setPendingPin({ 
        pinX: pt.x, pinY: pt.y, 
        cropX: pt.x - (CROP_BOX_SIZE / 2), cropY: pt.y - (CROP_BOX_SIZE / 2) 
      });
    }
  };

  const onPointerMove = (e) => {
    if (interactionMode === "pan" && isPanning && panStart) {
      const rawCurrent = getBaseSvgPoint(e.clientX, e.clientY); const rawStart = getBaseSvgPoint(panStart.clientX, panStart.clientY);
      setPan(prev => ({ x: prev.x + (rawCurrent.x - rawStart.x), y: prev.y + (rawCurrent.y - rawStart.y) }));
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
    }
    
    if (isDraggingCrop && pendingPin) {
       const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
       setPendingPin(prev => ({ ...prev, cropX: pt.x - (CROP_BOX_SIZE / 2), cropY: pt.y - (CROP_BOX_SIZE / 2) }));
    }
  };

  const onPointerUp = () => { 
      if (interactionMode === "pan") { setIsPanning(false); setPanStart(null); } 
      if (isDraggingCrop) setIsDraggingCrop(false);
  };

  const handlePinClick = async (e, pinId) => {
    e.stopPropagation();
    if (window.confirm("Delete this component from the assembly?")) {
      try { await deleteDoc(doc(db, "assembly_pins", pinId)); } catch (err) { console.error(err); }
    }
  };

  const handleUpdatePinQty = async (pinId, newQty) => {
      try { await updateDoc(doc(db, "assembly_pins", pinId), { defaultQty: parseInt(newQty) || 1 }); } 
      catch (err) { console.error(err); }
  };

  const handleSaveAssemblyRules = async () => {
      if (!activeAssembly) return;
      setIsSavingRules(true);
      try {
          await updateDoc(doc(db, "Approved_Designs", activeAssembly.id), { cpqRules: assemblyRules });
          setTimeout(() => setIsSavingRules(false), 800);
      } catch (err) { console.error(err); setIsSavingRules(false); alert("Failed to save rules."); }
  };

  // ============================================================================
  // AUTO-CROP MATH: ACCURATELY ACCOUNTS FOR ASPECT RATIO LETTERBOXING
  // ============================================================================
  const generateCroppedThumbnail = async (imageUrl, cropX, cropY, cropW, cropH) => {
      return new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = "Anonymous"; 
          img.onload = () => {
              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              const cropSize = 300; 
              canvas.width = cropSize; canvas.height = cropSize;

              const imgRatio = img.naturalWidth / img.naturalHeight;
              let renderW, renderH, renderX, renderY;

              if (imgRatio > 1) {
                  renderW = 800;
                  renderH = 800 / imgRatio;
                  renderX = 100; 
                  renderY = 100 + (800 - renderH) / 2;
              } else {
                  renderW = 800 * imgRatio;
                  renderH = 800;
                  renderX = 100 + (800 - renderW) / 2;
                  renderY = 100; 
              }

              const relX = cropX - renderX;
              const relY = cropY - renderY;

              const scaleX = img.naturalWidth / renderW;
              const scaleY = img.naturalHeight / renderH;

              const sourceX = relX * scaleX;
              const sourceY = relY * scaleY;
              const sourceW = cropW * scaleX;
              const sourceH = cropH * scaleY;

              ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, cropSize, cropSize);

              canvas.toBlob((blob) => {
                  if (blob) resolve(blob);
                  else reject(new Error("Canvas blob conversion failed"));
              }, 'image/png');
          };
          img.onerror = () => reject(new Error("Failed to load image for cropping"));
          img.src = imageUrl;
      });
  };

  const saveNewCustomPart = async () => {
    if (!newPartName.trim()) return alert("Enter a part name.");
    if (!pendingPin) return;
    setIsProcessingCrop(true);

    try {
      let finalCroppedUrl = null;

      if (activeAssembly?.finalImageUrl) {
          try {
              const imageBlob = await generateCroppedThumbnail(activeAssembly.finalImageUrl, pendingPin.cropX, pendingPin.cropY, CROP_BOX_SIZE, CROP_BOX_SIZE);
              const thumbnailRef = ref(storage, `dynamic_assets/auto_crops/CROP_${Date.now()}.png`);
              await uploadBytes(thumbnailRef, imageBlob);
              finalCroppedUrl = await getDownloadURL(thumbnailRef);
          } catch (cropErr) {
              console.warn("Auto-Crop skipped (CORS).", cropErr);
          }
      }

      const newMasterId = `${activeBrand.toUpperCase()}-INV-${Math.floor(1000+Math.random()*9000)}`;
      await setDoc(doc(db, "Approved_Designs", newMasterId), {
          id: newMasterId, itemId: newMasterId, legacyErpId: "PENDING", itemName: newPartName.toUpperCase(),
          brandId: activeBrand, partClass: "Inventory", sharedBrands: [activeBrand],
          finalImageUrl: finalCroppedUrl, 
          manufacturingSpecs: { productType: "COMPONENT", uom: "EA", isInHouse: true, watchList: "NONE", status: "NEEDS_SPECS" },
          createdAt: new Date().toISOString()
      });

      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId, x: pendingPin.pinX, y: pendingPin.pinY,
        partName: newPartName.toUpperCase(), partId: newMasterId, legacyErpId: "PENDING",
        isExistingLibraryPart: false, status: "NEEDS_SPECS", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      
      setModalOpen(false);
      setPendingPin(null);
    } catch (err) { 
      console.error(err); alert("Failed to create part."); 
    } finally {
      setIsProcessingCrop(false);
    }
  };

  const saveExistingLibraryPart = async (part) => {
    if (!pendingPin) return;
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId, x: pendingPin.pinX, y: pendingPin.pinY,
        partName: part.itemName, partId: part.itemId, legacyErpId: part.legacyErpId || "N/A",
        isExistingLibraryPart: true, specs: part.manufacturingSpecs || {}, status: "SPECS_LOCKED", author: currentUser, defaultQty: 1,
        createdAt: serverTimestamp()
      });
      setModalOpen(false);
      setPendingPin(null);
    } catch (err) { console.error(err); }
  };

  const filteredLibrary = libraryParts.filter(p => (p.itemName && p.itemName.toLowerCase().includes(searchQuery.toLowerCase())) || (p.legacyErpId && p.legacyErpId.toLowerCase().includes(searchQuery.toLowerCase())));

  let canvasCursor = 'default';
  if (interactionMode === 'pan') canvasCursor = isPanning ? 'grabbing' : 'grab';
  else if (interactionMode === 'pin') canvasCursor = 'crosshair';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>2. Visual Assembly Details</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>BOM & CPQ RULES ENGINE</span></div>
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>MASTER ASSEMBLY:</label>
          <select value={selectedAssemblyId} onChange={(e) => setSelectedAssemblyId(e.target.value)} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '250px' }}>
            {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
            {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
          </select>
          <button onClick={onProceed} style={{ padding: '10px 20px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>PROCEED TO BOM ➔</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        {/* LEFT: SVG VISUALIZER */}
        <div style={{ flex: 1.5, background: '#fff', border: '2px solid #000', position: 'relative', overflow: 'hidden', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
          {activeAssembly && (
            <div style={{ padding: '10px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div style={{ display: 'flex', border: '2px solid #000' }}>
                 <button onClick={() => setInteractionMode("pin")} style={{ padding: '8px 15px', background: interactionMode === "pin" ? '#007bff' : '#fff', color: interactionMode === "pin" ? '#fff' : '#000', fontWeight: 'bold', border: 'none', borderRight: '1px solid #000', cursor: 'pointer', fontSize: '0.8rem' }}>📍 DROP PINS</button>
                 <button onClick={() => setInteractionMode("pan")} style={{ padding: '8px 15px', background: interactionMode === "pan" ? '#007bff' : '#fff', color: interactionMode === "pan" ? '#fff' : '#000', fontWeight: 'bold', border: 'none', cursor: 'pointer', fontSize: '0.8rem' }}>✋ PAN IMAGE</button>
              </div>
              <div style={{ height: '20px', width: '2px', background: '#ccc', margin: '0 10px' }}></div>
              <button onClick={handleZoomIn} style={{ padding: '8px 15px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>➕ ZOOM IN</button>
              <button onClick={handleZoomOut} style={{ padding: '8px 15px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>➖ ZOOM OUT</button>
              <button onClick={handleZoomReset} style={{ padding: '8px 15px', background: '#fff', border: '1px solid #000', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.8rem' }}>🔄 RESET VIEW</button>
            </div>
          )}

          <div style={{ flex: 1, position: 'relative' }}>
            {!activeAssembly ? ( <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}><h3>NO ASSEMBLY SELECTED</h3><p>Create a Master Assembly in Tab 1 first.</p></div> ) : (
              <svg ref={svgRef} viewBox="0 0 1000 1000" style={{ width: '100%', height: '100%', display: 'block', cursor: canvasCursor, touchAction: 'none' }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
                <g ref={innerGroupRef} transform={`translate(${pan.x}, ${pan.y}) translate(500, 500) scale(${scale}) translate(-500, -500)`}>
                  <image href={activeAssembly.finalImageUrl} x="100" y="100" width="800" height="800" preserveAspectRatio="xMidYMid meet" />
                  
                  {/* EXISTING SAVED PINS */}
                  {pins.map((pin) => {
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

                  {/* NEW STAGED PIN & DRAGGABLE CROP BOX */}
                  {pendingPin && !modalOpen && (
                      <g>
                          <rect 
                              data-draggable="true"
                              x={pendingPin.cropX} y={pendingPin.cropY} 
                              width={CROP_BOX_SIZE} height={CROP_BOX_SIZE}
                              fill="rgba(0,123,255,0.15)" stroke="#007bff" strokeWidth="3" strokeDasharray="6,6"
                              style={{ cursor: isDraggingCrop ? 'grabbing' : 'grab' }}
                              onPointerDown={(e) => { e.stopPropagation(); e.target.setPointerCapture(e.pointerId); setIsDraggingCrop(true); }}
                              onPointerUp={(e) => { e.stopPropagation(); setIsDraggingCrop(false); e.target.releasePointerCapture(e.pointerId); }}
                          />
                          <text x={pendingPin.cropX} y={pendingPin.cropY - 8} fill="#007bff" fontSize="14" fontWeight="bold">FRAME THUMBNAIL (DRAG ME)</text>

                          <path d={`M ${pendingPin.pinX} ${pendingPin.pinY} L ${pendingPin.pinX + 30} ${pendingPin.pinY - 40}`} fill="none" stroke="#28a745" strokeWidth="3" />
                          <circle cx={pendingPin.pinX} cy={pendingPin.pinY} r="8" fill="#28a745" stroke="#fff" strokeWidth="2" />

                          <g transform={`translate(${pendingPin.pinX + 30}, ${pendingPin.pinY - 60})`} style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); setModalOpen(true); setSearchQuery(""); setNewPartName(""); }}>
                              <rect x="0" y="0" width="130" height="35" fill="#28a745" rx="4" />
                              <text x="65" y="22" fill="#fff" fontSize="14" fontWeight="bold" textAnchor="middle">DEFINE PART ➔</text>
                          </g>
                          
                          <g transform={`translate(${pendingPin.pinX - 45}, ${pendingPin.pinY - 60})`} style={{ cursor: 'pointer' }} onPointerDown={(e) => { e.stopPropagation(); setPendingPin(null); }}>
                              <rect x="0" y="0" width="35" height="35" fill="#d9534f" rx="4" />
                              <text x="17.5" y="24" fill="#fff" fontSize="18" fontWeight="bold" textAnchor="middle">×</text>
                          </g>
                      </g>
                  )}
                </g>
              </svg>
            )}
          </div>
        </div>

        {/* RIGHT: BOM & CPQ RULES */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                <div style={{ padding: '12px 15px', background: '#007bff', color: '#fff', borderBottom: '2px solid #000', fontWeight: 'bold' }}>📋 MASTER BOM ({pins.length} COMPONENTS)</div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa' }}>
                    {pins.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '20px', fontStyle: 'italic' }}>Drop pins on the image to build the BOM.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {pins.map(pin => (
                            <div key={pin.id} style={{ background: '#fff', border: '1px solid #ccc', borderLeft: `5px solid ${pin.isExistingLibraryPart ? '#007bff' : '#d9534f'}`, padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div><div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{pin.partName}</div><div style={{ fontSize: '0.65rem', color: '#666' }}>{pin.legacyErpId} | {pin.isExistingLibraryPart ? 'LIBRARY PART' : 'NEW CUSTOM PART'}</div></div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><label style={{ fontSize: '0.6rem', fontWeight: 'bold', color: '#666' }}>BASE QTY</label><input type="number" min="1" value={pin.defaultQty || 1} onChange={(e) => handleUpdatePinQty(pin.id, e.target.value)} style={{ width: '50px', padding: '5px', border: '2px solid #007bff', textAlign: 'center', fontWeight: 'bold' }} /></div>
                                    <button onClick={(e) => handlePinClick(e, pin.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', padding: '0 5px' }}>🗑️</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
                <div style={{ padding: '12px 15px', background: '#28a745', color: '#fff', borderBottom: '2px solid #000', fontWeight: 'bold' }}>⚙️ ASSEMBLY CPQ RULES</div>
                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <label style={{ fontSize: '0.85rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '10px', background: assemblyRules.isParametric ? '#eafaf1' : '#f8f9fa', border: `2px solid ${assemblyRules.isParametric ? '#28a745' : '#ccc'}` }}>
                        <input type="checkbox" checked={assemblyRules.isParametric || false} onChange={(e) => setAssemblyRules({...assemblyRules, isParametric: e.target.checked})} style={{ transform: 'scale(1.2)' }} /> REQUIRES DIMENSIONAL CONFIGURATION
                    </label>
                    <div style={{ display: 'flex', gap: '15px', opacity: assemblyRules.isParametric ? 1 : 0.5, pointerEvents: assemblyRules.isParametric ? 'auto' : 'none' }}>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#d9534f' }}>MAX LENGTH BFR SPLICE (IN):</label><input type="number" value={assemblyRules.maxLength} onChange={(e) => setAssemblyRules({...assemblyRules, maxLength: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
                        <div style={{ flex: 2 }}>
                            <label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>AUTO-ADD SPLICE PART (TAB 4):</label>
                            <select value={assemblyRules.splicePartId} onChange={(e) => setAssemblyRules({...assemblyRules, splicePartId: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }}>
                                <option value="">-- NO SPLICE DEFINED --</option>{libraryParts.map(p => <option key={p.id} value={p.itemId}>{p.itemName}</option>)}
                            </select>
                        </div>
                    </div>
                    <button onClick={handleSaveAssemblyRules} disabled={!activeAssembly} style={{ padding: '15px', background: isSavingRules ? '#17a2b8' : '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: activeAssembly ? 'pointer' : 'not-allowed', fontSize: '1rem', marginTop: '5px' }}>{isSavingRules ? "RULES SAVED ✓" : "💾 SAVE CPQ LOGIC"}</button>
                </div>
            </div>
        </div>
      </div>

      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', border: '4px solid #000', width: '600px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '15px 15px 0 #000' }}>
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h3 style={{ margin: 0, fontSize: '1.2rem' }}>DEFINE COMPONENT</h3><button onClick={() => setModalOpen(false)} disabled={isProcessingCrop} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: isProcessingCrop ? 'not-allowed' : 'pointer' }}>×</button></div>
            <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
              <button onClick={() => setCreationMode("EXISTING")} disabled={isProcessingCrop} style={{ flex: 1, padding: '15px', background: creationMode === "EXISTING" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', borderRight: '2px solid #000', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "EXISTING" ? '#007bff' : '#666' }}>🔍 SELECT FROM LIBRARY</button>
              <button onClick={() => setCreationMode("NEW")} disabled={isProcessingCrop} style={{ flex: 1, padding: '15px', background: creationMode === "NEW" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', color: creationMode === "NEW" ? '#d9534f' : '#666' }}>➕ CREATE CUSTOM PART</button>
            </div>
            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', background: '#f9f9f9' }}>
              {creationMode === "NEW" && (
                <div style={{ padding: '20px', background: '#fff', border: '2px dashed #d9534f' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#d9534f' }}>NEW CUSTOM COMPONENT</h4>
                  <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '15px' }}>This creates a new Master Part in Tab 4, links it to this BOM, and saves the thumbnail you framed.</p>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ENTER PART NAME / DESCRIPTION:</label>
                  <input autoFocus value={newPartName} onChange={(e) => setNewPartName(e.target.value)} disabled={isProcessingCrop} placeholder="e.g. CUSTOM EXTENSION ROD 48 INCH" style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', textTransform: 'uppercase' }} />
                  <button onClick={saveNewCustomPart} disabled={isProcessingCrop} style={{ width: '100%', padding: '15px', background: isProcessingCrop ? '#ccc' : '#d9534f', color: '#fff', fontWeight: 'bold', border: 'none', cursor: isProcessingCrop ? 'not-allowed' : 'pointer', transition: '0.2s' }}>
                    {isProcessingCrop ? '⚙️ CROPPING & SAVING...' : 'SAVE & CREATE MASTER PART'}
                  </button>
                </div>
              )}
              {creationMode === "EXISTING" && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
                  <input autoFocus placeholder="Search Library by Name or ID..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #007bff', boxSizing: 'border-box', marginBottom: '15px', fontSize: '1rem' }} />
                  <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', background: '#fff' }}>
                    {filteredLibrary.length === 0 ? ( <div style={{ padding: '30px', textAlign: 'center', color: '#999', fontWeight: 'bold' }}>NO MATCHING PARTS FOUND</div> ) : (
                      filteredLibrary.map(part => (
                        <div key={part.id} onClick={() => saveExistingLibraryPart(part)} style={{ display: 'flex', gap: '15px', alignItems: 'center', padding: '10px 15px', borderBottom: '1px solid #eee', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = '#f0f8ff'} onMouseOut={(e) => e.currentTarget.style.background = '#fff'}>
                          <div style={{ flex: 1 }}><div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>{part.brandId !== activeBrand && <span style={{ color: '#000', background: '#ffc107', padding: '2px 4px', fontSize: '0.6rem', marginRight: '5px' }}>{part.brandId.toUpperCase()}</span>}{part.legacyErpId !== "PENDING" && part.legacyErpId !== "N/A" ? part.legacyErpId : part.itemId}</div><div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#000' }}>{part.itemName}</div></div>
                          <div style={{ width: '60px', height: '60px', background: '#f4f4f4', border: '1px solid #ccc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{part.finalImageUrl ? <img src={part.finalImageUrl} alt={part.itemName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: '1.2rem', color: '#ccc' }}>⚙️</span>}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default VisualAssemblyTab;