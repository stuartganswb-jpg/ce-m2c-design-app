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
  customers: ['ce', 'm2c', 'uniquity', 'leyla'],
  partHandling: ['ce', 'm2c', 'uniquity', 'leyla'], 
  inventoryTypes: ['ce', 'm2c', 'uniquity', 'leyla'],
  projections: ['ce', 'm2c', 'uniquity', 'leyla'] 
};

const LIST_LABELS = {
    prodTypes: 'PRODUCT TYPES', uom: 'UOMs',
    watchLists: 'WATCHLISTS', vendors: 'APPROVED VENDORS', outsourceActions: 'OUTSOURCE ACTIONS',
    pillowSizes: 'PILLOW SIZES', fillTypes: 'FILL TYPES', flangeStyles: 'EDGE / FLANGE STYLES', 
    stitchTypes: 'STITCH ROUTING', seamCounts: 'SEAM COUNTS / UPCHARGES', assemblyTypes: 'ASSEMBLY TYPES',
    customers: 'CUSTOMERS / DEALERS (Format: Name - ID)', 
    partHandling: 'PART HANDLING & ROUTING', 
    inventoryTypes: 'RAW MATERIAL - INVENTORY ITEMS',
    projections: 'BRACKET PROJECTIONS' 
};

const LibraryTab = ({ currentUser, activeBrand }) => {
  const [isAdmin, setIsAdmin] = useState(true);
  const [adminBrandFilter, setAdminBrandFilter] = useState(activeBrand);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);

  const [inventory, setInventory] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [partClassFilter, setPartClassFilter] = useState("ALL"); 
  const [collectionFilter, setCollectionFilter] = useState(""); 
  
  const [customSchema, setCustomSchema] = useState([]);
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]); 
  
  const [liveVendors, setLiveVendors] = useState([]); 
  const [liveCustomers, setLiveCustomers] = useState([]); 
  
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], watchLists: [], vendors: [], outsourceActions: [],
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], assemblyTypes: [],
      cpqRoutingTypes: [], customers: [], partHandling: [], inventoryTypes: [], projections: [] 
  });
  
  const [windowConfig, setWindowConfig] = useState({ system: DEFAULT_SYSTEM_WINDOWS, custom: [] });
  const [newListItems, setNewListItems] = useState({});
  const [activeRecipes, setActiveRecipes] = useState([]); 
  const [floorRecipeData, setFloorRecipeData] = useState([]); 

  const [showSchemaForm, setShowSchemaForm] = useState(false);
  const [showFinishForm, setShowFinishForm] = useState(false);
  const [showOutsourceFinishForm, setShowOutsourceFinishForm] = useState(false);
  const [showWindowManager, setShowWindowManager] = useState(false);
  const [showCollectionForm, setShowCollectionForm] = useState(false); 

  const [newFieldConfig, setNewFieldConfig] = useState({ key: '', label: '', type: 'text', options: '' });
  const [newCollection, setNewCollection] = useState({ name: '', allowedCustomers: [], allowedFinishes: [] }); 
  const [newCustomWindow, setNewCustomWindow] = useState({ name: '', brands: [activeBrand], hasImage: true, hasCode: true, hasVendor: false, hasMultiplier: true });
  
  const [editingGlobalFinish, setEditingGlobalFinish] = useState(null);
  const [editingOutsourceFinish, setEditingOutsourceFinish] = useState(null);
  const [newFinishConfig, setNewFinishConfig] = useState({ name: '', code: '', type: '', textureUrl: '', clientMapping: [] });
  const [newOutsourceFinishConfig, setNewOutsourceFinishConfig] = useState({ name: '', description: '', multiplier: 1.0, vendor: '', textureUrl: '', clientMapping: [] });
  const [newFinishClientMapping, setNewFinishClientMapping] = useState({ customerId: '', clientFinishName: '' });
  
  const [finishUploadProgress, setFinishUploadProgress] = useState(0);
  const [inlineTextureProgress, setInlineTextureProgress] = useState({});

  const [activeDictForms, setActiveDictForms] = useState({});
  const [newAssetForms, setNewAssetForms] = useState({});
  const [assetUploadProgress, setAssetUploadProgress] = useState({});

  const [activePart, setActivePart] = useState(null);
  const [activeBomPins, setActiveBomPins] = useState([]); 
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, clientPricing: [], collections: [] }); 
  const [isSaving, setIsSaving] = useState(false);
  
  const [newClientPricing, setNewClientPricing] = useState({ customerId: '', clientSku: '', price: '', clientSalesPrice: '' }); 

  const [pdfFile, setPdfFile] = useState(null);
  const [cadFile, setCadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cadUploadProgress, setCadUploadProgress] = useState(0); 
  
  const [dynamicUploadProgress, setDynamicUploadProgress] = useState({});
  const [cloneSourceId, setCloneSourceId] = useState("");

  const [userPerms, setUserPerms] = useState([]);
  const [isPushingErp, setIsPushingErp] = useState(false);
  const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

  useEffect(() => {
      if (!currentUser) return;
      const unsubUser = onSnapshot(collection(db, "hq_users"), (snap) => {
          const users = snap.docs.map(d => d.data());
          const me = users.find(u => u.name === currentUser);
          
          if (me && me.role) {
              onSnapshot(doc(db, "hq_config", "permissions"), (permSnap) => {
                  if (permSnap.exists()) {
                      setUserPerms(permSnap.data()[me.role] || []);
                  }
              });
          }
      });
      return () => unsubUser();
  }, [currentUser]);

  const hasErpWriteAccess = isAdmin || userPerms.includes("ERP_WRITE_BACK");

  useEffect(() => { setAdminBrandFilter(activeBrand); }, [activeBrand]);

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
    const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => { if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes); });
    const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()})))); 
    const unsubVendors = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "VENDOR")), snap => setLiveVendors(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCustomers = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "CUSTOMER")), snap => setLiveCustomers(snap.docs.map(d => ({id: d.id, ...d.data()}))));

    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          setGlobalLists({ 
              uom: data.uom || [], prodTypes: data.prodTypes || [], 
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [], 
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || ['0 Seams', '1 Seam', '2 Seams', '3 Seams', '4 Seams'],
              assemblyTypes: data.assemblyTypes || [], 
              cpqRoutingTypes: data.cpqRoutingTypes || [],
              customers: data.customers || [],
              partHandling: data.partHandling || ['Small Parts', 'Custom'], 
              inventoryTypes: data.inventoryTypes || [],
              projections: data.projections || [] 
          });
      }
    });

    const unsubRecipes = onSnapshot(collection(db, "fin_recipes"), (snap) => { setActiveRecipes(snap.docs.map(d => d.id)); setFloorRecipeData(snap.docs.map(d => ({ id: d.id, ...d.data() }))); });
    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      if (docSnap.exists()) setWindowConfig({ system: { ...DEFAULT_SYSTEM_WINDOWS, ...(docSnap.data().system || {}) }, custom: docSnap.data().custom || [] });
    });

    return () => { unsubSchema(); unsubFinishes(); unsubOutsource(); unsubAssets(); unsubCollections(); unsubLists(); unsubRecipes(); unsubWindowConfig(); unsubVendors(); unsubCustomers(); };
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
      if (!activePart || activePart.partClass !== 'Master Assembly') { setActiveBomPins([]); return; }
      const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activePart.itemId));
      const unsubscribe = onSnapshot(q, (snapshot) => { setActiveBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); });
      return () => unsubscribe();
  }, [activePart]);

  const filteredInventory = inventory.filter(part => {
    const term = searchTerm.toLowerCase();
    const specs = part.manufacturingSpecs || {};

    const matchesSearch = part.itemName?.toLowerCase().includes(term) || 
                          (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) || 
                          (part.itemId && part.itemId.toLowerCase().includes(term)) ||
                          (specs.binLocation && specs.binLocation.toLowerCase().includes(term)) || 
                          (part.clientPricing && part.clientPricing.some(cp => 
                              (cp.clientSku && cp.clientSku.toLowerCase().includes(term)) || 
                              (cp.customerId && cp.customerId.toLowerCase().includes(term))
                          ));
    
    let matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase() || (part.productType || "").toUpperCase() === typeFilter.toUpperCase();
    
    const nsCollection = specs.customData?.collection ? [specs.customData.collection.toUpperCase()] : [];
    const partCollections = specs.collections ? specs.collections.map(c=>c.toUpperCase()) : nsCollection;
    let matchesCollection = collectionFilter === "" || partCollections.includes(collectionFilter.toUpperCase()); 
    
    let matchesClass = true;

    if (partClassFilter !== "ALL") {
        if (partClassFilter === "INVENTORY") matchesClass = part.partClass === "Inventory" && specs.isInHouse !== false;
        else if (partClassFilter === "OUTSOURCED") matchesClass = part.partClass === "Inventory" && specs.isInHouse === false;
        else if (partClassFilter === "UNASSIGNED") matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && (!part.routingType || part.routingType === "UNASSIGNED");
        else matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && part.routingType?.toUpperCase() === partClassFilter.toUpperCase();
    }
    
    return matchesSearch && matchesType && matchesCollection && matchesClass;
  });

  const openPartDetails = (part) => {
    setActivePart(part); setPdfFile(null); setCadFile(null); setDynamicUploadProgress({}); setCloneSourceId("");
    
    const baseSpecs = part.manufacturingSpecs || {};
    const parametricData = baseSpecs.parametric || { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" };
    const customData = baseSpecs.customData || {}; 
    const dynamicDicts = baseSpecs.dynamicDicts || {};
    const isInHouse = baseSpecs.isInHouse !== undefined ? baseSpecs.isInHouse : true;
    let shared = part.sharedBrands || []; if (!shared.includes(part.brandId)) shared = [...shared, part.brandId];
    
    const legacyCollection = baseSpecs.collection && baseSpecs.collection !== 'N/A' ? [baseSpecs.collection.toUpperCase()] : [];
    const nsCollection = customData.collection && customData.collection !== 'N/A' ? [customData.collection.toUpperCase()] : [];
    const currentCollections = baseSpecs.collections ? baseSpecs.collections.map(c => c.toUpperCase()) : (nsCollection.length > 0 ? nsCollection : legacyCollection);

    const nsWatchlist = customData.watchlist && customData.watchlist !== 'N/A' ? customData.watchlist.toUpperCase() : "NONE";
    const currentWatchList = baseSpecs.watchList ? baseSpecs.watchList.toUpperCase() : nsWatchlist;

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
        binLocation: baseSpecs.binLocation || "", 
        project: part.project || "",
        collections: currentCollections, 
        routingType: part.routingType || "",
        productType: (part.productType || baseSpecs.productType || "").toUpperCase(),
        uom: (baseSpecs.uom || "EA").toUpperCase(),
        watchList: currentWatchList,
        isProjectManaged: baseSpecs.isProjectManaged || false,
        partHandling: baseSpecs.partHandling || "" 
    });
  };

  const handleCloneSpecs = () => {
    if(!cloneSourceId) return;
    if(!window.confirm("Overwrite current specs with cloned data? This pulls all attributes and CPQ rules.")) return;
    const source = inventory.find(p => p.id === cloneSourceId);
    if(!source || !source.manufacturingSpecs) return;
    const clonedSpecs = JSON.parse(JSON.stringify(source.manufacturingSpecs));
    
    const legacyCollection = clonedSpecs.collection && clonedSpecs.collection !== 'N/A' ? [clonedSpecs.collection] : [];
    clonedSpecs.collections = clonedSpecs.collections || legacyCollection;

    setEditSpecs(prev => ({ 
        ...prev, 
        ...clonedSpecs, 
        tempName: prev.tempName, 
        tempLegacyId: prev.tempLegacyId, 
        clientPricing: prev.clientPricing, 
        binLocation: prev.binLocation, 
        pdfUrl: prev.pdfUrl, 
        cadUrl: prev.cadUrl,
        partHandling: prev.partHandling,
        project: prev.project,
        routingType: prev.routingType,
        productType: prev.productType
    }));
    setCloneSourceId("");
  };

  const handleSpecChange = (e) => setEditSpecs({ ...editSpecs, [e.target.name]: e.target.value });
  const handleDictChange = (dictId, value) => setEditSpecs(prev => ({ ...prev, dynamicDicts: { ...(prev.dynamicDicts || {}), [dictId]: value } }));
  const handleParametricChange = (e) => setEditSpecs({ ...editSpecs, parametric: { ...editSpecs.parametric, [e.target.name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } });
  const handleCustomFieldChange = (key, value) => setEditSpecs(prev => ({ ...prev, customData: { ...(prev.customData || {}), [key]: value } }));
  const handleBrandToggle = (brandId) => { let currentShared = editSpecs.sharedBrands || []; if (currentShared.includes(brandId)) currentShared = currentShared.filter(id => id !== brandId); else currentShared.push(brandId); setEditSpecs({ ...editSpecs, sharedBrands: currentShared }); };

  const handleToggleCollection = (collectionName) => {
      const current = editSpecs.collections || [];
      const updated = current.includes(collectionName) ? current.filter(c => c !== collectionName) : [...current, collectionName];
      setEditSpecs({ ...editSpecs, collections: updated });
  };

  const handleAddClientPricing = () => {
      if (!newClientPricing.customerId) return alert("Select a customer from the dropdown.");
      setEditSpecs(prev => ({
          ...prev,
          clientPricing: [...(prev.clientPricing || []), { ...newClientPricing }]
      }));
      setNewClientPricing({ customerId: '', clientSku: '', price: '', clientSalesPrice: '' });
  };

  const handleRemoveClientPricing = (idx) => {
      setEditSpecs(prev => ({ ...prev, clientPricing: prev.clientPricing.filter((_, i) => i !== idx) }));
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
    const actualClass = partClassFilter === 'ALL' || partClassFilter === 'INVENTORY' || partClassFilter === 'OUTSOURCED' ? 'Inventory' : 'Assembly';
    const newId = `${activeBrand.toUpperCase()}-${actualClass === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
    
    setActivePart({ isNew: true, id: newId, itemId: newId, legacyErpId: "PENDING", itemName: `NEW ${actualClass.toUpperCase()}`, brandId: activeBrand, partClass: actualClass });
    setEditSpecs({ productType: "", uom: "EA", finishDetail: "", collections: [], project: "", routingType: "", assemblyType: "", watchList: "NONE", tempName: `NEW ${actualClass.toUpperCase()}`, tempLegacyId: "", clientPricing: [], binLocation: "", isInHouse: partClassFilter !== 'OUTSOURCED', programNum: "", material: "", layeringSequence: "10", vendorName: "", vendorId: "", vendorUrl: "", altVendorUrl: "", cost: "", leadTime: "", moq: "", sharedBrands: [activeBrand], customData: {}, dynamicDicts: {}, parametric: { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" }, isProjectManaged: false, partHandling: "" }); 
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
    delete compiledSpecs.collection; 

    const finalName = editSpecs.tempName || activePart.itemName;
    const finalLegacyId = (editSpecs.tempLegacyId || activePart.legacyErpId).toUpperCase();

    try {
      const payload = { 
          itemName: finalName, 
          legacyErpId: finalLegacyId, 
          clientPricing: editSpecs.clientPricing || [], 
          sharedBrands: editSpecs.sharedBrands || [activePart.brandId || activeBrand], 
          project: editSpecs.project || "",
          routingType: editSpecs.routingType || "",
          productType: editSpecs.productType || "",
          manufacturingSpecs: compiledSpecs, 
          updatedAt: new Date().toISOString() 
      };

      if (activePart.isNew) payload.createdAt = new Date().toISOString();
      await setDoc(doc(db, "Approved_Designs", activePart.id), { ...activePart, ...payload }, { merge: true });
      setTimeout(() => { setIsSaving(false); setActivePart(null); setUploadProgress(0); setCadUploadProgress(0); }, 500);
    } catch (err) { console.error(err); setIsSaving(false); alert("Failed to save."); }
  };

  const handlePushUpdatesToNetSuite = async () => {
      if (!activePart || activePart.legacyErpId === "PENDING" || !activePart.netSuiteInternalId) {
          return alert("This item is not mapped to a NetSuite Internal ID yet. Sync it from ERP first.");
      }
      if (!window.confirm(`Push current local updates for ${activePart.legacyErpId} directly to NetSuite?`)) return;

      setIsPushingErp(true);
      try {
          const nsId = activePart.netSuiteInternalId;
          const recordType = activePart.partClass === 'Inventory' ? 'inventoryitem' : 'assemblyitem';

          const payload = {
              itemid: editSpecs.tempLegacyId || activePart.legacyErpId,
              displayname: editSpecs.tempName || activePart.itemName,
              cost: parseFloat(editSpecs.cost) || 0,
              custitem9: parseFloat(editSpecs.basePrice) || 0
          };

          const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}/${nsId}`;

          const response = await fetch(FIREBASE_FUNCTION_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  targetUrl: targetUrl,
                  method: 'PATCH',
                  payload: payload
              })
          });

          const result = await response.json();
          if (!response.ok) throw new Error(JSON.stringify(result));

          alert("✅ Successfully updated NetSuite ERP record!");
      } catch (error) {
          console.error("NetSuite Push Error:", error);
          alert(`❌ Failed to push to NetSuite. Check console for details.`);
      }
      setIsPushingErp(false);
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

  const toggleCollectionCustomer = (cust) => {
      setNewCollection(prev => ({ ...prev, allowedCustomers: prev.allowedCustomers.includes(cust) ? prev.allowedCustomers.filter(c => c !== cust) : [...prev.allowedCustomers, cust] }));
  };
  const toggleCollectionFinish = (finishName) => {
      setNewCollection(prev => ({ ...prev, allowedFinishes: prev.allowedFinishes.includes(finishName) ? prev.allowedFinishes.filter(f => f !== finishName) : [...prev.allowedFinishes, finishName] }));
  };
  const handleAddCollection = async () => {
      if (!newCollection.name) return alert("Collection name is required.");
      const safeId = `COL_${Date.now()}`;
      await setDoc(doc(db, "hq_collections", safeId), { id: safeId, name: newCollection.name, allowedCustomers: newCollection.allowedCustomers, allowedFinishes: newCollection.allowedFinishes });
      setNewCollection({ name: '', allowedCustomers: [], allowedFinishes: [] });
      setShowCollectionForm(false);
  };
  const handleDeleteCollection = async (id) => {
      if (!window.confirm("Delete this Collection?")) return;
      await deleteDoc(doc(db, "hq_collections", id));
  };

  const handleSyncFloorRecipes = async () => {
      if (!window.confirm("Scan the Finishing Floor database and import missing recipes to HQ?")) return;
      let currentFinishes = [...globalFinishes]; let addedCount = 0;
      floorRecipeData.forEach(recipe => {
          if (!currentFinishes.find(f => f.name.toUpperCase() === recipe.id.toUpperCase() || (f.code && f.code.toUpperCase() === recipe.id.toUpperCase()))) {
              currentFinishes.push({ id: `FIN-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, name: recipe.id.toUpperCase(), code: recipe.id.substring(0, 5).toUpperCase(), type: 'MIXED', textureUrl: '', status: 'Production Ready', clientMapping: [] });
              addedCount++;
          }
      });
      if (addedCount > 0) { await setDoc(doc(db, "system", "master_finishes"), { finishes: currentFinishes }, { merge: true }); alert(`Successfully synced ${addedCount} recipes!`); } else alert("HQ is in sync with floor database!");
  };

  const handleAddGlobalFinish = async () => {
      if (!newFinishConfig.name) return alert("Finish name required.");
      let updatedFinishes;
      
      if (editingGlobalFinish) {
          updatedFinishes = globalFinishes.map(f => f.id === editingGlobalFinish ? { 
              ...f, 
              name: newFinishConfig.name.toUpperCase(), 
              code: newFinishConfig.code.toUpperCase(), 
              type: newFinishConfig.type.toUpperCase(), 
              textureUrl: newFinishConfig.textureUrl,
              clientMapping: newFinishConfig.clientMapping || [] 
          } : f);
      } else {
          const newFinish = { id: `FIN-${Date.now()}`, name: newFinishConfig.name.toUpperCase(), code: newFinishConfig.code.toUpperCase(), type: newFinishConfig.type.toUpperCase(), textureUrl: newFinishConfig.textureUrl, status: 'Working', clientMapping: newFinishConfig.clientMapping || [] };
          updatedFinishes = [...globalFinishes, newFinish];
      }

      await setDoc(doc(db, "system", "master_finishes"), { finishes: updatedFinishes }, { merge: true });
      setNewFinishConfig({ name: '', code: '', type: '', textureUrl: '', clientMapping: [] }); 
      setShowFinishForm(false);
      setEditingGlobalFinish(null);
  };

  const handleEditGlobalFinish = (finish) => {
      setNewFinishConfig({
          name: finish.name,
          code: finish.code || '',
          type: finish.type || '',
          textureUrl: finish.textureUrl || '',
          clientMapping: finish.clientMapping || []
      });
      setEditingGlobalFinish(finish.id);
      setShowFinishForm(true);
  };
  
  const handleFinishTextureUpload = async (file, isOutsource = false) => {
      if (!file) return;
      const storageRef = ref(storage, `system_textures/TEX_${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);
      uploadTask.on("state_changed", (snap) => setFinishUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)), (err) => console.error(err),
          async () => { 
              const url = await getDownloadURL(uploadTask.snapshot.ref); 
              if (isOutsource) {
                  setNewOutsourceFinishConfig({ ...newOutsourceFinishConfig, textureUrl: url }); 
              } else {
                  setNewFinishConfig({ ...newFinishConfig, textureUrl: url }); 
              }
              setFinishUploadProgress(0); 
          }
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
      const safeId = editingOutsourceFinish || `FIN-${newOutsourceFinishConfig.name.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      await setDoc(doc(db, "hq_outsource_finishes", safeId), { 
          id: safeId, 
          legacyErpId: "PENDING", 
          name: newOutsourceFinishConfig.name.toUpperCase(), 
          description: newOutsourceFinishConfig.description || "", 
          multiplier: parseFloat(newOutsourceFinishConfig.multiplier) || 1.0, 
          vendor: newOutsourceFinishConfig.vendor || "",
          textureUrl: newOutsourceFinishConfig.textureUrl || "",
          clientMapping: newOutsourceFinishConfig.clientMapping || []
      }, { merge: true });

      setNewOutsourceFinishConfig({ name: '', description: '', multiplier: 1.0, vendor: '', textureUrl: '', clientMapping: [] }); 
      setShowOutsourceFinishForm(false);
      setEditingOutsourceFinish(null);
  };

  const handleEditOutsourceFinish = (finish) => {
      setNewOutsourceFinishConfig({
          name: finish.name,
          description: finish.description || '',
          multiplier: finish.multiplier || 1.0,
          vendor: finish.vendor || '',
          textureUrl: finish.textureUrl || '',
          clientMapping: finish.clientMapping || []
      });
      setEditingOutsourceFinish(finish.id);
      setShowOutsourceFinishForm(true);
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

  // Reusable styling objects
  const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {/* HEADER WITH TIERED INVENTORY TOGGLE */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>{inventory.length} Approved Records</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Master Library & Data Rules</h2>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          
          <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: 'var(--paper-2)', minWidth: '150px' }}>
              <option value="ALL">All Classes</option>
              <option value="INVENTORY">Raw Mat / Components (In-House)</option>
              <option value="OUTSOURCED">Outsourced Components</option>
              <optgroup label="Assemblies & Kits">
                  <option value="UNASSIGNED">Unassigned / Pending</option>
                  {(globalLists.assemblyTypes || []).map(type => (
                      <option key={type} value={type}>{type}</option>
                  ))}
              </optgroup>
          </select>
          
          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--paper-2)', padding: '12px 16px', border: '1px solid var(--line)', cursor: 'pointer' }}>
              <input type="checkbox" checked={isAdmin} onChange={() => setIsAdmin(!isAdmin)} /> Simulate Admin
          </label>
          
          <button onClick={handleCreateNewPart} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>+ New Record</button>
          
          {windowConfig.system.prodTypes?.includes(activeBrand) && (
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                  <option value="">All Categories</option>
                  {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
          )}

          {windowConfig.system.collections?.includes(activeBrand) && (
              <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                  <option value="">All Collections</option>
                  {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
          )}

          <input placeholder="Search Name, ERP, Bin..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '250px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        
        {/* LEFT LIST */}
        <div style={{ flex: activePart ? 1 : 1, display: 'grid', gridTemplateColumns: activePart ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px', alignContent: 'start' }}>
          {filteredInventory.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '24px', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No {partClassFilter === 'ALL' ? 'records' : partClassFilter} found in this category.</div>}
          {filteredInventory.map(part => {
            const specs = part.manufacturingSpecs || {};
            const isWatchlist = specs.watchList && specs.watchList !== "NONE" || (specs.customData?.watchlist && specs.customData.watchlist !== "NONE" && specs.customData.watchlist !== "N/A");
            const displayId = part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId;
            const isSharedIn = part.brandId !== activeBrand; 

            let classColor = 'var(--ink-soft)'; 
            if (part.partClass === 'Assembly') classColor = 'var(--ink)'; 
            if (part.partClass === 'Master Assembly') classColor = 'var(--brass)'; 

            return (
              <div key={part.id} onClick={() => openPartDetails(part)} style={{ background: '#fff', border: activePart?.id === part.id ? `1px solid ${classColor}` : '1px solid var(--line)', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activePart?.id === part.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                {isWatchlist && <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#d9534f', color: '#fff', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', zIndex: 2 }}>★ Watch</div>}
                {isSharedIn && <div style={{ position: 'absolute', top: '10px', left: '10px', background: 'var(--paper-2)', color: 'var(--ink)', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', zIndex: 2 }}>Shared from {part.brandId.toUpperCase()}</div>}

                <div style={{ height: '180px', background: 'var(--paper)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {part.finalImageUrl ? <img src={part.finalImageUrl} alt="Part" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>{part.manufacturingSpecs?.cadUrl ? '🧊 3D CAD' : 'No Image'}</span>}
                </div>

                <div style={{ padding: '20px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: classColor, marginBottom: '8px' }}>{displayId} <span style={{opacity: 0.6}}>({part.partClass})</span></div>
                  
                  {part.clientPricing && part.clientPricing.length > 0 && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink)', marginBottom: '4px' }}>
                          {part.clientPricing.length} Client Mapping(s)
                      </div>
                  )}
                  {specs.binLocation && (
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px' }}>
                          Bin: {specs.binLocation}
                      </div>
                  )}

                  <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, lineHeight: '1.4', color: 'var(--ink)', flex: 1 }}>{part.itemName}</div>
                  
                  {part.partClass === "Inventory" ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '16px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{specs.productType || "No Type"}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{specs.parametric?.length || 0}L × {specs.parametric?.width || 0}W</span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '16px' }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{part.project || 'No Project'}</span>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>{part.routingType || 'Unassigned'}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT EDIT PANEL */}
        {activePart && (
          <div style={{ flex: 1.5, background: '#fff', border: '1px solid var(--line)', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', position: 'sticky', top: '20px', maxHeight: '90vh', overflowY: 'auto', borderRadius: '2px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid var(--line)' }}>
              <div>
                  <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>{activePart.isNew ? `New ${partClassFilter} Setup` : (activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId)}</h3>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginTop: '4px', display: 'block' }}>{activePart.isNew ? "Define Master Details Below" : activePart.itemName}</span>
              </div>
              <button onClick={() => setActivePart(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '30px', display: 'flex', flexDirection: 'column', gap: '30px' }}>
              
              {activePart.partClass !== 'Inventory' && (
                  <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: '24px' }}>
                      <h4 style={sectionHeaderStyle}>Assembly Configuration</h4>
                      
                      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                          <input 
                              type="checkbox" 
                              checked={editSpecs.isProjectManaged || false} 
                              onChange={e => setEditSpecs({...editSpecs, isProjectManaged: e.target.checked})} 
                              style={{ cursor: 'pointer' }} 
                          />
                          <div>
                              <div style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500, color: 'var(--ink)' }}>Flag as Complex Project (Route to Project Mgmt)</div>
                              <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Checking this box ensures that when this product is quoted/ordered, it routes to the Project Management dashboard for multi-WO/PO dissection.</div>
                          </div>
                      </div>
                      
                      {activePart.revisions && activePart.revisions.length > 0 && (
                          <div style={{ marginBottom: '24px' }}>
                              <label style={labelStyle}>Revision Gallery ({activePart.revisions.length} Angles/Images)</label>
                              <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '12px' }}>
                                  {activePart.revisions.map((rev, idx) => (
                                      <div key={idx} style={{ flexShrink: 0, width: '100px', height: '100px', border: rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl ? '2px solid var(--brass)' : '1px solid var(--line)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                                          {rev.is3D || rev.name?.includes('3D') ? <span style={{fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)'}}>3D CAD</span> : <img src={rev.url} alt="Rev" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '4px' }} />}
                                          {(rev.url === activePart.finalImageUrl || rev.url === activePart.manufacturingSpecs?.cadUrl) && <div style={{ position: 'absolute', bottom: 0, width: '100%', background: 'var(--brass)', color: '#fff', fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', textAlign: 'center', letterSpacing: '.1em', padding: '2px 0' }}>Master</div>}
                                      </div>
                                  ))}
                              </div>
                          </div>
                      )}

                      {/* --- FILE CABINET FOR MASTER ASSEMBLIES --- */}
                      {activePart.partClass === 'Master Assembly' && (
                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px' }}>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '12px' }}>File Cabinet: {activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId}</div>
                              {activeBomPins.length === 0 ? (
                                  <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>↳ No nested components pinned yet. (Configure in Visual Assembly)</div>
                              ) : (
                                  activeBomPins.map(pin => (
                                      <div key={pin.id} style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span style={{ color: 'var(--ink-soft)' }}>↳</span> 
                                          <span><strong>{pin.defaultQty || 1}x</strong> {pin.partName} <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>[{pin.legacyErpId}]</span></span>
                                      </div>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              )}

              {/* --- CLONE SPECS ENGINE --- */}
              <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <label style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', display: 'block', marginBottom: '8px' }}>
                      Clone CPQ Attributes & Specs
                  </label>
                  <div style={{ display: 'flex', gap: '16px' }}>
                      <select value={cloneSourceId} onChange={(e) => setCloneSourceId(e.target.value)} style={fieldStyle}>
                          <option value="">-- Select Source Record --</option>
                          {inventory.filter(p => p.id !== activePart.id).map(p => (
                              <option key={p.id} value={p.id}>{p.legacyErpId && p.legacyErpId !== "PENDING" ? `[${p.legacyErpId}] ` : ''}{p.itemName}</option>
                          ))}
                      </select>
                      <button onClick={handleCloneSpecs} disabled={!cloneSourceId} style={{ padding: '0 24px', background: cloneSourceId ? 'var(--ink)' : 'transparent', color: cloneSourceId ? '#fff' : 'var(--ink-soft)', border: cloneSourceId ? 'none' : '1px solid var(--line)', cursor: cloneSourceId ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Clone Data</button>
                  </div>
              </div>

              <div>
                 <h4 style={sectionHeaderStyle}>Identification</h4>
                 
                 <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px', marginBottom: '24px' }}>
                     <div>
                         <label style={labelStyle}>Record Name / Description</label>
                         <input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activePart.itemName} onChange={handleSpecChange} style={fieldStyle} />
                     </div>
                     <div>
                         <label style={labelStyle}>ERP Legacy ID (Internal)</label>
                         <input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activePart.legacyErpId === "PENDING" ? "" : activePart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                     </div>
                 </div>

                 <div style={{ marginBottom: '30px' }}>
                     <label style={labelStyle}>Warehouse Bin Location (Barcode/Ref)</label>
                     <input name="binLocation" value={editSpecs.binLocation || ''} onChange={handleSpecChange} placeholder="e.g. A1-B2-04" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                     <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '6px' }}>Used by the Pick/Pack App to guide operators to the physical item location.</div>
                 </div>

                 <div style={{ background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)' }}>
                    <h4 style={{ margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Client-Specific Pricing & SKUs</h4>
                    
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', marginBottom: '24px' }}>
                        <div style={{ flex: 1.5 }}>
                            <label style={labelStyle}>Customer (Name - ID)</label>
                           <select value={newClientPricing.customerId} onChange={e => setNewClientPricing({...newClientPricing, customerId: e.target.value})} style={fieldStyle}>
                                <option value="">Select Customer...</option>
                                {liveCustomers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1.5 }}>
                            <label style={labelStyle}>Client SKU / Part #</label>
                            <input value={newClientPricing.clientSku} onChange={e => setNewClientPricing({...newClientPricing, clientSku: e.target.value})} placeholder="e.g. Brimar-8483" style={fieldStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={labelStyle}>Client Cost ($)</label>
                            <input type="number" step="0.01" value={newClientPricing.price} onChange={e => setNewClientPricing({...newClientPricing, price: e.target.value})} placeholder="0.00" style={fieldStyle} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={labelStyle}>Client Sales Price ($)</label>
                            <input type="number" step="0.01" value={newClientPricing.clientSalesPrice} onChange={e => setNewClientPricing({...newClientPricing, clientSalesPrice: e.target.value})} placeholder="0.00" style={fieldStyle} />
                        </div>
                        <button onClick={handleAddClientPricing} style={{ padding: '12px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Add</button>
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {(editSpecs.clientPricing || []).length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No custom client pricing assigned. Defaults to Base Price.</div>}
                        {(editSpecs.clientPricing || []).map((cp, idx) => (
                            <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff', border: '1px solid var(--line)', padding: '12px 16px' }}>
                                <div style={{ display: 'flex', gap: '24px', fontSize: '0.9rem', width: '100%', alignItems: 'center', color: 'var(--ink)' }}>
                                    <span style={{ fontWeight: 500, flex: 1 }}>{cp.customerId}</span>
                                    <span style={{ flex: 1, color: 'var(--ink-soft)' }}>SKU: <span style={{ color: 'var(--ink)' }}>{cp.clientSku || 'N/A'}</span></span>
                                    <span style={{ width: '100px', textAlign: 'right' }}>Cost: ${parseFloat(cp.price || 0).toFixed(2)}</span>
                                    <span style={{ fontWeight: 500, width: '120px', textAlign: 'right' }}>Sales: ${parseFloat(cp.clientSalesPrice || 0).toFixed(2)}</span>
                                </div>
                                <button onClick={() => handleRemoveClientPricing(idx)} style={{ background: 'none', border: 'none', color: '#d9534f', fontSize: '1.2rem', cursor: 'pointer', marginLeft: '16px' }}>×</button>
                            </div>
                        ))}
                    </div>
                 </div>

                 <div style={{ marginTop: '30px', background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                   <label style={labelStyle}>Record Visibility & Cross-Brand Sharing</label>
                   <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                     {AVAILABLE_BRANDS.map(brand => {
                        const isOwner = activePart.brandId === brand.id; const isShared = editSpecs.sharedBrands?.includes(brand.id);
                        return ( <label key={brand.id} style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: isOwner ? 'not-allowed' : 'pointer', opacity: isOwner ? 0.6 : 1, color: 'var(--ink)' }}><input type="checkbox" checked={isOwner || isShared} disabled={isOwner} onChange={() => handleBrandToggle(brand.id)} />{brand.name} {isOwner && "(Owner)"}</label> );
                     })}
                   </div>
                 </div>
              </div>

              {/* BRAND-AWARE CORE ATTRIBUTES */}
              <div>
                 <h4 style={sectionHeaderStyle}>Core Attributes</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                   
                   {windowConfig.system.prodTypes?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>Prod Type</label>
                           <select name="productType" value={editSpecs.productType || ""} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="">Select...</option>
                               {editSpecs.productType && !(globalLists.prodTypes || []).map(p=>p.toUpperCase()).includes(editSpecs.productType) && (
                                   <option value={editSpecs.productType}>⭐ {editSpecs.productType} (From ERP)</option>
                               )}
                               {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt.toUpperCase()}>{pt}</option>)}
                           </select>
                       </div>
                   )}

                   <div>
                       <label style={labelStyle}>{activePart.partClass === 'Inventory' ? 'Inventory Category' : 'Routing Classification'}</label>
                       <select name="routingType" value={editSpecs.routingType || ""} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                           <option value="">Unassigned</option>
                           {(activePart.partClass === 'Inventory' ? (globalLists.inventoryTypes || []) : (globalLists.assemblyTypes || [])).map(t => <option key={t} value={t}>{t}</option>)}
                       </select>
                   </div>
                   
                   <div>
                       <label style={labelStyle}>Project / Grouping</label>
                       <input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={fieldStyle} />
                   </div>

                   {windowConfig.system.partHandling?.includes(activeBrand) && (
                       <div><label style={labelStyle}>Part Handling</label><select name="partHandling" value={editSpecs.partHandling || ""} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}><option value="">Unassigned / Standard</option>{(globalLists.partHandling || []).map(ph => <option key={ph} value={ph}>{ph}</option>)}</select></div>
                   )}
                   
                   {windowConfig.system.uom?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>UOM</label>
                           <select name="uom" value={editSpecs.uom || "EA"} onChange={handleSpecChange} style={fieldStyle}>
                               {editSpecs.uom && !(globalLists.uom || []).map(u=>u.toUpperCase()).includes(editSpecs.uom) && (
                                   <option value={editSpecs.uom}>⭐ {editSpecs.uom} (From ERP)</option>
                               )}
                               {(globalLists.uom || []).map(u => <option key={u} value={u.toUpperCase()}>{u}</option>)}
                           </select>
                       </div>
                   )}

                   {windowConfig.system.collections?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2' }}>
                           <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                           <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                               {collectionsData.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined in Admin.</span>}
                               {collectionsData.map(c => {
                                   const isSelected = (editSpecs.collections || []).includes(c.name.toUpperCase());
                                   return (
                                       <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                           <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(c.name.toUpperCase())} style={{ display: 'none' }} />
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
                                   <input type="file" onChange={(e) => handleDynamicFileUpload(field.key, e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                                   {dynamicUploadProgress[field.key] > 0 && <progress value={dynamicUploadProgress[field.key]} max="100" style={{ width: '100%', marginTop: '8px' }} />}
                               </div>
                           ) : (
                               <input type={field.type} value={editSpecs.customData?.[field.key] || ""} onChange={(e) => handleCustomFieldChange(field.key, e.target.value)} style={fieldStyle} />
                           )}
                       </div>
                   ))}

                   {windowConfig.system.watchLists?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2' }}>
                           <label style={labelStyle}>Assign to Watchlist</label>
                           <select name="watchList" value={editSpecs.watchList || "NONE"} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="NONE">None</option>
                               {editSpecs.watchList && editSpecs.watchList !== "NONE" && !(globalLists.watchLists || []).map(w=>w.toUpperCase()).includes(editSpecs.watchList) && (
                                   <option value={editSpecs.watchList}>⭐ {editSpecs.watchList} (From ERP)</option>
                               )}
                               {(globalLists.watchLists || []).map(w => <option key={w} value={w.toUpperCase()}>{w}</option>)}
                           </select>
                       </div>
                   )}
                 </div>
              </div>

              <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)', marginTop: '10px' }}>
                  <h4 style={sectionHeaderStyle}>Hardware CPQ Metadata (Vision Engine)</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
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
                          <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                      </div>
                  </div>
              </div>

              {activePart.partClass === 'Inventory' && (
                  <div>
                    <h4 style={sectionHeaderStyle}>Logistics & Sourcing</h4>
                    
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                        <button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '12px', background: editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>In-House</button>
                        <button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '12px', background: !editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: !editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Outsourced</button>
                    </div>
                    
                    <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                      {editSpecs.isInHouse ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div><label style={labelStyle}>Program #</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Raw Mat</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                            <div>
                                <label style={labelStyle}>Vendor Name (From CRM)</label>
                                <select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={fieldStyle}>
                                    <option value="">Select Vendor...</option>
                                    {editSpecs.vendorName && !liveVendors.find(v => (v.name || '').toUpperCase() === editSpecs.vendorName.toUpperCase()) && (
                                        <option value={editSpecs.vendorName}>⭐ {editSpecs.vendorName} (From ERP)</option>
                                    )}
                                    {liveVendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                                </select>
                            </div>
                            <div><label style={labelStyle}>Vendor Part # / SKU</label><input name="vendorId" value={editSpecs.vendorId || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Purchase Link (URL)</label>{editSpecs.vendorUrl && <a href={editSpecs.vendorUrl.startsWith('http') ? editSpecs.vendorUrl : `https://${editSpecs.vendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline' }}>Open ↗</a>}</div>
                                <input name="vendorUrl" value={editSpecs.vendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                            </div>
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><label style={labelStyle}>Alt Item Link (URL)</label>{editSpecs.altVendorUrl && <a href={editSpecs.altVendorUrl.startsWith('http') ? editSpecs.altVendorUrl : `https://${editSpecs.altVendorUrl}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline' }}>Open ↗</a>}</div>
                                <input name="altVendorUrl" value={editSpecs.altVendorUrl || ""} onChange={handleSpecChange} placeholder="https://..." style={fieldStyle} />
                            </div>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                            <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>MOQ</label><input name="moq" type="number" value={editSpecs.moq || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Lead (Days)</label><input name="leadTime" type="number" value={editSpecs.leadTime || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                            <div><label style={labelStyle}>Reorder Pt (ROP)</label><input name="reorderPoint" type="number" value={editSpecs.reorderPoint || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', background: 'var(--paper)', padding: '24px', border: '1px solid var(--line)', marginTop: '20px' }}>
                      <div>
                          <label style={labelStyle}>Upload Print (PDF)</label>
                          {editSpecs.pdfUrl && <a href={editSpecs.pdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: '0.85rem', color: 'var(--ink)', textDecoration: 'underline', display: 'block', marginBottom: '10px' }}>View Current PDF</a>}
                          <input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                          {uploadProgress > 0 && <progress value={uploadProgress} max="100" style={{ width: '100%', marginTop: '8px' }}/>}
                      </div>
                      <div>
                          <label style={labelStyle}>3D CAD Model (.glb / .gltf)</label>
                          {editSpecs.cadUrl && <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: '10px' }}>✓ 3D Model Assigned</div>}
                          <input type="file" accept=".glb,.gltf" onChange={(e) => setCadFile(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} />
                          {cadUploadProgress > 0 && <progress value={cadUploadProgress} max="100" style={{ width: '100%', marginTop: '8px' }}/>}
                      </div>
                    </div>
                  </div>
              )}

              {/* GEOMETRY & CAD RULES */}
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

              <div style={{ display: 'flex', gap: '16px', marginTop: '20px' }}>
                <button onClick={savePartUpdates} style={{ flex: 2, padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease' }}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                </button>
                
                {hasErpWriteAccess && activePart.netSuiteInternalId && (
                    <button 
                        onClick={handlePushUpdatesToNetSuite} 
                        disabled={isPushingErp} 
                        style={{ flex: 1.5, padding: '16px', background: isPushingErp ? 'var(--paper)' : '#fff', color: isPushingErp ? 'var(--ink-soft)' : 'var(--ink)', border: '1px solid var(--ink)', cursor: isPushingErp ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.3s ease' }}
                    >
                        {isPushingErp ? "Syncing..." : "Write to ERP"}
                    </button>
                )}
                
  {!activePart.isNew && (
                    <button onClick={handleDeletePart} style={{ flex: 1, padding: '16px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>
                        Delete
                    </button>
                )}
              </div>

            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default LibraryTab;