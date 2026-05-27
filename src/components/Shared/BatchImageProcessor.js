import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, setDoc, serverTimestamp, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const BatchImageProcessor = ({ activeBrand, currentUser }) => {
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    
    const [hqParts, setHqParts] = useState([]);
    const [globalLists, setGlobalLists] = useState({ collections: [], prodTypes: [], customers: [] }); 

    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    const [inhouseFinishes, setInhouseFinishes] = useState([]);

    const [patternId, setPatternId] = useState("");
    const [finishId, setFinishId] = useState(""); 
    
    // 🚀 NEW: Added Customer Mapping to Pipeline
    const [customerId, setCustomerId] = useState("");
    const [clientSku, setClientSku] = useState("");
    
    const [collectionName, setCollectionName] = useState("");
    const [productType, setProductType] = useState("");
    const [notes, setNotes] = useState("");
    const [associatedParts, setAssociatedParts] = useState([]);
    const [associatedFinishes, setAssociatedFinishes] = useState([]); 
    
    const [imagePreview, setImagePreview] = useState(null);
    const idInputRef = useRef(null);

    useEffect(() => {
        let unsub = null;
        try {
            unsub = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => {
                if (docSnap.exists()) {
                    setGlobalLists({
                        collections: docSnap.data().collections || [],
                        prodTypes: docSnap.data().prodTypes || [],
                        customers: docSnap.data().customers || []
                    });
                    setCollectionName(docSnap.data().collections?.[0] || '');
                    setProductType(docSnap.data().prodTypes?.[0] || '');
                }
            });
        } catch (err) { console.error("Global Lists Error:", err); }
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

    // 🚀 NEW: Clean High-Res, Burned Thumbnail (Bottom Right)
    const generateWatermarkedImages = (file, textStr) => {
        return new Promise((resolve) => {
            if (!file) return resolve({ hiResBlob: null, thumbBlob: null });
            const img = new Image();
            img.onload = () => {
                try {
                    // Create Thumbnail Canvas
                    const thCanvas = document.createElement('canvas');
                    const thCtx = thCanvas.getContext('2d');
                    thCanvas.width = 250;
                    thCanvas.height = 250;
                    const minDim = Math.min(img.width, img.height);
                    const sx = (img.width - minDim) / 2;
                    const sy = (img.height - minDim) / 2;
                    thCtx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 250, 250);

                    // Burn Internal Watermark into LOWER RIGHT of Thumbnail
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
                        // Return the completely clean, original file as the high-res blob
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
        const safeFinish = String(finishId).toUpperCase().replace(/[^A-Z0-9-]/g, '');
        const displayId = safeFinish ? `${String(patternId).toUpperCase()}/${String(finishId).toUpperCase()}` : String(patternId).toUpperCase();
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
                finishId: String(finishId).toUpperCase(),
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px', fontFamily: 'monospace', backgroundColor: '#e5e5e5', minHeight: '100vh' }}>
            
            <div style={{ background: '#fff', border: '2px solid #000', padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '5px 5px 0 #000' }}>
                <div>
                    <h2 style={{ margin: 0, textTransform: 'uppercase', fontSize: '1.6rem', color: '#17a2b8' }}>Batch Asset Processor</h2>
                    <span style={{ fontSize: '0.8rem', color: '#666', fontWeight: 'bold' }}>CONVEYOR BELT IMAGE UPLOADER</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: remaining > 0 ? '#d9534f' : '#28a745' }}>
                        {remaining} IMAGES REMAINING
                    </div>
                    <label style={{ background: '#000', color: '#fff', padding: '10px 20px', fontWeight: 'bold', cursor: 'pointer', border: '2px solid #000' }}>
                        + SELECT BATCH
                        <input type="file" multiple accept="image/png, image/jpeg" onChange={handleFileSelect} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            {safeQueue.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '2px dashed #ccc', color: '#888', fontWeight: 'bold', fontSize: '1.2rem' }}>
                    DRAG & DROP OR SELECT A BATCH OF IMAGES TO BEGIN
                </div>
            ) : isDone ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#eafaf1', border: '2px solid #28a745', color: '#28a745' }}>
                    <div style={{ fontSize: '3rem' }}>✅</div>
                    <h2 style={{ margin: '10px 0 0 0' }}>BATCH COMPLETE</h2>
                    <p style={{ fontWeight: 'bold' }}>Processed {safeQueue.length} images.</p>
                    <button onClick={() => { setQueue([]); setCurrentIndex(0); setPatternId(''); setFinishId(''); setCustomerId(''); setClientSku(''); setAssociatedParts([]); setAssociatedFinishes([]); }} style={{ marginTop: '20px', padding: '10px 20px', background: '#28a745', color: '#fff', fontWeight: 'bold', border: 'none', cursor: 'pointer' }}>START NEW BATCH</button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '20px', flex: 1 }}>
                    
                    <div style={{ width: '250px', background: '#fff', border: '2px solid #000', display: 'flex', flexDirection: 'column', boxShadow: '5px 5px 0 rgba(0,0,0,0.1)', overflowY: 'auto', maxHeight: '75vh' }}>
                        <div style={{ padding: '10px', background: '#333', color: '#fff', fontWeight: 'bold', textAlign: 'center', position: 'sticky', top: 0, zIndex: 10 }}>UPCOMING PIPELINE</div>
                        <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                            {visibleQueue.map((file, localIdx) => {
                                const idx = currentIndex + localIdx;
                                const isCurrent = idx === currentIndex;
                                return (
                                    <div key={idx} style={{ padding: '8px', fontSize: '0.7rem', background: isCurrent ? '#d1ecf1' : '#f8f9fa', border: isCurrent ? '2px solid #17a2b8' : '1px solid #ccc', color: isCurrent ? '#0c5460' : '#666', fontWeight: isCurrent ? 'bold' : 'normal', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {idx + 1}. {String(file?.name || 'Unknown')}
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    <div style={{ flex: 2, background: '#e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #ccc', overflow: 'hidden', position: 'relative' }}>
                        {imagePreview && <img src={imagePreview} alt="Preview" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }} />}
                        
                        <div style={{ position: 'absolute', bottom: '20px', right: '20px', background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '5px 10px', fontSize: '0.8rem', fontWeight: 'bold', borderRadius: '4px' }}>
                            FILE: {String(safeQueue[currentIndex]?.name || "Unknown")}
                        </div>
                    </div>

                    <div style={{ flex: 1.2, background: '#fff', border: '2px solid #000', padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '5px 5px 0 #000', overflowY: 'auto' }}>
                        <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#17a2b8', borderBottom: '2px solid #17a2b8', paddingBottom: '10px' }}>METADATA INJECTION</div>

                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#d9534f' }}>PATTERN / ITEM ID</label>
                                <input 
                                    ref={idInputRef}
                                    type="text" 
                                    value={patternId} 
                                    onChange={e => setPatternId(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. H1-75BS" 
                                    style={{ width: '100%', padding: '15px', border: '3px solid #d9534f', fontSize: '1.2rem', fontWeight: 'bold', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px' }} 
                                />
                                {isLibraryMatch && (
                                    <div style={{ fontSize: '0.7rem', color: '#28a745', fontWeight: 'bold', marginTop: '5px' }}>✓ Matches Master Library Part</div>
                                )}
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#d9534f' }}>FINISH ID</label>
                                <input 
                                    type="text" 
                                    value={finishId} 
                                    onChange={e => setFinishId(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. EP01" 
                                    style={{ width: '100%', padding: '15px', border: '3px solid #d9534f', fontSize: '1.2rem', fontWeight: 'bold', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px' }} 
                                />
                            </div>
                        </div>

                        {/* 🚀 NEW: Customer & Client SKU Mapping */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#28a745' }}>CUSTOMER</label>
                                <select value={customerId} onChange={e => setCustomerId(e.target.value)} style={{ width: '100%', padding: '12px', border: '2px solid #28a745', fontWeight: 'bold', marginTop: '5px' }}>
                                    <option value="">Select...</option>
                                    {globalLists.customers.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#28a745' }}>CLIENT SKU / PART #</label>
                                <input 
                                    type="text" 
                                    value={clientSku} 
                                    onChange={e => setClientSku(e.target.value)} 
                                    onKeyDown={handleKeyDown}
                                    placeholder="e.g. CUST-999" 
                                    style={{ width: '100%', padding: '12px', border: '2px solid #28a745', fontWeight: 'bold', boxSizing: 'border-box', textTransform: 'uppercase', marginTop: '5px' }} 
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '15px' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>COLLECTION</label>
                                <select value={collectionName} onChange={e => setCollectionName(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #ccc', fontWeight: 'bold', marginTop: '5px' }}>
                                    {globalLists.collections.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>PRODUCT TYPE</label>
                                <select value={productType} onChange={e => setProductType(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid #ccc', fontWeight: 'bold', marginTop: '5px' }}>
                                    {globalLists.prodTypes.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#666' }}>SEARCHABLE OPEN NOTES</label>
                            <textarea 
                                value={notes} 
                                onChange={e => setNotes(e.target.value)} 
                                placeholder="Any keywords you want to search by later..." 
                                style={{ width: '100%', padding: '12px', border: '1px solid #ccc', minHeight: '80px', fontFamily: 'monospace', boxSizing: 'border-box', marginTop: '5px', resize: 'vertical' }} 
                            />
                        </div>

                        {/* PART TAGGING */}
                        <select 
                            onChange={(e) => {
                                if (e.target.value && !associatedParts.includes(e.target.value)) {
                                    setAssociatedParts(prev => [...prev, e.target.value]);
                                }
                            }} 
                            style={{ padding: '10px', border: '2px solid #007bff', fontWeight: 'bold' }}
                        >
                            <option value="">+ Link to Master Library Part...</option>
                            {safeHqParts.slice(0, 200).map(p => <option key={p.id} value={p.id}>{String(p.itemName || p.id)}</option>)}
                        </select>
                        {associatedParts.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {associatedParts.map(partId => (
                                    <span key={partId} style={{ background: '#007bff', color: '#fff', padding: '4px 8px', fontSize: '0.7rem', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        {String(safeHqParts.find(p => p.id === partId)?.itemName || partId)}
                                        <span onClick={() => setAssociatedParts(prev => prev.filter(id => id !== partId))} style={{ cursor: 'pointer', fontWeight: 'bold' }}>×</span>
                                    </span>
                                ))}
                            </div>
                        )}

                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <div style={{ fontSize: '0.75rem', color: '#888', textAlign: 'center', fontStyle: 'italic' }}>Tip: Press Enter to submit instantly</div>
                            <button 
                                onClick={handleProcessAndNext} 
                                disabled={isProcessing || !patternId}
                                style={{ 
                                    padding: '20px', 
                                    background: (isProcessing || !patternId) ? '#ccc' : '#17a2b8', 
                                    color: '#fff', 
                                    fontWeight: 'bold', 
                                    fontSize: '1.2rem', 
                                    border: '2px solid #000', 
                                    cursor: (isProcessing || !patternId) ? 'not-allowed' : 'pointer', 
                                    boxShadow: (isProcessing || !patternId) ? 'none' : '4px 4px 0 #000',
                                    transition: '0.1s'
                                }}
                            >
                                {isProcessing ? "📸 GENERATING THUMB & UPLOADING..." : "⏭️ PROCESS & NEXT"}
                            </button>
                            <button onClick={() => { setNotes(""); setClientSku(""); setCurrentIndex(prev => prev + 1); }} disabled={isProcessing} style={{ padding: '10px', background: 'transparent', color: '#d9534f', border: 'none', fontWeight: 'bold', cursor: 'pointer' }}>
                                SKIP THIS IMAGE
                            </button>
                        </div>

                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchImageProcessor;