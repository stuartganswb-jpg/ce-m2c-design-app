import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";

const UOM_OPTIONS = ["EA", "FT", "MTR", "YD", "IN", "LB", "SET", "PAIR"];
const PROD_TYPES = ["HARDWARE", "TRIMMING", "LIGHTING", "TEXTILE", "JEWELRY", "PACKAGING", "RAW MATERIAL", "COMPONENT"];
const COLLECTIONS = ["HARLOW", "SIGNATURE", "COASTAL", "MODERN ARCHITECTURAL", "N/A"];
const WATCHLISTS = ["NONE", "FALL 26", "SPRING 27", "CRITICAL EXPEDITE", "DISCONTINUED RISK", "LONG LEAD TIME"];

const BOMTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  
  // Data Joins
  const [bomPins, setBomPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  // Master Schema Data
  const [customSchema, setCustomSchema] = useState([]);
  const [globalFinishes, setGlobalFinishes] = useState([]);

  // Editor State
  const [activeComponent, setActiveComponent] = useState(null);
  const [editSpecs, setEditSpecs] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  // 1. Fetch Dynamic Schema & Finishes
  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields);
    });
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => {
      if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes);
    });
    return () => { unsubSchema(); unsubFinishes(); };
  }, []);

  // 2. Fetch Master Assemblies
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

  // 3. Fetch BOM Pins for Selected Assembly
  useEffect(() => {
    if (!selectedAssemblyId) { setBomPins([]); return; }
    const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", selectedAssemblyId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [selectedAssemblyId]);

  // 4. Fetch Master Library Parts (To join data and get thumbnails)
  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"), where("partClass", "==", "Inventory"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setLibraryParts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [activeBrand]);

  // --- JOIN LOGIC ---
  // Combine the Pin data (Qty) with the Master Library data (Thumbnail, Specs, Cost)
  const populatedBOM = bomPins.map(pin => {
      const masterPart = libraryParts.find(p => p.id === pin.partId);
      return { ...pin, masterPart: masterPart || null };
  });

  // --- EDITOR HANDLERS ---
  const openComponentEditor = (bomItem) => {
      if (!bomItem.masterPart) return alert("Master part not found. It may have been deleted.");
      setActiveComponent(bomItem);
      
      const baseSpecs = bomItem.masterPart.manufacturingSpecs || {};
      const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER" };
      const customData = baseSpecs.customData || {}; 
      const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
      
      setEditSpecs({ ...baseSpecs, parametric: parametricData, customData, isInHouse });
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  
  const handleCustomFieldChange = (key, value) => {
      setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  };

  const saveGlobalUpdates = async () => {
      if (!activeComponent?.masterPart) return;
      setIsSaving(true);
      try {
          // UPDATE THE MASTER RECORD (TAB 4 GLOBAL DATA)
          await updateDoc(doc(db, "Approved_Designs", activeComponent.masterPart.id), {
              manufacturingSpecs: editSpecs,
              updatedAt: new Date().toISOString()
          });
          
          setTimeout(() => { setIsSaving(false); setActiveComponent(null); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save global updates.");
      }
  };

  // Calculate Assembly Totals
  const totalCost = populatedBOM.reduce((sum, item) => sum + ((item.masterPart?.manufacturingSpecs?.cost || 0) * (item.defaultQty || 1)), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
          <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>3. Bill of Materials Engine</h2>
          <span style={{ fontSize: '0.7rem', color: '#666' }}>GLOBAL COMPONENT DATA SYNC</span>
        </div>
        
        <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
          <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>SELECT ASSEMBLY:</label>
          <select value={selectedAssemblyId} onChange={(e) => { setSelectedAssemblyId(e.target.value); setActiveComponent(null); }} style={{ padding: '10px', border: '2px solid #000', fontWeight: 'bold', textTransform: 'uppercase', minWidth: '300px' }}>
            {assemblies.length === 0 && <option value="">NO ASSEMBLIES FOUND</option>}
            {assemblies.map(a => <option key={a.id} value={a.itemId}>{a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'stretch', flex: 1 }}>
        
        {/* LEFT PANE: BOM LIST */}
        <div style={{ flex: 1.2, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 rgba(0,0,0,0.1)' }}>
            <div style={{ padding: '15px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                <span style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>ASSEMBLY COMPONENTS (BOM)</span>
                <span style={{ fontSize: '0.8rem', background: '#28a745', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold' }}>BASE COST: ${totalCost.toFixed(2)}</span>
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
                                {/* THUMBNAIL COLUMN */}
                                <div style={{ width: '80px', height: '80px', background: '#e9ecef', borderRight: '1px solid #ccc', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                    {master.finalImageUrl ? (
                                        <img src={master.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ fontSize: '1.5rem', color: '#bbb' }}>⚙️</span>
                                    )}
                                </div>

                                {/* DATA COLUMN */}
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

        {/* RIGHT PANE: GLOBAL DATA EDITOR */}
        <div style={{ flex: 1.5, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '15px 20px', background: '#007bff', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', textTransform: 'uppercase' }}>GLOBAL PART DATA</h3>
                    <span style={{ fontSize: '0.75rem' }}>Changes made here update the Master Library globally.</span>
                </div>
                {activeComponent && <span style={{ background: '#fff', color: '#007bff', padding: '4px 8px', fontSize: '0.8rem', fontWeight: 'bold' }}>{activeComponent.legacyErpId}</span>}
            </div>

            <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '25px' }}>
                {!activeComponent ? (
                    <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#999', fontWeight: 'bold', fontSize: '1.1rem' }}>
                        SELECT A BOM COMPONENT TO EDIT
                    </div>
                ) : (
                    <>
                        {/* DYNAMIC FIELDS (Admin Managed Schema) */}
                        {customSchema.length > 0 && (
                            <div style={{ background: '#f8f9fa', border: '2px dashed #007bff', padding: '15px' }}>
                                <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #ccc', paddingBottom: '5px', color: '#007bff', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>DYNAMIC ATTRIBUTES</span>
                                    <span style={{ fontSize: '0.6rem', color: '#666' }}>Rendered from live schema</span>
                                </h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                    {customSchema.map(field => (
                                        <div key={field.key} style={{ display: 'flex', flexDirection: 'column' }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '5px' }}>{field.label}:</label>
                                            {field.type === 'dropdown' ? (
                                                <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>
                                                    <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                                </select>
                                            ) : field.type === 'file' ? (
                                                <div style={{ fontSize: '0.7rem', color: '#666', fontStyle: 'italic', background: '#eee', padding: '8px' }}>
                                                    {editSpecs.customData?.[field.key] ? <a href={editSpecs.customData[field.key]} target="_blank" rel="noreferrer" style={{color:'#28a745', fontWeight:'bold'}}>✅ File Uploaded</a> : "No file attached. Upload via Tab 4."}
                                                </div>
                                            ) : (
                                                <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} />
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
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROD TYPE:</label><select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}><option value="">SELECT...</option>{PROD_TYPES.map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>UOM:</label><select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}>{UOM_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                
                                {/* GLOBAL FINISHES DROPDOWN */}
                                <div>
                                    <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#6f42c1' }}>FINISH (GLOBAL):</label>
                                    <select name="finishDetail" value={editSpecs.finishDetail || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #6f42c1', outline: 'none' }}>
                                        <option value="">SELECT...</option><option value="N/A">N/A (Raw/Unfinished)</option>
                                        {globalFinishes.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
                                    </select>
                                </div>
                                
                                <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>COLLECTION:</label><select name="collection" value={editSpecs.collection || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000' }}><option value="">SELECT...</option>{COLLECTIONS.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                                <div style={{ gridColumn: 'span 2', background: '#fff3cd', border: '1px solid #ffeeba', padding: '10px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ASSIGN TO WATCHLIST:</label><select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', fontWeight: 'bold' }}>{WATCHLISTS.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
                            </div>
                        </div>

                        {/* LOGISTICS & SOURCING */}
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
                                        <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <div style={{ flex: 2 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR NAME:</label><input name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>VENDOR ID:</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        </div>
                                        <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>MOQ:</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>LEAD (DAYS):</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* SAVE ACTION */}
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