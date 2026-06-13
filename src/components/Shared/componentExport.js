// componentExport.js — isolate one BOM component out of a master .glb, lay it FLAT, and
// emit (1) a standalone binary .glb and (2) a transparent PNG thumbnail. Used at node
// association (Visual Assembly) so each BOM component gets an auto-generated item image
// instead of a manual screenshot, AND a reusable per-component .glb the Packaging tab can
// trace into a foam-cutting profile. "Flat" = thinnest axis aligned to Y, which is the axis
// the Packaging silhouette tracer projects along (camera looks straight down Y), so the
// top-down trace is the part's largest face.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';

// Match the CPQ 3D matcher: compare a sanitized alphanumeric key so RAW glb mesh names
// ("Body1.048") match the SANITIZED names stored on clusters/pins ("Body1048").
const sanitize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export async function loadGLBScene(url) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_URL);
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

// Collect every mesh that belongs to this cluster (matched directly by name, or descending
// from a matched parent node) and clone it with its WORLD transform BAKED into the geometry —
// the master glb nests scale (~0.0254 / 0.3937), so baking gives a correct standalone part.
export function isolateCluster(scene, nodeNames) {
  const want = new Set((nodeNames || []).map(sanitize));
  scene.updateMatrixWorld(true);
  const matched = new Set();
  scene.traverse(o => { if (want.has(sanitize(o.name))) matched.add(o); });
  const underMatched = (o) => { for (let p = o; p; p = p.parent) if (matched.has(p)) return true; return false; };

  const group = new THREE.Group();
  scene.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    if (!(matched.has(o) || underMatched(o))) return;
    const geom = o.geometry.clone();
    geom.applyMatrix4(o.matrixWorld);
    const mat = Array.isArray(o.material) ? o.material.map(m => m.clone()) : (o.material ? o.material.clone() : new THREE.MeshStandardMaterial());
    group.add(new THREE.Mesh(geom, mat));
  });
  return group;
}

// Lay the part flat: rotate its thinnest bounding-box axis onto Y, then recenter at origin.
export function layFlat(group) {
  group.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return group;
  const size = box.getSize(new THREE.Vector3());
  const thin = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1])[0][0];
  if (thin === 'x') group.rotation.z = Math.PI / 2;       // x -> y
  else if (thin === 'z') group.rotation.x = -Math.PI / 2; // z -> y
  group.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(group);
  group.position.sub(box.getCenter(new THREE.Vector3()));
  group.updateMatrixWorld(true);
  return group;
}

// Export an Object3D as a binary .glb Blob.
export function exportGLB(object) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      object,
      (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
      (err) => reject(err || new Error('GLTF export failed')),
      { binary: true }
    );
  });
}

// Render a clean 3/4 thumbnail of the (flat-oriented) part on a transparent background.
// Uses a neutral metal material so the image doesn't inherit Fusion's BLEND/see-through steel
// (finish is applied later in CPQ anyway).
export function snapshotPNG(object, size = 512) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(1, 2, 1.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4); fill.position.set(-1, 0.5, -1); scene.add(fill);

  const obj = object.clone(true);
  obj.traverse(o => { if (o.isMesh) o.material = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, metalness: 0.55, roughness: 0.45 }); });
  scene.add(obj);
  obj.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0.001);
  const cam = new THREE.PerspectiveCamera(35, 1, maxDim / 100, maxDim * 100);
  cam.position.set(center.x + maxDim * 1.4, center.y + maxDim * 1.7, center.z + maxDim * 1.9);
  cam.lookAt(center);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, cam);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      // Release the GL context eagerly — generating a whole assembly creates many offscreen
      // renderers, and browsers cap simultaneous WebGL contexts (~16).
      renderer.forceContextLoss();
      renderer.dispose();
      blob ? resolve(blob) : reject(new Error('PNG snapshot failed'));
    }, 'image/png');
  });
}

// Measure a flat-laid group's true dimensions in inches (the master .glb is in meters). The
// part lies flat with its thin axis on Y, so width/height are the X/Z face extents (matching
// the Packaging top-down trace) and thickness is the Y extent.
const IN_PER_M = 39.3701;
export function measureInches(group) {
  const s = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  return {
    width: +(s.x * IN_PER_M).toFixed(3),
    height: +(s.z * IN_PER_M).toFixed(3),
    thickness: +(s.y * IN_PER_M).toFixed(3),
  };
}

// One component, end to end: returns { glbBlob, pngBlob, dims } laid flat. Returns null if the
// cluster matched no geometry in this glb (e.g. a BOM-only part with no mesh).
export async function buildComponentFiles(scene, nodeNames) {
  const group = isolateCluster(scene, nodeNames);
  if (group.children.length === 0) return null;
  layFlat(group);
  const dims = measureInches(group);
  const [glbBlob, pngBlob] = await Promise.all([exportGLB(group), snapshotPNG(group)]);
  return { glbBlob, pngBlob, dims };
}
