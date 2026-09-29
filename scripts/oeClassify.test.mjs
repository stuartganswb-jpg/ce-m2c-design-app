// node scripts/oeClassify.test.mjs — ONE CLASSIFIER FOR EVERY DOOR (Stuart 2026-09-27, SO60551): the Order Entry
// route and 10.5's rows decide shop-or-small with CPQ's own classifyLine, read a row's cut facts off its own fees,
// and give a rider (and a custom line quoted with no finish) its rod's finish.
import { fabKindOf, rowFabOf, oeDivisionOf, rowFinishesOf, isFeePart, DIVISION_CUSTOM, DIVISION_SMALL } from '../src/components/Shared/oeClassify.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) pass++; else { fail++; console.log(`✗ ${n}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`); } };
const P = (code, specs = {}, more = {}) => ({ id: code, legacyErpId: code, itemName: code, partClass: 'Inventory', manufacturingSpecs: specs, ...more });

// ── what a fee names ──
eq('a French return is a bend', fabKindOf('French Return H1-FRPF'), 'bend');
eq('a traverse miter is a miter', fabKindOf('Traverse Miter H1-2TRVMTR/EP4'), 'miter');
eq('a mitered return is a miter return', fabKindOf('Mitered Return'), 'miterReturn');
eq('a splice is a splice', fabKindOf('Splice Fee'), 'splice');
eq('a rush fee is not fabrication', fabKindOf('Rush Fee'), '');

// ── a row's cut facts are its own fees ──
const fee = P('H1-2TRVMTR', { productType: 'FEE' }, { partClass: 'Fee', itemName: 'Traverse Miter' });
eq('the row\'s miters counted from its fee lines only', rowFabOf([{ line: { qty: 50 }, part: fee }, { line: { qty: 50 }, part: fee }, { line: { qty: 50 }, part: P('H1-2TRV', { productType: 'POLE' }) }]).qtyMiters, 100);
eq('a flagged fee with no library record counts too', rowFabOf([{ line: { isFee: true, name: 'Bend fee', qty: 1 }, part: null }]).qtyBends, 1);

// ── shop or small — CPQ's classifyLine ──
const frpf = P('H1-FRPF', { productType: 'FEE' }, { partClass: 'Fee' });
eq('a Fee item is custom and RIDES (no cut, not a pole)', oeDivisionOf({ line: { erp: 'H1-FRPF', finishCode: 'EP4', qty: 50 }, basePart: frpf, erp: 'H1-FRPF', finish: 'EP4' }), { division: DIVISION_CUSTOM, rider: true, pole: false, fee: true });
const rod = P('H1-1R', { productType: 'RODS', partHandling: 'Custom', material: 'STEEL' });
eq('a steel rod plated → custom pole (the finish suffix rule for a SKU with no record)', oeDivisionOf({ line: { cutLength: 18 }, basePart: rod, erp: 'H1-1R', finish: 'EP4' }), { division: DIVISION_CUSTOM, rider: false, pole: true, fee: false });
eq('…in /BS it is a small part', oeDivisionOf({ line: { cutLength: 18 }, basePart: rod, erp: 'H1-1R', finish: 'BS' }).division, DIVISION_SMALL);
const oak = P('H1-2RCTWR-O', { productType: 'POLE', partHandling: 'Custom', material: 'WOOD' });
eq('a wood rod in a row with miters is custom (cut)', oeDivisionOf({ line: { cutLength: 30 }, basePart: oak, erp: 'H1-2RCTWR-O', finish: 'S04', fab: { qtyMiters: 2 } }).division, DIVISION_CUSTOM);
// A STRAIGHT ROD CUT TO A LENGTH IS THE SHOP'S (Stuart 2026-09-28, choice A — SO60551 Back Base 2's oak rod, 50 × 9.25", was
// picked whole with nothing to cut it): the shop cuts, finishing stains. Only a straight rod with no cut — a stocked length
// sold whole — is finishing's pick.
eq('a straight wood rod CUT to a length is custom (the shop cuts it, finishing stains it)', oeDivisionOf({ line: { cutLength: 9.25 }, basePart: oak, erp: 'H1-138WR-O', finish: 'S08', fab: {} }).division, DIVISION_CUSTOM);
eq('…and it is a pole, not a rider', [oeDivisionOf({ line: { cutLength: 9.25 }, basePart: oak, erp: 'H1-138WR-O', finish: 'S08', fab: {} }).pole, oeDivisionOf({ line: { cutLength: 9.25 }, basePart: oak, erp: 'H1-138WR-O', finish: 'S08', fab: {} }).rider], [true, false]);
eq('a straight wood rod with NO cut (a stocked length sold whole) is small (finishing)', oeDivisionOf({ line: {}, basePart: oak, erp: 'H1-2RCTWR-O', finish: 'S04', fab: {} }).division, DIVISION_SMALL);
const cap = P('H1-1CP-V'), capEp4 = P('H1-1CP-V/EP4', {}, { partClass: 'Assembly' });
eq('a plated finial with a finished record → small', oeDivisionOf({ line: {}, basePart: cap, finishedPart: capEp4, erp: 'H1-1CP-V', finish: 'EP4' }).division, DIVISION_SMALL);
eq('the operator\'s override on the line wins', oeDivisionOf({ line: { customOverrideHandling: 'Custom' }, basePart: cap, finishedPart: capEp4, erp: 'H1-1CP-V', finish: 'EP4' }).division, DIVISION_CUSTOM);
eq('isFeePart reads the class and the product type', [isFeePart(frpf), isFeePart(P('X', { productType: 'FEE' })), isFeePart(cap)], [true, true, false]);

// ── the finish a line takes ──
const row2 = [
    { lineIdx: 0, ownFinish: 'S04', division: DIVISION_CUSTOM, rider: false },            // the oak fascia
    { lineIdx: 1, ownFinish: 'TCP', division: DIVISION_CUSTOM, rider: false, sub: true },  // the track, in the sub finish (Shared/subFinish)
    { lineIdx: 2, ownFinish: 'EP4', division: DIVISION_CUSTOM, rider: true },               // the miter, EP4 on the 9/16 quote
    { lineIdx: 3, ownFinish: 'EP4', division: DIVISION_SMALL, rider: false },               // a plated wall bracket
];
const f = rowFinishesOf(row2);
eq('the fascia keeps S04; the track keeps its sub finish TCP; the miter takes the rod\'s S04; the bracket keeps EP4', [f[0].finish, f[1].finish, f[2].finish, f[3].finish], ['S04', 'TCP', 'S04', 'EP4']);
eq('…and say where it came from', [f[1].source, f[2].source], ['sub', 'rod']);
eq('the track\'s sub finish is never the rod the miter follows', rowFinishesOf([{ lineIdx: 0, ownFinish: 'TCP', division: DIVISION_CUSTOM, sub: true }, { lineIdx: 1, ownFinish: 'EP4', division: DIVISION_CUSTOM, rider: true }])[1].finish, '');
const two = rowFinishesOf([{ lineIdx: 0, ownFinish: 'S04', division: DIVISION_CUSTOM }, { lineIdx: 1, ownFinish: 'P06', division: DIVISION_CUSTOM }, { lineIdx: 2, ownFinish: '', division: DIVISION_CUSTOM, rider: true }]);
eq('two rods in two finishes: a rider with no finish of its own waits for a person', [two[2].finish, /which one/.test(two[2].why)], ['', true]);
const lone = rowFinishesOf([{ lineIdx: 0, ownFinish: '', division: DIVISION_CUSTOM, rider: false }, { lineIdx: 1, ownFinish: 'S04', division: DIVISION_CUSTOM }]);
eq('a custom line quoted with no finish is NEVER given the rod\'s — it wears nothing (UNFINISHED: cut, no finishing)', [lone[0].finish, lone[0].source], ['UNFINISHED', 'unfinished']);
const acr = rowFinishesOf([{ lineIdx: 0, ownFinish: '', division: DIVISION_CUSTOM }, { lineIdx: 1, ownFinish: 'EP1', division: DIVISION_CUSTOM, rider: true }]);
eq('a fee cut into an unfinished rod rides it UNFINISHED', acr[1].finish, 'UNFINISHED');
eq('a small line with no finish is not started (a shelf pick)', rowFinishesOf([{ lineIdx: 0, ownFinish: '', division: DIVISION_SMALL }])[0].finish, '');
eq('the traverse track keeps CPQ\'s Custom handling in its sub finish (not the /C suffix rule)', oeDivisionOf({ line: { cutLength: 17.5 }, basePart: P('H1-2TRV', { productType: 'Pole', partHandling: 'Custom' }), erp: 'H1-2TRV', finish: 'TCP', trvCut: true }).division, DIVISION_CUSTOM);

console.log(`oeClassify: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
