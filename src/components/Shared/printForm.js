import { renderToStaticMarkup } from 'react-dom/server';
import { collectPrintStyles } from './printStyles';

// Print a React element (e.g. <FormPreview/>) as a standalone document in a new window. We copy the
// app's stylesheets + :root CSS variables so the branded form — fonts, light-grey shading, and the
// barcode — prints exactly as it previews. print-color-adjust:exact keeps the greys/barcode solid.
// `opts.pageCss` overrides the page box for documents that are already drawn as full sheets —
// a form whose pages carry their OWN 8.5in width and inner margins must print at margin 0, or the
// printer's half-inch is added to the one already in the artwork and the sheet is scaled down
// (Stuart 2026-08-31, the Fabricut quote). Callers that say nothing keep the Letter/0.5in default.
export function printForm(element, title = 'Document', opts = {}) {
  let markup;
  try { markup = renderToStaticMarkup(element); }
  catch (e) { console.error('print render failed', e); alert('Could not render the form for printing.'); return; }

  // The copy is filtered, not raw: the label printer's stylesheet lives in this same head and
  // carries `@page{size:4in 2in}` + `body > *{display:none}`, which is how a quote ended up
  // printing at label size (Stuart 2026-08-03). See Shared/printStyles.js.
  const headStyles = collectPrintStyles(Array.from(document.querySelectorAll('link[rel="stylesheet"], style')));

  const win = window.open('', '_blank', 'width=900,height=1200');
  if (!win) { alert('Pop-up blocked — allow pop-ups for this site to print forms.'); return; }

  win.document.open();
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    ${headStyles}
    <style>
      /* Declared LAST and with an explicit size so nothing copied above can decide the page for
         us — a form is Letter portrait, whatever was printed in this tab before it. */
      ${opts.pageCss || '@page { size: Letter portrait; margin: 0.5in; }'}
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
