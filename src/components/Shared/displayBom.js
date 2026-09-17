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
            // byRow: the same line split by the row it sits on — one work order per row (Stuart 2026-09-16)
            const rowKey = l.row || '';
            if (!cur) { byKey.set(key, { ...l, rows: [l.row].filter(Boolean), byRow: { [rowKey]: { qty: l.qty, feet: l.feet, cutLength: l.cutLength, billedId: l.billedId } } }); return; }
            cur.qty += l.qty;
            cur.feet += l.feet;
            if (l.row && !cur.rows.includes(l.row)) cur.rows.push(l.row);
            const br = cur.byRow[rowKey];
            if (!br) cur.byRow[rowKey] = { qty: l.qty, feet: l.feet, cutLength: l.cutLength, billedId: l.billedId };
            else { br.qty += l.qty; br.feet += l.feet; if (!br.billedId && l.billedId) br.billedId = l.billedId; }
            if (!cur.billedId && l.billedId) cur.billedId = l.billedId;
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
        byRow: Object.entries(l.byRow || {}).map(([row, v]) => ({ row, qtyPerBoard: v.qty, feetPerBoard: l.perFoot ? v.feet : 0, cutLength: l.perFoot ? v.cutLength : 0, billedId: U(v.billedId || '') })),
        woNumber: '', atPlater: '', notes: '', done: false,
    }));
    const chips = bom.chips.map(c => ({ key: `CHIP|${c.code}`, code: c.code, name: c.name, group: c.group, finishCode: c.code, qtyPerBoard: c.qty, woNumber: '', notes: '', done: false }));
    const extras = bom.extras.map((e, i) => ({ key: `EXTRA|${i}`, text: e.text, qtyPerBoard: e.qty, notes: '', done: false }));
    return { parts, chips, extras };
}

/** Merge a fresh snapshot over an order's lines, keeping the tracker columns typed on lines that still exist. */
export function resnapshotLines(oldLines, fresh) {
    // an edited finish on a row survives too (finishOverride lives on the per-row split)
    const keepRows = (oldRows, newRows) => (Array.isArray(newRows) ? newRows.map(r => { const or = (oldRows || []).find(x => x.row === r.row); return or && or.finishOverride ? { ...r, finishOverride: or.finishOverride } : r; }) : newRows);
    const keep = (olds, news) => news.map(n => { const o = (olds || []).find(x => x.key === n.key); return o ? { ...n, woNumber: o.woNumber || '', atPlater: o.atPlater || '', notes: o.notes || '', done: !!o.done, ...(n.byRow ? { byRow: keepRows(o.byRow, n.byRow) } : {}), ...(Array.isArray(o.raised) && o.raised.length ? { raised: o.raised } : {}) } : n; });
    return { parts: keep(oldLines?.parts, fresh.parts), chips: keep(oldLines?.chips, fresh.chips), extras: keep(oldLines?.extras, fresh.extras) };
}

// ── RAISING THE WORK (Stuart 2026-09-16) ─────────────────────────────────────────────────────
// "i want to create work orders for all of the rows, each one gets a work order … i want the work
//  orders to flow like usual and i want the plated items to flow as if they were normal orders …
//  only new we are building is the management portion."
//
// THE DOOR IS ORDER ENTRY (second cut, same day). The first cut raised through the STOCK writers,
// and a display is almost all made-to-order: a painted part's library record is the /P base, not
// H1-75SR/P06; a plated pole is not stocked; a fee is not a work order. The door built for exactly
// that is tab 7's sales order — a stocked item as a stock line, anything else as the raw item + the
// finish it is to be finished in ("TO BE FINISHED"), cut feet for a per-foot item, the stain taking
// the species item — and Stock View → Order Entry Needs raises every work order, plating demand,
// pole cut and purchase order from it through its review gate, exactly as for any customer order.
//
// So each part line is split by the ROW it sits on, and each (line × row) becomes ONE order line of
// per-board × boards with the row as its memo. Nothing here decides a route; the plan names the
// finished code and the finish so the operator can check them before the lines go to tab 7.
//
// THE FINISH (Stuart 2026-09-16): editable per line × row (`finishOverride` on the split), and "the
// wood takes the stain default entered on the first wood component" — on a row, the first line in
// a stain (S01…) sets the row's stain, and every other WOOD part on that row takes it unless its
// finish was edited. A wood part is a species-suffixed code (-O / -W) or a line named wood.

const STAIN_RE = /^S\d+$/;
const isWoodLine = (line) => /-(O|W)$/.test(U(line?.code).split('/')[0]) || /\bWOOD\b/i.test(String(line?.name || ''));

/** The sample bin a build's finished pieces are put away to, by display style (Stuart 2026-09-16). */
export const SAMPLE_BIN_BY_STYLE = { TABLETOP: 'FDISTABLE', WALL: 'FDISWALL' };

/**
 * The finished code a line × row is made as (Stuart 2026-09-16: "the codes it is combining have an
 * extra /P/ in between the finish should be H1-75SR/P06").
 *
 * A line's code often ends in a FINISH-FAMILY MARKER rather than a finish: `/P` (the painted
 * family — and the shared SKU CPQ bills for any paint) or a bare `/EP` / `/MEP` (the plated family).
 * The finish REPLACES that marker: H1-75SR/P + P06 → H1-75SR/P06, H1-1R/EP + EP2 → H1-1R/EP2. A code
 * with no suffix takes the finish on the end (H1-138WR + S03 → H1-138WR/S03); a code that already
 * ends in the finish is kept. CPQ's billed SKU wins only when it ends in the line's own finish — a
 * paint bills the shared /P SKU, which is the phosphated core, not the painted part.
 */
const FAMILY_MARKER_RE = /^(P|M?EP)$/;
export function targetCodeOf(line, rowPart = null, finishSuffixOf = null) {
    const suffixOf = finishSuffixOf || ((c) => { const i = c.lastIndexOf('/'); return i > 0 ? c.slice(i + 1) : ''; });
    const fin = U(line?.finishCode);
    const billed = U((rowPart && rowPart.billedId) || line?.billedId || '');
    if (billed && (!fin || U(suffixOf(billed)) === fin)) return billed;
    const code = U(line?.code);
    if (!code) return billed || '';
    if (!fin) return code;
    const suffix = U(suffixOf(code));
    if (suffix === fin) return code;
    if (FAMILY_MARKER_RE.test(suffix)) return `${code.slice(0, code.lastIndexOf('/'))}/${fin}`;
    return `${code}/${fin}`;
}

/** One order line per (part line × row). `routeOf` = stockRun.routeForCode; `finishSuffixOf` = finishRouting's. */
export function raisePlan(order, { boards, routeOf, finishSuffixOf = null } = {}) {
    const n = Math.max(0, Math.floor(N(boards, N(order?.qty, 0))));
    const items = [];
    const missingByRow = [];
    const rowStain = {};                                  // row → the stain its first stained line carries
    const parts = order?.lines?.parts || [];
    parts.forEach(line => {
        if (!(Array.isArray(line.byRow) && line.byRow.length)) { missingByRow.push(line.key); return; }
        line.byRow.forEach(sp => {
            const fin = U(sp.finishOverride || line.finishCode);
            if (STAIN_RE.test(fin) && !rowStain[sp.row]) rowStain[sp.row] = fin;
        });
    });
    const sentKeys = new Set((order?.salesOrders || []).flatMap(so => so.keys || []));
    parts.forEach(line => {
        if (!(Array.isArray(line.byRow) && line.byRow.length)) return;
        line.byRow.forEach(sp => {
            const own = U(line.finishCode);
            const override = U(sp.finishOverride || '');
            const stain = rowStain[sp.row] || '';
            const woodDefault = !override && stain && isWoodLine(line) && own !== stain;
            const finish = override || (woodDefault ? stain : own);
            const target = targetCodeOf({ ...line, finishCode: finish }, sp, finishSuffixOf);
            const route = routeOf ? routeOf(target) : { routeTo: null, refuse: null, finish: '' };
            const kind = route.refuse === 'OUTSOURCED' ? 'PLATING' : route.refuse === 'PHOSPHATE' ? 'CONVERT' : route.routeTo === 'FINISHING' ? 'FINISHING' : route.routeTo === 'SHOP' ? 'SHOP' : 'UNKNOWN';
            const key = `${line.key}@${sp.row}`;
            const perBoard = N(sp.qtyPerBoard, 0);
            items.push({
                key, lineKey: line.key, row: sp.row, code: line.code, name: line.name || '',
                finish, finishSource: override ? 'EDITED' : woodDefault ? 'ROW_STAIN' : 'LINE',
                target, base: target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : target,
                kind, perBoard, qty: perBoard * n,
                perFoot: !!line.perFoot, feetPerBoard: N(sp.feetPerBoard, 0), cutLength: N(sp.cutLength, 0),
                feetPerPiece: line.perFoot && perBoard > 0 ? N(sp.feetPerBoard, 0) / perBoard : 0,
                sent: sentKeys.has(key),
            });
        });
    });
    return { boards: n, items, missingByRow, rowStain };
}

// ── A WRONG CODE, CORRECTED (Stuart 2026-09-16) ──────────────────────────────────────────────
// "the row 5 acrylic rod was entered with code H1-2RCTACROD4 and it should be H1-2RCTACR … row 1
//  bracket backplate … should be H1-75SBP-S". A seeded tracker can carry a code the library does
// not know. The correction is made twice, on purpose: on the build order's line (what is sent)
// and on the design's rows (so a re-snapshot does not bring the old code back). The caller has
// already found the new code in the library and passes its record id and name.

/** The design, with `oldCode` replaced by `newCode` on the named rows' lines. */
export function replaceRowLineCode(display, { rows = [], oldCode, newCode, partId = '', name = '' } = {}) {
    const from = U(oldCode), to = U(newCode);
    const onRows = new Set(rows);
    let changed = 0;
    const faces = (display?.faces || []).map(face => (face.kind !== 'ROWS' ? face : {
        ...face,
        rows: (face.rows || []).map(row => {
            if (onRows.size && !onRows.has(row.label || '')) return row;
            const lines = row?.config?.lines;
            if (!Array.isArray(lines)) return row;
            let hit = false;
            const next = lines.map(l => {
                if (U(l.legacyErpId || l.billedId || l.partId) !== from) return l;
                hit = true; changed++;
                const { billedId, ...rest } = l;
                return { ...rest, legacyErpId: to, partId: partId || to, ...(name ? { name } : {}) };
            });
            return hit ? { ...row, config: { ...row.config, lines: next } } : row;
        }),
    }));
    return { display: { ...display, faces }, changed };
}

/** The build order's lines with one line's code replaced; a line that now matches another merges into it. */
export function replaceBuildLineCode(lines, lineKey, { newCode, partId = '', name = '' } = {}) {
    const parts = lines?.parts || [];
    const line = parts.find(l => l.key === lineKey);
    if (!line) return { lines, newKey: null, merged: false };
    const code = U(newCode);
    const newKey = `${code}|${line.finishCode}`;
    const updated = {
        ...line, key: newKey, code, partId: partId || code, name: name || line.name, billedId: '',
        byRow: (line.byRow || []).map(r => ({ ...r, billedId: '' })),
    };
    const other = parts.find(l => l.key === newKey && l.key !== lineKey);
    if (!other) return { lines: { ...lines, parts: parts.map(l => (l.key === lineKey ? updated : l)) }, newKey, merged: false };
    const byRow = [...(other.byRow || [])];
    updated.byRow.forEach(r => {
        const hit = byRow.find(x => x.row === r.row);
        if (!hit) { byRow.push(r); return; }
        hit.qtyPerBoard = N(hit.qtyPerBoard) + N(r.qtyPerBoard);
        hit.feetPerBoard = N(hit.feetPerBoard) + N(r.feetPerBoard);
    });
    const mergedLine = {
        ...other, byRow,
        qtyPerBoard: N(other.qtyPerBoard) + N(updated.qtyPerBoard),
        feetPerBoard: N(other.feetPerBoard) + N(updated.feetPerBoard),
        rows: [...new Set([...(other.rows || []), ...(updated.rows || [])])],
    };
    return { lines: { ...lines, parts: parts.filter(l => l.key !== lineKey).map(l => (l.key === newKey ? mergedLine : l)) }, newKey, merged: true };
}

/** The lines tab 7 loads — one per item, the row as the memo. Pure; tab 7 resolves stock vs to-be-finished. */
export function orderEntryLinesOf(items = []) {
    return items.map(i => ({
        key: i.key, row: i.row, code: i.code, target: i.target, base: i.base, finishCode: i.finish, qty: i.qty, name: i.name,
        perFoot: !!i.perFoot, feetPer: i.feetPerPiece || 0, cutLength: i.cutLength || 0,
    }));
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

// ── A PLACED ROW IS DRAWN AT THE OBJECT'S REAL SIZE (Stuart 2026-09-13) ──────────────────────
// "align the width of the cpq design window to the same when it places it in the display tool …
// if you can have the scale match closer." The capture is the whole 3D pane, so fitting it into a
// box shrank the rod to the pane's margins. The board is drawn at 100 units per inch and the
// configuration knows its length, so once the picture is cropped to the object (the screen does
// that), the box is the rod's length in inches along its axis and the picture's own aspect the
// other way. A row with no known length keeps whatever box it has.
export function fitRowToLength(row, { lengthInches, aspect, faceWidthIn = 24, faceHeightIn = 24 } = {}) {
    const L = N(lengthInches, 0), a = N(aspect, 0);   // aspect = image width / height after the crop
    if (!(L > 0) || !(a > 0) || !row) return row;
    const W = faceWidthIn * UNITS_PER_INCH, H = faceHeightIn * UNITS_PER_INCH;
    const cx = N(row.x) + N(row.w) / 2, cy = N(row.y) + N(row.h) / 2;
    let w, h;
    if (row.orientation === 'V') { h = Math.min(L * UNITS_PER_INCH, H * 0.9); w = h * a; }
    else { w = Math.min(L * UNITS_PER_INCH, W * 0.96); h = w / a; }
    w = Math.round(w); h = Math.round(h);
    const x = Math.round(Math.min(Math.max(0, cx - w / 2), W - w));
    const y = Math.round(Math.min(Math.max(0, cy - h / 2), H - h));
    return { ...row, x, y, w, h, trueScale: true };
}
