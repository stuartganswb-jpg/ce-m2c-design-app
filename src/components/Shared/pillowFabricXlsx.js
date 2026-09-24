// The browser half of the fabric sheet (S7, 2026-09-24): the downloadable workbook the team works
// from — PRE-FILLED with every fabric and trim in the Uniquity library (code, throw code, name,
// type, group, width, railroad, pattern, colour, cost, vendor, bin, stocked, NetSuite id, notes),
// then one COMPUTED column per standard size = the length to cut off the roll for ONE side of that
// pillow on that fabric (or — when the fabric is too narrow), three EXAMPLE- rows, a How-to-fill
// sheet, the minimum cut per size and the price groups as read-only references — and the file →
// sheets read through the ONE shared workbook loader. The rules live in Shared/pillowFabricSheet.js
// and Shared/pillowCuts.js (pure); nothing here decides anything.
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { workbookFileToSheets } from './customerControlFile';
import { FABRIC_COLS, EXAMPLE_ROWS, HOW_TO_NOTES, fabricSheetRowsOf, cutColumnHeaderOf, isFabricItem } from './pillowFabricSheet';
import { sizeKeysOf, sizeCutTableOf, cutRowFor, allowanceOf } from './pillowCuts';

export const FABRIC_TEMPLATE_NAME = 'Uniquity Fabric Sheet.xlsx';

const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2933' } };
const CUT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B4A5A' } };
const REQ_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3D6' } };
const NOFIT_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5E1E1' } };

/** One side's cut cell for a row: the inches, or '—' when the fabric is too narrow, '' when unknown. */
const cutCellsFor = (rowValues, config) => {
    const type = String(rowValues[3] || '').toUpperCase();
    if (type !== 'FABRIC') return sizeKeysOf(config).map(() => '');
    const widthIn = Number(rowValues[5]) || null;
    const railroad = String(rowValues[6] || '').toUpperCase() === 'TRUE';
    return cutRowFor(null, config, { widthIn, railroad }).map(c => (!c ? '' : c.fits === false ? '—' : c.lengthIn));
};

/**
 * items  = the Uniquity library (the caller's one read); config = system/pillow_pricing.
 * Triggers the browser download.
 */
export async function downloadFabricTemplate({ items = [], config = null } = {}) {
    const cfg = config || {};
    const sizes = sizeKeysOf(cfg);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Fabrics');
    ws.columns = [
        ...FABRIC_COLS.map(c => ({ header: c.header, key: c.key, width: c.width })),
        ...sizes.map(k => ({ header: cutColumnHeaderOf(k), key: `cut_${k}`, width: 12 })),
    ];
    const nBase = FABRIC_COLS.length;
    const head = ws.getRow(1);
    head.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    head.alignment = { wrapText: true, vertical: 'middle' };
    head.height = 44;
    for (let c = 1; c <= nBase + sizes.length; c++) ws.getCell(1, c).fill = c > nBase ? CUT_FILL : HEAD_FILL;

    const live = fabricSheetRowsOf(items);
    live.forEach(r => {
        const row = ws.addRow([...r, ...cutCellsFor(r, cfg)]);
        cutCellsFor(r, cfg).forEach((v, i) => { if (v === '—') row.getCell(nBase + i + 1).fill = NOFIT_FILL; row.getCell(nBase + i + 1).alignment = { horizontal: 'right' }; });
    });
    EXAMPLE_ROWS.forEach(r => {
        const row = ws.addRow([...r, ...cutCellsFor(r, cfg)]);
        row.font = { italic: true, color: { argb: 'FF777777' } };
    });
    const firstEx = live.length + 2;
    for (let r = 2; r < firstEx + EXAMPLE_ROWS.length; r++) for (let c = 1; c <= 6; c++) { if (c === 2) continue; ws.getCell(r, c).fill = REQ_FILL; }
    ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    const list = (formula) => ({ type: 'list', allowBlank: true, formulae: [formula] });
    const groups = Object.keys(cfg.fabricGroups || {});
    for (let r = 2; r <= Math.max(500, firstEx + 200); r++) {
        ws.getCell(r, 4).dataValidation = list('"FABRIC,TRIM"');
        if (groups.length) ws.getCell(r, 5).dataValidation = list(`"${groups.join(',')}"`);
        ws.getCell(r, 7).dataValidation = list('"TRUE,FALSE"');
        ws.getCell(r, 13).dataValidation = list('"TRUE,FALSE"');
    }

    const how = wb.addWorksheet('How to fill');
    how.columns = [{ header: 'Column', key: 'c', width: 26 }, { header: 'Rule', key: 'r', width: 110 }];
    how.getRow(1).font = { bold: true };
    FABRIC_COLS.forEach(c => { const row = how.addRow([c.header, c.rule]); row.getCell(1).font = { bold: true }; row.getCell(2).alignment = { wrapText: true }; });
    const cutRow = how.addRow(['Cut <size> (in, one side)', 'COMPUTED — the length to cut off the roll for ONE side of that pillow on this fabric (its width and railroad flag against the minimum cut per size); "—" = the fabric is too narrow for that size. A standard pillow takes two. Ignored on upload.']);
    cutRow.getCell(1).font = { bold: true }; cutRow.getCell(2).alignment = { wrapText: true };
    how.addRow([]);
    const n = how.addRow(['Notes', HOW_TO_NOTES[0]]); n.getCell(1).font = { bold: true }; n.getCell(2).alignment = { wrapText: true };
    HOW_TO_NOTES.slice(1).forEach(t => { const row = how.addRow(['', t]); row.getCell(2).alignment = { wrapText: true }; });

    const mc = wb.addWorksheet('Min cut per size (reference)');
    mc.columns = [{ header: 'Size (wide × tall)', width: 18 }, { header: 'One-side cut length (in)', width: 24 }, { header: 'One-side cut width (in)', width: 24 }, { header: 'Source', width: 30 }];
    mc.getRow(1).font = { bold: true };
    sizeCutTableOf(cfg).forEach(row => mc.addRow([row.key, row.minCut ? row.minCut.lengthIn : '', row.minCut ? row.minCut.widthIn : '', row.minCut ? (row.minCut.derived ? `pillow + ${allowanceOf(cfg)}" allowance each way` : 'set on the Pillow Pricing screen') : '']));
    mc.addRow([]);
    mc.addRow(['Length runs along the roll (the pillow\'s height); a railroad fabric takes the cut turned. Edit on 6.5 Tools → Pillow Pricing.']).font = { italic: true, color: { argb: 'FF777777' } };

    const pg = wb.addWorksheet('Price Groups (reference)');
    const gs = Object.entries(cfg.fabricGroups || {}).sort((a, b) => (a[1].rank || 0) - (b[1].rank || 0));
    if (gs.length) {
        const h = pg.addRow(['Group', 'Fabric', ...sizes]); h.font = { bold: true };
        gs.forEach(([code, g]) => pg.addRow([code, g.label || '', ...sizes.map(s => ((cfg.prices || {})[s] || {})[code] ?? '')]));
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
    return { rows: live.length, fabrics: items.filter(isFabricItem).length, sizes: sizes.length };
}

/** File → [{ name, grid }] through the shared loader. */
export const readFabricWorkbook = (file) => workbookFileToSheets(file);
