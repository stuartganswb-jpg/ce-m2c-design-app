// ─────────────────────────────────────────────────────────────────────────────────────────────
// STEP REVIEW (Stuart 2026-09-08: "i just want to be able to open, review, see and look at
// them … put the viewer on tab 1 so i can see them and save them there").
//
// A STEP file is exact solid geometry (B-rep), which three.js cannot read. The reader is
// OpenCascade compiled to WebAssembly — occt-import-js 0.0.23 (LGPL-2.1) — vendored under
// public/occt/ and loaded as a plain script the FIRST time a .stp is dropped, never bundled
// (7.6 MB of wasm nobody else should pay for). It tessellates the solids and hands back named
// meshes with positions, normals and indices, which is exactly what the Fusion .fbx importer
// hands the rest of the pipeline — so the GLB this makes is the house GLB: inches, the
// PRODUCTION convention the master models use (Shared/fusionImport.js).
//
// Proven on the two 0903 motor-mount halves in node before it was looked at on a screen
// (scripts/stepImport.test.mjs: 3.6k / 3.0k triangles, 2.27 × 5.60 × 0.71 in, half a second).
// The pure parts below are node-tested; the browser parts (script loading, GLB export) run only
// in the tab.
// ─────────────────────────────────────────────────────────────────────────────────────────────

const OCCT_DIR = '/occt/';
const OCCT_SCRIPT = `${OCCT_DIR}occt-import-js.js`;

/** Tessellation asked of OpenCascade: geometry in INCHES, fine enough to review a bracket. */
export const READ_PARAMS = { linearUnit: 'inch', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 };

export const isStepFile = (name) => /\.(stp|step)$/i.test(String(name || '').trim());

/**
 * The designer's file name carries the code: "MO-26001-01, Curtain Motor Mount, Top Half.stp"
 * → code MO-26001-01, description "Curtain Motor Mount, Top Half". The STEP itself usually
 * carries no name inside (Fusion writes "Document"), so the file name is the only identity.
 */
export function codeFromFileName(name) {
    const base = String(name || '').replace(/\.(stp|step)$/i, '').trim();
    const [head, ...rest] = base.split(',');
    const code = String(head || '').trim().split(/\s+/)[0] || '';
    return { code: code.toUpperCase(), description: rest.map(s => s.trim()).filter(Boolean).join(', ') };
}

/**
 * What unit the FILE declares — informational: the reader converts to inches itself, this is
 * so the panel can say "file says centimetres" next to the inch dimensions.
 * SI_UNIT(.CENTI.,.METRE.) → cm · SI_UNIT(.MILLI.,.METRE.) → mm · SI_UNIT($,.METRE.) → m ·
 * CONVERSION_BASED_UNIT('INCH' … → in.
 */
export function stepUnitOf(headerText) {
    const t = String(headerText || '');
    if (/CONVERSION_BASED_UNIT\s*\(\s*'INCH'/i.test(t)) return 'in';
    const m = t.match(/SI_UNIT\s*\(\s*(\$|\.MILLI\.|\.CENTI\.)\s*,\s*\.METRE\.\s*\)/i);
    if (!m) return '';
    return m[1] === '$' ? 'm' : /MILLI/i.test(m[1]) ? 'mm' : 'cm';
}

/** One occt mesh → plain typed arrays + its bounding size (in the reader's unit, inches). Pure. */
export function meshToArrays(mesh) {
    const pos = mesh && mesh.attributes && mesh.attributes.position && mesh.attributes.position.array;
    if (!pos || !pos.length) return null;
    const position = Float32Array.from(pos);
    const nrm = mesh.attributes.normal && mesh.attributes.normal.array;
    const normal = nrm && nrm.length === pos.length ? Float32Array.from(nrm) : null;
    const idx = mesh.index && mesh.index.array;
    const index = idx && idx.length ? Uint32Array.from(idx) : null;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < position.length; i += 3) {
        for (let a = 0; a < 3; a++) { const v = position[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
    }
    const tris = index ? index.length / 3 : position.length / 9;
    return { name: String((mesh && mesh.name) || ''), position, normal, index, tris, min, max, size: max.map((v, a) => v - min[a]) };
}

/** Every mesh of a read result, and the whole model's size. Pure. */
export function summarize(result) {
    const meshes = ((result && result.meshes) || []).map(meshToArrays).filter(Boolean);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    meshes.forEach(m => { for (let a = 0; a < 3; a++) { if (m.min[a] < min[a]) min[a] = m.min[a]; if (m.max[a] > max[a]) max[a] = m.max[a]; } });
    const size = meshes.length ? max.map((v, a) => v - min[a]) : [0, 0, 0];
    return { meshes, count: meshes.length, tris: meshes.reduce((s, m) => s + m.tris, 0), size };
}

// ── browser side ─────────────────────────────────────────────────────────────────────────────

let occtPromise = null;
/** Load the vendored reader once (script tag → global `occtimportjs`) and initialise its wasm. */
export function loadOcct() {
    if (occtPromise) return occtPromise;
    occtPromise = new Promise((resolve, reject) => {
        const init = () => {
            const factory = typeof window !== 'undefined' && window.occtimportjs;
            if (typeof factory !== 'function') { reject(new Error('The STEP reader did not load (public/occt/occt-import-js.js).')); return; }
            factory({ locateFile: (p) => OCCT_DIR + p }).then(resolve, reject);
        };
        if (typeof window !== 'undefined' && typeof window.occtimportjs === 'function') { init(); return; }
        const s = document.createElement('script');
        s.src = OCCT_SCRIPT; s.async = true;
        s.onload = init;
        s.onerror = () => reject(new Error(`Could not fetch ${OCCT_SCRIPT}`));
        document.head.appendChild(s);
    }).catch(e => { occtPromise = null; throw e; });
    return occtPromise;
}

/** Read a STEP buffer → the reader's result ({ success, root, meshes }), geometry in inches. */
export async function readStep(buffer) {
    const occt = await loadOcct();
    const result = occt.ReadStepFile(new Uint8Array(buffer), READ_PARAMS);
    if (!result || !result.success) throw new Error('OpenCascade could not read this STEP file.');
    return result;
}

/**
 * STEP buffer → house .glb (binary, inches, one Group named for the part, one Mesh per solid,
 * the single carbon-steel material every imported model wears — the engine paints by finish).
 * Returns { glb: ArrayBuffer, summary }.
 */
export async function stepToGlb(buffer, { name = 'PART' } = {}) {
    const result = await readStep(buffer);
    const summary = summarize(result);
    if (!summary.count) throw new Error('The STEP file holds no solid geometry.');
    const THREE = await import('three');
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter');
    const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils');
    const material = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.85, roughness: 0.4 });
    material.name = 'Carbon Steel'; // the same material fusionImport gives every imported model — the engine recolors by finish
    const group = new THREE.Group();
    group.name = name;
    summary.meshes.forEach((m, i) => {
        let g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.position, 3));
        if (m.normal) g.setAttribute('normal', new THREE.BufferAttribute(m.normal, 3));
        if (m.index) g.setIndex(new THREE.BufferAttribute(m.index, 1));
        g = mergeVertices(g);
        if (!m.normal) g.computeVertexNormals();
        const mesh = new THREE.Mesh(g, material);
        mesh.name = `${name}__${i}${m.name && m.name !== 'Document' ? '_' + m.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) : ''}`;
        group.add(mesh);
    });
    const scene = new THREE.Scene();
    scene.add(group);
    const glb = await new Promise((res, rej) => new GLTFExporter().parse(scene, r => res(r), e => rej(e), { binary: true }));
    return { glb, summary };
}
