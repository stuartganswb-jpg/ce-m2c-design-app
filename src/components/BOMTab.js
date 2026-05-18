import React, { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc, setDoc, addDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const UOM_OPTIONS = ["EA", "FT", "MTR", "YD", "IN", "LB", "SET", "PAIR"];
const PROD_TYPES = ["HARDWARE", "TRIMMING", "LIGHTING", "TEXTILE", "JEWELRY", "PACKAGING", "RAW MATERIAL", "COMPONENT"];
const FINISHES = ["MATTE BRASS", "POLISHED NICKEL", "ANTIQUE BRONZE", "CHAMPAGNE METALLIC", "GREY WASHED OAK", "RAW", "N/A"];
const COLLECTIONS = ["HARLOW", "SIGNATURE", "COASTAL", "MODERN ARCHITECTURAL", "N/A"];
const WATCHLISTS = ["NONE", "FALL 26", "SPRING 27", "CRITICAL EXPEDITE", "DISCONTINUED RISK", "LONG LEAD TIME"];

const BOMTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  const [pins, setPins] = useState([]);
  const [activePin, setActivePin] = useState(null); 

  const [isInHouse, setIsInHouse] = useState(true);
  const [activeLegacyId, setActiveLegacyId] = useState("");
  
  const [specs, setSpecs] = useState({
    bomSequence: "", buildSequence: "", layeringSequence: "", qty: "1", productType: "", finishDetail: "", collection: "", uom: "EA", watchList: "NONE",
    programNum: "", material: "", vendorName: "", vendorId: "", vendorUrl: "", cost: "", weight: "", leadTime: "", moq: "", reorderPoint: ""
  });
  
  const [pdfFile, setPdfFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // --- NEW STATE: NON-VISUAL MODAL ---
  const [nvModalOpen, setNvModalOpen] = useState(false);
  const [nvForm, setNvForm] = useState({
    partName: "", legacyErpId: "", qty: "1", vendorUrl: ""
  });

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
    if (!selectedAssemblyId) return;
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let fetchedPins = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      fetchedPins.sort((a, b) => {
        const seqA = a.specs?.buildSequence ? parseInt(a.specs.buildSequence) : (a.specs?.bomSequence ? parseInt(a.specs.bomSequence) : 9999);
        const seqB = b.specs?.buildSequence ? parseInt(b.specs.buildSequence) : (b.specs?.bomSequence ? parseInt(b.specs.bomSequence) : 9999);
        return seqA - seqB;
      });
      setPins(fetchedPins);
    });
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  const handleSpecChange = (e) => {
    setSpecs({ ...specs, [e.target.name]: e.target.value });
  };

  const handleEditPart = (pin) => {
    setActivePin(pin);
    setActiveLegacyId(pin.legacyErpId === "PENDING" ? "" : pin.legacyErpId || "");
    setSpecs(pin.specs || {
      bomSequence: "", buildSequence: "", layeringSequence: "", qty: "1", productType: "", finishDetail: "", collection: "", uom: "EA", watchList: "NONE",
      programNum: "", material: "", vendorName: "", vendorId: "", vendorUrl: "", cost: "", weight: "", leadTime: "", moq: "", reorderPoint: ""
    });
    setIsInHouse(pin.specs ? pin.specs.isInHouse : true);
    setPdfFile(null);
  };

  const saveSpecs = async () => {
    if (!activePin) return;
    if (!specs.bomSequence) return alert("Please assign a BOM Sequence number.");

    let finalPdfUrl = activePin.specs?.pdfUrl || "";

    if (pdfFile) {
      const storageRef = ref(storage, `prints/${activeBrand}_${activePin.partName}_${pdfFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, pdfFile);
      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed", 
          (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }
        );
      });
    }

    const compiledSpecs = { ...specs, isInHouse, pdfUrl: finalPdfUrl };
    const finalLegacyId = activeLegacyId.toUpperCase() || "N/A";

    try {
      await updateDoc(doc(db, "assembly_pins", activePin.id), { specs: compiledSpecs, legacyErpId: finalLegacyId, status: "SPECS_LOCKED" });

      const libraryId = activePin.partId === "PENDING-NEW" ? `${activeBrand.toUpperCase()}-INV-${Math.floor(1000+Math.random()*9000)}` : activePin.partId;
      await setDoc(doc(db, "Approved_Designs", libraryId), {
        brandId: activeBrand, itemId: libraryId, legacyErpId: finalLegacyId, itemName: activePin.partName,
        partClass: "Inventory", manufacturingSpecs: compiledSpecs, updatedAt: serverTimestamp()
      }, { merge: true });

      if (activePin.partId === "PENDING-NEW") {
        await updateDoc(doc(db, "assembly_pins", activePin.id), { partId: libraryId, isExistingLibraryPart: true });
      }

      alert("BOM Specs saved and synced to Master Library!");
      setActivePin(null);
      setUploadProgress(0);
    } catch (error) {
      console.error("Error saving specs:", error);
      alert("Failed to save specs.");
    }
  };

  const handleDeleteAssembly = async () => {
    if (!selectedAssemblyId) return;
    if (window.confirm("CRITICAL WARNING: This will delete the Master Assembly and ALL associated BOM rows. Continue?")) {
      try {
        const assemblyDoc = assemblies.find(a => a.itemId === selectedAssemblyId);
        if (assemblyDoc) {
          await deleteDoc(doc(db, "Approved_Designs", assemblyDoc.id));
        }
        
        for (let pin of pins) {
          await deleteDoc(doc(db, "assembly_pins", pin.id));
        }
        
        setSelectedAssemblyId("");
        alert("Assembly completely deleted.");
      } catch (err) {
        console.error("Delete Assembly Error:", err);
        alert("Failed to delete assembly.");
      }
    }
  };

  const handleDeletePin = async (pinId) => {
    if (window.confirm("Remove this component from the assembly BOM?")) {
      try {
        await deleteDoc(doc(db, "assembly_pins", pinId));
        if (activePin?.id === pinId) setActivePin(null);
      } catch (err) {
        console.error("Delete Pin Error:", err);
      }
    }
  };

  const handleAddNonVisualClick = () => {
    if (!selectedAssemblyId) return alert("Select an assembly first.");
    setNvModalOpen(true);
  };

  const submitNonVisualComponent = async () => {
    if (!nvForm.partName.trim()) return alert("Part Name is required.");
    
    try {
      await addDoc(collection(db, "assembly_pins"), {
        assemblyId: selectedAssemblyId,
        x: null, y: null,
        partName: nvForm.partName.toUpperCase(),
        partId: "PENDING-NEW",
        legacyErpId: nvForm.legacyErpId.toUpperCase() || "PENDING",
        isExistingLibraryPart: false,
        specs: {
          qty: nvForm.qty,
          vendorUrl: nvForm.vendorUrl,
          isInHouse: false, // Default to outsourced since these are typically purchased goods
        },
        status: "NEEDS_SPECS", // Still needs specs so it flags for review
        author: currentUser,
        createdAt: serverTimestamp()
      });
      
      setNvModalOpen(false);
      setNvForm({ partName: "", legacyErpId: "", qty: "1", vendorUrl: "" }); // reset
    } catch (err) {
      console.error("Add non-visual error:", err);
      alert("Failed to add component.");
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh', position: 'relative' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.2rem' }}>3. Bill of Materials Engine</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          
          <button onClick={handleDeleteAssembly} disabled={!selectedAssemblyId} style={{ padding: '8px 12px', background: '#fff', color: '#d9534f', border: '2px solid #d9534f', fontWeight: 'bold', cursor: selectedAssemblyId ? 'pointer' : 'not-allowed' }}>
            🗑️ DELETE ASSEMBLY
          </button>
          
          <label style={{ fontWeight: 'bold', fontSize: '0.8rem', marginLeft: '10px' }}>ASSEMBLY:</label>
          <select value={selectedAssemblyId} onChange={(e) => { setSelectedAssemblyId(e.target.value); setActivePin(null); }} style={{ padding: '8px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '250px' }}>
            {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
            {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div style={{ flex: 2, background: '#fff', border: '2px solid #000', padding: '20px', overflowX: 'auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0 }}>ASSEMBLY COMPONENTS</h3>
            <button onClick={handleAddNonVisualClick} disabled={!selectedAssemblyId} style={{ padding: '8px 12px', background: '#000', color: '#fff', border: 'none', fontWeight: 'bold', cursor: selectedAssemblyId ? 'pointer' : 'not-allowed' }}>
              + ADD NON-VISUAL COMPONENT
            </button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#000', color: '#fff' }}>
                <th style={{ padding: '10px' }}>BOM SEQ</th>
                <th style={{ padding: '10px', color: '#ffeb3b' }}>BUILD SEQ</th>
                <th style={{ padding: '10px', color: '#ff9800' }}>LAYER SEQ</th>
                <th style={{ padding: '10px', color: '#28a745' }}>QTY</th>
                <th style={{ padding: '10px' }}>LEGACY ID</th>
                <th style={{ padding: '10px' }}>PART NAME</th>
                <th style={{ padding: '10px' }}>UOM</th>
                <th style={{ padding: '10px' }}>STATUS</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {pins.map(pin => (
                <tr key={pin.id} style={{ borderBottom: '1px solid #eee', background: activePin?.id === pin.id ? '#fff9c4' : '#fff' }}>
                  <td style={{ padding: '10px', fontWeight: 'bold' }}>{pin.specs?.bomSequence || "-"}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold', color: '#888' }}>{pin.specs?.buildSequence || "-"}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold', color: '#ff9800' }}>{pin.specs?.layeringSequence || "-"}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold', color: '#28a745' }}>{pin.specs?.qty || 1}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold', color: '#007bff' }}>{pin.legacyErpId !== "PENDING" ? pin.legacyErpId : "N/A"}</td>
                  <td style={{ padding: '10px', fontWeight: 'bold' }}>
                    {pin.x === null && <span title="Non-Visual Part" style={{ color: '#aaa', marginRight: '5px' }}>📦</span>}
                    {pin.partName}
                  </td>
                  <td style={{ padding: '10px' }}>{pin.specs?.uom || "-"}</td>
                  <td style={{ padding: '10px' }}>{pin.status === "SPECS_LOCKED" ? "✅ OK" : "⚠️ PENDING"}</td>
                  <td style={{ padding: '10px', textAlign: 'center', display: 'flex', gap: '5px', justifyContent: 'center' }}>
                    <button onClick={() => handleEditPart(pin)} style={{ padding: '6px 12px', background: activePin?.id === pin.id ? '#000' : '#007bff', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>EDIT</button>
                    <button onClick={() => handleDeletePin(pin.id)} style={{ padding: '6px 10px', background: '#fff', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontWeight: 'bold' }}>🗑️</button>
                  </td>
                </tr>
              ))}
              {pins.length === 0 && <tr><td colSpan="9" style={{ padding: '20px', textAlign: 'center' }}>No components pinned for this assembly yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {activePin && (
          <div style={{ flex: 1, background: '#fff', border: '4px solid #000', padding: '20px', position: 'relative', boxShadow: '10px 10px 0 rgba(0,0,0,0.1)' }}>
            <h3 style={{ marginTop: 0, borderBottom: '2px solid #000', paddingBottom: '10px', fontSize: '1rem', textTransform: 'uppercase' }}>
              BOM DATA: <span style={{ color: '#007bff' }}>{activePin.partName}</span>
            </h3>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>BOM SEQ #:</label>
                <input name="bomSequence" type="number" value={specs.bomSequence} onChange={handleSpecChange} placeholder="10" style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>BUILD SEQ #:</label>
                <input name="buildSequence" type="number" step="10" value={specs.buildSequence} onChange={handleSpecChange} placeholder="10, 20..." style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#ff9800' }}>LAYER SEQ #:</label>
                <input name="layeringSequence" type="number" step="10" value={specs.layeringSequence || ""} onChange={handleSpecChange} placeholder="10..." style={{ width: '100%', padding: '8px', border: '1px solid #ff9800', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#28a745' }}>QTY:</label>
                <input name="qty" type="number" value={specs.qty || "1"} onChange={handleSpecChange} placeholder="1" style={{ width: '100%', padding: '8px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold' }} />
              </div>
            </div>

            <div style={{ marginBottom: '15px' }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#007bff' }}>LEGACY ERP ID:</label>
                <input value={activeLegacyId} onChange={(e) => setActiveLegacyId(e.target.value)} placeholder="e.g. P-1234" style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', textTransform: 'uppercase' }} />
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>PROD TYPE:</label>
                <select name="productType" value={specs.productType} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                  <option value="">SELECT...</option>
                  {PROD_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>UOM:</label>
                <select name="uom" value={specs.uom} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                  {UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>FINISH:</label>
                <select name="finishDetail" value={specs.finishDetail} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                  <option value="">SELECT...</option>
                  {FINISHES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>COLLECTION:</label>
                <select name="collection" value={specs.collection} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                  <option value="">SELECT...</option>
                  {COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <button onClick={() => setIsInHouse(true)} style={{ flex: 1, padding: '10px', background: isInHouse ? '#000' : '#eee', color: isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>IN-HOUSE</button>
              <button onClick={() => setIsInHouse(false)} style={{ flex: 1, padding: '10px', background: !isInHouse ? '#000' : '#eee', color: !isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>OUTSOURCED</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {isInHouse ? (
                <>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>PROGRAM #:</label>
                      <input name="programNum" value={specs.programNum} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>RAW MAT:</label>
                      <input name="material" value={specs.material} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ borderTop: '2px solid #eee', paddingTop: '10px', marginTop: '5px' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>UPLOAD PRINT (PDF):</label>
                    {activePin.specs?.pdfUrl && <a href={activePin.specs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#007bff', display: 'block', marginBottom: '5px' }}>[View Current PDF]</a>}
                    <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                    {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 2 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>VENDOR NAME:</label>
                      <input name="vendorName" value={specs.vendorName} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>VENDOR ID:</label>
                      <input name="vendorId" value={specs.vendorId} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                  <div style={{ marginBottom: '5px' }}>
                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>VENDOR DIRECT LINK (URL):</label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <input name="vendorUrl" value={specs.vendorUrl} onChange={handleSpecChange} placeholder="https://..." style={{ flex: 1, padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                      {specs.vendorUrl && (
                        <a href={specs.vendorUrl.startsWith('http') ? specs.vendorUrl : `https://${specs.vendorUrl}`} target="_blank" rel="noreferrer" style={{ padding: '8px 12px', background: '#007bff', color: '#fff', textDecoration: 'none', fontWeight: 'bold', fontSize: '0.7rem', display: 'flex', alignItems: 'center' }}>TEST</a>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>COST ($):</label>
                      <input name="cost" type="number" value={specs.cost} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>LEAD (DAYS):</label>
                      <input name="leadTime" type="number" value={specs.leadTime} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
                    </div>
                  </div>
                </>
              )}
            </div>

            <div style={{ marginTop: '25px', display: 'flex', gap: '10px' }}>
              <button onClick={saveSpecs} style={{ flex: 2, padding: '15px', background: '#28a745', color: '#fff', border: 'none', fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer', boxShadow: '4px 4px 0 #000' }}>
                SAVE SPECS
              </button>
            </div>
            
            <button onClick={() => setActivePin(null)} style={{ position: 'absolute', top: '15px', right: '15px', background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}>✖</button>
          </div>
        )}
      </div>

      {/* --- NON-VISUAL COMPONENT MODAL --- */}
      {nvModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', border: '4px solid #000', width: '500px', boxShadow: '15px 15px 0 #000', display: 'flex', flexDirection: 'column' }}>
            
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>ADD NON-VISUAL COMPONENT</h3>
              <button onClick={() => setNvModalOpen(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>PART NAME / DESCRIPTION:</label>
                <input 
                  autoFocus
                  value={nvForm.partName} 
                  onChange={(e) => setNvForm({...nvForm, partName: e.target.value})} 
                  placeholder="e.g. WIRING HARNESS KIT"
                  style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box', textTransform: 'uppercase' }} 
                />
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#007bff' }}>LEGACY ERP ID:</label>
                  <input 
                    value={nvForm.legacyErpId} 
                    onChange={(e) => setNvForm({...nvForm, legacyErpId: e.target.value})} 
                    placeholder="e.g. HW-8090"
                    style={{ width: '100%', padding: '12px', border: '2px solid #007bff', boxSizing: 'border-box', textTransform: 'uppercase' }} 
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#28a745' }}>QTY:</label>
                  <input 
                    type="number"
                    value={nvForm.qty} 
                    onChange={(e) => setNvForm({...nvForm, qty: e.target.value})} 
                    style={{ width: '100%', padding: '12px', border: '2px solid #28a745', boxSizing: 'border-box', fontWeight: 'bold' }} 
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>VENDOR PURCHASE LINK (URL):</label>
                <input 
                  value={nvForm.vendorUrl} 
                  onChange={(e) => setNvForm({...nvForm, vendorUrl: e.target.value})} 
                  placeholder="https://mcmaster.com/..."
                  style={{ width: '100%', padding: '12px', border: '2px solid #000', boxSizing: 'border-box' }} 
                />
              </div>

              <button onClick={submitNonVisualComponent} style={{ marginTop: '10px', width: '100%', padding: '15px', background: '#000', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: 'none', cursor: 'pointer' }}>
                ADD TO BOM
              </button>
            </div>
            
          </div>
        </div>
      )}

    </div>
  );
};

export default BOMTab;