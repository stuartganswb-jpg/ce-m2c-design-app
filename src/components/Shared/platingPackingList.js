// Shared US-Letter plating PURCHASE ORDER / packing list — used when a shipment is created
// (Pick Pack) and reprinted any time after from the OUT AT PLATER rows. Print dispatch lives in
// labelPrint's printHtmlDocument (desktop = hidden iframe; Android tablets = blob-tab auto-print,
// because Chrome-on-Android prints the parent page from an iframe). Pass the stored `packingList`
// object: { shipId, brand, vendor, poLabel, dateStr, operator, lines[], pcs, total, finishSummary }.
//
// STYLED TO MATCH THE TAB-11 FORMS (Stuart 2026-08-13: "it should match the forms from HQ tab 11,
// proper formatting") — same palette, serif document title, mono small-cap labels, paper-2 shaded
// blocks and the shared footer line as Shared/FormPreview. The <title> is "<Vendor> <PO#>" so the
// browser's Save-as-PDF names the file exactly that.
// Explicit .js extension so node can import buildPlatingPoHtml for render tests (webpack accepts both).
import { code128BSvg, printHtmlDocument } from './labelPrint.js';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Mirrors Shared/FormPreview's brand block (kept in sync by hand — it's four lines).
const BRAND_NAMES = { m2c: 'M2C Studio', ce: 'Classical Elements', uniquity: 'Uniquity', leyla: 'Leyla' };
const COMPANY_ADDRESS = '1200 Redding Dr · High Point, NC 27260';
const BRAND_CONTACT = {
    ce: { web: 'www.classicalelements.com', phone: '1 (336) 967-3313' },
    m2c: { web: 'www.m2cstudio.com', phone: '910.805.8410' },
    uniquity: { web: 'www.uniquitystyle.com', phone: '1 (336) 290-5115' },
};

// Exported separately so the document can be render-tested without a browser print pipeline.
export const buildPlatingPoHtml = ({ shipId, brand, vendor, poLabel, dateStr, operator, lines = [], pcs, total, finishSummary }) => {
    const totalPcs = pcs != null ? pcs : lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
    const brandKey = String(brand || '').toLowerCase();
    const company = BRAND_NAMES[brandKey] || String(brand || 'Company');
    const contact = BRAND_CONTACT[brandKey] || {};
    const docName = `${String(vendor || 'Plater').trim()} ${String(poLabel || shipId || '').trim()}`.trim();

    // UNIT COST = what we pay the vendor per piece (Stuart 2026-08-13: "add the price we pay to
    // the vendor (base cost) to the far right after qty"). Always rendered — a missing rate reads
    // '—' rather than the columns quietly disappearing on older shipments.
    const rows = lines.map((l, i) => {
        const qty = parseInt(l.qty) || 0;
        const rate = parseFloat(l.rate) || 0;
        return `<tr>
<td class="c">${i + 1}</td>
<td class="mono">${esc(l.erpId || '')}</td>
<td>${esc(l.itemName || '')}</td>
<td class="c mono">${esc(l.finishCode || '')}</td>
<td class="mono brass">${esc(l.targetErpId || '')}</td>
<td class="c mono">${esc(l.platingBin || '')}</td>
<td class="c mono">${esc(l.woNum || '')}</td>
<td class="r">${qty}</td>
<td class="r">${rate ? `$${rate.toFixed(2)}` : '—'}</td>
<td class="r">${rate ? `$${(rate * qty).toFixed(2)}` : '—'}</td>
</tr>`;
    }).join('');

    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(docName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
@page{size:Letter portrait;margin:0.5in;}
*{box-sizing:border-box;}
:root{--ink:#1c1a16;--ink-soft:#524e46;--brass:#b08d57;--paper:#faf8f4;--paper2:#f2efe8;--line:rgba(28,26,22,.14);}
html,body{margin:0;padding:0;font-family:'Inter',-apple-system,Arial,sans-serif;color:var(--ink);background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
.serif{font-family:'Cormorant Garamond',Georgia,serif;}
.mono{font-family:'IBM Plex Mono',Menlo,monospace;}
.k{font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-soft);}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid var(--ink);padding-bottom:14px;}
.co{font-family:'Cormorant Garamond',Georgia,serif;font-size:20pt;font-weight:600;letter-spacing:.04em;line-height:1;}
.co-sub{font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-soft);margin-top:5px;}
.doc{text-align:right;}
.doc .t{font-family:'Cormorant Garamond',Georgia,serif;font-size:19pt;font-weight:500;line-height:1.05;}
.doc .po{font-family:'IBM Plex Mono',Menlo,monospace;font-size:11pt;font-weight:600;margin-top:4px;}
.doc .d{font-family:'IBM Plex Mono',Menlo,monospace;font-size:8pt;color:var(--ink-soft);margin-top:2px;}
.bcrow{display:flex;justify-content:space-between;align-items:flex-end;margin:12px 0 14px;}
.bc svg{width:2.3in;height:0.45in;display:block;} .bc .t{font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;letter-spacing:2px;margin-top:2px;}
.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;}
.meta .cell{background:var(--paper2);border:1px solid var(--line);padding:8px 10px;}
.meta .v{font-size:10.5pt;font-weight:600;margin-top:3px;}
table{width:100%;border-collapse:collapse;font-size:9.5pt;}
th{background:var(--paper2);border:1px solid var(--line);padding:6px 7px;font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft);text-align:left;}
td{border:1px solid var(--line);padding:5px 7px;}
td.c,th.c{text-align:center;} td.r,th.r{text-align:right;}
td.mono{font-family:'IBM Plex Mono',Menlo,monospace;font-size:8.5pt;}
td.brass{color:var(--brass);font-weight:600;}
tr{page-break-inside:avoid;}
.totals{display:flex;justify-content:flex-end;margin-top:10px;}
.totals .box{background:var(--paper2);border:1px solid var(--line);padding:10px 16px;min-width:2.9in;}
.totals .row{display:flex;justify-content:space-between;gap:24px;font-size:10.5pt;padding:2px 0;}
.totals .row.big{font-family:'Cormorant Garamond',Georgia,serif;font-size:14pt;font-weight:600;border-top:1px solid var(--line);margin-top:5px;padding-top:6px;}
.sign{margin-top:34px;display:flex;gap:44px;}
.sign div{flex:1;border-top:1px solid var(--ink);padding-top:6px;font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-soft);}
.foot{margin-top:26px;border-top:1px solid var(--line);padding-top:8px;text-align:center;font-family:'IBM Plex Mono',Menlo,monospace;font-size:7.5pt;letter-spacing:.1em;color:var(--ink-soft);}
</style></head><body>
<div class="head">
  <div>
    <div class="co">${esc(company).toUpperCase()}</div>
    <div class="co-sub">${esc(COMPANY_ADDRESS)}</div>
    ${contact.web || contact.phone ? `<div class="co-sub">${esc([contact.web, contact.phone].filter(Boolean).join(' · '))}</div>` : ''}
  </div>
  <div class="doc">
    <div class="t">Plating Purchase Order</div>
    <div class="po">${esc(poLabel || shipId || '')}</div>
    <div class="d">${esc(dateStr || '')}</div>
  </div>
</div>
<div class="bcrow">
  <div class="meta" style="flex:1;margin:0 18px 0 0;">
    <div class="cell"><div class="k">Vendor / Plater</div><div class="v">${esc(vendor || '—')}</div></div>
    <div class="cell"><div class="k">Shipment</div><div class="v mono" style="font-size:9pt;">${esc(shipId || '—')}</div></div>
    <div class="cell"><div class="k">Finish(es)</div><div class="v">${esc(finishSummary || '—')}</div></div>
    <div class="cell"><div class="k">Lines / Pieces</div><div class="v">${lines.length} / ${totalPcs}</div></div>
    <div class="cell"><div class="k">Prepared By</div><div class="v">${esc(operator || '—')}</div></div>
    <div class="cell"><div class="k">Expected Back</div><div class="v">&nbsp;</div></div>
  </div>
  <div class="bc">${code128BSvg(shipId)}<div class="t">${esc(shipId)}</div></div>
</div>
<table>
<thead><tr><th class="c">#</th><th>Item</th><th>Description</th><th class="c">Finish</th><th>Returns As</th><th class="c">Bin</th><th class="c">WO#</th><th class="r">Qty</th><th class="r">Unit Cost</th><th class="r">Amount</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<div class="totals"><div class="box">
  <div class="row"><span class="k">Total Pieces</span><span>${totalPcs}</span></div>
  ${total != null && Number(total) > 0 ? `<div class="row big"><span>Plating Total</span><span>$${Number(total).toFixed(2)}</span></div>` : ''}
</div></div>
<div class="sign"><div>Shipped by / date</div><div>Received by plater / date</div></div>
<div class="foot">${esc(company)} · ${esc(COMPANY_ADDRESS)}${contact.web ? ` · ${esc(contact.web)}` : ''}${contact.phone ? ` · ${esc(contact.phone)}` : ''}</div>
</body></html>`;
    return docHtml;
};

export const printPlatingPackingList = (data) =>
    printHtmlDocument(buildPlatingPoHtml(data), { autoPrintDelay: 300, timeout: 60000 });
