// fusionImport.js — in-app Fusion (.fbx) → house .glb converter (replaces the Blender pass).
//
// What the designer's Blender step did (measured from the Jul13 FBX/GLB pairs):
//   1. unit repair — Fusion exports FBX with UnitScaleFactor 2.54 (inches-as-cm); the hand-built
//      GLBs undo it with per-node scales (0.3937 / 0.01, inconsistently);
//   2. mesh consolidation — 16-68 Fusion bodies joined down to a handful of per-part meshes;
//   3. anchor renames — load-bearing meshes renamed to item-code + SIDE ("H1-75BE LEFT");
//   4. material collapse — everything to one neutral metal (the engine recolors by finish).
// This module does all four deterministically:
//   analyzeFusionFbx(buffer)  → { components, unitGuess, unitScaleFactor } — parsed, world-baked,
//                               grouped by top-level Fusion component, measured;
//   buildGlbFromAnalysis(...) → binary .glb ArrayBuffer with kept components merged (one mesh per
//                               component, position+normal only, single neutral material), geometry
//                               emitted in PRODUCTION units (inches — what the master GLBs render
//                               in) or SPEC units (true meters — what the 📐 spec tool measures).
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils';

// Fusion component names carry versioning noise — and FBXLoader sanitizes separators, so
// "H1-75BE v3:2" can arrive as "H1-75BE_v32". Strip from the version marker to the end.
export const cleanFusionName = (s) => String(s || '')
    .replace(/[\s_]v\d+.*$/i, '')
    .replace(/:\d+$/, '')
    .replace(/\.\d{3}$/, '')
    .replace(/_+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

// The FBX's declared unit factor (2.54 = file authored in inches, exported as cm). Read straight
// from the binary so the unit guess doesn't depend on which conversions FBXLoader applied.
export function readFbxUnitScaleFactor(buffer) {
    try {
        const bytes = new Uint8Array(buffer);
        const needle = 'UnitScaleFactor';
        outer: for (let i = 0; i < bytes.length - needle.length - 60; i++) {
            for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
            const view = new DataView(buffer);
            for (let k = i + needle.length; k < i + needle.length + 60 && k + 9 <= bytes.length; k++) {
                if (bytes[k] === 0x44 /* 'D' double marker */) {
                    const v = view.getFloat64(k + 1, true);
                    if (Number.isFinite(v) && Math.abs(v) > 0.0001 && Math.abs(v) < 10000) return v;
                }
            }
            return null;
        }
    } catch (e) { /* unreadable — caller falls back to measurement */ }
    return null;
}

// Unit hypotheses for the as-loaded geometry. Factors convert a loaded unit to inches / meters.
export const UNIT_CHOICES = [
    { id: 'cm', label: 'centimeters', toIn: 1 / 2.54, toM: 0.01 },
    { id: 'in', label: 'inches', toIn: 1, toM: 0.0254 },
    { id: 'mm', label: 'millimeters', toIn: 1 / 25.4, toM: 0.001 },
];

// Score a hypothesis by how plausible the OVERALL model reads in inches — drapery hardware
// components live roughly in the 0.2"–90" band. Higher = more plausible.
const plausibility = (dimsIn) => {
    const mx = Math.max(...dimsIn), mn = Math.min(...dimsIn.filter(d => d > 0.0001)) || 0;
    let s = 0;
    if (mx >= 0.5 && mx <= 90) s += 2; else if (mx > 0.05 && mx <= 400) s += 0.5;
    if (mn >= 0.02 && mn <= 40) s += 1;
    if (mx >= 1 && mx <= 60) s += 1; // the sweet spot for brackets/plates/finials
    return s;
};

export async function analyzeFusionFbx(buffer) {
    const unitScaleFactor = readFbxUnitScaleFactor(buffer);
    const root = new FBXLoader().parse(buffer, '');
    root.updateMatrixWorld(true);

    // Group meshes by their TOP-LEVEL Fusion component (direct child of the FBX root) — that's the
    // designer's own grouping in Fusion, and its name usually carries the item code.
    const components = [];
    const byTop = new Map();
    const topOf = (o) => { let p = o; while (p.parent && p.parent !== root) p = p.parent; return p; };
    root.traverse(o => {
        if (!o.isMesh || !o.geometry || !o.geometry.getAttribute('position')) return;
        const top = topOf(o);
        if (!byTop.has(top)) byTop.set(top, []);
        // Bake the world transform NOW (fold in whatever unit/axis handling the loader did),
        // keeping only position+normal — UVs/colors are dead weight (the engine paints by finish).
        // Vertex INDEXING is preserved (non-indexed soup tripled file sizes vs the hand-built GLBs).
        const g = o.geometry.clone();
        for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
        g.applyMatrix4(o.matrixWorld);
        byTop.get(top).push({ mesh: o, geo: g, name: o.name || '' });
    });

    let totalBox = new THREE.Box3();
    byTop.forEach((parts, top) => {
        const box = new THREE.Box3();
        parts.forEach(p => { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); });
        totalBox.union(box);
        const size = new THREE.Vector3(); box.getSize(size);
        const tris = parts.reduce((s, p) => s + (p.geo.index ? p.geo.index.count : p.geo.getAttribute('position').count) / 3, 0);
        components.push({
            key: top.uuid,
            origName: top.name || parts[0].name || 'Component',
            cleanName: cleanFusionName(top.name || parts[0].name || 'Component'),
            bodyNames: parts.map(p => p.name),
            bodies: parts.length,
            tris: Math.round(tris),
            size: [size.x, size.y, size.z],   // as-loaded units
            geos: parts.map(p => p.geo),
        });
    });
    components.sort((a, b) => b.tris - a.tris);

    // Rank the unit hypotheses by plausibility of the whole model; the FBX's own declared factor
    // breaks ties (2.54 → the loader's output is almost always centimeters).
    const totalSize = new THREE.Vector3(); totalBox.getSize(totalSize);
    // Empirical (three r184, Fusion FBX with UnitScaleFactor 2.54): the loader's output lands in
    // FILE units — inches — verified against the 4.625" projection arm reading 4.75 raw. So the
    // declared 2.54 factor is a strong hint toward the INCH hypothesis; plausibility of the whole
    // model's size breaks any remaining tie, and the modal shows live dims for a manual override.
    const ranked = UNIT_CHOICES.map(u => ({
        ...u,
        score: plausibility([totalSize.x * u.toIn, totalSize.y * u.toIn, totalSize.z * u.toIn]) + (unitScaleFactor === 2.54 && u.id === 'in' ? 1.5 : 0),
    })).sort((a, b) => b.score - a.score);

    return { components, unitGuess: ranked[0].id, unitRanking: ranked, unitScaleFactor };
}

// choices = [{ key, keep, finalName }] aligned to analysis.components by key.
// mode: 'PRODUCTION' (geometry in inches — the master-GLB render convention)
//     | 'SPEC'       (geometry in true meters — what the spec-sheet 📐 tool measures)
// unitId: which UNIT_CHOICES hypothesis the as-loaded geometry is in.
export async function buildGlbFromAnalysis(analysis, choices, { mode = 'PRODUCTION', unitId } = {}) {
    const unit = UNIT_CHOICES.find(u => u.id === (unitId || analysis.unitGuess)) || UNIT_CHOICES[0];
    const factor = mode === 'SPEC' ? unit.toM : unit.toIn;
    const scaleM = new THREE.Matrix4().makeScale(factor, factor, factor);

    const material = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.85, roughness: 0.4 });
    material.name = 'Carbon Steel'; // matches the designer's hand-built GLBs — the engine recolors by finish

    const scene = new THREE.Group();
    scene.name = 'FusionImport';
    const usedNames = new Set();
    for (const comp of analysis.components) {
        const choice = choices.find(c => c.key === comp.key);
        if (!choice || !choice.keep) continue;
        // mergeGeometries needs uniform indexing — de-index only when a component mixes both.
        const allIndexed = comp.geos.every(g => !!g.index);
        const list = comp.geos.map(g => (allIndexed || !g.index) ? g.clone() : g.clone().toNonIndexed());
        const uniform = allIndexed ? list : list.map(g => g.index ? g.toNonIndexed() : g);
        let merged = uniform.length === 1 ? uniform[0] : mergeGeometries(uniform, false);
        if (!merged) continue;
        // Fusion FBX arrives as pure triangle soup (no vertex sharing) — weld duplicates into an
        // indexed mesh (~3-4× smaller files). Hard edges survive: differing normals don't weld.
        try { merged = mergeVertices(merged, 1e-4); } catch (e) { /* weld is an optimization only */ }
        merged.applyMatrix4(scaleM);
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, material);
        let nm = String(choice.finalName || comp.cleanName || 'Part').trim() || 'Part';
        while (usedNames.has(nm)) nm = `${nm}_2`;
        usedNames.add(nm);
        mesh.name = nm;
        scene.add(mesh);
    }
    if (!scene.children.length) throw new Error('No components kept — nothing to export.');

    return await new Promise((res, rej) => new GLTFExporter().parse(scene, r => res(r), e => rej(e), { binary: true }));
}
