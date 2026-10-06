// A quote copied into a NEW one, for another number of displays (Stuart 2026-10-06).   node scripts/quoteCopy.test.mjs
//
// "duplicate the first order of 50 with a brand new identical order for 100pcs do not release it yet … use old prices
//  they are negotiated to match the correct total … base front 1 put it all on one sales order."
// The contract: the copy is the same cart with NO quote behind it (so the save mints a new quote), every row at the new
// count with the price set on it kept, per-display add-ons grown with the displays, the first order's PO / need-by /
// shipping charge left behind — and an edited row keeps the price set on it.
import { quoteCopyOf, savedAddOnSelOf } from '../src/components/Shared/reopenQuote.js';
import { lineDiscountOf, keepLineDiscount } from '../src/components/Shared/lineDiscount.js';
import { headerWorkspaceOf, restorableWorkspace, writeWorkspace, readWorkspace, workspaceIsEmpty } from '../src/components/Shared/cpqWorkspace.js';
import { duplicateText, duplicateOtherLinesOf } from '../src/components/Shared/displayRelease.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`); };
const ok = (name, cond) => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name}`); };

// The tabletop's quote as it stands (ST091726-01): eight rows of 50, each with a price set on the line, and 50 bases.
const row = (id, sidemark, assemblyName, finalPrice, netPrice, extra = {}) => ({
    id: String(id), sidemark, assemblyName, qty: 50, engine: 'TAGS', flowId: `FLOW-${assemblyName}`, assemblyId: `ASM-${assemblyName}`,
    priceLevel: 'FAB_COST', engineVersion: 'ce3f8724a13d', engineConfig: { answers: { a: 1 }, globalFinish: 'EP4' },
    pricing: { finalPrice }, pricingBreakdown: [{ name: 'part', qty: 1, price: finalPrice, total: finalPrice, legacyErpId: 'X' }],
    lineDiscount: { mode: 'NET', netPrice, by: 'stuart', at: 1789659527163 },
    masterQuoteId: 'QUOTE-1789660306300', visionDraftId: 'DRAFT-9', tradeDiscount: null, displaySnapshot: 'data:image/png;base64,AAAA', ...extra,
});
const tabletop = () => ({
    id: 'QUOTE-1789660306300', jobId: 'QUOTE-1789660306300', quoteNo: 'ST091726-01', brandId: 'ce', status: 'SO_CONFIRMED',
    customer: { id: 'CUST-4720', name: 'FABRICUT' }, jobName: 'TABLE TOP DISPLAY', sidemark: 'TABLE TOP DISPLAY', orderSidemark: null,
    poNumber: '20250912-CE', needBy: '2026-09-30', shippingAmount: 125, shippingMethod: 'SAVED', shippingAddressId: 'ADDR-1',
    internalMemo: 'display', productionNotes: 'pack by display', priceLevel: 'FAB_COST', netsuiteEstimateId: '918800',
    orderDiscount: { mode: 'LINES', percent: null, code: '', by: 'stuart' },
    cpqData: {
        totalPrice: 25584.5,
        cartItems: [
            row(1789659288115, 'ROW 1', 'H1-1', 204.25, 100), row(1789659318466, 'Row 2', 'H1-2TRV', 275, 100),
            row(1789659342387, 'Base Front 2', 'H1-138', 23, 50), row(1789659368151, 'Base Front 3', 'H1-1', 58, 50),
            row(1789659381267, 'base front 4', 'H1-75', 28, 50), row(1789663881737, 'Base Back 1', 'H1-2TRV', 102, 50),
            row(1789659415926, 'Back Base 2', 'H1-138', 12.5, 20), row(1789663839015, 'Back Base 3', 'H1-2TRV', 28, 1.69),
        ],
        breakdown: [
            { name: '▶ H1-1 [ROW 1]', qty: 50, total: 10212.5, isHeader: true, sidemark: 'ROW 1' },
            { name: 'Add-ons & Fees', qty: 1, price: 0, total: 0, isHeader: true, partId: null },
            { name: '  - WALNUT TABLE TOP BASE', qty: 50, price: 90, total: 4500, partId: 'CE-INV-8107', legacyErpId: 'H1-TTB1', isFee: false, isAddOn: true },
            { name: '  - Rush', qty: 1, price: 0, total: 0, partId: 'CE-FEE-7', legacyErpId: 'RUSH', isFee: true, isAddOn: true },
        ],
    },
});

// ── the copy, 50 → 100 ───────────────────────────────────────────────────────────────────────────────
{
    const src = tabletop();
    const before = JSON.stringify(src);
    const c = quoteCopyOf(src, { from: 50, to: 100, now: 1790000000000 });
    ok('the copy is made', c.ok === true);
    eq('eight rows, each at the new count', c.cartItems.map(it => it.qty), [100, 100, 100, 100, 100, 100, 100, 100]);
    eq('…in the order of the quote', c.cartItems.map(it => it.sidemark), ['ROW 1', 'Row 2', 'Base Front 2', 'Base Front 3', 'base front 4', 'Base Back 1', 'Back Base 2', 'Back Base 3']);
    ok('NO line names a quote — the save mints a new one (finalize: cart[0].masterQuoteId || the session)', c.cartItems.every(it => !('masterQuoteId' in it)));
    ok('no line keeps the first quote\'s Vision drawing, trade-discount stamp or board capture', c.cartItems.every(it => !('visionDraftId' in it) && !('tradeDiscount' in it) && !('displaySnapshot' in it)));
    ok('every line has a new id, all different', new Set(c.cartItems.map(it => it.id)).size === 8 && c.cartItems.every(it => typeof it.id === 'string' && !src.cpqData.cartItems.some(o => o.id === it.id)));
    eq('each line says what it was copied from', c.cartItems[0].copiedFrom, { jobId: 'QUOTE-1789660306300', quoteNo: 'ST091726-01', itemId: '1789659288115' });
    eq('THE PRICE SET ON THE LINE IS KEPT, exactly', c.cartItems.map(it => it.lineDiscount.netPrice), [100, 100, 50, 50, 50, 50, 20, 1.69]);
    eq('…so each row nets what it did (a net above the configured price included)', c.cartItems.map(it => lineDiscountOf(it).net), [100, 100, 50, 50, 50, 50, 20, 1.69]);
    eq('the configured price is never overwritten', c.cartItems.map(it => it.pricing.finalPrice), [204.25, 275, 23, 58, 28, 102, 12.5, 28]);
    ok('the configuration, the parts and the engine stamp ride along as saved', c.cartItems.every((it, i) => JSON.stringify(it.engineConfig) === JSON.stringify(src.cpqData.cartItems[i].engineConfig) && JSON.stringify(it.pricingBreakdown) === JSON.stringify(src.cpqData.cartItems[i].pricingBreakdown) && it.engineVersion === 'ce3f8724a13d'));
    eq('rows total 100 × $421.69', c.subtotal, 42169);
    eq('the rows, for the confirmation', c.rows[7], { sidemark: 'Back Base 3', assemblyName: 'H1-2TRV', was: 50, qty: 100, gross: 28, net: 1.69, priceSet: true, percent: 0 });
    eq('an add-on counted per display grows with the displays; a flat fee stays', c.header.addOnSel, { 'CE-INV-8107': 100, 'CE-FEE-7': 1 });
    eq('…named for the confirmation', c.addOns.map(a => [a.code, a.was, a.qty, a.price, a.isFee]), [['H1-TTB1', 50, 100, 90, false], ['RUSH', 1, 1, 0, true]]);
    eq('the header comes too — customer, job, notes, shipping method, price level', [c.header.jobData.customerId, c.header.jobData.jobName, c.header.jobData.internalMemo, c.header.jobData.productionNotes, c.header.jobData.shippingMethod, c.header.jobData.shippingAddressId, c.header.priceLevel], ['CUST-4720', 'TABLE TOP DISPLAY', 'display', 'pack by display', 'SAVED', 'ADDR-1', 'FAB_COST']);
    eq('…but not what belongs to the first order alone: PO, need-by, shipping charge', [c.header.jobData.poNumber, c.header.jobData.needBy, c.header.jobData.shippingAmount], ['', '', '']);
    eq('the typed order sidemark, never the fallback chain', c.header.jobData.sidemark, '');
    eq('where it came from', c.sources, [{ jobId: 'QUOTE-1789660306300', quoteNo: 'ST091726-01', customer: 'FABRICUT' }]);
    ok('the quote copied from is not touched', JSON.stringify(src) === before);
    ok('…and its add-ons still read 50', savedAddOnSelOf(src)['CE-INV-8107'] === 50);
    // the same count is a plain copy
    const same = quoteCopyOf(src, { from: 50, to: 50 });
    eq('copied for the same count, nothing scales', [same.cartItems[0].qty, same.header.addOnSel['CE-INV-8107'], same.subtotal], [50, 50, 21084.5]);
    // fewer
    eq('copied for 10 of 50', quoteCopyOf(src, { from: 50, to: 10 }).cartItems.map(it => it.qty), [10, 10, 10, 10, 10, 10, 10, 10]);
}

// ── what it refuses ──────────────────────────────────────────────────────────────────────────────────
{
    const half = tabletop();
    half.cpqData.cartItems[2].qty = 25;                                   // one per two displays
    const r = quoteCopyOf(half, { from: 50, to: 33 });
    ok('a row that would not come out whole is refused, named', r.ok === false && /Base Front 2/.test(r.reason) && /16\.5/.test(r.reason));
    ok('…and nothing is handed over', !r.cartItems);
    ok('whole when it divides', quoteCopyOf(half, { from: 50, to: 100 }).cartItems[2].qty === 50);
    ok('no count given', quoteCopyOf(tabletop(), { from: 50, to: 0 }).ok === false);
    ok('a fraction of a display', quoteCopyOf(tabletop(), { from: 50, to: 12.5 }).ok === false);
    ok('a build that names no count', quoteCopyOf(tabletop(), { from: 0, to: 100 }).ok === false);
    ok('nothing to copy', quoteCopyOf([], { from: 50, to: 100 }).ok === false && quoteCopyOf(null, { from: 50, to: 100 }).ok === false);
    const oe = { quoteNo: 'QUO160', source: 'QUICKSHIP', quickShipCart: [{ erp: 'X' }] };
    const w = quoteCopyOf(oe, { from: 50, to: 100 });
    ok('an Order Entry quote is not CPQ\'s to open — refused in the wrong-door words', w.ok === false && /Order Entry/.test(w.reason) && /QUO160/.test(w.reason));
    const old = { quoteNo: 'QUO001', cpqData: { breakdown: [{ name: 'x', partId: 'P' }] } };
    ok('a quote from before per-item carts', quoteCopyOf(old, { from: 50, to: 100 }).ok === false);
    // an add-on that is not a whole number per display stays as saved
    const odd = tabletop();
    odd.cpqData.breakdown[2].qty = 60;
    eq('60 of an add-on for 50 displays is not per display — it stays 60', quoteCopyOf(odd, { from: 50, to: 100 }).header.addOnSel['CE-INV-8107'], 60);
}

// ── several quotes of one display become ONE cart ────────────────────────────────────────────────────
{
    const a = tabletop();
    const b = { id: 'QUOTE-2', quoteNo: 'ST091826-02', customer: { id: 'CUST-4720', name: 'FABRICUT' }, jobName: 'SECOND', priceLevel: 'STANDARD',
        cpqData: { cartItems: [row(2, 'Base Front 1', 'H1-75', 33, 0)], breakdown: [] } };
    const c = quoteCopyOf([a, b], { from: 50, to: 100, now: 5 });
    eq('nine rows, the first quote\'s then the second\'s', c.cartItems.map(it => it.sidemark).slice(-2), ['Back Base 3', 'Base Front 1']);
    ok('ids stay unique across quotes', new Set(c.cartItems.map(it => it.id)).size === 9);
    eq('a row set to $0.00 stays $0.00', lineDiscountOf(c.cartItems[8]).net, 0);
    eq('the header is the first quote\'s', [c.header.jobData.jobName, c.header.priceLevel], ['TABLE TOP DISPLAY', 'FAB_COST']);
    eq('both are named', c.sources.map(s => s.quoteNo), ['ST091726-01', 'ST091826-02']);
}

// ── the header reaches CPQ through the workspace door, under NO quote session ────────────────────────
{
    const c = quoteCopyOf(tabletop(), { from: 50, to: 100 });
    const ws = headerWorkspaceOf(c.header, 123);
    ok('the workspace names no session — a new quote', ws.sessionId === null);
    ok('…and is worth keeping', !workspaceIsEmpty(ws));
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, v); }, removeItem: (k) => { store.delete(k); }, get length() { return store.size; }, key: (i) => [...store.keys()][i] };
    writeWorkspace(storage, 'ce', ws);
    const r = restorableWorkspace(readWorkspace(storage, 'ce'), { sessionId: null, cart: c.cartItems });
    eq('CPQ opens on the customer, the price level and the add-ons', [r.header.jobData.customerId, r.header.priceLevel, r.header.addOnSel['CE-INV-8107']], ['CUST-4720', 'FAB_COST', 100]);
    ok('nothing is being edited, no flow is open, no configuration comes back', !r.engine.editingCartId && !r.engine.activeFlowId && r.config === null);
    ok('another division never reads it', readWorkspace(storage, 'm2c') === null);
    ok('a quote session (a reopened quote) never takes it', restorableWorkspace(readWorkspace(storage, 'ce'), { sessionId: 'QUOTE-1789660306300', cart: [] }) === null);
    eq('an empty header is still a valid workspace shape', headerWorkspaceOf(null).header, { jobData: {}, priceLevel: 'STANDARD', addOnSel: {} });
}

// ── an edited row keeps the price set on it ──────────────────────────────────────────────────────────
{
    const was = row(1, 'ROW 1', 'H1-1', 204.25, 100);
    const built = { id: '9', sidemark: 'ROW 1', qty: 100, pricing: { finalPrice: 231.4 } };          // today's engine, a new configured price
    const kept = keepLineDiscount(built, was);
    eq('the rebuilt line takes its predecessor\'s stamp', kept.lineDiscount, was.lineDiscount);
    eq('…and still nets $100.00 at the new configured price', [lineDiscountOf(kept).net, lineDiscountOf(kept).gross], [100, 231.4]);
    ok('the built line itself is not mutated', !('lineDiscount' in built));
    const own = { ...built, lineDiscount: { mode: 'PERCENT', percent: 10 } };
    ok('a line rebuilt with a stamp of its own keeps its own', keepLineDiscount(own, was) === own);
    ok('no stamp before, none after — the same object', keepLineDiscount(built, { id: '1' }) === built && keepLineDiscount(built, null) === built);
    const pct = keepLineDiscount(built, { lineDiscount: { mode: 'PERCENT', percent: 20, by: 's' } });
    eq('a percent stays that percent of the NEW configured price', lineDiscountOf(pct).net, 185.12);
}

// ── the confirmation says everything ────────────────────────────────────────────────────────────────
{
    const c = quoteCopyOf(tabletop(), { from: 50, to: 100 });
    const others = [{ id: 'QS-1789736793627', soId: 'SO60565', lines: [
        { erp: 'H1-75SR', qty: 50, finishCode: 'P24', memo: 'Base Front 1', perFoot: true, feetPer: 1, cutLength: 7.5, toBeFinished: true },
        { erp: 'H1-75SPF', qty: 50, finishCode: 'P24', row: 'Base Front 1', toBeFinished: true },
        { erp: 'H1-OLD', qty: 0, offOrder: true, row: 'Base Front 1' },
    ] }];
    eq('the other order\'s lines, for the new count', duplicateOtherLinesOf(others, { from: 50, to: 100 }), [
        { soId: 'SO60565', row: 'Base Front 1', erp: 'H1-75SR', qty: 100, finish: 'P24', cutLength: 7.5 },
        { soId: 'SO60565', row: 'Base Front 1', erp: 'H1-75SPF', qty: 100, finish: 'P24', cutLength: 0 },
    ]);
    const t = duplicateText({ build: { name: 'Fabricut H1 Tabletop × 50 — FABRICUT', displayName: 'Fabricut H1 Tabletop', customerName: 'FABRICUT' }, to: 100, copy: c, others });
    ok('names the new build order and that nothing is released', /Fabricut H1 Tabletop × 100 — FABRICUT/.test(t) && /nothing is released/.test(t));
    ok('names the quote copied from', /ST091726-01/.test(t));
    ok('every row with its count and its price', /ROW 1: 50 → 100 × \$100\.00 \(price set on the line\)/.test(t) && /Back Base 3: 50 → 100 × \$1\.69/.test(t));
    ok('the base at checkout', /H1-TTB1: 50 → 100 × \$90\.00/.test(t) && /RUSH: 1 → 1/.test(t));
    ok('the money: rows, add-ons, per display', /Rows \$42169\.00 \+ add-ons \$9000\.00 = \$51169\.00 — \$511\.69 a display/.test(t));
    ok('the order that is NOT a CPQ quote, line by line, for 100', /NOT in the copy — SO60565/.test(t) && /Base Front 1: 100 × H1-75SR in P24 · cut 7\.5"/.test(t) && /Base Front 1: 100 × H1-75SPF in P24/.test(t));
    ok('what is left behind, and that nothing is sent', /Not copied: the PO number/.test(t) && /nothing reaches NetSuite or a floor/.test(t));
    const alone = duplicateText({ build: { name: 'B' }, to: 100, copy: c, others: [] });
    ok('no other order, no warning', !/NOT in the copy/.test(alone));
}

console.log(`\nquoteCopy: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
