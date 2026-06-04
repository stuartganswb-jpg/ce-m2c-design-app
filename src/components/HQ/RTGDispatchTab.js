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
                    transaction.custbody_outsource_po AS po_num,
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
                        poNum: row.po_num || null,
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

    // 🚀 UPGRADED: Robust Data Extraction Engine
    const fetchEnrichedJobData = async (hqJobId) => {
        let originalJob = null;
        let svgUri = null;
        let finishRecipe = "PENDING-RECIPE";

        if (hqJobId) {
            try {
                // 1. Fetch Original CPQ Job
                const jSnap = await getDoc(doc(db, "jobs", hqJobId));
                if (jSnap.exists()) {
                    originalJob = jSnap.data();
                } else {
                    addLog(`Database missed job document: ${hqJobId}`, 'warn');
                }

                // 2. Fetch Shop Drawing 
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

                // 3. Fetch Master Finish Code
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

    // --- ENRICHED BRIDGE: HQ to Finishing Floor ---
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

    // --- ENRICHED BRIDGE: HQ to Shop Floor Custom Fabrication ---
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
            
            // Check if recipe requires outsourced finishing
            const outSnap = await getDocs(collection(db, "hq_outsource_finishes"));
            const outsourceFinishes = outSnap.docs.map(d => d.data().name.toUpperCase());
            const isOutsourced = outsourceFinishes.some(f => finishRecipe.toUpperCase().includes(f));

            const shopPayload = {
                id: shopJobId,
                woNum: shopJobId,
                soNum: hqOrder.soId || 'N/A',
                poNum: hqOrder.poNum || null,
                isOutsourced: isOutsourced,
                finishRecipe: finishRecipe,
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

    const cardStyle = { border: '1px solid #ccc', padding: '15px', marginBottom: '15px', borderRadius: '4px', background: '#f8f9fa' };
    const btnStyle = { padding: '8px 12px', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', marginRight: '5px', marginBottom: '5px' };

    return (
        <div style={{ padding: '30px', fontFamily: 'monospace' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #ccc', paddingBottom: '10px', marginBottom: '20px' }}>
                <div>
                    <h2 style={{ margin: 0, color: '#333' }}>READY TO GO (RTG) DISPATCH</h2>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>Action Center for Netsuite Approved Orders</div>
                </div>
                <div>
                    <button onClick={pullNSSalesOrders} disabled={isSyncing} style={{ ...btnStyle, background: isSyncing ? '#ccc' : '#007bff' }}>
                        {isSyncing ? 'SYNCING...' : '⬇️ PULL ERP SALES ORDERS'}
                    </button>
                    <button onClick={loadRTGOrders} style={{ ...btnStyle, background: '#333', margin: 0 }}>{loading ? 'SCANNING...' : '🔄 REFRESH DISPATCH LIST'}</button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                
                {/* LEFT: 4x GRID BOARD */}
                <div style={{ flex: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                    
                    {/* 1. SALES ORDERS */}
                    <div style={{ borderTop: '4px solid #004080', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ margin: '0 0 15px 0', color: '#004080', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>📦 SALES ORDERS (CUSTOM)</h3>
                        {salesOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved sales orders pending dispatch.</p>}
                        
                        {salesOrders.map(so => (
                            <div key={so.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '5px', color: '#333' }}>
                                        SO: {so.soId || so.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Cust: {so.customer || 'N/A'}</span>
                                    </div>
                                    <button onClick={() => deleteOrder('hq_sales_orders', so.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>🗑️</button>
                                </div>
                                {so.poNum && (
                                    <div style={{ fontSize: '0.8rem', color: '#17a2b8', fontWeight: 'bold', marginBottom: '5px' }}>
                                        PO: {so.poNum}
                                    </div>
                                )}
                                {so.memo && (
                                    <div style={{ fontSize: '0.75rem', color: '#007bff', marginBottom: '10px', fontStyle: 'italic' }}>
                                        "{so.memo}"
                                    </div>
                                )}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    <button style={{ ...btnStyle, background: '#17a2b8' }} onClick={() => handleViewOrder(so)}>👁️ VIEW ORDER</button>
                                    <button style={{ ...btnStyle, background: so.pushedToFinishing ? '#28a745' : '#CC6600' }} onClick={() => pushToFinishing(so, 'sales')}>
                                        {so.pushedToFinishing ? '✅ Finishing Pushed' : 'Push to Finishing'}
                                    </button>
                                    <button style={{ ...btnStyle, background: so.pushedToShop ? '#28a745' : '#f39c12', color: so.pushedToShop ? '#fff' : '#000' }} onClick={() => pushToShop(so, 'sales')}>
                                        {so.pushedToShop ? '✅ Shop Pushed' : 'Push to Shop'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 2. WORK ORDERS */}
                    <div style={{ borderTop: '4px solid #d4af37', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ margin: '0 0 15px 0', color: '#d4af37', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>🛠️ WORK ORDERS (STOCK BUILDS)</h3>
                        {workOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved work orders pending dispatch.</p>}
                        
                        {workOrders.map(wo => (
                            <div key={wo.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                        WO: {wo.woId || wo.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Build to Stock</span>
                                    </div>
                                    <button onClick={() => deleteOrder('hq_work_orders', wo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>🗑️</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    <button style={{ ...btnStyle, background: wo.pushedToFinishing ? '#28a745' : '#CC6600' }} onClick={() => pushToFinishing(wo, 'stock')}>
                                        {wo.pushedToFinishing ? '✅ Finishing Pushed' : 'Push to Finishing'}
                                    </button>
                                    <button style={{ ...btnStyle, background: wo.pushedToShop ? '#28a745' : '#f39c12', color: wo.pushedToShop ? '#fff' : '#000' }} onClick={() => pushToShop(wo, 'stock')}>
                                        {wo.pushedToShop ? '✅ Shop Pushed' : 'Push to Shop'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* 3. PURCHASE ORDERS */}
                    <div style={{ borderTop: '4px solid #28a745', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ margin: '0 0 15px 0', color: '#28a745', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>📥 PURCHASE ORDERS (INBOUND)</h3>
                        {purchaseOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved purchase orders incoming.</p>}
                        
                        {purchaseOrders.map(po => (
                            <div key={po.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                        PO: {po.poId || po.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Vendor: {po.vendor || 'N/A'}</span>
                                    </div>
                                    <button onClick={() => deleteOrder('hq_purchase_orders', po.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>🗑️</button>
                                </div>
                                <button style={{ ...btnStyle, background: '#28a745' }} onClick={() => alert('Sent to Receiving Dock App')}>Alert Receiving Dock</button>
                            </div>
                        ))}
                    </div>

                    {/* 4. INVENTORY CONTROL */}
                    <div style={{ borderTop: '4px solid #d9534f', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                        <h3 style={{ margin: '0 0 15px 0', color: '#d9534f', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>📋 INVENTORY CONTROL</h3>
                        {inventoryTasks.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No active inventory tasks.</p>}
                        
                        {inventoryTasks.map(inv => (
                            <div key={inv.id} style={cardStyle}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                        Task: {inv.taskId || inv.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Type: {inv.type || 'Count'}</span>
                                    </div>
                                    <button onClick={() => deleteOrder('hq_inventory_tasks', inv.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', padding: 0 }}>🗑️</button>
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                    <button style={{ ...btnStyle, background: '#d9534f' }} onClick={() => alert('Cycle Count Dispatched')}>Dispatch Count</button>
                                    <button style={{ ...btnStyle, background: '#d4af37', color: '#000' }} onClick={() => alert('Bin Transfer Initiated')}>Init Bin Transfer</button>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>

                {/* RIGHT: TERMINAL */}
                <div style={{ flex: 0.8, background: '#1e1e1e', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', height: '800px', position: 'sticky', top: '20px' }}>
                    <div style={{ padding: '10px 15px', background: '#333', color: '#fff', fontWeight: 'bold', fontSize: '0.8rem', borderBottom: '2px solid #000', display: 'flex', justifyContent: 'space-between' }}>
                        <span>>_ SUITEQL PULL TERMINAL</span>
                        <button onClick={() => setSyncLog([])} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '0.7rem' }}>CLEAR</button>
                    </div>
                    <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {syncLog.length === 0 && <span style={{ color: '#666' }}>Awaiting command...</span>}
                        {syncLog.map((log, idx) => {
                            let color = '#fff';
                            if (log.type === 'error') color = '#ff4d4d';
                            if (log.type === 'success') color = '#28a745';
                            if (log.type === 'warn') color = '#ffc107';
                            
                            return (
                                <div key={idx} style={{ color, borderBottom: '1px dotted #333', paddingBottom: '4px' }}>
                                    <span style={{ color: '#888', marginRight: '8px' }}>[{log.time}]</span>
                                    {log.msg}
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* 🚀 VIEW ORDER MODAL */}
            {activeViewOrder && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', padding: '30px', borderRadius: '12px', width: '800px', maxHeight: '90vh', overflowY: 'auto', border: '4px solid #333', boxShadow: '10px 10px 0 #007bff' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #ccc', paddingBottom: '15px', marginBottom: '20px' }}>
                            <div>
                                <h2 style={{ color: '#007bff', margin: 0, fontSize: '1.8rem' }}>SALES ORDER: {activeViewOrder.soId}</h2>
                                <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '5px' }}>CPQ App ID: {activeViewOrder.hqJobId || 'N/A'}</div>
                            </div>
                            <button onClick={() => setActiveViewOrder(null)} style={{ background: '#d9534f', border: 'none', color: '#fff', padding: '8px 12px', cursor: 'pointer', fontWeight: 'bold', borderRadius: '4px' }}>CLOSE</button>
                        </div>

                        {!activeJobDetails ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: '#666', fontSize: '1.2rem', fontWeight: 'bold' }}>
                                ⏳ Fetching Original Configuration Data...
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                
                                {activeJobDetails.svgUri ? (
                                    <div style={{ border: '2px solid #ccc', borderRadius: '8px', padding: '10px', background: '#fff' }}>
                                        <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold', marginBottom: '10px' }}>ENGINEERING DRAWING</div>
                                        <img src={activeJobDetails.svgUri} alt="Shop Drawing" style={{ width: '100%', maxHeight: '300px', objectFit: 'contain' }} />
                                    </div>
                                ) : (
                                    <div style={{ padding: '15px', background: '#fff3cd', color: '#856404', fontStyle: 'italic', border: '1px dashed #ffeeba', borderRadius: '8px' }}>
                                        No Shop Drawing attached to this configuration.
                                    </div>
                                )}

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                                        <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>CUSTOMER / ENTITY</div>
                                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#000' }}>{activeJobDetails.customer?.name || activeJobDetails.customer || activeViewOrder.customer}</div>
                                    </div>
                                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                                        <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>PROJECT / SIDEMARK</div>
                                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#007bff' }}>{activeJobDetails.sidemark || activeViewOrder.memo || 'N/A'}</div>
                                    </div>
                                    <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', border: '1px solid #ccc' }}>
                                        <div style={{ fontSize: '12px', color: '#666', fontWeight: 'bold' }}>FINISH RECIPE</div>
                                        <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#CC6600' }}>{activeJobDetails.finishRecipe}</div>
                                    </div>
                                </div>

                                <div style={{ background: '#eafaf1', border: '2px solid #28a745', padding: '20px', borderRadius: '8px' }}>
                                    <div style={{ fontSize: '14px', color: '#1e7e34', fontWeight: 'bold', marginBottom: '10px', textTransform: 'uppercase' }}>BILL OF MATERIALS / SPECIFICATIONS</div>
                                    
                                    {activeJobDetails.cpqData?.breakdown ? (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px', background: '#fff' }}>
                                            <tbody>
                                                {activeJobDetails.cpqData.breakdown.map((item, i) => (
                                                    <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                                                        <td style={{ padding: '10px', fontWeight: 'bold' }}>{item.name}</td>
                                                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 'bold', color: '#007bff' }}>Qty: {item.qty}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    ) : (
                                        <div style={{ fontStyle: 'italic', color: '#666' }}>No itemized breakdown found in source document.</div>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                                    <button 
                                        onClick={() => { pushToFinishing(activeViewOrder, 'sales'); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '15px', background: '#CC6600', color: '#fff', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px', fontSize: '1rem' }}
                                    >
                                        PUSH TO FINISHING FLOOR ➔
                                    </button>
                                    <button 
                                        onClick={() => { pushToShop(activeViewOrder, 'sales'); setActiveViewOrder(null); }} 
                                        style={{ flex: 1, padding: '15px', background: '#f39c12', color: '#000', border: 'none', fontWeight: 'bold', cursor: 'pointer', borderRadius: '6px', fontSize: '1rem' }}
                                    >
                                        PUSH TO SHOP FLOOR ➔
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