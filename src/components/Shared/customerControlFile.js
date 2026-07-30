// CUSTOMER CONTROL FILE — parse + diff for the Customer Collections page (Stuart 2026-07-29).
//
// The Fabricut H1 rollout was driven by a one-off xlsx import, which worked but left no way to fix
// what the sheet missed (H1-1D) or to price a second customer against an existing collection
// (Calico ↔ Simple Elegance). This module is the reusable half of the answer: it reads a customer
// control file into flat rows, and diffs those rows against the library so the page can show what
// WOULD change before anything is written. No Firestore, no React — so it can be unit-tested.
//
// SHEET SHAPE (Calico_CE_SimpleElegance_Control_File): the workbook is a human document, not an
// export — it repeats a header block per size section, and the header LABELS drift between blocks
// ("Base Price" in the first, "Our Sales Price" after; "Calico Net" is only labelled once but the
// column stays populated). So blocks are detected wherever they appear, columns are resolved per
// block, and a block that only labels some of its columns inherits the positions of the one before
// it. Section rows (" .75″ Hardware") and group rows ("  Finials") carry no SKU and become the
// row's group labels rather than data.
import ExcelJS from 'exceljs/dist/exceljs.min.js';

const norm = (v) => String(v ?? '').trim();
const low = (v) => norm(v).toLowerCase().replace(/\s+/g, ' ');
export const upper = (v) => norm(v).toUpperCase();

// "$1,234.50" → 1234.5 · "TBD" / "" / null → null (a non-number is NOT zero; it means "not set yet"
// and must never be written as a price).
export const money = (v) => {
    if (v === null || v === undefined) return null;
    const raw = (typeof v === 'object' && v.result !== undefined) ? v.result : v;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    const s = String(raw).replace(/[$,\s]/g, '');
    if (!s || /^(tbd|n\/?a|-+)$/i.test(s)) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

// Column roles. Matched on the label when the block labels it, else inherited by position.
const ROLE_BY_LABEL = [
    [/^our (sku|part) id/, 'sku'],
    [/^(our )?description/, 'desc'],
    [/^finish$/, 'finish'],
    [/^available finishes/, 'finishes'],
    [/^(base price|our sales price|our price)/, 'ourPrice'],
    [/net$/, 'theirNet'],                       // "Calico Net" — the price the customer pays us
    [/^(your item id|.* id)$/, 'theirSku'],     // "Calico ID" / "Your Item ID"
    [/^(your|.*) sales( price)?$/, 'theirSales'],
];
const roleOf = (label) => {
    const l = low(label);
    if (!l) return null;
    for (const [re, role] of ROLE_BY_LABEL) if (re.test(l)) return role;
    return null;
};

// A row is a header block when it names the SKU column.
const isHeaderRow = (vals) => vals.some(v => /^our (sku|part) id/.test(low(v)));

export function parseControlWorkbookFromSheets(sheets) {
    const rows = [];
    const sheetsRead = [], sheetsSkipped = [];
    sheets.forEach(({ name, grid }) => {
        let cols = null;              // role → 1-based column
        let section = '', group = '';
        let found = 0;
        grid.forEach(vals => {
            if (isHeaderRow(vals)) {
                const next = {};
                vals.forEach((v, i) => { const r = roleOf(v); if (r && !next[r]) next[r] = i + 1; });
                // A later block that drops a label keeps the previous block's position for that role
                // (the "Calico Net" column is labelled once and populated throughout).
                cols = { ...(cols || {}), ...next };
                return;
            }
            const filled = vals.filter(v => norm(v) !== '');
            // A LABEL ROW carries one piece of text and nothing else. It is matched on the number of
            // DISTINCT values, not the number of filled cells, because a section banner is a merged
            // range — openpyxl reports it once, but ExcelJS (what the browser uses) hands back the
            // same string in all 8 columns, which otherwise reads as a data row whose "SKU" is
            // ".75″ Hardware". Leading double-space = a SECTION (size band); deeper indent = a GROUP
            // (Finials / Brackets / …). Both are display context only.
            // Handled BEFORE the header guard because the first section title sits above the first
            // header block — the workbook's own title rows land here too and are simply overwritten
            // by the real section before any data row is emitted.
            const distinct = [...new Set(filled.map(v => norm(v)))];
            if (distinct.length === 1 && !isHeaderRow(vals)) {
                const raw = filled.find(v => norm(v) === distinct[0]);
                const indent = String(raw).match(/^\s*/)[0].length;
                if (indent >= 3) group = distinct[0]; else { section = distinct[0]; group = ''; }
                return;
            }
            if (!cols) return;                                   // preamble before the first block
            const cell = (role) => cols[role] ? vals[cols[role] - 1] : undefined;
            const sku = upper(cell('sku'));
            // Shape guard: a real item # is alphanumeric with dashes/slashes/dots and NO spaces.
            // Anything else in the SKU column is prose that drifted into the grid — skip it rather
            // than manufacture a phantom part from it.
            if (!sku || !/^[A-Z0-9][A-Z0-9\-/.]*$/.test(sku)) return;
            const [base, suffix = ''] = sku.split('/');
            rows.push({
                sku, base, suffix,
                desc: norm(cell('desc')),
                finish: norm(cell('finish')),
                finishes: norm(cell('finishes')),
                ourPrice: money(cell('ourPrice')),
                theirNet: money(cell('theirNet')),
                theirSku: norm(cell('theirSku')),
                theirSales: money(cell('theirSales')),
                section, group, sheet: name,
            });
            found++;
        });
        (found ? sheetsRead : sheetsSkipped).push(name);
    });
    return { rows, sheetsRead, sheetsSkipped };
}

export async function parseControlWorkbook(file) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheets = wb.worksheets.map(ws => {
        const grid = [];
        ws.eachRow({ includeEmpty: true }, (row) => {
            const vals = [];
            for (let c = 1; c <= ws.columnCount; c++) {
                const v = row.getCell(c).value;
                vals.push(v && typeof v === 'object' && v.result !== undefined ? v.result : (v && v.richText ? v.richText.map(t => t.text).join('') : v));
            }
            grid.push(vals);
        });
        return { name: ws.name, grid };
    });
    return parseControlWorkbookFromSheets(sheets);
}

// De-duplicate to ONE row per SKU. A control file repeats a part across finish rows; the last
// non-empty value for each field wins, so a per-finish override later in the sheet is respected.
export function collapseBySku(rows) {
    const by = new Map();
    rows.forEach(r => {
        const prev = by.get(r.sku);
        if (!prev) { by.set(r.sku, { ...r }); return; }
        ['desc', 'finish', 'theirSku'].forEach(k => { if (norm(r[k])) prev[k] = r[k]; });
        ['ourPrice', 'theirNet', 'theirSales'].forEach(k => { if (r[k] !== null) prev[k] = r[k]; });
    });
    return [...by.values()];
}

const sameNum = (a, b) => {
    const x = a === '' || a === null || a === undefined ? null : parseFloat(a);
    const y = b === '' || b === null || b === undefined ? null : parseFloat(b);
    if (x === null && y === null) return true;
    if (x === null || y === null) return false;
    return Math.abs(x - y) < 0.005;
};

// Diff parsed rows against the library. `libByCode` maps UPPERCASE item # → { id, code, basePrice,
// row } where `row` is the customer's existing clientPricing row (or null).
// Returns one entry per sheet row, classified — nothing is written here.
//   UNMATCHED  no library item with that item #  → cannot be priced; the operator has to create it
//   NEW        library item, no pricing row yet for this customer
//   CHANGED    a row exists and at least one field differs
//   SAME       nothing to do
export function diffControlRows(rows, libByCode) {
    const out = [];
    rows.forEach(r => {
        const lib = libByCode.get(r.sku) || null;
        if (!lib) { out.push({ ...r, status: 'UNMATCHED' }); return; }
        const cur = lib.row || null;
        const fields = {
            clientSku: r.theirSku,
            price: r.theirNet,
            clientSalesPrice: r.theirSales,
        };
        // Blank in the sheet = "no opinion", never an instruction to erase a value already on file.
        const changes = {};
        Object.entries(fields).forEach(([k, v]) => {
            if (v === null || v === '') return;
            const isNum = k !== 'clientSku';
            const same = isNum ? sameNum(cur?.[k], v) : upper(cur?.[k]) === upper(v);
            if (!same) changes[k] = v;
        });
        const baseChanged = r.ourPrice !== null && !sameNum(lib.basePrice, r.ourPrice);
        out.push({
            ...r, docId: lib.id, current: cur, changes, baseChanged, newBase: r.ourPrice,
            status: !cur ? 'NEW' : (Object.keys(changes).length || baseChanged) ? 'CHANGED' : 'SAME',
        });
    });
    return out;
}

export const diffSummary = (entries) => entries.reduce((a, e) => { a[e.status] = (a[e.status] || 0) + 1; return a; }, {});
