// Harness for Shared/displayBom.js — the bill of a sales display board.
//   node scripts/displayBom.test.mjs
import { newDisplay, chipLines, chipGroupOf, chipFaceLayout, rowBomLines, boardBom, orderBom, bomCsv, rowConfigFromCartItem, UNITS_PER_INCH } from '../src/components/Shared/displayBom.js';

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

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
