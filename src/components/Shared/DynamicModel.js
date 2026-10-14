import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { splitNodesLower } from './nodeList';
import { ensureFinishPbr, pbrForTexture, woodRepeatFor, ensureWoodUv } from './finishPbr';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE 3D DRAWING OF A CONFIGURED ROD — moved out of HQ/CPQTab.js word for word (2026-10-14, the portal
// rebuild, step 4 — Stuart: "yes go on A to D")
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// HQ's CPQ (both engines), Inception, View Item and the SOP viewer draw with this component, and from step 4
// so does the customer portal: ONE drawing, so the picture a customer configures is the picture HQ quotes.
// It sat inside CPQTab.js, which nothing outside HQ can load, so it moved here with its two caches and
// nothing else. CPQTab.js re-exports it, so every screen that imports it from there is unchanged. The
// finish table it reads moved to Shared/finishPbr.js for the same reason (said there).

const woodTexCache = {};   // `${url}|${ru}x${rv}` → a tiled clone of the swatch (wood only)
const globalTextureCache = {};

export const DynamicModel = ({ url, textureOverrides, visibilityOverrides, cloneSpecs, highlightOverrides, onVisAudit, onPaintAudit, onSceneNames, defaultHidden = false, clearNodes = null, stretchSpec = null, spliceMarks = [] }) => {
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    // WHAT THE .GLB ACTUALLY CONTAINS (2026-08-17). Every check until now compared the flow against
    // the assembly's stored CLUSTER RECORDS, which is a comparison of one record against another —
    // and H2-138 is exactly where that stops being enough: the records list the acrylic finial
    // nodes (so the tag-driven engine sees no problem) while the render finds no mesh by those
    // names. Only the loaded scene can settle which is right, so it now says so out loud, once per
    // model.
    useEffect(() => {
        if (typeof onSceneNames !== 'function') return;
        // MESHES are what render; GROUPS are scaffolding that draws nothing. Reporting one list
        // conflated them, and the visibility diff then counted every wrapper the old engine left
        // "visible" as a disagreement — 366 of 444 on H1-138, almost all of it groups that draw
        // no pixels. Records are matched against ALL names (clusters legitimately store the
        // wrapper); anything about RENDERING is matched against meshes only.
        const all = [], meshes = [];
        clonedScene.traverse(n => { if (!n.name) return; all.push(n.name); if (n.isMesh) meshes.push(n.name); });
        onSceneNames({ all, meshes });
    }, [clonedScene, onSceneNames]);

    const textureOverridesString = JSON.stringify(textureOverrides);
    const visibilityOverridesString = JSON.stringify(visibilityOverrides);
    const cloneSpecsString = JSON.stringify(cloneSpecs);
    const stretchSpecString = JSON.stringify(stretchSpec);
    const spliceMarksString = JSON.stringify(spliceMarks);
    const highlightOverridesString = JSON.stringify(highlightOverrides);

    useEffect(() => {
        clonedScene.traverse((child) => {
            if (child.isMesh && child.userData.originalMaterial === undefined) {
                const orig = child.material.clone();
                // Export artifact fix: a material flagged transparent (alphaMode BLEND) but
                // actually fully opaque (opacity 1, no alpha map) only breaks three.js depth
                // sorting — e.g. a steel ring rendering behind the pole instead of the pole
                // threading through it. Force it opaque so true geometry depth is used.
                if (orig.transparent && (orig.opacity === undefined || orig.opacity >= 1) && !orig.alphaMap) {
                    orig.transparent = false;
                    orig.depthWrite = true;
                    orig.needsUpdate = true;
                }
                child.userData.originalMaterial = orig;
                child.userData.originalVisible = child.visible;
            }
        });

        const texMap = {}; 

        const applyAllOverrides = () => {
            // RENDER-MAP AUDIT (Brimar 2026-08-09: "the new finials we just added do not render
            // while some of the older ones do"). A geometry-map node name that matches NOTHING in
            // the scene fails silently: the option selects, prices and BOMs — and controls no
            // geometry. Collect every visibility token that matched no mesh/ancestor during this
            // pass and report it (onVisAudit → the amber strip under the 3D pane), so a stale map
            // after a re-import/rename names itself instead of reading as "the part won't render".
            const visTokens = new Set();
            const hitTokens = new Set();
            // ── WHAT EACH DRAWN MESH ACTUALLY GOT (Stuart 2026-09-20) ────────────────────────────────
            // Three deploys of wood-material work produced "no visual change", and neither of us could
            // tell from a picture whether the wood branch ran, the finish never reached the mesh, or the
            // browser was on an old bundle. Every mesh leaves this traversal one of four ways; the panel
            // header says which, so the next answer is read rather than inferred. Counts only.
            const paint = { wood: 0, finish: 0, clear: 0, raw: 0 };
            Object.keys(visibilityOverrides || {}).forEach(k =>
                splitNodesLower(k).forEach(t => visTokens.add(t)));
            // Fasteners (screws/bolts/washers/nuts) are BOM-only — never rendered, here or as clones.
            // Match on the mesh OR any ancestor group name. \bnut\b is used so WALNUT isn't caught.
            const FASTENER_RX = /screw|bolt|washer|fastener|rivet|\bnut\b/i;
            const isFastener = (node) => { let n = node; while (n) { if (n.name && FASTENER_RX.test(n.name)) return true; n = n.parent; } return false; };
            // 🧊 Two-part acrylic finials: the metal COLLAR takes the chosen finish, the acrylic
            // part NEVER does — those meshes stay on a fixed clear material no matter what finish
            // is selected. Matched by cluster/ancestor name (ACRYLIC-… minus the COLLAR cluster,
            // whose item is …AFC) or the acrylic part/combined codes + raw Fusion node names from
            // the H2-138 program (H2/H2 138 Acrylic Finial sheet).
            // ACKF/ACGF (H1-138 acrylic knob/gem) + the acrylic ROD (138AR) and per-ft acrylic
            // (138ACR) joined 2026-08-16 — the H2-era list missed them, so they rendered painted.
            const ACRYLIC_CODE_RX = /(ACBF|138ABF|138AFBF|138APF|138AJF|138FBF|138PF|138FJF|HTAJCBA|HTAJF|HCUAP|HRBASQ|ACKF|ACGF|138AR\b|138ACR)/i;
            const isAcrylicKeep = (node) => { let n = node; while (n) { const nm = n.name || ''; if ((/ACRYLIC/i.test(nm) && !/COLLAR|AFC/i.test(nm)) || ACRYLIC_CODE_RX.test(nm)) return true; n = n.parent; } return false; };
            clonedScene.traverse((child) => {
                if (child.isMesh && child.userData.originalMaterial && typeof child.userData.originalMaterial.clone === 'function') {
                    if (isFastener(child)) { child.visible = false; return; }
                    // Match a node name EXACTLY (case-insensitive), then walk the mesh's ancestors —
                    // identical to Node Grouping's matcher (isDescendantOf). The earlier
                    // prefix/sanitized fallbacks were too loose: one cluster node would match its
                    // name-cousins, so picking one backplate lit up (and showed) every backplate.
                    // Exact + ancestry keeps render == exactly what you grouped.
                    const nameHit = (nm, t) => nm.toLowerCase() === t;
                    const hitTarget = (t) => { let n = child; while (n) { if (n.name && nameHit(n.name, t)) return true; n = n.parent; } return false; };

                    // ADDITIVE RENDERING (Stuart 2026-08-17: "i am fine with opening on ... totally
                    // blank screen and work purely additive, that is how the portal renders").
                    // defaultHidden inverts the base state: a mesh appears only when something
                    // SELECTED claims it. That is the whole ghost class gone — an unclaimed mesh
                    // cannot render, so it cannot pose as a part nobody chose — and it is what the
                    // tag engine already computes, since its visible set IS the union of the
                    // selected choices. The old default stays exactly as it was for the old path.
                    let isVis = defaultHidden ? false : child.userData.originalVisible;
                    if (visibilityOverrides && Object.keys(visibilityOverrides).length > 0) {
                        let anyShow = false, anyHide = false;
                        for (const [targetStr, isVisibleFlag] of Object.entries(visibilityOverrides)) {
                            const targets = splitNodesLower(targetStr);
                            let anyTok = false;
                            for (const t of targets) { if (hitTarget(t)) { anyTok = true; hitTokens.add(t); } }
                            if (anyTok) {
                                if (isVisibleFlag) anyShow = true; else anyHide = true;
                            }
                        }
                        // A mesh explicitly shown by ANY control wins over an incidental hide from
                        // another control's fuzzy/ancestry match — fixes a just-selected part not
                        // appearing until another change "triggers" a redraw. Deterministic
                        // (order-independent), unlike the previous last-match-wins.
                        if (anyShow) isVis = true;
                        else if (anyHide) isVis = false;
                    }
                    child.visible = isVis;

                    let matchedTexUrl = null;
                    if (textureOverrides && Object.keys(textureOverrides).length > 0) {
                        for (const [targetStr, texUrl] of Object.entries(textureOverrides)) {
                            const targets = splitNodesLower(targetStr);
                            if (targets.some(hitTarget)) {
                                matchedTexUrl = texUrl;
                            }
                        }
                    }

                    // 🧊 Acrylic fallback: normally the AC master-finish chip is routed onto these
                    // meshes by the textureOverrides builder (appended last, so it wins) and they
                    // take the AC texture through the standard path below. If NOTHING matched
                    // (AC chip missing / pre-AC flow), pin a synthetic clear so an acrylic part
                    // never renders as raw grey steel.
                    // 🧊 WHICH PARTS ARE CLEAR — BY TAG WHEN THE CALLER KNOWS (Stuart 2026-08-17).
                    // `clearNodes` is the tag-derived set from the hardware model: pass it and the
                    // item-code list below is not consulted at all, so a new acrylic finial is a
                    // tick in 1.6 rather than a code change. Callers that pass nothing (the old
                    // configurator) keep the legacy name matching exactly as it was.
                    const isClear = clearNodes
                        ? clearNodes.some(t => hitTarget(t))
                        : isAcrylicKeep(child);
                    if (isClear && !(matchedTexUrl && texMap[matchedTexUrl])) {
                        const mat = child.userData.originalMaterial.clone();
                        mat.map = null;
                        mat.color = new THREE.Color(0xe4edf2);
                        mat.transparent = true; mat.opacity = 0.45;
                        if (mat.isMeshStandardMaterial) { mat.metalness = 0; mat.roughness = 0.08; }
                        mat.envMapIntensity = 1.15;
                        mat.needsUpdate = true;
                        child.material = mat;
                        paint.clear++;
                        return;
                    }

                    if (matchedTexUrl && texMap[matchedTexUrl]) {
                        const newMat = child.userData.originalMaterial.clone();
                        newMat.map = texMap[matchedTexUrl];
                        newMat.color = new THREE.Color(0xffffff);
                        // Studio-render upgrade: the swatch map carries the TONE, but how the
                        // surface answers light (bare metal vs paint coat vs wood vs acrylic)
                        // comes from the finish's PBR entry — metal at rough 0.3 shows the
                        // softbox streak, matte black correctly loses the mirror hotspot.
                        const pbr = pbrForTexture(matchedTexUrl);
                        if (newMat.isMeshStandardMaterial) {
                            newMat.metalness = pbr.metalness;
                            newMat.roughness = pbr.roughness;
                            // 🌳 WOOD (Stuart 2026-09-20, Shared/studioScene): the swatch is also the
                            // grain's relief, so it catches the light instead of lying flat — and any
                            // metal-era maps the model's material carried are dropped with it.
                            if (pbr.wood) {
                                // FIRST: give the part UVs if the model brought none, or the swatch samples
                                // one texel and paints it flat (studioScene.ensureWoodUv — the real cause of
                                // "wood looks like smooth metal"). Generated UVs are already in inches, so
                                // the tiling below then measures 1×1 and leaves them alone.
                                ensureWoodUv(child.geometry);
                                // The grain tiled to THIS part's proportions (studioScene.woodRepeatFor) — a
                                // clone shares the image, so it costs a few bytes per distinct tiling.
                                const [ru, rv] = woodRepeatFor(child.geometry);
                                let woodTex = texMap[matchedTexUrl];
                                if (ru !== 1 || rv !== 1) {
                                    const key = `${matchedTexUrl}|${ru}x${rv}`;
                                    if (!woodTexCache[key]) { const t = texMap[matchedTexUrl].clone(); t.repeat.set(ru, rv); t.needsUpdate = true; woodTexCache[key] = t; }
                                    woodTex = woodTexCache[key];
                                }
                                newMat.map = woodTex;
                                newMat.bumpMap = woodTex;
                                newMat.bumpScale = pbr.bumpScale;
                                newMat.metalnessMap = null;
                                newMat.roughnessMap = null;
                                // …and lift the albedo: this studio is lit for metal (see WOOD_PBR).
                                if (pbr.albedo) newMat.color.setScalar(pbr.albedo);
                            }
                        }
                        newMat.envMapIntensity = pbr.envMapIntensity;
                        newMat.needsUpdate = true;
                        child.material = newMat;
                        if (pbr.wood) paint.wood++; else paint.finish++;
                    } else {
                        // No finish reached this mesh: it draws in the model's OWN material, which for
                        // every H1 assembly is "Carbon Steel" (metallic 0.85) — a dark metal whatever the
                        // customer picked. This is the count that matters when a part looks unfinished.
                        child.material = child.userData.originalMaterial;
                        paint.raw++;
                    }

                    // Debug option-highlight (Stage 0): glow the meshes the current step's
                    // selection controls, using the SAME ancestry matcher as render — so what
                    // glows is exactly what would show. Lets you confirm an option owns the
                    // right geometry. Targets are pre-lowercased by the caller.
                    if (highlightOverrides && highlightOverrides.length && highlightOverrides.some(hitTarget)) {
                        const hl = child.material.clone();
                        if (hl.emissive) { hl.emissive = new THREE.Color(0xb08d57); hl.emissiveIntensity = 0.9; }
                        else { hl.color = new THREE.Color(0xb08d57); }
                        hl.needsUpdate = true;
                        child.material = hl;
                    }
                }
            });

            // Report the audit: tokens the whole traversal never matched. Empty array = clean.
            if (typeof onVisAudit === 'function') {
                onVisAudit([...visTokens].filter(t => !hitTokens.has(t)).sort());
            }
            if (typeof onPaintAudit === 'function') onPaintAudit(paint);

            // --- Pole stretch (Stuart 2026-09-09) ------------------------------------------------------
            // "go back to no scale, then set a new stretch scale of only 20% length when the rod length is
            //  over 72", so it just stretches longer to one longer length no matter 72" or 144" … just
            //  stretch the rod/pole and traverse … only scale in the center area, the outer brackets
            //  rendering should stay towards the outer edge of the pole."
            // A drawing, not a measurement: an order over 72" draws the rail 20% longer than modelled
            // — one fixed step, enough room for five centre brackets — and the extra length is put into
            // the MIDDLE half of the rail only, so the ends of the pole (ferrules, threads, whatever the
            // model carries there) keep their shape and the end hardware rides out with them. Rail
            // meshes are re-shaped vertex by vertex from their untouched original geometry each pass;
            // everything else is moved by the same mapping of its centre. Model units do not matter:
            // the trigger is the ordered inches, the stretch is a ratio of the model's own length.
            try {
                clonedScene.traverse(c => { if (c.isMesh && !c.userData.originalMatrix) c.userData.originalMatrix = c.matrix.clone(); });
                clonedScene.traverse(c => {
                    if (!c.isMesh) return;
                    if (c.userData.stretched && c.userData.originalMatrix?.isMatrix4) { c.matrix.copy(c.userData.originalMatrix); c.userData.stretched = false; }
                    if (c.userData.originalGeometry && c.geometry !== c.userData.originalGeometry) { c.geometry = c.userData.originalGeometry; }
                });
                clonedScene.updateMatrixWorld(true);
                const inClones = (m) => { let nd = m; while (nd) { if (nd.name === '__centerClones' || nd.name === '__spliceMarks') return true; nd = nd.parent; } return false; };
                const wantIn = Number(stretchSpec?.lengthInches) || 0;
                const railList = Array.isArray(stretchSpec?.railNames) ? stretchSpec.railNames : [];
                const STRETCH_OVER_IN = 72;      // shorter orders draw as modelled
                const STRETCH_K = 1.4;           // longer orders draw the rail 40% longer, whatever the length (Stuart 2026-09-09: 20% read too subtle — "go 20% more")
                const BAND = 0.5;                // the middle half of the rail takes all of the extra
                if (wantIn > STRETCH_OVER_IN && railList.length) {
                    const railSet = new Set(railList.map(s => String(s).trim().toLowerCase()));
                    const onRail = (mesh) => { let nd = mesh; while (nd) { if (nd.name && railSet.has(nd.name.toLowerCase())) return true; nd = nd.parent; } return false; };
                    const railMeshes = []; clonedScene.traverse(c => { if (c.isMesh && c.visible && !isFastener(c) && !inClones(c) && onRail(c)) railMeshes.push(c); });
                    if (railMeshes.length) {
                        const rb = new THREE.Box3(); railMeshes.forEach(m => rb.expandByObject(m));
                        const sz = rb.getSize(new THREE.Vector3());
                        const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : (sz.y >= sz.z ? 'y' : 'z');
                        const modelLen = sz[ax];
                        // ANYTHING AS LONG AS THE RAIL IS RAIL — the F-clip strip and a companion mesh beside
                        // the track are rail-length and stretch with it, whatever they are called.
                        clonedScene.traverse(c => {
                            if (!c.isMesh || !c.visible || isFastener(c) || inClones(c) || railMeshes.includes(c)) return;
                            const ms = new THREE.Box3().setFromObject(c).getSize(new THREE.Vector3());
                            if (ms[ax] >= 0.8 * modelLen) railMeshes.push(c);
                        });
                        if (modelLen > 0) {
                            const c0 = rb.getCenter(new THREE.Vector3())[ax];
                            const delta = (STRETCH_K - 1) * modelLen;      // the extra length drawn
                            const half = (BAND * modelLen) / 2;             // half the band that takes it
                            // Along-axis mapping about the rail's centre: the band stretches, the ends slide.
                            const mapU = (u) => (Math.abs(u) <= half ? u * (1 + delta / (2 * half)) : u + Math.sign(u) * delta / 2);
                            const railMeshSet = new Set(railMeshes);
                            const v = new THREE.Vector3();
                            clonedScene.traverse(m => {
                                if (!m.isMesh || !m.visible || isFastener(m) || inClones(m) || !m.userData.originalMatrix?.isMatrix4) return;
                                if (railMeshSet.has(m)) {
                                    // Re-shape from the untouched original: to world, map along the axis, back.
                                    if (!m.userData.originalGeometry) m.userData.originalGeometry = m.geometry;
                                    const src = m.userData.originalGeometry;
                                    const g = src.clone();
                                    const pos = g.getAttribute('position');
                                    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
                                    for (let k = 0; k < pos.count; k++) {
                                        v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld);
                                        v[ax] = c0 + mapU(v[ax] - c0);
                                        v.applyMatrix4(inv);
                                        pos.setXYZ(k, v.x, v.y, v.z);
                                    }
                                    pos.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
                                    m.geometry = g;
                                } else {
                                    const mc = new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3())[ax];
                                    const d = mapU(mc - c0) - (mc - c0);
                                    if (Math.abs(d) > 1e-6) {
                                        const t = new THREE.Vector3(ax === 'x' ? d : 0, ax === 'y' ? d : 0, ax === 'z' ? d : 0);
                                        const parentInv = new THREE.Matrix4().copy(m.parent ? m.parent.matrixWorld : new THREE.Matrix4()).invert();
                                        m.matrix.copy(parentInv).multiply(new THREE.Matrix4().makeTranslation(t.x, t.y, t.z)).multiply(m.matrixWorld);
                                        m.matrixAutoUpdate = false; m.userData.stretched = true;
                                    }
                                }
                            });
                            clonedScene.updateMatrixWorld(true);
                        }
                    }
                }
            } catch (e) { console.warn('pole stretch skipped', e); }

            // --- Center-bracket cloning ---------------------------------------------------------
            // One source bracket sits at the middle of the pole; clone it N times (count from the
            // flow's "clone along pole" step qty) and space the copies evenly along the pole's long
            // axis. Fully graceful: if anything is missing it no-ops and the model renders as-is.
            try {
                const prior = clonedScene.getObjectByName('__centerClones');
                if (prior) clonedScene.remove(prior);
                const specs = (cloneSpecs || []).filter(s => s && (parseInt(s.count) || 0) >= 1 && (s.meshNames || []).length);
                if (specs.length) {
                    clonedScene.updateMatrixWorld(true);
                    const modelBox = new THREE.Box3().setFromObject(clonedScene);
                    const size = modelBox.getSize(new THREE.Vector3());
                    const axis = size.x >= size.y && size.x >= size.z ? 'x' : (size.y >= size.z ? 'y' : 'z');
                    const defLo = modelBox.min[axis], defHi = modelBox.max[axis];
                    const invRoot = new THREE.Matrix4().copy(clonedScene.matrixWorld).invert();
                    const group = new THREE.Group(); group.name = '__centerClones';
                    specs.forEach(spec => {
                        const n = parseInt(spec.count) || 0;
                        // Match meshes EXACTLY by name, walking ancestors — identical to the render
                        // matcher. The old sanitized+prefix matching over-reached, pulling in meshes
                        // scattered across the model, so the matched set's "center" sat off to one
                        // side and clones never truly centered.
                        const norm = (s) => String(s).trim().toLowerCase();
                        const hitter = (names) => { const set = new Set((names || []).map(norm)); return (mesh) => { let nd = mesh; while (nd) { if (nd.name && set.has(nd.name.toLowerCase())) return true; nd = nd.parent; } return false; }; };
                        const anchorHit = hitter(spec.anchorNames);
                        const railHit = hitter(spec.railNames);
                        const wantedHit = hitter(spec.meshNames);
                        const src = [];
                        clonedScene.traverse(c => { if (c.isMesh && !isFastener(c) && wantedHit(c)) src.push(c); });
                        if (!src.length) return;
                        // Anchor placement on the MAIN bracket meshes only (fall back to all src), so
                        // the bracket lands at the target spot no matter what's cloned alongside it.
                        const anchorSrc = (spec.anchorNames || []).length ? src.filter(anchorHit) : src;
                        const srcBox = new THREE.Box3(); (anchorSrc.length ? anchorSrc : src).forEach(m => srcBox.expandByObject(m));
                        const srcAlong = srcBox.getCenter(new THREE.Vector3())[axis];
                        // Rail extent = the pole's meshes unioned (full length even if segmented),
                        // falling back to the model box. This is the span clones are centered along.
                        let lo = defLo, hi = defHi;
                        if ((spec.railNames || []).length) {
                            const railBox = new THREE.Box3(); let railFound = false;
                            clonedScene.traverse(c => { if (c.isMesh && !isFastener(c) && railHit(c)) { railBox.expandByObject(c); railFound = true; } });
                            if (railFound) { lo = railBox.min[axis]; hi = railBox.max[axis]; }
                        }
                        src.forEach(m => { m.visible = false; }); // hide the single middle original; clones replace it
                        for (let i = 1; i <= n; i++) {
                            const targetAlong = lo + (hi - lo) * (i / (n + 1));
                            const delta = targetAlong - srcAlong;
                            const offset = new THREE.Matrix4().makeTranslation(axis === 'x' ? delta : 0, axis === 'y' ? delta : 0, axis === 'z' ? delta : 0);
                            src.forEach(m => {
                                const c = m.clone();
                                c.visible = true;
                                c.matrixAutoUpdate = false;
                                c.matrix.copy(invRoot).multiply(offset).multiply(m.matrixWorld);
                                // Object3D.clone() JSON-serializes userData, turning originalMaterial
                                // into a plain object (no .clone()). Restore the real Material refs so
                                // the next texture pass over these clones doesn't throw and lose the
                                // WebGL context (the "white-out" after a few choices).
                                c.userData.originalMaterial = m.userData.originalMaterial;
                                c.userData.originalVisible = true;
                                group.add(c);
                            });
                        }
                    });
                    if (group.children.length) clonedScene.add(group);
                }
            } catch (e) { console.warn('center-bracket clone skipped', e); }

            // --- Splice marks (Stuart 2026-09-09: "a nice clean pencil line, just thick enough to show
            // the pole is in two pieces") ------------------------------------------------------------
            // One thin dark band around the rail at each fraction along it, after the stretch and the
            // clones so it lands on the pole as drawn. Unlit, a hair proud of the pole, 0.06" long —
            // a line, not a part. Rebuilt every pass; nothing here is ever a scene node the flow owns.
            try {
                const priorMarks = clonedScene.getObjectByName('__spliceMarks');
                if (priorMarks) clonedScene.remove(priorMarks);
                const marks = (Array.isArray(spliceMarks) ? spliceMarks : []).map(m => Number(m && m.frac)).filter(f => Number.isFinite(f) && f > 0 && f < 1);
                const railList = Array.isArray(stretchSpec?.railNames) && stretchSpec.railNames.length ? stretchSpec.railNames
                    : (Array.isArray(cloneSpecs?.[0]?.railNames) ? cloneSpecs[0].railNames : []);
                if (marks.length && railList.length) {
                    clonedScene.updateMatrixWorld(true);
                    const railSet = new Set(railList.map(s => String(s).trim().toLowerCase()));
                    const onRail = (mesh) => { let nd = mesh; while (nd) { if (nd.name === '__centerClones' || nd.name === '__spliceMarks') return false; if (nd.name && railSet.has(nd.name.toLowerCase())) return true; nd = nd.parent; } return false; };
                    const rb = new THREE.Box3(); let any = false;
                    clonedScene.traverse(c => { if (c.isMesh && c.visible && !isFastener(c) && onRail(c)) { rb.expandByObject(c); any = true; } });
                    if (any) {
                        const sz = rb.getSize(new THREE.Vector3());
                        const ax = sz.x >= sz.y && sz.x >= sz.z ? 'x' : (sz.y >= sz.z ? 'y' : 'z');
                        const others = ['x', 'y', 'z'].filter(k => k !== ax);
                        const radius = 0.5 * Math.max(sz[others[0]], sz[others[1]]) * 1.04;
                        const centre = rb.getCenter(new THREE.Vector3());
                        const lo = rb.min[ax], hi = rb.max[ax];
                        const invRoot = new THREE.Matrix4().copy(clonedScene.matrixWorld).invert();
                        const grp = new THREE.Group(); grp.name = '__spliceMarks';
                        const geo = new THREE.CylinderGeometry(radius, radius, 0.06, 48);
                        const mat = new THREE.MeshBasicMaterial({ color: 0x1c1a16 });
                        marks.forEach(frac => {
                            const mesh = new THREE.Mesh(geo, mat);
                            const pos = centre.clone(); pos[ax] = lo + (hi - lo) * frac;
                            const q = new THREE.Quaternion();
                            if (ax === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
                            else if (ax === 'z') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
                            const world = new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1));
                            mesh.matrixAutoUpdate = false;
                            mesh.matrix.copy(invRoot).multiply(world);
                            mesh.userData.originalMaterial = mat; mesh.userData.originalVisible = true; mesh.userData.spliceMark = true;
                            grp.add(mesh);
                        });
                        clonedScene.add(grp);
                    }
                }
            } catch (e) { console.warn('splice marks skipped', e); }
        };

        if (!textureOverrides || Object.keys(textureOverrides).length === 0) {
            applyAllOverrides();
            return;
        }

        const uniqueUrls = [...new Set(Object.values(textureOverrides))].filter(Boolean);
        let loadedCount = 0;

        if (uniqueUrls.length === 0) {
            applyAllOverrides();
            return;
        }

        // Finish materials need the PBR registry (metal vs paint vs wood response) —
        // load it alongside the swatch textures; never rejects, defaults on failure.
        const applyWithPbr = () => { ensureFinishPbr().then(applyAllOverrides); };

        uniqueUrls.forEach(url => {
            if (globalTextureCache[url]) {
                texMap[url] = globalTextureCache[url];
                loadedCount++;
                if (loadedCount === uniqueUrls.length) applyWithPbr();
            } else {
                const loader = new THREE.TextureLoader();
                loader.setCrossOrigin('anonymous');
                loader.load(
                    url,
                    (tex) => {
                        tex.wrapS = THREE.RepeatWrapping;
                        tex.wrapT = THREE.RepeatWrapping;
                        tex.colorSpace = THREE.SRGBColorSpace;
                        // Grazing angles (a pole receding from camera) mip-smear the swatch into
                        // lengthwise streaks without this; three clamps to the GPU max internally.
                        tex.anisotropy = 8;
                        globalTextureCache[url] = tex;
                        texMap[url] = tex;
                        loadedCount++;
                        if (loadedCount === uniqueUrls.length) applyWithPbr();
                    },
                    undefined,
                    (err) => {
                        console.error("Failed to load texture:", url, err);
                        loadedCount++;
                        if (loadedCount === uniqueUrls.length) applyWithPbr();
                    }
                );
            }
        });
    }, [clonedScene, textureOverridesString, visibilityOverridesString, cloneSpecsString, stretchSpecString, spliceMarksString, highlightOverridesString, defaultHidden, JSON.stringify(clearNodes), onPaintAudit]);

    return <primitive object={clonedScene} />;
};
