import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query } from "firebase/firestore";

const FIREBASE_FUNCTION_URL = "https://netsuiteproxy-f3h3jadzaq-uc.a.run.app";

const StockViewTab = ({ currentUser, activeBrand }) => {
    const [hqParts, setHqParts] = useState([]);
    const [nsStock, setNsStock] = useState({});
    const [vendors, setVendors] = useState([]);
    
    const [activeVendor, setActiveVendor] = useState("");
    const [orderDrafts, setOrderDrafts] = useState({});
    
    const [isSyncing, setIsSyncing] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [syncLog, setSyncLog] = useState([]);

    const addLog = (msg, type = 'info') => {
        const time = new Date().toLocaleTimeString();
        setSyncLog(prev => [{ time, msg, type }, ...prev]);
    };

    // 1. Fetch Local HQ Library Data
    useEffect(() => {
        const q = query(collection(db, "Approved_Designs"));
        const unsub = onSnapshot(q, (snap) => {
            const parts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Extract unique vendors for the dropdown
            const uniqueVendors = [...new Set(parts.map(p => p.manufacturingSpecs?.vendorName).filter(Boolean))];
            setVendors(uniqueVendors.sort());
            setHqParts(parts);
        });
        return () => unsub();
    }, []);

    // 2. Fetch Live Inventory from NetSuite
    const pullNetSuiteStock = async () => {
        setIsSyncing(true);
        setSyncLog([]);
        addLog("Initiating SuiteQL pull for Item Inventory...", "info");

        try {
            const q = `
                SELECT 
                    itemid AS legacy_id,
                    quantityonhand,
                    quantityavailable,
                    quantityonorder,
                    quantitybackordered,
                    averagecost
                FROM Item
            `;
            
            addLog(`Executing Query: Pulling on-hand, available, on-order, and backordered quantities...`, "info");

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
            
            addLog(`NetSuite returned ${result.items?.length || 0} items. Mapping to HQ catalog...`, "success");

            const stockMap = {};
            (result.items || []).forEach(row => {
                if (row.legacy_id) {
                    stockMap[row.legacy_id.toUpperCase()] = {
                        onHand: parseInt(row.quantityonhand) || 0,
                        available: parseInt(row.quantityavailable) || 0,
                        onOrder: parseInt(row.quantityonorder) || 0,
                        backorder: parseInt(row.quantitybackordered) || 0,
                        cost: parseFloat(row.averagecost) || 0
                    };
                }
            });
            
            setNsStock(stockMap);
            addLog(`✅ Sync Complete. Inventory matched and updated successfully.`, "success");
        } catch (error) {
            console.error("NetSuite Sync Error:", error);
            addLog(`❌ FAILED: ${error.message}`, "error");
        }
        setIsSyncing(false);
    };

    // Calculate dynamic reorder suggestion
    const calculateSuggestedQty = (available, rop, moq, leadTime) => {
        if (available > rop) return 0;
        // Basic dynamic rate: Suggest ordering the ROP deficit + a 30-day buffer based on Lead Time
        const dynamicRateOfSale = 1.5; // Placeholder: 1.5 units per day
        const leadTimeBuffer = leadTime ? (leadTime * dynamicRateOfSale) : 10; 
        
        let suggested = (rop - available) + leadTimeBuffer;
        if (moq && suggested < moq) suggested = moq; // Must meet vendor MOQ
        
        return Math.ceil(suggested);
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

        const poPayload = {
            vendor: activeVendor,
            subsidiary: "2", // Default to CE or derive from activeBrand
            memo: "Auto-Generated via Fab-OS Stock View",
            items: lineItems
        };

        // Export as JSON for NetSuite Script consumption
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(poPayload, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", `PO_Export_${activeVendor}_${Date.now()}.json`);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();

        addLog(`✅ Exported PO Payload for ${activeVendor} (${lineItems.length} lines)`, "success");
        alert("✅ Purchase Order payload generated! Ready to push to NetSuite.");
        setOrderDrafts({}); // Clear draft after export
    };

    // Filters
    const enrichedInventory = hqParts.map(part => {
        const erpId = (part.legacyErpId || part.itemId).toUpperCase();
        const stock = nsStock[erpId] || { onHand: 0, available: 0, onOrder: 0, backorder: 0 };
        const specs = part.manufacturingSpecs || {};
        
        const rop = parseInt(specs.reorderPoint) || 0;
        const moq = parseInt(specs.moq) || 0;
        const leadTime = parseInt(specs.leadTime) || 0;

        return { ...part, stock, rop, moq, leadTime, isLowStock: stock.available <= rop && rop > 0 };
    });

    const displayItems = activeVendor 
        ? enrichedInventory.filter(p => p.manufacturingSpecs?.vendorName === activeVendor && !p.manufacturingSpecs?.isInHouse)
        : enrichedInventory.filter(p => p.partClass === 'Inventory' && (p.itemName.toLowerCase().includes(searchQuery.toLowerCase()) || (p.legacyErpId || '').toLowerCase().includes(searchQuery.toLowerCase())));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            
            {/* HEADER */}
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
                <div>
                    <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.4rem', color: '#17a2b8' }}>ERP Stock & Sourcing View</h2>
                    <span style={{ fontSize: '0.8rem', color: '#666' }}>Live NetSuite Inventory Integration</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <input 
                        placeholder="🔍 Search Global Inventory..." 
                        value={searchQuery} 
                        onChange={(e) => setSearchQuery(e.target.value)} 
                        disabled={!!activeVendor}
                        style={{ padding: '10px', border: '2px solid #ccc', fontWeight: 'bold', width: '300px' }} 
                    />
                    <button onClick={pullNetSuiteStock} disabled={isSyncing} style={{ padding: '10px 20px', background: isSyncing ? '#ccc' : '#17a2b8', color: '#fff', border: '2px solid #000', fontWeight: 'bold', cursor: 'pointer', boxShadow: '3px 3px 0 #000' }}>
                        {isSyncing ? '🔄 SYNCING...' : '⬇️ PULL NETSUITE STOCK'}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                
                {/* LEFT: GLOBAL INVENTORY BOARD */}
                <div style={{ flex: 1.5, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '15px', background: '#333', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>📦 GLOBAL INVENTORY HEALTH</span>
                        <span style={{ fontSize: '0.8rem', background: '#d9534f', padding: '2px 8px', borderRadius: '12px' }}>RED = AT OR BELOW ROP</span>
                    </div>
                    
                    <div style={{ overflowY: 'auto', maxHeight: '75vh' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                            <thead style={{ background: '#e9ecef', position: 'sticky', top: 0 }}>
                                <tr>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>ERP ID</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000' }}>ITEM NAME</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000', textAlign: 'center' }}>ON HAND</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000', textAlign: 'center' }}>AVAIL</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000', textAlign: 'center' }}>ON ORDER</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000', textAlign: 'center' }}>BACKORDER</th>
                                    <th style={{ padding: '12px', borderBottom: '2px solid #000', textAlign: 'center' }}>ROP</th>
                                </tr>
                            </thead>
                            <tbody>
                                {displayItems.length === 0 && <tr><td colSpan="7" style={{ padding: '20px', textAlign: 'center', color: '#888', fontStyle: 'italic' }}>No inventory items matched.</td></tr>}
                                {!activeVendor && displayItems.map(item => (
                                    <tr key={item.id} style={{ borderBottom: '1px solid #eee', background: item.isLowStock ? '#fff0f0' : '#fff' }}>
                                        <td style={{ padding: '12px', fontWeight: 'bold', color: item.isLowStock ? '#d9534f' : '#007bff' }}>
                                            {item.legacyErpId || item.itemId}
                                            {item.manufacturingSpecs?.isInHouse === false && <span style={{display: 'block', fontSize: '0.65rem', color: '#17a2b8', marginTop: '3px'}}>OUTSOURCED</span>}
                                        </td>
                                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{item.itemName}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '1rem', fontWeight: 'bold' }}>{item.stock.onHand}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '1rem', fontWeight: 'bold', color: item.isLowStock ? '#d9534f' : '#28a745' }}>{item.stock.available}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '1rem', fontWeight: 'bold', color: '#17a2b8' }}>{item.stock.onOrder}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontSize: '1rem', fontWeight: 'bold', color: item.stock.backorder > 0 ? '#d9534f' : '#333' }}>{item.stock.backorder}</td>
                                        <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold', color: '#666' }}>{item.rop || '-'}</td>
                                    </tr>
                                ))}
                                {activeVendor && <tr><td colSpan="7" style={{ padding: '40px', textAlign: 'center', color: '#17a2b8', fontWeight: 'bold', fontSize: '1.2rem' }}>Viewing {activeVendor} Catalog. Refer to the right-side PO Builder.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* MIDDLE: VENDOR PO BUILDER */}
                <div style={{ flex: 1, background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)' }}>
                    <div style={{ padding: '15px', background: '#17a2b8', color: '#fff', fontWeight: 'bold', fontSize: '1.2rem' }}>
                        🛒 VENDOR PO BUILDER
                    </div>
                    
                    <div style={{ padding: '20px', borderBottom: '2px solid #ccc', background: '#f8f9fa' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 'bold', display: 'block', marginBottom: '8px', color: '#333' }}>SELECT VENDOR FOR RESTOCK:</label>
                        <select 
                            value={activeVendor} 
                            onChange={(e) => { setActiveVendor(e.target.value); setOrderDrafts({}); }} 
                            style={{ width: '100%', padding: '12px', border: '2px solid #17a2b8', fontWeight: 'bold', fontSize: '1rem', outline: 'none' }}
                        >
                            <option value="">-- View Global Inventory (No Vendor Selected) --</option>
                            {vendors.map(v => <option key={v} value={v}>{v}</option>)}
                        </select>
                    </div>

                    <div style={{ flex: 1, padding: '20px', overflowY: 'auto', maxHeight: '55vh' }}>
                        {!activeVendor ? (
                            <div style={{ color: '#888', fontStyle: 'italic', textAlign: 'center', marginTop: '40px' }}>Select a vendor from the dropdown to load their catalog and generate restocking suggestions.</div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                {displayItems.map(item => {
                                    const suggested = calculateSuggestedQty(item.stock.available, item.rop, item.moq, item.leadTime);
                                    const currentDraft = orderDrafts[item.id] !== undefined ? orderDrafts[item.id] : (suggested > 0 ? suggested : 0);
                                    
                                    return (
                                        <div key={item.id} style={{ border: item.isLowStock ? '2px solid #d9534f' : '1px solid #ccc', padding: '15px', borderRadius: '8px', background: item.isLowStock ? '#fffdf5' : '#fff' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                                                <div>
                                                    <div style={{ fontWeight: 'bold', fontSize: '1rem', color: '#000' }}>{item.itemName}</div>
                                                    <div style={{ fontSize: '0.75rem', color: '#007bff', fontWeight: 'bold', marginTop: '3px' }}>ERP: {item.legacyErpId} | VENDOR SKU: {item.manufacturingSpecs?.vendorId || 'N/A'}</div>
                                                </div>
                                                {item.isLowStock && <span style={{ background: '#d9534f', color: '#fff', padding: '4px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold', height: 'fit-content' }}>LOW STOCK</span>}
                                            </div>
                                            
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', background: '#f4f4f4', padding: '10px', borderRadius: '4px', fontSize: '0.8rem', textAlign: 'center', marginBottom: '15px' }}>
                                                <div><div style={{ color: '#666', fontWeight: 'bold' }}>AVAIL</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: item.isLowStock ? '#d9534f' : '#28a745' }}>{item.stock.available}</div></div>
                                                <div><div style={{ color: '#666', fontWeight: 'bold' }}>ROP</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{item.rop || 0}</div></div>
                                                <div><div style={{ color: '#666', fontWeight: 'bold' }}>MOQ</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{item.moq || 0}</div></div>
                                                <div><div style={{ color: '#666', fontWeight: 'bold' }}>LEAD</div><div style={{ fontSize: '1.1rem', fontWeight: 'bold' }}>{item.leadTime || 0}d</div></div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: '0.75rem', color: '#666', fontWeight: 'bold', marginBottom: '3px' }}>SUGGESTED REORDER:</div>
                                                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: suggested > 0 ? '#17a2b8' : '#333' }}>{suggested} units</div>
                                                </div>
                                                <div style={{ flex: 1.5 }}>
                                                    <label style={{ fontSize: '0.75rem', color: '#000', fontWeight: 'bold', display: 'block', marginBottom: '3px' }}>FINAL ORDER QTY:</label>
                                                    <input 
                                                        type="number" 
                                                        value={currentDraft} 
                                                        onChange={(e) => handleOrderQtyChange(item.id, e.target.value)}
                                                        style={{ width: '100%', padding: '10px', fontSize: '1.1rem', fontWeight: 'bold', border: currentDraft > 0 ? '2px solid #28a745' : '1px solid #ccc', boxSizing: 'border-box' }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>

                    {activeVendor && (
                        <div style={{ padding: '20px', borderTop: '2px solid #000', background: '#e0f7fa' }}>
                            <button 
                                onClick={generatePOPayload}
                                style={{ width: '100%', padding: '15px', background: '#17a2b8', color: '#fff', fontSize: '1.2rem', fontWeight: 'bold', border: '2px solid #000', cursor: 'pointer', boxShadow: '3px 3px 0 #000' }}
                            >
                                📤 EXPORT PO PAYLOAD TO ERP
                            </button>
                        </div>
                    )}
                </div>

                {/* RIGHT: TERMINAL */}
                <div style={{ flex: 0.8, background: '#1e1e1e', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 #000', height: '80vh', position: 'sticky', top: '20px' }}>
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

export default StockViewTab;