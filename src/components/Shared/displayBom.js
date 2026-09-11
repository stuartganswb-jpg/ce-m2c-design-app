// SALES DISPLAY BOARDS — the bill of one board (Stuart 2026-09-11)
// ─────────────────────────────────────────────────────────────────────────────────────────────
//
// "ideally i would like to use the marketing tab to design displays … set a board size of say
//  24"x24" then go and configure each row on the cpq and have it add them to the board to create
//  the visual and the BOM for the board."
//
// A display is faces; a face is rows or chips. A ROW is a CPQ configuration exactly as the cart
// carries it (the same breakdown lines every document and floor reads), so a board's bill is
// never typed: it is the sum of its rows' lines, one chip per finish on a chips face, and the
// free-text extras (the base, the panel, the screws). Pure — node-tested, no Firestore, no React —
// because the numbers here become the stock commitment the Sales Snapshot will show.
//
// WHAT A LINE MUST CARRY to reach the bill: an item. A parked-geometry line (no item number, or a
// HIDDEN- placeholder id), a kit holder line (`noNs`, "a kit is not a NetSuite item"), and a
// `hidden` line are not parts anyone pulls, so they never reach it. Everything else does — the
// traverse components included, because the board is built from them.

const U = (v) => String(v == null ? '' : v).trim().toUpperCase();
const N = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Units: 100 per inch, the Guide Books page convention. */
export const UNITS_PER_INCH = 100;

/** The two styles today and the faces each one carries. Sizes are inches; editable per display. */
export const DISPLAY_STYLES = {
    TABLETOP: {
        label: 'Tabletop',
        faces: [
            // A tabletop's front is a BOARD (horizontal rows mounted on it) standing in a BASE the
            // vertical poles stand in — one face, two zones; `baseIn` is the base band's height.
            { key: 'FRONT', label: 'Front — products', kind: 'ROWS', widthIn: 24, heightIn: 24, baseIn: 2.5 },
            { key: 'BACK', label: 'Back — sample chips', kind: 'CHIPS', widthIn: 24, heightIn: 24 },
        ],
        // The two parts every tabletop is built from (Stuart 2026-09-11) — seeded, editable.
        extras: [
            { text: 'Base — sits flat on the table; the vertical poles stand in it', qty: 1 },
            { text: 'Board — attached to the base; the top rows on the front, the sample chips on the back', qty: 1 },
        ],
    },
    WALL: {
        label: 'Wall board',
        faces: [
            { key: 'PRODUCT', label: 'Product board', kind: 'ROWS', widthIn: 24, heightIn: 30 },
            { key: 'CHIPS', label: 'Chip board', kind: 'CHIPS', widthIn: 24, heightIn: 30 },
        ],
        extras: [
            { text: 'Product board — the horizontal rows mount on it', qty: 1 },
            { text: 'Chip board — the sample chips mount on it', qty: 1 },
        ],
    },
};

/** A fresh display record. */
export function newDisplay({ id, name = '', style = 'TABLETOP', brandId = '' } = {}) {
    const def = DISPLAY_STYLES[style] || DISPLAY_STYLES.TABLETOP;
    return {
        id, name, style, brandId, customerId: '',
        faces: def.faces.map(f => ({ ...f, rows: [] })),
        // The chips face carries only the finishes TAGGED on this flow (Stuart 2026-09-11: "it
        // should only be the finishes tagged on the cpq flow for H1") — picked on the display.
        finishFlowId: '',
        extras: (def.extras || []).map(e => ({ ...e })),
    };
}

// ── WHICH FINISHES A DISPLAY SHOWS: the CPQ flow's tagged set ────────────────────────────────
// The same union the onboarding price list uses (BOMTab): the flow's defaultFinishOptions plus
// every step's / option's finishAllowedOptions. Those are finish IDs (the 4.5 record's `id`) or
// codes — match either. An empty set means "nothing restricted" → every finish, and the screen
// says so.
export function flowFinishKeys(flow) {
    const keys = new Set();
    if (!flow) return keys;
    (flow.defaultFinishOptions || []).forEach(v => keys.add(U(v)));
    (flow.steps || []).forEach(s => {
        (s.finishAllowedOptions || []).forEach(v => keys.add(U(v)));
        (s.styleOptions || []).forEach(o => (o.finishAllowedOptions || []).forEach(v => keys.add(U(v))));
    });
    keys.delete('');
    return keys;
}

/** The chips a display shows: its flow's tagged finishes, or every finish when no flow is picked. */
export function chipsForDisplay(display, finishes = [], flows = []) {
    const flow = display?.finishFlowId ? (flows || []).find(f => f && f.id === display.finishFlowId) : null;
    const keys = flowFinishKeys(flow);
    return { chips: chipLines(finishes, keys.size ? keys : null), restricted: keys.size > 0, flow };
}

// ── CHIPS ────────────────────────────────────────────────────────────────────────────────────
// The chip face carries ONE of every finish a customer can order, grouped the way the boards are
// printed: premium plated · brass · painted metal · stained wood. Sub-finishes (the track's bronze
// and champagne base colours) are not sold and take no chip; clear acrylic is not a finish.
export const CHIP_GROUPS = ['PREMIUM PLATED METAL', 'BRASS', 'PAINTED METAL', 'STAINED WOOD'];

export function chipGroupOf(finish) {
    const code = U(finish?.code || finish?.name);
    const name = U(finish?.name);
    const mat = U(finish?.material);
    if (mat === 'CLEAR' || /^AC/.test(code)) return null;
    if (/^S\d/.test(code) || mat === 'WOOD') return 'STAINED WOOD';
    if (/BRASS/.test(name) && /UNLAC|RAW|LIVING/.test(name)) return 'BRASS';
    if (/^M?EP\d/.test(code) || finish?.outsourced) return 'PREMIUM PLATED METAL';
    if (/^P\d/.test(code)) return 'PAINTED METAL';
    return 'PAINTED METAL';
}

const codeOrder = (code) => { const m = U(code).match(/(\d+)/); return m ? parseInt(m[1], 10) : 999; };

/**
 * One chip per sellable finish. `finishes` = the 4.5 in-house list + the outsourced list, each
 * { code, name, material?, isSubFinish?, outsourced?, textureUrl? }. Duplicate codes collapse.
 */
export function chipLines(finishes = [], allowed = null) {
    const seen = new Set();
    const out = [];
    finishes.forEach(f => {
        if (!f || f.isSubFinish) return;
        const code = U(f.code || f.name);
        if (!code || seen.has(code)) return;
        if (allowed && allowed.size && !allowed.has(code) && !allowed.has(U(f.id))) return;
        const group = chipGroupOf(f);
        if (!group) return;
        seen.add(code);
        out.push({ code, name: f.name || code, group, qty: 1, textureUrl: f.textureUrl || '', material: U(f.material) || (group === 'STAINED WOOD' ? 'WOOD' : 'METAL') });
    });
    return out.sort((a, b) => (CHIP_GROUPS.indexOf(a.group) - CHIP_GROUPS.indexOf(b.group)) || (codeOrder(a.code) - codeOrder(b.code)) || a.code.localeCompare(b.code));
}

/**
 * Where each chip sits on a chips face, in page units. Groups stack top to bottom with a header;
 * chips fill rows of as many as fit, each row centred. Returns { headers:[{group,x,y}], chips:[{…chip,x,y,w,h}], overflow }.
 */
export function chipFaceLayout(chips, { widthIn = 24, heightIn = 24, chipWIn = 2.25, chipHIn = 1.5, gapXIn = 0.35, gapYIn = 0.65, marginIn = 0.6, headerIn = 0.45 } = {}) {
    const W = widthIn * UNITS_PER_INCH, H = heightIn * UNITS_PER_INCH;
    const cw = chipWIn * UNITS_PER_INCH, ch = chipHIn * UNITS_PER_INCH;
    const gx = gapXIn * UNITS_PER_INCH, gy = gapYIn * UNITS_PER_INCH;
    const margin = marginIn * UNITS_PER_INCH, header = headerIn * UNITS_PER_INCH;
    const cols = Math.max(1, Math.floor((W - 2 * margin + gx) / (cw + gx)));
    const headers = [];
    const placed = [];
    let y = margin;
    CHIP_GROUPS.forEach(group => {
        const list = chips.filter(c => c.group === group);
        if (!list.length) return;
        headers.push({ group, x: W / 2, y: y + header * 0.7 });
        y += header;
        for (let i = 0; i < list.length; i += cols) {
            const rowChips = list.slice(i, i + cols);
            const rowW = rowChips.length * cw + (rowChips.length - 1) * gx;
            const x0 = (W - rowW) / 2;
            const rowY = Math.round(y);
            for (let j = 0; j < rowChips.length; j++) placed.push({ ...rowChips[j], x: Math.round(x0 + j * (cw + gx)), y: rowY, w: cw, h: ch });
            y += ch + gy;
        }
        y += gy * 0.4;
    });
    return { headers, chips: placed, overflow: y > H, usedHeightIn: y / UNITS_PER_INCH, cols };
}

// ── ROWS → LINES ─────────────────────────────────────────────────────────────────────────────
const isItemLine = (l) => {
    if (!l || l.hidden || l.noNs || l.isKit) return false;
    const id = U(l.partId);
    if (!id || /^HIDDEN-/.test(id)) return false;
    return true;
};

/** The item lines ONE row (one configuration, as configured) contributes to one board. */
export function rowBomLines(row) {
    const lines = (row && row.config && Array.isArray(row.config.lines)) ? row.config.lines : [];
    return lines.filter(isItemLine).map(l => ({
        partId: String(l.partId),
        code: U(l.legacyErpId || l.billedId || l.partId),
        billedId: U(l.billedId || ''),
        name: l.name || '',
        role: l.role || '',
        finishCode: U(l.finishCode),
        qty: N(l.qty, 1) > 0 ? N(l.qty, 1) : 1,
        perFoot: !!l.perFoot,
        feet: l.perFoot ? N(l.feet, 0) : 0,
        cutLength: l.perFoot ? N(l.cutLength, 0) : 0,
        row: row.label || '',
    }));
}

/**
 * The bill of ONE board: the rows' lines aggregated by item + finish (a rod line keeps its feet —
 * a 2 ft row and a 1 ft row of the same rod become one line, 3 ft, qty 2 pieces), one chip per
 * finish on every chips face, and the extras. `finishes` feeds the chip faces.
 * Returns { parts:[…], chips:[…], extras:[…] }.
 */
export function boardBom(display, finishes = [], flows = []) {
    const byKey = new Map();
    (display?.faces || []).forEach(face => {
        if (face.kind !== 'ROWS') return;
        (face.rows || []).forEach(row => rowBomLines(row).forEach(l => {
            const key = `${l.code}|${l.finishCode}`;
            const cur = byKey.get(key);
            if (!cur) { byKey.set(key, { ...l, rows: [l.row].filter(Boolean) }); return; }
            cur.qty += l.qty;
            cur.feet += l.feet;
            if (l.row && !cur.rows.includes(l.row)) cur.rows.push(l.row);
        }));
    });
    const parts = [...byKey.values()].map(l => { const { row, ...rest } = l; return rest; });
    const chipFaces = (display?.faces || []).filter(f => f.kind === 'CHIPS').length;
    const chips = chipFaces ? chipsForDisplay(display, finishes, flows).chips.map(c => ({ ...c, qty: c.qty * chipFaces })) : [];
    const extras = (display?.extras || []).filter(e => e && String(e.text || '').trim()).map(e => ({ text: String(e.text).trim(), qty: N(e.qty, 1) > 0 ? N(e.qty, 1) : 1 }));
    return { parts, chips, extras };
}

/** The same bill for N boards. Quantities and feet multiply; nothing else changes. */
export function orderBom(bom, boards = 1) {
    const n = N(boards, 1) > 0 ? N(boards, 1) : 1;
    const mul = (l) => ({ ...l, qty: l.qty * n, ...(l.feet !== undefined ? { feet: l.feet * n } : {}) });
    return { parts: (bom.parts || []).map(mul), chips: (bom.chips || []).map(mul), extras: (bom.extras || []).map(mul), boards: n };
}

/** A CSV of the bill, the tracker's columns: position, item, description, qty, feet, finish. */
export function bomCsv(bom, boards = 1) {
    const o = orderBom(bom, boards);
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Position on Board', 'Item #', 'Description', 'Qty Needed', 'Feet', 'Finish']];
    o.parts.forEach(l => rows.push([(l.rows || []).join(' / '), l.code, l.name, l.qty, l.perFoot ? l.feet : '', l.finishCode]));
    o.chips.forEach(c => rows.push(['Chips', `CHIP ${c.code}`, c.name, c.qty, '', c.code]));
    o.extras.forEach(e => rows.push(['Board', '', e.text, e.qty, '', '']));
    return rows.map(r => r.map(esc).join(',')).join('\n');
}

/** The fields a cart line keeps when it becomes a row — the breakdown minus the money. */
export function rowConfigFromCartItem(it) {
    const lines = Array.isArray(it?.pricingBreakdown) ? it.pricingBreakdown : (Array.isArray(it?.breakdown) ? it.breakdown : []);
    const keep = ['partId', 'legacyErpId', 'billedId', 'name', 'role', 'position', 'qty', 'perFoot', 'feet', 'cutLength', 'finishCode', 'noFinish', 'hidden', 'trvComponent', 'isKit', 'noNs'];
    return {
        cartId: it?.id || '',
        assemblyId: it?.assemblyId || '',
        assemblyName: it?.assemblyName || it?.name || '',
        flowId: it?.flowId || '',
        finishLabel: it?.finishLabel || '',
        finishes: Array.isArray(it?.finishes) ? it.finishes : [],
        lengthInches: N(it?.engineConfig?.lengthInches, 0) || N(it?.lengthInches, 0) || 0,
        memo: it?.engineConfig?.memo || it?.sidemark || '',
        lines: lines.map(l => Object.fromEntries(keep.filter(k => l[k] !== undefined).map(k => [k, l[k]]))),
    };
}

// ── BUILD ORDERS (piece 2, 2026-09-11) ───────────────────────────────────────────────────────
// A build order is a display, a quantity, the customer, their PO and our SO, a ship plan (boards
// leave over time, not at once), and the tracker's per-line columns. Its lines are a SNAPSHOT of
// the display's bill taken when the order is opened — the design can move on for the next order
// without changing what this one has already pulled — and can be re-taken on purpose.

/** The bill of one board as order lines: per-board quantities, the tracker's columns blank. */
export function buildLinesFrom(display, finishes = [], flows = []) {
    const bom = boardBom(display, finishes, flows);
    const parts = bom.parts.map(l => ({
        key: `${l.code}|${l.finishCode}`,
        partId: l.partId, code: l.code, billedId: U(l.billedId || ''), name: l.name, role: l.role, finishCode: l.finishCode,
        rows: l.rows || [], perFoot: !!l.perFoot, qtyPerBoard: l.qty, feetPerBoard: l.perFoot ? l.feet : 0,
        woNumber: '', atPlater: '', notes: '', done: false,
    }));
    const chips = bom.chips.map(c => ({ key: `CHIP|${c.code}`, code: c.code, name: c.name, group: c.group, finishCode: c.code, qtyPerBoard: c.qty, woNumber: '', notes: '', done: false }));
    const extras = bom.extras.map((e, i) => ({ key: `EXTRA|${i}`, text: e.text, qtyPerBoard: e.qty, notes: '', done: false }));
    return { parts, chips, extras };
}

/** Merge a fresh snapshot over an order's lines, keeping the tracker columns typed on lines that still exist. */
export function resnapshotLines(oldLines, fresh) {
    const keep = (olds, news) => news.map(n => { const o = (olds || []).find(x => x.key === n.key); return o ? { ...n, woNumber: o.woNumber || '', atPlater: o.atPlater || '', notes: o.notes || '', done: !!o.done } : n; });
    return { parts: keep(oldLines?.parts, fresh.parts), chips: keep(oldLines?.chips, fresh.chips), extras: keep(oldLines?.extras, fresh.extras) };
}

/** Boards still to build on an order. */
export const openBoards = (b) => Math.max(0, N(b?.qty, 0) - N(b?.built, 0));

/**
 * The open DISPLAY DEMAND per item across every order that is not complete — what the Sales
 * Snapshot's "Display" column reads (S2). Keyed by the finished SKU CPQ billed where there is
 * one, else the base code + finish. Quantities are (boards still to build) × per-board; feet the
 * same. Chips are listed by finish so a chip run can be sized. Nothing here is a NetSuite commit.
 */
export function displayDemandFrom(builds = []) {
    const byItem = {};
    const add = (key, seed, qty, feet, b) => {
        if (!(qty > 0)) return;
        const cur = byItem[key] || { ...seed, qty: 0, feet: 0, builds: [] };
        cur.qty += qty; cur.feet += feet;
        cur.builds.push({ id: b.id, name: b.name || b.displayName || b.id, qty });
        byItem[key] = cur;
    };
    builds.forEach(b => {
        if (!b || b.status === 'COMPLETE' || b.status === 'CANCELLED') return;
        const open = openBoards(b);
        if (!open) return;
        (b.lines?.parts || []).forEach(l => {
            if (l.done) return;
            const key = `${l.billedId || l.code}|${l.finishCode || ''}`;
            add(key, { code: l.code, billedId: l.billedId || '', partId: l.partId || '', finishCode: l.finishCode || '', name: l.name || '', perFoot: !!l.perFoot }, N(l.qtyPerBoard) * open, N(l.feetPerBoard) * open, b);
        });
        (b.lines?.chips || []).forEach(c => {
            if (c.done) return;
            add(`CHIP|${c.code}`, { code: `CHIP ${c.code}`, billedId: '', partId: '', finishCode: c.code, name: c.name || '', perFoot: false, chip: true }, N(c.qtyPerBoard) * open, 0, b);
        });
    });
    return { byItem, openBoards: builds.reduce((s, b) => s + ((b && b.status !== 'COMPLETE' && b.status !== 'CANCELLED') ? openBoards(b) : 0), 0), builds: builds.filter(b => b && b.status !== 'COMPLETE' && b.status !== 'CANCELLED' && openBoards(b) > 0).map(b => ({ id: b.id, name: b.name || b.id, open: openBoards(b) })) };
}

/** A ship plan: `perShip` boards every `everyDays` from `start` until `qty` is covered. Dates as YYYY-MM-DD. */
export function shipPlanFill({ qty, perShip, start, everyDays = 7 }) {
    const n = N(qty, 0), per = N(perShip, 0), step = Math.max(1, N(everyDays, 7));
    if (!(n > 0) || !(per > 0) || !start) return [];
    const d0 = new Date(`${start}T00:00:00`);
    if (Number.isNaN(d0.getTime())) return [];
    const out = [];
    let left = n, i = 0;
    while (left > 0) {
        const d = new Date(d0.getTime() + i * step * 86400000);
        const q = Math.min(per, left);
        out.push({ date: d.toISOString().slice(0, 10), qty: q, shipped: 0 });
        left -= q; i++;
    }
    return out;
}

// ── SEED A DISPLAY FROM THE TRACKER SPREADSHEET (Stuart 2026-09-11) ──────────────────────────
// "any chance you can create the fabricut tabletop from the spreadsheet" — the tracker's rows are
// the board: "Position on Board" groups the item rows into a display row; Qty Needed is per ORDER
// (÷ boards = per board); the notes carry the rod's cut ("16.75\" (2-FT)"); the finish sits in
// parentheses ("Satin Gold (EP4)"). A seeded row has no render (a labelled box) — replace it from
// the CPQ cart whenever a real configuration is wanted; the bill is right either way.
const finishCodeOf = (s) => { const m = String(s || '').match(/\(([A-Z]{1,3}\d{1,2})\)/i); return m ? m[1].toUpperCase() : ''; };
const cutOf = (note) => {
    const m = String(note || '').match(/(\d+(?:\.\d+)?)\s*"\s*\((\d+(?:\.\d+)?)\s*-?\s*FT\)/i);
    return m ? { cutLength: parseFloat(m[1]), feet: parseFloat(m[2]) } : null;
};
const isRodish = (code, name) => /R\/|R$|-?R-|TRV$|ROD|POLE|TRACK/i.test(`${code} ${name}`) && !/RING|BRACKET|\bCAP\b|FINIAL|COLLAR|RETURN|BACK ?PLATE|BACKPLATE/i.test(name);

/**
 * `grid` = the tracker tab as rows of cells (openpyxl / workbookFileToSheets shape). Returns
 * { name, style, boards, rows:[{ label, lines:[{ code, name, qty, finishCode, perFoot, feet, cutLength }] }],
 *   extras:[{ text, qty }], warnings[] }. Codes are as typed (trimmed, upper); `partId` is
 * resolved by the caller against the library.
 */
export function displayFromTracker(grid, { boards, style = 'TABLETOP', name = '' } = {}) {
    const warnings = [];
    const rows = [];
    const extras = [];
    const n = N(boards, 0);
    if (!(n > 0)) throw new Error('boards must be the order quantity the sheet\'s Qty Needed column is for (50 tabletops, 35 wall boards)');
    let current = null;
    let rowNote = '';
    (grid || []).forEach((r, i) => {
        const [pos, code, desc, qtyNeeded, plater, finishCol, , notes] = style === 'WALL' ? [r[0], r[1], r[2], r[3], '', r[4], r[5], r[6]] : r;
        const position = String(pos || '').trim().replace(/\s+/g, ' ');
        if (!position || /^Position on Board$/i.test(position) || /Display Tracker/i.test(String(r[1] || ''))) return;
        const codeU = U(code);
        if (/BASES?$/i.test(position) && !codeU) { warnings.push(`row ${i + 1}: "${position}" (${N(qtyNeeded)} on the sheet) — the display's own parts are seeded as Board extras instead`); return; }
        if (!codeU) { warnings.push(`row ${i + 1} (${position}): no item code — "${String(desc || '').trim()}" skipped`); return; }
        const label = position.replace(/Row(\d)/i, 'Row $1');
        if (!current || current.label.toUpperCase() !== label.toUpperCase()) {
            current = rows.find(x => x.label.toUpperCase() === label.toUpperCase()) || null;
            // A "Base …" position is a pole standing in the base: one end, no brackets — drawn
            // VERTICAL. Everything else mounts across the board — HORIZONTAL.
            if (!current) { current = { label, lines: [], note: '', orientation: /^BASE\b/i.test(label) ? 'V' : 'H' }; rows.push(current); }
            rowNote = '';
        }
        if (notes && String(notes).trim()) { rowNote = String(notes).trim(); if (!current.note) current.note = rowNote; }
        const per = N(qtyNeeded, 0) / n;
        const qty = Math.round(per * 100) / 100;
        if (!(qty > 0)) { warnings.push(`row ${i + 1} (${codeU}): Qty Needed ${qtyNeeded} — not a positive per-board quantity`); return; }
        if (Math.abs(qty - Math.round(qty)) > 0.001) warnings.push(`row ${i + 1} (${codeU}): ${qtyNeeded} ÷ ${n} boards = ${qty} — not a whole number per board`);
        const finishCode = finishCodeOf(finishCol) || finishCodeOf(current.note) || '';
        const cut = isRodish(codeU, desc) ? cutOf(current.note) : null;
        const line = { code: codeU, name: String(desc || '').trim(), qty: Math.round(qty), finishCode, perFoot: !!cut, feet: cut ? cut.feet : 0, cutLength: cut ? cut.cutLength : 0, plater: String(plater || '').trim() };
        // The sheet repeats one code for two parts (H1-1FRVC/EP as both the bend and its backplate,
        // H1-2TRV-4MR/W as both the kit and its track): keep both lines as written and say so.
        if (current.lines.some(l => l.code === codeU)) warnings.push(`row ${i + 1} (${label}): ${codeU} appears twice in this row — "${line.name}" — check the sheet's coding`);
        current.lines.push(line);
    });
    const def = DISPLAY_STYLES[style] || DISPLAY_STYLES.TABLETOP;
    (def.extras || []).forEach(e => extras.push({ ...e }));
    return { name: name || (style === 'WALL' ? 'Wall display' : 'Tabletop display'), style, boards: n, rows, extras, warnings };
}

/**
 * Lay seeded rows on a ROWS face. Horizontal rows are evenly spaced full-width bands on the
 * board; vertical rows (the base poles) stand on the base band at the bottom, spread across it,
 * "Base Front n" and "Base Back n" interleaved as they stand on the real base, the back poles a
 * little taller and raised so they read as behind. A face with no base (a wall board) keeps
 * every row horizontal.
 */
export function seededRowsLayout(rows, { widthIn = 24, heightIn = 24, baseIn = 0 } = {}) {
    const W = widthIn * UNITS_PER_INCH, H = heightIn * UNITS_PER_INCH;
    const margin = 0.6 * UNITS_PER_INCH;
    const base = Math.max(0, N(baseIn)) * UNITS_PER_INCH;
    const vert = base > 0 ? rows.filter(r => r.orientation === 'V') : [];
    const horiz = rows.filter(r => !vert.includes(r));
    const out = [];
    // the poles: front ones on the base's top edge, back ones behind — interleaved F B F B …
    const frontH = 6 * UNITS_PER_INCH, backH = 8 * UNITS_PER_INCH, poleW = 1.6 * UNITS_PER_INCH;
    const fronts = vert.filter(r => !/BACK/i.test(r.label)), backs = vert.filter(r => /BACK/i.test(r.label));
    const order = []; for (let i = 0; i < Math.max(fronts.length, backs.length); i++) { if (fronts[i]) order.push(fronts[i]); if (backs[i]) order.push(backs[i]); }
    const baseTop = H - margin - base;
    const slot = order.length ? (W - 2 * margin) / order.length : 0;
    order.forEach((r, i) => {
        const isBack = backs.includes(r);
        const h = isBack ? backH : frontH;
        const y = isBack ? baseTop - 0.6 * UNITS_PER_INCH - h : baseTop - h;
        out.push({ ...r, x: Math.round(margin + i * slot + (slot - poleW) / 2), y: Math.round(y), w: Math.round(poleW), h: Math.round(h) });
    });
    // the board rows above them
    const boardBottom = order.length ? baseTop - backH - 0.6 * UNITS_PER_INCH - 0.4 * UNITS_PER_INCH : H - margin;
    const k = Math.max(1, horiz.length);
    const band = Math.max(0, boardBottom - margin) / k;
    const w = Math.round(W * 0.84), h = Math.round(Math.min(band * 0.7, 3.5 * UNITS_PER_INCH));
    horiz.forEach((r, i) => out.push({ ...r, x: Math.round((W - w) / 2), y: Math.round(margin + i * band + (band - h) / 2), w, h }));
    return rows.map(r => out.find(o => o.label === r.label));
}
