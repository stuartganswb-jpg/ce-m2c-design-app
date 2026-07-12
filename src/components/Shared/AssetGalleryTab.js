import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db, storage } from '../../firebase';
import { collection, onSnapshot, query, doc, updateDoc, deleteDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import {
    buildPartIndex, assetSearchBlob, buildComboMeta, buildSingleMeta, resolveBaseDoc,
    pairedCandidatesFor, pairedInfoOf, partCodeOf, END_TREATMENT_LABELS,
} from './fabricutAssetTags';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const AssetGalleryTab = ({ currentUser, activeBrand }) => {
    const [assets, setAssets] = useState([]);
    const [hqParts, setHqParts] = useState([]);
    
    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [inhouseFinishes, setInhouseFinishes] = useState([]);
    const [masterFinishes, setMasterFinishes] = useState([]);

    const [globalLists, setGlobalLists] = useState({ prodTypes: [], customers: [] });
    const [collectionsData, setCollectionsData] = useState([]);

    const [searchQuery, setSearchQuery] = useState('');
    const [chipFilters, setChipFilters] = useState({ type: '', dia: '', proj: '' });

    // Bulk re-tag (Fabricut combo logic): select cards → assign fee/arm + optional plate override
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkSelected, setBulkSelected] = useState(() => new Set());
    const [bulkPairedId, setBulkPairedId] = useState(null);
    const [bulkPairedQuery, setBulkPairedQuery] = useState('');
    const [bulkPlateCode, setBulkPlateCode] = useState('');
    const [bulkRename, setBulkRename] = useState(true);
    const [bulkBusy, setBulkBusy] = useState(null); // { done, total }
    
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
        let unsub1, unsub2, unsub3, unsub4;
        try {
            unsub1 = onSnapshot(collection(db, "hq_global_finishes"), snap => setGlobalFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Global Finishes Missing"));
            unsub2 = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Outsource Finishes Missing"));
            unsub3 = onSnapshot(collection(db, "hq_inhouse_finishes"), snap => setInhouseFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Inhouse Finishes Missing"));
            unsub4 = onSnapshot(doc(db, "system", "master_finishes"), docSnap => { if (docSnap.exists()) setMasterFinishes(docSnap.data().finishes || []); }, e => console.warn("Master Finishes Missing"));
        } catch (err) { console.error("Finishes DB Error:", err); }
        return () => {
            [unsub1, unsub2, unsub3, unsub4].forEach(u => { if (typeof u === 'function') u(); });
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

    const partIndex = useMemo(() => buildPartIndex(hqParts), [hqParts]);
    const finishLists = useMemo(() => [masterFinishes, globalFinishes, outsourceFinishes, inhouseFinishes], [masterFinishes, globalFinishes, outsourceFinishes, inhouseFinishes]);

    // One lowercase blob per asset (name/ids/notes + tags[] + fab{} + Fabricut codes + our & their
    // color names + linked-part docs) — search AND-matches every query token against it, so
    // "french return square P01" or "decorative bracket 4-5/8 coverplate" work like the CPQ flow.
    const blobMap = useMemo(() => {
        const m = new Map();
        (Array.isArray(assets) ? assets : []).forEach(a => m.set(a.id, assetSearchBlob(a, partIndex, finishLists)));
        return m;
    }, [assets, partIndex, finishLists]);

    const hasTag = (a, t) => Array.isArray(a?.tags) && a.tags.includes(t);
    const TYPE_CHIPS = [
        { label: 'FRENCH RETURN', test: a => hasTag(a, 'FRENCH RETURN') },
        { label: 'MITER RETURN', test: a => hasTag(a, 'MITER RETURN') },
        { label: 'BRACKET ARM', test: a => hasTag(a, 'BRACKET ARM') || a?.fab?.pairedRole === 'ARM' || a?.fab?.role === 'BRACKET' },
        { label: 'BACKPLATE', test: a => (a?.fab?.plateKind ? !a.fab.plateIsCover : hasTag(a, 'BACKPLATE')) },
        { label: 'COVERPLATE', test: a => (a?.fab?.plateKind ? !!a.fab.plateIsCover : hasTag(a, 'COVERPLATE')) },
        { label: 'POLE', test: a => hasTag(a, 'POLE') || a?.fab?.role === 'POLE' },
        { label: 'FINIAL', test: a => hasTag(a, 'FINIAL') || a?.fab?.role === 'FINIAL' },
        { label: 'RING', test: a => hasTag(a, 'RING') || a?.fab?.role === 'RING' },
    ];
    const DIA_CHIPS = ['3/4"', '1"', '1-3/8"'];
    const PROJ_CHIPS = ['3-5/8"', '4-5/8"', '6"'];

    const searchTokens = String(searchQuery).toLowerCase().split(/\s+/).filter(Boolean);
    const filteredAssets = safeAssets.filter(asset => {
        if (asset?.category === 'PROGRAM_PRINT') return false; // prints live in `program_prints`, never the gallery (hides any legacy test docs)
        if (chipFilters.type) {
            const chip = TYPE_CHIPS.find(c => c.label === chipFilters.type);
            if (chip && !chip.test(asset)) return false;
        }
        if (chipFilters.dia && !(hasTag(asset, chipFilters.dia) || asset?.fab?.diaLabel === chipFilters.dia)) return false;
        if (chipFilters.proj && !(hasTag(asset, chipFilters.proj) || asset?.fab?.projLabel === chipFilters.proj)) return false;
        if (!searchTokens.length) return true;
        const blob = blobMap.get(asset.id) || '';
        return searchTokens.every(t => blob.includes(t));
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

    // THE PLATE RULE, surfaced: backplate ships $0 inside the arm price; coverplate is the upgrade.
    const plateBadgeOf = (asset) => {
        const f = asset?.fab;
        if (!f) return null;
        if (f.plateKind) return f.plateIsCover
            ? { txt: 'COVERPLATE · UPGRADE', bg: theme.brass }
            : { txt: 'BACKPLATE · INCL. W/ ARM', bg: theme.inkSoft };
        if (f.role === 'BRACKET' || f.includesBackplate) return { txt: 'INCL. BACKPLATE · CP UPGRADE AVAIL.', bg: theme.inkSoft };
        return null;
    };

    const bulkPairedDoc = bulkPairedId ? safeHqParts.find(p => p.id === bulkPairedId) : null;
    const bulkPairedInfo = bulkPairedDoc ? pairedInfoOf(bulkPairedDoc) : null;
    const bulkSuggestions = useMemo(() => {
        if (!bulkMode || bulkPairedId) return [];
        return pairedCandidatesFor(bulkPlateCode, partIndex, bulkPairedQuery);
    }, [bulkMode, bulkPairedId, bulkPlateCode, partIndex, bulkPairedQuery]);

    const toggleBulk = (id) => setBulkSelected(prev => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
    });

    // Re-derive fab{} / tags[] for every selected asset with the two-part combo logic (or plain
    // single-item resolution when no fee/arm is picked — that's the Fabricut backfill).
    const handleBulkApply = async () => {
        const ids = [...bulkSelected];
        if (!ids.length) return;
        const plateOverride = String(bulkPlateCode || '').trim().toUpperCase();
        setBulkBusy({ done: 0, total: ids.length });
        let done = 0, skipped = 0;
        for (const id of ids) {
            const asset = safeAssets.find(a => a.id === id);
            const plateCode = plateOverride || String(asset?.patternId || '').toUpperCase();
            const derived = !asset ? null : bulkPairedDoc
                ? buildComboMeta({ plateCode: resolveBaseDoc(plateCode, partIndex).base || plateCode, pairedDoc: bulkPairedDoc, finishId: asset.finishId, fabCode: asset.fabCode || asset.fab?.fabCode || '', fabColorName: asset.fab?.fabColorName || '', partIndex, finishLists })
                : buildSingleMeta({ patternId: plateCode, finishId: asset.finishId, partIndex, finishLists });
            if (!derived) {
                skipped++;
            } else {
                const patch = {
                    fab: derived.fab,
                    tags: derived.tags,
                    associatedParts: [...new Set([...(Array.isArray(asset.associatedParts) ? asset.associatedParts : []), ...derived.associatedParts])],
                };
                if (plateOverride) patch.patternId = plateOverride;
                if (bulkRename && derived.name) patch.name = derived.name;
                try {
                    await updateDoc(doc(db, "global_assets", id), patch);
                    done++;
                } catch (e) { console.error("Bulk retag failed:", id, e); skipped++; }
            }
            setBulkBusy({ done: done + skipped, total: ids.length });
        }
        setBulkBusy(null);
        setBulkSelected(new Set());
        alert(`Re-tagged ${done} asset${done === 1 ? '' : 's'}${skipped ? `, skipped ${skipped} (no library match / error — see console)` : ''}.`);
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
                        placeholder="Deep Search (e.g. 'french return square P01', 'HNFSRFRSB079', 'stain nickel')..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '12px 15px 12px 45px', fontSize: '0.95rem', fontFamily: theme.sans, border: `1px solid ${theme.line}`, outline: 'none', boxSizing: 'border-box', backgroundColor: theme.paper }}
                    />
                </div>
                <button onClick={() => { setBulkMode(m => !m); setBulkSelected(new Set()); setBulkPairedId(null); setBulkPairedQuery(''); setBulkPlateCode(''); }} style={{ marginLeft: '15px', padding: '12px 20px', background: bulkMode ? theme.brass : 'transparent', color: bulkMode ? '#fff' : theme.ink, border: `1px solid ${bulkMode ? theme.brass : theme.ink}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.12em', textTransform: 'uppercase', cursor: 'pointer' }}>
                    {bulkMode ? `✕ EXIT BULK (${bulkSelected.size})` : '☑ BULK RE-TAG'}
                </button>
            </div>

            {/* FABRICUT FILTER CHIPS — mirror the CPQ flow axes: what it is / rod diameter / projection */}
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '12px 30px', display: 'flex', gap: '25px', alignItems: 'center', flexWrap: 'wrap', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                {[
                    ['TYPE', 'type', TYPE_CHIPS.map(c => c.label)],
                    ['DIA', 'dia', DIA_CHIPS],
                    ['PROJ', 'proj', PROJ_CHIPS],
                ].map(([groupLabel, key, options]) => (
                    <div key={key} style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.15em', color: theme.inkSoft }}>{groupLabel}</span>
                        {options.map(opt => {
                            const active = chipFilters[key] === opt;
                            return (
                                <button key={opt} onClick={() => setChipFilters(prev => ({ ...prev, [key]: active ? '' : opt }))} style={{ padding: '5px 10px', background: active ? theme.ink : theme.paper, color: active ? '#fff' : theme.inkSoft, border: `1px solid ${active ? theme.ink : theme.line}`, fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.06em', cursor: 'pointer' }}>
                                    {opt}
                                </button>
                            );
                        })}
                    </div>
                ))}
                {(chipFilters.type || chipFilters.dia || chipFilters.proj) && (
                    <button onClick={() => setChipFilters({ type: '', dia: '', proj: '' })} style={{ padding: '5px 10px', background: 'transparent', color: theme.brass, border: 'none', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.06em', textDecoration: 'underline', cursor: 'pointer' }}>CLEAR FILTERS</button>
                )}
            </div>

            {/* BULK RE-TAG BAR — search by finish, tick the cards, assign the two-part combo */}
            {bulkMode && (
                <div style={{ background: theme.paper2, border: `1px solid ${theme.brass}`, padding: '15px 30px', display: 'flex', gap: '15px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', color: theme.inkSoft }}>SELECTED: {bulkSelected.size}</span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => setBulkSelected(new Set(displayAssets.map(a => a.id)))} style={{ padding: '6px 10px', background: '#fff', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '9px', cursor: 'pointer' }}>SELECT ALL SHOWN</button>
                            <button onClick={() => setBulkSelected(new Set())} style={{ padding: '6px 10px', background: '#fff', border: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '9px', cursor: 'pointer' }}>CLEAR</button>
                        </div>
                    </div>
                    <div style={{ minWidth: '180px' }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', color: theme.inkSoft }}>PLATE CODE OVERRIDE (blank = keep each asset's)</span>
                        <input type="text" value={bulkPlateCode} onChange={e => setBulkPlateCode(e.target.value)} placeholder="e.g. H1-1BP-R" style={{ width: '100%', padding: '8px', marginTop: '4px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.85rem', textTransform: 'uppercase', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div style={{ minWidth: '280px', flex: 1 }}>
                        <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.12em', color: theme.inkSoft }}>PAIRED FEE / BRACKET ARM (blank = plain re-tag)</span>
                        {bulkPairedDoc ? (
                            <div style={{ marginTop: '4px' }}>
                                <span style={{ background: '#fff', border: `1px solid ${theme.brass}`, color: theme.ink, padding: '6px 10px', fontFamily: theme.mono, fontSize: '10px', display: 'inline-block' }}>
                                    {bulkPairedInfo?.endTreatment ? `${END_TREATMENT_LABELS[bulkPairedInfo.endTreatment]} · ` : ''}{bulkPairedInfo?.code} — {String(bulkPairedDoc.itemName || '')}
                                    <span onClick={() => setBulkPairedId(null)} style={{ cursor: 'pointer', marginLeft: '8px', color: theme.inkSoft }}>×</span>
                                </span>
                            </div>
                        ) : (
                            <>
                                <input type="text" value={bulkPairedQuery} onChange={e => setBulkPairedQuery(e.target.value)} placeholder="Search fee items / bracket arms…" style={{ width: '100%', padding: '8px', marginTop: '4px', border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.85rem', textTransform: 'uppercase', boxSizing: 'border-box', outline: 'none' }} />
                                {bulkSuggestions.length > 0 && (
                                    <div style={{ maxHeight: '120px', overflowY: 'auto', background: '#fff', border: `1px solid ${theme.line}`, borderTop: 'none' }}>
                                        {bulkSuggestions.map(p => {
                                            const info = pairedInfoOf(p);
                                            return (
                                                <button key={p.id} onClick={() => { setBulkPairedId(p.id); setBulkPairedQuery(''); }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: '#fff', border: 'none', borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', color: theme.ink, cursor: 'pointer' }}>
                                                    {info?.endTreatment ? `[${END_TREATMENT_LABELS[info.endTreatment]}] ` : info?.role === 'ARM' ? '[ARM] ' : ''}{partCodeOf(p)} — {String(p.itemName || '')}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.08em', color: theme.ink, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={bulkRename} onChange={e => setBulkRename(e.target.checked)} />
                            RENAME TO COMBO CONVENTION
                        </label>
                        <button onClick={handleBulkApply} disabled={!!bulkBusy || bulkSelected.size === 0} style={{ padding: '10px 20px', background: (!!bulkBusy || bulkSelected.size === 0) ? theme.paper : theme.ink, color: (!!bulkBusy || bulkSelected.size === 0) ? theme.inkSoft : '#fff', border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.12em', cursor: (!!bulkBusy || bulkSelected.size === 0) ? 'not-allowed' : 'pointer' }}>
                            {bulkBusy ? `RE-TAGGING… ${bulkBusy.done}/${bulkBusy.total}` : `APPLY TO ${bulkSelected.size} SELECTED`}
                        </button>
                    </div>
                </div>
            )}

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
                            {[...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])].map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
                        </optgroup>
                        <optgroup label="Outsourced Finishes">
                            {(Array.isArray(outsourceFinishes)?outsourceFinishes:[]).map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
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
                            displayAssets.map(asset => {
                                const badge = plateBadgeOf(asset);
                                const isSel = bulkSelected.has(asset.id);
                                return (
                                <div key={asset.id} onClick={() => bulkMode ? toggleBulk(asset.id) : openModal(asset)} style={{ border: `1px solid ${isSel ? theme.brass : theme.line}`, borderRadius: '2px', overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column', transition: 'all 0.2s', background: '#fff', boxShadow: isSel ? `0 0 0 2px ${theme.brass}` : 'none' }} onMouseOver={e => { e.currentTarget.style.borderColor = theme.brass; e.currentTarget.style.boxShadow = isSel ? `0 0 0 2px ${theme.brass}` : '0 4px 12px rgba(0,0,0,0.05)'; }} onMouseOut={e => { e.currentTarget.style.borderColor = isSel ? theme.brass : theme.line; e.currentTarget.style.boxShadow = isSel ? `0 0 0 2px ${theme.brass}` : 'none'; }}>

                                    <div style={{ position: 'relative', width: '100%', height: '200px', background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {asset.thumbnailUrl || asset.url ? <img src={asset.thumbnailUrl || asset.url} alt={asset.patternId} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" /> : <span style={{fontSize:'1.5rem', color: theme.inkSoft}}>⚲</span>}

                                        {bulkMode && (
                                            <div style={{ position: 'absolute', top: '8px', left: '8px', width: '22px', height: '22px', background: isSel ? theme.brass : 'rgba(255,255,255,0.92)', border: `1px solid ${isSel ? theme.brass : theme.line}`, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: theme.mono, fontSize: '13px', zIndex: 3 }}>
                                                {isSel ? '✓' : ''}
                                            </div>
                                        )}

                                        <div style={{ position: 'absolute', bottom: '8px', left: '8px', color: theme.ink, fontFamily: theme.mono, fontSize: '10px', background: 'rgba(255,255,255,0.9)', padding: '4px 8px', border: `1px solid ${theme.line}` }}>
                                            {String(asset.patternId || '')}{asset.finishId ? `/${String(asset.finishId)}` : ''}
                                        </div>

                                        {(asset.clientSku || asset.customerPartId) && (
                                            <div style={{ position: 'absolute', top: '8px', right: '8px', color: '#fff', fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.05em', background: theme.inkSoft, padding: '3px 6px', zIndex: 2 }}>
                                                CUST: {String(asset.clientSku || asset.customerPartId)}
                                            </div>
                                        )}
                                    </div>

                                    {(badge || asset.fab?.pairedCode || asset.fab?.endTreatment) && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 8px', background: theme.paper, borderTop: `1px solid ${theme.line}` }}>
                                            {(asset.fab?.endTreatment || asset.fab?.pairedCode) && (
                                                <span style={{ fontSize: '9px', fontFamily: theme.mono, color: theme.ink, letterSpacing: '.04em' }}>
                                                    {END_TREATMENT_LABELS[asset.fab?.endTreatment] || asset.fab?.pairedCode}{asset.fab?.diaLabel ? ` · ${asset.fab.diaLabel}` : ''}{asset.fab?.projLabel ? ` · ${asset.fab.projLabel}` : ''}
                                                </span>
                                            )}
                                            {badge && <span style={{ fontSize: '8px', fontFamily: theme.mono, color: '#fff', background: badge.bg, padding: '2px 5px', alignSelf: 'flex-start', letterSpacing: '.06em' }}>{badge.txt}</span>}
                                        </div>
                                    )}

                                    <div style={{ padding: '12px' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ fontSize: '10px', fontFamily: theme.mono, color: theme.inkSoft }}>{String(asset.productType || 'N/A')}</span>
                                            <span style={{ fontSize: '10px', fontFamily: theme.mono, color: theme.inkSoft }}>{String(asset.collection || 'N/A')}</span>
                                        </div>
                                    </div>
                                </div>
                                );
                            })
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

                                {activeAsset.fab && (
                                    <div style={{ background: theme.paper, border: `1px solid ${theme.line}`, padding: '12px 15px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <span style={{ fontFamily: theme.mono, fontSize: '9px', letterSpacing: '.15em', color: theme.inkSoft }}>FABRICUT IDENTITY</span>
                                        <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.ink }}>
                                            {[END_TREATMENT_LABELS[activeAsset.fab.endTreatment] || activeAsset.fab.pairedName || null,
                                              activeAsset.fab.plateCode ? `${activeAsset.fab.plateIsCover ? 'COVERPLATE' : 'BACKPLATE'} ${activeAsset.fab.plateCode}${activeAsset.fab.plateOrientation ? ` (${activeAsset.fab.plateOrientation})` : ''}` : null,
                                              activeAsset.fab.diaLabel, activeAsset.fab.projLabel,
                                              activeAsset.fab.ourFinishName || activeAsset.fab.fabColorName || null,
                                            ].filter(Boolean).join(' · ')}
                                        </span>
                                        {plateBadgeOf(activeAsset) && (
                                            <span style={{ fontSize: '9px', fontFamily: theme.mono, color: '#fff', background: plateBadgeOf(activeAsset).bg, padding: '3px 6px', alignSelf: 'flex-start', letterSpacing: '.06em' }}>{plateBadgeOf(activeAsset).txt}</span>
                                        )}
                                        {(activeAsset.fabCode || activeAsset.fab.fabCode) && (
                                            <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft }}>FABRICUT CODE: {String(activeAsset.fabCode || activeAsset.fab.fabCode)}</span>
                                        )}
                                        {Array.isArray(activeAsset.tags) && activeAsset.tags.length > 0 && (
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {activeAsset.tags.slice(0, 20).map(t => (
                                                    <span key={t} style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.inkSoft, border: `1px solid ${theme.line}`, padding: '2px 5px', background: '#fff' }}>{t}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

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