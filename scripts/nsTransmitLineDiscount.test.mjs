// Harness for the NetSuite push of a cart line discounted in CPQ (Stuart 2026-09-11, S1).
//
//   node scripts/nsTransmitLineDiscount.test.mjs   (the loader registers itself)
//
// (the --import hook resolves CRA's extension-less relative imports and stubs '../../firebase';
//  buildNsTransaction is exercised with no ctx, so it never reaches Firestore or the proxy)
//
// The contract: two identical TAGS lines, one discounted 20% in the cart. resolveJobLines keeps
// them apart (a discounted line never merges with its full-price twin), buildNsTransaction pushes
// the discounted item's components at THEIR OWN lower rates and leaves the other item's alone,
// the transaction lands at the quote's net total, and the whole-quote scale never fires.

// The loader registers ITSELF so the shared runner's plain `node --test` loads this suite too
// (close-out item 1, 2026-09-12): CRA source omits '.js' on relative imports and pulls the
// browser-only firebase bootstrap; scripts/_lib resolves the one and stubs the other.
import { register } from 'node:module';
register('./_lib/extless-hook.mjs', import.meta.url);
const { resolveJobLines, buildNsTransaction } = await import('../src/components/Shared/nsTransmit.js');

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

const libraryParts = [
    { id: 'P1', legacyErpId: 'H1-138R', itemId: 'H1-138R', itemName: 'Rod', netSuiteInternalId: '101', manufacturingSpecs: { basePrice: 10, partHandling: 'Custom' } },
    { id: 'P2', legacyErpId: 'H1-138B6', itemId: 'H1-138B6', itemName: 'Bracket', netSuiteInternalId: '102', manufacturingSpecs: { basePrice: 50, partHandling: 'Small Parts' } },
];
const data = { libraryParts, cpqFlows: [{ id: 'F1', name: 'Fabricut H1', nsRollupItemId: '999' }], outsourceFinishes: [], globalFinishes: [] };
const breakdown = () => [
    { partId: 'P1', legacyErpId: 'H1-138R', name: 'Rod', qty: 1, price: 10, total: 10 },
    { partId: 'P2', legacyErpId: 'H1-138B6', name: 'Bracket', qty: 2, price: 50, total: 100 },
];
const cartItem = (id, extra = {}) => ({ id, engine: 'TAGS', flowId: 'F1', qty: 1, pricing: { finalPrice: 110 }, pricingBreakdown: breakdown(), sidemark: '', ...extra });

const job = (cartItems, totalPrice, extra = {}) => ({
    id: 'JOB-1', jobId: 'JOB-1', flowId: 'F1', customer: { id: 'CUST-1', name: 'Fabricut' }, jobName: 'T', sidemark: 'T',
    cpqData: { totalPrice, cartItems, breakdown: [] }, ...extra,
});

// ── 1. resolveJobLines keeps the discounted twin apart and stamps its factor ──────────────────
const j1 = job([cartItem('a'), cartItem('b', { lineDiscount: { mode: 'PERCENT', percent: 20, by: 'Stuart', at: 1 } })], 198,
    { orderDiscount: { mode: 'LINES', percent: null, code: '', by: 'Stuart' } });
const r1 = resolveJobLines(j1, data);
eq('four aggregated lines: the pair at full price and the pair at .8', r1.lines.map(l => [l.nsId, l.qty, l.netFactor || 1]).sort(), [['101', 1, 0.8], ['101', 1, 1], ['102', 2, 0.8], ['102', 2, 1]].sort());

// ── 2. the same two lines, undiscounted, still merge as before ───────────────────────────────
const r2 = resolveJobLines(job([cartItem('a'), cartItem('b')], 220), data);
eq('undiscounted twins merge into two lines at doubled qty (unchanged behaviour)', r2.lines.map(l => [l.nsId, l.qty]).sort(), [['101', 2], ['102', 4]].sort());

// ── 3. buildNsTransaction: own rates for the discounted item, net total, no whole-quote scale ──
const logs = [];
const b1 = await buildNsTransaction({ job: j1, asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs.push(String(m)) });
ok('builds', b1.ok);
const items = b1.ok ? b1.payload.item.items : [];
const rollup = items[0];
const lines = items.slice(1).map(l => [l.item.id, l.quantity, l.rate]).sort();
eq('rates: 101 at 10 and 8, 102 at 50 and 40', lines, [['101', 1, 10], ['101', 1, 8], ['102', 2, 50], ['102', 2, 40]].sort());
eq('rollup carries nothing — the items already sum to the net', [rollup.item.id, rollup.rate], ['999', 0]);
eq('meta quotedTotal is the net', b1.meta?.quotedTotal, 198);
ok('the log names the line discounts and who set them', logs.some(m => /Line discounts from the cart: 2 line\(s\).*set by Stuart/.test(m)));
ok('the whole-quote scale did NOT fire', !logs.some(m => /item rates scaled/.test(m)));
const sum = items.reduce((s, l) => s + l.rate * l.quantity, 0);
eq('the transaction lands at the quote total to the cent', Math.round(sum * 100) / 100, 198);

// ── 4. a set % at checkout still rides the whole-quote scale, and the log says so ────────────
const logs4 = [];
const j4 = job([cartItem('a'), cartItem('b')], 176, { orderDiscount: { mode: 'ORDER_PERCENT', percent: 20, code: '', by: '' } });
const b4 = await buildNsTransaction({ job: j4, asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs4.push(String(m)) });
ok('builds', b4.ok);
ok('order percent named in the log', logs4.some(m => /Order discount 20% set at checkout/.test(m)));
ok('whole-quote scale fires for the set %', logs4.some(m => /item rates scaled to 80\.0%/.test(m)));
const sum4 = b4.payload.item.items.reduce((s, l) => s + l.rate * l.quantity, 0);
eq('lands at 176', Math.round(sum4 * 100) / 100, 176);

// ── 5. the customer's code, named ────────────────────────────────────────────────────────────
const logs5 = [];
await buildNsTransaction({ job: job([cartItem('a')], 88, { orderDiscount: { mode: 'CODE', percent: 20, code: 'D20', by: '' } }), asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs5.push(String(m)) });
ok('code named in the log', logs5.some(m => /Customer discount code D20 \(20%\)/.test(m)));

// ── 6. a net price set ABOVE the configured price scales that item UP, nothing else moves ─────
const j6 = job([cartItem('a'), cartItem('b', { lineDiscount: { mode: 'NET', netPrice: 132, by: 'Stuart', at: 1 } })], 242);
const b6 = await buildNsTransaction({ job: j6, asType: 'estimate', brand: 'ce', data, ctx: null });
eq('rates: the set line at ×1.2', b6.payload.item.items.slice(1).map(l => [l.item.id, l.rate]).sort(), [['101', 10], ['101', 12], ['102', 50], ['102', 60]].sort());

// ── 7. THE ONE HEADER (E3, 2026-09-12): CE carries its form + class; a brand with no ids REFUSES ──
{
    const ce = await buildNsTransaction({ job: job([cartItem('a')], 110, { poNumber: 'PO-9', shippingMethod: 'SAVED', shippingAddressId: '55' }), asType: 'salesorder', brand: 'ce', data, ctx: null });
    eq('CE sales order header: form 177, class 2, subsidiary 2 / location 17, PO, job id, saved address', [ce.payload.customForm, ce.payload.class, ce.payload.subsidiary, ce.payload.location, ce.payload.otherRefNum, ce.payload.custbody50, ce.payload.shipaddresslist], [{ id: '177' }, { id: '2' }, { id: '2' }, { id: '17' }, 'PO-9', 'JOB-1', { id: '55' }]);
    const m2c = await buildNsTransaction({ job: job([cartItem('a')], 110), asType: 'estimate', brand: 'm2c', data, ctx: null });
    eq('M2C refuses to queue with a named code until Eric\'s ids are on file', [m2c.ok, m2c.error && m2c.error.code], [false, 'NO_NS_FORM_FOR_BRAND']);
    const noCust = await buildNsTransaction({ job: { ...job([cartItem('a')], 110), customer: { id: '' } }, asType: 'estimate', brand: 'ce', data, ctx: null });
    eq('no customer still refuses as NO_CUSTOMER', noCust.error && noCust.error.code, 'NO_CUSTOMER');
}

console.log(`\nnsTransmit line discount: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
