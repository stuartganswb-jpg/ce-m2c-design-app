import React, { useState, useEffect } from 'react';
import { finishingDb as db } from '../../firebase';
import { collection, onSnapshot } from "firebase/firestore";

const FloorAssetViewer = ({ activeBrand }) => {
    const [assets, setAssets] = useState([]);
    const [recipes, setRecipes] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    
    const [activeAsset, setActiveAsset] = useState(null);
    const [isZoomed, setIsZoomed] = useState(false);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "global_assets"), (snap) => {
            if (!snap || !snap.docs) return;
            let fetchedAssets = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            fetchedAssets.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
            setAssets(fetchedAssets);
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        const unsub = onSnapshot(collection(db, "fin_recipes"), (snap) => {
            if (!snap || !snap.docs) return;
            setRecipes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
        });
        return () => unsub();
    }, []);

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
        setIsZoomed(false); 
        setActiveAsset(asset);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '30px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
            
            {/* HEADER & SEARCH */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
                <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Quick Search Reference & Instructions</span>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Finishing Visual Dictionary</h2>
                </div>
                
                <div style={{ flex: 0.6, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.2rem', opacity: 0.5 }}>🔍</span>
                    <input 
                        type="text" 
                        placeholder="Scan or type Finish ID, Pattern, or Customer..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '16px 16px 16px 48px', fontSize: '1rem', fontFamily: 'var(--sans)', border: '1px solid var(--line)', borderRadius: '2px', outline: 'none', boxSizing: 'border-box', background: 'var(--paper)', color: 'var(--ink)' }}
                    />
                </div>
            </div>

            {/* ASSET GRID (VIEW ONLY) */}
            <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', minHeight: '60vh' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '24px' }}>
                    {filteredAssets.length === 0 ? (
                        <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px', color: 'var(--ink-soft)', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontStyle: 'italic' }}>
                            No matching images found.
                        </div>
                    ) : (
                        filteredAssets.slice(0, 100).map(asset => (
                            <div key={asset.id} onClick={() => openModal(asset)} style={{ border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s ease', background: '#fff' }} onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--brass)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.05)'; }} onMouseOut={e => { e.currentTarget.style.borderColor = 'var(--line)'; e.currentTarget.style.boxShadow = 'none'; }}>
                                
                                <div style={{ position: 'relative', width: '100%', height: '240px', background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', borderBottom: '1px solid var(--line)' }}>
                                    {asset.thumbnailUrl || asset.url ? <img src={asset.thumbnailUrl || asset.url} alt={asset.patternId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : <span style={{fontSize:'2rem', opacity: 0.2}}>🖼️</span>}
                                    
                                    <div style={{ position: 'absolute', bottom: '12px', left: '12px', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'rgba(255,255,255,0.9)', padding: '4px 8px', borderRadius: '2px', border: '1px solid var(--line)', zIndex: 2 }}>
                                        {String(asset.patternId || '')}{asset.finishId ? `/${String(asset.finishId)}` : ''}
                                    </div>
                                    
                                    {(asset.clientSku || asset.customerPartId) && (
                                        <div style={{ position: 'absolute', top: '12px', right: '12px', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em', background: 'var(--paper-2)', padding: '4px 8px', borderRadius: '2px', border: '1px solid var(--line)', zIndex: 2 }}>
                                            Cust: {String(asset.clientSku || asset.customerPartId)}
                                        </div>
                                    )}
                                </div>

                                <div style={{ padding: '16px', background: '#fff' }}>
                                    <div style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500, color: 'var(--ink)' }}>{asset.finishId || 'No Finish ID'}</div>
                                    <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>Part: {asset.patternId || 'N/A'}</div>
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
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
                        <div style={{ background: '#fff', border: '1px solid var(--line)', width: '100%', maxWidth: '1400px', height: '90vh', display: 'flex', borderRadius: '2px', boxShadow: '0 12px 48px rgba(0,0,0,0.2)', overflow: 'hidden' }}>
                            
                            <div 
                                style={{ flex: 1.5, background: 'var(--paper)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', position: 'relative', overflow: 'hidden', cursor: isZoomed ? 'zoom-out' : 'zoom-in' }}
                                onClick={() => setIsZoomed(!isZoomed)}
                            >
                                <img 
                                    src={activeAsset.originalUrl || activeAsset.url} 
                                    alt="Master Reference" 
                                    style={{ 
                                        maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 12px 40px rgba(0,0,0,0.1)', border: '1px solid var(--line)', background: '#fff',
                                        transform: isZoomed ? 'scale(2)' : 'scale(1)', transition: 'transform 0.3s cubic-bezier(0.2, 0, 0, 1)'
                                    }} 
                                />
                                
                                {!isZoomed && (
                                    <div style={{ position: 'absolute', top: '24px', right: '24px', background: 'rgba(255,255,255,0.9)', color: 'var(--ink)', border: '1px solid var(--line)', padding: '8px 16px', borderRadius: '2px', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', pointerEvents: 'none' }}>
                                        Click to Zoom
                                    </div>
                                )}
                            </div>

                            <div style={{ flex: 1, borderLeft: '1px solid var(--line)', padding: '40px', display: 'flex', flexDirection: 'column', background: '#fff', overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--line)', paddingBottom: '20px', marginBottom: '30px' }}>
                                    <div>
                                        <h2 style={{ margin: 0, color: 'var(--ink)', fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500 }}>{activeAsset.finishId || 'No Finish ID'}</h2>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)', marginTop: '8px' }}>Ref Part: {activeAsset.patternId || 'N/A'}</div>
                                    </div>
                                    <button onClick={() => { setActiveAsset(null); setIsZoomed(false); }} style={{ background: 'none', color: 'var(--ink-soft)', border: 'none', fontSize: '2rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color 0.2s' }} onMouseOver={e => e.currentTarget.style.color='var(--ink)'} onMouseOut={e => e.currentTarget.style.color='var(--ink-soft)'}>×</button>
                                </div>

                                <div style={{ marginBottom: '40px' }}>
                                    <h3 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>Recipe Builder Steps</h3>
                                    {!linkedRecipe ? (
                                        <div style={{ padding: '20px', background: 'var(--paper)', border: '1px dashed var(--line)', color: 'var(--ink-soft)', fontStyle: 'italic', fontSize: '0.95rem' }}>
                                            No recipe profile exists for "{activeAsset.finishId}". A floor manager must build this in the Recipes tab first.
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {linkedRecipe.steps.map(st => (
                                                <div key={st.step} style={{ display: 'flex', alignItems: 'center', background: 'var(--paper-2)', padding: '16px 20px', border: '1px solid var(--line)' }}>
                                                    <b style={{ width: '40px', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '11px' }}>S{st.step}</b> 
                                                    <span style={{ flex: 1, fontFamily: 'var(--sans)', fontSize: '1rem', color: 'var(--ink)' }}>{st.color}</span>
                                                    <span style={{ background: st.app === 'Sprayed' ? 'var(--ink)' : 'var(--paper)', color: st.app === 'Sprayed' ? '#fff' : 'var(--ink)', border: st.app === 'Sprayed' ? 'none' : '1px solid var(--line)', padding: '6px 12px', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{st.app}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                    <h3 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                                        Application Instructions
                                    </h3>
                                    
                                    <div style={{ flex: 1, padding: '24px', background: 'var(--paper)', border: '1px solid var(--line)', fontSize: '1rem', fontFamily: 'var(--sans)', whiteSpace: 'pre-wrap', overflowY: 'auto', color: linkedRecipe?.instructions ? 'var(--ink)' : 'var(--ink-soft)', lineHeight: '1.8' }}>
                                        {linkedRecipe?.instructions || "No finishing instructions have been saved for this recipe yet. Instructions are entered via the Master Recipe Builder tab."}
                                    </div>
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