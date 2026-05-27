import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

const FloorAssetViewer = ({ activeBrand }) => {
    const [assets, setAssets] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    
    const [activeAsset, setActiveAsset] = useState(null);
    const [instructions, setInstructions] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // 1. Fetch all Global Assets (Read-Only)
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "global_assets"), (snap) => {
            if (!snap || !snap.docs) return;
            let fetchedAssets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            // Sort newest first
            fetchedAssets.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setAssets(fetchedAssets);
        });
        return () => unsub();
    }, []);

    // 2. Fetch Finish Recipes to link them to the images
    useEffect(() => {
        const unsub = onSnapshot(collection(db, "fin_recipes"), (snap) => {
            if (!snap || !snap.docs) return;
            setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

    // Filter logic for the floor (Quick Search)
    const filteredAssets = assets.filter(asset => {
        if (!searchQuery) return true;
        const q = String(searchQuery).toLowerCase();
        const n = String(asset?.name || "").toLowerCase();
        const p = String(asset?.patternId || "").toLowerCase();
        const f = String(asset?.finishId || "").toLowerCase();
        const c = String(asset?.customerPartId || "").toLowerCase();
        return n.includes(q) || p.includes(q) || f.includes(q) || c.includes(q);
    });

    const openModal = (asset) => {
        setActiveAsset(asset);
        // Find the matching recipe based on the asset's finish ID
        const linkedRecipe = recipes.find(r => r.code === asset.finishId);
        // Load existing instructions if they exist, otherwise blank
        setInstructions(linkedRecipe?.instructions || '');
    };

    const handleSaveInstructions = async () => {
        const linkedRecipe = recipes.find(r => r.code === activeAsset.finishId);
        if (!linkedRecipe) {
            return alert("No recipe built for this Finish ID yet. Please build the recipe first in the 'Recipes' tab.");
        }
        
        setIsSaving(true);
        try {
            await updateDoc(doc(db, "fin_recipes", linkedRecipe.code), { instructions });
            setTimeout(() => setIsSaving(false), 800);
        } catch (error) {
            console.error("Failed to save instructions:", error);
            alert("Error saving instructions.");
            setIsSaving(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            
            {/* HEADER & SEARCH */}
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
                <div>
                    <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.6rem', color: '#CC6600' }}>FINISHING VISUAL DICTIONARY</h2>
                    <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>QUICK SEARCH REFERENCE & INSTRUCTIONS</span>
                </div>
                
                <div style={{ flex: 0.6, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.2rem' }}>🔍</span>
                    <input 
                        type="text" 
                        placeholder="Scan or type Finish ID, Pattern, or Customer..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '15px 15px 15px 45px', fontSize: '1.2rem', border: '3px solid #CC6600', borderRadius: '8px', outline: 'none', fontWeight: 'bold', boxSizing: 'border-box' }}
                    />
                </div>
            </div>

            {/* ASSET GRID (VIEW ONLY) */}
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)', minHeight: '60vh' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '20px' }}>
                    {filteredAssets.length === 0 ? (
                        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '50px', color: '#888', fontWeight: 'bold', fontSize: '1.2rem' }}>
                            NO MATCHING IMAGES FOUND
                        </div>
                    ) : (
                        filteredAssets.slice(0, 100).map(asset => (
                            <div key={asset.id} onClick={() => openModal(asset)} style={{ border: '2px solid #ccc', borderRadius: '8px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: '0.2s', background: '#f8f9fa' }} onMouseOver={e => e.currentTarget.style.borderColor = '#CC6600'} onMouseOut={e => e.currentTarget.style.borderColor = '#ccc'}>
                                <div style={{ position: 'relative', width: '100%', height: '220px', background: '#e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    {asset.thumbnailUrl || asset.url ? <img src={asset.thumbnailUrl || asset.url} alt={asset.patternId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : <span style={{fontSize:'2rem'}}>🖼️</span>}
                                </div>
                                <div style={{ padding: '12px', background: '#fff', borderTop: '1px solid #ccc' }}>
                                    <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: '#000' }}>{asset.finishId || 'NO FINISH ID'}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '4px' }}>PART: {asset.patternId || 'N/A'}</div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* FOCUSED VIEW & INSTRUCTIONS MODAL */}
            {activeAsset && (() => {
                const linkedRecipe = recipes.find(r => r.code === activeAsset.finishId);
                
                return (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div style={{ background: '#fff', border: '4px solid #000', width: '95%', maxWidth: '1400px', height: '90vh', display: 'flex', boxShadow: '20px 20px 0 #000', overflow: 'hidden' }}>
                            
                            {/* LEFT: FULL SIZE IMAGE */}
                            <div style={{ flex: 1.5, background: '#e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                                <img src={activeAsset.originalUrl || activeAsset.url} alt="Master Reference" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 10px 30px rgba(0,0,0,0.3)', border: '2px solid #ccc' }} />
                            </div>

                            {/* RIGHT: RECIPE & INSTRUCTIONS PANEL */}
                            <div style={{ flex: 1, borderLeft: '4px solid #000', padding: '30px', display: 'flex', flexDirection: 'column', background: '#f8f9fa', overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '4px solid #000', paddingBottom: '15px', marginBottom: '20px' }}>
                                    <div>
                                        <h2 style={{ margin: 0, color: '#CC6600', fontSize: '2rem' }}>{activeAsset.finishId || 'NO FINISH ID'}</h2>
                                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#666', marginTop: '5px' }}>REFERENCE PART: {activeAsset.patternId || 'N/A'}</div>
                                    </div>
                                    <button onClick={() => setActiveAsset(null)} style={{ background: '#000', color: '#fff', border: 'none', fontSize: '1.5rem', fontWeight: 'bold', width: '40px', height: '40px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                                </div>

                                {/* RECIPE DATA */}
                                <div style={{ marginBottom: '25px' }}>
                                    <h3 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #ccc', paddingBottom: '5px' }}>🧪 RECIPE BUILDER STEPS</h3>
                                    {!linkedRecipe ? (
                                        <div style={{ padding: '15px', background: '#fff3cd', border: '2px solid #ffc107', color: '#856404', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                            No recipe profile exists for "{activeAsset.finishId}". A floor manager must build this in the Recipes tab first.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {linkedRecipe.steps.map(st => (
                                                <div key={st.step} style={{ display: 'flex', alignItems: 'center', background: '#fff', padding: '10px 15px', border: '1px solid #ccc', fontSize: '0.9rem' }}>
                                                    <b style={{ width: '40px', color: '#CC6600' }}>S{st.step}:</b> 
                                                    <span style={{ flex: 1, fontWeight: 'bold' }}>{st.color}</span>
                                                    <span style={{ background: st.app === 'Sprayed' ? '#007bff' : '#ffc107', color: st.app === 'Sprayed' ? '#fff' : '#000', padding: '4px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold' }}>{st.app}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* FLOOR INSTRUCTIONS (SOP) */}
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <h3 style={{ margin: '0 0 10px 0', borderBottom: '2px solid #ccc', paddingBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>📋 APPLICATION INSTRUCTIONS</span>
                                    </h3>
                                    
                                    <textarea 
                                        value={instructions}
                                        onChange={(e) => setInstructions(e.target.value)}
                                        placeholder={linkedRecipe ? "Type step-by-step application instructions here (e.g. 'Scuff sand with 400 grit before applying S2...')" : "Create a recipe profile before adding instructions."}
                                        disabled={!linkedRecipe}
                                        style={{ flex: 1, padding: '15px', border: '2px solid #000', fontSize: '1rem', fontFamily: 'monospace', resize: 'none', background: !linkedRecipe ? '#eee' : '#fff', boxSizing: 'border-box' }}
                                    />
                                    
                                    <button 
                                        onClick={handleSaveInstructions} 
                                        disabled={!linkedRecipe}
                                        style={{ marginTop: '15px', padding: '15px', background: isSaving ? '#28a745' : (linkedRecipe ? '#000' : '#ccc'), color: '#fff', border: 'none', fontSize: '1.2rem', fontWeight: 'bold', cursor: linkedRecipe ? 'pointer' : 'not-allowed', transition: '0.2s', boxShadow: '4px 4px 0 rgba(0,0,0,0.2)' }}
                                    >
                                        {isSaving ? '✓ SAVED' : '💾 SAVE INSTRUCTIONS'}
                                    </button>
                                </div>

                            </div>
                        </div>
                    </div>
                );
            })()}

        </div>
    );
};

export default FloorAssetViewer;