// ─────────────────────────────────────────────────────────────────────────────────────────────
// CPQ RENDER → GUIDE IMAGE (Stuart 2026-08-25)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "the perfect tool to generate these images already exists, the cpq. on the cpq i will select
//  the parts that i want to add to the guide, arrange them in the orientation that makes sense,
//  then add a button to capture and send to guide. those images can be stored as hi res (300dpi
//  transparent background png files). they can be saved in the asset gallery."
//
// So: the CPQ viewer is the studio, the Asset Gallery is the film library, and the Guide Builder
// (tab 1) is where the prints are laid on the page. This module is the shutter — it captures the
// live three.js canvas at a boosted pixel ratio with a TRANSPARENT background (the scene has no
// background of its own; the studio look comes from an Environment that lights without painting),
// and files the PNG in `global_assets` flagged `guideCapture: true` so the Guide Builder's image
// picker can find it beside the hand-uploaded gallery assets.

import { db, storage } from '../../firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Capture the r3f canvas as a hi-res transparent PNG data URL.
 * @param glState  the r3f state captured via <Canvas onCreated> — { gl, scene, camera }
 * @param scale    pixel-ratio boost (3 ≈ 300dpi when the image lands ~canvas-width/100 inches wide)
 */
export function captureTransparentPng(glState, { scale = 3 } = {}) {
    const { gl, scene, camera } = glState || {};
    if (!gl || !scene || !camera) return null;
    const prevRatio = gl.getPixelRatio();
    const prevBg = scene.background;
    try {
        scene.background = null;                    // transparent — the page supplies the paper
        gl.setPixelRatio(Math.max(prevRatio, scale));
        gl.render(scene, camera);
        return gl.domElement.toDataURL('image/png');
    } finally {
        scene.background = prevBg;
        gl.setPixelRatio(prevRatio);
        gl.render(scene, camera);                   // put the on-screen frame back
    }
}

const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

// A small PNG thumbnail (alpha kept) so the gallery and the picker stay fast.
async function thumbOf(dataUrl, maxPx = 420) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    const k = Math.min(1, maxPx / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(res => c.toBlob(res, 'image/png'));
}

/**
 * File a captured render in the Asset Gallery, shaped like every other gallery asset
 * (AssetGalleryTab writes the same fields) plus `guideCapture: true`.
 * Returns { id, originalUrl, thumbnailUrl }.
 */
export async function saveGuideCapture({ dataUrl, name, code = '', brandId = '', collection = '', user = '' }) {
    const safe = String(code || name || 'CAPTURE').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'CAPTURE';
    const brandFolder = brandId ? String(brandId) : 'global';
    const ts = Date.now();
    const sfx = Math.floor(Math.random() * 10000);

    const [hiBlob, thBlob] = await Promise.all([dataUrlToBlob(dataUrl), thumbOf(dataUrl)]);
    const hiRef = ref(storage, `global_assets/hires/${brandFolder}/GUIDE_${safe}_${ts}_${sfx}.png`);
    const thRef = ref(storage, `global_assets/thumbs/${brandFolder}/GUIDE_${safe}_${ts}_${sfx}_thumb.png`);
    const [hiUp, thUp] = await Promise.all([uploadBytes(hiRef, hiBlob), uploadBytes(thRef, thBlob)]);
    const [originalUrl, thumbnailUrl] = await Promise.all([getDownloadURL(hiUp.ref), getDownloadURL(thUp.ref)]);

    const id = `ASSET-${brandFolder}-GUIDE-${safe}-${ts}-${sfx}`;
    await setDoc(doc(db, 'global_assets', id), {
        id,
        name: String(name || safe).toUpperCase(),
        collection: collection || '',
        productType: 'GUIDE CAPTURE',
        patternId: String(code || '').toUpperCase(),
        finishId: '',
        customerId: '', clientSku: '', notes: 'Captured from CPQ for guide books',
        associatedParts: [], associatedFinishes: [],
        originalUrl, thumbnailUrl, url: thumbnailUrl,
        guideCapture: true,
        brandId: brandId || 'ALL',
        uploadedBy: user || 'Unknown',
        createdAt: serverTimestamp(),
    }, { merge: true });
    return { id, originalUrl, thumbnailUrl };
}
