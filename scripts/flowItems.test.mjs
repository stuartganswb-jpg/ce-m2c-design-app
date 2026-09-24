// Harness for Shared/flowItems.js — the 4.7 Flow Stock board's rows.   node scripts/flowItems.test.mjs
//
// The invariant: the board says what the QUOTE says. Every SKU, Fabricut number and price here must
// come back identical to priceChoice at the Fabricut levels, or the board is a second opinion.

import { flowFamilies, flowTabsOf, flowLabelOf, offeredFinishesOf, notCovered } from '../src/components/Shared/flowItems.js';
import { priceChoice } from '../src/components/Shared/hardwarePricing.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };

// ── FIXTURE: a small H1-75 — one arm, one plate, a rod pinned per side, a parked pin ──────────
const assembly = {
    id: 'ASM-75', itemId: 'CE-ASM-75',
    nodeClusters: [
        { id: 'CL-BKT', category: 'BRACKET', position: 'CENTER', nodes: ['bkt'] },
        { id: 'CL-BP', category: 'BACKPLATE', position: 'CENTER', nodes: ['bp'] },
        { id: 'CL-RODL', category: 'POLE', position: 'LEFT', nodes: ['rodL'] },
        { id: 'CL-RODR', category: 'POLE', position: 'RIGHT', nodes: ['rodR'] },
    ],
};
const pins = [
    { id: 'P1', assemblyId: 'ASM-75', clusterId: 'CL-BKT', partId: 'CE-INV-1', partName: 'H1-75DS', projInches: '3-5/8', targetNode: 'bkt' },
    { id: 'P2', assemblyId: 'ASM-75', clusterId: 'CL-BP', partId: 'CE-INV-2', partName: 'H1-75BP-R', targetNode: 'bp' },
    { id: 'P3', assemblyId: 'ASM-75', clusterId: 'CL-RODL', partId: 'H1-75R', partName: 'H1-75R', targetNode: 'rodL' },
    { id: 'P4', assemblyId: 'ASM-75', clusterId: 'CL-RODR', partId: 'H1-75R', partName: 'H1-75R', targetNode: 'rodR' },
    { id: 'P5', assemblyId: 'ASM-75', clusterId: 'CL-BKT', partId: 'HIDDEN-83238', parked: true, targetNode: 'bkt' },
];
const tiers = { paintedCost: 20, paintedWholesale: 40, paintedRetail: 80, platedCost: 28, platedWholesale: 55, platedRetail: 110, fabCodePainted: 'H3500F', fabCodePremium: 'H3500F PREMIUM' };
const parts = [
    { id: 'CE-INV-1', itemId: 'CE-INV-1', legacyErpId: 'H1-75DS', itemName: 'Decorative Bracket 3-5/8', partClass: 'Inventory', netSuiteInternalId: '100', manufacturingSpecs: { fabricut: tiers } },
    { id: 'CE-INV-1P', itemId: 'CE-INV-1P', legacyErpId: 'H1-75DS/P', partClass: 'Assembly', netSuiteInternalId: '101',
      manufacturingSpecs: { fabricut: { cost: 20, wholesale: 40, retail: 80 } },
      clientPricing: [{ customerId: 'CUST-FAB', clientSku: 'H3500F-ROW', price: '19' }] },
    { id: 'CE-INV-1EP1', itemId: 'CE-INV-1EP1', legacyErpId: 'H1-75DS/EP1', partClass: 'Assembly', netSuiteInternalId: '102',
      manufacturingSpecs: { fabricut: { cost: 29, wholesale: 56, retail: 112 } } },
    // no H1-75DS/EP2 record — EP2 bills the mill code
    { id: 'CE-INV-2', itemId: 'CE-INV-2', legacyErpId: 'H1-75BP-R', partClass: 'Inventory', netSuiteInternalId: '200', manufacturingSpecs: { fabricut: { paintedCost: null, fabCodeBase: 'H3600' } } },
    { id: 'CE-INV-2P', itemId: 'CE-INV-2P', legacyErpId: 'H1-75BP-R/P', partClass: 'Assembly', netSuiteInternalId: '201', manufacturingSpecs: { fabricut: { cost: null, wholesale: null, retail: null } } },
    { id: 'H1-75R', itemId: 'H1-75R', legacyErpId: 'H1-75R', partClass: 'Inventory', netSuiteInternalId: '300', manufacturingSpecs: { basePrice: 9, customData: { unfinished: true } } },
    { id: 'JNR', itemId: 'JNR', legacyErpId: 'H1-75R-JNR', itemName: 'Joiner', partClass: 'Inventory', manufacturingSpecs: { basePrice: 4, customData: { unfinished: true } } },
    { id: 'FEE', itemId: 'FEE', legacyErpId: 'CE-FEE-H1FR', itemName: 'French return fee', partClass: 'Fee', manufacturingSpecs: { basePrice: 35 } },
];
const findPart = (key) => parts.find(p => p.id === key || p.itemId === key || p.legacyErpId === key) || null;
const finishes = [
    { code: 'P01', material: 'METAL' }, { code: 'P02' }, { code: 'EP1' }, { code: 'EP2' },
    { code: 'S01', material: 'WOOD' },                   // a stain — metal parts never wear it
];
const priceCtx = { customerId: 'CUST-FAB', customer: { id: 'CUST-FAB', name: 'FABRICUT' }, outsourceCodes: [], findByCode: findPart };
const flow = { id: 'F75', name: 'H1-75 — GENERATED', linkedAssemblyId: 'ASM-75', flowFinishes: [],
    extraItems: [{ code: 'H1-75R-JNR', label: 'Joiner' }, { code: 'CE-FEE-H1FR', label: 'French return' }, { code: 'H1-75R', label: 'dup of a pinned part' }] };

const { sections, skus } = flowFamilies({ flow, assembly, pins, findPart, finishes, priceCtx });
const fam = (code) => sections.flatMap(s => s.families).find(f => f.rows[0].code === code);
const row = (code) => skus.find(r => r.code === code);

// ── FAMILIES ─────────────────────────────────────────────────────────────────────────────────
eq('sections in board order', sections.map(s => s.role), ['ROD', 'BRACKET', 'BACKPLATE', 'EXTRA']);
eq('the rod pinned per side is ONE family', sections.find(s => s.role === 'ROD').families.length, 1);
ok('the parked pin is not offered', !skus.some(r => /HIDDEN/.test(r.code)));
eq('an extra that is already pinned is not listed twice', skus.filter(r => r.code === 'H1-75R').length, 1);

// ── FINISH → SOLD SKU, exactly the quote's resolution ────────────────────────────────────────
eq('bracket family = mill, then /P, then /EP1', fam('H1-75DS').rows.map(r => [r.code, r.kind]), [['H1-75DS', 'MILL'], ['H1-75DS/P', 'VARIANT'], ['H1-75DS/EP1', 'VARIANT']]);
eq('every paint collapses onto /P', row('H1-75DS/P').finishes, ['P01', 'P02']);
eq('a finish with no variant record bills the mill code, and says so', row('H1-75DS').finishes, ['EP2']);
ok('the wood stain never reaches a metal part', !skus.some(r => r.finishes.includes('S01')));
eq('an unfinished part is sold as itself', [row('H1-75R').kind, row('H1-75R').finishes], ['SOLE', []]);

// ── IDENTITY + PRICE COME FROM priceChoice, nothing else ─────────────────────────────────────
const bktChoice = { id: 'P1', partId: 'CE-INV-1', role: 'BRACKET' };
const quote = (fc, lvl) => priceChoice(bktChoice, findPart('CE-INV-1'), { ...priceCtx, finishCode: fc, priceLevel: lvl, levelIsDefault: false });
eq('/P: our price to Fabricut = the quote at Fabricut Cost', row('H1-75DS/P').ourPrice.value, quote('P01', 'FAB_COST').price);
eq('/P: Fabricut sells at = the quote at Fabricut Wholesale', row('H1-75DS/P').theirPrice, quote('P01', 'FAB_WHOLESALE').price);
eq('/P priced from its own tier, not their row', [row('H1-75DS/P').ourPrice.value, row('H1-75DS/P').theirPrice], [20, 40]);
eq('/P Fabricut # = their saved SKU first', row('H1-75DS/P').fabCode, 'H3500F-ROW');
eq('/EP1 Fabricut # = the PREMIUM code from the base', row('H1-75DS/EP1').fabCode, 'H3500F PREMIUM');
eq('/EP1 priced from its own record', [row('H1-75DS/EP1').ourPrice.value, row('H1-75DS/EP1').theirPrice], [29, 56]);
eq('mill row billed for EP2 prices at the PLATED tier', [row('H1-75DS').ourPrice.value, row('H1-75DS').theirPrice], [28, 55]);
eq('a plate is $0 — included in the arm price', [row('H1-75BP-R/P').ourPrice.value, row('H1-75BP-R/P').theirPrice], [0, 0]);
// A price that is not Fabricut's tier never lands in the "Fabricut sells at" column.
eq('rod: our price falls to the base price, their column stays blank', [row('H1-75R').ourPrice, row('H1-75R').theirPrice], [{ value: 9, source: 'item base price' }, null]);

// ── STOCK FACTS ──────────────────────────────────────────────────────────────────────────────
eq('internal id carried for the stock read', row('H1-75DS/EP1').internalId, '102');
ok('a fee holds no stock', row('CE-FEE-H1FR').stockable === false);
ok('an item NetSuite does not know has no internal id', row('H1-75R-JNR').internalId === '');
ok('nothing available and nothing on order = not covered', notCovered(row('H1-75DS/P'), { avail: 0, onOrd: 0 }));
ok('on order counts as covered', !notCovered(row('H1-75DS/P'), { avail: 0, onOrd: 4 }));
ok('an UNREAD row is unknown, never "not covered"', !notCovered(row('H1-75DS/P'), undefined));
ok('a row NetSuite does not know is never "not covered"', !notCovered(row('H1-75R-JNR'), { avail: 0, onOrd: 0 }));
ok('a fee is never "not covered"', !notCovered(row('CE-FEE-H1FR'), { avail: 0, onOrd: 0 }));

// ── THE FLOW'S OWN FINISH LIST ───────────────────────────────────────────────────────────────
eq('flowFinishes narrows what is offered', offeredFinishesOf({ flowFinishes: ['P01', 'EP1'] }, finishes).map(f => f.code), ['P01', 'EP1']);
eq('an empty flowFinishes offers everything', offeredFinishesOf({ flowFinishes: [] }, finishes).length, finishes.length);
const narrow = flowFamilies({ flow: { ...flow, flowFinishes: ['P01'] }, assembly, pins, findPart, finishes, priceCtx });
ok('a finish the flow does not offer produces no SKU', !narrow.skus.some(r => r.code === 'H1-75DS/EP1'));

// ── TABS ─────────────────────────────────────────────────────────────────────────────────────
eq('the generator tail is dropped from the label', flowLabelOf({ name: 'H1-138 — GENERATED' }), 'H1-138');
const asm = (f) => (f.linkedAssemblyId ? { id: f.linkedAssemblyId } : null);
const tabs = flowTabsOf([
    { id: 'a', name: 'H2-138 — GENERATED', linkedAssemblyId: 'x' },
    { id: 'b', name: 'H1-138 — GENERATED', linkedAssemblyId: 'x', sizeGroupLabel: 'Fabricut H1', sizeGroupSort: 1.375 },
    { id: 'c', name: 'H1-75 — GENERATED', linkedAssemblyId: 'x', sizeGroupLabel: 'Fabricut H1', sizeGroupSort: 0.75 },
    { id: 'd', name: 'Pillow', linkedAssemblyId: '' },
    { id: 'e', name: 'H1-1 — GENERATED', linkedAssemblyId: 'x', sizeGroupLabel: 'Fabricut H1', sizeGroupSort: 1 },
    { id: 'f', name: 'Brimar — GENERATED', linkedAssemblyId: 'x' },
], asm);
eq('CPQ picker order: the size group by diameter, then the rest by name; no-assembly flows out', tabs.map(t => t.label), ['H1-75', 'H1-1', 'H1-138', 'Brimar', 'H2-138']);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
