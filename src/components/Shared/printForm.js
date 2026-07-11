import { renderToStaticMarkup } from 'react-dom/server';

// Print a React element (e.g. <FormPreview/>) as a standalone document in a new window. We copy the
// app's stylesheets + :root CSS variables so the branded form — fonts, light-grey shading, and the
// barcode — prints exactly as it previews. print-color-adjust:exact keeps the greys/barcode solid.
export function printForm(element, title = 'Document') {
  let markup;
  try { markup = renderToStaticMarkup(element); }
  catch (e) { console.error('print render failed', e); alert('Could not render the form for printing.'); return; }

  const headStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
    .map(n => n.outerHTML).join('\n');

  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) { alert('Pop-up blocked — allow pop-ups for this site to print forms.'); return; }

  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    ${headStyles}
    <style>
      @page { margin: 0.5in; }
      html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    </style>
  </head><body>${markup}</body></html>`);
  win.document.close();
  win.focus();
  // Fire the print dialog only after IMAGES have loaded (the brand logo comes from Firebase
  // Storage — a fixed 500ms beat it to the printer, so forms printed logo-less on first run).
  // Safety timeout still fires after 4s; the guard prevents a double dialog.
  let fired = false;
  const doPrint = () => { if (fired) return; fired = true; try { win.print(); } catch (e) { /* user may have closed it */ } };
  setTimeout(() => {
    let imgs = [];
    try { imgs = Array.from(win.document.images || []); } catch (e) { /* window closed */ }
    const pending = imgs.filter(im => !im.complete);
    if (!pending.length) return doPrint();
    let left = pending.length;
    const done = () => { if (--left <= 0) doPrint(); };
    pending.forEach(im => { im.addEventListener('load', done); im.addEventListener('error', done); });
    setTimeout(doPrint, 4000);
  }, 400);
}
