// The browser half of the fabric sheet (S7, 2026-09-24): the downloadable template (the same column
// contract the reader matches, three EXAMPLE- rows, a How-to-fill sheet, the live price groups as a
// read-only reference) and the file → sheets read through the ONE shared workbook loader. The rules
// live in Shared/pillowFabricSheet.js (pure); nothing here decides anything.
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { workbookFileToSheets } from './customerControlFile';
import { FABRIC_COLS, EXAMPLE_ROWS, HOW_TO_NOTES } from './pillowFabricSheet';

export const FABRIC_TEMPLATE_NAME = 'Uniquity Fabric Import Template.xlsx';

/** config = system/pillow_pricing (for the Price Groups reference sheet). Triggers the browser download. */
export async function downloadFabricTemplate({ config = null } = {}) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fabrics');
    ws.columns = FABRIC_COLS.map(c => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2933' } };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'middle' };
    ws.getRow(1).height = 32;
    EXAMPLE_ROWS.forEach(r => { const row = ws.addRow(r); row.font = { italic: true, color: { argb: 'FF777777' } }; });
    for (let r = 2; r <= 4; r++) for (let c = 1; c <= 5; c++) ws.getCell(r, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3D6' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const list = (formula) => ({ type: 'list', allowBlank: true, formulae: [formula] });
    for (let r = 2; r <= 500; r++) {
        ws.getCell(r, 3).dataValidation = list('"FABRIC,TRIM"');
        ws.getCell(r, 4).dataValidation = list('"A,B,C,D,E"');
        ws.getCell(r, 6).dataValidation = list('"TRUE,FALSE"');
        ws.getCell(r, 13).dataValidation = list('"TRUE,FALSE"');
    }

    const how = wb.addWorksheet('How to fill');
    how.columns = [{ header: 'Column', key: 'c', width: 26 }, { header: 'Rule', key: 'r', width: 110 }];
    how.getRow(1).font = { bold: true };
    FABRIC_COLS.forEach(c => { const row = how.addRow([c.header, c.rule]); row.getCell(1).font = { bold: true }; row.getCell(2).alignment = { wrapText: true }; });
    how.addRow([]);
    const n = how.addRow(['Notes', HOW_TO_NOTES[0]]); n.getCell(1).font = { bold: true }; n.getCell(2).alignment = { wrapText: true };
    HOW_TO_NOTES.slice(1).forEach(t => { const row = how.addRow(['', t]); row.getCell(2).alignment = { wrapText: true }; });

    const pg = wb.addWorksheet('Price Groups (reference)');
    const cfg = config || {};
    const sizes = Array.isArray(cfg.sizeOrder) && cfg.sizeOrder.length ? cfg.sizeOrder : Object.keys(cfg.prices || {});
    const groups = Object.entries(cfg.fabricGroups || {}).sort((a, b) => (a[1].rank || 0) - (b[1].rank || 0));
    if (groups.length) {
        const head = pg.addRow(['Group', 'Fabric', ...sizes]); head.font = { bold: true };
        groups.forEach(([code, g]) => pg.addRow([code, g.label || '', ...sizes.map(s => ((cfg.prices || {})[s] || {})[code] ?? '')]));
        pg.addRow([]);
        pg.addRow(['Read-only reference from the live Pillow Size Price Chart; the importer ignores this sheet.']).font = { italic: true, color: { argb: 'FF777777' } };
    } else {
        pg.addRow(['No price chart applied yet — apply the Pillow Size Price Chart first; the groups the fabrics may use come from it.']).font = { italic: true };
    }
    pg.getColumn(1).width = 10; pg.getColumn(2).width = 16;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = FABRIC_TEMPLATE_NAME;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** File → [{ name, grid }] through the shared loader. */
export const readFabricWorkbook = (file) => workbookFileToSheets(file);
