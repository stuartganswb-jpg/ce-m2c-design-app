import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { mergeWindowConfig } from './systemWindows';
import { collection, onSnapshot, query, where, doc, setDoc, deleteDoc, getDocs, writeBatch } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";


const AVAILABLE_BRANDS = [
  { id: 'm2c', name: 'M2C Studio' },
  { id: 'uniquity', name: 'Uniquity' }, 
  { id: 'ce', name: 'Classical Elements' }, 
  { id: 'leyla', name: 'Leyla Gans' }
];

// DEFAULT_SYSTEM_WINDOWS + merge logic now live in ./systemWindows (single source of truth).

const LibraryTab = ({ currentUser, activeBrand, focusItemId, clearFocus }) => {
  const [isAdmin] = useState(true);

  const [inventory, setInventory] = useState([]);
  const [syncingThumbs, setSyncingThumbs] = useState(null);   // {done,total} while syncing, else null
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [partClassFilter, setPartClassFilter] = useState("ALL"); 
  const [collectionFilter, setCollectionFilter] = useState(""); 
  const [watchlistFilter, setWatchlistFilter] = useState(""); 
  
  const [customSchema, setCustomSchema] = useState([]);
  const [dynamicAssets, setDynamicAssets] = useState([]);
  const [collectionsData, setCollectionsData] = useState([]); 
  const [liveVendors, setLiveVendors] = useState([]); 
  const [liveCustomers, setLiveCustomers] = useState([]); 
  
  const [globalLists, setGlobalLists] = useState({ 
      uom: [], prodTypes: [], watchLists: [], vendors: [], outsourceActions: [],
      pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [], assemblyTypes: [],
      cpqRoutingTypes: [], customers: [], partHandling: [], inventoryTypes: [], projections: [],
      bracketMounts: [], feeTypes: []
  });
  
  const [windowConfig, setWindowConfig] = useState(mergeWindowConfig(null));
  const [activeBomPins, setActiveBomPins] = useState([]); 

  const [activePart, setActivePart] = useState(null);
  const [editSpecs, setEditSpecs] = useState({ customData: {}, dynamicDicts: {}, clientPricing: [], collections: [], bomRevision: "" }); 
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
  const [woTargetQty, setWoTargetQty] = useState(1); 

  const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

  useEffect(() => {
      if (!currentUser) return;
      const unsubUser = onSnapshot(collection(db, "hq_users"), (snap) => {
          const users = snap.docs.map(d => d.data());
          const me = users.find(u => u.name === currentUser);
          
          if (me && me.role) {
              onSnapshot(doc(db, "hq_config", "permissions"), (permSnap) => {
                  if (permSnap.exists()) setUserPerms(permSnap.data()[me.role] || []);
              });
          }
      });
      return () => unsubUser();
  }, [currentUser]);

  const hasErpWriteAccess = isAdmin || userPerms.includes("ERP_WRITE_BACK");

  useEffect(() => {
    const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
    const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()})))); 
    const unsubVendors = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "VENDOR")), snap => setLiveVendors(snap.docs.map(d => ({id: d.id, ...d.data()}))));
    
    const unsubCustomers = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "CUSTOMER")), snap => {
        const allCusts = snap.docs.map(d => ({id: d.id, ...d.data()}));
        setLiveCustomers(allCusts.filter(c => c.brandId === activeBrand || (c.sharedBrands && c.sharedBrands.includes(activeBrand))));
    });

    const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
      if (docSnap.exists()) {
          const data = docSnap.data();
          setGlobalLists({ 
              uom: data.uom || [], prodTypes: data.prodTypes || [], 
              watchLists: data.watchLists || [], vendors: data.vendors || [], outsourceActions: data.outsourceActions || [],
              pillowSizes: data.pillowSizes || [], fillTypes: data.fillTypes || [], flangeStyles: data.flangeStyles || [], 
              stitchTypes: data.stitchTypes || [], seamCounts: data.seamCounts || [], assemblyTypes: data.assemblyTypes || [],
              cpqRoutingTypes: data.cpqRoutingTypes || [], customers: data.customers || [], partHandling: data.partHandling || [], 
              inventoryTypes: data.inventoryTypes || [], projections: data.projections || [], bins: data.bins || [],
              bracketMounts: data.bracketMounts || [], feeTypes: data.feeTypes || []
          });
      }
    });

    const unsubWindowConfig = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
      setWindowConfig(mergeWindowConfig(docSnap.data()));
    });

    return () => { unsubSchema(); unsubAssets(); unsubCollections(); unsubLists(); unsubWindowConfig(); unsubVendors(); unsubCustomers(); };
  }, [activeBrand]);

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
      if (!activePart || (activePart.partClass !== 'Master Assembly' && activePart.partClass !== 'Assembly')) { 
          setActiveBomPins([]); 
          return; 
      }
      const q = query(collection(db, "assembly_pins"), where("assemblyId", "==", activePart.itemId));
      const unsubscribe = onSnapshot(q, (snapshot) => { setActiveBomPins(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))); });
      return () => unsubscribe();
  }, [activePart]);

  useEffect(() => {
      if (focusItemId && inventory.length > 0) {
          const partToFocus = inventory.find(p => p.id === focusItemId);
          if (partToFocus) {
              openPartDetails(partToFocus);
              if (clearFocus) clearFocus();
          }
      }
  }, [focusItemId, inventory, clearFocus]);

  const renderOptionFallback = (currentVal, optionsArray) => {
      const safeVal = String(currentVal || "").trim().toUpperCase();
      if (!safeVal || safeVal === "N/A" || safeVal === "UNASSIGNED" || safeVal === "NONE") return null;
      const safeArr = (optionsArray || []).map(o => String(o).trim().toUpperCase());
      if (!safeArr.includes(safeVal)) {
          return <option value={safeVal}>{currentVal} (Imported ERP Value)</option>;
      }
      return null;
  };

  const dynamicProdTypes = Array.from(new Set([
      ...(globalLists.prodTypes || []).map(p => p.toUpperCase()), 
      ...inventory.map(p => (p.productType || p.manufacturingSpecs?.productType || "").toUpperCase()).filter(Boolean)
  ])).sort();

  const dynamicCollections = Array.from(new Set([
      ...collectionsData.map(c => c.name.toUpperCase()), 
      ...inventory.flatMap(p => p.manufacturingSpecs?.collections ? p.manufacturingSpecs.collections.map(c => c.toUpperCase()) : (p.manufacturingSpecs?.customData?.collection && p.manufacturingSpecs.customData.collection !== 'N/A' ? [p.manufacturingSpecs.customData.collection.toUpperCase()] : []))
  ])).sort();

  const dynamicWatchlists = Array.from(new Set([
      ...(globalLists.watchLists || []).map(w => w.toUpperCase()), 
      ...inventory.map(p => {
          const specs = p.manufacturingSpecs || {};
          const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
          return specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
      }).filter(w => w !== "NONE")
  ])).sort();

  const dynamicUoms = Array.from(new Set([
      ...(globalLists.uom || []).map(u => u.toUpperCase()),
      ...inventory.map(p => (p.manufacturingSpecs?.uom || "").toUpperCase()).filter(Boolean)
  ])).sort();

  const dynamicVendors = Array.from(new Set([
      ...liveVendors.map(v => v.name.toUpperCase()),
      ...inventory.map(p => (p.manufacturingSpecs?.vendorName || "").toUpperCase()).filter(Boolean)
  ])).sort();

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

    const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
    const currentWatchList = specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
    let matchesWatchlist = watchlistFilter === "" || currentWatchList === watchlistFilter.toUpperCase();
    
    return matchesSearch && matchesType && matchesCollection && matchesClass && matchesWatchlist;
  });

  const openPartDetails = (part) => {
    setActivePart(part); setPdfFile(null); setCadFile(null); setDynamicUploadProgress({}); setCloneSourceId(""); setWoTargetQty(1);
    
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
        bomRevision: baseSpecs.bomRevision || "",
        project: part.project || "",
        collections: currentCollections, 
        routingType: part.routingType || "",
        productType: (part.productType || baseSpecs.productType || "").toUpperCase(),
        uom: (baseSpecs.uom || "EA").toUpperCase(),
        watchList: currentWatchList,
        isProjectManaged: baseSpecs.isProjectManaged || false,
        partHandling: baseSpecs.partHandling || "",
        weight: baseSpecs.weight || ""
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
        productType: prev.productType,
        bomRevision: prev.bomRevision || clonedSpecs.bomRevision,
        weight: prev.weight || clonedSpecs.weight
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

  // Sync Thumbnails: match library parts to Asset Gallery images by pattern + finish and set
  // finalImageUrl on any that are missing one. Part codes are "<pattern>/<finish>" (e.g.
  // "H1-138BE/P01"); assets store patternId + finishId. Finishes are normalised (the gallery
  // zero-pads — EP01 — while parts don't — EP1), so leading zeros are stripped on both sides.
  // Re-runnable: as new images are uploaded, re-run to fill more parts.
  const handleSyncThumbnails = async () => {
      const normFinish = (s) => String(s || '').toUpperCase().trim().replace(/^([A-Z]+)0*(\d+)$/, '$1$2');
      const split = (erp) => {
          const i = String(erp || '').indexOf('/');
          return i < 0 ? null : { pattern: erp.slice(0, i).toUpperCase().trim(), finish: normFinish(erp.slice(i + 1)) };
      };
      try {
          setSyncingThumbs({ done: 0, total: 0 });
          const snap = await getDocs(collection(db, "global_assets"));
          const assetMap = new Map();
          snap.docs.forEach(d => {
              const a = d.data();
              const img = a.thumbnailUrl || a.url || a.originalUrl;
              if (a.patternId && img) assetMap.set(`${String(a.patternId).toUpperCase().trim()}|${normFinish(a.finishId)}`, img);
          });

          // Parts in this brand that have no image yet and carry a pattern/finish code.
          const candidates = inventory.filter(p =>
              (p.brandId === activeBrand || (p.sharedBrands && p.sharedBrands.includes(activeBrand))) &&
              !p.finalImageUrl && p.legacyErpId && p.legacyErpId.includes('/'));

          const hits = [];
          candidates.forEach(p => {
              const k = split(p.legacyErpId);
              const img = k && assetMap.get(`${k.pattern}|${k.finish}`);
              if (img) hits.push({ id: p.id, img });
          });

          if (hits.length === 0) { setSyncingThumbs(null); return alert(`No new matches. Checked ${candidates.length} image-less part(s) against ${assetMap.size} gallery image(s).`); }

          // Commit in chunks (Firestore batch cap 500).
          let done = 0;
          for (let i = 0; i < hits.length; i += 400) {
              const chunk = hits.slice(i, i + 400);
              const batch = writeBatch(db);
              chunk.forEach(h => batch.update(doc(db, "Approved_Designs", h.id), { finalImageUrl: h.img }));
              await batch.commit();
              done += chunk.length;
              setSyncingThumbs({ done, total: hits.length });
          }
          setSyncingThumbs(null);
          alert(`✅ Synced ${hits.length} thumbnail(s) from the Asset Gallery (of ${candidates.length} image-less parts).`);
      } catch (e) { console.error(e); setSyncingThumbs(null); alert("Sync failed: " + (e.message || e)); }
  };

  const handleCreateNewPart = () => {
    const actualClass = partClassFilter === 'ALL' || partClassFilter === 'INVENTORY' || partClassFilter === 'OUTSOURCED' ? 'Inventory' : 'Assembly';
    const newId = `${activeBrand.toUpperCase()}-${actualClass === 'Inventory' ? 'INV' : 'ASM'}-${Math.floor(1000+Math.random()*9000)}`;
    
    setActivePart({ isNew: true, id: newId, itemId: newId, legacyErpId: "PENDING", itemName: `NEW ${actualClass.toUpperCase()}`, brandId: activeBrand, partClass: actualClass });
    setEditSpecs({ productType: "", uom: "EA", finishDetail: "", collections: [], project: "", routingType: "", assemblyType: "", watchList: "NONE", tempName: `NEW ${actualClass.toUpperCase()}`, tempLegacyId: "", clientPricing: [], bomRevision: "", binLocation: "", isInHouse: partClassFilter !== 'OUTSOURCED', programNum: "", material: "", layeringSequence: "10", vendorName: "", vendorId: "", vendorUrl: "", altVendorUrl: "", cost: "", leadTime: "", moq: "", weight: "", reorderPoint: "", sharedBrands: [activeBrand], customData: {}, dynamicDicts: {}, parametric: { isCutToSize: false, fixedDiameter: "", maxLength: "", widthOffset: "", cadProfile: "CYLINDER", length: "", width: "", height: "" }, isProjectManaged: false, partHandling: "" }); 
    setPdfFile(null); setCadFile(null); setCloneSourceId(""); setWoTargetQty(1);
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

          const payload = {
              itemid: editSpecs.tempLegacyId || activePart.legacyErpId,
              displayname: editSpecs.tempName || activePart.itemName,
              cost: parseFloat(editSpecs.cost) || 0,
              custitem9: parseFloat(editSpecs.basePrice) || 0
          };

          const pushWith = async (recordType) => {
              const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}/${nsId}`;
              const response = await fetch(FIREBASE_FUNCTION_URL, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ targetUrl, method: 'PATCH', payload })
              });
              const result = await response.json();
              return { ok: response.ok, result };
          };

          // partClass is the app's notion (Inventory vs Assembly), but the actual NetSuite record
          // type can differ — e.g. a part converted to an assembly code (FIRWW15) keeps partClass
          // 'Inventory' yet maps to a NetSuite assemblyitem. Prefer a previously-confirmed NS type,
          // else derive from partClass; on a type-mismatch NetSuite tells us the real type — retry
          // with it and remember it so future pushes go straight there.
          let recordType = activePart.netSuiteRecordType || (activePart.partClass === 'Inventory' ? 'inventoryitem' : 'assemblyitem');
          let { ok, result } = await pushWith(recordType);
          if (!ok) {
              const actual = JSON.stringify(result || '').match(/different type:\s*([a-z]+)/i)?.[1];
              if (actual && actual.toLowerCase() !== recordType) {
                  recordType = actual.toLowerCase();
                  ({ ok, result } = await pushWith(recordType));
              }
              if (!ok) throw new Error(JSON.stringify(result));
          }

          // Remember the confirmed record type so the retry isn't needed next time.
          if (activePart.netSuiteRecordType !== recordType) {
              try { await setDoc(doc(db, "Approved_Designs", activePart.id), { netSuiteRecordType: recordType }, { merge: true }); } catch (_) { /* non-fatal */ }
          }

          alert("✅ Successfully updated NetSuite ERP record!");
      } catch (error) {
          console.error("NetSuite Push Error:", error);
          alert(`❌ Failed to push to NetSuite. Check console for details.`);
      }
      setIsPushingErp(false);
  };

  const handleSyncShopRoutings = async () => {
      if (!window.confirm("Scan the Shop Floor database and import/update all machine routings and programs to HQ?")) return;

      try {
          const routingsSnap = await getDocs(collection(db, "shop_routings"));
          const programsSnap = await getDocs(collection(db, "shop_programs"));

          const programsMap = {};
          programsSnap.docs.forEach(d => programsMap[d.id] = d.data());

          let updatedCount = 0;
          const batch = writeBatch(db);

          routingsSnap.docs.forEach(routingDoc => {
              const rData = routingDoc.data();
              const targetPart = inventory.find(p => p.id === rData.partId || p.legacyErpId === rData.partId);

              if (targetPart) {
                  const bundledOps = rData.ops.map(op => {
                      const prog = programsMap[op.progId] || {};
                      return {
                          machine: op.machine,
                          progId: op.progId,
                          progName: prog.name || 'Unknown',
                          setupTime: prog.setupTime || 0,
                          timePerPiece: prog.timePerPiece || 0,
                          steps: prog.steps || ''
                      };
                  });

                  const hqRef = doc(db, "Approved_Designs", targetPart.id);
                  batch.update(hqRef, {
                      "manufacturingSpecs.shopRoutings": bundledOps
                  });
                  updatedCount++;
              }
          });

          await batch.commit();
          alert(`✅ Successfully synced ${updatedCount} Shop Routings to HQ Master Library!`);
      } catch (error) {
          console.error(error);
          alert("Sync Failed. Check console.");
      }
  };

  const handleGenerateWO = async () => {
      if (!activePart || activePart.legacyErpId === "PENDING") {
          return alert("Part must be saved with an ERP Legacy ID before generating a Work Order.");
      }
      if (!window.confirm(`Generate a Stock Build Work Order for ${woTargetQty}x ${activePart.legacyErpId}?`)) return;
      
      const newWoId = `WO-${activePart.legacyErpId}-${Date.now().toString().slice(-6)}`;
      
      try {
          await setDoc(doc(db, "hq_work_orders", newWoId), {
              id: newWoId,
              woId: newWoId,
              brand: activeBrand,
              status: "Approved", 
              customer: "Internal Stock",
              hqJobId: activePart.id, 
              totalParts: Number(woTargetQty),
              reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0], 
              type: "Stock Build",
              createdAt: Date.now()
          });
          alert(`✅ Work Order ${newWoId} successfully pushed to RTG Dispatch!`);
          setWoTargetQty(1); 
      } catch (err) {
          console.error("WO Generation Error:", err);
          alert("Failed to generate Work Order. Check console.");
      }
  };

  const fieldStyle = { width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' };
  const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };
  const sectionHeaderStyle = { margin: '0 0 20px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)', borderBottom: '1px solid var(--line)', paddingBottom: '10px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Master Library</h2>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', paddingLeft: '16px', borderLeft: '1px solid var(--line)' }}>{inventory.length} Approved Records</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          
          <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none', background: 'var(--paper-2)', minWidth: '150px' }}>
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
          
          <button onClick={handleCreateNewPart} style={{ padding: '10px 20px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>+ New Record</button>

          <button onClick={handleSyncThumbnails} disabled={!!syncingThumbs} title="Match image-less parts to Asset Gallery images by pattern + finish (e.g. H1-138BE / P01) and set their thumbnails. Re-runnable as you add images." style={{ padding: '10px 20px', background: syncingThumbs ? 'var(--ink-soft)' : 'var(--brass)', color: '#fff', border: 'none', cursor: syncingThumbs ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', whiteSpace: 'nowrap' }}>
              {syncingThumbs ? `⟳ Syncing ${syncingThumbs.done}/${syncingThumbs.total}` : '⟳ Sync Thumbnails'}
          </button>
          
          {windowConfig.system.prodTypes?.includes(activeBrand) && (
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                  <option value="">All Categories</option>
                  {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
              </select>
          )}

          {windowConfig.system.collections?.includes(activeBrand) && (
              <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                  <option value="">All Collections</option>
                  {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
          )}

          {windowConfig.system.watchLists?.includes(activeBrand) && (
              <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }}>
                  <option value="">All Watchlists</option>
                  <option value="NONE">None / Unassigned</option>
                  {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
              </select>
          )}

          <input placeholder="Search Name, ERP, Bin..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} style={{ width: '200px', padding: '10px 12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        
        <div style={{ flex: activePart ? 1 : 1, display: 'grid', gridTemplateColumns: activePart ? 'repeat(auto-fill, minmax(200px, 1fr))' : 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px', alignContent: 'start' }}>
          {filteredInventory.length === 0 && <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '24px', fontFamily: 'var(--serif)', fontSize: '1.2rem' }}>No {partClassFilter === 'ALL' ? 'records' : partClassFilter} found in this category.</div>}
          {filteredInventory.map(part => {
            const specs = part.manufacturingSpecs || {};
            const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
            const currentWatchList = specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
            const isWatchlist = currentWatchList !== "NONE";
            const displayId = part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId;
            const isSharedIn = part.brandId !== activeBrand; 

            let classColor = 'var(--ink-soft)'; 
            if (part.partClass === 'Assembly') classColor = 'var(--ink)'; 
            if (part.partClass === 'Master Assembly') classColor = 'var(--brass)'; 

            return (
              <div key={part.id} onClick={() => openPartDetails(part)} style={{ background: '#fff', border: activePart?.id === part.id ? `1px solid ${classColor}` : '1px solid var(--line)', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', boxShadow: activePart?.id === part.id ? '0 4px 12px rgba(0,0,0,0.05)' : 'none' }}>
                {isWatchlist && <div style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#d9534f', color: '#fff', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', zIndex: 2, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>★ {currentWatchList}</div>}
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

                      {(activePart.partClass === 'Master Assembly' || activePart.partClass === 'Assembly') && (
                          <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '20px' }}>
                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)', marginBottom: '12px' }}>File Cabinet: {activePart.legacyErpId !== "PENDING" ? activePart.legacyErpId : activePart.itemId}</div>
                              {activeBomPins.length === 0 ? (
                                  <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>↳ No nested components pinned yet. (Sync from ERP or drop pins in Visual Assembly)</div>
                              ) : (
                                  activeBomPins.map(pin => (
                                      <div key={pin.id} style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                          <span style={{ color: 'var(--ink-soft)' }}>↳</span> 
                                          <span><strong>{pin.defaultQty || 1}x</strong> {pin.partName || pin.partId}</span>
                                      </div>
                                  ))
                              )}
                          </div>
                      )}
                  </div>
              )}

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
                 
                 <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '20px', marginBottom: '24px' }}>
                     <div>
                         <label style={labelStyle}>Record Name / Description</label>
                         <input name="tempName" value={editSpecs.tempName !== undefined ? editSpecs.tempName : activePart.itemName} onChange={handleSpecChange} style={fieldStyle} />
                     </div>
                     <div>
                         <label style={labelStyle}>ERP Legacy ID (Internal)</label>
                         <input name="tempLegacyId" value={editSpecs.tempLegacyId !== undefined ? editSpecs.tempLegacyId : (activePart.legacyErpId === "PENDING" ? "" : activePart.legacyErpId)} onChange={handleSpecChange} placeholder="e.g. P-1234" style={{ ...fieldStyle, textTransform: 'uppercase' }} />
                     </div>
                     <div>
                         <label style={labelStyle}>BOM Revision</label>
                         <input name="bomRevision" value={editSpecs.bomRevision || ''} onChange={handleSpecChange} placeholder="N/A" style={fieldStyle} />
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

              <div>
                 <h4 style={sectionHeaderStyle}>Core Attributes</h4>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                   
                   {windowConfig.system.prodTypes?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>Prod Type</label>
                           <select name="productType" value={String(editSpecs.productType || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="">Select...</option>
                               {dynamicProdTypes.map(pt => <option key={pt} value={String(pt).toUpperCase()}>{pt}</option>)}
                               {renderOptionFallback(editSpecs.productType, dynamicProdTypes)}
                           </select>
                       </div>
                   )}

                   <div>
                       <label style={labelStyle}>{activePart.partClass === 'Inventory' ? 'Inventory Category' : 'Routing Classification'}</label>
                       <select name="routingType" value={String(editSpecs.routingType || "").toUpperCase()} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                           <option value="">Unassigned</option>
                           {(activePart.partClass === 'Inventory' ? (globalLists.inventoryTypes || []) : (globalLists.assemblyTypes || [])).map(t => <option key={t} value={String(t).toUpperCase()}>{t}</option>)}
                           {renderOptionFallback(editSpecs.routingType, activePart.partClass === 'Inventory' ? globalLists.inventoryTypes : globalLists.assemblyTypes)}
                       </select>
                   </div>
                   
                   <div>
                       <label style={labelStyle}>Project / Grouping</label>
                       <input name="project" value={editSpecs.project || ""} onChange={handleSpecChange} style={fieldStyle} />
                   </div>

                   {windowConfig.system.partHandling?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>Part Handling</label>
                           <select name="partHandling" value={String(editSpecs.partHandling || "").toUpperCase()} onChange={handleSpecChange} style={{ ...fieldStyle, textTransform: 'uppercase' }}>
                               <option value="">Unassigned / Standard</option>
                               {(globalLists.partHandling || []).map(ph => <option key={ph} value={String(ph).toUpperCase()}>{ph}</option>)}
                               {renderOptionFallback(editSpecs.partHandling, globalLists.partHandling)}
                           </select>
                       </div>
                   )}
                   
                   {windowConfig.system.uom?.includes(activeBrand) && (
                       <div>
                           <label style={labelStyle}>UOM</label>
                           <select name="uom" value={String(editSpecs.uom || "EA").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               {dynamicUoms.map(u => <option key={u} value={String(u).toUpperCase()}>{u}</option>)}
                               {renderOptionFallback(editSpecs.uom, dynamicUoms)}
                           </select>
                       </div>
                   )}

                   {windowConfig.system.collections?.includes(activeBrand) && (
                       <div style={{ gridColumn: 'span 2' }}>
                           <label style={labelStyle}>Collections (Multi-Select for CPQ)</label>
                           <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', padding: '16px', border: '1px solid var(--line)', background: 'var(--paper)', maxHeight: '150px', overflowY: 'auto' }}>
                               {dynamicCollections.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No collections defined.</span>}
                               {dynamicCollections.map(cName => {
                                   const isSelected = (editSpecs.collections || []).includes(cName);
                                   return (
                                       <label key={cName} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', background: isSelected ? 'var(--ink)' : '#fff', color: isSelected ? '#fff' : 'var(--ink)', border: `1px solid ${isSelected ? 'var(--ink)' : 'var(--line)'}`, padding: '6px 14px', borderRadius: '20px', transition: 'all 0.2s' }}>
                                           <input type="checkbox" checked={isSelected} onChange={() => handleToggleCollection(cName)} style={{ display: 'none' }} />
                                           {cName}
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
                       <div>
                           <label style={labelStyle}>Outsource Action</label>
                           <select name="outsourceAction" value={String(editSpecs.outsourceAction || "").toUpperCase()} onChange={handleSpecChange} style={fieldStyle}>
                               <option value="">Select...</option>
                               {(globalLists.outsourceActions || []).map(x => <option key={x} value={String(x).toUpperCase()}>{x}</option>)}
                               {renderOptionFallback(editSpecs.outsourceAction, globalLists.outsourceActions)}
                           </select>
                       </div>
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
                               {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
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
                          <select value={String(editSpecs.customData?.projection || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("projection", e.target.value)} style={fieldStyle}>
                              <option value="">-- No Projection / Not Bracket --</option>
                              {(globalLists.projections || []).map(p => <option key={p} value={String(p).toUpperCase()}>{p}" Projection</option>)}
                              {renderOptionFallback(editSpecs.customData?.projection, globalLists.projections)}
                          </select>
                      </div>
                      <div>
                          <label style={labelStyle}>Bracket Mount Type</label>
                          <select value={String(editSpecs.customData?.bracketType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("bracketType", e.target.value)} style={fieldStyle}>
                              <option value="">-- Not a Bracket --</option>
                              {(globalLists.bracketMounts || []).map(m => <option key={m} value={String(m).toUpperCase()}>{m}</option>)}
                              {renderOptionFallback(editSpecs.customData?.bracketType, globalLists.bracketMounts)}
                          </select>
                      </div>
                      <div style={{ gridColumn: 'span 2', display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '6px 0' }}>
                          <input type="checkbox" checked={!!editSpecs.customData?.isReturnBracket} onChange={(e) => handleCustomFieldChange("isReturnBracket", e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer', marginTop: '2px', flexShrink: 0 }} />
                          <div>
                              <label style={labelStyle}>Is Return Bracket (End-Return)</label>
                              <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '2px' }}>Sits right at the pole end and its width adds to the O2O. End-return brackets are the only ones placed at the very end — and they're never offered as a center support. (e.g. FIWERA, FICERA)</div>
                          </div>
                      </div>
                      {!!editSpecs.customData?.isReturnBracket && (
                          <div>
                              <label style={labelStyle}>Bracket Arm Thickness (in)</label>
                              <input type="number" step="0.125" value={editSpecs.customData?.armThickness ?? ''} onChange={(e) => handleCustomFieldChange("armThickness", e.target.value)} placeholder="e.g. 0.5 (½&quot; flat-iron)" style={fieldStyle} />
                              <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Adds to the O2O on each return end, on top of the half-backplate.</div>
                          </div>
                      )}
                      {(editSpecs.productType || '').toUpperCase().includes('BACKPLATE') && (
                          <div>
                              <label style={labelStyle}>Backplate Orientation (drives O2O)</label>
                              <select value={String(editSpecs.customData?.bpOrientation || 'VERTICAL').toUpperCase()} onChange={(e) => handleCustomFieldChange("bpOrientation", e.target.value)} style={fieldStyle}>
                                  <option value="VERTICAL">Vertical — Width is along the pole (½ Width / side)</option>
                                  <option value="HORIZONTAL">Horizontal — Length is along the pole (½ Length / side)</option>
                                  <option value="SQUARE">Square — Width = Height (½ Width / side)</option>
                                  <option value="ROUND">Round — Diameter (½ Diameter / side)</option>
                              </select>
                              <div style={{ fontSize: '0.78rem', color: 'var(--ink-soft)', marginTop: '4px' }}>O2O uses the Geometry dimension along the pole — <strong>Vertical → ½ Width</strong> · <strong>Horizontal → ½ Length</strong> · <strong>Square → ½ Width</strong> · <strong>Round → ½ Diameter (Width)</strong>. Set L / W / H in “Geometry &amp; Z-Index Rules” above.</div>
                          </div>
                      )}
                      <div style={{ gridColumn: 'span 2' }}>
                          <label style={labelStyle}>Service / Fee Type (Auto-Append)</label>
                          <select value={String(editSpecs.customData?.feeType || "").toUpperCase()} onChange={(e) => handleCustomFieldChange("feeType", e.target.value)} style={fieldStyle}>
                              <option value="">-- No Special Fee --</option>
                              {(globalLists.feeTypes || []).map(f => <option key={f} value={String(f).toUpperCase()}>{f}</option>)}
                              {renderOptionFallback(editSpecs.customData?.feeType, globalLists.feeTypes)}
                          </select>
                          <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', display: 'block', marginTop: '6px' }}>If selected, the Vision System will automatically bill for this item when triggered.</span>
                      </div>
                  </div>
              </div>

              <div>
                <h4 style={sectionHeaderStyle}>Logistics, Sourcing & Pricing</h4>
                
                <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                    <button onClick={() => setEditSpecs({...editSpecs, isInHouse: true})} style={{ flex: 1, padding: '12px', background: editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>In-House</button>
                    <button onClick={() => setEditSpecs({...editSpecs, isInHouse: false})} style={{ flex: 1, padding: '12px', background: !editSpecs.isInHouse ? 'var(--ink)' : 'transparent', color: !editSpecs.isInHouse ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>Outsourced</button>
                </div>
                
                <div style={{ background: 'var(--paper-2)', padding: '24px', border: '1px solid var(--line)' }}>
                  {editSpecs.isInHouse ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <div><label style={labelStyle}>Program #</label><input name="programNum" value={editSpecs.programNum || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Raw Mat</label><input name="material" value={editSpecs.material || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Weight (lbs)</label><input name="weight" type="number" step="0.01" value={editSpecs.weight || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Reorder Pt (ROP)</label><input name="reorderPoint" type="number" value={editSpecs.reorderPoint || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }}>
                        <div>
                            <label style={labelStyle}>Vendor Name (From CRM)</label>
                            <select name="vendorName" value={editSpecs.vendorName || ""} onChange={handleSpecChange} style={fieldStyle}>
                                <option value="">Select Vendor...</option>
                                {dynamicVendors.map(v => <option key={v} value={v}>{v}</option>)}
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
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                        <div><label style={labelStyle}>Base Price ($)</label><input name="basePrice" type="number" step="0.01" value={editSpecs.basePrice || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Base Cost ($)</label><input name="cost" type="number" step="0.01" value={editSpecs.cost || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
                        <div><label style={labelStyle}>Weight (lbs)</label><input name="weight" type="number" step="0.01" value={editSpecs.weight || ""} onChange={handleSpecChange} style={fieldStyle} /></div>
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

              {activePart.partClass !== 'Master Assembly' && (
                  <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '24px', marginBottom: '30px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                      <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                          Generate Production Work Order
                      </h4>
                      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end' }}>
                          <div style={{ flex: 1 }}>
                              <label style={labelStyle}>Target Qty</label>
                              <input 
                                  type="number" 
                                  min="1"
                                  value={woTargetQty} 
                                  onChange={e => setWoTargetQty(e.target.value)} 
                                  style={fieldStyle} 
                              />
                          </div>
                          <button 
                              onClick={handleGenerateWO}
                              style={{ flex: 2, padding: '12px 24px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                          >
                              Push to RTG Dispatch
                          </button>
                      </div>
                      <span style={{ display: 'block', marginTop: '12px', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>
                          This generates an "Approved" Stock Build WO and sends it directly to Tab 13 (RTG Dispatch).
                      </span>
                  </div>
              )}

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

              <div style={{ display: 'flex', gap: '16px', marginTop: '20px', flexWrap: 'wrap' }}>
                <button onClick={savePartUpdates} style={{ flex: 2, padding: '16px', background: isSaving ? 'var(--brass-light)' : 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease', minWidth: '200px' }}>
                    {isSaving ? "Saving..." : "Save Configuration"}
                </button>
                
                {hasErpWriteAccess && activePart.netSuiteInternalId && (
                    <button 
                        onClick={handlePushUpdatesToNetSuite} 
                        disabled={isPushingErp} 
                        style={{ flex: 1.5, padding: '16px', background: isPushingErp ? 'var(--paper)' : '#fff', color: isPushingErp ? 'var(--ink-soft)' : 'var(--ink)', border: '1px solid var(--ink)', cursor: isPushingErp ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.3s ease', minWidth: '150px' }}
                    >
                        {isPushingErp ? "Syncing..." : "Write to ERP"}
                    </button>
                )}
                
                {!activePart.isNew && (
                    <button onClick={handleDeletePart} style={{ flex: 1, padding: '16px', background: 'transparent', color: '#d9534f', border: '1px solid #d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s', minWidth: '120px' }} onMouseOver={e => { e.currentTarget.style.background = '#d9534f'; e.currentTarget.style.color = '#fff'; }} onMouseOut={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d9534f'; }}>
                        Delete
                    </button>
                )}
              </div>
             <div style={{ marginTop: '20px' }}>
                <button 
                    onClick={handleSyncShopRoutings} 
                    style={{ width: '100%', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--line)', padding: '16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                    onMouseOver={e => { e.currentTarget.style.background = 'var(--paper-2)'; }} 
                    onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                    Sync Shop Routings
                </button>
              </div>

            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default LibraryTab;