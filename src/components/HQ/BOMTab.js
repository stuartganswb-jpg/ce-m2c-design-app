import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, doc, updateDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

const BOMTab = ({ currentUser, activeBrand }) => {
  const [assemblies, setAssemblies] = useState([]);
  const [selectedAssemblyId, setSelectedAssemblyId] = useState("");
  
  const [bomPins, setBomPins] = useState([]);
  const [libraryParts, setLibraryParts] = useState([]);
  
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], watchLists: [], vendors: [], outsourceActions: [], 
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], 
      partHandling: [], inventoryTypes: [], assemblyTypes: [], projections: [], customers: [] 
  }); 
  const [windowConfig, setWindowConfig] = useState({ system: {}, custom: [] }); 
  
  const [customSchema, setCustomSchema] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]);
  
  const [customersData, setCustomersData] = useState([]);

  const [activeComponent, setActiveComponent] = useState(null);
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, cpqCategories: [], collections: [], clientPricing: [], sharedBrands: [] });
  const [isSaving, setIsSaving] = useState(false);

  const [newClientPricing, setNewClientPricing] = useState({ customerId: '', clientSku: '', price: '' }); 

  const [assemblyDetails, setAssemblyDetails] = useState({
      itemName: "", legacyErpId: "", productType: "", routingType: "UNASSIGNED", project: "",
      basePrice: "", cost: "", pdfUrl: "", cadUrl: "",
      isProjectManaged: false, binLocation: "",
      partHandling: "", uom: "EA", pillowSize: "", fillType: "", flangeStyle: "", stitchType: "", seamCount: "", outsourceAction: "", watchList: "NONE",
      dynamicDicts: {}, customData: {}, collections: [], clientPricing: [], sharedBrands: []
  });

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
              uom: data.uom || [], prodTypes: data.prodTypes || [],
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [],
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || ['0 Seams', '1 Seam', '2 Seams', '3 Seams', '4 Seams'],
              partHandling: data.partHandling || ['Small Parts', 'Custom'],
              inventoryTypes: data.inventoryTypes || [], 
              assemblyTypes: data.assemblyTypes || [],
              projections: data.projections || [],
              customers: data.customers || [] 
          });
      }
    });
    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      if (docSnap.exists()) {
          setWindowConfig({ system: { partHandling: ['ce', 'm2c', 'uniquity', 'leyla'], ...(docSnap.data().system || {}) }, custom: docSnap.data().custom || [] });
      }
    });
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    const unsubCustomers = onSnapshot(collection(db, "crm_records"), snap => {
        const onlyCustomers = snap.docs
            .map(d => ({id: d.id, ...d.data()}))
            .filter(record => record.type === 'CUSTOMER');
        setCustomersData(onlyCustomers);
    });

    return () => { unsubSchema(); unsubLists(); unsubWindowConfig(); unsubAssets(); unsubCollections(); unsubCustomers(); };
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
          const legacyCollection = selectedAssemblyData.collection && selectedAssemblyData.collection !== 'N/A' ? [selectedAssemblyData.collection] : [];
          const currentCollections = selectedAssemblyData.manufacturingSpecs?.collections || legacyCollection;

          setAssemblyDetails({
              itemName: selectedAssemblyData.itemName || "",
              legacyErpId: selectedAssemblyData.legacyErpId === "PENDING" ? "" : (selectedAssemblyData.legacyErpId || ""),
              productType: selectedAssemblyData.productType || "",
              collections: currentCollections,
              routingType: selectedAssemblyData.routingType || "UNASSIGNED",
              project: selectedAssemblyData.project || "",
              basePrice: selectedAssemblyData.manufacturingSpecs?.basePrice || "",
              cost: selectedAssemblyData.manufacturingSpecs?.cost || "",
              pdfUrl: selectedAssemblyData.manufacturingSpecs?.pdfUrl || "",
              cadUrl: selectedAssemblyData.manufacturingSpecs?.cadUrl || "",
              isProjectManaged: selectedAssemblyData.manufacturingSpecs?.isProjectManaged || false,
              binLocation: selectedAssemblyData.manufacturingSpecs?.binLocation || "",
              partHandling: selectedAssemblyData.manufacturingSpecs?.partHandling || "",
              uom: selectedAssemblyData.manufacturingSpecs?.uom || "EA",
              pillowSize: selectedAssemblyData.manufacturingSpecs?.pillowSize || "",
              fillType: selectedAssemblyData.manufacturingSpecs?.fillType || "",
              flangeStyle: selectedAssemblyData.manufacturingSpecs?.flangeStyle || "",
              stitchType: selectedAssemblyData.manufacturingSpecs?.stitchType || "",
              seamCount: selectedAssemblyData.manufacturingSpecs?.seamCount || "",
              outsourceAction: selectedAssemblyData.manufacturingSpecs?.outsourceAction || "",
              watchList: selectedAssemblyData.manufacturingSpecs?.watchList || "NONE",
              dynamicDicts: selectedAssemblyData.manufacturingSpecs?.dynamicDicts || {},
              customData: selectedAssemblyData.manufacturingSpecs?.customData || {},
              clientPricing: selectedAssemblyData.clientPricing || [],
              sharedBrands: selectedAssemblyData.sharedBrands || [activeBrand]
          });
      }
  }, [selectedAssemblyData, activeBrand]);

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
      const dynamicDicts = baseSpecs.dynamicDicts || {};
      const cpqCategories = baseSpecs.cpqCategories || []; 
      const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
      const partHandling = baseSpecs.partHandling || ""; 

      const legacyCollection = baseSpecs.collection && baseSpecs.collection !== 'N/A' ? [baseSpecs.collection] : [];
      const currentCollections = baseSpecs.collections || legacyCollection;

      setEditSpecs({ 
          ...baseSpecs, 
          parametric: parametricData, 
          customData, 
          dynamicDicts,
          collections: currentCollections,
          cpqCategories, 
          isInHouse, 
          partHandling,
          project: bomItem.masterPart.project || "",
          routingType: bomItem.masterPart.routingType || "",
          clientPricing: bomItem.masterPart.clientPricing || [],
          sharedBrands: bomItem.masterPart.sharedBrands || [activeBrand],
          tempName: bomItem.masterPart.itemName, 
          tempLegacyId: bomItem.masterPart.legacyErpId === "PENDING" ? "" : bomItem.masterPart.legacyErpId
      });
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleAssemblySpecChange = (e) => setAssemblyDetails({ ...assemblyDetails, [e.target.name]: e.target.value });
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  
  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  const handleAssemblyCustomFieldChange = (key, value) => setAssemblyDetails(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));

  const handleDictChange = (dictId, value) => setEditSpecs(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));
  const handleAssemblyDictChange = (dictId, value) => setAssemblyDetails(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));

  const handleToggleCollection = (collectionName, isAssembly = false) => {
      if (isAssembly) {
          const current = assemblyDetails.collections || [];
          setAssemblyDetails({ ...assemblyDetails, collections: current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName] });
      } else {
          const current = editSpecs.collections || [];
          setEditSpecs({ ...editSpecs, collections: current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName] });
      }
  };

  const handleCpqCategoryToggle = (categoryId) => {
      const current = editSpecs.cpqCategories || [];
      const updated = current.includes(categoryId) ? current.filter(id => id !== categoryId) : [...current, categoryId];
      setEditSpecs({ ...editSpecs, cpqCategories: updated });
  };

  const getCustomerDisplay = (val) => {
      if (!val) return 'N/A';
      const dbCust = customersData.find(c => c.id === val || c.customerId === val || c.legacyId === val);
      if (dbCust) return `${dbCust.companyName || dbCust.name || 'Unknown'} - ${val}`;
      const listCust = globalLists.customers?.find(c => {
          if (typeof c === 'string') return c === val || c.includes(val);
          return c.id === val || c.name === val;
      });
      if (listCust) {
          if (typeof listCust === 'string') return listCust;
          return `${listCust.name} - ${listCust.id}`;
      }
      return val;
  };

  const handleAddClientPricing = (isAssembly = false) => {
      if (!newClientPricing.customerId) return alert("Select a customer from the dropdown.");
      if (isAssembly) {
          setAssemblyDetails(prev => ({ ...prev, clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }] }));
      } else {
          setEditSpecs(prev => ({ ...prev, clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }] }));
      }
      setNewClientPricing({ customerId: '', clientSku: '', price: '' });
  };

  const handleRemoveClientPricing = (idx, isAssembly = false) => {
      if (isAssembly) {
          setAssemblyDetails(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
      } else {
          setEditSpecs(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
      }
  };

  const handleBrandToggle = (brandId, isAssembly = false) => {
      if (isAssembly) {
          let currentShared = assemblyDetails.sharedBrands || [];
          if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId);
          setAssemblyDetails({ ...assemblyDetails, sharedBrands: currentShared });
      } else {
          let currentShared = editSpecs.sharedBrands || [];
          if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId);
          setEditSpecs({ ...editSpecs, sharedBrands: currentShared });
      }
  };

  const handleDynamicFileUpload = async (key, file, isAssembly = false) => {
      if (!file) return;
      const storageRef = ref(storage, `custom_uploads/${activeBrand}_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on("state_changed", null, 
          (err) => { console.error(err); alert("File upload failed."); },
          async () => { 
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              if (isAssembly) handleAssemblyCustomFieldChange(key, downloadURL);
              else handleCustomFieldChange(key, downloadURL);
          }
      );
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
          delete currentSpecs.collection; 
          
          await updateDoc(doc(db, "Approved_Designs", selectedAssemblyData.id), {
              itemName: assemblyDetails.itemName.toUpperCase(),
              legacyErpId: assemblyDetails.legacyErpId.toUpperCase() || "PENDING",
              productType: assemblyDetails.productType,
              routingType: assemblyDetails.routingType,
              project: assemblyDetails.project || "",
              clientPricing: assemblyDetails.clientPricing || [], 
              sharedBrands: assemblyDetails.sharedBrands || [activeBrand], 
              manufacturingSpecs: { 
                  ...currentSpecs, 
                  basePrice: assemblyDetails.basePrice, 
                  cost: assemblyDetails.cost,
                  pdfUrl: finalPdfUrl,
                  cadUrl: finalCadUrl,
                  isProjectManaged: assemblyDetails.isProjectManaged,
                  binLocation: assemblyDetails.binLocation,
                  partHandling: assemblyDetails.partHandling,
                  uom: assemblyDetails.uom,
                  collections: assemblyDetails.collections, 
                  pillowSize: assemblyDetails.pillowSize,
                  fillType: assemblyDetails.fillType,
                  flangeStyle: assemblyDetails.flangeStyle,
                  stitchType: assemblyDetails.stitchType,
                  seamCount: assemblyDetails.seamCount,
                  outsourceAction: assemblyDetails.outsourceAction,
                  watchList: assemblyDetails.watchList,
                  dynamicDicts: assemblyDetails.dynamicDicts,
                  customData: assemblyDetails.customData 
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
      delete compiledSpecs.collection;
      
      const finalName = editSpecs.tempName || activeComponent.masterPart.itemName;
      const finalLegacyId = (editSpecs.tempLegacyId || activeComponent.masterPart.legacyErpId).toUpperCase();

      try {
          await updateDoc(doc(db, "Approved_Designs", activeComponent.masterPart.id), {
              itemName: finalName, 
              legacyErpId: finalLegacyId, 
              routingType: editSpecs.routingType || "", 
              project: editSpecs.project || "",
              productType: editSpecs.productType || "",
              clientPricing: editSpecs.clientPricing || [], 
              sharedBrands: editSpecs.sharedBrands || [activeBrand], 
              manufacturingSpecs: compiledSpecs,
              updatedAt: new Date().toISOString()
          });
          
          setTimeout(() => { setIsSaving(false); setActiveComponent(null); setUploadProgress(0); setCadUploadProgress(0); }, 600);
      } catch (err) {
          console.error(err); setIsSaving(false); alert("Failed to save global updates.");
      }
  };

  const totalCost = populatedBOM.reduce((sum, item) => sum + ((item.masterPart?.manufacturingSpecs?.cost || item.masterPart?.manufacturingSpecs?.basePrice || 0) * (item.defaultQty || 1)), 0);

  const isAssembly = activeComponent?.masterPart?.partClass === 'Assembly' || activeComponent?.masterPart?.partClass === 'Master Assembly';

  // --- REUSABLE UI STYLES FOR THE COMPONENTS ---
  const fieldStyle = { width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Global Component Data Sync</span>
          <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Bill of Materials Engine</h2>
        </div>
        
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Select Assembly</label>
          <select value={selectedAssemblyId} onChange={(e) => { setSelectedAssemblyId(e.target.value); setActiveComponent(null); }} style={{ padding: '10px 16px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', minWidth: '350px', outline: 'none', background: '#fff' }}>
            {assemblies.length === 0 && <option value="">No Assemblies Found</option>}
            {assemblies.map(a => (
                <option key={a.id} value={a.itemId}>
                    [{a.routingType ? a.routingType.toUpperCase() : 'UNASSIGNED'}] {a.legacyErpId && a.legacyErpId !== "N/A" ? `${a.legacyErpId} : ` : ''}{a.itemName}
                </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch', flex: 1 }}>
        
        {/* LEFT COLUMN: BOM LIST */}
        <div style={{ width: '380px', background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0, borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            <div style={{ padding: '20px 24px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>Components</span>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)', border: '1px solid var(--line)', padding: '4px 8px', borderRadius: '2px', background: '#fff' }}>Cost: ${totalCost.toFixed(2)}</span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', background: 'var(--paper)' }}>
                {populatedBOM.length === 0 && <div style={{ textAlign: 'center', color: 'var(--ink-soft)', marginTop: '40px', fontStyle: 'italic', fontSize: '0.9rem' }}>No components found. Drop pins in Visual Assembly to build BOM.</div>}
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {populatedBOM.map(item => {
                        const isSelected = activeComponent?.id === item.id;
                        const isNew = item.masterPart?.manufacturingSpecs?.status === "NEEDS_SPECS";
                        const master = item.masterPart || {};
                        const specs = master.manufacturingSpecs || {};

                        return (
                            <div 
                                key={item.id} 
                                onClick={() => openComponentEditor(item)}
                                style={{ background: '#fff', border: `1px solid ${isSelected ? 'var(--brass)' : 'var(--line)'}`, display: 'flex', cursor: 'pointer', transition: 'all 0.2s ease', boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}
                            >
                                <div style={{ width: '80px', height: '80px', background: 'var(--paper-2)', borderRight: '1px solid var(--line)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                    {master.finalImageUrl ? (
                                        <img src={master.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    ) : (
                                        <span style={{ fontSize: '1.2rem', color: 'var(--ink-soft)', opacity: 0.5 }}>⚙️</span>
                                    )}
                                </div>

                                <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)' }}>{item.partName}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>QTY: {item.defaultQty}</div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                        <span style={{ color: 'var(--ink)' }}>{item.legacyErpId}</span> | {specs.productType || "NO TYPE"}
                                    </div>
                                    {isNew && <div style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: '#d9534f', textTransform: 'uppercase', marginTop: '6px' }}>Needs Specs</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>

        {/* RIGHT COLUMN: EDITOR */}
        <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
            
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                <div>
                    <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                        {activeComponent ? "Global Part Data" : "Assembly Metadata & Pricing"}
                    </h3>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px', display: 'block' }}>
                        {activeComponent ? "Changes made here update the Master Library globally." : "Review and set root metadata for this assembly."}
                    </span>
                </div>
                {activeComponent && <span style={{ background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em' }}>{activeComponent.masterPart?.legacyErpId}</span>}
            </div>

            <div style={{ padding: '30px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
                
                {/* --- STATE 1: ASSEMBLY METADATA EDITOR --- */}
                {!activeComponent ? (
                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                        {selectedAssemblyData ? (
                            <>
                                <div style={{ textAlign: 'center', marginBottom: '40px' }}>
                                    {selectedAssemblyData.finalImageUrl ? (
                                        <img src={selectedAssemblyData.finalImageUrl} alt="Assembly" style={{ maxWidth: '80%', maxHeight: '350px', objectFit: 'contain', border: '1px solid var(--line)', padding: '10px', background: 'var(--paper-2)' }} />
                                    ) : (
                                        <div style={{ height: '200px', background: 'var(--paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--line)', color: 'var(--ink-soft)', flexDirection: 'column' }}>
                                            <span style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>No Image Available</span>
                                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '10px', color: 'var(--ink-soft)' }}>Capture Thumbnail via Visual Engine</span>
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                    
                                    <div>
                                        <h4 style={sectionHeaderStyle}>Parent Assembly Details</h4>
                                        
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                            <div><label style={labelStyle}>Assembly Name</label><input name="itemName" value={assemblyDetails.itemName} onChange={handleAssemblySpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>ERP ID</label><input name="legacyErpId" value={assemblyDetails.legacyErpId} onChange={handleAssemblySpecChange} placeholder="PENDING" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                                        </div>

                                        <div style={{ marginBottom: '20px' }}>
                                            <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                                            <input name="binLocation" value={assemblyDetails.binLocation} onChange={handleAssemblySpecChange} placeholder="e.g. KIT-SHELF-B" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                                        </div>

                                        <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: '15px' }}>
                                            <input type="checkbox" checked={assemblyDetails.isProjectManaged} onChange={e => setAssemblyDetails({...assemblyDetails, isProjectManaged: e.target.checked})} style={{ transform: 'scale(1.2)', cursor: 'pointer' }} />
                                            <div>
                                                <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>Flag as Complex Project (Route to Project Mgmt)</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Client-Specific Pricing & SKUs</h4>
                                        <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', marginBottom: '20px' }}>
                                            <div style={{ flex: 2 }}>
                                                <label style={labelStyle}>Customer (Name - ID)</label>
                                                <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                                    <option value="">Select Customer...</option>
                                                    {customersData.length > 0 ? (
                                                        customersData.map(c => <option key={c.id} value={c.id}>{c.companyName || c.name} - {c.id}</option>)
                                                    ) : (
                                                        (globalLists.customers || []).map((c, idx) => {
                                                            const val = typeof c === 'string' ? c : c.id;
                                                            return <option key={val || idx} value={val}>{getCustomerDisplay(val)}</option>
                                                        })
                                                    )}
                                                </select>
                                            </div>
                                            <div style={{ flex: 2 }}>
                                                <label style={labelStyle}>Client SKU / Part #</label>
                                                <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>Custom Price ($)</label>
                                                <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                                            </div>
                                            <button onClick={() => handleAddClientPricing(true)} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                                        </div>
                                        
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {(assemblyDetails.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                                            {(assemblyDetails.clientPricing || []).map((cp, idx) => (
                                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                                    <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                                        <span style={{ fontWeight: 500, flex: 1 }}>{getCustomerDisplay(cp.customerId)}</span>
                                                        <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                                        <span style={{ fontWeight: 500, width: '80px', textAlign: 'right' }}>${parseFloat(cp.price || 0).toFixed(2)}</span>
                                                    </div>
                                                    <button onClick={() => handleRemoveClientPricing(idx, true)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Record Visibility & Sharing</h4>
                                        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '20px', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                                            {AVAILABLE_BRANDS.map(brand => {
                                                const isOwner = selectedAssemblyData.brandId === brand.id; 
                                                const isShared = assemblyDetails.sharedBrands?.includes(brand.id);
                                                return ( 
                                                    <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}>
                                                        <input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id, true)} />
                                                        {brand.name} {isOwner && "(Owner)"}
                                                    </label> 
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Classification & Attributes</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                            
                                            <div><label style={labelStyle}>Product Type</label><select name="productType" value={assemblyDetails.productType || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                                            <div><label style={labelStyle}>Routing Classification</label><select name="routingType" value={assemblyDetails.routingType || ""} onChange={handleAssemblySpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}><option value="">Unassigned</option>{(globalLists.assemblyTypes || []).map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                            <div><label style={labelStyle}>Project / Grouping</label><input name="project" value={assemblyDetails.project || ""} onChange={handleAssemblySpecChange} style={fieldStyle} /></div>

                                            {windowConfig.system.partHandling?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Part Handling</label><select name="partHandling" value={assemblyDetails.partHandling || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Unassigned / Standard</option>{(globalLists.partHandling || []).map(ph => <option key={ph} value={ph}>{ph}</option>)}</select></div>
                                            )}

                                            <div><label style={labelStyle}>UOM</label><select name="uom" value={assemblyDetails.uom || "EA"} onChange={handleAssemblySpecChange} style={fieldStyle}>{(globalLists.uom || []).map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                            
                                            {windowConfig.system.collections?.includes(activeBrand) && (
                                                <div style={{ gridColumn: 'span 2' }}>
                                                    <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                                                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                                                        {collectionsData.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined in Admin.</span>}
                                                        {collectionsData.map(c => {
                                                            const isSelected = (assemblyDetails.collections || []).includes(c.name);
                                                            return (
                                                                <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                                                    <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(c.name, true)} style={{ display: 'none' }} />
                                                                    {c.name}
                                                                </label>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {windowConfig.system.pillowSizes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Pillow Size</label><select name="pillowSize" value={assemblyDetails.pillowSize || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.pillowSizes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.fillTypes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Fill Type</label><select name="fillType" value={assemblyDetails.fillType || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.fillTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.flangeStyles?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Edge/Flange</label><select name="flangeStyle" value={assemblyDetails.flangeStyle || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.flangeStyles || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.stitchTypes?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Stitch Routing</label><select name="stitchType" value={assemblyDetails.stitchType || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.stitchTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.seamCounts?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Seam Count</label><select name="seamCount" value={assemblyDetails.seamCount || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.seamCounts || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            {windowConfig.system.outsourceActions?.includes(activeBrand) && (
                                                <div><label style={labelStyle}>Outsource Action</label><select name="outsourceAction" value={assemblyDetails.outsourceAction || ""} onChange={handleAssemblySpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.outsourceActions || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                            )}
                                            
                                            {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                                                <div key={w.id}>
                                                    <label style={labelStyle}>{w.name}</label>
                                                    <select value={assemblyDetails.dynamicDicts?.[w.id] || ""} onChange={(e) => handleAssemblyDictChange(w.id, e.target.value)} style={fieldStyle}>
                                                        <option value="">Select...</option><option value="N/A">N/A</option>
                                                        {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                                                    </select>
                                                </div>
                                            ))}

                                            {customSchema.map(field => (
                                                <div key={field.key}>
                                                    <label style={labelStyle}>{field.label} (Custom)</label>
                                                    {field.type === 'dropdown' ? (
                                                        <select value={assemblyDetails.customData?.[field.key] || ""} onChange={(e) => handleAssemblyCustomFieldChange(field.key, e.target.value)} style={fieldStyle}>
                                                            <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                                        </select>
                                                    ) : field.type === 'file' ? (
                                                        <div style={{ background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                                            {assemblyDetails.customData?.[field.key] && <a href={assemblyDetails.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '8px' }}>View Current File</a>}
                                                            <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0], true)} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                                        </div>
                                                    ) : (
                                                        <input type={field.type} value={assemblyDetails.customData?.[field.key] || ""} onChange={(e) => handleAssemblyCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                                                    )}
                                                </div>
                                            ))}

                                            <div style={{ gridColumn: 'span 2' }}>
                                                <label style={labelStyle}>Assign to Watchlist</label>
                                                <select name="watchList" value={assemblyDetails.watchList || "NONE"} onChange={handleAssemblySpecChange} style={fieldStyle}>
                                                    <option value="NONE">None</option>{(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Hardware CPQ Metadata (Vision Engine)</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                            <div>
                                                <label style={labelStyle}>Bracket Projection (Inches)</label>
                                                <select value={assemblyDetails.customData?.projection || ""} onChange={(e) => handleAssemblyCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- No Projection / Not Bracket --</option>
                                                    {(globalLists.projections || []).map(p => <option key={p} value={p}>{p}" Projection</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Bracket Mount Type</label>
                                                <select value={assemblyDetails.customData?.bracketType || ""} onChange={(e) => handleAssemblyCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- Not a Bracket --</option>
                                                    <option value="WALL">Wall Mount</option>
                                                    <option value="CEILING">Ceiling Mount</option>
                                                    <option value="INSIDE MOUNT">Inside Mount</option>
                                                </select>
                                            </div>
                                            <div style={{ gridColumn: 'span 2' }}>
                                                <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                                                <select value={assemblyDetails.customData?.feeType || ""} onChange={(e) => handleAssemblyCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                                                    <option value="">-- No Special Fee --</option>
                                                    <option value="SPLICE">Splice Fee</option>
                                                    <option value="MITER_CUT">Miter Cut Fee</option>
                                                    <option value="BENT_RETURN">Bent Return (FR) Fee</option>
                                                    <option value="MITER_RETURN">Miter Return Fee</option>
                                                </select>
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <h4 style={sectionHeaderStyle}>Pricing & Documents</h4>
                                        <div style={{ display: 'flex', gap: '20px', marginBottom: '30px' }}>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>Assembly Base Price ($)</label>
                                                <input name="basePrice" type="number" step="0.01" value={assemblyDetails.basePrice} onChange={handleAssemblySpecChange} placeholder="0.00" style={fieldStyle} />
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Standalone CPQ Base Price</span>
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <label style={labelStyle}>Assembly Unit Cost ($)</label>
                                                <input name="cost" type="number" step="0.01" value={assemblyDetails.cost} onChange={handleAssemblySpecChange} placeholder="0.00" style={fieldStyle} />
                                                <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', display: 'block', marginTop: '4px' }}>Internal Cost (Optional)</span>
                                            </div>
                                        </div>
                                        
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                                            <div>
                                                <label style={labelStyle}>Upload Master Print (PDF)</label>
                                                {assemblyDetails.pdfUrl && <a href={assemblyDetails.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                                                <input type="file" accept="application/pdf" onChange={(e) => setAssemblyPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                            <div>
                                                <label style={labelStyle}>Master 3D CAD (.glb)</label>
                                                {assemblyDetails.cadUrl ? (
                                                    <div style={{ marginBottom: '10px' }}>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '6px' }}>Synced from Inception</div>
                                                        <a href={assemblyDetails.cadUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block' }}>Download Current .GLB</a>
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>No 3D Model Found</div>
                                                )}
                                                <input type="file" accept=".glb" onChange={(e) => setAssemblyCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                        </div>
                                    </div>

                                    <button onClick={saveAssemblyDetails} style={{ padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                                        {isSaving ? "Saving..." : "Save Assembly Metadata & Files"}
                                    </button>
                                </div>
                                <div style={{ textAlign: 'center', marginTop: '30px', fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Select a component from the BOM list on the left to edit its global master data.</div>
                            </>
                        ) : (
                            <div style={{ color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic', textAlign: 'center', marginTop: '100px' }}>Awaiting Assembly Selection</div>
                        )}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                        {/* --- STATE 2: COMPONENT EDITOR --- */}

                        <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '24px' }}>
                            <h4 style={sectionHeaderStyle}>CPQ Configuration Mapping</h4>
                            <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: '20px', lineHeight: '1.5' }}>
                                If this component is highly configurable, do not assign a single fixed texture. Instead, map it to a CPQ Option Category below so the customer can configure it at checkout.
                            </p>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px', background: '#fff', padding: '20px', border: '1px solid var(--line)' }}>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--ink)' }}>
                                    <input type="checkbox" checked={editSpecs.cpqCategories?.includes('master_finishes')} onChange={() => handleCpqCategoryToggle('master_finishes')} />
                                    Master Finishes (Global Metals/Wood)
                                </label>
                                
                                {windowConfig.custom.filter(w => w.brands.includes(activeBrand)).map(w => (
                                    <label key={w.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', color: 'var(--ink)' }}>
                                        <input type="checkbox" checked={editSpecs.cpqCategories?.includes(w.id)} onChange={() => handleCpqCategoryToggle(w.id)} />
                                        {w.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Identification & Logistics</h4>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '20px' }}>
                                <div><label style={labelStyle}>Record Name / Description</label><input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activeComponent.masterPart.itemName} onChange={handleSpecChange} style={fieldStyle} /></div>
                                <div><label style={labelStyle}>ERP Legacy ID</label><input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activeComponent.masterPart.legacyErpId === "PENDING" ? "" : activeComponent.masterPart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                            </div>

                            <div style={{ marginBottom: '30px' }}>
                                <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                                <input name="binLocation" value={editSpecs.binLocation || ""} onChange={handleSpecChange} placeholder="e.g. A1-B2-04" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Used by the Pick/Pack App to guide operators to the physical item location.</div>
                            </div>

                            <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
                                <button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '12px', background: editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>In-House Manufacturing</button>
                                <button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '12px', background: !editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: !editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Outsourced / Vendor</button>
                            </div>

                            <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                {editSpecs.isInHouse ? (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '15px' }}>
                                        <div><label style={labelStyle}>Program #</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        <div><label style={labelStyle}>Raw Mat</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '15px' }}>
                                            <div><label style={labelStyle}>Vendor Name</label><select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select Vendor...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                            <div><label style={labelStyle}>Vendor Part # / SKU</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Purchase Link (URL)</label>{editSpecs.vendorUrl && <a href={editSpecs.vendorUrl.startsWith('http') ? editSpecs.vendorUrl : `https://${editSpecs.vendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>Open ↗</a>}</div>
                                                <input name="vendorUrl" value={editSpecs.vendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                                            </div>
                                            <div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Alt Item Link (URL)</label>{editSpecs.altVendorUrl && <a href={editSpecs.altVendorUrl.startsWith('http') ? editSpecs.altVendorUrl : `https://${editSpecs.altVendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>Open ↗</a>}</div>
                                                <input name="altVendorUrl" value={editSpecs.altVendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                                            </div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '15px' }}>
                                            <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>MOQ</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Lead (Days)</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Client-Specific Pricing & SKUs</h4>
                            
                            <div style={{ display: 'flex', gap: '15px', alignItems: 'flex-end', marginBottom: '20px' }}>
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>Customer (Name - ID)</label>
                                    <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                        <option value="">Select Customer...</option>
                                        {customersData.length > 0 ? (
                                            customersData.map(c => <option key={c.id} value={c.id}>{c.companyName || c.name} - {c.id}</option>)
                                        ) : (
                                            (globalLists.customers || []).map((c, idx) => {
                                                const val = typeof c === 'string' ? c : c.id;
                                                return <option key={val || idx} value={val}>{getCustomerDisplay(val)}</option>
                                            })
                                        )}
                                    </select>
                                </div>
                                <div style={{ flex: 2 }}>
                                    <label style={labelStyle}>Client SKU / Part #</label>
                                    <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={labelStyle}>Custom Price ($)</label>
                                    <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                                </div>
                                <button onClick={() => handleAddClientPricing(false)} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {(editSpecs.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                                {(editSpecs.clientPricing || []).map((cp, idx) => (
                                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--paper)', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                        <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                            <span style={{ fontWeight: 500, flex: 1 }}>{getCustomerDisplay(cp.customerId)}</span>
                                            <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                            <span style={{ fontWeight: 500, width: '80px', textAlign: 'right' }}>${parseFloat(cp.price || 0).toFixed(2)}</span>
                                        </div>
                                        <button onClick={() => handleRemoveClientPricing(idx, false)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Record Visibility & Sharing</h4>
                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '20px', background: 'var(--paper-2)', border: '1px solid var(--line)' }}>
                                {AVAILABLE_BRANDS.map(brand => {
                                    const isOwner = activeComponent.masterPart.brandId === brand.id; 
                                    const isShared = editSpecs.sharedBrands?.includes(brand.id);
                                    return ( 
                                        <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}>
                                            <input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id, false)} />
                                            {brand.name} {isOwner && "(Owner)"}
                                        </label> 
                                    );
                                })}
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Core Static Attributes</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                
                                <div><label style={labelStyle}>Prod Type</label><select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                                
                                <div>
                                    <label style={labelStyle}>{isAssembly ? 'Routing Classification' : 'Inventory Category'}</label>
                                    <select name="routingType" value={editSpecs.routingType || ""} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                                        <option value="">Unassigned</option>
                                        {(isAssembly ? (globalLists.assemblyTypes || []) : (globalLists.inventoryTypes || [])).map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                
                                <div><label style={labelStyle}>Project / Grouping</label><input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={fieldStyle} /></div>

                                {windowConfig.system.partHandling?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Part Handling</label><select name="partHandling" value={editSpecs.partHandling || ""} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}><option value="">Unassigned / Standard</option>{(globalLists.partHandling || []).map(ph => <option key={ph} value={ph}>{ph}</option>)}</select></div>
                                )}

                                <div><label style={labelStyle}>UOM</label><select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={fieldStyle}>{(globalLists.uom || []).map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                                
                                {windowConfig.system.collections?.includes(activeBrand) && (
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                                            {collectionsData.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined in Admin.</span>}
                                            {collectionsData.map(c => {
                                                const isSelected = (editSpecs.collections || []).includes(c.name);
                                                return (
                                                    <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                                        <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(c.name)} style={{ display: 'none' }} />
                                                        {c.name}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                                
                                {windowConfig.system.pillowSizes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Pillow Size</label><select name="pillowSize" value={editSpecs.pillowSize || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.pillowSizes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.fillTypes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Fill Type</label><select name="fillType" value={editSpecs.fillType || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.fillTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.flangeStyles?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Edge/Flange</label><select name="flangeStyle" value={editSpecs.flangeStyle || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.flangeStyles || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.stitchTypes?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Stitch Routing</label><select name="stitchType" value={editSpecs.stitchType || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.stitchTypes || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.seamCounts?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Seam Count</label><select name="seamCount" value={editSpecs.seamCount || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.seamCounts || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                {windowConfig.system.outsourceActions?.includes(activeBrand) && (
                                    <div><label style={labelStyle}>Outsource Action</label><select name="outsourceAction" value={editSpecs.outsourceAction || ""} onChange={handleSpecChange} style={fieldStyle}><option value="">Select...</option>{(globalLists.outsourceActions || []).map(x => <option key={x} value={x}>{x}</option>)}</select></div>
                                )}
                                
                                {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                                    <div key={w.id}>
                                        <label style={labelStyle}>{w.name}</label>
                                        <select value={editSpecs.dynamicDicts?.[w.id] || ""} onChange={(e) => handleDictChange(w.id, e.target.value)} style={fieldStyle}>
                                            <option value="">Select...</option><option value="N/A">N/A</option>
                                            {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                                        </select>
                                    </div>
                                ))}

                                {customSchema.map(field => (
                                    <div key={field.key}>
                                        <label style={labelStyle}>{field.label} (Custom)</label>
                                        {field.type === 'dropdown' ? (
                                            <select value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle}>
                                                <option value="">Select...</option>{(field.options || "").split(',').map(opt => <option key={opt.trim()} value={opt.trim()}>{opt.trim()}</option>)}
                                            </select>
                                        ) : field.type === 'file' ? (
                                            <div style={{ background: 'var(--paper)', padding: '12px', border: '1px solid var(--line)' }}>
                                                {editSpecs.customData?.[field.key] && <a href={editSpecs.customData[field.key]} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '8px' }}>View Current File</a>}
                                                <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0], false)} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                            </div>
                                        ) : (
                                            <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                                        )}
                                    </div>
                                ))}

                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={labelStyle}>Assign to Watchlist</label>
                                    <select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={fieldStyle}>
                                        <option value="NONE">None</option>{(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Hardware CPQ Metadata (Vision Engine)</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                                <div>
                                    <label style={labelStyle}>Bracket Projection (Inches)</label>
                                    <select value={editSpecs.customData?.projection || ""} onChange={(e) => handleCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                                        <option value="">-- No Projection / Not Bracket --</option>
                                        {(globalLists.projections || []).map(p => <option key={p} value={p}>{p}" Projection</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Bracket Mount Type</label>
                                    <select value={editSpecs.customData?.bracketType || ""} onChange={(e) => handleCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                                        <option value="">-- Not a Bracket --</option>
                                        <option value="WALL">Wall Mount</option>
                                        <option value="CEILING">Ceiling Mount</option>
                                        <option value="INSIDE MOUNT">Inside Mount</option>
                                    </select>
                                </div>
                                <div style={{ gridColumn: 'span 2' }}>
                                    <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                                    <select value={editSpecs.customData?.feeType || ""} onChange={(e) => handleCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                                        <option value="">-- No Special Fee --</option>
                                        <option value="SPLICE">Splice Fee</option>
                                        <option value="MITER_CUT">Miter Cut Fee</option>
                                        <option value="BENT_RETURN">Bent Return (FR) Fee</option>
                                        <option value="MITER_RETURN">Miter Return Fee</option>
                                    </select>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', fontStyle: 'italic', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Geometry & Z-Index Rules</h4>
                            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                                    <div><label style={labelStyle}>Length (in)</label><input name="length" type="number" step="0.1" value={editSpecs.parametric?.length || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Width (in)</label><input name="width" type="number" step="0.1" value={editSpecs.parametric?.width || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                    <div><label style={labelStyle}>Height (in)</label><input name="height" type="number" step="0.1" value={editSpecs.parametric?.height || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                </div>
                                <div style={{ marginBottom: '24px' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--ink)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <input type="checkbox" name="isCutToSize" checked={editSpecs.parametric?.isCutToSize || false} onChange={handleParametricChange} />
                                        Dynamic Custom Length Allowed (Stretchable Pole / Track)
                                    </label>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                                    <div style={{ gridColumn: 'span 2' }}><label style={labelStyle}>Z-Index / Render Layer</label><input name="layeringSequence" type="number" step="10" value={editSpecs.layeringSequence || ""} onChange={handleSpecChange} placeholder="e.g. 10 (Back), 30 (Front)" style={fieldStyle} /></div>
                                    <div style={{ gridColumn: 'span 2', background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}><label style={labelStyle}>Width Offset / Deduction (Inches)</label><input name="widthOffset" type="number" step="0.125" value={editSpecs.parametric?.widthOffset || ""} onChange={handleParametricChange} style={fieldStyle} /></div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <h4 style={sectionHeaderStyle}>Documents</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                                <div>
                                    <label style={labelStyle}>Upload Print (PDF)</label>
                                    {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                                    <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                    {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                </div>
                                <div>
                                    <label style={labelStyle}>3D CAD Model (.glb / .gltf)</label>
                                    {editSpecs.cadUrl && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>✓ 3D Model Assigned</div>}
                                    <input type="file" accept=".glb,.gltf" onChange={(e) => setCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                    {cadUploadProgress > 0 && <progress value={cadUploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                </div>
                            </div>
                        </div>

                        <div style={{ paddingTop: '20px' }}>
                            <button onClick={saveGlobalUpdates} style={{ width: '100%', padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease' }}>
                                {isSaving ? "Saving..." : "Save Global Part Data"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default BOMTab;