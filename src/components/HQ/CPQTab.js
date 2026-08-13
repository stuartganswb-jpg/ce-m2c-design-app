import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { splitNodes, splitNodesLower, exactNode } from '../Shared/nodeList';
import { setupAllows, driveAllows } from '../Shared/traverseTags';
import { selectedFinishes, finishLabelOf, finishLabelOfItem } from '../Shared/finishLabel';
import { cutText } from '../Shared/configQty';
import { db, storage, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp, query, where } from "firebase/firestore";
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { useGLTF, OrbitControls, Bounds, Html } from '@react-three/drei';
import { StudioRig, ensureFinishPbr, pbrForTexture } from '../Shared/studioScene';
import { SIZE_STEP_TYPE, makeSizeSwap, sizeSelectionsOf, returnsAllowedFor, isReturnOption, speciesVariantOf, buildSizeIndex, sizeVariantOf, partAllowedAtSize, projAllowedAtDia, renderScaleOf, optionProjAllowed, taggedProjInchesAtDia, projOptionInches } from '../Shared/sizeMatrix';
import { PRICE_LEVELS, priceLevelShort, fabricutPriceOf, fabricutCodeOf } from '../Shared/priceLevels';
import { buildFeeCatalog, buildCheckoutCatalog, buildAddOnLines, addOnsTotal } from '../Shared/feeRules';
import { platePrice } from '../Shared/plateRules';
import AddOnPicker from '../Shared/AddOnPicker';
import { customerKeys, clientPriceFor } from '../Shared/clientPricing';

const globalTextureCache = {};

// Coerce any value into something Firestore will accept before a write: drop undefined / functions /
// symbols, turn NaN/Infinity into null, plain-ify class instances, and — since Firestore forbids an
// array directly inside another array — wrap nested arrays in a small map. The finalized quote mixes
// CPQ output with Vision-derived data of unpredictable shape, which otherwise throws
// "cpqData contains an invalid nested entity" and aborts the whole save.
const fsSafe = (v) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? v : null;
    if (t === 'string' || t === 'boolean') return v;
    if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
    if (v instanceof Date) return v;
    if (Array.isArray(v)) {
        return v.map(x => (Array.isArray(x) ? { _items: fsSafe(x) } : fsSafe(x))).filter(x => x !== undefined);
    }
    if (t === 'object') {
        const out = {};
        for (const k of Object.keys(v)) {
            const c = fsSafe(v[k]);
            if (c !== undefined) out[k] = c;
        }
        return out;
    }
    return undefined;
};

// Diagnostic companion to fsSafe: returns the path of the first value Firestore would still reject
// (or null). Lets us confirm a deploy is live and pinpoint any fsSafe gap from the browser console.
const findFsViolation = (v, path) => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'number') return Number.isFinite(v) ? null : `${path} = ${v}`;
    if (t === 'string' || t === 'boolean') return null;
    if (t === 'undefined') return `${path} = undefined`;
    if (t === 'function' || t === 'symbol' || t === 'bigint') return `${path} is ${t}`;
    if (v instanceof Date) return null;
    if (Array.isArray(v)) {
        for (let i = 0; i < v.length; i++) {
            if (Array.isArray(v[i])) return `${path}[${i}] is a nested array`;
            const r = findFsViolation(v[i], `${path}[${i}]`);
            if (r) return r;
        }
        return null;
    }
    if (t === 'object') {
        const proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) return `${path} is a ${v.constructor ? v.constructor.name : 'non-plain'} instance`;
        for (const k of Object.keys(v)) {
            if (k === '' || /[.~*\/\[\]]/.test(k)) return `${path} has invalid map key "${k}" (empty or contains . ~ * / [ ])`;
            const r = findFsViolation(v[k], `${path}.${k}`);
            if (r) return r;
        }
        return null;
    }
    return `${path} is ${t}`;
};

const SearchableCustomerSelect = ({ value, onChange, customers, placeholder, style }) => {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        if (value) {
            const c = customers.find(x => x.id === value);
            if (c) setSearch(`${c.name} (${c.id})`);
        } else {
            setSearch('');
        }
    }, [value, customers]);

    const filtered = customers.filter(c => 
        c.name.toLowerCase().includes(search.toLowerCase()) || 
        c.id.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div style={{ position: 'relative', flex: 1 }}>
            <input 
                type="text"
                value={search}
                onChange={(e) => {
                    setSearch(e.target.value);
                    setIsOpen(true);
                    if (e.target.value === '') onChange('');
                }}
                onFocus={() => setIsOpen(true)}
                onBlur={() => setTimeout(() => setIsOpen(false), 200)}
                placeholder={placeholder}
                style={{ ...style, width: '100%', boxSizing: 'border-box' }}
            />
            {isOpen && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid var(--line)', maxHeight: '250px', overflowY: 'auto', zIndex: 10000, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                    {filtered.length === 0 && <div style={{ padding: '12px', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>No matches found...</div>}
                    {filtered.map(c => (
                        <div 
                            key={c.id}
                            onMouseDown={() => {
                                onChange(c.id);
                                setSearch(`${c.name} (${c.id})`);
                                setIsOpen(false);
                            }}
                            style={{ padding: '12px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: value === c.id ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', fontSize: '0.9rem', fontFamily: 'var(--sans)' }}
                        >
                            {c.name} <span style={{color: 'var(--ink-soft)', fontSize: '0.75rem'}}>({c.id})</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export const DynamicModel = ({ url, textureOverrides, visibilityOverrides, cloneSpecs, highlightOverrides, onVisAudit }) => {
    const { scene } = useGLTF(url, 'https://www.gstatic.com/draco/versioned/decoders/1.5.5/');
    const clonedScene = useMemo(() => scene.clone(true), [scene]);

    const textureOverridesString = JSON.stringify(textureOverrides);
    const visibilityOverridesString = JSON.stringify(visibilityOverrides);
    const cloneSpecsString = JSON.stringify(cloneSpecs);
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
            const ACRYLIC_CODE_RX = /(ACBF|138ABF|138AFBF|138APF|138AJF|138FBF|138PF|138FJF|HTAJCBA|HTAJF|HCUAP|HRBASQ)/i;
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

                    let isVis = child.userData.originalVisible;
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
                        // Studio-render upgrade: the swatch map carries the TONE, but how the
                        // surface answers light (bare metal vs paint coat vs wood vs acrylic)
                        // comes from the finish's PBR entry — metal at rough 0.3 shows the
                        // softbox streak, matte black correctly loses the mirror hotspot.
                        const pbr = pbrForTexture(matchedTexUrl);
                        if (newMat.isMeshStandardMaterial) {
                            newMat.metalness = pbr.metalness;
                            newMat.roughness = pbr.roughness;
                        }
                        newMat.envMapIntensity = pbr.envMapIntensity;
                        newMat.needsUpdate = true;
                        child.material = newMat;
                    } else {
                        child.material = child.userData.originalMaterial;
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
    }, [clonedScene, textureOverridesString, visibilityOverridesString, cloneSpecsString, highlightOverridesString]);

    return <primitive object={clonedScene} />;
};

// Captures Front + Back images of the configured model for the production packet. Lives inside the
// Canvas so it can drive gl/scene/camera; auto-orients off the model's bounding box (longest axis =
// pole, shortest = depth/front), snaps two angles, then restores the user's view. Downscales to a
// white-background JPEG so the data stays small enough to store. Needs Canvas gl.preserveDrawingBuffer.
const ViewCapturer = ({ onReady }) => {
    const { gl, scene, camera } = useThree();
    useEffect(() => {
        onReady(() => {
            try {
                // Fit to the VISIBLE model only — hidden meshes (unselected options, the center
                // source, fasteners) inflate the scene box and shrink the real model to nothing.
                // Update world matrices first, then union each mesh's world-space geometry box by
                // hand (expandByObject can read stale matrices, which framed the camera off the
                // model → blank captures). effVis walks ancestors so a hidden parent counts as hidden.
                scene.updateMatrixWorld(true);
                const effVis = (o) => { let n = o; while (n) { if (!n.visible) return false; n = n.parent; } return true; };
                const box = new THREE.Box3();
                const tmpBox = new THREE.Box3();
                scene.traverse(o => {
                    if (!o.isMesh || !o.geometry || !effVis(o)) return;
                    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
                    tmpBox.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
                    box.union(tmpBox);
                });
                if (box.isEmpty()) return null;
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const ranked = [['x', size.x], ['y', size.y], ['z', size.z]].sort((a, b) => a[1] - b[1]);
                const depthAxis = ranked[0][0], vertAxis = ranked[1][0], longAxis = ranked[2][0];
                const dirFrom = (d, v, l) => { const o = new THREE.Vector3(); o[depthAxis] = d; o[vertAxis] = v; o[longAxis] = l; return o.normalize(); };
                const fov = (camera.fov || 50) * Math.PI / 180;
                const half = size.clone().multiplyScalar(0.5);
                const savePos = camera.position.clone(), saveUp = camera.up.clone(), saveQuat = camera.quaternion.clone();
                const shoot = (dir) => {
                    const d = dir.clone().normalize();
                    camera.up.set(0, 1, 0);
                    // Tight per-view fit: project the box half-extents onto this view's right/up axes and
                    // fit both to the REAL canvas aspect, so a long pole fills the frame instead of sitting
                    // tiny in the middle (the old bounding-sphere fit was far too zoomed out).
                    let right = new THREE.Vector3().crossVectors(camera.up, d);
                    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
                    right.normalize();
                    const vUp = new THREE.Vector3().crossVectors(d, right).normalize();
                    const halfW = Math.abs(half.x * right.x) + Math.abs(half.y * right.y) + Math.abs(half.z * right.z);
                    const halfH = Math.abs(half.x * vUp.x) + Math.abs(half.y * vUp.y) + Math.abs(half.z * vUp.z);
                    const aspect = (gl.domElement.width && gl.domElement.height) ? gl.domElement.width / gl.domElement.height : 1.5;
                    const t = Math.tan(fov / 2);
                    const dist = Math.max(halfH / t, halfW / (t * aspect)) * 1.12;
                    camera.position.copy(center).add(d.multiplyScalar(dist));
                    camera.lookAt(center);
                    camera.updateProjectionMatrix();
                    gl.render(scene, camera);
                    const src = gl.domElement;
                    const scale = Math.min(1, 900 / src.width);
                    const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
                    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
                    const ctx = oc.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(src, 0, 0, w, h);
                    return oc.toDataURL('image/jpeg', 0.85);
                };
                const front = shoot(dirFrom(1, 0.35, 0.25));   // 3/4 off straight elevation, slightly above
                const back = shoot(dirFrom(-0.7, 0.9, 0.2));    // behind + above (shows mounting detail)
                camera.position.copy(savePos); camera.up.copy(saveUp); camera.quaternion.copy(saveQuat); camera.updateProjectionMatrix();
                gl.render(scene, camera);
                return { front, back };
            } catch (e) { console.warn('view capture failed', e); return null; }
        });
    }, [gl, scene, camera, onReady]);
    return null;
};

// Engineering Specs strip — the Vision "post-it" laid out HORIZONTALLY, shown in the pricing row
// (between the unit price and the breakdown) so the full spec list never gets clipped by the 3D
// viewport height (the old vertical overlay cut off the center-bracket specs at the bottom).
export const EngineeringSpecsStrip = ({ draft, notes, parts, hideHangers }) => {
    const nm = (id) => { if (!id) return null; const p = parts.find(x => x.id === id || x.itemId === id || x.legacyErpId === id); return p ? p.itemName : id; };
    const sd = draft.spatialData || {};
    const picks = [
        ['Left arm', nm(sd.bracketId)], ['Left plate', nm(sd.backplateIdLeft)],
        ['Right arm', nm(sd.bracketIdRight)], ['Right plate', nm(sd.backplateIdRight)],
        ['Center arm', nm(sd.bracketIdCenter)], ['Center plate', nm(sd.backplateIdCenter)],
    ].filter(r => r[1]);
    const hasFees = notes.qtySplices > 0 || notes.qtyBends > 0 || notes.qtyMiters > 0 || notes.qtyMiterReturns > 0;
    const hasCounts = notes.qtyBrackets > 0 || notes.recRings > 0 || notes.qtyFinials > 0;
    const hangers = Array.isArray(notes.hangerLocations) ? notes.hangerLocations : [];
    const Hdr = ({ children }) => <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.07em', color: 'var(--ink)', display: 'block', marginBottom: '6px', borderBottom: '1px solid var(--line)', paddingBottom: '4px' }}>{children}</span>;
    const Row = ({ k, v }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '2px' }}><span style={{ color: 'var(--ink-soft)' }}>{k}</span><span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{v}</span></div>;
    // Sections auto-flow into balanced CSS columns (no manual wrap), capped height so the strip
    // never dominates the screen. breakInside keeps a section intact within one column.
    const sec = { fontSize: '0.78rem', color: 'var(--ink)', breakInside: 'avoid', WebkitColumnBreakInside: 'avoid', marginBottom: '14px' };
    return (
        <div style={{ flex: 1, alignSelf: 'stretch', maxHeight: '320px', overflowY: 'auto', background: '#fdfbf7', border: '1px solid var(--brass)', borderRadius: '2px', padding: '14px 16px' }}>
            <div style={{ fontFamily: 'var(--serif)', fontWeight: 500, fontSize: '0.95rem', marginBottom: '12px', display: 'flex', alignItems: 'baseline', gap: '12px', color: 'var(--ink)', position: 'sticky', top: 0, background: '#fdfbf7', zIndex: 1 }}>
                Engineering Specs
                <span style={{ fontSize: '9px', fontFamily: 'var(--mono)', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em' }}>Manual Entry — match the note</span>
                {draft.jobName && <span style={{ marginLeft: 'auto', fontFamily: 'var(--sans)', fontSize: '0.8rem', color: 'var(--ink-soft)' }}>{draft.jobName}{draft.sidemark ? ` · ${draft.sidemark}` : ''}</span>}
            </div>
            <div style={{ columnWidth: '210px', columnGap: '26px' }}>
                <div style={sec}>
                    <Hdr>Dimensions</Hdr>
                    {notes.poleO2O != null && <Row k="Pole O2O" v={`${notes.poleO2O.toFixed(2)}"`} />}
                    {notes.totalSystemO2O != null && <Row k="Total Sys O2O" v={`${notes.totalSystemO2O.toFixed(2)}"`} />}
                    {notes.shape === 'MITERED' && notes.pole1 != null && <Row k="Left Wall C2C" v={`${notes.pole1.toFixed(2)}"`} />}
                    {notes.pole2 != null && <Row k={notes.shape === 'STRAIGHT' ? 'Main Wall C2C' : 'Center Wall C2C'} v={`${notes.pole2.toFixed(2)}"`} />}
                    {notes.shape === 'MITERED' && notes.pole3 != null && <Row k="Right Wall C2C" v={`${notes.pole3.toFixed(2)}"`} />}
                    {notes.poleFeetQty != null && <Row k="Pole Qty (ft)" v={notes.poleFeetQty} />}
                </div>
                <div style={sec}>
                    <Hdr>Counts (Rec)</Hdr>
                    {notes.qtyBrackets > 0 && <Row k="Brackets" v={notes.qtyBrackets} />}
                    {notes.recRings > 0 && <Row k="Rings" v={notes.recRings} />}
                    {notes.qtyFinials > 0 && <Row k="Finials" v={notes.qtyFinials} />}
                    {!hasCounts && <div style={{ color: 'var(--ink-soft)' }}>—</div>}
                </div>
                {hasFees && (
                    <div style={sec}>
                        <Hdr>Fees to Add</Hdr>
                        {notes.qtySplices > 0 && <Row k="Splice" v={`×${notes.qtySplices}`} />}
                        {notes.qtyBends > 0 && <Row k="Bent Return" v={`×${notes.qtyBends}`} />}
                        {notes.qtyMiters > 0 && <Row k="Miter Cut" v={`×${notes.qtyMiters}`} />}
                        {notes.qtyMiterReturns > 0 && <Row k="Miter Return" v={`×${notes.qtyMiterReturns}`} />}
                    </div>
                )}
                {!hideHangers && hangers.length > 0 && (
                    <div style={sec}>
                        <Hdr>Hanger Placement · drill points</Hdr>
                        {hangers.map((h, i) => <div key={i} style={{ marginBottom: '3px', lineHeight: 1.3 }}>• <strong style={{ fontWeight: 500 }}>{h.anchor}</strong> — {h.position}{h.note ? <span style={{ color: 'var(--ink-soft)' }}> · {h.note}</span> : null}</div>)}
                    </div>
                )}
                {picks.length > 0 && (
                    <div style={sec}>
                        <Hdr>Vision Picks · match these</Hdr>
                        {picks.map((r, i) => (
                            <div key={i} style={{ marginBottom: '5px', lineHeight: 1.25 }}>
                                <span style={{ color: 'var(--ink-soft)', fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '.04em', marginRight: '6px' }}>{r[0]}</span>
                                {r[1]}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const CPQTab = ({ currentUser, activeBrand, cart, setCart }) => {
  const [liveAssemblies, setLiveAssemblies] = useState([]);
  const [liveCustomers, setLiveCustomers] = useState([]);
  const [crmDiscounts, setCrmDiscounts] = useState([]);
  const [previousDrafts, setPreviousDrafts] = useState([]); 
  const [cpqRules, setCpqRules] = useState([]);
  const [cpqFlows, setCpqFlows] = useState([]);
  
  const [libraryParts, setLibraryParts] = useState([]);
  const [activeBomPins, setActiveBomPins] = useState([]); 

  const [globalLists, setGlobalLists] = useState({
      inventoryTypes: [], assemblyTypes: [], prodTypes: [], customers: [], bracketMounts: [], feeTypes: []
  });
  const [globalFinishes, setGlobalFinishes] = useState([]);
  const [outsourceFinishes, setOutsourceFinishes] = useState([]);
  // ADD-ONS AT CHECKOUT (Stuart 2026-07-30): fees picked at the END of the quote rather than built
  // into a flow — { [feeDocId]: qty | true }. Percentage fees are on/off; the rest take a quantity.
  const [addOnSel, setAddOnSel] = useState({});
  const [dynamicAssets, setDynamicAssets] = useState([]);

  const [productType, setProductType] = useState(''); 
  const [activeFlowId, setActiveFlowId] = useState("");
  // 📏 Size-group landing (Stuart 2026-07-24 pivot): sibling per-assembly flows collapse into
  // one picker entry; Rod Diameter is asked FIRST, then that assembly's own flow loads.
  const [pendingGroup, setPendingGroup] = useState("");
  const launchFlow = (id) => { setActiveFlowId(id); setCurrentStepIndex(0); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setProductType(''); setActiveAssemblyId(''); setActiveDraftId(null); setActiveDraftSvg(null); setAssemblyQty(1); setLineTag(''); };
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  
  const [dynamicConfigParams, setDynamicConfigParams] = useState({});
  const [stepQuantities, setStepQuantities] = useState({}); 
  const [dimensionInputs, setDimensionInputs] = useState({});
  // CUSTOM WORK OVERRIDES (Stuart 2026-07-28) — per STEP, set by the operator at quote time:
  //   { [stepId]: { feeItemId, feeErpId, feeName, handling, notes, amount, floor } }
  // Ticking it overrules the library routing for that step's parts and adds a priced fee line.
  // The chosen FEE ITEM declares the destination floor via its own Part Handling, so new fee
  // types work the moment they're ticked in the Master Library. APP ONLY — the customer portal
  // has its own configurator and never renders or receives this.
  const [customOverrides, setCustomOverrides] = useState({});

  const [engineFlags, setEngineFlags] = useState({ disabledSteps: [], warnings: [] });
  
  const [pricing, setPricing] = useState({ base: 0, finalPrice: 0 });
  const [pricingBreakdown, setPricingBreakdown] = useState([]);
  // Quote-display price level (Shared/priceLevels): Fabricut-data items price per the imported
  // sheet at FAB levels; everything else stays standard. Never drives NetSuite push rates.
  const [priceLevel, setPriceLevel] = useState('STANDARD');
  // Brand logos (hq_config/brand_logos, uploaded in Admin → Form Templates) — printed at the top
  // of the generated order documents.
  const [brandLogos, setBrandLogos] = useState({});
  
  const [jobData, setJobData] = useState({
      customerId: '',
      jobName: '',
      // ORDER SIDEMARK (Stuart 2026-08-10): header-level order tag ("Smith Residence") — prints on
      // the quote/SO/packing-slip HEADER (job.sidemark + the NetSuite estimate memo). Distinct from
      // the per-LINE tag (lineTag below) that names each configuration ("Living Room").
      sidemark: '',
      shippingMethod: 'SAVED',
      shippingAddressId: '',
      shippingAmount: '',
      customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' }
  });
  
  const [assemblyQty, setAssemblyQty] = useState(1);
  // PER-LINE TAG (Stuart 2026-08-10): entered at the start of each configuration ("Living Room",
  // "Primary Bedroom") — lands on the cart item's existing `sidemark` field, which every document
  // already renders (▶ Assembly [tag] on quotes/BOM/RTG/viewer). Vision drafts pre-fill it.
  const [lineTag, setLineTag] = useState('');
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showCartSuccessModal, setShowCartSuccessModal] = useState(false);

  const [activeAssemblyId, setActiveAssemblyId] = useState('');
  const [activeAssembly, setActiveAssembly] = useState(null);
  
  const [activeMasterQuoteId, setActiveMasterQuoteId] = useState(null);
  const [activeDraftId, setActiveDraftId] = useState(null);
  const [activeDraftSvg, setActiveDraftSvg] = useState(null);

  const [viewMode, setViewMode] = useState("3D");
  // TEMP (Stage 1 debug): when on, bypass hidden-until-chosen so the full glb renders.
  // Used to tell a glb-load problem apart from a visibility problem. Remove before merge.
  const [debugShowAll, setDebugShowAll] = useState(false);
  // Geometry-map tokens the render matched to NOTHING in the loaded model (see DynamicModel's
  // render-map audit). Content-compared so the per-frame reports don't re-render in a loop.
  const [visAudit, setVisAudit] = useState([]);
  const handleVisAudit = useCallback((arr) => {
      setVisAudit(prev => (prev.length === arr.length && prev.every((v, i) => v === arr[i])) ? prev : arr);
  }, []);
  // TEMP (Stage 0 debug): when on, glow the meshes the current step's selection controls.
  const [debugHighlight, setDebugHighlight] = useState(false);
  // Production packet — captured Front/Back images of the configured model. captureFnRef is filled by
  // the in-Canvas <ViewCapturer/>; registerCapture is stable so its effect doesn't re-fire each render.
  const [capturedViews, setCapturedViews] = useState(null);
  const captureFnRef = useRef(null);
  const registerCapture = useRef((fn) => { captureFnRef.current = fn; }).current;

  useEffect(() => {
      const sessionStr = localStorage.getItem('hq_active_quote_session');
      if (sessionStr) {
          setActiveMasterQuoteId(sessionStr);
          // Reopened quote (CRM/ERP "Reopen in CPQ"): restore the job context, since the
          // customer select is disabled while a session lock is active. The payload stays in
          // localStorage until finalize / Clear All so a tab-away remount restores it again.
          try {
              const reopen = JSON.parse(localStorage.getItem('hq_reopen_quote') || 'null');
              if (reopen && reopen.jobId === sessionStr) {
                  setJobData(prev => ({
                      ...prev,
                      customerId: reopen.customerId || '',
                      jobName: reopen.jobName || '',
                      sidemark: reopen.sidemark || '',
                      poNumber: reopen.poNumber || '',
                      internalMemo: reopen.internalMemo || '',
                      shippingMethod: reopen.shippingMethod || 'SAVED',
                      shippingAddressId: reopen.shippingAddressId || '',
                      shippingAmount: reopen.shippingAmount || '',
                      customShippingAddress: reopen.customShippingAddress || prev.customShippingAddress
                  }));
                  // Portal checkout add-ons ride the reopen session pre-ticked (see
                  // Shared/reopenQuote.js) — staff adjust or keep them at checkout.
                  if (reopen.addOnSel && Object.keys(reopen.addOnSel).length) setAddOnSel(reopen.addOnSel);
              }
          } catch (e) { /* corrupt reopen payload — ignore */ }
      }
  }, []);

  useEffect(() => {
      if (!activeBrand) return;
      
      const unsubFlows = onSnapshot(query(collection(db, "cpq_flows"), where("brandId", "==", activeBrand)), (snap) => setCpqFlows(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      const unsubRules = onSnapshot(doc(db, "system", "cpq_rules"), (snap) => { if(snap.exists() && snap.data().rules) setCpqRules(snap.data().rules); });
      const unsubLogos = onSnapshot(doc(db, "hq_config", "brand_logos"), (snap) => { if (snap.exists()) setBrandLogos(snap.data()); });
      const unsubDrafts = onSnapshot(query(collection(db, "cpq_drafts"), where("brandId", "==", activeBrand)), (snap) => setPreviousDrafts(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
      
      const unsubParts = onSnapshot(query(collection(db, "Approved_Designs")), (snap) => {
          let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          docs = docs.filter(d => d.brandId === activeBrand || (d.sharedBrands && d.sharedBrands.includes(activeBrand)));
          // Fee/Charge + Alias entities included: fee options price from the fee ENTITY's basePrice
          // (e.g. CE-FEE-5138) — filtering to Inventory only left them unresolvable, so fees sat at $0.
          // CHECKOUT-TICKED parts ride along REGARDLESS of class (Eric 2026-08-12: HBMB40/P — an
          // Assembly — was ticked in 4.6 but never showed: the class filter dropped it before the
          // catalog ever looked).
          setLibraryParts(docs.filter(d => ["Inventory", "Fee", "Alias"].includes(d.partClass) || d.manufacturingSpecs?.checkoutSelectable === true));
          setLiveAssemblies(docs.filter(d => d.partClass === "Assembly" || d.partClass === "Master Assembly"));
      });

      const unsubLists = onSnapshot(doc(db, "system", "master_lists"), (docSnap) => { if (docSnap.exists()) setGlobalLists(docSnap.data()); });
      // Trade discount dictionary (AdminTab → CRM & Sales Configuration → Discount Codes) —
      // resolves a customer's discountCode (e.g. D20) to its percent at quote time.
      const unsubDiscounts = onSnapshot(doc(db, "system", "crm_discounts"), (snap) => setCrmDiscounts((snap.exists() && snap.data().list) || []));
      const unsubFinishes = onSnapshot(doc(db, "system", "master_finishes"), (snap) => { if(snap.exists() && snap.data().finishes) setGlobalFinishes(snap.data().finishes); });
      const unsubOutsource = onSnapshot(collection(db, "hq_outsource_finishes"), (snap) => setOutsourceFinishes(snap.docs.map(d => ({id: d.id, ...d.data()}))));
      const unsubDynamic = onSnapshot(collection(db, "hq_dynamic_data"), (snap) => setDynamicAssets(snap.docs.map(d => ({id: d.id, ...d.data()}))));

      const unsubCrm = onSnapshot(collection(db, "crm_records"), (snap) => {
          // Brand isolation: only this brand's (subsidiary's) customers, matching ClientVisionTab.
          const customers = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r =>
              r.type === 'CUSTOMER' &&
              (r.brandId === activeBrand || (r.sharedBrands && r.sharedBrands.includes(activeBrand)))
          );
          setLiveCustomers(customers);
      });

      return () => { unsubFlows(); unsubParts(); unsubLists(); unsubRules(); unsubDrafts(); unsubFinishes(); unsubOutsource(); unsubDynamic(); unsubCrm(); unsubDiscounts(); unsubLogos(); };
  }, [activeBrand]);

  // Brand isolation: the CPQ customer dropdown is ONLY this brand's crm_records
  // (filtered above). Legacy master_lists.customers are plain strings with no
  // brandId, so they can't be brand-scoped and would leak other brands' names
  // into the dropdown — dropped intentionally.
  const combinedCustomers = useMemo(() => liveCustomers, [liveCustomers]);

  // ADD-ON CATALOGUE — the brand's fee items, priced for the customer on the quote by the SAME
  // resolver the pricing engine uses (their clientPricing row, else our base price), so the picker
  // and the quote can never disagree. Fees a flow already bills are still billed by the flow; this
  // is for the ones nobody wants to model as a step.
  const addOnCustKeys = useMemo(
      () => customerKeys(jobData.customerId, combinedCustomers.find(c => c.id === jobData.customerId)),
      [jobData.customerId, combinedCustomers]);
  // The checkout list is CURATED in 4.6 → Checkout Items (Stuart 2026-07-31: "we need better
  // control of what appears here … french return is a fee but it is decided in the cpq itself").
  // Ticked items win — fees AND real items. Until anything is ticked it falls back to the whole fee
  // catalogue, so the screen never goes blank on the way to being curated.
  const addOnCatalog = useMemo(() => {
      const priceFor = (p) => clientPriceFor(p.clientPricing, addOnCustKeys) ?? (parseFloat(p.manufacturingSpecs?.basePrice) || 0);
      // ITEMS and FEES curate INDEPENDENTLY (Eric 2026-08-12: ticking one real item made every
      // fee vanish — the old either/or swapped the WHOLE catalog). Ticked real items always show;
      // fees show ALL unless at least one FEE is itself ticked, in which case only the ticked
      // fees show (that's the curation Stuart asked for on 2026-07-31 — it was never meant to be
      // switched off by an unrelated item tick).
      const checkout = buildCheckoutCatalog(libraryParts, { priceFor });
      const curatedFeeCount = checkout.filter(e => e.isFee).length;
      const fees = curatedFeeCount > 0 ? [] : buildFeeCatalog(libraryParts, { priceFor });
      const seen = new Set(checkout.map(e => e.id));
      return [...checkout, ...fees.filter(e => !seen.has(e.id))];
  }, [libraryParts, addOnCustKeys]);

  // TRADE DISCOUNT (customer's CRM discountCode, e.g. D20 = less 20%). Applies per cart item,
  // AFTER the full pricing chain, display-side only: STANDARD-level items only (Fabricut levels
  // are already negotiated prices), and only on the item-priced portion — fee/labor lines and
  // lines that resolve to no physical item are never discounted. Evaluated against the CURRENT
  // customer at display/finalize time (not stamped at add-to-cart, so items added before the
  // customer was picked still discount). Returns per-unit figures, or null when not applicable.
  const tradeDiscountFor = (item) => {
      if (!item || (item.priceLevel || 'STANDARD') !== 'STANDARD') return null;
      const custRec = combinedCustomers.find(c => c.id === jobData.customerId);
      const code = String(custRec?.discountCode || '').trim();
      if (!code) return null;
      const disc = crmDiscounts.find(d => String(d.code || '').trim().toUpperCase() === code.toUpperCase());
      const percent = disc ? parseFloat(disc.percent) : 0;
      if (!(percent > 0)) return null;
      // Pre-isFee cart items (older localStorage carts) lack the flag — the CE-FEE id guard and
      // the physical-item requirement still keep fees out of the base.
      const base = (item.pricingBreakdown || [])
          .filter(l => l && !l.isFee && (l.partId || l.legacyErpId) && !String(l.legacyErpId || '').toUpperCase().startsWith('CE-FEE'))
          .reduce((s, l) => s + (parseFloat(l.total) || 0), 0);
      if (!(base > 0)) return null;
      const amount = Math.round(base * percent) / 100; // base × percent%, rounded to cents
      return { code, percent, base, amount };
  };

  const activeFlow = cpqFlows.find(f => f.id === activeFlowId);

  useEffect(() => {
      if (activeFlow && activeFlow.linkedAssemblyId) {
          setActiveAssemblyId(activeFlow.linkedAssemblyId);
      }
  }, [activeFlow]);

  useEffect(() => {
      if (activeAssemblyId) {
          const asm = liveAssemblies.find(a => a.id === activeAssemblyId);
          setActiveAssembly(asm || null);
          if (asm?.manufacturingSpecs?.cadUrl) {
              setViewMode("3D");
          } else {
              setViewMode("2D");
          }
      } else {
          setActiveAssembly(null);
          setViewMode("2D");
      }
  }, [activeAssemblyId, liveAssemblies]);

  useEffect(() => {
      if (!activeAssemblyId || !liveAssemblies.length) { setActiveBomPins([]); return; }
      const asm = liveAssemblies.find(a => a.id === activeAssemblyId);
      if (!asm) return;
      const unsub = onSnapshot(query(collection(db, "assembly_pins"), where("assemblyId", "==", asm.itemId)), (snap) => {
          setActiveBomPins(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsub();
  }, [activeAssemblyId, liveAssemblies]);

  // Stage 1 — default a starting configuration when a generated flow opens with no draft.
  // Hidden-until-chosen (see visibilityOverrides) hides every mesh a STYLE_SWAP step could
  // control until that step has a selection, so an un-touched flow renders nearly blank.
  // Seeding the first geometry-bearing option for each style step (+ the first Mount location)
  // makes the FULL default model show; the customer can still swap any option afterward.
  // Guardrails: never runs while a resumed draft owns the selections, and only fills steps
  // that have no value yet (so a customer's pick, or a value seeded on an earlier pass once
  // activeAssembly loads, is never clobbered) — which also makes re-fires from cpq_flows
  // snapshots a no-op.
  // ONE DEFINITION OF "THE DEFAULT OPTION", used by the opening seed below AND by the re-seed that
  // runs when a traverse answer invalidates a selection. They used to disagree — the seed ignored
  // the traverse filter entirely, so it could hand a step back exactly the option the filter had
  // just removed: selected, absent from its own dropdown, still rendering.
  //
  // A default must be the STANDARD configuration — never a FEE, a french/miter return, or an inside
  // mount. After the size-matrix regenerate the modeled FRENCH RETURN became the first
  // geometry-bearing option on the End Treatment steps, so an untouched flow opened pre-charged with
  // two $50 return fees (and the returns hid the rod ends). A step whose options are all fee/return-
  // ish seeds nothing and stays unselected.
  const seedable = useCallback((opts) => (opts || []).filter(o =>
      !o.isFee && !isReturnOption(o) && String(o.endTreatment || '').toUpperCase() !== 'INSIDE_MOUNT'), []);
  // Prefer the first option that actually controls geometry, so the default shows a real part rather
  // than a fee-only placeholder; fall back to the first option.
  const defaultOptionFor = useCallback((opts, gmap, preferId) => {
      const pool = seedable(opts);
      // A step may NAME its own default (step.defaultOptId). The traverse Single-or-Double selector
      // needs this: SINGLE is the standard build but carries no geometry of its own — a double ADDS
      // a track, a single adds nothing — so the geometry-first rule below would pick DOUBLE by
      // elimination and open every quote on the wrong configuration.
      const named = preferId && pool.find(o => (o.optId || o.partId) === preferId);
      if (named) return named.optId || named.partId;
      const withGeom = pool.find(o => {
          const csv = (gmap && gmap[o.optId || o.partId]) || o.targetNode;
          return csv && String(csv).trim();
      });
      const pick = withGeom || pool[0];
      return pick && (pick.optId || pick.partId);
  }, [seedable]);

  useEffect(() => {
      if (!activeFlow || activeDraftId) return;
      const steps = activeFlow.steps || [];
      setDynamicConfigParams(prev => {
          const next = { ...prev };
          let changed = false;
          // ⛔ REVERTED 2026-08-05. Seeding only the steps the customer had REACHED made the price
          // start at $0.00, which is what he asked for — but it broke the render, and he was right
          // to call it immediately. Hidden-until-chosen hides every mesh a STYLE_SWAP step could
          // control until that step has a selection, so an unreached step hides its geometry: at
          // step 3 the Track step (step 6) had no answer yet, so the front track and its ends were
          // invisible and single-vs-double appeared to do nothing.
          //
          // The two goals are in direct conflict under that rule, and the render wins — a quote you
          // cannot see is worse than a quote that pre-answers. Doing both needs the visibility model
          // to separate "not chosen yet" from "chosen as nothing", which is a real change, not a
          // gate on this loop.
          steps.forEach(step => {
              if (step.type === 'STYLE_SWAP' && Array.isArray(step.styleOptions) && step.styleOptions.length) {
                  // trvOkFor here is the fix for "selected but not in the list": the sub-seed below
                  // and the dropdown itself both filter by it, and only this line did not.
                  if (!next[step.id]) { const id = defaultOptionFor((step.styleOptions || []).filter(optCustomerOk).filter(trvOkFor(step)), step.geometryMap, step.defaultOptId); if (id) { next[step.id] = id; changed = true; } }
                  // Secondary chooser in the same step (e.g. the backplate paired with the bracket),
                  // seeded to a plate whose location matches the chosen bracket's mount.
                  if (Array.isArray(step.subOptions) && step.subOptions.length && !next[`${step.id}__sub`]) {
                      const mainOpt = step.styleOptions.find(o => (o.optId || o.partId) === next[step.id]);
                      const loc = mainOpt?.location;
                      const pool0 = (step.subOptions || []).filter(optCustomerOk).filter(trvOkFor(step, { isSub: true }));
                      const cands = loc ? pool0.filter(o => !o.location || o.location === loc) : pool0;
                      const sid = defaultOptionFor(cands.length ? cands : pool0, step.subGeometryMap, step.defaultSubOptId);
                      if (sid) { next[`${step.id}__sub`] = sid; changed = true; }
                  }
              } else if (step.mountSelector && !next[step.id]) {
                  // Needs activeAssembly's clusters (loaded async after the flow); on the pass
                  // where they're absent this is skipped and filled once they arrive.
                  const ORDER = { WALL: 0, CEILING: 1, END: 2 };
                  const locs = [...new Set((activeAssembly?.nodeClusters || []).map(c => c.location).filter(Boolean))]
                      .sort((a, b) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9));
                  if (locs.length) { next[step.id] = locs[0]; changed = true; }
              }
          });
          return changed ? next : prev;
      });
  }, [activeFlow, activeAssembly, activeDraftId]);

  const currentStep = activeFlow?.steps?.[currentStepIndex];
  // True if any step AFTER the current one is still enabled — drives whether we show "Next Step" or
  // the final "Add to Quote Cart", so disabled trailing steps (e.g. skipped finial/return) don't
  // strand the operator before checkout.
  const hasNextActiveStep = !!activeFlow && (activeFlow.steps || []).slice(currentStepIndex + 1).some(s => !engineFlags.disabledSteps.includes(s.title));
  const availableProductTypes = [...new Set(libraryParts.map(p => p.manufacturingSpecs?.productType).filter(Boolean))];

  // Resolve a style option's underlying part → its human item description, so CPQ choices show more
  // than the bare ERP id/code. Matches the option's partId/partName against every part key, then
  // returns the part's itemName (the description) when it differs from what's already shown.
  const partDescOf = (partId, partName) => {
      if (!partId && !partName) return '';
      const allParts = [...libraryParts, ...liveAssemblies];
      const p = allParts.find(x => x.id === partId || x.itemId === partId || x.legacyErpId === partId
          || (partName && (x.itemName === partName || x.legacyErpId === partName || x.itemId === partName)));
      const desc = p?.itemName || p?.manufacturingSpecs?.description || '';
      return desc && desc !== partName ? desc : '';
  };

  // Size-matrix labels: resolve an option's underlying part to the SELECTED size so the pickers
  // read the item actually being quoted — 3-5/8" projection shows H1-75DS (not the master's
  // H1-75DE), 1" diameter re-codes plates to H1-1BP-x, etc. Display only: selection ids (optId)
  // never change, so flipping sizes keeps every choice. Mirrors Vision's sized optLabel.
  const sizeLabelIndex = useMemo(() => buildSizeIndex([...libraryParts, ...liveAssemblies]), [libraryParts, liveAssemblies]);
  const sizedPartForLabel = (partId, partName) => {
      const sel = sizeSelectionsOf(activeFlow, dynamicConfigParams);
      if (!sel) return null;
      const allParts = [...libraryParts, ...liveAssemblies];
      const base = allParts.find(x => x.id === partId || x.itemId === partId || x.legacyErpId === partId
          || (partName && (x.itemName === partName || x.legacyErpId === partName || x.itemId === partName)));
      if (!base) return null;
      const r = sizeVariantOf(base, sel, sizeLabelIndex);
      return r.swapped ? r.part : null;
  };
  // Level-aware option display (Stuart 2026-07-11): FEES always show the plain description only
  // (CE-FEE ids are app-internal). FAB COST (CE→Fabricut) shows our id — description · Fabricut
  // pattern id. FAB WHOLESALE / RETAIL show the Fabricut pattern id (their world). STANDARD keeps
  // our sized code + description.
  const optionDisplayFor = (o) => {
      const allParts = [...libraryParts, ...liveAssemblies];
      const findBase = (k) => !k ? null : (allParts.find(x => String(x.legacyErpId || x.itemId || '').trim().toUpperCase() === String(k).trim().toUpperCase()) || null);
      const sized = sizedPartForLabel(o.partId, o.partName);
      const doc = sized || allParts.find(x => x.id === o.partId || x.itemId === o.partId || x.legacyErpId === o.partId
          || (o.partName && (x.itemName === o.partName || x.legacyErpId === o.partName || x.itemId === o.partName))) || null;
      const desc = doc?.itemName || partDescOf(o.partId, o.partName) || '';
      const fee = !!(o.isFee || doc?.partClass === 'Fee' || String(doc?.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE');
      if (fee) return { name: desc || o.partName, desc: '' };
      const ourCode = doc?.legacyErpId && doc.legacyErpId !== 'PENDING' ? doc.legacyErpId : (sized ? (sized.itemId || o.partName) : o.partName);
      if (priceLevel === 'FAB_WHOLESALE' || priceLevel === 'FAB_RETAIL') {
          const fc = fabricutCodeOf(doc, findBase, outsourceFinishes);
          return { name: fc || ourCode, desc: desc };
      }
      if (priceLevel === 'FAB_COST') {
          const fc = fabricutCodeOf(doc, findBase, outsourceFinishes);
          return { name: ourCode, desc: `${desc}${fc ? ' · ' + fc : ''}` };
      }
      return { name: sized ? (sized.legacyErpId || sized.itemId || o.partName) : o.partName, desc };
  };

  // ── TRAVERSE RUNTIME FILTER (Stuart 2026-08-04) ────────────────────────────────────────────────
  // The generator can only TAG options single/double and motorized/manual; something has to act on
  // the answer. This reads the two selections and hides what the customer has just ruled out —
  // pick Single and the double brackets and the rear track stop being offered.
  //
  // THE FASCIA IS DELIBERATELY UNTAGGED and therefore never filtered: a fascia system has ONE
  // fascia whether or not it is a double (his 2026-08-04 note — a double here is two TRACKS sharing
  // one fascia, unlike a round H2 double which really is two poles). "Blank = suits both" is
  // exactly that rule, so nothing special is needed for it.
  const trvSelection = React.useMemo(() => {
      let setup = '', drive = '';
      (activeFlow?.steps || []).forEach(s => {
          if (s.stepRole === 'TRV_SETUP') {
              const o = (s.styleOptions || []).find(x => (x.optId || x.partId) === dynamicConfigParams[s.id]);
              if (o?.trvSetup) setup = String(o.trvSetup).toUpperCase();
          }
          // THE DRIVE IS ITS OWN STEP (Stuart 2026-08-05: "it is an either or, either manual or
          // motorized ends, no combination"). It used to be read off the Track step's sub-choice,
          // on the theory that each track could be driven differently — it cannot, so the whole
          // order answers once.
          if (s.stepRole === 'TRV_DRIVE') {
              const o = (s.styleOptions || []).find(x => (x.optId || x.partId) === dynamicConfigParams[s.id]);
              if (o?.driveType) drive = String(o.driveType).toUpperCase();
          }
      });
      return { setup, drive };
  }, [activeFlow, dynamicConfigParams]);

  // A SELECTOR NEVER FILTERS ITSELF. The Single-or-Double step's own options carry trvSetup, and
  // the track's traverse-end sub-options carry driveType — filtering those by the current answer
  // would hide every alternative the moment one was picked, leaving a step that cannot be changed.
  // A SELECTOR NEVER FILTERS ITS OWN ANSWERS — but its SUB-choices are ordinary options and must
  // filter normally. The Front Rail sub-picker hangs off the Single-or-Double step and exists only
  // on a double; that is expressed by tagging its options setup:DOUBLE, which only works if the sub
  // list is filtered even though the step it lives on is the setup selector.
  const trvOkFor = (step, { isSub = false } = {}) => {
      const isSetupSelector = !isSub && step?.stepRole === 'TRV_SETUP';
      const isDriveSelector = !isSub && step?.stepRole === 'TRV_DRIVE';
      return (o) => (isSetupSelector || setupAllows(o, trvSelection.setup))
          && (isDriveSelector || driveAllows(o, trvSelection.drive));
  };

  const getOptionsForStep = (step) => {
      // Tag-driven Mount selector: options are the distinct Location tags on the linked assembly's
      // clusters (Wall / Ceiling / Inside-End). Picking one hides the off-mount end regions.
      if (step?.mountSelector) {
          const LOC_LABEL = { WALL: 'Wall', CEILING: 'Ceiling', END: 'Inside / End' };
          const ORDER = { WALL: 0, CEILING: 1, END: 2 };
          const locs = [...new Set((activeAssembly?.nodeClusters || []).map(c => c.location).filter(Boolean))];
          return locs.sort((a, b) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9)).map(loc => ({ id: loc, itemName: LOC_LABEL[loc] || loc }));
      }
      // Choose / Swap Style: options are the curated BOM items on the step itself.
      if (step?.type === 'STYLE_SWAP') {
          // Identify each option by optId (unique per instance) so a part repeated at
          // multiple positions stays distinct; fall back to partId for legacy flows. Also resolve the
          // underlying part's human description so the choice shows more than the bare ERP id.
          let opts = (step.styleOptions || []).filter(optCustomerOk).filter(trvOkFor(step));
          // 🎯 Per-assembly flows have NO size steps, so the size-matrix block below never runs
          // for them — the projection-tag gate (PROJ_SELECT pick / implied projection vs the
          // option's proj: tag, min-semantics for returns) must apply UNCONDITIONALLY.
          opts = opts.filter(projTagOk);
          // Size-matrix rules (Fabricut H1): french/miter returns aren't made at the 3-5/8"
          // projection (finials + inside mounts stay); size-native extras (1-3/8" wood/acrylic
          // rods, finials, wood brackets) show only at their own diameter.
          const sizeSel = sizeSelectionsOf(activeFlow, dynamicConfigParams);
          if (sizeSel) {
              const allParts = [...libraryParts, ...liveAssemblies];
              opts = opts.filter(o => {
                  const base = allParts.find(x => x.id === o.partId || x.itemId === o.partId || x.legacyErpId === o.partId
                      || (o.partName && (x.itemName === o.partName || x.legacyErpId === o.partName || x.itemId === o.partName)));
                  // Returns banned at this projection: catch modeled/fee returns (isReturnOption),
                  // return-scoped options (returnOnly — but never INSIDE_MOUNT, which shares the
                  // flag), and parts whose LIBRARY name says return (option partName is often just
                  // the bare code, e.g. H2-RBP "Mounting Base for French Return").
                  if (!returnsAllowedFor(sizeSel)) {
                      const et = String(o.endTreatment || '').toUpperCase();
                      const rtn = isReturnOption(o)
                          || (o.returnOnly && et !== 'INSIDE_MOUNT')
                          || /return|miter|mitre|french|\bbend\b/i.test(String(base?.itemName || ''));
                      if (rtn && et !== 'INSIDE_MOUNT') return false;
                  }
                  // Explicit bracket projection (1.6 proj: select, dictionary inches — legacy
                  // letters honored): the option shows only at its own projection. (projTagOk
                  // already applied unconditionally above — it must not live in this size-only block.)
                  if (!optionProjAllowed(o, sizeSel)) return false;
                  return partAllowedAtSize(base, sizeSel, sizeLabelIndex);
              });
          }
          return opts.map(o => {
              const d = optionDisplayFor(o);
              return { id: o.optId || o.partId, itemName: d.name, desc: d.desc, price: o.price };
          });
      }
      if (!step || !step.dataSource) return [];
      let options = [];

      if (step.dataSource === 'master_finishes') {
          const inHouse = globalFinishes.map(f => ({ id: f.id, itemName: f.name, finalImageUrl: f.textureUrl, code: f.code }));
          const outsource = outsourceFinishes.map(f => ({ id: f.id, itemName: f.name, finalImageUrl: f.textureUrl, multiplier: f.multiplier }));
          options = [...inHouse, ...outsource];
      } else if (globalLists.inventoryTypes?.includes(step.dataSource) || globalLists.assemblyTypes?.includes(step.dataSource) || globalLists.prodTypes?.includes(step.dataSource)) {
          const allParts = [...libraryParts, ...liveAssemblies];
          options = allParts.filter(p => p.routingType === step.dataSource || p.manufacturingSpecs?.productType === step.dataSource || p.productType === step.dataSource).map(p => ({
              id: p.id,
              itemName: p.itemName,
              finalImageUrl: p.finalImageUrl || p.manufacturingSpecs?.finalImageUrl,
              code: p.legacyErpId,
              clientPricing: p.clientPricing,
              basePrice: p.manufacturingSpecs?.basePrice
          }));
      } else {
          const customAssets = dynamicAssets.filter(a => a.windowId === step.dataSource);
          if (customAssets.length > 0) {
              options = customAssets.map(a => ({ id: a.id, itemName: a.name, finalImageUrl: a.textureUrl, code: a.code, multiplier: a.multiplier }));
          } else if (globalLists[step.dataSource]) {
              options = globalLists[step.dataSource].map(val => ({ id: val, itemName: val }));
          } else if (step.dataSource === 'master_fabrics') {
              const allParts = [...libraryParts, ...liveAssemblies];
              options = allParts.filter(p => ['TEXTILE', 'FABRIC', 'RAW MATERIAL'].includes(p.manufacturingSpecs?.productType));
          } else if (step.dataSource === 'master_trims') {
              const allParts = [...libraryParts, ...liveAssemblies];
              options = allParts.filter(p => ['TRIMMING', 'COMPONENT'].includes(p.manufacturingSpecs?.productType));
          }
      }

      if (step.allowedOptions && step.allowedOptions.length > 0) {
          return options.filter(opt => step.allowedOptions.includes(opt.id));
      }

      return options;
  };

  const handleResumeDraft = (draftId) => {
      const draft = previousDrafts.find(d => d.id === draftId);
      if (!draft) return;

      let targetFlow = null;
      if (draft.category === 'PILLOW') targetFlow = cpqFlows.find(f => (f.name || '').includes("PILLOW"));
      if (draft.category === 'LIGHTING') {
          // Vision Lighting saves no flow id — the operator picks a MASTER ASSEMBLY there, not a flow
          // (VisionLighting.js pushToCPQ), so resolve the flow through that assembly. A flow's
          // linkedAssemblyId may hold the Approved_Designs doc id OR the itemId (same tolerance the
          // BOM Engine uses), then fall back to a LIGHT-named flow. Without this branch every
          // lighting draft hit the "Cannot resume draft" alert below and was unreachable.
          const asm = liveAssemblies.find(a => a.id === draft.linkedAssemblyId || a.itemId === draft.linkedAssemblyId);
          const asmIds = new Set([draft.linkedAssemblyId, asm?.id, asm?.itemId].filter(Boolean));
          targetFlow = cpqFlows.find(f => f.id === draft.cpqFlowId || f.id === draft.flowId || f.id === draft.linkedCpqFlowId)
                    || (asmIds.size ? cpqFlows.find(f => f.linkedAssemblyId && asmIds.has(f.linkedAssemblyId)) : null)
                    || cpqFlows.find(f => (f.name || '').toUpperCase().includes("LIGHT"));
      }
      if (draft.category === 'HARDWARE' || !draft.category) {
          targetFlow = cpqFlows.find(f => f.id === draft.cpqFlowId || f.id === draft.flowId || f.id === draft.linkedCpqFlowId);
          if (!targetFlow) targetFlow = cpqFlows.find(f => (f.name || '').includes("HARDWARE"));
      }

      if (!targetFlow) return alert("Cannot resume draft: No matching CPQ flow setup for this category. The flow may have been renamed or deleted.");

      const translatedParams = {};
      const newStepQuantities = {};
      const newDimensionInputs = {};
      const engineeringNotes = draft.specs?.engineeringNotes;

      // Translate the saved draft into step params. Wrapped + null-guarded so a malformed step
      // (e.g. missing title) or a bad draft can't throw mid-handler — that used to leave the flow
      // half-loaded (modal open, step index never reset), so the Resume/Configure button looked dead.
      try {
          (Array.isArray(targetFlow.steps) ? targetFlow.steps : []).forEach(step => {
              const lowerTitle = (step.title || '').toLowerCase();
              if (draft.category === 'PILLOW') {
                  if (lowerTitle.includes("size")) translatedParams[step.id] = draft.specs?.size;
                  if (lowerTitle.includes("fill")) translatedParams[step.id] = draft.specs?.fill;
                  if (lowerTitle.includes("fabric")) translatedParams[step.id] = draft.specs?.fabrics?.[0];
                  if (lowerTitle.includes("flange") || lowerTitle.includes("edge")) translatedParams[step.id] = draft.specs?.flange;
                  if (lowerTitle.includes("trim") && draft.specs?.outerTrim?.trimId) translatedParams[step.id] = draft.specs.outerTrim.trimId;
                  if (lowerTitle.includes("stitch")) translatedParams[step.id] = draft.specs?.stitch;
                  if (lowerTitle.includes("seam") && draft.specs?.seamCount) translatedParams[step.id] = draft.specs.seamCount;
              }

              if (engineeringNotes) {
                  // Quantities default to 0 on a Vision resume. Auto-filling per-position bracket /
                  // center counts was error-prone (end vs center), so operators enter them manually
                  // using the Engineering Specs note — which still shows the recommended counts.
                  // EXCEPT selection-only steps (hideQty — end arms, L/R brackets, materials) and
                  // SIZE selectors: they have NO qty input, so a seeded 0 could never be corrected
                  // and zeroed their price/BOM/render. Left unseeded, they price at the implicit
                  // default (pin defaultQty || 1) once a selection is made.
                  if (!step.hideQty && step.type !== SIZE_STEP_TYPE && step.type !== 'PROJ_SELECT') newStepQuantities[step.id] = 0;

                  if (step.calculatorTemplate) {
                      newDimensionInputs[step.id] = {
                          type: 'O2O',
                          length: engineeringNotes.poleO2O || '',
                          wallA: engineeringNotes.pole1 || '',
                          wallB: engineeringNotes.pole2 || '',
                          wallC: engineeringNotes.pole3 || '',
                          calc_cutLength: engineeringNotes.totalPoleRawInches || engineeringNotes.poleO2O,
                      };
                  }
              }
          });

          if (draft.category === 'HARDWARE' || !draft.category) {
              // draft.specs carries the step selections plus metadata (engineeringNotes/collection/
              // bracketId) — copy only the step-keyed params so dynamicConfigParams stays clean.
              const { engineeringNotes: _en, collection: _c, bracketId: _b, ...stepParams } = draft.specs || {};
              Object.assign(translatedParams, stepParams);

              // Pre-select each choose-swap step from the Vision part selections: match a step's
              // styleOption.partId to a part Vision chose (end bracket / backplate / center bracket).
              // Config-agnostic — works for any collection's flow without hard-coded step ids.
              const eng = draft.spatialData || {};
              const visionPartIds = [eng.bracketId, eng.bracketIdRight, eng.bracketIdCenter, eng.backplateIdLeft, eng.backplateIdRight, eng.backplateIdCenter, draft.specs?.bracketId].filter(Boolean);
              // Tolerant match: a Vision id and a flow option's partId may be stored as different keys
              // (doc .id vs itemId vs legacyErpId). Resolve BOTH through the parts index and match on
              // any shared identity, so the operator's arm/backplate picks carry over (keeping O2O right).
              const partsIndex = {};
              [...libraryParts, ...liveAssemblies].forEach(p => { [p.id, p.itemId, p.legacyErpId].forEach(k => { if (k) partsIndex[k] = p; }); });
              const idSet = (id) => { const s = new Set([id]); const p = partsIndex[id]; if (p) [p.id, p.itemId, p.legacyErpId].forEach(k => k && s.add(k)); return s; };
              const visionSets = visionPartIds.map(idSet);
              const idMatchesVision = (partId) => { if (!partId) return false; const os = idSet(partId); return visionSets.some(vs => [...vs].some(x => os.has(x))); };
              (Array.isArray(targetFlow.steps) ? targetFlow.steps : []).forEach(step => {
                  if (Array.isArray(step.styleOptions) && !translatedParams[step.id]) {
                      const match = step.styleOptions.find(o => idMatchesVision(o.partId));
                      if (match) translatedParams[step.id] = match.optId;
                  }
                  // Backplate sub-chooser: pre-select the plate Vision chose for this position, so the
                  // O2O-affecting backplate isn't dropped (the operator no longer has to re-pick it).
                  if (Array.isArray(step.subOptions) && step.subOptions.length && !translatedParams[`${step.id}__sub`]) {
                      const subMatch = step.subOptions.find(o => idMatchesVision(o.partId));
                      if (subMatch) translatedParams[`${step.id}__sub`] = subMatch.optId;
                  }
                  // Center count is left at 0 (set above) — the operator enters it from the note.
                  // Tag-driven Mount step: pre-pick the Location from Vision's mount (OPEN→WALL,
                  // CEILING→CEILING, INSIDE→END), using the side this step applies to.
                  if (step.mountSelector && !translatedParams[step.id]) {
                      const MOUNT_TO_LOC = { OPEN: 'WALL', CEILING: 'CEILING', INSIDE: 'END' };
                      const vm = step.mountPosition === 'LEFT' ? (eng.shape === 'STRAIGHT' ? eng.mountLeft : eng.mountOuter)
                               : step.mountPosition === 'RIGHT' ? (eng.shape === 'STRAIGHT' ? eng.mountRight : eng.mountOuter)
                               : (eng.mountOuter || eng.mountLeft);
                      const loc = MOUNT_TO_LOC[vm];
                      if (loc) translatedParams[step.id] = loc;
                  }
              });
          }
      } catch (e) {
          console.error("Resume draft: param translation failed; opening the flow with defaults.", e);
      }

      // Apply UI state last and unconditionally so the configurator always opens at step 1, even if
      // the translation above hit a snag.
      setActiveFlowId(targetFlow.id);
      setActiveDraftId(draft.id);
      if (draft.masterQuoteId) setActiveMasterQuoteId(draft.masterQuoteId);
      setLineTag(draft.sidemark || '');
      setActiveDraftSvg(draft.specs?.engineeringNotes?.svgString || null);
      setJobData(prev => ({
          ...prev,
          customerId: draft.customerId || prev.customerId,
          jobName: draft.jobName || prev.jobName,
      }));
      setDynamicConfigParams(translatedParams);
      setStepQuantities(prev => ({ ...prev, ...newStepQuantities }));
      setDimensionInputs(prev => ({ ...prev, ...newDimensionInputs }));
      setShowCloneModal(false);
      setCurrentStepIndex(0);
  };

  // Pull an already-added cart line back INTO the configurator to edit it — the cart item retains its
  // full step selections/quantities/dimensions, so we restore them and remove it from the cart; finishing
  // the config re-adds it (a fresh line). Without this there was no way back to a line once it was added.
  const handleEditCartItem = (itemId) => {
      const item = cart.find(c => c.id === itemId);
      if (!item) return;
      if (activeFlowId && (Object.keys(dynamicConfigParams).length || currentStepIndex > 0) &&
          !window.confirm("You have a configuration in progress. Editing this cart line will replace it. Continue?")) return;
      setActiveFlowId(item.flowId || "");
      setActiveAssemblyId(item.assemblyId || "");
      if (item.masterQuoteId) setActiveMasterQuoteId(item.masterQuoteId);
      setDynamicConfigParams({ ...(item.dynamicConfigParams || {}) });
      setStepQuantities({ ...(item.stepQuantities || {}) });
      setDimensionInputs({ ...(item.dimensionInputs || {}) });
      setLineTag(!item.sidemark || item.sidemark === 'No Sidemark' ? '' : item.sidemark);
      setAssemblyQty(parseInt(item.qty) || 1);
      setActiveDraftSvg(item.draftSvg || null);
      setCurrentStepIndex(0);
      setCart(cart.filter(c => c.id !== itemId));
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Drop a single line from the cart (the Clear-All button wipes everything; this removes just one).
  const handleRemoveCartItem = (itemId) => {
      const item = cart.find(c => c.id === itemId);
      if (item && !window.confirm(`Remove "${item.assemblyName || 'this line'}"${item.sidemark ? ` [${item.sidemark}]` : ''} from the cart?`)) return;
      setCart(cart.filter(c => c.id !== itemId));
  };

  const handleDeleteDraft = async (id) => {
      if (window.confirm("Permanently delete this draft from the system?")) {
          try { await deleteDoc(doc(db, "cpq_drafts", id)); } 
          catch (err) { console.error(err); }
      }
  };

  const handleClearAllDrafts = async () => {
      if (window.confirm("⚠️ WARNING: This will permanently delete ALL abandoned drafts in the system. Are you sure?")) {
          try {
              const deletePromises = previousDrafts.map(d => deleteDoc(doc(db, "cpq_drafts", d.id)));
              await Promise.all(deletePromises);
              alert("✅ All drafts have been wiped from the system.");
          } catch(err) { console.error(err); }
      }
  };

  useEffect(() => {
      let newFlags = { disabledSteps: [], warnings: [] };

      // Flag-driven cross-step rule (runs with or without part-field cpqRules): an option flagged
      // `hidesBracket` removes the outer bracket step for its position when it's the current selection
      // — e.g. a french/bent return that wraps to the wall so there's no end bracket (center passing
      // brackets, clone/multiply, carry the pole). It is NOT automatic: the CPQ author ticks "hides
      // bracket" per option in the step editor, so a return that still needs its bracket/backplate
      // keeps the step. Disables same-position BRACKET steps (all bracket steps if the step is
      // unpositioned). Disabling clears the selection downstream → drops from price, BOM, 3D render.
      (activeFlow?.steps || []).forEach(step => {
          const sel = dynamicConfigParams[step.id];
          if (!sel) return;
          const opt = (step.styleOptions || []).find(o => (o.optId || o.partId) === sel);
          if (!opt || !opt.hidesBracket) return;
          const pos = (step.position || '').toUpperCase();
          (activeFlow?.steps || []).forEach(bs => {
              if (bs.stepRole !== 'BRACKET') return;
              if (pos && (bs.position || '').toUpperCase() !== pos) return;
              if (!newFlags.disabledSteps.includes(bs.title)) newFlags.disabledSteps.push(bs.title);
          });
      });

      // A TRAVERSE STEP THAT ONLY EXISTS FOR ONE SETUP (Stuart 2026-08-04). Every DOUBLE part is
      // tagged proj:any — only the SINGLE brackets carry 3-5/8 / 4-5/8 / 6 — so on a double the
      // Bracket Projection question has nothing to ask. The traverse generator marks that step
      // trvSetupOnly:'SINGLE' and it drops out the moment DOUBLE is chosen. Disabling rather than
      // hiding reuses the machinery already here: nav skips it and the effect below clears its
      // selection, so it leaves the price, the BOM and the render together. Pole flows never carry
      // the field, so nothing changes for them.
      if (trvSelection.setup) (activeFlow?.steps || []).forEach(step => {
          if (!step.trvSetupOnly || String(step.trvSetupOnly).toUpperCase() === trvSelection.setup) return;
          if (!newFlags.disabledSteps.includes(step.title)) newFlags.disabledSteps.push(step.title);
      });

      // AN OPTION THAT REPLACES ANOTHER STEP'S PART (Stuart 2026-08-05: the front rail can be a ring
      // on a pole instead of a track — "when selected the front track disappears and the rear track
      // stays"). Front-as-ring is a sub-choice on Single-or-Double flagged hidesStepRole:'TRACK', so
      // choosing it disables the Track step: the existing pass below clears that step, and a cleared
      // step's geometry, price and BOM line all go together. No new visibility rule needed, and no
      // front track billed on an order that does not have one.
      (activeFlow?.steps || []).forEach(step => {
          const pick = (o) => o && (o.optId || o.partId);
          const chosen = [
              (step.styleOptions || []).find(o => pick(o) === dynamicConfigParams[step.id]),
              (step.subOptions || []).find(o => pick(o) === dynamicConfigParams[`${step.id}__sub`]),
          ].filter(o => o && o.hidesStepRole);
          chosen.forEach(o => {
              const want = String(o.hidesStepRole).toUpperCase();
              (activeFlow?.steps || []).forEach(t => {
                  if (String(t.stepRole || '').toUpperCase() !== want) return;
                  if (!newFlags.disabledSteps.includes(t.title)) newFlags.disabledSteps.push(t.title);
              });
          });
      });

      const selectedItemIds = Object.values(dynamicConfigParams);

      const allParts = [...libraryParts, ...liveAssemblies];
      const flowSteps = activeFlow?.steps || [];
      // STYLE_SWAP steps store an option id (optId||partId); map it back to the underlying library
      // partId so a rule can read the SELECTED part's customData (e.g. isReturnBracket). Without this,
      // a bracket whose option id != its library doc id resolves to a stub and the rule never fires.
      // Map a STYLE_SWAP selection id (optId) to its full option. Hardware options' partId is often a
      // PROJECTED name — neither the doc id nor itemId — so to read the selected part's customData we
      // chase every link (the option's partId + partName) against every part key (id, itemId, itemName,
      // legacyErpId). Without resolving to the real part, disable-step rules silently never fire.
      const optById = {};
      flowSteps.forEach(s => (s.styleOptions || []).forEach(o => { const k = o.optId || o.partId; if (k != null && optById[k] === undefined) optById[k] = o; }));
      const normCode = (s) => String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const matchPart = (key) => {
          if (key == null || key === '') return null;
          const exact = allParts.find(p => p.id === key || p.itemId === key || p.itemName === key || p.legacyErpId === key);
          if (exact) return exact;
          // Hardware options carry a PROJECTED name that BEGINS with the source part's code, e.g.
          // "FICERA1001 CEILING BRACKET LEFT" -> FICERA (and "FICPBA…"/"FIEC…" stay distinct). The
          // projection keeps no source-id, so resolve by the longest part code that prefixes the name.
          const nk = normCode(key);
          if (nk.length < 3) return null;
          let best = null, bestLen = 0;
          allParts.forEach(p => [p.legacyErpId, p.itemId].forEach(code => {
              const nc = normCode(code);
              if (nc.length >= 3 && nk.startsWith(nc) && nc.length > bestLen) { best = p; bestLen = nc.length; }
          }));
          return best;
      };

      const selectedParts = selectedItemIds.map(id => {
          const opt = optById[id];
          return matchPart(id) || (opt && (matchPart(opt.partId) || matchPart(opt.partName))) ||
                 dynamicAssets.find(a => a.id === id) ||
                 globalFinishes.find(f => f.id === id) ||
                 outsourceFinishes.find(f => f.id === id) ||
                 { id: id, itemName: opt?.partName || id };
      });

      // Resolve a rule's disableStep value to the REAL step title(s) tolerantly (trim + case), then
      // store the real title so every downstream exact `.includes(step.title)` check still matches.
      const resolveStepTitles = (val) => {
          const want = String(val == null ? '' : val).trim().toUpperCase();
          const hits = flowSteps.filter(s => String(s.title == null ? '' : s.title).trim().toUpperCase() === want).map(s => s.title);
          return hits.length ? hits : [val];
      };

      selectedParts.forEach(part => {
          const specs = part.manufacturingSpecs || part;
          (cpqRules || []).forEach(rule => {
              const field = rule.conditionField || '';
              const testVal = field.startsWith('customData.')
                  ? specs.customData?.[field.split('.')[1]]
                  : (specs[field] ?? specs.customData?.[field] ?? part[field]);

              if (testVal !== undefined && testVal !== null) {
                  const safeTest = String(testVal).toUpperCase();
                  const safeCond = String(rule.conditionVal).toUpperCase();
                  const matched = (rule.conditionOp === 'EQUALS' && safeTest === safeCond)
                      || (rule.conditionOp === 'NOT_EQUALS' && safeTest !== safeCond)
                      || (rule.conditionOp === 'CONTAINS' && safeTest.includes(safeCond));
                  if (matched && rule.effectField === 'UI.disableStep') {
                      resolveStepTitles(rule.effectVal).forEach(t => { if (!newFlags.disabledSteps.includes(t)) newFlags.disabledSteps.push(t); });
                      const warningMsg = `⚠️ Step "${rule.effectVal}" is disabled because ${part.itemName || part.name} is ${safeCond}.`;
                      if (!newFlags.warnings.includes(warningMsg)) newFlags.warnings.push(warningMsg);
                  }
              }
          });
      });

      setEngineFlags(newFlags);
  }, [dynamicConfigParams, cpqRules, libraryParts, liveAssemblies, dynamicAssets, globalFinishes, outsourceFinishes, activeFlow, trvSelection.setup]);

  // A step disabled by a rule (e.g. an end-arm bracket that replaces a finial / miter return) must
  // contribute NOTHING — clear its selection, sub-pick, finish, and qty so it drops out of the price,
  // BOM, and 3D render (the nav handlers already skip it in the UI). disabledSteps holds step TITLES;
  // map to ids. Idempotent — re-clearing an already-clear step is a no-op, so it can't loop even
  // though it reacts (via engineFlags) to the selections it doesn't touch.
  useEffect(() => {
      const disabled = engineFlags.disabledSteps || [];
      if (!disabled.length || !activeFlow) return;
      const ids = (activeFlow.steps || []).filter(s => disabled.includes(s.title)).map(s => s.id);
      if (!ids.length) return;
      setDynamicConfigParams(prev => {
          let changed = false; const next = { ...prev };
          ids.forEach(id => [id, `${id}__sub`, `${id}__finish`].forEach(k => { if (next[k] !== undefined) { delete next[k]; changed = true; } }));
          return changed ? next : prev;
      });
      setStepQuantities(prev => {
          let changed = false; const next = { ...prev };
          ids.forEach(id => { if (next[id] !== undefined) { delete next[id]; changed = true; } });
          return changed ? next : prev;
      });
  }, [engineFlags, activeFlow]);

  // Return-aware backplate scoping: is the End Treatment at this position currently a return
  // (french/bent/mitered)? Drives which backplate sub-options show on that side's bracket step —
  // returnOnly plates while a return is chosen, regular plates otherwise. Only flows whose
  // sub-options carry returnOnly (Assembly-Builder return clusters) engage this; manual flows and
  // the hides-bracket behavior are untouched.
  // "mtr" included — the designer's miter nodes are named "34X14 MTR …"; miter carries the exact
  // same rules as the french return (same return backplates, same bracket replacement).
  const RETURN_PICK_RE = /bend|return|miter|mitre|mtr|french/i;
  const isReturnChosenForPos = (pos) => {
      if (!pos) return false;
      const p = String(pos).toUpperCase();
      return (activeFlow?.steps || []).some(s => {
          if ((s.position || '').toUpperCase() !== p || !/end treatment/i.test(s.title || '')) return false;
          const sel = dynamicConfigParams[s.id];
          if (!sel) return false;
          const o = (s.styleOptions || []).find(x => (x.optId || x.partId) === sel);
          // CANONICAL: the option's explicit endTreatment tag (stamped by the generator from the 1.6
          // per-choice select) decides directly — FRENCH/MITER return and INSIDE_MOUNT replace the
          // bracket; FINIAL never does. Name/leaf regexes below are the legacy fallback only.
          const et = String(o?.endTreatment || '').toUpperCase();
          if (et) return et === 'FRENCH_RETURN' || et === 'MITER_RETURN' || et === 'INSIDE_MOUNT';
          if (/^OPT-(BEND|MITER)/i.test(sel)) return true;
          // Geometry check uses only each node's LEAF label (after the "S5-<CLUSTER>__n_" prefix):
          // the prefix carries the cluster name, and "…RETURNS" in "LEFT-END—FINIALS-+-RETURNS" made
          // EVERY option — finials included — read as a return (greyed brackets, broken renders).
          const leaves = splitNodes(o?.targetNode).map(s => { const seg = String(s).trim().split('__').pop() || ''; return seg.replace(/^\d+_?/, ''); }).join(' ');
          return !!(o && RETURN_PICK_RE.test(`${o.partName || ''} ${o.optId || ''} ${leaves}`));
      });
  };
  // A return REPLACES the outer bracket: the bracket style pick greys out (and clears) while that
  // side's End Treatment is a return — only the (return) backplate remains to choose. Engages only on
  // steps whose sub-options carry returnOnly, so manual flows are untouched.
  const returnLocksBracket = (step) => !!(step && Array.isArray(step.subOptions) && step.subOptions.some(o => o.returnOnly) && isReturnChosenForPos(step.position));
  // The INVERSE rule (Flat Iron pattern): a selected END RETURN ARM — a bracket-step option flagged
  // isReturnArm (from the part's customData.isReturnBracket or the 1.6 end-arm checkbox), e.g. the
  // FIWERA/FICERA miter-look arms — IS the end treatment. That side's End Treatment step greys+clears
  // (no finial / inside mount with it); the arm's backplate stays choosable unless the arm is basic.
  const isArmChosenForPos = (pos) => {
      if (!pos) return false;
      const p = String(pos).toUpperCase();
      return (activeFlow?.steps || []).some(s => {
          if ((s.position || '').toUpperCase() !== p) return false;
          if (!(s.stepRole === 'BRACKET' || /bracket/i.test(s.title || '')) || /end treatment/i.test(s.title || '')) return false;
          const sel = dynamicConfigParams[s.id];
          const o = sel && (s.styleOptions || []).find(x => (x.optId || x.partId) === sel);
          return !!(o && o.isReturnArm);
      });
  };
  const armLocksEnd = (step) => !!(step && /end treatment/i.test(step.title || '') && isArmChosenForPos(step.position));
  // MULTI-MATERIAL POLE: the Length step must NOT show a finish grid of its own (Stuart
  // 2026-07-31: "on step 1 if i choose the wood rod and finish, then on step two for length it
  // shows the metal finishes? step 2 is a cpq flow step for dimensional only"). The pricing path
  // already reads the pole's finish from the MATERIAL step — the Length step prices the pole
  // chosen there × footage — so a second grid here is not just noise: it offers the WRONG set
  // (step-level, unscoped → the metal list) alongside the wood finish already chosen upstream.
  // Mirrors the pricing condition exactly: calculator/DIMENSIONS step, no linked item, no
  // selection of its own, and a Pole/Rod Material step present in the flow.
  // VISUAL_DIMENSIONS is deliberately EXEMPT — single-material flows fold the finish INTO that
  // step ("Pole Length & Finish"), where it is the only place to choose one.
  const poleFinishLivesOnMaterialStep = (step) => {
      if (!step || step.type === 'VISUAL_DIMENSIONS') return false;
      if (!(step.calculatorTemplate || step.type === 'DIMENSIONS')) return false;
      if (step.linkedItemId || dynamicConfigParams[step.id]) return false;
      return (activeFlow?.steps || []).some(s => s.type === 'STYLE_SWAP' && /pole.*material|rod material/i.test(s.title || ''));
  };
  // Basic brackets take no backplate: when the selected bracket is flagged isBasic (the explicit
  // per-option checkbox in the Assembly Builder assign tool — foolproof) or is literally named
  // "Basic …" (fallback for hand-authored options), the backplate pick greys out and stays None.
  const basicNoBackplate = (step) => {
      const sel = dynamicConfigParams[step?.id];
      const o = sel && (step.styleOptions || []).find(x => (x.optId || x.partId) === sel);
      return !!(o && (o.isBasic || /basic/i.test(o.partName || '')));
  };
  // Keep selections consistent with the rules above: a return clears the bracket style; a mode flip
  // (return ↔ not) clears a backplate from the other mode; a basic bracket clears any backplate.
  useEffect(() => {
      if (!activeFlow) return;
      setDynamicConfigParams(prev => {
          let changed = false; const next = { ...prev };
          (activeFlow.steps || []).forEach(s => {
              // End return arm chosen at this position → the End Treatment selection clears.
              if (/end treatment/i.test(s.title || '') && next[s.id] && isArmChosenForPos(s.position)) { delete next[s.id]; changed = true; }
              if (!Array.isArray(s.subOptions) || !s.subOptions.length) return;
              const hasReturnOnly = s.subOptions.some(o => o.returnOnly);
              const retn = hasReturnOnly && isReturnChosenForPos(s.position);
              if (retn && next[s.id]) { delete next[s.id]; changed = true; }
              // Plate scoping follows the CURRENT bracket too: a usesReturnPlates bracket (In Line)
              // wants the return plates even with no return chosen on that end.
              const mainOpt = next[s.id] && (s.styleOptions || []).find(x => (x.optId || x.partId) === next[s.id]);
              // Pool-membership clearing (3 pools: return / inline / regular — see the sub-picker).
              const returnChosen2 = retn || !!(mainOpt && mainOpt.isReturnArm);
              const inlineBracket2 = !!(mainOpt && mainOpt.usesReturnPlates);
              const sel = next[`${s.id}__sub`];
              if (sel && (s.subOptions.some(o => o.returnOnly || o.inlineOnly))) {
                  const hasInl2 = s.subOptions.some(o => o.inlineOnly);
                  const o = s.subOptions.find(x => (x.optId || x.partId) === sel);
                  // Same size-aware fallback as the picker: no returnOnly plate at this diameter →
                  // a return runs on the STANDARD plates, so a standard pick must NOT clear.
                  const sizeSel2 = sizeSelectionsOf(activeFlow, dynamicConfigParams);
                  const sizeOk2 = (x) => {
                      if (!projTagOk(x)) return false;
                      if (!sizeSel2) return true;
                      const ap = [...libraryParts, ...liveAssemblies];
                      if (!optionProjAllowed(x, sizeSel2)) return false;
                      return partAllowedAtSize(
                          ap.find(y => y.id === x.partId || y.itemId === x.partId || y.legacyErpId === x.partId
                              || (x.partName && (y.itemName === x.partName || y.legacyErpId === x.partName || y.itemId === x.partName))),
                          sizeSel2, sizeLabelIndex);
                  };
                  // MUST be measured over the SAME candidate list the picker offers, or the two
                  // disagree and the effect deletes a selection the picker just showed (Stuart
                  // 2026-07-31: Flat Iron ceiling arm, right side — "as soon as we select one it
                  // appears for a second then disappears and blanks out"). The picker narrows to the
                  // bracket's own location (and customer) FIRST and asks "is a return plate live
                  // HERE?"; this asked "is one live ANYWHERE". With FICERA (an end-return arm, so
                  // returnChosen) and no size-passing return plate on the right, the picker correctly
                  // fell back to the regular pool and listed the right-side plates — then this line
                  // saw a return plate on the LEFT, demanded o.returnOnly, and cleared the pick.
                  const selLoc2 = mainOpt && mainOpt.location;
                  const cand2 = s.subOptions.filter(optCustomerOk).filter(x => !selLoc2 || !x.location || x.location === selLoc2);
                  const retPoolLive2 = cand2.some(x => x.returnOnly && sizeOk2(x));
                  const inPool = o && (returnChosen2 ? (retPoolLive2 ? o.returnOnly : (!o.returnOnly && !o.inlineOnly))
                      : inlineBracket2 ? (hasInl2 ? o.inlineOnly : o.returnOnly)
                      : (!o.returnOnly && !o.inlineOnly));
                  if (o && !inPool) { delete next[`${s.id}__sub`]; changed = true; }
              }
              if (mainOpt && (mainOpt.isBasic || /basic/i.test(mainOpt.partName || '')) && next[`${s.id}__sub`]) { delete next[`${s.id}__sub`]; changed = true; }
          });
          return changed ? next : prev;
      });
  }, [dynamicConfigParams, activeFlow]); // eslint-disable-line react-hooks/exhaustive-deps

  // CUSTOMER-ONLY options (1.6 cust gate): an option carrying customerIds is visible only while
  // one of those customers is selected on the quote — unrestricted options (poles, rings, common
  // parts) show for everyone. The portal applies the same rule server-side for its customer.
  const optCustomerOk = (o) => {
      if (!(Array.isArray(o?.customerIds) && o.customerIds.length)) return true;
      if (!jobData.customerId) return false; // restricted option, no customer picked yet
      const rec = liveCustomers.find(c => c.id === jobData.customerId);
      const keys = new Set([jobData.customerId, rec?.name, rec?.companyName].filter(Boolean).map(s => String(s).trim().toUpperCase()));
      return o.customerIds.some(id => keys.has(String(id || '').trim().toUpperCase()));
  };

  const handleDimensionChange = (stepId, key, value, template) => {
      setDimensionInputs(prev => {
          const current = prev[stepId] || { length: '', type: 'O2O', wallA: '', wallB: '', wallC: '' };
          const updated = { ...current, [key]: value };
          
          let calculatedQty = 1;
          let cutLength = 0;
          let o2o = 0;
          let c2c = 0;
          
          if (template === 'calc_french_return_1in') {
              let baseLength = parseFloat(updated.length) || 0;
              
              if (updated.type === 'C2C') {
                  c2c = baseLength;
                  o2o = baseLength + 1; 
              } else {
                  o2o = baseLength;
                  c2c = baseLength - 1; 
              }
              
              cutLength = o2o + 17; 
              calculatedQty = Math.max(1, Math.ceil(cutLength / 12)); 
              
              updated.calc_o2o = o2o;
              updated.calc_c2c = c2c;
              updated.calc_cutLength = cutLength;

          } else if (template === 'calc_straight_pole') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil(baseLength / 12));
              updated.calc_cutLength = baseLength;

          } else if (template === 'calc_mitered_bay') {
              let a = parseFloat(updated.wallA) || 0;
              let b = parseFloat(updated.wallB) || 0;
              let c = parseFloat(updated.wallC) || 0;
              calculatedQty = Math.max(1, Math.ceil((a + b + c + 12) / 12)); 
              updated.calc_cutLength = a + b + c + 12; 

          } else if (template === 'calc_curved_bay') {
              let baseLength = parseFloat(updated.length) || 0;
              calculatedQty = Math.max(1, Math.ceil((baseLength + 12) / 12)); 
              updated.calc_cutLength = baseLength + 12;
          }

          if (value !== '') {
              setStepQuantities(sq => ({...sq, [stepId]: calculatedQty}));
          }
          
          return { ...prev, [stepId]: updated };
      });
  };

  useEffect(() => {
      if (!activeFlow) {
          // No flow = no quote: zero the panel. Returning without clearing left the LAST
          // computuation on screen after Clear All / flow deselect — a "$120 ghost" with
          // nothing selected.
          setPricing({ base: 0, finalPrice: 0 });
          setPricingBreakdown([]);
          return;
      }

      let breakdown = [];
      let baseAssemblyPrice = activeAssembly?.manufacturingSpecs?.basePrice ? parseFloat(activeAssembly.manufacturingSpecs.basePrice) : 0;
      if (!activeAssembly && activeFlow.basePrice) baseAssemblyPrice = parseFloat(activeFlow.basePrice);

      if (baseAssemblyPrice > 0) {
          breakdown.push({
              name: activeAssembly ? activeAssembly.itemName : activeFlow.name,
              qty: 1, price: baseAssemblyPrice, total: baseAssemblyPrice,
              partHandling: activeAssembly?.manufacturingSpecs?.partHandling || activeFlow.partHandling || '',
              partId: activeAssembly?.id || null,
              legacyErpId: activeAssembly?.legacyErpId || activeAssembly?.itemId || null
          });
      }

      let total = baseAssemblyPrice;
      const allParts = [...libraryParts, ...liveAssemblies];

      // Finish → item-variant resolver. The mill base item ("H1-75RBP-V", no slash) usually carries
      // no price; the sellable SKU is finish-specific: paints (P01, P02, …) share ONE "/P" item,
      // EP finishes are stocked as exact "/EP5" items, other codes may have exact "/<CODE>" SKUs.
      // Try exact first, then the "/P" paint rollup, else stay on the base.
      const byCode = new Map();
      allParts.forEach(p => { [p.legacyErpId, p.itemId].forEach(c => { const k = String(c || '').trim().toUpperCase(); if (k && k !== 'PENDING' && !byCode.has(k)) byCode.set(k, p); }); });
      // UPPERCASE code → base doc, for fabricutPriceOf's variant-inherits-base-tiers fallback.
      const fabFindByCode = (c) => byCode.get(String(c || '').trim().toUpperCase()) || null;
      const finishVariantOf = (basePart, finishCode) => {
          if (!basePart || !finishCode) return basePart;
          const baseCode = String((basePart.legacyErpId && basePart.legacyErpId !== 'PENDING' ? basePart.legacyErpId : basePart.itemId) || '').trim().toUpperCase();
          if (!baseCode || baseCode.includes('/')) return basePart; // already a finished variant
          const fc = String(finishCode).trim().toUpperCase();
          const cands = [`${baseCode}/${fc}`];
          if (/^P\d/.test(fc)) cands.push(`${baseCode}/P`);
          // Generic plated doc: fee items carry ONE /EP record (painted $X vs plated $Y) instead
          // of six /EP1..6 — the exact stocked /EPn still wins for real parts when it exists.
          if (/^EP\d/.test(fc)) cands.push(`${baseCode}/EP`);
          for (const cand of cands) { const hit = byCode.get(cand); if (hit) return hit; }
          return basePart;
      };
      const finishObjForStep = (stepId) => {
          const fid = dynamicConfigParams[`${stepId}__finish`];
          if (!fid) return null;
          return globalFinishes.find(x => x.id === fid) || outsourceFinishes.find(x => x.id === fid) || null;
      };
      const finishCodeForStep = (stepId) => {
          const f = finishObjForStep(stepId);
          return f ? String(f.code || f.name || '').toUpperCase() : '';
      };
      // Finish-driven species: a finish with bomSuffix consumes the per-species item (-O/-W).
      const speciesSwap = (part, finishObj) => speciesVariantOf(part, finishObj, (c) => byCode.get(c) || null);
      // Quote-line naming per level (Stuart 2026-07-11): fees = plain description only (CE-FEE ids
      // are app-internal, never printed); FAB COST = our id — description · Fabricut pattern id;
      // FAB WHOLESALE / RETAIL = the Fabricut pattern id alone (their catalog language); STANDARD
      // keeps the description as today.
      const isFeePart = (p, opt) => !!(opt?.isFee || p?.partClass === 'Fee' || String(p?.manufacturingSpecs?.productType || '').toUpperCase() === 'FEE');
      const lineNameFor = (p, opt) => {
          const desc = p?.itemName || p?.name || opt?.partName || '';
          if (isFeePart(p, opt)) return desc;
          if (priceLevel === 'FAB_WHOLESALE' || priceLevel === 'FAB_RETAIL') {
              return fabricutCodeOf(p, (c) => byCode.get(c) || null, outsourceFinishes) || desc;
          }
          if (priceLevel === 'FAB_COST') {
              const our = p?.legacyErpId && p.legacyErpId !== 'PENDING' ? p.legacyErpId : (p?.itemId || '');
              const fc = fabricutCodeOf(p, (c) => byCode.get(c) || null, outsourceFinishes);
              return `${our || desc}${our && desc ? ' — ' + desc : ''}${fc ? ' · ' + fc : ''}`;
          }
          return desc;
      };
      // SIZE-MATRIX (Fabricut H1): resolve every configured part to the selected Rod Diameter /
      // Projection variant BEFORE finish resolution — identity chain: base → size → finish
      // (H1-75BE → H1-1B6 → H1-1B6/EP2). Flows without SIZE steps degrade to identity.
      const sizeBundle = makeSizeSwap(activeFlow, dynamicConfigParams, allParts);
      // Client pricing lookup. Entries may store the customer's ID or (older Library-editor entries)
      // the NAME — match both. cp.price is the "Client Cost" field = what THIS client pays us; only a
      // real value (>0) applies, so an empty/zero entry can never zero out a line.
      // Tolerant part resolution (same approach as the rules engine + ERP push): exact
      // id/itemId/ERP first, then longest ERP-code PREFIX — hardware options can carry a PROJECTED
      // name ("FICERA1001 CEILING BRACKET LEFT") that only BEGINS with the real code; exact-only
      // matching left those options unpriced while identical siblings priced fine.
      const findLibPart = (key) => {
          if (!key) return null;
          const exact = allParts.find(p => p.id === key || p.itemId === key || p.legacyErpId === key);
          if (exact) return exact;
          const nk = String(key).toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (nk.length < 3) return null;
          let best = null, bestLen = 0;
          allParts.forEach(p => [p.legacyErpId, p.itemId].forEach(code => {
              const nc = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
              if (nc.length >= 3 && nk.startsWith(nc) && nc.length > bestLen) { best = p; bestLen = nc.length; }
          }));
          return best;
      };
      const custRec = jobData.customerId ? liveCustomers.find(c => c.id === jobData.customerId) : null;
      const custKeys = customerKeys(jobData.customerId, custRec);
      const clientPriceOf = (part) => (jobData.customerId && part) ? clientPriceFor(part.clientPricing, custKeys) : null;

      (activeFlow.steps || []).forEach(step => {
          const selectedValue = dynamicConfigParams[step.id];
          // CUSTOM WORK on this step: overrules the library routing for everything it emits, and
          // adds its own priced fee line. The fee item's Part Handling is the destination floor.
          // Declared at STEP scope on purpose: the priced-line block below closes before the plate
          // sub-line is built, so a capture inside it would be out of scope exactly where the plate
          // needs to ask "does my arm cover me?".
          let resolvedArmPart = null;
          const ovr = customOverrides[step.id];
          const ovrActive = !!(ovr && ovr.feeItemId && ovr.handling);
          const ovrHandling = ovrActive ? ovr.handling : null;

          // SIZE steps are selectors, not products: emit an informational $0 quote line naming the
          // chosen size (so the quote reads "Rod Diameter: 1" Round Rod"), never a part or price.
          if (step.type === SIZE_STEP_TYPE || step.type === 'PROJ_SELECT') {
              const sizeOpt = (step.styleOptions || []).find(o => o.optId === selectedValue);
              if (sizeOpt) breakdown.push({ name: `${step.title}: ${sizeOpt.partName}`, qty: 1, price: 0, total: 0, partHandling: '', partId: null, legacyErpId: null, isSizeRow: true });   // display only — never work (Shared/lineClassification.isDisplayOnlyLine)
              return;
          }

          let rawQty = stepQuantities[step.id];
          let qty = 1;
          if (rawQty !== undefined && rawQty !== '') {
              qty = parseInt(rawQty) || 0;
          } else {
              qty = activeBomPins.find(p => p.partId === step.linkedPinId)?.defaultQty || 1;
          }
          // Selection-only steps (hideQty) have no qty input — a stored 0 (old Vision resumes
          // seeded every step to 0) could never be corrected by the operator, so a made selection
          // prices at the implicit default instead of zeroing out.
          if (step.hideQty && qty === 0 && selectedValue) {
              qty = activeBomPins.find(p => p.partId === step.linkedPinId)?.defaultQty || 1;
          }

          const hasBasePrice = step.basePrice !== undefined && step.basePrice !== null && step.basePrice !== '';

          if (selectedValue || step.type === 'DIMENSIONS' || step.type === 'STATIC_FEE' || hasBasePrice) {
              
              let stepPrice = hasBasePrice ? parseFloat(step.basePrice) : 0;
              
              if (step.linkedItemId && step.useClientPricing) {
                  const basePartObj = findLibPart(step.linkedItemId);
                  const v = clientPriceOf(basePartObj);
                  if (v != null) stepPrice = v;
              }

              let multiplier = 1.0;
              let wmPair = null; // 🔩 wall-mount pairing off the resolved plate part (partObj is block-scoped below)
              let itemName = step.title;
              // Fee/labor lines are excluded from the trade-discount base (items only).
              let lineIsFee = step.type === 'STATIC_FEE';
              // For STYLE_SWAP the selected value is the per-instance optId, not the part id.
              // Resolve the real part id so the part lookup, line item, and ERP push are correct.
              let resolvedPartId = selectedValue;
              let resolvedErpId = null; // NetSuite item # for this line, baked on so it flows downstream
              // The resolved ITEM's Part Handling — the routing truth (Shared/lineClassification).
              // Captured alongside the erp id wherever the part is finalised, because partObj is
              // block-scoped and the breakdown push happens outside that block.
              let resolvedHandling = null;

              if (selectedValue) {
                  const styleOpt = step.type === 'STYLE_SWAP' ? (step.styleOptions || []).find(o => (o.optId || o.partId) === selectedValue) : null;
                  resolvedPartId = styleOpt ? (styleOpt.partId || selectedValue) : selectedValue;

                  let partObj = allParts.find(p => p.id === resolvedPartId || p.itemId === resolvedPartId || p.legacyErpId === resolvedPartId) ||
                                  dynamicAssets.find(a => a.id === resolvedPartId) ||
                                  globalFinishes.find(f => f.id === resolvedPartId) ||
                                  outsourceFinishes.find(f => f.id === resolvedPartId) ||
                                  findLibPart(resolvedPartId) ||
                                  (styleOpt ? findLibPart(styleOpt.partName) : null);

                  // Swap to the selected SIZE's part first (H1-75BE → H1-1B6) so the finish variant
                  // below rides the sized base and the final SKU is e.g. H1-1B6/EP2.
                  const preSizeObj = partObj;
                  if (partObj) {
                      const sizedPart = sizeBundle.swap(partObj);
                      if (sizedPart !== partObj) { partObj = sizedPart; resolvedPartId = sizedPart.itemId || sizedPart.id; }
                  }
                  const sizeSwapped = partObj !== preSizeObj;

                  // Species next (wood/acrylic): the finish's bomSuffix picks the -O/-W item.
                  if (partObj) {
                      const speciesPart = speciesSwap(partObj, finishObjForStep(step.id));
                      if (speciesPart !== partObj) { partObj = speciesPart; resolvedPartId = speciesPart.itemId || speciesPart.id; }
                  }

                  // Swap to the finish-specific SKU (…/P for paints, exact …/EPn for stocked EP) so the
                  // BOM identity AND the price come from the item that's actually sold. Keep the
                  // pre-variant part: client pricing is usually entered on the BASE item.
                  const preVariantObj = partObj;
                  if (partObj && (partObj.legacyErpId || partObj.itemId)) {
                      const variant = finishVariantOf(partObj, finishCodeForStep(step.id));
                      if (variant !== partObj) { partObj = variant; resolvedPartId = variant.itemId || variant.id; }
                  }

                  resolvedErpId = partObj?.legacyErpId || partObj?.itemId || styleOpt?.legacyErpId || null;
                  resolvedHandling = partObj?.manufacturingSpecs?.partHandling || null;
                  resolvedArmPart = partObj || null;
                  if (isFeePart(partObj, styleOpt)) lineIsFee = true;

                  if (partObj) itemName = `${step.title} (${lineNameFor(partObj, styleOpt)})`;
                  else if (styleOpt) itemName = `${step.title} (${styleOpt.partName})`;

                  let optionNativePrice = 0;
                  if (partObj) {
                      if (partObj.manufacturingSpecs?.basePrice) optionNativePrice = parseFloat(partObj.manufacturingSpecs.basePrice);
                      else if (partObj.basePrice) optionNativePrice = parseFloat(partObj.basePrice);
                  }
                  // Finish-variant docs can be identity-only (M2C prices the BASE item; CE prices the
                  // variants) — an unpriced variant falls back to the base item's price instead of $0.
                  if (!optionNativePrice && preVariantObj && preVariantObj !== partObj) {
                      optionNativePrice = parseFloat(preVariantObj.manufacturingSpecs?.basePrice ?? preVariantObj.basePrice) || 0;
                  }

                  // Choose / Swap Style: an author-set option price OVERRIDES the item price — but only a
                  // real one. Generated options default to 0, and letting that 0 win is what blanked out
                  // all base pricing; 0/blank now means "price from the (finish-variant) item".
                  // Never when the size matrix swapped the part: author prices were entered for the
                  // BASE size (3/4" × 4-5/8") — the sized item's own price is the correct one.
                  if (styleOpt && styleOpt.price !== undefined && styleOpt.price !== '' && parseFloat(styleOpt.price) > 0 && !sizeSwapped) optionNativePrice = parseFloat(styleOpt.price) || 0;

                  // Pole "Length & Finish" steps: the selection is the FINISH; the physical item is the
                  // step's linkedItemId (stamped by the generator). Identity always follows the finish
                  // variant (BOM/push correctness); its base price applies only when nothing else —
                  // client price on the linked item, step base — has priced the step yet.
                  if (step.linkedItemId) {
                      const linkedSized = sizeBundle.swap(findLibPart(step.linkedItemId));
                      if (linkedSized) {
                          const selFinish = globalFinishes.find(f => f.id === selectedValue) || outsourceFinishes.find(f => f.id === selectedValue);
                          const fc = selFinish ? String(selFinish.code || selFinish.name || '').toUpperCase() : finishCodeForStep(step.id);
                          // On pole steps the SELECTION is the finish — species rides it (wood pole → oak/walnut item).
                          const linkedBase = speciesSwap(linkedSized, selFinish || finishObjForStep(step.id));
                          const linkedPart = finishVariantOf(linkedBase, fc);
                          const fabLp = priceLevel !== 'STANDARD' ? fabricutPriceOf(linkedPart, priceLevel, fc, outsourceFinishes, fabFindByCode) : null;
                          // Variant unpriced → base item price (M2C prices the base, CE the variant).
                          const lp = fabLp != null ? fabLp : (parseFloat(linkedPart.manufacturingSpecs?.basePrice ?? linkedPart.basePrice) || parseFloat(linkedBase.manufacturingSpecs?.basePrice ?? linkedBase.basePrice) || 0);
                          if (optionNativePrice === 0 && stepPrice === 0 && lp > 0) optionNativePrice = lp;
                          resolvedPartId = linkedPart.itemId || linkedPart.id;
                          resolvedErpId = linkedPart.legacyErpId || linkedPart.itemId || resolvedErpId;
                          resolvedHandling = linkedPart.manufacturingSpecs?.partHandling || resolvedHandling;
                          itemName = `${step.title} (${lineNameFor(linkedPart, null)})`;
                      }
                  }

                  if (step.useClientPricing) {
                      const v = clientPriceOf(partObj) ?? clientPriceOf(preVariantObj);
                      if (v != null) optionNativePrice = v;
                  }

                  // PRICE LEVEL: at a Fabricut level, an item carrying imported Fabricut pricing
                  // quotes EXACTLY per the sheet — overriding item/author/client pricing (BP plates
                  // = explicit $0, included in the arm). Fees and non-Fabricut items fall through
                  // untouched, so the quote is a faithful mix.
                  if (priceLevel !== 'STANDARD') {
                      const fp = fabricutPriceOf(partObj, priceLevel, finishCodeForStep(step.id), outsourceFinishes, fabFindByCode);
                      if (fp != null) optionNativePrice = fp;
                  }

                  let upcharge = 0;
                  if (step.priceMap && step.priceMap[selectedValue]) {
                      upcharge = parseFloat(step.priceMap[selectedValue]) || 0;
                  }

                  // MULTI-MATERIAL POLE: the material step is IDENTITY only — the Length/calculator
                  // step prices the chosen pole × footage (below), so pricing it here too would
                  // double-count. Single-material flows have no material step, nothing changes.
                  if (step.type === 'STYLE_SWAP' && /pole.*material|rod material/i.test(step.title || '') && (activeFlow.steps || []).some(s => s.calculatorTemplate)) {
                      optionNativePrice = 0; upcharge = 0;
                  }

                  stepPrice += optionNativePrice + upcharge;

                  if (partObj && partObj.multiplier && parseFloat(partObj.multiplier) > 1.0) {
                      multiplier = parseFloat(partObj.multiplier);
                  }
                  // 🔩 Backplate/cover-plate wall-mount pairing: finish variants don't carry it, so
                  // fall back to the pre-variant (sized base) doc. Emitted after the main line below.
                  wmPair = partObj?.manufacturingSpecs?.wallMount || preVariantObj?.manufacturingSpecs?.wallMount || null;
                  if (wmPair && !wmPair.partId) wmPair = null;
              }

              // MULTI-MATERIAL POLE PRICING: a Length step (calculator, no linked item, no own
              // selection) prices the pole chosen on the "Pole / Rod Material" step × the
              // calculated footage — full identity chain (size → species → finish) so the line
              // carries the real SKU for BOM/push. Restores Flat Iron's per-foot pole pricing and
              // covers Fabricut the moment it gains wood/acrylic materials.
              if (!selectedValue && step.calculatorTemplate && !step.linkedItemId) {
                  const matStep = (activeFlow.steps || []).find(s => s.type === 'STYLE_SWAP' && /pole.*material|rod material/i.test(s.title || ''));
                  const matSel = matStep ? dynamicConfigParams[matStep.id] : null;
                  const matOpt = matSel ? (matStep.styleOptions || []).find(o => (o.optId || o.partId) === matSel) : null;
                  if (matOpt) {
                      let polePart = findLibPart(matOpt.partId) || findLibPart(matOpt.partName);
                      polePart = speciesSwap(sizeBundle.swap(polePart), finishObjForStep(matStep.id));
                      const poleFinished = polePart ? finishVariantOf(polePart, finishCodeForStep(matStep.id)) : null;
                      if (poleFinished) {
                          let pp = parseFloat(poleFinished.manufacturingSpecs?.basePrice ?? poleFinished.basePrice) || 0;
                          // Unpriced finish variant → the base pole item's price (M2C prices the base);
                          // still nothing → the material option's own authored per-foot price.
                          if (!pp && polePart) pp = parseFloat(polePart.manufacturingSpecs?.basePrice ?? polePart.basePrice) || 0;
                          if (!pp && matOpt.price !== undefined && matOpt.price !== '') pp = parseFloat(matOpt.price) || 0;
                          if (matStep.useClientPricing) { const cv = clientPriceOf(poleFinished) ?? clientPriceOf(polePart); if (cv != null) pp = cv; }
                          if (priceLevel !== 'STANDARD') { const fp = fabricutPriceOf(poleFinished, priceLevel, finishCodeForStep(matStep.id), outsourceFinishes, fabFindByCode); if (fp != null) pp = fp; }
                          if (stepPrice === 0 && pp > 0) stepPrice = pp;
                          resolvedPartId = poleFinished.itemId || poleFinished.id;
                          resolvedErpId = poleFinished.legacyErpId || poleFinished.itemId || null;
                          resolvedHandling = poleFinished.manufacturingSpecs?.partHandling || resolvedHandling;
                          itemName = `${step.title} (${lineNameFor(poleFinished, null)})`;
                      }
                  }
              }

              if (step.priceOverride !== undefined && step.priceOverride !== "") {
                  stepPrice = parseFloat(step.priceOverride);
              }
              
              let lineTotal = stepPrice * multiplier * qty;
              
              // Emit a BOM line for any selected PHYSICAL part even at $0 — every part step
              // carries a partHandling routing flag (fees don't), so an unpriced bracket/ring
              // still flows to the BOM, finishing, and packaging instead of silently dropping.
              if (lineTotal > 0 || stepPrice > 0 || step.type === 'STATIC_FEE' || (selectedValue && (step.partHandling || resolvedHandling))) {
                  // Carry the generated cut geometry (from Vision -> dimensionInputs) onto
                  // dimension-driven lines so the shop work order gets a cutLength and the
                  // fin work order gets dimensions. See WORK_ORDER_CONTRACT.md §6/§7.
                  const dimInput = dimensionInputs[step.id];
                  const cutLength = dimInput ? (dimInput.calc_cutLength || dimInput.length || null) : null;
                  breakdown.push({
                      name: itemName, qty: qty, price: stepPrice * multiplier, total: lineTotal,
                      isFee: lineIsFee,
                      // The ITEM's Part Handling is the routing truth (see Shared/lineClassification);
                      // the step's flag is only the fallback when no part resolved.
                      partHandling: ovrHandling || resolvedHandling || step.partHandling || '',
                      ...(ovrActive ? { customOverrideHandling: ovrHandling, customNote: ovr.notes || '', customFee: ovr.feeName || '' } : {}),
                      partId: resolvedPartId || step.linkedItemId || null,
                      legacyErpId: resolvedErpId,
                      cutLength: cutLength,
                      dimensions: dimInput ? { length: dimInput.length || null, wallA: dimInput.wallA || null, wallB: dimInput.wallB || null, wallC: dimInput.wallC || null } : null
                  });
                  // 🔩 Paired wall mount: one per plate, priced like any BOM item (usually $0 hardware).
                  if (wmPair) {
                      const wmPart = findLibPart(wmPair.partId);
                      const wmPrice = wmPart ? (parseFloat(wmPart.manufacturingSpecs?.basePrice ?? wmPart.basePrice) || 0) : 0;
                      breakdown.push({
                          name: `Wall Mount — ${wmPair.desc || wmPair.partId}`,
                          qty: qty, price: wmPrice, total: wmPrice * qty,
                          partHandling: wmPart?.manufacturingSpecs?.partHandling || step.partHandling || '',
                          partId: wmPart?.itemId || wmPart?.id || wmPair.partId,
                          legacyErpId: wmPart?.legacyErpId || wmPart?.itemId || wmPair.partId
                      });
                      total += wmPrice * qty;
                  }
              }

              total += lineTotal;
          }

          // Secondary chooser (backplate) is its OWN priced BOM line, with the same finish-variant
          // swap (the plate shares the bracket step's finish). Deliberately outside the main gate:
          // on a return the bracket selection is cleared but the return backplate stays selected.
          const subSel = dynamicConfigParams[`${step.id}__sub`];
          if (subSel && Array.isArray(step.subOptions)) {
              const subOpt = step.subOptions.find(o => (o.optId || o.partId) === subSel);
              if (subOpt) {
                  // A SUB-CHOICE MAY BE COUNTED SEPARATELY FROM ITS STEP (Stuart 2026-08-05: the
                  // front-rail ring needs "a qty field to attach for pricing and bom"). Sub-lines
                  // inherited the step's quantity, which cannot serve both here: the DOUBLE answer
                  // bills a track per foot while the ring beside it is billed by the piece. Stored
                  // under `<stepId>__sub`, which the ERP push already reads as its own line.
                  const rawSubQty = stepQuantities[`${step.id}__sub`];
                  const subQty = subOpt.needsQty
                      ? ((rawSubQty === undefined || rawSubQty === '') ? 1 : (parseInt(rawSubQty) || 0))
                      : qty;
                  // Same identity chain as main lines: base → size → finish. At 1"/1-3/8" the return
                  // plates (RBP/RCP) resolve to the STANDARD plates — geometry unchanged, item swapped.
                  const subBase0 = findLibPart(subOpt.partId) || findLibPart(subOpt.partName);
                  const subBase = speciesSwap(sizeBundle.swap(subBase0), finishObjForStep(step.id));
                  const subSizeSwapped = subBase !== subBase0;
                  const subPart = subBase ? finishVariantOf(subBase, finishCodeForStep(step.id)) : null;
                  let subPrice = (subOpt.price !== undefined && subOpt.price !== '' && parseFloat(subOpt.price) > 0 && !subSizeSwapped)
                      ? parseFloat(subOpt.price)
                      : (subPart ? (parseFloat(subPart.manufacturingSpecs?.basePrice ?? subPart.basePrice) || 0) : 0);
                  if (step.useClientPricing) {
                      const v = clientPriceOf(subPart) ?? clientPriceOf(subBase);
                      if (v != null) subPrice = v;
                  }
                  // PLATE ASSOCIATION (Stuart 2026-08-03) — applies at EVERY price level, which is the
                  // gap: the arm has always included its backplate, but that only showed up in the
                  // quote at the Fabricut levels below, so on our own pricing the plate billed in
                  // full. Opt-in per item, so a plate with no declared role is untouched.
                  // `hasParent` = something on this step is including the plate: the bracket arm, or
                  // a french/miter return, which REPLACES the arm and carries the plate itself.
                  let plateNote = '';
                  const plateHasParent = !!selectedValue || returnLocksBracket(step) || isReturnChosenForPos(step.position);
                  // WHICH item is doing the including — the arm chosen on this step, or (when a
                  // return has replaced the arm) the return fee itself. It is passed so an item can
                  // say it does NOT cover its plate, and so the quote line can name what covers it.
                  const plateParent = (() => {
                      if (selectedValue) return resolvedArmPart;
                      const rp = (activeFlow?.steps || []).find(st => (st.position || '').toUpperCase() === String(step.position || '').toUpperCase() && /end treatment/i.test(st.title || ''));
                      const rsel = rp && dynamicConfigParams[rp.id];
                      const ropt = rsel && (rp.styleOptions || []).find(x => (x.optId || x.partId) === rsel);
                      return ropt ? (findLibPart(ropt.partId) || findLibPart(ropt.partName)) : null;
                  })();
                  const pp = platePrice({
                      plate: subPart || subBase, baseDoc: subBase || subBase0, normalPrice: subPrice,
                      hasParent: plateHasParent, parentPart: plateParent, finishCode: finishCodeForStep(step.id),
                      outsourceCodes: outsourceFinishes, findByCode: findLibPart
                  });
                  if (pp) { subPrice = pp.price; plateNote = pp.note; }
                  // Price level on plate sub-lines: BP → $0 (in the arm), CP → the flat upcharge.
                  // Fabricut levels stay authoritative for their own customers — they carry the same
                  // intent in the imported data (retail null = included), so the two agree.
                  if (priceLevel !== 'STANDARD') {
                      const fp = fabricutPriceOf(subPart, priceLevel, undefined, outsourceFinishes, fabFindByCode);
                      if (fp != null) subPrice = fp;
                  }
                  breakdown.push({
                      name: `${step.subLabel || 'Backplate'} (${subPart ? lineNameFor(subPart, subOpt) : subOpt.partName})${plateNote ? ` — ${plateNote}` : ''}`,
                      qty: subQty, price: subPrice, total: subPrice * subQty,
                      // Backplates are tagged Small Parts in the library — that tag now routes them,
                      // instead of inheriting the bracket step's 'Custom' stamp.
                      partHandling: ovrHandling || subPart?.manufacturingSpecs?.partHandling || subBase?.manufacturingSpecs?.partHandling || step.partHandling || '',
                      ...(ovrActive ? { customOverrideHandling: ovrHandling, customNote: ovr.notes || '', customFee: ovr.feeName || '' } : {}),
                      partId: subPart?.itemId || subPart?.id || subOpt.partId,
                      legacyErpId: subPart?.legacyErpId || subPart?.itemId || null
                  });
                  total += subPrice * subQty;
                  // 🔩 Paired wall mount for the backplate sub-line (chain: finished → sized base → raw base —
                  // pairing lives on base docs; enter it per-size when a size needs a different mount).
                  const subWm = subPart?.manufacturingSpecs?.wallMount || subBase?.manufacturingSpecs?.wallMount || subBase0?.manufacturingSpecs?.wallMount;
                  if (subWm && subWm.partId) {
                      const swmPart = findLibPart(subWm.partId);
                      const swmPrice = swmPart ? (parseFloat(swmPart.manufacturingSpecs?.basePrice ?? swmPart.basePrice) || 0) : 0;
                      breakdown.push({
                          name: `Wall Mount — ${subWm.desc || subWm.partId}`,
                          qty: qty, price: swmPrice, total: swmPrice * qty,
                          partHandling: swmPart?.manufacturingSpecs?.partHandling || step.partHandling || '',
                          partId: swmPart?.itemId || swmPart?.id || subWm.partId,
                          legacyErpId: swmPart?.legacyErpId || swmPart?.itemId || subWm.partId
                      });
                      total += swmPrice * qty;
                  }
              }
          }

          // The custom fee line: priced at the operator's amount (never below the item's floor
          // rate), routed by the fee's own handling, carrying the note the floor needs to read.
          if (ovrActive) {
              const amt = Math.max(parseFloat(ovr.amount) || 0, parseFloat(ovr.floor) || 0);
              if (amt > 0) {
                  breakdown.push({
                      name: `${ovr.feeName}${ovr.notes ? ` — ${String(ovr.notes).trim()}` : ''}`,
                      qty: 1, price: amt, total: amt,
                      isFee: true,
                      partHandling: ovrHandling,
                      customOverrideHandling: ovrHandling,
                      customNote: ovr.notes || '',
                      customFee: ovr.feeName || '',
                      partId: ovr.feeItemId || null,
                      legacyErpId: ovr.feeErpId || null,
                      forStep: step.title || ''
                  });
                  total += amt;
              }
          }
      });

      setPricing({ base: total, finalPrice: total });
      setPricingBreakdown(breakdown);
  }, [dynamicConfigParams, stepQuantities, dimensionInputs, customOverrides, activeFlow, activeAssembly, dynamicAssets, outsourceFinishes, jobData.customerId, libraryParts, liveAssemblies, activeBomPins, globalFinishes, priceLevel]);

  // Fee items the Master Library has ticked as custom-override fees (e.g. CUSTOM LABOR, CUSTOM
  // FINISH). Each carries its own Part Handling (the destination floor) and base price (the floor rate).
  const customFeeItems = useMemo(() => (libraryParts || []).filter(p => p?.manufacturingSpecs?.customOverrideFee === true), [libraryParts]);

  const setOverride = (stepId, patch) => setCustomOverrides(prev => {
      const next = { ...prev };
      if (patch === null) { delete next[stepId]; return next; }
      next[stepId] = { ...(prev[stepId] || {}), ...patch };
      return next;
  });
  // Picking the fee pulls its routing + floor rate straight off the library item.
  const chooseCustomFee = (stepId, feeItemId) => {
      const fee = customFeeItems.find(f => (f.itemId || f.id) === feeItemId || f.id === feeItemId);
      if (!fee) return setOverride(stepId, { feeItemId: '', feeErpId: '', feeName: '', handling: '', floor: 0, amount: '' });
      const floor = parseFloat(fee.manufacturingSpecs?.basePrice ?? fee.basePrice) || 0;
      setOverride(stepId, {
          feeItemId: fee.itemId || fee.id,
          feeErpId: fee.legacyErpId || fee.itemId || '',
          feeName: fee.itemName || fee.legacyErpId || 'Custom work',
          handling: fee.manufacturingSpecs?.partHandling || '',
          floor,
          amount: String(floor || ''),
      });
  };

  const handleParamChange = (stepId, value) => setDynamicConfigParams(prev => ({ ...prev, [stepId]: value }));

  // Size-matrix guard: flipping Projection to 3-5/8" removes return availability, and flipping
  // Diameter away from a size-native extra (1-3/8" wood/acrylic) removes that option — clear any
  // selection the new size can't carry so the configuration stays possible. Brackets then
  // un-grey via the normal rules.
  useEffect(() => {
      if (!activeFlow) return;
      const sizeSel = sizeSelectionsOf(activeFlow, dynamicConfigParams);
      // Per-assembly flows have no size steps but DO have a projection context (PROJ_SELECT pick
      // or implied) — the sweep must still clear selections the projection no longer offers.
      if (!sizeSel && flowProjSel == null) return;
      const returnsOk = returnsAllowedFor(sizeSel);
      const allParts = [...libraryParts, ...liveAssemblies];
      const partOf = (o) => allParts.find(x => x.id === o.partId || x.itemId === o.partId || x.legacyErpId === o.partId
          || (o.partName && (x.itemName === o.partName || x.legacyErpId === o.partName || x.itemId === o.partName)));
      setDynamicConfigParams(prev => {
          let changed = false; const next = { ...prev };
          (activeFlow.steps || []).forEach(st => {
              if (st.type !== 'STYLE_SWAP') return;
              const check = (key, pool) => {
                  if (!next[key]) return;
                  const o = (pool || []).find(x => (x.optId || x.partId) === next[key]);
                  if (!o) return;
                  const oEt = String(o.endTreatment || '').toUpperCase();
                  const oRtn = isReturnOption(o) || (o.returnOnly && oEt !== 'INSIDE_MOUNT') || /return|miter|mitre|french|\bbend\b/i.test(String(partOf(o)?.itemName || ''));
                  const banned = (!returnsOk && oRtn && oEt !== 'INSIDE_MOUNT') || (sizeSel && !partAllowedAtSize(partOf(o), sizeSel, sizeLabelIndex)) || !optionProjAllowed(o, sizeSel) || !projTagOk(o);
                  if (banned) { delete next[key]; changed = true; }
              };
              check(st.id, st.styleOptions);
              check(`${st.id}__sub`, st.subOptions);
          });
          return changed ? next : prev;
      });
  }, [dynamicConfigParams, activeFlow, libraryParts, liveAssemblies, sizeLabelIndex]);

  // When a Style selection changes, drop any finish picked for the prior style: different
  // styles can scope different finish sets (e.g. a Wood rod offers wood-clear finishes, a
  // Metal rod offers metal finishes), so a carried-over finish could be invalid for — and
  // applied to the wrong mesh of — the new selection.
  const handleStyleChange = (stepId, value) => setDynamicConfigParams(prev => {
      const next = { ...prev, [stepId]: value, [`${stepId}__finish`]: '' };
      // When the main choice changes on a step with a secondary chooser (e.g. bracket -> backplate),
      // auto-pick the first sub option whose location matches the new choice's mount, so the plate
      // stays coherent with the chosen mount.
      const step = activeFlow?.steps?.find(s => s.id === stepId);
      if (step && Array.isArray(step.subOptions) && step.subOptions.length) {
          const mainOpt = (step.styleOptions || []).find(o => (o.optId || o.partId) === value);
          const loc = mainOpt?.location;
          const pool0 = step.subOptions.filter(optCustomerOk).filter(trvOkFor(step, { isSub: true }));
          const cands = loc ? pool0.filter(o => !o.location || o.location === loc) : pool0;
          const pick = cands.find(o => o.targetNode) || cands[0];
          next[`${stepId}__sub`] = pick ? pick.optId : '';
      }
      return next;
  });

  const handleNextStep = () => {
      if (!activeFlow) return;
      const steps = activeFlow.steps || [];
      let nextIndex = currentStepIndex + 1;
      while (nextIndex < steps.length && engineFlags.disabledSteps.includes(steps[nextIndex]?.title)) {
          nextIndex++;
      }
      if (nextIndex < steps.length) setCurrentStepIndex(nextIndex);
  };

  // Mirror of handleNextStep so Back also hops over disabled steps (never lands on one).
  const handleBackStep = () => {
      if (!activeFlow) return;
      const steps = activeFlow.steps || [];
      let prevIndex = currentStepIndex - 1;
      while (prevIndex > 0 && engineFlags.disabledSteps.includes(steps[prevIndex]?.title)) {
          prevIndex--;
      }
      if (prevIndex >= 0) setCurrentStepIndex(prevIndex);
  };

  const handleAddToCart = async () => {
      const activeDraft = previousDrafts.find(d => d.id === activeDraftId);
      const item = {
          id: Date.now().toString(),
          masterQuoteId: activeMasterQuoteId,
          assemblyId: activeAssemblyId,
          assemblyName: activeAssembly?.itemName || activeFlow?.name || 'Configured Item',
          sidemark: (lineTag || '').trim() || activeDraft?.sidemark || 'No Sidemark',
          flowId: activeFlowId,
          qty: assemblyQty,
          priceLevel,
          pricing: { ...pricing },
          pricingBreakdown: [...pricingBreakdown],
          dynamicConfigParams: { ...dynamicConfigParams },
          // THE FINISH, IN WORDS (Stuart 2026-08-03). It was always selected and always saved, but
          // the only thing that ever translated it was RTG at dispatch — so the floor knew the
          // colour and the customer's quote did not. Stamped here, where CPQ already holds the
          // finish objects, so every document downstream reads one field.
          finishes: selectedFinishes(dynamicConfigParams, activeFlow?.steps || [], [globalFinishes, outsourceFinishes]),
          finishLabel: finishLabelOf(selectedFinishes(dynamicConfigParams, activeFlow?.steps || [], [globalFinishes, outsourceFinishes])),
          stepQuantities: { ...stepQuantities },
          dimensionInputs: { ...dimensionInputs },
          customOverrides: { ...customOverrides },
          engineeringNotes: activeDraft ? activeDraft.specs?.engineeringNotes : null,
          // Only the flat Vision part-pick ids the viewer needs — the full spatialData blob carries
          // canvas structures (nested arrays) that Firestore rejects as "invalid nested entity".
          visionPicks: activeDraft?.spatialData ? {
              bracketId: activeDraft.spatialData.bracketId || null,
              bracketIdRight: activeDraft.spatialData.bracketIdRight || null,
              bracketIdCenter: activeDraft.spatialData.bracketIdCenter || null,
              backplateIdLeft: activeDraft.spatialData.backplateIdLeft || null,
              backplateIdRight: activeDraft.spatialData.backplateIdRight || null,
              backplateIdCenter: activeDraft.spatialData.backplateIdCenter || null
          } : null,
          // Free-floating general note boxes placed on the Vision canvas (shopNotes) — flat text, safe.
          generalNotes: (activeDraft?.spatialData?.shopNotes || []).map(n => (n && typeof n.text === 'string') ? n.text.trim() : '').filter(Boolean),
          // Per-pin bracket/splice note boxes (att.note) captured straight from attachments, so they
          // survive even if engineeringNotes.hangerLocations was empty on the draft.
          bracketNotes: (activeDraft?.spatialData?.attachments || []).map(a => ({
              type: a.type === 'splice' ? 'splice' : 'bracket',
              dist: (a.distInches !== undefined && a.distInches !== null) ? a.distInches : null,
              ref: a.ref || '',
              note: (a.note && typeof a.note === 'string') ? a.note.trim() : ''
          })),
          draftSvg: activeDraftSvg,
          capturedViews: capturedViews || null,
          // Snapshot the resolved render so this exact configuration re-renders later (shop/finishing
          // floor viewer + HQ) even if the flow or assembly is edited afterward. Overrides are stored
          // as ENTRY ARRAYS, not maps: their keys are GLB node names (e.g. "Bracket.001") and Firestore
          // forbids dots/special chars in field names ("invalid nested entity"). The viewer rebuilds the
          // maps in memory. cloneSpecs is safe — node names live as array VALUES there, not keys.
          renderState: activeAssembly?.manufacturingSpecs?.cadUrl ? JSON.parse(JSON.stringify({
              cadUrl: activeAssembly.manufacturingSpecs.cadUrl,
              textureEntries: Object.entries(textureOverrides || {}).map(([target, url]) => ({ target, url })),
              visibilityEntries: Object.entries(visibilityOverrides || {}).map(([target, visible]) => ({ target, visible })),
              cloneSpecs: cloneSpecs || []
          })) : null
      };
      setCart([...cart, item]);
      
      // Update Firebase to mark this draft as configured!
      if (activeDraftId) {
          try {
              await setDoc(doc(db, "cpq_drafts", activeDraftId), { status: 'CONFIGURED' }, { merge: true });
          } catch(err) {
              console.error(err);
          }
      }

      setActiveFlowId("");
      setDynamicConfigParams({});
      setStepQuantities({});
      setDimensionInputs({});
      setCurrentStepIndex(0);
      setActiveAssemblyId("");
      setActiveDraftId(null);
      setActiveDraftSvg(null);
      setAssemblyQty(1);
      setLineTag('');

      setShowCartSuccessModal(true);
  };

  const handleFinalizeQuote = async () => {
      if (!jobData.customerId) return alert("Please select a Customer.");
      if (cart.length === 0) return alert("Your cart is empty. Please add an assembly first.");

      const targetJobId = cart[0].masterQuoteId || activeMasterQuoteId || `QUOTE-${Date.now()}`;
      const customerName = combinedCustomers.find(c => c.id === jobData.customerId)?.name || jobData.customerId;

      // Short human quote number (SG071626-01) for communication, shown instead of the long doc id.
      // Minted once for a NEW quote; re-saves keep the existing one (merge preserves it). A failure
      // never blocks the save — the doc id is still the durable key.
      const isNewQuote = !(cart[0].masterQuoteId || activeMasterQuoteId);
      let mintedQuoteNo = null;
      if (isNewQuote) {
          try { mintedQuoteNo = (await httpsCallable(functions, 'reserveQuoteNo')({ name: currentUser }))?.data?.quoteNo || null; }
          catch (e) { console.warn('quote number reserve failed; using doc id', e); }
      }
      
      let grandTotal = 0;
      let mergedBreakdown = [];
      let mergedNotesObj = null;
      let allDraftSvgs = [];

      // Per-step maps the ERP push (ERPPushPullTab.getJobLineItems) resolves physical
      // NetSuite inventory from. Without these, a finalized quote has no mapped inventory
      // and the push is rejected. Keyed by stepId, merged across all cart assemblies.
      const mergedConfiguration = {};
      const mergedQuantities = {};
      const mergedDimensions = {};

      cart.forEach((item) => {
          const disc = tradeDiscountFor(item);
          const grossTotal = item.pricing.finalPrice * item.qty;
          const discTotal = disc ? disc.amount * item.qty : 0;
          grandTotal += grossTotal - discTotal;

          Object.assign(mergedConfiguration, item.dynamicConfigParams || {});
          Object.assign(mergedQuantities, item.stepQuantities || {});
          Object.assign(mergedDimensions, item.dimensionInputs || {});

          // The configuration header is the one row EVERY document renders — the on-screen cart,
          // both print layouts, the customer PDF, RTG's forms and the viewer's line picker. Putting
          // the finish here reaches all of them at once, and keeps it where it belongs: stated once
          // per configuration, not repeated down every part row.
          const finLabel = finishLabelOfItem(item);
          mergedBreakdown.push({
              name: `▶ ${item.assemblyName} [${item.sidemark}]${finLabel ? `  ·  ${finLabel}` : ''}`,
              qty: item.qty,
              total: grossTotal,
              finishLabel: finLabel || null,
              isHeader: true
          });

          item.pricingBreakdown.forEach(line => {
              mergedBreakdown.push({
                  name: `  - ${line.name}`,
                  qty: line.qty * item.qty,
                  // Keep BOTH figures on the merged line (Stuart 2026-08-03): the quote shows the
                  // multiplied total, but every downstream floor screen needs the per-configuration
                  // count and the multiplier so it can say "2 × 7" instead of a bare 14.
                  qtyEach: line.qty,
                  configQty: item.qty,
                  price: line.price,
                  total: line.total * item.qty,
                  partHandling: line.partHandling || '',
                  partId: line.partId || null,
                  legacyErpId: line.legacyErpId || null,
                  isFee: !!line.isFee,
                  isSizeRow: !!line.isSizeRow,
                  cutLength: line.cutLength || null,
                  dimensions: line.dimensions || null
              });
          });

          // Three-line trade-discount display (configured total ▸ discount ▸ net). Display-only
          // rows: flagged so BOM/dispatch/packing consumers skip them, and nothing ever sums
          // breakdown totals (the quote total is cpqData.totalPrice, already net).
          if (disc) {
              mergedBreakdown.push({ name: `  Trade Discount - (${disc.percent}%)`, qty: 1, price: -disc.amount, total: -discTotal, isDiscount: true, partHandling: '', partId: null });
              mergedBreakdown.push({ name: `  Net Line Total`, qty: 1, price: item.pricing.finalPrice - disc.amount, total: grossTotal - discTotal, isNetLine: true, partHandling: '', partId: null });
          }

          if (!mergedNotesObj && item.engineeringNotes) mergedNotesObj = item.engineeringNotes;
          
          if (item.draftSvg) {
              allDraftSvgs.push({
                  sidemark: item.sidemark,
                  svg: item.draftSvg
              });
          }
      });

      // ADD-ONS — appended after the configured items, so `grandTotal` at this moment is exactly
      // the CONFIGURATION SUBTOTAL a percentage fee is worked out from: parts and labour, net of
      // any trade discount, before other fees and before shipping (shipping rides on the estimate
      // header, never a line). Two percentage fees therefore never compound.
      const addOnLines = buildAddOnLines(addOnSel, addOnCatalog, grandTotal);
      if (addOnLines.length) {
          mergedBreakdown.push({ name: 'Add-ons & Fees', qty: 1, price: 0, total: 0, isHeader: true, partHandling: '', partId: null });
          addOnLines.forEach(l => mergedBreakdown.push({
              name: `  - ${l.name}`, qty: l.qty, price: l.price, total: l.total,
              partHandling: l.partHandling || '', partId: l.partId || null, legacyErpId: l.legacyErpId || null,
              // Real items added at checkout are NOT fees: they push as their own NetSuite line and
              // route by their own Part Handling, exactly as if the flow had produced them.
              isFee: l.isFee !== false, isAddOn: true, addOnExplain: l.explain || '',
          }));
          grandTotal += addOnsTotal(addOnLines);
      }

      const payload = {
          jobId: targetJobId, brandId: activeBrand, status: 'CONFIGURED',
          ...(mintedQuoteNo ? { quoteNo: mintedQuoteNo } : {}),
          // WHO generated the quote — stamped once at creation, then left alone (merge preserves
          // it), so a portal-originated createdBy survives staff re-pricing. `author` below keeps
          // recording who last finalized.
          ...(isNewQuote ? { createdBy: { name: currentUser, via: 'CPQ' } } : {}),
          // Quote-display level this job was priced at (cart items each carry theirs too). The
          // push still rates physical lines at standard pricing; the rollup absorbs the balance.
          priceLevel: cart[0]?.priceLevel || priceLevel,
          customer: { id: jobData.customerId, name: customerName },
          jobName: jobData.jobName,
          // Header-level order tag. `orderSidemark` = exactly what was typed (reopen restores it);
          // `sidemark` keeps its historical fallback chain because CRM cards, RTG notes and the
          // ERP push memo all read it.
          orderSidemark: (jobData.sidemark || '').trim() || null,
          sidemark: (jobData.sidemark || '').trim() || jobData.jobName || 'Multi-Room Project',
          flowId: cart[0].flowId || null, 
          linkedAssemblyId: cart[0].assemblyId || null,
          isProjectManaged: activeAssembly?.manufacturingSpecs?.isProjectManaged || false, 
          
          // PO # / Internal Memo only write when typed — merge:true keeps an earlier value on a
          // reopen-refinalize where the fields came back blank.
          ...(String(jobData.poNumber || '').trim() ? { poNumber: String(jobData.poNumber).trim() } : {}),
          ...(String(jobData.internalMemo || '').trim() ? { internalMemo: String(jobData.internalMemo).trim() } : {}),
          shippingMethod: jobData.shippingMethod || 'SAVED',
          shippingAddressId: jobData.shippingAddressId || null,
          customShippingAddress: jobData.shippingMethod === 'CUSTOM' ? jobData.customShippingAddress : null,
          // Shipping charge rides OUTSIDE cpqData.totalPrice: the push writes it to the NetSuite
          // estimate header (shippingcost), never a line — keeps the rollup balance math intact.
          shippingAmount: parseFloat(jobData.shippingAmount) || 0,

          // fsSafe hardens the whole blob — Vision-derived fields can carry undefined / NaN / nested
          // arrays that Firestore rejects ("cpqData contains an invalid nested entity").
          cpqData: fsSafe({
              totalPrice: grandTotal,
              appliedRules: engineFlags.warnings,
              breakdown: mergedBreakdown,
              // tradeDiscount stamped per item (always set, so a re-finalize after the code
              // changed can't keep a stale stamp). finalPrice stays GROSS per-unit; net derives.
              cartItems: cart.map(it => ({ ...it, tradeDiscount: tradeDiscountFor(it) || null })),
              // Consumed by ERPPushPullTab to map lines -> physical NetSuite inventory.
              configuration: mergedConfiguration,
              quantities: mergedQuantities,
              dimensions: mergedDimensions
          }),
          engineeringNotes: fsSafe(mergedNotesObj),
          dispatchStatus: { nsSalesOrder: false, fabrication: false, finishing: false, sewing: false, packing: false },
          dateSaved: new Date().toISOString().split('T')[0], author: currentUser, createdAt: serverTimestamp()
      };

      // Silent safety net: warn only if a Firestore-unsafe value ever slips past fsSafe (no console spam).
      const _viol = findFsViolation(payload.cpqData, 'cpqData') || findFsViolation(payload.engineeringNotes, 'engineeringNotes');
      if (_viol) console.warn('[CPQ finalize] Firestore-unsafe value slipped past fsSafe:', _viol);

      try {
          await setDoc(doc(db, "jobs", targetJobId), payload, { merge: true });
          
          if (allDraftSvgs.length > 0) {
              const svgPromises = allDraftSvgs.map((draft, idx) => {
                  return setDoc(doc(db, "crm_files", `DRAWING-${Date.now()}-${idx}`), {
                      customerId: jobData.customerId,
                      jobId: targetJobId,
                      sidemark: draft.sidemark || 'Multi-Room Project',
                      dateSaved: new Date().toISOString(),
                      type: 'VISION_DRAWING',
                      svgData: draft.svg
                  });
              });
              await Promise.all(svgPromises);
          }
          
          // Clean up all the staging drafts that belonged to this Master Quote
          if (activeMasterQuoteId) {
              const draftsToDelete = previousDrafts.filter(d => d.masterQuoteId === activeMasterQuoteId);
              for (const d of draftsToDelete) {
                  await deleteDoc(doc(db, "cpq_drafts", d.id));
              }
          }

          await generateOrderDocuments(payload, allDraftSvgs);

          if (activeAssembly?.manufacturingSpecs?.isProjectManaged) {
              alert(`✅ Quote Generated!\nRouted to Tab 10.5 (Project Management) for multi-order dissection.`);
          } else {
              alert(`✅ Quote Generated!\nRouted to Tab 10 (External Coop) for standard approval.`);
          }
          
          setCart([]);
          setAddOnSel({});
          localStorage.removeItem('hq_global_cart');
          localStorage.removeItem('hq_active_quote_session'); localStorage.removeItem('hq_reopen_quote');
          setShowCheckoutModal(false);
          setJobData({ customerId: '', jobName: '', sidemark: '', shippingMethod: 'SAVED', shippingAddressId: '', shippingAmount: '', customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } });
          setActiveMasterQuoteId(null);

      } catch (err) { 
          console.error(err); 
          alert("Failed to save quote."); 
      }
  };

  const generateOrderDocuments = async (job, svgs) => {
      const printWindow = window.open('', '_blank');
      
      let mathSection = '';
      if (job.engineeringNotes) {
          const notes = job.engineeringNotes;
          mathSection = `
              <div style="background: #faf8f4; border: 1px dashed rgba(28,26,22,.14); padding: 20px;">
                  <h4 style="margin:0 0 15px 0; color: #1c1a16; font-family: Georgia, serif; text-transform: uppercase;">Reference Math</h4>
                  <table style="width: 100%; border-collapse: collapse; font-size: 14px; font-family: sans-serif;">
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Pole O2O (Edge-to-Edge):</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.poleO2O ? notes.poleO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Total System O2O (+ Brackets):</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.totalSystemO2O ? notes.totalSystemO2O.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Left Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole1 ? notes.pole1.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">${notes.shape === 'STRAIGHT' ? 'Main Wall C2C:' : 'Center Wall C2C:'}</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole2 ? notes.pole2.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ${notes.shape === 'MITERED' ? `
                      <tr>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); color: #524e46;">Right Wall C2C:</td>
                          <td style="padding: 8px; border-bottom: 1px solid rgba(28,26,22,.14); font-weight: bold;">${notes.pole3 ? notes.pole3.toFixed(2) + '"' : 'N/A'}</td>
                      </tr>
                      ` : ''}
                  </table>
              </div>
          `;
      }

      const html = `
        <html>
          <head>
            <title>${job.jobId} - Documents</title>
            <style>
              body { font-family: 'Inter', -apple-system, sans-serif; color: #1c1a16; margin: 0; padding: 0; background: #525659; }
              .page { background: #faf8f4; width: 8.5in; min-height: 11in; padding: 0.5in; margin: 0.25in auto; box-sizing: border-box; box-shadow: 0 0 10px rgba(0,0,0,0.5); position: relative; }
              @media print {
                  body { background: #fff; }
                  .page { margin: 0; border: none; box-shadow: none; width: 100%; min-height: auto; page-break-after: always; padding: 0.25in; }
              }
              .header { display: flex; justify-content: space-between; border-bottom: 1px solid rgba(28,26,22,.14); padding-bottom: 15px; margin-bottom: 30px; align-items: flex-end; }
              .brand { font-size: 28px; font-weight: 500; font-family: 'Cormorant Garamond', Georgia, serif; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1; }
              .doc-type { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #524e46; letter-spacing: .15em; text-transform: uppercase; }
              
              .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px; }
              .label { font-size: 10px; font-family: 'IBM Plex Mono', monospace; color: #524e46; text-transform: uppercase; letter-spacing: .1em; }
              .val { font-size: 14px; font-weight: 500; margin-top: 4px; display: block; }
              
              .split-layout { display: flex; gap: 30px; margin-bottom: 40px; align-items: flex-start; }
              .column-left { flex: 1.5; }
              .column-right { flex: 1; }

              .section-box { border: 1px solid rgba(28,26,22,.14); background: #fff; padding: 20px; margin-bottom: 20px; }
              .section-header { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 18px; margin-bottom: 15px; border-bottom: 1px solid rgba(28,26,22,.14); padding-bottom: 10px; }
              
              .row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid rgba(28,26,22,.08); font-size: 13px; }
              .row:last-child { border-bottom: none; }
              .row.total { font-weight: 500; font-size: 16px; border-top: 1px solid rgba(28,26,22,.14); border-bottom: none; margin-top: 10px; padding-top: 15px; }
              
              .signature-block { margin-top: 60px; display: flex; justify-content: space-between; gap: 30px; }
              .sig-line { flex: 1; border-top: 1px solid rgba(28,26,22,.14); padding-top: 8px; font-size: 10px; font-family: 'IBM Plex Mono', monospace; color: #524e46; text-align: left; text-transform: uppercase; letter-spacing: .1em; }
            </style>
          </head>
          <body>
            
            <div class="page">
                <div class="header">
                  <div class="brand">${brandLogos[activeBrand] ? `<img src="${brandLogos[activeBrand]}" alt="${activeBrand}" style="max-height:56px;max-width:240px;display:block" />` : activeBrand}</div>
                  <div class="doc-type">Quotation</div>
                </div>
                
                <div class="meta-grid">
                  <div><span class="label">Project</span><span class="val">${job.jobName || 'Multi-Room Order'}</span></div>
                  <div><span class="label">Quote ID</span><span class="val">${job.quoteNo || job.jobId}</span></div>
                  <div><span class="label">Prepared For</span><span class="val">${job.customer?.name}</span></div>
                  <div><span class="label">Date</span><span class="val">${job.dateSaved}</span></div>
                  ${job.orderSidemark ? `<div><span class="label">Sidemark</span><span class="val">${job.orderSidemark}</span></div>` : ''}
                </div>

                <div class="split-layout">
                    <div class="column-left">
                        <div class="section-box">
                            <div class="section-header">Configuration Details</div>
                            ${job.cpqData?.breakdown?.map(item => `
                                <div class="row" style="${item.isHeader ? 'font-weight: bold; background: #f4f0e6; padding: 8px;' : ''}${item.isDiscount ? 'color: #8a6d3b;' : ''}${item.isNetLine ? 'font-weight: bold;' : ''}">
                                    <span style="flex: 3;">${item.name}${item.cutLength ? `<span style="color:#7a736a;font-size:10px;"> &nbsp;·&nbsp; ${cutText(item.cutLength)}</span>` : ''}</span>
                                    <span style="flex: 1; text-align: center; color: #524e46;">${(item.isHeader || item.isDiscount || item.isNetLine) ? '' : `Qty: ${item.qty}`}</span>
                                    <span style="flex: 1; text-align: right;">$${item.total.toFixed(2)}</span>
                                </div>
                            `).join('')}
                            ${(parseFloat(job.shippingAmount) || 0) > 0 ? `
                            <div class="row">
                                <span style="flex: 4; text-align: right; padding-right: 20px;">Shipping</span>
                                <span style="flex: 1; text-align: right;">$${(parseFloat(job.shippingAmount) || 0).toFixed(2)}</span>
                            </div>` : ''}
                            <div class="row total">
                                <span style="flex: 4; text-align: right; padding-right: 20px; font-family: 'Cormorant Garamond', serif;">Total Estimate</span>
                                <span style="flex: 1; text-align: right;">$${((job.cpqData?.totalPrice || 0) + (parseFloat(job.shippingAmount) || 0)).toFixed(2)}</span>
                            </div>
                        </div>
                    </div>
                    <div class="column-right">
                        ${mathSection}
                    </div>
                </div>

                <div class="signature-block">
                    <div class="sig-line">Client Approval</div>
                    <div class="sig-line" style="max-width: 200px;">Date</div>
                </div>
            </div>

            <div class="page">
                <div class="header">
                  <div class="brand">${brandLogos[activeBrand] ? `<img src="${brandLogos[activeBrand]}" alt="${activeBrand}" style="max-height:56px;max-width:240px;display:block" />` : activeBrand}</div>
                  <div class="doc-type">Factory Router</div>
                </div>
                
                <div class="meta-grid">
                  <div><span class="label">Project</span><span class="val">${job.jobName || 'Multi-Room Order'}</span></div>
                  <div><span class="label">Work Order ID</span><span class="val">${job.jobId}</span></div>
                  ${job.orderSidemark ? `<div><span class="label">Sidemark</span><span class="val">${job.orderSidemark}</span></div>` : ''}
                </div>

                <div class="split-layout">
                    <div class="column-left">
                        <div class="section-box">
                            <div class="section-header">Bill of Materials</div>
                            <div class="row" style="color: #524e46; font-family: 'IBM Plex Mono', monospace; font-size: 10px; text-transform: uppercase;">
                                <span style="flex: 3;">Component</span>
                                <span style="flex: 1; text-align: right;">Req. Qty</span>
                            </div>
                            ${job.cpqData?.breakdown?.filter(item => !item.isDiscount && !item.isNetLine).map(item => `
                                <div class="row" style="${item.isHeader ? 'font-weight: bold; background: #f4f0e6; padding: 8px;' : ''}">
                                    <span style="flex: 3; font-weight: 500;">${item.name}${item.cutLength ? `<span style="color:#7a736a;font-weight:400;font-size:10px;"> &nbsp;·&nbsp; ${cutText(item.cutLength)}</span>` : ''}</span>
                                    <span style="flex: 1; text-align: right; font-size: 14px; font-weight: 500;">${item.isHeader ? '' : item.qty}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="column-right">
                        ${mathSection}
                    </div>
                </div>
            </div>
            
            ${svgs && svgs.length > 0 ? svgs.map(draft => `
            <div class="page">
                <div class="header">
                  <div class="brand">${brandLogos[activeBrand] ? `<img src="${brandLogos[activeBrand]}" alt="${activeBrand}" style="max-height:56px;max-width:240px;display:block" />` : activeBrand}</div>
                  <div class="doc-type">Engineering Drawing</div>
                </div>
                <div class="meta-grid">
                  <div><span class="label">Sidemark</span><span class="val">${draft.sidemark}</span></div>
                  <div><span class="label">Quote ID</span><span class="val">${job.quoteNo || job.jobId}</span></div>
                </div>
                <div style="width: 100%; border: 1px solid rgba(28,26,22,.14); background: #fff; padding: 20px; margin-top: 20px; box-sizing: border-box;">
                    ${draft.svg}
                </div>
                <div class="signature-block">
                    <div class="sig-line">Fabrication Sign-Off</div>
                    <div class="sig-line" style="max-width: 200px;">Date</div>
                </div>
            </div>
            `).join('') : ''}

            <script> 
                window.onload = function() { 
                    setTimeout(() => window.print(), 500); 
                } 
            </script>
          </body>
        </html>
      `;
      printWindow.document.write(html);
      printWindow.document.close();
  };

  const renderOptionPrice = (opt, currentStep) => {
      const allParts = [...libraryParts, ...liveAssemblies];
      const partObj = allParts.find(p => p.id === opt.id) || 
                      dynamicAssets.find(a => a.id === opt.id) ||
                      globalFinishes.find(f => f.id === opt.id) ||
                      outsourceFinishes.find(f => f.id === opt.id);
      
      let nativeP = 0;
      if (partObj) {
          if (partObj.manufacturingSpecs?.basePrice) nativeP = parseFloat(partObj.manufacturingSpecs.basePrice);
          else if (partObj.basePrice) nativeP = parseFloat(partObj.basePrice);
      }

      // Choose / Swap Style: display the per-option base price set in the builder,
      // mirroring the live pricing calc (opt.price comes through getStepOptions).
      if (currentStep.type === 'STYLE_SWAP' && opt.price !== undefined && opt.price !== '') {
          nativeP = parseFloat(opt.price) || 0;
      }

      if (currentStep.useClientPricing && jobData.customerId && partObj?.clientPricing) {
          // Tolerant match (entries may store customer NAME or id) + only real prices (>0) apply.
          const rec = liveCustomers.find(c => c.id === jobData.customerId);
          const v = clientPriceFor(partObj.clientPricing, customerKeys(jobData.customerId, rec));
          if (v != null) nativeP = v;
      }

      let upP = currentStep.priceMap?.[opt.id] ? parseFloat(currentStep.priceMap[opt.id]) : 0;
      let finalP = nativeP + upP;

      if (currentStep.priceOverride !== undefined && currentStep.priceOverride !== "") {
          finalP = parseFloat(currentStep.priceOverride);
      }

      if (finalP > 0) return ` (+$${finalP.toFixed(2)})`;
      return '';
  };

  const get2DRenderLayers = () => {
      const layers = [];
      if (activeAssembly && activeAssembly.finalImageUrl) {
          layers.push({ textureUrl: activeAssembly.finalImageUrl, zIndex: 1, name: activeAssembly.itemName });
      }
      Object.entries(dynamicConfigParams).forEach(([stepId, valueId]) => {
          let foundAsset = dynamicAssets.find(a => a.id === valueId) || globalFinishes.find(f => f.id === valueId) || outsourceFinishes.find(f => f.id === valueId);
          let zIdx = foundAsset ? 30 : 10;
          if (!foundAsset) {
              const allParts = [...libraryParts, ...liveAssemblies];
              const libPart = allParts.find(p => p.id === valueId);
              if (libPart) { foundAsset = libPart; zIdx = parseInt(libPart.manufacturingSpecs?.layeringSequence) || 10; }
          }
          // Choose / Swap Style: per-option Layer Z override (set in the flow builder) wins,
          // so you control bracket-vs-pole stacking without editing the part.
          const swapStep = activeFlow?.steps?.find(s => s.id === stepId && s.type === 'STYLE_SWAP');
          if (swapStep) {
              const opt = (swapStep.styleOptions || []).find(o => (o.optId || o.partId) === valueId);
              if (opt && opt.layerZ !== undefined && opt.layerZ !== '' && opt.layerZ !== null) zIdx = parseInt(opt.layerZ) || zIdx;
          }
          if (foundAsset) {
              const tex = foundAsset.textureUrl || foundAsset.finalImageUrl;
              if (tex) layers.push({ textureUrl: tex, zIndex: zIdx, name: foundAsset.itemName || foundAsset.name });
          }
      });
      return layers.sort((a, b) => a.zIndex - b.zIndex);
  };

  const textureOverrides = useMemo(() => {
      if (!activeFlow) return {};
      const overrides = {};
      
      activeFlow.steps?.forEach(step => {
          const selectedValueId = dynamicConfigParams[step.id];
          if (selectedValueId && step.targetNodes) {
              const allF = [...globalFinishes, ...outsourceFinishes];
              const dynamicF = dynamicAssets;
              const fData = allF.find(f => f.id === selectedValueId) || dynamicF.find(d => d.id === selectedValueId);

              if (fData?.textureUrl) overrides[step.targetNodes] = fData.textureUrl;
          }
          // Compound/style step: apply the Finish selection to the SELECTED style's mesh
          // (auto-resolved from the BOM-derived geometryMap — no manual node needed).
          if (step.finishDataSource) {
              const finishId = dynamicConfigParams[`${step.id}__finish`];
              const fData = finishId && [...globalFinishes, ...outsourceFinishes, ...dynamicAssets].find(f => f.id === finishId);
              if (fData?.textureUrl) {
                  // Apply the step's finish to BOTH its selected geometry and its selected sub
                  // geometry (e.g. the bracket AND its chosen backplate share one finish).
                  const selMain = dynamicConfigParams[step.id];
                  const selSub = dynamicConfigParams[`${step.id}__sub`];
                  const mainNode = (step.geometryMap && step.geometryMap[selMain])
                      || (step.styleOptions || []).find(o => (o.optId || o.partId) === selMain)?.targetNode
                      || step.finishTargetNodes;
                  const subNode = (step.subGeometryMap && selSub) ? step.subGeometryMap[selSub] : '';
                  // These are LIST strings (geometry-map values), not single node names — the
                  // texture loop splits them (dual-format). Wrapping a LIST in the '=' exact
                  // escape turned it into one unmatchable literal and killed finish rendering
                  // (Stuart 2026-08-10: "color is not rendering at all") — keys stay raw here.
                  [mainNode, subNode].filter(Boolean).forEach(node => { overrides[node] = fData.textureUrl; });
              }
          }
      });
      // 🧊 ACRYLIC TOPS render from the AC (clear acrylic) chip in MASTER FINISHES — data, not
      // hardcoded — so this same seam serves Fabricut's acrylic-or-wood tops later (Phase B adds
      // a top-scoped finish selector; when a step gains one, skip this append for that step).
      // Appended LAST deliberately: the renderer's override loop is last-match-wins, so the AC
      // chip beats the step's metal finish routed onto the selected top's node above.
      const acPool = [...globalFinishes, ...outsourceFinishes];
      const acChip = acPool.find(f => String(f.code || '').toUpperCase() === 'AC')
          || acPool.find(f => /clear\s*acrylic|^acrylic\b/i.test(String(f.name || '')));
      if (acChip?.textureUrl) {
          (activeFlow.steps || []).forEach(step => {
              const t = String(step.title || '');
              if (/ACRYLIC/i.test(t) && !/COLLAR/i.test(t) && step.targetNodes) overrides[step.targetNodes] = acChip.textureUrl;
              // Acrylic-top OPTIONS inside ordinary steps (End Treatment): target the option's
              // pre-merge top nodes (acrylicTopNodes — the collar companion nodes appended after
              // them keep the step's metal finish), falling back to its full geometry for flows
              // generated before the companion-collar mechanic.
              (step.styleOptions || []).forEach(o => {
                  // acrylicTopNodes (stamped by the generator's collar pairing) is the authoritative
                  // signal — option text is usually the bare item code with no 'ACRYLIC' in it.
                  const txt = `${o.partName || ''} ${o.partId || ''}`;
                  const looksAcrylic = !!o.acrylicTopNodes || /ACRYLIC/i.test(txt);
                  if (!looksAcrylic || /COLLAR|(^|[^A-Z])AFC([^A-Z]|$)/i.test(txt)) return;
                  const nodes = o.acrylicTopNodes || o.targetNode || (step.geometryMap || {})[o.optId] || '';
                  if (nodes) overrides[nodes] = acChip.textureUrl;
              });
          });
      }
      return overrides;
  }, [dynamicConfigParams, activeFlow, globalFinishes, outsourceFinishes, dynamicAssets]);

  // Stale SIZE-PROJ clear (Stuart 2026-07-24: French Return "offered at 3-5/8"" — it wasn't:
  // the invalid projection had silently healed to 4-5/8" for the gating math while the UI kept
  // displaying the stale pick, so the list was 4-5/8"'s under a 3-5/8" label). When the chosen
  // diameter makes the stored projection invalid — per that diameter's TAGS, else per dias[] —
  // clear it visibly; sizeSelectionsOf then defaults, and the label, cards, and option gating
  // all agree again.
  useEffect(() => {
      if (!activeFlow) return;
      const projStep = (activeFlow.steps || []).find(s => s.type === SIZE_STEP_TYPE && s.sizeAxis === 'PROJ');
      if (!projStep) return;
      const sel = dynamicConfigParams[projStep.id];
      if (!sel) return;
      const opt = (projStep.styleOptions || []).find(o => o.optId === sel);
      if (!opt) return;
      const selNow = sizeSelectionsOf(activeFlow, dynamicConfigParams);
      const tagged = taggedProjInchesAtDia(activeFlow, selNow?.dia, null);
      const ok = tagged.size
          ? (() => { const i = projOptionInches(projStep.sizeFamily, opt); return i != null && tagged.has(Math.round(i * 1000) / 1000); })()
          : projAllowedAtDia(projStep.sizeFamily, opt, selNow?.dia);
      if (!ok) setDynamicConfigParams(prev => { const n = { ...prev }; delete n[projStep.id]; return n; });
  }, [dynamicConfigParams, activeFlow]);

  // 🎯 Single-assembly flows: a PROJ_SELECT step (generated from the assembly's own bracket
  // proj: tags) gates tagged options — no size matrix involved. Untagged options always show.
  const flowProjSel = useMemo(() => {
      const st = (activeFlow?.steps || []).find(s => s.type === 'PROJ_SELECT');
      if (!st) {
          // Single-projection assembly: no question asked — the generator stamps the implied
          // projection on the flow so min-tagged returns still gate against it.
          const imp = parseFloat(String(activeFlow?.impliedProjInches ?? ''));
          return Number.isFinite(imp) ? imp : null;
      }
      const o = (st.styleOptions || []).find(x => x.optId === dynamicConfigParams[st.id]);
      const f = parseFloat(String(o?.projInches ?? '').replace(/[^0-9.]/g, ''));
      return Number.isFinite(f) ? f : null;
  }, [activeFlow, dynamicConfigParams]);
  // A flow built by the traverse generator — recognised by the steps only it emits. Used where the
  // two grammars genuinely need different rules rather than a shared one bent to serve both.
  const isTraverseFlow = useMemo(() => (activeFlow?.steps || [])
      .some(s => ['TRV_SETUP', 'TRV_DRIVE', 'TRV_FASCIA', 'TRACK'].includes(s.stepRole)), [activeFlow]);
  const projTagOk = (o) => {
      if (flowProjSel == null || !o?.projInches) return true;
      const f = parseFloat(String(o.projInches).replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(f)) return true;
      // RETURN-type options (french/miter/bent fees) read their proj: tag as a MINIMUM —
      // a return needs at least that much depth, so tagging them 4-5/8" hides them at
      // .75"/3-5/8" and shows them at 4-5/8" AND 6". Brackets read the tag as the exact
      // projection the physical item IS.
      const et = String(o.endTreatment || '').toUpperCase();
      const returnish = et === 'FRENCH_RETURN' || et === 'MITER_RETURN'
          || (o.isFee && /return|miter|mitre|french|bend/i.test(String(o.partName || '')));
      // ON A TRAVERSE FLOW A RETURN IS EXACT, NOT A MINIMUM (Stuart 2026-08-05: step 6 "is showing
      // the fee item twice, one is for the 3.625" projection and the other is 4.625""). Minimum
      // semantics fit a pole flow, where a return is a FEE gated on having enough depth. Here each
      // miter return is a real modelled part built for one projection — H12RCTAR3625LEFT and
      // H12RCTAR4625LEFT are different geometry, not the same charge at two depths — so ">=" listed
      // every shallower one alongside the right one.
      if (returnish && !isTraverseFlow) return flowProjSel >= f - 0.01;
      return Math.abs(f - flowProjSel) < 0.01;
  };

  // ── TRACK QUANTITY IS DERIVED, NEVER TYPED (Stuart 2026-08-05) ─────────────────────────────────
  // "the track length can be taken from the fascia quantity... with double it is 2x and with double
  // with front no track but rings it is track per ft plus qty of rings."
  //
  // The 2x is not a special case and is deliberately not written as one. A traverse system bills ONE
  // track per rail it actually has: the Track step bills the front, and the DOUBLE answer bills the
  // rear. Give each of them the fascia footage and every configuration falls out on its own —
  //
  //   single                 Track = ft                        → 1 x ft
  //   double                 Track = ft, Double answer = ft     → 2 x ft
  //   double + front as ring Track DISABLED, Double answer = ft → 1 x ft, plus the ring by the piece
  //
  // Written into stepQuantities rather than computed at price time so the on-screen breakdown and
  // the NetSuite push read the SAME number — two copies of this rule would eventually disagree, and
  // the one that reaches the customer is the invoice.
  useEffect(() => {
      if (!isTraverseFlow || !activeFlow) return;
      const steps = activeFlow.steps || [];
      const lenStep = steps.find(s => s.stepRole === 'TRV_LENGTH');
      if (!lenStep) return;
      const trackStep = steps.find(s => s.stepRole === 'TRACK');
      const setupStep = steps.find(s => s.stepRole === 'TRV_SETUP');
      setStepQuantities(prev => {
          const ft = parseInt(prev[lenStep.id]) || 0;
          const next = { ...prev }; let changed = false;
          const put = (id, v) => { if (id && next[id] !== v) { next[id] = v; changed = true; } };
          put(trackStep?.id, ft);
          // The setup step only bills a track on DOUBLE; on SINGLE its answer carries no part, so a
          // footage quantity there would just be a confusing number on a $0 line.
          if (setupStep) put(setupStep.id, trvSelection.setup === 'DOUBLE' ? ft : 1);
          return changed ? next : prev;
      });
  }, [isTraverseFlow, activeFlow, trvSelection.setup, stepQuantities, setStepQuantities]);

  // The single predicate a step's option list is judged by — the same one getOptionsForStep uses
  // for the dropdown. Keeping the reconcile below in step with the dropdown is the whole point: a
  // selection the customer cannot see in the list must not survive on the quote.
  const stepOptOk = (st, opts) => { const trv = trvOkFor(st, opts); return (o) => trv(o) && projTagOk(o); };

  // SWITCHING THE ANSWER MUST CLEAR WHAT IT INVALIDATES. Picking Double, choosing a double bracket,
  // then going back to Single would otherwise leave that double bracket selected — no longer in any
  // list, still on the quote, still in the BOM. The option would be invisible and the order wrong,
  // which is worse than either of the two states it sits between.
  //
  // PROJECTION IS ONE OF THOSE ANSWERS TOO (Stuart 2026-08-05: picking a bracket projection made
  // "all the end arms and brackets disappear"). Every bracket and arm is tagged to a projection, so
  // choosing one invalidates the seeded selection on every bracket and End Treatment step at once —
  // and this reconcile only ever watched the setup and drive axes, so nothing put a valid option
  // back. It now watches the projection as well and judges by the SAME predicate the dropdown uses.
  useEffect(() => {
      setDynamicConfigParams(prev => {
          const next = { ...prev }; let changed = false;
          (activeFlow?.steps || []).forEach(st => {
              // A DISABLED step is meant to be empty — the effect below clears it deliberately
              // (an option flagged hidesStepRole, e.g. Front-as-ring removing the front track).
              // Healing it here would fight that and put the step straight back.
              if ((engineFlags.disabledSteps || []).includes(st.title)) return;
              // RE-SEED, DON'T JUST CLEAR (Stuart 2026-08-05: switching to Double "removes the
              // bracket arms rather than adding a second track"). Picking Double invalidates every
              // single-only return arm, and clearing alone left that end controlled by NOTHING —
              // so the arms vanished. The double arm is tagged, and is sitting in the list: hand
              // the step its new default rather than an empty slot. Only when no option survives
              // does the selection actually go away.
              // A selector keeps its own answer — filtering a question by its own answer would hide
              // every alternative the moment one was picked. Its SUB-choices still reconcile below.
              const isSelector = st.stepRole === 'TRV_SETUP' || st.stepRole === 'TRV_DRIVE';
              const pool = (st.styleOptions || []).filter(optCustomerOk).filter(stepOptOk(st));
              const main = isSelector ? null : (st.styleOptions || []).find(x => (x.optId || x.partId) === next[st.id]);
              if (main && !stepOptOk(st)(main)) {
                  const repl = defaultOptionFor(pool, st.geometryMap, st.defaultOptId);
                  if (repl) next[st.id] = repl; else delete next[st.id];
                  changed = true;
              } else if (!isSelector && !next[st.id] && st.required && st.type === 'STYLE_SWAP' && pool.length) {
                  // AND HEAL WHAT AN EARLIER ANSWER EMPTIED. Clearing runs on an INVALID selection;
                  // it has nothing to say about a step already sitting empty. So a step whose pool
                  // emptied under one answer stayed unselected forever once the pool came back —
                  // switch to Double, lose the track, switch back to Single and it never returns
                  // (Stuart 2026-08-05: "try to switch back and both disappear"). A REQUIRED step
                  // with valid options must never sit empty. Optional steps are left alone, so a
                  // deliberately-cleared End Treatment stays cleared.
                  const repl = defaultOptionFor(pool, st.geometryMap, st.defaultOptId);
                  if (repl) { next[st.id] = repl; changed = true; }
              }
              let subPool = (st.subOptions || []).filter(optCustomerOk).filter(stepOptOk(st, { isSub: true }));
              // POOL-SCOPED HEALING (Brimar 2026-08-09: backplates rendered whether or not the
              // french return was selected). The clearing effect above correctly empties an
              // out-of-pool plate pick — but this heal re-seeded it from a pool with NO
              // return/inline scoping, so the mesh came straight back: picker blank, plate on.
              // Apply the SAME three-pool predicate the picker (~3347) and the clearer (~1482)
              // use, so all three surfaces agree about which plates exist right now. When the
              // live pool is empty (no plate belongs in this state), the step stays empty —
              // an empty backplate is a legitimate answer, not a hole to heal.
              if ((st.subOptions || []).some(o => o.returnOnly || o.inlineOnly)) {
                  const selMain = (st.styleOptions || []).find(x => (x.optId || x.partId) === next[st.id]);
                  const returnChosen = isReturnChosenForPos(st.position) || !!selMain?.isReturnArm;
                  const inlineBracket = !!selMain?.usesReturnPlates;
                  const hasInl = (st.subOptions || []).some(o => o.inlineOnly);
                  const retPoolLive = subPool.some(o => o.returnOnly);
                  subPool = subPool.filter(o => returnChosen ? (retPoolLive ? o.returnOnly : (!o.returnOnly && !o.inlineOnly))
                      : inlineBracket ? (hasInl ? o.inlineOnly : o.returnOnly)
                      : (!o.returnOnly && !o.inlineOnly));
              }
              const sub = (st.subOptions || []).find(x => (x.optId || x.partId) === next[`${st.id}__sub`]);
              if (sub && !stepOptOk(st, { isSub: true })(sub)) {
                  const repl = defaultOptionFor(subPool, st.subGeometryMap, st.defaultSubOptId);
                  if (repl) next[`${st.id}__sub`] = repl; else delete next[`${st.id}__sub`];
                  changed = true;
              } else if (!next[`${st.id}__sub`] && subPool.length) {
                  // The Front Rail sub-picker appears only once DOUBLE is chosen, so its options go
                  // from none to two mid-flow. Without this it would sit unanswered and the default
                  // (front as track) would never be applied.
                  const repl = defaultOptionFor(subPool, st.subGeometryMap, st.defaultSubOptId);
                  if (repl) { next[`${st.id}__sub`] = repl; changed = true; }
              }
          });
          return changed ? next : prev;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trvSelection.setup, trvSelection.drive, flowProjSel, engineFlags.disabledSteps, activeFlow]);

  const visibilityOverrides = useMemo(() => {
      if (!activeFlow) return {};
      // AND across steps: a node renders only if EVERY step that lists it (in any of its options'
      // geometry) has the customer's CURRENT selection include it. This lets independent dimensions
      // intersect — e.g. a ceiling-vertical backplate hides when Mount=Wall even though Type=Vertical
      // — instead of the old last-pick-wins, which couldn't combine two choices. Keyed per individual
      // node (not the comma list) so the AND is computed node-by-node.
      const overrides = {};
      (activeFlow.steps || []).forEach(step => {
          // Tag-driven Mount selector: controls every location-tagged end cluster; only those whose
          // Location matches the customer's pick stay allowed (AND-combined like any other step).
          if (step.mountSelector) {
              const selectedLoc = dynamicConfigParams[step.id];
              const pos = step.mountPosition; // 'LEFT' | 'RIGHT' | '' (all positions)
              const controlled = new Set(); const inSelected = new Set();
              (activeAssembly?.nodeClusters || []).forEach(cl => {
                  if (!cl.location || (pos && cl.position !== pos)) return;
                  (cl.nodes || cl.meshes || []).forEach(n => { if (!n) return; controlled.add(n); if (cl.location === selectedLoc) inSelected.add(n); });
              });
              controlled.forEach(n0 => { const n = exactNode(n0); const allowed = inSelected.has(n0); overrides[n] = (n in overrides) ? (overrides[n] && allowed) : allowed; });
              return;
          }
          const applyMap = (gmap, sel) => {
              if (!gmap || Object.keys(gmap).length === 0) return;
              const controlled = new Set();
              const inSelected = new Set();
              Object.entries(gmap).forEach(([optId, csv]) => {
                  if (!csv) return;
                  splitNodes(csv).forEach(n => {
                      controlled.add(n);
                      if (optId === sel) inSelected.add(n);
                  });
              });
              controlled.forEach(n0 => {
                  // EXACT single-name keys (nodeList): a node name containing a comma must reach the
                  // matcher whole — the render/audit split honours the '=' escape.
                  const n = exactNode(n0);
                  const allowed = inSelected.has(n0);
                  overrides[n] = (n in overrides) ? (overrides[n] && allowed) : allowed;
              });
          };
          // Main style choice + an optional second geometry chooser in the same step (e.g. the
          // backplate paired with the chosen bracket/mount). Each is independent hidden-until-chosen,
          // AND-combined per node like any other dimension.
          applyMap(step.geometryMap, dynamicConfigParams[step.id]);
          applyMap(step.subGeometryMap, dynamicConfigParams[`${step.id}__sub`]);
      });

      // Flow-level hidden geometry: force-hide whole clusters this config never shows.
      (activeFlow.hiddenClusters || []).forEach(cid => {
          const cl = (activeAssembly?.nodeClusters || []).find(c => c.id === cid);
          (cl?.nodes || cl?.meshes || []).forEach(n => { if (n) overrides[exactNode(n)] = false; });
      });
      // Per-node force-hides (choices marked "hide" in the Assembly Builder assign tool).
      (activeFlow.hiddenNodes || []).forEach(n => { if (n) overrides[exactNode(n)] = false; });

      return overrides;
  }, [dynamicConfigParams, activeFlow, activeAssembly]);

  // WHO OWNS EACH MAPPED NODE NAME (Brimar 2026-08-10: the strip listed 25 ghosts but not where
  // they came from, so 'not found' couldn't be traced to a step, an option, or the hidden list —
  // and the fix path differs for each). Token → short owner label, same sources as the overrides.
  const visTokenOwners = useMemo(() => {
      const owners = {};
      const claim = (listStr, label) => splitNodesLower(listStr).forEach(t => { if (!owners[t]) owners[t] = label; });
      if (!activeFlow) return owners;
      (activeFlow.steps || []).forEach(step => {
          Object.entries(step.geometryMap || {}).forEach(([optId, csv]) => {
              const opt = (step.styleOptions || []).find(o => (o.optId || o.partId) === optId);
              claim(csv, `${step.title}: ${opt?.partName || optId}`);
          });
          Object.entries(step.subGeometryMap || {}).forEach(([optId, csv]) => {
              const opt = (step.subOptions || []).find(o => (o.optId || o.partId) === optId);
              claim(csv, `${step.title} · ${step.subLabel || 'Backplate'}: ${opt?.partName || optId}`);
          });
      });
      (activeFlow.hiddenNodes || []).forEach(n => { if (n) { const t = String(n).trim().toLowerCase(); if (!owners[t]) owners[t] = 'force-hidden list (1.6 hide/parked)'; } });
      (activeFlow.hiddenClusters || []).forEach(cid => {
          const cl = (activeAssembly?.nodeClusters || []).find(c => c.id === cid);
          (cl?.nodes || cl?.meshes || []).forEach(n => { if (n) { const t = String(n).trim().toLowerCase(); if (!owners[t]) owners[t] = `hidden cluster ${cl?.name || cid}`; } });
      });
      return owners;
  }, [activeFlow, activeAssembly]);

  // Steps flagged "clone along pole" (e.g. the center passing bracket) drive procedural cloning:
  // the selected option's meshes are cloned (qty) times and spaced down the pole in DynamicModel.
  const cloneSpecs = useMemo(() => {
      if (!activeFlow) return [];
      const steps = activeFlow.steps || [];
      // Rail = the pole's selected geometry (all of it), so center clones space along the FULL pole
      // even when it's modeled as many small segments — the longest single mesh would be one rib.
      const poleStep = steps.find(s => s.type === 'STYLE_SWAP' && /pole|rod/i.test(s.title || '') && s.geometryMap && Object.keys(s.geometryMap).length);
      const poleSel = poleStep && dynamicConfigParams[poleStep.id];
      let railNames = splitNodes((poleStep && poleSel && poleStep.geometryMap[poleSel]) || '');
      // Single-material poles are combined into the VISUAL_DIMENSIONS "Pole Length & Finish" step (no
      // STYLE_SWAP pole chooser), so the pole geometry lives in that step's targetNodes — read it there.
      if (!railNames.length) {
          const poleDim = steps.find(s => /pole|rod/i.test(s.title || '') && s.targetNodes);
          railNames = splitNodes((poleDim && poleDim.targetNodes) || '');
      }
      // Last resort: any non-bracket STYLE_SWAP geometry. NEVER a center-clone (bracket) step — that
      // would collapse the spacing span onto the bracket itself and stack the clones.
      if (!railNames.length) {
          const anyGeo = steps.find(s => s.type === 'STYLE_SWAP' && !s.isCenterClone && s.geometryMap && Object.keys(s.geometryMap).length);
          const anySel = anyGeo && dynamicConfigParams[anyGeo.id];
          railNames = splitNodes((anyGeo && anySel && anyGeo.geometryMap[anySel]) || '');
      }
      const out = [];
      steps.forEach(step => {
          if (!step.isCenterClone) return;
          const selId = dynamicConfigParams[step.id];
          const selSub = dynamicConfigParams[`${step.id}__sub`];
          // Clone the chosen bracket AND its chosen backplate together, so each center clone
          // carries its plate.
          const mainStr = (selId && step.geometryMap) ? (step.geometryMap[selId] || '') : '';
          const subStr = (selSub && step.subGeometryMap) ? (step.subGeometryMap[selSub] || '') : '';
          const meshStr = [mainStr, subStr].filter(Boolean).join(',');
          if (!meshStr) return;
          const meshNames = splitNodes(meshStr);
          // The bracket arm (main geometry) is the placement ANCHOR: spacing is computed from it
          // alone, so a backplate/extras cloned alongside can't shift where the bracket lands.
          const anchorNames = splitNodes(mainStr);
          const rawQty = stepQuantities[step.id];
          let count = (rawQty !== undefined && rawQty !== '') ? (parseInt(rawQty) || 0) : 1;
          // Selection-only steps (hideQty): a stored 0 is a Vision-resume artifact, not "none" —
          // the selection's geometry must still render (once, its implicit quantity).
          if (step.hideQty && count === 0) count = 1;
          if (count >= 1 && meshNames.length) out.push({ stepId: step.id, meshNames, anchorNames, railNames, count });
      });
      return out;
  }, [activeFlow, dynamicConfigParams, stepQuantities]);

  // Stage 0 debug: meshes the CURRENT step's current selection controls, fed to the 3D
  // option-highlight. Lowercased node names; matched with the same matcher CPQ renders with,
  // so what glows is exactly what would show. Null unless the Highlight toggle is on.
  const highlightOverrides = useMemo(() => {
      if (!debugHighlight || !currentStep) return null;
      const selId = dynamicConfigParams[currentStep.id];
      const selSub = dynamicConfigParams[`${currentStep.id}__sub`];
      const main = (currentStep.geometryMap && selId) ? (currentStep.geometryMap[selId] || '') : '';
      const sub = (currentStep.subGeometryMap && selSub) ? (currentStep.subGeometryMap[selSub] || '') : '';
      // Glow the step's selected MAIN geometry plus its selected sub (e.g. arm + chosen backplate),
      // so the backplate's match precision can be eyeballed the same way as the arm's.
      return [main, sub].flatMap(splitNodesLower);
  }, [debugHighlight, currentStep, dynamicConfigParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', fontFamily: 'var(--sans)', backgroundColor: 'transparent', minHeight: '100vh' }}>
      
      {/* HEADER */}
      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '2px', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}>
        <div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.1em', display: 'block', marginBottom: '4px' }}>Parametric Pricing & Visualization</span>
            <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.8rem', fontWeight: 500, color: 'var(--ink)' }}>Configure, Price, Quote (CPQ)</h2>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500, background: 'var(--paper-2)', padding: '12px 24px', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                Config Total: ${(pricing.finalPrice * assemblyQty).toFixed(2)}
            </div>
            <button onClick={() => setShowCheckoutModal(true)} disabled={cart.length === 0} style={{ padding: '16px 24px', background: cart.length > 0 ? 'var(--brass)' : 'var(--paper)', color: cart.length > 0 ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: cart.length > 0 ? 'pointer' : 'not-allowed', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                Checkout ({cart.length} Items)
            </button>
            <button onClick={() => setShowCloneModal(true)} style={{ padding: '16px 24px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Resume Draft</button>
            <button onClick={() => { setActiveFlowId(""); setDynamicConfigParams({}); setStepQuantities({}); setDimensionInputs({}); setCurrentStepIndex(0); setActiveAssemblyId(""); setProductType(""); setActiveDraftId(null); setActiveDraftSvg(null); setLineTag(''); setCart([]); localStorage.removeItem('hq_global_cart'); localStorage.removeItem('hq_active_quote_session'); localStorage.removeItem('hq_reopen_quote'); setAssemblyQty(1); setActiveMasterQuoteId(null); setJobData({ customerId: '', jobName: '', sidemark: '', shippingMethod: 'SAVED', shippingAddressId: '', shippingAmount: '', customShippingAddress: { attention: '', addressee: '', addr1: '', addr2: '', city: '', state: '', zip: '', country: 'US' } }); }} style={{ padding: '16px 24px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.color='var(--ink)'} onMouseOut={e => e.currentTarget.style.color='var(--ink-soft)'}>Clear All</button>
        </div>
      </div>

      {/* CART — configured lines, each editable/removable. Was previously only summarized as a count. */}
      {cart.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '20px 24px', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.15rem', color: 'var(--ink)' }}>Cart — Configured Lines ({cart.length})</h3>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.08em' }}>Edit re-opens a line in the configurator</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {cart.map(item => (
              <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', border: '1px solid var(--line)', background: 'var(--paper-2)', borderRadius: '2px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: '0.98rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.assemblyName || 'Configured Item'} <span style={{ color: 'var(--ink-soft)' }}>[{item.sidemark || 'No Sidemark'}]</span>
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.06em', marginTop: '2px' }}>
                    Qty {item.qty} · ${((item.pricing?.finalPrice || 0) * (item.qty || 1)).toFixed(2)}
                    {(() => {
                        const d = tradeDiscountFor(item);
                        return d ? <span style={{ color: 'var(--brass)' }}> · Trade Discount - ({d.percent}%): -${(d.amount * (item.qty || 1)).toFixed(2)} · Net ${(((item.pricing?.finalPrice || 0) - d.amount) * (item.qty || 1)).toFixed(2)}</span> : null;
                    })()}
                  </div>
                </div>
                <button onClick={() => handleEditCartItem(item.id)} style={{ padding: '8px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.08em' }}>Edit</button>
                <button onClick={() => handleRemoveCartItem(item.id)} title="Remove from cart" style={{ padding: '8px 12px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase' }}>✕</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '24px', display: 'flex', alignItems: 'center', gap: '20px', borderRadius: '2px', boxShadow: '0 2px 8px rgba(0,0,0,0.02)', opacity: activeMasterQuoteId ? 0.6 : 1, pointerEvents: activeMasterQuoteId ? 'auto' : 'auto' }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', letterSpacing: '.1em' }}>Active Customer:</div>
          <select 
              value={jobData.customerId} 
              onChange={e => setJobData({...jobData, customerId: e.target.value})} 
              style={{ flex: 1, padding: '12px', fontSize: '0.95rem', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', background: activeMasterQuoteId ? 'var(--paper-2)' : '#fff', cursor: activeMasterQuoteId ? 'not-allowed' : 'pointer' }}
              disabled={!!activeMasterQuoteId}
          >
              <option value="">-- Select Customer to Activate Live Client Pricing --</option>
              {[...combinedCustomers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
          </select>
          {activeMasterQuoteId ? (
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Locked by active Global Job: {activeMasterQuoteId}</span>
          ) : (
              !jobData.customerId && <span style={{ fontSize: '0.85rem', color: 'var(--brass)', fontStyle: 'italic', fontFamily: 'var(--serif)' }}>Base MSRP will be shown until customer is selected.</span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Sidemark</span>
              <input type="text" value={jobData.sidemark} onChange={e => setJobData({ ...jobData, sidemark: e.target.value })}
                  placeholder="e.g. Smith Residence"
                  title="Order sidemark / tag — prints at the header of the quote, sales order and packing slip (NetSuite estimate memo). Each configured line gets its own tag in the configurator."
                  style={{ width: '190px', padding: '10px 12px', fontSize: '0.9rem', border: `1px solid ${jobData.sidemark ? 'var(--brass)' : 'var(--line)'}`, outline: 'none', fontFamily: 'var(--sans)', background: '#fff' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Price Level</span>
              <select value={priceLevel} onChange={e => setPriceLevel(e.target.value)}
                  title="Quote display level. Items with imported Fabricut pricing quote at this level (backplates $0 — included in the arm; coverplates the flat upcharge). Fees and non-Fabricut items keep standard pricing. Items already in the cart keep the level they were added at. NetSuite push line rates are never changed by this."
                  style={{ padding: '10px 12px', fontSize: '0.9rem', border: `1px solid ${priceLevel !== 'STANDARD' ? 'var(--brass)' : 'var(--line)'}`, outline: 'none', fontFamily: 'var(--sans)', background: priceLevel !== 'STANDARD' ? 'var(--paper-2)' : '#fff', minWidth: '230px' }}>
                  {PRICE_LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
          </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'stretch' }}>
          
          <div style={{ width: '400px', display: 'flex', flexDirection: 'column', gap: '24px', flexShrink: 0 }}>
              
              {/* QUEUED LINES PANEL */}
              {activeMasterQuoteId && previousDrafts.filter(d => d.masterQuoteId === activeMasterQuoteId).length > 0 && (
                  <div style={{ background: '#fff', border: '1px solid var(--brass)', padding: '20px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                      <h3 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', color: 'var(--ink)' }}>Lines Awaiting Configuration</h3>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                          {previousDrafts.filter(d => d.masterQuoteId === activeMasterQuoteId).map(draft => (
                              <div key={draft.id} style={{ border: `1px solid ${draft.status === 'CONFIGURED' ? '#4CAF50' : 'var(--line)'}`, padding: '12px', background: draft.status === 'CONFIGURED' ? '#f0fdf4' : 'var(--paper-2)', flex: 1, minWidth: '140px' }}>
                                  <div style={{ fontWeight: 500, marginBottom: '8px', fontSize: '0.9rem', color: draft.status === 'CONFIGURED' ? '#166534' : 'var(--ink)' }}>
                                      {draft.sidemark || 'Unnamed Line'}
                                  </div>
                                  {draft.status === 'CONFIGURED' ? (
                                      <div style={{ padding: '8px 16px', background: 'transparent', color: '#166534', border: '1px solid #4CAF50', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', textAlign: 'center', width: '100%', boxSizing: 'border-box' }}>
                                          ✅ Configured
                                      </div>
                                  ) : (
                                      <button onClick={() => handleResumeDraft(draft.id)} style={{ padding: '8px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', width: '100%' }}>
                                          Configure
                                      </button>
                                  )}
                              </div>
                          ))}
                      </div>
                  </div>
              )}

              <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                 <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--line)' }}>Step 1: Select Flow</div>
                 <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    
                    {cpqFlows.length > 0 && (() => {
                        // Flows stamped sizeGroupLabel/sizeGroupChoice (single-assembly generator)
                        // collapse into ONE entry — picking it shows Rod Diameter cards first; each
                        // card loads that assembly's OWN flow. No cross-size logic anywhere.
                        const groups = {};
                        cpqFlows.forEach(f => { if (f.sizeGroupLabel) (groups[f.sizeGroupLabel] = groups[f.sizeGroupLabel] || []).push(f); });
                        Object.values(groups).forEach(list => list.sort((a, b) => (a.sizeGroupSort ?? 99) - (b.sizeGroupSort ?? 99)));
                        const flat = cpqFlows.filter(f => !f.sizeGroupLabel);
                        const activeGrouped = activeFlow?.sizeGroupLabel;
                        return (
                            <>
                                <select value={activeFlowId || (pendingGroup ? `GROUP::${pendingGroup}` : '')} onChange={(e) => {
                                    const v = e.target.value;
                                    if (v.startsWith('GROUP::')) { setPendingGroup(v.slice(7)); launchFlow(''); return; }
                                    setPendingGroup('');
                                    launchFlow(v);
                                }} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                                    <option value="">-- Launch Custom CPQ Flow --</option>
                                    {Object.keys(groups).sort().map(g => <option key={`GROUP::${g}`} value={`GROUP::${g}`}>{g} — pick rod diameter…</option>)}
                                    {activeGrouped && <option value={activeFlowId}>{activeFlow.name}</option>}
                                    {flat.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                </select>
                                {(pendingGroup && groups[pendingGroup] && !activeFlowId) && (
                                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(groups[pendingGroup].length, 4)}, 1fr)`, gap: '10px' }}>
                                        {groups[pendingGroup].map(f => (
                                            <div key={f.id} onClick={() => launchFlow(f.id)} style={{ border: '1px solid var(--line)', background: '#fff', padding: '18px 10px', textAlign: 'center', cursor: 'pointer' }}>
                                                <div style={{ fontFamily: 'var(--serif)', fontSize: '1rem', color: 'var(--ink)' }}>{f.sizeGroupChoice || f.name}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {activeGrouped && (
                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {(groups[activeFlow.sizeGroupLabel] || []).map(f => {
                                            const on = f.id === activeFlowId;
                                            return <button key={f.id} onClick={() => !on && launchFlow(f.id)} style={{ padding: '6px 10px', border: `1px solid ${on ? 'var(--brass)' : 'var(--line)'}`, background: on ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', cursor: on ? 'default' : 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>{f.sizeGroupChoice || f.name}</button>;
                                        })}
                                        <button onClick={() => launchFlow(activeFlowId)} title="Clear every selection on this flow and start the configuration fresh (same diameter)." style={{ padding: '6px 10px', border: '1px solid var(--line)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '.05em' }}>↺ Reset</button>
                                    </div>
                                )}
                            </>
                        );
                    })()}

                    {!activeFlowId && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
                            <div style={{ width: '100%', fontSize: '0.85rem', color: 'var(--ink-soft)' }}>Or Select Standard Category:</div>
                            <select value={productType} onChange={(e) => {setProductType(e.target.value); setActiveAssemblyId('');}} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }}>
                                <option value="">-- Select Product Category --</option>
                                {availableProductTypes.map(pt => <option key={pt} value={pt}>{pt}</option>)}
                            </select>
                        </div>
                    )}
                 </div>
              </div>

              {activeFlow && currentStep && (
                  <div style={{ background: '#fff', border: '1px solid var(--brass)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', flex: 1 }}>
                      <div style={{ padding: '20px 24px', background: 'var(--paper)', color: 'var(--ink)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Step {currentStepIndex + 1} of {activeFlow.steps.length}: {currentStep.title}</span>
                          {(currentStep.basePrice !== undefined && currentStep.basePrice !== null && currentStep.basePrice !== '') && (
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)', border: '1px solid var(--line)', padding: '4px 8px' }}>
                                  Base: ${parseFloat(currentStep.basePrice).toFixed(2)}
                              </span>
                          )}
                      </div>

                      {/* PER-LINE TAG — names THIS configuration on every document (▶ Assembly [tag]).
                          Lives above the steps so it's the first thing asked on a new line. */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 24px', background: lineTag ? '#fdfaf4' : 'var(--paper-2)', borderBottom: '1px solid var(--line)' }}>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>Line Tag / Room</span>
                          <input type="text" value={lineTag} onChange={e => setLineTag(e.target.value)}
                              placeholder='e.g. "Living Room", "Primary Bedroom"'
                              title="Tags this configuration on the quote, factory router and floor screens. The order-level sidemark (header) is set next to the customer picker."
                              style={{ flex: 1, padding: '8px 12px', fontSize: '0.9rem', border: `1px solid ${lineTag ? 'var(--brass)' : 'var(--line)'}`, outline: 'none', fontFamily: 'var(--sans)', background: '#fff' }} />
                      </div>

                      <div style={{ padding: '24px', flex: 1, overflowY: 'auto', maxHeight: '400px' }}>

                          {/* ⚙ CUSTOM WORK ON THIS STEP (Stuart 2026-07-28) — APP ONLY, never in the
                              customer portal. Ticking it overrules the library routing for this
                              step's parts and adds a priced fee line. The fee items offered are the
                              ones ticked "Custom Override Fee" in the Master Library, and each one's
                              own Part Handling decides the destination floor, so new fee types need
                              no code change. Size/projection selectors carry no parts, so no override. */}
                          {currentStep.type !== SIZE_STEP_TYPE && currentStep.type !== 'PROJ_SELECT' && (() => {
                              const ov = customOverrides[currentStep.id];
                              const on = !!ov;
                              const feeChosen = !!(ov && ov.feeItemId);
                              const floor = parseFloat(ov?.floor) || 0;
                              const amt = parseFloat(ov?.amount);
                              const belowFloor = feeChosen && Number.isFinite(amt) && amt < floor;
                              const dest = ov?.handling ? (/custom/i.test(ov.handling) ? 'SHOP FLOOR' : 'FINISHING FLOOR') : '';
                              return (
                                  <div style={{ border: `1px solid ${on ? 'var(--brass)' : 'var(--line)'}`, background: on ? '#fdfaf4' : 'transparent', padding: '12px 14px', marginBottom: '18px' }}>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                          <input type="checkbox" checked={on} onChange={e => setOverride(currentStep.id, e.target.checked ? {} : null)} />
                                          <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.08em', textTransform: 'uppercase', color: on ? 'var(--ink)' : 'var(--ink-soft)' }}>
                                              ⚙ Custom work on this step
                                          </span>
                                          {!on && customFeeItems.length === 0 && (
                                              <span style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: 'var(--ink-soft)' }}>— no custom fee items ticked in the Master Library yet</span>
                                          )}
                                      </label>

                                      {on && (
                                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '12px' }}>
                                              <div>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Fee type</label>
                                                  <select value={ov?.feeItemId || ''} onChange={e => chooseCustomFee(currentStep.id, e.target.value)} style={{ width: '100%', padding: '10px', border: `1px solid ${feeChosen ? 'var(--line)' : '#d9534f'}`, marginTop: '4px', fontFamily: 'var(--sans)' }}>
                                                      <option value="">Select the custom fee…</option>
                                                      {customFeeItems.map(f => (
                                                          <option key={f.id} value={f.itemId || f.id}>{f.itemName || f.legacyErpId}</option>
                                                      ))}
                                                  </select>
                                                  {feeChosen && (
                                                      <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: dest ? 'var(--brass)' : '#d9534f', marginTop: '4px' }}>
                                                          {dest ? `→ this step's parts route to the ${dest}` : '⚠ this fee item has no Part Handling — set it in the Master Library'}
                                                      </div>
                                                  )}
                                              </div>
                                              <div>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Fee amount{floor > 0 ? ` (floor $${floor.toFixed(2)})` : ''}</label>
                                                  <input type="number" min={floor || 0} step="0.01" disabled={!feeChosen} value={ov?.amount ?? ''} onChange={e => setOverride(currentStep.id, { amount: e.target.value })}
                                                      style={{ width: '100%', padding: '10px', border: `1px solid ${belowFloor ? '#d9534f' : 'var(--line)'}`, marginTop: '4px', fontFamily: 'var(--mono)', background: feeChosen ? '#fff' : 'var(--paper)' }} />
                                                  {belowFloor && <div style={{ fontFamily: 'var(--mono)', fontSize: '9px', color: '#d9534f', marginTop: '4px' }}>below the floor — it will bill at ${floor.toFixed(2)}</div>}
                                              </div>
                                              <div style={{ gridColumn: '1 / -1' }}>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '9px', letterSpacing: '.08em', color: 'var(--ink-soft)', textTransform: 'uppercase' }}>Nature of the custom work — rides the work order to the floor</label>
                                                  <textarea rows={2} disabled={!feeChosen} value={ov?.notes || ''} onChange={e => setOverride(currentStep.id, { notes: e.target.value })}
                                                      placeholder={feeChosen ? 'e.g. hand-forge the scroll to match the client\'s existing rod' : 'choose the fee type first'}
                                                      style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', marginTop: '4px', fontFamily: 'var(--sans)', boxSizing: 'border-box', background: feeChosen ? '#fff' : 'var(--paper)' }} />
                                              </div>
                                          </div>
                                      )}
                                  </div>
                              );
                          })()}

                          {/* Size-matrix selector (Rod Diameter / Bracket Projection): big card
                              choices; the selection re-resolves every configured part to that size
                              at pricing/push time — geometry and all other selections stay put. */}
                          {(currentStep.type === SIZE_STEP_TYPE || currentStep.type === 'PROJ_SELECT') && (() => {
                              // Projections are diameter-dependent (sizeMatrix `dias`): H2's 1-3/8" rod
                              // offers 4-5/8"/6" while the smaller rods offer 3-5/8"/4-5/8" — hide what
                              // the chosen diameter doesn't sell. Stale invalid picks self-heal in
                              // sizeSelectionsOf, so pricing/push never use an impossible cell.
                              const selNow = sizeSelectionsOf(activeFlow, dynamicConfigParams);
                              // "The projections offered needs to read the tags" (Stuart 2026-07-24):
                              // when the flow's options carry proj tags AT THIS DIAMETER (per-dia
                              // projByDia from the union, or flat projInches), the cards offer exactly
                              // those measurements — the entered truth. No tags at this dia → fall
                              // back to the family's static dias[] availability.
                              const taggedHere = currentStep.sizeAxis === 'PROJ' ? taggedProjInchesAtDia(activeFlow, selNow?.dia, null) : null;
                              const sizeOpts = (currentStep.styleOptions || []).filter(o => {
                                  if (currentStep.sizeAxis !== 'PROJ') return true;
                                  if (taggedHere && taggedHere.size) {
                                      const inches = projOptionInches(currentStep.sizeFamily, o);
                                      return inches != null && taggedHere.has(Math.round(inches * 1000) / 1000);
                                  }
                                  return projAllowedAtDia(currentStep.sizeFamily, o, selNow?.dia);
                              });
                              return (
                              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(sizeOpts.length, 1)}, 1fr)`, gap: '14px', marginBottom: '20px' }}>
                                  {sizeOpts.map(o => {
                                      const on = dynamicConfigParams[currentStep.id] === o.optId;
                                      return (
                                          <div key={o.optId} onClick={() => handleParamChange(currentStep.id, o.optId)} style={{ border: `1px solid ${on ? 'var(--brass)' : 'var(--line)'}`, background: on ? 'var(--paper-2)' : '#fff', padding: '20px 12px', textAlign: 'center', cursor: 'pointer', transition: 'all 0.15s' }}>
                                              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.05rem', color: 'var(--ink)', fontWeight: on ? 600 : 400 }}>{o.partName}</div>
                                          </div>
                                      );
                                  })}
                              </div>
                              );
                          })()}

                          {(currentStep.type === 'VISUAL_GRID' || currentStep.type === 'VISUAL_DIMENSIONS') && (
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                                  {getOptionsForStep(currentStep).map(opt => (
                                      <div key={opt.id} onClick={() => handleParamChange(currentStep.id, opt.id)} style={{ border: `1px solid ${dynamicConfigParams[currentStep.id] === opt.id ? 'var(--brass)' : 'var(--line)'}`, padding: '12px', textAlign: 'center', cursor: 'pointer', background: dynamicConfigParams[currentStep.id] === opt.id ? 'var(--paper-2)' : '#fff', transition: 'all 0.2s' }}>
                                          <div style={{ width: '100%', height: '80px', background: opt.finalImageUrl ? `url(${opt.finalImageUrl}) center/cover` : 'var(--paper-2)', marginBottom: '12px' }} />
                                          <div style={{ fontSize: '0.85rem', color: 'var(--ink)' }}>{opt.itemName}<span style={{color: 'var(--ink-soft)'}}>{renderOptionPrice(opt, currentStep)}</span></div>
                                      </div>
                                  ))}
                              </div>
                          )}

                          {((currentStep.type === 'DROPDOWN' && currentStep.dataSource) || currentStep.type === 'STYLE_SWAP') && (
                              <select value={dynamicConfigParams[currentStep.id] || ''} disabled={returnLocksBracket(currentStep) || armLocksEnd(currentStep)} onChange={(e) => handleStyleChange(currentStep.id, e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontSize: '0.95rem', fontFamily: 'var(--sans)', marginBottom: currentStep.finishDataSource ? '12px' : '20px', outline: 'none', ...((returnLocksBracket(currentStep) || armLocksEnd(currentStep)) ? { background: 'var(--paper-2)', color: 'var(--ink-soft)', cursor: 'not-allowed', opacity: 0.65 } : {}) }}>
                                  <option value="">{returnLocksBracket(currentStep) ? 'Return selected — bracket replaced (choose the return backplate below)' : armLocksEnd(currentStep) ? 'End return arm selected — it IS this end (no finial / inside mount)' : (currentStep.type === 'STYLE_SWAP' ? '-- Choose Style --' : '-- Select Option --')}</option>
                                  {getOptionsForStep(currentStep).map(opt => (
                                      <option key={opt.id} value={opt.id}>{opt.itemName}{opt.desc ? ` — ${opt.desc}` : ''}{renderOptionPrice(opt, currentStep)}</option>
                                  ))}
                              </select>
                          )}

                          {/* Second geometry chooser in the same step (e.g. the backplate that pairs
                              with the chosen bracket/mount): pick the correct plate among several at
                              this position. Drives visibility like the main style choice. */}
                          {currentStep.type === 'STYLE_SWAP' && Array.isArray(currentStep.subOptions) && currentStep.subOptions.length > 0 && (() => {
                              // Narrow the plate list to the chosen bracket's mount/location, so only
                              // matching plates show (e.g. wall plates when a wall arm is selected).
                              const selMainOpt = (currentStep.styleOptions || []).find(o => (o.optId || o.partId) === dynamicConfigParams[currentStep.id]);
                              const selLoc = selMainOpt?.location;
                              let subs = currentStep.subOptions.filter(optCustomerOk).filter(trvOkFor(currentStep, { isSub: true })).filter(o => !selLoc || !o.location || o.location === selLoc);
                              // Return-aware scoping: the RETURN backplates show while this side's End
                              // Treatment is a return OR the selected bracket is flagged usesReturnPlates
                              // (e.g. In Line brackets share the return plates); regular plates otherwise —
                              // never both, they occupy the same spot.
                              // Three plate pools, one visible at a time (they occupy the same spots):
                              //  - return chosen (or end-return arm)  -> returnOnly copies (outer, return-position)
                              //  - In Line bracket (usesReturnPlates) -> inlineOnly copies (inline-position); flows
                              //    with NO inline copies fall back to returnOnly = the pre-split behavior
                              //  - otherwise                          -> regular plates (neither flag)
                              // Size-native plates (if any) show only at their own diameter.
                              const subSizeSel = sizeSelectionsOf(activeFlow, dynamicConfigParams);
                              const subSizeOk = (o) => {
                                  if (!projTagOk(o)) return false;
                                  if (!subSizeSel) return true;
                                  const ap = [...libraryParts, ...liveAssemblies];
                                  if (!optionProjAllowed(o, subSizeSel)) return false;
                                  return partAllowedAtSize(
                                      ap.find(x => x.id === o.partId || x.itemId === o.partId || x.legacyErpId === o.partId
                                          || (o.partName && (x.itemName === o.partName || x.legacyErpId === o.partName || x.itemId === o.partName))),
                                      subSizeSel, sizeLabelIndex);
                              };
                              if (currentStep.subOptions.some(o => o.returnOnly || o.inlineOnly)) {
                                  const returnChosen = isReturnChosenForPos(currentStep.position) || !!selMainOpt?.isReturnArm;
                                  const inlineBracket = !!selMainOpt?.usesReturnPlates;
                                  const hasInl = currentStep.subOptions.some(o => o.inlineOnly);
                                  // Return plates exist only where the diameter has them (RBP/RCP are
                                  // ¾"-native). At 1"/1-3/8" a return uses the STANDARD plates — so when
                                  // no returnOnly plate survives the size gate, fall back to the regular
                                  // pool instead of an empty backplate list.
                                  const retPoolLive = subs.some(o => o.returnOnly && subSizeOk(o));
                                  subs = subs.filter(o => returnChosen ? (retPoolLive ? o.returnOnly : (!o.returnOnly && !o.inlineOnly))
                                      : inlineBracket ? (hasInl ? o.inlineOnly : o.returnOnly)
                                      : (!o.returnOnly && !o.inlineOnly));
                              }
                              subs = subs.filter(subSizeOk);
                              // Basic brackets take no backplate — grey the picker and pin it to None.
                              const noPlate = basicNoBackplate(currentStep);
                              return (
                              <div style={{ marginBottom: '20px' }}>
                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>{currentStep.subLabel || 'Backplate'}</label>
                                  <select value={noPlate ? '' : (dynamicConfigParams[`${currentStep.id}__sub`] || '')} disabled={noPlate} onChange={(e) => handleParamChange(`${currentStep.id}__sub`, e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontSize: '0.95rem', fontFamily: 'var(--sans)', outline: 'none', ...(noPlate ? { background: 'var(--paper-2)', color: 'var(--ink-soft)', cursor: 'not-allowed', opacity: 0.65 } : {}) }}>
                                      <option value="">{noPlate ? '-- None (basic bracket — no backplate) --' : '-- None --'}</option>
                                      {subs.map(o => {
                                          const d = optionDisplayFor(o);
                                          return (
                                          <option key={o.optId} value={o.optId}>{d.name}{d.desc ? ` — ${d.desc}` : ''}</option>
                                      ); })}
                                  </select>
                                  {(() => {
                                      // A COUNTED SUB-CHOICE gets its own quantity box. The front-rail
                                      // ring is billed by the piece while everything else on its step is
                                      // per-foot, so it cannot share the step's number.
                                      const selSub = subs.find(o => o.optId === dynamicConfigParams[`${currentStep.id}__sub`]);
                                      if (!selSub?.needsQty) return null;
                                      const key = `${currentStep.id}__sub`;
                                      const val = stepQuantities[key] !== undefined ? stepQuantities[key] : 1;
                                      const bump = (d) => setStepQuantities(prev => ({ ...prev, [key]: Math.max(0, (parseInt(prev[key] ?? 1) || 0) + d) }));
                                      const btn = { padding: '10px 16px', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '14px', lineHeight: 1 };
                                      return (
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
                                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--ink-soft)' }}>{selSub.qtyHelperText || 'Quantity'}</span>
                                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                  <button type="button" onClick={() => bump(-1)} style={btn}>-</button>
                                                  <input type="number" min="0" value={val}
                                                      onChange={(e) => setStepQuantities(prev => ({ ...prev, [key]: e.target.value }))}
                                                      style={{ width: '72px', padding: '10px', border: '1px solid var(--line)', textAlign: 'center', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none' }} />
                                                  <button type="button" onClick={() => bump(1)} style={btn}>+</button>
                                              </div>
                                          </div>
                                      );
                                  })()}
                              </div>
                              );
                          })()}

                          {/* Compound step: an optional second "Finish" dropdown applied to the
                              selected (visible) item's mesh. The finish set is scoped to the chosen
                              Style option when that option carries its own finishAllowedOptions
                              (e.g. Wood rod -> wood-clear finishes, Metal rod -> metal finishes);
                              otherwise it falls back to the step-level finish list. */}
                          {/* Never on SIZE steps: they're selectors, not parts — a finish grid here
                              (stray finishDataSource from "Apply finishes to all steps") captured
                              clicks meant for the pole step's finish and confused the pole render. */}
                          {currentStep.finishDataSource && currentStep.type !== SIZE_STEP_TYPE && currentStep.type !== 'PROJ_SELECT' && !poleFinishLivesOnMaterialStep(currentStep) && (() => {
                              const selStyleId = dynamicConfigParams[currentStep.id];
                              const selOpt = (currentStep.styleOptions || []).find(o => (o.optId || o.partId) === selStyleId);
                              const scopedFinishes = (selOpt && Array.isArray(selOpt.finishAllowedOptions) && selOpt.finishAllowedOptions.length)
                                  ? selOpt.finishAllowedOptions
                                  : (currentStep.finishAllowedOptions || []);
                              const finishOpts = getOptionsForStep({ ...currentStep, type: 'DROPDOWN', dataSource: currentStep.finishDataSource, allowedOptions: scopedFinishes, geometryMap: {}, styleOptions: [] });
                              const selFinish = dynamicConfigParams[`${currentStep.id}__finish`] || '';
                              return (
                              <div style={{ marginBottom: '20px' }}>
                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Finish</label>
                                  {/* Visual swatch grid of finish textures — replaces the finish dropdown. Click a
                                      swatch to apply; click the selected one again to clear. */}
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: '10px' }}>
                                      {finishOpts.length === 0 && <span style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', gridColumn: '1 / -1' }}>No finishes available for this step.</span>}
                                      {finishOpts.map(opt => {
                                          const on = selFinish === opt.id;
                                          return (
                                              <div key={opt.id} onClick={() => handleParamChange(`${currentStep.id}__finish`, on ? '' : opt.id)} title={opt.itemName}
                                                  style={{ border: `2px solid ${on ? 'var(--brass)' : 'var(--line)'}`, borderRadius: '2px', cursor: 'pointer', overflow: 'hidden', background: on ? 'var(--paper-2)' : '#fff', transition: 'all 0.15s' }}>
                                                  <div style={{ width: '100%', height: '58px', background: opt.finalImageUrl ? `url(${opt.finalImageUrl}) center/cover` : 'var(--paper-2)' }} />
                                                  <div style={{ padding: '4px 6px', fontSize: '0.72rem', color: 'var(--ink)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: on ? 600 : 400 }}>{opt.itemName}</div>
                                              </div>
                                          );
                                      })}
                                  </div>
                              </div>
                              );
                          })()}

                          {currentStep.type === 'STATIC_FEE' && (
                              <div style={{ padding: '24px', background: 'var(--paper)', border: '1px dashed var(--line)', textAlign: 'center', marginBottom: '20px' }}>
                                  <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--ink)' }}>
                                      {(currentStep.priceOverride || currentStep.basePrice) ? `+$${parseFloat(currentStep.priceOverride || currentStep.basePrice).toFixed(2)} ea` : 'Variable Fee'}
                                  </div>
                                  <div style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginTop: '8px' }}>
                                      Adjust step quantity below to calculate total fee.
                                  </div>
                              </div>
                          )}

                      </div>

                      {/* 📌 PINNED (Stuart 2026-07-26): the Dimensional Input + Step Quantity stick to the
                          bottom of the screen while long finish lists scroll — the pole length and its computed
                          feet can never hide under the chips. */}
                      <div style={{ position: 'sticky', bottom: 0, zIndex: 5, background: 'var(--paper)', boxShadow: '0 -10px 18px rgba(28,26,22,0.10)' }}>
                          {(currentStep.calculatorTemplate || currentStep.type === 'DIMENSIONS' || currentStep.type === 'VISUAL_DIMENSIONS') && (
                              <div style={{ padding: '20px', background: activeDraftSvg ? '#eef0f2' : 'var(--paper-2)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', marginBottom: 0, opacity: activeDraftSvg ? 0.7 : 1 }}>
                                  <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.2rem', fontWeight: 500 }}>Dimensional Input</h4>
                                  {activeDraftSvg && <div style={{ fontSize: '10px', fontFamily: 'var(--mono)', color: 'var(--brass)', textTransform: 'uppercase', marginBottom: '12px' }}>Locked (Controlled by Vision Tool)</div>}
                                  
                                  {(currentStep.calculatorTemplate === 'calc_french_return_1in' || currentStep.calculatorTemplate === 'calc_straight_pole' || currentStep.calculatorTemplate === 'calc_curved_bay') && (
                                      <div style={{ display: 'flex', gap: '16px' }}>
                                          {currentStep.calculatorTemplate !== 'calc_straight_pole' && (
                                              <div style={{ flex: 1 }}>
                                                  <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Measurement Type</label>
                                                  <select 
                                                      value={dimensionInputs[currentStep.id]?.type || 'O2O'} 
                                                      onChange={(e) => handleDimensionChange(currentStep.id, 'type', e.target.value, currentStep.calculatorTemplate)}
                                                      disabled={!!activeDraftSvg}
                                                      style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', outline: 'none', fontFamily: 'var(--sans)', cursor: activeDraftSvg ? 'not-allowed' : 'pointer', background: activeDraftSvg ? 'transparent' : '#fff' }}
                                                  >
                                                      <option value="O2O">A. Outside Edge to Outside Edge (O2O)</option>
                                                      <option value="C2C">B. Center to Center (C2C)</option>
                                                  </select>
                                              </div>
                                          )}
                                          <div style={{ flex: 1 }}>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Finished Length (in)</label>
                                              <input 
                                                  type="number" min="0" placeholder="e.g. 84"
                                                  value={dimensionInputs[currentStep.id]?.length || ''} 
                                                  onChange={(e) => handleDimensionChange(currentStep.id, 'length', e.target.value, currentStep.calculatorTemplate)}
                                                  disabled={!!activeDraftSvg}
                                                  style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', fontFamily: 'var(--sans)', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }}
                                              />
                                          </div>
                                      </div>
                                  )}

                                  {currentStep.calculatorTemplate === 'calc_mitered_bay' && (
                                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall A (Left)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallA || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallA', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall B (Center)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallB || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallB', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                          <div>
                                              <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Wall C (Right)</label>
                                              <input type="number" min="0" placeholder="Inches" value={dimensionInputs[currentStep.id]?.wallC || ''} onChange={(e) => handleDimensionChange(currentStep.id, 'wallC', e.target.value, currentStep.calculatorTemplate)} disabled={!!activeDraftSvg} style={{ width: '100%', padding: '10px', border: '1px solid var(--line)', boxSizing: 'border-box', outline: 'none', cursor: activeDraftSvg ? 'not-allowed' : 'text', background: activeDraftSvg ? 'transparent' : '#fff' }} />
                                          </div>
                                      </div>
                                  )}

                                  {dimensionInputs[currentStep.id]?.length > 0 && currentStep.calculatorTemplate === 'calc_french_return_1in' && (
                                      <div style={{ marginTop: '16px', fontSize: '0.85rem', color: 'var(--ink-soft)', background: '#fff', padding: '16px', border: '1px solid var(--line)' }}>
                                          <strong style={{display:'block', marginBottom:'8px', color:'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase'}}>Math Logic (1" French Return)</strong> 
                                          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'12px'}}>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', border: '1px solid var(--line)'}}>O2O: {dimensionInputs[currentStep.id].calc_o2o}"</div>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', border: '1px solid var(--line)'}}>C2C: {dimensionInputs[currentStep.id].calc_c2c}"</div>
                                              <div style={{background:'var(--paper)', padding:'8px', textAlign:'center', color:'var(--ink)', border:'1px solid var(--brass)'}}>CUT LENGTH: {dimensionInputs[currentStep.id].calc_cutLength}"</div>
                                          </div>
                                          Calculated Purchase Quantity: <strong>{stepQuantities[currentStep.id] || 1} Feet</strong>.
                                      </div>
                                  )}
                              </div>
                          )}

                      {!currentStep.hideQty && currentStep.type !== SIZE_STEP_TYPE && currentStep.type !== 'PROJ_SELECT' && (
                      <div style={{ padding: '20px 24px', background: 'var(--paper)', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ color: 'var(--ink-soft)', flex: 1, paddingRight: '20px' }}>
                              <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink)', display: 'block', marginBottom: '4px' }}>Step Quantity</span>
                              <span style={{ fontSize: '0.85rem' }}>{currentStep.qtyHelperText || 'Adjust to multiply option logic.'}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <button onClick={() => {
                                  let current = stepQuantities[currentStep.id];
                                  if (current === undefined || current === '') current = activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1;
                                  else current = parseInt(current);
                                  setStepQuantities({...stepQuantities, [currentStep.id]: Math.max(0, current - 1)});
                              }} style={{ width: '36px', height: '36px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                              
                              <input 
                                  type="number" 
                                  min="0" 
                                  value={stepQuantities[currentStep.id] !== undefined ? stepQuantities[currentStep.id] : (activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1)} 
                                  onChange={e => {
                                      const val = e.target.value;
                                      setStepQuantities({...stepQuantities, [currentStep.id]: val === '' ? '' : parseInt(val)});
                                  }} 
                                  style={{ width: '60px', padding: '8px', border: '1px solid var(--line)', textAlign: 'center', fontSize: '1.1rem', fontFamily: 'var(--sans)', outline: 'none' }} 
                              />
                              
                              <button onClick={() => {
                                  let current = stepQuantities[currentStep.id];
                                  if (current === undefined || current === '') current = activeBomPins.find(p => p.partId === currentStep.linkedPinId)?.defaultQty || 1;
                                  else current = parseInt(current);
                                  setStepQuantities({...stepQuantities, [currentStep.id]: current + 1});
                              }} style={{ width: '36px', height: '36px', background: '#fff', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontSize: '1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                          </div>
                      </div>
                      )}
                      </div>

                      <div style={{ padding: '24px', display: 'flex', justifyContent: 'space-between', background: '#fff' }}>
                          <button onClick={handleBackStep} disabled={currentStepIndex === 0} style={{ padding: '12px 24px', border: '1px solid var(--line)', background: 'transparent', color: currentStepIndex === 0 ? 'var(--line)' : 'var(--ink)', cursor: currentStepIndex === 0 ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Back</button>
                          
                          {hasNextActiveStep ? (
                              <button onClick={handleNextStep} disabled={currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE'} style={{ padding: '12px 24px', border: 'none', background: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'var(--line)' : 'var(--ink)', color: '#fff', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Next Step</button>
                          ) : (
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                  <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>Total QTY:</span>
                                  <input type="number" min="1" value={assemblyQty} onChange={e => setAssemblyQty(parseInt(e.target.value)||1)} style={{ width: '60px', padding: '8px', border: '1px solid var(--line)', outline: 'none' }} />
                                  <button onClick={handleAddToCart} disabled={currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE'} style={{ padding: '12px 24px', border: 'none', background: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'var(--line)' : 'var(--brass)', color: '#fff', cursor: currentStep.required && !dynamicConfigParams[currentStep.id] && currentStep.type !== 'DIMENSIONS' && currentStep.type !== 'STATIC_FEE' ? 'not-allowed' : 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>Add to Quote Cart</button>
                              </div>
                          )}
                      </div>
                  </div>
              )}

              {!activeFlowId && productType && (
                 <div style={{ background: '#fff', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                    <div style={{ padding: '16px 20px', background: 'var(--paper-2)', color: 'var(--ink)', fontFamily: 'var(--mono)', fontSize: '10px', letterSpacing: '.1em', textTransform: 'uppercase', borderBottom: '1px solid var(--line)' }}>Step 2: Select Approved Design</div>
                    <div style={{ padding: '24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '16px', maxHeight: '300px', overflowY: 'auto' }}>
                       {liveAssemblies.filter(a => a.manufacturingSpecs?.productType === productType).length === 0 ? <span style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>No approved assemblies found.</span> : (
                           liveAssemblies.filter(a => a.manufacturingSpecs?.productType === productType).map(asm => (
                              <button key={asm.id} onClick={() => setActiveAssemblyId(asm.id)} style={{ padding: '16px', background: activeAssemblyId === asm.id ? 'var(--paper-2)' : '#fff', color: 'var(--ink)', border: `1px solid ${activeAssemblyId === asm.id ? 'var(--brass)' : 'var(--line)'}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', transition: 'all 0.2s' }}>
                                 <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--ink-soft)' }}>{asm.legacyErpId !== "PENDING" ? asm.legacyErpId : asm.itemId}</div>
                                 <div style={{ textAlign: 'center', fontFamily: 'var(--sans)', fontSize: '0.9rem' }}>{asm.itemName}</div>
                              </button>
                           ))
                       )}
                    </div>
                    {activeAssemblyId && (
                         <div style={{ padding: '20px 24px', borderTop: '1px solid var(--line)', background: '#fff' }}>
                             <button onClick={() => setShowCheckoutModal(true)} style={{ width: '100%', padding: '16px', border: 'none', background: 'var(--brass)', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>Finish Hardware Configuration</button>
                         </div>
                    )}
                 </div>
              )}
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', minHeight: '800px' }}>
              <div style={{ flexShrink: 0, background: '#fff', border: '1px solid var(--line)', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                  
                  <div style={{ padding: '20px 24px', background: 'var(--paper)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 999, borderBottom: '1px solid var(--line)' }}>
                      <div style={{ color: 'var(--ink)', fontSize: '1.2rem', fontFamily: 'var(--serif)', fontWeight: 500 }}>
                          Live {viewMode} Engine
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      {viewMode === '3D' && activeAssembly?.manufacturingSpecs?.cadUrl && (
                          /* TEMP (Stage 0/1 debug): visibility bypass + option-highlight. Remove before merge. */
                          <>
                          <label title="Debug: render the full glb, ignoring hidden-until-chosen" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: debugShowAll ? 'var(--brass)' : 'var(--ink-soft)' }}>
                              <input type="checkbox" checked={debugShowAll} onChange={e => setDebugShowAll(e.target.checked)} style={{ cursor: 'pointer' }} />
                              Show all
                          </label>
                          <label title="Debug: glow the meshes this step's selected option controls" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: debugHighlight ? 'var(--brass)' : 'var(--ink-soft)' }}>
                              <input type="checkbox" checked={debugHighlight} onChange={e => setDebugHighlight(e.target.checked)} style={{ cursor: 'pointer' }} />
                              Highlight
                          </label>
                          <button onClick={() => { const v = captureFnRef.current && captureFnRef.current(); if (v) setCapturedViews(v); else alert('Capture not ready — give the model a moment to load, then try again.'); }} title="Capture Front + Back images of this configuration for the production packet" style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: capturedViews ? 'var(--brass)' : 'var(--ink)', background: 'transparent', border: '1px solid var(--line)', padding: '5px 10px' }}>📷 Capture Views</button>
                          </>
                      )}
                      <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: '2px', overflow: 'hidden', background: '#fff' }}>
                          <button onClick={() => setViewMode('2D')} style={{ padding: '8px 16px', background: viewMode === '2D' ? 'var(--ink)' : 'transparent', color: viewMode === '2D' ? '#fff' : 'var(--ink)', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', transition: 'all 0.2s' }}>2D</button>
                          <button onClick={() => setViewMode('3D')} disabled={!activeAssembly?.manufacturingSpecs?.cadUrl} style={{ padding: '8px 16px', background: viewMode === '3D' ? 'var(--ink)' : 'transparent', color: viewMode === '3D' ? '#fff' : 'var(--ink-soft)', border: 'none', cursor: activeAssembly?.manufacturingSpecs?.cadUrl ? 'pointer' : 'not-allowed', opacity: activeAssembly?.manufacturingSpecs?.cadUrl ? 1 : 0.5, fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', transition: 'all 0.2s' }}>3D</button>
                      </div>
                      </div>
                  </div>
                  
                  <div style={{ height: '440px', flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)' }}>
                      {!activeAssembly ? (
                          <div style={{ color: 'var(--ink-soft)', textAlign: 'center', zIndex: 1 }}>
                              <div style={{ fontSize: '2rem', marginBottom: '16px', opacity: 0.5 }}>⚙️</div>
                              <h3 style={{ margin: 0, fontFamily: 'var(--serif)', fontWeight: 500, fontSize: '1.4rem' }}>Visual Engine Ready</h3>
                              <p style={{ fontSize: '0.9rem', maxWidth: '300px', margin: '12px auto' }}>Select a flow and assembly to begin configuration.</p>
                          </div>
                      ) : viewMode === '3D' ? (
                         <>
                         <Canvas camera={{ position: [5, 5, 5], fov: 50 }} dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} style={{ width: '100%', height: '100%' }}>
                              <ViewCapturer onReady={registerCapture} />
                              <StudioRig />
                              <OrbitControls makeDefault />
                              <Bounds fit clip margin={1.2}>
                                  {/* Size-matrix visual: scale the model by the chosen rod diameter
                                      RELATIVE to the master GLB's own native dia (renderScaleOf) — the
                                      dia the master was built at renders exactly 1.0 (H2 generates from
                                      the 1-3/8" master → 138 = native, ¾" = 1/1.833); H1's ¾"-native
                                      masters resolve to masterScale 1, keeping their scale unchanged. */}
                                  <group scale={renderScaleOf(activeFlow, dynamicConfigParams, activeAssembly)}>
                                      <DynamicModel
                                          url={activeAssembly.manufacturingSpecs.cadUrl}
                                          textureOverrides={textureOverrides}
                                          visibilityOverrides={debugShowAll ? {} : visibilityOverrides}
                                          cloneSpecs={cloneSpecs}
                                          highlightOverrides={highlightOverrides}
                                          onVisAudit={handleVisAudit}
                                      />
                                  </group>
                              </Bounds>
                          </Canvas>
                          {/* RENDER-MAP AUDIT (HQ-only surface — the portal renders its own mirror).
                              An option can select, price and BOM while controlling no geometry: its
                              map names nodes the model doesn't have (stale after a re-import/rename/
                              re-namespace). That used to read as "the part won't render" with nothing
                              to go on — now it names itself. */}
                          {!debugShowAll && visAudit.length > 0 && (
                              <div style={{ marginTop: '8px', padding: '10px 14px', border: '1px solid #b00020', background: 'rgba(176,0,32,0.05)', fontFamily: 'var(--mono)', fontSize: '10px', color: '#b00020', lineHeight: 1.6 }}>
                                  ⚠ {visAudit.length} mapped node name{visAudit.length === 1 ? '' : 's'} not found in this model — by owner: {(() => { const g = {}; visAudit.forEach(t => { const o = visTokenOwners[t] || 'unattributed'; (g[o] = g[o] || []).push(t); }); return Object.entries(g).map(([o, ts]) => `${o} (${ts.length}: ${ts.slice(0, 2).join(', ')}${ts.length > 2 ? '…' : ''})`).join(' · '); })()}.
                                  The option(s) naming them will select and price but render nothing. Rendering model: {activeAssembly?.id || '?'} · {String(activeAssembly?.manufacturingSpecs?.cadUrl || '').split('/').pop().split('?')[0] || 'no cadUrl'} — if 1.6 Load Choices shows a DIFFERENT doc/file for this assembly name, the flow is linked to the wrong record (fix in flow settings), not a naming problem.
                              </div>
                          )}
                          {capturedViews && (
                              <div style={{ position: 'absolute', bottom: '12px', right: '12px', display: 'flex', gap: '8px', background: 'rgba(255,255,255,0.92)', border: '1px solid var(--line)', borderRadius: '2px', padding: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', zIndex: 50 }}>
                                  {['front', 'back'].map(k => (
                                      <div key={k} style={{ textAlign: 'center' }}>
                                          <img src={capturedViews[k]} alt={`${k} view`} style={{ width: '120px', height: '80px', objectFit: 'contain', border: '1px solid var(--line)', background: '#fff' }} />
                                          <div style={{ fontFamily: 'var(--mono)', fontSize: '8px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginTop: '2px', letterSpacing: '.05em' }}>{k}</div>
                                      </div>
                                  ))}
                                  <button onClick={() => setCapturedViews(null)} title="Clear captured views" style={{ background: 'transparent', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: '14px', alignSelf: 'flex-start' }}>×</button>
                              </div>
                          )}
                          </>
                      ) : (
                          <div style={{ position: 'absolute', inset: '30px' }}>
                              {get2DRenderLayers().map((layer, idx) => (
                                  <div key={idx} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: layer.zIndex }}>
                                      {layer.textureUrl ? (
                                          <img src={layer.textureUrl} alt={layer.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                                      ) : (
                                          <div style={{ width: '100%', height: '100%', border: '1px dashed var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontFamily: 'var(--sans)', fontSize: '0.85rem', textAlign: 'center' }}>
                                              {layer.name}<br/>(Missing Asset)
                                          </div>
                                      )}
                                  </div>
                              ))}
                          </div>
                      )}
                      

                  </div>
              </div>

              <div style={{ background: '#fff', border: '1px solid var(--line)', padding: '30px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '28px', borderRadius: '2px', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
                  {activeDraftId && (() => {
                      const d = previousDrafts.find(x => x.id === activeDraftId);
                      const n = d?.specs?.engineeringNotes;
                      return n ? <EngineeringSpecsStrip draft={d} notes={n} parts={[...libraryParts, ...liveAssemblies]} /> : <div style={{ flex: 1 }} />;
                  })()}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'right', fontSize: '0.85rem', width: '300px', flexShrink: 0 }}>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', borderBottom: '1px solid var(--line)', paddingBottom: '6px', marginBottom: '6px', color: 'var(--ink)', display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                          <span>Pricing Breakdown</span>
                          {priceLevel !== 'STANDARD' && <span style={{ color: 'var(--brass)' }}>{priceLevelShort(priceLevel)}</span>}
                      </div>
                      <div style={{ maxHeight: '80px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px', paddingRight: '10px' }}>
                          {pricingBreakdown.map((item, i) => (
                              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end', gap: '20px' }}>
                                  <span style={{ color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '200px' }}>{item.name} (x{item.qty})</span>
                                  <span style={{ color: 'var(--ink)', minWidth: '60px' }}>${item.total.toFixed(2)}</span>
                              </div>
                          ))}
                      </div>
                      <div style={{ borderTop: '1px solid var(--line)', marginTop: '6px', paddingTop: '8px', fontSize: '0.9rem', color: 'var(--ink-soft)' }}>
                          Total Dynamic Sum: <span style={{ color: 'var(--ink)', marginLeft: '8px' }}>${pricing.base.toFixed(2)}</span>
                      </div>
                      <div style={{ borderTop: '2px solid var(--ink)', marginTop: '12px', paddingTop: '12px' }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '4px' }}>Estimated Unit Price</div>
                          <div style={{ fontFamily: 'var(--serif)', fontSize: '2.1rem', fontWeight: 500, color: 'var(--ink)' }}>${pricing.finalPrice.toFixed(2)}</div>
                      </div>
                      {(() => {
                          const d = tradeDiscountFor({ priceLevel, pricingBreakdown, pricing });
                          return d ? (
                              <div style={{ borderTop: '1px solid var(--line)', marginTop: '8px', paddingTop: '8px', fontSize: '0.85rem' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', color: 'var(--brass)' }}>
                                      <span>Trade Discount - ({d.percent}%)</span><span>-${d.amount.toFixed(2)}</span>
                                  </div>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', color: 'var(--ink)', fontWeight: 500, marginTop: '4px' }}>
                                      <span>Net Unit Total</span><span>${(pricing.finalPrice - d.amount).toFixed(2)}</span>
                                  </div>
                              </div>
                          ) : null;
                      })()}
                  </div>
              </div>
          </div>
      </div>

      {showCartSuccessModal && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
              <div style={{ background: '#fff', width: '450px', padding: '30px', borderRadius: '4px', boxShadow: '0 12px 48px rgba(0,0,0,0.2)', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '16px' }}>✅</div>
                  <h2 style={{ margin: '0 0 12px 0', fontFamily: 'var(--serif)', fontSize: '1.8rem', color: 'var(--ink)' }}>Added to Quote Cart</h2>
                  <p style={{ fontSize: '1rem', color: 'var(--ink-soft)', marginBottom: '30px', lineHeight: '1.5' }}>
                      Your configured assembly has been saved to the cart. What would you like to do next?
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <button onClick={() => setShowCartSuccessModal(false)} style={{ padding: '16px', background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                          Configure Another Item Here
                      </button>
                      <button onClick={() => {
                          setShowCartSuccessModal(false);
                          window.dispatchEvent(new CustomEvent('NAVIGATE_TAB', { detail: 'VISION' }));
                      }} style={{ padding: '16px', background: 'var(--ink)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}>
                          Draw Next Item in Vision Tool
                      </button>
                      <button onClick={() => { setShowCartSuccessModal(false); setShowCheckoutModal(true); }} style={{ padding: '16px', background: 'var(--brass)', border: 'none', color: '#fff', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s', marginTop: '12px' }}>
                          Proceed to Checkout
                      </button>
                  </div>
              </div>
          </div>
      )}

      {showCloneModal && (
        <div onClick={() => setShowCloneModal(false)} style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', border: '1px solid var(--line)', width: '560px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.15)', borderRadius: '2px' }}>
                <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Resume a Saved Draft</h2>
                    <button onClick={() => setShowCloneModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>
                <div style={{ padding: '20px 30px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {previousDrafts.length === 0 && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', fontStyle: 'italic', padding: '20px 0', textAlign: 'center' }}>No saved drafts for this brand.</div>
                    )}
                    {[...previousDrafts]
                        .sort((a, b) => (a.status === 'CONFIGURED' ? 1 : 0) - (b.status === 'CONFIGURED' ? 1 : 0))
                        .map(draft => {
                            const isConfigured = draft.status === 'CONFIGURED';
                            return (
                                <div key={draft.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', border: `1px solid ${isConfigured ? '#4CAF50' : 'var(--line)'}`, background: isConfigured ? '#f0fdf4' : 'var(--paper-2)', padding: '12px 14px' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{draft.sidemark || draft.jobName || 'Unnamed Line'}</div>
                                        <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-soft)', marginTop: '4px' }}>
                                            {draft.category || 'HARDWARE'}{draft.jobName && draft.sidemark ? ` · ${draft.jobName}` : ''}{isConfigured ? ' · ✅ Configured' : ''}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                        <button onClick={() => handleResumeDraft(draft.id)} style={{ padding: '8px 16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em' }}>{isConfigured ? 'Reopen' : 'Configure'}</button>
                                        <button onClick={() => handleDeleteDraft(draft.id)} title="Delete draft" style={{ padding: '8px 10px', background: 'transparent', color: 'var(--ink-soft)', border: '1px solid var(--line)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '12px' }}>×</button>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
      )}

      {showCheckoutModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ background: '#fff', border: '1px solid var(--line)', width: '550px', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 48px rgba(0,0,0,0.1)', borderRadius: '2px' }}>
                <div style={{ padding: '24px 30px', background: 'var(--paper-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--line)' }}>
                    <h2 style={{ margin: 0, fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 500, color: 'var(--ink)' }}>Finalize & Assign Quote</h2>
                    <button onClick={() => setShowCheckoutModal(false)} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                </div>
                
                <div style={{ padding: '30px', flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', maxHeight: '80vh', overflowY: 'auto' }}>
                    
                    {(() => {
                        const gross = cart.reduce((sum, item) => sum + (item.pricing.finalPrice * item.qty), 0);
                        const discTotal = cart.reduce((sum, item) => { const d = tradeDiscountFor(item); return sum + (d ? d.amount * item.qty : 0); }, 0);
                        return (
                            <div style={{ padding: '24px', background: 'var(--paper)', border: '1px solid var(--line)', textAlign: 'center' }}>
                                <div style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: '8px' }}>Cart Total ({cart.length} Items)</div>
                                {discTotal > 0 && (
                                    <div style={{ fontSize: '0.9rem', marginBottom: '6px' }}>
                                        <span style={{ color: 'var(--ink-soft)', textDecoration: 'line-through', marginRight: '10px' }}>${gross.toFixed(2)}</span>
                                        <span style={{ color: 'var(--brass)' }}>Trade Discount: -${discTotal.toFixed(2)}</span>
                                    </div>
                                )}
                                <div style={{ fontFamily: 'var(--serif)', fontSize: '2.4rem', fontWeight: 500, color: 'var(--ink)' }}>
                                    ${(gross - discTotal).toFixed(2)}
                                </div>
                            </div>
                        );
                    })()}

                    <div>
                        <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>* Verify Customer</label>
                        <select value={jobData.customerId} onChange={e => setJobData({...jobData, customerId: e.target.value})} disabled={!!activeMasterQuoteId} style={{ width: '100%', padding: '12px', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', background: activeMasterQuoteId ? 'transparent' : '#fff', fontFamily: 'var(--sans)', cursor: activeMasterQuoteId ? 'not-allowed' : 'pointer' }}>
                            <option value="">-- Choose Customer --</option>
                            {[...combinedCustomers].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(c => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                        </select>
                    </div>

                    {jobData.customerId && (
                        <div style={{ background: '#fff', padding: '24px', border: '1px solid var(--line)' }}>
                            <h4 style={{ margin: '0 0 16px 0', fontFamily: 'var(--serif)', fontSize: '1.4rem', fontWeight: 500 }}>Shipping Destination</h4>
                            
                            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                                <button 
                                    onClick={() => {
                                        const cust = combinedCustomers.find(c => c.id === jobData.customerId);
                                        const defaultId = cust?.shippingAddresses?.[0]?.addressBookId || '';
                                        setJobData({...jobData, shippingMethod: 'SAVED', shippingAddressId: defaultId});
                                    }} 
                                    style={{ flex: 1, padding: '12px', background: jobData.shippingMethod === 'SAVED' ? 'var(--ink)' : '#fff', color: jobData.shippingMethod === 'SAVED' ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                >
                                    Saved Addresses
                                </button>
                                <button 
                                    onClick={() => setJobData({...jobData, shippingMethod: 'CUSTOM', shippingAddressId: ''})} 
                                    style={{ flex: 1, padding: '12px', background: jobData.shippingMethod === 'CUSTOM' ? 'var(--ink)' : '#fff', color: jobData.shippingMethod === 'CUSTOM' ? '#fff' : 'var(--ink)', border: '1px solid var(--ink)', cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'all 0.2s' }}
                                >
                                    Custom Drop-Ship
                                </button>
                            </div>

                            {jobData.shippingMethod === 'SAVED' ? (
                                <div>
                                    {(!combinedCustomers.find(c => c.id === jobData.customerId)?.shippingAddresses?.length) ? (
                                        <div style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', fontStyle: 'italic', padding: '16px', background: 'var(--paper)', border: '1px solid var(--line)' }}>
                                            No synced NetSuite addresses found for this customer. Please use Custom Drop-Ship.
                                        </div>
                                    ) : (
                                        <select 
                                            value={jobData.shippingAddressId} 
                                            onChange={e => setJobData({...jobData, shippingAddressId: e.target.value})}
                                            style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff', cursor: 'pointer' }}
                                        >
                                            <option value="">-- Select Saved Address --</option>
                                            {combinedCustomers.find(c => c.id === jobData.customerId)?.shippingAddresses.map(addr => (
                                                <option key={addr.addressBookId} value={addr.addressBookId}>
                                                    {addr.label} - {addr.addr1}, {addr.city} {addr.state}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input placeholder="Attention / Contact Name" value={jobData.customShippingAddress.attention} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, attention: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input placeholder="Addressee / Company Name" value={jobData.customShippingAddress.addressee} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addressee: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input placeholder="Street Address 1" value={jobData.customShippingAddress.addr1} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addr1: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                    <div style={{ gridColumn: 'span 2' }}>
                                        <input placeholder="Street Address 2 (Suite, Unit, etc.)" value={jobData.customShippingAddress.addr2} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, addr2: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                    <div>
                                        <input placeholder="City" value={jobData.customShippingAddress.city} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, city: e.target.value}})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <input placeholder="State" value={jobData.customShippingAddress.state} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, state: e.target.value}})} style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                        <input placeholder="Zip" value={jobData.customShippingAddress.zip} onChange={e => setJobData({...jobData, customShippingAddress: {...jobData.customShippingAddress, zip: e.target.value}})} style={{ flex: 1, padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', outline: 'none', background: '#fff' }} />
                                    </div>
                                </div>
                            )}

                            <div style={{ marginTop: '20px' }}>
                                <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Shipping Charge ($, Optional)</label>
                                <input type="number" min="0" step="0.01" placeholder="0.00" value={jobData.shippingAmount ?? ''} onChange={e => setJobData({...jobData, shippingAmount: e.target.value})} style={{ width: '100%', padding: '12px', border: '1px solid var(--line)', boxSizing: 'border-box', fontFamily: 'var(--sans)', fontSize: '0.95rem', outline: 'none', background: '#fff' }} />
                                <div style={{ fontSize: '0.8rem', color: 'var(--ink-soft)', marginTop: '6px', fontStyle: 'italic' }}>Charged on top of the quote total — lands in the NetSuite estimate's shipping cost field on push.</div>
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Project / Job Name (Optional)</label>
                            <input type="text" placeholder="e.g. Master Suite Reno" disabled={!!activeMasterQuoteId} value={jobData.jobName} onChange={e => setJobData({...jobData, jobName: e.target.value})} style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', background: activeMasterQuoteId ? 'transparent' : '#fff', cursor: activeMasterQuoteId ? 'not-allowed' : 'text' }} />
                        </div>
                        <div>
                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Order Sidemark (Optional)</label>
                            <input type="text" placeholder="e.g. Smith Residence" value={jobData.sidemark} onChange={e => setJobData({...jobData, sidemark: e.target.value})}
                                title="Prints at the header of the quote, sales order and packing slip (NetSuite estimate memo)."
                                style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
                        </div>
                    </div>

                    {/* PO # + INTERNAL MEMO (Eric 2026-08-11, App Imp): PO # → the NetSuite
                        estimate's PO field (otherrefnum); Internal Memo → custbody_bit_internalmemo.
                        Internal only — neither prints on customer documents from here. */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Customer PO # (Optional)</label>
                            <input type="text" placeholder="e.g. PO-48213" value={jobData.poNumber || ''} onChange={e => setJobData({...jobData, poNumber: e.target.value})}
                                title="Pushes to the NetSuite estimate's PO # field (otherrefnum)."
                                style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
                        </div>
                        <div>
                            <label style={{ fontFamily: 'var(--mono)', fontSize: '10px', textTransform: 'uppercase', color: 'var(--ink-soft)', display: 'block', marginBottom: '8px' }}>Internal Memo (Optional)</label>
                            <input type="text" placeholder="Internal note — rides to NetSuite's internal memo" value={jobData.internalMemo || ''} onChange={e => setJobData({...jobData, internalMemo: e.target.value})}
                                title="Pushes to NetSuite's Internal Memo (custbody_bit_internalmemo). Never prints on customer documents."
                                style={{ width: '100%', padding: '12px', fontFamily: 'var(--sans)', fontSize: '1rem', border: '1px solid var(--line)', outline: 'none', boxSizing: 'border-box', background: '#fff' }} />
                        </div>
                    </div>

                    {/* ADD-ONS — the last step before committing. Fees that nobody wants to model as
                        a flow step (rush, packaging, shipping, strike-offs, colour upcharges) are
                        picked here and each becomes its own line on the order. Percentage fees read
                        the configured subtotal shown below them, so the number moves with the cart. */}
                    <AddOnPicker
                        catalog={addOnCatalog}
                        selections={addOnSel}
                        onChange={setAddOnSel}
                        configSubtotal={cart.reduce((s, it) => { const d = tradeDiscountFor(it); return s + ((it.pricing?.finalPrice || 0) - (d ? d.amount : 0)) * (it.qty || 1); }, 0)}
                        title="Add-ons & fees — added as their own lines"
                        note={`Percentages are worked out from the configured subtotal (${cart.length} item${cart.length === 1 ? '' : 's'}, before fees and shipping). Fees a flow already bills are untouched — this is for the ones that aren't steps.`}
                    />

                    <button onClick={handleFinalizeQuote} style={{ width: '100%', padding: '16px', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer', marginTop: '16px', fontFamily: 'var(--mono)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.1em', transition: 'background 0.2s' }}>
                        Submit Quote to Pipeline
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
};

export default CPQTab;