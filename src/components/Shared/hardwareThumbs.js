import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THUMBNAILS FROM THE ASSEMBLY'S OWN .GLB (Stuart 2026-08-17: "yes thumbnails render from the same
// file, as light as possible")
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// Every option in the configurator already owns a set of nodes. So a thumbnail is not a new asset
// to produce and maintain — it is that geometry, framed and photographed once. Nothing to upload,
// nothing to go stale when a designer re-exports, and a part that has no picture is a part with no
// geometry, which is a fact worth seeing rather than a missing file.
//
// "AS LIGHT AS POSSIBLE" IS THE WHOLE DESIGN, and after two render loops took a machine down this
// week it is worth being explicit about what keeps it cheap:
//
//   ONE renderer for the whole batch, created on demand and disposed at the end. WebGL contexts are
//     a hard, small limit in a browser; a renderer per thumbnail exhausts them and the tab dies.
//   ONE scene, loaded once per .glb. Options are photographed by toggling VISIBILITY, never by
//     cloning — a clone per option is a copy of the whole assembly per picture.
//   ONE FRAME each, at 128×96. No animation loop, no continuous rendering, nothing that survives
//     the call.
//   CACHED FOREVER by url+nodes, so the second visit to a step costs nothing at all.
//   YIELDED between frames, so a slot with twenty options never blocks the UI thread.
//
// The cost is therefore fixed and paid once per option, never per interaction — which is exactly
// the property the Doctor lacked when it became a tax on every click.

const CACHE = new Map();          // "url::nodes" → dataURL (or null when nothing rendered)
const SCENES = new Map();         // url → Promise<THREE.Group>
const W = 128, H = 96;

const keyOf = (url, nodes) => `${url}::${[...nodes].map(n => String(n).toLowerCase()).sort().join('|')}`;

function loadScene(url) {
    if (SCENES.has(url)) return SCENES.get(url);
    const p = new Promise((res, rej) => {
        const loader = new GLTFLoader();
        const draco = new DRACOLoader();
        draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
        loader.setDRACOLoader(draco);
        loader.load(url, (g) => res(g.scene), undefined, rej);
    });
    SCENES.set(url, p);
    return p;
}

// Does this mesh belong to the option? Same ancestry rule the renderer matches by, so a thumbnail
// shows exactly what selecting the option would show — not an approximation of it.
const belongs = (mesh, wanted) => {
    let n = mesh;
    while (n) { if (n.name && wanted.has(n.name.toLowerCase())) return true; n = n.parent; }
    return false;
};

const FASTENER_RX = /screw|bolt|washer|fastener|rivet|\bnut\b/i;

// ── ONE RENDERER, ONE QUEUE (2026-08-26, the Context-Lost storm) ─────────────────────────────
// The caller's effect used to re-fire while a batch was still running, and every invocation built
// its own WebGLRenderer: contexts exhausted, the browser started evicting them ("THREE.WebGL-
// Renderer: Context Lost" thirty times in seconds), the MAIN viewer went blank, and a thumbnail
// photographed on a dead context cached a blank image for the whole session — the "sometimes they
// render, sometimes they don't" bug. Now:
//   · batches run STRICTLY ONE AT A TIME through a module queue — concurrent calls append, never
//     race;
//   · ONE renderer is kept and reused across batches, released only after 5s idle — creation and
//     forced context loss stop being a per-batch event;
//   · a photograph is cached ONLY if the context is alive when it is taken — a lost context skips
//     the cache so the thumbnail is retried later instead of being blank forever.
let _renderer = null;
let _idleTimer = null;
const getRenderer = () => {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
    if (!_renderer) {
        const canvas = document.createElement('canvas');
        _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
        _renderer.setSize(W, H, false);
        _renderer.setPixelRatio(1);                // a thumbnail gains nothing from a retina buffer
    }
    return _renderer;
};
const releaseRendererSoon = () => {
    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => {
        if (_renderer) { _renderer.dispose(); _renderer.forceContextLoss?.(); _renderer = null; }
        _idleTimer = null;
    }, 5000);
};
let _queue = Promise.resolve();

/**
 * Photograph each group of nodes against a transparent background.
 *
 * @param url     the assembly's .glb
 * @param groups  [{ key, nodes: [name…] }]
 * @param onEach  (key, dataUrl) — called as each finishes, so the UI can fill in progressively
 */
export function renderThumbnails(url, groups, onEach) {
    // Anything already photographed is handed back immediately; only the rest costs anything.
    groups.forEach(g => {
        const k = keyOf(url, g.nodes || []);
        if (CACHE.has(k) && typeof onEach === 'function') onEach(g.key, CACHE.get(k));
    });
    const pending = groups.filter(g => g.nodes?.length && !CACHE.has(keyOf(url, g.nodes)));
    if (!url || !pending.length) return _queue;
    _queue = _queue
        .then(() => runBatch(url, pending, onEach))
        .catch(e => console.warn('Thumbnail batch failed:', e));
    return _queue;
}

async function runBatch(url, groups, onEach) {
    // A batch queued behind another may find its work already done — re-check before paying.
    const todo = groups.filter(g => !CACHE.has(keyOf(url, g.nodes)));
    if (!todo.length) return;
    try {
        const scene = await loadScene(url);
        let renderer = getRenderer();

        const stage = new THREE.Scene();
        stage.add(new THREE.AmbientLight(0xffffff, 2.1));
        const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(3, 5, 4); stage.add(key);
        const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-4, 1, -3); stage.add(fill);
        stage.add(scene);

        const meshes = [];
        scene.traverse(m => { if (m.isMesh) meshes.push(m); });
        const wasVisible = meshes.map(m => m.visible);
        const cam = new THREE.PerspectiveCamera(28, W / H, 0.01, 5000);

        for (const g of todo) {
            const wanted = new Set(g.nodes.map(n => String(n).toLowerCase()));
            let shown = 0;
            meshes.forEach(m => {
                const on = !FASTENER_RX.test(m.name || '') && belongs(m, wanted);
                m.visible = on;
                if (on) shown++;
            });
            let data = null;
            let contextDied = false;
            if (shown) {
                scene.updateMatrixWorld(true);
                const box = new THREE.Box3();
                meshes.forEach(m => { if (m.visible) box.expandByObject(m); });
                if (!box.isEmpty()) {
                    const size = box.getSize(new THREE.Vector3());
                    const centre = box.getCenter(new THREE.Vector3());
                    // Frame on the longest axis, from a three-quarter view — the angle a catalogue
                    // photograph uses, because a bracket seen square-on reads as a rectangle.
                    const radius = Math.max(size.length() / 2, 0.001);
                    const dist = radius / Math.sin((cam.fov * Math.PI) / 180 / 2) * 1.25;
                    cam.position.set(centre.x + dist * 0.55, centre.y + dist * 0.42, centre.z + dist * 0.72);
                    cam.lookAt(centre);
                    cam.updateProjectionMatrix();
                    // A dead context photographs BLANK — recreate once, and if it is still dead,
                    // leave this one uncached so a later visit retries it.
                    if (renderer.getContext().isContextLost()) {
                        renderer.dispose(); _renderer = null; renderer = getRenderer();
                    }
                    renderer.render(stage, cam);
                    if (renderer.getContext().isContextLost()) contextDied = true;
                    else data = renderer.domElement.toDataURL('image/png');
                }
            }
            if (!contextDied) {
                CACHE.set(keyOf(url, g.nodes), data);
                if (typeof onEach === 'function') onEach(g.key, data);
            }
            // Give the browser the thread back between frames. Twenty options in a slot must never
            // read as the tab having hung.
            await new Promise(r => setTimeout(r, 0));
        }

        meshes.forEach((m, i) => { m.visible = wasVisible[i]; });
        stage.remove(scene);
    } catch (e) {
        // A thumbnail is a convenience. Losing one must never cost the configurator.
        console.warn('Thumbnail render failed:', e);
    } finally {
        releaseRendererSoon();
    }
}

/** Already-photographed image for a node set, or undefined if it has not been rendered yet. */
export const cachedThumb = (url, nodes) => CACHE.get(keyOf(url, nodes || []));
