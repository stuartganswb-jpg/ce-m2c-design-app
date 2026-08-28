// The downstream contract, pinned. These assertions are the six consumers' requirements written
// down: if a field named here disappears, a floor, a push or a document silently loses a fact.
import { readFileSync } from 'fs';
import { classifyLine, isDisplayOnlyLine, DIVISION_SMALL, DIVISION_CUSTOM, customerDocLines } from '../src/components/Shared/lineClassification.js';

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
    // The configurator's price context travels with the item, finish included — that is what the
    // lines are priced AND finished off.
    finishCode: 'P07',
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

// ── AND IT BILLS WHAT THE PANEL SHOWED (Stuart 2026-08-28: the joiner "displays the correct
// pricing on the cpq, but once past the cpq … on the doc's it shows $0 and in the bom it is not
// there, does not push to floor or netsuite"). The panel's own priced extraLines travel in ctx
// and are used verbatim — money, THEIR sku, and the doc id every downstream join expects.
{
    const it2 = handoffItem(resolved, {
        findPart, assembly: { id: 'A1', itemName: 'H1-138' }, flow: { id: 'F1' },
        finishes: [], extras: [{ code: 'H1-138JNR', qty: '1', note: 'center' }],
        extraLines: [{ partId: 'H1-138JNR', name: 'Joiner for 16-Gauge 1" Round Rod', qty: 1, unit: 14, total: 14, sku: 'FAB-JNR-1', finishCode: '' }],
    });
    const jn = (it2.pricingBreakdown || []).find(l => l.addedByHand);
    ok('⚠ the extra bills the PANEL price, never $0', jn?.price === 14 && jn?.total === 14);
    ok('…carries THEIR sku', jn?.clientSku === 'FAB-JNR-1');
    ok('…and joins by our code for the push', jn?.legacyErpId === 'H1-138JNR');
    ok('…and its note still rides', jn?.customNote === 'center');
}

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

// ── THE FINISH REACHES FINISHING PER LINE (Stuart 2026-08-21) ────────────────────────────────
// "of course in the bom to send along to finishing … in case people do choose different finishes
// for different parts." The item-level label still says what the configuration is; a line with an
// exception on it cannot be sprayed off that label, so each line says what IT wears.
{
    const finished = b.filter(l => l.finishCode);
    ok('lines carry their own finish code', finished.length > 0);
    ok('…and the name the floor reads, not just the code', finished.every(l => !!l.finishLabel));
    ok('the code is the one that was chosen', finished.every(l => l.finishCode === 'P07'));
    ok('and it resolves to the finish name', finished.every(l => l.finishLabel === 'Gold Brass'));
}

// ── THE CART MUST BILL WHAT THE PANEL SHOWED (Stuart 2026-08-22) ─────────────────────────────
// handoffItem prices the configuration AGAIN, independently of the configurator's own panel. A
// kit-seeded order re-shaped only on screen would put one number in front of the customer and a
// different one on the quote, the sales order and the NetSuite push. `ctx.kit` is the fix, and
// this is the assertion that keeps the two paths honest.
{
    const baseCtx = {
        findPart, assembly: { id: 'A1', itemName: 'H1-2TRV' }, flow: { id: 'F1', name: 'trv' },
        sidemark: 'Living Room 1', priceLevel: 'STANDARD', lengthInches: 120, lengthFeet: 10,
        billedFeet: 10, finishCode: 'P07', finishes: [],
    };
    const kit = { kitCode: 'H1-2TRV-4/EP', kitName: '2in wall mount', kitPrice: 318, baseFeet: 4 };
    const withKit = handoffItem(resolved, { ...baseCtx, kit });
    const noKit = handoffItem(resolved, baseCtx);

    ok('the kit rides the cart item, not just the screen',
        (withKit.pricingBreakdown || []).some(l => l.legacyErpId === 'H1-2TRV-4/EP'));
    ok('and it moves the money the customer is quoted',
        withKit.pricing.finalPrice !== noKit.pricing.finalPrice);
    ok('the kit line carries our number, so the paperwork can print it',
        (withKit.pricingBreakdown || []).some(l => l.legacyErpId === 'H1-2TRV-4/EP' && l.total === 318));
    ok('a configuration with no kit is byte-identical to before',
        JSON.stringify(noKit.pricingBreakdown) === JSON.stringify(handoffItem(resolved, baseCtx).pricingBreakdown));
}

// ── THE TRACK'S INSTRUCTIONS REACH THE ORDER (Stuart 2026-08-22) ─────────────────────────────
// The draw and the motor side are neither parts nor money, so nothing else on the item would carry
// them — and a track assembled to the wrong draw opens away from the room.
{
    const base = { findPart, assembly: { id: 'A1', itemName: 'H1-2TRV' }, flow: { id: 'F1', name: 'trv' }, priceLevel: 'STANDARD' };
    const withDraw = handoffItem(resolved, { ...base, traverseDraw: 'RIGHT', traverseMotorSide: 'LEFT' });
    ok('the draw rides the order', withDraw.traverseDraw === 'RIGHT');
    ok('and so does the motor side', withDraw.traverseMotorSide === 'LEFT');
    const none = handoffItem(resolved, base);
    ok('a pole order carries neither', !('traverseDraw' in none) && !('traverseMotorSide' in none));
}

// ── A POLE IS SOLD BY THE FOOT AND SHIPPED AS ONE PIECE (Stuart 2026-08-25, first Brimar
// orders) ────────────────────────────────────────────────────────────────────────────────────
// The engine pins a per-foot line's qty at 1 and multiplies the money by the feet — so the line
// MUST carry perFoot/feet or every downstream reader sees {qty:1, price:9, total:72} and cannot
// tell 8 ft was billed: the quote doc printed "1 × $9.00 = $72.00" and the NetSuite push sent
// qty 1, with $63 of pole riding the rollup as labor.
{
    const ctx = {
        findPart, assembly: { id: 'A1', itemName: 'H1-138' }, flow: { id: 'F1', name: 'flow' },
        priceLevel: 'STANDARD', lengthInches: 96, lengthFeet: 8, billedFeet: 8,
    };
    const it = handoffItem(resolved, ctx);
    const pole = (it.pricingBreakdown || []).find(l => l.legacyErpId === 'H1-138R' && !l.addedByHand);
    ok('a rod line billed by the foot says so', !!pole && pole.perFoot === true && pole.feet === 8);
    ok('its qty stays one pole and the feet multiply the money',
        !!pole && pole.qty === 1 && pole.total === pole.price * 8);
    ok('the cut travels for the bench', !!pole && pole.cutLength === 96);
    ok('a money document quantifies it in feet, so qty × unit = amount',
        customerDocLines(it.pricingBreakdown, 'QUOTE').find(l => l.legacyErpId === 'H1-138R' && !l.addedByHand)?.qty === 8);
    ok('a physical document keeps one piece with the cut',
        customerDocLines(it.pricingBreakdown, 'WORK_ORDER').find(l => l.legacyErpId === 'H1-138R' && !l.addedByHand)?.qty === 1);
    // No length answered → nothing is per-foot and nothing changes shape.
    const noLen = handoffItem(resolved, { findPart, assembly: ctx.assembly, flow: ctx.flow, priceLevel: 'STANDARD' });
    ok('a line with no length is not per-foot',
        !(noLen.pricingBreakdown || []).some(l => l.perFoot));
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
