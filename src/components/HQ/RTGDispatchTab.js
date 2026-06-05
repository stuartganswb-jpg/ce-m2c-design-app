import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';

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
            
            const q = `
                SELECT 
                    transaction.id AS ns_id,
                    transaction.tranid AS so_num,
                    transaction.custbody50 AS hq_job_id,
                    transaction.entity AS customer_id,
                    transaction.trandate,
                    transaction.memo,
                    transaction.status AS raw_status
                FROM Transaction
                WHERE transaction.type = 'SalesOrd' 
                AND transaction.subsidiary = ${subsidiaryId}
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
                const hqJobId = row.hq_job_id;
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
            
            addLog(`✅ Sync complete. Added ${newOrders} new orders. (Ignored ${skippedOrganic} organic orders, ${skippedStatus} wrong status).`, "success");
            loadRTGOrders();
        } catch(e) {
            console.error(e);
            addLog(`❌ FAILED: ${e.message}`, "error");
            alert("Failed to sync from NetSuite. See terminal for details.");
        }
        setIsSyncing(false);
    };

    const fetchEnrichedJobData = async (hqJobId) => {
        let originalJob = null;
        let svgUri = null;
        let finishRecipe = "PENDING-RECIPE";

        if (hqJobId) {
            try {
                const jSnap = await getDoc(doc(db, "jobs", hqJobId));
                if (jSnap.exists()) {
                    originalJob = jSnap.data();
                } else {
                    addLog(`Database missed job document: ${hqJobId}`, 'warn');
                }

                const filesSnap = await getDocs(query(collection(db, "crm_files"), where("jobId", "==", hqJobId)));
                if (!filesSnap.empty) {
                    const drawingDoc = filesSnap.docs.find(d => d.data().type === 'VISION_DRAWING');
                    if (drawingDoc) {
                        const svgString = drawingDoc.data().svgData;
                        if (svgString) {
                            svgUri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
                        }
                    } else {
                        addLog(`No Shop Drawing found attached to ${hqJobId}`, 'info');
                    }
                } else {
                    addLog(`No files of any type attached to ${hqJobId}`, 'info');
                }

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
                addLog(`Warning: Failed to fetch enriched data - ${err.message}`, 'error');
            }
        }
        return { originalJob, svgUri, finishRecipe };
    };

    const handleViewOrder = async (order) => {
        setActiveViewOrder(order);
        setActiveJobDetails(null); 
        if (order.hqJobId) {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(order.hqJobId);
            if (originalJob) {
                setActiveJobDetails({ ...originalJob, finishRecipe, svgUri });
            } else {
                addLog(`Warning: Original CPQ Job Document [${order.hqJobId}] not found in database.`, 'warn');
                setActiveJobDetails({ finishRecipe, svgUri });
            }
        }
    };

    const pushToFinishing = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;

        try {
            const { originalJob, finishRecipe, svgUri } = await fetchEnrichedJobData(hqOrder.hqJobId);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            const finWorkOrderId = orderType === 'sales' ? `WO-${hqOrder.soId || Date.now()}` : `WO-${hqOrder.woId || Date.now()}`;
            
            const finPayload = {
                id: finWorkOrderId,
                displayId: finWorkOrderId, 
                woNum: finWorkOrderId,
                orderType: orderType,
                soId: hqOrder.soId || null,
                soNum: hqOrder.soId || null,
                customer: originalJob?.customer?.name || hqOrder.customer || "Internal Stock", 
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock", 
                recipe: finishRecipe !== "PENDING-RECIPE" ? finishRecipe : (hqOrder.recipe || "PENDING-RECIPE"), 
                reqDate: hqOrder.reqDate || "",
                type: hqOrder.type || "Mixed", 
                totalParts: Number(hqOrder.totalParts) || 1,
                note: hqOrder.memo || originalJob?.sidemark || "", 
                cpqSpecs: cpqSpecs, 
                imageUrl: svgUri || null, 
                
                dimensions: {
                    length: Number(hqOrder.length) || 10,
                    width: Number(hqOrder.width) || 5,
                    height: Number(hqOrder.height) || 2
                },
                
                currentPhase: "Setup",
                stepStatus: 'Pending', 
                currentStepIndex: 0,
                tasks: {
                    setup: { status: 'Pending', assignedTo: null }
                },
                createdAt: Date.now()
            };

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), finPayload);

            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { pushedToFinishing: true });

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
            const { originalJob, svgUri, finishRecipe } = await fetchEnrichedJobData(hqOrder.hqJobId);

            let cpqSpecs = {};
            if (originalJob && originalJob.cpqData && originalJob.cpqData.breakdown) {
                originalJob.cpqData.breakdown.forEach(item => {
                    cpqSpecs[item.name] = `Qty: ${item.qty}`;
                });
            }

            const shopJobId = orderType === 'sales' ? `SHOP-${hqOrder.soId || Date.now()}` : `SHOP-${hqOrder.woId || Date.now()}`;
            
            const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
            const outsourceFinishes = outSnap.docs.map(d => d.data());
            const matchedOutsource = outsourceFinishes.find(f => finishRecipe.toUpperCase().includes(f.name.toUpperCase()));
            
            const isOutsourced = !!matchedOutsource;
            const outsourcePrice = isOutsourced ? (matchedOutsource.multiplier || 0) : 0;

            const shopPayload = {
                id: shopJobId,
                woNum: shopJobId,
                soNum: hqOrder.soId || 'N/A',
                isOutsourced: isOutsourced,
                finishRecipe: finishRecipe,
                outsourcePrice: outsourcePrice,
                item: hqOrder.hqJobId || 'Custom App Order', 
                qty: Number(hqOrder.totalParts) || 1,
                reqDate: hqOrder.reqDate || "",
                category: 'Custom Fabrication', 
                status: 'Pending',
                priority: 999,
                clientName: originalJob?.customer?.name || hqOrder.customer || "Internal Stock",
                note: hqOrder.memo || originalJob?.sidemark || "",
                cpqSpecs: cpqSpecs, 
                imageUrl: svgUri || null, 
                createdAt: Date.now()
            };

            await setDoc(doc(db, "shop_custom_orders", shopJobId), shopPayload);

            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { pushedToShop: true });

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
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                        <button style={{ ...btnStyle, flex: 1 }} onClick={() => handleViewOrder(so)}>View</button>
                                        <button style={{ ...btnStyle, flex: 1, background: so.pushedToFinishing ? 'var(--paper-2)' : 'var(--ink)', color: so.pushedToFinishing ? 'var(--ink-soft)' : '#fff', border: so.pushedToFinishing ? '1px solid var(--line)' : 'none' }} onClick={() => pushToFinishing(so, 'sales')}>
                                            {so.pushedToFinishing ? 'Finishing Pushed ✓' : 'Push to Finishing'}
                                        </button>
                                        <button style={{ ...btnStyle, flex: 1, background: so.pushedToShop ? 'var(--paper-2)' : 'var(--brass)', color: so.pushedToShop ? 'var(--ink-soft)' : '#fff', border: so.pushedToShop ? '1px solid var(--line)' : 'none' }} onClick={() => pushToShop(so, 'sales')}>
                                            {so.pushedToShop ? 'Shop Pushed ✓' : 'Push to Shop'}
                                        </button>
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
                                        </div>
                                        <button onClick={() => deleteOrder('hq_work_orders', wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0, color: 'var(--ink-soft)' }}>×</button>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
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
                                <h2 style={{ color: 'var(--ink)', margin: 0, fontFamily: 'var(--serif)', fontSize: '2rem', fontWeight: 500 }}>Sales Order: {activeViewOrder.soId}</h2>
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
                                ) : (
                                    <div style={{ padding: '20px', background: 'var(--paper)', color: 'var(--ink-soft)', fontStyle: 'italic', border: '1px solid var(--line)' }}>
                                        No Shop Drawing attached to this configuration.
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
                                        <div style={{ fontStyle: 'italic', color: 'var(--ink-soft)' }}>No itemized breakdown found in source document.</div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '16px', marginTop: '10px' }}>
                                    <button 
                                        onClick={() => { pushToFinishing(activeViewOrder, 'sales'); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                    >
                                        Push to Finishing Floor
                                    </button>
                                    <button 
                                        onClick={() => { pushToShop(activeViewOrder, 'sales'); setActiveViewOrder(null); }} 
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