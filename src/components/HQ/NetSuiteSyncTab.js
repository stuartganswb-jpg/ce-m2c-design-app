import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, setDoc } from "firebase/firestore";

const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "22" },
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

            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching customer batch ${pageCount}...`, 'info');
                const q = `SELECT id, companyname, email, phone, creditlimit, terms FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND id > ${lastId} ORDER BY id ASC`;
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

            addLog(`Downloaded ${allRecords.length} active customers. Writing to CRM Database...`, 'success');

            let successCount = 0;
            for (const c of allRecords) {
                const safeId = `CUST-${c.id}`;
                const docRef = doc(db, "crm_records", safeId);
                
                await setDoc(docRef, {
                    id: safeId,
                    type: 'CUSTOMER',
                    name: c.companyname || `Customer ${c.id}`,
                    email: c.email || '',
                    phone: c.phone || '',
                    creditLimit: parseFloat(c.creditlimit) || 0,
                    terms: c.terms || '',
                    billingAddress: '',
                    discountCode: '',
                    contact: '',
                    salesRep: '',
                    notes: 'Imported from NetSuite',
                    brandId: targetBrand,
                    sharedBrands: [targetBrand],
                    ytd: 0, mtd: 0, openOrders: 0
                }, { merge: true });
                successCount++;
            }
            addLog(`✅ Successfully synced ${successCount} CRM records. mapped to brand: ${targetBrand}`, 'success');

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

    const handleSyncItems = async (itemType) => {
        setIsSyncing(true);
        const typeDesc = itemType === 'Inventory' ? 'Inventory Items' : 'Assemblies / Kits';
        addLog(`Initiating Advanced CPQ Data Sync for [${typeDesc}]...`, 'info');

        try {
            const typeFilter = itemType === 'Inventory' ? "item.itemtype = 'InvtPart'" : "item.itemtype = 'Assembly'";
            const targetSubsidiary = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || "3"; 

            let allRawRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching batch ${pageCount} (Items with ID > ${lastId})...`, 'info');
                const q = `
                    SELECT 
                        item.id, item.itemid, item.displayname,
                        BUILTIN.DF(item.custitem_bit_product_type) AS product_type,
                        BUILTIN.DF(item.custitem_bit_itemcollection) AS collection,
                        BUILTIN.DF(item.custitem_bit_watchlist) AS watchlist,
                        BUILTIN.DF(item.stockunit) AS uom,
                        item.custitem9 AS baseprice,
                        Vendor.companyname AS vendor_name,
                        ItemVendor.vendorcode AS vendor_part_number,
                        ItemVendor.purchaseprice AS lastpurchaseprice,
                        ItemVendor.preferredvendor
                    FROM item
                    LEFT JOIN ItemSubsidiaryMap ON ItemSubsidiaryMap.item = item.id
                    LEFT JOIN ItemVendor ON ItemVendor.item = item.id
                    LEFT JOIN Vendor ON ItemVendor.vendor = Vendor.id
                    WHERE item.custitem_sync_to_cpq = 'T' 
                    AND item.isinactive = 'F' 
                    AND ItemSubsidiaryMap.subsidiary = ${targetSubsidiary}
                    AND ${typeFilter}
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
                const newId = `${activeBrand.toUpperCase()}-${itemType === 'Inventory' ? 'INV' : 'ASM'}-${item.id}`;
                
                const pTypeClean = (item.product_type || '').toLowerCase().trim();
                const uomClean = (item.uom || '').toLowerCase().trim();
                
                const isPoleOrLinear = pTypeClean === 'pole' || pTypeClean === 'poles' || uomClean === 'ft' || uomClean === 'foot' || uomClean === 'feet';
                const autoPartHandling = isPoleOrLinear ? 'Custom' : 'Small Parts';
                const autoIsCutToSize = isPoleOrLinear; 
                const hasVendor = item.vendor_name && item.vendor_name.trim() !== '';

                let parsedOutsourceAction = '';
                if (/EP\d{2}/i.test(item.itemid) || /EP\d{2}/i.test(item.displayname)) parsedOutsourceAction = 'PLATING';

                let parsedCollection = item.collection || '';
                let collectionsArray = [];
                if (/^H1/i.test(item.itemid) || /^H1/i.test(item.displayname)) {
                    parsedCollection = 'Fabricut H1';
                    collectionsArray = ['FABRICUT H1'];
                } else if (item.collection) {
                    collectionsArray = [item.collection.toUpperCase()];
                }

                const payload = {
                    id: newId,
                    itemId: newId,
                    legacyErpId: item.itemid || item.id,
                    netSuiteInternalId: item.id, 
                    itemName: item.displayname || item.itemid,
                    brandId: activeBrand,
                    partClass: itemType,
                    sharedBrands: [activeBrand],
                    manufacturingSpecs: {
                        basePrice: parseFloat(item.baseprice) || 0, 
                        cost: parseFloat(item.lastpurchaseprice) || 0, 
                        isInHouse: !hasVendor, 
                        status: "IMPORTED_FROM_ERP",
                        productType: item.product_type || 'Uncategorized',
                        uom: item.uom || 'EA',
                        binLocation: '',
                        partHandling: autoPartHandling,
                        outsourceAction: parsedOutsourceAction, 
                        collections: collectionsArray, 
                        parametric: { isCutToSize: autoIsCutToSize }, 
                        vendorName: item.vendor_name || '', 
                        vendorId: item.vendor_part_number || '', 
                        customData: {
                            collection: parsedCollection, 
                            watchlist: item.watchlist || '',
                        }
                    },
                    updatedAt: new Date().toISOString()
                };

                await setDoc(doc(db, "Approved_Designs", newId), payload, { merge: true });
                successCount++;
            }
            addLog(`✅ Successfully synced and enriched ${successCount} library items.`, 'success');

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
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
                        <SyncButton onClick={handleSyncCustomers} disabled={isSyncing} label="Sync Active Customers" sub="SuiteQL: Pulls all active customers mapped to Subsidiary (Paginated)." />
                        <SyncButton onClick={handleSyncAddresses} disabled={isSyncing} label="Sync Customer Address Books" sub="SuiteQL: Pulls address books and maps IDs for API Drop-Shipping." />
                        <SyncButton onClick={handleSyncVendors} disabled={isSyncing} label="Sync Active Vendors (Co-Op CRM)" sub="SuiteQL: Pulls all active external vendors/co-ops (Paginated)." />
                        <SyncButton onClick={() => handleSyncItems('Inventory')} disabled={isSyncing} label="Sync Inventory / Components" sub="SuiteQL: Pulls non-assembly items flagged for CPQ sync." />
                        <SyncButton onClick={() => handleSyncItems('Assembly')} disabled={isSyncing} label="Sync Kits / Assemblies" sub="SuiteQL: Pulls Assembly Items flagged for CPQ sync." />
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