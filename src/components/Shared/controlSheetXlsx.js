// Shared/controlSheetXlsx.js — a control sheet as an Excel file, and the same file read back.
//
// Stuart 2026-10-07 (tab 1.2): "download sheet as xlsx … and we add a reimport button to bring back updates,
// this way we can download and upload working sheets to share with our vendors".
//
// WHAT IS IN THE FILE AND WHAT MAY COME BACK is decided in Shared/controlSheet (exportColumnsFor,
// exportValueOf, planReimport). This module only writes the workbook and reads one: a title, a line of
// instruction, the header, one row per line with its picture, and a hidden sheet that says which sheet the
// file came from, when, and which column is which — so a returned file is matched by what it SAYS it is, not
// by where a vendor's program left its columns. Uses the self-contained ExcelJS browser build, as the other
// spreadsheet modules do.

import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { XLSX_FORMAT, REF_KEY, exportValueOf } from './controlSheet.js';

const META_SHEET = '_control_sheet';
const HEADER_ROW = 3;
const INK = 'FF1C1A16', PAPER = 'FFF2EFE8', SOFT = 'FF524E46', LINE = 'FFD9D5CC';
const str = (v) => (v === null || v === undefined ? '' : String(v));
const nameKey = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

// The picture's bytes for a Storage link, so the file can carry it. null on any failure — the row is still
// written, without its picture.
export async function fetchPicture(url, fetchImpl) {
    if (!url) return null;
    try {
        const res = await (fetchImpl || fetch)(url);
        if (!res || !res.ok) return null;
        const buffer = await res.arrayBuffer();
        const ct = str(res.headers && res.headers.get && res.headers.get('content-type')).toLowerCase();
        const extension = (ct.includes('jpeg') || ct.includes('jpg') || /\.jpe?g(\?|$)/i.test(url)) ? 'jpeg' : (ct.includes('gif') || /\.gif(\?|$)/i.test(url)) ? 'gif' : 'png';
        return { buffer, extension };
    } catch (_) { return null; }
}

// → the .xlsx as bytes.
//   columns   the ticked columns of exportColumnsFor, in order
//   lines     the selected lines, in the order they stand on the screen
//   pictures  { [lineId]: { buffer, extension } } for the lines whose picture was fetched
//   meta      { projectId, projectName, sectionId, sectionName, exportedAt }
export async function buildControlSheetXlsx({ columns, lines, sectionId, meta, pictures }) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(str(meta.sectionName || meta.projectName || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet', { views: [{ state: 'frozen', ySplit: HEADER_ROW }] });
    ws.columns = columns.map(c => ({ width: Math.max(7, Math.round((c.field && c.field.type === 'picture' ? 70 : c.width) / 7)) }));
    const last = Math.max(columns.length, 2);

    ws.mergeCells(1, 1, 1, last);
    const title = ws.getCell(1, 1);
    title.value = [meta.projectName, meta.sectionName].filter(Boolean).join('  ·  ');
    title.font = { name: 'Georgia', size: 16, bold: true, color: { argb: INK } };
    ws.getRow(1).height = 26;
    ws.mergeCells(2, 1, 2, last);
    const note = ws.getCell(2, 1);
    note.value = `Control sheet · ${str(meta.exportedAt).slice(0, 10)} · ${lines.length} line${lines.length === 1 ? '' : 's'}.  Fill in or correct the cells and send the file back. Please leave the Ref column as it is — it is how each row finds its line.`;
    note.font = { size: 9, italic: true, color: { argb: SOFT } };

    columns.forEach((c, i) => {
        const cell = ws.getCell(HEADER_ROW, i + 1);
        cell.value = c.label;
        cell.font = { name: 'Consolas', size: 9, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } };
        cell.alignment = { vertical: 'middle', wrapText: true };
    });
    ws.getRow(HEADER_ROW).height = 24;

    const pictureAt = columns.findIndex(c => c.field && c.field.type === 'picture');
    lines.forEach((line, n) => {
        const r = HEADER_ROW + 1 + n;
        columns.forEach((c, i) => {
            const cell = ws.getCell(r, i + 1);
            const v = exportValueOf(c, line, sectionId);
            cell.value = v === '' ? null : v;
            cell.alignment = { vertical: 'middle', wrapText: true };
            cell.border = { bottom: { style: 'hair', color: { argb: LINE } } };
            if (c.key === REF_KEY) { cell.font = { name: 'Consolas', size: 8, color: { argb: SOFT } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PAPER } }; }
        });
        const pic = pictureAt >= 0 && pictures ? pictures[line.id] : null;
        if (pic) {
            ws.getRow(r).height = 46;
            const id = wb.addImage({ buffer: pic.buffer, extension: pic.extension });
            ws.addImage(id, { tl: { col: pictureAt + 0.12, row: r - 1 + 0.08 }, ext: { width: 54, height: 54 } });
        }
    });

    // What the file says about itself. Hidden, not secret: it is how the way back knows the file.
    const ms = wb.addWorksheet(META_SHEET, { state: 'veryHidden' });
    [['format', XLSX_FORMAT], ['projectId', str(meta.projectId)], ['projectName', str(meta.projectName)], ['sectionId', str(sectionId || '')], ['exportedAt', str(meta.exportedAt)], ['headerRow', HEADER_ROW]]
        .forEach(([k, v], i) => { ms.getCell(i + 1, 1).value = k; ms.getCell(i + 1, 2).value = v; });
    ms.getCell(7, 1).value = 'columns';
    columns.forEach((c, i) => { ms.getCell(7, i + 2).value = c.key; });
    return wb.xlsx.writeBuffer();
}

// What a cell holds, as a plain value: Excel hands back objects for rich text, formulas, links and dates.
const plain = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
        if (Array.isArray(v.richText)) return v.richText.map(t => str(t.text)).join('');
        if ('result' in v) return plain(v.result);
        if ('text' in v) return plain(v.text);
        return '';
    }
    return v;
};

// bytes → { meta, columns: [{ key, label }], rows: [[raw, …]] } for controlSheet.planReimport.
//   knownColumns  every column a download of this sheet could have carried (exportColumnsFor of ALL fields)
// A column is recognised by what the file says it is (the hidden sheet's key for that position) when its
// heading still reads as that column's; a column that was moved or retitled is recognised by its heading when
// exactly one column answers to it; anything else comes back with key null and is named to the operator.
export async function readControlSheetXlsx(buffer, knownColumns) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ms = wb.getWorksheet(META_SHEET);
    let meta = null, metaKeys = [];
    if (ms) {
        const got = {};
        for (let r = 1; r <= 6; r++) got[str(plain(ms.getCell(r, 1).value))] = plain(ms.getCell(r, 2).value);
        if (got.format === XLSX_FORMAT) {
            meta = { projectId: str(got.projectId), projectName: str(got.projectName), sectionId: str(got.sectionId), exportedAt: str(got.exportedAt), headerRow: parseInt(got.headerRow, 10) || HEADER_ROW };
            for (let c = 2; c <= ms.columnCount; c++) metaKeys.push(str(plain(ms.getCell(7, c).value)));
        }
    }
    const ws = wb.worksheets.find(w => w.name !== META_SHEET);
    if (!ws) return { meta, columns: [], rows: [] };

    const width = Math.max(ws.columnCount, metaKeys.length);
    const textAt = (r, c) => str(plain(ws.getCell(r, c).value)).trim();
    let headerRow = meta ? meta.headerRow : 0;
    const isHeader = (r) => { for (let c = 1; c <= width; c++) if (nameKey(textAt(r, c)).startsWith('ref')) return true; return false; };
    if (!headerRow || !isHeader(headerRow)) { headerRow = 0; for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) if (isHeader(r)) { headerRow = r; break; } }
    if (!headerRow) return { meta, columns: [], rows: [] };

    const known = knownColumns || [];
    const byLabel = new Map();
    known.forEach(k => { const n = nameKey(k.label); byLabel.set(n, byLabel.has(n) ? null : k); });   // null = two columns share the heading
    const used = new Set();
    const columns = [];
    for (let c = 1; c <= width; c++) {
        const label = textAt(headerRow, c);
        const said = known.find(k => k.key === metaKeys[c - 1]);
        let pick = said && nameKey(said.label) === nameKey(label) ? said : null;
        if (!pick && nameKey(label).startsWith('ref')) pick = known.find(k => k.key === REF_KEY) || { key: REF_KEY };
        if (!pick) pick = byLabel.get(nameKey(label)) || null;
        if (pick && used.has(pick.key)) pick = null;
        if (pick) used.add(pick.key);
        columns.push({ key: pick ? pick.key : null, label });
    }
    const rows = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
        const row = columns.map((_, i) => plain(ws.getCell(r, i + 1).value));
        if (row.some(v => str(v).trim() !== '')) rows.push(row);
    }
    return { meta, columns, rows };
}

// Hand the bytes to the browser as a download.
export function saveXlsx(buffer, fileName) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}
