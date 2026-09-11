// Harness for Shared/displayBom.js — the bill of a sales display board.
//   node scripts/displayBom.test.mjs
import { newDisplay, chipLines, chipGroupOf, chipFaceLayout, rowBomLines, boardBom, orderBom, bomCsv, rowConfigFromCartItem, UNITS_PER_INCH, buildLinesFrom, resnapshotLines, displayDemandFrom, shipPlanFill, openBoards, displayFromTracker, seededRowsLayout, flowFinishKeys, chipsForDisplay } from '../src/components/Shared/displayBom.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

// ── A cart line as CPQ hands it (prod shape: partId = doc id, code on legacyErpId) ──────────────
const cartTopRow1 = {
    id: '1', assemblyName: 'H1-1', flowId: 'F1', finishLabel: 'Satin Gold (EP4)', finishes: ['EP4'],
    engineConfig: { lengthInches: 16.75, memo: 'Top Row 1' },
    pricingBreakdown: [
        { partId: 'CE-INV-1', legacyErpId: 'H1-1R', name: '1" Round Rod', role: 'ROD', qty: 1, perFoot: true, feet: 2, cutLength: 16.75, finishCode: 'EP4', unit: 60, total: 120 },
        { partId: 'CE-INV-2', legacyErpId: 'H1-1FRVC', name: 'French Return w/ Covered Vertical Backplate', role: 'RETURN', qty: 2, finishCode: 'EP4', unit: 98, total: 196 },
        { partId: 'CE-INV-3', legacyErpId: 'H1-1BR', name: 'Beveled Ring', role: 'RING', qty: 1, finishCode: 'EP4', unit: 12, total: 12 },
        { partId: 'HIDDEN-standoff', name: 'standoff', role: 'OTHER', qty: 2, finishCode: 'EP4', hidden: true, unit: 0, total: 0 },
        { partId: 'H1-2TRV-4/P', name: '4ft kit', qty: 1, isKit: true, noNs: true, unit: 203, total: 203 },
        { partId: 'CE-INV-9', legacyErpId: 'H1-1NUT', name: 'Standoff nut (hidden, real item)', role: 'OTHER', qty: 2, finishCode: 'EP4', hidden: true, unit: 0, total: 0 },
    ],
};
const cartTopRow2 = {
    id: '3', assemblyName: 'H1-1', pricingBreakdown: [
        { partId: 'CE-INV-1', legacyErpId: 'H1-1R', name: '1" Round Rod', role: 'ROD', qty: 1, perFoot: true, feet: 1, cutLength: 12, finishCode: 'EP4' },
    ],
};
const cartBaseFront3 = {
    id: '2', assemblyName: 'H1-1', pricingBreakdown: [
        { partId: 'CE-INV-1', legacyErpId: 'H1-1R', name: '1" Round Rod', role: 'ROD', qty: 1, perFoot: true, feet: 1, cutLength: 7.5, finishCode: 'EP2' },
        { partId: 'CE-INV-4', legacyErpId: 'H1-1BF', name: 'Ball Finial', role: 'FINIAL', qty: 1, finishCode: 'EP2' },
        { partId: 'CE-INV-3', legacyErpId: 'H1-1BR', name: 'Beveled Ring', role: 'RING', qty: 1, finishCode: 'EP4' },
    ],
};

// ── 1. a cart line becomes a row config without its money ───────────────────────────────────
{
    const cfg = rowConfigFromCartItem(cartTopRow1);
    eq('the assembly, flow, finish label and length come across', [cfg.assemblyName, cfg.flowId, cfg.finishLabel, cfg.lengthInches, cfg.memo], ['H1-1', 'F1', 'Satin Gold (EP4)', 16.75, 'Top Row 1']);
    ok('no money on a row line', cfg.lines.every(l => l.unit === undefined && l.total === undefined));
    eq('every line is kept, filtering happens at the bill', cfg.lines.length, 6);
    ok('an old-engine item with no breakdown gives an empty line list, not a crash', rowConfigFromCartItem({ id: 'x', name: 'old' }).lines.length === 0);
}

// ── 2. the lines one row contributes ─────────────────────────────────────────────────────────
{
    const row = { label: 'Top Row 1', config: rowConfigFromCartItem(cartTopRow1) };
    const lines = rowBomLines(row);
    eq('parked geometry, the kit holder AND a hidden real item never reach the bill', lines.map(l => l.code), ['H1-1R', 'H1-1FRVC', 'H1-1BR']);
    eq('the rod keeps its feet and its cut, qty stays one piece', [lines[0].qty, lines[0].feet, lines[0].cutLength, lines[0].perFoot], [1, 2, 16.75, true]);
    eq('the returns are two', lines[1].qty, 2);
    eq('every line names its row', lines.map(l => l.row), ['Top Row 1', 'Top Row 1', 'Top Row 1']);
}

// ── 3. one board: rows aggregate by item + finish, feet add, rows are named ─────────────────
{
    const d = newDisplay({ id: 'D1', name: 'Tabletop', style: 'TABLETOP' });
    d.faces[0].rows = [
        { id: 'r1', label: 'Top Row 1', config: rowConfigFromCartItem(cartTopRow1) },
        { id: 'r2', label: 'Base Front 3', config: rowConfigFromCartItem(cartBaseFront3) },
        { id: 'r3', label: 'Top Row 2', config: rowConfigFromCartItem(cartTopRow2) },
    ];
    d.extras = [{ text: 'Walnut base', qty: 1 }, { text: '', qty: 3 }];
    const finishes = [
        { code: 'P06', name: 'Gild Gold' }, { code: 'EP4', name: 'Satin Gold', outsourced: true }, { code: 'S04', name: 'Natural Oak' },
        { code: 'C', name: 'Champagne', isSubFinish: true }, { code: 'AC', name: 'Clear Acrylic', material: 'CLEAR' }, { code: 'P06', name: 'Gild Gold (dup)' },
    ];
    const bom = boardBom(d, finishes);
    const part = (code, fin) => bom.parts.find(p => p.code === code && p.finishCode === fin);
    eq('the same rod in two finishes is two lines', bom.parts.filter(p => p.code === 'H1-1R').length, 2);
    eq('the same ring in the same finish on two rows is ONE line, qty 2, both rows named', [part('H1-1BR', 'EP4').qty, part('H1-1BR', 'EP4').rows], [2, ['Top Row 1', 'Base Front 3']]);
    eq('the same rod in the same finish on two rows: feet add (2 + 1), two pieces', [part('H1-1R', 'EP4').feet, part('H1-1R', 'EP4').qty, part('H1-1R', 'EP2').feet], [3, 2, 1]);
    eq('five part lines in all', bom.parts.length, 5);
    eq('chips: one per sellable finish, sub-finish and clear acrylic and the duplicate dropped', bom.chips.map(c => c.code), ['EP4', 'P06', 'S04']);
    eq('chips grouped the way the board prints', bom.chips.map(c => c.group), ['PREMIUM PLATED METAL', 'PAINTED METAL', 'STAINED WOOD']);
    eq('a blank extra is dropped', bom.extras, [{ text: 'Walnut base', qty: 1 }]);

    const o = orderBom(bom, 50);
    eq('fifty boards: rings ×50, rod feet ×50, chips ×50, base ×50', [o.parts.find(p => p.code === 'H1-1BR').qty, o.parts.find(p => p.code === 'H1-1R' && p.finishCode === 'EP4').feet, o.chips[0].qty, o.extras[0].qty, o.boards], [100, 150, 50, 50, 50]);
    eq('the one-board bill is untouched by the order multiply', part('H1-1BR', 'EP4').qty, 2);

    const csv = bomCsv(bom, 50);
    ok('the CSV reads like the tracker: position, item, description, qty, feet, finish', csv.split('\n')[0] === 'Position on Board,Item #,Description,Qty Needed,Feet,Finish' && /Top Row 1 \/ Base Front 3,H1-1BR,Beveled Ring,100,,EP4/.test(csv), csv);
    ok('a description with a quote is escaped', /"1"" Round Rod"/.test(csv), csv);

    // a wall board has a chips face too; a display with no chips face has no chips
    const w = newDisplay({ id: 'D2', style: 'WALL' });
    eq('a wall board is two boards: product rows and chips', w.faces.map(f => [f.key, f.kind]), [['PRODUCT', 'ROWS'], ['CHIPS', 'CHIPS']]);
    w.faces = w.faces.filter(f => f.kind === 'ROWS');
    eq('no chips face, no chips', boardBom(w, finishes).chips.length, 0);
}

// ── 4. chip grouping rules ───────────────────────────────────────────────────────────────────
{
    eq('EP → premium plated', chipGroupOf({ code: 'EP2', name: 'Polished Nickel' }), 'PREMIUM PLATED METAL');
    eq('MEP → premium plated', chipGroupOf({ code: 'MEP1', name: 'x' }), 'PREMIUM PLATED METAL');
    eq('P → painted', chipGroupOf({ code: 'P30', name: 'Silver' }), 'PAINTED METAL');
    eq('S → stained wood', chipGroupOf({ code: 'S12', name: 'Pure Walnut' }), 'STAINED WOOD');
    eq('material WOOD wins for an odd code', chipGroupOf({ code: 'XW1', name: 'Oak', material: 'WOOD' }), 'STAINED WOOD');
    eq('unlacquered brass is its own group', chipGroupOf({ code: 'UB', name: 'Unlacquered Brushed Brass' }), 'BRASS');
    eq('clear acrylic is not a chip', chipGroupOf({ code: 'AC', name: 'Clear', material: 'CLEAR' }), null);
    const sorted = chipLines([{ code: 'P10', name: 'b' }, { code: 'EP1', name: 'a' }, { code: 'P2', name: 'c' }, { code: 'S1', name: 'd' }]);
    eq('sorted by group then number', sorted.map(c => c.code), ['EP1', 'P2', 'P10', 'S1']);
}

// ── 5. the chip face lays itself out and says when it will not fit ──────────────────────────
{
    const chips = chipLines([...Array.from({ length: 7 }, (_, i) => ({ code: `EP${i + 1}`, name: `ep${i}` })), { code: 'UB', name: 'Unlacquered Brass' }, ...Array.from({ length: 25 }, (_, i) => ({ code: `P${i + 1}`, name: `p${i}` })), ...Array.from({ length: 12 }, (_, i) => ({ code: `S${i + 1}`, name: `s${i}` }))]);
    const lay = chipFaceLayout(chips, { widthIn: 24, heightIn: 24 });
    eq('24" wide takes 8 chips per row at 2.25" + 0.35" gap with a 0.6" margin', lay.cols, 8);
    eq('every chip placed once', lay.chips.length, 45);
    eq('four headers in print order', lay.headers.map(h => h.group), ['PREMIUM PLATED METAL', 'BRASS', 'PAINTED METAL', 'STAINED WOOD']);
    ok('rows are centred: the lone brass chip sits mid-board', Math.abs((lay.chips.find(c => c.code === 'UB').x + 2.25 * UNITS_PER_INCH / 2) - 12 * UNITS_PER_INCH) < 1);
    ok('the first row starts at the margin and inside the board', lay.chips[0].x >= 0 && lay.chips[0].x + lay.chips[0].w <= 24 * UNITS_PER_INCH);
    eq('45 chips fit a 24 × 24 board', lay.overflow, false);
    eq('…and not a 24 × 10 one', chipFaceLayout(chips, { widthIn: 24, heightIn: 10 }).overflow, true);
}

// ── 6. BUILD ORDERS: snapshot lines, re-snapshot keeps the typed columns, demand, ship plan ────
{
    const d = newDisplay({ id: 'D1', name: 'Tabletop', style: 'TABLETOP' });
    d.faces[0].rows = [
        { id: 'r1', label: 'Top Row 1', config: rowConfigFromCartItem({ ...cartTopRow1, pricingBreakdown: cartTopRow1.pricingBreakdown.map(l => (l.legacyErpId === 'H1-1BR' ? { ...l, billedId: 'H1-1BR/EP4' } : l)) }) },
        { id: 'r2', label: 'Base Front 3', config: rowConfigFromCartItem(cartBaseFront3) },
    ];
    d.extras = [{ text: 'Walnut base', qty: 1 }];
    const finishes = [{ code: 'P06', name: 'Gild Gold' }, { code: 'EP4', name: 'Satin Gold', outsourced: true }];
    const lines = buildLinesFrom(d, finishes);
    const ring = lines.parts.find(l => l.code === 'H1-1BR' && l.finishCode === 'EP4');
    eq('a build line carries per-board qty, the finished SKU, its rows and blank tracker columns', [ring.qtyPerBoard, ring.billedId, ring.rows, ring.woNumber, ring.atPlater, ring.done], [2, 'H1-1BR/EP4', ['Top Row 1', 'Base Front 3'], '', '', false]);
    eq('a rod line carries feet per board', lines.parts.find(l => l.code === 'H1-1R' && l.finishCode === 'EP4').feetPerBoard, 2);
    eq('chips and extras are lines too', [lines.chips.length, lines.extras[0].qtyPerBoard], [2, 1]);

    // re-snapshot after the design changed: typed columns survive on lines that still exist, a new line is blank, a gone line goes
    const typed = { ...lines, parts: lines.parts.map(l => (l.code === 'H1-1BR' ? { ...l, woNumber: 'WO10441', atPlater: 'Completed', done: true } : l)) };
    d.faces[0].rows = d.faces[0].rows.slice(0, 1);   // Base Front 3 removed → the EP2 rod and ball finial go, the ring drops to qty 1
    const fresh = resnapshotLines(typed, buildLinesFrom(d, finishes));
    const ring2 = fresh.parts.find(l => l.code === 'H1-1BR');
    eq('the ring keeps its WO#, plater status and done flag, and takes the NEW per-board qty', [ring2.woNumber, ring2.atPlater, ring2.done, ring2.qtyPerBoard], ['WO10441', 'Completed', true, 1]);
    eq('the removed row\'s lines are gone', fresh.parts.some(l => l.code === 'H1-1BF'), false);

    // demand across two orders: open boards × per-board, done lines and complete orders excluded, keyed by the finished SKU
    const b1 = { id: 'B1', name: 'Fabricut 50', qty: 50, built: 10, status: 'IN_PRODUCTION', lines: typed };
    const b2 = { id: 'B2', name: 'Fabricut 100', qty: 100, built: 0, status: 'PLANNED', lines: buildLinesFrom(d, finishes) };
    const b3 = { id: 'B3', name: 'old', qty: 35, built: 0, status: 'COMPLETE', lines: buildLinesFrom(d, finishes) };
    eq('open boards', [openBoards(b1), openBoards(b2), openBoards(b3)], [40, 100, 35]);
    const dem = displayDemandFrom([b1, b2, b3]);
    eq('the ring is keyed by its finished SKU; B1 marked it done so only B2 counts: 100 × 1', [dem.byItem['H1-1BR/EP4|EP4'].qty, dem.byItem['H1-1BR/EP4|EP4'].builds.map(x => x.id)], [100, ['B2']]);
    eq('the EP4 rod: B1 40 boards × 2 ft + B2 100 × 2 ft = 280 ft, pieces 140', [dem.byItem['H1-1R|EP4'].feet, dem.byItem['H1-1R|EP4'].qty], [280, 140]);
    eq('a complete order adds nothing; open boards total 140 across two orders', [dem.openBoards, dem.builds.map(x => x.id)], [140, ['B1', 'B2']]);
    eq('chips are demand too, by finish', dem.byItem['CHIP|EP4'].qty, 140);
    eq('nothing when every order is complete', Object.keys(displayDemandFrom([b3]).byItem).length, 0);

    // ship plan: 50 boards, 10 a week from a date → five drops, the last one partial when needed
    const plan = shipPlanFill({ qty: 50, perShip: 10, start: '2026-09-14', everyDays: 7 });
    eq('five weekly drops of ten', [plan.length, plan[0].date, plan[4].date, plan.reduce((s, p) => s + p.qty, 0)], [5, '2026-09-14', '2026-10-12', 50]);
    eq('a partial last drop', shipPlanFill({ qty: 35, perShip: 10, start: '2026-09-14' }).map(p => p.qty), [10, 10, 10, 5]);
    eq('no plan without a start date or a rate', [shipPlanFill({ qty: 35, perShip: 0, start: '2026-09-14' }).length, shipPlanFill({ qty: 35, perShip: 10, start: '' }).length], [0, 0]);
}

// ── 7. SEED FROM THE TRACKER — run against the REAL spreadsheet when it is present ───────────
{
    const { execSync } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    const xlsx = '0903/Displays/Tabletop & Wall Display Tracker.xlsx';
    let sheets = null;
    if (existsSync(xlsx)) {
        try {
            sheets = JSON.parse(execSync(`python3 -c "import openpyxl,json,sys; wb=openpyxl.load_workbook(sys.argv[1],data_only=True); print(json.dumps({ws.title: [[c for c in r] for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}, default=str))" "${xlsx}"`, { encoding: 'utf8' }));
        } catch { sheets = null; }
    }
    if (!sheets) { console.log('  (tracker xlsx not present or openpyxl missing — seed tests skipped)'); }
    else {
        const tt = displayFromTracker(sheets['Tabletop Display Board Tracker'], { boards: 50, style: 'TABLETOP', name: 'Fabricut H1 Tabletop' });
        eq('tabletop: nine positions; the sheet\'s "Tabletop Bases" line becomes the style\'s two parts (base + board) as extras', [tt.rows.map(r => r.label), tt.extras.map(e => e.text.split(' — ')[0])], [['Top Row 1', 'Top Row 2', 'Base Front 1', 'Base Front 2', 'Base Front 3', 'Base Front 4', 'Base Back 1', 'Base Back 2', 'Base Back 3'], ['Base', 'Board']]);
        ok('the bases line is named in the warnings, not lost', tt.warnings.some(w => /Tabletop Bases/.test(w)), tt.warnings.join(' | '));
        eq('top rows are HORIZONTAL, base rows are VERTICAL poles', tt.rows.map(r => r.orientation), ['H', 'H', 'V', 'V', 'V', 'V', 'V', 'V', 'V']);
        const tr1 = tt.rows[0];
        eq('Top Row 1: the rod is 2 ft cut at 16.75, EP4, one per board; the backplates are two per board', [tr1.lines[0].code, tr1.lines[0].feet, tr1.lines[0].cutLength, tr1.lines[0].finishCode, tr1.lines[0].qty, tr1.lines[2].qty], ['H1-1R/EP', 2, 16.75, 'EP4', 1, 2]);
        eq('"Top Row1" (no space) joins Top Row 1', tr1.lines.length, 4);
        eq('Base Front 3: a plated pole reads its cut despite the word "Plated"', [tt.rows[4].lines[0].code, tt.rows[4].lines[0].feet, tt.rows[4].lines[0].cutLength, tt.rows[4].lines[0].finishCode], ['H1-1R/EP', 1, 7.5, 'EP2']);
        eq('Base Back 2: the wood pole is 1 ft at 9.25, S08; the collar takes its own P04', [tt.rows[7].lines[0].feet, tt.rows[7].lines[0].cutLength, tt.rows[7].lines[0].finishCode, tt.rows[7].lines[2].finishCode], [1, 9.25, 'S08', 'P04']);
        eq('Base Back 1: the acrylic row takes the note\'s EP1 where the finish column says Clear Acrylic', tt.rows[6].lines.map(l => l.finishCode), ['EP1', 'EP1', 'EP1']);
        ok('the sheet\'s doubled codes are named, not silently merged', tt.warnings.some(w => /H1-1FRVC\/EP appears twice/.test(w)) && tt.warnings.some(w => /H1-2TRV-4MR\/W appears twice/.test(w)), tt.warnings.join(' | '));
        ok('a 100-of-50 quantity is a whole 2 per board, no warning', !tt.warnings.some(w => /not a whole number/.test(w)), tt.warnings.join(' | '));

        const wl = displayFromTracker(sheets['Wall Display Board Tracker'], { boards: 35, style: 'WALL' });
        eq('wall: six rows; Row 1 = pole 2 ft at 18 + 2 finials + 2 plates + 2 brackets + 1 ring, all P06', [wl.rows.length, wl.rows[0].lines.map(l => l.qty), wl.rows[0].lines.every(l => l.finishCode === 'P06'), wl.rows[0].lines[0].feet, wl.rows[0].lines[0].cutLength], [6, [1, 2, 2, 2, 1], true, 2, 18]);
        ok('the code-less "Mitered Return" line is skipped and named', wl.warnings.some(w => /Mitered Return/.test(w)), wl.warnings.join(' | '));
        eq('the wall tab\'s narrower columns are read (no plater column)', wl.rows[1].lines.map(l => l.code), ['H1-1R/EP', 'H1-1FR/EP', 'H1-1FRRC/EP', 'H1-1BR/EP']);

        // the layout: two bands on the board, seven poles standing in the 2.5" base, F B F B F B F across
        const lay = seededRowsLayout(tt.rows, { widthIn: 24, heightIn: 24, baseIn: 2.5 });
        const byLabel = Object.fromEntries(lay.map(r => [r.label, r]));
        const baseTop = 2400 - 60 - 250;
        ok('every row inside the face', lay.every(r => r.x >= 0 && r.y >= 0 && r.x + r.w <= 2400 && r.y + r.h <= 2400), JSON.stringify(lay.map(r => [r.label, r.x, r.y, r.w, r.h])));
        eq('front poles stand on the base top; back poles are taller and raised behind', [byLabel['Base Front 1'].y + byLabel['Base Front 1'].h, byLabel['Base Back 1'].y + byLabel['Base Back 1'].h, byLabel['Base Back 1'].h > byLabel['Base Front 1'].h], [baseTop, baseTop - 60, true]);
        ok('poles interleave front / back left to right', byLabel['Base Front 1'].x < byLabel['Base Back 1'].x && byLabel['Base Back 1'].x < byLabel['Base Front 2'].x && byLabel['Base Back 3'].x < byLabel['Base Front 4'].x);
        ok('the two board rows sit above the poles and do not overlap them', byLabel['Top Row 2'].y + byLabel['Top Row 2'].h < byLabel['Base Back 1'].y && byLabel['Top Row 1'].y + byLabel['Top Row 1'].h <= byLabel['Top Row 2'].y);
        eq('a wall board (no base) keeps every row horizontal, full-width bands', seededRowsLayout(wl.rows, { widthIn: 24, heightIn: 30 }).map(r => r.w === Math.round(2400 * 0.84)), [true, true, true, true, true, true]);
        eq('the rows come back in the order given', lay.map(r => r.label), tt.rows.map(r => r.label));
        // the seeded display bills like a cart-built one: boardBom reads the same line shape
        const d = newDisplay({ id: 'T', name: tt.name, style: 'TABLETOP' });
        d.faces[0].rows = lay.map((r, i) => ({ id: `s${i}`, label: r.label, config: { assemblyName: r.label, finishLabel: '', lines: r.lines.map(l => ({ partId: l.code, legacyErpId: l.code, name: l.name, qty: l.qty, perFoot: l.perFoot, feet: l.feet, cutLength: l.cutLength, finishCode: l.finishCode })) } }));
        d.extras = tt.extras;
        const bom = orderBom(boardBom(d, []), 50);
        eq('fifty boards need fifty bases and fifty boards', bom.extras.map(e => e.qty), [50, 50]);
        eq('fifty boards: 100 vertical backplates, 50 rings, 100 ft of EP4 rod — the tracker\'s numbers', [bom.parts.find(p => p.code === 'H1-1FRVC/EP').qty, bom.parts.find(p => p.code === 'H1-1BR/EP').qty, bom.parts.find(p => p.code === 'H1-1R/EP' && p.finishCode === 'EP4').feet], [150, 50, 100]);
    }
}

// ── 8. CHIPS FOLLOW THE FLOW'S TAGGED FINISHES ───────────────────────────────────────────────
{
    const finishes = [
        { id: 'FIN-1', code: 'P06', name: 'Gild Gold' }, { id: 'FIN-2', code: 'P30', name: 'Silver' }, { id: 'FIN-3', code: 'S04', name: 'Natural Oak' },
        { id: 'OUT-1', code: 'EP4', name: 'Satin Gold', outsourced: true }, { id: 'OUT-2', code: 'EP2', name: 'Polished Nickel', outsourced: true },
    ];
    const flow = { id: 'F-H1', name: 'H1-138 — GENERATED', defaultFinishOptions: ['FIN-1', 'ep4'], steps: [{ finishAllowedOptions: ['FIN-3'], styleOptions: [{ finishAllowedOptions: ['fin-2'] }] }] };
    eq('the flow\'s keys: defaults + step + option options, upper-cased, by id or code', [...flowFinishKeys(flow)].sort(), ['EP4', 'FIN-1', 'FIN-2', 'FIN-3']);
    const d = newDisplay({ id: 'D', style: 'TABLETOP' });
    const all = chipsForDisplay(d, finishes, [flow]);
    eq('no flow picked → every finish, and it says so', [all.chips.length, all.restricted], [5, false]);
    d.finishFlowId = 'F-H1';
    const some = chipsForDisplay(d, finishes, [flow]);
    eq('the flow picked → only its four (id match FIN-1/2/3, code match EP4); EP2 is not on the flow', [some.chips.map(c => c.code), some.restricted, some.flow.id], [['EP4', 'P06', 'P30', 'S04'], true, 'F-H1']);
    eq('the bill\'s chip count follows the flow too', boardBom(d, finishes, [flow]).chips.length, 4);
    eq('an unknown flow id → nothing restricted (all), not zero chips', chipsForDisplay({ ...d, finishFlowId: 'gone' }, finishes, [flow]).chips.length, 5);
    eq('a flow with nothing tagged → all', chipsForDisplay(d, finishes, [{ id: 'F-H1', steps: [] }]).restricted, false);
    eq('a tabletop is born with its two parts, a wall board with its two boards', [newDisplay({ id: 'a', style: 'TABLETOP' }).extras.length, newDisplay({ id: 'b', style: 'WALL' }).extras.map(e => e.text.split(' — ')[0])], [2, ['Product board', 'Chip board']]);
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
