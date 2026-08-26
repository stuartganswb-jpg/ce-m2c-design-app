import React, { useState, useEffect, useRef } from 'react';
import { db, storage } from '../../firebase';
import { collection, doc, updateDoc, onSnapshot } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

const theme = { paper: '#faf8f4', paper2: '#f2efe8', ink: '#1c1a16', inkSoft: '#524e46', brass: '#b08d57', line: 'rgba(28,26,22,.14)', serif: "'Cormorant Garamond', Georgia, serif", sans: "'Inter', -apple-system, sans-serif", mono: "'IBM Plex Mono', monospace" };

// Normalize a finish code for matching: uppercase, strip non-alphanumeric, and undo the EP
// zero-pad (EP01 -> EP1) so the gallery/filename codes line up with the master finish codes.
const normFinish = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^EP0+(\d+)$/, 'EP$1');

// ---------------------------------------------------------------------------
// SOFTEN EXISTING SWATCHES (Stuart 2026-07-15): the painted P swatch photos
// carry a subtle lighting ramp + fine grain; tiled along a pole in the 3D
// engine the ramp repeats as "zebra stripes". Fix per swatch, all in-canvas:
//   1. FLATTEN — subtract the large-scale luminance field (8×8 downsample
//      smooth-upscaled back) while keeping the mean tone: kills the per-tile
//      light→dark ramp that reads as banding. A plain blur can't do this.
//   2. SOFTEN — gentle gaussian blur applied WRAP-AWARE (image drawn 3×3
//      tiled, blurred, center-cropped) so the blur blends across the tile
//      seam instead of haloing at the edges.
// Uploads a NEW file (system_textures/..._soft.jpg) and repoints textureUrl —
// old saved quotes keep their old URLs, which stay in storage untouched.
// ---------------------------------------------------------------------------
const loadCorsImage = (url) => new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image load failed (CORS or missing file)'));
    im.src = url;
});

const softenSwatch = async (url, { blurPx = 1.5, flatten = 0.85, maxDim = 1024 } = {}) => {
    const img = await loadCorsImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(2, Math.round(img.naturalWidth * scale));
    const h = Math.max(2, Math.round(img.naturalHeight * scale));
    const base = document.createElement('canvas'); base.width = w; base.height = h;
    const bctx = base.getContext('2d');
    bctx.drawImage(img, 0, 0, w, h);

    if (flatten > 0) {
        const tiny = document.createElement('canvas'); tiny.width = 8; tiny.height = 8;
        tiny.getContext('2d').drawImage(base, 0, 0, 8, 8);
        const low = document.createElement('canvas'); low.width = w; low.height = h;
        const lctx = low.getContext('2d');
        lctx.imageSmoothingEnabled = true; lctx.imageSmoothingQuality = 'high';
        lctx.drawImage(tiny, 0, 0, w, h);
        const bd = bctx.getImageData(0, 0, w, h);
        const ld = lctx.getImageData(0, 0, w, h);
        let mr = 0, mg = 0, mb = 0; const n = w * h;
        for (let i = 0; i < ld.data.length; i += 4) { mr += ld.data[i]; mg += ld.data[i + 1]; mb += ld.data[i + 2]; }
        mr /= n; mg /= n; mb /= n;
        for (let i = 0; i < bd.data.length; i += 4) {
            bd.data[i] = Math.max(0, Math.min(255, bd.data[i] - flatten * (ld.data[i] - mr)));
            bd.data[i + 1] = Math.max(0, Math.min(255, bd.data[i + 1] - flatten * (ld.data[i + 1] - mg)));
            bd.data[i + 2] = Math.max(0, Math.min(255, bd.data[i + 2] - flatten * (ld.data[i + 2] - mb)));
        }
        bctx.putImageData(bd, 0, 0);
    }

    // Wrap-aware blur: 3×3 tile → blur → crop the center tile.
    const big = document.createElement('canvas'); big.width = w * 3; big.height = h * 3;
    const gctx = big.getContext('2d');
    for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) gctx.drawImage(base, tx * w, ty * h);
    const out = document.createElement('canvas'); out.width = w; out.height = h;
    const octx = out.getContext('2d');
    if (blurPx > 0) octx.filter = `blur(${blurPx}px)`; // unsupported browsers: draws unblurred (flatten still applied)
    octx.drawImage(big, -w, -h);
    octx.filter = 'none';
    return out;
};

const SwatchSoftener = ({ globalFinishes }) => {
    const [open, setOpen] = useState(false);
    const [blurPx, setBlurPx] = useState(1.5);
    const [flatten, setFlatten] = useState(85);
    const [onlyP, setOnlyP] = useState(true);
    const [previews, setPreviews] = useState({}); // finish id -> processed dataURL
    const [busy, setBusy] = useState(null);       // finish id | 'ALL' | null
    const [progress, setProgress] = useState('');

    const rows = (Array.isArray(globalFinishes) ? globalFinishes : [])
        .filter(f => f && f.textureUrl && (!onlyP || /^P\d+$/i.test(String(f.code || '').trim())));

    const opts = () => ({ blurPx: Number(blurPx) || 0, flatten: (Number(flatten) || 0) / 100 });

    const makePreview = async (f) => {
        setBusy(f.id);
        try {
            const c = await softenSwatch(f.textureUrl, opts());
            setPreviews(p => ({ ...p, [f.id]: c.toDataURL('image/jpeg', 0.9) }));
        } catch (e) { alert(`Preview failed for ${f.code || f.name}: ${e.message || e}`); }
        setBusy(null);
    };

    const uploadCanvas = async (f, canvas) => {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
        if (!blob) throw new Error('Encode failed');
        const path = `system_textures/TEX_${String(f.code || f.id).replace(/[^A-Za-z0-9_-]/g, '')}_${Date.now()}_soft.jpg`;
        const up = await uploadBytes(ref(storage, path), blob);
        return getDownloadURL(up.ref);
    };

    const applyOne = async (f) => {
        if (!window.confirm(`Soften ${f.code || f.name} and repoint its swatch?\n\nBlur ${blurPx}px · flatten ${flatten}%. The original file stays in storage (old quotes unaffected).`)) return;
        setBusy(f.id);
        try {
            const c = await softenSwatch(f.textureUrl, opts());
            const newUrl = await uploadCanvas(f, c);
            const updated = globalFinishes.map(x => x.id === f.id ? { ...x, textureUrl: newUrl } : x);
            await updateDoc(doc(db, "system", "master_finishes"), { finishes: updated });
            alert(`✓ ${f.code || f.name} softened. Hard-refresh (⌘⇧R) to see it in the 3D engine.`);
        } catch (e) { alert(`Failed on ${f.code || f.name}: ${e.message || e}`); }
        setBusy(null);
    };

    const applyAll = async () => {
        if (!rows.length) return;
        if (!window.confirm(`Soften ALL ${rows.length} swatch${rows.length === 1 ? '' : 'es'} listed below (blur ${blurPx}px · flatten ${flatten}%) and repoint them?\n\nOriginal files stay in storage — old saved quotes are unaffected. One database write at the end.`)) return;
        setBusy('ALL');
        // Process everything FIRST, then write ONCE — sequential per-finish writes over a
        // stale copy of the finishes array would revert each other.
        const newUrls = {}; const failed = [];
        for (let i = 0; i < rows.length; i++) {
            const f = rows[i];
            setProgress(`${i + 1}/${rows.length} — ${f.code || f.name}`);
            try {
                const c = await softenSwatch(f.textureUrl, opts());
                newUrls[f.id] = await uploadCanvas(f, c);
                setPreviews(p => ({ ...p, [f.id]: c.toDataURL('image/jpeg', 0.9) }));
            } catch (e) { failed.push(f.code || f.name); }
        }
        try {
            if (Object.keys(newUrls).length) {
                const updated = globalFinishes.map(x => newUrls[x.id] ? { ...x, textureUrl: newUrls[x.id] } : x);
                await updateDoc(doc(db, "system", "master_finishes"), { finishes: updated });
            }
            alert(`✓ Softened ${Object.keys(newUrls).length}/${rows.length}.${failed.length ? ` Failed: ${failed.join(', ')}.` : ''}\n\nHard-refresh (⌘⇧R) to see them in the 3D engine.`);
        } catch (e) { alert('Database update failed: ' + (e.message || e)); }
        setProgress(''); setBusy(null);
    };

    // Tiled previews (40px repeat) — tiling is exactly what exposes the banding.
    const tileStyle = (url) => ({ width: '150px', height: '56px', backgroundImage: `url(${url})`, backgroundSize: '40px 40px', backgroundRepeat: 'repeat', border: `1px solid ${theme.line}` });

    return (
        <div style={{ margin: '0 20px', background: '#fff', border: `1px solid ${theme.line}` }}>
            <div onClick={() => setOpen(o => !o)} style={{ padding: '14px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: theme.paper2 }}>
                <span style={{ fontFamily: theme.mono, fontSize: '11px', letterSpacing: '.12em', textTransform: 'uppercase', color: theme.ink }}>🩹 Soften Existing Swatches (de-band the 3D tiling)</span>
                <span style={{ fontFamily: theme.mono, fontSize: '11px', color: theme.inkSoft }}>{open ? '▲' : '▼'}</span>
            </div>
            {open && (
                <div style={{ padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '16px' }}>
                        <div>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'block', marginBottom: '4px' }}>SOFTEN BLUR: {blurPx}px</label>
                            <input type="range" min="0" max="4" step="0.5" value={blurPx} onChange={e => setBlurPx(e.target.value)} />
                        </div>
                        <div>
                            <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'block', marginBottom: '4px' }}>FLATTEN LIGHTING: {flatten}% <span title="Removes each photo's large-scale bright→dark ramp — the thing that repeats as zebra bands when tiled.">ⓘ</span></label>
                            <input type="range" min="0" max="100" step="5" value={flatten} onChange={e => setFlatten(e.target.value)} />
                        </div>
                        <label style={{ fontFamily: theme.mono, fontSize: '10px', color: theme.inkSoft, display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                            <input type="checkbox" checked={onlyP} onChange={e => setOnlyP(e.target.checked)} /> P## (PAINTED) ONLY
                        </label>
                        <button onClick={applyAll} disabled={busy !== null || !rows.length} style={{ padding: '10px 18px', background: busy ? theme.paper2 : theme.ink, color: busy ? theme.inkSoft : '#fff', border: 'none', cursor: busy ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>
                            {busy === 'ALL' ? `PROCESSING ${progress}` : `SOFTEN ALL ${rows.length}`}
                        </button>
                    </div>
                    <div style={{ fontFamily: theme.mono, fontSize: '9px', color: theme.inkSoft, marginBottom: '12px' }}>Previews are TILED (like the engine tiles them on a pole) — the banding you're fixing shows in the CURRENT column and should be gone in SOFTENED.</div>
                    <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                        {rows.map(f => (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '8px 0', borderTop: `1px solid ${theme.line}` }}>
                                <span style={{ fontFamily: theme.mono, fontSize: '11px', fontWeight: 600, color: theme.ink, minWidth: '46px' }}>{f.code || '—'}</span>
                                <span style={{ fontFamily: theme.sans, fontSize: '0.85rem', color: theme.inkSoft, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || ''}</span>
                                <div><div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.inkSoft, marginBottom: '2px' }}>CURRENT</div><div style={tileStyle(f.textureUrl)} /></div>
                                <div><div style={{ fontFamily: theme.mono, fontSize: '8px', color: theme.inkSoft, marginBottom: '2px' }}>SOFTENED</div>{previews[f.id] ? <div style={tileStyle(previews[f.id])} /> : <div style={{ ...tileStyle(''), backgroundImage: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: theme.inkSoft, fontFamily: theme.mono, fontSize: '9px' }}>—</div>}</div>
                                <button onClick={() => makePreview(f)} disabled={busy !== null} style={{ padding: '8px 12px', background: 'transparent', color: theme.ink, border: `1px solid ${theme.line}`, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase' }}>{busy === f.id ? '…' : 'Preview'}</button>
                                <button onClick={() => applyOne(f)} disabled={busy !== null} style={{ padding: '8px 12px', background: 'transparent', color: theme.brass, border: `1px solid ${theme.brass}`, cursor: busy ? 'not-allowed' : 'pointer', fontFamily: theme.mono, fontSize: '9px', textTransform: 'uppercase' }}>Apply</button>
                            </div>
                        ))}
                        {!rows.length && <div style={{ padding: '16px 0', fontFamily: theme.sans, fontSize: '0.9rem', color: theme.inkSoft }}>No finishes with swatches match the filter.</div>}
                    </div>
                </div>
            )}
        </div>
    );
};

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
    const [cropScale, setCropScale] = useState(100);
    const [cropX, setCropX] = useState(50);
    const [cropY, setCropY] = useState(50);
    const [rotation, setRotation] = useState(0);   // 0 | 90 | 180 | 270 — baked into imageSrc

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

    const allFinishes = [...(Array.isArray(globalFinishes) ? globalFinishes : []), ...(Array.isArray(outsourceFinishes) ? outsourceFinishes : [])];

    // 3. Load Current Image (preview + crop reset)
    // ── ROTATE 90° AT A TIME (Stuart 2026-08-26: "my rendering designer exported this most
    // recent batch with the wood grain going vertical instead of horizontal"). The rotation is
    // BAKED INTO THE SOURCE — the file is redrawn onto an offscreen canvas at the chosen angle
    // and that becomes imageSrc — so the crop overlay, the pan math and the 1024² extraction all
    // keep working on what they see, and the uploaded texture is genuinely rotated.
    useEffect(() => {
        if (!(queue.length > 0 && currentIndex < queue.length)) { setImageSrc(null); return; }
        const file = queue[currentIndex];
        const objectUrl = URL.createObjectURL(file);
        let rotatedUrl = null;
        let alive = true;
        if (!rotation) {
            setImageSrc(objectUrl);
        } else {
            const img = new Image();
            img.onload = () => {
                if (!alive) return;
                const quarter = rotation === 90 || rotation === 270;
                const c = document.createElement('canvas');
                c.width = quarter ? img.naturalHeight : img.naturalWidth;
                c.height = quarter ? img.naturalWidth : img.naturalHeight;
                const ctx = c.getContext('2d');
                ctx.translate(c.width / 2, c.height / 2);
                ctx.rotate((rotation * Math.PI) / 180);
                ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
                c.toBlob(b => {
                    if (!alive || !b) return;
                    rotatedUrl = URL.createObjectURL(b);
                    setImageSrc(rotatedUrl);
                }, 'image/png');
            };
            img.src = objectUrl;
        }
        return () => { alive = false; URL.revokeObjectURL(objectUrl); if (rotatedUrl) URL.revokeObjectURL(rotatedUrl); };
    }, [currentIndex, queue, rotation]);

    // A NEW image starts unrotated with a fresh crop; turning the current one keeps the crop
    // sliders where they are (the geometry moved, but the operator is mid-adjustment).
    useEffect(() => {
        if (!(queue.length > 0 && currentIndex < queue.length)) return;
        setAiPrompt("");
        setRotation(0);
        setCropScale(100);
        setCropX(50);
        setCropY(50);
    }, [currentIndex, queue]);

    // 3b. Auto-detect the finish code by aligning the filename to the MASTER finishes (not a fixed
    // regex). Pull EP/P/S+digits candidates + filename tokens, normalize (EP zero-strip), and match
    // against each finish's code / descriptive name / id; set the canonical code. Re-runs when the
    // finishes load so detection lines up even on the first image. Falls back to a broadened regex
    // hit (EP/P/S + 1-3 digits) so a code still surfaces when no master finish exists yet.
    useEffect(() => {
        if (!(queue.length > 0 && currentIndex < queue.length)) return;
        const raw = String(queue[currentIndex]?.name || '').toUpperCase().replace(/\.[^.]+$/, '');
        const regexHits = raw.match(/(?:EP|P|S)\d{1,3}/g) || [];
        const tokens = raw.split(/[^A-Z0-9]+/).filter(Boolean);
        const candidates = [...new Set([...regexHits, ...tokens])];
        let detected = '';
        for (const c of candidates) {
            const nc = normFinish(c);
            const hit = allFinishes.find(f => normFinish(f.code) === nc || normFinish(f.name) === nc || normFinish(f.id) === nc);
            if (hit) { detected = hit.code || hit.name || c; break; }
        }
        if (!detected) detected = regexHits[0] || '';
        setFinishCode(detected);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, queue, globalFinishes, outsourceFinishes]);

    // 4. Check for Overwrite Conflicts
    useEffect(() => {
        if (!finishCode) {
            setConflictWarning(null);
            return;
        }
        
        const nc = normFinish(finishCode);
        const inHouseMatch = globalFinishes.find(f => normFinish(f.code) === nc || normFinish(f.id) === nc || normFinish(f.name) === nc);
        const outsourceMatch = outsourceFinishes.find(f => normFinish(f.code) === nc || normFinish(f.id) === nc || normFinish(f.name) === nc);
        
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

            <SwatchSoftener globalFinishes={globalFinishes} />

            {queue.length === 0 ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: `1px dashed ${theme.brass}`, color: theme.inkSoft, fontFamily: theme.serif, fontSize: '1.4rem' }}>
                    Select a Batch of Raw Finish Photos to Begin
                </div>
            ) : isDone ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: theme.paper2 }}>
                    <h2 style={{ fontFamily: theme.serif }}>Batch Complete</h2>
                    <button onClick={() => { setQueue([]); setCurrentIndex(0); }} style={{ padding: '12px 24px', background: theme.ink, color: '#fff', cursor: 'pointer', border: 'none', fontFamily: theme.mono, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em' }}>NEW BATCH</button>
                </div>
            ) : (
                <div style={{ display: 'flex', gap: '20px', flex: 1, padding: '0 20px', paddingBottom: '30px' }}>
                    
                    {/* Visual Cropper Area */}
                    <div style={{ flex: 2, background: '#fff', border: `1px solid ${theme.line}`, display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '10px 15px', background: theme.paper2, borderBottom: `1px solid ${theme.line}`, fontFamily: theme.mono, fontSize: '10px', letterSpacing: '.1em', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>SOURCE IMAGE: {queue[currentIndex]?.name}</span>
                            {/* Rotate the SOURCE 90° at a time — the grain direction is a fact about the
                                texture, so it bakes into what uploads, not just what previews. */}
                            <button onClick={() => setRotation(r => (r + 270) % 360)} title="Rotate 90° counter-clockwise"
                                style={{ padding: '6px 12px', background: '#fff', color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px' }}>↺ 90°</button>
                            <button onClick={() => setRotation(r => (r + 90) % 360)} title="Rotate 90° clockwise"
                                style={{ padding: '6px 12px', background: '#fff', color: theme.ink, border: `1px solid ${theme.line}`, cursor: 'pointer', fontFamily: theme.mono, fontSize: '11px' }}>↻ 90°</button>
                            {rotation !== 0 && <span style={{ color: theme.brass, whiteSpace: 'nowrap' }}>ROTATED {rotation}°</span>}
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
                                        ✓ Found in {conflictWarning.type === 'IN_HOUSE' ? 'In-House' : 'Outsourced'} Finishes: {[conflictWarning.finish.code, conflictWarning.finish.name].filter(Boolean).join(' · ')}
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
                                style={{ background: 'transparent', color: theme.inkSoft, border: 'none', padding: '10px', cursor: 'pointer', fontFamily: theme.mono, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}
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