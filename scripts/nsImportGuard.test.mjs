// 🔒 NetSuite never overwrites the sales side (Stuart 2026-09-30).   node scripts/nsImportGuard.test.mjs
import { guardImportSpecs, diffRecordOf, takeNetSuitePatch, sameValue, APP_OWNED_SPECS } from '../src/components/Shared/nsImportGuard.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

// An existing item the app has curated, and what NetSuite sends on the next import.
const app = { basePrice: 12, uom: 'EA', partHandling: 'Small Parts', outsourceAction: '', productType: 'FEE', cost: 3, binLocation: 'A-1', isStocked: false };
const ns = { basePrice: 25, uom: 'FT', partHandling: 'Custom', outsourceAction: 'Plated', productType: 'Hardware', cost: 4.5, binLocation: 'B-2', isStocked: true, vendorName: 'Acme' };

let g = guardImportSpecs(app, ns, { nsProductType: 'Hardware' });
eq('app-owned fields the app has are never written', APP_OWNED_SPECS.filter(k => k in g.specs), ['outsourceAction']);
eq('…a blank app field is filled (nothing to protect)', g.specs.outsourceAction, 'Plated');
eq('NetSuite-owned fields and the flags still come in', [g.specs.cost, g.specs.binLocation, g.specs.isStocked, g.specs.vendorName], [4.5, 'B-2', true, 'Acme']);
eq('price, unit and category differences are reported', g.differences.map(d => [d.field, d.app, d.ns]), [['basePrice', 12, 25], ['uom', 'EA', 'FT'], ['productType', 'FEE', 'Hardware']]);
ok('part handling and outsource action are guesses, never reported', !g.differences.some(d => ['partHandling', 'outsourceAction'].includes(d.field)));

g = guardImportSpecs({ basePrice: '50', uom: 'ea', productType: 'Bracket' }, { basePrice: 50, uom: 'EA' }, { nsProductType: 'bracket' });
eq('the same value in another case or type is no difference', g.differences, []);
g = guardImportSpecs({ basePrice: 12 }, { cost: 1 }, {});
eq('NetSuite sending nothing is no difference (no base price in NetSuite)', g.differences, []);
g = guardImportSpecs({ productType: 'Uncategorized' }, {}, { nsProductType: 'Rod' });
eq('an uncategorised app item is not a difference (the caller fills it)', g.differences, []);
g = guardImportSpecs({}, { basePrice: 9, uom: 'EA', partHandling: 'Custom' }, {});
eq('an item the app never priced takes NetSuite\'s values', [g.specs.basePrice, g.specs.uom, g.specs.partHandling], [9, 'EA', 'Custom']);
ok('a $0 price is a value the app chose — kept', !('basePrice' in guardImportSpecs({ basePrice: 0 }, { basePrice: 40 }).specs));

// ── the 4.5 record ──────────────────────────────────────────────────────────────────────────
const diffs = guardImportSpecs(app, ns, { nsProductType: 'Hardware' }).differences;
let r = diffRecordOf({ docId: 'CE-ASM-8315', code: 'H1-PCKF1', name: 'Pole Pack Standard', differences: diffs, now: 5 });
eq('one record per item, a field per difference', [r.code, Object.keys(r.fields), r.fields.basePrice.ns, r.fields.basePrice.seenAt], ['H1-PCKF1', ['basePrice', 'uom', 'productType'], 25, 5]);
eq('nothing different → no record', diffRecordOf({ docId: 'x', differences: [] }), null);
r = diffRecordOf({ docId: 'x', differences: diffs, prior: { dismissed: { basePrice: '25' }, fields: {} }, now: 7 });
eq('a difference kept at that NetSuite value is not raised again', Object.keys(r.fields), ['uom', 'productType']);
r = diffRecordOf({ docId: 'x', differences: [{ field: 'basePrice', label: 'p', app: 12, ns: 30 }], prior: { dismissed: { basePrice: '25' } }, now: 7 });
eq('…until NetSuite\'s value changes', Object.keys(r.fields), ['basePrice']);
r = diffRecordOf({ docId: 'x', differences: [{ field: 'uom', label: 'u', app: 'EA', ns: 'FT' }], prior: { fields: { uom: { ns: 'FT', seenAt: 2 } } }, now: 9 });
eq('first-seen time carries over while NetSuite says the same', r.fields.uom.seenAt, 2);
r = diffRecordOf({ docId: 'x', differences: [], prior: { dismissed: { basePrice: '25' }, fields: { uom: {} } }, now: 9 });
eq('resolved differences clear, the kept ones are remembered', [r.fields, r.dismissed], [{}, { basePrice: '25' }]);

// ── "use NetSuite's" writes the way 4.5 writes ──────────────────────────────────────────────
eq('price as a number', takeNetSuitePatch('basePrice', '25'), { 'manufacturingSpecs.basePrice': 25 });
eq('category on both places 4.5 keeps it', takeNetSuitePatch('productType', 'Rod'), { productType: 'Rod', 'manufacturingSpecs.productType': 'Rod' });
eq('unit on the specs', takeNetSuitePatch('uom', 'FT'), { 'manufacturingSpecs.uom': 'FT' });
ok('money compares to the cent', sameValue('basePrice', 12.001, '12') && !sameValue('basePrice', 12, 12.5));

console.log(`nsImportGuard: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
