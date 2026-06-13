import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const AssetGalleryTab = ({ currentUser, activeBrand }) => {
    const [assets, setAssets] = useState([]);
    const [hqParts, setHqParts] = useState([]);
    
    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [inhouseFinishes, setInhouseFinishes] = useState([]);

    const [globalLists, setGlobalLists] = useState({ prodTypes: [], customers: [] });
    const [collectionsData, setCollectionsData] = useState([]);

    const [searchQuery, setSearchQuery] = useState('');
    
    const [activeAsset, setActiveAsset] = useState(null); 
    const [isZoomed, setIsZoomed] = useState(false); 
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);

    const [metaForm, setMetaForm] = useState({ name: '', collection: '', productType: '', patternId: '', finishId: '', customerId: '', clientSku: '', notes: '', associatedParts: [], associatedFinishes: [] });
    const [uploadFile, setUploadFile] = useState(null);
    const fileInputRef = useRef(null);

    const [downloadSku, setDownloadSku] = useState("");

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
                if (docSnap.exists()) {
                    setGlobalLists({
                        prodTypes: docSnap.data().prodTypes || [],
                        customers: docSnap.data().customers || []
                    });
                    setMetaForm(prev => ({ 
                        ...prev, 
                        productType: prev.productType || (docSnap.data().prodTypes?.[0] || '')
                    }));
                }
            });
        } catch (err) { console.error("Global Lists Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(collection(db, "hq_collections"), snap => {
                setCollectionsData(snap.docs.map(d => ({id: d.id, ...d.data()})));
            });
        } catch (err) { console.error("Collections DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub = null;
        try {
            const q = query(collection(db, "global_assets"));
            unsub = onSnapshot(q, (snap) => {
                if (!snap || !snap.docs) return;
                let fetchedAssets = snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) }));
                fetchedAssets.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
                setAssets(fetchedAssets);
            });
        } catch (err) { console.error("Asset DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub = null;
        if (!activeBrand) return;
        try {
            unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
                if (!snap || !snap.docs) return;
                setHqParts(snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })));
            });
        } catch (err) { console.error("HQ DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, [activeBrand]);

    useEffect(() => {
        let unsub1, unsub2, unsub3;
        try {
            // In-house/global master finishes live in the system/master_finishes doc (canonical
            // source used by CPQ, Vision, Admin + the Mass-Update tab). The old hq_global_finishes /
            // hq_inhouse_finishes collections are dead (nothing writes them) — reading them left the
            // finish picker empty so assets couldn't be aligned to the master library finishes.
            unsub1 = onSnapshot(doc(db, "system", "master_finishes"), d => setGlobalFinishes((d.exists() && Array.isArray(d.data().finishes)) ? d.data().finishes : []), e => console.warn("Master Finishes Missing"));
            unsub2 = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Outsource Finishes Missing"));
            setInhouseFinishes([]);   // legacy collection, folded into master_finishes above
        } catch (err) { console.error("Finishes DB Error:", err); }
        return () => { 
            if (typeof unsub1 === 'function') unsub1(); 
            if (typeof unsub2 === 'function') unsub2(); 
            if (typeof unsub3 === 'function') unsub3(); 
        };
    }, []);

    const safeHqParts = Array.isArray(hqParts) ? hqParts : [];
    const safeAssets = Array.isArray(assets) ? assets : [];
    const allFinishes = [...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(outsourceFinishes)?outsourceFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])];
    
    const getAssetClientSKUs = (asset) => {
        if (!asset) return [];
        const skus = [];
        
        if (asset.customerId || asset.clientSku) {
            skus.push({ customerId: asset.customerId || 'UNKNOWN', clientSku: asset.clientSku || asset.customerPartId || '' });
        } else if (asset.customerPartId) { 
            skus.push({ customerId: 'CLIENT', clientSku: asset.customerPartId });
        }
        
        if (Array.isArray(asset.associatedParts)) {
            asset.associatedParts.forEach(pId => {
                const part = safeHqParts.find(p => p.id === pId);
                if (part && Array.isArray(part.clientPricing)) {
                    part.clientPricing.forEach(cp => {
                        skus.push({ customerId: cp.customerId, clientSku: cp.clientSku });
                    });
                }
            });
        }
        
        const unique = [];
        skus.forEach(s => {
            if(s.clientSku && !unique.find(u => u.clientSku === s.clientSku && u.customerId === s.customerId)) {
                unique.push(s);
            }
        });
        return unique;
    };

    const filteredAssets = safeAssets.filter(asset => {
        if (!searchQuery) return true;
        const q = String(searchQuery).toLowerCase();
        
        const n = String(asset?.name || "").toLowerCase();
        const p = String(asset?.patternId || "").toLowerCase();
        const f = String(asset?.finishId || "").toLowerCase();
        const custId = String(asset?.customerId || "").toLowerCase(); 
        const sku = String(asset?.clientSku || asset?.customerPartId || "").toLowerCase(); 
        const c = String(asset?.collection || asset?.category || "").toLowerCase();
        const t = String(asset?.productType || "").toLowerCase();
        const notes = String(asset?.notes || "").toLowerCase();
        
        const matchParts = Array.isArray(asset?.associatedParts) && asset.associatedParts.some(partId => {
            const partObj = safeHqParts.find(hp => hp.id === partId || hp.itemId === partId || hp.legacyErpId === partId);
            if (!partObj) return String(partId).toLowerCase().includes(q);
            return JSON.stringify(partObj).toLowerCase().includes(q);
        });

        // Also match the linked master finishes by id / code / descriptive name so a finish search
        // resolves against the master library (not just the asset's parsed finishId string).
        const matchFinishes = Array.isArray(asset?.associatedFinishes) && asset.associatedFinishes.some(finId => {
            const finObj = allFinishes.find(fo => fo.id === finId);
            if (!finObj) return String(finId).toLowerCase().includes(q);
            return [finObj.code, finObj.name, finObj.id].filter(Boolean).some(v => String(v).toLowerCase().includes(q));
        });

        return n.includes(q) || p.includes(q) || f.includes(q) || custId.includes(q) || sku.includes(q) || c.includes(q) || t.includes(q) || notes.includes(q) || matchParts || matchFinishes;
    });

    const MAX_DISPLAY = 100;
    const displayAssets = filteredAssets.slice(0, MAX_DISPLAY);

    const generateWatermarkedImages = (file, textStr) => {
        return new Promise((resolve) => {
            if (!file) return resolve({ hiResBlob: null, thumbBlob: null });
            const img = new Image();
            img.onload = () => {
                try {
                    const thCanvas = document.createElement('canvas');
                    const thCtx = thCanvas.getContext('2d');
                    thCanvas.width = 250;
                    thCanvas.height = 250;
                    const minDim = Math.min(img.width, img.height);
                    const sx = (img.width - minDim) / 2;
                    const sy = (img.height - minDim) / 2;
                    thCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 250, 250);

                    const thFontSize = 14;
                    thCtx.font = `bold ${thFontSize}px monospace`;
                    const thPad = thFontSize * 0.4;
                    const thTxtW = thCtx.measureText(textStr).width;
                    
                    const thBoxX = 250 - thTxtW - thPad * 3;
                    const thBoxY = 250 - thFontSize - thPad * 3;

                    thCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
                    thCtx.fillRect(thBoxX, thBoxY, thTxtW + thPad * 2, thFontSize + thPad * 2);
                    thCtx.fillStyle = '#333333';
                    thCtx.textBaseline = 'top';
                    thCtx.fillText(textStr, thBoxX + thPad, thBoxY + thPad * 1.5);

                    thCanvas.toBlob((thBlob) => {
                        resolve({ hiResBlob: file, thumbBlob: thBlob });
                    }, 'image/png', 0.9);

                } catch (err) { resolve({ hiResBlob: file, thumbBlob: null }); }
            };
            img.onerror = () => resolve({ hiResBlob: file, thumbBlob: null });
            try { img.src = URL.createObjectURL(file); } catch (e) { resolve({ hiResBlob: file, thumbBlob: null }); }
        });
    };

    const handleDynamicDownload = (url, textStr, color = '#333333', prefix = 'HQ') => {
        if (!textStr) return alert("Missing ID or SKU for watermark.");
        
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            try {
                const cvs = document.createElement('canvas');
                const ctx = cvs.getContext('2d');
                cvs.width = img.width; 
                cvs.height = img.height;
                ctx.drawImage(img, 0, 0);

                const fontSize = Math.max(18, Math.floor(img.height * 0.035));
                ctx.font = `bold ${fontSize}px monospace`;
                const pad = fontSize * 0.4;
                const txtW = ctx.measureText(textStr).width;

                const boxX = img.width - txtW - pad * 3;
                const boxY = img.height - fontSize - pad * 3;

                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.fillRect(boxX, boxY, txtW + pad * 2, fontSize + pad * 2);
                ctx.fillStyle = color;
                ctx.textBaseline = 'top';
                ctx.fillText(textStr, boxX + pad, boxY + pad * 1.5);

                cvs.toBlob(blob => {
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${prefix}_${textStr.replace(/[^A-Za-z0-9]/g, '_')}.png`;
                    a.click();
                }, 'image/png', 1.0);
            } catch (err) {
                alert("Canvas Error. Image might be too large or blocked. Right-click and save original instead.");
            }
        };
        img.onerror = () => alert("Security blocked this download. Please right-click the image and save.");
        img.src = url;
    };

    const handleUpload = async () => {
        if (!uploadFile) return alert("Please select a high-resolution image.");
        if (!metaForm.patternId) return alert("Please provide a Pattern/Item ID.");

        setIsUploading(true);
        try {
            const safePattern = String(metaForm.patternId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
            const safeFinish = String(metaForm.finishId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
            const displayId = safeFinish ? `${safePattern}/${safeFinish}` : safePattern;
            const safeUrlId = safeFinish ? `${safePattern}_${safeFinish}` : safePattern;
            
            const brandFolder = activeBrand ? String(activeBrand) : 'global';
            
            setUploadProgress(10);
            const { hiResBlob, thumbBlob } = await generateWatermarkedImages(uploadFile, displayId);
            setUploadProgress(30);

            const uniqueTimestamp = Date.now();
            const uniqueSuffix = Math.floor(Math.random() * 10000);
            const hiResRef = ref(storage, `global_assets/hires/${brandFolder}/${safeUrlId}_${uniqueTimestamp}_${uniqueSuffix}_original.png`);
            
            let hiResUrl = null;
            let thumbUrl = null;

            if (hiResBlob && thumbBlob) {
                const thumbRef = ref(storage, `global_assets/thumbs/${brandFolder}/${safeUrlId}_${uniqueTimestamp}_${uniqueSuffix}_thumb.png`);
                const [hiUpload, thUpload] = await Promise.all([
                    uploadBytes(hiResRef, hiResBlob),
                    uploadBytes(thumbRef, thumbBlob)
                ]);
                setUploadProgress(80);
                const urls = await Promise.all([ getDownloadURL(hiUpload.ref), getDownloadURL(thUpload.ref) ]);
                hiResUrl = urls[0];
                thumbUrl = urls[1];
            } else {
                const fallbackUpload = await uploadBytes(hiResRef, uploadFile);
                hiResUrl = await getDownloadURL(fallbackUpload.ref);
                thumbUrl = hiResUrl;
            }

            const assetDocId = `ASSET-${brandFolder}-${safeUrlId}-${uniqueTimestamp}-${uniqueSuffix}`;
            
            await setDoc(doc(db, "global_assets", assetDocId), {
                id: assetDocId,
                name: String(metaForm.name).toUpperCase(),
                collection: metaForm.collection,
                productType: metaForm.productType,
                patternId: String(metaForm.patternId).toUpperCase(),
                finishId: String(metaForm.finishId).toUpperCase(),
                customerId: metaForm.customerId || '',
                clientSku: String(metaForm.clientSku).toUpperCase(),
                notes: metaForm.notes,
                associatedParts: Array.isArray(metaForm.associatedParts) ? metaForm.associatedParts : [],
                associatedFinishes: Array.isArray(metaForm.associatedFinishes) ? metaForm.associatedFinishes : [],
                originalUrl: hiResUrl, 
                thumbnailUrl: thumbUrl, 
                url: thumbUrl, 
                brandId: activeBrand || 'ALL',
                uploadedBy: currentUser || 'Unknown',
                createdAt: serverTimestamp()
            }, { merge: true });

            setUploadProgress(100);
            setMetaForm({ name: '', collection: collectionsData[0]?.name||'', productType: globalLists.prodTypes[0]||'', patternId: '', finishId: '', customerId: '', clientSku: '', notes: '', associatedParts: [], associatedFinishes: [] });
            setUploadFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
            setTimeout(() => { setIsUploading(false); setUploadProgress(0); }, 500);

        } catch (error) { console.error(error); setIsUploading(false); setUploadProgress(0); }
    };

    const handleUpdateMetadata = async () => {
        if (!activeAsset || !activeAsset.id) return;
        try {
            await updateDoc(doc(db, "global_assets", activeAsset.id), {
                name: String(metaForm.name).toUpperCase(),
                collection: metaForm.collection,
                productType: metaForm.productType,
                patternId: String(metaForm.patternId).toUpperCase(),
                finishId: String(metaForm.finishId).toUpperCase(),
                customerId: metaForm.customerId || '',
                clientSku: String(metaForm.clientSku).toUpperCase(),
                notes: metaForm.notes,
                associatedParts: Array.isArray(metaForm.associatedParts) ? metaForm.associatedParts : [],
                associatedFinishes: Array.isArray(metaForm.associatedFinishes) ? metaForm.associatedFinishes : []
            });
            setActiveAsset(prev => ({ ...prev, ...metaForm }));
            alert("Metadata updated!");
        } catch (error) { console.error(error); alert("Failed to update."); }
    };

    const handleDeleteAsset = async (asset) => {
        if (!asset || !asset.id) return;
        if (!window.confirm(`Permanently delete this asset? This will remove the file from storage.`)) return;
        try {
            if (asset.originalUrl) await deleteObject(ref(storage, asset.originalUrl)).catch(e => console.warn("Original already deleted."));
            if (asset.thumbnailUrl && asset.thumbnailUrl !== asset.originalUrl) await deleteObject(ref(storage, asset.thumbnailUrl)).catch(e => console.warn("Thumb already deleted."));
            await deleteDoc(doc(db, "global_assets", asset.id));
            setActiveAsset(null);
        } catch (error) { console.error(error); alert("Failed to delete asset."); }
    };

    const openModal = (asset) => {
        setIsZoomed(false); 
        setMetaForm({
            name: asset?.name || '',
            collection: asset?.collection || asset?.category || collectionsData[0]?.name || '',
            productType: asset?.productType || globalLists.prodTypes[0] || '',
            patternId: asset?.patternId || '',
            finishId: asset?.finishId || '',
            customerId: asset?.customerId || '',
            clientSku: asset?.clientSku || asset?.customerPartId || '',
            notes: asset?.notes || '',
            associatedParts: Array.isArray(asset?.associatedParts) ? asset.associatedParts : [],
            associatedFinishes: Array.isArray(asset?.associatedFinishes) ? asset.associatedFinishes : []
        });
        setActiveAsset(asset);
        
        const skus = getAssetClientSKUs(asset);
        if(skus.length > 0) setDownloadSku(skus[0].clientSku);
        else setDownloadSku('');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>
            
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', borderRadius: '2px' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Dynamic Asset Gallery</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>SEARCHABLE DAM (SYNCED WITH TAB 4)</span>
                </div>
                
                <div style={{ flex: 0.6, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', fontSize: '1.2rem', color: theme.inkSoft }}>⚲</span>
                    <input 
                        type="text" 
                        placeholder="Deep Search (e.g. 'H1-75BS/EP01', 'CUST-888', 'Heavyweight')..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '12px 15px 12px 45px', fontSize: '0.95rem', fontFamily: theme.sans, border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box', backgroundColor: theme.paper }}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                
                {/* UPLOAD PANEL */}
                <div style={{ width: '350px', background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '15px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                    <div style={{ fontFamily: theme.serif, fontWeight: 500, fontSize: '1.4rem', color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>Upload New Asset</div>
                    
                    <input type="file" accept="image/png, image/jpeg" ref={fileInputRef} onChange={e => setUploadFile(e.target.files[0])} style={{ padding: '10px', border: `1px dashed ${theme.brass}`, background: theme.paper, cursor: 'pointer', width: '100%', boxSizing: 'border-box', fontFamily: theme.sans, fontSize: '0.85rem' }} />
                    <input type="text" placeholder="Friendly Name (Optional)" value={metaForm.name} onChange={e => setMetaForm({...metaForm, name: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans }} />
                    
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PATTERN ID</label>
                            <input type="text" placeholder="e.g. H1-75BS" value={metaForm.patternId} onChange={e => setMetaForm({...metaForm, patternId: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>FINISH ID</label>
                            <input type="text" placeholder="e.g. EP01" value={metaForm.finishId} onChange={e => setMetaForm({...metaForm, finishId: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CUSTOMER</label>
                            <select value={metaForm.customerId || ''} onChange={e => setMetaForm({...metaForm, customerId: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                <option value="">Select...</option>
                                {(globalLists.customers || []).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CLIENT SKU</label>
                            <input type="text" placeholder="e.g. CUST-999" value={metaForm.clientSku || ''} onChange={e => setMetaForm({...metaForm, clientSku: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans }} />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>COLLECTION</label>
                            <select value={metaForm.collection} onChange={e => setMetaForm({...metaForm, collection: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                <option value="">Select...</option>
                                {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PROD TYPE</label>
                            <select value={metaForm.productType} onChange={e => setMetaForm({...metaForm, productType: e.target.value})} style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                <option value="">Select...</option>
                                {globalLists.prodTypes.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    <textarea placeholder="Searchable Notes (e.g. 'Lifestyle angle')" value={metaForm.notes} onChange={e => setMetaForm({...metaForm, notes: e.target.value})} style={{ padding: '10px', border: `1px solid ${theme.line}`, minHeight: '60px', fontFamily: theme.sans, boxSizing: 'border-box', resize: 'vertical' }} />

                    {/* PARTS ASSIGNMENT */}
                    <select 
                        onChange={(e) => {
                            if (e.target.value && !metaForm.associatedParts.includes(e.target.value)) {
                                setMetaForm(prev => ({ ...prev, associatedParts: [...prev.associatedParts, e.target.value] }));
                            }
                        }} 
                        style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}
                    >
                        <option value="">+ Link to Master Library Part...</option>
                        {safeHqParts.slice(0, 200).map(p => <option key={p.id} value={p.id}>{String(p.itemName || p.id)}</option>)}
                    </select>

                    {metaForm.associatedParts.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {metaForm.associatedParts.map(partId => (
                                <span key={partId} style={{ background: theme.paper, color: theme.ink, padding: '4px 8px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.05em', border: `1px solid ${theme.line}`, borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    {String(safeHqParts.find(p => p.id === partId)?.itemName || partId)}
                                    <span onClick={() => setMetaForm(prev => ({...prev, associatedParts: prev.associatedParts.filter(id => id !== partId)}))} style={{ cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                </span>
                            ))}
                        </div>
                    )}

                    {/* FINISHES ASSIGNMENT */}
                    <select 
                        onChange={(e) => {
                            if (e.target.value && !metaForm.associatedFinishes.includes(e.target.value)) {
                                setMetaForm(prev => ({ ...prev, associatedFinishes: [...prev.associatedFinishes, e.target.value] }));
                            }
                        }} 
                        style={{ width: '100%', padding: '10px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}
                    >
                        <option value="">+ Link to Master Finish...</option>
                        <optgroup label="In-House & Global Finishes">
                            {[...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])].map(f => <option key={f.id} value={f.id}>{[f.code, f.name].filter(Boolean).join(' · ') || f.id}</option>)}
                        </optgroup>
                        <optgroup label="Outsourced Finishes">
                            {(Array.isArray(outsourceFinishes)?outsourceFinishes:[]).map(f => <option key={f.id} value={f.id}>{[f.code, f.name].filter(Boolean).join(' · ') || f.id}</option>)}
                        </optgroup>
                    </select>

                    {metaForm.associatedFinishes.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                            {metaForm.associatedFinishes.map(finId => (
                                <span key={finId} style={{ background: theme.paper, color: theme.ink, padding: '4px 8px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.05em', border: `1px solid ${theme.line}`, borderRadius: '2px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    {String(allFinishes.find(f => f.id === finId)?.name || finId)}
                                    <span onClick={() => setMetaForm(prev => ({...prev, associatedFinishes: prev.associatedFinishes.filter(id => id !== finId)}))} style={{ cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                </span>
                            ))}
                        </div>
                    )}

                    {isUploading ? (
                        <div style={{ background: theme.paper, height: '40px', border: `1px solid ${theme.line}`, overflow: 'hidden', position: 'relative', marginTop: '10px' }}>
                            <div style={{ background: theme.brass, height: '100%', width: `${uploadProgress}%`, transition: '0.2s' }}></div>
                            <div style={{ position: 'absolute', top: '10px', width: '100%', textAlign: 'center', fontFamily: theme.mono, color: uploadProgress > 50 ? '#fff' : theme.ink, fontSize: '10px', letterSpacing: '.1em' }}>UPLOADING {Math.round(uploadProgress)}%</div>
                        </div>
                    ) : (
                        <button onClick={handleUpload} style={{ background: theme.ink, color: '#fff', border: 'none', padding: '15px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', cursor: 'pointer', transition: 'background 0.2s', marginTop: '10px' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                            UPLOAD TO DAM
                        </button>
                    )}
                </div>

                {/* THE THUMBNAIL MASONRY GRID */}
                <div style={{ flex: 1, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', minHeight: '600px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                    
                    {filteredAssets.length > MAX_DISPLAY && (
                        <div style={{ background: theme.paper, border: `1px solid ${theme.brass}`, color: theme.brass, padding: '10px', textAlign: 'center', fontFamily: theme.sans, fontSize: '0.9rem' }}>
                            ⚠️ Showing {MAX_DISPLAY} of {filteredAssets.length} matching results. Keep typing to deep-search.
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '20px', alignContent: 'start' }}>
                        {displayAssets.length === 0 ? (
                            <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '50px', color: theme.inkSoft, fontFamily: theme.serif, fontSize: '1.2rem', fontStyle: 'italic' }}>
                                {searchQuery ? 'NO MATCHING ASSETS FOUND IN LIBRARY' : 'NO ASSETS UPLOADED YET'}
                            </div>
                        ) : (
                            displayAssets.map(asset => (
                                <div key={asset.id} onClick={() => openModal(asset)} style={{ border: `1px solid ${theme.line}`, borderRadius: '2px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', background: '#fff' }} onMouseOver={e => { e.currentTarget.style.borderColor = theme.brass; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.05)'; }} onMouseOut={e => { e.currentTarget.style.borderColor = theme.line; e.currentTarget.style.boxShadow = 'none'; }}>
                                    
                                    <div style={{ position: 'relative', width: '100%', height: '200px', background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {asset.thumbnailUrl || asset.url ? <img src={asset.thumbnailUrl || asset.url} alt={asset.patternId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : <span style={{fontSize:'1.5rem', color: theme.inkSoft}}>⚲</span>}
                                        
                                        <div style={{ position: 'absolute', bottom: '8px', left: '8px', color: theme.ink, fontFamily: theme.mono, fontSize: '10px', background: 'rgba(255,255,255,0.9)', padding: '4px 8px', border: `1px solid ${theme.line}` }}>
                                            {String(asset.patternId || '')}{asset.finishId ? `/${String(asset.finishId)}` : ''}
                                        </div>
                                        
                                        {(asset.clientSku || asset.customerPartId) && (
                                            <div style={{ position: 'absolute', top: '8px', right: '8px', color: '#fff', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.05em', background: theme.inkSoft, padding: '3px 6px', zIndex: 2 }}>
                                                CUST: {String(asset.clientSku || asset.customerPartId)}
                                            </div>
                                        )}
                                    </div>
                                    
                                    <div style={{ padding: '12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '10px', fontFamily: theme.mono, color: theme.inkSoft }}>{String(asset.productType || 'N/A')}</span>
                                            <span style={{ fontSize: '10px', fontFamily: theme.mono, color: theme.inkSoft }}>{String(asset.collection || 'N/A')}</span>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {/* HIGH-RES VIEW & METADATA MODAL */}
            {activeAsset && (() => {
                const availableClientSKUs = getAssetClientSKUs(activeAsset);

                return (
                    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,26,22,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                        <div style={{ background: '#fff', width: '90%', maxWidth: '1400px', height: '90vh', display: 'flex', boxShadow: '0 10px 40px rgba(0,0,0,0.1)', overflow: 'hidden' }}>
                            
                            {/* 🚀 LEFT: FULL SIZE IMAGE (NOW WITH ZOOM CROP) */}
                            <div 
                                style={{ flex: 2, background: theme.paper, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', cursor: isZoomed ? 'zoom-out' : 'zoom-in' }}
                                onClick={() => setIsZoomed(!isZoomed)}
                            >
                                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <img 
                                        src={activeAsset.originalUrl || activeAsset.url} 
                                        alt={activeAsset.patternId} 
                                        style={{ 
                                            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 4px 24px rgba(0,0,0,0.05)',
                                            transform: isZoomed ? 'scale(2)' : 'scale(1)', transition: 'transform 0.25s ease-in-out'
                                        }} 
                                    />
                                </div>

                                {!isZoomed && (
                                    <div style={{ position: 'absolute', top: '20px', left: '20px', background: 'rgba(255,255,255,0.8)', color: theme.ink, border: `1px solid ${theme.line}`, padding: '8px 12px', fontSize: '11px', fontFamily: theme.mono, letterSpacing: '.1em', pointerEvents: 'none' }}>
                                        ⚲ CLICK TO CROP / ZOOM
                                    </div>
                                )}
                                
                                <div style={{ padding: '15px', background: '#fff', borderTop: `1px solid ${theme.line}`, display: 'flex', gap: '15px', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', zIndex: 10 }} onClick={e => e.stopPropagation()}>
                                    <button onClick={() => window.open(activeAsset.originalUrl || activeAsset.url, '_blank')} style={{ padding: '10px 20px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.borderColor = theme.ink} onMouseOut={(e) => e.currentTarget.style.borderColor = theme.line}>
                                        DL ORIGINAL (CLEAN)
                                    </button>
                                    
                                    <button 
                                        onClick={() => handleDynamicDownload(activeAsset.originalUrl || activeAsset.url, `${activeAsset.patternId || 'UNKNOWN'}${activeAsset.finishId ? `/${activeAsset.finishId}` : ''}`, theme.ink, 'HQ')} 
                                        style={{ padding: '10px 20px', background: theme.ink, color: '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer', transition: 'background 0.2s' }}
                                        onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}
                                    >
                                        DL HQ (BURN ID)
                                    </button>

                                    <div style={{ display: 'flex', border: `1px solid ${theme.line}`, background: theme.paper }}>
                                        <select 
                                            value={downloadSku} 
                                            onChange={e => setDownloadSku(e.target.value)}
                                            style={{ padding: '10px', border: 'none', outline: 'none', fontFamily: theme.sans, fontSize: '0.85rem', background: 'transparent', maxWidth: '250px', cursor: 'pointer', boxSizing: 'border-box' }}
                                        >
                                            {availableClientSKUs.length === 0 && <option value="">-- No Linked Client SKUs --</option>}
                                            {availableClientSKUs.map(s => <option key={s.clientSku} value={s.clientSku}>{s.customerId}: {s.clientSku}</option>)}
                                        </select>
                                        <button 
                                            onClick={() => {
                                                if(!downloadSku) return alert("Select a Client SKU from the dropdown first.");
                                                handleDynamicDownload(activeAsset.originalUrl || activeAsset.url, downloadSku, theme.inkSoft, 'CLIENT');
                                            }} 
                                            style={{ padding: '10px 15px', background: theme.paper2, color: theme.ink, borderLeft: `1px solid ${theme.line}`, borderTop: 'none', borderRight: 'none', borderBottom: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', cursor: 'pointer' }}
                                        >
                                            DL CLIENT SKU
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <div style={{ flex: 1, borderLeft: `1px solid ${theme.line}`, padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px', background: '#fff', overflowY: 'auto' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.line}`, paddingBottom: '20px' }}>
                                    <h2 style={{ margin: 0, color: theme.ink, fontFamily: theme.serif, fontWeight: 500, fontSize: '1.6rem' }}>Asset Metadata</h2>
                                    <button onClick={() => { setActiveAsset(null); setIsZoomed(false); }} style={{ background: 'none', border: 'none', fontSize: '2rem', color: theme.inkSoft, cursor: 'pointer', lineHeight: 1, fontFamily: theme.sans }}>×</button>
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PATTERN ID</label>
                                        <input type="text" value={metaForm.patternId} onChange={e => setMetaForm({...metaForm, patternId: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, textTransform: 'uppercase' }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>FINISH ID</label>
                                        <input type="text" value={metaForm.finishId} onChange={e => setMetaForm({...metaForm, finishId: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, textTransform: 'uppercase' }} />
                                    </div>
                                </div>
                                
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CUSTOMER</label>
                                        <select value={metaForm.customerId || ''} onChange={e => setMetaForm({...metaForm, customerId: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                            <option value="">Select...</option>
                                            {(globalLists.customers || []).map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CLIENT SKU</label>
                                        <input type="text" value={metaForm.clientSku || ''} onChange={e => setMetaForm({...metaForm, clientSku: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, textTransform: 'uppercase' }} />
                                    </div>
                                </div>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>COLLECTION</label>
                                        <select value={metaForm.collection} onChange={e => setMetaForm({...metaForm, collection: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                            <option value="">Select...</option>
                                            {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PROD TYPE</label>
                                        <select value={metaForm.productType} onChange={e => setMetaForm({...metaForm, productType: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, boxSizing: 'border-box', fontFamily: theme.sans, background: '#fff' }}>
                                            <option value="">Select...</option>
                                            {globalLists.prodTypes.map(c => <option key={c} value={c}>{c}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>SEARCHABLE OPEN NOTES</label>
                                    <textarea value={metaForm.notes} onChange={e => setMetaForm({...metaForm, notes: e.target.value})} style={{ width: '100%', padding: '12px', border: `1px solid ${theme.line}`, minHeight: '80px', fontFamily: theme.sans, boxSizing: 'border-box', outline: 'none' }} />
                                </div>

                                <div>
                                    <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>MASTER LIBRARY ASSOCIATIONS</label>
                                    {metaForm.associatedParts.length === 0 ? (
                                        <div style={{ fontSize: '0.85rem', color: theme.inkSoft, fontStyle: 'italic', padding: '10px 0', fontFamily: theme.serif }}>No parts linked.</div>
                                    ) : (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', padding: '10px 0' }}>
                                            {metaForm.associatedParts.map(partId => (
                                                <span key={partId} style={{ background: theme.paper, border: `1px solid ${theme.line}`, color: theme.ink, padding: '4px 8px', fontSize: '10px', fontFamily: theme.mono, letterSpacing: '.05em' }}>
                                                    {String(safeHqParts.find(p => p.id === partId)?.itemName || partId)}
                                                    <span onClick={() => setMetaForm(prev => ({...prev, associatedParts: prev.associatedParts.filter(id => id !== partId)}))} style={{ cursor: 'pointer', marginLeft: '5px', color: theme.inkSoft }}>×</span>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                    <div style={{ fontSize: '10px', fontFamily: theme.mono, color: theme.inkSoft, textAlign: 'center', letterSpacing: '.05em' }}>
                                        Uploaded by {String(activeAsset?.uploadedBy || 'Unknown')} on {new Date(activeAsset?.createdAt?.seconds * 1000).toLocaleDateString()}
                                    </div>
                                    <button onClick={handleUpdateMetadata} style={{ padding: '15px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>SAVE METADATA CHANGES</button>
                                    <button onClick={() => handleDeleteAsset(activeAsset)} style={{ padding: '15px', background: 'transparent', color: theme.inkSoft, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', border: 'none', textDecoration: 'underline', cursor: 'pointer' }}>PERMANENTLY DELETE ASSET</button>
                                </div>
                            </div>

                        </div>
                    </div>
                );
            })()}

        </div>
    );
};

export default AssetGalleryTab;