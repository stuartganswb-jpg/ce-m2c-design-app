// DISPLAY MODE — THE BOARD FRAME OVER THE CPQ 3D PANE (Stuart 2026-09-13)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "a button to set the cpq window mode into display creator, then set the scale say the board is
//  24" wide x 24" tall then the cpq window is set to that scale so we could zoom and set them to go
//  as close to the edge of the display as we would like. right now we need to guess."
//
// The frame IS the board, drawn over the 3D pane. What sits inside it is where it sits on the
// board; Add configuration captures exactly the frame, and the display designer lays that
// picture over the whole face. No guessing, no re-fitting.
//
// THE FRAME IS PINNED TO THE PANE, THE HARDWARE MOVES INSIDE IT (Stuart's first test, 13 Sep:
// "as i scale in and out on the hardware config the frame window zooms with it so i am not able to
// change the scale of the hardware"). The first cut anchored the frame to the model's world, which
// locked the rod at its true inches on the board and gave the operator no say. Now the frame is the
// largest board that fits the pane, centred, and never moves; zoom / rotate / pan move only the
// hardware. The truth is still shown, not enforced: the label reads what the drawn rod measures on
// this board ("rod reads 21.4" · true 16.75"") and ⌖ True scale moves the camera to the distance
// where it reads its ordered inches. The reading rides on the cart line so the designer can show
// when a row was placed off scale.
//
// THE READING IS THE ORDERED LENGTH, NOT THE MODEL'S. The pane draws a rod as modelled (a 4 ft
// master) and only stretches a long order by a fixed ratio, so world units are not inches of the
// order. The one true statement is "this drawn rod IS `lengthInches` long".
//
// Pure math here (node-tested); the r3f component and the capture below read it.

import { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const N = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const visibleHeightAt = (depth, fovDeg) => 2 * depth * Math.tan((fovDeg * Math.PI / 180) / 2);

/**
 * The board pinned to the pane: the largest W:H rectangle that fits `pane` (css px) inside
 * `margin` of it, centred. Returns { x, y, w, h, pxPerInch } or null without a pane.
 */
export function fixedBoardFrame({ widthIn, heightIn, pane, margin = 0.92 }) {
    const W = N(widthIn) > 0 ? N(widthIn) : 24;
    const H = N(heightIn) > 0 ? N(heightIn) : 24;
    const paneW = N(pane?.w), paneH = N(pane?.h);
    if (!(paneW > 0 && paneH > 0)) return null;
    const m = N(margin, 0.92) > 0 && N(margin, 0.92) <= 1 ? N(margin, 0.92) : 0.92;
    const pxPerInch = Math.min(paneW * m / W, paneH * m / H);
    const w = W * pxPerInch, h = H * pxPerInch;
    return { x: (paneW - w) / 2, y: (paneH - h) / 2, w, h, pxPerInch };
}

/**
 * What the drawn model's long axis measures on the board, in inches: its projected length in
 * pane px at the model's depth over the frame's px-per-inch. `model` = { longAxisWorld,
 * centerDepth } (world units, depth = distance from the camera along its view axis).
 * Returns null when there is nothing to measure.
 */
export function boardReading({ model, pane, fovDeg = 50, frame }) {
    const depth = N(model?.centerDepth), longW = N(model?.longAxisWorld), paneH = N(pane?.h);
    const ppi = N(frame?.pxPerInch);
    if (!(depth > 0 && longW > 0 && paneH > 0 && ppi > 0)) return null;
    const projectedPx = paneH * longW / visibleHeightAt(depth, fovDeg);
    return projectedPx / ppi;
}

/**
 * The camera depth (distance from the model centre along the view axis) at which the drawn long
 * axis reads exactly `lengthInches` on the board. null when there is no length or nothing drawn.
 */
export function depthForTrueScale({ longAxisWorld, lengthInches, pane, fovDeg = 50, frame }) {
    const L = N(lengthInches), longW = N(longAxisWorld), paneH = N(pane?.h), ppi = N(frame?.pxPerInch);
    if (!(L > 0 && longW > 0 && paneH > 0 && ppi > 0)) return null;
    const visibleH = paneH * longW / (L * ppi);
    return visibleH / (2 * Math.tan((fovDeg * Math.PI / 180) / 2));
}

/** The visible model's long axis and its depth from the camera — the two numbers the reading needs. */
export function measureVisibleModel(scene, camera) {
    if (!scene || !camera) return null;
    scene.updateMatrixWorld(true);
    const effVis = (o) => { let n = o; while (n) { if (!n.visible) return false; n = n.parent; } return true; };
    const box = new THREE.Box3(); const tmp = new THREE.Box3();
    scene.traverse(o => {
        if (!o.isMesh || !o.geometry || !effVis(o)) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
        box.union(tmp);
    });
    if (box.isEmpty()) return null;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
    const centerDepth = center.clone().sub(camera.position).dot(forward);
    return { longAxisWorld: Math.max(size.x, size.y, size.z), centerDepth, center };
}

/**
 * Lives INSIDE the Canvas. Every frame it pins the board frame to the pane, measures the model
 * and the camera, and hands `onRect` the frame with its reading ({ x, y, w, h, pxPerInch,
 * reading, trueInches }). `snapRef.current` becomes the ⌖ True scale action: it dollies the
 * camera along its view axis to the depth where the drawn long axis reads `lengthInches`,
 * keeping the rotation. Renders nothing of its own.
 */
export const BoardFrame = ({ enabled, widthIn, heightIn, lengthInches, onRect, snapRef }) => {
    const { scene, camera, size, controls } = useThree();
    const last = useRef('');
    useFrame(() => {
        if (!enabled) { if (last.current !== 'off') { last.current = 'off'; onRect && onRect(null); } return; }
        const pane = { w: size.width, h: size.height };
        const frame = fixedBoardFrame({ widthIn, heightIn, pane });
        const model = frame ? measureVisibleModel(scene, camera) : null;
        const reading = frame && model ? boardReading({ model, pane, fovDeg: camera.fov || 50, frame }) : null;
        const rect = frame ? { ...frame, reading, trueInches: N(lengthInches) > 0 ? N(lengthInches) : null } : null;
        const key = rect ? [rect.x, rect.y, rect.w, rect.h].map(v => Math.round(v)).join(',') + '|' + (reading == null ? '-' : reading.toFixed(1)) : 'none';
        if (key !== last.current) { last.current = key; onRect && onRect(rect); }
    });
    useEffect(() => {
        if (!snapRef) return undefined;
        snapRef.current = () => {
            const pane = { w: size.width, h: size.height };
            const frame = fixedBoardFrame({ widthIn, heightIn, pane });
            const model = measureVisibleModel(scene, camera);
            const depth = frame && model ? depthForTrueScale({ longAxisWorld: model.longAxisWorld, lengthInches, pane, fovDeg: camera.fov || 50, frame }) : null;
            if (!(depth > 0)) return false;
            // dolly along the view axis: the camera keeps looking where it looked, only the distance changes
            const forward = new THREE.Vector3(); camera.getWorldDirection(forward);
            const delta = model.centerDepth - depth;
            const target = controls?.target;
            if (target) {
                const toTarget = target.clone().sub(camera.position).dot(forward);
                if (toTarget - delta < 0.05) return false;          // would pass through the orbit target
            }
            camera.position.addScaledVector(forward, delta);
            camera.updateProjectionMatrix();
            controls?.update?.();
            return true;
        };
        return () => { snapRef.current = null; };
    }, [snapRef, scene, camera, controls, size.width, size.height, widthIn, heightIn, lengthInches]);
    useEffect(() => () => { onRect && onRect(null); }, [onRect]);
    return null;
};

/**
 * Capture exactly the frame: a transparent render of the canvas, cropped to `rect` (css px of the
 * canvas). A frame larger than the pane is padded transparent so the picture is always the whole
 * board. Returns a PNG data URL, or null.
 */
export function captureBoardFrame(glState, rect, { scale = 1 } = {}) {
    const { gl, scene, camera } = glState || {};
    if (!gl || !scene || !camera || !rect) return null;
    const prevRatio = gl.getPixelRatio();
    const prevBg = scene.background;
    try {
        scene.background = null;
        gl.setPixelRatio(Math.max(prevRatio, scale));
        gl.render(scene, camera);
        const src = gl.domElement;
        const ratio = src.width / Math.max(1, src.clientWidth || (src.width / gl.getPixelRatio()));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(rect.w * ratio));
        out.height = Math.max(1, Math.round(rect.h * ratio));
        const ctx = out.getContext('2d');
        // the part of the frame that is on the canvas, drawn at its offset; the rest stays clear
        const sx = Math.max(0, rect.x), sy = Math.max(0, rect.y);
        const ex = Math.min(rect.x + rect.w, src.clientWidth || src.width / ratio), ey = Math.min(rect.y + rect.h, src.clientHeight || src.height / ratio);
        if (ex > sx && ey > sy) {
            ctx.drawImage(src, sx * ratio, sy * ratio, (ex - sx) * ratio, (ey - sy) * ratio, (sx - rect.x) * ratio, (sy - rect.y) * ratio, (ex - sx) * ratio, (ey - sy) * ratio);
        }
        return out.toDataURL('image/png');
    } catch { return null; } finally {
        scene.background = prevBg;
        gl.setPixelRatio(prevRatio);
        gl.render(scene, camera);
    }
}

export const DISPLAY_MODE_KEY = 'hq_cpq_display_mode';
export const readDisplayMode = () => { try { const v = JSON.parse(localStorage.getItem(DISPLAY_MODE_KEY) || 'null'); return v && typeof v === 'object' ? { on: !!v.on, widthIn: Number(v.widthIn) || 24, heightIn: Number(v.heightIn) || 24 } : { on: false, widthIn: 24, heightIn: 24 }; } catch { return { on: false, widthIn: 24, heightIn: 24 }; } };
export const writeDisplayMode = (v) => { try { localStorage.setItem(DISPLAY_MODE_KEY, JSON.stringify(v)); } catch { /* storage may be unavailable */ } };
