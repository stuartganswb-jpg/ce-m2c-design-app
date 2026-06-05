import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, updateDoc, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

const BatchTextureProcessor = ({ currentUser }) => {
    const [queue, setQueue] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // Database State
    const [globalFinishes, setGlobalFinishes] = useState([]);
    const [outsourceFinishes, setOutsourceFinishes] = useState([]);
    
    // Active Image State
    const [imageSrc, setImageSrc] = useState(null);
    const [finishCode, setFinishCode] = useState("");
    const [conflictWarning, setConflictWarning] = useState(null);
    const [aiPrompt, setAiPrompt] = useState("");
    
    // Dynamic Crop State
    const imageRef = useRef(null);
    const canvasRef = useRef(null);
    const [imgDims, setImgDims] = useState({ w: 0, h: 0, natW: 0, natH: 0 });
    const [cropScale, setCropScale] = useState(100); // 10% to 100% size
    const [cropX, setCropX] = useState(50); // Pan X percentage
    const [cropY, setCropY] = useState(50); // Pan Y percentage

    // 1. Fetch Existing Finishes for Conflict Checking
    useEffect(() => {
        let unsub1, unsub2;
        try {
            unsub1 = onSnapshot(doc(db, "system", "master_finishes"), (docSnap) => {
                if (docSnap.exists() && docSnap.data().finishes) setGlobalFinishes(docSnap.data().finishes);
            });
            unsub2 = onSnapshot(collection(db, "hq_outsource_finishes"), snap => {
                setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()})));
            });
        } catch (err) { console.error("DB Error:", err); }
        return () => { if(unsub1) unsub1(); if(unsub2) unsub2(); };
    }, []);

    // 2. Handle File Selection
    const handleFileSelect = (e) => {
        if (!e.target.files) return;
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        setQueue(prev => [...prev, ...files]);
    };

    // 3. Load Current Image & Parse Filename
    useEffect(() => {
        if (queue.length > 0 && currentIndex < queue.length) {
            const file = queue[currentIndex];
            const objectUrl = URL.createObjectURL(file);
            setImageSrc(objectUrl);
            setAiPrompt("");
            
            // Regex: Look for "P" or "EP" followed by exactly two digits anywhere in the filename
            let rawName = file.name.toUpperCase();
            let match = rawName.match(/(EP|P)\d{2}/);
            setFinishCode(match ? match[0] : "");
            
            // Reset Cropper state for the new image
            setCropScale(100);
            setCropX(50);
            setCropY(50);
            
            return () => URL.revokeObjectURL(objectUrl);
        } else {
            setImageSrc(null);
        }
    }, [currentIndex, queue]);

    // 4. Check for Overwrite Conflicts
    useEffect(() => {
        if (!finishCode) {
            setConflictWarning(null);
            return;
        }
        
        const inHouseMatch = globalFinishes.find(f => f.code === finishCode || f.id === finishCode || f.name === finishCode);
        const outsourceMatch = outsourceFinishes.find(f => f.id === finishCode || f.name === finishCode);
        
        if (inHouseMatch) {
            setConflictWarning({ type: 'IN_HOUSE', finish: inHouseMatch, hasTexture: !!inHouseMatch.textureUrl });
        } else if (outsourceMatch) {
            setConflictWarning({ type: 'OUTSOURCE', finish: outsourceMatch, hasTexture: !!outsourceMatch.textureUrl });
        } else {
            setConflictWarning(null);
        }
    }, [finishCode, globalFinishes, outsourceFinishes]);

    // Track actual rendered size of the image to keep the overlay accurate
    const handleImageLoad = (e) => {
        setImgDims({
            w: e.target.width,
            h: e.target.height,
            natW: e.target.naturalWidth,
            natH: e.target.naturalHeight
        });
    };

    // 5. Generate Cropped Image (Extract the exact pixels mapped by the overlay)
    const getCroppedBlob = () => {
        return new Promise((resolve) => {
            if (!imageRef.current || !canvasRef.current) return resolve(null);
            
            const img = imageRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            // Force 1024x1024 output for the renderer
            canvas.width = 1024;
            canvas.height = 1024;
            
            // Calculate natural coordinates
            const minDimNat = Math.min(imgDims.natW, imgDims.natH);
            const boxNatPx = minDimNat * (cropScale / 100);
            const maxNatX = imgDims.natW - boxNatPx;
            const maxNatY = imgDims.natH - boxNatPx;
            const sx = maxNatX * (cropX / 100);
            const sy = maxNatY * (cropY / 100);
            
            ctx.drawImage(img, sx, sy, boxNatPx, boxNatPx, 0, 0, 1024, 1024);
            
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.95);
        });
    };

    // 6. Approve, Process & Next
    const handleApproveAndNext = async () => {
        if (!finishCode) return alert("Finish code is required to map the texture.");
        if (!conflictWarning) return alert("Warning: This finish code does not exist in the database. Please create the Master Finish first.");
        
        setIsProcessing(true);
        
        try {
            let finalBlob = await getCroppedBlob();
            
            // ====================================================================
            // 🚀 AI PROCESSING INJECTION POINT
            // ====================================================================
            if (aiPrompt) {
                console.log(`Sending image to AI with prompt: ${aiPrompt}`);
                /* TODO: External API Hook
                   const base64Image = await convertBlobToBase64(finalBlob);
                   const aiResponse = await fetch('YOUR_AI_ENDPOINT', { ... });
                   finalBlob = await aiResponse.blob();
                */
            }
            // ====================================================================

            // Upload to Storage
            const uniqueTimestamp = Date.now();
            const storageRef = ref(storage, `system_textures/TEX_${finishCode}_${uniqueTimestamp}.jpg`);
            const uploadTask = await uploadBytes(storageRef, finalBlob);
            const downloadUrl = await getDownloadURL(uploadTask.ref);
            
            // Update Database
            if (conflictWarning.type === 'IN_HOUSE') {
                const updatedFinishes = globalFinishes.map(f => 
                    f.id === conflictWarning.finish.id ? { ...f, textureUrl: downloadUrl } : f
                );
                await updateDoc(doc(db, "system", "master_finishes"), { finishes: updatedFinishes });
            } else {
                await updateDoc(doc(db, "hq_outsource_finishes", conflictWarning.finish.id), { textureUrl: downloadUrl });
            }
            
            setCurrentIndex(prev => prev + 1);
        } catch (error) {
            console.error("Texture Processing Error:", error);
            alert("Failed to process texture.");
        } finally {
            setIsProcessing(false);
        }
    };

    const remaining = Math.max(0, queue.length - currentIndex);
    const isDone = queue.length > 0 && currentIndex >= queue.length;

    // Calculate visual box overlay dimensions based on slider state
    const minDimRendered = Math.min(imgDims.w, imgDims.h);
    const boxPx = minDimRendered * (cropScale / 100);
    const maxLeft = imgDims.w - boxPx;
    const maxTop = imgDims.h - boxPx;
    const leftPx = maxLeft * (cropX / 100);
    const topPx = maxTop * (cropY / 100);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>
            
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Texture Ingestion Engine</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>CROP, ENHANCE & MAP TO CPQ</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: remaining > 0 ? theme.brass : theme.inkSoft }}>{remaining} REMAINING</div>
                    <label style={{ background: theme.ink, color: '#fff', padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e=>e.currentTarget.style.background=theme.brass} onMouseOut={e=>e.currentTarget.style.background=theme.ink}>
                        + SELECT BATCH
                        <input type="file" multiple accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
                    </label>
                </div>
            </div>

            {queue.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px dashed ${theme.brass}`, color: theme.inkSoft, fontFamily: theme.serif, fontSize: '1.4rem' }}>
                    Select a Batch of Raw Finish Photos to Begin
                </div>
            ) : isDone ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: theme.paper2 }}>
                    <h2 style={{ fontFamily: theme.serif }}>Batch Complete</h2>
                    <button onClick={() => { setQueue([]); setCurrentIndex(0); }} style={{ padding: '12px 24px', background: theme.ink, color: '#fff', cursor: 'pointer' }}>NEW BATCH</button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '20px', flex: 1, padding: '0 20px', paddingBottom: '30px' }}>
                    
                    {/* Visual Cropper Area */}
                    <div style={{ flex: 2, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '15px', background: theme.paper2, borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em' }}>
                            SOURCE IMAGE: {queue[currentIndex]?.name}
                        </div>
                        
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px' }}>
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                            
                            {imageSrc && (
                                <div style={{ position: 'relative', display: 'inline-block', overflow: 'hidden' }}>
                                    <img 
                                        ref={imageRef} 
                                        src={imageSrc} 
                                        alt="Raw Texture" 
                                        onLoad={handleImageLoad}
                                        style={{ maxHeight: '55vh', maxWidth: '100%', objectFit: 'contain', display: 'block' }} 
                                    />
                                    {imgDims.w > 0 && (
    <div style={{ 
        position: 'absolute',
        top: `${topPx}px`, left: `${leftPx}px`,
        width: `${boxPx}px`, height: `${boxPx}px`,
        border: `2px dashed ${theme.brass}`,
        background: 'rgba(255,255,255,0.1)', pointerEvents: 'none',
        boxShadow: '0 0 0 9999px rgba(28,26,22,0.6)'
    }}>
        <div style={{ 
            position: 'absolute', 
            bottom: '100%', 
            left: '-2px', 
            marginBottom: '4px',
            color: '#fff', 
            fontFamily: theme.mono, 
            fontSize: '10px', 
            background: theme.brass, 
            padding: '4px 8px',
            whiteSpace: 'nowrap'
        }}>
            1024x1024 EXTRACTION ZONE
        </div>
    </div>
)}

                            {/* Slider Controls */}
                            {imgDims.w > 0 && (
                                <div style={{ width: '100%', maxWidth: '400px', marginTop: '30px', display: 'flex', flexDirection: 'column', gap: '15px', padding: '20px', background: theme.paper2, border: `1px solid ${theme.line}` }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'flex', justifyContent: 'space-between' }}>
                                            <span>VIEWFINDER SIZE</span> <span>{cropScale}%</span>
                                        </label>
                                        <input type="range" min="10" max="100" value={cropScale} onChange={e => setCropScale(e.target.value)} style={{ width: '100%' }} />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'flex', justifyContent: 'space-between' }}>
                                            <span>PAN X (HORIZONTAL)</span> <span>{cropX}%</span>
                                        </label>
                                        <input type="range" min="0" max="100" value={cropX} onChange={e => setCropX(e.target.value)} style={{ width: '100%' }} />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                        <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'flex', justifyContent: 'space-between' }}>
                                            <span>PAN Y (VERTICAL)</span> <span>{cropY}%</span>
                                        </label>
                                        <input type="range" min="0" max="100" value={cropY} onChange={e => setCropY(e.target.value)} style={{ width: '100%' }} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Metadata & AI Control Panel */}
                    <div style={{ flex: 1.2, background: '#fff', border: `1px solid ${theme.line}`, padding: '30px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        
                        <div>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.1em' }}>AUTO-DETECTED FINISH CODE</label>
                            <input 
                                type="text" 
                                value={finishCode} 
                                onChange={e => setFinishCode(e.target.value.toUpperCase())}
                                style={{ width: '100%', padding: '12px', fontSize: '1rem', marginTop: '8px', border: `1px solid ${theme.line}`, outline: 'none' }}
                            />
                        </div>

                        <div style={{ minHeight: '80px' }}>
                            {conflictWarning ? (
                                <div style={{ background: conflictWarning.hasTexture ? '#fff3cd' : '#d4edda', border: `1px solid ${conflictWarning.hasTexture ? '#ffeeba' : '#c3e6cb'}`, padding: '15px' }}>
                                    <div style={{ fontFamily: theme.sans, fontSize: '0.9rem', fontWeight: 500, color: theme.ink }}>
                                        ✓ Found in {conflictWarning.type === 'IN_HOUSE' ? 'In-House' : 'Outsourced'} Finishes: {conflictWarning.finish.name}
                                    </div>
                                    {conflictWarning.hasTexture && (
                                        <div style={{ marginTop: '5px', fontSize: '0.85rem', color: '#856404' }}>
                                            ⚠️ Warning: A texture map already exists for this finish. Proceeding will overwrite it.
                                        </div>
                                    )}
                                </div>
                            ) : finishCode ? (
                                <div style={{ background: '#f8d7da', border: '1px solid #f5c6cb', padding: '15px', color: '#721c24', fontSize: '0.9rem' }}>
                                    ❌ No matching finish found. Please ensure the finish is created in the Library first.
                                </div>
                            ) : null}
                        </div>

                        <div style={{ flex: 1 }}>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.1em' }}>AI ENHANCEMENT PROMPT (OPTIONAL)</label>
                            <textarea 
                                value={aiPrompt} 
                                onChange={e => setAiPrompt(e.target.value)}
                                placeholder="e.g., Make seamless, ensure matte gold with light aging, reduce glare..."
                                style={{ width: '100%', padding: '12px', minHeight: '120px', marginTop: '8px', border: `1px solid ${theme.line}`, resize: 'vertical', fontFamily: theme.sans, outline: 'none' }}
                            />
                            <span style={{ fontSize: '0.8rem', color: theme.inkSoft, marginTop: '5px', display: 'block' }}>
                                Instructions sent to the texture generator alongside the cropped image.
                            </span>
                        </div>

                        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button 
                                onClick={handleApproveAndNext} 
                                disabled={isProcessing || !finishCode || !conflictWarning}
                                style={{ 
                                    padding: '15px', background: (isProcessing || !conflictWarning) ? theme.paper2 : theme.ink, 
                                    color: (isProcessing || !conflictWarning) ? theme.inkSoft : '#fff', 
                                    border: 'none', cursor: (isProcessing || !conflictWarning) ? 'not-allowed' : 'pointer',
                                    fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s'
                                }}
                            >
                                {isProcessing ? "PROCESSING..." : "APPROVE & NEXT IMAGE"}
                            </button>
                            <button 
                                onClick={() => setCurrentIndex(prev => prev + 1)} 
                                disabled={isProcessing} 
                                style={{ background: 'transparent', color: theme.inkSoft, border: 'none', padding: '10px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px' }}
                            >
                                SKIP FILE
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BatchTextureProcessor;