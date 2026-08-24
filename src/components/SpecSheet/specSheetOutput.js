// specSheetOutput.js — output lanes for generated spec-sheet pages.
// Pages arrive as [{ svg, paper }] — 'letterP' (8.5×11 portrait, the standard) or 'letter'
// (8.5×11 landscape, the wide double sheets). THE BINDER IS PORTRAIT (Stuart 2026-08-23:
// "we are going to put these in a catalog binder … printed at 8.5x11"), and one print job
// cannot mix page orientations — so every output page IS letter portrait, and a landscape
// sheet is turned 90° onto it, exactly as it sits in the binder.
// Print: hidden print window, one SVG per page (browser print keeps the SVG vector —
// "Save as PDF" from the dialog is the true-vector path). PDF download: pdf-lib with each
// page embedded as a ~300dpi raster.
import { PDFDocument, degrees } from 'pdf-lib';

const isLandscape = (paper) => paper === 'letter' || paper === 'tabloid';

export function openSpecSheetPrint(title, pages) {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Popup blocked — allow popups to print.');
  const body = pages.map(({ svg, paper }) => (
    isLandscape(paper)
      // Rotated about its own centre; the flex-centred page box keeps the centre in place, so
      // the 10.5×8 sheet stands 8×10.5 on the portrait page.
      ? `<div class="page"><div class="land">${svg}</div></div>`
      : `<div class="page">${svg}</div>`
  )).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>${title} — Spec Sheets</title><style>
    @page { size: 8.5in 11in; margin: 0.25in; }
    body { margin: 0; }
    .page { page-break-after: always; height: 10.4in; display: flex; align-items: center; justify-content: center; }
    .page svg { width: 100%; height: auto; }
    .land { width: 10.3in; transform: rotate(90deg); }
    .land svg { width: 10.3in; }
  </style></head><body>${body}<script>window.onload = () => setTimeout(() => window.print(), 300);</${'script'}></body></html>`);
  w.document.close();
}

const viewBoxOf = (svgString) => {
  const m = String(svgString).match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [850, 1100];
};

// Render an SVG string to a PNG data URL at the given pixel width (height from viewBox).
function svgToPng(svgString, widthPx) {
  return new Promise((resolve, reject) => {
    const [vw, vh] = viewBoxOf(svgString);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = widthPx;
        canvas.height = Math.round((widthPx * vh) / vw);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve({ png: canvas.toDataURL('image/png'), aspect: vw / vh });
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG rasterize failed')); };
    img.src = url;
  });
}

export async function downloadSpecSheetPdf(title, pages) {
  const PW = 612, PH = 792; // letter portrait, points — every page, per the binder
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} — Spec Sheets`);
  for (const { svg, paper } of pages) {
    const { png, aspect } = await svgToPng(svg, 3300); // ~300dpi over the long side
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([PW, PH]);
    const boxW = PW - 36, boxH = PH - 36;
    if (isLandscape(paper)) {
      // Turned 90° CCW: the image's width runs UP the page. drawImage rotates about (x, y) —
      // the image then occupies [x−h, y, h, w], so centring solves to x=(PW+h)/2, y=(PH−w)/2.
      let w = Math.min(boxH, boxW * aspect); // long side, vertical after the turn
      const h = w / aspect;
      page.drawImage(img, { x: (PW + h) / 2, y: (PH - w) / 2, width: w, height: h, rotate: degrees(90) });
    } else {
      let w = boxW, h = boxW / aspect;
      if (h > boxH) { h = boxH; w = boxH * aspect; }
      page.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
    }
  }
  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(title).replace(/[^\w.-]+/g, '_')}_SpecSheets.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
