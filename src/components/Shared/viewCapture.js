// THE PICTURE TAKEN AT ADD — the 3D view exactly as it was left: no re-framing, rendered once more, on a white ground, as a JPEG
// no wider than 900 px. CPQ takes this picture for every line it adds (HQ/CPQTab.js ViewCapturer, `{ current: true }` — Stuart
// 2026-09-11: "however we set the image when we hit add to cart you should capture that view"); the customer portal takes it
// with this (step 5 of the portal rebuild, Stuart 2026-10-20), so a request reopened in CPQ carries the customer's own picture in
// the field CPQ's lines carry theirs — `renderSnapshot`, what the quote documents print.
// ⚠ CPQTab's ViewCapturer still carries its own copy of these steps — the two must stay alike.
// Browser-only (a canvas); not part of the server's engine copy. Needs the Canvas made with gl.preserveDrawingBuffer.
export const VIEW_PICTURE_MAX_WIDTH = 900;
export const VIEW_PICTURE_QUALITY = 0.85;

/** The view as it stands, as a white-ground JPEG data URL — or null when the canvas has no size yet. */
export function currentViewPictureOf(gl, scene, camera) {
    gl.render(scene, camera);
    const src = gl.domElement;
    if (!src || !src.width || !src.height) return null;
    const scale = Math.min(1, VIEW_PICTURE_MAX_WIDTH / src.width);
    const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
    const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
    const ctx = oc.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(src, 0, 0, w, h);
    return oc.toDataURL('image/jpeg', VIEW_PICTURE_QUALITY);
}
