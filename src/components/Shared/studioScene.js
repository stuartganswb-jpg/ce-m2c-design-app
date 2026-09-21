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

// ── WOOD IS NOT A METAL WITH A BROWN TINT (Stuart 2026-09-20: "i loaded in the wood textures but they
// are rendering like smooth metal, the textures have wood grain in them … it looks like metal") ──────
// Two faults, both here. (1) A finish was recognised as wood only by the WORDS in its `name` — and the
// stains are named by code ("S03"; "Blonde Oak" lives in the customer mapping), so every one of them
// fell through to DEFAULT_PBR: metalness 0.9. On a metal the map only TINTS the reflection, so the
// grain in the swatch was never seen — the pole was a brown mirror of the softboxes. The 4.5 MATERIAL
// tag is what says wood, and it is read first now. (2) Even a finish that did match by name was then
// pushed through the painted trim, which sets a paint's reflection energy (0.95) — a coat of lacquer
// on steel, not a stained board.
// Wood: no metal response at all, a rough diffuse surface so the MAP is what you see, a little
// environment so it still sits in the studio, and the swatch doubles as a bump map so the grain catches
// the light. Dials:
// ⚠ envMapIntensity IS THE LIGHT, NOT JUST THE SHINE (2026-09-20, second pass: "no visual change" — it had
// changed, to a flat DARK board). This rig lights the scene almost entirely from the softbox environment,
// and on a non-metal that environment is the DIFFUSE light too: at 0.22 the wood was lit at a fifth and
// read as dark brown paint with no grain to see. Gloss is what ROUGHNESS is for; the light stays on.
// `albedo` MULTIPLIES the swatch, and it is not cosmetic fiddling: this rig is lit for METAL — one
// ambient at 0.15 plus an environment that is mostly black with a few bright softboxes in it. A mirror
// reflects those softboxes and looks right; a matte surface integrates the whole environment, which is
// darkness, so a mid-tone oak (Pure Oak averages RGB 152/135/126) rendered near-black. Measured live on
// the H1-138 rod: a pure RED matte surface in this scene renders dark maroon. Raising the scene's light
// instead would lift matte black and the acrylics, which read correctly today — so the compensation
// lives on the wood material alone and nothing else in the scene changes.
const WOOD_PBR = { metalness: 0.0, roughness: 0.82, envMapIntensity: 1.05, bumpScale: 0.6, albedo: 2.6, wood: true };

// ── WOOD NEEDS UVs, AND THESE MODELS HAVE NONE (Stuart 2026-09-20 — the actual cause) ───────────────
// Read off the live H1-138 rod: its geometry carries `position` and `normal` and NO `uv`. With no UVs a
// texture samples a single texel, so the part paints one flat colour — which is exactly "it looks like
// smooth metal", and why three passes of material work changed nothing: there was never any grain to
// see. Metal never exposed it, because a tint is all a mirror shows.
// So a wood part gets UVs built from its own geometry, in INCHES: one swatch covers WOOD_TILE_IN along
// the grain. A round section (a pole) wraps cylindrically — grain down the length, seam closed — and
// anything else takes a flat projection on its two largest faces. Computed once and cached on the
// geometry. A model that DOES bring its own UVs is never touched.
export const WOOD_TILE_IN = 12;
export const ensureWoodUv = (geom) => {
    if (!geom || !geom.attributes || !geom.attributes.position) return false;
    if (geom.attributes.uv) return false;
    if (geom.userData && geom.userData.woodUv) return true;
    const pos = geom.attributes.position;
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    if (!bb) return false;
    const sz = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
    const [L, A, B] = ['x', 'y', 'z'].sort((a, b) => sz[b] - sz[a]);
    if (!(sz[L] > 0)) return false;
    const round = sz[A] > 0 && Math.abs(sz[A] - sz[B]) / sz[A] < 0.35;
    const cA = (bb.min[A] + bb.max[A]) / 2, cB = (bb.min[B] + bb.max[B]) / 2;
    const gl = `get${L.toUpperCase()}`, ga = `get${A.toUpperCase()}`, gb = `get${B.toUpperCase()}`;
    const circum = (Math.PI * sz[A]) / WOOD_TILE_IN;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const l = pos[gl](i), a = pos[ga](i), b = pos[gb](i);
        uv[i * 2] = (l - bb.min[L]) / WOOD_TILE_IN;
        uv[i * 2 + 1] = round
            ? (Math.atan2(b - cB, a - cA) / (2 * Math.PI) + 0.5) * circum
            : (a - bb.min[A]) / WOOD_TILE_IN;
    }
    geom.setAttribute('uv', new pos.constructor(uv, 2));
    geom.userData = { ...(geom.userData || {}), woodUv: true };
    return true;
};

// ── THE GRAIN MUST NOT STRETCH (same pass) ──────────────────────────────────────────────────────────
// A swatch is a square photograph of a few inches of board. The models map ONE copy of it over a whole
// part, so on a long fascia or a pole it is pulled nine or ten times longer than it is tall and the
// grain smears into a smooth gradient — which is the "smooth metal" look even with the right material.
// From the mesh's own geometry: how much surface one UV unit covers along U and along V. The longer
// axis is tiled by that ratio (whole tiles, so a pole's seam still closes), so a texel is square on
// the part whatever units the model was drawn in. Pure geometry → cached on the geometry.
export const woodRepeatFor = (geom) => {
    if (!geom || !geom.attributes || !geom.attributes.position || !geom.attributes.uv) return [1, 1];
    if (geom.userData && geom.userData.woodRepeat) return geom.userData.woodRepeat;
    const pos = geom.attributes.position, uv = geom.attributes.uv, idx = geom.index;
    const tris = Math.floor((idx ? idx.count : pos.count) / 3);
    const step = Math.max(1, Math.floor(tris / 300));
    let su = 0, sv = 0, n = 0;
    for (let t = 0; t < tris; t += step) {
        const a = idx ? idx.getX(t * 3) : t * 3, b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const e1 = [pos.getX(b) - pos.getX(a), pos.getY(b) - pos.getY(a), pos.getZ(b) - pos.getZ(a)];
        const e2 = [pos.getX(c) - pos.getX(a), pos.getY(c) - pos.getY(a), pos.getZ(c) - pos.getZ(a)];
        const du1 = uv.getX(b) - uv.getX(a), dv1 = uv.getY(b) - uv.getY(a), du2 = uv.getX(c) - uv.getX(a), dv2 = uv.getY(c) - uv.getY(a);
        const det = du1 * dv2 - du2 * dv1;
        if (!Number.isFinite(det) || Math.abs(det) < 1e-12) continue;
        const T = [0, 1, 2].map(k => (e1[k] * dv2 - e2[k] * dv1) / det), B = [0, 1, 2].map(k => (e2[k] * du1 - e1[k] * du2) / det);
        const lt = Math.hypot(T[0], T[1], T[2]), lb = Math.hypot(B[0], B[1], B[2]);
        if (!Number.isFinite(lt) || !Number.isFinite(lb) || lt <= 0 || lb <= 0) continue;
        su += lt; sv += lb; n++;
    }
    let out = [1, 1];
    if (n) {
        const ratio = (su / n) / (sv / n);               // surface per U unit ÷ surface per V unit
        const tiles = (r) => Math.max(1, Math.min(16, Math.round(r)));
        out = ratio >= 1 ? [tiles(ratio), 1] : [1, tiles(1 / ratio)];
    }
    geom.userData = { ...(geom.userData || {}), woodRepeat: out };
    return out;
};
const isWoodFinish = (f) => {
    if (!f) return false;
    const mats = String(f.material || f.materials || '').toUpperCase();
    if (/WOOD/.test(mats)) return true;
    if (mats && !/MIXED/.test(mats) && !/WOOD/.test(mats)) return false;        // tagged, and not wood
    const words = [f.name, f.description, f.finishName, f.label].map(v => String(v || '')).join(' ');
    return /oak|walnut|maple|cherry|mahogany|\bwood|stain(ed)?\b/i.test(words) || !!String(f.bomSuffix || '').trim();
};

const resolvePbr = (f, fallback) => {
    // Explicit per-finish override wins (optional `pbr: {metalness, roughness}` on the
    // master-finish entry — honored here whenever the finishes editor grows the fields).
    if (f && f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number') {
        return { metalness: f.pbr.metalness, roughness: f.pbr.roughness };
    }
    if (isWoodFinish(f)) return WOOD_PBR;
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
let pbrLoadedAt = 0;
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
                    map[f.textureUrl] = (explicit || base.wood) ? base : trimPainted(base);   // wood is not a paint coat
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
            pbrLoadedAt = Date.now();
        })();
    }
    return pbrLoadPromise;
};

// Sync lookup at material-apply time (call ensureFinishPbr() first; unknown URLs
// — customer-supplied assets etc. — get the generic metal default).
export const pbrForTexture = (url) => {
    // A texture uploaded AFTER this session loaded the registry (a stain swatch added in 4.5 a minute
    // ago) is unknown here and would render as the generic metal until a reload. An unknown URL asks
    // for a fresh registry — at most every 30 s — so the next material pass has it.
    if (url && pbrByUrl && !pbrByUrl[url] && Date.now() - pbrLoadedAt > 30000) { pbrLoadedAt = Date.now(); pbrLoadPromise = null; ensureFinishPbr(); }
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
