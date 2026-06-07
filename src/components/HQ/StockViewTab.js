import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, doc, setDoc } from "firebase/firestore";

const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

const StockViewTab = ({ currentUser, activeBrand }) => {
    const [hqParts, setHqParts] = useState([]);
    const [nsStock, setNsStock] = useState({});
    const [vendors, setVendors] = useState([]);
    
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

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    useEffect(() => {
        useEffect(() => {
        const q = query(collection(db, "Approved_Designs"));
        const unsubParts = onSnapshot(q, (snap) => {
            let parts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // SORT ALPHABETICALLY BY ERP ID (Matches Library Tab)
            parts.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));

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

        return () => { unsubParts(); unsubLists(); unsubCollections(); };
    }, []);

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

                    const response = await fetch(FIREBASE_FUNCTION_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                            method: 'POST',
                            payload: { q }
                        })
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
            } else {
                addLog("No ERP IDs found in HQ catalog to sync quantities.", "warn");
            }

            // STEP 2: SYNC ITEM METADATA (Vendors, Watchlists, Collections)
            addLog("Initiating SuiteQL pull for Item Metadata...", "info");
            
            const typeFilter = "item.itemtype IN ('InvtPart', 'Assembly')";
            let allRawRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching metadata batch ${pageCount} (Items with ID > ${lastId})...`, 'info');
                
                // NO BIN TABLES HERE TO PREVENT 400 ERROR
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
                        ItemVendor.preferredvendor
                    FROM 
                        item
                    LEFT JOIN 
                        ItemVendor ON ItemVendor.item = item.id
                    LEFT JOIN
                        Vendor ON ItemVendor.vendor = Vendor.id
                    WHERE 
                        item.custitem_sync_to_cpq = 'T' 
                        AND item.isinactive = 'F' 
                        AND ${typeFilter}
                        AND item.id > ${lastId}
                    ORDER BY 
                        item.id ASC
                `;
                
                const response = await fetch(FIREBASE_FUNCTION_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        targetUrl: `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`,
                        method: 'POST',
                        payload: { q }
                    })
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
            
            addLog(`Downloaded ${allRawRecords.length} total items. Processing deduplication...`, 'success');

            const uniqueRecordsMap = {};
            for (const row of allRawRecords) {
                const itemId = row.id;
                if (!uniqueRecordsMap[itemId]) {
                    uniqueRecordsMap[itemId] = row;
                } else {
                    const isNewPreferred = row.preferredvendor === 'T';
                    const isOldPreferred = uniqueRecordsMap[itemId].preferredvendor === 'T';
                    const oldHasVendor = !!uniqueRecordsMap[itemId].vendor_name;
                    const newHasVendor = !!row.vendor_name;

                    if (isNewPreferred && !isOldPreferred) {
                        uniqueRecordsMap[itemId] = row;
                    } else if (!oldHasVendor && newHasVendor && !isOldPreferred) {
                        uniqueRecordsMap[itemId] = row;
                    }
                }
            }
            const records = Object.values(uniqueRecordsMap);
            
            let successCount = 0;
            for (const item of records) {
                const existingMatch = hqParts.find(d => d.legacyErpId === item.itemid);
                if (!existingMatch) continue; 

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
                        binLocation: existingMatch.manufacturingSpecs?.binLocation || '', 
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

    // ALGORITHM: OUTSOURCED PURCHASING
    const calculateSuggestedPOQty = (available, rop, moq, leadTime) => {
        if (available > rop) return 0;
        const dynamicRateOfSale = 1.5; 
        const leadTimeBuffer = leadTime ? (leadTime * dynamicRateOfSale) : 10; 
        let suggested = (rop - available) + leadTimeBuffer;
        if (moq && suggested < moq) suggested = moq; 
        return Math.ceil(suggested);
    };

    // ALGORITHM: IN-HOUSE PRODUCTION (Factoring in constraints & committed stock)
    const calculateSuggestedWOQty = (available, rop, moq, leadTime, committed, backorder) => {
        if (available > rop && backorder <= 0 && committed <= available) return 0;
        const productionBuffer = leadTime ? (leadTime * 1.2) : 5; 
        let suggested = (rop - available) + backorder + committed + productionBuffer;
        if (moq && suggested < moq) suggested = moq;
        return Math.max(0, Math.ceil(suggested));
    };

    const handleOrderQtyChange = (partId, qty) => {
        setOrderDrafts(prev => ({ ...prev, [partId]: parseInt(qty) || 0 }));
    };

    const generatePOPayload = () => {
        const lineItems = Object.entries(orderDrafts).map(([partId, qty]) => {
            if (qty <= 0) return null;
            const part = hqParts.find(p => p.id === partId);
            return {
                itemId: part.legacyErpId || part.itemId,
                vendorPart: part.manufacturingSpecs?.vendorId || 'N/A',
                quantity: qty,
                rate: part.manufacturingSpecs?.cost || 0,
                description: part.itemName
            };
        }).filter(Boolean);

        if (lineItems.length === 0) return alert("No items have quantities greater than 0.");

        const poPayload = { vendor: activeVendor, subsidiary: "2", memo: "Auto-Generated via Fab-OS Stock View", items: lineItems };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(poPayload, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `PO_Export_${activeVendor}_${Date.now()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        addLog(`✅ Exported PO Payload for ${activeVendor} (${lineItems.length} lines)`, "success");
        alert("✅ Purchase Order payload generated! Ready to push to NetSuite.");
        setOrderDrafts({}); 
    };

    const generateWOPayload = () => {
        const lineItems = Object.entries(orderDrafts).map(([partId, qty]) => {
            if (qty <= 0) return null;
            const part = hqParts.find(p => p.id === partId);
            return {
                itemId: part.legacyErpId || part.itemId,
                quantityToBuild: qty,
                description: part.itemName,
                routingType: part.routingType || 'Standard'
            };
        }).filter(Boolean);

        if (lineItems.length === 0) return alert("No items have quantities greater than 0.");

        const woPayload = { subsidiary: "2", memo: "Auto-Generated via Fab-OS Stock View", department: "Production", items: lineItems };

        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(woPayload, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `WO_Export_${Date.now()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        addLog(`✅ Exported WO Payload (${lineItems.length} jobs)`, "success");
        alert("✅ Work Order payload generated! Ready to push to NetSuite.");
        setOrderDrafts({}); 
    };

    const dynamicWatchlists = Array.from(new Set([
        ...(globalLists.watchLists || []).map(w => w.toUpperCase()),
        ...hqParts.map(p => {
            const specs = p.manufacturingSpecs || {};
            const nsWatchlist = specs.customData?.watchlist && specs.customData.watchlist !== 'N/A' ? specs.customData.watchlist.toUpperCase() : "NONE";
            return specs.watchList ? specs.watchList.toUpperCase() : nsWatchlist;
        }).filter(w => w !== "NONE")
    ])).sort();

    const enrichedInventory = hqParts.map(part => {
        const erpId = (part.legacyErpId || part.itemId).toUpperCase();
        const stock = nsStock[erpId] || { onHand: 0, available: 0, onOrder: 0, committed: 0, backorder: 0 };
        const specs = part.manufacturingSpecs || {};
        
        const rop = parseInt(specs.reorderPoint) || 0;
        const moq = parseInt(specs.moq) || 0;
        const leadTime = parseInt(specs.leadTime) || 0;

        return { ...part, stock, rop, moq, leadTime, isLowStock: stock.available <= rop && rop > 0 };
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
        
        return matchesSearch && matchesType && matchesCollection && matchesClass && matchesWatchlist;
    });

    let displayItems = baseFilteredItems;
    if (activeBuilder === 'PO' && activeVendor) {
        displayItems = baseFilteredItems.filter(p => p.manufacturingSpecs?.vendorName === activeVendor && !p.manufacturingSpecs?.isInHouse);
    } else if (activeBuilder === 'WO') {
        displayItems = baseFilteredItems.filter(p => p.manufacturingSpecs?.isInHouse !== false); 
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            
            {/* HEADER */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Live NetSuite Inventory Integration</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>ERP Stock & Sourcing View</h2>
                </div>
                
                {/* ADVANCED FILTER BAR */}
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    
                    <select value={partClassFilter} onChange={(e) => setPartClassFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: 'var(--paper-2)', color: 'var(--ink)' }}>
                        <option value="ALL">All Classes</option>
                        <option value="INVENTORY">Raw Mat / Components</option>
                        <option value="OUTSOURCED">Outsourced Components</option>
                        <optgroup label="Assemblies & Kits">
                            <option value="UNASSIGNED">Unassigned / Pending</option>
                            {(globalLists.assemblyTypes || []).map(type => <option key={type} value={type}>{type}</option>)}
                        </optgroup>
                    </select>
                    
                    <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Categories</option>
                        {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt}>{pt}</option>)}
                    </select>

                    <select value={collectionFilter} onChange={(e) => setCollectionFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Collections</option>
                        {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                    </select>

                    <select value={watchlistFilter} onChange={(e) => setWatchlistFilter(e.target.value)} disabled={activeBuilder === 'PO' && !!activeVendor} style={{ padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                        <option value="">All Watchlists</option>
                        <option value="NONE">None / Unassigned</option>
                        {dynamicWatchlists.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>

                    <input 
                        placeholder="Search Global Inventory..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        disabled={activeBuilder === 'PO' && !!activeVendor}
                        style={{ width: '200px', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} 
                    />
                    
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
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Committed</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>On Order</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>Backorder</th>
                                    <th style={{ padding: '16px 20px', borderBottom: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>ROP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayItems.length === 0 && <tr><td colSpan="9" style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.95rem' }}>No inventory items matched.</td></tr>}
                                {activeBuilder === 'PO' && activeVendor && <tr><td colSpan="9" style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic' }}>Viewing {activeVendor} Catalog. Refer to the right-side PO Builder.</td></tr>}
                                {!(activeBuilder === 'PO' && activeVendor) && displayItems.map(item => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid var(--line)', background: item.isLowStock ? '#fdf2f2' : '#fff' }}>
                                        <td style={{ padding: '16px 20px', fontFamily: 'var(--mono)', fontSize: '11px', color: item.isLowStock ? '#d9534f' : 'var(--ink)' }}>
                                            {item.legacyErpId || item.itemId}
                                            {item.manufacturingSpecs?.isInHouse === false && <span style={{display: 'block', fontSize: '9px', color: 'var(--ink-soft)', marginTop: '4px', textTransform: 'uppercase'}}>Outsourced</span>}
                                        </td>
                                        <td style={{ padding: '16px 20px', fontWeight: 500, color: 'var(--ink)', fontSize: '0.95rem' }}>{item.itemName}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>{item.manufacturingSpecs?.binLocation || '-'}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: 'var(--ink)' }}>{item.stock.onHand}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', fontWeight: 500, color: item.isLowStock ? '#d9534f' : 'var(--ink)' }}>{item.stock.available}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: 'var(--ink-soft)' }}>{item.stock.committed}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: 'var(--ink-soft)' }}>{item.stock.onOrder}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', fontSize: '1rem', color: item.stock.backorder > 0 ? '#d9534f' : 'var(--ink-soft)' }}>{item.stock.backorder}</td>
                                        <td style={{ padding: '16px 20px', textAlign: 'center', color: 'var(--ink-soft)' }}>{item.rop || '-'}</td>
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
                                    // Switch Algorithm based on Mode
                                    const suggested = activeBuilder === 'PO' 
                                        ? calculateSuggestedPOQty(item.stock.available, item.rop, item.moq, item.leadTime)
                                        : calculateSuggestedWOQty(item.stock.available, item.rop, item.moq, item.leadTime, item.stock.committed, item.stock.backorder);
                                    
                                    const currentDraft = orderDrafts[item.id] !== undefined ? orderDrafts[item.id] : (suggested > 0 ? suggested : 0);
                                    
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
                                                <div><div style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '4px' }}>Commit</div><div style={{ fontSize: '1.1rem', color: 'var(--ink)' }}>{item.stock.committed || 0}</div></div>
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
                                                    <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', display: 'block', marginBottom: '6px' }}>Final {activeBuilder === 'PO' ? 'Order' : 'Build'} Qty</label>
                                                    <input 
                                                        type="number" 
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

                    {/* DYNAMIC EXPORT BUTTON */}
                    {(activeBuilder === 'WO' || activeVendor) && (
                        <div style={{ padding: '24px', borderTop: '1px solid var(--line)', background: 'var(--paper)' }}>
                            <button 
                                onClick={activeBuilder === 'PO' ? generatePOPayload : generateWOPayload}
                                style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}
                            >
                                {activeBuilder === 'PO' ? 'Export PO Payload to ERP' : 'Export Work Order Payload to ERP'}
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