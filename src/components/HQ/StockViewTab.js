import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, getDocs, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { printItemLabel, printBinLabel, printItemLabels, printBinLabels } from '../Shared/labelPrint';
import { makeFullTasks } from '../Shared/workOrderContract';
import { SIZE_CAPACITY, lookupCapacity } from '../Shared/finishingTime';
import { nsProxyFetch } from "../Shared/nsProxy";

const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

// Last 12 calendar months oldest → newest, e.g. { key:'2025-07', label:"Jul '25" }.
const last12Months = (now) => {
    const out = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        out.push({
            key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
            label: `${d.toLocaleString('en-US', { month: 'short' })} '${String(d.getFullYear()).slice(-2)}`
        });
    }
    return out;
};

// Finish code = the assembly suffix (base/CODE); some finish docs hold it in `name` (matches PickPack/Library).
const finishCodeOf = (f) => String((f && (f.code || f.name)) || '').toUpperCase();

const StockViewTab = ({ currentUser, activeBrand, onNavigateToLibrary }) => {
    const [hqParts, setHqParts] = useState([]);
    const [nsStock, setNsStock] = useState({});
    const [lastSyncTime, setLastSyncTime] = useState("");
    const [vendors, setVendors] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]); // hq_outsource_finishes — detect EP (plated) lines for plating-flow dispatch
    const [platingLines, setPlatingLines] = useState([]); // in-progress plating (staged/shipped/received) → WIP-Plating column + popup
    const [labelTool, setLabelTool] = useState(false);    // bin/range label printing modal
    const [labelBin, setLabelBin] = useState('');
    const [labelSearch, setLabelSearch] = useState('');
    const [labelMode, setLabelMode] = useState('bins');   // 'bins' | 'items'
    const [wipModal, setWipModal] = useState(null);       // { erpId, itemName, lines } when the WIP popup is open
    const [poModal, setPoModal] = useState(null);         // { erpId, itemName, loading, lines, error } for the On-Order popup
    const [salesHist, setSalesHist] = useState(null);     // 12-mo sales-history report for retiring "- OLD" items
    const [salesHistSearch, setSalesHistSearch] = useState('');
    // Retired items — locked by NetSuite INTERNAL ID (stable across an item# rename). Hidden from all
    // user-facing browse surfaces; still visible to sync/ERP tabs. Global list in system/retired_items.
    const [retiredDoc, setRetiredDoc] = useState({ internalIds: [], items: [] });
    useEffect(() => onSnapshot(doc(db, 'system', 'retired_items'),
        s => setRetiredDoc(s.exists() ? { internalIds: s.data().internalIds || [], items: s.data().items || [] } : { internalIds: [], items: [] }),
        () => { }), []);
    // Finishing sled-capacity matrix (pieces/sled by size×type) drives the recommended production run.
    const [capacityMatrix, setCapacityMatrix] = useState({ rules: {}, default: null });
    useEffect(() => onSnapshot(doc(db, 'fin_config', 'capacityMatrix'),
        s => setCapacityMatrix(s.exists() ? s.data() : { rules: {}, default: null }), () => { }), []);
    const [orderQty, setOrderQty] = useState({});   // per-row entered production amount (keyed by internalId)
    const [genBusy, setGenBusy] = useState(false);
    const [onOrdModal, setOnOrdModal] = useState(null); // snapshot row → open PO/WO inbound detail popup
    const [cutModal, setCutModal] = useState(null);     // rod-cut order builder ({itemid, internalId, available, qty, target})
    const [snapWatch, setSnapWatch] = useState('');     // snapshot watchlist filter (catalog is growing)
    const [snapView, setSnapView] = useState('FIN');    // FIN = finished stocked items · RAW = BOM core parts behind the finish variants
    const [rawStock, setRawStock] = useState(null);     // { loading, availById, inboundById } — raw cores' NetSuite stock, fetched on first RAW toggle
    const [ropEdits, setRopEdits] = useState({});       // erp(base) -> edited ROP (pushed to Master Library manufacturingSpecs.reorderPoint)
    const [ropSaving, setRopSaving] = useState(false);
    const [routeModal, setRouteModal] = useState(null); // in-house items WITH a vendor → per-item PO-vs-WO choice {buy, make, items}

    // BUILDER STATE
    const [activeBuilder, setActiveBuilder] = useState("PO"); // 'PO' or 'WO'
    const [activeVendor, setActiveVendor] = useState("");
    const [orderDrafts, setOrderDrafts] = useState({});
    
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [syncLog, setSyncLog] = useState([]);

    // FILTER STATE
    const [globalLists, setGlobalLists] = useState({});
    const [collectionsData, setCollectionsData] = useState([]);
    const [partClassFilter, setPartClassFilter] = useState("ALL");
    const [typeFilter, setTypeFilter] = useState("");
    const [collectionFilter, setCollectionFilter] = useState("");
    const [watchlistFilter, setWatchlistFilter] = useState(""); 
    
    // NEW ALARM FILTERS
    const [filterBelowRop, setFilterBelowRop] = useState(false);
    const [filterOnBo, setFilterOnBo] = useState(false);

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

   useEffect(() => {
        const cachedStock = sessionStorage.getItem(`nsStock_${activeBrand}`);
        const cachedTime = sessionStorage.getItem(`nsStockTime_${activeBrand}`);
        if (cachedStock) {
            try {
                setNsStock(JSON.parse(cachedStock));
                if (cachedTime) setLastSyncTime(cachedTime);
            } catch (e) {
                console.error("Failed to parse cached stock data");
            }
        }

        const q = query(collection(db, "Approved_Designs"));
        const unsubParts = onSnapshot(q, (snap) => {
            let parts = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(p => p.brandId === activeBrand || (p.sharedBrands && p.sharedBrands.includes(activeBrand))); 
            
            parts.sort((a, b) => {
                const strA = (a.legacyErpId || a.itemName || "").toUpperCase();
                const strB = (b.legacyErpId || b.itemName || "").toUpperCase();
                return strA.localeCompare(strB);
            });

            const uniqueVendors = [...new Set(parts.map(p => p.manufacturingSpecs?.vendorName).filter(Boolean))];
            setVendors(uniqueVendors.sort());
            setHqParts(parts);
        });

        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
            if (docSnap.exists()) setGlobalLists(docSnap.data());
        });

        const unsubCollections = onSnapshot(collection(db, "hq_collections"), snap => {
            setCollectionsData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), snap => {
            setOutsourceFinishes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });

        // In-progress plating lines (out for plating) → feeds the WIP-Plating column + popup. 'built' = done.
        const unsubPlating = onSnapshot(collection(db, "plating_shipments"), snap => {
            setPlatingLines(
                snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .filter(s => s.brandId === activeBrand && ['staged', 'shipped', 'received'].includes(s.status))
            );
        });

        return () => { unsubParts(); unsubLists(); unsubCollections(); unsubOutsource(); unsubPlating(); };
    }, [activeBrand]);

    // --- ALIGNED DYNAMIC DICTIONARY LISTS ---
    const dynamicProdTypes = Array.from(new Set([
        ...(globalLists.prodTypes || []).map(p => p.toUpperCase()), 
        ...hqParts.map(p => (p.productType || p.manufacturingSpecs?.productType || "").toUpperCase()).filter(Boolean)
    ])).sort();

    const dynamicCollections = Array.from(new Set([
        ...collectionsData.map(c => c.name.toUpperCase()), 
        ...hqParts.flatMap(p => p.manufacturingSpecs?.collections ? p.manufacturingSpecs.collections.map(c => c.toUpperCase()) : (p.manufacturingSpecs?.customData?.collection && p.manufacturingSpecs.customData.collection !== 'N/A' ? [p.manufacturingSpecs.customData.collection.toUpperCase()] : []))
    ])).sort();

    const dynamicWatchlists = Array.from(new Set([
        ...(globalLists.watchLists || []).map(w => w.toUpperCase()),
        ...hqParts.map(p => {
            const specs = p.manufacturingSpecs || {};
            const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
            return specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
        }).filter(w => w !== "NONE")
    ])).sort();

    const pullNetSuiteStock = async () => {
        setIsSyncing(true);
        setSyncLog([]);
        
        try {
            // STEP 1: SYNC STOCK LEVELS (Quantities)
            addLog("Initiating SuiteQL pull for Item Inventory...", "info");
            const erpIds = hqParts.map(p => p.legacyErpId || p.itemId).filter(Boolean);
            
            if (erpIds.length > 0) {
                const chunkSize = 500;
                const chunks = [];
                for (let i = 0; i < erpIds.length; i += chunkSize) {
                    chunks.push(erpIds.slice(i, i + chunkSize));
                }

                addLog(`Found ${erpIds.length} tracked items. Splitting into ${chunks.length} batches...`, "info");

                let allResults = [];
                
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];
                    const idList = chunk.map(id => `'${id.replace(/'/g, "''")}'`).join(',');

                    const q = `
                        SELECT 
                            Item.itemid AS legacy_id,
                            SUM(AggregateItemLocation.quantityonhand) AS onhand,
                            SUM(AggregateItemLocation.quantityavailable) AS available,
                            SUM(AggregateItemLocation.quantityonorder) AS onorder,
                            SUM(AggregateItemLocation.quantitycommitted) AS committed,
                            SUM(AggregateItemLocation.quantitybackordered) AS backordered,
                            MAX(Item.averagecost) AS averagecost
                        FROM Item
                        LEFT JOIN AggregateItemLocation ON AggregateItemLocation.item = Item.id
                        WHERE Item.itemid IN (${idList})
                        GROUP BY Item.itemid
                    `;
                    
                    addLog(`Executing Quantity Query Batch ${i + 1} of ${chunks.length}...`, "info");

                    const response = await nsProxyFetch({
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                        method: 'POST',
                        payload: { q }
                    });
                    
                    const result = await response.json();
                    if (!response.ok) throw new Error(JSON.stringify(result));
                    
                    if (result.items) {
                        allResults = allResults.concat(result.items);
                    }
                }
                
                addLog(`NetSuite returned ${allResults.length} total matched items for quantities. Mapping...`, "success");

                const stockMap = {};
                allResults.forEach(row => {
                    if (row.legacy_id) {
                        stockMap[row.legacy_id.toUpperCase()] = {
                            onHand: parseInt(row.onhand) || 0,
                            available: parseInt(row.available) || 0,
                            onOrder: parseInt(row.onorder) || 0,
                            committed: parseInt(row.committed) || 0,
                            backorder: parseInt(row.backordered) || 0,
                            cost: parseFloat(row.averagecost) || 0
                        };
                    }
                });
                
                setNsStock(stockMap);
                
                const currentTime = new Date().toLocaleTimeString();
                setLastSyncTime(currentTime);
                sessionStorage.setItem(`nsStock_${activeBrand}`, JSON.stringify(stockMap));
                sessionStorage.setItem(`nsStockTime_${activeBrand}`, currentTime);

            } else {
                addLog("No ERP IDs found in HQ catalog to sync quantities.", "warn");
            }

            // STEP 2: SYNC ITEM METADATA
            addLog("Initiating SuiteQL pull for Item Metadata...", "info");
            
            const typeFilter = "item.itemtype IN ('InvtPart', 'Assembly')";
            let allRawRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching metadata batch ${pageCount} (Items with ID > ${lastId})...`, 'info');
                
                const q = `
                    SELECT 
                        item.id, 
                        item.itemid, 
                        item.displayname,
                        BUILTIN.DF(item.custitem_bit_product_type) AS product_type,
                        BUILTIN.DF(item.custitem_bit_itemcollection) AS collection,
                        BUILTIN.DF(item.custitem_bit_watchlist) AS watchlist,
                        BUILTIN.DF(item.stockunit) AS uom,
                        item.custitem9 AS baseprice,
                        Vendor.companyname AS vendor_name,
                        ItemVendor.vendorcode AS vendor_part_number,
                        ItemVendor.purchaseprice AS lastpurchaseprice,
                        ItemVendor.preferredvendor,
                        Bin.binnumber
                    FROM item
                    LEFT JOIN ItemVendor ON ItemVendor.item = item.id
                    LEFT JOIN Vendor ON ItemVendor.vendor = Vendor.id
                    LEFT JOIN InventoryBalance ON InventoryBalance.item = item.id
                    LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id
                    WHERE item.custitem_sync_to_cpq = 'T' 
                    AND item.isinactive = 'F' 
                    AND ${typeFilter}
                    AND item.id > ${lastId}
                    ORDER BY item.id ASC
                `;
                
                const response = await nsProxyFetch({
                    targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                    method: 'POST',
                    payload: { q }
                });
                
                const result = await response.json();
                if (!response.ok) throw new Error(JSON.stringify(result));

                const batch = result.items || [];
                allRawRecords = allRawRecords.concat(batch);
                
                if (batch.length > 0) {
                    lastId = batch[batch.length - 1].id;
                    if (batch.length < 1000) {
                        hasMore = false; 
                    } else {
                        pageCount++;
                    }
                } else {
                    hasMore = false;
                }
            }
            
            addLog(`Downloaded ${allRawRecords.length} total items. Processing deduplication and bins...`, 'success');

            const uniqueRecordsMap = {};
            for (const row of allRawRecords) {
                const itemId = row.id;
                
                if (!uniqueRecordsMap[itemId]) {
                    uniqueRecordsMap[itemId] = { ...row, all_bins: new Set() };
                } 

                if (row.binnumber) {
                    uniqueRecordsMap[itemId].all_bins.add(row.binnumber);
                }

                const isNewPreferred = row.preferredvendor === 'T';
                const isOldPreferred = uniqueRecordsMap[itemId].preferredvendor === 'T';
                const oldHasVendor = !!uniqueRecordsMap[itemId].vendor_name;
                const newHasVendor = !!row.vendor_name;

                if (isNewPreferred && !isOldPreferred) {
                    uniqueRecordsMap[itemId] = { ...row, all_bins: uniqueRecordsMap[itemId].all_bins };
                } else if (!oldHasVendor && newHasVendor && !isOldPreferred) {
                    uniqueRecordsMap[itemId] = { ...row, all_bins: uniqueRecordsMap[itemId].all_bins };
                }
            }
            const records = Object.values(uniqueRecordsMap);
            
            let successCount = 0;
            for (const item of records) {
                const existingMatch = hqParts.find(d => d.legacyErpId === item.itemid);
                if (!existingMatch) continue; 

                const mergedBins = Array.from(item.all_bins || []).join(', ');

                const pTypeClean = (item.product_type || '').toLowerCase().trim();
                const uomClean = (item.uom || '').toLowerCase().trim();
                
                const isPoleOrLinear = pTypeClean === 'pole' || pTypeClean === 'poles' || uomClean === 'ft' || uomClean === 'foot' || uomClean === 'feet';
                const autoPartHandling = isPoleOrLinear ? 'Custom' : 'Small Parts';
                
                const hasVendor = item.vendor_name && item.vendor_name.trim() !== '';

                let parsedOutsourceAction = '';
                if (/EP\d{2}/i.test(item.itemid) || /EP\d{2}/i.test(item.displayname)) {
                    parsedOutsourceAction = 'PLATING';
                }

                let parsedCollection = item.collection || '';
                let collectionsArray = [];
                if (/^H1/i.test(item.itemid) || /^H1/i.test(item.displayname)) {
                    parsedCollection = 'Fabricut H1';
                    collectionsArray = ['FABRICUT H1'];
                } else if (item.collection) {
                    collectionsArray = [item.collection.toUpperCase()];
                }

                const payload = {
                    manufacturingSpecs: {
                        ...existingMatch.manufacturingSpecs,
                        basePrice: parseFloat(item.baseprice) || existingMatch.manufacturingSpecs?.basePrice || 0,
                        cost: parseFloat(item.lastpurchaseprice) || existingMatch.manufacturingSpecs?.cost || 0,
                        isInHouse: hasVendor ? false : (existingMatch.manufacturingSpecs?.isInHouse !== undefined ? existingMatch.manufacturingSpecs.isInHouse : true),
                        productType: item.product_type || existingMatch.manufacturingSpecs?.productType || 'Uncategorized',
                        uom: item.uom || existingMatch.manufacturingSpecs?.uom || 'EA',
                        binLocation: mergedBins || existingMatch.manufacturingSpecs?.binLocation || '', 
                        partHandling: existingMatch.manufacturingSpecs?.partHandling || autoPartHandling,
                        outsourceAction: parsedOutsourceAction || existingMatch.manufacturingSpecs?.outsourceAction || '', 
                        collections: collectionsArray.length > 0 ? collectionsArray : (existingMatch.manufacturingSpecs?.collections || []), 
                        vendorName: item.vendor_name || existingMatch.manufacturingSpecs?.vendorName || '',
                        vendorId: item.vendor_part_number || existingMatch.manufacturingSpecs?.vendorId || '',
                        customData: {
                            ...(existingMatch.manufacturingSpecs?.customData || {}),
                            collection: parsedCollection || existingMatch.manufacturingSpecs?.customData?.collection || '',
                            watchlist: item.watchlist || existingMatch.manufacturingSpecs?.customData?.watchlist || ''
                        }
                    },
                    updatedAt: new Date().toISOString()
                };

                await setDoc(doc(db, "Approved_Designs", existingMatch.id), payload, { merge: true });
                successCount++;
            }

            addLog(`✅ Sync Complete. Quantities matched and metadata updated.`, "success");
        } catch (error) {
            console.error("NetSuite Sync Error:", error);
            addLog(`❌ FAILED: ${error.message}`, "error");
        }
        setIsSyncing(false);
    };

    // Suggested order/build qty = GREATER OF: top-up-to-ROP (ROP − available) and cover-demand
    // ((committed + backorder, incl. variant rollup) − available − on-order), then rounded UP to MOQ.
    // Same formula for PO and WO; the builder just shows different item sets.
    const suggestedQtyFor = (item) => {
        const avail = item.stock?.available || 0;
        const onOrder = item.stock?.onOrder || 0;
        const demand = (item.stock?.aggregatedCommitted || 0) + (item.stock?.aggregatedBackorder || 0);
        const rop = item.rop || 0;
        const moq = item.moq || 0;
        const topUp = Math.max(0, rop - avail);
        const coverDemand = Math.max(0, demand - avail - onOrder);
        let qty = Math.max(topUp, coverDemand);
        if (moq > 0 && qty > 0) qty = Math.ceil(qty / moq) * moq;
        return qty;
    };

    // Recommended Production (finishing): for STOCKED finished assemblies with a paint size, take the same
    // ROP/demand shortfall and round it UP to the paint machine's per-section capacity, so it's always a
    // runnable batch unit (S=70, M=35, L=22 per section → e.g. an L part recommends 22/44/66…).
    const PAINT_SECTION = { S: 70, M: 35, L: 22 };
    const recommendedProductionFor = (item) => {
        const specs = item.manufacturingSpecs || {};
        const cap = PAINT_SECTION[(specs.paintSize || '').toUpperCase()];
        if (!specs.isStocked || !cap) return null; // only stocked, paint-sized assemblies get a recommendation
        const avail = item.stock?.available || 0;
        const onOrder = item.stock?.onOrder || 0;
        const demand = (item.stock?.aggregatedCommitted || 0) + (item.stock?.aggregatedBackorder || 0);
        const shortfall = Math.max(item.rop - avail, demand - avail - onOrder);
        if (shortfall <= 0) return 0; // at/above ROP and demand covered → nothing to run
        return Math.ceil(shortfall / cap) * cap;
    };

    const handleOrderQtyChange = (partId, qty) => {
        setOrderDrafts(prev => ({ ...prev, [partId]: qty === "" ? "" : Math.max(0, parseInt(qty) || 0) }));
    };

    // --- NEW FIREBASE PUSH FUNCTIONS ---
    const pushPOsToDispatch = async () => {
        const lineItems = Object.entries(orderDrafts).map(([partId, qty]) => {
            if (!qty || qty <= 0) return null;
            return { partId, qty: parseInt(qty) };
        }).filter(Boolean);

        if (lineItems.length === 0) return alert("No items have quantities entered greater than 0.");

        // Split lines: a PLATED item (outsourced finish suffix, e.g. /EP2) is NOT a direct vendor buy — you send
        // your own base to the plater. It routes through the plating flow: a "Needs Plating" demand for PickPack,
        // plus (if the raw base is short) a shop-floor milling WO to produce more base. Everything else is a
        // genuine purchase → vendor PO (unchanged).
        const platedLines = [];
        const directBuyLines = [];
        for (const li of lineItems) {
            const part = hqParts.find(p => p.id === li.partId);
            if (!part) continue;
            const erp = String(part.legacyErpId || part.itemId || '').toUpperCase();
            const slash = erp.lastIndexOf('/');
            const suffix = slash > -1 ? erp.slice(slash + 1) : '';
            const outFinish = suffix ? outsourceFinishes.find(f => finishCodeOf(f) === suffix) : null;
            if (outFinish) platedLines.push({ ...li, part, erp, baseErp: erp.slice(0, slash), finishCode: suffix, finishName: outFinish.name || '' });
            else directBuyLines.push({ ...li, part });
        }

        try {
            let platingCount = 0, millingCount = 0;

            for (let i = 0; i < platedLines.length; i++) {
                const pl = platedLines[i];
                const basePart = hqParts.find(p => String(p.legacyErpId || p.itemId || '').toUpperCase() === pl.baseErp);
                const baseAvail = nsStock[pl.baseErp]?.available || 0;

                // (a) Plated demand → PickPack "Needs Plating". Generate a plating WO# so the job/label has a
                // reference to give the plating company (the label was blank without it).
                const demandId = `PLD-${activeBrand.toUpperCase()}-${Date.now()}-${i}`;
                const woNum = `PLW-${activeBrand.toUpperCase()}-${(Date.now() + i).toString().slice(-6)}`;
                await setDoc(doc(db, "plating_demand", demandId), {
                    id: demandId, brandId: activeBrand, status: 'open', woNum,
                    baseItemId: basePart?.id || null, baseErpId: pl.baseErp, targetErpId: pl.erp,
                    finishCode: pl.finishCode, finishName: pl.finishName, qty: pl.qty,
                    source: 'stockview', createdBy: currentUser?.name || 'Unknown', createdAt: Date.now()
                });
                platingCount++;
                addLog(`Plating demand ${pl.erp} ×${pl.qty} (base ${pl.baseErp} avail ${baseAvail}).`, 'info');

                // (b) Raw base short → mill more base now (routed to the shop floor by the base's routingType).
                if (basePart && baseAvail < pl.qty) {
                    const shortfall = pl.qty - baseAvail;
                    const stamp = Date.now().toString().slice(-6);
                    const safeErp = String(basePart.legacyErpId || basePart.itemId).replace(/[^A-Za-z0-9]+/g, '-');
                    const woId = `WO-${safeErp}-${stamp}-${i}`;
                    await setDoc(doc(db, "hq_work_orders", woId), {
                        id: woId, woId, woDisplayId: `WO-${basePart.legacyErpId || basePart.itemId}-${stamp}`,
                        partErpId: basePart.legacyErpId || basePart.itemId,
                        brand: activeBrand, status: "Approved", customer: "Internal Stock",
                        hqJobId: basePart.id, totalParts: shortfall,
                        reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                        type: "Stock Build", routingType: basePart.routingType || 'Standard',
                        rootItem: pl.baseErp, forPlating: pl.erp, createdAt: Date.now()
                    });
                    millingCount++;
                    addLog(`Milling WO ${basePart.legacyErpId || basePart.itemId} ×${shortfall} (raw short for ${pl.erp}).`, 'warn');
                } else if (!basePart) {
                    addLog(`⚠️ base ${pl.baseErp} not in library — plating demand created, but no milling WO.`, 'warn');
                }
            }

            let poCreated = false;
            if (directBuyLines.length > 0) {
                // Vendor aligned at creation (VEND-<nsid> CRM record) — same rule as the snapshot's
                // per-vendor POs, so the RTG → NetSuite push can't mis-resolve the vendor.
                const vendors = await loadNsVendors();
                const rec = resolveVendorRec(vendors, activeVendor);
                if (!rec) {
                    alert(`⚠️ Vendor "${activeVendor}" doesn't match any NetSuite-synced vendor (11.1 → Sync Active Vendors) — PO not created. Fix the vendor name or sync vendors, then retry.`);
                } else {
                    const nsVendorId = String(rec.id || '').replace(/^VEND-/, '');
                    const newPoId = `PO-${(activeVendor || 'VEND').replace(/[^a-zA-Z0-9]/g, '').substring(0,5)}-${Date.now().toString().slice(-6)}`;
                    const items = directBuyLines.map(({ part, qty }) => ({
                        itemId: part.legacyErpId || part.itemId,
                        nsItemId: part.netSuiteInternalId ? String(part.netSuiteInternalId) : null,
                        vendorPart: part.manufacturingSpecs?.vendorId || 'N/A',
                        quantity: qty, rate: part.manufacturingSpecs?.cost || 0, description: part.itemName
                    }));
                    await setDoc(doc(db, "hq_purchase_orders", newPoId), {
                        id: newPoId, poId: newPoId, brand: activeBrand, status: "Approved",
                        vendor: rec.name || activeVendor, nsVendorId, vendorCrmId: rec.id, items,
                        reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0], createdAt: Date.now()
                    });
                    poCreated = true;
                    addLog(`✅ Purchase Order ${newPoId} (${items.length} line${items.length === 1 ? '' : 's'}, NS vendor ${nsVendorId}) pushed.`, "success");
                }
            }

            const summary = [];
            if (platingCount) summary.push(`${platingCount} plated item${platingCount === 1 ? '' : 's'} → PickPack "Needs Plating"`);
            if (millingCount) summary.push(`${millingCount} milling WO${millingCount === 1 ? '' : 's'} for the raw base → RTG Dispatch`);
            if (poCreated) summary.push(`1 vendor PO`);
            if (!summary.length) return alert("Nothing dispatched.");
            alert(`✅ Dispatched:\n\n• ${summary.join('\n• ')}` + (platingCount ? `\n\n(If "Needs Plating" looks empty, publish the plating_demand firestore rule.)` : ''));
            setOrderDrafts({});
        } catch(e) {
            console.error("PO/Plating Push Error", e);
            alert("Failed to dispatch. Check console.");
        }
    };

    const pushWOsToDispatch = async () => {
        const lineItems = Object.entries(orderDrafts).map(([partId, qty]) => {
            if (!qty || qty <= 0) return null;
            return { partId, qty };
        }).filter(Boolean);

        if (lineItems.length === 0) return alert("No items have quantities entered greater than 0.");

        try {
            for (const { partId, qty } of lineItems) {
                const part = hqParts.find(p => p.id === partId);
                const erpId = part.legacyErpId || part.itemId || '';
                
                const isPhosphate = erpId.toUpperCase().endsWith('/P');
                const isPlating = /EP[1-6]$/i.test(erpId.toUpperCase());
                
                const rootErpId = erpId.replace(/\/(P|EP[1-6])$/i, '');
                const rootPart = hqParts.find(p => (p.legacyErpId || p.itemId || '').toUpperCase() === rootErpId) || part;

                // Firestore doc ids can't contain "/" — finished variants carry it (e.g. H1-138BF/EP1). Sanitize
                // it out of the DOC id; keep the true code on the record (woDisplayId / variantErpId) for display.
                const stamp = Date.now().toString().slice(-6);
                const safeErp = String(erpId).replace(/[^A-Za-z0-9]+/g, '-');
                const newWoId = `WO-${safeErp}-${stamp}`;
                await setDoc(doc(db, "hq_work_orders", newWoId), {
                    id: newWoId,
                    woId: newWoId,
                    woDisplayId: `WO-${erpId}-${stamp}`,
                    brand: activeBrand,
                    status: "Approved",
                    customer: "Internal Stock",
                    hqJobId: rootPart.id,
                    originalVariantId: part.id,
                    variantErpId: erpId,
                    totalParts: Number(qty),
                    reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                    type: "Stock Build",
                    // Scheduler keys for the finishing time matrix (recipe × paintSize × productType).
                    // Carried downstream by RTGDispatch.pushToFinishing onto the fin_workorder.
                    paintSize: (part.manufacturingSpecs?.paintSize || '').toUpperCase() || null,
                    productType: (part.manufacturingSpecs?.productType || part.productType || '').toUpperCase() || null,
                    routingType: part.routingType || 'Standard',
                    needsPhosphating: isPhosphate,
                    isPlatingDemand: isPlating,
                    rootItem: rootErpId,
                    createdAt: Date.now()
                });
            }
            
            addLog(`✅ Pushed ${lineItems.length} Work Orders to RTG Dispatch!`, "success");
            alert("✅ Work Orders successfully pushed to RTG Dispatch!");
            setOrderDrafts({}); 
        } catch(e) {
            console.error("WO Push Error", e);
            alert("Failed to push Work Orders.");
        }
    };

    // In-progress plating, grouped by the RAW item's ERP id → WIP-Plating column total + popup detail.
    const STAGE_LABEL = { staged: 'Staged', shipped: 'At plater', received: 'Received' };
    const wipByErp = {};
    platingLines.forEach(l => {
        const erp = (l.erpId || '').toUpperCase();
        if (!erp) return;
        if (!wipByErp[erp]) wipByErp[erp] = { qty: 0, lines: [] };
        wipByErp[erp].qty += parseInt(l.qty) || 0;
        wipByErp[erp].lines.push(l);
    });

    // The finished PLATED assembly is built back only on plating completion, so its in-flight qty sits in
    // app-managed plating WIP that NetSuite never counts as "on order". Roll the in-flight plating up by
    // TARGET (the plated assembly erpId) so we can show that as an app-only on-order on the finished item.
    const platingOnOrderByTarget = {};
    platingLines.forEach(l => {
        const tgt = (l.targetErpId || '').toUpperCase();
        if (!tgt) return;
        if (!platingOnOrderByTarget[tgt]) platingOnOrderByTarget[tgt] = { qty: 0, lines: [] };
        platingOnOrderByTarget[tgt].qty += parseInt(l.qty) || 0;
        platingOnOrderByTarget[tgt].lines.push(l);
    });

    // On-Order popup: pull the open PO lines for an item live from NetSuite (authoritative PO data).
    const openPoModal = async (item) => {
        const erp = (item.legacyErpId || item.itemId || '').toUpperCase();
        setPoModal({ erpId: erp, itemName: item.itemName || erp, loading: true, lines: [], error: null });
        try {
            const q = `
                SELECT t.tranid AS po_number, t.id AS po_id, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate,
                       BUILTIN.DF(t.entity) AS vendor, tl.quantity AS qty,
                       tl.quantityshiprecv AS received, tl.rate AS rate
                FROM transaction t
                JOIN transactionline tl ON tl.transaction = t.id
                JOIN item i ON i.id = tl.item
                WHERE t.type = 'PurchOrd'
                  AND UPPER(i.itemid) = '${erp.replace(/'/g, "''")}'
                  AND NVL(tl.quantity, 0) <> NVL(tl.quantityshiprecv, 0)
                ORDER BY t.trandate DESC
            `;
            const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
            const b = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
            setPoModal(m => (m && m.erpId === erp) ? { ...m, loading: false, lines: b.items || [] } : m);
        } catch (e) {
            setPoModal(m => (m && m.erpId === erp) ? { ...m, loading: false, error: e.message || String(e) } : m);
        }
    };

    // Stocked-items sales snapshot, read STRAIGHT FROM NETSUITE (synced parts can lag). ONE ROW PER STOCKED
    // item (custitem27='T'). NAMING (NetSuite realignment 2026-07-11): stocked items now carry the CLEAN
    // SKU ("HAFICBR1/BL"); their OLD counterpart (custitem28='T', the sales history we keep) is
    // "STD-<SKU>". The prior scheme (new = "<base>-N", old = "<base>") is kept as a fallback for any
    // stragglers. Each month cell shows the CURRENT item's sales in BLACK, falling back to the OLD
    // item's sales in BLUE where the current item had none — so a renamed SKU reads blue on the left and
    // fills black from the right over time. Sales are CHUNKED (60 ids/query) to stay under NetSuite's
    // 1000-row SuiteQL cap (that truncation was why items showed no history).
    const openSalesHistory = async () => {
        const months = last12Months(new Date());
        setSalesHist({ loading: true, error: null, rows: [], months, generatedAt: new Date().toLocaleString(), withOld: 0 });
        setSalesHistSearch('');
        try {
            const sub = (BRAND_NETSUITE_MAP[activeBrand] || {}).subsidiary || '2';
            const retiredIds = (retiredDoc.internalIds || []).map(x => parseInt(x)).filter(n => !isNaN(n));
            const flagWhere = `(i.custitem27 = 'T' OR i.custitem28 = 'T'${retiredIds.length ? ` OR i.id IN (${retiredIds.join(',')})` : ''})`;
            const runSql = async (q) => {
                const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
                const b = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
                return b.items || [];
            };
            // 1) Item universe: stocked items (the rows) + old items (the blue fallback source).
            // ROWS require an ACTIVE item — an inactive item with a stray Stocked flag was surfacing
            // (H1-2RCTAR). Old/retired history donors stay includable regardless of active state.
            const itemRows = await runSql(`SELECT i.id AS internal_id, i.itemid AS itemid, i.custitem27 AS stk, i.custitem28 AS old, i.isinactive AS inact FROM item i JOIN ItemSubsidiaryMap ism ON ism.item = i.id WHERE ism.subsidiary = ${sub} AND ${flagWhere}`);
            const stocked = [], oldByItemId = {};
            itemRows.forEach(row => {
                const rec = { internalId: String(row.internal_id), itemid: row.itemid };
                if (row.stk === 'T' && row.inact !== 'T') stocked.push(rec);
                if (row.old === 'T') oldByItemId[String(row.itemid).toUpperCase()] = rec;
            });
            // 2) Sales, CHUNKED so each grouped query stays under the 1000-row cap (chunk × 12 months < 1000).
            const allIds = itemRows.map(r => String(r.internal_id));
            const salesById = {};
            const CH = 60;
            for (let i = 0; i < allIds.length; i += CH) {
                const chunk = allIds.slice(i, i + CH);
                const rows = await runSql(`SELECT tl.item AS internal_id, TO_CHAR(t.trandate,'YYYY-MM') AS ym, SUM(ABS(tl.quantity)) AS qty, COUNT(DISTINCT t.id) AS orders FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.type = 'SalesOrd' AND tl.item IN (${chunk.join(',')}) AND tl.quantity <> 0 AND t.trandate >= ADD_MONTHS(CURRENT_DATE, -12) GROUP BY tl.item, TO_CHAR(t.trandate,'YYYY-MM')`);
                rows.forEach(row => {
                    const iid = String(row.internal_id);
                    let rec = salesById[iid]; if (!rec) { rec = { m: {}, orders: 0 }; salesById[iid] = rec; }
                    rec.m[row.ym] = (rec.m[row.ym] || 0) + (parseInt(row.qty) || 0);
                    rec.orders += parseInt(row.orders) || 0;
                });
            }
            // 2b) Live AVAILABLE qty straight from NetSuite (AggregateItemLocation.quantityavailable at the
            // brand's location) — the report used to read the app's nsStock cache, which was empty here.
            const loc = (BRAND_NETSUITE_MAP[activeBrand] || {}).location || '17';
            const availById = {};
            for (let i = 0; i < allIds.length; i += 200) {
                const chunk = allIds.slice(i, i + 200);
                const arows = await runSql(`SELECT ail.item AS internal_id, SUM(ail.quantityavailable) AS avail FROM AggregateItemLocation ail WHERE ail.item IN (${chunk.join(',')}) AND ail.location = ${loc} GROUP BY ail.item`);
                arows.forEach(row => { availById[String(row.internal_id)] = Math.round(Number(row.avail) || 0); });
            }
            // 2c) INBOUND SUPPLY per stocked item: open purchase-order lines (on order from a vendor) +
            // open work orders (in production). Best-effort — a failure here only leaves the On Ord
            // column empty, it never breaks the report.
            const inboundById = {};
            try {
                const pushInb = (row, kind, source, expected) => {
                    const iid = String(row.internal_id);
                    const ordered = Math.abs(parseFloat(row.ordered) || 0);
                    const done = Math.max(0, parseFloat(row.done) || 0);
                    const open = ordered - done;
                    if (open <= 0) return;
                    let rec = inboundById[iid]; if (!rec) { rec = { qty: 0, lines: [] }; inboundById[iid] = rec; }
                    rec.qty += open;
                    rec.lines.push({ kind, tranid: row.tranid, source: source || '', ordered, done, open, expected: expected || '', status: row.statusname || '' });
                };
                const stkIds = stocked.map(x => x.internalId);
                for (let i = 0; i < stkIds.length; i += 150) {
                    const chunk = stkIds.slice(i, i + 150);
                    const poRows = await runSql(`SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate, BUILTIN.DF(t.status) AS statusname, BUILTIN.DF(t.entity) AS vendor, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.type = 'PurchOrd' AND tl.item IN (${chunk.join(',')}) AND NVL(tl.isclosed,'F') = 'F' AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Rejected%'`);
                    poRows.forEach(row => pushInb(row, 'PO', row.vendor, row.duedate));
                    // WOs: the mainline row carries the assembly being built; quantityshiprecv = qty already
                    // built. t.enddate (production end) may not be queryable — fall back to duedate-only.
                    const woSel = (extra) => `SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate${extra}, BUILTIN.DF(t.status) AS statusname, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' WHERE t.type = 'WorkOrd' AND tl.item IN (${chunk.join(',')}) AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Built%'`;
                    let woRows;
                    try { woRows = await runSql(woSel(', t.enddate AS expected')); }
                    catch (weErr) { woRows = await runSql(woSel('')); }
                    woRows.forEach(row => pushInb(row, 'WO', 'Production', row.expected || row.duedate));
                }
            } catch (inbErr) { console.warn('Inbound (PO/WO) fetch failed — On Ord column left empty:', inbErr); }
            // 3) One row per stocked item; pair to the OLD history item: "STD-<SKU>" first (the
            // 2026-07 realignment), then the legacy "<base>-N" → "<base>" scheme for stragglers.
            const rows = stocked.filter(s => !/^STD-/i.test(s.itemid)).map(s => {
                const newRec = salesById[s.internalId] || { m: {}, orders: 0 };
                const stripped = String(s.itemid).replace(/-N$/i, '');
                const oldSib = oldByItemId[('STD-' + stripped).toUpperCase()]
                    || (stripped !== s.itemid ? oldByItemId[stripped.toUpperCase()] : null);
                const base = oldSib ? stripped : null;
                const oldRec = oldSib ? (salesById[oldSib.internalId] || { m: {}, orders: 0 }) : { m: {}, orders: 0 };
                const cells = months.map(mo => {
                    const nq = newRec.m[mo.key] || 0, oq = oldRec.m[mo.key] || 0;
                    if (nq > 0) return { v: nq, src: 'new' };
                    if (oq > 0) return { v: oq, src: 'old' };
                    return { v: 0, src: null };
                });
                const total = cells.reduce((a, c) => a + c.v, 0);
                const newTotal = months.reduce((a, mo) => a + (newRec.m[mo.key] || 0), 0);
                return { itemid: s.itemid, base: s.itemid, internalId: s.internalId, available: availById[s.internalId] || 0, onOrd: (inboundById[s.internalId] || {}).qty || 0, onOrdLines: (inboundById[s.internalId] || {}).lines || [], oldInternalId: oldSib ? oldSib.internalId : null, oldItemId: oldSib ? oldSib.itemid : null, cells, total, newTotal, avg: total / 12, orders: (newRec.orders || 0) + (oldRec.orders || 0), hasOld: !!oldSib };
            }).sort((a, b2) => String(a.itemid).localeCompare(String(b2.itemid), undefined, { numeric: true, sensitivity: 'base' }));
            setSalesHist(s => (s ? { ...s, loading: false, rows, withOld: rows.filter(r => r.hasOld).length } : s));
        } catch (e) {
            setSalesHist(s => (s ? { ...s, loading: false, error: e.message || String(e) } : s));
        }
    };

    const downloadSalesHistoryCsv = () => {
        if (!salesHist || !salesHist.rows.length) return;
        const months = salesHist.months;
        const esc = (c) => `"${String(c).replace(/"/g, '""')}"`;
        const lines = [['Stocked Item', 'OLD int.ID', ...months.map(m => m.label), 'Merged 12-mo Total', 'New-only Total', 'Orders', 'On Order (PO+WO)'].map(esc).join(',')];
        salesHist.rows.forEach(r => {
            lines.push([r.itemid, r.oldInternalId || '', ...r.cells.map(c => c.v), r.total, r.newTotal, r.orders, Math.round(r.onOrd || 0)].map(esc).join(','));
        });
        const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = `stocked_sales_history_${activeBrand}_12mo.csv`; a.click();
        URL.revokeObjectURL(url);
    };

    // Lock the OLD counterparts (custitem28 "STD-" items paired to a stocked row) by internal ID →
    // system/retired_items, so the app-wide hide works even before the next NetSuite sync.
    const lockRetiredByInternalId = async () => {
        const olds = (salesHist?.rows || []).filter(r => r.hasOld).map(r => ({ internalId: String(r.oldInternalId), itemid: r.oldItemId || r.base, base: r.base }));
        if (!olds.length) return alert('No OLD counterparts found to lock.');
        if (!window.confirm(`Lock ${olds.length} OLD item(s) by NetSuite internal ID?\n\nThey'll be hidden from the app's browse/select screens (kept only here). Re-syncing the Master Library also hides them automatically via the custitem28 flag.`)) return;
        try {
            const ref = doc(db, 'system', 'retired_items');
            const snap = await getDoc(ref);
            const map = {};
            (snap.exists() ? (snap.data().items || []) : []).forEach(it => { if (it && it.internalId) map[String(it.internalId)] = it; });
            olds.forEach(o => { map[String(o.internalId)] = o; });
            const items = Object.values(map);
            await setDoc(ref, { internalIds: items.map(i => i.internalId), items, updatedAt: new Date().toISOString(), updatedBy: currentUser || '' }, { merge: true });
            addLog(`🔒 Locked ${olds.length} OLD counterpart(s) by internal ID (${items.length} total retired).`, 'success');
        } catch (e) { addLog(`Lock failed: ${e.message}`, 'error'); alert('Lock failed: ' + e.message); }
    };

    // ---- REORDER + WORK-ORDER MATH (right side of the Sales Snapshot) ----
    // Cross-ref a report row (NetSuite item) back to the app's part for paintSize/productType.
    const partByKey = {};
    hqParts.forEach(p => {
        if (p.netSuiteInternalId != null) partByKey['id:' + String(p.netSuiteInternalId)] = p;
        const e = (p.legacyErpId || p.itemId || '').toUpperCase();
        if (e) partByKey['erp:' + e] = p;
    });
    // Finish/recipe = the code after the last "/", up to the first "-" (e.g. BL-N→BL, CP-10-N→CP, P01→P01).
    // The "-N" is a temporary new-item marker and any "-10"/"-12" is a size, not part of the finish.
    const finishOf = (itemid) => { const s = String(itemid || ''); const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1).split('-')[0].toUpperCase() : ''; };
    const POLE_RACK = 8; // poles are painted 8 per rack (not sled-packed by S/M/L)
    // RING PACKS (Stuart 2026-07-17): "BASE/FIN-EA" = the stocked SINGLE; "BASE/FIN-7/-10/-12"
    // (any digits, WITH an -EA sibling in the report) = customer pack ASSEMBLIES of that single —
    // no longer stocked. Packs are analysis-only rows: their demand (× pack size) and their
    // remaining shelf stock (× pack size) roll into the single's numbers, and ordering happens
    // on the -EA row only. Same per finish (SG packs → SG single, BL → BL, …).
    const packMap = (() => {
        const rowsAll = salesHist?.rows || [];
        const ids = new Set(rowsAll.map(r => String(r.itemid).toUpperCase()));
        const m = new Map();
        rowsAll.forEach(r => {
            const id = String(r.itemid).toUpperCase();
            const mt = id.match(/^(.+\/[A-Z0-9]+)-(\d+)$/);
            if (mt && ids.has(`${mt[1]}-EA`)) m.set(id, { isPack: true, size: parseInt(mt[2]), singleId: `${mt[1]}-EA` });
        });
        rowsAll.forEach(r => {
            const id = String(r.itemid).toUpperCase();
            if (!id.endsWith('-EA')) return;
            const packs = rowsAll.filter(x => m.get(String(x.itemid).toUpperCase())?.singleId === id);
            if (!packs.length) return;
            const sz = (x) => m.get(String(x.itemid).toUpperCase()).size;
            m.set(id, {
                isSingle: true,
                packItemIds: packs.map(p => p.itemid),
                extraTotal: packs.reduce((s, p) => s + (p.total || 0) * sz(p), 0),
                extra6: packs.reduce((s, p) => s + (p.cells || []).slice(-6).reduce((a, c) => a + (c.v || 0), 0) * sz(p), 0),
                packAvailEq: packs.reduce((s, p) => s + Math.round(Number(p.available) || 0) * sz(p), 0)
            });
        });
        return m;
    })();
    // Per-row reorder analysis (Stuart 2026-07-17 rules):
    //   OUTSOURCED (isInHouse === false + vendor + NOT an assembly): Min OH = 6 MONTHS of
    //     demand (12-mo total ÷ 2) — a safe-stock buffer so we can't run out inside 6 months.
    //   ASSEMBLY (finished in-house): Min OH = 6 WEEKS of demand (12-mo weekly avg × 6) —
    //     3-week finishing lead + 3-week safety stock.
    //   Anything else keeps the legacy 4-weeks-of-6-month-rate rule.
    // ROP (manufacturingSpecs.reorderPoint — editable here, pushed to the Master Library, and
    // the same field the main grid's low-stock flag reads) OVERRIDES the calculated Min OH
    // when set. Shortfall counts stock ON ORDER (open POs + the Route A work orders) so we
    // never double-order; Recommended rounds up to a finishing batch (sled by size / rack of 8).
    const reorderFor = (r) => {
        const part = partByKey['id:' + String(r.internalId)] || partByKey['erp:' + String(r.itemid).toUpperCase()];
        const specs = part?.manufacturingSpecs || {};
        const size = (specs.paintSize || '').toUpperCase();
        const ptype = (specs.productType || '').toUpperCase();
        const isPole = /POLE|ROD/.test(ptype);
        const isAssembly = part?.partClass === 'Assembly' || part?.netSuiteRecordType === 'assemblyitem';
        const isOutsourced = specs.isInHouse === false && !!String(specs.vendorName || '').trim() && !isAssembly;
        let available = Math.round(Number(r.available) || 0);
        const onOrd = Math.round(Number(r.onOrd) || 0);
        const pk = packMap.get(String(r.itemid).toUpperCase());
        if (pk && pk.isPack) {
            // Pack assemblies aren't ordered here — they build from -EA singles at pick.
            return { part, size, ptype, isPole: false, isAssembly, isOutsourced: false, isPack: true, packSingle: pk.singleId, packSize: pk.size, available, onOrd, minOnHand: 0, minRule: `Pack of ${pk.size} — demand + ordering roll into ${pk.singleId}`, rop: null, threshold: 0, cap: 0, recommended: 0 };
        }
        let total12 = Number(r.total) || 0;
        let last6 = (r.cells || []).slice(-6).reduce((s, c) => s + (c.v || 0), 0); // merged (new+old) last 6 months
        let packNote = '';
        if (pk && pk.isSingle) {
            // The single carries ALL demand in single units: its own EA sales + pack sales × size;
            // available counts remaining pack shelf stock as single-equivalents.
            total12 += pk.extraTotal;
            last6 += pk.extra6;
            available += pk.packAvailEq;
            packNote = ` — incl. ${pk.extraTotal} singles of pack demand from ${pk.packItemIds.length} pack SKU(s)`;
        }
        let minOnHand, minRule;
        if (isOutsourced) { minOnHand = Math.round(total12 / 2); minRule = 'Outsourced: 6 months of demand' + packNote; }
        else if (isAssembly) { minOnHand = Math.round((total12 / 52) * 6); minRule = 'Assembly: 6 weeks of demand (3wk finishing lead + 3wk safety)' + packNote; }
        else { minOnHand = Math.round((last6 / 26) * 4); minRule = 'Legacy: 4 weeks of the 6-month rate' + packNote; }
        const ropRaw = specs.reorderPoint;
        const rop = (ropRaw === '' || ropRaw === undefined || ropRaw === null) ? null : (parseInt(ropRaw) || 0);
        const threshold = (rop !== null && rop > 0) ? rop : minOnHand;
        const cap = isPole ? POLE_RACK : (lookupCapacity(capacityMatrix, size, ptype) || SIZE_CAPACITY[size] || 0);
        const shortfall = Math.max(0, threshold - (available + onOrd));
        const recommended = shortfall > 0 ? (cap > 0 ? Math.ceil(shortfall / cap) * cap : shortfall) : 0;
        return { part, size, ptype, isPole, isAssembly, isOutsourced, isSingleAgg: !!(pk && pk.isSingle), packCount: pk && pk.isSingle ? pk.packItemIds.length : 0, available, onOrd, minOnHand, minRule, rop, threshold, cap, recommended };
    };

    // Push edited ROPs → Master Library (manufacturingSpecs.reorderPoint). Keyed by ERP code so
    // the same editor serves both the finished view and the RAW-cores view.
    const saveRops = async () => {
        const entries = Object.entries(ropEdits);
        if (!entries.length) return;
        setRopSaving(true);
        let saved = 0; const missed = [];
        for (const [erp, val] of entries) {
            const part = partByKey['erp:' + erp];
            if (!part?.id) { missed.push(erp); continue; }
            try {
                await updateDoc(doc(db, 'Approved_Designs', part.id), { 'manufacturingSpecs.reorderPoint': val === '' ? '' : (parseInt(val) || 0) });
                saved++;
            } catch (e) { missed.push(erp); }
        }
        setRopEdits({});
        setRopSaving(false);
        addLog(`ROP push: ${saved} saved to the Master Library${missed.length ? `, ${missed.length} unmatched/failed (${missed.slice(0, 5).join(', ')})` : ''}.`, missed.length ? 'warn' : 'success');
        if (missed.length) alert(`⚠ ${missed.length} item(s) have no matching Master Library part — sync them first:\n\n${missed.slice(0, 10).join('\n')}`);
    };

    // RAW-CORES stock: live NetSuite avail + open PO/WO for the BASE items behind the finish
    // variants (HCUSMBF1/BL,/CP,/SG → HCUSMBF1). Fetched once per report on first RAW toggle.
    const loadRawStock = async () => {
        setRawStock({ loading: true });
        try {
            const bases = new Set();
            (salesHist?.rows || []).forEach(r => { const id = String(r.itemid); const cut = id.lastIndexOf('/'); if (cut > 0) bases.add(id.slice(0, cut).toUpperCase()); });
            const ids = [...bases].map(b => partByKey['erp:' + b]?.netSuiteInternalId).filter(Boolean).map(String);
            const loc = (BRAND_NETSUITE_MAP[activeBrand] || {}).location || '17';
            const runSql = async (q) => {
                const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
                const b = await r.json().catch(() => ({}));
                if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b).slice(0, 300) : String(b));
                return b.items || [];
            };
            const availById = {};
            for (let i = 0; i < ids.length; i += 200) {
                const ch = ids.slice(i, i + 200);
                (await runSql(`SELECT ail.item AS internal_id, SUM(ail.quantityavailable) AS avail FROM AggregateItemLocation ail WHERE ail.item IN (${ch.join(',')}) AND ail.location = ${loc} GROUP BY ail.item`))
                    .forEach(row => { availById[String(row.internal_id)] = Math.round(Number(row.avail) || 0); });
            }
            const inboundById = {};
            const pushInb = (row, kind, source, expected) => {
                const iid = String(row.internal_id);
                const ordered = Math.abs(parseFloat(row.ordered) || 0);
                const done = Math.max(0, parseFloat(row.done) || 0);
                const open = ordered - done;
                if (open <= 0) return;
                let rec = inboundById[iid]; if (!rec) { rec = { qty: 0, lines: [] }; inboundById[iid] = rec; }
                rec.qty += open;
                rec.lines.push({ kind, tranid: row.tranid, source: source || '', ordered, done, open, expected: expected || '', status: row.statusname || '' });
            };
            for (let i = 0; i < ids.length; i += 150) {
                const ch = ids.slice(i, i + 150);
                (await runSql(`SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate, BUILTIN.DF(t.status) AS statusname, BUILTIN.DF(t.entity) AS vendor, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.type = 'PurchOrd' AND tl.item IN (${ch.join(',')}) AND NVL(tl.isclosed,'F') = 'F' AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Rejected%'`))
                    .forEach(row => pushInb(row, 'PO', row.vendor, row.duedate));
                (await runSql(`SELECT tl.item AS internal_id, t.tranid AS tranid, t.duedate AS duedate, BUILTIN.DF(t.status) AS statusname, ABS(NVL(tl.quantity,0)) AS ordered, NVL(tl.quantityshiprecv,0) AS done FROM transaction t JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T' WHERE t.type = 'WorkOrd' AND tl.item IN (${ch.join(',')}) AND BUILTIN.DF(t.status) NOT LIKE '%Closed%' AND BUILTIN.DF(t.status) NOT LIKE '%Built%'`))
                    .forEach(row => pushInb(row, 'WO', 'Production', row.duedate));
            }
            setRawStock({ loading: false, availById, inboundById });
        } catch (e) {
            setRawStock({ loading: false, error: e.message || String(e), availById: {}, inboundById: {} });
        }
    };

    // ---- ORDER GENERATION (Stuart 2026-07-14) -------------------------------------------------
    // The Order column is ALWAYS manually entered (Rec is guidance, never auto-filled). Rows with a
    // qty route by sourcing: BOUGHT items (isInHouse false + vendor) group into ONE app PO per
    // vendor (hq_purchase_orders, status Approved → RTG Dispatch pushes each to NetSuite); MADE
    // items get one WO per row PARKED IN RTG DISPATCH (Stuart 2026-07-16: same control gate as
    // the POs — nothing reaches the floor un-reviewed); in-house items that ALSO carry a vendor
    // prompt per item — PO to the vendor or WO to the floor.
    const createStockFinWOs = async (toMake) => {
        let n = 0;
        {
            const reqDate = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            for (const { r, info, qty } of toMake) {
                const finish = finishOf(r.itemid);
                const woId = `WO-STK-${r.internalId}-${Date.now()}`;
                // Poles are racked (8/rack), not sled-packed → no paintSizes; carry poles.qty so the planner
                // treats it as a rack-based workstream. Small parts carry the S/M/L size for sled packing.
                const paintSizes = (!info.isPole && ['S', 'M', 'L'].includes(info.size)) ? { S: 0, M: 0, L: 0, [info.size]: qty } : null;
                // The COMPLETE finishing doc is pre-built here but PARKED on the RTG work order —
                // it reaches fin_workorders only when RTG "Push to Finishing" releases it
                // (verbatim copy, so pole/rack/stock fields survive the review hop untouched).
                const finPayload = {
                    id: woId, displayId: woId, woNum: woId, orderKey: woId,
                    quoteId: null, salesOrderId: null, estimateId: null,
                    orderType: 'stock', soId: null, soNum: null,
                    customerId: null, customerName: 'Internal Stock', customer: 'Internal Stock', clientName: 'Internal Stock',
                    recipe: finish || 'PENDING-RECIPE',
                    reqDate, type: r.itemid, totalParts: qty,
                    stockErpId: r.itemid, stockInternalId: r.internalId,
                    paintSize: info.isPole ? null : (info.size || null), productType: info.ptype || null, paintSizes,
                    ...(info.isPole ? { poles: { qty, type: info.ptype || 'POLE' }, totalPoles: qty } : {}),
                    note: `Stock replenish · avail ${info.available} · min ${info.minOnHand}${info.isPole ? ' · POLE (rack of 8)' : ''}`,
                    cpqSpecs: {}, imageUrl: info.part?.finalImageUrl || null,
                    dimensions: { length: 0, width: 0, height: 0 },
                    partsList: [],
                    currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
                    tasks: makeFullTasks(),
                    machineAssigned: null, redlineAlert: false,
                    sentToPickPack: false, pickStatus: 'Pending',
                    shopSiblingId: null, hasCustomSibling: false, customFabStatus: 'Pending',
                    brand: activeBrand, createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser || ''
                };
                await setDoc(doc(db, "hq_work_orders", woId), {
                    id: woId, woId, brand: activeBrand, type: 'Stock', status: 'Approved',
                    source: 'SALES_SNAPSHOT', routeTo: 'FINISHING', finPayload,
                    erpId: r.itemid, recipe: finish || 'PENDING-RECIPE', qty, totalParts: qty, reqDate,
                    paintSize: info.size || null, customer: 'Internal Stock',
                    createdAt: Date.now(), createdBy: currentUser || ''
                }, { merge: true });
                n++;
            }
        }
        return n;
    };
    // NetSuite vendor alignment: library vendor NAMES ↔ the synced CRM vendor records
    // (crm_records VEND-<netsuite id>, from 11.1 "Sync Active Vendors"). The vendor's INTERNAL id
    // is stamped on the PO at CREATION, so the NetSuite push can never mis-resolve — an unmatched
    // vendor blocks that PO with a fix-it message instead of erroring downstream.
    const vendorsCacheRef = useRef(null);
    const loadNsVendors = async () => {
        if (vendorsCacheRef.current) return vendorsCacheRef.current;
        const snap = await getDocs(query(collection(db, 'crm_records'), where('type', '==', 'VENDOR')));
        vendorsCacheRef.current = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        return vendorsCacheRef.current;
    };
    const normVend = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const resolveVendorRec = (vendors, name) => {
        const n = normVend(name);
        if (!n) return null;
        return vendors.find(v => normVend(v.name) === n)
            || vendors.find(v => normVend(v.name).startsWith(n) || n.startsWith(normVend(v.name)))
            || null;
    };
    // One app PO per vendor (same doc shape as the grid's PO builder — lands in RTG Dispatch, which
    // pushes it to NetSuite). Lines carry the NetSuite ITEM internal id; the doc carries the
    // NetSuite VENDOR internal id. Returns { made, unmatched }.
    const createStockPOs = async (buyList) => {
        const vendors = await loadNsVendors();
        const byVendor = new Map();
        buyList.forEach(x => {
            const v = String(x.info.part?.manufacturingSpecs?.vendorName || '').trim();
            if (!byVendor.has(v)) byVendor.set(v, []);
            byVendor.get(v).push(x);
        });
        const made = [], unmatched = [];
        for (const [vendor, list] of byVendor.entries()) {
            const rec = resolveVendorRec(vendors, vendor);
            if (!rec) { unmatched.push({ vendor, items: list.map(x => x.r.itemid) }); continue; }
            const nsVendorId = String(rec.id || '').replace(/^VEND-/, '');
            const newPoId = `PO-${(vendor || 'VEND').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5)}-${Date.now().toString().slice(-6)}`;
            const items = list.map(({ r, info, qty }) => ({
                itemId: info.part?.legacyErpId || info.part?.itemId || r.itemid,
                nsItemId: String(r.internalId),   // NetSuite item internal id — the push builds real lines from this
                vendorPart: info.part?.manufacturingSpecs?.vendorId || 'N/A',
                quantity: qty, rate: info.part?.manufacturingSpecs?.cost || 0,
                description: info.part?.itemName || r.itemid
            }));
            await setDoc(doc(db, "hq_purchase_orders", newPoId), {
                id: newPoId, poId: newPoId, brand: activeBrand, status: "Approved",
                vendor: rec.name || vendor, nsVendorId, vendorCrmId: rec.id,
                items, source: 'SALES_SNAPSHOT',
                reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0], createdAt: Date.now(), createdBy: currentUser || ''
            });
            made.push({ vendor: rec.name || vendor, lines: items.length });
            addLog(`✅ PO ${newPoId} → ${rec.name || vendor} (NS vendor ${nsVendorId}, ${items.length} line${items.length === 1 ? '' : 's'}).`, 'success');
        }
        if (unmatched.length) {
            alert(`⚠️ NO PO created for ${unmatched.length} vendor(s) — the name on the items doesn't match any NetSuite-synced vendor (11.1 → Sync Active Vendors):\n\n${unmatched.map(u => `• "${u.vendor || '(blank)'}" — ${u.items.slice(0, 6).join(', ')}${u.items.length > 6 ? '…' : ''}`).join('\n')}\n\nFix the vendor name in the Master Library (or sync vendors), then re-generate those items.`);
        }
        return { made, unmatched };
    };
    const executeOrders = async (buy, make) => {
        const pieces = [];
        if (buy.length) pieces.push(`${new Set(buy.map(x => String(x.info.part?.manufacturingSpecs?.vendorName || '').trim())).size} vendor PO(s) covering ${buy.length} item(s)`);
        if (make.length) pieces.push(`${make.length} stock work order(s)`);
        if (!pieces.length) return alert('Nothing to generate.');
        if (!window.confirm(`Generate:\n\n• ${pieces.join('\n• ')}\n\nBOTH land in RTG Dispatch for review: POs (one per vendor) push to NetSuite from there; work orders release to the Finishing Floor from there. Nothing reaches NetSuite or the floor until dispatched.`)) return;
        setGenBusy(true);
        try {
            const poResult = buy.length ? await createStockPOs(buy) : { made: [], unmatched: [] };
            const wos = make.length ? await createStockFinWOs(make) : 0;
            setOrderQty({});
            const lines = [
                ...poResult.made.map(p => `• PO → ${p.vendor} (${p.lines} lines) — push to NetSuite from RTG Dispatch`),
                ...(wos ? [`• ${wos} stock work order(s) → RTG Dispatch (release to Finishing there)`] : []),
            ];
            if (lines.length) alert(`✅ Generated:\n${lines.join('\n')}`);
        } catch (e) { addLog(`Generate orders failed: ${e.message}`, 'error'); alert('Failed to generate orders:\n\n' + (e.message || e)); }
        setGenBusy(false);
    };
    // Router: split the entered rows by sourcing; in-house items that ALSO have a vendor go to the
    // per-item PO-vs-WO chooser first.
    const generateOrders = () => {
        const rows = (salesHist?.rows) || [];
        const toMake = rows.map(r => { const info = reorderFor(r); const qty = parseInt(orderQty[r.internalId]) || 0; return { r, info, qty }; }).filter(x => x.qty > 0);
        if (!toMake.length) return alert('Enter an Order quantity on at least one row first — the Rec column is guidance; Order always starts at 0.');
        const buy = [], make = [], ambiguous = [], noVendor = [];
        toMake.forEach(x => {
            const specs = x.info.part?.manufacturingSpecs || {};
            const vendorName = String(specs.vendorName || '').trim();
            const outsourced = specs.isInHouse === false;
            if (outsourced && vendorName) buy.push(x);
            else if (outsourced && !vendorName) noVendor.push(x);
            else if (vendorName) ambiguous.push(x);
            else make.push(x);
        });
        if (noVendor.length) alert(`⚠️ ${noVendor.length} outsourced item(s) have NO vendor set and were skipped — add the vendor in the Master Library first:\n\n${noVendor.slice(0, 10).map(x => `• ${x.r.itemid}`).join('\n')}`);
        if (ambiguous.length) { setRouteModal({ buy, make, items: ambiguous.map(x => ({ ...x, choice: 'PO' })) }); return; }
        executeOrders(buy, make);
    };

    // --- AGGREGATING DEMAND FROM VARIANTS TO ROOT ITEM ---
    const retiredSet = new Set((retiredDoc.internalIds || []).map(String));
    const enrichedInventory = hqParts.filter(part => part.manufacturingSpecs?.isRetired !== true && !retiredSet.has(String(part.netSuiteInternalId || ''))).map(part => {
        const erpId = (part.legacyErpId || part.itemId).toUpperCase();
        const stock = nsStock[erpId] || { onHand: 0, available: 0, onOrder: 0, committed: 0, backorder: 0 };
        const specs = part.manufacturingSpecs || {};
        
        let aggregatedCommitted = stock.committed;
        let aggregatedBackorder = stock.backorder;

        const isVariant = /\/(P|EP[1-6])$/i.test(erpId);
        if (!isVariant) {
            const variantMatcher = new RegExp(`^${erpId}\\/(P|EP[1-6])$`, 'i');
            Object.entries(nsStock).forEach(([nsId, variantStock]) => {
                if (nsId !== erpId && variantMatcher.test(nsId)) {
                    aggregatedCommitted += (variantStock.committed || 0);
                    aggregatedBackorder += (variantStock.backorder || 0);
                }
            });
        }

        const rop = parseInt(specs.reorderPoint) || 0;
        const moq = parseInt(specs.moq) || 0;
        const leadTime = parseInt(specs.leadTime) || 0;

        return {
            ...part,
            stock: { ...stock, aggregatedCommitted, aggregatedBackorder },
            wip: wipByErp[erpId] || { qty: 0, lines: [] }, // in-progress plating for this item
            rop, moq, leadTime,
            isLowStock: stock.available <= rop && rop > 0
        };
    });

    const baseFilteredItems = enrichedInventory.filter(part => {
        const term = searchQuery.toLowerCase();
        const specs = part.manufacturingSpecs || {};

        const matchesSearch = part.itemName?.toLowerCase().includes(term) || (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term));
        
        let matchesType = typeFilter === "" || (specs.productType || "").toUpperCase() === typeFilter.toUpperCase() || (part.productType || "").toUpperCase() === typeFilter.toUpperCase();
        
        const partCollections = specs.collections ? specs.collections.map(c=>c.toUpperCase()) : (specs.customData?.collection ? [specs.customData.collection.toUpperCase()] : []);
        let matchesCollection = collectionFilter === "" || partCollections.includes(collectionFilter.toUpperCase()); 
        
        let matchesClass = true;
        if (partClassFilter !== "ALL") {
            if (partClassFilter === "INVENTORY") matchesClass = part.partClass === "Inventory" && specs.isInHouse !== false;
            else if (partClassFilter === "OUTSOURCED") matchesClass = part.partClass === "Inventory" && specs.isInHouse === false;
            else if (partClassFilter === "UNASSIGNED") matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && (!part.routingType || part.routingType === "UNASSIGNED");
            else matchesClass = (part.partClass === "Assembly" || part.partClass === "Master Assembly") && part.routingType?.toUpperCase() === partClassFilter.toUpperCase();
        }

        const wl = specs.watchList || specs.customData?.watchlist || "NONE";
        let matchesWatchlist = watchlistFilter === "" || wl.toUpperCase() === watchlistFilter.toUpperCase();
        
        let matchesRop = !filterBelowRop || part.isLowStock;
        let matchesBo = !filterOnBo || part.stock.aggregatedBackorder > 0;

        return matchesSearch && matchesType && matchesCollection && matchesClass && matchesWatchlist && matchesRop && matchesBo;
    });

    let displayItems = baseFilteredItems;
    if (activeBuilder === 'PO' && activeVendor) {
        displayItems = baseFilteredItems.filter(p => p.manufacturingSpecs?.vendorName === activeVendor && !p.manufacturingSpecs?.isInHouse);
    } else if (activeBuilder === 'WO') {
        // Only in-house items flagged STOCKED get replenishment WOs here. In-house NOT-stocked items are
        // made-to-order straight from the sales order, so they never appear in the planning queue.
        displayItems = baseFilteredItems.filter(p => p.manufacturingSpecs?.isInHouse !== false && p.manufacturingSpecs?.isStocked);
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>

            {/* WIP-PLATING POPUP — work orders / finishes currently out for plating for this item */}
            {labelTool && (() => {
                const allBins = Array.from(new Set(hqParts.map(p => (p.manufacturingSpecs?.binLocation || '').toUpperCase()).filter(Boolean))).sort();
                const term = labelSearch.trim().toUpperCase();
                const matchItems = (labelMode === 'items' && term) ? hqParts.filter(p => {
                    const erp = (p.legacyErpId || p.itemId || '').toUpperCase();
                    return erp.includes(term) || (p.itemName || '').toUpperCase().includes(term);
                }).slice(0, 300) : [];
                const matchBins = (labelMode === 'bins' && term) ? allBins.filter(b => b.includes(term)) : [];
                const count = labelMode === 'items' ? matchItems.length : matchBins.length;
                const doBatch = () => {
                    if (labelMode === 'items' && matchItems.length) printItemLabels(matchItems.map(p => ({ itemId: p.legacyErpId || p.itemId, itemName: p.itemName, imageUrl: p.finalImageUrl || p.manufacturingSpecs?.imageUrl || p.imageUrl || '' })));
                    else if (labelMode === 'bins' && matchBins.length) printBinLabels(matchBins);
                };
                const fld = { padding: '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.95rem', width: '100%', boxSizing: 'border-box' };
                return (
                    <div onClick={() => setLabelTool(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '560px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Print Labels</h2>
                                <button onClick={() => setLabelTool(false)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ marginBottom: '28px' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Single bin label</div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input list="all-bins" value={labelBin} onChange={e => setLabelBin(e.target.value.toUpperCase())} placeholder="Enter or pick a bin…" style={fld} />
                                    <datalist id="all-bins">{allBins.map(b => <option key={b} value={b} />)}</datalist>
                                    <button onClick={() => labelBin.trim() && printBinLabel({ bin: labelBin.trim() })} disabled={!labelBin.trim()} style={{ padding: '0 18px', background: labelBin.trim() ? 'var(--ink)' : 'var(--paper-2)', color: labelBin.trim() ? '#fff' : 'var(--ink-soft)', border: labelBin.trim() ? 'none' : '1px solid var(--line)', cursor: labelBin.trim() ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Print</button>
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid var(--line)', paddingTop: '20px' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Batch — search a range, print all matches</div>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                                    {['bins', 'items'].map(m => (
                                        <button key={m} onClick={() => setLabelMode(m)} style={{ flex: 1, padding: '8px', background: labelMode === m ? 'var(--ink)' : '#fff', color: labelMode === m ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{m}</button>
                                    ))}
                                </div>
                                <input value={labelSearch} onChange={e => setLabelSearch(e.target.value)} placeholder={labelMode === 'items' ? 'Item # or name (e.g. H1-75)…' : 'Bin text (e.g. PRD)…'} style={{ ...fld, marginBottom: '12px' }} />
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{!term ? 'Type to search' : `${count} ${labelMode} match${count === 1 ? '' : 'es'}`}{labelMode === 'items' && matchItems.length >= 300 ? ' (capped at 300)' : ''}</span>
                                    <button onClick={doBatch} disabled={count === 0} style={{ padding: '12px 20px', background: count ? 'var(--brass)' : 'var(--paper-2)', color: count ? '#fff' : 'var(--ink-soft)', border: count ? 'none' : '1px solid var(--line)', cursor: count ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Print {count || ''} {labelMode === 'items' ? 'item' : 'bin'} label{count === 1 ? '' : 's'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 📈 SALES HISTORY — stocked (black) + old/retiring (blue) items, real 12-mo history */}
            {salesHist && (() => {
                const OLD_BLUE = '#3f7fc4';
                const term = salesHistSearch.trim().toUpperCase();
                // Watchlist of a snapshot row = its matched library part's watchlist (same resolution
                // as the main grid) — the catalog is growing, so the report needs this narrowing.
                const watchOf = (r) => {
                    const part = partByKey['id:' + String(r.internalId)] || partByKey['erp:' + String(r.itemid).toUpperCase()];
                    const s = part?.manufacturingSpecs || {};
                    const nsW = s.customData?.watchlist && s.customData.watchlist !== 'N/A' ? s.customData.watchlist : '';
                    return String(s.watchList || nsW || 'NONE').toUpperCase();
                };
                const rows = (salesHist.rows || []).filter(r =>
                    (!term || String(r.itemid).toUpperCase().includes(term)) &&
                    (snapWatch === '' || watchOf(r) === snapWatch.toUpperCase()));
                // RAW-CORES view (Stuart 2026-07-17): demand rolled up to the BASE item behind the
                // finish variants (suffix rule — everything before the last "/"; 1 core consumed per
                // finished unit). Rows without a "/" have no separate core and are excluded.
                const rawRows = (() => {
                    if (snapView !== 'RAW') return [];
                    const byBase = new Map();
                    (salesHist.rows || []).forEach(r => {
                        const id = String(r.itemid);
                        const cut = id.lastIndexOf('/');
                        if (cut <= 0) return;
                        const base = id.slice(0, cut).toUpperCase();
                        // Pack rows consume pack-size cores per unit sold (…/SG-12 × 50 = 600 cores).
                        const pk = packMap.get(id.toUpperCase());
                        const mult = pk && pk.isPack ? pk.size : 1;
                        let g = byBase.get(base);
                        if (!g) { g = { base, cells: salesHist.months.map(() => 0), total: 0, orders: 0, variants: [] }; byBase.set(base, g); }
                        r.cells.forEach((c, i) => { g.cells[i] += (c.v || 0) * mult; });
                        g.total += (r.total || 0) * mult; g.orders += r.orders; g.variants.push(mult > 1 ? `${id} (×${mult})` : id);
                    });
                    return [...byBase.values()]
                        .filter(g => !term || g.base.includes(term))
                        .sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
                })();
                // Core default Min OH = 6 MONTHS of the combined variant demand — the sub-screen's
                // whole purpose: never, ever run out of the cores that feed finishing. ROP overrides.
                const rawInfo = (g) => {
                    const part = partByKey['erp:' + g.base];
                    const iid = part?.netSuiteInternalId ? String(part.netSuiteInternalId) : null;
                    const available = (iid && rawStock?.availById) ? Math.round(rawStock.availById[iid] || 0) : 0;
                    const inb = (iid && rawStock?.inboundById) ? rawStock.inboundById[iid] : null;
                    const onOrd = inb ? Math.round(inb.qty) : 0;
                    const specs = part?.manufacturingSpecs || {};
                    const minOnHand = Math.round(g.total / 2);
                    const ropRaw = specs.reorderPoint;
                    const rop = (ropRaw === '' || ropRaw === undefined || ropRaw === null) ? null : (parseInt(ropRaw) || 0);
                    const threshold = (rop !== null && rop > 0) ? rop : minOnHand;
                    const shortfall = Math.max(0, threshold - (available + onOrd));
                    return { part, iid, available, onOrd, onOrdLines: inb ? inb.lines : [], minOnHand, rop, threshold, shortfall, vendored: !!String(specs.vendorName || '').trim() };
                };
                const gt = salesHist.months.map((m, i) => rows.reduce((s, r) => s + (r.cells[i]?.v || 0), 0));
                const gtTotal = rows.reduce((s, r) => s + r.total, 0);
                const reo = rows.map(r => reorderFor(r));
                const totAvail = reo.reduce((s, x) => s + x.available, 0);
                const totMin = reo.reduce((s, x) => s + x.minOnHand, 0);
                const totRec = reo.reduce((s, x) => s + x.recommended, 0);
                const totOrder = rows.reduce((s, r) => s + (parseInt(orderQty[r.internalId]) || 0), 0);
                const totOnOrd = rows.reduce((s, r) => s + (r.onOrd || 0), 0);
                const numTd = { padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', borderBottom: '1px solid var(--paper-2)' };
                const monthTh = { padding: '8px 6px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', borderBottom: '2px solid var(--ink)', whiteSpace: 'nowrap' };
                return (
                    <div onClick={() => setSalesHist(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '28px 32px', width: '97vw', maxWidth: '1900px', maxHeight: '94vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Stocked Items — Sales Snapshot</h2>
                                <button onClick={() => setSalesHist(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '14px' }}>
                                Last 12 months of demand (Sales Orders) per stocked item · {activeBrand?.toUpperCase()} · as of {salesHist.generatedAt}
                                <span style={{ marginLeft: '14px', color: 'var(--ink)' }}>■ current item</span>
                                <span style={{ marginLeft: '10px', color: OLD_BLUE }}>■ old “STD-” item history (fallback)</span>
                                <span style={{ marginLeft: '14px' }}>{salesHist.withOld || 0} of {(salesHist.rows || []).length} have an old version</span>
                            </div>

                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '16px' }}>
                                <input value={salesHistSearch} onChange={e => setSalesHistSearch(e.target.value)} placeholder="Search item # (e.g. HAFICBR1)…" style={{ flex: 1, maxWidth: '300px', padding: '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem' }} />
                                <select value={snapWatch} onChange={e => setSnapWatch(e.target.value)} title="Filter by the item's watchlist (from the Master Library)" style={{ padding: '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem', background: snapWatch ? 'var(--paper-2)' : '#fff' }}>
                                    <option value="">All Watchlists</option>
                                    <option value="NONE">None / Unassigned</option>
                                    {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                                </select>
                                <div style={{ display: 'flex', border: '1px solid var(--line)' }}>
                                    <button onClick={() => setSnapView('FIN')} style={{ padding: '9px 14px', background: snapView === 'FIN' ? 'var(--ink)' : '#fff', color: snapView === 'FIN' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Finished Items</button>
                                    <button onClick={() => { setSnapView('RAW'); if (!rawStock) loadRawStock(); }} title="Demand rolled up to the RAW core behind each finish variant (…/BL + /CP + /SG → base item) — set core ROPs so finishing never runs out of parts" style={{ padding: '9px 14px', background: snapView === 'RAW' ? 'var(--ink)' : '#fff', color: snapView === 'RAW' ? '#fff' : 'var(--ink-soft)', border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Raw Cores (BOM)</button>
                                </div>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{salesHist.loading ? 'Loading…' : `${snapView === 'RAW' ? rawRows.length : rows.length} item${(snapView === 'RAW' ? rawRows.length : rows.length) === 1 ? '' : 's'}`}</span>
                                {Object.keys(ropEdits).length > 0 && (
                                    <button onClick={saveRops} disabled={ropSaving} title="Write the edited re-order points to the Master Library (manufacturingSpecs.reorderPoint)" style={{ padding: '9px 16px', background: ropSaving ? 'var(--paper-2)' : 'var(--brass)', color: ropSaving ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: ropSaving ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{ropSaving ? 'Saving…' : `⬆ Save ${Object.keys(ropEdits).length} ROP(s)`}</button>
                                )}
                                <button onClick={lockRetiredByInternalId} disabled={!salesHist.withOld} title="Notate the OLD counterparts by NetSuite internal ID and hide them app-wide" style={{ marginLeft: 'auto', padding: '9px 16px', background: salesHist.withOld ? 'var(--brass)' : 'var(--paper-2)', color: salesHist.withOld ? '#fff' : 'var(--ink-soft)', border: salesHist.withOld ? 'none' : '1px solid var(--line)', cursor: salesHist.withOld ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>🔒 Lock {salesHist.withOld || ''} OLD</button>
                                <button onClick={downloadSalesHistoryCsv} disabled={!rows.length} style={{ padding: '9px 16px', background: rows.length ? 'var(--ink)' : 'var(--paper-2)', color: rows.length ? '#fff' : 'var(--ink-soft)', border: rows.length ? 'none' : '1px solid var(--line)', cursor: rows.length ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⬇ Download CSV</button>
                                <button onClick={generateOrders} disabled={genBusy || !rows.length || snapView === 'RAW'} title={snapView === 'RAW' ? 'Ordering runs from the Finished view — the Raw Cores view sets thresholds (ROPs); low cores then flag on the main stock grid' : 'Route every row with an Order qty: bought items → ONE PO per vendor (RTG Dispatch pushes to NetSuite); made items → RTG-parked work orders; in-house items with a vendor ask PO-or-WO per item'} style={{ padding: '9px 16px', background: (genBusy || snapView === 'RAW') ? 'var(--paper-2)' : '#3a7d44', color: (genBusy || snapView === 'RAW') ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: genBusy ? 'wait' : (snapView === 'RAW' ? 'not-allowed' : 'pointer'), fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{genBusy ? 'Generating…' : '⚙ Generate Orders (PO + WO)'}</button>
                            </div>

                            <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--line)' }}>
                                {salesHist.loading ? (
                                    <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>Querying NetSuite sales history…</div>
                                ) : salesHist.error ? (
                                    <div style={{ padding: '32px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '12px' }}>Failed: {salesHist.error}</div>
                                ) : snapView === 'RAW' ? (
                                    rawStock?.loading ? (
                                        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>Pulling raw-core stock from NetSuite…</div>
                                    ) : rawRows.length === 0 ? (
                                        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>No finish-variant items{term ? ' match your search' : ''} — nothing to roll up to raw cores.</div>
                                    ) : (
                                        <>
                                            {rawStock?.error && <div style={{ padding: '10px 16px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px', borderBottom: '1px solid var(--line)' }}>⚠ Stock pull failed ({rawStock.error}) — demand shows; Avail/On-Ord may be blank.</div>}
                                            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                                                <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 5 }}>
                                                    <tr>
                                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '2px solid var(--ink)', position: 'sticky', left: 0, background: 'var(--paper)' }}>Raw Core (BOM base)</th>
                                                        {salesHist.months.map(m => <th key={m.key} style={monthTh}>{m.label}</th>)}
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>Total</th>
                                                        <th style={monthTh}>Avg/mo</th>
                                                        <th style={monthTh} title="How many finish variants consume this core">Variants</th>
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '2px solid var(--ink)' }} title="Raw core's own NetSuite quantity available">Avail</th>
                                                        <th style={{ ...monthTh, color: '#3f7fc4' }} title="Open POs / work orders for the raw core">On Ord</th>
                                                        <th style={monthTh} title="Core default: 6 MONTHS of the combined variant demand — never run out of the cores that feed finishing">Min OH</th>
                                                        <th style={{ ...monthTh, color: 'var(--brass)' }} title="Core re-order point — ⬆ Save pushes to the Master Library; low cores then flag on the main stock grid">ROP</th>
                                                        <th style={{ ...monthTh, color: '#d9534f' }} title="Deficit vs (ROP or Min OH) counting stock on order">Short</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rawRows.map(g => {
                                                        const ri = rawInfo(g);
                                                        return (
                                                        <tr key={g.base}>
                                                            <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }} title={`Feeds: ${g.variants.join(', ')}`}>
                                                                {g.base}{!ri.part && <span title="No matching Master Library part — sync it to get stock + ROP" style={{ color: '#d9534f', fontSize: '9px' }}> · UNLINKED</span>}{ri.part && ri.vendored && <span style={{ color: '#3f7fc4', fontSize: '9px' }}> · VENDOR</span>}
                                                            </td>
                                                            {g.cells.map((v, i) => <td key={salesHist.months[i].key} style={{ ...numTd, color: v ? 'var(--ink)' : 'var(--line)' }}>{v || '·'}</td>)}
                                                            <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{g.total || '·'}</td>
                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{(g.total / 12).toFixed(1)}</td>
                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{g.variants.length}</td>
                                                            <td style={{ ...numTd, color: ri.available <= ri.threshold ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }}>{ri.iid ? ri.available : '—'}</td>
                                                            <td style={{ ...numTd }}>{ri.onOrd > 0 ? <button onClick={() => setOnOrdModal({ itemid: g.base, onOrd: ri.onOrd, onOrdLines: ri.onOrdLines })} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{ri.onOrd}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }} title="6 months of combined variant demand">{ri.minOnHand || '·'}</td>
                                                            <td style={{ ...numTd }}><input type="number" min="0" value={ropEdits[g.base] ?? (ri.rop ?? '')} placeholder="—" disabled={!ri.part} title={ri.part ? 'Core re-order point — ⬆ Save pushes to the Master Library' : 'No matching Master Library part'} onChange={e => setRopEdits(prev => ({ ...prev, [g.base]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: ropEdits[g.base] !== undefined ? '2px solid var(--brass)' : '1px solid var(--line)', outline: 'none', background: ri.part ? '#fff' : 'var(--paper-2)' }} /></td>
                                                            <td style={{ ...numTd, fontWeight: 600, color: ri.shortfall > 0 ? '#d9534f' : 'var(--line)' }}>{ri.shortfall || '·'}</td>
                                                        </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </>
                                    )
                                ) : rows.length === 0 ? (
                                    <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>No stocked items{term ? ' match your search' : ' — flag items stocked (custitem27) in NetSuite'}.</div>
                                ) : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                                        <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 5 }}>
                                            <tr>
                                                <th style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '2px solid var(--ink)', position: 'sticky', left: 0, background: 'var(--paper)' }}>Stocked Item</th>
                                                <th style={{ ...monthTh, textAlign: 'left' }}>OLD int.ID</th>
                                                {salesHist.months.map(m => <th key={m.key} style={monthTh}>{m.label}</th>)}
                                                <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>Total</th>
                                                <th style={monthTh}>Avg/mo</th>
                                                <th style={monthTh}>Orders</th>
                                                <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '2px solid var(--ink)' }} title="NetSuite quantity available">Avail</th>
                                                <th style={{ ...monthTh, color: '#3f7fc4' }} title="Inbound: open purchase orders + work orders in production — click a number for the orders behind it">On Ord</th>
                                                <th style={monthTh} title="Calculated minimum: OUTSOURCED = 6 months of demand · ASSEMBLY = 6 weeks (3wk finishing lead + 3wk safety) · else legacy 4-weeks rule. Hover a value for its rule.">Min OH</th>
                                                <th style={{ ...monthTh, color: 'var(--brass)' }} title="Re-order point — editable; ⬆ Save pushes to the Master Library (manufacturingSpecs.reorderPoint). Overrides the calculated Min OH when set.">ROP</th>
                                                <th style={{ ...monthTh, color: '#3a7d44' }} title="Shortfall vs (ROP or Min OH) counting stock on order, rounded up to full finishing batches">Rec</th>
                                                <th style={{ ...monthTh, color: 'var(--ink)' }}>Order</th>
                                                <th style={monthTh} title="Rod cuts — turn 8 ft rods into 6 ft or 4 ft">Cut</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map(r => {
                                                const info = reorderFor(r);
                                                // Order is ALWAYS entered by hand — Rec is guidance, never a prefill.
                                                const ov = orderQty[r.internalId] ?? '';
                                                return (
                                                <tr key={r.internalId}>
                                                    <td style={{ padding: '7px 12px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }}>{r.itemid}{info.isPole ? <span style={{ color: 'var(--brass)', fontSize: '9px' }}> · POLE</span> : (info.size ? <span style={{ color: 'var(--ink-soft)', fontSize: '9px' }}> · {info.size}</span> : null)}{info.isOutsourced ? <span title="Outsourced (vendor, not an assembly) — 6-month safe-stock rule" style={{ color: '#3f7fc4', fontSize: '9px' }}> · OUT</span> : (info.isAssembly ? <span title="Assembly finished in-house — 6-week rule (3wk lead + 3wk safety)" style={{ color: '#3a7d44', fontSize: '9px' }}> · ASM</span> : null)}{info.isPack ? <span title={info.minRule} style={{ color: 'var(--ink-soft)', fontSize: '9px' }}> · PACK×{info.packSize}</span> : (info.isSingleAgg ? <span title="Aggregates its pack SKUs — pack demand × size and pack shelf stock roll in here" style={{ color: '#3a7d44', fontSize: '9px' }}> · EA+</span> : null)}</td>
                                                    <td style={{ ...numTd, textAlign: 'left', color: r.oldInternalId ? OLD_BLUE : 'var(--line)' }}>{r.oldInternalId || '—'}</td>
                                                    {r.cells.map((c, i) => (
                                                        <td key={salesHist.months[i].key} style={{ ...numTd, color: c.src === 'new' ? 'var(--ink)' : (c.src === 'old' ? OLD_BLUE : 'var(--line)'), fontWeight: c.src === 'new' ? 500 : 400 }}>{c.v || '·'}</td>
                                                    ))}
                                                    <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{r.total || '·'}</td>
                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{r.avg.toFixed(1)}</td>
                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{r.orders}</td>
                                                    <td style={{ ...numTd, color: (!info.isPack && info.available <= info.threshold) ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }} title={info.isSingleAgg ? 'Includes remaining pack shelf stock × pack size (single-equivalents)' : undefined}>{info.available}</td>
                                                    <td style={{ ...numTd }}>{r.onOrd > 0 ? <button onClick={() => setOnOrdModal(r)} title="Open POs / work orders — click for detail" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{Math.round(r.onOrd)}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }} title={info.minRule}>{info.minOnHand || '·'}</td>
                                                    <td style={{ ...numTd }}><input type="number" min="0" value={ropEdits[String(r.itemid).toUpperCase()] ?? (info.rop ?? '')} placeholder={info.isPack ? '·' : '—'} disabled={!info.part || info.isPack} title={info.isPack ? `Pack assembly — set the ROP on ${info.packSingle}` : (info.part ? 'Re-order point — ⬆ Save pushes to the Master Library; overrides Min OH' : 'No matching Master Library part — sync the item first')} onChange={e => setRopEdits(prev => ({ ...prev, [String(r.itemid).toUpperCase()]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: ropEdits[String(r.itemid).toUpperCase()] !== undefined ? '2px solid var(--brass)' : '1px solid var(--line)', outline: 'none', background: (info.part && !info.isPack) ? '#fff' : 'var(--paper-2)' }} /></td>
                                                    <td style={{ ...numTd, fontWeight: 600, color: info.recommended > 0 ? '#3a7d44' : 'var(--line)' }}>{info.isPack ? <span title={`Packs build from singles at pick — order ${info.packSingle}`} style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 400 }}>→ EA</span> : (info.recommended || '·')}</td>
                                                    <td style={{ ...numTd }}><input type="number" min="0" value={ov} placeholder={info.isPack ? '·' : '0'} disabled={!!info.isPack} title={info.isPack ? `Packs are built from ${info.packSingle} at pick — order the single row` : undefined} onChange={e => setOrderQty(prev => ({ ...prev, [r.internalId]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: '1px solid var(--line)', outline: 'none', background: info.isPack ? 'var(--paper-2)' : '#fff' }} /></td>
                                                    <td style={{ ...numTd }}>{(info.isPole && /8(1[05])/.test(String(r.itemid))) ? <button title="Cut 8 ft rods down to 6 ft / 4 ft" onClick={() => setCutModal({ itemid: r.itemid, internalId: r.internalId, available: info.available, qty: '', target: '4FT' })} style={{ padding: '3px 10px', background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px' }}>✂</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                </tr>
                                                );
                                            })}
                                        </tbody>
                                        <tfoot style={{ position: 'sticky', bottom: 0 }}>
                                            <tr>
                                                <td style={{ padding: '9px 12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)', position: 'sticky', left: 0 }}>All ({rows.length})</td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}></td>
                                                {gt.map((v, i) => <td key={i} style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}>{v || '·'}</td>)}
                                                <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)', borderLeft: '1px solid var(--line)' }}>{gtTotal}</td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}></td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}></td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)', borderLeft: '2px solid var(--ink)' }}>{totAvail}</td>
                                                <td style={{ ...numTd, fontWeight: 700, color: '#3f7fc4', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}>{Math.round(totOnOrd) || '·'}</td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}>{totMin}</td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}></td>
                                                <td style={{ ...numTd, fontWeight: 700, color: '#3a7d44', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}>{totRec}</td>
                                                <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}>{totOrder}</td>
                                                <td style={{ ...numTd, background: 'var(--paper-2)', borderTop: '2px solid var(--ink)' }}></td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 🚚 INBOUND DETAIL — the open POs / work orders behind a snapshot "On Ord" number */}
            {onOrdModal && (
                <div onClick={() => setOnOrdModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '780px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Inbound — {onOrdModal.itemid}</h2>
                            <button onClick={() => setOnOrdModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{Math.round(onOrdModal.onOrd)} pcs inbound across {onOrdModal.onOrdLines.length} open order{onOrdModal.onOrdLines.length === 1 ? '' : 's'} · purchase orders + work orders in production</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead style={{ borderBottom: '2px solid var(--ink)' }}>
                                <tr>
                                    {['Type', 'Order #', 'Vendor / Source', 'Ordered', "Rec'd / Built", 'Open', 'Expected', 'Status'].map((h, i) => <th key={h} style={{ padding: '10px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', textAlign: i >= 3 && i <= 5 ? 'center' : 'left' }}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {[...onOrdModal.onOrdLines].sort((a, b) => String(a.expected || '9999').localeCompare(String(b.expected || '9999'))).map((l, idx) => (
                                    <tr key={idx} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                                        <td style={{ padding: '9px 8px' }}><span style={{ padding: '2px 8px', fontFamily: 'var(--mono)', fontSize: '9px', fontWeight: 700, letterSpacing: '.08em', color: '#fff', background: l.kind === 'PO' ? '#3f7fc4' : '#3a7d44' }}>{l.kind}</span></td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{l.tranid}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{l.source || '—'}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center', color: 'var(--ink-soft)' }}>{Math.round(l.ordered)}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center', color: 'var(--ink-soft)' }}>{Math.round(l.done) || '·'}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '11px', textAlign: 'center', fontWeight: 700, color: l.kind === 'PO' ? '#3f7fc4' : '#3a7d44' }}>{Math.round(l.open)}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '11px', color: l.expected ? 'var(--ink)' : 'var(--line)' }}>{l.expected || 'no date'}</td>
                                        <td style={{ padding: '9px 8px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{String(l.status).replace(/^.*: ?/, '')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ✂ ROD CUT ORDER BUILDER — turn stocked 8 ft rods into 2×4 ft or 1×6 ft (+2 ft scrap) */}
            {cutModal && (() => {
                const qn = parseInt(cutModal.qty) || 0;
                const is4 = cutModal.target === '4FT';
                const targetCode = String(cutModal.itemid).replace(/8(1[05])/, is4 ? '4$1' : '6$1');
                const validPattern = targetCode !== String(cutModal.itemid);
                const targetRow = ((salesHist && salesHist.rows) || []).find(x => String(x.itemid).toUpperCase() === targetCode.toUpperCase());
                const targetPart = partByKey['erp:' + targetCode.toUpperCase()];
                const targetInternalId = targetRow ? targetRow.internalId : (targetPart && targetPart.netSuiteInternalId ? String(targetPart.netSuiteInternalId) : null);
                const yieldQty = is4 ? qn * 2 : qn;
                const scrapFt = is4 ? 0 : qn * 2;
                const ready = qn > 0 && validPattern && !!targetInternalId;
                const issue = async () => {
                    if (!ready) return;
                    try {
                        const id = `RC-${Date.now()}`;
                        await setDoc(doc(db, 'rod_cut_orders', id), {
                            id, brand: activeBrand, status: 'OPEN',
                            sourceItemId: cutModal.itemid, sourceInternalId: String(cutModal.internalId),
                            targetItemId: targetCode, targetInternalId: String(targetInternalId),
                            qtySource: qn, qtyTarget: yieldQty, cutTo: cutModal.target, scrapFt,
                            sourceBin: null, destBin: null, nsAdjustmentId: null,
                            createdAt: Date.now(), createdBy: currentUser || '', createdVia: 'SALES_SNAPSHOT',
                            completedAt: null, completedBy: null
                        });
                        addLog(`✂ Rod cut order ${id}: ${qn} × ${cutModal.itemid} → ${yieldQty} × ${targetCode}`, 'success');
                        alert(`✂ Rod cut order issued:\n\n${qn} × ${cutModal.itemid} (8 ft) → ${yieldQty} × ${targetCode}${scrapFt ? ` + ${scrapFt} ft scrap` : ''}\n\nIt's queued on the WMS → ROD CUTS tab. NetSuite inventory adjusts when the operator scans the bins and confirms the cut.`);
                        setCutModal(null);
                    } catch (e) { alert('Failed to create the rod cut order: ' + (e.message || e)); }
                };
                const tgl = (on) => ({ flex: 1, padding: '12px', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.05em' });
                return (
                    <div onClick={() => setCutModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '560px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>✂ Rod Cut</h2>
                                <button onClick={() => setCutModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{cutModal.itemid} · 8 ft rod · {cutModal.available} available</div>

                            <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>How many 8 ft rods to cut</label>
                            <input type="number" min="1" value={cutModal.qty} onChange={e => setCutModal(m => ({ ...m, qty: e.target.value }))} placeholder="0" autoFocus style={{ width: '100%', padding: '12px', fontFamily: 'var(--mono)', fontSize: '1.2rem', textAlign: 'center', border: '2px solid var(--line)', outline: 'none', boxSizing: 'border-box', marginBottom: qn > cutModal.available ? '6px' : '20px' }} />
                            {qn > cutModal.available && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#b8860b', marginBottom: '14px' }}>⚠ Only {cutModal.available} available in NetSuite — the operator's source bin must actually hold {qn} or the adjustment will be rejected.</div>}

                            <label style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' }}>Cut down to</label>
                            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                                <button onClick={() => setCutModal(m => ({ ...m, target: '4FT' }))} style={tgl(is4)}>1 × 8 ft → 2 × 4 ft</button>
                                <button onClick={() => setCutModal(m => ({ ...m, target: '6FT' }))} style={tgl(!is4)}>1 × 8 ft → 1 × 6 ft <span style={{ opacity: .6 }}>(+2 ft scrap)</span></button>
                            </div>

                            <div style={{ border: '1px solid var(--line)', background: 'var(--paper)', padding: '16px', marginBottom: '20px' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink)', fontWeight: 600 }}>{qn || '—'} × {cutModal.itemid} → {qn ? yieldQty : '—'} × {targetCode}{scrapFt ? <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> + {scrapFt} ft scrap</span> : null}</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '6px', color: targetInternalId ? '#3a7d44' : '#d9534f' }}>
                                    {!validPattern ? '✗ Couldn\'t derive a cut-down code from this item number (no 810/815 block).'
                                        : targetInternalId ? `✓ Target ${targetCode} found (NetSuite id ${targetInternalId})`
                                        : `✗ ${targetCode} isn't in NetSuite / the synced library — create & sync it first.`}
                                </div>
                            </div>

                            <button onClick={issue} disabled={!ready} style={{ width: '100%', padding: '15px', background: ready ? 'var(--brass)' : 'var(--paper-2)', color: ready ? '#fff' : 'var(--ink-soft)', border: ready ? 'none' : '1px solid var(--line)', cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Issue Rod Cut Order → WMS</button>
                        </div>
                    </div>
                );
            })()}

            {/* 🔀 PO-vs-WO CHOOSER — in-house items that ALSO carry a vendor: pick sourcing per item */}
            {routeModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '32px', width: '720px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <h2 style={{ margin: '0 0 6px 0', fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Choose Sourcing</h2>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>These items are set up in-house but also carry a vendor — purchase order to the vendor, or work order to the floor?</div>
                        {routeModal.items.map((x, idx) => (
                            <div key={x.r.internalId} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '10px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, color: 'var(--ink)' }}>{x.r.itemid} <span style={{ fontWeight: 400, color: 'var(--ink-soft)' }}>× {x.qty}</span></div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{x.info.part?.itemName || ''} · vendor: {x.info.part?.manufacturingSpecs?.vendorName}</div>
                                </div>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <button onClick={() => setRouteModal(m => ({ ...m, items: m.items.map((y, i) => i === idx ? { ...y, choice: 'PO' } : y) }))} style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${x.choice === 'PO' ? 'var(--brass)' : 'var(--line)'}`, background: x.choice === 'PO' ? 'var(--brass)' : '#fff', color: x.choice === 'PO' ? '#fff' : 'var(--ink)' }}>PO → {String(x.info.part?.manufacturingSpecs?.vendorName || 'vendor').split(' ')[0]}</button>
                                    <button onClick={() => setRouteModal(m => ({ ...m, items: m.items.map((y, i) => i === idx ? { ...y, choice: 'WO' } : y) }))} style={{ padding: '8px 14px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', cursor: 'pointer', border: `1px solid ${x.choice === 'WO' ? 'var(--ink)' : 'var(--line)'}`, background: x.choice === 'WO' ? 'var(--ink)' : '#fff', color: x.choice === 'WO' ? '#fff' : 'var(--ink)' }}>WO → Floor</button>
                                </div>
                            </div>
                        ))}
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '20px' }}>
                            <button onClick={() => setRouteModal(null)} style={{ padding: '12px 22px', background: 'transparent', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>Cancel</button>
                            <button onClick={() => { const m = routeModal; setRouteModal(null); executeOrders([...m.buy, ...m.items.filter(x => x.choice === 'PO')], [...m.make, ...m.items.filter(x => x.choice === 'WO')]); }} style={{ padding: '12px 22px', background: '#3a7d44', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Continue → Generate</button>
                        </div>
                    </div>
                </div>
            )}

            {wipModal && (
                <div onClick={() => setWipModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '640px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Out for Plating</h2>
                            <button onClick={() => setWipModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{wipModal.itemName} · {wipModal.erpId} · {wipModal.lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)} pcs in progress</div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead style={{ borderBottom: '2px solid var(--ink)' }}>
                                <tr>
                                    {['Finish', 'Work Order', 'Plater PO', 'Qty', 'Stage'].map((h, i) => <th key={h} style={{ padding: '10px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', textAlign: i >= 3 ? 'center' : 'left' }}>{h}</th>)}
                                </tr>
                            </thead>
                            <tbody>
                                {[...wipModal.lines].sort((a, b) => String(a.finishCode || '').localeCompare(String(b.finishCode || ''))).map(l => (
                                    <tr key={l.id} style={{ borderBottom: '1px solid var(--line)' }}>
                                        <td style={{ padding: '12px 8px', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>
                                            <span style={{ fontFamily: 'var(--mono)', color: 'var(--brass)' }}>{l.finishCode || '—'}</span>{l.finishName ? ` · ${l.finishName}` : ''}
                                            {l.targetErpId ? <div style={{ fontSize: '10px', color: 'var(--ink-soft)' }}>→ {l.targetErpId}</div> : null}
                                        </td>
                                        <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>{l.woNum || '—'}</td>
                                        <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}>
                                            {l.nsPoId ? <a href={`https://3728153.app.netsuite.com/app/accounting/transactions/purchord.nl?id=${l.nsPoId}&whence=`} target="_blank" rel="noreferrer" style={{ color: 'var(--brass)', textDecoration: 'underline' }}>{l.nsPoTran || l.nsPoId}</a> : (l.shipmentId ? <span style={{ color: 'var(--ink-soft)' }} title={l.shipmentId}>not shipped</span> : '—')}
                                        </td>
                                        <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '1rem' }}>{parseInt(l.qty) || 0}</td>
                                        <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)' }}>{STAGE_LABEL[l.status] || l.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* ON-ORDER POPUP — open purchase orders for this item, pulled live from NetSuite */}
            {poModal && (
                <div onClick={() => setPoModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '720px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Open Purchase Orders</h2>
                            <button onClick={() => setPoModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{poModal.itemName} · {poModal.erpId}</div>
                        {poModal.loading && <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading purchase orders from NetSuite…</div>}
                        {poModal.error && <div style={{ padding: '16px', background: '#fdf2f2', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{poModal.error}</div>}
                        {!poModal.loading && !poModal.error && poModal.lines.length === 0 && <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No open purchase orders found for this item.</div>}
                        {!poModal.loading && !poModal.error && poModal.lines.length > 0 && (
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ borderBottom: '2px solid var(--ink)' }}>
                                    <tr>
                                        {['PO #', 'Vendor', 'Ordered', 'Received', 'Open', 'Rate', 'Date'].map((h, i) => <th key={h} style={{ padding: '10px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', textAlign: i >= 2 && i <= 5 ? 'center' : 'left' }}>{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {poModal.lines.map((l, idx) => {
                                        const ordered = parseFloat(l.qty) || 0;
                                        const received = parseFloat(l.received) || 0;
                                        return (
                                            <tr key={(l.po_id || idx) + '-' + idx} style={{ borderBottom: '1px solid var(--line)' }}>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--brass)' }}>{l.po_number || l.po_id || '—'}</td>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{l.vendor || '—'}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{ordered}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: 'var(--ink-soft)' }}>{received}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }}>{ordered - received}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{l.rate != null && l.rate !== '' ? `$${parseFloat(l.rate).toFixed(2)}` : '—'}</td>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{l.trandate || '—'}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>
            )}

            {/* HEADER & FILTER BAR */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Live NetSuite Inventory Integration</span>
                        <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>ERP Stock & Sourcing View</h2>
                    </div>
                    {lastSyncTime && (
                        <div style={{ textAlign: 'right' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Cached Data From</span>
                            <div style={{ fontFamily: 'var(--sans)', fontSize: '0.9rem', color: 'var(--ink)' }}>{lastSyncTime}</div>
                        </div>
                    )}
                </div>
                
                {/* ALIGNED ADVANCED FILTER BAR ROW */}
                <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '12px', alignItems: 'center' }}>
                    
                    <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ flex: 1, minWidth: '160px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: 'var(--paper-2)', color: 'var(--ink)' }}>
                        <option value="ALL">All Classes</option>
                        <option value="INVENTORY">Raw Mat / Components</option>
                        <option value="OUTSOURCED">Outsourced Components</option>
                        <optgroup label="Assemblies & Kits">
                            <option value="UNASSIGNED">Unassigned / Pending</option>
                            {(globalLists.assemblyTypes || []).map(type => <option key={type} value={type}>{type}</option>)}
                        </optgroup>
                    </select>
                    
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ flex: 1, minWidth: '160px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Categories</option>
                        {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>

                    <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ flex: 1, minWidth: '160px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Collections</option>
                        {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>

                    <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ flex: 1, minWidth: '160px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Watchlists</option>
                        <option value="NONE">None / Unassigned</option>
                        {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>

                    <input 
                        placeholder="Search Global Inventory..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        disabled={activeBuilder === 'PO' && !!activeVendor}
                        style={{ flex: 1.5, minWidth: '200px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} 
                    />

                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '0 12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: filterBelowRop ? '#d9534f' : 'var(--ink-soft)' }}>
                            <input type="checkbox" checked={filterBelowRop} onChange={e => setFilterBelowRop(e.target.checked)} />
                            Below ROP
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: filterOnBo ? '#d9534f' : 'var(--ink-soft)' }}>
                            <input type="checkbox" checked={filterOnBo} onChange={e => setFilterOnBo(e.target.checked)} />
                            On BO
                        </label>
                    </div>
                    
                    <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '12px 24px', background: isSyncing ? 'var(--paper)' : 'var(--ink)', color: isSyncing ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: isSyncing ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
                        {isSyncing ? 'Syncing...' : 'Pull NetSuite Stock'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* LEFT: GLOBAL INVENTORY BOARD */}
                <div style={{ flex: 1.5, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Global Inventory Health</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', border: '1px solid #d9534f', padding: '4px 8px' }}>Highlighted = At or Below ROP</span>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#7c4dff', border: '1px solid #7c4dff', padding: '4px 8px', marginLeft: '8px' }}>Purple On-Order = in-app plating WIP (no NetSuite PO)</span>
                        <button onClick={openSalesHistory} style={{ marginLeft: 'auto', padding: '8px 14px', background: 'var(--brass)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>📈 Stocked Sales Snapshot</button>
                        <button onClick={() => setLabelTool(true)} style={{ padding: '8px 14px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>🏷 Print Labels</button>
                    </div>
                    
                    <div style={{ overflowY: 'auto', maxHeight: '75vh', background: '#fff' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontFamily: 'var(--sans)' }}>
                            <thead style={{ background: 'var(--paper)', position: 'sticky', top: 0, zIndex: 10 }}>
                                <tr>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>ERP ID</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Item Name</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Bin</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>On Hand</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Avail</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>WIP Plating</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Agg. Commit</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>On Order</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Agg. BO</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>ROP</th>
                                    <th title="Recommended production batch for stocked, paint-sized finished assemblies — ROP/demand shortfall rounded up to the paint machine's per-section unit." style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Rec. Prod.</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayItems.length === 0 && <tr><td colSpan="11" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.95rem' }}>No inventory items matched.</td></tr>}
                                {activeBuilder === 'PO' && activeVendor && <tr><td colSpan="11" style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic' }}>Viewing {activeVendor} Catalog. Refer to the right-side PO Builder.</td></tr>}
                                {!(activeBuilder === 'PO' && activeVendor) && displayItems.map(item => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid var(--line)', background: item.isLowStock ? '#fdf2f2' : '#fff' }}>
                                        <td style={{ padding: '16px 20px', fontFamily: 'var(--mono)', fontSize: '11px', color: item.isLowStock ? '#d9534f' : 'var(--ink)' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                {item.legacyErpId || item.itemId}
                                                <button onClick={() => printItemLabel({ itemId: item.legacyErpId || item.itemId, itemName: item.itemName, imageUrl: item.finalImageUrl || item.manufacturingSpecs?.imageUrl || item.imageUrl || '' })} title="Print item label (2×4 — thumbnail + item #)" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: '2px', cursor: 'pointer', padding: '1px 5px', fontSize: '11px', lineHeight: 1, color: 'var(--ink-soft)' }}>🖨</button>
                                            </span>
                                            {item.manufacturingSpecs?.isInHouse === false && <span style={{display: 'block', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px', textTransform: 'uppercase'}}>Outsourced</span>}
                                        </td>
                                        
                                        <td 
                                            onClick={() => onNavigateToLibrary && onNavigateToLibrary(item.id)}
                                            style={{ 
                                                padding: '16px 20px', 
                                                fontWeight: 500, 
                                                color: 'var(--brass)', 
                                                fontSize: '0.95rem',
                                                cursor: onNavigateToLibrary ? 'pointer' : 'default',
                                                textDecoration: onNavigateToLibrary ? 'underline' : 'none'
                                            }}
                                            title={onNavigateToLibrary ? "Open in Master Library" : ""}
                                        >
                                            {item.itemName}
                                        </td>
                                        
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center' }}>
                                                {item.manufacturingSpecs?.binLocation || '-'}
                                                {item.manufacturingSpecs?.binLocation && (
                                                    <button onClick={() => printBinLabel({ bin: item.manufacturingSpecs.binLocation })} title="Print bin label (2×4 — big bin # + scannable barcode)" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: '2px', cursor: 'pointer', padding: '1px 5px', fontSize: '11px', lineHeight: 1, color: 'var(--ink-soft)' }}>🖨</button>
                                                )}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: 'var(--ink)' }}>{item.stock.onHand}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', fontWeight: 500, color: item.isLowStock ? '#d9534f' : 'var(--ink)' }}>{item.stock.available}</td>
                                        <td
                                            onClick={item.wip.qty > 0 ? () => setWipModal({ erpId: item.legacyErpId || item.itemId, itemName: item.itemName, lines: item.wip.lines }) : undefined}
                                            title={item.wip.qty > 0 ? 'View work orders out for plating' : ''}
                                            style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', fontWeight: item.wip.qty > 0 ? 600 : 400, color: item.wip.qty > 0 ? 'var(--brass)' : 'var(--ink-soft)', cursor: item.wip.qty > 0 ? 'pointer' : 'default', textDecoration: item.wip.qty > 0 ? 'underline' : 'none' }}
                                        >{item.wip.qty || '-'}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: 'var(--ink-soft)' }}>{item.stock.aggregatedCommitted}</td>
                                        {(() => {
                                            const itemErp = (item.legacyErpId || item.itemId || '').toUpperCase();
                                            const ns = item.stock.onOrder || 0;
                                            const app = platingOnOrderByTarget[itemErp]?.qty || 0;
                                            const hasNs = ns > 0;
                                            return (
                                                <td
                                                    onClick={hasNs ? () => openPoModal(item) : undefined}
                                                    title={hasNs ? 'View open purchase orders' : ''}
                                                    style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', cursor: hasNs ? 'pointer' : 'default' }}
                                                >
                                                    {hasNs && <span style={{ fontWeight: 600, color: 'var(--brass)', textDecoration: 'underline' }}>{ns}</span>}
                                                    {app > 0 && <span onClick={(e) => { e.stopPropagation(); setWipModal({ erpId: itemErp, itemName: item.itemName, lines: platingOnOrderByTarget[itemErp].lines }); }} title="In-app plating WIP — click for the related plater PO(s)" style={{ color: '#7c4dff', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline' }}>{hasNs ? ' + ' : ''}{app}</span>}
                                                    {!hasNs && app === 0 && <span style={{ color: 'var(--ink-soft)' }}>0</span>}
                                                </td>
                                            );
                                        })()}
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: item.stock.aggregatedBackorder > 0 ? '#d9534f' : 'var(--ink-soft)' }}>{item.stock.aggregatedBackorder}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', color: 'var(--ink-soft)' }}>{item.rop || '-'}</td>
                                        {(() => {
                                            const rec = recommendedProductionFor(item);
                                            const show = rec != null && rec > 0;
                                            return (
                                                <td title={rec != null ? `Paint size ${(item.manufacturingSpecs?.paintSize || '').toUpperCase()} · batch unit ${PAINT_SECTION[(item.manufacturingSpecs?.paintSize || '').toUpperCase()]}/section` : 'Set Stocked + Paint Size on the item to get a recommendation'} style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', fontWeight: show ? 600 : 400, color: show ? 'var(--brass)' : 'var(--ink-soft)' }}>{rec == null ? '-' : rec}</td>
                                            );
                                        })()}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* MIDDLE: PO / WO BUILDER WIDGET */}
                <div style={{ flex: 1, background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    
                    {/* BUILDER TOGGLE */}
                    <div style={{ display: 'flex', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }}>
                        <button 
                            onClick={() => { setActiveBuilder('PO'); setOrderDrafts({}); }} 
                            style={{ flex: 1, padding: '16px', background: activeBuilder === 'PO' ? '#fff' : 'transparent', border: 'none', borderBottom: activeBuilder === 'PO' ? '2px solid var(--ink)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', color: activeBuilder === 'PO' ? 'var(--ink)' : 'var(--ink-soft)' }}>
                            Purchasing (PO)
                        </button>
                        <button 
                            onClick={() => { setActiveBuilder('WO'); setOrderDrafts({}); setActiveVendor(""); }} 
                            style={{ flex: 1, padding: '16px', background: activeBuilder === 'WO' ? '#fff' : 'transparent', border: 'none', borderBottom: activeBuilder === 'WO' ? '2px solid var(--ink)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', color: activeBuilder === 'WO' ? 'var(--ink)' : 'var(--ink-soft)' }}>
                            Production (WO)
                        </button>
                    </div>

                    {/* DYNAMIC HEADER */}
                    {activeBuilder === 'PO' ? (
                        <div style={{ padding: '24px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Select Vendor for Restock</label>
                            <select 
                                value={activeVendor} 
                                onChange={(e) => { setActiveVendor(e.target.value); setOrderDrafts({}); }} 
                                style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' }}
                            >
                                <option value="">-- View Global Inventory (No Vendor Selected) --</option>
                                {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                            </select>
                        </div>
                    ) : (
                        <div style={{ padding: '24px', borderBottom: '1px solid var(--line)', background: 'var(--paper-2)' }}>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)', marginBottom: '8px' }}>In-House Production Queue</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Filters on the left control which items appear here. Math is dynamically weighted by Commitments, Backorders, ROP, and Production Capacity buffers.</div>
                        </div>
                    )}

                    {/* BUILDER LIST */}
                    <div style={{ flex: 1, padding: '24px', overflowY: 'auto', maxHeight: '55vh', background: '#fff' }}>
                        {activeBuilder === 'PO' && !activeVendor ? (
                            <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', textAlign: 'center', marginTop: '60px', fontFamily: 'var(--serif)', fontSize: '1.2rem', padding: '0 20px' }}>Select a vendor from the dropdown to load their catalog and generate restocking suggestions.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {displayItems.map(item => {
                                    const suggested = suggestedQtyFor(item);

                                    const currentDraft = orderDrafts[item.id] !== undefined ? orderDrafts[item.id] : "";
                                    
                                    return (
                                        <div key={item.id} style={{ border: item.isLowStock ? '1px solid #d9534f' : '1px solid var(--line)', padding: '20px', background: item.isLowStock ? '#fdf2f2' : 'var(--paper)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 500, fontSize: '1.05rem', color: 'var(--ink)' }}>{item.itemName}</div>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '6px' }}>ERP: {item.legacyErpId} | {activeBuilder === 'PO' ? 'Vendor SKU:' : 'Routing:'} <span style={{color: 'var(--ink)'}}>{activeBuilder === 'PO' ? (item.manufacturingSpecs?.vendorId || 'N/A') : (item.routingType || 'Standard')}</span></div>
                                                </div>
                                                {item.isLowStock && <span style={{ background: '#d9534f', color: '#fff', padding: '4px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', height: 'fit-content' }}>Low Stock</span>}
                                            </div>
                                            
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', background: '#fff', padding: '16px', border: '1px solid var(--line)', textAlign: 'center', marginBottom: '20px' }}>
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>Avail</div><div style={{ fontSize: '1.1rem', fontWeight: 500, color: item.isLowStock ? '#d9534f' : 'var(--ink)' }}>{item.stock.available}</div></div>
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>Commit</div><div style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{item.stock.aggregatedCommitted || 0}</div></div>
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>ROP</div><div style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{item.rop || 0}</div></div>
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>MOQ</div><div style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{item.moq || 0}</div></div>
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>{activeBuilder === 'PO' ? 'Lead' : 'ProdTime'}</div><div style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{item.leadTime || 0}d</div></div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '6px' }}>Suggested {activeBuilder === 'PO' ? 'Order' : 'Build'}</div>
                                                    <div style={{ fontSize: '1.2rem', fontWeight: 500, color: suggested > 0 ? 'var(--ink)' : 'var(--ink-soft)' }}>{suggested} units</div>
                                                </div>
                                                <div style={{ flex: 1.5 }}>
                                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Required {activeBuilder === 'PO' ? 'Order' : 'Build'} Qty</label>
                                                    <input 
                                                        type="number" 
                                                        placeholder="0"
                                                        value={currentDraft} 
                                                        onChange={(e) => handleOrderQtyChange(item.id, e.target.value)}
                                                        style={{ width: '100%', padding: '12px', fontSize: '1.1rem', fontFamily: 'var(--sans)', border: currentDraft > 0 ? '1px solid var(--ink)' : '1px solid var(--line)', boxSizing: 'border-box', outline: 'none' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {/* DYNAMIC PUSH TO FIREBASE BUTTON */}
                    {(activeBuilder === 'WO' || activeVendor) && (
                        <div style={{ padding: '24px', borderTop: '1px solid var(--line)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={() => { const d = { ...orderDrafts }; let n = 0; displayItems.forEach(it => { const s = suggestedQtyFor(it); if (s > 0) { d[it.id] = s; n++; } }); setOrderDrafts(d); if (!n) alert("Nothing to suggest — every shown item is above ROP and has no open demand."); }}
                                style={{ width: '100%', padding: '14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}
                            >
                                ↧ Fill All With Suggested
                            </button>
                            <button
                                onClick={activeBuilder === 'PO' ? pushPOsToDispatch : pushWOsToDispatch}
                                style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                            >
                                {activeBuilder === 'PO' ? 'Push PO to RTG Dispatch' : 'Push Work Order to RTG Dispatch'}
                            </button>
                        </div>
                    )}
                </div>

                {/* RIGHT: TERMINAL */}
                <div style={{ flex: 0.8, background: 'var(--dark)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', height: '80vh', position: 'sticky', top: '20px', overflow: 'hidden' }}>
                    <div style={{ padding: '16px 20px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between' }}>
                        <span>>_ SuiteQL Pull Terminal</span>
                        <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', opacity: 0.6, textTransform: 'uppercase' }}>Clear</button>
                    </div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '11px', color: '#a8a5a0' }}>
                        {syncLog.length === 0 && <span style={{ opacity: 0.6 }}>Awaiting command...</span>}
                        {syncLog.map((log, idx) => {
                            let color = '#a8a5a0';
                            if (log.type === 'error') color = '#e27373';
                            if (log.type === 'success') color = '#7dbb81';
                            if (log.type === 'warn') color = '#e2b373';
                            
                            return (
                                <div key={idx} style={{ color, borderBottom: '1px solid #333', paddingBottom: '6px' }}>
                                    <span style={{ opacity: 0.5, marginRight: '10px' }}>[{log.time}]</span>
                                    {log.msg}
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default StockViewTab;