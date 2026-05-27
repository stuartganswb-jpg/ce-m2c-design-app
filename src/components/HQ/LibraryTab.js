import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

const DEFAULT_SYSTEM_WINDOWS = {
  inHouseFinishes: ['ce', 'm2c'], outsourceFinishes: ['ce', 'm2c'],
  prodTypes: ['ce', 'm2c', 'uniquity', 'leyla'], uom: ['ce', 'm2c', 'uniquity', 'leyla'],
  collections: ['ce', 'm2c', 'uniquity', 'leyla'], watchLists: ['ce', 'm2c', 'uniquity', 'leyla'],
  vendors: ['ce', 'm2c', 'uniquity', 'leyla'], outsourceActions: ['ce', 'm2c', 'uniquity', 'leyla'],
  pillowSizes: ['uniquity'], fillTypes: ['uniquity'], flangeStyles: ['uniquity'], stitchTypes: ['uniquity'],
  seamCounts: ['uniquity'], assemblyTypes: ['ce', 'm2c', 'uniquity', 'leyla'],
  customers: ['ce', 'm2c', 'uniquity', 'leyla'] 
};

const LIST_LABELS = {
    prodTypes: 'PRODUCT TYPES', uom: 'UOMs', collections: 'COLLECTIONS',
    watchLists: 'WATCHLISTS', vendors: 'APPROVED VENDORS', outsourceActions: 'OUTSOURCE ACTIONS',
    pillowSizes: 'PILLOW SIZES', fillTypes: 'FILL TYPES', flangeStyles: 'EDGE / FLANGE STYLES', 
    stitchTypes: 'STITCH ROUTING', seamCounts: 'SEAM COUNTS / UPCHARGES', assemblyTypes: 'ASSEMBLY TYPES',
    customers: 'CUSTOMERS / DEALERS' 
};

const LibraryTab = ({ currentUser, activeBrand }) => {
  const [isAdmin, setIsAdmin] = useState(true);
  const [adminBrandFilter, setAdminBrandFilter] = useState(activeBrand);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [partClassFilter, setPartClassFilter] = useState("ALL"); 
  
  const [customSchema, setCustomSchema] = useState([]);
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], collections: [], watchLists: [], vendors: [], outsourceActions: [],
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], assemblyTypes: [],
      cpqRoutingTypes: [], customers: [] 
  });
  
  const [windowConfig, setWindowConfig] = useState({ system: DEFAULT_SYSTEM_WINDOWS, custom: [] });
  const [newListItems, setNewListItems] = useState({});
  const [activeRecipes, setActiveRecipes] = useState([]); 
  const [floorRecipeData, setFloorRecipeData] = useState([]); 

  const [showSchemaForm, setShowSchemaForm] = useState(false);
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [showOutsourceFinishForm, setShowOutsourceFinishForm] = useState(false);
  const [showWindowManager, setShowWindowManager] = useState(false);

  const [newFieldConfig, setNewFieldConfig] = useState({ key: '', label: '', type: 'text', options: '' });
  const [newFinishConfig, setNewFinishConfig] = useState({ name: '', code: '', type: '', textureUrl: '' });
  const [newOutsourceFinishConfig, setNewOutsourceFinishConfig] = useState({ name: '', description: '', multiplier: 1.0, vendor: '', textureUrl: '' });
  
  const [newCustomWindow, setNewCustomWindow] = useState({ name: '', brands: [activeBrand], hasImage: true, hasCode: true, hasVendor: false, hasMultiplier: true });
  
  const [finishUploadProgress, setFinishUploadProgress] = useState(0);
  const [inlineTextureProgress, setInlineTextureProgress] = useState({});

  const [activeDictForms, setActiveDictForms] = useState({});
  const [newAssetForms, setNewAssetForms] = useState({});
  const [assetUploadProgress, setAssetUploadProgress] = useState({});

  const [activePart, setActivePart] = useState(null);
  const [activeBomPins, setActiveBomPins] = useState([]); 
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, clientPricing: [] }); 
  const [isSaving, setIsSaving] = useState(false);
  
  const [newClientPricing, setNewClientPricing] = useState({ customerId: '', clientSku: '', price: '' }); 

  const [pdfFile, setPdfFile] = useState(null);
  const [cadFile, setCadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cadUploadProgress, setCadUploadProgress] = useState(0); 
  
  const [dynamicUploadProgress, setDynamicUploadProgress] = useState({});
  const [cloneSourceId, setCloneSourceId] = useState("");

  useEffect(() => { setAdminBrandFilter(activeBrand); }, [activeBrand]);

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => { if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes); });
    const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          setGlobalLists({ 
              uom: data.uom || [], prodTypes: data.prodTypes || [], collections: data.collections || [], 
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [], 
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || ['0 Seams', '1 Seam', '2 Seams', '3 Seams', '4 Seams'],
              assemblyTypes: data.assemblyTypes || [],
              cpqRoutingTypes: data.cpqRoutingTypes || [],
              customers: data.customers || [] 
          });
      }
    });

    const unsubRecipes = onSnapshot(collection(db, "fin_recipes"), (snap) => { setActiveRecipes(snap.docs.map(d => d.id)); setFloorRecipeData(snap.docs.map(d => ({ id: d.id, ...d.data() }))); });
    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      if (docSnap.exists()) setWindowConfig({ system: { ...DEFAULT_SYSTEM_WINDOWS, ...(docSnap.data().system || {}) }, custom: docSnap.data().custom || [] });
    });

    return () => { unsubSchema(); unsubFinishes(); unsubOutsource(); unsubAssets(); unsubLists(); unsubRecipes(); unsubWindowConfig(); };
  }, []);

  useEffect(() => {
    if (!activeBrand) return;
    const q = query(collection(db, "Approved_Designs"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
      docs.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));
      setInventory(docs);
    });
    return () => unsubscribe();
  }, [activeBrand]);

  useEffect(() => {
      if (!activePart || activePart.partClass !== 'Master Assembly') {
          setActiveBomPins([]);
          return;
      }
      const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activePart.itemId));
      const unsubscribe = onSnapshot(q, (snapshot) => {
          setActiveBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsubscribe();
  }, [activePart]);

  const filteredInventory = inventory.filter(part => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = part.itemName?.toLowerCase().includes(term) || 
                          (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) || 
                          (part.itemId && part.itemId.toLowerCase().includes(term)) ||
                          (part.manufacturingSpecs?.binLocation && part.manufacturingSpecs.binLocation.toLowerCase().includes(term)) || // 🚀 Search by Bin
                          (part.clientPricing && part.clientPricing.some(cp => 
                              (cp.clientSku && cp.clientSku.toLowerCase().includes(term)) || 
                              (cp.customerId && cp.customerId.toLowerCase().includes(term))
                          ));
    
    const matchesType = typeFilter === "" || part.manufacturingSpecs?.productType === typeFilter;
    const matchesClass = partClassFilter === "ALL" || part.partClass === partClassFilter;
    
    return matchesSearch && matchesType && matchesClass;
  });

  const openPartDetails = (part) => {
    setActivePart(part); setPdfFile(null); setCadFile(null); setDynamicUploadProgress({}); setCloneSourceId("");
    
    const baseSpecs = part.manufacturingSpecs || {};
    const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" };
    const customData = baseSpecs.customData || {}; 
    const dynamicDicts = baseSpecs.dynamicDicts || {};
    const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
    let shared = part.sharedBrands || []; if (!shared.includes(part.brandId)) shared = [...shared, part.brandId];
    
    setEditSpecs({ 
        ...baseSpecs, 
        parametric: parametricData, 
        customData, 
        dynamicDicts, 
        isInHouse, 
        sharedBrands: shared, 
        tempName: part.itemName, 
        tempLegacyId: part.legacyErpId === "PENDING" ? "" : part.legacyErpId,
        clientPricing: part.clientPricing || [], 
        binLocation: baseSpecs.binLocation || "", // 🚀 NATIVE BIN LOCATION
        project: part.project || "",
        collection: part.collection || "",
        routingType: part.routingType || "",
        isProjectManaged: baseSpecs.isProjectManaged || false
    });
  };

  const handleCloneSpecs = () => {
    if(!cloneSourceId) return;
    if(!window.confirm("Overwrite current specs with cloned data? This pulls all attributes and CPQ rules.")) return;
    const source = inventory.find(p => p.id === cloneSourceId);
    if(!source || !source.manufacturingSpecs) return;
    const clonedSpecs = JSON.parse(JSON.stringify(source.manufacturingSpecs));
    setEditSpecs(prev => ({ 
        ...prev, 
        ...clonedSpecs, 
        tempName: prev.tempName, 
        tempLegacyId: prev.tempLegacyId, 
        clientPricing: prev.clientPricing, 
        binLocation: prev.binLocation, // Keep bin location isolated
        pdfUrl: prev.pdfUrl, 
        cadUrl: prev.cadUrl 
    }));
    setCloneSourceId("");
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleDictChange = (dictId, value) => setEditSpecs(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  const handleBrandToggle = (brandId) => { let currentShared = editSpecs.sharedBrands || []; if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId); setEditSpecs({ ...editSpecs, sharedBrands: currentShared }); };

  const handleAddClientPricing = () => {
      if (!newClientPricing.customerId) return alert("Select a customer from the dropdown.");
      setEditSpecs(prev => ({
          ...prev,
          clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }]
      }));
      setNewClientPricing({ customerId: '', clientSku: '', price: '' });
  };

  const handleRemoveClientPricing = (idx) => {
      setEditSpecs(prev => ({
          ...prev,
          clientPricing: prev.clientPricing.filter((_, i) => i !== idx)
      }));
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
              handleCustomFieldChange(key, downloadURL); setDynamicUploadProgress(prev => ({ ...prev, [key]: 0 }));
          }
      );
  };

  const handleCreateNewPart = () => {
    const actualClass = partClassFilter === 'ALL' ? 'Inventory' : partClassFilter;
    const newId = `${activeBrand.toUpperCase()}-${actualClass === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
    
    setActivePart({ isNew: true, id: newId, itemId: newId, legacyErpId: "PENDING", itemName: `NEW ${actualClass.toUpperCase()}`, brandId: activeBrand, partClass: actualClass });
    setEditSpecs({ productType: "", uom: "EA", finishDetail: "", collection: "N/A", project: "", routingType: "", assemblyType: "", watchList: "NONE", tempName: `NEW ${actualClass.toUpperCase()}`, tempLegacyId: "", clientPricing: [], binLocation: "", isInHouse: true, programNum: "", material: "", layeringSequence: "10", vendorName: "", vendorId: "", vendorUrl: "", altVendorUrl: "", cost: "", leadTime: "", moq: "", sharedBrands: [activeBrand], customData: {}, dynamicDicts: {}, parametric: { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" }, isProjectManaged: false }); 
    setPdfFile(null); setCadFile(null); setCloneSourceId("");
  };

  const handleDeletePart = async () => {
    if (!activePart || activePart.isNew) return setActivePart(null);
    if (window.confirm(`Permanently delete ${activePart.legacyErpId || activePart.itemId}? This cannot be undone.`)) {
      try { await deleteDoc(doc(db, "Approved_Designs", activePart.id)); setActivePart(null); } catch (err) { console.error(err); }
    }
  };

  const savePartUpdates = async () => {
    if (!activePart) return;
    setIsSaving(true);
    
    let finalPdfUrl = editSpecs.pdfUrl || "";
    if (pdfFile) {
      const storageRef = ref(storage, `prints/${activeBrand}_${editSpecs.tempLegacyId || activePart.legacyErpId}_${pdfFile.name}`);
      const uploadTask = uploadBytesResumable(storageRef, pdfFile);
      await new Promise((resolve, reject) => { uploadTask.on("state_changed", (snap) => setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalPdfUrl = await getDownloadURL(uploadTask.snapshot.ref); resolve(); }); });
    }

    let finalCadUrl = editSpecs.cadUrl || "";
    if (cadFile) {
      const cadStorageRef = ref(storage, `cad_models/${activeBrand}_${editSpecs.tempLegacyId || activePart.legacyErpId}_${cadFile.name}`);
      const cadUploadTask = uploadBytesResumable(cadStorageRef, cadFile);
      await new Promise((resolve, reject) => { cadUploadTask.on("state_changed", (snap) => setCadUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => reject(err), async () => { finalCadUrl = await getDownloadURL(cadUploadTask.snapshot.ref); resolve(); }); });
    }

    const compiledSpecs = { ...editSpecs, pdfUrl: finalPdfUrl, cadUrl: finalCadUrl };
    const finalName = editSpecs.tempName || activePart.itemName;
    const finalLegacyId = (editSpecs.tempLegacyId || activePart.legacyErpId).toUpperCase();

    try {
      const payload = { 
          itemName: finalName, 
          legacyErpId: finalLegacyId, 
          clientPricing: editSpecs.clientPricing || [], 
          sharedBrands: editSpecs.sharedBrands || [activePart.brandId || activeBrand], 
          manufacturingSpecs: compiledSpecs, 
          updatedAt: new Date().toISOString() 
      };
      
      if (activePart.partClass !== 'Inventory') {
          payload.project = editSpecs.project || "";
          payload.collection = editSpecs.collection || "";
          payload.routingType = editSpecs.routingType || "";
          payload.productType = editSpecs.productType || "";
      }

      if (activePart.isNew) payload.createdAt = new Date().toISOString();
      await setDoc(doc(db, "Approved_Designs", activePart.id), { ...activePart, ...payload }, { merge: true });
      setTimeout(() => { setIsSaving(false); setActivePart(null); setUploadProgress(0); setCadUploadProgress(0); }, 500);
    } catch (err) { console.error(err); setIsSaving(false); alert("Failed to save."); }
  };

  const toggleSystemWindowBrand = async (windowKey, brandId) => {
      const current = windowConfig.system[windowKey] || [];
      const updated = current.includes(brandId) ? current.filter(b => b !== brandId) : [...current, brandId];
      await setDoc(doc(db, "system", "window_config"), { system: { ...windowConfig.system, [windowKey]: updated }, custom: windowConfig.custom }, { merge: true });
  };
  
  const handleCreateCustomWindow = async () => {
      if (!newCustomWindow.name.trim()) return alert("Dictionary Name is required.");
      const newId = `dict_${Date.now()}`;
      const newWin = { id: newId, ...newCustomWindow, name: newCustomWindow.name.toUpperCase() };
      await setDoc(doc(db, "system", "window_config"), { system: windowConfig.system, custom: [...windowConfig.custom, newWin] }, { merge: true });
      setNewCustomWindow({ name: '', brands: [activeBrand], hasImage: true, hasCode: true, hasVendor: false, hasMultiplier: true });
      alert("✅ Custom CPQ Dictionary Created Successfully!");
  };

  const toggleCustomWindowBrand = async (windowId, brandId) => {
      const updatedWindows = windowConfig.custom.map(w => {
          if (w.id !== windowId) return w;
          const currentBrands = w.brands || [];
          return { ...w, brands: currentBrands.includes(brandId) ? currentBrands.filter(b => b !== brandId) : [...currentBrands, brandId] };
      });
      await setDoc(doc(db, "system", "window_config"), { system: windowConfig.system, custom: updatedWindows }, { merge: true });
  };

  const handleDeleteCustomWindow = async (windowId) => {
      if (!window.confirm("Delete this custom dictionary? Data items will be orphaned.")) return;
      await setDoc(doc(db, "system", "window_config"), { system: windowConfig.system, custom: windowConfig.custom.filter(w => w.id !== windowId) }, { merge: true });
  };

  const handleAddSchemaField = async () => {
      if (!newFieldConfig.label) return alert("Label is required.");
      const key = newFieldConfig.key || newFieldConfig.label.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (m, chr) => chr.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
      const updatedSchema = [...customSchema, { ...newFieldConfig, key }];
      await setDoc(doc(db, "system", "master_schema"), { inventoryFields: updatedSchema }, { merge: true });
      setNewFieldConfig({ key: '', label: '', type: 'text', options: '' }); setShowSchemaForm(false);
  };

  const handleRemoveSchemaField = async (keyToRemove) => {
      if (!window.confirm("Remove this attribute?")) return;
      await setDoc(doc(db, "system", "master_schema"), { inventoryFields: customSchema.filter(f => f.key !== keyToRemove) }, { merge: true });
  };

  const handleSyncFloorRecipes = async () => {
      if (!window.confirm("Scan the Finishing Floor database and import missing recipes to HQ?")) return;
      let currentFinishes = [...globalFinishes]; let addedCount = 0;
      floorRecipeData.forEach(recipe => {
          if (!currentFinishes.find(f => f.name.toUpperCase() === recipe.id.toUpperCase() || (f.code && f.code.toUpperCase() === recipe.id.toUpperCase()))) {
              currentFinishes.push({ id: `FIN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, name: recipe.id.toUpperCase(), code: recipe.id.substring(0, 5).toUpperCase(), type: 'MIXED', textureUrl: '', status: 'Production Ready' });
              addedCount++;
          }
      });
      if (addedCount > 0) { await setDoc(doc(db, "system", "master_finishes"), { finishes: currentFinishes }, { merge: true }); alert(`Successfully synced ${addedCount} recipes!`); } else alert("HQ is in sync with floor database!");
  };

  const handleAddGlobalFinish = async () => {
      if (!newFinishConfig.name) return alert("Finish name required.");
      const newFinish = { id: `FIN-${Date.now()}`, name: newFinishConfig.name.toUpperCase(), code: newFinishConfig.code.toUpperCase(), type: newFinishConfig.type.toUpperCase(), textureUrl: newFinishConfig.textureUrl, status: 'Working' };
      await setDoc(doc(db, "system", "master_finishes"), { finishes: [...globalFinishes, newFinish] }, { merge: true });
      setNewFinishConfig({ name: '', code: '', type: '', textureUrl: '' }); setShowFinishForm(false);
  };
  
  const handleFinishTextureUpload = async (file) => {
      if (!file) return;
      const storageRef = ref(storage, `system_textures/TEX_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      uploadTask.on("state_changed", (snap) => setFinishUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => console.error(err),
          async () => { const url = await getDownloadURL(uploadTask.snapshot.ref); setNewFinishConfig({ ...newFinishConfig, textureUrl: url }); setFinishUploadProgress(0); }
      );
  };

  const handleUpdateExistingFinishTexture = async (finishId, file, isOutsource = false) => {
      if (!file) return;
      const storageRef = ref(storage, `system_textures/TEX_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      
      uploadTask.on("state_changed", 
          (snap) => setInlineTextureProgress(prev => ({ ...prev, [finishId]: Math.round((snap.bytesTransferred / snap.totalBytes) * 100) })), 
          (err) => console.error(err),
          async () => { 
              const url = await getDownloadURL(uploadTask.snapshot.ref); 
              if (isOutsource) {
                  await updateDoc(doc(db, "hq_outsource_finishes", finishId), { textureUrl: url });
              } else {
                  const updated = globalFinishes.map(f => f.id === finishId ? { ...f, textureUrl: url } : f);
                  await setDoc(doc(db, "system", "master_finishes"), { finishes: updated }, { merge: true });
              }
              setInlineTextureProgress(prev => ({ ...prev, [finishId]: 0 })); 
          }
      );
  };

  const handleRemoveFinish = async (idToRemove) => {
      if (!window.confirm("Delete this Master Finish?")) return;
      await setDoc(doc(db, "system", "master_finishes"), { finishes: globalFinishes.filter(f => f.id !== idToRemove) }, { merge: true });
  };

  const handleAddOutsourceFinish = async () => {
      if (!newOutsourceFinishConfig.name) return alert("Finish name required.");
      const safeId = `FIN-${newOutsourceFinishConfig.name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      await setDoc(doc(db, "hq_outsource_finishes", safeId), { 
          id: safeId, 
          legacyErpId: "PENDING", 
          name: newOutsourceFinishConfig.name.toUpperCase(), 
          description: newOutsourceFinishConfig.description || "", 
          multiplier: parseFloat(newOutsourceFinishConfig.multiplier) || 1.0, 
          vendor: newOutsourceFinishConfig.vendor || "",
          textureUrl: newOutsourceFinishConfig.textureUrl || ""
      });
      setNewOutsourceFinishConfig({ name: '', description: '', multiplier: 1.0, vendor: '', textureUrl: '' }); 
      setShowOutsourceFinishForm(false);
  };
  
  const handleRemoveOutsourceFinish = async (id) => { if (!window.confirm("Delete this Outsourced Finish?")) return; await deleteDoc(doc(db, "hq_outsource_finishes", id)); };

  const handleAddNewListCategory = async () => {
      const name = window.prompt("Enter the name for the new List Category (e.g., 'Packaging Types'):");
      if (!name) return;
      const key = name.replace(/[^a-zA-Z0-9]/g, '');
      if (globalLists[key]) return alert("List category already exists.");
      try { await setDoc(doc(db, "system", "master_lists"), { ...globalLists, [key]: [] }); } 
      catch(err) { console.error(err); }
  };
  
  const handleAddListItem = async (listKey) => {
      const val = (newListItems[listKey] || '').toUpperCase().trim(); if (!val) return;
      const updated = { ...globalLists, [listKey]: [...(globalLists[listKey] || []), val] };
      await setDoc(doc(db, "system", "master_lists"), updated);
      setNewListItems({ ...newListItems, [listKey]: '' });
  };
  
  const handleRemoveListItem = async (listKey, itemVal) => {
      if (!window.confirm(`Remove ${itemVal}?`)) return;
      await setDoc(doc(db, "system", "master_lists"), { ...globalLists, [listKey]: globalLists[listKey].filter(v => v !== itemVal) });
  };

  const handleDeleteListCategory = async (listKey) => {
      const label = LIST_LABELS[listKey] || listKey;
      if (!window.confirm(`Are you sure you want to permanently delete the entire "${label}" category?`)) return;
      const updatedLists = { ...globalLists };
      delete updatedLists[listKey];
      await setDoc(doc(db, "system", "master_lists"), updatedLists);
  };

  const handleAddDynamicAsset = async (windowConfig) => {
      const form = newAssetForms[windowConfig.id] || {};
      if (!form.name) return alert("Name is required.");
      const safeId = `ASSET-${Date.now()}`;
      await setDoc(doc(db, "hq_dynamic_data", safeId), { id: safeId, windowId: windowConfig.id, name: form.name.toUpperCase(), code: (form.code || '').toUpperCase(), vendor: form.vendor || '', multiplier: parseFloat(form.multiplier) || 1.0, textureUrl: form.textureUrl || '', legacyErpId: 'PENDING' });
      setNewAssetForms({ ...newAssetForms, [windowConfig.id]: {} }); setActiveDictForms({ ...activeDictForms, [windowConfig.id]: false });
  };
  
  const handleRemoveDynamicAsset = async (assetId) => {
      if(!window.confirm("Delete this asset?")) return;
      await deleteDoc(doc(db, "hq_dynamic_data", assetId));
  };
  
  const handleDynamicAssetTextureUpload = async (windowId, file) => {
      if (!file) return;
      const storageRef = ref(storage, `system_textures/TEX_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      uploadTask.on("state_changed", (snap) => setAssetUploadProgress({ ...assetUploadProgress, [windowId]: Math.round((snap.bytesTransferred / snap.totalBytes) * 100) }), (err) => console.error(err),
          async () => { const url = await getDownloadURL(uploadTask.snapshot.ref); setNewAssetForms(prev => ({ ...prev, [windowId]: { ...(prev[windowId]||{}), textureUrl: url } })); setAssetUploadProgress({ ...assetUploadProgress, [windowId]: 0 }); }
      );
  };

  const handleToggleCpqRouting = async (item, isChecked) => {
      const current = globalLists.cpqRoutingTypes || [];
      const updated = isChecked ? [...current, item] : current.filter(i => i !== item);
      await setDoc(doc(db, "system", "master_lists"), { ...globalLists, cpqRoutingTypes: updated });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
      
      {/* HEADER WITH TIERED INVENTORY TOGGLE */}
      <div style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
        <div>
            <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#007bff' }}>4. Master Library & Data Rules</h2>
            <span style={{ fontSize: '0.7rem', color: '#666' }}>{inventory.length} APPROVED RECORDS</span>
        </div>
        <div style={{ display: 'flex', gap: '15px', width: '75%', alignItems: 'center' }}>
          
          <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} style={{ padding: '10px', border: '2px solid #007bff', fontWeight: 'bold', background: '#eafaf1', color: '#007bff', minWidth: '150px' }}>
              <option value="ALL">ALL CLASSES</option>
              <option value="Inventory">STANDALONE INVENTORY ITEMS</option>
              <option value="Assembly">SUB-ASSEMBLIES (BOM)</option>
              <option value="Master Assembly">TOP-LEVEL MASTER ASSEMBLIES</option>
          </select>
          
          <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px', background: '#ffeeba', padding: '5px 10px', border: '1px solid #856404' }}>
              <input type="checkbox" checked={isAdmin} onChange={() => setIsAdmin(!isAdmin)} /> SIMULATE ADMIN
          </label>
          
          <button onClick={handleCreateNewPart} style={{ padding: '10px 15px', background: '#000', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', whiteSpace: 'nowrap' }}>+ NEW RECORD</button>
          
          {windowConfig.system.prodTypes?.includes(activeBrand) && (
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '10px', border: '2px solid #000', fontWeight: 'bold', flex: 1 }}>
                  <option value="">ALL CATEGORIES</option>
                  {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
          )}

          <input placeholder="🔍 Search by Name, ERP ID, or Cust ID..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ flex: 2, padding: '10px', border: '2px solid #000', fontWeight: 'bold', fontSize: '1rem' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        
        {/* LEFT LIST */}
        <div style={{ flex: activePart ? 1.5 : 1, display: 'grid', gridTemplateColumns: activePart ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px', alignContent: 'start' }}>
          {filteredInventory.length === 0 && <div style={{ color: '#666', fontStyle: 'italic', padding: '20px' }}>No {partClassFilter === 'ALL' ? 'records' : partClassFilter} found in this category.</div>}
          {filteredInventory.map(part => {
            const specs = part.manufacturingSpecs || {};
            const isWatchlist = specs.watchList && specs.watchList !== "NONE";
            const displayId = part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId;
            const isSharedIn = part.brandId !== activeBrand; 

            let classColor = '#007bff'; 
            if (part.partClass === 'Assembly') classColor = '#28a745'; 
            if (part.partClass === 'Master Assembly') classColor = '#e83e8c'; 

            return (
              <div key={part.id} onClick={() => openPartDetails(part)} style={{ background: activePart?.id === part.id ? '#fff9c4' : '#fff', border: '2px solid #000', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', transition: '0.2s', boxShadow: activePart?.id === part.id ? `5px 5px 0 ${classColor}` : '5px 5px 0 rgba(0,0,0,0.1)' }}>
                {isWatchlist && <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#d9534f', color: '#fff', padding: '5px 8px', fontSize: '0.6rem', fontWeight: 'bold', border: '2px solid #000', zIndex: 2 }}>★ WATCH</div>}
                {isSharedIn && <div style={{ position: 'absolute', top: '5px', left: '5px', background: '#ffc107', color: '#000', padding: '2px 5px', fontSize: '0.55rem', fontWeight: 'bold', border: '1px solid #000', zIndex: 2 }}>SHARED FROM {part.brandId.toUpperCase()}</div>}

                <div style={{ height: '150px', background: '#f4f4f4', borderBottom: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {part.finalImageUrl ? <img src={part.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: '#aaa', fontSize: '2rem' }}>{part.manufacturingSpecs?.cadUrl ? '🧊 3D CAD' : '⚙️'}</span>}
                </div>

                <div style={{ padding: '15px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: classColor, marginBottom: '5px' }}>{displayId} <span style={{fontSize:'0.65rem', color:'#666'}}>({part.partClass})</span></div>
                  
                  {part.clientPricing && part.clientPricing.length > 0 && (
                      <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#28a745', marginBottom: '2px' }}>
                          {part.clientPricing.length} CLIENT MAPPING(S)
                      </div>
                  )}
                  {part.manufacturingSpecs?.binLocation && (
                      <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#6f42c1', marginBottom: '2px' }}>
                          BIN: {part.manufacturingSpecs.binLocation}
                      </div>
                  )}

                  <div style={{ fontSize: '0.85rem', fontWeight: 'bold', lineHeight: '1.2', flex: 1 }}>{part.itemName}</div>
                  
                  {/* Show specific details based on class */}
                  {part.partClass === "Inventory" ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '10px' }}>
                      <span style={{ fontSize: '0.65rem', background: '#eee', padding: '3px 6px', borderRadius: '3px', border: '1px solid #ccc' }}>{specs.productType || "NO TYPE"}</span>
                      <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#CC6600' }}>{specs.parametric?.length || 0}L × {specs.parametric?.width || 0}W</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #eee', paddingTop: '10px', marginTop: '10px' }}>
                      <span style={{ fontSize: '0.65rem', background: '#eafaf1', color: '#1e7e34', padding: '3px 6px', borderRadius: '3px', border: '1px solid #28a745', fontWeight: 'bold' }}>{part.project || 'NO PROJECT'}</span>
                      <span style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#6f42c1' }}>{part.routingType || 'UNASSIGNED'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT EDIT PANEL */}
        {activePart && (
          <div style={{ flex: 1.5, background: '#fff', border: '3px solid #000', boxShadow: '10px 10px 0 #000', position: 'sticky', top: '20px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10 }}>
              <div><h3 style={{ margin: 0, fontSize: '1.2rem' }}>{activePart.isNew ? `NEW ${partClassFilter.toUpperCase()} SETUP` : (activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId)}</h3><span style={{ fontSize: '0.7rem', color: '#aaa' }}>{activePart.isNew ? "Define Master Details Below" : activePart.itemName}</span></div>
              <button onClick={() => setActivePart(null)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {activePart.partClass !== 'Inventory' && (
                  <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '15px' }}>
                      <h4 style={{ margin: '0 0 10px 0', color: '#1e7e34', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          📦 ASSEMBLY CONFIGURATION
                      </h4>
                      
                      <div style={{ background: '#fff3cd', border: '2px dashed #ffc107', padding: '10px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                          <input 
                              type="checkbox" 
                              checked={editSpecs.isProjectManaged || false} 
                              onChange={e => setEditSpecs({...editSpecs, isProjectManaged: e.target.checked})} 
                              style={{ transform: 'scale(1.5)', cursor: 'pointer', marginLeft: '5px' }} 
                          />
                          <div>
                              <div style={{ fontWeight: 'bold', color: '#856404', fontSize: '0.85rem' }}>FLAG AS COMPLEX PROJECT (ROUTE TO TAB 10.5)</div>
                              <div style={{ fontSize: '0.7rem', color: '#666' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                          </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '15px' }}>
                          <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#1e7e34' }}>ROUTING TYPE:</label><select name="routingType" value={editSpecs.routingType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #28a745', fontWeight: 'bold' }}><option value="">UNASSIGNED</option>{(globalLists.assemblyTypes || []).map(at => <option key={at} value={at}>{at}</option>)}</select></div>
                          <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROJECT / GROUPING:</label><input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} /></div>
                      </div>
                      
                      {activePart.revisions && activePart.revisions.length > 0 && (
                          <div style={{ background: '#fff', border: '1px solid #ccc', padding: '10px' }}>
                              <label style={{ fontSize: '0.65rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>REVISION GALLERY ({activePart.revisions.length} Angles/Images):</label>
                              <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', paddingBottom: '10px' }}>
                                  {activePart.revisions.map((rev, idx) => (
                                      <div key={idx} style={{ flexShrink: 0, width: '80px', height: '80px', border: rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl ? '3px solid #28a745' : '1px solid #ccc', background: '#f4f4f4', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                          {rev.is3D || rev.name?.includes('3D') ? <span style={{fontSize:'1.5rem'}}>🧊</span> : <img src={rev.url} alt="Rev" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                          {(rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl) && <div style={{ position: 'absolute', bottom: 0, width: '100%', background: '#28a745', color: '#fff', fontSize: '0.5rem', textAlign: 'center', fontWeight: 'bold' }}>MASTER</div>}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      {/* --- FILE CABINET FOR MASTER ASSEMBLIES --- */}
                      {activePart.partClass === 'Master Assembly' && (
                          <div style={{ marginTop: '15px', background: '#fff', border: '1px solid #28a745', padding: '10px', fontFamily: 'monospace' }}>
                              <div style={{ fontWeight: 'bold', color: '#000', marginBottom: '5px' }}>🗄️ FILE CABINET: {activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId}</div>
                              {activeBomPins.length === 0 ? (
                                  <div style={{ paddingLeft: '20px', color: '#999', fontStyle: 'italic', fontSize: '0.85rem' }}>↳ No nested components pinned yet. (Configure in Tab 2)</div>
                              ) : (
                                  activeBomPins.map(pin => (
                                      <div key={pin.id} style={{ paddingLeft: '20px', color: '#333', marginTop: '5px', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.85rem' }}>
                                          <span style={{ color: '#28a745' }}>↳</span> 
                                          <span><strong>{pin.defaultQty || 1}x</strong> {pin.partName} <span style={{ color: '#007bff' }}>[{pin.legacyErpId}]</span></span>
                                      </div>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              )}

              {/* --- CLONE SPECS ENGINE --- */}
              <div style={{ background: '#f8f9fa', padding: '15px', border: '2px dashed #007bff', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#007bff', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                      <span>🧬 CLONE CPQ ATTRIBUTES & SPECS FROM EXISTING RECORD</span>
                  </label>
                  <div style={{ display: 'flex', gap: '10px' }}>
                      <select value={cloneSourceId} onChange={(e) => setCloneSourceId(e.target.value)} style={{ flex: 1, padding: '10px', border: '1px solid #007bff', outline: 'none', fontWeight: 'bold' }}>
                          <option value="">-- Select Source Record --</option>
                          {inventory.filter(p => p.id !== activePart.id).map(p => (
                              <option key={p.id} value={p.id}>{p.legacyErpId && p.legacyErpId !== "PENDING" ? `[${p.legacyErpId}] ` : ''}{p.itemName}</option>
                          ))}
                      </select>
                      <button onClick={handleCloneSpecs} disabled={!cloneSourceId} style={{ padding: '10px 20px', background: cloneSourceId ? '#007bff' : '#ccc', color: '#fff', fontWeight: 'bold', border: 'none', cursor: cloneSourceId ? 'pointer' : 'not-allowed' }}>CLONE DATA</button>
                  </div>
              </div>

              <div>
                 <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>IDENTIFICATION</h4>
                 
                 <div style={{ display: 'flex', gap: '10px' }}>
                     <div style={{ flex: 2 }}>
                         <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>RECORD NAME / DESCRIPTION:</label>
                         <input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activePart.itemName} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', boxSizing: 'border-box', fontWeight: 'bold' }} />
                     </div>
                     <div style={{ flex: 1 }}>
                         <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#007bff' }}>ERP LEGACY ID (Internal):</label>
                         <input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activePart.legacyErpId === "PENDING" ? "" : activePart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ width: '100%', padding: '8px', border: '2px solid #007bff', boxSizing: 'border-box', textTransform: 'uppercase' }} />
                     </div>
                 </div>

                 {/* 🚀 NEW: MULTI-CLIENT PRICING MATRIX */}
                 <div style={{ background: '#f0f8ff', border: '2px solid #007bff', padding: '15px', marginTop: '15px' }}>
                    <h4 style={{ margin: '0 0 10px 0', color: '#007bff', borderBottom: '2px solid #007bff', paddingBottom: '5px' }}>🤝 CLIENT-SPECIFIC PRICING & SKUs</h4>
                    
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', marginBottom: '15px' }}>
                        <div style={{ flex: 2 }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>CUSTOMER:</label>
                            <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontWeight: 'bold' }}>
                                <option value="">Select Customer...</option>
                                {(globalLists.customers || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 2 }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>CLIENT SKU / PART #:</label>
                            <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. CUST-999" style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontWeight: 'bold' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>CUSTOM PRICE ($):</label>
                            <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={{ width: '100%', padding: '8px', border: '1px solid #ccc', fontWeight: 'bold' }} />
                        </div>
                        <button onClick={handleAddClientPricing} style={{ padding: '9px 15px', background: '#007bff', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>+ ADD</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        {(editSpecs.clientPricing || []).length === 0 && <div style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                        {(editSpecs.clientPricing || []).map((cp, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid #ccc', padding: '8px 12px' }}>
                                <div style={{ display: 'flex', gap: '20px', fontSize: '0.8rem', width: '100%', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 'bold', color: '#007bff', flex: 1 }}>{cp.customerId}</span>
                                    <span style={{ flex: 1 }}><strong style={{ color: '#666' }}>SKU:</strong> {cp.clientSku || 'N/A'}</span>
                                    <span style={{ color: '#28a745', fontWeight: 'bold', width: '80px', textAlign: 'right' }}>${parseFloat(cp.price || 0).toFixed(2)}</span>
                                </div>
                                <button onClick={() => handleRemoveClientPricing(idx)} style={{ background: 'none', border: 'none', color: '#d9534f', fontWeight: 'bold', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '10px' }}>×</button>
                            </div>
                        ))}
                    </div>
                 </div>

                 <div style={{ marginTop: '15px', background: '#f8f9fa', padding: '10px', border: '2px solid #ccc' }}>
                   <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>RECORD VISIBILITY & CROSS-BRAND SHARING:</label>
                   <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap' }}>
                     {AVAILABLE_BRANDS.map(brand => {
                        const isOwner = activePart.brandId === brand.id; const isShared = editSpecs.sharedBrands?.includes(brand.id);
                        return ( <label key={brand.id} style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '5px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.7 : 1 }}><input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id)} />{brand.name} {isOwner && "(Owner)"}</label> );
                     })}
                   </div>
                 </div>
              </div>

              {/* BRAND-AWARE CORE ATTRIBUTES */}
              <div>
                 <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px' }}>CORE ATTRIBUTES</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                   
                   {windowConfig.system.prodTypes?.includes(activeBrand) && (
                       <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROD TYPE:</label><select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}><option value="">SELECT...</option>{(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}</select></div>
                   )}
                   
                   {windowConfig.system.uom?.includes(activeBrand) && (
                       <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>UOM:</label><select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}>{(globalLists.uom || []).map(u => <option key={u} value={u}>{u}</option>)}</select></div>
                   )}
                   
                   {windowConfig.custom.filter(w => (w.brands || []).includes(activeBrand)).map(w => (
                       <div key={w.id}>
                           <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#e83e8c', textTransform: 'uppercase' }}>{w.name}:</label>
                           <select value={editSpecs.dynamicDicts?.[w.id] || ""} onChange={(e) => handleDictChange(w.id, e.target.value)} style={{ width: '100%', padding: '8px', border: '2px solid #e83e8c', outline: 'none', fontWeight: 'bold' }}>
                               <option value="">SELECT...</option><option value="N/A">N/A</option>
                               {dynamicAssets.filter(a => a.windowId === w.id).map(a => <option key={a.id} value={a.name}>{a.name} {a.code ? `(${a.code})` : ''}</option>)}
                           </select>
                       </div>
                   ))}

                   {windowConfig.system.collections?.includes(activeBrand) && (
                       <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>COLLECTION:</label><select name="collection" value={editSpecs.collection || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}><option value="">SELECT...</option>{(globalLists.collections || []).map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                   )}

                   {windowConfig.system.assemblyTypes?.includes(activeBrand) && (
                       <div><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>ASSEMBLY TYPE:</label><select name="assemblyType" value={editSpecs.assemblyType || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000' }}><option value="">SELECT...</option>{(globalLists.assemblyTypes || []).map(at => <option key={at} value={at}>{at}</option>)}</select></div>
                   )}

                   {windowConfig.system.watchLists?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2', background: '#fff3cd', border: '2px solid #ffc107', padding: '10px' }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px', color: editSpecs.watchList !== "NONE" ? '#d9534f' : '#000' }}>ASSIGN TO WATCHLIST:</label><select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '2px solid #000', fontWeight: 'bold' }}>{(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}</select></div>
                   )}
                 </div>
              </div>

              {/* SOURCING & WAREHOUSE */}
              {activePart.partClass === 'Inventory' && (
                  <div>
                    <h4 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #eee', paddingBottom: '5px', color: '#007bff' }}>LOGISTICS & SOURCING</h4>
                    
                    {/* 🚀 NEW: WAREHOUSE BIN LOCATION */}
                    <div style={{ background: '#f8f9fa', border: '2px solid #6f42c1', padding: '15px', marginBottom: '15px' }}>
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

                    <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}><button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '10px', background: editSpecs.isInHouse ? '#000' : '#eee', color: editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>IN-HOUSE</button><button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '10px', background: !editSpecs.isInHouse ? '#000' : '#eee', color: !editSpecs.isInHouse ? '#fff' : '#000', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer' }}>OUTSOURCED</button></div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {editSpecs.isInHouse ? (
                        <>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>PROGRAM #:</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>RAW MAT:</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE PRICE ($):</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                            <div style={{ flex: 1 }}><label style={{ fontSize: '0.65rem', fontWeight: 'bold' }}>BASE COST ($):</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={{ width: '100%', padding: '8px', border: '1px solid #000', boxSizing: 'border-box' }} /></div>
                          </div>
                        </>
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
              )}

              {/* GEOMETRY & CAD RULES */}
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

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button onClick={savePartUpdates} style={{ flex: 2, padding: '15px', background: isSaving ? '#28a745' : '#000', color: '#fff', fontWeight: 'bold', fontSize: '1rem', border: '2px solid #000', cursor: 'pointer', transition: '0.3s', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)' }}>{isSaving ? "SAVED ✓" : `SAVE ${partClassFilter.toUpperCase()} CONFIGURATION`}</button>
                {!activePart.isNew && <button onClick={handleDeletePart} style={{ flex: 1, padding: '15px', background: '#fff', color: '#d9534f', border: '2px solid #d9534f', fontWeight: 'bold', cursor: 'pointer', boxShadow: '4px 4px 0 rgba(217,83,79,0.2)' }}>🗑️ DELETE</button>}
              </div>

            </div>
          </div>
        )}
      </div>

      {isAdmin && (
          <div style={{ marginTop: '40px' }}>
              <button 
                  onClick={() => setShowAdminDashboard(!showAdminDashboard)} 
                  style={{ width: '100%', padding: '15px', background: '#333', color: '#fff', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', border: '2px solid #000', textAlign: 'left' }}
              >
                  {showAdminDashboard ? '➖ HIDE SYSTEM DATA & DICTIONARIES' : '➕ EXPAND SYSTEM DATA & DICTIONARIES'}
              </button>

              {showAdminDashboard && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
                    
                    <div style={{ padding: '15px', background: '#fff', color: '#000', display: 'flex', alignItems: 'center', gap: '20px', border: '2px solid #000' }}>
                        <strong style={{ fontSize: '1.1rem', color: '#007bff' }}>ADMIN BRAND MASTER SWITCH:</strong>
                        <div style={{ display: 'flex', gap: '15px' }}>
                            {AVAILABLE_BRANDS.map(b => (
                                <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontWeight: 'bold', color: adminBrandFilter === b.id ? '#007bff' : '#333' }}>
                                    <input type="radio" checked={adminBrandFilter === b.id} onChange={() => setAdminBrandFilter(b.id)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                                    {b.name.toUpperCase()}
                                </label>
                            ))}
                        </div>
                        <button onClick={() => setShowWindowManager(true)} style={{ marginLeft: 'auto', padding: '8px 15px', background: '#333', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>⚙️ MANAGE BRAND WINDOWS</button>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        
                        {windowConfig.system.inHouseFinishes?.includes(adminBrandFilter) && (
                            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 darkslategrey' }}>
                                <div style={{ padding: '15px', background: 'darkslategrey', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                    <span>🎨 IN-HOUSE MASTER FINISHES (CPQ LIBRARY)</span>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button onClick={handleSyncFloorRecipes} style={{ background: '#ffc107', color: '#000', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>🔄 SYNC FLOOR RECIPES</button>
                                        <button onClick={() => setShowFinishForm(!showFinishForm)} style={{ background: '#fff', color: 'darkslategrey', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>{showFinishForm ? 'CLOSE' : '+ ADD FINISH'}</button>
                                    </div>
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
                                        {globalFinishes.map(finish => {
                                            const hasRecipe = activeRecipes.includes(finish.code) || activeRecipes.includes(finish.name);
                                            return (
                                                <div key={finish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', borderLeft: `6px solid darkslategrey`, boxShadow: '3px 3px 0 rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                                        <div style={{ width: '40px', height: '40px', background: finish.textureUrl ? `url(${finish.textureUrl}) center/cover` : '#eee', borderRadius: '50%', border: '2px solid #000' }} />
                                                        <div>
                                                            <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{finish.name} {finish.code && `(${finish.code})`}</div>
                                                            <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold', marginTop: '3px' }}>STATUS: {hasRecipe ? 'PRODUCTION READY' : 'WORKING / R&D'}</div>
                                                            <div style={{ marginTop: '5px' }}>
                                                                <label style={{ fontSize: '0.65rem', cursor: 'pointer', color: '#007bff', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                                                    {inlineTextureProgress[finish.id] > 0 ? `UPLOADING ${inlineTextureProgress[finish.id]}%` : (finish.textureUrl ? '🔄 REPLACE TEXTURE MAP' : '⬆️ UPLOAD TEXTURE MAP')}
                                                                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpdateExistingFinishTexture(finish.id, e.target.files[0])} />
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => handleRemoveFinish(finish.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}

                        {windowConfig.system.outsourceFinishes?.includes(adminBrandFilter) && (
                            <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #17a2b8' }}>
                                <div style={{ padding: '15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                    <span>🚚 OUTSOURCED MASTER FINISHES (CPQ LIBRARY)</span>
                                    <button onClick={() => setShowOutsourceFinishForm(!showOutsourceFinishForm)} style={{ background: '#fff', color: '#17a2b8', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>{showOutsourceFinishForm ? 'CLOSE' : '+ ADD FINISH'}</button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {showOutsourceFinishForm && (
                                        <div style={{ padding: '20px', background: '#e0f7fa', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>FINISH NAME:</label><input value={newOutsourceFinishConfig.name} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, name: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>APPROVED VENDOR:</label><select value={newOutsourceFinishConfig.vendor} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, vendor: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }}><option value="">Select...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                                <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>PRICE MULTIPLIER (x):</label><input type="number" step="0.1" value={newOutsourceFinishConfig.multiplier} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, multiplier: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                            </div>
                                            
                                            <div style={{ background: '#fff', padding: '10px', border: '2px solid #000' }}>
                                                <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>SEAMLESS TEXTURE MAP (JPG/PNG):</label>
                                                {newOutsourceFinishConfig.textureUrl && <div style={{ color: '#28a745', fontWeight: 'bold', fontSize: '0.7rem', marginBottom: '5px' }}>✅ Asset Ready</div>}
                                                <input type="file" accept="image/*" onChange={(e) => handleFinishTextureUpload(e.target.files[0], true)} style={{ fontSize: '0.75rem', width: '100%', cursor: 'pointer' }} />
                                                {finishUploadProgress > 0 && <progress value={finishUploadProgress} max="100" style={{ width: '100%', marginTop: '5px' }}/>}
                                            </div>
                                            
                                            <button onClick={handleAddOutsourceFinish} style={{ padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', marginTop: '10px' }}>SAVE OUTSOURCED FINISH</button>
                                        </div>
                                    )}
                                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', background: '#f8f9fa' }}>
                                        {outsourceFinishes.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No outsourced finishes added yet.</span>}
                                        {outsourceFinishes.map(finish => (
                                            <div key={finish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', borderLeft: `6px solid #17a2b8` }}>
                                                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                                    <div style={{ width: '40px', height: '40px', background: finish.textureUrl ? `url(${finish.textureUrl}) center/cover` : '#eee', borderRadius: '50%', border: '2px solid #000' }} />
                                                    <div>
                                                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{finish.name}</div>
                                                        <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold', marginTop: '3px' }}>VENDOR: {finish.vendor || 'UNASSIGNED'} | MULT: x{finish.multiplier}</div>
                                                        <div style={{ marginTop: '5px' }}>
                                                            <label style={{ fontSize: '0.65rem', cursor: 'pointer', color: '#007bff', fontWeight: 'bold', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                                                                {inlineTextureProgress[finish.id] > 0 ? `UPLOADING ${inlineTextureProgress[finish.id]}%` : (finish.textureUrl ? '🔄 REPLACE TEXTURE MAP' : '⬆️ UPLOAD TEXTURE MAP')}
                                                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpdateExistingFinishTexture(finish.id, e.target.files[0], true)} />
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <button onClick={() => handleRemoveOutsourceFinish(finish.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {windowConfig.custom.filter(w => (w.brands || []).includes(adminBrandFilter)).map(w => {
                            const myData = dynamicAssets.filter(d => d.windowId === w.id);
                            const myForm = newAssetForms[w.id] || {};
                            const isFormOpen = activeDictForms[w.id];

                            return (
                                <div key={w.id} style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #e83e8c' }}>
                                    <div style={{ padding: '15px', background: '#e83e8c', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                        <span>📦 CPQ ASSET DICTIONARY: {w.name.toUpperCase()}</span>
                                        <button onClick={() => setActiveDictForms(prev => ({ ...prev, [w.id]: !isFormOpen }))} style={{ background: '#fff', color: '#e83e8c', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>{isFormOpen ? 'CLOSE' : '+ ADD ITEM'}</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                        {isFormOpen && (
                                            <div style={{ padding: '20px', background: '#fce4ec', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>ITEM NAME:</label><input value={myForm.name || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, name: e.target.value}})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                                <div style={{ display: 'flex', gap: '10px' }}>
                                                    {w.hasCode && <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>CODE:</label><input value={myForm.code || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, code: e.target.value}})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>}
                                                    {w.hasMultiplier && <div style={{ flex: 1 }}><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>MULT (x):</label><input type="number" step="0.1" value={myForm.multiplier || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, multiplier: e.target.value}})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>}
                                                </div>
                                                {w.hasVendor && <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>VENDOR:</label><select value={myForm.vendor || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, vendor: e.target.value}})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }}><option value="">Select...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>}
                                                {w.hasImage && (
                                                    <div style={{ background: '#fff', padding: '10px', border: '1px solid #000' }}>
                                                        <label style={{ fontSize: '0.7rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>ASSET (IMAGE/TEXTURE):</label>
                                                        {myForm.textureUrl && <span style={{ color: '#28a745', fontSize: '0.7rem', fontWeight: 'bold' }}>✅ Uploaded</span>}
                                                        <input type="file" accept="image/*" onChange={e => handleDynamicAssetTextureUpload(w.id, e.target.files[0])} style={{ fontSize: '0.75rem', width: '100%' }} />
                                                    </div>
                                                )}
                                                <button onClick={() => handleAddDynamicAsset(w)} style={{ padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', marginTop: '10px' }}>SAVE ITEM</button>
                                            </div>
                                        )}
                                        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', background: '#f8f9fa' }}>
                                            {myData.length === 0 && <span style={{ color: '#999', fontStyle: 'italic', fontSize: '0.8rem' }}>No items added yet.</span>}
                                            {myData.map(item => (
                                                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', borderLeft: `6px solid #e83e8c`, boxShadow: '3px 3px 0 rgba(0,0,0,0.05)' }}>
                                                    <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                                                        {w.hasImage && <div style={{ width: '30px', height: '30px', background: item.textureUrl ? `url(${item.textureUrl}) center/cover` : '#eee', borderRadius: '50%', border: '1px solid #000' }} />}
                                                        <div>
                                                            <div style={{ fontWeight: 'bold', fontSize: '0.85rem', color: '#000' }}>{item.name} {item.code && `(${item.code})`}</div>
                                                            {w.hasVendor && <div style={{ fontSize: '0.65rem', color: '#666', fontWeight: 'bold', marginTop: '3px' }}>VENDOR: {item.vendor || 'N/A'}</div>}
                                                            <div style={{ fontSize: '0.65rem', color: '#e83e8c', fontWeight: 'bold', marginTop: '3px' }}>NS ID: {item.legacyErpId || 'PENDING'} {w.hasMultiplier && `| MULT: x${item.multiplier}`}</div>
                                                        </div>
                                                    </div>
                                                    <button onClick={() => handleRemoveDynamicAsset(item.id)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #28a745' }}>
                            <div style={{ padding: '15px', background: '#28a745', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                <span>⚙️ STATIC PART ATTRIBUTES</span>
                                <button onClick={() => setShowSchemaForm(!showSchemaForm)} style={{ background: '#fff', color: '#28a745', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                                    {showSchemaForm ? 'CLOSE' : '+ ADD ATTRIBUTE'}
                                </button>
                            </div>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                {showSchemaForm && (
                                    <div style={{ padding: '20px', background: '#eafaf1', borderBottom: '2px solid #000', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>NEW ATTRIBUTE LABEL:</label><input value={newFieldConfig.label} onChange={(e) => setNewFieldConfig({...newFieldConfig, label: e.target.value})} placeholder="e.g. Weight Class" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>
                                        <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold' }}>DATA TYPE:</label><select value={newFieldConfig.type} onChange={(e) => setNewFieldConfig({...newFieldConfig, type: e.target.value})} style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }}><option value="text">Text (String)</option><option value="number">Number</option><option value="dropdown">Dropdown</option><option value="file">File Upload (PNG, PDF)</option></select></div>
                                        {newFieldConfig.type === 'dropdown' && <div><label style={{ fontSize: '0.7rem', fontWeight: 'bold', color: '#007bff' }}>OPTIONS (Comma Separated):</label><input value={newFieldConfig.options} onChange={(e) => setNewFieldConfig({...newFieldConfig, options: e.target.value})} placeholder="A, B, C" style={{ width: '100%', padding: '10px', border: '2px solid #000', boxSizing: 'border-box' }} /></div>}
                                        <button onClick={handleAddSchemaField} style={{ padding: '12px', background: '#000', color: '#fff', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', marginTop: '10px' }}>SAVE ATTRIBUTE</button>
                                    </div>
                                )}
                                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', background: '#f8f9fa' }}>
                                    {customSchema.length === 0 && <span style={{ color: '#999', fontStyle: 'italic' }}>No custom attributes mapped.</span>}
                                    {customSchema.map(field => (
                                        <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', padding: '15px', border: '2px solid #ccc', boxShadow: '3px 3px 0 rgba(0,0,0,0.05)' }}>
                                            <div><div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#000' }}>{field.label}</div><div style={{ fontSize: '0.65rem', color: '#666', marginTop: '3px', fontWeight: 'bold' }}>TYPE: {field.type.toUpperCase()} | ID: {field.key}</div></div>
                                            <button onClick={() => handleRemoveSchemaField(field.key)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer' }}>🗑️</button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div style={{ background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '8px 8px 0 #fd7e14' }}>
                            <div style={{ padding: '15px', background: '#fd7e14', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                                <span>📋 SIMPLE DROPDOWN LISTS</span>
                                <button onClick={handleAddNewListCategory} style={{ background: '#fff', color: '#fd7e14', border: '2px solid #000', fontWeight: 'bold', padding: '5px 15px', cursor: 'pointer', boxShadow: '2px 2px 0 #000' }}>
                                    + ADD CATEGORY
                                </button>
                            </div>
                            
                            <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px', background: '#f8f9fa', maxHeight: '500px', overflowY: 'auto' }}>
                                {Object.keys(globalLists).filter(k => windowConfig.system[k]?.includes(adminBrandFilter) && k !== 'cpqRoutingTypes').map(listKey => {
                                    return (
                                        <div key={listKey} style={{ background: '#fff', border: '2px solid #000', padding: '15px', display: 'flex', flexDirection: 'column', boxShadow: '4px 4px 0 rgba(0,0,0,0.1)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #eee', paddingBottom: '8px', marginBottom: '15px' }}>
                                                <h4 style={{ margin: 0, textTransform: 'uppercase', color: '#000', fontSize: '0.9rem' }}>{LIST_LABELS[listKey] || listKey.replace(/([A-Z])/g, ' $1').trim()}</h4>
                                                <button onClick={() => handleDeleteListCategory(listKey)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.1rem', cursor: 'pointer' }} title="Delete Category">🗑️</button>
                                            </div>
                                            <div style={{ display: 'flex', gap: '5px', marginBottom: '15px' }}>
                                                <input value={newListItems[listKey] || ''} onChange={(e) => setNewListItems({...newListItems, [listKey]: e.target.value})} style={{ flex: 1, padding: '8px', border: '2px solid #000', fontWeight: 'bold' }} placeholder="Add item..." />
                                                <button onClick={() => handleAddListItem(listKey)} style={{ background: '#000', color: '#fff', border: '2px solid #000', cursor: 'pointer', padding: '0 15px', fontWeight: 'bold', fontSize: '1.2rem' }}>+</button>
                                            </div>
                                            <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                                {(globalLists[listKey] || []).length === 0 && <div style={{ fontSize: '0.7rem', color: '#999', fontStyle: 'italic' }}>List is empty.</div>}
                                                {(globalLists[listKey] || []).map(item => (
                                                    <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', background: '#f4f4f4', padding: '8px 10px', border: '1px solid #ccc', fontWeight: 'bold', color: '#333' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            {listKey === 'assemblyTypes' && (
                                                                <label style={{ fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', color: '#007bff' }}>
                                                                    <input type="checkbox" checked={globalLists.cpqRoutingTypes?.includes(item) || false} onChange={(e) => handleToggleCpqRouting(item, e.target.checked)} />
                                                                    CPQ Enabled
                                                                </label>
                                                            )}
                                                            <span>{item}</span>
                                                        </div>
                                                        <span onClick={() => handleRemoveListItem(listKey, item)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' }}>×</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                    </div>
                  </div>
              )}
          </div>
      )}

      {showWindowManager && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div style={{ background: '#fff', border: '4px solid #000', width: '900px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '20px 20px 0 #000' }}>
                  <div style={{ padding: '20px', background: '#000', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #000' }}>
                      <h2 style={{ margin: 0, fontSize: '1.5rem', textTransform: 'uppercase' }}>MANAGE BRAND DATA WINDOWS</h2>
                      <button onClick={() => setShowWindowManager(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                  </div>
                  <div style={{ flex: 1, padding: '20px', overflowY: 'auto', background: '#f8f9fa' }}>
                      
                      <div style={{ marginBottom: '30px', padding: '15px', border: '2px dashed #007bff', background: '#f0f8ff' }}>
                          <h4 style={{ margin: '0 0 10px 0', color: '#007bff' }}>+ CREATE CUSTOM CPQ DICTIONARY</h4>
                          <p style={{ fontSize: '0.75rem', color: '#666', marginBottom: '15px' }}>Create a new bucket of options (e.g. "Glass Colors", "Tassels") to use in the CPQ Engine.</p>
                          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                              <input value={newCustomWindow.name} onChange={e => setNewCustomWindow({...newCustomWindow, name: e.target.value})} placeholder="Dictionary Name (e.g. Glass Colors)" style={{ flex: 1, padding: '10px', border: '1px solid #ccc', fontWeight: 'bold' }} />
                              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', gap: '5px' }}><input type="checkbox" checked={newCustomWindow.hasImage} onChange={e => setNewCustomWindow({...newCustomWindow, hasImage: e.target.checked})} /> Require Texture Image</label>
                              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', gap: '5px' }}><input type="checkbox" checked={newCustomWindow.hasCode} onChange={e => setNewCustomWindow({...newCustomWindow, hasCode: e.target.checked})} /> Require ERP Code</label>
                              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', gap: '5px' }}><input type="checkbox" checked={newCustomWindow.hasMultiplier} onChange={e => setNewCustomWindow({...newCustomWindow, hasMultiplier: e.target.checked})} /> Has Price Multiplier</label>
                              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', gap: '5px' }}><input type="checkbox" checked={newCustomWindow.hasVendor} onChange={e => setNewCustomWindow({...newCustomWindow, hasVendor: e.target.checked})} /> Assign Vendor</label>
                              <button onClick={handleCreateCustomWindow} style={{ padding: '10px 20px', background: '#007bff', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>CREATE</button>
                          </div>
                      </div>

                      <div style={{ marginBottom: '30px' }}>
                          <h3 style={{ borderBottom: '2px solid #ccc', paddingBottom: '10px', marginTop: 0 }}>SYSTEM & CUSTOM WINDOWS</h3>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left', background: '#fff', border: '1px solid #ccc' }}>
                              <thead style={{ background: '#eee' }}>
                                  <tr><th style={{ padding: '10px', borderBottom: '2px solid #000' }}>WINDOW</th>{AVAILABLE_BRANDS.map(b => <th key={b.id} style={{ padding: '10px', borderBottom: '2px solid #000', textAlign: 'center' }}>{b.id.toUpperCase()}</th>)}</tr>
                              </thead>
                              <tbody>
                                  {Object.keys(windowConfig.system).map(key => (
                                      <tr key={key} style={{ borderBottom: '1px solid #eee' }}>
                                          <td style={{ padding: '10px', fontWeight: 'bold' }}>{LIST_LABELS[key] || key.replace(/([A-Z])/g, ' $1').trim().toUpperCase()}</td>
                                          {AVAILABLE_BRANDS.map(b => <td key={b.id} style={{ padding: '10px', textAlign: 'center' }}><input type="checkbox" checked={(windowConfig.system[key] || []).includes(b.id)} onChange={() => toggleSystemWindowBrand(key, b.id)} style={{ transform: 'scale(1.3)', cursor: 'pointer' }} /></td>)}
                                      </tr>
                                  ))}
                                  {windowConfig.custom.map(w => (
                                      <tr key={w.id} style={{ borderBottom: '1px solid #ccc', background: '#fce4ec' }}>
                                          <td style={{ padding: '10px', fontWeight: 'bold', color: '#e83e8c', display: 'flex', justifyContent: 'space-between' }}>
                                              {w.name}
                                              <button onClick={() => handleDeleteCustomWindow(w.id)} style={{ background: 'none', border: 'none', color: '#d9534f', cursor: 'pointer' }}>🗑️ DEL</button>
                                          </td>
                                          {AVAILABLE_BRANDS.map(b => <td key={b.id} style={{ padding: '10px', textAlign: 'center' }}><input type="checkbox" checked={(w.brands || []).includes(b.id)} onChange={() => toggleCustomWindowBrand(w.id, b.id)} style={{ transform: 'scale(1.3)', cursor: 'pointer' }} /></td>)}
                                      </tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default LibraryTab;