// ── THE CURTAIN CHART — the workroom's sheet, read, stored and looked up (M2C Studio · 2026-10-12) ──────
//
// Stuart: "the curtains are sold by the fabric selection, then the pleat style (pinch pleat, grommet
// pleat, or ripplefold) then the width group, and finally the length group, the width we order in the
// group, the length we order to the inch but pay in the length range … our work room when we send an
// order would want us to reference the appropriate line for dimensions, fabric, style, lined or unlined."
//
// The workroom's workbook is one sheet per top style and one ROW per fabric × lining × width group ×
// length band, carrying the workroom's cost and our retail. That row IS the thing sold and the thing
// ordered, so this module does four things and nothing else:
//   1. READS the workbook (the shared reader's [{ name, grid }]) into lines that keep their SHEET NAME
//      and ROW NUMBER — the reference the workroom is quoted — refusing by sheet and row whatever it
//      cannot read (a width range that runs backwards, a cell that is not a number, a line listed twice);
//   2. PACKS the lines into the one document `system/curtain_pricing` (6.5 Tools → Curtain Pricing);
//   3. LOOKS UP the line for a fabric · style · lining · width group · length to the inch, refusing by
//      name when the chart has no such line — never a made-up price;
//   4. NAMES the swatches: a picture's file name (or its gallery tags) → the fabric and colour it shows.
//
// The numbers never live in code: styles, fabrics, linings, width groups and length bands are whatever
// the sheet carries. ONE cost per line today — the workroom (Airtex) supplies the fabric, so labour and
// fabric arrive together (Stuart 2026-10-12: "for now set it like they supply it, but if we ever move
// workrooms we need the flexibility to change that … the costs column [would] have labor and fabric
// separately"). `workroom.fabricSuppliedBy` records that; a sheet with the two costs apart is a new pair
// of columns for readSheet below, not a new shape for the lookup.
//
// Pure: no imports, no Firestore. Proven by scripts/curtainPricing.test.mjs (the real workbook, line for line).

export const CURTAIN_PRICING_DOC = 'curtain_pricing';   // system/curtain_pricing
export const CURTAIN_BRAND = 'm2c';
export const FABRIC_BY_WORKROOM = 'WORKROOM';
export const CHART_VERSION = 1;
export const CHART_MAX_BYTES = 950000;                  // Firestore refuses a document over 1 MiB

const str = (v) => String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
const up = (v) => str(v).toUpperCase();
const keyOf = (v) => up(v).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const alnum = (v) => up(v).replace(/[^A-Z0-9]/g, '');
const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'object') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s"]/g, ''));
    return Number.isFinite(n) ? n : null;
};
// how a cell that could not be read is shown: a formula the workbook stores no value for arrives as an object
const shown = (v) => (v && typeof v === 'object' ? (v.error ? String(v.error) : (v.formula || v.sharedFormula ? 'a formula with no stored value' : 'not a plain value')) : `"${str(v)}"`);
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const same = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

// ── 1. READING THE WORKBOOK ───────────────────────────────────────────────────────────────────────

// The columns, by what the header SAYS (the three sheets word them slightly differently: "Cost" /
// "cost" / "PRICE", "LOW LENGTH" with and without a line break). `need` false = read when present.
const COLUMNS = [
    { key: 'fabric', label: 'FABRIC', need: true, test: (h) => h === 'FABRIC' },
    { key: 'n', label: '# of FABRIC WIDTHS', need: true, test: (h) => /FABRIC WIDTHS/.test(h) },
    { key: 'cuttable', label: 'CUTTABLE FABRIC / WIDTH', need: false, test: (h) => /CUTTABLE/.test(h) },
    { key: 'widthLow', label: 'FINISHED PANEL LOW WIDTH', need: true, test: (h) => /LOW WIDTH/.test(h) },
    { key: 'widthHigh', label: 'FINISHED PANEL HIGH WIDTH', need: true, test: (h) => /HIGH WIDTH/.test(h) },
    { key: 'lengthLow', label: 'LOW LENGTH', need: true, test: (h) => /LOW LENGTH/.test(h) },
    { key: 'lengthHigh', label: 'HIGH LENGTH', need: true, test: (h) => /HIGH LENGTH/.test(h) },
    { key: 'size', label: 'SIZE GROUPING', need: false, test: (h) => /SIZE GROUPING/.test(h) },
    { key: 'style', label: 'TOP STYLE', need: true, test: (h) => /TOP STYLE/.test(h) },
    { key: 'lining', label: 'LINING', need: true, test: (h) => h === 'LINING' },
    { key: 'cost', label: 'COST', need: true, test: (h) => h === 'COST' || h === 'PRICE' },
    { key: 'retail', label: 'RETAIL', need: true, test: (h) => h === 'RETAIL' },
];
const NUMBER_KEYS = ['n', 'widthLow', 'widthHigh', 'lengthLow', 'lengthHigh', 'cost', 'retail'];

/** The header row of a chart sheet: { headerRow, cols: { key → column index } }, or null when the sheet is not a chart. */
export const findCurtainHeader = (grid = []) => {
    for (let r = 0; r < Math.min(grid.length, 20); r++) {
        const row = grid[r] || [];
        const cols = {};
        row.forEach((cell, c) => {
            const h = up(cell);
            if (!h) return;
            const col = COLUMNS.find(x => cols[x.key] === undefined && x.test(h));
            if (col) cols[col.key] = c;
        });
        if (cols.fabric !== undefined && cols.style !== undefined && cols.lining !== undefined) return { headerRow: r, cols };
    }
    return null;
};

/** "1 width", "2½ widths" — how a width group is said. */
export const widthsWordOf = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '';
    const whole = Math.floor(v);
    const half = Math.abs(v - whole - 0.5) < 1e-9;
    const figure = half ? `${whole > 0 ? whole : ''}½` : String(v);
    return `${figure} ${v <= 1 ? 'width' : 'widths'}`;
};
/** `up to 15"` · `20–30"` — the finished panel width a group covers. */
export const widthRangeWordOf = (low, high) => (Number(low) > 0 ? `${low}–${high}"` : `up to ${high}"`);

/**
 * Sheets ([{ name, grid }], the shared workbook reader's shape) → the parsed chart.
 * { ok, errors[{code,message}], issues[{level,code,sheet,row,…,message}], sheetsRead[], sheetsSkipped[], lines[], chart }
 *   errors  = nothing can be applied (no chart sheet, a column missing);
 *   issues  = line by line: REFUSED (the line is not sold), GAP (a line the chart does not carry), WARN.
 * A grid's index is the sheet's row number less one (the shared reader keeps empty rows), so
 * `row` is the number the workroom sees in the workbook.
 */
export function parseCurtainWorkbook(sheets = []) {
    const errors = [], issues = [], sheetsRead = [], sheetsSkipped = [], lines = [];
    const seen = new Map();        // identity → the line that holds it
    const groupRange = new Map();  // style|fabric|lining|n → { low, high, row, sheet }
    const fabricCut = new Map();   // fabric key → { cuttable, row, sheet }

    (sheets || []).forEach(sh => {
        const name = str(sh && sh.name);
        const grid = (sh && sh.grid) || [];
        const head = findCurtainHeader(grid);
        if (!head) { sheetsSkipped.push(name); return; }
        const missing = COLUMNS.filter(c => c.need && head.cols[c.key] === undefined);
        if (missing.length) {
            errors.push({ code: 'NO_COLUMN', message: `Sheet "${name}" has no ${missing.map(c => c.label).join(' / ')} column — nothing on it can be read.` });
            return;
        }
        let count = 0;
        const styleLabels = new Set();
        for (let r = head.headerRow + 1; r < grid.length; r++) {
            const cells = grid[r] || [];
            const raw = {};
            COLUMNS.forEach(c => { raw[c.key] = head.cols[c.key] === undefined ? null : cells[head.cols[c.key]]; });
            if (COLUMNS.every(c => str(raw[c.key]) === '')) continue;   // a blank row
            const row = r + 1;
            const at = `${name} row ${row}`;
            const refuse = (code, message, extra = {}) => issues.push({ level: 'REFUSED', code, sheet: name, row, message, ...extra });

            const fabric = str(raw.fabric), styleLabel = str(raw.style), lining = str(raw.lining);
            const blankWord = [['FABRIC', fabric], ['TOP STYLE', styleLabel], ['LINING', lining]].find(([, v]) => !v);
            if (blankWord) { refuse('BAD_CELL', `${at}: ${blankWord[0]} is blank — the line is not loaded.`); continue; }
            const v = {};
            const badNum = NUMBER_KEYS.find(k => { v[k] = num(raw[k]); return v[k] === null; });
            if (badNum) {
                const col = COLUMNS.find(c => c.key === badNum);
                refuse('BAD_CELL', `${at}: ${col.label} is ${shown(raw[badNum])} — not a number; the line is not loaded.`, { fabric, lining });
                continue;
            }
            if (!(v.n > 0)) { refuse('BAD_CELL', `${at}: # of FABRIC WIDTHS is ${v.n} — the line is not loaded.`, { fabric, lining }); continue; }
            if (v.lengthLow > v.lengthHigh) { refuse('LENGTH_BACKWARDS', `${at}: the length runs backwards (${v.lengthLow}–${v.lengthHigh}) — the line is not loaded.`, { fabric, lining, n: v.n }); continue; }

            const style = keyOf(styleLabel), fKey = keyOf(fabric), lKey = keyOf(lining);
            const gKey = `${style}|${fKey}|${lKey}|${v.n}`;
            const id = `${gKey}|${v.lengthLow}-${v.lengthHigh}`;
            const first = seen.get(id);
            if (first) { refuse('DUPLICATE', `${at}: the same line as ${first.sheet} row ${first.row} (${fabric} · ${lining} · ${widthsWordOf(v.n)} · ${v.lengthLow}–${v.lengthHigh}") — the second is not loaded.`, { fabric, lining, n: v.n }); continue; }
            const range = groupRange.get(gKey);
            if (range && !(same(range.low, v.widthLow) && same(range.high, v.widthHigh))) {
                refuse('GROUP_RANGE_MIXED', `${at}: ${fabric} · ${lining} · ${widthsWordOf(v.n)} is ${v.widthLow}–${v.widthHigh} here and ${range.low}–${range.high} on ${range.sheet} row ${range.row} — the line is not loaded.`, { fabric, lining, n: v.n });
                continue;
            }
            if (!range) groupRange.set(gKey, { low: v.widthLow, high: v.widthHigh, row, sheet: name });

            const cuttable = num(raw.cuttable);
            const cut = fabricCut.get(fKey);
            if (cuttable !== null && !cut) fabricCut.set(fKey, { cuttable, row, sheet: name });
            else if (cuttable !== null && cut && !same(cut.cuttable, cuttable)) issues.push({ level: 'WARN', code: 'CUTTABLE_MIXED', sheet: name, row, fabric, message: `${at}: ${fabric} is ${cuttable}" cuttable here and ${cut.cuttable}" on ${cut.sheet} row ${cut.row}.` });
            if (v.retail < v.cost) issues.push({ level: 'WARN', code: 'RETAIL_BELOW_COST', sheet: name, row, fabric, lining, n: v.n, message: `${at}: retail ${round2(v.retail)} is below cost ${round2(v.cost)}.` });

            const line = {
                style, styleLabel, sheet: name, row, fabric, fabricKey: fKey, lining, liningKey: lKey,
                n: v.n, cuttable, widthLow: v.widthLow, widthHigh: v.widthHigh, lengthLow: v.lengthLow, lengthHigh: v.lengthHigh,
                size: str(raw.size), cost: v.cost, retail: v.retail,
            };
            if (v.widthLow > v.widthHigh) {
                line.bad = 'WIDTH_BACKWARDS';
                refuse('WIDTH_BACKWARDS', `${at}: the finished width runs backwards (${v.widthLow}–${v.widthHigh}) — ${fabric} · ${lining} · ${widthsWordOf(v.n)} is not sold until the sheet is corrected.`, { fabric, lining, n: v.n });
            }
            seen.set(id, line);
            lines.push(line);
            styleLabels.add(styleLabel);
            count++;
        }
        sheetsRead.push({ name, lines: count, styles: [...styleLabels] });
    });

    if (!sheetsRead.length && !errors.length) errors.push({ code: 'NO_CHART', message: 'No sheet has a header row with FABRIC · TOP STYLE · LINING — this is not the curtain chart.' });
    if (sheetsRead.length && !lines.length && !errors.length) errors.push({ code: 'NO_LINES', message: 'The chart sheets carry no line that could be read.' });

    // Two length bands of one width group that overlap: a length inside both would have two prices.
    const byGroup = new Map();
    lines.forEach(l => { const k = `${l.style}|${l.fabricKey}|${l.liningKey}|${l.n}`; if (!byGroup.has(k)) byGroup.set(k, []); byGroup.get(k).push(l); });
    const dropped = new Set();
    byGroup.forEach(list => {
        const sorted = [...list].sort((a, b) => a.lengthLow - b.lengthLow || a.row - b.row);
        let keep = null;
        sorted.forEach(l => {
            if (keep && l.lengthLow <= keep.lengthHigh) {
                dropped.add(l);
                issues.push({ level: 'REFUSED', code: 'BAND_OVERLAP', sheet: l.sheet, row: l.row, fabric: l.fabric, lining: l.lining, n: l.n, message: `${l.sheet} row ${l.row}: lengths ${l.lengthLow}–${l.lengthHigh}" overlap ${keep.lengthLow}–${keep.lengthHigh}" on row ${keep.row} — the line is not loaded.` });
            } else keep = l;
        });
    });
    const kept = dropped.size ? lines.filter(l => !dropped.has(l)) : lines;

    const chart = chartOf(kept);
    // A LINE THE CHART DOES NOT CARRY: a length band every other width group of the same fabric · style ·
    // lining has. Not an error of reading — the sheet simply has no row — so the quick sell refuses it by name.
    chart.blocks.forEach(b => {
        const styleRow = chart.styles.find(s => s.key === b.style) || {};
        const fabricRow = chart.fabrics.find(f => f.key === b.fabric) || {};
        const liningRow = chart.linings.find(x => x.key === b.lining) || {};
        const used = new Set();
        b.groups.forEach(g => g.rows.forEach((row, i) => { if (row !== null) used.add(i); }));
        b.groups.forEach(g => g.rows.forEach((row, i) => {
            if (row !== null || !used.has(i)) return;
            const band = chart.bands[i];
            issues.push({ level: 'GAP', code: 'MISSING_LINE', sheet: styleRow.sheet || '', row: null, fabric: fabricRow.name, lining: liningRow.name, n: g.n, message: `${styleRow.label} · ${fabricRow.name} · ${liningRow.name} · ${widthsWordOf(g.n)} has no line for ${band.low}–${band.high}".` });
        }));
    });

    return { ok: errors.length === 0, errors, issues, sheetsRead, sheetsSkipped, lines: kept, chart };
}

// ── 2. THE DOCUMENT ───────────────────────────────────────────────────────────────────────────────

/**
 * Lines → the packed chart: the lists in sheet order, the length bands once, and one block per
 * fabric · style · lining whose width groups hold three arrays ALIGNED TO THE BANDS (the sheet's row
 * number, the cost, the retail — null where the chart has no line). ~16k numbers for the 5,334-line
 * workbook, well inside one Firestore document; no array sits directly inside another.
 */
export function chartOf(lines = []) {
    const styles = [], fabrics = [], linings = [], bandMap = new Map();
    const blockMap = new Map();
    (lines || []).forEach(l => {
        if (!styles.some(s => s.key === l.style)) styles.push({ key: l.style, label: l.styleLabel, sheet: l.sheet });
        if (!fabrics.some(f => f.key === l.fabricKey)) fabrics.push({ key: l.fabricKey, name: l.fabric, cuttable: l.cuttable === undefined ? null : l.cuttable });
        if (!linings.some(x => x.key === l.liningKey)) linings.push({ key: l.liningKey, name: l.lining });
        const bk = `${l.lengthLow}-${l.lengthHigh}`;
        if (!bandMap.has(bk)) bandMap.set(bk, { low: l.lengthLow, high: l.lengthHigh, size: l.size || '' });
    });
    const bands = [...bandMap.values()].sort((a, b) => a.low - b.low || a.high - b.high);
    const bandIndex = new Map(bands.map((b, i) => [`${b.low}-${b.high}`, i]));
    const blank = () => bands.map(() => null);
    (lines || []).forEach(l => {
        const k = `${l.style}|${l.fabricKey}|${l.liningKey}`;
        if (!blockMap.has(k)) blockMap.set(k, { style: l.style, fabric: l.fabricKey, lining: l.liningKey, groups: [] });
        const block = blockMap.get(k);
        let g = block.groups.find(x => x.n === l.n);
        if (!g) { g = { n: l.n, low: l.widthLow, high: l.widthHigh, rows: blank(), cost: blank(), retail: blank() }; block.groups.push(g); }
        if (l.bad) g.bad = l.bad;
        const i = bandIndex.get(`${l.lengthLow}-${l.lengthHigh}`);
        g.rows[i] = l.row; g.cost[i] = l.cost; g.retail[i] = l.retail;
    });
    const blocks = [...blockMap.values()];
    blocks.forEach(b => b.groups.sort((a, c) => a.n - c.n));
    return { version: CHART_VERSION, styles, fabrics, linings, bands, blocks, lineCount: (lines || []).length };
}

/** The packed chart back as lines (the diff, the preview's counts and the harness read these). */
export function linesOfChart(chart) {
    const out = [];
    if (!chart || !Array.isArray(chart.blocks)) return out;
    const bands = chart.bands || [];
    chart.blocks.forEach(b => {
        const s = (chart.styles || []).find(x => x.key === b.style) || {};
        const f = (chart.fabrics || []).find(x => x.key === b.fabric) || {};
        const li = (chart.linings || []).find(x => x.key === b.lining) || {};
        (b.groups || []).forEach(g => (g.rows || []).forEach((row, i) => {
            if (row === null || row === undefined || !bands[i]) return;
            out.push({
                style: b.style, styleLabel: s.label || b.style, sheet: s.sheet || '', row,
                fabric: f.name || b.fabric, fabricKey: b.fabric, lining: li.name || b.lining, liningKey: b.lining,
                n: g.n, cuttable: f.cuttable === undefined ? null : f.cuttable, widthLow: g.low, widthHigh: g.high,
                lengthLow: bands[i].low, lengthHigh: bands[i].high, size: bands[i].size || '',
                cost: g.cost[i], retail: g.retail[i], ...(g.bad ? { bad: g.bad } : {}),
            });
        }));
    });
    return out;
}

/** What Apply writes: the chart whole, the workroom carried over from the live document, and who applied it. */
export function curtainDocOf({ chart, live = null, fileName = '', by = '', at = 0 } = {}) {
    const w = (live && live.workroom) || {};
    const was = (live && live.styleNames) || {};
    const styleNames = {};
    ((chart && chart.styles) || []).forEach(s => { if (str(was[s.key])) styleNames[s.key] = str(was[s.key]); });
    return {
        ...chart,
        brandId: CURTAIN_BRAND,
        styleNames,
        workroom: { name: str(w.name), fabricSuppliedBy: str(w.fabricSuppliedBy) || FABRIC_BY_WORKROOM },
        sourceFile: str(fileName), appliedAt: at || 0, appliedBy: str(by),
    };
}

/** A rough size of the document (JSON characters — above Firestore's own count for a chart of numbers). */
export const chartBytesOf = (chart) => { try { return JSON.stringify(chart || {}).length; } catch (e) { return Infinity; } };

/** What an Apply would change against the live chart: lines new, gone, repriced. */
export function chartDiffOf(live, next) {
    const idOf = (l) => `${l.style}|${l.fabricKey}|${l.liningKey}|${l.n}|${l.lengthLow}-${l.lengthHigh}`;
    const was = new Map(linesOfChart(live).map(l => [idOf(l), l]));
    const now = new Map(linesOfChart(next).map(l => [idOf(l), l]));
    const added = [], removed = [], repriced = [];
    now.forEach((l, k) => {
        const o = was.get(k);
        if (!o) added.push(l);
        else if (!same(o.cost, l.cost) || !same(o.retail, l.retail)) repriced.push({ ...l, wasCost: o.cost, wasRetail: o.retail });
    });
    was.forEach((l, k) => { if (!now.has(k)) removed.push(l); });
    return { firstApply: was.size === 0, added, removed, repriced, unchanged: now.size - added.length - repriced.length };
}

/** Consecutive rows as "1542–1556, 1558". */
export const rowRangesOf = (rows = []) => {
    const s = [...new Set((rows || []).filter(r => Number.isFinite(r)))].sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < s.length; i++) {
        let j = i;
        while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
        out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
        i = j;
    }
    return out.join(', ');
};

/** The issues gathered for the preview: one entry per kind · sheet · fabric, its rows as ranges. */
export function issueSummaryOf(issues = []) {
    const map = new Map();
    (issues || []).forEach(x => {
        const k = `${x.level}|${x.code}|${x.sheet || ''}|${x.fabric || ''}`;
        if (!map.has(k)) map.set(k, { level: x.level, code: x.code, sheet: x.sheet || '', fabric: x.fabric || '', count: 0, rows: [], first: x.message });
        const e = map.get(k);
        e.count++;
        if (Number.isFinite(x.row)) e.rows.push(x.row);
    });
    const order = { REFUSED: 0, GAP: 1, WARN: 2 };
    return [...map.values()].map(e => ({ ...e, rowsWord: rowRangesOf(e.rows) })).sort((a, b) => (order[a.level] - order[b.level]) || a.sheet.localeCompare(b.sheet) || a.fabric.localeCompare(b.fabric));
}

// ── 3. THE LOOKUP ─────────────────────────────────────────────────────────────────────────────────

const pick = (list, v) => { const k = keyOf(v); return (list || []).find(x => x.key === k) || null; };
const blockOf = (chart, style, fabric, lining) => ((chart && chart.blocks) || []).find(b => b.style === style && b.fabric === fabric && b.lining === lining) || null;
export const hasCurtainChart = (chart) => !!(chart && Array.isArray(chart.blocks) && chart.blocks.length);

/**
 * THE NAME A TOP STYLE IS SHOWN BY (Stuart 2026-10-12: the grommet style is sold as "Leather Rings"). The sheet's own
 * word stays the style's identity and is what the workroom is quoted — its sheet is still called GROMMET PLEAT; the
 * office's word, when one is set (`styleNames`, 6.5 Tools → Curtain Pricing), is what the seller's tile and the order say.
 */
export const styleNameOf = (chart, key) => {
    const k = keyOf(key);
    const s = ((chart && chart.styles) || []).find(x => x.key === k);
    return str(chart && chart.styleNames && chart.styleNames[k]) || (s ? s.label : '');
};
/** The top styles, each with the `name` it is shown by. */
export const curtainStylesOf = (chart) => (hasCurtainChart(chart) ? (chart.styles || []).map(s => ({ ...s, name: styleNameOf(chart, s.key) })) : []);
/**
 * The names typed on the tool → what is stored. { ok, errors[{code,message}], names: { styleKey → name | '' } }
 * A name that is the sheet's own stores as none; two styles may not be shown under one name, nor one under another's sheet name.
 */
export function styleNamesOf(chart, edits = {}) {
    const errors = [], names = {};
    const styles = (chart && chart.styles) || [];
    styles.forEach(s => {
        const v = str(edits[s.key]);
        names[s.key] = v && alnum(v) !== alnum(s.label) ? v : '';
        if (v.length > 40) errors.push({ code: 'NAME_LONG', message: `"${v}" is too long for a tile — 40 characters at most.` });
    });
    styles.forEach(s => {
        const shown = names[s.key] || s.label;
        const clash = styles.find(o => o.key !== s.key && (alnum(names[o.key] || o.label) === alnum(shown) || (names[s.key] && alnum(o.label) === alnum(shown))));
        if (clash && !errors.some(e => e.code === 'NAME_TAKEN')) errors.push({ code: 'NAME_TAKEN', message: `${s.label} and ${clash.label} would both be shown as "${shown}".` });
    });
    return { ok: errors.length === 0, errors, names };
}
/** The fabrics the chart carries (for one style when given), in sheet order. */
export const curtainFabricsOf = (chart, { style = '' } = {}) => {
    if (!hasCurtainChart(chart)) return [];
    const s = style ? keyOf(style) : '';
    return (chart.fabrics || []).filter(f => chart.blocks.some(b => b.fabric === f.key && (!s || b.style === s)));
};
/** The linings a fabric is offered in for a style — only what the chart has a block for. */
export const curtainLiningsOf = (chart, { style = '', fabric = '' } = {}) => {
    if (!hasCurtainChart(chart)) return [];
    const s = keyOf(style), f = keyOf(fabric);
    return (chart.linings || []).filter(l => !!blockOf(chart, s, f, l.key));
};
const groupSpan = (chart, g) => {
    const idx = (g.rows || []).map((row, i) => (row === null || row === undefined ? -1 : i)).filter(i => i >= 0);
    if (!idx.length) return { min: null, max: null, rowsWord: '' };
    return { min: chart.bands[idx[0]].low, max: chart.bands[idx[idx.length - 1]].high, rowsWord: rowRangesOf(idx.map(i => g.rows[i])) };
};
/** The width groups of a fabric · style · lining: { n, low, high, word, range, bad, minLength, maxLength }. */
export const curtainGroupsOf = (chart, { style = '', fabric = '', lining = '' } = {}) => {
    if (!hasCurtainChart(chart)) return [];
    const b = blockOf(chart, keyOf(style), keyOf(fabric), keyOf(lining));
    if (!b) return [];
    return b.groups.map(g => {
        const span = groupSpan(chart, g);
        return { n: g.n, low: g.low, high: g.high, word: widthsWordOf(g.n), range: widthRangeWordOf(g.low, g.high), bad: g.bad || '', minLength: span.min, maxLength: span.max };
    });
};

/**
 * THE LINE for a curtain: fabric · style · lining · width group (its # of fabric widths) · the length
 * to the inch · how many panels. { ok, errors[{code,message}], line } — `line` carries the chart's row
 * (sheet + row number), the cost, the retail, the price (retail to the cent) and the total.
 * A choice the chart has no line for is REFUSED BY NAME; nothing is ever priced from a neighbour.
 */
export function curtainQuoteOf(chart, { style = '', fabric = '', lining = '', n = null, lengthIn = null, panels = 1, colour = '' } = {}) {
    const fail = (code, message) => ({ ok: false, errors: [{ code, message }], line: null });
    if (!hasCurtainChart(chart)) return fail('NO_CHART', 'No curtain chart is applied — 6.5 Tools → Curtain Pricing.');
    const s = pick(chart.styles, style), f = pick(chart.fabrics, fabric), li = pick(chart.linings, lining);
    if (!f) return fail('NO_FABRIC', fabric ? `The chart has no fabric "${str(fabric)}".` : 'Pick a fabric.');
    if (!s) return fail('NO_STYLE', style ? `The chart has no top style "${str(style)}".` : 'Pick a top style.');
    if (!li) return fail('NO_LINING', lining ? `The chart has no lining "${str(lining)}".` : 'Pick a lining.');
    const b = blockOf(chart, s.key, f.key, li.key);
    if (!b) return fail('NOT_OFFERED', `${f.name} is not offered ${li.name.toLowerCase()} in ${s.label} — the chart has no such lines.`);
    const gN = num(n);
    if (gN === null) return fail('NO_WIDTH_GROUP', 'Pick a width group.');
    const g = b.groups.find(x => same(x.n, gN));
    if (!g) return fail('NO_WIDTH_GROUP', `${s.label} · ${f.name} · ${li.name} has no ${widthsWordOf(gN)} group on the chart.`);
    const span = groupSpan(chart, g);
    if (g.bad === 'WIDTH_BACKWARDS') return fail('GROUP_BAD', `${s.sheet} rows ${span.rowsWord}: the finished width runs backwards on the sheet (${g.low}–${g.high}) — correct the sheet and apply it again.`);
    const L = num(lengthIn);
    if (L === null) return fail('NO_LENGTH', 'Type the finished length in inches.');
    if (!Number.isInteger(L)) return fail('LENGTH_NOT_WHOLE', `Lengths are ordered to the whole inch — ${L} is not one.`);
    if (span.min === null) return fail('NO_LINE', `${s.label} · ${f.name} · ${li.name} · ${widthsWordOf(g.n)} has no lines on the chart.`);
    if (L < span.min || L > span.max) return fail('LENGTH_OUT_OF_RANGE', `${L}" is outside the chart: ${f.name} · ${li.name} · ${widthsWordOf(g.n)} in ${s.label} runs ${span.min}"–${span.max}".`);
    const i = chart.bands.findIndex((band, k) => g.rows[k] !== null && g.rows[k] !== undefined && L >= band.low && L <= band.high);
    if (i < 0) return fail('NO_LINE', `The chart has no line for ${L}" in ${s.label} · ${f.name} · ${li.name} · ${widthsWordOf(g.n)}.`);
    const q = num(panels);
    if (q === null || !Number.isInteger(q) || q < 1) return fail('NO_PANELS', 'How many panels? A whole number, one or more.');
    const band = chart.bands[i];
    const price = round2(g.retail[i]);
    const line = {
        style: s.key, styleLabel: s.label, styleName: styleNameOf(chart, s.key), sheet: s.sheet, row: g.rows[i],
        fabric: f.name, fabricKey: f.key, colour: str(colour), lining: li.name, liningKey: li.key,
        n: g.n, widthsWord: widthsWordOf(g.n), widthLow: g.low, widthHigh: g.high, widthRange: widthRangeWordOf(g.low, g.high),
        cuttable: f.cuttable === undefined ? null : f.cuttable,
        lengthIn: L, band: { low: band.low, high: band.high, size: band.size || '' },
        cost: g.cost[i], retail: g.retail[i], price, panels: q, total: round2(price * q),
    };
    return { ok: true, errors: [], line };
}

/** The line as the workroom is quoted it: its sheet and row, then what that row says. */
export const workroomRefOf = (line) => (!line ? '' : [
    `${line.sheet} row ${line.row}`, line.fabric, line.styleLabel, line.lining,
    `${line.widthsWord} (${line.widthRange} finished)`, `${line.band.low}–${line.band.high}" long`,
].join(' · '));
/** The line as the order says it: the panel that is made, its top style by the name it is sold under. */
export const curtainOrderTextOf = (line) => (!line ? '' : [
    `${line.fabric}${line.colour ? ` ${line.colour}` : ''}`, line.styleName || line.styleLabel, line.lining,
    `${line.widthRange} wide × ${line.lengthIn}" long`,
].join(' · '));

// ── 4. THE SWATCHES ───────────────────────────────────────────────────────────────────────────────
// A swatch is an Asset Gallery picture (`global_assets`) of the brand, filed under a curtain product
// type, whose pattern is a fabric on the chart and whose finish is the colour — or whose pattern is a
// top style (the pleat's own picture). The loader on 6.5 files them that way from the file name
// ("M2C DF UNIQ Winters 01 White.png" → Winters · 01 White); one uploaded by hand on tab 14 with the
// same three fields reads the same.

export const SWATCH_PRODUCT_TYPE = 'CURTAIN SWATCH';
/** The gallery product types a curtain picture may be filed under (one `in` query reads them). */
export const SWATCH_PRODUCT_TYPES = ['CURTAIN SWATCH', 'Curtain', 'CURTAIN', 'curtain', 'Curtains', 'CURTAINS', 'curtains'];
/** The library's own curtain product type when the master list has one, else the swatch type. */
export const swatchProductTypeOf = (prodTypes = []) => (prodTypes || []).map(str).find(t => /^curtains?$/i.test(t)) || SWATCH_PRODUCT_TYPE;
/** The product types the gallery is asked for: the known spellings + the library's own, however it is cased. */
export const swatchQueryTypesOf = (prodTypes = []) => [...new Set([...SWATCH_PRODUCT_TYPES, swatchProductTypeOf(prodTypes)])];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// a name as whole word(s), any case, its own spaces matching a space / underscore / hyphen in the file name
const wholeWordRe = (name) => new RegExp(`(^|[^A-Za-z0-9])(${str(name).split(' ').map(esc).join('[\\s_-]+')})(?![A-Za-z0-9])`, 'i');
const styleOfText = (text, styles = []) => {
    const t = alnum(text);
    const words = (s) => [s.label, s.name].filter(w => alnum(w));          // the sheet's word, and the one it is shown by
    const whole = (styles || []).find(s => words(s).some(w => t.includes(alnum(w))));
    if (whole) return whole;
    // "Grommet.png" for Grommet Pleat, "Ripplefold" for Ripple Fold: a name's first word, when no other style starts with it.
    const firsts = [];
    (styles || []).forEach(s => words(s).forEach(w => { const f = alnum(str(w).split(' ')[0]); if (f.length >= 4) firsts.push({ s, w: f }); }));
    const hits = [...new Set(firsts.filter(x => t.includes(x.w) && !firsts.some(y => y.w === x.w && y.s.key !== x.s.key)).map(x => x.s))];
    return hits.length === 1 ? hits[0] : null;
};

/**
 * A picture's file name → what it shows. { ok, kind: 'COLOUR' | 'STYLE', fabric, colour, style, error }
 * The fabric is the chart's own name found as a whole word; the colour is whatever follows it.
 */
export function swatchNameOf(fileName, chart) {
    const base = str(String(fileName || '').replace(/\.[A-Za-z0-9]{2,5}$/, ''));
    if (!base) return { ok: false, error: 'The file has no name.' };
    if (!hasCurtainChart(chart)) return { ok: false, error: 'No curtain chart is applied — apply the chart first, the file names are read against its fabrics.' };
    const fabrics = [...(chart.fabrics || [])].sort((a, b) => b.name.length - a.name.length);
    for (const f of fabrics) {
        const m = base.match(wholeWordRe(f.name));
        if (!m) continue;
        // the words after the fabric's own, in the file's casing
        const colour = str(base.slice(m.index + m[0].length).replace(/^[\s_\-–·,]+/, '').replace(/_+/g, ' '));
        if (!colour) return { ok: false, error: `"${base}" names ${f.name} but no colour after it.` };
        return { ok: true, kind: 'COLOUR', fabric: f.name, fabricKey: f.key, colour, style: '' };
    }
    const s = styleOfText(base, curtainStylesOf(chart));
    if (s) return { ok: true, kind: 'STYLE', fabric: '', colour: '', style: s.label, styleKey: s.key };
    return { ok: false, error: `"${base}" names no fabric and no top style on the chart (${(chart.fabrics || []).map(f => f.name).join(', ')}).` };
}

const titled = (v) => str(v).toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const picOf = (a) => str(a && (a.thumbnailUrl || a.url || a.originalUrl));
const isHttp = (u) => /^https?:\/\//i.test(str(u));

/**
 * Gallery assets → the swatches the chart can show.
 * { colours: [{ key, fabric, fabricKey, colour, url, fullUrl, asset }], styles: { styleKey → { url, fullUrl, asset } }, unmatched: [asset] }
 * `colours` in the chart's fabric order, then by colour.
 */
export function curtainSwatchesOf(assets = [], chart, { brand = CURTAIN_BRAND } = {}) {
    const out = { colours: [], styles: {}, unmatched: [] };
    if (!hasCurtainChart(chart)) return out;
    const b = String(brand || '').toLowerCase();
    const byKey = new Map();
    (assets || []).forEach(a => {
        if (!a) return;
        const ab = String(a.brandId || 'ALL').toLowerCase();
        if (b && ab !== b && ab !== 'all') return;
        const type = str(a.productType);
        if (!a.curtainSwatch && !/curtain/i.test(type)) return;
        if (!isHttp(picOf(a))) return;
        const tag = a.curtain || {};
        const pic = { url: picOf(a), fullUrl: str(a.originalUrl) || picOf(a), asset: a };
        const f = pick(chart.fabrics, tag.fabric || a.patternId);
        if (f) {
            const colour = str(tag.colour) || titled(a.finishId);
            if (!colour) { out.unmatched.push(a); return; }
            byKey.set(`${f.key}|${keyOf(colour)}`, { key: `${f.key}|${keyOf(colour)}`, fabric: f.name, fabricKey: f.key, colour, ...pic });
            return;
        }
        const s = pick(chart.styles, tag.style || a.patternId) || (tag.style ? null : styleOfText(a.patternId, curtainStylesOf(chart)));
        if (s) { out.styles[s.key] = pic; return; }
        out.unmatched.push(a);
    });
    const order = new Map((chart.fabrics || []).map((f, i) => [f.key, i]));
    out.colours = [...byKey.values()].sort((x, y) => (order.get(x.fabricKey) - order.get(y.fabricKey)) || x.colour.localeCompare(y.colour, undefined, { numeric: true }));
    return out;
}

/**
 * The files dropped on the loader → what each would file: NEW · HAVE (the gallery already shows that
 * fabric + colour / that style) · REFUSED (the name reads as neither). Two files for one colour: the first is taken.
 */
export function swatchLoadPlanOf(fileNames = [], chart, swatches = null) {
    const have = swatches || { colours: [], styles: {} };
    const taken = new Set();
    return (fileNames || []).map(name => {
        const r = swatchNameOf(name, chart);
        if (!r.ok) return { name, status: 'REFUSED', reason: r.error };
        const id = r.kind === 'STYLE' ? `STYLE|${r.styleKey}` : `${r.fabricKey}|${keyOf(r.colour)}`;
        const row = { name, kind: r.kind, fabric: r.fabric, fabricKey: r.fabricKey || '', colour: r.colour, style: r.style, styleKey: r.styleKey || '' };
        if (taken.has(id)) return { ...row, status: 'REFUSED', reason: 'Another file in this drop is the same swatch — the first is taken.' };
        taken.add(id);
        const exists = r.kind === 'STYLE' ? !!(have.styles || {})[r.styleKey] : (have.colours || []).some(c => c.key === id);
        return { ...row, status: exists ? 'HAVE' : 'NEW', reason: exists ? 'Already in the gallery.' : '' };
    });
}
