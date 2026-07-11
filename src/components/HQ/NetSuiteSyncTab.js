import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, getDocs, collection, writeBatch } from "firebase/firestore";
import { parseFabricutWorkbook, buildFabricutPlan } from '../Shared/fabricutImport';

const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

const NetSuiteSyncTab = ({ currentUser, activeBrand }) => {
    const [nsSubsidiaryId, setNsSubsidiaryId] = useState("3");
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncLog, setSyncLog] = useState([]);

    const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

    useEffect(() => {
        if (BRAND_NETSUITE_MAP[activeBrand]) {
            setNsSubsidiaryId(BRAND_NETSUITE_MAP[activeBrand].subsidiary);
        }
    }, [activeBrand]);

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    const executeSuiteQL = async (queryStr) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
        const response = await fetch(FIREBASE_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                targetUrl: targetUrl,
                method: 'POST',
                payload: { q: queryStr }
            })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`NetSuite Error: ${JSON.stringify(data)}`);
        return data;
    };

    const handleSyncCustomers = async () => {
        if (!nsSubsidiaryId) return alert("Please enter a Target Subsidiary ID.");
        setIsSyncing(true);
        addLog(`Initiating Customer Sync for Subsidiary [${nsSubsidiaryId}]...`, 'info');

        try {
            const targetBrand = Object.keys(BRAND_NETSUITE_MAP).find(key => BRAND_NETSUITE_MAP[key].subsidiary === nsSubsidiaryId?.toString()) || activeBrand;

            // Expected count FIRST — the sync verifies against it at the end, so a truncated run
            // (network drop, closed tab) can never pass silently again. Real CUSTOMERs only: the
            // customer table also holds LEADs and PROSPECTs (M2C: 770 vs 1,037 vs 231), which were
            // being imported as customers.
            const cnt = await executeSuiteQL(`SELECT COUNT(*) AS n FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND stage = 'CUSTOMER'`);
            const expected = parseInt(cnt.items?.[0]?.n) || 0;
            addLog(`NetSuite reports ${expected} active CUSTOMER-stage records for subsidiary ${nsSubsidiaryId} (leads/prospects excluded).`, 'info');

            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching customer batch ${pageCount}...`, 'info');
                const q = `SELECT id, companyname, email, phone, creditlimit, terms, stage FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND stage = 'CUSTOMER' AND id > ${lastId} ORDER BY id ASC`;
                const result = await executeSuiteQL(q);
                const batch = result.items || [];
                allRecords = allRecords.concat(batch);

                if (batch.length > 0) {
                    lastId = batch[batch.length - 1].id;
                    if (batch.length < 1000) hasMore = false;
                    else pageCount++;
                } else {
                    hasMore = false;
                }
            }

            addLog(`Downloaded ${allRecords.length} customers (expected ${expected}). Writing to CRM Database...`, allRecords.length === expected ? 'success' : 'warn');

            // Batched writes (450/commit): the old one-await-per-doc loop took minutes for 2,000+
            // rows and wrote LOW ids first — any interruption silently dropped the HIGH id range
            // (exactly the "no customers from the upper range" symptom). Batches land in seconds.
            let successCount = 0;
            for (let i = 0; i < allRecords.length; i += 450) {
                const chunk = allRecords.slice(i, i + 450);
                const wb = writeBatch(db);
                chunk.forEach(c => {
                    const safeId = `CUST-${c.id}`;
                    // NS-owned fields only — app-owned fields (discountCode, salesRep, contact,
                    // notes, billingAddress, ytd/mtd/openOrders) are omitted so merge preserves
                    // whatever the app has set on re-sync.
                    wb.set(doc(db, "crm_records", safeId), {
                        id: safeId,
                        type: 'CUSTOMER',
                        stage: c.stage || 'CUSTOMER',
                        name: c.companyname || `Customer ${c.id}`,
                        email: c.email || '',
                        phone: c.phone || '',
                        creditLimit: parseFloat(c.creditlimit) || 0,
                        terms: c.terms || '',
                        brandId: targetBrand,
                        sharedBrands: [targetBrand]
                    }, { merge: true });
                });
                await wb.commit();
                successCount += chunk.length;
                addLog(`  … ${successCount}/${allRecords.length} written`, 'info');
            }
            if (successCount !== expected) addLog(`⚠️ Wrote ${successCount} but NetSuite reported ${expected} — re-run the sync; if it persists, tell Claude.`, 'warn');
            addLog(`✅ Successfully synced ${successCount} CRM records (CUSTOMER stage only) mapped to brand: ${targetBrand}`, 'success');

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    const handleSyncAddresses = async () => {
        if (!nsSubsidiaryId) return alert("Please enter a Target Subsidiary ID.");
        setIsSyncing(true);
        addLog(`Initiating Address Book Sync for Subsidiary [${nsSubsidiaryId}]...`, 'info');

        try {
            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching address batch ${pageCount}...`, 'info');
                const q = `
                    SELECT 
                        Customer.id AS customer_id,
                        CustomerAddressbook.internalid AS addressbook_id,
                        CustomerAddressbook.label,
                        CustomerAddressbook.defaultshipping,
                        CustomerAddressbookEntityAddress.addressee,
                        CustomerAddressbookEntityAddress.attention,
                        CustomerAddressbookEntityAddress.addr1,
                        CustomerAddressbookEntityAddress.addr2,
                        CustomerAddressbookEntityAddress.city,
                        CustomerAddressbookEntityAddress.state,
                        CustomerAddressbookEntityAddress.zip,
                        CustomerAddressbookEntityAddress.country
                    FROM Customer
                    LEFT JOIN CustomerAddressbook ON CustomerAddressbook.entity = Customer.id
                    LEFT JOIN CustomerAddressbookEntityAddress ON CustomerAddressbookEntityAddress.nkey = CustomerAddressbook.addressbookaddress
                    WHERE Customer.subsidiary = ${nsSubsidiaryId} 
                    AND Customer.isinactive = 'F'
                    AND Customer.id > ${lastId}
                    ORDER BY Customer.id ASC
                `;

                const result = await executeSuiteQL(q);
                const batch = result.items || [];
                allRecords = allRecords.concat(batch);

                if (batch.length > 0) {
                    lastId = batch[batch.length - 1].customer_id;
                    if (batch.length < 1000) hasMore = false;
                    else pageCount++;
                } else {
                    hasMore = false;
                }
            }

            addLog(`Downloaded ${allRecords.length} total customer/address rows. Filtering empty records...`, 'success');

            const addressMap = {};
            let validAddressCount = 0;

            for (const row of allRecords) {
                if (!row.addressbook_id) continue;
                validAddressCount++;
                const custId = `CUST-${row.customer_id}`;
                if (!addressMap[custId]) addressMap[custId] = [];
                
                addressMap[custId].push({
                    addressBookId: row.addressbook_id,
                    label: row.label || 'Default Address',
                    isDefault: row.defaultshipping === 'T',
                    addressee: row.addressee || row.attention || '',
                    addr1: row.addr1 || '',
                    addr2: row.addr2 || '',
                    city: row.city || '',
                    state: row.state || '',
                    zip: row.zip || '',
                    country: row.country || 'US'
                });
            }

            if (validAddressCount === 0) {
                addLog(`⚠️ NetSuite returned customers, but hid all Address Books. Your Integration Role is likely missing 'Customer Address' permission.`, 'warn');
            } else {
                let successCount = 0;
                for (const [custId, addresses] of Object.entries(addressMap)) {
                    addresses.sort((a, b) => (b.isDefault === true) - (a.isDefault === true));
                    const docRef = doc(db, "crm_records", custId);
                    await setDoc(docRef, { shippingAddresses: addresses }, { merge: true });
                    successCount++;
                }
                addLog(`✅ Successfully merged ${validAddressCount} address books into ${successCount} CRM profiles.`, 'success');
            }

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    const handleSyncVendors = async () => {
        setIsSyncing(true);
        addLog(`Initiating Vendor Sync for External Co-Op CRM...`, 'info');

        try {
            const targetBrand = Object.keys(BRAND_NETSUITE_MAP).find(key => BRAND_NETSUITE_MAP[key].subsidiary === nsSubsidiaryId?.toString()) || activeBrand;

            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching vendor batch ${pageCount}...`, 'info');
                const q = `SELECT id, companyname, email, phone, terms FROM vendor WHERE isinactive = 'F' AND id > ${lastId} ORDER BY id ASC`;
                const result = await executeSuiteQL(q);
                const batch = result.items || [];
                allRecords = allRecords.concat(batch);

                if (batch.length > 0) {
                    lastId = batch[batch.length - 1].id;
                    if (batch.length < 1000) hasMore = false;
                    else pageCount++;
                } else {
                    hasMore = false;
                }
            }
            
            addLog(`Downloaded ${allRecords.length} active vendors. Writing to CRM Database...`, 'success');

            let successCount = 0;
            for (const v of allRecords) {
                const safeId = `VEND-${v.id}`;
                const docRef = doc(db, "crm_records", safeId);
                
                await setDoc(docRef, {
                    id: safeId,
                    type: 'VENDOR',
                    name: v.companyname || `Vendor ${v.id}`,
                    email: v.email || '',
                    phone: v.phone || '',
                    terms: v.terms || '',
                    notes: 'Imported from NetSuite',
                    status: 'ACTIVE',
                    brandId: targetBrand,
                    sharedBrands: [targetBrand]
                }, { merge: true });
                successCount++;
            }
            addLog(`✅ Successfully synced ${successCount} Vendor records.`, 'success');

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    const handleSyncItems = async () => {
        setIsSyncing(true);
        addLog(`Initiating Advanced Master Library Sync...`, 'info');

        try {
            // 1. Fetch Existing App Dictionary & Internal IDs
            addLog("Mapping current App Database to prevent overwrites...", 'info');
            const appDbSnap = await getDocs(collection(db, "Approved_Designs"));
            const existingPartsMap = {};
            const existingInternalIdMap = {};
            
            appDbSnap.docs.forEach(d => {
                const data = d.data();
                if (data.legacyErpId) {
                    existingPartsMap[data.legacyErpId.toUpperCase()] = { id: d.id, ...data };
                }
                if (data.netSuiteInternalId) {
                    existingInternalIdMap[data.netSuiteInternalId.toString()] = data.legacyErpId.toUpperCase();
                }
            });

            // 2. Fetch NetSuite Data
            const targetSubsidiary = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || "3"; 

            let allRawRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching batch ${pageCount} (Items with ID > ${lastId})...`, 'info');
                
                // 🚀 NEW: Added comp.itemtype and comp.cost joins to explicitly identify and cost Service items
                const q = `
                    SELECT 
                        item.id, 
                        item.itemid, 
                        item.displayname, 
                        item.weight,
                        BUILTIN.DF(item.custitem_bit_product_type) AS product_type,
                        BUILTIN.DF(item.custitem_bit_itemcollection) AS collection,
                        BUILTIN.DF(item.custitem_bit_watchlist) AS watchlist,
                        BUILTIN.DF(item.custitem_bracket_projection) AS projection,
                        item.custitem27 AS is_stocked,
                        item.custitem26 AS is_inhouse,
                        item.custitem28 AS is_old,
                        BUILTIN.DF(item.stockunit) AS uom,
                        item.averagecost AS base_cost,
                        pl1.unitprice AS base_price,
                        Vendor.companyname AS vendor_name,
                        ItemVendor.vendorcode AS vendor_part_number,
                        ItemVendor.preferredvendor,
                        Bin.binnumber,
                        bom.id AS bom_id,
                        bomrevision.name AS bom_revision,
                        bomrevisioncomponentmember.item AS component_internal_id,
                        bomrevisioncomponentmember.bomquantity AS component_qty,
                        comp.itemtype AS comp_itemtype,
                        comp.cost AS comp_cost,
                        comp.averagecost AS comp_averagecost
                    FROM item
                    LEFT JOIN ItemSubsidiaryMap ON ItemSubsidiaryMap.item = item.id
                    LEFT JOIN ItemVendor ON ItemVendor.item = item.id
                    LEFT JOIN Vendor ON ItemVendor.vendor = Vendor.id
                    LEFT JOIN InventoryBalance ON InventoryBalance.item = item.id
                    LEFT JOIN Bin ON InventoryBalance.binnumber = Bin.id
                    /* Base Price = the standard "Base Price" price level (internal id 1) → the sales price */
                    LEFT JOIN pricing pl1 ON pl1.item = item.id AND pl1.pricelevel = 1

                    /* ADVANCED BOM RELATIONAL JOINS - CLEANED */
                    LEFT JOIN assemblyitembom ON assemblyitembom.assembly = item.id
                    LEFT JOIN bom ON bom.id = assemblyitembom.billofmaterials
                    LEFT JOIN bomrevision ON bomrevision.billofmaterials = bom.id
                    LEFT JOIN bomrevisioncomponentmember ON bomrevisioncomponentmember.bomrevision = bomrevision.id
                    LEFT JOIN item AS comp ON comp.id = bomrevisioncomponentmember.item
                    
                    WHERE item.custitem_sync_to_cpq = 'T' 
                    AND item.isinactive = 'F' 
                    AND ItemSubsidiaryMap.subsidiary = ${targetSubsidiary}
                    AND (item.itemtype = 'InvtPart' OR item.itemtype = 'Assembly')
                    AND item.id > ${lastId}
                    ORDER BY item.id ASC
                `;

                const result = await executeSuiteQL(q);
                const batch = result.items || [];
                allRawRecords = allRawRecords.concat(batch);
                
                if (batch.length > 0) {
                    lastId = batch[batch.length - 1].id;
                    if (batch.length < 1000) hasMore = false; 
                    else pageCount++;
                } else {
                    hasMore = false;
                }
            }
            
            addLog(`Downloaded ${allRawRecords.length} total rows. Processing deduplication, BOMs, and Bins...`, 'success');

            const uniqueRecordsMap = {};
            const nsInternalToLegacyMap = {}; // Lookup Dictionary for Live Batch

            // 1. Group Duplicates, Aggregate BOM Components, and Build Lookup
            for (const row of allRawRecords) {
                const itemId = row.id;
                const legacySku = (row.itemid || row.id).toString().toUpperCase();

                nsInternalToLegacyMap[itemId] = legacySku;

                if (!uniqueRecordsMap[itemId]) {
                    uniqueRecordsMap[itemId] = { 
                        ...row, 
                        all_bins: new Set(),
                        bom_components: [],
                        bom_revision: row.bom_revision || ''
                    };
                }
                
                if (row.binnumber) uniqueRecordsMap[itemId].all_bins.add(row.binnumber);
                
                if (row.bom_revision && !uniqueRecordsMap[itemId].bom_revision) {
                    uniqueRecordsMap[itemId].bom_revision = row.bom_revision;
                }

                if (row.component_internal_id) {
                    const exists = uniqueRecordsMap[itemId].bom_components.find(c => c.internalId === row.component_internal_id);
                    if (!exists) {
                        // 🚀 NEW: Detect Service / Non-Inventory parts and capture their cost
                        const compType = row.comp_itemtype || '';
                        const isService = compType === 'NonInvtPart' || compType === 'Service' || compType === 'OthCharge';
                        const cCost = parseFloat(row.comp_cost) || parseFloat(row.comp_averagecost) || 0;

                        uniqueRecordsMap[itemId].bom_components.push({
                            internalId: row.component_internal_id,
                            qty: row.component_qty || 1,
                            isService: isService,
                            cost: cCost
                        });
                    }
                }
            }

            const records = Object.values(uniqueRecordsMap);
            let successCount = 0;
            let stockedCount = 0, inHouseCount = 0, oldCount = 0;

            // NetSuite checkbox custom fields come back as 'T'/'F'. custitem27 = "Stocked" (held on the
            // shelf, sold via Quick Ship); custitem26 = finished IN-HOUSE (needs a WO, not outsourced).
            const nsBool = (v) => v === true || v === 'T' || v === 't' || v === 'true' || v === 1 || v === '1';
            const nsHasVal = (v) => v !== undefined && v !== null && v !== '';

            // 2. Process and Push to Firebase
            for (const item of records) {
                const sku = (item.itemid || item.id).toString().toUpperCase();
                const existingAppRecord = existingPartsMap[sku];
                
                // --- DYNAMIC CLASSIFICATION ENGINE ---
                let partClass = "Inventory";
                let routingType = "UNASSIGNED";
                let isInHouse = true;
                let outsourceAction = "";

                // 1. Classify Assembly vs Inventory
                if (sku.includes('/P') || sku.includes('/EP')) {
                    partClass = "Assembly";
                    routingType = "STANDARD";
                    
                    if (sku.includes('/EP')) {
                        isInHouse = false;
                    }
                }

                // 2. Outsource Action Logic (/EP1-6 and /P25)
                if (sku.match(/\/EP[1-6]\b/) || sku.includes('/P25')) {
                    outsourceAction = "Plated";
                    if (sku.includes('/P25')) {
                        isInHouse = false; 
                    }
                } else if (sku.includes('/EP')) {
                    outsourceAction = "PLATING"; // Fallback for any other /EP items
                }

                // 🚀 Curated NetSuite flags win over the SKU heuristic. custitem26 is the authoritative
                // in-house-finish flag (overrides the suffix guess when set); custitem27 marks stocked stock.
                const isStocked = nsBool(item.is_stocked);
                const isRetired = nsBool(item.is_old); // custitem28 = OLD/retiring → hidden from browse screens
                if (nsHasVal(item.is_inhouse)) isInHouse = nsBool(item.is_inhouse);
                if (isStocked) stockedCount++;
                if (isRetired) oldCount++;
                if (isInHouse) inHouseCount++;

                // 3. Part Handling Logic (Poles vs Small Parts)
                const pTypeClean = (item.product_type || '').toLowerCase().trim();
                const uomClean = (item.uom || '').toLowerCase().trim();
                
                const isPole = pTypeClean.includes('pole') || pTypeClean.includes('track') || 
                               uomClean === 'ft' || uomClean === 'foot' || uomClean === 'feet';
                
                const partHandling = isPole ? "Custom" : "Small Parts";

                const docId = existingAppRecord ? existingAppRecord.id : `${activeBrand.toUpperCase()}-${partClass === 'Inventory' ? 'INV' : 'ASM'}-${item.id}`;
                const mergedBins = Array.from(item.all_bins || []).join(', ');
                
                // 🚀 NEW: Overwrite outsource assembly cost with service component cost
                let determinedCost = parseFloat(item.base_cost) || 0;
                const serviceComponents = item.bom_components.filter(c => c.isService);
                
                if (!isInHouse && serviceComponents.length > 0) {
                    determinedCost = serviceComponents.reduce((sum, c) => sum + (c.cost * c.qty), 0);
                }

                const payload = {
                    legacyErpId: item.itemid || item.id,
                    netSuiteInternalId: item.id, 
                    itemName: item.displayname || item.itemid,
                    partClass: partClass,
                    routingType: routingType,
                    updatedAt: new Date().toISOString()
                };

                const newSpecs = {
                    cost: determinedCost,
                    weight: parseFloat(item.weight) || 0,
                    isInHouse: isInHouse,
                    isStocked: isStocked,
                    isRetired: isRetired,
                    outsourceAction: outsourceAction,
                    partHandling: partHandling,
                    productType: item.product_type || 'Uncategorized',
                    uom: item.uom || 'EA',
                    bomRevision: item.bom_revision || '',
                    binLocation: mergedBins,
                    vendorName: item.vendor_name || '', 
                    vendorId: item.vendor_part_number || '', 
                    customData: {
                        collection: item.collection || '',
                        watchlist: item.watchlist || '',
                        projection: item.projection || ''
                    }
                };

                // Sales price = NetSuite's standard "Base Price" price level (pricelevel 1). Only set it
                // when NetSuite actually has a price, so a re-import never wipes a curated price back to 0
                // for the ~1,265 items that carry no Base Price in NetSuite. When present, NetSuite wins.
                const nsBasePrice = parseFloat(item.base_price);
                if (Number.isFinite(nsBasePrice) && nsBasePrice > 0) newSpecs.basePrice = nsBasePrice;

                if (existingAppRecord) {
                    const existingSpecs = existingAppRecord.manufacturingSpecs || {};
                    // 🔒 Preserve the app-curated routingType on an EXISTING item — Visual Assembly / Inception
                    // own it (MAIN = mainline assembly); NetSuite only supplies STANDARD/UNASSIGNED. A re-import
                    // must never un-mainline an assembly or drop it off Node Grouping / Visual Assembly / BOM.
                    if (existingAppRecord.routingType) payload.routingType = existingAppRecord.routingType;
                    // 🔒 Keep the app's item name on an EXISTING item — a re-import must not revert a rename
                    // done in the app back to NetSuite's display name.
                    if (existingAppRecord.itemName) payload.itemName = existingAppRecord.itemName;
                    // 🔒 App is master for the curated FILTER fields on an EXISTING item — a NetSuite
                    // re-import must not overwrite what was curated in the app:
                    //   • productType (Category): keep the app's value; only let NS fill it when the app
                    //     left it blank / Uncategorized.
                    //   • watchList + collections: already preserved — newSpecs doesn't carry them, and
                    //     customData is deep-merged App-wins below. (Other specs still refresh from NS.)
                    const keepProductType = (existingSpecs.productType && String(existingSpecs.productType).toUpperCase() !== 'UNCATEGORIZED')
                        ? existingSpecs.productType
                        : (newSpecs.productType || existingSpecs.productType || 'Uncategorized');
                    payload.manufacturingSpecs = {
                        ...existingSpecs,
                        ...newSpecs,
                        productType: keepProductType,
                        customData: { ...(newSpecs.customData || {}), ...(existingSpecs.customData || {}) }
                    };
                } else {
                    payload.id = docId;
                    payload.itemId = docId;
                    payload.brandId = activeBrand;
                    payload.sharedBrands = [activeBrand];
                    payload.manufacturingSpecs = { ...newSpecs, status: "IMPORTED_FROM_ERP" };
                }

                // A. Write the main Item record
                await setDoc(doc(db, "Approved_Designs", docId), payload, { merge: true });

                // B. Write the BOM Pins if this is an assembly
                if (partClass === 'Assembly' && item.bom_components.length > 0) {
                    const batch = writeBatch(db);
                    
                    // 🚀 NEW: Filter OUT service items so they don't become ghost pins
                    const physicalComponents = item.bom_components.filter(c => !c.isService);

                    physicalComponents.forEach(comp => {
                        const resolvedLegacyId = nsInternalToLegacyMap[comp.internalId] || existingInternalIdMap[comp.internalId] || comp.internalId;
                        
                        const pinId = `PIN-${docId}-${comp.internalId}`; 
                        const pinRef = doc(db, "assembly_pins", pinId);
                        
                        batch.set(pinRef, {
                            id: pinId,
                            assemblyId: docId, 
                            partId: resolvedLegacyId,
                            defaultQty: comp.qty,
                            syncedFromErp: true
                        }, { merge: true });
                    });
                    
                    if (physicalComponents.length > 0) {
                        await batch.commit();
                    }
                }

                successCount++;
            }

            addLog(`✅ Successfully synced and mapped ${successCount} library items. App structure preserved.`, 'success');
            addLog(`🏷️ Flagged ${stockedCount} STOCKED (custitem27), ${inHouseCount} IN-HOUSE (custitem26), ${oldCount} OLD/hidden (custitem28) of ${successCount} items.`, stockedCount > 0 ? 'success' : 'info');

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    // --- APP → NETSUITE WRITE-BACK (v1: App is master for the core curated fields) ---
    const restPatch = async (recordType, nsId, payload) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}/${nsId}`;
        const response = await fetch(FIREBASE_FUNCTION_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl, method: 'PATCH', payload })
        });
        const result = await response.json().catch(() => ({}));
        return { ok: response.ok, result };
    };
    const restPost = async (recordType, payload) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}`;
        const response = await fetch(FIREBASE_FUNCTION_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl, method: 'POST', payload })
        });
        const result = await response.json().catch(() => ({}));
        return { ok: response.ok, result };
    };
    const suiteqlQuery = async (q) => {
        const response = await fetch(FIREBASE_FUNCTION_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } })
        });
        const result = await response.json().catch(() => ({}));
        return response.ok ? (result.items || []) : null;
    };

    const handlePushItemsToNetSuite = async () => {
        if (!window.confirm(`Push ${String(activeBrand || '').toUpperCase()} item updates (SKU, Name, Base Price, Weight) FROM the App TO NetSuite?\n\nThis overwrites those fields on the matched NetSuite items. Tags/flags are not sent (App-only). Tip: test ONE item via the Library's per-item push first.`)) return;
        setIsSyncing(true);
        addLog(`Initiating App → NetSuite write-back for ${String(activeBrand || '').toUpperCase()}...`, 'info');
        try {
            const snap = await getDocs(collection(db, "Approved_Designs"));
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(p => (p.brandId === activeBrand || (p.sharedBrands || []).includes(activeBrand)) && p.netSuiteInternalId);
            if (items.length === 0) { addLog("No mapped items (with a NetSuite Internal ID) for this brand. Sync from ERP / set the ID first.", 'warn'); setIsSyncing(false); return; }
            addLog(`Found ${items.length} mapped item(s). Writing back...`, 'info');

            let updated = 0, coreOnly = 0, failed = 0;
            for (const p of items) {
                const specs = p.manufacturingSpecs || {};
                const full = {};
                if (p.legacyErpId && p.legacyErpId !== 'PENDING') full.itemid = p.legacyErpId;
                if (p.itemName) full.displayname = p.itemName;
                const bpv = parseFloat(specs.basePrice); if (specs.basePrice !== undefined && specs.basePrice !== '' && !isNaN(bpv)) full.custitem9 = bpv;
                const wv = parseFloat(specs.weight); if (specs.weight !== undefined && specs.weight !== '' && !isNaN(wv)) full.weight = wv;
                if (Object.keys(full).length === 0) continue;

                let recordType = p.netSuiteRecordType || (p.partClass === 'Inventory' ? 'inventoryitem' : 'assemblyitem');
                let { ok, result } = await restPatch(recordType, p.netSuiteInternalId, full);
                // record-type mismatch → NetSuite names the real type; retry with it
                if (!ok) {
                    const actual = JSON.stringify(result || '').match(/different type:\s*([a-z]+)/i)?.[1];
                    if (actual && actual.toLowerCase() !== recordType) { recordType = actual.toLowerCase(); ({ ok, result } = await restPatch(recordType, p.netSuiteInternalId, full)); }
                }
                // tolerance: retry with just the core (itemid + displayname) so an odd price/weight can't fail the row
                let droppedToCore = false;
                if (!ok) {
                    const core = {};
                    if (full.itemid) core.itemid = full.itemid;
                    if (full.displayname) core.displayname = full.displayname;
                    if (Object.keys(core).length && Object.keys(core).length < Object.keys(full).length) {
                        ({ ok, result } = await restPatch(recordType, p.netSuiteInternalId, core));
                        droppedToCore = ok;
                    }
                }
                if (ok) {
                    updated++; if (droppedToCore) coreOnly++;
                    if (p.netSuiteRecordType !== recordType) { try { await setDoc(doc(db, "Approved_Designs", p.id), { netSuiteRecordType: recordType }, { merge: true }); } catch (_) { /* non-fatal */ } }
                } else {
                    failed++;
                    addLog(`  ✗ ${p.legacyErpId || p.itemId || p.id}: ${JSON.stringify(result).slice(0, 180)}`, 'error');
                }
            }
            addLog(`✅ Write-back done: ${updated} updated${coreOnly ? ` (${coreOnly} core-only after a field was dropped)` : ''}, ${failed} failed.`, failed ? 'warn' : 'success');

            // --- UNMAPPED items: MERGE-or-CREATE (never duplicate) ---
            // Items with a real item # but no NetSuite link: (1) look up the EXACT itemid in NetSuite —
            // if it exists, just LINK it (store the internal id; no duplicate created); (2) if it
            // doesn't exist, CREATE it (Inventory items only) and store the new internal id.
            const unmapped = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(p => (p.brandId === activeBrand || (p.sharedBrands || []).includes(activeBrand))
                    && !p.netSuiteInternalId
                    && p.legacyErpId && p.legacyErpId !== 'PENDING' && p.legacyErpId !== 'N/A');
            if (unmapped.length && window.confirm(`${unmapped.length} item(s) have an item # but NO NetSuite link.\n\nProcess them now? Exact item-id matches in NetSuite are LINKED (merged — never duplicated); the rest are CREATED as new NetSuite items (Inventory class only).`)) {
                let linked = 0, created = 0, skipped = 0, cfailed = 0;
                const subId = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || '2';
                for (const p of unmapped) {
                    const code = String(p.legacyErpId).toUpperCase().replace(/'/g, "''");
                    const rows = await suiteqlQuery(`SELECT id, itemid FROM item WHERE UPPER(itemid) = '${code}'`);
                    if (rows === null) { cfailed++; addLog(`  ✗ ${p.legacyErpId}: NetSuite lookup failed — skipped.`, 'error'); continue; }
                    if (rows.length) {
                        await setDoc(doc(db, "Approved_Designs", p.id), { netSuiteInternalId: String(rows[0].id) }, { merge: true });
                        linked++; addLog(`  ⛓ ${p.legacyErpId}: exists in NetSuite (id ${rows[0].id}) — LINKED, no duplicate.`, 'success');
                        continue;
                    }
                    if (p.partClass !== 'Inventory') { skipped++; addLog(`  ○ ${p.legacyErpId}: not in NetSuite, but only Inventory-class items are auto-created (this is ${p.partClass || 'unclassified'}). Create it in NetSuite manually, then re-run to link.`, 'warn'); continue; }
                    const specs = p.manufacturingSpecs || {};
                    const body = { itemid: p.legacyErpId, displayname: p.itemName || p.legacyErpId, subsidiary: { items: [{ id: subId }] } };
                    const bp = parseFloat(specs.basePrice); if (!isNaN(bp) && bp > 0) body.custitem9 = bp;
                    let { ok, result } = await restPost('inventoryitem', body);
                    // Common create blockers, retried tolerantly: mandatory tax schedule → default '1';
                    // subsidiary shape variations → single-ref form.
                    if (!ok && /taxschedule|tax schedule/i.test(JSON.stringify(result))) ({ ok, result } = await restPost('inventoryitem', { ...body, taxschedule: { id: '1' } }));
                    if (!ok && /subsidiary/i.test(JSON.stringify(result))) ({ ok, result } = await restPost('inventoryitem', { ...body, taxschedule: { id: '1' }, subsidiary: { id: subId } }));
                    if (ok) {
                        // REST POST returns the new record; re-look up by itemid when the id isn't echoed.
                        let newId = result?.id;
                        if (!newId) { const back = await suiteqlQuery(`SELECT id FROM item WHERE UPPER(itemid) = '${code}'`); newId = back?.[0]?.id; }
                        if (newId) await setDoc(doc(db, "Approved_Designs", p.id), { netSuiteInternalId: String(newId), netSuiteRecordType: 'inventoryitem' }, { merge: true });
                        created++; addLog(`  ＋ ${p.legacyErpId}: CREATED in NetSuite${newId ? ` (id ${newId})` : ''}.`, 'success');
                    } else {
                        cfailed++; addLog(`  ✗ ${p.legacyErpId}: create failed — ${JSON.stringify(result).slice(0, 200)}`, 'error');
                    }
                }
                addLog(`✅ Merge-or-create done: ${linked} linked (existing), ${created} created, ${skipped} skipped, ${cfailed} failed.`, cfailed ? 'warn' : 'success');
            }
        } catch (e) { console.error(e); addLog(`❌ Write-back failed: ${e.message}`, 'error'); }
        setIsSyncing(false);
    };

    // FABRICUT IMPORT: upload Fabricut_CE_CrossReference.xlsx → stamp Fabricut retail/cost pricing
    // + sizeKey metadata onto EXISTING library items, matched by CE item # (base + every finish
    // variant). Never creates items and never touches names/dims/basePrice — run "Sync Master
    // Library" first so all H1 items exist here (they're flagged custitem_sync_to_cpq in NetSuite).
    // Idempotent: re-run any time Stuart extends the workbook (poles/finials/rings rows to come).
    const handleFabricutImport = async (file) => {
        if (!file) return;
        setIsSyncing(true);
        try {
            addLog(`FABRICUT IMPORT: parsing "${file.name}"…`, 'info');
            const { rows, sheetsRead, sheetsSkipped } = await parseFabricutWorkbook(file);
            if (!rows.length) throw new Error('No priced rows found — expected sheets with "CE Item #", "Retail Price" and "Sale Price" headers.');
            addLog(`Parsed ${rows.length} rows from: ${sheetsRead.join(', ')}${sheetsSkipped.length ? ` (skipped: ${sheetsSkipped.join(', ')})` : ''}`, 'info');

            addLog('Loading Master Library for CE-code matching…', 'info');
            const snap = await getDocs(collection(db, 'Approved_Designs'));
            const libIndex = [];
            snap.docs.forEach(d => {
                const x = d.data();
                const code = String(x.legacyErpId && x.legacyErpId !== 'PENDING' ? x.legacyErpId : (x.itemId || '')).trim().toUpperCase();
                if (!code || code === 'PENDING') return;
                const cust = x.manufacturingSpecs?.customData || {};
                libIndex.push({ docId: d.id, code, hasProjection: !!cust.projection, hasBpo: !!cust.bpOrientation });
            });

            const plan = buildFabricutPlan(rows, libIndex, Date.now());
            addLog(`Plan: ${plan.stamps.length} library docs to stamp (${plan.stats.basesStamped} base designs + ${plan.stats.variantsStamped} finish variants); ${plan.gaps.length} xlsx items not in the library.`, 'info');

            let done = 0;
            for (let i = 0; i < plan.stamps.length; i += 400) {
                const batch = writeBatch(db);
                plan.stamps.slice(i, i + 400).forEach(s => batch.set(doc(db, 'Approved_Designs', s.docId), s.patch, { merge: true }));
                await batch.commit();
                done += Math.min(400, plan.stamps.length - i);
                addLog(`  …${done}/${plan.stamps.length} stamped`, 'info');
            }

            if (plan.gaps.length) {
                addLog(`⚠ ${plan.gaps.length} CE item(s) in the xlsx have no library match — run "Sync Master Library" (CE subsidiary) first, then re-import. Missing: ${plan.gaps.slice(0, 10).map(g => g.base).join(', ')}${plan.gaps.length > 10 ? ', …' : ''}`, 'warn');
            }
            addLog(`✅ Fabricut import complete: ${done} docs stamped with retail/cost + size keys.`, 'success');
        } catch (e) { console.error(e); addLog(`❌ Fabricut import failed: ${e.message}`, 'error'); }
        setIsSyncing(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Integration</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>NetSuite Master Sync (Pull)</h2>
                </div>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--brass)', border: '1px solid var(--brass)', padding: '4px 8px', borderRadius: '2px' }}>Role: {currentUser}</span>
            </div>

            <div style={{ display: 'flex', gap: '30px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', background: '#fff', padding: '30px', border: '1px solid var(--line)' }}>
                    <div style={{ background: 'var(--paper-2)', border: '1px solid var(--line)', padding: '20px', borderRadius: '2px' }}>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Target Subsidiary ID</label>
                        <input 
                            type="number" 
                            value={nsSubsidiaryId} 
                            onChange={e => setNsSubsidiaryId(e.target.value)} 
                            placeholder="e.g. 3 (Classical Elements)" 
                            style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '1rem', outline: 'none' }} 
                        />
                        <p style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', margin: '8px 0 0 0' }}>The Internal ID of the NetSuite subsidiary you want to import data from.</p>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <SyncButton onClick={handleSyncCustomers} disabled={isSyncing} label="Sync Active Customers" sub="SuiteQL: Pulls all active customers mapped to Subsidiary." />
                        <SyncButton onClick={handleSyncAddresses} disabled={isSyncing} label="Sync Customer Address Books" sub="SuiteQL: Pulls address books and maps IDs." />
                        <SyncButton onClick={handleSyncVendors} disabled={isSyncing} label="Sync Active Vendors" sub="SuiteQL: Pulls all active external vendors/co-ops." />
                        <SyncButton onClick={handleSyncItems} disabled={isSyncing} label="Sync Master Library (Items, Kits & BOMs)" sub="SuiteQL: Single-pass sync. Pulls all Inventory, Assemblies, active BOM Revisions, and component mappings." />
                        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0', paddingTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)' }}>App → NetSuite (write-back)</div>
                        <SyncButton onClick={handlePushItemsToNetSuite} disabled={isSyncing} label="⬆ Push Items → NetSuite (App is master)" sub="REST PATCH: writes the App's SKU, Name, Base Price & Weight onto matched NetSuite items (by Internal ID). Tolerant — record-type + field-drop retries; one row can't halt the run. Tags not sent." />
                        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0', paddingTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)' }}>Fabricut</div>
                        <label style={{ padding: '20px', textAlign: 'left', cursor: isSyncing ? 'wait' : 'pointer', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '6px', opacity: isSyncing ? 0.6 : 1 }}
                            onMouseOver={(e) => { if (!isSyncing) e.currentTarget.style.borderColor = 'var(--brass)'; }}
                            onMouseOut={(e) => { if (!isSyncing) e.currentTarget.style.borderColor = 'var(--line)'; }}>
                            <span style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500 }}>⬆ Import Fabricut Pricing (.xlsx)</span>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Upload Fabricut_CE_CrossReference.xlsx — stamps Fabricut Retail + CE Cost onto every matching library item and finish variant (by CE item #), plus the size keys the H1 size-matrix flows resolve through. Run "Sync Master Library" first; re-run any time the workbook grows. Never touches names, dims or Base Price.</span>
                            <input type="file" accept=".xlsx" disabled={isSyncing} style={{ display: 'none' }} onChange={e => { handleFabricutImport(e.target.files[0]); e.target.value = ''; }} />
                        </label>
                    </div>
                </div>

                <div style={{ flex: 1, background: 'var(--dark)', display: 'flex', flexDirection: 'column', borderRadius: '4px', overflow: 'hidden', minHeight: '600px' }}>
                    <div style={{ padding: '12px 20px', background: 'var(--dark-2)', color: 'var(--paper)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #333' }}>
                        <span>SuiteQL Terminal</span>
                        <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: 'var(--paper)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', opacity: 0.7 }}>CLEAR</button>
                    </div>
                    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px', flex: 1, overflowY: 'auto', fontFamily: 'var(--mono)', fontSize: '12px', color: '#a8a5a0' }}>
                        {syncLog.length === 0 && <span>Awaiting command execution...</span>}
                        {syncLog.map((log, idx) => {
                            let color = '#a8a5a0';
                            if (log.type === 'error') color = '#e27373';
                            if (log.type === 'success') color = '#7dbb81';
                            if (log.type === 'warn') color = '#e2b373';
                            return (
                                <div key={idx} style={{ color, borderBottom: '1px solid #333', paddingBottom: '6px' }}>
                                    <span style={{ opacity: 0.5, marginRight: '10px' }}>[{log.time}]</span>{log.msg}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

const SyncButton = ({ onClick, disabled, label, sub }) => (
    <button 
        onClick={onClick} 
        disabled={disabled} 
        style={{ 
            padding: '20px', textAlign: 'left', cursor: disabled ? 'wait' : 'pointer', border: '1px solid var(--line)',
            background: '#fff', color: 'var(--ink)', transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column', gap: '6px'
        }}
        onMouseOver={(e) => { if(!disabled) e.currentTarget.style.borderColor = 'var(--brass)'; }}
        onMouseOut={(e) => { if(!disabled) e.currentTarget.style.borderColor = 'var(--line)'; }}
    >
        <span style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500 }}>{label}</span>
        <span style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>{sub}</span>
    </button>
);

export default NetSuiteSyncTab;