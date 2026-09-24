// The fabric sheet reader + planner, pinned (S7, 2026-09-24): the template's own example rows are
// refused by prefix, a real row reads, the refusals name the row and code, and the plan against the
// library says CREATE / UPDATE / SKIP with the exact fields — base price and the NetSuite id never
// touched unless typed.
import {
    FABRIC_COLS, EXAMPLE_ROWS, findFabricSheet, parseFabricSheet, planFabricRows, fabricFieldsOf,
    fabricUpdatePatchOf, fabricCreateDocOf, fabricPlanSummary, newFabricItemId, PRODUCT_TYPE_OF,
} from '../src/components/Shared/pillowFabricSheet.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; } else { fail++; console.error('  ✗', name, extra); } };

const header = FABRIC_COLS.map(c => c.header);
const grid = (rows) => [header, ...rows];
const sheetsOf = (rows, name = 'Fabrics') => [{ name: 'How to fill', grid: [['Column', 'Rule']] }, { name, grid: grid(rows) }];
const GROUPS = ['A', 'B', 'C', 'D', 'E'];
const R = {
    savery: ['SAVERY-NAT', 'Savery Natural linen 54"', 'FABRIC', 'A', 54, 'FALSE', 'SAVERY', 'Natural', 28, '', 'Uniq Fabric', 'F-01', 'TRUE', '', 'group A'],
    naka: ['NAKA10-FAB', 'Naka 10 fabric yardage', 'fabric', 'c', '40', 'true', 'NAKA', '10', '$45.00', 'NAKA10-THROW', 'Uniq Throws', 'f-04', '', '', ''],
    fringe: ['BRUSH-FRINGE-IVY', 'Brush fringe ivory 2"', 'TRIM', '', '', '', 'BF-2', 'Ivory', 6.5, '', 'Romo Trim', 'T-02', 'TRUE', '', 'per yard'],
};

// ── reading ──────────────────────────────────────────────────────────────────────────────────
ok('the Fabrics sheet is found past the How-to sheet', findFabricSheet(sheetsOf([R.savery])).sheet.name === 'Fabrics');
ok('a workbook with no fabric header refuses', parseFabricSheet([{ name: 'x', grid: [['a']] }]).errors[0].code === 'NO_SHEET');
const p = parseFabricSheet(sheetsOf([R.savery, R.naka, R.fringe]), { groups: GROUPS });
ok('three rows read clean', p.ok && p.rows.length === 3, JSON.stringify(p.errors));
const naka = p.rows[1];
ok('case, $ and TRUE tolerated: naka reads FABRIC / C / 40 / railroad / cost 45 / bin F-04', naka.type === 'FABRIC' && naka.priceGroup === 'C' && naka.width === 40 && naka.railroad === true && naka.cost === 45 && naka.homeBin === 'F-04');
ok('stocked defaults TRUE, railroad defaults FALSE', naka.stocked === true && p.rows[0].railroad === false);
ok('a TRIM carries no group and no width', p.rows[2].priceGroup === '' && p.rows[2].width === null);
ok('row numbers are the sheet\'s (header = row 1)', p.rows[0].rowNo === 2 && p.rows[2].rowNo === 4);
ok('the template\'s example rows are refused by prefix, every one', (() => { const e = parseFabricSheet(sheetsOf(EXAMPLE_ROWS), { groups: GROUPS }); return !e.ok && e.errors.length === 3 && e.errors.every(x => x.code === 'EXAMPLE_ROW'); })());
ok('the example rows carry every column', EXAMPLE_ROWS.every(r => r.length === FABRIC_COLS.length));

// ── refusals ─────────────────────────────────────────────────────────────────────────────────
const codes = (rows) => parseFabricSheet(sheetsOf(rows), { groups: GROUPS }).errors.map(e => e.code);
ok('no code refuses', codes([['', 'x', 'FABRIC', 'A', 54]]).includes('CODE_MISSING'));
ok('a code twice refuses', codes([R.savery, R.savery]).includes('CODE_DUPLICATE'));
ok('a type outside FABRIC / TRIM refuses (PANEL is not an item)', codes([['X', 'x', 'PANEL', 'A', 54]]).includes('TYPE_UNREADABLE'));
ok('a FABRIC with no group refuses', codes([['X', 'x', 'FABRIC', '', 54]]).includes('GROUP_MISSING'));
ok('a group outside the live table refuses and names the table', (() => { const e = parseFabricSheet(sheetsOf([['X', 'x', 'FABRIC', 'Q', 54]]), { groups: GROUPS }).errors[0]; return e.code === 'GROUP_UNKNOWN' && /A, B, C, D, E/.test(e.message) && /row 2 \(X\)/.test(e.message); })());
ok('no live groups yet → any group passes the reader (the table gate is the screen\'s)', parseFabricSheet(sheetsOf([['X', 'x', 'FABRIC', 'Q', 54]]), { groups: [] }).ok);
ok('a FABRIC with no width refuses', codes([['X', 'x', 'FABRIC', 'A', '']]).includes('WIDTH_MISSING'));
ok('a cost that is not a number refuses', codes([['X', 'x', 'FABRIC', 'A', 54, '', '', '', 'call']]).includes('COST_NOT_A_NUMBER'));
ok('Railroad "maybe" refuses', codes([['X', 'x', 'FABRIC', 'A', 54, 'maybe']]).includes('RAILROAD_UNREADABLE'));
ok('an empty sheet refuses', codes([]).includes('NO_ROWS'));
ok('a header missing Price Group refuses by name', (() => { const g = [header.filter(h => h !== 'Price Group'), ['X', 'x', 'FABRIC']]; const e = parseFabricSheet([{ name: 'Fabrics', grid: g }]).errors[0]; return e.code === 'HEADER_MISSING' && /Price Group/.test(e.message); })());
ok('a trim with a group is a warning, not a refusal', (() => { const r = parseFabricSheet(sheetsOf([['T', 'trim', 'TRIM', 'A']]), { groups: GROUPS }); return r.ok && r.warnings.length === 1; })());

// ── the plan against the library ─────────────────────────────────────────────────────────────
const items = [
    { id: 'u1', legacyErpId: 'SAVERY-NAT', itemId: 'u1', itemName: 'SAVERY NATURAL', manufacturingSpecs: { productType: 'Fabric', priceGroup: 'A', width: 54, uom: 'RY', isStocked: true, basePrice: 60, customData: { railroad: false } }, netSuiteInternalId: '77001' },
    { id: 'u2', legacyErpId: 'Naka10-Fab', itemId: 'u2', itemName: 'Naka 10 throw yardage', manufacturingSpecs: { productType: 'Pillow', basePrice: 500, isStocked: true } },
];
const plans = planFabricRows(p.rows, items);
ok('savery matches by code (case-insensitive) and only the changed fields are listed', plans[0].action === 'UPDATE' && plans[0].changes.map(c => c.path).join() === 'itemName,manufacturingSpecs.cost,manufacturingSpecs.vendorName,manufacturingSpecs.homeBin,manufacturingSpecs.customData.patternId,manufacturingSpecs.customData.color,manufacturingSpecs.customData.importNotes', plans[0].changes.map(c => c.path).join());
ok('a matching value is never a change (group A, width 54, RY, stocked, railroad false)', !plans[0].changes.some(c => /priceGroup|width|uom|isStocked|railroad/.test(c.path)));
ok('the NetSuite id is untouched when the sheet leaves it blank', !plans[0].changes.some(c => c.path === 'netSuiteInternalId'));
ok('base price is never on the plan', !plans.some(pl => pl.changes.some(c => /basePrice/.test(c.path))));
ok('naka matches an item that WAS a Pillow — updated, and the plan says what it was', plans[1].action === 'UPDATE' && plans[1].was === 'PILLOW' && plans[1].changes.some(c => c.path === 'manufacturingSpecs.productType' && c.to === 'FABRIC'));
ok('naka gains group C, width 40, railroad, converted-from', ['manufacturingSpecs.priceGroup', 'manufacturingSpecs.width', 'manufacturingSpecs.customData.railroad', 'manufacturingSpecs.customData.convertedFrom'].every(path => plans[1].changes.some(c => c.path === path)));
ok('the fringe is a CREATE', plans[2].action === 'CREATE' && plans[2].item === null);
ok('the summary counts', JSON.stringify(fabricPlanSummary(plans)) === JSON.stringify({ CREATE: 1, UPDATE: 2, SKIP: 0 }));
const again = planFabricRows(p.rows, [{ ...items[0], ...{ itemName: 'Savery Natural linen 54"', manufacturingSpecs: { ...items[0].manufacturingSpecs, cost: 28, vendorName: 'Uniq Fabric', homeBin: 'F-01', customData: { railroad: false, patternId: 'SAVERY', color: 'Natural', importNotes: 'group A' } } } }]);
ok('re-importing an unchanged row is a SKIP', again[0].action === 'SKIP' && again[0].changes.length === 0);

// ── the writes ───────────────────────────────────────────────────────────────────────────────
const patch = fabricUpdatePatchOf(plans[1], { by: 'stuart', at: 1000 });
ok('the update patch is dot-pathed, stamped, and carries only the changes', patch['manufacturingSpecs.productType'] === 'FABRIC' && patch['manufacturingSpecs.width'] === 40 && patch.fabricSheetBy === 'stuart' && patch.updatedAt === 1000 && !('manufacturingSpecs.basePrice' in patch));
const created = fabricCreateDocOf(p.rows[2], { id: 'UNIQUITY-INV-1-0', by: 'stuart', at: 1000 });
ok('a created trim = the Item Starter shape, brand uniquity, TRIMMING by the yard, no group', created.brandId === 'uniquity' && created.partClass === 'Inventory' && created.legacyErpId === 'BRUSH-FRINGE-IVY' && created.manufacturingSpecs.productType === 'TRIMMING' && created.manufacturingSpecs.uom === 'RY' && created.manufacturingSpecs.priceGroup === undefined && created.manufacturingSpecs.cost === 6.5 && created.manufacturingSpecs.customData.railroad === false);
const cf = fabricCreateDocOf(p.rows[1], { id: 'X', at: 1 });
ok('a created fabric carries group, width, railroad, converted-from, pattern, colour', cf.manufacturingSpecs.priceGroup === 'C' && cf.manufacturingSpecs.width === 40 && cf.manufacturingSpecs.customData.railroad === true && cf.manufacturingSpecs.customData.convertedFrom === 'NAKA10-THROW' && cf.manufacturingSpecs.customData.patternId === 'NAKA' && cf.manufacturingSpecs.customData.color === '10');
ok('no NetSuite id on a create unless typed', !('netSuiteInternalId' in cf) && 'netSuiteInternalId' in fabricCreateDocOf({ ...p.rows[1], nsId: '9' }, { id: 'X' }));
ok('new ids follow the brand-INV-stamp-index shape', /^UNIQUITY-INV-\d+-3$/.test(newFabricItemId('uniquity', 3)));
ok('fabricFieldsOf maps FABRIC → FABRIC and TRIM → TRIMMING', fabricFieldsOf(p.rows[0])['manufacturingSpecs.productType'] === PRODUCT_TYPE_OF.FABRIC && fabricFieldsOf(p.rows[2])['manufacturingSpecs.productType'] === 'TRIMMING');

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
