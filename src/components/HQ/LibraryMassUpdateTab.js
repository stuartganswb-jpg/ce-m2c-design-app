import React, { useState, useEffect } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, writeBatch, doc, setDoc, deleteDoc, updateDoc, where } from "firebase/firestore";
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
  projections: ['ce', 'm2c', 'uniquity', 'leyla'],
  bins: ['ce', 'm2c', 'uniquity', 'leyla'],
  bracketMounts: ['ce', 'm2c', 'uniquity', 'leyla'], 
  feeTypes: ['ce', 'm2c', 'uniquity', 'leyla']      
};

const LIST_LABELS = {
    prodTypes: 'PRODUCT TYPES', uom: 'UOMs',
    watchLists: 'WATCHLISTS', vendors: 'APPROVED VENDORS', outsourceActions: 'OUTSOURCE ACTIONS',
    pillowSizes: 'PILLOW SIZES', fillTypes: 'FILL TYPES', flangeStyles: 'EDGE / FLANGE STYLES', 
    stitchTypes: 'STITCH ROUTING', seamCounts: 'SEAM COUNTS / UPCHARGES', assemblyTypes: 'ASSEMBLY TYPES',
    customers: 'CUSTOMERS / DEALERS (Format: Name - ID)', 
    partHandling: 'PART HANDLING & ROUTING', 
    inventoryTypes: 'RAW MATERIAL - INVENTORY ITEMS',
    projections: 'BRACKET PROJECTIONS',
    bins: 'WAREHOUSE BIN LOCATIONS',
    bracketMounts: 'BRACKET MOUNT TYPES', 
    feeTypes: 'SERVICE / FEE TYPES'      
};

const LibraryMassUpdateTab = ({ currentUser, activeBrand }) => {
    // --- MASS UPDATE STATE ---
    const [inventory, setInventory] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [routingFilter, setRoutingFilter] = useState("ALL");
    const [typeFilter, setTypeFilter] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("");
    const [watchlistFilter, setWatchlistFilter] = useState("");
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState(0);

    // CSV IMPORT STATE
    const [csvFile, setCsvFile] = useState(null);
    const [isProcessingCsv, setIsProcessingCsv] = useState(false);
    const [csvProgress, setCsvProgress] = useState(0);

    const [updates, setUpdates] = useState({
        productType: { active: false, value: "" },
        routingType: { active: false, value: "" },
        uom: { active: false, value: "EA" },
        watchList: { active: false, value: "NONE" },
        project: { active: false, value: "" },
        isInHouse: { active: false, value: true },
        partHandling: { active: false, value: "" },
        collection: { active: false, value: "" },
        vendorName: { active: false, value: "" },
        outsourceAction: { active: false, value: "" },
        pillowSize: { active: false, value: "" },
        fillType: { active: false, value: "" },
        flangeStyle: { active: false, value: "" },
        stitchType: { active: false, value: "" },
        seamCount: { active: false, value: "" },
        projection: { active: false, value: "" },
        basePrice: { active: false, value: "" },
        cost: { active: false, value: "" },
        weight: { active: false, value: "" },
        programNum: { active: false, value: "" },
        material: { active: false, value: "" },
        moq: { active: false, value: "" },
        leadTime: { active: false, value: "" },
        reorderPoint: { active: false, value: "" },
        binLocation: { active: false, value: "" }
    });

    // --- SYSTEM DICTIONARY STATE ---
    const [adminBrandFilter, setAdminBrandFilter] = useState(activeBrand);
    const [showAdminDashboard, setShowAdminDashboard] = useState(false);
    
    const [globalLists, setGlobalLists] = useState({ 
        prodTypes: [], uom: [], watchLists: [], assemblyTypes: [], inventoryTypes: [], 
        partHandling: [], collections: [], vendors: [], outsourceActions: [],
        pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [],
        projections: [], cpqRoutingTypes: [], customers: [], bins: [],
        bracketMounts: [], feeTypes: [] 
    });
    
    const [collectionsData, setCollectionsData] = useState([]);
    const [windowConfig, setWindowConfig] = useState({ system: DEFAULT_SYSTEM_WINDOWS, custom: [] });
    const [customSchema, setCustomSchema] = useState([]);
    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [dynamicAssets, setDynamicAssets] = useState([]);
    const [liveVendors, setLiveVendors] = useState([]); 
    const [liveCustomers, setLiveCustomers] = useState([]); 
    const [activeRecipes, setActiveRecipes] = useState([]); 
    const [floorRecipeData, setFloorRecipeData] = useState([]); 

    const [newListItems, setNewListItems] = useState({});
    
    // 🚀 RESTORED MISSING DICTIONARY STATE FOR THE BOTTOM UI
    const [newDictInput, setNewDictItem] = useState({ prodTypes: "", watchLists: "", collections: "" });

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

    // --- DATA FETCHING ---
    useEffect(() => { setAdminBrandFilter(activeBrand); }, [activeBrand]);

    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"));
        const unsub = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            docs.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));
            setInventory(docs);
        });
        return () => unsub();
    }, [activeBrand]);

    useEffect(() => {
        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
            if (docSnap.exists()) setGlobalLists(prev => ({ ...prev, ...docSnap.data() }));
        });
        const unsubCols = onSnapshot(collection(db, "hq_collections"), snap => setCollectionsData(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
        const unsubWin = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
            if (docSnap.exists()) setWindowConfig({ system: { ...DEFAULT_SYSTEM_WINDOWS, ...(docSnap.data().system || {}) }, custom: docSnap.data().custom || [] });
        });
        const unsubSchema = onSnapshot(doc(db, "system", "master_schema"), (docSnap) => { if (docSnap.exists() && docSnap.data().inventoryFields) setCustomSchema(docSnap.data().inventoryFields); });
        const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => { if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes); });
        const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        const unsubAssets = onSnapshot(collection(db, "hq_dynamic_data"), snap => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        const unsubVendors = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "VENDOR")), snap => setLiveVendors(snap.docs.map(d => ({id: d.id, ...d.data()}))));
        
        const unsubCustomers = onSnapshot(query(collection(db, "crm_records"), where("type", "==", "CUSTOMER")), snap => {
            const allCusts = snap.docs.map(d => ({id: d.id, ...d.data()}));
            setLiveCustomers(allCusts.filter(c => c.brandId === activeBrand || (c.sharedBrands && c.sharedBrands.includes(activeBrand))));
        });
        
        const unsubRecipes = onSnapshot(collection(db, "fin_recipes"), (snap) => { setActiveRecipes(snap.docs.map(d => d.id)); setFloorRecipeData(snap.docs.map(d => ({ id: d.id, ...d.data() }))); });

        return () => { unsubLists(); unsubCols(); unsubWin(); unsubSchema(); unsubFinishes(); unsubOutsource(); unsubAssets(); unsubVendors(); unsubCustomers(); unsubRecipes(); };
    }, [activeBrand]);

    // 🚀 RESTORED MISSING HANDLERS FOR THE BOTTOM UI
    const handleAddMasterListItem = async (listKey) => {
        const value = newDictInput[listKey]?.trim();
        if (!value) return;
        const currentList = globalLists[listKey] || [];
        if (currentList.includes(value)) return alert("Item already exists.");
        await setDoc(doc(db, "system", "master_lists"), { [listKey]: [...currentList, value] }, { merge: true });
        setNewDictItem(prev => ({ ...prev, [listKey]: "" }));
    };

    const handleRemoveMasterListItem = async (listKey, value) => {
        if (!window.confirm(`Remove ${value} from ${listKey}?`)) return;
        const currentList = globalLists[listKey] || [];
        await setDoc(doc(db, "system", "master_lists"), { [listKey]: currentList.filter(i => i !== value) }, { merge: true });
    };

    const handleQuickAddCollection = async () => {
        const value = newDictInput.collections?.trim().toUpperCase();
        if (!value) return;
        const safeId = `COL_${Date.now()}`;
        await setDoc(doc(db, "hq_collections", safeId), { id: safeId, name: value, allowedCustomers: [], allowedFinishes: [] });
        setNewDictItem(prev => ({ ...prev, collections: "" }));
    };

    const handleQuickDeleteCollection = async (id, name) => {
        if (!window.confirm(`Permanently delete collection: ${name}?`)) return;
        await deleteDoc(doc(db, "hq_collections", id));
    };

    // 🚀 DYNAMIC ARRAYS FOR DROPDOWNS
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

    // 🚀 SYNC ERP DATA TO DICTIONARIES
    const handleSyncDictionaries = async () => {
        if (!window.confirm("Scan inventory for unmapped Product Types, Watchlists, and Collections to permanently add them to your Master Dictionaries?")) return;

        let newProdTypes = new Set(globalLists.prodTypes || []);
        let newWatchLists = new Set(globalLists.watchLists || []);
        let currentCollections = collectionsData.map(c => c.name.toUpperCase());
        let colsToAdd = new Set();

        inventory.forEach(part => {
            const specs = part.manufacturingSpecs || {};
            
            const pType = (specs.productType || part.productType || "").trim().toUpperCase();
            if (pType && !newProdTypes.has(pType)) newProdTypes.add(pType);

            const wl = (specs.watchList || specs.customData?.watchlist || "").trim().toUpperCase();
            if (wl && wl !== 'NONE' && wl !== 'N/A' && !newWatchLists.has(wl)) newWatchLists.add(wl);

            const partCols = specs.collections || [];
            if (specs.customData?.collection && specs.customData.collection !== 'N/A') partCols.push(specs.customData.collection);
            if (specs.collection && specs.collection !== 'N/A') partCols.push(specs.collection);
            
            partCols.forEach(c => {
                const cName = c.trim().toUpperCase();
                if (cName && !currentCollections.includes(cName)) {
                    colsToAdd.add(cName);
                }
            });
        });

        // Update master_lists
        const updatedLists = {
            ...globalLists,
            prodTypes: Array.from(newProdTypes),
            watchLists: Array.from(newWatchLists)
        };
        await setDoc(doc(db, "system", "master_lists"), updatedLists, { merge: true });

        // Add missing collections
        const colPromises = Array.from(colsToAdd).map(cName => {
            const safeId = `COL_${Date.now()}_${Math.random().toString(36).substring(2,7)}`;
            return setDoc(doc(db, "hq_collections", safeId), { id: safeId, name: cName, allowedCustomers: [], allowedFinishes: [] });
        });
        
        if (colPromises.length > 0) {
            await Promise.all(colPromises);
        }

        alert("✅ Dictionaries synced successfully with ERP data!");
    };


    // --- CSV BULK UPLOAD & MAPPING LOGIC ---
    const handleDownloadCsvTemplate = () => {
        const headers = [
            "ID (DO NOT EDIT)", "Legacy ERP ID", "Item Name", "Brand", "Part Class", "Routing Type", 
            "Product Type (Category)", "Collection", "Watchlist", "UOM", "Part Handling", "Outsource Action", "Bracket Projection",
            "Weight", "Base Price", "Cost", "Reorder Pt (ROP)", "Lead Time (Days)", "Vendor Name", "Vendor SKU", "Bin Location", "Is In-House (TRUE/FALSE)"
        ];

        let csvContent = headers.join(",") + "\n";

        // Export what's selected; if nothing is checked, export the current filtered view;
        // only fall back to the whole library when no selection, search, or filter is active.
        const exportRows = selectedIds.size > 0
            ? inventory.filter(p => selectedIds.has(p.id))
            : (anyFilterActive ? filteredInventory : inventory);
        if (exportRows.length === 0) return alert("Nothing to export — select rows, or set a search/filter first.");

        exportRows.forEach(part => {
            const specs = part.manufacturingSpecs || {};
            const cust = specs.customData || {};
            
            const legacyCollection = specs.collection && specs.collection !== 'N/A' ? specs.collection : "";
            const currentCollection = specs.collections && specs.collections.length > 0 ? specs.collections.join(';') : (cust.collection && cust.collection !== 'N/A' ? cust.collection : legacyCollection);
            
            const watchList = specs.watchList && specs.watchList !== 'NONE' ? specs.watchList : (cust.watchlist && cust.watchlist !== 'N/A' ? cust.watchlist : "");

            const row = [
                part.id, 
                part.legacyErpId || part.itemId || "",
                part.itemName || "",
                part.brandId || "",
                part.partClass || "",
                part.routingType || "",
                specs.productType || "",
                currentCollection,
                watchList,
                specs.uom || "",
                specs.partHandling || "",
                specs.outsourceAction || "",
                cust.projection || "",
                specs.weight || "",
                specs.basePrice || "",
                specs.cost || "",
                specs.reorderPoint || "",
                specs.leadTime || "",
                specs.vendorName || "",
                specs.vendorId || "",
                specs.binLocation || "",
                specs.isInHouse !== false ? "TRUE" : "FALSE"
            ];
            
            csvContent += row.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Mass_Update_Template_${activeBrand}.csv`);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const handleProcessCsv = async () => {
        if (!csvFile) return alert("Please select a CSV file first.");
        if (!window.confirm("WARNING: This will overwrite data in your database based on the uploaded file. Proceed?")) return;

        setIsProcessingCsv(true);
        setCsvProgress(0);

        try {
            const text = await csvFile.text();
            
            const rows = text.split('\n').map(row => {
                const matches = row.match(/(\\.|[^",\s]+|"(?:\\.|[^\\"])*")/g) || [];
                return matches.map(m => m.replace(/^"|"$/g, '').replace(/""/g, '"'));
            });

            if (rows.length < 2) throw new Error("File is empty or invalid.");

            const headers = rows[0].map(h => h.trim());
            if (!headers.includes("Legacy ERP ID")) throw new Error("Missing 'Legacy ERP ID' column.");

            const dataRows = rows.slice(1).filter(r => r.length > 0 && r[0]); 
            
            let batch = writeBatch(db);
            let opCount = 0;
            let totalUpdated = 0;

            for (let i = 0; i < dataRows.length; i++) {
                const row = dataRows[i];
                
                const docId = headers.includes("ID (DO NOT EDIT)") ? row[headers.indexOf("ID (DO NOT EDIT)")] : null;
                const erpId = row[headers.indexOf("Legacy ERP ID")];
                if (!docId && !erpId) continue;

                const targetPart = docId ? inventory.find(p => p.id === docId) : inventory.find(p => p.legacyErpId === erpId || p.itemId === erpId);
                if (!targetPart) continue;

                const ref = doc(db, "Approved_Designs", targetPart.id);
                
                const getVal = (col) => {
                    const idx = headers.indexOf(col);
                    return idx > -1 ? row[idx] : null;
                };

                const specs = targetPart.manufacturingSpecs || {};
                const customData = specs.customData || {};

                const payload = {};
                
                const pType = getVal("Product Type (Category)"); if(pType !== null) { payload.productType = pType; payload["manufacturingSpecs.productType"] = pType; }
                const rType = getVal("Routing Type"); if(rType !== null) { payload.routingType = rType.toUpperCase(); payload["manufacturingSpecs.routingType"] = rType.toUpperCase(); }
                const uom = getVal("UOM"); if(uom !== null) { payload["manufacturingSpecs.uom"] = uom.toUpperCase(); }
                const bin = getVal("Bin Location"); if(bin !== null) { payload["manufacturingSpecs.binLocation"] = bin.toUpperCase(); }
                const vName = getVal("Vendor Name"); if(vName !== null) { payload["manufacturingSpecs.vendorName"] = vName; }
                const vSku = getVal("Vendor SKU"); if(vSku !== null) { payload["manufacturingSpecs.vendorId"] = vSku; }
                const wl = getVal("Watchlist"); if(wl !== null) { payload["manufacturingSpecs.watchList"] = wl.toUpperCase(); }
                const ph = getVal("Part Handling"); if(ph !== null) { payload["manufacturingSpecs.partHandling"] = ph; }
                const outAct = getVal("Outsource Action"); if(outAct !== null) { payload["manufacturingSpecs.outsourceAction"] = outAct; }
                
                const w = getVal("Weight"); if(w !== null) { payload["manufacturingSpecs.weight"] = w === "" ? "" : parseFloat(w); }
                const bp = getVal("Base Price"); if(bp !== null) { payload["manufacturingSpecs.basePrice"] = bp === "" ? "" : parseFloat(bp); }
                const c = getVal("Cost"); if(c !== null) { payload["manufacturingSpecs.cost"] = c === "" ? "" : parseFloat(c); }
                const lt = getVal("Lead Time (Days)"); if(lt !== null) { payload["manufacturingSpecs.leadTime"] = lt === "" ? "" : parseFloat(lt); }
                const rop = getVal("Reorder Pt (ROP)"); if(rop !== null) { payload["manufacturingSpecs.reorderPoint"] = rop === "" ? "" : parseFloat(rop); }
                const proj = getVal("Bracket Projection"); if(proj !== null) { payload["manufacturingSpecs.customData.projection"] = proj; }
                
                const isInHouse = getVal("Is In-House (TRUE/FALSE)"); 
                if(isInHouse !== null) { 
                    payload["manufacturingSpecs.isInHouse"] = isInHouse.toUpperCase() === 'TRUE';
                }

                const col = getVal("Collection");
                if (col !== null) {
                    if (col === "") payload["manufacturingSpecs.collections"] = [];
                    else payload["manufacturingSpecs.collections"] = col.split(";").map(s => s.trim().toUpperCase()).filter(Boolean);
                }

                payload.updatedAt = new Date().toISOString();
                payload.updatedBy = "CSV_IMPORT";

                batch.update(ref, payload);
                opCount++;
                totalUpdated++;

                if (opCount >= 400) {
                    await batch.commit();
                    batch = writeBatch(db);
                    opCount = 0;
                    setCsvProgress(Math.round((i / dataRows.length) * 100));
                }
            }

            if (opCount > 0) {
                await batch.commit();
            }

            setCsvProgress(100);
            alert(`✅ CSV Data Mapping Complete! Updated ${totalUpdated} records.`);
            setCsvFile(null);
            document.getElementById('csv-upload-input').value = ""; 
        } catch (err) {
            console.error(err);
            alert("Error processing CSV: " + err.message);
        }
        setIsProcessingCsv(false);
    };

    // --- MASS UPDATE LOGIC ---
    const anyFilterActive = !!searchTerm || routingFilter !== "ALL" || !!typeFilter || !!collectionFilter || !!watchlistFilter;
    const filteredInventory = inventory.filter(part => {
        // Don't render the whole library by default — require a search or at least one filter.
        if (!anyFilterActive) return false;
        const specs = part.manufacturingSpecs || {};

        const term = searchTerm.toLowerCase();
        const matchesSearch = !searchTerm ||
            part.itemName?.toLowerCase().includes(term) ||
            (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) ||
            (part.itemId && part.itemId.toLowerCase().includes(term)) ||
            (specs.binLocation && specs.binLocation.toLowerCase().includes(term));

        const matchesRouting = routingFilter === "ALL" ||
            (routingFilter === "UNASSIGNED" ? (!part.routingType || part.routingType === "UNASSIGNED") : ((part.routingType || "").toUpperCase() === routingFilter.toUpperCase()));

        const matchesType = !typeFilter || (specs.productType || part.productType || "").toUpperCase() === typeFilter.toUpperCase();

        const cust = specs.customData || {};
        const partCollections = specs.collections ? specs.collections.map(c => c.toUpperCase()) : (cust.collection && cust.collection !== 'N/A' ? [cust.collection.toUpperCase()] : []);
        const matchesCollection = !collectionFilter || partCollections.includes(collectionFilter.toUpperCase());

        const currentWatchList = (specs.watchList || cust.watchlist || "NONE").toUpperCase();
        const matchesWatchlist = !watchlistFilter || currentWatchList === watchlistFilter.toUpperCase();

        return matchesSearch && matchesRouting && matchesType && matchesCollection && matchesWatchlist;
    });

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSelectAll = () => {
        if (selectedIds.size === filteredInventory.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(filteredInventory.map(item => item.id)));
        }
    };

    const handleUpdateChange = (field, key, val) => {
        setUpdates(prev => ({ ...prev, [field]: { ...prev[field], [key]: val } }));
    };

    const executeMassUpdate = async () => {
        const activeUpdates = Object.entries(updates).filter(([k, v]) => v.active);
        if (selectedIds.size === 0) return alert("Please select at least one item to update.");
        if (activeUpdates.length === 0) return alert("Please enable at least one field to update.");
        
        if (!window.confirm(`WARNING: You are about to overwrite ${activeUpdates.length} field(s) across ${selectedIds.size} records. This cannot be undone. Proceed?`)) return;

        setIsUpdating(true);
        setProgress(0);

        try {
            const idsArray = Array.from(selectedIds);
            const chunkSize = 400; 
            
            for (let i = 0; i < idsArray.length; i += chunkSize) {
                const chunk = idsArray.slice(i, i + chunkSize);
                const batch = writeBatch(db);

                chunk.forEach(id => {
                    const ref = doc(db, "Approved_Designs", id);
                    const targetPart = inventory.find(p => p.id === id);
                    const payload = {};

                    activeUpdates.forEach(([fieldKey, config]) => {
                        const val = config.value;
                        if (fieldKey === 'productType' || fieldKey === 'routingType' || fieldKey === 'project') {
                            payload[fieldKey] = val;
                            payload[`manufacturingSpecs.${fieldKey}`] = val;
                        } else if (fieldKey === 'collection') {
                            const currentCols = targetPart?.manufacturingSpecs?.collections || [];
                            if (!currentCols.includes(val)) payload['manufacturingSpecs.collections'] = [...currentCols, val];
                        } else if (fieldKey === 'isInHouse') {
                            payload['manufacturingSpecs.isInHouse'] = val;
                            payload.partClass = val ? "Inventory" : "Inventory"; 
                        } else if (fieldKey === 'projection') {
                            payload[`manufacturingSpecs.customData.${fieldKey}`] = val;
                        } else if (['basePrice', 'cost', 'weight', 'moq', 'leadTime', 'reorderPoint'].includes(fieldKey)) {
                            payload[`manufacturingSpecs.${fieldKey}`] = val === "" ? "" : parseFloat(val);
                        } else if (fieldKey === 'binLocation') {
                            payload[`manufacturingSpecs.${fieldKey}`] = val.toUpperCase();
                        } else {
                            payload[`manufacturingSpecs.${fieldKey}`] = val;
                        }
                    });

                    payload.updatedAt = new Date().toISOString();
                    payload.updatedBy = currentUser;
                    
                    batch.update(ref, payload);
                });

                await batch.commit();
                setProgress(Math.round(((i + chunk.length) / idsArray.length) * 100));
            }

            alert("✅ Mass update completed successfully!");
            setSelectedIds(new Set()); 
            
            const resetUpdates = { ...updates };
            Object.keys(resetUpdates).forEach(k => resetUpdates[k].active = false);
            setUpdates(resetUpdates);

        } catch (error) {
            console.error("Mass Update Error:", error);
            alert("Failed to complete mass update. See console for details.");
        }
        
        setIsUpdating(false);
        setProgress(0);
    };

    // --- DICTIONARY MANAGERS ---
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

    const handleAddCollection = async () => {
        if (!newCollection.name) return alert("Collection name is required.");
        const safeId = `COL_${Date.now()}`;
        await setDoc(doc(db, "hq_collections", safeId), { id: safeId, name: newCollection.name.toUpperCase(), allowedCustomers: newCollection.allowedCustomers, allowedFinishes: newCollection.allowedFinishes });
        setNewCollection({ name: '', allowedCustomers: [], allowedFinishes: [] });
        setShowCollectionForm(false);
    };

    const handleDeleteCollection = async (id) => {
        if (!window.confirm("Delete this Collection?")) return;
        await deleteDoc(doc(db, "hq_collections", id));
    };

    const toggleCollectionCustomer = (cust) => {
        setNewCollection(prev => ({ ...prev, allowedCustomers: prev.allowedCustomers.includes(cust) ? prev.allowedCustomers.filter(c => c !== cust) : [...prev.allowedCustomers, cust] }));
    };
    const toggleCollectionFinish = (finishName) => {
        setNewCollection(prev => ({ ...prev, allowedFinishes: prev.allowedFinishes.includes(finishName) ? prev.allowedFinishes.filter(f => f !== finishName) : [...prev.allowedFinishes, finishName] }));
    };

    const handleCreateCustomWindow = async () => {
        if (!newCustomWindow.name.trim()) return alert("Dictionary Name is required.");
        const newId = `dict_${Date.now()}`;
        const newWin = { id: newId, ...newCustomWindow, name: newCustomWindow.name.toUpperCase() };
        await setDoc(doc(db, "system", "window_config"), { system: windowConfig.system, custom: [...windowConfig.custom, newWin] }, { merge: true });
        setNewCustomWindow({ name: '', brands: [activeBrand], hasImage: true, hasCode: true, hasVendor: false, hasMultiplier: true });
        alert("✅ Custom CPQ Dictionary Created Successfully!");
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
                if (isOutsource) setNewOutsourceFinishConfig({ ...newOutsourceFinishConfig, textureUrl: url }); 
                else setNewFinishConfig({ ...newFinishConfig, textureUrl: url }); 
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

    const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)' };
    const fieldStyle = { width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' };
    const labelStyle = { fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px', letterSpacing: '.1em' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: theme.ink }}>Mass Library Operations</h2>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginTop: '4px' }}>BATCH UPDATE METADATA & CPQ RULES</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '14px', color: theme.brass, fontWeight: 'bold' }}>{selectedIds.size} Records Selected</div>
                </div>
            </div>

            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', marginBottom: '10px', borderRadius: '2px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: '0 0 8px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>CSV Data Mapping Tool</h3>
                    <span style={{ fontFamily: 'var(--sans)', fontSize: '0.85rem', color: theme.inkSoft }}>Filter or select rows on the left, download just those, edit in Excel, and upload back to map NetSuite data like Bins, Pricing, and Routing. With nothing selected/filtered it exports the whole library.</span>
                </div>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                    <button onClick={handleDownloadCsvTemplate} title="Exports your current selection, or the filtered view, or the whole library if neither is set" style={{ padding: '12px 24px', background: 'var(--paper-2)', color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                        1. Download CSV {selectedIds.size > 0 ? `(${selectedIds.size} selected)` : (anyFilterActive ? `(${filteredInventory.length} filtered)` : '(all)')}
                    </button>
                    <input 
                        id="csv-upload-input"
                        type="file" 
                        accept=".csv" 
                        onChange={(e) => setCsvFile(e.target.files[0])} 
                        style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)' }} 
                    />
                    <button 
                        onClick={handleProcessCsv} 
                        disabled={isProcessingCsv || !csvFile}
                        style={{ padding: '12px 24px', background: (csvFile && !isProcessingCsv) ? theme.ink : theme.paper2, color: (csvFile && !isProcessingCsv) ? '#fff' : theme.inkSoft, border: 'none', cursor: (csvFile && !isProcessingCsv) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                        {isProcessingCsv ? `Processing... ${csvProgress}%` : '2. Upload & Sync'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', height: '70vh', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '20px', background: theme.paper2, borderBottom: `1px solid ${theme.line}` }}>
                        <input
                            placeholder="Search Name, ERP, Bin..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ ...fieldStyle, fontSize: '1rem', padding: '12px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                            <select value={routingFilter} onChange={(e) => setRoutingFilter(e.target.value)} style={{ ...fieldStyle, flex: '1 1 130px', padding: '8px' }}>
                                <option value="ALL">All Routing / Class</option>
                                <option value="UNASSIGNED">Unassigned / Pending</option>
                                {[...new Set([...(globalLists.assemblyTypes || []), ...(globalLists.inventoryTypes || [])])].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ ...fieldStyle, flex: '1 1 130px', padding: '8px' }}>
                                <option value="">All Categories</option>
                                {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                            <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} style={{ ...fieldStyle, flex: '1 1 130px', padding: '8px' }}>
                                <option value="">All Collections</option>
                                {(globalLists.collections && globalLists.collections.length ? globalLists.collections : collectionsData.map(c => c.name).filter(Boolean)).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} style={{ ...fieldStyle, flex: '1 1 130px', padding: '8px' }}>
                                <option value="">All Watchlists</option>
                                <option value="NONE">None / Unassigned</option>
                                {(globalLists.watchLists || []).map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Showing {filteredInventory.length} Results</span>
                            <button onClick={handleSelectAll} disabled={filteredInventory.length === 0} style={{ background: 'transparent', border: `1px solid ${theme.ink}`, color: theme.ink, padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>
                                {selectedIds.size > 0 && selectedIds.size === filteredInventory.length ? 'Deselect All' : 'Select All Filtered'}
                            </button>
                        </div>
                    </div>

                    <div style={{ overflowY: 'auto', flex: 1, padding: '10px' }}>
                        {!anyFilterActive ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '1.2rem' }}>
                                Search or pick a filter to find items to batch update.
                            </div>
                        ) : filteredInventory.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft }}>No matching items found.</div>
                        ) : (
                            filteredInventory.map(part => (
                                <label key={part.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderBottom: `1px solid ${theme.paper2}`, cursor: 'pointer', background: selectedIds.has(part.id) ? theme.paper2 : '#fff' }}>
                                    <input type="checkbox" checked={selectedIds.has(part.id)} onChange={() => toggleSelection(part.id)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: theme.ink, fontWeight: selectedIds.has(part.id) ? 'bold' : 'normal' }}>{part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId}</span>
                                        <span style={{ fontSize: '0.85rem', color: theme.inkSoft }}>{part.itemName}</span>
                                    </div>
                                </label>
                            ))
                        )}
                    </div>
                </div>

                <div style={{ flex: 1.2, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', height: '70vh', overflowY: 'auto' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>
                        Manual Metadata Injection Rules
                        <span style={{ display: 'block', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: theme.inkSoft, fontWeight: 'normal', marginTop: '4px' }}>
                            Check the box next to a field to enable it. Only enabled fields will be applied to the selected records.
                        </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        
                        <div style={{ background: updates.productType.active ? theme.paper : 'transparent', border: `1px solid ${updates.productType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.productType.active} onChange={(e) => handleUpdateChange('productType', 'active', e.target.checked)} />
                                Overwrite Product Type
                            </label>
                            <select disabled={!updates.productType.active} value={updates.productType.value} onChange={(e) => handleUpdateChange('productType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.productType.active ? 1 : 0.5 }}>
                                <option value="">Select Type...</option>
                                {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.routingType.active ? theme.paper : 'transparent', border: `1px solid ${updates.routingType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.routingType.active} onChange={(e) => handleUpdateChange('routingType', 'active', e.target.checked)} />
                                Overwrite Routing Type
                            </label>
                            <select disabled={!updates.routingType.active} value={updates.routingType.value} onChange={(e) => handleUpdateChange('routingType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.routingType.active ? 1 : 0.5 }}>
                                <option value="">Select Routing...</option>
                                <optgroup label="Raw Materials">{(globalLists.inventoryTypes || []).map(t => <option key={t} value={t.toUpperCase()}>{t}</option>)}</optgroup>
                                <optgroup label="Assemblies">{(globalLists.assemblyTypes || []).map(t => <option key={t} value={t.toUpperCase()}>{t}</option>)}</optgroup>
                            </select>
                        </div>

                        <div style={{ background: updates.uom.active ? theme.paper : 'transparent', border: `1px solid ${updates.uom.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.uom.active} onChange={(e) => handleUpdateChange('uom', 'active', e.target.checked)} />
                                Overwrite UOM
                            </label>
                            <select disabled={!updates.uom.active} value={updates.uom.value} onChange={(e) => handleUpdateChange('uom', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.uom.active ? 1 : 0.5 }}>
                                <option value="">Select UOM...</option>
                                {(globalLists.uom || []).map(u => <option key={u} value={u.toUpperCase()}>{u}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.vendorName.active ? theme.paper : 'transparent', border: `1px solid ${updates.vendorName.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.vendorName.active} onChange={(e) => handleUpdateChange('vendorName', 'active', e.target.checked)} />
                                Overwrite Approved Vendor
                            </label>
                            <select disabled={!updates.vendorName.active} value={updates.vendorName.value} onChange={(e) => handleUpdateChange('vendorName', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.vendorName.active ? 1 : 0.5 }}>
                                <option value="">Select Vendor...</option>
                                {(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.watchList.active ? theme.paper : 'transparent', border: `1px solid ${updates.watchList.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.watchList.active} onChange={(e) => handleUpdateChange('watchList', 'active', e.target.checked)} />
                                Assign to Watchlist
                            </label>
                            <select disabled={!updates.watchList.active} value={updates.watchList.value} onChange={(e) => handleUpdateChange('watchList', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.watchList.active ? 1 : 0.5 }}>
                                <option value="NONE">None</option>
                                {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.partHandling.active ? theme.paper : 'transparent', border: `1px solid ${updates.partHandling.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.partHandling.active} onChange={(e) => handleUpdateChange('partHandling', 'active', e.target.checked)} />
                                Set Part Handling
                            </label>
                            <select disabled={!updates.partHandling.active} value={updates.partHandling.value} onChange={(e) => handleUpdateChange('partHandling', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.partHandling.active ? 1 : 0.5 }}>
                                <option value="">Unassigned</option>
                                {(globalLists.partHandling || []).map(ph => <option key={ph} value={ph.toUpperCase()}>{ph}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.programNum.active ? theme.paper : 'transparent', border: `1px solid ${updates.programNum.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.programNum.active} onChange={(e) => handleUpdateChange('programNum', 'active', e.target.checked)} />
                                Overwrite Program #
                            </label>
                            <input type="text" disabled={!updates.programNum.active} value={updates.programNum.value} onChange={(e) => handleUpdateChange('programNum', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.programNum.active ? 1 : 0.5 }} placeholder="e.g. 1234" />
                        </div>

                        <div style={{ background: updates.material.active ? theme.paper : 'transparent', border: `1px solid ${updates.material.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.material.active} onChange={(e) => handleUpdateChange('material', 'active', e.target.checked)} />
                                Overwrite Raw Material
                            </label>
                            <input type="text" disabled={!updates.material.active} value={updates.material.value} onChange={(e) => handleUpdateChange('material', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.material.active ? 1 : 0.5 }} placeholder="e.g. Steel" />
                        </div>

                        <div style={{ background: updates.weight.active ? theme.paper : 'transparent', border: `1px solid ${updates.weight.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.weight.active} onChange={(e) => handleUpdateChange('weight', 'active', e.target.checked)} />
                                Overwrite Weight (lbs)
                            </label>
                            <input type="number" step="0.01" disabled={!updates.weight.active} value={updates.weight.value} onChange={(e) => handleUpdateChange('weight', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.weight.active ? 1 : 0.5 }} placeholder="0.00" />
                        </div>

                        <div style={{ background: updates.basePrice.active ? theme.paper : 'transparent', border: `1px solid ${updates.basePrice.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.basePrice.active} onChange={(e) => handleUpdateChange('basePrice', 'active', e.target.checked)} />
                                Overwrite Base Price ($)
                            </label>
                            <input type="number" step="0.01" disabled={!updates.basePrice.active} value={updates.basePrice.value} onChange={(e) => handleUpdateChange('basePrice', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.basePrice.active ? 1 : 0.5 }} placeholder="0.00" />
                        </div>

                        <div style={{ background: updates.cost.active ? theme.paper : 'transparent', border: `1px solid ${updates.cost.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.cost.active} onChange={(e) => handleUpdateChange('cost', 'active', e.target.checked)} />
                                Overwrite Base Cost ($)
                            </label>
                            <input type="number" step="0.01" disabled={!updates.cost.active} value={updates.cost.value} onChange={(e) => handleUpdateChange('cost', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.cost.active ? 1 : 0.5 }} placeholder="0.00" />
                        </div>
                        
                        <div style={{ background: updates.moq.active ? theme.paper : 'transparent', border: `1px solid ${updates.moq.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.moq.active} onChange={(e) => handleUpdateChange('moq', 'active', e.target.checked)} />
                                Overwrite MOQ
                            </label>
                            <input type="number" disabled={!updates.moq.active} value={updates.moq.value} onChange={(e) => handleUpdateChange('moq', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.moq.active ? 1 : 0.5 }} placeholder="0" />
                        </div>

                        <div style={{ background: updates.leadTime.active ? theme.paper : 'transparent', border: `1px solid ${updates.leadTime.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.leadTime.active} onChange={(e) => handleUpdateChange('leadTime', 'active', e.target.checked)} />
                                Overwrite Lead Time (Days)
                            </label>
                            <input type="number" disabled={!updates.leadTime.active} value={updates.leadTime.value} onChange={(e) => handleUpdateChange('leadTime', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.leadTime.active ? 1 : 0.5 }} placeholder="0" />
                        </div>

                        <div style={{ background: updates.reorderPoint.active ? theme.paper : 'transparent', border: `1px solid ${updates.reorderPoint.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.reorderPoint.active} onChange={(e) => handleUpdateChange('reorderPoint', 'active', e.target.checked)} />
                                Overwrite Reorder Pt (ROP)
                            </label>
                            <input type="number" disabled={!updates.reorderPoint.active} value={updates.reorderPoint.value} onChange={(e) => handleUpdateChange('reorderPoint', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.reorderPoint.active ? 1 : 0.5 }} placeholder="0" />
                        </div>

                        <div style={{ background: updates.binLocation.active ? theme.paper : 'transparent', border: `1px solid ${updates.binLocation.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.binLocation.active} onChange={(e) => handleUpdateChange('binLocation', 'active', e.target.checked)} />
                                Overwrite Bin Location
                            </label>
                            <select disabled={!updates.binLocation.active} value={updates.binLocation.value} onChange={(e) => handleUpdateChange('binLocation', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.binLocation.active ? 1 : 0.5, textTransform: 'uppercase' }}>
                                <option value="">Select Bin...</option>
                                {(globalLists.bins || []).map(b => <option key={b} value={b.toUpperCase()}>{b}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.isInHouse.active ? theme.paper : 'transparent', border: `1px solid ${updates.isInHouse.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.isInHouse.active} onChange={(e) => handleUpdateChange('isInHouse', 'active', e.target.checked)} />
                                Set Sourcing (In-House vs Outsourced)
                            </label>
                            <select disabled={!updates.isInHouse.active} value={updates.isInHouse.value.toString()} onChange={(e) => handleUpdateChange('isInHouse', 'value', e.target.value === 'true')} style={{ ...fieldStyle, opacity: updates.isInHouse.active ? 1 : 0.5 }}>
                                <option value="true">Manufactured In-House</option>
                                <option value="false">Outsourced / Purchased</option>
                            </select>
                        </div>

                        <div style={{ background: updates.outsourceAction.active ? theme.paper : 'transparent', border: `1px solid ${updates.outsourceAction.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.outsourceAction.active} onChange={(e) => handleUpdateChange('outsourceAction', 'active', e.target.checked)} />
                                Overwrite Outsource Action
                            </label>
                            <select disabled={!updates.outsourceAction.active} value={updates.outsourceAction.value} onChange={(e) => handleUpdateChange('outsourceAction', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.outsourceAction.active ? 1 : 0.5 }}>
                                <option value="">Select Action...</option>
                                {(globalLists.outsourceActions || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.pillowSize.active ? theme.paper : 'transparent', border: `1px solid ${updates.pillowSize.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.pillowSize.active} onChange={(e) => handleUpdateChange('pillowSize', 'active', e.target.checked)} />
                                Overwrite Pillow Size
                            </label>
                            <select disabled={!updates.pillowSize.active} value={updates.pillowSize.value} onChange={(e) => handleUpdateChange('pillowSize', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.pillowSize.active ? 1 : 0.5 }}>
                                <option value="">Select Size...</option>
                                {(globalLists.pillowSizes || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.fillType.active ? theme.paper : 'transparent', border: `1px solid ${updates.fillType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.fillType.active} onChange={(e) => handleUpdateChange('fillType', 'active', e.target.checked)} />
                                Overwrite Fill Type
                            </label>
                            <select disabled={!updates.fillType.active} value={updates.fillType.value} onChange={(e) => handleUpdateChange('fillType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.fillType.active ? 1 : 0.5 }}>
                                <option value="">Select Fill...</option>
                                {(globalLists.fillTypes || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.flangeStyle.active ? theme.paper : 'transparent', border: `1px solid ${updates.flangeStyle.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.flangeStyle.active} onChange={(e) => handleUpdateChange('flangeStyle', 'active', e.target.checked)} />
                                Overwrite Flange / Edge Style
                            </label>
                            <select disabled={!updates.flangeStyle.active} value={updates.flangeStyle.value} onChange={(e) => handleUpdateChange('flangeStyle', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.flangeStyle.active ? 1 : 0.5 }}>
                                <option value="">Select Style...</option>
                                {(globalLists.flangeStyles || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.stitchType.active ? theme.paper : 'transparent', border: `1px solid ${updates.stitchType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.stitchType.active} onChange={(e) => handleUpdateChange('stitchType', 'active', e.target.checked)} />
                                Overwrite Stitch Routing
                            </label>
                            <select disabled={!updates.stitchType.active} value={updates.stitchType.value} onChange={(e) => handleUpdateChange('stitchType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.stitchType.active ? 1 : 0.5 }}>
                                <option value="">Select Routing...</option>
                                {(globalLists.stitchTypes || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.seamCount.active ? theme.paper : 'transparent', border: `1px solid ${updates.seamCount.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.seamCount.active} onChange={(e) => handleUpdateChange('seamCount', 'active', e.target.checked)} />
                                Overwrite Seam Count
                            </label>
                            <select disabled={!updates.seamCount.active} value={updates.seamCount.value} onChange={(e) => handleUpdateChange('seamCount', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.seamCount.active ? 1 : 0.5 }}>
                                <option value="">Select Seam Count...</option>
                                {(globalLists.seamCounts || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>

                        <div style={{ background: updates.projection.active ? theme.paper : 'transparent', border: `1px solid ${updates.projection.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.projection.active} onChange={(e) => handleUpdateChange('projection', 'active', e.target.checked)} />
                                Overwrite Bracket Projection
                            </label>
                            <select disabled={!updates.projection.active} value={updates.projection.value} onChange={(e) => handleUpdateChange('projection', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.projection.active ? 1 : 0.5 }}>
                                <option value="">Select Projection...</option>
                                {(globalLists.projections || []).map(x => <option key={x} value={x.toUpperCase()}>{x}</option>)}
                            </select>
                        </div>
                        
                        <div style={{ background: updates.collection.active ? theme.paper : 'transparent', border: `1px solid ${updates.collection.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s', gridColumn: 'span 2' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.collection.active} onChange={(e) => handleUpdateChange('collection', 'active', e.target.checked)} />
                                Add to Collection (Appends to existing array)
                            </label>
                            <select disabled={!updates.collection.active} value={updates.collection.value} onChange={(e) => handleUpdateChange('collection', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.collection.active ? 1 : 0.5 }}>
                                <option value="">Select Collection...</option>
                                {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                        {isUpdating ? (
                            <div style={{ background: theme.paper, height: '40px', border: `1px solid ${theme.line}`, overflow: 'hidden', position: 'relative' }}>
                                <div style={{ background: theme.brass, height: '100%', width: `${progress}%`, transition: 'width 0.2s' }}></div>
                                <div style={{ position: 'absolute', top: '12px', width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', color: progress > 50 ? '#fff' : theme.ink, fontSize: '11px', letterSpacing: '.1em' }}>PROCESSING BATCH: {progress}%</div>
                            </div>
                        ) : (
                            <button 
                                onClick={executeMassUpdate}
                                disabled={selectedIds.size === 0 || !Object.values(updates).some(v => v.active)}
                                style={{ width: '100%', padding: '16px', background: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? theme.ink : theme.paper2, color: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? '#fff' : theme.inkSoft, border: 'none', cursor: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease' }}
                            >
                                EXECUTE MASS UPDATE ON {selectedIds.size} RECORD(S)
                            </button>
                        )}
                    </div>

                </div>
            </div>

            <div style={{ marginTop: '50px' }}>
                <button 
                    onClick={() => setShowAdminDashboard(!showAdminDashboard)} 
                    style={{ width: '100%', padding: '20px 24px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}
                >
                    {showAdminDashboard ? 'Hide System Data & Master Dictionaries' : 'Expand System Data & Master Dictionaries'}
                </button>

                {showAdminDashboard && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', marginTop: '30px' }}>
                        
                        <div style={{ padding: '24px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', alignItems: 'center', gap: '24px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                            <strong style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.ink }}>Admin Brand Master Switch:</strong>
                            <div style={{ display: 'flex', gap: '20px' }}>
                                {AVAILABLE_BRANDS.map(b => (
                                    <label key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', color: adminBrandFilter === b.id ? theme.ink : theme.inkSoft }}>
                                        <input type="radio" checked={adminBrandFilter === b.id} onChange={() => setAdminBrandFilter(b.id)} style={{ cursor: 'pointer' }} />
                                        <span style={{ fontFamily: 'var(--sans)', fontSize: '0.95rem', fontWeight: 500 }}>{b.name}</span>
                                    </label>
                                ))}
                            </div>
                            
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px' }}>
                                <button onClick={handleSyncDictionaries} style={{ padding: '12px 24px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Sync ERP Data to Dictionaries</button>
                                <button onClick={() => setShowWindowManager(true)} style={{ padding: '12px 24px', background: theme.paper2, color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Manage Brand Windows</button>
                            </div>
                        </div>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                            
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <div style={{ padding: '24px', background: theme.paper2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>In-House Master Finishes</span>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button onClick={handleSyncFloorRecipes} style={{ background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Sync Floor Recipes</button>
                                        <button onClick={() => { setShowFinishForm(!showFinishForm); setEditingGlobalFinish(null); setNewFinishConfig({name: '', code: '', type: '', textureUrl: '', clientMapping: []}); }} style={{ background: theme.ink, color: '#fff', border: 'none', padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{showFinishForm && !editingGlobalFinish ? 'Close' : 'Add Finish'}</button>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {showFinishForm && (
                                        <div style={{ padding: '30px', background: theme.paper, borderBottom: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px', marginBottom: '10px' }}>
                                                {editingGlobalFinish ? `Editing: ${newFinishConfig.name}` : 'New In-House Finish'}
                                            </div>
                                            <div><label style={labelStyle}>Finish Name</label><input value={newFinishConfig.name} onChange={(e) => setNewFinishConfig({...newFinishConfig, name: e.target.value})} placeholder="e.g. Matte Brass" style={fieldStyle} /></div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                <div><label style={labelStyle}>Code</label><input value={newFinishConfig.code} onChange={(e) => setNewFinishConfig({...newFinishConfig, code: e.target.value})} placeholder="MB" style={fieldStyle} /></div>
                                                <div><label style={labelStyle}>Category / Type</label><input value={newFinishConfig.type} onChange={(e) => setNewFinishConfig({...newFinishConfig, type: e.target.value})} placeholder="e.g. METAL, WOOD" style={{ ...fieldStyle, textTransform: 'uppercase' }} /></div>
                                            </div>
                                            <div style={{ background: '#fff', padding: '16px', border: `1px solid ${theme.line}` }}>
                                                <label style={labelStyle}>Seamless Texture Map (JPG/PNG)</label>
                                                {newFinishConfig.textureUrl && <div style={{ color: theme.inkSoft, fontSize: '0.85rem', marginBottom: '8px' }}>Asset Ready</div>}
                                                <input type="file" accept="image/*" onChange={(e) => handleFinishTextureUpload(e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', width: '100%', cursor: 'pointer' }} />
                                                {finishUploadProgress > 0 && <progress value={finishUploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                            </div>

                                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px', marginTop: '10px' }}>
                                                <label style={labelStyle}>Client-Specific Finish Names (CPQ Mapping)</label>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                                    <select value={newFinishClientMapping.customerId} onChange={e => setNewFinishClientMapping({...newFinishClientMapping, customerId: e.target.value})} style={fieldStyle}>
                                                        <option value="">Select Customer...</option>
                                                        {liveCustomers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                                    </select>
                                                    <input value={newFinishClientMapping.clientFinishName} onChange={e => setNewFinishClientMapping({...newFinishClientMapping, clientFinishName: e.target.value})} placeholder="e.g. Antique Brass" style={fieldStyle} />
                                                    <button onClick={() => {
                                                        if(!newFinishClientMapping.customerId || !newFinishClientMapping.clientFinishName) return alert("Select customer and enter finish name.");
                                                        setNewFinishConfig(prev => ({...prev, clientMapping: [...(prev.clientMapping || []), newFinishClientMapping]}));
                                                        setNewFinishClientMapping({customerId: '', clientFinishName: ''});
                                                    }} style={{ padding: '0 20px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Map</button>
                                                </div>
                                                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {(newFinishConfig.clientMapping || []).map((mapping, idx) => (
                                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: theme.paper2, padding: '10px 16px', border: `1px solid ${theme.line}`, fontSize: '0.9rem' }}>
                                                            <span><strong style={{ color: theme.ink }}>{mapping.customerId}:</strong> {mapping.clientFinishName}</span>
                                                            <span style={{ color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => setNewFinishConfig(prev => ({...prev, clientMapping: prev.clientMapping.filter((_, i) => i !== idx)}))}>×</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            <button onClick={handleAddGlobalFinish} style={{ padding: '16px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', marginTop: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                {editingGlobalFinish ? 'Save Changes' : 'Save New Finish'}
                                            </button>
                                        </div>
                                    )}
                                    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', background: '#fff' }}>
                                        {globalFinishes.length === 0 && <span style={{ color: theme.inkSoft, fontStyle: 'italic', fontSize: '0.9rem' }}>No finishes added yet.</span>}
                                        {globalFinishes.map(finish => {
                                            const hasRecipe = activeRecipes.includes(finish.code) || activeRecipes.includes(finish.name);
                                            return (
                                                <div key={finish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.paper, padding: '20px', border: `1px solid ${theme.line}`, borderLeft: `2px solid ${theme.brass}` }}>
                                                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                        <div style={{ width: '48px', height: '48px', background: finish.textureUrl ? `url(${finish.textureUrl}) center/cover` : theme.paper2, borderRadius: '50%', border: `1px solid ${theme.line}` }} />
                                                        <div>
                                                            <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: theme.ink }}>{finish.name} {finish.code && `(${finish.code})`}</div>
                                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginTop: '6px' }}>Status: {hasRecipe ? 'Production Ready' : 'Working / R&D'}</div>
                                                            {finish.clientMapping && finish.clientMapping.length > 0 && (
                                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.ink, marginTop: '4px' }}>{finish.clientMapping.length} Client Map(s) Active</div>
                                                            )}
                                                            <div style={{ marginTop: '10px' }}>
                                                                <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '2px', display: 'inline-block' }}>
                                                                    {inlineTextureProgress[finish.id] > 0 ? `Uploading ${inlineTextureProgress[finish.id]}%` : (finish.textureUrl ? 'Replace Texture Map' : 'Upload Texture Map')}
                                                                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpdateExistingFinishTexture(finish.id, e.target.files[0])} />
                                                                </label>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '12px' }}>
                                                        <button onClick={() => handleEditGlobalFinish(finish)} style={{ background: 'none', border: 'none', color: theme.inkSoft, fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }} title="Edit Finish">Edit</button>
                                                        <button onClick={() => handleRemoveFinish(finish.id)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }} title="Delete Finish">Del</button>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>

                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <div style={{ padding: '24px', background: theme.paper2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>Outsourced Master Finishes</span>
                                    <button onClick={() => { setShowOutsourceFinishForm(!showOutsourceFinishForm); setEditingOutsourceFinish(null); setNewOutsourceFinishConfig({name: '', description: '', multiplier: 1.0, vendor: '', textureUrl: '', clientMapping: []}); }} style={{ background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{showOutsourceFinishForm && !editingOutsourceFinish ? 'Close' : 'Add Finish'}</button>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {showOutsourceFinishForm && (
                                        <div style={{ padding: '30px', background: theme.paper, borderBottom: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px', marginBottom: '10px' }}>
                                                {editingOutsourceFinish ? `Editing: ${newOutsourceFinishConfig.name}` : 'New Outsourced Finish'}
                                            </div>
                                            <div><label style={labelStyle}>Finish Name</label><input value={newOutsourceFinishConfig.name} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, name: e.target.value})} style={fieldStyle} /></div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                <div><label style={labelStyle}>Approved Vendor</label><select value={newOutsourceFinishConfig.vendor} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, vendor: e.target.value})} style={fieldStyle}><option value="">Select...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>
                                                <div><label style={labelStyle}>Price Multiplier (x)</label><input type="number" step="0.1" value={newOutsourceFinishConfig.multiplier} onChange={(e) => setNewOutsourceFinishConfig({...newOutsourceFinishConfig, multiplier: e.target.value})} style={fieldStyle} /></div>
                                            </div>
                                            
                                            <div style={{ background: '#fff', padding: '16px', border: `1px solid ${theme.line}` }}>
                                                <label style={labelStyle}>Seamless Texture Map (JPG/PNG)</label>
                                                {newOutsourceFinishConfig.textureUrl && <div style={{ color: theme.inkSoft, fontSize: '0.85rem', marginBottom: '8px' }}>Asset Ready</div>}
                                                <input type="file" accept="image/*" onChange={(e) => handleFinishTextureUpload(e.target.files[0], true)} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', width: '100%', cursor: 'pointer' }} />
                                                {finishUploadProgress > 0 && <progress value={finishUploadProgress} max="100" style={{ width: '100%', marginTop: '10px' }}/>}
                                            </div>

                                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px', marginTop: '10px' }}>
                                                <label style={labelStyle}>Client-Specific Finish Names (CPQ Mapping)</label>
                                                <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                                    <select value={newFinishClientMapping.customerId} onChange={e => setNewFinishClientMapping({...newFinishClientMapping, customerId: e.target.value})} style={fieldStyle}>
                                                        <option value="">Select Customer...</option>
                                                        {(globalLists.customers || []).map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                    <input value={newFinishClientMapping.clientFinishName} onChange={e => setNewFinishClientMapping({...newFinishClientMapping, clientFinishName: e.target.value})} placeholder="e.g. Antique Brass" style={fieldStyle} />
                                                    <button onClick={() => {
                                                        if(!newFinishClientMapping.customerId || !newFinishClientMapping.clientFinishName) return alert("Select customer and enter finish name.");
                                                        setNewOutsourceFinishConfig(prev => ({...prev, clientMapping: [...(prev.clientMapping || []), newFinishClientMapping]}));
                                                        setNewFinishClientMapping({customerId: '', clientFinishName: ''});
                                                    }} style={{ padding: '0 20px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Map</button>
                                                </div>
                                                <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {(newOutsourceFinishConfig.clientMapping || []).map((mapping, idx) => (
                                                        <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', background: theme.paper2, padding: '10px 16px', border: `1px solid ${theme.line}`, fontSize: '0.9rem' }}>
                                                            <span><strong style={{ color: theme.ink }}>{mapping.customerId}:</strong> {mapping.clientFinishName}</span>
                                                            <span style={{ color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => setNewOutsourceFinishConfig(prev => ({...prev, clientMapping: prev.clientMapping.filter((_, i) => i !== idx)}))}>×</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                            
                                            <button onClick={handleAddOutsourceFinish} style={{ padding: '16px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', marginTop: '16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                                {editingOutsourceFinish ? 'Save Changes' : 'Save Outsourced Finish'}
                                            </button>
                                        </div>
                                    )}
                                    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', background: '#fff' }}>
                                        {outsourceFinishes.length === 0 && <span style={{ color: theme.inkSoft, fontStyle: 'italic', fontSize: '0.9rem' }}>No outsourced finishes added yet.</span>}
                                        {outsourceFinishes.map(finish => (
                                            <div key={finish.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.paper, padding: '20px', border: `1px solid ${theme.line}`, borderLeft: `2px solid ${theme.brass}` }}>
                                                <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                    <div style={{ width: '48px', height: '48px', background: finish.textureUrl ? `url(${finish.textureUrl}) center/cover` : theme.paper2, borderRadius: '50%', border: `1px solid ${theme.line}` }} />
                                                    <div>
                                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: theme.ink }}>{finish.name}</div>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginTop: '6px' }}>Vendor: <span style={{color: theme.ink}}>{finish.vendor || 'Unassigned'}</span> | Mult: <span style={{color: theme.ink}}>x{finish.multiplier}</span></div>
                                                        {finish.clientMapping && finish.clientMapping.length > 0 && (
                                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.ink, marginTop: '4px' }}>{finish.clientMapping.length} Client Map(s) Active</div>
                                                        )}
                                                        <div style={{ marginTop: '10px' }}>
                                                            <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '2px', display: 'inline-block' }}>
                                                                {inlineTextureProgress[finish.id] > 0 ? `Uploading ${inlineTextureProgress[finish.id]}%` : (finish.textureUrl ? 'Replace Texture Map' : 'Upload Texture Map')}
                                                                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpdateExistingFinishTexture(finish.id, e.target.files[0], true)} />
                                                            </label>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '12px' }}>
                                                    <button onClick={() => handleEditOutsourceFinish(finish)} style={{ background: 'none', border: 'none', color: theme.inkSoft, fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }} title="Edit Finish">Edit</button>
                                                    <button onClick={() => handleRemoveOutsourceFinish(finish.id)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }} title="Delete Finish">Del</button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {windowConfig.custom.filter(w => (w.brands || []).includes(adminBrandFilter)).map(w => {
                                const myData = dynamicAssets.filter(d => d.windowId === w.id);
                                const myForm = newAssetForms[w.id] || {};
                                const isFormOpen = activeDictForms[w.id];

                                return (
                                    <div key={w.id} style={{ background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                        <div style={{ padding: '24px', background: theme.paper2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
                                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>CPQ Asset Dictionary: {w.name}</span>
                                            <button onClick={() => setActiveDictForms(prev => ({ ...prev, [w.id]: !isFormOpen }))} style={{ background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{isFormOpen ? 'Close' : 'Add Item'}</button>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                            {isFormOpen && (
                                                <div style={{ padding: '30px', background: theme.paper, borderBottom: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                    <div><label style={labelStyle}>Item Name</label><input value={myForm.name || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, name: e.target.value}})} style={fieldStyle} /></div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                                        {w.hasCode && <div><label style={labelStyle}>Code</label><input value={myForm.code || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, code: e.target.value}})} style={fieldStyle} /></div>}
                                                        {w.hasMultiplier && <div><label style={labelStyle}>Mult (x)</label><input type="number" step="0.1" value={myForm.multiplier || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, multiplier: e.target.value}})} style={fieldStyle} /></div>}
                                                    </div>
                                                    {w.hasVendor && <div><label style={labelStyle}>Vendor</label><select value={myForm.vendor || ''} onChange={(e) => setNewAssetForms({...newAssetForms, [w.id]: {...myForm, vendor: e.target.value}})} style={fieldStyle}><option value="">Select...</option>{(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}</select></div>}
                                                    {w.hasImage && (
                                                        <div style={{ background: '#fff', padding: '16px', border: `1px solid ${theme.line}` }}>
                                                            <label style={labelStyle}>Asset (Image/Texture)</label>
                                                            {myForm.textureUrl && <span style={{ color: theme.inkSoft, fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>Asset Ready</span>}
                                                            <input type="file" accept="image/*" onChange={e => handleDynamicAssetTextureUpload(w.id, e.target.files[0])} style={{ fontSize: '0.85rem', fontFamily: 'var(--sans)', width: '100%' }} />
                                                        </div>
                                                    )}
                                                    <button onClick={() => handleAddDynamicAsset(w)} style={{ padding: '16px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save Item</button>
                                                </div>
                                            )}
                                            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', background: '#fff' }}>
                                                {myData.length === 0 && <span style={{ color: theme.inkSoft, fontStyle: 'italic', fontSize: '0.9rem' }}>No items added yet.</span>}
                                                {myData.map(item => (
                                                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.paper, padding: '20px', border: `1px solid ${theme.line}`, borderLeft: `2px solid ${theme.brass}` }}>
                                                        <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                                            {w.hasImage && <div style={{ width: '40px', height: '40px', background: item.textureUrl ? `url(${item.textureUrl}) center/cover` : theme.paper2, borderRadius: '50%', border: `1px solid ${theme.line}` }} />}
                                                            <div>
                                                                <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: theme.ink }}>{item.name} {item.code && <span style={{ color: theme.inkSoft }}>({item.code})</span>}</div>
                                                                {w.hasVendor && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginTop: '6px' }}>Vendor: <span style={{ color: theme.ink }}>{item.vendor || 'N/A'}</span></div>}
                                                                <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginTop: '4px' }}>ERP ID: <span style={{ color: theme.ink }}>{item.legacyErpId || 'Pending'}</span> {w.hasMultiplier && `| Mult: x${item.multiplier}`}</div>
                                                            </div>
                                                        </div>
                                                        <button onClick={() => handleRemoveDynamicAsset(item.id)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }}>Del</button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <div style={{ padding: '24px', background: theme.paper2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>Static Part Attributes</span>
                                    <button onClick={() => setShowSchemaForm(!showSchemaForm)} style={{ background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        {showSchemaForm ? 'Close' : 'Add Attribute'}
                                    </button>
                                </div>
                                
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                                    {showSchemaForm && (
                                        <div style={{ padding: '30px', background: theme.paper, borderBottom: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                            <div><label style={labelStyle}>New Attribute Label</label><input value={newFieldConfig.label} onChange={(e) => setNewFieldConfig({...newFieldConfig, label: e.target.value})} placeholder="e.g. Weight Class" style={fieldStyle} /></div>
                                            <div><label style={labelStyle}>Data Type</label><select value={newFieldConfig.type} onChange={(e) => setNewFieldConfig({...newFieldConfig, type: e.target.value})} style={fieldStyle}><option value="text">Text (String)</option><option value="number">Number</option><option value="dropdown">Dropdown</option><option value="file">File Upload (PNG, PDF)</option></select></div>
                                            {newFieldConfig.type === 'dropdown' && <div><label style={labelStyle}>Options (Comma Separated)</label><input value={newFieldConfig.options} onChange={(e) => setNewFieldConfig({...newFieldConfig, options: e.target.value})} placeholder="A, B, C" style={fieldStyle} /></div>}
                                            <button onClick={handleAddSchemaField} style={{ padding: '16px', background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', marginTop: '10px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Save Attribute</button>
                                        </div>
                                    )}
                                    <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '400px', overflowY: 'auto', background: '#fff' }}>
                                        {customSchema.length === 0 && <span style={{ color: theme.inkSoft, fontStyle: 'italic', fontSize: '0.9rem' }}>No custom attributes mapped.</span>}
                                        {customSchema.map(field => (
                                            <div key={field.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.paper, padding: '20px', border: `1px solid ${theme.line}` }}>
                                                <div>
                                                    <div style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500, color: theme.ink }}>{field.label}</div>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: theme.inkSoft, marginTop: '6px' }}>Type: <span style={{ color: theme.ink }}>{field.type}</span> | ID: <span style={{ color: theme.ink }}>{field.key}</span></div>
                                                </div>
                                                <button onClick={() => handleRemoveSchemaField(field.key)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1rem', cursor: 'pointer', textDecoration: 'underline' }}>Del</button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* --- MASTER DICTIONARIES --- */}
                            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                                <div style={{ padding: '24px', background: theme.paper2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}` }}>
                                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink }}>Master Dictionaries</span>
                                    <button onClick={handleAddNewListCategory} style={{ background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 16px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                                        Add Category
                                    </button>
                                </div>

                                <div style={{ padding: '30px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '30px', background: '#fff', maxHeight: '600px', overflowY: 'auto' }}>
                                    
                                    {/* COLLECTIONS DICTIONARY UI */}
                                    <div style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', flexDirection: 'column' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${theme.line}`, paddingBottom: '12px', marginBottom: '20px' }}>
                                            <h4 style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: theme.ink }}>BRAND COLLECTIONS</h4>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                                            <input value={newDictInput.collections || ''} onChange={(e) => setNewDictItem({...newDictInput, collections: e.target.value})} style={{ flex: 1, padding: '10px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: 'var(--sans)' }} placeholder="Add collection..." />
                                            <button onClick={handleQuickAddCollection} style={{ background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', padding: '0 20px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add</button>
                                        </div>
                                        <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {dynamicCollections.length === 0 && <div style={{ fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>No collections.</div>}
                                            {dynamicCollections.map(cName => {
                                                const dbRecord = collectionsData.find(c => c.name.toUpperCase() === cName);
                                                return (
                                                    <div key={cName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', background: '#fff', padding: '12px 16px', border: `1px solid ${theme.line}`, color: theme.ink }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <span>{cName}</span>
                                                            {!dbRecord && (
                                                                <span style={{ fontSize: '9px', background: 'var(--paper-2)', padding: '2px 6px', color: 'var(--ink-soft)', borderRadius: '2px' }}>ERP GHOST</span>
                                                            )}
                                                        </div>
                                                        {dbRecord ? (
                                                            <span onClick={() => handleQuickDeleteCollection(dbRecord.id, dbRecord.name)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }} title="Delete from App">×</span>
                                                        ) : (
                                                            <span style={{ fontSize: '10px', color: 'var(--ink-soft)', opacity: 0.6 }} title="Cannot delete ERP ghost here. Remove from inventory item.">LOCKED</span>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    {/* ALL OTHER GLOBAL LISTS UI */}
                                    {Object.keys(globalLists).filter(k => k !== 'cpqRoutingTypes' && k !== 'collections' && k !== 'bins').map(listKey => {
                                        
                                        // 🚀 Unify Admin rendering with dropdown dynamic lists
                                        let mergedList = globalLists[listKey] || [];
                                        if (listKey === 'prodTypes') mergedList = dynamicProdTypes;
                                        if (listKey === 'watchLists') mergedList = dynamicWatchlists;

                                        return (
                                            <div key={listKey} style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', flexDirection: 'column' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `1px solid ${theme.line}`, paddingBottom: '12px', marginBottom: '20px' }}>
                                                    <h4 style={{ margin: 0, fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: theme.ink }}>{LIST_LABELS[listKey] || listKey.replace(/([A-Z])/g, ' $1').trim()}</h4>
                                                    <button onClick={() => handleDeleteListCategory(listKey)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.1rem', cursor: 'pointer' }} title="Delete Category">×</button>
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                                                    <input value={newDictInput[listKey] || ''} onChange={(e) => setNewDictItem({...newDictInput, [listKey]: e.target.value})} style={{ flex: 1, padding: '10px', border: `1px solid ${theme.line}`, outline: 'none', fontFamily: 'var(--sans)' }} placeholder="Add item..." />
                                                    <button onClick={() => handleAddMasterListItem(listKey)} style={{ background: theme.ink, color: '#fff', border: 'none', cursor: 'pointer', padding: '0 20px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Add</button>
                                                </div>
                                                <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                    {mergedList.length === 0 && <div style={{ fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic' }}>List is empty.</div>}
                                                    {mergedList.map(item => {
                                                        const isDbRecord = (globalLists[listKey] || []).includes(item);
                                                        return (
                                                            <div key={item} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', background: '#fff', padding: '12px 16px', border: `1px solid ${theme.line}`, color: theme.ink }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                    {listKey === 'assemblyTypes' && (
                                                                        <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: theme.inkSoft }}>
                                                                            <input type="checkbox" checked={globalLists.cpqRoutingTypes?.includes(item) || false} onChange={(e) => handleToggleCpqRouting(item, e.target.checked)} />
                                                                            CPQ Enabled
                                                                        </label>
                                                                    )}
                                                                    <span>{item}</span>
                                                                    {!isDbRecord && <span style={{ fontSize: '9px', background: 'var(--paper-2)', padding: '2px 6px', color: 'var(--ink-soft)', borderRadius: '2px' }}>ERP GHOST</span>}
                                                                </div>
                                                                {isDbRecord ? (
                                                                    <span onClick={() => handleRemoveMasterListItem(listKey, item)} style={{ color: '#d9534f', cursor: 'pointer', fontSize: '1.2rem' }} title="Delete from App">×</span>
                                                                ) : (
                                                                    <span style={{ fontSize: '10px', color: 'var(--ink-soft)', opacity: 0.6 }} title="Cannot delete ERP ghost here. Remove from inventory item.">LOCKED</span>
                                                                )}
                                                            </div>
                                                        )
                                                    })}
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

        </div>
    );
};

export default LibraryMassUpdateTab;