// specSheetOutput.js — output lanes for generated spec-sheet pages (SVG strings).
// Print: hidden print window, landscape letter, one SVG per page (browser print keeps
// the SVG vector — "Save as PDF" from the dialog is the true-vector path).
// PDF download: pdf-lib with each page embedded as a 300dpi raster (crisp at print size).
import { PDFDocument } from 'pdf-lib';
import { PAGE_W, PAGE_H } from './specSheetPage';

export function openSpecSheetPrint(title, svgPages) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Popup blocked — allow popups to print.');
  const pages = svgPages.map(svg => `<div class="page">${svg}</div>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>${title} — Spec Sheets</title><style>
    @page { size: letter landscape; margin: 0.25in; }
    body { margin: 0; }
    .page { page-break-after: always; display: flex; align-items: center; justify-content: center; }
    .page svg { width: 100%; height: auto; }
  </style></head><body>${pages}<script>window.onload = () => setTimeout(() => window.print(), 300);</${'script'}></body></html>`);
  w.document.close();
}

// Render an SVG string to a PNG data URL at the given pixel width.
function svgToPng(svgString, widthPx) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = Math.round((widthPx * PAGE_H) / PAGE_W);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterize failed')); };
    img.src = url;
  });
}

export async function downloadSpecSheetPdf(title, svgPages) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} — Spec Sheets`);
  for (const svg of svgPages) {
    const png = await svgToPng(svg, 3300); // ~300dpi across 11in
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([792, 612]); // letter landscape (pt)
    page.drawImage(img, { x: 18, y: 18, width: 792 - 36, height: 612 - 36 });
  }
  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(title).replace(/[^\w.-]+/g, '_')}_SpecSheets.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
