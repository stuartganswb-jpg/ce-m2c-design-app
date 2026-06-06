import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, query, writeBatch, doc } from "firebase/firestore";

const DEFAULT_SYSTEM_WINDOWS = {
  inHouseFinishes: ['ce', 'm2c'], outsourceFinishes: ['ce', 'm2c'],
  prodTypes: ['ce', 'm2c', 'uniquity', 'leyla'], uom: ['ce', 'm2c', 'uniquity', 'leyla'],
  collections: ['ce', 'm2c', 'uniquity', 'leyla'], watchLists: ['ce', 'm2c', 'uniquity', 'leyla'],
  vendors: ['ce', 'm2c', 'uniquity', 'leyla'], outsourceActions: ['ce', 'm2c', 'uniquity', 'leyla'],
  pillowSizes: ['uniquity'], fillTypes: ['uniquity'], flangeStyles: ['uniquity'], stitchTypes: ['uniquity'],
  seamCounts: ['uniquity'], assemblyTypes: ['ce', 'm2c', 'uniquity', 'leyla'],
  customers: ['ce', 'm2c', 'uniquity', 'leyla'],
  partHandling: ['ce', 'm2c', 'uniquity', 'leyla'], 
  inventoryTypes: ['ce', 'm2c', 'uniquity', 'leyla'],
  projections: ['ce', 'm2c', 'uniquity', 'leyla'] 
};

const LibraryMassUpdateTab = ({ currentUser, activeBrand }) => {
    const [inventory, setInventory] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedIds, setSelectedIds] = useState(new Set());
    
    const [globalLists, setGlobalLists] = useState({ 
        prodTypes: [], uom: [], watchLists: [], assemblyTypes: [], inventoryTypes: [], 
        partHandling: [], collections: [], vendors: [], outsourceActions: [],
        pillowSizes: [], fillTypes: [], flangeStyles: [], stitchTypes: [], seamCounts: [],
        projections: []
    });
    const [collectionsData, setCollectionsData] = useState([]);
    const [windowConfig, setWindowConfig] = useState({ system: DEFAULT_SYSTEM_WINDOWS });

    const [isUpdating, setIsUpdating] = useState(false);
    const [progress, setProgress] = useState(0);

    // Track which fields the user wants to update, and their new values
    const [updates, setUpdates] = useState({
        productType: { active: false, value: "" },
        routingType: { active: false, value: "" },
        uom: { active: false, value: "EA" },
        watchList: { active: false, value: "NONE" },
        project: { active: false, value: "" },
        isInHouse: { active: false, value: true },
        partHandling: { active: false, value: "" },
        collection: { active: false, value: "" },
        
        // Added Simple Dropdowns
        vendorName: { active: false, value: "" },
        outsourceAction: { active: false, value: "" },
        pillowSize: { active: false, value: "" },
        fillType: { active: false, value: "" },
        flangeStyle: { active: false, value: "" },
        stitchType: { active: false, value: "" },
        seamCount: { active: false, value: "" },
        projection: { active: false, value: "" }
    });

    // --- DATA FETCHING ---
    useEffect(() => {
        if (!activeBrand) return;
        const q = query(collection(db, "Approved_Designs"));
        const unsub = onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
            docs.sort((a, b) => (a.legacyErpId || a.itemName).localeCompare(b.legacyErpId || b.itemName));
            setInventory(docs);
        });
        return () => unsub();
    }, [activeBrand]);

    useEffect(() => {
        const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
            if (docSnap.exists()) setGlobalLists(prev => ({ ...prev, ...docSnap.data() }));
        });
        const unsubCols = onSnapshot(collection(db, "hq_collections"), snap => {
            setCollectionsData(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        const unsubWin = onSnapshot(doc(db, "system", "window_config"), (docSnap) => {
            if (docSnap.exists()) setWindowConfig({ system: { ...DEFAULT_SYSTEM_WINDOWS, ...(docSnap.data().system || {}) } });
        });
        return () => { unsubLists(); unsubCols(); unsubWin(); };
    }, []);

    // --- FILTERING & SELECTION ---
    const filteredInventory = inventory.filter(part => {
        if (!searchTerm) return false; 
        const term = searchTerm.toLowerCase();
        return part.itemName?.toLowerCase().includes(term) || 
               (part.legacyErpId && part.legacyErpId.toLowerCase().includes(term)) || 
               (part.itemId && part.itemId.toLowerCase().includes(term));
    });

    const toggleSelection = (id) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id); else newSet.add(id);
        setSelectedIds(newSet);
    };

    const handleSelectAll = () => {
        if (selectedIds.size === filteredInventory.length) {
            setSelectedIds(new Set()); // Deselect all
        } else {
            setSelectedIds(new Set(filteredInventory.map(item => item.id))); // Select all
        }
    };

    const handleUpdateChange = (field, key, val) => {
        setUpdates(prev => ({ ...prev, [field]: { ...prev[field], [key]: val } }));
    };

    // --- BATCH EXECUTION ---
    const executeMassUpdate = async () => {
        const activeUpdates = Object.entries(updates).filter(([k, v]) => v.active);
        if (selectedIds.size === 0) return alert("Please select at least one item to update.");
        if (activeUpdates.length === 0) return alert("Please enable at least one field to update.");
        
        if (!window.confirm(`WARNING: You are about to overwrite ${activeUpdates.length} field(s) across ${selectedIds.size} records. This cannot be undone. Proceed?`)) return;

        setIsUpdating(true);
        setProgress(0);

        try {
            const idsArray = Array.from(selectedIds);
            const chunkSize = 400; // Firestore limit is 500 writes per batch
            
            for (let i = 0; i < idsArray.length; i += chunkSize) {
                const chunk = idsArray.slice(i, i + chunkSize);
                const batch = writeBatch(db);

                chunk.forEach(id => {
                    const ref = doc(db, "Approved_Designs", id);
                    const targetPart = inventory.find(p => p.id === id);
                    const payload = {};

                    activeUpdates.forEach(([fieldKey, config]) => {
                        const val = config.value;
                        
                        // Handle Root Level Fields & Spec Level Fields
                        if (fieldKey === 'productType' || fieldKey === 'routingType' || fieldKey === 'project') {
                            payload[fieldKey] = val;
                            payload[`manufacturingSpecs.${fieldKey}`] = val;
                        } else if (fieldKey === 'collection') {
                            // Ensure collections array exists and push the new collection
                            const currentCols = targetPart?.manufacturingSpecs?.collections || [];
                            if (!currentCols.includes(val)) {
                                payload['manufacturingSpecs.collections'] = [...currentCols, val];
                            }
                        } else if (fieldKey === 'isInHouse') {
                            payload['manufacturingSpecs.isInHouse'] = val;
                            payload.partClass = val ? "Inventory" : "Inventory"; 
                        } else if (fieldKey === 'projection') {
                            // Route directly into customData metadata for CPQ rules
                            payload[`manufacturingSpecs.customData.${fieldKey}`] = val;
                        } else {
                            // Standard manufacturingSpecs injection
                            payload[`manufacturingSpecs.${fieldKey}`] = val;
                        }
                    });

                    payload.updatedAt = new Date().toISOString();
                    payload.updatedBy = currentUser;
                    
                    batch.update(ref, payload);
                });

                await batch.commit();
                setProgress(Math.round(((i + chunk.length) / idsArray.length) * 100));
            }

            alert("✅ Mass update completed successfully!");
            setSelectedIds(new Set()); // Clear selection
            
            // Reset active toggles
            const resetUpdates = { ...updates };
            Object.keys(resetUpdates).forEach(k => resetUpdates[k].active = false);
            setUpdates(resetUpdates);

        } catch (error) {
            console.error("Mass Update Error:", error);
            alert("Failed to complete mass update. See console for details.");
        }
        
        setIsUpdating(false);
        setProgress(0);
    };

    // Styling constants
    const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)' };
    const fieldStyle = { width: '100%', padding: '10px', border: `1px solid ${theme.line}`, fontFamily: 'var(--sans)', fontSize: '0.9rem', outline: 'none' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: theme.ink }}>Mass Library Operations</h2>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginTop: '4px' }}>BATCH UPDATE METADATA & CPQ RULES</span>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '14px', color: theme.brass, fontWeight: 'bold' }}>{selectedIds.size} Records Selected</div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
                
                {/* LEFT: SELECTION PANEL */}
                <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', height: '70vh', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '20px', background: theme.paper2, borderBottom: `1px solid ${theme.line}` }}>
                        <input 
                            placeholder="Range Filter (e.g., 'H1-75BE')..." 
                            value={searchTerm} 
                            onChange={(e) => setSearchTerm(e.target.value)} 
                            style={{ ...fieldStyle, fontSize: '1rem', padding: '12px' }} 
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: theme.inkSoft, textTransform: 'uppercase' }}>Showing {filteredInventory.length} Results</span>
                            <button onClick={handleSelectAll} disabled={filteredInventory.length === 0} style={{ background: 'transparent', border: `1px solid ${theme.ink}`, color: theme.ink, padding: '6px 12px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>
                                {selectedIds.size > 0 && selectedIds.size === filteredInventory.length ? 'Deselect All' : 'Select All Filtered'}
                            </button>
                        </div>
                    </div>

                    <div style={{ overflowY: 'auto', flex: 1, padding: '10px' }}>
                        {!searchTerm ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft, fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: '1.2rem' }}>
                                Type in the search box to find items to batch update.
                            </div>
                        ) : filteredInventory.length === 0 ? (
                            <div style={{ padding: '40px', textAlign: 'center', color: theme.inkSoft }}>No matching items found.</div>
                        ) : (
                            filteredInventory.map(part => (
                                <label key={part.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderBottom: `1px solid ${theme.paper2}`, cursor: 'pointer', background: selectedIds.has(part.id) ? theme.paper2 : '#fff' }}>
                                    <input type="checkbox" checked={selectedIds.has(part.id)} onChange={() => toggleSelection(part.id)} style={{ cursor: 'pointer', width: '16px', height: '16px' }} />
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontFamily: 'var(--mono)', fontSize: '11px', color: theme.ink, fontWeight: selectedIds.has(part.id) ? 'bold' : 'normal' }}>{part.legacyErpId && part.legacyErpId !== "PENDING" ? part.legacyErpId : part.itemId}</span>
                                        <span style={{ fontSize: '0.85rem', color: theme.inkSoft }}>{part.itemName}</span>
                                    </div>
                                </label>
                            ))
                        )}
                    </div>
                </div>

                {/* RIGHT: CONFIGURATION PANEL */}
                <div style={{ flex: 1.2, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', height: '70vh', overflowY: 'auto' }}>
                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>
                        Metadata Injection Rules
                        <span style={{ display: 'block', fontFamily: 'var(--sans)', fontSize: '0.85rem', color: theme.inkSoft, fontWeight: 'normal', marginTop: '4px' }}>
                            Check the box next to a field to enable it. Only enabled fields will be applied to the selected records.
                        </span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                        
                        {/* PRODUCT TYPE */}
                        {windowConfig.system.prodTypes?.includes(activeBrand) && (
                            <div style={{ background: updates.productType.active ? theme.paper : 'transparent', border: `1px solid ${updates.productType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.productType.active} onChange={(e) => handleUpdateChange('productType', 'active', e.target.checked)} />
                                    Overwrite Product Type
                                </label>
                                <select disabled={!updates.productType.active} value={updates.productType.value} onChange={(e) => handleUpdateChange('productType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.productType.active ? 1 : 0.5 }}>
                                    <option value="">Select Type...</option>
                                    {(globalLists.prodTypes || []).map(pt => <option key={pt} value={pt.toUpperCase()}>{pt}</option>)}
                                </select>
                            </div>
                        )}

                        {/* ROUTING TYPE */}
                        <div style={{ background: updates.routingType.active ? theme.paper : 'transparent', border: `1px solid ${updates.routingType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.routingType.active} onChange={(e) => handleUpdateChange('routingType', 'active', e.target.checked)} />
                                Overwrite Routing Type
                            </label>
                            <select disabled={!updates.routingType.active} value={updates.routingType.value} onChange={(e) => handleUpdateChange('routingType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.routingType.active ? 1 : 0.5 }}>
                                <option value="">Select Routing...</option>
                                <optgroup label="Raw Materials">{(globalLists.inventoryTypes || []).map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
                                <optgroup label="Assemblies">{(globalLists.assemblyTypes || []).map(t => <option key={t} value={t}>{t}</option>)}</optgroup>
                            </select>
                        </div>

                        {/* UOM */}
                        {windowConfig.system.uom?.includes(activeBrand) && (
                            <div style={{ background: updates.uom.active ? theme.paper : 'transparent', border: `1px solid ${updates.uom.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.uom.active} onChange={(e) => handleUpdateChange('uom', 'active', e.target.checked)} />
                                    Overwrite UOM
                                </label>
                                <select disabled={!updates.uom.active} value={updates.uom.value} onChange={(e) => handleUpdateChange('uom', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.uom.active ? 1 : 0.5 }}>
                                    <option value="">Select UOM...</option>
                                    {(globalLists.uom || []).map(u => <option key={u} value={u.toUpperCase()}>{u}</option>)}
                                </select>
                            </div>
                        )}

                        {/* VENDOR */}
                        {windowConfig.system.vendors?.includes(activeBrand) && (
                            <div style={{ background: updates.vendorName.active ? theme.paper : 'transparent', border: `1px solid ${updates.vendorName.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.vendorName.active} onChange={(e) => handleUpdateChange('vendorName', 'active', e.target.checked)} />
                                    Overwrite Approved Vendor
                                </label>
                                <select disabled={!updates.vendorName.active} value={updates.vendorName.value} onChange={(e) => handleUpdateChange('vendorName', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.vendorName.active ? 1 : 0.5 }}>
                                    <option value="">Select Vendor...</option>
                                    {(globalLists.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}
                                </select>
                            </div>
                        )}

                        {/* WATCHLIST */}
                        {windowConfig.system.watchLists?.includes(activeBrand) && (
                            <div style={{ background: updates.watchList.active ? theme.paper : 'transparent', border: `1px solid ${updates.watchList.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.watchList.active} onChange={(e) => handleUpdateChange('watchList', 'active', e.target.checked)} />
                                    Assign to Watchlist
                                </label>
                                <select disabled={!updates.watchList.active} value={updates.watchList.value} onChange={(e) => handleUpdateChange('watchList', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.watchList.active ? 1 : 0.5 }}>
                                    <option value="NONE">None</option>
                                    {(globalLists.watchLists || []).map(w => <option key={w} value={w.toUpperCase()}>{w}</option>)}
                                </select>
                            </div>
                        )}

                        {/* PART HANDLING */}
                        {windowConfig.system.partHandling?.includes(activeBrand) && (
                            <div style={{ background: updates.partHandling.active ? theme.paper : 'transparent', border: `1px solid ${updates.partHandling.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.partHandling.active} onChange={(e) => handleUpdateChange('partHandling', 'active', e.target.checked)} />
                                    Set Part Handling
                                </label>
                                <select disabled={!updates.partHandling.active} value={updates.partHandling.value} onChange={(e) => handleUpdateChange('partHandling', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.partHandling.active ? 1 : 0.5 }}>
                                    <option value="">Unassigned</option>
                                    {(globalLists.partHandling || []).map(ph => <option key={ph} value={ph}>{ph}</option>)}
                                </select>
                            </div>
                        )}

                        {/* OUTSOURCE ACTIONS */}
                        {windowConfig.system.outsourceActions?.includes(activeBrand) && (
                            <div style={{ background: updates.outsourceAction.active ? theme.paper : 'transparent', border: `1px solid ${updates.outsourceAction.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.outsourceAction.active} onChange={(e) => handleUpdateChange('outsourceAction', 'active', e.target.checked)} />
                                    Overwrite Outsource Action
                                </label>
                                <select disabled={!updates.outsourceAction.active} value={updates.outsourceAction.value} onChange={(e) => handleUpdateChange('outsourceAction', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.outsourceAction.active ? 1 : 0.5 }}>
                                    <option value="">Select Action...</option>
                                    {(globalLists.outsourceActions || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* PILLOW SIZES */}
                        {windowConfig.system.pillowSizes?.includes(activeBrand) && (
                            <div style={{ background: updates.pillowSize.active ? theme.paper : 'transparent', border: `1px solid ${updates.pillowSize.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.pillowSize.active} onChange={(e) => handleUpdateChange('pillowSize', 'active', e.target.checked)} />
                                    Overwrite Pillow Size
                                </label>
                                <select disabled={!updates.pillowSize.active} value={updates.pillowSize.value} onChange={(e) => handleUpdateChange('pillowSize', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.pillowSize.active ? 1 : 0.5 }}>
                                    <option value="">Select Size...</option>
                                    {(globalLists.pillowSizes || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* FILL TYPES */}
                        {windowConfig.system.fillTypes?.includes(activeBrand) && (
                            <div style={{ background: updates.fillType.active ? theme.paper : 'transparent', border: `1px solid ${updates.fillType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.fillType.active} onChange={(e) => handleUpdateChange('fillType', 'active', e.target.checked)} />
                                    Overwrite Fill Type
                                </label>
                                <select disabled={!updates.fillType.active} value={updates.fillType.value} onChange={(e) => handleUpdateChange('fillType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.fillType.active ? 1 : 0.5 }}>
                                    <option value="">Select Fill...</option>
                                    {(globalLists.fillTypes || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* FLANGE STYLES */}
                        {windowConfig.system.flangeStyles?.includes(activeBrand) && (
                            <div style={{ background: updates.flangeStyle.active ? theme.paper : 'transparent', border: `1px solid ${updates.flangeStyle.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.flangeStyle.active} onChange={(e) => handleUpdateChange('flangeStyle', 'active', e.target.checked)} />
                                    Overwrite Flange / Edge Style
                                </label>
                                <select disabled={!updates.flangeStyle.active} value={updates.flangeStyle.value} onChange={(e) => handleUpdateChange('flangeStyle', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.flangeStyle.active ? 1 : 0.5 }}>
                                    <option value="">Select Style...</option>
                                    {(globalLists.flangeStyles || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* STITCH TYPES */}
                        {windowConfig.system.stitchTypes?.includes(activeBrand) && (
                            <div style={{ background: updates.stitchType.active ? theme.paper : 'transparent', border: `1px solid ${updates.stitchType.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.stitchType.active} onChange={(e) => handleUpdateChange('stitchType', 'active', e.target.checked)} />
                                    Overwrite Stitch Routing
                                </label>
                                <select disabled={!updates.stitchType.active} value={updates.stitchType.value} onChange={(e) => handleUpdateChange('stitchType', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.stitchType.active ? 1 : 0.5 }}>
                                    <option value="">Select Routing...</option>
                                    {(globalLists.stitchTypes || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* SEAM COUNTS */}
                        {windowConfig.system.seamCounts?.includes(activeBrand) && (
                            <div style={{ background: updates.seamCount.active ? theme.paper : 'transparent', border: `1px solid ${updates.seamCount.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.seamCount.active} onChange={(e) => handleUpdateChange('seamCount', 'active', e.target.checked)} />
                                    Overwrite Seam Count
                                </label>
                                <select disabled={!updates.seamCount.active} value={updates.seamCount.value} onChange={(e) => handleUpdateChange('seamCount', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.seamCount.active ? 1 : 0.5 }}>
                                    <option value="">Select Seam Count...</option>
                                    {(globalLists.seamCounts || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* BRACKET PROJECTIONS */}
                        {windowConfig.system.projections?.includes(activeBrand) && (
                            <div style={{ background: updates.projection.active ? theme.paper : 'transparent', border: `1px solid ${updates.projection.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.projection.active} onChange={(e) => handleUpdateChange('projection', 'active', e.target.checked)} />
                                    Overwrite Bracket Projection
                                </label>
                                <select disabled={!updates.projection.active} value={updates.projection.value} onChange={(e) => handleUpdateChange('projection', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.projection.active ? 1 : 0.5 }}>
                                    <option value="">Select Projection...</option>
                                    {(globalLists.projections || []).map(x => <option key={x} value={x}>{x}</option>)}
                                </select>
                            </div>
                        )}

                        {/* SOURCING FLAG */}
                        <div style={{ background: updates.isInHouse.active ? theme.paper : 'transparent', border: `1px solid ${updates.isInHouse.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                <input type="checkbox" checked={updates.isInHouse.active} onChange={(e) => handleUpdateChange('isInHouse', 'active', e.target.checked)} />
                                Set Sourcing (In-House vs Outsourced)
                            </label>
                            <select disabled={!updates.isInHouse.active} value={updates.isInHouse.value.toString()} onChange={(e) => handleUpdateChange('isInHouse', 'value', e.target.value === 'true')} style={{ ...fieldStyle, opacity: updates.isInHouse.active ? 1 : 0.5 }}>
                                <option value="true">Manufactured In-House</option>
                                <option value="false">Outsourced / Purchased</option>
                            </select>
                        </div>
                        
                        {/* COLLECTIONS (APPEND) */}
                        {windowConfig.system.collections?.includes(activeBrand) && (
                            <div style={{ background: updates.collection.active ? theme.paper : 'transparent', border: `1px solid ${updates.collection.active ? theme.brass : theme.line}`, padding: '16px', transition: 'all 0.2s', gridColumn: 'span 2' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '12px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: theme.ink }}>
                                    <input type="checkbox" checked={updates.collection.active} onChange={(e) => handleUpdateChange('collection', 'active', e.target.checked)} />
                                    Add to Collection (Appends to existing array)
                                </label>
                                <select disabled={!updates.collection.active} value={updates.collection.value} onChange={(e) => handleUpdateChange('collection', 'value', e.target.value)} style={{ ...fieldStyle, opacity: updates.collection.active ? 1 : 0.5 }}>
                                    <option value="">Select Collection...</option>
                                    {collectionsData.map(c => <option key={c.id} value={c.name.toUpperCase()}>{c.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                        {isUpdating ? (
                            <div style={{ background: theme.paper, height: '40px', border: `1px solid ${theme.line}`, overflow: 'hidden', position: 'relative' }}>
                                <div style={{ background: theme.brass, height: '100%', width: `${progress}%`, transition: 'width 0.2s' }}></div>
                                <div style={{ position: 'absolute', top: '12px', width: '100%', textAlign: 'center', fontFamily: 'var(--mono)', color: progress > 50 ? '#fff' : theme.ink, fontSize: '11px', letterSpacing: '.1em' }}>PROCESSING BATCH: {progress}%</div>
                            </div>
                        ) : (
                            <button 
                                onClick={executeMassUpdate}
                                disabled={selectedIds.size === 0 || !Object.values(updates).some(v => v.active)}
                                style={{ width: '100%', padding: '16px', background: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? theme.ink : theme.paper2, color: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? '#fff' : theme.inkSoft, border: 'none', cursor: (selectedIds.size > 0 && Object.values(updates).some(v => v.active)) ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.3s ease' }}
                            >
                                EXECUTE MASS UPDATE ON {selectedIds.size} RECORD(S)
                            </button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
};

export default LibraryMassUpdateTab;