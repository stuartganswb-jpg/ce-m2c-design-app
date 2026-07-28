// Ported CPQ render engine — a faithful copy of the internal DynamicModel + StudioRig so the portal
// renders identically to HQ. Pure three.js; no Firestore. The per-finish PBR registry (metal vs
// paint vs wood light response) is built from the finish list the BFF sends, using the SAME static
// rules as src/components/Shared/studioScene.js so material response matches exactly.
import React, { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF, Environment, ContactShadows, Lightformer } from '@react-three/drei';
import * as THREE from 'three';

const DRACO_URL = 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/';

// Camera fit over the VISIBLE geometry only (Stuart 2026-07-27: "still zoomed way out… a split
// crops the rotated pole"). The master GLB carries EVERY option's meshes with visibility toggles,
// and drei's <Bounds> measures hidden meshes too — so it framed the whole invisible option cloud
// (model tiny) and its `clip` pinned near/far to that box (the diagonal crop). This walks only
// visible nodes, frames their box, and sets generous clip planes. Suspends on the SAME cached GLB
// as DynamicModel so it runs exactly when the model is live; `trigger` refits on selection /
// diameter changes.
export function FitToVisible({ url, trigger, margin = 1.25, targetName = 'fit-target' }) {
  useGLTF(url, DRACO_URL);
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const controls = useThree((s) => s.controls);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        scene.updateWorldMatrix(true, true);
        // Fit ONLY the named model group — walking the whole scene would include the studio
        // rig (the ContactShadows floor plane dwarfs the product and threw the camera out to
        // frame the floor: "the rendering area does not display anything").
        const root = scene.getObjectByName(targetName) || scene;
        const box = new THREE.Box3();
        const tmp = new THREE.Box3();
        const walk = (o) => {
          if (o.visible === false) return; // an invisible parent hides the whole subtree
          if (o.isMesh && o.geometry) {
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            if (o.geometry.boundingBox) { tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
          }
          for (const c of o.children) walk(c);
        };
        walk(root);
        if (box.isEmpty()) return;
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const fov = ((camera.fov || 50) * Math.PI) / 180;
        const dist = (maxDim / (2 * Math.tan(fov / 2))) * margin;
        const dir = new THREE.Vector3(1, 0.45, 1).normalize();
        camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
        camera.near = Math.max(dist / 500, 0.01);
        camera.far = dist * 500;
        camera.updateProjectionMatrix();
        if (controls) { controls.target.copy(center); controls.update(); } else camera.lookAt(center);
      } catch (e) { /* viewer torn down mid-fit */ }
    }, 120);
    return () => clearTimeout(t);
  }, [url, trigger, camera, scene, controls, targetName]);
  return null;
}

// ---- PBR registry (copied verbatim from studioScene.js) -------------------------------------
const DEFAULT_ENVMAP_INTENSITY = 1.25;
const PAINTED_TRIM = { metalnessMax: 0.8, roughnessMin: 0.36, envMapIntensity: 0.95 };
const trimPainted = (p) => ({
  metalness: Math.min(p.metalness, PAINTED_TRIM.metalnessMax),
  roughness: Math.max(p.roughness, PAINTED_TRIM.roughnessMin),
  envMapIntensity: PAINTED_TRIM.envMapIntensity,
});
const CODE_PBR = {
  SS: { metalness: 1.0, roughness: 0.30 }, WS: { metalness: 1.0, roughness: 0.32 },
  CG: { metalness: 1.0, roughness: 0.30 }, PG: { metalness: 1.0, roughness: 0.28 },
  WB: { metalness: 1.0, roughness: 0.32 }, GB: { metalness: 1.0, roughness: 0.42 },
  OB: { metalness: 1.0, roughness: 0.52 }, MB: { metalness: 0.0, roughness: 0.55 },
};
const NAME_PBR = [
  { rx: /oak|walnut|wood|stain(ed)?\b/i, pbr: { metalness: 0.0, roughness: 0.60 } },
  { rx: /acrylic|lucite|\bclear\b/i, pbr: { metalness: 0.0, roughness: 0.12 } },
  { rx: /matte|flat\b|powder|paint|primer|lacquer/i, pbr: { metalness: 0.10, roughness: 0.52 } },
  { rx: /polish|chrome|mirror|bright/i, pbr: { metalness: 1.0, roughness: 0.20 } },
  { rx: /brush|satin|antique|bronze|brass|gold|silver|nickel|pewter|gunmetal|copper|steel|iron/i, pbr: { metalness: 1.0, roughness: 0.34 } },
];
const DEFAULT_PBR = { metalness: 0.9, roughness: 0.38 };
const DEFAULT_PLATED_PBR = { metalness: 1.0, roughness: 0.25 };

const resolvePbr = (f, fallback) => {
  if (f && f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number') {
    return { metalness: f.pbr.metalness, roughness: f.pbr.roughness };
  }
  const code = String((f && f.code) || '').trim().toUpperCase();
  if (CODE_PBR[code]) return CODE_PBR[code];
  const hit = NAME_PBR.find((n) => n.rx.test(String((f && f.name) || '')));
  return hit ? hit.pbr : fallback;
};

// Build textureUrl -> pbr from the finishes the BFF supplied (in-house painted get the trim,
// outsourced plated do not — same split as studioScene).
export function buildPbrRegistry(finishes) {
  const map = {};
  (finishes || []).forEach((f) => {
    if (!f || !f.textureUrl) return;
    const explicit = f.pbr && typeof f.pbr.metalness === 'number' && typeof f.pbr.roughness === 'number';
    const base = resolvePbr(f, f.outsourced ? DEFAULT_PLATED_PBR : DEFAULT_PBR);
    map[f.textureUrl] = (explicit || f.outsourced) ? base : trimPainted(base);
  });
  return map;
}
const pbrForTexture = (registry, url) => ({ envMapIntensity: DEFAULT_ENVMAP_INTENSITY, ...((registry && registry[url]) || DEFAULT_PBR) });

const globalTextureCache = {};

// ---- DynamicModel (ported from CPQTab.js:125-350) -------------------------------------------
export function DynamicModel({ url, textureOverrides, visibilityOverrides, cloneSpecs, pbrRegistry }) {
  const { scene } = useGLTF(url, DRACO_URL);
  const clonedScene = useMemo(() => scene.clone(true), [scene]);

  const texStr = JSON.stringify(textureOverrides);
  const visStr = JSON.stringify(visibilityOverrides);
  const cloneStr = JSON.stringify(cloneSpecs);

  useEffect(() => {
    clonedScene.traverse((child) => {
      if (child.isMesh && child.userData.originalMaterial === undefined) {
        const orig = child.material.clone();
        if (orig.transparent && (orig.opacity === undefined || orig.opacity >= 1) && !orig.alphaMap) {
          orig.transparent = false; orig.depthWrite = true; orig.needsUpdate = true;
        }
        child.userData.originalMaterial = orig;
        child.userData.originalVisible = child.visible;
      }
    });

    const texMap = {};

    const applyAllOverrides = () => {
      const FASTENER_RX = /screw|bolt|washer|fastener|rivet|\bnut\b/i;
      const isFastener = (node) => { let n = node; while (n) { if (n.name && FASTENER_RX.test(n.name)) return true; n = n.parent; } return false; };
      // 🧊 Two-part acrylic finials (ported from CPQTab): acrylic parts never take the finish —
      // fixed clear material; the metal collar cluster still follows the finish.
      const ACRYLIC_CODE_RX = /(ACBF|138ABF|138AFBF|138APF|138AJF|138FBF|138PF|138FJF|HTAJCBA|HTAJF|HCUAP|HRBASQ)/i;
      const isAcrylicKeep = (node) => { let n = node; while (n) { const nm = n.name || ''; if ((/ACRYLIC/i.test(nm) && !/COLLAR|AFC/i.test(nm)) || ACRYLIC_CODE_RX.test(nm)) return true; n = n.parent; } return false; };
      clonedScene.traverse((child) => {
        if (!(child.isMesh && child.userData.originalMaterial && typeof child.userData.originalMaterial.clone === 'function')) return;
        if (isFastener(child)) { child.visible = false; return; }
        const nameHit = (nm, t) => nm.toLowerCase() === t;
        const hitTarget = (t) => { let n = child; while (n) { if (n.name && nameHit(n.name, t)) return true; n = n.parent; } return false; };

        let isVis = child.userData.originalVisible;
        if (visibilityOverrides && Object.keys(visibilityOverrides).length > 0) {
          let anyShow = false, anyHide = false;
          for (const [targetStr, isVisibleFlag] of Object.entries(visibilityOverrides)) {
            const targets = targetStr.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
            if (targets.some(hitTarget)) { if (isVisibleFlag) anyShow = true; else anyHide = true; }
          }
          if (anyShow) isVis = true; else if (anyHide) isVis = false;
        }
        child.visible = isVis;

        let matchedTexUrl = null;
        if (textureOverrides && Object.keys(textureOverrides).length > 0) {
          for (const [targetStr, texUrl] of Object.entries(textureOverrides)) {
            const targets = targetStr.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
            if (targets.some(hitTarget)) matchedTexUrl = texUrl;
          }
        }

        // Acrylic fallback (ported from CPQTab): the AC chip override normally wins above; if
        // nothing matched, pin synthetic clear so acrylic never renders as raw steel.
        if (isAcrylicKeep(child) && !(matchedTexUrl && texMap[matchedTexUrl])) {
          const mat = child.userData.originalMaterial.clone();
          mat.map = null;
          mat.color = new THREE.Color(0xe4edf2);
          mat.transparent = true; mat.opacity = 0.45;
          if (mat.isMeshStandardMaterial) { mat.metalness = 0; mat.roughness = 0.08; }
          mat.envMapIntensity = 1.15;
          mat.needsUpdate = true;
          child.material = mat;
          return;
        }

        if (matchedTexUrl && texMap[matchedTexUrl]) {
          const newMat = child.userData.originalMaterial.clone();
          newMat.map = texMap[matchedTexUrl];
          newMat.color = new THREE.Color(0xffffff);
          const pbr = pbrForTexture(pbrRegistry, matchedTexUrl);
          if (newMat.isMeshStandardMaterial) { newMat.metalness = pbr.metalness; newMat.roughness = pbr.roughness; }
          newMat.envMapIntensity = pbr.envMapIntensity;
          newMat.needsUpdate = true;
          child.material = newMat;
        } else {
          child.material = child.userData.originalMaterial;
        }
      });

      // Center-bracket cloning (ported from CPQTab.js:232-297).
      try {
        const prior = clonedScene.getObjectByName('__centerClones');
        if (prior) clonedScene.remove(prior);
        const specs = (cloneSpecs || []).filter((s) => s && (parseInt(s.count) || 0) >= 1 && (s.meshNames || []).length);
        if (specs.length) {
          clonedScene.updateMatrixWorld(true);
          const modelBox = new THREE.Box3().setFromObject(clonedScene);
          const size = modelBox.getSize(new THREE.Vector3());
          const axis = size.x >= size.y && size.x >= size.z ? 'x' : (size.y >= size.z ? 'y' : 'z');
          const defLo = modelBox.min[axis], defHi = modelBox.max[axis];
          const invRoot = new THREE.Matrix4().copy(clonedScene.matrixWorld).invert();
          const group = new THREE.Group(); group.name = '__centerClones';
          specs.forEach((spec) => {
            const n = parseInt(spec.count) || 0;
            const norm = (s) => String(s).trim().toLowerCase();
            const hitter = (names) => { const set = new Set((names || []).map(norm)); return (mesh) => { let nd = mesh; while (nd) { if (nd.name && set.has(nd.name.toLowerCase())) return true; nd = nd.parent; } return false; }; };
            const anchorHit = hitter(spec.anchorNames);
            const railHit = hitter(spec.railNames);
            const wantedHit = hitter(spec.meshNames);
            const src = [];
            clonedScene.traverse((c) => { if (c.isMesh && !isFastener(c) && wantedHit(c)) src.push(c); });
            if (!src.length) return;
            const anchorSrc = (spec.anchorNames || []).length ? src.filter(anchorHit) : src;
            const srcBox = new THREE.Box3(); (anchorSrc.length ? anchorSrc : src).forEach((m) => srcBox.expandByObject(m));
            const srcAlong = srcBox.getCenter(new THREE.Vector3())[axis];
            let lo = defLo, hi = defHi;
            if ((spec.railNames || []).length) {
              const railBox = new THREE.Box3(); let railFound = false;
              clonedScene.traverse((c) => { if (c.isMesh && !isFastener(c) && railHit(c)) { railBox.expandByObject(c); railFound = true; } });
              if (railFound) { lo = railBox.min[axis]; hi = railBox.max[axis]; }
            }
            src.forEach((m) => { m.visible = false; });
            for (let i = 1; i <= n; i++) {
              const targetAlong = lo + (hi - lo) * (i / (n + 1));
              const delta = targetAlong - srcAlong;
              const offset = new THREE.Matrix4().makeTranslation(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, axis === 'z' ? delta : 0);
              src.forEach((m) => {
                const c = m.clone();
                c.visible = true; c.matrixAutoUpdate = false;
                c.matrix.copy(invRoot).multiply(offset).multiply(m.matrixWorld);
                c.userData.originalMaterial = m.userData.originalMaterial;
                c.userData.originalVisible = true;
                group.add(c);
              });
            }
          });
          if (group.children.length) clonedScene.add(group);
        }
      } catch (e) { /* clone skipped */ }
    };

    const uniqueUrls = [...new Set(Object.values(textureOverrides || {}))].filter(Boolean);
    if (uniqueUrls.length === 0) { applyAllOverrides(); return; }
    let loadedCount = 0;
    const done = () => { loadedCount++; if (loadedCount === uniqueUrls.length) applyAllOverrides(); };
    uniqueUrls.forEach((u) => {
      if (globalTextureCache[u]) { texMap[u] = globalTextureCache[u]; done(); return; }
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      loader.load(u, (tex) => {
        tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
        globalTextureCache[u] = tex; texMap[u] = tex; done();
      }, undefined, () => done());
    });
  }, [clonedScene, texStr, visStr, cloneStr]); // eslint-disable-line react-hooks/exhaustive-deps

  return <primitive object={clonedScene} />;
}

// StudioRig (copied verbatim from studioScene.js).
export function StudioRig({ shadowY = -0.5 }) {
  return (
    <>
      <Environment resolution={512} environmentIntensity={1.15}>
        <Lightformer form="rect" intensity={4.0} position={[-3.2, 3.4, 4.2]} target={[0, 0, 0]} scale={[5.5, 3.2, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[4.2, 2.2, -3.6]} target={[0, 0, 0]} scale={[4.5, 2.6, 1]} />
        <Lightformer form="rect" intensity={2.0} position={[0, 5.2, 0]} target={[0, 0, 0]} scale={[7, 1.6, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#f4efe6" position={[0, -4.5, 0]} target={[0, 0, 0]} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={0.55} color="#eef0f4" position={[0, 1.2, -6]} target={[0, 0, 0]} scale={[10, 5, 1]} />
      </Environment>
      <ambientLight intensity={0.15} />
      <ContactShadows position={[0, shadowY, 0]} opacity={0.42} scale={10} blur={2.4} far={4} />
    </>
  );
}
