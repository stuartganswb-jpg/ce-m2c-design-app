// Shared US-Letter plating packing list — used both when a shipment is created (Pick Pack) and when
// it's reprinted later from the vendor screen (External Co-Op). Print dispatch lives in
// labelPrint's printHtmlDocument (desktop = hidden iframe; Android tablets = blob-tab auto-print,
// because Chrome-on-Android prints the parent page from an iframe). Pass the stored `packingList`
// object: { shipId, brand, vendor, poLabel, dateStr, operator, lines[], pcs, total, finishSummary }.
import { code128BSvg, printHtmlDocument } from './labelPrint';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const printPlatingPackingList = ({ shipId, brand, vendor, poLabel, dateStr, operator, lines = [], pcs, total, finishSummary }) => {
    const totalPcs = pcs != null ? pcs : lines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
    const rows = lines.map((l, i) => `<tr>
<td class="c">${i + 1}</td>
<td>${esc(l.erpId || '')}</td>
<td>${esc(l.itemName || '')}</td>
<td class="c">${esc(l.finishCode || '')}</td>
<td>${esc(l.targetErpId || '')}</td>
<td class="c">${esc(l.platingBin || '')}</td>
<td class="c">${esc(l.woNum || '')}</td>
<td class="r">${parseInt(l.qty) || 0}</td>
</tr>`).join('');
    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Packing List ${esc(shipId)}</title><style>
@page{size:Letter portrait;margin:0.5in;}
*{box-sizing:border-box;} html,body{margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;color:#000;}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #000;padding-bottom:10px;}
.head h1{margin:0;font-size:22pt;letter-spacing:.5px;} .head .sub{font-size:10pt;color:#333;margin-top:2px;}
.bc{text-align:right;} .bc svg{width:2.4in;height:0.5in;} .bc .t{font-size:8pt;letter-spacing:2px;text-align:right;}
.meta{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px 24px;margin:16px 0 18px;font-size:10.5pt;}
.meta .k{color:#666;font-size:8pt;text-transform:uppercase;letter-spacing:.06em;} .meta .v{font-weight:700;}
table{width:100%;border-collapse:collapse;font-size:10pt;} th,td{border:1px solid #999;padding:6px 8px;text-align:left;}
th{background:#eee;font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em;} td.c{text-align:center;} td.r,th.r{text-align:right;}
tfoot td{font-weight:800;background:#f4f4f4;} .sign{margin-top:30px;display:flex;gap:40px;font-size:10pt;}
.sign div{flex:1;border-top:1px solid #000;padding-top:6px;color:#444;}
</style></head><body>
<div class="head">
  <div><h1>PLATING PACKING LIST</h1><div class="sub">${esc(brand || '')} &rarr; ${esc(vendor || 'Plater')} &nbsp;&middot;&nbsp; ${esc(dateStr || '')}</div></div>
  <div class="bc">${code128BSvg(shipId)}<div class="t">${esc(shipId)}</div></div>
</div>
<div class="meta">
  <div><div class="k">Shipment</div><div class="v">${esc(shipId)}</div></div>
  <div><div class="k">NetSuite PO</div><div class="v">${esc(poLabel || '—')}</div></div>
  <div><div class="k">Plater</div><div class="v">${esc(vendor || '—')}</div></div>
  <div><div class="k">Finish(es)</div><div class="v">${esc(finishSummary || '—')}</div></div>
  <div><div class="k">Lines / Pieces</div><div class="v">${lines.length} / ${totalPcs}</div></div>
  <div><div class="k">Prepared by</div><div class="v">${esc(operator || '—')}</div></div>
</div>
<table>
<thead><tr><th>#</th><th>Item</th><th>Description</th><th>Finish</th><th>Returns As</th><th>Bin</th><th>WO#</th><th class="r">Qty</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="7" class="r">Total pieces</td><td class="r">${totalPcs}</td></tr></tfoot>
</table>
<div class="sign"><div>Shipped by / date</div><div>Received by plater / date</div></div>
</body></html>`;
    return printHtmlDocument(docHtml, { autoPrintDelay: 300, timeout: 60000 });
};
