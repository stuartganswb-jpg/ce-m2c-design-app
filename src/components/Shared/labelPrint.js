// Shared 2"x4" label printing (item + bin), single or batched, via the browser print dialog (renders
// thumbnails + a scannable Code 128-B barcode with no external lib). Pick the 2x4 Zebra (or any printer).

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal Code 128-B → SVG barcode.
const CODE128B = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112").split(' ');
export const code128BSvg = (text) => {
    const s = String(text || '');
    const vals = [];
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 32 && c <= 126) vals.push(c - 32); }
    if (!vals.length) return '';
    const codes = [104, ...vals];           // Start B
    let sum = 104; vals.forEach((v, i) => { sum += v * (i + 1); });
    codes.push(sum % 103, 106);             // checksum, Stop
    const widths = codes.map(c => CODE128B[c]).join('');
    const H = 10; let x = 0, rects = '';
    for (let i = 0; i < widths.length; i++) { const w = parseInt(widths[i], 10); if (i % 2 === 0) rects += `<rect x="${x}" y="0" width="${w}" height="${H}"/>`; x += w; }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${H}" preserveAspectRatio="none" fill="#000">${rects}</svg>`;
};

const PAGE_CSS = `@page{size:auto;margin:0;} html,body{margin:0;padding:0;}
.l{width:4in;height:2in;box-sizing:border-box;font-family:Arial,Helvetica,sans-serif;color:#000;page-break-after:always;overflow:hidden;}
.l:last-child{page-break-after:auto;}`;
const ITEM_CSS = `${PAGE_CSS}
.l{padding:0.12in 0.16in;display:flex;gap:0.14in;align-items:center;}
.img{width:1.45in;height:1.45in;flex:0 0 auto;border:1px solid #ccc;object-fit:contain;background:#fff;}
.r{flex:1;display:flex;flex-direction:column;min-width:0;height:100%;justify-content:center;}
.id{font-size:26pt;font-weight:800;line-height:1.0;letter-spacing:.3px;word-break:break-all;}
.nm{font-size:11pt;font-weight:600;line-height:1.15;margin-top:3pt;max-height:0.46in;overflow:hidden;}
.bc{margin-top:auto;} .bc svg{width:100%;height:0.4in;display:block;} .bct{font-size:8pt;letter-spacing:2px;text-align:center;}`;
const BIN_CSS = `${PAGE_CSS}
.l{padding:0.1in 0.18in;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.k{font-size:10pt;font-weight:700;letter-spacing:4px;color:#444;}
.b{font-weight:900;line-height:1.02;letter-spacing:1px;margin:2pt 0 4pt;text-align:center;word-break:break-all;}
.bc{width:100%;} .bc svg{width:100%;height:0.6in;display:block;} .bct{font-size:9pt;letter-spacing:3px;text-align:center;margin-top:1pt;}`;

const itemLabelInner = ({ itemId, itemName, imageUrl }) => {
    const id = String(itemId || '');
    const img = imageUrl ? `<img class="img" src="${esc(imageUrl)}" alt=""/>` : '';
    return `<div class="l">${img}<div class="r"><div class="id">${esc(id)}</div><div class="nm">${esc(itemName || '')}</div><div class="bc">${code128BSvg(id)}<div class="bct">${esc(id)}</div></div></div></div>`;
};
const binLabelInner = (bin) => {
    const b = String(bin || '');
    const fs = b.length <= 7 ? 46 : b.length <= 11 ? 32 : b.length <= 16 ? 22 : 16; // shrink long bin names to fit
    return `<div class="l"><div class="k">BIN</div><div class="b" style="font-size:${fs}pt">${esc(b)}</div><div class="bc">${code128BSvg(b)}<div class="bct">${esc(b)}</div></div></div>`;
};

// ---- print dispatch --------------------------------------------------------------------
// NORMAL PRINT QUEUE (Stuart 2026-07-28: "we can't print the set up label... can you just use a
// normal print queue"). Earlier this rendered the label into a hidden iframe on desktop and a
// blob-URL tab on Android — both are fragile: the iframe silently prints the PARENT document in
// some setups, and the tab is killed by pop-up blockers, so the operator clicks Print and nothing
// happens. It now prints IN PAGE: the label markup is mounted on the live document behind a
// print-only stylesheet that hides everything else, and window.print() runs on the page itself —
// the same path as Ctrl-P, which every printer driver and tablet handles.
// Paper: @page size is `auto`, so whatever the print dialog has selected is used (Letter, A4, or
// 4x2 label stock). A station with a dedicated label printer can pin the exact label page with
// localStorage 'labelPaper' = '4x2'.
const HOST_ID = 'ce-label-print-root';
const STYLE_ID = 'ce-label-print-style';
const labelPaper = () => { try { return (localStorage.getItem('labelPaper') || '').toLowerCase(); } catch (e) { return ''; } };

export const printHtmlDocument = (docHtml, { autoPrintDelay = 250, timeout = 120000 } = {}) => {
    try {
        const css = [...String(docHtml).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
        const bodyMatch = String(docHtml).match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const body = bodyMatch ? bodyMatch[1] : String(docHtml);

        document.getElementById(HOST_ID)?.remove();      // a previous run that never got cleaned up
        document.getElementById(STYLE_ID)?.remove();

        const host = document.createElement('div');
        host.id = HOST_ID;
        host.innerHTML = body;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
#${HOST_ID}{position:fixed;left:-10000px;top:0;width:0;height:0;overflow:hidden;}
@media print{
  html,body{margin:0 !important;padding:0 !important;background:#fff !important;}
  body > *{display:none !important;}
  body > #${HOST_ID}{display:block !important;position:static !important;width:auto !important;height:auto !important;overflow:visible !important;}
  ${css}
  ${labelPaper() === '4x2' ? '@page{size:4in 2in;margin:0;}' : ''}
}`;
        document.head.appendChild(style);
        document.body.appendChild(host);

        let done = false;
        const cleanup = () => {
            if (done) return; done = true;
            window.removeEventListener('afterprint', cleanup);
            try { host.remove(); style.remove(); } catch (e) { /* already gone */ }
        };
        window.addEventListener('afterprint', cleanup);

        // Thumbnails on item labels load from Storage — print once they are in, so the label is
        // never sent to the queue half-rendered (capped so a dead image can't block the job).
        const imgs = [...host.querySelectorAll('img')].filter((i) => !i.complete);
        const go = () => { try { window.print(); } catch (e) { console.warn('label print failed:', e); cleanup(); } };
        if (!imgs.length) setTimeout(go, autoPrintDelay);
        else {
            let left = imgs.length, fired = false;
            const ready = () => { if (!fired && --left <= 0) { fired = true; setTimeout(go, autoPrintDelay); } };
            imgs.forEach((i) => { i.addEventListener('load', ready); i.addEventListener('error', ready); });
            setTimeout(() => { if (!fired) { fired = true; go(); } }, 3000);
        }
        setTimeout(cleanup, timeout);
        return true;
    } catch (e) { console.warn('printHtmlDocument error:', e); return false; }
};

// Each label is its own page (4x2 of content; the page itself follows the selected paper).
const printDoc = (title, css, bodies) => {
    if (!bodies || !bodies.length) return false;
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bodies.join('')}</body></html>`;
    return printHtmlDocument(doc, { autoPrintDelay: 400, timeout: 120000 });
};

export const printItemLabel = (item) => printDoc(`Item ${item?.itemId || ''}`, ITEM_CSS, [itemLabelInner(item)]);
export const printBinLabel = ({ bin }) => printDoc(`Bin ${bin || ''}`, BIN_CSS, [binLabelInner(bin)]);
export const printItemLabels = (items = []) => printDoc(`Item labels (${items.length})`, ITEM_CSS, items.map(itemLabelInner));
export const printBinLabels = (bins = []) => printDoc(`Bin labels (${bins.length})`, BIN_CSS, bins.map(binLabelInner));

// ── SETUP / STAGING-HANDSHAKE LABELS (Stuart 2026-07-21) ──────────────────────────────────
// Printed at pick complete (and reprintable from staging/packing). The barcode encodes the
// order's shared staging key (orderKey) — the SAME value the Staging Handshake resolves, so
// scanning this label verifies the pairing; the label then rides the fixture into finishing.
const SETUP_CSS = `${PAGE_CSS}
.l{padding:0.1in 0.16in;display:flex;flex-direction:column;}
.hd{display:flex;justify-content:space-between;align-items:baseline;}
.k{font-size:9pt;font-weight:800;letter-spacing:2.5px;}
.tag{font-size:7.5pt;font-weight:700;color:#333;letter-spacing:1px;}
.wo{font-size:22pt;font-weight:900;line-height:1.02;margin-top:1pt;word-break:break-all;}
.ln{font-size:10.5pt;font-weight:700;margin-top:2pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.sub{font-size:8.5pt;color:#222;margin-top:1pt;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bc{margin-top:auto;} .bc svg{width:100%;height:0.38in;display:block;} .bct{font-size:7pt;letter-spacing:1px;text-align:center;}`;
const setupLabelInner = ({ kind, woRef, orderKey, item, qty, finish, customer }) => {
    const key = String(orderKey || woRef || '');
    return `<div class="l">
  <div class="hd"><span class="k">${esc(kind || 'SETUP · SMALL PARTS')}</span><span class="tag">ATTACH TO FIXTURE</span></div>
  <div class="wo">${esc(woRef || key)}</div>
  <div class="ln">${esc(item || '')}${qty ? ` &nbsp;×${esc(qty)}` : ''}${finish ? ` &nbsp;·&nbsp; ${esc(finish)}` : ''}</div>
  <div class="sub">${esc(customer || '')}</div>
  <div class="bc">${code128BSvg(key)}<div class="bct">${esc(key)}</div></div>
</div>`;
};
export const printSetupLabel = (o) => printDoc(`Setup ${o?.woRef || ''}`, SETUP_CSS, [setupLabelInner(o)]);
// Both halves of the handshake: the small-parts label + (when the order has shop custom parts)
// the CUSTOM label — both barcode the same orderKey, which is exactly how VERIFY & STAGE pairs them.
export const printHandshakeLabels = (o) => printDoc(`Handshake ${o?.woRef || ''}`, SETUP_CSS, [
    setupLabelInner({ ...o, kind: 'SETUP · SMALL PARTS' }),
    ...(o && o.hasCustom ? [setupLabelInner({ ...o, kind: 'CUSTOM · SHOP PARTS' })] : [])
]);

// ── STOCK ITEM LABEL (put-away, Stuart 2026-07-21) ────────────────────────────────────────
// Item id (text + barcode), description, UOM — and the WO # far right in small type as the
// BATCH reference for the put-away run.
const STOCK_CSS = `${PAGE_CSS}
.l{padding:0.12in 0.16in;display:flex;flex-direction:column;}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:0.12in;}
.id{font-size:22pt;font-weight:900;line-height:1.02;word-break:break-all;min-width:0;}
.wo{font-size:7.5pt;font-weight:700;color:#333;text-align:right;white-space:nowrap;line-height:1.25;flex:0 0 auto;}
.nm{font-size:10.5pt;font-weight:600;line-height:1.15;margin-top:2pt;max-height:0.36in;overflow:hidden;}
.uom{font-size:9pt;font-weight:800;margin-top:1pt;letter-spacing:1px;}
.bc{margin-top:auto;} .bc svg{width:100%;height:0.4in;display:block;} .bct{font-size:8pt;letter-spacing:2px;text-align:center;}`;
const stockItemLabelInner = ({ itemId, itemName, uom, woNum }) => `<div class="l">
  <div class="top"><div class="id">${esc(itemId || '')}</div>${woNum ? `<div class="wo">BATCH<br/>${esc(woNum)}</div>` : ''}</div>
  <div class="nm">${esc(itemName || '')}</div>
  <div class="uom">UOM: ${esc(uom || 'EA')}</div>
  <div class="bc">${code128BSvg(String(itemId || ''))}<div class="bct">${esc(itemId || '')}</div></div>
</div>`;
export const printStockItemLabels = ({ itemId, itemName, uom, woNum, copies = 1 }) =>
    printDoc(`Item ${itemId || ''} ×${copies}`, STOCK_CSS, Array.from({ length: Math.max(1, Math.min(50, parseInt(copies) || 1)) }, () => stockItemLabelInner({ itemId, itemName, uom, woNum })));
