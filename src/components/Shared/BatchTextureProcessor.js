import React, { useState, useEffect, useRef, useCallback } from 'react';
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
    
    // Simple 1:1 Crop State (Simulated Bounding Box)
    const imageRef = useRef(null);
    const canvasRef = useRef(null);
    const [cropSize, setCropSize] = useState(250); // Visual representation size

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
            
            // Extract code (e.g., "Texture_EP03.jpg" -> "EP03")
            let rawName = file.name.split('.')[0].toUpperCase();
            let parts = rawName.split(/[_.-]/);
            let extractedCode = parts[parts.length - 1];
            setFinishCode(extractedCode);
            
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

    // 5. Generate Cropped Image (1024x1024 Target)
    const getCroppedBlob = () => {
        return new Promise((resolve) => {
            if (!imageRef.current || !canvasRef.current) return resolve(null);
            
            const img = imageRef.current;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            
            // Target Texture Size
            canvas.width = 1024;
            canvas.height = 1024;
            
            // Calculate center crop (1:1 ratio)
            const minDim = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - minDim) / 2;
            const sy = (img.naturalHeight - minDim) / 2;
            
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 1024, 1024);
            
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
                /* TODO: Hook up your external API here.
                   const base64Image = await convertBlobToBase64(finalBlob);
                   const aiResponse = await fetch('YOUR_AI_ENDPOINT', {
                       method: 'POST',
                       body: JSON.stringify({ image: base64Image, prompt: aiPrompt })
                   });
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
            
            // Move to Next
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', backgroundColor: theme.paper, minHeight: '100vh', fontFamily: theme.sans }}>
            
            {/* Header */}
            <div style={{ background: '#fff', border: `1px solid ${theme.line}`, padding: '20px 30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <h2 style={{ margin: 0, fontFamily: theme.serif, fontSize: '1.6rem', fontWeight: 500, color: theme.ink }}>Texture Ingestion Engine</h2>
                    <span style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, letterSpacing: '.18em', textTransform: 'uppercase' }}>CROP, ENHANCE & MAP TO CPQ</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.1em', color: remaining > 0 ? theme.brass : theme.inkSoft }}>{remaining} REMAINING</div>
                    <label style={{ background: theme.ink, color: '#fff', padding: '10px 20px', fontFamily: theme.mono, fontSize: '11px', cursor: 'pointer' }}>
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
                <div style={{ display: 'flex', gap: '20px', flex: 1, padding: '0 20px' }}>
                    
                    {/* Visual Cropper Area */}
                    <div style={{ flex: 2, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                        <div style={{ padding: '15px', background: theme.paper2, borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em' }}>
                            SOURCE IMAGE: {queue[currentIndex]?.name}
                        </div>
                        
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', position: 'relative', overflow: 'hidden' }}>
                            {/* Hidden canvas for extraction */}
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                            
                            {imageSrc && (
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                    <img 
                                        ref={imageRef} 
                                        src={imageSrc} 
                                        alt="Raw Texture" 
                                        style={{ maxHeight: '60vh', maxWidth: '100%', objectFit: 'contain', opacity: 0.8 }} 
                                    />
                                    {/* Simulated Bounding Box Overlay (Center Crop) */}
                                    <div style={{ 
                                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                                        width: '50%', height: '0', paddingBottom: '50%', /* Forces 1:1 Aspect Ratio Box */
                                        border: `2px dashed ${theme.brass}`, background: 'rgba(255,255,255,0.1)',
                                        pointerEvents: 'none', boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)'
                                    }}>
                                        <div style={{ position: 'absolute', top: '-25px', left: 0, color: '#fff', fontFamily: theme.mono, fontSize: '10px', background: theme.brass, padding: '2px 6px' }}>
                                            1024x1024 TARGET AREA
                                        </div>
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

                        {/* Overwrite Warning System */}
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
                                    fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em'
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