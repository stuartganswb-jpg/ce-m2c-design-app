import React from 'react';
import { db } from '../../firebase';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { Environment, ContactShadows, Lightformer } from '@react-three/drei';

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
// ============================================================================

// --- Lighting dials ---------------------------------------------------------
const ENV_INTENSITY = 1.15;   // brief: 1.0–1.5. Overall reflection strength.
const KEY_INTENSITY = 4.0;    // main softbox (upper front, ~35°)
const RIM_INTENSITY = 1.3;    // opposite rim ≈ 30% of key
const TOP_INTENSITY = 2.0;    // long thin overhead strip (product-table light)
const AMBIENT_FLOOR = 0.15;   // tiny — stops undersides clipping to black; env does the work

// Default material response for a finish applied as a texture map.
const DEFAULT_ENVMAP_INTENSITY = 1.25;

// In-house master finishes are PAINTS (that's why they phosphate first): even the
// gold/brass metallic tones are a coating over steel, not bare plate — cap the metal
// response and cut reflection energy vs. plated so they don't render "hot".
// (Stuart 2026-07-15 after first look: EP plated = good, P painted = a touch hot.)
const PAINTED_TRIM = { metalnessMax: 0.8, roughnessMin: 0.36, envMapIntensity: 0.95 };
const trimPainted = (p) => ({
    metalness: Math.min(p.metalness, PAINTED_TRIM.metalnessMax),
    roughness: Math.max(p.roughness, PAINTED_TRIM.roughnessMin),
    envMapIntensity: PAINTED_TRIM.envMapIntensity,
});

// --- Per-finish-CODE PBR (from the catalog brief — actual chip statistics) ---
// metalness 1.0 = bare metal (the map itself becomes the reflectance tint);
// Matte Black is a COATING, not bare metal → dielectric, no mirror hotspot.
const CODE_PBR = {
    SS: { metalness: 1.0, roughness: 0.30 }, // Satin Silver
    WS: { metalness: 1.0, roughness: 0.32 }, // Warm Silver
    CG: { metalness: 1.0, roughness: 0.30 }, // Champagne Gold
    PG: { metalness: 1.0, roughness: 0.28 }, // Pure Gold
    WB: { metalness: 1.0, roughness: 0.32 }, // Warm Brass
    GB: { metalness: 1.0, roughness: 0.42 }, // Golden Bronze
    OB: { metalness: 1.0, roughness: 0.52 }, // Oxidized Bronze
    MB: { metalness: 0.0, roughness: 0.55 }, // Matte Black (coating)
};

// Name-based fallbacks, checked in order (first hit wins).
const NAME_PBR = [
    { rx: /oak|walnut|wood|stain(ed)?\b/i, pbr: { metalness: 0.0, roughness: 0.60 } },
    { rx: /acrylic|lucite|\bclear\b/i, pbr: { metalness: 0.0, roughness: 0.12 } },
    { rx: /matte|flat\b|powder|paint|primer|lacquer/i, pbr: { metalness: 0.10, roughness: 0.52 } },
    { rx: /polish|chrome|mirror|bright/i, pbr: { metalness: 1.0, roughness: 0.20 } },
    { rx: /brush|satin|antique|bronze|brass|gold|silver|nickel|pewter|gunmetal|copper|steel|iron/i, pbr: { metalness: 1.0, roughness: 0.34 } },
];
const DEFAULT_PBR = { metalness: 0.9, roughness: 0.38 };          // unknown in-house finish
const DEFAULT_PLATED_PBR = { metalness: 1.0, roughness: 0.25 };   // unknown outsourced plate = smooth

const resolvePbr = (f, fallback) => {
    // Explicit per-finish override wins (optional `pbr: {metalness, roughness}` on the
    // master-finish entry — honored here whenever the finishes editor grows the fields).
    if (f && f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number') {
        return { metalness: f.pbr.metalness, roughness: f.pbr.roughness };
    }
    const code = String(f?.code || '').trim().toUpperCase();
    if (CODE_PBR[code]) return CODE_PBR[code];
    const name = String(f?.name || '');
    const hit = NAME_PBR.find(n => n.rx.test(name));
    return hit ? hit.pbr : fallback;
};

// --- Registry: finish texture URL -> PBR ------------------------------------
// Loaded once per session from the same docs the CPQ builds its finish steps
// from. If the fetch fails (offline/unauthenticated) the defaults still apply.
let pbrByUrl = null;
let pbrLoadPromise = null;
export const ensureFinishPbr = () => {
    if (!pbrLoadPromise) {
        pbrLoadPromise = (async () => {
            const map = {};
            try {
                const snap = await getDoc(doc(db, 'system', 'master_finishes'));
                (snap.exists() ? (snap.data().finishes || []) : []).forEach(f => {
                    if (!(f && f.textureUrl)) return;
                    // Explicit per-finish pbr{} skips the painted trim (the escape hatch).
                    const explicit = f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number';
                    const base = resolvePbr(f, DEFAULT_PBR);
                    map[f.textureUrl] = explicit ? base : trimPainted(base);
                });
            } catch (e) { /* keep defaults */ }
            try {
                const out = await getDocs(collection(db, 'hq_outsource_finishes'));
                out.docs.forEach(d => {
                    const f = d.data();
                    if (f && f.textureUrl && !map[f.textureUrl]) map[f.textureUrl] = resolvePbr(f, DEFAULT_PLATED_PBR);
                });
            } catch (e) { /* keep defaults */ }
            pbrByUrl = map;
        })();
    }
    return pbrLoadPromise;
};

// Sync lookup at material-apply time (call ensureFinishPbr() first; unknown URLs
// — customer-supplied assets etc. — get the generic metal default).
export const pbrForTexture = (url) => {
    const pbr = (pbrByUrl && pbrByUrl[url]) || DEFAULT_PBR;
    // Entry-level envMapIntensity (painted trim) wins over the plated/unknown default.
    return { envMapIntensity: DEFAULT_ENVMAP_INTENSITY, ...pbr };
};

// --- The rig -----------------------------------------------------------------
// Drop-in replacement for the old <ambientLight 0.9/> + <directionalLight/> +
// <Environment preset="warehouse"/> + <ContactShadows/> stack. Reflections are
// environment-map based, so it works at any model scale (inches or meters).
export const StudioRig = ({ shadowY = -0.5 }) => (
    <>
        <Environment resolution={512} environmentIntensity={ENV_INTENSITY}>
            {/* key softbox — upper front-left ~35°; the primary streak on the part */}
            <Lightformer form="rect" intensity={KEY_INTENSITY} position={[-3.2, 3.4, 4.2]} target={[0, 0, 0]} scale={[5.5, 3.2, 1]} />
            {/* rim — opposite side, ~30% of key, separates the part from the bg */}
            <Lightformer form="rect" intensity={RIM_INTENSITY} position={[4.2, 2.2, -3.6]} target={[0, 0, 0]} scale={[4.5, 2.6, 1]} />
            {/* overhead strip — the long thin highlight band on horizontal poles */}
            <Lightformer form="rect" intensity={TOP_INTENSITY} position={[0, 5.2, 0]} target={[0, 0, 0]} scale={[7, 1.6, 1]} />
            {/* warm floor bounce + cool back wall: fills the dark side so metal
                never reads as a black hole, and gives reflections two tones */}
            <Lightformer form="rect" intensity={0.7} color="#f4efe6" position={[0, -4.5, 0]} target={[0, 0, 0]} scale={[8, 8, 1]} />
            <Lightformer form="rect" intensity={0.55} color="#eef0f4" position={[0, 1.2, -6]} target={[0, 0, 0]} scale={[10, 5, 1]} />
        </Environment>
        <ambientLight intensity={AMBIENT_FLOOR} />
        <ContactShadows position={[0, shadowY, 0]} opacity={0.42} scale={10} blur={2.4} far={4} />
    </>
);

export default StudioRig;
