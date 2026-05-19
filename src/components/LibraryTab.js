import React, { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

const LibraryTab = ({ currentUser, activeBrand }) => {
  const [isAdmin, setIsAdmin] = useState(true);

  // --- CORE DATA STATE ---
  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  
  // --- SYSTEM SCHEMAS & GLOBAL DATA ---
  const [customSchema, setCustomSchema] = useState([]);
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [globalLists, setGlobalLists] = useState({ uom: [], prodTypes: [], collections: [], watchLists: [] });
  const [newListItems, setNewListItems] = useState({});

  // --- ADMIN UI TOGGLES ---
  const [showSchemaForm, setShowSchemaForm] = useState(false);
  const [showFinishForm, setShowFinishForm] = useState(false);

  const [newFieldConfig, setNewFieldConfig] = useState({ key: '', label: '', type: 'text', options: '' });
  const [newFinishConfig, setNewFinishConfig] = useState({ name: '', code: '', type: '', textureUrl: '' });
  const [finishUploadProgress, setFinishUploadProgress] = useState(0);

  // --- EDITOR STATE ---
  const [activePart, setActivePart] = useState(null);
  const [editSpecs, setEditSpecs] = useState({ customData: {} });
  const [isSaving, setIsSaving] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dynamicUploadProgress, setDynamicUploadProgress] = useState({});

  // 1. Fetch ALL Dynamic System Data
  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields);
    });
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes);
    });
    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          setGlobalLists(docSnap.data());
      } else {
          const defaults = {
              uom: ["EA", "FT", "IN", "SET", "PAIR"],
              prodTypes: ["HARDWARE", "COMPONENT", "RAW MATERIAL"],
              collections: ["N/A", "HARLOW", "SIGNATURE"],
              watchLists: ["NONE", "CRITICAL EXPEDITE", "DISCONTINUED RISK"]
          };
          setDoc(doc(db, "system", "master_lists"), defaults);
          setGlobalLists(defaults);
      }
    });

    return () => { unsubSchema(); unsubFinishes(); unsubLists(); };
  }, []);

  // 2. Fetch Master Inventory
  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      docs.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));
      setInventory(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  const filteredInventory = inventory.filter(part => {
    const matchesSearch = part.itemName?.toLowerCase().includes(searchTerm.toLowerCase()) || (part.legacyErpId && part.legacyErpId.toLowerCase().includes(searchTerm.toLowerCase())) || (part.itemId && part.itemId.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesType = typeFilter === "" || part.manufacturingSpecs?.productType === typeFilter;
    return matchesSearch && matchesType;
  });

  // --- EDITOR HANDLERS ---
  const openPartDetails = (part) => {
    setActivePart(part);
    setPdfFile(null);
    setDynamicUploadProgress({});
    const baseSpecs = part.manufacturingSpecs || {};
    const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER" };
    const customData = baseSpecs.customData || {}; 
    const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
    
    let shared = part.sharedBrands || [];
    if (!shared.includes(part.brandId)) shared = [...shared, part.brandId];
    
    setEditSpecs({ ...baseSpecs, parametric: parametricData, customData, isInHouse, sharedBrands: shared });
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleParametricChange = (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: value } });
  };

  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));

  const handleBrandToggle = (brandId) => {
    let currentShared = editSpecs.sharedBrands || [];
    if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId);
    else currentShared.push(brandId);
    setEditSpecs({ ...editSpecs, sharedBrands: currentShared });
  };

  const handleDynamicFileUpload = async (key, file) => {
      if (!file) return;
      const safeId = activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId;
      const storageRef = ref(storage, `dynamic_assets/${activeBrand}_${safeId}_${key}_${Date.now()}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on("state_changed", 
          (snap) => setDynamicUploadProgress(prev => ({ ...prev, [key]: Math.round((snap.bytesTransferred / snap.totalBytes) * 100) })),
          (err) => { console.error(err); alert("Upload failed"); },
          async () => { 
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              handleCustomFieldChange(key, downloadURL);
              setDynamicUploadProgress(prev => ({ ...prev, [key]: 0 }));
          }
      );
  };

  const handleCreateNewPart = () => {
    const newId = `${activeBrand.toUpperCase()}-INV-${Math.floor(1000+Math.random()*9000)}`;
    setActivePart({
      isNew: true, id: newId, itemId: newId, legacyErpId: "PENDING", itemName: "NEW STANDALONE COMPONENT", brandId: activeBrand, partClass: "Inventory",
    });
    setEditSpecs({
      productType: "", uom: "EA", finishDetail: "", collection: "N/A", watchList: "NONE",
      isInHouse: true, programNum: "", material: "", layeringSequence: "10",
      vendorName: "", vendorId: "", vendorUrl: "", cost: "", leadTime: "", moq: "",
      sharedBrands: [activeBrand], customData: {},
      parametric: { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER" }
    });
    setPdfFile(null);
  };

  const handleDeletePart = async () => {
    if (!activePart || activePart.isNew) return setActivePart(null);
    if (window.confirm(`Permanently delete ${activePart.legacyErpId || activePart.itemId}? This cannot be undone.`)) {
      try { await deleteDoc(doc(db, "Approved_Designs", activePart.id)); setActivePart(null); } 
      catch (err) { console.error(err); alert("Failed to delete part."); }
    }
  };

  const savePartUpdates = async () => {
    if (!activePart) return;
    setIsSaving(true);
    let finalPdfUrl = editSpecs.pdfUrl || "";

    if (pdfFile) {
      const storageRef = ref(storage, `prints/${activeBrand}_${editSpecs.tempLegacyId || activePart.legacyErpId}_${pdfFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, pdfFile);
      await new Promise((resolve, reject) => {
        uploadTask.on("state_changed", 
          (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => reject(err),
          async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }
        );
      });
    }

    const compiledSpecs = { ...editSpecs, pdfUrl: finalPdfUrl };
    const finalName = editSpecs.tempName || activePart.itemName;
    const finalLegacyId = (editSpecs.tempLegacyId || activePart.legacyErpId).toUpperCase();

    try {
      const payload = {
          itemName: finalName, legacyErpId: finalLegacyId,
          sharedBrands: editSpecs.sharedBrands || [activePart.brandId || activeBrand],
          manufacturingSpecs: compiledSpecs,
          updatedAt: new Date().toISOString()
      };
      if (activePart.isNew) payload.createdAt = new Date().toISOString();

      await setDoc(doc(db, "Approved_Designs", activePart.id), { ...activePart, ...payload }, { merge: true });
      setTimeout(() => { setIsSaving(false); setActivePart(null); setUploadProgress(0); }, 500);
    } catch (err) {
      console.error(err); setIsSaving(false); alert("Failed to save.");
    }
  };

  // --- ADMIN SYSTEM HANDLERS ---
  const handleAddSchemaField = async () => {
      if (!newFieldConfig.label) return alert("Label is required.");
      const key = newFieldConfig.key || newFieldConfig.label.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
      const updatedSchema = [...customSchema, { ...newFieldConfig, key }];
      try {
          await setDoc(doc(db, "system", "master_schema"), { inventoryFields: updatedSchema }, { merge: true });
          setNewFieldConfig({ key: '', label: '', type: 'text', options: '' });
          setShowSchemaForm(false);
      } catch (err) { console.error(err); alert("Failed to update schema."); }
  };

  const handleRemoveSchemaField = async (keyToRemove) => {
      if (!window.confirm("Remove this field?")) return;
      const updatedSchema = customSchema.filter(f => f.key !== keyToRemove);
      try { await setDoc(doc(db, "system", "master_schema"), { inventoryFields: updatedSchema }, { merge: true }); } 
      catch (err) { console.error(err); }
  };

  const handleAddGlobalFinish = async () => {
      if (!newFinishConfig.name) return alert("Finish name required.");
      const newFinish = {
          id: `FIN-${Date.now()}`, name: newFinishConfig.name.toUpperCase(), code: newFinishConfig.code.toUpperCase(),
          type: newFinishConfig.type.toUpperCase(), textureUrl: newFinishConfig.textureUrl
      };
      const updatedFinishes = [...globalFinishes, newFinish];
      try {
          await setDoc(doc(db, "system", "master_finishes"), { finishes: updatedFinishes }, { merge: true });
          setNewFinishConfig({ name: '', code: '', type: '', textureUrl: '' });
          setShowFinishForm(false);
      } catch (err) { console.error(err); alert("Failed to save finish."); }
  };

  const handleFinishTextureUpload = async (file) => {
      if (!file) return;
      const storageRef = ref(storage, `system_textures/TEX_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      uploadTask.on("state_changed",
          (snap) => setFinishUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          (err) => { console.error(err); alert("Texture upload failed"); },
          async () => {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              setNewFinishConfig({ ...newFinishConfig, textureUrl: url });
              setFinishUploadProgress(0);
          }
      );
  };

  const handleRemoveFinish = async (idToRemove) => {
      if (!window.confirm("Delete this Master Finish?")) return;
      const updatedFinishes = globalFinishes.filter(f => f.id !== idToRemove);
      try { await setDoc(doc(db, "system", "master_finishes"), { finishes: updatedFinishes }, { merge: true }); } 
      catch (err) { console.error(err); }
  };

  // --- DYNAMIC LIST MANAGERS ---
  const handleAddNewListCategory = async () => {
      const name = window.prompt("Enter the name for the new List Category (e.g., 'Packaging Types'):");
      if (!name) return;
      const key = name.replace(/[^a-zA-Z0-9]/g, '');
      if (globalLists[key]) return alert("List category already exists.");
      
      try { await setDoc(doc(db, "system", "master_lists"), { ...globalLists, [key]: [] }); } 
      catch(err) { console.error(err); }
  };

  const handleAddListItem = async (listKey) => {
      const val = (newListItems[listKey] || '').toUpperCase().trim();
      if (!val) return;
      if (globalLists[listKey]?.includes(val)) return alert("Item already exists.");
      
      const updatedLists = { ...globalLists, [listKey]: [...(globalLists[listKey] || []), val] };
      try {
          await setDoc(doc(db, "system", "master_lists"), updatedLists);
          setNewListItems({ ...newListItems, [listKey]: '' });
      } catch(err) { console.error(err); }
  };

  const handleRemoveListItem = async (listKey, itemVal) => {
      if (!window.confirm(`Remove ${itemVal} from dropdowns?`)) return;
      const updatedLists = { ...globalLists, [listKey]: globalLists[listKey].filter(v => v !== itemVal) };
      try { await setDoc(doc(db, "system", "master_lists"), updatedLists); } 
      catch(err) { console.error(err); }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div><h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>4. Master Library & Data Rules</h2><span style={{ fontSize: '0.7rem', color: '#666' }}>{inventory.length} APPROVED INVENTORY ITEMS</span></div>
        <div style={{ display: 'flex', gap: '15px', width: '65%', alignItems: 'center' }}>
          <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', background: '#ffeeba', padding: '5px 10px', border: '1px solid #856404' }}>
              <input type="checkbox" checked={isAdmin} onChange={() => setIsAdmin(!isAdmin)} />
              SIMULATE ADMIN ROLE
          </label>
          <button onClick={handleCreateNewPart} style={{ padding: '10px 15px', background: '#007bff', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ NEW PART</button>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '10px', border: '2px solid #000', fontWeight: 'bold', flex: 1 }}>
              <option value="">ALL CATEGORIES</option>
              {globalLists.prodTypes?.map(pt => <option key={pt} value={pt}>{pt}</option>)}
          </select>
          <input placeholder="🔍 Search by Part Name or ERP ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ flex: 2, padding: '10px', border: '2px solid #000', fontWeight: 'bold', fontSize: '1rem' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        {/* LEFT LIST */}
        <div style={{ flex: activePart ? 1.5 : 1, display: 'grid', gridTemplateColumns: activePart ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px', alignContent: 'start' }}>
          {filteredInventory.map(part => {
            const specs = part.manufacturingSpecs || {};
            const isWatchlist = specs.watchList && specs.watchList !== "NONE";
            const displayId = part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId;
            const isSharedIn = part.brandId !== activeBrand; 

            return (
              <div key={part.id} onClick={() => openPartDetails(part)} style={{ background: activePart?.id === part.id ? '#fff9c4' : '#fff', border: '2px solid #000', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activePart?.id === part.id ? '5px 5px 0 #007bff' : '5px 5px 0 rgba(0,0,0,0.1)' }}>
                {isWatchlist && <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#d9534f', color: '#fff', padding: '5px 8px', fontSize: '0.6rem', fontWeight: 'bold', border: '2px solid #000', zIndex: 2 }}>★ WATCH</div>}
                {isSharedIn && <div style={{ position: 'absolute', top: '5px', left: '5px', background: '#ffc107', color: '#000', padding: '2px 5px', fontSize: '0.55rem', fontWeight: 'bold', border: '1px solid #000', zIndex: 2 }}>SHARED FROM {part.brandId.toUpperCase()}</div>}

                <div style={{ height: '150px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {part.finalImageUrl ? <img src={part.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: '#aaa', fontSize: '2rem' }}>⚙️</span>}
                </div>

                <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: '#007bff', marginBottom: '5px' }}>{displayId}</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', lineHeight: '1.2', flex: 1 }}>{part.itemName}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '10px' }}><span style={{ fontSize: '0.65rem', background: '#eee', padding: '3px 6px', borderRadius: '3px', border: '1px solid #ccc' }}>{specs.productType || "NO TYPE"}</span><span style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>{specs.isInHouse ? "IN-HOUSE" : "VENDOR"}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT EDIT PANEL */}
        {activePart && (
          <div style={{ flex: 1.5, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', position: 'sticky', top: '20px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
              <div><h3 style={{ margin: 0, fontSize: '1.2rem' }}>{activePart.isNew ? "NEW PART SETUP" : (activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId)}</h3><span style={{ fontSize: '0.7rem', color: '#aaa' }}>{activePart.isNew ? "Define Master Details Below" : activePart.itemName}</span></div>
              <button onClick={() => setActivePart(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div>
                 <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>IDENTIFICATION</h4>
                 <div style={{ display: 'flex', gap: '10px' }}>
                   <div style={{ flex: 2 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PART NAME / DESCRIPTION:</label><input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activePart.itemName} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
                   <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#007bff' }}>ERP LEGACY ID:</label><input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activePart.legacyErpId === "PENDING" ? "" : activePart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', textTransform: 'uppercase' }} /></div>
                 </div>
                 <div style={{ marginTop: '15px', background: '#f8f9fa', padding: '10px', border: '2px solid #ccc' }}>
                   <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>PART VISIBILITY & CROSS-BRAND SHARING:</label>
                   <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                     {AVAILABLE_BRANDS.map(brand => {
                        const isOwner = activePart.brandId === brand.id; const isShared = editSpecs.sharedBrands?.includes(brand.id);
                        return ( <label key={brand.id} style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.7 : 1 }}><input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id)} />{brand.name} {isOwner && "(Owner)"}</label> );
                     })}
                   </div>
                 </div>
              </div>

              {/* DYNAMIC FIELDS */}
              {customSchema.length > 0 && (
                <div style={{ background: '#f0f8ff', border: '2px solid #007bff', padding: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #007bff', paddingBottom: '5px', color: '#007bff', display: 'flex', justifyContent: 'space-between' }}>
                        <span>DYNAMIC ATTRIBUTES & ASSETS</span><span style={{ fontSize: '0.6rem', color: '#666' }}>Rendered from live schema</span>
                    </h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        {customSchema.map(field => (
                            <div key={field.key} style={{ display: 'flex', flexDirection: 'column' }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '5px' }}>{field.label}:</label>
                                
                                {field.type === 'dropdown' ? (
                                    <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}>
                                        <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                    </select>
                                ) : field.type === 'file' ? (
                                    <div style={{ background: '#fff', border: '2px solid #007bff', padding: '10px' }}>
                                        {editSpecs.customData?.[field.key] && (
                                            <div style={{ marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #ccc' }}>
                                                <a href={editSpecs.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem', color: '#28a745', fontWeight: 'bold', textDecoration: 'none' }}>✅ View Uploaded Asset</a>
                                            </div>
                                        )}
                                        <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%', cursor: 'pointer' }} />
                                        {dynamicUploadProgress[field.key] > 0 && <progress value={dynamicUploadProgress[field.key]} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                                    </div>
                                ) : (
                                    <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} />
                                )}
                            </div>
                        ))}
                    </div>
                </div>
              )}

              {/* CORE ATTRIBUTES */}
              <div>
                 <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>CORE ATTRIBUTES</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                   <div>
                       <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROD TYPE:</label>
                       <select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}>
                           <option value="">SELECT...</option>
                           {globalLists.prodTypes?.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                       </select>
                   </div>
                   <div>
                       <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>UOM:</label>
                       <select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}>
                           {globalLists.uom?.map(u => <option key={u} value={u}>{u}</option>)}
                       </select>
                   </div>
                   <div>
                       <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#6f42c1' }}>FINISH (GLOBAL):</label>
                       <select name="finishDetail" value={editSpecs.finishDetail || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #6f42c1', outline: 'none', fontWeight: 'bold' }}>
                           <option value="">SELECT...</option><option value="N/A">N/A (Raw/Unfinished)</option>
                           {globalFinishes.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                       </select>
                   </div>
                   <div>
                       <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>COLLECTION:</label>
                       <select name="collection" value={editSpecs.collection || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}>
                           <option value="">SELECT...</option>
                           {globalLists.collections?.map(c => <option key={c} value={c}>{c}</option>)}
                       </select>
                   </div>
                   <div style={{ gridColumn: 'span 2', background: '#fff3cd', border: '2px solid #ffc107', padding: '10px' }}>
                       <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: editSpecs.watchList !== "NONE" ? '#d9534f' : '#000' }}>ASSIGN TO WATCHLIST:</label>
                       <select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', fontWeight: 'bold' }}>
                           {globalLists.watchLists?.map(w => <option key={w} value={w}>{w}</option>)}
                       </select>
                   </div>
                 </div>
              </div>

              {/* SOURCING */}
              <div>
                <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px', color: '#007bff' }}>LOGISTICS & SOURCING</h4>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}><button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '10px', background: editSpecs.isInHouse ? '#000' : '#eee', color: editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>IN-HOUSE</button><button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '10px', background: !editSpecs.isInHouse ? '#000' : '#eee', color: !editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>OUTSOURCED</button></div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {editSpecs.isInHouse ? (
                    <>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROGRAM #:</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>RAW MAT:</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                      </div>
                      <div style={{ borderTop: '2px solid #eee', paddingTop: '10px', marginTop: '5px' }}>
                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>UPLOAD PRINT (PDF):</label>
                        {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#007bff', display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>[View Current PDF]</a>}
                        <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.7rem', width: '100%' }} />
                        {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 2 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR NAME:</label><input name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR ID:</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>MOQ:</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>LEAD (DAYS):</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* CAD RULES */}
              <div style={{ background: '#f8f9fa', border: '2px solid #007bff', padding: '15px' }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#007bff', display: 'flex', alignItems: 'center', gap: '5px' }}>📐 CAD & CPQ RULES</h4>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}><input type="checkbox" name="isCutToSize" checked={editSpecs.parametric?.isCutToSize || false} onChange={handleParametricChange} />DYNAMIC CUSTOM LENGTH ALLOWED</label>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ gridColumn: 'span 2' }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#d9534f' }}>Z-INDEX / RENDER LAYER:</label><input name="layeringSequence" type="number" step="10" value={editSpecs.layeringSequence || ""} onChange={handleSpecChange} placeholder="e.g. 10 (Back), 30 (Front)" style={{ width: '100%', padding: '8px', border: '2px solid #ccc', boxSizing: 'border-box' }} /></div>
                  <div style={{ gridColumn: 'span 2', background: '#e3f2fd', padding: '10px', border: '2px solid #007bff' }}><label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff' }}>WIDTH OFFSET / DEDUCTION (INCHES):</label><input name="widthOffset" type="number" step="0.125" value={editSpecs.parametric?.widthOffset || ""} onChange={handleParametricChange} style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', fontWeight: 'bold' }} /></div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={savePartUpdates} style={{ flex: 2, padding: '15px', background: isSaving ? '#28a745' : '#000', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: '2px solid #000', cursor: 'pointer', transition: '0.3s', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)' }}>{isSaving ? "SAVED ✓" : "SAVE PART"}</button>
                {!activePart.isNew && <button onClick={handleDeletePart} style={{ flex: 1, padding: '15px', background: '#fff', color: '#d9534f', border: '2px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', boxShadow: '4px 4px 0 rgba(217,83,79,0.2)' }}>🗑️ DELETE</button>}
              </div>

            </div>
          </div>
        )}
      </div>

      {/* ========================================================= */}
      {/* SOLID, CLEAN ADMIN MANAGERS                               */}
      {/* ========================================================= */}
      {isAdmin && (
          <div style={{ marginTop: '40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            
            {/* 1. DYNAMIC FIELD MANAGER */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #17a2b8' }}>
                <div style={{ padding: '15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <span>⚙️ FIELD SCHEMA</span>
                    <button onClick={() => setShowSchemaForm(!showSchemaForm)} style={{ background: '#fff', color: '#17a2b8', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                        {showSchemaForm ? 'CLOSE' : '+ ADD FIELD'}
                    </button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                    {showSchemaForm && (
                        <div style={{ padding: '20px', background: '#e0f7fa', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>NEW FIELD LABEL:</label><input value={newFieldConfig.label} onChange={(e) => setNewFieldConfig({...newFieldConfig, label: e.target.value})} placeholder="e.g. Tariff Code" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                            <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>DATA TYPE:</label><select value={newFieldConfig.type} onChange={(e) => setNewFieldConfig({...newFieldConfig, type: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }}><option value="text">Text (String)</option><option value="number">Number</option><option value="dropdown">Dropdown</option><option value="file">File Upload (PNG, PDF)</option></select></div>
                            {newFieldConfig.type === 'dropdown' && <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>OPTIONS (Comma Separated):</label><input value={newFieldConfig.options} onChange={(e) => setNewFieldConfig({...newFieldConfig, options: e.target.value})} placeholder="A, B, C" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>}
                            <button onClick={handleAddSchemaField} style={{ padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', marginTop: '10px' }}>SAVE NEW FIELD</button>
                        </div>
                    )}
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', background: '#f8f9fa' }}>
                        {customSchema.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No custom fields added yet.</span>}
                        {customSchema.map(field => (
                            <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', boxShadow: '3px 3px 0 rgba(0,0,0,0.05)' }}>
                                <div><div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{field.label}</div><div style={{ fontSize: '0.65rem', color: '#666', marginTop: '3px', fontWeight: 'bold' }}>TYPE: {field.type.toUpperCase()} | ID: {field.key}</div></div>
                                <button onClick={() => handleRemoveSchemaField(field.key)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 2. GLOBAL FINISHES MANAGER */}
            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #6f42c1' }}>
                <div style={{ padding: '15px', background: '#6f42c1', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <span>🎨 MASTER FINISHES</span>
                    <button onClick={() => setShowFinishForm(!showFinishForm)} style={{ background: '#fff', color: '#6f42c1', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                        {showFinishForm ? 'CLOSE' : '+ ADD FINISH'}
                    </button>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                    {showFinishForm && (
                        <div style={{ padding: '20px', background: '#f3e8ff', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>FINISH NAME:</label><input value={newFinishConfig.name} onChange={(e) => setNewFinishConfig({...newFinishConfig, name: e.target.value})} placeholder="e.g. Matte Brass" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>CODE:</label><input value={newFinishConfig.code} onChange={(e) => setNewFinishConfig({...newFinishConfig, code: e.target.value})} placeholder="MB" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>CATEGORY / TYPE:</label><input value={newFinishConfig.type} onChange={(e) => setNewFinishConfig({...newFinishConfig, type: e.target.value})} placeholder="e.g. METAL, WOOD" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box', textTransform: 'uppercase' }} /></div>
                            </div>
                            <div style={{ background: '#fff', padding: '10px', border: '2px solid #000' }}>
                                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>SEAMLESS TEXTURE MAP (JPG/PNG):</label>
                                {newFinishConfig.textureUrl && <div style={{ color: '#28a745', fontWeight: 'bold', fontSize: '0.7rem', marginBottom: '5px' }}>✅ Asset Ready</div>}
                                <input type="file" accept="image/*" onChange={(e) => handleFinishTextureUpload(e.target.files[0])} style={{ fontSize: '0.75rem', width: '100%', cursor: 'pointer' }} />
                                {finishUploadProgress > 0 && <progress value={finishUploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                            </div>
                            <button onClick={handleAddGlobalFinish} style={{ padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', marginTop: '10px' }}>SAVE NEW FINISH</button>
                        </div>
                    )}
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', background: '#f8f9fa' }}>
                        {globalFinishes.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No finishes added yet.</span>}
                        {globalFinishes.map(finish => (
                            <div key={finish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', borderLeft: `6px solid #6f42c1`, boxShadow: '3px 3px 0 rgba(0,0,0,0.05)' }}>
                                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                    <div style={{ width: '40px', height: '40px', background: finish.textureUrl ? `url(${finish.textureUrl}) center/cover` : '#eee', borderRadius: '50%', border: '2px solid #000' }} />
                                    <div><div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{finish.name} {finish.code && `(${finish.code})`}</div><div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold', marginTop: '3px' }}>TYPE: {finish.type}</div></div>
                                </div>
                                <button onClick={() => handleRemoveFinish(finish.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* 3. GLOBAL DROPDOWN LISTS MANAGER */}
            <div style={{ gridColumn: 'span 2', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #fd7e14' }}>
                <div style={{ padding: '15px', background: '#fd7e14', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                    <span>📋 GLOBAL DROPDOWN LISTS</span>
                    <button onClick={handleAddNewListCategory} style={{ background: '#fff', color: '#fd7e14', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                        + ADD LIST CATEGORY
                    </button>
                </div>
                
                <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', background: '#f8f9fa' }}>
                    {Object.keys(globalLists).map(listKey => (
                        <div key={listKey} style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                            <h4 style={{ margin: '0 0 15px 0', borderBottom: '2px solid #eee', paddingBottom: '8px', textTransform: 'uppercase', color: '#000', fontSize: '0.9rem' }}>{listKey}</h4>
                            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                                <input value={newListItems[listKey] || ''} onChange={(e) => setNewListItems({...newListItems, [listKey]: e.target.value})} style={{ flex: 1, padding: '8px', border: '2px solid #000', fontWeight: 'bold' }} placeholder="Add item..." />
                                <button onClick={() => handleAddListItem(listKey)} style={{ background: '#000', color: '#fff', border: '2px solid #000', cursor: 'pointer', padding: '0 15px', fontWeight: 'bold', fontSize: '1.2rem' }}>+</button>
                            </div>
                            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                {(globalLists[listKey] || []).length === 0 && <div style={{ fontSize: '0.7rem', color: '#999', fontStyle: 'italic' }}>List is empty.</div>}
                                {(globalLists[listKey] || []).map(item => (
                                    <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', background: '#f4f4f4', padding: '8px 10px', border: '1px solid #ccc', fontWeight: 'bold', color: '#333' }}>
                                        {item} <span onClick={() => handleRemoveListItem(listKey, item)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}>×</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

          </div>
      )}

    </div>
  );
};

export default LibraryTab;