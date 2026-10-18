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
// GROUPED since 2026-10-18 (Stuart: "in grouped order to match the cpq lines entered"): two CPQ lines are two groups — never merged.
eq('two undiscounted CPQ lines stay two groups, each with its own lines', r2.lines.map(l => [l.group, l.nsId, l.qty]).sort(), [[0, '101', 1], [0, '102', 2], [1, '101', 1], [1, '102', 2]].sort());

// ── 3. buildNsTransaction: own rates for the discounted item, net total, no whole-quote scale ──
const logs = [];
const b1 = await buildNsTransaction({ job: j1, asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs.push(String(m)) });
ok('builds', b1.ok);
const items = b1.ok ? b1.payload.item.items : [];
const rollup = items[0];
const lines = items.filter(l => l.item.id !== '999').map(l => [l.item.id, l.quantity, l.rate]).sort();
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
ok('whole-quote scale fires for the set %', logs4.some(m => /every line scaled to 80\.0%/.test(m)));
const sum4 = b4.payload.item.items.reduce((s, l) => s + l.rate * l.quantity, 0);
eq('lands at 176', Math.round(sum4 * 100) / 100, 176);

// ── 5. the customer's code, named ────────────────────────────────────────────────────────────
const logs5 = [];
await buildNsTransaction({ job: job([cartItem('a')], 88, { orderDiscount: { mode: 'CODE', percent: 20, code: 'D20', by: '' } }), asType: 'estimate', brand: 'ce', data, ctx: null, log: (m) => logs5.push(String(m)) });
ok('code named in the log', logs5.some(m => /Customer discount code D20 \(20%\)/.test(m)));

// ── 6. a net price set ABOVE the configured price scales that item UP, nothing else moves ─────
const j6 = job([cartItem('a'), cartItem('b', { lineDiscount: { mode: 'NET', netPrice: 132, by: 'Stuart', at: 1 } })], 242);
const b6 = await buildNsTransaction({ job: j6, asType: 'estimate', brand: 'ce', data, ctx: null });
eq('rates: the set line at ×1.2', b6.payload.item.items.filter(l => l.item.id !== '999').map(l => [l.item.id, l.rate]).sort(), [['101', 10], ['101', 12], ['102', 50], ['102', 60]].sort());

// ── 7. THE ONE HEADER (E3, 2026-09-12): CE carries its form + class; a brand with no ids REFUSES ──
{
    const ce = await buildNsTransaction({ job: job([cartItem('a')], 110, { poNumber: 'PO-9', shippingMethod: 'SAVED', shippingAddressId: '55' }), asType: 'salesorder', brand: 'ce', data, ctx: null });
    eq('CE sales order header: form 177, class 2, subsidiary 2 / location 17, PO, job id, saved address', [ce.payload.customForm, ce.payload.class, ce.payload.subsidiary, ce.payload.location, ce.payload.otherRefNum, ce.payload.custbody50, ce.payload.shipaddresslist], [{ id: '177' }, { id: '2' }, { id: '2' }, { id: '17' }, 'PO-9', 'JOB-1', { id: '55' }]);
    // M2C's ids landed 2026-10-14 (Stuart): quote form 187, sales order form 281, class Hardware 2 / Lighting 3 by what is sold.
    const m2c = await buildNsTransaction({ job: job([cartItem('a')], 110), asType: 'estimate', brand: 'm2c', data, ctx: null });
    eq('M2C now builds: quote form 187, subsidiary 3 / location 19, class Hardware (the line carries no lighting class)', [m2c.ok, m2c.payload && m2c.payload.customForm, m2c.payload && m2c.payload.subsidiary, m2c.payload && m2c.payload.location, m2c.payload && m2c.payload.class], [true, { id: '187' }, { id: '3' }, { id: '19' }, { id: '2' }]);
    const ly = await buildNsTransaction({ job: job([cartItem('a')], 110), asType: 'estimate', brand: 'leyla', data, ctx: null });
    eq('a brand with no ids on file (Leyla) still refuses with the named code', [ly.ok, ly.error && ly.error.code], [false, 'NO_NS_FORM_FOR_BRAND']);
    const noCust = await buildNsTransaction({ job: { ...job([cartItem('a')], 110), customer: { id: '' } }, asType: 'estimate', brand: 'ce', data, ctx: null });
    eq('no customer still refuses as NO_CUSTOMER', noCust.error && noCust.error.code, 'NO_CUSTOMER');
}

// ── 8. "No Sidemark" never reaches custcol3; a real sidemark does (close-out item 6) ─────────
{
    const j = job([cartItem('a', { sidemark: 'No Sidemark' }), cartItem('b', { sidemark: 'Formal Living 1' })], 220);
    const b = await buildNsTransaction({ job: j, asType: 'estimate', brand: 'ce', data, ctx: null });
    const tags = b.payload.item.items.slice(1).map(l => l.custcol3 || '');
    eq('the placeholder line carries no Tag; the real one carries its room', [...new Set(tags)].sort(), ['', 'Formal Living 1']);
}

// ── 9. THE KIT PUSH (F2 E / #46, close-out item 2): components the kit paid for at $0, ONE holder ──
{
    const kitParts = [
        ...libraryParts,
        { id: 'P3', legacyErpId: 'H1-2TRV-WB/P', itemId: 'H1-2TRV-WB/P', itemName: 'Traverse Wall Bracket', netSuiteInternalId: '103', manufacturingSpecs: { basePrice: 45, partHandling: 'Small Parts' } },
        { id: 'P4', legacyErpId: 'H1-2TRVSRA/P', itemId: 'H1-2TRVSRA/P', itemName: 'End Return Arm', netSuiteInternalId: '104', manufacturingSpecs: { basePrice: 22, partHandling: 'Small Parts' } },
    ];
    const holderPart = { id: 'PH', legacyErpId: 'CE-TRV-SYSTEM', itemId: 'CE-TRV-SYSTEM', itemName: 'Traverse system', netSuiteInternalId: '777', manufacturingSpecs: { basePrice: 0 } };
    const kitBreakdown = [
        { name: '2" MOTORIZED TRAVERSE SYSTEM', partId: 'H1-2TRV-4M/P-45W', legacyErpId: 'H1-2TRV-4M/P-45W', qty: 1, price: 995, total: 995, isKit: true, noNs: true, billGroup: 1 },
        { name: 'End Return Arm', partId: 'P4', legacyErpId: 'H1-2TRVSRA/P', qty: 2, price: 22, total: 44, billGroup: 3 },
        { name: 'Traverse Wall Bracket', partId: 'P3', legacyErpId: 'H1-2TRV-WB/P', qty: 3, price: 45, total: 0, inKit: true, billGroup: 4 },
    ];
    const kitJob = (parts) => ({ job: job([{ id: 'k', engine: 'TAGS', flowId: 'F1', qty: 1, pricing: { finalPrice: 1039 }, pricingBreakdown: kitBreakdown, sidemark: '' }], 1039), data: { ...data, libraryParts: parts } });
    const withHolder = kitJob([...kitParts, holderPart]);
    const logsK = [];
    const bk = await buildNsTransaction({ ...withHolder, asType: 'estimate', brand: 'ce', ctx: null, log: (m) => logsK.push(String(m)) });
    ok('builds', bk.ok);
    const itemsK = bk.payload.item.items;
    eq('the holder line IS CE-TRV-SYSTEM and carries the kit\'s dollars (1039 − 44 added)', [itemsK[0].item.id, itemsK[0].rate], ['777', 995]);
    ok('the holder names the kit and says the components are below at $0', /H1-2TRV-4M\/P-45W \[traverse system — components below at \$0\]/.test(itemsK[0].description), itemsK[0].description);
    eq('the brackets the kit paid for push at $0, qty 3; the added arms at their rate', itemsK.slice(1).map(l => [l.item.id, l.quantity, l.rate]).sort(), [['103', 3, 0], ['104', 2, 22]].sort());
    ok('the kit row itself is not a line', !itemsK.some(l => l.description && /MOTORIZED TRAVERSE SYSTEM/.test(l.description) && l.item.id !== '777'));
    eq('the transaction lands at the quote total', Math.round(itemsK.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100, 1039);
    ok('the whole-quote scale never fired', !logsK.some(m => /item rates scaled/.test(m)));
    ok('the log says so', logsK.some(m => /Kit order: 1 component line\(s\) at \$0.*CE-TRV-SYSTEM/.test(m)));
    // no holder item in the library → the flow rollup carries the money, and the log warns
    const noHolder = kitJob(kitParts);
    const logsN = [];
    const bn = await buildNsTransaction({ ...noHolder, asType: 'estimate', brand: 'ce', ctx: null, log: (m) => logsN.push(String(m)) });
    eq('no holder item: the flow rollup (999) carries the kit\'s dollars', [bn.payload.item.items[0].item.id, bn.payload.item.items[0].rate], ['999', 995]);
    ok('…and the log warns', logsN.some(m => /No CE-TRV-SYSTEM holder item/.test(m)));
    // a paid twin and a kit-paid twin of one item never merge
    const twin = kitJob([...kitParts, holderPart]);
    twin.job.cpqData.cartItems[0].pricingBreakdown = [...kitBreakdown, { name: 'Traverse Wall Bracket', partId: 'P3', legacyErpId: 'H1-2TRV-WB/P', qty: 1, price: 45, total: 45, billGroup: 3 }];
    twin.job.cpqData.totalPrice = 1084;
    const bt = await buildNsTransaction({ ...twin, asType: 'estimate', brand: 'ce', ctx: null });
    eq('a 4th bracket above the kit bills at 45 on its own line beside the three at $0', bt.payload.item.items.slice(1).filter(l => l.item.id === '103').map(l => [l.quantity, l.rate]).sort(), [[1, 45], [3, 0]].sort());
}

// ── 10. GROUPED: the Fabricut sales price per item, fees in the roll-up, each CPQ line's roll-up first (Stuart 2026-10-18) ──
{
    const parts = [
        { id: 'R', legacyErpId: 'H1-75R', itemId: 'H1-75R', itemName: 'Rod', netSuiteInternalId: '201', manufacturingSpecs: { basePrice: 9, partHandling: 'Custom' } },
        { id: 'ILE', legacyErpId: 'H1-75ILE/P', itemId: 'H1-75ILE/P', itemName: 'In Line Bracket', netSuiteInternalId: '202', manufacturingSpecs: { basePrice: 35, partHandling: 'Small Parts' } },
        { id: 'RING', legacyErpId: 'H1-75BR/P', itemId: 'H1-75BR/P', itemName: 'Ring', netSuiteInternalId: '203', manufacturingSpecs: { basePrice: 0, partHandling: 'Small Parts' } },
        { id: 'MR', legacyErpId: 'H1-MRPF', itemId: 'H1-MRPF', itemName: 'MITER RETURN', partClass: 'Fee', netSuiteInternalId: '204', manufacturingSpecs: { basePrice: 50, productType: 'FEE' } },
        { id: 'PK', legacyErpId: 'H1-PCKF1', itemId: 'H1-PCKF1', itemName: 'Pole Pack', partClass: 'Fee', netSuiteInternalId: '205', manufacturingSpecs: { basePrice: 12, productType: 'FEE' } },
    ];
    const gdata = { libraryParts: parts, cpqFlows: [{ id: 'F1', name: 'FABRICUT H1', nsRollupItemId: '999' }], outsourceFinishes: [], globalFinishes: [] };
    // SO60427's configuration, per assembly (2 ordered): rod 7 ft × $9, two miter-return fees, the bracket at Fabricut's $26.50, 26 rings at $3.50
    const so427 = [
        { partId: 'R', legacyErpId: 'H1-75R', name: 'Rod', qty: 1, price: 9, total: 63, perFoot: true, feet: 7 },
        { partId: 'MR', legacyErpId: 'H1-MRPF', name: 'MITER RETURN', qty: 1, price: 50, total: 50 },
        { partId: 'MR', legacyErpId: 'H1-MRPF', name: 'MITER RETURN', qty: 1, price: 50, total: 50 },
        { partId: 'ILE', legacyErpId: 'H1-75ILE/P', name: 'In Line Bracket', qty: 1, price: 26.5, total: 26.5 },
        { partId: 'RING', legacyErpId: 'H1-75BR/P', name: 'Ring', qty: 26, price: 3.5, total: 91 },
    ];
    const cart = (id, sidemark, breakdown, qty = 1) => ({ id, engine: 'TAGS', flowId: 'F1', qty, sidemark, assemblyName: 'H1-75', pricing: { finalPrice: breakdown.reduce((s, l) => s + l.total, 0) }, pricingBreakdown: breakdown });
    const gj = job([cart('a', 'WRD', so427, 2)], 561);
    const gb = await buildNsTransaction({ job: gj, asType: 'salesorder', brand: 'ce', data: gdata, ctx: null });
    ok('builds', gb.ok);
    const gi = gb.ok ? gb.payload.item.items : [];
    eq('the roll-up prints first and carries ONLY the fees (4 miter returns, $200)', [gi[0].item.id, gi[0].rate], ['999', 200]);
    ok('the roll-up names the CPQ line', /FABRICUT H1 — WRD · fees, fabrication & labor/.test(gi[0].description));
    eq('items at the price CPQ quoted — the bracket at $26.50 (not its $35 base), the rings at $3.50 (not $0), the rod by the foot',
        gi.slice(1).map(l => [l.item.id, l.quantity, l.rate]), [['201', 14, 9], ['202', 2, 26.5], ['203', 52, 3.5]]);
    eq('lands at the quote, to the cent', Math.round(gi.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100, 561);
    // two CPQ lines + checkout add-ons: [roll-up A, A's items, roll-up B, B's items, add-ons]
    const two = job([cart('a', 'Living', [so427[0], so427[3]]), cart('b', 'Den', [so427[1], so427[3]])], 241.5);
    two.cpqData.breakdown = [{ isAddOn: true, isFee: true, partId: 'PK', legacyErpId: 'H1-PCKF1', name: 'Pole Pack', qty: 1, price: 12, total: 12 }];
    two.cpqData.totalPrice = 63 + 26.5 + 50 + 26.5 + 12;
    const tb = await buildNsTransaction({ job: two, asType: 'salesorder', brand: 'ce', data: gdata, ctx: null });
    eq('two CPQ lines and the add-ons, each group roll-up first', tb.payload.item.items.map(l => [l.item.id, l.rate]),
        [['999', 0], ['201', 9], ['202', 26.5], ['999', 50], ['202', 26.5], ['999', 12]]);
    ok('each roll-up names its own line', /— Living ·/.test(tb.payload.item.items[0].description) && /— Den ·/.test(tb.payload.item.items[3].description) && /^Add-ons & fees/.test(tb.payload.item.items[5].description));
    eq('meta: the roll-ups sum to the fees', [tb.meta.silentFeeBalance, tb.meta.groups.map(g => g.group)], [62, [0, 1, 'ADDONS']]);
    // an order-wide % (customer code) scales every line; a cent of rounding rides the first roll-up
    const disc = job([cart('a', 'WRD', so427, 2)], 504.9, { orderDiscount: { mode: 'CODE', percent: 10, code: 'D10', by: '' } });
    const db = await buildNsTransaction({ job: disc, asType: 'salesorder', brand: 'ce', data: gdata, ctx: null });
    eq('a 10% code lands at the net to the cent', Math.round(db.payload.item.items.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100, 504.9);
    // a line discounted in the cart: its group lands at its net, the other group untouched
    const ld = job([cart('a', 'A', so427), cart('b', 'B', so427, 1)], 280.5 * 0.8 + 280.5);
    ld.cpqData.cartItems[0].lineDiscount = { mode: 'PERCENT', percent: 20, by: 'Stuart', at: 1 };
    const lb = await buildNsTransaction({ job: ld, asType: 'salesorder', brand: 'ce', data: gdata, ctx: null });
    const groupA = lb.payload.item.items.slice(0, 4), groupB = lb.payload.item.items.slice(4);
    eq('the discounted group at 80%, the other at full price', [Math.round(groupA.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100, Math.round(groupB.reduce((s, l) => s + l.rate * l.quantity, 0) * 100) / 100], [224.4, 280.5]);
    // an older step-walk quote keeps the order-wide merge and the one roll-up
    const legacy = resolveJobLines({ ...job([], 0), cpqData: { totalPrice: 0, cartItems: [], breakdown: [] } }, gdata);
    eq('an older quote is not grouped', legacy.grouped, false);
}

console.log(`\nnsTransmit line discount: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
