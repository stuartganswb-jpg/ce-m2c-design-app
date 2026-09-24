// ── THE PILLOW PRICE CHART → system/pillow_pricing (Uniquity · S7, Stuart 2026-09-24) ─────────
//
// Stuart's chart (`0903/Pillows Size Price Chart.xlsx`): one header row — Group · Fabric · then one
// column per size (`20x12` = 20 wide × 12 tall, the way the board draws) — and one row per fabric
// group (A, B, C …) carrying a typical fabric's name and one price per size. That IS the matrix
// `Shared/pillowPricing` reads (`prices[size][group]`), so this module does three things and nothing
// else: reads the grid into that shape (refusing by cell on anything it cannot read), merges it into
// the live document without touching the numbers the chart does not carry (labour per seam, the
// detail charges, fill / zipper items, the rollup item), and says what changed so the operator sees
// the diff before Apply.
//
// The sizes on the chart also POPULATE `system/master_lists.pillowSizes` (Stuart: "this way future
// new sizes are easy and clear to add") — the board's size dropdown keeps reading the master list, and
// a size that is not on the chart cannot be quoted, so the list is REPLACED by the chart's sizes in
// chart order; the preview names every entry that goes.
//
// Pure: no imports, no Firestore. Proven by scripts/pillowPriceSheet.test.mjs.

import { sizeKeyOf, DEFAULT_PILLOW_PRICING } from './pillowPricing.js';

const up = (v) => String(v === null || v === undefined ? '' : v).trim().toUpperCase();
const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
};
const colLetter = (i) => { let s = '', n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const cellAddr = (r, c) => `${colLetter(c)}${r + 1}`;

/** Find the chart sheet: the first whose header row starts GROUP · FABRIC. Returns { sheet, headerRow } or null. */
export const findChartSheet = (sheets = []) => {
    for (const sh of sheets || []) {
        const grid = (sh && sh.grid) || [];
        for (let r = 0; r < Math.min(grid.length, 20); r++) {
            const row = grid[r] || [];
            if (up(row[0]) === 'GROUP' && up(row[1]) === 'FABRIC') return { sheet: sh, headerRow: r };
        }
    }
    return null;
};

/**
 * Sheets ([{ name, grid }], the shared workbook reader's shape) → the parsed chart.
 * { ok, errors[{code,message,cell?}], warnings[], sheetName, sizeKeys[], groups[{code,label,rank}], prices }
 */
export function parsePillowPriceChart(sheets = []) {
    const errors = [], warnings = [];
    const hit = findChartSheet(sheets);
    if (!hit) return { ok: false, errors: [{ code: 'NO_CHART', message: 'No sheet has a header row starting GROUP · FABRIC' }], warnings, sheetName: '', sizeKeys: [], groups: [], prices: {} };
    const { sheet, headerRow } = hit;
    const grid = sheet.grid || [];
    const header = grid[headerRow] || [];

    // ── the size columns ────────────────────────────────────────────────────────────────────────
    const cols = [];   // [{ c, key }]
    const seenSize = new Set();
    for (let c = 2; c < header.length; c++) {
        const raw = header[c];
        if (raw === null || raw === undefined || String(raw).trim() === '') continue;
        const key = sizeKeyOf(raw);
        if (!key) { errors.push({ code: 'SIZE_HEADER_UNREADABLE', cell: cellAddr(headerRow, c), message: `${cellAddr(headerRow, c)}: "${raw}" is not a W×H size` }); continue; }
        if (seenSize.has(key)) { errors.push({ code: 'SIZE_DUPLICATE', cell: cellAddr(headerRow, c), message: `${cellAddr(headerRow, c)}: size ${key} appears twice` }); continue; }
        seenSize.add(key); cols.push({ c, key });
    }
    if (!cols.length) errors.push({ code: 'NO_SIZES', message: 'The header row carries no size columns' });

    // ── the group rows ──────────────────────────────────────────────────────────────────────────
    const groups = [];
    const prices = {};
    cols.forEach(({ key }) => { prices[key] = {}; });
    const seenGroup = new Set();
    for (let r = headerRow + 1; r < grid.length; r++) {
        const row = grid[r] || [];
        const allBlank = row.every(v => v === null || v === undefined || String(v).trim() === '');
        if (allBlank) continue;
        const code = up(row[0]);
        if (!code) { errors.push({ code: 'GROUP_MISSING', cell: cellAddr(r, 0), message: `${cellAddr(r, 0)}: row has prices but no group code` }); continue; }
        if (!/^[A-Z0-9]{1,8}$/.test(code)) { errors.push({ code: 'GROUP_UNREADABLE', cell: cellAddr(r, 0), message: `${cellAddr(r, 0)}: "${row[0]}" is not a group code (letters / digits, up to 8)` }); continue; }
        if (seenGroup.has(code)) { errors.push({ code: 'GROUP_DUPLICATE', cell: cellAddr(r, 0), message: `${cellAddr(r, 0)}: group ${code} appears twice` }); continue; }
        seenGroup.add(code);
        const label = String(row[1] === null || row[1] === undefined ? '' : row[1]).trim();
        if (!label) warnings.push(`${cellAddr(r, 1)}: group ${code} has no typical fabric named`);
        groups.push({ code, label: label || code, rank: groups.length + 1 });
        cols.forEach(({ c, key }) => {
            const v = row[c];
            const n = num(v);
            if (n === null || n <= 0) { errors.push({ code: 'CELL_NOT_A_PRICE', cell: cellAddr(r, c), message: `${cellAddr(r, c)}: ${key} / group ${code} reads "${v === null || v === undefined ? '' : v}" — not a price` }); return; }
            prices[key][code] = Math.round(n * 100) / 100;
        });
    }
    if (!groups.length) errors.push({ code: 'NO_GROUPS', message: 'No group row under the header' });

    return { ok: errors.length === 0, errors, warnings, sheetName: sheet.name || '', sizeKeys: cols.map(x => x.key), groups, prices };
}

/**
 * The live document + a parsed chart → the next document. The chart REPLACES prices, fabricGroups
 * and the size list; everything the chart does not carry is kept: seamLabor, details, rollupItem,
 * the allowances, and each kept size's fillItem / zipperItem.
 */
export function mergePricingFromChart(existing, parsed) {
    const cur = { ...DEFAULT_PILLOW_PRICING, ...(existing || {}) };
    if (!parsed || !parsed.ok) return cur;
    const fabricGroups = {};
    parsed.groups.forEach(g => {
        const prev = (cur.fabricGroups || {})[g.code] || {};
        fabricGroups[g.code] = { label: g.label, rank: g.rank, upcharge: num(prev.upcharge) === null ? 0 : num(prev.upcharge) };
    });
    const sizes = {};
    parsed.sizeKeys.forEach(k => {
        const prev = (cur.sizes || {})[k] || {};
        sizes[k] = { label: k, ...(prev.fillItem ? { fillItem: prev.fillItem } : {}), ...(prev.zipperItem ? { zipperItem: prev.zipperItem } : {}) };
    });
    return { ...cur, prices: parsed.prices, fabricGroups, sizes, sizeOrder: parsed.sizeKeys.slice() };
}

/** The master list the board reads: the chart's sizes, chart order. */
export const masterListSizesOf = (parsed) => (parsed && parsed.ok ? parsed.sizeKeys.slice() : []);

/** What Apply would change — for the preview. */
export function chartDiffOf(existing, parsed) {
    const cur = { ...DEFAULT_PILLOW_PRICING, ...(existing || {}) };
    const curSizes = Object.keys(cur.prices || {});
    const curGroups = Object.keys(cur.fabricGroups || {});
    const nextSizes = parsed && parsed.ok ? parsed.sizeKeys : [];
    const nextGroups = parsed && parsed.ok ? parsed.groups.map(g => g.code) : [];
    const changed = [];
    let added = 0;
    nextSizes.forEach(size => nextGroups.forEach(group => {
        const to = parsed.prices[size][group];
        const from = cur.prices && cur.prices[size] ? cur.prices[size][group] : undefined;
        if (from === undefined) added++;
        else if (num(from) !== num(to)) changed.push({ size, group, from: num(from), to });
    }));
    return {
        addedSizes: nextSizes.filter(s => !curSizes.includes(s)),
        removedSizes: curSizes.filter(s => !nextSizes.includes(s)),
        addedGroups: nextGroups.filter(g => !curGroups.includes(g)),
        removedGroups: curGroups.filter(g => !nextGroups.includes(g)),
        newCells: added, changedCells: changed,
        firstImport: curSizes.length === 0,
    };
}

/** The master-list change — for the preview: what the chart adds and what leaves the list. */
export const masterListDiffOf = (existingList, parsed) => {
    const cur = Array.isArray(existingList) ? existingList : [];
    const next = masterListSizesOf(parsed);
    const keyOf = (v) => sizeKeyOf(v) || up(v);
    return {
        added: next.filter(k => !cur.some(v => keyOf(v) === k)),
        removed: cur.filter(v => !next.includes(keyOf(v))),
        relabelled: cur.filter(v => next.includes(keyOf(v)) && v !== keyOf(v)),
        next,
    };
};

// ── THE NUMBERS THE CHART DOES NOT CARRY — the setup control's editable blanks ─────────────────
// Stuart 2026-09-24: "we should add the blanks for labour, flange, etc. as new ones are created
// fairly often and adjusting these prices has to happen fairly often." So the details are a LIST the
// operator adds to, keyed by a code the board produces (FLANGE / WELT from the edge choice,
// OUTER_TRIM, FRINGE_SEAM) or a new one; `kind` says where the board offers it.

export const DETAIL_KINDS = ['EDGE', 'TRIM', 'ADDON'];   // EDGE = the edge dropdown · TRIM = trim yardage · ADDON = a tickable extra
export const DETAIL_PER = ['EACH', 'YARD'];
export const BUILT_IN_DETAILS = [
    { code: 'FLANGE', label: 'Flange edge', kind: 'EDGE', per: 'EACH' },
    { code: 'WELT', label: 'Welt / cord edge', kind: 'EDGE', per: 'EACH' },
    { code: 'OUTER_TRIM', label: 'Trim on the outer edges', kind: 'TRIM', per: 'YARD' },
    { code: 'FRINGE_SEAM', label: 'Fringe laid on a seam', kind: 'TRIM', per: 'YARD' },
];

/** details map → editor rows (built-ins first, blanks for the ones the document has no price for). */
export const detailRowsOf = (config) => {
    const d = (config && config.details) || {};
    const rows = [];
    const seen = new Set();
    BUILT_IN_DETAILS.forEach(b => {
        const cur = d[b.code] || {};
        rows.push({ code: b.code, label: cur.label || b.label, kind: cur.kind || b.kind, per: cur.per || b.per, price: num(cur.price) === null ? '' : num(cur.price), builtIn: true });
        seen.add(b.code);
    });
    Object.keys(d).filter(c => !seen.has(c)).sort().forEach(c => {
        const cur = d[c] || {};
        rows.push({ code: c, label: cur.label || c, kind: cur.kind || 'ADDON', per: cur.per || 'EACH', price: num(cur.price) === null ? '' : num(cur.price), builtIn: false });
    });
    return rows;
};

/** editor rows → { ok, errors, details }. A blank price on a row = no row written (it refuses at pricing, by design). */
export function detailsFromRows(rows = []) {
    const errors = [];
    const details = {};
    const seen = new Set();
    (rows || []).forEach((r, i) => {
        const code = up(r.code).replace(/[^A-Z0-9_]/g, '_').replace(/^_+|_+$/g, '');
        const priceRaw = r.price;
        const blank = priceRaw === '' || priceRaw === null || priceRaw === undefined;
        if (!code) { if (!blank || String(r.label || '').trim()) errors.push({ row: i + 1, message: `row ${i + 1}: a detail needs a code` }); return; }
        if (seen.has(code)) { errors.push({ row: i + 1, message: `row ${i + 1}: code ${code} is listed twice` }); return; }
        seen.add(code);
        if (blank) return;
        const price = num(priceRaw);
        if (price === null || price < 0) { errors.push({ row: i + 1, message: `row ${i + 1} (${code}): "${priceRaw}" is not a price` }); return; }
        const per = DETAIL_PER.includes(up(r.per)) ? up(r.per) : 'EACH';
        const kind = DETAIL_KINDS.includes(up(r.kind)) ? up(r.kind) : 'ADDON';
        details[code] = { label: String(r.label || code).trim() || code, kind, per, price: Math.round(price * 100) / 100 };
    });
    return { ok: errors.length === 0, errors, details };
}

/** The scalar blanks: labour per seam, the allowances, the rollup item. Blank labour = null (refuses at pricing). */
export function numbersPatchOf({ perSeam, seamAllowanceIn, yardRounding, rollupCode } = {}) {
    const errors = [];
    const seam = perSeam === '' || perSeam === null || perSeam === undefined ? null : num(perSeam);
    if (seam !== null && (Number.isNaN(seam) || seam < 0)) errors.push({ field: 'perSeam', message: `labour per seam "${perSeam}" is not a price` });
    const allow = seamAllowanceIn === '' || seamAllowanceIn === null || seamAllowanceIn === undefined ? DEFAULT_PILLOW_PRICING.seamAllowanceIn : num(seamAllowanceIn);
    if (allow === null || allow < 0 || allow > 6) errors.push({ field: 'seamAllowanceIn', message: `seam allowance "${seamAllowanceIn}" must be 0–6 inches` });
    const round = yardRounding === '' || yardRounding === null || yardRounding === undefined ? DEFAULT_PILLOW_PRICING.yardRounding : num(yardRounding);
    if (round === null || round <= 0 || round > 1) errors.push({ field: 'yardRounding', message: `yard rounding "${yardRounding}" must be a fraction of a yard (0.125 = ⅛)` });
    const code = up(rollupCode) || DEFAULT_PILLOW_PRICING.rollupItem.legacyErpId;
    return {
        ok: errors.length === 0, errors,
        patch: { seamLabor: { perSeam: seam === null ? null : Math.round(seam * 100) / 100 }, seamAllowanceIn: allow, yardRounding: round, rollupItem: { legacyErpId: code, itemId: '' } },
    };
}
