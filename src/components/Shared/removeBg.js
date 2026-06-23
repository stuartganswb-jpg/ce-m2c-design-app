// In-browser background knockout for swatch images (paint chips / textures with a clean, uniform
// background). No dependency, nothing leaves the browser. Strategy: sample the four corners to learn
// the background color, then FLOOD-FILL inward from every border pixel, clearing only background-
// connected pixels within a color tolerance. Flooding from the edges (rather than a global color
// match) means an interior region that happens to match the background is NOT punched out. A short
// feather band past the tolerance ramps alpha so cut edges aren't jagged.

const loadImage = (src) => new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
});

// Returns a PNG Blob with the background made transparent. On any failure, resolves to the original file.
export async function removeImageBackground(file, opts = {}) {
    const tolerance = opts.tolerance ?? 50;   // color distance counted as "background"
    const feather = opts.feather ?? 28;       // extra ramp band for soft edges
    const maxDim = opts.maxDim ?? 1400;       // cap output size for sane upload weight

    const url = URL.createObjectURL(file);
    try {
        const img = await loadImage(url);
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) return file;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, w, h);

        const imageData = ctx.getImageData(0, 0, w, h);
        const d = imageData.data;

        // Background reference = average of the four corner pixels.
        const cornerOffsets = [0, (w - 1), (h - 1) * w, (h - 1) * w + (w - 1)].map(p => p * 4);
        let br = 0, bg = 0, bb = 0;
        cornerOffsets.forEach(p => { br += d[p]; bg += d[p + 1]; bb += d[p + 2]; });
        br /= 4; bg /= 4; bb /= 4;

        const distAt = (p) => {
            const dr = d[p] - br, dg = d[p + 1] - bg, db = d[p + 2] - bb;
            return Math.sqrt(dr * dr + dg * dg + db * db);
        };

        const total = w * h;
        const visited = new Uint8Array(total);
        const stack = [];
        const pushIf = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return;
            const idx = y * w + x;
            if (visited[idx]) return;
            visited[idx] = 1;
            stack.push(idx);
        };
        for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
        for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }

        const cut = tolerance + feather;
        while (stack.length) {
            const idx = stack.pop();
            const p = idx * 4;
            const dd = distAt(p);
            if (dd > cut) continue;                 // hit the subject — stop spreading here
            if (dd <= tolerance) d[p + 3] = 0;      // solid background → fully transparent
            else d[p + 3] = Math.round(((dd - tolerance) / feather) * d[p + 3]); // feathered edge
            const x = idx % w, y = (idx - x) / w;
            pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
        }

        ctx.putImageData(imageData, 0, 0);
        const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
        return blob || file;
    } catch (e) {
        console.warn('background removal failed, using original image', e);
        return file;
    } finally {
        URL.revokeObjectURL(url);
    }
}
