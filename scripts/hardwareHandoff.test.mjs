// The downstream contract, pinned. These assertions are the six consumers' requirements written
// down: if a field named here disappears, a floor, a push or a document silently loses a fact.
import { readFileSync } from 'fs';
import { classifyLine, isDisplayOnlyLine, DIVISION_SMALL, DIVISION_CUSTOM } from '../src/components/Shared/lineClassification.js';

const src = (f) => readFileSync(new URL(`../src/components/Shared/${f}`, import.meta.url), 'utf8');
const mod = async (f) => import(`data:text/javascript;base64,${Buffer.from(
    src(f).replace(/from '\.\/([\w.]+)\.js'/g, (m, n) => `from '${new URL(`../src/components/Shared/${n}.js`, import.meta.url)}'`)
).toString('base64')}`);

const { handoffItem, customerLines, productionLines } = await mod('hardwareHandoff.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.error('  ✗', name); } };

// A configuration with one visible part, one hidden part and one fee.
const parts = {
    'H1-138R': { id: 'p1', legacyErpId: 'H1-138R', itemName: '1-3/8" Rod', manufacturingSpecs: { basePrice: 9, partHandling: 'Custom Fabrication' } },
    'H1-138STDOFF': { id: 'p2', legacyErpId: 'H1-138STDOFF', itemName: 'Standoff', manufacturingSpecs: { basePrice: 2, partHandling: 'Small Parts' } },
    'CE-FEE-4594': { id: 'p3', legacyErpId: 'CE-FEE-4594', itemName: 'FRENCH RETURN', manufacturingSpecs: { basePrice: 35 } },
};
const findPart = (id) => parts[String(id || '').toUpperCase()] || null;
const resolved = { bom: [
    { partId: 'H1-138R', name: '1-3/8" Rod', qty: 1, role: 'ROD' },
    { partId: 'H1-138STDOFF', name: 'Standoff', qty: 2, hidden: true, role: 'ACCESSORY' },
    { partId: 'CE-FEE-4594', name: 'FRENCH RETURN', qty: 1, role: 'RETURN' },
] };

const item = handoffItem(resolved, {
    findPart, assembly: { id: 'A1', itemName: 'H1-138' }, flow: { id: 'F1', name: 'H1-138 flow' },
    sidemark: 'Living Room 1', finishes: [{ code: 'P07', name: 'Gold Brass' }], finishLabel: 'Gold Brass (P07)',
    priceLevel: 'STANDARD', lengthInches: 96.5, lengthFeet: 9,
    extras: [{ code: 'H1-138R', qty: '1', note: 'splice at 48"' }],
    // The traverse step's answer, in the shape the configurator hands over.
    trvComponents: [
        { code: 'HTRF80-500', qty: 34, rate: 0.5, billable: false, why: 'chart at 9ft' },
        { code: 'HSOM-19', qty: 1, rate: 78, billable: true, why: 'accessory' },
    ],
});

// ── the cart item every consumer reads ───────────────────────────────────────────────────────
ok('carries the assembly', item.assemblyId === 'A1' && item.assemblyName === 'H1-138');
ok('carries the flow', item.flowId === 'F1');
ok('sidemark survives', item.sidemark === 'Living Room 1');
ok('finish label for RTG', item.finishLabel === 'Gold Brass (P07)' && item.finishes.length === 1);
ok('total is money', item.pricing.finalPrice > 0);
ok('names its engine', item.engine === 'TAGS');
ok('config kept for reopen', item.engineConfig.lengthFeet === 9 && item.engineConfig.lengthInches === 96.5);

// ── the lines the floors classify ────────────────────────────────────────────────────────────
const b = item.pricingBreakdown;
ok('every line carries OUR number', b.every(l => !!l.legacyErpId));
ok('every line carries qty and total', b.every(l => l.qty >= 1 && typeof l.total === 'number'));
ok('no line reads as a display echo', b.every(l => !isDisplayOnlyLine(l)));
ok('rod routes to the shop floor', classifyLine(b.find(l => l.legacyErpId === 'H1-138R'), findPart('H1-138R')) === DIVISION_CUSTOM);
ok('standoff routes to finishing', classifyLine(b.find(l => l.legacyErpId === 'H1-138STDOFF'), findPart('H1-138STDOFF')) === DIVISION_SMALL);

// ── hidden: on the BOM, off the quote ────────────────────────────────────────────────────────
ok('hidden part IS in the production list', productionLines(b).some(l => l.legacyErpId === 'H1-138STDOFF'));
ok('hidden part is NOT on the customer list', !customerLines(b).some(l => l.legacyErpId === 'H1-138STDOFF'));
ok('hidden part is still billed', item.pricing.finalPrice >= 9 + 2 * 2);

// ── added by hand ────────────────────────────────────────────────────────────────────────────
const splice = b.find(l => l.addedByHand);
ok('add-by-hand line exists', !!splice);
ok('its note rides to the floor', splice?.customNote === 'splice at 48"');
ok('it routes like any other line', classifyLine(splice, findPart('H1-138R')) === DIVISION_CUSTOM);

// ── traverse components (Stuart 2026-08-21: asked at the last step, not at checkout) ─────────
// Where they are ASKED moved; what the cart carries did not. The push reads item.trvComponents and
// the documents read the breakdown rows, so both have to survive the handoff.
ok('the components ride the item for the push', item.trvComponents.length === 2);
const inc = b.find(l => l.legacyErpId === 'HTRF80-500');
const bill = b.find(l => l.legacyErpId === 'HSOM-19');
ok('an included component is on the list', !!inc && inc.qty === 34);
ok('…and it is not charged for', inc?.total === 0);
ok('a billable accessory is charged', bill?.total === 78);
ok('both route as small parts', inc?.partHandling === 'Small Parts' && bill?.partHandling === 'Small Parts');
ok('the billable is in the money', item.pricing.finalPrice >= 78);

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
