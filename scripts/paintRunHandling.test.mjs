// A paint run says whether it is small parts or poles, offline.
//   node scripts/paintRunHandling.test.mjs
//
// Stuart 2026-09-23: JFP items he knew were poles (WO-JFP-HZLWP8135-B4 / -B5) landed on the Spin
// Machine as small parts — a JFP run is written from the JFP TEMPLATE's record, so nothing on it
// said "pole". The person now answers at every door; these rows pin what each answer writes and
// where the floor then puts the job. If one breaks, the change is wrong — unless Stuart changed it.

import { paintRunFloorFields, RUN_HANDLING, buildStockFinPayload } from '../src/components/Shared/stockRun.js';
import { woHasPoles, woHasSmallParts, windowOfCoat } from '../src/components/Shared/floorActivity.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g === w) { pass++; return; }
    fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`);
};

// ── what each answer writes ──
eq('POLES writes the pole shape: a count, no sled size', paintRunFloorFields('POLES', 6),
    { runHandling: 'POLES', productType: 'POLE', poles: { qty: 6, type: 'POLE' }, totalPoles: 6, paintSize: null, paintSizes: null });
eq('SMALL writes only the answer — what a paint run always carried', paintRunFloorFields('SMALL', 6), { runHandling: 'SMALL' });
eq('the answer is read however it is cased', paintRunFloorFields(' poles ', 2).runHandling, 'POLES');
eq('a quantity is at least one whole piece', paintRunFloorFields(RUN_HANDLING.POLES, 0).totalPoles, 1);
eq('no answer, no fields — the writer refuses', [paintRunFloorFields(undefined, 6), paintRunFloorFields('', 6), paintRunFloorFields('RODS', 6)], [null, null, null]);

// ── where the floor then puts it (the doc as releaseRunToFloor builds it: fields ride `extra`) ──
const docOf = (handling, qty) => buildStockFinPayload({
    woId: 'WO-JFP-HZLWP8135-B4-1', part: { id: 'JFP-TEMPLATE', legacyErpId: 'HZLWP8135/B4', itemName: 'JFP' },
    qty, finishLabel: 'B4', brand: 'ce', now: 1, extra: { paintOnly: true, ...paintRunFloorFields(handling, qty) },
});
const pole = docOf('POLES', 6), small = docOf('SMALL', 6);
eq('a POLES run is a pole order with no small parts — the pole track only', [woHasPoles(pole), woHasSmallParts(pole)], [true, false]);
eq('…its sprayed coats go to the Large Booth', windowOfCoat('poles', { app: 'Sprayed' }, pole), 'BOOTH');
eq('…and it never carries a sled stream beside the poles (buildFinDoc\'s assertion)', [pole.paintSize, pole.paintSizes], [null, null]);
eq('a SMALL run is small parts, as every paint run was before', [woHasPoles(small), woHasSmallParts(small)], [false, true]);
eq('…its sprayed coats go where Start Setup sends them (Spin until chosen)', windowOfCoat('parts', { app: 'Sprayed' }, small), 'SPIN');
eq('the paint-run fields ride untouched beside the answer', [pole.paintOnly, pole.stockErpId, pole.orderType], [true, 'HZLWP8135/B4', 'stock']);

console.log(`paintRunHandling: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
