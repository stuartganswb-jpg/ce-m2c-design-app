// ── THE FABRIC SHEET → Uniquity library items (S7, Stuart 2026-09-24) ─────────────────────────
//
// The office fills one row per fabric (the yardage item every throw already has, and fabrics sold
// by the yard) or trim; the Pillow Pricing screen reads it, matches each row to the Uniquity
// library BY CODE, and shows CREATE / UPDATE / REFUSED per row before anything is written. The
// column contract below is shared by the downloadable template and the reader, so the two can
// never drift. Cuts of a fabric are NOT items and are not on this sheet — they are the
// `fabric_pieces` ledger (Stuart: the sewing floor declares the remainder when a pillow is finished).
//
// What a row writes (and only this): productType FABRIC / TRIMMING, priceGroup, width, uom RY,
// cost, vendorName, homeBin, isStocked, customData.patternId / color / railroad / convertedFrom,
// itemName, netSuiteInternalId (only when typed). Base price is never touched. A new code creates
// the record in the shape the 1.6 Item Starter uses, brand uniquity. Pure: no imports past the
// pricing module's readers. Proven by scripts/pillowFabricSheet.test.mjs.

import { priceGroupOf } from './pillowPricing.js';

export const FABRIC_TYPES = ['FABRIC', 'TRIM'];
export const PRODUCT_TYPE_OF = { FABRIC: 'FABRIC', TRIM: 'TRIMMING' };
export const EXAMPLE_PREFIX = 'EXAMPLE-';

/** The column contract — header text is what the reader matches (case-insensitive, trimmed). */
export const FABRIC_COLS = [
    { key: 'code', header: 'Item Code', width: 20, rule: 'REQUIRED. Our item number — the NetSuite item name (the fabric-yardage item; every throw already has one). Unique. Matches an existing Uniquity item to UPDATE it; a new code CREATES the item. A code starting EXAMPLE- is refused.' },
    { key: 'convertedFrom', header: 'Throw Item Code', width: 20, rule: 'The THROW item this fabric yardage is converted from (blank for a fabric bought by the yard, and for a trim).', aliases: ['Converted From (throw code)'] },
    { key: 'name', header: 'Name', width: 34, rule: 'REQUIRED. The description the board and the quote print (pattern + colour).' },
    { key: 'type', header: 'Type', width: 9, rule: 'REQUIRED. FABRIC = by the running yard (the yardage item) · TRIM = a trim or fringe by the yard.' },
    { key: 'priceGroup', header: 'Price Group', width: 11, rule: 'REQUIRED for FABRIC: A–E from the Pillow Size Price Chart (must exist in the live table). Blank for TRIM.' },
    { key: 'width', header: 'Width (in)', width: 10, rule: 'REQUIRED for FABRIC: the true bolt / yardage width (e.g. 54). Blank for TRIM.' },
    { key: 'railroad', header: 'Railroad (TRUE/FALSE)', width: 20, rule: 'Optional, default FALSE. TRUE = the design REQUIRES a railroad cut (the pattern runs along the length); cuts for this fabric are fitted turned. Fewer than 5% of fabrics.' },
    { key: 'patternId', header: 'Pattern #', width: 14, rule: 'Optional. The pattern id on the swatch / quote (Asset Gallery pattern field).' },
    { key: 'color', header: 'Color', width: 14, rule: 'Optional. Colour name or number.' },
    { key: 'cost', header: 'Cost per Yard ($)', width: 14, rule: 'Optional.' },
    { key: 'vendor', header: 'Vendor', width: 16, rule: 'Optional.' },
    { key: 'homeBin', header: 'Home Bin', width: 10, rule: 'Optional. Warehouse bin.' },
    { key: 'stocked', header: 'Stocked (TRUE/FALSE)', width: 18, rule: 'Optional, default TRUE. FALSE = special order only.' },
    { key: 'nsId', header: 'NetSuite Internal ID', width: 18, rule: 'Optional. Leave blank — the NetSuite sync fills it; type it only if you know it.' },
    { key: 'notes', header: 'Notes', width: 30, rule: 'Optional.' },
];

export const EXAMPLE_ROWS = [
    ['EXAMPLE-SAVERY-NAT', '', 'Savery Natural linen 54"', 'FABRIC', 'A', 54, 'FALSE', 'SAVERY', 'Natural', 28, 'Uniq Fabric', 'F-01', 'TRUE', '', 'group A typical fabric, bought by the yard'],
    ['EXAMPLE-NAKA10-FAB', 'NAKA10-THROW', 'Naka 10 fabric yardage (from the Naka 10 throw)', 'FABRIC', 'C', 40, 'TRUE', 'NAKA', '10', 45, 'Uniq Throws', 'F-04', 'TRUE', '', 'converted from the throw; railroad'],
    ['EXAMPLE-BRUSH-FRINGE-IVY', '', 'Brush fringe ivory 2"', 'TRIM', '', '', '', 'BF-2', 'Ivory', 6.5, 'Romo Trim', 'T-02', 'TRUE', '', 'per yard'],
];

/** The cut columns the download adds after the contract columns — computed, one side, ignored on import. */
export const cutColumnHeaderOf = (sizeKey) => `Cut ${sizeKey} (in, one side)`;
export const CUT_COLUMN_RX = /^CUT\s+\d+(\.\d+)?X\d+(\.\d+)?\s*\(/i;

/**
 * The live library → the sheet's rows (one per fabric / trim the board can pick), the office's
 * working copy: code, throw code, name, type, group, width, railroad, pattern, colour, cost, vendor,
 * bin, stocked, NetSuite id, notes — in FABRIC_COLS order. Cut columns are the caller's (they need
 * the price table). Items that are neither fabric nor trim are not listed.
 */
export const isFabricItem = (it) => ['FABRIC', 'TEXTILE', 'RAW MATERIAL'].includes(String((it && it.manufacturingSpecs && it.manufacturingSpecs.productType) || (it && it.productType) || '').toUpperCase());
export const isTrimItem = (it) => ['TRIMMING', 'TRIM'].includes(String((it && it.manufacturingSpecs && it.manufacturingSpecs.productType) || (it && it.productType) || '').toUpperCase());
export const fabricSheetRowsOf = (items = []) => (items || [])
    .filter(it => isFabricItem(it) || isTrimItem(it))
    .sort((a, b) => String(a.legacyErpId || a.itemId || '').localeCompare(String(b.legacyErpId || b.itemId || '')))
    .map(it => {
        const specs = it.manufacturingSpecs || {};
        const cd = specs.customData || {};
        const fabric = isFabricItem(it);
        return [
            it.legacyErpId || it.itemId || '', cd.convertedFrom || '', it.itemName || '', fabric ? 'FABRIC' : 'TRIM',
            fabric ? (specs.priceGroup || '') : '', fabric && specs.width ? specs.width : '', cd.railroad ? 'TRUE' : 'FALSE',
            cd.patternId || '', cd.color || '', specs.cost === undefined || specs.cost === null || specs.cost === '' ? '' : specs.cost,
            specs.vendorName || '', specs.homeBin || '', specs.isStocked === false ? 'FALSE' : 'TRUE', it.netSuiteInternalId || '', cd.importNotes || '',
        ];
    });

export const HOW_TO_NOTES = [
    'The sheet is PRE-FILLED with every fabric and trim in the Uniquity library. Edit a row to update the item; add a row (a new Item Code) to create one; the three grey EXAMPLE- rows are examples — delete them (the importer refuses any code starting EXAMPLE-).',
    'The Cut columns (one per standard pillow size) are COMPUTED from the fabric\'s width, its railroad flag and the minimum cut per size on the Pillow Pricing screen: the length to cut off the roll for ONE side, or — when the fabric is too narrow for that size. They are for the team to work from and are ignored on upload.',
    'Throw Item Code = the throw this fabric yardage is converted from; blank for goods bought by the yard.',
    'Unit of measure is derived from Type: FABRIC and TRIM are kept and used in running yards. Do not add a UOM column.',
    'Cuts of a fabric are NOT items and are not on this sheet: they live in the Fabric Cut Stock ledger (6.5 Tools on the Uniquity brand), declared by the sewing floor when a pillow is finished.',
    'The pillow price = the size at the HIGHEST price group among its panels (Pillow Size Price Chart) + labour per seam + details. A FABRIC row with no Price Group cannot be used on a pillow.',
    'The minimum cut per size on the Pillow Pricing screen is ONE SIDE; a standard pillow takes two. Yardage off the bolt = widths across × (cut length + 2 × seam allowance) ÷ 36, rounded up to ⅛ yd — so Width must be the true bolt width.',
    'Upload: 6.5 Tools → Pillow Pricing → Fabrics → drop this file → preview (creates / updates / refusals listed by row) → Apply. Nothing is written until Apply. Base price and the NetSuite id are never touched unless typed.',
    'Re-uploading the same file changes nothing; changed fields are listed per row in the preview.',
];

const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const str = (v) => String(v === null || v === undefined ? '' : v).trim();
const num = (v) => { if (v === null || v === undefined || String(v).trim() === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const boolOf = (v, dflt) => { const s = up(v); if (!s) return { ok: true, value: dflt }; if (s === 'TRUE' || s === 'YES' || s === '1') return { ok: true, value: true }; if (s === 'FALSE' || s === 'NO' || s === '0') return { ok: true, value: false }; return { ok: false, value: dflt }; };
export const codeKeyOf = (v) => up(v);

/** Find the Fabrics sheet: the first whose header row carries ITEM CODE and TYPE. */
export const findFabricSheet = (sheets = []) => {
    for (const sh of sheets || []) {
        const grid = (sh && sh.grid) || [];
        for (let r = 0; r < Math.min(grid.length, 10); r++) {
            const row = (grid[r] || []).map(up);
            if (row.includes('ITEM CODE') && row.includes('TYPE') && row.includes('NAME')) return { sheet: sh, headerRow: r, colIndex: colIndexOf(grid[r]) };
        }
    }
    return null;
};
const colIndexOf = (header) => {
    const idx = {};
    FABRIC_COLS.forEach(c => { const names = [c.header, ...(c.aliases || [])].map(up); const i = (header || []).findIndex(h => names.includes(up(h))); if (i >= 0) idx[c.key] = i; });
    return idx;
};

/**
 * Sheets → rows. `groups` = the live price table's group codes (a Price Group outside them refuses).
 * { ok, errors[{row,code,message}], warnings[], rows[{ rowNo, code, name, type, priceGroup, width,
 *   railroad, patternId, color, cost, convertedFrom, vendor, homeBin, stocked, nsId, notes }] }
 */
export function parseFabricSheet(sheets = [], { groups = [] } = {}) {
    const errors = [], warnings = [];
    const hit = findFabricSheet(sheets);
    if (!hit) return { ok: false, errors: [{ row: 0, code: 'NO_SHEET', message: 'No sheet has a header row with Item Code · Name · Type' }], warnings, rows: [] };
    const { sheet, headerRow, colIndex } = hit;
    const missing = ['code', 'name', 'type', 'priceGroup', 'width'].filter(k => colIndex[k] === undefined);
    if (missing.length) return { ok: false, errors: [{ row: headerRow + 1, code: 'HEADER_MISSING', message: `Header is missing: ${missing.map(k => FABRIC_COLS.find(c => c.key === k).header).join(', ')}` }], warnings, rows: [] };
    const G = new Set((groups || []).map(up));
    const grid = sheet.grid || [];
    const rows = [];
    const seen = new Set();
    for (let r = headerRow + 1; r < grid.length; r++) {
        const raw = grid[r] || [];
        const cell = (k) => (colIndex[k] === undefined ? '' : raw[colIndex[k]]);
        if (raw.every(v => v === null || v === undefined || String(v).trim() === '')) continue;
        const rowNo = r + 1;
        const code = up(cell('code'));
        const err = (c, m) => errors.push({ row: rowNo, code: c, message: `row ${rowNo}${code ? ` (${code})` : ''}: ${m}` });
        if (!code) { err('CODE_MISSING', 'no Item Code'); continue; }
        if (code.startsWith(EXAMPLE_PREFIX)) { err('EXAMPLE_ROW', 'an EXAMPLE- row — delete it before uploading'); continue; }
        if (seen.has(code)) { err('CODE_DUPLICATE', 'Item Code listed twice'); continue; }
        seen.add(code);
        const type = up(cell('type'));
        if (!FABRIC_TYPES.includes(type)) { err('TYPE_UNREADABLE', `Type "${str(cell('type'))}" is not FABRIC or TRIM`); continue; }
        const name = str(cell('name'));
        const priceGroup = up(cell('priceGroup'));
        const width = num(cell('width'));
        if (type === 'FABRIC') {
            if (!priceGroup) err('GROUP_MISSING', 'a FABRIC needs a Price Group');
            else if (G.size && !G.has(priceGroup)) err('GROUP_UNKNOWN', `Price Group ${priceGroup} is not in the live price table (${[...G].join(', ')})`);
            if (width === null || width <= 0) err('WIDTH_MISSING', 'a FABRIC needs its bolt Width (in)');
        } else {
            if (priceGroup) warnings.push(`row ${rowNo} (${code}): a TRIM carries no price group — ignored`);
        }
        const cost = num(cell('cost'));
        if (str(cell('cost')) && cost === null) err('COST_NOT_A_NUMBER', `Cost "${str(cell('cost'))}" is not a number`);
        const rail = boolOf(cell('railroad'), false); if (!rail.ok) err('RAILROAD_UNREADABLE', `Railroad "${str(cell('railroad'))}" must be TRUE or FALSE`);
        const stocked = boolOf(cell('stocked'), true); if (!stocked.ok) err('STOCKED_UNREADABLE', `Stocked "${str(cell('stocked'))}" must be TRUE or FALSE`);
        rows.push({
            rowNo, code, name, type, priceGroup: type === 'FABRIC' ? priceGroup : '', width: type === 'FABRIC' ? width : null,
            railroad: rail.value, patternId: up(cell('patternId')), color: str(cell('color')), cost,
            convertedFrom: up(cell('convertedFrom')), vendor: str(cell('vendor')), homeBin: up(cell('homeBin')),
            stocked: stocked.value, nsId: str(cell('nsId')), notes: str(cell('notes')),
        });
    }
    if (!rows.length && !errors.length) errors.push({ row: 0, code: 'NO_ROWS', message: 'The sheet has no fabric rows' });
    return { ok: errors.length === 0, errors, warnings, rows };
}

// ── THE PLAN: each row against the library ───────────────────────────────────────────────────

/** The fields a row would set on an item, as the record carries them. */
export const fabricFieldsOf = (row) => {
    const f = {
        itemName: row.name,
        'manufacturingSpecs.productType': PRODUCT_TYPE_OF[row.type],
        'manufacturingSpecs.uom': 'RY',
        'manufacturingSpecs.isStocked': !!row.stocked,
        'manufacturingSpecs.customData.railroad': !!row.railroad,
    };
    if (row.type === 'FABRIC') { f['manufacturingSpecs.priceGroup'] = row.priceGroup; f['manufacturingSpecs.width'] = row.width; }
    if (row.cost !== null && row.cost !== undefined) f['manufacturingSpecs.cost'] = row.cost;
    if (row.vendor) f['manufacturingSpecs.vendorName'] = row.vendor;
    if (row.homeBin) f['manufacturingSpecs.homeBin'] = row.homeBin;
    if (row.patternId) f['manufacturingSpecs.customData.patternId'] = row.patternId;
    if (row.color) f['manufacturingSpecs.customData.color'] = row.color;
    if (row.convertedFrom) f['manufacturingSpecs.customData.convertedFrom'] = row.convertedFrom;
    if (row.notes) f['manufacturingSpecs.customData.importNotes'] = row.notes;
    if (row.nsId) f.netSuiteInternalId = row.nsId;
    return f;
};

const readPath = (item, path) => path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), item);
const same = (a, b) => (a === undefined || a === null || a === '' ? (b === undefined || b === null || b === '' || b === false) : (typeof b === 'number' || typeof a === 'number' ? Number(a) === Number(b) : String(a).trim().toUpperCase() === String(b).trim().toUpperCase()));

/**
 * rows + the brand's items → [{ row, action: 'CREATE'|'UPDATE'|'SKIP', item?, changes[{ path, from, to }], was? }]
 * Match: legacyErpId or itemId, case-insensitive, exact. A matched item whose product type is not a
 * fabric / trim is still updated (the sheet is the operator's word) but the plan says what it WAS.
 */
export function planFabricRows(rows = [], items = []) {
    const byCode = new Map();
    (items || []).forEach(it => {
        [it.legacyErpId, it.itemId].map(codeKeyOf).filter(Boolean).forEach(k => { if (!byCode.has(k)) byCode.set(k, it); });
    });
    return (rows || []).map(row => {
        const item = byCode.get(row.code) || null;
        const fields = fabricFieldsOf(row);
        if (!item) return { row, action: 'CREATE', item: null, changes: Object.entries(fields).map(([path, to]) => ({ path, from: undefined, to })) };
        const changes = Object.entries(fields).filter(([path, to]) => !same(readPath(item, path), to)).map(([path, to]) => ({ path, from: readPath(item, path), to }));
        const wasType = String((item.manufacturingSpecs && item.manufacturingSpecs.productType) || item.productType || '').toUpperCase();
        const was = wasType && !['FABRIC', 'TEXTILE', 'RAW MATERIAL', 'TRIMMING', 'TRIM', 'COMPONENT'].includes(wasType) ? wasType : '';
        return { row, action: changes.length ? 'UPDATE' : 'SKIP', item, changes, was, priceGroupWas: priceGroupOf(item) };
    });
}

/** The updateDoc patch for an UPDATE (dot paths; only the fields the row sets). */
export const fabricUpdatePatchOf = (plan, { by = '', at = 0 } = {}) => {
    const patch = {};
    plan.changes.forEach(c => { patch[c.path] = c.to; });
    patch.updatedAt = at || Date.now();
    patch.fabricSheetAt = at || Date.now();
    patch.fabricSheetBy = by;
    return patch;
};

/** The setDoc record for a CREATE — the 1.6 Item Starter's shape, brand uniquity. */
export const fabricCreateDocOf = (row, { id, brandId = 'uniquity', by = '', at = 0 } = {}) => {
    const now = at || Date.now();
    const customData = { railroad: !!row.railroad };
    if (row.patternId) customData.patternId = row.patternId;
    if (row.color) customData.color = row.color;
    if (row.convertedFrom) customData.convertedFrom = row.convertedFrom;
    if (row.notes) customData.importNotes = row.notes;
    return {
        id, itemId: id, legacyErpId: row.code, itemName: row.name || row.code,
        brandId, sharedBrands: [brandId],
        partClass: 'Inventory', routingType: 'UNASSIGNED',
        ...(row.nsId ? { netSuiteInternalId: row.nsId } : {}),
        manufacturingSpecs: {
            productType: PRODUCT_TYPE_OF[row.type], uom: 'RY',
            ...(row.type === 'FABRIC' ? { priceGroup: row.priceGroup, width: row.width } : {}),
            ...(row.cost !== null && row.cost !== undefined ? { cost: row.cost } : {}),
            ...(row.vendor ? { vendorName: row.vendor } : {}),
            ...(row.homeBin ? { homeBin: row.homeBin } : {}),
            isStocked: !!row.stocked, isInHouse: false,
            customData,
        },
        createdAt: now, updatedAt: now, author: by, fabricSheetAt: now, fabricSheetBy: by,
    };
};

export const newFabricItemId = (brandId = 'uniquity', i = 0, at = 0) => `${String(brandId).toUpperCase()}-INV-${at || Date.now()}-${i}`;

/** One-line counts for the preview / log. */
export const fabricPlanSummary = (plans = []) => {
    const n = { CREATE: 0, UPDATE: 0, SKIP: 0 };
    (plans || []).forEach(p => { n[p.action] = (n[p.action] || 0) + 1; });
    return n;
};
