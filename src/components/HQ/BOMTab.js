import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const BOMTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  
  // Data Joins
  const [bomPins, setBomPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  // --- Dynamic Master Lists & Configs ---
  const [globalLists, setGlobalLists] = useState({ uom: [], prodTypes: [], collections: [], watchLists: [], vendors: [], partHandling: [] }); // 🚀 NEW: Part Handling
  const [windowConfig, setWindowConfig] = useState({ system: {}, custom: [] }); // Stores Custom Dictionaries for CPQ mapping
  
  // Master Schema Data
  const [customSchema, setCustomSchema] = useState([]);

  // Editor State
  const [activeComponent, setActiveComponent] = useState(null);
  const [editSpecs, setEditSpecs] = useState({ customData: {}, cpqCategories: [] });
  const [isSaving, setIsSaving] = useState(false);

  // --- Assembly Details State ---
  const [assemblyDetails, setAssemblyDetails] = useState({
      itemName: "", legacyErpId: "", productType: "", collection: "", routingType: "UNASSIGNED",
      basePrice: "", cost: "", pdfUrl: "", cadUrl: "",
      isProjectManaged: false,
      binLocation: "" 
  });

  // File Upload State
  const [pdfFile, setPdfFile] = useState(null);
  const [cadFile, setCadFile] = useState(null); 
  const [assemblyPdfFile, setAssemblyPdfFile] = useState(null);
  const [assemblyCadFile, setAssemblyCadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cadUploadProgress, setCadUploadProgress] = useState(0); 

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields);
    });
    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          setGlobalLists({
              uom: data.uom || [], prodTypes: data.prodTypes || [], collections: data.collections || [],
              watchLists: data.watchLists || [], vendors: data.vendors || [],
              partHandling: data.partHandling || ['Small Parts', 'Custom'] // 🚀 NEW: Part Handling Fallback
          });
      }
    });
    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      if (docSnap.exists()) {
          setWindowConfig({ system: { partHandling: ['ce', 'm2c', 'uniquity', 'leyla'], ...(docSnap.data().system || {}) }, custom: docSnap.data().custom || [] });
      }
    });
    return () => { unsubSchema(); unsubLists(); unsubWindowConfig(); };
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
    if (!selectedAssemblyId) { setBomPins([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      setLibraryParts(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  const selectedAssemblyData = assemblies.find(a => a.itemId === selectedAssemblyId);

  useEffect(() => {
      if (selectedAssemblyData) {
          setAssemblyDetails({
              itemName: selectedAssemblyData.itemName || "",
              legacyErpId: selectedAssemblyData.legacyErpId === "PENDING" ? "" : (selectedAssemblyData.legacyErpId || ""),
              productType: selectedAssemblyData.productType || "",
              collection: selectedAssemblyData.collection || "",
              routingType: selectedAssemblyData.routingType || "UNASSIGNED",
              basePrice: selectedAssemblyData.manufacturingSpecs?.basePrice || "",
              cost: selectedAssemblyData.manufacturingSpecs?.cost || "",
              pdfUrl: selectedAssemblyData.manufacturingSpecs?.pdfUrl || "",
              cadUrl: selectedAssemblyData.manufacturingSpecs?.cadUrl || "",
              isProjectManaged: selectedAssemblyData.manufacturingSpecs?.isProjectManaged || false,
              binLocation: selectedAssemblyData.manufacturingSpecs?.binLocation || "" 
          });
      }
  }, [selectedAssemblyData]);

  const populatedBOM = bomPins.map(pin => {
      const masterPart = libraryParts.find(p => p.id === pin.partId);
      return { ...pin, masterPart: masterPart || null };
  });

  const openComponentEditor = (bomItem) => {
      if (!bomItem.masterPart) return alert("Master part not found. It may have been deleted.");
      setActiveComponent(bomItem);
      setPdfFile(null); setCadFile(null); 
      
      const baseSpecs = bomItem.masterPart.manufacturingSpecs || {};
      const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" };
      const customData = baseSpecs.customData || {}; 
      const cpqCategories = baseSpecs.cpqCategories || []; 
      const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
      const partHandling = baseSpecs.partHandling || ""; // 🚀 NEW

      setEditSpecs({ ...baseSpecs, parametric: parametricData, customData, cpqCategories, isInHouse, partHandling });
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  
  const handleCustomFieldChange = (key, value) => {
      setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  };

  const handleCpqCategoryToggle = (categoryId) => {
      const current = editSpecs.cpqCategories || [];
      const updated = current.includes(categoryId) ? current.filter(id => id !== categoryId) : [...current, categoryId];
      setEditSpecs({ ...editSpecs, cpqCategories: updated });
  };

  const saveAssemblyDetails = async () => {
      if (!selectedAssemblyData) return;
      setIsSaving(true);
      try {
          let finalPdfUrl = assemblyDetails.pdfUrl || "";
          if (assemblyPdfFile) {
              const storageRef = ref(storage, `prints/${activeBrand}_${assemblyDetails.legacyErpId || selectedAssemblyData.itemId}_${assemblyPdfFile.name}`);
              const uploadTask = uploadBytesResumable(storageRef, assemblyPdfFile);
              await new Promise((resolve, reject) => { uploadTask.on("state_changed", null, reject, async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
          }

          let finalCadUrl = assemblyDetails.cadUrl || "";
          if (assemblyCadFile) {
              const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${assemblyDetails.legacyErpId || selectedAssemblyData.itemId}_${assemblyCadFile.name}`);
              const cadUploadTask = uploadBytesResumable(cadStorageRef, assemblyCadFile);
              await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", null, reject, async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
          }

          const currentSpecs = selectedAssemblyData.manufacturingSpecs || {};
          await updateDoc(doc(db, "Approved_Designs", selectedAssemblyData.id), {
              itemName: assemblyDetails.itemName.toUpperCase(),
              legacyErpId: assemblyDetails.legacyErpId.toUpperCase() || "PENDING",
              productType: assemblyDetails.productType,
              collection: assemblyDetails.collection,
              manufacturingSpecs: { 
                  ...currentSpecs, 
                  basePrice: assemblyDetails.basePrice, 
                  cost: assemblyDetails.cost,
                  pdfUrl: finalPdfUrl,
                  cadUrl: finalCadUrl,
                  isProjectManaged: assemblyDetails.isProjectManaged,
                  binLocation: assemblyDetails.binLocation 
              },
              updatedAt: new Date().toISOString()
          });
          setTimeout(() => { setIsSaving(false); setAssemblyPdfFile(null); setAssemblyCadFile(null); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save assembly details.");
      }
  };

  const saveGlobalUpdates = async () => {
      if (!activeComponent?.masterPart) return;
      setIsSaving(true);
      
      let finalPdfUrl = editSpecs.pdfUrl || "";
      if (pdfFile) {
        const storageRef = ref(storage, `prints/${activeBrand}_${activeComponent.masterPart.legacyErpId}_${pdfFile.name}`);
        const uploadTask = uploadBytesResumable(storageRef, pdfFile);
        await new Promise((resolve, reject) => { uploadTask.on("state_changed", (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
      }

      let finalCadUrl = editSpecs.cadUrl || "";
      if (cadFile) {
        const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${activeComponent.masterPart.legacyErpId}_${cadFile.name}`);
        const cadUploadTask = uploadBytesResumable(cadStorageRef, cadFile);
        await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", (snap) => setCadUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
      }

      const compiledSpecs = { 
          ...editSpecs, 
          pdfUrl: finalPdfUrl, 
          cadUrl: finalCadUrl,
          status: "SPECS_LOCKED" 
      };

      try {
          await updateDoc(doc(db, "Approved_Designs", activeComponent.masterPart.id), {
              manufacturingSpecs: compiledSpecs,
              updatedAt: new Date().toISOString()
          });
          
          setTimeout(() => { setIsSaving(false); setActiveComponent(null); setUploadProgress(0); setCadUploadProgress(0); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save global updates.");
      }
  };

  const totalCost = populatedBOM.reduce((sum, item) => sum + ((item.masterPart?.manufacturingSpecs?.cost || item.masterPart?.manufacturingSpecs?.basePrice || 0) * (item.defaultQty || 1)), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>3. Bill of Materials Engine</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>GLOBAL COMPONENT DATA SYNC</span>
        </div>
        
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>SELECT ASSEMBLY:</label>
          <select value={selectedAssemblyId} onChange={(e) => { setSelectedAssemblyId(e.target.value); setActiveComponent(null); }} style={{ padding: '10px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '350px' }}>
            {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
            {assemblies.map(a => (
                <option key={a.id} value={a.itemId}>
                    [{a.routingType ? a.routingType.toUpperCase() : 'UNASSIGNED'}] {a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}
                </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        <div style={{ flex: 1.2, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '15px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>ASSEMBLY COMPONENTS (BOM)</span>
                <span style={{ fontSize: '0.8rem', background: '#28a745', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>BOM ROLLED COST: ${totalCost.toFixed(2)}</span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '15px', background: '#f8f9fa' }}>
                {populatedBOM.length === 0 && <div style={{ textAlign: 'center', color: '#999', marginTop: '40px', fontStyle: 'italic' }}>No components found. Drop pins in Tab 2 to build BOM.</div>}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {populatedBOM.map(item => {
                        const isSelected = activeComponent?.id === item.id;
                        const isNew = item.masterPart?.manufacturingSpecs?.status === "NEEDS_SPECS";
                        const master = item.masterPart || {};
                        const specs = master.manufacturingSpecs || {};

                        return (
                            <div 
                                key={item.id} 
                                onClick={() => openComponentEditor(item)}
                                style={{ background: isSelected ? '#e6f2ff' : '#fff', border: `2px solid ${isSelected ? '#007bff' : '#ccc'}`, display: 'flex', cursor: 'pointer', transition: '0.2s', boxShadow: isSelected ? '4px 4px 0 #007bff' : 'none' }}
                            >
                                <div style={{ width: '80px', height: '80px', background: '#e9ecef', borderRight: '1px solid #ccc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                    {master.finalImageUrl ? (
                                        <img src={master.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ fontSize: '1.5rem', color: '#bbb' }}>⚙️</span>
                                    )}
                                </div>

                                <div style={{ padding: '10px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{item.partName}</div>
                                        <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#28a745' }}>QTY: {item.defaultQty}</div>
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: '#666', marginTop: '4px' }}>
                                        <span style={{ color: '#007bff', fontWeight: 'bold' }}>{item.legacyErpId}</span> | {specs.productType || "NO TYPE"}
                                    </div>
                                    {isNew && <div style={{ fontSize: '0.65rem', color: '#fff', background: '#d9534f', padding: '2px 5px', display: 'inline-block', marginTop: '5px', fontWeight: 'bold' }}>⚠️ NEEDS SPECS</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>

        <div style={{ flex: 1.5, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
            
            <div style={{ padding: '15px 20px', background: activeComponent ? '#007bff' : '#28a745', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>{activeComponent ? "GLOBAL PART DATA" : "ASSEMBLY METADATA & PRICING"}</h3>
                    <span style={{ fontSize: '0.75rem' }}>{activeComponent ? "Changes made here update the Master Library globally." : "Review and set root metadata for this assembly."}</span>
                </div>
                {activeComponent && <span style={{ background: '#fff', color: '#007bff', padding: '4px 8px', fontSize: '0.8rem', fontWeight: 'bold' }}>{activeComponent.legacyErpId}</span>}
            </div>

            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '25px' }}>
                
                {!activeComponent ? (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '10px' }}>
                        {selectedAssemblyData ? (
                            <>
                                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                                    {selectedAssemblyData.finalImageUrl ? (
                                        <img src={selectedAssemblyData.finalImageUrl} alt="Assembly" style={{ maxWidth: '80%', maxHeight: '350px', objectFit: 'contain', border: '2px solid #ccc', padding: '10px', background: '#f8f9fa' }} />
                                    ) : (
                                        <div style={{ height: '200px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed #ccc', color: '#999', fontWeight: 'bold' }}>NO IMAGE AVAILABLE</div>
                                    )}
                                </div>

                                <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #28a745', paddingBottom: '10px' }}>
                                        <h4 style={{ margin: 0, color: '#1e7e34' }}>PARENT ASSEMBLY METADATA</h4>
                                        <span style={{ background: '#1e7e34', color: '#fff', padding: '4px 8px', fontSize: '0.7rem', fontWeight: 'bold', borderRadius: '4px' }}>
                                            ROUTING: {assemblyDetails.routingType.toUpperCase()}
                                        </span>
                                    </div>

                                    <div style={{ background: '#fff3cd', border: '2px dashed #ffc107', padding: '10px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={assemblyDetails.isProjectManaged} 
                                            onChange={e => setAssemblyDetails({...assemblyDetails, isProjectManaged: e.target.checked})} 
                                            style={{ transform: 'scale(1.5)', cursor: 'pointer', marginLeft: '5px' }} 
                                        />
                                        <div>
                                            <div style={{ fontWeight: 'bold', color: '#856404', fontSize: '0.85rem' }}>FLAG AS COMPLEX PROJECT (ROUTE TO TAB 10.5)</div>
                                            <div style={{ fontSize: '0.7rem', color: '#666' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                                        </div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '15px' }}>
                                        <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>ASSEMBLY NAME:</label><input value={assemblyDetails.itemName} onChange={e => setAssemblyDetails({...assemblyDetails, itemName: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
                                        <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>ERP ID:</label><input value={assemblyDetails.legacyErpId} onChange={e => setAssemblyDetails({...assemblyDetails, legacyErpId: e.target.value})} placeholder="PENDING" style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', textTransform: 'uppercase' }} /></div>
                                    </div>

                                    <div style={{ background: '#f8f9fa', border: '2px solid #6f42c1', padding: '10px', marginTop: '10px' }}>
                                        <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#6f42c1', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
                                            📍 WAREHOUSE BIN LOCATION (BARCODE/REF)
                                        </label>
                                        <input 
                                            value={assemblyDetails.binLocation} 
                                            onChange={e => setAssemblyDetails({...assemblyDetails, binLocation: e.target.value})} 
                                            placeholder="e.g. KIT-SHELF-B" 
                                            style={{ width: '100%', padding: '10px', border: '2px solid #6f42c1', boxSizing: 'border-box', textTransform: 'uppercase', fontWeight: 'bold', fontSize: '1.1rem' }} 
                                        />
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', marginTop: '5px' }}>
                                        <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>PRODUCT TYPE:</label><select value={assemblyDetails.productType} onChange={e => setAssemblyDetails({...assemblyDetails, productType: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }}><option value="">SELECT...</option>{(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                                        <div><label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>COLLECTION:</label><select value={assemblyDetails.collection} onChange={e => setAssemblyDetails({...assemblyDetails, collection: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }}><option value="">SELECT...</option>{(globalLists.collections || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '15px', marginTop: '10px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>ASSEMBLY BASE PRICE ($):</label>
                                            <input type="number" step="0.01" value={assemblyDetails.basePrice} onChange={(e) => setAssemblyDetails({...assemblyDetails, basePrice: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '10px', border: '2px solid #28a745', fontWeight: 'bold', fontSize: '1.1rem', boxSizing: 'border-box' }} />
                                            <span style={{ fontSize: '0.65rem', color: '#666', display: 'block', marginTop: '3px' }}>Standalone CPQ Base Price</span>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>ASSEMBLY UNIT COST ($):</label>
                                            <input type="number" step="0.01" value={assemblyDetails.cost} onChange={(e) => setAssemblyDetails({...assemblyDetails, cost: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '10px', border: '1px solid #ccc', fontSize: '1.1rem', boxSizing: 'border-box' }} />
                                            <span style={{ fontSize: '0.65rem', color: '#666', display: 'block', marginTop: '3px' }}>Internal Cost (Optional)</span>
                                        </div>
                                    </div>
                                    
                                    <div style={{ borderTop: '2px solid #28a745', paddingTop: '15px', marginTop: '15px', display: 'flex', gap: '15px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>UPLOAD MASTER PRINT (PDF):</label>
                                            {assemblyDetails.pdfUrl && <a href={assemblyDetails.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#007bff', display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>[View Current PDF]</a>}
                                            <input type="file" accept="application/pdf" onChange={(e) => setAssemblyPdfFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                                        </div>
                                        <div style={{ flex: 1, borderLeft: '1px solid #28a745', paddingLeft: '15px' }}>
                                            <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#e83e8c' }}>MASTER 3D CAD (.GLB):</label>
                                            {assemblyDetails.cadUrl ? (
                                                <div style={{ background: '#fff', padding: '8px', border: '1px solid #28a745', borderRadius: '4px' }}>
                                                    <div style={{ fontSize: '0.7rem', color: '#28a745', fontWeight: 'bold' }}>✓ SYNCED FROM INCEPTION</div>
                                                    <a href={assemblyDetails.cadUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#007bff', display: 'block', margin: '5px 0', fontWeight: 'bold' }}>[Download Current .GLB]</a>
                                                    <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '8px', marginBottom: '3px' }}>Overwrite file (Optional):</div>
                                                    <input type="file" accept=".glb" onChange={(e) => setAssemblyCadFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{ fontSize: '0.7rem', color: '#d9534f', marginBottom: '5px', fontWeight: 'bold' }}>⚠️ NO 3D MODEL FOUND</div>
                                                    <input type="file" accept=".glb" onChange={(e) => setAssemblyCadFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <button onClick={saveAssemblyDetails} style={{ padding: '12px', background: isSaving ? '#ccc' : '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer', marginTop: '10px' }}>
                                        {isSaving ? "SAVING..." : "💾 SAVE ASSEMBLY METADATA & FILES"}
                                    </button>
                                </div>
                                <div style={{ textAlign: 'center', marginTop: '20px', fontSize: '0.85rem', color: '#999', fontStyle: 'italic' }}>Select a component from the BOM list on the left to edit its global master data.</div>
                            </>
                        ) : (
                            <div style={{ color: '#999', fontWeight: 'bold', fontSize: '1.1rem', textAlign: 'center', marginTop: '100px' }}>AWAITING ASSEMBLY SELECTION</div>
                        )}
                    </div>
                ) : (
                    <>
                        {/* --- COMPONENT EDITOR --- */}

                        <div style={{ background: '#f0f8ff', border: '2px dashed #007bff', padding: '15px' }}>
                            <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #007bff', paddingBottom: '5px', color: '#007bff', display: 'flex', justifyContent: 'space-between' }}>
                                <span>🔗 CPQ CONFIGURATION MAPPING</span>
                                <span style={{ fontSize: '0.6rem', color: '#666' }}>Ties Part to Dictionaries in Tab 11</span>
                            </h4>
                            <p style={{ fontSize: '0.75rem', color: '#333', marginBottom: '15px', lineHeight: '1.4' }}>
                                If this component is highly configurable (e.g., Tassel, Metal Frame), do <strong>not</strong> assign a single fixed texture. Instead, map it to a CPQ Option Category below so the customer can configure it at checkout.
                            </p>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: '#fff', padding: '15px', border: '1px solid #ccc' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={editSpecs.cpqCategories?.includes('master_finishes')} onChange={() => handleCpqCategoryToggle('master_finishes')} style={{ transform: 'scale(1.2)' }} />
                                    Master Finishes (Global Metals/Wood)
                                </label>
                                
                                {windowConfig.custom.filter(w => w.brands.includes(activeBrand)).map(w => (
                                    <label key={w.id} style={{ fontSize: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                        <input type="checkbox" checked={editSpecs.cpqCategories?.includes(w.id)} onChange={() => handleCpqCategoryToggle(w.id)} style={{ transform: 'scale(1.2)' }} />
                                        {w.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* 🚀 UNIVERSAL WAREHOUSE BIN LOCATION */}
                        <div style={{ background: '#f8f9fa', border: '2px solid #6f42c1', padding: '15px', marginTop: '10px' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#6f42c1', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '8px' }}>
                                📍 WAREHOUSE BIN LOCATION (BARCODE/REF)
                            </label>
                            <input 
                                name="binLocation" 
                                value={editSpecs.binLocation || ""} 
                                onChange={handleSpecChange} 
                                placeholder="e.g. A1-B2-04" 
                                style={{ width: '100%', padding: '10px', border: '2px solid #6f42c1', boxSizing: 'border-box', textTransform: 'uppercase', fontWeight: 'bold', fontSize: '1.1rem' }} 
                            />
                            <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '5px', fontStyle: 'italic' }}>
                                Used by the Pick/Pack App to guide operators to the physical item location.
                            </div>
                        </div>

                        <div>
                            <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px', marginTop: '15px' }}>CORE STATIC ATTRIBUTES</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROD TYPE:</label><select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}><option value="">SELECT...</option>{(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                                
                                {/* 🚀 NEW: PART HANDLING INTEGRATION */}
                                {windowConfig.system.partHandling?.includes(activeBrand) && (
                                    <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#1e7e34' }}>PART HANDLING:</label><select name="partHandling" value={editSpecs.partHandling || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #28a745', fontWeight: 'bold' }}><option value="">UNASSIGNED / STANDARD</option>{(globalLists.partHandling || []).map(ph => <option key={ph} value={ph}>{ph.toUpperCase()}</option>)}</select></div>
                                )}

                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>UOM:</label><select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>{(globalLists.uom || []).map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>COLLECTION:</label><select name="collection" value={editSpecs.collection || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}><option value="">SELECT...</option><option value="N/A">N/A</option>{(globalLists.collections || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                <div style={{ background: '#fff3cd', border: '1px solid #ffeeba', padding: '5px 10px' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'block', marginBottom: '3px' }}>ASSIGN TO WATCHLIST:</label><select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', fontWeight: 'bold' }}><option value="NONE">NONE</option>{(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}</select></div>
                                
                                {customSchema.map(field => (
                                    <div key={field.key} style={{ display: 'flex', flexDirection: 'column' }}>
                                        <label style={{ fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '5px', color: '#007bff' }}>{field.label} (Schema):</label>
                                        {field.type === 'dropdown' ? (
                                            <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #007bff' }}>
                                                <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                            </select>
                                        ) : (
                                            <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #007bff', boxSizing: 'border-box' }} />
                                        )}
                                    </div>
                                ))}

                            </div>
                        </div>

                        <div>
                            <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px', color: '#007bff' }}>LOGISTICS & SOURCING</h4>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                                <button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '10px', background: editSpecs.isInHouse ? '#000' : '#eee', color: editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>IN-HOUSE</button>
                                <button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '10px', background: !editSpecs.isInHouse ? '#000' : '#eee', color: !editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>OUTSOURCED</button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {editSpecs.isInHouse ? (
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROGRAM #:</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>RAW MAT:</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE PRICE ($):</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            {windowConfig.system.vendors?.includes(activeBrand) ? (
                                                <div style={{ flex: 2 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR NAME:</label><select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}><option value="">SELECT VENDOR...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                            ) : (
                                                <div style={{ flex: 2 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR NAME:</label><input name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            )}
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#007bff' }}>VENDOR PART # / SKU:</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box' }} /></div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>PURCHASE LINK (URL): {editSpecs.vendorUrl && <a href={editSpecs.vendorUrl.startsWith('http') ? editSpecs.vendorUrl : `https://${editSpecs.vendorUrl}`} target="_blank" rel="noreferrer" style={{color: '#007bff', textDecoration: 'none'}}>Open ↗</a>}</label><input name="vendorUrl" value={editSpecs.vendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>ALT ITEM LINK (URL): {editSpecs.altVendorUrl && <a href={editSpecs.altVendorUrl.startsWith('http') ? editSpecs.altVendorUrl : `https://${editSpecs.altVendorUrl}`} target="_blank" rel="noreferrer" style={{color: '#007bff', textDecoration: 'none'}}>Open ↗</a>}</label><input name="altVendorUrl" value={editSpecs.altVendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE PRICE ($):</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>MOQ:</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>LEAD (DAYS):</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        </div>
                                    </>
                                )}
                            </div>
                            
                            <div style={{ borderTop: '2px solid #eee', paddingTop: '10px', marginTop: '5px', display: 'flex', gap: '15px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>UPLOAD PRINT (PDF):</label>
                                    {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#007bff', display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>[View Current PDF]</a>}
                                    <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                                    {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                                </div>
                                <div style={{ flex: 1, borderLeft: '1px solid #eee', paddingLeft: '15px' }}>
                                    <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: '#e83e8c' }}>3D CAD MODEL (.GLB / .GLTF):</label>
                                    {editSpecs.cadUrl && <div style={{ fontSize: '0.7rem', color: '#28a745', marginBottom: '5px', fontWeight: 'bold' }}>[✓ 3D Model Assigned]</div>}
                                    <input type="file" accept=".glb,.gltf" onChange={(e) => setCadFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                                    {cadUploadProgress > 0 && <progress value={cadUploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                                </div>
                            </div>
                        </div>

                        <div style={{ background: '#f8f9fa', border: '2px solid #CC6600', padding: '15px', marginTop: '10px' }}>
                            <h4 style={{ margin: '0 0 10px 0', color: '#CC6600', display: 'flex', alignItems: 'center', gap: '5px' }}>📐 GEOMETRY & Z-INDEX RULES</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>LENGTH (in):</label><input name="length" type="number" step="0.1" value={editSpecs.parametric?.length || ""} onChange={handleParametricChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>WIDTH (in):</label><input name="width" type="number" step="0.1" value={editSpecs.parametric?.width || ""} onChange={handleParametricChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>HEIGHT (in):</label><input name="height" type="number" step="0.1" value={editSpecs.parametric?.height || ""} onChange={handleParametricChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                            </div>
                            <div style={{ marginBottom: '15px' }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><input type="checkbox" name="isCutToSize" checked={editSpecs.parametric?.isCutToSize || false} onChange={handleParametricChange} />DYNAMIC CUSTOM LENGTH ALLOWED</label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d9534f' }}>Z-INDEX / RENDER LAYER:</label><input name="layeringSequence" type="number" step="10" value={editSpecs.layeringSequence || ""} onChange={handleSpecChange} placeholder="e.g. 10 (Back), 30 (Front)" style={{ width: '100%', padding: '8px', border: '2px solid #ccc', boxSizing: 'border-box' }} /></div>
                                <div style={{ gridColumn: 'span 2', background: '#e3f2fd', padding: '10px', border: '2px solid #007bff' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>WIDTH OFFSET / DEDUCTION (INCHES):</label><input name="widthOffset" type="number" step="0.125" value={editSpecs.parametric?.widthOffset || ""} onChange={handleParametricChange} style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
                            </div>
                        </div>

                        <div style={{ borderTop: '2px solid #eee', paddingTop: '20px', marginTop: 'auto' }}>
                            <button onClick={saveGlobalUpdates} style={{ width: '100%', padding: '15px', background: isSaving ? '#28a745' : '#007bff', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: '2px solid #000', cursor: 'pointer', transition: '0.3s' }}>
                                {isSaving ? "GLOBAL DATA SAVED ✓" : "💾 SAVE GLOBAL PART DATA"}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default BOMTab;