// Shared 2"x4" label printing (item + bin) via the browser print dialog (renders thumbnails + a
// scannable Code 128-B barcode with no external lib). Pick the 2x4 Zebra (or any printer) in the dialog.

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

// Render an HTML doc to a hidden iframe and open the print dialog (only the label prints; @page sizes it).
const printDoc = (title, css, bodyHtml) => {
    const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
    try {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(iframe);
        const cw = iframe.contentWindow;
        cw.document.open(); cw.document.write(doc); cw.document.close();
        const cleanup = () => { try { if (iframe.parentNode) document.body.removeChild(iframe); } catch (e) { /* gone */ } };
        cw.onafterprint = cleanup;
        setTimeout(() => { try { cw.focus(); cw.print(); } catch (e) { console.warn('label print failed:', e); } }, 300);
        setTimeout(cleanup, 60000);
        return true;
    } catch (e) { console.warn('printDoc error:', e); return false; }
};

// 2x4 ITEM label: thumbnail (if any) + item # (large) + name + a scannable barcode of the item #.
export const printItemLabel = ({ itemId, itemName, imageUrl }) => {
    const id = String(itemId || '');
    const css = `@page{size:4in 2in;margin:0;} html,body{margin:0;padding:0;}
.l{width:4in;height:2in;box-sizing:border-box;padding:0.12in 0.16in;font-family:Arial,Helvetica,sans-serif;color:#000;display:flex;gap:0.14in;align-items:center;}
.img{width:1.45in;height:1.45in;flex:0 0 auto;border:1px solid #ccc;object-fit:contain;background:#fff;}
.r{flex:1;display:flex;flex-direction:column;min-width:0;height:100%;justify-content:center;}
.id{font-size:26pt;font-weight:800;line-height:1.0;letter-spacing:.3px;word-break:break-all;}
.nm{font-size:11pt;font-weight:600;line-height:1.15;margin-top:3pt;max-height:0.46in;overflow:hidden;}
.bc{margin-top:auto;} .bc svg{width:100%;height:0.4in;display:block;} .bct{font-size:8pt;letter-spacing:2px;text-align:center;}`;
    const img = imageUrl ? `<img class="img" src="${esc(imageUrl)}" alt=""/>` : '';
    const body = `<div class="l">${img}<div class="r"><div class="id">${esc(id)}</div><div class="nm">${esc(itemName || '')}</div><div class="bc">${code128BSvg(id)}<div class="bct">${esc(id)}</div></div></div></div>`;
    return printDoc(`Item ${id}`, css, body);
};

// 2x4 BIN label: big bin # (auto-sized to fit) + a large scannable barcode — readable/scannable from afar.
export const printBinLabel = ({ bin }) => {
    const b = String(bin || '');
    const fs = b.length <= 7 ? 46 : b.length <= 11 ? 32 : b.length <= 16 ? 22 : 16; // shrink long bin names to fit
    const css = `@page{size:4in 2in;margin:0;} html,body{margin:0;padding:0;}
.l{width:4in;height:2in;box-sizing:border-box;padding:0.1in 0.18in;font-family:Arial,Helvetica,sans-serif;color:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;}
.k{font-size:10pt;font-weight:700;letter-spacing:4px;color:#444;}
.b{font-size:${fs}pt;font-weight:900;line-height:1.02;letter-spacing:1px;margin:2pt 0 4pt;text-align:center;word-break:break-all;}
.bc{width:100%;} .bc svg{width:100%;height:0.6in;display:block;} .bct{font-size:9pt;letter-spacing:3px;text-align:center;margin-top:1pt;}`;
    const body = `<div class="l"><div class="k">BIN</div><div class="b">${esc(b)}</div><div class="bc">${code128BSvg(b)}<div class="bct">${esc(b)}</div></div></div>`;
    return printDoc(`Bin ${b}`, css, body);
};
