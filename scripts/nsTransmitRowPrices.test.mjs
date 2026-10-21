// The NetSuite push of a CPQ line with prices typed over the engine's (Stuart 2026-10-20/21, Shared/rowPrices).
//
//   node scripts/nsTransmitRowPrices.test.mjs   (the loader registers itself — as nsTransmitLineDiscount.test.mjs)
//
// The contract: a typed price is the rate NetSuite is sent — a part's own line at the typed unit (a pole by the foot at the typed rate
// per foot), a traverse component from the item's trvComponents at its typed rate — the configuration's roll-up carries what is left
// (fees, labor), and the transaction lands at the quote's total with no whole-quote scale.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { buildNsTransaction } = await import('../src/components/Shared/nsTransmit.js');
const { applyRowPrices, cartRowKeys } = await import('../src/components/Shared/rowPrices.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

const libraryParts = [
    { id: 'P1', legacyErpId: 'H1-138R', itemId: 'H1-138R', itemName: 'Rod', netSuiteInternalId: '101', manufacturingSpecs: { basePrice: 4, partHandling: 'Custom' } },
    { id: 'P2', legacyErpId: 'H1-138B6', itemId: 'H1-138B6', itemName: 'Bracket', netSuiteInternalId: '102', manufacturingSpecs: { basePrice: 0, partHandling: 'Small Parts' } },
    { id: 'P3', legacyErpId: 'HTSLNTCAR', itemId: 'HTSLNTCAR', itemName: 'Carrier', netSuiteInternalId: '103', manufacturingSpecs: { basePrice: 0.5, partHandling: 'Small Parts' } },
    { id: 'P4', legacyErpId: 'CE-FEE-CUT', itemId: 'CE-FEE-CUT', itemName: 'Cut', netSuiteInternalId: '104', partClass: 'Fee', manufacturingSpecs: { basePrice: 15 } },
];
const data = { libraryParts, cpqFlows: [{ id: 'F1', name: 'Fabricut H1', nsRollupItemId: '999' }], outsourceFinishes: [], globalFinishes: [] };
// the engine's line: a 10 ft pole at $4/ft, 3 brackets the 4.6 sheet has no price for, 40 included carriers, a $15 cut fee
const engineLine = {
    id: 'L1', engine: 'TAGS', flowId: 'F1', qty: 2, sidemark: 'Den', pricing: { finalPrice: 55 },
    pricingBreakdown: [
        { partId: 'P1', legacyErpId: 'H1-138R', name: 'Rod', role: 'ROD', position: 'FRONT', qty: 1, perFoot: true, feet: 10, price: 4, total: 40 },
        { partId: 'P2', legacyErpId: 'H1-138B6', name: 'Bracket', role: 'BRACKET', position: 'CENTER', qty: 3, price: 0, total: 0 },
        { partId: 'P4', legacyErpId: 'CE-FEE-CUT', name: 'Cut', qty: 1, price: 15, total: 15, isFee: true },
        { partId: 'HTSLNTCAR', legacyErpId: 'HTSLNTCAR', name: 'HTSLNTCAR — carriers', qty: 40, price: 0, total: 0, trvComponent: true },
    ],
    trvComponents: [{ code: 'HTSLNTCAR', qty: 40, rate: 0.5, billable: false, why: 'carriers' }],
};
const k = cartRowKeys(engineLine.pricingBreakdown);
const typed = applyRowPrices(engineLine, { [k[0]]: 5.25, [k[1]]: 18, [k[3]]: 0.6 });
eq('the line as CPQ keeps it: the pole $52.50 (10 ft × $5.25), 3 brackets × $18, the fee as it was, 40 carriers × $0.60', [typed.pricingBreakdown.map(r => r.total), typed.pricing.finalPrice], [[52.5, 54, 15, 24], 145.5]);

const job = { id: 'JOB-1', jobId: 'JOB-1', flowId: 'F1', customer: { id: 'CUST-1', name: 'Fabricut' }, jobName: 'T', sidemark: 'T',
    cpqData: { totalPrice: 145.5 * 2, cartItems: [typed], breakdown: [] } };
const logs = [];
const b = await buildNsTransaction({ job, asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs.push(String(m)) });
ok('builds', b.ok);
const items = b.ok ? b.payload.item.items : [];
const byId = (id) => items.filter(l => l.item.id === id).map(l => [l.quantity, l.rate]);
eq('the pole goes at the typed rate per foot, by the foot (× 2 configurations)', byId('101'), [[20, 5.25]]);
eq('the brackets at the typed price', byId('102'), [[6, 18]]);
eq('the carriers from the components at their typed rate', byId('103'), [[80, 0.6]]);
const rollup = items.find(l => l.item.id === '999');
eq('the roll-up carries the fee — the rest of the configuration\'s money', rollup && rollup.rate, 30);
const sum = Math.round(items.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100;
eq('the transaction lands at the quote\'s total', sum, 291);
ok('no whole-quote scale', !logs.some(m => /every line scaled/.test(m)));

console.log(fail ? `❌  ${pass} passed, ${fail} failed` : `✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
