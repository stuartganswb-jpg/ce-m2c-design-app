import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { setFinishPbrLoader } from './finishPbr';
import { StudioRig } from './studioRig';

// ============================================================================
// STUDIO RENDER RIG — shared photoreal setup for every product canvas
// (Stuart 2026-07-15, from the catalog session's CPQ_Rendering_Brief.)
//
// Photoreal metal in real time is ~90% the ENVIRONMENT, not the material:
// a bare ambient+directional rig reads flat and gray. This module provides
//   1. <StudioRig/> — a procedural softbox studio built from Lightformer
//      panels rendered into the environment map. The soft RECTANGULAR
//      reflection sweeping across a curved part is what sells machined metal.
//      Procedural = no runtime HDRI download (drei presets fetch from a CDN).
//   2. A per-finish PBR registry — finish swatches stay applied as texture
//      maps, but the material under them gets correct metalness/roughness
//      (paint vs plate vs wood vs acrylic respond to light differently).
// Tone mapping (ACES filmic) + sRGB output are already the fiber v9 defaults.
//
// ALL the tunable dials live in the constants below.
//
// ── SPLIT 2026-10-14 (the portal rebuild, step 4) ─────────────────────────────────────────────
// The rig is Shared/studioRig.js; the finish table, the registry and the wood UVs are Shared/finishPbr.js —
// both word for word — so the customer portal can draw with them. What stays HERE is the one thing only HQ
// can do: read the two finish documents. Every name this file exported is exported from it still, so no
// screen that imports it has changed.
// ============================================================================

// --- Registry source: HQ's finish documents ---------------------------------
// The two reads ensureFinishPbr made itself before the split, in the same order and each kept apart: if one
// fails, its finishes take the defaults and the other still loads.
setFinishPbrLoader(async () => {
    let master = [];
    let outsourced = [];
    try {
        const snap = await getDoc(doc(db, 'system', 'master_finishes'));
        master = snap.exists() ? (snap.data().finishes || []) : [];
    } catch (e) { /* keep defaults */ }
    try {
        const out = await getDocs(collection(db, 'hq_outsource_finishes'));
        outsourced = out.docs.map(d => d.data());
    } catch (e) { /* keep defaults */ }
    return { master, outsourced };
});

export { WOOD_TILE_IN, ensureWoodUv, woodRepeatFor, ensureFinishPbr, pbrForTexture } from './finishPbr';
export { StudioRig };
export default StudioRig;
