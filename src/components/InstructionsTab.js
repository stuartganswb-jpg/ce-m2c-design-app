import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const InstructionsTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [activeAssembly, setActiveAssembly] = useState(null);

  const [pins, setPins] = useState([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [instructionText, setInstructionText] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [docMode, setDocMode] = useState("ASSEMBLY"); 

  const [customImageFile, setCustomImageFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  
  const [activeTool, setActiveTool] = useState("none"); 
  const [drawStart, setDrawStart] = useState(null);
  const [drawCurrent, setDrawCurrent] = useState(null);
  const [currentPath, setCurrentPath] = useState(null); 
  
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
  }, [selectedAssemblyId, assemblies]);

  useEffect(() => {
    if (!selectedAssemblyId) return;
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetchedPins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      let sequencedPins = fetchedPins.filter(p => p.specs?.buildSequence);
      sequencedPins.sort((a, b) => parseInt(a.specs.buildSequence) - parseInt(b.specs.buildSequence));
      setPins(sequencedPins);
      setCurrentStepIndex(0); 
    });
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (pins.length > 0 && pins[currentStepIndex]) {
      const activePin = pins[currentStepIndex];
      const textKey = docMode === "ASSEMBLY" ? "assemblyNote" : docMode === "FABRICATION" ? "fabricationNote" : "installationNote";
      const fallback = docMode === "ASSEMBLY" ? (activePin.instructionNote || "") : "";
      setInstructionText(activePin[textKey] || fallback);
    } else {
      setInstructionText("");
    }
    setActiveTool("none");
    setCustomImageFile(null);
    setCurrentPath(null);
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [currentStepIndex, pins, docMode]);

  const handleNext = () => { if (currentStepIndex < pins.length - 1) setCurrentStepIndex(prev => prev + 1); };
  const handlePrev = () => { if (currentStepIndex > 0) setCurrentStepIndex(prev => prev - 1); };

  const saveInstruction = async () => {
    const activePin = pins[currentStepIndex];
    if (!activePin) return;

    setIsSaving(true);
    const textKey = docMode === "ASSEMBLY" ? "assemblyNote" : docMode === "FABRICATION" ? "fabricationNote" : "installationNote";

    try {
      await updateDoc(doc(db, "assembly_pins", activePin.id), {
        [textKey]: instructionText
      });
      setTimeout(() => setIsSaving(false), 500);
    } catch (err) {
      console.error("Error saving instruction:", err);
      setIsSaving(false);
      alert("Failed to save. Check console.");
    }
  };

  const handleCustomImageUpload = async () => {
    const activePin = pins[currentStepIndex];
    if (!activePin || !customImageFile) return;

    const storageRef = ref(storage, `instructions/${activeBrand}_${activePin.partId}_step${activePin.specs.buildSequence}_${customImageFile.name}`);
    const uploadTask = uploadBytesResumable(storageRef, customImageFile);
    
    uploadTask.on("state_changed", 
      (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => { console.error(err); alert("Upload failed."); setUploadProgress(0); },
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        await updateDoc(doc(db, "assembly_pins", activePin.id), { customImageUrl: url });
        setUploadProgress(0);
        setCustomImageFile(null);
      }
    );
  };

  const removeCustomImage = async () => {
    if(window.confirm("Remove this custom step image?")) {
      await updateDoc(doc(db, "assembly_pins", pins[currentStepIndex].id), { customImageUrl: null });
    }
  };

  const handleZoomIn = () => setScale(prev => Math.min(prev + 0.25, 4)); 
  const handleZoomOut = () => setScale(prev => Math.max(prev - 0.25, 0.5)); 
  const handleZoomReset = () => { setScale(1); setPan({ x: 0, y: 0 }); };

  const getBaseSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  };

  const getAdjustedSvgPoint = (clientX, clientY) => {
    const svg = svgRef.current;
    const group = innerGroupRef.current;
    if (!svg || !group) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const transformed = point.matrixTransform(group.getScreenCTM().inverse());
    return { x: transformed.x, y: transformed.y };
  };

  const saveAnnotation = async (newAnnotation) => {
    const activePin = pins[currentStepIndex];
    if (!activePin) return;
    const updatedAnnotations = [...(activePin.annotations || []), newAnnotation];
    try {
      await updateDoc(doc(db, "assembly_pins", activePin.id), { annotations: updatedAnnotations });
    } catch (err) {
      console.error("Failed to save annotation:", err);
    }
  };

  const pushStepToLibrary = async () => {
    const activePin = pins[currentStepIndex];
    if (!activePin || activePin.partId === "PENDING-NEW") return alert("Part ID must be established in Master Library first.");

    try {
      const stepData = {
        assemblyId: selectedAssemblyId,
        stepNote: instructionText,
        mode: docMode,
        imageUrl: activePin.customImageUrl || activeAssembly.finalImageUrl,
        annotations: activePin.annotations || []
      };

      await setDoc(doc(db, "Approved_Designs", activePin.partId, "linked_instructions", `step_${activePin.specs.buildSequence}`), stepData);
      alert(`SUCCESS: Visual Step data saved to Master Library under Part ID: ${activePin.partId}`);
    } catch (err) {
      console.error(err);
      alert("Error saving to library.");
    }
  };

  const onPointerDown = (e) => {
    if (activeTool === "none") return;
    e.target.setPointerCapture(e.pointerId);

    if (activeTool === "pan") {
      setIsPanning(true);
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
      return;
    }

    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);

    if (activeTool === "text") {
      const txt = window.prompt("Enter callout text for this point:");
      if (txt) {
        const isRight = pt.x > 500;
        const elbowX = isRight ? pt.x + 30 : pt.x - 30;
        const elbowY = pt.y - 40;
        const landingX = isRight ? pt.x + 150 : pt.x - 150; 
        
        saveAnnotation({ 
          type: 'callout', 
          text: txt.toUpperCase(), 
          x: pt.x, y: pt.y, 
          elbowX, elbowY, landingX, 
          color: '#ff0000' 
        });
      }
      setActiveTool("none");
      return;
    }

    setDrawStart(pt);
    setDrawCurrent(pt);
    if (activeTool === "freehand") setCurrentPath([pt]);
  };

  const onPointerMove = (e) => {
    if (activeTool === "pan" && isPanning && panStart) {
      const rawCurrent = getBaseSvgPoint(e.clientX, e.clientY);
      const rawStart = getBaseSvgPoint(panStart.clientX, panStart.clientY);

      setPan(prev => ({
        x: prev.x + (rawCurrent.x - rawStart.x),
        y: prev.y + (rawCurrent.y - rawStart.y)
      }));
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (activeTool === "none" || !drawStart) return;
    const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
    setDrawCurrent(pt);
    if (activeTool === "freehand") setCurrentPath(prev => [...prev, pt]);
  };

  const onPointerUp = async (e) => {
    if (activeTool === "pan") { setIsPanning(false); setPanStart(null); return; }
    if (activeTool === "none" || !drawStart) return;
    
    if (activeTool === "freehand" && currentPath && currentPath.length > 2) {
      await saveAnnotation({ type: 'freehand', points: currentPath, color: '#ff0000', width: 2 });
    } else if (activeTool.startsWith("arrow") && drawCurrent) {
      await saveAnnotation({ type: activeTool, start: drawStart, end: drawCurrent, color: '#ff0000', width: 2 });
    }
    
    setDrawStart(null);
    setDrawCurrent(null);
    setCurrentPath(null);
  };

  const clearAnnotations = async () => {
    if(window.confirm("Clear all red drawings from this step?")) {
      await updateDoc(doc(db, "assembly_pins", pins[currentStepIndex].id), { annotations: [] });
    }
  };

  const activePin = pins[currentStepIndex];
  const displayImageUrl = activePin?.customImageUrl || activeAssembly?.finalImageUrl || "https://via.placeholder.com/600x600?text=NO+IMAGE";
  const hasCustomImage = !!activePin?.customImageUrl;

  const renderArrowPath = (start, end, toolType) => {
    if (toolType === 'arrow') return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const r = dist * 0.75; 
    const sweep = toolType === 'arrow-cw' ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 0 ${sweep} ${end.x} ${end.y}`;
  };

  let canvasCursor = 'default';
  if (activeTool === 'pan') canvasCursor = isPanning ? 'grabbing' : 'grab';
  else if (activeTool !== 'none') canvasCursor = 'crosshair';

  return (
    <div className="instructions-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* THE UPDATED PRINT CSS ENGINE */}
      <style>{`
        .print-notes { display: none; }
        .print-only-part { display: none; }
        @media print {
          body * { visibility: hidden; }
          .instructions-container { background: white !important; padding: 0 !important; }
          .print-area, .print-area * { visibility: visible; }
          .print-area { position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: flex; flex-direction: column; }
          .no-print { display: none !important; }
          
          /* Show the dynamically generated instruction text and Part ID at the bottom of the PDF */
          .print-notes { display: block !important; margin-top: auto; padding: 20px; border-top: 3px solid #000; font-size: 1.2rem; font-family: sans-serif; white-space: pre-wrap; color: #000; background: #fff; }
          .print-only-part { display: block !important; }
        }
      `}</style>

      {/* 3-WAY MODE SWITCHER (Hidden on Print) */}
      <div className="no-print" style={{ display: 'flex', border: '2px solid #000', background: '#fff' }}>
        <button onClick={() => setDocMode("ASSEMBLY")} style={{ flex: 1, padding: '15px', border: 'none', background: docMode === "ASSEMBLY" ? '#000' : 'transparent', color: docMode === "ASSEMBLY" ? '#fff' : '#000', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>⚙️ ASSEMBLY ROUTING</button>
        <button onClick={() => setDocMode("FABRICATION")} style={{ flex: 1, padding: '15px', border: 'none', borderLeft: '1px solid #ccc', borderRight: '1px solid #ccc', background: docMode === "FABRICATION" ? '#007bff' : 'transparent', color: docMode === "FABRICATION" ? '#fff' : '#007bff', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>📐 FABRICATION ROUTING</button>
        <button onClick={() => setDocMode("INSTALLATION")} style={{ flex: 1, padding: '15px', border: 'none', background: docMode === "INSTALLATION" ? '#d9534f' : 'transparent', color: docMode === "INSTALLATION" ? '#fff' : '#d9534f', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>📦 INSTALLATION MANUAL</button>
      </div>

      {/* HEADER (Hidden on Print, replaced by internal layout below) */}
      <div className="no-print" style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.2rem', color: docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000') }}>
          6. {docMode} INSTRUCTIONS
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <select value={selectedAssemblyId} onChange={(e) => setSelectedAssemblyId(e.target.value)} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '250px' }}>
            {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
          </select>
          <button onClick={() => window.print()} style={{ padding: '10px 15px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
            🖨️ EXPORT PDF
          </button>
        </div>
      </div>

      {/* THE PRINT AREA: Only this layout prints to the PDF */}
      <div className="print-area" style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        {/* LEFT SIDE: CANVAS */}
        <div style={{ flex: 3, position: 'relative', width: '100%', backgroundColor: '#fff', border: '2px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
          
          {/* UPDATED HEADER: Includes Master ERP ID and Component ID */}
          <div style={{ padding: '15px', background: docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000'), color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>
              {activeAssembly?.legacyErpId && activeAssembly.legacyErpId !== "N/A" ? `${activeAssembly.legacyErpId} : ` : ""}
              {activeAssembly?.itemName || "MASTER ASSEMBLY"} 
              {" | "}STEP {activePin?.specs?.buildSequence || "-"}
            </span>
            <span className="no-print" style={{ fontSize: '0.8rem', color: '#ffc107' }}>
              {activeTool !== "none" && `● ${activeTool.toUpperCase()} TOOL ACTIVE`}
            </span>
            <span className="print-only-part" style={{ fontSize: '1rem', fontWeight: 'bold' }}>
              PART ID: {activePin?.legacyErpId !== "PENDING" && activePin?.legacyErpId !== "N/A" ? activePin?.legacyErpId : activePin?.partId}
            </span>
          </div>

          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {pins.length === 0 ? (
              <div className="no-print" style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
                <h3>NO SEQUENCED PARTS FOUND</h3>
                <p>Please return to Tab 3 (BOM & Specs) and assign a "BUILD SEQ #" to the parts.</p>
              </div>
            ) : (
              <svg 
                ref={svgRef}
                viewBox="0 0 1000 1000" 
                style={{ width: '100%', height: '100%', display: 'block', cursor: canvasCursor, touchAction: 'none' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
              >
                <defs>
                  <marker id="fine-arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">
                    <path d="M 0 2 L 10 6 L 0 10 L 3 6 Z" fill="#ff0000" />
                  </marker>
                </defs>

                <g ref={innerGroupRef} transform={`translate(${pan.x}, ${pan.y}) translate(500, 500) scale(${scale}) translate(-500, -500)`}>
                  <image href={displayImageUrl} x="100" y="100" width="800" height="800" preserveAspectRatio="xMidYMid meet" />
                  
                  {!hasCustomImage && pins.map((pin, index) => {
                    const isRightHalf = pin.x > 500;
                    const elbowX = isRightHalf ? pin.x + 40 : pin.x - 40;
                    const elbowY = pin.y - 50;
                    const landingX = isRightHalf ? 760 : 10;
                    const boxColor = docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : (pin.isExistingLibraryPart ? '#000' : '#d9534f')); 
                    const isActive = index === currentStepIndex;

                    if (isActive) {
                      return (
                        <g key={pin.id} style={{ transition: 'all 0.3s ease' }}>
                          <path d={`M ${pin.x} ${pin.y} L ${elbowX} ${elbowY} L ${landingX} ${elbowY}`} fill="none" stroke={boxColor} strokeWidth="3" />
                          <circle cx={pin.x} cy={pin.y} r="6" fill={boxColor} stroke="#fff" strokeWidth="2" />
                          <circle className="no-print" cx={pin.x} cy={pin.y} r="16" fill="none" stroke="#ffc107" strokeWidth="3" strokeDasharray="4" />
                          <rect x={landingX} y={elbowY - 25} width="230" height="50" fill="#fff" stroke={boxColor} strokeWidth="3" />
                          <text x={landingX + 10} y={elbowY - 5} fill="#000" fontSize="12" fontWeight="bold">
                            {pin.partName.length > 25 ? pin.partName.substring(0, 25) + "..." : pin.partName}
                          </text>
                          <text x={landingX + 10} y={elbowY + 15} fill={boxColor} fontSize="11" fontWeight="bold">STEP {pin.specs?.buildSequence}</text>
                        </g>
                      );
                    } else {
                      return (
                        <g key={pin.id} style={{ opacity: 0.2 }}>
                          <circle cx={pin.x} cy={pin.y} r="4" fill={boxColor} />
                        </g>
                      );
                    }
                  })}

                  {activePin?.annotations?.map((anno, i) => {
                    if (anno.type === 'freehand' || (!anno.type && anno.points)) {
                       return <path key={i} d={`M ${anno.points.map(p => `${p.x},${p.y}`).join(" L ")}`} fill="none" stroke={anno.color} strokeWidth="2" strokeLinecap="round" />
                    }
                    if (anno.type && anno.type.startsWith('arrow')) {
                       return <path key={i} d={renderArrowPath(anno.start, anno.end, anno.type)} fill="none" stroke={anno.color} strokeWidth="2" markerEnd="url(#fine-arrow)" />
                    }
                    if (anno.type === 'callout') {
                       const rectWidth = Math.max(100, (anno.text.length * 8) + 20);
                       const rectX = anno.landingX > anno.x ? anno.landingX : anno.landingX - rectWidth;
                       return (
                         <g key={i}>
                           <path d={`M ${anno.x} ${anno.y} L ${anno.elbowX} ${anno.elbowY} L ${anno.landingX} ${anno.elbowY}`} fill="none" stroke={anno.color} strokeWidth="2" strokeDasharray="4" />
                           <circle cx={anno.x} cy={anno.y} r="4" fill={anno.color} />
                           <rect x={rectX} y={anno.elbowY - 15} width={rectWidth} height="30" fill="#fff" stroke={anno.color} strokeWidth="2" />
                           <text x={rectX + 10} y={anno.elbowY + 4} fill="#000" fontSize="12" fontWeight="bold" fontFamily="sans-serif">{anno.text}</text>
                         </g>
                       )
                    }
                    return null;
                  })}

                  {activeTool === 'freehand' && currentPath && (
                    <path d={`M ${currentPath.map(p => `${p.x},${p.y}`).join(" L ")}`} fill="none" stroke="#ff0000" strokeWidth="2" strokeLinecap="round" />
                  )}
                  {activeTool.startsWith('arrow') && drawStart && drawCurrent && (
                    <path d={renderArrowPath(drawStart, drawCurrent, activeTool)} fill="none" stroke="#ff0000" strokeWidth="2" markerEnd="url(#fine-arrow)" />
                  )}
                </g>
              </svg>
            )}
          </div>

          {/* THE NEW PRINT FOOTER: This text block only appears on the final exported PDF */}
          <div className="print-notes">
            <strong style={{ display: 'block', marginBottom: '8px', textTransform: 'uppercase', color: docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000') }}>
              {docMode} NOTES & PROTOCOL:
            </strong>
            {instructionText || "No notes provided for this step."}
          </div>

        </div>

        {/* RIGHT SIDE: AUTHORING PANEL (Hidden entirely on Print) */}
        <div className="no-print" style={{ flex: 1, backgroundColor: '#fff', borderLeft: '3px solid #000', display: 'flex', flexDirection: 'column' }}>
          
          <div style={{ padding: '20px', background: '#f4f4f4', borderBottom: '2px solid #000' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
               <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>JUMP TO STEP:</span>
               <select value={currentStepIndex} onChange={(e) => setCurrentStepIndex(Number(e.target.value))} disabled={pins.length === 0} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', background: '#ffc107', cursor: 'pointer' }}>
                 {pins.map((pin, index) => (
                   <option key={pin.id} value={index}>STEP {pin.specs?.buildSequence} - {pin.legacyErpId !== "PENDING" && pin.legacyErpId !== "N/A" ? pin.legacyErpId : pin.partName.substring(0,10)}</option>
                 ))}
               </select>
            </div>
            
            <p style={{ margin: 0, fontWeight: 'bold', fontSize: '1rem', color: docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000') }}>{activePin ? activePin.partName : "Awaiting Data"}</p>
            <p style={{ margin: '5px 0 0 0', color: '#666', fontSize: '0.8rem', fontWeight: 'bold' }}>ERP ID: {activePin?.legacyErpId !== "PENDING" && activePin?.legacyErpId !== "N/A" ? activePin?.legacyErpId : activePin?.partId}</p>
          </div>

          {activePin && (
            <div style={{ padding: '15px', borderBottom: '2px solid #eee', background: '#fff' }}>
              
              <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                <button onClick={() => setActiveTool(activeTool === "pan" ? "none" : "pan")} style={{ flex: 1, padding: '8px', background: activeTool === "pan" ? '#007bff' : '#eee', color: activeTool === "pan" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>✋ PAN</button>
                <button onClick={handleZoomIn} style={{ flex: 1, padding: '8px', background: '#eee', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>➕ ZOOM</button>
                <button onClick={handleZoomOut} style={{ flex: 1, padding: '8px', background: '#eee', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>➖ OUT</button>
                <button onClick={handleZoomReset} style={{ flex: 1, padding: '8px', background: '#eee', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>🔄 RESET</button>
              </div>

              <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>DRAWING TOOLS (RED ANNOTATIONS):</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px', marginBottom: '15px' }}>
                <button onClick={() => setActiveTool(activeTool === "freehand" ? "none" : "freehand")} style={{ padding: '8px', background: activeTool === "freehand" ? '#ff0000' : '#eee', color: activeTool === "freehand" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>〰️ DRAW</button>
                <button onClick={() => setActiveTool(activeTool === "arrow" ? "none" : "arrow")} style={{ padding: '8px', background: activeTool === "arrow" ? '#ff0000' : '#eee', color: activeTool === "arrow" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>↗️ ARROW</button>
                <button onClick={() => setActiveTool(activeTool === "arrow-cw" ? "none" : "arrow-cw")} style={{ padding: '8px', background: activeTool === "arrow-cw" ? '#ff0000' : '#eee', color: activeTool === "arrow-cw" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>↻ CURVE CW</button>
                <button onClick={() => setActiveTool(activeTool === "arrow-ccw" ? "none" : "arrow-ccw")} style={{ padding: '8px', background: activeTool === "arrow-ccw" ? '#ff0000' : '#eee', color: activeTool === "arrow-ccw" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>↺ CURVE CCW</button>
                <button onClick={() => setActiveTool(activeTool === "text" ? "none" : "text")} style={{ gridColumn: 'span 2', padding: '8px', background: activeTool === "text" ? '#ff0000' : '#eee', color: activeTool === "text" ? '#fff' : '#000', border: '1px solid #ccc', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.7rem' }}>🔤 CALLOUT BOX</button>
              </div>

              <div style={{ background: '#f9f9f9', padding: '10px', border: '1px dashed #ccc' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>OVERRIDE MASTER IMAGE:</label>
                <input type="file" onChange={(e) => setCustomImageFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%', marginBottom: '5px' }} />
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button onClick={handleCustomImageUpload} disabled={!customImageFile} style={{ flex: 2, padding: '5px', background: customImageFile ? '#007bff' : '#ccc', color: '#fff', border: 'none', cursor: customImageFile ? 'pointer' : 'not-allowed', fontSize: '0.7rem', fontWeight: 'bold' }}>UPLOAD</button>
                  {hasCustomImage && <button onClick={removeCustomImage} style={{ flex: 1, padding: '5px', background: '#d9534f', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 'bold' }}>REMOVE</button>}
                </div>
                {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
              </div>
            </div>
          )}

          <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{docMode} NOTES:</label>
              <button onClick={clearAnnotations} disabled={!activePin?.annotations?.length} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '0.7rem', fontWeight: 'bold', cursor: !activePin?.annotations?.length ? 'not-allowed' : 'pointer', textDecoration: 'underline' }}>CLEAR DRAWINGS</button>
            </div>
            
            <textarea 
              value={instructionText}
              onChange={(e) => setInstructionText(e.target.value)}
              disabled={pins.length === 0}
              placeholder={docMode === "ASSEMBLY" ? "e.g. Apply Red Loctite to threads before inserting. Torque to 15 ft-lbs." : docMode === "FABRICATION" ? "e.g. Turn down outer diameter to 0.500\" +/- 0.005\"." : "e.g. Pass ground wire through canopy and secure with locknut before hanging."}
              style={{ flex: 1, width: '100%', padding: '15px', border: `2px solid ${docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000')}`, boxSizing: 'border-box', fontSize: '1rem', resize: 'none', lineHeight: '1.5', fontFamily: 'sans-serif' }}
            />
            
            <button onClick={saveInstruction} disabled={pins.length === 0} style={{ marginTop: '15px', padding: '15px', background: isSaving ? '#28a745' : (docMode === "FABRICATION" ? '#007bff' : (docMode === "INSTALLATION" ? '#d9534f' : '#000')), color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '1rem', cursor: pins.length === 0 ? 'not-allowed' : 'pointer', transition: 'background 0.3s' }}>
              {isSaving ? "SAVED ✓" : `SAVE ${docMode} STEP`}
            </button>
            
            <button onClick={pushStepToLibrary} disabled={pins.length === 0} style={{ marginTop: '10px', padding: '15px', background: '#fff', color: '#000', border: '2px solid #000', fontWeight: 'bold', fontSize: '0.9rem', cursor: pins.length === 0 ? 'not-allowed' : 'pointer' }}>
              💾 PUSH VIEW TO LIBRARY
            </button>
          </div>

          <div style={{ padding: '20px', borderTop: '2px solid #000', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eee' }}>
            <button onClick={handlePrev} disabled={currentStepIndex === 0} style={{ padding: '10px 15px', border: '2px solid #000', background: currentStepIndex === 0 ? '#ccc' : '#fff', fontWeight: 'bold', cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer' }}>◄ PREV</button>
            <button onClick={handleNext} disabled={pins.length === 0 || currentStepIndex === pins.length - 1} style={{ padding: '10px 15px', border: '2px solid #000', background: pins.length === 0 || currentStepIndex === pins.length - 1 ? '#ccc' : '#fff', fontWeight: 'bold', cursor: pins.length === 0 || currentStepIndex === pins.length - 1 ? 'not-allowed' : 'pointer' }}>NEXT ►</button>
          </div>

        </div>
      </div>
    </div>
  );
};

export default InstructionsTab;