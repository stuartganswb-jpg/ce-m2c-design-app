import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { classifyLine, DIVISION_CUSTOM } from '../Shared/lineClassification';
import { makeFullTasks } from '../Shared/workOrderContract';

// Pull the real, classifiable order lines out of a CPQ job (skip the ▶ assembly headers).
const getJobLines = (job) => (job?.cpqData?.breakdown || []).filter(l => l && !l.isHeader);

// Strip the "  - " display prefix CPQTab adds when merging cart lines.
const cleanLineName = (name) => String(name || '').replace(/^\s*[-▶]\s*/, '').trim();

const BRAND_NETSUITE_MAP = {
    'm2c': { subsidiary: "3" },
    'uniquity': { subsidiary: "6" },
    'ce': { subsidiary: "2" },
    'leyla': { subsidiary: "5" }
};
const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

const RTGDispatchTab = ({ currentUser, activeBrand }) => {
    const [salesOrders, setSalesOrders] = useState([]);
    const [workOrders, setWorkOrders] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [inventoryTasks, setInventoryTasks] = useState([]);
    const [loading, setLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncLog, setSyncLog] = useState([]);

    const [activeViewOrder, setActiveViewOrder] = useState(null);
    const [activeJobDetails, setActiveJobDetails] = useState(null);

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    const loadRTGOrders = async () => {
        setLoading(true);
        try {
            // Only pull orders that are strictly "Approved" (Not yet Dispatched)
            const soQuery = query(collection(db, "hq_sales_orders"), where("status", "==", "Approved"), where("brand", "==", activeBrand));
            const woQuery = query(collection(db, "hq_work_orders"), where("status", "==", "Approved"), where("brand", "==", activeBrand));
            const poQuery = query(collection(db, "hq_purchase_orders"), where("status", "==", "Approved"), where("brand", "==", activeBrand));
            const invQuery = query(collection(db, "hq_inventory_tasks"), where("status", "==", "Active"), where("brand", "==", activeBrand));

            const [soSnap, woSnap, poSnap, invSnap] = await Promise.all([
                getDocs(soQuery), getDocs(woQuery), getDocs(poQuery), getDocs(invQuery)
            ]);

            setSalesOrders(soSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setWorkOrders(woSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setPurchaseOrders(poSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setInventoryTasks(invSnap.docs.map(d => ({ id: d.id, ...d.data() })));

        } catch (error) {
            console.error("Error loading RTG:", error);
            addLog("Failed to load local RTG board data.", "error");
        }
        setLoading(false);
    };

    useEffect(() => {
        loadRTGOrders();
    }, [activeBrand]);

    const pullNSSalesOrders = async () => {
        setIsSyncing(true);
        setSyncLog([]); 
        
        try {
            const subsidiaryId = BRAND_NETSUITE_MAP[activeBrand]?.subsidiary || "3";
            addLog(`Initiating Diagnostic Net Pull from NetSuite (Sub: ${subsidiaryId})...`, 'info');
            
            // custbody50 (our QUOTE- job id) is set on the Estimate and, as a stored body
            // field, copies to the Sales Order when the estimate is transformed. The earlier
            // miss was the unordered 1000-row page cap hiding a fresh SO — so narrow to app
            // orders (custbody50 LIKE 'QUOTE-%') and sort newest-first.
            const q = `
                SELECT
                    transaction.id AS ns_id,
                    transaction.tranid AS so_num,
                    transaction.custbody50 AS so_job_id,
                    transaction.entity AS customer_id,
                    transaction.trandate,
                    transaction.memo,
                    transaction.status AS raw_status
                FROM transaction
                WHERE transaction.type = 'SalesOrd'
                AND transaction.subsidiary = ${subsidiaryId}
                AND transaction.custbody50 LIKE 'QUOTE-%'
                ORDER BY transaction.id DESC
            `;
            
            addLog("Executing SuiteQL: Pulling Sales Orders to evaluate locally...", "info");

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
            
            const records = result.items || [];
            addLog(`NetSuite returned ${records.length} total orders for subsidiary. Isolating App Quotes...`, records.length > 0 ? "success" : "warn");

            let newOrders = 0;
            let skippedOrganic = 0;
            let skippedStatus = 0;
            
            for (const row of records) {
                const hqJobId = row.so_job_id;
                const rawStatus = row.raw_status || 'UNKNOWN';

                if (!hqJobId || !hqJobId.startsWith('QUOTE-')) {
                    skippedOrganic++;
                    continue; 
                }

                if (!['SalesOrd:A', 'SalesOrd:B', 'A', 'B'].includes(rawStatus)) {
                    skippedStatus++;
                    continue; 
                }

                const hqSalesOrderId = `SO-${row.so_num}`;
                const soRef = doc(db, "hq_sales_orders", hqSalesOrderId);
                const soSnap = await getDoc(soRef);
                
                if (!soSnap.exists()) {
                    await setDoc(soRef, {
                        id: hqSalesOrderId,
                        soId: row.so_num,
                        nsInternalId: row.ns_id,
                        customer: `NS Entity ID: ${row.customer_id || 'Unknown'}`,
                        status: "Approved",
                        brand: activeBrand,
                        recipe: "PENDING-RECIPE", 
                        type: "Custom",
                        totalParts: 1, 
                        length: 0, width: 0, height: 0,
                        reqDate: row.trandate || new Date().toISOString().split('T')[0],
                        hqJobId: hqJobId,
                        memo: row.memo || ''
                    });
                    newOrders++;
                    addLog(`Imported App-Generated SO: ${hqSalesOrderId} (Linked to ${hqJobId})`, "success");
                } else {
                    addLog(`Skipped ${hqSalesOrderId} (Already exists on board).`, "info");
                }
            }
            
            if (skippedStatus > 0) addLog(`Skipped ${skippedStatus} order(s): status not awaiting dispatch (A/B).`, "info");
            if (skippedOrganic > 0) addLog(`Skipped ${skippedOrganic} order(s): no QUOTE- link (not app-originated).`, "info");
            addLog(`✅ Sync complete. Added ${newOrders} new orders.`, "success");
            loadRTGOrders();
        } catch(e) {
            console.error(e);
            addLog(`❌ FAILED: ${e.message}`, "error");
            alert("Failed to sync from NetSuite. See terminal for details.");
        }
        setIsSyncing(false);
    };

    const fetchEnrichedJobData = async (hqJobId, orderType) => {
        let originalJob = null;
        let svgUri = null;
        let finishRecipe = "PENDING-RECIPE";

        if (hqJobId) {
            try {
                if (orderType === 'stock') {
                    // For stock builds, we look directly in the Master Library (Approved_Designs)
                    const adSnap = await getDoc(doc(db, "Approved_Designs", hqJobId));
                    if (adSnap.exists()) {
                        originalJob = adSnap.data();
                    } else {
                        addLog(`Master Library item not found: ${hqJobId}`, 'warn');
                    }
                } else {
                    // For Sales Orders, we check the CPQ 'jobs' collection
                    const jSnap = await getDoc(doc(db, "jobs", hqJobId));
                    if (jSnap.exists()) {
                        originalJob = jSnap.data();
                    } else {
                        // Fallback to library
                        const adSnap = await getDoc(doc(db, "Approved_Designs", hqJobId));
                        if (adSnap.exists()) originalJob = adSnap.data();
                        else addLog(`Database missed job document: ${hqJobId}`, 'warn');
                    }
                    
                    // Only try to fetch CPQ Shop Drawings for Sales Orders
                    const filesSnap = await getDocs(query(collection(db, "crm_files"), where("jobId", "==", hqJobId)));
                    if (!filesSnap.empty) {
                        const drawingDoc = filesSnap.docs.find(d => d.data().type === 'VISION_DRAWING');
                        if (drawingDoc && drawingDoc.data().svgData) {
                            svgUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(drawingDoc.data().svgData);
                        }
                    }
                }

                // Check for CPQ finish recipe
                if (originalJob && originalJob.cpqData && originalJob.cpqData.configuration) {
                    const fSnap = await getDoc(doc(db, "system", "master_finishes"));
                    if (fSnap.exists() && fSnap.data().finishes) {
                        const configVals = Object.values(originalJob.cpqData.configuration);
                        const foundFin = fSnap.data().finishes.find(f => configVals.includes(f.id));
                        if (foundFin) {
                            finishRecipe = foundFin.code ? `${foundFin.code} - ${foundFin.name}` : foundFin.name;
                        }
                    }
                }
            } catch (err) {
                console.error("Enrichment Fetch Error:", err);
            }
        }
        return { originalJob, svgUri, finishRecipe };
    };

    const handleViewOrder = async (order, orderType) => {
        setActiveViewOrder({ ...order, orderType });
        setActiveJobDetails(null); 
        if (order.hqJobId) {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(order.hqJobId, orderType);
            if (originalJob) {
                setActiveJobDetails({ ...originalJob, finishRecipe, svgUri });
            } else {
                addLog(`Warning: Original Document [${order.hqJobId}] not found in database.`, 'warn');
                setActiveJobDetails({ finishRecipe, svgUri });
            }
        }
    };

    // Load every part referenced by a set of lines into a Map (id -> part doc), de-duped.
    const loadPartsForLines = async (lines) => {
        const ids = [...new Set(lines.map(l => l.partId).filter(Boolean))];
        const cache = new Map();
        await Promise.all(ids.map(async (pid) => {
            try {
                const snap = await getDoc(doc(db, "Approved_Designs", pid));
                if (snap.exists()) cache.set(pid, { id: snap.id, ...snap.data() });
            } catch (e) { /* missing part -> resolved fields fall back below */ }
        }));
        return cache;
    };

    // Map associated part id -> reference image url, from the shared asset gallery.
    const loadAssetMap = async () => {
        const map = new Map();
        try {
            const snap = await getDocs(collection(db, "global_assets"));
            snap.docs.forEach(d => {
                const a = d.data();
                const url = a.thumbnailUrl || a.url || a.originalUrl || null;
                if (url && Array.isArray(a.associatedParts)) {
                    a.associatedParts.forEach(pid => { if (!map.has(pid)) map.set(pid, url); });
                }
            });
        } catch (e) { /* gallery unavailable -> assetUrl stays null */ }
        return map;
    };

    // Build the §6 small-parts pick list from the small lines.
    const buildPartsList = (smallLines, partCache, assetMap, customerId) => smallLines.map(line => {
        const part = line.partId ? partCache.get(line.partId) : null;
        const cp = part?.clientPricing?.find(c => c.customerId === customerId);
        return {
            partId: line.partId || null,
            name: cleanLineName(line.name),
            clientSku: cp?.clientSku || '',
            qty: Number(line.qty) || 1,
            binLocation: part?.manufacturingSpecs?.binLocation || 'UNASSIGNED',
            assetUrl: (line.partId && assetMap.get(line.partId)) || null
        };
    });

    // §6: import a confirmed Sales Order and fan it out into the two linked work orders.
    const autoSplitSalesOrder = async (so) => {
        if (!so.hqJobId) return alert("This SO has no linked CPQ job (custbody50). Cannot auto-split.");
        if (!window.confirm(`Import SO ${so.soId || so.id} and auto-split into Finishing + Shop work orders?`)) return;

        try {
            const jobSnap = await getDoc(doc(db, "jobs", so.hqJobId));
            if (!jobSnap.exists()) return alert(`Linked job ${so.hqJobId} not found.`);
            const job = jobSnap.data();

            const lines = getJobLines(job);
            if (lines.length === 0) return alert("Linked job has no CPQ lines to split.");

            const orderKey = so.soId || so.id || so.hqJobId;
            const customerId = job.customer?.id || null;
            const customerName = job.customer?.name || so.customer || "Unknown";

            const partCache = await loadPartsForLines(lines);

            const smallLines = [];
            const customLines = [];
            lines.forEach(line => {
                const part = line.partId ? partCache.get(line.partId) : null;
                (classifyLine(line, part) === DIVISION_CUSTOM ? customLines : smallLines).push(line);
            });

            const { svgUri, finishRecipe } = await fetchEnrichedJobData(so.hqJobId, 'sales');

            // Vision-computed fabrication geometry (bend vs splice vs miter, shape, O2O) lives
            // on the job's engineeringNotes. Carry it to the floors so the shop knows HOW to
            // make the pole, and the drawing rides along to both halves (it shows placement).
            const eng = job.engineeringNotes || {};
            const fabNotes = {
                shape: eng.shape || null,
                qtyBends: eng.qtyBends || 0,
                qtySplices: eng.qtySplices || 0,
                qtyMiters: eng.qtyMiters || 0,
                qtyMiterReturns: eng.qtyMiterReturns || 0,
                poleO2O: eng.poleO2O || null,
                totalSystemO2O: eng.totalSystemO2O || null,
                // Hidden-hanger mount positions captured in Vision: FIPBH per bracket, FIPBHS per
                // splice. The shop floor reads these to set the concealed hangers at the right spots.
                hangerLocations: Array.isArray(eng.hangerLocations) ? eng.hangerLocations : []
            };
            const fabMethod = eng.qtyBends > 0 ? 'BEND' : (eng.qtySplices > 0 ? 'SPLICE' : (eng.qtyMiters > 0 ? 'MITER' : null));
            const drawingUrl = svgUri
                || (eng.svgString ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(eng.svgString) : null)
                || job.finalImageUrl || null;

            const finId = `WO-${orderKey}`;
            const shopId = `SHOP-${orderKey}`;
            const hasCustom = customLines.length > 0;
            const hasSmall = smallLines.length > 0;

            // --- Finishing (small parts) ---
            if (hasSmall) {
                const assetMap = await loadAssetMap();
                const partsList = buildPartsList(smallLines, partCache, assetMap, customerId);
                const cpqSpecs = {};
                smallLines.forEach(l => { cpqSpecs[cleanLineName(l.name)] = `Qty: ${l.qty}`; });
                const totalParts = smallLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || smallLines.length;

                await setDoc(doc(db, "fin_workorders", finId), {
                    id: finId, woNum: finId, displayId: finId,
                    orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                    estimateId: job.netsuiteEstimateId || null,
                    brand: activeBrand,
                    customerId, customerName, clientName: customerName,
                    orderType: 'sales',
                    type: job.cpqData?.cartItems?.[0]?.assemblyName || "Mixed",
                    recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : (so.recipe || "PENDING-RECIPE"),
                    totalParts,
                    dimensions: { length: Number(so.length) || 0, width: Number(so.width) || 0, height: Number(so.height) || 0 },
                    cpqSpecs,
                    imageUrl: drawingUrl,
                    fabNotes, fabMethod,
                    note: so.memo || job.sidemark || "",
                    reqDate: so.reqDate || "",
                    partsList,
                    currentPhase: "Setup", stepStatus: 'Pending', currentStepIndex: 0,
                    tasks: makeFullTasks(),
                    machineAssigned: null, redlineAlert: false,
                    sentToPickPack: false, pickStatus: 'Pending',
                    shopSiblingId: hasCustom ? shopId : null, hasCustomSibling: hasCustom,
                    customFabStatus: 'Pending',
                    createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser
                });
                addLog(`Created Finishing WO ${finId} (${partsList.length} small lines).`, "success");
            }

            // --- Shop (custom fabrication) ---
            if (hasCustom) {
                const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
                const outsourceFinishes = outSnap.docs.map(d => d.data());
                const matchedOutsource = outsourceFinishes.find(f => finishRecipe.toUpperCase().includes(String(f.name).toUpperCase()));
                const isOutsourced = !!matchedOutsource;
                const cutLine = customLines.find(l => l.cutLength);
                const cpqSpecs = {};
                customLines.forEach(l => { cpqSpecs[cleanLineName(l.name)] = `Qty: ${l.qty}`; });
                // Structured per-line cut list the Shop custom card renders.
                const cutList = customLines.map(l => ({
                    name: cleanLineName(l.name),
                    qty: Number(l.qty) || 1,
                    cutLength: l.cutLength || null,
                    partId: l.partId || null
                }));
                const qty = customLines.reduce((s, l) => s + (Number(l.qty) || 0), 0) || customLines.length;

                await setDoc(doc(db, "shop_custom_orders", shopId), {
                    id: shopId, woNum: shopId,
                    orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                    finSiblingId: hasSmall ? finId : null, hasSmallSibling: hasSmall,
                    status: 'Pending',
                    item: cleanLineName(customLines[0]?.name) || job.cpqData?.cartItems?.[0]?.assemblyName || 'Custom App Order',
                    partNum: customLines[0]?.partId || '',
                    qty,
                    cutLength: cutLine?.cutLength || null,
                    cutList,
                    clientName: customerName, customerId,
                    isOutsourced, finishRecipe,
                    outsourcePrice: isOutsourced ? (matchedOutsource.multiplier || 0) : 0,
                    category: 'Custom Fabrication',
                    priority: 999,
                    brand: activeBrand,
                    note: so.memo || job.sidemark || "",
                    cpqSpecs,
                    imageUrl: drawingUrl,
                    fabNotes, fabMethod,
                    reqDate: so.reqDate || "",
                    createdAt: Date.now(), createdBy: currentUser
                });
                addLog(`Created Shop custom order ${shopId}${fabMethod ? ` [${fabMethod}]` : ''} (${customLines.length} custom lines).`, "success");
            }

            // Packaging: create the packaging order alongside finishing + shop (shared orderKey)
            // so it lands in the Packaging inbox the moment the SO is split. Carries every line
            // (poles = Custom division, small parts) plus the CPQ config — the paired CPQ steps
            // are what decide which pieces bolt together / pack as one assembled (T-shaped) unit.
            const pkgId = `PKG-${orderKey}`;
            const pkgItems = lines.map(l => {
                const part = l.partId ? partCache.get(l.partId) : null;
                const isCustom = classifyLine(l, part) === DIVISION_CUSTOM;
                return {
                    partId: l.partId || null,
                    partName: cleanLineName(l.name),
                    legacyErpId: l.legacyErpId || part?.legacyErpId || null,
                    qty: Number(l.qty) || 1,
                    division: isCustom ? 'pole' : 'small',
                    partHandling: l.partHandling || (isCustom ? 'Custom' : 'Small Parts'),
                    cutLength: l.cutLength || null,
                    dimensions: l.dimensions || null,
                };
            });
            await setDoc(doc(db, "packaging_orders", pkgId), {
                id: pkgId, orderKey, quoteId: so.hqJobId, salesOrderId: so.soId || null,
                brand: activeBrand, customerId, customerName, customer: customerName,
                sidemark: job.sidemark || "", reqDate: so.reqDate || "", note: so.memo || "",
                status: 'pending',
                items: pkgItems,
                cpqData: job.cpqData || null,
                finSiblingId: hasSmall ? finId : null, shopSiblingId: hasCustom ? shopId : null,
                createdAt: Date.now(), updatedAt: Date.now(), createdBy: currentUser
            });
            addLog(`Created Packaging order ${pkgId} (${pkgItems.length} lines).`, "success");

            // Mark the originating job + SO board entry as imported.
            await updateDoc(doc(db, "jobs", so.hqJobId), {
                salesOrderId: so.soId || null,
                status: 'SO_CONFIRMED',
                dateImported: new Date().toISOString().split('T')[0]
            });
            await updateDoc(doc(db, "hq_sales_orders", so.id), {
                status: "Dispatched",
                pushedToFinishing: hasSmall,
                pushedToShop: hasCustom,
                autoSplit: true
            });

            alert(`✅ SO ${orderKey} split: ${hasSmall ? 'Finishing ✓' : '—'}  ${hasCustom ? 'Shop ✓' : '—'}`);
            loadRTGOrders();
        } catch (error) {
            console.error("Auto-Split Error:", error);
            addLog(`Auto-Split Failed: ${error.message}`, "error");
            alert("Failed to auto-split Sales Order. Check console.");
        }
    };

    const pushToFinishing = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;

        try {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(hqOrder.hqJobId, orderType);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            // Fix the double WO-WO- issue by just using the ID properly
            let finWorkOrderId = hqOrder.id;
            if (orderType === 'sales' && !finWorkOrderId.startsWith('WO-')) {
                finWorkOrderId = `WO-${hqOrder.soId || hqOrder.id}`;
            }
            
            // Unified contract (§3). No SO for stock builds -> orderKey falls back to the WO/quote id.
            const orderKey = (orderType === 'sales' ? hqOrder.soId : null) || hqOrder.hqJobId || hqOrder.id;
            const finPayload = {
                id: finWorkOrderId,
                displayId: finWorkOrderId,
                woNum: finWorkOrderId,
                orderKey,
                quoteId: hqOrder.hqJobId || null,
                salesOrderId: (orderType === 'sales' ? hqOrder.soId : null) || null,
                estimateId: originalJob?.netsuiteEstimateId || null,
                orderType: orderType,
                soId: hqOrder.soId || null,
                soNum: hqOrder.soId || null,
                customerId: originalJob?.customer?.id || null,
                customerName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                customer: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : (hqOrder.recipe || "PENDING-RECIPE"),
                reqDate: hqOrder.reqDate || "",
                type: hqOrder.type || "Mixed",
                totalParts: Number(hqOrder.totalParts) || 1,
                note: hqOrder.memo || originalJob?.sidemark || "",
                cpqSpecs: cpqSpecs,
                imageUrl: svgUri || originalJob?.finalImageUrl || null,

                dimensions: {
                    length: Number(hqOrder.length) || 10,
                    width: Number(hqOrder.width) || 5,
                    height: Number(hqOrder.height) || 2
                },

                partsList: [],
                currentPhase: "Setup",
                stepStatus: 'Pending',
                currentStepIndex: 0,
                tasks: makeFullTasks(),
                machineAssigned: null,
                redlineAlert: false,
                sentToPickPack: false,
                pickStatus: 'Pending',
                shopSiblingId: null,
                hasCustomSibling: false,
                customFabStatus: 'Pending',
                brand: activeBrand,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                createdBy: currentUser
            };

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), finPayload);

            // Change status to Dispatched so it leaves the RTG board
            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { 
                pushedToFinishing: true,
                status: "Dispatched" 
            });

            addLog(`Dispatched ${finWorkOrderId} to Finishing Floor!`, "success");
            alert(`Successfully pushed ${finWorkOrderId} to Finishing Floor Setup Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Finishing Floor. Check permissions/console.");
        }
    };

    const pushToShop = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Shop Floor Custom Fabrication Queue?`)) return;

        try {
            const { originalJob, svgUri, finishRecipe } = await fetchEnrichedJobData(hqOrder.hqJobId, orderType);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            const shopJobId = `SHOP-${hqOrder.id}`;
            
            const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
            const outsourceFinishes = outSnap.docs.map(d => d.data());
            const matchedOutsource = outsourceFinishes.find(f => finishRecipe.toUpperCase().includes(f.name.toUpperCase()));
            
            const isOutsourced = !!matchedOutsource;
            const outsourcePrice = isOutsourced ? (matchedOutsource.multiplier || 0) : 0;

            // Unified contract (§4). No SO for stock builds -> orderKey falls back to the WO/quote id.
            const orderKey = (orderType === 'sales' ? hqOrder.soId : null) || hqOrder.hqJobId || hqOrder.id;
            // §12.3: stock replenishment goes into the milling pipeline (milling backlog ->
            // scheduler), NOT the custom-fab finish flow. Tag it so the Shop Floor routes it
            // to the Milling tab's intake instead of the Custom tab's Start/Complete cards.
            const isStock = orderType === 'stock';
            const shopPayload = {
                id: shopJobId,
                woNum: shopJobId,
                orderKey,
                quoteId: hqOrder.hqJobId || null,
                salesOrderId: (orderType === 'sales' ? hqOrder.soId : null) || null,
                finSiblingId: null,
                hasSmallSibling: false,
                soNum: hqOrder.soId || hqOrder.woId || 'N/A',
                isStock,
                routeTo: isStock ? 'MILLING' : 'CUSTOM_FAB',
                partNum: hqOrder.rootItem || hqOrder.variantErpId || '',
                isOutsourced: isOutsourced,
                finishRecipe: finishRecipe,
                outsourcePrice: outsourcePrice,
                // Ensure the itemName gets populated correctly for stock builds
                item: originalJob?.itemName || originalJob?.name || hqOrder.variantErpId || hqOrder.rootItem || hqOrder.hqJobId || 'Custom App Order',
                qty: Number(hqOrder.totalParts) || 1,
                reqDate: hqOrder.reqDate || "",
                category: isStock ? 'Stock Milling' : 'Custom Fabrication',
                status: 'Pending',
                priority: 999,
                brand: activeBrand,
                customerId: originalJob?.customer?.id || null,
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                note: hqOrder.memo || originalJob?.sidemark || "",
                cpqSpecs: cpqSpecs,
                imageUrl: svgUri || originalJob?.finalImageUrl || null,
                needsPhosphating: hqOrder.needsPhosphating || false,
                isPlatingDemand: hqOrder.isPlatingDemand || false,
                rootItem: hqOrder.rootItem || '',
                createdAt: Date.now(),
                createdBy: currentUser
            };

            await setDoc(doc(db, "shop_custom_orders", shopJobId), shopPayload);

            // Change status to Dispatched so it leaves the RTG board
            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { 
                pushedToShop: true,
                status: "Dispatched" 
            });

            addLog(`Dispatched ${shopJobId} to Shop Floor!`, "success");
            alert(`Successfully pushed ${shopJobId} to Shop Floor Custom Fabrication Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Shop Floor. Check permissions/console.");
        }
    };

    const deleteOrder = async (collectionName, id) => {
        if (!window.confirm(`Permanently remove ${id} from the dispatch board?`)) return;
        try {
            await deleteDoc(doc(db, collectionName, id));
            addLog(`Deleted document: ${id}`, "warn");
            loadRTGOrders();
        } catch (e) {
            console.error(e);
            addLog(`Failed to delete ${id}: ${e.message}`, "error");
        }
    };

    const cardStyle = { border: '1px solid var(--line)', padding: '20px', marginBottom: '16px', borderRadius: '2px', background: '#fff', transition: 'box-shadow 0.2s' };
    const btnStyle = { padding: '10px 16px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink)', background: 'var(--paper-2)', border: '1px solid var(--line)', cursor: 'pointer', transition: 'all 0.2s ease', whiteSpace: 'nowrap' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Action Center for Approved Orders</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Ready to Go (RTG) Dispatch</h2>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button onClick={pullNSSalesOrders} disabled={isSyncing} style={{ ...btnStyle, background: isSyncing ? 'var(--paper)' : 'var(--ink)', color: isSyncing ? 'var(--ink-soft)' : '#fff', border: 'none' }}>
                        {isSyncing ? 'Syncing...' : 'Pull ERP Sales Orders'}
                    </button>
                    <button onClick={loadRTGOrders} style={{ ...btnStyle }}>
                        {loading ? 'Scanning...' : 'Refresh Dispatch List'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* LEFT: 4x GRID BOARD */}
                <div style={{ flex: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    
                    {/* 1. SALES ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Sales Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Custom</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {salesOrders.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved sales orders pending dispatch.</p>}
                            
                            {salesOrders.map(so => (
                                <div key={so.id} style={{ ...cardStyle, borderLeft: '4px solid var(--ink)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>SO: {so.soId || so.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Cust: {so.customer || 'N/A'}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_sales_orders', so.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    {so.memo && (
                                        <div style={{ fontSize: '0.85rem', color: 'var(--ink)', marginBottom: '16px', fontStyle: 'italic', borderLeft: '2px solid var(--line)', paddingLeft: '8px' }}>
                                            "{so.memo}"
                                        </div>
                                    )}
                                    {/* Sales orders fan out to BOTH floors in one click — the split
                                        builds the cut list, parts list, drawing + links the halves.
                                        (Manual single-floor pushes live on the Work Order / stock cards.) */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 2, background: so.autoSplit ? 'var(--paper-2)' : 'var(--ink)', color: so.autoSplit ? 'var(--ink-soft)' : '#fff', border: so.autoSplit ? '1px solid var(--line)' : 'none' }} onClick={() => autoSplitSalesOrder(so)}>
                                            {so.autoSplit ? 'Auto-Split ✓' : '⚡ Import & Auto-Split to Floors'}
                                        </button>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(so, 'sales')}>View</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 2. WORK ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Work Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Stock Builds</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {workOrders.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved work orders pending dispatch.</p>}
                            
                            {workOrders.map(wo => (
                                <div key={wo.id} style={{ ...cardStyle, borderLeft: '4px solid var(--brass)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>WO: {wo.woId || wo.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Build to Stock</div>
                                            {wo.needsPhosphating && <div style={{ fontSize: '0.8rem', color: '#d9534f', fontWeight: 600, marginTop: '4px' }}>*REQUIRES PHOSPHATING*</div>}
                                            {wo.isPlatingDemand && <div style={{ fontSize: '0.8rem', color: 'var(--brass)', fontWeight: 600, marginTop: '4px' }}>*PLATING DEMAND STOCK*</div>}
                                        </div>
                                        <button onClick={() => deleteOrder('hq_work_orders', wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(wo, 'stock')}>View</button>
                                        <button style={{ ...btnStyle, flex: 1, background: wo.pushedToFinishing ? 'var(--paper-2)' : 'var(--ink)', color: wo.pushedToFinishing ? 'var(--ink-soft)' : '#fff', border: wo.pushedToFinishing ? '1px solid var(--line)' : 'none' }} onClick={() => pushToFinishing(wo, 'stock')}>
                                            {wo.pushedToFinishing ? 'Finishing Pushed ✓' : 'Push to Finishing'}
                                        </button>
                                        <button style={{ ...btnStyle, flex: 1, background: wo.pushedToShop ? 'var(--paper-2)' : 'var(--brass)', color: wo.pushedToShop ? 'var(--ink-soft)' : '#fff', border: wo.pushedToShop ? '1px solid var(--line)' : 'none' }} onClick={() => pushToShop(wo, 'stock')}>
                                            {wo.pushedToShop ? 'Shop Pushed ✓' : 'Push to Shop'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 3. PURCHASE ORDERS */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Purchase Orders</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Inbound</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {purchaseOrders.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No approved purchase orders incoming.</p>}
                            
                            {purchaseOrders.map(po => (
                                <div key={po.id} style={{ ...cardStyle, borderLeft: '4px solid var(--line)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>PO: {po.poId || po.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Vendor: {po.vendor || 'N/A'}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_purchase_orders', po.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <button style={{ ...btnStyle, width: '100%', background: 'var(--ink)', color: '#fff', border: 'none' }} onClick={() => alert('Sent to Receiving Dock App')}>Alert Receiving Dock</button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 4. INVENTORY CONTROL */}
                    <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                        <div style={{ padding: '20px 24px', background: 'var(--paper-2)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Inventory Tasks</span>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Control</span>
                        </div>
                        <div style={{ padding: '24px', flex: 1, background: 'var(--paper)', maxHeight: '600px', overflowY: 'auto' }}>
                            {inventoryTasks.length === 0 && <p style={{ color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.9rem', margin: 0 }}>No active inventory tasks.</p>}
                            
                            {inventoryTasks.map(inv => (
                                <div key={inv.id} style={{ ...cardStyle, borderLeft: '4px solid var(--line)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                        <div>
                                            <div style={{ fontWeight: 500, fontSize: '1.1rem', color: 'var(--ink)' }}>Task: {inv.taskId || inv.id}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '4px' }}>Type: {inv.type || 'Count'}</div>
                                        </div>
                                        <button onClick={() => deleteOrder('hq_inventory_tasks', inv.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => alert('Cycle Count Dispatched')}>Dispatch Count</button>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => alert('Bin Transfer Initiated')}>Init Transfer</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* RIGHT: TERMINAL */}
                <div style={{ flex: 0.8, background: 'var(--dark)', border: '1px solid var(--line)', borderRadius: '2px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', height: '800px', position: 'sticky', top: '20px', overflow: 'hidden' }}>
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

            {/* VIEW ORDER MODAL */}
            {activeViewOrder && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '40px', borderRadius: '2px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '1px solid var(--line)', boxShadow: '0 12px 48px rgba(0,0,0,0.1)' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px' }}>
                            <div>
                                <h2 style={{ color: 'var(--ink)', margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>
                                    {activeViewOrder.orderType === 'sales' ? 'Sales Order' : 'Work Order'}: {activeViewOrder.soId || activeViewOrder.woId}
                                </h2>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>CPQ App ID: {activeViewOrder.hqJobId || 'N/A'}</div>
                            </div>
                            <button onClick={() => setActiveViewOrder(null)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '2rem', cursor: 'pointer' }}>×</button>
                        </div>

                        {!activeJobDetails ? (
                            <div style={{ padding: '60px', textAlign: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic' }}>
                                Fetching Original Configuration Data...
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                                
                                {activeJobDetails.svgUri ? (
                                    <div style={{ border: '1px solid var(--line)', padding: '20px', background: 'var(--paper)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Engineering Drawing</div>
                                        <img src={activeJobDetails.svgUri} alt="Shop Drawing" style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)' }} />
                                    </div>
                                ) : activeJobDetails.finalImageUrl ? (
                                    <div style={{ border: '1px solid var(--line)', padding: '20px', background: 'var(--paper)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '16px' }}>Library Image</div>
                                        <img src={activeJobDetails.finalImageUrl} alt="Library Part" style={{ width: '100%', maxHeight: '400px', objectFit: 'contain', background: '#fff', border: '1px solid var(--line)' }} />
                                    </div>
                                ) : (
                                    <div style={{ padding: '20px', background: 'var(--paper)', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px solid var(--line)' }}>
                                        No visual assets attached to this configuration.
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Customer / Entity</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.customer?.name || activeJobDetails.customer || activeViewOrder.customer}</div>
                                    </div>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Project / Sidemark</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.sidemark || activeViewOrder.memo || 'N/A'}</div>
                                    </div>
                                    <div style={{ background: 'var(--paper-2)', padding: '20px', border: '1px solid var(--line)' }}>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginBottom: '8px' }}>Finish Recipe</div>
                                        <div style={{ fontFamily: 'var(--sans)', fontSize: '1.1rem', fontWeight: 500, color: 'var(--ink)' }}>{activeJobDetails.finishRecipe}</div>
                                    </div>
                                </div>

                                <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px' }}>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', color: 'var(--ink)', fontWeight: 500, marginBottom: '20px', borderBottom: '1px solid var(--line)', paddingBottom: '10px' }}>Bill of Materials / Specifications</div>
                                    
                                    {activeJobDetails.cpqData?.breakdown ? (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--sans)', fontSize: '0.95rem' }}>
                                            <tbody>
                                                {activeJobDetails.cpqData.breakdown.map((item, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                                                        <td style={{ padding: '16px 0', color: 'var(--ink)' }}>{item.name}</td>
                                                        <td style={{ padding: '16px 0', textAlign: 'right', color: 'var(--ink-soft)' }}>Qty: {item.qty}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>
                                            {activeJobDetails.itemName ? `Stock Item: ${activeJobDetails.itemName}` : 'No itemized breakdown found in source document.'}
                                        </div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                                    <button 
                                        onClick={() => { pushToFinishing(activeViewOrder, activeViewOrder.orderType); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                    >
                                        Push to Finishing Floor
                                    </button>
                                    <button 
                                        onClick={() => { pushToShop(activeViewOrder, activeViewOrder.orderType); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '16px', background: 'var(--brass)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                    >
                                        Push to Shop Floor
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default RTGDispatchTab;