// A flow set so: its parts not in NetSuite ride the configuration's roll-up (Stuart 2026-10-21, H5-HEX / ST102126-01: "when netsuite
// has no parts to match like H5- then can we push all items into the roll up? … a check box on the cpq flow as this one was created
// for all custom order and if it goes thru then we will set up parts in netsuite" · "go ahead with the recommended version").
//
//   node scripts/nsTransmitRollupUnmapped.test.mjs   (the loader registers itself — as nsTransmitRowPrices.test.mjs)
//
// The contract: on a flow with nsRollupUnmappedParts, a part whose id would not be a real NetSuite internal id (its code stood in,
// or it is UNMAPPED) is not its own line — its money stays in the configuration's roll-up, which names it; a part NetSuite knows
// (a real internal id, its own or its finished variant's) keeps its line; the transaction lands at the quote's total. An unticked
// flow pushes exactly as before, and a part missing from the library is still refused.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { buildNsTransaction } = await import('../src/components/Shared/nsTransmit.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

// H5-HEX as it is today: every part an item code with no NetSuite id; one stock screw NetSuite knows; a leather ring whose colour
// item is in NetSuite though its base is not; a fee; a part with no code at all
const libraryParts = [
    { id: 'P-ROD', legacyErpId: 'H5-1HXROD', itemId: 'H5-1HXROD', itemName: 'H5 Hex Rod', manufacturingSpecs: { basePrice: 30, partHandling: 'Custom' } },
    { id: 'P-PBE', legacyErpId: 'H5-1PBE', itemId: 'H5-1PBE', itemName: 'H5 Passing Bracket End', manufacturingSpecs: { basePrice: 0, partHandling: 'Small Parts' } },
    { id: 'P-CPV', legacyErpId: 'H5-1CP-V', itemId: 'H5-1CP-V', itemName: 'H5 Cap Vertical', manufacturingSpecs: { basePrice: 0 } },
    { id: 'P-SCR', legacyErpId: '2IN WALL SCREW', itemId: '2IN WALL SCREW', itemName: 'Wall screw', netSuiteInternalId: '501', manufacturingSpecs: { basePrice: 0.5 } },
    { id: 'P-LR', legacyErpId: 'FILR', itemId: 'FILR', itemName: 'Flat Iron Leather Ring', partClass: 'Assembly', manufacturingSpecs: {} },
    { id: 'P-LR02', legacyErpId: 'FILR/02', itemId: 'FILR/02', itemName: 'Flat Iron Leather Ring - Mist Grey', netSuiteInternalId: '602', partClass: 'Assembly', manufacturingSpecs: { basePrice: 6.75 } },
    { id: 'P-FEE', legacyErpId: 'H5-FEE', itemId: 'H5-FEE', itemName: 'H5 fabrication', partClass: 'Fee', manufacturingSpecs: { basePrice: 40 } },
    { id: 'P-NOCODE', itemName: 'Mystery bracket', manufacturingSpecs: {} },
];
const outsourceFinishes = [{ id: 'O-02', code: '02', name: 'Mist Grey', material: 'LEATHER' }];
const FLOWS = [
    { id: 'F-H5', name: 'H5-HEX', nsRollupItemId: '900', nsRollupUnmappedParts: true },
    { id: 'F-H5-PLAIN', name: 'H5-HEX (unticked)', nsRollupItemId: '901' },
];
const data = { libraryParts, cpqFlows: FLOWS, outsourceFinishes, globalFinishes: [] };
const row = (partId, legacyErpId, qty, total, extra = {}) => ({ partId, legacyErpId, name: legacyErpId, qty, price: qty ? total / qty : 0, total, ...extra });
const cart = (flowId, finalPrice, breakdown, extra = {}) => ({ id: `L-${flowId}`, engine: 'TAGS', flowId, qty: 1, sidemark: 'Living', pricing: { finalPrice }, pricingBreakdown: breakdown, ...extra });
const jobOf = (carts, flowId = 'F-H5') => ({ id: 'JOB', jobId: 'ST102126-01', flowId, customer: { id: 'CUST-1', name: 'Thom Filicia Inc.' }, jobName: 'Multi-Room', sidemark: 'MR',
    cpqData: { totalPrice: carts.reduce((s, c) => s + c.pricing.finalPrice * (c.qty || 1), 0), cartItems: carts, breakdown: [] } });
const build = async (job) => { const logs = []; const b = await buildNsTransaction({ job, asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs.push(String(m)) }); return { b, logs }; };
const total = (items) => Math.round(items.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100;

// ── 1. every part of the configuration is H5- (none in NetSuite): roll-ups alone, at the quote ───────────────────────────────────
const allH5 = [row('P-ROD', 'H5-1HXROD', 1, 300, { perFoot: true, feet: 5 }), row('P-PBE', 'H5-1PBE', 2, 120), row('P-CPV', 'H5-1CP-V', 2, 40), row('P-FEE', 'H5-FEE', 1, 40, { isFee: true })];
{
    const { b, logs } = await build(jobOf([cart('F-H5', 500, allH5)]));
    ok('ST102126-01 shape on a ticked flow builds (it was refused by NetSuite — the codes went out as item ids)', b.ok);
    const items = b.ok ? b.payload.item.items : [];
    eq('…as the configuration\'s roll-up alone, at the whole configuration', items.map(l => [l.item.id, l.quantity, l.rate]), [['900', 1, 500]]);
    ok('…no item line carries a code as its id', !items.some(l => /H5-/.test(String(l.item.id))));
    eq('…the roll-up names each part not in NetSuite yet (a pole by its feet)', b.ok && (items[0].description.match(/parts not in NetSuite yet: (.*)$/) || [])[1], 'H5-1HXROD ×5, H5-1PBE ×2, H5-1CP-V ×2');
    eq('…and the transaction lands at the quote\'s total', total(items), 500);
    eq('…the push says so in its log, and in what it hands back', [logs.some(m => /3 part\(s\) not in NetSuite ride/.test(m)), b.ok && b.meta.rolledUp.map(r => r.code)], [true, ['H5-1HXROD', 'H5-1PBE', 'H5-1CP-V']]);
}

// ── 2. a part NetSuite knows keeps its line; a colour item NetSuite knows is known though its base is not ─────────────────────────
{
    const mixed = [row('P-ROD', 'H5-1HXROD', 1, 300, { perFoot: true, feet: 5 }), row('P-SCR', '2IN WALL SCREW', 4, 2), row('P-LR', 'FILR', 10, 67.5, { finishCode: '02' }), row('P-FEE', 'H5-FEE', 1, 40, { isFee: true })];
    const { b } = await build(jobOf([cart('F-H5', 409.5, mixed)]));
    const items = b.ok ? b.payload.item.items : [];
    eq('the screw (501) and the Mist Grey ring (FILR/02 = 602) go as their own lines at their quoted rates; the hex rod rides the roll-up',
        items.map(l => [l.item.id, l.quantity, l.rate]), [['900', 1, 340], ['501', 4, 0.5], ['602', 10, 6.75]]);
    eq('…only the part not in NetSuite is named on the roll-up', b.ok && (items[0].description.match(/parts not in NetSuite yet: (.*)$/) || [])[1], 'H5-1HXROD ×5');
    eq('…and the total holds', total(items), 409.5);
}

// ── 3. an unticked flow pushes exactly as before ─────────────────────────────────────────────────────────────────────────────
{
    const { b } = await build(jobOf([cart('F-H5-PLAIN', 500, allH5)], 'F-H5-PLAIN'));
    const items = b.ok ? b.payload.item.items : [];
    eq('unticked: the codes still go out as their own lines (NetSuite refuses them — the fix list names each one)', items.map(l => l.item.id), ['901', 'H5-1HXROD', 'H5-1PBE', 'H5-1CP-V']);
    ok('…and nothing is named on the roll-up', b.ok && !/not in NetSuite/.test(items[0].description) && b.meta.rolledUp.length === 0);
    const noCode = await build(jobOf([cart('F-H5-PLAIN', 50, [row('P-NOCODE', '', 1, 50)])], 'F-H5-PLAIN'));
    eq('…a part with no code at all is still refused before posting (LINES_UNMAPPED, the 08-31 rule)', noCode.b.ok ? 'built' : noCode.b.error.code, 'LINES_UNMAPPED');
}

// ── 4. what the flag does not reach ───────────────────────────────────────────────────────────────────────────────────────────
{
    const noCode = await build(jobOf([cart('F-H5', 50, [row('P-NOCODE', '', 1, 50)])]));
    eq('ticked: a part with no code at all rides the roll-up too, named by what it is', [noCode.b.ok, noCode.b.ok && (noCode.b.payload.item.items[0].description.match(/not in NetSuite yet: (.*)$/) || [])[1]], [true, 'Mystery bracket ×1']);
    const missing = await build(jobOf([cart('F-H5', 82, [row('P-SCR', '2IN WALL SCREW', 4, 2), row('P-GONE', 'H5-NOT-IN-LIBRARY', 1, 80)])]));
    eq('ticked: a part the library does not hold is still refused — the app cannot name it (LINES_UNRESOLVED)', missing.b.ok ? 'built' : missing.b.error.code, 'LINES_UNRESOLVED');
    // two CPQ lines on one quote, one from each flow: only the ticked flow's line rolls
    const { b } = await build(jobOf([cart('F-H5', 500, allH5), cart('F-H5-PLAIN', 120, [row('P-PBE', 'H5-1PBE', 2, 120)])]));
    const items = b.ok ? b.payload.item.items : [];
    eq('one quote, two flows: the ticked line is a roll-up alone; the unticked line keeps its code line as before', items.map(l => l.item.id), ['900', '901', 'H5-1PBE']);
}

// ── 5. an older step-walk quote on a ticked flow: the one roll-up names the parts ─────────────────────────────────────────────
{
    const stepFlow = { id: 'F-STEP', name: 'H5 step flow', nsRollupItemId: '902', nsRollupUnmappedParts: true, steps: [{ id: 'S-ROD', title: 'Rod', linkedItemId: 'P-ROD' }, { id: 'S-SCR', title: 'Screws', linkedItemId: 'P-SCR' }] };
    const job = { id: 'JOB-S', jobId: 'Q-STEP', flowId: 'F-STEP', customer: { id: 'CUST-2', name: 'Step customer' }, jobName: 'S', sidemark: 'S',
        cpqData: { totalPrice: 200, cartItems: [{ flowId: 'F-STEP', qty: 1, dynamicConfigParams: { 'S-ROD': 'x', 'S-SCR': 'y' }, stepQuantities: { 'S-ROD': 1, 'S-SCR': 4 }, pricing: { finalPrice: 200 } }], breakdown: [] } };
    const logs = [];
    const b = await buildNsTransaction({ job, asType: 'estimate', brand: 'ce', data: { ...data, cpqFlows: [stepFlow] }, ctx: null, log: (m) => logs.push(String(m)) });
    const items = b.ok ? b.payload.item.items : [];
    eq('step walk: the roll-up first, the screw NetSuite knows as its line, no code line', items.map(l => l.item.id), ['902', '501']);
    ok('…the roll-up names the hex rod', b.ok && /parts not in NetSuite yet: H5-1HXROD ×1/.test(items[0].description));
    eq('…and the total holds', total(items), 200);
}

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
