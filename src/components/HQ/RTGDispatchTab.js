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
            addLog(`Initiating Wide Net Pull from NetSuite (Sub: ${subsidiaryId})...`, 'info');
            
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

                if (row.so_num === 'SO58232' || row.so_num === '58232') {
                    addLog(`🎯 FOUND SO58232! Internal Status: [${rawStatus}], Job ID: [${hqJobId || 'NULL'}]`, "warn");
                }

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

    // --- 🚀 THE FINISHING BRIDGE: HQ to Finishing Floor ---
    const pushToFinishing = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;

        try {
            const finWorkOrderId = orderType === 'sales' ? `WO-${hqOrder.soId || Date.now()}` : `WO-${hqOrder.woId || Date.now()}`;
            
            const finPayload = {
                id: finWorkOrderId,
                displayId: finWorkOrderId, 
                woNum: finWorkOrderId,
                orderType: orderType,
                soId: hqOrder.soId || null,
                soNum: hqOrder.soId || null,
                customer: hqOrder.customer || "Internal Stock", 
                clientName: hqOrder.customer || "Internal Stock", 
                recipe: hqOrder.recipe || "PENDING-RECIPE",
                reqDate: hqOrder.reqDate || "",
                type: hqOrder.type || "Mixed", 
                totalParts: Number(hqOrder.totalParts) || 1,
                note: hqOrder.memo || "", // Passes NetSuite memo to the Golden Payload Modal
                
                dimensions: {
                    length: Number(hqOrder.length) || 10,
                    width: Number(hqOrder.width) || 5,
                    height: Number(hqOrder.height) || 2
                },
                
                currentPhase: "Setup",
                stepStatus: 'Pending', // Strictly required for SetupQueue.js start buttons
                currentStepIndex: 0,
                tasks: {
                    setup: { status: 'Pending', assignedTo: null }
                },
                createdAt: Date.now()
            };

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), finPayload);

            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { status: "Dispatched_Finishing" });

            addLog(`Dispatched ${finWorkOrderId} to Finishing Floor!`, "success");
            alert(`Successfully pushed ${finWorkOrderId} to Finishing Floor Setup Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            addLog(`Dispatch Failed: ${error.message}`, "error");
            alert("Failed to push to Finishing Floor. Check permissions/console.");
        }
    };

    // --- 🚀 NEW SHOP BRIDGE: HQ to Shop Floor Custom Fabrication ---
    const pushToShop = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Shop Floor Custom Fabrication Queue?`)) return;

        try {
            const shopJobId = orderType === 'sales' ? `SHOP-${hqOrder.soId || Date.now()}` : `SHOP-${hqOrder.woId || Date.now()}`;
            
            const shopPayload = {
                id: shopJobId,
                woNum: shopJobId,
                soNum: hqOrder.soId || 'N/A',
                item: hqOrder.hqJobId || 'Custom App Order', 
                qty: Number(hqOrder.totalParts) || 1,
                reqDate: hqOrder.reqDate || "",
                category: 'Custom Fabrication', // This strictly routes it to the right column in ShopFloor.js
                status: 'Pending',
                priority: 999,
                clientName: hqOrder.customer || "Internal Stock",
                note: hqOrder.memo || "", // Passes NetSuite memo to the Golden Payload Modal
                createdAt: Date.now()
            };

            await setDoc(doc(db, "shop_custom_orders", shopJobId), shopPayload);

            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { status: "Dispatched_Shop" });

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
                                {so.memo && (
                                    <div style={{ fontSize: '0.75rem', color: '#007bff', marginBottom: '10px', fontStyle: 'italic' }}>
                                        "{so.memo}"
                                    </div>
                                )}
                                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                    <button style={{ ...btnStyle, background: '#CC6600' }} onClick={() => pushToFinishing(so, 'sales')}>Push to Finishing</button>
                                    <button style={{ ...btnStyle, background: '#f39c12', color: '#000' }} onClick={() => pushToShop(so, 'sales')}>Push to Shop</button>
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
                                <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                    <button style={{ ...btnStyle, background: '#CC6600' }} onClick={() => pushToFinishing(wo, 'stock')}>Push to Finishing</button>
                                    <button style={{ ...btnStyle, background: '#f39c12', color: '#000' }} onClick={() => pushToShop(wo, 'stock')}>Push to Shop</button>
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
        </div>
    );
};

export default RTGDispatchTab;