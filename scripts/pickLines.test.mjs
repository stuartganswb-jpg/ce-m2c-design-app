// One reader for an order's lines, offline.
//   node scripts/pickLines.test.mjs
//
// Brief D · D7, 2026-09-03. The headline row is the FEE ON THE ORDER ENTRY PACK PATH — a defect
// found by reading and never exercised live (on 2026-09-03 the order carrying FEE-H1-MRPF went
// through the CPQ door). Proving it here rather than by raising a real NetSuite order is the whole
// point: a live order to demonstrate a known bug moves real stock and real paperwork.

import {
    lineIsFeeish, isQuickShip, pickableLinesOf, packLinesOf, lineCode, lineQty,
} from '../src/components/Shared/pickLines.js';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};

// ── THE DEFECT D7 CLOSES ──────────────────────────────────────────────────────────────────────
const oeWithFee = {
    orderClass: 'QUICKSHIP',
    lines: [
        { erp: 'H1-75RCP-H/P16', name: '3/4" Rod', qty: 2 },
        { erp: 'FEE-H1-MRPF', name: 'Mitered Returns', qty: 4 },
        { erp: 'H1-75ILS/P16', name: 'Extended bracket', qty: 2 },
    ],
};
eq('an Order Entry FEE never reaches the PACK list',
    packLinesOf(oeWithFee).map(l => l.erp), ['H1-75RCP-H/P16', 'H1-75ILS/P16']);
eq('nor the PICK list', pickableLinesOf(oeWithFee).map(l => l.erp), ['H1-75RCP-H/P16', 'H1-75ILS/P16']);
ok('the fee itself is recognised', lineIsFeeish({ erp: 'FEE-H1-MRPF', name: 'Mitered Returns' }));

// ── and the thing that must NOT be filtered ───────────────────────────────────────────────────
ok('a real backplate whose NAME echoes a return option stays pickable',
    !lineIsFeeish({ legacyErpId: 'H1-138BP', name: 'Backplate (Mounting Base for 1" French Return)' }));
ok('a £0.00 plated collar is a REAL part, not a fee — price is never tested',
    !lineIsFeeish({ erp: 'H1-138WFCON2/EP5', name: 'Wood finial collar', price: 0 }));
ok('a configurator OPTION is not a part', lineIsFeeish({ partId: 'OPT-FLUSH-LEFT', name: 'Flush cut left' }));
ok('an explicit fee flag is enough on its own', lineIsFeeish({ erp: 'H1-REAL', name: 'Something', isFee: true }));
ok('a nameless PENDING line with a fee-ish name is dropped', lineIsFeeish({ partId: 'PENDING', name: 'Splice' }));
ok('a real splice ITEM is pickable — it has a code', !lineIsFeeish({ legacyErpId: 'H1-138JNR', name: 'Joiner / Splice' }));

// ── both partsList spellings (c435d6d — WO-SO59752 showed every pull ×0) ──────────────────────
const finJob = {
    partsList: [
        { legacyErpId: 'A', partName: 'Planner line', quantity: 3 },
        { partId: 'B', name: 'CPQ split line', qty: 5 },
    ],
};
eq('quantity AND qty are both read', packLinesOf(finJob).map(l => l.qty), [3, 5]);
eq('legacyErpId AND partId are both read', packLinesOf(finJob).map(l => l.erp), ['A', 'B']);
eq('lineQty reads either spelling', [lineQty({ quantity: 7 }), lineQty({ qty: 9 })], [7, 9]);
eq('lineCode reads every spelling', ['erp', 'legacyErpId', 'partId'].map(k => lineCode({ [k]: 'x-1' })), ['X-1', 'X-1', 'X-1']);

// ── poles are counted separately — they are not on the parts list ─────────────────────────────
const withPoles = { partsList: [{ legacyErpId: 'A', quantity: 1 }], totalPoles: 2, poles: { type: 'H1-138WR' }, type: 'W' };
const pl = packLinesOf(withPoles);
eq('the poles ride as their own row', pl[pl.length - 1], { key: 'POLES', erp: 'H1-138WR', aliasErp: '', name: 'Poles · H1-138WR', qty: 2, isPole: true });
eq('one pole reads singular', packLinesOf({ totalPoles: 1, poles: { type: 'P' } })[0].name, 'Pole · P');
eq('no poles adds no row', packLinesOf({ partsList: [{ legacyErpId: 'A', quantity: 1 }] }).length, 1);

// ── the stock build is ONE row, the FINISHED item, at the GOOD count ──────────────────────────
eq('completedParts wins over totalParts (packing scrap is already netted)',
    packLinesOf({ orderType: 'stock', stockErpId: 'RING/BL', totalParts: 120, completedParts: 119 })[0].qty, 119);
eq('totalParts is the fallback when nothing completed yet',
    packLinesOf({ orderType: 'stock', stockErpId: 'RING/BL', totalParts: 120 })[0].qty, 120);
ok('a scrapped count is said out loud on the row',
    /1 scrapped/.test(packLinesOf({ orderType: 'stock', stockErpId: 'R', totalParts: 120, completedParts: 119, packScrap: 1 })[0].name));
eq('completedParts of 0 is respected, not treated as missing',
    packLinesOf({ orderType: 'stock', stockErpId: 'R', totalParts: 120, completedParts: 0 })[0].qty, 0);
eq('a stock build has no pull lines of its own', pickableLinesOf({ orderType: 'stock', stockErpId: 'R' }), []);

// ── the door test ─────────────────────────────────────────────────────────────────────────────
ok('QUICKSHIP is the Order Entry door', isQuickShip({ orderClass: 'QUICKSHIP' }));
ok('anything else is not', !isQuickShip({ orderClass: 'ORDER_ENTRY' }) && !isQuickShip({}) && !isQuickShip(null));
eq('a null job reads as no lines', [packLinesOf(null), pickableLinesOf(null)], [[], []]);
eq('the kit label rides the pack name so the packer sees the set',
    packLinesOf({ orderClass: 'QUICKSHIP', lines: [{ erp: 'A', name: 'Ring', qty: 1, kit: 'PATTERN 3' }] })[0].name, 'Ring · PATTERN 3');
eq('aliasErp is carried but erp stays the real code',
    packLinesOf({ orderClass: 'QUICKSHIP', lines: [{ erp: 'REAL', aliasErp: 'H9560F', name: 'x', qty: 1 }] })[0],
    { key: 'L0', erp: 'REAL', aliasErp: 'H9560F', name: 'x', qty: 1 });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
