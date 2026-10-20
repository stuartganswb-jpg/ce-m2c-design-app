// Who did what, when — the history behind each "Where is it?" stamp (Stuart 2026-10-20).   node scripts/stampHistory.test.mjs
import { stampHistoryOf, rowsForStamp, floorRowsOf, warehouseRowsOf, customRowsOf, orderRowsOf, PART } from '../src/components/Shared/stampHistory.js';

let pass = 0, fail = 0;
const eq = (n, got, want) => { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) { pass++; return; } fail++; console.log(`✗ ${n}\n    got  ${g}\n    want ${w}`); };
const ok = (n, c, extra = '') => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}${extra ? `\n    ${extra}` : ''}`); };

// WO11579 on 2026-09-28 (UTC): Grace, Manual Control — the log as it stands (times in minutes from 18:13).
const T0 = Date.UTC(2026, 8, 28, 18, 13);
const at = (m) => T0 + Math.round(m * 60000);
const L = (m, action, task, extra = {}) => ({ id: `l${m}${action}${task}`, u: 'Grace', cat: 'manual', at: at(m), action, task, woId: 'WO-STK-49004-1788228574452', ...extra });
const logs = [
    L(0, 'START', 'spinSetup'), L(0.1, 'COMPLETE', 'spinSetup', { elapsedMs: 6000 }),
    L(0.2, 'START', 'spinSpray'), L(0.5, 'COMPLETE', 'spinSpray', { elapsedMs: 18000 }),
    L(0.6, 'START', 'spinBake'), L(0.8, 'COMPLETE', 'spinBake', { elapsedMs: 12000 }),
    L(2, 'ADVANCE', 'parts', { station: 'MANUAL', msg: 'MANUAL ADVANCE (parts) · WO11579 · coat 1' }),
    L(3, 'START', 'spinSetup'), L(3.1, 'COMPLETE', 'spinSetup', { elapsedMs: 6000 }),
    L(3.2, 'START', 'spinSpray'), L(3.3, 'COMPLETE', 'spinSpray', { elapsedMs: 6000 }),
    L(3.4, 'START', 'spinBake'), L(3.5, 'COMPLETE', 'spinBake', { elapsedMs: 6000 }),
    L(5, 'ADVANCE', 'parts', { station: 'MANUAL', msg: 'MANUAL ADVANCE (parts) · WO11579 · coat 2' }),
    L(5.5, 'START', 'spinSetup'), L(7, 'COMPLETE', 'spinSetup', { elapsedMs: 90000 }),
    L(7.1, 'START', 'spinSpray'), L(7.2, 'COMPLETE', 'spinSpray', { elapsedMs: 6000 }),
    L(7.3, 'START', 'spinBake'), L(46.4, 'COMPLETE', 'spinBake', { elapsedMs: 2346000 }),
    L(47, 'ADVANCE', 'parts', { station: 'MANUAL', msg: 'MANUAL ADVANCE (parts) · WO11579 · coat 3' }),
].reverse();   // the read comes back in any order
const wo = {
    id: 'WO-STK-49004-1788228574452', nsWoTran: 'WO11579', orderType: 'stock', recipe: 'SG', currentPhase: 'Complete', completedAt: at(47),
    createdAt: 1788228574454, createdBy: 'Eric', dispatchedAt: 1788228791050, dispatchedBy: 'Eric',
    sentToPickPackAt: 1788433354241, returnedToQueueAt: 1792431178850, returnedToQueueBy: 'Sandra G', returnedToQueueReason: 'picked early — parts returned to shelf',
    pickClearedAt: 1792431239194, pickClearedBy: 'Sandra G', pickStatus: 'Cleared_Overtaken',
};

const floor = floorRowsOf(wo, logs, { recipeLen: 3 });
eq('every punch, oldest first', floor.map(r => r.at), [...floor.map(r => r.at)].sort((a, b) => a - b));
eq('21 floor lines', floor.length, 21);
eq('all Grace', [...new Set(floor.map(r => r.who))], ['Grace']);
eq('the coat each step belongs to, counted from the advances', floor.filter(r => /started/.test(r.what)).map(r => `${r.coat}:${r.what}`), ['1:▶ Setup started', '1:▶ Spray started', '1:▶ Bake started', '2:▶ Setup started', '2:▶ Spray started', '2:▶ Bake started', '3:▶ Setup started', '3:▶ Spray started', '3:▶ Bake started']);
eq('how long each ran, in minutes', floor.filter(r => r.ran != null).map(r => Math.round(r.ran * 10) / 10), [0.1, 0.3, 0.2, 0.1, 0.1, 0.1, 1.5, 0.1, 39.1]);
eq('the last advance says the floor finished it', floor[floor.length - 1].what, '→ coat 3 finished — the last coat: finished on the floor');
eq('an earlier advance does not', floor.find(r => /coat 1 finished/.test(r.what)).what, '→ coat 1 finished');
eq('an advance names its coat once, in its words', floor.filter(r => /finished/.test(r.what)).map(r => r.coat), [null, null, null]);
eq('Manual Control is named', floor[floor.length - 1].where, 'Manual Control');

// a wood coat's dry slot is an air dry (Shared/airDry — the S-code stain fallback, no finish list here)
eq('wood: the bake slot reads Air Dry', floorRowsOf({ recipe: 'S03' }, [L(0, 'START', 'spinBake')])[0].what, '▶ Air Dry started');
// the floor's own flags, in its own words
const flagged = floorRowsOf(wo, [
    { id: 'a', u: 'Rafa', at: 1, action: 'PUNCH_WARNING', task: 'spinBake', elapsedMs: 6000, msg: '⏱ PUNCH WARNING · spinBake · WO-OE-SO60585-7173 — ran 0.1m — normal ~6m · catch-up run: 3 steps in 5 min (spinBake, spinSpray, spinSetup)' },
    { id: 'b', u: 'Jhonaton', at: 2, action: 'BLOCKED', task: 'spinBake', station: 'CARD', msg: 'STEP STOP · COMPLETE · spinBake · WO1 — the bake has run 2 of 20 min' },
    { id: 'c', u: 'Grace', at: 3, action: 'OVERRIDE', task: 'spinBake', msg: '⚠ STEP STOP OVERRIDE · COMPLETE · spinBake · WO1 — Grace went ahead despite: the bake has run 2 of 20 min' },
], { recipeLen: 3 });
eq('punch warning: flagged, its words kept', [flagged[0].flag, flagged[0].what], ['warn', '⏱ punch warning — ran 0.1m — normal ~6m · catch-up run: 3 steps in 5 min (spinBake, spinSpray, spinSetup)']);
eq('step stop: red, on the tablet card', [flagged[1].flag, flagged[1].where, flagged[1].what], ['stop', 'tablet card', '⛔ step stop — the bake has run 2 of 20 min']);
eq('override: flagged', [flagged[2].flag, flagged[2].what], ['warn', '⚠ manager override — Grace went ahead despite: the bake has run 2 of 20 min']);
// a reset starts the coats again and belongs to every stamp
const afterReset = floorRowsOf(wo, [
    L(0, 'ADVANCE', 'parts', { msg: 'MANUAL ADVANCE (parts) · WO11579 · coat 1' }),
    { id: 'r', u: 'Stuart', at: at(1), action: 'RESET', station: 'WMS · Packing Station', msg: '↩ NOT FINISHED — BACK TO THE FLOOR · WO11579 — never painted · back to Setup' },
    L(2, 'START', 'spinSetup'),
], { recipeLen: 3 });
eq('reset: every view, flagged, its reason', [afterReset[1].part, afterReset[1].flag, afterReset[1].what], [PART.ALL, 'warn', '↩ sent back to the floor — never painted · back to Setup']);
eq('reset: the next step is coat 1 again', afterReset[2].coat, 1);
// spin loads
const loads = floorRowsOf(wo, [
    L(0, 'ADVANCE', 'parts', { msg: 'MANUAL ADVANCE (parts) · WO11727 · coat 1' }),
    { id: 'ld', u: 'Grace', at: at(1), action: 'LOAD', station: 'SPIN', task: 'parts', msg: 'SPIN LOAD 1 DONE · 140 pcs · WO11727 — 140 of 280 done; load 2 (140 pcs) starts at coat 1' },
    L(2, 'START', 'spinSetup'),
], { recipeLen: 2 });
eq('a spin load: the ref left out, the words kept', loads[1].what, '🌀 SPIN LOAD 1 DONE · 140 pcs — 140 of 280 done; load 2 (140 pcs) starts at coat 1');
eq('a finished load starts the next at coat 1', loads[2].coat, 1);
// poles keep their own coat
const two = floorRowsOf(wo, [
    L(0, 'ADVANCE', 'poles', { msg: 'MANUAL ADVANCE (poles) · WO1 · coat 1' }),
    L(1, 'START', 'poleSpray'), L(1, 'START', 'spinSpray'),
], { recipeLen: 3, poleRecipeLen: 2 });
eq('poles count their own coats', [two[1].part, two[1].coat, two[2].part, two[2].coat], [PART.POLES, 2, PART.PARTS, 1]);

// ── the warehouse ──
const wh = warehouseRowsOf(wo, []);
eq('WO11579 warehouse, in order', wh.sort((a, b) => a.at - b.at).map(r => `${r.who || '—'}: ${r.what}`), [
    '—: 📦 parts pick released to the WMS',
    'Sandra G: ↩ returned to the pick queue — picked early — parts returned to shelf',
    'Sandra G: ⚠ pick cleared as overtaken — the floor already had the order',
]);
eq('not recorded is said', wh[0].note, 'who released it is not recorded');
const packedDoc = { orderType: 'sales', pickedAt: 10, pickedBy: 'Sandra G', stagedAt: 11, packedLines: { 'HCUSB138/CW19': { by: 'Andrea', at: 12 } }, packStatus: 'Packed', packedAt: 13, packedBy: 'Andrea' };
eq('picked, staged, a packed line, packed', warehouseRowsOf(packedDoc).map(r => `${r.who || '—'}: ${r.what}`), ['Sandra G: ✓ picked', '—: ✓ matched & staged', 'Andrea: ✓ packed HCUSB138/CW19', 'Andrea: ✓ packed']);
eq('a stock run is put away in its bin', warehouseRowsOf({ orderType: 'stock', packStatus: 'Packed', packedAt: 5, packedBy: 'Andrea', putawayBin: 'B-12' })[0].what, '✓ put away in B-12');
const now = 1800000000000;
const ns = warehouseRowsOf({ id: 'X' }, [
    { id: 'o1', kind: 'workordercompletion', label: 'Build HCUSR1/SG-EA ×420', status: 'POSTED', nsId: '9', nsTran: 'ASSYB7', createdAt: now - 3600000, createdBy: 'Andrea', writeBack: { collection: 'fin_workorders', docId: 'X' } },
    { id: 'o2', kind: 'inventoryadjustment', label: 'Scrap −2 × HCUSR1', status: 'FAILED', lastError: 'Invalid bin', createdAt: now - 60000, createdBy: 'Andrea' },
    { id: 'o3', kind: 'workordercompletion', label: 'Build', status: 'PENDING', createdAt: now - 30 * 60000, createdBy: 'Andrea' },
], { now });
eq('NetSuite writes: posted with its number, failed red with the error, stuck orange', ns.map(r => [r.what, r.flag]), [
    ['Build HCUSR1/SG-EA ×420 — posted ASSYB7', ''],
    ['Scrap −2 × HCUSR1 — failed (Invalid bin)', 'stop'],
    ['Build — pending', 'warn'],
]);
eq('NetSuite writes name the record', ns[0].where, 'NetSuite · Assembly Build');

// ── the shop ──
const shop = { startedAt: { seconds: 1790000000, nanoseconds: 0 }, startedBy: 'Livio', completedAt: { toMillis: () => 1790100000000 }, completedBy: 'Livio', status: 'Sent to Plating' };
eq('shop: started, to the plater', customRowsOf({}, shop).map(r => `${r.who}: ${r.what}`), ['Livio: ▶ shop started', 'Livio: ✓ shop finished — sent to the plater']);
eq('shop: Firestore timestamps read', customRowsOf({}, shop)[0].at, 1790000000000);
eq('no shop job: the mirror on the document', customRowsOf({ hasCustomSibling: true, customFabAt: 5, customFabStatus: 'Complete' }).map(r => r.what), ['custom half: complete']);

// ── the order ──
eq('order: created and released', orderRowsOf(wo, { floorRowCount: 21 }).map(r => `${r.who}: ${r.what}`), ['Eric: ✚ order created', 'Eric: → released from RTG to the floor']);
eq('no floor punch → the finish stamp is shown, and says so', orderRowsOf(wo, { floorRowCount: 0 }).filter(r => r.part === PART.FLOOR).map(r => [r.what, r.note]), [['✓ finished on the floor', 'no floor punch is logged for it']]);
eq('force-complete flagged', orderRowsOf({ forceCompletedAt: 3, forceCompletedBy: 'Sandra G', forceCompleteNsBuildSkipped: true }).map(r => [r.what, r.flag]), [['⚡ force-completed — marked already built in NetSuite', 'warn']]);

// ── one stamp's view ──
const all = stampHistoryOf({ wo, finLogs: logs, recipeLen: 3, now });
eq('the whole history, oldest first', all.map(r => r.at), [...all.map(r => r.at)].sort((a, b) => a - b));
eq('26 lines for WO11579', all.length, 26);
eq('its Finishing stamp: the 21 floor lines', rowsForStamp(all, 'PARTS', ['PARTS']).length, 21);
eq('its Warehouse view: the 3 pick lines', rowsForStamp(all, 'FULFIL', ['PARTS']).length, 3);
eq('the whole order', rowsForStamp(all, 'ORDER', ['ORDER']).length, 26);
const split = [{ part: PART.PARTS }, { part: PART.POLES }, { part: PART.FLOOR }, { part: PART.ALL }, { part: PART.FULFIL }];
eq('two tracks: each stamp its own track + both-track + every-view lines', [rowsForStamp(split, 'PARTS', ['PARTS', 'POLES']).length, rowsForStamp(split, 'POLES', ['PARTS', 'POLES']).length], [3, 3]);
eq('one finishing stamp: both tracks', rowsForStamp(split, 'POLES', ['POLES']).length, 4);
eq('nothing in → nothing out', stampHistoryOf({}), []);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
