// Harness for customerDocLines — what a customer may read on a money document.
//
//   node scripts/customerDocLines.test.mjs
//
// Stuart 2026-08-22: "hidden go to all shop doc's just not customer docs."
//
// The rule has two halves and the second one is the easy one to lose: the money documents drop
// BOM-only parts, and EVERYTHING ELSE STILL GETS THEM. A test that only proved the dropping would
// pass just as happily if the parts had been dropped everywhere — which would take the standoffs
// off the shop floor and the pick list.
//
// Stuart 2026-09-11 (S1): the money documents KEEP the discount / net rows — the paper has to add
// up — while the floors and every non-money document still never see them.

import { customerDocLines, isDisplayOnlyLine, MONEY_DOC_TYPES } from '../src/components/Shared/lineClassification.js';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${name}\n    got  ${g}\n    want ${w}`);
};
const ok = (name, cond, extra = '') => { if (cond) { pass++; return; } fail++; console.log(`✗ ${name} ${extra}`); };

const LINES = [
    { name: '▶ H1-2TRV-4/EP [Living Room]', isHeader: true },
    { name: 'fascia', partId: 'F', legacyErpId: 'H1-2TRVF', total: 90 },
    { name: 'track', partId: 'T', legacyErpId: 'H1-2TRVT', total: 0, shopOnly: true },
    { name: 'standoff', partId: 'S', legacyErpId: 'H1-138STDOFF', total: 4, hidden: true },
    { name: 'finial', partId: 'C', legacyErpId: 'H1-1CC', total: 30 },
];
const codes = (ls) => ls.map(l => l.legacyErpId || l.name);

// ── THE MONEY DOCUMENTS ──────────────────────────────────────────────────────────────────────
for (const type of MONEY_DOC_TYPES) {
    const out = customerDocLines(LINES, type);
    // The named configuration also closes with its own total (2026-09-21). This header carries no
    // `total` — an older save — so the figure falls back to the group's own rows, BOM-only parts
    // included: 90 fascia + 0 track + 4 standoff + 30 finial. The customer reads 124, and pays 124.
    eq(`${type}: the customer sees what they bought, then what the room costs`, codes(out),
        ['H1-2TRVF', 'H1-1CC', '  SM: Living Room — Net Line Total']);
    eq(`${type}: the made row totals the whole configuration, hidden parts and all`, out[2].total, 124);
    ok(`${type}: no BOM-only part`, !out.some(l => l.hidden));
    ok(`${type}: no shop-only row`, !out.some(l => l.shopOnly));
    ok(`${type}: and no header`, !out.some(l => l.isHeader));
}

// ── EVERYTHING ELSE STILL GETS EVERY PART ────────────────────────────────────────────────────
// ⚠ A PACKING SLIP IS A LIST OF WHAT IS IN THE BOX. The standoff is physically in there and the
// customer counts against it, so a contents document that hid it would be wrong in the other
// direction — and the shop screens would lose real work.
{
    for (const type of ['PACKING_SLIP', 'FACTORY_ROUTER', 'FULL_PACKET', '']) {
        const out = customerDocLines(LINES, type);
        eq(`${type || '(no type)'}: every real line survives`, codes(out),
            ['H1-2TRVF', 'H1-2TRVT', 'H1-138STDOFF', 'H1-1CC']);
        ok(`${type || '(no type)'}: the standoff is still on it`, out.some(l => l.hidden));
    }
}

// ── IT IS STILL THE DISPLAY-ONLY FILTER UNDERNEATH ───────────────────────────────────────────
// Two questions, two functions: isDisplayOnlyLine answers "is this a line at all", and this one
// answers "may a customer read it". Folding the second into the first would strip BOM-only parts
// from the shop screens, because getJobLines feeds those too.
{
    const junk = [{ name: 'Rod Diameter: 1-3/8"' }, { name: 'Trade Discount - (20%)', isDiscount: true }];
    // 2026-09-11: the size echo is gone from both; the DISCOUNT row stays on the money document
    // (it is the arithmetic) and is gone from the shop view.
    eq('the size echo is gone from the invoice; the discount row stays (it is the arithmetic)', customerDocLines(junk, 'INVOICE').map(l => l.name), ['Trade Discount - (20%)']);
    eq('…and both are gone from the shop view', customerDocLines(junk, 'PACKING_SLIP').length, 0);
    ok('a hidden part is NOT display-only — it is a real line', !isDisplayOnlyLine({ partId: 'S', total: 4, hidden: true }));
    ok('a discount row IS display-only for every work consumer', isDisplayOnlyLine(junk[1]));
}

// ── THE PAPER HAS TO ADD UP (Stuart 2026-09-11, S1) ─────────────────────────────────────────
{
    const lines = [
        { name: '▶ Fabricut H1-138', isHeader: true, qty: 0, total: 0 },
        { name: 'Rod', partId: 'P1', legacyErpId: 'H1-138R', qty: 1, price: 87.5, total: 87.5, perFoot: true, feet: 7 },
        { name: 'Bracket', partId: 'P2', legacyErpId: 'H1-138B6', qty: 2, price: 16, total: 32 },
        { name: '  Trade Discount - (20%)', qty: 1, price: -23.9, total: -23.9, isDiscount: true, partId: null },
        { name: '  Net Line Total', qty: 1, price: 95.6, total: 95.6, isNetLine: true, partId: null },
        { name: '  Line Discount - (10%) · by M', qty: 1, price: -11.95, total: -11.95, isDiscount: true, isLineDiscount: true, partId: null },
        { name: 'Rod Diameter: 1-3/8"', qty: 0, isSizeRow: true },
        { name: 'Hidden joiner', partId: 'P3', qty: 1, price: 6, total: 6, hidden: true },
    ];
    const names = (out) => out.map(l => l.name.trim());
    eq('QUOTE keeps the discount and net rows, in order, after the items', names(customerDocLines(lines, 'QUOTE')),
        ['Rod', 'Bracket', 'Trade Discount - (20%)', 'Net Line Total', 'Line Discount - (10%) · by M']);
    eq('SALES_ORDER and INVOICE the same', [names(customerDocLines(lines, 'SALES_ORDER')).length, names(customerDocLines(lines, 'INVOICE')).length], [5, 5]);
    eq('a money document still drops the header, the size echo and the hidden line', names(customerDocLines(lines, 'INVOICE')).some(n => /▶|Diameter|Hidden/.test(n)), false);
    eq('a money document still shows the feet as the qty', customerDocLines(lines, 'QUOTE')[0].qty, 7);
    eq('WORK_ORDER (not money) drops them as before', names(customerDocLines(lines, 'WORK_ORDER')), ['Rod', 'Bracket', 'Hidden joiner']);
    eq('a discount row is not renamed or re-finished on the way through', customerDocLines(lines, 'QUOTE', 'P14', { findPart: () => ({ itemName: 'LIBRARY NAME' }) })[2].name, '  Trade Discount - (20%)');
}

// ── THE SIDEMARK RIDES THE NET LINE (Stuart 2026-09-21, QUO160) ──────────────────────────────
// The ▶ header names the room and a money document drops it, so the room is carried down onto
// that configuration's Net Line Total row — "SM: Row 2 — Net Line Total". Two sources, because
// every quote already saved (QUO160 among them) has no `sidemark` field on its header: the
// field when it is there, the [brackets] in the title when it is not.
{
    const group = (head, sm) => [
        head,
        { name: '  - Wood Rod', partId: 'R', legacyErpId: 'H2581F', qty: 70, price: 12.5, total: 875 },
        { name: `  Price set to $100.00 · by stuart`, qty: 1, price: -3088.75, total: -3088.75, isDiscount: true, isLineDiscount: true },
        { name: '  Net Line Total', qty: 1, price: 100, total: 3500, isNetLine: true },
    ].map(l => ({ ...l, _sm: sm }));
    const netOf = (out) => (out.find(l => l.isNetLine) || {}).name;

    eq('the header FIELD names the room on the net line',
        netOf(customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true, sidemark: 'Row 2' }), 'QUOTE')),
        '  SM: Row 2 — Net Line Total');
    eq('a quote saved before the field reads it out of the [brackets]',
        netOf(customerDocLines(group({ name: '▶ H2581F [Row 2]  ·  Blonde Oak (S03)', isHeader: true }), 'QUOTE')),
        '  SM: Row 2 — Net Line Total');
    eq('the sales order and the invoice say the same thing',
        [netOf(customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true }), 'SALES_ORDER')),
         netOf(customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true }), 'INVOICE'))],
        ['  SM: Row 2 — Net Line Total', '  SM: Row 2 — Net Line Total']);
    eq('"No Sidemark" is not a sidemark — the row is left alone',
        netOf(customerDocLines(group({ name: '▶ H2581F [No Sidemark]', isHeader: true }), 'QUOTE')),
        '  Net Line Total');
    eq('an unnamed configuration is left alone',
        netOf(customerDocLines(group({ name: '▶ H2581F []', isHeader: true }), 'QUOTE')),
        '  Net Line Total');
    // Each group takes ITS OWN room — the carry must reset at the next header, never leak forward.
    const two = [...group({ name: '▶ H2579F [Row 1]', isHeader: true }), ...group({ name: '▶ H2581F [Row 2]', isHeader: true })];
    eq('each configuration takes its own room', customerDocLines(two, 'QUOTE').filter(l => l.isNetLine).map(l => l.name),
        ['  SM: Row 1 — Net Line Total', '  SM: Row 2 — Net Line Total']);
    // ── EVERY NAMED CONFIGURATION CLOSES WITH ITS TOTAL (Stuart 2026-09-21) ──────────────────
    // "add the row … everytime no matter discounts or not." An UNdiscounted group has no net row
    // of its own, so one is made from the ▶ header's total.
    const plain = [
        { name: '▶ H3588F [Row 3]', isHeader: true, qty: 35, total: 455 },
        { name: '  - Bracket', partId: 'B', legacyErpId: 'H3588F', qty: 35, price: 13, total: 455 },
    ];
    const plainOut = customerDocLines(plain, 'QUOTE');
    eq('an undiscounted configuration gets a net row of its own', plainOut.map(l => l.name),
        ['  - Bracket', '  SM: Row 3 — Net Line Total']);
    eq('…carrying the configuration total and the per-unit price',
        [plainOut[1].total, plainOut[1].price, plainOut[1].qty], [455, 13, 1]);
    eq('a discounted configuration is NOT given a second one',
        customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true, qty: 35, total: 3500 }), 'QUOTE').filter(l => l.isNetLine).length, 1);
    eq('the row closes the group — it never lands before the group\'s own lines',
        customerDocLines([...plain, { name: '▶ H9999F [Row 4]', isHeader: true, qty: 1, total: 10 },
            { name: '  - Finial', partId: 'F', legacyErpId: 'H9999F', qty: 1, price: 10, total: 10 }], 'QUOTE').map(l => l.name),
        ['  - Bracket', '  SM: Row 3 — Net Line Total', '  - Finial', '  SM: Row 4 — Net Line Total']);
    // ⚠ THE ADD-ONS ARE NOT PART OF THE LAST CONFIGURATION. They are appended after every
    // configured item and carry a header of their own — which is exactly what stops the rush fee
    // being swept inside Row 3 and counted in its total.
    eq('the add-ons block is not swept into the last configuration',
        customerDocLines([...plain,
            { name: 'Add-ons & Fees', qty: 1, price: 0, total: 0, isHeader: true },
            { name: '  - Rush', qty: 1, price: 50, total: 50, isFee: true, isAddOn: true }], 'QUOTE').map(l => l.name),
        ['  - Bracket', '  SM: Row 3 — Net Line Total', '  - Rush']);
    eq('an UNNAMED configuration is still left exactly as it was',
        customerDocLines([{ name: '▶ H3588F []', isHeader: true, qty: 1, total: 455 },
            { name: '  - Bracket', partId: 'B', legacyErpId: 'H3588F', qty: 35, price: 13, total: 455 }], 'QUOTE').map(l => l.name),
        ['  - Bracket']);
    eq('the floors and the packing slip never get the made row',
        customerDocLines(plain, 'WORK_ORDER').concat(customerDocLines(plain, 'PACKING_SLIP')).filter(l => l.isNetLine).length, 0);
    // ⚠ NEVER A FABRICATED $0.00 ON A CUSTOMER'S PAPER. With no header total and no money in the
    // group there is nothing to state, so no row is made.
    eq('a configuration with no figure at all gets no row',
        customerDocLines([{ name: '▶ H3588F [Row 9]', isHeader: true },
            { name: '  - Included bracket', partId: 'B', legacyErpId: 'H3588F', qty: 1, price: 0, total: 0, inKit: true }], 'QUOTE').filter(l => l.isNetLine).length, 0);
    eq('…but a group whose header lost its total falls back to its own rows',
        customerDocLines([{ name: '▶ H3588F [Row 9]', isHeader: true },
            { name: '  - Bracket', partId: 'B', legacyErpId: 'H3588F', qty: 35, price: 13, total: 455 }], 'QUOTE').find(l => l.isNetLine).total, 455);
    // The floors never see a net row at all — and the carry must not have invented one for them.
    eq('a work order is untouched', customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true }), 'WORK_ORDER').map(l => l.name.trim()), ['- Wood Rod']);
    // Printing the same quote twice must not stack "SM: Row 2 — SM: Row 2 — …".
    eq('printing twice does not double the stamp',
        netOf(customerDocLines(customerDocLines(group({ name: '▶ H2581F [Row 2]', isHeader: true }), 'QUOTE'), 'QUOTE')),
        '  SM: Row 2 — Net Line Total');
}

console.log(fail ? `\n❌  ${pass} passed, ${fail} failed` : `\n✅  ${pass} passed, 0 failed`);
process.exit(fail ? 1 : 0);
