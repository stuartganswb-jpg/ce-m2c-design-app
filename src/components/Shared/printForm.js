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
  // Give the copied stylesheets + fonts a moment to load before firing the print dialog.
  setTimeout(() => { try { win.print(); } catch (e) { /* user may have closed it */ } }, 500);
}
