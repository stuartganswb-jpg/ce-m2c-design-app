// 🗓 The finishing schedule, counted as the floor runs it (Stuart 2026-10-13).   node scripts/finishingPlan.test.mjs
// The cases are the floor as it stood that day: SG / CP stock poles on their -P recipes, a customer pair with its pole
// still in the shop, WO11686 with 376 of 420 through, booth jobs, stock orders whose pick could not be made.
import { buildFinishingPlan, tracksOf, scheduleWaitOf, planTimersOf, BOOTH_COAT_MINS, BOOTH_LOAD_PCS } from '../src/components/Shared/finishingPlan.js';
import { workOrderPartLines } from '../src/components/Shared/finishingTime.js';
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; return; } fail++; console.log(`✗ ${n}`); };
const eq = (n, a, b) => ok(`${n} — got ${JSON.stringify(a)}`, JSON.stringify(a) === JSON.stringify(b));

const S = { app: 'Sprayed' }, H = { app: 'Hand Applied' };
const R = (...steps) => ({ steps: steps.map((s, i) => ({ step: i + 1, ...s })) });
// Finish recipes as the floor holds them (read live 2026-10-13): the poles' own recipe has a hand coat the master lacks.
const recipes = {
    SG: R(S, S, S), 'SG-S': R(S, S, S), 'SG-P': R(S, S, H, S),
    CP: R(S, S), 'CP-S': R(S, S), 'CP-P': R(S, S, H, S),
    N25: R(S, S), GOP: R(S, S, S), P29: R(S, S, S, H),
};
// The timers as saved on the floor: oven 6, pole spray 4; spin setup / spray never saved (10 / 3).
const timers = { ovenMins: 6, poleMins: 4, handSmallMins: 1.35, handPoleMins: 10 };
const plan = (wos, t = timers) => buildFinishingPlan(wos, recipes, {}, t, {});
const picked = { sentToPickPack: true, pickStatus: 'Picked_Awaiting_Staging' };
const stockPoles = (id, recipe, n = 10, more = {}) => ({ id, orderType: 'stock', recipe, productType: 'POLE', type: `HTA635/${recipe}`, totalParts: n, totalPoles: n, poles: { qty: n }, currentPhase: 'Setup', tasks: {}, ...picked, ...more });
const stockSmall = (id, recipe, n, more = {}) => ({ id, orderType: 'stock', recipe, productType: 'RING', paintSize: 'S', type: `HCUSR1/${recipe}-EA`, totalParts: n, currentPhase: 'Setup', tasks: {}, partsList: [{ legacyErpId: 'HCUSR1', quantity: n, pcs: n }], ...picked, ...more });

// ── the timers ──
eq('the booth as Stuart timed it — and a setting wins', [planTimersOf({}).boothCoat, planTimersOf({}).boothLoad, BOOTH_COAT_MINS, BOOTH_LOAD_PCS, planTimersOf({ boothCoatMins: 20, boothLoadPcs: 25 }).boothCoat, planTimersOf({ boothCoatMins: 20, boothLoadPcs: 25 }).boothLoad], [15, 30, 15, 30, 20, 25]);
eq('a timer never saved falls to the floor\'s own default', [planTimersOf(timers).spinSetup, planTimersOf(timers).spinPaint, planTimersOf(timers).oven, planTimersOf(timers).pole], [10, 3, 6, 4]);

// ── 1. each track on its own recipe ──
{
    const t = tracksOf(stockPoles('P1', 'SG'), recipes);
    eq('stock SG poles run SG-P — four coats, one by hand — and have no small-parts track', [t.parts, t.poles.key, t.poles.steps.length, t.poles.steps.filter(s => s.app === 'Hand Applied').length, t.poles.poles], [null, 'SG-P', 4, 1, 10]);
    const p = plan([stockPoles('P1', 'SG'), stockPoles('P2', 'SG'), stockPoles('P3', 'CP')]);
    const sg = p.poleBatches.find(b => b.recipe === 'SG-P'), cp = p.poleBatches.find(b => b.recipe === 'CP-P');
    eq('two SG pole orders pool on SG-P: 20 poles, 3 racks, 3 sprayed coats + 1 hand', [sg.poles, sg.racks, sg.sprayedSteps, sg.handCoats, sg.woCount], [20, 3, 3, 1, 2]);
    eq('…priced: spray 20×4×3, oven 3 racks×3×6, hand 20×10', [sg.sprayMins, sg.ovenMins, sg.handMins], [240, 54, 200]);
    eq('CP poles are CP-P — the master\'s two coats and no hand was the old reading', [cp.recipe, cp.sprayedSteps, cp.handCoats, cp.handMins], ['CP-P', 3, 1, 100]);
    eq('the pole hand coats reach the total', p.poleHandMins, 300);
    const mixed = { id: 'M1', orderType: 'sales', salesOrderId: 'SO1', recipe: 'CP', totalParts: 30, totalPoles: 5, poles: { qty: 5 }, paintSize: 'S', currentPhase: 'Setup', tasks: {}, stagingStatus: 'MATCHED' };
    const tm = tracksOf(mixed, recipes);
    eq('a mixed order: small parts on CP-S (2 coats), poles on CP-P (4)', [tm.parts.key, tm.parts.chunks[0].steps.length, tm.parts.pieces, tm.poles.key, tm.poles.steps.length, tm.poles.poles], ['CP-S', 2, 25, 'CP-P', 4, 5]);
    const kept = { ...mixed, currentPhase: 'Painting', currentStepIndex: 1, recipeCopy: { parts: { steps: [S, S, S].map((s, i) => ({ step: i + 1, ...s })) } } };
    eq('an order part-way through keeps the recipe it started with', [tracksOf(kept, recipes).parts.kept, tracksOf(kept, recipes).parts.chunks[0].steps.length], [true, 2]);
}

// ── 2. only what is left ──
{
    const onCoat3 = stockPoles('P9', 'CP', 10, { currentPhase: 'Painting', poleStepIndex: 2 });
    eq('poles on coat 3 of 4 have the hand coat and one spray left', (b => [b.sprayedSteps, b.handCoats, b.sprayMins, b.handMins, b.status])(plan([onCoat3]).poleBatches[0]), [1, 1, 40, 100, 'ON THE FLOOR']);
    // WO11686, live: 420 rings on the spin machine in loads — 376 through, a load of 18 on the machine at coat 2 of 2, 26 after it.
    const wo11686 = stockSmall('WO11686', 'CP', 420, { currentPhase: 'Painting', sprayStation: 'SPIN', currentStepIndex: 1, spinLoadQty: 18, spinLoads: [70, 70, 69, 28, 70, 69].map((qty, i) => ({ n: i + 1, qty })) });
    const t = tracksOf(wo11686, recipes);
    eq('WO11686: 44 pieces left, not 420 — 18 with one coat to go, 26 with both', [t.parts.pieces, t.parts.chunks.map(c => [c.pieces, c.steps.length])], [44, [[18, 1], [26, 2]]]);
    const b = plan([wo11686]).stockBatches[0];
    eq('…and it is priced at two sleds\' work, not twelve', [b.parts, b.sleds, b.ovenMins], [44, 2, 18]);
    const finished = stockSmall('F', 'N25', 50, { currentPhase: 'Painting', currentStepIndex: 2 });
    eq('a track past its last coat has nothing left to schedule', plan([finished]).stockBatches.length, 0);
    const partsDone = { id: 'M2', orderType: 'sales', salesOrderId: 'SO2', recipe: 'CP', totalParts: 30, totalPoles: 5, poles: { qty: 5 }, currentPhase: 'Painting', currentStepIndex: 2, poleStepIndex: 1, tasks: {}, stagingStatus: 'MATCHED' };
    const pp = plan([partsDone]);
    eq('small parts done, poles on coat 2: only the poles are left', [pp.customBatches.length, pp.customPoleBatches.length, pp.customPoleBatches[0].sprayedSteps, pp.customPoleBatches[0].handCoats], [0, 1, 2, 1]);
}

// ── 3. hand time for every hand coat ──
{
    const twoHand = { ...recipes, HH: R(S, H, S, H) };
    const p = buildFinishingPlan([stockSmall('H1', 'HH', 20)], twoHand, {}, timers, {});
    eq('two hand coats are twice the hand time (20 × 1.35 × 2)', [p.stockBatches[0].handCoats, p.stockBatches[0].handMins], [2, 54]);
    eq('a hand coat left on poles counts per pole', plan([stockPoles('P', 'SG', 8)]).poleBatches[0].handMins, 80);
}

// ── 4. spin or booth ──
{
    const spin = plan([stockSmall('S1', 'SG', 140)]).stockBatches[0];
    eq('on the spin machine: 140 small rings = 2 sleds, 3 coats', [spin.station, spin.sleds, spin.loads, spin.sprayedSteps], ['SPIN', 2, 0, 3]);
    eq('…2 × (setup 10 + 3 × (spray 3 + oven 6)), oven 2 × 3 × 6', [spin.machineMins, spin.ovenMins], [74, 36]);
    const booth = plan([stockSmall('B1', 'N25', 120, { sprayStation: 'BOOTH' })]).stockBatches[0];
    eq('in the booth: 120 pieces = 4 loads of 30, no sled', [booth.station, booth.loads, booth.sleds], ['BOOTH', 4, 0]);
    eq('…each coat 15 minutes and a bake: 4 × 2 × (15 + 6), oven 4 × 2 × 6', [booth.machineMins, booth.ovenMins], [168, 48]);
    eq('a booth job of 25 is one load', plan([stockSmall('B2', 'N25', 25, { sprayStation: 'BOOTH' })]).stockBatches[0].loads, 1);
    const p = plan([stockSmall('S1', 'SG', 140), stockSmall('B1', 'N25', 120, { sprayStation: 'BOOTH' })]);
    eq('the totals keep them apart, and the one oven takes both', [p.totalSleds, p.totalParts, p.boothLoads, p.boothParts, p.sledOvenMins, p.boothOvenMins, p.ovenTotalMins], [2, 140, 4, 120, 36, 48, 84]);
    eq('the same recipe at two stations is two rows', plan([stockSmall('S2', 'N25', 60), stockSmall('B3', 'N25', 60, { sprayStation: 'BOOTH' })]).stockBatches.map(b => b.station).sort(), ['BOOTH', 'SPIN']);
}

// ── 5. ready is the floor's own word ──
{
    const pair = { id: 'WO-SO61085', orderType: 'sales', salesOrderId: 'SO61085', customerName: 'BRIMAR', recipe: 'GOP', totalParts: 57, totalPoles: 1, poles: { qty: 1 }, paintSize: 'S', hasCustomSibling: true, customFabStatus: 'In Process', sentToPickPack: true, pickStatus: 'Pending', currentPhase: 'Setup', tasks: {}, partsList: [{ legacyErpId: 'HCUSR1', qty: 52 }] };
    eq('a pair whose pole is still in the shop waits on the shop — the card\'s own sentence', scheduleWaitOf(pair), 'Waiting on shop — In Process');
    const p = plan([pair]);
    eq('…its small parts AND its pole are listed with the order, waiting — none of it among the stock poles', [p.customBatches.length, p.customBatches[0].ready, p.customPoleBatches.length, p.customPoleBatches[0].withOrder, p.customPoleBatches[0].wait, p.poleBatches.length], [1, false, 1, true, 'Waiting on shop — In Process', 0]);
    eq('…and what waits is never summed', [p.totalParts, p.poleCount, p.ovenTotalMins, p.setupCount, p.customOrderCount], [0, 0, 0, 1, 1]);
    const noShop = { id: 'WO-OE-SO60993', orderType: 'sales', salesOrderId: 'SO60993', recipe: 'GOP', totalParts: 4, paintSize: 'S', sentToPickPack: true, pickStatus: 'Pending', currentPhase: 'Setup', tasks: {}, partsList: [{ legacyErpId: 'HCUDEC1', quantity: 2 }, { legacyErpId: 'HCUMB410', quantity: 2 }] };
    eq('a customer order with no shop half waits on its pick — not "awaiting fab"', scheduleWaitOf(noShop), 'Waiting on the WMS pick — small parts not picked yet');
    eq('picked, not yet matched at staging', scheduleWaitOf({ ...noShop, pickStatus: 'Picked_Awaiting_Staging' }), 'Waiting on staging — picked; scan the labels at the WMS staging bin');
    const matched = { ...pair, customFabStatus: 'Complete', pickStatus: 'Staged_Ready_For_Finishing', stagingStatus: 'MATCHED', reqDate: '2026-10-18' };
    eq('staged and matched → nothing to wait for', scheduleWaitOf(matched), '');
    const m = plan([matched, { ...matched, id: 'WO-SO2', salesOrderId: 'SO2', reqDate: '2026-10-15' }]);
    eq('ready customer orders run by due date, and an order\'s poles carry its number', [m.customBatches.map(b => [b.wos[0].id, b.seq]), m.customPoleBatches.map(b => [b.wos[0].id, b.seq])], [[['WO-SO2', 1], ['WO-SO61085', 2]], [['WO-SO2', 1], ['WO-SO61085', 2]]]);
    // Stock: the open-pick gate. Live, fifteen stock orders sat in the pick queue short of raw and were counted as schedulable.
    const openPick = stockPoles('WO11720', 'CP', 10, { pickStatus: 'Pending' });
    const unreleased = stockSmall('WOM2C', 'N25', 1, { sentToPickPack: false, pickStatus: '' });
    eq('a stock order whose pick is still open waits on it', scheduleWaitOf(openPick), 'Waiting on the WMS pick — parts not picked yet');
    eq('one not released to the pick yet waits on Start Setup', scheduleWaitOf(unreleased), 'Waiting on Start Setup — the parts pull is not released yet');
    eq('picked stock is ready; a paint run with nothing to pick is ready', [scheduleWaitOf(stockPoles('A', 'CP')), scheduleWaitOf({ id: 'JFP', orderType: 'stock', paintOnly: true, recipe: 'SG', totalParts: 3, currentPhase: 'Setup', tasks: {} })], ['', '']);
    eq('a job already on the floor is never "waiting"', scheduleWaitOf({ ...openPick, currentPhase: 'Painting' }), '');
    const s = plan([stockPoles('A', 'CP'), stockPoles('B', 'CP'), openPick, { ...openPick, id: 'WO11718' }]);
    eq('ready stock poles pool and take a number; the waiting ones pool apart, greyed, with the reason', s.poleBatches.map(b => [b.ready, b.poles, b.seq, b.wait]), [[true, 20, 1, ''], [false, 20, null, 'Waiting on the WMS pick — parts not picked yet']]);
    eq('…and only the ready twenty are in the totals', [s.poleCount, s.setupCount], [20, 2]);
}

// ── 6. part quantities, both spellings ──
{
    eq('a line spelled `quantity` counts (it counted for nothing)', workOrderPartLines({ partsList: [{ paintSize: 'S', productType: 'BRACKET', quantity: 12 }, { paintSize: 'M', productType: 'FINIAL', qty: 4 }] }), [{ size: 'S', type: 'BRACKET', qty: 12 }, { size: 'M', type: 'FINIAL', qty: 4 }]);
    eq('pieces first: a rod sold by the foot is its pieces', workOrderPartLines({ partsList: [{ paintSize: 'L', productType: 'ROD', quantity: 16, pcs: 2 }] }), [{ size: 'L', type: 'ROD', qty: 2 }]);
    const oe = { id: 'WO-OE-1', orderType: 'sales', salesOrderId: 'SO9', recipe: 'GOP', totalParts: 16, paintSize: 'S', currentPhase: 'Setup', tasks: {}, stagingStatus: 'MATCHED',
        partsList: [{ legacyErpId: 'A', paintSize: 'S', productType: 'BRACKET', quantity: 12 }, { legacyErpId: 'B', paintSize: 'M', productType: 'FINIAL', quantity: 4 }, { legacyErpId: 'C', paintSize: 'S', productType: 'RING', quantity: 36, pickOnly: true }, { legacyErpId: 'FEE', isFee: true, quantity: 1 }] };
    const b = plan([oe]).customBatches[0];
    eq('an Order Entry pair keeps its size mix; a pick-only line and a fee are not finished here', [b.parts, b.sizeMix, b.distinctSizes], [16, { S: 12, M: 4, L: 0 }, 2]);
    eq('a pole on the parts list rides the pole track, not a sled', tracksOf({ id: 'X', orderType: 'sales', recipe: 'CP', totalParts: 10, totalPoles: 2, poles: { qty: 2 }, currentPhase: 'Setup', tasks: {}, partsList: [{ paintSize: 'S', productType: 'BRACKET', quantity: 8 }, { paintSize: 'L', productType: 'WOOD ROD', quantity: 2 }] }, recipes).parts.lines, [{ size: 'S', type: 'BRACKET', qty: 8 }]);
}

// ── what never changes ──
{
    eq('nothing queued', (p => [p.batches.length, p.poleBatches.length, p.ovenTotalMins, p.days])(plan([])), [0, 0, 0, 0]);
    eq('a completed, closed or pick-only document is not planned', plan([stockSmall('C', 'SG', 10, { currentPhase: 'Complete' }), stockSmall('D', 'SG', 10, { currentPhase: 'Closed' }), stockSmall('E', 'SG', 10, { pickOnly: true })]).batches.length, 0);
    const lost = plan([stockSmall('U', 'ZZ9', 10)]);
    eq('a recipe the floor cannot find is still SHOWN, unpriced — never dropped', [lost.stockBatches.length, lost.stockBatches[0].resolved, lost.stockBatches[0].recipe], [1, false, 'ZZ9']);
    const d = plan([stockPoles('P1', 'SG', 90), stockPoles('P2', 'CP', 90)]);
    eq('180 stock poles: the thirty hours of hand finishing the old schedule did not show', [d.poleCount, d.poleRacks, d.poleHandMins, d.poleOvenMins], [180, 24, 1800, 432]);
    eq('hand work beyond the pole bakes adds to the clock; the rest hides inside them', [d.handOverlapMins, d.handBeyondMins, d.wallMins, Math.round(d.days * 10) / 10], [432, 1368, 1800, 3.8]);
}

// ── 🌲 a WOOD coat air-dries — 20 min on the rack, no oven (Grace / Stuart 2026-10-19 · Shared/airDry) ──
{
    const woodRecipes = { ...recipes, S04: R(H, S), 'S04-P': R(H, S), SM04: R(H, S, H, S) };
    const FIN = [{ code: 'S04', material: 'WOOD' }, { code: 'SM04', material: 'WOOD' }, { code: 'SG', material: 'METAL' }];
    const wplan = (wos, opts) => buildFinishingPlan(wos, woodRecipes, {}, timers, opts);
    eq('the air dry is a timer of its own: 20, unless the floor sets one', [planTimersOf(timers).airDry, planTimersOf({ woodAirDryMins: 25 }).airDry], [20, 25]);
    const p = wplan([stockPoles('W1', 'S04'), stockPoles('W2', 'SG')], { finishes: FIN });
    const s04 = p.poleBatches.find(b => b.recipe === 'S04-P'), sg = p.poleBatches.find(b => b.recipe === 'SG-P');
    eq('wood poles: no oven time, the dry said instead (2 racks × 1 sprayed coat × 20)', [s04.ovenMins, s04.airDry, s04.airDryMins], [0, true, 40]);
    eq('…the metal poles beside them bake as before', [sg.ovenMins, !!sg.airDry], [36, false]);
    eq('the plan\'s oven total is the metal\'s alone', p.poleOvenMins, 36);
    const small = wplan([stockSmall('W3', 'SM04', 20)], { finishes: FIN }).stockBatches[0];
    eq('an M2C stain on the sled: no oven, and the sled\'s time counts the dry (10 + 2×(3+20) + 2×2×10)', [small.ovenMins, small.airDry, small.machineMins - small.handMins], [0, true, 96]);
    const noLib = wplan([stockSmall('W4', 'SM04', 20)], {}).stockBatches[0];
    eq('without the library an M2C stain is read as the oven — the library is what says wood', [noLib.ovenMins > 0, !!noLib.airDry], [true, false]);
}

console.log(`finishingPlan: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
