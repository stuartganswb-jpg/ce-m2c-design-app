import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { doc, setDoc, getDoc, getDocs, deleteDoc, collection, writeBatch, onSnapshot, updateDoc, query, where, orderBy, limit } from "firebase/firestore";
import { parseFabricutWorkbook, buildFabricutPlan, buildPremiumTierRepairPlan } from '../Shared/fabricutImport';
import { nsProxyFetch } from "../Shared/nsProxy";
import { buildNsItemBody } from "../Shared/nsItemFields";
import { isPoleCategory, autoFinishStream, autoPartHandlingFor } from "../Shared/poleCut";
import { woItemCodeOf } from "../Shared/workOrderContract";

const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3", location: "19" },
    'uniquity': { subsidiary: "6", location: "20" },
    'ce': { subsidiary: "2", location: "17" },
    'leyla': { subsidiary: "5", location: "18" }
};

// NetSuite errors arrive as an RFC-9110 envelope — surface o:errorDetails[].detail, not the boilerplate.
const nsErrDetail = (raw) => {
    const s = String(raw || '');
    const m = [...s.matchAll(/"detail"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(x => x[1].replace(/\\"/g, '"'));
    return m.length ? m.join(' · ') : s;
};
// Heal known payload-shape mistakes before a retry, so Retry isn't a guaranteed repeat failure:
// workorder creation must use `assemblyItem`; workordercompletion receive bins must be ONE bin
// (the library home-bin field is a comma-joined list from the item sync — invalid as a refName).
// Non-WIP work orders can't take workordercompletion — retries flip the transform to the
// WO-linked assemblyBuild (the UI's "Create Build"), which IS valid for them.
const healOutboxUrl = (o) => String(o.targetUrl || '').replace('/!transform/workordercompletion', '/!transform/assemblyBuild');
const healOutboxPayload = (o) => {
    const p = o.payload ? JSON.parse(JSON.stringify(o.payload)) : {};
    if (o.kind === 'workorder' && p.item && !p.assemblyItem) { p.assemblyItem = p.item; delete p.item; }
    if (o.kind === 'workordercompletion' && p.inventoryDetail) {
        const q0 = p.inventoryDetail.quantity;
        const raw = String(p.inventoryDetail?.inventoryAssignment?.items?.[0]?.binNumber?.refName || '');
        const first = raw.split(',')[0].trim().toUpperCase();
        if (!first || first === 'UNASSIGNED') delete p.inventoryDetail;
        else p.inventoryDetail = { quantity: q0, inventoryAssignment: { items: [{ binNumber: { refName: first }, quantity: q0 }] } };
    }
    return p;
};

// ---- FIELD-LEVEL SYNC CONTROL (Stuart 2026-07-28) ----------------------------------------------
// "this brings to light a weakness in the sync — add visible check flags on these 2 windows so we
// can check which ones we want to overwrite in each direction."
//
// The weakness: custitem26/27/28 (In-House / Stocked / Old) only ever travelled NetSuite → app.
// The app's copies could be corrected all day and NetSuite never heard about it, and the Stocked
// flag is what the whole Sales Snapshot is built on — so a right answer in the app still produced
// an empty report. Now every field is a checkbox in BOTH directions.
//
// PULL = "let NetSuite overwrite this on items the app already has". Unchecking a field freezes the
// app's value. New items are unaffected — there is nothing to overwrite on a first import.
// PUSH = "write the app's value onto the NetSuite item".
const PULL_FIELDS = [
    { key: 'cost', label: 'Base Cost' },
    { key: 'basePrice', label: 'Base Price (custitem9)' },
    { key: 'weight', label: 'Weight' },
    { key: 'isInHouse', label: 'In-House · custitem26' },
    { key: 'isStocked', label: 'Stocked · custitem27' },
    { key: 'isRetired', label: 'Old / retired · custitem28' },
    { key: 'outsourceAction', label: 'Outsource action' },
    { key: 'partHandling', label: 'Part handling' },
    { key: 'uom', label: 'UOM' },
    { key: 'bomRevision', label: 'BOM revision' },
    { key: 'binLocation', label: 'Bin location' },
    { key: 'vendorName', label: 'Vendor name' },
    { key: 'vendorId', label: 'Vendor part #' },
    { key: 'vendorNsId', label: 'Vendor internal id (PO alignment)' },
    { key: 'vendorPurchasePrice', label: 'Vendor purchase price' },
    { key: 'nsMirror', label: 'NS class / location / cost cat / descriptions' },
    { key: 'customData', label: 'NS collection / watchlist / projection' },
];
// Fields from Eric's "New Inventory or Assembly Item" sheet that the app mirrors but doesn't
// curate. They ride ONE pull checkbox (`nsMirror`) instead of a dozen — nobody wants to reason
// about "should NetSuite own the tax schedule" as a separate decision from "the cost category".
const NS_MIRROR_KEYS = ['purchasePrice', 'nsClass', 'nsLocation', 'costCategory', 'taxSchedule', 'finishDetail', 'partCategory', 'purchaseDescription', 'salesDescription', 'vendorNameText', 'useBins', 'trackLandedCost', 'sendToFicalora'];
// The three NetSuite checkbox fields, and the app spec each one mirrors.
const NS_FLAG_FIELDS = { isStocked: 'custitem27', isInHouse: 'custitem26', isRetired: 'custitem28' };
const PUSH_FIELDS = [
    { key: 'itemid', label: 'Item # (SKU)', def: true },
    { key: 'displayname', label: 'Display name', def: true },
    { key: 'basePrice', label: 'Base Price (custitem9)', def: true },
    { key: 'weight', label: 'Weight', def: true },
    { key: 'isStocked', label: 'Stocked · custitem27', def: false, flag: true },
    { key: 'isInHouse', label: 'In-House · custitem26', def: false, flag: true },
    { key: 'isRetired', label: 'Old / retired · custitem28', def: false, flag: true },
];
const defaultPullFlags = () => PULL_FIELDS.reduce((a, f) => ({ ...a, [f.key]: true }), {});
const defaultPushFlags = () => PUSH_FIELDS.reduce((a, f) => ({ ...a, [f.key]: f.def }), {});

// ---- ITEM SCOPE (Stuart 2026-07-28: "narrow it down and only sync what we know we want to fix") --
// One box drives BOTH directions. Comma-separated terms, OR'd together:
//   H1-            → item # CONTAINS "H1-"
//   H1-,H2-        → either
//   H1-1BE..H1-9   → an inclusive item-# RANGE (plain A→Z ordering, the same order NetSuite lists in)
// Empty = the whole catalog, i.e. exactly the behaviour before this existed.
// Deliberately NOT persisted: a saved scope would silently narrow somebody's next full sync, and a
// half-synced library is a far worse failure than re-typing "H1-".
const sqlEsc = (s) => String(s).replace(/'/g, "''");
const parseScope = (s) => String(s || '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean).map(t => {
    const r = t.split('..');
    return (r.length === 2 && r[0].trim() && r[1].trim()) ? { from: r[0].trim(), to: r[1].trim() } : { like: t };
});
const scopeSql = (col, terms) => terms.length
    ? ` AND (${terms.map(t => t.like ? `UPPER(${col}) LIKE '%${sqlEsc(t.like)}%'` : `UPPER(${col}) BETWEEN '${sqlEsc(t.from)}' AND '${sqlEsc(t.to)}'`).join(' OR ')})`
    : '';
const scopeHit = (itemid, terms) => {
    if (!terms.length) return true;
    const id = String(itemid || '').toUpperCase();
    return terms.some(t => t.like ? id.includes(t.like) : (id >= t.from && id <= t.to));
};
const scopeLabel = (terms) => terms.map(t => t.like ? `contains “${t.like}”` : `${t.from} → ${t.to}`).join(' or ');

const NetSuiteSyncTab = ({ currentUser, activeBrand }) => {
    const [nsSubsidiaryId, setNsSubsidiaryId] = useState("3");
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncLog, setSyncLog] = useState([]);
    const [outbox, setOutbox] = useState([]); // staged NetSuite writes (ns_outbox) — live monitor
    const [itemScope, setItemScope] = useState("");   // narrows BOTH directions; never persisted
    // Per-field direction control, persisted so a deliberate choice survives a reload.
    const [pullFlags, setPullFlags] = useState(defaultPullFlags);
    const [pushFlags, setPushFlags] = useState(defaultPushFlags);
    useEffect(() => onSnapshot(doc(db, 'system', 'netsuite_sync_flags'), s => {
        const d = s.exists() ? s.data() : {};
        setPullFlags({ ...defaultPullFlags(), ...(d.pull || {}) });
        setPushFlags({ ...defaultPushFlags(), ...(d.push || {}) });
    }, () => { }), []);
    const saveSyncFlags = (pull, push) => {
        setPullFlags(pull); setPushFlags(push);
        setDoc(doc(db, 'system', 'netsuite_sync_flags'), { pull, push, updatedAt: Date.now(), updatedBy: String(currentUser?.name || currentUser || '') }, { merge: true }).catch(() => { });
    };

    useEffect(() => {
        if (BRAND_NETSUITE_MAP[activeBrand]) {
            setNsSubsidiaryId(BRAND_NETSUITE_MAP[activeBrand].subsidiary);
        }
    }, [activeBrand]);

    useEffect(() => {
        const unsub = onSnapshot(query(collection(db, 'ns_outbox'), orderBy('createdAt', 'desc'), limit(80)),
            snap => setOutbox(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
            () => { /* collection may not exist yet — panel just stays empty */ });
        return () => unsub();
    }, []);

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    const executeSuiteQL = async (queryStr) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql`;
        const response = await nsProxyFetch({
            targetUrl: targetUrl,
            method: 'POST',
            payload: { q: queryStr }
        });

        const data = await response.json();
        if (!response.ok) throw new Error(`NetSuite Error: ${JSON.stringify(data)}`);
        return data;
    };

    // COLUMN PROBE (2026-08-15). SuiteQL fails the WHOLE query on one unknown column, so every
    // field added to the item sync used to risk breaking the entire catalog import if NetSuite
    // spells it differently than we expect. Probe the candidates against a zero-row query first
    // and keep only the ones that resolve: one batch call when they're all good (the normal case),
    // falling back to per-column probes to find the specific offender. Returns the surviving
    // "expr AS alias" list plus the aliases, so callers can guard their readers on what arrived.
    const probeColumns = async (candidates, addLogFn) => {
        if (!candidates.length) return { sql: '', aliases: new Set() };
        const sel = (list) => list.map(c => `${c.expr} AS ${c.alias}`).join(', ');
        try {
            await executeSuiteQL(`SELECT ${sel(candidates)} FROM item WHERE item.id = 0`);
            return { sql: candidates.map(c => `${c.expr} AS ${c.alias},`).join('\n                        '), aliases: new Set(candidates.map(c => c.alias)) };
        } catch (batchErr) { /* one of them is wrong — find out which */ }
        const good = [], bad = [];
        for (const c of candidates) {
            try { await executeSuiteQL(`SELECT ${sel([c])} FROM item WHERE item.id = 0`); good.push(c); }
            catch (e) { bad.push(c); }
        }
        if (bad.length && addLogFn) addLogFn(`⚠ ${bad.length} NetSuite column(s) not available on this account — syncing without them: ${bad.map(c => c.expr).join(', ')}.`, 'warn');
        return { sql: good.map(c => `${c.expr} AS ${c.alias},`).join('\n                        '), aliases: new Set(good.map(c => c.alias)) };
    };

    // ── "SYNC TO APP" GATE — custentity18 (Eric 2026-08-14) ──────────────────────────────────────
    // "Sync to App checkbox added to Vendor and Customer records, which should eliminate a lot of
    // excess records in app lists/searching. Have applied to most prominent vendors and select CE
    // customers, NOT YET to M2C customers."
    //
    // That last clause is why this is a TOGGLE and not simply switched on. Filtering on the field
    // today would silently drop every M2C customer out of the app — the tagging is deliberately
    // half-finished. Off = exactly the behaviour before this existed. When it IS on, both counts are
    // logged (total active vs ticked) so the effect is visible before anyone relies on it.
    //
    // Turning it on does NOT delete records already synced; it stops NEW pulls from bringing
    // untagged ones back. Clearing out what is already there is a separate, deliberate act.
    const [syncOnlyFlagged, setSyncOnlyFlagged] = useState(() => {
        try { return localStorage.getItem('ns_sync_only_flagged') === '1'; } catch (e) { return false; }
    });
    const setSyncGate = (v) => {
        setSyncOnlyFlagged(v);
        try { localStorage.setItem('ns_sync_only_flagged', v ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    };
    // Probed per entity type — an account that never created the field just syncs everything.
    const syncGateSql = async (table) => {
        if (!syncOnlyFlagged) return '';
        try {
            await executeSuiteQL(`SELECT custentity18 FROM ${table} WHERE id = 0`);
            return ` AND custentity18 = 'T'`;
        } catch (e) {
            addLog(`⚠ "Sync to App" (custentity18) isn't available on the ${table} record — syncing every active ${table} instead of only the ticked ones.`, 'warn');
            return '';
        }
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
            const gate = await syncGateSql('customer');
            if (gate) {
                const allCnt = await executeSuiteQL(`SELECT COUNT(*) AS n FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND stage = 'CUSTOMER'`);
                addLog(`"Sync to App" gate ON — of ${parseInt(allCnt.items?.[0]?.n) || 0} active customers in subsidiary ${nsSubsidiaryId}, only those ticked custentity18 will be pulled.`, 'warn');
            }
            const cnt = await executeSuiteQL(`SELECT COUNT(*) AS n FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND stage = 'CUSTOMER'${gate}`);
            const expected = parseInt(cnt.items?.[0]?.n) || 0;
            addLog(`NetSuite reports ${expected} active CUSTOMER-stage records for subsidiary ${nsSubsidiaryId} (leads/prospects excluded)${gate ? ', ticked Sync to App' : ''}.`, 'info');
            if (gate && expected === 0) {
                addLog(`⚠ NOTHING is ticked "Sync to App" for this subsidiary — the run would import 0 customers. Un-tick the gate, or tick the records in NetSuite first.`, 'error');
                alert(`No customers in subsidiary ${nsSubsidiaryId} are ticked "Sync to App" (custentity18).\n\nRunning would import nothing. Eric hasn't applied the flag to M2C customers yet — un-tick "Only Sync-to-App records" on this card to sync them all, or tick them in NetSuite first.`);
                setIsSyncing(false); return;
            }

            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching customer batch ${pageCount}...`, 'info');
                const q = `SELECT id, companyname, email, phone, creditlimit, terms, stage FROM customer WHERE subsidiary = ${nsSubsidiaryId} AND isinactive = 'F' AND stage = 'CUSTOMER'${gate} AND id > ${lastId} ORDER BY id ASC`;
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

            // WHICH SUBSIDIARIES MAY BUY FROM THIS VENDOR (Eric, 2026-08-15). A PO is rejected when
            // its subsidiary isn't one the vendor is assigned to — and ours sit opposite the company
            // buying from them (The Generator's primary is M2C Studio, Dayton Grey's is Classical
            // Elements). Capturing the assignment here lets PO creation say so in plain words instead
            // of letting NetSuite answer with a field-value error about the location.
            let vendorSubs = {};   // vendor id → [subsidiary ids]
            try {
                const rel = await executeSuiteQL('SELECT entity, subsidiary FROM vendorsubsidiaryrelationship');
                (rel.items || []).forEach(r => {
                    const k = String(r.entity);
                    (vendorSubs[k] = vendorSubs[k] || []).push(String(r.subsidiary));
                });
                addLog(`Read subsidiary assignments for ${Object.keys(vendorSubs).length} vendor(s).`, 'info');
            } catch (relErr) {
                addLog(`⚠ Couldn't read vendorsubsidiaryrelationship (${relErr.message || relErr}) — falling back to each vendor's primary subsidiary only. A PO to a vendor shared across subsidiaries may still be flagged wrongly.`, 'warn');
                vendorSubs = null;
            }
            // The primary subsidiary, which is also the one NetSuite auto-populates from the entity.
            let hasVendorSub = true;
            try { await executeSuiteQL('SELECT subsidiary FROM vendor WHERE id = 0'); }
            catch (e) { hasVendorSub = false; }

            const gate = await syncGateSql('vendor');
            if (gate) addLog(`"Sync to App" gate ON — only vendors ticked custentity18 will be pulled.`, 'warn');

            let allRecords = [];
            let lastId = 0;
            let hasMore = true;
            let pageCount = 1;

            while (hasMore) {
                addLog(`Fetching vendor batch ${pageCount}...`, 'info');
                const q = `SELECT id, companyname, email, phone, terms${hasVendorSub ? ', subsidiary' : ''} FROM vendor WHERE isinactive = 'F'${gate} AND id > ${lastId} ORDER BY id ASC`;
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
            
            if (gate && allRecords.length === 0) {
                addLog(`⚠ No vendors are ticked "Sync to App" — nothing was written. Un-tick the gate, or tick them in NetSuite first.`, 'error');
                alert(`No vendors came back ticked "Sync to App" (custentity18), so nothing was written.\n\nUn-tick "Only Sync-to-App records" on this card to sync them all, or tick the vendors in NetSuite first.\n\n(Purchase orders resolve their vendor from these records — an empty vendor list would block every PO.)`);
                setIsSyncing(false); return;
            }
            addLog(`Downloaded ${allRecords.length} active vendors${gate ? ' ticked Sync to App' : ''}. Writing to CRM Database...`, 'success');

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
                    // Primary subsidiary + every subsidiary allowed to transact with this vendor.
                    // `nsSubsidiaries` empty = unknown (the relationship table wasn't readable), which
                    // PO creation treats as "don't warn" rather than "not allowed".
                    nsSubsidiary: v.subsidiary != null ? String(v.subsidiary) : '',
                    nsSubsidiaries: vendorSubs
                        ? Array.from(new Set([...(vendorSubs[String(v.id)] || []), ...(v.subsidiary != null ? [String(v.subsidiary)] : [])]))
                        : [],
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


    // ── FORCE FIX: EVERY POLE AND ROD CARRIES ITS TAGS (Stuart 2026-08-25) ──────────────────────
    // "write a force fix for anything categorized as rod or poles always gets flagged poles … they
    // need to be tagged small parts in the parts handling as these are stocked poles and do not
    // require custom, then they need to be tagged finish stream pole (that was missing)".
    //
    // The sync stamps both tags going forward, but that only reaches an item the next time it is
    // pulled — and Grace has two orders on the floor NOW (WO11485/11486) that were raised before
    // any of this. So this repairs the library AND the open work orders, because a corrected item
    // master does not travel backwards into an order already cut from it.
    //
    // It never overrides an explicit SMALL: that flag is the deliberate exception (the elbow, the
    // bent returns) and a bulk fix that quietly reversed someone's decision would be a worse bug
    // than the one it is fixing.
    const [poleFixBusy, setPoleFixBusy] = useState(false);
    const [stampBusy, setStampBusy] = useState(false);
    const handleForcePoleTags = async () => {
        const dry = !window.confirm('FORCE POLE TAGS\n\nEvery item categorised POLE or ROD gets:\n   • Finish Stream = POLES\n   • Part Handling = Small Parts (stocked poles only — unstocked stay Custom)\n\nOpen finishing work orders for those items are repaired too, so orders already on the floor pick up the pole recipe.\n\nAn item explicitly set to SMALL is left alone.\n\nOK = apply · Cancel = dry run (report only, changes nothing)');
        setPoleFixBusy(true);
        addLog(dry ? '🔍 DRY RUN — reporting what would change, writing nothing.' : '🔧 Applying pole tags…', dry ? 'warn' : 'info');
        try {
            let libScanned = 0, libFixed = 0, woFixed = 0, skippedExplicit = 0;
            const parts = await getDocs(collection(db, 'Approved_Designs'));
            const poleByErp = new Map();
            let batch = writeBatch(db), ops = 0;
            for (const d of parts.docs) {
                const part = d.data() || {};
                const specs = part.manufacturingSpecs || {};
                if (!isPoleCategory(specs.productType)) continue;
                libScanned++;
                poleByErp.set(String(part.legacyErpId || '').toUpperCase(), true);
                const explicit = String(specs.finishStream || '').toUpperCase();
                if (explicit === 'SMALL') { skippedExplicit++; continue; }
                const wantStream = 'POLES';
                const wantHandling = autoPartHandlingFor(specs.productType, specs.isStocked);
                if (explicit === wantStream && specs.partHandling === wantHandling) continue;
                libFixed++;
                if (libFixed <= 15) addLog(`   ${part.legacyErpId} (${specs.productType}) — stream ${explicit || '(blank)'} → POLES · handling ${specs.partHandling || '(blank)'} → ${wantHandling}`, 'info');
                if (!dry) {
                    batch.update(d.ref, { 'manufacturingSpecs.finishStream': wantStream, 'manufacturingSpecs.partHandling': wantHandling });
                    if (++ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0; }
                }
            }
            if (!dry && ops) await batch.commit();
            addLog(`Library: ${libScanned} pole/rod items · ${libFixed} ${dry ? 'would be' : ''} re-tagged · ${skippedExplicit} left alone (explicitly SMALL).`, 'success');

            // OPEN ORDERS — the ones Grace is looking at. An order already on the floor keeps
            // whatever it was stamped with at creation; nothing re-reads the item master.
            const finSnap = await getDocs(collection(db, 'fin_workorders'));
            let wb = writeBatch(db), wops = 0;
            for (const d of finSnap.docs) {
                const wo = d.data() || {};
                if (['Complete', 'Completed', 'Closed', 'Cancelled'].includes(String(wo.currentPhase || wo.status || ''))) continue;
                const ptype = wo.productType || '';
                const code = String(wo.stockErpId || wo.type || '').toUpperCase();
                if (!isPoleCategory(ptype) && !poleByErp.has(code)) continue;
                if (String(wo.finishStream || '').toUpperCase() === 'SMALL') { skippedExplicit++; continue; }
                const qty = Number(wo.totalParts) || 0;
                const needsStream = String(wo.finishStream || '').toUpperCase() !== 'POLES';
                const needsCount = !(Number(wo.totalPoles || (wo.poles && wo.poles.qty)) > 0) && qty > 0;
                if (!needsStream && !needsCount) continue;
                woFixed++;
                addLog(`   ${wo.woNum || wo.id} · ${code || ptype} — ${needsStream ? 'finishStream → POLES' : ''}${needsStream && needsCount ? ' · ' : ''}${needsCount ? `poles ${qty}` : ''}`, 'info');
                if (!dry) {
                    wb.update(d.ref, {
                        finishStream: 'POLES',
                        ...(needsCount ? { poles: { qty, type: String(ptype || 'POLE').toUpperCase() }, totalPoles: qty, paintSize: null, paintSizes: null } : {}),
                        poleTagFixedAt: Date.now(),
                    });
                    if (++wops >= 400) { await wb.commit(); wb = writeBatch(db); wops = 0; }
                }
            }
            if (!dry && wops) await wb.commit();
            addLog(`Open work orders: ${woFixed} ${dry ? 'would be' : ''} repaired.`, woFixed ? 'success' : 'info');
            addLog(dry ? '🔍 Dry run complete — NOTHING was written. Re-run and press OK to apply.' : '✅ Pole tags applied. The floor picks them up on refresh.', 'success');
        } catch (e) {
            console.error(e);
            addLog(`❌ Pole tag fix failed: ${e.message}`, 'error');
        }
        setPoleFixBusy(false);
    };

    // ── CANONICAL ITEM CODE BACKFILL (2026-08-25) ────────────────────────────────────────────────
    // Writers now stamp `itemCode` at creation (workOrderContract.withItemCode); this stamps the
    // orders that already exist, so every screen resolves identity from ONE field instead of the
    // seven legacy spellings. Resolves with the same woItemCodeOf every reader uses — an order it
    // can't resolve is REPORTED and left untouched, never guessed.
    const handleStampItemCodes = async () => {
        const dry = !window.confirm('STAMP CANONICAL ITEM CODES\n\nEvery hq_work_orders and fin_workorders document gets `itemCode` = the item the shared resolver (woItemCodeOf) already reads off it — the one identity field every screen now uses.\n\nOrders whose identity cannot be resolved (e.g. multi-line sales orders) are reported and left untouched.\n\nOK = apply · Cancel = dry run (report only, changes nothing)');
        setStampBusy(true);
        addLog(dry ? '🔍 DRY RUN — reporting what would be stamped, writing nothing.' : '🪪 Stamping canonical item codes…', dry ? 'warn' : 'info');
        try {
            for (const coll of ['hq_work_orders', 'fin_workorders']) {
                const snap = await getDocs(collection(db, coll));
                let stamped = 0, already = 0, unresolved = 0;
                const samples = [];
                let batch = writeBatch(db), ops = 0;
                for (const d of snap.docs) {
                    const wo = d.data() || {};
                    const code = woItemCodeOf(wo);
                    if (!code) { unresolved++; if (samples.length < 8) samples.push(wo.woNum || wo.woId || d.id); continue; }
                    const patch = {};
                    if (wo.itemCode !== code) patch.itemCode = code;
                    // A parked finPayload releases to the floor VERBATIM — stamp it in place too.
                    if (wo.finPayload && typeof wo.finPayload === 'object') {
                        const fpCode = woItemCodeOf(wo.finPayload);
                        if (fpCode && wo.finPayload.itemCode !== fpCode) patch['finPayload.itemCode'] = fpCode;
                    }
                    if (!Object.keys(patch).length) { already++; continue; }
                    stamped++;
                    if (!dry) {
                        batch.update(d.ref, { ...patch, itemCodeStampedAt: Date.now() });
                        if (++ops >= 400) { await batch.commit(); batch = writeBatch(db); ops = 0; }
                    }
                }
                if (!dry && ops) await batch.commit();
                addLog(`${coll}: ${snap.docs.length} scanned · ${stamped} ${dry ? 'would be' : ''} stamped · ${already} already canonical · ${unresolved} unresolvable${samples.length ? ` (e.g. ${samples.join(', ')})` : ''}.`, 'success');
            }
            addLog(dry ? '🔍 Dry run complete — NOTHING was written. Re-run and press OK to apply.' : '✅ Item codes stamped. Every screen now reads the one canonical field.', 'success');
        } catch (e) {
            console.error(e);
            addLog(`❌ Item-code stamp failed: ${e.message}`, 'error');
        }
        setStampBusy(false);
    };

    const handleSyncItems = async () => {
        const scopeTerms = parseScope(itemScope);
        if (scopeTerms.length && !window.confirm(`Sync ONLY items where the item # is ${scopeLabel(scopeTerms)}?\n\nEverything else in NetSuite is left alone — this is a targeted repair, not a full library sync.\n\nBOM components outside the scope still resolve from items already in the library.`)) return;
        setIsSyncing(true);
        addLog(scopeTerms.length ? `Initiating SCOPED Master Library Sync — item # ${scopeLabel(scopeTerms)}...` : `Initiating Advanced Master Library Sync...`, scopeTerms.length ? 'warn' : 'info');

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

            // ⏳ TEMP flag probe (custitem_app_temp): legacy items loaded ONLY so finishing can run
            // 100% in-app until discontinuation — flagged here, nuked later via Master Library's
            // "☢ Nuke temp items". The checkbox may not exist in NetSuite yet, and SuiteQL errors
            // on unknown columns, so probe once and sync without it until it's created.
            let hasTempField = false;
            try {
                await executeSuiteQL("SELECT item.custitem_app_temp AS t FROM item WHERE item.id = 0");
                hasTempField = true;
            } catch (probeErr) {
                addLog(`⏳ TEMP checkbox (custitem_app_temp) not found in NetSuite — syncing without it. Create the item checkbox field with that exact ID to enable temp-item tracking.`, 'info');
            }

            // ---- ERIC'S FIELD SHEET (Items_NS, 2026-08-15) ---------------------------------------
            // The item sync only ever read 17 of the 31 fields on the "New Inventory or Assembly
            // Item" sheet, so the library could never mirror (or re-create) a NetSuite item. These
            // are the rest. Every one is PROBED — an account that spells one differently just loses
            // that field instead of failing the whole catalog import.
            //
            // The two that matter most to purchasing:
            //   • ItemVendor.vendor      = the vendor's INTERNAL ID. Without it, PO creation had to
            //     fuzzy-match the vendor NAME against the synced CRM records, and any near-miss
            //     produced NO PO at all (Stuart 2026-08-15: "unable to create PO in the app").
            //   • ItemVendor.purchaseprice = what the vendor actually charges. PO lines were rated
            //     from `averagecost`, which is a costing artefact, not a price anyone agreed to.
            const extraCols = await probeColumns([
                { expr: 'ItemVendor.vendor', alias: 'vendor_internal_id' },
                { expr: 'ItemVendor.purchaseprice', alias: 'vendor_purchase_price' },
                { expr: 'item.cost', alias: 'purchase_price' },
                { expr: 'item.vendorname', alias: 'vendor_name_text' },
                { expr: 'BUILTIN.DF(item.class)', alias: 'ns_class' },
                { expr: 'BUILTIN.DF(item.location)', alias: 'ns_location' },
                { expr: 'BUILTIN.DF(item.costcategory)', alias: 'cost_category' },
                { expr: 'BUILTIN.DF(item.taxschedule)', alias: 'tax_schedule' },
                { expr: 'BUILTIN.DF(item.custitem2)', alias: 'finish_detail' },
                { expr: 'BUILTIN.DF(item.custitem22)', alias: 'part_category' },
                { expr: 'item.custitem20', alias: 'send_to_ficalora' },
                { expr: 'item.usebins', alias: 'use_bins' },
                { expr: 'item.tracklandedcost', alias: 'track_landed_cost' },
                { expr: 'item.purchasedescription', alias: 'purchase_description' },
                { expr: 'item.salesdescription', alias: 'sales_description' },
            ], addLog);
            const hasCol = (a) => extraCols.aliases.has(a);
            addLog(`Item sync will read ${extraCols.aliases.size} additional NetSuite field(s) from Eric's field sheet${hasCol('vendor_internal_id') ? ' — including the vendor internal id (PO alignment)' : ''}.`, hasCol('vendor_internal_id') ? 'success' : 'warn');

            // HOW MANY SHOULD ARRIVE (Stuart 2026-08-04: "parts not syncing from netsuite even when
            // tagged"). The CUSTOMER sync has counted first and verified at the end since 2026-07 —
            // the item sync never did, so a run that stopped short reported success and the missing
            // items simply never appeared. Same WHERE as the page query, minus the row-multiplying
            // joins (a single item fans out across BOM components, bins and vendors), so this
            // counts ITEMS, not rows.
            let expectedItems = 0;
            try {
                const cntQ = `SELECT COUNT(DISTINCT item.id) AS n FROM item
                    LEFT JOIN ItemSubsidiaryMap ON ItemSubsidiaryMap.item = item.id
                    WHERE item.custitem_sync_to_cpq = 'T' AND item.isinactive = 'F'
                    AND item.itemid NOT LIKE 'STD-%'
                    AND ItemSubsidiaryMap.subsidiary = ${targetSubsidiary}
                    AND (item.itemtype = 'InvtPart' OR item.itemtype = 'Assembly')${scopeSql('item.itemid', scopeTerms)}`;
                const cnt = await executeSuiteQL(cntQ);
                expectedItems = parseInt(cnt.items?.[0]?.n) || 0;
                addLog(`NetSuite reports ${expectedItems} tagged item(s) for subsidiary ${targetSubsidiary}${scopeTerms.length ? ` in scope ${scopeLabel(scopeTerms)}` : ''}.`, 'info');
            } catch (cErr) {
                addLog(`⚠ Couldn't count the tagged items first (${cErr.message || cErr}) — the run will still import, but it can't prove it got everything.`, 'warn');
            }

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
                        item.itemtype AS ns_itemtype,
                        item.weight,
                        BUILTIN.DF(item.custitem_bit_product_type) AS product_type,
                        BUILTIN.DF(item.custitem_bit_itemcollection) AS collection,
                        BUILTIN.DF(item.custitem_bit_watchlist) AS watchlist,
                        BUILTIN.DF(item.custitem_bracket_projection) AS projection,
                        item.custitem27 AS is_stocked,
                        item.custitem26 AS is_inhouse,
                        item.custitem28 AS is_old,
                        ${hasTempField ? 'item.custitem_app_temp AS is_temp,' : ''}
                        BUILTIN.DF(item.stockunit) AS uom,
                        item.averagecost AS base_cost,
                        pl1.unitprice AS base_price,
                        Vendor.companyname AS vendor_name,
                        ItemVendor.vendorcode AS vendor_part_number,
                        ItemVendor.preferredvendor,
                        ${extraCols.sql}
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
                    /* "STD-" items = the renamed OLD standard-cost items (2026-07 NetSuite realignment).
                       They keep the retired sales history for the Stock View snapshot ONLY — never
                       imported into the app library (60 of them still carry the sync flag). */
                    AND item.itemid NOT LIKE 'STD-%'
                    AND ItemSubsidiaryMap.subsidiary = ${targetSubsidiary}
                    AND (item.itemtype = 'InvtPart' OR item.itemtype = 'Assembly')
                    AND item.id > ${lastId}${scopeSql('item.itemid', scopeTerms)}
                    ORDER BY item.id ASC
                `;

                const result = await executeSuiteQL(q);
                const batch = result.items || [];
                allRawRecords = allRawRecords.concat(batch);

                if (batch.length > 0) {
                    const prevLastId = lastId;
                    lastId = batch[batch.length - 1].id;
                    // NETSUITE'S OWN ANSWER BEATS OUR GUESS. `batch.length < 1000` assumed the
                    // response cap is exactly 1000 — any page that came back one row short of it
                    // ended the loop and silently dropped every item after that id. SuiteQL returns
                    // `hasMore` on the response; use it when present and keep the row count only as
                    // the fallback for a response that omits it.
                    hasMore = (typeof result.hasMore === 'boolean') ? result.hasMore : (batch.length >= 1000);
                    // A page that doesn't advance the key would loop forever (one item fanning out
                    // past a full page across its BOM/bin joins). Stop, and say what was lost.
                    if (hasMore && String(lastId) === String(prevLastId)) {
                        addLog(`⚠ Item ${lastId} fans out past a full page of joined rows — paging stopped here to avoid a loop. Its BOM/bin detail may be partial and later items were NOT fetched. Re-run scoped to that item.`, 'warn');
                        hasMore = false;
                    }
                    if (hasMore) pageCount++;
                } else {
                    hasMore = false;
                }
            }
            
            addLog(`Downloaded ${allRawRecords.length} total rows. Processing deduplication, BOMs, and Bins...`, 'success');

            const uniqueRecordsMap = {};
            const nsInternalToLegacyMap = {}; // Lookup Dictionary for Live Batch

            // NetSuite checkbox custom fields come back as 'T'/'F'. custitem27 = "Stocked" (held on the
            // shelf, sold via Quick Ship); custitem26 = finished IN-HOUSE (needs a WO, not outsourced).
            // Declared here because the de-duplication below reads `preferredvendor` with it.
            const nsBool = (v) => v === true || v === 'T' || v === 't' || v === 'true' || v === 1 || v === '1';
            const nsHasVal = (v) => v !== undefined && v !== null && v !== '';

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

                // PREFERRED VENDOR WINS (2026-08-15). An item fans out to one row per ItemVendor
                // entry, and the first row simply won — so a part carried by three vendors took
                // whichever one NetSuite happened to list first, and the PO went to the wrong
                // company. `preferredvendor` was already being selected and never read. Only the
                // vendor columns are re-pointed; everything else on the row is item-level and
                // identical across the fan-out.
                if (nsBool(row.preferredvendor) && !nsBool(uniqueRecordsMap[itemId].preferredvendor)) {
                    Object.assign(uniqueRecordsMap[itemId], {
                        preferredvendor: row.preferredvendor,
                        vendor_name: row.vendor_name,
                        vendor_part_number: row.vendor_part_number,
                        vendor_internal_id: row.vendor_internal_id,
                        vendor_purchase_price: row.vendor_purchase_price,
                    });
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
            // The whole point of counting first. A short run must never read as a clean one.
            if (expectedItems && records.length < expectedItems) {
                const missing = expectedItems - records.length;
                addLog(`⚠️ TRUNCATED: NetSuite has ${expectedItems} tagged item(s), this run only pulled ${records.length} — ${missing} MISSING. They will not appear in the library. Re-run; if it persists, sync a narrower item # range and tell Claude.`, 'warn');
                if (!window.confirm(`⚠ This sync came back SHORT.\n\nNetSuite: ${expectedItems} tagged items\nDownloaded: ${records.length}\nMissing: ${missing}\n\nWriting anyway will update the ${records.length} that DID arrive and silently leave the rest as they are.\n\nOK = write what arrived · Cancel = stop and re-run`)) {
                    addLog('Sync stopped by operator — nothing was written.', 'warn');
                    setIsSyncing(false);
                    return;
                }
            } else if (expectedItems) {
                addLog(`✓ All ${records.length} tagged item(s) accounted for.`, 'success');
            }
            let successCount = 0;
            let stockedCount = 0, inHouseCount = 0, oldCount = 0, tempCount = 0;
            let prunedPins = 0; const prunedDetail = [];   // BOM lines NetSuite no longer has

            // 2. Process and Push to Firebase
            for (const item of records) {
                const sku = (item.itemid || item.id).toString().toUpperCase();
                const existingAppRecord = existingPartsMap[sku];
                
                // --- DYNAMIC CLASSIFICATION ENGINE ---
                let partClass = "Inventory";
                let routingType = "UNASSIGNED";
                let isInHouse = true;
                let outsourceAction = "";

                // 1. Classify Assembly vs Inventory — NetSuite's REAL record type is the truth
                // (2026-07-18: HCUNEC1/PT, a BOUGHT Pewter finial, was mis-classed Assembly by the
                // '/P' substring guess, while painted /N25 and /SG — real NetSuite assemblies with
                // paint BOMs — fell through to Inventory). The suffix heuristic survives only as a
                // fallback for rows where itemtype is somehow missing.
                const nsItemType = String(item.ns_itemtype || '').toLowerCase();
                if (nsItemType === 'assembly') {
                    partClass = "Assembly";
                    routingType = "STANDARD";
                } else if (nsItemType !== 'invtpart' && (sku.includes('/P') || sku.includes('/EP'))) {
                    partClass = "Assembly";
                    routingType = "STANDARD";
                }
                // Plated variants are outsourced regardless of class (custitem26 below still wins).
                if (sku.includes('/EP')) isInHouse = false;

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
                const isTemp = hasTempField && nsBool(item.is_temp); // custitem_app_temp = TEMP legacy load, nukeable batch
                if (nsHasVal(item.is_inhouse)) isInHouse = nsBool(item.is_inhouse);
                if (isStocked) stockedCount++;
                if (isRetired) oldCount++;
                if (isTemp) tempCount++;
                if (isInHouse) inHouseCount++;

                // 3. Part Handling Logic (Poles vs Small Parts)
                const pTypeClean = (item.product_type || '').toLowerCase().trim();
                const uomClean = (item.uom || '').toLowerCase().trim();

                // THE SYNC NOW CARRIES BOTH POLE TAGS (Stuart 2026-08-25, from Grace's WO11485/86).
                // This test knew about 'pole' and 'track' but not ROD, so a 4 ft rod imported as an
                // ordinary small part and nothing downstream could tell it was a pole.
                const isPole = isPoleCategory(item.product_type) || pTypeClean.includes('track') ||
                               uomClean === 'ft' || uomClean === 'foot' || uomClean === 'feet';
                // PART HANDLING — Stuart: "they need to be tagged small parts in the parts handling
                // as these are stocked poles and do not require custom". Custom routes a line into
                // the custom shop division; a stocked rod is an ordinary finishing job. A pole that
                // is not stocked is cut to order, so it stays Custom.
                const partHandling = isPoleCategory(item.product_type)
                    ? autoPartHandlingFor(item.product_type, isStocked)
                    : (isPole ? "Custom" : "Small Parts");
                // FINISH STREAM — the tag that was missing on her orders. Category-derived, so a
                // pole never depends on someone remembering to set it per item.
                const finishStreamAuto = autoFinishStream(item.product_type);

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
                // Stamp the REAL NetSuite record type so the write-back path (which otherwise
                // guesses it from partClass) can never target the wrong endpoint.
                if (nsItemType) payload.netSuiteRecordType = nsItemType === 'assembly' ? 'assemblyitem' : 'inventoryitem';

                const newSpecs = {
                    cost: determinedCost,
                    weight: parseFloat(item.weight) || 0,
                    isInHouse: isInHouse,
                    isStocked: isStocked,
                    isRetired: isRetired,
                    ...(hasTempField ? { isTemp } : {}),
                    outsourceAction: outsourceAction,
                    partHandling: partHandling,
                    ...(finishStreamAuto ? { finishStream: finishStreamAuto } : {}),
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

                // The vendor's NetSuite INTERNAL ID — what a purchase order actually needs. Stored
                // alongside the name so PO creation can stop guessing (StockViewTab resolves this
                // first and only falls back to name-matching for items synced before this existed).
                if (hasCol('vendor_internal_id') && nsHasVal(item.vendor_internal_id)) newSpecs.vendorNsId = String(item.vendor_internal_id);
                // Vendor purchase price ≠ average cost. PO line rates use this when NetSuite has it.
                if (hasCol('vendor_purchase_price')) {
                    const vpp = parseFloat(item.vendor_purchase_price);
                    if (Number.isFinite(vpp) && vpp > 0) newSpecs.vendorPurchasePrice = vpp;
                }
                // Purchase price on the item itself (Eric's sheet maps this to `cost`) — the
                // fallback rate when the vendor sublist carries no price.
                if (hasCol('purchase_price')) {
                    const pp = parseFloat(item.purchase_price);
                    if (Number.isFinite(pp) && pp > 0) newSpecs.purchasePrice = pp;
                }
                // The remaining fields off Eric's sheet: carried so the library mirrors NetSuite and
                // so item CREATION can round-trip them. Only written when NetSuite actually has a
                // value, so a re-import can never blank a curated field back out.
                const nsFields = {
                    nsClass: hasCol('ns_class') ? item.ns_class : undefined,
                    nsLocation: hasCol('ns_location') ? item.ns_location : undefined,
                    costCategory: hasCol('cost_category') ? item.cost_category : undefined,
                    taxSchedule: hasCol('tax_schedule') ? item.tax_schedule : undefined,
                    finishDetail: hasCol('finish_detail') ? item.finish_detail : undefined,
                    partCategory: hasCol('part_category') ? item.part_category : undefined,
                    purchaseDescription: hasCol('purchase_description') ? item.purchase_description : undefined,
                    salesDescription: hasCol('sales_description') ? item.sales_description : undefined,
                    vendorNameText: hasCol('vendor_name_text') ? item.vendor_name_text : undefined,
                };
                Object.entries(nsFields).forEach(([k, v]) => { if (nsHasVal(v)) newSpecs[k] = String(v); });
                if (hasCol('use_bins')) newSpecs.useBins = nsBool(item.use_bins);
                if (hasCol('track_landed_cost')) newSpecs.trackLandedCost = nsBool(item.track_landed_cost);
                if (hasCol('send_to_ficalora')) newSpecs.sendToFicalora = nsBool(item.send_to_ficalora);

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
                    // 🎚 PER-FIELD DIRECTION CONTROL: drop any field the operator unchecked on the
                    // pull card, so the app's curated value survives this import untouched. Only
                    // EXISTING items are protected — a first import has nothing to overwrite.
                    const allowedSpecs = {};
                    Object.entries(newSpecs).forEach(([k, v]) => {
                        const gate = NS_MIRROR_KEYS.includes(k) ? 'nsMirror' : k;
                        if (pullFlags[gate] !== false) allowedSpecs[k] = v;
                    });
                    // An EXPLICIT stream chosen in the app is a deliberate exception (the elbow,
                    // the bent returns — small parts finished like poles) and outranks anything
                    // derived from the category. The sync only fills the blank.
                    const keepFinishStream = existingSpecs.finishStream || allowedSpecs.finishStream || '';
                    payload.manufacturingSpecs = {
                        ...existingSpecs,
                        ...allowedSpecs,
                        ...(keepFinishStream ? { finishStream: String(keepFinishStream).toUpperCase() } : {}),
                        productType: keepProductType,
                        customData: pullFlags.customData === false
                            ? (existingSpecs.customData || {})
                            : { ...(newSpecs.customData || {}), ...(existingSpecs.customData || {}) }
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
                    
                    // ── THE BOM IS A REPLACEMENT, NOT AN ADDITION (Eric 2026-08-21) ────────────
                    // "The app is bringing in BOM changes as additive instead of replacing/updating
                    // the items … the now updated HCUMP410/CP rod. Updated to only use the raw
                    // HCUMP410 item. Still shows the HCUMP810/CP and STD-HCUMP810/CP 8-ft rods from
                    // the prior BOMs."
                    //
                    // Every component NetSuite reports got a pin; nothing ever removed the pins for
                    // components NetSuite had DROPPED, so a re-engineered assembly accumulated every
                    // version of itself. That is what sent the warehouse looking for item 48171 on
                    // WO11461 — a bracket that left the BOM months ago.
                    //
                    // Two things this refuses to do:
                    //   • touch a HAND-ADDED pin — only `syncedFromErp` ones are ours to remove;
                    //     someone's manual BOM line is not NetSuite's to overwrite.
                    //   • prune on an EMPTY read — a join that returns no components is far more
                    //     likely a bad query than a genuinely emptied BOM, and wiping a live BOM is
                    //     not recoverable from this screen. Stale pins are the safer failure.
                    if (physicalComponents.length > 0) {
                        try {
                            const keep = new Set(physicalComponents.map(c => `PIN-${docId}-${c.internalId}`));
                            const existingPins = await getDocs(query(collection(db, 'assembly_pins'), where('assemblyId', '==', docId)));
                            existingPins.forEach(d => {
                                const pin = d.data() || {};
                                if (!pin.syncedFromErp) return;          // hand-added — leave it alone
                                if (keep.has(d.id)) return;              // still in NetSuite's BOM
                                batch.delete(d.ref);
                                prunedPins++;
                                prunedDetail.push(`${item.itemid}: ${pin.partId || d.id}`);
                            });
                        } catch (pruneErr) {
                            addLog(`⚠ Could not check ${item.itemid} for dropped BOM lines (${pruneErr.message || pruneErr}) — its components were updated, but stale ones may remain.`, 'warn');
                        }
                        await batch.commit();
                    }
                }

                successCount++;
            }

            addLog(`✅ Successfully synced and mapped ${successCount} library items. App structure preserved.`, 'success');
            if (prunedPins > 0) {
                addLog(`🧹 Removed ${prunedPins} BOM line(s) NetSuite no longer carries: ${prunedDetail.slice(0, 12).join(' · ')}${prunedDetail.length > 12 ? ` …+${prunedDetail.length - 12} more` : ''}. Hand-added lines were left untouched.`, 'success');
            }
            addLog(`🏷️ Flagged ${stockedCount} STOCKED (custitem27), ${inHouseCount} IN-HOUSE (custitem26), ${oldCount} OLD/hidden (custitem28)${hasTempField ? `, ${tempCount} ⏳TEMP (custitem_app_temp)` : ''} of ${successCount} items.`, stockedCount > 0 ? 'success' : 'info');

        } catch (err) {
            console.error(err);
            addLog(`❌ FAILED: ${err.message}`, 'error');
        }
        setIsSyncing(false);
    };

    // --- APP → NETSUITE WRITE-BACK (v1: App is master for the core curated fields) ---
    const restPatch = async (recordType, nsId, payload) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}/${nsId}`;
        const response = await nsProxyFetch({ targetUrl, method: 'PATCH', payload });
        const result = await response.json().catch(() => ({}));
        return { ok: response.ok, result };
    };
    const restPost = async (recordType, payload) => {
        const targetUrl = `https://3728153.suitetalk.api.netsuite.com/services/rest/record/v1/${recordType}`;
        const response = await nsProxyFetch({ targetUrl, method: 'POST', payload });
        const result = await response.json().catch(() => ({}));
        return { ok: response.ok, result };
    };
    const suiteqlQuery = async (q) => {
        const response = await nsProxyFetch({ targetUrl: 'https://3728153.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql', method: 'POST', payload: { q } });
        const result = await response.json().catch(() => ({}));
        return response.ok ? (result.items || []) : null;
    };

    const handlePushItemsToNetSuite = async () => {
        const enabled = PUSH_FIELDS.filter(f => pushFlags[f.key]);
        if (!enabled.length) return alert('Nothing is ticked on the ⬆ Push card — choose at least one field to write.');
        const enabledFlags = Object.keys(NS_FLAG_FIELDS).filter(k => pushFlags[k]);
        const coreEnabled = enabled.some(f => !f.flag);
        const scopeTerms = parseScope(itemScope);
        setIsSyncing(true);
        addLog(`Initiating App → NetSuite write-back for ${String(activeBrand || '').toUpperCase()}...`, 'info');
        try {
            const snap = await getDocs(collection(db, "Approved_Designs"));
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                // Aliases are app-only pointers (alternate id/name/price over a main item) — they
                // must NEVER write back to NetSuite even if someone stamps an internal id on one.
                .filter(p => (p.brandId === activeBrand || (p.sharedBrands || []).includes(activeBrand)) && p.netSuiteInternalId && !(p.manufacturingSpecs?.aliasOf || p.aliasOf))
                .filter(p => scopeHit(p.legacyErpId || p.itemId, scopeTerms));
            if (items.length === 0) { addLog(scopeTerms.length ? `No mapped items match the item-# scope (${scopeLabel(scopeTerms)}).` : "No mapped items (with a NetSuite Internal ID) for this brand. Sync from ERP / set the ID first.", 'warn'); setIsSyncing(false); return; }
            if (scopeTerms.length) addLog(`Item scope active — ${items.length} item(s) where the item # is ${scopeLabel(scopeTerms)}.`, 'warn');

            // ⚖ FLAG DIFF BEFORE ANY WRITE. custitem26/27/28 are checkboxes — pushing them blind
            // could silently CLEAR a flag on hundreds of NetSuite items because the app's copy is
            // stale. So read NetSuite's current values first and show exactly what changes, in both
            // directions, before asking. It also lets a flag-only run skip every item that already
            // agrees, instead of PATCHing the whole catalog.
            const nsBoolOf = (v) => v === true || v === 'T' || v === 't' || v === 'true' || v === 1 || v === '1';
            const nsFlagById = {};
            if (enabledFlags.length) {
                addLog(`Reading current ${enabledFlags.map(k => NS_FLAG_FIELDS[k]).join(' / ')} values from NetSuite for ${items.length} item(s)…`, 'info');
                const ids = items.map(p => String(p.netSuiteInternalId)).filter(Boolean);
                for (let i = 0; i < ids.length; i += 400) {
                    const rows = await suiteqlQuery(`SELECT id, custitem26, custitem27, custitem28 FROM item WHERE id IN (${ids.slice(i, i + 400).join(',')})`);
                    (rows || []).forEach(r => { nsFlagById[String(r.id)] = r; });
                }
                // Read failed entirely → we have no idea what NetSuite currently holds, and pushing a
                // checkbox blind can un-tick hundreds of items. Stop rather than guess.
                if (Object.keys(nsFlagById).length === 0) {
                    addLog('❌ Could not read the current custitem26/27/28 values from NetSuite — flags NOT pushed (a blind checkbox push could un-tick items). Un-tick the flags to push the other fields, or retry.', 'error');
                    alert('Could not read the current flag values from NetSuite, so nothing was written.\n\nPushing a checkbox without knowing its current value risks un-ticking items in bulk. Retry, or un-tick the three custitem flags to push the other fields only.');
                    setIsSyncing(false); return;
                }
            }
            const flagDelta = (p, k) => {
                const row = nsFlagById[String(p.netSuiteInternalId)];
                if (!row) return null;                                   // unknown in NetSuite — don't claim a change
                const want = !!(p.manufacturingSpecs || {})[k];
                const have = nsBoolOf(row[NS_FLAG_FIELDS[k]]);
                return want === have ? 'same' : (want ? 'set' : 'clear');
            };
            const flagLines = enabledFlags.map(k => {
                let set = 0, clear = 0, same = 0, unknown = 0;
                items.forEach(p => { const d = flagDelta(p, k); if (d === 'set') set++; else if (d === 'clear') clear++; else if (d === 'same') same++; else unknown++; });
                addLog(`  ${NS_FLAG_FIELDS[k]} (${k}): ${set} to SET, ${clear} to CLEAR, ${same} already match${unknown ? `, ${unknown} not found in NetSuite` : ''}.`, clear ? 'warn' : 'info');
                return `• ${NS_FLAG_FIELDS[k]} — ${k}:  ${set} will be TICKED,  ${clear} will be UN-TICKED,  ${same} already match`;
            });
            const changed = enabledFlags.length && !coreEnabled
                ? items.filter(p => enabledFlags.some(k => { const d = flagDelta(p, k); return d === 'set' || d === 'clear'; })).length
                : items.length;
            if (!window.confirm(`Push ${String(activeBrand || '').toUpperCase()} → NetSuite\n\nFields: ${enabled.map(f => f.label).join(', ')}\n\n${flagLines.length ? flagLines.join('\n') + '\n\n' : ''}${changed} of ${items.length} mapped item(s) will be written.\n\nThis OVERWRITES those fields on NetSuite. Tip: test ONE item via the Library's per-item push first.`)) { setIsSyncing(false); return; }
            addLog(`Found ${items.length} mapped item(s). Writing back...`, 'info');

            let updated = 0, coreOnly = 0, failed = 0, skipped = 0;
            for (const p of items) {
                const specs = p.manufacturingSpecs || {};
                const full = {};
                if (pushFlags.itemid && p.legacyErpId && p.legacyErpId !== 'PENDING') full.itemid = p.legacyErpId;
                if (pushFlags.displayname && p.itemName) full.displayname = p.itemName;
                if (pushFlags.basePrice) { const bpv = parseFloat(specs.basePrice); if (specs.basePrice !== undefined && specs.basePrice !== '' && !isNaN(bpv)) full.custitem9 = bpv; }
                if (pushFlags.weight) { const wv = parseFloat(specs.weight); if (specs.weight !== undefined && specs.weight !== '' && !isNaN(wv)) full.weight = wv; }
                // Checkbox flags are sent as real booleans (SuiteQL reports them as 'T'/'F', the REST
                // record API takes true/false).
                let flagChange = false;
                enabledFlags.forEach(k => {
                    const d = flagDelta(p, k);
                    if (d === null) return;                              // not in NetSuite — nothing to write onto
                    full[NS_FLAG_FIELDS[k]] = !!specs[k];
                    if (d !== 'same') flagChange = true;
                });
                // A flags-only run touches ONLY the items that actually disagree.
                if (!coreEnabled && !flagChange) { skipped++; continue; }
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
            addLog(`✅ Write-back done: ${updated} updated${coreOnly ? ` (${coreOnly} core-only after a field was dropped)` : ''}${skipped ? `, ${skipped} skipped (flags already match)` : ''}, ${failed} failed.`, failed ? 'warn' : 'success');

            // --- UNMAPPED items: MERGE-or-CREATE (never duplicate) ---
            // Items with a real item # but no NetSuite link: (1) look up the EXACT itemid in NetSuite —
            // if it exists, just LINK it (store the internal id; no duplicate created); (2) if it
            // doesn't exist, CREATE it (Inventory items only) and store the new internal id.
            const unmapped = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                .filter(p => (p.brandId === activeBrand || (p.sharedBrands || []).includes(activeBrand))
                    && !p.netSuiteInternalId
                    && p.legacyErpId && p.legacyErpId !== 'PENDING' && p.legacyErpId !== 'N/A')
                .filter(p => scopeHit(p.legacyErpId, scopeTerms));   // a scoped run never creates items outside it
            const unmappedAsm = unmapped.filter(p => p.partClass !== 'Inventory').length;
            if (unmapped.length && window.confirm(`${unmapped.length} item(s) have an item # but NO NetSuite link.\n\nProcess them now? Exact item-id matches in NetSuite are LINKED (merged — never duplicated); the rest are CREATED as new NetSuite items carrying the full field set from Eric's sheet (form, class, location, costing, UOM, collection/watchlist/product type, vendor + pricing sublists, and custitem_sync_to_cpq so they sync back).${unmappedAsm ? `\n\n⚠ ${unmappedAsm} of them are ASSEMBLIES. They will be created as assembly items WITHOUT a bill of materials — NetSuite has no way to build them until someone adds the BOM there.` : ''}`)) {
                let linked = 0, created = 0, skipped = 0, cfailed = 0;
                const subId = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || '2';
                const locId = BRAND_NETSUITE_MAP[activeBrand]?.location || '';
                for (const p of unmapped) {
                    const code = String(p.legacyErpId).toUpperCase().replace(/'/g, "''");
                    const rows = await suiteqlQuery(`SELECT id, itemid FROM item WHERE UPPER(itemid) = '${code}'`);
                    if (rows === null) { cfailed++; addLog(`  ✗ ${p.legacyErpId}: NetSuite lookup failed — skipped.`, 'error'); continue; }
                    if (rows.length) {
                        await setDoc(doc(db, "Approved_Designs", p.id), { netSuiteInternalId: String(rows[0].id) }, { merge: true });
                        linked++; addLog(`  ⛓ ${p.legacyErpId}: exists in NetSuite (id ${rows[0].id}) — LINKED, no duplicate.`, 'success');
                        continue;
                    }
                    // FULL FIELD SET (2026-08-15, Eric's Items_NS sheet). This used to post four
                    // fields — itemid, displayname, subsidiary, custitem9 — which produced an item
                    // NetSuite couldn't cost, locate, classify or buy, and which (missing
                    // custitem_sync_to_cpq) never came back on any later sync.
                    const recordType = (p.partClass === 'Inventory') ? 'inventoryitem' : 'assemblyitem';
                    const built = buildNsItemBody(p, { recordType, subsidiary: subId, location: locId });
                    let body = built.body;
                    let { ok, result } = await restPost(recordType, body);
                    // A create is all-or-nothing, so one field this account spells differently would
                    // otherwise cost the item entirely. Peel the optional groups off in order and
                    // say which one NetSuite refused — that message is the diagnosis.
                    const dropped = [];
                    let lastErr = result;   // the refusal that CAUSED each peel — `result` becomes the success body
                    for (const block of built.blocks) {
                        if (ok) break;
                        const cur = body;
                        if (!block.keys.some(k => k in cur)) continue;
                        const next = { ...cur };
                        block.keys.forEach(k => delete next[k]);
                        body = next;
                        dropped.push(block.name);
                        lastErr = result;
                        ({ ok, result } = await restPost(recordType, next));
                    }
                    // Last resort: the shape variation that has historically bitten this call.
                    if (!ok && /subsidiary/i.test(JSON.stringify(result))) { lastErr = result; ({ ok, result } = await restPost(recordType, { ...body, subsidiary: { id: subId } })); }
                    if (ok && dropped.length) addLog(`  ⚠ ${p.legacyErpId}: NetSuite refused ${dropped.join(', then ')} — item created WITHOUT ${dropped.length === 1 ? 'that' : 'those'}. Its complaint: ${nsErrDetail(JSON.stringify(lastErr)).slice(0, 200)}`, 'warn');
                    if (ok) {
                        // REST POST returns the new record; re-look up by itemid when the id isn't echoed.
                        let newId = result?.id;
                        if (!newId) { const back = await suiteqlQuery(`SELECT id FROM item WHERE UPPER(itemid) = '${code}'`); newId = back?.[0]?.id; }
                        if (newId) await setDoc(doc(db, "Approved_Designs", p.id), { netSuiteInternalId: String(newId), netSuiteRecordType: recordType }, { merge: true });
                        created++; addLog(`  ＋ ${p.legacyErpId}: CREATED in NetSuite as ${recordType}${newId ? ` (id ${newId})` : ''}${recordType === 'assemblyitem' ? ' — no BOM; add its components in NetSuite' : ''}.`, 'success');
                    } else {
                        cfailed++; addLog(`  ✗ ${p.legacyErpId}: create failed even after dropping ${dropped.length ? dropped.join(', ') : 'nothing optional'} — ${nsErrDetail(JSON.stringify(result)).slice(0, 240)}`, 'error');
                    }
                }
                addLog(`✅ Merge-or-create done: ${linked} linked (existing), ${created} created, ${skipped} skipped, ${cfailed} failed.`, cfailed ? 'warn' : 'success');
            }
        } catch (e) { console.error(e); addLog(`❌ Write-back failed: ${e.message}`, 'error'); }
        setIsSyncing(false);
    };

    // FABRICUT RETURN-FEE SEEDER v2 (Stuart 2026-07-13): ONE record per fee — painted/plated tier
    // prices live on the base doc exactly like the mill-base items (paintedCost / platedCost); the
    // finish chosen on the End Treatment step picks the tier at quote time. French $35/P · $43/EP;
    // miter $40/P · $48/EP (CE → Fabricut). Backplate included (RBP at 3/4", standard BP at
    // 1"/1-3/8"); coverplate upcharges ride the CP items like any bracket. customData.feeType is
    // what the flow generator links onto the return options on Regenerate. Re-runnable: existing
    // base docs get their pricing refreshed; v1's separate /P //EP sibling docs are removed.
    const handleSeedFabricutFees = async () => {
        try {
            addLog('Seeding Fabricut return-fee items…', 'info');
            const crmSnap = await getDocs(collection(db, 'crm_records'));
            const fabCust = crmSnap.docs.map(d => ({ id: d.id, ...d.data() })).find(r => r.type === 'CUSTOMER' && /fabricut/i.test(String(r.name || '')));
            if (!fabCust) { addLog('❌ No CRM customer matching "Fabricut" — run Sync Active Customers first, then re-run.', 'error'); return; }
            const PRICED_WITH = 'Includes the backplate (RBP at 3/4", standard BP at 1"/1-3/8"). Coverplate upgrade prices like any bracket (+$10 cost / +$40 retail).';
            const FEES = [
                { base: 'CE-FEE-H1FR', name: 'H1 French Return Fee', feeType: 'FRENCH_RETURN', p: 35, ep: 43 },
                { base: 'CE-FEE-H1MTR', name: 'H1 Miter Return Fee', feeType: 'MITER_RETURN', p: 40, ep: 48 },
            ];
            let made = 0, updated = 0, removed = 0;
            for (const fee of FEES) {
                const id = fee.base.replace(/[^A-Za-z0-9-]/g, '_');
                const ref = doc(db, 'Approved_Designs', id);
                const existing = await getDoc(ref);
                await setDoc(ref, {
                    id, brandId: 'ce', partClass: 'Inventory', productType: 'FEE',
                    itemName: fee.name, legacyErpId: fee.base, sharedBrands: ['ce'],
                    // Single per-customer row (client pricing carries ONE value — the painted fee);
                    // the painted/plated split is the FAB COST level's job via the tier fields below.
                    clientPricing: [{ customerId: fabCust.id, clientSku: '', price: fee.p, clientSalesPrice: '', source: 'FABRICUT' }],
                    manufacturingSpecs: {
                        productType: 'FEE', partHandling: '', basePrice: '',
                        customData: { feeType: fee.feeType },
                        fabricut: { paintedCost: fee.p, platedCost: fee.ep, pricedWith: PRICED_WITH, source: 'FEE_SEEDER', importedAt: new Date().toISOString() }
                    },
                    ...(existing.exists() ? {} : { createdAt: new Date().toISOString(), createdBy: 'FEE_SEEDER' })
                }, { merge: true });
                if (existing.exists()) { updated++; addLog(`⟳ ${fee.base} refreshed — painted $${fee.p} / plated $${fee.ep} (${fabCust.name})`, 'success'); }
                else { made++; addLog(`＋ ${fee.base} — painted $${fee.p} / plated $${fee.ep} (${fabCust.name})`, 'success'); }
                // v1 seeded separate /P and /EP sibling docs — the tiers live on the base now.
                for (const sfx of ['P', 'EP']) {
                    const vid = `${fee.base}/${sfx}`.replace(/[^A-Za-z0-9-]/g, '_');
                    const vref = doc(db, 'Approved_Designs', vid);
                    const vsnap = await getDoc(vref);
                    if (vsnap.exists()) { await deleteDoc(vref); removed++; addLog(`− removed ${fee.base}/${sfx} (tier prices now live on ${fee.base})`, 'warn'); }
                }
            }
            addLog(`✅ Fee seeding done: ${made} created, ${updated} refreshed, ${removed} v1 variant doc(s) removed. NOW: System Admin → CPQ Flows → Regenerate the Fabricut H1 flow, then verify a french return prices $35 with a painted finish / $43 with a plated finish at FAB COST.`, 'success');
        } catch (e) { console.error(e); addLog(`❌ Fee seeding failed: ${e.message}`, 'error'); }
    };

    // FABRICUT IMPORT: upload Fabricut_CE_CrossReference.xlsx → stamp Fabricut retail/cost pricing
    // + sizeKey metadata onto EXISTING library items, matched by CE item # (base + every finish
    // variant). Never creates items and never touches names/dims/basePrice — run "Sync Master
    // Library" first so all H1 items exist here (they're flagged custitem_sync_to_cpq in NetSuite).
    // Idempotent: re-run any time Stuart extends the workbook (poles/finials/rings rows to come).
    // TARGETED PREMIUM-TIER REPAIR (Stuart 2026-07-29: "a targeted repair will be best if possible").
    // The old importer stamped every /P25 variant with PAINTED prices because its plated test was a
    // "starts with EP" check. Re-importing the workbook would fix them, but it rewrites thousands of
    // untouched docs; this rewrites ONLY the docs that are provably wrong, reading the plated tier
    // already stored on their own base doc — so it needs no spreadsheet and can be run any time.
    // Two passes on purpose: a DRY RUN that prints the plan to the terminal, then the write.
    const handleRepairPremiumTiers = async () => {
        setIsSyncing(true);
        addLog('🔧 Scanning for finish variants stamped with the wrong (painted) tier…', 'info');
        try {
            const [snap, finSnap] = await Promise.all([
                getDocs(collection(db, 'Approved_Designs')),
                getDocs(collection(db, 'hq_outsource_finishes')),
            ]);
            const outsourceCodes = finSnap.docs.map(d => d.data()).filter(f => f.code || f.name);
            const docs = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .filter(d => d.brandId === activeBrand || (d.sharedBrands || []).includes(activeBrand))
                .map(d => ({ docId: d.id, code: String(d.legacyErpId || d.itemId || '').toUpperCase(), fab: d.manufacturingSpecs?.fabricut || null }));
            const plan = buildPremiumTierRepairPlan(docs, outsourceCodes, Date.now());

            if (!plan.repairs.length) {
                addLog(`✅ Nothing to repair — ${plan.stats.scanned} docs scanned, every outsourced-finish variant already carries its plated tier.`, 'success');
                addLog(`   (skipped: ${plan.skipped.alreadyCorrect} already correct · ${plan.skipped.notPaintedValues} hand-edited · ${plan.skipped.noPlatedTier} base has no plated tier · ${plan.skipped.noBaseDoc} no base doc)`, 'info');
                setIsSyncing(false); return;
            }
            // Dry run to the terminal FIRST — every line, so the whole change set is readable before
            // a single write and there is a record of it afterwards.
            plan.repairs.forEach(r => addLog(
                `   ${r.code}  ${r.reason === 'TIER_LABEL_ONLY' ? 'tier label P → EP (prices already right)' :
                    `cost ${r.from.cost ?? '—'} → ${r.to.cost ?? '—'} · wholesale ${r.from.wholesale ?? '—'} → ${r.to.wholesale ?? '—'} · retail ${r.from.retail ?? '—'} → ${r.to.retail ?? '—'}`}`, 'warn'));
            addLog(`🔧 ${plan.repairs.length} doc(s) to repair — ${plan.stats.valueFixes} with wrong PRICES, ${plan.repairs.length - plan.stats.valueFixes} tier-label only.`, 'warn');
            addLog(`   Left alone: ${plan.skipped.alreadyCorrect} already correct · ${plan.skipped.notPaintedValues} hand-edited (values match neither tier) · ${plan.skipped.noPlatedTier} base carries no plated tier · ${plan.skipped.noBaseDoc} no base doc.`, 'info');

            if (!window.confirm(`Repair ${plan.repairs.length} finish variant(s)?\n\n• ${plan.stats.valueFixes} carry PAINTED prices and should be PREMIUM (e.g. /P25)\n• ${plan.repairs.length - plan.stats.valueFixes} only have the wrong tier label\n\nEach one is rewritten from the plated tier already on its own base item. The full list is in the terminal.\n\nItems whose numbers were edited by hand are NOT touched (${plan.skipped.notPaintedValues} of those).`)) {
                addLog('Repair cancelled — nothing written.', 'info'); setIsSyncing(false); return;
            }
            let done = 0;
            for (let i = 0; i < plan.stamps.length; i += 400) {
                const batch = writeBatch(db);
                plan.stamps.slice(i, i + 400).forEach(st => batch.set(doc(db, 'Approved_Designs', st.docId), st.patch, { merge: true }));
                await batch.commit();
                done += Math.min(400, plan.stamps.length - i);
                addLog(`  …${done}/${plan.stamps.length} repaired`, 'info');
            }
            addLog(`✅ Premium-tier repair complete: ${done} doc(s) now priced off the plated tier. Re-run any time — it is a no-op once clean.`, 'success');
        } catch (e) { console.error(e); addLog(`❌ Repair failed: ${e.message}`, 'error'); }
        setIsSyncing(false);
    };

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

            // The PREMIUM tier follows the configured outsourced finishes, not an "EP" prefix —
            // /P25 is plated and used to be stamped with painted prices (Stuart 2026-07-29).
            const finSnap = await getDocs(collection(db, 'hq_outsource_finishes'));
            const outsourceCodes = finSnap.docs.map(d => d.data()).filter(f => f.code || f.name);
            const plan = buildFabricutPlan(rows, libIndex, Date.now(), outsourceCodes);
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

            {/* NETSUITE SYNC QUEUE (Layer 2, 2026-07-16): staged writes (ns_outbox) drained ~1/min
                by the nsOutboxWorker function — serial, retried with backoff, idempotent. This is
                the live monitor: retry FAILED entries after fixing data; ✕ cancels an un-posted one. */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px' }}>
                <div style={{ padding: '14px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>NetSuite Sync Queue</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>
                        {outbox.filter(o => o.status === 'PENDING').length} pending · {outbox.filter(o => o.status === 'PROCESSING').length} posting · {outbox.filter(o => o.status === 'FAILED').length} failed — drains ~1/min, retries automatically
                    </span>
                </div>
                {outbox.length === 0 ? (
                    <div style={{ padding: '14px 24px', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Queue is empty — staged pushes (e.g. RTG purchase orders) appear here with live status.</div>
                ) : (
                    <div style={{ maxHeight: '260px', overflowY: 'auto' }}>
                        {outbox.map(o => (
                            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 24px', borderTop: '1px solid var(--paper-2)', fontFamily: 'var(--sans)', fontSize: '0.85rem' }}>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', padding: '3px 8px', whiteSpace: 'nowrap', border: '1px solid', borderColor: o.status === 'POSTED' ? '#3a7d44' : o.status === 'FAILED' ? '#d9534f' : 'var(--brass)', color: o.status === 'POSTED' ? '#3a7d44' : o.status === 'FAILED' ? '#d9534f' : 'var(--brass)' }}>{o.status}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }} title={o.lastError || ''}>{o.label || o.kind}{o.nsTran ? ` → ${o.nsTran}` : ''}{o.status === 'FAILED' && o.lastError ? ` — ${nsErrDetail(o.lastError).slice(0, 140)}` : ''}</span>
                                <span title={String(o.targetUrl || '')} style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{o.createdBy || ''}{o.createdAt ? ` · ${new Date(o.createdAt).toLocaleTimeString()}` : ''}{o.attempts ? ` · try ${o.attempts}` : ''}</span>
                                {(o.status === 'FAILED' || o.status === 'CANCELLED') && (
                                    <button onClick={() => updateDoc(doc(db, 'ns_outbox', o.id), { payload: healOutboxPayload(o), targetUrl: healOutboxUrl(o), status: 'PENDING', lastError: null, nextAttemptAt: Date.now(), requeuedAt: Date.now(), requeuedBy: currentUser || '' })} title="Retries with known fixes applied. Attempts are KEPT so the worker first checks NetSuite for an already-posted copy (marker recovery) — hitting Retry can never double-post." style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>↻ Retry</button>
                                )}
                                {(o.status === 'PENDING' || o.status === 'FAILED') && (
                                    <button onClick={() => { if (window.confirm(`Cancel "${o.label || o.kind}"? It will NOT be posted to NetSuite.`)) updateDoc(doc(db, 'ns_outbox', o.id), { status: 'CANCELLED' }); }} style={{ padding: '4px 10px', background: 'transparent', border: '1px solid #d9534f', color: '#d9534f', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>✕</button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
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

                    {/* ITEM SCOPE — narrows the item sync AND the write-back to a slice of the
                        catalog, so a repair run touches only what you meant to fix. */}
                    {(() => {
                        const terms = parseScope(itemScope);
                        return (
                            <div style={{ background: terms.length ? 'rgba(176,141,87,.10)' : 'var(--paper-2)', border: `1px solid ${terms.length ? 'var(--brass)' : 'var(--line)'}`, padding: '20px', borderRadius: '2px' }}>
                                <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Item # scope <span style={{ color: 'var(--ink-soft)' }}>— applies to the item sync AND the write-back below</span></label>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input
                                        value={itemScope}
                                        onChange={e => setItemScope(e.target.value)}
                                        placeholder="Blank = whole catalog · e.g.  H1-  ·  H1-,H2-  ·  H1-1BE..H1-9"
                                        style={{ flex: 1, padding: '12px', border: `1px solid ${terms.length ? 'var(--brass)' : 'var(--line)'}`, boxSizing: 'border-box', fontFamily: 'var(--mono)', fontSize: '0.95rem', textTransform: 'uppercase', outline: 'none', background: '#fff' }}
                                    />
                                    {itemScope && <button onClick={() => setItemScope("")} style={{ padding: '0 16px', background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>✕ Clear</button>}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: terms.length ? 'var(--ink)' : 'var(--ink-soft)', margin: '8px 0 0 0' }}>
                                    {terms.length
                                        ? <>⚠ SCOPED — only items whose item # is <strong>{scopeLabel(terms)}</strong> will be pulled or pushed. Everything else is untouched. BOM components outside the scope still resolve from items already in the library.</>
                                        : <>Whole catalog. Comma-separate several terms, or use <code>A..B</code> for an item-# range. Not remembered between visits — a saved scope would silently narrow someone's next full sync.</>}
                                </p>
                            </div>
                        );
                    })()}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {/* ERIC'S "SYNC TO APP" GATE (custentity18, 2026-08-14). Deliberately opt-in:
                            he has tagged the prominent vendors and select CE customers but NOT the
                            M2C customers, so switching this on globally would empty their lists. */}
                        <label title="Only pull Customers/Vendors ticked 'Sync to App' (custentity18) in NetSuite — Eric's field for keeping app lists and searches free of records nobody here needs."
                            style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '10px 12px', cursor: isSyncing ? 'default' : 'pointer', border: `1px solid ${syncOnlyFlagged ? 'var(--brass)' : 'var(--line)'}`, background: syncOnlyFlagged ? '#fdfaf3' : '#fff' }}>
                            <input type="checkbox" checked={syncOnlyFlagged} disabled={isSyncing} onChange={e => setSyncGate(e.target.checked)} style={{ cursor: 'pointer', marginTop: '2px' }} />
                            <span>
                                <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em', color: syncOnlyFlagged ? 'var(--brass)' : 'var(--ink-soft)', fontWeight: syncOnlyFlagged ? 700 : 400 }}>Only “Sync to App” records · custentity18</span>
                                <span style={{ display: 'block', fontSize: '11px', color: 'var(--ink-soft)', marginTop: '3px', lineHeight: 1.45 }}>
                                    {syncOnlyFlagged
                                        ? 'ON — Customer and Vendor syncs pull only the ticked records. Records already in the app stay; this only stops new pulls bringing untagged ones back. A run that would import ZERO stops and says so.'
                                        : 'OFF — every active Customer / Vendor is pulled, as before. Turn on once the flag is ticked in NetSuite for everyone you need (M2C customers were still untagged as of 8/14).'}
                                </span>
                            </span>
                        </label>
                        <SyncButton onClick={handleSyncCustomers} disabled={isSyncing} label="Sync Active Customers" sub="SuiteQL: Pulls all active customers mapped to Subsidiary." />
                        <SyncButton onClick={handleSyncAddresses} disabled={isSyncing} label="Sync Customer Address Books" sub="SuiteQL: Pulls address books and maps IDs." />
                        <SyncButton onClick={handleSyncVendors} disabled={isSyncing} label="Sync Active Vendors" sub="SuiteQL: Pulls all active external vendors/co-ops." />
                        <SyncButton onClick={handleSyncItems} disabled={isSyncing} label="Sync Master Library (Items, Kits & BOMs)" sub="SuiteQL: Single-pass sync. Pulls all Inventory, Assemblies, active BOM Revisions, and component mappings." />
                        <SyncButton onClick={handleForcePoleTags} disabled={isSyncing || poleFixBusy} label="🪝 Force Pole / Rod Tags" sub="Every item categorised POLE or ROD gets Finish Stream = POLES and Part Handling = Small Parts (stocked). Repairs open finishing work orders too, so orders already on the floor run the pole recipe. Explicit SMALL is never overridden. Cancel at the prompt for a dry run." />
                        <SyncButton onClick={handleStampItemCodes} disabled={isSyncing || stampBusy} label="🪪 Stamp Canonical Item Codes" sub="Backfills `itemCode` onto every existing work order (hq + finishing, parked payloads included) using the same resolver every screen reads. Orders whose identity can't be resolved are reported, never guessed. Cancel at the prompt for a dry run." />
                        <FieldFlags
                            title="NetSuite may overwrite…"
                            note="Ticked = NetSuite wins on items the app already has. Un-tick a field to freeze the app's value through this import. New items always take everything — there's nothing to overwrite on a first import. Item name, category and routing type are always app-master."
                            fields={PULL_FIELDS} flags={pullFlags} disabled={isSyncing}
                            onToggle={(k, v) => saveSyncFlags({ ...pullFlags, [k]: v }, pushFlags)}
                            onAll={(v) => saveSyncFlags(PULL_FIELDS.reduce((a, f) => ({ ...a, [f.key]: v }), {}), pushFlags)}
                        />
                        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0', paddingTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)' }}>App → NetSuite (write-back)</div>
                        <SyncButton onClick={handlePushItemsToNetSuite} disabled={isSyncing} label="⬆ Push Items → NetSuite (App is master)" sub="REST PATCH: writes the ticked fields onto matched NetSuite items (by Internal ID). Tolerant — record-type + field-drop retries; one row can't halt the run. The custitem flags are counted against NetSuite's current values and shown before anything is written." />
                        <FieldFlags
                            title="Write to NetSuite…"
                            note="The three custitem flags are the ones that only ever came DOWN before — Stocked (custitem27) is what the Stock View snapshot is built on, so correcting it in the app alone changed nothing. Tick it here to push the truth up. You'll see how many get ticked and how many get UN-ticked before it writes, and a flags-only run touches only the items that disagree."
                            fields={PUSH_FIELDS} flags={pushFlags} disabled={isSyncing}
                            onToggle={(k, v) => saveSyncFlags(pullFlags, { ...pushFlags, [k]: v })}
                            onAll={(v) => saveSyncFlags(pullFlags, PUSH_FIELDS.reduce((a, f) => ({ ...a, [f.key]: v }), {}))}
                        />
                        <div style={{ borderTop: '1px dashed var(--line)', margin: '6px 0', paddingTop: '6px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--brass)' }}>Fabricut</div>
                        <label style={{ padding: '20px', textAlign: 'left', cursor: isSyncing ? 'wait' : 'pointer', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: '6px', opacity: isSyncing ? 0.6 : 1 }}
                            onMouseOver={(e) => { if (!isSyncing) e.currentTarget.style.borderColor = 'var(--brass)'; }}
                            onMouseOut={(e) => { if (!isSyncing) e.currentTarget.style.borderColor = 'var(--line)'; }}>
                            <span style={{ fontFamily: 'var(--sans)', fontSize: '1rem', fontWeight: 500 }}>⬆ Import Fabricut Pricing (.xlsx)</span>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>Upload Fabricut_CE_CrossReference.xlsx — stamps Fabricut Retail + CE Cost onto every matching library item and finish variant (by CE item #), plus the size keys the H1 size-matrix flows resolve through. Run "Sync Master Library" first; re-run any time the workbook grows. Never touches names, dims or Base Price.</span>
                            <input type="file" accept=".xlsx" disabled={isSyncing} style={{ display: 'none' }} onChange={e => { handleFabricutImport(e.target.files[0]); e.target.value = ''; }} />
                        </label>
                        <SyncButton onClick={handleRepairPremiumTiers} disabled={isSyncing} label="🔧 Repair Premium-Tier Prices (/P25)" sub="Finds finish variants stamped with the PAINTED tier that are actually outsourced/plated — the old importer's EP-prefix rule missed /P25. Rewrites each from the plated tier already on its own base item; prints the full list before writing and never touches hand-edited numbers. Safe to re-run — a no-op once clean." />
                        <SyncButton onClick={handleSeedFabricutFees} disabled={isSyncing} label="✂ Seed H1 Return-Fee Items" sub="ONE record per fee, like every item: french ($35 painted · $43 plated) & miter ($40 · $48) with the tier prices on the base doc + a Fabricut client row — backplate included, CP upcharge rides the plates. Re-runnable (refreshes prices, removes the old /P //EP siblings). Then Regenerate the H1 flow to link them." />
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

// Per-field direction control sitting directly under the button it governs, so what a sync will
// overwrite is readable before you press it rather than discovered afterwards. A flag with a
// custitem number is a NetSuite checkbox field; the rest are plain values.
const FieldFlags = ({ title, note, fields, flags, onToggle, onAll, disabled }) => {
    const on = fields.filter(f => flags[f.key]).length;
    return (
        <div style={{ border: '1px solid var(--line)', borderTop: 'none', background: 'var(--paper-2)', padding: '14px 18px', marginTop: '-12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{title} <span style={{ color: on ? 'var(--ink)' : '#d9534f' }}>({on}/{fields.length})</span></span>
                <span style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={() => onAll(true)} disabled={disabled} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '3px 8px', cursor: disabled ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>All</button>
                    <button onClick={() => onAll(false)} disabled={disabled} style={{ background: 'transparent', border: '1px solid var(--line)', color: 'var(--ink-soft)', padding: '3px 8px', cursor: disabled ? 'wait' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase' }}>None</button>
                </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '4px 14px' }}>
                {fields.map(f => (
                    <label key={f.key} title={f.flag ? 'A NetSuite checkbox field — pushing it can un-tick it too, so the counts are shown first' : ''} style={{ display: 'flex', alignItems: 'center', gap: '7px', cursor: disabled ? 'wait' : 'pointer', fontFamily: 'var(--sans)', fontSize: '0.82rem', color: flags[f.key] ? 'var(--ink)' : 'var(--ink-soft)', padding: '2px 0' }}>
                        <input type="checkbox" checked={!!flags[f.key]} disabled={disabled} onChange={e => onToggle(f.key, e.target.checked)} style={{ cursor: disabled ? 'wait' : 'pointer', flexShrink: 0 }} />
                        <span style={{ borderBottom: f.flag ? '1px dotted var(--brass)' : 'none' }}>{f.label}</span>
                    </label>
                ))}
            </div>
            <div style={{ fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '0.82rem', color: 'var(--ink-soft)', marginTop: '10px', lineHeight: 1.5 }}>{note}</div>
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