// specSheetOutput.js — output lanes for generated spec-sheet pages (SVG strings).
// Print: hidden print window, one SVG per page (browser print keeps the SVG vector —
// "Save as PDF" from the dialog is the true-vector path). PDF download: pdf-lib with each
// page embedded as a ~300dpi raster. Both are paper-aware: 'letter' (8.5×11) or 'tabloid'
// (11×17). A tabloid-layout page printed on letter comes out reduced (~64%) automatically.
import { PDFDocument } from 'pdf-lib';

const PAPER_PT = { letter: [792, 612], tabloid: [1224, 792], tabloidP: [792, 1224] }; // points
const PAPER_CSS = { letter: 'letter landscape', tabloid: '11in 17in landscape', tabloidP: '11in 17in portrait' };

export function openSpecSheetPrint(title, svgPages, paper = 'letter') {
  const w = window.open('', '_blank');
  if (!w) throw new Error('Popup blocked — allow popups to print.');
  const pages = svgPages.map(svg => `<div class="page">${svg}</div>`).join('');
  w.document.write(`<!DOCTYPE html><html><head><title>${title} — Spec Sheets</title><style>
    @page { size: ${PAPER_CSS[paper] || PAPER_CSS.letter}; margin: 0.25in; }
    body { margin: 0; }
    .page { page-break-after: always; display: flex; align-items: center; justify-content: center; }
    .page svg { width: 100%; height: auto; }
  </style></head><body>${pages}<script>window.onload = () => setTimeout(() => window.print(), 300);</${'script'}></body></html>`);
  w.document.close();
}

const viewBoxOf = (svgString) => {
  const m = String(svgString).match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : [1100, 850];
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

export async function downloadSpecSheetPdf(title, svgPages, paper = 'letter') {
  const [PW, PH] = PAPER_PT[paper] || PAPER_PT.letter;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${title} — Spec Sheets`);
  for (const svg of svgPages) {
    const { png, aspect } = await svgToPng(svg, paper === 'tabloid' ? 5100 : 3300); // ~300dpi
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([PW, PH]);
    // fit the page image inside the printable box preserving aspect (a tabloid master on a
    // letter page comes out reduced — the page footer marks it not-to-scale)
    const boxW = PW - 36, boxH = PH - 36;
    let w = boxW, h = boxW / aspect;
    if (h > boxH) { h = boxH; w = boxH * aspect; }
    page.drawImage(img, { x: (PW - w) / 2, y: (PH - h) / 2, width: w, height: h });
  }
  const bytes = await pdf.save();
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${String(title).replace(/[^\w.-]+/g, '_')}_SpecSheets.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
