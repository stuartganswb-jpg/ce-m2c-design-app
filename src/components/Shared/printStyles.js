// WHY A FORM PRINTED AT LABEL SIZE (Stuart 2026-08-03: "the forms are trying to print at label
// size").
//
// `printForm` opens a popup and copies EVERY <style> and <link rel=stylesheet> out of the app's
// head so the branded form prints with its own fonts and shading. That copy is indiscriminate — it
// takes the label printer's stylesheet too.
//
// `labelPrint` injects `#ce-label-print-style` into the head for the duration of a label print. It
// carries, inside its own @media print block:
//     @page{size:4in 2in;margin:0;}      (when localStorage.labelPaper === '4x2')
//     body > *{display:none !important;}
// It removes itself on `afterprint` / Escape / tap — but a dialog dismissed some other way, or an
// Android tablet where cleanup waits for an explicit tap, leaves it in the head. Print a form after
// that and the popup inherits a 4×2 page and a rule that hides the body.
//
// TWO GUARDS, because either alone would leave a hole:
//   1. Never copy the label stylesheet — it is identified by id and has no business in a form.
//   2. Strip @page from everything else copied anyway. Any component could add one tomorrow, and a
//      form's page size must be decided by the form, not inherited from whatever was printed last.
// The caller then declares its own @page LAST, so it wins outright.

// Stylesheets that must never reach a form popup, by element id.
export const EXCLUDED_STYLE_IDS = ['ce-label-print-style'];

// Remove every @page block, including nested ones inside @media. Brace-matched rather than
// regex-matched on `[^}]*` — an @page carrying a nested selector would defeat the simple form and
// leave a stray `}` behind, which silently breaks the rest of the sheet.
export function stripPageRules(css) {
    const src = String(css || '');
    let out = '';
    let i = 0;
    while (i < src.length) {
        const at = src.toLowerCase().indexOf('@page', i);
        if (at === -1) { out += src.slice(i); break; }
        out += src.slice(i, at);
        const open = src.indexOf('{', at);
        // A stray `@page` with no block of its own must not swallow the next unrelated rule. If a
        // `}` closes before any `{` opens, we are not looking at an @page block — drop the token
        // only and carry on.
        const close = src.indexOf('}', at);
        if (open === -1 || (close !== -1 && close < open)) { i = at + 5; continue; }
        let depth = 0, j = open;
        for (; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') { depth--; if (depth === 0) { j++; break; } }
        }
        i = j;
    }
    return out;
}

/**
 * Build the <head> markup a print popup should inherit.
 *
 * @param {Array} nodes  head elements, each { id, tagName, textContent, outerHTML }
 * @returns {string} markup safe to drop into the popup's head
 */
export function collectPrintStyles(nodes) {
    return (nodes || [])
        .filter(n => n && !EXCLUDED_STYLE_IDS.includes(String(n.id || '')))
        .map(n => {
            const tag = String(n.tagName || '').toUpperCase();
            // A <link> points at a built CSS file we can't rewrite; app CSS carries no @page, and
            // the sheets that do are all injected inline, so passing links through is safe.
            if (tag !== 'STYLE') return n.outerHTML || '';
            const css = stripPageRules(n.textContent || '');
            return css.trim() ? `<style>${css}</style>` : '';
        })
        .filter(Boolean)
        .join('\n');
}
