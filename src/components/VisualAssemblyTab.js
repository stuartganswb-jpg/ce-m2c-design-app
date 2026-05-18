import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore";

const VisualAssemblyTab = ({ currentUser, activeBrand, onProceed }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [activeAssembly, setActiveAssembly] = useState(null);

  const [pins, setPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  const [modalOpen, setModalOpen] = useState(false);
  const [pinCoords, setPinCoords] = useState({ x: 0, y: 0 });
  const [creationMode, setCreationMode] = useState("EXISTING"); 
  
  const [searchQuery, setSearchQuery] = useState("");
  const [newPartName, setNewPartName] = useState("");

  // --- NEW: CAMERA & VIEWPORT STATE ---
  const [interactionMode, setInteractionMode] = useState("pin"); // "pin" or "pan"
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);

  const svgRef = useRef(null);
  const innerGroupRef = useRef(null); // Reference for the scaled/panned group

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
    // Reset view when switching assemblies
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [selectedAssemblyId, assemblies]);

  useEffect(() => {
    if (!selectedAssemblyId) return;
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
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

  // --- CAMERA MATH ---
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

  // --- POINTER EVENTS ---
  const onPointerDown = (e) => {
    if (!activeAssembly) return;
    e.target.setPointerCapture(e.pointerId);

    if (interactionMode === "pan") {
      setIsPanning(true);
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
      return;
    }

    if (interactionMode === "pin") {
      const pt = getAdjustedSvgPoint(e.clientX, e.clientY);
      setPinCoords({ x: pt.x, y: pt.y });
      setModalOpen(true);
      setSearchQuery("");
      setNewPartName("");
    }
  };

  const onPointerMove = (e) => {
    if (interactionMode === "pan" && isPanning && panStart) {
      const rawCurrent = getBaseSvgPoint(e.clientX, e.clientY);
      const rawStart = getBaseSvgPoint(panStart.clientX, panStart.clientY);

      setPan(prev => ({
        x: prev.x + (rawCurrent.x - rawStart.x),
        y: prev.y + (rawCurrent.y - rawStart.y)
      }));
      setPanStart({ clientX: e.clientX, clientY: e.clientY });
    }
  };

  const onPointerUp = (e) => {
    if (interactionMode === "pan") {
      setIsPanning(false);
      setPanStart(null);
    }
  };

  const handlePinClick = async (e, pinId) => {
    e.stopPropagation(); // Prevents dropping a new pin
    if (window.confirm("Delete this callout pin?")) {
      try {
        await deleteDoc(doc(db, "assembly_pins", pinId));
      } catch (err) {
        console.error("Delete pin error:", err);
      }
    }
  };

  const saveNewCustomPart = async () => {
    if (!newPartName.trim()) return alert("Enter a part name.");
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId,
        x: pinCoords.x, y: pinCoords.y,
        partName: newPartName.toUpperCase(),
        partId: "PENDING-NEW",
        legacyErpId: "PENDING",
        isExistingLibraryPart: false,
        status: "NEEDS_SPECS",
        author: currentUser,
        createdAt: serverTimestamp()
      });
      setModalOpen(false);
    } catch (err) { console.error(err); }
  };

  const saveExistingLibraryPart = async (part) => {
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId,
        x: pinCoords.x, y: pinCoords.y,
        partName: part.itemName,
        partId: part.itemId,
        legacyErpId: part.legacyErpId || "N/A",
        isExistingLibraryPart: true,
        specs: part.manufacturingSpecs || {}, 
        status: "SPECS_LOCKED", 
        author: currentUser,
        createdAt: serverTimestamp()
      });
      setModalOpen(false);
    } catch (err) { console.error(err); }
  };

  const filteredLibrary = libraryParts.filter(p => 
    (p.itemName && p.itemName.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (p.legacyErpId && p.legacyErpId.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  let canvasCursor = 'default';
  if (interactionMode === 'pan') canvasCursor = isPanning ? 'grabbing' : 'grab';
  else if (interactionMode === 'pin') canvasCursor = 'crosshair';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem' }}>2. Visual Assembly Details</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>SELECT "DROP PIN" TO ASSIGN COMPONENTS TO THE IMAGE</span>
        </div>
        
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>MASTER ASSEMBLY:</label>
          <select value={selectedAssemblyId} onChange={(e) => setSelectedAssemblyId(e.target.value)} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '250px' }}>
            {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
            {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
          </select>
          <button onClick={onProceed} style={{ padding: '10px 20px', background: '#000', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
            PROCEED TO BOM ➔
          </button>
        </div>
      </div>

      <div style={{ flex: 1, background: '#fff', border: '2px solid #000', position: 'relative', overflow: 'hidden', boxShadow: '10px 10px 0 #000', minHeight: '600px', display: 'flex', flexDirection: 'column' }}>
        
        {/* NEW: VIEWPORT TOOLBAR */}
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
          {!activeAssembly ? (
             <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
               <h3>NO ASSEMBLY SELECTED</h3>
               <p>Create a Master Assembly in Tab 1 first.</p>
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
              {/* THE ZOOM & PAN GROUP */}
              <g ref={innerGroupRef} transform={`translate(${pan.x}, ${pan.y}) translate(500, 500) scale(${scale}) translate(-500, -500)`}>
                <image href={activeAssembly.finalImageUrl} x="100" y="100" width="800" height="800" preserveAspectRatio="xMidYMid meet" />
                
                {pins.map((pin, i) => {
                  const isRightHalf = pin.x > 500;
                  const elbowX = isRightHalf ? pin.x + 40 : pin.x - 40;
                  const elbowY = pin.y - 50;
                  const landingX = isRightHalf ? 800 : 20;
                  const boxColor = pin.isExistingLibraryPart ? '#007bff' : '#d9534f'; 

                  return (
                    // Use onPointerDown with stopPropagation so we don't drop pins/pan when clicking an existing pin
                    <g key={pin.id} onPointerDown={(e) => handlePinClick(e, pin.id)} style={{ cursor: 'pointer' }}>
                      <path d={`M ${pin.x} ${pin.y} L ${elbowX} ${elbowY} L ${landingX} ${elbowY}`} fill="none" stroke={boxColor} strokeWidth="2" />
                      <circle cx={pin.x} cy={pin.y} r="8" fill={boxColor} stroke="#fff" strokeWidth="2" />
                      <rect x={landingX} y={elbowY - 20} width="180" height="40" fill="#fff" stroke={boxColor} strokeWidth="2" />
                      <text x={landingX + 10} y={elbowY + 5} fill="#000" fontSize="12" fontWeight="bold">
                        {pin.partName.length > 20 ? pin.partName.substring(0, 18) + "..." : pin.partName}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          )}
        </div>
      </div>

      {modalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', border: '4px solid #000', width: '600px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '15px 15px 0 #000' }}>
            
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>DEFINE COMPONENT</h3>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ display: 'flex', borderBottom: '2px solid #000' }}>
              <button onClick={() => setCreationMode("EXISTING")} style={{ flex: 1, padding: '15px', background: creationMode === "EXISTING" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', borderRight: '2px solid #000', cursor: 'pointer', color: creationMode === "EXISTING" ? '#007bff' : '#666' }}>
                🔍 SELECT FROM LIBRARY
              </button>
              <button onClick={() => setCreationMode("NEW")} style={{ flex: 1, padding: '15px', background: creationMode === "NEW" ? '#fff' : '#eee', fontWeight: 'bold', border: 'none', cursor: 'pointer', color: creationMode === "NEW" ? '#d9534f' : '#666' }}>
                ➕ CREATE CUSTOM PART
              </button>
            </div>

            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px', background: '#f9f9f9' }}>
              
              {creationMode === "NEW" && (
                <div style={{ padding: '20px', background: '#fff', border: '2px dashed #d9534f' }}>
                  <h4 style={{ margin: '0 0 10px 0', color: '#d9534f' }}>NEW CUSTOM COMPONENT</h4>
                  <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: '15px' }}>This will create a new BOM row. You must define specs and pricing for this part in Tab 3.</p>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ENTER PART NAME / DESCRIPTION:</label>
                  <input 
                    autoFocus
                    value={newPartName} 
                    onChange={(e) => setNewPartName(e.target.value)} 
                    placeholder="e.g. CUSTOM EXTENSION ROD 48 INCH"
                    style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', marginBottom: '15px', textTransform: 'uppercase' }} 
                  />
                  <button onClick={saveNewCustomPart} style={{ width: '100%', padding: '15px', background: '#d9534f', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>
                    DROP PIN & ADD TO BOM
                  </button>
                </div>
              )}

              {creationMode === "EXISTING" && (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '400px' }}>
                  <input 
                    autoFocus
                    placeholder="Search Library by Name or ID..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ width: '100%', padding: '12px', border: '2px solid #007bff', boxSizing: 'border-box', marginBottom: '15px', fontSize: '1rem' }} 
                  />
                  
                  <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', background: '#fff' }}>
                    {filteredLibrary.length === 0 ? (
                      <div style={{ padding: '30px', textAlign: 'center', color: '#999', fontWeight: 'bold' }}>NO MATCHING PARTS FOUND</div>
                    ) : (
                      filteredLibrary.map(part => (
                        <div 
                          key={part.id} 
                          onClick={() => saveExistingLibraryPart(part)}
                          style={{ display: 'flex', gap: '15px', alignItems: 'center', padding: '10px 15px', borderBottom: '1px solid #eee', cursor: 'pointer', transition: 'background 0.2s' }}
                          onMouseOver={(e) => e.currentTarget.style.background = '#f0f8ff'}
                          onMouseOut={(e) => e.currentTarget.style.background = '#fff'}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#007bff' }}>
                              {part.brandId !== activeBrand && <span style={{ color: '#000', background: '#ffc107', padding: '2px 4px', fontSize: '0.6rem', marginRight: '5px' }}>{part.brandId.toUpperCase()}</span>}
                              {part.legacyErpId !== "PENDING" && part.legacyErpId !== "N/A" ? part.legacyErpId : part.itemId}
                            </div>
                            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#000' }}>{part.itemName}</div>
                            <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '3px' }}>{part.manufacturingSpecs?.productType || "NO TYPE"} | {part.manufacturingSpecs?.finishDetail || "NO FINISH"}</div>
                          </div>
                          
                          <div style={{ width: '60px', height: '60px', background: '#f4f4f4', border: '1px solid #ccc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {part.finalImageUrl ? (
                              <img src={part.finalImageUrl} alt={part.itemName} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                            ) : (
                              <span style={{ fontSize: '1.2rem', color: '#ccc' }}>⚙️</span>
                            )}
                          </div>
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