import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import ProgramPrintUploader from './ProgramPrintUploader';

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const BatchImageProcessor = ({ activeBrand, currentUser }) => {
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [hqParts, setHqParts] = useState([]);
    const [globalLists, setGlobalLists] = useState({ prodTypes: [], customers: [] }); 

    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [inhouseFinishes, setInhouseFinishes] = useState([]);
    const [collectionsData, setCollectionsData] = useState([]); 

    const [patternId, setPatternId] = useState("");
    const [finishId, setFinishId] = useState(""); 
    
    const [customerId, setCustomerId] = useState("");
    const [clientSku, setClientSku] = useState("");
    
    const [collectionName, setCollectionName] = useState("");
    const [productType, setProductType] = useState("");
    const [notes, setNotes] = useState("");
    const [associatedParts, setAssociatedParts] = useState([]);
    const [associatedFinishes, setAssociatedFinishes] = useState([]); 
    
    const [imagePreview, setImagePreview] = useState(null);
    const [mode, setMode] = useState('images'); // 'images' (existing conveyor) | 'prints' (PDF program-print uploader)
    const idInputRef = useRef(null);

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
                if (docSnap.exists()) {
                    setGlobalLists({
                        prodTypes: docSnap.data().prodTypes || [],
                        customers: docSnap.data().customers || []
                    });
                    setProductType(docSnap.data().prodTypes?.[0] || '');
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
            unsub = onSnapshot(collection(db, "Approved_Designs"), (snap) => {
                if (!snap || !snap.docs) return;
                setHqParts(snap.docs.map(d => ({ id: d.id, ...(d.data() || {}) })));
            });
        } catch (err) { console.error("HQ DB Error:", err); }
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    useEffect(() => {
        let unsub1, unsub2, unsub3;
        try {
            unsub1 = onSnapshot(collection(db, "hq_global_finishes"), snap => setGlobalFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Global Finishes"));
            unsub2 = onSnapshot(collection(db, "hq_outsource_finishes"), snap => setOutsourceFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Outsource Finishes"));
            unsub3 = onSnapshot(collection(db, "hq_inhouse_finishes"), snap => setInhouseFinishes(snap.docs.map(d=>({id: d.id, ...d.data()}))), e => console.warn("Missing Inhouse Finishes"));
        } catch (err) { console.error("Finishes DB Error:", err); }
        return () => { 
            if (typeof unsub1 === 'function') unsub1(); 
            if (typeof unsub2 === 'function') unsub2(); 
            if (typeof unsub3 === 'function') unsub3(); 
        };
    }, []);

    const allFinishes = [...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(outsourceFinishes)?outsourceFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])];

    const handleFileSelect = (e) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).filter(f => f && f.type && f.type.startsWith('image/'));
        if (files.length === 0) return;
        setQueue(prev => [...prev, ...files]);
    };

    useEffect(() => {
        if (Array.isArray(queue) && queue.length > 0 && currentIndex < queue.length) {
            const file = queue[currentIndex];
            if (!file) return;

            let objectUrl = null;
            try {
                objectUrl = URL.createObjectURL(file);
                setImagePreview(objectUrl);
            } catch (err) { console.warn("Failed to read file", err); }
            
            let rawName = String(file.name || "").split('.')[0].toUpperCase();
            let parts = rawName.split('_'); 
            if (parts.length === 1) parts = rawName.split('-'); 
            
            if (parts.length > 1 && parts[parts.length - 1].length <= 6) {
                setFinishId(parts.pop());
                setPatternId(parts.join('-')); 
            } else {
                setPatternId(rawName);
                setFinishId("");
            }
            
            if (idInputRef.current) idInputRef.current.focus();

            return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
        } else {
            setImagePreview(null);
        }
    }, [currentIndex, queue]);

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

    const handleProcessAndNext = async (e) => {
        if (e) e.preventDefault();
        if (!patternId) return alert("You must provide a Pattern ID.");
        
        setIsProcessing(true);
        
        if (!Array.isArray(queue) || !queue[currentIndex]) {
            setIsProcessing(false);
            return;
        }

        const currentFile = queue[currentIndex];
        
        const safePattern = String(patternId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
        // EP finishes were erroneously zero-padded (EP01 should be EP1) — strip it so gallery
        // codes match the EP1..EP6 used on library parts. ONLY EP: P##/S## finishes are
        // canonically zero-padded (master_finishes P01-P30, S01-S12), so leave those alone.
        const cleanFinish = String(finishId).toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1');
        const safeFinish = cleanFinish.replace(/[^A-Z0-9-]/g, '');
        const displayId = safeFinish ? `${String(patternId).toUpperCase()}/${safeFinish}` : String(patternId).toUpperCase();
        const safeUrlId = safeFinish ? `${safePattern}_${safeFinish}` : safePattern;
        
        const brandFolder = activeBrand ? String(activeBrand) : 'global';

        try {
            const { hiResBlob, thumbBlob } = await generateWatermarkedImages(currentFile, displayId);

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
                const urls = await Promise.all([ getDownloadURL(hiUpload.ref), getDownloadURL(thUpload.ref) ]);
                hiResUrl = urls[0];
                thumbUrl = urls[1];
            } else {
                const fallbackUpload = await uploadBytes(hiResRef, currentFile);
                hiResUrl = await getDownloadURL(fallbackUpload.ref);
                thumbUrl = hiResUrl;
            }

            const assetDocId = `ASSET-${brandFolder}-${safeUrlId}-${uniqueTimestamp}-${uniqueSuffix}`;
            
            await setDoc(doc(db, "global_assets", assetDocId), {
                id: assetDocId,
                patternId: String(patternId).toUpperCase(),
                finishId: safeFinish,
                customerId: customerId || '',
                clientSku: String(clientSku).toUpperCase(),
                name: displayId, 
                collection: collectionName,
                productType: productType,
                notes: notes,
                associatedParts: Array.isArray(associatedParts) ? associatedParts : [],
                associatedFinishes: Array.isArray(associatedFinishes) ? associatedFinishes : [],
                originalUrl: hiResUrl, 
                thumbnailUrl: thumbUrl, 
                url: thumbUrl, 
                brandId: activeBrand || 'ALL',
                uploadedBy: currentUser || 'Unknown',
                createdAt: serverTimestamp()
            }, { merge: true });

            setNotes(""); 
            setClientSku(""); 
            setCurrentIndex(prev => prev + 1);
            setIsProcessing(false);

        } catch (error) {
            console.error("Processing Error:", error);
            alert("Failed to process image. Check console.");
            setIsProcessing(false);
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!isProcessing && patternId) handleProcessAndNext();
        }
    };

    const safeQueue = Array.isArray(queue) ? queue : [];
    const remaining = Math.max(0, safeQueue.length - currentIndex);
    const isDone = safeQueue.length > 0 && currentIndex >= safeQueue.length;
    const visibleQueue = safeQueue.slice(currentIndex, currentIndex + 50);

    const safeHqParts = Array.isArray(hqParts) ? hqParts : [];
    const isLibraryMatch = Boolean(
        patternId && safeHqParts.some(p => 
            String(p?.id || "").toUpperCase().includes(String(patternId).toUpperCase()) || 
            (p?.legacyErpId && String(p.legacyErpId).toUpperCase().includes(String(patternId).toUpperCase()))
        )
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>

            {/* MODE TOGGLE: existing image conveyor vs program-print (PDF) uploader */}
            <div style={{ display: 'flex', border: `1px solid ${theme.line}`, alignSelf: 'flex-start', background: '#fff' }}>
                {[['images', 'Images'], ['prints', 'Program Prints (PDF)']].map(([m, label]) => (
                    <button key={m} onClick={() => setMode(m)} style={{ padding: '10px 22px', background: mode === m ? theme.ink : 'transparent', color: mode === m ? '#fff' : theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.15em', textTransform: 'uppercase', cursor: 'pointer' }}>{label}</button>
                ))}
            </div>

            {mode === 'prints' ? (
                <ProgramPrintUploader currentUser={currentUser} activeBrand={activeBrand} />
            ) : (
            <>
            {/* Header Area */}
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 24px rgba(0,0,0,0.02)' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Batch Asset Processor</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>CONVEYOR BELT IMAGE UPLOADER</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', fontWeight: 500, color: remaining > 0 ? theme.brass : theme.inkSoft }}>
                        {remaining} IMAGES REMAINING
                    </div>
                    <label style={{ background: theme.ink, color: '#fff', padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', border: 'none', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>
                        + SELECT BATCH
                        <input type="file" multiple accept="image/png, image/jpeg" onChange={handleFileSelect} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            {safeQueue.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px dashed ${theme.brass}`, color: theme.inkSoft, fontFamily: theme.serif, fontSize: '1.4rem' }}>
                    Drag & Drop or Select a Batch of Images to Begin
                </div>
            ) : isDone ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: theme.paper2, border: `1px solid ${theme.line}`, color: theme.ink }}>
                    <div style={{ fontSize: '3rem' }}>✅</div>
                    <h2 style={{ margin: '15px 0 10px 0', fontFamily: theme.serif, fontWeight: 500 }}>Batch Complete</h2>
                    <p style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', textTransform: 'uppercase', color: theme.inkSoft }}>Processed {safeQueue.length} images.</p>
                    <button onClick={() => { setQueue([]); setCurrentIndex(0); setPatternId(''); setFinishId(''); setCustomerId(''); setClientSku(''); setAssociatedParts([]); setAssociatedFinishes([]); }} style={{ marginTop: '20px', padding: '12px 24px', background: theme.ink, color: '#fff', fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }} onMouseOver={(e) => e.currentTarget.style.background = theme.brass} onMouseOut={(e) => e.currentTarget.style.background = theme.ink}>START NEW BATCH</button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                    
                    {/* Sidebar Queue */}
                    <div style={{ width: '250px', background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto', maxHeight: '75vh' }}>
                        <div style={{ padding: '15px', background: theme.paper, color: theme.ink, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textAlign: 'center', position: 'sticky', top: 0, zIndex: 10, borderBottom: `1px solid ${theme.line}` }}>UPCOMING PIPELINE</div>
                        <div style={{ padding: '15px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {visibleQueue.map((file, localIdx) => {
                                const idx = currentIndex + localIdx;
                                const isCurrent = idx === currentIndex;
                                return (
                                    <div key={idx} style={{ padding: '8px', fontFamily: theme.mono, fontSize: '10px', background: isCurrent ? theme.paper2 : '#fff', border: isCurrent ? `1px solid ${theme.brass}` : `1px solid ${theme.line}`, color: isCurrent ? theme.ink : theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {idx + 1}. {String(file?.name || 'Unknown')}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Image Preview Window */}
                    <div style={{ flex: 2, background: theme.paper, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${theme.line}`, overflow: 'hidden', position: 'relative' }}>
                        {imagePreview && <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 4px 24px rgba(0,0,0,0.05)' }} />}
                        
                        <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'rgba(255,255,255,0.9)', border: `1px solid ${theme.line}`, color: theme.ink, padding: '6px 12px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em' }}>
                            FILE: {String(safeQueue[currentIndex]?.name || "Unknown")}
                        </div>
                    </div>

                    {/* Metadata Form Panel */}
                    <div style={{ flex: 1.2, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 24px rgba(0,0,0,0.02)', overflowY: 'auto' }}>
                        <div style={{ fontFamily: theme.serif, fontSize: '1.4rem', fontWeight: 500, color: theme.ink, borderBottom: `1px solid ${theme.line}`, paddingBottom: '10px' }}>Metadata Injection</div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PATTERN / ITEM ID</label>
                                <input 
                                    ref={idInputRef}
                                    type="text" 
                                    value={patternId} 
                                    onChange={e => setPatternId(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. H1-75BS" 
                                    style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px', outline: 'none' }} 
                                />
                                {isLibraryMatch && (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, marginTop: '5px', letterSpacing: '.05em' }}>✓ Matches Master Library Part</div>
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>FINISH ID</label>
                                <input 
                                    type="text" 
                                    value={finishId} 
                                    onChange={e => setFinishId(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. EP1"
                                    style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px', outline: 'none' }}
                                />
                                {/^EP0+\d+$/.test(String(finishId).toUpperCase().trim()) && (
                                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.brass, marginTop: '5px', letterSpacing: '.05em' }}>↳ EP leading zero auto-removed → {String(finishId).toUpperCase().trim().replace(/^EP0+(\d+)$/, 'EP$1')}</div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CUSTOMER</label>
                                <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', marginTop: '5px', boxSizing: 'border-box', outline: 'none' }}>
                                    <option value="">Select...</option>
                                    {globalLists.customers.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>CLIENT SKU / PART #</label>
                                <input 
                                    type="text" 
                                    value={clientSku} 
                                    onChange={e => setClientSku(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. CUST-999" 
                                    style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px', outline: 'none' }} 
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>COLLECTION</label>
                                <select value={collectionName} onChange={e => setCollectionName(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', marginTop: '5px', boxSizing: 'border-box', outline: 'none' }}>
                                    <option value="">Select...</option>
                                    {collectionsData.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>PRODUCT TYPE</label>
                                <select value={productType} onChange={e => setProductType(e.target.value)} style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', marginTop: '5px', boxSizing: 'border-box', outline: 'none' }}>
                                    <option value="">Select...</option>
                                    {globalLists.prodTypes.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', color: theme.inkSoft, textTransform: 'uppercase' }}>SEARCHABLE OPEN NOTES</label>
                            <textarea 
                                value={notes} 
                                onChange={e => setNotes(e.target.value)} 
                                placeholder="Any keywords you want to search by later..." 
                                style={{ width: '100%', padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', minHeight: '80px', boxSizing: 'border-box', marginTop: '5px', resize: 'vertical', outline: 'none' }} 
                            />
                        </div>

                        {/* PART TAGGING */}
                        <select 
                            onChange={(e) => {
                                if (e.target.value && !associatedParts.includes(e.target.value)) {
                                    setAssociatedParts(prev => [...prev, e.target.value]);
                                }
                            }} 
                            style={{ padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                        >
                            <option value="">+ Link to Master Library Part...</option>
                            {safeHqParts.slice(0, 200).map(p => <option key={p.id} value={p.id}>{String(p.itemName || p.id)}</option>)}
                        </select>
                        {associatedParts.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {associatedParts.map(partId => (
                                    <span key={partId} style={{ background: theme.paper2, color: theme.ink, border: `1px solid ${theme.line}`, padding: '4px 8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {String(safeHqParts.find(p => p.id === partId)?.itemName || partId)}
                                        <span onClick={() => setAssociatedParts(prev => prev.filter(id => id !== partId))} style={{ cursor: 'pointer', color: theme.inkSoft }}>×</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* FINISHES ASSIGNMENT */}
                        <select 
                            onChange={(e) => {
                                if (e.target.value && !associatedFinishes.includes(e.target.value)) {
                                    setAssociatedFinishes(prev => [...prev, e.target.value]);
                                }
                            }} 
                            style={{ padding: '12px', background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: theme.sans, fontSize: '0.95rem', width: '100%', boxSizing: 'border-box', outline: 'none' }}
                        >
                            <option value="">+ Link to Master Finish...</option>
                            <optgroup label="In-House & Global Finishes">
                                {[...(Array.isArray(globalFinishes)?globalFinishes:[]), ...(Array.isArray(inhouseFinishes)?inhouseFinishes:[])].map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
                            </optgroup>
                            <optgroup label="Outsourced Finishes">
                                {(Array.isArray(outsourceFinishes)?outsourceFinishes:[]).map(f => <option key={f.id} value={f.id}>{String(f.name || f.id)}</option>)}
                            </optgroup>
                        </select>

                        {associatedFinishes.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {associatedFinishes.map(finId => (
                                    <span key={finId} style={{ background: theme.paper2, color: theme.ink, border: `1px solid ${theme.line}`, padding: '4px 8px', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.05em', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {String(allFinishes.find(f => f.id === finId)?.name || finId)}
                                        <span onClick={() => setAssociatedFinishes(prev => prev.filter(id => id !== finId))} style={{ cursor: 'pointer', color: theme.inkSoft }}>×</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, textAlign: 'center', letterSpacing: '.1em', textTransform: 'uppercase' }}>Tip: Press Enter to submit instantly</div>
                            <button 
                                onClick={handleProcessAndNext} 
                                disabled={isProcessing || !patternId}
                                style={{ 
                                    padding: '15px', 
                                    background: (isProcessing || !patternId) ? theme.paper2 : theme.ink, 
                                    color: (isProcessing || !patternId) ? theme.inkSoft : '#fff', 
                                    fontFamily: theme.mono, 
                                    fontSize: '11px', 
                                    letterSpacing: '.18em', 
                                    textTransform: 'uppercase', 
                                    border: (isProcessing || !patternId) ? `1px solid ${theme.line}` : 'none', 
                                    cursor: (isProcessing || !patternId) ? 'not-allowed' : 'pointer', 
                                    transition: 'background 0.2s'
                                }}
                                onMouseOver={(e) => { if(!isProcessing && patternId) e.currentTarget.style.background = theme.brass; }} 
                                onMouseOut={(e) => { if(!isProcessing && patternId) e.currentTarget.style.background = theme.ink; }}
                            >
                                {isProcessing ? "GENERATING & UPLOADING..." : "PROCESS & NEXT"}
                            </button>
                            <button onClick={() => { setNotes(""); setClientSku(""); setCurrentIndex(prev => prev + 1); }} disabled={isProcessing} style={{ padding: '10px', background: 'transparent', color: theme.inkSoft, border: 'none', fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', textDecoration: 'underline', cursor: 'pointer' }}>
                                SKIP THIS IMAGE
                            </button>
                        </div>

                    </div>
                </div>
            )}
            </>
            )}
        </div>
    );
};

export default BatchImageProcessor;