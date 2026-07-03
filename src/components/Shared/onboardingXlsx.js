// Customer onboarding / price-list workbook. Builds a branded .xlsx for one main assembly:
// a brand header (logo + name), the finishes tagged on the assembly's CPQ flow listed across the
// top, then the sellable items grouped by tag (Poles, Finials, Rings, Brackets, …) with a thumbnail,
// ERP id, description, sales price, and — when a customer is chosen — that customer's id/SKU/price.
// Hidden-tagged parts are excluded upstream. Uses the self-contained ExcelJS browser build so it
// bundles cleanly under react-scripts (no node polyfills).
import ExcelJS from 'exceljs/dist/exceljs.min.js';

// Pull the image bytes for a Storage URL so ExcelJS can embed it. Returns null on any failure
// (missing thumbnail, CORS, network) so the row still renders without an image.
async function fetchImage(url) {
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const ext = (ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g(\?|$)/i.test(url)) ? 'jpeg'
            : (ct.includes('gif') || /\.gif(\?|$)/i.test(url)) ? 'gif' : 'png';
        return { buffer: buf, extension: ext };
    } catch { return null; }
}

const money = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// groups: [{ label, items: [{ thumbnailUrl, erpId, description, salesPrice, customerSku, customerPrice }] }]
// finishes: [{ code, name }]   customer: { id, name } | null
export async function generateOnboardingXlsx({ brandName, logoUrl, assemblyName, assemblyErpId, finishes = [], groups = [], customer = null, fileName = 'onboarding.xlsx' }) {
    const wb = new ExcelJS.Workbook();
    wb.creator = '4Cos Workcenter';
    const ws = wb.addWorksheet('Onboarding', { views: [{ state: 'frozen', ySplit: 0 }], properties: { defaultRowHeight: 16 } });

    const INK = 'FF1A1A1A', SOFT = 'FF6B6B6B', BRASS = 'FFB08D57', LINE = 'FFD9D4C8', PAPER = 'FFF3F1EA';
    // Thumb | ERP id | Description | Sales $ | Cust ID | Cust SKU | Cust $
    ws.columns = [
        { width: 16 }, { width: 20 }, { width: 44 }, { width: 14 }, { width: 20 }, { width: 20 }, { width: 18 },
    ];
    const LASTCOL = 7;
    // Write one data cell (used for every item row). Kept out of the row loop so it doesn't close over
    // the loop variable — the row index is passed in explicitly.
    const setCell = (r, col, val, opts = {}) => {
        const c = ws.getCell(r, col); c.value = val;
        c.font = { size: 10, color: { argb: INK }, ...(opts.font || {}) };
        c.alignment = { vertical: 'middle', wrapText: !!opts.wrap, horizontal: opts.h || 'left', indent: opts.h ? 0 : 1 };
        if (opts.money) c.numFmt = '$#,##0.00';
        c.border = { bottom: { style: 'hair', color: { argb: LINE } } };
        return c;
    };

    // ── Brand header ────────────────────────────────────────────────────────────────────────
    ws.mergeCells('A1:B4');
    const logo = await fetchImage(logoUrl);
    if (logo) {
        const imgId = wb.addImage(logo);
        ws.addImage(imgId, { tl: { col: 0.15, row: 0.2 }, ext: { width: 190, height: 74 } });
    } else {
        const lc = ws.getCell('A1'); lc.value = brandName || ''; lc.font = { size: 16, bold: true, color: { argb: BRASS } };
        lc.alignment = { vertical: 'middle', horizontal: 'center' };
    }
    ws.mergeCells('C1:G1'); ws.mergeCells('C2:G2'); ws.mergeCells('C3:G3'); ws.mergeCells('C4:G4');
    const t1 = ws.getCell('C1'); t1.value = brandName || ''; t1.font = { name: 'Georgia', size: 22, bold: true, color: { argb: INK } };
    const t2 = ws.getCell('C2'); t2.value = 'Product Onboarding & Price List'; t2.font = { size: 11, color: { argb: SOFT } };
    const t3 = ws.getCell('C3'); t3.value = [assemblyName, assemblyErpId ? `(${assemblyErpId})` : ''].filter(Boolean).join('  '); t3.font = { size: 12, bold: true, color: { argb: INK } };
    const t4 = ws.getCell('C4'); t4.value = customer ? `Prepared for: ${customer.name || customer.id}` : ''; t4.font = { size: 10, italic: true, color: { argb: SOFT } };
    for (let r = 1; r <= 4; r++) ws.getCell(r, 3).alignment = { vertical: 'middle' };
    for (let r = 1; r <= 4; r++) ws.getRow(r).height = 20;

    let row = 6;

    // ── Finishes tagged on the flow, listed across the top ──────────────────────────────────
    if (finishes.length) {
        ws.mergeCells(row, 1, row, LASTCOL);
        const fh = ws.getCell(row, 1); fh.value = `AVAILABLE FINISHES  ·  ${finishes.length}`;
        fh.font = { name: 'Consolas', size: 10, bold: true, color: { argb: INK } };
        fh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
        fh.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(row).height = 20;
        row++;
        // Flow left-to-right, LASTCOL finishes per row, wrapping.
        let col = 1;
        finishes.forEach(f => {
            const cell = ws.getCell(row, col);
            cell.value = { richText: [
                { text: `${f.code || ''}`, font: { bold: true, size: 9, color: { argb: BRASS } } },
                { text: f.code ? `  ${f.name || ''}` : `${f.name || ''}`, font: { size: 9, color: { argb: INK } } },
            ] };
            cell.alignment = { vertical: 'middle', wrapText: true, indent: 1 };
            cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
            col++;
            if (col > LASTCOL) { col = 1; row++; }
        });
        if (col !== 1) row++;
        row++;
    }

    // ── Item table ──────────────────────────────────────────────────────────────────────────
    const headers = ['Image', 'ERP Item ID', 'Description', 'Sales Price', 'Customer ID', 'Customer SKU', 'Customer Price'];
    const hRow = ws.getRow(row);
    headers.forEach((h, i) => {
        const c = ws.getCell(row, i + 1); c.value = h;
        c.font = { name: 'Consolas', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
        c.alignment = { vertical: 'middle', horizontal: i >= 3 ? 'center' : 'left', indent: i < 3 ? 1 : 0 };
    });
    hRow.height = 22;
    row++;

    for (const group of groups) {
        if (!group.items || !group.items.length) continue;
        // Category band
        ws.mergeCells(row, 1, row, LASTCOL);
        const g = ws.getCell(row, 1); g.value = (group.label || 'Items').toUpperCase();
        g.font = { name: 'Consolas', size: 10, bold: true, color: { argb: INK }, letterSpacing: 1 };
        g.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } };
        g.alignment = { vertical: 'middle', indent: 1 };
        g.border = { top: { style: 'thin', color: { argb: BRASS } }, bottom: { style: 'hair', color: { argb: LINE } } };
        ws.getRow(row).height = 18;
        row++;

        for (const it of group.items) {
            const r = ws.getRow(row); r.height = 46;
            // thumbnail
            const img = await fetchImage(it.thumbnailUrl);
            if (img) {
                const id = wb.addImage(img);
                ws.addImage(id, { tl: { col: 0.15, row: row - 1 + 0.1 }, ext: { width: 84, height: 54 } });
            }
            ws.getCell(row, 1).border = { bottom: { style: 'hair', color: { argb: LINE } } };
            setCell(row, 2, it.erpId || '', { font: { name: 'Consolas', size: 9 } });
            setCell(row, 3, it.description || '', { wrap: true });
            setCell(row, 4, money(it.salesPrice), { h: 'center', money: true });
            setCell(row, 5, customer ? (customer.id || '') : '', { h: 'center', font: { name: 'Consolas', size: 9, color: { argb: SOFT } } });
            setCell(row, 6, it.customerSku || '', { h: 'center', font: { name: 'Consolas', size: 9, color: { argb: SOFT } } });
            setCell(row, 7, money(it.customerPrice), { h: 'center', money: true });
            row++;
        }
    }

    // Footer note
    row++;
    ws.mergeCells(row, 1, row, LASTCOL);
    const fn = ws.getCell(row, 1);
    fn.value = 'Prices shown are list unless a customer price is specified. Finishes above are the options available on the configurator for this item.';
    fn.font = { size: 8, italic: true, color: { argb: SOFT } };

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName; document.body.appendChild(a); a.click();
    a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
