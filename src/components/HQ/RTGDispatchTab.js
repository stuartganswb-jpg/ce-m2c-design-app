import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, getDocs, doc, setDoc, updateDoc } from 'firebase/firestore';

const RTGDispatchTab = ({ currentUser, activeBrand }) => {
    const [salesOrders, setSalesOrders] = useState([]);
    const [workOrders, setWorkOrders] = useState([]);
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [inventoryTasks, setInventoryTasks] = useState([]);
    const [loading, setLoading] = useState(false);

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
            alert("Failed to load data. See console.");
        }
        setLoading(false);
    };

    useEffect(() => {
        loadRTGOrders();
    }, [activeBrand]);

    // --- THE BRIDGE: HQ to Finishing Floor ---
    const pushToFinishing = async (hqOrder, orderType) => {
        if (!window.confirm(`Push HQ Order ${hqOrder.id} to the Finishing Floor Setup Queue?`)) return;

        try {
            // Keep WO and SO separate
            const finWorkOrderId = orderType === 'sales' ? `WO-${hqOrder.soId || Date.now()}` : `WO-${hqOrder.woId || Date.now()}`;
            
            const finPayload = {
                id: finWorkOrderId,
                orderType: orderType,
                soId: hqOrder.soId || null,
                customer: hqOrder.customer || "Internal Stock", 
                recipe: hqOrder.recipe || "PENDING-RECIPE",
                reqDate: hqOrder.reqDate || "",
                type: hqOrder.type || "Mixed", 
                totalParts: Number(hqOrder.totalParts) || 1,
                
                // Dimensions injected for the paint calculator
                dimensions: {
                    length: Number(hqOrder.length) || 10,
                    width: Number(hqOrder.width) || 5,
                    height: Number(hqOrder.height) || 2
                },
                
                currentPhase: "Setup",
                currentStepIndex: 0,
                tasks: {
                    setup: { status: 'Pending', assignedTo: null }
                },
                createdAt: Date.now()
            };

            await setDoc(doc(db, "fin_workorders", finWorkOrderId), finPayload);

            const collectionName = orderType === 'sales' ? "hq_sales_orders" : "hq_work_orders";
            await updateDoc(doc(db, collectionName, hqOrder.id), { status: "Dispatched_Finishing" });

            alert(`Successfully pushed ${finWorkOrderId} to Finishing Floor Setup Queue!`);
            loadRTGOrders(); 

        } catch (error) {
            console.error("Dispatch Error:", error);
            alert("Failed to push to Finishing Floor. Check permissions/console.");
        }
    };

    // --- DEV CHEAT CODE: INJECT TEST ORDER ---
    const injectTestOrder = async () => {
        try {
            const testId = `TEST-SO-${Math.floor(Math.random() * 1000)}`;
            await setDoc(doc(db, "hq_sales_orders", testId), {
                soId: testId,
                customer: "Stark Industries",
                status: "Approved",      
                brand: activeBrand,      
                recipe: "MATTE-BLACK",
                type: "Poles",
                totalParts: 25,
                length: 48, 
                width: 2, 
                height: 2,
                reqDate: "2026-06-01"
            });
            alert(`Injected ${testId}! The board will now refresh.`);
            loadRTGOrders();
        } catch (error) {
            console.error("Injection failed:", error);
            alert("Injection failed. Check console.");
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
                    <button onClick={injectTestOrder} style={{ ...btnStyle, background: '#8e44ad' }}>🧪 INJECT TEST ORDER</button>
                    <button onClick={loadRTGOrders} style={{ ...btnStyle, background: '#333', margin: 0 }}>{loading ? 'SCANNING...' : '🔄 REFRESH DISPATCH LIST'}</button>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                {/* 1. SALES ORDERS */}
                <div style={{ borderTop: '4px solid #004080', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#004080', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>🛒 SALES ORDERS (CUSTOM)</h3>
                    {salesOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved sales orders pending dispatch.</p>}
                    
                    {salesOrders.map(so => (
                        <div key={so.id} style={cardStyle}>
                            <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                SO: {so.soId || so.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Cust: {so.customer || 'N/A'}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                <button style={{ ...btnStyle, background: '#CC6600' }} onClick={() => pushToFinishing(so, 'sales')}>Push to Finishing</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Shop Floor push coming soon')}>Push to Shop</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Picking push coming soon')}>Push to Picking</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Plating push coming soon')}>Push to Plating</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Packing push coming soon')}>Push to Packing</button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* 2. WORK ORDERS */}
                <div style={{ borderTop: '4px solid #d4af37', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#d4af37', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>🏭 WORK ORDERS (STOCK BUILDS)</h3>
                    {workOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved work orders pending dispatch.</p>}
                    
                    {workOrders.map(wo => (
                        <div key={wo.id} style={cardStyle}>
                            <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                WO: {wo.woId || wo.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Build to Stock</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                <button style={{ ...btnStyle, background: '#CC6600' }} onClick={() => pushToFinishing(wo, 'stock')}>Push to Finishing</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Shop Floor push coming soon')}>Push to Shop</button>
                                <button style={{ ...btnStyle, background: '#555' }} onClick={() => alert('Plating push coming soon')}>Push to Plating</button>
                            </div>
                        </div>
                    ))}
                </div>

                {/* 3. PURCHASE ORDERS */}
                <div style={{ borderTop: '4px solid #28a745', background: '#fff', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#28a745', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>📦 PURCHASE ORDERS (INBOUND)</h3>
                    {purchaseOrders.length === 0 && <p style={{ color: '#888', fontStyle: 'italic', fontSize: '0.8rem' }}>No approved purchase orders incoming.</p>}
                    
                    {purchaseOrders.map(po => (
                        <div key={po.id} style={cardStyle}>
                            <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                PO: {po.poId || po.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Vendor: {po.vendor || 'N/A'}</span>
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
                            <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '10px', color: '#333' }}>
                                Task: {inv.taskId || inv.id} <span style={{ fontSize: '0.7rem', color: '#666', fontWeight: 'normal' }}>| Type: {inv.type || 'Count'}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
                                <button style={{ ...btnStyle, background: '#d9534f' }} onClick={() => alert('Cycle Count Dispatched')}>Dispatch Count</button>
                                <button style={{ ...btnStyle, background: '#d4af37', color: '#000' }} onClick={() => alert('Bin Transfer Initiated')}>Init Bin Transfer</button>
                                <button style={{ ...btnStyle, background: '#8e44ad' }} onClick={() => alert('Clearance Flagged')}>Flag Clearance</button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default RTGDispatchTab;