// DISPLAY MODE — THE BOARD FRAME OVER THE CPQ 3D PANE (Stuart 2026-09-13)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "a button to set the cpq window mode into display creator, then set the scale say the board is
//  24" wide x 24" tall then the cpq window is set to that scale so we could zoom and set them to go
//  as close to the edge of the display as we would like. right now we need to guess."
//
// The frame is the board, drawn over the 3D pane at TRUE scale, centred. What sits inside it is
// where it sits on the board; Add configuration captures exactly the frame, and the display
// designer lays that picture over the whole face. No guessing, no re-fitting.
//
// THE SCALE IS THE ORDERED LENGTH, NOT THE MODEL'S. The pane draws a rod as modelled (a 4 ft
// master) and only stretches a long order by a fixed ratio, so world units are not inches of
// the order. The one true statement is "this drawn rod IS `lengthInches` long": world-per-inch =
// the visible model's long axis ÷ the ordered inches, and the board is that many world units
// wide and tall at the model's depth. With no ordered length the GLB's own metres stand in.
//
// Pure math here (node-tested); the r3f component and the capture below read it.

import React, { useRef, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

const METERS_PER_INCH = 0.0254;

/**
 * The frame in pane pixels, centred. `model` = { longAxisWorld, centerDepth } of the visible
 * model (world units, depth = distance from the camera along its view axis); `pane` = { w, h }
 * css px; `fovDeg` the perspective camera's vertical fov.
 * Returns { x, y, w, h, worldPerInch, oversize } — oversize when the board is larger than the
 * pane (zoom out, or capture pads the missing part transparent).
 */
export function boardFrameRect({ widthIn, heightIn, lengthInches, model, pane, fovDeg = 50 }) {
    const W = Number(widthIn) > 0 ? Number(widthIn) : 24;
    const H = Number(heightIn) > 0 ? Number(heightIn) : 24;
    const L = Number(lengthInches) > 0 ? Number(lengthInches) : 0;
    const paneW = Number(pane?.w) || 0, paneH = Number(pane?.h) || 0;
    const depth = Number(model?.centerDepth) || 0;
    const longW = Number(model?.longAxisWorld) || 0;
    if (!(paneW > 0 && paneH > 0 && depth > 0)) return null;
    const worldPerInch = (L > 0 && longW > 0) ? longW / L : METERS_PER_INCH;
    const visibleH = 2 * depth * Math.tan((fovDeg * Math.PI / 180) / 2);
    const visibleW = visibleH * (paneW / paneH);
    const w = paneW * (W * worldPerInch) / visibleW;
    const h = paneH * (H * worldPerInch) / visibleH;
    return { x: (paneW - w) / 2, y: (paneH - h) / 2, w, h, worldPerInch, oversize: w > paneW || h > paneH };
}

/** The visible model's long axis and its depth from the camera — the two numbers the frame needs. */
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
 * Lives INSIDE the Canvas. Every frame it measures the model and the camera, computes the board
 * frame, and hands the rect to `onRect` (which positions the overlay div and remembers the rect
 * for the capture). Renders nothing of its own.
 */
export const BoardFrame = ({ enabled, widthIn, heightIn, lengthInches, onRect }) => {
    const { scene, camera, size } = useThree();
    const last = useRef('');
    useFrame(() => {
        if (!enabled) { if (last.current !== 'off') { last.current = 'off'; onRect && onRect(null); } return; }
        const model = measureVisibleModel(scene, camera);
        const rect = model ? boardFrameRect({ widthIn, heightIn, lengthInches, model, pane: { w: size.width, h: size.height }, fovDeg: camera.fov || 50 }) : null;
        const key = rect ? [rect.x, rect.y, rect.w, rect.h].map(v => Math.round(v)).join(',') : 'none';
        if (key !== last.current) { last.current = key; onRect && onRect(rect); }
    });
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
