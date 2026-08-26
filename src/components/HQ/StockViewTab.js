import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, where, getDocs, doc, setDoc, getDoc, updateDoc, deleteDoc, deleteField, addDoc, serverTimestamp } from "firebase/firestore";
import { enqueueNsWrite } from '../Shared/nsOutbox';
import { printItemLabel, printBinLabel, printItemLabels, printBinLabels } from '../Shared/labelPrint';
import { SOURCING, sourcingOf } from '../Shared/sourcing';
import { makeFullTasks, withItemCode, woItemCodeOf } from '../Shared/workOrderContract';
import { SIZE_CAPACITY, lookupCapacity, finishCodeFromErp } from '../Shared/finishingTime';
import { closeOrderEverywhere, hardDeleteWithLedger } from '../Shared/orderLifecycle';
import { poleCutPlan, poleLengthOf, isPoleCategory, cutOptionsFor, targetCodeFor, planManualCut } from '../Shared/poleCut';
import { reserveShortNo } from '../Shared/shortId';
import { nsProxyFetch } from "../Shared/nsProxy";
import { planFinishedRun, isAssemblyPart } from '../Shared/finishedGoodsRun';

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
    const [cutModal, setCutModal] = useState(null);     // rod-cut order builder — see openCutModal
    // ── THE CUT TOOL OPENS ON ANY POLE (Stuart 2026-08-25) ──────────────────────────────────────
    // "as long as category is rod or pole, then we should be able to use the tool … we shouldn't
    //  have to limit it by pattern, you could always add the input fields on the tool itself, such
    //  as this pole HMLP810/SG = .."
    //
    // Before this the ✂ appeared only where poleLengthOf() read exactly 8, so a rod whose code did
    // not follow the house grammar had no cut at all — and Eric's HTA1235 could not even be READ
    // as 12 ft. The grammar now only PRE-FILLS: it suggests the source length and the cut-down
    // codes, and every one of them is an editable field. What decides whether the cut may be
    // raised is planManualCut's three questions — pole/rod, in the library, has a NetSuite id.
    const openCutModal = (itemid, internalId, available) => {
        const ft = poleLengthOf(itemid);
        const opts = cutOptionsFor(ft);
        const opt = opts[0] || null;
        setCutModal({
            itemid, internalId, available, qty: '',
            sourceFt: ft || '',
            optionKey: opt ? opt.key : 'CUSTOM',
            rows: opt ? opt.targets.map(t => ({ code: targetCodeFor(itemid, t.ft), per: String(t.per) }))
                      : [{ code: '', per: '1' }],
            scrapFt: opt ? String(opt.scrapFt) : '0',
        });
    };
    const [snapWatch, setSnapWatch] = useState('');     // snapshot watchlist filter (catalog is growing)
    const [snapView, setSnapView] = useState('FIN');    // FIN = finished stocked items · RAW = BOM core parts behind the finish variants · TIER = raw + /P + plated read together
    const [snapSort, setSnapSort] = useState('item');   // 'item' (load order) | 'finish' (/SG · /N25 grouped — batch same-finish WOs)
    const [snapCat, setSnapCat] = useState('');         // snapshot category (productType) filter
    const [snapColl, setSnapColl] = useState('');       // snapshot collection filter
    const [convSugFor, setConvSugFor] = useState(null); // row itemid with the ⇄ donor picker open
    const [convSugMap, setConvSugMap] = useState({});   // itemid → { from, qty } — rides onto the WO as a SUGGESTION (Setup Queue converts)
    const [openWos, setOpenWos] = useState(null);       // 📋 Open WOs cleanup panel { loading, rows, error }
    const [rawStock, setRawStock] = useState(null);     // { loading, availById, inboundById } — raw cores' NetSuite stock, fetched on first RAW toggle
    const [ropEdits, setRopEdits] = useState({});       // erp(base) -> edited ROP (pushed to Master Library manufacturingSpecs.reorderPoint)
    const [ropSaving, setRopSaving] = useState(false);
    const [routeModal, setRouteModal] = useState(null); // in-house items WITH a vendor → per-item PO-vs-WO choice {buy, make, items}
    const [rawOrderQty, setRawOrderQty] = useState({});  // Raw Cores view: Order qty keyed by base ERP
    const [urgentCores, setUrgentCores] = useState([]);  // core_urgent_demand — mill cores a live backorder is waiting on
    // ⚡ URGENT RUN FLAG (Stuart 2026-07-30: "there should be a flag that we can check if urgent and
    // a field to enter a need by date"). Ticked before pressing Generate, it marks the work orders
    // THAT PRESS creates as urgent and sets their need-by date. An urgent WO arrives PINNED to the
    // top of the Finishing Setup Queue until an operator acknowledges it.
    const [woUrgent, setWoUrgent] = useState(false);
    const [woNeedBy, setWoNeedBy] = useState('');
    const [tierOrderQty, setTierOrderQty] = useState({}); // 3-Tier view: Order qty keyed by ERP (raw base AND each variant)
    const [vendorModal, setVendorModal] = useState(null); // vendor confirmation before POs are cut {buy, make, shop, vendors, picks}

    // BUILDER STATE
    const [activeBuilder, setActiveBuilder] = useState("PO"); // 'PO' or 'WO'
    const [woShowAll, setWoShowAll] = useState(false); // WO queue: include in-house items NOT flagged Stocked
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

        // URGENT CORE DEMAND (Stuart 2026-07-30). Raised by the WMS pick app when a plated item is
        // short AND the mill core can't cover it: the parts have to be MADE before they can be
        // plated, and a live backorder is waiting. This screen's own reorder math should already be
        // asking for them, but it works off history — it can't know a customer is standing in front
        // of this one today. So they get flagged in red here, where cores actually get work-ordered.
        const unsubUrgent = onSnapshot(collection(db, "core_urgent_demand"), snap => {
            setUrgentCores(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.status !== 'done'));
        });

        // In-progress plating lines (out for plating) → feeds the WIP-Plating column + popup. 'built' = done.
        const unsubPlating = onSnapshot(collection(db, "plating_shipments"), snap => {
            setPlatingLines(
                snap.docs.map(d => ({ id: d.id, ...d.data() }))
                    .filter(s => s.brandId === activeBrand && ['staged', 'shipped', 'received'].includes(s.status))
            );
        });

        return () => { unsubParts(); unsubLists(); unsubCollections(); unsubOutsource(); unsubUrgent(); unsubPlating(); };
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
                    // Source numbers only (Stuart 2026-07-17): no invented short WO # — the app id
                    // shows until a NetSuite WO posts, then nsWoTran takes over on every screen.
                    await setDoc(doc(db, "hq_work_orders", woId), withItemCode({
                        id: woId, woId, woDisplayId: `WO-${basePart.legacyErpId || basePart.itemId}-${stamp}`,
                        partErpId: basePart.legacyErpId || basePart.itemId,
                        brand: activeBrand, status: "Approved", customer: "Internal Stock",
                        hqJobId: basePart.id, totalParts: shortfall,
                        reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0],
                        type: "Stock Build", routingType: basePart.routingType || 'Standard',
                        rootItem: pl.baseErp, forPlating: pl.erp, createdAt: Date.now()
                    }));
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
                const rec = resolveVendorRec(vendors, activeVendor)
                    || resolveVendorByNsId(vendors, consensusVendorNsId(directBuyLines.map(l => l.part)));
                if (!rec) {
                    alert(`⚠️ Vendor "${activeVendor}" doesn't match any NetSuite-synced vendor (11.1 → Sync Active Vendors) — PO not created. Fix the vendor name or sync vendors, then retry.`);
                } else {
                    const nsVendorId = String(rec.id || '').replace(/^VEND-/, '');
                    // Easy-to-speak reference (PO-1044) as the id; legacy vendor-stamp fallback.
                    let newPoId;
                    try { newPoId = await reserveShortNo('PO'); }
                    catch (e) { newPoId = `PO-${(activeVendor || 'VEND').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5)}-${Date.now().toString().slice(-6)}`; }
                    const items = directBuyLines.map(({ part, qty }) => ({
                        itemId: part.legacyErpId || part.itemId,
                        nsItemId: part.netSuiteInternalId ? String(part.netSuiteInternalId) : null,
                        vendorPart: part.manufacturingSpecs?.vendorId || 'N/A',
                        quantity: qty, rate: poRateOf(part),
                        description: part.manufacturingSpecs?.purchaseDescription || part.itemName
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

                // EXPLODE THE BOM HERE TOO (Eric 2026-08-25, 9:20: "Using HWOWR35/W32 as an
                // example. This BOM calls for HWMWR35 … When a work order is issued from Stock
                // View, the BOM calls for the incorrect HWOWR35 to be picked. When marked Stocked
                // and issued from the Stocked Sales screen, the BOM returns the correct HWMWR35").
                //
                // He was right and it is not a sync problem — "checked and synced multiple times"
                // could never have fixed it, because this path never read the BOM at all. It wrote
                // no partsList, so the floor synthesized one pull by stripping the finish off the
                // ITEM (HWOWR35/W32 → HWOWR35) — the assembly, not its component. Same planner the
                // Sales Snapshot uses, so both screens now answer the question identically:
                // an assembly with pins pulls the components its BOM names (Model A, literal), a
                // part without pulls its own phosphated core (Model B, the custom routing).
                let bomLines = [];
                if (isAssemblyPart(part)) {
                    try {
                        const pinsSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', part.itemId)));
                        const pins = pinsSnap.docs.map(d => d.data());
                        if (pins.length) bomLines = planFinishedRun({ part, qty: Number(qty), pins, inventory: hqParts }).lines;
                    } catch (e) { console.warn('BOM explode failed for', erpId, e); }
                }

                // Firestore doc ids can't contain "/" — finished variants carry it (e.g. H1-138BF/EP1). Sanitize
                // it out of the DOC id; keep the true code on the record (woDisplayId / variantErpId) for display.
                const stamp = Date.now().toString().slice(-6);
                const safeErp = String(erpId).replace(/[^A-Za-z0-9]+/g, '-');
                const newWoId = `WO-${safeErp}-${stamp}`;
                // Source numbers only (2026-07-17): app id until the NetSuite WO posts, then nsWoTran.
                await setDoc(doc(db, "hq_work_orders", newWoId), withItemCode({
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
                    // The ITEM, not the category — the floor card reads `type` (Stuart 2026-08-17).
                    // variantErpId/rootItem were already here; `type` said "Stock Build", which is
                    // what every screen ended up showing instead of the pattern number.
                    type: String(erpId || "Stock Build"),
                    // NO PUSH-TO-SHOP ON A FINISHING JOB (Eric 2026-08-25: "there is also an
                    // erroneous Push to Shop button"). RTG offers that button whenever routeTo is
                    // not FINISHING, and this path never set it — so a finished item advertised a
                    // route into the milling queue, which it has no business taking. An item with a
                    // finish suffix is finishing work; a RAW one can still legitimately go to shop,
                    // so the flag is set from the code rather than assumed.
                    ...(finishCodeFromErp(erpId) ? { routeTo: 'FINISHING' } : {}),
                    itemName: part.itemName || '',
                    ...(part.netSuiteInternalId ? { stockInternalId: String(part.netSuiteInternalId) } : {}),
                    // The finish the floor batches on. Omitted here until 2026-08-17, which left
                    // RTG's release to fall through to PENDING-RECIPE — the finish was in the item
                    // code the whole time. Raw and /P codes have no finish suffix and stay unset.
                    ...(finishCodeFromErp(erpId) ? { recipe: finishCodeFromErp(erpId) } : {}),
                    // ⚡ The urgent tick above the Generate button applies to THIS push too — it was
                    // the one WO-creating path here that ignored it (2026-08-17).
                    ...(woUrgent ? { urgent: true, urgentAck: false, needBy: woNeedBy || new Date(Date.now() + 12096e5).toISOString().split('T')[0], urgentBy: currentUser || '', urgentAt: Date.now() } : {}),
                    ...(part.manufacturingSpecs?.finishStream ? { finishStream: String(part.manufacturingSpecs.finishStream).toUpperCase() } : {}),
                    // Scheduler keys for the finishing time matrix (recipe × paintSize × productType).
                    // Carried downstream by RTGDispatch.pushToFinishing onto the fin_workorder.
                    paintSize: (part.manufacturingSpecs?.paintSize || '').toUpperCase() || null,
                    productType: (part.manufacturingSpecs?.productType || part.productType || '').toUpperCase() || null,
                    routingType: part.routingType || 'Standard',
                    needsPhosphating: isPhosphate,
                    isPlatingDemand: isPlating,
                    rootItem: rootErpId,
                    // Carried onto the fin work order by RTG's release. Absent (no pins) it stays
                    // off the doc entirely, and the floor keeps the exact behaviour it had.
                    ...(bomLines.length ? { partsList: bomLines, bomExploded: true } : {}),
                    createdAt: Date.now()
                }));
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

    // On-Order popup: BOTH inbound streams, live from NetSuite — open PO lines (vendor buys) AND
    // open work orders (production builds, e.g. the parent-assembly WOs the library tool queues).
    // The On Ord column counts both, so the drill-down must show both (Stuart 2026-08-10: a WO-only
    // item read "no open purchase orders" while On Ord said 91).
    const openPoModal = async (item) => {
        const erp = (item.legacyErpId || item.itemId || '').toUpperCase();
        setPoModal({ erpId: erp, itemName: item.itemName || erp, loading: true, lines: [], error: null });
        const esc = erp.replace(/'/g, "''");
        const runQ = async (q) => {
            const r = await nsProxyFetch({ targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`, method: 'POST', payload: { q } });
            const b = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(typeof b === 'object' ? JSON.stringify(b) : String(b));
            return b.items || [];
        };
        try {
            const poRows = await runQ(`
                SELECT t.tranid AS po_number, t.id AS po_id, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate,
                       BUILTIN.DF(t.entity) AS vendor, tl.quantity AS qty,
                       tl.quantityshiprecv AS received, tl.rate AS rate
                FROM transaction t
                JOIN transactionline tl ON tl.transaction = t.id
                JOIN item i ON i.id = tl.item
                WHERE t.type = 'PurchOrd'
                  AND UPPER(i.itemid) = '${esc}'
                  AND NVL(tl.quantity, 0) <> NVL(tl.quantityshiprecv, 0)
                ORDER BY t.trandate DESC
            `);
            // Same open-WO shape as the On Ord aggregate: mainline carries the assembly being
            // built, quantityshiprecv = qty already built, enddate may not be queryable → fall back.
            const woQ = (extra) => `
                SELECT t.tranid AS po_number, t.id AS po_id, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate${extra},
                       BUILTIN.DF(t.status) AS statusname, ABS(NVL(tl.quantity, 0)) AS qty,
                       NVL(tl.quantityshiprecv, 0) AS received
                FROM transaction t
                JOIN transactionline tl ON tl.transaction = t.id AND tl.mainline = 'T'
                JOIN item i ON i.id = tl.item
                WHERE t.type = 'WorkOrd'
                  AND UPPER(i.itemid) = '${esc}'
                  AND BUILTIN.DF(t.status) NOT LIKE '%Closed%'
                  AND BUILTIN.DF(t.status) NOT LIKE '%Built%'
                ORDER BY t.trandate DESC
            `;
            let woRows;
            try { woRows = await runQ(woQ(", TO_CHAR(t.enddate, 'YYYY-MM-DD') AS expected")); }
            catch (weErr) { woRows = await runQ(woQ('')); }
            const lines = [
                ...poRows.map(l => ({ ...l, kind: 'PO' })),
                ...woRows.map(l => ({ ...l, kind: 'WO', vendor: `Production${l.statusname ? ` · ${l.statusname}` : ''}`, rate: null })),
            ];
            setPoModal(m => (m && m.erpId === erp) ? { ...m, loading: false, lines } : m);
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
    const openSalesHistory = async (forceRebuild = false) => {
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
            //
            // ⚠ PAGINATED (Stuart 2026-07-28: the 3-Tier view showed nothing for Fabricut H1 and the
            // header read "999" items). SuiteQL returns AT MOST 1000 rows per response — this query
            // was unpaginated, so once the stocked+old catalog passed 1000 items everything after the
            // cut simply did not exist as far as this whole report was concerned. It reads as a
            // tagging problem and no amount of re-tagging fixes it. Keyset pagination (id > lastId,
            // ordered) is the same pattern the NetSuite Sync tab already uses for customers.
            const itemRows = [];
            for (let lastId = 0, guard = 0; guard < 40; guard++) {
                const page = await runSql(`SELECT i.id AS internal_id, i.itemid AS itemid, i.custitem27 AS stk, i.custitem28 AS old, i.isinactive AS inact FROM item i JOIN ItemSubsidiaryMap ism ON ism.item = i.id WHERE ism.subsidiary = ${sub} AND ${flagWhere} AND i.id > ${lastId} ORDER BY i.id ASC`);
                itemRows.push(...page);
                if (page.length < 1000) break;
                lastId = parseInt(page[page.length - 1].internal_id) || 0;
                if (!lastId) break;
            }
            const stocked = [], oldByItemId = {};
            itemRows.forEach(row => {
                const rec = { internalId: String(row.internal_id), itemid: row.itemid };
                if (row.stk === 'T' && row.inact !== 'T') stocked.push(rec);
                if (row.old === 'T') oldByItemId[String(row.itemid).toUpperCase()] = rec;
            });
            // ── 2) SALES — A CLOSED MONTH NEVER CHANGES, SO STOP RE-ASKING FOR IT ──────────────────
            // Eric 2026-08-21, Stuart 2026-08-25: "when we open this report it takes a long time to
            // compile all of the sales history … it is compiling for 12 months sales, yet the older
            // months do not change, so can it save/cache this data?"
            //
            // Exactly so. Last October's sales are a fact; we were re-deriving them from NetSuite on
            // every single open, chunked 60 items at a time across the whole catalogue. Now each
            // CLOSED month is written once to sales_history/<brand>/months/<YYYY-MM> and read from
            // there forever after. Only the CURRENT month is fetched live, because it is the only
            // one that can still move.
            //
            // The cache is never the authority on a month that is still running, and "Rebuild" below
            // throws all of it away — so a wrong cached month is always one button from being
            // corrected, which is what makes caching safe to do at all.
            const allIds = itemRows.map(r => String(r.internal_id));
            const salesById = {};
            const CH = 60;
            const nowYm = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            const addRow = (iid, ym, qty, orders) => {
                let rec = salesById[iid]; if (!rec) { rec = { m: {}, orders: 0 }; salesById[iid] = rec; }
                rec.m[ym] = (rec.m[ym] || 0) + (parseInt(qty) || 0);
                rec.orders += parseInt(orders) || 0;
            };
            // Cached under `system/…` on purpose: firestore.rules grants read/write there to any
            // authenticated user, so this needs no rules change — and a rules change is a manual
            // Cloud Shell deploy, i.e. a feature that would silently not cache until someone
            // remembered to run it.
            const cacheDoc = (ym) => doc(db, 'system', `salesCache_${activeBrand}_${ym}`);
            const closedMonths = months.map(m => m.key).filter(k => k !== nowYm);
            let fromCache = 0, fetchedMonths = [];
            const cached = {};
            if (!forceRebuild) {
                await Promise.all(closedMonths.map(async (ym) => {
                    try {
                        const snap = await getDoc(cacheDoc(ym));
                        if (snap.exists()) { cached[ym] = snap.data().items || {}; fromCache++; }
                    } catch (e) { /* a missing cache just means we fetch it */ }
                }));
            }
            Object.entries(cached).forEach(([ym, items]) => {
                Object.entries(items).forEach(([iid, v]) => addRow(iid, ym, Array.isArray(v) ? v[0] : v, Array.isArray(v) ? v[1] : 0));
            });
            // Fetch the current month, plus any closed month we have never cached (first run, or a
            // month that rolled over since the last visit).
            const needMonths = months.map(m => m.key).filter(k => k === nowYm || !cached[k]);
            if (needMonths.length) {
                const earliest = needMonths.slice().sort()[0];
                setSalesHist(h => ({ ...(h || {}), loading: true, note: `${fromCache} month(s) from cache · fetching ${needMonths.length} from NetSuite…` }));
                const perMonth = {};
                for (let i = 0; i < allIds.length; i += CH) {
                    const chunk = allIds.slice(i, i + CH);
                    const rows = await runSql(`SELECT tl.item AS internal_id, TO_CHAR(t.trandate,'YYYY-MM') AS ym, SUM(ABS(tl.quantity)) AS qty, COUNT(DISTINCT t.id) AS orders FROM transaction t JOIN transactionline tl ON tl.transaction = t.id WHERE t.type = 'SalesOrd' AND tl.item IN (${chunk.join(',')}) AND tl.quantity <> 0 AND t.trandate >= TO_DATE('${earliest}-01','YYYY-MM-DD') GROUP BY tl.item, TO_CHAR(t.trandate,'YYYY-MM')`);
                    rows.forEach(row => {
                        const ym = String(row.ym || '');
                        if (!needMonths.includes(ym)) return;      // already cached — cache wins, no double count
                        addRow(String(row.internal_id), ym, row.qty, row.orders);
                        (perMonth[ym] = perMonth[ym] || {})[String(row.internal_id)] = [parseInt(row.qty) || 0, parseInt(row.orders) || 0];
                    });
                }
                fetchedMonths = needMonths;
                // Write ONLY closed months. The current month is deliberately never cached — it is
                // still moving, and a stale "this month" is the one number nobody would question.
                await Promise.all(needMonths.filter(ym => ym !== nowYm).map(async (ym) => {
                    try { await setDoc(cacheDoc(ym), { month: ym, brand: activeBrand, items: perMonth[ym] || {}, cachedAt: Date.now(), itemCount: Object.keys(perMonth[ym] || {}).length }); }
                    catch (e) { console.warn('Could not cache sales month', ym, e); }
                }));
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
            setSalesHist(s => (s ? { ...s, loading: false, note: null, rows, withOld: rows.filter(r => r.hasOld).length,
                cacheNote: `${fromCache} of ${months.length} month(s) read from cache${fetchedMonths.length ? ` · ${fetchedMonths.join(', ')} pulled live` : ''} · closed months are cached, the current month never is` } : s));
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

    // Urgent-core lookups for this brand: by the CORE code (Raw Cores view) and by the PLATED code
    // the backorder is actually for (Finished view), so the flag is visible on whichever view is up.
    const urgentForBrand = urgentCores.filter(u => !u.brandId || u.brandId === activeBrand);
    const urgentByCore = urgentForBrand.reduce((m, u) => { const k = String(u.coreErpId || '').toUpperCase(); (m[k] = m[k] || []).push(u); return m; }, {});
    const urgentByPlate = urgentForBrand.reduce((m, u) => { const k = String(u.plateErpId || '').toUpperCase(); (m[k] = m[k] || []).push(u); return m; }, {});
    const urgentTotalFor = (list) => (list || []).reduce((s, u) => s + (Number(u.shortfall) || 0), 0);
    const clearUrgentCore = async (u) => {
        if (!window.confirm(`Clear the urgent flag on ${u.coreErpId}?\n\nDo this once the work order is raised — it only removes the red flag, it changes no stock.`)) return;
        try {
            await hardDeleteWithLedger({ db, doc, setDoc, deleteDoc }, {
                collection: 'core_urgent_demand', docId: u.id, record: u, kind: 'core_urgent_demand',
                by: currentUser || '', from: 'STOCK_VIEW', reason: 'urgent flag cleared — WO raised',
            });
            addLog(`Cleared urgent core flag ${u.coreErpId} (${u.ref || ''}).`, 'info');
        }
        catch (e) { addLog(`Couldn't clear the urgent flag: ${e.message}`, 'error'); }
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
            // EA-HISTORY-IS-TRUTH (Stuart 2026-07-17, final rule): the -EA row's own history
            // already contains BOTH the genuine each-buyers AND the mirrored pack consumption —
            // so the single's demand = its OWN history, and the pack rows are simply NOT added
            // on top (that was the double-count). Available still counts remaining pack shelf
            // stock as single-equivalents (real inventory position).
            available += pk.packAvailEq;
            packNote = ` — EA history is the full single demand (pack consumption mirrors into it; ${pk.packItemIds.length} pack SKU(s) not added — no double count)`;
        }
        let minOnHand, minRule;
        if (isOutsourced) { minOnHand = Math.round(total12 / 2); minRule = 'Outsourced: 6 months of demand' + packNote; }
        else if (isAssembly) { minOnHand = Math.round((total12 / 52) * 6); minRule = 'Assembly: 6 weeks of demand (3wk finishing lead + 3wk safety)' + packNote; }
        else { minOnHand = Math.round((last6 / 26) * 4); minRule = 'Legacy: 4 weeks of the 6-month rate' + packNote; }
        const ropRaw = specs.reorderPoint;
        const rop = (ropRaw === '' || ropRaw === undefined || ropRaw === null) ? null : (parseInt(ropRaw) || 0);
        // ROP IS A FLOOR, NOT AN OVERRIDE (Stuart 2026-07-28: "when there are new items and no sales
        // history can we have it display the ROP until the Min OH sales average raises above it").
        // A brand-new item has no history, so the demand rule computes ~0 and the item looks fully
        // stocked at zero — the ROP you typed is the only real number, so it stands in. Once real
        // demand accumulates past it, the demand-derived figure takes over on its own.
        // NOTE this replaces the older "an explicit ROP overrides Min OH" rule: a ROP set BELOW the
        // demand rule no longer holds the threshold down.
        const minCalc = minOnHand;
        minOnHand = Math.max(minCalc, rop || 0);
        if (rop !== null && rop > minCalc) minRule = `Re-order point ${rop} — it exceeds the demand rule (${minCalc}). ${minRule}`;
        const threshold = minOnHand;
        const cap = isPole ? POLE_RACK : (lookupCapacity(capacityMatrix, size, ptype) || SIZE_CAPACITY[size] || 0);
        const shortfall = Math.max(0, threshold - (available + onOrd));
        const recommended = shortfall > 0 ? (cap > 0 ? Math.ceil(shortfall / cap) * cap : shortfall) : 0;
        return { part, size, ptype, isPole, isAssembly, isOutsourced, isSingleAgg: !!(pk && pk.isSingle), packCount: pk && pk.isSingle ? pk.packItemIds.length : 0, available, onOrd, minOnHand, minCalc, minRule, rop, threshold, cap, recommended };
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
            const reqDate = woNeedBy || new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            for (const { r, info, qty } of toMake) {
                const finish = finishOf(r.itemid);
                const woId = `WO-STK-${r.internalId}-${Date.now()}`;
                // FINISHED-GOODS awareness (Stuart 2026-08-10, same planner as the Master Library
                // tool): an ASSEMBLY row's own code never holds pullable stock — explode its BOM
                // into the real component pull lines so the WMS picks those, not a synthesized
                // raw pull of the assembly code. Single parts keep the exact behavior they had.
                let bomLines = [];
                if (isAssemblyPart(info.part)) {
                    try {
                        const pinsSnap = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', info.part.itemId)));
                        const pins = pinsSnap.docs.map(d => d.data());
                        if (pins.length) bomLines = planFinishedRun({ part: info.part, qty, pins, inventory: hqParts }).lines;
                    } catch (e) { console.warn('BOM explode failed for', r.itemid, e); }
                }
                // Source numbers only (Stuart 2026-07-17): no invented short WO # — screens show the
                // app id until the real NetSuite WO posts (~1 min after RTG release), then nsWoTran.
                // Poles are racked (8/rack), not sled-packed → no paintSizes; carry poles.qty so the planner
                // treats it as a rack-based workstream. Small parts carry the S/M/L size for sled packing.
                const paintSizes = (!info.isPole && ['S', 'M', 'L'].includes(info.size)) ? { S: 0, M: 0, L: 0, [info.size]: qty } : null;
                // The COMPLETE finishing doc is pre-built here but PARKED on the RTG work order —
                // it reaches fin_workorders only when RTG "Push to Finishing" releases it
                // (verbatim copy, so pole/rack/stock fields survive the review hop untouched).
                // Planner's ⇄ convert suggestion (if attached on the snapshot row) rides along —
                // the Setup Queue operator sees it on the card and runs the actual conversion.
                const sug = convSugMap[r.itemid];
                const sugBase = r.itemid.includes('/') ? r.itemid.slice(0, r.itemid.lastIndexOf('/')) : r.itemid;
                const finPayload = withItemCode({
                    id: woId, orderKey: woId,
                    ...(sug ? { convertSuggestion: { from: sug.from, to: sugBase, qty: sug.qty } } : {}),
                    quoteId: null, salesOrderId: null, estimateId: null,
                    orderType: 'stock', soId: null, soNum: null,
                    customerId: null, customerName: 'Internal Stock', customer: 'Internal Stock', clientName: 'Internal Stock',
                    recipe: finish || 'PENDING-RECIPE',
                    reqDate, type: r.itemid, totalParts: qty,
                    stockErpId: r.itemid, stockInternalId: r.internalId,
                    paintSize: info.isPole ? null : (info.size || null), productType: info.ptype || null, paintSizes,
                    ...(info.isPole ? { poles: { qty, type: info.ptype || 'POLE' }, totalPoles: qty } : {}),
                    // Finish-stream exception (library flag): e.g. the elbow — small part, but its
                    // runs use the -P pole recipe. The floor reads this off the WO doc.
                    ...(info.part?.manufacturingSpecs?.finishStream ? { finishStream: String(info.part.manufacturingSpecs.finishStream).toUpperCase() } : {}),
                    note: `Stock replenish · avail ${info.available} · min ${info.minOnHand}${info.isPole ? ' · POLE (rack of 8)' : ''}${sug ? ` · ⇄ SUGGEST: convert ${sug.qty} × ${sug.from} → raw ${sugBase}` : ''}${bomLines.length ? ` · BOM pull: ${bomLines.map(l => `${l.quantity}×${l.legacyErpId}`).join(', ')}` : ''}`,
                    cpqSpecs: {}, imageUrl: info.part?.finalImageUrl || null,
                    dimensions: { length: 0, width: 0, height: 0 },
                    partsList: bomLines,
                    ...(bomLines.length ? { bomExploded: true } : {}),
                    currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
                    tasks: makeFullTasks(),
                    machineAssigned: null, redlineAlert: false,
                    sentToPickPack: false, pickStatus: 'Pending',
                    shopSiblingId: null, hasCustomSibling: false, customFabStatus: 'Pending',
                    // Urgent rides INSIDE the payload so it survives the RTG review hop verbatim and
                    // lands on fin_workorders, which is what the Setup Queue actually reads.
                    ...(woUrgent ? { urgent: true, urgentAck: false, needBy: woNeedBy || reqDate, urgentBy: currentUser || '', urgentAt: Date.now() } : {}),
                    brand: activeBrand, createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser || ''
                });
                await setDoc(doc(db, "hq_work_orders", woId), withItemCode({
                    id: woId, woId, brand: activeBrand, type: 'Stock', status: 'Approved',
                    source: 'SALES_SNAPSHOT', routeTo: 'FINISHING', finPayload,
                    ...(woUrgent ? { urgent: true, needBy: woNeedBy || reqDate } : {}),
                    erpId: r.itemid, recipe: finish || 'PENDING-RECIPE', qty, totalParts: qty, reqDate,
                    paintSize: info.size || null, customer: 'Internal Stock',
                    createdAt: Date.now(), createdBy: currentUser || ''
                }), { merge: true });

                // ── POLES ARE STOCKED AT 8 FT — CUT BEFORE FINISH (Stuart 2026-08-19) ──────────
                // A 4 ft order used to send the warehouse looking for raw 4 ft rods, which nobody
                // stocks (Sandra: "debería pedir 10 tubos de 8 FT en vez de 20"). The pieces have to
                // be MADE, and the cut is a real inventory movement NetSuite must see — so the work
                // order gets a CUT ORDER in front of it rather than a pull it can never satisfy.
                // It lands in WMS → ROD CUTS under "Cuts for Finishing"; completing it prints this
                // order's finishing label, and from there it is an ordinary job.
                // The CATEGORY, not info.isPole — that flag also drives the pole FINISHING stream
                // (rack of 8), and a bracket finished on the pole recipe must never be cut.
                const cut = poleCutPlan(r.itemid, qty, { productType: info.ptype });
                if (cut) {
                    const srcPart = partByKey['erp:' + cut.sourceItemId.toUpperCase()];
                    const tgtPart = partByKey['erp:' + cut.targetItemId.toUpperCase()];
                    const srcRow = (salesHist?.rows || []).find(x => String(x.itemid).toUpperCase() === cut.sourceItemId.toUpperCase());
                    const srcNs = (srcRow && srcRow.internalId) || (srcPart && srcPart.netSuiteInternalId) || null;
                    const tgtRow = (salesHist?.rows || []).find(x => String(x.itemid).toUpperCase() === cut.targetItemId.toUpperCase());
                    const tgtNs = (tgtRow && tgtRow.internalId) || (tgtPart && tgtPart.netSuiteInternalId) || null;
                    if (srcNs && tgtNs) {
                        const cutId = `RC-${woId}`;                       // one cut per WO, re-runnable
                        await setDoc(doc(db, 'rod_cut_orders', cutId), {
                            id: cutId, brand: activeBrand, status: 'OPEN',
                            sourceItemId: cut.sourceItemId, sourceInternalId: String(srcNs),
                            targetItemId: cut.targetItemId, targetInternalId: String(tgtNs),
                            qtySource: cut.sourceQty, qtyTarget: cut.targetQty,
                            cutTo: cut.cutTo, scrapFt: cut.scrapFt,
                            sourceBin: null, destBin: null, nsAdjustmentId: null,
                            // WHAT MAKES IT A "CUT FOR FINISHING" rather than one for a sales order:
                            // it belongs to a work order, and finishing waits on it.
                            purpose: 'FINISHING', createdVia: 'FINISHING_WO',
                            finWoId: woId, finWoErpId: r.itemid, finWoQty: qty,
                            finWoRecipe: finish || '', finWoReqDate: reqDate,
                            overrun: cut.overrun,
                            createdAt: Date.now(), createdBy: currentUser || '',
                            completedAt: null, completedBy: null
                        }, { merge: true });
                        await updateDoc(doc(db, 'hq_work_orders', woId), {
                            awaitingRodCut: true, rodCutId: cutId,
                            rodCutNote: `${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}`,
                        }).catch(() => {});
                        addLog(`✂ ${r.itemid} ×${qty} needs cutting first — cut order ${cutId}: ${cut.sourceQty} × ${cut.sourceItemId} → ${cut.targetQty} × ${cut.targetItemId}${cut.overrun ? ` (+${cut.overrun} spare to stock)` : ''}. WMS → ROD CUTS → Cuts for Finishing.`, 'warn');
                    } else {
                        // Never invent an id — say which side is missing and leave the WO alone.
                        addLog(`⚠ ${r.itemid} is a ${cut.lengthFt} ft pole needing ${cut.sourceQty} × ${cut.sourceItemId}, but no NetSuite id was found for ${!srcNs ? cut.sourceItemId : cut.targetItemId} — NO cut order raised. Sync that item, then raise the cut from the snapshot's ✂ button.`, 'error');
                    }
                }
                n++;
            }
        }
        return n;
    };
    // ===== 📋 OPEN WORK ORDERS — cleanup panel (Stuart 2026-07-21) =====
    // One place to see every WO that isn't closed — RTG-parked + on the floor — with its floor
    // phase, NetSuite WO/build state and pack status, plus the two repair actions the early
    // out-of-sync mess needs: RESET back to the Setup Queue (picked) after a wrong NetSuite
    // build was deleted, and soft-CLOSE (queues the NetSuite WO close when one exists).
    const loadOpenWos = async () => {
        setOpenWos({ loading: true, rows: [] });
        try {
            const [hqSnap, finSnap] = await Promise.all([
                getDocs(collection(db, 'hq_work_orders')),
                getDocs(collection(db, 'fin_workorders')),
            ]);
            const finById = {};
            finSnap.docs.forEach(d => { finById[d.id] = { id: d.id, ...d.data() }; });
            const seenFin = new Set();
            const rows = [];
            hqSnap.docs.forEach(d => {
                const hq = { id: d.id, ...d.data() };
                if (['Closed', 'Cancelled', 'Done'].includes(hq.status)) return;
                const fin = finById[(hq.finPayload && hq.finPayload.id) || hq.id] || null;
                if (fin) seenFin.add(fin.id);
                if (fin && fin.currentPhase === 'Closed') return;
                if (fin && fin.packStatus === 'Packed') return; // done + put away = not open
                rows.push({ hq, fin });
            });
            finSnap.docs.forEach(d => {
                const fin = { id: d.id, ...d.data() };
                if (seenFin.has(fin.id) || fin.currentPhase === 'Closed' || fin.packStatus === 'Packed') return;
                rows.push({ hq: null, fin });
            });
            rows.sort((a, b) => (((b.fin && b.fin.createdAt) || (b.hq && b.hq.createdAt) || 0) - (((a.fin && a.fin.createdAt) || (a.hq && a.hq.createdAt) || 0))));
            setOpenWos({ loading: false, rows });
        } catch (e) { setOpenWos({ loading: false, rows: [], error: e.message || String(e) }); }
    };
    const woRowRef = (row) => (row.fin && (row.fin.nsWoTran || row.fin.displayId || row.fin.id)) || (row.hq && (row.hq.nsWoTran || row.hq.woNo || row.hq.id)) || '';
    const resetWoToSetup = async (row) => {
        const fin = row.fin;
        if (!fin) return alert('This WO is still parked in RTG (never released to the floor) — nothing to reset.');
        const ref = woRowRef(row);
        if (!window.confirm(`↩ RESET ${ref} back to the Setup Queue (picked, ready to start)?\n\n• Floor phase → Setup · coat 1 · all tasks Pending\n• Completion / pack / scrap stamps cleared\n• NetSuite BUILD flags cleared, so the real completion posts again when it happens\n\nThe NetSuite WORK ORDER itself is untouched (use this after deleting a wrong Assembly Build in NetSuite).`)) return;
        try {
            await updateDoc(doc(db, 'fin_workorders', fin.id), {
                currentPhase: 'Setup', stepStatus: 'Pending', currentStepIndex: 0,
                poleStepIndex: deleteField(), machineAssigned: null,
                tasks: makeFullTasks(),
                completedAt: deleteField(), completedParts: deleteField(), scrapReported: deleteField(),
                packStatus: deleteField(), packedLines: deleteField(), packPhotos: deleteField(), packBoxes: deleteField(), packedAt: deleteField(), packedBy: deleteField(),
                nsCompletionQueued: deleteField(), nsWoCompletionPosted: deleteField(), nsWoCompletionId: deleteField(), nsWoCompletionTran: deleteField(),
                nsFulfillQueued: deleteField(), nsIfId: deleteField(), nsIfTran: deleteField(),
                redlineAlert: false, resetAt: Date.now(), resetBy: currentUser || ''
            });
            if (row.hq) await updateDoc(doc(db, 'hq_work_orders', row.hq.id), { status: 'Dispatched' }).catch(() => {});
            addLog(`↩ ${ref} reset to Setup (picked) — NetSuite build flags cleared.`, 'success');
            loadOpenWos();
        } catch (e) { alert('Reset failed: ' + (e.message || e)); }
    };
    // The close a person still has to do in NetSuite goes out on OS Comms, because a task nobody
    // is told about is not a task (Eric's Option 3 — the app cannot close a non-WIP work order).
    const notify = async (msg) => {
        try {
            await addDoc(collection(db, 'global_messages'), {
                sender: 'System', sourceApp: 'STOCK_VIEW', target: 'ALL', isSystem: true,
                t: serverTimestamp(), msg,
            });
        } catch (e) { console.warn('OS Comms notify failed:', e); }
    };

    const closeWoRow = async (row) => {
        const fin = row.fin, hq = row.hq;
        const ref = woRowRef(row);
        const nsNote = (fin && fin.nsWoId && !fin.nsWoClosed && !fin.nsWoCompletionPosted) ? `\n\nIts NetSuite work order (${fin.nsWoTran || fin.nsWoId}) gets a CLOSE queued too.` : '';
        if (!window.confirm(`✕ CLOSE ${ref}?\n\nIt leaves every queue (docs kept for history).${nsNote}`)) return;
        try {
            // ONE CLOSER (Stuart 2026-08-19). This reached the finishing job and the RTG record but
            // never the SHOP sibling, so a custom order closed here left its shop half live.
            const res = await closeOrderEverywhere(
                { db, doc, getDoc, getDocs, query, collection, where, updateDoc },
                { order: fin || hq, kind: 'stock', by: currentUser || 'StockView', from: 'STOCK_VIEW', notify }
            );
            addLog(`✕ Closed ${ref} — ${res.fin} finishing, ${res.shop} shop, ${res.hq} RTG${res.ns ? `, NetSuite close queued (${res.ns}) — NOT confirmed` : ''}.`, res.ns ? 'warn' : 'info');
            loadOpenWos();
        } catch (e) { alert('Close failed: ' + (e.message || e)); }
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
    // NAME MATCHING IS THE FALLBACK NOW, NOT THE MECHANISM (2026-08-15). The item sync carries the
    // vendor's NetSuite internal id (`manufacturingSpecs.vendorNsId`, from the ItemVendor sublist),
    // so a PO no longer depends on a library vendor name spelling its way to a CRM record — a
    // near-miss used to produce NO PO at all. The name still wins when it resolves (an operator's
    // vendor override is a deliberate choice); the id only rescues what the name drops.
    const resolveVendorByNsId = (vendors, nsId) => {
        const id = String(nsId || '').replace(/^VEND-/, '').trim();
        if (!id) return null;
        return vendors.find(v => String(v.id) === `VEND-${id}`) || null;
    };
    // The id most of the group's items agree on — one straggler with a stale vendor can't hijack it.
    const consensusVendorNsId = (parts) => {
        const tally = {};
        parts.forEach(p => { const id = p?.manufacturingSpecs?.vendorNsId; if (id) tally[id] = (tally[id] || 0) + 1; });
        return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };
    // CAN THIS SUBSIDIARY BUY FROM THIS VENDOR? (Eric, 2026-08-15) A PO carries the BUYING company's
    // subsidiary, but NetSuite only accepts a vendor assigned to it — and ours are routinely assigned
    // the other way round (The Generator's primary subsidiary is M2C Studio, Dayton Grey's is
    // Classical Elements). Unchecked, that surfaces at push time as a confusing complaint about the
    // *location* field. An empty list means the vendor sync couldn't read the assignments, which is
    // silence, not a denial — so it never warns on missing data.
    const vendorSubsidiaryGap = (rec, subsidiaryId) => {
        const subs = Array.isArray(rec?.nsSubsidiaries) ? rec.nsSubsidiaries.map(String) : [];
        if (!subs.length || !subsidiaryId) return null;
        return subs.includes(String(subsidiaryId)) ? null : subs;
    };
    // What the vendor actually charges, in the order NetSuite knows it: the vendor sublist's own
    // purchase price, then the item's purchase price (Eric's `cost`), then average cost — which is
    // a costing artefact and was silently rating every PO line until 2026-08-15.
    const poRateOf = (part) => {
        const s = part?.manufacturingSpecs || {};
        return parseFloat(s.vendorPurchasePrice) || parseFloat(s.purchasePrice) || parseFloat(s.cost) || 0;
    };
    // One app PO per vendor (same doc shape as the grid's PO builder — lands in RTG Dispatch, which
    // pushes it to NetSuite). Lines carry the NetSuite ITEM internal id; the doc carries the
    // NetSuite VENDOR internal id. Returns { made, unmatched }.
    const createStockPOs = async (buyList) => {
        const vendors = await loadNsVendors();
        const byVendor = new Map();
        buyList.forEach(x => {
            // x.vendorOverride = the vendor CONFIRMED in the vendor modal; the item's stored
            // vendorName is only the default. Grouping is by the confirmed name, so a batch of 30
            // items across several vendors still collapses to ONE PO per vendor.
            const v = String(x.vendorOverride || x.info.part?.manufacturingSpecs?.vendorName || '').trim();
            if (!byVendor.has(v)) byVendor.set(v, []);
            byVendor.get(v).push(x);
        });
        const made = [], unmatched = [], wrongSub = [];
        const poSubsidiary = (BRAND_NETSUITE_MAP[activeBrand] || {}).subsidiary || '';
        for (const [vendor, list] of byVendor.entries()) {
            const rec = resolveVendorRec(vendors, vendor)
                || resolveVendorByNsId(vendors, consensusVendorNsId(list.map(x => x.info.part)));
            if (!rec) { unmatched.push({ vendor, items: list.map(x => x.r.itemid) }); continue; }
            const nsVendorId = String(rec.id || '').replace(/^VEND-/, '');
            // Short human reference (PO-1042) as the id itself — unique via the atomic counter;
            // falls back to the legacy vendor-stamp format if the counter isn't reachable.
            let newPoId;
            try { newPoId = await reserveShortNo('PO'); }
            catch (e) { newPoId = `PO-${(vendor || 'VEND').replace(/[^a-zA-Z0-9]/g, '').substring(0, 5)}-${Date.now().toString().slice(-6)}`; }
            const items = list.map(({ r, info, qty }) => ({
                itemId: info.part?.legacyErpId || info.part?.itemId || r.itemid,
                nsItemId: String(r.internalId),   // NetSuite item internal id — the push builds real lines from this
                vendorPart: info.part?.manufacturingSpecs?.vendorId || 'N/A',
                quantity: qty, rate: poRateOf(info.part),
                description: info.part?.manufacturingSpecs?.purchaseDescription || info.part?.itemName || r.itemid
            }));
            // The PO is still created — this is NetSuite master-data to fix, not a reason to lose the
            // buy list. It's stamped so RTG can say the same thing before pushing.
            const gap = vendorSubsidiaryGap(rec, poSubsidiary);
            if (gap) wrongSub.push({ vendor: rec.name || vendor, has: gap, poId: newPoId });
            await setDoc(doc(db, "hq_purchase_orders", newPoId), {
                id: newPoId, poId: newPoId, brand: activeBrand, status: "Approved",
                vendor: rec.name || vendor, nsVendorId, vendorCrmId: rec.id,
                nsSubsidiary: poSubsidiary, vendorSubsidiaryGap: gap ? gap.join(',') : '',
                items, source: 'SALES_SNAPSHOT',
                reqDate: new Date(Date.now() + 12096e5).toISOString().split('T')[0], createdAt: Date.now(), createdBy: currentUser || ''
            });
            made.push({ vendor: rec.name || vendor, lines: items.length });
            addLog(`✅ PO ${newPoId} → ${rec.name || vendor} (NS vendor ${nsVendorId}, ${items.length} line${items.length === 1 ? '' : 's'})${gap ? ` ⚠ vendor is not assigned to subsidiary ${poSubsidiary}` : ''}.`, gap ? 'warn' : 'success');
        }
        if (unmatched.length) {
            alert(`⚠️ NO PO created for ${unmatched.length} vendor(s) — the name on the items doesn't match any NetSuite-synced vendor (11.1 → Sync Active Vendors):\n\n${unmatched.map(u => `• "${u.vendor || '(blank)'}" — ${u.items.slice(0, 6).join(', ')}${u.items.length > 6 ? '…' : ''}`).join('\n')}\n\nTwo ways to fix it: re-run 11.1 → Sync Master Library (the item sync now carries the vendor's NetSuite internal id, which resolves these without the name matching at all), or correct the vendor name in the Master Library. Then re-generate those items.`);
        }
        if (wrongSub.length) {
            alert(`⚠️ ${wrongSub.length} PO(s) were created, but NetSuite will refuse them as they stand:\n\n${wrongSub.map(w => `• ${w.poId} — ${w.vendor} is assigned to subsidiary ${w.has.join(' / ')}, not ${poSubsidiary}`).join('\n')}\n\nThis PO is issued by subsidiary ${poSubsidiary}, and NetSuite only lets a subsidiary buy from a vendor assigned to it. NetSuite reports this as an "Invalid Field Value … for the following field: location" error, which is misleading — the location is fine.\n\nFix in NetSuite: add subsidiary ${poSubsidiary} to those vendor records, then re-run 11.1 → Sync Active Vendors and push.`);
        }
        return { made, unmatched, wrongSub };
    };
    // ONE snapshot filter predicate, shared by the Finished table, the Raw Cores rollup and the CSV
    // (Stuart 2026-07-28: "when i switch view to raw the filter no longer really filters" — the
    // rollup was reading the UNFILTERED rows, so only the search box appeared to work there).
    // Category/collection come off the resolved Master Library part, same fields the main grid uses.
    const snapPartOf = (r) => partByKey['id:' + String(r.internalId)] || partByKey['erp:' + String(r.itemid).toUpperCase()];
    const snapWatchOf = (r) => {
        const s = snapPartOf(r)?.manufacturingSpecs || {};
        const nsW = s.customData?.watchlist && s.customData.watchlist !== 'N/A' ? s.customData.watchlist : '';
        return String(s.watchList || nsW || 'NONE').toUpperCase();
    };
    const snapRowOk = (r) => {
        const term = salesHistSearch.trim().toUpperCase();
        if (term && !String(r.itemid).toUpperCase().includes(term)) return false;
        if (snapWatch && snapWatchOf(r) !== snapWatch.toUpperCase()) return false;
        if (!snapCat && !snapColl) return true;
        const part = snapPartOf(r);
        const sp = part?.manufacturingSpecs || {};
        if (snapCat) {
            const pt = String(sp.productType || part?.productType || '').toUpperCase();
            if (pt !== snapCat.toUpperCase()) return false;
        }
        if (snapColl) {
            const cols = (sp.collections || (sp.customData?.collection ? [sp.customData.collection] : [])).map(c => String(c || '').toUpperCase());
            if (!cols.includes(snapColl.toUpperCase())) return false;
        }
        return true;
    };

    // WHY IS THIS EMPTY? (Stuart 2026-07-28: "i set all H1 /P items as stocked and in house and
    // still nothing"). A blank snapshot has four possible causes and they look identical on screen,
    // so count each gate and let the empty state name the one that actually failed.
    // The gate people miss: the ROW UNIVERSE is NetSuite's custitem27 read live — the app's own
    // "Stocked finished assembly" checkbox is a DIFFERENT field (manufacturingSpecs.isStocked, a
    // one-way copy FROM NetSuite that drives the CPQ push) and is never written back, so ticking it
    // here can never put an item in this report.
    const snapDiagnostics = () => {
        const all = (salesHist && salesHist.rows) || [];
        const term = salesHistSearch.trim().toUpperCase();
        const searched = term ? all.filter(r => String(r.itemid).toUpperCase().includes(term)) : all;
        // Category/collection/watchlist are read off the resolved MASTER LIBRARY part — a row with no
        // part can never match one of those, however it's tagged in NetSuite.
        const unlinked = searched.filter(r => !snapPartOf(r)).length;
        return { total: all.length, term, searched: searched.length, unlinked, metaOn: !!(snapCat || snapColl || snapWatch) };
    };
    const snapWhyEmpty = (extra) => {
        const d = snapDiagnostics();
        return (
            <div style={{ padding: '40px 48px', fontFamily: 'var(--sans)', color: 'var(--ink-soft)', fontSize: '0.95rem', lineHeight: 1.7 }}>
                <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '1.2rem', color: 'var(--ink)', marginBottom: '16px' }}>Nothing to show here.</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', marginBottom: '18px' }}>
                    {d.total} stocked row{d.total === 1 ? '' : 's'} loaded{d.term ? ` · ${d.searched} contain “${d.term}”` : ''}{d.metaOn && d.unlinked ? ` · ${d.unlinked} of those have no Master Library part` : ''}
                </div>
                {extra}
                {d.term && d.searched === 0 && (
                    <div style={{ marginTop: '10px' }}>
                        No stocked item # contains “{d.term}”, so those items aren’t flagged <strong>Stocked (custitem27) in NetSuite</strong> — which is the only thing that puts a row in this report. ⚠ The app’s own “Stocked finished assembly” checkbox is a <em>different</em> field: it tells CPQ to push the finished assembly, it is a one-way copy <em>from</em> NetSuite, and it is never written back. Tick the box in NetSuite, then re-open the snapshot (no re-sync needed — this reads NetSuite live).
                    </div>
                )}
                {d.metaOn && d.unlinked > 0 && (
                    <div style={{ marginTop: '10px' }}>
                        {d.unlinked} row{d.unlinked === 1 ? ' has' : 's have'} no Master Library part. Category / collection / watchlist are read off that part, so those rows can never match one of those filters — run 11.1 → item sync, or ✕ Clear and search the item # instead.
                    </div>
                )}
            </div>
        );
    };

    // Raw-core rollup, hoisted to component scope so the TABLE and the ORDER GENERATOR read the
    // exact same groups (they used to live inside the render, which is why ordering couldn't work
    // from this view). Demand for every finish variant rolls into its BOM base.
    // `filtered` is opt-in: the TABLE passes true so the view obeys the filters, while the ORDER
    // GENERATOR passes false — a qty typed under one filter must never vanish because the filter
    // changed before Generate (inputs only exist on visible rows, so nothing unseen can be ordered).
    const rawCoreGroups = (filtered = false) => {
        const byBase = new Map();
        ((salesHist && salesHist.rows) || []).filter(r => !filtered || snapRowOk(r)).forEach(r => {
            const id = String(r.itemid);
            const cut = id.lastIndexOf('/');
            if (cut <= 0) return;
            const base = id.slice(0, cut).toUpperCase();
            // EA history already contains pack consumption — counting PACK rows too would double.
            const pk = packMap.get(id.toUpperCase());
            if (pk && pk.isPack) return;
            let g = byBase.get(base);
            if (!g) { g = { base, cells: salesHist.months.map(() => 0), total: 0, orders: 0, variants: [] }; byBase.set(base, g); }
            r.cells.forEach((c, i) => { g.cells[i] += (c.v || 0); });
            g.total += (r.total || 0); g.orders += r.orders; g.variants.push(id);
        });
        return [...byBase.values()].sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
    };
    // Core default Min OH = 6 MONTHS of combined variant demand — this screen's whole purpose is
    // that the cores feeding finishing never run dry. An explicit ROP overrides it.
    const rawInfoOf = (g) => {
        const part = partByKey['erp:' + g.base];
        const iid = part?.netSuiteInternalId ? String(part.netSuiteInternalId) : null;
        const available = (iid && rawStock?.availById) ? Math.round(rawStock.availById[iid] || 0) : 0;
        const inb = (iid && rawStock?.inboundById) ? rawStock.inboundById[iid] : null;
        const onOrd = inb ? Math.round(inb.qty) : 0;
        const specs = part?.manufacturingSpecs || {};
        const minCalc = Math.round(g.total / 2);
        const ropRaw = specs.reorderPoint;
        const rop = (ropRaw === '' || ropRaw === undefined || ropRaw === null) ? null : (parseInt(ropRaw) || 0);
        // Same floor rule as the finished items: a core with no history yet reads its ROP until the
        // combined variant demand grows past it.
        const minOnHand = Math.max(minCalc, rop || 0);
        const threshold = minOnHand;
        const shortfall = Math.max(0, threshold - (available + onOrd));
        return { part, iid, available, onOrd, onOrdLines: inb ? inb.lines : [], minOnHand, minCalc, rop, threshold, shortfall, vendored: !!String(specs.vendorName || '').trim() };
    };
    // Order-generator shape: matches the Finished view's {r, info, qty} so createStockPOs is reused
    // verbatim (r.internalId becomes the PO line's NetSuite item id).
    const rawOrderRows = () => rawCoreGroups().map(g => {
        const info = rawInfoOf(g);
        return { r: { itemid: g.base, internalId: info.iid }, info, qty: parseInt(rawOrderQty[g.base]) || 0 };
    });

    // RAW CORES → SHOP FLOOR (Stuart 2026-07-28). A raw core is an unfinished base (HAFICBR1S,
    // H1-75DS) — it gets milled/fabricated, never painted, so it routes to the SHOP floor, not
    // Finishing. No pre-built payload is needed: RTG's pushToShop builds the shop doc itself
    // (routeTo MILLING for stock), unlike the finishing path which parks a verbatim finPayload.
    // The WO still lands in RTG first so ns_outbox serializes the NetSuite write.
    const createStockShopWOs = async (toMake) => {
        let n = 0;
        const reqDate = woNeedBy || new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        for (const { r, info, qty } of toMake) {
            const stamp = Date.now().toString().slice(-6);
            const safeErp = String(r.itemid).replace(/[^A-Za-z0-9]+/g, '-');
            const woId = `WO-CORE-${safeErp}-${stamp}-${n}`;
            await setDoc(doc(db, "hq_work_orders", woId), withItemCode({
                id: woId, woId, brand: activeBrand, type: 'Stock', status: 'Approved',
                source: 'RAW_CORES', routeTo: 'SHOP',
                ...(woUrgent ? { urgent: true, needBy: woNeedBy || reqDate } : {}),
                erpId: r.itemid, partErpId: r.itemid,
                nsItemId: r.internalId ? String(r.internalId) : null,
                hqJobId: info.part?.id || null,
                qty, totalParts: qty, reqDate, customer: 'Internal Stock',
                routingType: info.part?.routingType || 'Standard',
                rootItem: r.itemid,
                note: `Raw core replenish · avail ${info.available} · threshold ${info.threshold ?? info.minOnHand ?? 0}`,
                createdAt: Date.now(), createdBy: currentUser || ''
            }), { merge: true });
            n++;
        }
        return n;
    };

    // ---- SCENARIO 3: THE THREE-TIER VIEW (Stuart 2026-07-28) ----------------------------------
    // Fabricut H1 is stocked at THREE levels and they only make sense read together:
    //   H1-75DS      raw mill core                      → shop floor work order
    //   H1-75DS/P    phosphated in-house base           → a CONVERT to-do on the WMS cart
    //   H1-75DS/EP1  outsourced plated                  → a plating to-do on the WMS plating tab
    // (any other suffix — a painted finish that stocks in its own right — is finished goods and
    // routes to Finishing exactly like the FIN view does.)
    // The tier of a variant is DERIVED from its suffix, never asked: "P" is the phosphate tier;
    // a suffix matching a configured outsource finish (EP1, EP2…) is the plated tier; the rest is
    // finished goods. Same rule the main grid's plated-line split already uses.
    const TIER_PHOS = 'PHOS', TIER_PLATE = 'PLATE', TIER_FIN = 'FIN';
    const tierOfItem = (itemid) => {
        const id = String(itemid || '').toUpperCase();
        const cut = id.lastIndexOf('/');
        if (cut <= 0) return null;
        const suffix = id.slice(cut + 1);
        if (suffix === 'P') return TIER_PHOS;
        return outsourceFinishes.some(f => finishCodeOf(f) === suffix) ? TIER_PLATE : TIER_FIN;
    };
    // Groups = one raw base + its variant rows, ONLY where a "/P" variant exists — that /P is what
    // makes an item three-tier. Bases without one are ordinary raw cores and live on the RAW view.
    // Demand on the base row is the sum of every variant (one core per finished unit), which is the
    // same rollup rawCoreGroups does; the variant rows keep their own history.
    // The filter is applied to the FAMILY, not to the individual tier rows: a family shows when any of
    // its tiers matches, and then shows ALL of them. Filtering row-by-row would hide the /P (different
    // category/watchlist than the plated SKU is entirely normal) and a half-family defeats the view —
    // its whole purpose is reading the stock levels against each other.
    const tierGroups = (filtered = false) => {
        const byBase = new Map();
        ((salesHist && salesHist.rows) || []).forEach(r => {
            const id = String(r.itemid).toUpperCase();
            const cut = id.lastIndexOf('/');
            if (cut <= 0) return;
            const pk = packMap.get(id);
            if (pk && pk.isPack) return;   // EA history already carries pack consumption
            const base = id.slice(0, cut);
            let g = byBase.get(base);
            if (!g) { g = { base, cells: salesHist.months.map(() => 0), total: 0, variants: [], hasPhos: false, anyMatch: false }; byBase.set(base, g); }
            r.cells.forEach((c, i) => { g.cells[i] += (c.v || 0); });
            g.total += (r.total || 0);
            const tier = tierOfItem(id);
            if (tier === TIER_PHOS) g.hasPhos = true;
            if (snapRowOk(r)) g.anyMatch = true;
            g.variants.push({ r, tier });
        });
        // /P first (it's the in-house base), then the plated tiers, then anything else.
        const rank = { [TIER_PHOS]: 0, [TIER_PLATE]: 1, [TIER_FIN]: 2 };
        return [...byBase.values()].filter(g => g.hasPhos && (!filtered || g.anyMatch)).map(g => ({
            ...g,
            variants: g.variants.sort((a, b) => (rank[a.tier] - rank[b.tier]) || String(a.r.itemid).localeCompare(String(b.r.itemid), undefined, { numeric: true, sensitivity: 'base' }))
        })).sort((a, b) => a.base.localeCompare(b.base, undefined, { numeric: true, sensitivity: 'base' }));
    };

    // /P ordered → a CONVERT to-do on the WMS Convert tab (raw is pulled to the phosphate cart, then
    // the assembly build posts). No NetSuite write happens here — the demand doc is the work request;
    // the operator's convert is what moves stock, so this can never race the ns_outbox.
    const createConvertDemands = async (rows) => {
        let n = 0;
        for (let i = 0; i < rows.length; i++) {
            const { r, info, qty, baseErp, baseInfo } = rows[i];
            const demandId = `CVD-${activeBrand.toUpperCase()}-${Date.now()}-${i}`;
            await setDoc(doc(db, 'convert_demand', demandId), {
                id: demandId, brandId: activeBrand, status: 'open',
                woNum: `CVW-${activeBrand.toUpperCase()}-${(Date.now() + i).toString().slice(-6)}`,
                baseErpId: baseErp, baseItemId: baseInfo?.part?.id || null,
                baseInternalId: baseInfo?.iid || null, baseAvailAtRequest: baseInfo?.available ?? null,
                targetErpId: String(r.itemid).toUpperCase(), targetItemId: info.part?.id || null,
                targetInternalId: r.internalId ? String(r.internalId) : null,
                qty, source: 'stockview',
                note: `Stock replenish · ${String(r.itemid).toUpperCase()} avail ${info.available} · min ${info.minOnHand}`,
                createdBy: String(currentUser?.name || currentUser || ''), createdAt: Date.now()
            });
            addLog(`⇄ Convert demand ${baseErp} → ${r.itemid} ×${qty} (WMS Convert tab).`, 'info');
            n++;
        }
        return n;
    };
    // Plated tier ordered → the SAME "Needs Plating" queue the main grid already writes (the base is
    // pulled to WIP-Plating and ships to the plater), reusing that doc shape verbatim so PickPack
    // needs no new reader for it.
    const createPlatingDemands = async (rows) => {
        let n = 0;
        for (let i = 0; i < rows.length; i++) {
            const { r, qty, baseErp, baseInfo } = rows[i];
            const erp = String(r.itemid).toUpperCase();
            const suffix = erp.slice(erp.lastIndexOf('/') + 1);
            const fin = outsourceFinishes.find(f => finishCodeOf(f) === suffix);
            const demandId = `PLD-${activeBrand.toUpperCase()}-${Date.now()}-${i}`;
            await setDoc(doc(db, 'plating_demand', demandId), {
                id: demandId, brandId: activeBrand, status: 'open',
                woNum: `PLW-${activeBrand.toUpperCase()}-${(Date.now() + i).toString().slice(-6)}`,
                baseItemId: baseInfo?.part?.id || null, baseErpId: baseErp, targetErpId: erp,
                finishCode: suffix, finishName: (fin && fin.name) || '', qty,
                source: 'stockview', createdBy: String(currentUser?.name || currentUser || ''), createdAt: Date.now()
            });
            addLog(`⚡ Plating demand ${baseErp} → ${erp} ×${qty} (WMS Plating tab).`, 'info');
            n++;
        }
        return n;
    };

    // One execute for the whole tier batch. buy/shop are the RAW base rows (routed by the same rule
    // the Raw Cores view uses); conv/plate/fin are the variant rows.
    const executeTierOrders = async ({ buy = [], shop = [], conv = [], plate = [], fin = [] }) => {
        setGenBusy(true);
        try {
            const poResult = buy.length ? await createStockPOs(buy) : { made: [], unmatched: [] };
            const shopWos = shop.length ? await createStockShopWOs(shop) : 0;
            const convN = conv.length ? await createConvertDemands(conv) : 0;
            const plateN = plate.length ? await createPlatingDemands(plate) : 0;
            const finWos = fin.length ? await createStockFinWOs(fin) : 0;
            setTierOrderQty({});
            const lines = [
                ...poResult.made.map(p => `• PO → ${p.vendor} (${p.lines} lines) — push to NetSuite from RTG Dispatch`),
                ...(shopWos ? [`• ${shopWos} raw core work order(s) → RTG Dispatch (Push to Shop there)`] : []),
                ...(convN ? [`• ${convN} convert to-do(s) → WMS · Convert tab ("Needs Phosphating")`] : []),
                ...(plateN ? [`• ${plateN} plating to-do(s) → WMS · Plating tab ("Needs Plating")`] : []),
                ...(finWos ? [`• ${finWos} finishing work order(s) → RTG Dispatch (release to Finishing there)`] : []),
            ];
            if (lines.length) alert(`✅ Generated:\n${lines.join('\n')}`);
        } catch (e) {
            addLog(`Tier orders failed: ${e.message}`, 'error');
            // convert_demand is a NEW collection — until its firestore rule is published, its writes
            // come back permission-denied while everything else in the batch succeeds. Say so plainly.
            const perm = /permission|insufficient/i.test(String(e.message || e));
            alert('Failed to generate tier orders:\n\n' + (e.message || e) + (perm ? '\n\n→ If this happened on a /P row, publish the `convert_demand` firestore rule (Cloud Shell: firebase deploy --only firestore:rules).' : ''));
        }
        setGenBusy(false);
    };

    const generateTierOrders = async () => {
        const qtyOf = (erp) => parseInt(tierOrderQty[String(erp).toUpperCase()]) || 0;
        const groups = tierGroups();
        const buy = [], shop = [], conv = [], plate = [], fin = [], unlinked = [], shortWarn = [];
        groups.forEach(g => {
            const baseInfo = rawInfoOf(g);
            const baseQty = qtyOf(g.base);
            if (baseQty > 0) {
                if (!baseInfo.part) unlinked.push(g.base);
                else {
                    const x = { r: { itemid: g.base, internalId: baseInfo.iid }, info: baseInfo, qty: baseQty };
                    const specs = baseInfo.part.manufacturingSpecs || {};
                    const vendorName = String(specs.vendorName || '').trim();
                    // Same rules as the Raw Cores router: sourced BOTH ways → always ask (defaulted to
                    // the work order); otherwise an assembly is BUILT here whatever isInHouse says.
                    const isAssembly = baseInfo.part.partClass === 'Assembly' || baseInfo.part.partClass === 'Master Assembly' || baseInfo.part.netSuiteRecordType === 'assemblyitem';
                    if (sourcingOf(specs) === SOURCING.BOTH) buy.push({ ...x, vendorOverride: '__MAKE__', bothSourced: true });
                    else if (isAssembly) shop.push(x);
                    else if (specs.isInHouse === false || vendorName) buy.push({ ...x, vendorOverride: vendorName });
                    else shop.push(x);
                }
            }
            g.variants.forEach(({ r, tier }) => {
                const qty = qtyOf(r.itemid);
                if (qty <= 0) return;
                const info = reorderFor(r);
                if (!info.part) { unlinked.push(String(r.itemid)); return; }
                const row = { r, info, qty, baseErp: g.base, baseInfo };
                if (tier === TIER_PHOS) conv.push(row);
                else if (tier === TIER_PLATE) plate.push(row);
                else fin.push(row);
            });
            // Convert + plating both EAT THE RAW CORE. Flag it when the raw on hand (plus what's
            // inbound, plus whatever was typed on the base row right here) can't cover them — no WO
            // is auto-created, because the base row on this very screen is where that call is made
            // and a silent extra WO would double-order it.
            const eats = [...conv, ...plate].filter(x => x.baseErp === g.base).reduce((s, x) => s + x.qty, 0);
            const coverage = (baseInfo.available || 0) + (baseInfo.onOrd || 0) + baseQty;
            if (eats > coverage) shortWarn.push(`${g.base}: ${eats} needed vs ${coverage} covered (short ${eats - coverage})`);
        });
        if (unlinked.length) alert(`⚠️ ${unlinked.length} row(s) have no Master Library part and were skipped:\n\n${unlinked.slice(0, 10).map(x => `• ${x}`).join('\n')}`);
        if (!buy.length && !shop.length && !conv.length && !plate.length && !fin.length) return alert('Enter an Order quantity on at least one tier row first.');
        const pieces = [];
        if (buy.length) pieces.push(`${buy.length} raw core(s) → vendor PO (vendor confirmed next)`);
        if (shop.length) pieces.push(`${shop.length} raw core(s) → shop-floor work order`);
        if (conv.length) pieces.push(`${conv.length} /P item(s) → WMS Convert to-do (phosphate)`);
        if (plate.length) pieces.push(`${plate.length} plated item(s) → WMS Plating to-do`);
        if (fin.length) pieces.push(`${fin.length} finished item(s) → Finishing work order`);
        const warn = shortWarn.length ? `\n\n⚠ RAW CORE SHORT for the convert/plating you're asking for:\n${shortWarn.map(s => `• ${s}`).join('\n')}\n\nOrder the raw base on its own row too, or the floor will run out mid-batch.` : '';
        if (!window.confirm(`Generate:\n\n• ${pieces.join('\n• ')}${warn}\n\nWork orders and POs stage in RTG Dispatch; convert/plating to-dos appear on the WMS tabs. Nothing reaches NetSuite until it's dispatched or the operator posts the move.`)) return;
        if (!buy.length) return executeTierOrders({ shop, conv, plate, fin });
        setGenBusy(true);
        let nsVendors = [];
        try { nsVendors = await loadNsVendors(); } catch (e) { /* picker falls back to free text */ }
        setGenBusy(false);
        setVendorModal({ buy, shop, vendors: nsVendors, tier: { conv, plate, fin } });
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
    // ---- RAW CORES ORDERING (Stuart 2026-07-28) ----------------------------------------------
    // The Raw Cores view used to be read-only ("sets thresholds only"). It now orders the same way
    // the Finished view does, with two differences: MADE cores go to the SHOP floor (they're
    // unfinished bases), and every BOUGHT core passes through a vendor-confirmation step before
    // any PO is cut — Stuart's rule, because the stored vendor is a default, not a decision.
    const executeRawOrders = async (buy, shop) => {
        const pieces = [];
        if (buy.length) pieces.push(`${new Set(buy.map(x => String(x.vendorOverride || x.info.part?.manufacturingSpecs?.vendorName || '').trim())).size} vendor PO(s) covering ${buy.length} item(s)`);
        if (shop.length) pieces.push(`${shop.length} shop-floor work order(s)`);
        if (!pieces.length) return alert('Nothing to generate.');
        setGenBusy(true);
        try {
            const poResult = buy.length ? await createStockPOs(buy) : { made: [], unmatched: [] };
            const wos = shop.length ? await createStockShopWOs(shop) : 0;
            setRawOrderQty({});
            const lines = [
                ...poResult.made.map(p => `• PO → ${p.vendor} (${p.lines} lines) — push to NetSuite from RTG Dispatch`),
                ...(wos ? [`• ${wos} core work order(s) → RTG Dispatch (Push to Shop there)`] : []),
            ];
            if (lines.length) alert(`✅ Generated:\n${lines.join('\n')}`);
        } catch (e) { addLog(`Raw core orders failed: ${e.message}`, 'error'); alert('Failed to generate core orders:\n\n' + (e.message || e)); }
        setGenBusy(false);
    };

    const generateRawOrders = async () => {
        const groups = rawOrderRows();
        const toMake = groups.filter(x => x.qty > 0);
        if (!toMake.length) return alert('Enter an Order quantity on at least one raw core first.');
        const buy = [], shop = [], unlinked = [];
        toMake.forEach(x => {
            if (!x.info.part) { unlinked.push(x); return; }
            const part = x.info.part;
            const specs = part.manufacturingSpecs || {};
            const vendorName = String(specs.vendorName || '').trim();
            // SOURCED BOTH WAYS (Stuart 2026-07-28: H1/H2 assemblies "we produce in house — work
            // order — but we also buy them") → always ask. This is checked FIRST, ahead of the
            // assembly rule, because a Both item is usually an assembly and would otherwise be
            // routed silently to the shop. It opens the vendor modal defaulted to ⚒ make-in-house,
            // so doing nothing produces the safe answer.
            if (sourcingOf(specs) === SOURCING.BOTH) { buy.push({ ...x, vendorOverride: '__MAKE__', bothSourced: true }); return; }
            // AN ASSEMBLY IS BUILT HERE — never a PO candidate, whatever the isInHouse flag says
            // (Stuart 2026-07-28: H2-138LBE, an assembly we make, was asking for a vendor). This is
            // the same exclusion the Min-OH rule already uses at isOutsourced above; 'Master
            // Assembly' is included too, since it is equally something we build.
            const isAssembly = part.partClass === 'Assembly' || part.partClass === 'Master Assembly' || part.netSuiteRecordType === 'assemblyitem';
            if (isAssembly) { shop.push(x); return; }
            // Otherwise: outsourced, or in-house-but-vendored — both are PO candidates, and the
            // vendor modal is where the operator decides (it offers "make in-house instead").
            if (specs.isInHouse === false || vendorName) buy.push({ ...x, vendorOverride: vendorName });
            else shop.push(x);
        });
        if (unlinked.length) alert(`⚠️ ${unlinked.length} core(s) have no Master Library part and were skipped:\n\n${unlinked.slice(0, 10).map(x => `• ${x.r.itemid}`).join('\n')}`);
        if (!buy.length && !shop.length) return;
        if (!buy.length) return executeRawOrders([], shop);
        // Vendor confirmation gate — load the NetSuite-synced vendor list so the picker offers
        // real, resolvable names (a name that doesn't resolve can't become a PO).
        setGenBusy(true);
        let nsVendors = [];
        try { nsVendors = await loadNsVendors(); } catch (e) { /* picker falls back to free text */ }
        setGenBusy(false);
        setVendorModal({ buy, shop, vendors: nsVendors });
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
    let woHiddenNotStocked = 0;
    let woHiddenOutsourced = 0;
    if (activeBuilder === 'PO' && activeVendor) {
        // Vendor catalog = everything BUYABLE from this vendor: OUT *and* BOTH (Eric 2026-08-13 —
        // the raw !isInHouse test hid BOTH-sourced items, which store isInHouse TRUE by design;
        // sourcingOf is the one place the three-way answer is derived).
        displayItems = baseFilteredItems.filter(p => {
            const specs = p.manufacturingSpecs || {};
            return specs.vendorName === activeVendor && sourcingOf(specs) !== SOURCING.IN;
        });
    } else if (activeBuilder === 'WO') {
        // Only in-house items flagged STOCKED get replenishment WOs by default — in-house
        // NOT-stocked items are made-to-order straight from the sales order. But the queue must
        // NEVER hide rows silently (Stuart 2026-07-26: switching to WO 'removes all populated
        // data' with no explanation): the banner above the table names exactly what the queue
        // rule hid, and "show not-stocked too" lets a WO be planned for any in-house item.
        const inHouse = baseFilteredItems.filter(p => p.manufacturingSpecs?.isInHouse !== false);
        const queue = inHouse.filter(p => p.manufacturingSpecs?.isStocked);
        woHiddenOutsourced = baseFilteredItems.length - inHouse.length;
        woHiddenNotStocked = inHouse.length - queue.length;
        displayItems = woShowAll ? inHouse : queue;
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
                // (watchlist resolution moved to component-scope snapWatchOf, inside snapRowOk —
                // the Raw Cores rollup needs the same rule.)
                const rowsFiltered = (salesHist.rows || []).filter(snapRowOk);
                // Sort toggle (Stuart 2026-07-20): FINISH groups /SG · /N25 · … together so
                // same-finish work orders can be issued as one batch; ITEM # = default order.
                const rows = snapSort === 'finish'
                    ? [...rowsFiltered].sort((a, b) =>
                        (finishOf(a.itemid) || '~').localeCompare(finishOf(b.itemid) || '~') ||
                        String(a.itemid).localeCompare(String(b.itemid), undefined, { numeric: true, sensitivity: 'base' }))
                    : rowsFiltered;
                // RAW-CORES view (Stuart 2026-07-17): demand rolled up to the BASE item behind the
                // finish variants (suffix rule — everything before the last "/"; 1 core consumed per
                // finished unit). Rows without a "/" have no separate core and are excluded.
                // Filters applied at the VARIANT row before rollup, so watchlist/category/collection
                // work here exactly as they do on the Finished view (a base surfaces when any of its
                // variants matches — which also makes a search for the base code work, since every
                // variant starts with it).
                const rawRows = snapView !== 'RAW' ? [] : rawCoreGroups(true);
                const rawInfo = rawInfoOf;
                // 3-TIER view (Stuart 2026-07-28): the same filtered variant rows, grouped under their
                // raw base — but only for bases that HAVE a /P, which is what makes an item three-tier.
                const tierRows = snapView !== 'TIER' ? [] : tierGroups(true);
                const shownCount = snapView === 'RAW' ? rawRows.length : snapView === 'TIER' ? tierRows.length : rows.length;
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
                                {/* Say where the numbers came from. A cached month is a fact we
                                    already paid for; the live one is the only one that can move. */}
                                {salesHist.cacheNote && (
                                    <span style={{ display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                        {salesHist.cacheNote}
                                        <button onClick={() => openSalesHistory(true)} title="Throw the cached months away and re-derive all 12 from NetSuite. Slow — only needed if a closed month looks wrong."
                                            style={{ marginLeft: '10px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '2px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.06em', cursor: 'pointer' }}>↻ Rebuild all 12</button>
                                    </span>
                                )}
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
                                {/* Category + collection (Stuart 2026-07-28: "it is getting large") —
                                    same option lists the main grid uses, and they apply to BOTH views. */}
                                <select value={snapCat} onChange={e => setSnapCat(e.target.value)} title="Filter by the item's category (product type)" style={{ padding: '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem', background: snapCat ? 'var(--paper-2)' : '#fff' }}>
                                    <option value="">All Categories</option>
                                    {dynamicProdTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                                </select>
                                <select value={snapColl} onChange={e => setSnapColl(e.target.value)} title="Filter by collection" style={{ padding: '10px 12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.9rem', background: snapColl ? 'var(--paper-2)' : '#fff' }}>
                                    <option value="">All Collections</option>
                                    {dynamicCollections.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                {(snapWatch || snapCat || snapColl || salesHistSearch) && (
                                    <button onClick={() => { setSnapWatch(''); setSnapCat(''); setSnapColl(''); setSalesHistSearch(''); }} title="Clear every snapshot filter" style={{ padding: '9px 12px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>✕ Clear</button>
                                )}
                                <div style={{ display: 'flex', border: '1px solid var(--line)' }}>
                                    <button onClick={() => setSnapView('FIN')} style={{ padding: '9px 14px', background: snapView === 'FIN' ? 'var(--ink)' : '#fff', color: snapView === 'FIN' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Finished Items</button>
                                    <button onClick={() => { setSnapView('RAW'); if (!rawStock) loadRawStock(); }} title="Demand rolled up to the RAW core behind each finish variant (…/BL + /CP + /SG → base item) — set core ROPs so finishing never runs out of parts" style={{ padding: '9px 14px', background: snapView === 'RAW' ? 'var(--ink)' : '#fff', color: snapView === 'RAW' ? '#fff' : 'var(--ink-soft)', border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Raw Cores (BOM)</button>
                                    <button onClick={() => { setSnapView('TIER'); if (!rawStock) loadRawStock(); }} title="Three-tier items (Fabricut H1): the raw mill core, its /P phosphated base and the plated /EP tiers read together, each with its own Order column — raw → shop floor, /P → WMS Convert, plated → WMS Plating" style={{ padding: '9px 14px', background: snapView === 'TIER' ? 'var(--ink)' : '#fff', color: snapView === 'TIER' ? '#fff' : 'var(--ink-soft)', border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>3-Tier (raw · /P · plated)</button>
                                </div>
                                <div style={{ display: 'flex', border: '1px solid var(--line)' }} title="Row order — Finish groups /SG · /N25 · … together so same-finish work orders go out as one batch">
                                    <button onClick={() => setSnapSort('item')} style={{ padding: '9px 14px', background: snapSort === 'item' ? 'var(--ink)' : '#fff', color: snapSort === 'item' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Sort: Item #</button>
                                    <button onClick={() => setSnapSort('finish')} style={{ padding: '9px 14px', background: snapSort === 'finish' ? 'var(--ink)' : '#fff', color: snapSort === 'finish' ? '#fff' : 'var(--ink-soft)', border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Sort: Finish</button>
                                </div>
                                <button onClick={loadOpenWos} title="Every work order not closed — floor phase, NetSuite WO/build state, pack status — with repair actions (↩ reset to Setup after deleting a wrong NetSuite build, ✕ close)" style={{ padding: '9px 14px', background: '#fff', color: 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>📋 Open WOs</button>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)' }}>{salesHist.loading ? 'Loading…' : `${shownCount} ${snapView === 'TIER' ? (shownCount === 1 ? 'family' : 'families') : (shownCount === 1 ? 'item' : 'items')}`}</span>
                                {Object.keys(ropEdits).length > 0 && (
                                    <button onClick={saveRops} disabled={ropSaving} title="Write the edited re-order points to the Master Library (manufacturingSpecs.reorderPoint)" style={{ padding: '9px 16px', background: ropSaving ? 'var(--paper-2)' : 'var(--brass)', color: ropSaving ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: ropSaving ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{ropSaving ? 'Saving…' : `⬆ Save ${Object.keys(ropEdits).length} ROP(s)`}</button>
                                )}
                                <button onClick={lockRetiredByInternalId} disabled={!salesHist.withOld} title="Notate the OLD counterparts by NetSuite internal ID and hide them app-wide" style={{ marginLeft: 'auto', padding: '9px 16px', background: salesHist.withOld ? 'var(--brass)' : 'var(--paper-2)', color: salesHist.withOld ? '#fff' : 'var(--ink-soft)', border: salesHist.withOld ? 'none' : '1px solid var(--line)', cursor: salesHist.withOld ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>🔒 Lock {salesHist.withOld || ''} OLD</button>
                                <button onClick={downloadSalesHistoryCsv} disabled={!rows.length} style={{ padding: '9px 16px', background: rows.length ? 'var(--ink)' : 'var(--paper-2)', color: rows.length ? '#fff' : 'var(--ink-soft)', border: rows.length ? 'none' : '1px solid var(--line)', cursor: rows.length ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>⬇ Download CSV</button>
                                {/* ⚡ Applies to the work orders the NEXT Generate press creates. Run-level, not
                                    per row: you tick it, generate the rush, then untick. */}
                                <label title="Mark the work orders this Generate press creates as URGENT — they arrive pinned to the top of the Finishing Setup Queue until an operator acknowledges them" style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '7px 12px', border: `1px solid ${woUrgent ? '#d9534f' : 'var(--line)'}`, background: woUrgent ? '#fdf3f3' : '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: woUrgent ? '#d9534f' : 'var(--ink-soft)', fontWeight: woUrgent ? 700 : 400 }}>
                                    <input type="checkbox" checked={woUrgent} onChange={e => setWoUrgent(e.target.checked)} style={{ cursor: 'pointer' }} />
                                    ⚡ Urgent
                                </label>
                                <label title="Need-by date for the work orders this press creates. It becomes their required date, so the queue and the planner both sort by it. Leave blank for the standard 14 days." style={{ display: 'flex', alignItems: 'center', gap: '7px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)' }}>
                                    Need by
                                    <input type="date" value={woNeedBy} onChange={e => setWoNeedBy(e.target.value)} style={{ padding: '6px 8px', border: `1px solid ${woNeedBy ? 'var(--brass)' : 'var(--line)'}`, fontFamily: 'var(--mono)', fontSize: '11px', outline: 'none' }} />
                                </label>
                                <button onClick={snapView === 'RAW' ? generateRawOrders : snapView === 'TIER' ? generateTierOrders : generateOrders} disabled={genBusy || !shownCount} title={snapView === 'RAW' ? 'Route every core with an Order qty: bought cores confirm their vendor then group into ONE PO per vendor; in-house cores become shop-floor work orders. Both stage in RTG Dispatch.' : snapView === 'TIER' ? 'Route every tier row with an Order qty by what it IS: raw core → shop-floor WO (or a vendor PO if it\'s bought), /P → WMS Convert to-do, plated → WMS Plating to-do, finished → Finishing WO.' : 'Route every row with an Order qty: bought items → ONE PO per vendor (RTG Dispatch pushes to NetSuite); made items → RTG-parked work orders; in-house items with a vendor ask PO-or-WO per item'} style={{ padding: '9px 16px', background: genBusy ? 'var(--paper-2)' : '#3a7d44', color: genBusy ? 'var(--ink-soft)' : '#fff', border: 'none', cursor: genBusy ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{genBusy ? 'Generating…' : (snapView === 'RAW' ? '⚙ Generate Core Orders (PO + WO)' : snapView === 'TIER' ? '⚙ Generate Tier Orders' : '⚙ Generate Orders (PO + WO)')}</button>
                            </div>

                            {/* ⚠ URGENT CORES — a live backorder is waiting on these being MADE. The reorder
                                math below works off sales history, so it cannot know a customer is standing
                                in front of this one today; the WMS pick app flags them here, where cores get
                                work-ordered. "Not in this view" means the core has no snapshot row at all
                                (usually the plated item isn't flagged Stocked in NetSuite) — exactly the
                                case that would otherwise be missed. */}
                            {urgentForBrand.length > 0 && (() => {
                                const shownIds = new Set(
                                    snapView === 'RAW' ? rawRows.map(g => String(g.base).toUpperCase())
                                        : rows.map(r => String(r.itemid).toUpperCase())
                                );
                                return (
                                    <div style={{ border: '2px solid #d9534f', background: '#fdf3f3', padding: '14px 18px', marginBottom: '12px' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: '#d9534f', fontWeight: 700, marginBottom: '10px' }}>
                                            ⚠ Urgent — {urgentForBrand.length} core{urgentForBrand.length === 1 ? '' : 's'} a picked order is waiting on ({urgentTotalFor(urgentForBrand)} pcs to make)
                                        </div>
                                        {urgentForBrand.map(u => {
                                            const inView = shownIds.has(String(snapView === 'RAW' ? u.coreErpId : u.plateErpId).toUpperCase());
                                            return (
                                                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderTop: '1px solid #e2b8b8', padding: '7px 0' }}>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, color: '#a33' }}>{u.coreErpId}</span>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>
                                                        make {u.shortfall} — {u.ref}{u.customer ? ` · ${u.customer}` : ''} needs {u.need} × {u.plateErpId}, stock had {u.onHand}{Number(u.millAvail) > 0 ? `, mill covered ${Math.max(0, Number(u.short) - Number(u.shortfall))}` : ', no mill stock'}
                                                    </span>
                                                    {!inView && <span title={`No row for ${snapView === 'RAW' ? u.coreErpId : u.plateErpId} in this view — it is probably not flagged Stocked in NetSuite, or a filter is hiding it. Order it from the Raw Cores view.`} style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#fff', background: '#d9534f', padding: '2px 7px', letterSpacing: '.05em' }}>NOT IN THIS VIEW</span>}
                                                    <button onClick={() => clearUrgentCore(u)} title="Clear once the work order is raised — removes the flag only, changes no stock" style={{ marginLeft: 'auto', padding: '5px 10px', background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>✓ Ordered</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            <div style={{ overflow: 'auto', flex: 1, border: '1px solid var(--line)' }}>
                                {salesHist.loading ? (
                                    <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>Querying NetSuite sales history…</div>
                                ) : salesHist.error ? (
                                    <div style={{ padding: '32px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '12px' }}>Failed: {salesHist.error}</div>
                                ) : snapView === 'TIER' ? (
                                    /* 3-TIER: raw core + its /P + its plated tiers, one block per family.
                                       Every tier keeps its OWN Order box because they are genuinely
                                       different work — milling, phosphating, plating — and the whole
                                       point of the view is seeing all three stock levels at once. */
                                    rawStock?.loading ? (
                                        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>Pulling raw-core stock from NetSuite…</div>
                                    ) : tierRows.length === 0 ? (
                                        /* An empty screen here used to leave you re-tagging items with no way to
                                           tell WHICH gate you were failing. Show the counts instead: the snapshot
                                           only ever contains NetSuite items flagged Stocked (custitem27), a family
                                           only forms when a "/P" row is among them, and the filters cut last. */
                                        (() => {
                                            const allRows = salesHist.rows || [];
                                            const withSuffix = allRows.filter(r => String(r.itemid).lastIndexOf('/') > 0).length;
                                            const famsAll = tierGroups(false).length;
                                            const filtersOn = !!(term || snapWatch || snapCat || snapColl);
                                            return snapWhyEmpty(
                                                <>
                                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', marginBottom: '18px', marginTop: '-12px' }}>
                                                        {withSuffix} carry a “/” suffix · <span style={{ color: famsAll ? 'var(--ink)' : '#d9534f' }}>{famsAll} famil{famsAll === 1 ? 'y has' : 'ies have'} a “/P”</span>{filtersOn ? ` · ${tierRows.length} match the filters` : ''}
                                                    </div>
                                                    {famsAll === 0 ? (
                                                        <div>
                                                            Nothing in this snapshot has a <code>/P</code> row, so no family can form. The phosphated item itself (e.g. <code>H1-1BE/P</code>) has to be flagged Stocked in NetSuite, not just the plated ones. The raw core does <em>not</em> need the flag — its stock is read from the Master Library link.
                                                        </div>
                                                    ) : filtersOn ? (
                                                        <div>
                                                            {famsAll} famil{famsAll === 1 ? 'y is' : 'ies are'} loaded but none match — a family surfaces when <em>any</em> of its tiers carries the category / collection / watchlist you picked, so check that at least one of the <code>/P</code> or <code>/EP</code> items has it in the Master Library.
                                                        </div>
                                                    ) : null}
                                                </>
                                            );
                                        })()
                                    ) : (
                                        <>
                                            {rawStock?.error && <div style={{ padding: '10px 16px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px', borderBottom: '1px solid var(--line)' }}>⚠ Raw-core stock pull failed ({rawStock.error}) — the raw row's Avail/On-Ord may be blank.</div>}
                                            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
                                                <thead style={{ position: 'sticky', top: 0, background: 'var(--paper)', zIndex: 5 }}>
                                                    <tr>
                                                        <th style={{ padding: '8px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', borderBottom: '2px solid var(--ink)', position: 'sticky', left: 0, background: 'var(--paper)' }}>Item · tier</th>
                                                        {salesHist.months.map(m => <th key={m.key} style={monthTh}>{m.label}</th>)}
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }}>Total</th>
                                                        <th style={monthTh}>Avg/mo</th>
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '2px solid var(--ink)' }} title="NetSuite quantity available for THIS tier">Avail</th>
                                                        <th style={{ ...monthTh, color: '#3f7fc4' }} title="Open POs / work orders for this tier">On Ord</th>
                                                        <th style={monthTh} title="Raw core: 6 months of the family's combined demand · variant tiers use their own Min-OH rule. A re-order point acts as the FLOOR — a new item with no history yet shows its ROP (brass) until demand grows past it.">Min OH</th>
                                                        <th style={{ ...monthTh, color: '#d9534f' }} title="Deficit vs Min OH (the higher of the demand rule and the ROP) counting stock on order">Short</th>
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }} title="Manual order qty per tier — the destination is on the right of each row">Order</th>
                                                        <th style={{ ...monthTh, textAlign: 'left' }} title="Where an order on this row goes — derived from what the item is, never asked">Routes to</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {tierRows.map(g => {
                                                        const bi = rawInfo(g);
                                                        const monthCount = salesHist.months.length;
                                                        const qtyCell = (erp, enabled, hint) => (
                                                            <td style={{ ...numTd, borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>
                                                                <input type="number" min="0" value={tierOrderQty[erp] ?? ''} placeholder="0" disabled={!enabled} title={enabled ? hint : 'No Master Library part — link it before ordering'}
                                                                    onChange={e => setTierOrderQty(prev => ({ ...prev, [erp]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0) }))}
                                                                    style={{ width: '62px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: (parseInt(tierOrderQty[erp]) > 0) ? '2px solid #3a7d44' : '1px solid var(--line)', outline: 'none', background: enabled ? '#fff' : 'var(--paper-2)' }} />
                                                            </td>
                                                        );
                                                        const routeTd = (label, color, title) => <td style={{ ...numTd, textAlign: 'left', color, fontSize: '10px', whiteSpace: 'nowrap' }} title={title}>{label}</td>;
                                                        // Raw base routing — identical rule to the Raw Cores view.
                                                        const bp = bi.part, bsp = bp?.manufacturingSpecs || {};
                                                        const bBoth = !!bp && sourcingOf(bsp) === SOURCING.BOTH;
                                                        const bAsm = !!bp && !bBoth && (bp.partClass === 'Assembly' || bp.partClass === 'Master Assembly' || bp.netSuiteRecordType === 'assemblyitem');
                                                        const bBuy = !!bp && !bBoth && !bAsm && (bsp.isInHouse === false || bi.vendored);
                                                        return (
                                                            <React.Fragment key={g.base}>
                                                                <tr style={{ borderTop: '2px solid var(--ink)' }}>
                                                                    {/* textAlign is explicit because the app shell sets text-align:center (.App),
                                                                        which every table cell inherits — without it the item # drifts with the
                                                                        length of the row's own text and the tiers never line up. */}
                                                                    <td style={{ padding: '9px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', fontWeight: 700, borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }} title={`Raw mill core · feeds ${g.variants.length} tier(s)`}>
                                                                        {g.base}
                                                                        <span style={{ marginLeft: '8px', fontWeight: 400, fontSize: '9px', color: 'var(--ink-soft)' }}>RAW CORE</span>
                                                                        {!bp && <span title="No matching Master Library part — sync it to get stock + ordering" style={{ color: '#d9534f', fontSize: '9px' }}> · UNLINKED</span>}
                                                                        {/* Description on the family header only — the tiers below are the same
                                                                            part in a different finish, so repeating it per row is just noise. */}
                                                                        {bp?.itemName && <div style={{ fontFamily: 'var(--sans)', fontWeight: 400, fontSize: '11px', color: 'var(--ink-soft)', marginTop: '2px', maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={bp.itemName}>{bp.itemName}</div>}
                                                                    </td>
                                                                    {g.cells.map((v, i) => <td key={salesHist.months[i].key} style={{ ...numTd, color: v ? 'var(--ink)' : 'var(--line)' }} title="Combined demand of every tier below — one core per finished unit">{v || '·'}</td>)}
                                                                    <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{g.total || '·'}</td>
                                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{(g.total / 12).toFixed(1)}</td>
                                                                    <td style={{ ...numTd, fontWeight: 700, color: bi.available <= bi.threshold ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }}>{bi.iid ? bi.available : '—'}</td>
                                                                    <td style={{ ...numTd }}>{bi.onOrd > 0 ? <button onClick={() => setOnOrdModal({ itemid: g.base, onOrd: bi.onOrd, onOrdLines: bi.onOrdLines })} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{bi.onOrd}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                                    <td style={{ ...numTd, color: bi.rop && bi.rop > bi.minCalc ? 'var(--brass)' : 'var(--ink-soft)' }} title={bi.rop && bi.rop > bi.minCalc ? `Re-order point ${bi.rop} — it's above the demand rule (6 months of the family's combined demand = ${bi.minCalc}), so it holds the floor until demand grows past it` : "6 months of the family's combined demand"}>{bi.minOnHand || '·'}</td>
                                                                    <td style={{ ...numTd, fontWeight: 600, color: bi.shortfall > 0 ? '#d9534f' : 'var(--line)' }}>{bi.shortfall || '·'}</td>
                                                                    {qtyCell(g.base, !!bp, bBoth ? 'Sourced both ways — ordering asks vendor-or-shop, defaulted to the work order' : (bAsm || !bBuy ? 'Raw core → shop-floor work order (staged in RTG)' : 'Bought core → vendor confirmation, then one PO per vendor'))}
                                                                    {bBoth ? routeTd('⚖ BOTH → ASK', 'var(--brass)', 'Flagged BOTH in the Master Library — we make it and we buy it. Ordering asks which, defaulted to the work order.')
                                                                        : bAsm ? routeTd('⚒ SHOP WO', '#3a7d44', 'Assembly — we build it here, so an order becomes a shop-floor work order')
                                                                            : bBuy ? routeTd(bi.vendored ? '🏷 VENDOR PO' : '⚠ NO VENDOR', bi.vendored ? '#3f7fc4' : '#d9534f', bi.vendored ? 'Bought — confirms the vendor, then joins that vendor\'s PO' : 'Flagged outsourced but has NO vendor — you\'ll be asked to pick one or switch it to in-house')
                                                                                : routeTd('⚒ SHOP WO', 'var(--ink-soft)', 'Made in-house — an order becomes a shop-floor work order')}
                                                                </tr>
                                                                {g.variants.map(({ r, tier }) => {
                                                                    const vi = reorderFor(r);
                                                                    const erp = String(r.itemid).toUpperCase();
                                                                    const vShort = Math.max(0, (vi.threshold || 0) - (vi.available + vi.onOrd));
                                                                    const tierLabel = tier === TIER_PHOS ? 'PHOSPHATED' : tier === TIER_PLATE ? 'PLATED (outsourced)' : 'FINISHED';
                                                                    return (
                                                                        <tr key={erp}>
                                                                            <td style={{ padding: '7px 12px 7px 30px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: '#fff', whiteSpace: 'nowrap' }}>
                                                                                ↳ {erp}
                                                                                <span style={{ marginLeft: '8px', fontSize: '9px', color: tier === TIER_PHOS ? 'var(--brass)' : tier === TIER_PLATE ? '#3f7fc4' : 'var(--ink-soft)' }}>{tierLabel}</span>
                                                                                {!vi.part && <span title="No matching Master Library part" style={{ color: '#d9534f', fontSize: '9px' }}> · UNLINKED</span>}
                                                                            </td>
                                                                            {r.cells.map((c, i) => <td key={salesHist.months[i].key} style={{ ...numTd, color: c.v ? (c.src === 'old' ? OLD_BLUE : 'var(--ink)') : 'var(--line)' }}>{c.v || '·'}</td>)}
                                                                            <td style={{ ...numTd, fontWeight: 600, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{r.total || '·'}</td>
                                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{(r.total / 12).toFixed(1)}</td>
                                                                            <td style={{ ...numTd, color: vi.available <= vi.threshold ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }}>{vi.available}</td>
                                                                            <td style={{ ...numTd }}>{r.onOrd > 0 ? <button onClick={() => setOnOrdModal(r)} title="Open POs / work orders — click for detail" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{Math.round(r.onOrd)}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                                            <td style={{ ...numTd, color: vi.rop && vi.rop > vi.minCalc ? 'var(--brass)' : 'var(--ink-soft)' }} title={vi.minRule}>{vi.minOnHand || '·'}</td>
                                                                            <td style={{ ...numTd, fontWeight: 600, color: vShort > 0 ? '#d9534f' : 'var(--line)' }}>{vShort || '·'}</td>
                                                                            {qtyCell(erp, !!vi.part, tier === TIER_PHOS ? 'Phosphate this many from the raw core — lands on the WMS Convert tab' : tier === TIER_PLATE ? 'Send this many out to be plated — lands on the WMS Plating tab' : 'Finished goods → Finishing work order (staged in RTG)')}
                                                                            {tier === TIER_PHOS ? routeTd('⇄ WMS CONVERT', 'var(--brass)', 'Pull the raw core to the phosphate cart and build the /P — WMS · Convert tab')
                                                                                : tier === TIER_PLATE ? routeTd('⚡ WMS PLATING', '#3f7fc4', 'Pull the raw core to WIP-Plating and ship it to the plater — WMS · Plating tab')
                                                                                    : routeTd('🎨 FINISHING WO', 'var(--ink-soft)', 'Finished goods — an RTG-parked work order releases to the Finishing Floor')}
                                                                        </tr>
                                                                    );
                                                                })}
                                                                <tr><td colSpan={monthCount + 9} style={{ height: '6px', background: 'var(--paper)', borderBottom: '1px solid var(--line)' }} /></tr>
                                                            </React.Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </>
                                    )
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
                                                        <th style={monthTh} title="Core default: 6 MONTHS of the combined variant demand — never run out of the cores that feed finishing. A re-order point acts as the FLOOR: a new core with no history shows its ROP (brass) until demand grows past it.">Min OH</th>
                                                        <th style={{ ...monthTh, color: 'var(--brass)' }} title="Core re-order point — ⬆ Save pushes to the Master Library; low cores then flag on the main stock grid">ROP</th>
                                                        <th style={{ ...monthTh, color: '#d9534f' }} title="Deficit vs Min OH (the higher of the demand rule and the ROP) counting stock on order">Short</th>
                                                        <th style={{ ...monthTh, color: 'var(--ink)', borderLeft: '1px solid var(--line)' }} title="Manual order qty. Bought cores confirm their vendor, then group into one PO per vendor; in-house cores become shop-floor work orders. Both stage in RTG Dispatch.">Order</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rawRows.map(g => {
                                                        const ri = rawInfo(g);
                                                        return (
                                                        <tr key={g.base} style={urgentByCore[String(g.base).toUpperCase()] ? { background: '#fdf3f3' } : undefined}>
                                                            <td style={{ padding: '7px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: urgentByCore[String(g.base).toUpperCase()] ? '#fdf3f3' : '#fff', whiteSpace: 'nowrap' }} title={`Feeds: ${g.variants.join(', ')}`}>
                                                                {g.base}{!ri.part && <span title="No matching Master Library part — sync it to get stock + ROP" style={{ color: '#d9534f', fontSize: '9px' }}> · UNLINKED</span>}
                                                                {urgentByCore[String(g.base).toUpperCase()] && <span title={urgentByCore[String(g.base).toUpperCase()].map(u => `${u.ref}: make ${u.shortfall} for ${u.plateErpId}`).join(' · ')} style={{ marginLeft: '6px', color: '#fff', background: '#d9534f', fontSize: '9px', padding: '2px 6px', letterSpacing: '.05em' }}>⚠ URGENT {urgentTotalFor(urgentByCore[String(g.base).toUpperCase()])}</span>}
                                                                {/* Where an Order qty on this row will actually go — visible BEFORE generating, so a
                                                                    mis-flagged item is caught here rather than in the vendor modal. */}
                                                                {ri.part && (() => {
                                                                    const p = ri.part, sp = p.manufacturingSpecs || {};
                                                                    const asm = p.partClass === 'Assembly' || p.partClass === 'Master Assembly' || p.netSuiteRecordType === 'assemblyitem';
                                                                    if (sourcingOf(sp) === SOURCING.BOTH) return <span title="Flagged BOTH in the Master Library — we make it and we buy it. Ordering asks which, defaulted to the work order." style={{ color: 'var(--brass)', fontSize: '9px' }}> · ⚖ BOTH → ASK</span>;
                                                                    if (asm) return <span title="Assembly — we build it here, so an order becomes a shop-floor work order" style={{ color: '#3a7d44', fontSize: '9px' }}> · ASM → WO</span>;
                                                                    if (sp.isInHouse === false || ri.vendored) return <span title={ri.vendored ? `Bought — confirms the vendor, then joins that vendor's PO` : 'Flagged outsourced but has NO vendor — you\'ll be asked to pick one or switch it to in-house'} style={{ color: ri.vendored ? '#3f7fc4' : '#d9534f', fontSize: '9px' }}> · {ri.vendored ? 'VENDOR → PO' : 'NO VENDOR'}</span>;
                                                                    return <span title="Made in-house — an order becomes a shop-floor work order" style={{ color: 'var(--ink-soft)', fontSize: '9px' }}> · WO</span>;
                                                                })()}
                                                            </td>
                                                            {g.cells.map((v, i) => <td key={salesHist.months[i].key} style={{ ...numTd, color: v ? 'var(--ink)' : 'var(--line)' }}>{v || '·'}</td>)}
                                                            <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{g.total || '·'}</td>
                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{(g.total / 12).toFixed(1)}</td>
                                                            <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{g.variants.length}</td>
                                                            <td style={{ ...numTd, color: ri.available <= ri.threshold ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }}>{ri.iid ? ri.available : '—'}</td>
                                                            <td style={{ ...numTd }}>{ri.onOrd > 0 ? <button onClick={() => setOnOrdModal({ itemid: g.base, onOrd: ri.onOrd, onOrdLines: ri.onOrdLines })} style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{ri.onOrd}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                            <td style={{ ...numTd, color: ri.rop && ri.rop > ri.minCalc ? 'var(--brass)' : 'var(--ink-soft)' }} title={ri.rop && ri.rop > ri.minCalc ? `Re-order point ${ri.rop} — above the demand rule (${ri.minCalc}), so it holds the floor until demand grows past it` : '6 months of combined variant demand'}>{ri.minOnHand || '·'}</td>
                                                            <td style={{ ...numTd }}><input type="number" min="0" value={ropEdits[g.base] ?? (ri.rop ?? '')} placeholder="—" disabled={!ri.part} title={ri.part ? 'Core re-order point — ⬆ Save pushes to the Master Library' : 'No matching Master Library part'} onChange={e => setRopEdits(prev => ({ ...prev, [g.base]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: ropEdits[g.base] !== undefined ? '2px solid var(--brass)' : '1px solid var(--line)', outline: 'none', background: ri.part ? '#fff' : 'var(--paper-2)' }} /></td>
                                                            <td style={{ ...numTd, fontWeight: 600, color: ri.shortfall > 0 ? '#d9534f' : 'var(--line)' }}>{ri.shortfall || '·'}</td>
                                                            <td style={{ ...numTd, borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>
                                                                <input type="number" min="0" value={rawOrderQty[g.base] ?? ''} placeholder="0" disabled={!ri.part}
                                                                    title={!ri.part ? 'No Master Library part — link it before ordering' : (ri.part.manufacturingSpecs?.isInHouse === false || ri.vendored ? 'Bought core → vendor confirmation, then one PO per vendor' : 'In-house core → shop-floor work order')}
                                                                    onChange={e => setRawOrderQty(prev => ({ ...prev, [g.base]: e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0) }))}
                                                                    style={{ width: '62px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: (parseInt(rawOrderQty[g.base]) > 0) ? '2px solid #3a7d44' : '1px solid var(--line)', outline: 'none', background: ri.part ? '#fff' : 'var(--paper-2)' }} />
                                                            </td>
                                                        </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </>
                                    )
                                ) : rows.length === 0 ? (
                                    (salesHist.rows || []).length === 0 ? (
                                        <div style={{ padding: '48px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)', fontSize: '1.2rem' }}>No stocked items — flag items stocked (custitem27) in NetSuite.</div>
                                    ) : snapWhyEmpty(
                                        <div>The catalog loaded, but nothing passes the filters you have set. ✕ Clear to see all {(salesHist.rows || []).length} stocked items.</div>
                                    )
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
                                                <th style={monthTh} title="Calculated minimum: OUTSOURCED = 6 months of demand · ASSEMBLY = 6 weeks (3wk finishing lead + 3wk safety) · else legacy 4-weeks rule. A re-order point acts as the FLOOR — a new item with no history shows its ROP (brass) until demand grows past it. Hover a value for its rule.">Min OH</th>
                                                <th style={{ ...monthTh, color: 'var(--brass)' }} title="Re-order point — editable; ⬆ Save pushes to the Master Library (manufacturingSpecs.reorderPoint). Acts as the FLOOR under the calculated Min OH: it holds a new item up until real demand exceeds it.">ROP</th>
                                                <th style={{ ...monthTh, color: '#3a7d44' }} title="Shortfall vs Min OH (the higher of the demand rule and the ROP) counting stock on order, rounded up to full finishing batches">Rec</th>
                                                <th style={{ ...monthTh, color: 'var(--ink)' }}>Order</th>
                                                <th style={monthTh} title="Rod cuts — turn 8 ft rods into 6 ft or 4 ft">Cut</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map(r => {
                                                const info = reorderFor(r);
                                                // Order is ALWAYS entered by hand — Rec is guidance, never a prefill.
                                                const ov = orderQty[r.internalId] ?? '';
                                                const sug = convSugMap[r.itemid];
                                                const urg = urgentByPlate[String(r.itemid).toUpperCase()];
                                                return (
                                                <React.Fragment key={r.internalId}>
                                                <tr style={urg ? { background: '#fdf3f3' } : undefined}>
                                                    <td style={{ padding: '7px 12px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)', borderBottom: '1px solid var(--paper-2)', position: 'sticky', left: 0, background: urg ? '#fdf3f3' : '#fff', whiteSpace: 'nowrap' }}>{r.itemid}{urg && <span title={urg.map(u => `${u.ref}: needs ${u.need}, make ${u.shortfall} × ${u.coreErpId}`).join(' · ')} style={{ marginLeft: '6px', color: '#fff', background: '#d9534f', fontSize: '9px', padding: '2px 6px', letterSpacing: '.05em' }}>⚠ URGENT · make {urgentTotalFor(urg)} × {urg[0].coreErpId}</span>}{info.isPole ? <span style={{ color: 'var(--brass)', fontSize: '9px' }}> · POLE</span> : (info.size ? <span style={{ color: 'var(--ink-soft)', fontSize: '9px' }}> · {info.size}</span> : null)}{info.isOutsourced ? <span title="Outsourced (vendor, not an assembly) — 6-month safe-stock rule" style={{ color: '#3f7fc4', fontSize: '9px' }}> · OUT</span> : (info.isAssembly ? <span title="Assembly finished in-house — 6-week rule (3wk lead + 3wk safety)" style={{ color: '#3a7d44', fontSize: '9px' }}> · ASM</span> : null)}{info.isPack ? <span title={info.minRule} style={{ color: 'var(--ink-soft)', fontSize: '9px' }}> · PACK×{info.packSize}</span> : (info.isSingleAgg ? <span title="This EA history IS the full single demand (each-buyers + mirrored pack consumption); pack rows are not added on top — no double count. Avail counts pack shelf stock × size." style={{ color: '#3a7d44', fontSize: '9px' }}> · EA+</span> : null)}
                                                    {finishOf(r.itemid) && !info.isPack ? (
                                                        sug
                                                            ? <button onClick={() => { if (window.confirm(`Clear the convert suggestion (${sug.qty} × ${sug.from})?`)) setConvSugMap(p => { const n = { ...p }; delete n[r.itemid]; return n; }); }} title="Convert suggestion attached — rides onto the WO for the Setup Queue operator. Click to clear." style={{ marginLeft: '6px', background: 'var(--brass)', color: '#fff', border: 'none', padding: '2px 7px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px' }}>⇄ {String(sug.from).split('/').pop()} ×{sug.qty}</button>
                                                            : <button onClick={() => setConvSugFor(convSugFor === r.itemid ? null : r.itemid)} title="Suggest converting a sister finished color to raw for this build — the WO carries the note; the Setup Queue operator runs the actual conversion" style={{ marginLeft: '6px', background: convSugFor === r.itemid ? 'var(--ink)' : 'transparent', color: convSugFor === r.itemid ? '#fff' : 'var(--brass)', border: '1px solid var(--brass)', padding: '1px 6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px' }}>⇄</button>
                                                    ) : null}</td>
                                                    <td style={{ ...numTd, textAlign: 'left', color: r.oldInternalId ? OLD_BLUE : 'var(--line)' }}>{r.oldInternalId || '—'}</td>
                                                    {r.cells.map((c, i) => (
                                                        <td key={salesHist.months[i].key} style={{ ...numTd, color: c.src === 'new' ? 'var(--ink)' : (c.src === 'old' ? OLD_BLUE : 'var(--line)'), fontWeight: c.src === 'new' ? 500 : 400 }}>{c.v || '·'}</td>
                                                    ))}
                                                    <td style={{ ...numTd, fontWeight: 700, color: 'var(--ink)', borderLeft: '1px solid var(--line)', background: 'var(--paper)' }}>{r.total || '·'}</td>
                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{r.avg.toFixed(1)}</td>
                                                    <td style={{ ...numTd, color: 'var(--ink-soft)' }}>{r.orders}</td>
                                                    <td style={{ ...numTd, color: (!info.isPack && info.available <= info.threshold) ? '#d9534f' : 'var(--ink)', borderLeft: '2px solid var(--ink)' }} title={info.isSingleAgg ? 'Includes remaining pack shelf stock × pack size (single-equivalents)' : undefined}>{info.available}</td>
                                                    <td style={{ ...numTd }}>{r.onOrd > 0 ? <button onClick={() => setOnOrdModal(r)} title="Open POs / work orders — click for detail" style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', color: '#3f7fc4', textDecoration: 'underline', fontWeight: 600 }}>{Math.round(r.onOrd)}</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                    <td style={{ ...numTd, color: info.rop && info.rop > info.minCalc ? 'var(--brass)' : 'var(--ink-soft)' }} title={info.minRule}>{info.minOnHand || '·'}</td>
                                                    <td style={{ ...numTd }}><input type="number" min="0" value={ropEdits[String(r.itemid).toUpperCase()] ?? (info.rop ?? '')} placeholder={info.isPack ? '·' : '—'} disabled={!info.part || info.isPack} title={info.isPack ? `Pack assembly — set the ROP on ${info.packSingle}` : (info.part ? 'Re-order point — ⬆ Save pushes to the Master Library; overrides Min OH' : 'No matching Master Library part — sync the item first')} onChange={e => setRopEdits(prev => ({ ...prev, [String(r.itemid).toUpperCase()]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: ropEdits[String(r.itemid).toUpperCase()] !== undefined ? '2px solid var(--brass)' : '1px solid var(--line)', outline: 'none', background: (info.part && !info.isPack) ? '#fff' : 'var(--paper-2)' }} /></td>
                                                    <td style={{ ...numTd, fontWeight: 600, color: info.recommended > 0 ? '#3a7d44' : 'var(--line)' }}>{info.isPack ? <span title={`Packs build from singles at pick — order ${info.packSingle}`} style={{ color: 'var(--ink-soft)', fontFamily: 'var(--mono)', fontSize: '10px', fontWeight: 400 }}>→ EA</span> : (info.recommended || '·')}</td>
                                                    <td style={{ ...numTd }}><input type="number" min="0" value={ov} placeholder={info.isPack ? '·' : '0'} disabled={!!info.isPack} title={info.isPack ? `Packs are built from ${info.packSingle} at pick — order the single row` : undefined} onChange={e => setOrderQty(prev => ({ ...prev, [r.internalId]: e.target.value }))} style={{ width: '58px', padding: '5px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', border: '1px solid var(--line)', outline: 'none', background: info.isPack ? 'var(--paper-2)' : '#fff' }} /></td>
                                                    <td style={{ ...numTd }}>{/* THE CODE SAYS IT IS AN 8 FT ROD — the CLASSIFICATION does not have to (Eric 2026-08-21:
                                                        "rod cut option not available for raw rods in Stock View"). This also required
                                                        productType to say POLE/ROD, which finished rods carry and RAW ones often do not,
                                                        so the ✂ vanished on exactly the rows finishing needs it for. poleLengthOf reads
                                                        the length out of the code itself — the same grammar the cut planner uses. */}
                                                    {isPoleCategory(info.ptype) ? <button title="Cut this rod down — pick the source and the cut lengths on the tool" onClick={() => openCutModal(r.itemid, r.internalId, info.available)} style={{ padding: '3px 10px', background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px' }}>✂</button> : <span style={{ color: 'var(--line)' }}>·</span>}</td>
                                                </tr>
                                                {convSugFor === r.itemid && (() => {
                                                    // Donor picker: sister finished variants of the same base with shelf stock.
                                                    // Attaching does NOT convert anything — the WO carries the suggestion and
                                                    // the Setup Queue operator executes it with the ⇄ converter there.
                                                    const cut = String(r.itemid).lastIndexOf('/');
                                                    const base = cut > 0 ? String(r.itemid).slice(0, cut) : String(r.itemid);
                                                    const sibs = (salesHist.rows || []).filter(s => {
                                                        const sc = String(s.itemid).lastIndexOf('/');
                                                        return sc > 0 && String(s.itemid).slice(0, sc) === base && s.itemid !== r.itemid && !/-\d+$/.test(String(s.itemid)) && (s.available || 0) > 0;
                                                    }).sort((a, b) => (b.available || 0) - (a.available || 0));
                                                    return (
                                                        <tr>
                                                            <td colSpan={99} style={{ padding: '10px 16px', background: '#fdf8ef', borderBottom: '1px solid var(--brass)', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink)' }}>
                                                                ⇄ SUGGEST A DONOR for {r.itemid} (base {base} short?) — tap a sister finish; the WO carries the note, the Setup Queue operator runs the conversion:
                                                                <span style={{ display: 'inline-flex', gap: '8px', flexWrap: 'wrap', marginLeft: '10px' }}>
                                                                    {sibs.length === 0 && <span style={{ color: 'var(--ink-soft)' }}>no sister finishes with stock in this report</span>}
                                                                    {sibs.map(s => (
                                                                        <button key={s.itemid} onClick={() => {
                                                                            const def = info.shortfall || info.recommended || '';
                                                                            const q = parseInt(window.prompt(`Suggest converting how many ${s.itemid} → ${base}?\n\n${s.available} on the shelf.`, String(def)));
                                                                            if (!q || q <= 0) return;
                                                                            if (q > (s.available || 0)) return alert(`Only ${s.available} of ${s.itemid} on the shelf.`);
                                                                            setConvSugMap(p => ({ ...p, [r.itemid]: { from: s.itemid, qty: q } }));
                                                                            setConvSugFor(null);
                                                                        }} style={{ background: '#fff', border: '1px solid var(--brass)', color: 'var(--ink)', padding: '4px 10px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>{String(s.itemid).split('/').pop()} · {s.available}</button>
                                                                    ))}
                                                                    <button onClick={() => setConvSugFor(null)} style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px' }}>✕ close</button>
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })()}
                                                </React.Fragment>
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

            {/* 📋 OPEN WORK ORDERS — cleanup panel with repair actions */}
            {openWos && (
                <div onClick={() => setOpenWos(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 230, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '1200px', maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                        <div style={{ padding: '18px 26px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '4px' }}>Cleanup · repair actions never touch the NetSuite work order itself</span>
                                <span style={{ fontFamily: 'var(--serif)', fontSize: '1.5rem', fontWeight: 500, color: 'var(--ink)' }}>📋 Open Work Orders {openWos.loading ? '…' : `(${openWos.rows.length})`}</span>
                            </div>
                            <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                <button onClick={loadOpenWos} style={{ padding: '8px 14px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>⟳ Refresh</button>
                                <button onClick={() => setOpenWos(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.8rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                            </span>
                        </div>
                        <div style={{ overflow: 'auto', flex: 1 }}>
                            {openWos.loading ? (
                                <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>Loading work orders…</div>
                            ) : openWos.error ? (
                                <div style={{ padding: '30px', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '12px' }}>Failed: {openWos.error}</div>
                            ) : openWos.rows.length === 0 ? (
                                <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'var(--serif)', fontStyle: 'italic', color: 'var(--ink-soft)' }}>No open work orders — everything is closed or packed.</div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                    <thead>
                                        <tr style={{ background: 'var(--paper)', borderBottom: '2px solid var(--ink)' }}>
                                            {['WO', 'Item', 'Where', 'Tasks S·P·B·H', 'NetSuite', 'Pack', ''].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--ink-soft)', position: 'sticky', top: 0, background: 'var(--paper)' }}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {openWos.rows.map((row, i) => {
                                            const fin = row.fin, hq = row.hq;
                                            const t = (fin && fin.tasks) || {};
                                            const mini = ['spinSetup', 'spinSpray', 'spinBake', 'hand'].map(k => t[k]?.status === 'Complete' ? '✓' : (t[k]?.status === 'Running' ? '▶' : '·')).join(' ');
                                            const where = !fin ? `RTG · ${hq.status}${hq.pushedToFinishing ? ' (dispatched?)' : ' (parked)'}` : `${fin.currentPhase || '—'}${fin.currentPhase !== 'Complete' ? ` · coat ${(fin.currentStepIndex || 0) + 1}` : ''}${fin.redlineAlert ? ' · ⚠ redline' : ''}`;
                                            const nsBits = [];
                                            if (fin?.nsWoTran || hq?.nsWoTran) nsBits.push(`WO ${fin?.nsWoTran || hq?.nsWoTran}`);
                                            if (fin?.nsWoCompletionTran) nsBits.push(`BUILD ${fin.nsWoCompletionTran}`);
                                            else if (fin?.nsCompletionQueued) nsBits.push('build queued…');
                                            if (fin?.nsWoClosed) nsBits.push('closed');
                                            return (
                                                <tr key={(fin && fin.id) || (hq && hq.id) || i} style={{ borderBottom: '1px solid var(--paper-2)' }}>
                                                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>
                                                        <div style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--ink)' }}>{woRowRef(row)}</div>
                                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>{(fin && fin.id) || (hq && hq.id)}</div>
                                                    </td>
                                                    <td style={{ padding: '9px 14px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{woItemCodeOf(fin) || woItemCodeOf(hq) || '—'} ×{(fin && fin.totalParts) || (hq && (hq.totalParts || hq.qty)) || '?'}</td>
                                                    <td style={{ padding: '9px 14px', fontSize: '0.8rem', color: 'var(--ink)' }}>{where}</td>
                                                    <td style={{ padding: '9px 14px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{fin ? mini : '—'}</td>
                                                    <td style={{ padding: '9px 14px', fontFamily: 'var(--mono)', fontSize: '10px', color: nsBits.length ? 'var(--ink)' : 'var(--line)' }}>{nsBits.join(' · ') || '—'}</td>
                                                    <td style={{ padding: '9px 14px', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{(fin && fin.packStatus) || '—'}</td>
                                                    <td style={{ padding: '9px 14px', whiteSpace: 'nowrap', textAlign: 'right' }}>
                                                        {fin && <button onClick={() => resetWoToSetup(row)} title="Back to the Setup Queue (picked) — clears completion/pack/NetSuite-build stamps; use after deleting a wrong Assembly Build in NetSuite" style={{ padding: '6px 10px', background: 'transparent', border: '1px solid var(--brass)', color: 'var(--brass)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', marginRight: '8px' }}>↩ Reset → Setup</button>}
                                                        <button onClick={() => closeWoRow(row)} style={{ padding: '6px 10px', background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>✕ Close</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}

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
                const opts = cutOptionsFor(cutModal.sourceFt);
                // Resolve every code the operator typed against the library — category + NetSuite id
                // come from the record, never from the string.
                const look = (code) => {
                    const k = String(code || '').trim().toUpperCase();
                    if (!k) return null;
                    const row = ((salesHist && salesHist.rows) || []).find(x => String(x.itemid).toUpperCase() === k);
                    const part = partByKey['erp:' + k];
                    if (!row && !part) return null;
                    return {
                        code: k,
                        internalId: row ? String(row.internalId) : (part && part.netSuiteInternalId ? String(part.netSuiteInternalId) : ''),
                        productType: (part && (part.manufacturingSpecs?.productType || part.productType)) || (row ? row.ptype : ''),
                        known: true,
                    };
                };
                const srcRec = look(cutModal.itemid) || { code: String(cutModal.itemid).toUpperCase(), internalId: String(cutModal.internalId || ''), productType: 'POLE' };
                const rows = cutModal.rows || [];
                const targets = rows.map(r => { const rec = look(r.code); return { code: r.code, per: r.per, rec, missing: !!String(r.code || '').trim() && !rec }; });
                const plan = planManualCut({
                    source: srcRec,
                    targets: targets.map(t => ({ code: t.code, per: t.per, internalId: t.rec?.internalId, productType: t.rec?.productType })),
                    qtySource: qn, scrapFt: Number(cutModal.scrapFt) || 0,
                });
                const unknown = targets.filter(t => t.missing).map(t => String(t.code).toUpperCase());
                const errs = [...plan.errors, ...unknown.map(c => `${c} is not in the synced library.`)];
                const ready = plan.ok && !unknown.length;
                const setRow = (i, patch) => setCutModal(m => ({ ...m, rows: m.rows.map((r, j) => j === i ? { ...r, ...patch } : r) }));
                const pickOption = (o) => setCutModal(m => ({ ...m, optionKey: o.key, scrapFt: String(o.scrapFt), rows: o.targets.map(t => ({ code: targetCodeFor(m.itemid, t.ft), per: String(t.per) })) }));
                const issue = async () => {
                    if (!ready) return;
                    try {
                        const id = `RC-${Date.now()}`;
                        const first = plan.lines[0];
                        await setDoc(doc(db, 'rod_cut_orders', id), {
                            id, brand: activeBrand, status: 'OPEN',
                            sourceItemId: srcRec.code, sourceInternalId: srcRec.internalId,
                            // MULTI-LENGTH CUTS (Eric: one 12 ft → one 6 ft + one 4 ft). `targets` is
                            // the real shape; the three legacy fields mirror line 1 so every screen
                            // and log written against the old single-target doc keeps working.
                            targets: plan.lines,
                            targetItemId: first.itemId, targetInternalId: first.internalId,
                            qtySource: plan.qtySource, qtyTarget: first.qty,
                            cutTo: cutModal.optionKey, scrapFt: plan.scrapFt,
                            sourceBin: null, destBin: null, nsAdjustmentId: null,
                            createdAt: Date.now(), createdBy: currentUser || '', createdVia: 'SALES_SNAPSHOT',
                            completedAt: null, completedBy: null
                        });
                        const summary = plan.lines.map(l => `${l.qty} × ${l.itemId}`).join(' + ');
                        addLog(`✂ Rod cut order ${id}: ${plan.qtySource} × ${srcRec.code} → ${summary}`, 'success');
                        alert(`✂ Rod cut order issued:\n\n${plan.qtySource} × ${srcRec.code} → ${summary}${plan.scrapFt ? ` + ${plan.scrapFt} ft scrap` : ''}\n\nIt's queued on the WMS → ROD CUTS tab. NetSuite inventory adjusts when the operator scans the bins and confirms the cut.`);
                        setCutModal(null);
                    } catch (e) { alert('Failed to create the rod cut order: ' + (e.message || e)); }
                };
                const tgl = (on) => ({ flex: 1, padding: '10px', background: on ? 'var(--ink)' : '#fff', color: on ? '#fff' : 'var(--ink)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', letterSpacing: '.04em' });
                const inp = { padding: '10px', fontFamily: 'var(--mono)', fontSize: '12px', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box' };
                const lbl = { display: 'block', fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: '8px' };
                return (
                    <div onClick={() => setCutModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.8)', zIndex: 210, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', padding: '32px', width: '600px', maxHeight: '85vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 4px 24px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                                <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>✂ Rod Cut</h2>
                                <button onClick={() => setCutModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>
                                {cutModal.available} available{cutModal.sourceFt ? ` · reads as ${cutModal.sourceFt} ft` : ' · length not in the code — set the cut lengths by hand'}
                            </div>

                            <label style={lbl}>Rod being cut</label>
                            <input value={cutModal.itemid} onChange={e => setCutModal(m => ({ ...m, itemid: e.target.value }))} style={{ ...inp, width: '100%', marginBottom: '6px' }} />
                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginBottom: '18px', color: srcRec.internalId ? '#3a7d44' : '#d9534f' }}>
                                {srcRec.internalId ? `✓ ${srcRec.code} · ${srcRec.productType || '—'} · NetSuite ${srcRec.internalId}` : `✗ ${srcRec.code} — no NetSuite id found`}
                            </div>

                            <label style={lbl}>How many rods to cut</label>
                            <input type="number" min="1" value={cutModal.qty} onChange={e => setCutModal(m => ({ ...m, qty: e.target.value }))} placeholder="0" autoFocus style={{ ...inp, width: '100%', fontSize: '1.2rem', textAlign: 'center', border: '2px solid var(--line)', marginBottom: qn > cutModal.available ? '6px' : '20px' }} />
                            {qn > cutModal.available && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: '#b8860b', marginBottom: '14px' }}>⚠ Only {cutModal.available} available in NetSuite — the operator's source bin must actually hold {qn} or the adjustment will be rejected.</div>}

                            {opts.length > 0 && (
                                <>
                                    <label style={lbl}>Standard cuts for a {cutModal.sourceFt} ft rod</label>
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
                                        {opts.map(o => <button key={o.key} onClick={() => pickOption(o)} style={tgl(cutModal.optionKey === o.key)}>{o.label}{o.scrapFt ? <span style={{ opacity: .6 }}> (+{o.scrapFt} ft scrap)</span> : null}</button>)}
                                    </div>
                                </>
                            )}

                            <label style={lbl}>Cut lengths — item # and how many come off ONE rod</label>
                            {rows.map((r, i) => {
                                const t = targets[i];
                                return (
                                    <div key={i} style={{ marginBottom: '10px' }}>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input value={r.code} onChange={e => setRow(i, { code: e.target.value })} placeholder="e.g. HCUMP410" style={{ ...inp, flex: 1 }} />
                                            <input type="number" min="1" value={r.per} onChange={e => setRow(i, { per: e.target.value })} title="Pieces from one source rod" style={{ ...inp, width: '80px', textAlign: 'center' }} />
                                            {rows.length > 1 && <button onClick={() => setCutModal(m => ({ ...m, rows: m.rows.filter((_, j) => j !== i) }))} style={{ ...inp, cursor: 'pointer', background: '#fff' }}>×</button>}
                                        </div>
                                        {String(r.code || '').trim() && (
                                            <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '4px', color: t.rec?.internalId ? '#3a7d44' : '#d9534f' }}>
                                                {!t.rec ? `✗ ${String(r.code).toUpperCase()} is not in the synced library — create & sync it first.`
                                                    : t.rec.internalId ? `✓ ${t.rec.code} · ${t.rec.productType || '—'} · NetSuite ${t.rec.internalId}`
                                                    : `✗ ${t.rec.code} has no NetSuite id.`}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '18px' }}>
                                <button onClick={() => setCutModal(m => ({ ...m, rows: [...m.rows, { code: '', per: '1' }], optionKey: 'CUSTOM' }))} style={{ ...inp, cursor: 'pointer', background: '#fff', fontSize: '11px' }}>+ another length</button>
                                <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>scrap ft / rod</label>
                                <input type="number" min="0" value={cutModal.scrapFt} onChange={e => setCutModal(m => ({ ...m, scrapFt: e.target.value }))} style={{ ...inp, width: '70px', textAlign: 'center' }} />
                            </div>

                            <div style={{ border: '1px solid var(--line)', background: 'var(--paper)', padding: '16px', marginBottom: '20px' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '12px', color: 'var(--ink)', fontWeight: 600 }}>
                                    {qn || '—'} × {srcRec.code} → {plan.lines.length ? plan.lines.map(l => `${l.qty} × ${l.itemId}`).join(' + ') : '—'}
                                    {plan.scrapFt ? <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}> + {plan.scrapFt} ft scrap</span> : null}
                                </div>
                                {errs.length > 0 && <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', marginTop: '8px', color: '#d9534f', lineHeight: 1.7 }}>{errs.map((e, i) => <div key={i}>✗ {e}</div>)}</div>}
                            </div>

                            <button onClick={issue} disabled={!ready} style={{ width: '100%', padding: '15px', background: ready ? 'var(--brass)' : 'var(--paper-2)', color: ready ? '#fff' : 'var(--ink-soft)', border: ready ? 'none' : '1px solid var(--line)', cursor: ready ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Issue Rod Cut Order → WMS</button>
                        </div>
                    </div>
                );
            })()}

            {/* 🔀 PO-vs-WO CHOOSER — in-house items that ALSO carry a vendor: pick sourcing per item */}
            {/* VENDOR CONFIRMATION (Stuart 2026-07-28) — every bought core passes through here before
                a PO exists. The stored vendor is only a default; the operator confirms it, can switch
                to any NetSuite-synced vendor, or send the core to the shop floor instead. The live
                grouping preview shows exactly how many POs the batch will produce. */}
            {vendorModal && (() => {
                const picks = vendorModal.buy;
                const kept = picks.filter(x => x.vendorOverride !== '__MAKE__');
                const groups = new Map();
                kept.forEach(x => { const v = String(x.vendorOverride || '').trim() || '(no vendor)'; groups.set(v, (groups.get(v) || 0) + 1); });
                const madeHere = picks.filter(x => x.vendorOverride === '__MAKE__');
                const unresolved = kept.filter(x => !String(x.vendorOverride || '').trim());
                const setPick = (idx, val) => setVendorModal(m => ({ ...m, buy: m.buy.map((x, i) => i === idx ? { ...x, vendorOverride: val } : x) }));
                return (
                    <div onClick={() => setVendorModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
                        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', width: '860px', maxWidth: '96vw', maxHeight: '88vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.25)' }}>
                            <div style={{ padding: '18px 26px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)' }}>Confirm vendors</div>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', marginTop: '4px', letterSpacing: '.06em' }}>
                                    {kept.length} core(s) → <span style={{ color: 'var(--ink)' }}>{groups.size} purchase order{groups.size === 1 ? '' : 's'}</span>
                                    {madeHere.length ? ` · ${madeHere.length} switched to shop floor` : ''}
                                    {vendorModal.shop.length ? ` · ${vendorModal.shop.length} already in-house` : ''}
                                    {picks.some(x => x.bothSourced) ? ` · ${picks.filter(x => x.bothSourced).length} sourced BOTH ways (default: make here)` : ''}
                                </div>
                            </div>
                            <div style={{ padding: '18px 26px' }}>
                                {picks.map((x, i) => {
                                    const stored = String(x.info.part?.manufacturingSpecs?.vendorName || '').trim();
                                    const cur = x.vendorOverride === '__MAKE__' ? '__MAKE__' : String(x.vendorOverride || '');
                                    const resolves = cur && cur !== '__MAKE__' && !!resolveVendorRec(vendorModal.vendors, cur);
                                    return (
                                        <div key={x.r.itemid} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 0', borderBottom: '1px solid var(--paper-2)' }}>
                                            <span style={{ width: '190px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink)' }}>{x.r.itemid}
                                                {/* Sourced both ways — it's here to be ASKED, not because it's a buy. */}
                                                {x.bothSourced && <span title="This item is flagged BOTH in the Master Library — we make it and we buy it. Pick a vendor to purchase it, or leave it on ⚒ make in-house." style={{ display: 'block', color: 'var(--brass)', fontSize: '9px' }}>⚖ BOTH — make or buy</span>}
                                            </span>
                                            <span style={{ width: '54px', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', textAlign: 'right' }}>×{x.qty}</span>
                                            <select value={cur} onChange={e => setPick(i, e.target.value)} style={{ flex: 1, padding: '8px', border: `1px solid ${cur === '__MAKE__' ? 'var(--brass)' : (resolves ? 'var(--line)' : '#d9534f')}`, outline: 'none', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                                <option value="">— pick a vendor —</option>
                                                {stored && !vendorModal.vendors.some(v => String(v.name || '').toUpperCase() === stored.toUpperCase()) && <option value={stored}>{stored} (stored — not NetSuite-synced)</option>}
                                                {vendorModal.vendors.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}
                                                <option value="__MAKE__">⚒ Make in-house instead → shop floor</option>
                                            </select>
                                            {cur && cur !== '__MAKE__' && !resolves && <span title="This name doesn't match a NetSuite-synced vendor, so no PO can be created for it. Sync vendors in 11.1 or pick another." style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f' }}>UNRESOLVED</span>}
                                        </div>
                                    );
                                })}
                                {unresolved.length > 0 && <div style={{ marginTop: '14px', fontFamily: 'var(--mono)', fontSize: '10px', color: '#d9534f' }}>⚠ {unresolved.length} core(s) still need a vendor — they'll be skipped.</div>}
                            </div>
                            <div style={{ padding: '16px 26px', borderTop: '1px solid var(--line)', display: 'flex', gap: '12px', justifyContent: 'flex-end', background: 'var(--paper)' }}>
                                <button onClick={() => setVendorModal(null)} style={{ padding: '12px 22px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Cancel</button>
                                <button onClick={() => {
                                    const m = vendorModal; setVendorModal(null);
                                    const buys = m.buy.filter(x => x.vendorOverride && x.vendorOverride !== '__MAKE__');
                                    const shops = [...m.shop, ...m.buy.filter(x => x.vendorOverride === '__MAKE__')];
                                    // Opened from the 3-Tier view, the rest of the batch (convert /
                                    // plating / finishing to-dos) rides on the modal and goes out with it.
                                    if (m.tier) executeTierOrders({ ...m.tier, buy: buys, shop: shops });
                                    else executeRawOrders(buys, shops);
                                }} style={{ padding: '12px 22px', background: '#3a7d44', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Create {groups.size} PO{groups.size === 1 ? '' : 's'}{(vendorModal.shop.length + madeHere.length) ? ` + ${vendorModal.shop.length + madeHere.length} WO` : ''} →</button>
                            </div>
                        </div>
                    </div>
                );
            })()}

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
                            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>Open Purchase &amp; Work Orders</h2>
                            <button onClick={() => setPoModal(null)} style={{ background: 'transparent', border: 'none', fontSize: '1.4rem', cursor: 'pointer', color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', marginBottom: '20px' }}>{poModal.itemName} · {poModal.erpId}</div>
                        {poModal.loading && <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Loading purchase orders from NetSuite…</div>}
                        {poModal.error && <div style={{ padding: '16px', background: '#fdf2f2', color: '#d9534f', fontFamily: 'var(--mono)', fontSize: '11px', whiteSpace: 'pre-wrap' }}>{poModal.error}</div>}
                        {!poModal.loading && !poModal.error && poModal.lines.length === 0 && <div style={{ padding: '30px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No open purchase orders or work orders found for this item.</div>}
                        {!poModal.loading && !poModal.error && poModal.lines.length > 0 && (
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead style={{ borderBottom: '2px solid var(--ink)' }}>
                                    <tr>
                                        {['Type', 'Order #', 'Vendor / Source', 'Ordered', 'Recv / Built', 'Open', 'Rate', 'Date'].map((h, i) => <th key={h} style={{ padding: '10px 8px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', textAlign: i >= 3 && i <= 6 ? 'center' : 'left' }}>{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {poModal.lines.map((l, idx) => {
                                        const ordered = parseFloat(l.qty) || 0;
                                        const received = parseFloat(l.received) || 0;
                                        return (
                                            <tr key={(l.po_id || idx) + '-' + idx} style={{ borderBottom: '1px solid var(--line)' }}>
                                                <td style={{ padding: '12px 8px' }}>
                                                    <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', padding: '3px 7px', border: `1px solid ${l.kind === 'WO' ? 'var(--brass)' : 'var(--line)'}`, color: l.kind === 'WO' ? 'var(--brass)' : 'var(--ink-soft)' }}>{l.kind || 'PO'}</span>
                                                </td>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--brass)' }}>{l.po_number || l.po_id || '—'}</td>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{l.vendor || '—'}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{ordered}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: 'var(--ink-soft)' }}>{received}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: 600 }}>{ordered - received}</td>
                                                <td style={{ padding: '12px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{l.rate != null && l.rate !== '' ? `$${parseFloat(l.rate).toFixed(2)}` : '—'}</td>
                                                <td style={{ padding: '12px 8px', fontFamily: 'var(--mono)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{l.trandate || '—'}{l.kind === 'WO' && l.expected ? ` · exp ${l.expected}` : ''}</td>
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

                    {/* WO-queue transparency: what the Production filter hid, and the escape hatch. */}
                    {activeBuilder === 'WO' && (woHiddenNotStocked > 0 || woHiddenOutsourced > 0 || woShowAll) && (
                        <div style={{ padding: '10px 24px', background: '#fdf6ec', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.82rem' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)', whiteSpace: 'nowrap' }}>Production queue filter</span>
                            <span style={{ flex: 1, color: 'var(--ink-soft)' }}>
                                Plans replenishment for in-house + Stocked items{woHiddenNotStocked > 0 ? ` — ${woHiddenNotStocked} matching in-house item(s) hidden (not flagged Stocked: made-to-order builds from its sales order)` : ''}{woHiddenOutsourced > 0 ? ` · ${woHiddenOutsourced} outsourced item(s) belong on the PO side` : ''}.
                            </span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', cursor: 'pointer', whiteSpace: 'nowrap', color: woShowAll ? 'var(--brass)' : 'var(--ink)' }}>
                                <input type="checkbox" checked={woShowAll} onChange={e => setWoShowAll(e.target.checked)} style={{ accentColor: 'var(--brass)' }} />
                                show not-stocked too
                            </label>
                        </div>
                    )}

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
                                {displayItems.length === 0 && <tr><td colSpan="11" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.95rem' }}>
                                    {activeBuilder === 'WO' && (woHiddenNotStocked > 0 || woHiddenOutsourced > 0)
                                        ? `No items in the Production queue — ${woHiddenNotStocked} matching in-house item(s) are hidden because they aren't flagged Stocked${woHiddenOutsourced > 0 ? ` (${woHiddenOutsourced} outsourced belong on the PO side)` : ''}. Tick "show not-stocked too" above to plan WOs for them anyway — or flag them Stocked (4.5 Mass Update / Master Library) to make them permanent queue members.`
                                        : 'No inventory items matched.'}
                                </td></tr>}
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