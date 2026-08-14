// 2D TEAR-SHEET IMPORT — rasterize an uploaded tear sheet (PDF page 1 or an
// image file) to a PNG blob + pixel dims for manufacturingSpecs.sheet2d.
// pdfjs is loaded DYNAMICALLY so this only ever ships in the 1.5 chunk and only
// downloads when a PDF is actually imported (same build ProgramPrintUploader
// uses, worker pinned to the installed version).
const MAX_W = 2200; // plenty for on-screen regions + halo display, keeps storage light

const rasterizeImage = (file) => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
        const scale = Math.min(1, MAX_W / img.naturalWidth);
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); // flatten transparency to paper white
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob(b => b ? resolve({ blob: b, w, h }) : reject(new Error('Image encode failed')), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image file.')); };
    img.src = url;
});

const rasterizePdf = async (file) => {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf');
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.min.js`;
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1); // tear sheets are one-pagers; page 1 is the drawing
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, MAX_W / base.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return new Promise((resolve, reject) =>
        canvas.toBlob(b => b ? resolve({ blob: b, w: canvas.width, h: canvas.height }) : reject(new Error('PDF render encode failed')), 'image/png'));
};

// → { blob, w, h }
export const rasterizeSheetFile = (file) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    return isPdf ? rasterizePdf(file) : rasterizeImage(file);
};
