// Item Starter Kit for the Assembly Builder (tab 1.6): a pre-filled .xlsx template listing every
// item KIND a hardware CPQ flow needs (pole + /P variant, rings, brackets, backplates regular/
// return/cover, finials, fee entities) with the same fields the Library Mass Update tool (tab 4.5)
// manages — fill it in, upload, and the items are created in the Master Library under a Project so
// the 1.6 auto-match/pickers find them immediately. Uses the exceljs browser build (same as the
// onboarding export) so it bundles cleanly under react-scripts.
import ExcelJS from 'exceljs/dist/exceljs.min.js';

// Column contract shared by the template AND the upload parser. Headers mirror tab 4.5's naming.
export const STARTER_COLS = [
    { key: 'itemId', header: 'Item ID (ERP #)', width: 22 },
    { key: 'name', header: 'Item Name / Description', width: 42 },
    { key: 'entityClass', header: 'Entity Class (Inventory/Fee)', width: 24 },
    { key: 'productType', header: 'Product Type (Category)', width: 22 },
    { key: 'project', header: 'Project', width: 18 },
    { key: 'basePrice', header: 'Base Price', width: 12 },
    { key: 'cost', header: 'Cost', width: 10 },
    { key: 'weight', header: 'Weight', width: 10 },
    { key: 'uom', header: 'UOM', width: 8 },
    { key: 'partHandling', header: 'Part Handling', width: 16 },
    { key: 'watchList', header: 'Watchlist', width: 14 },
    { key: 'collection', header: 'Collection', width: 16 },
    { key: 'isInHouse', header: 'Is In-House (TRUE/FALSE)', width: 20 },
    { key: 'isStocked', header: 'Is Stocked (TRUE/FALSE)', width: 20 },
    { key: 'paintSize', header: 'Paint Size (S/M/L)', width: 16 },
    { key: 'backplateOrientation', header: 'Backplate Orientation', width: 20 },
    { key: 'isReturnBracket', header: 'Is Return Bracket (TRUE/FALSE)', width: 24 },
    { key: 'projection', header: 'Bracket Projection', width: 16 },
    { key: 'vendorName', header: 'Vendor Name', width: 16 },
    { key: 'vendorSku', header: 'Vendor SKU', width: 14 },
    { key: 'notes', header: 'Notes (NOT imported)', width: 46 },
];

// Sample catalog modeled on the FABRICUT H1-75 flow. "XX-75" is a placeholder pattern — replace it
// with the real series. Every row is an EXAMPLE meant to be edited; duplicates of existing ERP ids
// are skipped at upload, so an accidental unedited upload can't double real items.
const SAMPLE = (proj) => [
    ['XX-75INPOLE', '3/4" ROUND ROD (PER FOOT) - MILL FINISH', 'Inventory', 'POLE', proj, '', '', '', 'FT', 'Custom', '', '', 'TRUE', 'FALSE', 'L', '', '', '', '', '', 'Base mill rod, priced per foot. Also create the /P variant below.'],
    ['XX-75INPOLE/P', '3/4" ROUND ROD (PER FOOT) - PHOSPHATED', 'Inventory', 'POLE', proj, '12.00', '', '', 'FT', 'Custom', '', '', 'TRUE', 'TRUE', 'L', '', '', '', '', '', 'Stocked phosphated rod — ALL paint finishes (P01…) bill this /P item.'],
    ['XX-75RING', 'RING FOR 3/4" ROUND ROD - MILL FINISH', 'Inventory', 'RING', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', '', '', '', '', '', 'Create /P (and /EPn if stocked) variants the same way.'],
    ['XX-75BE', 'BASIC BRACKET (4-5/8" P) - MILL FINISH', 'Inventory', 'BRACKET', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'M', '', 'FALSE', '4.625', '', '', 'Tick "basic" on this choice in 1.6 — basic brackets take no backplate.'],
    ['XX-75DE', 'DECORATIVE EXTENDED BRACKET (4-5/8" P) - MILL FINISH', 'Inventory', 'BRACKET', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'M', '', 'FALSE', '4.625', '', '', 'Pairs with the REGULAR backplates.'],
    ['XX-75ILE', 'IN LINE BRACKET (4-5/8" P) - MILL FINISH', 'Inventory', 'BRACKET', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'M', '', 'TRUE', '4.625', '', '', 'Tick "rtn-bp" on this choice in 1.6 — pairs with the RETURN backplates.'],
    ['XX-75PE', 'PASSING ARM (CENTER) - MILL FINISH', 'Inventory', 'BRACKET', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'M', '', 'FALSE', '4.625', '', '', 'Center passing bracket (clone/multiply in CPQ).'],
    ['XX-75BP-H', 'HORIZONTAL BACKPLATE - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'HORIZONTAL', '', '', '', '', 'Regular plates: H / R / S / V orientations.'],
    ['XX-75BP-R', 'ROUND BACKPLATE - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'ROUND', '', '', '', '', ''],
    ['XX-75BP-S', 'SQUARE BACKPLATE - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'SQUARE', '', '', '', '', ''],
    ['XX-75BP-V', 'VERTICAL BACKPLATE - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'VERTICAL', '', '', '', '', ''],
    ['XX-75CP-H', 'HORIZONTAL COVER PLATE - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'HORIZONTAL', '', '', '', '', 'Cover plates ride the same Backplate chooser.'],
    ['XX-75RBP-H', 'HORIZONTAL BACKPLATE FOR RETURNS - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'HORIZONTAL', '', '', '', '', 'RETURN plates: keep "FOR RETURNS" in the name and RETURN in the 1.6 slot label — that is what scopes them to returns/in-line brackets.'],
    ['XX-75RCP-R', 'ROUND COVER PLATE FOR RETURNS - MILL FINISH', 'Inventory', 'BACKPLATE', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', 'ROUND', '', '', '', '', ''],
    ['XX-75BF', 'BALL FINIAL FOR 3/4" ROUND - MILL FINISH', 'Inventory', 'FINIAL', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', '', '', '', '', '', 'Finial choices stack in the Left/Right End slots.'],
    ['XX-75CC', 'CLASSIC END CAP FOR 3/4" ROUND - MILL FINISH', 'Inventory', 'FINIAL', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', '', '', '', '', '', ''],
    ['XX-75EC', 'END CAP FOR 3/4" ROUND - MILL FINISH', 'Inventory', 'FINIAL', proj, '', '', '', 'EA', 'Small Parts', '', '', 'TRUE', 'FALSE', 'S', '', '', '', '', '', ''],
    ['CE-FEE-BENDRETURN', 'FRENCH RETURN BEND FEE', 'Fee', 'FEE', proj, '20.00', '', '', 'EA', '', '', '', 'TRUE', 'FALSE', '', '', '', '', '', '', 'Fee entity — bills as its own charge, never a physical BOM unit. Tick "fee" on the bend choice in 1.6 or reassign its pin to this entity.'],
    ['CE-FEE-MITERRETURN', 'MITER RETURN FEE', 'Fee', 'FEE', proj, '20.00', '', '', 'EA', '', '', '', 'TRUE', 'FALSE', '', '', '', '', '', '', 'Same rules as the french return (MTR nodes).'],
];

export async function downloadItemStarterTemplate(brandName) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Items');
    ws.columns = STARTER_COLS.map(c => ({ header: c.header, key: c.key, width: c.width }));
    ws.getRow(1).font = { bold: true, size: 10 };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A1A' } };
    ws.getRow(1).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    SAMPLE('NEW PROJECT').forEach(r => ws.addRow(r));
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const info = wb.addWorksheet('READ ME');
    ws.getRow(1).height = 20;
    [
        'ITEM STARTER KIT — how to use',
        '',
        '1. Replace the sample rows: swap the XX-75 pattern for your real series (e.g. H2-75). Every row is an example — edit freely, add/delete rows.',
        '2. Item ID = the ERP # the designer will also use in the .glb node names ("<ITEM#> <POSITION>") — that naming is what makes 1.6 auto-match choices to these items.',
        '3. Finish variants: the base mill item usually has NO price. Create "<ITEM>/P" (stocked phosphated, all paint finishes bill it) and exact "<ITEM>/EPn" rows for stocked EP finishes — those carry the prices.',
        '4. Entity Class Fee = a charge with no physical BOM unit (returns/bends). Give it a Base Price; the CPQ bills it as its own line.',
        '5. Hidden parts (screws, standoffs, stray geometry) need NO rows here — leave them blank in 1.6 (shared hardware) or tick "hide".',
        '6. Project groups everything for easy finding; the upload skips any Item ID that already exists in the brand library (no duplicates).',
        '7. Upload on tab 1.6 → "Upload & Create Items". Fields mirror the Library Mass Update tool (tab 4.5) — anything else can be mass-edited there later.',
    ].forEach((t, i) => { const c = info.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 13 }; });
    info.getColumn(1).width = 130;

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Item_Starter_Kit_${(brandName || 'brand').replace(/[^a-z0-9]/gi, '_')}.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Parse a filled template back to row objects keyed by STARTER_COLS keys. Header-matched (not
// position-matched) so reordered/extra columns don't break; blank Item ID rows are dropped.
export async function parseItemStarterWorkbook(file) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.getWorksheet('Items') || wb.worksheets[0];
    if (!ws) throw new Error('No worksheet found.');
    const headerRow = ws.getRow(1);
    const colFor = {};
    headerRow.eachCell((cell, colNumber) => {
        const h = String(cell.value || '').trim().toLowerCase();
        const def = STARTER_COLS.find(c => c.header.toLowerCase() === h);
        if (def) colFor[def.key] = colNumber;
    });
    if (!colFor.itemId || !colFor.name) throw new Error('Header row not recognized — keep the "Item ID (ERP #)" and "Item Name / Description" columns from the template.');
    const rows = [];
    ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const get = (k) => { const c = colFor[k]; if (!c) return ''; const v = row.getCell(c).value; return String((v && v.result !== undefined ? v.result : v) ?? '').trim(); };
        const itemId = get('itemId');
        if (!itemId) return;
        const o = {};
        STARTER_COLS.forEach(c => { o[c.key] = get(c.key); });
        rows.push(o);
    });
    return rows;
}
